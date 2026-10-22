#!/usr/bin/env node
// 모든 모듈 보드를 모아 보기. main이 아니라 각 워크트리의 파일을 직접 읽어서, merge 전 진행 상황도 보인다.
// 사용: pnpm board            모듈별 요약
//       pnpm board --all      체크 안 된 항목·제안·다른 모듈 요청까지 전부
//       pnpm board --json     기계용
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const args = process.argv.slice(2);
const ALL = args.includes("--all");
const JSON_OUT = args.includes("--json");

const root = execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
const manifest = JSON.parse(readFileSync(join(root, ".agent-scopes/modules.json"), "utf8"));
const BOARD_DIR = manifest.board?.dir ?? "tasks/board";

/** git worktree list → [{ path, branch }] */
function worktrees() {
  const out = execFileSync("git", ["-C", root, "worktree", "list", "--porcelain"], { encoding: "utf8" });
  return out.split("\n\n").filter(Boolean).map((block) => {
    const path = block.match(/^worktree (.+)$/m)?.[1];
    const branch = block.match(/^branch refs\/heads\/(.+)$/m)?.[1] ?? "(detached)";
    return { path, branch };
  }).filter((w) => w.path && existsSync(w.path));
}

/** 보드 마크다운 → 구조 */
export function parseBoard(text) {
  const meta = {
    version: text.match(/^>\s*버전:\s*(.+)$/m)?.[1]?.trim() ?? null,
    updated: text.match(/^>\s*갱신:\s*(.+)$/m)?.[1]?.trim() ?? null,
  };
  const sections = {};
  let cur = null;
  for (const line of text.split("\n")) {
    const h = line.match(/^##\s+(.+)$/);
    if (h) { cur = h[1].trim(); sections[cur] = []; continue; }
    if (!cur) continue;
    // 들여쓴 하위 항목은 바로 앞 항목의 설명으로 붙인다
    const sub = line.match(/^\s{2,}-\s+(.+)$/);
    const list = sections[cur];
    if (sub && list.length) { list[list.length - 1].text += " / " + sub[1].trim(); continue; }
    const item = line.match(/^-\s+(?:\[( |x|X)\]\s+)?(.+)$/);
    if (item) list.push({ done: item[1] ? item[1].toLowerCase() === "x" : null, text: item[2].trim() });
  }
  const pick = (prefix) => Object.entries(sections).find(([k]) => k.startsWith(prefix))?.[1] ?? [];
  return { ...meta, current: pick("이번 버전"), next: pick("다음에 할 것"), needs: pick("다른 모듈에 필요한 것") };
}

function localTime(d) {
  const z = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())} ${z(d.getHours())}:${z(d.getMinutes())}`;
}

// 모듈 ID → 보드 출처. 그 모듈의 워크트리가 있으면 그 파일, 없으면 main(이 저장소)의 파일
const sources = {};
for (const w of worktrees()) {
  const scopeFile = join(w.path, ".agent-scope");
  if (!existsSync(scopeFile)) continue;
  const id = readFileSync(scopeFile, "utf8").trim();
  const file = join(w.path, BOARD_DIR, `${id}.md`);
  sources[id] = { id, worktree: w.path, branch: w.branch, file: existsSync(file) ? file : null };
}
const localDir = join(root, BOARD_DIR);
if (existsSync(localDir))
  for (const f of readdirSync(localDir).filter((f) => /^M\d+\.md$/.test(f))) {
    const id = f.slice(0, -3);
    if (!sources[id]?.file) sources[id] = { id, worktree: sources[id]?.worktree ?? null, branch: sources[id]?.branch ?? "(main)", file: join(localDir, f) };
  }

const ids = Object.keys(manifest.modules).filter((id) => id !== "M0");
const rows = ids.map((id) => {
  const s = sources[id];
  const mod = manifest.modules[id];
  if (!s) return { id, name: mod.name, state: "워크트리 없음" };
  if (!s.file) return { id, name: mod.name, branch: s.branch, state: "보드 없음" };
  const b = parseBoard(readFileSync(s.file, "utf8"));
  const total = b.current.filter((x) => x.done !== null).length;
  const done = b.current.filter((x) => x.done).length;
  return {
    id, name: mod.name, branch: s.branch, version: b.version, updated: b.updated,
    modified: localTime(statSync(s.file).mtime),
    progress: `${done}/${total}`, open: b.current.filter((x) => x.done === false).map((x) => x.text),
    next: b.next.map((x) => x.text), needs: b.needs.map((x) => x.text), state: total && done === total ? "완료 조건 다 됨" : "진행",
  };
});

if (JSON_OUT) {
  console.log(JSON.stringify(rows, null, 2));
  process.exit(0);
}
// 한글·전각 문자는 터미널에서 두 칸을 차지한다
const width = (s) => [...s].reduce((w, c) => w + (/[\u1100-\u115f\u2e80-\ua4cf\uac00-\ud7a3\uf900-\ufaff\uff00-\uff60]/.test(c) ? 2 : 1), 0);
const pad = (s, n) => { const t = String(s ?? ""); return t + " ".repeat(Math.max(1, n - width(t))); };
console.log(pad("모듈", 22) + pad("브랜치", 26) + pad("진행", 7) + pad("제안", 5) + pad("요청", 5) + "상태");
for (const r of rows) {
  console.log(
    pad(`${r.id} ${r.name}`, 22) + pad(r.branch ?? "-", 26) + pad(r.progress ?? "-", 7) +
      pad(r.next ? r.next.length : "-", 5) + pad(r.needs ? r.needs.length : "-", 5) + r.state + (r.version ? ` · ${r.version}` : ""),
  );
}
const withDetail = rows.filter((r) => r.open);
if (ALL)
  for (const r of withDetail) {
    console.log(`\n■ ${r.id} ${r.name} (${r.branch}) 갱신 ${r.updated ?? "?"} / 파일 ${r.modified}`);
    if (r.open.length) console.log("  남은 것\n" + r.open.map((t) => "   - " + t).join("\n"));
    if (r.next.length) console.log("  다음에 할 것 (제안 → BACKLOG.md로 옮길지 결정)\n" + r.next.map((t) => "   - " + t).join("\n"));
    if (r.needs.length) console.log("  다른 모듈에 필요한 것\n" + r.needs.map((t) => "   - " + t).join("\n"));
  }
else if (withDetail.some((r) => r.next.length || r.needs.length)) console.log("\n제안·요청 내용은 pnpm board --all");
