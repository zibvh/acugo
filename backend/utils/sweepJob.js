/**
 * Bixcart AI Sweep Job
 * Runs every 26 hours — scans all active listings and recent messages
 * for policy violations and flags anything suspicious.
 */

const { Listing, Conversation, Message, User } = require('../db/database');
const { moderateMessage, moderateListing } = require('./aiModerator');
const { notifyUser } = require('../db/push');

const SWEEP_INTERVAL_MS = 26 * 60 * 60 * 1000; // 26 hours
const BATCH_DELAY_MS    = 5000;                  // 5s between items to stay rate-safe

let sweepRunning = false;

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ── Sweep listings ────────────────────────────────────────────────────────────
async function sweepListings() {
  const listings = await Listing.find({
    status:     'active',
    ai_flagged: { $ne: true },
  }).select('_id title description category seller_id').lean();

  console.log(`[sweep] Checking ${listings.length} active listings…`);
  let flagged = 0;

  for (const l of listings) {
    try {
      const result = await moderateListing({
        title:       l.title,
        description: l.description,
        category:    l.category,
      });

      if (result.flagged) {
        flagged++;
        await Listing.findByIdAndUpdate(l._id, {
          $set: {
            status:           'flagged',
            ai_flagged:       true,
            ai_flag_reason:   `[Sweep] ${result.reason}`,
            ai_flag_category: result.category,
            ai_flagged_at:    new Date(),
          },
        });

        notifyUser(String(l.seller_id), {
          title: '⚠️ Listing Hidden by AI',
          body:  `Your listing "${l.title}" was flagged during a routine sweep: ${result.reason}. It has been hidden pending admin review.`,
          type:  'ai_flag',
        }).catch(() => {});

        console.log(`[sweep] Flagged listing "${l.title}" — ${result.reason}`);
      }
    } catch (e) {
      console.warn(`[sweep] Error checking listing ${l._id}:`, e.message);
    }

    await sleep(BATCH_DELAY_MS);
  }

  console.log(`[sweep] Listings done — ${flagged}/${listings.length} flagged`);
}

// ── Sweep messages ────────────────────────────────────────────────────────────
async function sweepMessages() {
  const since = new Date(Date.now() - SWEEP_INTERVAL_MS * 1.1); // slight overlap

  // Get recent messages from non-flagged conversations
  const messages = await Message.find({
    created_at:            { $gte: since },
    is_admin_notification: { $ne: true },
    triggered_ai_flag:     { $ne: true },
  }).populate({
    path:   'conversation_id',
    select: 'ai_flagged buyer_id seller_id',
  }).lean();

  // Filter out messages from already-flagged conversations
  const toCheck = messages.filter(m => m.conversation_id && !m.conversation_id.ai_flagged);

  console.log(`[sweep] Checking ${toCheck.length} recent messages…`);
  let flagged = 0;

  for (const m of toCheck) {
    try {
      const result = await moderateMessage(m.content, []);
      if (result.flagged) {
        flagged++;
        const conv = m.conversation_id;

        await Promise.all([
          // Flag conversation
          require('../db/database').Conversation.findByIdAndUpdate(conv._id, {
            $set: {
              ai_flagged:       true,
              ai_flag_reason:   `[Sweep] ${result.reason}`,
              ai_flag_category: result.category,
              ai_flagged_at:    new Date(),
            },
          }),
          // Mark triggering message
          Message.findByIdAndUpdate(m._id, { $set: { triggered_ai_flag: true } }),
        ]);

        const flagMsg = `A message in your conversation was flagged during a routine sweep: ${result.reason}. An admin will review it.`;
        [String(conv.buyer_id), String(conv.seller_id)].forEach(uid => {
          notifyUser(uid, {
            title: '⚠️ Conversation Flagged',
            body:  flagMsg,
            type:  'ai_flag',
          }).catch(() => {});
        });

        console.log(`[sweep] Flagged message in conv ${conv._id} — ${result.reason}`);
      }
    } catch (e) {
      console.warn(`[sweep] Error checking message ${m._id}:`, e.message);
    }

    await sleep(BATCH_DELAY_MS);
  }

  console.log(`[sweep] Messages done — ${flagged}/${toCheck.length} flagged`);
}

// ── Main sweep ────────────────────────────────────────────────────────────────
async function runSweep() {
  if (sweepRunning) { console.log('[sweep] Already running, skipping'); return; }
  sweepRunning = true;
  console.log(`[sweep] Starting AI sweep — ${new Date().toISOString()}`);
  try {
    await sweepListings();
    await sweepMessages();
    console.log(`[sweep] Sweep complete — ${new Date().toISOString()}`);
  } catch (e) {
    console.error('[sweep] Fatal error:', e.message);
  } finally {
    sweepRunning = false;
  }
}

// ── Schedule ──────────────────────────────────────────────────────────────────
function startSweepScheduler() {
  if (!process.env.GEMINI_API_KEY) {
    console.log('[sweep] GEMINI_API_KEY not set — AI sweep disabled');
    return;
  }

  // Run first sweep 2 minutes after server starts (let DB settle)
  setTimeout(runSweep, 2 * 60 * 1000);

  // Then every 26 hours
  setInterval(runSweep, SWEEP_INTERVAL_MS);

  console.log(`[sweep] Scheduler started — first sweep in 2 min, then every 26h`);
}

module.exports = { startSweepScheduler, runSweep };
