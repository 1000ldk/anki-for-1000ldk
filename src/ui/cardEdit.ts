import { createCard, deleteCard, getCard, getDeck, updateCardText } from '../store';
import { h, header, navigate, toast } from './dom';

/** cardId が null なら新規作成。保存後も続けて次のカードを追加できる */
export async function renderCardEdit(root: HTMLElement, deckId: string, cardId: string | null): Promise<void> {
  const deck = await getDeck(deckId);
  const card = cardId ? await getCard(cardId) : undefined;
  const back = `#/deck/${deckId}`;
  if (!deck || (cardId && !card)) {
    root.replaceChildren(header('カード', { back }), h('main', { class: 'page' }, h('p', { class: 'empty' }, 'カードが見つかりません')));
    return;
  }

  const frontEl = h('textarea', { id: 'front', rows: 4, required: true, placeholder: '問題', value: card?.front ?? '' });
  const backEl = h('textarea', { id: 'back', rows: 4, required: true, placeholder: '答え', value: card?.back ?? '' });

  const save = async (e: Event) => {
    e.preventDefault();
    const front = frontEl.value.trim();
    const backText = backEl.value.trim();
    if (!front || !backText) {
      toast('表と裏の両方を入力してください');
      return;
    }
    if (card) {
      await updateCardText(card.id, front, backText);
      toast('保存しました');
      navigate(back);
    } else {
      await createCard(deckId, front, backText);
      toast('追加しました。続けて入力できます');
      frontEl.value = '';
      backEl.value = '';
      frontEl.focus();
    }
  };

  const remove = async () => {
    if (!card || !confirm('このカードを削除します。よろしいですか？')) return;
    await deleteCard(card.id);
    toast('削除しました');
    navigate(back);
  };

  root.replaceChildren(
    header(card ? 'カードを編集' : 'カードを追加', { back }),
    h(
      'main',
      { class: 'page' },
      h(
        'form',
        { class: 'card-form', onsubmit: save },
        h('label', { for: 'front' }, '表'),
        frontEl,
        h('label', { for: 'back' }, '裏'),
        backEl,
        h('button', { class: 'btn primary block', type: 'submit' }, card ? '保存' : '追加して次へ'),
      ),
      card && h('div', { class: 'danger-zone' }, h('button', { class: 'btn danger', onclick: remove }, 'カードを削除')),
    ),
  );
  if (!card) frontEl.focus();
}
