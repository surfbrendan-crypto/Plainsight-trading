if (!getToken()) {
  window.location.href = 'login.html';
}

async function runScreener(params = {}) {
  const errorEl = document.getElementById('screener-error');
  const body = document.getElementById('results-body');
  errorEl.textContent = '';

  const query = new URLSearchParams(Object.entries(params).filter(([, v]) => v));

  try {
    const { results } = await apiFetch(`/api/screener?${query.toString()}`);
    if (!results.length) {
      body.innerHTML = '<tr><td colspan="6" class="empty-state">No matches — try widening your filters.</td></tr>';
      return;
    }
    body.innerHTML = results
      .map(
        (r) => `
      <tr>
        <td>${r.ticker}</td>
        <td>$${Number(r.price).toFixed(2)}</td>
        <td>${r.market_cap ? '$' + Number(r.market_cap).toLocaleString() : '—'}</td>
        <td>${r.pe_ratio ?? '—'}</td>
        <td>${r.dividend_yield ? (r.dividend_yield * 100).toFixed(2) + '%' : '—'}</td>
        <td>${r.sector || '—'}</td>
      </tr>`
      )
      .join('');
  } catch (err) {
    errorEl.textContent = err.message;
  }
}

document.getElementById('filter-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const form = new FormData(e.target);
  runScreener(Object.fromEntries(form.entries()));
});

runScreener();
