import { test } from "node:test";
import assert from "node:assert/strict";
import { ProposeOutput } from "@ssyung/schema";
import { propose, validate } from "../src/index.ts";
import { assertSchema, mock, PROPOSE_CASES } from "./helpers.ts";

for (const name of PROPOSE_CASES) {
  test(`propose.${name}: 선택지 수·정책 합치기가 목데이터와 같고 지표가 나빠지지 않는다`, async () => {
    const inp = mock.proposeInput(name);
    const out = await propose(inp);
    const exp = mock.proposeOutput(name);
    assertSchema(ProposeOutput, out, `propose.${name} 출력`);

    assert.equal(out.options.length, exp.options.length, "선택지 수");
    assert.deepEqual(out.options.map((o) => o.key), exp.options.map((o) => o.key));
    out.options.forEach((o, i) => {
      const e = exp.options[i];
      assert.deepEqual(o.policies, e.policies, `${o.key} policies`);
      assert.ok(o.metrics.changed_cells <= e.metrics.changed_cells, `${o.key} changed_cells ${o.metrics.changed_cells} > ${e.metrics.changed_cells}`);
      assert.ok(o.metrics.gaps <= e.metrics.gaps, `${o.key} gaps ${o.metrics.gaps} > ${e.metrics.gaps}`);
      assert.ok(o.metrics.late_students <= e.metrics.late_students, `${o.key} late ${o.metrics.late_students} > ${e.metrics.late_students}`);
    });
  });

  test(`propose.${name}: 모든 선택지가 validate 위반 0건이고 부족분이 같다`, async () => {
    const inp = mock.proposeInput(name);
    for (const o of (await propose(inp)).options) {
      const v = validate({ demands: inp.demands, staff: inp.staff, pinned: inp.pinned, assignments: o.assignments });
      assert.deepEqual(v.violations, [], `${o.key} 위반`);
      assert.deepEqual(v.shortfalls, o.shortfalls, `${o.key} 부족분`);
    }
  });
}

test("선택지 key는 합친 뒤 A, B, C 순서이고 합친 정책의 라벨을 잇는다", async () => {
  const out = await propose(mock.proposeInput("absent"));
  assert.deepEqual(out.options[0].policies, ["keep_minimal", "no_late"]);
  assert.equal(out.options[0].label, "변경 최소 · 늦게 도착 없음");
  assert.deepEqual(out.options.map((o) => o.key), ["A", "B"]);
});

test("고정 배정은 그대로 남는다", async () => {
  const inp = mock.proposeInput("staff-away");
  const pin = { ...inp.previous!.assignments.find((a) => a.staff === "A03" && a.demand_id.startsWith("les:"))!, pinned: true };
  for (const o of (await propose({ ...inp, pinned: [pin] })).options) {
    assert.ok(o.assignments.some((a) => JSON.stringify(a) === JSON.stringify(pin)), `${o.key}에 고정 배정 없음`);
    assert.deepEqual(validate({ demands: inp.demands, staff: inp.staff, pinned: [pin], assignments: o.assignments }).violations, []);
  }
});
