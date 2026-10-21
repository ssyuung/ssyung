// 엔진·검증·diff가 함께 쓰는 작은 도구
import type { Assignment, Demand, StaffWindow } from "@ssyung/schema";

export const overlaps = (s1: number, e1: number, s2: number, e2: number) => s1 < e2 && s2 < e1;

/** 수요에 걸린 학생 */
export function studentsOf(d: Demand): string[] {
  if (d.kind === "move_group") return d.students.map((x) => x.student);
  if (d.kind === "duty") return d.students;
  return [d.student];
}

/** 근무 가능 구간 안이고 부재와 겹치지 않으면 true */
export function canWork(w: StaffWindow | undefined, start: number, end: number): boolean {
  if (!w) return false;
  if (!w.available.some((v) => v.start <= start && end <= v.end)) return false;
  return !w.absent.some((v) => overlaps(start, end, v.start, v.end));
}

export const byStartStaff = (a: Assignment, b: Assignment) =>
  a.date.localeCompare(b.date) || a.start - b.start || a.staff.localeCompare(b.staff) || a.demand_id.localeCompare(b.demand_id);

export function groupBy<T, K>(list: T[], key: (x: T) => K): Map<K, T[]> {
  const m = new Map<K, T[]>();
  for (const x of list) {
    const k = key(x);
    const arr = m.get(k);
    if (arr) arr.push(x);
    else m.set(k, [x]);
  }
  return m;
}

/** 배정 목록이 같은지 비교하는 서명 (선택지 합치기) */
export const assignmentSig = (list: Assignment[]) =>
  list.map((a) => `${a.date}|${a.staff}|${a.demand_id}|${a.start}|${a.end}|${a.mode}`).sort().join(";");
