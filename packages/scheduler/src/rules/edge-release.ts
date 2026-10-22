// 시작 10분 비움 (D22): 두 번째 이동을 맡은 사람은 다음 수업의 시작 10분을 비운다.
// 비운 구간이 체크 안 된 구간이면 부족분이 waived(EDGE_RELEASED)로 나가고 지원 공백으로 세지 않는다 (shortfalls.ts).

/** 비울 수 있는 칸인지: 수업 지원이 정확히 두 번째 이동 시작 시각에 시작해야 한다 (수업 중간은 비우지 않음) */
export const canReleaseStart = (barStart: number, tripStart: number, pinned: boolean) => !pinned && barStart === tripStart;
