/**
 * AI Content Moderation — Bixcart
 *
 * Architecture:
 * 1. INSTANT keyword filter  — catches ~90% of violations, zero cost, zero latency
 * 2. AI queue (Gemini)       — only called for edge cases; rate-limit safe via queue
 *
 * Free Gemini tier: 15 req/min → queue drains at 1 req/4.2s = ~14/min safely
 */

const fetch = require('node-fetch');

// ─────────────────────────────────────────────────────────────────────────────
// LAYER 1 — Instant keyword filter
// ─────────────────────────────────────────────────────────────────────────────
const KEYWORD_RULES = [
  {
    category: 'contact_bypass',
    reason: 'Sharing contact information or trying to move conversation off-platform is not allowed on Bixcart.',
    patterns: [
      /\bwhatsapp\b/i, /\bwatsapp\b/i, /\bw[- ]?app\b/i,
      /\bsnapchat\b/i, /\bmy snap\b/i, /\badd me on snap/i,
      /\btelegram\b/i,
      /\b(message|chat|text|reach|contact|hit) me (on|via|at|through)\b/i,
      /\b(dm|pm) me\b/i,
      /\boutside (this|the) (app|platform|chat)\b/i,
      /\boff (this|the) (app|platform)\b/i,
      /\b0[789][01]\d{8}\b/,
      /\+?234\d{10}/,
    ],
  },
  {
    category: 'academic_fraud',
    reason: 'Academic fraud materials are strictly prohibited on Bixcart and violates ACU rules.',
    patterns: [
      /\b(sell|selling|buy|buying|have|got)\b.{0,30}\b(exam|test|quiz)\b.{0,20}\b(answer|paper|question|solution)/i,
      /\b(do|write|complete)\b.{0,20}\b(your |my )?(assignment|project|thesis|coursework)\b.{0,20}\b(for you|for me)?\b.*\b(pay|money|cash|₦|naira)/i,
      /\bassignment\b.{0,30}\b(for sale|₦|naira|cheap|available)/i,
      /\bexam (expo|runz|answers|leak)/i,
      /\b(runs|runz)\b/i,
    ],
  },
  {
    category: 'prohibited_item',
    reason: 'This item or substance is prohibited on Bixcart.',
    patterns: [
      /\b(sell|selling|buy|buying|available|have|got|supply)\b.{0,25}\b(weed|igbo|loud|colorado|shisha|codeine|tramadol|refnol|mkpuru mmiri|coke|cocaine|heroin|meth)\b/i,
      /\b(sell|selling|buying|available)\b.{0,25}\b(gun|knife|cutlass|blade|weapon|pistol|rifle|ammo|bullet)\b/i,
      /\bporn/i,
      /\bsex (tape|video|clip|movie|content)/i,
    ],
  },
  {
    category: 'adult_content',
    reason: 'Adult or sexual content is not allowed on Bixcart.',
    patterns: [
      /\b(hook ?up|link ?up for sex|one night|friends with benefit)\b/i,
      /\bnude(s)?\b/i,
    ],
  },
];

function keywordCheck(text) {
  for (const rule of KEYWORD_RULES) {
    for (const pattern of rule.patterns) {
      if (pattern.test(text)) {
        return { flagged: true, reason: rule.reason, category: rule.category };
      }
    }
  }
  return { flagged: false, reason: '', category: '' };
}

// ─────────────────────────────────────────────────────────────────────────────
// LAYER 2 — Gemini AI queue
// ─────────────────────────────────────────────────────────────────────────────
const queue = [];
let queueTimer = null;

function enqueueAICheck(text, context, onResult) {
  queue.push({ text, context, onResult });
  if (!queueTimer) {
    queueTimer = setInterval(drainQueue, 4200);
  }
}

async function drainQueue() {
  if (!queue.length) {
    clearInterval(queueTimer);
    queueTimer = null;
    return;
  }
  const job = queue.shift();
  const result = await callGemini(job.text, job.context);
  job.onResult(result);
}

function moderateMessage(content, history = []) {
  const kw = keywordCheck(content);
  if (kw.flagged) return Promise.resolve(kw);

  if (process.env.GEMINI_API_KEY && looksAmbiguous(content)) {
    return new Promise(resolve => enqueueAICheck(content, history, resolve));
  }

  return Promise.resolve({ flagged: false, reason: '', category: '' });
}

function moderateListing(data) {
  const text = `${data.title} ${data.description}`;
  const kw = keywordCheck(text);
  if (kw.flagged) return Promise.resolve(kw);

  if (process.env.GEMINI_API_KEY) {
    return new Promise(resolve => enqueueAICheck(text, [], resolve));
  }

  return Promise.resolve({ flagged: false, reason: '', category: '' });
}

function looksAmbiguous(text) {
  const t = text.toLowerCase();
  return (
    t.includes('@') ||
    t.includes('snapchat') ||
    t.includes('snap') ||
    t.includes('telegram') ||
    t.includes('outside') ||
    t.includes('exam') ||
    t.includes('assignment') ||
    /\d{10,}/.test(t)
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// GEMINI CALLER
// ─────────────────────────────────────────────────────────────────────────────
const SYSTEM_PROMPT = `You are a content moderation AI for Bixcart, a student marketplace at Ajayi Crowther University (ACU), Nigeria.

IMPORTANT CONTEXT:
- Bixcart is NOT a payment platform. Sellers sharing bank account details for payment is completely normal and allowed.
- Nigerian slang insults (mumu, ode, olodo, dullard, etc.) are culturally normal and NOT flagged — users can report those themselves.
- Price negotiation, campus meetup arrangements, and item condition discussion are fine.

Flag ONLY:
- Trying to move conversation off-platform (WhatsApp, Snapchat, Telegram, Instagram, sharing social handles or phone numbers to bypass the app)
- Prohibited items (weapons, drugs, alcohol, porn, stolen goods, pirated software)
- Academic fraud (exam answers, assignment help for money, runz/expo)
- Sexual solicitation or explicit content

Do NOT flag: bank account numbers for payment, insults/slang, tough negotiation, price disputes.

Respond ONLY with JSON: {"flagged": true|false, "reason": "short reason or empty", "category": "contact_bypass|prohibited_item|academic_fraud|adult_content|school_rules or empty"}`;

async function callGemini(text, context) {
  try {
    const contextStr = (context || []).slice(-3).map(m => `${m.role}: ${m.content}`).join('\n');
    const prompt = `${contextStr ? `Context:\n${contextStr}\n\n` : ''}Content to check: "${text}"\n\nJSON only:`;

    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${process.env.GEMINI_API_KEY}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { maxOutputTokens: 120, temperature: 0.1 },
      }),
    });

    if (!res.ok) { console.warn('[aiMod] Gemini error:', res.status); return safe(); }

    const data   = await res.json();
    const raw    = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || '{}';
    const clean  = raw.replace(/^```json|^```|```$/gm, '').trim();
    const parsed = JSON.parse(clean);
    if (parsed.flagged) console.log('[aiMod] AI flagged:', parsed.reason);
    return { flagged: Boolean(parsed.flagged), reason: parsed.reason || '', category: parsed.category || '' };
  } catch (e) {
    console.warn('[aiMod] Gemini error:', e.message);
    return safe();
  }
}

function safe() { return { flagged: false, reason: '', category: '' }; }

module.exports = { moderateMessage, moderateListing, keywordCheck };
