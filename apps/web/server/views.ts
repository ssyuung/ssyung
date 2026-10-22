// 읽기 화면 조립 (view.*). active 버전 배정 + 수요 생성 결과 + 하루 운영 기록(메모리).
import type { Demand, DayView, IsoDate, StaffCode, StaffTodayView, Timetable } from "@ssyung/schema";
import type { Deps } from "./deps.ts";
import {
  activeVersion, assertInVersion, assertSchoolDay, dayData, getVersion, loadBase, loadTimetable, studentRows,
  type Base,
} from "./school.ts";
import type { VersionRecord } from "./store.ts";
import { addDays, floor10, kst } from "./time.ts";

export const studentsOf = (d: Demand): string[] =>
  d.kind === "move_group" ? d.students.map((x) => x.student) : d.kind === "duty" ? d.students : [d.student];

function assembleDay(deps: Deps, base: Base, timetable: Timetable, rec: VersionRecord, date: IsoDate): DayView {
  assertInVersion(rec, date);
  assertSchoolDay(timetable, date);
  const dd = dayData(deps, base, timetable, rec, date);
  const label = new Map(base.staff.map((a) => [a.code, a.label]));
  const assignments = rec.assignments.filter((a) => a.date === date);
  const staffMinutes = rec.metrics_by_date[date]?.staff_minutes
    ?? assignments.reduce<Record<string, number>>((m, a) => ({ ...m, [a.staff]: (m[a.staff] ?? 0) + a.end - a.start }), {});
  const { store } = deps;
  return {
    date,
    version: { id: rec.version.id, status: rec.version.status },
    bell: deps.core.blocksOn(base.school.bell, date),
    students: studentRows(deps, base, timetable, date, dd),
    staff: dd.staff
      .filter((w) => label.has(w.staff))
      .map((w) => ({ code: w.staff, label: label.get(w.staff)!, available: w.available, absent: w.absent })),
    demands: dd.demands,
    assignments,
    shortfalls: rec.shortfalls.filter((s) => s.date === date),
    attendance: [...store.attendance.values()].filter((a) => a.date === date),
    checks: [...store.checks.values()].filter((c) => c.cell.date === date),
    notes: store.notes.filter((n) => n.cell.date === date),
    metrics: { staff_minutes: staffMinutes },
  };
}

export async function dayView(deps: Deps, date: IsoDate, versionId?: string): Promise<DayView> {
  const rec = versionId ? getVersion(deps, versionId) : activeVersion(deps);
  const base = await loadBase(deps);
  return assembleDay(deps, base, await loadTimetable(deps, base.school, [date]), rec, date);
}

/** week_start부터 5일 중 수업일만 */
export async function weekView(deps: Deps, weekStart: IsoDate, versionId?: string) {
  const rec = versionId ? getVersion(deps, versionId) : activeVersion(deps);
  const base = await loadBase(deps);
  const dates = [0, 1, 2, 3, 4].map((i) => addDays(weekStart, i));
  const timetable = await loadTimetable(deps, base.school, dates);
  const days = dates
    .filter((d) => timetable.school_days.includes(d) && rec.version.date_from <= d && d <= rec.version.date_to)
    .map((d) => assembleDay(deps, base, timetable, rec, d));
  return { week_start: weekStart, days };
}

/** 지원인력 한 명이 맡은 배정과 관련 학생만 남긴 하루 */
export function filterDayForStaff(day: DayView, staff: StaffCode): DayView {
  const assignments = day.assignments.filter((a) => a.staff === staff);
  const mine = new Set(assignments.map((a) => a.demand_id));
  const demands = day.demands.filter((d) => mine.has(d.id));
  const kids = new Set(demands.flatMap(studentsOf));
  return {
    ...day,
    students: day.students.filter((s) => kids.has(s.code)),
    staff: day.staff.filter((s) => s.code === staff),
    demands,
    assignments,
    shortfalls: [],
    attendance: day.attendance.filter((a) => kids.has(a.student)),
    checks: day.checks.filter((c) => mine.has(c.cell.demand_id)),
    notes: day.notes.filter((n) => mine.has(n.cell.demand_id)),
  };
}

export async function staffToday(deps: Deps, staff: StaffCode, date: IsoDate): Promise<StaffTodayView> {
  const now = kst(deps.clock());
  const day = filterDayForStaff(await dayView(deps, date), staff);
  // [도착] 대기: 이미 시작했는데 완료 체크가 없는 이동 묶음 중 가장 이른 것
  const nowMin = floor10(now.minute);
  const started = (start: number) => date < now.date || (date === now.date && start <= nowMin);
  const moves = new Set(day.demands.filter((d) => d.kind === "move_group").map((d) => d.id));
  const checked = new Set(day.checks.map((c) => `${c.cell.start}|${c.cell.demand_id}`));
  const pending = day.assignments
    .filter((a) => moves.has(a.demand_id) && started(a.start) && !checked.has(`${a.start}|${a.demand_id}`))
    .sort((a, b) => a.start - b.start)[0];
  const unacked = [...deps.store.notifications.values()]
    .filter((n) => n.staff === staff && n.acknowledged_at === null)
    .sort((a, b) => a.sent_at.localeCompare(b.sent_at));
  return { staff, date, now: nowMin, day, pending_move: pending?.demand_id ?? null, unacked };
}

/** 현재 배치로 생기는 이동 묶음 (⑥) */
export async function previewMoveGroups(deps: Deps, date: IsoDate): Promise<Demand[]> {
  const base = await loadBase(deps);
  const timetable = await loadTimetable(deps, base.school, [date]);
  assertSchoolDay(timetable, date);
  const ds = deps.core.generateDemands({ school: base.school, timetable, students: base.students, dates: [date] });
  return ds.demands.filter((d) => d.kind === "move_group");
}

/** 지원인력이 오늘 맡은 칸(수요 id)과 학생. 오늘이 active 버전 밖이거나 수업일이 아니면 비어 있다 */
export async function todayScope(deps: Deps, staff: StaffCode): Promise<{ date: IsoDate; demandIds: Set<string>; students: Set<string> }> {
  const date = kst(deps.clock()).date;
  const empty = { date, demandIds: new Set<string>(), students: new Set<string>() };
  const rec = activeVersion(deps);
  const assignments = rec.assignments.filter((a) => a.date === date && a.staff === staff);
  if (assignments.length === 0) return empty;
  const base = await loadBase(deps);
  const dd = dayData(deps, base, await loadTimetable(deps, base.school, [date]), rec, date);
  const demandIds = new Set(assignments.map((a) => a.demand_id));
  const students = new Set(dd.demands.filter((d) => demandIds.has(d.id)).flatMap(studentsOf));
  return { date, demandIds, students };
}

