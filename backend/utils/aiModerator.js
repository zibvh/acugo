/**
 * AI Content Moderation — Bixcart
 *
 * Architecture:
 * 1. INSTANT keyword filter  — catches ~90% of violations, zero cost, zero latency
 * 2. AI queue (Gemini)       — only called for edge cases; rate-limit safe via queue
 *
 * Free Gemini tier: 15 req/min → queue drains at 1 req/4s = 15/min safely
 */

const fetch = require('node-fetch');

// ─────────────────────────────────────────────────────────────────────────────
// LAYER 1 — Instant keyword filter (free, synchronous, no API needed)
// ─────────────────────────────────────────────────────────────────────────────
const KEYWORD_RULES = [
  {
    category: 'contact_bypass',
    reason: 'Sharing contact information or trying to move conversation off-platform is not allowed on Bixcart.',
    patterns: [
      /\bwhatsapp\b/i, /\bwatsapp\b/i, /\bw[- ]?app\b/i,
      /\bsnapchat\b/i, /\bsnapchat\b/i, /\bsnap\b.*\bme\b/i, /\bmy snap\b/i, /\badd me on\b/i,
      /\btelegram\b/i, /\binstagram\b/i, /\b(my )?insta\b/i,
      /\bfacebook\b/i, /\btwitter\b/i, /\btwitter\b/i,
      /\btiktok\b/i,
      /\b(message|chat|text|reach|contact|hit) me (on|via|at|through)\b/i,
      /\b(call|phone|ring) me\b/i,
      /\bmy (phone |cell |mobile )?number( is)?\b/i,
      /\b\d{4}[\s-]?\d{3}[\s-]?\d{4}\b/, // Nigerian phone pattern 08xx xxx xxxx
      /\b0[789][01]\d{8}\b/,               // Nigerian mobile numbers
      /\+?234\d{10}/,                       // +234 format
      /\b(dm|pm) me\b/i,
      /\boutside (this|the) (app|platform|chat)\b/i,
      /\boff (this|the) (app|platform)\b/i,
    ],
  },
  {
    category: 'off_platform_payment',
    reason: 'All payments must go through Bixcart. Requesting external transfers is not allowed.',
    patterns: [
      /\b(send|transfer|pay|payment) (me |to )?(via|on|through|to)?\s*(opay|palmpay|kuda|gtb|access|zenith|uba|fcmb|sterling|moniepoint|paystack|flutterwave)/i,
      /\b(send|transfer) (the )?(money|cash|funds|payment) (to )?(my )?(account|bank)\b/i,
      /\bbank (transfer|details|account)\b/i,
      /\baccount (number|details)\b/i,
      /\bpay (me )?(directly|outside|off)\b/i,
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
    category: 'harassment',
    reason: 'Threatening or harassing language is not tolerated on Bixcart.',
    patterns: [
      /\b(i will|i'll|gonna|going to)\b.{0,20}\b(beat|fight|kill|hurt|harm|deal with|find you|report you to)/i,
      /\b(stupid|idiot|fool|mumu|olodo|dullard|useless|senseless)\b/i,
    ],
  },
  {
    category: 'prohibited_item',
    reason: 'This item is prohibited on Bixcart.',
    patterns: [
      /\b(sell|selling|buy|buying|available|have|got|supply)\b.{0,25}\b(weed|igbo|loud|colorado|shisha|codeine|tramadol|refnol|mkpuru mmiri|drug|coke|cocaine|heroin|meth)/i,
      /\b(sell|selling|buying|available)\b.{0,25}\b(gun|knife|cutlass|blade|weapon|pistol|rifle|ammo|bullet)/i,
      /\bporn/i,
      /\bsex (tape|video|clip|movie|content)/i,
    ],
  },
  {
    category: 'adult_content',
    reason: 'Adult or sexual content is not allowed on Bixcart.',
    patterns: [
      /\b(hook ?up|link ?up for sex|one night|friends with benefit)/i,
      /\bnude(s)?\b/i,
    ],
  },
];

/**
 * Synchronous keyword check — runs instantly, no API call needed.
 * Returns { flagged, reason, category } immediately.
 */
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
// LAYER 2 — Gemini AI queue (for edge cases the keyword filter misses)
// Drains at 1 request per 4 seconds = safe under 15 req/min free limit
// ─────────────────────────────────────────────────────────────────────────────
const queue = [];
let queueTimer = null;

function enqueueAICheck(text, context, onResult) {
  queue.push({ text, context, onResult });
  if (!queueTimer) {
    queueTimer = setInterval(drainQueue, 4200); // 4.2s = ~14/min, safely under limit
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

// ─────────────────────────────────────────────────────────────────────────────
// PUBLIC API
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Moderate a message.
 * - Keyword check is synchronous and instant.
 * - If it passes keywords, optionally queue for AI (for suspicious-but-ambiguous text).
 * Returns a Promise<{flagged, reason, category}>.
 */
function moderateMessage(content, history = []) {
  // Layer 1: instant keyword check
  const kw = keywordCheck(content);
  if (kw.flagged) return Promise.resolve(kw);

  // Layer 2: only queue for AI if message has certain ambiguous signals
  // This keeps AI calls rare — maybe 1 in 20 messages
  if (process.env.GEMINI_API_KEY && looksAmbiguous(content)) {
    return new Promise(resolve => {
      enqueueAICheck(content, history, resolve);
    });
  }

  return Promise.resolve({ flagged: false, reason: '', category: '' });
}

/**
 * Moderate a listing — always runs both layers since listings are less frequent.
 */
function moderateListing(data) {
  const text = `${data.title} ${data.description}`;

  // Layer 1
  const kw = keywordCheck(text);
  if (kw.flagged) return Promise.resolve(kw);

  // Layer 2: listings are infrequent so AI-check all of them
  if (process.env.GEMINI_API_KEY) {
    return new Promise(resolve => {
      enqueueAICheck(text, [], resolve);
    });
  }

  return Promise.resolve({ flagged: false, reason: '', category: '' });
}

/**
 * Heuristic: should this message get an AI look?
 * Keeps AI calls rare — triggers only on ambiguous signals.
 */
function looksAmbiguous(text) {
  const t = text.toLowerCase();
  return (
    t.includes('@') ||
    t.includes('number') ||
    t.includes('contact') ||
    t.includes('reach') ||
    t.includes('outside') ||
    t.includes('transfer') ||
    t.includes('account') ||
    t.includes('payment') ||
    t.includes('exam') ||
    t.includes('assignment') ||
    /\d{5,}/.test(t)  // any 5+ digit sequence could be a number
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// GEMINI CALLER
// ─────────────────────────────────────────────────────────────────────────────
const SYSTEM_PROMPT = `You are a content moderation AI for Bixcart, a student marketplace at Ajayi Crowther University (ACU), Nigeria.

Flag content that:
- Tries to move conversation off-platform (WhatsApp, Snapchat, Telegram, phone numbers, social handles)
- Requests off-platform payment (bank transfer, OPay, PalmPay, direct account)
- Contains prohibited items (weapons, drugs, alcohol, porn, stolen goods, pirated software)
- Involves academic fraud (exam answers, assignment help for money)
- Is sexually suggestive or harassing
- Violates ACU Christian conduct policy

Do NOT flag: price negotiation, campus meetup arrangements, item condition discussion.

Respond ONLY with JSON: {"flagged": true|false, "reason": "short reason or empty", "category": "contact_bypass|off_platform_payment|prohibited_item|academic_fraud|harassment|adult_content|school_rules or empty"}`;

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

    if (!res.ok) {
      console.warn('[aiMod] Gemini error:', res.status);
      return safe();
    }

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
