require('dotenv').config();
const express = require('express');
const cors = require('cors');

// Without this, an unhandled error in any single request (e.g. a database
// hiccup) crashes the entire Node process instead of just failing that one
// request. This keeps the server alive and logs the error instead.
process.on('unhandledRejection', (err) => {
  console.error('Unhandled rejection (server stayed up):', err);
});

const authRoutes = require('./routes/auth');
const portfolioRoutes = require('./routes/portfolios');
const screenerRoutes = require('./routes/screener');
const stripeRoutes = require('./routes/stripe');
const tickerRoutes = require('./routes/tickers');
const demoRoutes = require('./routes/demo');

const app = express();

app.use(cors({ origin: process.env.CLIENT_ORIGIN }));

// Stripe webhook needs the raw, unparsed body to verify its signature, so it
// must never pass through express.json(). We give it express.raw() here and
// skip the JSON parser for that one path.
app.use('/api/stripe/webhook', express.raw({ type: 'application/json' }));
app.use((req, res, next) => {
  if (req.path === '/api/stripe/webhook') return next();
  express.json()(req, res, next);
});

app.get('/health', (req, res) => res.json({ ok: true }));

app.use('/api/auth', authRoutes);
app.use('/api/portfolios', portfolioRoutes);
app.use('/api/screener', screenerRoutes);
app.use('/api/stripe', stripeRoutes);
app.use('/api/tickers', tickerRoutes);
app.use('/api/demo', demoRoutes);

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Something went wrong' });
});

const port = process.env.PORT || 4000;
app.listen(port, () => console.log(`Clearview Portfolio API listening on :${port}`));
