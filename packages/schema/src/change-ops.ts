// 변경 명령 (architecture.md §7). 해석기(M6)가 만들고, 교사가 확인한 뒤 배치 엔진(M1)이 반영한다.
import { z } from "zod";
import { ClassGroupCode, DutyCode, IsoDate, LocationRef, StaffCode, StudentCode } from "./ids.ts";
import { Day, HHMM } from "./time.ts";

const period = z.number().int().min(1).max(8);

/** 시간 지칭. 날짜가 기본, 요일은 scope: permanent 규칙에서만 */
export const When = z.union([
  z.strictObject({ date: IsoDate, period }),
  z.strictObject({ date: IsoDate, kind: z.literal("break"), after_period: period }),
  z.strictObject({ date: IsoDate, kind: z.enum(["lunch", "arrival", "dismissal"]) }),
  z.strictObject({ date: IsoDate, start: HHMM, end: HHMM }),
  z.strictObject({ date: IsoDate }).describe("하루 전체"),
  z.strictObject({ day: Day, period }).describe("permanent 규칙에서만"),
]);
const Whens = z.union([When, z.array(When).min(1)]);

export const RelocateClass = z.strictObject({
  op: z.literal("relocate_class"),
  class_group: ClassGroupCode,
  when: Whens,
  location: LocationRef,
});
export const StaffUnavailable = z.strictObject({
  op: z.literal("staff_unavailable"),
  staff: StaffCode,
  when: Whens,
});
export const SetPlacement = z.strictObject({
  op: z.literal("set_placement"),
  student: StudentCode,
  when: Whens,
  placement: z.enum(["homeroom", "special_class"]),
  location: LocationRef.optional().describe("special_class일 때 수업 장소. 없으면 소속 특수학급 (D20)"),
});
export const SetSupport = z.strictObject({
  op: z.literal("set_support"),
  student: StudentCode,
  when: Whens,
  headcount: z.number().int().min(0).max(3).describe("0이면 추가 수요 해제"),
});
export const PinAssignment = z.strictObject({
  op: z.literal("pin_assignment"),
  staff: StaffCode,
  target: z.union([z.strictObject({ student: StudentCode }), z.strictObject({ duty: DutyCode })]),
  when: Whens,
});
export const MarkAbsent = z.strictObject({
  op: z.literal("mark_absent"),
  student: StudentCode,
  when: Whens,
});

export const ChangeOp = z.discriminatedUnion("op", [
  RelocateClass, StaffUnavailable, SetPlacement, SetSupport, PinAssignment, MarkAbsent,
]);

export const ChangeOps = z.strictObject({
  ops: z.array(ChangeOp),
  scope: z.enum(["this_week", "permanent"]),
  confidence: z.enum(["high", "medium", "low"]),
  unsupported: z.string().max(200).nullable().describe("표현할 수 없는 요청이면 이유. 그때 ops는 비어 있다"),
});

export type When = z.infer<typeof When>;
export type ChangeOp = z.infer<typeof ChangeOp>;
export type ChangeOps = z.infer<typeof ChangeOps>;
