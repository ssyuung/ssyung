# 계약 변경 요청: 학생 칸의 배치·장소 함수 export (M3)

- 요청 모듈: M7
- 날짜: 2026-10-22
- 바꿀 것: `packages/core/src/demand/index.ts`의 칸 계산(`slotAt`, `specialRoom`)을 함수로 꺼내 export
- 하위 호환: 예(export 추가)

## 이유
화면의 학생 행(`StudentDayRow.lessons[].placement`, `.location`)과 수요(수업 지원·이동 묶음)는 **같은 정보**여야 한다(사람 결정 2026-10-22: 하나의 정보를 고치면 둘 다 바뀐다).
지금 이 규칙은 `generateDemands` 안의 지역 함수라 API가 쓸 수 없어, M7이 같은 규칙을 한 벌 더 갖고 있다:
- 배치 = set_placement → 특수학급 과목 → 원반
- 장소 = 지정 장소 → 그 요일·시각에 그 과목을 하는 특수학급(D25, 하나가 아니면 장소 미정) / relocate_class → 반 교실
- 오늘 변경은 now 이후에 시작하는 칸만(D24), 같은 칸은 뒤의 op가 이긴다

규칙이 두 곳에 있으면 한쪽만 바뀌어 화면과 배정이 어긋날 수 있다.

## 제안
```ts
/** 학생별 그날 교시의 배치·장소. generateDemands도 이것으로 수요를 만든다 */
export function placementsOn(input: Pick<GenerateDemandsInput, "school" | "timetable" | "students" | "ops" | "now"> & { date: IsoDate }):
  { student: StudentCode; period: number; subject: string; placement: "homeroom" | "special_class"; location: LocationRef | null; unplaced?: "none" | "multiple" }[];
```

## 영향받는 모듈
M3 — 함수로 꺼내 export, `generateDemands`가 그것을 쓰게. M7 — `apps/web/server/school.ts`의 `studentRows`·`specialRoomAt`을 지우고 deps.ts로 받는다.

## 그동안의 우회
같은 규칙을 `apps/web/server/school.ts` `studentRows`에 두고, 수요를 만든 것과 같은 ops·now(`DayData`)로 계산한다.
테스트: 9/18 화면 행 = 목데이터, 그리고 장소 변경 승인 전후 모두 "이동 묶음의 출발·도착 장소 = 그 교시 학생 행의 장소"를 확인한다(`flow.test.ts`).
