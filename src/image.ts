import { MAX_SOURCE_BYTES, processImageFile, type ProcessedImage } from './imageProcess';

export { MAX_SOURCE_BYTES };

type Reply = { id: number; result?: ProcessedImage; error?: string };

let worker: Worker | null = null;
let workerBroken = false;
let seq = 0;
const waiting = new Map<number, (reply: Reply) => void>();

function getWorker(): Worker | null {
  if (workerBroken || typeof Worker === 'undefined' || typeof OffscreenCanvas === 'undefined') return null;
  if (!worker) {
    try {
      worker = new Worker(new URL('./imageWorker.ts', import.meta.url), { type: 'module' });
      worker.onmessage = (e: MessageEvent<Reply>) => {
        waiting.get(e.data.id)?.(e.data);
        waiting.delete(e.data.id);
      };
      worker.onerror = () => {
        // Worker が起動できない環境。待っている処理はメインスレッドでやり直す
        workerBroken = true;
        worker = null;
        for (const [id, resolve] of waiting) resolve({ id, error: 'worker' });
        waiting.clear();
      };
    } catch {
      workerBroken = true;
      return null;
    }
  }
  return worker;
}

function processInWorker(w: Worker, file: Blob): Promise<Reply> {
  const id = ++seq;
  return new Promise((resolve) => {
    waiting.set(id, resolve);
    w.postMessage({ id, file });
  });
}

/**
 * 取り込んだ画像を縮小・再エンコードする。可能なら Web Worker で行い、
 * Worker で失敗したとき（OffscreenCanvas 非対応、HEIC を読めないなど）はメインスレッドでやり直す。
 */
export async function processImage(file: Blob): Promise<ProcessedImage> {
  const w = getWorker();
  if (w) {
    const reply = await processInWorker(w, file);
    if (reply.result) return reply.result;
  }
  return processImageFile(file);
}

export function isImageFile(file: File): boolean {
  // 「ファイル」アプリから選んだHEICなどは type が空のことがあるので拡張子も見る
  return file.type.startsWith('image/') || (!file.type && /\.(jpe?g|png|gif|webp|heic|heif)$/i.test(file.name));
}
