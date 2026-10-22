import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { ChangeOps, ChangeRequestSet, InterpretContext } from "@ssyung/schema";
import { checkOps, Extraction, resolve, sameOps } from "../src/index.ts";
import { change, EXTRACTIONS, item, today } from "./extractions.ts";

const fixture = async (rel: string) => JSON.parse(await readFile(new URL(`../../../fixtures/${rel}`, import.meta.url), "utf8"));
const context = InterpretContext.parse(await fixture("mock/interpreter/context-2026-09-18.json"));
const { cases } = ChangeRequestSet.parse(await fixture("change-requests/cases.json"));

test("평가 세트 22건: 맞는 추출값이면 기대 ChangeOps와 confidence가 나온다", () => {
  assert.equal(Object.keys(EXTRACTIONS).length, cases.length);
  for (const c of cases) {
    const ex = Extraction.parse(EXTRACTIONS[c.id]);
    const r = resolve(ex, context);
    ChangeOps.parse(r.result);
    assert.deepEqual(checkOps(r.result, context), [], c.id);
    assert.ok(sameOps(r.result, c.expected), `${c.id}\n기대 ${JSON.stringify(c.expected)}\n결과 ${JSON.stringify(r.result)}`);
    assert.equal(r.result.confidence, c.expected.confidence, c.id);
  }
});

test("수업일이 아니면 다음 수업일을 알려 주고 재시도하지 않는다 (CR19)", () => {
  const r = resolve(EXTRACTIONS.CR19!, context);
  assert.equal(r.ok, false);
  assert.ok(!r.ok && !r.retry);
  assert.equal(r.result.unsupported, "9월 19일(토)은 수업일이 아니에요. 다음 수업일(9월 21일 월)인지 확인해 주세요");
});

test("코드로 써도 된다, 장소는 라벨로도 찾는다", () => {
  const r = resolve(change([item("placement", { who: "S06", place: "특수학급 K2", times: [{ type: "period", n: 4 }] })]), context);
  assert.deepEqual(r.result.ops, [{ op: "set_placement", student: "S06", when: { date: "2026-09-18", period: 4 }, placement: "special_class", location: "K2" }]);
  const home = resolve(change([item("placement", { who: "학생6", place: "원반", times: [{ type: "period", n: 4 }] })]), context);
  assert.equal(home.result.ops[0]!.op === "set_placement" && home.result.ops[0]!.placement, "homeroom");
});

test("다른 반 같은 별칭: 반이 있으면 구분, 없으면 후보를 알려 주고 재시도하지 않는다", () => {
  const ctx = { ...context, codes: { ...context.codes, students: [...context.codes.students, { code: "S08", label: "학생1", class_group: "4-1" }] } };
  const withClass = resolve(change([item("absent", { who: "학생1", who_class: "4-1", days: [today] })]), ctx);
  assert.deepEqual(withClass.result.ops, [{ op: "mark_absent", student: "S08", when: { date: "2026-09-18" } }]);
  const without = resolve(change([item("absent", { who: "학생1", days: [today] })]), ctx);
  assert.ok(!without.ok && !without.retry);
  assert.equal(without.result.unsupported, "학생1이 2명이에요: S01(3-2반), S08(4-1반). 반이나 코드로 써 주세요");
});

test("모델이 값을 잘못 뽑았을 수 있는 실패는 재시도 대상", () => {
  const retryable: Extraction[] = [
    change([item("absent", { who: "학생9", days: [today] })]),
    change([item("placement", { who: "학생6", place: "K2", times: [{ type: "subject", name: "음악" }] })]),
    change([item("placement", { who: "학생6", place: "옥상", times: [{ type: "period", n: 1 }] })]),
    change([item("staff_away", { who: "지원인력1", times: [{ type: "period", n: 9 }] })]),
    change([]),
  ];
  for (const ex of retryable) {
    const r = resolve(ex, context);
    assert.ok(!r.ok && r.retry, JSON.stringify(ex.items));
    assert.equal(r.result.confidence, "low");
    assert.deepEqual(r.result.ops, []);
  }
});

test("교시와 과목을 함께 쓰면 과목은 거르는 조건 (CR04·CR08 eval 실패)", () => {
  const r = resolve(change([item("placement", { who: "학생1", place: "K1", times: [{ type: "period", n: 3 }, { type: "subject", name: "미술" }] })]), context);
  assert.deepEqual(r.result.ops, [{ op: "set_placement", student: "S01", when: { date: "2026-09-18", period: 3 }, placement: "special_class", location: "K1" }]);
  assert.equal(r.result.confidence, "high");
  const wrong = resolve(change([item("placement", { who: "학생1", place: "K1", times: [{ type: "period", n: 1 }, { type: "subject", name: "미술" }] })]), context);
  assert.ok(!wrong.ok);
  assert.deepEqual(wrong.result.ops, []);
});

test("과목이 하루에 두 번이면 둘 다, confidence medium", () => {
  const r = resolve(change([item("placement", { who: "학생1", place: "K1", times: [{ type: "subject", name: "미술 시간" }] })]), context);
  assert.deepEqual(r.result.ops[0]!.when, [{ date: "2026-09-18", period: 3 }, { date: "2026-09-18", period: 4 }]);
  assert.equal(r.result.confidence, "medium");
});

test("매주 규칙과 이번 주 변경이 섞이면 나눠 달라고 한다", () => {
  const r = resolve(change([
    item("absent", { who: "학생3", days: [today] }),
    item("placement", { who: "학생5", place: "K1", days: [{ type: "weekday", week: "unspecified", day: "MON" }], times: [{ type: "period", n: 1 }], repeat: true }),
  ]), context);
  assert.ok(!r.ok && !r.retry);
});

test("끝 시각이 없으면 하루 끝까지, 10분 경계가 아니면 넓혀서 medium", () => {
  const r = resolve(change([item("staff_away", { who: "지원인력1", times: [{ type: "clock", start: "14:05", end: null }] })]), context);
  assert.deepEqual(r.result.ops[0]!.when, { date: "2026-09-18", start: "14:00", end: "16:40" });
  assert.equal(r.result.confidence, "medium");
});
