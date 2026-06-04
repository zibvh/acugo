/**
 * AI Content Moderation — Bixcart
 * Uses Google Gemini 2.0 Flash (FREE tier: 15 req/min, 1,500/day)
 * Get your free key: https://aistudio.google.com/app/apikey
 */

const fetch = require('node-fetch');

const SYSTEM_PROMPT = `You are a strict content moderation AI for Bixcart — an online marketplace exclusively for students of Ajayi Crowther University (ACU), Oyo, Nigeria.

PLATFORM RULES:
- Bixcart is for buying/selling physical goods between ACU students only
- All meetups must be on campus
- No services, only physical goods
- Prices in Nigerian Naira only
- All conversations must happen strictly on this platform. Any attempt to move conversation elsewhere is a violation.

ACU SCHOOL RULES:
- Christian university — no sexual content, adult material, or romantic solicitation
- No alcohol, tobacco, or drugs
- No gambling or betting
- No harassment, bullying, or threats
- No sharing personal contact info to bypass platform (phone numbers, WhatsApp, Instagram, Snapchat, Telegram links or handles)
- No academic fraud (selling assignments, exam papers, answers)

PROHIBITED ITEMS:
- Weapons of any kind
- Drugs or prescription medication (without prescription)
- Stolen or counterfeit goods
- Pirated software or cracked accounts
- Pornographic material
- Alcohol/tobacco products
- Exam papers or assignment answers for sale
- Political campaign materials

SUSPICIOUS MESSAGE PATTERNS:
- Moving conversation off-platform: "chat on WhatsApp", "message me on snap", "my number is", "add me on", "DM me on", "@username", any social handle
- Sharing phone/WhatsApp/social media handles in any form
- Threatening or aggressive language
- Scam patterns ("send first", "my agent will come", "I'm not on campus", "pay me directly")
- Sexual or romantic solicitation
- Academic dishonesty offers

Respond ONLY with valid JSON, no other text:
{"flagged": true|false, "reason": "human-readable reason or empty string", "category": "one of: prohibited_item|scam_pattern|contact_bypass|academic_fraud|harassment|adult_content|drug_alcohol|school_rules|off_platform_payment or empty string"}

Normal price negotiation, meetup location on campus, and item condition questions are fine — do NOT flag those.`;

async function moderateMessage(content, history = []) {
  if (!process.env.GEMINI_API_KEY) return safe();
  const contextLines = history.slice(-4).map(m => `[${m.role}]: ${m.content}`).join('\n');
  const prompt = `${SYSTEM_PROMPT}\n\nModerate this Bixcart chat message:\n${contextLines ? `Context:\n${contextLines}\n\n` : ''}Message: "${content}"\n\nJSON only:`;
  return callGemini(prompt);
}

async function moderateListing(data) {
  if (!process.env.GEMINI_API_KEY) return safe();
  const prompt = `${SYSTEM_PROMPT}\n\nModerate this Bixcart product listing:\nTitle: "${data.title}"\nCategory: "${data.category || ''}"\nDescription: "${data.description}"\n\nJSON only:`;
  return callGemini(prompt);
}

async function callGemini(prompt, attempt = 1) {
  try {
    if (!process.env.GEMINI_API_KEY) {
      console.log('[aiMod] GEMINI_API_KEY not set — skipping');
      return safe();
    }

    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${process.env.GEMINI_API_KEY}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { maxOutputTokens: 150, temperature: 0.1 },
      }),
    });

    // Rate limited — wait and retry (max 3 attempts)
    if (res.status === 429) {
      if (attempt >= 3) {
        console.warn('[aiMod] Rate limit hit after 3 attempts — skipping');
        return safe();
      }
      const wait = attempt * 4000; // 4s, 8s
      console.log(`[aiMod] Rate limited, retrying in ${wait / 1000}s (attempt ${attempt}/3)…`);
      await new Promise(r => setTimeout(r, wait));
      return callGemini(prompt, attempt + 1);
    }

    if (!res.ok) {
      const errText = await res.text();
      console.warn('[aiMod] Gemini error:', res.status, errText.slice(0, 200));
      return safe();
    }

    const data   = await res.json();
    const text   = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || '{}';
    const clean  = text.replace(/^```json|^```|```$/gm, '').trim();
    console.log('[aiMod] Result:', clean);
    const parsed = JSON.parse(clean);
    return { flagged: Boolean(parsed.flagged), reason: parsed.reason || '', category: parsed.category || '' };

  } catch (e) {
    console.warn('[aiMod] Error:', e.message);
    return safe();
  }
}

function safe() { return { flagged: false, reason: '', category: '' }; }

module.exports = { moderateMessage, moderateListing };
