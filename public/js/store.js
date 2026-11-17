import { api } from './api.js';
import { configureUi } from './ui.js';

const VEHICLE_KEY = 'vm.vehicleId';
const listeners = new Map();

export const state = {
  bootstrapped: false,
  app: { name: '车记', version: '1.0.0' },
  today: '',
  vehicles: [],
  vehicleId: null,
  settings: {},
  categories: [],
  energyTypes: {},
  defaultVehicleId: null,
  counts: { vehicles: 0, expenses: 0, plans: 0, records: 0 }
};

export function on(event, handler) {
  if (!listeners.has(event)) listeners.set(event, new Set());
  listeners.get(event).add(handler);
  return () => listeners.get(event)?.delete(handler);
}

export function emit(event, payload) {
  for (const handler of listeners.get(event) || []) {
    try { handler(payload); } catch (err) { console.error(err); }
  }
}

export function currentVehicle() {
  return state.vehicles.find((vehicle) => vehicle.id === state.vehicleId) || null;
}

export function vehicleById(id) {
  return state.vehicles.find((vehicle) => vehicle.id === Number(id)) || null;
}

export function setVehicle(id) {
  const vehicle = state.vehicles.find((v) => v.id === Number(id));
  if (!vehicle) return;
  state.vehicleId = vehicle.id;
  try { localStorage.setItem(VEHICLE_KEY, String(vehicle.id)); } catch { /* ignore */ }
  emit('vehicle', vehicle);
}

export function applyTheme(theme) {
  const resolved = theme === 'auto'
    ? (window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
    : theme || 'light';
  document.documentElement.dataset.theme = resolved;
  document.documentElement.dataset.themeSetting = theme || 'light';
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', resolved === 'dark' ? '#191919' : '#f7f7f5');
}

export function configure(settings) {
  configureUi({ currency: settings.currency || '¥' });
  applyTheme(settings.theme || 'light');
}

export async function loadBootstrap() {
  const data = await api.get('/api/bootstrap');
  state.app = data.app;
  state.today = data.today;
  state.vehicles = data.vehicles || [];
  state.settings = data.settings || {};
  state.categories = data.categories || [];
  state.energyTypes = data.energyTypes || {};
  state.defaultVehicleId = data.defaultVehicleId;
  state.counts = data.counts || state.counts;
  state.bootstrapped = true;

  configure(state.settings);

  const saved = Number(localStorage.getItem(VEHICLE_KEY));
  const activeVehicles = state.vehicles;
  const preferred = activeVehicles.find((v) => v.id === saved && !v.archived)
    || activeVehicles.find((v) => v.id === state.defaultVehicleId && !v.archived)
    || activeVehicles.find((v) => !v.archived)
    || activeVehicles[0]
    || null;
  state.vehicleId = preferred?.id ?? null;
  if (state.vehicleId) {
    try { localStorage.setItem(VEHICLE_KEY, String(state.vehicleId)); } catch { /* ignore */ }
  }
  emit('bootstrap', state);
  return state;
}

export async function saveSettings(patch, { silent = false } = {}) {
  const data = await api.put('/api/settings', patch);
  state.settings = data.settings;
  configure(state.settings);
  emit('settings', state.settings);
  if (!silent) emit('settings-saved', patch);
  return state.settings;
}

export function markOnboarded() {
  state.settings.onboarded = '1';
}

if (window.matchMedia) {
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', () => {
    if (document.documentElement.dataset.themeSetting === 'auto') applyTheme('auto');
  });
}
