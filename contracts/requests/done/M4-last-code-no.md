# 계약 변경 요청: 발급 번호(last_code_no) 필드

- 요청 모듈: M4
- 날짜: 2026-10-22
- 바꿀 것: `packages/schema/src/dataset.ts`의 `StudentsFile`, `StaffFile`에 `last_code_no` 추가
- 하위 호환: 예(선택 필드 추가)

## 이유
학생·지원인력 코드는 지운 번호를 다시 쓰지 않기로 했다(사람 결정, 2026-10-22, `tasks/M4-questions.md` Q5).
예전 메모·알림 문장에 남은 "S07"이 새 학생을 가리키지 않게 하려는 것이다.

남은 코드만 보면 가장 큰 번호를 지웠을 때 정보가 사라진다.
- S01–S07에서 S07 삭제 → 추가하면 S07이 다시 나옴 (원하는 값: S08)

그래서 지금까지 발급한 가장 큰 번호를 파일에 남겨야 하는데, 지금 계약에는 그 자리가 없다.

## 제안
```ts
export const StudentsFile = z.object({
  _note: z.string().optional(),
  last_code_no: z.number().int().min(0).optional().describe("지금까지 발급한 가장 큰 번호. 없으면 남은 코드의 최댓값"),
  students: z.array(...),
});
// StaffFile도 같다
```
```json
{ "_note": "…", "last_code_no": 8, "students": [ … ] }
```
- `dataset/db/` 원본 파일은 바꾸지 않아도 된다(없으면 남은 코드의 최댓값으로 본다).
- DB 단계에서는 `school`에 학교별 시퀀스(또는 같은 이름의 컬럼)로 옮긴다.

## 영향받는 모듈
- M4: 받아들여지면 원본 JSON에서 직접 읽는 부분을 `StudentsFile`/`StaffFile` 파싱으로 바꾼다.
- 그 밖: 없음. 도메인 `Student`/`Staff`와 API는 그대로다.

## 그동안의 우회
`JsonRepository`가 `last_code_no`를 원본 JSON에서 직접 읽고, 쓸 때 파일 맨 위에 덧붙인다.
나머지 내용은 지금 스키마로 검증한다. 필드가 없으면 남은 코드의 최댓값을 쓴다.
