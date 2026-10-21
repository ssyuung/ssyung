// 이전 배정 유지: 같은 수요(id)를 이전에 맡던 사람이 비어 있으면 그대로 맡긴다.
import type { Assignment } from "@ssyung/schema";
import { byStartStaff } from "../util.ts";

/** 수요 id → 이전 담당자들 (시작 시각 순) */
export function previousStaff(previous: Assignment[]): Map<string, string[]> {
  const m = new Map<string, string[]>();
  for (const a of [...previous].sort(byStartStaff)) {
    const list = m.get(a.demand_id) ?? [];
    if (!list.includes(a.staff)) list.push(a.staff);
    m.set(a.demand_id, list);
  }
  return m;
}
