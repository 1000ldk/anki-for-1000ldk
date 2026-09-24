import { db } from './db';
import { dayStart } from './day';
import { DAY } from './scheduler';
import { getSettings, updateSettings } from './store';
import type { Media, MediaMime } from './types';

/** 作成からこの時間内の画像は、どこからも参照されていなくても消さない（編集中の取り消しに備える） */
export const MEDIA_GRACE_MS = DAY;

const MEDIA_REF = /media:([0-9a-zA-Z-]+)/g;

/** 本文に貼る画像の Markdown */
export function mediaMarkdown(id: string): string {
  return `![](media:${id})`;
}

/** 本文から参照している画像IDを出現順に取り出す（重複あり） */
export function extractMediaIds(text: string): string[] {
  return [...text.matchAll(MEDIA_REF)].map((m) => m[1]);
}

export function mediaExtension(mime: string): 'jpg' | 'png' {
  return mime === 'image/png' ? 'png' : 'jpg';
}

export async function sha256Hex(data: Blob | ArrayBuffer | Uint8Array): Promise<string> {
  const buf = data instanceof Blob ? await data.arrayBuffer() : data;
  const digest = await crypto.subtle.digest('SHA-256', buf as BufferSource);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export interface NewMedia {
  blob: Blob;
  mime: MediaMime;
  width: number;
  height: number;
}

/**
 * 処理済みの画像を保存してIDを返す。同じ内容の画像が既にあれば保存せず既存のIDを返す。
 * 容量不足のときは QuotaExceededError をそのまま投げる。
 */
export async function saveMedia(input: NewMedia, now = Date.now()): Promise<string> {
  const hash = await sha256Hex(input.blob);
  return db.transaction('rw', db.media, async () => {
    const existing = await db.media.where('hash').equals(hash).first();
    if (existing) return existing.id;
    const media: Media = { id: crypto.randomUUID(), ...input, size: input.blob.size, hash, createdAt: now };
    await db.media.add(media);
    return media.id;
  });
}

export function getMedia(id: string): Promise<Media | undefined> {
  return db.media.get(id);
}

export async function mediaStats(): Promise<{ count: number; bytes: number }> {
  let count = 0;
  let bytes = 0;
  // 本体（Blob）を読まずに済むよう、サイズは記録済みの値を使う
  await db.media.each((m) => {
    count++;
    bytes += m.size;
  });
  return { count, bytes };
}

/** どのカードからも参照されていない画像を消す。作成から24時間以内のものは残す。消した枚数を返す */
export async function cleanupMedia(now = Date.now()): Promise<number> {
  return db.transaction('rw', db.cards, db.media, async () => {
    const used = new Set<string>();
    await db.cards.each((c) => {
      for (const id of extractMediaIds(c.front)) used.add(id);
      for (const id of extractMediaIds(c.back)) used.add(id);
    });
    const unused = await db.media
      .where('createdAt')
      .below(now - MEDIA_GRACE_MS)
      .filter((m) => !used.has(m.id))
      .primaryKeys();
    await db.media.bulkDelete(unused);
    return unused.length;
  });
}

/** 起動時用：1日（日付の切り替わり時刻基準）に1回まで掃除する */
export async function cleanupMediaDaily(now = Date.now()): Promise<number | null> {
  const settings = await getSettings();
  if (settings.lastMediaCleanupAt !== null && settings.lastMediaCleanupAt >= dayStart(now, settings.dayStartHour)) return null;
  const removed = await cleanupMedia(now);
  await updateSettings({ lastMediaCleanupAt: now });
  return removed;
}

/** 使用量が上限のこの割合を超えたら警告する */
export const STORAGE_WARN_RATIO = 0.8;

export async function storageEstimate(): Promise<{ usage: number; quota: number } | null> {
  try {
    const e = await navigator.storage?.estimate?.();
    return e && e.quota ? { usage: e.usage ?? 0, quota: e.quota } : null;
  } catch {
    return null;
  }
}

export function isQuotaError(e: unknown): boolean {
  if (!(e instanceof Error)) return false;
  // Dexie は内部の DOMException を inner に包むことがある
  const inner = (e as Error & { inner?: unknown }).inner;
  return e.name === 'QuotaExceededError' || (inner instanceof Error && inner.name === 'QuotaExceededError');
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)}KB`;
  if (bytes < 1024 * 1024 * 1024) return `${Math.round(bytes / 1024 / 1024)}MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(1)}GB`;
}
