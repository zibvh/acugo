const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  email:           { type: String, required: true, unique: true, lowercase: true, trim: true },
  password_hash:   { type: String, required: true },
  full_name:       { type: String, required: true, trim: true },
  role:            { type: String, required: true, enum: ['buyer', 'seller', 'admin'] },
  account_status:  { type: String, enum: ['active', 'warned', 'suspended'], default: 'active' },
  warn_reason:     { type: String, default: '' },
  suspend_reason:  { type: String, default: '' },
  warned_at:       { type: Date, default: null },
  suspended_at:    { type: Date, default: null },
  avatar_url:      { type: String, default: null },
  banner_url:      { type: String, default: null },
  bio:             { type: String, default: '' },
  university:      { type: String, default: 'Ajayi Crowther University' },
  rating:          { type: Number, default: 0 },
  rating_count:    { type: Number, default: 0 },
  is_verified:     { type: Boolean, default: false },
  listing_credits:  { type: Number, default: 1 },
  admin_messages:   { type: [{ content: String, sent_at: Date, read: { type: Boolean, default: false } }], default: [] },
  used_payment_refs: { type: [String], default: [] },
  // Registration profile (filled after signup)
  registration_complete: { type: Boolean, default: false },
  // Seller-specific
  business_name:   { type: String, default: '' },
  // ID verification docs (stored as Cloudinary URLs, admin reviews)
  id_type:         { type: String, default: '' }, // 'school_id' | 'nin' | 'national_id' | 'drivers_license'
  id_front_url:    { type: String, default: null },
  id_back_url:     { type: String, default: null },
  // Web Push subscriptions (array of PushSubscription objects)
  push_subscriptions: { type: [mongoose.Schema.Types.Mixed], default: [] },
  // Email verification
  email_verified:         { type: Boolean, default: false },
  email_verify_token:     { type: String, default: null },
  email_verify_expires:   { type: Date,   default: null },
  // Password reset
  password_reset_token:   { type: String, default: null },
  password_reset_expires: { type: Date,   default: null },
}, { timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } });

const listingSchema = new mongoose.Schema({
  seller_id:       { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  title:           { type: String, required: true, trim: true },
  description:     { type: String, required: true },
  price:           { type: Number, required: true },
  original_price:  { type: Number, default: null },
  category:        { type: String, required: true },
  condition:       { type: String, required: true, enum: ['New','Like New','Good','Fair'] },
  images:          { type: [String], default: [] },
  status:          { type: String, default: 'active', enum: ['active','pending','sold','deleted','flagged'] },
  views:           { type: Number, default: 0 },
  saves:           { type: Number, default: 0 },
  ai_flagged:      { type: Boolean, default: false },
  ai_flag_reason:  { type: String, default: '' },
  ai_flag_category:{ type: String, default: '' },
  ai_flagged_at:   { type: Date, default: null },
  ai_reviewed:     { type: Boolean, default: false },
}, { timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } });

listingSchema.index({ category: 1 });
listingSchema.index({ status: 1 });
listingSchema.index({ seller_id: 1 });
listingSchema.index({ title: 'text', description: 'text' });

const waitlistSchema = new mongoose.Schema({
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
}, { timestamps: { createdAt: 'created_at', updatedAt: false } });

const savedListingSchema = new mongoose.Schema({
  user_id:    { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  listing_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Listing', required: true },
}, { timestamps: { createdAt: 'created_at', updatedAt: false } });

savedListingSchema.index({ user_id: 1, listing_id: 1 }, { unique: true });

const conversationSchema = new mongoose.Schema({
  listing_id:      { type: mongoose.Schema.Types.ObjectId, ref: 'Listing', default: null },
  buyer_id:        { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  seller_id:       { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  last_message:    { type: String, default: null },
  last_message_at: { type: Date, default: Date.now },
  ai_flagged:      { type: Boolean, default: false },
  ai_flag_reason:  { type: String, default: '' },
  ai_flag_category:{ type: String, default: '' },
  ai_flagged_at:   { type: Date, default: null },
  ai_reviewed:     { type: Boolean, default: false },
}, { timestamps: { createdAt: 'created_at', updatedAt: false } });

conversationSchema.index({ buyer_id: 1 });
conversationSchema.index({ seller_id: 1 });

const messageSchema = new mongoose.Schema({
  conversation_id:      { type: mongoose.Schema.Types.ObjectId, ref: 'Conversation', required: true },
  sender_id:            { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  receiver_id:          { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  listing_id:           { type: mongoose.Schema.Types.ObjectId, ref: 'Listing', default: null },
  content:              { type: String, required: true },
  is_read:              { type: Boolean, default: false },
  is_admin_notification:{ type: Boolean, default: false },
  notification_to:      { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
}, { timestamps: { createdAt: 'created_at', updatedAt: false } });

messageSchema.index({ conversation_id: 1 });
messageSchema.index({ receiver_id: 1, is_read: 1 });

const conversationReportSchema = new mongoose.Schema({
  conversation_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Conversation', required: true },
  reporter_id:     { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  reason:          { type: String, required: true, trim: true },
  status:          { type: String, enum: ['pending', 'resolved'], default: 'pending' },
  fault_user_id:   { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  admin_note:      { type: String, default: '' },
  resolved_at:     { type: Date, default: null },
}, { timestamps: { createdAt: 'created_at', updatedAt: false } });

conversationReportSchema.index({ conversation_id: 1 });
conversationReportSchema.index({ status: 1 });

const orderSchema = new mongoose.Schema({
  listing_id:             { type: mongoose.Schema.Types.ObjectId, ref: 'Listing', required: true },
  buyer_id:               { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  seller_id:              { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  amount:                 { type: Number, required: true },
  status:                 { type: String, default: 'pending', enum: ['pending','confirmed','completing','completed','cancelled'] },
  meetup_location:        { type: String, default: null },
  meetup_time:            { type: String, default: null },
  buyer_marked_complete:  { type: Boolean, default: false },
  seller_marked_complete: { type: Boolean, default: false },
  buyer_rating:           { type: Number, default: null, min: 1, max: 5 },
  buyer_review:           { type: String, default: '' },
  buyer_rated_at:         { type: Date, default: null },
}, { timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } });

orderSchema.index({ buyer_id: 1 });
orderSchema.index({ seller_id: 1 });

const User               = mongoose.model('User',               userSchema);
const Listing            = mongoose.model('Listing',            listingSchema);
const Waitlist           = mongoose.model('Waitlist',           waitlistSchema);
const SavedListing       = mongoose.model('SavedListing',       savedListingSchema);
const Conversation       = mongoose.model('Conversation',       conversationSchema);
const Message            = mongoose.model('Message',            messageSchema);
const ConversationReport = mongoose.model('ConversationReport', conversationReportSchema);
const Order              = mongoose.model('Order',              orderSchema);

async function connectDb() {
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error('MONGODB_URI environment variable is not set');
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 10000, socketTimeoutMS: 45000 });
  console.log('  MongoDB connected:', mongoose.connection.host);
}

module.exports = { connectDb, User, Listing, Waitlist, SavedListing, Conversation, Message, ConversationReport, Order };
