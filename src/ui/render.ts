import { parseMarkdown, type Block, type Inline } from '../markdown';
import { getMedia } from '../media';
import { h } from './dom';

export interface MediaEntry {
  url: string;
  width: number;
  height: number;
}

/**
 * 画像IDからオブジェクトURLを作って使い回す。
 * 画面から外れた画像は retain() / dispose() で URL.revokeObjectURL して解放する。
 */
export class MediaUrls {
  private entries = new Map<string, Promise<MediaEntry | null>>();

  load(id: string): Promise<MediaEntry | null> {
    let p = this.entries.get(id);
    if (!p) {
      p = getMedia(id)
        .then((m) => (m ? { url: URL.createObjectURL(m.blob), width: m.width, height: m.height } : null))
        .catch(() => null);
      this.entries.set(id, p);
    }
    return p;
  }

  /** 先読み：IndexedDB から読み、画像のデコードまで済ませておく */
  async preload(ids: Iterable<string>): Promise<void> {
    await Promise.all(
      [...ids].map(async (id) => {
        const e = await this.load(id);
        if (!e) return;
        const img = new Image();
        img.src = e.url;
        await img.decode().catch(() => {});
      }),
    );
  }

  /** ids 以外の URL を解放する */
  retain(ids: Iterable<string>): void {
    const keep = new Set(ids);
    for (const [id, p] of this.entries) {
      if (keep.has(id)) continue;
      this.entries.delete(id);
      p.then((e) => e && URL.revokeObjectURL(e.url));
    }
  }

  dispose(): void {
    this.retain([]);
  }
}

const MEDIA_SRC = /^media:([0-9a-zA-Z-]+)$/;

export interface RenderOptions {
  /** 編集画面のプレビュー用に小さく表示する */
  thumbnail?: boolean;
  /** 画像をタップしたとき。index は本文中で何番目の画像か */
  onImageTap?: (e: MouseEvent, entry: MediaEntry, id: string, index: number) => void;
  /** 画像を長押ししたとき */
  onImageHold?: (id: string, index: number) => void;
}

/**
 * カード本文（Markdown）を DOM にする。画像は先に保存済みの幅・高さを読み込み、
 * 表示前に領域を確保してレイアウトがずれないようにする。
 */
export async function renderMarkdown(text: string, urls: MediaUrls, opts: RenderOptions = {}): Promise<DocumentFragment> {
  const blocks = parseMarkdown(text);
  const ids = collectImageIds(blocks);
  const entries = new Map(await Promise.all(ids.map(async (id) => [id, await urls.load(id)] as const)));
  let index = 0;

  const image = (node: Extract<Inline, { type: 'image' }>): Node => {
    const i = index++;
    const id = MEDIA_SRC.exec(node.src)?.[1];
    const entry = id ? entries.get(id) : null;
    if (!id || !entry) {
      return h('span', { class: `media missing${opts.thumbnail ? ' thumb' : ''}`, role: 'img' }, '画像が見つかりません');
    }
    const img = h('img', {
      class: `media${opts.thumbnail ? ' thumb' : ''}`,
      src: entry.url,
      alt: node.alt,
      width: entry.width,
      height: entry.height,
      draggable: 'false',
      style: `aspect-ratio: ${entry.width} / ${entry.height}; --w: ${entry.width}px; --ratio: ${entry.width / entry.height}`,
    });
    if (opts.onImageTap) {
      img.addEventListener('click', (e) => opts.onImageTap!(e, entry, id, i));
    }
    if (opts.onImageHold) onLongPress(img, () => opts.onImageHold!(id, i));
    return img;
  };

  const inline = (nodes: Inline[]): Node[] =>
    nodes.map((n) => {
      switch (n.type) {
        case 'text':
          return document.createTextNode(n.text);
        case 'strong':
          return h('strong', null, inline(n.children));
        case 'em':
          return h('em', null, inline(n.children));
        case 'code':
          return h('code', null, n.text);
        case 'image':
          return image(n);
      }
    });

  const frag = document.createDocumentFragment();
  for (const b of blocks) {
    if (b.type === 'images') frag.append(h('p', null, b.images.map(image)));
    else frag.append(h('p', null, inline(b.inlines)));
  }
  return frag;
}

function collectImageIds(blocks: Block[]): string[] {
  const ids = new Set<string>();
  const walk = (nodes: Inline[]) => {
    for (const n of nodes) {
      if (n.type === 'image') {
        const id = MEDIA_SRC.exec(n.src)?.[1];
        if (id) ids.add(id);
      } else if (n.type === 'strong' || n.type === 'em') walk(n.children);
    }
  };
  for (const b of blocks) walk(b.type === 'images' ? b.images : b.inlines);
  return [...ids];
}

/** 長押し（500ms）を検出する。iOS の標準メニュー（画像の保存など）は CSS で抑える */
export function onLongPress(el: HTMLElement, run: () => void): void {
  let timer: number | undefined;
  let start: { x: number; y: number } | null = null;
  let fired = false;
  const cancel = () => {
    clearTimeout(timer);
    start = null;
  };
  el.addEventListener('pointerdown', (e) => {
    fired = false;
    start = { x: e.clientX, y: e.clientY };
    timer = window.setTimeout(() => {
      fired = true;
      run();
    }, 500);
  });
  el.addEventListener('pointermove', (e) => {
    if (start && Math.hypot(e.clientX - start.x, e.clientY - start.y) > 10) cancel();
  });
  el.addEventListener('pointerup', cancel);
  el.addEventListener('pointercancel', cancel);
  el.addEventListener('contextmenu', (e) => e.preventDefault());
  // 長押しの後のクリック（タップ扱い）は無視する
  el.addEventListener('click', (e) => {
    if (fired) {
      e.stopImmediatePropagation();
      e.preventDefault();
      fired = false;
    }
  }, { capture: true });
}

/** 画像の全画面表示（<dialog>）。ピンチで拡大、1本指で移動、タップで閉じる */
export function openImageViewer(entry: MediaEntry, alt = ''): void {
  const img = h('img', { src: entry.url, alt, draggable: 'false' });
  const overlay = h('dialog', { class: 'viewer', 'aria-label': '画像の拡大表示' }, img, h('button', { class: 'secondary' }, '閉じる'));

  // 画面座標 = t + s × 画像内の座標（transform-origin は左上）
  let s = 1;
  let tx = 0;
  let ty = 0;
  const pointers = new Map<number, { x: number; y: number }>();
  let gesture: { s: number; tx: number; ty: number; cx: number; cy: number; dist: number } | null = null;
  let moved = false;
  let pinched = false;

  const apply = () => {
    img.style.transform = `translate(${tx}px, ${ty}px) scale(${s})`;
  };
  const center = () => {
    const ps = [...pointers.values()];
    const cx = ps.reduce((n, p) => n + p.x, 0) / ps.length;
    const cy = ps.reduce((n, p) => n + p.y, 0) / ps.length;
    const dist = ps.length > 1 ? Math.hypot(ps[0].x - ps[1].x, ps[0].y - ps[1].y) : 0;
    return { cx, cy, dist };
  };
  const begin = () => {
    gesture = pointers.size ? { s, tx, ty, ...center() } : null;
  };

  overlay.addEventListener('pointerdown', (e) => {
    overlay.setPointerCapture(e.pointerId);
    if (pointers.size === 0) {
      moved = false;
      pinched = false;
    }
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size > 1) pinched = true;
    begin();
  });
  overlay.addEventListener('pointermove', (e) => {
    if (!pointers.has(e.pointerId) || !gesture) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const c = center();
    if (Math.hypot(c.cx - gesture.cx, c.cy - gesture.cy) > 8 || pointers.size > 1) moved = true;
    const nextS = pointers.size > 1 && gesture.dist > 0 ? Math.min(6, Math.max(1, (gesture.s * c.dist) / gesture.dist)) : gesture.s;
    if (nextS === 1 && pointers.size === 1) return; // 等倍のときは動かさない
    // ジェスチャー開始時に指の下にあった点が、指の下に留まるようにする
    const px = (gesture.cx - gesture.tx) / gesture.s;
    const py = (gesture.cy - gesture.ty) / gesture.s;
    s = nextS;
    tx = c.cx - s * px;
    ty = c.cy - s * py;
    apply();
  });
  const up = (e: PointerEvent) => {
    if (!pointers.delete(e.pointerId)) return;
    if (s <= 1.01) {
      s = 1;
      tx = 0;
      ty = 0;
      apply();
    }
    begin();
    if (pointers.size === 0 && !moved && !pinched && e.type === 'pointerup') close();
  };
  overlay.addEventListener('pointerup', up);
  overlay.addEventListener('pointercancel', up);

  // 表示中は学習画面のキー操作（Space で答えを表示など）を止める
  const onKey = (e: KeyboardEvent) => {
    e.stopPropagation();
    if (e.key === 'Escape') close();
  };
  let closed = false;
  function close() {
    if (closed) return;
    closed = true;
    document.removeEventListener('keydown', onKey, true);
    window.removeEventListener('hashchange', close);
    overlay.close();
    overlay.remove();
  }
  overlay.addEventListener('cancel', (e) => {
    e.preventDefault();
    close();
  });
  document.addEventListener('keydown', onKey, true);
  window.addEventListener('hashchange', close);
  document.body.append(overlay);
  overlay.showModal();
}
