const express    = require('express');
const router     = express.Router();
const bcrypt     = require('bcryptjs');
const jwt        = require('jsonwebtoken');
const crypto     = require('crypto');
const rateLimit  = require('express-rate-limit');
const { User }   = require('../db/database');
const { authMiddleware } = require('../middleware/auth');
const { sendVerificationEmail, sendPasswordResetEmail } = require('../utils/email');

// ─── Rate limiters ────────────────────────────────────────────────────────────
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10,
  message: { error: 'Too many attempts, please try again in 15 minutes.' },
  standardHeaders: true,
  legacyHeaders: false,
});

const forgotLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 5,
  message: { error: 'Too many password reset requests. Try again in an hour.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// ─── Helpers ──────────────────────────────────────────────────────────────────
function signToken(user) {
  return jwt.sign(
    { id: user._id, email: user.email, full_name: user.full_name, role: user.role },
    process.env.JWT_SECRET,
    { expiresIn: '7d' }
  );
}

function safeUser(u) {
  const obj = u.toObject ? u.toObject() : { ...u };
  delete obj.password_hash;
  delete obj.email_verify_token;
  delete obj.email_verify_expires;
  delete obj.password_reset_token;
  delete obj.password_reset_expires;
  obj.id = obj._id;
  return obj;
}

function randomToken() {
  return crypto.randomBytes(32).toString('hex');
}

const PASSWORD_MIN = 8;
const PASSWORD_REGEX = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{8,}$/;

function validatePassword(password) {
  if (!password || password.length < PASSWORD_MIN)
    return `Password must be at least ${PASSWORD_MIN} characters`;
  if (!PASSWORD_REGEX.test(password))
    return 'Password must contain uppercase, lowercase, and a number';
  return null;
}

// ─── POST /api/auth/register ──────────────────────────────────────────────────
router.post('/register', authLimiter, async (req, res) => {
  try {
    const { email, password, confirm_password, full_name, role } = req.body;

    if (!email || !password || !confirm_password || !full_name || !role)
      return res.status(400).json({ error: 'All fields are required' });

    if (!['buyer', 'seller'].includes(role))
      return res.status(400).json({ error: 'Role must be buyer or seller' });

    // Password strength
    const pwErr = validatePassword(password);
    if (pwErr) return res.status(400).json({ error: pwErr });

    // Confirm password
    if (password !== confirm_password)
      return res.status(400).json({ error: 'Passwords do not match' });

    const existing = await User.findOne({ email: email.toLowerCase() });
    if (existing) return res.status(409).json({ error: 'Email already registered' });

    const verifyToken   = randomToken();
    const verifyExpires = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24h

    const user = await User.create({
      email: email.toLowerCase(),
      full_name,
      role,
      password_hash:         bcrypt.hashSync(password, 12),
      listing_credits:       role === 'seller' ? 1 : 0,
      registration_complete: false,
      email_verified:        false,
      email_verify_token:    verifyToken,
      email_verify_expires:  verifyExpires,
    });

    // Send verification email (non-blocking — don't fail registration if mail fails)
    sendVerificationEmail(user.email, verifyToken).catch(err =>
      console.error('[email] Failed to send verification email:', err.message)
    );

    res.json({
      token: signToken(user),
      user: safeUser(user),
      message: 'Account created. Please check your email to verify your address.',
    });
  } catch (e) {
    if (e.code === 11000) return res.status(409).json({ error: 'Email already registered' });
    res.status(500).json({ error: e.message });
  }
});

// ─── POST /api/auth/login ─────────────────────────────────────────────────────
router.post('/login', authLimiter, async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password)
      return res.status(400).json({ error: 'Email and password required' });

    const user = await User.findOne({ email: email.toLowerCase() });
    if (!user || !bcrypt.compareSync(password, user.password_hash))
      return res.status(401).json({ error: 'Invalid credentials' });

    if (user.account_status === 'suspended')
      return res.status(403).json({ error: 'Your account has been suspended. Contact support for assistance.' });

    res.json({ token: signToken(user), user: safeUser(user) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── GET /api/auth/verify-email?token=… ──────────────────────────────────────
router.get('/verify-email', async (req, res) => {
  try {
    const { token } = req.query;
    if (!token) return res.status(400).json({ error: 'Token is required' });

    const user = await User.findOne({
      email_verify_token:   token,
      email_verify_expires: { $gt: new Date() },
    });

    if (!user) return res.status(400).json({ error: 'Verification link is invalid or has expired' });

    await User.findByIdAndUpdate(user._id, {
      $set: {
        email_verified:       true,
        email_verify_token:   null,
        email_verify_expires: null,
      },
    });

    res.json({ success: true, message: 'Email verified successfully' });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── POST /api/auth/resend-verification ──────────────────────────────────────
router.post('/resend-verification', authLimiter, async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: 'Email is required' });

    const user = await User.findOne({ email: email.toLowerCase() });

    // Always respond the same to prevent user enumeration
    if (!user || user.email_verified) {
      return res.json({ message: 'If that email is registered and unverified, a new link has been sent.' });
    }

    const verifyToken   = randomToken();
    const verifyExpires = new Date(Date.now() + 24 * 60 * 60 * 1000);

    await User.findByIdAndUpdate(user._id, {
      $set: { email_verify_token: verifyToken, email_verify_expires: verifyExpires },
    });

    sendVerificationEmail(user.email, verifyToken).catch(err =>
      console.error('[email] Failed to resend verification email:', err.message)
    );

    res.json({ message: 'If that email is registered and unverified, a new link has been sent.' });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── POST /api/auth/forgot-password ──────────────────────────────────────────
router.post('/forgot-password', forgotLimiter, async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: 'Email is required' });

    const user = await User.findOne({ email: email.toLowerCase() });

    // Always same response to prevent user enumeration
    const genericMsg = { message: 'If that email is registered, a password reset link has been sent.' };

    if (!user) return res.json(genericMsg);

    const resetToken   = randomToken();
    const resetExpires = new Date(Date.now() + 60 * 60 * 1000); // 1h

    await User.findByIdAndUpdate(user._id, {
      $set: {
        password_reset_token:   resetToken,
        password_reset_expires: resetExpires,
      },
    });

    sendPasswordResetEmail(user.email, resetToken).catch(err =>
      console.error('[email] Failed to send password reset email:', err.message)
    );

    res.json(genericMsg);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── POST /api/auth/reset-password ───────────────────────────────────────────
router.post('/reset-password', authLimiter, async (req, res) => {
  try {
    const { token, password, confirm_password } = req.body;
    if (!token || !password || !confirm_password)
      return res.status(400).json({ error: 'All fields are required' });

    if (password !== confirm_password)
      return res.status(400).json({ error: 'Passwords do not match' });

    const pwErr = validatePassword(password);
    if (pwErr) return res.status(400).json({ error: pwErr });

    const user = await User.findOne({
      password_reset_token:   token,
      password_reset_expires: { $gt: new Date() },
    });

    if (!user) return res.status(400).json({ error: 'Reset link is invalid or has expired' });

    await User.findByIdAndUpdate(user._id, {
      $set: {
        password_hash:          bcrypt.hashSync(password, 12),
        password_reset_token:   null,
        password_reset_expires: null,
      },
    });

    res.json({ success: true, message: 'Password reset successfully. You can now sign in.' });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── GET /api/auth/vapid-public-key ──────────────────────────────────────────
router.get('/vapid-public-key', (req, res) => {
  const key = process.env.VAPID_PUBLIC_KEY;
  if (!key) return res.status(404).json({ error: 'Push not configured' });
  res.json({ publicKey: key });
});

// ─── GET /api/auth/me ─────────────────────────────────────────────────────────
router.get('/me', authMiddleware, async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select('-password_hash -email_verify_token -password_reset_token');
    if (!user) return res.status(404).json({ error: 'User not found' });
    const obj = user.toObject(); obj.id = obj._id;
    res.json(obj);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── PUT /api/auth/complete-registration ─────────────────────────────────────
router.put('/complete-registration', authMiddleware, async (req, res) => {
  try {
    const { full_name, business_name, id_type, id_front_url, id_back_url } = req.body;

    if (!full_name || !id_type || !id_front_url || !id_back_url)
      return res.status(400).json({ error: 'Full name, ID type and both ID photos are required' });

    const update = { full_name, id_type, id_front_url, id_back_url, registration_complete: true };
    if (business_name !== undefined) update.business_name = business_name;

    const user = await User.findByIdAndUpdate(
      req.user.id, { $set: update }, { new: true }
    ).select('-password_hash -email_verify_token -password_reset_token');

    const obj = user.toObject(); obj.id = obj._id;
    res.json(obj);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── PUT /api/auth/profile ────────────────────────────────────────────────────
router.put('/profile', authMiddleware, async (req, res) => {
  try {
    const { full_name, bio, business_name, university, avatar_url, banner_url } = req.body;
    const update = { full_name, bio };
    if (business_name !== undefined) update.business_name = business_name;
    if (university   !== undefined) update.university     = university;
    if (avatar_url   !== undefined) update.avatar_url     = avatar_url;
    if (banner_url   !== undefined) update.banner_url     = banner_url;
    const user = await User.findByIdAndUpdate(
      req.user.id, { $set: update }, { new: true }
    ).select('-password_hash -email_verify_token -password_reset_token');
    const obj = user.toObject(); obj.id = obj._id;
    res.json(obj);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── POST /api/auth/credits/verify ───────────────────────────────────────────
router.post('/credits/verify', authMiddleware, async (req, res) => {
  try {
    const { reference, credits } = req.body;
    if (!reference) return res.status(400).json({ error: 'reference required' });

    const paystackRes  = await fetch(`https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`, {
      headers: { Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}` },
    });
    const paystackData = await paystackRes.json();

    if (!paystackData.status || paystackData.data?.status !== 'success')
      return res.status(400).json({ error: 'Payment not verified' });

    const existing = await User.findOne({ used_payment_refs: reference });
    if (existing) return res.status(409).json({ error: 'Payment reference already used' });

    const CREDIT_TIERS = [
      { amountKobo: 60000,   credits: 1  },
      { amountKobo: 190000,  credits: 3  },
      { amountKobo: 600000,  credits: 10 },
      { amountKobo: 1650000, credits: 30 },
    ];
    const paidAmount  = paystackData.data.amount;
    const tier        = CREDIT_TIERS.find(t => t.amountKobo === paidAmount);
    const creditAmount = tier ? tier.credits : (credits ? parseInt(credits) : null);

    if (!creditAmount || creditAmount < 1)
      return res.status(400).json({ error: 'Could not determine credits for this payment amount' });

    const user = await User.findByIdAndUpdate(
      req.user.id,
      { $inc: { listing_credits: creditAmount }, $addToSet: { used_payment_refs: reference } },
      { new: true }
    ).select('-password_hash -email_verify_token -password_reset_token');

    const obj = user.toObject(); obj.id = obj._id;
    res.json(obj);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
