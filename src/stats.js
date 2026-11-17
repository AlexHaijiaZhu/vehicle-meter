import {
  CATEGORIES,
  addDays,
  addMonths,
  daysBetween,
  monthList,
  monthStart,
  pct,
  round,
  today
} from './util.js';

const sum = (arr, fn) => arr.reduce((acc, item) => acc + (Number(fn(item)) || 0), 0);

export function getReadings(db, vehicle) {
  const rows = db
    .prepare(
      `SELECT occurred_on AS date, odometer AS odo FROM expenses
         WHERE vehicle_id = ? AND odometer IS NOT NULL AND odometer > 0
       UNION ALL
       SELECT service_on AS date, odometer AS odo FROM maintenance_records
         WHERE vehicle_id = ? AND odometer IS NOT NULL AND odometer > 0
       ORDER BY date ASC, odo ASC`
    )
    .all(vehicle.id, vehicle.id);

  const map = new Map();
  const initialDate = vehicle.purchaseDate || String(vehicle.createdAt || '').slice(0, 10) || '1970-01-01';
  if (Number(vehicle.initialOdometer) > 0) map.set(initialDate, Number(vehicle.initialOdometer));
  for (const row of rows) {
    const date = String(row.date);
    const odo = Number(row.odo);
    if (!map.has(date) || map.get(date) < odo) map.set(date, odo);
  }
  return [...map.entries()]
    .map(([date, odo]) => ({ date, odo }))
    .sort((a, b) => a.date.localeCompare(b.date) || a.odo - b.odo);
}

export function latestOdometer(db, vehicle) {
  const readings = getReadings(db, vehicle);
  if (readings.length) return readings[readings.length - 1].odo;
  return Number(vehicle.initialOdometer) || 0;
}

export function mileageInRange(db, vehicle, from, to) {
  const readings = getReadings(db, vehicle);
  if (!readings.length) {
    return { km: 0, startOdo: null, endOdo: null, startDate: null, endDate: null, estimated: false };
  }

  const beforeOrAt = (date) => {
    let found = null;
    for (const r of readings) {
      if (r.date <= date) found = r;
      else break;
    }
    return found;
  };

  let end = beforeOrAt(to);
  let start = beforeOrAt(from);
  let estimated = false;

  if (!end) {
    const within = readings.filter((r) => r.date >= from && r.date <= to);
    if (!within.length) {
      return { km: 0, startOdo: null, endOdo: null, startDate: null, endDate: null, estimated: false };
    }
    end = within[within.length - 1];
    estimated = true;
  }
  if (!start) {
    const within = readings.filter((r) => r.date >= from && r.date <= to && r.date <= end.date);
    start = within.length ? within[0] : readings[0];
    estimated = true;
  }
  if (start.date === end.date && start.odo === end.odo) {
    return { km: 0, startOdo: start.odo, endOdo: end.odo, startDate: start.date, endDate: end.date, estimated };
  }
  const km = Math.max(0, round(end.odo - start.odo, 1));
  return { km, startOdo: start.odo, endOdo: end.odo, startDate: start.date, endDate: end.date, estimated };
}

function energyRows(db, vehicleId, category, to) {
  return db
    .prepare(
      `SELECT id, occurred_on, odometer, quantity, amount, full_tank, unit_price, station, note
         FROM expenses
        WHERE vehicle_id = ? AND category = ? AND quantity IS NOT NULL AND quantity > 0
          AND odometer IS NOT NULL AND odometer > 0 AND occurred_on <= ?
        ORDER BY odometer ASC, occurred_on ASC, id ASC`
    )
    .all(vehicleId, category, to)
    .map((r) => ({
      id: r.id,
      date: r.occurred_on,
      odometer: Number(r.odometer),
      quantity: Number(r.quantity),
      amount: Number(r.amount),
      fullTank: Boolean(r.full_tank),
      unitPrice: r.unit_price == null ? null : Number(r.unit_price),
      station: r.station,
      note: r.note
    }));
}

/**
 * Build consumption segments.
 * Fuel: full-tank method when fullTank flags exist, otherwise per-fill estimate.
 * EV: charge-interval method (kWh added / distance since previous charge).
 */
function buildSegments(rows, category) {
  const segments = [];
  const fullMode = rows.some((r) => r.fullTank);

  if (fullMode) {
    let anchor = null;
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      if (!row.fullTank) continue;
      if (anchor) {
        const distance = row.odometer - anchor.odometer;
        if (distance > 0 && distance < 5000) {
          const between = rows.slice(anchor.index + 1, i + 1);
          const quantity = sum(between, (r) => r.quantity);
          const amount = sum(between, (r) => r.amount);
          const consumption = quantity > 0 ? round((quantity / distance) * 100, 2) : null;
          if (consumption != null && consumption > 0 && consumption < 100) {
            segments.push({
              id: row.id,
              startDate: anchor.date,
              endDate: row.date,
              date: row.date,
              odometer: row.odometer,
              startOdometer: anchor.odometer,
              distance: round(distance, 1),
              quantity: round(quantity, 2),
              amount: round(amount, 2),
              unitPrice: amount && quantity ? round(amount / quantity, 2) : null,
              consumption,
              method: category === 'fuel' ? 'full-tank' : 'full-charge',
              station: row.station
            });
          }
        }
      }
      anchor = { index: i, odometer: row.odometer, date: row.date };
    }
  } else {
    for (let i = 1; i < rows.length; i++) {
      const prev = rows[i - 1];
      const row = rows[i];
      const distance = row.odometer - prev.odometer;
      if (distance <= 0 || distance >= 5000) continue;
      const quantity = row.quantity;
      const consumption = round((quantity / distance) * 100, 2);
      if (consumption <= 0 || consumption >= 100) continue;
      segments.push({
        id: row.id,
        startDate: prev.date,
        endDate: row.date,
        date: row.date,
        odometer: row.odometer,
        startOdometer: prev.odometer,
        distance: round(distance, 1),
        quantity: round(quantity, 2),
        amount: round(row.amount, 2),
        unitPrice: row.unitPrice,
        consumption,
        method: category === 'fuel' ? 'fill-estimate' : 'charge-interval',
        station: row.station
      });
    }
  }
  return segments;
}

function monthlyEnergy(db, vehicleId, category, from, to) {
  const costRows = db
    .prepare(
      `SELECT substr(occurred_on, 1, 7) AS month, SUM(amount) AS cost, SUM(quantity) AS quantity, COUNT(*) AS count
         FROM expenses
        WHERE vehicle_id = ? AND category = ? AND occurred_on >= ? AND occurred_on <= ?
        GROUP BY substr(occurred_on, 1, 7)`
    )
    .all(vehicleId, category, from, to);
  const costMap = new Map(costRows.map((r) => [r.month, r]));

  const segments = buildSegments(energyRows(db, vehicleId, category, to), category).filter(
    (s) => s.date >= from && s.date <= to
  );

  const byMonth = new Map();
  for (const s of segments) {
    const month = s.date.slice(0, 7);
    if (!byMonth.has(month)) byMonth.set(month, { quantity: 0, distance: 0, segments: 0 });
    const m = byMonth.get(month);
    m.quantity += s.quantity;
    m.distance += s.distance;
    m.segments++;
  }

  return monthList(from, to).map((month) => {
    const agg = byMonth.get(month) || { quantity: 0, distance: 0, segments: 0 };
    const costRow = costMap.get(month);
    const cost = costRow ? Number(costRow.cost) : 0;
    const purchased = costRow ? Number(costRow.quantity) : 0;
    return {
      month,
      consumption: agg.distance > 0 ? round((agg.quantity / agg.distance) * 100, 2) : null,
      quantity: round(agg.quantity, 2),
      distance: round(agg.distance, 1),
      purchased: round(purchased, 2),
      cost: round(cost, 2),
      segments: agg.segments,
      unitPrice: purchased > 0 ? round(cost / purchased, 2) : null
    };
  });
}

export function energyStats(db, vehicle, from, to) {
  const categories = vehicle.energyType === 'ev' ? ['charge'] : vehicle.energyType === 'phev' ? ['fuel', 'charge'] : ['fuel'];
  const result = { fuel: null, charge: null, monthly: [] };

  for (const category of categories) {
    const rows = energyRows(db, vehicle.id, category, to);
    const segments = buildSegments(rows, category).filter((s) => s.date >= from && s.date <= to);
    const distance = sum(segments, (s) => s.distance);
    const quantity = sum(segments, (s) => s.quantity);
    const segmentCost = sum(segments, (s) => s.amount);

    const rangeCostRow = db
      .prepare(
        `SELECT SUM(amount) AS cost, SUM(quantity) AS quantity, COUNT(*) AS count, AVG(unit_price) AS avg_price
           FROM expenses WHERE vehicle_id = ? AND category = ? AND occurred_on >= ? AND occurred_on <= ?`
      )
      .get(vehicle.id, category, from, to);
    const cost = Number(rangeCostRow?.cost || 0);
    const purchased = Number(rangeCostRow?.quantity || 0);
    const mileage = mileageInRange(db, vehicle, from, to);

    result[category] = {
      category,
      avgConsumption: distance > 0 ? round((quantity / distance) * 100, 2) : null,
      distance: round(distance, 1),
      quantity: round(quantity, 2),
      purchased: round(purchased, 2),
      cost: round(cost, 2),
      segmentCost: round(segmentCost, 2),
      avgPrice: purchased > 0 ? round(cost / purchased, 2) : null,
      costPerKm: mileage.km > 0 ? round(cost / mileage.km, 3) : null,
      count: Number(rangeCostRow?.count || 0),
      segments: segments.slice().reverse(),
      monthly: monthlyEnergy(db, vehicle.id, category, from, to)
    };
  }

  const months = monthList(from, to);
  result.monthly = months.map((month) => ({
    month,
    fuelConsumption: result.fuel?.monthly.find((m) => m.month === month)?.consumption ?? null,
    chargeConsumption: result.charge?.monthly.find((m) => m.month === month)?.consumption ?? null,
    fuelCost: result.fuel?.monthly.find((m) => m.month === month)?.cost ?? 0,
    chargeCost: result.charge?.monthly.find((m) => m.month === month)?.cost ?? 0,
    fuelQuantity: result.fuel?.monthly.find((m) => m.month === month)?.quantity ?? 0,
    chargeQuantity: result.charge?.monthly.find((m) => m.month === month)?.quantity ?? 0
  }));

  return result;
}

export function costStats(db, vehicle, from, to) {
  const expenseRows = db
    .prepare(
      `SELECT category, amount, occurred_on FROM expenses
        WHERE vehicle_id = ? AND occurred_on >= ? AND occurred_on <= ?`
    )
    .all(vehicle.id, from, to);
  const recordRows = db
    .prepare(
      `SELECT cost, service_on FROM maintenance_records
        WHERE vehicle_id = ? AND service_on >= ? AND service_on <= ?`
    )
    .all(vehicle.id, from, to);

  const totalExpense = sum(expenseRows, (r) => r.amount);
  const maintenanceCost = sum(recordRows, (r) => r.cost);
  const total = totalExpense + maintenanceCost;

  const byCategory = new Map();
  for (const key of Object.keys(CATEGORIES)) {
    byCategory.set(key, { key, ...CATEGORIES[key], amount: 0, count: 0 });
  }
  for (const row of expenseRows) {
    const item = byCategory.get(row.category) || byCategory.get('other');
    item.amount += Number(row.amount) || 0;
    item.count++;
  }
  const maintenance = {
    key: 'maintenance',
    label: '保养',
    color: '#0f766e',
    icon: 'gear',
    amount: maintenanceCost,
    count: recordRows.length
  };
  const categories = [...byCategory.values()]
    .filter((c) => c.amount > 0)
    .map((c) => ({ ...c, amount: round(c.amount, 2), percent: pct(c.amount, total) }));
  categories.push({ ...maintenance, amount: round(maintenanceCost, 2), percent: pct(maintenanceCost, total) });
  const visibleCategories = categories
    .filter((c) => c.amount > 0)
    .sort((a, b) => b.amount - a.amount);

  const expenseMonthly = new Map(
    db
      .prepare(
        `SELECT substr(occurred_on,1,7) AS month, SUM(amount) AS amount FROM expenses
          WHERE vehicle_id = ? AND occurred_on >= ? AND occurred_on <= ?
          GROUP BY substr(occurred_on,1,7)`
      )
      .all(vehicle.id, from, to)
      .map((r) => [r.month, Number(r.amount)])
  );
  const maintenanceMonthly = new Map(
    db
      .prepare(
        `SELECT substr(service_on,1,7) AS month, SUM(cost) AS amount FROM maintenance_records
          WHERE vehicle_id = ? AND service_on >= ? AND service_on <= ?
          GROUP BY substr(service_on,1,7)`
      )
      .all(vehicle.id, from, to)
      .map((r) => [r.month, Number(r.amount)])
  );
  const monthly = monthList(from, to).map((month) => ({
    month,
    expense: round(expenseMonthly.get(month) || 0, 2),
    maintenance: round(maintenanceMonthly.get(month) || 0, 2),
    total: round((expenseMonthly.get(month) || 0) + (maintenanceMonthly.get(month) || 0), 2)
  }));

  const mileage = mileageInRange(db, vehicle, from, to);
  const days = Math.max(daysBetween(from, to) + 1, 1);

  return {
    from,
    to,
    days,
    total: round(total, 2),
    expenseTotal: round(totalExpense, 2),
    maintenanceCost: round(maintenanceCost, 2),
    count: expenseRows.length,
    maintenanceCount: recordRows.length,
    monthly,
    categories: visibleCategories,
    mileage,
    costPerKm: mileage.km > 0 ? round(total / mileage.km, 2) : null,
    dailyAverage: round(total / days, 2),
    monthlyAverage: round(total / Math.max(monthly.length, 1), 2)
  };
}

export function planStatus(plan, vehicle, latestOdo, dateStr = today()) {
  const baselineDate = plan.lastServiceOn || vehicle.purchaseDate || String(vehicle.createdAt || '').slice(0, 10);
  const baselineOdo = plan.lastServiceOdometer ?? (Number(vehicle.initialOdometer) || 0);
  const dueOdo = plan.dueOdometer ?? plan.nextDueOdometer ?? (plan.intervalMileage ? baselineOdo + Number(plan.intervalMileage) : null);
  const dueDate = plan.dueDate ?? plan.nextDueOn ?? (plan.intervalMonths ? addMonths(baselineDate, Number(plan.intervalMonths)) : null);

  const remainingKm = dueOdo == null ? null : round(dueOdo - latestOdo, 0);
  const remainingDays = dueDate == null ? null : daysBetween(dateStr, dueDate);
  const notifyDays = Number(plan.notifyDays) || 30;

  let status = 'ok';
  if (remainingKm == null && remainingDays == null) status = 'unknown';
  else if ((remainingKm != null && remainingKm <= 0) || (remainingDays != null && remainingDays <= 0)) status = 'overdue';
  else if ((remainingKm != null && remainingKm <= 500) || (remainingDays != null && remainingDays <= notifyDays)) status = 'soon';

  let progress = 0;
  if (dueOdo != null && dueOdo > baselineOdo) {
    progress = Math.max(0, Math.min(1, (latestOdo - baselineOdo) / (dueOdo - baselineOdo)));
  } else if (dueDate != null) {
    const start = baselineDate;
    const totalDays = Math.max(daysBetween(start, dueDate), 1);
    progress = Math.max(0, Math.min(1, daysBetween(start, dateStr) / totalDays));
  }

  return {
    ...plan,
    baselineDate,
    baselineOdo,
    dueOdo,
    dueDate,
    remainingKm,
    remainingDays,
    status,
    progress: round(progress, 3),
    label:
      status === 'overdue'
        ? '已到期'
        : status === 'soon'
          ? '即将到期'
          : status === 'unknown'
            ? '待设置'
            : '正常',
    latestOdometer: latestOdo
  };
}

export function listPlanStatuses(db, vehicle, { includeInactive = false } = {}) {
  const rows = db
    .prepare(`SELECT * FROM maintenance_plans WHERE vehicle_id = ? ${includeInactive ? '' : 'AND active = 1'} ORDER BY id ASC`)
    .all(vehicle.id);
  const odo = latestOdometer(db, vehicle);
  const statuses = rows.map((row) =>
    planStatus(
      {
        id: row.id,
        vehicleId: row.vehicle_id,
        name: row.name,
        intervalMileage: row.interval_mileage,
        intervalMonths: row.interval_months,
        lastServiceOn: row.last_service_on,
        lastServiceOdometer: row.last_service_odometer,
        nextDueOn: row.next_due_on,
        nextDueOdometer: row.next_due_odometer,
        items: row.items,
        notifyDays: row.notify_days,
        active: Boolean(row.active),
        notes: row.notes,
        source: row.source || 'manual',
        sourceUrl: row.source_url || '',
        externalId: row.external_id || null
      },
      vehicle,
      odo
    )
  );
  const rank = { overdue: 0, soon: 1, unknown: 2, ok: 3 };
  return statuses.sort((a, b) => rank[a.status] - rank[b.status] || (a.remainingDays ?? 9999) - (b.remainingDays ?? 9999));
}

export function nextMaintenance(db, vehicle) {
  const plans = listPlanStatuses(db, vehicle).filter((p) => p.active);
  return plans.length ? plans[0] : null;
}

export function recentActivity(db, vehicleId, limit = 8) {
  const expenses = db
    .prepare(
      `SELECT id, category, amount, occurred_on, station, note, quantity, odometer, 'expense' AS kind
         FROM expenses WHERE vehicle_id = ? ORDER BY occurred_on DESC, id DESC LIMIT ?`
    )
    .all(vehicleId, limit);
  const records = db
    .prepare(
      `SELECT id, 'maintenance' AS category, cost AS amount, service_on AS occurred_on, shop AS station,
              note, NULL AS quantity, odometer, 'maintenance' AS kind
         FROM maintenance_records WHERE vehicle_id = ? ORDER BY service_on DESC, id DESC LIMIT ?`
    )
    .all(vehicleId, limit);

  return [...expenses, ...records]
    .map((r) => ({
      id: r.id,
      kind: r.kind,
      category: r.category,
      amount: Number(r.amount),
      date: r.occurred_on,
      station: r.station || '',
      note: r.note || '',
      quantity: r.quantity == null ? null : Number(r.quantity),
      odometer: r.odometer == null ? null : Number(r.odometer)
    }))
    .sort((a, b) => b.date.localeCompare(a.date) || b.id - a.id)
    .slice(0, limit);
}

export function previousRange(from, to) {
  const days = Math.max(daysBetween(from, to) + 1, 1);
  const prevTo = addDays(from, -1);
  const prevFrom = addDays(prevTo, -(days - 1));
  return { from: prevFrom, to: prevTo };
}

export function comparePeriods(db, vehicle, from, to) {
  const current = costStats(db, vehicle, from, to);
  const prev = previousRange(from, to);
  const previous = costStats(db, vehicle, prev.from, prev.to);
  const change = previous.total > 0 ? round(((current.total - previous.total) / previous.total) * 100, 1) : null;
  return { current, previous, change, previousRange: prev };
}

export function dashboardData(db, vehicle, { from, to, trendMonths = 12 } = {}) {
  const current = costStats(db, vehicle, from, to);
  const prev = previousRange(from, to);
  const previous = costStats(db, vehicle, prev.from, prev.to);
  const energy = energyStats(db, vehicle, from, to);
  const latest3 = energyStats(db, vehicle, addDays(addMonths(today(), -3), 1), today());
  const plans = listPlanStatuses(db, vehicle);
  const next = plans.find((p) => p.status === 'overdue' || p.status === 'soon') || plans[0] || null;
  const trendFrom = addMonths(monthStart(to), -(trendMonths - 1));
  const trend = costStats(db, vehicle, trendFrom, to).monthly;

  return {
    vehicle,
    from,
    to,
    cost: current,
    previousTotal: previous.total,
    change: previous.total > 0 ? round(((current.total - previous.total) / previous.total) * 100, 1) : null,
    mileage: current.mileage,
    latestOdometer: latestOdometer(db, vehicle),
    energy,
    last3: { from: addDays(addMonths(today(), -3), 1), to: today(), energy: latest3 },
    trend,
    plans,
    nextMaintenance: next,
    recent: recentActivity(db, vehicle.id, 8)
  };
}

export function cardData(db, vehicle, months = 3) {
  const to = today();
  const from = addDays(addMonths(to, -months), 1);
  const cost = costStats(db, vehicle, from, to);
  const energy = energyStats(db, vehicle, from, to);
  const latest = latestOdometer(db, vehicle);
  const next = nextMaintenance(db, vehicle);
  const lifetime = costStats(db, vehicle, '2000-01-01', to);

  return {
    vehicle,
    months,
    from,
    to,
    mileage: cost.mileage.km,
    totalCost: cost.total,
    costPerKm: cost.costPerKm,
    lifetimeCost: lifetime.total,
    latestOdometer: latest,
    fuel: energy.fuel
      ? {
          avgConsumption: energy.fuel.avgConsumption,
          cost: energy.fuel.cost,
          quantity: energy.fuel.quantity,
          unitPrice: energy.fuel.avgPrice,
          count: energy.fuel.count
        }
      : null,
    charge: energy.charge
      ? {
          avgConsumption: energy.charge.avgConsumption,
          cost: energy.charge.cost,
          quantity: energy.charge.quantity,
          unitPrice: energy.charge.avgPrice,
          count: energy.charge.count
        }
      : null,
    monthly: cost.monthly,
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
    generatedAt: new Date().toISOString()
  };
}
