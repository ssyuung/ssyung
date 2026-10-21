// 기본 일과 (②). 초등 40분 수업 가정. 일과 저장은 DB 단계에서 추가한다.
import type { BellSchedule, TimeBlock } from "@ssyung/schema";

const RAW: [TimeBlock["kind"], string, string, string, number | null][] = [
  ["arrival", "08:40", "09:00", "등교", null],
  ["class", "09:00", "09:40", "1교시", 1],
  ["break", "09:40", "09:50", "쉬는 시간", null],
  ["class", "09:50", "10:30", "2교시", 2],
  ["break", "10:30", "10:40", "쉬는 시간", null],
  ["class", "10:40", "11:20", "3교시", 3],
  ["break", "11:20", "11:30", "쉬는 시간", null],
  ["class", "11:30", "12:10", "4교시", 4],
  ["lunch", "12:10", "13:00", "점심", null],
  ["class", "13:00", "13:40", "5교시", 5],
  ["break", "13:40", "13:50", "쉬는 시간", null],
  ["class", "13:50", "14:30", "6교시", 6],
  ["dismissal", "14:30", "14:50", "하교", null],
  ["other", "14:50", "16:40", "방과 후", null],
];

export const toMin = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));
export const toHHMM = (min: number) =>
  `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;

export function defaultBell(): BellSchedule[] {
  const blocks = RAW.map(([kind, s, e, label, period]): TimeBlock => ({
    kind, period, start: toMin(s), end: toMin(e), label, part_of_day: toMin(s) < 720 ? "morning" : "afternoon",
  }));
  return [{ days: ["MON", "TUE", "WED", "THU", "FRI"], blocks }];
}
