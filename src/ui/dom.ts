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

/** 画面上部のバー。左に戻る、中央にタイトル、右に操作を置く */
export function header(title: string, opts: { back?: string; action?: Node } = {}): HTMLElement {
  return h(
    'header',
    null,
    h(
      'nav',
      null,
      h('ul', null, h('li', null, opts.back && h('a', { href: opts.back }, '戻る'))),
      h('ul', null, h('li', null, h('strong', null, title))),
      h('ul', null, h('li', null, opts.action)),
    ),
  );
}

let toastTimer: number | undefined;

export function toast(message: string): void {
  let el = document.getElementById('toast');
  if (!el) {
    el = h('output', { id: 'toast' });
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

/** 選択肢のダイアログ。run はタップの中で同期的に呼ぶので、ファイル選択や共有シートも開ける */
export function actionSheet(message: string | null, actions: SheetAction[], onCancel?: () => void): void {
  const close = () => {
    window.removeEventListener('hashchange', cancel);
    dialog.close();
    dialog.remove();
  };
  const cancel = () => {
    close();
    onCancel?.();
  };
  const dialog = h(
    'dialog',
    {
      // 枠の外（背景）をタップしたら閉じる
      onclick: (e: Event) => e.target === dialog && cancel(),
      oncancel: (e: Event) => {
        e.preventDefault();
        cancel();
      },
    },
    h(
      'article',
      null,
      message && h('p', null, message),
      actions.map((a) =>
        h(
          'button',
          {
            class: a.kind === 'primary' ? null : 'secondary',
            'data-danger': a.kind === 'danger',
            onclick: () => {
              close();
              a.run();
            },
          },
          a.label,
        ),
      ),
      h('button', { class: 'secondary', onclick: cancel }, 'キャンセル'),
    ),
  );
  window.addEventListener('hashchange', cancel);
  document.body.append(dialog);
  dialog.showModal();
}
