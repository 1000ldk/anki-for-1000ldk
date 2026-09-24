import { db } from './db';
import { formatYmd } from './day';
import { updateSettings } from './store';
import { SCHEMA_VERSION, type Card, type Deck, type ReviewLog, type Settings } from './types';

export interface BackupData {
  schemaVersion: number;
  exportedAt: number;
  decks: Deck[];
  cards: Card[];
  reviewLogs: ReviewLog[];
  settings: Settings | null;
}

export type ImportMode = 'replace' | 'merge';

export async function collectBackup(now = Date.now()): Promise<BackupData> {
  return db.transaction('r', db.decks, db.cards, db.reviewLogs, db.settings, async () => ({
    schemaVersion: SCHEMA_VERSION,
    exportedAt: now,
    decks: await db.decks.toArray(),
    cards: await db.cards.toArray(),
    reviewLogs: await db.reviewLogs.toArray(),
    settings: (await db.settings.get('settings')) ?? null,
  }));
}

export function backupFileName(now = Date.now()): string {
  return `anki-backup-${formatYmd(now)}.json`;
}

export function parseBackup(text: string): BackupData {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error('JSONとして読み込めませんでした');
  }
  const d = data as Partial<BackupData>;
  if (typeof d !== 'object' || d === null || typeof d.schemaVersion !== 'number') {
    throw new Error('バックアップファイルの形式ではありません（schemaVersion がありません）');
  }
  if (d.schemaVersion > SCHEMA_VERSION) {
    throw new Error(`新しい形式のバックアップです（v${d.schemaVersion}）。アプリを更新してから読み込んでください`);
  }
  if (!Array.isArray(d.decks) || !Array.isArray(d.cards) || !Array.isArray(d.reviewLogs)) {
    throw new Error('バックアップファイルの中身が不足しています');
  }
  return {
    schemaVersion: d.schemaVersion,
    exportedAt: d.exportedAt ?? 0,
    decks: d.decks,
    cards: d.cards,
    reviewLogs: d.reviewLogs,
    settings: d.settings ?? null,
  };
}

/** IDが同じなら更新日時が新しい方を残す。返り値は書き込むべきレコード */
export function pickNewer<T extends { id: string; updatedAt: number }>(existing: Map<string, T>, incoming: T[]): T[] {
  return incoming.filter((r) => {
    const cur = existing.get(r.id);
    return !cur || r.updatedAt > cur.updatedAt;
  });
}

export interface ImportSummary {
  decks: number;
  cards: number;
  reviewLogs: number;
}

export async function importBackup(data: BackupData, mode: ImportMode): Promise<ImportSummary> {
  return db.transaction('rw', db.decks, db.cards, db.reviewLogs, db.settings, async () => {
    if (mode === 'replace') {
      await Promise.all([db.decks.clear(), db.cards.clear(), db.reviewLogs.clear()]);
      const current = await db.settings.get('settings');
      await db.decks.bulkPut(data.decks);
      await db.cards.bulkPut(data.cards);
      await db.reviewLogs.bulkPut(data.reviewLogs);
      if (data.settings) {
        await db.settings.put({ ...data.settings, lastBackupAt: current?.lastBackupAt ?? data.settings.lastBackupAt });
      }
      return { decks: data.decks.length, cards: data.cards.length, reviewLogs: data.reviewLogs.length };
    }

    const decks = pickNewer(new Map((await db.decks.toArray()).map((d) => [d.id, d])), data.decks);
    const cards = pickNewer(new Map((await db.cards.toArray()).map((c) => [c.id, c])), data.cards);
    const existingLogIds = new Set(await db.reviewLogs.toCollection().primaryKeys());
    const logs = data.reviewLogs.filter((l) => !existingLogIds.has(l.id));
    await db.decks.bulkPut(decks);
    await db.cards.bulkPut(cards);
    await db.reviewLogs.bulkPut(logs);
    return { decks: decks.length, cards: cards.length, reviewLogs: logs.length };
  });
}

/**
 * 共有シート（「"ファイル"に保存」でiCloud Driveなどへ）でバックアップを書き出す。
 * 共有APIが使えない環境ではダウンロードリンクで代替する。
 * ユーザー操作（タップ）の中から呼ぶこと。キャンセルされたら false を返す。
 */
export async function exportBackup(now = Date.now()): Promise<boolean> {
  const data = await collectBackup(now);
  const name = backupFileName(now);
  const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
  const file = new File([blob], name, { type: 'application/json' });

  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: name });
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') return false;
      throw e;
    }
  } else {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  }
  await updateSettings({ lastBackupAt: now });
  return true;
}
