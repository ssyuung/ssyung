// 평가용 비교. when 하나와 원소 하나짜리 배열, op·when 순서, unsupported 문구 차이는 같은 것으로 본다
import type { ChangeOps } from "@ssyung/schema";

const canon = (v: unknown): string =>
  Array.isArray(v)
    ? `[${v.map(canon).join(",")}]`
    : v && typeof v === "object"
      ? `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canon((v as Record<string, unknown>)[k])}`).join(",")}}`
      : JSON.stringify(v);

function normalize(r: ChangeOps): string {
  const ops = r.ops.map((op) => {
    const whens = (Array.isArray(op.when) ? op.when : [op.when]).map(canon).sort();
    return canon({ ...op, when: whens });
  });
  return canon({ ops: ops.sort(), scope: r.scope, unsupported: r.unsupported != null });
}

/** ops·scope·unsupported 여부가 같은가 (confidence와 unsupported 문구는 보지 않는다) */
export const sameOps = (a: ChangeOps, b: ChangeOps): boolean => normalize(a) === normalize(b);
