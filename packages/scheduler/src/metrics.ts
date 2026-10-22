// 지표 (§8.3): 바뀌는 칸, 지원 공백, 늦게 도착, 알림 인원, 업무량·매칭 비율 (D17은 지표만)
import type { Assignment, Demand, DiffEntry, Metrics, Shortfall } from "@ssyung/schema";
import { studentsOf } from "./util.ts";

export function computeMetrics(demands: Demand[], assignments: Assignment[], shortfalls: Shortfall[], diff: DiffEntry[], staffCodes: string[]): Metrics {
  const byId = new Map(demands.map((d) => [d.id, d]));
  const gaps = new Set(shortfalls.filter((s) => !s.waived).map((s) => s.demand_id)).size;
  const late = assignments
    .filter((a) => a.mode === "second_trip")
    .reduce((n, a) => n + (byId.has(a.demand_id) ? studentsOf(byId.get(a.demand_id)!).length : 0), 0);

  const staffMinutes: Record<string, number> = {};
  for (const s of [...new Set(staffCodes)].sort()) staffMinutes[s] = 0;
  const per: Record<string, Record<string, number>> = {};
  for (const a of assignments) {
    const m = a.end - a.start;
    staffMinutes[a.staff] = (staffMinutes[a.staff] ?? 0) + m;
    const d = byId.get(a.demand_id);
    if (!d) continue;
    for (const s of studentsOf(d)) (per[s] ??= {})[a.staff] = (per[s][a.staff] ?? 0) + m;
  }
  const pairShare: Record<string, number> = {};
  for (const s of Object.keys(per).sort()) {
    const tot = Object.values(per[s]).reduce((x, y) => x + y, 0);
    for (const a of Object.keys(per[s]).sort()) pairShare[`${a}:${s}`] = Math.round((per[s][a] / tot) * 100) / 100;
  }

  const notify = new Set<string>();
  for (const e of diff) for (const x of [e.before?.staff, e.after?.staff]) if (x) notify.add(x);
  return { changed_cells: diff.length, gaps, late_students: late, notify_staff: [...notify].sort(), staff_minutes: staffMinutes, pair_share: pairShare };
}
