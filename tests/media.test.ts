import Dexie from 'dexie';
import { beforeEach, describe, expect, it } from 'vitest';
import { buildBackupZip, collectBackup, importBackup, readBackupFile } from '../src/backup';
import { AppDB, db, useDatabase } from '../src/db';
import { cleanupMedia, cleanupMediaDaily, extractMediaIds, MEDIA_GRACE_MS, mediaMarkdown, mediaStats, saveMedia } from '../src/media';
import { DAY } from '../src/scheduler';
import { createCard, createDeck, deleteCard, updateSettings } from '../src/store';

const NOW = new Date(2026, 8, 24, 12, 0).getTime();

const image = (bytes: number[], mime: 'image/jpeg' | 'image/png' = 'image/jpeg') => ({
  blob: new Blob([new Uint8Array(bytes)], { type: mime }),
  mime,
  width: 40,
  height: 30,
});

let n = 0;
beforeEach(() => {
  useDatabase(new AppDB(`media-test-${n++}`));
});

describe('スキーマ移行', () => {
  it('v1 のデータベースを開くと、既存データを保ったまま media ストアが増える', async () => {
    const name = `migrate-${n++}`;
    const v1 = new Dexie(name);
    v1.version(1).stores({ decks: 'id, name', cards: 'id, deckId, [deckId+due]', reviewLogs: 'id, cardId, reviewedAt, [deckId+reviewedAt]', settings: 'id' });
    await v1.table('decks').add({ id: 'd1', name: '既存', newPerDay: 20, createdAt: NOW, updatedAt: NOW });
    v1.close();

    const v2 = new AppDB(name);
    useDatabase(v2);
    expect(v2.verno).toBe(2);
    expect((await v2.decks.get('d1'))?.name).toBe('既存');
    const id = await saveMedia(image([1]), NOW);
    expect(await v2.media.get(id)).toBeDefined();
  });
});

describe('画像の参照', () => {
  it('本文から media:<id> を取り出す', () => {
    expect(extractMediaIds(`問題\n\n${mediaMarkdown('3f2a9c1e-5b7d-4e8a-9c21-7d4e5f6a8b90')}\n![](media:b)`)).toEqual([
      '3f2a9c1e-5b7d-4e8a-9c21-7d4e5f6a8b90',
      'b',
    ]);
    expect(extractMediaIds('画像なし')).toEqual([]);
  });
});

describe('画像の保存', () => {
  it('同じ内容の画像は保存せず既存のIDを返す', async () => {
    const a = await saveMedia(image([1, 2, 3]), NOW);
    const b = await saveMedia(image([1, 2, 3]), NOW + 1);
    const c = await saveMedia(image([4, 5, 6]), NOW);
    expect(b).toBe(a);
    expect(c).not.toBe(a);
    expect(await mediaStats()).toEqual({ count: 2, bytes: 6 });
    const saved = (await db.media.get(a))!;
    expect(saved).toMatchObject({ mime: 'image/jpeg', width: 40, height: 30, size: 3, createdAt: NOW });
    expect(saved.hash).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('不要画像の掃除', () => {
  it('参照されていない画像を消す。作成から24時間以内のものは残す', async () => {
    const deck = await createDeck('d', NOW);
    const used = await saveMedia(image([1]), NOW - 2 * DAY);
    const unused = await saveMedia(image([2]), NOW - 2 * DAY);
    const recent = await saveMedia(image([3]), NOW - MEDIA_GRACE_MS + 1000);
    await createCard(deck.id, 'q', `a\n${mediaMarkdown(used)}`, NOW);

    expect(await cleanupMedia(NOW)).toBe(1);
    expect(await db.media.get(unused)).toBeUndefined();
    expect(await db.media.get(used)).toBeDefined();
    expect(await db.media.get(recent)).toBeDefined();
  });

  it('カードを削除すると、翌日以降の掃除で画像が消える', async () => {
    const deck = await createDeck('d', NOW);
    const id = await saveMedia(image([9]), NOW);
    const card = await createCard(deck.id, mediaMarkdown(id), 'a', NOW);
    await deleteCard(card.id);
    expect(await cleanupMedia(NOW + 1000)).toBe(0);
    expect(await cleanupMedia(NOW + DAY + 1000)).toBe(1);
  });

  it('起動時の掃除は1日（切り替わり時刻基準）に1回まで', async () => {
    await updateSettings({ dayStartHour: 4 });
    expect(await cleanupMediaDaily(NOW)).toBe(0);
    expect(await cleanupMediaDaily(NOW + 60_000)).toBeNull();
    // 翌日の切り替わり（翌朝4時）以降はまた実行する
    expect(await cleanupMediaDaily(new Date(2026, 8, 25, 4, 30).getTime())).toBe(0);
  });
});

describe('ZIPバックアップ', () => {
  it('書き出して全データを消してから読み込むと、画像付きで元に戻る', async () => {
    const deck = await createDeck('d', NOW);
    const jpg = await saveMedia(image([1, 2, 3, 4]), NOW);
    const png = await saveMedia(image([5, 6], 'image/png'), NOW);
    await createCard(deck.id, `構造式\n${mediaMarkdown(jpg)}`, mediaMarkdown(png), NOW);
    const before = await collectBackup(NOW);

    const zip = await buildBackupZip(NOW);
    expect(zip.type).toBe('application/zip');
    const pkg = await readBackupFile(zip);
    expect(pkg.media).toHaveLength(2);

    await Promise.all([db.decks.clear(), db.cards.clear(), db.reviewLogs.clear(), db.media.clear()]);
    const r = await importBackup(pkg.data, 'replace', pkg.media);
    expect(r).toMatchObject({ decks: 1, cards: 1, media: 2 });

    const after = await collectBackup(NOW);
    expect(after.cards).toEqual(before.cards);
    expect(after.media).toEqual(before.media);
    const restored = (await db.media.get(jpg))!;
    expect([...new Uint8Array(await restored.blob.arrayBuffer())]).toEqual([1, 2, 3, 4]);
    expect(restored.blob.type).toBe('image/jpeg');
    expect((await db.media.get(png))!.blob.type).toBe('image/png');
  });

  it('ZIPの中身は data.json と media/<id>.<拡張子>', async () => {
    const { unzipSync } = await import('fflate');
    const id = await saveMedia(image([7], 'image/png'), NOW);
    const files = unzipSync(new Uint8Array(await (await buildBackupZip(NOW)).arrayBuffer()));
    expect(Object.keys(files).sort()).toEqual(['data.json', `media/${id}.png`]);
  });

  it('マージでは手元に無い画像だけ追加する', async () => {
    const deck = await createDeck('d', NOW);
    const id = await saveMedia(image([1]), NOW);
    await createCard(deck.id, mediaMarkdown(id), 'a', NOW);
    const pkg = await readBackupFile(await buildBackupZip(NOW));

    expect((await importBackup(pkg.data, 'merge', pkg.media)).media).toBe(0);
    await db.media.clear();
    expect((await importBackup(pkg.data, 'merge', pkg.media)).media).toBe(1);
    expect(await db.media.get(id)).toBeDefined();
  });

  it('旧形式のJSONバックアップも読み込める', async () => {
    const deck = await createDeck('d', NOW);
    await createCard(deck.id, 'q', 'a', NOW);
    const { media: _media, ...legacy } = await collectBackup(NOW);
    const json = new Blob([JSON.stringify({ ...legacy, schemaVersion: 1 })], { type: 'application/json' });

    const pkg = await readBackupFile(json);
    expect(pkg.media).toEqual([]);
    expect(pkg.data.cards).toHaveLength(1);
    await db.cards.clear();
    await importBackup(pkg.data, 'replace', pkg.media);
    expect(await db.cards.count()).toBe(1);
  });

  it('壊れたZIPは読み込まない', async () => {
    await expect(readBackupFile(new Blob([new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0, 0])]))).rejects.toThrow('ZIP');
  });
});
