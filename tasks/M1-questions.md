# M1 질문

각 항목은 가장 보수적인 해석으로 진행했다. 답을 받으면 고친다.

## 요청서로 올린 것 (M0 결정 대기)

1. **fresh 정책의 설명** → `contracts/requests/M1-replanned-reason.md`
   - `REPLANNED` 이유 코드 추가를 요청했다.
   - 그동안은 연쇄로 설명 못 한 칸을 1단계 `REQUESTED`에 넣는다.
2. **이동 묶음 0명** → `contracts/requests/M1-move-group-empty.md`
   - 위반이 아니라 부족분으로 본다. §8.5 문구 수정을 요청했다.
3. **validate 경고** → `contracts/requests/M1-validate-warnings.md`
   - 엔진 입력에 배치·교사 정보가 없다. 경고 계산을 API 쪽으로 옮기자고 요청했다.
   - 그동안은 `warnings: []`.
4. **시나리오 입력** → `contracts/requests/M1-scenario-inputs.md`
   - `fixtures/scenarios/inputs/`로 고정하자고 요청했다.
   - 그동안은 M1이 목데이터로 S2·S3·S7 입력을 조립한다.

## 이렇게 정해서 반영한 것 (화면·API 쪽 확인 필요)

5. **요청 명령마다 1단계짜리 뿌리**
   - 명령마다 `REQUESTED` 단계가 하나씩 있다(`op_index` = 명령 순서, `cause: null`).
   - 칸이 어느 명령에서 나왔는지는 학생(결석·배치·지원 변경)이나 지원인력(부재)으로 찾고, 못 찾으면 첫 명령에 붙인다.
     - 예: `relocate_class`는 반 → 학생 정보가 수요에 없어 첫 명령으로 간다.
   - 수요가 안 바뀌는 명령(부재)이면 그 요청 단계의 `demand_ids`는 비어 있다. 화면(M8)은 요청 단계를 제목으로만 그리면 된다.
6. **최초 생성(`previous: null`)**
   - diff와 설명 칸이 비고 `changed_cells`는 0이다. 공백·늦게 도착 지표는 그대로 낸다.
   - 설명은 요청 단계 하나(`op_index` 없음)만 있다.

## 남은 것

7. **동점 순서가 시안과 다르다**
   - 시안은 같은 시각 수업을 학생의 특수학급 순(K1 먼저)으로 배정했다. 수요 계약에는 특수학급이 없어 수요 id 순으로 한다.
   - 그래서 fresh 정책의 바뀐 칸이 시나리오 기준선보다 1–2개 많다(S3 B 8 vs 7, S7 B 2 vs 0). 공백과 늦게 도착은 같다.
   - 시나리오 판정(gaps·late)에는 넣지 않고 비교표에만 보인다.
8. **목데이터 생성기 교체 시**
   - `scripts/mock/build-mocks.ts`를 이 패키지로 바꾸면 propose 출력이 달라진다.
     - staff-away A·C의 바뀐 칸이 4 → 3이 된다.
     - 설명 단계 구성(1단계 범위, GAP의 cause)이 바뀐다.
   - 그 결과로 목데이터와 기준선을 다시 만들어야 한다(M0).
9. **인원 2명 이상 수요의 diff**
   - `DiffEntry.before/after.staff`가 한 명뿐이라 첫 담당자만 넣는다.
   - 목데이터에는 아직 그런 수요가 없다(업무·추가 수요 없음).
