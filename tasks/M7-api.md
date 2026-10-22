# M7 API v1 (실제 모듈 연결 + 가짜 해석기)

> 상태: 진행
> 브랜치 `<id>/m7-api` · 범위 `apps/web/server/**`, `apps/web/app/api/**`, `apps/web` 설정 파일, `supabase/` (0001 제외) · 공통 규칙 `CLAUDE.md`

## 목표
`apps/web`(`@ssyung/web`, Next.js App Router)에 tRPC 서버를 만든다.
- 프로시저는 계약 `packages/schema/src/api.ts`의 `procedures` 36개 전부.
- input·output 검증은 계약의 zod를 그대로 쓴다.

M1(배치 엔진)·M3(수요 생성)·M4(학교 데이터·저장소)는 **main에 merge되어 있다.** 목데이터로 흉내 내지 말고 실제 패키지를 부른다. 아직 없는 모듈만 가짜로 둔다.

| 의존 | v1에서 쓰는 것 | 패키지 |
|---|---|---|
| 저장소 | `JsonRepository({ dir, schoolId: "sch_gaepo", source })` — 학생·지원인력·층배치·특수학급 시간표 | `@ssyung/repository` (M4) |
| 학교 데이터 | `new MockSource()` — 학급, 9월 시간표(`getTimetable`) | `@ssyung/school-data` (M4) |
| 수요 생성 | `generateDemands({ school, timetable, students, dates, ops, version_id, requirements, now })` | `@ssyung/core` (M3) |
| 배치 엔진 | `propose(input)`, `validate(input)` | `@ssyung/scheduler` (M1) |
| 해석기 | **가짜**: `fixtures/change-requests/cases.json`과 `fixtures/mock/api/change.interpret.json`의 원문이면 그 기대 ChangeOps, 아니면 `unsupported` | M6 merge 뒤 `@ssyung/interpreter` |
| 실명 검사 | **가짜**: `change.interpret` 목데이터의 `NAME_SUSPECTED` 예시 원문만 거부 | M5 (보류) |
| 알림 | **가짜**: 보낸 알림을 메모리에 기록 | M10 |

- **import 규칙:** 다른 모듈 패키지는 `apps/web/server/deps.ts` 한 곳에서만 import한다(CLAUDE.md 규칙 2의 M7 예외). 라우터는 `deps`를 받아 쓴다. 테스트는 `createDeps({ mode: "test" })`로 같은 구성을 만든다.
- **저장소 디렉터리:** `JsonRepository`는 파일에 쓴다. 커밋된 `dataset/db/`를 직접 고치지 않게, 서버 시작 시 `dataset/db/서울개포초등학교/`를 작업 폴더(`.data/<학교>/`, gitignore됨)로 복사해 그곳을 쓴다. 테스트는 임시 디렉터리.
- **버전·배정:** v1은 메모리 저장소. 시작할 때 `fixtures/mock/schedule/active-2026-09.json`(배치 엔진 결과)을 active 버전으로 싣는다. 버전·배정의 DB 저장은 M4 v2.
- **Next.js:** 뼈대(`apps/web/package.json`, `tsconfig.json`, `next.config.*`)와 tRPC 라우트(`app/api/trpc/[trpc]/route.ts`)는 M7이 만든다. 화면(`app/` 나머지, `components/`)은 M8 범위다.
  - 추가해도 되는 의존성: `next`, `react`, `react-dom`, `@trpc/server`, `@trpc/client`. 그 밖은 질문 파일에 먼저 적는다.

## 프로시저별 구현 메모

| 프로시저 | 할 일 |
|---|---|
| `school.*`, `setup.saveLayout` | `JsonRepository.school`, `MockSource` |
| `setup.previewMoveGroups` | 그 날짜 `generateDemands` 결과 중 `move_group` |
| `students.*`, `staff.*` | `JsonRepository`. 라벨 실명 검사는 가짜 실명 검사기 |
| `view.day`·`view.week`·`view.staffToday` | active 버전의 그날 배정 + `generateDemands`의 수요·`unplaced` + 등교·체크·칸 메모(메모리). 학생 행의 장소는 아래 "특수학급 장소" 참고 |
| `schedule.generate` | 날짜 범위 수요 → `propose({ previous: null, policies: ["fresh"] })` → draft 버전 |
| `schedule.validate`·`updateDraft` | 엔진 `validate()` + **배치 경고**(`ScheduleValidateOutput.warnings`): `SPECIAL_CLASS_UNPLACED`(그날 `unplaced`), `NO_SPECIAL_TEACHER`(그 칸 특수학급의 `teachers`가 비었음), `SPECIAL_CLASS_CROWDED`(한 특수학급 한 칸 학생 수가 기준 초과. 기준은 질문 파일에 적고 일단 8명) |
| `change.interpret` | 가짜 실명 검사 → 가짜 해석기 → `ChangeRequest`(`summary` 문장은 서버가 ops에서 만든다) |
| `change.confirm` | ops의 날짜마다: `generateDemands({ ops, now })`, 근무 = 지원인력 근무 − `staff_unavailable` 구간, previous = active 배정 → `propose({ policies: 3개, now, request: { change_request_id, ops, cause: "change_request" } })` → `Proposal` |
| `proposal.approve` | `base_version_id`가 지금 active가 아니면 `BASE_VERSION_CHANGED`. 맞으면 고른 선택지의 배정으로 새 active 버전 + `notified` = `metrics.notify_staff`(가짜 알림 기록) |
| `attendance.*`, `cell.*`, `memo.*`, `notification.ack` | 메모리. 지원인력은 오늘 자기 배정에 걸린 학생·칸만 |
| `staff.issueInvite`·`revokeDevice`·`device.redeemInvite` | 메모리. 코드 6자리, 만료 하루 |

- **오늘 변경 (D24):** `now`는 서버 시각(10분 올림, `ceil10`)이다. 테스트는 시계를 주입한다(`deps.clock`). 변경 날짜가 오늘일 때만 `generateDemands`·`propose`에 넘긴다. 지난 칸 고정은 M1 v2가 구현하므로, v1에서는 `now`를 넘기기만 하고 고정을 검사하지 않는다.
- **특수학급 장소 (D25):** 화면 행(`StudentDayRow.lessons[].location`)은 수요 생성과 같은 규칙이어야 한다. 그 요일·시각에 그 과목을 하는 특수학급이고, 하나가 아니면 `null`이다. `@ssyung/core`에 이 함수가 export되어 있지 않으면 같은 규칙을 `server/`에 짧게 두고, `contracts/requests/M7-core-placement-export.md`로 M3 export를 요청한다.
- **권한:** 호출자는 교사(member, T 코드) 또는 지원인력(staff, A 코드)이다. v1 인증은 개발용 헤더 `x-dev-actor: T01 | A02`(테스트는 컨텍스트 주입). 지원인력은 `view.staffToday`·`attendance.*`·`cell.*`·`memo.*`·`notification.ack`·`device.redeemInvite`만 부를 수 있다.

## 읽을 것
- docs/architecture.md §8.1(수요, D24·D25), §9, §10
- docs/contracts.md
- `fixtures/mock/api/*.json` (프로시저별 예시)
- `fixtures/mock/scheduler/propose.staff-away.*` (변경 요청 흐름의 기대 결과)

## 완료 조건
- [ ] `pnpm --filter @ssyung/web typecheck`, `test` 통과
- [ ] 계약의 프로시저 목록과 라우터 목록이 정확히 같다(테스트).
- [ ] 계약 테스트: `fixtures/mock/api/*.json`의 모든 예시 input으로 호출한다.
  - `output` 예시는 output이 계약 스키마를 통과한다(값은 달라도 됨).
  - `error` 예시는 같은 `code`의 오류가 난다.
- [ ] 흐름 테스트 (실제 엔진): 9/18 "지원인력1 10시 30분부터 11시 30분까지 출장"
  - `change.interpret` → `change.confirm`의 선택지 수·정책·지표(바뀐 칸·공백·늦게 도착)가 `fixtures/mock/scheduler/propose.staff-away.output.json`과 같다(같은 엔진·같은 입력).
  - `proposal.approve` 뒤 `view.day`의 배정이 고른 선택지와 같다.
  - 같은 제안을 다시 승인하면 `BASE_VERSION_CHANGED`.
- [ ] 흐름 테스트: `view.day 2026-09-18`의 수요·배정이 `fixtures/mock/api/view.day.json` 예시와 같다(같은 active 버전).
- [ ] 경고: 특수학급 시간표 한 칸을 비운 학교로 `schedule.validate` → `SPECIAL_CLASS_UNPLACED` 경고가 나온다.
- [ ] 권한: 지원인력이 교사 전용 프로시저를 부르면 `FORBIDDEN`. 남의 학생 등교 체크도 `FORBIDDEN`.
- [ ] 저장소 쓰기가 커밋된 `dataset/db/`를 바꾸지 않는다(테스트 후 `git status`에 dataset 변경 없음).
- [ ] `pnpm --filter @ssyung/web dev`: 로컬 서버가 뜨고 `/api/trpc`로 `view.day`가 응답한다(M8·M9가 붙을 서버).

## 범위 밖
- 화면(M8·M9)
- Supabase 연결과 RLS(Wave 2, 마이그레이션 초안까지는 해도 됨)
- 실제 해석기(M6)·실명 검사(M5)·알림(M10) 연결
- 버전·배정 DB 저장(M4 v2)

## 산출물
보드 `tasks/board/M7.md` 갱신(완료 조건 체크, 다음에 할 것, 다른 모듈에 필요한 것). 변경 요약, 프로시저별 구현 상태 표(실제 모듈 / 가짜), 남은 질문(`tasks/M7-questions.md`).
