// 임시 규칙 엔진 (§8.0). 화면 시안 docs/screens/ssyung-screens.html의 buildDay() 배정 부분을 옮김.
// ① 쉬는 시간 이동: 늦으면 안 되는 묶음부터 배정
// ② 수업 지원·업무: 이전 담당 → 같은 학생 이어 맡기 → 비어 있는 첫 사람
// ③ 못 데려간 묶음은 다음 교시 첫 10분에 두 번째 이동 (D22)
import type { AssignProblem, Assignment, Demand, Engine, MoveGroupDemand, Policy, StaffWindow } from "@ssyung/schema";
import { computeShortfalls } from "../shortfalls.ts";
import { byStartStaff, canWork, overlaps, studentsOf } from "../util.ts";
import { moveFirstPassOrder } from "../rules/move-group.ts";
import { releaseStartCost } from "../rules/segment-priority.ts";
import { secondTripOrder, tripScore } from "../rules/second-trip.ts";
import { canReleaseStart } from "../rules/edge-release.ts";
import { previousStaff } from "../rules/keep-previous.ts";

type Bar = { staff: string; demand: Demand; start: number; end: number; mode: Assignment["mode"]; pinned: boolean };

function assignDay(date: string, demands: Demand[], windows: StaffWindow[], pinned: Assignment[], prev: Map<string, string[]>, policy: Policy): Assignment[] {
  const win = new Map(windows.map((w) => [w.staff, w]));
  const staffList = [...win.keys()].sort();
  const byId = new Map(demands.map((d) => [d.id, d]));
  const bars: Bar[] = [];
  const last = new Map<string, string>(); // 학생 → 마지막으로 맡긴 사람

  const free = (a: string, s: number, e: number) => canWork(win.get(a), s, e) && !bars.some((b) => b.staff === a && overlaps(b.start, b.end, s, e));
  const put = (d: Demand, staff: string, start = d.start, end = d.end, mode: Bar["mode"] = "normal", isPinned = false) => {
    bars.push({ staff, demand: d, start, end, mode, pinned: isPinned });
    for (const s of studentsOf(d)) last.set(s, staff);
  };
  const taken = (d: Demand) => new Set(bars.filter((b) => b.demand.id === d.id).map((b) => b.staff));
  const choose = (d: Demand): string | undefined => {
    const busy = taken(d);
    const ok = (a: string | undefined): a is string => a !== undefined && !busy.has(a) && free(a, d.start, d.end);
    if (policy.rules.keep_previous) for (const a of prev.get(d.id) ?? []) if (ok(a)) return a;
    const order = [...studentsOf(d).map((s) => last.get(s)), ...staffList].filter(ok);
    if (!policy.rules.keep_previous) return order[0];
    // 아직 놓지 않은 수요의 이전 담당자는 그 수요를 위해 남겨 둔다 (다른 사람이 없을 때만 씀)
    return order.find((a) => !isHeldFor(a, d)) ?? order[0];
  };
  const isHeldFor = (a: string, d: Demand) =>
    demands.some((x) => x !== d && overlaps(x.start, x.end, d.start, d.end) && prev.get(x.id)?.includes(a) && taken(x).size < x.headcount && canWork(win.get(a), x.start, x.end));
  const fill = (d: Demand) => {
    let need = d.headcount - taken(d).size;
    while (need-- > 0) {
      const a = choose(d);
      if (!a) return false;
      put(d, a);
    }
    return true;
  };

  // 고정 배정은 먼저 놓는다
  for (const p of pinned) {
    const d = byId.get(p.demand_id);
    if (d) put(d, p.staff, p.start, p.end, p.mode, true);
  }

  const moves = demands.filter((d): d is MoveGroupDemand => d.kind === "move_group").sort(moveFirstPassOrder);
  const pending = moves.filter((d) => !fill(d));
  demands
    .filter((d) => d.kind !== "move_group")
    .sort((a, b) => a.start - b.start || a.id.localeCompare(b.id))
    .forEach(fill);

  if (policy.rules.second_trip) {
    for (const d of pending.sort(secondTripOrder)) {
      const s0 = d.second_trip.start, e0 = d.second_trip.end;
      let best: { a: string; score: number; bar?: Bar } | undefined;
      for (const a of staffList) {
        if (!canWork(win.get(a), s0, e0)) continue;
        const hit = bars.filter((b) => b.staff === a && overlaps(b.start, b.end, s0, e0));
        if (hit.some((b) => b.demand.kind === "move_group" || !canReleaseStart(b.start, s0, b.pinned))) continue;
        if (hit.length && !policy.rules.edge_release) continue;
        const bar = hit[0];
        const cost = bar ? releaseStartCost(bar.demand, policy.rules.segment_priority) : 0;
        if (!policy.release_checked_start && cost >= 2) continue;
        const did = bars.some((b) => b.staff === a && b.end === s0 && b.demand.kind === "move_group");
        const score = tripScore(cost, did);
        if (!best || score < best.score) best = { a, score, bar };
      }
      if (!best) continue;
      if (best.bar) {
        best.bar.start = e0;
        if (best.bar.start >= best.bar.end) bars.splice(bars.indexOf(best.bar), 1);
      }
      put(d, best.a, s0, e0, "second_trip");
    }
  }

  return bars.map((b) => ({ staff: b.staff, demand_id: b.demand.id, date, start: b.start, end: b.end, mode: b.mode, pinned: b.pinned }));
}

export const heuristic: Engine = {
  name: "heuristic",
  async assign(problem: AssignProblem, policy: Policy) {
    const prev = previousStaff(problem.previous_assignments);
    const assignments: Assignment[] = [];
    for (const date of [...new Set(problem.dates)].sort()) {
      assignments.push(
        ...assignDay(
          date,
          problem.demands.filter((d) => d.date === date),
          problem.staff.filter((w) => w.date === date),
          problem.pinned.filter((p) => p.date === date),
          prev,
          policy,
        ),
      );
    }
    assignments.sort(byStartStaff);
    return { assignments, shortfalls: computeShortfalls(problem.demands, assignments) };
  },
};

export const HEURISTIC_VERSION = "heuristic-v1";
