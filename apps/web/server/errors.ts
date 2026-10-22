// API 오류. 계약의 ApiErrorCode를 tRPC 오류 코드에 싣고, 응답의 data.api에 ApiError를 넣는다.
import { TRPCError } from "@trpc/server";
import { ApiErrorCode } from "@ssyung/schema";
import type { ApiError } from "@ssyung/schema";

type TrpcCode = ConstructorParameters<typeof TRPCError>[0]["code"];

const TRPC_CODE: Record<ApiError["code"], TrpcCode> = {
  UNAUTHORIZED: "UNAUTHORIZED",
  FORBIDDEN: "FORBIDDEN",
  NOT_FOUND: "NOT_FOUND",
  VALIDATION: "BAD_REQUEST",
  NAME_SUSPECTED: "BAD_REQUEST",
  BASE_VERSION_CHANGED: "CONFLICT",
  NOT_SCHOOL_DAY: "BAD_REQUEST",
  NOT_IMPLEMENTED: "NOT_IMPLEMENTED",
};

export class ApiFail extends TRPCError {
  readonly api: ApiError;
  constructor(code: ApiError["code"], message: string, details?: Record<string, unknown>) {
    super({ code: TRPC_CODE[code], message });
    this.api = details ? { code, message, details } : { code, message };
  }
}

/** 모듈이 던진 오류(RepositoryError, SourceError)처럼 code가 계약 오류 코드인 것 */
function apiLike(e: unknown): ApiError | null {
  if (!(e instanceof Error) || !("code" in e)) return null;
  const code = ApiErrorCode.safeParse(e.code);
  if (!code.success) return null;
  const details = "details" in e && e.details && typeof e.details === "object" ? (e.details as Record<string, unknown>) : undefined;
  return details ? { code: code.data, message: e.message, details } : { code: code.data, message: e.message };
}

/** 처리 중 난 오류 → ApiFail. 모르는 오류는 그대로 둔다(500) */
export function toApiFail(e: unknown): unknown {
  if (e instanceof ApiFail) return e;
  const api = apiLike(e instanceof TRPCError ? e.cause : e);
  if (api) return new ApiFail(api.code, api.message, api.details);
  return e;
}

/** 응답에 실을 ApiError. 입력 검증 실패는 VALIDATION */
export function apiErrorOf(e: TRPCError): ApiError | null {
  if (e instanceof ApiFail) return e.api;
  const api = apiLike(e.cause);
  if (api) return api;
  switch (e.code) {
    case "BAD_REQUEST": return { code: "VALIDATION", message: e.message };
    case "UNAUTHORIZED": case "FORBIDDEN": case "NOT_FOUND": return { code: e.code, message: e.message };
    default: return null;
  }
}
