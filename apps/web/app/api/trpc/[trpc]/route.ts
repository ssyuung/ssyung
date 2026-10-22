// tRPC 엔드포인트 /api/trpc. 화면(M8)·앱(M9)이 붙는 서버.
import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { createDeps, type Deps } from "../../../../server/deps.ts";
import { appRouter } from "../../../../server/router.ts";
import { actorFromHeaders } from "../../../../server/trpc.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** SSYUNG_NOW(예: 2026-09-18T10:15:00+09:00)가 있으면 그 시각부터 흐르는 시계. 목데이터 기준일로 앱을 볼 때 */
function clockFromEnv(): (() => Date) | undefined {
  const fixed = process.env.SSYUNG_NOW;
  if (!fixed) return undefined;
  const shift = new Date(fixed).getTime() - Date.now();
  return () => new Date(Date.now() + shift);
}

// 개발 서버가 모듈을 다시 읽어도 메모리 상태를 유지한다
const g = globalThis as { __ssyungDeps?: Promise<Deps> };
const deps = () => (g.__ssyungDeps ??= createDeps({ mode: "dev", clock: clockFromEnv() }));

async function handler(req: Request) {
  const d = await deps();
  return fetchRequestHandler({
    endpoint: "/api/trpc",
    req,
    router: appRouter,
    createContext: () => ({ deps: d, actor: actorFromHeaders(d, req.headers) }),
  });
}

export { handler as GET, handler as POST };
