# M3 수요 생성 v1

> 브랜치 `<id>/m3-demand` · 범위 `packages/core/**` · 공통 규칙 `CLAUDE.md`

## 목표
`@ssyung/core` 패키지의 `src/demand/`에 수요 생성을 구현한다 (docs/architecture.md §8.1).

```ts
generateDemands(input: {
  school: SchoolBundle; timetable: Timetable; students: Student[];
  dates: IsoDate[]; ops?: ChangeOp[];          // 변경 요청 반영 (mark_absent, set_placement, relocate_class, set_support)
}): DemandSet
```

- 수업 지원:
  - 배치 우선순위: `placement_override` → `special_class_subjects` → 원반.
  - 특수학급 수업은 수요를 만들지 않는다.
  - 지원 과목만 수요를 만들고, 구간 3개를 둔다(체크된 구간이 HIGH).
- 이동 묶음: (날짜, 쉬는 시간, 출발 층, 도착 층)으로 묶는다(D12).
  - 학생별 `late_cost`(D22). 묶음 비용은 학생 비용의 최댓값.
  - `second_trip`은 다음 교시 첫 10분.
- 점심을 사이에 둔 이동은 수요를 만들지 않는다(업무로 다룸).
- 수요 id 형식은 docs/contracts.md §2.1을 그대로 따른다.

## 읽을 것
- docs/architecture.md §4.3–4.5, §8.1
- docs/contracts.md
- `packages/schema/src/demand.ts`, `change-ops.ts`

## 완료 조건
- [ ] `pnpm --filter @ssyung/core typecheck`, `test` 통과
- [ ] 목데이터 대조, 값까지 같아야 한다:
  - [ ] `fixtures/mock/domain/*`(school, students, timetable) → 9월 전체가 `fixtures/mock/demand/2026-09.json`과 같다. id로 정렬해 비교한다.
  - [ ] `ops`에 `mark_absent S03 2026-09-18` → `scheduler/propose.absent.input.json`의 demands와 같다.
- [ ] 휴일(9/24·25), 시간표 없는 반(1-3), 특수학급 과목만 있는 날에 수요가 생기지 않는다.
- [ ] `set_placement`, `relocate_class`, `set_support`마다 단위 테스트(이동 묶음이 생기고, 바뀌고, 합쳐지는 경우). 기대값은 테스트 안에 손으로 계산해 적는다.

## 범위 밖
- 배정(M1)
- 업무(duty) 펼치기. 데이터가 없으니 함수 자리만 둔다.
- When → 날짜·시각 계산 외의 `packages/core` 기능(설명 문장화)

## 주의
목데이터 값과 다르면 먼저 내 코드를 의심한다. 목데이터가 틀렸다고 판단되면 근거와 함께 `contracts/requests/M3-<주제>.md`.

## 산출물
변경 요약, 목데이터 대조 결과, 남은 질문(`tasks/M3-questions.md`).
