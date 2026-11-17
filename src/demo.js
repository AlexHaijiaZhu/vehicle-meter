import { addDays, addMonths, localDate, monthStart, round, today } from './util.js';

function rng(seed = 20260501) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function localNowIso() {
  return new Date().toISOString();
}

export function seedDemo(db) {
  const random = rng();
  const now = localNowIso();
  const stamp = now;
  const end = today();
  const start = addDays(monthStart(addMonths(end, -9)), 1);

  const insertVehicle = db.prepare(
    `INSERT INTO vehicles (name, plate_no, brand_model, energy_type, fuel_type, tank_capacity, battery_capacity,
       purchase_date, initial_odometer, color, notes, is_default, archived, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`
  );
  const insertExpense = db.prepare(
    `INSERT INTO expenses (vehicle_id, category, amount, occurred_on, odometer, quantity, unit_price, fuel_type,
       station, note, full_tank, source, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'demo', ?, ?)`
  );
  const insertPlan = db.prepare(
    `INSERT INTO maintenance_plans (vehicle_id, name, interval_mileage, interval_months, last_service_on,
       last_service_odometer, next_due_on, next_due_odometer, items, notify_days, active, notes, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?, 1, ?, ?, ?)`
  );
  const insertRecord = db.prepare(
    `INSERT INTO maintenance_records (vehicle_id, plan_id, service_on, odometer, items, cost, shop, note, created_at, updated_at)
     VALUES (?, NULL, ?, ?, ?, ?, ?, ?, ?, ?)`
  );

  const ice = insertVehicle.run(
    '小蓝', '沪A·8K2M9', '大众 高尔夫 280TSI', 'fuel', '95#', 50, null, '2023-03-18', 12800, '#2383e2',
    '通勤主力车', 1, stamp, stamp
  );
  const ev = insertVehicle.run(
    '小小白', '沪A·D8821', '特斯拉 Model 3 后驱', 'ev', '', null, 60, '2024-06-01', 9800, '#0f7b6c',
    '城市代步', 0, stamp, stamp
  );
  const iceId = Number(ice.lastInsertRowid);
  const evId = Number(ev.lastInsertRowid);

  // —— 燃油车：约每 8~12 天加一次油 ——
  let iceOdo = 12800;
  let date = start;
  const iceStations = ['中国石化 漕河泾站', '中国石油 虹梅路站', '壳牌 宜山路站'];
  while (date <= end) {
    const price = round(7.72 + random() * 0.55, 2);
    const amount = 300 + Math.round(random() * 150);
    const quantity = round(amount / price, 2);
    const targetConsumption = 6.9 + random() * 1.3;
    const distance = Math.max(180, Math.round((quantity / targetConsumption) * 100));
    iceOdo += distance;
    insertExpense.run(
      iceId, 'fuel', amount, date, iceOdo, quantity, price, '95#',
      iceStations[Math.floor(random() * iceStations.length)], '', 1, stamp, stamp
    );
    date = addDays(date, 7 + Math.floor(random() * 5));
  }
  iceOdo = Math.round(iceOdo);

  // —— 电车：约每 4 天充一次电 ——
  let evOdo = 9800;
  date = start;
  const evStations = ['特来电 漕河泾中心', '星星充电 虹桥站', '国家电网 徐汇站', '家充桩'];
  while (date <= end) {
    const quantity = round(24 + random() * 20, 2);
    const price = round(0.72 + random() * 0.75, 2);
    const amount = round(quantity * price, 2);
    const targetConsumption = 13.8 + random() * 2.6;
    evOdo += Math.max(100, Math.round((quantity / targetConsumption) * 100));
    insertExpense.run(
      evId, 'charge', amount, date, evOdo, quantity, price, '',
      evStations[Math.floor(random() * evStations.length)], '', 0, stamp, stamp
    );
    date = addDays(date, 3 + Math.floor(random() * 4));
  }
  evOdo = Math.round(evOdo);

  // —— 其他日常费用 ——
  const otherExpenses = [
    { category: 'parking', amount: 320, dayOffset: 3, note: '小区月租停车' },
    { category: 'wash', amount: 45, dayOffset: 12, note: '精洗' },
    { category: 'toll', amount: 68, dayOffset: 18, note: '高速通行费' },
    { category: 'parking', amount: 25, dayOffset: 21, note: '商场停车' }
  ];
  for (const vehicle of [{ id: iceId, factor: 1 }, { id: evId, factor: 0.9 }]) {
    for (let m = 0; m < 10; m++) {
      const base = addMonths(start, m);
      for (const item of otherExpenses) {
        if (random() < 0.18 && item.category !== 'parking') continue;
        const d = addDays(base, item.dayOffset);
        if (d > end || d < start) continue;
        insertExpense.run(
          vehicle.id,
          item.category,
          round(item.amount * vehicle.factor * (0.9 + random() * 0.2), 2),
          d,
          null,
          null,
          null,
          '',
          '',
          item.note,
          0,
          stamp,
          stamp
        );
      }
    }
  }

  const insuranceDate = addDays(start, 42);
  insertExpense.run(iceId, 'insurance', 4280, insuranceDate, null, null, null, '', '中国人保', '商业险 + 交强险', 0, stamp, stamp);
  insertExpense.run(evId, 'insurance', 5620, addDays(insuranceDate, 8), null, null, null, '', '平安保险', '商业险 + 交强险', 0, stamp, stamp);
  insertExpense.run(iceId, 'repair', 860, addDays(start, 150), iceOdo - 1500, null, null, '', '途虎养车', '更换前刹车片', 0, stamp, stamp);
  insertExpense.run(evId, 'wash', 59, addDays(start, 210), null, null, null, '', '途虎养车', '内饰清洁', 0, stamp, stamp);

  // —— 保养计划 ——
  const plans = [
    [iceId, '更换机油机滤', 5000, 6, addMonths(end, -2), iceOdo - 4850, '机油, 机滤, 放油螺栓垫片', 30, '每 5000 公里或 6 个月'],
    [iceId, '更换空气滤芯', 10000, 12, addMonths(end, -5), iceOdo - 6000, '空气滤芯', 30, '视空气质量调整'],
    [iceId, '更换刹车油', null, 24, addMonths(end, -26), null, '刹车油, 制动系统检查', 30, '按时间周期更换'],
    [evId, '轮胎换位', 10000, 12, addMonths(end, -1), evOdo - 3000, '四轮换位, 胎压检查', 30, '每 10000 公里'],
    [evId, '更换空调滤芯', 20000, 24, addMonths(end, -23), evOdo - 15000, '空调滤芯, 空调管路清洁', 30, '建议每年检查'],
    [evId, '制动液检查', null, 24, addMonths(end, -25), null, '制动液含水率检测', 30, '电动车同样需要']
  ];
  for (const p of plans) insertPlan.run(...p, stamp, stamp);

  // —— 保养历史 ——
  const records = [
    [iceId, addMonths(end, -2), iceOdo - 4850, '机油, 机滤', 680, '4S 店', '常规小保养'],
    [iceId, addMonths(end, -5), iceOdo - 9700, '空气滤芯, 空调滤芯', 420, '途虎养车', ''],
    [iceId, addMonths(end, -8), iceOdo - 14500, '机油, 机滤, 空气滤芯', 760, '4S 店', ''],
    [evId, addMonths(end, -1), evOdo - 3000, '四轮换位, 胎压检查', 120, '特斯拉服务中心', ''],
    [evId, addMonths(end, -7), evOdo - 12000, '空调滤芯', 260, '特斯拉服务中心', '更换活性炭滤芯']
  ];
  for (const r of records) insertRecord.run(...r, stamp, stamp);

  db.prepare("UPDATE settings SET value = '1' WHERE key = 'onboarded'").run();

  return {
    vehicles: [iceId, evId],
    odo: { ice: iceOdo, ev: evOdo },
    expenses: db.prepare('SELECT COUNT(*) AS n FROM expenses').get().n,
    plans: db.prepare('SELECT COUNT(*) AS n FROM maintenance_plans').get().n,
    records: db.prepare('SELECT COUNT(*) AS n FROM maintenance_records').get().n
  };
}

export function demoDates() {
  return { start: addDays(monthStart(addMonths(today(), -9)), 1), end: today(), localDate: localDate(new Date()) };
}
