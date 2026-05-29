const express = require('express');
const router  = express.Router();
const { Conversation, Message, Listing, User } = require('../db/database');
const { authMiddleware } = require('../middleware/auth');
const { notifyUser } = require('../db/push');

// GET /api/messages/conversations
router.get('/conversations', authMiddleware, async (req, res) => {
  try {
    const uid = req.user.id;
    const convs = await Conversation
      .find({ $or: [{ buyer_id: uid }, { seller_id: uid }] })
      .populate('buyer_id',  'full_name')
      .populate('seller_id', 'full_name')
      .populate('listing_id','title images')
      .sort({ last_message_at: -1 })
      .lean();

    const enriched = await Promise.all(convs.map(async c => {
      const isbuyer  = String(c.buyer_id?._id)  === String(uid);
      const otherDoc = isbuyer ? c.seller_id : c.buyer_id;
      const unread   = await Message.countDocuments({ conversation_id: c._id, receiver_id: uid, is_read: false });
      return {
        ...c, id: c._id,
        other_user:     { id: otherDoc?._id, name: otherDoc?.full_name || 'Unknown' },
        listing_title:  c.listing_id?.title  || null,
        listing_id:     c.listing_id?._id    || null,
        listing_images: c.listing_id?.images || [],
        unread_count:   unread,
      };
    }));
    res.json(enriched);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /api/messages/conversations/:id
router.get('/conversations/:id', authMiddleware, async (req, res) => {
  try {
    const uid = req.user.id;
    const conv = await Conversation.findOne({
      _id: req.params.id,
      $or: [{ buyer_id: uid }, { seller_id: uid }],
    }).lean();
    if (!conv) return res.status(404).json({ error: 'Conversation not found' });

    const messages = await Message
      .find({ conversation_id: req.params.id })
      .populate('sender_id', 'full_name')
      .sort({ created_at: 1 }).lean();

    // Mark as read
    await Message.updateMany(
      { conversation_id: req.params.id, receiver_id: uid },
      { $set: { is_read: true } }
    );

    res.json({
      conversation: { ...conv, id: conv._id },
      messages: messages.map(m => ({ ...m, id: m._id, sender_name: m.sender_id?.full_name })),
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/messages/send
router.post('/send', authMiddleware, async (req, res) => {
  try {
    const uid = req.user.id;
    const { receiver_id, listing_id, content, conversation_id } = req.body;
    if (!content?.trim()) return res.status(400).json({ error: 'Message cannot be empty' });

    let convDoc;

    if (conversation_id) {
      convDoc = await Conversation.findOne({
        _id: conversation_id,
        $or: [{ buyer_id: uid }, { seller_id: uid }],
      });
      if (!convDoc) return res.status(404).json({ error: 'Conversation not found' });
    } else {
      if (!receiver_id) return res.status(400).json({ error: 'receiver_id required' });

      // Find existing conversation for this listing + pair
      const orPairs = [
        { buyer_id: uid, seller_id: receiver_id },
        { buyer_id: receiver_id, seller_id: uid },
      ];
      const qry = listing_id
        ? { listing_id, $or: orPairs }
        : { $or: orPairs };

      convDoc = await Conversation.findOne(qry);

      if (!convDoc) {
        const listing = listing_id ? await Listing.findById(listing_id) : null;
        const sellerId = listing ? String(listing.seller_id) : receiver_id;
        const buyerId  = String(uid);
        convDoc = await Conversation.create({
          listing_id: listing_id || null,
          buyer_id:  buyerId,
          seller_id: sellerId,
        });
      }
    }

    // Determine receiver
    const receiverId = String(convDoc.buyer_id) === String(uid)
      ? String(convDoc.seller_id)
      : String(convDoc.buyer_id);

    const msg = await Message.create({
      conversation_id: convDoc._id,
      sender_id:   uid,
      receiver_id: receiverId,
      listing_id:  listing_id || null,
      content:     content.trim(),
    });

    await Conversation.findByIdAndUpdate(convDoc._id, {
      $set: { last_message: content.trim().slice(0, 100), last_message_at: new Date() },
    });

    const populated = await Message.findById(msg._id).populate('sender_id', 'full_name').lean();

    // Push notification to receiver
    const senderName = populated.sender_id?.full_name || 'Someone';
    notifyUser(receiverId, {
      title: `New message from ${senderName}`,
      body: content.trim().slice(0, 100),
      type: 'message',
      tag: `msg-${convDoc._id}`,
      url: `/pages/messages.html?conv=${convDoc._id}`,
    }).catch(() => {}); // fire-and-forget

    res.json({
      message: { ...populated, id: populated._id, sender_name: populated.sender_id?.full_name },
      conversation_id: convDoc._id,
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
