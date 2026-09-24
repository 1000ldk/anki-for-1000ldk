import { nextDayStart } from '../day';
import { formatDelay, previewDelays } from '../scheduler';
import { LEARN_AHEAD_MS, StudySession } from '../session';
import { answerCard, getDeck, getDeckQueue, getSettings } from '../store';
import { RATING_LABELS, type Card, type Rating } from '../types';
import { h, header, toast } from './dom';

export async function renderStudy(root: HTMLElement, deckId: string): Promise<() => void> {
  const deck = await getDeck(deckId);
  if (!deck) {
    root.replaceChildren(header('学習', { back: '#/' }), h('main', { class: 'page' }, h('p', { class: 'empty' }, 'デッキが見つかりません')));
    return () => {};
  }
  const settings = await getSettings();
  const now = Date.now();
  const session = new StudySession(await getDeckQueue(deck, now, settings.dayStartHour), nextDayStart(now, settings.dayStartHour));

  let current: Card | null = null;
  let revealed = false;
  let busy = false;
  let waitTimer: number | undefined;

  const countsEl = h('div', { class: 'study-counts' });
  const cardEl = h('section', { class: 'study-card', 'aria-live': 'polite' });
  const actionsEl = h('div', { class: 'study-actions' });

  root.replaceChildren(
    header(deck.name, { back: '#/' }),
    h('main', { class: 'study' }, countsEl, cardEl, actionsEl),
  );

  function renderCounts() {
    const c = session.counts();
    const is = (card: Card | null, kind: 'new' | 'learn' | 'review') =>
      card && (kind === 'new' ? card.state === 'new' : kind === 'review' ? card.state === 'review' : card.state === 'learning' || card.state === 'relearning');
    countsEl.replaceChildren(
      h('span', { class: `count new ${is(current, 'new') ? 'active' : ''}` }, c.fresh),
      h('span', { class: `count learn ${is(current, 'learn') ? 'active' : ''}` }, c.learning),
      h('span', { class: `count review ${is(current, 'review') ? 'active' : ''}` }, c.review),
    );
  }

  function show() {
    clearTimeout(waitTimer);
    const t = Date.now();
    current = session.next(t);
    revealed = false;
    renderCounts();

    if (!current) {
      const due = session.nextLearningDue();
      if (due === null || session.isFinished()) {
        cardEl.replaceChildren(h('div', { class: 'done' }, h('p', { class: 'done-title' }, 'おつかれさまでした'), h('p', null, 'このデッキの今日の学習は完了です。')));
        actionsEl.replaceChildren(h('a', { class: 'btn primary block', href: '#/' }, 'ホームへ戻る'));
      } else {
        const at = new Date(due).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' });
        cardEl.replaceChildren(h('div', { class: 'done' }, h('p', { class: 'done-title' }, 'ひと休み'), h('p', null, `学習中のカードが ${at} ごろに再出題されます。`)));
        actionsEl.replaceChildren(h('a', { class: 'btn block', href: '#/' }, 'ホームへ戻る'));
        waitTimer = window.setTimeout(show, Math.max(1000, due - LEARN_AHEAD_MS - Date.now()));
      }
      return;
    }

    cardEl.replaceChildren(h('div', { class: 'face front' }, current.front));
    cardEl.onclick = reveal;
    actionsEl.replaceChildren(h('button', { class: 'btn primary block reveal', onclick: reveal }, '答えを表示'));
  }

  function reveal() {
    if (!current || revealed) return;
    revealed = true;
    cardEl.onclick = null;
    cardEl.replaceChildren(
      h('div', { class: 'face front' }, current.front),
      h('hr', { class: 'divider' }),
      h('div', { class: 'face back' }, current.back),
    );
    const delays = previewDelays(current, Date.now());
    actionsEl.replaceChildren(
      h(
        'div',
        { class: 'rating-row' },
        ([1, 2, 3, 4] as Rating[]).map((r) =>
          h(
            'button',
            { class: `btn rating r${r}`, onclick: () => answer(r) },
            h('span', { class: 'rating-delay' }, formatDelay(delays[r])),
            h('span', { class: 'rating-label' }, RATING_LABELS[r]),
          ),
        ),
      ),
    );
  }

  async function answer(rating: Rating) {
    if (!current || !revealed || busy) return;
    busy = true;
    try {
      const updated = await answerCard(current, rating);
      session.update(updated);
      show();
    } catch (e) {
      console.error(e);
      toast('保存に失敗しました。もう一度押してください');
    } finally {
      busy = false;
    }
  }

  const onKey = (e: KeyboardEvent) => {
    if (e.key === ' ' || e.key === 'Enter') {
      if (!revealed) {
        e.preventDefault();
        reveal();
      }
    } else if (revealed && ['1', '2', '3', '4'].includes(e.key)) {
      answer(Number(e.key) as Rating);
    }
  };
  document.addEventListener('keydown', onKey);

  show();

  return () => {
    clearTimeout(waitTimer);
    document.removeEventListener('keydown', onKey);
  };
}
