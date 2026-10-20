const KEY = 'papercheck_token';
export const getToken = () => localStorage.getItem(KEY);
export const setToken = (t) => (t ? localStorage.setItem(KEY, t) : localStorage.removeItem(KEY));

async function request(method, url, body) {
  const res = await fetch(`/api${url}`, {
    method,
    headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(getToken() ? { Authorization: `Bearer ${getToken()}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && getToken()) { setToken(null); window.location.href = '/login'; }
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

export const api = {
  get: (u) => request('GET', u),
  post: (u, b) => request('POST', u, b || {}),
  put: (u, b) => request('PUT', u, b),
  del: (u) => request('DELETE', u),
  fileUrl: (u) => `/api${u}${u.includes('?') ? '&' : '?'}token=${getToken()}`,
  async download(u, name) {
    const res = await fetch(`/api${u}`, { headers: { Authorization: `Bearer ${getToken()}` } });
    const blob = await res.blob();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();
  },
  upload(url, formData, onProgress) {
    return new Promise((resolve, reject) => {
      const x = new XMLHttpRequest();
      x.open('POST', `/api${url}`);
      x.setRequestHeader('Authorization', `Bearer ${getToken()}`);
      x.upload.onprogress = (e) => e.lengthComputable && onProgress?.(e.loaded / e.total);
      x.onload = () => {
        let d = {};
        try { d = JSON.parse(x.responseText); } catch { /* ignore */ }
        x.status >= 200 && x.status < 300 ? resolve(d) : reject(new Error(d.error || `Upload failed (${x.status})`));
      };
      x.onerror = () => reject(new Error('Network error during upload'));
      x.send(formData);
    });
  },
};
