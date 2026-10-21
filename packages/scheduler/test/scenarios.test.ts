import { test } from "node:test";
import assert from "node:assert/strict";
import { ProposeInput } from "@ssyung/schema";
import { runAll, scenarioInput, readJson } from "../scripts/scenario-lib.ts";
import { assertSchema, mock } from "./helpers.ts";

test("시나리오 S2 입력은 목데이터 propose.staff-away 입력과 같은 문제다", () => {
  const s2 = readJson("fixtures/scenarios/cascade-scenarios.json").scenarios.find((s: { id: string }) => s.id === "S2");
  const inp = scenarioInput(s2);
  assertSchema(ProposeInput, inp, "S2 입력");
  const m = mock.proposeInput("staff-away");
  assert.deepEqual(inp.demands, m.demands);
  assert.deepEqual(inp.staff, m.staff);
  assert.deepEqual(inp.previous, m.previous);
});

test("연쇄 시나리오: 실행한 것은 기준선보다 나빠지지 않고, 나머지는 건너뜀", async () => {
  const rows = await runAll();
  assert.deepEqual(rows.filter((r) => !r.skipped).map((r) => r.id), ["S2", "S3", "S7"]);
  for (const r of rows) assert.deepEqual(r.problems, [], r.id);
});
