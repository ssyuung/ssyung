// 하네스 훅 공용: 입력 읽기, 모듈 범위 판정.
// 훅 규약(Claude Code): stdin으로 JSON을 받고, exit 2 + stderr면 막고 그 이유를 에이전트에게 돌려준다.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { execFileSync } from "node:child_process";
import { tmpdir, homedir } from "node:os";
import { fileURLToPath } from "node:url";

export const HOOK_DIR = dirname(fileURLToPath(import.meta.url));

export async function readInput() {
  let raw = "";
  for await (const chunk of process.stdin) raw += chunk;
  try {
    return JSON.parse(raw || "{}");
  } catch {
    return {};
  }
}

export function projectDir(input = {}) {
  return process.env.CLAUDE_PROJECT_DIR || input.cwd || process.cwd();
}

/** 막기: 에이전트에게 이유를 돌려주고 도구 실행을 멈춘다 */
export function block(message) {
  process.stderr.write(message.trim() + "\n");
  process.exit(2);
}

// ---------------------------------------------------------------- 모듈 범위
export function loadModules(root) {
  const p = join(root, ".agent-scopes", "modules.json");
  return existsSync(p) ? JSON.parse(readFileSync(p, "utf8")) : null;
}

/** 이 워크트리의 모듈 ID. .agent-scope가 없으면 null(사람이 직접 작업 → 범위 검사 안 함) */
export function scopeId(root) {
  const p = join(root, ".agent-scope");
  if (!existsSync(p)) return null;
  const id = readFileSync(p, "utf8").trim();
  return id || null;
}

/**
 * 모듈의 지시서와 상태. tasks/<ID>-*.md 중 질문 파일을 빼고, 맨 위 "> 상태: 진행|완료|보류" 줄을 읽는다.
 * 한 모듈을 여러 버전(M1-scheduler.md, M1-scheduler-v2.md …)으로 발전시킬 때 "진행"인 것이 지금 할 일이다.
 * @returns {{ path: string, status: string }[]}
 */
export function moduleTasks(root, id) {
  const dir = join(root, "tasks");
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.startsWith(id + "-") && f.endsWith(".md") && f !== `${id}-questions.md`)
    .sort()
    .map((f) => {
      const head = readFileSync(join(dir, f), "utf8").split("\n").slice(0, 8).join("\n");
      const m = head.match(/^>\s*상태:\s*(\S+)/m);
      return { path: `tasks/${f}`, status: m ? m[1] : "진행" };
    });
}

/** glob → 정규식. ** 는 디렉터리 여러 단계, * 는 한 단계 안, ? 는 한 글자 */
export function globToRegExp(glob) {
  let re = "";
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === "*") {
      if (glob[i + 1] === "*") {
        const slash = glob[i + 2] === "/";
        re += slash ? "(?:.*/)?" : ".*";
        i += slash ? 2 : 1;
      } else re += "[^/]*";
    } else if (c === "?") re += "[^/]";
    else re += c.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp("^" + re + "$");
}
export const matchAny = (path, globs) => globs.some((g) => globToRegExp(g).test(path));

/**
 * 파일 하나를 이 모듈이 써도 되는지.
 * @returns {{ ok: true } | { ok: false, reason: string }}
 */
export function checkWrite(manifest, id, relPath) {
  const mod = manifest.modules[id];
  if (!mod) return { ok: false, reason: `.agent-scope의 모듈 ID "${id}"가 .agent-scopes/modules.json에 없습니다.` };
  if (id === "M0") return { ok: true };
  const common = manifest.common_write.map((g) => g.replaceAll("{ID}", id));
  if (matchAny(relPath, common) || matchAny(relPath, mod.protected_ok ?? [])) return { ok: true };
  if (matchAny(relPath, manifest.protected))
    return {
      ok: false,
      reason:
        `${relPath}는 계약·테스트 데이터·하네스 파일이라 M0만 고칩니다.\n` +
        `바꿔야 한다면 고치지 말고 contracts/requests/${id}-<주제>.md에 무엇을·왜·영향받는 모듈을 적으세요 (docs/agent-development.md §5).`,
    };
  if (matchAny(relPath, mod.deny))
    return { ok: false, reason: `${relPath}는 ${id}(${mod.name}) 범위에서 제외된 경로입니다. 다른 모듈 소유입니다.` };
  if (matchAny(relPath, mod.write)) return { ok: true };
  return {
    ok: false,
    reason:
      `${relPath}는 ${id}(${mod.name})의 쓰기 범위 밖입니다. 허용: ${mod.write.join(", ")}\n` +
      `다른 모듈의 일이 필요하면 tasks/${id}-questions.md에 적으세요.`,
  };
}

/** 절대 경로 → 저장소 기준 상대 경로. 저장소 밖이면 null */
export function toRel(root, filePath) {
  const abs = isAbsolute(filePath) ? filePath : resolve(root, filePath);
  const rel = relative(root, abs);
  if (rel.startsWith("..") || isAbsolute(rel)) return null;
  return rel.split(sep).join("/");
}
/** 저장소 밖이어도 쓸 수 있는 곳: 임시 디렉터리, Claude 설정·메모리 */
export function isScratch(filePath) {
  const abs = resolve(filePath);
  const tmps = [tmpdir(), "/tmp", "/private/tmp", process.env.TMPDIR].filter(Boolean).map((p) => resolve(p));
  return tmps.some((t) => abs.startsWith(t + sep)) || abs.startsWith(join(homedir(), ".claude") + sep);
}

export function currentBranch(root) {
  if (process.env.SSY_BRANCH) return process.env.SSY_BRANCH; // 테스트용
  try {
    return execFileSync("git", ["-C", root, "rev-parse", "--abbrev-ref", "HEAD"], { encoding: "utf8" }).trim();
  } catch {
    return "";
  }
}

export function pathOf(toolInput = {}) {
  return toolInput.file_path ?? toolInput.notebook_path ?? null;
}
