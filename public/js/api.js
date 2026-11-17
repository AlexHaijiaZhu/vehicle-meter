export class ApiError extends Error {
  constructor(message, status, details) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.details = details;
  }
}

function buildQuery(query) {
  if (!query) return '';
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === '') continue;
    params.set(key, String(value));
  }
  const text = params.toString();
  return text ? `?${text}` : '';
}

async function request(method, path, { body, query } = {}) {
  let response;
  try {
    response = await fetch(`${path}${buildQuery(query)}`, {
      method,
      headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      credentials: 'same-origin'
    });
  } catch (err) {
    throw new ApiError('无法连接服务器，请检查服务是否正在运行', 0);
  }
  const contentType = response.headers.get('content-type') || '';
  let payload = null;
  if (contentType.includes('application/json')) {
    try { payload = await response.json(); } catch { payload = null; }
  }
  if (!response.ok) {
    const message = payload?.error || `请求失败（HTTP ${response.status}）`;
    throw new ApiError(message, response.status, payload?.details);
  }
  return payload;
}

function filenameFromHeaders(response, fallback) {
  const disposition = response.headers.get('content-disposition') || '';
  const utf8 = /filename\*=UTF-8''([^;]+)/i.exec(disposition);
  if (utf8) {
    try { return decodeURIComponent(utf8[1]); } catch { /* ignore */ }
  }
  const plain = /filename="([^"]+)"/i.exec(disposition);
  return plain?.[1] || fallback;
}

export const api = {
  get: (path, query) => request('GET', path, { query }),
  post: (path, body) => request('POST', path, { body: body ?? {} }),
  put: (path, body) => request('PUT', path, { body: body ?? {} }),
  del: (path, query) => request('DELETE', path, { query }),
  async download(path, query, fallbackName = 'download') {
    let response;
    try {
      response = await fetch(`${path}${buildQuery(query)}`, { credentials: 'same-origin' });
    } catch {
      throw new ApiError('下载失败：无法连接服务器', 0);
    }
    if (!response.ok) {
      let message = `下载失败（HTTP ${response.status}）`;
      try {
        const data = await response.json();
        if (data.error) message = data.error;
      } catch { /* ignore */ }
      throw new ApiError(message, response.status);
    }
    const blob = await response.blob();
    const filename = filenameFromHeaders(response, fallbackName);
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    return filename;
  }
};

export { buildQuery };
