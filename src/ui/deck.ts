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
    root.replaceChildren(header('デッキ', { back: '#/' }), h('main', { class: 'page' }, h('p', { class: 'empty' }, 'デッキが見つかりません')));
    return;
  }
  const cards = await listCards(deckId);
  const listEl = h('ul', { class: 'card-list' });
  const countEl = h('p', { class: 'summary' });

  const renderList = (query: string) => {
    const q = query.trim().toLowerCase();
    const hits = q ? cards.filter((c) => c.front.toLowerCase().includes(q) || c.back.toLowerCase().includes(q)) : cards;
    countEl.textContent = q ? `${hits.length} / ${cards.length} 枚` : `${cards.length} 枚`;
    listEl.replaceChildren(
      ...hits.map((c) =>
        h(
          'li',
          null,
          h(
            'a',
            { class: 'card-row', href: `#/deck/${deckId}/card/${c.id}` },
            h('span', { class: 'card-front' }, c.front),
            h('span', { class: 'card-back' }, c.back),
            h('span', { class: `badge ${c.state}` }, STATE_LABELS[c.state]),
          ),
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
      { class: 'page' },
      h('a', { class: 'btn primary block', href: `#/deck/${deckId}/card/new` }, '＋ カードを追加'),
      h('input', {
        class: 'search',
        type: 'search',
        placeholder: '表・裏のテキストで検索',
        oninput: (e: Event) => renderList((e.target as HTMLInputElement).value),
      }),
      countEl,
      listEl,
      h(
        'div',
        { class: 'danger-zone' },
        h('button', { class: 'btn', onclick: rename }, 'デッキ名を変更'),
        h('button', { class: 'btn danger', onclick: remove }, 'デッキを削除'),
      ),
    ),
  );
  renderList('');
}
