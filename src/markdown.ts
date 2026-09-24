/**
 * カード本文の Markdown（小さなサブセット）を解析する。
 * DOM を作らない純粋関数にしておき、描画は ui/render.ts で行う。
 *
 * 対応：画像 `![alt](media:<id>)`、太字 `**x**`、斜体 `*x*`、コード `` `x` ``、`\` によるエスケープ。
 * 改行はそのまま改行として扱う（プレーンテキストで作った既存カードの見た目を変えないため）。
 */

export type Inline =
  | { type: 'text'; text: string }
  | { type: 'strong'; children: Inline[] }
  | { type: 'em'; children: Inline[] }
  | { type: 'code'; text: string }
  | { type: 'image'; src: string; alt: string };

export type Block =
  /** 画像だけの行（連続していれば1ブロック） */
  | { type: 'images'; images: Extract<Inline, { type: 'image' }>[] }
  /** それ以外の行のまとまり。text に含まれる改行はそのまま表示する */
  | { type: 'text'; inlines: Inline[] };

const IMAGE_ONLY_LINE = /^\s*(?:!\[[^\]\n]*\]\([^)\s]+\)\s*)+$/;
const IMAGE = /!\[([^\]\n]*)\]\(([^)\s]+)\)/g;
/** 位置を指定して照合する用（IMAGE の lastIndex を書き換えると matchAll に影響するので分ける） */
const IMAGE_AT = /!\[([^\]\n]*)\]\(([^)\s]+)\)/y;

export function parseMarkdown(src: string): Block[] {
  const blocks: Block[] = [];
  let textLines: string[] = [];
  const flushText = () => {
    // 画像行の前後の空行は画像の余白で代わりにするので落とす
    while (textLines.length && !textLines[0].trim()) textLines.shift();
    while (textLines.length && !textLines[textLines.length - 1].trim()) textLines.pop();
    if (textLines.length) blocks.push({ type: 'text', inlines: parseInline(textLines.join('\n')) });
    textLines = [];
  };

  for (const line of src.replace(/\r\n?/g, '\n').split('\n')) {
    if (IMAGE_ONLY_LINE.test(line)) {
      flushText();
      const images = [...line.matchAll(IMAGE)].map((m) => ({ type: 'image' as const, alt: m[1], src: m[2] }));
      const last = blocks[blocks.length - 1];
      if (last?.type === 'images') last.images.push(...images);
      else blocks.push({ type: 'images', images });
    } else {
      textLines.push(line);
    }
  }
  flushText();
  return blocks;
}

export function parseInline(src: string): Inline[] {
  const out: Inline[] = [];
  let text = '';
  const pushText = () => {
    if (text) out.push({ type: 'text', text });
    text = '';
  };

  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    if (ch === '\\' && i + 1 < src.length && /[\\`*_[\]()!#]/.test(src[i + 1])) {
      text += src[i + 1];
      i += 2;
      continue;
    }
    if (ch === '!' && src[i + 1] === '[') {
      IMAGE_AT.lastIndex = i;
      const m = IMAGE_AT.exec(src);
      if (m) {
        pushText();
        out.push({ type: 'image', alt: m[1], src: m[2] });
        i += m[0].length;
        continue;
      }
    }
    if (ch === '`') {
      const end = src.indexOf('`', i + 1);
      if (end > i + 1) {
        pushText();
        out.push({ type: 'code', text: src.slice(i + 1, end) });
        i = end + 1;
        continue;
      }
    }
    if (ch === '*') {
      const strong = src.startsWith('**', i);
      const marker = strong ? '**' : '*';
      const end = findClosing(src, marker, i + marker.length);
      if (end > 0) {
        pushText();
        const children = parseInline(src.slice(i + marker.length, end));
        out.push(strong ? { type: 'strong', children } : { type: 'em', children });
        i = end + marker.length;
        continue;
      }
    }
    text += ch;
    i++;
  }
  pushText();
  return out;
}

/** 強調の閉じ記号を探す。中身が空白で始まる・終わるもの（`2 * 3 * 4` など）は強調にしない */
function findClosing(src: string, marker: string, from: number): number {
  if (from >= src.length || /\s/.test(src[from])) return -1;
  let j = from;
  while (j < src.length) {
    if (src[j] === '\\') {
      j += 2;
      continue;
    }
    if (src[j] === '\n' && src[j + 1] === '\n') return -1;
    if (src.startsWith(marker, j) && j > from && !/\s/.test(src[j - 1])) {
      // `*a**b*` のように * の直後に * が続く場合は太字の記号として扱わない
      if (marker === '*' && src[j + 1] === '*') {
        j += 2;
        continue;
      }
      return j;
    }
    j++;
  }
  return -1;
}

/** 本文中の画像記法の位置（出現順）。描画時の画像の番号と対応する */
export function findImages(src: string): { start: number; end: number; src: string }[] {
  return [...src.matchAll(IMAGE)].map((m) => ({ start: m.index, end: m.index + m[0].length, src: m[2] }));
}

/** 一覧表示用：画像を「[画像]」に置き換え、記号を外した1行の文字列にする */
export function toPlainText(src: string): string {
  const flat = (inlines: Inline[]): string =>
    inlines
      .map((n) => (n.type === 'text' || n.type === 'code' ? n.text : n.type === 'image' ? '[画像]' : flat(n.children)))
      .join('');
  return parseMarkdown(src)
    .map((b) => (b.type === 'images' ? b.images.map(() => '[画像]').join(' ') : flat(b.inlines)))
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}
