// 저장소 계약 테스트. 구현과 떼어 둔다: JsonRepository와 나중의 SupabaseRepository가 같은 테스트를 돌린다.
// 전제: 저장소는 dataset/db/서울개포초등학교와 같은 초기 데이터(S01–S07, A01–A03)로 시작한다.
// 기대값은 fixtures/mock/의 목데이터와 API 예시다.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { SchoolBundle, Staff, Student } from "@ssyung/schema";
import type { SpecialClass } from "@ssyung/schema";
import { RepositoryError, type Repository } from "../src/index.ts";

export interface ContractTarget {
  /** 테스트마다 초기 데이터로 새 저장소를 만든다 */
  setup(): Promise<{ repo: Repository; cleanup(): Promise<void> }>;
}

const mock = async (rel: string) =>
  JSON.parse(await readFile(new URL(`../../../fixtures/mock/${rel}`, import.meta.url), "utf8"));
const example = async (procedure: string, i = 0) => (await mock(`api/${procedure}.json`)).examples[i];
const isCode = (code: string) => (e: unknown) => e instanceof RepositoryError && e.code === code;
const LONG = "가".repeat(21);

export function repositoryContract(name: string, target: ContractTarget) {
  const withRepo = (title: string, fn: (repo: Repository) => Promise<void>) =>
    test(title, async () => {
      const { repo, cleanup } = await target.setup();
      try {
        await fn(repo);
      } finally {
        await cleanup();
      }
    });

  describe(`저장소 계약: ${name}`, () => {
    withRepo("초기값이 목데이터와 같다", async (repo) => {
      const bundle = await repo.school.get();
      SchoolBundle.parse(bundle);
      assert.deepEqual(bundle, await mock("domain/school.json"));
      assert.equal(bundle.class_groups.find((g) => g.code === "1-3")?.has_timetable, false);
      const students = await repo.students.list();
      Student.array().parse(students);
      assert.deepEqual(students, await mock("domain/students.json"));
      const staff = await repo.staff.list();
      Staff.array().parse(staff);
      assert.deepEqual(staff, await mock("domain/staff.json"));
    });

    withRepo("특수학급 시간표: 요일·분으로 읽는다 (D25)", async (repo) => {
      const { special_classes } = await repo.school.get();
      const expected = (await mock("domain/school.json")).special_classes as SpecialClass[];
      assert.deepEqual(special_classes, expected);
      assert.deepEqual(special_classes.map((k) => k.code), ["K1", "K2"]);
      for (const k of special_classes) {
        assert.ok(k.lessons.length > 0, `${k.code} 수업 있음`);
        for (const l of k.lessons) assert.ok(l.start < l.end && l.start % 10 === 0 && l.end % 10 === 0);
      }
      // 첫 수업: 월 09:50–10:30 국어 (dataset/db 특수학급시간표.json)
      assert.deepEqual(special_classes[0]!.lessons[0], { day: "MON", start: 590, end: 630, subject: "국어" });
    });

    withRepo("학생: 추가 → 목록 → 수정 → 삭제", async (repo) => {
      const add = await example("students.add");
      const added = await repo.students.add(add.input);
      assert.deepEqual(Student.parse(added), add.output);
      assert.deepEqual((await repo.students.list()).map((s) => s.code), ["S01", "S02", "S03", "S04", "S05", "S06", "S07", "S08"]);

      const upd = await example("students.update");
      const updated = await repo.students.update(upd.input.code, upd.input.patch);
      assert.deepEqual(Student.parse(updated), upd.output);
      assert.deepEqual((await repo.students.list()).find((s) => s.code === upd.input.code), upd.output);

      const del = await example("students.remove");
      await repo.students.remove(del.input.code);
      const left = (await repo.students.list()).map((s) => s.code);
      assert.ok(!left.includes(del.input.code));
      assert.equal(left.length, 7);
    });

    withRepo("지원인력: 추가 → 목록 → 수정 → 삭제", async (repo) => {
      const add = await example("staff.add");
      const added = await repo.staff.add(add.input);
      assert.deepEqual(Staff.parse(added), add.output);
      assert.deepEqual((await repo.staff.list()).map((a) => a.code), ["A01", "A02", "A03", "A04"]);

      const upd = await example("staff.update");
      const updated = await repo.staff.update(upd.input.code, upd.input.patch);
      assert.deepEqual(Staff.parse(updated), upd.output);
      assert.deepEqual((await repo.staff.list()).find((a) => a.code === upd.input.code), upd.output);

      const del = await example("staff.remove");
      await repo.staff.remove(del.input.code);
      assert.ok(!(await repo.staff.list()).some((a) => a.code === del.input.code));
    });

    withRepo("새 코드는 발급한 가장 큰 번호 + 1, 지운 번호는 다시 쓰지 않음", async (repo) => {
      const sa = await example("students.add");
      await repo.students.remove("S03");
      assert.equal((await repo.students.add(sa.input)).code, "S08");
      await repo.students.remove("S08");
      await repo.students.remove("S07");
      assert.equal((await repo.students.add(sa.input)).code, "S09");

      const fa = await example("staff.add");
      await repo.staff.remove("A03");
      assert.equal((await repo.staff.add(fa.input)).code, "A04");
    });

    withRepo("없는 코드는 NOT_FOUND", async (repo) => {
      await assert.rejects(repo.students.update("S99", { label: "학생99" }), isCode("NOT_FOUND"));
      await assert.rejects(repo.students.remove("S99"), isCode("NOT_FOUND"));
      await assert.rejects(repo.staff.update("A99", { label: "지원인력99" }), isCode("NOT_FOUND"));
      await assert.rejects(repo.staff.remove("A99"), isCode("NOT_FOUND"));
    });

    withRepo("라벨 20자 초과는 VALIDATION, 저장되지 않음", async (repo) => {
      const sa = await example("students.add");
      const fa = await example("staff.add");
      await assert.rejects(repo.students.add({ ...sa.input, label: LONG }), isCode("VALIDATION"));
      await assert.rejects(repo.students.update("S01", { label: LONG }), isCode("VALIDATION"));
      await assert.rejects(repo.staff.add({ ...fa.input, label: LONG }), isCode("VALIDATION"));
      await assert.rejects(repo.staff.update("A01", { label: LONG }), isCode("VALIDATION"));
      assert.deepEqual(await repo.students.list(), await mock("domain/students.json"));
      assert.deepEqual(await repo.staff.list(), await mock("domain/staff.json"));
      // 20자는 통과
      assert.equal((await repo.students.update("S01", { label: "가".repeat(20) })).label.length, 20);
    });

    withRepo("층 배치 저장 → 학교 정보에 반영", async (repo) => {
      const ex = await example("setup.saveLayout");
      const saved = await repo.school.saveLayout(ex.input);
      SchoolBundle.parse(saved);
      assert.deepEqual(saved, ex.output);
      assert.deepEqual(await repo.school.get(), ex.output);
    });
  });
}
