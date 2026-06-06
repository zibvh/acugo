const express = require('express');
const router  = express.Router();
const { Listing, User, SavedListing } = require('../db/database');
const { authMiddleware, optionalAuth } = require('../middleware/auth');
const { notifyUser } = require('../db/push');
const { moderateListing } = require('../utils/aiModerator');

function lean(doc) {
  if (!doc) return null;
  const o = doc.toObject ? doc.toObject() : { ...doc };
  o.id = o._id; return o;
}

// GET /api/listings/user/:userId  — before /:id
router.get('/user/:userId', async (req, res) => {
  try {
    const listings = await Listing
      .find({ seller_id: req.params.userId, status: { $ne: 'deleted' } })
      .sort({ created_at: -1 }).lean();
    res.json(listings.map(l => ({ ...l, id: l._id })));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /api/listings
router.get('/', optionalAuth, async (req, res) => {
  try {
    const { q, category, condition, min_price, max_price, sort = 'newest', page = 1, limit = 12 } = req.query;

    const filter = { status: 'active' };
    if (category && category !== 'All') filter.category = category;
    if (condition) filter.condition = condition;
    if (min_price || max_price) {
      filter.price = {};
      if (min_price) filter.price.$gte = parseFloat(min_price);
      if (max_price) filter.price.$lte = parseFloat(max_price);
    }
    if (q) filter.$text = { $search: q };

    const sortMap = {
      newest:     { created_at: -1 },
      oldest:     { created_at:  1 },
      price_asc:  { price:  1 },
      price_desc: { price: -1 },
      popular:    { views: -1 },
    };

    const skip  = (parseInt(page) - 1) * parseInt(limit);
    const total = await Listing.countDocuments(filter);

    const listings = await Listing
      .find(filter)
      .populate('seller_id', 'full_name rating is_verified')
      .sort(sortMap[sort] || { created_at: -1 })
      .skip(skip).limit(parseInt(limit)).lean();

    const enriched = listings.map(l => ({
      ...l, id: l._id,
      seller_id:       l.seller_id?._id || l.seller_id,
      seller_name:     l.seller_id?.full_name,
      seller_rating:   l.seller_id?.rating,
      seller_verified: l.seller_id?.is_verified,
    }));

    res.json({ listings: enriched, total, page: parseInt(page), pages: Math.ceil(total / parseInt(limit)) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /api/listings/saved — get current user's saved listings
router.get('/saved', authMiddleware, async (req, res) => {
  try {
    const saves = await SavedListing.find({ user_id: req.user.id })
      .populate({
        path: 'listing_id',
        populate: { path: 'seller_id', select: 'full_name rating rating_count is_verified' },
      })
      .sort({ created_at: -1 }).lean();

    const listings = saves
      .filter(s => s.listing_id && s.listing_id.status === 'active')
      .map(s => {
        const l = s.listing_id;
        return {
          ...l, id: l._id,
          saved_at:        s.created_at,
          seller_name:     l.seller_id?.full_name,
          seller_rating:   l.seller_id?.rating,
          seller_verified: l.seller_id?.is_verified,
          seller_id:       l.seller_id?._id || l.seller_id,
          is_saved:        true,
        };
      });
    res.json({ listings });
  } catch (e) { res.status(500).json({ error: e.message }); }
});
router.get('/:id', optionalAuth, async (req, res) => {
  try {
    const listing = await Listing
      .findById(req.params.id)
      .populate('seller_id', 'full_name rating rating_count bio is_verified created_at')
      .lean();

    if (!listing) return res.status(404).json({ error: 'Listing not found' });

    Listing.findByIdAndUpdate(req.params.id, { $inc: { views: 1 } }).exec();

    let is_saved = false;
    if (req.user) {
      const sv = await SavedListing.findOne({ user_id: req.user.id, listing_id: req.params.id });
      is_saved = !!sv;
    }

    const related = await Listing
      .find({ category: listing.category, _id: { $ne: req.params.id }, status: 'active' })
      .populate('seller_id', 'full_name')
      .limit(4).lean();

    const s = listing.seller_id || {};
    res.json({
      ...listing, id: listing._id,
      seller_name:         s.full_name,
      seller_rating:       s.rating,
      seller_rating_count: s.rating_count,
      seller_bio:          s.bio,
      seller_verified:     s.is_verified,
      seller_joined:       s.created_at,
      is_saved,
      related: related.map(r => ({ ...r, id: r._id, seller_name: r.seller_id?.full_name })),
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/listings — seller only, must have credits
router.post('/', authMiddleware, async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ error: 'User not found' });
    if (user.role !== 'seller') return res.status(403).json({ error: 'Only sellers can create listings' });
    if (user.listing_credits < 1) return res.status(403).json({ error: 'No listing credits. Please purchase more.' });

    const { title, description, price, original_price, category, condition, images } = req.body;
    if (!title || !description || !price || !category || !condition)
      return res.status(400).json({ error: 'Missing required fields' });

    const listing = await Listing.create({
      seller_id: req.user.id, title, description,
      price: parseFloat(price),
      original_price: original_price ? parseFloat(original_price) : null,
      category, condition,
      images: Array.isArray(images) ? images : [],
    });

    // Deduct one credit
    await User.findByIdAndUpdate(req.user.id, { $inc: { listing_credits: -1 } });

    // ── AI moderation (non-blocking) ─────────────────────────────────────────
    setImmediate(async () => {
      try {
        const result = await moderateListing({ title, description, category });
        if (result.flagged) {
          await Listing.findByIdAndUpdate(listing._id, {
            $set: {
              status:           'flagged',
              ai_flagged:       true,
              ai_flag_reason:   result.reason,
              ai_flag_category: result.category,
              ai_flagged_at:    new Date(),
            },
          });
          notifyUser(String(req.user.id), {
            title: '⚠️ Listing Hidden by AI',
            body:  `Your listing "${title}" was flagged: ${result.reason}. It has been hidden pending admin review.`,
            type:  'ai_flag',
          }).catch(() => {});
        }
      } catch(e) { console.warn('[AI mod] listing check failed:', e.message); }
    });

    res.json({ ...listing.toObject(), id: listing._id });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

const EDIT_LOCK_MS = 90 * 60 * 1000; // 90 minutes

// PUT /api/listings/:id
router.put('/:id', authMiddleware, async (req, res) => {
  try {
    const listing = await Listing.findById(req.params.id);
    if (!listing) return res.status(404).json({ error: 'Not found' });
    if (String(listing.seller_id) !== String(req.user.id)) return res.status(403).json({ error: 'Forbidden' });
    if (listing.ai_flagged) return res.status(403).json({ error: 'This listing has been flagged by our AI and cannot be edited until an admin reviews it.' });

    const ageMs = Date.now() - new Date(listing.created_at).getTime();
    if (ageMs > EDIT_LOCK_MS)
      return res.status(403).json({ error: 'Listings can only be edited within 90 minutes of being created.' });

    const { title, description, price, original_price, category, condition, status, images } = req.body;
    const updated = await Listing.findByIdAndUpdate(
      req.params.id,
      { $set: { title, description, price: parseFloat(price), original_price: original_price ? parseFloat(original_price) : null, category, condition, ...(status ? { status } : {}), ...(Array.isArray(images) ? { images } : {}) } },
      { new: true }
    ).lean();
    res.json({ ...updated, id: updated._id });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// DELETE /api/listings/:id
router.delete('/:id', authMiddleware, async (req, res) => {
  try {
    const listing = await Listing.findById(req.params.id);
    if (!listing) return res.status(404).json({ error: 'Not found' });
    if (String(listing.seller_id) !== String(req.user.id)) return res.status(403).json({ error: 'Forbidden' });
    if (listing.ai_flagged) return res.status(403).json({ error: 'This listing has been flagged by our AI and cannot be deleted until an admin reviews it.' });
    await Listing.findByIdAndUpdate(req.params.id, { $set: { status: 'deleted' } });
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/listings/:id/save — buyers only
router.post('/:id/save', authMiddleware, async (req, res) => {
  try {
    const existing = await SavedListing.findOne({ user_id: req.user.id, listing_id: req.params.id });
    if (existing) {
      await SavedListing.deleteOne({ _id: existing._id });
      await Listing.findByIdAndUpdate(req.params.id, { $inc: { saves: -1 } });
      res.json({ saved: false });
    } else {
      await SavedListing.create({ user_id: req.user.id, listing_id: req.params.id });
      await Listing.findByIdAndUpdate(req.params.id, { $inc: { saves: 1 } });

      // Notify seller
      const listing = await Listing.findById(req.params.id).lean();
      const liker   = await User.findById(req.user.id).lean();
      if (listing?.seller_id && String(listing.seller_id) !== String(req.user.id)) {
        notifyUser(String(listing.seller_id), {
          title: 'Someone liked your listing',
          body: `${liker?.full_name || 'A buyer'} saved "${listing.title}"`,
          type: 'like',
          tag: `like-${listing._id}`,
          url: `/pages/listing.html?id=${listing._id}`,
        }).catch(() => {});
      }

      res.json({ saved: true });
    }
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
