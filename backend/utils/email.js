const nodemailer = require('nodemailer');

function createTransport() {
  const port = parseInt(process.env.SMTP_PORT || '587');
  // port 465 = direct SSL; port 587 = STARTTLS (secure must be false)
  const secure = (port === 465);

  return nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'smtp.gmail.com',
    port,
    secure,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
    // Prevents self-signed cert errors on some hosts
    tls: { rejectUnauthorized: false },
  });
}

// FRONTEND_URL may be comma-separated — always pick the https one
function getBaseUrl() {
  const raw = process.env.FRONTEND_URL || 'https://plazza.onrender.com';
  const urls = raw.split(',').map(u => u.trim()).filter(Boolean);
  return urls.find(u => u.startsWith('https://')) || urls[urls.length - 1];
}

const FROM = process.env.EMAIL_FROM || '"Plazza" <no-reply@plazza.onrender.com>';

// Called once at server startup to catch misconfigured SMTP early
async function verifyTransport() {
  try {
    const t = createTransport();
    await t.verify();
    console.log('  ✓ SMTP connection verified —', process.env.SMTP_USER);
  } catch (err) {
    console.error('  ✗ SMTP FAILED —', err.message);
    console.error('    host:', process.env.SMTP_HOST, '| port:', process.env.SMTP_PORT, '| user:', process.env.SMTP_USER);
  }
}

async function sendVerificationEmail(to, token) {
  const link = `${getBaseUrl()}/pages/auth.html?action=verify&token=${token}`;
  await createTransport().sendMail({
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
        <a href="${link}" style="display:inline-block;margin:24px 0;padding:14px 28px;background:#c8522a;color:white;text-decoration:none;border-radius:8px;font-weight:600;font-size:15px;">
          Verify Email
        </a>
        <p style="color:#999;font-size:13px;">Or paste this link:<br><a href="${link}" style="color:#c8522a;">${link}</a></p>
        <p style="color:#bbb;font-size:12px;margin-top:24px;border-top:1px solid #eee;padding-top:16px;">
          If you didn't create a Plazza account, ignore this email.
        </p>
      </div>`,
  });
}

async function sendPasswordResetEmail(to, token) {
  const link = `${getBaseUrl()}/pages/auth.html?action=reset&token=${token}`;
  await createTransport().sendMail({
    from: FROM,
    to,
    subject: 'Reset your Plazza password',
    html: `
      <div style="font-family:sans-serif;max-width:480px;margin:auto;padding:32px;background:#fafafa;border-radius:12px;">
        <h2 style="color:#1a1a1a;margin-bottom:8px;">Reset your password</h2>
        <p style="color:#555;line-height:1.6;">
          Click below to reset your Plazza password. This link expires in <strong>1 hour</strong>.
        </p>
        <a href="${link}" style="display:inline-block;margin:24px 0;padding:14px 28px;background:#c8522a;color:white;text-decoration:none;border-radius:8px;font-weight:600;font-size:15px;">
          Reset Password
        </a>
        <p style="color:#999;font-size:13px;">Or paste this link:<br><a href="${link}" style="color:#c8522a;">${link}</a></p>
        <p style="color:#bbb;font-size:12px;margin-top:24px;border-top:1px solid #eee;padding-top:16px;">
          If you didn't request this, your password will not change.
        </p>
      </div>`,
  });
}

module.exports = { sendVerificationEmail, sendPasswordResetEmail, verifyTransport };
