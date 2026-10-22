// 연쇄 시나리오 실행 (fixtures/scenarios/cascade-scenarios.json).
// 입력은 목데이터로 조립한다: 수요 = demand/2026-09.json, 이전 배정 = schedule/active-2026-09.json, 근무 = domain/staff.json.
// 수요가 바뀌는 시나리오는 수요 생성(M3)이 있어야 해서 지금은 건너뛴다.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { CascadeScenario, ChangeOp, Demand, ProposeInput, ProposeOutput, StaffWindow } from "@ssyung/schema";
import { propose, validate, classify } from "../src/index.ts";

export const ROOT = join(import.meta.dirname, "..", "..", "..");
export const readJson = (rel: string) => JSON.parse(readFileSync(join(ROOT, rel), "utf8"));

/** 수요 변화가 없어 M3 없이 돌릴 수 있는 시나리오 */
export const RUNNABLE = ["S2", "S3", "S7"];
export const POLICY_OF = { A: "keep_minimal", B: "fresh", C: "no_late" } as const;

const DAYS = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];
const toMin = (hhmm: string) => +hhmm.slice(0, 2) * 60 + +hhmm.slice(3, 5);

/** 지원인력 근무 구간 + staff_unavailable 부재. 그 밖의 변경 명령은 수요가 바뀌므로 여기서 다루지 않는다 */
function staffWindows(date: string, ops: ChangeOp[]): StaffWindow[] {
  const day = DAYS[new Date(`${date}T00:00:00Z`).getUTCDay()];
  return readJson("fixtures/mock/domain/staff.json").map((a: any): StaffWindow => {
    const available = a.availability.filter((v: any) => v.day === day).map((v: any) => ({ start: v.start, end: v.end }));
    const absent: StaffWindow["absent"] = [];
    for (const op of ops) {
      if (op.op !== "staff_unavailable") throw new Error(`수요가 바뀌는 변경 명령은 아직 지원하지 않음: ${op.op}`);
      if (op.staff !== a.code) continue;
      for (const w of Array.isArray(op.when) ? op.when : [op.when]) {
        if (!("date" in w) || w.date !== date) continue;
        if ("start" in w) absent.push({ start: toMin(w.start), end: toMin(w.end) });
        else if (Object.keys(w).length === 1) absent.push(...available);
        else throw new Error(`지원하지 않는 시간 지칭: ${JSON.stringify(w)}`);
      }
    }
    return { staff: a.code, date, available, absent };
  });
}

export function scenarioInput(s: CascadeScenario): ProposeInput {
  const ops = s.trigger.type === "change_ops" ? s.trigger.ops : [];
  if (s.trigger.type !== "change_ops" && s.trigger.type !== "none") throw new Error(`수요 생성(M3)이 필요한 시나리오: ${s.id}`);
  const demands: Demand[] = readJson("fixtures/mock/demand/2026-09.json").demands.filter((d: Demand) => d.date === s.date);
  const active = readJson("fixtures/mock/schedule/active-2026-09.json");
  return {
    dates: [s.date],
    demands,
    staff: staffWindows(s.date, ops),
    previous: { demands, assignments: active.assignments.filter((a: any) => a.date === s.date) },
    pinned: [],
    policies: ["keep_minimal", "fresh", "no_late"],
    request: ops.length ? { change_request_id: null, ops } : null,
  };
}

export type Row = {
  id: string;
  title: string;
  skipped?: string;
  policies?: { key: "A" | "B" | "C"; got: { changed: number; gaps: number; late: number }; base: { changed: number; gaps: number; late: number }; worse: boolean }[];
  problems: string[];
  output?: ProposeOutput;
};

export async function runScenario(s: CascadeScenario): Promise<Row> {
  if (!RUNNABLE.includes(s.id)) return { id: s.id, title: s.title, skipped: "M3 이후 (Wave 2)", problems: [] };
  const input = scenarioInput(s);
  const output = await propose(input);
  const problems: string[] = [];
  const policies: NonNullable<Row["policies"]> = [];
  for (const [key, pol] of Object.entries(POLICY_OF) as [keyof typeof POLICY_OF, (typeof POLICY_OF)[keyof typeof POLICY_OF]][]) {
    const o = output.options.find((x) => x.policies.includes(pol))!;
    const base = s.baseline_heuristic[key];
    const got = { changed: o.metrics.changed_cells, gaps: o.metrics.gaps, late: o.metrics.late_students };
    const worse = got.gaps > base.gaps || got.late > base.late;
    if (worse) problems.push(`${key}: 기준선보다 나빠짐 (gaps ${got.gaps}>${base.gaps} 또는 late ${got.late}>${base.late})`);
    policies.push({ key, got, base: { changed: base.changed, gaps: base.gaps, late: base.late }, worse });
  }
  for (const o of output.options) {
    const v = validate({ demands: input.demands, staff: input.staff, pinned: input.pinned, assignments: o.assignments }).violations;
    if (v.length) problems.push(`${o.key}: 위반 ${v.length}건 (${[...new Set(v.map((x) => x.code))].join(", ")})`);
    const replanned = o.policies.every((p) => p === "fresh");
    const { unexplained } = classify(o.diff, { previous: input.previous, next: { demands: input.demands, assignments: o.assignments }, staff: input.staff, request: input.request });
    if (unexplained.length && !replanned) problems.push(`${o.key}: 설명 못 한 변경 ${unexplained.join(", ")}`);
  }
  const kinds = new Set(output.options.flatMap((o) => o.diff.map((d) => d.type)));
  const codes = new Set(output.options.flatMap((o) => o.explanation.map((e) => e.reason.code)));
  for (const k of s.expect.change_kinds_include ?? []) if (!kinds.has(k)) problems.push(`바뀌는 칸 종류 없음: ${k}`);
  for (const c of s.expect.reason_codes_include) if (!codes.has(c)) problems.push(`이유 코드 없음: ${c}`);
  return { id: s.id, title: s.title, policies, problems, output };
}

export async function runAll(): Promise<Row[]> {
  const set = readJson("fixtures/scenarios/cascade-scenarios.json");
  const rows: Row[] = [];
  for (const s of set.scenarios as CascadeScenario[]) rows.push(await runScenario(s));
  return rows;
}
