const express = require('express');
const Stripe = require('stripe');
const { pool } = require('../db');
const { requireAuth } = require('../middleware/auth');

const stripe = Stripe(process.env.STRIPE_SECRET_KEY);
const router = express.Router();
router.use(requireAuth);

// Milestones checked from highest to lowest — if someone's been away 45
// days, they should get the 30-day reward (their highest unclaimed one),
// not have both 7 and 30 fire at once.
const MILESTONES = [
  { days: 90, couponEnv: 'STRIPE_COUPON_100', label: '100% off your next bill' },
  { days: 30, couponEnv: 'STRIPE_COUPON_25', label: '25% off your next bill' },
  { days: 7, couponEnv: 'STRIPE_COUPON_10', label: '10% off your next bill' },
];

// Applies a Stripe coupon to the user's active subscription and records the
// milestone as claimed — called only once we've confirmed it's newly earned
// and not already claimed before.
async function grantReward(userId, milestone) {
  const couponId = process.env[milestone.couponEnv];
  if (!couponId) return null;

  const { rows } = await pool.query(
    `SELECT stripe_subscription_id FROM subscriptions
     WHERE user_id = $1 AND status IN ('active', 'trialing')
     ORDER BY created_at DESC LIMIT 1`,
    [userId]
  );
  const subscriptionId = rows[0]?.stripe_subscription_id;
  if (!subscriptionId) return null;

  await stripe.subscriptions.update(subscriptionId, { coupon: couponId });
  await pool.query(
    'INSERT INTO streak_rewards (user_id, milestone) VALUES ($1, $2) ON CONFLICT DO NOTHING',
    [userId, milestone.days]
  );

  return { days: milestone.days, label: milestone.label };
}

// Called once when the dashboard loads. Reports how many days it's been
// since the LAST time this endpoint was hit (the "streak" of not checking
// in), then updates the timestamp for next time. Framed as a good thing —
// the whole point of this product is that checking less is fine. Also
// checks whether this visit just crossed a new, previously-unclaimed streak
// milestone, and if so applies the matching subscription discount.
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

  let rewardEarned = null;
  if (daysSinceLastVisit !== null) {
    const { rows: claimed } = await pool.query(
      'SELECT milestone FROM streak_rewards WHERE user_id = $1',
      [req.userId]
    );
    const claimedDays = new Set(claimed.map((r) => r.milestone));

    const eligible = MILESTONES.find((m) => daysSinceLastVisit >= m.days && !claimedDays.has(m.days));
    if (eligible) {
      try {
        rewardEarned = await grantReward(req.userId, eligible);
      } catch (err) {
        console.error('Failed to grant streak reward:', err.message);
      }
    }
  }

  await pool.query('UPDATE users SET last_dashboard_visit = now() WHERE id = $1', [req.userId]);

  res.json({
    email: user.email,
    mutedMode: user.muted_mode,
    daysSinceLastVisit,
    rewardEarned,
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
