// 연쇄 시나리오 (fixtures/scenarios/cascade-scenarios.json). 배치 엔진 회귀 기준. M0 소유, M1·M2 읽기 전용.
import { z } from "zod";
import { ClassGroupCode, IsoDate, LocationRef, StaffCode, StudentCode, Subject } from "./ids.ts";
import { ChangeOp } from "./change-ops.ts";
import { DiffType, ReasonCode } from "./scheduler.ts";

export const ScenarioTrigger = z.discriminatedUnion("type", [
  z.object({ type: z.literal("change_ops"), ops: z.array(ChangeOp).min(1), scope: z.enum(["this_week", "permanent"]) }),
  z.object({
    type: z.literal("setup_change"),
    patch: z.union([
      z.object({ student_placement: z.object({ student: StudentCode, subject: Subject, location: LocationRef }) }),
      z.object({ student_subject_support: z.object({
        student: StudentCode, subject: Subject,
        need_start: z.boolean().optional(), need_mid: z.boolean().optional(), need_end: z.boolean().optional(),
      }) }),
    ]),
  }),
  z.object({
    type: z.literal("timetable_import"),
    patch: z.object({ class_group: ClassGroupCode, date: IsoDate, swap_periods: z.tuple([z.number().int(), z.number().int()]) }),
  }),
  z.object({ type: z.literal("none") }),
]);

const Baseline = z.object({
  changed: z.number().int().min(0),
  gaps: z.number().int().min(0),
  late: z.number().int().min(0),
  kinds: z.partialRecord(DiffType, z.number().int().min(1)),
});

export const CascadeScenario = z.object({
  id: z.string().regex(/^S\d{1,2}$/),
  title: z.string(),
  date: IsoDate,
  trigger: ScenarioTrigger,
  chain: z.string(),
  checks: z.string(),
  expect: z.looseObject({
    change_kinds_include: z.array(DiffType).optional(),
    reason_codes_include: z.array(ReasonCode),
    max: z.object({ gaps: z.number().int().optional(), late: z.number().int().optional() }).optional(),
  }),
  baseline_heuristic: z.record(z.enum(["A", "B", "C"]), Baseline),
});

export const CascadeScenarioSet = z.object({
  _note: z.string(),
  base: z.object({ school: z.string(), data: z.string(), students: z.array(StudentCode), staff: z.array(StaffCode) }),
  policies: z.record(z.enum(["A", "B", "C"]), z.string()),
  scenarios: z.array(CascadeScenario).min(1),
});
export type CascadeScenario = z.infer<typeof CascadeScenario>;
