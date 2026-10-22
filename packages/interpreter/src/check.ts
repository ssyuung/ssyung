// 스키마 다음의 서버 검증: 코드가 컨텍스트에 있는지, 날짜·교시가 맞는지 (cost-strategy.md §2.4)
import type { ChangeOps, InterpretContext, When } from "@ssyung/schema";

/** 문제 목록. 비어 있으면 통과 */
export function checkOps(result: ChangeOps, ctx: InterpretContext): string[] {
  const problems: string[] = [];
  const students = new Set(ctx.codes.students.map((s) => s.code));
  const staff = new Set(ctx.codes.staff.map((s) => s.code));
  const locations = new Set(ctx.codes.locations.map((l) => l.code));
  const groups = new Set([...ctx.codes.students.map((s) => s.class_group), ...Object.keys(ctx.class_subjects)]);
  const dates = new Set(ctx.calendar.map((c) => c.date));
  const periods = new Set(ctx.bell.flatMap((b) => (b.kind === "class" && b.period != null ? [b.period] : [])));

  if (result.unsupported != null && result.ops.length > 0) problems.push("unsupported인데 ops가 있음");

  for (const [i, op] of result.ops.entries()) {
    const at = `ops[${i}]`;
    if ("student" in op && !students.has(op.student)) problems.push(`${at}: 없는 학생 ${op.student}`);
    if ("staff" in op && !staff.has(op.staff)) problems.push(`${at}: 없는 지원인력 ${op.staff}`);
    if ("location" in op && op.location != null && !locations.has(op.location)) problems.push(`${at}: 없는 장소 ${op.location}`);
    if (op.op === "relocate_class" && !groups.has(op.class_group)) problems.push(`${at}: 없는 반 ${op.class_group}`);
    if (op.op === "pin_assignment" && "student" in op.target && !students.has(op.target.student)) {
      problems.push(`${at}: 없는 학생 ${op.target.student}`);
    }
    for (const w of Array.isArray(op.when) ? op.when : [op.when]) {
      problems.push(...checkWhen(w, result.scope, dates, periods).map((p) => `${at}: ${p}`));
    }
  }
  return problems;
}

function checkWhen(w: When, scope: ChangeOps["scope"], dates: Set<string>, periods: Set<number>): string[] {
  const problems: string[] = [];
  if ("day" in w) {
    if (scope !== "permanent") problems.push("요일 지정은 permanent에서만");
  } else if (!dates.has(w.date)) {
    problems.push(`달력에 없는 날짜 ${w.date}`);
  }
  if ("period" in w && !periods.has(w.period)) problems.push(`없는 교시 ${w.period}`);
  if ("after_period" in w && !periods.has(w.after_period)) problems.push(`없는 교시 ${w.after_period}`);
  if ("start" in w && w.start >= w.end) problems.push(`시작이 끝보다 늦음 ${w.start}–${w.end}`);
  return problems;
}
