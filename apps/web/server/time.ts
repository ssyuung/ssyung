// 서버 시각. 학교는 Asia/Seoul(+09:00) 하나다.
import type { IsoDate } from "@ssyung/schema";

const KST_MS = 9 * 60 * 60 * 1000;

/** 서버 시각 → 학교 날짜·분·ISO 문자열 */
export function kst(d: Date): { date: IsoDate; minute: number; iso: string } {
  const t = new Date(d.getTime() + KST_MS);
  const s = t.toISOString();
  return { date: s.slice(0, 10), minute: t.getUTCHours() * 60 + t.getUTCMinutes(), iso: `${s.slice(0, 19)}+09:00` };
}

export const floor10 = (min: number): number => Math.floor(min / 10) * 10;

/** "2026-09-18" → "9월 18일(금)" */
export function dateLabel(date: IsoDate): string {
  const day = "일월화수목금토"[new Date(`${date}T00:00:00Z`).getUTCDay()];
  return `${Number(date.slice(5, 7))}월 ${Number(date.slice(8, 10))}일(${day})`;
}

/** 날짜에 n일 더함 */
export function addDays(date: IsoDate, n: number): IsoDate {
  const t = new Date(`${date}T00:00:00Z`);
  t.setUTCDate(t.getUTCDate() + n);
  return t.toISOString().slice(0, 10);
}
