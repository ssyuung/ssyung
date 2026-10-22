// 시간 모델 (D15): 시각은 자정부터의 분, 구간은 [start, end), 경계는 10의 배수.
// 사람이 읽고 쓰는 곳(dataset 파일, ChangeOps)은 "HH:MM", 엔진·API는 분(Minute).
import { z } from "zod";

export const Minute = z.number().int().min(0).max(1440).multipleOf(10).describe("자정부터의 분, 10의 배수");
export const HHMM = z.string().regex(/^([01]\d|2[0-3]):[0-5]0$/).describe("HH:MM, 10분 경계");
/** [start, end). start < end는 독립 제약 검사기가 확인한다 */
export const Interval = z.object({ start: Minute, end: Minute });

export const Day = z.enum(["MON", "TUE", "WED", "THU", "FRI"]);
export const TimeBlockKind = z.enum(["class", "break", "lunch", "arrival", "dismissal", "other"]);
export const PartOfDay = z.enum(["morning", "afternoon"]);

/** 일과 틀의 한 칸. period는 수업일 때만 */
export const TimeBlock = z.object({
  kind: TimeBlockKind,
  period: z.number().int().min(1).max(8).nullable(),
  start: Minute,
  end: Minute,
  label: z.string().max(10),
  part_of_day: PartOfDay,
});

/** 요일별 일과 (②). 지금은 모든 요일이 같다 */
export const BellSchedule = z.object({
  days: z.array(Day).min(1),
  blocks: z.array(TimeBlock).min(1),
});

/** 40분 수업 = 시작 10 · 중간 20 · 종료 10 (D13) */
export const Segment = z.enum(["start", "mid", "end"]);
/** MOVE = 이동 묶음, HIGH = 체크된 구간·추가 수요·업무, LOW = 체크 안 된 구간 */
export const Priority = z.enum(["MOVE", "HIGH", "LOW"]);

export type Minute = z.infer<typeof Minute>;
export type Interval = z.infer<typeof Interval>;
export type Day = z.infer<typeof Day>;
export type TimeBlock = z.infer<typeof TimeBlock>;
export type BellSchedule = z.infer<typeof BellSchedule>;
export type Segment = z.infer<typeof Segment>;
export type Priority = z.infer<typeof Priority>;

// ---------- 공용 변환 (모듈마다 따로 만들지 않는다) ----------
/** "09:30" → 570 */
export const hhmmToMinute = (hhmm: string): number => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));
/** 570 → "09:30" */
export const minuteToHHMM = (min: number): string =>
  `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;
/** 10분 올림 (now 계산) */
export const ceil10 = (min: number): number => Math.ceil(min / 10) * 10;
const WEEKDAYS = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"] as const;
/** "2026-09-18" → "FRI". 주말이면 SAT·SUN */
export const weekdayOf = (date: string): (typeof WEEKDAYS)[number] => WEEKDAYS[new Date(`${date}T00:00:00Z`).getUTCDay()]!;

/** 기본 일과 (②). 초등 40분 수업. 학교가 일과를 저장하기 전까지 쓴다 */
export const DEFAULT_BELL: BellSchedule[] = [
  {
    days: ["MON", "TUE", "WED", "THU", "FRI"],
    blocks: (
      [
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
      ] as const
    ).map(([kind, s, e, label, period]) => ({
      kind, period, start: hhmmToMinute(s), end: hhmmToMinute(e), label,
      part_of_day: hhmmToMinute(s) < 720 ? ("morning" as const) : ("afternoon" as const),
    })),
  },
];
