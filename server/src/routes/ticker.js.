const express = require('express');
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

module.exports = router;
