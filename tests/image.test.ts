import { describe, expect, it } from 'vitest';
import { decideOutput, fitWithin } from '../src/imageProcess';

describe('画像の縮小', () => {
  it('長辺が1600pxを超えるときだけ縮小する', () => {
    // 12MP（4032×3024）の写真
    expect(fitWithin(4032, 3024)).toEqual({ width: 1600, height: 1200 });
    expect(fitWithin(3024, 4032)).toEqual({ width: 1200, height: 1600 });
    expect(fitWithin(800, 600)).toEqual({ width: 800, height: 600 });
    expect(fitWithin(1600, 10)).toEqual({ width: 1600, height: 10 });
  });

  it('極端に細長い画像でも1px未満にしない', () => {
    expect(fitWithin(100000, 10)).toEqual({ width: 1600, height: 1 });
  });
});

describe('出力形式', () => {
  it('写真は JPEG 0.8', () => {
    expect(decideOutput('image/jpeg', false)).toEqual({ mime: 'image/jpeg', quality: 0.8 });
    expect(decideOutput('image/heic', false)).toEqual({ mime: 'image/jpeg', quality: 0.8 });
  });

  it('透過のあるPNGはPNG、透過のないPNGはJPEG 0.85', () => {
    expect(decideOutput('image/png', true)).toEqual({ mime: 'image/png' });
    expect(decideOutput('image/png', false)).toEqual({ mime: 'image/jpeg', quality: 0.85 });
  });

  it('GIFは1コマ目をJPEG', () => {
    expect(decideOutput('image/gif', false)).toEqual({ mime: 'image/jpeg', quality: 0.8 });
  });
});
