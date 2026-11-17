import { api } from '../api.js';
import { state, currentVehicle, loadBootstrap, saveSettings } from '../store.js';
import { icon } from '../icons.js';
import { refreshInstallUi } from '../pwa.js';
import {
  confirmDialog,
  copyText,
  esc,
  field,
  fileToText,
  fmtDate,
  openModal,
  setBusy,
  skeleton,
  toast,
  todayStr
} from '../ui.js';

function settingsSection(title, subtitle, content, iconName = 'settings') {
  return `<section class="settings-card">
    <header class="settings-head">
      <div class="settings-icon">${icon(iconName, 20)}</div>
      <div><h3>${esc(title)}</h3><p>${esc(subtitle)}</p></div>
    </header>
    <div class="settings-body">${content}</div>
  </section>`;
}

export async function render(root) {
  root.innerHTML = `<div class="page-stack">${skeleton(3)}</div>`;
  let status;
  try {
    status = await api.get('/api/webdav/status');
  } catch {
    status = { configured: false, lastSync: '', lastRestore: '' };
  }
  const settings = state.settings;
  const vehicle = currentVehicle();

  const sample = {
    vehiclePlate: vehicle?.plateNo || '沪A·8K2M9',
    category: 'fuel',
    date: todayStr(),
    amount: 320.5,
    quantity: 40.06,
    unitPrice: 8.0,
    odometer: vehicle ? undefined : 26310,
    station: '中国石化 漕河泾站',
    fuelType: vehicle?.fuelType || '95#',
    fullTank: true,
    externalId: `agent-${todayStr()}-001`
  };
  const curl = `curl -X POST http://localhost:8080/api/agent/expenses \\
  -H "Content-Type: application/json" \\
  -d '${JSON.stringify(sample)}'`;

  root.innerHTML = `<div class="page-stack">
    <section class="settings-hero">
      <div>
        <span class="eyebrow">${icon('database', 15)}数据与设置</span>
        <h2>数据掌握在你自己手里</h2>
        <p>本地 SQLite 存储，支持 Excel / CSV 导出、完整备份与 WebDAV 同步。</p>
      </div>
      <div class="storage-badge">
        ${icon('database', 18)}
        <div><b>本机数据库</b><span>${state.counts.vehicles} 辆车 · ${state.counts.expenses} 条费用 · ${state.counts.records} 条保养</span></div>
      </div>
    </section>

    ${settingsSection('外观与显示', '主题、货币符号与基本偏好', `
      <div class="settings-grid">
        <label class="field">
          <span class="field-label">主题</span>
          <select data-theme-select class="select">
            <option value="light" ${settings.theme === 'light' ? 'selected' : ''}>浅色</option>
            <option value="dark" ${settings.theme === 'dark' ? 'selected' : ''}>深色</option>
            <option value="auto" ${settings.theme === 'auto' ? 'selected' : ''}>跟随系统</option>
          </select>
        </label>
        <label class="field">
          <span class="field-label">货币符号</span>
          <div class="inline-input"><input class="input" data-currency maxlength="4" value="${esc(settings.currency || '¥')}"><button class="btn btn-soft" data-save-currency>保存</button></div>
        </label>
      </div>
      <p class="settings-note">${icon('info', 14)} 主题与货币符号保存在本机数据库中；报告和卡片会使用该货币符号。</p>
    `, 'sun')}

    ${settingsSection('安装到手机 / 桌面', 'PWA 安装后可全屏运行，拥有独立图标与更快启动', `
      <div class="install-settings">
        <img src="/icons/icon-192.png" alt="车记图标" width="58" height="58">
        <div class="install-settings-copy">
          <b>车记 · Vehicle Meter</b>
          <p>不经过应用商店；数据仍保存在你的 Docker 中。<span data-install-state>未安装</span></p>
        </div>
        <button class="btn btn-primary" type="button" data-install-app>${icon('download', 15)}安装到设备</button>
      </div>
      <p class="settings-note">${icon('info', 14)} iPhone / iPad 请使用 Safari：底部分享 → 添加到主屏幕。手机通过局域网 HTTP 访问时，Chrome 的 PWA 安装与离线缓存需要 HTTPS。</p>
    `, 'download')}

    ${settingsSection('导出数据', 'Excel 包含费用、保养、计划、车辆与月度汇总；CSV 便于导入其他工具', `
      <div class="action-grid">
        <button class="action-tile" data-export="xlsx">
          <i>${icon('download', 20)}</i>
          <div><b>Excel 工作簿</b><span>.xlsx · 多工作表</span></div>
          ${icon('chevronRight', 16)}
        </button>
        <button class="action-tile" data-export="csv">
          <i>${icon('download', 20)}</i>
          <div><b>CSV 压缩包</b><span>.zip · 费用 / 保养 / 计划</span></div>
          ${icon('chevronRight', 16)}
        </button>
        <button class="action-tile" data-export="backup">
          <i>${icon('cloud', 20)}</i>
          <div><b>完整备份</b><span>.json · 含设置与 WebDAV 配置</span></div>
          ${icon('chevronRight', 16)}
        </button>
      </div>
      <p class="settings-note">${icon('alert', 14)} 完整备份包含 WebDAV 密码等设置，请妥善保管，不要公开分享。</p>
    `, 'download')}

    ${settingsSection('恢复备份', '从车记导出的 JSON 文件恢复；恢复会覆盖当前全部车辆与记录', `
      <div class="restore-row">
        <input type="file" accept="application/json,.json" data-restore-file hidden>
        <button class="btn btn-soft" data-pick-restore>${icon('upload', 16)}选择备份文件</button>
        <span class="muted" data-restore-name>尚未选择文件</span>
      </div>
      <p class="settings-note">${icon('alert', 14)} 恢复前建议先导出一份当前数据。恢复成功后页面会自动刷新。</p>
    `, 'upload')}

    ${settingsSection('WebDAV 同步', '兼容坚果云、Nextcloud、群晖等 WebDAV 服务', `
      <form id="webdav-form" class="form">
        <div class="form-grid">
          <label class="field span-2"><span class="field-label">WebDAV 地址</span><input name="webdavUrl" type="url" placeholder="https://dav.jianguoyun.com/dav/" value="${esc(settings.webdavUrl || '')}"></label>
          <label class="field"><span class="field-label">账号</span><input name="webdavUsername" type="text" autocomplete="username" value="${esc(settings.webdavUsername || '')}"></label>
          <label class="field"><span class="field-label">密码 / 应用密码</span><input name="webdavPassword" type="password" autocomplete="current-password" placeholder="${settings.webdavHasPassword ? '已保存，留空不修改' : '输入应用密码'}" value=""></label>
          <label class="field span-2"><span class="field-label">远端文件路径</span><input name="webdavPath" type="text" placeholder="vehicle-meter/backup.json" value="${esc(settings.webdavPath || 'vehicle-meter/backup.json')}"></label>
        </div>
        <div class="button-row">
          <button class="btn btn-primary" type="submit">${icon('check', 16)}保存配置</button>
          <button class="btn btn-soft" type="button" data-webdav-test>${icon('cloud', 16)}测试连接</button>
          <button class="btn btn-soft" type="button" data-webdav-backup>${icon('upload', 16)}立即备份</button>
          <button class="btn btn-ghost" type="button" data-webdav-restore>${icon('download', 16)}从远端恢复</button>
        </div>
      </form>
      <div class="sync-status">
        <span>${status.configured ? icon('checkCircle', 15) : icon('info', 15)} ${status.configured ? '已配置' : '未配置'}</span>
        <span>上次备份：${status.lastSync ? fmtDate(status.lastSync) : '—'}</span>
        <span>上次恢复：${status.lastRestore ? fmtDate(status.lastRestore) : '—'}</span>
      </div>
      <p class="settings-note">${icon('info', 14)} 坚果云需在「账户信息 → 安全选项」中添加应用密码，并使用该密码；远端目录不存在时会自动尝试创建。</p>
    `, 'cloud')}

    ${settingsSection('Agent 结构化录入', '由 Agent 识别小票后，用标准 JSON 写入费用记录；后端不处理图片', `
      <div class="agent-box">
        <div class="agent-head">
          <div><b>POST /api/agent/expenses</b><span>支持单条、数组或 { items: [...] }，可传 dryRun 预览</span></div>
          <button class="btn btn-soft btn-sm" data-agent-schema>${icon('report', 15)}查看 JSON Schema</button>
        </div>
        <pre class="code-block">${esc(curl)}</pre>
        <div class="button-row">
          <button class="btn btn-ghost btn-sm" data-copy-curl>${icon('copy', 15)}复制示例</button>
          <button class="btn btn-ghost btn-sm" data-copy-schema>${icon('copy', 15)}复制 Schema 地址</button>
        </div>
        <p class="settings-note">${icon('info', 14)} 金额必填；数量、单价、金额任意给出两个即可推导第三个。同一车辆下 externalId 可用于幂等重试。</p>
      </div>
    `, 'cpu')}

    ${settingsSection('危险操作', '这些操作不可撤销，请谨慎使用', `
      <div class="danger-row">
        <div><b>清空全部数据</b><p>删除所有车辆、费用、保养记录与计划；保留设置。</p></div>
        <button class="btn btn-danger-soft" data-clear>${icon('trash', 16)}清空数据</button>
      </div>
      <div class="danger-row">
        <div><b>加载示例数据</b><p>仅在没有车辆时可用，用于快速体验完整功能。</p></div>
        <button class="btn btn-soft" data-demo ${state.counts.vehicles ? 'disabled' : ''}>${icon('sparkles', 16)}加载示例</button>
      </div>
    `, 'alert')}

    <footer class="settings-footer">
      <span>车记 · Vehicle Meter v${esc(state.app.version)}</span>
      <span>数据存储于本机 SQLite · 无云端上传</span>
    </footer>
  </div>`;

  refreshInstallUi();

  const reload = async () => {
    await loadBootstrap();
    render(root);
  };

  root.querySelector('[data-theme-select]').addEventListener('change', async (event) => {
    try {
      await saveSettings({ theme: event.target.value });
      toast('主题已更新');
    } catch (err) {
      toast(err.message, 'error');
    }
  });
  root.querySelector('[data-save-currency]').addEventListener('click', async (event) => {
    const button = event.currentTarget;
    const value = root.querySelector('[data-currency]').value.trim() || '¥';
    setBusy(button, true, '保存中…');
    try {
      await saveSettings({ currency: value });
      toast('货币符号已保存');
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setBusy(button, false);
    }
  });

  root.querySelectorAll('[data-export]').forEach((button) => button.addEventListener('click', async () => {
    const kind = button.dataset.export;
    setBusy(button, true, '导出中…');
    try {
      let filename;
      if (kind === 'xlsx') filename = await api.download('/api/export/xlsx', {}, `用车数据-${todayStr()}.xlsx`);
      else if (kind === 'csv') filename = await api.download('/api/export/csv', { kind: 'all' }, `用车数据-${todayStr()}.zip`);
      else filename = await api.download('/api/backup', {}, `车记备份-${todayStr()}.json`);
      toast(`已导出 ${filename}`);
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setBusy(button, false);
    }
  }));

  const fileInput = root.querySelector('[data-restore-file]');
  root.querySelector('[data-pick-restore]').addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', async () => {
    const file = fileInput.files?.[0];
    if (!file) return;
    root.querySelector('[data-restore-name]').textContent = file.name;
    const ok = await confirmDialog({
      title: '恢复备份',
      message: `将用「${file.name}」覆盖当前全部数据。建议先导出当前数据，确定继续吗？`,
      confirmText: '覆盖并恢复',
      danger: true
    });
    if (!ok) return;
    try {
      const text = await fileToText(file);
      const payload = JSON.parse(text);
      const result = await api.post('/api/restore', payload);
      toast(`恢复完成：${result.counts.vehicles} 辆车，${result.counts.expenses} 条费用`);
      await reload();
    } catch (err) {
      toast(err.message || '备份文件无效', 'error');
    } finally {
      fileInput.value = '';
    }
  });

  const webdavForm = root.querySelector('#webdav-form');
  const webdavPayload = () => ({
    webdavUrl: webdavForm.elements.webdavUrl.value.trim(),
    webdavUsername: webdavForm.elements.webdavUsername.value.trim(),
    webdavPath: webdavForm.elements.webdavPath.value.trim(),
    ...(webdavForm.elements.webdavPassword.value ? { webdavPassword: webdavForm.elements.webdavPassword.value } : {})
  });
  webdavForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const submit = webdavForm.querySelector('button[type="submit"]');
    setBusy(submit, true, '保存中…');
    try {
      await saveSettings(webdavPayload());
      toast('WebDAV 配置已保存');
      await reload();
    } catch (err) {
      toast(err.message, 'error');
      setBusy(submit, false);
    }
  });
  root.querySelector('[data-webdav-test]').addEventListener('click', async (event) => {
    const button = event.currentTarget;
    setBusy(button, true, '连接中…');
    try {
      await saveSettings(webdavPayload(), { silent: true });
      const result = await api.post('/api/webdav/test', webdavPayload());
      toast(result.message || '连接成功');
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setBusy(button, false);
    }
  });
  root.querySelector('[data-webdav-backup]').addEventListener('click', async (event) => {
    const button = event.currentTarget;
    setBusy(button, true, '上传中…');
    try {
      await saveSettings(webdavPayload(), { silent: true });
      const result = await api.post('/api/webdav/backup', webdavPayload());
      toast(`已备份到 WebDAV（${Math.round(result.bytes / 1024)} KB）`);
      await reload();
    } catch (err) {
      toast(err.message, 'error');
      setBusy(button, false);
    }
  });
  root.querySelector('[data-webdav-restore]').addEventListener('click', async (event) => {
    const button = event.currentTarget;
    const ok = await confirmDialog({
      title: '从 WebDAV 恢复',
      message: '将下载远端备份并覆盖当前全部数据。确定继续吗？',
      confirmText: '下载并恢复',
      danger: true
    });
    if (!ok) return;
    setBusy(button, true, '下载中…');
    try {
      const result = await api.post('/api/webdav/restore', { ...webdavPayload(), confirm: '恢复远端备份' });
      toast(`恢复完成：${result.counts.vehicles} 辆车，${result.counts.expenses} 条费用`);
      await reload();
    } catch (err) {
      toast(err.message, 'error');
      setBusy(button, false);
    }
  });

  root.querySelector('[data-copy-curl]').addEventListener('click', async () => {
    await copyText(curl);
    toast('示例已复制');
  });
  root.querySelector('[data-copy-schema]').addEventListener('click', async () => {
    await copyText(`${location.origin}/api/agent/schema`);
    toast('Schema 地址已复制');
  });
  root.querySelector('[data-agent-schema]').addEventListener('click', async () => {
    try {
      const schema = await api.get('/api/agent/schema');
      openModal({
        title: 'Agent JSON Schema',
        subtitle: 'POST /api/agent/expenses',
        size: 'lg',
        body: `<pre class="code-block code-block-tall">${esc(JSON.stringify(schema, null, 2))}</pre>`,
        footer: `<button class="btn btn-ghost" type="button" data-cancel>关闭</button><button class="btn btn-primary" type="button" data-copy>复制 JSON</button>`,
        onMount: (ctx) => {
          ctx.$('[data-cancel]').addEventListener('click', ctx.close);
          ctx.$('[data-copy]').addEventListener('click', async () => {
            await copyText(JSON.stringify(schema, null, 2));
            toast('Schema 已复制');
          });
        }
      });
    } catch (err) {
      toast(err.message, 'error');
    }
  });

  root.querySelector('[data-clear]').addEventListener('click', async () => {
    const ok = await confirmDialog({
      title: '清空全部数据',
      message: '所有车辆、费用、保养计划与记录将被永久删除。此操作不可撤销，确定继续吗？',
      confirmText: '清空数据',
      danger: true
    });
    if (!ok) return;
    try {
      await api.post('/api/data/reset', { confirm: '清空所有数据', keepSettings: true });
      toast('数据已清空');
      await reload();
    } catch (err) {
      toast(err.message, 'error');
    }
  });
  root.querySelector('[data-demo]')?.addEventListener('click', async (event) => {
    const button = event.currentTarget;
    setBusy(button, true, '生成中…');
    try {
      await api.post('/api/demo');
      toast('示例数据已加载');
      await reload();
    } catch (err) {
      toast(err.message, 'error');
      setBusy(button, false);
    }
  });
}
