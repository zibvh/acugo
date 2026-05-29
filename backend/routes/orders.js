const express = require('express');
const router  = express.Router();
const { Order, Listing, User, SavedListing } = require('../db/database');
const { authMiddleware } = require('../middleware/auth');

// GET /api/orders/stats  — before /:id
router.get('/stats', authMiddleware, async (req, res) => {
  try {
    const uid = req.user.id;
    const [listings, orders] = await Promise.all([
      Listing.find({ seller_id: uid, status: { $ne: 'deleted' } }).lean(),
      Order.find({ seller_id: uid }).lean(),
    ]);
    res.json({
      total_listings:  listings.length,
      active_listings: listings.filter(l => l.status === 'active').length,
      sold_listings:   listings.filter(l => l.status === 'sold').length,
      total_revenue:   orders.filter(o => o.status === 'completed').reduce((s, o) => s + (o.amount || 0), 0),
      total_views:     listings.reduce((s, l) => s + (l.views || 0), 0),
      total_saved:     listings.reduce((s, l) => s + (l.saves || 0), 0),
      pending_orders:  orders.filter(o => o.status === 'pending').length,
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /api/orders/saved
router.get('/saved', authMiddleware, async (req, res) => {
  try {
    const saved = await SavedListing
      .find({ user_id: req.user.id })
      .populate({ path: 'listing_id', populate: { path: 'seller_id', select: 'full_name university rating' } })
      .sort({ created_at: -1 }).lean();

    const results = saved
      .filter(s => s.listing_id && s.listing_id.status !== 'deleted')
      .map(s => {
        const l = s.listing_id;
        return {
          ...l, id: l._id,
          seller_name:       l.seller_id?.full_name,
          seller_university: l.seller_id?.university,
          seller_rating:     l.seller_id?.rating,
        };
      });
    res.json(results);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /api/orders/buying
router.get('/buying', authMiddleware, async (req, res) => {
  try {
    const orders = await Order
      .find({ buyer_id: req.user.id })
      .populate('listing_id', 'title images category')
      .populate('seller_id',  'full_name university')
      .sort({ created_at: -1 }).lean();

    res.json(orders.map(o => ({
      ...o, id: o._id,
      listing_title:    o.listing_id?.title,
      listing_images:   o.listing_id?.images || [],
      category:         o.listing_id?.category,
      seller_name:      o.seller_id?.full_name,
      seller_university:o.seller_id?.university,
    })));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /api/orders/selling
router.get('/selling', authMiddleware, async (req, res) => {
  try {
    const orders = await Order
      .find({ seller_id: req.user.id })
      .populate('listing_id', 'title images category')
      .populate('buyer_id',   'full_name university')
      .sort({ created_at: -1 }).lean();

    res.json(orders.map(o => ({
      ...o, id: o._id,
      listing_title:   o.listing_id?.title,
      listing_images:  o.listing_id?.images || [],
      category:        o.listing_id?.category,
      buyer_name:      o.buyer_id?.full_name,
      buyer_university:o.buyer_id?.university,
    })));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/orders
router.post('/', authMiddleware, async (req, res) => {
  try {
    const { listing_id, meetup_location, meetup_time } = req.body;
    const listing = await Listing.findOne({ _id: listing_id, status: 'active' });
    if (!listing) return res.status(404).json({ error: 'Listing not found or no longer available' });
    if (String(listing.seller_id) === String(req.user.id))
      return res.status(400).json({ error: 'Cannot buy your own listing' });

    const order = await Order.create({
      listing_id, buyer_id: req.user.id, seller_id: listing.seller_id,
      amount: listing.price,
      meetup_location: meetup_location || null,
      meetup_time:     meetup_time     || null,
    });
    await Listing.findByIdAndUpdate(listing_id, { $set: { status: 'pending' } });
    res.json({ ...order.toObject(), id: order._id });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// PUT /api/orders/:id/status
router.put('/:id/status', authMiddleware, async (req, res) => {
  try {
    const { status } = req.body;
    const order = await Order.findById(req.params.id);
    if (!order) return res.status(404).json({ error: 'Order not found' });

    const role = String(order.seller_id) === String(req.user.id) ? 'seller'
               : String(order.buyer_id)  === String(req.user.id) ? 'buyer' : null;
    if (!role) return res.status(403).json({ error: 'Forbidden' });

    const valid = {
      seller: { pending: ['confirmed','cancelled'], confirmed: ['completed','cancelled'] },
      buyer:  { pending: ['cancelled'] },
    };
    if (!valid[role]?.[order.status]?.includes(status))
      return res.status(400).json({ error: 'Invalid status transition' });

    await Order.findByIdAndUpdate(req.params.id, { $set: { status } });

    if (status === 'completed') await Listing.findByIdAndUpdate(order.listing_id, { $set: { status: 'sold' }   });
    if (status === 'cancelled') await Listing.findByIdAndUpdate(order.listing_id, { $set: { status: 'active' } });

    res.json({ success: true, status });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
