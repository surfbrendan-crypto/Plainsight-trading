const express = require('express');
const { pool } = require('../db');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

// Called once when the dashboard loads. Reports how many days it's been
// since the LAST time this endpoint was hit (the "streak" of not checking
// in), then updates the timestamp for next time. Framed as a good thing —
// the whole point of this product is that checking less is fine.
router.get('/me', async (req, res) => {
  const { rows } = await pool.query(
    'SELECT email, last_dashboard_visit, muted_mode FROM users WHERE id = $1',
    [req.userId]
  );
  const user = rows[0];

  let daysSinceLastVisit = null;
  if (user.last_dashboard_visit) {
    const msPerDay = 1000 * 60 * 60 * 24;
    daysSinceLastVisit = Math.floor((Date.now() - new Date(user.last_dashboard_visit).getTime()) / msPerDay);
  }

  await pool.query('UPDATE users SET last_dashboard_visit = now() WHERE id = $1', [req.userId]);

  res.json({
    email: user.email,
    mutedMode: user.muted_mode,
    daysSinceLastVisit,
  });
});

// Toggle muted mode — hides today's raw $/% swings on the dashboard in
// favor of just the longer-term trend, for anyone who finds daily numbers
// more anxiety-inducing than useful.
router.patch('/me', async (req, res) => {
  const { mutedMode } = req.body;
  await pool.query('UPDATE users SET muted_mode = $1 WHERE id = $2', [Boolean(mutedMode), req.userId]);
  res.json({ mutedMode: Boolean(mutedMode) });
});

module.exports = router;
