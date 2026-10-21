# M7 API v1 (계약 라우터 + 목데이터 구현)

> 상태: 진행
> 브랜치 `<id>/m7-api` · 범위 `apps/web/server/**`, `apps/web` 설정 파일, `supabase/` (0001 제외) · 공통 규칙 `CLAUDE.md`

## 목표
`apps/web`(`@ssyung/web`)에 tRPC 서버를 만든다.

- 프로시저는 계약 `packages/schema/src/api.ts`의 `procedures` 36개 전부.
- input·output 검증은 계약의 zod를 그대로 쓴다.
- Wave 1 구현은 **목데이터 기반**이다.
  - 다른 모듈(M1·M3·M4·M6)이 아직 없으므로 `fixtures/mock/`을 읽는 메모리 저장소로 응답한다.
  - 쓰기 프로시저는 메모리에만 반영한다.
- 구현을 갈아끼울 자리를 둔다: `server/deps.ts`에 `repository`, `scheduler`, `interpreter`, `nameGuard`, `notifier` 인터페이스. Wave 2에서 실제 모듈로 바꾼다.
- `pnpm --filter @ssyung/web dev:mock`: M8·M9가 붙을 수 있는 목 서버.
- Next.js 앱 뼈대(`apps/web/package.json`, 설정)는 M7이 만든다. 화면 파일(`app/`, `components/`)은 M8 범위라 만들지 않는다. 빈 `app/page.tsx`가 필요하면 질문 파일에 적는다.

## 읽을 것
- docs/architecture.md §9, §10
- docs/contracts.md
- `fixtures/mock/api/*.json` (프로시저별 예시)

## 완료 조건
- [ ] `pnpm --filter @ssyung/web typecheck`, `test` 통과
- [ ] 계약 테스트: `fixtures/mock/api/*.json`의 모든 예시 input으로 호출한다.
  - `output` 예시는 output이 계약 스키마를 통과한다. 값은 달라도 된다.
  - `error` 예시는 같은 `code`의 오류가 난다.
- [ ] 계약의 프로시저 목록과 라우터 목록이 정확히 같다(테스트로 확인).
- [ ] 권한: 지원인력 호출자는 `view.staffToday`·`attendance.*`·`cell.*`·`memo.*`·`notification.ack`만, 자기 배정 학생만. 테스트 포함.
- [ ] `change.interpret`은 실명 의심이면 `NAME_SUSPECTED`. 지금은 가짜 검사기(항상 통과, 목데이터 예시 문장만 거부)를 쓰고, M5 merge 후 교체한다.

## 범위 밖
- 화면(M8·M9)
- Supabase 연결과 RLS(Wave 2, 마이그레이션 초안까지는 해도 됨)
- 실제 배치·해석·알림 모듈 연결(Wave 2)

## 산출물
보드 `tasks/board/M7.md` 갱신(완료 조건 체크, 다음에 할 것, 다른 모듈에 필요한 것). 변경 요약, 프로시저별 구현 상태 표, 남은 질문(`tasks/M7-questions.md`).
