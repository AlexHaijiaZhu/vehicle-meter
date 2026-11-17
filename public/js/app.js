import { loadBootstrap, state, currentVehicle, setVehicle, applyTheme, saveSettings, on } from './store.js';
import { ROUTES, ENERGY_TYPES } from './constants.js';
import { icon, logoMark } from './icons.js';
import {
  configureUi,
  esc,
  fmtDate,
  go,
  toast
} from './ui.js';
import { openExpenseModal, openVehicleModal } from './modals.js';
import { initPwa } from './pwa.js';
import * as dashboard from './pages/dashboard.js';
import * as expenses from './pages/expenses.js';
import * as energy from './pages/energy.js';
import * as maintenance from './pages/maintenance.js';
import * as reports from './pages/reports.js';
import * as vehicles from './pages/vehicles.js';
import * as settings from './pages/settings.js';

const PAGES = { dashboard, expenses, energy, maintenance, reports, vehicles, settings };
const DEFAULT_ROUTE = 'dashboard';

const els = {};
let currentRoute = DEFAULT_ROUTE;
let rendering = false;

function resolveRoute() {
  const hash = location.hash.replace(/^#\/?/, '').split('?')[0];
  return PAGES[hash] ? hash : DEFAULT_ROUTE;
}

function updateHeader(routeKey, custom) {
  const meta = ROUTES.find((r) => r.key === routeKey);
  if (custom) {
    els.pageTitle.textContent = custom.title;
    els.pageSubtitle.textContent = custom.subtitle || '';
    document.title = `${custom.title} · 车记`;
    return;
  }
  els.pageTitle.textContent = meta?.title || '车记';
  els.pageSubtitle.textContent = meta?.subtitle || '';
  document.title = `${meta?.title || '车记'} · 车记`;
}

function updateNav(routeKey) {
  els.nav.querySelectorAll('[data-route]').forEach((item) => {
    item.classList.toggle('active', item.dataset.route === routeKey);
  });
}

function updateVehicleSwitch() {
  const vehicle = currentVehicle();
  if (!vehicle) {
    els.vehicleSwitch.innerHTML = `<span class="vehicle-dot" style="--dot:#64748b"></span>
      <div class="vehicle-info"><b>添加车辆</b><span>开始记录用车生活</span></div>
      ${icon('plus', 16)}`;
    return;
  }
  els.vehicleSwitch.innerHTML = `<span class="vehicle-dot" style="--dot:${esc(vehicle.color || '#2563eb')}"></span>
    <div class="vehicle-info"><b>${esc(vehicle.name)}</b><span>${esc(vehicle.plateNo || ENERGY_TYPES[vehicle.energyType]?.label || '车辆')}</span></div>
    ${icon('chevronDown', 16)}`;
}

function buildVehicleMenu() {
  const active = state.vehicles.filter((v) => !v.archived);
  if (!active.length) {
    els.vehicleMenu.innerHTML = `<button class="vehicle-menu-item" data-action="add">${icon('plus', 16)}<span>添加车辆</span></button>`;
    return;
  }
  els.vehicleMenu.innerHTML = `${active.map((vehicle) => `<button class="vehicle-menu-item ${vehicle.id === state.vehicleId ? 'active' : ''}" data-vehicle="${vehicle.id}">
      <span class="vehicle-dot" style="--dot:${esc(vehicle.color || '#2563eb')}"></span>
      <span class="vm-name">${esc(vehicle.name)}<small>${esc(vehicle.plateNo || '')}</small></span>
      ${vehicle.id === state.vehicleId ? icon('check', 15) : ''}
    </button>`).join('')}
    <div class="vehicle-menu-sep"></div>
    <button class="vehicle-menu-item" data-action="manage">${icon('settings', 16)}<span>管理车辆</span></button>
    <button class="vehicle-menu-item" data-action="add">${icon('plus', 16)}<span>添加车辆</span></button>`;
}

function toggleVehicleMenu(force) {
  const open = force ?? els.vehicleMenu.hidden;
  if (open) buildVehicleMenu();
  els.vehicleMenu.hidden = !open;
  els.vehicleSwitch.classList.toggle('open', open);
}

function bindShell() {
  els.nav.querySelectorAll('[data-route]').forEach((item) => {
    item.addEventListener('click', () => {
      document.body.classList.remove('nav-open');
      go(item.dataset.route);
    });
  });
  els.vehicleSwitch.addEventListener('click', (event) => {
    event.stopPropagation();
    if (!state.vehicles.length) {
      go('vehicles');
      return;
    }
    toggleVehicleMenu();
  });
  els.vehicleMenu.addEventListener('click', (event) => {
    const vehicleButton = event.target.closest('[data-vehicle]');
    const actionButton = event.target.closest('[data-action]');
    if (vehicleButton) {
      const id = Number(vehicleButton.dataset.vehicle);
      toggleVehicleMenu(false);
      if (id !== state.vehicleId) {
        setVehicle(id);
      }
    } else if (actionButton) {
      toggleVehicleMenu(false);
      if (actionButton.dataset.action === 'manage') go('vehicles');
      if (actionButton.dataset.action === 'add') {
        openVehicleModal({ onSaved: async () => { await loadBootstrap(); updateVehicleSwitch(); renderCurrent(); } });
      }
    }
  });
  document.addEventListener('click', (event) => {
    if (!els.vehicleMenu.hidden && !event.target.closest('.vehicle-switch') && !event.target.closest('.vehicle-menu')) {
      toggleVehicleMenu(false);
    }
  });
  els.quickAdd.addEventListener('click', () => {
    if (!state.vehicles.length) {
      toast('请先添加一辆车', 'info');
      return;
    }
    openExpenseModal({ onSaved: renderCurrent });
  });
  els.themeBtn.addEventListener('click', async () => {
    const current = document.documentElement.dataset.theme || 'light';
    const next = current === 'dark' ? 'light' : 'dark';
    applyTheme(next);
    updateThemeButton();
    try {
      await saveSettings({ theme: next }, { silent: true });
      toast(next === 'dark' ? '已切换到深色模式' : '已切换到浅色模式');
    } catch (err) {
      toast(err.message, 'error');
    }
  });
  els.menuBtn.addEventListener('click', () => document.body.classList.toggle('nav-open'));
  els.navOverlay.addEventListener('click', () => document.body.classList.remove('nav-open'));
  window.addEventListener('hashchange', () => renderCurrent({ scroll: true }));
}

function updateThemeButton() {
  const dark = document.documentElement.dataset.theme === 'dark';
  els.themeBtn.innerHTML = icon(dark ? 'sun' : 'moon', 18);
  els.themeBtn.title = dark ? '切换到浅色模式' : '切换到深色模式';
}

function renderOnboarding() {
  updateHeader('', { title: '开始使用', subtitle: '三步建立你的用车账本' });
  updateNav('');
  els.page.innerHTML = `<div class="onboarding">
    <div class="onboarding-visual">
      <div class="ob-brand">${logoMark(46)}<div><b>车记</b><span>VEHICLE METER</span></div></div>
      <div class="ob-car">
        <div class="ob-car-top"><span class="ob-dot"></span><span>本月亮相</span></div>
        <strong>7.8<small>L/100km</small></strong>
        <div class="ob-bars">${[38, 55, 44, 72, 58, 84, 62].map((h, i) => `<i style="height:${h}%;animation-delay:${i * 60}ms"></i>`).join('')}</div>
        <div class="ob-kpis"><div><span>本月支出</span><b>¥1,286</b></div><div><span>每公里</span><b>¥0.72</b></div></div>
      </div>
      <p class="ob-caption">费用 · 能耗 · 保养 · 报告</p>
    </div>
    <div class="onboarding-copy">
      <span class="eyebrow">${icon('sparkles', 15)}你的私人用车管家</span>
      <h1>把每一公里<br>都算清楚</h1>
      <p>记录加油、充电、停车与保养，自动计算油耗电耗和每公里成本，生成可分享的月度报告。数据只存在你的 Docker 容器里。</p>
      <div class="onboarding-features">
        <div>${icon('wallet', 18)}<b>费用管理</b><span>八类支出与成本趋势</span></div>
        <div>${icon('gauge', 18)}<b>能耗分析</b><span>满箱法油耗 / 区间电耗</span></div>
        <div>${icon('wrench', 18)}<b>保养提醒</b><span>里程与时间双周期</span></div>
        <div>${icon('report', 18)}<b>分享报告</b><span>月度 / 年度 / 卡片</span></div>
      </div>
      <div class="onboarding-actions">
        <button class="btn btn-primary btn-lg" data-onboard-add>${icon('plus', 18)}添加第一辆车</button>
        <button class="btn btn-soft btn-lg" data-onboard-demo>${icon('sparkles', 18)}先看示例数据</button>
      </div>
      <p class="onboarding-foot">已有备份？前往 <a href="#/settings">数据与设置</a> 恢复。</p>
    </div>
  </div>`;

  els.page.querySelector('[data-onboard-add]').addEventListener('click', () => {
    openVehicleModal({
      onSaved: async () => {
        await loadBootstrap();
        updateVehicleSwitch();
        renderCurrent();
      }
    });
  });
  els.page.querySelector('[data-onboard-demo]').addEventListener('click', async (event) => {
    const button = event.currentTarget;
    button.disabled = true;
    button.innerHTML = `<span class="spinner"></span>生成示例…`;
    try {
      await fetch('/api/demo', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
      await loadBootstrap();
      updateVehicleSwitch();
      toast('示例数据已加载，开始探索吧');
      renderCurrent();
    } catch (err) {
      button.disabled = false;
      button.innerHTML = `${icon('sparkles', 18)}先看示例数据`;
      toast('示例数据加载失败', 'error');
    }
  });
}

async function renderCurrent({ scroll = false } = {}) {
  if (rendering) return;
  rendering = true;
  try {
    currentRoute = resolveRoute();
    const noVehicles = state.vehicles.length === 0;
    if (noVehicles && currentRoute !== 'settings') {
      renderOnboarding();
      if (scroll) window.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }
    updateNav(currentRoute);
    updateHeader(currentRoute);
    updateVehicleSwitch();
    els.page.innerHTML = '';
    if (scroll) window.scrollTo({ top: 0, behavior: 'smooth' });
    const page = PAGES[currentRoute];
    await page.render(els.page);
  } catch (err) {
    console.error(err);
    els.page.innerHTML = `<div class="card"><div class="inline-error">${icon('alert', 18)}<span>${esc(err.message || '页面加载失败')}</span></div></div>`;
    toast(err.message || '页面加载失败', 'error');
  } finally {
    rendering = false;
  }
}

function fatal(message) {
  els.page.innerHTML = `<div class="fatal-card">
    ${icon('alert', 30)}
    <h2>无法加载应用</h2>
    <p>${esc(message)}</p>
    <button class="btn btn-primary" data-reload>重新加载</button>
  </div>`;
  els.page.querySelector('[data-reload]')?.addEventListener('click', () => location.reload());
}

async function init() {
  els.pageTitle = document.getElementById('pageTitle');
  els.pageSubtitle = document.getElementById('pageSubtitle');
  els.nav = document.getElementById('nav');
  els.vehicleSwitch = document.getElementById('vehicleSwitch');
  els.vehicleMenu = document.getElementById('vehicleMenu');
  els.quickAdd = document.getElementById('quickAdd');
  els.themeBtn = document.getElementById('themeBtn');
  els.menuBtn = document.getElementById('menuBtn');
  els.navOverlay = document.getElementById('navOverlay');
  els.page = document.getElementById('page');

  document.getElementById('nav').innerHTML = ROUTES.map((route) => `<button class="nav-item" data-route="${route.key}">
    <span class="nav-icon">${icon(route.icon, 19)}</span>
    <span class="nav-label">${route.label}</span>
    <span class="nav-glow"></span>
  </button>`).join('');

  els.menuBtn.innerHTML = icon('menu', 20);
  document.getElementById('todayChip').textContent = fmtDate(new Date().toISOString().slice(0, 10), { short: true });
  initPwa();

  try {
    await loadBootstrap();
    configureUi({ currency: state.settings.currency || '¥' });
    applyTheme(state.settings.theme || 'light');
    updateThemeButton();
    updateVehicleSwitch();
    bindShell();
    on('vehicle', () => {
      updateVehicleSwitch();
      renderCurrent();
    });
    on('settings', () => {
      configureUi({ currency: state.settings.currency || '¥' });
      updateThemeButton();
    });
    renderCurrent();
  } catch (err) {
    fatal(err.message);
  }
}

init();
