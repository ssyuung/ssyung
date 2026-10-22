# 계약 변경 요청: 배치 경고는 배치 엔진 밖에서 계산

- 요청 모듈: M1
- 날짜: 2026-10-22
- 바꿀 것: `packages/schema/src/scheduler.ts`의 `ValidateOutput.warnings` → `packages/schema/src/api.ts`의 `schedule.validate` 출력으로 옮김. `docs/architecture.md` §8.5
- 하위 호환: 아니오(필드 위치 이동)

## 이유
경고 `SPECIAL_CLASS_CROWDED`(특수학급 한 칸에 학생이 너무 많음)와 `NO_SPECIAL_TEACHER`(그 칸 담당 교사 없음)를 계산하려면 두 가지가 필요하다.
- 학생별 특수학급 배치(어느 교시에 어느 특수학급에 있는지)
- 교사 담당표

`ValidateInput`은 수요·근무·배정만 받는다. 특수학급 수업은 수요를 만들지 않으므로(§8.1 ①) 엔진 입력에는 이 정보가 아예 없다. 입력에 시간표·배치를 더하면 "엔진 입력은 수요 목록만"(§9.2) 원칙이 깨지고, 수요 생성 로직이 두 곳에 생긴다.

## 제안
- `ValidateOutput`에서 `warnings`를 뺀다. 엔진은 위반·부족분만 돌려준다.
- `schedule.validate` API 출력 = 엔진 결과 + `warnings`. 서버(M7 또는 `packages/core`)가 배치·교사 데이터로 경고를 계산한다.
- 경고는 배정과 무관한 배치 문제이고 막지도 않으므로(§8.5), 엔진 밖이 자연스럽다.

```ts
// scheduler.ts
export const ValidateOutput = z.object({ violations: z.array(Violation), shortfalls: z.array(Shortfall) });
// api.ts (schedule.validate)
output: ValidateOutput.extend({ warnings: z.array(Warning) })
```

## 영향받는 모듈
- M1: `warnings` 필드를 뺀다.
- M7: 경고 계산을 추가한다.
- M8: 그대로 `schedule.validate` 응답에서 읽는다.

## 그동안의 우회
M1은 `warnings: []`를 낸다.
