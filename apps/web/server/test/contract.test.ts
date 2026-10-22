// 계약 테스트: 라우터 = 계약의 프로시저 목록, fixtures/mock/api/*.json 예시 input으로 모두 호출한다.
// output 예시는 출력이 계약 스키마를 통과하는지(값은 달라도 됨), error 예시는 같은 code인지 본다.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { procedures } from "@ssyung/schema";
import type { ProcedureName } from "@ssyung/schema";
import { appRouter } from "../router.ts";
import { errorCode, mockApi, setup } from "./helpers.ts";

test("라우터의 프로시저 목록이 계약과 정확히 같다", () => {
  const routed = Object.keys(appRouter._def.procedures).sort();
  assert.deepEqual(routed, Object.keys(procedures).sort());
});

/**
 * 호출 순서. 앞 호출이 만든 것(초안 버전, 변경 요청, 제안, 초대 코드)을 뒤 호출이 쓴다.
 * 날짜·학생을 바꾸는 호출(삭제, 활성화)은 뒤로 둔다.
 */
const ORDER: ProcedureName[] = [
  "school.search", "school.get", "school.import", "setup.previewMoveGroups", "students.list", "staff.list",
  "view.day", "view.week", "view.staffToday",
  "attendance.set", "attendance.clear", "cell.check", "cell.uncheck", "cell.note", "memo.post", "memo.markRead",
  "schedule.generate", "schedule.validate", "schedule.updateDraft", "schedule.rollback",
  "change.interpret", "change.confirm", "proposal.approve", "proposal.reject", "notification.ack",
  "schedule.activate",
  "students.update", "students.add", "students.remove", "staff.update", "staff.add",
  "staff.issueInvite", "device.redeemInvite", "staff.revokeDevice", "staff.remove", "setup.saveLayout",
];

/** 예시 출력에 나온 호출자. 없으면 교사 T01, 출력이 없는 지원인력 호출은 아래 표 */
const ACTOR: Partial<Record<ProcedureName, string>> = { "attendance.clear": "A01", "cell.uncheck": "A01", "memo.markRead": "A01" };
function actorFor(name: ProcedureName, ex: any): string {
  const out = ex.output;
  if (name === "view.staffToday" || name === "notification.ack") return out.staff;
  const by = out?.checked_by ?? out?.done_by ?? out?.author;
  return by?.code ?? ACTOR[name] ?? "T01";
}

/** 목데이터 id → 서버가 만든 id. 뒤 호출의 input에서 바꿔 쓴다 */
const alias = new Map<string, string>();
const substitute = (v: unknown): unknown =>
  typeof v === "string" ? (alias.get(v) ?? v)
    : Array.isArray(v) ? v.map(substitute)
    : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, substitute(x)]))
    : v;
function learn(fixture: any, actual: any) {
  for (const k of ["id", "code"] as const) {
    if (typeof fixture?.[k] === "string" && typeof actual?.[k] === "string" && fixture[k] !== actual[k]) alias.set(fixture[k], actual[k]);
  }
  if (fixture?.version) learn(fixture.version, actual?.version);
}

let env: Awaited<ReturnType<typeof setup>>;
before(async () => { env = await setup(); });
after(() => env.cleanup());

test("호출 순서가 프로시저 36개를 모두 덮는다", () => {
  assert.deepEqual([...ORDER].sort(), Object.keys(procedures).sort());
});

for (const name of ORDER) {
  test(`예시: ${name}`, async (t) => {
    for (const ex of mockApi(name).examples) {
      const actor = actorFor(name, ex);
      const input = substitute(ex.input) as any;
      // 알림 id는 승인 때 보낸 순서로 매겨져 목데이터와 다르다. 이 지원인력이 받은 첫 알림을 쓴다
      if (name === "notification.ack") {
        input.notification_id = [...env.deps.store.notifications.values()].find((n) => n.staff === actor)!.id;
      }
      await t.test(ex.title, async () => {
        if ("error" in ex) {
          assert.equal(await errorCode(env.call(actor, name, input)), ex.error.code);
          return;
        }
        let out;
        try {
          out = await env.call(actor, name, input);
        } catch (e) {
          assert.fail(`${name} (${actor}) 실패: ${(e as Error).message}`);
        }
        const parsed = procedures[name].output.safeParse(out);
        assert.ok(parsed.success, parsed.success ? "" : JSON.stringify(parsed.error.issues.slice(0, 3)));
        learn(ex.output, out);
      });
    }
  });
}
