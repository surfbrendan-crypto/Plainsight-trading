function afterAuthRedirect() {
  const params = new URLSearchParams(window.location.search);
  if (params.get('redirect') === 'pricing') {
    window.location.href = `pricing.html`;
  } else {
    window.location.href = 'dashboard.html';
  }
}

const signupForm = document.getElementById('signup-form');
if (signupForm) {
  signupForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const errorEl = document.getElementById('error');
    errorEl.textContent = '';
    try {
      const { token } = await apiFetch('/api/auth/signup', {
        method: 'POST',
        body: JSON.stringify({
          email: document.getElementById('email').value,
          password: document.getElementById('password').value,
        }),
      });
      setToken(token);
      afterAuthRedirect();
    } catch (err) {
      errorEl.textContent = err.message;
    }
  });
}

const loginForm = document.getElementById('login-form');
if (loginForm) {
  loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const errorEl = document.getElementById('error');
    errorEl.textContent = '';
    try {
      const { token } = await apiFetch('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({
          email: document.getElementById('email').value,
          password: document.getElementById('password').value,
        }),
      });
      setToken(token);
      afterAuthRedirect();
    } catch (err) {
      errorEl.textContent = err.message;
    }
  });
}
