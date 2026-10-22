# 계약 변경 요청

모듈은 계약(`packages/schema`, `fixtures/`)을 직접 고치지 않고 여기에 요청한다. 양식은 `_template.md`.

## 처리 순서
1. 모듈이 `contracts/requests/<ID>-<주제>.md`를 쓰고 PR에 넣는다.
2. M0가 아래 표에 결정을 적는다: 받음 / 보류(사람 결정 필요) / 거절.
3. 받은 요청은 M0가 계약·목데이터·문서에 반영하고 `CONTRACT_VERSION`을 올린다.
4. 요청 파일이 main에 들어오면(모듈 PR merge 뒤) 처리가 끝난 것은 `done/`으로 옮긴다.
5. 요청한 모듈은 다음 버전에서 우회 코드를 지운다. 보드의 "다음에 할 것"에 적는다.

## 상태

| 요청 | 모듈 | 결정 | 반영 | 요청 모듈이 할 일 |
<!-- 파일 위치: done/ = 처리 끝나고 main에 들어온 것 -->
|---|---|---|---|---|
| `done/M1-replanned-reason` | M1 | 받음 | 0.2.0: `ReasonCode`에 `REPLANNED`, architecture.md §8.7. 목데이터도 처음부터 다시 정책의 설명 못 한 칸을 `REPLANNED`로 | 우회(1단계 `REQUESTED`에 넣기)를 `REPLANNED` 단계로 |
| `done/M1-move-group-empty` | M1 | 받음 | 0.2.0: `MOVE_GROUP_HEADCOUNT` 설명, architecture.md §8.5 | 없음 (이미 그렇게 구현) |
| `done/M1-validate-warnings` | M1 | 받음 (하위 호환으로) | 0.2.0: `ValidateOutput.warnings`를 선택 필드로(쓰지 않음, 1.0에서 뺌). API용 `ScheduleValidateOutput`(warnings 필수)을 `schedule.validate`·`updateDraft` 출력으로. 목데이터 엔진 출력에서 warnings 뺌 | M1: `warnings: []` 지우기. M7: 경고 계산 |
| `done/M1-scenario-inputs` | M1 | 받음 | 0.2.0: `fixtures/scenarios/inputs/S1·S2·S3·S4·S5·S7.input.json`(시안 엔진이 수요를 만들 수 있는 6개), `CascadeScenario.input`. S6·S8·S9·S10은 M3 merge 뒤 그 결과로 | `scenario-lib.ts`의 입력 조립을 지우고 파일 읽기. 입력이 있는 6개 시나리오 켜기 |
| `M4-last-code-no` | M4 | 받음 | 0.2.0: `StudentsFile`·`StaffFile`에 `last_code_no` 선택 필드 | 원본 JSON 직접 읽기를 스키마 파싱으로 |
| `M3-special-class-timetable` | M3 | 받음 (사람 결정 D25) | **0.3.0 (하위 호환 아님)**: `SpecialClass.lessons`(요일·시각), `Student.special_class` 삭제, `special_class_subjects`는 과목 목록, `DemandSet.unplaced`, 경고 `SPECIAL_CLASS_UNPLACED`, `SetPlacement.location` 설명, `dataset/db/특수학급시간표.json`, `SpecialClassTimetableFile`. 시나리오 S6을 "K2 교실 이동"으로 다시 정의, 기준선을 데이터로 다시 계산 | M3: 장소를 특수학급 시간표로, 장소 미정은 `unplaced`. M4: 새 학생 형식, 시간표 파일 → `SchoolBundle.special_classes[].lessons` |

M3 요청의 결정 (2026-10-22, D25): 시간표는 요일·시각 기준(요일마다 다름), 학생별 과목 장소는 없앰(시간표로만), 소속 특수학급 필드는 없앰. 그 시각 그 과목을 하는 특수학급이 없거나 둘 이상이면 특수학급 수업으로 보되 장소 미정(이동 수요 없음, 경고).

## 같이 반영한 M0 정리 (0.2.0)
- 공용 시간 함수 `hhmmToMinute`, `minuteToHHMM`, `ceil10`, `weekdayOf`와 기본 일과 `DEFAULT_BELL`을 `@ssyung/schema`에 둠. 모듈마다 따로 만들던 것을 대신한다.
- `RuleKey.move_group`: 엔진이 읽지 않는 설정(D12는 항상 켜짐). 1.0에서 뺀다.
- D24(오늘 변경은 요청 시각부터): `ProposeInput.now`, `ValidateInput.now/previous`, 위반 코드 `BEFORE_NOW_CHANGED`, `AssignRequest.frozen`.
