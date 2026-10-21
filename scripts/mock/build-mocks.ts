// 목데이터 생성기: dataset/ + 화면 시안(docs/screens/ssyung-screens.html)의 임시 규칙 엔진 → fixtures/mock/
// 실행: pnpm mock:build   (생성 후 packages/schema 테스트로 모든 파일을 계약에 대어 검증한다)
//
// 배정 결과는 시안의 임시 규칙 엔진(buildDay)이 실제로 계산한 값이다. M1이 packages/scheduler를 만들면
// 이 스크립트의 엔진 부분을 그것으로 바꾼다. 손으로 고치지 말고 스크립트를 고쳐 다시 만든다.
import { readFileSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseHTML } from "linkedom";
import { DEFAULT_BELL, hhmmToMinute, weekdayOf } from "../../packages/schema/src/index.ts";

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
const specialClasses = layout.special_classes.map((k: any, i: number) => ({ code: k.code, location: k.code, teachers: [`T0${i + 1}`] }));
const schoolBundle = {
  school,
  bell: [{ days: ["MON", "TUE", "WED", "THU", "FRI"], blocks: BELL }],
  locations,
  class_groups: classGroups,
  special_classes: specialClasses,
};
const students = studentsFile.students.map((s: any) => ({
  code: s.code, label: s.label, class_group: s.class, special_class: s.special_class,
  special_class_subjects: s.special_class_subjects, support_subjects: s.support_subjects, support_note: s.support_note,
}));
const staff = staffFile.staff.map((a: any) => ({
  code: a.code, label: a.label,
  availability: a.availability.map((v: any) => ({ day: v.day, start: toMin(v.start), end: toMin(v.end) })),
}));
const LABEL: Record<string, string> = Object.fromEntries([...students, ...staff].map((x: any) => [x.code, x.label]));

// ---------------------------------------------------------------- 시안 엔진 부팅
function bootPrototype() {
  const h = readFileSync(join(ROOT, "docs/screens/ssyung-screens.html"), "utf8");
  const { window, document } = parseHTML("<!doctype html><html><body>" + h.replace(/<script>[\s\S]*<\/script>/, "") + "</body></html>") as any;
  let js = h.split("<script>")[1].split("</script>")[0];
  js = js.replace("  var TODAY = buildDay(DI)", "  window.__X = { buildDay: buildDay, SSY: SSY };\n  var TODAY = buildDay(DI)");
  window.HTMLElement.prototype.setPointerCapture = () => {};
  window.HTMLElement.prototype.focus = () => {};
  window.HTMLElement.prototype.getBoundingClientRect = () => ({ left: 0, right: 0, top: 0, bottom: 0 });
  new Function("document", "window", js)(document, window);
  return window.__X as { buildDay: (di: number, mod?: any) => any; SSY: any };
}
const X = bootPrototype();
const diOf = (date: string) => X.SSY.dates.indexOf(date.replaceAll("-", ""));

// ---------------------------------------------------------------- 시안 결과 → 계약 형식
type Plan = { req: any[]; bars: any[] };
const fl = (f: string) => (f === "OUT" ? "OUT" : +String(f).replace("F", ""));
function demandId(date: string, r: any) {
  if (r.kind === "h") return `les:${date}:${r.code}:p${periodAt(r.s)}`;
  const [, bs, ff, tf] = r.sig.split("|");
  return `mv:${date}:b${periodEndingAt(+bs)}:${fl(ff)}-${fl(tf)}`;
}
function toDemand(date: string, r: any) {
  const id = demandId(date, r);
  if (r.kind === "h") {
    const s = r.s;
    const seg = (k: "s" | "m" | "e") => (r.seg[k] ? "HIGH" : "LOW");
    return {
      id, kind: "lesson", date, start: r.s, end: r.e, headcount: 1, student: r.code, period: periodAt(r.s),
      subject: r.label, location: r.from, floor: floorOf[r.from],
      segments: [
        { segment: "start", start: s, end: s + 10, priority: seg("s") },
        { segment: "mid", start: s + 10, end: s + 30, priority: seg("m") },
        { segment: "end", start: s + 30, end: s + 40, priority: seg("e") },
      ],
    };
  }
  const bs = +r.sig.split("|")[1];
  return {
    id, kind: "move_group", date, start: bs, end: bs + 10, headcount: 1, after_period: periodEndingAt(bs),
    from_floor: fl(r.ff), to_floor: fl(r.tf),
    students: r.legs.map((l: any) => ({ student: l.code, from: l.from, to: l.to, late_cost: l.cost })),
    late_cost: r.cost, second_trip: { start: bs + 10, end: bs + 20 },
  };
}
function convert(date: string, p: Plan) {
  const byId: Record<string, any> = {};
  p.req.forEach((r) => (byId[r.id] = r));
  const demands = p.req.map((r) => toDemand(date, r)).sort((a: any, b: any) => a.start - b.start || a.id.localeCompare(b.id));
  const assignments = p.bars
    .map((b) => {
      const r = byId[b.req];
      return { staff: b.staff, demand_id: demandId(date, r), date, start: b.s, end: b.e, mode: r.late ? "second_trip" : "normal", pinned: false };
    })
    .sort((a, b) => a.start - b.start || a.staff.localeCompare(b.staff));
  const shortfalls: any[] = [];
  for (const r of p.req) {
    const id = demandId(date, r);
    const mine = p.bars.filter((b) => b.req === r.id);
    if (r.kind === "mv") {
      if (!mine.length) shortfalls.push({ demand_id: id, date, start: r.s, end: r.e, short_by: 1, priority: "MOVE", segment: null, waived: false });
      continue;
    }
    const d: any = toDemand(date, r);
    for (const sg of d.segments) {
      let missing = false;
      for (let t = sg.start; t < sg.end; t += 10) if (!mine.some((b) => b.s <= t && b.e >= t + 10)) missing = true;
      if (!missing) continue;
      const waived = Object.keys(r.waived).some((k) => +k >= sg.start && +k < sg.end);
      shortfalls.push({ demand_id: id, date, start: sg.start, end: sg.end, short_by: 1, priority: sg.priority, segment: sg.segment, waived });
    }
  }
  shortfalls.sort((a, b) => a.start - b.start || a.demand_id.localeCompare(b.demand_id));
  return { demands, assignments, shortfalls };
}
function studentsOf(d: any): string[] {
  return d.kind === "move_group" ? d.students.map((x: any) => x.student) : d.student ? [d.student] : d.students ?? [];
}
function metricsOf(c: ReturnType<typeof convert>, diff: any[] = []) {
  const byId = Object.fromEntries(c.demands.map((d: any) => [d.id, d]));
  const gaps = new Set(c.shortfalls.filter((s) => !s.waived).map((s) => s.demand_id)).size;
  const late = c.assignments.filter((a) => a.mode === "second_trip").reduce((n, a) => n + studentsOf(byId[a.demand_id]).length, 0);
  const staffMinutes: Record<string, number> = {};
  staff.forEach((a: any) => (staffMinutes[a.code] = 0));
  const per: Record<string, Record<string, number>> = {};
  for (const a of c.assignments) {
    const m = a.end - a.start;
    staffMinutes[a.staff] += m;
    for (const s of studentsOf(byId[a.demand_id])) ((per[s] ??= {})[a.staff] = (per[s][a.staff] ?? 0) + m);
  }
  const pairShare: Record<string, number> = {};
  for (const [s, m] of Object.entries(per)) {
    const tot = Object.values(m).reduce((x, y) => x + y, 0);
    for (const [a, v] of Object.entries(m)) pairShare[`${a}:${s}`] = Math.round((v / tot) * 100) / 100;
  }
  const notify = new Set<string>();
  diff.forEach((e) => [e.before?.staff, e.after?.staff].forEach((x) => x && notify.add(x)));
  return { changed_cells: diff.length, gaps, late_students: late, notify_staff: [...notify].sort(), staff_minutes: staffMinutes, pair_share: pairShare };
}
const basePlans: Record<string, Plan> = {};
const base: Record<string, ReturnType<typeof convert>> = {};
for (const date of schoolDays) {
  basePlans[date] = X.buildDay(diOf(date));
  base[date] = convert(date, basePlans[date]);
}

// ---------------------------------------------------------------- 선택지 (D23), diff, 연쇄 설명 (§8.7)
const POLICIES = [
  { key: "keep_minimal", k: "A", label: "변경 최소", description: "지금 배정을 최대한 유지. 체크된 시작 구간은 비우지 않음", flags: { noLast: true },
    rules: { move_group: true, segment_priority: true, second_trip: true, edge_release: true, keep_previous: true }, release_checked_start: false },
  { key: "fresh", k: "B", label: "처음부터 다시", description: "이전 배정에 묶이지 않고 다시 배정. 공백이 줄 수 있지만 많이 바뀜", flags: { fresh: true },
    rules: { move_group: true, segment_priority: true, second_trip: true, edge_release: true, keep_previous: false }, release_checked_start: true },
  { key: "no_late", k: "C", label: "늦게 도착 없음", description: "두 번째 이동을 쓰지 않음. 모자라면 지원 공백", flags: { noLate: true },
    rules: { move_group: true, segment_priority: true, second_trip: false, edge_release: true, keep_previous: true }, release_checked_start: true },
] as const;
const policyOut = (p: (typeof POLICIES)[number]) => ({
  key: p.key, label: p.label, description: p.description,
  rules: { ...p.rules, balance: false, rotation: false }, release_checked_start: p.release_checked_start,
});

function propose(date: string, mod: any, ops: any[]) {
  const b = basePlans[date];
  const bid: Record<string, any> = {};
  b.req.forEach((r) => (bid[r.id] = r));
  const prev: Record<string, string> = {};
  const prevTime: Record<string, string> = {};
  b.bars.forEach((x) => { prev[bid[x.req].sig] = x.staff; prevTime[bid[x.req].sig] = x.s + "-" + x.e; });
  const ids: Record<string, string> = {};
  b.req.forEach((r) => (ids[r.sig] = r.id));
  const options: any[] = [];
  for (const pol of POLICIES) {
    const m = { ...JSON.parse(JSON.stringify(mod)), prev: (pol.flags as any).fresh ? {} : prev, ids, tag: "n",
      noLate: !!(pol.flags as any).noLate, noLast: !!(pol.flags as any).noLast };
    const p: Plan = X.buildDay(diOf(date), m);
    const c = convert(date, p);
    const sig = c.assignments.map((a) => `${a.staff}|${a.demand_id}|${a.start}|${a.end}`).sort().join(";");
    const same = options.find((o) => o._sig === sig);
    if (same) { same.policies.push(pol.key); same.label += " · " + pol.label; continue; }

    const nid: Record<string, any> = {};
    p.req.forEach((r) => (nid[r.id] = r));
    const OB: Record<string, any> = {}, NB: Record<string, any> = {};
    b.req.forEach((r) => (OB[r.sig] = r));
    p.req.forEach((r) => (NB[r.sig] = r));
    const nst: Record<string, string> = {}, ntm: Record<string, string> = {};
    p.bars.forEach((x) => { nst[nid[x.req].sig] = x.staff; ntm[nid[x.req].sig] = x.s + "-" + x.e; });
    const slot = (r: any, st: string | undefined, plan: Plan) => {
      if (!r) return null;
      const bars = plan.bars.filter((x) => x.req === r.id);
      return { staff: st ?? null, start: bars.length ? Math.min(...bars.map((x) => x.s)) : r.s, end: bars.length ? Math.max(...bars.map((x) => x.e)) : r.e,
        students: r.students ?? [r.code] };
    };
    const diff: any[] = [];
    const isRt = (n: any, t: string) => t === "retimed" || (n && (n.late || n.released) && t !== "removed");
    const tagged: { e: any; t: string; os?: string; n?: any }[] = [];
    for (const sg of Object.keys(OB)) {
      const o = OB[sg], n = NB[sg];
      let t: string | null = null;
      if (!n) t = "removed";
      else if (prev[sg] !== nst[sg]) t = nst[sg] ? (n.late || n.released ? "retimed" : "moved") : "gap";
      else if ((o.students || []).join() !== (n.students || []).join()) t = "group";
      else if (prevTime[sg] !== ntm[sg]) t = "retimed";
      if (!t) continue;
      const e = { demand_id: demandId(date, o), type: t, before: slot(o, prev[sg], b), after: n ? slot(n, nst[sg], p) : null };
      diff.push(e); tagged.push({ e, t, os: prev[sg], n });
    }
    for (const sg of Object.keys(NB)) {
      if (OB[sg]) continue;
      const n = NB[sg], t = nst[sg] ? "added" : "gap";
      const e = { demand_id: demandId(date, n), type: t, before: null, after: slot(n, nst[sg], p) };
      diff.push(e); tagged.push({ e, t, n });
    }
    diff.sort((x, y) => (x.before ?? x.after).start - (y.before ?? y.after).start || x.demand_id.localeCompare(y.demand_id));

    // 연쇄 단계 (시안 W5와 같은 규칙)
    const away = mod.away ?? {};
    const steps: any[] = [{ step: 1, cause: null, reason: { code: "REQUESTED", op_index: 0 }, demand_ids: diff.map((e) => e.demand_id) }];
    const push = (code: string, list: typeof tagged, cause: number, params?: any) => {
      if (!list.length) return 0;
      steps.push({ step: steps.length + 1, cause, reason: params ? { code, params } : { code }, demand_ids: list.map((x) => x.e.demand_id) });
      return steps.length;
    };
    const dem = tagged.filter((x) => ["removed", "added", "group"].includes(x.t));
    const sDem = push("MOVE_SUPPORT_NEEDED", dem, 1);
    const mv = tagged.filter((x) => x.t === "moved" && !isRt(x.n, x.t));
    const isAway = (x: (typeof tagged)[number]) => !!(x.os && away[x.os]);
    // 이전 담당자가 새 배정에서 그 시간에 다른 일을 맡았는지
    const busy = (x: (typeof tagged)[number]) =>
      !!x.os && c.assignments.some((a) => a.staff === x.os && a.demand_id !== x.e.demand_id && a.start < x.e.before.end && x.e.before.start < a.end);
    const fresh = !!(pol.flags as any).fresh;
    const sUn = push("UNAVAILABLE", mv.filter(isAway), 1);
    push("OVERLAP", mv.filter((x) => !isAway(x) && (busy(x) || !fresh)), sUn || sDem || 1);
    push("REPLANNED", mv.filter((x) => !isAway(x) && !busy(x) && fresh), 1);
    push("EDGE_RELEASED", tagged.filter((x) => isRt(x.n, x.t)), sDem || sUn || 1);
    push("GAP", tagged.filter((x) => x.t === "gap"), 1);

    options.push({ _sig: sig, key: pol.k, policies: [pol.key], label: pol.label, ...c, metrics: metricsOf(c, diff), diff, explanation: steps });
  }
  // 합쳐진 선택지는 A, B, C 순서로 다시 이름 붙임
  return options.map(({ _sig, demands, ...o }, i) => ({ ...o, key: "ABC"[i], _demands: demands }));
}
const staffWindows = (date: string, away: Record<string, [number, number]> = {}) =>
  staff.map((a: any) => ({
    staff: a.code, date,
    available: a.availability.filter((v: any) => v.day === dayOf(date)).map((v: any) => ({ start: v.start, end: v.end })),
    absent: away[a.code] ? [{ start: away[a.code][0], end: away[a.code][1] }] : [],
  }));

// ---------------------------------------------------------------- 쓰기
rmSync(OUT, { recursive: true, force: true });

// domain/
write("domain/school.json", schoolBundle);
write("domain/students.json", students);
write("domain/staff.json", staff);
write("domain/timetable-2026-09.json", { source: "file", date_from: "2026-09-01", date_to: "2026-09-30", school_days: schoolDays, lessons });

// demand/ + schedule/
write(`demand/${TODAY}.json`, { date_from: TODAY, date_to: TODAY, version_id: "ver_0901", absent: [], demands: base[TODAY].demands });
write("demand/2026-09.json", {
  date_from: "2026-09-01", date_to: "2026-09-30", version_id: "ver_0901", absent: [],
  demands: schoolDays.flatMap((d) => base[d].demands),
});
const version = {
  id: "ver_0901", parent_id: null, status: "active", date_from: "2026-09-01", date_to: "2026-09-30", cause: "setup",
  created_by: { kind: "member", code: "T01" }, created_at: "2026-08-31T15:00:00+09:00", activated_at: "2026-08-31T15:10:00+09:00",
};
write("schedule/active-2026-09.json", {
  _note: "9월 active 버전의 배정. 임시 규칙 엔진(정책: 처음부터)으로 날짜마다 계산",
  version,
  assignments: schoolDays.flatMap((d) => base[d].assignments),
  shortfalls: schoolDays.flatMap((d) => base[d].shortfalls),
  metrics_by_date: Object.fromEntries(schoolDays.map((d) => [d, metricsOf(base[d])])),
});

// scheduler/ : 연쇄 시나리오 S1(결석), S2(출장) — fixtures/scenarios/cascade-scenarios.json과 같은 요청
const CASES = [
  { name: "absent", mod: { absent: ["S03"] }, away: {}, ops: [{ op: "mark_absent", student: "S03", when: { date: TODAY } }],
    text: `${LABEL.S03} 오늘 결석`, summary: [`${LABEL.S03} · 9월 18일(금) 결석`] },
  { name: "staff-away", mod: { away: { A01: [630, 690] } }, away: { A01: [630, 690] as [number, number] },
    ops: [{ op: "staff_unavailable", staff: "A01", when: [{ date: TODAY, start: "10:30", end: "11:30" }] }],
    text: `${LABEL.A01} 10시 30분부터 11시 30분까지 출장`, summary: [`${LABEL.A01} · 9월 18일(금) 10:30–11:30 부재`] },
];
const proposals: Record<string, any> = {};
for (const cs of CASES) {
  const opts = propose(TODAY, cs.mod, cs.ops);
  const newDemands = opts[0]._demands;
  const input = {
    dates: [TODAY], now: null, demands: newDemands, staff: staffWindows(TODAY, cs.away),
    previous: { demands: base[TODAY].demands, assignments: base[TODAY].assignments },
    pinned: [], policies: POLICIES.map((p) => p.key), request: { change_request_id: `cr_${cs.name}`, ops: cs.ops },
  };
  const output = { options: opts.map(({ _demands, ...o }) => o), engine: { name: "heuristic", version: "prototype-v12.29", elapsed_ms: 12 } };
  write(`scheduler/propose.${cs.name}.input.json`, input);
  write(`scheduler/propose.${cs.name}.output.json`, output);
  proposals[cs.name] = { input, output, cs };
}

// 연쇄 시나리오 입력 (fixtures/scenarios/inputs/, 계약 ProposeInput). M1·M2가 같은 입력으로 시나리오를 돌린다.
// 시안 엔진이 수요를 만들 수 있는 것만 만든다. 나머지(S6 과목 장소, S8 지원 구간, S9 반 장소, S10 시간표)는 M3 merge 뒤 그 결과로 만든다.
{
  const SCN_DIR = join(ROOT, "fixtures/scenarios");
  const set = json(join(SCN_DIR, "cascade-scenarios.json"));
  const MODS: Record<string, { mod: any; away: Record<string, [number, number]> }> = {
    S1: { mod: { absent: ["S03"] }, away: {} },
    S2: { mod: { away: { A01: [630, 690] } }, away: { A01: [630, 690] } },
    S3: { mod: { away: { A03: [520, 1000] } }, away: { A03: [520, 1000] } },
    S4: { mod: { place: { S01: { 2: "K1" } } }, away: {} },
    S5: { mod: { place: { S04: { 1: "K1" } } }, away: {} },
    S7: { mod: {}, away: {} },
  };
  rmSync(join(SCN_DIR, "inputs"), { recursive: true, force: true });
  mkdirSync(join(SCN_DIR, "inputs"), { recursive: true });
  for (const sc of set.scenarios) {
    delete sc.input;
    const m = MODS[sc.id];
    if (!m) continue;
    const ops = sc.trigger.type === "change_ops" ? sc.trigger.ops : [];
    const opts = propose(sc.date, m.mod, ops);
    const input = {
      dates: [sc.date], now: null, demands: opts[0]._demands, staff: staffWindows(sc.date, m.away),
      previous: { demands: base[sc.date].demands, assignments: base[sc.date].assignments },
      pinned: [], policies: POLICIES.map((p) => p.key), request: ops.length ? { change_request_id: null, ops } : null,
    };
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
function validate(demands: any[], windows: any[], assignments: any[]) {
  const violations: any[] = [];
  const byStaff: Record<string, any[]> = {};
  assignments.forEach((a) => (byStaff[a.staff] ??= []).push(a));
  for (const [s, list] of Object.entries(byStaff)) {
    list.sort((a, b) => a.start - b.start);
    for (let i = 1; i < list.length; i++)
      if (list[i].start < list[i - 1].end)
        violations.push({ code: "OVERLAP", staff: s, demand_ids: [list[i - 1].demand_id, list[i].demand_id], date: list[i].date,
          start: list[i].start, end: Math.min(list[i].end, list[i - 1].end) });
  }
  const per: Record<string, number> = {};
  assignments.forEach((a) => (per[a.demand_id] = (per[a.demand_id] ?? 0) + 1));
  demands.filter((d) => d.kind === "move_group" && per[d.id] > 1).forEach((d) =>
    violations.push({ code: "MOVE_GROUP_HEADCOUNT", staff: null, demand_ids: [d.id], date: d.date, start: d.start, end: d.end }));
  return violations;
}
{
  const asg = structuredClone(base[TODAY].assignments);
  const target = asg.find((a: any) => a.staff === "A01" && a.demand_id.startsWith("mv:"))!;
  const edited = asg.concat([{ ...target, staff: "A02" }]).sort((x: any, y: any) => x.start - y.start || x.staff.localeCompare(y.staff));
  const vin = { demands: base[TODAY].demands, staff: staffWindows(TODAY), pinned: [], assignments: edited };
  const vout = { violations: validate(vin.demands, vin.staff, edited), shortfalls: base[TODAY].shortfalls };
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
    previous_assignments: pin.input.previous.assignments, policy: policyOut(POLICIES[0]), time_limit_ms: 5000,
  });
  write("solver/assign.response.json", {
    status: "feasible", assignments: optA.assignments, shortfalls: optA.shortfalls,
    solver_meta: { elapsed_ms: 840, objective_stages: [0, optA.metrics.gaps, 0, optA.metrics.changed_cells, 0], message: "목데이터: 임시 규칙 엔진 결과를 그대로 넣음" },
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
      students: students.map((s: any) => ({ code: s.code, label: s.label, class_group: s.class_group, special_class: s.special_class })),
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
    code: s.code, label: s.label, class_group: s.class_group, special_class: s.special_class,
    lessons: lessons.filter((l) => l.class_group === s.class_group && l.date === date).map((l) => {
      const k = s.special_class_subjects.find((x: any) => x.subject === l.subject);
      return { period: l.period, subject: l.subject, placement: k ? "special_class" : "homeroom", location: k ? k.location : s.class_group };
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
    attendance: st.attendance, checks: st.checks, notes, metrics: { staff_minutes: metricsOf(c).staff_minutes },
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
const newStudent = { label: "학생8", class_group: "6-2", special_class: "K2", special_class_subjects: [{ subject: "국어", location: "K2" }],
  support_subjects: [{ subject: "과학", need_start: true, need_mid: true, need_end: true }], support_note: "" };
api("students.add", [
  { title: "학생 추가", input: newStudent, output: { code: "S08", ...newStudent } },
  { title: "실명으로 보이는 별칭은 거부", input: { ...newStudent, label: "홍길동" }, error: { code: "NAME_SUSPECTED", message: "사람 이름으로 보이는 별칭은 쓸 수 없어요. 학생8처럼 별칭을 써 주세요.", details: { field: "label" } } },
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
  const wk = WEEK.map((d) => base[d]);
  const all = { demands: wk.flatMap((c) => c.demands), assignments: wk.flatMap((c) => c.assignments), shortfalls: wk.flatMap((c) => c.shortfalls) };
  api("schedule.generate", [{ title: "최초 생성 9/14–9/18", input: { date_from: "2026-09-14", date_to: "2026-09-18" },
    output: { version: draft, option: { key: "A", policies: ["fresh"], label: "처음부터 다시", assignments: all.assignments, shortfalls: all.shortfalls,
      metrics: metricsOf(all as any), diff: [], explanation: [] } } }]);
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
  { title: "실명으로 보이는 입력", input: { raw_text: "김철수 오늘 결석", today: TODAY }, error: { code: "NAME_SUSPECTED", message: "사람 이름으로 보이는 말이 있어요. 학생1처럼 별칭으로 써 주세요.", details: { spans: [[0, 3]] } } },
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
