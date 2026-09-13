const jwt = require('jsonwebtoken');
const { pool } = require('../db');

function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;

  if (!token) {
    return res.status(401).json({ error: 'Missing auth token' });
  }

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    req.userId = payload.userId;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

// Blocks the request unless the user has an active subscription on one of
// the given plans. Pass ['basic', 'pro'] for "any paid plan", or ['pro']
// to gate a Pro-only feature.
function requirePlan(...allowedPlans) {
  return async (req, res, next) => {
    const { rows } = await pool.query(
      `SELECT plan, status FROM subscriptions
       WHERE user_id = $1 AND status IN ('active', 'trialing')
       ORDER BY created_at DESC LIMIT 1`,
      [req.userId]
    );

    const sub = rows[0];
    if (!sub || !allowedPlans.includes(sub.plan)) {
      return res.status(403).json({
        error: 'This feature requires an active subscription',
        requiredPlans: allowedPlans,
      });
    }

    req.plan = sub.plan;
    next();
  };
}

module.exports = { requireAuth, requirePlan };
