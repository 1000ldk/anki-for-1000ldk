import { exportBackup, importBackup, parseBackup, type BackupData, type ImportMode } from '../backup';
import { getSettings, listDecks, updateDeck, updateSettings } from '../store';
import { h, header, navigate, toast } from './dom';

export async function renderSettings(root: HTMLElement): Promise<void> {
  const [settings, decks] = await Promise.all([getSettings(), listDecks()]);
  let pending: BackupData | null = null;

  const lastBackup = settings.lastBackupAt ? new Date(settings.lastBackupAt).toLocaleString('ja-JP') : 'まだありません';

  const doExport = async () => {
    try {
      if (await exportBackup()) {
        toast('書き出しました');
        navigate(location.hash);
      }
    } catch (e) {
      console.error(e);
      toast('書き出しに失敗しました');
    }
  };

  const importInfo = h('p', { class: 'hint' });
  const importButtons = h(
    'div',
    { class: 'import-panel', hidden: true },
    h('p', { class: 'hint' }, 'マージ：IDが同じなら更新日時が新しい方を残す／全置換：今のデータを捨てて置き換える'),
    h(
      'div',
      { class: 'import-actions' },
      h('button', { class: 'btn', onclick: () => doImport('merge') }, 'マージ'),
      h('button', { class: 'btn danger', onclick: () => doImport('replace') }, '全置換'),
    ),
  );

  const onFile = async (e: Event) => {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    pending = null;
    importButtons.hidden = true;
    if (!file) return;
    try {
      pending = parseBackup(await file.text());
      const at = pending.exportedAt ? new Date(pending.exportedAt).toLocaleString('ja-JP') : '不明';
      importInfo.textContent = `${file.name}：デッキ${pending.decks.length}、カード${pending.cards.length}枚（書き出し日時 ${at}）`;
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
        saved = await exportBackup();
      } catch (e) {
        console.error(e);
      }
      if (!saved && !confirm('現在のデータを書き出せませんでした。書き出さずに置き換えますか？')) return;
    }
    try {
      const r = await importBackup(pending, mode);
      toast(mode === 'replace' ? `置き換えました（カード${r.cards}枚）` : `取り込みました（デッキ${r.decks}、カード${r.cards}枚を更新）`);
      navigate('#/');
    } catch (e) {
      console.error(e);
      toast('読み込みに失敗しました');
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

  root.replaceChildren(
    header('設定', { back: '#/' }),
    h(
      'main',
      { class: 'page settings' },
      h(
        'section',
        null,
        h('h2', null, 'バックアップ'),
        h('p', { class: 'hint' }, `最後の書き出し：${lastBackup}`),
        h('button', { class: 'btn primary block', onclick: doExport }, '書き出す（JSON）'),
        h('p', { class: 'hint' }, '共有シートの「"ファイル"に保存」でiCloud Driveなどに保存してください。'),
        h('h3', null, '読み込み'),
        h('input', { type: 'file', accept: 'application/json,.json', onchange: onFile }),
        importInfo,
        importButtons,
      ),
      h(
        'section',
        null,
        h('h2', null, '1日の新規カード上限'),
        decks.length === 0
          ? h('p', { class: 'hint' }, 'デッキがありません')
          : decks.map((d) =>
              h(
                'label',
                { class: 'row' },
                h('span', null, d.name),
                h('input', { type: 'number', inputmode: 'numeric', min: 0, max: 9999, value: d.newPerDay, onchange: onNewPerDay(d.id) }),
              ),
            ),
      ),
      h(
        'section',
        null,
        h('h2', null, '日付の切り替わり時刻'),
        h(
          'label',
          { class: 'row' },
          h('span', null, 'この時刻までの学習は前日扱い'),
          h(
            'select',
            { onchange: onDayStart },
            Array.from({ length: 24 }, (_, i) => h('option', { value: i, selected: i === settings.dayStartHour }, `${i}:00`)),
          ),
        ),
      ),
      h('p', { class: 'hint version' }, `v${__APP_VERSION__}`),
    ),
  );
}
