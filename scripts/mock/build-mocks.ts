// 목데이터 생성기: dataset/ + 실제 엔진(@ssyung/core 수요 생성, @ssyung/scheduler 배치 엔진) → fixtures/mock/, fixtures/scenarios/
// 실행: pnpm mock:build   (생성 후 packages/schema 테스트로 모든 파일을 계약에 대어 검증한다)
//
// 수요와 배정은 merge된 모듈 코드가 실제로 계산한 값이다. 모듈 코드를 바꿔 결과가 달라지면 이 스크립트를 다시 돌리고,
// 바뀐 목데이터·기준선은 사람이 승인한다(agent-development.md §6.4). 손으로 고치지 말고 스크립트를 고쳐 다시 만든다.
import { readFileSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { DEFAULT_BELL, hhmmToMinute, weekdayOf } from "../../packages/schema/src/index.ts";
import { generateDemands } from "../../packages/core/src/index.ts";
import { propose as enginePropose, validate as engineValidate, POLICIES as ENGINE_POLICIES } from "../../packages/scheduler/src/index.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const API_DIR = join(ROOT, "dataset/api/서울개포초등학교");
const DB_DIR = join(ROOT, "dataset/db/서울개포초등학교");
const OUT = join(ROOT, "fixtures/mock");
const json = (p: string) => JSON.parse(readFileSync(p, "utf8"));
const files: string[] = [];
function write(rel: string, data: unknown) {
  const p = join(OUT, rel);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, JSON.stringify(data, null, 2) + "\n");
  files.push(rel);
}

// ---------------------------------------------------------------- 기본 값
const TODAY = "2026-09-18"; // 시나리오 기준일 (금)
const NOW = 615; // 10:15 — 시안의 NOW_DEMO
const WEEK = ["2026-09-14", "2026-09-15", "2026-09-16", "2026-09-17", "2026-09-18"];
const TS = (date: string, min: number) =>
  `${date}T${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}:00+09:00`;
const toMin = hhmmToMinute;
const ymd = (d: string) => `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`;
const dayOf = weekdayOf;

// 일과 (②): 계약의 기본 일과 (초등 40분 수업)
const BELL = DEFAULT_BELL[0]!.blocks;
const PERIODS = BELL.filter((b) => b.kind === "class");
const periodAt = (min: number) => PERIODS.find((b) => b.start <= min && min < b.end)?.period ?? null;
const periodEndingAt = (min: number) => PERIODS.find((b) => b.end === min)?.period ?? null;

// ---------------------------------------------------------------- dataset → 도메인
const layout = json(join(DB_DIR, "층배치.json"));
const studentsFile = json(join(DB_DIR, "학생.json"));
const staffFile = json(join(DB_DIR, "지원인력.json"));
const scFile = json(join(DB_DIR, "특수학급시간표.json"));
const ttRows = json(join(API_DIR, "초등학교시간표.json")).slice(1);

const floorOf: Record<string, number | "OUT"> = {};
layout.classes.forEach((c: any) => (floorOf[c.class] = c.floor));
layout.special_classes.forEach((k: any) => (floorOf[k.code] = k.floor));
layout.rooms.forEach((r: any) => (floorOf[r.code] = r.floor ?? "OUT"));

const lessons: { class_group: string; date: string; period: number; subject: string }[] = [];
let skippedPeriods = 0;
for (const r of ttRows) {
  if (r.AY !== "2026" || !r.ALL_TI_YMD.startsWith("202609") || !r.ITRT_CNTNT) continue;
  const period = +r.PERIO;
  if (!PERIODS.some((b) => b.period === period)) { skippedPeriods++; continue; }
  lessons.push({ class_group: `${r.GRADE}-${r.CLASS_NM}`, date: ymd(r.ALL_TI_YMD), period, subject: r.ITRT_CNTNT });
}
lessons.sort((a, b) => (a.date + a.class_group.padStart(5) + a.period).localeCompare(b.date + b.class_group.padStart(5) + b.period));
const schoolDays = [...new Set(lessons.map((l) => l.date))].sort();
const withTimetable = new Set(lessons.map((l) => l.class_group));

const school = {
  id: "sch_gaepo",
  label: layout.school.name,
  neis_office_code: layout.school.neis_office_code,
  neis_school_code: layout.school.neis_school_code,
  academic_year: layout.school.academic_year,
  floors: layout.floors,
  timezone: "Asia/Seoul",
};
const locations = [
  ...layout.classes.map((c: any) => ({ code: c.class, label: `${c.class} 교실`, kind: "homeroom", floor: c.floor })),
  ...layout.special_classes.map((k: any) => ({ code: k.code, label: `특수학급 ${k.code}`, kind: "special_class", floor: k.floor })),
  ...layout.rooms.map((r: any) => ({
    code: r.code, label: r.label, floor: r.floor ?? "OUT",
    kind: r.outdoor ? "outdoor" : ["교무실", "행정실", "보건실", "급식실"].includes(r.label) ? "office" : "special_room",
  })),
];
const LOC_LABEL: Record<string, string> = Object.fromEntries(locations.map((l: any) => [l.code, l.label]));
const classGroups = layout.classes.map((c: any) => ({
  code: c.class, grade: c.grade, home_location: c.class, has_timetable: withTimetable.has(c.class),
}));
const scLessons: Record<string, any[]> = Object.fromEntries(scFile.special_classes.map((k: any) => [k.code, k.lessons]));
const specialClasses = layout.special_classes.map((k: any, i: number) => ({
  code: k.code, location: k.code, teachers: [`T0${i + 1}`],
  lessons: (scLessons[k.code] ?? []).map((x: any) => ({ day: x.day, start: toMin(x.start), end: toMin(x.end), subject: x.subject })),
}));
const schoolBundle = {
  school,
  bell: [{ days: ["MON", "TUE", "WED", "THU", "FRI"], blocks: BELL }],
  locations,
  class_groups: classGroups,
  special_classes: specialClasses,
};
const students = studentsFile.students.map((s: any) => ({
  code: s.code, label: s.label, class_group: s.class,
  special_class_subjects: s.special_class_subjects, support_subjects: s.support_subjects, support_note: s.support_note,
}));
const staff = staffFile.staff.map((a: any) => ({
  code: a.code, label: a.label,
  availability: a.availability.map((v: any) => ({ day: v.day, start: toMin(v.start), end: toMin(v.end) })),
}));
const LABEL: Record<string, string> = Object.fromEntries([...students, ...staff].map((x: any) => [x.code, x.label]));

// ---------------------------------------------------------------- 특수학급 장소 (D25, 화면 행 표시용)
function specialPlace(date: string, period: number, subject: string): string | null {
  const b = PERIODS.find((x) => x.period === period)!;
  const day = dayOf(date);
  const hits = specialClasses.filter((k: any) => k.lessons.some((x: any) => x.day === day && x.subject === subject && x.start < b.end && b.start < x.end));
  return hits.length === 1 ? hits[0].location : null;
}

// ---------------------------------------------------------------- 실제 엔진
const ENGINE_MS = 0; // engine.elapsed_ms는 실행마다 달라 목데이터에는 0으로 둔다
const timetable = { source: "file", date_from: "2026-09-01", date_to: "2026-09-30", school_days: schoolDays, lessons };
const studentsOf = (d: any): string[] =>
  d.kind === "move_group" ? d.students.map((x: any) => x.student) : d.student ? [d.student] : d.students ?? [];
const staffWindows = (date: string, away: Record<string, [number, number]> = {}) =>
  staff.map((a: any) => ({
    staff: a.code, date,
    available: a.availability.filter((v: any) => v.day === dayOf(date)).map((v: any) => ({ start: v.start, end: v.end })),
    absent: away[a.code] ? [{ start: away[a.code][0], end: away[a.code][1] }] : [],
  }));
/** staff_unavailable → 부재 구간 (수요는 바뀌지 않고 근무만 바뀜) */
function awayOf(ops: any[], date: string): Record<string, [number, number]> {
  const out: Record<string, [number, number]> = {};
  for (const op of ops) {
    if (op.op !== "staff_unavailable") continue;
    for (const w of [].concat(op.when) as any[]) {
      if (w.date !== date) continue;
      const av = staff.find((x: any) => x.code === op.staff).availability.find((v: any) => v.day === dayOf(date));
      if ("start" in w) out[op.staff] = [toMin(w.start), toMin(w.end)];
      else if (Object.keys(w).length === 1) out[op.staff] = [av.start, av.end];
      else throw new Error(`지원하지 않는 시간 지칭: ${JSON.stringify(w)}`);
    }
  }
  return out;
}
type Variant = { school?: any; students?: any[]; timetable?: any };
const demandsFor = (date: string, ops: any[] = [], v: Variant = {}) =>
  generateDemands({
    school: v.school ?? schoolBundle, timetable: v.timetable ?? timetable, students: v.students ?? students,
    dates: [date], ops, version_id: "ver_0901",
  } as any);

// 9월 active 버전: 날짜마다 처음부터(fresh) 배정
const base: Record<string, { demands: any[]; assignments: any[]; shortfalls: any[]; metrics: any; unplaced: any[] }> = {};
for (const date of schoolDays) {
  const ds = demandsFor(date);
  const out = await enginePropose({
    dates: [date], now: null, demands: ds.demands, staff: staffWindows(date), previous: null, pinned: [], policies: ["fresh"], request: null,
  } as any);
  const o = out.options[0]!;
  base[date] = { demands: ds.demands, assignments: o.assignments, shortfalls: o.shortfalls, metrics: o.metrics, unplaced: ds.unplaced };
}

/** 변경 요청 하나를 그날 active 배정 위에서 다시 배정 (선택지 A·B·C) */
async function proposeCase(date: string, ops: any[], v: Variant = {}, changeRequestId: string | null = null, cause?: string) {
  const ds = demandsFor(date, ops, v);
  const input = {
    dates: [date], now: null, demands: ds.demands, staff: staffWindows(date, awayOf(ops, date)),
    previous: { demands: base[date].demands, assignments: base[date].assignments },
    pinned: [], policies: ["keep_minimal", "fresh", "no_late"], request: ops.length || changeRequestId || cause ? { change_request_id: changeRequestId, ops, ...(cause ? { cause } : {}) } : null,
  };
  const output: any = await enginePropose(input as any);
  output.engine.elapsed_ms = ENGINE_MS;
  return { input, output };
}

// ---------------------------------------------------------------- 쓰기
rmSync(OUT, { recursive: true, force: true });

// domain/
write("domain/school.json", schoolBundle);
write("domain/students.json", students);
write("domain/staff.json", staff);
write("domain/timetable-2026-09.json", timetable);

// demand/ + schedule/
write(`demand/${TODAY}.json`, { date_from: TODAY, date_to: TODAY, version_id: "ver_0901", absent: [], unplaced: base[TODAY].unplaced, demands: base[TODAY].demands });
write("demand/2026-09.json", {
  date_from: "2026-09-01", date_to: "2026-09-30", version_id: "ver_0901", absent: [], unplaced: schoolDays.flatMap((d) => base[d].unplaced),
  demands: schoolDays.flatMap((d) => base[d].demands),
});
const version = {
  id: "ver_0901", parent_id: null, status: "active", date_from: "2026-09-01", date_to: "2026-09-30", cause: "setup",
  created_by: { kind: "member", code: "T01" }, created_at: "2026-08-31T15:00:00+09:00", activated_at: "2026-08-31T15:10:00+09:00",
};
write("schedule/active-2026-09.json", {
  _note: "9월 active 버전의 배정. 배치 엔진(@ssyung/scheduler, 정책: 처음부터)으로 날짜마다 계산",
  version,
  assignments: schoolDays.flatMap((d) => base[d].assignments),
  shortfalls: schoolDays.flatMap((d) => base[d].shortfalls),
  metrics_by_date: Object.fromEntries(schoolDays.map((d) => [d, base[d].metrics])),
});

// scheduler/ : 연쇄 시나리오 S1(결석), S2(출장) — fixtures/scenarios/cascade-scenarios.json과 같은 요청
const CASES = [
  { name: "absent", ops: [{ op: "mark_absent", student: "S03", when: { date: TODAY } }],
    text: `${LABEL.S03} 오늘 결석`, summary: [`${LABEL.S03} · 9월 18일(금) 결석`] },
  { name: "staff-away",
    ops: [{ op: "staff_unavailable", staff: "A01", when: [{ date: TODAY, start: "10:30", end: "11:30" }] }],
    text: `${LABEL.A01} 10시 30분부터 11시 30분까지 출장`, summary: [`${LABEL.A01} · 9월 18일(금) 10:30–11:30 부재`] },
];
const proposals: Record<string, any> = {};
for (const cs of CASES) {
  const { input, output } = await proposeCase(TODAY, cs.ops, {}, `cr_${cs.name}`);
  write(`scheduler/propose.${cs.name}.input.json`, input);
  write(`scheduler/propose.${cs.name}.output.json`, output);
  proposals[cs.name] = { input, output, cs };
}

// 연쇄 시나리오 입력과 기준선 (fixtures/scenarios/). 10개 모두 실제 수요 생성으로 입력을 만들고, 기준선 = 지금 배치 엔진 결과.
{
  const SCN_DIR = join(ROOT, "fixtures/scenarios");
  const set = json(join(SCN_DIR, "cascade-scenarios.json"));
  /** setup_change·timetable_import 시나리오는 기초정보·시간표를 바꾼 입력으로 수요를 만든다 */
  function variantOf(sc: any): Variant {
    const t = sc.trigger;
    if (t.type === "setup_change" && t.patch.special_class_location) {
      const { special_class, location } = t.patch.special_class_location;
      const school = structuredClone(schoolBundle);
      school.special_classes.find((k: any) => k.code === special_class).location = location;
      return { school };
    }
    if (t.type === "setup_change" && t.patch.student_subject_support) {
      const { student, subject, ...flags } = t.patch.student_subject_support;
      const st = structuredClone(students);
      Object.assign(st.find((x: any) => x.code === student).support_subjects.find((x: any) => x.subject === subject), flags);
      return { students: st };
    }
    if (t.type === "timetable_import") {
      const { class_group, date, swap_periods: [p, q] } = t.patch;
      const tt = structuredClone(timetable);
      const a = tt.lessons.find((l: any) => l.class_group === class_group && l.date === date && l.period === p);
      const b = tt.lessons.find((l: any) => l.class_group === class_group && l.date === date && l.period === q);
      [a.subject, b.subject] = [b.subject, a.subject];
      return { timetable: tt };
    }
    return {};
  }
  rmSync(join(SCN_DIR, "inputs"), { recursive: true, force: true });
  mkdirSync(join(SCN_DIR, "inputs"), { recursive: true });
  const LETTER = { keep_minimal: "A", fresh: "B", no_late: "C" } as const;
  for (const sc of set.scenarios) {
    delete sc.input;
    delete sc.baseline_note;
    const ops = sc.trigger.type === "change_ops" ? sc.trigger.ops : [];
    const cause = { change_ops: "change_request", setup_change: "setup", timetable_import: "timetable_import" }[sc.trigger.type as string];
    const { input, output } = await proposeCase(sc.date, ops, variantOf(sc), null, cause);
    sc.baseline_heuristic = {};
    for (const [key, letter] of Object.entries(LETTER)) {
      const o = output.options.find((x: any) => x.policies.includes(key))!;
      const kinds: Record<string, number> = {};
      for (const e of o.diff) kinds[e.type] = (kinds[e.type] ?? 0) + 1;
      sc.baseline_heuristic[letter] = { changed: o.metrics.changed_cells, gaps: o.metrics.gaps, late: o.metrics.late_students, kinds };
    }
    const rel = `inputs/${sc.id}.input.json`;
    writeFileSync(join(SCN_DIR, rel), JSON.stringify(input, null, 2) + "\n");
    // 시나리오 정의에서 trigger 바로 뒤에 input을 둔다
    const ordered: any = {};
    for (const [k, v] of Object.entries(sc)) { ordered[k] = v; if (k === "trigger") ordered.input = rel; }
    Object.keys(sc).forEach((k) => delete sc[k]);
    Object.assign(sc, ordered);
  }
  writeFileSync(join(SCN_DIR, "cascade-scenarios.json"), JSON.stringify(set, null, 2) + "\n");
}

// validate: W4에서 지원인력1이 맡은 첫 이동 묶음에 지원인력2를 하나 더 끌어 놓음 → 겹침 + 묶음 2명
{
  const asg = structuredClone(base[TODAY].assignments);
  const target = asg.find((a: any) => a.staff === "A01" && a.demand_id.startsWith("mv:"))!;
  const edited = asg.concat([{ ...target, staff: "A02" }]).sort((x: any, y: any) => x.start - y.start || x.staff.localeCompare(y.staff));
  const vin = { demands: base[TODAY].demands, staff: staffWindows(TODAY), pinned: [], assignments: edited };
  const { warnings: _w, ...vout } = engineValidate(vin as any) as any; // 엔진은 경고를 내지 않는다(0.2.0)
  write("scheduler/validate.overlap.input.json", vin);
  write("scheduler/validate.overlap.output.json", vout);
  proposals.validate = { edited, vout };
}

// solver/ : CP-SAT 서비스 /assign — 같은 문제를 정책 keep_minimal로
{
  const pin = proposals["staff-away"];
  const optA = pin.output.options[0];
  write("solver/assign.request.json", {
    dates: pin.input.dates, demands: pin.input.demands, staff: pin.input.staff, pinned: [],
    previous_assignments: pin.input.previous.assignments, policy: ENGINE_POLICIES.keep_minimal, time_limit_ms: 5000,
  });
  write("solver/assign.response.json", {
    status: "feasible", assignments: optA.assignments, shortfalls: optA.shortfalls,
    solver_meta: { elapsed_ms: 840, objective_stages: [0, optA.metrics.gaps, 0, optA.metrics.changed_cells, 0], message: "목데이터: 임시 규칙 엔진(@ssyung/scheduler) 결과를 그대로 넣음" },
  });
}

// interpreter/
{
  const week2 = [...WEEK, "2026-09-19", "2026-09-20", "2026-09-21", "2026-09-22", "2026-09-23", "2026-09-24", "2026-09-25"];
  const cls = [...new Set(students.map((s: any) => s.class_group))] as string[];
  const classSubjects: Record<string, Record<string, (string | null)[]>> = {};
  for (const c of cls) {
    classSubjects[c] = {};
    for (const d of week2.filter((x) => schoolDays.includes(x)))
      classSubjects[c][d] = PERIODS.map((p) => lessons.find((l) => l.class_group === c && l.date === d && l.period === p.period)?.subject ?? null);
  }
  write(`interpreter/context-${TODAY}.json`, {
    today: TODAY,
    calendar: week2.map((d) => ({ date: d, day: dayOf(d), school_day: schoolDays.includes(d) })),
    bell: BELL,
    part_of_day: { morning: [1, 2, 3, 4], afternoon: [5, 6] },
    class_subjects: classSubjects,
    codes: {
      students: students.map((s: any) => ({ code: s.code, label: s.label, class_group: s.class_group })),
      staff: staff.map((a: any) => ({ code: a.code, label: a.label })),
      locations: locations.filter((l: any) => l.kind !== "homeroom").map((l: any) => ({ code: l.code, label: l.label })),
    },
  });
}

// api/ : 프로시저마다 예시 1개 이상
const api = (name: string, examples: any[], note?: string) =>
  write(`api/${name}.json`, { ...(note ? { _note: note } : {}), procedure: name, examples });
const T01 = { kind: "member", code: "T01" };
const byStaffFirst = (date: string, st: string, from = 0) => base[date].assignments.filter((a) => a.staff === st && a.start >= from);

// 등교·완료 체크: 시안처럼 10:00 전에 끝난 칸은 완료, 단 지원인력2의 첫 이동은 [도착] 대기
function dayState(date: string) {
  const c = base[date];
  const dById = Object.fromEntries(c.demands.map((d: any) => [d.id, d]));
  const a02FirstMove = c.assignments.find((a) => a.staff === "A02" && a.demand_id.startsWith("mv:"));
  const checks = c.assignments
    .filter((a) => a.end <= 600 && a !== a02FirstMove)
    .map((a) => {
      const d = dById[a.demand_id];
      return { cell: { date, start: a.start, demand_id: a.demand_id }, staff: a.staff, done_at: TS(date, a.end),
        done_by: { kind: "staff", code: a.staff }, arrived_students: d.kind === "move_group" ? studentsOf(d) : null };
    });
  const firstStaff: Record<string, string> = {};
  for (const a of c.assignments) for (const s of studentsOf(dById[a.demand_id])) firstStaff[s] ??= a.staff;
  const attendance = students
    .filter((s: any) => firstStaff[s.code])
    .map((s: any, i: number) => ({ date, student: s.code, status: "present", checked_by: { kind: "staff", code: firstStaff[s.code] }, checked_at: TS(date, 520 + i * 2 + 2) }));
  return { checks, attendance, pending: a02FirstMove && a02FirstMove.end <= NOW + 10 ? a02FirstMove.demand_id : null };
}
function dayView(date: string, c = base[date], ver: any = version) {
  const st = date === TODAY ? dayState(date) : { checks: [], attendance: [] };
  const rows = students.map((s: any) => ({
    code: s.code, label: s.label, class_group: s.class_group,
    lessons: lessons.filter((l) => l.class_group === s.class_group && l.date === date).map((l) => {
      const k = s.special_class_subjects.includes(l.subject);
      return { period: l.period, subject: l.subject, placement: k ? "special_class" : "homeroom", location: k ? specialPlace(date, l.period, l.subject) : s.class_group };
    }),
  }));
  const notes = date === TODAY ? [{
    id: "note_0001", cell: { date, start: 630, demand_id: c.demands.find((d: any) => d.kind === "move_group" && d.start === 630)?.id ?? c.demands[0].id },
    author: T01, body: "계단 대신 엘리베이터 이용", created_at: TS(date, 500),
  }] : [];
  return {
    date, version: { id: ver.id, status: ver.status }, bell: BELL, students: rows,
    staff: staffWindows(date).map((w: any) => ({ code: w.staff, label: LABEL[w.staff], available: w.available, absent: w.absent })),
    demands: c.demands, assignments: c.assignments, shortfalls: c.shortfalls,
    attendance: st.attendance, checks: st.checks, notes, metrics: { staff_minutes: c.metrics.staff_minutes },
  };
}
const filterDay = (v: any, st: string) => {
  const mine = new Set(v.assignments.filter((a: any) => a.staff === st).map((a: any) => a.demand_id));
  const kids = new Set(v.demands.filter((d: any) => mine.has(d.id)).flatMap(studentsOf));
  return {
    ...v, students: v.students.filter((s: any) => kids.has(s.code)), staff: v.staff.filter((s: any) => s.code === st),
    demands: v.demands.filter((d: any) => mine.has(d.id)), assignments: v.assignments.filter((a: any) => a.staff === st),
    shortfalls: [], attendance: v.attendance.filter((a: any) => kids.has(a.student)),
    checks: v.checks.filter((x: any) => mine.has(x.cell.demand_id)), notes: v.notes.filter((x: any) => mine.has(x.cell.demand_id)),
  };
};
const notif = { id: "ntf_0001", staff: "A02", kind: "version", version_id: "ver_0918b", ref_id: null, channel: "push",
  sent_at: TS(TODAY, 600), acknowledged_at: null, summary: "오늘 10:30–11:30 배정이 바뀌었어요 (3칸)" };

api("school.search", [{ title: "학교 이름 검색 (지금은 서울개포초만)", input: { query: "개포초" },
  output: [{ label: school.label, neis_office_code: "B10", neis_school_code: "7091371", address: "서울특별시 강남구" }] }]);
api("school.import", [{ title: "학급정보·시간표 가져오기", input: { neis_office_code: "B10", neis_school_code: "7091371", academic_year: 2026 },
  output: { class_groups: classGroups, timetable: { date_from: "2026-09-01", date_to: "2026-09-30", lesson_count: lessons.length, skipped_rows: skippedPeriods } } }]);
api("school.get", [{ title: "학교 기초정보", input: {}, output: schoolBundle }]);
api("setup.saveLayout", [{ title: "층 배치 저장 (③ 끌어 놓기)", input: { floors: layout.floors, special_classes: layout.special_classes, classes: layout.classes, rooms: layout.rooms }, output: schoolBundle }]);
api("setup.previewMoveGroups", [{ title: "현재 배치로 생기는 이동 묶음 (⑥)", input: { date: TODAY }, output: base[TODAY].demands.filter((d: any) => d.kind === "move_group") }]);
api("students.list", [{ title: "학생 목록", input: {}, output: students }]);
const newStudent = { label: "학생8", class_group: "6-2", special_class_subjects: ["국어"],
  support_subjects: [{ subject: "과학", need_start: true, need_mid: true, need_end: true }], support_note: "" };
api("students.add", [
  { title: "학생 추가", input: newStudent, output: { code: "S08", ...newStudent } },
]);
api("students.update", [{ title: "지원 구간 수정", input: { code: "S02", patch: { support_subjects: [{ subject: "과학", need_start: false, need_mid: true, need_end: false }] } },
  output: { ...students[1], support_subjects: [{ subject: "과학", need_start: false, need_mid: true, need_end: false }] } }]);
api("students.remove", [{ title: "학생 삭제", input: { code: "S07" }, output: { ok: true } }]);
api("staff.list", [{ title: "지원인력 목록", input: {}, output: staff }]);
const newStaff = { label: "지원인력4", availability: ["MON", "WED", "FRI"].map((day) => ({ day, start: 540, end: 780 })) };
api("staff.add", [{ title: "지원인력 추가 (월·수·금 오전)", input: newStaff, output: { code: "A04", ...newStaff } }]);
api("staff.update", [{ title: "근무 시간 수정", input: { code: "A03", patch: { availability: staff[2].availability.map((v: any) => ({ ...v, end: 900 })) } },
  output: { ...staff[2], availability: staff[2].availability.map((v: any) => ({ ...v, end: 900 })) } }]);
api("staff.remove", [{ title: "지원인력 삭제", input: { code: "A03" }, output: { ok: true } }]);

const vToday = dayView(TODAY);
api("view.day", [
  { title: "9/18(금) 하루 (W2·W2b·T1). 10:15 기준 등교·완료 체크 포함", input: { date: TODAY }, output: vToday },
  { title: "수업 없는 날", input: { date: "2026-09-24" }, error: { code: "NOT_SCHOOL_DAY", message: "9월 24일은 수업일이 아니에요." } },
]);
api("view.week", [{ title: "9/14–9/18 주간 (W3)", input: { week_start: "2026-09-14" }, output: { week_start: "2026-09-14", days: WEEK.map((d) => dayView(d)) } }]);
api("view.staffToday", [{ title: "지원인력2 오늘 (A1). 첫 이동 [도착] 대기, 미확인 알림 1건", input: { date: TODAY },
  output: { staff: "A02", date: TODAY, now: Math.floor(NOW / 10) * 10, day: filterDay(vToday, "A02"), pending_move: dayState(TODAY).pending, unacked: [notif] } }]);

const draft = { ...version, id: "ver_draft01", parent_id: null, status: "draft", activated_at: null, date_from: "2026-09-14", date_to: "2026-09-18", created_at: TS("2026-09-11", 900) };
{
  const demands = WEEK.flatMap((d) => base[d].demands);
  const out: any = await enginePropose({
    dates: WEEK, now: null, demands, staff: WEEK.flatMap((d) => staffWindows(d)), previous: null, pinned: [], policies: ["fresh"], request: null,
  } as any);
  api("schedule.generate", [{ title: "최초 생성 9/14–9/18", input: { date_from: "2026-09-14", date_to: "2026-09-18" },
    output: { version: draft, option: out.options[0] } }]);
}
api("schedule.validate", [{ title: "끌어 놓기로 겹침 발생 (W4)", input: { version_id: "ver_draft01", date: TODAY, assignments: proposals.validate.edited }, output: { ...proposals.validate.vout, warnings: [] } }]);
api("schedule.updateDraft", [{ title: "수동 수정 저장 (겹침은 경고로 돌려줌)", input: { version_id: "ver_draft01", date: TODAY, assignments: proposals.validate.edited }, output: { ...proposals.validate.vout, warnings: [] } }]);
api("schedule.activate", [{ title: "draft 승인", input: { version_id: "ver_draft01" },
  output: { version: { ...draft, status: "active", activated_at: TS("2026-09-11", 910) }, notified: ["A01", "A02", "A03"] } }]);
api("schedule.rollback", [{ title: "과거 버전 복제 → draft", input: { version_id: "ver_0901" },
  output: { ...version, id: "ver_rb01", parent_id: "ver_0901", status: "draft", cause: "rollback", created_at: TS(TODAY, 700), activated_at: null } }]);

const crOf = (name: string) => {
  const { cs } = proposals[name];
  return { id: `cr_${name}`, base_version_id: "ver_0901", raw_text: cs.text, parsed: { ops: cs.ops, scope: "this_week", confidence: "high", unsupported: null },
    summary: cs.summary, status: "parsed", created_by: "T01", created_at: TS(TODAY, 600) };
};
api("change.interpret", [
  { title: "지원인력 부재", input: { raw_text: proposals["staff-away"].cs.text, today: TODAY }, output: crOf("staff-away") },
  { title: "결석", input: { raw_text: proposals.absent.cs.text, today: TODAY }, output: crOf("absent") },
  { title: "지원하지 않는 요청", input: { raw_text: `${LABEL.S07} 지원 강도 올려줘`, today: TODAY },
    output: { ...crOf("absent"), id: "cr_unsup", raw_text: `${LABEL.S07} 지원 강도 올려줘`, parsed: { ops: [], scope: "this_week", confidence: "high", unsupported: "지원 과목·구간은 기초정보의 학생 설정(④)에서 바꿔요" }, summary: [] } },
]);
const proposalOf = (name: string) => ({ id: `prp_${name}`, change_request_id: `cr_${name}`, base_version_id: "ver_0901", dates: [TODAY],
  options: proposals[name].output.options, recommended: "A" });
api("change.confirm", [
  { title: "지원인력1 10:30–11:30 부재 → 선택지", input: { change_request_id: "cr_staff-away", ops: crOf("staff-away").parsed }, output: proposalOf("staff-away") },
  { title: "학생3 결석 → 선택지", input: { change_request_id: "cr_absent", ops: crOf("absent").parsed }, output: proposalOf("absent") },
]);
api("proposal.approve", [
  { title: "선택지 A 승인", input: { proposal_id: "prp_staff-away", option_key: "A" },
    output: { version: { ...version, id: "ver_0918b", parent_id: "ver_0901", cause: "change_request", created_at: TS(TODAY, 600), activated_at: TS(TODAY, 601) },
      notified: proposals["staff-away"].output.options[0].metrics.notify_staff } },
  { title: "그 사이 다른 변경이 승인됨", input: { proposal_id: "prp_absent", option_key: "A" }, error: { code: "BASE_VERSION_CHANGED", message: "다른 변경이 먼저 승인됐어요. 다시 계산할게요." } },
]);
api("proposal.reject", [{ title: "거절", input: { proposal_id: "prp_absent" }, output: { ok: true } }]);
const st = dayState(TODAY);
api("attendance.set", [{ title: "등교 체크", input: { date: TODAY, student: "S05" }, output: st.attendance.find((a: any) => a.student === "S05") ?? st.attendance[0] }]);
api("attendance.clear", [{ title: "등교 체크 취소", input: { date: TODAY, student: "S05" }, output: { ok: true } }]);
{
  const mvDemand: any = base[TODAY].demands.find((d: any) => d.id === st.pending) ?? base[TODAY].demands.find((d: any) => d.kind === "move_group");
  const cell = { date: TODAY, start: mvDemand.start, demand_id: mvDemand.id };
  const less = st.checks.find((c: any) => c.arrived_students === null)!;
  api("cell.check", [
    { title: "이동 묶음 [도착] (학생별 확인)", input: { cell, arrived_students: studentsOf(mvDemand) },
      output: { cell, staff: "A02", done_at: TS(TODAY, NOW), done_by: { kind: "staff", code: "A02" }, arrived_students: studentsOf(mvDemand) } },
    { title: "수업 지원 완료", input: { cell: less.cell, arrived_students: null }, output: less },
  ]);
  api("cell.uncheck", [{ title: "완료 취소", input: { cell: less.cell }, output: { ok: true } }]);
  api("cell.note", [{ title: "쉬는 시간 칸 메모", input: { cell: vToday.notes[0].cell, body: vToday.notes[0].body }, output: vToday.notes[0] }]);
}
api("memo.post", [{ title: "학생 메모", input: { student: "S04", body: "오늘 기분이 좋지 않아 천천히 이동" },
  output: { id: "memo_0001", student: "S04", author: { kind: "staff", code: "A01" }, body: "오늘 기분이 좋지 않아 천천히 이동", created_at: TS(TODAY, 560), read_by: [] } }]);
api("memo.markRead", [{ title: "메모 읽음", input: { memo_id: "memo_0001" }, output: { ok: true } }]);
api("notification.ack", [{ title: "변경 알림 확인", input: { notification_id: "ntf_0001" }, output: { ...notif, acknowledged_at: TS(TODAY, 610) } }]);
api("staff.issueInvite", [{ title: "초대 코드 발급", input: { staff: "A02" }, output: { code: "482915", expires_at: TS(TODAY, 1440 - 10) } }]);
api("staff.revokeDevice", [{ title: "기기 연결 해제", input: { staff: "A02" }, output: { ok: true } }]);
api("device.redeemInvite", [
  { title: "초대 코드로 연결", input: { code: "482915", push_token: "ExponentPushToken[mock]" }, output: { staff: "A02", label: LABEL.A02, session_token: "mock-session-token" } },
  { title: "만료된 코드", input: { code: "000000", push_token: null }, error: { code: "NOT_FOUND", message: "코드가 없거나 만료됐어요." } },
]);

// 색인
write("manifest.json", {
  _note: "목데이터 파일 → 계약(packages/schema) 스키마. pnpm mock:build로 생성하고 packages/schema 테스트가 전부 검증한다",
  generated_at: "2026-10-22",
  base_date: TODAY,
  files: Object.fromEntries(files.map((f) => [f, schemaOf(f)])),
});
function schemaOf(f: string) {
  if (f.startsWith("api/")) return "api:" + f.slice(4, -5);
  const map: Record<string, string> = {
    "domain/school.json": "SchoolBundle", "domain/students.json": "Student[]", "domain/staff.json": "Staff[]",
    "domain/timetable-2026-09.json": "Timetable", "schedule/active-2026-09.json": "ScheduleSnapshot",
    "solver/assign.request.json": "AssignRequest", "solver/assign.response.json": "AssignResponse",
  };
  if (map[f]) return map[f];
  if (f.startsWith("demand/")) return "DemandSet";
  if (f.startsWith("interpreter/context-")) return "InterpretContext";
  if (/propose\..*\.input/.test(f)) return "ProposeInput";
  if (/propose\..*\.output/.test(f)) return "ProposeOutput";
  if (/validate\..*\.input/.test(f)) return "ValidateInput";
  if (/validate\..*\.output/.test(f)) return "ValidateOutput";
  throw new Error("스키마 없음: " + f);
}
console.log(`fixtures/mock: ${files.length}개 파일, 9월 수업일 ${schoolDays.length}일, 수업 ${lessons.length}칸 (8교시 등 일과 밖 ${skippedPeriods}칸 제외)`);
for (const cs of CASES) {
  const o = proposals[cs.name].output.options;
  console.log(cs.name, o.map((x: any) => `${x.key}(${x.policies.join("+")}) 바뀜${x.metrics.changed_cells} 공백${x.metrics.gaps} 늦음${x.metrics.late_students}`).join(" | "));
}
