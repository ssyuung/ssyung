# M6 해석기 v1

> 상태: 진행
> 브랜치 `<id>/m6-interpreter` · 범위 `packages/interpreter/**` · 공통 규칙 `CLAUDE.md`

## 목표
`@ssyung/interpreter`: 변경 요청 원문을 `ChangeOps`로 바꾼다 (docs/cost-strategy.md, architecture.md §7).

```ts
interpret(req: InterpretRequest, deps: { claude: ClaudeClient }): Promise<InterpretResult>
```

- 모델:
  - 1차 Haiku(`claude-haiku-4-5`)
  - `confidence: low`이거나 스키마 검증에 실패하면 Sonnet(`claude-sonnet-5-5`)으로 한 번 다시 시도(`escalated: true`)
- 호출 방식: 공식 SDK `@anthropic-ai/sdk`, tool use 하나.
  - `input_schema`는 `@ssyung/schema/json/ChangeOps.json`.
  - 정적 프롬프트·스키마는 prompt caching.
- 날짜·교시·과목은 모델에게 계산시키지 않는다. `InterpretContext`(달력, 오전·오후 교시, 반별 교시 과목)를 프롬프트에 넣는다.
- 응답은 zod로 검증한 뒤 돌려준다.

## 읽을 것
- docs/cost-strategy.md 전체
- docs/architecture.md §7
- `packages/schema/src/interpreter.ts`, `change-ops.ts`
- `fixtures/mock/interpreter/context-2026-09-18.json`
- `fixtures/change-requests/cases.json` (22건)

## 완료 조건
- [ ] `pnpm --filter @ssyung/interpreter typecheck`, `test` 통과. 단위 테스트는 가짜 `ClaudeClient`만 쓰고 네트워크 호출 0건.
  - [ ] 가짜 응답이 스키마를 어기면 escalation
  - [ ] 두 번 다 실패하면 `unsupported`
  - [ ] usage를 집계한다
- [ ] `pnpm --filter @ssyung/interpreter eval` 스크립트를 만든다.
  - cases.json 전체를 실제 API로 돌려 정확도(ops 일치), 비용, escalation 비율을 출력한다.
  - `ANTHROPIC_API_KEY`가 없으면 건너뛴다.
  - **실행은 사람이 한다.**
- [ ] 프롬프트에는 원문과 `InterpretContext`만 넣는다 (지원 방법 메모·연락처 등은 넣지 않음).

## 범위 밖
- 실명 검사(M5, API가 먼저 부름)
- 컨텍스트 만들기(M7·core)
- 해석 결과 문장화

## 산출물
보드 `tasks/board/M6.md` 갱신(완료 조건 체크, 다음에 할 것, 다른 모듈에 필요한 것). 변경 요약, 프롬프트 토큰 수(캐시 전·후), 남은 질문(`tasks/M6-questions.md`). eval 결과는 사람이 돌린 뒤 붙인다.
