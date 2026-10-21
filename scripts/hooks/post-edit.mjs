#!/usr/bin/env node
// PostToolUse(Write·Edit·MultiEdit): 고친 파일이 속한 패키지만 타입 검사해 바로 돌려준다 (수 초)
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { readInput, projectDir, toRel, pathOf } from "./lib.mjs";

const input = await readInput();
const root = projectDir(input);
const file = pathOf(input.tool_input);
if (!file || !/\.(ts|tsx|mts|cts)$/.test(file)) process.exit(0);
if (toRel(root, file) === null) process.exit(0);

// 가장 가까운 package.json(저장소 루트 제외)
let dir = dirname(resolve(root, file));
let pkg = null;
while (dir.startsWith(root) && dir !== root) {
  if (existsSync(join(dir, "package.json"))) { pkg = dir; break; }
  dir = dirname(dir);
}
if (!pkg) process.exit(0);
const scripts = JSON.parse(readFileSync(join(pkg, "package.json"), "utf8")).scripts ?? {};
if (!scripts.typecheck) process.exit(0);

const r = spawnSync("pnpm", ["--dir", pkg, "run", "--silent", "typecheck"], { encoding: "utf8", timeout: 60000 });
if (r.status === 0) process.exit(0);
const out = (r.stdout + r.stderr).split("\n").filter(Boolean).slice(0, 40).join("\n");
process.stderr.write(`타입 검사 실패 (${toRel(root, pkg)}):\n${out}\n`);
process.exit(2);
