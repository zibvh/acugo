const nodemailer = require('nodemailer');

function createTransport() {
  // Supports any SMTP provider: Gmail, Resend, Brevo, Mailgun, etc.
  // Set SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS in your .env
  // For Gmail, use an App Password (not your account password)
  return nodemailer.createTransport({
    host:   process.env.SMTP_HOST   || 'smtp.gmail.com',
    port:   parseInt(process.env.SMTP_PORT || '587'),
    secure: process.env.SMTP_SECURE === 'true', // true for port 465
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });
}

const FROM = process.env.EMAIL_FROM || `"Plazza" <no-reply@plazza.ng>`;
const BASE_URL = process.env.FRONTEND_URL || 'https://plazza.ng';

async function sendVerificationEmail(to, token) {
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
