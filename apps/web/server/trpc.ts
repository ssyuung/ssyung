// tRPC 기본: 컨텍스트, 오류 모양, 권한. input·output 검증은 계약의 zod를 그대로 쓴다.
import { initTRPC } from "@trpc/server";
import { procedures, StaffCode, TeacherCode } from "@ssyung/schema";
import type { Actor, ProcedureName } from "@ssyung/schema";
import type { Deps } from "./deps.ts";
import { ApiFail, apiErrorOf, toApiFail } from "./errors.ts";

export type Context = { deps: Deps; actor: Actor | null };

/**
 * 호출자 (v1 인증). 개발용 헤더 `x-dev-actor: T01 | A02`, 또는 기기 연결로 받은 `authorization: Bearer <session_token>`.
 * 테스트는 컨텍스트를 직접 만든다.
 */
export function actorFromHeaders(deps: Deps, headers: Headers): Actor | null {
  const dev = headers.get("x-dev-actor")?.trim();
  if (dev && TeacherCode.safeParse(dev).success) return { kind: "member", code: dev };
  if (dev && StaffCode.safeParse(dev).success) return { kind: "staff", code: dev };
  const bearer = headers.get("authorization")?.match(/^Bearer (.+)$/)?.[1];
  const device = bearer ? deps.store.devices.get(bearer) : undefined;
  return device ? { kind: "staff", code: device.staff } : null;
}

const t = initTRPC.context<Context>().create({
  errorFormatter({ shape, error }) {
    return { ...shape, data: { ...shape.data, api: apiErrorOf(error) } };
  },
});

export const router = t.router;

/** 지원인력도 부를 수 있는 프로시저. 나머지는 교사만 */
const STAFF_OK = new Set<ProcedureName>([
  "view.staffToday", "attendance.set", "attendance.clear", "cell.check", "cell.uncheck", "cell.note",
  "memo.post", "memo.markRead", "notification.ack", "device.redeemInvite",
]);
/** 지원인력만 */
const STAFF_ONLY = new Set<ProcedureName>(["view.staffToday", "notification.ack"]);
/** 로그인 전 (기기 연결) */
const PUBLIC = new Set<ProcedureName>(["device.redeemInvite"]);

/** 모듈 오류(RepositoryError 등)를 계약 오류 코드로 */
const mapErrors = t.middleware(async ({ next }) => {
  const r = await next();
  if (!r.ok) {
    const e = toApiFail(r.error);
    if (e instanceof ApiFail) return { ...r, error: e };
  }
  return r;
});

const guard = (name: ProcedureName) =>
  t.middleware(({ ctx, next }) => {
    const actor = ctx.actor;
    if (!actor) {
      if (PUBLIC.has(name)) return next({ ctx: { actor: null } });
      throw new ApiFail("UNAUTHORIZED", "로그인이 필요해요.");
    }
    if (actor.kind === "staff" && !STAFF_OK.has(name)) throw new ApiFail("FORBIDDEN", "지원인력은 쓸 수 없는 기능이에요.");
    if (actor.kind === "member" && STAFF_ONLY.has(name)) throw new ApiFail("FORBIDDEN", "지원인력 앱에서 쓰는 기능이에요.");
    return next({ ctx: { actor } });
  });

/** 계약의 프로시저 하나. 권한 검사 + 계약 input·output */
export function proc<N extends ProcedureName>(name: N) {
  return t.procedure.use(mapErrors).use(guard(name))
    .input<Contract[N]["input"]>(procedures[name].input)
    .output<Contract[N]["output"]>(procedures[name].output);
}
type Contract = typeof procedures;

/** 로그인한 호출자 (guard를 지난 뒤) */
export function actorOf(ctx: Context): Actor {
  if (!ctx.actor) throw new ApiFail("UNAUTHORIZED", "로그인이 필요해요.");
  return ctx.actor;
}

export function staffOf(ctx: Context) {
  const a = actorOf(ctx);
  if (a.kind !== "staff") throw new ApiFail("FORBIDDEN", "지원인력 앱에서 쓰는 기능이에요.");
  return a.code;
}

export const createCallerFactory = t.createCallerFactory;
