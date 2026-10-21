// 목데이터 대조: 같은 입력이면 fixtures/mock/demand와 값까지 같아야 한다.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Demand, DemandSet, SchoolBundle, Student, Timetable } from "@ssyung/schema";
import { DemandSet as DemandSetSchema } from "@ssyung/schema";
import { generateDemands } from "../src/index.ts";

const MOCK = join(import.meta.dirname, "..", "..", "..", "fixtures", "mock");
const read = <T>(p: string): T => JSON.parse(readFileSync(join(MOCK, p), "utf8"));
const school = read<SchoolBundle>("domain/school.json");
const students = read<Student[]>("domain/students.json");
const timetable = read<Timetable>("domain/timetable-2026-09.json");
const SEPT = Array.from({ length: 30 }, (_, i) => `2026-09-${String(i + 1).padStart(2, "0")}`);
const byId = (ds: Demand[]) => [...ds].sort((a, b) => a.id.localeCompare(b.id));

test("9월 전체가 demand/2026-09.json과 같다", () => {
  const expected = read<DemandSet>("demand/2026-09.json");
  const got = generateDemands({ school, timetable, students, dates: SEPT, version_id: "ver_0901" });
  DemandSetSchema.parse(got);
  assert.deepEqual({ ...got, demands: byId(got.demands) }, { ...expected, demands: byId(expected.demands) });
});

test("9/18 하루가 demand/2026-09-18.json과 같다", () => {
  const expected = read<DemandSet>("demand/2026-09-18.json");
  const got = generateDemands({ school, timetable, students, dates: ["2026-09-18"], version_id: "ver_0901" });
  assert.deepEqual(byId(got.demands), byId(expected.demands));
});

test("mark_absent S03 9/18 → propose.absent.input의 demands와 같다", () => {
  const expected = read<{ demands: Demand[] }>("scheduler/propose.absent.input.json");
  const got = generateDemands({
    school, timetable, students, dates: ["2026-09-18"],
    ops: [{ op: "mark_absent", student: "S03", when: { date: "2026-09-18" } }],
  });
  assert.deepEqual(byId(got.demands), byId(expected.demands));
  assert.deepEqual(got.absent, [{ date: "2026-09-18", student: "S03" }]);
});

test("휴일(9/24·25)에는 수요가 없다", () => {
  const got = generateDemands({ school, timetable, students, dates: ["2026-09-24", "2026-09-25"] });
  assert.deepEqual(got.demands, []);
});

test("시간표 없는 반(1-3) 학생은 수요가 없다", () => {
  const s = { ...students[0]!, class_group: "1-3" };
  const got = generateDemands({ school, timetable, students: [s], dates: SEPT });
  assert.deepEqual(got.demands, []);
});

test("특수학급 과목만 있는 날에는 수요가 없다", () => {
  // 3-2의 9/18 과목을 모두 K1에서 들으면 수업 지원도 이동도 없다
  const subjects = [...new Set(timetable.lessons.filter((l) => l.class_group === "3-2" && l.date === "2026-09-18").map((l) => l.subject))];
  const s = { ...students[0]!, special_class_subjects: subjects.map((subject) => ({ subject, location: "K1" })) };
  const got = generateDemands({ school, timetable, students: [s], dates: ["2026-09-18"] });
  assert.deepEqual(got.demands, []);
});
