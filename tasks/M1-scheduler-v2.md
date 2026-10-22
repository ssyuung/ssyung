# M1 배치 엔진 v2 (계약 따라가기, 시나리오 10개, 지난 칸 고정)

> 상태: 진행
> 브랜치 `<id>/m1-scheduler-v2` · 범위 `packages/scheduler/**` (단 `src/engines/cpsat/` 제외, M2 소유) · 공통 규칙 `CLAUDE.md`
> 이전 버전: `tasks/M1-scheduler.md`(v1, 완료). 그때 쓴 보드·질문 파일은 이어서 쓴다.

## 배경
v1 merge 뒤 바뀐 것:
- 계약 0.2.0 → 0.3.1. 요청 4건이 받아들여졌다(`contracts/requests/README.md`).
- D24(오늘 변경은 요청 시각부터)와 D25(특수학급 시간표)가 정해졌다(architecture.md §0.3, §8.1, §8.2-7).
- **목데이터와 시나리오 기준선이 v1 엔진 결과로 다시 만들어졌다.** 수요 생성은 `@ssyung/core`(M3, merge됨)가 한다. 시나리오 10개 모두 `fixtures/scenarios/inputs/S*.input.json`이 있다.

## 목표

### 1. 계약 따라가기 (우회 지우기)
- `REPLANNED`: `keep_previous`가 꺼진 정책(fresh)에서 연쇄로 설명 못 한 칸은 1단계 `REQUESTED`에 넣던 우회를 지운다. 대신 `REPLANNED` 단계(cause = 그 요청 단계)로 둔다.
- `validate()` 출력에서 `warnings`를 뺀다. 배치 경고는 API(M7)가 계산한다.
- `scripts/scenario-lib.ts`의 입력 조립(수요·근무·이전 배정을 목데이터로 만들던 코드)을 지우고 `fixtures/scenarios/inputs/`의 입력 파일을 그대로 읽는다. `RUNNABLE` 목록을 없애고 **시나리오 10개를 모두 돌린다.**
- 시각 변환·요일 계산은 `@ssyung/schema`의 공용 함수(`hhmmToMinute`, `weekdayOf` 등)를 쓴다.

### 2. 설명 이유 코드
지금 기대 결과(`expect.reason_codes_include`)가 안 맞는 시나리오가 둘 있다.
- **S5 `GROUP_MOVE` (D12):** 이전에도 있던 이동 묶음에 학생이 합류해(학생이 늘어남) 그 학생의 이동 담당이 묶음 담당자로 바뀐 칸.
  - 새 묶음이 생기거나 없어진 것은 지금처럼 `MOVE_SUPPORT_NEEDED`다.
  - 묶음 구성이 바뀐 칸(`group`) 중 합류는 `GROUP_MOVE`, 빠짐은 `MOVE_SUPPORT_NEEDED`.
- **S10 `TIMETABLE_CHANGED`:** 계약 0.3.1 `ProposeInput.request.cause`를 읽는다. 1단계 이유 코드는 `timetable_import`면 `TIMETABLE_CHANGED`, `change_request`·`setup`·없음이면 `REQUESTED`다. `op_index`는 ops가 있을 때만 붙인다.

### 3. 지난 칸 고정 (D24, architecture.md §8.2-7)
- `ProposeInput.now`가 있으면 `now.date`의 이전 배정 중 `start < now.minute`인 것은 그대로 둔다. 진행 중인 칸도 마찬가지이고, pinned처럼 먼저 놓는다.
  - 수요 생성(M3)이 같은 기준으로 그 칸들의 수요를 바꾸지 않으므로, 고정한 배정의 수요는 항상 있다.
  - 혹시 없으면 고정하지 않고 테스트에서 알 수 있게 한다.
- 다른 날짜, `now`가 없거나 `null`이면 지금처럼 동작한다.
- `validate()`: `ValidateInput.now`와 `previous`가 있으면, `now` 이전에 시작한 이전 배정이 `assignments`에 그대로 없을 때 `BEFORE_NOW_CHANGED`를 낸다.
- diff·지표: 고정된 칸은 바뀌지 않으므로 diff에 나오지 않고, `notify_staff`에도 들어가지 않는다.
- 고정 배정은 `engine.assign`에 넘기는 문제의 `frozen`(계약 `AssignProblem.frozen`, 0.3.1)으로 전달한다. 계약 `AssignRequest.frozen`과 같은 뜻이라 CP-SAT 어댑터(M2)도 그대로 쓴다. 임시 규칙 엔진도 `propose`가 미리 거른 결과가 아니라 이 필드를 보고 고정한다.

### 4. 정리
- `explain.ts`를 단순하게 다시 짠다(v1 리뷰).
  - 지금은 `"CODE#op"` 문자열 키, 순환 대비 예외 처리가 섞여 있다.
  - 단계 = (이유 코드, 원인 명령) 묶음이고, 원인 단계를 따라 번호를 매긴다는 구조가 코드에서 바로 읽히게 한다.
  - 테스트(설명 못 하는 변경 금지, 단계 번호 규칙)는 그대로 통과해야 한다.
- `RuleKey.move_group`은 읽지 않는다(항상 켜짐, 계약 1.0에서 빠짐). 정책 정의에는 그대로 둔다.

## 읽을 것
- docs/architecture.md §8 (특히 §8.2-7, §8.7)
- `contracts/requests/README.md` (받아들인 요청과 할 일)
- `fixtures/scenarios/cascade-scenarios.json`, `fixtures/scenarios/inputs/`
- `tasks/board/M1.md`, `tasks/M1-questions.md` (v1 때 남긴 것)

## 완료 조건
- [ ] `pnpm --filter @ssyung/scheduler typecheck`, `test` 통과
- [ ] `pnpm --filter @ssyung/scheduler scenarios`: **10개 모두 실행**하고 실패 0개
  - 정책 A·B·C마다 공백·늦게 도착이 기준선(`baseline_heuristic`)보다 나빠지지 않는다.
  - 모든 시나리오의 `expect`(바뀌는 칸 종류, 이유 코드, 상한)를 만족한다. 지금 S5·S10은 안 맞는다.
- [ ] 반환한 모든 선택지가 `validate()` 위반 0건, diff의 모든 칸이 설명 단계에 있다(fresh 포함, 우회 없이).
- [ ] D24 테스트 (`propose.staff-away.input.json`을 바탕으로)
  - `now = { date: 2026-09-18, minute: 620 }`이면 그날 10:20 전에 시작한 이전 배정이 모든 선택지에 그대로 있다.
  - `now`가 없으면 v1과 같은 결과다.
  - `validate`에 `now`·`previous`를 주고 지난 칸 하나를 바꾸면 `BEFORE_NOW_CHANGED`가 나온다.
- [ ] `validate()` 출력에 `warnings` 키가 없다.
- [ ] 같은 입력이면 같은 결과, 하루 입력 1초 이내.
- [ ] 결과 숫자가 바뀌면(설명 단계, 바뀐 칸 수) PR 본문에 기준선 대비 비교표를 붙인다. 목데이터·기준선은 고치지 않는다. merge 뒤 M0가 다시 만든다.

## 범위 밖
- CP-SAT(M2, `src/engines/cpsat/`)
- 정책마다 엔진 고르기(v3)
- 업무강도 균형·매칭 분산(D17 보류)
- 인원 2명 이상 수요의 diff(업무 데이터가 생기면)

## 산출물
보드 `tasks/board/M1.md`를 v2로 갱신(이번 버전 완료 조건 체크, 다음에 할 것, 다른 모듈에 필요한 것). 변경 요약, 시나리오 10개 비교표, 남은 질문(`tasks/M1-questions.md`).
