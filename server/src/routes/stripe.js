const express = require('express');
const Stripe = require('stripe');
const { pool } = require('../db');
const { requireAuth } = require('../middleware/auth');

const stripe = Stripe(process.env.STRIPE_SECRET_KEY);
const router = express.Router();

const PRICE_IDS = {
  basic: process.env.STRIPE_PRICE_BASIC,
  pro: process.env.STRIPE_PRICE_PRO,
};

// Creates a Stripe Checkout session for the chosen plan.
// Front-end redirects the browser to the returned URL.
router.post('/create-checkout-session', requireAuth, async (req, res) => {
  const { plan } = req.body;
  const priceId = PRICE_IDS[plan];
  if (!priceId) {
    return res.status(400).json({ error: 'plan must be "basic" or "pro"' });
  }

  const { rows } = await pool.query('SELECT email, stripe_customer_id FROM users WHERE id = $1', [
    req.userId,
  ]);
  const user = rows[0];

  let customerId = user.stripe_customer_id;
  if (!customerId) {
    const customer = await stripe.customers.create({ email: user.email });
    customerId = customer.id;
    await pool.query('UPDATE users SET stripe_customer_id = $1 WHERE id = $2', [
      customerId,
      req.userId,
    ]);
  }

  const session = await stripe.checkout.sessions.create({
    customer: customerId,
    mode: 'subscription',
    line_items: [{ price: priceId, quantity: 1 }],
    success_url: `${process.env.CLIENT_ORIGIN}/dashboard.html?checkout=success`,
    cancel_url: `${process.env.CLIENT_ORIGIN}/pricing.html?checkout=cancelled`,
    metadata: { userId: String(req.userId), plan },
  });

  res.json({ url: session.url });
});

// Stripe webhook — req.body arrives as a raw Buffer here because index.js
// applies express.raw() to this exact path and skips express.json() for it.
router.post('/webhook', async (req, res) => {
  let event;
  try {
    event = stripe.webhooks.constructEvent(
      req.body,
      req.headers['stripe-signature'],
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    return res.status(400).send(`Webhook signature verification failed: ${err.message}`);
  }

  switch (event.type) {
    case 'checkout.session.completed': {
      const session = event.data.object;
      const subscription = await stripe.subscriptions.retrieve(session.subscription);
      await upsertSubscription(session.metadata.userId, session.metadata.plan, subscription);
      break;
    }
    case 'customer.subscription.updated':
    case 'customer.subscription.deleted': {
      const subscription = event.data.object;
      await pool.query(
        `UPDATE subscriptions
         SET status = $1, current_period_end = to_timestamp($2), updated_at = now()
         WHERE stripe_subscription_id = $3`,
        [subscription.status, subscription.current_period_end, subscription.id]
      );
      break;
    }
  }

  res.json({ received: true });
});

async function upsertSubscription(userId, plan, stripeSubscription) {
  await pool.query(
    `INSERT INTO subscriptions (user_id, stripe_subscription_id, plan, status, current_period_end)
     VALUES ($1, $2, $3, $4, to_timestamp($5))
     ON CONFLICT (stripe_subscription_id)
     DO UPDATE SET status = $4, current_period_end = to_timestamp($5), updated_at = now()`,
    [
      userId,
      stripeSubscription.id,
      plan,
      stripeSubscription.status,
      stripeSubscription.current_period_end,
    ]
  );
}

module.exports = router;
