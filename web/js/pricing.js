async function startCheckout(plan) {
  const errorEl = document.getElementById('pricing-error');
  errorEl.textContent = '';

  if (!getToken()) {
    window.location.href = `signup.html?redirect=pricing&plan=${plan}`;
    return;
  }

  try {
    const { url } = await apiFetch('/api/stripe/create-checkout-session', {
      method: 'POST',
      body: JSON.stringify({ plan }),
    });
    window.location.href = url;
  } catch (err) {
    errorEl.textContent = err.message;
  }
}
