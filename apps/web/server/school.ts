// 기초정보(저장소)와 시간표(학교 데이터)로 그날의 수요·근무·학생 행을 만든다.
import { ceil10, weekdayOf } from "@ssyung/schema";
import type {
  ChangeOp, DayView, IsoDate, LocationRef, SchoolBundle, Staff, StaffWindow, Student, TimeBlock, Timetable,
} from "@ssyung/schema";
import type { Deps } from "./deps.ts";
import { ApiFail } from "./errors.ts";
import type { DayData, VersionRecord } from "./store.ts";
import { dateLabel } from "./time.ts";

export type Base = { school: SchoolBundle; students: Student[]; staff: Staff[] };
type Row = DayView["students"][number];

export async function loadBase(deps: Deps): Promise<Base> {
  const [school, students, staff] = await Promise.all([deps.repo.school.get(), deps.repo.students.list(), deps.repo.staff.list()]);
  return { school, students, staff };
}

/** 날짜들을 덮는 원반 시간표 */
export async function loadTimetable(deps: Deps, school: SchoolBundle, dates: IsoDate[]): Promise<Timetable> {
  const sorted = [...dates].sort();
  const s = school.school;
  const ref = { label: s.label, neis_office_code: s.neis_office_code, neis_school_code: s.neis_school_code, address: "" };
  return deps.source.getTimetable(ref, sorted[0]!, sorted.at(-1)!);
}

export function assertSchoolDay(timetable: Timetable, date: IsoDate) {
  if (!timetable.school_days.includes(date)) throw new ApiFail("NOT_SCHOOL_DAY", `${dateLabel(date).replace(/\(.\)$/, "")}은 수업일이 아니에요.`);
}

/**
 * 그 요일·시각에 그 과목을 하는 특수학급 (D25). 하나가 아니면 null.
 * @ssyung/core의 수요 생성과 같은 규칙. core가 export하면 그것으로 바꾼다 (contracts/requests/M7-core-placement-export.md)
 */
export function specialRoomAt(school: SchoolBundle, date: IsoDate, block: Pick<TimeBlock, "start" | "end">, subject: string): LocationRef | null {
  const day = weekdayOf(date);
  const found = school.special_classes.filter((k) =>
    k.lessons.some((l) => l.day === day && l.subject === subject && l.start < block.end && block.start < l.end));
  return found.length === 1 ? found[0]!.location : null;
}

/**
 * 화면 행: 학생마다 그날 수업과 장소. 수요를 만든 것과 같은 변경(dd.ops)·요청 시각(dd.now)을 같은 규칙으로 적용한다.
 * 배치 = set_placement → 특수학급 과목 → 원반. 장소 = 지정 장소 → 특수학급 시간표(D25) / relocate_class → 반 교실.
 * 오늘 변경은 now 이후에 시작하는 교시만 (D24). 같은 칸은 뒤의 op가 이긴다
 */
export function studentRows(deps: Deps, base: Base, timetable: Timetable, date: IsoDate, dd: Pick<DayData, "ops" | "now">): Row[] {
  const { bell } = base.school;
  const blocks = deps.core.blocksOn(bell, date);
  const home = new Map(base.school.class_groups.map((c) => [c.code, c.home_location]));
  const from = dd.now?.date === date ? ceil10(dd.now.minute) : 0;
  const placed = new Map<string, { placement: "homeroom" | "special_class"; location?: LocationRef }>(); // 학생|교시
  const relocated = new Map<string, LocationRef>(); // 반|교시
  for (const op of dd.ops) {
    if (op.op !== "set_placement" && op.op !== "relocate_class") continue;
    for (const r of deps.core.resolveWhen(op.when, bell, [date])) {
      if (r.date !== date) continue;
      for (const p of deps.core.periodsIn(blocks, r)) {
        const b = blocks.find((x) => x.kind === "class" && x.period === p);
        if (!b || b.start < from) continue;
        if (op.op === "set_placement") placed.set(`${op.student}|${p}`, { placement: op.placement, location: op.location });
        else relocated.set(`${op.class_group}|${p}`, op.location);
      }
    }
  }
  return base.students.map((s) => ({
    code: s.code,
    label: s.label,
    class_group: s.class_group,
    lessons: timetable.lessons
      .filter((l) => l.date === date && l.class_group === s.class_group)
      .sort((a, b) => a.period - b.period)
      .map((l) => {
        const ov = placed.get(`${s.code}|${l.period}`);
        const placement = ov?.placement ?? (s.special_class_subjects.includes(l.subject) ? "special_class" : "homeroom");
        const block = blocks.find((b) => b.kind === "class" && b.period === l.period);
        const location = placement === "special_class"
          ? (ov?.location ?? (block ? specialRoomAt(base.school, date, block, l.subject) : null))
          : (relocated.get(`${s.class_group}|${l.period}`) ?? home.get(s.class_group) ?? s.class_group);
        return { period: l.period, subject: l.subject, placement, location };
      }),
  }));
}

/** 지원인력의 그날 근무. staff_unavailable은 부재(absent)로 (근무 시간 안으로 자름) */
export function staffWindows(deps: Deps, base: Base, date: IsoDate, ops: ChangeOp[]): StaffWindow[] {
  const day = weekdayOf(date);
  return base.staff.map((a) => {
    const available = a.availability.filter((v) => v.day === day).map((v) => ({ start: v.start, end: v.end }));
    const lo = Math.min(...available.map((v) => v.start));
    const hi = Math.max(...available.map((v) => v.end));
    const absent = ops
      .filter((op) => op.op === "staff_unavailable" && op.staff === a.code)
      .flatMap((op) => deps.core.resolveWhen(op.when, base.school.bell, [date]))
      .filter((r) => r.date === date)
      .map((r) => ({ start: Math.max(r.start, lo), end: Math.min(r.end, hi) }))
      .filter((r) => r.start < r.end);
    return { staff: a.code, date, available, absent };
  });
}

/** 버전의 그날 수요·근무. 배정 때 쓴 것이 있으면 그것, 없으면 지금 기초정보와 버전의 변경으로 다시 만든다 */
export function dayData(deps: Deps, base: Base, timetable: Timetable, rec: VersionRecord, date: IsoDate): DayData {
  const saved = rec.days.get(date);
  if (saved) return saved;
  const ds = deps.core.generateDemands({
    school: base.school, timetable, students: base.students, dates: [date], ops: rec.ops, version_id: rec.version.id,
  });
  return { demands: ds.demands, unplaced: ds.unplaced, staff: staffWindows(deps, base, date, rec.ops), ops: rec.ops, now: null };
}

export function assertInVersion(rec: VersionRecord, date: IsoDate) {
  const v = rec.version;
  if (date < v.date_from || date > v.date_to) {
    throw new ApiFail("NOT_FOUND", `버전 ${v.id}에는 ${dateLabel(date)} 배정이 없어요.`, { version_id: v.id, date });
  }
}

export function getVersion(deps: Deps, id: string): VersionRecord {
  const rec = deps.store.versions.get(id);
  if (!rec) throw new ApiFail("NOT_FOUND", `버전 ${id}이 없어요.`);
  return rec;
}

export const activeVersion = (deps: Deps): VersionRecord => getVersion(deps, deps.store.activeId);
