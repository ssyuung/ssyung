#!/usr/bin/env bash
# 모듈 워크트리 준비: .agent-scope 쓰기, 의존성 설치, 지시서 안내.
# 사용 (새 워크트리 안에서): bash scripts/agent/init.sh M1
set -euo pipefail
id="${1:?모듈 ID를 주세요 (예: M1)}"
root="$(git rev-parse --show-toplevel)"
cd "$root"
node -e '
const m = require("./.agent-scopes/modules.json").modules[process.argv[1]];
if (!m) { console.error("없는 모듈: " + process.argv[1]); process.exit(1); }
const b = require("child_process").execSync("git rev-parse --abbrev-ref HEAD").toString().trim();
if (!new RegExp("(^|/)" + m.branch + "(-|$)").test(b)) console.warn("주의: 브랜치 " + b + "가 모듈 브랜치 이름(<id>/" + m.branch + ")과 다릅니다. CI 범위 검사가 이 브랜치를 모듈로 알아보지 못합니다.");
console.log(process.argv[1] + " " + m.name + " | 지시서: " + (m.task || "없음(M0)"));
' "$id"
echo "$id" > .agent-scope
pnpm i --silent
echo "준비 끝. 이 워크트리에서 Claude Code를 열고 이렇게 시작하세요:"
echo "  $(node -e 'const m=require("./.agent-scopes/modules.json").modules[process.argv[1]];console.log(m.task?m.task+"를 읽고 수행해":"CLAUDE.md를 읽어")' "$id")"
