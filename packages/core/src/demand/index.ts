// 수요 생성 (architecture.md §8.1). 가져온 시간표와 배치로 날짜 범위의 수요를 만든다.
import type {
  ChangeOp, Demand, DemandSet, Floor, IsoDate, LessonDemand, LocationRef, Minute, MoveGroupDemand,
  SchoolBundle, Student, Timetable,
} from "@ssyung/schema";
import { blocksOn, breakAfter, classBlock, periodsIn, resolveWhen } from "./when.ts";

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
  /** 요청 시각. 하루 전체를 가리킨 set_support는 이 날짜면 이 시각부터 */
  now?: { date: IsoDate; minute: number };
};

type RequirementDemand = Extract<Demand, { kind: "requirement" }>;
type Req = Pick<RequirementDemand, "date" | "student" | "start" | "end" | "headcount">;
type Placement = "homeroom" | "special_class";
type LateCost = 0 | 1 | 2;
/** 학생 s의 교시 p 상태 */
type Slot = { subject: string; placement: Placement; location: LocationRef; floor: Floor; lateCost: LateCost };

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
  const overrides = new Map<string, { placement: Placement; location?: LocationRef }>(); // 학생|날짜|교시
  const relocations = new Map<string, LocationRef>(); // 반|날짜|교시
  const absences = new Map<string, { start: Minute; end: Minute }[]>(); // 학생|날짜
  const wholeAbsent = new Set<string>(); // 학생|날짜
  // 추가 수요. 버전에 저장된 것에서 시작해 set_support가 그 구간을 덮어쓴다(겹친 부분만 잘라 냄)
  let requirements: Req[] = (input.requirements ?? [])
    .filter((r) => dateSet.has(r.date))
    .map(({ date, student, start, end, headcount }) => ({ date, student, start, end, headcount }));
  const cut = (date: IsoDate, student: string, start: Minute, end: Minute) => {
    requirements = requirements.flatMap((r) =>
      r.date !== date || r.student !== student || r.end <= start || end <= r.start
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
      if (op.op === "mark_absent") {
        const k = key(op.student, r.date);
        if (!absences.has(k)) absences.set(k, []);
        absences.get(k)!.push({ start: r.start, end: r.end });
        if (r.whole) wholeAbsent.add(k);
      } else if (op.op === "set_placement") {
        if (op.location) floor(op.location);
        for (const p of periodsIn(blocks, r)) overrides.set(key(op.student, r.date, p), { placement: op.placement, location: op.location });
      } else if (op.op === "relocate_class") {
        floor(op.location);
        for (const p of periodsIn(blocks, r)) relocations.set(key(op.class_group, r.date, p), op.location);
      } else {
        // 하루 전체 = 등교 시작 ~ 하교 끝. 일과 중에 요청했으면 그 시각(10분 올림)부터
        let { start, end } = r;
        if (r.whole) {
          if (blocks.length === 0) continue;
          start = (blocks.find((b) => b.kind === "arrival") ?? blocks[0]!).start;
          end = (blocks.find((b) => b.kind === "dismissal") ?? blocks.at(-1)!).end;
          if (input.now?.date === r.date) start = Math.max(start, Math.ceil(input.now.minute / 10) * 10);
          if (start >= end) continue;
        }
        cut(r.date, op.student, start, end);
        if (op.headcount > 0) requirements.push({ date: r.date, student: op.student, start, end, headcount: op.headcount });
      }
    }
  }

  const isAbsent = (student: string, date: IsoDate, start: Minute, end: Minute) =>
    (absences.get(key(student, date)) ?? []).some((a) => a.start < end && start < a.end);

  // ---------- 학생·날짜별 계산 ----------
  const demands: Demand[] = [];
  for (const date of dates) {
    const blocks = blocksOn(school.bell, date);
    const groups = new Map<string, MoveGroupDemand>();

    for (const s of students) {
      const subjects = lessons.get(key(date, s.class_group));
      if (!subjects) continue; // 휴일, 시간표 없는 반

      const slotAt = (p: number): Slot | undefined => {
        const subject = subjects.get(p);
        if (subject === undefined) return undefined;
        const rule = s.special_class_subjects.find((x) => x.subject === subject);
        const ov = overrides.get(key(s.code, date, p));
        const placement: Placement = ov?.placement ?? (rule ? "special_class" : "homeroom");
        // 특수학급 장소는 그 시간 과목으로 정한다: 지정 장소 → 그 과목의 특수학급 장소(D20).
        // 특수학급 시간표가 계약에 생기면 그것으로 바꾼다 (contracts/requests/M3-special-class-timetable.md)
        let location: LocationRef;
        if (placement === "homeroom") location = relocations.get(key(s.class_group, date, p)) ?? homeOf.get(s.class_group)!;
        else {
          const loc = ov?.location ?? rule?.location;
          if (!loc) throw new Error(`${s.code} ${date} ${p}교시 ${subject}: 이 과목의 특수학급 장소가 없습니다. 장소를 지정하세요.`);
          location = loc;
        }
        const support = placement === "homeroom" ? s.support_subjects.find((x) => x.subject === subject) : undefined;
        const lateCost: LateCost = placement === "special_class" ? 1 : support?.need_start ? 2 : 0;
        return { subject, placement, location, floor: floor(location), lateCost };
      };

      // ① 수업 지원
      for (const p of [...subjects.keys()].sort((a, b) => a - b)) {
        const b = classBlock(blocks, p);
        if (!b || isAbsent(s.code, date, b.start, b.end)) continue;
        const slot = slotAt(p)!;
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

      // ② 이동 묶음 (D12). 점심을 사이에 둔 이동은 업무로 다루므로 만들지 않는다
      for (const p of subjects.keys()) {
        const brk = breakAfter(blocks, p);
        if (!brk || !subjects.has(p + 1) || isAbsent(s.code, date, brk.start, brk.end)) continue;
        const from = slotAt(p)!;
        const to = slotAt(p + 1)!;
        if (from.location === to.location) continue;
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
    for (const a of list) cut(date, student, a.start, a.end);
  }
  for (const r of requirements) {
    demands.push({
      id: `req:${r.date}:${r.student}:${r.start}`, kind: "requirement", date: r.date, start: r.start, end: r.end,
      headcount: r.headcount, student: r.student,
    });
  }

  demands.sort((a, b) => a.date.localeCompare(b.date) || a.start - b.start || a.id.localeCompare(b.id));
  const absent = [...wholeAbsent]
    .map((k) => { const [student, date] = k.split("|") as [string, IsoDate]; return { date, student }; })
    .sort((a, b) => a.date.localeCompare(b.date) || a.student.localeCompare(b.student));

  return { date_from: dates[0]!, date_to: dates.at(-1)!, version_id: input.version_id ?? null, absent, demands };
}
