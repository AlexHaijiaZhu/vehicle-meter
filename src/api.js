import {
  CATEGORIES,
  CATEGORY_LIST,
  ENERGY_TYPES,
  HttpError,
  addDays,
  addMonths,
  bool,
  contentDisposition,
  csv,
  fail,
  int,
  monthEnd,
  monthRange,
  num,
  parseDate,
  parseMonth,
  parsePagination,
  round,
  str,
  today,
  yearRange
} from './util.js';
import {
  getExpense,
  getPlan,
  getRecord,
  getSetting,
  getSettings,
  getVehicle,
  listVehicles,
  nowIso,
  publicSettings,
  rowExpense,
  rowPlan,
  rowRecord,
  rowVehicle,
  setSettings,
  transaction
} from './db.js';
import {
  cardData,
  costStats,
  dashboardData,
  energyStats,
  latestOdometer,
  listPlanStatuses,
  mileageInRange,
  nextMaintenance,
  planStatus,
  previousRange
} from './stats.js';
import { buildXlsx, zip } from './xlsx.js';
import { WebDavClient } from './webdav.js';
import { seedDemo } from './demo.js';

const APP_VERSION = '1.0.0';
const MAX_BACKUP_BYTES = 30 * 1024 * 1024;

const CATEGORY_ALIASES = {
  fuel: 'fuel', gas: 'fuel', gasoline: 'fuel', refuel: 'fuel', 加油: 'fuel', 油费: 'fuel',
  charge: 'charge', charging: 'charge', ev: 'charge', electricity: 'charge', 充电: 'charge', 电费: 'charge',
  parking: 'parking', park: 'parking', 停车: 'parking', 停车费: 'parking',
  toll: 'toll', 过路: 'toll', 过路费: 'toll', 高速: 'toll',
  insurance: 'insurance', 保险: 'insurance',
  repair: 'repair', 维修: 'repair',
  wash: 'wash', carwash: 'wash', 洗车: 'wash', 美容: 'wash',
  other: 'other', 其他: 'other'
};

const SOURCE_LABELS = {
  manual: '手动录入',
  agent: 'Agent 录入',
  import: '导入',
  demo: '示例数据'
};

const CATEGORY_KEYS = Object.keys(CATEGORIES);

function compile(pattern) {
  const keys = [];
  const source = pattern.replace(/[.*+?^${}()|[\]\\]/g, (m) => (m === ':' ? ':' : `\\${m}`));
  const regex = new RegExp(
    `^${source.replace(/:([A-Za-z]+)/g, (_, key) => {
      keys.push(key);
      return '([^/]+)';
    })}$`
  );
  return { regex, keys };
}

function rangeFromQuery(query, fallback) {
  const from = query.from ? parseDate(query.from, '开始日期') : fallback?.from;
  const to = query.to ? parseDate(query.to, '结束日期') : fallback?.to;
  if (from && to && from > to) fail(400, '开始日期不能晚于结束日期');
  return { from, to };
}

function vehicleOrFail(db, id) {
  const vehicle = getVehicle(db, id);
  if (!vehicle) fail(404, '车辆不存在');
  return vehicle;
}

function activeVehicleOrFail(db, id) {
  const vehicle = vehicleOrFail(db, id);
  if (vehicle.archived) fail(409, '该车辆已归档，无法新增记录');
  return vehicle;
}

function normalizeVehicle(input, existing = null) {
  const name = str(input.name ?? existing?.name, 40);
  if (!name) fail(400, '车辆名称不能为空');
  const energyType = str(input.energyType ?? input.energy_type ?? existing?.energyType ?? 'fuel', 10);
  if (!ENERGY_TYPES[energyType]) fail(400, '能源类型无效');
  const fuelType = str(input.fuelType ?? input.fuel_type ?? existing?.fuelType, 20);
  const plateNo = str(input.plateNo ?? input.plate_no ?? existing?.plateNo, 20);
  const brandModel = str(input.brandModel ?? input.brand_model ?? existing?.brandModel, 60);
  const color = /^#[0-9a-fA-F]{6}$/.test(input.color || '') ? input.color : existing?.color || '#2383e2';
  const initialOdometer = num(input.initialOdometer ?? input.initial_odometer ?? existing?.initialOdometer, 0);
  if (initialOdometer == null || initialOdometer < 0) fail(400, '初始里程不能为负数');
  const tankCapacity = num(input.tankCapacity ?? input.tank_capacity ?? existing?.tankCapacity);
  const batteryCapacity = num(input.batteryCapacity ?? input.battery_capacity ?? existing?.batteryCapacity);
  if (tankCapacity != null && tankCapacity < 0) fail(400, '油箱容量不能为负数');
  if (batteryCapacity != null && batteryCapacity < 0) fail(400, '电池容量不能为负数');
  const purchaseDateRaw = input.purchaseDate ?? input.purchase_date ?? existing?.purchaseDate;
  const purchaseDate = purchaseDateRaw ? parseDate(purchaseDateRaw, '购车日期') : null;

  return {
    name,
    plateNo,
    brandModel,
    energyType,
    fuelType,
    tankCapacity: tankCapacity == null ? null : round(tankCapacity, 1),
    batteryCapacity: batteryCapacity == null ? null : round(batteryCapacity, 1),
    purchaseDate,
    initialOdometer: round(initialOdometer, 1),
    color,
    notes: str(input.notes ?? existing?.notes, 500),
    isDefault: input.isDefault == null && input.is_default == null ? Boolean(existing?.isDefault) : bool(input.isDefault ?? input.is_default),
    archived: input.archived == null ? Boolean(existing?.archived) : bool(input.archived)
  };
}

function normalizeExpense(input, existing = null) {
  const vehicleId = Number(input.vehicleId ?? input.vehicle_id ?? existing?.vehicleId);
  if (!vehicleId) fail(400, '缺少车辆');
  const rawCategory = str(input.category ?? existing?.category ?? 'fuel', 30).toLowerCase();
  const category = CATEGORY_ALIASES[rawCategory] || rawCategory;
  if (!CATEGORY_KEYS.includes(category)) fail(400, `费用类别无效：${rawCategory}`);

  const dateRaw = input.occurredOn ?? input.occurred_on ?? input.date ?? existing?.occurredOn ?? today();
  const occurredOn = parseDate(dateRaw, '费用日期');

  let amount = num(input.amount ?? input.total ?? existing?.amount);
  let quantity = num(input.quantity ?? input.liters ?? input.volume ?? input.kwh ?? existing?.quantity);
  let unitPrice = num(input.unitPrice ?? input.unit_price ?? input.pricePerUnit ?? existing?.unitPrice);

  if (quantity != null && quantity < 0) fail(400, '数量不能为负数');
  if (unitPrice != null && unitPrice < 0) fail(400, '单价不能为负数');
  if (amount == null && quantity != null && unitPrice != null) amount = quantity * unitPrice;
  if (quantity == null && amount != null && unitPrice != null && unitPrice > 0) quantity = amount / unitPrice;
  if (unitPrice == null && amount != null && quantity != null && quantity > 0) unitPrice = amount / quantity;
  if (amount == null || !Number.isFinite(amount)) fail(400, '金额不能为空');

  amount = round(amount, 2);
  quantity = quantity == null ? null : round(quantity, 3);
  unitPrice = unitPrice == null ? null : round(unitPrice, 3);

  if (amount <= 0) fail(400, '金额必须大于 0');
  if (amount > 10000000) fail(400, '金额超出合理范围');

  const odometer = num(input.odometer ?? input.mileage ?? existing?.odometer);
  if (odometer != null && odometer < 0) fail(400, '里程不能为负数');
  const isEnergy = category === 'fuel' || category === 'charge';

  return {
    vehicleId,
    category,
    amount,
    occurredOn,
    odometer: odometer == null ? null : round(odometer, 1),
    quantity: isEnergy ? quantity : null,
    unitPrice: isEnergy ? unitPrice : null,
    fuelType: isEnergy ? str(input.fuelType ?? input.fuel_type ?? input.grade ?? existing?.fuelType, 20) : '',
    station: str(input.station ?? input.merchant ?? input.shop ?? input.vendor ?? existing?.station, 120),
    note: str(input.note ?? existing?.note, 500),
    fullTank: isEnergy ? bool(input.fullTank ?? input.full_tank ?? input.full ?? existing?.fullTank) : false,
    source: ['manual', 'agent', 'import', 'demo'].includes(str(input.source ?? existing?.source ?? 'manual', 20))
      ? str(input.source ?? existing?.source ?? 'manual', 20)
      : 'manual',
    externalId: str(input.externalId ?? input.external_id ?? input.idempotencyKey ?? existing?.externalId, 100)
  };
}

function normalizePlan(input, existing = null) {
  const vehicleId = Number(input.vehicleId ?? input.vehicle_id ?? existing?.vehicleId);
  if (!vehicleId) fail(400, '缺少车辆');
  const name = str(input.name ?? existing?.name, 60);
  if (!name) fail(400, '保养项目名称不能为空');

  const intervalMileage = num(input.intervalMileage ?? input.interval_mileage ?? existing?.intervalMileage);
  const intervalMonths = int(input.intervalMonths ?? input.interval_months ?? existing?.intervalMonths);
  if (intervalMileage != null && intervalMileage < 0) fail(400, '周期里程不能为负数');
  if (intervalMonths != null && intervalMonths < 0) fail(400, '周期月数不能为负数');

  const lastServiceOnRaw = input.lastServiceOn ?? input.last_service_on ?? existing?.lastServiceOn;
  const lastServiceOn = lastServiceOnRaw ? parseDate(lastServiceOnRaw, '上次保养日期') : null;
  const lastServiceOdometer = num(
    input.lastServiceOdometer ?? input.last_service_odometer ?? existing?.lastServiceOdometer
  );
  if (lastServiceOdometer != null && lastServiceOdometer < 0) fail(400, '上次保养里程不能为负数');

  const nextDueOnRaw = input.nextDueOn ?? input.next_due_on ?? existing?.nextDueOn;
  const nextDueOn = nextDueOnRaw ? parseDate(nextDueOnRaw, '下次到期日期') : null;
  const nextDueOdometer = num(input.nextDueOdometer ?? input.next_due_odometer ?? existing?.nextDueOdometer);
  if (nextDueOdometer != null && nextDueOdometer < 0) fail(400, '下次到期里程不能为负数');

  if (!intervalMileage && !intervalMonths && !nextDueOn && !nextDueOdometer) {
    fail(400, '请至少设置一个保养周期或到期条件');
  }
  const notifyDays = int(input.notifyDays ?? input.notify_days ?? existing?.notifyDays, 30);
  if (notifyDays == null || notifyDays < 1 || notifyDays > 365) fail(400, '提醒天数需在 1-365 之间');

  const sourceRaw = str(input.source ?? existing?.source ?? 'manual', 20);
  const source = ['manual', 'agent', 'official', 'import'].includes(sourceRaw) ? sourceRaw : 'manual';
  const sourceUrlRaw = str(input.sourceUrl ?? input.source_url ?? existing?.sourceUrl, 500);
  let sourceUrl = '';
  if (sourceUrlRaw) {
    try {
      const parsed = new URL(sourceUrlRaw);
      if (!['http:', 'https:'].includes(parsed.protocol)) fail(400, '来源链接必须是 http/https');
      sourceUrl = parsed.toString();
    } catch {
      fail(400, '来源链接格式不正确');
    }
  }
  const externalId = str(input.externalId ?? input.external_id ?? input.idempotencyKey ?? existing?.externalId, 100);

  return {
    vehicleId,
    name,
    intervalMileage: intervalMileage ? round(intervalMileage, 0) : null,
    intervalMonths: intervalMonths || null,
    lastServiceOn,
    lastServiceOdometer: lastServiceOdometer == null ? null : round(lastServiceOdometer, 1),
    nextDueOn,
    nextDueOdometer: nextDueOdometer == null ? null : round(nextDueOdometer, 0),
    items: str(input.items ?? existing?.items, 300),
    notifyDays,
    active: input.active == null ? existing?.active ?? true : bool(input.active),
    notes: str(input.notes ?? existing?.notes, 500),
    source,
    sourceUrl,
    externalId
  };
}

function normalizeRecord(db, input, existing = null) {
  const vehicleId = Number(input.vehicleId ?? input.vehicle_id ?? existing?.vehicleId);
  if (!vehicleId) fail(400, '缺少车辆');
  const serviceOn = parseDate(input.serviceOn ?? input.service_on ?? input.date ?? existing?.serviceOn ?? today(), '保养日期');
  const odometer = num(input.odometer ?? existing?.odometer);
  if (odometer != null && odometer < 0) fail(400, '里程不能为负数');
  const cost = num(input.cost ?? input.amount ?? existing?.cost, 0);
  if (cost == null || cost < 0) fail(400, '费用不能为负数');
  const planIdRaw = input.planId ?? input.plan_id ?? existing?.planId;
  const planId = planIdRaw == null || planIdRaw === '' ? null : Number(planIdRaw);
  if (planId != null) {
    const plan = getPlan(db, planId);
    if (!plan) fail(400, '关联的保养计划不存在');
    if (Number(plan.vehicleId) !== Number(vehicleId)) fail(400, '保养计划与车辆不匹配');
  }

  return {
    vehicleId,
    planId,
    serviceOn,
    odometer: odometer == null ? null : round(odometer, 1),
    items: str(input.items ?? existing?.items, 300),
    cost: round(cost, 2),
    shop: str(input.shop ?? input.station ?? existing?.shop, 120),
    note: str(input.note ?? existing?.note, 500)
  };
}

function categorySummary(rows) {
  const map = new Map();
  for (const row of rows) {
    const key = row.category;
    if (!map.has(key)) map.set(key, { key, ...(CATEGORIES[key] || { label: key, color: '#94a3b8' }), amount: 0, count: 0 });
    const item = map.get(key);
    item.amount += Number(row.amount) || 0;
    item.count++;
  }
  return [...map.values()].map((item) => ({ ...item, amount: round(item.amount, 2) }));
}

function resolveAgentVehicle(db, input) {
  const vehicles = listVehicles(db);
  if (!vehicles.length) fail(400, '系统里还没有车辆，请先在界面中添加');
  if (input.vehicleId != null || input.vehicle_id != null) {
    const vehicle = getVehicle(db, Number(input.vehicleId ?? input.vehicle_id));
    if (!vehicle) fail(400, 'vehicleId 对应的车辆不存在');
    if (vehicle.archived) fail(409, '车辆已归档');
    return vehicle;
  }
  const plate = str(input.vehiclePlate ?? input.vehicle_plate ?? input.plate, 30);
  const name = str(input.vehicleName ?? input.vehicle_name, 40);
  if (plate) {
    const matches = vehicles.filter((v) => v.plateNo.toLowerCase() === plate.toLowerCase());
    if (matches.length === 1) return matches[0];
    if (matches.length > 1) fail(409, '车牌匹配到多辆车，请改用 vehicleId');
    fail(400, `没有找到车牌为 ${plate} 的车辆`);
  }
  if (name) {
    const matches = vehicles.filter((v) => v.name.toLowerCase() === name.toLowerCase());
    if (matches.length === 1) return matches[0];
    if (matches.length > 1) fail(409, '车辆名称匹配到多辆车，请改用 vehicleId');
    fail(400, `没有找到名称为 ${name} 的车辆`);
  }
  const defaults = vehicles.filter((v) => v.isDefault);
  if (defaults.length === 1) return defaults[0];
  if (vehicles.length === 1) return vehicles[0];
  fail(400, '有多辆车，请通过 vehicleId 或 vehiclePlate 指定');
}

export function createApi({ db, config = {} }) {
  const routes = [];

  function route(method, pattern, handler) {
    routes.push({ method, pattern, ...compile(pattern), handler });
  }

  function vehicleFromQuery(query, { allowAll = false } = {}) {
    const id = query.vehicleId ?? query.vehicle_id;
    if (id) {
      return { vehicle: activeVehicleOrFail(db, id), all: false };
    }
    if (allowAll) return { vehicle: null, all: true };
    const vehicles = listVehicles(db);
    if (!vehicles.length) fail(400, '请先添加车辆');
    const preferred = vehicles.find((v) => v.isDefault) || vehicles[0];
    return { vehicle: preferred, all: false };
  }

  function resolveReportRange(query) {
    const period = str(query.period || 'month', 20);
    if (period === 'month') {
      const month = parseMonth(query.month || today().slice(0, 7));
      return { period, month, ...monthRange(month), label: `${month.slice(0, 4)}年${Number(month.slice(5, 7))}月` };
    }
    if (period === 'year') {
      const year = String(query.year || today().slice(0, 4));
      if (!/^\d{4}$/.test(year)) fail(400, '年份格式应为 YYYY');
      return { period, year, ...yearRange(year), label: `${year}年` };
    }
    if (period === 'all') {
      const firstExpense = db.prepare('SELECT MIN(occurred_on) AS d FROM expenses WHERE vehicle_id = ?').get(query.vehicleId)?.d;
      const firstRecord = db.prepare('SELECT MIN(service_on) AS d FROM maintenance_records WHERE vehicle_id = ?').get(query.vehicleId)?.d;
      const vehicle = query.vehicleId ? getVehicle(db, query.vehicleId) : null;
      const candidates = [firstExpense, firstRecord, vehicle?.purchaseDate, vehicle?.createdAt?.slice(0, 10)].filter(Boolean).sort();
      return {
        period,
        from: candidates[0] || addDays(today(), -365),
        to: today(),
        label: '累计用车报告'
      };
    }
    if (period === 'custom') {
      const { from, to } = rangeFromQuery(query, { from: monthStartOf(today()), to: today() });
      if (!from || !to) fail(400, '自定义报告需要开始和结束日期');
      return { period, from, to, label: `${from} 至 ${to}` };
    }
    fail(400, '报告周期无效');
  }

  function monthStartOf(date) {
    return `${date.slice(0, 7)}-01`;
  }

  // ——————————————————————— 基础信息 ———————————————————————
  route('GET', '/api/health', () => ({ ok: true, app: 'vehicle-meter', version: APP_VERSION, time: nowIso() }));

  route('GET', '/api/bootstrap', () => {
    const vehicles = listVehicles(db);
    return {
      app: { name: '车记', version: APP_VERSION },
      today: today(),
      vehicles,
      defaultVehicleId: vehicles.find((v) => v.isDefault)?.id ?? vehicles[0]?.id ?? null,
      settings: publicSettings(db),
      categories: CATEGORY_LIST,
      energyTypes: ENERGY_TYPES,
      sources: SOURCE_LABELS,
      counts: {
        vehicles: vehicles.length,
        expenses: db.prepare('SELECT COUNT(*) AS n FROM expenses').get().n,
        plans: db.prepare('SELECT COUNT(*) AS n FROM maintenance_plans WHERE active = 1').get().n,
        records: db.prepare('SELECT COUNT(*) AS n FROM maintenance_records').get().n
      }
    };
  });

  // ——————————————————————— 车辆 ———————————————————————
  route('GET', '/api/vehicles', (ctx) => {
    const includeArchived = bool(ctx.query.includeArchived);
    return { items: listVehicles(db, { includeArchived }) };
  });

  route('GET', '/api/vehicles/summary', () => {
    const items = listVehicles(db, { includeArchived: true }).map((vehicle) => {
      const all = costStats(db, vehicle, '2000-01-01', today());
      const energyFrom = addDays(addMonths(today(), -12), 1);
      const energy = energyStats(db, vehicle, energyFrom, today());
      const next = nextMaintenance(db, vehicle);
      return {
        ...vehicle,
        latestOdometer: latestOdometer(db, vehicle),
        lifetimeCost: all.total,
        last12Cost: costStats(db, vehicle, energyFrom, today()).total,
        fuel: energy.fuel ? { avgConsumption: energy.fuel.avgConsumption, cost: energy.fuel.cost } : null,
        charge: energy.charge ? { avgConsumption: energy.charge.avgConsumption, cost: energy.charge.cost } : null,
        nextMaintenance: next
          ? {
              name: next.name,
              dueDate: next.dueDate,
              dueOdo: next.dueOdo,
              remainingKm: next.remainingKm,
              remainingDays: next.remainingDays,
              status: next.status,
              label: next.label
            }
          : null,
        expenseCount: db.prepare('SELECT COUNT(*) AS n FROM expenses WHERE vehicle_id = ?').get(vehicle.id).n
      };
    });
    return { items };
  });

  route('POST', '/api/vehicles', (ctx) => {
    const input = normalizeVehicle(ctx.body || {});
    const stamp = nowIso();
    const id = transaction(db, () => {
      if (input.isDefault || listVehicles(db, { includeArchived: true }).length === 0) {
        db.prepare('UPDATE vehicles SET is_default = 0').run();
        input.isDefault = true;
      }
      const result = db
        .prepare(
          `INSERT INTO vehicles (name, plate_no, brand_model, energy_type, fuel_type, tank_capacity, battery_capacity,
             purchase_date, initial_odometer, color, notes, is_default, archived, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          input.name, input.plateNo, input.brandModel, input.energyType, input.fuelType, input.tankCapacity,
          input.batteryCapacity, input.purchaseDate, input.initialOdometer, input.color, input.notes,
          input.isDefault ? 1 : 0, input.archived ? 1 : 0, stamp, stamp
        );
      return Number(result.lastInsertRowid);
    });
    return getVehicle(db, id);
  });

  route('PUT', '/api/vehicles/:id', (ctx) => {
    const existing = vehicleOrFail(db, ctx.params.id);
    const input = normalizeVehicle(ctx.body || {}, existing);
    transaction(db, () => {
      if (input.isDefault) db.prepare('UPDATE vehicles SET is_default = 0').run();
      db.prepare(
        `UPDATE vehicles SET name = ?, plate_no = ?, brand_model = ?, energy_type = ?, fuel_type = ?,
           tank_capacity = ?, battery_capacity = ?, purchase_date = ?, initial_odometer = ?, color = ?,
           notes = ?, is_default = ?, archived = ?, updated_at = ? WHERE id = ?`
      ).run(
        input.name, input.plateNo, input.brandModel, input.energyType, input.fuelType, input.tankCapacity,
        input.batteryCapacity, input.purchaseDate, input.initialOdometer, input.color, input.notes,
        input.isDefault ? 1 : 0, input.archived ? 1 : 0, nowIso(), existing.id
      );
      if (input.isDefault) db.prepare('UPDATE vehicles SET is_default = 0 WHERE id <> ?').run(existing.id);
    });
    return getVehicle(db, existing.id);
  });

  route('POST', '/api/vehicles/:id/default', (ctx) => {
    const vehicle = vehicleOrFail(db, ctx.params.id);
    if (vehicle.archived) fail(409, '归档车辆不能设为默认');
    transaction(db, () => {
      db.prepare('UPDATE vehicles SET is_default = 0').run();
      db.prepare('UPDATE vehicles SET is_default = 1, updated_at = ? WHERE id = ?').run(nowIso(), vehicle.id);
    });
    return getVehicle(db, vehicle.id);
  });

  route('DELETE', '/api/vehicles/:id', (ctx) => {
    const vehicle = vehicleOrFail(db, ctx.params.id);
    const hard = bool(ctx.query.hard) || ctx.body?.hard === true;
    if (hard) {
      transaction(db, () => {
        db.prepare('DELETE FROM vehicles WHERE id = ?').run(vehicle.id);
        ensureDefaultVehicle();
      });
      return { ok: true, id: vehicle.id, hard: true };
    }
    transaction(db, () => {
      db.prepare('UPDATE vehicles SET archived = 1, is_default = 0, updated_at = ? WHERE id = ?').run(nowIso(), vehicle.id);
      ensureDefaultVehicle();
    });
    return { ok: true, id: vehicle.id, archived: true };
  });

  function ensureDefaultVehicle() {
    const current = db.prepare('SELECT id FROM vehicles WHERE is_default = 1 AND archived = 0').get();
    if (current) return;
    const next = db.prepare('SELECT id FROM vehicles WHERE archived = 0 ORDER BY id ASC LIMIT 1').get();
    if (next) db.prepare('UPDATE vehicles SET is_default = 1 WHERE id = ?').run(next.id);
  }

  // ——————————————————————— 费用 ———————————————————————
  route('GET', '/api/expenses', (ctx) => {
    const q = ctx.query;
    const { limit, offset } = parsePagination(q, { limit: 100, max: 1000 });
    const filters = [];
    const params = [];
    if (q.vehicleId) {
      filters.push('e.vehicle_id = ?');
      params.push(Number(q.vehicleId));
    }
    if (q.category) {
      const category = CATEGORY_ALIASES[String(q.category).toLowerCase()] || q.category;
      filters.push('e.category = ?');
      params.push(category);
    }
    if (q.from) {
      filters.push('e.occurred_on >= ?');
      params.push(parseDate(q.from, '开始日期'));
    }
    if (q.to) {
      filters.push('e.occurred_on <= ?');
      params.push(parseDate(q.to, '结束日期'));
    }
    if (q.search) {
      filters.push('(e.note LIKE ? OR e.station LIKE ? OR e.fuel_type LIKE ?)');
      const pattern = `%${String(q.search).slice(0, 60)}%`;
      params.push(pattern, pattern, pattern);
    }
    const where = filters.length ? `WHERE ${filters.join(' AND ')}` : '';
    const total = db.prepare(`SELECT COUNT(*) AS n FROM expenses e ${where}`).get(...params).n;
    const rows = db
      .prepare(
        `SELECT e.*, v.name AS vehicle_name, v.plate_no AS vehicle_plate
           FROM expenses e JOIN vehicles v ON v.id = e.vehicle_id
           ${where} ORDER BY e.occurred_on DESC, e.id DESC LIMIT ? OFFSET ?`
      )
      .all(...params, limit, offset);
    const summaryRows = db.prepare(`SELECT e.category, e.amount FROM expenses e ${where}`).all(...params);
    const totalAmount = summaryRows.reduce((n, r) => n + Number(r.amount), 0);
    return {
      items: rows.map((row) => ({
        ...rowExpense(row),
        vehicleName: row.vehicle_name,
        vehiclePlate: row.vehicle_plate
      })),
      total: Number(total),
      limit,
      offset,
      summary: {
        amount: round(totalAmount, 2),
        count: summaryRows.length,
        average: summaryRows.length ? round(totalAmount / summaryRows.length, 2) : 0,
        categories: categorySummary(summaryRows)
      }
    };
  });

  route('GET', '/api/expenses/:id', (ctx) => {
    const expense = getExpense(db, ctx.params.id);
    if (!expense) fail(404, '费用记录不存在');
    return expense;
  });

  route('POST', '/api/expenses', (ctx) => {
    const vehicle = activeVehicleOrFail(db, ctx.body?.vehicleId ?? ctx.body?.vehicle_id);
    const input = normalizeExpense({ ...ctx.body, vehicleId: vehicle.id });
    if (input.externalId) {
      const existing = db.prepare('SELECT * FROM expenses WHERE vehicle_id = ? AND external_id = ?').get(vehicle.id, input.externalId);
      if (existing) fail(409, '该 externalId 已存在', { expenseId: existing.id });
    }
    const stamp = nowIso();
    const id = transaction(db, () => {
      const result = db
        .prepare(
          `INSERT INTO expenses (vehicle_id, category, amount, occurred_on, odometer, quantity, unit_price, fuel_type,
             station, note, full_tank, source, external_id, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          input.vehicleId, input.category, input.amount, input.occurredOn, input.odometer, input.quantity,
          input.unitPrice, input.fuelType, input.station, input.note, input.fullTank ? 1 : 0, input.source,
          input.externalId || null, stamp, stamp
        );
      return Number(result.lastInsertRowid);
    });
    return getExpense(db, id);
  });

  route('PUT', '/api/expenses/:id', (ctx) => {
    const existing = getExpense(db, ctx.params.id);
    if (!existing) fail(404, '费用记录不存在');
    const vehicleId = ctx.body?.vehicleId ?? ctx.body?.vehicle_id ?? existing.vehicleId;
    const vehicle = vehicleOrFail(db, vehicleId);
    if (vehicle.archived) fail(409, '该车辆已归档');
    const input = normalizeExpense({ ...ctx.body, vehicleId }, existing);
    if (input.externalId) {
      const duplicate = db
        .prepare('SELECT id FROM expenses WHERE vehicle_id = ? AND external_id = ? AND id <> ?')
        .get(vehicle.id, input.externalId, existing.id);
      if (duplicate) fail(409, '该 externalId 已被其他记录使用');
    }
    db.prepare(
      `UPDATE expenses SET vehicle_id = ?, category = ?, amount = ?, occurred_on = ?, odometer = ?,
         quantity = ?, unit_price = ?, fuel_type = ?, station = ?, note = ?, full_tank = ?, source = ?,
         external_id = ?, updated_at = ? WHERE id = ?`
    ).run(
      input.vehicleId, input.category, input.amount, input.occurredOn, input.odometer, input.quantity,
      input.unitPrice, input.fuelType, input.station, input.note, input.fullTank ? 1 : 0, input.source,
      input.externalId || null, nowIso(), existing.id
    );
    return getExpense(db, existing.id);
  });

  route('DELETE', '/api/expenses/:id', (ctx) => {
    const existing = getExpense(db, ctx.params.id);
    if (!existing) fail(404, '费用记录不存在');
    db.prepare('DELETE FROM expenses WHERE id = ?').run(existing.id);
    return { ok: true, id: existing.id };
  });

  // ——————————————————————— 保养 ———————————————————————
  route('GET', '/api/plans', (ctx) => {
    const { vehicle } = vehicleFromQuery(ctx.query);
    const includeInactive = bool(ctx.query.includeInactive);
    return {
      vehicle,
      latestOdometer: latestOdometer(db, vehicle),
      items: listPlanStatuses(db, vehicle, { includeInactive })
    };
  });

  route('POST', '/api/plans', (ctx) => {
    const vehicle = activeVehicleOrFail(db, ctx.body?.vehicleId ?? ctx.body?.vehicle_id);
    const input = normalizePlan({ ...ctx.body, vehicleId: vehicle.id });
    const stamp = nowIso();
    const id = transaction(db, () => {
      const result = db
        .prepare(
          `INSERT INTO maintenance_plans (vehicle_id, name, interval_mileage, interval_months, last_service_on,
             last_service_odometer, next_due_on, next_due_odometer, items, notify_days, active, notes,
             source, source_url, external_id, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          input.vehicleId, input.name, input.intervalMileage, input.intervalMonths, input.lastServiceOn,
          input.lastServiceOdometer, input.nextDueOn, input.nextDueOdometer, input.items, input.notifyDays,
          input.active ? 1 : 0, input.notes, input.source, input.sourceUrl, input.externalId || null, stamp, stamp
        );
      return Number(result.lastInsertRowid);
    });
    return listPlanStatuses(db, vehicle).find((p) => p.id === id) || getPlan(db, id);
  });

  route('PUT', '/api/plans/:id', (ctx) => {
    const existing = getPlan(db, ctx.params.id);
    if (!existing) fail(404, '保养计划不存在');
    const vehicle = activeVehicleOrFail(db, ctx.body?.vehicleId ?? existing.vehicleId);
    const input = normalizePlan({ ...ctx.body, vehicleId: vehicle.id }, existing);
    db.prepare(
      `UPDATE maintenance_plans SET vehicle_id = ?, name = ?, interval_mileage = ?, interval_months = ?,
         last_service_on = ?, last_service_odometer = ?, next_due_on = ?, next_due_odometer = ?, items = ?,
         notify_days = ?, active = ?, notes = ?, source = ?, source_url = ?, external_id = ?, updated_at = ? WHERE id = ?`
    ).run(
      input.vehicleId, input.name, input.intervalMileage, input.intervalMonths, input.lastServiceOn,
      input.lastServiceOdometer, input.nextDueOn, input.nextDueOdometer, input.items, input.notifyDays,
      input.active ? 1 : 0, input.notes, input.source, input.sourceUrl, input.externalId || null, nowIso(), existing.id
    );
    return listPlanStatuses(db, vehicle, { includeInactive: true }).find((p) => p.id === existing.id);
  });

  route('DELETE', '/api/plans/:id', (ctx) => {
    const existing = getPlan(db, ctx.params.id);
    if (!existing) fail(404, '保养计划不存在');
    db.prepare('DELETE FROM maintenance_plans WHERE id = ?').run(existing.id);
    return { ok: true, id: existing.id };
  });

  route('GET', '/api/maintenance', (ctx) => {
    const { vehicle } = vehicleFromQuery(ctx.query);
    const { limit, offset } = parsePagination(ctx.query, { limit: 100, max: 500 });
    const filters = ['r.vehicle_id = ?'];
    const params = [vehicle.id];
    if (ctx.query.from) {
      filters.push('r.service_on >= ?');
      params.push(parseDate(ctx.query.from, '开始日期'));
    }
    if (ctx.query.to) {
      filters.push('r.service_on <= ?');
      params.push(parseDate(ctx.query.to, '结束日期'));
    }
    const where = `WHERE ${filters.join(' AND ')}`;
    const totalRow = db.prepare(`SELECT COUNT(*) AS n, COALESCE(SUM(r.cost), 0) AS cost FROM maintenance_records r ${where}`).get(...params);
    const rows = db
      .prepare(
        `SELECT r.*, p.name AS plan_name FROM maintenance_records r
           LEFT JOIN maintenance_plans p ON p.id = r.plan_id
           ${where} ORDER BY r.service_on DESC, r.id DESC LIMIT ? OFFSET ?`
      )
      .all(...params, limit, offset);
    return {
      vehicle,
      items: rows.map((row) => ({ ...rowRecord(row), planName: row.plan_name || null })),
      total: Number(totalRow.n),
      totalCost: round(Number(totalRow.cost), 2),
      limit,
      offset
    };
  });

  route('POST', '/api/maintenance', (ctx) => {
    const vehicle = activeVehicleOrFail(db, ctx.body?.vehicleId ?? ctx.body?.vehicle_id);
    const input = normalizeRecord(db, { ...ctx.body, vehicleId: vehicle.id });
    const updatePlan = ctx.body?.updatePlan !== false;
    const stamp = nowIso();
    const id = transaction(db, () => {
      const result = db
        .prepare(
          `INSERT INTO maintenance_records (vehicle_id, plan_id, service_on, odometer, items, cost, shop, note, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(input.vehicleId, input.planId, input.serviceOn, input.odometer, input.items, input.cost, input.shop, input.note, stamp, stamp);
      if (input.planId && updatePlan) {
        db.prepare(
          `UPDATE maintenance_plans SET last_service_on = ?, last_service_odometer = ?, next_due_on = NULL,
             next_due_odometer = NULL, updated_at = ? WHERE id = ?`
        ).run(input.serviceOn, input.odometer, stamp, input.planId);
      }
      return Number(result.lastInsertRowid);
    });
    return getRecord(db, id);
  });

  route('PUT', '/api/maintenance/:id', (ctx) => {
    const existing = getRecord(db, ctx.params.id);
    if (!existing) fail(404, '保养记录不存在');
    const vehicle = activeVehicleOrFail(db, ctx.body?.vehicleId ?? existing.vehicleId);
    const input = normalizeRecord(db, { ...ctx.body, vehicleId: vehicle.id }, existing);
    db.prepare(
      `UPDATE maintenance_records SET vehicle_id = ?, plan_id = ?, service_on = ?, odometer = ?, items = ?,
         cost = ?, shop = ?, note = ?, updated_at = ? WHERE id = ?`
    ).run(input.vehicleId, input.planId, input.serviceOn, input.odometer, input.items, input.cost, input.shop, input.note, nowIso(), existing.id);
    return getRecord(db, existing.id);
  });

  route('DELETE', '/api/maintenance/:id', (ctx) => {
    const existing = getRecord(db, ctx.params.id);
    if (!existing) fail(404, '保养记录不存在');
    db.prepare('DELETE FROM maintenance_records WHERE id = ?').run(existing.id);
    return { ok: true, id: existing.id };
  });

  // ——————————————————————— 统计 / 报告 ———————————————————————
  route('GET', '/api/stats/dashboard', (ctx) => {
    const { vehicle } = vehicleFromQuery(ctx.query);
    const fallback = { from: `${today().slice(0, 7)}-01`, to: today() };
    const { from, to } = rangeFromQuery(ctx.query, fallback);
    return dashboardData(db, vehicle, { from, to });
  });

  route('GET', '/api/stats/energy', (ctx) => {
    const { vehicle } = vehicleFromQuery(ctx.query);
    const months = Math.min(Math.max(int(ctx.query.months, 12) || 12, 1), 36);
    const fallback = { from: monthStartOf(addMonths(today(), -(months - 1))), to: today() };
    const { from, to } = rangeFromQuery(ctx.query, fallback);
    return { vehicle, from, to, ...energyStats(db, vehicle, from, to) };
  });

  route('GET', '/api/reports', (ctx) => {
    const { vehicle } = vehicleFromQuery(ctx.query);
    const range = resolveReportRange({ ...ctx.query, vehicleId: vehicle.id });
    const cost = costStats(db, vehicle, range.from, range.to);
    const energy = energyStats(db, vehicle, range.from, range.to);
    const prev = previousRange(range.from, range.to);
    const previous = range.period === 'all' ? { total: 0 } : costStats(db, vehicle, prev.from, prev.to);
    const change = range.period !== 'all' && previous.total > 0
      ? round(((cost.total - previous.total) / previous.total) * 100, 1)
      : null;

    const records = db
      .prepare(
        `SELECT r.*, p.name AS plan_name FROM maintenance_records r
           LEFT JOIN maintenance_plans p ON p.id = r.plan_id
          WHERE r.vehicle_id = ? AND r.service_on >= ? AND r.service_on <= ?
          ORDER BY r.service_on DESC`
      )
      .all(vehicle.id, range.from, range.to)
      .map((row) => ({ ...rowRecord(row), planName: row.plan_name || null }));

    const topExpenses = db
      .prepare(
        `SELECT * FROM expenses WHERE vehicle_id = ? AND occurred_on >= ? AND occurred_on <= ?
          ORDER BY amount DESC LIMIT 5`
      )
      .all(vehicle.id, range.from, range.to)
      .map(rowExpense);

    const plans = listPlanStatuses(db, vehicle);
    const insights = [];
    if (change != null) {
      insights.push({
        tone: change > 0 ? 'warn' : 'good',
        text: `总支出较上一周期${change > 0 ? '增加' : '减少'} ${Math.abs(change)}%`
      });
    }
    if (cost.mileage.km > 0) {
      insights.push({ tone: 'neutral', text: `本期行驶 ${cost.mileage.km.toLocaleString('zh-CN')} 公里，每公里成本 ${cost.costPerKm ?? '—'} 元` });
    }
    if (energy.fuel?.avgConsumption) {
      insights.push({ tone: 'neutral', text: `平均油耗 ${energy.fuel.avgConsumption} L/100km，能源支出 ${energy.fuel.cost} 元` });
    }
    if (energy.charge?.avgConsumption) {
      insights.push({ tone: 'neutral', text: `平均电耗 ${energy.charge.avgConsumption} kWh/100km，充电支出 ${energy.charge.cost} 元` });
    }
    if (cost.categories.length) {
      insights.push({ tone: 'neutral', text: `最大支出类别是${cost.categories[0].label}，占比 ${cost.categories[0].percent}%` });
    }
    const duePlans = plans.filter((p) => p.status === 'overdue' || p.status === 'soon');
    if (duePlans.length) {
      insights.push({ tone: 'warn', text: `${duePlans.length} 项保养已到期或即将到期：${duePlans.slice(0, 3).map((p) => p.name).join('、')}` });
    }

    return {
      kind: 'report',
      period: range.period,
      label: range.label,
      from: range.from,
      to: range.to,
      generatedAt: nowIso(),
      vehicle,
      cost,
      energy,
      mileage: cost.mileage,
      previous: { total: previous.total, change, from: prev.from, to: prev.to },
      monthly: cost.monthly,
      categories: cost.categories,
      topExpenses,
      maintenanceRecords: records,
      plans,
      insights
    };
  });

  route('GET', '/api/card', (ctx) => {
    const { vehicle } = vehicleFromQuery(ctx.query);
    const months = Math.min(Math.max(int(ctx.query.months, 3) || 3, 1), 24);
    return cardData(db, vehicle, months);
  });

  // ——————————————————————— Agent 结构化录入 ———————————————————————
  route('GET', '/api/agent/context', () => {
    const vehicles = listVehicles(db);
    return {
      today: today(),
      defaultVehicleId: vehicles.find((v) => v.isDefault)?.id ?? vehicles[0]?.id ?? null,
      vehicles: vehicles.map((v) => ({
        id: v.id,
        name: v.name,
        plateNo: v.plateNo,
        energyType: v.energyType,
        fuelType: v.fuelType
      })),
      categories: CATEGORY_LIST,
      endpoints: {
        ingest: 'POST /api/agent/expenses',
        schema: 'GET /api/agent/schema'
      }
    };
  });

  route('GET', '/api/agent/schema', () => {
    const fields = {
      vehicleId: { type: 'integer', description: '车辆 ID；也可用 vehiclePlate / vehicleName，或省略（默认车辆）' },
      vehiclePlate: { type: 'string', description: '车牌号，例如 沪A·8K2M9' },
      vehicleName: { type: 'string', description: '车辆名称，例如 小蓝' },
      category: {
        type: 'string',
        enum: CATEGORY_KEYS,
        default: 'fuel',
        description: '费用类别；加油 fuel、充电 charge、停车 parking、过路费 toll、保险 insurance、维修 repair、洗车 wash、其他 other'
      },
      date: { type: 'string', format: 'date', description: '发生日期 YYYY-MM-DD；缺失时使用今天' },
      amount: { type: 'number', description: '总金额（元），必填' },
      quantity: { type: 'number', description: '油量（L）或充电量（kWh）' },
      unitPrice: { type: 'number', description: '单价（元/L 或 元/kWh）' },
      odometer: { type: 'number', description: '仪表里程（km）' },
      station: { type: 'string', description: '加油站 / 充电站 / 商家' },
      fuelType: { type: 'string', description: '油品标号，例如 95#' },
      fullTank: { type: 'boolean', description: '是否加满；用于满箱法计算油耗' },
      note: { type: 'string' },
      externalId: { type: 'string', description: '幂等键；同一车辆下重复提交相同值会返回已有记录' }
    };
    return {
      name: 'vehicle-meter.agent-expense',
      version: 1,
      endpoint: 'POST /api/agent/expenses',
      contentType: 'application/json',
      description: '接收 Agent 从加油小票、加油机屏幕或充电记录中识别出的结构化数据，校验后写入费用记录。',
      request: {
        oneOf: [
          { type: 'object', properties: fields, required: ['amount'] },
          { type: 'array', items: { type: 'object', properties: fields, required: ['amount'] } },
          { type: 'object', properties: { items: { type: 'array', items: { type: 'object', properties: fields, required: ['amount'] } }, dryRun: { type: 'boolean' } }, required: ['items'] }
        ]
      },
      schema: {
        $schema: 'https://json-schema.org/draft/2020-12/schema',
        title: 'Vehicle Meter Agent Expense',
        type: 'object',
        properties: fields,
        required: ['amount']
      },
      examples: [
        {
          vehiclePlate: '沪A·8K2M9',
          category: 'fuel',
          date: today(),
          amount: 320.5,
          quantity: 40.06,
          unitPrice: 8.0,
          odometer: 26310,
          station: '中国石化 漕河泾站',
          fuelType: '95#',
          fullTank: true,
          externalId: `agent-${today()}-001`
        },
        {
          vehicleName: '小小白',
          category: 'charge',
          date: today(),
          amount: 52.8,
          quantity: 44,
          unitPrice: 1.2,
          odometer: 18320,
          station: '特来电 漕河泾中心',
          note: 'Agent 从充电订单识别'
        }
      ],
      notes: [
        '金额必填；quantity / unitPrice / amount 任意给出两个即可推导第三个。',
        '批量写入可传数组，或 { "items": [...] }；任一条失败不影响其他条，返回 failed 列表。',
        'dryRun: true 只校验并回显规范化结果，不落库。',
        '同一车辆下 externalId 唯一，可用于重试幂等。',
        '本接口不处理图片；图片识别由 Agent 完成。'
      ]
    };
  });

  route('POST', '/api/agent/expenses', (ctx) => {
    const body = ctx.body;
    const items = Array.isArray(body) ? body : Array.isArray(body?.items) ? body.items : body ? [body] : [];
    if (!items.length) fail(400, '请求体应为费用对象、对象数组或 { items: [...] }');
    if (items.length > 100) fail(400, '单次最多写入 100 条');
    const dryRun = bool(body?.dryRun);
    const created = [];
    const duplicates = [];
    const failed = [];

    for (let index = 0; index < items.length; index++) {
      const item = items[index];
      try {
        if (!item || typeof item !== 'object') fail(400, '记录必须是 JSON 对象');
        const vehicle = resolveAgentVehicle(db, item);
        const input = normalizeExpense({ ...item, vehicleId: vehicle.id, source: 'agent' });
        if (dryRun) {
          created.push({ index, dryRun: true, vehicleId: vehicle.id, normalized: input });
          continue;
        }
        if (input.externalId) {
          const existing = db
            .prepare('SELECT * FROM expenses WHERE vehicle_id = ? AND external_id = ?')
            .get(vehicle.id, input.externalId);
          if (existing) {
            duplicates.push({ index, id: existing.id, externalId: input.externalId });
            continue;
          }
        }
        const stamp = nowIso();
        const result = db
          .prepare(
            `INSERT INTO expenses (vehicle_id, category, amount, occurred_on, odometer, quantity, unit_price, fuel_type,
               station, note, full_tank, source, external_id, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'agent', ?, ?, ?)`
          )
          .run(
            input.vehicleId, input.category, input.amount, input.occurredOn, input.odometer, input.quantity,
            input.unitPrice, input.fuelType, input.station, input.note, input.fullTank ? 1 : 0,
            input.externalId || null, stamp, stamp
          );
        created.push({ index, id: Number(result.lastInsertRowid), vehicleId: vehicle.id, normalized: input });
      } catch (err) {
        failed.push({
          index,
          error: err.message || '写入失败',
          ...(err.details ? { details: err.details } : {})
        });
      }
    }

    return {
      ok: failed.length === 0,
      dryRun,
      received: items.length,
      created,
      duplicates,
      failed
    };
  });

  // ——————————————————————— Agent / MCP 保养计划批量导入 ———————————————————————
  route('GET', '/api/agent/maintenance-schema', () => ({
    name: 'vehicle-meter.maintenance-plans-import',
    version: 1,
    endpoint: 'POST /api/agent/maintenance-plans',
    mcpTool: 'import_maintenance_plans',
    description:
      '批量导入某辆车的保养计划。Agent 可先查询车型官方保养手册，再按本格式导入；后端按 externalId 或计划名称幂等更新，不会重复创建。',
    request: {
      type: 'object',
      properties: {
        vehicleId: { type: 'integer', description: '车辆 ID（优先级最高）' },
        vehiclePlate: { type: 'string', description: '车牌号；与 vehicleId 二选一' },
        vehicleName: { type: 'string', description: '车辆名称；与 vehicleId、vehiclePlate 二选一' },
        source: { type: 'string', enum: ['official', 'agent', 'import'], default: 'agent', description: '数据来源类型' },
        sourceUrl: { type: 'string', format: 'uri', description: '官方保养手册 / 数据来源链接' },
        deactivateMissing: { type: 'boolean', default: false, description: '导入完成后，停用该车未出现在本次导入中的非手动计划' },
        dryRun: { type: 'boolean', default: false, description: '仅校验并返回将要执行的操作，不落库' },
        items: {
          type: 'array',
          minItems: 1,
          maxItems: 100,
          items: {
            type: 'object',
            required: ['name'],
            properties: {
              name: { type: 'string', description: '保养项目名称，例如 更换机油机滤' },
              intervalMileage: { type: 'number', description: '周期里程 km；与 intervalMonths 至少填一个' },
              intervalMonths: { type: 'integer', description: '周期月数' },
              items: { type: 'string', description: '项目清单，逗号分隔，例如 机油, 机滤' },
              notes: { type: 'string', description: '官方建议或备注' },
              notifyDays: { type: 'integer', default: 30, description: '提前提醒天数' },
              externalId: { type: 'string', description: '幂等键，建议用品牌+项目 slug' },
              sourceUrl: { type: 'string', format: 'uri', description: '单个项目的官方来源链接' }
            }
          }
        }
      },
      required: ['items']
    },
    response: {
      ok: 'boolean',
      vehicle: '车辆对象',
      dryRun: 'boolean',
      created: '本次新建的计划',
      updated: '本次更新/合并的计划',
      deactivated: '被停用的计划数量',
      failed: '失败条目 [{ index, error }]',
      plans: '导入后该车的全部启用计划（含到期状态）'
    },
    example: {
      vehiclePlate: '沪A·8K2M9',
      source: 'official',
      sourceUrl: 'https://www.vw.com.cn/',
      dryRun: false,
      items: [
        {
          name: '更换机油机滤',
          intervalMileage: 10000,
          intervalMonths: 12,
          items: '机油, 机滤',
          notes: '官方保养手册建议每 10000 km 或 12 个月更换',
          externalId: 'vw-golf-oil-filter'
        },
        {
          name: '更换空气滤芯',
          intervalMileage: 20000,
          intervalMonths: 24,
          items: '空气滤芯',
          externalId: 'vw-golf-air-filter'
        },
        {
          name: '更换刹车油',
          intervalMonths: 24,
          items: '刹车油',
          notes: '按时间周期更换，建议检测含水率',
          externalId: 'vw-golf-brake-fluid'
        }
      ]
    },
    notes: [
      'Agent 必须先确认车型与年款，再读取官方保养手册；不要凭空编造周期。',
      '同一辆车下 externalId 唯一；重复导入会更新原计划。未提供 externalId 时按计划名称匹配。',
      '官方建议仅供参考，实际保养请以车辆状况、厂家最新要求和维修店检查为准。',
      'sourceUrl 会随计划保存，便于在保养计划中核对来源。'
    ]
  }));

  route('POST', '/api/agent/maintenance-plans', (ctx) => {
    const body = ctx.body || {};
    const items = Array.isArray(body) ? body : Array.isArray(body.items) ? body.items : null;
    if (!items || !items.length) fail(400, '请求体应包含 items 数组');
    if (items.length > 100) fail(400, '单次最多导入 100 条保养计划');

    const vehicle = resolveAgentVehicle(db, body);
    const dryRun = bool(body.dryRun);
    const deactivateMissing = bool(body.deactivateMissing);
    const defaultSource = str(body.source || 'agent', 20);
    const defaultSourceUrl = str(body.sourceUrl || body.source_url || '', 500);
    const existingPlans = db
      .prepare('SELECT * FROM maintenance_plans WHERE vehicle_id = ? ORDER BY id ASC')
      .all(vehicle.id)
      .map(rowPlan);

    const actions = [];
    const failed = [];
    const seenExternal = new Set();
    const seenNames = new Set();

    for (let index = 0; index < items.length; index++) {
      const item = items[index];
      try {
        if (!item || typeof item !== 'object') fail(400, '计划必须是 JSON 对象');
        const name = str(item.name, 60);
        if (!name) fail(400, '计划缺少 name');
        const externalId = str(item.externalId ?? item.external_id ?? '', 100);
        const nameKey = name.toLowerCase();
        if (externalId && seenExternal.has(externalId)) fail(409, `本次导入中 externalId 重复：${externalId}`);
        if (!externalId && seenNames.has(nameKey)) fail(409, `本次导入中计划名称重复：${name}`);
        if (externalId) seenExternal.add(externalId);
        seenNames.add(nameKey);

        const byExternal = externalId
          ? existingPlans.find((plan) => plan.externalId && String(plan.externalId) === externalId)
          : null;
        const byName = existingPlans.find((plan) => String(plan.name).toLowerCase() === nameKey);
        const existing = byExternal || byName || null;

        const input = normalizePlan(
          {
            ...item,
            vehicleId: vehicle.id,
            source: item.source || defaultSource,
            sourceUrl: item.sourceUrl || item.source_url || defaultSourceUrl,
            externalId
          },
          existing
        );

        if (!existing) {
          const currentOdo = latestOdometer(db, vehicle);
          if (!input.nextDueOdometer && !input.lastServiceOdometer && input.intervalMileage) {
            input.nextDueOdometer = round(currentOdo + Number(input.intervalMileage), 0);
          }
          if (!input.nextDueOn && !input.lastServiceOn && input.intervalMonths) {
            input.nextDueOn = addMonths(today(), Number(input.intervalMonths));
          }
        }

        actions.push({
          index,
          action: existing ? 'update' : 'create',
          existingId: existing?.id || null,
          input
        });
      } catch (err) {
        failed.push({ index, error: err.message || '导入失败', ...(err.details ? { details: err.details } : {}) });
      }
    }

    const deactivateEnabled = deactivateMissing && failed.length === 0;
    const wouldDeactivate = deactivateEnabled
      ? existingPlans.filter(
          (plan) =>
            plan.active &&
            plan.source !== 'manual' &&
            !actions.some((action) => action.existingId === plan.id)
        )
      : [];

    if (dryRun) {
      return {
        ok: failed.length === 0,
        dryRun: true,
        vehicle,
        wouldCreate: actions.filter((a) => a.action === 'create').map((a) => a.input),
        wouldUpdate: actions.filter((a) => a.action === 'update').map((a) => a.input),
        wouldDeactivate: wouldDeactivate.map((p) => ({ id: p.id, name: p.name })),
        failed
      };
    }

    const created = [];
    const updated = [];
    const stamp = nowIso();
    if (actions.length) {
      transaction(db, () => {
        const insert = db.prepare(
          `INSERT INTO maintenance_plans (vehicle_id, name, interval_mileage, interval_months, last_service_on,
             last_service_odometer, next_due_on, next_due_odometer, items, notify_days, active, notes,
             source, source_url, external_id, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        );
        const update = db.prepare(
          `UPDATE maintenance_plans SET name = ?, interval_mileage = ?, interval_months = ?, last_service_on = ?,
             last_service_odometer = ?, next_due_on = ?, next_due_odometer = ?, items = ?, notify_days = ?,
             active = ?, notes = ?, source = ?, source_url = ?, external_id = ?, updated_at = ? WHERE id = ?`
        );
        for (const action of actions) {
          const input = action.input;
          if (action.action === 'create') {
            const result = insert.run(
              input.vehicleId, input.name, input.intervalMileage, input.intervalMonths, input.lastServiceOn,
              input.lastServiceOdometer, input.nextDueOn, input.nextDueOdometer, input.items, input.notifyDays,
              input.active ? 1 : 0, input.notes, input.source, input.sourceUrl, input.externalId || null, stamp, stamp
            );
            created.push({ id: Number(result.lastInsertRowid), name: input.name });
          } else {
            update.run(
              input.name, input.intervalMileage, input.intervalMonths, input.lastServiceOn,
              input.lastServiceOdometer, input.nextDueOn, input.nextDueOdometer, input.items, input.notifyDays,
              input.active ? 1 : 0, input.notes, input.source, input.sourceUrl, input.externalId || null,
              stamp, action.existingId
            );
            updated.push({ id: action.existingId, name: input.name });
          }
        }
        if (deactivateEnabled) {
          const activePlans = db
            .prepare('SELECT id, name, source FROM maintenance_plans WHERE vehicle_id = ? AND active = 1')
            .all(vehicle.id);
          const touched = new Set([
            ...created.map((p) => p.id),
            ...updated.map((p) => p.id)
          ]);
          for (const plan of activePlans) {
            if (!touched.has(plan.id) && plan.source !== 'manual') {
              db.prepare('UPDATE maintenance_plans SET active = 0, updated_at = ? WHERE id = ?').run(stamp, plan.id);
            }
          }
        }
      });
    }

    return {
      ok: failed.length === 0,
      dryRun: false,
      vehicle,
      created,
      updated,
      deactivated: wouldDeactivate.length,
      failed,
      plans: listPlanStatuses(db, vehicle)
    };
  });

  // ——————————————————————— 导出 ———————————————————————
  function expenseExportRows({ vehicleId, from, to } = {}) {
    const filters = [];
    const params = [];
    if (vehicleId) { filters.push('e.vehicle_id = ?'); params.push(Number(vehicleId)); }
    if (from) { filters.push('e.occurred_on >= ?'); params.push(from); }
    if (to) { filters.push('e.occurred_on <= ?'); params.push(to); }
    const where = filters.length ? `WHERE ${filters.join(' AND ')}` : '';
    return db
      .prepare(
        `SELECT e.*, v.name AS vehicle_name, v.plate_no AS vehicle_plate
           FROM expenses e JOIN vehicles v ON v.id = e.vehicle_id ${where}
          ORDER BY e.occurred_on DESC, e.id DESC`
      )
      .all(...params);
  }

  function maintenanceExportRows({ vehicleId, from, to } = {}) {
    const filters = [];
    const params = [];
    if (vehicleId) { filters.push('r.vehicle_id = ?'); params.push(Number(vehicleId)); }
    if (from) { filters.push('r.service_on >= ?'); params.push(from); }
    if (to) { filters.push('r.service_on <= ?'); params.push(to); }
    const where = filters.length ? `WHERE ${filters.join(' AND ')}` : '';
    return db
      .prepare(
        `SELECT r.*, v.name AS vehicle_name, v.plate_no AS vehicle_plate, p.name AS plan_name
           FROM maintenance_records r JOIN vehicles v ON v.id = r.vehicle_id
           LEFT JOIN maintenance_plans p ON p.id = r.plan_id ${where}
          ORDER BY r.service_on DESC, r.id DESC`
      )
      .all(...params);
  }

  function planExportRows({ vehicleId } = {}) {
    const where = vehicleId ? 'WHERE p.vehicle_id = ?' : '';
    const params = vehicleId ? [Number(vehicleId)] : [];
    return db
      .prepare(
        `SELECT p.*, v.name AS vehicle_name, v.plate_no AS vehicle_plate
           FROM maintenance_plans p JOIN vehicles v ON v.id = p.vehicle_id ${where} ORDER BY p.id ASC`
      )
      .all(...params);
  }

  function exportFilters(ctx) {
    return {
      vehicleId: ctx.query.vehicleId ? Number(ctx.query.vehicleId) : null,
      from: ctx.query.from ? parseDate(ctx.query.from) : null,
      to: ctx.query.to ? parseDate(ctx.query.to) : null
    };
  }

  function csvExpenses(rows) {
    return csv([
      ['日期', '车辆', '车牌', '类别', '金额(元)', '数量', '单位', '单价', '油品', '里程(km)', '商家', '备注', '加满', '来源'],
      ...rows.map((r) => [
        r.occurred_on,
        r.vehicle_name,
        r.vehicle_plate,
        CATEGORIES[r.category]?.label || r.category,
        Number(r.amount),
        r.quantity ?? '',
        r.category === 'charge' ? 'kWh' : r.category === 'fuel' ? 'L' : '',
        r.unit_price ?? '',
        r.fuel_type || '',
        r.odometer ?? '',
        r.station || '',
        r.note || '',
        r.full_tank ? '是' : '',
        SOURCE_LABELS[r.source] || r.source
      ])
    ]);
  }

  function csvMaintenance(rows) {
    return csv([
      ['日期', '车辆', '车牌', '关联计划', '项目', '费用(元)', '里程(km)', '门店', '备注'],
      ...rows.map((r) => [
        r.service_on, r.vehicle_name, r.vehicle_plate, r.plan_name || '', r.items || '',
        Number(r.cost), r.odometer ?? '', r.shop || '', r.note || ''
      ])
    ]);
  }

  function csvPlans(rows) {
    return csv([
      ['计划名称', '车辆', '车牌', '周期里程(km)', '周期月数', '上次保养日期', '上次里程(km)', '下次到期日期', '下次到期里程(km)', '提醒提前(天)', '状态', '项目', '备注'],
      ...rows.map((r) => [
        r.name, r.vehicle_name, r.vehicle_plate, r.interval_mileage ?? '', r.interval_months ?? '',
        r.last_service_on || '', r.last_service_odometer ?? '', r.next_due_on || '', r.next_due_odometer ?? '',
        r.notify_days, r.active ? '启用' : '停用', r.items || '', r.notes || ''
      ])
    ]);
  }

  route('GET', '/api/export/csv', (ctx) => {
    const kind = str(ctx.query.kind || 'all', 20);
    const filters = exportFilters(ctx);
    const stamp = today();
    if (kind === 'expenses') {
      const body = csvExpenses(expenseExportRows(filters));
      ctx.sendFile(Buffer.from(body, 'utf8'), `用车费用-${stamp}.csv`, 'text/csv; charset=utf-8');
      return;
    }
    if (kind === 'maintenance') {
      const body = csvMaintenance(maintenanceExportRows(filters));
      ctx.sendFile(Buffer.from(body, 'utf8'), `保养记录-${stamp}.csv`, 'text/csv; charset=utf-8');
      return;
    }
    if (kind === 'plans') {
      const body = csvPlans(planExportRows(filters));
      ctx.sendFile(Buffer.from(body, 'utf8'), `保养计划-${stamp}.csv`, 'text/csv; charset=utf-8');
      return;
    }
    const archive = zip([
      { name: `用车费用-${stamp}.csv`, data: csvExpenses(expenseExportRows(filters)) },
      { name: `保养记录-${stamp}.csv`, data: csvMaintenance(maintenanceExportRows(filters)) },
      { name: `保养计划-${stamp}.csv`, data: csvPlans(planExportRows(filters)) }
    ]);
    ctx.sendFile(archive, `用车数据-${stamp}.zip`, 'application/zip');
  });

  route('GET', '/api/export/xlsx', (ctx) => {
    const filters = exportFilters(ctx);
    const vehicles = filters.vehicleId
      ? [getVehicle(db, filters.vehicleId)].filter(Boolean)
      : listVehicles(db, { includeArchived: true });
    const expenseRows = expenseExportRows(filters);
    const recordRows = maintenanceExportRows(filters);
    const planRows = planExportRows(filters);

    const monthlyMap = new Map();
    for (const row of expenseRows) {
      const key = String(row.occurred_on).slice(0, 7);
      const item = monthlyMap.get(key) || { month: key, expense: 0, maintenance: 0 };
      item.expense += Number(row.amount);
      monthlyMap.set(key, item);
    }
    for (const row of recordRows) {
      const key = String(row.service_on).slice(0, 7);
      const item = monthlyMap.get(key) || { month: key, expense: 0, maintenance: 0 };
      item.maintenance += Number(row.cost);
      monthlyMap.set(key, item);
    }
    const monthly = [...monthlyMap.values()].sort((a, b) => a.month.localeCompare(b.month));

    const workbook = buildXlsx([
      {
        name: '车辆',
        columns: [
          { header: '车辆', key: 'name', width: 14 },
          { header: '车牌', key: 'plate', width: 16 },
          { header: '车型', key: 'model', width: 24 },
          { header: '能源类型', key: 'energy', width: 12 },
          { header: '油品', key: 'fuel', width: 8 },
          { header: '购车日期', key: 'purchase', width: 14 },
          { header: '初始里程', key: 'initial', width: 12 },
          { header: '备注', key: 'notes', width: 30 }
        ],
        rows: vehicles.map((v) => ({
          name: v.name,
          plate: v.plateNo,
          model: v.brandModel,
          energy: ENERGY_TYPES[v.energyType]?.label || v.energyType,
          fuel: v.fuelType,
          purchase: v.purchaseDate || '',
          initial: v.initialOdometer,
          notes: v.notes
        }))
      },
      {
        name: '费用明细',
        columns: [
          { header: '日期', key: 'date', width: 12 },
          { header: '车辆', key: 'vehicle', width: 12 },
          { header: '车牌', key: 'plate', width: 14 },
          { header: '类别', key: 'category', width: 10 },
          { header: '金额(元)', key: 'amount', width: 12 },
          { header: '数量', key: 'quantity', width: 10 },
          { header: '单价', key: 'price', width: 10 },
          { header: '油品', key: 'fuel', width: 8 },
          { header: '里程(km)', key: 'odometer', width: 12 },
          { header: '商家', key: 'station', width: 24 },
          { header: '备注', key: 'note', width: 30 },
          { header: '来源', key: 'source', width: 10 }
        ],
        rows: expenseRows.map((r) => ({
          date: r.occurred_on,
          vehicle: r.vehicle_name,
          plate: r.vehicle_plate,
          category: CATEGORIES[r.category]?.label || r.category,
          amount: Number(r.amount),
          quantity: r.quantity ?? '',
          price: r.unit_price ?? '',
          fuel: r.fuel_type || '',
          odometer: r.odometer ?? '',
          station: r.station || '',
          note: r.note || '',
          source: SOURCE_LABELS[r.source] || r.source
        }))
      },
      {
        name: '保养记录',
        columns: [
          { header: '日期', key: 'date', width: 12 },
          { header: '车辆', key: 'vehicle', width: 12 },
          { header: '车牌', key: 'plate', width: 14 },
          { header: '关联计划', key: 'plan', width: 18 },
          { header: '项目', key: 'items', width: 30 },
          { header: '费用(元)', key: 'cost', width: 12 },
          { header: '里程(km)', key: 'odometer', width: 12 },
          { header: '门店', key: 'shop', width: 20 },
          { header: '备注', key: 'note', width: 30 }
        ],
        rows: recordRows.map((r) => ({
          date: r.service_on,
          vehicle: r.vehicle_name,
          plate: r.vehicle_plate,
          plan: r.plan_name || '',
          items: r.items || '',
          cost: Number(r.cost),
          odometer: r.odometer ?? '',
          shop: r.shop || '',
          note: r.note || ''
        }))
      },
      {
        name: '保养计划',
        columns: [
          { header: '计划名称', key: 'name', width: 20 },
          { header: '车辆', key: 'vehicle', width: 12 },
          { header: '周期里程', key: 'mileage', width: 12 },
          { header: '周期月数', key: 'months', width: 10 },
          { header: '上次保养', key: 'lastDate', width: 14 },
          { header: '上次里程', key: 'lastOdo', width: 12 },
          { header: '下次到期', key: 'dueDate', width: 14 },
          { header: '下次里程', key: 'dueOdo', width: 12 },
          { header: '状态', key: 'status', width: 10 },
          { header: '项目', key: 'items', width: 30 }
        ],
        rows: planRows.map((r) => {
          const vehicle = vehicles.find((v) => v.id === r.vehicle_id) || getVehicle(db, r.vehicle_id);
          const status = vehicle
            ? planStatus(
                {
                  lastServiceOn: r.last_service_on,
                  lastServiceOdometer: r.last_service_odometer,
                  nextDueOn: r.next_due_on,
                  nextDueOdometer: r.next_due_odometer,
                  intervalMileage: r.interval_mileage,
                  intervalMonths: r.interval_months,
                  notifyDays: r.notify_days
                },
                vehicle,
                latestOdometer(db, vehicle)
              )
            : null;
          return {
            name: r.name,
            vehicle: r.vehicle_name,
            mileage: r.interval_mileage ?? '',
            months: r.interval_months ?? '',
            lastDate: r.last_service_on || '',
            lastOdo: r.last_service_odometer ?? '',
            dueDate: r.next_due_on || '',
            dueOdo: r.next_due_odometer ?? '',
            status: r.active ? status?.label || '启用' : '停用',
            items: r.items || ''
          };
        })
      },
      {
        name: '月度汇总',
        columns: [
          { header: '月份', key: 'month', width: 12 },
          { header: '日常费用(元)', key: 'expense', width: 16 },
          { header: '保养费用(元)', key: 'maintenance', width: 16 },
          { header: '合计(元)', key: 'total', width: 14 }
        ],
        rows: monthly.map((m) => ({
          month: m.month,
          expense: round(m.expense, 2),
          maintenance: round(m.maintenance, 2),
          total: round(m.expense + m.maintenance, 2)
        }))
      }
    ]);
    ctx.sendFile(
      workbook,
      `用车数据-${today()}.xlsx`,
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    );
  });

  // ——————————————————————— 备份 / 恢复 / 示例数据 ———————————————————————
  function buildBackup() {
    const data = {
      vehicles: db.prepare('SELECT * FROM vehicles ORDER BY id').all().map(rowVehicle),
      expenses: db.prepare('SELECT * FROM expenses ORDER BY id').all().map(rowExpense),
      maintenancePlans: db.prepare('SELECT * FROM maintenance_plans ORDER BY id').all().map(rowPlan),
      maintenanceRecords: db.prepare('SELECT * FROM maintenance_records ORDER BY id').all().map(rowRecord),
      settings: getSettings(db, { includeSecrets: true })
    };
    return {
      app: 'vehicle-meter',
      schemaVersion: 1,
      exportedAt: nowIso(),
      generator: `vehicle-meter/${APP_VERSION}`,
      counts: {
        vehicles: data.vehicles.length,
        expenses: data.expenses.length,
        maintenancePlans: data.maintenancePlans.length,
        maintenanceRecords: data.maintenanceRecords.length
      },
      data
    };
  }

  function snakeize(obj) {
    const out = {};
    for (const [key, value] of Object.entries(obj || {})) {
      out[key.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`)] = value;
    }
    return out;
  }

  function restoreBackup(payload) {
    if (!payload || typeof payload !== 'object') fail(400, '备份内容无效');
    if (payload.app && payload.app !== 'vehicle-meter') fail(400, '不是车记的备份文件');
    if (payload.schemaVersion && Number(payload.schemaVersion) > 1) fail(400, '备份版本高于当前应用版本');
    const data = payload.data || payload;
    const vehicles = Array.isArray(data.vehicles) ? data.vehicles : null;
    const expenses = Array.isArray(data.expenses) ? data.expenses : [];
    const plans = Array.isArray(data.maintenancePlans ?? data.maintenance_plans) ? data.maintenancePlans ?? data.maintenance_plans : [];
    const records = Array.isArray(data.maintenanceRecords ?? data.maintenance_records) ? data.maintenanceRecords ?? data.maintenance_records : [];
    if (!vehicles) fail(400, '备份缺少 vehicles 数据');
    if (vehicles.length > 5000 || expenses.length > 300000 || plans.length > 50000 || records.length > 100000) {
      fail(413, '备份数据量超出限制');
    }

    const vehicleIds = new Set();
    for (const raw of vehicles) {
      const v = snakeize(raw);
      if (!v.id || !v.name) fail(400, '车辆数据缺少 id 或 name');
      if (vehicleIds.has(Number(v.id))) fail(400, `车辆 id 重复：${v.id}`);
      vehicleIds.add(Number(v.id));
      if (!ENERGY_TYPES[v.energy_type || 'fuel']) fail(400, `车辆 ${v.name} 的能源类型无效`);
    }
    const planIds = new Set();
    for (const raw of plans) {
      const p = snakeize(raw);
      if (!p.id || !p.vehicle_id || !p.name) fail(400, '保养计划缺少字段');
      if (!vehicleIds.has(Number(p.vehicle_id))) fail(400, `保养计划引用了不存在的车辆：${p.vehicle_id}`);
      if (planIds.has(Number(p.id))) fail(400, `保养计划 id 重复：${p.id}`);
      planIds.add(Number(p.id));
    }
    const recordIds = new Set();
    for (const raw of records) {
      const r = snakeize(raw);
      if (!r.id || !r.vehicle_id) fail(400, '保养记录缺少字段');
      if (!vehicleIds.has(Number(r.vehicle_id))) fail(400, `保养记录引用了不存在的车辆：${r.vehicle_id}`);
      if (r.plan_id && !planIds.has(Number(r.plan_id))) fail(400, `保养记录引用了不存在的计划：${r.plan_id}`);
      if (recordIds.has(Number(r.id))) fail(400, `保养记录 id 重复：${r.id}`);
      recordIds.add(Number(r.id));
    }
    const expenseIds = new Set();
    for (const raw of expenses) {
      const e = snakeize(raw);
      if (!e.id || !e.vehicle_id || !e.amount) fail(400, '费用记录缺少字段');
      if (!vehicleIds.has(Number(e.vehicle_id))) fail(400, `费用记录引用了不存在的车辆：${e.vehicle_id}`);
      if (expenseIds.has(Number(e.id))) fail(400, `费用记录 id 重复：${e.id}`);
      expenseIds.add(Number(e.id));
    }

    const stamp = nowIso();
    transaction(db, () => {
      db.exec('DELETE FROM maintenance_records; DELETE FROM maintenance_plans; DELETE FROM expenses; DELETE FROM vehicles;');
      db.exec("DELETE FROM sqlite_sequence WHERE name IN ('vehicles','expenses','maintenance_plans','maintenance_records');");

      const insertVehicle = db.prepare(
        `INSERT INTO vehicles (id, name, plate_no, brand_model, energy_type, fuel_type, tank_capacity, battery_capacity,
           purchase_date, initial_odometer, color, notes, is_default, archived, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      );
      for (const raw of vehicles) {
        const v = snakeize(raw);
        insertVehicle.run(
          Number(v.id), String(v.name), v.plate_no || '', v.brand_model || '', v.energy_type || 'fuel', v.fuel_type || '',
          v.tank_capacity ?? null, v.battery_capacity ?? null, v.purchase_date || null, Number(v.initial_odometer) || 0,
          v.color || '#2383e2', v.notes || '', v.is_default ? 1 : 0, v.archived ? 1 : 0,
          v.created_at || stamp, v.updated_at || stamp
        );
      }
      const insertPlan = db.prepare(
        `INSERT INTO maintenance_plans (id, vehicle_id, name, interval_mileage, interval_months, last_service_on,
           last_service_odometer, next_due_on, next_due_odometer, items, notify_days, active, notes,
           source, source_url, external_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      );
      for (const raw of plans) {
        const p = snakeize(raw);
        insertPlan.run(
          Number(p.id), Number(p.vehicle_id), String(p.name), p.interval_mileage ?? null, p.interval_months ?? null,
          p.last_service_on || null, p.last_service_odometer ?? null, p.next_due_on || null, p.next_due_odometer ?? null,
          p.items || '', Number(p.notify_days) || 30, p.active ? 1 : 0, p.notes || '',
          ['manual', 'agent', 'official', 'import'].includes(p.source) ? p.source : 'manual',
          p.source_url || '', p.external_id || null, p.created_at || stamp, p.updated_at || stamp
        );
      }
      const insertRecord = db.prepare(
        `INSERT INTO maintenance_records (id, vehicle_id, plan_id, service_on, odometer, items, cost, shop, note, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      );
      for (const raw of records) {
        const r = snakeize(raw);
        insertRecord.run(
          Number(r.id), Number(r.vehicle_id), r.plan_id ? Number(r.plan_id) : null, String(r.service_on),
          r.odometer ?? null, r.items || '', Number(r.cost) || 0, r.shop || '', r.note || '',
          r.created_at || stamp, r.updated_at || stamp
        );
      }
      const insertExpense = db.prepare(
        `INSERT INTO expenses (id, vehicle_id, category, amount, occurred_on, odometer, quantity, unit_price, fuel_type,
           station, note, full_tank, source, external_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      );
      for (const raw of expenses) {
        const e = snakeize(raw);
        insertExpense.run(
          Number(e.id), Number(e.vehicle_id), e.category || 'other', Number(e.amount), String(e.occurred_on),
          e.odometer ?? null, e.quantity ?? null, e.unit_price ?? null, e.fuel_type || '', e.station || '',
          e.note || '', e.full_tank ? 1 : 0, e.source || 'import', e.external_id || null,
          e.created_at || stamp, e.updated_at || stamp
        );
      }
      if (data.settings && typeof data.settings === 'object') {
        const insertSetting = db.prepare(
          'INSERT INTO settings(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
        );
        for (const [key, value] of Object.entries(data.settings)) {
          const snake = key.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
          if (value != null && typeof value !== 'object') insertSetting.run(snake, String(value));
        }
      }
      if (!db.prepare('SELECT id FROM vehicles WHERE is_default = 1 AND archived = 0').get()) ensureDefaultVehicle();
    });

    return {
      ok: true,
      counts: {
        vehicles: vehicles.length,
        expenses: expenses.length,
        maintenancePlans: plans.length,
        maintenanceRecords: records.length
      }
    };
  }

  route('GET', '/api/backup', (ctx) => {
    const backup = buildBackup();
    ctx.sendFile(
      Buffer.from(JSON.stringify(backup, null, 2), 'utf8'),
      `车记备份-${today()}.json`,
      'application/json; charset=utf-8'
    );
  });

  route('POST', '/api/restore', (ctx) => {
    if (JSON.stringify(ctx.body || {}).length > MAX_BACKUP_BYTES * 2) fail(413, '备份文件过大');
    const result = restoreBackup(ctx.body);
    return { ...result, restoredAt: nowIso() };
  });

  route('POST', '/api/demo', () => {
    const count = db.prepare('SELECT COUNT(*) AS n FROM vehicles').get().n;
    if (count > 0) fail(409, '已有车辆数据，不能重复加载示例数据');
    return seedDemo(db);
  });

  route('POST', '/api/data/reset', (ctx) => {
    if (ctx.body?.confirm !== '清空所有数据') fail(400, '请输入确认文字「清空所有数据」');
    const keepSettings = ctx.body?.keepSettings !== false;
    transaction(db, () => {
      db.exec('DELETE FROM maintenance_records; DELETE FROM maintenance_plans; DELETE FROM expenses; DELETE FROM vehicles;');
      db.exec("DELETE FROM sqlite_sequence WHERE name IN ('vehicles','expenses','maintenance_plans','maintenance_records');");
      if (!keepSettings) {
        db.exec('DELETE FROM settings');
        setSettings(db, Object.fromEntries(Object.entries({ currency: '¥', theme: 'light', app_name: '车记' })));
      }
    });
    return { ok: true };
  });

  // ——————————————————————— 设置 / WebDAV ———————————————————————
  route('GET', '/api/settings', () => ({ settings: publicSettings(db) }));

  route('PUT', '/api/settings', (ctx) => {
    const body = ctx.body || {};
    const patch = {};
    if (body.currency !== undefined) {
      const currency = str(body.currency, 4) || '¥';
      patch.currency = currency;
    }
    if (body.theme !== undefined) {
      if (!['light', 'dark', 'auto'].includes(body.theme)) fail(400, '主题无效');
      patch.theme = body.theme;
    }
    if (body.appName !== undefined) patch.app_name = str(body.appName, 20) || '车记';
    if (body.onboarded !== undefined) patch.onboarded = bool(body.onboarded) ? '1' : '0';
    if (body.webdavUrl !== undefined) {
      const url = str(body.webdavUrl, 500);
      if (url) {
        try {
          const parsed = new URL(url);
          if (!['http:', 'https:'].includes(parsed.protocol)) fail(400, 'WebDAV 地址必须是 http/https');
        } catch {
          fail(400, 'WebDAV 地址格式不正确');
        }
      }
      patch.webdav_url = url;
    }
    if (body.webdavUsername !== undefined) patch.webdav_username = str(body.webdavUsername, 120);
    if (body.webdavPath !== undefined) {
      const remotePath = str(body.webdavPath, 300).replace(/^\/+/, '');
      if (remotePath.split('/').some((part) => part === '..')) fail(400, 'WebDAV 路径不合法');
      patch.webdav_path = remotePath || 'vehicle-meter/backup.json';
    }
    if (body.webdavPassword !== undefined) {
      if (body.webdavPassword === null) patch.webdav_password = '';
      else if (body.webdavPassword !== '') patch.webdav_password = String(body.webdavPassword).slice(0, 300);
    }
    setSettings(db, patch);
    return { settings: publicSettings(db) };
  });

  function savedWebdavSettings() {
    return getSettings(db, { includeSecrets: true });
  }

  function webdavFromBody(body = {}) {
    const saved = savedWebdavSettings();
    return new WebDavClient({
      url: body.webdavUrl || saved.webdavUrl,
      username: body.webdavUsername ?? saved.webdavUsername,
      password: body.webdavPassword || saved.webdavPassword,
      path: body.webdavPath || saved.webdavPath
    });
  }

  route('POST', '/api/webdav/test', async (ctx) => {
    const client = webdavFromBody(ctx.body || {});
    return await client.test();
  });

  route('POST', '/api/webdav/backup', async (ctx) => {
    const client = webdavFromBody(ctx.body || {});
    const payload = buildBackup();
    const text = JSON.stringify(payload);
    const result = await client.put(text);
    setSettings(db, { webdav_last_sync: nowIso() });
    return { ...result, bytes: Buffer.byteLength(text), counts: payload.counts };
  });

  route('POST', '/api/webdav/restore', async (ctx) => {
    const client = webdavFromBody(ctx.body || {});
    if (ctx.body?.confirm !== '恢复远端备份') fail(400, '请输入确认文字「恢复远端备份」');
    const text = await client.get();
    let payload;
    try {
      payload = JSON.parse(text);
    } catch {
      fail(400, '远端文件不是有效的 JSON 备份');
    }
    const result = restoreBackup(payload);
    setSettings(db, { webdav_last_restore: nowIso() });
    return { ...result, restoredAt: nowIso() };
  });

  route('GET', '/api/webdav/status', () => {
    const settings = savedWebdavSettings();
    return {
      configured: Boolean(settings.webdavUrl),
      url: settings.webdavUrl || '',
      path: settings.webdavPath || '',
      username: settings.webdavUsername || '',
      hasPassword: Boolean(settings.webdavPassword),
      lastSync: settings.webdavLastSync || '',
      lastRestore: settings.webdavLastRestore || ''
    };
  });

  // ——————————————————————— 分发 ———————————————————————
  return async function handle(ctx) {
    const pathname = ctx.url.pathname;
    let matchedPath = false;
    for (const item of routes) {
      const match = item.regex.exec(pathname);
      if (!match) continue;
      matchedPath = true;
      if (item.method !== ctx.req.method) continue;
      ctx.params = {};
      item.keys.forEach((key, i) => {
        ctx.params[key] = decodeURIComponent(match[i + 1]);
      });
      return await item.handler(ctx);
    }
    if (matchedPath) throw new HttpError(405, '请求方法不允许');
    throw new HttpError(404, '接口不存在');
  };
}

export { CATEGORY_LIST, ENERGY_TYPES, SOURCE_LABELS, MAX_BACKUP_BYTES };
