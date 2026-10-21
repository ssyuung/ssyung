// 배치 엔진 계약 (architecture.md §8.0). packages/scheduler의 propose()·validate() 입출력.
// 엔진(heuristic, cpsat)은 Assignment·Shortfall만 만들고, diff·explanation·metrics는 엔진 밖에서 계산한다.
import { z } from "zod";
import { Id, IsoDate, StaffCode, StudentCode } from "./ids.ts";
import { Interval, Minute, Priority, Segment } from "./time.ts";
import { Demand, DemandId } from "./demand.ts";
import { ChangeOp } from "./change-ops.ts";

/** 지원인력의 그날 근무 가능 구간과 부재 */
export const StaffWindow = z.object({
  staff: StaffCode,
  date: IsoDate,
  available: z.array(Interval),
  absent: z.array(Interval).describe("출장·병가 등 (staff_unavailable)"),
});

export const Assignment = z.object({
  staff: StaffCode,
  demand_id: DemandId,
  date: IsoDate,
  start: Minute,
  end: Minute,
  mode: z.enum(["normal", "second_trip"]).describe("second_trip = 다음 교시 첫 10분에 데려감 (D22)"),
  pinned: z.boolean(),
});

export const Shortfall = z.object({
  demand_id: DemandId,
  date: IsoDate,
  start: Minute,
  end: Minute,
  short_by: z.number().int().min(1),
  priority: Priority,
  segment: Segment.nullable().describe("수업 지원일 때 구간"),
  waived: z.boolean().describe("이동이 몰려 일부러 비운 체크 안 된 구간 (EDGE_RELEASED). 지원 공백으로 세지 않음"),
});

export const RuleKey = z.enum([
  "move_group", "segment_priority", "second_trip", "edge_release", "keep_previous",
  "balance", "rotation", // 예약 (D17)
]);
export const PolicyKey = z.enum(["keep_minimal", "fresh", "no_late"]);
export const Policy = z.object({
  key: PolicyKey,
  label: z.string().max(20),
  description: z.string().max(100),
  rules: z.record(RuleKey, z.boolean()),
  release_checked_start: z.boolean().describe("체크된 시작 구간을 마지막 수단으로 비울지"),
});

export const DiffType = z.enum(["removed", "added", "moved", "group", "retimed", "gap"]);
const Slot = z.object({
  staff: StaffCode.nullable(),
  start: Minute,
  end: Minute,
  students: z.array(StudentCode),
});
export const DiffEntry = z.object({
  demand_id: DemandId,
  type: DiffType.describe("removed 없어짐(빨강) · added 생김(초록) · moved/group/retimed 바뀜(노랑) · gap 맡을 사람 없음"),
  before: Slot.nullable(),
  after: Slot.nullable(),
});

export const ReasonCode = z.enum([
  "REQUESTED", "TIMETABLE_CHANGED", "MOVE_SUPPORT_NEEDED", "GROUP_MOVE", "EDGE_RELEASED",
  "OVERLAP", "UNAVAILABLE", "CONTINUITY", "GAP", "BALANCE", "ROTATION",
]);
export const ExplanationStep = z.object({
  step: z.number().int().min(1),
  cause: z.number().int().min(1).nullable(),
  reason: z.object({
    code: ReasonCode,
    op_index: z.number().int().min(0).optional(),
    params: z.record(z.string(), z.union([z.string(), z.number()])).optional(),
  }),
  demand_ids: z.array(DemandId).describe("이 단계에서 바뀐 칸. 화면에서 누르면 강조"),
});

export const Metrics = z.object({
  changed_cells: z.number().int().min(0),
  gaps: z.number().int().min(0).describe("waived가 아닌 부족분이 있는 수요 수"),
  late_students: z.number().int().min(0).describe("second_trip으로 늦게 도착하는 학생 수"),
  notify_staff: z.array(StaffCode).describe("배정이 바뀌어 알림 받을 지원인력"),
  staff_minutes: z.record(StaffCode, z.number().int().min(0)),
  pair_share: z.record(z.string().regex(/^A\d{2,3}:S\d{2,3}$/), z.number().min(0).max(1)),
});

export const Option = z.object({
  key: z.string().regex(/^[A-Z]$/),
  policies: z.array(PolicyKey).min(1).describe("같은 결과가 나온 정책은 합친다 (D23)"),
  label: z.string().max(40),
  assignments: z.array(Assignment),
  shortfalls: z.array(Shortfall),
  metrics: Metrics,
  diff: z.array(DiffEntry),
  explanation: z.array(ExplanationStep),
});

export const ProposeInput = z.object({
  dates: z.array(IsoDate).min(1),
  demands: z.array(Demand),
  staff: z.array(StaffWindow),
  previous: z
    .object({ demands: z.array(Demand), assignments: z.array(Assignment) })
    .nullable()
    .describe("최초 생성이면 null"),
  pinned: z.array(Assignment),
  policies: z.array(PolicyKey).min(1),
  request: z.object({ change_request_id: Id.nullable(), ops: z.array(ChangeOp) }).nullable(),
});
export const ProposeOutput = z.object({
  options: z.array(Option).min(1),
  engine: z.object({ name: z.enum(["heuristic", "cpsat"]), version: z.string(), elapsed_ms: z.number().int().min(0) }),
});

export const ViolationCode = z.enum([
  "OVERLAP", "OUTSIDE_AVAILABILITY", "ABSENT", "PINNED_CHANGED",
  "MOVE_GROUP_HEADCOUNT", "SECOND_TRIP_WINDOW", "UNKNOWN_DEMAND",
]);
export const Violation = z.object({
  code: ViolationCode,
  staff: StaffCode.nullable(),
  demand_ids: z.array(DemandId),
  date: IsoDate,
  start: Minute,
  end: Minute,
});
export const Warning = z.object({
  code: z.enum(["SPECIAL_CLASS_CROWDED", "NO_SPECIAL_TEACHER"]),
  date: IsoDate,
  start: Minute,
  end: Minute,
  params: z.record(z.string(), z.union([z.string(), z.number()])),
});
export const ValidateInput = z.object({
  demands: z.array(Demand),
  staff: z.array(StaffWindow),
  pinned: z.array(Assignment),
  assignments: z.array(Assignment),
});
export const ValidateOutput = z.object({
  violations: z.array(Violation),
  shortfalls: z.array(Shortfall),
  warnings: z.array(Warning),
});

export type StaffWindow = z.infer<typeof StaffWindow>;
export type Assignment = z.infer<typeof Assignment>;
export type Shortfall = z.infer<typeof Shortfall>;
export type Policy = z.infer<typeof Policy>;
export type PolicyKey = z.infer<typeof PolicyKey>;
export type DiffEntry = z.infer<typeof DiffEntry>;
export type ExplanationStep = z.infer<typeof ExplanationStep>;
export type Metrics = z.infer<typeof Metrics>;
export type Option = z.infer<typeof Option>;
export type ProposeInput = z.infer<typeof ProposeInput>;
export type ProposeOutput = z.infer<typeof ProposeOutput>;
export type ValidateInput = z.infer<typeof ValidateInput>;
export type ValidateOutput = z.infer<typeof ValidateOutput>;

/** 배치 엔진 구현이 따르는 인터페이스 (M1 heuristic, M2 cpsat 어댑터) */
export interface Engine {
  name: "heuristic" | "cpsat";
  assign(problem: AssignProblem, policy: Policy): Promise<{ assignments: Assignment[]; shortfalls: Shortfall[] }>;
}
export type AssignProblem = Pick<ProposeInput, "dates" | "demands" | "staff" | "pinned"> & {
  previous_assignments: Assignment[];
};
