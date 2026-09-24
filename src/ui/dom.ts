type Child = Node | string | number | null | undefined | false;
type Attrs = Record<string, unknown>;

/** 小さなDOM生成ヘルパー。on〜 はイベント、それ以外は属性（class は className 相当） */
export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Attrs | null = null,
  ...children: (Child | Child[])[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (attrs) {
    for (const [key, value] of Object.entries(attrs)) {
      if (value === undefined || value === null || value === false) continue;
      if (key.startsWith('on') && typeof value === 'function') {
        el.addEventListener(key.slice(2).toLowerCase(), value as EventListener);
      } else if (key === 'value' && 'value' in el) {
        (el as HTMLInputElement).value = String(value);
      } else if (value === true) {
        el.setAttribute(key, '');
      } else {
        el.setAttribute(key, String(value));
      }
    }
  }
  for (const child of children.flat()) {
    if (child === null || child === undefined || child === false) continue;
    el.append(child instanceof Node ? child : String(child));
  }
  return el;
}

export function header(title: string, opts: { back?: string; action?: Node } = {}): HTMLElement {
  return h(
    'header',
    { class: 'topbar' },
    opts.back ? h('a', { class: 'topbar-back', href: opts.back, 'aria-label': '戻る' }, '‹') : h('span', { class: 'topbar-back' }),
    h('h1', null, title),
    opts.action ?? h('span', { class: 'topbar-action' }),
  );
}

let toastTimer: number | undefined;

export function toast(message: string): void {
  let el = document.getElementById('toast');
  if (!el) {
    el = h('div', { id: 'toast', role: 'status' });
    document.body.append(el);
  }
  el.textContent = message;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => el!.classList.remove('show'), 2500);
}

export function navigate(hash: string): void {
  if (location.hash === hash) window.dispatchEvent(new HashChangeEvent('hashchange'));
  else location.hash = hash;
}

export interface SheetAction {
  label: string;
  kind?: 'primary' | 'danger';
  run: () => void;
}

/** 画面下から出る選択肢。run はタップの中で同期的に呼ぶので、ファイル選択や共有シートも開ける */
export function actionSheet(message: string | null, actions: SheetAction[], onCancel?: () => void): void {
  const close = () => {
    backdrop.remove();
    window.removeEventListener('hashchange', cancel);
  };
  const cancel = () => {
    close();
    onCancel?.();
  };
  const backdrop = h(
    'div',
    { class: 'sheet-backdrop', onclick: (e: Event) => e.target === backdrop && cancel() },
    h(
      'div',
      { class: 'sheet', role: 'dialog' },
      message && h('p', { class: 'sheet-message' }, message),
      actions.map((a) =>
        h(
          'button',
          {
            class: `btn block ${a.kind ?? ''}`,
            onclick: () => {
              close();
              a.run();
            },
          },
          a.label,
        ),
      ),
      h('button', { class: 'btn block', onclick: cancel }, 'キャンセル'),
    ),
  );
  window.addEventListener('hashchange', cancel);
  document.body.append(backdrop);
}
