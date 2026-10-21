#!/usr/bin/env node
// SessionStart: 이 워크트리가 어느 모듈인지, 지금 할 지시서, 쓸 수 있는 범위를 알려준다 (stdout이 컨텍스트에 들어간다)
import { readInput, projectDir, loadModules, scopeId, currentBranch, moduleTasks } from "./lib.mjs";

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

let taskLine;
if (id === "M0") taskLine = "통합(M0) 작업 공간이다. 계약·목데이터·하네스를 고칠 수 있다.";
else {
  const tasks = moduleTasks(root, id);
  const active = tasks.filter((t) => t.status === "진행");
  const held = tasks.filter((t) => t.status === "보류");
  if (active.length === 1) taskLine = `지금 할 지시서: ${active[0].path}. 먼저 읽고 그대로 수행한다. 공통 규칙은 CLAUDE.md.`;
  else if (active.length > 1) taskLine = `진행 중인 지시서가 여럿이다(${active.map((t) => t.path).join(", ")}). 시작하지 말고 사람에게 어느 것인지 묻는다.`;
  else if (held.length) taskLine = `지시서 ${held.map((t) => t.path).join(", ")}는 보류 중이다. 작업을 시작하지 말고 사람에게 알린다.`;
  else taskLine = `진행 중인 지시서(tasks/${id}-*.md, "> 상태: 진행")가 없다. 작업을 시작하지 말고 사람에게 지시서를 요청한다.`;
  const done = tasks.filter((t) => t.status === "완료");
  if (done.length) taskLine += `\n끝난 버전(참고용): ${done.map((t) => t.path).join(", ")}`;
}

const lines = [
  `이 워크트리는 ${id}(${mod.name}) 모듈 작업 공간이다. 브랜치: ${currentBranch(root)}`,
  taskLine,
  `쓰기 가능: ${mod.write.join(", ")}${mod.deny.length ? ` (제외: ${mod.deny.join(", ")})` : ""}, tasks/${id}-questions.md, contracts/requests/${id}-*.md`,
  `완료 검사(끝낼 때 자동 실행): ${[...mod.check, ...manifest.always_check].join(" ; ") || "없음"}`,
  "범위 밖 수정, 계약·목데이터 수정, push·merge·커밋(요청 없이)은 훅이 막는다.",
];
process.stdout.write(lines.join("\n") + "\n");
