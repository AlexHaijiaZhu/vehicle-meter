import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { camelize } from './util.js';

const SCHEMA_VERSION = 2;

const SETTINGS_DEFAULTS = {
  currency: '¥',
  theme: 'light',
  app_name: '车记',
  webdav_url: '',
  webdav_username: '',
  webdav_password: '',
  webdav_path: 'vehicle-meter/backup.json',
  webdav_last_sync: '',
  webdav_last_restore: '',
  onboarded: '0'
};

const PUBLIC_SETTINGS = new Set(['currency', 'theme', 'app_name', 'webdav_url', 'webdav_username', 'webdav_path', 'webdav_last_sync', 'webdav_last_restore', 'onboarded']);

export function openDatabase(file) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;
    PRAGMA busy_timeout = 5000;
    PRAGMA synchronous = NORMAL;
  `);
  migrate(db);
  ensureSettings(db);
  return db;
}

function ensureColumn(db, table, column, definition) {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all();
  if (!columns.some((item) => item.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

function migrate(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS vehicles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      plate_no TEXT NOT NULL DEFAULT '',
      brand_model TEXT NOT NULL DEFAULT '',
      energy_type TEXT NOT NULL DEFAULT 'fuel',
      fuel_type TEXT NOT NULL DEFAULT '',
      tank_capacity REAL,
      battery_capacity REAL,
      purchase_date TEXT,
      initial_odometer REAL NOT NULL DEFAULT 0,
      color TEXT NOT NULL DEFAULT '#2383e2',
      notes TEXT NOT NULL DEFAULT '',
      is_default INTEGER NOT NULL DEFAULT 0,
      archived INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS expenses (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      vehicle_id INTEGER NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
      category TEXT NOT NULL,
      amount REAL NOT NULL,
      occurred_on TEXT NOT NULL,
      odometer REAL,
      quantity REAL,
      unit_price REAL,
      fuel_type TEXT NOT NULL DEFAULT '',
      station TEXT NOT NULL DEFAULT '',
      note TEXT NOT NULL DEFAULT '',
      full_tank INTEGER NOT NULL DEFAULT 0,
      source TEXT NOT NULL DEFAULT 'manual',
      external_id TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_expenses_vehicle_date ON expenses(vehicle_id, occurred_on DESC);
    CREATE INDEX IF NOT EXISTS idx_expenses_category ON expenses(category);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_expenses_external ON expenses(vehicle_id, external_id)
      WHERE external_id IS NOT NULL AND external_id <> '';

    CREATE TABLE IF NOT EXISTS maintenance_plans (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      vehicle_id INTEGER NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      interval_mileage REAL,
      interval_months INTEGER,
      last_service_on TEXT,
      last_service_odometer REAL,
      next_due_on TEXT,
      next_due_odometer REAL,
      items TEXT NOT NULL DEFAULT '',
      notify_days INTEGER NOT NULL DEFAULT 30,
      active INTEGER NOT NULL DEFAULT 1,
      notes TEXT NOT NULL DEFAULT '',
      source TEXT NOT NULL DEFAULT 'manual',
      source_url TEXT NOT NULL DEFAULT '',
      external_id TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_plans_vehicle ON maintenance_plans(vehicle_id);

    CREATE TABLE IF NOT EXISTS maintenance_records (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      vehicle_id INTEGER NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
      plan_id INTEGER REFERENCES maintenance_plans(id) ON DELETE SET NULL,
      service_on TEXT NOT NULL,
      odometer REAL,
      items TEXT NOT NULL DEFAULT '',
      cost REAL NOT NULL DEFAULT 0,
      shop TEXT NOT NULL DEFAULT '',
      note TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_records_vehicle_date ON maintenance_records(vehicle_id, service_on DESC);

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL DEFAULT ''
    );
  `);

  // v2: official / agent sourced maintenance plans
  ensureColumn(db, 'maintenance_plans', 'source', "TEXT NOT NULL DEFAULT 'manual'");
  ensureColumn(db, 'maintenance_plans', 'source_url', "TEXT NOT NULL DEFAULT ''");
  ensureColumn(db, 'maintenance_plans', 'external_id', 'TEXT');
  db.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_plans_external ON maintenance_plans(vehicle_id, external_id)
      WHERE external_id IS NOT NULL AND external_id <> '';
  `);
  db.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`);
}

function ensureSettings(db) {
  const insert = db.prepare('INSERT OR IGNORE INTO settings(key, value) VALUES (?, ?)');
  db.exec('BEGIN');
  try {
    for (const [key, value] of Object.entries(SETTINGS_DEFAULTS)) insert.run(key, value);
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

export function nowIso() {
  return new Date().toISOString();
}

export function transaction(db, fn) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    try { db.exec('ROLLBACK'); } catch { /* ignore */ }
    throw err;
  }
}

export function getSettings(db, { includeSecrets = false } = {}) {
  const rows = db.prepare('SELECT key, value FROM settings').all();
  const out = {};
  for (const row of rows) {
    if (!includeSecrets && row.key === 'webdav_password') continue;
    out[camelize(row.key)] = row.value;
  }
  if (!includeSecrets) out.webdavHasPassword = Boolean(rows.find((r) => r.key === 'webdav_password')?.value);
  return out;
}

export function getSetting(db, key) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row?.value ?? SETTINGS_DEFAULTS[key] ?? '';
}

export function setSettings(db, patch) {
  const insert = db.prepare(
    'INSERT INTO settings(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
  );
  const allowed = new Set(Object.keys(SETTINGS_DEFAULTS));
  const changed = [];
  transaction(db, () => {
    for (const [key, value] of Object.entries(patch || {})) {
      if (!allowed.has(key)) continue;
      if (['webdav_url', 'webdav_username', 'webdav_password', 'webdav_path'].includes(key) && value === undefined) continue;
      insert.run(key, value == null ? '' : String(value));
      changed.push(key);
    }
  });
  return changed;
}

export function publicSettings(db) {
  const all = getSettings(db, { includeSecrets: true });
  const out = {};
  for (const [key, value] of Object.entries(all)) {
    if (PUBLIC_SETTINGS.has(key.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`))) out[key] = value;
  }
  out.webdavHasPassword = Boolean(all.webdavPassword);
  return out;
}

export function rowVehicle(row) {
  if (!row) return null;
  return {
    ...camelize(row),
    isDefault: Boolean(row.is_default),
    archived: Boolean(row.archived)
  };
}

export function rowExpense(row) {
  if (!row) return null;
  return {
    ...camelize(row),
    fullTank: Boolean(row.full_tank)
  };
}

export function rowPlan(row) {
  if (!row) return null;
  return {
    ...camelize(row),
    active: Boolean(row.active)
  };
}

export function rowRecord(row) {
  return row ? camelize(row) : null;
}

export function listVehicles(db, { includeArchived = false } = {}) {
  const rows = db
    .prepare(`SELECT * FROM vehicles ${includeArchived ? '' : 'WHERE archived = 0'} ORDER BY is_default DESC, id ASC`)
    .all();
  return rows.map(rowVehicle);
}

export function getVehicle(db, id) {
  const row = db.prepare('SELECT * FROM vehicles WHERE id = ?').get(Number(id));
  return rowVehicle(row);
}

export function getExpense(db, id) {
  const row = db.prepare('SELECT * FROM expenses WHERE id = ?').get(Number(id));
  return rowExpense(row);
}

export function getPlan(db, id) {
  const row = db.prepare('SELECT * FROM maintenance_plans WHERE id = ?').get(Number(id));
  return rowPlan(row);
}

export function getRecord(db, id) {
  const row = db.prepare('SELECT * FROM maintenance_records WHERE id = ?').get(Number(id));
  return rowRecord(row);
}

export function counts(db) {
  const one = (sql) => Number(db.prepare(sql).get()?.n || 0);
  return {
    vehicles: one('SELECT COUNT(*) AS n FROM vehicles WHERE archived = 0'),
    expenses: one('SELECT COUNT(*) AS n FROM expenses'),
    plans: one('SELECT COUNT(*) AS n FROM maintenance_plans WHERE active = 1'),
    records: one('SELECT COUNT(*) AS n FROM maintenance_records')
  };
}

export { SETTINGS_DEFAULTS, PUBLIC_SETTINGS, SCHEMA_VERSION };
