// 검증 (§8.5). W4에서 끌어 놓을 때마다 호출. 하드 제약 위반과 부족분을 돌려준다.
import type { Assignment, ValidateInput, ValidateOutput } from "@ssyung/schema";
import { computeShortfalls } from "./shortfalls.ts";
import { byStartStaff, groupBy, overlaps } from "./util.ts";

type Violation = ValidateOutput["violations"][number];

export function validate(input: ValidateInput): ValidateOutput {
  const demands = new Map(input.demands.map((d) => [d.id, d]));
  const win = new Map(input.staff.map((w) => [`${w.staff}|${w.date}`, w]));
  const v: Violation[] = [];
  const at = (a: Assignment) => ({ date: a.date, start: a.start, end: a.end });

  for (const a of input.assignments) {
    const d = demands.get(a.demand_id);
    if (!d) {
      v.push({ code: "UNKNOWN_DEMAND", staff: a.staff, demand_ids: [a.demand_id], ...at(a) });
      continue;
    }
    const w = win.get(`${a.staff}|${a.date}`);
    if (!w || !w.available.some((x) => x.start <= a.start && a.end <= x.end))
      v.push({ code: "OUTSIDE_AVAILABILITY", staff: a.staff, demand_ids: [a.demand_id], ...at(a) });
    if (w?.absent.some((x) => overlaps(a.start, a.end, x.start, x.end)))
      v.push({ code: "ABSENT", staff: a.staff, demand_ids: [a.demand_id], ...at(a) });
    // 이동 묶음은 쉬는 시간 그대로이거나, 두 번째 이동이면 다음 교시 첫 10분 안 (D22)
    if (d.kind === "move_group") {
      const ok = a.mode === "second_trip"
        ? d.second_trip.start <= a.start && a.end <= d.second_trip.end
        : a.start === d.start && a.end === d.end;
      if (!ok) v.push({ code: "SECOND_TRIP_WINDOW", staff: a.staff, demand_ids: [a.demand_id], ...at(a) });
    } else if (a.mode === "second_trip") {
      v.push({ code: "SECOND_TRIP_WINDOW", staff: a.staff, demand_ids: [a.demand_id], ...at(a) });
    }
  }

  // 한 사람은 한 시점에 한 곳
  for (const [, list] of groupBy(input.assignments, (a) => `${a.staff}|${a.date}`)) {
    const sorted = [...list].sort(byStartStaff);
    for (let i = 0; i < sorted.length; i++)
      for (let j = i + 1; j < sorted.length && sorted[j].start < sorted[i].end; j++)
        v.push({
          code: "OVERLAP", staff: sorted[i].staff, demand_ids: [sorted[i].demand_id, sorted[j].demand_id],
          date: sorted[i].date, start: sorted[j].start, end: Math.min(sorted[i].end, sorted[j].end),
        });
  }

  // 이동 묶음은 1명. 0명은 위반이 아니라 부족분(지원 공백)으로 나간다
  for (const [id, list] of groupBy(input.assignments, (a) => a.demand_id)) {
    const d = demands.get(id);
    if (d?.kind === "move_group" && new Set(list.map((a) => a.staff)).size > d.headcount)
      v.push({ code: "MOVE_GROUP_HEADCOUNT", staff: null, demand_ids: [id], date: d.date, start: d.start, end: d.end });
  }

  const same = (p: Assignment, a: Assignment) =>
    p.staff === a.staff && p.demand_id === a.demand_id && p.date === a.date && p.start === a.start && p.end === a.end && p.mode === a.mode;
  for (const p of input.pinned)
    if (!input.assignments.some((a) => same(p, a))) v.push({ code: "PINNED_CHANGED", staff: p.staff, demand_ids: [p.demand_id], ...at(p) });

  // 경고(SPECIAL_CLASS_CROWDED, NO_SPECIAL_TEACHER)는 특수학급 배치 정보가 입력에 없어 아직 계산하지 않는다
  return { violations: v, shortfalls: computeShortfalls(input.demands, input.assignments), warnings: [] };
}
