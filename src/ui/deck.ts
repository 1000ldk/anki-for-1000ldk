import { toPlainText } from '../markdown';
import { deleteDeck, getDeck, listCards, updateDeck } from '../store';
import type { Card } from '../types';
import { h, header, navigate, toast } from './dom';

const STATE_LABELS: Record<Card['state'], string> = {
  new: '新規',
  learning: '学習中',
  relearning: '再学習',
  review: '復習',
};

export async function renderDeck(root: HTMLElement, deckId: string): Promise<void> {
  const deck = await getDeck(deckId);
  if (!deck) {
    root.replaceChildren(header('デッキ', { back: '#/' }), h('main', { class: 'container' }, h('p', null, 'デッキが見つかりません')));
    return;
  }
  const cards = await listCards(deckId);
  // 一覧と検索は、画像を「[画像]」に置き換えた文字列で行う
  const plain = new Map(cards.map((c) => [c.id, { front: toPlainText(c.front), back: toPlainText(c.back) }]));
  const listEl = h('section', null);
  const countEl = h('small', null);

  const renderList = (query: string) => {
    const q = query.trim().toLowerCase();
    const hits = q
      ? cards.filter((c) => {
          const p = plain.get(c.id)!;
          return p.front.toLowerCase().includes(q) || p.back.toLowerCase().includes(q);
        })
      : cards;
    countEl.textContent = q ? `${hits.length} / ${cards.length} 枚` : `${cards.length} 枚`;
    listEl.replaceChildren(
      ...hits.map((c) =>
        h(
          'a',
          { href: `#/deck/${deckId}/card/${c.id}` },
          h('article', null, h('strong', null, plain.get(c.id)!.front), h('small', null, `${STATE_LABELS[c.state]} ・ ${plain.get(c.id)!.back}`)),
        ),
      ),
    );
  };

  const rename = async () => {
    const name = prompt('デッキ名', deck.name)?.trim();
    if (!name || name === deck.name) return;
    await updateDeck(deckId, { name });
    toast('名前を変更しました');
    navigate(location.hash);
  };

  const remove = async () => {
    if (!confirm(`「${deck.name}」とカード${cards.length}枚を削除します。元に戻せません。よろしいですか？`)) return;
    await deleteDeck(deckId);
    toast('デッキを削除しました');
    navigate('#/');
  };

  root.replaceChildren(
    header(deck.name, { back: '#/' }),
    h(
      'main',
      { class: 'container' },
      h('a', { role: 'button', href: `#/deck/${deckId}/card/new` }, 'カードを追加'),
      h('input', {
        type: 'search',
        'aria-label': 'カードを検索',
        placeholder: '表・裏のテキストで検索',
        oninput: (e: Event) => renderList((e.target as HTMLInputElement).value),
      }),
      h('p', null, countEl),
      listEl,
      h(
        'footer',
        null,
        h(
          'div',
          { role: 'group' },
          h('button', { class: 'secondary', onclick: rename }, 'デッキ名を変更'),
          h('button', { class: 'secondary', 'data-danger': true, onclick: remove }, 'デッキを削除'),
        ),
      ),
    ),
  );
  renderList('');
}
