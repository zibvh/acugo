require('dotenv').config();
const express = require('express');
const cors    = require('cors');
const path    = require('path');
const { connectDb } = require('./db/database');
const { verifyTransport } = require('./utils/email');

const app = express();

// Trust proxy headers (needed for rate-limiter to see real IP behind Render/nginx)
app.set('trust proxy', 1);

app.use(cors({ origin: process.env.FRONTEND_URL || '*' }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve frontend in production
if (process.env.NODE_ENV === 'production') {
  app.use(express.static(path.join(__dirname, '../frontend')));
}

// API routes
app.use('/api/auth',     require('./routes/auth'));
app.use('/api/listings', require('./routes/listings'));
app.use('/api/messages', require('./routes/messages'));
app.use('/api/orders',   require('./routes/orders'));
app.use('/api/uploads',  require('./routes/uploads'));
app.use('/api/push',     require('./routes/push'));
app.use('/api/admin',    require('./routes/admin'));

// Health check
app.get('/api/health', (req, res) =>
  res.json({ status: 'ok', time: new Date().toISOString(), env: process.env.NODE_ENV })
);

// Catch-all for frontend SPA (production)
if (process.env.NODE_ENV === 'production') {
  app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, '../frontend/index.html'));
  });
}

const PORT = process.env.PORT || 3001;

const { startSweepScheduler } = require('./utils/sweepJob');

connectDb()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`\n  Bixcart running on http://localhost:${PORT}\n`);
      verifyTransport();    // test SMTP on startup
      startSweepScheduler(); // start 26-hour AI content sweep
    });
  })
  .catch(err => {
    console.error('Failed to connect to MongoDB:', err.message);
    process.exit(1);
  });
