// 배치 경고, 권한, 커밋된 dataset/db/ 보호.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { weekdayOf } from "@ssyung/schema";
import { errorCode, readJson, ROOT, setup } from "./helpers.ts";

const DATE = "2026-09-18";

test("특수학급 시간표 한 칸을 비우면 schedule.validate가 SPECIAL_CLASS_UNPLACED 경고", async () => {
  const dir = join(await mkdtemp(join(tmpdir(), "ssyung-web-warn-")), "school");
  await cp(join(ROOT, "dataset/db/서울개포초등학교"), dir, { recursive: true });

  // 9/18에 특수학급에서 듣는 학생 수업 하나를 골라, 그 칸의 특수학급 시간표를 지운다
  const school = readJson("fixtures/mock/domain/school.json");
  const students = readJson("fixtures/mock/domain/students.json");
  const lessons = readJson("fixtures/mock/domain/timetable-2026-09.json").lessons;
  const blocks = school.bell[0].blocks;
  const hit = students.flatMap((s: any) => lessons
    .filter((l: any) => l.date === DATE && l.class_group === s.class_group && s.special_class_subjects.includes(l.subject))
    .map((l: any) => ({ student: s.code, ...l, block: blocks.find((b: any) => b.kind === "class" && b.period === l.period) })))[0];
  assert.ok(hit, "9/18에 특수학급 수업이 있어야 한다");
  const file = join(dir, "특수학급시간표.json");
  const tt = JSON.parse(await readFile(file, "utf8"));
  const toMin = (s: string) => Number(s.slice(0, 2)) * 60 + Number(s.slice(3));
  let removed = 0;
  for (const k of tt.special_classes) {
    k.lessons = k.lessons.filter((l: any) => {
      const drop = l.day === weekdayOf(DATE) && l.subject === hit.subject && toMin(l.start) < hit.block.end && hit.block.start < toMin(l.end);
      if (drop) removed++;
      return !drop;
    });
  }
  assert.equal(removed, 1, "지운 칸은 하나");
  await writeFile(file, JSON.stringify(tt, null, 2));

  const env = await setup({ dataDir: dir });
  try {
    const day = await env.call("T01", "view.day", { date: DATE });
    const out = await env.call("T01", "schedule.validate", { version_id: day.version.id, date: DATE, assignments: day.assignments });
    const w = out.warnings.filter((x: any) => x.code === "SPECIAL_CLASS_UNPLACED");
    assert.ok(w.some((x: any) => x.params.student === hit.student && x.params.period === hit.period && x.params.reason === "none"),
      JSON.stringify(out.warnings));
    // 화면 행에서도 그 칸 장소가 정해지지 않는다 (D25)
    const row = day.students.find((s: any) => s.code === hit.student);
    assert.equal(row.lessons.find((l: any) => l.period === hit.period).location, null);
  } finally {
    await rm(join(dir, ".."), { recursive: true, force: true });
  }
});

test("개발 데이터로는 배치 경고가 없다", async () => {
  const env = await setup();
  try {
    const day = await env.call("T01", "view.day", { date: DATE });
    const out = await env.call("T01", "schedule.validate", { version_id: day.version.id, date: DATE, assignments: day.assignments });
    assert.deepEqual(out.warnings, []);
    assert.deepEqual(out.violations, []);
  } finally {
    await env.cleanup();
  }
});

test("권한: 지원인력은 교사 전용 프로시저를 못 부르고, 남의 학생 등교 체크도 못 한다", async () => {
  const env = await setup();
  try {
    assert.equal(await errorCode(env.call("A02", "students.list", {})), "FORBIDDEN");
    assert.equal(await errorCode(env.call("A02", "view.day", { date: DATE })), "FORBIDDEN");
    assert.equal(await errorCode(env.call("A02", "schedule.generate", { date_from: DATE, date_to: DATE })), "FORBIDDEN");
    assert.equal(await errorCode(env.call("T01", "view.staffToday", { date: DATE })), "FORBIDDEN");
    assert.equal(await errorCode(env.call(null, "school.get", {})), "UNAUTHORIZED");

    const mine = (await env.call("A02", "view.staffToday", { date: DATE })).day.students.map((s: any) => s.code);
    const all = (await env.call("T01", "students.list", {})).map((s: any) => s.code);
    const other = all.find((c: string) => !mine.includes(c));
    assert.ok(mine.length > 0 && other);
    assert.ok(await env.call("A02", "attendance.set", { date: DATE, student: mine[0] }));
    assert.equal(await errorCode(env.call("A02", "attendance.set", { date: DATE, student: other })), "FORBIDDEN");
    // 오늘이 아닌 날도 안 된다
    assert.equal(await errorCode(env.call("A02", "attendance.set", { date: "2026-09-17", student: mine[0] })), "FORBIDDEN");
    // 남의 칸 완료 체크도 안 된다
    const day = await env.call("T01", "view.day", { date: DATE });
    const theirs = day.assignments.find((a: any) => a.staff !== "A02");
    assert.equal(await errorCode(env.call("A02", "cell.check", {
      cell: { date: DATE, start: theirs.start, demand_id: theirs.demand_id }, arrived_students: null,
    })), "FORBIDDEN");
  } finally {
    await env.cleanup();
  }
});

test("저장소 쓰기가 커밋된 dataset/db/를 바꾸지 않는다", async () => {
  const env = await setup();
  try {
    assert.ok(!env.deps.dataDir.startsWith(ROOT), "테스트 작업 폴더는 저장소 밖");
    await env.call("T01", "students.add", {
      label: "학생9", class_group: "6-2", special_class_subjects: [], support_subjects: [], support_note: "",
    });
    await env.call("T01", "staff.remove", { code: "A03" });
    assert.equal((await env.call("T01", "students.list", {})).length, 8);
    const status = execFileSync("git", ["status", "--porcelain", "--", "dataset"], { cwd: ROOT, encoding: "utf8" });
    assert.equal(status, "");
  } finally {
    await env.cleanup();
  }
});
