# M8 교사 웹 v1 (현황판·변경 요청·기초정보)

> 상태: 진행
> 브랜치 `<id>/m8-web` · 범위 `apps/web/app/**`(단 `app/api/**`는 M7), `apps/web/components/**`, `apps/web/public/**`, `apps/web/e2e/**`, `apps/web/package.json`, `apps/web/playwright.config.ts`, `packages/api-client/**`, `packages/design-tokens/**` · 공통 규칙 `CLAUDE.md`

## 목표
사람이 브라우저에서 **실제 시스템을 처음 직접 써 보는** 교사 웹 화면을 만든다.
- 서버(M7 tRPC, `apps/web/server`, `app/api/trpc`)는 merge되어 있다. 그 위에 화면만 만든다.
- 데이터는 진짜 수요 생성·배치 엔진 결과다.
- 해석기만 가짜다. 미리 정해 둔 문장만 알아듣는다(`fixtures/change-requests/cases.json`, `fixtures/mock/api/change.interpret.json`).

화면의 기준은 시안 `docs/screens/ssyung-screens.html`(v12.30)이다. 브라우저로 열어 보거나 https://claude.ai/artifact/9haPR9wNoo16VgRMjy977H 를 본다. 시안을 그대로 옮기지 말고, 같은 정보와 같은 표시 규칙으로 React 컴포넌트를 만든다.

### v1 화면

| 화면 | 시안 | 프로시저 | 내용 |
|---|---|---|---|
| 공통 틀 | 상단·왼쪽 메뉴 | `school.get` | 메뉴(현황판, 지원인력 현황, 변경 요청, 기초정보), 날짜 고르기. 데이터가 9월뿐이라 기본 날짜는 `2026-09-18`(URL `?date=`) |
| **학생 현황판** (홈, W2) | W2 | `view.day` | 세로 = 시간(일과 블록), 가로 = 학생(학년별 묶음). 칸 = 과목·장소·담당 지원인력. 쉬는 시간 이동은 `(3-2) → (K1)`과 담당. 지원 공백은 빨간 빗금. 등교 표시, 완료 ✓, 장소 미정, 그날이 오늘이면 "지금" 줄 |
| **지원인력 현황** (W2b) | W2b | `view.day` | 세로 = 시간, 가로 = 지원인력. 수업 지원은 실선 테두리, 이동은 점선. 빈 시간은 흰색 그대로. 위에 지원인력별 하루 지원 시간(`metrics.staff_minutes`) |
| **변경 요청** (W5) | W5, 교사 앱 T3 | `change.interpret` → `change.confirm` → `proposal.approve` | 아래 "변경 요청 흐름" |
| **기초정보: 학생** (W1 ④) | W1-4 | `students.*` | 목록·추가·수정·삭제. 별칭, 소속 반, 특수학급에서 듣는 과목(목록, D25), 지원 과목과 과목별 지원 구간(시작·중간·종료 체크), 지원 방법. 과목 후보는 그 반 시간표의 과목 |
| **기초정보: 지원인력** (W1 ⑧) | W1-8 | `staff.*` | 목록·추가·수정·삭제. 요일별 근무 시간(10분 단위) |
| **기초정보: 학교** | W1 ①③ 일부 | `school.get` | 반·층 배치, 특수학급과 특수학급 시간표(요일 × 교시)를 **보기만**. 편집은 v2 |

### 변경 요청 흐름 (W5)
1. **입력:** 문장을 넣는다. 가짜 해석기가 아는 예시 문장을 버튼으로 둔다(`cases.json` 몇 개 + "지원인력1 10시 30분부터 11시 30분까지 출장").
2. **해석 확인:** `summary` 문장, 지원하지 않는 요청이면 `unsupported` 이유. [확인] / [다시 쓰기]
3. **선택지:** `Proposal.options`를 카드로 보여 준다.
   - 카드 내용: 정책 라벨(합쳐진 정책은 이어서), 바뀌는 칸·지원 공백·늦게 도착·알림 인원
   - 가장 좋은 값을 강조하고 `recommended`를 표시한다.
4. **선택지 하나의 전·후 비교:** 바뀌는 학생·지원인력 열만 전·후로 띄워 놓는다.
   - 없어짐 빨강, 바뀜 노랑, 새로 생김 초록, 공백 빨간 빗금
   - 색만으로 구분하지 말고 글자 표시(없어짐·바뀜·생김)도 붙인다.
5. **연쇄 변경 단계:** `explanation`을 목록으로 보여 준다. 단계를 누르면 그 단계의 칸만 강조한다.
   - 요청 단계는 칸이 없을 수 있다(부재처럼 수요가 안 바뀌는 명령). 그때는 제목만 보인다.
   - 이유 코드마다 사람이 읽는 문장을 둔다(`REQUESTED` "요청 반영", `UNAVAILABLE` "담당자가 그 시간에 없음", `OVERLAP` "겹쳐서 다른 사람으로", `EDGE_RELEASED` "이동이 몰려 두 번째로 데려감", `GAP` "맡을 사람이 없음", `MOVE_SUPPORT_NEEDED` "이동이 바뀜", `REPLANNED` "처음부터 다시 배정" 등).
6. **승인:** `proposal.approve` → 완료 메시지(바뀐 칸 수, 알림 받은 지원인력) → 현황판에 바로 반영.
   - 오류 `BASE_VERSION_CHANGED`면 "다른 변경이 먼저 승인됐어요. 다시 계산할게요"를 보이고 `change.confirm`을 다시 부른다.

### 표시 규칙 (사람이 시안에서 정한 것. 지킨다)
- 화면에는 **코드 대신 별칭**(학생1, 지원인력1)을 보인다. 코드는 작게 보조로만.
- 시간표 배경: **수업 칸 흰색, 쉬는 시간·점심·등하교 회색.** 일이 있어도 배경색을 바꾸지 않는다. 쉬는 시간 칸은 메모를 넣을 수 있게 넓게 둔다(10분이어도 수업 10분보다 크게).
- 칸 안에 **시각을 넣지 않는다.** 시각은 왼쪽 축에만.
- 칸에 **굵은 왼쪽 선 같은 장식을 넣지 않는다.** 얇은 테두리 한 겹까지.
- 과목 이름은 **칸 오른쪽 위, 굵게 하지 않음.** 글씨는 크게(칸 13.5px 이상, 축 11.5px 이상).
- 학생 현황판에서 **지원인력 이름에 배경색을 칠하지 않는다.** 지원인력 현황에서도 사람마다 색을 주지 않는다(열이 곧 사람).
- 특수학급 수업 칸은 다른 색과 겹치지 않는 낮은 채도: K1 `#66788a`, K2 `#8e7f6a` 계열을 옅게(어두운 테마 `#8696a8`, `#a8987f`).
- 완료는 **칸 오른쪽 녹색 ✓ 하나**만. "미확인", "완료 체크 없이 끝난 칸" 같은 안내 문구를 넣지 않는다. 체크 없는 이동을 따로 표시하지 않는다.
- 밝은·어두운 테마 둘 다. 색은 `packages/design-tokens`의 토큰으로만 쓴다.

### 기술
- Next.js App Router(`apps/web/app`). 서버 컴포넌트에서 직접 서버 함수를 부르지 말고 **tRPC 클라이언트로 `/api/trpc`를 부른다.** 화면이 API 계약만 보고 동작하는지 확인하기 위해서다.
- `packages/api-client`(`@ssyung/api-client`): tRPC 클라이언트 + React 훅. 모바일(M9)도 쓴다.
  - 타입은 M7의 `AppRouter`(`apps/web/server/router.ts`)를 `import type`으로만 가져온다.
  - 개발 중 호출자는 헤더 `x-dev-actor: T01`.
- `packages/design-tokens`(`@ssyung/design-tokens`): 색·글꼴·간격 토큰. 시안 `:root` 토큰에서 가져온다.
- 스타일은 CSS(모듈 또는 전역 + 토큰). UI 라이브러리는 쓰지 않는다.
- 추가해도 되는 의존성: `@tanstack/react-query`, `@trpc/tanstack-react-query`, `@playwright/test`(dev). 그 밖은 질문 파일에 먼저 적는다.
- 서버 코드(`apps/web/server/**`, `app/api/**`)는 M7 범위라 고치지 않는다. 서버가 모자라면 `contracts/requests/M8-<주제>.md`.

## 읽을 것
- 시안 `docs/screens/ssyung-screens.html` (W2, W2b, W5, W1-4, W1-8, T3)
- docs/contracts.md, `packages/schema/src/api.ts` (`DayView`, `Proposal`, `ChangeRequest`, `procedures`)
- `fixtures/mock/api/view.day.json`, `change.confirm.json` (응답 모양 예시)
- docs/architecture.md §6 (화면과 흐름), §8.7 (이유 코드)

## 완료 조건 (끝낼 때 자동 실행: typecheck, test, build, e2e)
- [ ] `pnpm --filter @ssyung/web typecheck`, `test`(M7 서버 테스트 포함), `build` 통과
- [ ] `pnpm --filter @ssyung/web e2e` (Playwright, 개발 서버를 스스로 띄움. 시작 전에 저장소 작업 폴더 `.data/`를 지워 매번 같은 데이터로 시작)
  - [ ] 홈 `?date=2026-09-18`: 학생 7명 열, 수요·배정이 `view.day` 응답과 같은 수만큼 칸으로 보인다. 쉬는 시간 이동 칸에 `→`가 있다
  - [ ] 지원인력 현황: 지원인력 3명 열과 하루 지원 시간
  - [ ] 변경 요청: "지원인력1 10시 30분부터 11시 30분까지 출장" → 해석 확인 → 선택지 카드 3개(A 3/0/1, B 11/0/1, C 3/1/0) → A의 전·후 비교에 바뀐 칸 3개 → 단계 누르면 강조 → 승인 → 현황판의 버전이 바뀜
  - [ ] 학생 추가 → 목록에 새 코드로 생김 → 삭제
  - [ ] 어두운 테마에서도 같은 화면이 뜬다(`prefers-color-scheme: dark` 에뮬레이션)
  - [ ] 화면마다 스크린샷을 `apps/web/test-results/`에 남긴다(gitignore, 사람이 본다)
- [ ] 커밋된 `dataset/db/`가 바뀌지 않는다(e2e 뒤 `git status`)

## 범위 밖 (v2 이후)
- 일간 편집(W4, 끌어 옮기기·검증·draft 저장·승인)
- 설정 마법사 전체(W1 ①③의 층 배치 끌어 놓기·특수학급 시간표 편집 — 저장 프로시저가 아직 없음)
- 주간 보기(W3)
- 지원인력·교사 앱(M9)
- 로그인(지금은 개발용 헤더)

## 준비 (사람)
- Playwright 브라우저: 처음 한 번 `pnpm --filter @ssyung/web exec playwright install chromium`. 설치 전이면 시작하지 말고 질문 파일에 적는다.

## 산출물
보드 `tasks/board/M8.md` 갱신(완료 조건 체크, 다음에 할 것, 다른 모듈에 필요한 것). 변경 요약, 화면별 스크린샷 경로, 남은 질문(`tasks/M8-questions.md`).
