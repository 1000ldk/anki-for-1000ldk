import Dexie from 'dexie';
import { db } from './db';
import { dayStart, nextDayStart } from './day';
import { schedule } from './scheduler';
import {
  DEFAULT_NEW_PER_DAY,
  DEFAULT_SETTINGS,
  INITIAL_EASE,
  type Card,
  type Deck,
  type Rating,
  type ReviewLog,
  type Settings,
} from './types';

const uuid = () => crypto.randomUUID();

// ---- Settings ----

export async function getSettings(): Promise<Settings> {
  const s = await db.settings.get('settings');
  return { ...DEFAULT_SETTINGS, ...s };
}

export async function updateSettings(patch: Partial<Omit<Settings, 'id'>>): Promise<Settings> {
  const next = { ...(await getSettings()), ...patch };
  await db.settings.put(next);
  return next;
}

// ---- Deck ----

export async function listDecks(): Promise<Deck[]> {
  const decks = await db.decks.toArray();
  return decks.sort((a, b) => a.name.localeCompare(b.name, 'ja'));
}

export function getDeck(id: string): Promise<Deck | undefined> {
  return db.decks.get(id);
}

export async function createDeck(name: string, now = Date.now()): Promise<Deck> {
  const deck: Deck = { id: uuid(), name, newPerDay: DEFAULT_NEW_PER_DAY, createdAt: now, updatedAt: now };
  await db.decks.add(deck);
  return deck;
}

export async function updateDeck(id: string, patch: Partial<Pick<Deck, 'name' | 'newPerDay'>>): Promise<void> {
  await db.decks.update(id, { ...patch, updatedAt: Date.now() });
}

export async function deleteDeck(id: string): Promise<void> {
  await db.transaction('rw', db.decks, db.cards, db.reviewLogs, async () => {
    const cardIds = await db.cards.where('deckId').equals(id).primaryKeys();
    await db.reviewLogs.where('cardId').anyOf(cardIds).delete();
    await db.cards.bulkDelete(cardIds);
    await db.decks.delete(id);
  });
}

// ---- Card ----

export function listCards(deckId: string): Promise<Card[]> {
  return db.cards.where('deckId').equals(deckId).sortBy('createdAt');
}

export function getCard(id: string): Promise<Card | undefined> {
  return db.cards.get(id);
}

export function newCard(deckId: string, front: string, back: string, now: number): Card {
  return {
    id: uuid(),
    deckId,
    front,
    back,
    state: 'new',
    due: now,
    interval: 0,
    ease: INITIAL_EASE,
    reps: 0,
    lapses: 0,
    step: 0,
    createdAt: now,
    updatedAt: now,
  };
}

export async function createCard(deckId: string, front: string, back: string, now = Date.now()): Promise<Card> {
  const card = newCard(deckId, front, back, now);
  await db.cards.add(card);
  return card;
}

export async function updateCardText(id: string, front: string, back: string): Promise<void> {
  await db.cards.update(id, { front, back, updatedAt: Date.now() });
}

export async function deleteCard(id: string): Promise<void> {
  await db.transaction('rw', db.cards, db.reviewLogs, async () => {
    await db.reviewLogs.where('cardId').equals(id).delete();
    await db.cards.delete(id);
  });
}

// ---- 学習 ----

export interface DeckQueue {
  /** 学習中・再学習中（今日中に期限が来るもの） */
  learning: Card[];
  /** 今日が期限の復習カード */
  review: Card[];
  /** 今日出せる新規カード（上限適用済み） */
  fresh: Card[];
  /** 今日の新規上限の残り */
  newRemaining: number;
}

export async function newIntroducedToday(deckId: string, now: number, dayStartHour: number): Promise<number> {
  const from = dayStart(now, dayStartHour);
  return db.reviewLogs
    .where('[deckId+reviewedAt]')
    .between([deckId, from], [deckId, Dexie.maxKey])
    .filter((l) => l.prevState === 'new')
    .count();
}

export async function getDeckQueue(deck: Deck, now: number, dayStartHour: number): Promise<DeckQueue> {
  const end = nextDayStart(now, dayStartHour);
  const [cards, introduced] = await Promise.all([
    db.cards.where('[deckId+due]').between([deck.id, Dexie.minKey], [deck.id, end], true, false).toArray(),
    newIntroducedToday(deck.id, now, dayStartHour),
  ]);
  const learning: Card[] = [];
  const review: Card[] = [];
  const fresh: Card[] = [];
  for (const c of cards) {
    if (c.state === 'new') fresh.push(c);
    else if (c.state === 'review') review.push(c);
    else learning.push(c);
  }
  const newRemaining = Math.max(0, deck.newPerDay - introduced);
  // 索引順で due 昇順に並んでいる。新規は due = 作成日時なので作成順になる
  return { learning, review, fresh: fresh.slice(0, newRemaining), newRemaining };
}

/** 評価を1回分、カード更新とログ追記を1トランザクションで保存する */
export async function answerCard(card: Card, rating: Rating, now = Date.now(), random?: () => number): Promise<Card> {
  const result = schedule(card, rating, now, random);
  const log: ReviewLog = {
    id: uuid(),
    cardId: card.id,
    deckId: card.deckId,
    rating,
    reviewedAt: now,
    prevState: card.state,
    prevInterval: result.prevInterval,
    newInterval: result.newInterval,
    prevEase: result.prevEase,
    newEase: result.newEase,
  };
  await db.transaction('rw', db.cards, db.reviewLogs, async () => {
    await db.cards.put(result.card);
    await db.reviewLogs.add(log);
  });
  return result.card;
}
