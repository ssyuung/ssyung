import { test } from "node:test";
import assert from "node:assert/strict";
import { propose } from "../src/index.ts";
import { scenarioInput, readJson } from "../scripts/scenario-lib.ts";
import { mock, PROPOSE_CASES, stable } from "./helpers.ts";

test("같은 입력이면 같은 결과 (두 번 실행)", async () => {
  for (const name of PROPOSE_CASES) {
    const inp = mock.proposeInput(name);
    assert.equal(stable(await propose(structuredClone(inp))), stable(await propose(structuredClone(inp))), name);
  }
});

test("하루 입력이 1초 안에 끝난다", async () => {
  // 수요가 가장 많은 날(09/15, 이동이 몰리는 날)로 잰다
  const s7 = readJson("fixtures/scenarios/cascade-scenarios.json").scenarios.find((s: { id: string }) => s.id === "S7");
  for (const inp of [scenarioInput(s7), ...PROPOSE_CASES.map(mock.proposeInput)]) {
    const t0 = performance.now();
    await propose(inp);
    const ms = performance.now() - t0;
    assert.ok(ms < 1000, `${inp.dates[0]}: ${Math.round(ms)}ms`);
  }
});
