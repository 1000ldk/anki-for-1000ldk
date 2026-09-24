/**
 * 「今日」の判定。深夜の学習を前日扱いにするため、日付の切り替わり時刻（端末のローカル時刻）を基準にする。
 */

/** now を含む「1日」の開始時刻 */
export function dayStart(now: number, dayStartHour: number): number {
  const d = new Date(now);
  const start = new Date(d.getFullYear(), d.getMonth(), d.getDate(), dayStartHour, 0, 0, 0);
  if (start.getTime() > now) start.setDate(start.getDate() - 1);
  return start.getTime();
}

/** now を含む「1日」の終わり（次の切り替わり時刻） */
export function nextDayStart(now: number, dayStartHour: number): number {
  const start = new Date(dayStart(now, dayStartHour));
  start.setDate(start.getDate() + 1);
  return start.getTime();
}

export function formatYmd(ts: number): string {
  const d = new Date(ts);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}`;
}
