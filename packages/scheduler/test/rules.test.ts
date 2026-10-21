// 규칙별 확인. 입력은 목데이터와 시나리오 S7(이동이 몰리는 날)
import { test } from "node:test";
import assert from "node:assert/strict";
import type { MoveGroupDemand, ProposeInput } from "@ssyung/schema";
import { heuristic, POLICIES } from "../src/index.ts";
import { readJson, scenarioInput } from "../scripts/scenario-lib.ts";
import { mock } from "./helpers.ts";

const s7 = () => scenarioInput(readJson("fixtures/scenarios/cascade-scenarios.json").scenarios.find((s: { id: string }) => s.id === "S7"));
const run = (inp: ProposeInput, key: keyof typeof POLICIES) =>
  heuristic.assign({ ...inp, previous_assignments: inp.previous?.assignments ?? [] }, POLICIES[key]);
const moves = (inp: ProposeInput) => inp.demands.filter((d): d is MoveGroupDemand => d.kind === "move_group");

test("move-group: 이동 묶음마다 담당은 1명 이하", async () => {
  for (const inp of [s7(), mock.proposeInput("staff-away")])
    for (const key of ["keep_minimal", "fresh", "no_late"] as const) {
      const { assignments } = await run(inp, key);
      for (const d of moves(inp)) assert.ok(new Set(assignments.filter((a) => a.demand_id === d.id).map((a) => a.staff)).size <= 1, d.id);
    }
});

test("second-trip: 다음 교시 첫 10분 안에서만, 늦게 도착 비용이 낮은 묶음부터", async () => {
  const inp = s7();
  const { assignments } = await run(inp, "fresh");
  const trips = assignments.filter((a) => a.mode === "second_trip");
  assert.ok(trips.length > 0, "S7은 두 번째 이동이 있어야 함");
  const byId = new Map(moves(inp).map((d) => [d.id, d]));
  for (const t of trips) {
    const d = byId.get(t.demand_id)!;
    assert.ok(d.second_trip.start <= t.start && t.end <= d.second_trip.end, t.demand_id);
    // 같은 쉬는 시간에 쉬는 시간 안에 간 묶음은 두 번째로 간 묶음보다 비용이 낮지 않다
    const onTime = moves(inp).filter((m) => m.start === d.start && assignments.some((a) => a.demand_id === m.id && a.mode === "normal"));
    for (const m of onTime) assert.ok(m.late_cost >= d.late_cost, `${m.id}(${m.late_cost}) < ${d.id}(${d.late_cost})`);
  }
});

test("second-trip: 늦게 도착 없음 정책은 두 번째 이동을 쓰지 않는다", async () => {
  const { assignments } = await run(s7(), "no_late");
  assert.equal(assignments.filter((a) => a.mode === "second_trip").length, 0);
});

test("edge-release·segment-priority: 체크 안 된 시작 구간을 비우면 waived, 체크된 구간은 변경 최소에서 비우지 않는다", async () => {
  const inp = s7();
  const lessons = new Map(inp.demands.flatMap((d) => (d.kind === "lesson" ? [[d.id, d] as const] : [])));
  for (const key of ["keep_minimal", "fresh"] as const) {
    const { assignments, shortfalls } = await run(inp, key);
    for (const s of shortfalls.filter((x) => x.segment === "start" && lessons.has(x.demand_id))) {
      const trimmed = assignments.some((a) => a.demand_id === s.demand_id && a.start === s.end);
      if (!trimmed) continue;
      assert.equal(s.waived, s.priority === "LOW", `${key} ${s.demand_id}`);
      if (key === "keep_minimal") assert.equal(s.priority, "LOW", `변경 최소가 체크된 시작 구간을 비움: ${s.demand_id}`);
    }
  }
});

test("keep-previous: 이전 담당자가 비어 있으면 그대로 맡는다", async () => {
  const inp = mock.proposeInput("staff-away"); // A01만 10:30–11:30 부재
  const { assignments } = await run(inp, "keep_minimal");
  for (const p of inp.previous!.assignments) {
    if (p.staff === "A01" || p.start >= 620) continue; // 부재 전 칸만 본다
    assert.ok(assignments.some((a) => a.demand_id === p.demand_id && a.staff === p.staff), `${p.demand_id} ${p.staff}`);
  }
});

test("keep-previous: 끄면(fresh) 이전 배정 없이도 같은 결과", async () => {
  const inp = mock.proposeInput("staff-away");
  const a = await run(inp, "fresh");
  const b = await run({ ...inp, previous: null }, "fresh");
  assert.deepEqual(a, b);
});
