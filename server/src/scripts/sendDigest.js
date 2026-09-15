// Runs every morning via GitHub Actions, right after the price refresh, so
// every number in the email reflects today's freshly-updated prices.
require('dotenv').config();
const { Resend } = require('resend');
const { pool } = require('../db');

const resend = new Resend(process.env.RESEND_API_KEY);
const FROM = 'Clearview Portfolio <morning@clearviewportfolio.com>';

const money = (n) => `$${Math.abs(n).toLocaleString(undefined, { maximumFractionDigits: 2 })}`;

// Generates a short, honest summary of the *pattern* of today's move —
// which holding drove it, how concentrated vs. broad-based it was — purely
// from the real numbers we have. No AI call, no external cost: this is
// template text with real data plugged in, not a guess at causes we can't
// actually know (we deliberately never claim *why* a stock moved, since we
// have no news data to back that up).
function describeMove(holdingChanges, totalChange, totalYesterday) {
  const meaningful = holdingChanges.filter((h) => Math.abs(h.change) > 0.005);
  if (!meaningful.length) {
    return { text: 'Prices were essentially flat across your holdings today.', dominantTicker: null };
  }

  const totalAbsChange = meaningful.reduce((sum, h) => sum + Math.abs(h.change), 0);
  const dominant = meaningful.reduce((max, h) => (Math.abs(h.change) > Math.abs(max.change) ? h : max));
  const dominantShare = totalAbsChange > 0 ? Math.abs(dominant.change) / totalAbsChange : 0;

  const pctOfPortfolio = totalYesterday > 0 ? (Math.abs(totalChange) / totalYesterday) * 100 : 0;
  let magnitude;
  if (pctOfPortfolio < 0.3) magnitude = 'a quiet day';
  else if (pctOfPortfolio < 1) magnitude = 'a fairly typical day of movement';
  else magnitude = 'a more active day than usual';

  const dSign = dominant.change >= 0 ? '+' : '-';
  const isConcentrated = meaningful.length === 1 || dominantShare > 0.6;

  const text = isConcentrated
    ? `It was ${magnitude}, driven mostly by ${dominant.ticker} (${dSign}${money(dominant.change)}), rather than a broad move across everything you hold.`
    : `It was ${magnitude}, with the change spread across several holdings rather than concentrated in just one.`;

  return { text, dominantTicker: isConcentrated ? dominant.ticker : null };
}

// Looks up a recent real headline for a ticker, so "why" is answered with an
// actual sourced article rather than a guessed-at cause. Cached per run so
// many subscribers sharing the same top mover only cost one API call total.
// Fails silently — if this endpoint isn't available on the current FMP plan,
// the digest still sends fine without a headline.
async function fetchHeadline(ticker, cache) {
  if (cache.has(ticker)) return cache.get(ticker);

  try {
    const url = `https://financialmodelingprep.com/stable/news/stock-latest?symbols=${ticker}&limit=1&apikey=${process.env.FMP_API_KEY}`;
    const res = await fetch(url);
    if (!res.ok) {
      cache.set(ticker, null);
      return null;
    }
    const data = await res.json();
    const article = Array.isArray(data) ? data[0] : null;
    const headline = article?.title ? { title: article.title, url: article.url, site: article.site } : null;
    cache.set(ticker, headline);
    return headline;
  } catch (err) {
    cache.set(ticker, null);
    return null;
  }
}

async function run() {
  // Every user with an active (or trialing) subscription — Basic and Pro
  // both get the digest; it's the core differentiator, not a Pro-only perk.
  const { rows: users } = await pool.query(`
    SELECT DISTINCT u.id, u.email
    FROM users u
    JOIN subscriptions s ON s.user_id = u.id
    WHERE s.status IN ('active', 'trialing')
  `);

  console.log(`Sending morning digest to up to ${users.length} subscribers...`);
  let sent = 0;
  const newsCache = new Map(); // shared across all users this run

  for (const user of users) {
    try {
      const { rows: portfolios } = await pool.query(
        `SELECT id, name FROM portfolios WHERE user_id = $1`,
        [user.id]
      );
      if (!portfolios.length) continue;

      let totalToday = 0;
      let totalYesterday = 0;
      const summaries = [];
      const holdingChanges = []; // flat, across all portfolios — for the "what moved" summary

      for (const p of portfolios) {
        const { rows: holdings } = await pool.query(
          `SELECT ticker, shares FROM holdings WHERE portfolio_id = $1`,
          [p.id]
        );
        if (!holdings.length) continue;

        let pToday = 0;
        let pYesterday = 0;
        const holdingRows = [];

        for (const h of holdings) {
          const { rows: history } = await pool.query(
            `SELECT date, price FROM price_history WHERE ticker = $1 ORDER BY date DESC LIMIT 2`,
            [h.ticker]
          );
          const todayPrice = Number(history[0]?.price || 0);
          // Fall back to today's price if we don't have a second day of
          // history yet (brand-new ticker) — treats it as flat, not a loss.
          const yesterdayPrice = Number(history[1]?.price ?? todayPrice);
          const valueToday = todayPrice * Number(h.shares);
          const valueYesterday = yesterdayPrice * Number(h.shares);
          const change = valueToday - valueYesterday;
          const pctChange = valueYesterday > 0 ? (change / valueYesterday) * 100 : null;

          holdingRows.push({ ticker: h.ticker, value: valueToday, change, pctChange });
          holdingChanges.push({ ticker: h.ticker, change });
          pToday += valueToday;
          pYesterday += valueYesterday;
        }

        totalToday += pToday;
        totalYesterday += pYesterday;
        summaries.push({ name: p.name, value: pToday, change: pToday - pYesterday, holdingRows });
      }

      if (!summaries.length) continue;

      const totalChange = totalToday - totalYesterday;
      const sign = totalChange >= 0 ? '+' : '-';
      const color = totalChange >= 0 ? '#38CE9B' : '#EA6A5A';
      const explanation = describeMove(holdingChanges, totalChange, totalYesterday);
      const headline = explanation.dominantTicker
        ? await fetchHeadline(explanation.dominantTicker, newsCache)
        : null;

      // One flat table: a bold portfolio-total row, followed by an indented,
      // smaller row for each individual holding in that portfolio.
      const rowsHtml = summaries
        .map((p) => {
          const pSign = p.change >= 0 ? '+' : '-';
          const pColor = p.change >= 0 ? '#38CE9B' : '#EA6A5A';

          const portfolioRow = `<tr>
            <td style="padding:10px 0 4px; border-top:1px solid #303A64; color:#F3F0E6; font-family:sans-serif; font-weight:600; font-size:15px;">${p.name}</td>
            <td style="padding:10px 0 4px; border-top:1px solid #303A64; text-align:right; color:#F3F0E6; font-family:sans-serif; font-weight:600; font-size:15px;">${money(p.value)}</td>
            <td style="padding:10px 0 4px; border-top:1px solid #303A64; text-align:right; color:${pColor}; font-family:monospace; font-size:14px;">${pSign}${money(p.change)}</td>
          </tr>`;

          const holdingRowsHtml = p.holdingRows
            .map((h) => {
              const hSign = h.change >= 0 ? '+' : '-';
              const hColor = h.change >= 0 ? '#38CE9B' : '#EA6A5A';
              const pctText = h.pctChange === null ? '' : ` (${hSign}${Math.abs(h.pctChange).toFixed(1)}%)`;
              return `<tr>
                <td style="padding:4px 0 4px 16px; color:#AEB4D1; font-family:sans-serif; font-size:13px;">${h.ticker}</td>
                <td style="padding:4px 0; text-align:right; color:#AEB4D1; font-family:sans-serif; font-size:13px;">${money(h.value)}</td>
                <td style="padding:4px 0; text-align:right; color:${hColor}; font-family:monospace; font-size:12.5px;">${hSign}${money(h.change)}${pctText}</td>
              </tr>`;
            })
            .join('');

          return portfolioRow + holdingRowsHtml;
        })
        .join('');

      const html = `
        <div style="background:#10152A; padding:32px 16px; font-family:sans-serif;">
          <div style="max-width:480px; margin:0 auto; background:#1A2140; border-radius:8px; padding:32px;">
            <p style="color:#EAB454; font-family:monospace; font-size:12px; letter-spacing:2px; margin:0 0 8px;">MORNING BRIEFING</p>
            <h1 style="color:#F3F0E6; font-size:26px; margin:0 0 20px;">Good morning</h1>
            <p style="color:#AEB4D1; font-size:15px; margin:0 0 4px;">Here's where things stand across your portfolios:</p>
            <table style="width:100%; border-collapse:collapse; margin:12px 0;">
              ${rowsHtml}
            </table>
            <div style="border-top:1px solid #303A64; padding-top:16px; margin-top:8px;">
              <p style="color:#AEB4D1; font-size:13px; margin:0;">Total value</p>
              <p style="color:#F3F0E6; font-size:30px; font-weight:600; margin:4px 0;">${money(totalToday)}</p>
              <p style="color:${color}; font-family:monospace; font-size:15px; margin:0;">${sign}${money(totalChange)} since yesterday</p>
            </div>
            <div style="background:#212B52; border-radius:6px; padding:16px 18px; margin-top:20px;">
              <p style="color:#EAB454; font-family:monospace; font-size:11px; letter-spacing:1.5px; margin:0 0 8px;">WHAT MOVED</p>
              <p style="color:#F3F0E6; font-size:14.5px; line-height:1.5; margin:0;">${explanation.text}</p>
              ${
                headline
                  ? `<p style="color:#AEB4D1; font-size:13px; line-height:1.5; margin:12px 0 0; border-top:1px solid #303A64; padding-top:12px;">
                       Recent headline on ${explanation.dominantTicker}:
                       ${headline.url ? `<a href="${headline.url}" style="color:#EAB454;">${headline.title}</a>` : headline.title}
                       ${headline.site ? `<span style="color:#6B7280;"> — ${headline.site}</span>` : ''}
                     </p>`
                  : ''
              }
            </div>
            <p style="color:#6B7280; font-size:12px; margin-top:28px; line-height:1.5;">
              You're getting this because you have an active Clearview Portfolio subscription.
              Not investment advice.
              <a href="https://clearviewportfolio.com/dashboard.html" style="color:#EAB454;">View full dashboard →</a>
            </p>
          </div>
        </div>
      `;

      await resend.emails.send({
        from: FROM,
        to: user.email,
        subject: `Your morning update: ${sign}${money(totalChange)} today`,
        html,
      });
      sent += 1;
    } catch (err) {
      console.warn(`Failed to send digest to ${user.email}: ${err.message}`);
    }
  }

  console.log(`Done. Sent ${sent} digest emails.`);
  await pool.end();
}

run().catch((err) => {
  console.error('Digest send failed:', err);
  process.exit(1);
});
