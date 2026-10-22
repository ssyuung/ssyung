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
  "move_group", // 항상 켜짐(D12). 엔진은 읽지 않는다. 계약 1.0에서 뺀다
  "segment_priority", "second_trip", "edge_release", "keep_previous",
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
  "OVERLAP", "UNAVAILABLE", "CONTINUITY", "GAP",
  "REPLANNED", // 처음부터 다시(keep_previous 끔) 정책이라 연쇄 없이 담당이 바뀜. cause는 그 요청 단계
  "BALANCE", "ROTATION",
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

/** 요청 시각 (D24). 이 날짜의 now 이전 칸은 이미 지났으므로 이전 배정을 그대로 둔다 */
export const Now = z.object({ date: IsoDate, minute: Minute.describe("10분 올림") });

export const ProposeInput = z.object({
  dates: z.array(IsoDate).min(1),
  now: Now.nullable().optional()
    .describe("오늘 변경이면 요청 시각. 이 날짜의 now 이전에 시작한 이전 배정은 바꾸지 않는다(고정). 없거나 null이면 모든 칸을 다시 볼 수 있음"),
  demands: z.array(Demand),
  staff: z.array(StaffWindow),
  previous: z
    .object({ demands: z.array(Demand), assignments: z.array(Assignment) })
    .nullable()
    .describe("최초 생성이면 null"),
  pinned: z.array(Assignment),
  policies: z.array(PolicyKey).min(1),
  request: z.object({
    change_request_id: Id.nullable(),
    ops: z.array(ChangeOp),
    cause: z.enum(["change_request", "setup", "timetable_import"]).optional()
      .describe("다시 배정하는 원인. 설명 1단계 이유 코드: change_request·setup → REQUESTED, timetable_import → TIMETABLE_CHANGED. 없으면 change_request"),
  }).nullable(),
});
export const ProposeOutput = z.object({
  options: z.array(Option).min(1),
  engine: z.object({ name: z.enum(["heuristic", "cpsat"]), version: z.string(), elapsed_ms: z.number().int().min(0) }),
});

export const ViolationCode = z.enum([
  "OVERLAP", "OUTSIDE_AVAILABILITY", "ABSENT", "PINNED_CHANGED",
  "MOVE_GROUP_HEADCOUNT", // 이동 묶음 담당이 2명 이상. 0명은 위반이 아니라 부족분(priority MOVE)
  "SECOND_TRIP_WINDOW", "UNKNOWN_DEMAND",
  "BEFORE_NOW_CHANGED", // now 이전 배정이 이전과 다름 (D24)
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
  code: z.enum(["SPECIAL_CLASS_CROWDED", "NO_SPECIAL_TEACHER", "SPECIAL_CLASS_UNPLACED"]),
  date: IsoDate,
  start: Minute,
  end: Minute,
  params: z.record(z.string(), z.union([z.string(), z.number()])),
});
export const ValidateInput = z.object({
  now: Now.nullable().optional().describe("있으면 now 이전 배정이 previous와 다를 때 BEFORE_NOW_CHANGED"),
  previous: z.array(Assignment).optional(),
  demands: z.array(Demand),
  staff: z.array(StaffWindow),
  pinned: z.array(Assignment),
  assignments: z.array(Assignment),
});
export const ValidateOutput = z.object({
  violations: z.array(Violation),
  shortfalls: z.array(Shortfall),
  warnings: z.array(Warning).optional()
    .describe("쓰지 않음. 배치 경고는 엔진 입력에 없는 정보가 필요해 API(schedule.validate)가 계산한다. 계약 1.0에서 뺀다"),
});

export type StaffWindow = z.infer<typeof StaffWindow>;
export type Now = z.infer<typeof Now>;
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
