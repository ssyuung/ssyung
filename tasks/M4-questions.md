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
- 일과: 저장하지 않고 기본값(초등 40분, 08:40–16:40) 고정.

## Q4. has_timetable은 출처에서
- `JsonRepository`는 생성자에서 `SchoolDataSource`를 받아 `getClassGroups`로 반마다 시간표가 있는지 알아낸다. 그래서 `@ssyung/repository`가 `@ssyung/school-data`에 의존한다(둘 다 M4).

## Q5. 새 코드 번호 (사람 결정, 2026-10-22: 재사용 안 함)
- 지금까지 발급한 가장 큰 번호 + 1, 두 자리(S08). 지운 번호는 다시 쓰지 않는다(S07 삭제 후 추가 → S08).
- 발급 번호는 `학생.json`·`지원인력.json`의 `last_code_no`에 남긴다. 추가·삭제 때 쓴다. 학생 데이터는 지우면 실제로 사라지고, 남는 것은 숫자 하나뿐이다.
- 계약에 없는 필드라 변경 요청을 냈다: `contracts/requests/M4-last-code-no.md`. 그동안은 원본 JSON에서 직접 읽는다.

## Q6. 저장소가 하지 않는 검사
- 길이·형식(zod)만 본다. 학생의 반·특수학급이 층 배치에 있는지, 지원 과목이 그 반 시간표에 있는지(§4.4)는 검사하지 않는다. API(M7)에서 할지 저장소에서 할지 정해야 한다.
