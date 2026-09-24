import { describe, expect, it } from 'vitest';
import { dayStart, formatYmd, nextDayStart } from '../src/day';

describe('日付の切り替わり', () => {
  it('切り替わり時刻より前（深夜）は前日扱い', () => {
    const at = new Date(2026, 8, 24, 2, 30).getTime();
    expect(dayStart(at, 4)).toBe(new Date(2026, 8, 23, 4, 0).getTime());
    expect(nextDayStart(at, 4)).toBe(new Date(2026, 8, 24, 4, 0).getTime());
  });

  it('切り替わり時刻以降は当日', () => {
    const at = new Date(2026, 8, 24, 4, 0).getTime();
    expect(dayStart(at, 4)).toBe(at);
    expect(nextDayStart(at, 4)).toBe(new Date(2026, 8, 25, 4, 0).getTime());
  });

  it('月末をまたぐ', () => {
    const at = new Date(2026, 8, 30, 23, 0).getTime();
    expect(nextDayStart(at, 4)).toBe(new Date(2026, 9, 1, 4, 0).getTime());
  });

  it('formatYmd', () => {
    expect(formatYmd(new Date(2026, 0, 5, 10).getTime())).toBe('20260105');
  });
});
