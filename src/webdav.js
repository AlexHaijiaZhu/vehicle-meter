import { fail } from './util.js';

function normalizeBase(raw) {
  if (!raw) fail(400, '请先填写 WebDAV 地址');
  let url;
  try {
    url = new URL(raw);
  } catch {
    fail(400, 'WebDAV 地址格式不正确');
  }
  if (!['http:', 'https:'].includes(url.protocol)) fail(400, 'WebDAV 地址必须是 http 或 https');
  url.username = '';
  url.password = '';
  if (!url.pathname.endsWith('/')) url.pathname += '/';
  return url;
}

function encodePath(path) {
  return String(path || '')
    .split('/')
    .filter(Boolean)
    .map((part) => encodeURIComponent(part))
    .join('/');
}

export class WebDavClient {
  constructor({ url, username = '', password = '', path = 'vehicle-meter/backup.json' }) {
    this.base = normalizeBase(url);
    this.username = username;
    this.password = password;
    this.filePath = String(path || 'vehicle-meter/backup.json').replace(/^\/+/, '');
  }

  get fileUrl() {
    return new URL(encodePath(this.filePath), this.base).toString();
  }

  get parentUrl() {
    const parts = this.filePath.split('/').filter(Boolean);
    parts.pop();
    return new URL(parts.length ? `${encodePath(parts.join('/'))}/` : '', this.base).toString();
  }

  authHeader() {
    if (!this.username && !this.password) return {};
    return { Authorization: `Basic ${Buffer.from(`${this.username}:${this.password}`).toString('base64')}` };
  }

  async request(method, url, { body, headers = {}, timeout = 20000 } = {}) {
    let res;
    try {
      res = await fetch(url, {
        method,
        body,
        headers: { ...this.authHeader(), ...headers },
        redirect: 'follow',
        signal: AbortSignal.timeout(timeout)
      });
    } catch (err) {
      const reason = err?.name === 'TimeoutError' ? '连接超时' : err?.message || '网络错误';
      fail(502, `WebDAV 请求失败：${reason}`);
    }
    return res;
  }

  async readText(res) {
    try {
      return await res.text();
    } catch {
      return '';
    }
  }

  async test() {
    const res = await this.request('PROPFIND', this.fileUrl, {
      headers: { Depth: '0', 'Content-Type': 'application/xml; charset=utf-8' },
      body: '<?xml version="1.0"?><propfind xmlns="DAV:"><prop><resourcetype/></prop></propfind>'
    });
    if (res.status === 401 || res.status === 403) {
      fail(401, 'WebDAV 认证失败，请检查账号或应用密码');
    }
    const ok = res.status < 500;
    return {
      ok,
      status: res.status,
      url: this.fileUrl,
      message:
        res.status === 207 || res.status === 200
          ? '连接成功，文件已存在'
          : res.status === 404
            ? '连接成功，远端文件尚未创建（首次备份会自动创建）'
            : ok
              ? `服务器已响应（HTTP ${res.status}）`
              : `服务器返回 HTTP ${res.status}`
    };
  }

  async ensureParent() {
    const parts = this.filePath.split('/').filter(Boolean);
    parts.pop();
    if (!parts.length) return;
    let current = '';
    for (const part of parts) {
      current += `${part}/`;
      const url = new URL(encodePath(current) + '/', this.base).toString();
      const res = await this.request('MKCOL', url, { timeout: 15000 });
      if (![201, 200, 204, 405, 301].includes(res.status)) {
        if (res.status === 401 || res.status === 403) fail(401, 'WebDAV 认证失败，无法创建目录');
        // Some servers hide existing directories; continue and let PUT decide.
      }
    }
  }

  async put(data, contentType = 'application/json; charset=utf-8') {
    let res = await this.request('PUT', this.fileUrl, {
      body: data,
      headers: { 'Content-Type': contentType }
    });
    if ([404, 409].includes(res.status)) {
      await this.ensureParent();
      res = await this.request('PUT', this.fileUrl, {
        body: data,
        headers: { 'Content-Type': contentType }
      });
    }
    if (!res.ok) {
      if (res.status === 401 || res.status === 403) fail(401, 'WebDAV 认证失败，请检查账号或应用密码');
      const text = await this.readText(res);
      fail(502, `WebDAV 上传失败（HTTP ${res.status}）${text ? `：${text.slice(0, 160)}` : ''}`);
    }
    return { ok: true, status: res.status, url: this.fileUrl };
  }

  async get() {
    const res = await this.request('GET', this.fileUrl, { timeout: 30000 });
    if (res.status === 404) fail(404, '远端没有找到备份文件，请先执行备份');
    if (res.status === 401 || res.status === 403) fail(401, 'WebDAV 认证失败，请检查账号或应用密码');
    if (!res.ok) fail(502, `WebDAV 下载失败（HTTP ${res.status}）`);
    const text = await res.text();
    if (text.length > 30 * 1024 * 1024) fail(413, '远端备份文件过大');
    return text;
  }
}

export function clientFromSettings(settings) {
  return new WebDavClient({
    url: settings.webdavUrl || '',
    username: settings.webdavUsername || '',
    password: settings.webdavPassword || '',
    path: settings.webdavPath || 'vehicle-meter/backup.json'
  });
}
