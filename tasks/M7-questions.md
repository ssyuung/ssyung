# M7 질문

사람이 답하는 곳. 답이 오기 전에는 각 항목의 "지금은"대로 진행했다.

## Q1. SPECIAL_CLASS_CROWDED 기준 — 답함
한 특수학급 한 칸에 학생이 몇 명을 넘으면 경고할까요?
- 답: 5명 (2026-10-22). `apps/web/server/warnings.ts` `CROWDED_LIMIT = 5`, 5명 초과면 경고.

## Q2. 매주 반복 변경(`{ day, period }`, scope: permanent) — 답함
`change.confirm`에서 요일 지정 변경을 어느 날짜까지 펼쳐 다시 배정할까요? (active 버전 기간의 남은 날짜 전부? 다음 주까지?)
- 답: 당분간 거부 (2026-10-22). `NOT_IMPLEMENTED`("매주 반복하는 변경은 아직 반영하지 못해요"). 날짜 지정 변경만 반영.

## Q3. draft 활성화의 범위 — 답함
`schedule.generate`로 만든 draft(예: 9/14–9/18)를 활성화하면 active가 그 기간만 덮습니다. 그 밖의 날짜(9월 나머지)는 이전 active에서 가져와 합칠까요?
- 답: 합친다 (2026-10-22). draft 기간만 draft 배정으로 바꾸고 나머지 날짜는 이전 active 그대로. 새 버전 기간은 둘을 합친 것(9/1–9/30).

## Q4. 버전에 쌓인 변경과 추가 수요 — 답함
- 답: 따로 저장하지 않는다. 처음엔 간단히 (2026-10-22). 승인한 ops를 버전에 쌓아 두고 다음 변경 때 다시 적용하는 지금 방식 유지.

## Q5. school.import의 시간표 기간 — 답함
- 답: 지금은 목데이터에 있는 기간(2026-09-01–09-30) (2026-10-22). `deps.importRange`.

## Q6. 학생 행의 장소와 변경 — 답함
`view.day`의 학생 행(`lessons[].location`)은 기본 규칙(특수학급 시간표 D25, 원반은 반 교실)만 씁니다. 승인된 `set_placement`·`relocate_class`를 행에도 반영할까요?
- 답: 반영한다. 하나의 정보를 보고 고치면 같이 바뀌게 (2026-10-22). 학생 행을 수요와 같은 ops·now로 계산한다. 규칙을 한 곳(M3)에 두도록 contracts/requests/M7-core-placement-export.md 요청.
