// 선택지 기준 (D23). 정책 = 규칙 조합 + 체크된 시작 구간을 비울지.
import type { Policy, PolicyKey } from "@ssyung/schema";

const rules = (r: Partial<Policy["rules"]>): Policy["rules"] => ({
  move_group: true, segment_priority: true, second_trip: true, edge_release: true, keep_previous: true,
  balance: false, rotation: false, ...r,
});

export const POLICIES: Record<PolicyKey, Policy> = {
  keep_minimal: {
    key: "keep_minimal", label: "변경 최소", description: "지금 배정을 최대한 유지. 체크된 시작 구간은 비우지 않음",
    rules: rules({}), release_checked_start: false,
  },
  fresh: {
    key: "fresh", label: "처음부터 다시", description: "이전 배정에 묶이지 않고 다시 배정. 공백이 줄 수 있지만 많이 바뀜",
    rules: rules({ keep_previous: false }), release_checked_start: true,
  },
  no_late: {
    key: "no_late", label: "늦게 도착 없음", description: "두 번째 이동을 쓰지 않음. 모자라면 지원 공백",
    rules: rules({ second_trip: false }), release_checked_start: true,
  },
};
