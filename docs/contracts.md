# ssyung 계약과 목데이터

> 상태: 계약 0.3.1 (2026-10-22). 0.3.0 특수학급 시간표(D25)는 하위 호환 아님, 0.3.1은 `ProposeInput.request.cause` 추가. 바뀐 것과 요청 처리 기록: [contracts/requests/README.md](../contracts/requests/README.md)
> 관련 문서: [architecture.md](architecture.md), [agent-development.md](agent-development.md)

모듈마다 다른 브랜치에서 동시에 개발할 수 있도록 **모듈 사이를 오가는 데이터 형식**을 `packages/schema`(zod)에 고정하고, 그 형식을 그대로 따르는 **목데이터**를 `fixtures/mock/`에 둔다. 각 모듈은 상대 모듈이 없어도 목데이터를 입력으로 받고, 자기 출력을 목데이터와 같은 형식으로 내면 된다.

## 1. 명령

```bash
pnpm i
pnpm test          # 계약 타입 검사 + 모든 목데이터·테스트 데이터를 계약에 대어 검증
pnpm gen           # zod → JSON Schema (packages/schema/generated/json, Python·Claude tool용)
pnpm mock:build    # dataset/ + 화면 시안 엔진 → fixtures/mock/ 다시 생성 후 검증
```

## 2. 계약 파일 (`packages/schema/src`)

| 파일 | 무엇 | 만드는 쪽 → 쓰는 쪽 |
|---|---|---|
| `ids.ts` | 코드 형식(S01, A01, T01, K1, 3-2, L06, D01), `LocationRef`, `Label`(20자), `IsoDate`, `Floor`(정수 또는 `"OUT"`) | 공통 |
| `time.ts` | `Minute`(자정부터의 분, 10의 배수), `HHMM`, `Interval`, `TimeBlock`, `BellSchedule`, `Segment`, `Priority`. 공용 함수 `hhmmToMinute`·`minuteToHHMM`·`ceil10`·`weekdayOf`, 기본 일과 `DEFAULT_BELL` | 공통 (모듈마다 다시 만들지 않는다) |
| `dataset.ts` | `dataset/api/`(NEIS 행)와 `dataset/db/`(층배치·학생·지원인력 JSON) 파일 형식 | 파일 → M4 |
| `domain.ts` | `SchoolBundle`, `Location`, `ClassGroup`, `Timetable`, `Student`, `Staff`, `Duty`, `ScheduleVersion`, `Attendance`, `CellCheck`, `CellNote`, `Memo`, `Notification`, `Actor` | M4 → M3·M7·M8·M9 |
| `demand.ts` | `Demand`(lesson·move_group·requirement·duty), `DemandSet`. id는 내용에서 만든 안정된 문자열 | M3 → M1·M2 |
| `change-ops.ts` | `When`, 6종 `ChangeOp`, `ChangeOps` | M6 → M7 → M1 |
| `scheduler.ts` | `ProposeInput/Output`, `Option`, `Assignment`, `Shortfall`, `DiffEntry`, `ExplanationStep`, `Metrics`, `Policy`, `ValidateInput/Output`, `Engine` 인터페이스 | M7 → M1 → M7 |
| `solver.ts` | CP-SAT 서비스 `/assign`·`/validate` HTTP 본문 | M1(어댑터) ↔ M2 |
| `interpreter.ts` | `InterpretContext/Request/Result`, 평가 세트 형식 `ChangeRequestSet` | M7 ↔ M6 |
| `api.ts` | **tRPC 프로시저 36개의 input·output**(`procedures`), 화면 모델 `DayView`·`StaffTodayView`·`WeekView`, `ChangeRequest`, `Proposal`, `ApiError` | M7 ↔ M8·M9 |
| `scenario.ts` | 연쇄 시나리오 파일 형식 | M0 → M1·M2 |
| `version.ts` | `CONTRACT_VERSION` | — |

### 2.1 정한 규칙

- **JSON은 snake_case.** dataset 파일과 같다.
- **시각.** 엔진·API는 분(`570` = 09:30), 사람이 쓰거나 LLM이 만드는 곳(dataset, `When`)은 `"HH:MM"`.
- **장소는 코드 하나로.** 원반 교실 = 반 코드(`3-2`), 특수학급 = `K1`, 그 밖 = `L06`. 별도 location id를 두지 않는다.
- **수요 id.** `les:2026-09-18:S02:p6`, `mv:2026-09-18:b2:1-3`(2교시 뒤 쉬는 시간, 1층→3층), `req:…`, `duty:…`. 다시 계산해도 같은 수요는 같은 id라서 diff·완료 체크·칸 메모의 기준이 된다.
- **수업 지원 수요는 교시 하나 = 수요 하나**이고, 안에 구간 3개(`segments`, 시작·중간·종료와 우선순위)를 둔다. 배정은 그 일부만 덮을 수 있다(시작 10분 비움).
- **부족분(`Shortfall`)**은 수업이면 구간 단위로 나온다. 이동이 몰려 일부러 비운 체크 안 된 구간은 `waived: true`이고 지원 공백으로 세지 않는다.
- **선택지(`Option`)**는 같은 결과가 나온 정책을 합친다(`policies: ["keep_minimal", "no_late"]`). key는 합친 뒤 A, B, C 순서다.
- **설명 문장은 계약에 없다.** 이유 코드와 수요 id만 오가고, 문장은 `packages/core`가 만든다. 예외로 `ChangeRequest.summary`(해석 확인 문장)는 서버가 만들어 넘긴다.
- **읽기 화면은 `view.*` 프로시저**로 서버가 조립한다(`DayView`). 화면 개발이 DB 구조에 묶이지 않게 하기 위해서다.
- **이름 필드는 없다.** `label`은 별칭(학생1, 지원인력1)이다.
- **특수학급 장소는 특수학급 시간표로 (D25).** 학생은 `special_class_subjects`(과목 목록)만 갖고 소속 특수학급이 없다. 장소 = 그 요일·시각에 그 과목을 하는 특수학급(`SchoolBundle.special_classes[].lessons`). 하나로 안 정해지면 `DemandSet.unplaced`(장소 미정, 이동 수요 없음)와 경고 `SPECIAL_CLASS_UNPLACED`. 개발 데이터는 전부 하나로 정해진다.
- **오늘 변경은 요청 시각부터 (D24).** `ProposeInput.now`(날짜, 10분 올림 분). `now` 이후에 시작하는 칸만 바뀌고, 진행 중인 칸과 지난 칸은 그대로다. 수요 생성은 오늘 변경을 그 칸들에만 적용하고, 배치 엔진은 `now` 이전에 시작한 이전 배정을 고정한다. 목데이터의 `now`는 `null`이다(시안 엔진이 고정을 하지 않음).
- **배치 경고는 API가 계산한다.** 엔진의 `ValidateOutput.warnings`는 쓰지 않고, `schedule.validate` 출력(`ScheduleValidateOutput`)에만 있다.

## 3. 목데이터 (`fixtures/mock/`)

`pnpm mock:build`가 생성한다. **손으로 고치지 않는다.** 수요는 `@ssyung/core`(M3), 배정·선택지·검증은 `@ssyung/scheduler`(M1)가 실제로 계산한 값이다(2026-10-22부터, 그 전에는 화면 시안의 임시 규칙). 모듈 코드를 바꿔 결과가 달라지면 M0가 다시 생성하고 사람이 바뀐 값을 승인한다. 연쇄 시나리오 10개의 입력과 기준선도 같은 엔진으로 만든다. 기준일은 **2026-09-18(금) 10:15**다.

| 경로 | 계약 | 내용 | 주로 쓰는 모듈 |
|---|---|---|---|
| `domain/school.json` | `SchoolBundle` | 학교, 일과(40분 수업 6교시), 장소 54곳, 반 39개(1-3은 `has_timetable: false`), 특수학급 K1·K2 | M4 출력 기대값, M7·M8 |
| `domain/students.json` | `Student[]` | S01–S07 | 〃 |
| `domain/staff.json` | `Staff[]` | A01–A03 풀타임 | 〃 |
| `domain/timetable-2026-09.json` | `Timetable` | 9/1–12/31. 9월 수업일 20일은 dataset 그대로, **10–12월 64일은 같은 요일의 9/14–9/18 시간표를 날짜만 바꿔 복사**(공휴일 10/3·10/9·12/25 제외, 6-7반은 기준 주에 자료가 없어 빔) | M3 입력, M4 출력 기대값 |
| `demand/2026-09-18.json`, `demand/2026-09.json` | `DemandSet` | 하루 18개(수업 10 + 이동 묶음 8), 9월 전체 | M3 출력 기대값, M1 입력 |
| `schedule/active-2026-09.json` | `ScheduleSnapshot` | active 버전 배정·부족분·날짜별 지표(9/1–12/31). 10–12월은 같은 요일 9/14–9/18 배정을 날짜만 바꿔 복사 | M7, M8 |
| `scheduler/propose.absent.{input,output}.json` | `ProposeInput/Output` | 학생3 결석 → 선택지 2개 (A·C가 같아 합침) | M1 |
| `scheduler/propose.staff-away.{input,output}.json` | 〃 | 지원인력1 10:30–11:30 출장 → 선택지 3개, diff·연쇄 4단계 | M1, M8(W5), M9(T3) |
| `scheduler/validate.overlap.{input,output}.json` | `ValidateInput/Output` | 지원인력2를 이미 맡은 이동 묶음에 하나 더 끌어 놓음 → `OVERLAP` + `MOVE_GROUP_HEADCOUNT` | M1, M8(W4) |
| `solver/assign.{request,response}.json` | `AssignRequest/Response` | 출장 문제를 정책 `keep_minimal`로 | M2 |
| `interpreter/context-2026-09-18.json` | `InterpretContext` | 9/14–9/25 달력, 일과, 학생 반의 교시별 과목, 코드 목록 | M6 |
| `api/<프로시저>.json` | `apiMockSchema(<프로시저>)` | 프로시저 36개 전부. `{ input, output }` 또는 `{ input, error }` 예시 | M7(계약 테스트), M8·M9(가짜 API) |
| `manifest.json` | — | 파일 → 계약 이름 색인. 테스트가 이것으로 전부 검증 | 공통 |

목데이터 밖의 테스트 데이터:

| 경로 | 계약 | 내용 |
|---|---|---|
| `fixtures/scenarios/cascade-scenarios.json` | `CascadeScenarioSet` | 연쇄 시나리오 10개와 정책별 기준선 ([scheduler-scenarios.md](scheduler-scenarios.md)) |
| `fixtures/scenarios/inputs/S*.input.json` | `ProposeInput` | 시나리오 엔진 입력 10개 (`pnpm mock:build`가 수요 생성으로 만듦). M1·M2가 같은 입력으로 돌린다. 기초정보·시간표 변경 시나리오는 `request.cause`가 `setup`·`timetable_import` |
| `fixtures/change-requests/cases.json` | `ChangeRequestSet` | 해석기 평가 세트 22건. 어려운 유형(상대 날짜, 오전·오후, 과목→교시, 복합 명령, 지원 안 하는 요청, 수업일 아님)을 2건 이상씩 |

### 3.1 화면이 쓰는 주요 예시

| 화면 | 목데이터 |
|---|---|
| W2 학생 현황, W2b 지원인력 현황, T1 교사 앱 | `api/view.day.json`: 등교 7명, 10:00 전 완료 체크, 쉬는 시간 칸 메모 1건 |
| W3 주간 | `api/view.week.json` (9/14–9/18) |
| A1 지원인력 앱 | `api/view.staffToday.json`: 지원인력2, 첫 이동 [도착] 대기(`pending_move`), 미확인 변경 알림 1건 |
| W4 일간 편집 | `api/schedule.validate.json` |
| W5 변경 요청, T3 | `api/change.interpret.json`(부재·결석·지원 안 함·실명 의심) → `api/change.confirm.json`(선택지) → `api/proposal.approve.json`(승인·기준 버전 바뀜) |

## 4. 브랜치에서 쓰는 방법

```
main ─── 계약 + 목데이터 (M0만 수정)
  ├── <id>/m1-scheduler   scheduler/propose.*.input → 직접 계산 → output과 같은 형식, 시나리오 기준선 이상
  ├── <id>/m3-demand      domain/* → 직접 계산 → demand/*.json과 같아야 함
  ├── <id>/m4-data        dataset/ → domain/*.json과 같아야 함
  ├── <id>/m6-interpreter interpreter/context + change-requests/cases.json
  ├── <id>/m7-api         api/*.json의 input으로 부르면 output 형식으로 응답 (값은 달라도 됨)
  ├── <id>/m8-web         api/*.json을 응답하는 가짜 서버로 화면 개발
  └── <id>/m9-mobile      〃 (view.staffToday, attendance.*, cell.*, notification.ack)
```

- 목데이터는 **형식의 기준**이다. M3·M4는 값까지 같아야 하고(같은 입력에서 같은 결과), M1은 기준선보다 나빠지지 않으면 값이 달라도 된다. M7은 형식만 맞으면 된다.
- 계약이나 목데이터를 바꿔야 하면 직접 고치지 말고 `contracts/requests/`에 요청한다([agent-development.md](agent-development.md) §5). M0가 반영하고 `pnpm mock:build`로 다시 만든다.
- M1이 `packages/scheduler`를 만들면 `scripts/mock/build-mocks.ts`의 시안 엔진 부분을 그것으로 바꾼다. 그 뒤로는 목데이터가 실제 엔진의 결과다.

## 5. 아직 정하지 않은 것

- `view.*` 프로시저는 이번에 추가했다. architecture.md §9.1은 "읽기는 Supabase 직접 조회"였는데, 화면 개발을 DB와 떼기 위해 서버 조립으로 바꿨다. RLS 직접 조회는 실시간 구독(완료 체크) 정도에만 남긴다.
- 업무(`duty`)와 추가 수요(`requirement`)는 형식만 있고 목데이터에는 아직 없다(dataset에 업무가 없음).
- 교사 코드 T01·T02는 특수학급 담당으로 임의로 붙였다.
