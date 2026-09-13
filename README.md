# Plainsight Trading

A stock screener and portfolio dashboard, updated once every morning. Backup
name if "Plainsight" runs into trademark trouble: **Farview Trading**.

## Stack

Same pattern as Diamond & Iron:
- **Backend:** Node/Express on Render, Postgres, Stripe subscriptions + webhooks, JWT auth
- **Frontend:** Static HTML/CSS/JS, deployable to Netlify
- **Market data:** Financial Modeling Prep free tier (250 calls/day, end-of-day)
- **Scheduler:** GitHub Actions (free) runs the morning price refresh — no paid cron needed

## How the "free daily update" works

Nobody's dashboard or screener query ever calls the market-data API directly.
Instead:

1. Every weekday morning, a GitHub Actions workflow (`.github/workflows/morning-refresh.yml`)
   runs `server/src/scripts/refreshPrices.js`.
2. That script collects every ticker anyone is tracking (held, watchlisted,
   or already in the screener universe), batches them into groups of 50, and
   hits FMP's batch quote + profile endpoints — a few API calls total, not
   one per ticker.
3. Results are written to the `ticker_prices` table.
4. All day, every dashboard and screener request just reads that table.
   This keeps you comfortably inside the 250-calls/day free tier even with
   hundreds of tracked tickers, and it matches what the free tier gives you
   anyway (end-of-day data, not real-time).

## Local setup

```bash
cd server
cp .env.example .env   # fill in DATABASE_URL, JWT_SECRET, Stripe keys, FMP_API_KEY
npm install
psql "$DATABASE_URL" -f schema.sql
npm run dev
```

Open `web/index.html` with a local static server (e.g. `npx serve web`) —
update `API_BASE` in `web/js/api.js` once you know your local port.

## Deploying

1. **Backend → Render**: new Web Service pointed at `server/`, set the env
   vars from `.env.example` as Render environment variables, run
   `npm install && npm start`.
2. **Database → Render Postgres**: create an instance, run `schema.sql`
   against it once, put the connection string in `DATABASE_URL`.
3. **Frontend → Netlify**: point at `web/` as the publish directory. Update
   `API_BASE` in `web/js/api.js` to your Render backend URL.
4. **Stripe**: create two recurring Prices ($9/mo Basic, $19/mo Pro) in the
   Stripe dashboard, put their price IDs in `STRIPE_PRICE_BASIC` /
   `STRIPE_PRICE_PRO`. Add a webhook endpoint pointing at
   `https://<your-backend>/api/stripe/webhook` listening for
   `checkout.session.completed`, `customer.subscription.updated`, and
   `customer.subscription.deleted`.
5. **GitHub Actions secrets**: add `DATABASE_URL` and `FMP_API_KEY` as repo
   secrets so the morning-refresh workflow can run. You can trigger it
   manually any time from the Actions tab ("Run workflow") to test it before
   trusting the schedule.

## Not yet done (same checklist as Diamond & Iron)

- LLC formation, EIN, business bank account
- Stripe live-mode verification
- Terms of service / privacy policy — should include the "education and
  tools, not investment advice" disclaimer already on the landing page
- Get an FMP API key and confirm current free-tier limits before launch
  (verify pricing/limits directly on financialmodelingprep.com, since these
  change)
