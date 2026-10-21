// 목데이터 출처. fixtures/mock/의 정규화된 결과를 그대로 돌려준다.
// NEIS 응답(dataset/api/) 정규화는 보류 (tasks/M4-questions.md Q1).
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { ClassGroup, procedures, Timetable } from "@ssyung/schema";
import type { IsoDate, ProcedureName } from "@ssyung/schema";
import { SourceError, type SchoolDataSource, type SchoolRef } from "./source.ts";

const MOCK_DIR = fileURLToPath(new URL("../../../fixtures/mock", import.meta.url));

export interface MockSourceOptions {
  /** fixtures/mock 경로. 기본은 저장소의 fixtures/mock */
  mockDir?: string;
}

export class MockSource implements SchoolDataSource {
  private readonly dir: string;

  constructor(options: MockSourceOptions = {}) {
    this.dir = options.mockDir ?? MOCK_DIR;
  }

  async searchSchools(query: string): Promise<SchoolRef[]> {
    const q = query.trim();
    const all = await this.schools();
    return q ? all.filter((s) => s.label.includes(q)) : [];
  }

  async getClassGroups(school: SchoolRef, year: number): Promise<ClassGroup[]> {
    const bundle = await this.bundle(school);
    if (year !== bundle.school.academic_year) {
      throw new SourceError("NOT_FOUND", `${year}학년도 학급 자료가 없어요.`);
    }
    return ClassGroup.array().parse(bundle.class_groups);
  }

  async getTimetable(school: SchoolRef, from: IsoDate, to: IsoDate): Promise<Timetable> {
    await this.bundle(school);
    if (from > to) throw new SourceError("VALIDATION", "시작 날짜가 끝 날짜보다 늦어요.");
    const tt = Timetable.parse(await this.json("domain/timetable-2026-09.json"));
    if (from < tt.date_from || to > tt.date_to) {
      throw new SourceError("NOT_IMPLEMENTED", `목데이터는 ${tt.date_from}–${tt.date_to}만 있어요.`);
    }
    const inRange = (d: IsoDate) => from <= d && d <= to;
    return Timetable.parse({
      source: tt.source,
      date_from: from,
      date_to: to,
      school_days: tt.school_days.filter(inRange),
      lessons: tt.lessons.filter((l) => inRange(l.date)),
    });
  }

  private async schools(): Promise<SchoolRef[]> {
    const name: ProcedureName = "school.search";
    const file = (await this.json(`api/${name}.json`)) as { examples: { output: unknown }[] };
    const out = procedures[name].output;
    const seen = new Map<string, SchoolRef>();
    for (const ex of file.examples) for (const s of out.parse(ex.output)) seen.set(s.neis_school_code, s);
    return [...seen.values()];
  }

  private async bundle(school: SchoolRef) {
    const bundle = (await this.json("domain/school.json")) as {
      school: { neis_office_code: string; neis_school_code: string; academic_year: number };
      class_groups: unknown;
    };
    const s = bundle.school;
    if (s.neis_office_code !== school.neis_office_code || s.neis_school_code !== school.neis_school_code) {
      throw new SourceError("NOT_FOUND", "학교 자료가 없어요.");
    }
    return bundle;
  }

  private async json(rel: string): Promise<unknown> {
    return JSON.parse(await readFile(join(this.dir, rel), "utf8"));
  }
}
