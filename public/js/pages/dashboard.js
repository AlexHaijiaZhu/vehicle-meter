import { api } from '../api.js';
import { state, currentVehicle } from '../store.js';
import { CATEGORIES, ENERGY_TYPES } from '../constants.js';
import { icon } from '../icons.js';
import { barChart, donutChart } from '../charts.js';
import {
  categoryChip,
  esc,
  fmtKm,
  fmtMoney,
  fmtNum,
  fmtQuantity,
  go,
  progressBar,
  relativeDay,
  skeleton,
  statusPill,
  toast,
  trendBadge
} from '../ui.js';
import { openExpenseModal, openRecordModal } from '../modals.js';

function energyTile(data) {
  const vehicle = data.vehicle;
  const last = data.last3?.energy || {};
  const current = data.energy || {};
  const fuel = last.fuel || current.fuel;
  const charge = last.charge || current.charge;
  if (vehicle.energyType === 'ev') {
    return {
      label: '近 3 个月平均电耗',
      value: charge?.avgConsumption != null ? `${fmtNum(charge.avgConsumption, 1)}<small>kWh/100km</small>` : '—',
      sub: charge ? `充电 ${fmtQuantity(charge.quantity, 'kWh')} · ${fmtMoney(charge.cost)}` : '记录两次充电后自动计算',
      icon: 'bolt',
      tone: 'green'
    };
  }
  if (vehicle.energyType === 'phev') {
    const parts = [];
    if (fuel?.avgConsumption != null) parts.push(`${fmtNum(fuel.avgConsumption, 1)} L`);
    if (charge?.avgConsumption != null) parts.push(`${fmtNum(charge.avgConsumption, 1)} kWh`);
    return {
      label: '近 3 个月平均能耗',
      value: parts.length ? `${parts.join(' · ')}<small>/100km</small>` : '—',
      sub: '燃油与充电分开统计',
      icon: 'leaf',
      tone: 'violet'
    };
  }
  return {
    label: '近 3 个月平均油耗',
    value: fuel?.avgConsumption != null ? `${fmtNum(fuel.avgConsumption, 1)}<small>L/100km</small>` : '—',
    sub: fuel ? `加油 ${fmtQuantity(fuel.quantity, 'L')} · ${fmtMoney(fuel.cost)}` : '加满两次油后自动计算',
    icon: 'fuel',
    tone: 'amber'
  };
}

function planDueText(plan) {
  const parts = [];
  if (plan.dueDate) {
    parts.push(plan.remainingDays == null ? plan.dueDate : plan.remainingDays < 0 ? `已过期 ${-plan.remainingDays} 天` : `还有 ${plan.remainingDays} 天`);
  }
  if (plan.dueOdo != null) {
    parts.push(plan.remainingKm == null ? `${fmtNum(plan.dueOdo)} km` : plan.remainingKm < 0 ? `超出 ${fmtNum(-plan.remainingKm)} km` : `还剩 ${fmtNum(plan.remainingKm)} km`);
  }
  return parts.join(' · ') || '未设置到期条件';
}

export async function render(root) {
  const vehicle = currentVehicle();
  if (!vehicle) return;
  const month = state.today?.slice(0, 7) || new Date().toISOString().slice(0, 7);
  const from = `${month}-01`;
  const to = state.today || new Date().toISOString().slice(0, 10);

  root.innerHTML = `<div class="page-stack">${skeleton(4)}</div>`;
  let data;
  try {
    data = await api.get('/api/stats/dashboard', { vehicleId: vehicle.id, from, to });
  } catch (err) {
    root.innerHTML = `<div class="card"><div class="inline-error">${icon('alert', 18)}${esc(err.message)}</div></div>`;
    return;
  }

  const monthLabel = `${Number(month.slice(5, 7))}月`;
  const energy = energyTile(data);
  const categories = data.cost.categories.length
    ? data.cost.categories
    : [{ label: '暂无支出', value: 0, color: '#e2e8f0' }];
  const nextPlan = data.nextMaintenance;
  const upcoming = data.plans.filter((p) => p.status === 'overdue' || p.status === 'soon').slice(0, 3);
  const recent = data.recent.slice(0, 6);

  root.innerHTML = `<div class="page-stack">
    <section class="hero-card" style="--vehicle-color:${esc(vehicle.color || '#2383e2')}">
      <div class="hero-glow"></div>
      <div class="hero-main">
        <div class="hero-eyebrow"><span class="live-dot"></span>当前车辆</div>
        <div class="hero-title">
          <h2>${esc(vehicle.name)}</h2>
          <span class="plate">${esc(vehicle.plateNo || '未填写车牌')}</span>
          <span class="tag tag-${vehicle.energyType === 'ev' ? 'green' : vehicle.energyType === 'phev' ? 'violet' : 'amber'}">${ENERGY_TYPES[vehicle.energyType]?.label || '车辆'}</span>
        </div>
        <p class="hero-sub">${esc(vehicle.brandModel || '未填写车型')}${vehicle.fuelType ? ` · ${esc(vehicle.fuelType)}` : ''}</p>
        <div class="hero-stats">
          <div><span>最新里程</span><b>${fmtNum(data.latestOdometer, 0)}<small>km</small></b></div>
          <div><span>${monthLabel}里程</span><b>${fmtNum(data.mileage.km, 0)}<small>km</small></b></div>
          <div><span>本月记录</span><b>${data.cost.count}<small>笔</small></b></div>
        </div>
        <div class="hero-actions">
          <button class="btn btn-glass" data-quick="fuel">${icon('fuel', 16)}记加油</button>
          <button class="btn btn-glass" data-quick="charge">${icon('bolt', 16)}记充电</button>
          <button class="btn btn-glass" data-quick="expense">${icon('plus', 16)}记费用</button>
          <button class="btn btn-glass" data-quick="maintenance">${icon('wrench', 16)}记保养</button>
        </div>
      </div>
      <div class="hero-side">
        <span class="hero-side-label">${monthLabel}支出</span>
        <strong class="hero-cost">${fmtMoney(data.cost.total, { digits: 2 })}</strong>
        <div class="hero-delta">${data.change == null ? '<span class="muted">暂无上月对比</span>' : `${trendBadge(data.change)} <span>较上月</span>`}</div>
        <button class="hero-link" data-go="expenses">查看费用明细 ${icon('chevronRight', 14)}</button>
      </div>
    </section>

    <section class="kpi-grid">
      <article class="kpi-card">
        <div class="kpi-head"><span>本月支出</span><i>${icon('wallet', 18)}</i></div>
        <div class="kpi-value">${fmtMoney(data.cost.total, { digits: 0 })}</div>
        <div class="kpi-foot">${data.change == null ? '暂无对比' : `${trendBadge(data.change)} 较上月`}</div>
      </article>
      <article class="kpi-card">
        <div class="kpi-head"><span>本月里程</span><i>${icon('route', 18)}</i></div>
        <div class="kpi-value">${fmtNum(data.mileage.km, 0)}<small>km</small></div>
        <div class="kpi-foot">${data.mileage.estimated ? '基于里程记录估算' : `里程区间 ${fmtNum(data.mileage.startOdo, 0)} → ${fmtNum(data.mileage.endOdo, 0)}`}</div>
      </article>
      <article class="kpi-card">
        <div class="kpi-head"><span>${esc(energy.label)}</span><i>${icon(energy.icon, 18)}</i></div>
        <div class="kpi-value kpi-small">${energy.value}</div>
        <div class="kpi-foot">${esc(energy.sub)}</div>
      </article>
      <article class="kpi-card">
        <div class="kpi-head"><span>每公里成本</span><i>${icon('calculator', 18)}</i></div>
        <div class="kpi-value">${data.cost.costPerKm == null ? '—' : fmtMoney(data.cost.costPerKm)}</div>
        <div class="kpi-foot">${data.cost.mileage.km > 0 ? `本月行驶 ${fmtNum(data.cost.mileage.km, 0)} km` : '记录里程后自动计算'}</div>
      </article>
    </section>

    <section class="grid-2">
      <article class="card chart-card">
        <header class="card-head">
          <div><h3>近 12 个月费用趋势</h3><p>日常费用与保养支出</p></div>
          <span class="badge badge-soft">${fmtMoney(data.trend.reduce((n, m) => n + (m.total || 0), 0), { digits: 0 })}</span>
        </header>
        <div class="chart-body" id="trendChart"></div>
      </article>
      <article class="card chart-card">
        <header class="card-head">
          <div><h3>${monthLabel}费用构成</h3><p>按类别拆分本月支出</p></div>
          <span class="badge badge-soft">${data.cost.count} 笔</span>
        </header>
        <div class="chart-body" id="donutChart"></div>
      </article>
    </section>

    <section class="grid-3">
      <article class="card plan-card">
        <header class="card-head">
          <div><h3>保养提醒</h3><p>${upcoming.length ? `${upcoming.length} 项需要关注` : '暂无临期项目'}</p></div>
          <button class="icon-btn" data-go="maintenance" aria-label="前往保养">${icon('chevronRight', 18)}</button>
        </header>
        <div class="plan-mini-list">
          ${upcoming.length
            ? upcoming.map((p) => `<div class="plan-mini">
                <div class="plan-mini-top"><span>${esc(p.name)}</span>${statusPill(p.status)}</div>
                <div class="plan-mini-due">${esc(planDueText(p))}</div>
                ${progressBar(p.progress, p.status === 'overdue' ? 'danger' : p.status === 'soon' ? 'warn' : '')}
              </div>`).join('')
            : `<div class="plan-mini-empty">${icon('checkCircle', 22)}<p>所有保养计划都在正常周期内</p><button class="link-btn" data-add-plan>添加保养计划</button></div>`}
        </div>
        ${nextPlan ? `<footer class="card-foot"><span class="muted">最近一项：${esc(nextPlan.name)}</span><button class="link-btn" data-go="maintenance">管理计划</button></footer>` : ''}
      </article>

      <article class="card recent-card">
        <header class="card-head">
          <div><h3>最近记录</h3><p>最新 6 笔用车流水</p></div>
          <button class="link-btn" data-go="expenses">全部</button>
        </header>
        ${recent.length
          ? `<div class="recent-list">${recent.map((r) => `<div class="recent-item">
              <span class="recent-cat">${categoryChip(r.category)}</span>
              <div class="recent-main"><b>${esc(r.station || CATEGORIES[r.category]?.label || '用车支出')}</b><span>${relativeDay(r.date)}${r.quantity ? ` · ${fmtQuantity(r.quantity, r.category === 'charge' ? 'kWh' : r.category === 'fuel' ? 'L' : '')}` : ''}</span></div>
              <div class="recent-amount">${fmtMoney(r.amount)}</div>
            </div>`).join('')}</div>`
          : `<div class="plan-mini-empty">${icon('wallet', 22)}<p>还没有用车记录</p><button class="link-btn" data-quick="expense">记第一笔</button></div>`}
      </article>

      <article class="card insight-card">
        <header class="card-head"><div><h3>本月小结</h3><p>自动生成关键洞察</p></div><i class="card-icon">${icon('sparkles', 18)}</i></header>
        <ul class="insight-list">
          <li>${icon('wallet', 15)}<span>本月共 <b>${data.cost.count}</b> 笔支出，日均 <b>${fmtMoney(data.cost.dailyAverage)}</b></span></li>
          <li>${icon('fuel', 15)}<span>${data.energy.fuel?.avgConsumption != null ? `油耗 <b>${fmtNum(data.energy.fuel.avgConsumption, 1)} L/100km</b>，能源花费 <b>${fmtMoney(data.energy.fuel.cost)}</b>` : data.energy.charge?.avgConsumption != null ? `电耗 <b>${fmtNum(data.energy.charge.avgConsumption, 1)} kWh/100km</b>，充电花费 <b>${fmtMoney(data.energy.charge.cost)}</b>` : '记录两次加油或充电后，可查看平均能耗'}</span></li>
          <li>${icon('gauge', 15)}<span>每公里成本 <b>${data.cost.costPerKm == null ? '—' : fmtMoney(data.cost.costPerKm)}</b>${data.cost.costPerKm != null && data.cost.costPerKm > 1 ? '，高于 1 元/km' : ''}</span></li>
          <li>${icon('wrench', 15)}<span>${upcoming.length ? `<b>${upcoming.length}</b> 项保养已到期或临近，建议尽快处理` : '保养计划状态良好'}</span></li>
        </ul>
        <button class="btn btn-soft btn-block" data-go="reports">${icon('report', 16)}生成本月报告</button>
      </article>
    </section>
  </div>`;

  barChart(root.querySelector('#trendChart'), {
    labels: data.trend.map((m) => `${Number(m.month.slice(5, 7))}月`),
    series: [
      { name: '日常费用', color: '#2383e2', values: data.trend.map((m) => m.expense) },
      { name: '保养', color: '#0f7b6c', values: data.trend.map((m) => m.maintenance) }
    ],
    stacked: true,
    unit: '元',
    height: 290
  });

  donutChart(root.querySelector('#donutChart'), {
    items: data.cost.categories.map((c) => ({ label: c.label, value: c.amount, color: c.color })),
    centerLabel: '本月合计',
    centerValue: fmtMoney(data.cost.total, { digits: 0 }),
    size: 180
  });

  root.querySelectorAll('[data-go]').forEach((button) => {
    button.addEventListener('click', () => go(button.dataset.go));
  });
  root.querySelectorAll('[data-quick]').forEach((button) => {
    button.addEventListener('click', () => {
      const kind = button.dataset.quick;
      if (kind === 'maintenance') {
        openRecordModal({
          plans: data.plans,
          latestOdometer: data.latestOdometer,
          onSaved: () => render(root)
        });
      } else {
        openExpenseModal({
          defaults: { category: kind === 'expense' ? 'parking' : kind },
          onSaved: () => render(root)
        });
      }
    });
  });
  root.querySelector('[data-add-plan]')?.addEventListener('click', () => go('maintenance'));
}
