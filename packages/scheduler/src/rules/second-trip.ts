// 두 번째 이동 (D22): 쉬는 시간에 못 데려간 묶음은 다음 교시 첫 10분에 데려간다. 더 늦게는 옮기지 않는다.
import type { MoveGroupDemand } from "@ssyung/schema";

/** 늦게 도착 비용이 낮은 묶음부터 두 번째로 보낸다 */
export const secondTripOrder = (a: MoveGroupDemand, b: MoveGroupDemand) =>
  a.date.localeCompare(b.date) || a.start - b.start || a.late_cost - b.late_cost || a.id.localeCompare(b.id);

/**
 * 누가 데려갈지 점수 (낮을수록 먼저).
 * 0 = 그 10분이 비어 있음, 1 = 체크 안 된 시작 구간을 비움, 2 = 체크된 구간을 비움(마지막 수단).
 * 쉬는 시간에 이미 한 묶음을 데려간 사람이면 0, 아니면 0.5를 더한다.
 */
export const tripScore = (releaseCost: 0 | 1 | 2, didMoveInBreak: boolean) => releaseCost + (didMoveInBreak ? 0 : 0.5);
