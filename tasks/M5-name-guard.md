# M5 실명 검사 v1

> 상태: 보류 (이름 저장 여부 결정 대기)
> 브랜치 `<id>/m5-name-guard` · 범위 `packages/name-guard/**` · 공통 규칙 `CLAUDE.md`

## 목표
`@ssyung/name-guard`: 교사가 입력한 텍스트(별칭, 메모, 변경 요청 원문)에서 사람 이름으로 보이는 구간을 찾는다 (docs/architecture.md §5.3).

```ts
detect(text: string, opts?: { allow?: string[] }): { start: number; end: number; text: string; reason: string }[]
```

- 다룰 것:
  - 성 + 이름(2~4자)
  - 존칭·호칭(선생님, 쌤, 씨, 님, 군, 양, 학생)
  - 조사가 붙은 경우("OOO이", "OOO가", "OOO는")
  - 영문 이름
- 학교 문맥의 일반 명사는 이름으로 잡지 않는다: 하교, 이동, 정문, 과학실, 지원인력, 국어, 특수학급, 진로활동 등.

## 테스트 세트
- `packages/name-guard/test/fixtures/`에 탐지 세트와 오탐 금지 세트를 둔다.
- 탐지 세트의 이름은 성·이름 음절을 무작위로 조합해 만든다.
- 오탐 금지 세트: 이 저장소의 docs, fixtures 문장, 화면 문구(`docs/screens`)에서 뽑는다.

## 완료 조건
- [ ] `pnpm --filter @ssyung/name-guard typecheck`, `test` 통과
- [ ] 탐지 세트 200건 이상, 재현율 95% 이상
- [ ] 오탐 금지 세트 500건 이상, 오탐 1% 이하
- [ ] 저장소 전체(`git ls-files`의 md·json·ts)에서 오탐 0건. 테스트로 자동 확인한다.
- [ ] 1KB 텍스트 1ms 이내, 외부 호출 없음(로컬 규칙·사전만)

## 범위 밖
- API 연결(M7)
- 이름이 아닌 개인정보(전화번호 등, §5.4)

## 산출물
보드 `tasks/board/M5.md` 갱신(완료 조건 체크, 다음에 할 것, 다른 모듈에 필요한 것). 변경 요약, 재현율·오탐률 표, 남은 질문(`tasks/M5-questions.md`).
