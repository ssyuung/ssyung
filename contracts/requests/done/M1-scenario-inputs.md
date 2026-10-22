# 계약 변경 요청: 연쇄 시나리오 입력을 fixtures로 고정

- 요청 모듈: M1
- 날짜: 2026-10-22
- 바꿀 것: `fixtures/scenarios/inputs/S<n>.input.json`(새 파일, 계약 `ProposeInput`), `fixtures/mock/manifest.json`
- 하위 호환: 예(파일 추가)

## 이유
`cascade-scenarios.json`에는 trigger와 기준선만 있고 엔진 입력이 없다. 그래서 M1은 입력을 직접 조립하고 있다(`packages/scheduler/scripts/scenario-lib.ts`).
- 수요: `demand/2026-09.json`
- 이전 배정: `schedule/active-2026-09.json`
- 근무: `domain/staff.json` + `staff_unavailable`

이렇게 하면 문제가 세 가지 있다.
- M2(CP-SAT)가 같은 시나리오를 돌리려면 같은 조립 코드를 다시 만들어야 한다. "두 엔진을 같은 시나리오로 검증"(§8.0)이 모듈마다 다른 입력으로 깨질 수 있다.
- 다른 모듈 코드를 import할 수 없어(CLAUDE.md 규칙 2) 조립 코드를 공유할 수 없다.
- 수요가 바뀌는 7개(S1, S4–S6, S8–S10)는 M3 결과가 있어야 입력이 생긴다. 고정 입력이 있으면 M1·M2는 M3 merge를 기다리지 않아도 된다.

## 제안
- `scripts/mock/build-mocks.ts`가 시나리오마다 `fixtures/scenarios/inputs/S<n>.input.json`(`ProposeInput`)을 만든다.
  - 수요가 바뀌는 시나리오는 M3가 merge되면 그 결과로 만든다.
- `cascade-scenarios.json`의 각 시나리오에 `input: "inputs/S2.input.json"`을 추가한다(`CascadeScenario.input` 선택 필드).
- S2는 지금 `scheduler/propose.staff-away.input.json`과 같은 문제다(M1 테스트로 확인). 같은 파일을 가리켜도 된다.

## 영향받는 모듈
- M1: `scenario-lib.ts`의 조립 코드를 지우고 파일을 읽는다.
- M2: 같은 파일로 시나리오를 돌린다.
- M3: 수요 생성 결과가 시나리오 입력의 기대값이 된다.

## 그동안의 우회
M1이 목데이터로 S2·S3·S7 입력을 조립한다. 나머지 7개는 건너뜀으로 표시한다.
