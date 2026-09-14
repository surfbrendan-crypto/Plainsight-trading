// Runs once every morning via GitHub Actions (see .github/workflows/morning-refresh.yml).
//
// Strategy for staying on FMP's free tier (250 requests/day, end-of-day data):
//   1. Pull every ticker currently in use (held in a portfolio, watchlisted,
//      or already in the screener universe) — deduplicated.
//   2. Call FMP's "stable" quote + profile endpoints once per ticker (FMP's
//      batch endpoints require a paid plan, so this stays on the free tier
//      at the cost of 2 calls per ticker instead of 2 calls per batch).
//   3. Write results into ticker_prices — every dashboard/screener read all
//      day long comes from this cached table, never a live API call.
require('dotenv').config();
const { pool } = require('../db');

const FMP_BASE = 'https://financialmodelingprep.com/stable';

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

// FMP's "stable" endpoints return either an array with one object, or the
// object directly, depending on endpoint — this normalizes either shape.
function firstResult(data) {
  return Array.isArray(data) ? data[0] : data;
}

async function fetchQuote(ticker) {
  const url = `${FMP_BASE}/quote?symbol=${ticker}&apikey=${process.env.FMP_API_KEY}`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`FMP quote request failed for ${ticker}: ${res.status} ${await res.text()}`);
  }
  return firstResult(await res.json());
}

async function fetchProfile(ticker) {
  // Profile endpoint carries sector + dividend info the quote endpoint
  // doesn't, used for screener filtering.
  const url = `${FMP_BASE}/profile?symbol=${ticker}&apikey=${process.env.FMP_API_KEY}`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`FMP profile request failed for ${ticker}: ${res.status} ${await res.text()}`);
  }
  return firstResult(await res.json());
}

async function run() {
  const tickers = await getTrackedTickers();
  if (!tickers.length) {
    console.log('No tickers to refresh — nothing to do.');
    return;
  }

  console.log(`Refreshing ${tickers.length} tickers (2 API calls each)...`);
  let callsUsed = 0;

  for (const ticker of tickers) {
    const [quote, profile] = await Promise.all([fetchQuote(ticker), fetchProfile(ticker)]);
    callsUsed += 2;

    if (!quote || !quote.price) {
      console.warn(`No quote data for ${ticker} — skipping`);
      continue;
    }

    await pool.query(
      `INSERT INTO ticker_prices (ticker, price, market_cap, pe_ratio, dividend_yield, sector, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, now())
       ON CONFLICT (ticker) DO UPDATE SET
         price = $2, market_cap = $3, pe_ratio = $4, dividend_yield = $5, sector = $6, updated_at = now()`,
      [
        ticker,
        quote.price,
        quote.marketCap,
        quote.pe,
        profile?.lastDividend && quote.price ? profile.lastDividend / quote.price : null,
        profile?.sector || null,
      ]
    );
  }

  console.log(`Done. Used ${callsUsed} of 250 daily FMP calls.`);
  await pool.end();
}

run().catch((err) => {
  console.error('Price refresh failed:', err);
  process.exit(1);
});
