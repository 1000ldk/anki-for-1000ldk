/**
 * 画像の縮小・再エンコード（メインスレッドと Web Worker の両方から使う）。
 * DOM に依存しないので Worker 内でもそのまま動く。
 */
import type { MediaMime } from './types';

/** 保存時の長辺の上限（px） */
export const MAX_EDGE = 1600;
/** 取り込める元ファイルの上限 */
export const MAX_SOURCE_BYTES = 30 * 1024 * 1024;

export interface ProcessedImage {
  blob: Blob;
  mime: MediaMime;
  width: number;
  height: number;
}

/** 長辺が max を超えるときだけ縮小したサイズ。小さい画像は拡大しない */
export function fitWithin(width: number, height: number, max = MAX_EDGE): { width: number; height: number } {
  const scale = Math.min(1, max / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

/**
 * 出力形式の規則。
 * 写真（JPEG・HEICなど）→ JPEG 0.8、透過のあるPNG → PNG、透過のないPNG（スクショなど）→ JPEG 0.85、GIF → 1コマ目をJPEG。
 */
export function decideOutput(sourceType: string, hasAlpha: boolean): { mime: MediaMime; quality?: number } {
  if (sourceType === 'image/png' || sourceType === 'image/webp') {
    return hasAlpha ? { mime: 'image/png' } : { mime: 'image/jpeg', quality: 0.85 };
  }
  return { mime: 'image/jpeg', quality: 0.8 };
}

/** 透過を持ちうる形式か（GIFの透過はJPEG化で白くする） */
function mayHaveAlpha(type: string): boolean {
  return type === 'image/png' || type === 'image/webp';
}

type Canvas2D = OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D;

function hasTransparentPixel(ctx: Canvas2D, width: number, height: number): boolean {
  const data = ctx.getImageData(0, 0, width, height).data;
  for (let i = 3; i < data.length; i += 4) if (data[i] < 255) return true;
  return false;
}

function makeCanvas(width: number, height: number): { canvas: OffscreenCanvas | HTMLCanvasElement; ctx: Canvas2D } {
  if (typeof OffscreenCanvas !== 'undefined') {
    const canvas = new OffscreenCanvas(width, height);
    const ctx = canvas.getContext('2d');
    if (ctx) return { canvas, ctx };
  }
  if (typeof document === 'undefined') throw new Error('この環境では画像を処理できません');
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('この環境では画像を処理できません');
  return { canvas, ctx };
}

function encode(canvas: OffscreenCanvas | HTMLCanvasElement, mime: MediaMime, quality?: number): Promise<Blob> {
  if ('convertToBlob' in canvas) return canvas.convertToBlob({ type: mime, quality });
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('画像を書き出せませんでした'))), mime, quality),
  );
}

interface Source {
  image: CanvasImageSource;
  width: number;
  height: number;
  close(): void;
}

async function loadSource(file: Blob): Promise<Source> {
  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' }).catch(() => createImageBitmap(file));
    return { image: bitmap, width: bitmap.width, height: bitmap.height, close: () => bitmap.close() };
  } catch (e) {
    // createImageBitmap が読めない形式（古いSafariのHEICなど）は <img> で読む。Worker 内では使えない
    if (typeof document === 'undefined') throw e;
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return { image: img, width: img.naturalWidth, height: img.naturalHeight, close: () => {} };
  } catch {
    throw new Error('画像を読み込めませんでした');
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * 元ファイルを読み込み、縮小して再エンコードする。
 * 読み込み時に写真の向き（EXIF Orientation）が反映され、再エンコードで位置情報などのEXIFは消える。
 */
export async function processImageFile(file: Blob): Promise<ProcessedImage> {
  const src = await loadSource(file);
  try {
    const { width, height } = fitWithin(src.width, src.height);
    const { canvas, ctx } = makeCanvas(width, height);
    ctx.imageSmoothingQuality = 'high';

    let alpha = false;
    if (mayHaveAlpha(file.type)) {
      ctx.drawImage(src.image, 0, 0, width, height);
      alpha = hasTransparentPixel(ctx, width, height);
    }
    const out = decideOutput(file.type, alpha);
    if (out.mime === 'image/jpeg') {
      // JPEG は透過を持てないので、透過部分が黒くならないよう白で塗ってから描く
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, width, height);
      ctx.drawImage(src.image, 0, 0, width, height);
    }
    const blob = await encode(canvas, out.mime, out.quality);
    return { blob, mime: out.mime, width, height };
  } finally {
    src.close();
  }
}
