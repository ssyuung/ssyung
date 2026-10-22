import { test } from "node:test";
import assert from "node:assert/strict";
import { cp, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { StaffFile, StudentsFile } from "@ssyung/schema";
import { MockSource } from "@ssyung/school-data";
import { JsonRepository } from "../src/index.ts";
import { repositoryContract } from "./contract.ts";

const DB_DIR = fileURLToPath(new URL("../../../dataset/db/서울개포초등학교", import.meta.url));
const source = new MockSource();

/** dataset/db 복사본에만 쓴다 */
async function copy() {
  const dir = await mkdtemp(join(tmpdir(), "ssyung-repo-"));
  await cp(DB_DIR, dir, { recursive: true });
  return { dir, cleanup: () => rm(dir, { recursive: true, force: true }) };
}
const open = (dir: string) => new JsonRepository({ dir, schoolId: "sch_gaepo", source });

repositoryContract("JsonRepository", {
  async setup() {
    const { dir, cleanup } = await copy();
    return { repo: open(dir), cleanup };
  },
});

test("JsonRepository: 쓰기는 같은 파일 형식이고 다시 열어도 남는다", async () => {
  const { dir, cleanup } = await copy();
  try {
    const repo = open(dir);
    const s = await repo.students.add({
      label: "학생8", class_group: "6-2",
      special_class_subjects: [], support_subjects: [], support_note: "",
    });
    await repo.staff.update("A01", { availability: [{ day: "MON", start: 540, end: 780 }] });

    const students = StudentsFile.parse(JSON.parse(await readFile(join(dir, "학생.json"), "utf8")));
    assert.ok(students._note);
    assert.equal(students.students.at(-1)?.class, "6-2");
    const staff = StaffFile.parse(JSON.parse(await readFile(join(dir, "지원인력.json"), "utf8")));
    assert.deepEqual(staff.staff[0]?.availability, [{ day: "MON", start: "09:00", end: "13:00" }]);

    const again = open(dir);
    assert.ok((await again.students.list()).some((x) => x.code === s.code));
  } finally {
    await cleanup();
  }
});

test("JsonRepository: 발급 번호는 파일에 남아 다시 열어도 이어진다", async () => {
  const { dir, cleanup } = await copy();
  try {
    const input = { label: "학생", class_group: "6-2", special_class_subjects: [], support_subjects: [], support_note: "" };
    const repo = open(dir);
    await repo.students.add(input);
    await repo.students.remove("S08");
    const raw = JSON.parse(await readFile(join(dir, "학생.json"), "utf8"));
    assert.equal(raw.last_code_no, 8);
    assert.equal((await open(dir).students.add(input)).code, "S09");
  } finally {
    await cleanup();
  }
});

test("JsonRepository: 동시에 추가해도 코드가 겹치지 않는다", async () => {
  const { dir, cleanup } = await copy();
  try {
    const repo = open(dir);
    const input = { label: "학생", class_group: "6-2", special_class_subjects: [], support_subjects: [], support_note: "" };
    const added = await Promise.all([repo.students.add(input), repo.students.add(input), repo.students.add(input)]);
    assert.deepEqual(added.map((s) => s.code).sort(), ["S08", "S09", "S10"]);
    assert.equal((await repo.students.list()).length, 10);
  } finally {
    await cleanup();
  }
});

test("원본 dataset/db는 바뀌지 않는다", async () => {
  const raw = JSON.parse(await readFile(join(DB_DIR, "학생.json"), "utf8"));
  assert.deepEqual(raw.students.map((s: { code: string }) => s.code), ["S01", "S02", "S03", "S04", "S05", "S06", "S07"]);
});
