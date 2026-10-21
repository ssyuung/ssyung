// 이전 ↔ 새 배정 비교 (§8.0). 엔진과 무관하게 수요 id 기준으로 칸마다 한 줄.
import type { Assignment, Demand, DiffEntry } from "@ssyung/schema";
import { byStartStaff, groupBy, studentsOf } from "./util.ts";

export type Plan = { demands: Demand[]; assignments: Assignment[] };

type Slot = NonNullable<DiffEntry["before"]>;

function slotOf(d: Demand, list: Assignment[]): Slot {
  return {
    staff: list[0]?.staff ?? null,
    start: list.length ? Math.min(...list.map((a) => a.start)) : d.start,
    end: list.length ? Math.max(...list.map((a) => a.end)) : d.end,
    students: studentsOf(d),
  };
}

const staffKey = (list: Assignment[]) => [...new Set(list.map((a) => a.staff))].sort().join(",");

/** 두 번째 이동으로 옮겼거나 시작 10분을 비워 시각이 바뀐 배정 */
export const isRetimed = (d: Demand, list: Assignment[]) => list.some((a) => a.mode === "second_trip" || a.start > d.start);

/** previous가 null이면(최초 생성) 비교할 것이 없어 빈 목록이다. 공백은 shortfalls·metrics.gaps로 본다 */
export function computeDiff(previous: Plan | null, next: Plan): DiffEntry[] {
  if (!previous) return [];
  const before = previous;
  const oldAsg = groupBy([...before.assignments].sort(byStartStaff), (a) => a.demand_id);
  const newAsg = groupBy([...next.assignments].sort(byStartStaff), (a) => a.demand_id);
  const newById = new Map(next.demands.map((d) => [d.id, d]));
  const oldIds = new Set(before.demands.map((d) => d.id));
  const out: DiffEntry[] = [];

  for (const o of before.demands) {
    const ol = oldAsg.get(o.id) ?? [];
    const n = newById.get(o.id);
    if (!n) {
      out.push({ demand_id: o.id, type: "removed", before: slotOf(o, ol), after: null });
      continue;
    }
    const nl = newAsg.get(n.id) ?? [];
    const b = slotOf(o, ol), a = slotOf(n, nl);
    let type: DiffEntry["type"] | null = null;
    if (staffKey(ol) !== staffKey(nl)) type = !nl.length ? "gap" : isRetimed(n, nl) ? "retimed" : "moved";
    else if (b.students.join() !== a.students.join()) type = "group";
    else if (b.start !== a.start || b.end !== a.end) type = "retimed";
    if (type) out.push({ demand_id: o.id, type, before: b, after: a });
  }
  for (const n of next.demands) {
    if (oldIds.has(n.id)) continue;
    const nl = newAsg.get(n.id) ?? [];
    out.push({ demand_id: n.id, type: nl.length ? "added" : "gap", before: null, after: slotOf(n, nl) });
  }
  return out.sort((x, y) => (x.before ?? x.after)!.start - (y.before ?? y.after)!.start || x.demand_id.localeCompare(y.demand_id));
}
