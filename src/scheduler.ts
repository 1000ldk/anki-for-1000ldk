import type { Card, Rating } from './types';

/**
 * 間隔反復アルゴリズム（SM-2 / Anki方式）。
 * 「カードと評価を受け取り、更新後のカードを返す純粋関数」として分離し、
 * FSRSへの差し替えもこのモジュールの入れ替えで済むようにする。
 */

export const MINUTE = 60_000;
export const DAY = 86_400_000;

export const LEARNING_STEPS_MIN = [1, 10];
export const RELEARNING_STEPS_MIN = [10];
export const GRADUATING_INTERVAL = 1;
export const EASY_INTERVAL = 4;
export const MIN_EASE = 1.3;
export const FUZZ_RATIO = 0.05;

export interface ScheduleResult {
  card: Card;
  prevInterval: number;
  newInterval: number;
  prevEase: number;
  newEase: number;
}

/** 0以上1未満の乱数を返す関数。テストやプレビューでは固定値を渡す */
export type Random = () => number;

const NO_FUZZ: Random = () => 0.5;

function applyFuzz(interval: number, random: Random): number {
  if (interval < 3) return interval;
  const factor = 1 + (random() * 2 - 1) * FUZZ_RATIO;
  return Math.max(1, Math.round(interval * factor));
}

function clampEase(ease: number): number {
  return Math.max(MIN_EASE, Math.round(ease * 100) / 100);
}

/** ステップ上で「難しい」を押したときの待ち時間（Ankiと同じく最初のステップでは1つ目と2つ目の平均） */
function hardStepDelay(steps: number[], step: number): number {
  if (step === 0 && steps.length > 1) return (steps[0] + steps[1]) / 2;
  return steps[Math.min(step, steps.length - 1)];
}

export function schedule(card: Card, rating: Rating, now: number, random: Random = Math.random): ScheduleResult {
  const prevInterval = card.interval;
  const prevEase = card.ease;
  const next: Card = { ...card, reps: card.reps + 1, updatedAt: now };

  if (card.state === 'new' || card.state === 'learning') {
    const steps = LEARNING_STEPS_MIN;
    const step = card.state === 'new' ? 0 : card.step;
    const graduate = (interval: number) => {
      next.state = 'review';
      next.step = 0;
      next.interval = interval;
      next.due = now + interval * DAY;
    };
    const stay = (newStep: number, delayMin: number) => {
      next.state = 'learning';
      next.step = newStep;
      next.due = now + delayMin * MINUTE;
    };
    switch (rating) {
      case 1:
        stay(0, steps[0]);
        break;
      case 2:
        stay(step, hardStepDelay(steps, step));
        break;
      case 3:
        if (step + 1 < steps.length) stay(step + 1, steps[step + 1]);
        else graduate(GRADUATING_INTERVAL);
        break;
      case 4:
        graduate(EASY_INTERVAL);
        break;
    }
  } else if (card.state === 'relearning') {
    const steps = RELEARNING_STEPS_MIN;
    const interval = Math.max(1, card.interval);
    const graduate = (ivl: number) => {
      next.state = 'review';
      next.step = 0;
      next.interval = ivl;
      next.due = now + ivl * DAY;
    };
    switch (rating) {
      case 1:
        next.step = 0;
        next.due = now + steps[0] * MINUTE;
        break;
      case 2:
        next.due = now + hardStepDelay(steps, card.step) * MINUTE;
        break;
      case 3:
        if (card.step + 1 < steps.length) {
          next.step = card.step + 1;
          next.due = now + steps[card.step + 1] * MINUTE;
        } else {
          graduate(interval);
        }
        break;
      case 4:
        graduate(interval + 1);
        break;
    }
  } else {
    // review
    const I = Math.max(1, card.interval);
    const E = card.ease;
    if (rating === 1) {
      next.state = 'relearning';
      next.step = 0;
      next.lapses = card.lapses + 1;
      next.ease = clampEase(E - 0.2);
      next.interval = 1;
      next.due = now + RELEARNING_STEPS_MIN[0] * MINUTE;
    } else {
      const factor = rating === 2 ? 1.2 : rating === 3 ? E : E * 1.3;
      const base = Math.max(I + 1, Math.round(I * factor));
      const interval = Math.max(I + 1, applyFuzz(base, random));
      next.interval = interval;
      next.ease = rating === 2 ? clampEase(E - 0.15) : rating === 4 ? clampEase(E + 0.15) : E;
      next.due = now + interval * DAY;
    }
  }

  return { card: next, prevInterval, newInterval: next.interval, prevEase, newEase: next.ease };
}

/** 評価ボタンに表示する「次回までの時間」（揺らぎなし） */
export function previewDelays(card: Card, now: number): Record<Rating, number> {
  const out = {} as Record<Rating, number>;
  for (const r of [1, 2, 3, 4] as Rating[]) {
    out[r] = schedule(card, r, now, NO_FUZZ).card.due - now;
  }
  return out;
}

export function formatDelay(ms: number): string {
  const min = Math.round(ms / MINUTE);
  if (min < 60) return `${Math.max(1, min)}分`;
  const hours = ms / (60 * MINUTE);
  if (hours < 24) return `${Math.round(hours)}時間`;
  const days = Math.round(ms / DAY);
  if (days < 30) return `${days}日`;
  if (days < 365) return `${Math.round(days / 30 * 10) / 10}か月`;
  return `${Math.round(days / 365 * 10) / 10}年`;
}
