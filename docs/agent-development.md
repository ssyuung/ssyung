# ssyung 병렬 에이전트 개발 가이드

> 상태: 초안 (2026-10-17, 하네스·계약 반영 2026-10-22)
> 관련 문서: [architecture.md](architecture.md), [contracts.md](contracts.md), [cost-strategy.md](cost-strategy.md)
> 전제: 웹 Next.js + 앱 Expo + 솔버 Python, pnpm + Turborepo 모노레포

## 0. 원칙

1. **계약 먼저, 병렬은 그다음.** 공용 스키마, DB 스키마, 테스트 데이터를 Wave 0에서 고정한 뒤에 에이전트를 나눈다.
2. **한 디렉터리 = 한 에이전트.** 쓰기 권한이 겹치는 파일이 없게 한다.
3. **"완료"는 명령어로 정의한다.** 지시서의 완료 조건은 실행 가능한 명령과 그 결과로 쓴다.
4. **규칙은 문서가 아니라 기계로 강제한다.** 범위, 계약 보호, 위험 명령은 훅과 CI가 막는다.
5. **병목은 사람의 리뷰다.** 동시에 돌리는 에이전트는 3~4개로 제한한다.

## 1. 모듈

경계는 "무엇을 입력받아 무엇을 내놓는가"로 정했다. 모듈끼리는 `packages/schema`의 계약으로만 만나므로, 계약이 고정된 뒤에는 서로 기다리지 않고 동시에 개발할 수 있다.

```
 학교 데이터 ─┐                          ┌─▶ 교사 웹 (M8)
 (M4)        ├─▶ 수요 생성 (M3) ─▶ 배치 엔진 (M1) ─▶ API (M7) ─┼─▶ 앱 (M9)
 저장소 (M4) ─┘                    │  └ CP-SAT 엔진 (M2)          └─▶ 알림 (M10)
                 해석기 (M6) ─▶ ChangeOps ─▶ API
                 실명 검사 (M5) ─▶ API·해석기
```

| 모듈 | 쓰기 권한 | 언어 | 입력 → 출력 | 의존 | 테스트 방식 |
|---|---|---|---|---|---|
| **M0 계약** | `packages/schema`, `packages/testing`(가짜 구현·**독립 제약 검사기**), `fixtures/`(시나리오 포함), `supabase/migrations/0001_*` | TS, SQL | — | 없음 | 생성 결과 최신 여부, 테스트 데이터·시나리오 스키마 검증 |
| **M1 배치 엔진** | `packages/scheduler` (engines/heuristic, rules, policies, diff, explain, metrics) | TS | 수요·근무·이전 배정·선택지 기준 → 선택지별 배정·부족분·지표·설명 | M0 | 연쇄 시나리오 10개(기준선 숫자), 독립 제약 검사기, 규칙별 단위 테스트 |
| M2 CP-SAT 엔진 | `services/solver`, `packages/scheduler/engines/cpsat`(어댑터) | Python, TS | 수요·근무·정책 → 배정·부족분 | M0 | M1과 **같은** 시나리오·검사기. 정책별로 임시 규칙 엔진보다 나쁘지 않을 것 |
| M3 수요 생성 | `packages/core/src/demand` | TS | 시간표·배치·지원 과목·장소·층 → 수요(수업 구간, 이동 묶음, 늦게 도착 비용) | M0 | 지원 구간 시각·우선순위, 특수학급 수업 수요 없음, 묶음 규칙(D12), 휴일·시간표 없는 반 |
| M4 학교 데이터·저장소 | `packages/school-data`, `packages/repository` | TS | 파일·NEIS → 학급·시간표 / JSON·Supabase ↔ 도메인 객체 | M0 | `dataset/` 정규화 고정 검증, 저장소 계약 테스트(JSON·Supabase 같은 테스트) |
| M5 실명 검사 | `packages/name-guard` | TS | 텍스트 → 의심 구간 | 없음 | 탐지 세트 / 오탐 금지 세트 |
| M6 해석기 | `packages/interpreter` | TS | 원문 + 컨텍스트 → ChangeOps | M0, M5 | 단위: 가짜 Claude / 평가: 실제 호출(수동) |
| M7 API | `apps/web/server/routers`, `supabase/migrations/` (0002 이후), `supabase/tests` | TS, SQL | 화면 요청 → 수요 생성·배치 엔진·해석기 호출, 버전·승인 | M0 (나머지는 가짜로) | 라우터 테스트, RLS 통합 테스트 |
| M8 교사 웹 UI | `apps/web/app`, `apps/web/components` | TS | — | M0 | 가짜 API, Playwright. 화면 시안(`docs/screens/`) 기준 |
| M9 모바일 앱 | `apps/mobile` (지원인력 A1–A4, 교사 T1–T3) | TS | — | M0 | 가짜 API |
| M10 알림 | `packages/notify`, `apps/web/server/notify` | TS | 바뀐 지원인력 → 푸시·SMS | M0 | 가짜 발송기 |
| M11 인프라 | `infra/`, `.github/workflows/deploy-*` | YAML | — | 없음 | 배포 dry-run |

- 최초 마이그레이션(`0001`)은 M0가 만들고, 이후 마이그레이션은 M7만 추가한다. 다른 모듈은 계약 변경 요청으로 M7에 요청한다.
- **독립 제약 검사기**(`packages/testing/checker`)와 **연쇄 시나리오**(`fixtures/scenarios/`)는 M0가 만들고 M1·M2에게는 읽기 전용이다. 배치 엔진을 만드는 에이전트가 검사 기준이나 기대 결과를 느슨하게 바꾸지 못하게 하기 위해서다. 시나리오 추가·수정은 계약 변경 절차(§5)로만 한다.
- **배치 규칙을 계속 발전시키는 일은 M1 안에서** 끝나도록 경계를 잡았다. 규칙 하나 = `rules/`의 파일 하나 + 시나리오 하나. 화면·API는 손대지 않는다.
- M1과 M2는 같은 계약(`packages/schema/scheduler.ts`)을 구현한다. M2가 늦어도 M1 임시 규칙 엔진으로 전체가 돈다.

## 2. 진행 순서

```
Wave 0 (순차, 1개)   M0 계약(배치 엔진 계약·시나리오·검사기 포함) + 모노레포 뼈대 + 하네스   ← 사람이 꼼꼼히 리뷰
                           │
Wave 1 (병렬 5~6개)  M1 배치 엔진(임시 규칙) │ M3 수요 생성 │ M4 학교 데이터·저장소(JSON)
                     M5 실명 검사 │ M6 해석기 │ M7 API(가짜 엔진·JSON 저장소)
                     (여유가 되면 M8 웹 UI 뼈대, M11 인프라)
                           │
Wave 2 (병렬)        M2 CP-SAT 엔진 │ M8 웹 UI │ M9 모바일 │ M10 알림
                     M7: 가짜 → 실제 엔진·해석기 연결, JSON → Supabase 저장소 전환
                           │
Wave 3 (1개)         통합 E2E, 파일럿 준비
                           │
이후 (상시)          M1 배치 규칙 개선: 시나리오 추가 → 규칙 추가 → 두 엔진 통과
```

## 3. Wave 0 상세

### 3.1 목표

Wave 0가 끝나면 **어느 모듈 에이전트든 타입, 데이터, 명령어, 경계에 대해 질문하지 않고 일을 시작할 수 있어야 한다.**

### 3.2 시작 전에 사람이 정할 것

계약에 직접 들어가는 결정이다. 정하지 않으면 에이전트가 임의로 정한다. 도메인 결정 D1~D19(architecture.md §0.3)는 확정되었고, 아래는 그 외 기본값이다.

| 결정 | MVP 기본값 (architecture.md 기준) | 스키마에 미치는 영향 |
|---|---|---|
| 앱 프레임워크 | Expo | `apps/mobile` 생성 여부 |
| 지원 방식 | 지원인력 1명이 한 시점에 수요 1개 (1:1) | `SupportRequirement.headcount`, 솔버 제약 |
| 일시 변경 | `scope: this_week \| permanent`, 이번 주 한정은 교사가 원복 변경을 다시 승인 | `ChangeOps.scope` |
| 변경 명령 종류 | 6종 (relocate_class, staff_unavailable, set_placement, set_support, pin_assignment, mark_absent) | `ChangeOp` union |
| 해석 결과 부가 정보 | `confidence`, `unsupported` 포함 (cost-strategy.md §2.4) | `InterpretResult` |
| 교시 수 | 학교별 설정, 최대 8 | `TimeBlock.period` 범위 |
| 시간 단위 | 10분. 시각은 자정부터의 분, 구간은 `[start, end)`, 경계는 10의 배수 (D15) | `Minute`, `Interval` |
| 시간 지칭 | 날짜 기본: `{date, period}`, `{date, kind}`, `{date, kind: break, after_period}`, `{date, start, end}`. 요일 `{day, period}`는 permanent 규칙에서만 | `When` |
| 지원 구간 | 40분 수업 = 시작 10 · 중간 20 · 종료 10 (D13) | `Segment`, `StudentSubjectSupport` |
| 첫 단계 저장소 | DB 없이 `dataset/db/` JSON 파일 (D19) | `Repository` 인터페이스 |

### 3.3 산출물

#### W0-1. 모노레포 뼈대

```
ssyung/
├── apps/
│   ├── web/                 Next.js (App Router), 빈 페이지 + /api/trpc
│   └── mobile/              Expo Router, 빈 화면
├── services/
│   └── solver/              FastAPI, GET /health만, uv 프로젝트
├── packages/
│   ├── schema/              계약 (W0-2)
│   ├── testing/             가짜 구현 (W0-5)
│   ├── name-guard/          빈 패키지 + 통과하는 자리표시 테스트
│   ├── interpreter/         〃
│   └── notify/              〃
├── fixtures/                테스트 데이터 (W0-4)
├── supabase/                마이그레이션 (W0-3)
├── tasks/                   지시서 (W0-7)
├── contracts/requests/      계약 변경 요청 (W0-7)
├── .agent-scopes/           모듈별 쓰기 범위·완료 검사 (modules.json, W0-6)
├── .claude/                 훅 설정 (W0-6)
└── .github/workflows/       CI (W0-8)
```

- 패키지 이름: `@ssyung/schema`, `@ssyung/testing` 등
- 공통 설정: `tsconfig.base.json`, lint·format 설정, `.nvmrc`, `turbo.json` 파이프라인(`gen`, `build`, `typecheck`, `lint`, `test`)
- 모든 패키지에 자리표시 테스트를 하나 두어, 첫날부터 `pnpm test`가 통과하게 한다.

#### W0-2. 계약 (`packages/schema`)

zod로 작성한다. 이 패키지가 모든 타입의 유일한 원본이다. **초안(0.1.0)이 작성되어 있다**: 파일별 내용과 정한 규칙은 [contracts.md](contracts.md) §2.

| 파일 | 내용 |
|---|---|
| `ids.ts` | `StudentCode` (`^S\d{2,3}$`), `StaffCode` (`A`), `TeacherCode` (`T`), `LocationCode` (`L`), `ClassGroupCode` (`^\d-\d{1,2}$`), UUID 타입들 |
| `label.ts` | `Label`: 최대 20자. 실명 검사는 서버에서 하며 스키마는 길이만 검사 |
| `time.ts` | `Day` (MON~FRI), `Minute`(10의 배수), `Interval`, `TimeBlockKind` (class, break, lunch, arrival, dismissal, other), `TimeBlock`, `When`, `Segment`(start·mid·end) |
| `domain.ts` | School, Member, SpecialClass, Location(floor, outdoor), ClassGroup, ClassLesson(날짜별), SubjectLocation, FloorLayout, Student, StudentSubjectSupport, SupportNote, Staff, StaffAvailability(요일·분), Duty(+동행 학생), Memo, CellNote, CellCheck. **이름 필드 없음** |
| `schedule.ts` | ScheduleVersion(status, 날짜 범위), StudentPlacement(과목 기준), PlacementOverride, SupportRequirement, StaffAbsence, MoveGroup, Demand(lesson_segment·move_group·requirement·duty, 우선순위), StaffAssignment(날짜·분 구간), ScheduleDiff |
| `change-ops.ts` | 6종 ChangeOp(discriminated union), `scope` |
| `scheduler.ts` | 배치 엔진 계약(architecture.md §8.0): ProposeInput(수요, 근무·부재, 이전 배정, 고정 배정, 선택지 기준), Option(배정, 부족분, 지표, diff, 변경 설명 `explanation`: step·cause·이유 코드, §8.7), Policy(규칙 조합·우선순위), Engine 인터페이스 `assign(problem, policy)` |
| `solver.ts` | CP-SAT 엔진 HTTP 계약: AssignRequest/Response(배정 + 부족분), ValidateRequest/Response |
| `interpreter.ts` | InterpretRequest(원문 + 사전 계산된 컨텍스트: 날짜 달력, 교시 규칙, 반별 과목→교시표, 코드 목록), InterpretResult(ops, confidence, unsupported, model, escalated) |
| `api.ts` | tRPC 프로시저별 입력·출력 스키마 |
| `dataset.ts` | `dataset/api/`(NEIS 응답 행)와 `dataset/db/`(층배치·학생·지원인력 JSON) 파일 형식 |
| `version.ts` | `CONTRACT_VERSION` |

생성물 (`pnpm gen`):

```
packages/schema (zod)
   ├─▶ packages/schema/generated/json/*.json        JSON Schema
   │      ├─▶ services/solver/ssyung_schema/*.py    Pydantic 모델 (datamodel-code-generator)
   │      └─▶ packages/interpreter/generated/tool-schema.json   Claude tool input_schema
   └─▶ TS 타입은 z.infer로 직접 사용
```

- 생성물은 커밋한다. CI가 `pnpm gen` 후 `git diff --exit-code`로 최신인지 확인한다.
- 생성물 디렉터리는 모든 모듈 에이전트에게 읽기 전용이다.

#### W0-3. DB 초기 마이그레이션 (`supabase/migrations/0001_init.sql`)

- architecture.md §4의 테이블 전부. 실명 컬럼 없음.
- 첫 개발 단계(D19)에서는 마이그레이션을 작성·검증만 하고, 앱은 `JsonRepository`로 돈다. Supabase 전환은 Wave 2.
- 모든 테이블에 `school_id`와 기본 RLS 정책(학교 격리)을 둔다.
- `staff_contact`는 클라이언트 접근 전면 차단.
- 학교당 active 버전 1개(부분 유니크 인덱스).
- `supabase gen types`로 DB 타입 생성 → `packages/schema/generated/db.ts`.
- `supabase/seed.sql`은 `fixtures/schools/small.json`에서 스크립트로 생성한다. 손으로 쓰지 않는다.

#### W0-4. 테스트 데이터 (`fixtures/`)

모든 모듈이 같은 데이터를 쓴다. 전부 코드만 쓰고 이름은 없다.

| 파일 | 규모 | 용도 |
|---|---|---|
| `schools/tiny.json` | 학생 2, 인력 1, 업무 1, 2일 × (2교시 + 쉬는 시간 + 점심) | 손으로 정답을 검증할 수 있는 최소 사례. `expected/tiny.solution.json` 포함 |
| `schools/small.json` | 학생 12, 인력 4, 특수학급 2(K1·K2), 교사 2, 업무 6(동행 업무 포함), 5일 × 6교시 + 수업 외 칸, 장소 7 | 파일럿 규모 근사. DB 시드, UI 가짜 API |
| `schools/infeasible.json` | small에서 금 3교시 인력 1명 부족 | `expected/infeasible.reasons.json` 포함 |
| `mock/domain/*` (gaepo-dev) | `dataset/`에서 생성: 서울개포초 39개 반, 9월 시간표, 임의 층 배치, 학생 7(S01–S07), 지원인력 3(풀타임) | 개발 기본 데이터. 손으로 쓰지 않고 `pnpm mock:build`로 생성 |
| `scenarios/cascade-scenarios.json` | 연쇄 시나리오 10개(docs/scheduler-scenarios.md). gaepo-dev 데이터 9/18(금)에 변경 요청을 적용 | 시나리오마다 기대 결과(바뀌는 칸 종류, 연쇄 단계 이유 코드, 공백·늦게 도착 상한)와 임시 규칙 기준선 숫자 |
| `mock/**` | `pnpm mock:build`가 생성 (contracts.md §3). 프로시저 36개 예시, 수요·배정·선택지·검증·솔버·해석 컨텍스트 | 모듈마다 상대 모듈 대신 쓰는 입력과 출력 형식의 기준. **작성되어 있음** |
| `change-requests/cases.json` | 요청 문장 + 기대 ChangeOps, 22건 (작성되어 있음) | 해석기 평가 세트의 씨앗. 이후 특수교사 팀원이 50~100건으로 확장 |

- 모든 테스트 데이터는 CI에서 zod 스키마로 검증한다.
- 변경 요청 20건에는 cost-strategy.md §2.3의 어려운 유형(날짜, 오전·오후, 과목→교시, 복합 명령, 지원하지 않는 요청)을 최소 2건씩 넣는다.

#### W0-5. 가짜 구현과 계약 라우터

다른 모듈을 기다리지 않고 병렬로 일하기 위한 것이다.

| 대상 | 위치 | 동작 |
|---|---|---|
| `FakeSolver` | `packages/testing` | 테스트 데이터 이름별로 미리 정한 결과 반환 |
| `FakeInterpreter` | `packages/testing` | `change-requests/*.json`의 기대 ChangeOps 반환 |
| `FakeClaude` | `packages/testing` | Claude 응답 형태를 흉내 냄 (M6 단위 테스트용) |
| `FakeNotifier` | `packages/testing` | 발송 대신 메모리에 기록 |
| 계약 라우터 | `apps/web/server/routers` | 모든 tRPC 프로시저의 입출력 타입을 확정하고, 본문은 `NOT_IMPLEMENTED` |
| 가짜 라우터 | `packages/testing` | 같은 프로시저를 메모리 데이터(small.json)로 구현 |

- 계약 라우터 덕분에 `AppRouter` 타입이 Wave 0에서 고정된다. M7은 본문만 채우고, M8과 M9는 처음부터 최종 타입으로 개발한다.
- `pnpm dev:mock`: 가짜 라우터로 웹을 띄운다. 앱도 같은 가짜 서버에 붙는다.

#### W0-6. 하네스 (작성됨)

| 파일 | 내용 |
|---|---|
| `CLAUDE.md` (루트) | 공통 규칙: 계약·생성물 수정 금지와 요청 절차, 다른 모듈 import 금지, 커밋은 요청 시만, 질문 파일, 기준 낮추기 금지, 명령, 코드 규칙 |
| `.agent-scopes/modules.json` | 모듈별 쓰기 범위(`write`·`deny`), 보호 경로(`protected`), 공통 허용(`common_write`), 필수 파일(`requires`), 완료 검사(`check`), 브랜치 이름 |
| `.agent-scope` (gitignore) | 각 워크트리에서 자기 모듈 ID 한 줄 (예: `M1`). `scripts/agent/init.sh M1`이 만든다 |
| `.claude/settings.json` | 아래 훅 등록 |
| `scripts/hooks/session-start.mjs` | SessionStart: 모듈, 지금 할 지시서(`상태: 진행`), 쓰기 범위, 완료 검사를 컨텍스트에 넣음. 진행 지시서가 없거나 여럿이거나 보류면 시작하지 말라고 알림 |
| `scripts/hooks/guard-edit.mjs` | PreToolUse(Write·Edit·MultiEdit·NotebookEdit): 범위(scope-guard)와 계약·목데이터·하네스 보호(contract-guard). 워크트리 밖 경로 차단(임시 디렉터리·`~/.claude` 제외) |
| `scripts/hooks/guard-bash.mjs` | PreToolUse(Bash): 누구에게나 강제 push, 루트·상위 `rm -rf`, 공유 stash, 검사 건너뛰기 차단. 모듈 에이전트에게는 push·merge·rebase·브랜치 이동·`reset --hard` 등, 요청 없는 커밋(`SSY_ALLOW_COMMIT=1`일 때만), 외부 전송, 워크트리 밖 경로 수정도 차단 |
| `scripts/hooks/post-edit.mjs` | PostToolUse: 고친 TS 파일이 속한 패키지의 `typecheck`를 돌려 실패를 바로 돌려줌 |
| `scripts/hooks/stop-check.mjs` | Stop: 바뀐 파일이 있으면 `requires` 확인 후 모듈 `check` + `always_check`(계약·목데이터 검증) 실행. 실패하면 끝내지 못하게 하고, 3번 연속이면 사람에게 넘김 |
| `scripts/hooks/test/hooks.test.mjs` | 하네스 테스트 30개 (임시 저장소에서 훅을 실제로 호출) |
| `scripts/ci/scope-check.mjs` | CI: 브랜치 이름 → 모듈, main 대비 바뀐 파일이 모두 범위 안인지 |
| `scripts/agent/init.sh` | 워크트리 준비: `.agent-scope`, `pnpm i`, 시작 문장 안내 |
| `tasks/board/<ID>.md` | 모듈 보드: 이번 버전 체크리스트, 다음에 할 것(제안), 다른 모듈에 필요한 것. 그 모듈만 고치고 끝낼 때마다 갱신(Stop 훅이 확인). 모듈마다 파일이 따로라 merge 충돌이 없다 |
| `scripts/agent/board.mjs` (`pnpm board`) | 모든 워크트리의 보드를 직접 읽어 모아 보기. merge 전 진행도 보인다 |
| `tasks/BACKLOG.md` | 사람의 업무 리스트·모듈별 버전 로드맵. 보드의 제안을 사람이 옮겨야 다음 버전이 된다 |

훅은 `.agent-scope`가 없으면(사람이 직접 작업하는 워크트리) 범위 검사와 모듈 전용 차단을 건너뛴다. 되돌릴 수 없는 명령(강제 push, 루트 삭제, 공유 stash) 차단은 항상 동작한다.

#### W0-7. 지시서·요청 템플릿

- `tasks/_template.md`: §4의 지시서 형식
- `tasks/M1-scheduler.md`, `M2-cpsat.md`, `M3-demand.md`, `M5-name-guard.md`, `M6-interpreter.md`, `M7-api.md`: Wave 1 지시서 초안. 사람이 Wave 0 리뷰 때 함께 확정
- `contracts/requests/_template.md`: 요청 모듈, 바꿀 스키마, 이유, 영향받는 모듈, 하위 호환 여부

#### W0-8. CI (`.github/workflows/ci.yml`)

| 작업 | 내용 |
|---|---|
| 설치·캐시 | pnpm, uv |
| 생성물 검사 | `pnpm gen` 후 `git diff --exit-code` |
| 테스트 데이터 검증 | `fixtures/**`를 zod로 검증 |
| 바뀐 패키지 검사 | `turbo run typecheck lint test --affected` |
| 솔버 | `uv run pytest` (솔버 또는 계약이 바뀐 경우) |
| DB | Supabase 로컬 실행 → 마이그레이션 → 시드 → RLS 테스트 |
| 범위 검사 | 브랜치 이름(`*/m2-cpsat`) → `.agent-scopes/modules.json`의 M2, 범위 밖 파일 변경 시 실패 (`scripts/ci/scope-check.mjs`) |
| 하네스 | `node --test scripts/hooks/test/*.test.mjs` |
| 생성물 | `pnpm gen`, `pnpm mock:build` 후 `git diff --exit-code` |

### 3.4 PR 순서 (Wave 0 내부)

Wave 0는 에이전트 1개가 순서대로 진행하되, 리뷰하기 쉽게 PR을 나눈다.

| PR | 내용 | 사람 리뷰 초점 |
|---|---|---|
| W0-a | 모노레포 뼈대 + 기본 CI | 디렉터리 구조, 명령어 이름 |
| W0-b | 계약(zod) + 코드 생성 | **가장 중요.** 필드 이름, 실명 필드가 없는지, 변경 명령 5종의 의미 |
| W0-c | 테스트 데이터 + 독립 제약 검사기 | tiny 정답이 손으로 맞는지, 변경 요청 20건이 현실적인지 (특수교사 팀원 검토) |
| W0-d | DB 마이그레이션 + 시드 생성 | RLS 기본 정책, `staff_contact` 차단 |
| W0-e | 가짜 구현 + 계약 라우터 + `dev:mock` | 프로시저 목록이 화면 흐름을 다 덮는지 |
| W0-f | 하네스 (CLAUDE.md, 훅, 범위, 템플릿, 지시서 초안) | 범위 파일이 §1 표와 일치하는지, 훅이 실제로 막는지 |

### 3.5 완료 조건

- [ ] 새로 clone한 뒤 `pnpm i && pnpm gen && pnpm test`가 통과
- [ ] `pnpm dev:mock`으로 웹이 small.json 데이터를 보여줌
- [ ] `supabase start && supabase db reset`으로 마이그레이션과 시드가 적용됨
- [ ] 독립 제약 검사기(`packages/testing/checker`)가 tiny 정답과 목데이터 배정을 통과시키고, 일부러 망가뜨린 해(`scheduler/validate.overlap`)는 거부
- [ ] `uv run pytest`가 통과 (솔버 뼈대, `generated/json`에서 만든 Pydantic 모델로 목데이터 `solver/*.json`을 읽음)
- [ ] 범위 밖 파일 수정을 훅이 차단함 (M2 범위로 `apps/web` 수정 시도 → 차단 확인)
- [ ] 이름 패턴이 들어간 테스트 데이터 수정을 훅이 차단함
- [ ] CI 전체 통과
- [ ] Wave 1 지시서 4개가 존재하는 파일과 명령만 참조함

### 3.6 예상 소요

에이전트 작업 1~2일 + 사람 리뷰 1일. W0-b(계약) 리뷰에 가장 많은 시간을 쓴다. 여기서 놓친 실수는 Wave 1의 모든 모듈로 번진다.

## 4. 업무 지시서 형식

에이전트마다 `tasks/<ID>-<이름>.md`를 주고, 세션 시작 시 "진행 중인 지시서를 읽고 수행해"라고만 지시한다. 세션 시작 훅이 맨 위 `> 상태: 진행`인 지시서를 찾아 알려준다.

**버전.** 한 모듈을 여러 번 발전시킨다(버전 하나 = 지시서 하나 = PR 하나). 다음 버전은 `tasks/M1-scheduler-v2.md`(`상태: 진행`)를 만들고 이전 지시서를 `상태: 완료`로 바꾼 뒤, 같은 워크트리에서 `2khs21/m1-scheduler-v2` 브랜치를 main에서 새로 만든다. 사람이 보는 업무 리스트와 모듈별 버전 로드맵은 [tasks/BACKLOG.md](../tasks/BACKLOG.md).

```markdown
# M1 배치 엔진 v1 (임시 규칙 엔진)

## 목표
packages/schema/scheduler.ts 계약대로 propose()·validate()를 구현한다.
엔진은 engines/heuristic(임시 규칙). 규칙은 rules/ 파일 하나씩:
move-group(D12), segment-priority(D13), second-trip·edge-release(D22), keep-previous.
선택지 정책 3개(변경 최소 / 처음부터 다시 / 늦게 도착 없음, D23)와 diff·explain·metrics.

## 쓰기 가능
.agent-scopes/modules.json의 M1 (packages/scheduler/**, 단 src/engines/cpsat/ 제외)

## 읽기 전용 (수정 금지)
packages/schema/**, fixtures/**, packages/testing/checker/**
docs/architecture.md §8 (배치 엔진), docs/scheduler-scenarios.md

## 완료 조건 (전부 통과해야 완료)
- [ ] pnpm --filter @ssyung/scheduler test
- [ ] fixtures/scenarios/cascade-scenarios.json 10개: 기대 결과(바뀌는 칸 종류, 연쇄 단계 이유 코드, 상한) 전부 만족
- [ ] 반환된 모든 선택지가 독립 제약 검사기(packages/testing/checker) 통과
- [ ] 같은 입력이면 같은 결과(결정적), gaepo-dev 하루 1초 이내

## 범위 밖
CP-SAT 엔진(M2), 수요 생성(M3), API·화면, 업무강도 균형·매칭 분산(D17 보류)

## 제약
- 새 의존성 추가 전에 질문
- 계약이 모호하면 추측하지 말고 tasks/M1-questions.md에 적고, 가장 보수적인 해석으로 진행
- 규칙을 바꿔 시나리오 기대 결과가 안 맞으면 시나리오를 고치지 말고 contracts/requests/에 근거와 함께 요청

## 계약 변경 요청
packages/schema나 fixtures/scenarios를 바꿔야 하면 수정하지 말고 contracts/requests/M1-<주제>.md에 작성.

## 산출물
PR 1개. 본문에 구현 요약, 시나리오별 지표(기준선 대비), 남은 질문.
```

핵심은 **쓰기 범위, 완료 명령, 범위 밖** 세 가지다.

## 5. 계약 변경 절차

처리 기록과 상태는 [contracts/requests/README.md](../contracts/requests/README.md)에 둔다.

1. 모듈 에이전트가 `contracts/requests/<모듈>-<주제>.md`를 작성하고 PR에 포함한다.
2. 통합 담당(사람 또는 M0 워크트리 세션)이 요청을 모아 `packages/schema`에 반영한다. `CONTRACT_VERSION`을 올리고 `pnpm gen`을 실행한다.
3. main에 merge한다.
4. 진행 중인 워크트리는 main을 rebase한다.

하위 호환이 깨지는 변경(필드 삭제, 이름 변경)은 영향받는 모듈의 지시서에 반영 작업을 추가한다. 진행 중인 모듈 PR이 있으면 가능하면 하위 호환으로 넣고(선택 필드, 값 추가, 쓰지 않음 표시), 실제 삭제는 모듈이 따라온 뒤 다음 major에서 한다.

처리가 끝난 요청 파일은 main에 들어온 뒤 `contracts/requests/done/`으로 옮긴다.

## 6. 하네스 운영

목표는 세 가지다. ① 여러 에이전트가 서로를 망가뜨리지 않고 동시에 일한다. ② 에이전트가 사람 없이 "다 됐는지"를 스스로 확인한다. ③ 계속 바뀔 배치 엔진이 나빠지는 쪽으로 바뀌지 않는다.

### 6.1 작업 공간

| 장치 | 내용 |
|---|---|
| 브랜치·워크트리 | 모듈 하나 = 워크트리 하나 = 브랜치 하나(`<id>/m1-scheduler`). 모두 main(계약 + 목데이터)에서 갈라진다 ([contracts.md](contracts.md) §4) |
| `.agent-scope` | 워크트리마다 자기 모듈 ID 한 줄(gitignore). 허용 경로는 `.agent-scopes/modules.json` |
| 지시서 | `tasks/M1-scheduler.md`: 목표, 쓰기 범위, 완료 명령, 범위 밖 (§4) |
| 입력 데이터 | 다른 모듈 대신 `fixtures/mock/`의 목데이터를 쓴다. 다른 모듈의 코드를 import하지 않고 `@ssyung/schema`만 import한다 |
| 질문·요청 창구 | 질문은 `tasks/M1-questions.md`, 계약 변경은 `contracts/requests/M1-*.md`. 직접 고치지 않는다 |
| 세션 | 모듈마다 독립된 Claude Code 세션. 서브에이전트는 "테스트 보강" 같은 짧은 작업에만 쓴다 |

**워크트리 만들기** (Wave 1 예: M1)

```bash
git worktree add ~/orca/workspaces/ssyung/m1-scheduler -b 2khs21/m1-scheduler main
cd ~/orca/workspaces/ssyung/m1-scheduler
bash scripts/agent/init.sh M1      # .agent-scope, pnpm i, 시작 문장 안내
claude                              # "진행 중인 지시서를 읽고 수행해"
```

브랜치 이름은 `<id>/` + modules.json의 `branch`(뒤에 `-v2` 등은 붙여도 됨)여야 CI 범위 검사가 모듈을 알아본다. Wave 1 지시서는 M1, M3, M4, M5, M6, M7이 있다.

### 6.2 막는 장치 (PreToolUse 훅)

| 훅 | 막는 것 |
|---|---|
| `scope-guard` | 자기 모듈 범위 밖 파일 수정, 워크트리 밖 경로 |
| `contract-guard` | `packages/schema/**`, `**/generated/**`, `fixtures/**`(목데이터·시나리오·평가 세트), `packages/testing/checker/**`, `scripts/mock/**`, `supabase/migrations/0001_*` 수정. M0만 허용 |
| `danger-guard` | `git push --force`, `rm -rf` 범위 밖, 다른 워크트리 경로 접근, 실데이터·키를 외부로 보내는 명령 |
| `commit-guard` | push·merge·rebase·브랜치 이동. 커밋은 사람이 요청할 때만(`SSY_ALLOW_COMMIT=1`), main에는 커밋 불가 |

훅은 `.agent-scope`가 없으면(사람이 직접 작업하는 워크트리) 범위 검사와 모듈 전용 차단을 건너뛴다.

### 6.3 스스로 확인하는 장치 (피드백 루프)

| 시점 | 실행 | 목적 |
|---|---|---|
| 파일 수정 직후 (PostToolUse) | 그 패키지만 타입 검사·lint (수 초) | 바로 고치게 함 |
| 에이전트가 끝내려 할 때 (Stop) | 지시서의 완료 명령 전체 + 자기 보드 갱신 여부 | 실패하면 종료를 막고 결과를 돌려줌 |
| PR (CI) | 범위 검사, `pnpm gen` 최신 여부, `pnpm test`(목데이터 계약 검증 포함), 바뀐 패키지 테스트, 하네스 테스트 | merge 전 마지막 관문 |
| 매일 밤 | 전체 E2E: gaepo-dev 데이터로 설정 → 생성 → 변경 → 승인 → 앱 | 모듈 사이 어긋남 발견 |

모듈마다 "목데이터와 맞는지"가 완료 조건에 들어간다.

| 모듈 | 목데이터 대조 |
|---|---|
| M3 수요 생성 | `domain/*` 입력 → `demand/2026-09.json`과 **값까지** 같음. 의도한 변경이면 M0에 요청해 목데이터를 다시 만듦 |
| M4 데이터·저장소 | `dataset/` → `domain/*.json`과 값까지 같음. 같은 계약 테스트를 `JsonRepository`·`SupabaseRepository`에 모두 실행 |
| M6 해석기 | `change-requests/cases.json` 정확도와 호출 비용을 PR마다 보고. 단위 테스트는 가짜 Claude, 실제 호출 평가는 사람이 실행 |
| M7 API | `api/*.json`의 input으로 불러 output이 계약을 통과(값은 달라도 됨). 오류 예시는 같은 `code`. RLS 테스트(다른 학교 0건) |
| M8·M9 화면 | `api/*.json`을 응답하는 가짜 서버로 띄우고 Playwright 스크린샷. 화면 시안(`docs/screens/`)과 나란히 놓고 사람이 확인. 표시 규칙(수업 흰색·쉬는 시간 회색, 칸 장식 없음, 완료는 초록 ✓만)은 테스트로 고정 |

### 6.4 배치 엔진 전용 장치 (M1·M2)

가장 오래 바뀌는 모듈이라 따로 둔다.

1. **시나리오 러너** (`pnpm scheduler:scenarios`): 연쇄 시나리오 10개 × 정책 3개 × 엔진(임시 규칙, CP-SAT). 바뀌는 칸, 지원 공백, 늦게 도착, 알림 인원, 이유 코드를 낸다. 기준선보다 나빠지면 실패, 좋아지면 PR에 "기준선 갱신 제안"을 붙인다.
2. **독립 제약 검사기** (`packages/testing/checker`, TS): 모든 해에 적용한다. 한 사람 한 시점 한 곳, 근무 시간·부재, 묶음은 1명, 두 번째 이동은 다음 교시 첫 10분까지, 체크된 시작 구간은 마지막 수단, 모든 변경에 이유 코드. 두 엔진을 같은 기준으로 본다. M0 소유이고 엔진 쪽은 읽기만 한다.
3. **무작위 시험**: 9월 20일 × 무작위 결석·부재·배치 변경을 수백 번 돌린다. 검사기 통과, 같은 입력이면 같은 결과, 시간 제한(하루 1초, CP-SAT 5초)을 확인한다.
4. **비교표 자동 생성**: PR마다 시나리오별 지표를 기준선 대비 표로 남긴다. 사람은 표만 보고 "이 규칙 변경이 나은가"를 판단한다.
5. **기준선 변경은 사람 승인**: 기대 결과·기준선·목데이터를 바꾸는 PR은 사람이 승인해야 merge된다. 에이전트가 기준을 낮춰 통과하는 것을 막는다.

규칙 개선 순환: 현장에서 문제 발견 → 시나리오 추가(M0) → 규칙 추가(M1, `rules/` 파일 하나) → 두 엔진 통과 → 기준선 갱신(사람 승인) → `pnpm mock:build`.

### 6.5 리뷰와 merge

1. 에이전트가 PR을 연다. 본문에 완료 명령 결과, (M1이면) 시나리오 비교표, 남은 질문.
2. `/code-review`로 1차 검토한다.
3. 사람이 계약 위반, 범위 위반, 기준선 변경을 중심으로 확인한다.
4. merge 후 진행 중인 워크트리는 main을 rebase한다. 계약이 바뀌었으면 `CONTRACT_VERSION`을 보고 영향받는 모듈에 반영 작업을 준다.

PR은 모듈 안에서도 작게 나눈다. 예: 엔진 v1 규칙 3개 → second-trip·edge-release → 선택지·설명.

### 6.6 사람이 보는 지점 (최소화)

| 언제 | 무엇 |
|---|---|
| Wave 0 | 계약(`packages/schema`), 목데이터, 시나리오, 검사기를 꼼꼼히 리뷰 |
| 매일 | `pnpm board --all`, `tasks/*-questions.md` 답변, `contracts/requests/` 처리, 배치 엔진 비교표, PR 리뷰와 merge, 다음 지시서 |
| 수시 | 기준선·기대 결과·목데이터 변경 승인, 화면 스크린샷 확인 |

## 7. 첫 주 예시

| 날 | 사람 | 에이전트 |
|---|---|---|
| 1 | §3.2 결정, Wave 0 지시서 작성 | M0: W0-a, W0-b |
| 2 | W0-b 계약 리뷰 (가장 꼼꼼히) | M0: W0-c, W0-d, W0-e |
| 3 | 나머지 Wave 0 리뷰, 특수교사 팀원이 변경 요청 20건 검토 | M0: W0-f |
| 4 | Wave 1 지시서 확정, 워크트리 6개 생성 | M1, M3, M4, M5, M6, M7 병렬 시작 |
| 5 | 질문 답변, 계약 변경 요청 처리, PR 리뷰 | 계속 진행 |
