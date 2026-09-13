// Point this at your deployed Render backend once it's live.
const API_BASE = window.location.hostname === 'localhost'
  ? 'http://localhost:4000'
  : 'https://api.plainsighttrading.com';

function getToken() {
  return localStorage.getItem('pst_token');
}

function setToken(token) {
  localStorage.setItem('pst_token', token);
}

function clearToken() {
  localStorage.removeItem('pst_token');
}

async function apiFetch(path, options = {}) {
  const token = getToken();
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers || {}),
    },
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || `Request failed (${res.status})`);
  }
  return data;
}
