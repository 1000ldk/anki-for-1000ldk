import { isImageFile, MAX_SOURCE_BYTES, processImage } from '../image';
import { findImages } from '../markdown';
import { isQuotaError, mediaMarkdown, saveMedia } from '../media';
import { createCard, deleteCard, getCard, getDeck, updateCardText } from '../store';
import { actionSheet, h, header, navigate, toast } from './dom';
import { MediaUrls, openImageViewer, renderMarkdown } from './render';

const HAS_IMAGE = /!\[[^\]\n]*\]\([^)\s]+\)/;

/** cardId が null なら新規作成。保存後も続けて次のカードを追加できる */
export async function renderCardEdit(root: HTMLElement, deckId: string, cardId: string | null): Promise<() => void> {
  const deck = await getDeck(deckId);
  const card = cardId ? await getCard(cardId) : undefined;
  const back = `#/deck/${deckId}`;
  if (!deck || (cardId && !card)) {
    root.replaceChildren(header('カード', { back }), h('main', { class: 'container' }, h('p', null, 'カードが見つかりません')));
    return () => {};
  }

  const urls = new MediaUrls();
  /** 処理中の画像の数。0 になるまで保存させない */
  let processing = 0;
  let placeholderSeq = 0;

  const frontSide = sideEditor('front', '表', '問題', card?.front ?? '');
  const backSide = sideEditor('back', '裏', '答え', card?.back ?? '');

  function sideEditor(id: string, label: string, placeholder: string, value: string) {
    const textarea = h('textarea', { id, rows: 4, required: true, placeholder, value });
    const preview = h('section', { class: 'preview', hidden: true, 'aria-label': `${label}のプレビュー` });
    const libraryInput = h('input', { type: 'file', accept: 'image/*', multiple: true, hidden: true });
    const cameraInput = h('input', { type: 'file', accept: 'image/*', capture: 'environment', hidden: true });
    const replaceInput = h('input', { type: 'file', accept: 'image/*', hidden: true });
    let replaceIndex = -1;
    let previewTimer: number | undefined;
    let previewToken = 0;

    const renderPreview = async () => {
      const text = textarea.value;
      const token = ++previewToken;
      if (!HAS_IMAGE.test(text)) {
        preview.hidden = true;
        preview.replaceChildren();
        return;
      }
      const frag = await renderMarkdown(text, urls, {
        thumbnail: true,
        onImageTap: (_e, entry) => openImageViewer(entry),
        onImageHold: (_id, index) => imageMenu(index),
      });
      if (token !== previewToken) return;
      preview.replaceChildren(frag);
      preview.hidden = false;
    };
    const schedulePreview = () => {
      clearTimeout(previewTimer);
      previewTimer = window.setTimeout(renderPreview, 150);
    };

    /** 本文中の置き換え。カーソルが後ろにあれば長さの差だけずらす */
    const replaceRange = (start: number, end: number, text: string) => {
      const { selectionStart, selectionEnd, value } = textarea;
      const shift = (pos: number) => (pos >= end ? pos + text.length - (end - start) : Math.min(pos, start + text.length));
      textarea.value = value.slice(0, start) + text + value.slice(end);
      textarea.setSelectionRange(shift(selectionStart), shift(selectionEnd));
      schedulePreview();
    };

    /** カーソル位置に、前後を改行で区切った行として挿入する */
    const insertLines = (lines: string[]) => {
      const { selectionStart: s, selectionEnd: e, value } = textarea;
      const before = value.slice(0, s);
      const after = value.slice(e);
      const text = (before && !before.endsWith('\n') ? '\n' : '') + lines.join('\n') + (after.startsWith('\n') ? '' : '\n');
      textarea.value = before + text + after;
      const pos = before.length + text.length;
      textarea.setSelectionRange(pos, pos);
    };

    /** 1枚処理して保存し、画像のIDを返す。失敗したらトーストを出して null */
    const importOne = async (file: File): Promise<string | null> => {
      try {
        const processed = await processImage(file);
        return await saveMedia(processed);
      } catch (e) {
        console.error(e);
        toast(isQuotaError(e) ? '保存容量が足りないため、画像を保存できませんでした' : `画像を追加できませんでした（${e instanceof Error ? e.message : e}）`);
        return null;
      }
    };

    const acceptFiles = (files: File[]): File[] => {
      const images = files.filter(isImageFile);
      if (images.length < files.length) toast('画像のみ追加できます');
      const ok = images.filter((f) => f.size <= MAX_SOURCE_BYTES);
      if (ok.length < images.length) toast('30MBを超える画像は追加できません');
      return ok;
    };

    /** カーソル位置にプレースホルダーを置き、1枚ずつ処理して画像に置き換える */
    const addImages = async (files: File[]) => {
      const accepted = acceptFiles(files);
      if (!accepted.length) return;
      const markers = accepted.map(() => `[画像を処理中…#${++placeholderSeq}]`);
      insertLines(markers);
      schedulePreview();
      processing += accepted.length;
      for (const [i, file] of accepted.entries()) {
        const id = await importOne(file);
        processing--;
        const start = textarea.value.indexOf(markers[i]);
        if (start < 0) continue; // 処理中にプレースホルダーが消された
        const end = start + markers[i].length;
        if (id) replaceRange(start, end, mediaMarkdown(id));
        else replaceRange(start, textarea.value[end] === '\n' ? end + 1 : end, '');
      }
    };

    /** 長押しした画像（本文中で index 番目）のメニュー */
    const imageMenu = (index: number) => {
      actionSheet(null, [
        {
          label: '差し替え',
          run: () => {
            replaceIndex = index;
            replaceInput.click();
          },
        },
        { label: '削除', kind: 'danger', run: () => removeImage(index) },
      ]);
    };

    /** 画像を消す。その行が画像だけなら行ごと消す */
    const removeImage = (index: number) => {
      const target = findImages(textarea.value)[index];
      if (!target) return;
      const value = textarea.value;
      const lineStart = value.lastIndexOf('\n', target.start - 1) + 1;
      const nl = value.indexOf('\n', target.end);
      const lineEnd = nl < 0 ? value.length : nl;
      const rest = value.slice(lineStart, target.start) + value.slice(target.end, lineEnd);
      if (rest.trim()) replaceRange(target.start, target.end, '');
      else if (nl >= 0) replaceRange(lineStart, lineEnd + 1, '');
      else replaceRange(lineStart > 0 ? lineStart - 1 : 0, lineEnd, '');
    };

    const replaceImage = async (file: File) => {
      const [accepted] = acceptFiles([file]);
      const index = replaceIndex;
      if (!accepted || index < 0) return;
      const before = findImages(textarea.value)[index];
      if (!before) return;
      toast('画像を処理中…');
      processing++;
      const id = await importOne(accepted);
      processing--;
      // 処理中に本文が変わっていても、同じ画像を指している場合だけ置き換える
      const target = findImages(textarea.value)[index];
      if (!id || !target || target.src !== before.src) return;
      replaceRange(target.start, target.end, mediaMarkdown(id));
    };

    const takeFiles = (input: HTMLInputElement) => {
      const files = [...(input.files ?? [])];
      input.value = '';
      return files;
    };
    libraryInput.addEventListener('change', () => addImages(takeFiles(libraryInput)));
    cameraInput.addEventListener('change', () => addImages(takeFiles(cameraInput)));
    replaceInput.addEventListener('change', () => {
      const [file] = takeFiles(replaceInput);
      if (file) replaceImage(file);
    });

    // スクショや写真をコピーして、長押し →「ペースト」で貼り付ける
    textarea.addEventListener('paste', (e) => {
      const items = [...(e.clipboardData?.items ?? [])];
      const files = items.filter((i) => i.kind === 'file').map((i) => i.getAsFile()).filter((f): f is File => !!f);
      if (!files.length) return;
      const hasText = items.some((i) => i.kind === 'string' && i.type === 'text/plain');
      if (!files.some(isImageFile) && hasText) return; // 画像以外のファイルと一緒に文字もあるなら、文字として貼る
      e.preventDefault();
      addImages(files);
    });
    textarea.addEventListener('input', schedulePreview);

    const imageButton = h(
      'button',
      {
        type: 'button',
        class: 'secondary',
        onclick: () =>
          actionSheet(null, [
            { label: '写真から選ぶ', run: () => libraryInput.click() },
            { label: 'カメラで撮る', run: () => cameraInput.click() },
          ]),
      },
      '画像を追加',
    );

    const el = h(
      'article',
      null,
      h('label', { for: id }, label),
      textarea,
      preview,
      imageButton,
      libraryInput,
      cameraInput,
      replaceInput,
    );
    renderPreview();
    return {
      el,
      textarea,
      reset() {
        textarea.value = '';
        renderPreview();
      },
    };
  }

  const save = async (e: Event) => {
    e.preventDefault();
    if (processing > 0) {
      toast('画像の処理が終わるまでお待ちください');
      return;
    }
    const front = frontSide.textarea.value.trim();
    const backText = backSide.textarea.value.trim();
    if (!front || !backText) {
      toast('表と裏の両方を入力してください');
      return;
    }
    try {
      if (card) {
        await updateCardText(card.id, front, backText);
        toast('保存しました');
        navigate(back);
      } else {
        await createCard(deckId, front, backText);
        toast('追加しました。続けて入力できます');
        frontSide.reset();
        backSide.reset();
        urls.retain([]);
        frontSide.textarea.focus();
      }
    } catch (err) {
      console.error(err);
      toast(isQuotaError(err) ? '保存容量が足りないため保存できませんでした' : '保存に失敗しました');
    }
  };

  const remove = async () => {
    if (!card || !confirm('このカードを削除します。よろしいですか？')) return;
    await deleteCard(card.id);
    toast('削除しました');
    navigate(back);
  };

  root.replaceChildren(
    header(card ? 'カードを編集' : 'カードを追加', { back }),
    h(
      'main',
      { class: 'container' },
      h('form', { onsubmit: save }, frontSide.el, backSide.el, h('button', { type: 'submit' }, card ? '保存' : '追加して次へ')),
      card && h('footer', null, h('button', { class: 'secondary', 'data-danger': true, onclick: remove }, 'カードを削除')),
    ),
  );
  if (!card) frontSide.textarea.focus();

  return () => urls.dispose();
}
