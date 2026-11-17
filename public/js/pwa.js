import { openModal, toast, copyText } from './ui.js';
import { icon } from './icons.js';

let deferredPrompt = null;
let initialized = false;

export function isStandalone() {
  return (
    window.matchMedia?.('(display-mode: standalone)').matches ||
    window.matchMedia?.('(display-mode: minimal-ui)').matches ||
    window.navigator.standalone === true
  );
}

function isMobile() {
  return /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);
}

export function refreshInstallUi() {
  const standalone = isStandalone();
  document.querySelectorAll('[data-install-state]').forEach((el) => {
    el.textContent = standalone ? '已安装 · 独立窗口运行' : '未安装';
  });
  document.querySelectorAll('[data-install-app]').forEach((button) => {
    if (button.id === 'installBtn') return;
    button.disabled = standalone;
    button.innerHTML = standalone ? `${icon('check', 15)}已安装` : `${icon('download', 15)}安装到设备`;
  });
  const topButton = document.getElementById('installBtn');
  if (topButton) {
    if (!topButton.innerHTML) topButton.innerHTML = icon('download', 18);
    topButton.hidden = standalone || !(deferredPrompt || isMobile());
  }
}

export function initPwa() {
  if (initialized) return;
  initialized = true;

  if ('serviceWorker' in navigator && window.isSecureContext) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/sw.js').catch((err) => {
        console.warn('[pwa] service worker registration failed', err);
      });
    });
  }

  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    deferredPrompt = event;
    refreshInstallUi();
  });

  window.addEventListener('appinstalled', () => {
    deferredPrompt = null;
    refreshInstallUi();
    toast('车记已安装到设备');
  });

  document.addEventListener('click', (event) => {
    const trigger = event.target.closest('[data-install-app], #installBtn');
    if (!trigger) return;
    event.preventDefault();
    installApp();
  });

  refreshInstallUi();
  window.matchMedia?.('(display-mode: standalone)').addEventListener?.('change', refreshInstallUi);
}

export async function installApp() {
  if (isStandalone()) {
    toast('车记已经在独立窗口中运行', 'info');
    return;
  }
  if (deferredPrompt) {
    const promptEvent = deferredPrompt;
    deferredPrompt = null;
    try {
      await promptEvent.prompt();
      const choice = await promptEvent.userChoice;
      if (choice?.outcome === 'accepted') toast('安装已开始，请稍候');
      else toast('已取消安装', 'info');
    } catch {
      showInstallHelp();
    } finally {
      refreshInstallUi();
    }
    return;
  }
  showInstallHelp();
}

export function showInstallHelp() {
  const url = location.origin;
  openModal({
    title: '安装车记到手机 / 桌面',
    subtitle: '添加到主屏幕后，可像原生 App 一样全屏使用',
    size: 'md',
    body: `<div class="install-help">
      <div class="install-help-hero">
        <img src="/icons/icon-192.png" alt="" width="64" height="64">
        <div><b>车记 · 用车管理</b><p>PWA · 不经过应用商店 · 数据仍在你自己的 Docker 中</p></div>
      </div>
      <div class="install-steps">
        <div class="install-step">
          <span class="install-step-no">iPhone / iPad</span>
          <p>必须使用 <b>Safari</b> 打开。点击底部「分享」按钮，选择「添加到主屏幕」，再点「添加」。</p>
        </div>
        <div class="install-step">
          <span class="install-step-no">Android</span>
          <p>使用 Chrome / Edge 打开，点击右上角菜单 <b>⋮</b>，选择「安装应用」或「添加到主屏幕」。</p>
        </div>
        <div class="install-step">
          <span class="install-step-no">桌面 Chrome / Edge</span>
          <p>点击地址栏右侧的安装图标，或浏览器菜单中的「安装车记」。</p>
        </div>
      </div>
      <div class="install-url"><code>${url}</code><button class="btn btn-ghost btn-sm" data-copy-url>${icon('copy', 14)}复制地址</button></div>
      <p class="settings-note">${icon('alert', 14)} 手机通过局域网 IP 访问时，PWA 安装与离线缓存通常要求 HTTPS（iOS 的「添加到主屏幕」可先用 HTTP）。生产环境建议在 Docker 前加一层 HTTPS 反向代理。</p>
    </div>`,
    footer: `<button class="btn btn-ghost" type="button" data-cancel>知道了</button>`,
    onMount: (ctx) => {
      ctx.$('[data-cancel]').addEventListener('click', ctx.close);
      ctx.$('[data-copy-url]')?.addEventListener('click', async () => {
        await copyText(url);
        toast('地址已复制');
      });
    }
  });
}
