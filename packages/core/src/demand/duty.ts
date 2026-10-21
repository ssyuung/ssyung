// 업무 수요 (architecture.md §8.1 ④). 업무 데이터가 아직 없어 자리만 둔다.
import type { Demand, Duty, IsoDate } from "@ssyung/schema";

/** 업무를 날짜 범위에 펼친다. 아직 구현하지 않음 */
export function expandDuties(_duties: Duty[], _dates: IsoDate[]): Extract<Demand, { kind: "duty" }>[] {
  return [];
}
