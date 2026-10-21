#!/usr/bin/env node
// CI 범위 검사: 브랜치 이름(<id>/m1-scheduler)에서 모듈을 찾고, main 대비 바뀐 파일이 모두 그 모듈 범위 안인지 본다.
// 훅은 Bash로 쓴 파일을 놓칠 수 있으므로 PR에서 한 번 더 막는다.
// 사용: node scripts/ci/scope-check.mjs [브랜치] [기준(origin/main)]   또는 FILES="a b" 환경변수로 파일 목록 직접 지정(테스트용)
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { checkWrite } from "../hooks/lib.mjs";

const root = execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
const manifest = JSON.parse(readFileSync(join(root, ".agent-scopes/modules.json"), "utf8"));
const branch = process.argv[2] ?? process.env.GITHUB_HEAD_REF ?? execFileSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], { encoding: "utf8" }).trim();
const base = process.argv[3] ?? "origin/main";

const entry = Object.entries(manifest.modules).find(([, m]) => new RegExp(`(^|/)${m.branch}(-|$)`).test(branch));
if (!entry) {
  console.log(`범위 검사 건너뜀: ${branch}는 모듈 브랜치가 아님`);
  process.exit(0);
}
const [id, mod] = entry;
const files = process.env.FILES
  ? process.env.FILES.split(/\s+/).filter(Boolean)
  : execFileSync("git", ["diff", "--name-only", `${base}...HEAD`], { encoding: "utf8" }).split("\n").filter(Boolean);
const bad = files.map((f) => [f, checkWrite(manifest, id, f)]).filter(([, r]) => !r.ok);
if (!bad.length) {
  console.log(`범위 검사 통과: ${id}(${mod.name}), 바뀐 파일 ${files.length}개`);
  process.exit(0);
}
console.log(`범위 검사 실패: ${id}(${mod.name})\n` + bad.map(([f, r]) => `  - ${f}: ${r.reason.split("\n")[0]}`).join("\n"));
process.exit(1);
