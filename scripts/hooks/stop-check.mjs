#!/usr/bin/env node
// Stop: 모듈 에이전트가 끝내려 할 때 완료 명령을 돌린다. 실패하면 끝내지 못하게 하고 결과를 돌려준다.
// 같은 실패로 3번 연속 막히면 그만 막고 사람에게 넘긴다(무한 반복 방지).
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { readInput, projectDir, block, loadModules, scopeId } from "./lib.mjs";

const MAX_BLOCKS = 3;
const input = await readInput();
const root = projectDir(input);
const id = scopeId(root);
if (!id) process.exit(0);
const manifest = loadModules(root);
const mod = manifest?.modules[id];
if (!mod) process.exit(0);

// 바뀐 게 없으면(질문에 답만 한 경우) 검사하지 않는다
const st = spawnSync("git", ["-C", root, "status", "--porcelain"], { encoding: "utf8" });
if (!st.stdout.trim()) process.exit(0);

const stateDir = join(root, ".agent-state");
const counter = join(stateDir, "stop-blocks");
const count = input.stop_hook_active && existsSync(counter) ? +readFileSync(counter, "utf8") || 0 : 0;

const failures = [];

for (const req of mod.requires ?? [])
  if (!existsSync(join(root, req))) failures.push(`필수 파일이 없음: ${req} (지시서의 첫 단계에서 만든다)`);
const requiresMissing = failures.length > 0;
if (!requiresMissing) {
  for (const cmd of [...(mod.check ?? []), ...(manifest.always_check ?? [])]) {
    const r = spawnSync(cmd, { cwd: root, shell: true, encoding: "utf8", timeout: 300000 });
    if (r.status !== 0) {
      const tail = (r.stdout + r.stderr).split("\n").filter(Boolean).slice(-30).join("\n");
      failures.push(`$ ${cmd}  → 실패 (exit ${r.status})\n${tail}`);
    }
  }
}

// 보드: main에서 갈라진 뒤(작업 트리 포함) 자기 보드를 한 번도 안 고쳤으면 끝내지 못한다
if (manifest.board?.required_on_stop && id !== "M0") {
  const boardRel = `${manifest.board.dir}/${id}.md`;
  const git = (...a) => spawnSync("git", ["-C", root, ...a], { encoding: "utf8" }).stdout ?? "";
  const base = git("merge-base", "HEAD", process.env.SSY_BASE ?? "main").trim() || "HEAD";
  const touched = new Set([
    ...git("diff", "--name-only", base).split("\n"),
    ...git("ls-files", "--others", "--exclude-standard").split("\n"),
  ]);
  if (!touched.has(boardRel))
    failures.push(
      `보드를 갱신하지 않았습니다: ${boardRel}\n` +
        `이번 버전 완료 조건에 체크하고, 다음에 할 것(제안)과 다른 모듈에 필요한 것을 적으세요. 형식은 ${manifest.board.dir}/_template.md.`,
    );
}

mkdirSync(stateDir, { recursive: true });
if (!failures.length) {
  writeFileSync(counter, "0");
  process.exit(0);
}
if (count >= MAX_BLOCKS) {
  writeFileSync(counter, "0");
  process.stdout.write(JSON.stringify({ systemMessage: `${id} 완료 검사가 ${MAX_BLOCKS}번 연속 실패해 사람에게 넘깁니다.` }));
  process.exit(0);
}
writeFileSync(counter, String(count + 1));
block(
  `${id}(${mod.name}) 완료 검사가 실패해 아직 끝낼 수 없습니다 (${count + 1}/${MAX_BLOCKS}).\n\n` +
    failures.join("\n\n") +
    `\n\n고칠 수 없는 이유가 계약·다른 모듈에 있으면 tasks/${id}-questions.md나 contracts/requests/에 적고, 무엇이 막혔는지 보고하세요.`,
);
