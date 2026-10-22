# M4 질문

## Q1. NEIS 정규화 보류 (사람 결정, 2026-10-22)
- 결정: NEIS 형식 처리 자체를 보류(B안). `FileSource`(dataset/api/ 정규화) 대신 `MockSource`가 `fixtures/mock/domain/`을 그대로 돌려준다.
- 영향: 지시서 완료 조건 "FileSource 9월 → timetable-2026-09.json"은 `MockSource`로 대조했다(같은 파일이라 자명). 정규화 고정 검증은 남은 일.
- 나중에: `FileSource` 또는 `NeisSource`를 붙이면 `test/mock-source.test.ts`의 대조 테스트를 그대로 돌리면 된다.

## Q2. SchoolDataSource 메서드 모양
- architecture.md §4.6은 `getClassInfo → ClassInfo[]`, `getTimetable → LessonRow[]`(NEIS 행)이고, 지시서는 `ClassGroup[]`·`Timetable`을 돌려주라고 한다.
- 진행: 지시서를 따라 `getClassGroups(school, year): ClassGroup[]`, `getTimetable(school, from, to): Timetable`. 날짜는 `IsoDate` 문자열(양 끝 포함). `SchoolRef`는 `school.search` 출력 한 줄.
- 목데이터 밖 기간은 `NOT_IMPLEMENTED`로 거부한다(빈 시간표를 주면 "수업 없음"으로 오해할 수 있어서).

## Q3. 목데이터 생성기에서 가져온 임시 규칙
`school.json`과 값을 맞추려고 `build-mocks.ts`의 규칙을 그대로 옮겼다. 계약에 없는 규칙이라 확인이 필요하다.
- `School.id`: 파일에 없어 생성자 옵션 `schoolId`로 받는다(테스트는 `sch_gaepo`).
- 장소 종류: `층배치.json`에 종류가 없어 이름이 교무실·행정실·보건실·급식실이면 `office`, `outdoor`면 `outdoor`, 나머지는 `special_room`.
- 특수학급 교사: 교사 저장이 없어 특수학급 순서대로 `T01`, `T02`.
- 일과: 저장하지 않고 기본값 고정. 0.2.0부터 `@ssyung/schema`의 `DEFAULT_BELL`을 쓴다.

## Q4. has_timetable은 출처에서
- `JsonRepository`는 생성자에서 `SchoolDataSource`를 받아 `getClassGroups`로 반마다 시간표가 있는지 알아낸다. 그래서 `@ssyung/repository`가 `@ssyung/school-data`에 의존한다(둘 다 M4).

## Q5. 새 코드 번호 (사람 결정, 2026-10-22: 재사용 안 함)
- 지금까지 발급한 가장 큰 번호 + 1, 두 자리(S08). 지운 번호는 다시 쓰지 않는다(S07 삭제 후 추가 → S08).
- 발급 번호는 `학생.json`·`지원인력.json`의 `last_code_no`에 남긴다. 추가·삭제 때 쓴다. 학생 데이터는 지우면 실제로 사라지고, 남는 것은 숫자 하나뿐이다.
- 계약 0.2.0에 들어갔다(`contracts/requests/M4-last-code-no.md`). 지금은 `StudentsFile`·`StaffFile` 파싱으로 읽는다.

## Q6. 저장소가 하지 않는 검사
- 길이·형식(zod)만 본다. 학생의 반·특수학급이 층 배치에 있는지, 지원 과목이 그 반 시간표에 있는지(§4.4)는 검사하지 않는다. API(M7)에서 할지 저장소에서 할지 정해야 한다.

## M0 답 (2026-10-22) — 계약 0.2.0·0.3.0, PR #1 merge 전에 반영
**main을 이 브랜치에 합친 뒤** 작업한다(합치기는 사람이 한다).
- `M4-last-code-no` 받음(0.2.0): `StudentsFile`·`StaffFile`에 `last_code_no` 선택 필드. 원본 JSON에서 직접 읽던 우회를 스키마 파싱으로 바꾼다.
- **0.3.0 특수학급 시간표 (D25, 하위 호환 아님)**: 소속 특수학급 없음.
  - `학생.json`: `special_class` 필드가 없어지고, `special_class_subjects`는 과목 목록(`["국어","수학"]`)이다. `Student`도 같다.
  - 새 파일 `dataset/db/서울개포초등학교/특수학급시간표.json`(`SpecialClassTimetableFile`, 요일·`HH:MM`) → `SchoolBundle.special_classes[].lessons`(요일·분). 변환은 `@ssyung/schema`의 `hhmmToMinute`.
  - 저장소 계약 테스트에 특수학급 시간표 읽기를 넣는다. 쓰기(③ 화면 저장)는 `setup.saveLayout`처럼 같은 파일 형식으로 하되, 프로시저가 아직 없으니 이번에는 읽기만 해도 된다(필요하면 `contracts/requests/`에 프로시저 요청).
- 목데이터 `domain/school.json`·`students.json`이 0.3.0 형식으로 바뀌었다. 대조 테스트를 다시 통과시킨다.
- 같은 PR에서 리뷰 반영(선택, v1.5로 미뤄도 됨): `bell.ts` 대신 `DEFAULT_BELL`, `Schema<T>` 대신 `z.ZodType`, `MockSource` 학교 목록을 `domain/school.json`에서.

### M4 반영 (2026-10-22)
- `last_code_no`: 원본 JSON 우회를 없애고 `StudentsFile`·`StaffFile` 파싱으로 읽고 쓴다.
- 0.3.0: 학생에 `special_class` 없음, `special_class_subjects`는 과목 목록. `특수학급시간표.json`을 읽어 `special_classes[].lessons`(요일·분, `hhmmToMinute`)로 낸다. 층 배치에 있는 특수학급만 내고, 시간표 파일에 없는 특수학급은 수업 0건.
- 저장소 계약 테스트에 "특수학급 시간표: 요일·분으로 읽는다"를 넣었다. 쓰기는 이번에 하지 않았다(프로시저가 없어 요청도 아직 안 냄. 보드 제안에 적음).
- 목데이터 대조: 0.3.0 `school.json`·`students.json`·`staff.json`과 값까지 같다.
- 리뷰 반영 3건 모두 했다: `bell.ts` 삭제 → `DEFAULT_BELL`, `Schema<T>` → `z.ZodType`(repository에 `zod` 의존 추가), `MockSource` 학교 목록은 `domain/school.json`에서. 주소는 계약에 없어 `school.search` 예시에서 찾고 없으면 빈 값.
