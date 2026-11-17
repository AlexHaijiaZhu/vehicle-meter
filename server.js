import http from 'node:http';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApi } from './src/api.js';
import { openDatabase } from './src/db.js';
import { HttpError, contentDisposition, safeEqual, today } from './src/util.js';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(ROOT, 'public');
const PORT = Number(process.env.PORT || 8080);
const HOST = process.env.HOST || '0.0.0.0';
const DATA_DIR = process.env.DATA_DIR || path.join(ROOT, 'data');
const DB_PATH = process.env.DB_PATH || path.join(DATA_DIR, 'vehicle-meter.sqlite');
const APP_PASSWORD = process.env.APP_PASSWORD || '';
const MAX_BODY = Number(process.env.MAX_BODY_BYTES || 30 * 1024 * 1024);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.map': 'application/json; charset=utf-8'
};

function securityHeaders() {
  return {
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'SAMEORIGIN',
    'Referrer-Policy': 'no-referrer',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
    'Content-Security-Policy':
      "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; font-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'"
  };
}

function sendJson(res, status, payload) {
  const body = Buffer.from(
    JSON.stringify(payload, (_, value) => (typeof value === 'bigint' ? Number(value) : value)),
    'utf8'
  );
  res.writeHead(status, {
    ...securityHeaders(),
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': body.length,
    'Cache-Control': 'no-store'
  });
  res.end(body);
}

function sendBuffer(res, status, buffer, contentType, extra = {}) {
  res.writeHead(status, {
    ...securityHeaders(),
    'Content-Type': contentType,
    'Content-Length': buffer.length,
    ...extra
  });
  res.end(buffer);
}

function checkAuth(req) {
  if (!APP_PASSWORD) return true;
  const header = req.headers.authorization || '';
  if (!header.startsWith('Basic ')) return false;
  let decoded = '';
  try {
    decoded = Buffer.from(header.slice(6), 'base64').toString('utf8');
  } catch {
    return false;
  }
  const index = decoded.indexOf(':');
  if (index < 0) return false;
  return safeEqual(decoded.slice(index + 1), APP_PASSWORD);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY) {
        reject(new HttpError(413, '请求体过大'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

async function serveStatic(req, res, pathname) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    sendJson(res, 405, { error: '请求方法不允许' });
    return;
  }
  let decoded;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    sendJson(res, 400, { error: '路径编码无效' });
    return;
  }
  if (decoded.includes('\0')) {
    sendJson(res, 400, { error: '路径无效' });
    return;
  }
  if (decoded === '/') decoded = '/index.html';
  const resolved = path.resolve(PUBLIC_DIR, `.${decoded}`);
  if (resolved !== PUBLIC_DIR && !resolved.startsWith(PUBLIC_DIR + path.sep)) {
    sendJson(res, 403, { error: '禁止访问' });
    return;
  }

  let stat;
  try {
    stat = await fsp.stat(resolved);
  } catch {
    stat = null;
  }
  if (stat?.isDirectory()) {
    const index = path.join(resolved, 'index.html');
    if (fs.existsSync(index)) return serveFile(req, res, index);
  }
  if (!stat?.isFile()) {
    // SPA fallback for extension-less routes
    if (!path.extname(decoded)) return serveFile(req, res, path.join(PUBLIC_DIR, 'index.html'));
    sendJson(res, 404, { error: '文件不存在' });
    return;
  }
  return serveFile(req, res, resolved);
}

function serveFile(req, res, file) {
  return new Promise((resolve) => {
    fs.stat(file, (err, stat) => {
      if (err || !stat.isFile()) {
        sendJson(res, 404, { error: '文件不存在' });
        resolve();
        return;
      }
      const etag = `W/"${stat.size.toString(16)}-${Math.floor(stat.mtimeMs).toString(16)}"`;
      if (req.headers['if-none-match'] === etag) {
        res.writeHead(304, { ...securityHeaders(), ETag: etag, 'Cache-Control': 'no-cache' });
        res.end();
        resolve();
        return;
      }
      const ext = path.extname(file).toLowerCase();
      const type = MIME[ext] || 'application/octet-stream';
      const headers = {
        ...securityHeaders(),
        'Content-Type': type,
        'Content-Length': stat.size,
        'Cache-Control': 'no-cache',
        ETag: etag
      };
      if (req.method === 'HEAD') {
        res.writeHead(200, headers);
        res.end();
        resolve();
        return;
      }
      res.writeHead(200, headers);
      const stream = fs.createReadStream(file);
      stream.on('error', () => res.destroy());
      stream.on('end', resolve);
      stream.pipe(res);
    });
  });
}

function createServer(api) {
  return http.createServer(async (req, res) => {
    const started = Date.now();
    let url;
    try {
      url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    } catch {
      sendJson(res, 400, { error: '请求地址无效' });
      return;
    }

    if (url.pathname === '/api/health') {
      sendJson(res, 200, { ok: true, app: 'vehicle-meter', time: new Date().toISOString() });
      return;
    }

    if (!checkAuth(req)) {
      res.writeHead(401, {
        ...securityHeaders(),
        'WWW-Authenticate': 'Basic realm="Vehicle Meter", charset="UTF-8"',
        'Content-Type': 'text/plain; charset=utf-8'
      });
      res.end('需要访问密码');
      return;
    }

    try {
      if (url.pathname.startsWith('/api/')) {
        let body = null;
        if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {
          const raw = await readBody(req);
          if (raw.length) {
            try {
              body = JSON.parse(raw.toString('utf8'));
            } catch {
              throw new HttpError(400, '请求体不是有效的 JSON');
            }
          }
        }
        const ctx = {
          req,
          res,
          url,
          query: Object.fromEntries(url.searchParams.entries()),
          body,
          params: {},
          sendFile(buffer, filename, contentType) {
            sendBuffer(res, 200, Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer), contentType, {
              'Content-Disposition': contentDisposition(filename),
              'Cache-Control': 'no-store'
            });
          },
          send(buffer, filename, contentType) {
            this.sendFile(buffer, filename, contentType);
          }
        };
        const result = await api(ctx);
        if (!res.headersSent && result !== undefined) sendJson(res, 200, result);
        else if (!res.headersSent) sendJson(res, 204, {});
      } else {
        await serveStatic(req, res, url.pathname);
      }
      if (process.env.LOG_REQUESTS === '1') {
        console.log(`${req.method} ${url.pathname} ${res.statusCode} ${Date.now() - started}ms`);
      }
    } catch (err) {
      if (err instanceof HttpError) {
        if (!res.headersSent) sendJson(res, err.status, { error: err.message, ...(err.details ? { details: err.details } : {}) });
        else res.end();
      } else {
        console.error(`[error] ${req.method} ${url.pathname}`, err);
        if (!res.headersSent) sendJson(res, 500, { error: '服务器内部错误', detail: process.env.NODE_ENV === 'development' ? err.message : undefined });
        else res.end();
      }
    }
  });
}

export async function startServer(options = {}) {
  const port = options.port ?? PORT;
  const host = options.host ?? HOST;
  const dbPath = options.dbPath ?? DB_PATH;
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  if (!fs.existsSync(PUBLIC_DIR)) throw new Error(`前端资源目录不存在：${PUBLIC_DIR}`);
  const db = openDatabase(dbPath);
  const api = createApi({ db });
  const server = createServer(api);
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, resolve);
  });
  const address = server.address();
  const url = `http://127.0.0.1:${address.port}`;
  return {
    server,
    db,
    url,
    dbPath,
    close: () =>
      new Promise((resolve) => {
        server.close(() => {
          try { db.close(); } catch { /* ignore */ }
          resolve();
        });
        setTimeout(resolve, 3000).unref();
      })
  };
}

async function main() {
  if (Number(process.versions.node.split('.')[0]) < 22) {
    console.error('需要 Node.js 22.13 或更高版本（使用内置 node:sqlite）。');
    process.exit(1);
  }
  const instance = await startServer();
  console.log('');
  console.log('  车记 · 用车管理');
  console.log(`  ➜ http://localhost:${instance.server.address().port}`);
  console.log(`  ➜ 数据文件 ${instance.dbPath}`);
  console.log(`  ➜ 访问密码 ${APP_PASSWORD ? '已启用（HTTP Basic Auth）' : '未设置'}`);
  console.log(`  ➜ 时区 ${process.env.TZ || Intl.DateTimeFormat().resolvedOptions().timeZone}`);
  console.log('');

  const shutdown = (signal) => {
    console.log(`\n收到 ${signal}，正在关闭...`);
    instance.close().then(() => process.exit(0));
    setTimeout(() => process.exit(0), 5000).unref();
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

const isEntry = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isEntry) {
  main().catch((err) => {
    console.error('启动失败：', err);
    process.exit(1);
  });
}

export { createServer, DB_PATH, PUBLIC_DIR };
