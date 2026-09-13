const express = require('express');
const { pool } = require('../db');
const { requireAuth, requirePlan } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth, requirePlan('basic', 'pro'));

// Basic plan gets: sector, market cap, P/E filters.
// Pro plan additionally gets: dividend yield filter.
// This reads only from the cache table refreshed each morning — no live calls.
router.get('/', async (req, res) => {
  const { sector, minMarketCap, maxPe, minDividendYield } = req.query;

  const conditions = ['price > 0'];
  const params = [];

  if (sector) {
    params.push(sector);
    conditions.push(`sector = $${params.length}`);
  }
  if (minMarketCap) {
    params.push(minMarketCap);
    conditions.push(`market_cap >= $${params.length}`);
  }
  if (maxPe) {
    params.push(maxPe);
    conditions.push(`pe_ratio <= $${params.length}`);
  }
  if (minDividendYield) {
    if (req.plan !== 'pro') {
      return res.status(403).json({ error: 'Dividend yield filtering is a Pro feature' });
    }
    params.push(minDividendYield);
    conditions.push(`dividend_yield >= $${params.length}`);
  }

  const { rows } = await pool.query(
    `SELECT ticker, price, market_cap, pe_ratio, dividend_yield, sector, updated_at
     FROM ticker_prices
     WHERE ${conditions.join(' AND ')}
     ORDER BY market_cap DESC NULLS LAST
     LIMIT 200`,
    params
  );

  res.json({ results: rows });
});

module.exports = router;
