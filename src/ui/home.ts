import { STORAGE_WARN_RATIO, storageEstimate } from '../media';
import { DAY } from '../scheduler';
import { createDeck, getDeckQueue, getSettings, listDecks, studyStreak } from '../store';
import { h, header, navigate } from './dom';

export const BACKUP_REMIND_DAYS = 7;

export async function renderHome(root: HTMLElement): Promise<void> {
  const now = Date.now();
  const [settings, decks, storage] = await Promise.all([getSettings(), listDecks(), storageEstimate()]);
  const [queues, streak] = await Promise.all([
    Promise.all(decks.map((d) => getDeckQueue(d, now, settings.dayStartHour))),
    studyStreak(now, settings.dayStartHour),
  ]);

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

  const notice = (text: string) => h('article', null, h('p', null, text), h('a', { href: '#/settings' }, '設定を開く'));

  root.replaceChildren(
    header('デッキ', { action: h('a', { href: '#/settings' }, '設定') }),
    h(
      'main',
      { class: 'container' },
      decks.length > 0 &&
        h(
          'section',
          null,
          h('p', null, `連続学習 ${streak}日`, h('br'), h('small', null, totalDue ? `今日の残り ${totalDue}枚` : '今日の学習は完了です')),
          storageRatio > STORAGE_WARN_RATIO &&
            notice(`保存容量の${Math.round(storageRatio * 100)}%を使っています。バックアップを書き出し、不要な画像を整理してください`),
          needsBackup &&
            notice(
              settings.lastBackupAt === null
                ? 'まだバックアップがありません。書き出しておきましょう'
                : `最後のバックアップから${Math.floor((now - settings.lastBackupAt) / DAY)}日経っています。書き出しておきましょう`,
            ),
        ),
      decks.length === 0
        ? h('p', null, 'デッキがありません。下のボタンから作成してください。')
        : h(
            'section',
            null,
            decks.map((deck, i) => {
              const q = queues[i];
              // 学習中（再出題待ち）のカードも復習として数える
              const review = q.learning.length + q.review.length;
              const due = review + q.fresh.length;
              const title = h('hgroup', null, h('h3', null, deck.name), h('p', null, due ? `新規 ${q.fresh.length} ・ 復習 ${review}` : '今日の学習は完了'));
              return h(
                'article',
                null,
                due ? h('a', { href: `#/study/${deck.id}` }, title) : title,
                h('footer', null, h('a', { href: `#/deck/${deck.id}` }, 'カード一覧・編集')),
              );
            }),
          ),
      h('button', { onclick: addDeck }, 'デッキを作成'),
    ),
  );
}
