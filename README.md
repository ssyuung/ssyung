# ssyung

특수학급 학생 지원인력 배치·시간표 서비스. 지금은 아키텍처·계약 단계다.

| 문서 | 내용 |
|---|---|
| [docs/architecture.md](docs/architecture.md) | 아키텍처 |
| [docs/contracts.md](docs/contracts.md) | 모듈 사이 데이터 형식(`packages/schema`)과 목데이터(`fixtures/mock`) |
| [docs/agent-development.md](docs/agent-development.md) | 병렬 에이전트 개발, 하네스 |
| [docs/scheduler-scenarios.md](docs/scheduler-scenarios.md) | 배치 엔진 연쇄 시나리오 |
| [docs/screens/ssyung-screens.html](docs/screens/ssyung-screens.html) | 화면 시안 |

```bash
pnpm i
pnpm test          # 계약 타입 검사 + 목데이터·테스트 데이터 검증
pnpm gen           # JSON Schema 생성
pnpm mock:build    # 목데이터 다시 생성
```
