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
    root.replaceChildren(header('学習', { back: '#/' }), h('main', { class: 'container' }, h('p', null, 'デッキが見つかりません')));
    return () => {};
  }
  const settings = await getSettings();
  const now = Date.now();
  const session = new StudySession(await getDeckQueue(deck, now, settings.dayStartHour), nextDayStart(now, settings.dayStartHour));

  let current: Card | null = null;
  let revealed = false;
  /** 表示中のカードの描画が終わったか。終わるまで答えは表示しない */
  let ready = false;
  let busy = false;
  let waitTimer: number | undefined;
  /** 描画の世代。非同期の描画中に次の表示が始まったら古い結果は捨てる */
  let renderToken = 0;
  const urls = new MediaUrls();

  const face = async (text: string, side: 'front' | 'back') => {
    const el = h('section', { 'data-face': side });
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

  const countsEl = h('p', null);
  const cardEl = h('article', { 'aria-live': 'polite' });
  const actionsEl = h('footer', null);

  root.replaceChildren(
    header(deck.name, { back: '#/' }),
    h('main', { class: 'container study' }, countsEl, cardEl, actionsEl),
  );

  function renderCounts() {
    const c = session.counts();
    const is = (card: Card | null, kind: 'new' | 'learn' | 'review') =>
      card && (kind === 'new' ? card.state === 'new' : kind === 'review' ? card.state === 'review' : card.state === 'learning' || card.state === 'relearning');
    // 表示中のカードの種類を太字にする
    const count = (label: string, n: number, kind: 'new' | 'learn' | 'review') => (is(current, kind) ? h('strong', null, `${label} ${n}`) : `${label} ${n}`);
    countsEl.replaceChildren(
      h('small', null, count('新規', c.fresh, 'new'), ' ・ ', count('学習中', c.learning, 'learn'), ' ・ ', count('復習', c.review, 'review')),
    );
  }

  async function show() {
    clearTimeout(waitTimer);
    const token = ++renderToken;
    const t = Date.now();
    current = session.next(t);
    revealed = false;
    ready = false;
    renderCounts();

    if (!current) {
      urls.retain(cardMediaIds(session.learningCards()));
      const due = session.nextLearningDue();
      if (due === null || session.isFinished()) {
        cardEl.replaceChildren(h('hgroup', null, h('h2', null, 'おつかれさまでした'), h('p', null, 'このデッキの今日の学習は完了です。')));
        actionsEl.replaceChildren(h('a', { role: 'button', href: '#/' }, 'ホームへ戻る'));
      } else {
        const at = new Date(due).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' });
        cardEl.replaceChildren(h('hgroup', null, h('h2', null, 'ひと休み'), h('p', null, `学習中のカードが ${at} ごろに再出題されます。`)));
        actionsEl.replaceChildren(h('a', { role: 'button', class: 'secondary', href: '#/' }, 'ホームへ戻る'));
        waitTimer = window.setTimeout(show, Math.max(1000, due - LEARN_AHEAD_MS - Date.now()));
      }
      return;
    }

    // 表と裏を先に描画しておき、裏は答えを表示するまで CSS で隠す
    const card = current;
    const [front, back] = await Promise.all([face(card.front, 'front'), face(card.back, 'back')]);
    if (token !== renderToken) return;
    cardEl.removeAttribute('data-revealed');
    cardEl.replaceChildren(front, h('hr'), back);
    window.scrollTo(0, 0);
    cardEl.onclick = reveal;
    ready = true;
    actionsEl.replaceChildren(h('button', { onclick: reveal }, '答えを表示'));
    prefetch(card);
  }

  function reveal() {
    if (!current || revealed || !ready) return;
    revealed = true;
    cardEl.onclick = null;
    cardEl.setAttribute('data-revealed', '');
    const delays = previewDelays(current, Date.now());
    // 「正解」だけをアクセントカラーにする
    actionsEl.replaceChildren(
      ...([1, 2, 3, 4] as Rating[]).map((r) =>
        h('button', { class: r === 3 ? null : 'secondary', onclick: () => answer(r) }, RATING_LABELS[r], h('small', null, formatDelay(delays[r]))),
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
