// CP-SAT 서비스(services/solver, M2) HTTP 계약 (architecture.md §9.2). 라벨·메모는 보내지 않는다.
import { z } from "zod";
import { IsoDate } from "./ids.ts";
import { Demand } from "./demand.ts";
import { Assignment, Policy, Shortfall, StaffWindow, ValidateInput, ValidateOutput } from "./scheduler.ts";

export const AssignRequest = z.object({
  dates: z.array(IsoDate).min(1),
  demands: z.array(Demand),
  staff: z.array(StaffWindow),
  pinned: z.array(Assignment),
  previous_assignments: z.array(Assignment),
  policy: Policy,
  time_limit_ms: z.number().int().min(100).max(60000),
});
export const AssignResponse = z.object({
  status: z.enum(["optimal", "feasible", "error"]).describe("feasible = 시간 안에 최적을 못 찾아 최선 해"),
  assignments: z.array(Assignment),
  shortfalls: z.array(Shortfall),
  solver_meta: z.object({
    elapsed_ms: z.number().int().min(0),
    objective_stages: z.array(z.number()).describe("§8.3 단계별 목적값"),
    message: z.string().nullable(),
  }),
});
/** POST /validate: 배치 엔진의 validate()와 같은 형식 */
export const SolverValidateRequest = ValidateInput;
export const SolverValidateResponse = ValidateOutput;

export type AssignRequest = z.infer<typeof AssignRequest>;
export type AssignResponse = z.infer<typeof AssignResponse>;
