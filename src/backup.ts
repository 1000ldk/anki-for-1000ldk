import { strFromU8, strToU8, unzipSync, Zip, ZipDeflate, ZipPassThrough } from 'fflate';
import { db } from './db';
import { formatYmd } from './day';
import { mediaExtension, sha256Hex } from './media';
import { updateSettings } from './store';
import { SCHEMA_VERSION, type Card, type Deck, type Media, type ReviewLog, type Settings } from './types';

/** data.json に入れる画像の情報。本体は ZIP の media/<id>.<拡張子> に置く */
export type MediaMeta = Omit<Media, 'blob'>;

export interface BackupData {
  schemaVersion: number;
  exportedAt: number;
  decks: Deck[];
  cards: Card[];
  reviewLogs: ReviewLog[];
  settings: Settings | null;
  /** schemaVersion 2 以降 */
  media?: MediaMeta[];
}

export type ImportMode = 'replace' | 'merge';

/** 読み込んだバックアップ。旧形式（JSON）なら media は空 */
export interface BackupPackage {
  data: BackupData;
  media: Media[];
}

const metaOf = ({ blob: _blob, ...meta }: Media): MediaMeta => meta;

export async function collectBackup(now = Date.now()): Promise<BackupData> {
  return db.transaction('r', [db.decks, db.cards, db.reviewLogs, db.settings, db.media], async () => {
    const media: MediaMeta[] = [];
    await db.media.each((m) => media.push(metaOf(m)));
    return {
      schemaVersion: SCHEMA_VERSION,
      exportedAt: now,
      decks: await db.decks.toArray(),
      cards: await db.cards.toArray(),
      reviewLogs: await db.reviewLogs.toArray(),
      settings: (await db.settings.get('settings')) ?? null,
      media,
    };
  });
}

export function backupFileName(now = Date.now()): string {
  return `anki-backup-${formatYmd(now)}.zip`;
}

/** 書き出すファイルのおおよその大きさ（書き出し前の表示用） */
export async function estimateBackupSize(): Promise<number> {
  const data = await collectBackup();
  const json = new Blob([JSON.stringify(data)]).size;
  return json + (data.media ?? []).reduce((n, m) => n + m.size, 0);
}

/**
 * data.json と media/ をまとめた ZIP を作る。
 * 画像は圧縮済みなので無圧縮で格納し、1枚ずつ読んで流し込む。
 */
export async function buildBackupZip(now = Date.now()): Promise<Blob> {
  const data = await collectBackup(now);
  const chunks: Uint8Array[] = [];
  let failure: Error | null = null;
  const zip = new Zip((err, chunk) => {
    if (err) failure = err;
    else chunks.push(chunk);
  });

  const json = new ZipDeflate('data.json', { level: 6 });
  zip.add(json);
  json.push(strToU8(JSON.stringify(data)), true);

  for (const meta of data.media ?? []) {
    const m = await db.media.get(meta.id);
    if (!m) continue;
    const file = new ZipPassThrough(`media/${m.id}.${mediaExtension(m.mime)}`);
    zip.add(file);
    file.push(new Uint8Array(await m.blob.arrayBuffer()), true);
  }
  zip.end();
  if (failure) throw failure;
  return new Blob(chunks as BlobPart[], { type: 'application/zip' });
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
    media: Array.isArray(d.media) ? d.media : [],
  };
}

function isZip(bytes: Uint8Array): boolean {
  return bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04;
}

/** バックアップファイル（ZIP、または旧形式のJSON）を読み込む */
export async function readBackupFile(file: Blob): Promise<BackupPackage> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (!isZip(bytes)) return { data: parseBackup(strFromU8(bytes)), media: [] };

  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(bytes);
  } catch {
    throw new Error('ZIPとして読み込めませんでした');
  }
  if (!files['data.json']) throw new Error('バックアップファイルの形式ではありません（data.json がありません）');
  const data = parseBackup(strFromU8(files['data.json']));

  const media: Media[] = [];
  for (const meta of data.media ?? []) {
    const body = files[`media/${meta.id}.${mediaExtension(meta.mime)}`];
    if (!body) continue;
    const blob = new Blob([body as BlobPart], { type: meta.mime });
    media.push({ ...meta, blob, size: blob.size, hash: meta.hash || (await sha256Hex(body)) });
  }
  return { data, media };
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
  media: number;
}

export async function importBackup(data: BackupData, mode: ImportMode, media: Media[] = []): Promise<ImportSummary> {
  return db.transaction('rw', [db.decks, db.cards, db.reviewLogs, db.settings, db.media], async () => {
    if (mode === 'replace') {
      await Promise.all([db.decks.clear(), db.cards.clear(), db.reviewLogs.clear(), db.media.clear()]);
      const current = await db.settings.get('settings');
      await db.decks.bulkPut(data.decks);
      await db.cards.bulkPut(data.cards);
      await db.reviewLogs.bulkPut(data.reviewLogs);
      await db.media.bulkPut(media);
      if (data.settings) {
        await db.settings.put({ ...data.settings, lastBackupAt: current?.lastBackupAt ?? data.settings.lastBackupAt });
      }
      return { decks: data.decks.length, cards: data.cards.length, reviewLogs: data.reviewLogs.length, media: media.length };
    }

    const decks = pickNewer(new Map((await db.decks.toArray()).map((d) => [d.id, d])), data.decks);
    const cards = pickNewer(new Map((await db.cards.toArray()).map((c) => [c.id, c])), data.cards);
    const existingLogIds = new Set(await db.reviewLogs.toCollection().primaryKeys());
    const logs = data.reviewLogs.filter((l) => !existingLogIds.has(l.id));
    // 画像は作成後に変わらないので、IDが無いものだけ足す
    const existingMediaIds = new Set(await db.media.toCollection().primaryKeys());
    const newMedia = media.filter((m) => !existingMediaIds.has(m.id));
    await db.decks.bulkPut(decks);
    await db.cards.bulkPut(cards);
    await db.reviewLogs.bulkPut(logs);
    await db.media.bulkPut(newMedia);
    return { decks: decks.length, cards: cards.length, reviewLogs: logs.length, media: newMedia.length };
  });
}

export async function createBackupFile(now = Date.now()): Promise<File> {
  return new File([await buildBackupZip(now)], backupFileName(now), { type: 'application/zip' });
}

/** 共有シートを開くにはタップ直後である必要がある。ZIP作成に時間がかかってその猶予が切れたとき */
export function isActivationError(e: unknown): boolean {
  return e instanceof DOMException && e.name === 'NotAllowedError';
}

/**
 * 共有シート（「"ファイル"に保存」でiCloud Driveなどへ）でバックアップを保存する。
 * 共有APIが使えない環境ではダウンロードリンクで代替する。
 * ユーザー操作（タップ）の中から呼ぶこと。キャンセルされたら false を返す。
 */
export async function saveBackupFile(file: File, now = Date.now()): Promise<boolean> {
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: file.name });
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') return false;
      throw e;
    }
  } else {
    const url = URL.createObjectURL(file);
    const a = document.createElement('a');
    a.href = url;
    a.download = file.name;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }
  await updateSettings({ lastBackupAt: now });
  return true;
}
