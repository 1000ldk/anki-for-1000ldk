/// <reference lib="webworker" />
import { processImageFile } from './imageProcess';

/** 画像処理を Web Worker で行い、編集中の画面を止めないようにする */
self.onmessage = async (e: MessageEvent<{ id: number; file: Blob }>) => {
  const { id, file } = e.data;
  try {
    const result = await processImageFile(file);
    self.postMessage({ id, result });
  } catch (err) {
    self.postMessage({ id, error: err instanceof Error ? err.message : String(err) });
  }
};
