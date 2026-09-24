import { h } from './ui/dom';

/** 通知の置き場所。画面を描画するたびに上部バーの直下へ差し込む（main.ts） */
export const bannerHost = h('div', { class: 'banners' });

function isStandalone(): boolean {
  return (navigator as Navigator & { standalone?: boolean }).standalone === true || matchMedia('(display-mode: standalone)').matches;
}

function banner(text: string, action?: { label: string; run: () => void }, dismissible = true): HTMLElement {
  const el = h(
    'div',
    { class: 'banner', role: 'status' },
    h('span', null, text),
    action && h('button', { class: 'btn small primary', onclick: action.run }, action.label),
    dismissible && h('button', { class: 'banner-close', 'aria-label': '閉じる', onclick: () => el.remove() }, '×'),
  );
  bannerHost.append(el);
  return el;
}

/** Service Worker の登録と「更新があります」表示 */
function registerServiceWorker(): void {
  if (!('serviceWorker' in navigator) || !import.meta.env.PROD) return;

  let reloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloading) return;
    reloading = true;
    location.reload();
  });

  const offerUpdate = (worker: ServiceWorker) => {
    banner('更新があります', { label: '反映する', run: () => worker.postMessage({ type: 'SKIP_WAITING' }) });
  };

  navigator.serviceWorker.register('./sw.js').then((reg) => {
    if (reg.waiting && navigator.serviceWorker.controller) offerUpdate(reg.waiting);
    reg.addEventListener('updatefound', () => {
      const worker = reg.installing;
      worker?.addEventListener('statechange', () => {
        if (worker.state === 'installed' && navigator.serviceWorker.controller) offerUpdate(worker);
      });
    });
    // ホーム画面から開き直したときにも更新を確認する
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') reg.update().catch(() => {});
    });
  });
}

export function setupPwa(): void {
  registerServiceWorker();

  // ストレージの自動削除を防ぐよう要求する
  navigator.storage?.persist?.().catch(() => {});

  if (!isStandalone() && /iPhone|iPad|iPod/.test(navigator.userAgent)) {
    banner('共有ボタン →「ホーム画面に追加」から開いてください。Safariのタブのままだとデータが消えることがあります。');
  }
}
