import { beforeEach, describe, expect, it } from 'vitest';
import { collectBackup, importBackup, parseBackup, pickNewer } from '../src/backup';
import { AppDB, db, useDatabase } from '../src/db';
import { nextDayStart } from '../src/day';
import { DAY, MINUTE } from '../src/scheduler';
import { StudySession } from '../src/session';
import { answerCard, createCard, createDeck, deleteDeck, getDeckQueue, updateDeck } from '../src/store';

const HOUR4 = 4;
const NOW = new Date(2026, 8, 24, 12, 0).getTime();
const noFuzz = () => 0.5;

let n = 0;
beforeEach(() => {
  useDatabase(new AppDB(`test-${n++}`));
});

describe('学習キュー', () => {
  it('新規カードは1日の上限まで、作成順に出る', async () => {
    const deck = await createDeck('英単語', NOW);
    await updateDeck(deck.id, { newPerDay: 2 });
    for (let i = 0; i < 5; i++) await createCard(deck.id, `q${i}`, `a${i}`, NOW - 1000 + i);
    const d = (await db.decks.get(deck.id))!;

    let q = await getDeckQueue(d, NOW, HOUR4);
    expect(q.fresh.map((c) => c.front)).toEqual(['q0', 'q1']);

    // 1枚学習すると残り上限が1になる
    await answerCard(q.fresh[0], 3, NOW + 1000, noFuzz);
    q = await getDeckQueue(d, NOW + 2000, HOUR4);
    expect(q.newRemaining).toBe(1);
    expect(q.fresh.map((c) => c.front)).toEqual(['q1']);
    expect(q.learning.map((c) => c.front)).toEqual(['q0']);

    // 翌日（切り替わり時刻以降）は上限が戻る
    q = await getDeckQueue(d, nextDayStart(NOW, HOUR4) + 1000, HOUR4);
    expect(q.newRemaining).toBe(2);
  });

  it('評価でカード更新とReviewLog追記が行われる', async () => {
    const deck = await createDeck('d', NOW);
    const card = await createCard(deck.id, 'q', 'a', NOW);
    const updated = await answerCard(card, 4, NOW, noFuzz);
    expect(updated.state).toBe('review');
    expect(await db.cards.get(card.id)).toEqual(updated);
    const logs = await db.reviewLogs.toArray();
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({ cardId: card.id, deckId: deck.id, rating: 4, prevState: 'new', prevInterval: 0, newInterval: 4 });
  });

  it('期限が明日以降の復習カードは出ない', async () => {
    const deck = await createDeck('d', NOW);
    const card = await createCard(deck.id, 'q', 'a', NOW);
    await answerCard(card, 4, NOW, noFuzz); // 4日後
    const q = await getDeckQueue((await db.decks.get(deck.id))!, NOW + DAY, HOUR4);
    expect(q.review).toHaveLength(0);
    const later = await getDeckQueue((await db.decks.get(deck.id))!, NOW + 4 * DAY, HOUR4);
    expect(later.review).toHaveLength(1);
  });

  it('デッキ削除でカードとログも消える', async () => {
    const deck = await createDeck('d', NOW);
    const card = await createCard(deck.id, 'q', 'a', NOW);
    await answerCard(card, 3, NOW);
    await deleteDeck(deck.id);
    expect(await db.cards.count()).toBe(0);
    expect(await db.reviewLogs.count()).toBe(0);
  });
});

describe('学習セッション', () => {
  it('学習中カードは期限が来たら優先、他が無ければ先取りする', async () => {
    const deck = await createDeck('d', NOW);
    await createCard(deck.id, 'A', 'a', NOW - 2);
    await createCard(deck.id, 'B', 'b', NOW - 1);
    const d = (await db.decks.get(deck.id))!;
    const s = new StudySession(await getDeckQueue(d, NOW, HOUR4), nextDayStart(NOW, HOUR4));

    const a = s.next(NOW)!;
    expect(a.front).toBe('A');
    s.update(await answerCard(a, 1, NOW, noFuzz)); // Aは1分後
    expect(s.next(NOW)!.front).toBe('B');
    s.update(await answerCard(s.next(NOW)!, 3, NOW, noFuzz)); // Bは10分後
    // 新規が尽きたので、20分以内に来る学習中カードを先取り
    expect(s.next(NOW)!.front).toBe('A');
    expect(s.counts()).toEqual({ learning: 2, review: 0, fresh: 0 });

    // 卒業させるとセッションから消える
    s.update(await answerCard(s.next(NOW)!, 4, NOW + MINUTE, noFuzz));
    s.update(await answerCard(s.next(NOW)!, 4, NOW + MINUTE, noFuzz));
    expect(s.isFinished()).toBe(true);
    expect(s.next(NOW)).toBeNull();
  });
});

describe('バックアップ', () => {
  it('書き出して全置換で読み込むと元に戻る', async () => {
    const deck = await createDeck('d', NOW);
    const card = await createCard(deck.id, 'q', 'a', NOW);
    await answerCard(card, 3, NOW);
    const backup = parseBackup(JSON.stringify(await collectBackup(NOW)));

    await deleteDeck(deck.id);
    await createDeck('別', NOW);
    await importBackup(backup, 'replace');

    const after = await collectBackup(NOW);
    expect(after.decks).toEqual(backup.decks);
    expect(after.cards).toEqual(backup.cards);
    expect(after.reviewLogs).toEqual(backup.reviewLogs);
  });

  it('マージはIDが同じなら更新日時が新しい方を残す', async () => {
    const deck = await createDeck('d', NOW);
    const card = await createCard(deck.id, 'old', 'a', NOW);
    const backup = await collectBackup(NOW);
    backup.cards[0] = { ...backup.cards[0], front: 'newer', updatedAt: NOW + 10 };
    backup.cards.push({ ...backup.cards[0], id: 'other', front: 'added' });

    const r = await importBackup(backup, 'merge');
    expect(r.cards).toBe(2);
    expect((await db.cards.get(card.id))!.front).toBe('newer');
    expect(await db.cards.count()).toBe(2);

    // 古い方は上書きしない
    backup.cards[0] = { ...backup.cards[0], front: 'stale', updatedAt: NOW - 10 };
    await importBackup(backup, 'merge');
    expect((await db.cards.get(card.id))!.front).toBe('newer');
  });

  it('pickNewer', () => {
    const existing = new Map([['a', { id: 'a', updatedAt: 5 }]]);
    expect(pickNewer(existing, [{ id: 'a', updatedAt: 5 }, { id: 'a', updatedAt: 6 }, { id: 'b', updatedAt: 1 }])).toEqual([
      { id: 'a', updatedAt: 6 },
      { id: 'b', updatedAt: 1 },
    ]);
  });

  it('不正なファイルは読み込まない', () => {
    expect(() => parseBackup('not json')).toThrow('JSON');
    expect(() => parseBackup('{}')).toThrow('schemaVersion');
    expect(() => parseBackup('{"schemaVersion":99,"decks":[],"cards":[],"reviewLogs":[]}')).toThrow('新しい形式');
  });
});
