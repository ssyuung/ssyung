// 지원 구간 우선순위 (D13): 체크 안 된 구간은 이동 때문에 비울 수 있고, 체크된 구간은 마지막 수단.
import type { Demand } from "@ssyung/schema";

/** 시작 10분을 비울 때의 비용. 1 = 체크 안 된 시작 구간, 2 = 체크된 구간(마지막 수단) */
export function releaseStartCost(d: Demand, segmentPriority: boolean): 1 | 2 {
  if (!segmentPriority || d.kind !== "lesson") return 2;
  return d.segments.find((s) => s.segment === "start")?.priority === "LOW" ? 1 : 2;
}
