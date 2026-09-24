import '@picocss/pico/css/pico.zinc.min.css';
import './styles/app.css';
import { cleanupMediaDaily } from './media';
import { bannerHost, setupPwa } from './pwa';
import { renderCardEdit } from './ui/cardEdit';
import { renderDeck } from './ui/deck';
import { h } from './ui/dom';
import { renderHome } from './ui/home';
import { renderSettings } from './ui/settings';
import { renderStudy } from './ui/study';

type Cleanup = (() => void) | void;

const root = document.getElementById('app')!;
let cleanup: Cleanup;
let renderId = 0;

async function route(): Promise<void> {
  const id = ++renderId;
  if (typeof cleanup === 'function') cleanup();
  cleanup = undefined;

  const path = location.hash.replace(/^#/, '') || '/';
  const parts = path.split('/').filter(Boolean);
  // 描画中に次の遷移が起きたら、古い描画結果は捨てる
  const target = document.createElement('div');

  let result: Cleanup = undefined;
  try {
    if (parts[0] === 'study' && parts[1]) result = await renderStudy(target, parts[1]);
    else if (parts[0] === 'deck' && parts[1] && parts[2] === 'card' && parts[3]) {
      result = await renderCardEdit(target, parts[1], parts[3] === 'new' ? null : parts[3]);
    } else if (parts[0] === 'deck' && parts[1]) await renderDeck(target, parts[1]);
    else if (parts[0] === 'settings') await renderSettings(target);
    else await renderHome(target);
  } catch (e) {
    console.error(e);
    target.replaceChildren(h('main', { class: 'container' }, h('p', null, `エラーが発生しました：${e instanceof Error ? e.message : e}`), h('a', { role: 'button', class: 'secondary', href: '#/' }, 'ホームへ')));
  }

  if (id !== renderId) {
    if (typeof result === 'function') result();
    return;
  }
  cleanup = result;
  const topbar = target.querySelector(':scope > header');
  if (topbar) topbar.after(bannerHost);
  else target.prepend(bannerHost);
  root.replaceChildren(target);
  window.scrollTo(0, 0);
}

window.addEventListener('hashchange', route);
route();
setupPwa();

// どのカードからも参照されていない画像を、起動時にバックグラウンドで1日1回まで掃除する
setTimeout(() => {
  cleanupMediaDaily().catch((e) => console.error('画像の掃除に失敗しました', e));
}, 3000);
