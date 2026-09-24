import { describe, expect, it } from 'vitest';
import { DAY, MINUTE, formatDelay, previewDelays, schedule } from '../src/scheduler';
import { newCard } from '../src/store';
import type { Card } from '../src/types';

const NOW = new Date(2026, 8, 24, 12, 0).getTime();
const noFuzz = () => 0.5;

function reviewCard(interval: number, ease = 2.5): Card {
  return { ...newCard('d', 'q', 'a', NOW - DAY * 30), state: 'review', interval, ease, reps: 5, due: NOW };
}

describe('新規・学習中のカード', () => {
  it('新規で「正解」なら学習ステップ2（10分）へ', () => {
    const { card } = schedule(newCard('d', 'q', 'a', NOW), 3, NOW, noFuzz);
    expect(card.state).toBe('learning');
    expect(card.step).toBe(1);
    expect(card.due).toBe(NOW + 10 * MINUTE);
    expect(card.reps).toBe(1);
  });

  it('新規で「もう一度」なら1分後', () => {
    const { card } = schedule(newCard('d', 'q', 'a', NOW), 1, NOW, noFuzz);
    expect(card.state).toBe('learning');
    expect(card.step).toBe(0);
    expect(card.due).toBe(NOW + MINUTE);
  });

  it('最初のステップで「難しい」なら1分と10分の平均', () => {
    const { card } = schedule(newCard('d', 'q', 'a', NOW), 2, NOW, noFuzz);
    expect(card.due).toBe(NOW + 5.5 * MINUTE);
  });

  it('最後のステップで「正解」なら復習状態・間隔1日', () => {
    const learning: Card = { ...newCard('d', 'q', 'a', NOW), state: 'learning', step: 1 };
    const { card } = schedule(learning, 3, NOW, noFuzz);
    expect(card.state).toBe('review');
    expect(card.interval).toBe(1);
    expect(card.due).toBe(NOW + DAY);
  });

  it('「簡単」なら即座に復習状態・間隔4日', () => {
    const { card } = schedule(newCard('d', 'q', 'a', NOW), 4, NOW, noFuzz);
    expect(card.state).toBe('review');
    expect(card.interval).toBe(4);
    expect(card.ease).toBe(2.5);
  });
});

describe('復習中のカード', () => {
  it('「正解」は I × E', () => {
    const r = schedule(reviewCard(10), 3, NOW, noFuzz);
    expect(r.card.interval).toBe(25);
    expect(r.card.ease).toBe(2.5);
    expect(r.card.due).toBe(NOW + 25 * DAY);
    expect(r.prevInterval).toBe(10);
    expect(r.newInterval).toBe(25);
  });

  it('「難しい」は I × 1.2、係数 −0.15', () => {
    const r = schedule(reviewCard(10), 2, NOW, noFuzz);
    expect(r.card.interval).toBe(12);
    expect(r.card.ease).toBe(2.35);
  });

  it('「簡単」は I × E × 1.3、係数 +0.15', () => {
    const r = schedule(reviewCard(10), 4, NOW, noFuzz);
    expect(r.card.interval).toBe(33);
    expect(r.card.ease).toBe(2.65);
  });

  it('新しい間隔は最低でも前回 +1 日', () => {
    expect(schedule(reviewCard(1), 2, NOW, noFuzz).card.interval).toBe(2);
    expect(schedule(reviewCard(1, 1.3), 3, NOW, noFuzz).card.interval).toBe(2);
  });

  it('「もう一度」は再学習（10分後）、係数 −0.20、lapses +1', () => {
    const r = schedule(reviewCard(10), 1, NOW, noFuzz);
    expect(r.card.state).toBe('relearning');
    expect(r.card.due).toBe(NOW + 10 * MINUTE);
    expect(r.card.ease).toBe(2.3);
    expect(r.card.lapses).toBe(1);
    expect(r.card.interval).toBe(1);
  });

  it('再学習で「正解」なら間隔1日で復習に戻る', () => {
    const lapsed = schedule(reviewCard(10), 1, NOW, noFuzz).card;
    const r = schedule(lapsed, 3, NOW + 10 * MINUTE, noFuzz);
    expect(r.card.state).toBe('review');
    expect(r.card.interval).toBe(1);
    expect(r.card.due).toBe(NOW + 10 * MINUTE + DAY);
  });

  it('係数の下限は1.3', () => {
    expect(schedule(reviewCard(10, 1.35), 1, NOW, noFuzz).card.ease).toBe(1.3);
    expect(schedule(reviewCard(10, 1.3), 2, NOW, noFuzz).card.ease).toBe(1.3);
  });

  it('3日以上の間隔には±5%の揺らぎが入る', () => {
    const low = schedule(reviewCard(100), 3, NOW, () => 0).card.interval;
    const high = schedule(reviewCard(100), 3, NOW, () => 0.999999).card.interval;
    expect(low).toBe(238);
    expect(high).toBe(262);
  });

  it('元のカードは変更しない（純粋関数）', () => {
    const c = reviewCard(10);
    const copy = { ...c };
    schedule(c, 3, NOW, noFuzz);
    expect(c).toEqual(copy);
  });
});

describe('ボタン表示', () => {
  it('次回までの時間を返す', () => {
    const d = previewDelays(newCard('d', 'q', 'a', NOW), NOW);
    expect(formatDelay(d[1])).toBe('1分');
    expect(formatDelay(d[3])).toBe('10分');
    expect(formatDelay(d[4])).toBe('4日');
  });

  it('formatDelay', () => {
    expect(formatDelay(2 * 60 * MINUTE)).toBe('2時間');
    expect(formatDelay(45 * DAY)).toBe('1.5か月');
    expect(formatDelay(730 * DAY)).toBe('2年');
  });
});
