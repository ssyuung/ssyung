import { test } from "node:test";
import assert from "node:assert/strict";
import { ValidateOutput } from "@ssyung/schema";
import { validate } from "../src/index.ts";
import { assertSchema, mock, PROPOSE_CASES } from "./helpers.ts";

const key = (v: ValidateOutput["violations"][number]) => `${v.code}|${v.staff}|${[...v.demand_ids].sort()}|${v.date}|${v.start}|${v.end}`;

test("validate.overlap: OVERLAP과 MOVE_GROUP_HEADCOUNT가 목데이터와 같다", () => {
  const out = validate(mock.validateInput("overlap"));
  assertSchema(ValidateOutput, out, "validate 출력");
  const exp = mock.validateOutput("overlap");
  assert.deepEqual(out.violations.map(key).sort(), exp.violations.map(key).sort());
  assert.deepEqual(out.shortfalls, exp.shortfalls);
});

test("이전 배정(시안 엔진 결과)은 위반이 없다", () => {
  for (const name of PROPOSE_CASES) {
    const inp = mock.proposeInput(name);
    const out = validate({ demands: inp.previous!.demands, staff: inp.staff.map((w) => ({ ...w, absent: [] })), pinned: [], assignments: inp.previous!.assignments });
    assert.deepEqual(out.violations, [], name);
  }
});

test("근무 밖·부재·고정 해제·모르는 수요·두 번째 이동 구간을 잡는다", () => {
  const inp = mock.proposeInput("staff-away"); // A01 10:30–11:30 부재
  const prev = inp.previous!.assignments;
  const mv = prev.find((a) => a.demand_id.startsWith("mv:") && a.staff === "A01" && a.start >= 630 && a.end <= 690)!;
  const base = { demands: inp.demands, staff: inp.staff };
  const codes = (asg: typeof prev, pinned: typeof prev = []) => validate({ ...base, pinned, assignments: asg }).violations.map((v) => v.code);

  assert.ok(codes([mv]).includes("ABSENT"));
  assert.ok(codes([{ ...mv, staff: "A02", start: 1000, end: 1010 }]).includes("OUTSIDE_AVAILABILITY"));
  assert.ok(codes([{ ...mv, staff: "A02", start: mv.end + 10, end: mv.end + 20, mode: "second_trip" }]).includes("SECOND_TRIP_WINDOW"));
  assert.ok(codes([{ ...mv, demand_id: "mv:2026-09-18:b9:1-1" }]).includes("UNKNOWN_DEMAND"));
  assert.ok(codes([], [{ ...mv, staff: "A02", pinned: true }]).includes("PINNED_CHANGED"));
});

test("이동 묶음에 아무도 없으면 위반이 아니라 부족분이다", () => {
  const inp = mock.proposeInput("staff-away");
  const mv = inp.demands.find((d) => d.kind === "move_group")!;
  const out = validate({ demands: [mv], staff: inp.staff, pinned: [], assignments: [] });
  assert.deepEqual(out.violations, []);
  assert.equal(out.shortfalls.length, 1);
  assert.equal(out.shortfalls[0].priority, "MOVE");
});
