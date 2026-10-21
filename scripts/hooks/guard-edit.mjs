#!/usr/bin/env node
// PreToolUse(Write·Edit·MultiEdit·NotebookEdit): 범위(scope-guard) + 계약 보호(contract-guard)
import { readInput, projectDir, block, loadModules, scopeId, checkWrite, toRel, isScratch, pathOf } from "./lib.mjs";

const input = await readInput();
const root = projectDir(input);
const file = pathOf(input.tool_input);
if (!file) process.exit(0);

const id = scopeId(root);
if (!id) process.exit(0); // 사람이 직접 작업하는 워크트리

const rel = toRel(root, file);
if (rel === null) {
  if (isScratch(file)) process.exit(0);
  block(`${file}는 이 워크트리(${root}) 밖입니다. 에이전트는 자기 워크트리 안과 임시 디렉터리에만 씁니다.`);
}
const manifest = loadModules(root);
if (!manifest) block(".agent-scopes/modules.json이 없습니다. main을 rebase하세요.");
const r = checkWrite(manifest, id, rel);
if (!r.ok) block(r.reason);
