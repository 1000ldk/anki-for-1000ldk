import { STORAGE_WARN_RATIO, storageEstimate } from '../media';
import { DAY } from '../scheduler';
import { createDeck, getDeckQueue, getSettings, listDecks } from '../store';
import { h, header, navigate } from './dom';

export const BACKUP_REMIND_DAYS = 7;

export async function renderHome(root: HTMLElement): Promise<void> {
  const now = Date.now();
  const [settings, decks, storage] = await Promise.all([getSettings(), listDecks(), storageEstimate()]);
  const queues = await Promise.all(decks.map((d) => getDeckQueue(d, now, settings.dayStartHour)));

  const addDeck = async () => {
    const name = prompt('新しいデッキの名前')?.trim();
    if (!name) return;
    const deck = await createDeck(name);
    navigate(`#/deck/${deck.id}`);
  };

  const needsBackup =
    decks.length > 0 && (settings.lastBackupAt === null || now - settings.lastBackupAt >= BACKUP_REMIND_DAYS * DAY);

  const storageRatio = storage ? storage.usage / storage.quota : 0;

  const totalDue = queues.reduce((n, q) => n + q.learning.length + q.review.length + q.fresh.length, 0);

  root.replaceChildren(
    header('デッキ', { action: h('a', { class: 'topbar-action', href: '#/settings', 'aria-label': '設定' }, '⚙︎') }),
    h(
      'main',
      { class: 'page' },
      storageRatio > STORAGE_WARN_RATIO &&
        h(
          'a',
          { class: 'notice', href: '#/settings' },
          `保存容量の${Math.round(storageRatio * 100)}%を使っています。バックアップを書き出し、不要な画像を整理してください`,
        ),
      needsBackup &&
        h(
          'a',
          { class: 'notice', href: '#/settings' },
          settings.lastBackupAt === null
            ? 'まだバックアップがありません。設定から書き出してください'
            : `最後のバックアップから${Math.floor((now - settings.lastBackupAt) / DAY)}日経っています。書き出しておきましょう`,
        ),
      decks.length > 0 && h('p', { class: 'summary' }, totalDue ? `今日の残り ${totalDue} 枚` : '今日の学習は完了です'),
      decks.length === 0
        ? h('p', { class: 'empty' }, 'デッキがありません。下のボタンから作成してください。')
        : h(
            'ul',
            { class: 'deck-list' },
            decks.map((deck, i) => {
              const q = queues[i];
              const learn = q.learning.length;
              const due = learn + q.review.length + q.fresh.length;
              return h(
                'li',
                null,
                h(
                  'button',
                  {
                    class: 'deck-row',
                    disabled: due === 0,
                    onclick: () => navigate(`#/study/${deck.id}`),
                  },
                  h('span', { class: 'deck-name' }, deck.name),
                  h(
                    'span',
                    { class: 'counts' },
                    h('span', { class: 'count new', title: '新規' }, q.fresh.length),
                    h('span', { class: 'count learn', title: '学習中' }, learn),
                    h('span', { class: 'count review', title: '復習' }, q.review.length),
                  ),
                ),
                h('a', { class: 'deck-edit', href: `#/deck/${deck.id}`, 'aria-label': `${deck.name}のカード一覧` }, '›'),
              );
            }),
          ),
      h('button', { class: 'btn primary block', onclick: addDeck }, '＋ デッキを作成'),
      decks.length > 0 &&
        h(
          'p',
          { class: 'legend' },
          h('span', { class: 'count new' }, '新規'),
          h('span', { class: 'count learn' }, '学習中'),
          h('span', { class: 'count review' }, '復習'),
        ),
    ),
  );
}
