import Dexie, { type Table } from 'dexie';
import type { Card, Deck, Media, ReviewLog, Settings } from './types';

export class AppDB extends Dexie {
  declare decks: Table<Deck, string>;
  declare cards: Table<Card, string>;
  declare reviewLogs: Table<ReviewLog, string>;
  declare settings: Table<Settings, string>;
  declare media: Table<Media, string>;

  constructor(name = 'anki-for-1000ldk') {
    super(name);
    // スキーマを変えるときは version(2) を追加し、upgrade() で既存データを移行する
    this.version(1).stores({
      decks: 'id, name',
      cards: 'id, deckId, [deckId+due]',
      reviewLogs: 'id, cardId, reviewedAt, [deckId+reviewedAt]',
      settings: 'id',
    });
    // v2: 画像を保存する media ストアを追加。既存ストアはそのまま引き継ぐので移すデータはない
    this.version(2).stores({
      media: 'id, hash, createdAt',
    });
  }
}

export let db = new AppDB();

/** テスト用：別名のDBに差し替える */
export function useDatabase(next: AppDB): void {
  db = next;
}
