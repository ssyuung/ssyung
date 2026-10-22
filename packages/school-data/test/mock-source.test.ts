import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { ClassGroup, Timetable } from "@ssyung/schema";
import { MockSource, NeisSource, SourceError, type SchoolRef } from "../src/index.ts";

const mock = async (rel: string) =>
  JSON.parse(await readFile(new URL(`../../../fixtures/mock/${rel}`, import.meta.url), "utf8"));

const src = new MockSource();
const [gaepo] = await src.searchSchools("개포초");
const isCode = (code: string) => (e: unknown) => e instanceof SourceError && e.code === code;

test("학교 검색: 서울개포초 하나", async () => {
  assert.equal(gaepo?.neis_school_code, "7091371");
  assert.deepEqual(await src.searchSchools("없는학교"), []);
});

test("학급: school.json의 class_groups와 같고 1-3은 시간표 없음", async () => {
  const groups = await src.getClassGroups(gaepo!, 2026);
  ClassGroup.array().parse(groups);
  assert.deepEqual(groups, (await mock("domain/school.json")).class_groups);
  assert.equal(groups.length, 39);
  assert.equal(groups.find((g) => g.code === "1-3")?.has_timetable, false);
});

test("시간표 9월: timetable-2026-09.json과 같음", async () => {
  const tt = await src.getTimetable(gaepo!, "2026-09-01", "2026-09-30");
  Timetable.parse(tt);
  assert.deepEqual(tt, await mock("domain/timetable-2026-09.json"));
});

test("시간표 기간 지정: 그 주만", async () => {
  const tt = await src.getTimetable(gaepo!, "2026-09-14", "2026-09-18");
  assert.deepEqual(tt.school_days, ["2026-09-14", "2026-09-15", "2026-09-16", "2026-09-17", "2026-09-18"]);
  assert.ok(tt.lessons.length > 0);
  assert.ok(tt.lessons.every((l) => l.date >= "2026-09-14" && l.date <= "2026-09-18"));
});

test("목데이터 밖 기간·학년도·학교는 오류", async () => {
  await assert.rejects(src.getTimetable(gaepo!, "2026-09-28", "2026-10-02"), isCode("NOT_IMPLEMENTED"));
  await assert.rejects(src.getTimetable(gaepo!, "2026-09-10", "2026-09-01"), isCode("VALIDATION"));
  await assert.rejects(src.getClassGroups(gaepo!, 2025), isCode("NOT_FOUND"));
  const other: SchoolRef = { ...gaepo!, neis_school_code: "0000000" };
  await assert.rejects(src.getClassGroups(other, 2026), isCode("NOT_FOUND"));
});

test("NeisSource는 아직 NOT_IMPLEMENTED", async () => {
  const neis = new NeisSource();
  await assert.rejects(neis.searchSchools("개포초"), isCode("NOT_IMPLEMENTED"));
  await assert.rejects(neis.getTimetable(gaepo!, "2026-09-01", "2026-09-30"), isCode("NOT_IMPLEMENTED"));
});
