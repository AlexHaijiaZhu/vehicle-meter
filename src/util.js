export class HttpError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

export function fail(status, message, details) {
  throw new HttpError(status, message, details);
}

export const CATEGORIES = {
  fuel: { label: '加油', color: '#cb912f', icon: 'fuel' },
  charge: { label: '充电', color: '#0f7b6c', icon: 'bolt' },
  parking: { label: '停车', color: '#2383e2', icon: 'parking' },
  toll: { label: '过路费', color: '#6940a5', icon: 'road' },
  insurance: { label: '保险', color: '#337ea9', icon: 'shield' },
  repair: { label: '维修', color: '#eb5757', icon: 'wrench' },
  wash: { label: '洗车美容', color: '#d9730d', icon: 'sparkles' },
  other: { label: '其他', color: '#9b9a97', icon: 'dots' }
};

export const CATEGORY_LIST = Object.keys(CATEGORIES).map((key) => ({ key, ...CATEGORIES[key] }));

export const ENERGY_TYPES = {
  fuel: { label: '燃油车', energy: 'fuel', unit: 'L', consumptionUnit: 'L/100km' },
  ev: { label: '纯电车', energy: 'charge', unit: 'kWh', consumptionUnit: 'kWh/100km' },
  phev: { label: '插电混动', energy: 'both', unit: 'L / kWh', consumptionUnit: 'L/100km · kWh/100km' }
};

export function round(value, digits = 2) {
  if (value == null || !Number.isFinite(Number(value))) return null;
  const p = 10 ** digits;
  return Math.round(Number(value) * p) / p;
}

export function num(value, fallback = null) {
  if (value === '' || value == null) return fallback;
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

export function int(value, fallback = null) {
  const n = num(value, fallback);
  return n == null ? null : Math.trunc(n);
}

export function str(value, max = 200) {
  if (value == null) return '';
  return String(value).trim().slice(0, max);
}

export function bool(value) {
  return value === true || value === 1 || value === '1' || value === 'true' || value === 'on';
}

export function today() {
  return localDate(new Date());
}

export function localDate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function parseDate(value, field = '日期') {
  if (!value) fail(400, `${field}不能为空`);
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value));
  if (!m) fail(400, `${field}格式应为 YYYY-MM-DD`);
  const [, y, mo, d] = m.map(Number);
  const dt = new Date(y, mo - 1, d);
  if (dt.getFullYear() !== y || dt.getMonth() !== mo - 1 || dt.getDate() !== d) {
    fail(400, `${field}不是有效日期`);
  }
  return `${m[1]}-${m[2]}-${m[3]}`;
}

export function parseMonth(value, field = '月份') {
  if (!value) fail(400, `${field}不能为空`);
  const m = /^(\d{4})-(\d{2})$/.exec(String(value));
  if (!m) fail(400, `${field}格式应为 YYYY-MM`);
  const mo = Number(m[2]);
  if (mo < 1 || mo > 12) fail(400, `${field}不是有效月份`);
  return `${m[1]}-${m[2]}`;
}

export function addMonths(dateStr, months) {
  const [y, m, d] = String(dateStr).split('-').map(Number);
  const target = new Date(y, m - 1 + months, 1);
  const last = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
  target.setDate(Math.min(d || 1, last));
  return localDate(target);
}

export function addDays(dateStr, days) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(y, m - 1, d + days);
  return localDate(dt);
}

export function daysBetween(a, b) {
  const da = new Date(`${a}T00:00:00`);
  const db = new Date(`${b}T00:00:00`);
  return Math.round((db - da) / 86400000);
}

export function monthStart(dateStr) {
  return `${String(dateStr).slice(0, 7)}-01`;
}

export function monthEnd(dateStr) {
  const [y, m] = String(dateStr).split('-').map(Number);
  return localDate(new Date(y, m, 0));
}

export function monthRange(month) {
  return { from: `${month}-01`, to: monthEnd(`${month}-01`) };
}

export function yearRange(year) {
  return { from: `${year}-01-01`, to: `${year}-12-31` };
}

export function lastMonthsEndingToday(count = 3) {
  const end = today();
  return { from: addDays(addMonths(end, -count), 1), to: end };
}

export function monthList(from, to) {
  const out = [];
  let [y, m] = from.slice(0, 7).split('-').map(Number);
  const endKey = to.slice(0, 7);
  for (let i = 0; i < 240; i++) {
    const key = `${y}-${String(m).padStart(2, '0')}`;
    out.push(key);
    if (key >= endKey) break;
    m++;
    if (m > 12) { m = 1; y++; }
  }
  return out;
}

export function monthLabel(key) {
  const [y, m] = key.split('-');
  return `${y}年${Number(m)}月`;
}

export function shortMonth(key) {
  return `${Number(key.slice(5, 7))}月`;
}

export function pct(part, total) {
  if (!total) return 0;
  return round((part / total) * 100, 1);
}

export function toCamel(key) {
  return key.replace(/_([a-z0-9])/g, (_, c) => c.toUpperCase());
}

export function camelize(obj) {
  if (!obj || typeof obj !== 'object') return obj;
  const out = {};
  for (const [k, v] of Object.entries(obj)) out[toCamel(k)] = v;
  return out;
}

export function escapeXml(value) {
  return String(value ?? '')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export function csvCell(value) {
  if (value == null) return '';
  let s = String(value);
  // Guard against spreadsheet formula injection without mangling numeric values.
  if (!/^-?\d+(\.\d+)?$/.test(s) && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  if (/[",\r\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function csv(rows) {
  return '\uFEFF' + rows.map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n';
}

export function contentDisposition(filename) {
  const ascii = filename.replace(/[^\x20-\x7E]/g, '_').replace(/["\\]/g, '_');
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

export function safeEqual(a, b) {
  const ab = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

import { timingSafeEqual } from 'node:crypto';

export function parsePagination(query, defaults = { limit: 100, max: 500 }) {
  const limit = Math.min(Math.max(int(query.limit, defaults.limit) || defaults.limit, 1), defaults.max);
  const offset = Math.max(int(query.offset, 0) || 0, 0);
  return { limit, offset };
}

export function sortByDateDesc(a, b) {
  return String(b.date || '').localeCompare(String(a.date || ''));
}
