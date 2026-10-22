// 부족분 계산 (§8.4). 엔진과 validate가 같은 함수를 써서 결과가 어긋나지 않게 한다.
import type { Assignment, Demand, Shortfall } from "@ssyung/schema";
import { groupBy } from "./util.ts";

/** t부터 10분을 덮는 지원인력 수 */
const coverAt = (list: Assignment[], t: number) => new Set(list.filter((a) => a.start <= t && a.end >= t + 10).map((a) => a.staff)).size;

/**
 * 체크 안 된 구간을 이동 때문에 일부러 비웠는지 (EDGE_RELEASED, D22).
 * 비운 10분마다, 그 시간에 두 번째 이동을 하고 끝나자마자 이 수업을 이어 맡는 사람이 있어야 한다.
 */
function isWaived(t: number, mine: Assignment[], all: Assignment[]) {
  return mine.some((a) => a.start === t + 10 && all.some((b) => b.staff === a.staff && b.mode === "second_trip" && b.start === t && b.end === t + 10));
}

export function computeShortfalls(demands: Demand[], assignments: Assignment[]): Shortfall[] {
  const byDemand = groupBy(assignments, (a) => a.demand_id);
  const out: Shortfall[] = [];
  for (const d of demands) {
    const mine = byDemand.get(d.id) ?? [];
    const base = { demand_id: d.id, date: d.date };
    if (d.kind === "move_group") {
      const n = new Set(mine.map((a) => a.staff)).size;
      if (n < d.headcount) out.push({ ...base, start: d.start, end: d.end, short_by: d.headcount - n, priority: "MOVE", segment: null, waived: false });
      continue;
    }
    const parts =
      d.kind === "lesson"
        ? d.segments.map((s) => ({ start: s.start, end: s.end, priority: s.priority, segment: s.segment }))
        : [{ start: d.start, end: d.end, priority: "HIGH" as const, segment: null }];
    for (const p of parts) {
      let short = 0;
      const missing: number[] = [];
      for (let t = p.start; t < p.end; t += 10) {
        const s = d.headcount - coverAt(mine, t);
        if (s > 0) missing.push(t);
        short = Math.max(short, s);
      }
      if (!short) continue;
      const waived = p.priority === "LOW" && missing.every((t) => isWaived(t, mine, assignments));
      out.push({ ...base, start: p.start, end: p.end, short_by: short, priority: p.priority, segment: p.segment, waived });
    }
  }
  return out.sort((a, b) => a.date.localeCompare(b.date) || a.start - b.start || a.demand_id.localeCompare(b.demand_id));
}
