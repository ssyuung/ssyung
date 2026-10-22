import { test } from "node:test";
import assert from "node:assert/strict";
import { classify, computeDiff, explain, propose } from "../src/index.ts";
import { mock, PROPOSE_CASES } from "./helpers.ts";

for (const name of PROPOSE_CASES) {
  test(`propose.${name}: diff의 모든 칸이 설명의 어느 단계에 있다`, async () => {
    const inp = mock.proposeInput(name);
    for (const o of (await propose(inp)).options) {
      const listed = new Set(o.explanation.flatMap((s) => s.demand_ids));
      for (const e of o.diff) assert.ok(listed.has(e.demand_id), `${o.key} 설명 없음: ${e.demand_id}`);
      // 이전 배정을 유지하는 정책은 요청 단계로 떠넘기지 않고 연쇄로 설명해야 한다
      if (!o.policies.includes("fresh")) {
        const { unexplained } = classify(o.diff, { previous: inp.previous, next: { demands: inp.demands, assignments: o.assignments }, staff: inp.staff, request: inp.request });
        assert.deepEqual(unexplained, [], `${o.key} 연쇄로 설명 못 함`);
      }
    }
  });

  test(`propose.${name}: 단계 번호는 1부터 차례로, 요청 단계만 cause가 없고 나머지는 앞선 단계를 가리킨다`, async () => {
    for (const o of (await propose(mock.proposeInput(name))).options) {
      o.explanation.forEach((s, i) => {
        assert.equal(s.step, i + 1);
        if (s.reason.code === "REQUESTED") assert.equal(s.cause, null);
        else assert.ok(s.cause !== null && s.cause < s.step, `${o.key} step ${s.step} cause ${s.cause}`);
      });
    }
  });
}

test("staff-away 변경 최소: 부재 → 겹침·두 번째 이동으로 이어진다", async () => {
  const o = (await propose(mock.proposeInput("staff-away"))).options[0];
  const codes = o.explanation.map((s) => s.reason.code);
  assert.deepEqual(codes.slice(0, 2), ["REQUESTED", "UNAVAILABLE"]);
  assert.ok(codes.includes("EDGE_RELEASED"));
  assert.deepEqual(o.explanation[0].reason, { code: "REQUESTED", op_index: 0 });
});

test("배정이 그대로면 diff가 비고 설명은 요청 단계뿐이다", () => {
  const inp = mock.proposeInput("staff-away");
  const plan = inp.previous!;
  const diff = computeDiff(plan, plan);
  assert.deepEqual(diff, []);
  const steps = explain(diff, { previous: plan, next: plan, staff: inp.staff, request: inp.request });
  assert.equal(steps.length, 1);
  assert.deepEqual(steps[0].demand_ids, []);
});

test("최초 생성(previous null)이면 diff가 비고 바뀐 칸은 0, 공백 지표는 그대로", async () => {
  const inp = mock.proposeInput("staff-away");
  assert.deepEqual(computeDiff(null, inp.previous!), []);
  for (const o of (await propose({ ...inp, previous: null, request: null })).options) {
    assert.deepEqual(o.diff, []);
    assert.equal(o.metrics.changed_cells, 0);
    assert.equal(o.metrics.gaps, new Set(o.shortfalls.filter((s) => !s.waived).map((s) => s.demand_id)).size);
    assert.equal(o.explanation.length, 1);
    assert.deepEqual(o.explanation[0].reason, { code: "REQUESTED" });
  }
});

test("명령이 여러 개면 명령마다 요청 단계가 있고, 칸은 자기 명령을 원인으로 가리킨다", async () => {
  const inp = mock.proposeInput("staff-away");
  // 같은 날 A02 이른 아침 부재를 두 번째 명령으로 더한다
  const ops = [...inp.request!.ops, { op: "staff_unavailable" as const, staff: "A02", when: { date: "2026-09-18", start: "09:00", end: "09:40" } }];
  const staff = inp.staff.map((w) => (w.staff === "A02" ? { ...w, absent: [{ start: 540, end: 580 }] } : w));
  const o = (await propose({ ...inp, staff, request: { change_request_id: null, ops }, policies: ["keep_minimal"] })).options[0];
  assert.deepEqual(o.explanation.slice(0, 2).map((s) => [s.reason, s.cause]), [[{ code: "REQUESTED", op_index: 0 }, null], [{ code: "REQUESTED", op_index: 1 }, null]]);
  const unav = o.explanation.filter((s) => s.reason.code === "UNAVAILABLE");
  assert.deepEqual(unav.map((s) => s.cause).sort(), [1, 2]);
  const byOp = (step: number) => unav.find((s) => s.cause === step)!.demand_ids.map((id) => o.diff.find((e) => e.demand_id === id)!.before!.staff);
  assert.ok(byOp(1).every((s) => s === "A01"));
  assert.ok(byOp(2).every((s) => s === "A02"));
});
