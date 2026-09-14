// One-time (or occasional) job: loads FMP's full directory of actively
// traded stock symbols into our own `symbols` table. This is what powers
// the ticker search/autocomplete on the site — searches happen against our
// own database, not FMP, so using the search feature never costs an FMP
// API call. Run manually via the "Load stock symbols" GitHub Action
// whenever you want to refresh the list (the universe of tradable tickers
// barely changes day to day, so this doesn't need to run on a schedule).
require('dotenv').config();
const { pool } = require('../db');

const FMP_BASE = 'https://financialmodelingprep.com/stable';
const BATCH_SIZE = 500;

async function run() {
  console.log('Fetching full symbol list from FMP...');
  const res = await fetch(`${FMP_BASE}/actively-trading-list?apikey=${process.env.FMP_API_KEY}`);
  if (!res.ok) {
    throw new Error(`FMP request failed: ${res.status} ${await res.text()}`);
  }

  const symbols = (await res.json()).filter((s) => s.symbol);
  console.log(`Got ${symbols.length} symbols. Loading into database in batches of ${BATCH_SIZE}...`);

  for (let i = 0; i < symbols.length; i += BATCH_SIZE) {
    const batch = symbols.slice(i, i + BATCH_SIZE);
    const values = [];
    const placeholders = batch
      .map((s, idx) => {
        values.push(s.symbol, s.name || null);
        return `($${idx * 2 + 1}, $${idx * 2 + 2})`;
      })
      .join(', ');

    await pool.query(
      `INSERT INTO symbols (ticker, name) VALUES ${placeholders}
       ON CONFLICT (ticker) DO UPDATE SET name = EXCLUDED.name`,
      values
    );
    console.log(`Loaded ${Math.min(i + BATCH_SIZE, symbols.length)} / ${symbols.length}`);
  }

  console.log('Done loading symbols.');
  await pool.end();
}

run().catch((err) => {
  console.error('Symbol load failed:', err);
  process.exit(1);
});
