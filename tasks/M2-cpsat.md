# M2 CP-SAT 엔진 v1

> 상태: 진행
> 브랜치 `<id>/m2-cpsat` · 범위 `services/solver/**`, `packages/scheduler/src/engines/cpsat/**` · 공통 규칙 `CLAUDE.md`

## 목표
배치 엔진의 두 번째 구현을 만든다. 임시 규칙 엔진(M1, `heuristic`)과 **같은 계약, 같은 시나리오, 같은 검사기**로 비교한다(architecture.md §8.0, §8.2–8.4, §9.2).

1. **`services/solver`**: Python + FastAPI + OR-Tools CP-SAT
   - `GET /health`
   - `POST /assign`: 계약 `AssignRequest` → `AssignResponse`(배정 + 부족분 + `solver_meta`)
   - 입출력 모델은 `packages/schema/generated/json/AssignRequest.json`·`AssignResponse.json`(JSON Schema)에서 만든다.
     - 생성기 스크립트와 결과를 `services/solver/ssyung_schema/`에 둔다.
     - 손으로 같은 모양을 다시 쓰지 않는다.
   - `/validate`는 v1 범위 밖이다. 검증은 TS `validate()`(M1)를 쓴다.
2. **`packages/scheduler/src/engines/cpsat/`**: TS 어댑터 `cpsatEngine({ url, timeLimitMs })`
   - 계약 `Engine` 인터페이스(`assign(problem, policy)`)를 구현한다.
   - 하는 일: `AssignProblem`을 `AssignRequest`로 바꿔 `/assign`에 보내고, 응답을 돌려준다.
   - `propose(input, cpsatEngine(...))`로 쓰면 diff·설명·지표는 M1 코드가 그대로 만든다.
   - 이 디렉터리 밖의 scheduler 파일(`package.json` 포함)은 M1 소유라 고치지 않는다.

## 모델 (architecture.md §8.2–8.3)
- **변수:** 지원인력 × 수요 × 10분 칸.
  - 수업 지원은 구간(시작·중간·종료)마다 덮을 수 있다.
  - 배정 결과는 지원인력·수요마다 이어진 구간(`Assignment.start/end`)으로 묶어 돌려준다.
- **하드 제약:**
  - 한 사람 한 시점 한 곳
  - 근무 가능 구간 안, 부재 밖
  - `pinned`·`frozen`(D24)은 그대로
  - 이동 묶음은 1명이 쉬는 시간 전체를 맡거나, `second_trip` 구간(다음 교시 첫 10분)을 맡는다(`mode: "second_trip"`, D22)
  - 이동 묶음 담당은 1명 이하
- **부족분:** 수요 충족은 완화형이다(`short[r]`). 응답 `shortfalls`는 계약 `Shortfall` 형식이고, 이동이 몰려 일부러 비운 체크 안 된 구간은 `waived: true`.
  - **정의는 M1 `computeShortfalls`와 같아야 한다.** 다르면 시나리오 비교가 무의미하다.
  - 판단이 어려우면 응답 부족분 대신 M1의 `computeShortfalls`로 다시 계산해 비교한다.
- **목적 (사전식, §8.3).** 단계마다 값을 고정하고 다음 단계를 푼다. `solver_meta.objective_stages`에 단계별 값을 넣는다.
  1. 이동 묶음 부족분
  2. HIGH 부족분(분)
  3. LOW 부족분(분)
  4. 이전 배정 대비 바뀐 칸
  5. 한 교시 안 담당 바뀜

  4단계는 정책의 `keep_previous`가 켜졌을 때만 푼다.
- **정책 매핑** (`Policy`):
  - `second_trip: false`(no_late)면 두 번째 이동 변수를 만들지 않는다.
  - `release_checked_start: false`(keep_minimal)면 체크된 시작 구간은 두 번째 이동 때문에 비우지 않는다.
  - `edge_release`·`segment_priority`는 §8.2-6 그대로.
- **결정성:** 같은 입력이면 같은 출력. `num_search_workers=1` 또는 고정 시드, 결과 정렬 고정. `time_limit_ms`를 지키고, 시간 안에 최적을 못 찾으면 `status: "feasible"`.

## 준비 (사람)
- 이 컴퓨터에 `uv`가 없다. 시작 전에 `brew install uv`가 필요하다. 없으면 시작하지 말고 질문 파일에 적는다.
- 시스템 Python이 3.14라 OR-Tools 휠이 없을 수 있다. `services/solver/.python-version`을 `3.12`로 두고 `uv python install 3.12`를 쓴다.

## 읽을 것
- docs/architecture.md §8.0–8.6, §9.2
- docs/contracts.md
- `packages/schema/src/solver.ts`, `scheduler.ts` (`Engine`, `AssignProblem`, `Policy`, `Shortfall`)
- `packages/scheduler/src/engines/heuristic.ts`, `shortfalls.ts`, `validate.ts` (같은 뜻이어야 하는 M1 코드. 읽기만 함)
- `fixtures/mock/solver/assign.request.json`·`assign.response.json` (형식 예시. 값은 임시 규칙 엔진 결과)
- `fixtures/scenarios/inputs/S*.input.json` 10개, `cascade-scenarios.json`의 `baseline_heuristic`

## 완료 조건
- [ ] `uv run --directory services/solver pytest -q` 통과 (끝낼 때 자동 실행). 테스트에 들어갈 것:
  - `fixtures/mock/solver/assign.request.json` → 응답이 `AssignResponse` 스키마 통과
  - 작은 문제 단위 테스트: 한 사람 한 곳, 근무·부재, 묶음 1명, 두 번째 이동 구간, pinned·frozen 유지, no_late면 `second_trip` 없음
  - 같은 입력 두 번 → 같은 출력
- [ ] 비교 스크립트 `node packages/scheduler/src/engines/cpsat/compare.ts`. 솔버를 스스로 띄우거나, 떠 있는 `SOLVER_URL`을 쓴다. 시나리오 10개 × 정책 3개마다:
  - [ ] M1 `validate()` 위반 0건
  - [ ] 공백(`gaps`)·늦게 도착이 `baseline_heuristic`보다 나쁘지 않다(사전식 목적이라 같거나 좋아야 정상)
  - [ ] 문제 하나(하루) 5초 이내
  - [ ] 표 출력: 시나리오 × 정책별 heuristic · cpsat의 바뀐 칸 / 공백 / 늦게 도착 / 시간
- [ ] 어댑터: `propose(input, cpsatEngine(...))` 결과가 계약 `ProposeOutput`을 통과하고 `engine.name`이 `"cpsat"`.

## 범위 밖
- `/validate` HTTP, Cloud Run 배포(M11)
- 정책마다 엔진 고르기(M1 v3)
- 업무강도 균형·매칭 분산(D17)
- 층 간 연속(§15-7)

## 주의
- 같은 뜻이어야 하는 M1 코드(부족분·검증)와 결과가 다르면, 고치지 말고 보드·질문 파일에 사례(시나리오, 칸)를 적는다.
- 계약이 모자라면(예: 단계별 목적값 형식) `contracts/requests/M2-<주제>.md`.

## 산출물
보드 `tasks/board/M2.md` 갱신(완료 조건 체크, 다음에 할 것, 다른 모듈에 필요한 것). 변경 요약, 비교 표, 남은 질문(`tasks/M2-questions.md`).
