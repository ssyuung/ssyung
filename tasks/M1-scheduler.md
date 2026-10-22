# M1 배치 엔진 v1 (임시 규칙 엔진)

> 상태: 완료
> 브랜치 `<id>/m1-scheduler` · 범위 `packages/scheduler/**` (단 `src/engines/cpsat/` 제외) · 공통 규칙 `CLAUDE.md`

## 목표
`@ssyung/scheduler` 패키지를 만들고 계약(`packages/schema/src/scheduler.ts`)대로 두 함수를 구현한다.

```ts
propose(input: ProposeInput): Promise<ProposeOutput>   // 정책마다 엔진을 돌려 선택지, 같은 결과는 합침
validate(input: ValidateInput): ValidateOutput
```

구조 (docs/architecture.md §8.0):
- `src/engines/heuristic.ts` — `Engine` 인터페이스 구현. 화면 시안 `docs/screens/ssyung-screens.html`의 `buildDay()`(임시 규칙)를 옮긴다.
- `src/rules/` — 규칙 하나 = 파일 하나:
  - `move-group`(D12)
  - `segment-priority`(D13)
  - `second-trip`(D22)
  - `edge-release`(D22)
  - `keep-previous`
- `src/policies/` — `keep_minimal` / `fresh` / `no_late` (D23). 목데이터 `scheduler/propose.*.output.json`의 `policies` 합치기 규칙과 같게.
- `src/diff.ts`, `src/explain.ts`, `src/metrics.ts` — 엔진과 무관하게 이전·새 배정만 보고 계산 (§8.7 이유 코드).

## 읽을 것
- docs/architecture.md §8 (특히 §8.2-6 두 번째 이동, §8.7 설명)
- docs/contracts.md §2.1 (수요 id, segments, waived, 선택지 합치기)
- docs/scheduler-scenarios.md
- `fixtures/mock/scheduler/*` — 입력과 기대 출력
- `fixtures/scenarios/cascade-scenarios.json`

## 완료 조건
- [ ] `pnpm --filter @ssyung/scheduler typecheck`, `test` 통과
- [ ] 목데이터 대조: `propose.absent.input.json`, `propose.staff-away.input.json`을 넣었을 때 결과가 같은 `.output.json`과 같다.
  - 선택지 수, 각 선택지의 `policies`, `metrics`의 changed_cells·gaps·late_students가 같아야 한다.
  - 배정은 달라도 되지만, 지표가 나빠지면 실패다.
- [ ] `validate.overlap.input.json` → `OVERLAP`, `MOVE_GROUP_HEADCOUNT` 위반이 나온다.
- [ ] 반환한 모든 선택지가 `validate()`에서 위반 0건이다.
- [ ] diff의 모든 항목이 explanation의 어떤 단계에 들어 있다 (설명 못 하는 변경 금지).
- [ ] 같은 입력이면 같은 결과(두 번 실행 비교), 하루 입력 1초 이내.
- [ ] `pnpm --filter @ssyung/scheduler scenarios` 명령을 만든다.
  - 시나리오 10개 중 수요 변화가 없는 것(S2, S3, S7)을 돌려 기준선(`baseline_heuristic`)과 비교표를 출력한다.
  - 기준선보다 나빠지면 실패한다.
  - 나머지 7개는 M3(수요 생성) merge 후 Wave 2에서 켠다. 지금은 건너뜀으로 표시한다.

## 범위 밖
- CP-SAT(M2)
- 수요 생성(M3). 입력의 demands를 그대로 쓴다.
- API·화면
- 업무강도 균형·매칭 분산(D17 보류)
- 독립 제약 검사기(`packages/testing/checker`, M0)

## 주의
- 시안 코드는 화면용 전역 변수가 섞여 있다. 규칙만 옮기고 DOM·전역은 가져오지 않는다.
- 시나리오·목데이터가 내 결과와 다르면 고치지 말고 `contracts/requests/M1-<주제>.md`에 근거를 적는다.

## 산출물
보드 `tasks/board/M1.md` 갱신(완료 조건 체크, 다음에 할 것, 다른 모듈에 필요한 것). 변경 요약, 목데이터 대조 결과, 시나리오 비교표, 남은 질문(`tasks/M1-questions.md`).
