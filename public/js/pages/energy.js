import { api } from '../api.js';
import { currentVehicle } from '../store.js';
import { CATEGORIES, ENERGY_TYPES } from '../constants.js';
import { icon } from '../icons.js';
import { barChart, lineChart } from '../charts.js';
import {
  emptyState,
  esc,
  fmtDate,
  fmtMoney,
  fmtNum,
  fmtQuantity,
  go,
  skeleton,
  statTile
} from '../ui.js';

let months = 12;

export async function render(root) {
  const vehicle = currentVehicle();
  if (!vehicle) return;
  root.innerHTML = `<div class="page-stack">${skeleton(4)}</div>`;
  let data;
  try {
    data = await api.get('/api/stats/energy', { vehicleId: vehicle.id, months });
  } catch (err) {
    root.innerHTML = `<div class="card"><div class="inline-error">${icon('alert', 18)}${esc(err.message)}</div></div>`;
    return;
  }

  const fuel = data.fuel;
  const charge = data.charge;
  const hasEnergy = Boolean(fuel || charge);
  const segments = [...(fuel?.segments || []).map((s) => ({ ...s, category: 'fuel' })), ...(charge?.segments || []).map((s) => ({ ...s, category: 'charge' }))]
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, 30);
  const monthLabel = `${data.from.slice(0, 7)} ~ ${data.to.slice(0, 7)}`;
  const energyCost = (fuel?.cost || 0) + (charge?.cost || 0);
  const totalDistance = Math.max(fuel?.distance || 0, charge?.distance || 0);
  const costPer100 = totalDistance > 0 ? (energyCost / totalDistance) * 100 : null;

  const tabs = [6, 12, 24].map((value) => `<button class="seg-btn ${months === value ? 'active' : ''}" data-months="${value}">${value} 个月</button>`).join('');

  root.innerHTML = `<div class="page-stack">
    <section class="energy-hero">
      <div class="energy-hero-copy">
        <span class="eyebrow">${icon('gauge', 15)}能耗分析 · ${esc(monthLabel)}</span>
        <h2>${vehicle.energyType === 'ev' ? '每一度电，都心里有数' : '每一滴油，都算得清楚'}</h2>
        <p>${vehicle.energyType === 'ev' ? '按充电区间统计电耗，记录充电量与里程即可自动计算。' : vehicle.energyType === 'phev' ? '燃油按满箱法、充电按区间法分别统计。' : '默认使用满箱法：两次加满之间的油量与里程，得到真实油耗。'}</p>
      </div>
      <div class="segmented">${tabs}</div>
    </section>

    <section class="kpi-grid kpi-grid-3">
      ${fuel
        ? statTile('平均油耗', `${fmtNum(fuel.avgConsumption, 1)}<small>L/100km</small>`, {
            iconName: 'fuel',
            sub: `${fmtQuantity(fuel.quantity, 'L')} · ${fmtMoney(fuel.cost)}`,
            tone: 'amber'
          })
        : ''}
      ${charge
        ? statTile('平均电耗', `${fmtNum(charge.avgConsumption, 1)}<small>kWh/100km</small>`, {
            iconName: 'bolt',
            sub: `${fmtQuantity(charge.quantity, 'kWh')} · ${fmtMoney(charge.cost)}`,
            tone: 'green'
          })
        : ''}
      ${statTile(fuel && charge ? '能源单价' : fuel ? '平均油价' : '平均电价', fuel && charge
        ? `${fmtNum(fuel.avgPrice, 2)}<small>元/L</small><span class="stat-divider"></span>${fmtNum(charge.avgPrice, 2)}<small>元/kWh</small>`
        : `${fmtNum((fuel || charge)?.avgPrice, 2)}<small>${fuel ? '元/L' : '元/kWh'}</small>`, {
        iconName: 'coins',
        sub: `能源总支出 ${fmtMoney(energyCost)}`,
        tone: 'blue'
      })}
      ${statTile('百公里能源成本', costPer100 == null ? '—' : `${fmtMoney(costPer100)}`, {
        iconName: 'calculator',
        sub: `统计里程 ${fmtNum(totalDistance, 0)} km`,
        tone: 'violet'
      })}
    </section>

    <section class="grid-2">
      <article class="card chart-card">
        <header class="card-head">
          <div><h3>月度能耗趋势</h3><p>${fuel && charge ? 'L/100km · kWh/100km' : fuel ? 'L/100km' : 'kWh/100km'}</p></div>
        </header>
        <div class="chart-body" id="consumptionChart"></div>
        <footer class="card-foot">
          <span class="muted">${fuel ? '油耗按满箱法计算' : '电耗按充电区间计算'}，仅统计同时填写数量与里程的记录</span>
        </footer>
      </article>
      <article class="card chart-card">
        <header class="card-head">
          <div><h3>月度能源支出</h3><p>加油与充电费用</p></div>
          <span class="badge badge-soft">${fmtMoney(energyCost, { digits: 0 })}</span>
        </header>
        <div class="chart-body" id="costChart"></div>
      </article>
    </section>

    <section class="card table-card">
      <header class="card-head table-card-head">
        <div><h3>能耗明细</h3><p>每一段加油 / 充电区间的计算结果</p></div>
        <span class="badge badge-soft">${segments.length} 段</span>
      </header>
      ${segments.length
        ? `<div class="table-scroll"><table class="data-table">
            <thead><tr><th>日期</th><th>类别</th><th class="num">区间里程</th><th class="num">数量</th><th class="num">百公里能耗</th><th class="num">单价</th><th class="num">费用</th><th>算法</th></tr></thead>
            <tbody>${segments.map((s) => `<tr>
              <td class="nowrap">${fmtDate(s.date, { short: true })}<span class="cell-sub">${fmtDate(s.startDate)}</span></td>
              <td>${categoryLabel(s.category)}</td>
              <td class="num">${fmtNum(s.distance, 0)}<small> km</small></td>
              <td class="num">${fmtQuantity(s.quantity, s.category === 'fuel' ? 'L' : 'kWh')}</td>
              <td class="num"><b>${fmtNum(s.consumption, 1)}</b><small> ${s.category === 'fuel' ? 'L' : 'kWh'}/100km</small></td>
              <td class="num">${fmtMoney(s.unitPrice, { digits: 2 })}</td>
              <td class="num amount-cell">${fmtMoney(s.amount)}</td>
              <td><span class="tag tag-muted">${s.method === 'full-tank' ? '满箱法' : s.method === 'charge-interval' ? '区间估算' : '估算'}</span></td>
            </tr>`).join('')}</tbody>
          </table></div>`
        : emptyState({
            iconName: 'gauge',
            title: '还没有足够的能耗数据',
            text: vehicle.energyType === 'ev'
              ? '记录至少两次「充电量 + 仪表里程」即可计算区间电耗。'
              : '记录至少两次「加满 + 加油量 + 仪表里程」即可用满箱法计算真实油耗。',
            action: `<button class="btn btn-primary" data-add>${icon('plus', 16)}记录${vehicle.energyType === 'ev' ? '充电' : '加油'}</button>`
          })}
    </section>
  </div>`;

  lineChart(root.querySelector('#consumptionChart'), {
    labels: data.monthly.map((m) => `${Number(m.month.slice(5, 7))}月`),
    series: [
      fuel ? { name: '油耗 L/100km', color: '#cb912f', values: data.monthly.map((m) => m.fuelConsumption) } : null,
      charge ? { name: '电耗 kWh/100km', color: '#0f7b6c', values: data.monthly.map((m) => m.chargeConsumption) } : null
    ].filter(Boolean),
    unit: '',
    height: 290
  });
  barChart(root.querySelector('#costChart'), {
    labels: data.monthly.map((m) => `${Number(m.month.slice(5, 7))}月`),
    series: [
      fuel ? { name: '加油', color: '#cb912f', values: data.monthly.map((m) => m.fuelCost) } : null,
      charge ? { name: '充电', color: '#0f7b6c', values: data.monthly.map((m) => m.chargeCost) } : null
    ].filter(Boolean),
    stacked: true,
    unit: '元',
    height: 290
  });

  root.querySelectorAll('[data-months]').forEach((button) => {
    button.addEventListener('click', () => {
      months = Number(button.dataset.months);
      render(root);
    });
  });
  root.querySelector('[data-add]')?.addEventListener('click', () => go('expenses'));
}

function categoryLabel(category) {
  const meta = CATEGORIES[category];
  return `<span class="cat-chip" style="--cat:${meta?.color || '#94a3b8'}">${icon(meta?.icon || 'dots', 14)}<span>${meta?.label || category}</span></span>`;
}
