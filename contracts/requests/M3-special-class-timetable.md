# 계약 변경 요청: 특수학급 시간표로 특수반 장소 정하기

- 요청 모듈: M3
- 날짜: 2026-10-22
- 바꿀 것: `packages/schema/src/domain.ts`의 `SpecialClass`(시간표 추가), `change-ops.ts`의 `SetPlacement.location` 설명, `fixtures/mock/domain/*`
- 하위 호환: 예(필드 추가). 단 `SetPlacement.location` 설명의 의미가 바뀜

## 이유
지금 계약은 장소가 없으면 "소속 특수학급"으로 보낸다. 사람(제품 담당) 확인 결과 **소속 특수학급 개념은 없고, 특수반 장소는 그 시간의 과목으로 정해진다.**
특수학급마다 시간표가 있고, 학생은 그 시간 자기 과목을 하는 특수학급으로 모인다.

> 월요일 2교시에 특수1반(K1)이 수학이면, 그 시간 수학을 특수학급에서 듣는 학생은 K1로 간다.

지금 데이터에는 특수학급 시간표가 없다. 그래서 학생별 `special_class_subjects`(과목 → 장소)가 그 역할을 대신한다.

## 제안
```ts
// domain.ts
export const SpecialClassLesson = z.object({
  special_class: SpecialClassCode,
  day: Day,                       // 또는 date (원반처럼 날짜별이면)
  period: z.number().int().min(1).max(8),
  subject: Subject,
});
export const SpecialClass = z.object({
  code: SpecialClassCode,
  location: LocationRef,
  teachers: z.array(TeacherCode),
  lessons: z.array(SpecialClassLesson).describe("특수학급 시간표. 그 시간 이 과목 학생이 여기로 모인다"),
});

// change-ops.ts
location: LocationRef.optional().describe("special_class일 때 수업 장소. 없으면 그 시간 그 과목을 하는 특수학급"),
```
장소 정하기: 그 시간 원반 과목 → 그 시간 그 과목을 하는 특수학급 → 그 교실. 없거나 둘 이상이면 교사가 장소를 지정해야 한다.

## 확인할 것
- 특수학급 시간표는 요일 기준인지 날짜 기준인지.
- 학생별 `special_class_subjects.location`을 없애고 시간표로만 정할지, 학생별 규칙을 남길지.
- `Student.special_class`(소속 특수학급) 필드를 없앨지.

## 영향받는 모듈
- M4: 특수학급 시간표 입력·저장(dataset/db).
- M3: 장소를 특수학급 시간표에서 찾도록.
- M6: 장소 없는 set_placement를 그대로 둬도 됨(해석기가 장소를 추측할 필요 없음).
- M8: 특수학급 시간표 입력 화면.

## 그동안의 우회
M3는 장소가 없으면 그 학생의 그 과목 `special_class_subjects.location`을 쓰고, 그것도 없으면 장소를 지정하라는 오류를 낸다. 소속 특수학급(`Student.special_class`)은 쓰지 않는다.
