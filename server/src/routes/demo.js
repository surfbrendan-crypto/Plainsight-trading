const express = require('express');
const { pool } = require('../db');

const router = express.Router();

// A fixed, illustrative set of holdings shown on the landing page so
// visitors can see the product working before signing up. No auth required
// — this is marketing content, not a real user's data. Deliberately spans a
// few sectors so it doesn't read as a single-stock gimmick.
const DEMO_HOLDINGS = [
  { ticker: 'AAPL', shares: 10 },
  { ticker: 'MSFT', shares: 6 },
  { ticker: 'NVDA', shares: 8 },
  { ticker: 'JNJ', shares: 15 },
  { ticker: 'XOM', shares: 20 },
];

router.get('/portfolio', async (req, res) => {
  // Make sure these tickers are in the tracked universe so the morning
  // refresh job keeps them updated forever, the same way any real holding
  // would be (ticker_prices feeds back into its own refresh list).
  for (const { ticker } of DEMO_HOLDINGS) {
    await pool.query(
      `INSERT INTO ticker_prices (ticker, price) VALUES ($1, 0) ON CONFLICT (ticker) DO NOTHING`,
      [ticker]
    );
  }

  const { rows } = await pool.query(
    `SELECT ticker, price, sector, updated_at FROM ticker_prices WHERE ticker = ANY($1)`,
    [DEMO_HOLDINGS.map((h) => h.ticker)]
  );
  const priceByTicker = Object.fromEntries(rows.map((r) => [r.ticker, r]));

  const holdings = DEMO_HOLDINGS.map((h) => {
    const info = priceByTicker[h.ticker] || {};
    const price = Number(info.price) || 0;
    return {
      ticker: h.ticker,
      shares: h.shares,
      price,
      value: price * h.shares,
      sector: info.sector || null,
    };
  });

  const totalValue = holdings.reduce((sum, h) => sum + h.value, 0);
  const updatedAt = rows.find((r) => r.updated_at)?.updated_at || null;

  res.json({ holdings, totalValue, updatedAt });
});

module.exports = router;
