const money = (n) => `$${Number(n).toLocaleString(undefined, { maximumFractionDigits: 2 })}`;

if (!getToken()) {
  window.location.href = 'login.html';
}

async function loadPortfolios() {
  const errorEl = document.getElementById('dashboard-error');
  try {
    const { portfolios } = await apiFetch('/api/portfolios');
    renderPortfolios(portfolios);
  } catch (err) {
    errorEl.textContent = err.message;
  }
}

function renderPortfolios(portfolios) {
  const list = document.getElementById('portfolio-list');
  const note = document.getElementById('prices-note');

  if (!portfolios.length) {
    list.innerHTML = '<p class="empty-state">No portfolios yet. Create one to start tracking holdings.</p>';
    return;
  }

  const mostRecentUpdate = portfolios
    .flatMap((p) => p.pricesAsOf)
    .filter(Boolean)
    .sort()
    .at(-1);
  note.textContent = mostRecentUpdate
    ? `Prices as of ${new Date(mostRecentUpdate).toLocaleString()}`
    : 'Prices update every morning before market open.';

  list.innerHTML = portfolios
    .map((p) => {
      const gainClass = p.gainLoss >= 0 ? 'gain' : 'loss';
      const rows = p.holdings
        .map(
          (h) => `
        <tr>
          <td>${h.ticker}</td>
          <td>${h.shares}</td>
          <td>${h.price ? money(h.price) : '—'}</td>
          <td>${h.price ? money(h.shares * h.price) : '—'}</td>
          <td><button class="btn btn-ghost" style="padding:4px 10px;font-size:13px;" onclick="removeHolding(${p.id}, ${h.id})">Remove</button></td>
        </tr>`
        )
        .join('');

      return `
        <div class="panel" style="max-width:none; margin-bottom:24px;">
          <div class="app-header">
            <h3>${p.name}</h3>
            <div>
              <span class="${gainClass}">${money(p.currentValue)} (${p.gainLoss >= 0 ? '+' : ''}${money(p.gainLoss)})</span>
              <button class="btn btn-ghost" style="margin-left:12px;" onclick="deletePortfolio(${p.id})">Delete</button>
            </div>
          </div>
          <table>
            <thead><tr><th>Ticker</th><th>Shares</th><th>Price</th><th>Value</th><th></th></tr></thead>
            <tbody>${rows || '<tr><td colspan="5" class="empty-state">No holdings yet</td></tr>'}</tbody>
          </table>
          <form onsubmit="addHolding(event, ${p.id})" style="display:flex; gap:8px; margin-top:16px;">
            <input name="ticker" placeholder="Ticker (e.g. AAPL)" required style="padding:8px;border:1px solid var(--line);" />
            <input name="shares" type="number" step="any" placeholder="Shares" required style="padding:8px;border:1px solid var(--line); width:100px;" />
            <input name="costBasis" type="number" step="any" placeholder="Cost/share (optional)" style="padding:8px;border:1px solid var(--line); width:160px;" />
            <button class="btn btn-primary" type="submit">Add</button>
          </form>
        </div>`;
    })
    .join('');
}

async function createPortfolio() {
  const name = prompt('Portfolio name:', 'My Portfolio');
  if (name === null) return;
  try {
    await apiFetch('/api/portfolios', { method: 'POST', body: JSON.stringify({ name }) });
    loadPortfolios();
  } catch (err) {
    document.getElementById('dashboard-error').textContent = err.message;
  }
}

async function deletePortfolio(id) {
  if (!confirm('Delete this portfolio?')) return;
  await apiFetch(`/api/portfolios/${id}`, { method: 'DELETE' });
  loadPortfolios();
}

async function addHolding(event, portfolioId) {
  event.preventDefault();
  const form = event.target;
  const ticker = form.ticker.value.trim();
  const shares = form.shares.value;
  const costBasis = form.costBasis.value || undefined;

  try {
    await apiFetch(`/api/portfolios/${portfolioId}/holdings`, {
      method: 'POST',
      body: JSON.stringify({ ticker, shares, costBasis }),
    });
    form.reset();
    loadPortfolios();
  } catch (err) {
    document.getElementById('dashboard-error').textContent = err.message;
  }
}

async function removeHolding(portfolioId, holdingId) {
  await apiFetch(`/api/portfolios/${portfolioId}/holdings/${holdingId}`, { method: 'DELETE' });
  loadPortfolios();
}

loadPortfolios();
