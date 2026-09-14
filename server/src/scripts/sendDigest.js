// Runs every morning via GitHub Actions, right after the price refresh, so
// every number in the email reflects today's freshly-updated prices.
require('dotenv').config();
const { Resend } = require('resend');
const { pool } = require('../db');

const resend = new Resend(process.env.RESEND_API_KEY);
const FROM = 'Clearview Portfolio <morning@clearviewportfolio.com>';

const money = (n) => `$${Math.abs(n).toLocaleString(undefined, { maximumFractionDigits: 2 })}`;

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

      for (const p of portfolios) {
        const { rows: holdings } = await pool.query(
          `SELECT ticker, shares FROM holdings WHERE portfolio_id = $1`,
          [p.id]
        );
        if (!holdings.length) continue;

        let pToday = 0;
        let pYesterday = 0;

        for (const h of holdings) {
          const { rows: history } = await pool.query(
            `SELECT date, price FROM price_history WHERE ticker = $1 ORDER BY date DESC LIMIT 2`,
            [h.ticker]
          );
          const todayPrice = Number(history[0]?.price || 0);
          // Fall back to today's price if we don't have a second day of
          // history yet (brand-new ticker) — treats it as flat, not a loss.
          const yesterdayPrice = Number(history[1]?.price ?? todayPrice);
          pToday += todayPrice * Number(h.shares);
          pYesterday += yesterdayPrice * Number(h.shares);
        }

        totalToday += pToday;
        totalYesterday += pYesterday;
        summaries.push({ name: p.name, value: pToday, change: pToday - pYesterday });
      }

      if (!summaries.length) continue;

      const totalChange = totalToday - totalYesterday;
      const sign = totalChange >= 0 ? '+' : '-';
      const color = totalChange >= 0 ? '#38CE9B' : '#EA6A5A';

      const rowsHtml = summaries
        .map((p) => {
          const pSign = p.change >= 0 ? '+' : '-';
          const pColor = p.change >= 0 ? '#38CE9B' : '#EA6A5A';
          return `<tr>
            <td style="padding:8px 0; color:#F3F0E6; font-family:sans-serif; font-size:15px;">${p.name}</td>
            <td style="padding:8px 0; text-align:right; color:#F3F0E6; font-family:sans-serif; font-size:15px;">${money(p.value)}</td>
            <td style="padding:8px 0; text-align:right; color:${pColor}; font-family:monospace; font-size:14px;">${pSign}${money(p.change)}</td>
          </tr>`;
        })
        .join('');

      const html = `
        <div style="background:#10152A; padding:32px 16px; font-family:sans-serif;">
          <div style="max-width:480px; margin:0 auto; background:#1A2140; border-radius:8px; padding:32px;">
            <p style="color:#EAB454; font-family:monospace; font-size:12px; letter-spacing:2px; margin:0 0 8px;">MORNING BRIEFING</p>
            <h1 style="color:#F3F0E6; font-size:26px; margin:0 0 20px;">Good morning</h1>
            <p style="color:#AEB4D1; font-size:15px; margin:0 0 8px;">Here's where things stand across your portfolios:</p>
            <table style="width:100%; border-collapse:collapse; margin:16px 0;">
              ${rowsHtml}
            </table>
            <div style="border-top:1px solid #303A64; padding-top:16px; margin-top:8px;">
              <p style="color:#AEB4D1; font-size:13px; margin:0;">Total value</p>
              <p style="color:#F3F0E6; font-size:30px; font-weight:600; margin:4px 0;">${money(totalToday)}</p>
              <p style="color:${color}; font-family:monospace; font-size:15px; margin:0;">${sign}${money(totalChange)} since yesterday</p>
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
