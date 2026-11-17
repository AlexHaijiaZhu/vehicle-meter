import { api } from '../api.js';
import { currentVehicle, state } from '../store.js';
import { CATEGORIES } from '../constants.js';
import { icon } from '../icons.js';
import { barChart } from '../charts.js';
import {
  categoryChip,
  emptyState,
  esc,
  fmtDate,
  fmtMoney,
  fmtNum,
  go,
  monthOptions,
  openModal,
  setBusy,
  skeleton,
  toast,
  todayStr,
  yearOptions
} from '../ui.js';
import { downloadCanvas, renderReportCanvas, renderShareCard } from '../sharecard.js';

let period = 'month';
let month = todayStr().slice(0, 7);
let year = todayStr().slice(0, 4);
let customFrom = `${todayStr().slice(0, 7)}-01`;
let customTo = todayStr();

function periodQuery() {
  if (period === 'month') return { period, month };
  if (period === 'year') return { period, year };
  if (period === 'custom') return { period, from: customFrom, to: customTo };
  return { period: 'all' };
}

function safeName(text) {
  return String(text).replace(/[\\/:*?"<>|\s]+/g, '-').slice(0, 60);
}

export async function render(root) {
  const vehicle = currentVehicle();
  if (!vehicle) return;
  root.innerHTML = `<div class="page-stack">${skeleton(4)}</div>`;
  let data;
  try {
    data = await api.get('/api/reports', { vehicleId: vehicle.id, ...periodQuery() });
  } catch (err) {
    root.innerHTML = `<div class="card"><div class="inline-error">${icon('alert', 18)}${esc(err.message)}</div></div>`;
    return;
  }

  const refresh = () => render(root);
  const periodTabs = [
    { key: 'month', label: '月度' },
    { key: 'year', label: '年度' },
    { key: 'all', label: '累计' },
    { key: 'custom', label: '自定义' }
  ].map((item) => `<button class="seg-btn ${period === item.key ? 'active' : ''}" data-period="${item.key}">${item.label}</button>`).join('');

  const periodInputs = period === 'month'
    ? `<select class="select" data-month>${monthOptions(24).map((opt) => `<option value="${opt.value}" ${opt.value === month ? 'selected' : ''}>${opt.label}</option>`).join('')}</select>`
    : period === 'year'
      ? `<select class="select" data-year>${yearOptions(6).map((opt) => `<option value="${opt.value}" ${opt.value === year ? 'selected' : ''}>${opt.label}</option>`).join('')}</select>`
      : period === 'custom'
        ? `<input type="date" class="select" data-from value="${customFrom}"><span class="muted">至</span><input type="date" class="select" data-to value="${customTo}"><button class="btn btn-soft btn-sm" data-apply>应用</button>`
        : `<span class="badge badge-soft">全部历史数据 · 截至 ${fmtDate(data.to)}</span>`;

  const kpis = [
    { label: '总支出', value: fmtMoney(data.cost.total, { digits: 2 }), sub: `${data.cost.count + data.cost.maintenanceCount} 笔记录`, iconName: 'wallet' },
    { label: '行驶里程', value: `${fmtNum(data.cost.mileage.km, 0)}<small>km</small>`, sub: '按仪表里程计算', iconName: 'route' },
    { label: '每公里成本', value: data.cost.costPerKm == null ? '—' : fmtMoney(data.cost.costPerKm), sub: '含日常费用与保养', iconName: 'calculator' },
    {
      label: data.energy.fuel ? '平均油耗' : '平均电耗',
      value: data.energy.fuel
        ? `${fmtNum(data.energy.fuel.avgConsumption, 1)}<small>L/100km</small>`
        : data.energy.charge
          ? `${fmtNum(data.energy.charge.avgConsumption, 1)}<small>kWh/100km</small>`
          : '—',
      sub: data.energy.fuel ? `油费 ${fmtMoney(data.energy.fuel.cost)}` : data.energy.charge ? `电费 ${fmtMoney(data.energy.charge.cost)}` : '暂无能源记录',
      iconName: data.energy.fuel ? 'fuel' : 'bolt'
    }
  ];

  root.innerHTML = `<div class="page-stack">
    <section class="card report-controls">
      <div class="report-control-row">
        <div class="segmented">${periodTabs}</div>
        <div class="report-period-inputs">${periodInputs}</div>
        <div class="toolbar-spacer"></div>
        <div class="button-row">
          <button class="btn btn-soft" data-share>${icon('share', 16)}分享卡片</button>
          <button class="btn btn-soft" data-print>${icon('printer', 16)}打印</button>
          <button class="btn btn-primary" data-export>${icon('image', 16)}导出报告图片</button>
        </div>
      </div>
    </section>

    <article class="report-paper" id="reportPaper">
      <header class="report-header">
        <div class="report-brand">
          <div class="report-logo">${icon('gauge', 24)}</div>
          <div><b>车记</b><span>VEHICLE METER</span></div>
        </div>
        <div class="report-title">
          <h2>用车报告</h2>
          <p>${esc(data.label)}</p>
        </div>
        <div class="report-meta">
          <b>${esc(data.vehicle.name)}</b>
          <span>${esc(data.vehicle.plateNo || '未填写车牌')}</span>
          <span>生成于 ${fmtDate(data.generatedAt)}</span>
        </div>
      </header>

      <div class="report-kpis">
        ${kpis.map((item) => `<div class="report-kpi">
          <div class="report-kpi-icon">${icon(item.iconName, 18)}</div>
          <span>${item.label}</span>
          <b>${item.value}</b>
          <small>${item.sub}</small>
        </div>`).join('')}
      </div>

      <section class="report-section">
        <div class="report-section-head"><h3>本期洞察</h3><span>${data.from} ~ ${data.to}</span></div>
        <ul class="report-insights">
          ${(data.insights || []).map((insight) => `<li class="tone-${insight.tone}"><i></i>${esc(insight.text)}</li>`).join('') || '<li>暂无足够数据生成洞察</li>'}
        </ul>
      </section>

      <div class="report-grid">
        <section class="report-section">
          <div class="report-section-head"><h3>费用构成</h3><span>共 ${fmtMoney(data.cost.total)}</span></div>
          <div class="report-categories">
            ${data.categories.length
              ? data.categories.map((category) => `<div class="report-cat-row">
                  <span class="report-cat-dot" style="background:${category.color}"></span>
                  <span class="report-cat-label">${esc(category.label)}</span>
                  <span class="report-cat-bar"><i style="width:${category.percent}%;background:${category.color}"></i></span>
                  <b>${fmtMoney(category.amount)}</b>
                  <small>${category.percent}%</small>
                </div>`).join('')
              : '<p class="muted">本期暂无费用</p>'}
          </div>
        </section>
        <section class="report-section">
          <div class="report-section-head"><h3>月度趋势</h3><span>日常费用 + 保养</span></div>
          <div class="report-chart" id="reportChart"></div>
        </section>
      </div>

      <div class="report-grid report-grid-lower">
        <section class="report-section">
          <div class="report-section-head"><h3>保养记录</h3><span>${data.cost.maintenanceCount} 次 · ${fmtMoney(data.cost.maintenanceCost)}</span></div>
          ${data.maintenanceRecords.length
            ? `<div class="report-records">${data.maintenanceRecords.slice(0, 5).map((record) => `<div class="report-record">
                <span>${fmtDate(record.serviceOn, { short: true })}</span>
                <b>${esc(record.items || record.planName || '保养')}</b>
                <small>${record.odometer != null ? `${fmtNum(record.odometer, 0)} km` : ''}</small>
                <strong>${fmtMoney(record.cost)}</strong>
              </div>`).join('')}</div>`
            : '<p class="muted">本期没有保养记录</p>'}
        </section>
        <section class="report-section">
          <div class="report-section-head"><h3>大额支出</h3><span>Top 5</span></div>
          ${data.topExpenses.length
            ? `<div class="report-records">${data.topExpenses.map((expense) => `<div class="report-record">
                <span>${fmtDate(expense.occurredOn, { short: true })}</span>
                <b>${esc(expense.station || CATEGORIES[expense.category]?.label || '支出')}</b>
                <small>${esc(CATEGORIES[expense.category]?.label || '')}</small>
                <strong>${fmtMoney(expense.amount)}</strong>
              </div>`).join('')}</div>`
            : '<p class="muted">本期暂无费用记录</p>'}
        </section>
      </div>

      <footer class="report-footer">
        <span>车记 · 用车管理</span>
        <span>${data.from} 至 ${data.to} · 数据来自本机数据库</span>
      </footer>
    </article>

    <section class="note-card">
      ${icon('info', 18)}
      <div><b>报告包含什么？</b><p>报告汇总所选周期内的日常费用、保养支出、里程、能耗与每公里成本；导出图片为高清 PNG，可直接分享。</p></div>
    </section>
  </div>`;

  barChart(root.querySelector('#reportChart'), {
    labels: data.monthly.map((m) => `${Number(m.month.slice(5, 7))}月`),
    series: [
      { name: '日常费用', color: '#2383e2', values: data.monthly.map((m) => m.expense) },
      { name: '保养', color: '#0f7b6c', values: data.monthly.map((m) => m.maintenance) }
    ],
    stacked: true,
    unit: '元',
    height: 250
  });

  root.querySelectorAll('[data-period]').forEach((button) => button.addEventListener('click', () => {
    period = button.dataset.period;
    render(root);
  }));
  root.querySelector('[data-month]')?.addEventListener('change', (event) => {
    month = event.target.value;
    render(root);
  });
  root.querySelector('[data-year]')?.addEventListener('change', (event) => {
    year = event.target.value;
    render(root);
  });
  root.querySelector('[data-apply]')?.addEventListener('click', () => {
    const from = root.querySelector('[data-from]').value;
    const to = root.querySelector('[data-to]').value;
    if (!from || !to) { toast('请选择起止日期', 'info'); return; }
    if (from > to) { toast('开始日期不能晚于结束日期', 'error'); return; }
    customFrom = from;
    customTo = to;
    render(root);
  });
  root.querySelector('[data-print]').addEventListener('click', () => window.print());
  root.querySelector('[data-export]').addEventListener('click', async (event) => {
    const button = event.currentTarget;
    setBusy(button, true, '生成中…');
    try {
      const canvas = document.createElement('canvas');
      renderReportCanvas(canvas, data);
      const filename = `用车报告-${safeName(data.label)}-${safeName(data.vehicle.name)}.png`;
      await downloadCanvas(canvas, filename);
      toast('报告图片已导出');
    } catch (err) {
      toast(err.message || '导出失败', 'error');
    } finally {
      setBusy(button, false);
    }
  });
  root.querySelector('[data-share]').addEventListener('click', async (event) => {
    const button = event.currentTarget;
    setBusy(button, true, '准备中…');
    try {
      const card = await api.get('/api/card', { vehicleId: vehicle.id, months: 3 });
      openShareCard(card);
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setBusy(button, false);
    }
  });
}

function openShareCard(card) {
  const modal = openModal({
    title: '一键分享卡片',
    subtitle: '最近 3 个月平均能耗、里程与下一次保养 · 1200 × 630 社交卡片',
    size: 'lg',
    body: `<div class="share-preview"><canvas id="shareCanvas"></canvas></div>`,
    footer: `<button class="btn btn-ghost" type="button" data-cancel>关闭</button>
      <button class="btn btn-primary" type="button" data-download>${icon('download', 16)}下载 PNG</button>`,
    onMount: (ctx) => {
      const canvas = ctx.$('#shareCanvas');
      renderShareCard(canvas, card);
      ctx.$('[data-cancel]').addEventListener('click', ctx.close);
      ctx.$('[data-download]').addEventListener('click', async () => {
        const button = ctx.$('[data-download]');
        setBusy(button, true, '生成中…');
        try {
          await downloadCanvas(canvas, `车记卡片-${safeName(card.vehicle.plateNo || card.vehicle.name)}-${todayStr()}.png`);
          toast('卡片已下载');
        } catch (err) {
          toast(err.message, 'error');
        } finally {
          setBusy(button, false);
        }
      });
    }
  });
  return modal;
}
