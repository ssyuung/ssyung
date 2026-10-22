# ssyung MVP 아키텍처

> 상태: 초안 v3 (2026-10-19) — 10분 단위 시간 모델, 과목별 지원 구간, 층 묶음 이동, 날짜별 시간표, 칸 메모·완료 체크, DB·API 없이 파일로 개발하는 단계 반영
> 범위: 파일럿 학교 1곳(개발 기준 데이터: 서울개포초), 특수학급·특수교사 여러 명, 지원인력 수 명, 학생 수십 명
> 관련 문서: [cost-strategy.md](cost-strategy.md), [agent-development.md](agent-development.md), [scheduler-scenarios.md](scheduler-scenarios.md), 화면 시안 [screens/ssyung-screens.html](screens/ssyung-screens.html)

## 0. 목표와 범위

### 0.1 MVP가 증명해야 하는 것

1. 학교를 고르면 반 목록과 원반 시간표가 자동으로 들어오고, 교사는 특수학급·층 배치·학생 정보만 넣는다.
2. 교사가 정한 학생 배치(원반/특수학급), 학생별 지원 과목과 지원 구간, 수업 외 업무, 지원인력 근무 조건을 입력하면 **10분 단위 지원인력 배정 시간표**가 나온다.
3. 교사가 자연어로 변경을 요청하면, 기존 배정을 최대한 유지하는 수정안과 **연쇄 변경 설명**이 나오고 교사가 승인한다.
4. 승인된 변경이 해당 지원인력에게 팝업으로 전달되고, 교사는 누가 확인했는지 본다.
5. 교사와 지원인력이 시간표 칸마다 메모를 남기고 완료를 체크하며, 학생별 메모로 인수인계한다.

### 0.2 MVP에서 하지 않는 것

- **NEIS API 연결과 DB (첫 개발 단계).** API로 가져올 정보는 `dataset/api/`의 NEIS 형식 파일(학급정보, 2026-2학기 시간표 중 9월분), DB에 들어갈 정보는 `dataset/db/`의 JSON 파일(층 배치, 학생 7명, 배치, 지원인력 3명)로 대신한다(§4.6). 화면에는 추가·설정 버튼으로 고치는 UI를 그대로 만들고, 저장소만 JSON 파일이다. 시간표 자료가 없는 반(1-3)은 시간표 없이 둔다.
- 엑셀 자동 파싱 (CSV 템플릿만 지원)
- 결제·이용권 (파일럿은 수동 계약)
- 웹 푸시 (앱 푸시 + SMS로 대체)
- 다학교 관리자·교육청 콘솔
- 지원인력의 일정 수정 (읽기, 확인, 칸 메모, 완료 체크만)
- 분 단위 이동 시간 계산, 여러 건물 (D11)
- 지원인력 업무강도 균형·매칭 분산 **알고리즘** (원칙만 확정, D17)

### 0.3 확정된 도메인 결정

| # | 결정 | 설계에 미치는 영향 |
|---|---|---|
| D1 | 학생의 원반/특수학급 배치는 **교사가 정하고**, 이후 수정 가능 | 솔버는 배치를 계산하지 않고 **지원인력 배정만** 계산한다 |
| D2 | 지원인력 유형 구분 없음 | `staff`에 유형 컬럼 없음 |
| D3 | 수업 외 일정(등교, 점심, 하교 등)도 배정 | `time_block`(수업·쉬는 시간·점심·등교·하교), 업무 `duty` |
| D4 | 특수학급·특수교사 여러 개 | `special_class`, `special_class_teacher` |
| D5 | 교사↔지원인력 학생별 메모 주고받기 | `memo`, `memo_read` |
| D6 | 학기 단위 재생성 없이 계속 수정 | 버전이 계속 이어짐. 학기 엔티티 없음 |
| D7 | 승인은 **학교의 교사 누구나** | 학급별 승인 권한 없음 |
| D8 | 지원인력은 **현재 맡은 학생**의 메모·지원 방법만 봄 | 활성 버전의 배정 기준으로 접근 제어 |
| D9 | 특정 학생과 연결된 업무가 있음 (예: 하교 동행) | `duty_student` |
| D10 | 쉬는 시간도 배정 대상 | 쉬는 시간에도 지원 수요와 업무를 둘 수 있음 |
| D11 | 장소는 **1개 건물의 층**으로만 구분 | `location.floor`. 분 단위 이동 시간·복도 순서 계산 안 함. `travel_time` 없음 |
| D12 | 같은 쉬는 시간에 **같은 층→같은 층**으로 이동하는 학생은 **지원인력 1명이 함께** 지원. 도착 층이 같으면 장소가 달라도 같은 묶음. 인원 제한 없음(당분간) | `move_group` 자동 생성, 묶음 단위로 배정 (§8.1) |
| D13 | 학생마다 **지원 과목**을 고르고, 과목마다 **지원 구간**(시작 10분 · 중간 20분 · 종료 10분)을 체크 | `student_subject_support`. 수업 중엔 다 돕는 게 원칙이고, 쉬는 시간 이동이 몰릴 때 **체크 안 된 구간**의 우선순위를 낮춤 (§8.3) |
| D14 | 학교를 고르면 반 목록과 시간표를 가져옴. 특수학급은 NEIS에 없어 직접 입력 | `neis_import`, `school.neis_school_code`. 지금은 데이터 파일, API는 나중에 |
| D20 | 학생 배치는 **과목 기준**: 학생마다 특수학급에서 듣는 과목을 정하고, 나머지는 원반. 장소는 D25(특수학급 시간표)로 정함. 특수학급 수업은 특수교사가 맡아 **지원인력 수업 지원이 없고** 원반↔특수학급 이동 지원만 생김. 특별실 과목(과학·음악 등)도 지금은 원반에서 함 | `student_placement(student, subject)`. 날짜별 시간표에 그대로 적용 (§4.5) |
| D21 | 지원인력은 앱에서 **오늘 맡은 학생마다 등교 체크**(등교만). **결석은 교사가** 변경 요청으로 처리 | `attendance`. 교사 현황판에 등교·결석·미확인 표시. 결석은 수정안(수업 지원 해제, 이동 묶음에서 빠짐)을 승인해야 반영(P3) |
| D22 | 쉬는 시간에 이동 묶음이 사람보다 많으면 **두 번째 이동**: 한 지원인력이 쉬는 시간에 한 묶음, 다음 교시 **첫 10분**에 다른 묶음을 데려감(최대 20분). 두 번째 묶음은 10분 늦게 도착 | 늦어도 되는 묶음부터 두 번째로. 그 지원인력의 다음 수업 시작 10분은 체크 안 된 구간이면 비움(`EDGE_RELEASED`), 체크된 구간이면 마지막 수단 (§8.2-6) |
| D23 | 배정(최초 생성·변경 요청)은 **선택지 여러 개**를 내고 **교사가 고름** | 기준을 달리한 수정안 최대 3개: A 변경 최소(이전 배정 유지, 체크된 시작 구간은 비우지 않음), B 처음부터 다시(이전 배정에 묶이지 않음), C 늦게 도착 없음(두 번째 이동 안 씀). 바뀌는 칸·지원 공백·늦게 도착 학생·알림 인원으로 비교. 결과가 같은 안은 합침. 고른 안만 승인 (P3) |
| D25 | **소속 특수학급은 없다.** 특수학급마다 **요일·시각 기준 시간표**(매주 반복, 요일마다 다름)가 있고, 학생은 그 요일·시각에 자기 과목을 하는 특수학급으로 간다(예: 월 2교시에 수학을 하는 특수학급이 K1이면 그 시간 수학을 특수학급에서 듣는 학생은 K1로). 그런 특수학급이 없거나 둘 이상이면 특수학급 수업이지만 **장소 미정**: 이동 수요를 만들지 않고 경고, 교사가 배치 변경(장소 지정)으로 풂 | `special_class_lesson(special_class, day, start_min, end_min, subject)`. `student.special_class_id`와 학생별 과목 장소 없음. 수요의 `unplaced`, 경고 `SPECIAL_CLASS_UNPLACED` (§8.1) |
| D24 | **오늘 날짜의 변경은 요청 시각부터** 적용. 이미 지난 칸은 바꾸지 않고 알림도 보내지 않음 (결석·배치 변경·장소 변경·추가 지원·지원인력 부재 모두) | 요청 시각 `now`(10분 올림). 기준은 하나: **`now` 이후에 시작하는 칸만 바뀐다. 진행 중인 칸은 그대로.** 수요 생성(M3)은 오늘 변경을 `now` 이후에 시작하는 칸에만 적용하고, 배치 엔진(M1)은 `now` 이전에 시작한 이전 배정을 고정한다. 계약 `ProposeInput.now` (§8.1, §8.2-7) |
| D19 | 첫 개발은 **DB 없이** JSON 파일로. API로 가져올 정보(`dataset/api/`)와 DB에 들어갈 정보(`dataset/db/`)는 폴더를 나눔 | 저장소 인터페이스 뒤에 `JsonRepository`(지금)와 `SupabaseRepository`(나중) (§4.6) |
| D15 | 시간은 **10분 단위**. 교사는 일간 편집에서 지원인력 배정을 10분 단위로 끌어 옮김 | 배정은 `[start_min, end_min)` 구간. 일과 시각은 10분 경계에 맞춤 (§4.1) |
| D16 | 시간표 칸마다 **메모**와 **완료 체크**. 교사·지원인력 모두 쓰고 서로 봄 | `cell_note`, `cell_check` (§4.5) |
| D17 | 지원인력 **업무강도**(지금은 지원 시간)는 비슷하게, **학생-지원인력 매칭**은 고르게(한 사람이 같은 학생을 계속 맡지 않게) | 원칙만 확정. 알고리즘은 보류하고, 지표만 계산해 화면에 보여 줌 (§8.3) |
| D18 | NEIS 시간표는 **날짜별**이고 주마다 조금씩 다름 | 원반 시간표를 날짜 단위로 보관(`class_lesson`). 배정도 날짜 단위 (§4.3) |

## 1. 설계 원칙

| # | 원칙 | 구체적 의미 |
|---|---|---|
| P1 | **실명 금지** | 교사·학생·지원인력의 실명은 DB, 로그, LLM 프롬프트, 시드·테스트 데이터, 문서 어디에도 존재하지 않는다. (§5) |
| P2 | **LLM은 해석, 솔버는 결정** | LLM 출력은 구조화된 변경 명령(ChangeOps)뿐이다. 배정은 항상 제약 최적화 엔진이 계산한다. |
| P3 | **교사 승인 우선** | 어떤 변경도 교사 승인 없이 활성화되지 않는다. 시간표 자료가 바뀌어 다시 계산한 결과도 마찬가지다. |
| P4 | **버전 불변** | 배정은 바뀌지 않는 스냅샷이다. 수정은 새 버전을 만드는 것이다. |
| P5 | **지원인력은 앱 우선, 앱 없이도 가능** | 기본은 앱과 푸시. 앱이 없는 사람은 SMS 링크로 같은 일을 한다. |
| P6 | **학교 단위 격리** | 모든 데이터는 `school_id`에 속하고 RLS로 격리한다. |
| P7 | **쓰기는 API로만** | 클라이언트는 DB를 직접 읽을 수 있지만, 모든 쓰기는 API를 거친다. 실명 검사를 건너뛸 경로를 없애기 위해서다. |
| P8 | **외부 데이터와 저장소는 어댑터 뒤에** | 학교·학급·시간표 출처(지금은 파일, 나중에 NEIS API)와 저장소(지금은 JSON 파일, 나중에 Supabase)는 각각 같은 인터페이스로 감싼다. 도메인 코드는 출처와 저장소를 모른다. (§4.6) |

## 2. 시스템 구성

```
  교사 (PC 브라우저)    교사·지원인력 (앱)       지원인력 (SMS 링크)
          │                    │                      │
          ▼                    ▼                      ▼
┌──────────────────┐  ┌──────────────────┐  ┌──────────────────┐
│ apps/web         │  │ apps/mobile      │  │ apps/web /s/:tok │
│ Next.js          │  │ Expo (RN)        │  │ 알림·일정만       │
└────┬────────┬────┘  └───┬─────────┬────┘  └────────┬─────────┘
     │ 읽기·실시간  │ 쓰기        │ 쓰기     │ 읽기·실시간          │
     │ (RLS)     ▼             ▼          │ (RLS)              │
     │   ┌─────────────────────────────┐  │                    │
     │   │ API (tRPC, apps/web/server) │◀─┼────────────────────┘
     │   │ ├ 실명 검사                  │  │
     │   │ ├ 학교 데이터 가져오기 ───────┼──┼──▶ 데이터 출처 어댑터
     │   │ ├ 수요 생성 (지원 구간·묶음)  │  │     ├ 파일 (dataset/) ← 지금
     │   │ ├ 해석기 → Claude API        │  │     └ NEIS API      ← 나중에
     │   │ ├ 배치 엔진 호출 (scheduler) │  │
     │   │ └ 알림 (푸시 / SMS)          │  │
     │   └──┬──────────────┬───────────┘  │
     ▼      ▼              ▼              ▼
┌────────────────────┐  ┌──────────────────┐  ┌────────────────────┐
│ Supabase (서울)    │  │ services/solver  │  │ 외부               │
│ Postgres·Auth·     │  │ FastAPI +        │  │ Claude API         │
│ Realtime           │  │ OR-Tools CP-SAT  │  │ Expo Push → FCM/APNs│
└────────────────────┘  │ (Cloud Run)      │  │ SMS 발송사          │
                        └──────────────────┘  └────────────────────┘
```

### 컴포넌트 책임

| 컴포넌트 | 책임 | 상태 보관 |
|---|---|---|
| `apps/web` | 교사 웹 UI, API(tRPC) 호스팅, SMS 링크 화면 | 없음 |
| `apps/mobile` | 지원인력 앱(일정, 변경 팝업·알림함, 칸 메모·완료 체크, 학생 메모), 교사 보조 기능(승인, 확인 현황) | 오프라인 캐시만 |
| Supabase | 데이터, 인증(교사: 이메일, 지원인력: 기기 연결), RLS, 실시간 전파 | 전부 |
| `packages/school-data` | 학교·학급·시간표 출처 어댑터와 정규화 (§4.6) | 없음 |
| `packages/core` | 수요 생성(지원 구간, 이동 묶음), BlockRef·날짜 계산, 변경 설명 문장화 | 없음 |
| `packages/scheduler` | **배치 엔진** (§8.0). 수요 → 선택지별 배정·부족분·지표·변경 설명. 규칙과 구현을 갈아 끼울 수 있는 독립 모듈. 화면·DB·LLM을 모름 | 없음 |
| `services/solver` | 배치 엔진의 CP-SAT 구현 (HTTP). 배정만 계산하고 설명은 하지 않음 | 없음 |
| Claude API | 자연어 → ChangeOps | 없음 |

수요 생성은 API 쪽(`packages/core`)에서 한다. 솔버는 "어떤 10분 칸에 누가 필요한가"만 받는다. 그래야 교사 화면(지원 공백 표시, 이동 묶음 미리보기)과 솔버가 같은 수요를 본다.

## 3. 기술 결정

| 결정 | 선택 | 근거 | 대안 / 재검토 시점 |
|---|---|---|---|
| 교사 웹 | Next.js (App Router) + TypeScript | 빽빽한 그리드와 끌어 놓기 UI는 웹이 적합 | — |
| 앱 | Expo (React Native) | 푸시, OTA 업데이트(EAS Update), TS 코드 공유 | 일정이 급하면 웹 포장(Capacitor) |
| API | tRPC (Next.js에 함께 배포) | 웹과 앱이 같은 타입으로 호출 | 앱 트래픽이 커지면 `apps/api`로 분리 |
| DB / Auth | Supabase, `ap-northeast-2` | Postgres + RLS + Auth + Realtime, 국내 리전 | 학교가 국내 클라우드를 요구하면 이전 |
| 웹 호스팅 | Cloud Run (Next.js standalone) | 사용량 과금으로 고정비 최소화 ([cost-strategy.md](cost-strategy.md) §1.3) | 미리보기 배포가 꼭 필요해지면 Vercel |
| 최적화 | Python + OR-Tools CP-SAT | 배정은 제약 만족 + 최적화 문제. 10분 칸 기준으로도 이 규모는 수 초 내 해결 (§8.6) | — |
| Solver 호스팅 | Cloud Run | 미사용 시 비용 0에 가까움 | — |
| 배치 엔진 | TS 모듈(`packages/scheduler`) + 엔진 교체 구조 | 규칙이 계속 바뀌므로 화면·API와 분리. 임시 규칙으로 먼저 개발하고 CP-SAT는 같은 계약으로 나중에 끼움 | 규칙이 CP-SAT로만 표현될 때 엔진별 차이를 시나리오로 관리 |
| LLM | Claude API, tool use로 출력 스키마 강제 | 한국어 이해, 구조화 출력 | 기본 Haiku 4.5, 검증 실패 시 Sonnet 5.5 ([cost-strategy.md](cost-strategy.md) §2.4) |
| 알림 | 앱 푸시 우선, SMS 대체 | 푸시는 무료. 앱 미설치·미확인 시 SMS | 알림톡은 파일럿 후 |
| 공용 스키마 | zod 단일 원본 → JSON Schema → Pydantic, Claude tool 정의 | 타입이 여러 곳에서 어긋나는 것 방지 | — |
| 끌어 놓기 | Pointer Events 직접 구현 (HTML5 DnD 안 씀) | 터치 기기 지원, 10분 격자 맞춤, 눌러 고른 뒤 [여기로] 대체 경로 | 복잡해지면 dnd-kit |
| 학교 데이터 출처 | 파일 어댑터 (개발), NEIS 어댑터 (나중) | API 키·호출 한도 없이 개발. 실데이터 형식 그대로 | NEIS 연결은 파일럿 직전 (§14) |

## 4. 도메인 모델

데이터는 세 종류로 나눈다.
- **기초정보**: 잘 바뀌지 않는 학교 구조와 학생·지원인력 설정. 교사가 기초정보 화면에서 고친다.
- **가져온 데이터**: 학급과 날짜별 원반 시간표. 출처(파일, NEIS)에서 가져오고 교사가 고치지 않는다. 다시 가져오면 차이를 기록한다.
- **버전 데이터**: 변경 요청으로 자주 바뀌는 배치와 배정. 버전마다 통째로 복사해 둔다(P4). 롤백하면 이것들이 함께 돌아온다.

### 4.1 시간 모델 (D15)

- 시각은 자정부터의 **분**(`start_min`, `end_min`)으로 저장하고, 구간은 `[start, end)`이다.
- 모든 경계는 **10분의 배수**다. 일과 시각(②)을 입력할 때 10분 경계가 아니면 막는다. 초등 40분 수업 + 10분 쉬는 시간은 그대로 맞는다.
- **칸(slot)** = 10분. 솔버와 일간 편집은 칸 단위로 생각한다. 하루 08:30–15:00이면 39칸이다.
- 수업 한 교시(40분) = 4칸 = **시작 1칸 · 중간 2칸 · 종료 1칸**(D13). 45·50분 수업의 구간 나누기는 미정(§15).
- `time_block`은 요일별 **일과 틀**(몇 교시가 몇 시인지)이다. 배정 자체는 `time_block`이 아니라 날짜와 분으로 저장한다. 그래야 끌어 놓기로 교시 경계를 넘는 배정(예: 3교시 종료 + 쉬는 시간)을 표현할 수 있다.

### 4.2 기초정보: 학교·시간·장소

```
school                id, label, timezone, floors,
                      neis_office_code(B10), neis_school_code(7091371), academic_year
member                id, school_id, auth_user_id, code(T01), role(owner|teacher)
special_class         id, school_id, code(K1), location_id, label
special_class_teacher special_class_id, member_id
special_class_lesson  special_class_id, day(MON..FRI), start_min, end_min, subject   -- 특수학급 시간표 (D25). 요일·시각 기준, 매주 반복
time_block            id, school_id, day(MON..FRI),
                      kind(class|break|lunch|arrival|dismissal|other),
                      period(수업일 때 1..8, 아니면 null), start_min, end_min,
                      part_of_day(morning|afternoon)
location              id, school_id, code(L01), label,
                      kind(homeroom|special_class|special_room|office|outdoor),
                      floor(1..N, 건물 밖은 null), outdoor(bool)              -- D11
class_group           id, school_id, grade, code("3-2"), home_location_id   -- 원반, 가져온 학급에서 생성
subject_location      school_id, subject("체육"), location_id                -- 과목별 기본 장소 (선택)
```

- 쉬는 시간, 점심, 등교, 하교도 `time_block`이다(D3, D10).
- `part_of_day`는 "오전", "오후" 같은 표현을 서버가 미리 풀 때 쓴다(cost-strategy.md §2.3).
- `travel_time`은 없앴다(D11). 층이 다르다는 사실만 쓴다.
- 층 배치(③)에서 놓지 않은 특별실은 `location`을 만들지 않는다(학교에 없는 것으로 처리).

### 4.3 가져온 데이터: 학급·날짜별 시간표 (D14, D18)

```
neis_import           id, school_id, source(file|neis_api), kind(class_info|timetable),
                      academic_year, semester, date_from, date_to,
                      fetched_at, row_count, skipped_rows, diff_summary(jsonb)
class_lesson          school_id, class_group_id, date, period, subject, import_id
                      PK (class_group_id, date, period)
```

- 시간표는 **날짜 단위**로 보관한다. 같은 반도 주마다 과목 순서가 조금씩 다르다(개발 데이터에서 같은 요일·교시의 과목이 같은 비율 약 97%).
- 시각은 `class_lesson`에 없다. (요일, 교시) → `time_block`으로 시각을 찾는다.
- 장소는 저장하지 않고 계산한다. 학생 배치가 특수학급이면 특수학급 교실, 아니면 `subject_location`, 그것도 없으면 반 교실이다.
- 다시 가져오면 바뀐 (날짜, 교시)를 `diff_summary`에 남긴다. 이미 배정이 있는 날짜의 시간표가 바뀌면 재계산 draft를 만들어 승인을 받는다(P3, §6.5).
- 시간표가 없는 반(개발 데이터의 1-3)은 `class_lesson`이 0건이다. 그 반 학생은 지원 과목을 고를 수 없고, 수요도 생기지 않는다.

### 4.4 기초정보: 학생·지원인력·업무

```
student                 id, school_id, code(S01), label, class_group_id      -- 소속 특수학급 없음 (D25)
student_subject_support student_id, subject, need_start, need_mid, need_end   -- D13
support_note            id, student_id, body, updated_by, updated_at          -- 지원 방법·유의사항 (교사 관리)
staff                   id, school_id, code(A01), label
staff_availability      staff_id, day, start_min, end_min                     -- 근무 가능 구간
staff_contact           staff_id, phone_encrypted                             -- 클라이언트 접근 차단 (§5.4)
duty                    id, school_id, code(D01), label("급식 지도"), day, start_min, end_min,
                        location_id, headcount
duty_student            duty_id, student_id                                   -- 학생 동행 업무 (D9)
```

- `label`은 교사가 붙이는 식별 불가능한 별칭이다(§5.2). 실명 컬럼은 없다.
- `student_subject_support`의 `subject`는 그 학생 반의 `class_lesson`에 나오는 과목명만 허용한다. 행이 없으면 그 과목은 지원하지 않는다.
- `need_*`가 `true`인 구간은 "꼭 곁에 있어야 하는 구간"(우선순위 높음), `false`인 구간은 "이동이 몰리면 비울 수 있는 구간"(우선순위 낮음)이다. 새 과목을 고르면 세 구간 모두 `true`로 시작한다.

### 4.5 버전 데이터

```
schedule_version     id, school_id, parent_id, status(draft|active|archived),
                     date_from, date_to,                         -- 이 버전이 배정을 가진 날짜 범위
                     cause(setup|change_request|timetable_import|manual|rollback),
                     created_by, created_at, activated_at
student_placement    version_id, student_id, subject,
                     placement(homeroom|special_class)    -- 과목 기준 규칙 (D1, D20). 특수학급 장소는 특수학급 시간표로 정함(D25). 행이 없는 과목은 원반
placement_override   version_id, student_id, date, period, placement, location_id  -- 특정 날짜만
support_requirement  version_id, student_id, date, start_min, end_min, headcount   -- 과목 지원 외에 손으로 넣은 수요 (쉬는 시간 등)
staff_absence        version_id, staff_id, date, start_min, end_min                -- 출장·병가 등
staff_assignment     version_id, staff_id, date, start_min, end_min, location_id,
                     target_kind(lesson|move_group|requirement|duty), target_ref(jsonb),
                     pinned(bool)
move_group           version_id, date, start_min, end_min, from_floor, to_floor    -- 파생값, 설명·화면용으로 저장
move_group_student   version_id, move_group_key, student_id, from_location_id, to_location_id
```

- **입력**: `student_placement`, `placement_override`, `support_requirement`, `staff_absence`. **출력**: `staff_assignment`. `move_group`은 입력에서 계산한 파생값이지만, 변경 설명과 화면에서 같은 묶음을 가리키려고 함께 저장한다.
- 배치는 **과목 기준 규칙**(D20)으로 정한다. "S04는 과학을 K1에서"처럼 정하면 날짜별 시간표(D18)에서 그 과목이 있는 교시마다 자동으로 적용된다. 특정 날짜·교시만 다르면 `placement_override`를 쓴다.
- 학교당 `active` 버전은 하나다(부분 유니크 인덱스). 활성화는 하나의 트랜잭션에서 이전 active → archived, 새 draft → active로 바꾼다.
- 롤백은 과거 버전을 복제해 새 draft를 만든 뒤 승인하는 것이다.
- **날짜 범위**(제안, §15-1): 버전은 "이번 주 + 다음 주"(10 수업일)의 배정을 가진다. 매주 금요일 오후 또는 시간표를 다시 가져왔을 때, 다음 주를 앞 주 같은 요일 배정을 기준으로 재최적화해 draft를 만든다. D6(계속 수정)을 유지하면서 날짜별 시간표를 다룰 수 있다.

### 4.6 데이터 원천과 저장소 (D14, D19, P8)

첫 개발 단계는 DB와 NEIS API 없이 파일만으로 돌아간다. 출처가 다른 두 종류를 폴더로 나누고, 각각 인터페이스 뒤에 둔다.

```
dataset/
├── api/서울개포초등학교/    API로 가져올 정보 (NEIS 응답 형식 그대로, 읽기 전용)
│                            → SchoolDataSource: FileSource(지금) / NeisSource(나중)
└── db/서울개포초등학교/     DB에 저장될 정보 (화면에서 만들고 고침)
                             → Repository: JsonRepository(지금) / SupabaseRepository(나중)
```

**① 학교 데이터 출처** (`packages/school-data`)

```ts
interface SchoolDataSource {
  searchSchools(query: string): Promise<SchoolRef[]>          // 이름 검색
  getClassInfo(school: SchoolRef, year: number): Promise<ClassInfo[]>
  getTimetable(school: SchoolRef, from: Date, to: Date): Promise<LessonRow[]>
}
```

| 파일 (`dataset/api/서울개포초등학교/`) | 내용 | 정규화 규칙 |
|---|---|---|
| `학급정보.json` | NEIS 학급정보 응답 그대로. 2025·2026학년도 80개 행 | 첫 행은 한글 열 이름이므로 건너뜀. `AY`로 학년도를 거름(2026 → 39개 반: 1~6학년 6/5/6/7/7/8반) |
| `초등학교시간표.json` | NEIS 초등학교시간표 응답 그대로. 2026-2학기 10,000행 | 첫 행 건너뜀. `ITRT_CNTNT`가 빈 행(토요일, 휴일 자리표시)은 버림. **개발에는 자료가 온전한 9월(9/1–9/30)만 쓴다.** 10/22는 1만 행 한도에서 잘렸다. 휴일(9/24·25)은 수업 없는 날. 6-7반은 9/28부터만 자료가 있어 그 전은 빈 날로 둔다 |
| `*_오픈API명세서.xls` | NEIS API 명세 | NEIS 어댑터 구현 시 참고 |

- 1-3반은 시간표 자료가 없다. 시간표 없는 반이 실제로 생긴다는 사례로 그대로 둔다.
- NEIS 어댑터를 붙일 때 고려할 것: 1회 응답 행 수 한도가 있어 페이지 단위로 받아야 한다(개발 파일이 정확히 1만 행에서 잘린 것이 그 증거). 학교코드·교육청코드는 학교 기본정보 API에서 얻는다.

**② 저장소** (`packages/repository`)

```ts
interface Repository {
  school: { get(); saveLayout(layout: FloorLayout) }
  students: { list(); add(input); update(code, patch); remove(code) }
  staff: { list(); add(input); update(code, patch); remove(code) }
  // 버전·배정·메모는 DB 단계에서 추가. 그 전에는 메모리에만 둔다
}
```

| 파일 (`dataset/db/서울개포초등학교/`) | 내용 | 화면 | 대응 테이블 |
|---|---|---|---|
| `층배치.json` | 5층, 반 39개(3학년은 2·3층에 나뉨), K1·K2 모두 1층, 특별실 9곳, 건물 밖 4곳. **임의로 만든 값, 실제 배치 아님** | ③ | `special_class`, `location`, `class_group.home_location_id` |
| `특수학급시간표.json` | K1·K2의 요일·시각별 과목(국어·수학). 9월 학생의 특수학급 수업 253칸이 모두 특수학급 하나로 정해지도록 만듦. **임의로 만든 값** | ③(특수학급 시간표) | `special_class_lesson` |
| `학생.json` | S01–S07 학생1~7. 모두 다른 반(3-2, 4-1, 5-3, 4-4, 4-7, 5-5, 5-6). 학생마다 `special_class_subjects`(특수학급에서 듣는 과목 목록, 지금은 모두 국어·수학. 장소는 특수학급 시간표로 정함)와 `support_subjects`(원반 수업에서 지원이 필요한 과목과 지원 구간, 지금은 모두 과학·영어·음악)를 둔다. 둘 다에 있는 과목은 특수학급 수업이 우선이라 지원 수요가 생기지 않는다 | ④ ⑥ | `student`, `student_placement`, `student_subject_support`, `support_note` |
| `지원인력.json` | A01–A03 지원인력1~3. 근무는 모두 풀타임(월~금 08:40–16:40으로 가정) | ⑧ | `staff`, `staff_availability` |

- 화면은 처음부터 **추가·설정 버튼으로 고치는 UI**로 만든다. `JsonRepository`가 파일을 읽어 초기값을 주고, 쓰기는 같은 파일에 반영한다(개발 서버에서만). DB 단계로 넘어가면 구현만 `SupabaseRepository`로 바꾸고 화면·API는 그대로 둔다.
- JSON 파일 형식은 zod 스키마로 검증한다. 같은 스키마로 DB 시드도 만든다.
- 학생 지원 구간(개발 데이터, 임의로 정함). 7명 모두 국어·수학은 특수학급에서 듣고, 원반의 과학·영어·음악을 지원받는다:

| 학생 | 과학 시작·중간·종료 | 영어 | 음악 |
|---|---|---|---|
| S01 (3-2) | ✓ ✓ ✓ | ✓ · ✓ | ✓ · · |
| S02 (4-1) | ✓ ✓ · | · ✓ · | ✓ · ✓ |
| S03 (5-3) | · ✓ ✓ | ✓ ✓ ✓ | · · ✓ |
| S04 (4-4) | ✓ · ✓ | ✓ ✓ · | ✓ ✓ ✓ |
| S05 (4-7) | ✓ ✓ ✓ | · · ✓ | · ✓ · |
| S06 (5-5) | · ✓ · | ✓ · ✓ | ✓ ✓ · |
| S07 (5-6) | ✓ · · | ✓ ✓ ✓ | · ✓ ✓ |

- `label`은 별칭이다. 개발 데이터에도 사람 이름은 없다. 학교명과 과목명만 있다(P1).

### 4.7 변경 요청

```
change_request       id, school_id, base_version_id, raw_text, parsed_ops(jsonb),
                     status(parsed|confirmed|proposed|approved|rejected|failed),
                     created_by, created_at
proposal             id, change_request_id, draft_version_id, diff(jsonb),
                     explanation(jsonb), solver_meta(jsonb)
approval             proposal_id, approved_by(member_id), approved_at
llm_call             id, school_id, change_request_id, model, effort, input_tokens,
                     output_tokens, cache_read_input_tokens, escalated, teacher_edited
```

- 승인은 학교의 교사 누구나 할 수 있다(D7).
- `base_version_id`가 승인 시점의 active 버전과 다르면 승인을 막고 재계산을 요구한다.

### 4.8 알림·메모·칸 메모·기기

```
notification         id, school_id, staff_id, version_id | cell_note_id, kind(version|cell_note|memo),
                     channel(push|sms|in_app), sent_at, delivery_status, acknowledged_at
staff_invite         id, staff_id, code_hash, expires_at, used_at
staff_device         id, staff_id, auth_user_id, push_token, revoked_at
staff_access_token   id, staff_id, token_hash, version_id, expires_at, revoked_at   -- SMS 링크
memo                 id, school_id, student_id, author_member_id | author_staff_id,
                     body, created_at                                             -- 학생 전체 메모 (D5)
memo_read            memo_id, reader_member_id | reader_staff_id, read_at
cell_note            id, school_id, date, start_min, target_kind(student|duty|move_group),
                     target_ref, author_member_id | author_staff_id, body, created_at   -- D16
cell_check           school_id, date, start_min, target_kind, target_ref,
                     staff_id, done_at, done_by_member_id | done_by_staff_id,
                     arrived_student_ids(이동 묶음일 때)                                -- D16
attendance           school_id, date, student_id, status(present|absent),
                     checked_by_staff_id | checked_by_member_id, checked_at             -- D21 등교 체크. 행이 없으면 미확인
```

- 칸 메모와 완료 체크는 **버전이 아니라 (날짜, 시작 시각, 대상)** 에 붙는다. 배정이 바뀌어 새 버전이 되어도 메모가 사라지지 않고, 새 담당자에게 그대로 보인다(인수인계).
- 지원인력 앱은 확인하지 않은 `kind=version` 알림이 있으면 열 때마다 팝업으로 띄운다. 확인한 알림은 오른쪽 위 알림함(종 아이콘)에서 다시 본다.

## 5. 식별자와 개인정보

### 5.1 식별자 체계

| 대상 | 코드 | 발급 |
|---|---|---|
| 교사 | `T01` … | 시스템 자동 |
| 학생 | `S01` … | 시스템 자동 |
| 지원인력 | `A01` … | 시스템 자동 |
| 특수학급 | `K1` … | 시스템 자동 |
| 업무 | `D01` … | 시스템 자동 |
| 장소 | `L01` … | 시스템 자동 (장소명은 실명 대상 아님) |
| 원반 | `3-2` | 가져온 학급정보 (학년-반) |

이름 필드는 지금 두지 않는다. 이름 저장은 아직 고려하지 않는다(2026-10-22). 화면에는 코드와 별칭(`label`)을 보인다.

### 5.2 라벨

교사가 짧은 별칭(`label`)을 붙일 수 있다. 예: `3-2 오전`, `휠체어`. 길이(20자)만 검사한다.

### 5.3 실명 검사 (보류)

입력 텍스트의 실명 검사·차단은 **지금 고려하지 않는다**(2026-10-22 사용자 결정). 실명 검사 모듈(M5)과 `NAME_SUSPECTED` 오류는 보류이고 쓰지 않는다. 개발 규칙으로는 사용자가 올린 이미지(실제 시간표 등)에 보이는 이름만 데이터·코드·문서에 옮기지 않는다.

### 5.4 이름이 아닌 개인정보

| 정보 | 필요 이유 | 처리 |
|---|---|---|
| 교사 이메일 | 로그인 | Supabase Auth에만 보관, 화면에는 마스킹 |
| 지원인력 전화번호 | SMS 발송 | `staff_contact`에 애플리케이션 레벨 암호화, 발송 시점에만 복호화 |
| 지원 방법·메모·칸 메모 | 핵심 기능 | 진단명 등 상세 정보는 입력 가이드로 최소화 유도 |
| 푸시 알림 내용 | 알림 | **코드도 넣지 않는다.** 잠금화면에는 "일정이 변경되었습니다"만 표시 |
| 앱 기기 저장소 | 오프라인 일정 | 암호화 저장, 코드만 |

### 5.5 로그·테스트

- 서버 로그에 요청 본문, 프롬프트, 메모 본문, 전화번호를 남기지 않는다. ID와 코드만 남긴다.
- 시드·테스트·데모 데이터는 코드만 쓴다. 가상 이름도 쓰지 않는다.
- CI에 실명 패턴 검사를 걸어 테스트 데이터, 시드, 문서에 이름 같은 문자열이 들어오면 실패시킨다. `dataset/`의 학교명은 허용 목록에 넣는다.

## 6. 화면과 핵심 흐름

### 6.0 화면 목록

시안은 [screens/ssyung-screens.html](screens/ssyung-screens.html)에 있다. "직접 조작"은 시안에서 실제로 눌러 볼 수 있는 화면이다.

| 코드 | 화면 | 핵심 동작 | 시안 |
|---|---|---|---|
| W1 | 설정 마법사 (9단계) | §6.1 | 개요 |
| W1-1·3·4·5·8 | 학교 선택, 학급·층, 학생, 원반 시간표, 지원인력 | 데이터 가져오기, 층 끌어 놓기, 학생 추가·지원 과목·구간 체크, 주 단위 시간표 확인, 지원인력 추가·근무 시간 설정 | 직접 조작 |
| W1-6 | 학생 배치·지원 | 과목 기준으로 원반/특수학급(화면 시안은 아직 요일×교시 그리드, 고칠 예정), 추가 지원 칸 | 정적 |
| W2 | 홈: 학생 현황판 | 세로 시간 × 가로 학생. 머리글에 등교·결석·미확인, 결석 학생 열은 흐리게. 배치는 칸 전체 색, 지원은 왼쪽 띠 + 지원인력 칩. 칸을 누르면 칸 메모·완료 | 직접 조작 |
| W2b | 지원인력 현황 | 세로 시간 × 가로 지원인력. 지금 비어 있는 사람 찾기, 사람별 지원 시간 합계(D17 지표) | 직접 조작 |
| W3 | 주간 보기 | 지원인력 1명의 한 주, 쉬는 시간 행 포함 | 정적 |
| W4 | 일간 편집 | 10분 격자 끌어 놓기, 지원 공백 표시, 즉시 검사(`/validate`), [변경 적용] → draft | 직접 조작 |
| W5 | 변경 요청 | 입력 → 해석 확인 카드 → **선택지 카드**(변경 최소 / 처음부터 다시 / 늦게 도착 없음, 바뀌는 칸·지원 공백·늦게 도착·알림 숫자 비교, 결과가 같으면 합침) → 고른 안의 수정안. 요청을 지금 배정에 적용해 다시 계산하고 바뀌는 지원인력·학생 열만 전·후 비교(없어짐 빨강, 바뀜 노랑, 새로 생김 초록, 변경 전·후 칸을 띄워 놓음), 연쇄 변경 단계(요청 → 수요 변화 → 다시 배정 → 공백, §8.7). 승인하면 모든 화면에 반영 | 직접 조작 |
| W6 | 학생 상세 | 지원 방법, 학생 메모 스레드 | 정적 |
| T1 | 교사 앱: 학생 시간표 | 학생을 골라 오늘 시간표(수업·이동). 칸마다 완료 체크 상태(✓ 완료·완료 체크 없음·진행 중·예정·지원 공백), 등교 상태. 칸을 누르면 칸 메모. 완료 체크는 지원인력만 함 | 직접 조작 |
| T2 | 교사 앱: 지금 현황 | 지금(10분씩 앞뒤로 이동) 학생마다 어디서·누구와 있는지. 확인할 것(지원 공백, 등교 미확인, 완료 체크 없이 끝난 칸)을 맨 위에 | 직접 조작 |
| T3 | 교사 앱: 변경 요청·승인 | 입력 → "이렇게 이해했어요" → 선택지 카드(숫자 비교) → 고른 안 승인. W5와 같은 계산. 예: "학생3 오늘 결석", "지원인력3 오늘 병가" | 직접 조작 |
| A1 | 앱: 오늘 일정 | 변경 팝업, 알림 배지, **이동 카드**(진행 중이거나 30분 안의 이동을 맨 위에 고정, 1분 전 알림, [도착] 한 번이면 완료, 묶음이면 학생별 체크), **오늘 맡은 학생 등교 체크(등교만)**, 칸 상세(지원 방법·칸 메모·완료 체크) | 직접 조작 |
| A2 | 앱: 알림함 | 확인 안 한 변경은 맨 위 고정 | 정적 |
| A3 | 앱: 칸 상세 | 처음 맡는 학생이면 인수인계 표시 | 정적 |
| A4 | 앱: 학생 메모 | 학생 전체 메모 스레드 | 정적 |

**화면 공통 규칙**
- 색: 지원인력마다 색(A01 파랑 `#2a78d6`, A02 주황 `#eb6834`, A03 청록 `#1baf7a`, A04 자주 `#a04c9a`), 특수학급마다 색(K1 초록 `#008300`, K2 노랑 `#eda100`). 원반은 흰색. 연하고 투명하게 칠한다. 어두운 테마는 별도 값을 쓴다. 팔레트는 색각 이상 검사를 통과한 값이다. 5번째 이후는 색 대신 코드 글자로 구분한다.
- 상태 표시: 변경은 주황 테두리만, 지원 공백은 빨간 빗금, 이동 지원은 점선.
- 학생·지원인력은 화면 어디에서나 코드로만 표시한다.

### 6.1 초기 설정과 최초 생성

마법사는 9단계다. 앞 단계 결과가 뒤 단계 입력이 되도록 순서를 정했다. 단계마다 저장되어 이어서 할 수 있고, 완료 후에는 "기초정보" 메뉴에서 같은 화면으로 고친다.

| 단계 | 입력 | 저장 |
|---|---|---|
| ① 학교 선택·교사 | 학교 이름 검색 → 선택하면 학급정보·시간표를 가져옴(지금은 파일, 서울개포초만). 가져온 결과(반 수, 시간표 기간, 시간표 없는 반) 확인. 교사 초대(T01…), 특수학급 담당 교사 | `school`, `neis_import`, `class_group`, `class_lesson`, `member`, `special_class_teacher` |
| ② 일과 시간 | 등교·교시·쉬는 시간·점심·하교 시각(10분 경계). 요일별 교시 수는 가져온 시간표에서 계산해 채우고, 같은 학년에서 반마다 다르면 표시 | `time_block` |
| ③ 학급·층 | 반 수는 가져온 값 그대로. **특수학급 개수**만 입력. 층 수를 정하고 반·특수학급·특별실을 층으로 끌어 놓기(학년 이름표를 끌면 학년 전체, 눌러 고른 뒤 [여기로]도 가능). 반·특수학급은 건물 밖에 놓을 수 없음. 개발 중에는 `db/층배치.json`으로 미리 채움([기본 배치] / [모두 비우기]). 놓지 않은 특별실은 없는 것으로 처리 | `special_class`, `location`, `class_group.home_location_id` |
| ④ 학생 | [+ 학생 추가](코드 자동), 별칭(입력 중 실명 경고, 화면에는 코드 대신 별칭 표시), 소속 반, 특수학급. **특수학급에서 듣는 과목**(눌러 고름, 그 과목은 지원 과목에서 빠짐). **지원 과목**: 그 반 시간표에 나오는 과목을 수업 수(9월 합계)와 함께 보여 주고 눌러 고름. **지원 구간**: 고른 과목마다 시작 10분·중간 20분·종료 10분 체크. **학생 시간표**: 소속 반의 날짜별 시간표로 자동으로 만들고 주 단위(‹ ›)로 넘겨 봄. 지원 과목 칸에 구간 막대 표시. 요약(9월·이 주 지원 수업 시간, 꼭 필요한 구간 분, 비울 수 있는 구간 분). 지원 방법·유의사항. CSV 가능. 개발 중에는 `db/학생.json`에서 읽음 | `student`, `student_subject_support`, `support_note` |
| ⑤ 원반 시간표 | 가져온 시간표를 주 단위(‹ ›)로 확인. 휴일·자료 범위 밖 날짜 표시. 학생이 있는 반과 학생이 지원받는 칸 표시. 시간표 없는 반은 비워 둠 | (읽기 전용) |
| ⑥ 학생 배치·지원 | 학생마다 특수학급에서 듣는 과목(과목 기준, D20), 과목 지원 외에 추가로 필요한 칸(쉬는 시간 포함)과 인원. **이동 묶음 미리보기**(이 배치로 생기는 쉬는 시간 이동) | draft v1의 `student_placement`, `support_requirement` |
| ⑦ 수업 외 업무 | 업무 이름, 요일·시각, 장소, 인원, 동행 학생. 프리셋(등교 지원, 급식 지도, 하교 동행)에서 시작 | `duty`, `duty_student` |
| ⑧ 지원인력 | [+ 지원인력 추가](코드 자동), 별칭(실명 경고), 근무 요일·시간([풀타임] 한 번에 채우기, 요일별 수정), 연락처, 앱 초대 코드. 개발 중에는 `db/지원인력.json`에서 읽음 | `staff`, `staff_availability`, `staff_contact`, `staff_invite` |
| ⑨ 검토·생성 | 누락 검사(지원 과목이 있는데 시간표가 없는 학생, 층이 없는 장소, 근무 인원보다 많은 수요 칸) 후 [배정 생성] | draft v1의 `staff_assignment`, `move_group` |

모든 자유 텍스트(별칭, 지원 방법, CSV 셀)는 저장 전에 실명 검사를 거친다.

```
교사 ── [배정 생성] ──▶ API: 수요 생성 (§8.1) ──▶ 배치 엔진 propose (선택지별)
  solver ──▶ { feasible, assignments } 또는 { infeasible, reasons }
  API: draft v1에 배정·이동 묶음 저장 ──▶ W4 일간 편집 표시
교사 ── 끌어 놓기로 조정 (놓을 때마다 /validate로 위반 표시)
교사 ── [승인] ──▶ v1 active ──▶ 전원에게 알림
```

### 6.2 자연어 변경

```
① 교사 입력: "3-2반 금 3교시 강당 이동, 이번 주만"
② API: 실명 검사 ─ 실패 시 중단
③ API: 컨텍스트 사전 계산 (날짜 달력, 오전·오후 범위, 그 주의 반별 과목→교시, 코드 목록)
④ 해석기 → Claude (Haiku, 검증 실패 시 Sonnet) ─ tool로 스키마 강제
⑤ API: ChangeOps 검증 (존재하는 코드, 날짜·교시 범위, 명령 간 충돌)
⑥ 교사에게 "이렇게 이해했어요" 카드 ─ 고치기 / 맞아요
⑦ API: active 버전 입력 복사 → ChangeOps 적용 → 수요 다시 생성 ─▶ 배치 엔진 propose (이전 배정 + 선택지 기준)
⑧ solver → 새 배정 + diff + 변경 설명(연쇄)
⑨ API: draft + proposal 저장 ─▶ W5: 바뀌는 열만 전후 비교, 연쇄 변경 목록
⑩ 교사(누구나) [승인] ─ base_version 일치 확인 → 활성화
⑪ 바뀐 배정이 있는 지원인력에게만 알림
```

과목명이 나오는 요청("목요일 체육")은 ③에서 그 주 시간표로 교시를 미리 풀어 둔다. 날짜별 시간표라 같은 요일이라도 주마다 답이 다를 수 있기 때문이다. ChangeOps로 표현할 수 없는 요청(`unsupported`)이면 W4에서 직접 수정하라고 안내한다.

### 6.3 알림·확인

```
활성화 ─▶ 바뀐 지원인력 목록 계산
       ├ 앱 연결됨: 푸시 ("일정이 변경되었습니다")
       └ 앱 없음:   SMS + staff_access_token 링크
       ─▶ N분 안에 확인 없으면 SMS 재발송
지원인력 ─▶ 앱을 열면 변경 팝업 (바뀐 칸, 새로 맡는 학생 강조)
         ─▶ [확인했어요] ─▶ notification.acknowledged_at
         ─▶ Realtime ─▶ 교사 홈·알림 현황
         ─▶ 이후 종 아이콘 알림함에서 다시 보기
```

링크나 알림을 연 것만으로는 확인 처리하지 않는다. 버튼을 눌러야 확인이다.

### 6.4 메모·칸 메모·인수인계

```
교사 또는 지원인력 ─▶ 시간표 칸을 누름 (W2·W4·A1)
  ─▶ 칸 상세: 지원 방법, 그 칸의 메모, 완료 체크
  ─▶ 칸 메모 작성 ─▶ API: 실명 검사 ─▶ cell_note 저장
       ─▶ 그 칸 담당 지원인력 + 학교 교사에게 표시 (지원인력에게는 앱 알림)
  ─▶ 완료 체크 ─▶ cell_check 저장 ─▶ Realtime ─▶ 교사 현황판에 표시

학생 전체 메모(W6·A4) ─▶ memo (칸과 무관)

담당 변경 (A02 → A01) 승인 시
  ─▶ A01의 변경 팝업에 "새로 맡는 학생 S05" 표시
  ─▶ A01이 S05의 지원 방법, 학생 메모, 해당 칸의 이전 칸 메모를 볼 수 있게 됨
  ─▶ A02는 S05를 더 맡지 않으면 접근이 끊김 (D8)
```

### 6.5 등교 체크 (D21)

```
지원인력 앱 A1 ─▶ 오늘 맡은 학생 목록 (활성 버전 배정 기준)
  ─▶ 학생마다 [등교] ─▶ attendance.set (다시 누르면 취소)
  ─▶ Realtime ─▶ 교사 W2 머리글: 등교 08:46 / 결석 / 미확인
결석 ─▶ 교사가 변경 요청("학생3 오늘 결석", 교사 앱 T3 또는 웹 W5)
     ─▶ 수정안: 그 학생 수업 지원 해제, 이동 묶음에서 빠짐(혼자면 묶음 해제), 비게 되는 지원인력
     ─▶ 승인 ─▶ attendance=absent, 새 버전 활성화, 바뀐 지원인력에게 알림 (P3)
```

### 6.6 이동 완료 체크

```
이동 1분 전 ─▶ 지원인력 앱 푸시 + 이동 카드 맨 위 고정: "10:30 (5-3, 5-5) → (K2)"
  ─▶ [도착] ─▶ cell.check (묶음이면 함께 도착한 학생 목록도 저장, 같이 못 간 학생은 체크를 끄고 누름)
  ─▶ Realtime ─▶ 교사 화면 그 칸 오른쪽에 녹색 ✓
체크가 없어도 교사 화면에 따로 경고하지 않음 (칸 상세에서 확인)
```

### 6.7 시간표 다시 가져오기 (제안)

```
(나중: 매주 정해진 시각 / 지금: 교사가 [다시 가져오기])
  ─▶ 어댑터로 다음 주 시간표 조회 ─▶ class_lesson과 비교 ─▶ neis_import.diff_summary
  ─▶ 바뀐 칸이 없으면 다음 주 배정만 앞 주 기준으로 생성해 draft
  ─▶ 바뀐 칸이 있으면 수요 다시 생성 → /reoptimize (이유 코드 TIMETABLE_CHANGED)
  ─▶ 교사에게 "다음 주 시간표가 n칸 바뀌어 수정안이 있어요" ─▶ 승인 (P3)
```

## 7. ChangeOps 스키마

`packages/schema/src/change-ops.ts`(zod)가 단일 원본이다.

시간은 `When`으로 가리킨다. 날짜별 시간표(D18)라서 **날짜가 기본**이고, 요일은 `scope: permanent` 규칙에서만 쓴다.

```jsonc
// When
{ "date": "2026-10-16", "period": 3 }                         // 수업
{ "date": "2026-10-16", "kind": "break", "after_period": 2 }  // 쉬는 시간
{ "date": "2026-10-16", "kind": "lunch" }                     // 수업 외
{ "date": "2026-10-16", "start": "10:30", "end": "10:40" }    // 10분 단위 직접 지정
{ "day": "FRI", "period": 3 }                                 // permanent 규칙에서만
```

```jsonc
{
  "ops": [
    // 원반 수업 장소 변경 (행사, 교실 이동)
    { "op": "relocate_class", "class_group": "3-2", "when": { "date": "2026-10-16", "period": 3 }, "location": "L07" },
    // 지원인력 부재 (출장, 병가)
    { "op": "staff_unavailable", "staff": "A02", "when": [{ "date": "2026-10-14", "period": 5 }, { "date": "2026-10-14", "kind": "dismissal" }] },
    // 학생 배치 변경 (D1: 교사가 정한 배치를 수정)
    { "op": "set_placement", "student": "S05", "when": { "day": "MON", "period": 4 }, "placement": "special_class" },
    // 과목 외 추가 지원 수요 (쉬는 시간 포함, D10)
    { "op": "set_support", "student": "S05", "when": { "date": "2026-10-13", "kind": "break", "after_period": 2 }, "headcount": 1 },
    // 특정 배정 고정 (학생 지원, 이동 묶음, 업무)
    { "op": "pin_assignment", "staff": "A01", "target": { "student": "S03" }, "when": { "date": "2026-10-15", "period": 5 } },
    // 결석 (D21: 결석은 교사가 변경 요청으로 처리). 그날 그 학생의 수업 지원은 없어지고 이동 묶음에서 빠짐
    { "op": "mark_absent", "student": "S03", "when": { "date": "2026-09-18" } }
  ],
  "scope": "this_week" | "permanent",
  "confidence": "high" | "medium" | "low",
  "unsupported": null | "표현할 수 없는 이유"
}
```

- MVP는 위 6가지 op만 지원한다. 실제 요청 로그를 보고 늘린다. 지원 과목·구간 변경, 업무 자체 변경(예: 급식 지도 인원)은 기초정보 화면(④, ⑦)에서 처리한다.
- `scope: this_week`는 그 주 날짜에만 적용된다(`placement_override` 등). `permanent`는 규칙(`student_placement` 등)을 바꾼다. 버전이 날짜 범위를 가지므로(§4.5) "이번 주만"을 원복 승인 없이 표현할 수 있다.

## 8. 배치 엔진 (scheduler)

D1에 따라 학생 배치는 입력값이다. 배치 엔진은 **10분 칸 단위 수요에 지원인력을 배정하는 문제**만 푼다. 배정 규칙은 파일럿 동안 계속 바뀌므로, 엔진을 화면·API·DB와 떨어진 **독립 모듈**로 둔다.

### 8.0 모듈 경계

```
             수요 생성 (packages/core/demand, §8.1)
                        │ Demand[]
                        ▼
┌───────────────────────────────────────────────────────────────┐
│ packages/scheduler                                             │
│                                                                │
│  propose(input) → Option[]          ← API가 부르는 유일한 입구  │
│    input: demands, staff(근무·부재), previous(이전 배정),       │
│           pinned, options(선택지 기준 목록, D23)                │
│    Option: { key, assignments, shortfalls, metrics,            │
│              diff, explanation }                               │
│  validate(input, assignments) → 위반·부족분                     │
│                                                                │
│  ├ engines/      Engine 인터페이스 assign(problem, policy)      │
│  │   ├ heuristic   임시 규칙 (TS, 지금 시안의 규칙, 개발·대체용) │
│  │   └ cpsat       services/solver 호출 어댑터 (HTTP)           │
│  ├ rules/        규칙 하나 = 파일 하나. 켜고 끔                  │
│  │   ├ move-group       같은 층→같은 층 묶음 1명 (D12)          │
│  │   ├ segment-priority 지원 구간 우선순위 (D13)                │
│  │   ├ second-trip      두 번째 이동·늦게 도착 비용 (D22)       │
│  │   ├ edge-release     시작 10분 비움 (D22)                    │
│  │   ├ keep-previous    이전 배정 유지                          │
│  │   └ (보류) balance, rotation (D17)                          │
│  ├ policies/     선택지 = 규칙 조합 + 우선순위 (D23)            │
│  │   변경 최소 / 처음부터 다시 / 늦게 도착 없음                  │
│  ├ diff.ts       이전 ↔ 새 배정 비교 (없어짐·바뀜·생김·공백)     │
│  ├ explain.ts    연쇄 변경 단계와 이유 코드 (§8.7)              │
│  └ metrics.ts    바뀌는 칸, 지원 공백, 늦게 도착, 알림 인원       │
└───────────────────────────────────────────────────────────────┘
```

- **입출력은 계약(`packages/schema/scheduler.ts`)으로 고정**한다. 엔진 내부를 바꿔도 API·화면은 그대로다.
- **엔진 두 개를 같은 시나리오로 검증**한다. 임시 규칙 엔진(TS)은 지금 바로 쓰고, CP-SAT 엔진은 준비되면 정책별로 바꿔 끼운다. 둘 다 같은 시나리오 테스트(`fixtures/scenarios/`)와 같은 독립 제약 검사기를 통과해야 한다.
- **설명과 지표는 엔진 밖에서** 만든다. `diff`·`explain`·`metrics`는 이전 배정과 새 배정만 보고 계산하므로 어떤 엔진을 써도 같은 설명이 나온다. 그래서 CP-SAT 서비스는 배정만 돌려준다.
- **규칙 추가 절차**: `rules/`에 파일 추가 → 정책에서 켬 → 시나리오 추가(기대 결과 포함) → 두 엔진 모두 통과. 규칙이 계약을 바꾸면 §5 계약 변경 절차(agent-development.md)를 따른다.
- 연쇄 시나리오 10개는 [scheduler-scenarios.md](scheduler-scenarios.md)와 `fixtures/scenarios/cascade-scenarios.json`에 있다.

### 8.1 수요 생성 (`packages/core/demand`)

버전 입력과 가져온 시간표로 날짜 범위의 수요를 만든다. 솔버 밖에서 만들어 화면과 솔버가 같은 수요를 보게 한다.

**① 수업 지원 수요** — 학생 s, 날짜 d, 교시 p마다
1. 과목 = `class_lesson(class(s), d, p)`. 없으면(휴일, 시간표 없는 반) 건너뜀.
2. 배치 = `placement_override(s, d, p)` → 없으면 `student_placement(s, 과목)` → 없으면 `homeroom`.
3. 장소 = 특수학급이면 `placement_override`의 장소 → 없으면 **그 요일·시각에 그 과목을 하는 특수학급**(D25, `special_class_lesson`이 그 교시와 겹치고 과목이 같은 것). 하나가 아니면(없거나 둘 이상) 장소 미정으로 `DemandSet.unplaced`에 남기고 그 칸은 수요·이동을 만들지 않는다. 원반이면 `subject_location(과목)` → 없으면 반 교실. (`relocate_class`가 있으면 그 장소). 첫 개발 단계에서는 `subject_location`을 비워 두어 특별실 과목도 반 교실이다.
4. 배치가 `homeroom`이고 과목이 `student_subject_support`에 있으면, 구간 3개를 수요로 만든다.

| 구간 | 칸 | 우선순위 |
|---|---|---|
| 시작 | 교시 시작 + 0~10분 | `need_start`면 HIGH, 아니면 LOW |
| 중간 | + 10~30분 | `need_mid`면 HIGH, 아니면 LOW |
| 종료 | + 30~40분 | `need_end`면 HIGH, 아니면 LOW |

특수학급 수업 시간의 지원은 특수교사 책임으로 보고 과목 지원 수요를 만들지 않는다. 필요하면 ⑥에서 `support_requirement`로 따로 넣는다.

**② 이동 묶음 수요** (D12) — 날짜 d, 연속한 두 교시 p, p+1 사이 쉬는 시간마다
1. 학생 s의 장소가 p와 p+1에서 다르면 s는 그 쉬는 시간에 이동한다. **층이 같아도 장소가 다르면 이동 지원이다**(2026-10-22 확정, 예: 2층 교실 → 2층 도서실은 `2-2` 묶음). 출발 층 = floor(p 장소), 도착 층 = floor(p+1 장소). 건물 밖은 층 `OUT`.
2. 같은 (날짜, 쉬는 시간, 출발 층, 도착 층)의 학생을 하나의 `move_group`으로 묶는다. 도착 장소가 달라도 도착 층이 같으면 같은 묶음, 인원 제한 없음.
3. 묶음 하나는 지원인력 **1명**이 쉬는 시간 전체(10분)를 맡는 수요다. 학생 단위로 쪼개지 않으므로 같은 묶음이 갈라질 수 없다.
4. 이동 지원 대상 학생: ④에 등록된 학생 전원으로 가정한다(§15-8에서 확정 필요).

점심·등교·하교 이동은 업무(`duty`)로 다룬다(예: 급식 지도, 하교 동행).

**③ 추가 수요**: `support_requirement`(날짜, 구간, 인원). 우선순위 HIGH.

**오늘 변경 (D24)**: 변경 명령이 가리키는 날짜가 오늘이면, 요청 시각 `now`(10분 올림) **이후에 시작하는 칸**(수업 지원, 이동 묶음, 추가 수요)에만 적용한다. 이미 시작한 칸은 진행 중이어도 그대로 둔다.
- 예: 10:15에 "학생3 오늘 결석" → `now` = 10:20. 1교시, 1교시 뒤 쉬는 시간 이동, 2교시(09:50 시작, 진행 중)는 그대로. 2교시 뒤 쉬는 시간(10:30) 이동부터 학생3이 빠진다.
- 하루 전체 추가 지원(`set_support`)은 `now`부터 하교 끝까지.
- 다른 날짜의 변경, 과거 날짜를 가리킨 변경은 자르지 않는다(과거 날짜는 해석 단계에서 교사에게 확인).
- 배치 엔진의 지난 칸 고정(§8.2-7)과 같은 기준이라, 고정된 배정이 사라진 수요를 가리키는 일이 없다.

**④ 업무 수요**: `duty`(요일, 구간, 장소, 인원, 동행 학생)를 날짜 범위에 펼친 것. 우선순위 HIGH.

### 8.2 변수와 하드 제약

**변수**: `x[a, r] ∈ {0,1}` — 지원인력 a가 수요 r(수업 구간, 이동 묶음, 추가 수요, 업무)을 맡음. 수요마다 부족분 변수 `short[r] ≥ 0`.

1. **수요 충족(완화형)**: `Σ_a x[a,r] + short[r] = headcount(r)`. 부족분은 목적함수에서 벌점으로 최소화한다(§8.3). 그래서 해가 없는 경우가 사라지고, 부족분이 곧 "지원 공백"이 된다.
2. **한 시점에 한 곳**: 지원인력 a는 같은 10분 칸에 겹치는 수요를 하나만 맡는다. 이동 묶음은 묶음 전체가 하나의 수요이므로 여러 학생을 함께 이동시켜도 위반이 아니다.
3. **근무 가능**: `staff_availability` 밖이거나 `staff_absence` 안인 칸은 배정 불가.
4. **고정**: `pinned` 배정은 그대로 둔다.
6. **두 번째 이동 (D22)**: 쉬는 시간 b에 배정되지 못한 이동 묶음은 `[b.end, b.end+10)`(다음 교시 첫 10분)으로 옮겨 다시 배정할 수 있다. 더 늦게는 옮기지 않는다.
   - 어떤 묶음을 두 번째로 보낼지: 늦게 도착 비용이 낮은 묶음부터. 학생별 비용 0 = 다음 수업이 원반이고 시작 구간 체크 안 됨(또는 지원 없는 과목), 1 = 특수학급 수업, 2 = 시작 구간 체크됨. 묶음 비용 = 학생 비용의 최댓값.
   - 누가 데려갈지: 그 10분이 비어 있는 사람 → 다음 수업 시작 구간이 체크 안 된 학생을 맡은 사람(그 10분 비움) → 체크된 구간을 맡은 사람(마지막 수단, 그 10분은 지원 공백). 쉬는 시간에 이미 한 묶음을 데려간 사람을 우선한다.
7. **지난 칸 고정 (D24)**: `ProposeInput.now`가 있으면, 그 날짜에 `now` 이전에 시작한 이전 배정은 진행 중이어도 그대로 둔다(pinned처럼). 수요 생성의 오늘 변경 규칙(§8.1)과 같은 기준이다. 이미 지난 칸이 바뀌거나 그 칸으로 알림이 가지 않게 하기 위해서다. 검증은 이런 칸이 바뀌면 `BEFORE_NOW_CHANGED`를 낸다.
5. **층 간 연속 배정**: **미정**(§15-7). 정해질 때까지 제약을 두지 않는다. 솔버에 `floor_transition` 제약 자리만 만들어 두고, 규칙이 정해지면 그 자리에 넣는다.

### 8.3 목적함수 (단계별 최소화)

가중치를 합쳐 한 번에 풀지 않고, 위 단계를 먼저 풀어 그 값을 고정한 뒤 다음 단계를 푼다(사전식). 결과를 "왜 이렇게 됐는지" 설명하기 쉽다.

| 단계 | 최소화 대상 | 의미 |
|---|---|---|
| 1 | 이동 묶음 부족분 | 이동 지원이 가장 먼저 |
| 2 | HIGH 수요 부족분(분) | 체크된 구간, 추가 수요, 업무 |
| 3 | LOW 수요 부족분(분) | 체크 안 된 구간. 수업 중엔 다 돕는 게 원칙이므로 여유가 있으면 채움 |
| 4 | 이전 배정 대비 바뀐 칸 수 | 재최적화(`/reoptimize`)에서만 |
| 5 | 한 교시 안에서 담당이 바뀐 횟수 + 동행 업무를 직전 담당자가 맡지 않은 수 | 수업 중간에 사람이 바뀌지 않게 |

- 단계 1~3의 결과: 쉬는 시간 이동이 몰리면, 지원인력은 앞 수업의 **체크 안 된 종료 구간**을 비우고 이동 묶음으로 가거나, 다음 수업의 **체크 안 된 시작 구간**에 늦게 들어간다(D13). 체크된 구간을 비우는 것은 마지막 수단이고, 그러면 W2·W4에 지원 공백으로 보인다.
- **업무강도 균형, 매칭 분산(D17)**: 지금은 목적함수에 넣지 않는다. 대신 풀이 결과로 **지표만** 계산해 돌려준다. 알고리즘이 정해지면 6단계 이후에 넣는다.
  - `staff_minutes[a]`: 지원인력별 주간 지원 시간(수업 구간 + 이동 묶음 + 업무). W2b에 막대로 표시.
  - `pair_share[a, s]`: 학생 s의 주간 지원 시간 중 지원인력 a가 맡은 비율. 한 사람에게 몰리면 W4에 경고.

### 8.4 결과와 지원 공백

부족분이 있으면 해와 함께 돌려준다. 교사는 W4에서 빨간 빗금으로 보고, 손으로 채우거나 그대로 승인할 수 있다.

```json
{ "status": "ok",
  "assignments": [ ... ],
  "shortfalls": [
    { "date": "2026-10-16", "start": "10:20", "end": "10:30", "target": { "move_group": "2F→1F" }, "short_by": 1, "priority": "MOVE" },
    { "date": "2026-10-16", "start": "11:20", "end": "11:30", "target": { "student": "S07", "segment": "start" }, "short_by": 1, "priority": "HIGH" }
  ],
  "metrics": { "staff_minutes": { "A01": 1240, "A02": 1180 }, "pair_share": { "A02:S05": 0.7 } } }
```

### 8.5 검증 (`/validate`)

W4에서 끌어 놓을 때마다 호출한다. 하드 제약 위반(겹침, 근무 밖, 고정 해제, 이동 묶음에 2명 이상, 지난 칸 변경)과 부족분을 돌려준다. 이동 묶음 0명은 위반이 아니라 부족분(지원 공백)이다. 배정과 무관한 배치 문제는 API(`schedule.validate`)가 **경고**로 덧붙인다. 엔진 입력에는 특수학급 배치·교사 정보가 없기 때문이다.
- 특수학급에 같은 칸에 학생이 너무 많음
- 특수학급에 그 칸 담당 교사가 없음

이 경고는 배치가 교사 결정이므로 막지는 않는다.

### 8.6 성능 목표

- 규모(1주): 학생 ~40, 수업일 5, 하루 ~39칸, 지원인력 ~8, 업무 ~15
- 수요 수 추정: 수업 구간 ~40명 × 주 25교시 × 3구간 ≈ 3,000 + 이동 묶음 수백 + 업무 ~75. 변수는 지원인력 8명 기준 약 2.5만 개로 CP-SAT가 수 초 안에 푼다. 근무 밖 칸의 변수는 만들지 않아 더 줄어든다.
- 최초 생성(10 수업일) 15초, 재최적화(바뀐 날짜만) 5초 이내. 시간 안에 최적해를 못 찾으면 최선 해를 반환하고 `solver_meta`에 표시한다.
- 문제가 작으므로 동기 HTTP로 처리한다.

### 8.7 변경 설명 (연쇄 변경)

재최적화 결과에는 새 배정과 함께 **무엇이 왜, 어떤 순서로 바뀌었는지**를 돌려준다. 교사는 W5에서 이것을 "연쇄 변경" 목록으로 보고, 항목을 누르면 해당 칸만 강조된다.

```jsonc
"explanation": [
  { "step": 1, "cause": null, "reason": { "code": "REQUESTED", "op_index": 0 },
    "changes": [{ "type": "placement_location", "class_group": "3-2", "date": "2026-10-16", "period": 3, "from": "3-2 교실(2F)", "to": "L07(1F)" }] },
  { "step": 2, "cause": 1, "reason": { "code": "MOVE_SUPPORT_NEEDED" },
    "changes": [{ "type": "move_group_added", "date": "2026-10-16", "start": "10:20", "end": "10:30", "from_floor": 2, "to_floor": 1, "students": ["S05"] },
                { "type": "assignment_added", "staff": "A02", "target": { "move_group": "2F→1F" }, "start": "10:20", "end": "10:30" }] },
  { "step": 3, "cause": 2, "reason": { "code": "EDGE_RELEASED", "params": { "staff": "A02", "student": "S07", "segment": "end" } },
    "changes": [{ "type": "assignment_trimmed", "staff": "A02", "target": { "student": "S07" }, "start": "10:10", "end": "10:20" }] },
  { "step": 4, "cause": 2, "reason": { "code": "OVERLAP", "params": { "staff": "A02" } },
    "changes": [{ "type": "assignment_moved", "target": { "student": "S07" }, "start": "10:30", "end": "11:10", "from_staff": "A02", "to_staff": "A03" }] }
]
```

**이유 코드**

| 코드 | 뜻 |
|---|---|
| `REQUESTED` | 교사 요청(ChangeOps) 그 자체 |
| `TIMETABLE_CHANGED` | 다시 가져온 시간표에서 과목·교시가 바뀜 (§6.5) |
| `MOVE_SUPPORT_NEEDED` | 장소가 바뀌어 이동 묶음이 새로 생기거나 바뀜 |
| `GROUP_MOVE` | 같은 층→같은 층 묶음에 합류해 담당이 묶음 담당자로 바뀜 (D12) |
| `EDGE_RELEASED` | 이동이 몰려 두 번째 이동을 하느라 다음 수업 시작 10분을 비움, 또는 체크 안 된 시작·종료 구간을 비움 (D13, D22) |
| `OVERLAP` | 기존 담당자가 같은 시간에 다른 일을 맡게 됨 |
| `UNAVAILABLE` | 기존 담당자가 부재·근무시간 밖 |
| `CONTINUITY` | 한 교시 안에서 같은 사람이 이어 맡도록 함께 옮김 |
| `GAP` | 다시 배정했지만 맡을 사람이 없어 지원 공백이 됨 |
| `REPLANNED` | 처음부터 다시(B) 정책이라 연쇄 없이 담당이 바뀜. 원인은 그 요청 단계 |
| `BALANCE`, `ROTATION` | 예약. 업무강도·매칭 알고리즘(D17)이 들어오면 사용 |

`TRAVEL_TIME_SHORT`는 없앴다(D11).

**만드는 방법**: 엔진은 최종 해만 주고 인과 순서는 주지 않는다. 그래서 배치 엔진이 풀이 **후에** 이전 배정과 새 배정을 비교해 설명을 재구성한다(`packages/scheduler/explain.ts`, 엔진과 무관).

1. 요청된 변경(ChangeOps)과 그로 인한 수요 변화(이동 묶음 추가·변경 포함)를 1단계로 둔다.
2. 이전 배정 중 새 문제에서 하드 제약을 위반하는 것을 찾는다(겹침, 부재). 위반을 일으킨 변경을 `cause`로 연결한다.
3. 줄어든 배정이 체크 안 된 구간이면 `EDGE_RELEASED`로 분류한다.
4. 위반이 없는데 바뀐 배정은, 같은 교시의 인접 구간이 옮겨졌으면 `CONTINUITY`로 분류한다. 어디에도 해당하지 않으면 테스트에서 실패시킨다(설명 못 하는 변경 금지).
5. `cause`를 따라 너비 우선으로 `step` 번호를 매긴다.

문장("A02가 10:20–10:30 2층→1층 이동을 맡아 S07 2교시 종료 10분을 비웁니다")은 솔버나 LLM이 아니라 `packages/core`가 이유 코드와 파라미터로 만든다. 같은 입력이면 항상 같은 문장이 나온다.

## 9. API

### 9.1 tRPC 프로시저

| 프로시저 | 설명 | 호출자 |
|---|---|---|
| `school.search` / `school.import` | 학교 검색, 학급정보·시간표 가져오기 (어댑터 경유) | 교사 |
| `school.reimportTimetable` | 시간표 다시 가져오기 → 차이 → 재계산 draft (§6.5) | 교사 (나중: 스케줄러) |
| `setup.*` | 마법사 단계별 저장 (일과, 학급·층, 학생·지원 과목, 배치, 업무, 지원인력) | 교사 |
| `setup.previewMoveGroups` | 현재 배치로 생기는 이동 묶음 미리보기 (⑥) | 교사 |
| `import.csv` | CSV 업로드 (실명 검사 포함) | 교사 |
| `schedule.generate` | 수요 생성 → 최초 배정 → draft | 교사 |
| `schedule.validate` | 끌어 놓기 후 위반·부족분·경고 | 교사 |
| `schedule.updateDraft` | draft 배정 수동 수정 (10분 단위) | 교사 |
| `schedule.activate` | draft 승인 → active | 교사 |
| `schedule.rollback` | 과거 버전 복제 → draft | 교사 |
| `change.interpret` | 원문 → 실명 검사 → ChangeOps | 교사 |
| `change.confirm` | 해석 확인 → 재최적화 → proposal | 교사 |
| `proposal.approve` / `reject` | 승인(활성화 + 알림) / 거절 | 교사 |
| `staff.issueInvite` / `revokeDevice` | 초대 코드 발급, 기기 연결 해제 | 교사 |
| `device.redeemInvite` | 초대 코드로 기기 연결 | 지원인력 앱 |
| `notification.ack` | 확인 기록 | 지원인력 (앱 또는 SMS 토큰) |
| `memo.post` / `memo.markRead` | 학생 메모 작성(실명 검사), 읽음 | 교사, 지원인력 |
| `cell.note` / `cell.check` / `cell.uncheck` | 칸 메모(실명 검사), 완료 체크 | 교사, 지원인력 |
| `attendance.set` / `attendance.clear` | 등교 체크, 취소 (결석은 변경 요청 승인으로만) | 지원인력(오늘 맡은 학생만), 교사 |
| `students.*` / `staff.*` | 학생·지원인력 목록·추가·수정·삭제 (④⑧, 실명 검사 포함) | 교사 |
| `view.day` / `view.week` / `view.staffToday` | 화면용 하루·주간·지원인력 오늘 (`DayView`). 서버가 수요·배정·부족분·등교·체크·칸 메모를 조립 | 교사, 지원인력(자기 것만) |

읽기 화면은 `view.*` 프로시저로 서버가 조립한다. 화면 개발을 DB 구조와 떼고, 목데이터(`fixtures/mock/api/`)로 바로 개발하기 위해서다. Supabase 직접 조회(RLS)는 완료 체크·등교의 실시간 구독에만 쓴다. SMS 링크 화면은 서버가 토큰을 검증한 뒤 그 범위만 조회해 렌더링한다.

프로시저별 input·output은 `packages/schema/src/api.ts`(`procedures`)가 원본이고, 모든 프로시저의 예시가 `fixtures/mock/api/`에 있다([contracts.md](contracts.md)).

### 9.2 배치 엔진과 solver

API는 `packages/scheduler`의 `propose()`·`validate()`만 부른다(같은 프로세스). CP-SAT 엔진을 켜면 엔진 어댑터가 `services/solver`를 HTTP로 부른다.

| Method | Path | 입력 | 출력 |
|---|---|---|---|
| POST | `/assign` | 수요 + 지원인력 근무·부재 + 고정 배정 + 이전 배정 + 정책(규칙 조합·우선순위) | 배정 + 부족분 |
| POST | `/validate` | 수요 + 배정 | 위반·부족분·경고 |

- 선택지 여러 개(D23)는 배치 엔진이 정책마다 `/assign`을 불러 만든다. diff·설명·지표는 엔진 밖(`packages/scheduler`)에서 계산한다.
- 엔진 입력은 수요 목록이다(§8.1). 시간표·배치 규칙은 보내지 않는다. 수요 생성 로직이 한 곳(`packages/core`)에만 있게 하기 위해서다.
- API → solver 호출은 공유 비밀로 인증하고, solver는 외부에 공개하지 않는다.
- 문제 정의에는 ID와 코드만 들어간다. 라벨, 지원 방법, 메모, 연락처는 보내지 않는다.

## 10. 권한·보안

### 10.1 인증

- 교사: Supabase Auth 이메일 로그인. `member`로 학교에 연결.
- 지원인력(앱): 초대 코드 → Supabase 익명 로그인 → `staff_device`로 `staff`에 연결. 이름·이메일 없음.
- 지원인력(SMS): 서명된 토큰. Supabase Auth 없음.

### 10.2 RLS

| 대상 | 교사 | 지원인력 (앱) |
|---|---|---|
| 기초정보·가져온 데이터 | 자기 학교 전체 읽기 | 자기 학교의 시간 틀·장소·업무 읽기 |
| 버전·배정 | 자기 학교 전체 읽기 | **자기 배정만** 읽기 |
| `support_note`, `memo` | 자기 학교 전체 읽기 | **활성 버전에서 현재 맡은 학생만** 읽기 (D8) |
| `cell_note`, `cell_check` | 자기 학교 전체 읽기 | **자기가 그 칸을 맡았거나 맡고 있는 경우만** 읽기 |
| `attendance` | 자기 학교 전체 읽기 | **오늘 맡은 학생만** 읽기·체크(API 경유) |
| `staff_contact` | 접근 불가 (서버만) | 접근 불가 |
| 모든 쓰기 | API만 (P7) | API만 |

"현재 맡은 학생"과 "맡은 칸"은 `staff_assignment`(활성 버전) 기준으로 계산하는 DB 함수로 만들고, 정책에서 재사용한다. 이동 묶음을 맡으면 묶음의 학생들을 그 칸에 한해 맡은 것으로 본다.

### 10.3 토큰

- 초대 코드: 일회용, 짧은 만료, DB에는 해시만.
- SMS 링크 토큰: 32바이트 랜덤, 해시만 저장. 범위는 지원인력 1명 × 버전 1개. 다음 버전 활성화 또는 7일 후 만료.
- 교사가 언제든 기기 연결이나 토큰을 폐기할 수 있다.

### 10.4 Claude 호출

- 전송: 실명 검사를 통과한 원문, 사전 계산된 컨텍스트(달력, 시간 틀, 그 주의 반별 과목→교시, 코드·라벨·장소·과목·업무 목록)
- 보내지 않음: 지원 방법, 메모, 칸 메모, 연락처, 이메일
- 프롬프트와 응답 원문은 저장하지 않는다. `parsed_ops`와 `llm_call`의 토큰 수만 저장한다.

### 10.5 고지·계약 준비

- 개인정보 처리방침, 처리위탁 고지(Supabase, Google Cloud, Anthropic, Expo, SMS 발송사)
- 국외 이전 고지 (Anthropic, Expo 등 해외 사업자)
- 파일럿 학교와의 이용 약정에 데이터 삭제 절차 포함

## 11. 운영

| 항목 | MVP 방식 |
|---|---|
| 에러 추적 | Sentry (요청 본문 수집 끄기) |
| 로그 | 구조화 로그, ID·코드만 |
| 지표 | 변경 요청 수, 교사가 해석을 고친 비율, 솔버 소요시간, 지원 공백(분), 알림 확인율·확인까지 걸린 시간, 호출별 토큰 사용량, 시간표 다시 가져오기 차이 칸 수 |
| 백업 | Supabase 일일 백업 |
| 비용 | 상세는 [cost-strategy.md](cost-strategy.md) |
| 앱 배포 | EAS Build. 파일럿은 TestFlight·Play 내부 테스트, JS 수정은 EAS Update |

## 12. 테스트 전략

| 대상 | 방법 |
|---|---|
| 데이터 가져오기·저장소 | `dataset/db/` JSON이 zod 스키마 통과, `JsonRepository`와 `SupabaseRepository`가 같은 계약 테스트 통과. 개발 파일 → 정규화 결과 고정 검증: 2026학년도 39개 반, 시간표 38개 반, 9/1–9/30, 휴일 2일, 1-3 시간표 0건, 6-7은 9/28부터, 빈 행 제거 |
| 수요 생성 | 지원 구간 3개의 시각·우선순위, 특수학급 배치일 때 수업 수요 없음, 이동 묶음(같은 층→같은 층은 하나, 도착 장소만 다른 학생도 하나), 휴일·시간표 없는 반 |
| 배치 엔진 | 엔진(임시 규칙, CP-SAT)마다 같은 테스트: 독립 제약 검사기를 모든 해에 적용, 묶음이 갈라지지 않는지, 이동이 몰릴 때 늦어도 되는 묶음부터 두 번째 이동인지, 체크된 시작 구간은 마지막 수단인지 |
| 연쇄 시나리오 | `fixtures/scenarios/cascade-scenarios.json` 10개를 모든 엔진·정책에 돌려 기대 결과(바뀌는 칸 종류, 연쇄 단계 이유 코드, 공백·늦게 도착 상한) 확인. 기준선 숫자가 나빠지면 CI 실패 |
| 재최적화 | 작은 사례에서 "바뀐 칸 수가 최소인지"를 전수 탐색과 비교 |
| 변경 설명 | 연쇄 사례 테스트 데이터로 `step`·`cause`·이유 코드 고정 검증. 모든 바뀐 배정이 설명에 정확히 한 번 나오는지 확인 |
| ChangeOps 해석 | 요청 문장 50~100개 평가 세트 ([cost-strategy.md](cost-strategy.md) §3). 날짜별 시간표에서 과목→교시 풀이 포함 |
| 실명 검사 | 탐지 세트 / 오탐 금지 세트 (학교명·과목명·장소명은 통과) |
| RLS | 다른 학교 조회 0건, 지원인력이 맡지 않은 학생의 메모·칸 메모 조회 0건, 담당이 바뀐 뒤 이전 담당자 접근 0건 |
| UI | 끌어 놓기는 포인터 이벤트와 [여기로] 경로를 모두 검사 (시안은 가상 DOM으로 검사함) |
| E2E | 학교 선택 → 설정 → 생성 → 끌어 놓기 → 변경 → 승인 → 앱 팝업 → 확인 → 칸 메모 (Playwright + 앱은 수동) |

## 13. 레포 구조

```
ssyung/                        pnpm + Turborepo
├── apps/
│   ├── web/                   Next.js: 교사 웹, SMS 링크 화면, tRPC API
│   └── mobile/                Expo Router: 지원인력·교사 앱
├── services/
│   └── solver/                FastAPI + OR-Tools CP-SAT (assign, validate). 배치 엔진의 한 구현
├── packages/
│   ├── scheduler/             배치 엔진: propose·validate, engines(heuristic·cpsat), rules, policies, diff, explain, metrics
│   ├── schema/                계약: zod 원본 → JSON Schema, Pydantic, Claude tool 스키마 (작성됨, contracts.md)
│   ├── school-data/           학교 데이터 출처 어댑터 (FileSource → NeisSource), 정규화
│   ├── repository/            저장소 (JsonRepository → SupabaseRepository)
│   ├── core/                  수요 생성(지원 구간·이동 묶음), When·날짜 계산, 설명 문장화
│   ├── interpreter/           해석기 (컨텍스트 사전 계산, Haiku → Sonnet)
│   ├── name-guard/            실명 검사
│   ├── notify/                푸시·SMS
│   ├── api-client/            tRPC 클라이언트 + 쿼리 훅 (웹·앱 공용)
│   ├── testing/               가짜 구현
│   └── design-tokens/         색·글꼴 (웹 CSS 변수, RN 테마)
├── dataset/                   개발용 데이터 (README.md 참고)
│   ├── api/서울개포초등학교/  API로 가져올 정보 (NEIS 형식, 읽기 전용)
│   └── db/서울개포초등학교/   DB에 저장될 정보 (층 배치, 학생, 지원인력)
├── fixtures/                  테스트 데이터 (코드만, 일부는 dataset에서 생성)
│   └── scenarios/             배치 엔진 연쇄 시나리오 (cascade-scenarios.json)
├── supabase/                  마이그레이션, RLS, 시드
└── docs/
    └── screens/               화면 시안 (HTML)
```

병렬 개발 시 모듈 경계는 [agent-development.md](agent-development.md)를 따른다.

## 14. 마일스톤

| 주차 | 산출물 | 완료 기준 |
|---|---|---|
| 1 | Wave 0: 모노레포, 계약, DB, 테스트 데이터, 하네스 | agent-development.md §3.5 |
| 2 | `school-data` 파일 어댑터, `repository` JSON 구현, 수요 생성, 실명 검사, 솔버 `/solve`·`/validate`, API | 개발 데이터(학생 3, 지원인력 3)로 수요 생성·배정 테스트 통과, 묶음·구간 제약 테스트 통과 |
| 3–4 | 설정 마법사(①~⑨), 현황판(W2·W2b), 일간 편집(W4 끌어 놓기), 버전·승인. Supabase 저장소·RLS로 전환 | 서울개포초 개발 데이터로 배정 생성 → 수정 → 승인. 저장소를 바꿔도 화면·API 테스트 그대로 통과 |
| 5–6 | 자연어 변경 전체 (해석기, 확인 카드, `/reoptimize`, 연쇄 설명, W5) | 평가 세트 정확도 목표 달성 |
| 7 | 지원인력 앱: 초대 코드, 일정, 변경 팝업·알림함, 칸 메모·완료 체크, 학생 메모, 푸시 | 실제 휴대폰에서 알림 → 확인 → 칸 메모가 교사 화면에 보임 |
| 8 | 교사 앱 보조 기능, SMS 대체, NEIS 어댑터, TestFlight·Play 배포 | 파일럿 학교를 NEIS로 가져오기 성공, 기기 설치 완료 |
| 9 | 현장 파일럿 | 1주간 실제 운영, 지표 수집 |

## 15. 오픈 이슈

1. **버전의 날짜 범위 (제안)**: 버전이 "이번 주 + 다음 주" 배정을 갖고 매주 다음 주를 재최적화하는 방식(§4.5, §6.5)으로 "이번 주만" 변경과 날짜별 시간표를 함께 푼다. 현장에서 주 단위 승인이 번거로운지 확인 필요.
2. **수업 중 1명이 여러 학생 지원**: 이동은 묶음으로 1명이 여러 학생을 맡지만(D12), 같은 교실 수업 중 2명을 1명이 맡는 것은 아직 1:1이다. 허용하면 수업 수요를 묶는 규칙이 필요하다.
3. **45·50분 수업의 구간 나누기**: 지금은 초등 40분(10/20/10)만. 중·고는 중간 구간만 늘릴지(10/25/10, 10/30/10) 정해야 한다.
4. **메모 접근 범위의 경계**: 담당이 끝난 지원인력이 자기가 쓴 메모·칸 메모도 볼 수 없게 할지.
5. **알림톡 전환 시점**: 파일럿 후 SMS 비용 보고 결정.
6. **해석 정확도 목표치**: 파일럿 전 평가 세트 기준으로 정한다.
7. **층 간 연속 배정 (D11·D12, 미정)**: 지원인력이 다른 층의 일을 연달아 맡을 때의 규칙(예: 앞 구간을 비워야 하는지). 정해지면 §8.2-5 `floor_transition`, W4 경고, 이유 코드를 함께 정한다.
8. **이동 지원 대상**: 지금은 ④에 등록된 학생 전원이 이동 지원 대상이라고 가정한다(§8.1). 혼자 이동할 수 있는 학생을 구분할지 정해야 한다.
9. **업무강도·매칭 분산 알고리즘 (D17)**: 지표(`staff_minutes`, `pair_share`)만 계산한다. "계속 맡는다"의 기준(하루 안 연속 교시인지, 매일 같은 사람인지)과 상한, 근무 시간이 다른 사람의 균형 기준(절대 시간 / 근무 시간 대비 비율)을 정해야 한다.
10. **시간표 다시 가져오기 주기**: NEIS 연결 후 자동 주기와, 이미 승인된 이번 주 배정에 시간표 변경이 생겼을 때의 처리.
