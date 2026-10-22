// 선택지 만들기 (D23): 정책마다 엔진을 돌리고, 같은 배정이 나온 정책은 한 선택지로 합친다.
import type { Engine, Option, ProposeInput, ProposeOutput } from "@ssyung/schema";
import { heuristic, HEURISTIC_VERSION } from "./engines/heuristic.ts";
import { POLICIES } from "./policies/index.ts";
import { computeDiff } from "./diff.ts";
import { explain } from "./explain.ts";
import { computeMetrics } from "./metrics.ts";
import { assignmentSig } from "./util.ts";

export async function propose(input: ProposeInput, engine: Engine = heuristic): Promise<ProposeOutput> {
  const t0 = performance.now();
  const dates = new Set(input.dates);
  const demands = input.demands.filter((d) => dates.has(d.date));
  const staff = input.staff.filter((w) => dates.has(w.date));
  const previous = input.previous && {
    demands: input.previous.demands.filter((d) => dates.has(d.date)),
    assignments: input.previous.assignments.filter((a) => dates.has(a.date)),
  };
  const problem = { dates: input.dates, demands, staff, pinned: input.pinned, previous_assignments: previous?.assignments ?? [] };

  const options: (Omit<Option, "key"> & { sig: string })[] = [];
  for (const key of [...new Set(input.policies)]) {
    const policy = POLICIES[key];
    const res = await engine.assign(problem, policy);
    const sig = assignmentSig(res.assignments);
    const same = options.find((o) => o.sig === sig);
    if (same) {
      same.policies.push(key);
      same.label = `${same.label} · ${policy.label}`;
      continue;
    }
    const next = { demands, assignments: res.assignments };
    const diff = computeDiff(previous, next);
    options.push({
      sig,
      policies: [key],
      label: policy.label,
      assignments: res.assignments,
      shortfalls: res.shortfalls,
      metrics: computeMetrics(demands, res.assignments, res.shortfalls, diff, staff.map((w) => w.staff)),
      diff,
      explanation: explain(diff, { previous, next, staff, request: input.request, replanned: !policy.rules.keep_previous }),
    });
  }
  return {
    options: options.map(({ sig, ...o }, i) => ({ key: String.fromCharCode(65 + i), ...o })),
    engine: { name: engine.name, version: engine.name === "heuristic" ? HEURISTIC_VERSION : "unknown", elapsed_ms: Math.round(performance.now() - t0) },
  };
}
