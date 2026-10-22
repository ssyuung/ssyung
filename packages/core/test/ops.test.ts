// 변경 요청 반영. 기대값은 9/18 시간표와 배치에서 손으로 계산했다.
// 9/18 층: K1·K2 1층, 3-2 2층, 4-1·4-4·4-7 3층, 5-3·5-5·5-6 4층, L06 3층, L09 5층
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { ChangeOp, Demand, SchoolBundle, Student, Timetable } from "@ssyung/schema";
import { generateDemands } from "../src/index.ts";

const MOCK = join(import.meta.dirname, "..", "..", "..", "fixtures", "mock");
const read = <T>(p: string): T => JSON.parse(readFileSync(join(MOCK, p), "utf8"));
const school = read<SchoolBundle>("domain/school.json");
const students = read<Student[]>("domain/students.json");
const timetable = read<Timetable>("domain/timetable-2026-09.json");
const D = "2026-09-18";

type Opts = { now?: { date: string; minute: number }; school?: SchoolBundle };
const gen = (ops: ChangeOp[], o: Opts = {}) =>
  generateDemands({ school: o.school ?? school, timetable, students, dates: [D], ops, now: o.now });
const run = (ops: ChangeOp[], now?: Opts["now"]) => gen(ops, { now }).demands;
const base = run([]);

/** 기준(ops 없음, 원래 학교)과 비교: 없어진 id, 새로 생기거나 바뀐 수요 */
function diff(ops: ChangeOp[], o: Opts = {}) {
  const got = gen(ops, o).demands;
  const before = new Map(base.map((d) => [d.id, JSON.stringify(d)]));
  const ids = new Set(got.map((d) => d.id));
  return {
    removed: base.filter((d) => !ids.has(d.id)).map((d) => d.id).sort(),
    changed: got.filter((d) => before.get(d.id) !== JSON.stringify(d)).sort((a, b) => a.id.localeCompare(b.id)) as Demand[],
  };
}

const mv = (after: number, ff: number | "OUT", tf: number | "OUT", legs: [string, string, string, 0 | 1 | 2][]): Demand => {
  const start = [580, 630, 680, null, 820][after - 1]!;
  return {
    id: `mv:${D}:b${after}:${ff}-${tf}`, kind: "move_group", date: D, start, end: start + 10, headcount: 1,
    after_period: after, from_floor: ff, to_floor: tf,
    students: legs.map(([student, from, to, late_cost]) => ({ student, from, to, late_cost })),
    late_cost: Math.max(...legs.map((l) => l[3])) as 0 | 1 | 2,
    second_trip: { start: start + 10, end: start + 20 },
  };
};

// ---------- set_placement ----------
test("set_placement: S01 3교시를 특수학급으로 → 이동 묶음이 2교시 뒤에서 3교시 뒤로 옮겨 생긴다", () => {
  // S01(3-2): 1 국어 K1, 2 수학 K1, 3 미술 → K1, 4 미술 3-2. 미술은 지원 과목 아님 → late 0
  const r = diff([{ op: "set_placement", student: "S01", when: { date: D, period: 3 }, placement: "special_class", location: "K1" }]);
  assert.deepEqual(r.removed, [`mv:${D}:b2:1-2`]);
  assert.deepEqual(r.changed, [mv(3, 1, 2, [["S01", "K1", "3-2", 0]])]);
});

test("set_placement: S04 2교시를 특수학급으로 → 1교시 뒤 묶음이 없어지고 2교시 뒤 S02 묶음에 합쳐진다", () => {
  // S04(4-4): 1 국어 K1, 2 과학 → K1, 3 자율 4-4(지원 없음 → late 0). 2교시 과학 수업 지원도 없어짐
  const r = diff([{ op: "set_placement", student: "S04", when: { date: D, period: 2 }, placement: "special_class", location: "K1" }]);
  assert.deepEqual(r.removed, [`les:${D}:S04:p2`, `mv:${D}:b1:1-3`]);
  assert.deepEqual(r.changed, [mv(2, 1, 3, [["S02", "K1", "4-1", 0], ["S04", "K1", "4-4", 0]])]);
});

test("set_placement: S05 1교시를 특수학급으로 → 1교시 뒤 S04 묶음에 합쳐지고 late_cost 2", () => {
  // S05(4-7): 1 영어 → K1, 2 과학 4-7(시작 체크 → late 2)
  const r = diff([{ op: "set_placement", student: "S05", when: { date: D, period: 1 }, placement: "special_class", location: "K1" }]);
  assert.deepEqual(r.removed, [`les:${D}:S05:p1`]);
  assert.deepEqual(r.changed, [mv(1, 1, 3, [["S04", "K1", "4-4", 2], ["S05", "K1", "4-7", 2]])]);
});

test("set_placement: 장소가 없으면 그 시간 과목의 특수학급 장소로", () => {
  // S01 2교시 수학: 원반으로 돌렸다가 장소 없이 다시 특수학급 → 수학 장소 K1, 기준과 같다
  const r = diff([
    { op: "set_placement", student: "S01", when: { date: D, period: 2 }, placement: "homeroom" },
    { op: "set_placement", student: "S01", when: { date: D, period: 2 }, placement: "special_class" },
  ]);
  assert.deepEqual(r, { removed: [], changed: [] });
});

// ---------- 특수학급 장소 미정 (D25) ----------
// 9/18(금) 특수학급 시간표: K1 1교시 국어·2교시 수학·5교시 수학, K2 3·4교시 국어·6교시 수학
test("장소 미정(none): 그 시각 그 과목을 하는 특수학급이 없으면 unplaced, 앞 이동도 없다", () => {
  // S01 3교시 미술을 장소 없이 특수학급으로 → 금 3교시 미술 하는 특수학급 없음. 2교시 뒤 이동(K1→3-2)도 없어짐
  const ops: ChangeOp[] = [{ op: "set_placement", student: "S01", when: { date: D, period: 3 }, placement: "special_class" }];
  assert.deepEqual(diff(ops), { removed: [`mv:${D}:b2:1-2`], changed: [] });
  assert.deepEqual(gen(ops).unplaced, [{ date: D, student: "S01", period: 3, subject: "미술", reason: "none" }]);
});

// K2도 금 1교시에 국어를 하면 국어를 특수학급에서 듣는 학생은 둘 이상(multiple)
const twoKorean: SchoolBundle = {
  ...school,
  special_classes: school.special_classes.map((k) =>
    k.code === "K2" ? { ...k, lessons: [...k.lessons, { day: "FRI", start: 540, end: 580, subject: "국어" }] } : k),
};

test("장소 미정(multiple): 둘 이상이면 unplaced, 뒤 이동도 없다", () => {
  // 1교시 국어: S01(3-2)·S02(4-1)·S03(5-3)·S04(4-4). S03·S04의 1교시 뒤 이동이 없어짐
  const r = gen([], { school: twoKorean });
  assert.deepEqual(r.unplaced, ["S01", "S02", "S03", "S04"].map((student) =>
    ({ date: D, student, period: 1, subject: "국어", reason: "multiple" })));
  assert.deepEqual(diff([], { school: twoKorean }), { removed: [`mv:${D}:b1:1-3`, `mv:${D}:b1:1-4`], changed: [] });
});

test("장소 미정: set_placement로 장소를 지정하면 풀린다", () => {
  // S03 1교시 국어를 K2로 → K2→5-3 이동이 다시 생김(2교시 과학 시작 미체크 → late 0)
  const ops: ChangeOp[] = [{ op: "set_placement", student: "S03", when: { date: D, period: 1 }, placement: "special_class", location: "K2" }];
  const r = gen(ops, { school: twoKorean });
  assert.deepEqual(r.unplaced.map((u) => u.student), ["S01", "S02", "S04"]);
  assert.deepEqual(r.demands.find((d) => d.id === `mv:${D}:b1:1-4`), mv(1, 1, 4, [["S03", "K2", "5-3", 0]]));
});

test("set_placement: 장소를 지정하면 그 장소, 요일 지정은 그 요일 날짜에 적용", () => {
  // S03 1교시 국어를 K1 대신 L09(5층)로 → 1교시 뒤 출발 층이 5층으로 바뀜
  const r = diff([{ op: "set_placement", student: "S03", when: { day: "FRI", period: 1 }, placement: "special_class", location: "L09" }]);
  assert.deepEqual(r.removed, [`mv:${D}:b1:1-4`]);
  assert.deepEqual(r.changed, [mv(1, 5, 4, [["S03", "L09", "5-3", 0]])]);
});

// ---------- relocate_class ----------
test("relocate_class: 3-2 3교시를 L06으로 → S02 묶음에 합쳐지고, 3교시 뒤 묶음이 생긴다", () => {
  // S01: 2 수학 K1 → 3 미술 L06(3층) → 4 미술 3-2(2층)
  const r = diff([{ op: "relocate_class", class_group: "3-2", when: { date: D, period: 3 }, location: "L06" }]);
  assert.deepEqual(r.removed, [`mv:${D}:b2:1-2`]);
  assert.deepEqual(r.changed, [
    mv(2, 1, 3, [["S01", "K1", "L06", 0], ["S02", "K1", "4-1", 0]]),
    mv(3, 3, 2, [["S01", "L06", "3-2", 0]]),
  ]);
});

test("relocate_class: 5-3 2교시를 L09로 → 수업 장소와 이동 묶음이 바뀌고 S06과 갈라진다", () => {
  // S03: 1 국어 K1 → 2 과학 L09(5층) → 3 국어 K2. S06은 그대로 4층→1층
  const r = diff([{ op: "relocate_class", class_group: "5-3", when: { date: D, period: 2 }, location: "L09" }]);
  assert.deepEqual(r.removed, [`mv:${D}:b1:1-4`]);
  const lesson = base.find((d) => d.id === `les:${D}:S03:p2`)!;
  assert.deepEqual(r.changed, [
    { ...lesson, location: "L09", floor: 5 },
    mv(1, 1, 5, [["S03", "K1", "L09", 0]]),
    mv(2, 4, 1, [["S06", "5-5", "K2", 1]]),
    mv(2, 5, 1, [["S03", "L09", "K2", 1]]),
  ]);
});

test("relocate_class: 특수학급에 있는 학생은 영향 없음", () => {
  // 3-2 2교시(수학)는 S01이 K1에서 듣는다
  const r = diff([{ op: "relocate_class", class_group: "3-2", when: { date: D, period: 2 }, location: "L06" }]);
  assert.deepEqual(r, { removed: [], changed: [] });
});

// ---------- set_support ----------
test("set_support: 쉬는 시간 추가 수요가 생기고, 이동 묶음은 그대로", () => {
  const r = diff([{ op: "set_support", student: "S05", when: { date: D, kind: "break", after_period: 2 }, headcount: 1 }]);
  assert.deepEqual(r.removed, []);
  assert.deepEqual(r.changed, [
    { id: `req:${D}:S05:630`, kind: "requirement", date: D, start: 630, end: 640, headcount: 1, student: "S05" },
  ]);
});

test("set_support: 교시·시각 지정, 같은 칸은 뒤의 op가 이기고 0이면 해제", () => {
  const r = diff([
    { op: "set_support", student: "S01", when: { date: D, period: 1 }, headcount: 1 },
    { op: "set_support", student: "S01", when: { date: D, period: 1 }, headcount: 2 },
    { op: "set_support", student: "S02", when: { date: D, start: "12:10", end: "13:00" }, headcount: 1 },
    { op: "set_support", student: "S07", when: { date: D, kind: "lunch" }, headcount: 1 },
    { op: "set_support", student: "S07", when: { date: D, kind: "lunch" }, headcount: 0 },
  ]);
  assert.deepEqual(r.removed, []);
  assert.deepEqual(r.changed, [
    { id: `req:${D}:S01:540`, kind: "requirement", date: D, start: 540, end: 580, headcount: 2, student: "S01" },
    { id: `req:${D}:S02:730`, kind: "requirement", date: D, start: 730, end: 780, headcount: 1, student: "S02" },
  ]);
});

test("set_support: 결석한 학생의 추가 수요는 빠진다", () => {
  const r = diff([
    { op: "set_support", student: "S05", when: { date: D, kind: "break", after_period: 2 }, headcount: 1 },
    { op: "mark_absent", student: "S05", when: { date: D } },
  ]);
  assert.deepEqual(r.removed, [`les:${D}:S05:p1`, `les:${D}:S05:p2`]);
  assert.deepEqual(r.changed, []);
});

test("set_support: 하루 전체는 등교 시작(08:40)부터 하교 끝(14:50)까지", () => {
  const got = run([{ op: "set_support", student: "S05", when: { date: D }, headcount: 1 }]).filter((d) => d.kind === "requirement");
  assert.deepEqual(got, [{ id: `req:${D}:S05:520`, kind: "requirement", date: D, start: 520, end: 890, headcount: 1, student: "S05" }]);
});

test("set_support: 일과 중(10:15)에 하루 전체를 요청하면 10:20부터", () => {
  const ops: ChangeOp[] = [{ op: "set_support", student: "S05", when: { date: D }, headcount: 1 }];
  const got = run(ops, { date: D, minute: 615 }).filter((d) => d.kind === "requirement");
  assert.deepEqual(got, [{ id: `req:${D}:S05:620`, kind: "requirement", date: D, start: 620, end: 890, headcount: 1, student: "S05" }]);
  // 다른 날 시각이면 영향 없음, 하교 뒤면 수요 없음
  assert.equal(run(ops, { date: "2026-09-17", minute: 615 }).filter((d) => d.kind === "requirement")[0]!.start, 520);
  assert.equal(run(ops, { date: D, minute: 900 }).filter((d) => d.kind === "requirement").length, 0);
});

// ---------- set_support + 버전에 저장된 추가 수요 ----------
const req = (start: number, end: number, headcount: number): Demand =>
  ({ id: `req:${D}:S05:${start}`, kind: "requirement", date: D, start, end, headcount, student: "S05" });
const stored = [req(520, 890, 1), { ...req(540, 580, 1), date: "2026-09-17", id: "req:2026-09-17:S05:540" }] as Extract<Demand, { kind: "requirement" }>[];
const reqs = (ops: ChangeOp[]) =>
  generateDemands({ school, timetable, students, dates: [D], ops, requirements: stored }).demands.filter((d) => d.kind === "requirement");

test("저장된 추가 수요: op가 없으면 그대로, 범위 밖 날짜는 뺀다", () => {
  assert.deepEqual(reqs([]), [req(520, 890, 1)]);
});

test("저장된 추가 수요: 3교시(10:40–11:20)만 0명 → 두 개로 나뉜다", () => {
  assert.deepEqual(reqs([{ op: "set_support", student: "S05", when: { date: D, period: 3 }, headcount: 0 }]), [
    req(520, 640, 1), req(680, 890, 1),
  ]);
});

test("저장된 추가 수요: 3교시만 2명 → 세 개, 가운데만 2명", () => {
  assert.deepEqual(reqs([{ op: "set_support", student: "S05", when: { date: D, period: 3 }, headcount: 2 }]), [
    req(520, 640, 1), req(640, 680, 2), req(680, 890, 1),
  ]);
});

test("저장된 추가 수요: 하루 전체 0명 → 없어진다", () => {
  assert.deepEqual(reqs([{ op: "set_support", student: "S05", when: { date: D }, headcount: 0 }]), []);
});

test("저장된 추가 수요: 3교시 결석이면 그 구간만 잘라 낸다", () => {
  assert.deepEqual(reqs([{ op: "mark_absent", student: "S05", when: { date: D, period: 3 } }]), [
    req(520, 640, 1), req(680, 890, 1),
  ]);
});

// ---------- 오늘 변경: now 이후에 시작하는 칸만 (D24) ----------
// 9/18 S03: 1교시 뒤 이동 09:40, 2교시 과학 09:50, 2교시 뒤 이동 10:30, 3교시 뒤 이동 11:20, 4교시 11:30, 5교시 13:00, 5교시 뒤 이동 13:40
const absentS03: ChangeOp[] = [{ op: "mark_absent", student: "S03", when: { date: D } }];
const s03Gone = [
  mv(2, 4, 1, [["S06", "5-5", "K2", 1]]),
  mv(3, 1, 4, [["S06", "K2", "5-5", 0]]),
  mv(5, 4, 1, [["S07", "5-6", "K2", 1]]),
];

test("오늘 변경: 10:15 결석 → 10:20부터. 진행 중인 2교시와 그 전 칸은 그대로", () => {
  const r = diff(absentS03, { now: { date: D, minute: 615 } });
  assert.deepEqual(r.removed, [`les:${D}:S03:p4`, `les:${D}:S03:p5`]);
  assert.deepEqual(r.changed, s03Gone);
  assert.deepEqual(gen(absentS03, { now: { date: D, minute: 615 } }).absent, [{ date: D, student: "S03" }]);
});

test("오늘 변경: 교시 시작 정각(09:50)이면 그 교시부터 바뀐다", () => {
  const r = diff(absentS03, { now: { date: D, minute: 590 } });
  assert.deepEqual(r.removed, [`les:${D}:S03:p2`, `les:${D}:S03:p4`, `les:${D}:S03:p5`]);
  assert.deepEqual(r.changed, s03Gone);
  // 09:51 → 10:00이면 2교시는 진행 중이라 그대로
  assert.deepEqual(diff(absentS03, { now: { date: D, minute: 591 } }).removed, [`les:${D}:S03:p4`, `les:${D}:S03:p5`]);
});

test("오늘 변경: 다른 날짜의 now는 영향 없음(하루 전체 적용)", () => {
  assert.deepEqual(diff(absentS03, { now: { date: "2026-09-17", minute: 615 } }), diff(absentS03));
  assert.ok(diff(absentS03).removed.includes(`mv:${D}:b1:1-4`));
});

test("오늘 변경: set_placement는 진행 중인 쉬는 시간 이동을 바꾸지 않는다", () => {
  // 09:45 요청 → 09:50부터. S04 2교시 → K1: 1교시 뒤 이동(09:40)은 그대로, 2교시 수업 지원은 없어지고 2교시 뒤 S02 묶음에 합쳐짐
  const ops: ChangeOp[] = [{ op: "set_placement", student: "S04", when: { date: D, period: 2 }, placement: "special_class", location: "K1" }];
  const r = diff(ops, { now: { date: D, minute: 585 } });
  assert.deepEqual(r.removed, [`les:${D}:S04:p2`]);
  assert.deepEqual(r.changed, [mv(2, 1, 3, [["S02", "K1", "4-1", 0], ["S04", "K1", "4-4", 0]])]);
});

test("오늘 변경: relocate_class는 now 뒤의 이동에만", () => {
  // 10:35 요청 → 10:40부터. 3-2 3교시 L06: 2교시 뒤 이동(10:30, K1→3-2)은 그대로, 3교시 뒤 L06→3-2만 생김
  const r = diff([{ op: "relocate_class", class_group: "3-2", when: { date: D, period: 3 }, location: "L06" }], { now: { date: D, minute: 635 } });
  assert.deepEqual(r, { removed: [], changed: [mv(3, 3, 2, [["S01", "L06", "3-2", 0]])] });
});

test("오늘 변경: now 전에 시작한 저장된 추가 수요는 자르지 않고, 새 구간은 now부터", () => {
  const now = { date: D, minute: 615 };
  const got = (ops: ChangeOp[]) =>
    generateDemands({ school, timetable, students, dates: [D], ops, now, requirements: stored }).demands.filter((d) => d.kind === "requirement");
  assert.deepEqual(got([{ op: "set_support", student: "S05", when: { date: D, period: 3 }, headcount: 0 }]), [req(520, 890, 1)]);
  assert.deepEqual(got([{ op: "set_support", student: "S05", when: { date: D, period: 2 }, headcount: 0 }]), [req(520, 890, 1)]);
  assert.deepEqual(got([{ op: "mark_absent", student: "S05", when: { date: D } }]), [req(520, 890, 1)]);
  // 진행 중인 2교시(09:50–10:30)에 새로 추가 → 10:20–10:30
  assert.deepEqual(got([{ op: "set_support", student: "S01", when: { date: D, period: 2 }, headcount: 1 }]).filter((d) => d.student === "S01"), [
    { id: `req:${D}:S01:620`, kind: "requirement", date: D, start: 620, end: 630, headcount: 1, student: "S01" },
  ]);
});

// ---------- 그 밖 ----------
test("점심을 사이에 둔 이동(4→5교시)은 수요가 없다", () => {
  // S04: 4 자율 4-4 → 5 수학 K1. 점심 뒤라 이동 묶음 없음
  assert.equal(base.filter((d) => d.kind === "move_group" && d.after_period === 4).length, 0);
});

test("범위 밖 날짜의 op와 수요에 영향 없는 op는 무시한다", () => {
  const r = diff([
    { op: "mark_absent", student: "S03", when: { date: "2026-09-17" } },
    { op: "staff_unavailable", staff: "A01", when: { date: D } },
  ]);
  assert.deepEqual(r, { removed: [], changed: [] });
});
