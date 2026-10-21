#!/usr/bin/env node
// SessionStart: 이 워크트리가 어느 모듈인지, 무엇을 읽고 어디까지 쓸 수 있는지 알려준다 (stdout이 컨텍스트에 들어간다)
import { existsSync } from "node:fs";
import { join } from "node:path";
import { readInput, projectDir, loadModules, scopeId, currentBranch } from "./lib.mjs";

const input = await readInput();
const root = projectDir(input);
const id = scopeId(root);
if (!id) process.exit(0);
const manifest = loadModules(root);
const mod = manifest?.modules[id];
if (!mod) {
  process.stdout.write(`경고: .agent-scope의 "${id}"가 .agent-scopes/modules.json에 없습니다.\n`);
  process.exit(0);
}
const lines = [
  `이 워크트리는 ${id}(${mod.name}) 모듈 작업 공간이다. 브랜치: ${currentBranch(root)}`,
  !mod.task
    ? "통합(M0) 작업 공간이다. 계약·목데이터·하네스를 고칠 수 있다."
    : existsSync(join(root, mod.task))
      ? `먼저 ${mod.task}를 읽고 그대로 수행한다. 공통 규칙은 CLAUDE.md.`
      : `지시서 ${mod.task}가 아직 없다. 작업을 시작하지 말고 사람에게 지시서를 요청한다.`,
  `쓰기 가능: ${mod.write.join(", ")}${mod.deny.length ? ` (제외: ${mod.deny.join(", ")})` : ""}, tasks/${id}-questions.md, contracts/requests/${id}-*.md`,
  `완료 검사(끝낼 때 자동 실행): ${[...mod.check, ...manifest.always_check].join(" ; ") || "없음"}`,
  "범위 밖 수정, 계약·목데이터 수정, push·merge·커밋(요청 없이)은 훅이 막는다.",
];
process.stdout.write(lines.join("\n") + "\n");
