const express = require('express');
const { pool } = require('../db');
const { requireAuth, requirePlan } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

const BASIC_PORTFOLIO_LIMIT = 3;

// List all portfolios for the logged-in user, each with current value
// computed from the morning-refreshed price cache.
router.get('/', async (req, res) => {
  const { rows: portfolios } = await pool.query(
    'SELECT id, name, created_at FROM portfolios WHERE user_id = $1 ORDER BY created_at',
    [req.userId]
  );

  const withValues = await Promise.all(
    portfolios.map(async (p) => {
      const { rows: holdings } = await pool.query(
        `SELECT h.id, h.ticker, h.shares, h.cost_basis, h.locked_until, tp.price, tp.updated_at
         FROM holdings h
         LEFT JOIN ticker_prices tp ON tp.ticker = h.ticker
         WHERE h.portfolio_id = $1`,
        [p.id]
      );

      const currentValue = holdings.reduce(
        (sum, h) => sum + Number(h.shares) * Number(h.price || 0),
        0
      );
      const costValue = holdings.reduce(
        (sum, h) => sum + Number(h.shares) * Number(h.cost_basis || h.price || 0),
        0
      );

      return {
        ...p,
        holdings,
        currentValue,
        gainLoss: currentValue - costValue,
        pricesAsOf: holdings[0]?.updated_at || null,
      };
    })
  );

  res.json({ portfolios: withValues });
});

router.post('/', requirePlan('basic', 'pro'), async (req, res) => {
  const { name } = req.body;

  if (req.plan === 'basic') {
    const { rows } = await pool.query(
      'SELECT COUNT(*)::int AS count FROM portfolios WHERE user_id = $1',
      [req.userId]
    );
    if (rows[0].count >= BASIC_PORTFOLIO_LIMIT) {
      return res.status(403).json({
        error: `Basic plan is limited to ${BASIC_PORTFOLIO_LIMIT} portfolios. Upgrade to Pro for unlimited.`,
      });
    }
  }

  const { rows } = await pool.query(
    'INSERT INTO portfolios (user_id, name) VALUES ($1, $2) RETURNING id, name, created_at',
    [req.userId, name || 'My Portfolio']
  );
  res.status(201).json({ portfolio: rows[0] });
});

router.delete('/:id', async (req, res) => {
  await pool.query('DELETE FROM portfolios WHERE id = $1 AND user_id = $2', [
    req.params.id,
    req.userId,
  ]);
  res.status(204).end();
});

// Add a holding to a portfolio. Ticker is upserted into ticker_prices with
// a null price — it'll be picked up by tomorrow morning's refresh job.
router.post('/:id/holdings', async (req, res) => {
  const { ticker, shares, costBasis } = req.body;
  if (!ticker || !shares) {
    return res.status(400).json({ error: 'ticker and shares are required' });
  }

  const owns = await pool.query(
    'SELECT id FROM portfolios WHERE id = $1 AND user_id = $2',
    [req.params.id, req.userId]
  );
  if (!owns.rows.length) {
    return res.status(404).json({ error: 'Portfolio not found' });
  }

  const normalizedTicker = ticker.trim().toUpperCase();

  await pool.query(
    `INSERT INTO ticker_prices (ticker, price) VALUES ($1, 0)
     ON CONFLICT (ticker) DO NOTHING`,
    [normalizedTicker]
  );

  const { rows } = await pool.query(
    `INSERT INTO holdings (portfolio_id, ticker, shares, cost_basis)
     VALUES ($1, $2, $3, $4) RETURNING *`,
    [req.params.id, normalizedTicker, shares, costBasis || null]
  );

  res.status(201).json({ holding: rows[0] });
});

router.delete('/:portfolioId/holdings/:holdingId', async (req, res) => {
  const { rows } = await pool.query(
    `SELECT h.locked_until FROM holdings h
     JOIN portfolios p ON h.portfolio_id = p.id
     WHERE h.id = $1 AND p.id = $2 AND p.user_id = $3`,
    [req.params.holdingId, req.params.portfolioId, req.userId]
  );
  if (!rows.length) {
    return res.status(404).json({ error: 'Holding not found' });
  }
  if (rows[0].locked_until && new Date(rows[0].locked_until) > new Date()) {
    return res.status(403).json({
      error: `This holding is locked until ${rows[0].locked_until}. Unlock it first if you want to remove it.`,
    });
  }

  await pool.query(
    `DELETE FROM holdings h USING portfolios p
     WHERE h.id = $1 AND h.portfolio_id = p.id
       AND p.id = $2 AND p.user_id = $3`,
    [req.params.holdingId, req.params.portfolioId, req.userId]
  );
  res.status(204).end();
});

// Sets a self-imposed hold period on a holding — while locked, the
// dashboard hides its price and blocks removing it, as a speed bump against
// impulse decisions. Only 30 or 90 day periods, kept simple on purpose.
router.post('/:portfolioId/holdings/:holdingId/lock', async (req, res) => {
  const { days } = req.body;
  if (![30, 90].includes(Number(days))) {
    return res.status(400).json({ error: 'days must be 30 or 90' });
  }

  const { rows } = await pool.query(
    `UPDATE holdings h SET locked_until = CURRENT_DATE + $1::int
     FROM portfolios p
     WHERE h.id = $2 AND h.portfolio_id = p.id AND p.id = $3 AND p.user_id = $4
     RETURNING h.locked_until`,
    [days, req.params.holdingId, req.params.portfolioId, req.userId]
  );
  if (!rows.length) {
    return res.status(404).json({ error: 'Holding not found' });
  }
  res.json({ lockedUntil: rows[0].locked_until });
});

// Explicit early unlock — always allowed (this is a self-help tool, not a
// trap), but the frontend asks for confirmation before calling this so it's
// a deliberate choice rather than an accidental click.
router.post('/:portfolioId/holdings/:holdingId/unlock', async (req, res) => {
  const { rows } = await pool.query(
    `UPDATE holdings h SET locked_until = NULL
     FROM portfolios p
     WHERE h.id = $1 AND h.portfolio_id = p.id AND p.id = $2 AND p.user_id = $3
     RETURNING h.id`,
    [req.params.holdingId, req.params.portfolioId, req.userId]
  );
  if (!rows.length) {
    return res.status(404).json({ error: 'Holding not found' });
  }
  res.status(204).end();
});

module.exports = router;
