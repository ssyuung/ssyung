// 흐름 테스트 (실제 엔진): 9/18 하루 화면, 지원인력1 출장 → 해석 → 선택지 → 승인.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import type { Assignment, ProposeInput } from "@ssyung/schema";
import { errorCode, mockApi, readJson, setup } from "./helpers.ts";

const DATE = "2026-09-18";
const sortAsg = (list: Assignment[]) =>
  [...list].sort((a, b) => a.start - b.start || a.staff.localeCompare(b.staff) || a.demand_id.localeCompare(b.demand_id));

let env: Awaited<ReturnType<typeof setup>>;
let proposeInput: ProposeInput | null = null;
before(async () => {
  env = await setup();
  // 엔진에 넘긴 입력을 기록한다 (목데이터 입력과 비교)
  const real = env.deps.engine.propose;
  env.deps.engine.propose = (input, engine) => {
    proposeInput = input;
    return real(input, engine);
  };
});
after(() => env.cleanup());

test("view.day 9/18의 수요·배정이 목데이터 예시와 같다", async () => {
  const expected = mockApi("view.day").examples[0].output;
  const day = await env.call("T01", "view.day", { date: DATE });
  assert.equal(day.version.id, expected.version.id);
  assert.deepEqual(day.demands, expected.demands);
  assert.deepEqual(sortAsg(day.assignments), sortAsg(expected.assignments));
  assert.deepEqual(day.shortfalls, expected.shortfalls);
  assert.deepEqual(day.students, expected.students);
  assert.deepEqual(day.staff, expected.staff);
});

test("지원인력1 출장: 해석 → 선택지 → 승인 → 하루 화면", async () => {
  const raw = "지원인력1 10시 30분부터 11시 30분까지 출장";
  const cr = await env.call("T01", "change.interpret", { raw_text: raw, today: DATE });
  assert.equal(cr.status, "parsed");
  assert.deepEqual(cr.summary, ["지원인력1 · 9월 18일(금) 10:30–11:30 부재"]);

  const proposal = await env.call("T01", "change.confirm", { change_request_id: cr.id, ops: cr.parsed });
  const expected = readJson("fixtures/mock/scheduler/propose.staff-away.output.json");
  const expectedIn = readJson("fixtures/mock/scheduler/propose.staff-away.input.json");

  // 같은 입력: 수요·근무·이전 배정·정책. now는 오늘이라 요청 시각(10:15 → 10:20)
  assert.ok(proposeInput);
  assert.deepEqual(proposeInput.demands, expectedIn.demands);
  assert.deepEqual(proposeInput.staff, expectedIn.staff);
  assert.deepEqual(proposeInput.previous, expectedIn.previous);
  assert.deepEqual(proposeInput.policies, expectedIn.policies);
  assert.deepEqual(proposeInput.now, { date: DATE, minute: 620 });

  // 같은 결과: 선택지 수, 정책, 지표
  const pick = (o: any) => ({
    key: o.key, policies: o.policies, changed: o.metrics.changed_cells, gaps: o.metrics.gaps, late: o.metrics.late_students,
  });
  assert.deepEqual(proposal.options.map(pick), expected.options.map(pick));

  const approved = await env.call("T01", "proposal.approve", { proposal_id: proposal.id, option_key: "A" });
  assert.equal(approved.version.status, "active");
  assert.equal(approved.version.parent_id, "ver_0901");
  assert.deepEqual(approved.notified, proposal.options[0].metrics.notify_staff);

  const day = await env.call("T01", "view.day", { date: DATE });
  assert.equal(day.version.id, approved.version.id);
  assert.deepEqual(sortAsg(day.assignments), sortAsg(proposal.options[0].assignments));
  assert.deepEqual(day.staff.find((s: any) => s.code === "A01").absent, [{ start: 630, end: 690 }]);

  // 알림은 메모리에 기록되고 지원인력 앱에 미확인으로 뜬다
  assert.deepEqual(env.deps.notifier.sent.map((n) => n.staff), approved.notified);
  const today = await env.call("A02", "view.staffToday", { date: DATE });
  assert.equal(today.unacked.length, 1);
  assert.equal(today.unacked[0].version_id, approved.version.id);

  assert.equal(await errorCode(env.call("T01", "proposal.approve", { proposal_id: proposal.id, option_key: "A" })), "BASE_VERSION_CHANGED");
});

/** 학생 행과 이동 묶음이 같은 정보를 본다: 이동하는 학생의 출발·도착 장소 = 그 교시 행의 장소 */
function assertRowsMatchMoves(day: any) {
  const loc = (student: string, period: number) =>
    day.students.find((s: any) => s.code === student).lessons.find((l: any) => l.period === period)?.location;
  for (const d of day.demands.filter((x: any) => x.kind === "move_group")) {
    for (const leg of d.students) {
      assert.equal(loc(leg.student, d.after_period), leg.from, `${d.id} ${leg.student} 출발`);
      assert.equal(loc(leg.student, d.after_period + 1), leg.to, `${d.id} ${leg.student} 도착`);
    }
  }
}

test("장소 변경을 승인하면 학생 행과 수요가 같이 바뀐다", async () => {
  const before = await env.call("T01", "view.day", { date: DATE });
  assertRowsMatchMoves(before);
  const p3 = (day: any) => day.students.find((s: any) => s.code === "S01").lessons.find((l: any) => l.period === 3);
  assert.deepEqual(p3(before), { period: 3, subject: "미술", placement: "homeroom", location: "3-2" });

  const cr = await env.call("T01", "change.interpret", { raw_text: "학생1 3교시 미술은 K1에서", today: DATE });
  assert.deepEqual(cr.summary, ["학생1 · 9월 18일(금) 3교시 특수학급 K1에서 수업"]);
  const proposal = await env.call("T01", "change.confirm", { change_request_id: cr.id, ops: cr.parsed });
  await env.call("T01", "proposal.approve", { proposal_id: proposal.id, option_key: proposal.recommended });

  const after = await env.call("T01", "view.day", { date: DATE });
  assert.deepEqual(p3(after), { period: 3, subject: "미술", placement: "special_class", location: "K1" });
  assertRowsMatchMoves(after);
  // 앞서 승인한 출장도 그대로 남는다
  assert.deepEqual(after.staff.find((s: any) => s.code === "A01").absent, [{ start: 630, end: 690 }]);
});

test("draft를 활성화하면 그 기간만 바뀌고 나머지 날짜 배정은 그대로", async () => {
  const e = await setup();
  try {
    const before21 = await e.call("T01", "view.day", { date: "2026-09-21" });
    const { version, option } = await e.call("T01", "schedule.generate", { date_from: "2026-09-14", date_to: "2026-09-18" });
    const out = await e.call("T01", "schedule.activate", { version_id: version.id });
    assert.equal(out.version.status, "active");
    assert.equal(out.version.date_from, "2026-09-01");
    assert.equal(out.version.date_to, "2026-12-31");

    const d15 = await e.call("T01", "view.day", { date: "2026-09-15" });
    assert.equal(d15.version.id, version.id);
    assert.deepEqual(sortAsg(d15.assignments), sortAsg(option.assignments.filter((a: any) => a.date === "2026-09-15")));
    const d21 = await e.call("T01", "view.day", { date: "2026-09-21" });
    assert.equal(d21.version.id, version.id);
    assert.deepEqual(sortAsg(d21.assignments), sortAsg(before21.assignments));
  } finally {
    await e.cleanup();
  }
});
