// 수요 (architecture.md §8.1). 수요 생성(M3)이 만들고 배치 엔진(M1·M2)이 받는다.
// id는 내용에서 만든 안정된 문자열이라, 다시 계산해도 같은 수요는 같은 id를 가진다 (diff 기준).
import { z } from "zod";
import { DutyCode, Floor, Id, IsoDate, LocationRef, StudentCode, Subject } from "./ids.ts";
import { Interval, Minute, Priority, Segment } from "./time.ts";

/**
 * les:<date>:<학생>:p<교시>      수업 지원
 * mv:<date>:b<앞 교시>:<출발층>-<도착층>   이동 묶음 (D12)
 * req:<date>:<학생>:<start>     추가 수요
 * duty:<date>:<업무>             업무
 */
export const DemandId = z.string().regex(/^(les|mv|req|duty):\d{4}-\d{2}-\d{2}:[A-Za-z0-9:\-]+$/);

const base = {
  id: DemandId,
  date: IsoDate,
  start: Minute,
  end: Minute,
  headcount: z.number().int().min(1),
};

export const LessonDemand = z.object({
  ...base,
  kind: z.literal("lesson"),
  student: StudentCode,
  period: z.number().int().min(1).max(8),
  subject: Subject,
  location: LocationRef,
  floor: Floor,
  segments: z
    .array(z.object({ segment: Segment, start: Minute, end: Minute, priority: z.enum(["HIGH", "LOW"]) }))
    .length(3)
    .describe("시작 10 · 중간 20 · 종료 10 (D13). 체크된 구간이 HIGH"),
});

export const MoveLeg = z.object({
  student: StudentCode,
  from: LocationRef,
  to: LocationRef,
  late_cost: z.union([z.literal(0), z.literal(1), z.literal(2)])
    .describe("늦게 도착 비용 (D22). 0 원반·시작 미체크/지원 없음, 1 특수학급 수업, 2 시작 체크됨"),
});
export const MoveGroupDemand = z.object({
  ...base,
  kind: z.literal("move_group"),
  after_period: z.number().int().min(1).max(7),
  from_floor: Floor,
  to_floor: Floor,
  students: z.array(MoveLeg).min(1),
  late_cost: z.union([z.literal(0), z.literal(1), z.literal(2)]).describe("학생 비용의 최댓값"),
  second_trip: Interval.describe("두 번째 이동 허용 구간 = 다음 교시 첫 10분 (D22)"),
});

export const RequirementDemand = z.object({
  ...base,
  kind: z.literal("requirement"),
  student: StudentCode,
});

export const DutyDemand = z.object({
  ...base,
  kind: z.literal("duty"),
  duty: DutyCode,
  location: LocationRef,
  students: z.array(StudentCode),
});

export const Demand = z.discriminatedUnion("kind", [LessonDemand, MoveGroupDemand, RequirementDemand, DutyDemand]);

export const DemandSet = z.object({
  date_from: IsoDate,
  date_to: IsoDate,
  version_id: Id.nullable().describe("수요를 만든 버전 입력(배치·추가 수요)"),
  absent: z.array(z.object({ date: IsoDate, student: StudentCode })).describe("결석으로 뺀 학생"),
  unplaced: z.array(z.object({
    date: IsoDate,
    student: StudentCode,
    period: z.number().int().min(1).max(8),
    subject: Subject,
    reason: z.enum(["none", "multiple"]).describe("none = 그 시각 그 과목을 하는 특수학급 없음, multiple = 둘 이상"),
  })).describe("특수학급 수업인데 장소를 정하지 못한 칸 (D25). 이동 수요를 만들지 않는다. 교사가 set_placement로 장소를 지정하면 풀림"),
  demands: z.array(Demand),
});

/** 수요의 기본 우선순위. 수업은 구간별(segments)로 따로 본다 */
export const demandPriority = (d: z.infer<typeof Demand>): z.infer<typeof Priority> =>
  d.kind === "move_group" ? "MOVE" : d.kind === "lesson" ? "LOW" : "HIGH";

export type DemandId = z.infer<typeof DemandId>;
export type LessonDemand = z.infer<typeof LessonDemand>;
export type MoveGroupDemand = z.infer<typeof MoveGroupDemand>;
export type Demand = z.infer<typeof Demand>;
export type DemandSet = z.infer<typeof DemandSet>;
