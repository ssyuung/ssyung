#!/usr/bin/env node
// PreToolUse(Bash): 위험 명령(danger-guard) + main 보호·커밋 규칙(commit-guard)
// .agent-scope가 없는 사람 워크트리에서는 되돌릴 수 없는 명령만 막는다.
import { homedir } from "node:os";
import { resolve, sep } from "node:path";
import { readInput, projectDir, block, scopeId, currentBranch, isScratch } from "./lib.mjs";

const input = await readInput();
const cmd = String(input.tool_input?.command ?? "");
if (!cmd) process.exit(0);
const root = projectDir(input);
const id = scopeId(root);
const agent = id !== null && id !== "M0";

// 명령을 ; && || | 로 나눠 하나씩 본다
const parts = cmd.split(/;|&&|\|\||\|(?!\|)|\n/).map((s) => s.trim()).filter(Boolean);
const has = (re) => parts.some((p) => re.test(p));

// 누구에게나: 되돌릴 수 없는 것
if (has(/^git\s+push\b.*(\s--force\b|\s-f\b|\s--force-with-lease\b|\s\+\S)/))
  block("강제 push는 막혀 있습니다. 원격 기록을 지우면 되돌릴 수 없습니다.");
if (has(/^(sudo\s+)?rm\s+(-\w*r\w*f\w*|-\w*f\w*r\w*|-r\s+-f|-f\s+-r)\s+(\/|~|\$HOME|\.\.)(\s|\/?$)/))
  block("저장소 밖이나 루트·홈을 지우는 rm -rf는 막혀 있습니다.");
if (has(/^git\s+stash\b/) && !has(/^git\s+stash\s+(list|show|apply\s+[0-9a-f]{7,}|push\b.*\s-m\s)/))
  block("git stash 스택은 모든 워크트리가 함께 씁니다. 다른 세션의 것을 꺼낼 수 있어 bare stash·pop·clear·drop은 막혀 있습니다. 작업을 잠시 치우려면 임시 커밋을 쓰세요.");
if (has(/^git\s+\S+.*\s--no-verify\b/)) block("--no-verify로 검사를 건너뛸 수 없습니다.");

if (!agent) process.exit(0);

// 모듈 에이전트에게만
const branch = currentBranch(root);
if (has(/^git\s+push\b/)) block("모듈 에이전트는 push하지 않습니다. 사람이 PR을 만들고 merge합니다 (docs/agent-development.md §6.5).");
if (has(/^git\s+(merge|rebase|cherry-pick)\b/)) block("merge·rebase는 사람이 합니다. 필요하면 작업을 멈추고 tasks/" + id + "-questions.md에 적으세요.");
if (has(/^git\s+(checkout|switch)\s+(-\S+\s+)*(main|master)\b/) || has(/^git\s+(checkout|switch)\s+-[bBc]\b/))
  block("브랜치 이동·생성은 하지 않습니다. 이 워크트리는 " + branch + " 브랜치에서만 작업합니다.");
if (has(/^git\s+(reset\s+--hard|clean\s+-\w*f|branch\s+-D|worktree\s+(add|remove|prune)|tag\b|filter-branch)/))
  block("되돌리기 어려운 git 명령(reset --hard, clean -f, branch -D, worktree, tag)은 막혀 있습니다.");
if (has(/^git\s+commit\b/) && /^(main|master)$/.test(branch)) block("main에는 커밋하지 않습니다.");
if (has(/^git\s+commit\b/) && process.env.SSY_ALLOW_COMMIT !== "1")
  block("커밋은 사람이 요청할 때만 합니다. 작업이 끝났으면 변경 요약과 완료 명령 결과를 보고하고 멈추세요. (사람이 요청했다면 SSY_ALLOW_COMMIT=1 git commit ...)");
if (has(/^(curl|wget|http|nc|scp|rsync|ftp)\b/) && has(/(\s-d\b|--data|--upload|-T\s|-F\s|-X\s*(POST|PUT|PATCH)|@\S+\.(json|csv|xlsx?)|\bscp\b|\brsync\b.*:)/))
  block("외부로 데이터를 보내는 명령은 막혀 있습니다. 학생 정보가 밖으로 나갈 수 있습니다. 필요하면 사람에게 요청하세요.");
// 이 워크트리 밖 경로를 바꾸는 명령 (다른 워크트리·원본 저장소 보호). 임시 디렉터리·~/.claude는 허용
const MUTATING = /^(rm|mv|cp|touch|mkdir|ln|chmod|tee|sed\s+-i|perl\s+-pi|git\s+-C|pnpm\s+--dir|npm\s+--prefix)\b|>\s*\S/;
for (const part of parts.filter((x) => MUTATING.test(x))) {
  for (const tok of part.split(/\s+|>/).filter(Boolean)) {
    const t = tok.replace(/^["']|["']$/g, "").replace(/^~(?=\/|$)/, homedir());
    if (!(t.startsWith("/") || t.startsWith(".."))) continue;
    const abs = resolve(root, t);
    if (abs === root || abs.startsWith(root + sep) || isScratch(abs) || abs === "/dev/null") continue;
    block(`${tok}는 이 워크트리(${root}) 밖입니다. 다른 워크트리와 원본 저장소는 건드리지 않습니다.`);
  }
}
