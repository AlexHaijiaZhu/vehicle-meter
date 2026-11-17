import { api } from '../api.js';
import { currentVehicle } from '../store.js';
import { icon } from '../icons.js';
import {
  confirmDialog,
  copyText,
  emptyState,
  esc,
  fmtDate,
  fmtMoney,
  fmtNum,
  openModal,
  progressBar,
  skeleton,
  statusPill,
  toast
} from '../ui.js';
import { openPlanModal, openRecordModal } from '../modals.js';

let showInactive = false;

function agentPrompt(vehicle) {
  const year = vehicle.purchaseDate ? `${vehicle.purchaseDate.slice(0, 4)} 年款` : '请先确认年款';
  return `我的车是「${vehicle.name}」（${vehicle.brandModel || '车型未填写'}，${vehicle.plateNo || '无车牌'}，${year}）。请联网查询该车型的官方保养手册，整理保养项目、周期里程与周期月数；先 dryRun 预览，再使用 vehicle-meter MCP 的 import_maintenance_plans 工具，把保养计划批量导入到这辆车。请附上官方来源链接，不要编造周期。`;
}

function mcpConfig() {
  return JSON.stringify(
    {
      mcpServers: {
        'vehicle-meter': {
          command: 'node',
          args: ['<车记项目目录>/mcp/server.js'],
          env: {
            VEHICLE_METER_URL: 'http://127.0.0.1:8080',
            VEHICLE_METER_PASSWORD: ''
          }
        }
      }
    },
    null,
    2
  );
}

function openAgentImportModal(vehicle) {
  const prompt = agentPrompt(vehicle);
  const config = mcpConfig();
  openModal({
    title: 'Agent 批量导入保养计划',
    subtitle: '让 Agent 查询官方保养手册，再通过 MCP 写入车记',
    size: 'lg',
    body: `<div class="agent-modal">
      <section class="agent-step">
        <div class="agent-step-head"><span>1</span><div><b>复制提示词给 Agent</b><p>替换车型/年款后发给支持 MCP 的 Agent。</p></div></div>
        <pre class="code-block">${esc(prompt)}</pre>
        <button class="btn btn-soft btn-sm" data-copy-prompt>${icon('copy', 15)}复制提示词</button>
      </section>
      <section class="agent-step">
        <div class="agent-step-head"><span>2</span><div><b>在 Agent 中配置 MCP 服务</b><p>本地运行 Node 时使用下方配置；Docker 部署见说明。</p></div></div>
        <pre class="code-block">${esc(config)}</pre>
        <button class="btn btn-soft btn-sm" data-copy-config>${icon('copy', 15)}复制 MCP 配置</button>
      </section>
      <section class="agent-step">
        <div class="agent-step-head"><span>3</span><div><b>MCP 工具与接口</b><p>Agent 会依次调用以下能力，导入按 externalId 或名称幂等，不会重复创建。</p></div></div>
        <div class="agent-tool-list">
          <div><code>list_vehicles</code><span>确认车型、年款与车辆 ID</span></div>
          <div><code>get_maintenance_plans</code><span>导入前查看已有计划，避免重复</span></div>
          <div><code>import_maintenance_plans</code><span>批量写入，支持 dryRun / 来源链接</span></div>
        </div>
        <p class="settings-note">${icon('info', 14)} 也可以直接调用 <code>POST /api/agent/maintenance-plans</code>；完整 JSON 格式见下方。</p>
      </section>
      <section class="agent-step">
        <div class="agent-step-head"><span>4</span><div><b>导入格式与示例</b><p>从服务端实时读取，保证与当前版本一致。</p></div></div>
        <div data-agent-schema class="agent-schema"><span class="muted">加载中…</span></div>
      </section>
      <section class="agent-step">
        <div class="agent-step-head"><span>i</span><div><b>Docker 部署时</b><p>MCP 配置可改为通过容器执行：</p></div></div>
        <pre class="code-block">{
  "mcpServers": {
    "vehicle-meter": {
      "command": "docker",
      "args": ["exec", "-i", "vehicle-meter", "node", "/app/mcp/server.js"]
    }
  }
}</pre>
        <p class="settings-note">${icon('alert', 14)} 官方保养周期仅作计划参考，实际保养请以车辆状况、厂家最新要求和维修店检查为准。</p>
      </section>
    </div>`,
    footer: `<button class="btn btn-ghost" type="button" data-cancel>关闭</button><button class="btn btn-primary" type="button" data-copy-all>${icon('copy', 16)}复制提示词</button>`,
    onMount: (ctx) => {
      ctx.$('[data-cancel]').addEventListener('click', ctx.close);
      ctx.$('[data-copy-all]').addEventListener('click', async () => {
        await copyText(prompt);
        toast('提示词已复制，发给 Agent 即可');
      });
      ctx.$('[data-copy-prompt]').addEventListener('click', async () => {
        await copyText(prompt);
        toast('提示词已复制');
      });
      ctx.$('[data-copy-config]').addEventListener('click', async () => {
        await copyText(config);
        toast('MCP 配置已复制');
      });
      api.get('/api/agent/maintenance-schema').then((schema) => {
        const example = JSON.stringify(schema.example, null, 2);
        ctx.$('[data-agent-schema]').innerHTML = `<pre class="code-block">${esc(example)}</pre>
          <div class="button-row"><button class="btn btn-ghost btn-sm" data-copy-example>${icon('copy', 15)}复制示例 JSON</button><a class="btn btn-ghost btn-sm" href="/api/agent/maintenance-schema" target="_blank" rel="noopener">${icon('external', 15)}查看完整 Schema</a></div>`;
        ctx.$('[data-copy-example]').addEventListener('click', async () => {
          await copyText(example);
          toast('示例 JSON 已复制');
        });
      }).catch((err) => {
        ctx.$('[data-agent-schema]').innerHTML = `<div class="inline-error">${esc(err.message)}</div>`;
      });
    }
  });
}

function dueText(plan) {
  const parts = [];
  if (plan.dueDate) {
    parts.push(plan.remainingDays == null ? plan.dueDate : plan.remainingDays < 0 ? `已过期 ${-plan.remainingDays} 天` : plan.remainingDays === 0 ? '今天到期' : `还有 ${plan.remainingDays} 天`);
  }
  if (plan.dueOdo != null) {
    parts.push(plan.remainingKm == null ? `${fmtNum(plan.dueOdo, 0)} km` : plan.remainingKm < 0 ? `超出 ${fmtNum(-plan.remainingKm, 0)} km` : `还剩 ${fmtNum(plan.remainingKm, 0)} km`);
  }
  return parts.join(' · ') || '未设置';
}

function intervalText(plan) {
  const parts = [];
  if (plan.intervalMileage) parts.push(`${fmtNum(plan.intervalMileage, 0)} km`);
  if (plan.intervalMonths) parts.push(`${plan.intervalMonths} 个月`);
  return parts.length ? `每 ${parts.join(' 或 ')}` : '自定义周期';
}

function planSource(plan) {
  if (plan.sourceUrl) {
    return ` · <a class="source-link" href="${esc(plan.sourceUrl)}" target="_blank" rel="noopener noreferrer">${plan.source === 'official' ? '官方来源' : '来源'}${icon('external', 11)}</a>`;
  }
  if (plan.source === 'official') return ' · 官方计划';
  if (plan.source === 'agent') return ' · Agent 导入';
  return '';
}

export async function render(root) {
  const vehicle = currentVehicle();
  if (!vehicle) return;
  root.innerHTML = `<div class="page-stack">${skeleton(4)}</div>`;
  let planData;
  let recordData;
  try {
    [planData, recordData] = await Promise.all([
      api.get('/api/plans', { vehicleId: vehicle.id, includeInactive: 1 }),
      api.get('/api/maintenance', { vehicleId: vehicle.id, limit: 100 })
    ]);
  } catch (err) {
    root.innerHTML = `<div class="card"><div class="inline-error">${icon('alert', 18)}${esc(err.message)}</div></div>`;
    return;
  }

  const plans = planData.items;
  const activePlans = plans.filter((p) => p.active);
  const inactivePlans = plans.filter((p) => !p.active);
  const attention = activePlans.filter((p) => p.status === 'overdue' || p.status === 'soon');
  const latestRecord = recordData.items[0];
  const reload = () => render(root);

  const planCard = (plan) => `<article class="plan-tile status-${plan.status} ${plan.active ? '' : 'is-inactive'}">
    <header class="plan-head">
      <div class="plan-icon ${plan.status}">${icon(plan.status === 'overdue' ? 'alert' : plan.status === 'soon' ? 'clock' : 'wrench', 20)}</div>
      <div class="plan-title"><h3>${esc(plan.name)}</h3><p>${intervalText(plan)}</p></div>
      ${statusPill(plan.status)}
    </header>
    <div class="plan-due-grid">
      <div><span>下次到期</span><b>${plan.dueDate ? fmtDate(plan.dueDate) : '按里程'}</b><small>${plan.remainingDays == null ? '—' : plan.remainingDays < 0 ? `已过期 ${-plan.remainingDays} 天` : `还有 ${plan.remainingDays} 天`}</small></div>
      <div><span>到期里程</span><b>${plan.dueOdo != null ? `${fmtNum(plan.dueOdo, 0)} km` : '按时间'}</b><small>${plan.remainingKm == null ? '—' : plan.remainingKm < 0 ? `超出 ${fmtNum(-plan.remainingKm, 0)} km` : `还剩 ${fmtNum(plan.remainingKm, 0)} km`}</small></div>
    </div>
    ${progressBar(plan.progress, plan.status === 'overdue' ? 'danger' : plan.status === 'soon' ? 'warn' : '')}
    ${plan.items ? `<div class="plan-items">${plan.items.split(/[,，、\n]/).filter(Boolean).slice(0, 5).map((item) => `<span>${esc(item.trim())}</span>`).join('')}</div>` : ''}
    <footer class="plan-foot">
      <span class="muted">${plan.lastServiceOn ? `上次 ${fmtDate(plan.lastServiceOn)}` : '还没有保养记录'}${planSource(plan)}</span>
      <div class="button-row">
        <button class="btn btn-soft btn-sm" data-record="${plan.id}">${icon('check', 14)}记保养</button>
        <button class="icon-btn" data-edit-plan="${plan.id}" title="编辑">${icon('edit', 16)}</button>
        <button class="icon-btn danger" data-delete-plan="${plan.id}" title="删除">${icon('trash', 16)}</button>
      </div>
    </footer>
  </article>`;

  root.innerHTML = `<div class="page-stack">
    <section class="maintenance-hero">
      <div>
        <span class="eyebrow">${icon('wrench', 15)}保养总览</span>
        <h2>${attention.length ? `${attention.length} 项保养需要关注` : '车辆状态良好'}</h2>
        <p>${attention.length ? `最近一项：${esc(attention[0].name)} · ${dueText(attention[0])}` : '所有启用中的保养计划都在正常周期内。'}</p>
        <div class="button-row">
          <button class="btn btn-primary" data-add-record>${icon('plus', 16)}记录保养</button>
          <button class="btn btn-soft" data-add-plan>${icon('calendar', 16)}新建计划</button>
        </div>
      </div>
      <div class="maintenance-stats">
        <div><span>启用计划</span><b>${activePlans.length}</b></div>
        <div><span>需要关注</span><b class="${attention.length ? 'text-warn' : ''}">${attention.length}</b></div>
        <div><span>累计保养</span><b>${fmtMoney(recordData.totalCost, { digits: 0 })}</b></div>
        <div><span>当前里程</span><b>${fmtNum(planData.latestOdometer, 0)}<small>km</small></b></div>
      </div>
    </section>

    <section class="agent-import-card">
      <div class="agent-import-icon">${icon('sparkles', 22)}</div>
      <div class="agent-import-copy">
        <span class="eyebrow">AGENT / MCP</span>
        <h3>让 Agent 按官方保养手册批量建计划</h3>
        <p>告诉 Agent 车型，它会联网查询官方保养周期，再通过 MCP 的 <code>import_maintenance_plans</code> 导入。当前车辆：<b>${esc(vehicle.brandModel || vehicle.name)}</b>。</p>
        <div class="agent-steps"><span>1 确认车型</span><i>→</i><span>2 查官方手册</span><i>→</i><span>3 批量导入</span></div>
      </div>
      <div class="button-row agent-import-actions">
        <button class="btn btn-soft" data-agent-import>${icon('report', 16)}导入说明</button>
        <button class="btn btn-primary" data-agent-prompt>${icon('copy', 16)}复制提示词</button>
      </div>
    </section>

    <section class="section-block">
      <header class="section-head">
        <div><h3>保养计划</h3><p>按里程或时间自动计算到期状态</p></div>
        <label class="toggle-text"><input type="checkbox" data-toggle-inactive ${showInactive ? 'checked' : ''}>显示停用计划</label>
      </header>
      ${activePlans.length || (showInactive && inactivePlans.length)
        ? `<div class="plan-grid">${activePlans.map(planCard).join('')}${showInactive ? inactivePlans.map(planCard).join('') : ''}</div>`
        : emptyState({
            iconName: 'calendar',
            title: '还没有保养计划',
            text: '创建机油、滤芯、轮胎等保养计划，到期前自动提醒。',
            action: `<button class="btn btn-primary" data-add-plan>${icon('plus', 16)}新建保养计划</button>`
          })}
    </section>

    <section class="card table-card">
      <header class="card-head table-card-head">
        <div><h3>保养与维修历史</h3><p>共 ${recordData.total} 条记录 · 合计 ${fmtMoney(recordData.totalCost)}</p></div>
        <button class="btn btn-soft btn-sm" data-add-record>${icon('plus', 15)}记录</button>
      </header>
      ${recordData.items.length
        ? `<div class="table-scroll"><table class="data-table">
            <thead><tr><th>日期</th><th>项目</th><th>关联计划</th><th class="num">费用</th><th class="num">里程</th><th>门店</th><th class="actions">操作</th></tr></thead>
            <tbody>${recordData.items.map((record) => `<tr>
              <td class="nowrap"><b>${fmtDate(record.serviceOn, { short: true })}</b><span class="cell-sub">${record.serviceOn.slice(0, 4)}</span></td>
              <td class="wide-cell"><b>${esc(record.items || '保养')}</b>${record.note ? `<span class="cell-sub">${esc(record.note)}</span>` : ''}</td>
              <td>${record.planName ? `<span class="tag tag-teal">${esc(record.planName)}</span>` : '<span class="muted">—</span>'}</td>
              <td class="num amount-cell">${fmtMoney(record.cost)}</td>
              <td class="num">${record.odometer != null ? `${fmtNum(record.odometer, 0)}<small> km</small>` : '—'}</td>
              <td>${esc(record.shop || '—')}</td>
              <td class="actions">
                <button class="icon-btn" data-edit-record="${record.id}" title="编辑">${icon('edit', 16)}</button>
                <button class="icon-btn danger" data-delete-record="${record.id}" title="删除">${icon('trash', 16)}</button>
              </td>
            </tr>`).join('')}</tbody>
          </table></div>`
        : emptyState({
            iconName: 'wrench',
            title: '还没有保养记录',
            text: '每次保养后记录项目、费用与里程，形成完整养护档案。',
            action: `<button class="btn btn-primary" data-add-record>${icon('plus', 16)}记录第一次保养</button>`
          })}
    </section>

    <section class="note-card">
      ${icon('info', 18)}
      <div><b>保养费用如何计入成本？</b><p>保养记录中的费用会自动计入用车成本、月度报告与每公里成本，无需在费用页重复录入。</p></div>
    </section>
  </div>`;

  const findPlan = (id) => plans.find((p) => p.id === Number(id));
  const findRecord = (id) => recordData.items.find((r) => r.id === Number(id));

  root.querySelector('[data-agent-import]')?.addEventListener('click', () => openAgentImportModal(vehicle));
  root.querySelector('[data-agent-prompt]')?.addEventListener('click', async () => {
    await copyText(agentPrompt(vehicle));
    toast('提示词已复制，发给 Agent 即可');
  });
  root.querySelectorAll('[data-add-plan]').forEach((button) => button.addEventListener('click', () => openPlanModal({ onSaved: reload })));
  root.querySelectorAll('[data-add-record]').forEach((button) => button.addEventListener('click', () => openRecordModal({
    plans: activePlans,
    latestOdometer: planData.latestOdometer,
    onSaved: reload
  })));
  root.querySelectorAll('[data-record]').forEach((button) => button.addEventListener('click', () => {
    const plan = findPlan(button.dataset.record);
    openRecordModal({ plan, plans: activePlans, latestOdometer: planData.latestOdometer, onSaved: reload });
  }));
  root.querySelectorAll('[data-edit-plan]').forEach((button) => button.addEventListener('click', () => {
    const plan = findPlan(button.dataset.editPlan);
    if (plan) openPlanModal({ plan, onSaved: reload });
  }));
  root.querySelectorAll('[data-delete-plan]').forEach((button) => button.addEventListener('click', async () => {
    const plan = findPlan(button.dataset.deletePlan);
    if (!plan) return;
    const ok = await confirmDialog({
      title: '删除保养计划',
      message: `删除「${plan.name}」计划？历史保养记录会保留。`,
      confirmText: '删除',
      danger: true
    });
    if (!ok) return;
    try {
      await api.del(`/api/plans/${plan.id}`);
      toast('计划已删除');
      reload();
    } catch (err) {
      toast(err.message, 'error');
    }
  }));
  root.querySelectorAll('[data-edit-record]').forEach((button) => button.addEventListener('click', () => {
    const record = findRecord(button.dataset.editRecord);
    if (record) openRecordModal({ record, plans: activePlans, latestOdometer: planData.latestOdometer, onSaved: reload });
  }));
  root.querySelectorAll('[data-delete-record]').forEach((button) => button.addEventListener('click', async () => {
    const record = findRecord(button.dataset.deleteRecord);
    if (!record) return;
    const ok = await confirmDialog({
      title: '删除保养记录',
      message: `删除 ${record.serviceOn} 的保养记录？费用将同步从统计中移除。`,
      confirmText: '删除',
      danger: true
    });
    if (!ok) return;
    try {
      await api.del(`/api/maintenance/${record.id}`);
      toast('保养记录已删除');
      reload();
    } catch (err) {
      toast(err.message, 'error');
    }
  }));
  root.querySelector('[data-toggle-inactive]')?.addEventListener('change', (event) => {
    showInactive = event.target.checked;
    reload();
  });
}
