import { api } from '../api.js';
import { state, currentVehicle, loadBootstrap, setVehicle } from '../store.js';
import { ENERGY_TYPES } from '../constants.js';
import { icon } from '../icons.js';
import {
  confirmDialog,
  emptyState,
  energyBadge,
  esc,
  fmtMoney,
  fmtNum,
  go,
  skeleton,
  statusPill,
  toast
} from '../ui.js';
import { openVehicleModal } from '../modals.js';

let showArchived = false;

function energySummary(vehicle) {
  if (vehicle.fuel?.avgConsumption != null) return `${fmtNum(vehicle.fuel.avgConsumption, 1)} L/100km`;
  if (vehicle.charge?.avgConsumption != null) return `${fmtNum(vehicle.charge.avgConsumption, 1)} kWh/100km`;
  return '暂无能耗数据';
}

function dueText(next) {
  if (!next) return '未设置保养计划';
  if (next.remainingDays != null) {
    return next.remainingDays < 0 ? `超期 ${-next.remainingDays} 天` : `还有 ${next.remainingDays} 天`;
  }
  if (next.remainingKm != null) {
    return next.remainingKm < 0 ? `超出 ${fmtNum(-next.remainingKm, 0)} km` : `还剩 ${fmtNum(next.remainingKm, 0)} km`;
  }
  return '待设置';
}

export async function render(root) {
  root.innerHTML = `<div class="page-stack">${skeleton(3)}</div>`;
  let data;
  try {
    data = await api.get('/api/vehicles/summary');
  } catch (err) {
    root.innerHTML = `<div class="card"><div class="inline-error">${icon('alert', 18)}${esc(err.message)}</div></div>`;
    return;
  }
  const active = data.items.filter((v) => !v.archived);
  const archived = data.items.filter((v) => v.archived);
  const reload = async () => {
    await loadBootstrap();
    render(root);
  };

  const vehicleCard = (vehicle) => `<article class="vehicle-card ${vehicle.isDefault ? 'is-default' : ''}" style="--vehicle-color:${esc(vehicle.color || '#2563eb')}">
    <div class="vehicle-accent"></div>
    <header class="vehicle-head">
      <div class="vehicle-avatar">${esc((vehicle.name || '车').slice(0, 1))}</div>
      <div class="vehicle-name">
        <h3>${esc(vehicle.name)} ${vehicle.isDefault ? '<span class="tag tag-blue">默认</span>' : ''}</h3>
        <p>${esc(vehicle.plateNo || '未填写车牌')} · ${esc(vehicle.brandModel || '未填写车型')}</p>
      </div>
      ${energyBadge(vehicle.energyType)}
    </header>
    <div class="vehicle-stats">
      <div><span>当前里程</span><b>${fmtNum(vehicle.latestOdometer, 0)}<small>km</small></b></div>
      <div><span>累计支出</span><b>${fmtMoney(vehicle.lifetimeCost, { digits: 0 })}</b></div>
      <div><span>近 12 个月</span><b>${fmtMoney(vehicle.last12Cost, { digits: 0 })}</b></div>
      <div><span>平均能耗</span><b class="small">${esc(energySummary(vehicle))}</b></div>
    </div>
    <div class="vehicle-maintenance">
      <div class="vm-left">${icon('wrench', 16)}<span>${vehicle.nextMaintenance ? esc(vehicle.nextMaintenance.name) : '保养计划'}</span></div>
      <div class="vm-right">${vehicle.nextMaintenance ? `${statusPill(vehicle.nextMaintenance.status)}<small>${esc(dueText(vehicle.nextMaintenance))}</small>` : '<small class="muted">未设置</small>'}</div>
    </div>
    <footer class="vehicle-foot">
      <span class="muted">${vehicle.expenseCount} 笔费用记录</span>
      <div class="button-row">
        ${!vehicle.isDefault && !vehicle.archived ? `<button class="btn btn-ghost btn-sm" data-default="${vehicle.id}">设为默认</button>` : ''}
        <button class="btn btn-soft btn-sm" data-edit="${vehicle.id}">${icon('edit', 14)}编辑</button>
        ${vehicle.archived
          ? `<button class="btn btn-ghost btn-sm" data-restore="${vehicle.id}">恢复</button><button class="btn btn-ghost btn-sm danger-text" data-hard-delete="${vehicle.id}">彻底删除</button>`
          : `<button class="btn btn-ghost btn-sm danger-text" data-archive="${vehicle.id}">归档</button>`}
      </div>
    </footer>
  </article>`;

  root.innerHTML = `<div class="page-stack">
    <section class="vehicles-hero">
      <div>
        <span class="eyebrow">${icon('car', 15)}多车管理</span>
        <h2>每一辆车，都有自己的账本</h2>
        <p>费用、能耗、保养计划与报告按车辆独立统计，互不干扰。</p>
        <div class="button-row">
          <button class="btn btn-primary" data-add>${icon('plus', 16)}添加车辆</button>
          <button class="btn btn-soft" data-demo ${state.vehicles.length ? 'hidden' : ''}>${icon('sparkles', 16)}加载示例数据</button>
        </div>
      </div>
      <div class="vehicles-hero-stats">
        <div><span>在管车辆</span><b>${active.length}</b></div>
        <div><span>累计支出</span><b>${fmtMoney(active.reduce((n, v) => n + (v.lifetimeCost || 0), 0), { digits: 0 })}</b></div>
        <div><span>当前车辆</span><b class="small">${esc(currentVehicle()?.name || '—')}</b></div>
      </div>
    </section>

    ${active.length
      ? `<div class="vehicle-grid">${active.map(vehicleCard).join('')}</div>`
      : emptyState({
          iconName: 'car',
          title: '还在用手账记车账？',
          text: '添加第一辆车，开始记录费用、油耗与保养。也可以先加载示例数据体验。',
          action: `<button class="btn btn-primary" data-add>${icon('plus', 16)}添加车辆</button><button class="btn btn-soft" data-demo>加载示例数据</button>`
        })}

    ${archived.length ? `<section class="section-block">
      <header class="section-head">
        <div><h3>已归档车辆</h3><p>保留历史数据，不参与日常统计</p></div>
        <label class="toggle-text"><input type="checkbox" data-toggle-archived ${showArchived ? 'checked' : ''}>显示</label>
      </header>
      ${showArchived ? `<div class="vehicle-grid">${archived.map(vehicleCard).join('')}</div>` : ''}
    </section>` : ''}

    <section class="note-card">
      ${icon('info', 18)}
      <div><b>关于归档</b><p>归档车辆会从车辆切换与日常统计中隐藏，但历史费用、保养记录和备份数据都会保留。需要时可以恢复。</p></div>
    </section>
  </div>`;

  root.querySelectorAll('[data-add]').forEach((button) => button.addEventListener('click', () => openVehicleModal({ onSaved: reload })));
  root.querySelector('[data-demo]')?.addEventListener('click', async () => {
    try {
      await api.post('/api/demo');
      toast('示例数据已加载');
      await reload();
    } catch (err) {
      toast(err.message, 'error');
    }
  });
  root.querySelectorAll('[data-edit]').forEach((button) => button.addEventListener('click', () => {
    const vehicle = data.items.find((v) => v.id === Number(button.dataset.edit));
    if (vehicle) openVehicleModal({ vehicle, onSaved: reload });
  }));
  root.querySelectorAll('[data-default]').forEach((button) => button.addEventListener('click', async () => {
    try {
      await api.post(`/api/vehicles/${button.dataset.default}/default`);
      await reload();
      setVehicle(Number(button.dataset.default));
      toast('已设为默认车辆');
    } catch (err) {
      toast(err.message, 'error');
    }
  }));
  root.querySelectorAll('[data-archive]').forEach((button) => button.addEventListener('click', async () => {
    const vehicle = data.items.find((v) => v.id === Number(button.dataset.archive));
    if (!vehicle) return;
    const ok = await confirmDialog({
      title: '归档车辆',
      message: `归档「${vehicle.name}」后，它将从日常统计中隐藏，历史数据会保留。`,
      confirmText: '归档'
    });
    if (!ok) return;
    try {
      await api.del(`/api/vehicles/${vehicle.id}`);
      toast('车辆已归档');
      await reload();
    } catch (err) {
      toast(err.message, 'error');
    }
  }));
  root.querySelectorAll('[data-restore]').forEach((button) => button.addEventListener('click', async () => {
    try {
      await api.put(`/api/vehicles/${button.dataset.restore}`, { archived: false });
      toast('车辆已恢复');
      await reload();
    } catch (err) {
      toast(err.message, 'error');
    }
  }));
  root.querySelectorAll('[data-hard-delete]').forEach((button) => button.addEventListener('click', async () => {
    const vehicle = data.items.find((v) => v.id === Number(button.dataset.hardDelete));
    if (!vehicle) return;
    const ok = await confirmDialog({
      title: '彻底删除车辆',
      message: `将永久删除「${vehicle.name}」及其全部费用、保养记录，不可恢复。建议先导出备份。`,
      confirmText: '永久删除',
      danger: true
    });
    if (!ok) return;
    try {
      await api.del(`/api/vehicles/${vehicle.id}`, { hard: 1 });
      toast('车辆及关联数据已删除');
      await reload();
    } catch (err) {
      toast(err.message, 'error');
    }
  }));
  root.querySelector('[data-toggle-archived]')?.addEventListener('change', (event) => {
    showArchived = event.target.checked;
    render(root);
  });
}
