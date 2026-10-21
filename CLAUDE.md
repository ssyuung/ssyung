# ssyung — 에이전트 공통 규칙

특수학급 학생의 지원인력 배치·시간표 서비스. 여러 모듈을 각자 워크트리에서 동시에 개발한다.
설계: `docs/architecture.md` · 데이터 형식: `docs/contracts.md` · 병렬 개발: `docs/agent-development.md`

## 내가 누구인가

- 워크트리 루트의 `.agent-scope`에 모듈 ID(M1 등)가 있으면 그 모듈 에이전트다. 세션 시작 때 훅이 모듈·지시서·쓰기 범위를 알려준다.
- 지시서 `tasks/<ID>-*.md`를 먼저 읽고 그대로 수행한다. 쓰기 범위는 `.agent-scopes/modules.json`.
- `.agent-scope`가 없으면 사람과 함께 작업하는 통합 공간이다.

## 절대 규칙

1. **계약은 고치지 않는다.** `packages/schema`, `fixtures/**`(목데이터·시나리오·평가 세트), `**/generated/**`, 하네스(`scripts/`, `.claude/`, `.agent-scopes/`, 이 파일)는 M0만 고친다. 바꿔야 하면 `contracts/requests/<ID>-<주제>.md`를 쓴다(`contracts/requests/_template.md`).
2. **다른 모듈 코드를 import하지 않는다.** 모듈 사이는 `@ssyung/schema` 타입과 `fixtures/mock/` 목데이터로만 만난다.
3. **커밋·push·merge는 사람이 요청할 때만.** 일이 끝나면 바꾼 것, 완료 명령 결과, 남은 질문을 보고하고 멈춘다.
4. **추측하지 않는다.** 계약이나 지시서가 모호하면 `tasks/<ID>-questions.md`에 질문을 적고, 가장 보수적인 해석으로 진행한 뒤 보고에 적는다.
5. **기준을 낮춰 통과시키지 않는다.** 테스트 기대값, 시나리오 기준선, 목데이터를 내 코드에 맞춰 바꾸지 않는다.

## 명령

```bash
pnpm i
pnpm test                                  # 계약 타입 검사 + 목데이터 검증 (+ 각 패키지 test)
pnpm --filter @ssyung/<패키지> test         # 내 패키지만
```

## 코드 규칙

- TypeScript, ESM, Node 24+. 타입은 `@ssyung/schema`에서 가져오고(`import type { Demand } from "@ssyung/schema"`), 같은 모양의 타입을 새로 만들지 않는다.
- 새 패키지는 `packages/<이름>`에 `@ssyung/<이름>`으로, `typecheck`(`tsc -p .`)와 `test`(`node --test` 또는 vitest) 스크립트를 둔다. `tsconfig.json`은 `../../tsconfig.base.json`을 extends한다.
- 테스트 입력은 `fixtures/mock/`을 읽어서 쓴다. 테스트 안에 큰 데이터를 새로 만들지 않는다.
- 시각은 자정부터의 분(10의 배수). 화면·문장에서만 `HH:MM`.
- 주석·문서·사용자 문구는 한국어, 짧게.
- 새 의존성은 추가하기 전에 질문 파일에 적는다(작은 개발 도구 제외).

## 훅이 막는 것

범위 밖 파일 수정, 계약·목데이터·하네스 수정, 다른 워크트리 경로, push·merge·rebase·브랜치 이동, 요청 없는 커밋, 외부로 데이터 전송, 공유 stash.
막히면 메시지대로 질문·요청 파일을 쓰고, 우회하지 않는다(Bash로 같은 파일을 쓰는 것도 우회다. PR의 범위 검사에서 다시 걸린다).
끝낼 때는 완료 검사가 자동으로 돈다. 실패하면 고치고, 내 범위에서 못 고치면 이유를 보고한다.
