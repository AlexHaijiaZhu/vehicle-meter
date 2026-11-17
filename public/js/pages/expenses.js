import { api } from '../api.js';
import { state, currentVehicle } from '../store.js';
import { CATEGORIES, SOURCE_LABELS } from '../constants.js';
import { icon } from '../icons.js';
import {
  categoryChip,
  confirmDialog,
  debounce,
  emptyState,
  esc,
  fmtDate,
  fmtMoney,
  fmtNum,
  fmtQuantity,
  go,
  monthOptions,
  monthRange,
  setBusy,
  skeleton,
  toast
} from '../ui.js';
import { openExpenseModal } from '../modals.js';

const filters = {
  search: '',
  category: '',
  month: '',
  page: 0,
  limit: 25
};

let currentRoot = null;

export async function render(root) {
  const vehicle = currentVehicle();
  if (!vehicle) return;
  currentRoot = root;
  root.innerHTML = `<div class="page-stack">${skeleton(5)}</div>`;

  const range = filters.month ? monthRange(filters.month) : { from: '', to: '' };
  const query = {
    vehicleId: vehicle.id,
    category: filters.category,
    search: filters.search,
    from: range.from,
    to: range.to,
    limit: filters.limit,
    offset: filters.page * filters.limit
  };

  let data;
  try {
    data = await api.get('/api/expenses', query);
  } catch (err) {
    root.innerHTML = `<div class="card"><div class="inline-error">${icon('alert', 18)}${esc(err.message)}</div></div>`;
    return;
  }

  const totalPages = Math.max(1, Math.ceil(data.total / filters.limit));
  if (filters.page >= totalPages) {
    filters.page = totalPages - 1;
    return render(root);
  }
  const summary = data.summary;
  const topCategory = [...summary.categories].sort((a, b) => b.amount - a.amount)[0];

  const categoryOptions = [{ value: '', label: '全部类别' }, ...Object.values(CATEGORIES).filter((c) => c.key !== 'maintenance').map((c) => ({ value: c.key, label: c.label }))];
  const months = monthOptions(15, true);

  root.innerHTML = `<div class="page-stack">
    <section class="card toolbar-card">
      <div class="filter-row">
        <label class="search-box">
          ${icon('search', 17)}
          <input type="search" placeholder="搜索商家、备注或油品" value="${esc(filters.search)}" data-search>
        </label>
        <select class="select" data-category>
          ${categoryOptions.map((opt) => `<option value="${opt.value}" ${opt.value === filters.category ? 'selected' : ''}>${opt.label}</option>`).join('')}
        </select>
        <select class="select" data-month>
          ${months.map((opt) => `<option value="${opt.value}" ${opt.value === filters.month ? 'selected' : ''}>${opt.label}</option>`).join('')}
        </select>
        <div class="toolbar-spacer"></div>
        <div class="button-row">
          <button class="btn btn-soft" data-export="xlsx">${icon('download', 16)}Excel</button>
          <button class="btn btn-soft" data-export="csv">${icon('download', 16)}CSV</button>
          <button class="btn btn-primary" data-add>${icon('plus', 16)}记一笔</button>
        </div>
      </div>
    </section>

    <section class="summary-strip">
      <div class="summary-main">
        <span>${filters.month ? `${esc(filters.month.replace('-', '年'))}月支出` : '筛选结果支出'}</span>
        <strong>${fmtMoney(summary.amount)}</strong>
        <small>${summary.count} 笔 · 平均 ${fmtMoney(summary.average)}</small>
      </div>
      <div class="summary-chips">
        ${topCategory ? `<span class="summary-chip" style="--chip:${topCategory.color}">${icon(CATEGORIES[topCategory.key]?.icon || 'wallet', 14)}${esc(topCategory.label)} ${fmtMoney(topCategory.amount)}</span>` : ''}
        <span class="summary-chip">${icon('calendar', 14)}${filters.month || '全部时间'}</span>
        <span class="summary-chip">${icon('car', 14)}${esc(vehicle.name)}</span>
      </div>
    </section>

    <section class="card table-card">
      ${data.items.length
        ? `<div class="table-scroll">
            <table class="data-table">
              <thead><tr>
                <th>日期</th><th>类别</th><th class="num">金额</th><th>数量 / 单价</th><th class="num">里程</th><th>商家 / 备注</th><th class="actions">操作</th>
              </tr></thead>
              <tbody>
                ${data.items.map((item) => `<tr data-id="${item.id}">
                  <td class="nowrap"><b>${fmtDate(item.occurredOn, { short: true })}</b><span class="cell-sub">${item.occurredOn.slice(0, 4)}</span></td>
                  <td>${categoryChip(item.category)}</td>
                  <td class="num amount-cell">${fmtMoney(item.amount)}</td>
                  <td>${item.quantity != null ? `<b>${fmtQuantity(item.quantity, item.category === 'charge' ? 'kWh' : item.category === 'fuel' ? 'L' : '')}</b>${item.unitPrice != null ? `<span class="cell-sub">${fmtMoney(item.unitPrice, { digits: 3 })}/${item.category === 'charge' ? 'kWh' : 'L'}</span>` : ''}` : '<span class="muted">—</span>'}</td>
                  <td class="num">${item.odometer != null ? `${fmtNum(item.odometer, 0)}<small> km</small>` : '<span class="muted">—</span>'}</td>
                  <td class="wide-cell"><b>${esc(item.station || CATEGORIES[item.category]?.label || '—')}</b>${item.note ? `<span class="cell-sub">${esc(item.note)}</span>` : ''}${item.fuelType ? `<span class="cell-sub">${esc(item.fuelType)}${item.fullTank ? ' · 加满' : ''}</span>` : ''}</td>
                  <td class="actions">
                    <button class="icon-btn" data-edit="${item.id}" title="编辑">${icon('edit', 16)}</button>
                    <button class="icon-btn danger" data-delete="${item.id}" title="删除">${icon('trash', 16)}</button>
                  </td>
                </tr>`).join('')}
              </tbody>
            </table>
          </div>
          <footer class="table-foot">
            <span>共 ${data.total} 条记录 · 第 ${filters.page + 1} / ${totalPages} 页</span>
            <div class="pager">
              <button class="btn btn-ghost btn-sm" data-page="prev" ${filters.page === 0 ? 'disabled' : ''}>${icon('chevronLeft', 15)}上一页</button>
              <button class="btn btn-ghost btn-sm" data-page="next" ${filters.page >= totalPages - 1 ? 'disabled' : ''}>下一页${icon('chevronRight', 15)}</button>
            </div>
          </footer>`
        : emptyState({
            iconName: 'wallet',
            title: '还没有费用记录',
            text: '记录第一笔加油、停车或充电费用，开始统计用车成本。',
            action: `<button class="btn btn-primary" data-add>${icon('plus', 16)}记一笔</button>`
          })}
    </section>
  </div>`;

  const reload = () => render(root);

  root.querySelector('[data-search]').addEventListener('input', debounce((event) => {
    filters.search = event.target.value.trim();
    filters.page = 0;
    reload();
  }, 320));
  root.querySelector('[data-category]').addEventListener('change', (event) => {
    filters.category = event.target.value;
    filters.page = 0;
    reload();
  });
  root.querySelector('[data-month]').addEventListener('change', (event) => {
    filters.month = event.target.value;
    filters.page = 0;
    reload();
  });
  root.querySelectorAll('[data-add]').forEach((button) => button.addEventListener('click', () => openExpenseModal({ onSaved: reload })));
  root.querySelectorAll('[data-export]').forEach((button) => {
    button.addEventListener('click', async () => {
      const kind = button.dataset.export;
      setBusy(button, true, '导出中…');
      try {
        const filename = await api.download(
          kind === 'csv' ? '/api/export/csv' : '/api/export/xlsx',
          { kind: 'expenses', vehicleId: vehicle.id, from: range.from, to: range.to },
          `用车费用.${kind}`
        );
        toast(`已导出 ${filename}`);
      } catch (err) {
        toast(err.message, 'error');
      } finally {
        setBusy(button, false);
      }
    });
  });
  root.querySelector('[data-page="prev"]')?.addEventListener('click', () => {
    filters.page = Math.max(0, filters.page - 1);
    reload();
  });
  root.querySelector('[data-page="next"]')?.addEventListener('click', () => {
    filters.page += 1;
    reload();
  });
  root.querySelectorAll('[data-edit]').forEach((button) => {
    button.addEventListener('click', () => {
      const item = data.items.find((entry) => entry.id === Number(button.dataset.edit));
      if (item) openExpenseModal({ expense: item, onSaved: reload });
    });
  });
  root.querySelectorAll('[data-delete]').forEach((button) => {
    button.addEventListener('click', async () => {
      const item = data.items.find((entry) => entry.id === Number(button.dataset.delete));
      if (!item) return;
      const ok = await confirmDialog({
        title: '删除费用记录',
        message: `确定删除 ${item.occurredOn} 的${CATEGORIES[item.category]?.label || '费用'} ${fmtMoney(item.amount)} 吗？此操作不可撤销。`,
        confirmText: '删除',
        danger: true
      });
      if (!ok) return;
      try {
        await api.del(`/api/expenses/${item.id}`);
        toast('记录已删除');
        reload();
      } catch (err) {
        toast(err.message, 'error');
      }
    });
  });
}

export function resetFilters() {
  filters.search = '';
  filters.category = '';
  filters.month = '';
  filters.page = 0;
}
