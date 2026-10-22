# 계약 변경 요청: MockSource 기본 경로를 번들러가 읽지 않게 (M4)

- 요청 모듈: M7
- 날짜: 2026-10-22
- 바꿀 것: `packages/school-data/src/mock-source.ts`의 `MOCK_DIR`
- 하위 호환: 예(동작 같음)

## 이유
모듈 맨 위의 `fileURLToPath(new URL("../../../fixtures/mock", import.meta.url))`를 Next(Turbopack)가 자산 참조로 해석해 `next build`가 실패한다:
`Module not found: Can't resolve '../../../fixtures/mock'`. M7은 `mockDir`를 항상 넘기는데도 모듈을 읽는 것만으로 깨진다.

## 제안
기본 경로를 생성자 안에서, 번들러가 정적으로 보지 않는 방식으로 계산한다. 예:
```ts
constructor(options: MockSourceOptions = {}) {
  this.dir = options.mockDir ?? fileURLToPath(new URL(/* turbopackIgnore: true */ "../../../fixtures/mock", import.meta.url));
}
```
또는 `mockDir`를 필수로.

## 영향받는 모듈
M4 — 한 줄 수정. M7 — `apps/web/server/deps.ts`의 `loadSchoolData`(동적 import)를 정적 import로 되돌린다.

## 그동안의 우회
`deps.ts`에서 `@ssyung/school-data`만 `import(/* turbopackIgnore: true */ name)`로 실행 시 불러 Node가 직접 읽는다(Node 24 타입 제거). 테스트와 `next build`·`next dev` 모두 동작한다.
