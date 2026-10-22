// 수요 생성 (architecture.md §8.1). 가져온 시간표와 배치로 날짜 범위의 수요를 만든다.
import { ceil10 } from "@ssyung/schema";
import type {
  ChangeOp, Demand, DemandSet, Floor, IsoDate, LessonDemand, LocationRef, Minute, MoveGroupDemand,
  SchoolBundle, Student, TimeBlock, Timetable,
} from "@ssyung/schema";
import { blocksOn, breakAfter, classBlock, periodsIn, resolveWhen, weekdayOf } from "./when.ts";

export { expandDuties } from "./duty.ts";
export * from "./when.ts";

export type GenerateDemandsInput = {
  school: SchoolBundle;
  timetable: Timetable;
  students: Student[];
  dates: IsoDate[];
  /** 변경 요청. mark_absent, set_placement, relocate_class, set_support만 수요에 반영한다 */
  ops?: ChangeOp[];
  /** 결과 DemandSet.version_id. 수요를 만든 버전 입력 */
  version_id?: string | null;
  /** 버전에 저장된 추가 수요. set_support가 이 위에 덮어쓴다 */
  requirements?: RequirementDemand[];
  /** 요청 시각 (D24). 이 날짜의 변경은 now(10분 올림) 이후에 시작하는 칸에만 적용한다 */
  now?: { date: IsoDate; minute: number };
};

type RequirementDemand = Extract<Demand, { kind: "requirement" }>;
type Req = Pick<RequirementDemand, "date" | "student" | "start" | "end" | "headcount">;
type Unplaced = DemandSet["unplaced"][number];
type Placement = "homeroom" | "special_class";
type LateCost = 0 | 1 | 2;
/** 학생 s의 교시 p 상태. 특수학급 장소를 못 정하면 unplaced */
type Slot =
  | { subject: string; placement: Placement; location: LocationRef; floor: Floor; lateCost: LateCost; unplaced?: undefined }
  | { subject: string; placement: "special_class"; unplaced: Unplaced["reason"] };

const key = (...parts: (string | number)[]) => parts.join("|");

export function generateDemands(input: GenerateDemandsInput): DemandSet {
  const { school, timetable, students, ops = [] } = input;
  if (input.dates.length === 0) throw new Error("dates가 비어 있습니다.");
  const dates = [...new Set(input.dates)].sort();

  const floorOf = new Map(school.locations.map((l) => [l.code, l.floor]));
  const floor = (loc: LocationRef): Floor => {
    const f = floorOf.get(loc);
    if (f === undefined) throw new Error(`장소 ${loc}가 학교에 없습니다.`);
    return f;
  };
  const homeOf = new Map(school.class_groups.map((c) => [c.code, c.home_location]));

  /** 그 요일·시각에 그 과목을 하는 특수학급 교실 (D25) */
  const specialRoom = (date: IsoDate, b: TimeBlock, subject: string): LocationRef | Unplaced["reason"] => {
    const day = weekdayOf(date);
    const found = school.special_classes.filter((k) =>
      k.lessons.some((l) => l.day === day && l.subject === subject && l.start < b.end && b.start < l.end));
    return found.length === 1 ? found[0]!.location : found.length === 0 ? "none" : "multiple";
  };

  // 날짜 → 반 → 교시 → 과목
  const dateSet = new Set(dates);
  const lessons = new Map<string, Map<number, string>>();
  for (const l of timetable.lessons) {
    if (!dateSet.has(l.date)) continue;
    const k = key(l.date, l.class_group);
    if (!lessons.has(k)) lessons.set(k, new Map());
    lessons.get(k)!.set(l.period, l.subject);
  }

  // ---------- 변경 요청을 입력으로 바꿈. 같은 칸은 뒤의 op가 이긴다 ----------
  // from: 이 시각 이후에 시작하는 칸에만 적용 (D24). 오늘이 아니면 0
  const fromOf = (date: IsoDate): Minute => (input.now?.date === date ? ceil10(input.now.minute) : 0);
  const overrides = new Map<string, { placement: Placement; location?: LocationRef; from: Minute }>(); // 학생|날짜|교시
  const relocations = new Map<string, { location: LocationRef; from: Minute }>(); // 반|날짜|교시
  const absences = new Map<string, { start: Minute; end: Minute; from: Minute }[]>(); // 학생|날짜
  const wholeAbsent = new Set<string>(); // 학생|날짜
  // 추가 수요. 버전에 저장된 것에서 시작해 set_support가 그 구간을 덮어쓴다(겹친 부분만 잘라 냄)
  let requirements: Req[] = (input.requirements ?? [])
    .filter((r) => dateSet.has(r.date))
    .map(({ date, student, start, end, headcount }) => ({ date, student, start, end, headcount }));
  const cut = (date: IsoDate, student: string, start: Minute, end: Minute, from: Minute) => {
    requirements = requirements.flatMap((r) =>
      r.date !== date || r.student !== student || r.start < from || r.end <= start || end <= r.start
        ? [r]
        : [
            ...(r.start < start ? [{ ...r, end: start }] : []),
            ...(end < r.end ? [{ ...r, start: end }] : []),
          ],
    );
  };

  for (const op of ops) {
    if (op.op !== "mark_absent" && op.op !== "set_placement" && op.op !== "relocate_class" && op.op !== "set_support") continue;
    for (const r of resolveWhen(op.when, school.bell, dates)) {
      if (!dateSet.has(r.date)) continue;
      const blocks = blocksOn(school.bell, r.date);
      const from = fromOf(r.date);
      if (op.op === "mark_absent") {
        const k = key(op.student, r.date);
        if (!absences.has(k)) absences.set(k, []);
        absences.get(k)!.push({ start: r.start, end: r.end, from });
        if (r.whole) wholeAbsent.add(k);
      } else if (op.op === "set_placement") {
        if (op.location) floor(op.location);
        for (const p of periodsIn(blocks, r)) {
          overrides.set(key(op.student, r.date, p), { placement: op.placement, location: op.location, from });
        }
      } else if (op.op === "relocate_class") {
        floor(op.location);
        for (const p of periodsIn(blocks, r)) relocations.set(key(op.class_group, r.date, p), { location: op.location, from });
      } else {
        // 하루 전체 = 등교 시작 ~ 하교 끝. 오늘이면 now부터
        let { start, end } = r;
        if (r.whole) {
          if (blocks.length === 0) continue;
          start = (blocks.find((b) => b.kind === "arrival") ?? blocks[0]!).start;
          end = (blocks.find((b) => b.kind === "dismissal") ?? blocks.at(-1)!).end;
        }
        start = Math.max(start, from);
        if (start >= end) continue;
        cut(r.date, op.student, start, end, from);
        if (op.headcount > 0) requirements.push({ date: r.date, student: op.student, start, end, headcount: op.headcount });
      }
    }
  }

  /** 칸(cellStart에 시작)이 결석 구간과 겹치고, 결석이 적용되는 시각 이후에 시작하는지 */
  const isAbsent = (student: string, date: IsoDate, start: Minute, end: Minute) =>
    (absences.get(key(student, date)) ?? []).some((a) => a.start < end && start < a.end && start >= a.from);

  // ---------- 학생·날짜별 계산 ----------
  const demands: Demand[] = [];
  const unplaced: Unplaced[] = [];
  for (const date of dates) {
    const blocks = blocksOn(school.bell, date);
    const groups = new Map<string, MoveGroupDemand>();

    for (const s of students) {
      const subjects = lessons.get(key(date, s.class_group));
      if (!subjects) continue; // 휴일, 시간표 없는 반

      /** 교시 p의 상태. cellStart는 이 상태를 쓰는 칸의 시작 시각(변경 적용 여부를 가름) */
      const slotAt = (p: number, cellStart: Minute): Slot | undefined => {
        const subject = subjects.get(p);
        const b = classBlock(blocks, p);
        if (subject === undefined || !b) return undefined;
        const ovRaw = overrides.get(key(s.code, date, p));
        const ov = ovRaw && cellStart >= ovRaw.from ? ovRaw : undefined;
        const placement: Placement = ov?.placement ?? (s.special_class_subjects.includes(subject) ? "special_class" : "homeroom");
        let location: LocationRef;
        if (placement === "homeroom") {
          const rel = relocations.get(key(s.class_group, date, p));
          location = rel && cellStart >= rel.from ? rel.location : homeOf.get(s.class_group)!;
        } else {
          // 특수학급 장소: 지정 장소 → 그 요일·시각에 그 과목을 하는 특수학급 (D25)
          const room = ov?.location ?? specialRoom(date, b, subject);
          if (room === "none" || room === "multiple") return { subject, placement, unplaced: room };
          location = room;
        }
        const support = placement === "homeroom" ? s.support_subjects.find((x) => x.subject === subject) : undefined;
        const lateCost: LateCost = placement === "special_class" ? 1 : support?.need_start ? 2 : 0;
        return { subject, placement, location, floor: floor(location), lateCost };
      };

      // ① 수업 지원
      for (const p of [...subjects.keys()].sort((a, b) => a - b)) {
        const b = classBlock(blocks, p);
        if (!b || isAbsent(s.code, date, b.start, b.end)) continue;
        const slot = slotAt(p, b.start)!;
        if (slot.unplaced) {
          unplaced.push({ date, student: s.code, period: p, subject: slot.subject, reason: slot.unplaced });
          continue;
        }
        if (slot.placement !== "homeroom") continue;
        const support = s.support_subjects.find((x) => x.subject === slot.subject);
        if (!support) continue;
        const pr = (v: boolean): "HIGH" | "LOW" => (v ? "HIGH" : "LOW");
        const lesson: LessonDemand = {
          id: `les:${date}:${s.code}:p${p}`, kind: "lesson", date, start: b.start, end: b.end, headcount: 1,
          student: s.code, period: p, subject: slot.subject, location: slot.location, floor: slot.floor,
          segments: [
            { segment: "start", start: b.start, end: b.start + 10, priority: pr(support.need_start) },
            { segment: "mid", start: b.start + 10, end: b.start + 30, priority: pr(support.need_mid) },
            { segment: "end", start: b.start + 30, end: b.start + 40, priority: pr(support.need_end) },
          ],
        };
        demands.push(lesson);
      }

      // ② 이동 묶음 (D12). 점심을 사이에 둔 이동은 업무로 다루므로 만들지 않는다. 장소 미정 칸 앞뒤도 만들지 않는다
      for (const p of subjects.keys()) {
        const brk = breakAfter(blocks, p);
        if (!brk || !subjects.has(p + 1) || isAbsent(s.code, date, brk.start, brk.end)) continue;
        const from = slotAt(p, brk.start);
        const to = slotAt(p + 1, brk.start);
        if (!from || !to || from.unplaced || to.unplaced || from.location === to.location) continue;
        const gid = `mv:${date}:b${p}:${from.floor}-${to.floor}`;
        let g = groups.get(gid);
        if (!g) {
          const next = classBlock(blocks, p + 1)!;
          g = {
            id: gid, kind: "move_group", date, start: brk.start, end: brk.end, headcount: 1, after_period: p,
            from_floor: from.floor, to_floor: to.floor, students: [], late_cost: 0,
            second_trip: { start: next.start, end: next.start + 10 },
          };
          groups.set(gid, g);
        }
        g.students.push({ student: s.code, from: from.location, to: to.location, late_cost: to.lateCost });
        g.late_cost = Math.max(g.late_cost, to.lateCost) as LateCost;
      }
    }

    for (const g of groups.values()) {
      g.students.sort((a, b) => a.student.localeCompare(b.student));
      demands.push(g);
    }
  }

  // ③ 추가 수요. 결석 구간만큼 잘라 낸다
  for (const [k, list] of absences) {
    const [student, date] = k.split("|") as [string, IsoDate];
    for (const a of list) cut(date, student, a.start, a.end, a.from);
  }
  for (const r of requirements) {
    demands.push({
      id: `req:${r.date}:${r.student}:${r.start}`, kind: "requirement", date: r.date, start: r.start, end: r.end,
      headcount: r.headcount, student: r.student,
    });
  }

  demands.sort((a, b) => a.date.localeCompare(b.date) || a.start - b.start || a.id.localeCompare(b.id));
  unplaced.sort((a, b) => a.date.localeCompare(b.date) || a.student.localeCompare(b.student) || a.period - b.period);
  const absent = [...wholeAbsent]
    .map((k) => { const [student, date] = k.split("|") as [string, IsoDate]; return { date, student }; })
    .sort((a, b) => a.date.localeCompare(b.date) || a.student.localeCompare(b.student));

  return { date_from: dates[0]!, date_to: dates.at(-1)!, version_id: input.version_id ?? null, absent, unplaced, demands };
}
