import { nextDayStart } from '../day';
import { extractMediaIds } from '../media';
import { formatDelay, previewDelays } from '../scheduler';
import { LEARN_AHEAD_MS, StudySession } from '../session';
import { answerCard, getDeck, getDeckQueue, getSettings } from '../store';
import { RATING_LABELS, type Card, type Rating } from '../types';
import { h, header, toast } from './dom';
import { MediaUrls, openImageViewer, renderMarkdown } from './render';

const cardMediaIds = (cards: readonly Card[]) => cards.flatMap((c) => [...extractMediaIds(c.front), ...extractMediaIds(c.back)]);

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
  /** 描画の世代。非同期の描画中に次の表示が始まったら古い結果は捨てる */
  let renderToken = 0;
  const urls = new MediaUrls();

  const face = async (text: string, side: 'front' | 'back') => {
    const el = h('div', { class: `face ${side}` });
    el.append(
      await renderMarkdown(text, urls, {
        onImageTap: (e, entry) => {
          // 表面のタップ（答えを表示）にしない
          e.stopPropagation();
          openImageViewer(entry);
        },
      }),
    );
    return el;
  };

  /** 表示中のカードの裏面と、次に出そうなカードの画像を先読みし、それ以外の画像のURLは解放する */
  const prefetch = (card: Card) => {
    const next = session.upcoming(card, 2);
    urls.retain(cardMediaIds([card, ...next, ...session.learningCards()]));
    urls.preload(cardMediaIds([card, ...next])).catch(() => {});
  };

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

  async function show() {
    clearTimeout(waitTimer);
    const token = ++renderToken;
    const t = Date.now();
    current = session.next(t);
    revealed = false;
    renderCounts();

    if (!current) {
      urls.retain(cardMediaIds(session.learningCards()));
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

    const card = current;
    const front = await face(card.front, 'front');
    if (token !== renderToken) return;
    cardEl.replaceChildren(front);
    cardEl.scrollTop = 0;
    cardEl.onclick = reveal;
    actionsEl.replaceChildren(h('button', { class: 'btn primary block reveal', onclick: reveal }, '答えを表示'));
    prefetch(card);
  }

  async function reveal() {
    if (!current || revealed) return;
    revealed = true;
    const card = current;
    const token = ++renderToken;
    cardEl.onclick = null;
    const [front, back] = await Promise.all([face(card.front, 'front'), face(card.back, 'back')]);
    if (token !== renderToken) return;
    cardEl.replaceChildren(front, h('hr', { class: 'divider' }), back);
    const delays = previewDelays(card, Date.now());
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

  await show();

  return () => {
    clearTimeout(waitTimer);
    renderToken++;
    document.removeEventListener('keydown', onKey);
    urls.dispose();
  };
}
