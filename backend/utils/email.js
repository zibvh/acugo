const nodemailer = require('nodemailer');

function createTransport() {
  const port   = parseInt(process.env.SMTP_PORT || '587');
  const secure = port === 465; // only port 465 uses SSL from the start; 587 uses STARTTLS

  const transporter = nodemailer.createTransport({
    host:   process.env.SMTP_HOST || 'smtp.gmail.com',
    port,
    secure,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });

  return transporter;
}

// FRONTEND_URL may be a comma-separated list (e.g. "http://localhost:3001, https://plazza.onrender.com")
// Always use the production URL (last entry) for email links
function getBaseUrl() {
  const raw = process.env.FRONTEND_URL || 'https://plazza.onrender.com';
  const urls = raw.split(',').map(u => u.trim()).filter(Boolean);
  // Prefer https URL; fall back to last entry
  return urls.find(u => u.startsWith('https://')) || urls[urls.length - 1];
}

const FROM = process.env.EMAIL_FROM || '"Plazza" <no-reply@plazza.onrender.com>';

async function sendVerificationEmail(to, token) {
  const BASE_URL = getBaseUrl();
  const link = `${BASE_URL}/pages/auth.html?action=verify&token=${token}`;
  const transporter = createTransport();

  await transporter.sendMail({
    from: FROM,
    to,
    subject: 'Verify your Plazza email',
    html: `
      <div style="font-family:sans-serif;max-width:480px;margin:auto;padding:32px;background:#fafafa;border-radius:12px;">
        <h2 style="color:#1a1a1a;margin-bottom:8px;">Verify your email</h2>
        <p style="color:#555;line-height:1.6;">
          Thanks for joining Plazza! Click the button below to confirm your email address.
          This link expires in <strong>24 hours</strong>.
        </p>
        <a href="${link}"
           style="display:inline-block;margin:24px 0;padding:14px 28px;background:#c8522a;color:white;text-decoration:none;border-radius:8px;font-weight:600;font-size:15px;">
          Verify Email
        </a>
        <p style="color:#999;font-size:13px;">
          Or paste this link in your browser:<br>
          <a href="${link}" style="color:#c8522a;">${link}</a>
        </p>
        <p style="color:#bbb;font-size:12px;margin-top:32px;border-top:1px solid #eee;padding-top:16px;">
          If you didn't create a Plazza account, you can safely ignore this email.
        </p>
      </div>
    `,
  });
}

async function sendPasswordResetEmail(to, token) {
  const BASE_URL = getBaseUrl();
  const link = `${BASE_URL}/pages/auth.html?action=reset&token=${token}`;
  const transporter = createTransport();

  await transporter.sendMail({
    from: FROM,
    to,
    subject: 'Reset your Plazza password',
    html: `
      <div style="font-family:sans-serif;max-width:480px;margin:auto;padding:32px;background:#fafafa;border-radius:12px;">
        <h2 style="color:#1a1a1a;margin-bottom:8px;">Reset your password</h2>
        <p style="color:#555;line-height:1.6;">
          We received a request to reset your Plazza password. Click the button below.
          This link expires in <strong>1 hour</strong>.
        </p>
        <a href="${link}"
           style="display:inline-block;margin:24px 0;padding:14px 28px;background:#c8522a;color:white;text-decoration:none;border-radius:8px;font-weight:600;font-size:15px;">
          Reset Password
        </a>
        <p style="color:#999;font-size:13px;">
          Or paste this link in your browser:<br>
          <a href="${link}" style="color:#c8522a;">${link}</a>
        </p>
        <p style="color:#bbb;font-size:12px;margin-top:32px;border-top:1px solid #eee;padding-top:16px;">
          If you didn't request a password reset, you can safely ignore this email.
          Your password will not be changed.
        </p>
      </div>
    `,
  });
}

module.exports = { sendVerificationEmail, sendPasswordResetEmail };
