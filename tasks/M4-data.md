# M4 학교 데이터·저장소 v1

> 상태: 진행
> 브랜치 `<id>/m4-data` · 범위 `packages/school-data/**`, `packages/repository/**` · 공통 규칙 `CLAUDE.md`

## 목표
docs/architecture.md §4.6의 두 인터페이스를 파일 구현으로 만든다.

1. `@ssyung/school-data`: `SchoolDataSource`와 `FileSource`.
   - `dataset/api/<학교>/`의 NEIS 응답을 정규화해 `ClassGroup[]`와 `Timetable`을 만든다.
   - 정규화: 첫 행 건너뜀, 2026학년도, 빈 과목 행 버림, 기간 지정(개발은 9월).
2. `@ssyung/repository`: `Repository` 인터페이스와 `JsonRepository`.
   - `dataset/db/<학교>/` 파일을 읽어 `SchoolBundle`(일과는 기본값), `Student[]`, `Staff[]`를 돌려준다.
   - 추가·수정·삭제는 같은 파일 형식으로 쓴다. 테스트는 임시 디렉터리 복사본에만 쓴다.
   - 새 코드 번호 규칙: S08처럼 다음 번호.

## 읽을 것
- docs/architecture.md §4.2–4.4, §4.6
- dataset/README.md
- `packages/schema/src/dataset.ts`, `domain.ts`
- `scripts/mock/build-mocks.ts`: 목데이터를 만든 정규화. 같은 결과가 나와야 한다.

## 완료 조건
- [ ] `pnpm --filter @ssyung/school-data --filter @ssyung/repository typecheck`, `test` 통과
- [ ] 목데이터 대조, 값까지 같아야 한다:
  - [ ] `FileSource` 9월 → `fixtures/mock/domain/timetable-2026-09.json`
  - [ ] `FileSource` 학급 → `school.json`의 class_groups (1-3은 `has_timetable: false`)
  - [ ] `JsonRepository` → `fixtures/mock/domain/school.json`, `students.json`, `staff.json`
- [ ] 저장소 계약 테스트(`test/contract.ts`)를 구현과 떼어 둔다.
  - 나중에 `SupabaseRepository`가 같은 테스트를 돌린다.
  - 다룰 것: 추가 → 목록 → 수정 → 삭제, 없는 코드는 NOT_FOUND, 라벨 20자 초과는 거부.
- [ ] 모든 출력이 zod 스키마(`@ssyung/schema`)를 통과한다.

## 범위 밖
- NEIS API 호출(`NeisSource`)은 인터페이스 자리만 둔다.
- Supabase 구현, 버전·배정 저장(Wave 2), 실명 검사(M5. 저장소는 길이만 본다)

## 산출물
보드 `tasks/board/M4.md` 갱신(완료 조건 체크, 다음에 할 것, 다른 모듈에 필요한 것). 변경 요약, 목데이터 대조 결과, 남은 질문(`tasks/M4-questions.md`).
