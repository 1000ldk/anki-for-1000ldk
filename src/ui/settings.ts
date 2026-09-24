import {
  createBackupFile,
  estimateBackupSize,
  importBackup,
  isActivationError,
  readBackupFile,
  saveBackupFile,
  type BackupPackage,
  type ImportMode,
} from '../backup';
import { cleanupMedia, formatBytes, mediaStats, STORAGE_WARN_RATIO, storageEstimate } from '../media';
import { getSettings, listDecks, updateDeck, updateSettings } from '../store';
import { actionSheet, h, header, navigate, toast } from './dom';

/**
 * ZIPを作って共有シートで保存する。ZIP作成に時間がかかり、タップ直後の猶予が切れて
 * 共有シートを開けなかったときは、もう一度タップしてもらうボタンを出す。
 */
async function exportWithRetry(): Promise<boolean> {
  const file = await createBackupFile();
  try {
    return await saveBackupFile(file);
  } catch (e) {
    if (!isActivationError(e)) throw e;
  }
  return new Promise((resolve, reject) => {
    actionSheet(
      `書き出す準備ができました（${formatBytes(file.size)}）`,
      [{ label: '共有シートを開く', kind: 'primary', run: () => saveBackupFile(file).then(resolve, reject) }],
      () => resolve(false),
    );
  });
}

export async function renderSettings(root: HTMLElement): Promise<void> {
  const [settings, decks, media, storage, backupSize] = await Promise.all([
    getSettings(),
    listDecks(),
    mediaStats(),
    storageEstimate(),
    estimateBackupSize(),
  ]);
  let pending: BackupPackage | null = null;

  const lastBackup = settings.lastBackupAt ? new Date(settings.lastBackupAt).toLocaleString('ja-JP') : 'まだありません';

  let exporting = false;
  const doExport = async () => {
    if (exporting) return;
    exporting = true;
    try {
      if (await exportWithRetry()) {
        toast('書き出しました');
        navigate(location.hash);
      }
    } catch (e) {
      console.error(e);
      toast('書き出しに失敗しました');
    } finally {
      exporting = false;
    }
  };

  const importInfo = h('p', null);
  const importButtons = h(
    'section',
    { hidden: true },
    h('p', null, h('small', null, 'マージ：IDが同じなら更新日時が新しい方を残す／全置換：今のデータを捨てて置き換える')),
    h(
      'div',
      { role: 'group' },
      h('button', { class: 'secondary', onclick: () => doImport('merge') }, 'マージ'),
      h('button', { class: 'secondary', 'data-danger': true, onclick: () => doImport('replace') }, '全置換'),
    ),
  );

  const onFile = async (e: Event) => {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    pending = null;
    importButtons.hidden = true;
    if (!file) return;
    importInfo.textContent = '読み込み中…';
    try {
      pending = await readBackupFile(file);
      const { data } = pending;
      const at = data.exportedAt ? new Date(data.exportedAt).toLocaleString('ja-JP') : '不明';
      const images = pending.media.length ? `、画像${pending.media.length}枚` : '';
      importInfo.textContent = `${file.name}：デッキ${data.decks.length}、カード${data.cards.length}枚${images}（書き出し日時 ${at}）`;
      importButtons.hidden = false;
    } catch (err) {
      importInfo.textContent = err instanceof Error ? err.message : String(err);
    }
  };

  const doImport = async (mode: ImportMode) => {
    if (!pending) return;
    if (mode === 'replace') {
      if (!confirm('今のデータをすべて置き換えます。先に現在のデータを書き出します。')) return;
      // 全置換の前に、現在のデータを自動で書き出す（このタップの中で共有シートを開く）
      let saved = false;
      try {
        saved = await exportWithRetry();
      } catch (e) {
        console.error(e);
      }
      if (!saved && !confirm('現在のデータを書き出せませんでした。書き出さずに置き換えますか？')) return;
    }
    try {
      const r = await importBackup(pending.data, mode, pending.media);
      toast(mode === 'replace' ? `置き換えました（カード${r.cards}枚）` : `取り込みました（デッキ${r.decks}、カード${r.cards}枚を更新）`);
      navigate('#/');
    } catch (e) {
      console.error(e);
      toast('読み込みに失敗しました');
    }
  };

  const doCleanup = async () => {
    try {
      const n = await cleanupMedia();
      await updateSettings({ lastMediaCleanupAt: Date.now() });
      toast(n ? `使われていない画像を${n}枚削除しました` : '削除できる画像はありませんでした');
      navigate(location.hash);
    } catch (e) {
      console.error(e);
      toast('削除に失敗しました');
    }
  };

  const onDayStart = async (e: Event) => {
    const v = Number((e.target as HTMLSelectElement).value);
    await updateSettings({ dayStartHour: v });
    toast(`日付の切り替わりを ${v} 時にしました`);
  };

  const onNewPerDay = (deckId: string) => async (e: Event) => {
    const input = e.target as HTMLInputElement;
    const v = Math.max(0, Math.min(9999, Math.floor(Number(input.value))));
    if (!Number.isFinite(v)) return;
    input.value = String(v);
    await updateDeck(deckId, { newPerDay: v });
    toast('保存しました');
  };

  const hint = (text: string) => h('p', null, h('small', null, text));
  const storageRatio = storage ? storage.usage / storage.quota : 0;

  root.replaceChildren(
    header('設定', { back: '#/' }),
    h(
      'main',
      { class: 'container' },
      h(
        'article',
        null,
        h('header', null, h('h2', null, 'バックアップ')),
        hint(`最後の書き出し：${lastBackup}`),
        h('button', { onclick: doExport }, `書き出す（ZIP・約${formatBytes(backupSize)}）`),
        hint('共有シートの「"ファイル"に保存」でiCloud Driveなどに保存してください。画像も含まれます。'),
        h(
          'label',
          null,
          '読み込み',
          h('input', { type: 'file', accept: 'application/zip,.zip,application/json,.json', onchange: onFile }),
          h('small', null, 'ZIP（画像付き）と、以前のJSON形式のどちらも読み込めます。'),
        ),
        importInfo,
        importButtons,
      ),
      h(
        'article',
        null,
        h('header', null, h('h2', null, '保存容量')),
        storage &&
          h(
            'p',
            null,
            h('progress', { value: storage.usage, max: storage.quota }),
            h(
              'small',
              { 'data-danger': storageRatio > STORAGE_WARN_RATIO },
              `使用量 ${formatBytes(storage.usage)} / 上限 ${formatBytes(storage.quota)}（${Math.round(storageRatio * 100)}%）`,
            ),
          ),
        hint(`画像 ${media.count}枚・合計 ${formatBytes(media.bytes)}`),
        h('button', { class: 'secondary', onclick: doCleanup }, '使われていない画像を削除'),
        hint('どのカードにも使われていない画像を消します（追加から24時間以内のものは残します）。起動時にも1日1回自動で行います。'),
      ),
      h(
        'article',
        null,
        h('header', null, h('h2', null, '1日の新規カード上限')),
        decks.length === 0
          ? hint('デッキがありません')
          : decks.map((d) =>
              h(
                'label',
                null,
                d.name,
                h('input', { type: 'number', inputmode: 'numeric', min: 0, max: 9999, value: d.newPerDay, onchange: onNewPerDay(d.id) }),
              ),
            ),
      ),
      h(
        'article',
        null,
        h('header', null, h('h2', null, '日付の切り替わり時刻')),
        h(
          'label',
          null,
          'この時刻までの学習は前日扱い',
          h(
            'select',
            { onchange: onDayStart },
            Array.from({ length: 24 }, (_, i) => h('option', { value: i, selected: i === settings.dayStartHour }, `${i}:00`)),
          ),
        ),
      ),
      h('p', null, h('small', null, `v${__APP_VERSION__}`)),
    ),
  );
}
