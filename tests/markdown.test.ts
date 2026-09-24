import { describe, expect, it } from 'vitest';
import { findImages, parseInline, parseMarkdown, toPlainText } from '../src/markdown';

describe('Markdown', () => {
  it('画像だけの行は画像ブロック、それ以外は改行を保ったテキストになる', () => {
    expect(parseMarkdown('次の構造式の名前は？\n\n![](media:abc-1)\n![図](media:def-2)\n補足\n2行目')).toEqual([
      { type: 'text', inlines: [{ type: 'text', text: '次の構造式の名前は？' }] },
      {
        type: 'images',
        images: [
          { type: 'image', alt: '', src: 'media:abc-1' },
          { type: 'image', alt: '図', src: 'media:def-2' },
        ],
      },
      { type: 'text', inlines: [{ type: 'text', text: '補足\n2行目' }] },
    ]);
  });

  it('プレーンテキストのカードはそのまま1つのテキストになる', () => {
    expect(parseMarkdown('apple\nりんご')).toEqual([{ type: 'text', inlines: [{ type: 'text', text: 'apple\nりんご' }] }]);
    expect(parseMarkdown('')).toEqual([]);
  });

  it('太字・斜体・コード・エスケープ', () => {
    expect(parseInline('**強調** と *斜体* と `x=1`')).toEqual([
      { type: 'strong', children: [{ type: 'text', text: '強調' }] },
      { type: 'text', text: ' と ' },
      { type: 'em', children: [{ type: 'text', text: '斜体' }] },
      { type: 'text', text: ' と ' },
      { type: 'code', text: 'x=1' },
    ]);
    expect(parseInline('\\*そのまま\\*')).toEqual([{ type: 'text', text: '*そのまま*' }]);
  });

  it('掛け算などの * は強調にしない', () => {
    expect(parseInline('2 * 3 * 4')).toEqual([{ type: 'text', text: '2 * 3 * 4' }]);
    expect(parseInline('a*b')).toEqual([{ type: 'text', text: 'a*b' }]);
  });

  it('文中の画像も画像になる', () => {
    expect(parseMarkdown('答えは ![](media:x) です')).toEqual([
      {
        type: 'text',
        inlines: [
          { type: 'text', text: '答えは ' },
          { type: 'image', alt: '', src: 'media:x' },
          { type: 'text', text: ' です' },
        ],
      },
    ]);
  });

  it('一覧用のプレーンテキスト', () => {
    expect(toPlainText('問題 **太字**\n\n![](media:a)\n![](media:b)')).toBe('問題 太字 [画像] [画像]');
  });

  it('findImages は出現順に位置を返す', () => {
    const text = 'a\n![](media:1)\nb ![x](media:2)';
    const found = findImages(text);
    expect(found.map((f) => f.src)).toEqual(['media:1', 'media:2']);
    expect(text.slice(found[1].start, found[1].end)).toBe('![x](media:2)');
  });
});
