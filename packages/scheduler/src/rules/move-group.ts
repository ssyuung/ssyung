// 이동 묶음 (D12): 같은 층→같은 층 묶음은 1명이 쉬는 시간 전체를 맡는다. 묶음은 쪼개지 않는다.
import type { MoveGroupDemand } from "@ssyung/schema";

/** 쉬는 시간마다 늦으면 안 되는 묶음(늦게 도착 비용 높은 것)부터 먼저 배정 */
export const moveFirstPassOrder = (a: MoveGroupDemand, b: MoveGroupDemand) =>
  a.date.localeCompare(b.date) || a.start - b.start || b.late_cost - a.late_cost || a.id.localeCompare(b.id);
