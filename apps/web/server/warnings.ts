// 배치 경고 (ScheduleValidateOutput.warnings). 엔진 입력에 없는 특수학급 시간표·교사 정보로 서버가 계산한다.
import type { IsoDate, ProcedureOutput, Timetable } from "@ssyung/schema";
import type { Deps } from "./deps.ts";
import { studentRows, type Base } from "./school.ts";
import type { DayData } from "./store.ts";

type Warning = ProcedureOutput<"schedule.validate">["warnings"][number];

/** 한 특수학급 한 칸 학생 수 기준. 이보다 많으면 SPECIAL_CLASS_CROWDED (tasks/M7-questions.md Q1) */
export const CROWDED_LIMIT = 5;

export function placementWarnings(deps: Deps, base: Base, timetable: Timetable, date: IsoDate, dd: DayData): Warning[] {
  const blocks = deps.core.blocksOn(base.school.bell, date);
  const blockOf = (period: number) => blocks.find((b) => b.kind === "class" && b.period === period);
  const out: Warning[] = [];

  for (const u of dd.unplaced.filter((x) => x.date === date)) {
    const b = blockOf(u.period);
    if (!b) continue;
    out.push({
      code: "SPECIAL_CLASS_UNPLACED", date, start: b.start, end: b.end,
      params: { student: u.student, period: u.period, subject: u.subject, reason: u.reason },
    });
  }

  // 특수학급·교시마다 모인 학생
  const rooms = new Map<string, { location: string; period: number; students: string[] }>();
  for (const row of studentRows(deps, base, timetable, date, dd)) {
    for (const l of row.lessons) {
      if (l.placement !== "special_class" || !l.location) continue;
      const k = `${l.location}|${l.period}`;
      if (!rooms.has(k)) rooms.set(k, { location: l.location, period: l.period, students: [] });
      rooms.get(k)!.students.push(row.code);
    }
  }
  const byLocation = new Map(base.school.special_classes.map((k) => [k.location, k]));
  for (const r of [...rooms.values()].sort((a, b) => a.period - b.period || a.location.localeCompare(b.location))) {
    const b = blockOf(r.period);
    const k = byLocation.get(r.location);
    if (!b || !k) continue;
    if (k.teachers.length === 0) {
      out.push({ code: "NO_SPECIAL_TEACHER", date, start: b.start, end: b.end, params: { special_class: k.code, period: r.period } });
    }
    if (r.students.length > CROWDED_LIMIT) {
      out.push({
        code: "SPECIAL_CLASS_CROWDED", date, start: b.start, end: b.end,
        params: { special_class: k.code, period: r.period, students: r.students.length, limit: CROWDED_LIMIT },
      });
    }
  }
  return out.sort((a, b) => a.start - b.start);
}
