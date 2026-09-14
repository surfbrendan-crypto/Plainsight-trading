const express = require('express');
const { pool } = require('../db');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

// Proxies FMP's symbol lookup endpoint (free tier) live, as the person
// types. This avoids needing to preload FMP's full stock directory, since
// that bulk endpoint requires a paid plan — a lookup here and there is a
// far smaller draw on the daily API budget than a one-time bulk load would
// have been anyway.
router.get('/search', async (req, res) => {
  const q = (req.query.q || '').trim();
  if (q.length < 2) {
    return res.json({ results: [] });
  }

  try {
    const url = `https://financialmodelingprep.com/stable/search-symbol?query=${encodeURIComponent(q)}&limit=15&apikey=${process.env.FMP_API_KEY}`;
    const fmpRes = await fetch(url);
    if (!fmpRes.ok) {
      return res.json({ results: [] });
    }
    const data = await fmpRes.json();
    const results = (Array.isArray(data) ? data : [])
      .filter((s) => s.symbol)
      .map((s) => ({ ticker: s.symbol, name: s.name }));
    res.json({ results });
  } catch (err) {
    res.json({ results: [] });
  }
});

// Returns recent daily closing prices for a ticker, used to draw the small
// price chart on a holding. Reads from our own price_history table (built
// up by the morning refresh job) rather than FMP directly — FMP's actual
// historical-price endpoints all require a paid plan.
router.get('/:ticker/history', async (req, res) => {
  const ticker = req.params.ticker.toUpperCase();

  const { rows } = await pool.query(
    `SELECT date, price FROM price_history WHERE ticker = $1 ORDER BY date DESC LIMIT 90`,
    [ticker]
  );

  const points = rows.reverse().map((r) => ({ date: r.date.toISOString().slice(0, 10), price: Number(r.price) }));
  res.json({ points });
});

module.exports = router;
