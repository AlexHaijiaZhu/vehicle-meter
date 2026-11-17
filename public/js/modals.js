import { api } from './api.js';
import { state, currentVehicle } from './store.js';
import { CATEGORIES, ENERGY_TYPES } from './constants.js';
import { icon } from './icons.js';
import {
  esc,
  field,
  inlineError,
  openModal,
  selectOptions,
  setBusy,
  toast,
  todayStr
} from './ui.js';

const toNum = (value) => (value === '' || value == null ? null : Number(value));
const round = (value, digits = 2) => Math.round(Number(value) * 10 ** digits) / 10 ** digits;

function closeButton() {
  return `<button class="btn btn-ghost" type="button" data-cancel>取消</button>`;
}

function formError(modal, message) {
  let box = modal.bodyEl.querySelector('.form-error');
  if (!box) {
    box = document.createElement('div');
    box.className = 'form-error';
    modal.bodyEl.querySelector('form')?.prepend(box);
  }
  box.innerHTML = inlineError(message);
}

function vehicleOptions(selected, { includeArchived = false } = {}) {
  const list = state.vehicles.filter((v) => includeArchived || !v.archived);
  return list.map((v) => ({ value: v.id, label: `${v.name}${v.plateNo ? ` · ${v.plateNo}` : ''}` }));
}

export function openExpenseModal({ expense = null, defaults = {}, onSaved } = {}) {
  const editing = Boolean(expense?.id);
  const vehicles = state.vehicles.filter((v) => !v.archived || v.id === expense?.vehicleId);
  if (!vehicles.length) {
    toast('请先添加一辆车', 'info');
    return;
  }
  const initialCategory = expense?.category || defaults.category || 'fuel';
  const initialVehicle = expense?.vehicleId || defaults.vehicleId || currentVehicle()?.id || vehicles[0].id;
  const categoryButtons = Object.values(CATEGORIES)
    .filter((c) => c.key !== 'maintenance')
    .map(
      (c) => `<label class="cat-option" style="--cat:${c.color}">
        <input type="radio" name="category" value="${c.key}" ${c.key === initialCategory ? 'checked' : ''}>
        <span class="cat-option-inner">${icon(c.icon, 17)}<b>${c.label}</b></span>
      </label>`
    )
    .join('');

  const body = `<form id="expense-form" class="form" novalidate>
    <div class="form-grid">
      <label class="field span-2">
        <span class="field-label">费用类别</span>
        <div class="cat-options">${categoryButtons}</div>
      </label>
      ${field({ label: '车辆', name: 'vehicleId', type: 'select', options: vehicleOptions(initialVehicle), value: initialVehicle, span: 1 })}
      ${field({ label: '日期', name: 'occurredOn', type: 'date', value: expense?.occurredOn || defaults.date || todayStr(), required: true, attrs: `max="${todayStr()}"`, span: 1 })}
      ${field({ label: '金额', name: 'amount', type: 'number', value: expense?.amount ?? defaults.amount ?? '', placeholder: '0.00', required: true, attrs: 'min="0.01" step="0.01" inputmode="decimal"', span: 1 })}
      ${field({ label: '仪表里程', name: 'odometer', type: 'number', value: expense?.odometer ?? defaults.odometer ?? '', placeholder: 'km，选填', attrs: 'min="0" step="1" inputmode="decimal"', span: 1 })}
      <div class="energy-fields span-2" data-energy-fields>
        ${field({ label: '数量', name: 'quantity', type: 'number', value: expense?.quantity ?? '', placeholder: '0', attrs: 'min="0" step="0.01" inputmode="decimal"', hint: '<span data-quantity-unit>升</span>' })}
        ${field({ label: '单价', name: 'unitPrice', type: 'number', value: expense?.unitPrice ?? '', placeholder: '0.00', attrs: 'min="0" step="0.001" inputmode="decimal"', hint: '<span data-price-unit>元/升</span>' })}
        <div class="field span-2 autocalc-row">
          <button type="button" class="link-btn" data-autocalc>数量 × 单价 = 金额，自动填写</button>
        </div>
        <label class="field" data-fuel-only>
          <span class="field-label">油品</span>
          <input name="fuelType" type="text" value="${esc(expense?.fuelType || '')}" placeholder="92# / 95# / 0#">
        </label>
        <div class="field checkbox-field" data-fuel-only>
          <span class="field-label">加满</span>
          <span class="switch"><input type="checkbox" name="fullTank" ${expense?.fullTank ? 'checked' : ''}><span></span><b>本次加满</b></span>
        </div>
      </div>
      ${field({ label: '加油站 / 商家', name: 'station', type: 'text', value: expense?.station || '', placeholder: '例如 中国石化 漕河泾站', span: 2 })}
      ${field({ label: '备注', name: 'note', type: 'textarea', value: expense?.note || '', placeholder: '选填，例如 高速通行、商场停车', span: 2, rows: 2 })}
    </div>
    <div class="form-note">${icon('info', 15)}<span>保养费用请在「保养」页记录，会自动计入用车成本与报告。</span></div>
  </form>`;

  const modal = openModal({
    title: editing ? '编辑费用' : '记一笔费用',
    subtitle: editing ? '修改后将同步更新能耗与统计' : '记录加油、充电、停车、保险或维修支出',
    size: 'md',
    body,
    footer: `${closeButton()}<button class="btn btn-primary" type="submit" form="expense-form">${icon('check', 16)}${editing ? '保存修改' : '保存'}</button>`,
    onMount: (ctx) => {
      const form = ctx.$('#expense-form');
      const energyFields = ctx.$('[data-energy-fields]');
      const fuelOnly = ctx.$$('[data-fuel-only]');
      const qtyInput = form.elements.quantity;
      const priceInput = form.elements.unitPrice;
      const amountInput = form.elements.amount;
      const unitLabel = ctx.$('[data-quantity-unit]');
      const priceLabel = ctx.$('[data-price-unit]');
      const catRadios = ctx.$$('input[name="category"]');

      const refreshCategory = () => {
        const category = form.elements.category.value;
        const isEnergy = category === 'fuel' || category === 'charge';
        energyFields.hidden = !isEnergy;
        fuelOnly.forEach((el) => { el.hidden = category !== 'fuel'; });
        if (category === 'charge') {
          unitLabel.textContent = 'kWh';
          priceLabel.textContent = '元/kWh';
          qtyInput.placeholder = '充电量 kWh';
        } else {
          unitLabel.textContent = '升';
          priceLabel.textContent = '元/升';
          qtyInput.placeholder = '加油量 L';
        }
        energyFields.querySelectorAll('input').forEach((input) => {
          if (input.name === 'quantity' || input.name === 'unitPrice' || input.name === 'fuelType') {
            input.disabled = !isEnergy;
          }
          if (input.name === 'fullTank') input.disabled = category !== 'fuel';
        });
      };
      catRadios.forEach((radio) => radio.addEventListener('change', refreshCategory));
      refreshCategory();

      ctx.$('[data-autocalc]').addEventListener('click', () => {
        const qty = toNum(qtyInput.value);
        const price = toNum(priceInput.value);
        if (!qty || !price) {
          toast('请先填写数量和单价', 'info');
          return;
        }
        amountInput.value = round(qty * price, 2).toFixed(2);
      });
      qtyInput.addEventListener('blur', () => {
        if (amountInput.value) return;
        const qty = toNum(qtyInput.value);
        const price = toNum(priceInput.value);
        if (qty && price) amountInput.value = round(qty * price, 2).toFixed(2);
      });

      ctx.$('[data-cancel]').addEventListener('click', ctx.close);
      form.addEventListener('submit', async (event) => {
        event.preventDefault();
        const submit = ctx.el.querySelector('button[form="expense-form"]');
        const category = form.elements.category.value;
        const payload = {
          vehicleId: Number(form.elements.vehicleId.value),
          category,
          occurredOn: form.elements.occurredOn.value,
          amount: toNum(form.elements.amount.value),
          odometer: toNum(form.elements.odometer.value),
          quantity: toNum(form.elements.quantity.value),
          unitPrice: toNum(form.elements.unitPrice.value),
          fuelType: category === 'fuel' ? form.elements.fuelType.value : '',
          fullTank: category === 'fuel' ? form.elements.fullTank.checked : false,
          station: form.elements.station.value,
          note: form.elements.note.value
        };
        if (!payload.amount || payload.amount <= 0) {
          formError(modal, '请填写大于 0 的金额');
          return;
        }
        setBusy(submit, true, '保存中…');
        try {
          if (editing) await api.put(`/api/expenses/${expense.id}`, payload);
          else await api.post('/api/expenses', payload);
          toast(editing ? '费用已更新' : '已记录一笔费用');
          ctx.close();
          onSaved?.();
        } catch (err) {
          setBusy(submit, false);
          formError(modal, err.message);
        }
      });
    }
  });
  return modal;
}

export function openVehicleModal({ vehicle = null, onSaved } = {}) {
  const editing = Boolean(vehicle?.id);
  const energyType = vehicle?.energyType || 'fuel';
  const body = `<form id="vehicle-form" class="form" novalidate>
    <div class="form-grid">
      ${field({ label: '车辆名称', name: 'name', value: vehicle?.name || '', placeholder: '例如 小蓝', required: true })}
      ${field({ label: '车牌号', name: 'plateNo', value: vehicle?.plateNo || '', placeholder: '例如 沪A·8K2M9' })}
      ${field({ label: '品牌车型', name: 'brandModel', value: vehicle?.brandModel || '', placeholder: '例如 大众 高尔夫', span: 2 })}
      <label class="field">
        <span class="field-label">能源类型<em>*</em></span>
        <select name="energyType">
          ${selectOptions(Object.entries(ENERGY_TYPES).map(([value, meta]) => ({ value, label: meta.label })), energyType)}
        </select>
      </label>
      ${field({ label: '油品', name: 'fuelType', value: vehicle?.fuelType || '', placeholder: '95#', attrs: 'data-fuel-field' })}
      ${field({ label: '油箱容量 (L)', name: 'tankCapacity', type: 'number', value: vehicle?.tankCapacity ?? '', placeholder: '选填', attrs: 'min="0" step="0.1" data-fuel-field' })}
      ${field({ label: '电池容量 (kWh)', name: 'batteryCapacity', type: 'number', value: vehicle?.batteryCapacity ?? '', placeholder: '选填', attrs: 'min="0" step="0.1" data-ev-field' })}
      ${field({ label: '初始里程 (km)', name: 'initialOdometer', type: 'number', value: vehicle?.initialOdometer ?? 0, attrs: 'min="0" step="0.1"' })}
      ${field({ label: '购车日期', name: 'purchaseDate', type: 'date', value: vehicle?.purchaseDate || '' })}
      <label class="field">
        <span class="field-label">主题色</span>
        <div class="color-field"><input type="color" name="color" value="${esc(vehicle?.color || '#2563eb')}"><span>${icon('car', 18)} 用于车辆标识</span></div>
      </label>
      ${field({ label: '备注', name: 'notes', type: 'textarea', value: vehicle?.notes || '', placeholder: '选填', span: 2, rows: 2 })}
      <div class="field checkbox-field span-2">
        <span class="switch"><input type="checkbox" name="isDefault" ${vehicle?.isDefault || state.vehicles.length === 0 ? 'checked' : ''}><span></span><b>设为默认车辆</b></span>
      </div>
    </div>
  </form>`;
  const modal = openModal({
    title: editing ? '编辑车辆' : '添加车辆',
    subtitle: '每辆车独立统计费用、能耗与保养',
    body,
    footer: `${closeButton()}<button class="btn btn-primary" type="submit" form="vehicle-form">${icon('check', 16)}${editing ? '保存' : '添加车辆'}</button>`,
    onMount: (ctx) => {
      const form = ctx.$('#vehicle-form');
      const refresh = () => {
        const type = form.elements.energyType.value;
        ctx.$$('[data-fuel-field]').forEach((el) => { el.hidden = type === 'ev'; });
        ctx.$$('[data-ev-field]').forEach((el) => { el.hidden = type === 'fuel'; });
      };
      form.elements.energyType.addEventListener('change', refresh);
      refresh();
      ctx.$('[data-cancel]').addEventListener('click', ctx.close);
      form.addEventListener('submit', async (event) => {
        event.preventDefault();
        const submit = ctx.el.querySelector('button[form="vehicle-form"]');
        const payload = {
          name: form.elements.name.value,
          plateNo: form.elements.plateNo.value,
          brandModel: form.elements.brandModel.value,
          energyType: form.elements.energyType.value,
          fuelType: form.elements.fuelType.value,
          tankCapacity: toNum(form.elements.tankCapacity.value),
          batteryCapacity: toNum(form.elements.batteryCapacity.value),
          initialOdometer: toNum(form.elements.initialOdometer.value) ?? 0,
          purchaseDate: form.elements.purchaseDate.value || null,
          color: form.elements.color.value,
          notes: form.elements.notes.value,
          isDefault: form.elements.isDefault.checked
        };
        if (!payload.name.trim()) {
          formError(modal, '请填写车辆名称');
          return;
        }
        setBusy(submit, true, '保存中…');
        try {
          if (editing) await api.put(`/api/vehicles/${vehicle.id}`, payload);
          else await api.post('/api/vehicles', payload);
          toast(editing ? '车辆已更新' : '车辆已添加');
          ctx.close();
          onSaved?.();
        } catch (err) {
          setBusy(submit, false);
          formError(modal, err.message);
        }
      });
    }
  });
  return modal;
}

export function openPlanModal({ plan = null, onSaved } = {}) {
  const editing = Boolean(plan?.id);
  const vehicleId = plan?.vehicleId || currentVehicle()?.id;
  if (!vehicleId) {
    toast('请先添加车辆', 'info');
    return;
  }
  const body = `<form id="plan-form" class="form" novalidate>
    <div class="form-grid">
      ${field({ label: '保养项目', name: 'name', value: plan?.name || '', placeholder: '例如 更换机油机滤', required: true, span: 2 })}
      ${field({ label: '车辆', name: 'vehicleId', type: 'select', options: vehicleOptions(vehicleId), value: vehicleId, span: 2 })}
      ${field({ label: '周期里程 (km)', name: 'intervalMileage', type: 'number', value: plan?.intervalMileage ?? '', placeholder: '例如 5000', attrs: 'min="0" step="1"' })}
      ${field({ label: '周期月数', name: 'intervalMonths', type: 'number', value: plan?.intervalMonths ?? '', placeholder: '例如 6', attrs: 'min="0" step="1"' })}
      ${field({ label: '上次保养日期', name: 'lastServiceOn', type: 'date', value: plan?.lastServiceOn || '' })}
      ${field({ label: '上次保养里程 (km)', name: 'lastServiceOdometer', type: 'number', value: plan?.lastServiceOdometer ?? '', attrs: 'min="0" step="1"' })}
      ${field({ label: '下次到期日期', name: 'nextDueOn', type: 'date', value: plan?.nextDueOn || '', hint: '选填；留空则按周期自动计算' })}
      ${field({ label: '下次到期里程 (km)', name: 'nextDueOdometer', type: 'number', value: plan?.nextDueOdometer ?? '', hint: '选填；留空则按周期自动计算' })}
      ${field({ label: '提前提醒 (天)', name: 'notifyDays', type: 'number', value: plan?.notifyDays ?? 30, attrs: 'min="1" max="365" step="1"' })}
      ${field({ label: '状态', name: 'active', type: 'select', options: [{ value: '1', label: '启用' }, { value: '0', label: '停用' }], value: plan ? (plan.active ? '1' : '0') : '1' })}
      ${field({ label: '保养项目清单', name: 'items', value: plan?.items || '', placeholder: '机油, 机滤, 空气滤芯', span: 2, hint: '用逗号分隔，记录保养时自动带入' })}
      ${field({ label: '备注', name: 'notes', type: 'textarea', value: plan?.notes || '', placeholder: '选填', span: 2, rows: 2 })}
    </div>
    <div class="form-note">${icon('info', 15)}<span>周期里程与周期月数至少填写一项；保养后记录历史可自动更新上次保养信息。</span></div>
  </form>`;
  const modal = openModal({
    title: editing ? '编辑保养计划' : '新建保养计划',
    subtitle: '按里程或时间跟踪到期项目',
    body,
    footer: `${closeButton()}<button class="btn btn-primary" type="submit" form="plan-form">${icon('check', 16)}${editing ? '保存' : '创建计划'}</button>`,
    onMount: (ctx) => {
      const form = ctx.$('#plan-form');
      ctx.$('[data-cancel]').addEventListener('click', ctx.close);
      form.addEventListener('submit', async (event) => {
        event.preventDefault();
        const submit = ctx.el.querySelector('button[form="plan-form"]');
        const payload = {
          vehicleId: Number(form.elements.vehicleId.value),
          name: form.elements.name.value,
          intervalMileage: toNum(form.elements.intervalMileage.value),
          intervalMonths: toNum(form.elements.intervalMonths.value),
          lastServiceOn: form.elements.lastServiceOn.value || null,
          lastServiceOdometer: toNum(form.elements.lastServiceOdometer.value),
          nextDueOn: form.elements.nextDueOn.value || null,
          nextDueOdometer: toNum(form.elements.nextDueOdometer.value),
          notifyDays: toNum(form.elements.notifyDays.value) ?? 30,
          active: form.elements.active.value === '1',
          items: form.elements.items.value,
          notes: form.elements.notes.value
        };
        if (!payload.name.trim()) {
          formError(modal, '请填写保养项目名称');
          return;
        }
        if (!payload.intervalMileage && !payload.intervalMonths && !payload.nextDueOn && !payload.nextDueOdometer) {
          formError(modal, '请至少设置周期里程、周期月数或到期条件之一');
          return;
        }
        setBusy(submit, true, '保存中…');
        try {
          if (editing) await api.put(`/api/plans/${plan.id}`, payload);
          else await api.post('/api/plans', payload);
          toast(editing ? '保养计划已更新' : '保养计划已创建');
          ctx.close();
          onSaved?.();
        } catch (err) {
          setBusy(submit, false);
          formError(modal, err.message);
        }
      });
    }
  });
  return modal;
}

export function openRecordModal({ plan = null, record = null, plans = [], latestOdometer = 0, onSaved } = {}) {
  const editing = Boolean(record?.id);
  const vehicleId = record?.vehicleId || plan?.vehicleId || currentVehicle()?.id;
  if (!vehicleId) {
    toast('请先添加车辆', 'info');
    return;
  }
  const planOptions = [{ value: '', label: '不关联计划' }, ...plans.filter((p) => p.active !== false).map((p) => ({ value: p.id, label: p.name }))];
  const selectedPlan = record?.planId || plan?.id || '';
  const body = `<form id="record-form" class="form" novalidate>
    <div class="form-grid">
      ${field({ label: '车辆', name: 'vehicleId', type: 'select', options: vehicleOptions(vehicleId), value: vehicleId, span: 2 })}
      ${field({ label: '关联保养计划', name: 'planId', type: 'select', options: planOptions, value: selectedPlan, span: 2, hint: '关联后保存会同步更新计划的「上次保养」信息' })}
      ${field({ label: '保养日期', name: 'serviceOn', type: 'date', value: record?.serviceOn || todayStr(), required: true, attrs: `max="${todayStr()}"` })}
      ${field({ label: '里程 (km)', name: 'odometer', type: 'number', value: record?.odometer ?? latestOdometer ?? '', attrs: 'min="0" step="1"' })}
      ${field({ label: '费用 (元)', name: 'cost', type: 'number', value: record?.cost ?? '', placeholder: '0.00', attrs: 'min="0" step="0.01"', hint: '将计入用车成本与报告' })}
      ${field({ label: '门店', name: 'shop', type: 'text', value: record?.shop || '', placeholder: '4S 店 / 维修厂 / 途虎' })}
      ${field({ label: '保养项目', name: 'items', type: 'text', value: record?.items || plan?.items || '', placeholder: '机油, 机滤', span: 2 })}
      ${field({ label: '备注', name: 'note', type: 'textarea', value: record?.note || '', placeholder: '选填', span: 2, rows: 2 })}
    </div>
    <div class="field checkbox-field span-2" data-update-plan ${selectedPlan ? '' : 'hidden'}>
      <span class="switch"><input type="checkbox" name="updatePlan" ${editing ? '' : 'checked'}><span></span><b>同步更新计划的上次保养日期与里程</b></span>
    </div>
  </form>`;
  const modal = openModal({
    title: editing ? '编辑保养记录' : '记录保养',
    subtitle: '保留完整维修保养历史',
    body,
    footer: `${closeButton()}<button class="btn btn-primary" type="submit" form="record-form">${icon('check', 16)}${editing ? '保存修改' : '保存记录'}</button>`,
    onMount: (ctx) => {
      const form = ctx.$('#record-form');
      const updateWrap = ctx.$('[data-update-plan]');
      form.elements.planId.addEventListener('change', () => {
        updateWrap.hidden = !form.elements.planId.value;
        const selected = plans.find((p) => String(p.id) === form.elements.planId.value);
        if (selected && !form.elements.items.value) form.elements.items.value = selected.items || '';
      });
      ctx.$('[data-cancel]').addEventListener('click', ctx.close);
      form.addEventListener('submit', async (event) => {
        event.preventDefault();
        const submit = ctx.el.querySelector('button[form="record-form"]');
        const payload = {
          vehicleId: Number(form.elements.vehicleId.value),
          planId: form.elements.planId.value ? Number(form.elements.planId.value) : null,
          serviceOn: form.elements.serviceOn.value,
          odometer: toNum(form.elements.odometer.value),
          cost: toNum(form.elements.cost.value) ?? 0,
          shop: form.elements.shop.value,
          items: form.elements.items.value,
          note: form.elements.note.value,
          updatePlan: form.elements.updatePlan?.checked ?? false
        };
        if (!payload.serviceOn) {
          formError(modal, '请选择保养日期');
          return;
        }
        setBusy(submit, true, '保存中…');
        try {
          if (editing) await api.put(`/api/maintenance/${record.id}`, payload);
          else await api.post('/api/maintenance', payload);
          toast(editing ? '保养记录已更新' : '保养记录已保存');
          ctx.close();
          onSaved?.();
        } catch (err) {
          setBusy(submit, false);
          formError(modal, err.message);
        }
      });
    }
  });
  return modal;
}
