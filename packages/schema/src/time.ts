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
