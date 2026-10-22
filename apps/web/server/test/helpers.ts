// 테스트 공용: 시계를 고정한 test 구성, 호출자별 caller, 오류 코드 꺼내기, 목데이터 읽기.
import { readFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { TRPCError } from "@trpc/server";
import type { Actor, ProcedureName } from "@ssyung/schema";
import { createDeps, repoRoot, type CreateDepsOptions, type Deps } from "../deps.ts";
import { apiErrorOf } from "../errors.ts";
import { appRouter } from "../router.ts";
import { createCallerFactory } from "../trpc.ts";

/** 목데이터 기준 시각: 2026-09-18(금) 10:15 */
export const TEST_NOW = new Date("2026-09-18T10:15:00+09:00");
export const ROOT = repoRoot();

export const readJson = (rel: string): any => JSON.parse(readFileSync(join(ROOT, rel), "utf8"));
export const mockApi = (name: ProcedureName): { examples: any[] } => readJson(`fixtures/mock/api/${name}.json`);

const factory = createCallerFactory(appRouter);

export function actorOf(code: string | null): Actor | null {
  if (code === null) return null;
  return code.startsWith("T") ? { kind: "member", code } : { kind: "staff", code };
}

export async function setup(opts: Partial<CreateDepsOptions> = {}) {
  const deps = await createDeps({ mode: "test", clock: () => TEST_NOW, ...opts });
  return {
    deps,
    /** code 호출자로 프로시저 이름(school.search)을 부른다 */
    call: (code: string | null, name: ProcedureName, input: unknown): Promise<any> => {
      const [ns, fn] = name.split(".") as [string, string];
      const caller = factory({ deps, actor: actorOf(code) }) as any;
      return caller[ns][fn](input);
    },
    cleanup: () => (opts.dataDir ? Promise.resolve() : rm(dirname(deps.dataDir), { recursive: true, force: true })),
  };
}

/** 실패한 호출의 계약 오류 코드. 성공하면 null */
export async function errorCode(p: Promise<unknown>): Promise<string | null> {
  try {
    await p;
    return null;
  } catch (e) {
    if (!(e instanceof TRPCError)) throw e;
    return apiErrorOf(e)?.code ?? `TRPC:${e.code}`;
  }
}

export type { Deps };
