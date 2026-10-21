# 업무 리스트

> 사람(통합 담당)이 보는 목록이다. 모듈 에이전트는 이 파일을 고치지 않는다(훅이 막음).
> 모듈별 진행·제안은 각 모듈 보드(`tasks/board/<ID>.md`, 그 모듈 에이전트가 갱신)에 있다. `pnpm board`(요약)·`pnpm board --all`(제안·요청까지)로 모든 워크트리의 보드를 모아 본다. 보드의 "다음에 할 것"을 여기 로드맵으로 옮기면 다음 버전 후보가 된다.
> 갱신: 2026-10-22 · 모듈 연결도: https://claude.ai/artifact/Di63u5H8eM4dCCpxF7JfKg

## 1. 지금 할 일

### 결정
- [ ] **학생·지원인력 이름을 서비스에 저장할지**
  - 저장하지 않음: M5 시작.
  - 저장함: M5와 architecture.md §5, API의 `NAME_SUSPECTED`를 지우고 이름 필드를 추가.

### M1이 올린 계약 변경 요청 (`m1-scheduler/contracts/requests/`)
처리하는 곳: architecture 워크트리(M0). Claude에게 "M1 요청 처리해"라고 하면 반영 → 목데이터 다시 생성 → main merge까지 한다.

| 요청 | 내용 | 추천 |
|---|---|---|
| `M1-replanned-reason` | 이유 코드 `REPLANNED` 추가 (처음부터 다시 정책에서 연쇄 없이 바뀐 칸) | 받음. 목데이터가 이 칸들을 `OVERLAP`으로 잘못 분류하고 있음 |
| `M1-move-group-empty` | 이동 묶음 0명은 위반이 아니라 지원 공백 | 받음. 목데이터 생성기도 이미 그렇게 동작 |
| `M1-validate-warnings` | 특수학급 경고는 엔진 밖(API)에서 계산 | 받음. 하위 호환이 깨지므로 M7 지시서에 반영 |
| `M1-scenario-inputs` | 시나리오 입력을 `fixtures/scenarios/inputs/`에 고정 | 받음. M2가 같은 입력을 써야 함 |

### M1 질문 중 사람이 확인할 것 (`m1-scheduler/tasks/M1-questions.md`)
- [ ] 5번: 요청 명령마다 1단계(`REQUESTED`)를 하나씩 둠. 부재처럼 칸이 안 바뀌는 명령은 단계에 칸이 없음 → W5 화면에서 괜찮은지
- [ ] 7번: 같은 시각 수업의 배정 순서가 시안과 달라 "처음부터 다시"의 바뀐 칸이 기준선보다 1–2개 많음 (공백·늦게 도착은 같음) → 받아들일지

### 세션
- [x] 워크트리 준비: m1-scheduler, m3-demand, m4-data
- [ ] M3, M4 세션 시작 (`tasks/M3-demand.md를 읽고 수행해`)
- [ ] M1 v1 PR 검토 → merge
- [ ] 1차(M1·M3·M4) PR 몇 개 merge 뒤: m6-interpreter, m7-api 워크트리 만들고 init

## 2. 반복 업무

| 언제 | 할 일 |
|---|---|
| 매일 | `pnpm board --all`로 진행·제안·요청 보기, 각 워크트리의 `tasks/<ID>-questions.md` 답하기, `contracts/requests/` 처리(M0) |
| 버전이 끝나면 | 그 모듈 보드의 "다음에 할 것" 중 할 것을 §3 로드맵으로 옮기고 다음 버전 지시서를 쓴다 |
| PR이 오면 | CI 결과, 시나리오 비교표, 범위 밖 변경, 기준선·목데이터 변경 여부 확인 → merge |
| merge 뒤 | 진행 중인 다른 워크트리는 main으로 rebase (사람이 직접) |
| 계약이 바뀌면 | `CONTRACT_VERSION` 확인, 영향받는 모듈 지시서에 반영 작업 추가 |

## 3. 모듈별 버전 로드맵

한 모듈을 여러 번 발전시킨다. 버전 하나 = 지시서 하나 = PR 하나. 다음 버전을 시작하는 방법은 §4.

### M1 배치 엔진
| 버전 | 내용 | 시작 조건 | 상태 |
|---|---|---|---|
| v1 | 임시 규칙 엔진, propose·validate, 정책 3개, diff·설명·지표, 시나리오 3개(S2·S3·S7) | — | 진행 (`tasks/M1-scheduler.md`) |
| v2 | 시나리오 10개 전부 켜기, 계약 요청 4건 반영(REPLANNED, warnings 이동, 시나리오 입력 파일), 목데이터 생성기를 이 패키지로 교체 | M3 merge, 요청 4건 처리 | 대기 |
| v3 | 엔진 교체 구조: 정책마다 heuristic·cpsat 선택, 두 엔진 비교표 | M2 v1 merge | 대기 |
| v4 | 무작위 시험(9월 20일 × 결석·부재·배치 변경 수백 번), 성능 목표(10일 15초) | v2 | 대기 |
| 이후 | 업무강도 균형(`BALANCE`)·매칭 분산(`ROTATION`) | 결정 §5-3 | 결정 필요 |
| 이후 | 층 간 연속 배정 규칙 (`floor_transition`) | 결정 §5-4 | 결정 필요 |
| 이후 | 수업 중 1명이 여러 학생 지원 | 결정 §5-5 | 결정 필요 |
| 상시 | 현장에서 나온 문제 → 시나리오 추가(M0) → 규칙 추가 → 두 엔진 통과 → 기준선 갱신(사람 승인) | 파일럿 | — |

### M3 수요 생성
| 버전 | 내용 | 시작 조건 | 상태 |
|---|---|---|---|
| v1 | 수업 지원·이동 묶음 수요, ChangeOps 반영 | — | 준비됨 (`tasks/M3-demand.md`) |
| v2 | 업무(duty) 펼치기, 추가 수요, 45·50분 수업 구간 | 업무 데이터, 결정 §5-6 | 대기 |

### M4 학교 데이터·저장소
| 버전 | 내용 | 시작 조건 | 상태 |
|---|---|---|---|
| v1 | FileSource, JsonRepository, 저장소 계약 테스트 | — | 준비됨 (`tasks/M4-data.md`) |
| v2 | 버전·배정·메모·체크 저장 | M7 v1 | 대기 |
| v3 | SupabaseRepository (같은 계약 테스트), NeisSource | Wave 2 | 대기 |

### 그 밖
| 모듈 | 다음 | 시작 조건 |
|---|---|---|
| M2 CP-SAT | v1 지시서 작성 (Claude에게 요청) | M1 v1·M3 v1 merge |
| M5 실명 검사 | v1 (`tasks/M5-name-guard.md`, 보류) | §1 결정 |
| M6 해석기 | v1 (`tasks/M6-interpreter.md`), eval은 사람이 API 키로 실행 | 1차 merge 뒤 |
| M7 API | v1 (`tasks/M7-api.md`) → v2 실제 모듈 연결 | 1차 merge 뒤 |
| M8·M9 화면 | v1 지시서 작성 | M7 v1 (`dev:mock`) |
| M10·M11 | v1 지시서 작성 | Wave 2 |

## 4. 다음 버전을 시작하는 방법 (예: M1 v2)

1. **지시서 작성**: architecture 워크트리에서 Claude에게 "M1 v2 지시서 써줘"라고 하면 `tasks/M1-scheduler-v2.md`가 생긴다.
   - 맨 위에 `> 상태: 진행`을 둔다.
   - 끝난 v1 지시서는 `> 상태: 완료`로 바꾼다.
   - main에 merge한다.
2. **브랜치**: 같은 워크트리를 그대로 쓰고, 브랜치만 새로 만든다. `.agent-scope`와 `node_modules`는 그대로 남는다.
   ```bash
   cd ~/orca/workspaces/ssyung/m1-scheduler
   git fetch origin && git switch -c 2khs21/m1-scheduler-v2 origin/main
   ```
   - 브랜치 이름 끝의 `-v2`는 CI가 M1로 알아본다.
3. **세션**: Claude Code를 새로 연다.
   - 세션 시작 훅이 `상태: 진행`인 지시서를 찾아 알려준다.
   - 첫 지시는 "진행 중인 지시서를 읽고 수행해".

## 5. 결정 대기 (architecture.md §15)

| # | 결정 | 막혀 있는 것 |
|---|---|---|
| 1 | 이름 저장 여부 | M5, 스키마 이름 필드 |
| 2 | 버전 날짜 범위(이번 주 + 다음 주, 매주 재최적화) | M7 v2, M1 여러 날 재최적화 |
| 3 | 업무강도·매칭 분산 기준(연속의 정의, 상한, 근무 시간이 다른 사람의 균형) | M1 BALANCE·ROTATION |
| 4 | 층 간 연속 배정 규칙 | M1 floor_transition, W4 경고 |
| 5 | 수업 중 1명이 여러 학생 지원 허용 | M1, M3 수업 수요 묶기 |
| 6 | 45·50분 수업 구간 나누기 | M3 v2 (중·고 확장 때) |
| 7 | 이동 지원 대상(혼자 이동 가능한 학생 구분) | M3, 학생 설정 화면 |
| 8 | 해석 정확도 목표치 | M6 완료 기준 |
| 9 | 메모 접근 범위, 알림톡 전환, 시간표 다시 가져오기 주기 | M7·M10 v2 |
