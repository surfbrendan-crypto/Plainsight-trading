// Runs once every morning via GitHub Actions (see .github/workflows/morning-refresh.yml).
//
// Strategy for staying on FMP's free tier (250 requests/day, end-of-day data):
//   1. Pull every ticker currently in use (held in a portfolio, watchlisted,
//      or already in the screener universe) — deduplicated.
//   2. Batch them into groups and hit FMP's comma-separated quote endpoint,
//      so hundreds of tickers cost only a handful of calls, not one each.
//   3. Write results into ticker_prices — every dashboard/screener read all
//      day long comes from this cached table, never a live API call.
require('dotenv').config();
const { pool } = require('../db');

const FMP_BASE = 'https://financialmodelingprep.com/api/v3';
const BATCH_SIZE = 50; // comfortably under FMP's per-request URL/response limits

async function getTrackedTickers() {
  const { rows } = await pool.query(`
    SELECT DISTINCT ticker FROM (
      SELECT ticker FROM holdings
      UNION
      SELECT ticker FROM watchlist_items
      UNION
      SELECT ticker FROM ticker_prices
    ) AS all_tickers
  `);
  return rows.map((r) => r.ticker);
}

function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

async function fetchQuoteBatch(tickers) {
  const url = `${FMP_BASE}/quote/${tickers.join(',')}?apikey=${process.env.FMP_API_KEY}`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`FMP quote request failed: ${res.status} ${await res.text()}`);
  }
  return res.json();
}

async function fetchProfileBatch(tickers) {
  // Profile endpoint carries sector + a couple of fundamentals the quote
  // endpoint doesn't, used for screener filtering.
  const url = `${FMP_BASE}/profile/${tickers.join(',')}?apikey=${process.env.FMP_API_KEY}`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`FMP profile request failed: ${res.status} ${await res.text()}`);
  }
  return res.json();
}

async function run() {
  const tickers = await getTrackedTickers();
  if (!tickers.length) {
    console.log('No tickers to refresh — nothing to do.');
    return;
  }

  console.log(`Refreshing ${tickers.length} tickers in ${Math.ceil(tickers.length / BATCH_SIZE)} batches...`);
  let callsUsed = 0;

  for (const batch of chunk(tickers, BATCH_SIZE)) {
    const [quotes, profiles] = await Promise.all([
      fetchQuoteBatch(batch),
      fetchProfileBatch(batch),
    ]);
    callsUsed += 2;

    const profileByTicker = Object.fromEntries(profiles.map((p) => [p.symbol, p]));

    for (const q of quotes) {
      const profile = profileByTicker[q.symbol] || {};
      await pool.query(
        `INSERT INTO ticker_prices (ticker, price, market_cap, pe_ratio, dividend_yield, sector, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, now())
         ON CONFLICT (ticker) DO UPDATE SET
           price = $2, market_cap = $3, pe_ratio = $4, dividend_yield = $5, sector = $6, updated_at = now()`,
        [
          q.symbol,
          q.price,
          q.marketCap,
          q.pe,
          profile.lastDiv && q.price ? profile.lastDiv / q.price : null,
          profile.sector || null,
        ]
      );
    }
  }

  console.log(`Done. Used ${callsUsed} of 250 daily FMP calls.`);
  await pool.end();
}

run().catch((err) => {
  console.error('Price refresh failed:', err);
  process.exit(1);
});
