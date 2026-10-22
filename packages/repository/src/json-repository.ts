// JSON 파일 저장소. dataset/db/<학교>/ 파일을 읽고, 쓰기도 같은 파일 형식으로 한다(개발 서버에서만).
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { z } from "zod";
import {
  DEFAULT_BELL, FloorLayoutFile, hhmmToMinute, minuteToHHMM, procedures, SchoolBundle, SpecialClassTimetableFile, Staff,
  StaffFile, StaffInput, Student, StudentInput, StudentsFile,
} from "@ssyung/schema";
import type { ClassGroup, Location, SpecialClass } from "@ssyung/schema";
import type { SchoolDataSource } from "@ssyung/school-data";
import {
  issuedMax, nextCode, RepositoryError, type FloorLayout, type Repository, type StaffPatch, type StudentPatch,
} from "./repository.ts";
import type { StaffInput as StaffInputT, StudentInput as StudentInputT } from "./repository.ts";

type LayoutFile = z.infer<typeof FloorLayoutFile>;
type StudentsFileT = z.infer<typeof StudentsFile>;
type StaffFileT = z.infer<typeof StaffFile>;

const FILES = {
  layout: "층배치.json", students: "학생.json", staff: "지원인력.json", specialTimetable: "특수학급시간표.json",
} as const;
/** 층배치.json에는 장소 종류가 없어 이름으로 나눈다 (목데이터 생성기와 같은 규칙) */
const OFFICE_LABELS = ["교무실", "행정실", "보건실", "급식실"];

export interface JsonRepositoryOptions {
  /** dataset/db/<학교>/ 경로 */
  dir: string;
  /** School.id. DB 단계 전에는 정해 준다 */
  schoolId: string;
  /** 반마다 시간표 자료가 있는지(has_timetable) 알아낼 출처 */
  source: SchoolDataSource;
}

function check<S extends z.ZodType>(schema: S, value: unknown, what: string): z.infer<S> {
  const r = schema.safeParse(value);
  if (!r.success) throw new RepositoryError("VALIDATION", `${what} 형식이 맞지 않아요.`, { issues: r.error.issues });
  return r.data;
}
const notFound = (code: string) => new RepositoryError("NOT_FOUND", `${code}가 없어요.`);

export class JsonRepository implements Repository {
  private readonly opts: JsonRepositoryOptions;
  /** 쓰기를 한 줄로 세운다. 읽고-고치고-쓰는 사이에 다른 쓰기가 끼지 않게 */
  private queue: Promise<unknown> = Promise.resolve();

  constructor(opts: JsonRepositoryOptions) {
    this.opts = opts;
  }

  readonly school: Repository["school"] = {
    get: async () => this.bundle(await this.readLayout()),
    saveLayout: (layout: FloorLayout) =>
      this.serial(async () => {
        const input = check(procedures["setup.saveLayout"].input, layout, "층 배치");
        const file = await this.readLayout();
        const next = check(FloorLayoutFile, { ...file, ...input }, "층 배치");
        await this.write(FILES.layout, next);
        return this.bundle(next);
      }),
  };

  readonly students: Repository["students"] = {
    list: async () => (await this.readStudents()).students.map(fromStudentRow),
    add: (input: StudentInputT) =>
      this.serial(async () => {
        const data = check(StudentInput, input, "학생");
        const file = await this.readStudents();
        const next = nextCode("S", file.students.map((s) => s.code), file.last_code_no);
        const student = Student.parse({ ...data, code: next.code });
        await this.writeStudents({ ...file, last_code_no: next.no }, [...file.students, toStudentRow(student)]);
        return student;
      }),
    update: (code: string, patch: StudentPatch) =>
      this.serial(async () => {
        const data = check(StudentInput.partial(), patch, "학생");
        const file = await this.readStudents();
        const i = file.students.findIndex((s) => s.code === code);
        if (i < 0) throw notFound(code);
        const student = check(Student, { ...fromStudentRow(file.students[i]!), ...data, code }, "학생");
        const rows = file.students.slice();
        rows[i] = toStudentRow(student);
        await this.writeStudents(file, rows);
        return student;
      }),
    remove: (code: string) =>
      this.serial(async () => {
        const file = await this.readStudents();
        if (!file.students.some((s) => s.code === code)) throw notFound(code);
        // 가장 큰 번호를 지워도 발급 기록이 남게 한다
        const last = issuedMax("S", file.students.map((s) => s.code), file.last_code_no);
        await this.writeStudents({ ...file, last_code_no: last }, file.students.filter((s) => s.code !== code));
      }),
  };

  readonly staff: Repository["staff"] = {
    list: async () => (await this.readStaff()).staff.map(fromStaffRow),
    add: (input: StaffInputT) =>
      this.serial(async () => {
        const data = check(StaffInput, input, "지원인력");
        const file = await this.readStaff();
        const next = nextCode("A", file.staff.map((a) => a.code), file.last_code_no);
        const staff = Staff.parse({ ...data, code: next.code });
        await this.writeStaff({ ...file, last_code_no: next.no }, [...file.staff, toStaffRow(staff)]);
        return staff;
      }),
    update: (code: string, patch: StaffPatch) =>
      this.serial(async () => {
        const data = check(StaffInput.partial(), patch, "지원인력");
        const file = await this.readStaff();
        const i = file.staff.findIndex((a) => a.code === code);
        if (i < 0) throw notFound(code);
        const staff = check(Staff, { ...fromStaffRow(file.staff[i]!), ...data, code }, "지원인력");
        const rows = file.staff.slice();
        rows[i] = toStaffRow(staff);
        await this.writeStaff(file, rows);
        return staff;
      }),
    remove: (code: string) =>
      this.serial(async () => {
        const file = await this.readStaff();
        if (!file.staff.some((a) => a.code === code)) throw notFound(code);
        const last = issuedMax("A", file.staff.map((a) => a.code), file.last_code_no);
        await this.writeStaff({ ...file, last_code_no: last }, file.staff.filter((a) => a.code !== code));
      }),
  };

  // ---------- 층 배치 + 특수학급 시간표 → SchoolBundle ----------
  private async bundle(layout: LayoutFile) {
    const s = layout.school;
    const groups = await this.opts.source.getClassGroups(
      { label: s.name, neis_office_code: s.neis_office_code, neis_school_code: s.neis_school_code, address: "" },
      s.academic_year,
    );
    const withTimetable = new Set(groups.filter((g) => g.has_timetable).map((g) => g.code));
    const locations: Location[] = [
      ...layout.classes.map((c): Location => ({ code: c.class, label: `${c.class} 교실`, kind: "homeroom", floor: c.floor })),
      ...layout.special_classes.map((k): Location => ({
        code: k.code, label: `특수학급 ${k.code}`, kind: "special_class", floor: k.floor,
      })),
      ...layout.rooms.map((r): Location => ({
        code: r.code, label: r.label, floor: r.floor ?? "OUT",
        kind: r.outdoor ? "outdoor" : OFFICE_LABELS.includes(r.label) ? "office" : "special_room",
      })),
    ];
    const classGroups = layout.classes.map((c): ClassGroup => ({
      code: c.class, grade: c.grade, home_location: c.class, has_timetable: withTimetable.has(c.class),
    }));
    // 층 배치에 있는 특수학급만. 시간표 파일에 없는 특수학급은 수업 없음
    const timetable = await this.readSpecialTimetable();
    const lessonsOf = new Map(timetable.special_classes.map((k) => [k.code, k.lessons]));
    // 교사 코드는 교사 저장 전까지 특수학급 순서대로 T01, T02 (Q3)
    const specialClasses = layout.special_classes.map((k, i): SpecialClass => ({
      code: k.code, location: k.code, teachers: [`T${String(i + 1).padStart(2, "0")}`],
      lessons: (lessonsOf.get(k.code) ?? []).map((l) => ({
        day: l.day, start: hhmmToMinute(l.start), end: hhmmToMinute(l.end), subject: l.subject,
      })),
    }));
    return SchoolBundle.parse({
      school: {
        id: this.opts.schoolId,
        label: s.name,
        neis_office_code: s.neis_office_code,
        neis_school_code: s.neis_school_code,
        academic_year: s.academic_year,
        floors: layout.floors,
        timezone: "Asia/Seoul",
      },
      bell: DEFAULT_BELL,
      locations,
      class_groups: classGroups,
      special_classes: specialClasses,
    });
  }

  // ---------- 파일 ----------
  private serial<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.queue.then(fn, fn);
    this.queue = run.catch(() => {});
    return run;
  }
  private async read(name: string): Promise<unknown> {
    return JSON.parse(await readFile(join(this.opts.dir, name), "utf8"));
  }
  private async write(name: string, data: unknown) {
    await writeFile(join(this.opts.dir, name), JSON.stringify(data, null, 2) + "\n");
  }
  private async readLayout() {
    return FloorLayoutFile.parse(await this.read(FILES.layout));
  }
  private async readSpecialTimetable() {
    return SpecialClassTimetableFile.parse(await this.read(FILES.specialTimetable));
  }
  private async readStudents() {
    return StudentsFile.parse(await this.read(FILES.students));
  }
  private async readStaff() {
    return StaffFile.parse(await this.read(FILES.staff));
  }
  private writeStudents(file: StudentsFileT, students: StudentsFileT["students"]) {
    return this.write(FILES.students, StudentsFile.parse({ ...file, students }));
  }
  private writeStaff(file: StaffFileT, staff: StaffFileT["staff"]) {
    return this.write(FILES.staff, StaffFile.parse({ ...file, staff }));
  }
}

// ---------- 파일 행 ↔ 도메인 ----------
type StudentRow = StudentsFileT["students"][number];
type StaffRow = StaffFileT["staff"][number];

function fromStudentRow(r: StudentRow): Student {
  return {
    code: r.code, label: r.label, class_group: r.class,
    special_class_subjects: r.special_class_subjects, support_subjects: r.support_subjects, support_note: r.support_note,
  };
}
function toStudentRow(s: Student): StudentRow {
  return {
    code: s.code, label: s.label, class: s.class_group,
    special_class_subjects: s.special_class_subjects, support_subjects: s.support_subjects, support_note: s.support_note,
  };
}
function fromStaffRow(r: StaffRow): Staff {
  return {
    code: r.code, label: r.label,
    availability: r.availability.map((v) => ({ day: v.day, start: hhmmToMinute(v.start), end: hhmmToMinute(v.end) })),
  };
}
function toStaffRow(a: Staff): StaffRow {
  return {
    code: a.code, label: a.label,
    availability: a.availability.map((v) => ({ day: v.day, start: minuteToHHMM(v.start), end: minuteToHHMM(v.end) })),
  };
}
