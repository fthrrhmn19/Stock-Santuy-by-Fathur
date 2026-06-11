async function request(path) {
  const res = await fetch(path, { headers: { Accept: 'application/json' } });
  let data;
  try {
    data = await res.json();
  } catch (err) {
    if (res.headers.get('content-type')?.includes('text/html')) {
      throw new Error(`API Backend tidak berjalan. Pastikan Anda mengakses URL Cloudflare Live, bukan Localhost Vite.`);
    }
    throw new Error('Gagal membaca respons dari server (Bukan JSON).');
  }
  if (!res.ok) throw new Error(data.message || `Request gagal (${res.status})`);
  return data;
}

export const api = {
  status: () => request('/api/status'),
  schedule: () => request('/api/market-schedule'),
  scan: () => request('/api/scan-market'),
  index: () => request('/api/market-index'),
  fundamentals: symbol => request(`/api/fundamentals?symbol=${encodeURIComponent(symbol || '')}`),
  valuation: symbol => request(`/api/valuation?symbol=${encodeURIComponent(symbol || '')}`),
  news: symbol => request(`/api/market-news?symbol=${encodeURIComponent(symbol || '')}`),
  alertCheck: () => request('/api/alert-status'),
  alertSend: () =>
    fetch('/api/alert-check', { method: 'POST', headers: { Accept: 'application/json' } }).then(async r => {
      const d = await r.json();
      if (!r.ok) throw new Error(d.message || 'Kirim alert gagal');
      return d;
    }),
  series: (symbol, interval = '1day', outputsize = 260, range = '') => {
    const qs = new URLSearchParams({ symbol, interval, outputsize: String(outputsize) });
    if (range) qs.set('range', range);
    return request(`/api/time-series?${qs.toString()}`);
  },
  login: password =>
    fetch('/api/auth-login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password })
    }).then(async r => {
      let d;
      try {
        d = await r.json();
      } catch (err) {
        if (r.headers.get('content-type')?.includes('text/html')) {
          throw new Error(`Anda sedang menjalankan web secara Lokal. Backend Login hanya bekerja di URL Cloudflare Live.`);
        }
        throw new Error('Gagal membaca respons login dari server (Bukan JSON).');
      }
      if (!r.ok) throw new Error(d.message || 'Login gagal');
      return d;
    }),
  session: () => request('/api/auth-session'),
  logout: () => fetch('/api/auth-logout', { method: 'POST' }).then(r => r.json())
};
