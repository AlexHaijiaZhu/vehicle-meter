import { CATEGORIES, STATUS_META } from './constants.js';
import { icon } from './icons.js';

let currency = '¥';
let locale = 'zh-CN';

export function configureUi(options = {}) {
  if (options.currency) currency = options.currency;
  if (options.locale) locale = options.locale;
}

export function currencySymbol() {
  return currency;
}

export function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export const attr = esc;

export function fmtMoney(value, options = {}) {
  if (value == null || value === '' || !Number.isFinite(Number(value))) return '—';
  const n = Number(value);
  const digits = options.digits ?? 2;
  const text = new Intl.NumberFormat(locale, {
    minimumFractionDigits: options.trimZero && Number.isInteger(n) ? 0 : digits,
    maximumFractionDigits: digits
  }).format(n);
  return options.symbol === false ? text : `${currency}${text}`;
}

export function fmtCompact(value) {
  if (value == null || !Number.isFinite(Number(value))) return '—';
  const n = Number(value);
  if (Math.abs(n) >= 10000) return `${(n / 10000).toFixed(n >= 100000 ? 0 : 1)}万`;
  return new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(n);
}

export function fmtNum(value, digits = 0) {
  if (value == null || value === '' || !Number.isFinite(Number(value))) return '—';
  return new Intl.NumberFormat(locale, {
    minimumFractionDigits: 0,
    maximumFractionDigits: digits
  }).format(Number(value));
}

export function fmtKm(value) {
  if (value == null || !Number.isFinite(Number(value))) return '—';
  return `${fmtNum(value, 0)} km`;
}

export function fmtQuantity(value, unit = '') {
  if (value == null || !Number.isFinite(Number(value))) return '—';
  return `${fmtNum(value, Number(value) < 100 ? 2 : 1)}${unit ? ` ${unit}` : ''}`;
}

export function parseLocalDate(str) {
  const [y, m, d] = String(str).slice(0, 10).split('-').map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}

export function todayStr() {
  return toIsoDate(new Date());
}

export function toIsoDate(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function addDays(dateStr, days) {
  const date = parseLocalDate(dateStr);
  date.setDate(date.getDate() + days);
  return toIsoDate(date);
}

export function addMonths(dateStr, months) {
  const [y, m, d] = String(dateStr).slice(0, 10).split('-').map(Number);
  const date = new Date(y, m - 1 + months, 1);
  const last = new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
  date.setDate(Math.min(d || 1, last));
  return toIsoDate(date);
}

export function monthRange(month) {
  const [y, m] = month.split('-').map(Number);
  return {
    from: `${month}-01`,
    to: toIsoDate(new Date(y, m, 0))
  };
}

export function fmtDate(value, options = {}) {
  if (!value) return '—';
  const str = String(value).slice(0, 10);
  const [y, m, d] = str.split('-');
  if (!y || !m || !d) return esc(value);
  if (options.short) return `${Number(m)}月${Number(d)}日`;
  return `${y}.${m}.${d}`;
}

export function fmtMonth(month) {
  if (!month) return '—';
  const [y, m] = String(month).split('-');
  return `${y}年${Number(m)}月`;
}

export function relativeDay(value) {
  if (!value) return '';
  const today = todayStr();
  if (value === today) return '今天';
  if (value === addDays(today, -1)) return '昨天';
  if (value === addDays(today, -2)) return '前天';
  const diff = Math.round((parseLocalDate(today) - parseLocalDate(String(value).slice(0, 10))) / 86400000);
  if (diff > 0 && diff < 30) return `${diff} 天前`;
  if (diff < 0 && diff > -30) return `${-diff} 天后`;
  return fmtDate(value, { short: true });
}

export function monthOptions(count = 15, includeAll = false) {
  const now = new Date();
  const items = [];
  if (includeAll) items.push({ value: '', label: '全部时间' });
  for (let i = 0; i < count; i++) {
    const date = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const value = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
    items.push({ value, label: `${date.getFullYear()}年${date.getMonth() + 1}月` });
  }
  return items;
}

export function yearOptions(count = 6) {
  const now = new Date();
  return Array.from({ length: count }, (_, i) => {
    const year = now.getFullYear() - i;
    return { value: String(year), label: `${year}年` };
  });
}

export function trendBadge(value, suffix = '%') {
  if (value == null || !Number.isFinite(Number(value))) return '';
  const v = Number(value);
  const up = v > 0;
  const flat = Math.abs(v) < 0.05;
  return `<span class="trend ${flat ? 'flat' : up ? 'up' : 'down'}">${flat ? '' : icon(up ? 'arrowUp' : 'arrowDown', 12)}${flat ? '持平' : `${fmtNum(Math.abs(v), 1)}${suffix}`}</span>`;
}

export function statusPill(status) {
  const meta = STATUS_META[status] || STATUS_META.unknown;
  return `<span class="pill pill-${meta.color}"><span class="dot"></span>${meta.label}</span>`;
}

export function categoryChip(key, { withLabel = true } = {}) {
  const meta = CATEGORIES[key] || CATEGORIES.other;
  return `<span class="cat-chip" style="--cat:${meta.color}">${icon(meta.icon, 14)}${withLabel ? `<span>${meta.label}</span>` : ''}</span>`;
}

export function energyBadge(energyType) {
  const meta = { fuel: ['燃油', 'amber'], ev: ['纯电', 'green'], phev: ['混动', 'violet'] }[energyType] || ['其他', 'muted'];
  return `<span class="tag tag-${meta[1]}">${meta[0]}</span>`;
}

export function debounce(fn, wait = 260) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), wait);
  };
}

let modalCleanup = null;

export function openModal({ title, subtitle = '', body = '', footer = '', size = 'md', onMount, closable = true, className = '' }) {
  if (modalCleanup) modalCleanup();
  const root = document.getElementById('modalRoot');
  const previousFocus = document.activeElement;
  root.innerHTML = `
    <div class="modal-backdrop" data-modal-backdrop>
      <section class="modal modal-${size} ${className}" role="dialog" aria-modal="true" aria-label="${esc(title)}">
        <header class="modal-head">
          <div>
            <h2>${esc(title)}</h2>
            ${subtitle ? `<p>${esc(subtitle)}</p>` : ''}
          </div>
          ${closable ? `<button class="icon-btn modal-close" type="button" data-modal-close aria-label="关闭">${icon('close', 18)}</button>` : ''}
        </header>
        <div class="modal-body">${body}</div>
        ${footer ? `<footer class="modal-foot">${footer}</footer>` : ''}
      </section>
    </div>`;
  document.body.classList.add('modal-open');

  const backdrop = root.querySelector('[data-modal-backdrop]');
  const modal = root.querySelector('.modal');

  const close = () => {
    if (!root.contains(modal)) return;
    root.innerHTML = '';
    document.body.classList.remove('modal-open');
    document.removeEventListener('keydown', onKey);
    modalCleanup = null;
    if (previousFocus && typeof previousFocus.focus === 'function') {
      try { previousFocus.focus(); } catch { /* ignore */ }
    }
  };

  const onKey = (event) => {
    if (event.key === 'Escape' && closable) close();
  };

  modal.querySelectorAll('[data-modal-close]').forEach((button) => button.addEventListener('click', close));
  backdrop.addEventListener('click', (event) => {
    if (event.target === backdrop && closable) close();
  });
  document.addEventListener('keydown', onKey);
  modalCleanup = close;

  const api = {
    el: modal,
    bodyEl: modal.querySelector('.modal-body'),
    footerEl: modal.querySelector('.modal-foot'),
    close,
    $(selector) { return modal.querySelector(selector); },
    $$(selector) { return [...modal.querySelectorAll(selector)]; }
  };
  if (typeof onMount === 'function') onMount(api);
  const focusTarget = modal.querySelector('[autofocus]') || modal.querySelector('input:not([type=hidden]), select, textarea');
  setTimeout(() => focusTarget?.focus(), 30);
  return api;
}

export function closeModal() {
  if (modalCleanup) modalCleanup();
}

export function confirmDialog({
  title = '请确认',
  message = '',
  confirmText = '确认',
  cancelText = '取消',
  danger = false
} = {}) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    const modal = openModal({
      title,
      size: 'sm',
      body: `<p class="confirm-text">${esc(message)}</p>`,
      footer: `<button class="btn btn-ghost" type="button" data-cancel>${esc(cancelText)}</button>
        <button class="btn ${danger ? 'btn-danger' : 'btn-primary'}" type="button" data-ok>${esc(confirmText)}</button>`,
      onMount: (ctx) => {
        const originalClose = ctx.close;
        const wrapped = () => {
          finish(false);
          originalClose();
        };
        ctx.$('[data-cancel]').addEventListener('click', wrapped);
        ctx.$('[data-ok]').addEventListener('click', () => {
          finish(true);
          originalClose();
        });
        ctx.el.querySelector('[data-modal-close]')?.addEventListener('click', wrapped);
        ctx.$('[data-ok]').focus();
      }
    });
    // Backdrop / Escape close paths resolve false.
    const observer = new MutationObserver(() => {
      if (!document.getElementById('modalRoot').contains(modal.el)) {
        finish(false);
        observer.disconnect();
      }
    });
    observer.observe(document.getElementById('modalRoot'), { childList: true, subtree: true });
  });
}

export function toast(message, type = 'success', duration = 3200) {
  const root = document.getElementById('toastRoot');
  const el = document.createElement('div');
  el.className = `toast toast-${type}`;
  const iconName = type === 'error' ? 'alert' : type === 'info' ? 'info' : 'checkCircle';
  el.innerHTML = `${icon(iconName, 18)}<span>${esc(message)}</span>`;
  root.appendChild(el);
  setTimeout(() => el.classList.add('show'), 10);
  setTimeout(() => {
    el.classList.remove('show');
    setTimeout(() => el.remove(), 220);
  }, duration);
}

export function setBusy(button, busy, busyText = '处理中…') {
  if (!button) return;
  if (busy) {
    if (!button.dataset.originalHtml) button.dataset.originalHtml = button.innerHTML;
    button.disabled = true;
    button.innerHTML = `<span class="spinner"></span>${esc(busyText)}`;
  } else {
    button.disabled = false;
    if (button.dataset.originalHtml) {
      button.innerHTML = button.dataset.originalHtml;
      delete button.dataset.originalHtml;
    }
  }
}

export function emptyState({ iconName = 'info', title = '暂无数据', text = '', action = '' } = {}) {
  return `<div class="empty">
    <div class="empty-icon">${icon(iconName, 28)}</div>
    <h3>${esc(title)}</h3>
    ${text ? `<p>${esc(text)}</p>` : ''}
    ${action ? `<div class="empty-action">${action}</div>` : ''}
  </div>`;
}

export function skeleton(rows = 3) {
  return `<div class="skeleton-list">${Array.from({ length: rows }, () => `<div class="skeleton-row"><span class="sk sk-dot"></span><span class="sk sk-line"></span><span class="sk sk-short"></span></div>`).join('')}</div>`;
}

export function inlineError(message) {
  return `<div class="inline-error">${icon('alert', 16)}<span>${esc(message)}</span></div>`;
}

export function field({ label, name, type = 'text', value = '', placeholder = '', required = false, hint = '', attrs = '', options = null, rows = 3, span = 1 }) {
  const id = `f-${name}`;
  let control = '';
  if (type === 'select') {
    control = `<select id="${id}" name="${name}" ${required ? 'required' : ''} ${attrs}>${(options || [])
      .map((opt) => `<option value="${esc(opt.value)}" ${String(opt.value) === String(value) ? 'selected' : ''}>${esc(opt.label)}</option>`)
      .join('')}</select>`;
  } else if (type === 'textarea') {
    control = `<textarea id="${id}" name="${name}" rows="${rows}" placeholder="${esc(placeholder)}" ${attrs}>${esc(value)}</textarea>`;
  } else {
    control = `<input id="${id}" name="${name}" type="${type}" value="${esc(value)}" placeholder="${esc(placeholder)}" ${required ? 'required' : ''} ${attrs}>`;
  }
  return `<label class="field span-${span}" for="${id}">
    <span class="field-label">${esc(label)}${required ? '<em>*</em>' : ''}</span>
    ${control}
    ${hint ? `<span class="field-hint">${hint}</span>` : ''}
  </label>`;
}

export function selectOptions(items, selected) {
  return items
    .map((item) => `<option value="${esc(item.value)}" ${String(item.value) === String(selected) ? 'selected' : ''}>${esc(item.label)}</option>`)
    .join('');
}

export function copyText(text) {
  if (navigator.clipboard?.writeText) return navigator.clipboard.writeText(text);
  const input = document.createElement('textarea');
  input.value = text;
  input.style.position = 'fixed';
  input.style.opacity = '0';
  document.body.appendChild(input);
  input.select();
  document.execCommand('copy');
  input.remove();
  return Promise.resolve();
}

export function go(route) {
  if (location.hash === `#/${route}`) {
    window.dispatchEvent(new HashChangeEvent('hashchange'));
  } else {
    location.hash = `#/${route}`;
  }
}

export function downloadUrl(url, filename) {
  const link = document.createElement('a');
  link.href = url;
  if (filename) link.download = filename;
  link.rel = 'noopener';
  document.body.appendChild(link);
  link.click();
  link.remove();
}

export function fileToText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('读取文件失败'));
    reader.readAsText(file, 'utf-8');
  });
}

export function statTile(label, value, { sub = '', iconName = '', tone = '', delta = '' } = {}) {
  return `<div class="stat-tile ${tone ? `tone-${tone}` : ''}">
    <div class="stat-top"><span>${esc(label)}</span>${iconName ? `<i class="stat-icon">${icon(iconName, 18)}</i>` : ''}</div>
    <div class="stat-value">${value}</div>
    <div class="stat-sub">${sub}${delta}</div>
  </div>`;
}

export function progressBar(value, tone = '') {
  const pct = Math.max(0, Math.min(100, Math.round(Number(value || 0) * 100)));
  return `<div class="progress ${tone ? `progress-${tone}` : ''}"><span style="width:${pct}%"></span></div>`;
}

export function brand() {
  return `<span class="brand-name">车记</span>`;
}
