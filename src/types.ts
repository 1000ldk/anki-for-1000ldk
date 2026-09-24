export type CardState = 'new' | 'learning' | 'review' | 'relearning';

/** 1: もう一度 / 2: 難しい / 3: 正解 / 4: 簡単 */
export type Rating = 1 | 2 | 3 | 4;

export const RATING_LABELS: Record<Rating, string> = {
  1: 'もう一度',
  2: '難しい',
  3: '正解',
  4: '簡単',
};

export interface Deck {
  id: string;
  name: string;
  /** 1日の新規カード上限 */
  newPerDay: number;
  createdAt: number;
  updatedAt: number;
}

export interface Card {
  id: string;
  deckId: string;
  front: string;
  back: string;
  state: CardState;
  /** 次回出題日時（UNIXミリ秒）。new の間は作成日時を入れて出題順に使う */
  due: number;
  /** 現在の間隔（日） */
  interval: number;
  /** 易しさ係数 */
  ease: number;
  reps: number;
  lapses: number;
  /** 学習・再学習ステップの現在位置 */
  step: number;
  createdAt: number;
  updatedAt: number;
}

export interface ReviewLog {
  id: string;
  cardId: string;
  /** 新規上限の判定や統計のため、評価時点の所属デッキを持つ */
  deckId: string;
  rating: Rating;
  reviewedAt: number;
  prevState: CardState;
  prevInterval: number;
  newInterval: number;
  prevEase: number;
  newEase: number;
}

export interface Settings {
  id: 'settings';
  /** 日付の切り替わり時刻（0〜23時） */
  dayStartHour: number;
  lastBackupAt: number | null;
  schemaVersion: number;
}

export const SCHEMA_VERSION = 1;

export const DEFAULT_SETTINGS: Settings = {
  id: 'settings',
  dayStartHour: 4,
  lastBackupAt: null,
  schemaVersion: SCHEMA_VERSION,
};

export const DEFAULT_NEW_PER_DAY = 20;
export const INITIAL_EASE = 2.5;
