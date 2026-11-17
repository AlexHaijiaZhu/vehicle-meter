const FONT = '-apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif';
const MONO = '"SFMono-Regular", Consolas, "Liberation Mono", Menlo, monospace';
const CATEGORY_LABELS = {
  fuel: '加油', charge: '充电', parking: '停车', toll: '过路费',
  insurance: '保险', repair: '维修', wash: '洗车美容', other: '其他', maintenance: '保养'
};

function roundRect(ctx, x, y, w, h, r) {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

function fillRound(ctx, x, y, w, h, r, fill) {
  roundRect(ctx, x, y, w, h, r);
  ctx.fillStyle = fill;
  ctx.fill();
}

function strokeRound(ctx, x, y, w, h, r, stroke, width = 1) {
  roundRect(ctx, x, y, w, h, r);
  ctx.strokeStyle = stroke;
  ctx.lineWidth = width;
  ctx.stroke();
}

function text(ctx, content, x, y, options = {}) {
  const {
    size = 24,
    weight = 400,
    color = '#37352f',
    align = 'left',
    baseline = 'alphabetic',
    font = FONT,
    letterSpacing = 0
  } = options;
  ctx.save();
  ctx.font = `${weight} ${size}px ${font}`;
  ctx.fillStyle = color;
  ctx.textAlign = align;
  ctx.textBaseline = baseline;
  if (letterSpacing && 'letterSpacing' in ctx) ctx.letterSpacing = `${letterSpacing}px`;
  ctx.fillText(String(content ?? ''), x, y);
  ctx.restore();
}

function measure(ctx, content, size, weight = 400) {
  ctx.save();
  ctx.font = `${weight} ${size}px ${FONT}`;
  const width = ctx.measureText(String(content ?? '')).width;
  ctx.restore();
  return width;
}

function ellipsis(ctx, content, maxWidth, size, weight = 400) {
  const str = String(content ?? '');
  if (measure(ctx, str, size, weight) <= maxWidth) return str;
  let out = str;
  while (out.length > 1 && measure(ctx, `${out}…`, size, weight) > maxWidth) out = out.slice(0, -1);
  return `${out}…`;
}

function money(value, digits = 2) {
  if (value == null || !Number.isFinite(Number(value))) return '—';
  return `¥${Number(value).toLocaleString('zh-CN', { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;
}

function num(value, digits = 0) {
  if (value == null || !Number.isFinite(Number(value))) return '—';
  return Number(value).toLocaleString('zh-CN', { minimumFractionDigits: 0, maximumFractionDigits: digits });
}

function statusMeta(status) {
  if (status === 'overdue') return { text: '已到期', bg: '#fbe4e4', color: '#c74444' };
  if (status === 'soon') return { text: '即将到期', bg: '#fbf3db', color: '#8a6116' };
  if (status === 'unknown') return { text: '待设置', bg: '#f1f1ef', color: '#787774' };
  return { text: '状态正常', bg: '#dbedeb', color: '#0f7b6c' };
}

function drawBrand(ctx, x, y, size = 40) {
  fillRound(ctx, x, y, size, size, 9, '#e7f3fd');
  ctx.save();
  ctx.strokeStyle = '#2383e2';
  ctx.lineWidth = 2.2;
  ctx.beginPath();
  ctx.arc(x + size / 2, y + size / 2, size * 0.27, Math.PI * 0.15, Math.PI * 0.85);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(x + size / 2, y + size / 2);
  ctx.lineTo(x + size * 0.68, y + size * 0.28);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(x + size / 2, y + size / 2, 2.4, 0, Math.PI * 2);
  ctx.fillStyle = '#2383e2';
  ctx.fill();
  ctx.restore();
}

function miniBars(ctx, monthly, x, y, width, height) {
  const items = monthly.slice(-4);
  if (!items.length) return;
  const max = Math.max(...items.map((m) => Number(m.total) || 0), 1);
  const gap = 22;
  const barW = (width - gap * (items.length - 1)) / items.length;
  items.forEach((item, index) => {
    const h = Math.max(4, ((Number(item.total) || 0) / max) * (height - 34));
    const bx = x + index * (barW + gap);
    const by = y + height - h;
    fillRound(ctx, bx, by, barW, h, 4, index === items.length - 1 ? '#2383e2' : '#dbe9f8');
    text(ctx, `¥${num(item.total, 0)}`, bx + barW / 2, by - 9, { size: 13, color: '#787774', align: 'center' });
    text(ctx, `${Number(item.month.slice(5, 7))}月`, bx + barW / 2, y + height + 20, { size: 13, color: '#9b9a97', align: 'center' });
  });
}

export function renderShareCard(canvas, data) {
  // Twitter / X style social card: 1200 x 630 (1.91:1)
  const W = 1200;
  const H = 630;
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  const vehicle = data.vehicle || {};
  const accent = vehicle.color || '#2383e2';

  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, W, H);

  // soft accent wash in the corner
  const glow = ctx.createRadialGradient(W - 100, -60, 10, W - 100, -60, 430);
  glow.addColorStop(0, `${accent}1f`);
  glow.addColorStop(1, `${accent}00`);
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, W, 380);

  const left = 64;
  const right = W - 64;
  drawBrand(ctx, left, 48, 36);
  text(ctx, '车记', left + 48, 67, { size: 20, weight: 600, color: '#37352f' });
  text(ctx, 'VEHICLE METER', left + 48, 83, { size: 8.5, color: '#9b9a97', letterSpacing: 1.6 });
  text(ctx, data.to ? `截至 ${data.to.replaceAll('-', '.')}` : '', right, 70, { size: 13, color: '#9b9a97', align: 'right' });

  ctx.strokeStyle = '#e9e9e7';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(left, 106);
  ctx.lineTo(right, 106);
  ctx.stroke();

  text(ctx, '最近 3 个月用车卡片', left, 143, { size: 12.5, color: '#9b9a97', letterSpacing: 1 });

  text(ctx, vehicle.name || '我的爱车', left, 197, { size: 40, weight: 600, color: '#37352f' });
  const plate = vehicle.plateNo || '未填写车牌';
  text(ctx, plate, left, 227, { size: 17, color: '#787774' });
  const tagText = vehicle.energyType === 'ev' ? '纯电' : vehicle.energyType === 'phev' ? '混动' : '燃油';
  const tagW = measure(ctx, tagText, 13) + 20;
  fillRound(ctx, left + measure(ctx, plate, 16) + 12, 210, tagW, 23, 4, '#f1f1ef');
  text(ctx, tagText, left + measure(ctx, plate, 16) + 12 + tagW / 2, 226, { size: 13, color: '#787774', align: 'center' });

  const fuel = data.fuel;
  const charge = data.charge;
  const isPhev = vehicle.energyType === 'phev' && (fuel || charge);
  if (isPhev) {
    text(ctx, '平均油耗', left, 284, { size: 13, color: '#787774' });
    text(ctx, fuel?.avgConsumption != null ? num(fuel.avgConsumption, 1) : '—', left, 350, { size: 58, weight: 600, font: MONO, color: '#37352f' });
    text(ctx, 'L/100km', left, 372, { size: 15, color: '#9b9a97' });
    text(ctx, '平均电耗', left + 270, 284, { size: 13, color: '#787774' });
    text(ctx, charge?.avgConsumption != null ? num(charge.avgConsumption, 1) : '—', left + 270, 350, { size: 58, weight: 600, font: MONO, color: '#37352f' });
    text(ctx, 'kWh/100km', left + 270, 372, { size: 15, color: '#9b9a97' });
  } else {
    const isEv = vehicle.energyType === 'ev';
    const main = isEv ? charge : fuel;
    text(ctx, isEv ? '近 3 个月平均电耗' : '近 3 个月平均油耗', left, 282, { size: 13, color: '#787774' });
    text(ctx, main?.avgConsumption != null ? num(main.avgConsumption, 1) : '—', left, 380, { size: 98, weight: 600, font: MONO, color: '#37352f' });
    text(ctx, isEv ? 'kWh / 100km' : 'L / 100km', left + measure(ctx, main?.avgConsumption != null ? num(main.avgConsumption, 1) : '—', 98, 600) + 14, 380, { size: 18, color: '#9b9a97' });
    if (main?.unitPrice != null) {
      text(ctx, isEv ? `平均电价 ¥${num(main.unitPrice, 2)}/kWh` : `平均油价 ¥${num(main.unitPrice, 2)}/L`, left, 414, { size: 14, color: '#787774' });
    }
  }

  // bottom metric strip
  const metrics = [
    { label: '近 3 个月行驶', value: `${num(data.mileage, 0)} km` },
    { label: '近 3 个月支出', value: money(data.totalCost, 0) },
    { label: '每公里成本', value: data.costPerKm == null ? '—' : money(data.costPerKm, 2) },
    { label: '当前总里程', value: `${num(data.latestOdometer, 0)} km` }
  ];
  const stripY = 492;
  ctx.strokeStyle = '#e9e9e7';
  ctx.beginPath();
  ctx.moveTo(left, 458);
  ctx.lineTo(right, 458);
  ctx.stroke();
  const cellW = (right - left) / 4;
  metrics.forEach((item, index) => {
    const x = left + index * cellW;
    if (index > 0) {
      ctx.strokeStyle = '#f1f1ef';
      ctx.beginPath();
      ctx.moveTo(x - 12, stripY - 20);
      ctx.lineTo(x - 12, stripY + 36);
      ctx.stroke();
    }
    text(ctx, item.label, x, stripY, { size: 13, color: '#9b9a97' });
    text(ctx, item.value, x, stripY + 32, { size: 26, weight: 600, color: '#37352f' });
  });

  // right panel: next maintenance + spend bars
  const panelX = 700;
  const panelY = 128;
  const panelW = right - panelX;
  const panelH = 300;
  fillRound(ctx, panelX, panelY, panelW, panelH, 12, '#f7f7f5');
  strokeRound(ctx, panelX, panelY, panelW, panelH, 12, '#e9e9e7', 1);
  text(ctx, '下一次保养', panelX + 20, panelY + 30, { size: 12, color: '#9b9a97', letterSpacing: 0.5 });
  if (data.nextMaintenance) {
    const next = data.nextMaintenance;
    text(ctx, ellipsis(ctx, next.name, panelW - 130, 19, 600), panelX + 20, panelY + 61, { size: 20, weight: 600, color: '#37352f' });
    const parts = [];
    if (next.dueDate) parts.push(next.dueDate.replaceAll('-', '.'));
    if (next.remainingKm != null) parts.push(next.remainingKm < 0 ? `超出 ${num(-next.remainingKm, 0)} km` : `还剩 ${num(next.remainingKm, 0)} km`);
    text(ctx, parts.join(' · ') || '未设置到期条件', panelX + 20, panelY + 86, { size: 12.5, color: '#787774' });
    const meta = statusMeta(next.status);
    const pillW = measure(ctx, meta.text, 11) + 20;
    fillRound(ctx, panelX + panelW - 20 - pillW, panelY + 42, pillW, 26, 4, meta.bg);
    text(ctx, meta.text, panelX + panelW - 20 - pillW / 2, panelY + 60, { size: 12, color: meta.color, align: 'center' });
  } else {
    text(ctx, '还没有保养计划', panelX + 20, panelY + 64, { size: 17, weight: 500, color: '#787774' });
    text(ctx, '在车记中创建计划，到期自动提醒', panelX + 20, panelY + 88, { size: 11, color: '#9b9a97' });
  }
  ctx.strokeStyle = '#e9e9e7';
  ctx.beginPath();
  ctx.moveTo(panelX + 20, panelY + 106);
  ctx.lineTo(panelX + panelW - 20, panelY + 106);
  ctx.stroke();
  text(ctx, '近 4 个月支出', panelX + 20, panelY + 130, { size: 12, color: '#9b9a97' });
  miniBars(ctx, data.monthly || [], panelX + 20, panelY + 142, panelW - 40, 122);

  ctx.strokeStyle = '#e9e9e7';
  ctx.beginPath();
  ctx.moveTo(left, 572);
  ctx.lineTo(right, 572);
  ctx.stroke();
  text(ctx, '数据来自 车记 · Vehicle Meter', left, 598, { size: 11.5, color: '#9b9a97' });
  text(ctx, data.to ? `${data.from} ~ ${data.to}` : '', right, 598, { size: 11.5, color: '#9b9a97', align: 'right' });
}

function drawReportChart(ctx, monthly, x, y, width, height) {
  const items = monthly.slice(-12);
  if (!items.length) return;
  const max = Math.max(...items.map((m) => Number(m.total) || 0), 1);
  const chartH = height - 38;
  const left = x + 52;
  const bottom = y + chartH;
  ctx.save();
  ctx.strokeStyle = '#f1f1ef';
  ctx.lineWidth = 1;
  ctx.font = `11px ${FONT}`;
  ctx.fillStyle = '#9b9a97';
  for (let i = 0; i <= 3; i++) {
    const yy = y + (chartH / 3) * i;
    ctx.beginPath();
    ctx.moveTo(left, yy);
    ctx.lineTo(x + width, yy);
    ctx.stroke();
    const value = Math.round((max / 3) * (3 - i));
    ctx.textAlign = 'right';
    ctx.fillText(value >= 1000 ? `${(value / 1000).toFixed(1)}k` : String(value), left - 10, yy + 4);
  }
  const gap = 12;
  const plotRight = x + width;
  const available = plotRight - left - gap * (items.length - 1);
  const barW = Math.min(46, Math.max(6, available / items.length));
  const totalWidth = barW * items.length + gap * (items.length - 1);
  const startX = left + Math.max(0, (plotRight - left - totalWidth) / 2);
  items.forEach((item, index) => {
    const h = Math.max(2, ((Number(item.total) || 0) / max) * chartH);
    const bx = startX + index * (barW + gap);
    const by = bottom - h;
    ctx.fillStyle = index === items.length - 1 ? '#2383e2' : '#c9dff5';
    ctx.beginPath();
    ctx.roundRect?.(bx, by, barW, h, [3, 3, 0, 0]);
    if (!ctx.roundRect) ctx.rect(bx, by, barW, h);
    ctx.fill();
    if (index % 2 === 0 || items.length <= 6) {
      ctx.fillStyle = '#9b9a97';
      ctx.textAlign = 'center';
      ctx.font = `11px ${FONT}`;
      ctx.fillText(`${Number(item.month.slice(5, 7))}月`, bx + barW / 2, bottom + 20);
    }
  });
  ctx.restore();
}

export function renderReportCanvas(canvas, report) {
  const W = 1240;
  const H = 1600;
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  const vehicle = report.vehicle || {};
  const accent = vehicle.color || '#2383e2';

  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, W, H);

  // Light page header
  ctx.fillStyle = '#f7f7f5';
  ctx.fillRect(0, 0, W, 282);
  ctx.strokeStyle = '#e9e9e7';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, 282);
  ctx.lineTo(W, 282);
  ctx.stroke();

  drawBrand(ctx, 76, 58, 38);
  text(ctx, '车记', 128, 79, { size: 19, weight: 600, color: '#37352f' });
  text(ctx, 'VEHICLE METER', 128, 97, { size: 8, color: '#9b9a97', letterSpacing: 1.8 });
  text(ctx, '用车报告', 76, 188, { size: 44, weight: 600, color: '#37352f' });
  text(ctx, report.label || '', 76, 224, { size: 17, color: '#787774' });
  text(ctx, vehicle.name || '', W - 76, 184, { size: 25, weight: 600, color: '#37352f', align: 'right' });
  text(ctx, [vehicle.plateNo, vehicle.brandModel].filter(Boolean).join(' · '), W - 76, 214, { size: 14, color: '#787774', align: 'right' });
  text(ctx, `生成于 ${new Date().toLocaleDateString('zh-CN')}`, W - 76, 242, { size: 12, color: '#9b9a97', align: 'right' });
  fillRound(ctx, W - 82, 70, 6, 74, 3, accent);

  const cost = report.cost;
  const energy = report.energy || {};
  const energyMain = energy.fuel?.avgConsumption != null
    ? { label: '平均油耗', value: `${num(energy.fuel.avgConsumption, 1)} L/100km` }
    : energy.charge?.avgConsumption != null
      ? { label: '平均电耗', value: `${num(energy.charge.avgConsumption, 1)} kWh/100km` }
      : { label: '平均能耗', value: '—' };

  const kpis = [
    { label: '总支出', value: money(cost.total, 2), sub: `${cost.count + cost.maintenanceCount} 笔记录` },
    { label: '行驶里程', value: `${num(cost.mileage.km, 0)} km`, sub: cost.mileage.estimated ? '基于里程记录估算' : '按仪表里程计算' },
    { label: '每公里成本', value: cost.costPerKm == null ? '—' : money(cost.costPerKm, 2), sub: '含日常费用与保养' },
    { label: energyMain.label, value: energyMain.value, sub: '按记录自动计算' }
  ];
  const cardW = (W - 152 - 60) / 4;
  kpis.forEach((item, index) => {
    const x = 76 + index * (cardW + 20);
    fillRound(ctx, x, 316, cardW, 118, 8, '#ffffff');
    strokeRound(ctx, x, 316, cardW, 118, 8, '#e9e9e7', 1);
    text(ctx, item.label, x + 20, 348, { size: 12, color: '#787774' });
    text(ctx, item.value, x + 20, 389, { size: 24, weight: 600, color: '#37352f' });
    text(ctx, item.sub, x + 20, 413, { size: 10, color: '#9b9a97' });
  });

  let y = 478;
  fillRound(ctx, 76, y, W - 152, 146, 8, '#f7f7f5');
  strokeRound(ctx, 76, y, W - 152, 146, 8, '#e9e9e7', 1);
  text(ctx, '本期洞察', 100, y + 32, { size: 14, weight: 600, color: '#37352f' });
  (report.insights || []).slice(0, 3).forEach((insight, index) => {
    const dotColor = insight.tone === 'warn' ? '#cb912f' : insight.tone === 'good' ? '#0f7b6c' : '#2383e2';
    ctx.fillStyle = dotColor;
    ctx.beginPath();
    ctx.arc(108, y + 62 + index * 25, 3, 0, Math.PI * 2);
    ctx.fill();
    text(ctx, ellipsis(ctx, insight.text, W - 250, 13), 122, y + 67 + index * 25, { size: 13, color: '#5f5e5b' });
  });

  y = 670;
  text(ctx, '费用构成', 76, y, { size: 15, weight: 600, color: '#37352f' });
  text(ctx, '按类别统计', 76, y + 20, { size: 11, color: '#9b9a97' });
  const categories = (report.categories || []).slice(0, 6);
  const catX = 76;
  const catW = 470;
  categories.forEach((category, index) => {
    const cy = y + 40 + index * 47;
    fillRound(ctx, catX, cy, catW, 38, 4, '#f7f7f5');
    ctx.fillStyle = category.color || '#9b9a97';
    ctx.beginPath();
    ctx.arc(catX + 16, cy + 19, 4, 0, Math.PI * 2);
    ctx.fill();
    text(ctx, ellipsis(ctx, category.label, 120, 12), catX + 28, cy + 24, { size: 12, color: '#5f5e5b' });
    text(ctx, money(category.amount, 2), catX + catW - 66, cy + 24, { size: 12, weight: 600, color: '#37352f', align: 'right' });
    text(ctx, `${category.percent}%`, catX + catW - 14, cy + 24, { size: 11, color: '#9b9a97', align: 'right' });
  });

  const chartX = 590;
  const chartW = W - chartX - 76;
  fillRound(ctx, chartX, y - 18, chartW, 286, 8, '#ffffff');
  strokeRound(ctx, chartX, y - 18, chartW, 286, 8, '#e9e9e7', 1);
  text(ctx, '月度费用趋势', chartX + 22, y + 10, { size: 13, weight: 600, color: '#37352f' });
  drawReportChart(ctx, report.monthly || [], chartX + 22, y + 36, chartW - 44, 210);

  y = 980;
  text(ctx, '保养记录', 76, y, { size: 15, weight: 600, color: '#37352f' });
  text(ctx, `保养支出 ${money(cost.maintenanceCost, 2)} · ${cost.maintenanceCount} 次`, 76, y + 20, { size: 11, color: '#9b9a97' });
  const records = (report.maintenanceRecords || []).slice(0, 4);
  if (records.length) {
    records.forEach((record, index) => {
      const ry = y + 38 + index * 44;
      fillRound(ctx, 76, ry, W - 152, 38, 4, index % 2 === 0 ? '#f7f7f5' : '#ffffff');
      text(ctx, record.serviceOn, 92, ry + 24, { size: 11, color: '#787774' });
      text(ctx, ellipsis(ctx, record.items || record.planName || '保养', 460, 12), 200, ry + 24, { size: 12, color: '#5f5e5b' });
      text(ctx, record.odometer != null ? `${num(record.odometer, 0)} km` : '—', 760, ry + 24, { size: 11, color: '#787774' });
      text(ctx, money(record.cost, 2), W - 92, ry + 24, { size: 12, weight: 600, color: '#37352f', align: 'right' });
    });
  } else {
    fillRound(ctx, 76, y + 36, W - 152, 62, 6, '#f7f7f5');
    text(ctx, '本期没有保养记录', 96, y + 73, { size: 12, color: '#9b9a97' });
  }

  // top expenses (left) + next maintenance (right)
  const lowerY = 1216;
  text(ctx, '大额支出', 76, lowerY, { size: 14, weight: 600, color: '#37352f' });
  text(ctx, '本期金额最高的用车支出', 76, lowerY + 20, { size: 11, color: '#9b9a97' });
  const topExpenses = (report.topExpenses || []).slice(0, 3);
  if (topExpenses.length) {
    topExpenses.forEach((expense, index) => {
      const ry = lowerY + 36 + index * 38;
      fillRound(ctx, 76, ry, 520, 34, 4, '#f7f7f5');
      text(ctx, expense.occurredOn, 92, ry + 22, { size: 11, color: '#787774' });
      text(
        ctx,
        ellipsis(ctx, expense.station || expense.note || CATEGORY_LABELS[expense.category] || '用车支出', 290, 12),
        184,
        ry + 22,
        { size: 12, color: '#5f5e5b' }
      );
      text(ctx, money(expense.amount, 2), 580, ry + 22, { size: 12, weight: 600, color: '#37352f', align: 'right' });
    });
  } else {
    fillRound(ctx, 76, lowerY + 36, 520, 62, 6, '#f7f7f5');
    text(ctx, '本期暂无费用记录', 96, lowerY + 73, { size: 12, color: '#9b9a97' });
  }

  const planCardX = 640;
  const planCardW = W - planCardX - 76;
  fillRound(ctx, planCardX, lowerY - 18, planCardW, 132, 8, '#ffffff');
  strokeRound(ctx, planCardX, lowerY - 18, planCardW, 132, 8, '#e9e9e7', 1);
  text(ctx, '下一次保养', planCardX + 20, lowerY + 10, { size: 11, color: '#9b9a97' });
  const nextPlan = (report.plans || [])[0];
  if (nextPlan) {
    text(ctx, ellipsis(ctx, nextPlan.name, planCardW - 150, 18, 600), planCardX + 20, lowerY + 40, { size: 18, weight: 600, color: '#37352f' });
    const parts = [];
    if (nextPlan.dueDate) parts.push(nextPlan.dueDate.replaceAll('-', '.'));
    if (nextPlan.remainingKm != null) parts.push(nextPlan.remainingKm < 0 ? `超出 ${num(-nextPlan.remainingKm, 0)} km` : `还剩 ${num(nextPlan.remainingKm, 0)} km`);
    text(ctx, parts.join(' · ') || '未设置到期条件', planCardX + 20, lowerY + 64, { size: 11.5, color: '#787774' });
    const meta = statusMeta(nextPlan.status);
    const pillW = measure(ctx, meta.text, 11) + 20;
    fillRound(ctx, planCardX + planCardW - 20 - pillW, lowerY + 24, pillW, 26, 4, meta.bg);
    text(ctx, meta.text, planCardX + planCardW - 20 - pillW / 2, lowerY + 42, { size: 11, color: meta.color, align: 'center' });
  } else {
    text(ctx, '还没有保养计划', planCardX + 20, lowerY + 42, { size: 16, weight: 500, color: '#787774' });
  }

  // method note
  const noteY = 1372;
  fillRound(ctx, 76, noteY, W - 152, 82, 8, '#f7f7f5');
  text(ctx, '统计说明', 100, noteY + 26, { size: 11.5, weight: 600, color: '#37352f' });
  text(ctx, '油耗采用满箱法：两次加满之间的加油量与仪表里程计算；电耗按相邻两次充电区间统计。', 100, noteY + 48, { size: 10.5, color: '#787774' });
  text(ctx, '保养记录费用已计入总支出与每公里成本；里程数据来自费用与保养记录中的仪表里程。', 100, noteY + 66, { size: 10.5, color: '#787774' });

  const footerY = 1500;
  ctx.strokeStyle = '#e9e9e7';
  ctx.beginPath();
  ctx.moveTo(76, footerY);
  ctx.lineTo(W - 76, footerY);
  ctx.stroke();
  text(ctx, '车记 · 用车管理', 76, footerY + 26, { size: 11, color: '#9b9a97' });
  text(ctx, `${report.from} ~ ${report.to} · 数据来自本机数据库`, W - 76, footerY + 26, { size: 11, color: '#9b9a97', align: 'right' });
  text(ctx, '本报告由车记自动生成，用于个人用车成本分析。', 76, footerY + 48, { size: 10, color: '#c4c3bf' });
}

export function downloadCanvas(canvas, filename) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error('图片生成失败'));
        return;
      }
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
      resolve(filename);
    }, 'image/png');
  });
}
