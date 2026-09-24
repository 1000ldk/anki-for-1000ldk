import type { Card } from './types';
import type { DeckQueue } from './store';

/** 学習中カードの先取り：他に出すものが無いとき、この時間以内に期限が来る学習中カードは待たずに出す */
export const LEARN_AHEAD_MS = 20 * 60_000;

/**
 * 1回の学習セッションの出題順を管理する（メモリ上）。
 * 優先順：期限が来た学習中カード → 復習カード → 新規カード → 先取りできる学習中カード
 */
export class StudySession {
  private learning: Card[];
  private review: Card[];
  private fresh: Card[];

  constructor(queue: DeckQueue, private readonly dayEnd: number) {
    this.learning = [...queue.learning];
    this.review = [...queue.review];
    this.fresh = [...queue.fresh];
    this.sortLearning();
  }

  private sortLearning() {
    this.learning.sort((a, b) => a.due - b.due);
  }

  counts() {
    return { learning: this.learning.length, review: this.review.length, fresh: this.fresh.length };
  }

  /** 次に出すカード。今は出せない（学習中カードの待ち）なら null */
  next(now: number): Card | null {
    const firstLearning = this.learning[0];
    if (firstLearning && firstLearning.due <= now) return firstLearning;
    if (this.review.length) return this.review[0];
    if (this.fresh.length) return this.fresh[0];
    if (firstLearning && firstLearning.due <= now + LEARN_AHEAD_MS) return firstLearning;
    return null;
  }

  /** 学習中カードが後で出る予定の時刻（無ければ null） */
  nextLearningDue(): number | null {
    return this.learning[0]?.due ?? null;
  }

  isFinished(): boolean {
    return !this.learning.length && !this.review.length && !this.fresh.length;
  }

  /** 評価後のカードで列を更新する */
  update(updated: Card) {
    const remove = (list: Card[]) => {
      const i = list.findIndex((c) => c.id === updated.id);
      if (i >= 0) list.splice(i, 1);
    };
    remove(this.learning);
    remove(this.review);
    remove(this.fresh);
    if ((updated.state === 'learning' || updated.state === 'relearning') && updated.due < this.dayEnd) {
      this.learning.push(updated);
      this.sortLearning();
    }
  }
}
