# 계약 변경 요청: '다시 배정' 이유 코드

- 요청 모듈: M1
- 날짜: 2026-10-22
- 바꿀 것: `packages/schema/src/scheduler.ts`의 `ReasonCode`에 `REPLANNED` 추가
- 하위 호환: 예(값 추가)

## 이유
정책 `fresh`(처음부터 다시)는 이전 배정을 보지 않고 다시 배정한다. 그래서 이전 담당자가 비어 있는데도 담당이 바뀌는 칸이 생긴다. 지금 이유 코드(§8.7)로는 이 칸을 정직하게 설명할 수 없다.

예: `propose.staff-away` 선택지 B에서 `les:2026-09-18:S07:p1`이 A02 → A03으로 바뀐다. A02는 09:00–09:40에 다른 일이 없고 부재도 아니다. 즉 OVERLAP·UNAVAILABLE·CONTINUITY 어디에도 해당하지 않는다.
- 목데이터는 이런 칸을 `OVERLAP`으로 분류했는데, 실제 겹침이 없어 사실과 다르다.
- 같은 선택지에서 이런 칸이 5개다(`les:…:S07:p1`, `les:…:S06:p4`, `les:…:S07:p5`, `mv:…:b5:4-1`, `les:…:S02:p6`).

## 제안
```ts
export const ReasonCode = z.enum([
  "REQUESTED", "TIMETABLE_CHANGED", "MOVE_SUPPORT_NEEDED", "GROUP_MOVE", "EDGE_RELEASED",
  "OVERLAP", "UNAVAILABLE", "CONTINUITY", "GAP", "REPLANNED", "BALANCE", "ROTATION",
]);
```
`REPLANNED` = 처음부터 다시 배정하는 정책이라 연쇄 없이 담당이 바뀜. cause는 1(요청).
architecture.md §8.7 이유 코드 표에도 한 줄을 추가한다.

## 영향받는 모듈
- M1: 이 칸들을 `REPLANNED` 단계로 옮긴다.
- M8(W5)·core 문장 생성: 이유 코드 문장 하나를 추가한다.

## 그동안의 우회
`keep_previous`가 꺼진 정책(fresh)에서 연쇄로 설명하지 못한 칸은 1단계 `REQUESTED`에 넣는다. 목데이터도 1단계에 모든 칸을 넣고 있어 같은 방식이다. 이전 배정을 유지하는 정책(keep_minimal, no_late)은 이 우회를 쓰지 않고, 설명 못 한 칸이 있으면 테스트가 실패한다.
