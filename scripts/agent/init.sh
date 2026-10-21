#!/usr/bin/env bash
# 모듈 워크트리 준비: .agent-scope 쓰기, 의존성 설치, 지금 할 지시서 안내.
# 사용 (새 워크트리 안에서): bash scripts/agent/init.sh M1
# 같은 워크트리에서 다음 버전 브랜치로 바꾼 뒤 다시 실행해도 된다 (안내만 새로 나옴).
set -euo pipefail
id="${1:?모듈 ID를 주세요 (예: M1)}"
root="$(git rev-parse --show-toplevel)"
cd "$root"
node --input-type=module -e '
import { loadModules, moduleTasks, currentBranch } from "./scripts/hooks/lib.mjs";
const id = process.argv[1], root = process.cwd();
const m = loadModules(root)?.modules[id];
if (!m) { console.error("없는 모듈: " + id); process.exit(1); }
const b = currentBranch(root);
if (!new RegExp("(^|/)" + m.branch + "(-|$)").test(b))
  console.warn("주의: 브랜치 " + b + "가 모듈 브랜치 이름(<id>/" + m.branch + "[-v2…])과 다릅니다. CI 범위 검사가 이 브랜치를 모듈로 알아보지 못합니다.");
const tasks = moduleTasks(root, id);
console.log(id + " " + m.name + " | 지시서: " + (tasks.map((t) => t.path + " (" + t.status + ")").join(", ") || "없음"));
' "$id"
echo "$id" > .agent-scope
pnpm i --silent
echo "준비 끝. 이 워크트리에서 Claude Code를 열고 이렇게 시작하세요:"
echo "  진행 중인 지시서를 읽고 수행해"
