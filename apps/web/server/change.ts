// 변경 요청 (change.*, proposal.*): 원문 → 실명 검사 → 해석 → 확인 → 다시 배정 → 승인.
import { ceil10, InterpretContext, weekdayOf } from "@ssyung/schema";
import type {
  Actor, Assignment, ChangeOp, ChangeRequest, Demand, IsoDate, ProcedureInput, ProcedureOutput, Proposal, ScheduleVersion,
} from "@ssyung/schema";
import type { Deps } from "./deps.ts";
import { ApiFail } from "./errors.ts";
import { activeVersion, assertSchoolDay, dayData, loadBase, loadTimetable, staffWindows, type Base } from "./school.ts";
import { activate, metricsByDate, notifyStaff, splitDays } from "./schedule.ts";
import { summarize } from "./summary.ts";
import { addDays, dateLabel, kst } from "./time.ts";
import { studentsOf } from "./views.ts";

/** 실명 검사 (가짜). 걸리면 NAME_SUSPECTED */
export function guardText(deps: Deps, text: string, field?: string) {
  const spans = deps.nameGuard.detect(text);
  if (spans.length === 0) return;
  throw new ApiFail(
    "NAME_SUSPECTED", "사람 이름으로 보이는 말이 있어요. 학생1처럼 별칭으로 써 주세요.",
    field ? { field, spans: spans.map((s) => [s.start, s.end]) } : { spans: spans.map((s) => [s.start, s.end]) },
  );
}

const labeler = (base: Base) => {
  const m = new Map<string, string>([
    ...base.students.map((s): [string, string] => [s.code, s.label]),
    ...base.staff.map((a): [string, string] => [a.code, a.label]),
    ...base.school.locations.map((l): [string, string] => [l.code, l.label]),
  ]);
  return (code: string) => m.get(code) ?? code;
};

/** 해석기 컨텍스트: 이번 주 월요일 ~ 다음 주 금요일 (cost-strategy.md §2.3) */
export async function interpretContext(deps: Deps, base: Base, today: IsoDate): Promise<InterpretContext> {
  const offset = ({ SUN: -6, MON: 0, TUE: -1, WED: -2, THU: -3, FRI: -4, SAT: -5 } as const)[weekdayOf(today)];
  const dates = Array.from({ length: 12 }, (_, i) => addDays(today, offset + i));
  const timetable = await loadTimetable(deps, base.school, dates);
  const bell = base.school.bell[0]?.blocks ?? [];
  const periods = bell.filter((b) => b.kind === "class" && b.period !== null).map((b) => b.period!);
  const classes = [...new Set(base.students.map((s) => s.class_group))].sort();
  const schoolDays = dates.filter((d) => timetable.school_days.includes(d));
  return InterpretContext.parse({
    today,
    calendar: dates.map((d) => ({ date: d, day: weekdayOf(d), school_day: timetable.school_days.includes(d) })),
    bell,
    part_of_day: {
      morning: bell.filter((b) => b.kind === "class" && b.part_of_day === "morning").map((b) => b.period),
      afternoon: bell.filter((b) => b.kind === "class" && b.part_of_day === "afternoon").map((b) => b.period),
    },
    class_subjects: Object.fromEntries(classes.map((c) => [c, Object.fromEntries(schoolDays.map((d) => [d,
      periods.map((p) => timetable.lessons.find((l) => l.class_group === c && l.date === d && l.period === p)?.subject ?? null),
    ]))])),
    codes: {
      students: base.students.map((s) => ({ code: s.code, label: s.label, class_group: s.class_group })),
      staff: base.staff.map((a) => ({ code: a.code, label: a.label })),
      locations: base.school.locations.filter((l) => l.kind !== "homeroom").map((l) => ({ code: l.code, label: l.label })),
    },
  });
}

export async function interpret(deps: Deps, actor: Actor, input: ProcedureInput<"change.interpret">): Promise<ChangeRequest> {
  guardText(deps, input.raw_text);
  const base = await loadBase(deps);
  const context = await interpretContext(deps, base, input.today);
  const cr: ChangeRequest = {
    id: deps.store.nextId("cr"), base_version_id: deps.store.activeId, raw_text: input.raw_text, parsed: null, summary: [],
    status: "failed", created_by: actor.code, created_at: kst(deps.clock()).iso,
  };
  try {
    const { result } = await deps.interpreter.interpret({ raw_text: input.raw_text, context });
    cr.parsed = result;
    cr.summary = summarize(result.ops, labeler(base));
    cr.status = "parsed";
  } finally {
    deps.store.changeRequests.set(cr.id, cr);
  }
  return cr;
}

/** pin_assignment → 고정 배정. 그 학생(업무)의 수요 중 지칭한 시간과 겹치는 것 전체 */
function pinsOf(deps: Deps, base: Base, ops: ChangeOp[], dates: IsoDate[], demands: Demand[]): Assignment[] {
  const out: Assignment[] = [];
  for (const op of ops) {
    if (op.op !== "pin_assignment") continue;
    for (const r of deps.core.resolveWhen(op.when, base.school.bell, dates)) {
      for (const d of demands) {
        if (d.date !== r.date || !(d.start < r.end && r.start < d.end)) continue;
        const hit = "student" in op.target
          ? studentsOf(d).includes(op.target.student)
          : d.kind === "duty" && d.duty === op.target.duty;
        if (hit) out.push({ staff: op.staff, demand_id: d.id, date: d.date, start: d.start, end: d.end, mode: "normal", pinned: true });
      }
    }
  }
  return out;
}

/** 해석 확인 → 날짜마다 수요·근무를 다시 만들고 active 배정 위에서 선택지 3개 */
export async function confirm(deps: Deps, input: ProcedureInput<"change.confirm">): Promise<Proposal> {
  const cr = deps.store.changeRequests.get(input.change_request_id);
  if (!cr) throw new ApiFail("NOT_FOUND", `변경 요청 ${input.change_request_id}이 없어요.`);
  if (cr.status === "approved" || cr.status === "rejected") throw new ApiFail("VALIDATION", "이미 끝난 변경 요청이에요.");
  const { ops } = input;
  if (ops.unsupported !== null || ops.ops.length === 0) throw new ApiFail("VALIDATION", "반영할 변경이 없어요.");
  const whens = ops.ops.flatMap((op) => (Array.isArray(op.when) ? op.when : [op.when]));
  if (whens.some((w) => !("date" in w))) {
    throw new ApiFail("NOT_IMPLEMENTED", "매주 반복하는 변경(요일 지정)은 아직 반영하지 못해요.");
  }
  const dates = [...new Set(whens.map((w) => ("date" in w ? w.date : "")))].sort();

  const rec = activeVersion(deps);
  for (const d of dates) {
    if (d < rec.version.date_from || d > rec.version.date_to) {
      throw new ApiFail("VALIDATION", `${dateLabel(d)}은 지금 배정 기간(${rec.version.date_from}–${rec.version.date_to}) 밖이에요.`);
    }
  }
  const base = await loadBase(deps);
  const timetable = await loadTimetable(deps, base.school, dates);
  for (const d of dates) assertSchoolDay(timetable, d);

  // 오늘 변경이면 요청 시각부터 (D24)
  const clock = kst(deps.clock());
  const now = dates.includes(clock.date) ? { date: clock.date, minute: ceil10(clock.minute) } : null;
  const allOps = [...rec.ops, ...ops.ops];
  const ds = deps.core.generateDemands({
    school: base.school, timetable, students: base.students, dates, ops: allOps, version_id: rec.version.id,
    ...(now ? { now } : {}),
  });
  const staff = dates.flatMap((d) => staffWindows(deps, base, d, allOps));
  const before = dates.map((d) => dayData(deps, base, timetable, rec, d));
  const previous = {
    demands: before.flatMap((x) => x.demands),
    assignments: rec.assignments.filter((a) => dates.includes(a.date)),
  };
  const ids = new Set(ds.demands.map((d) => d.id));
  const pinned = [
    ...previous.assignments.filter((a) => a.pinned && ids.has(a.demand_id)),
    ...pinsOf(deps, base, ops.ops, dates, ds.demands),
  ];

  let out;
  try {
    out = await deps.engine.propose({
      dates, now, demands: ds.demands, staff, previous, pinned, policies: ["keep_minimal", "fresh", "no_late"],
      request: { change_request_id: cr.id, ops: ops.ops, cause: "change_request" },
    });
  } catch (e) {
    cr.status = "failed";
    throw e;
  }
  const proposal: Proposal = {
    id: deps.store.nextId("prp"), change_request_id: cr.id, base_version_id: rec.version.id, dates,
    options: out.options, recommended: out.options[0]!.key,
  };
  deps.store.proposals.set(proposal.id, {
    proposal, status: "pending", ops, days: splitDays(dates, ds.demands, ds.unplaced, staff, allOps, now),
  });
  cr.parsed = ops;
  cr.summary = summarize(ops.ops, labeler(base));
  cr.status = "proposed";
  return proposal;
}

/** 고른 선택지의 배정으로 새 active 버전. 기준 버전이 바뀌었으면 BASE_VERSION_CHANGED */
export async function approve(deps: Deps, actor: Actor, input: ProcedureInput<"proposal.approve">): Promise<ProcedureOutput<"proposal.approve">> {
  const p = deps.store.proposals.get(input.proposal_id);
  if (!p) throw new ApiFail("NOT_FOUND", `제안 ${input.proposal_id}이 없어요.`);
  if (p.proposal.base_version_id !== deps.store.activeId) {
    throw new ApiFail("BASE_VERSION_CHANGED", "다른 변경이 먼저 승인됐어요. 다시 계산할게요.", {
      base_version_id: p.proposal.base_version_id, active_version_id: deps.store.activeId,
    });
  }
  if (p.status !== "pending") throw new ApiFail("VALIDATION", "이미 처리한 제안이에요.");
  const option = p.proposal.options.find((o) => o.key === input.option_key);
  if (!option) throw new ApiFail("VALIDATION", `선택지 ${input.option_key}이 없어요.`);

  const parent = activeVersion(deps);
  const dates = p.proposal.dates;
  const inDates = (d: IsoDate) => dates.includes(d);
  const base = await loadBase(deps);
  const at = kst(deps.clock()).iso;
  const version: ScheduleVersion = {
    ...parent.version, id: deps.store.nextId("ver"), parent_id: parent.version.id, status: "active",
    cause: "change_request", created_by: actor, created_at: at, activated_at: at,
  };
  const demands = [...p.days.values()].flatMap((x) => x.demands);
  const days = new Map(parent.days);
  for (const [d, dd] of p.days) days.set(d, dd);
  activate(deps, {
    version,
    assignments: [...parent.assignments.filter((a) => !inDates(a.date)), ...option.assignments],
    shortfalls: [...parent.shortfalls.filter((s) => !inDates(s.date)), ...option.shortfalls],
    metrics_by_date: {
      ...parent.metrics_by_date,
      ...metricsByDate(deps, dates, demands, option.assignments, option.shortfalls, option.diff, base.staff.map((a) => a.code)),
    },
    ops: [...parent.ops, ...p.ops.ops],
    days,
  }, at);
  p.status = "approved";
  const cr = deps.store.changeRequests.get(p.proposal.change_request_id);
  if (cr) cr.status = "approved";

  const notified = option.metrics.notify_staff;
  const when = dates.map(dateLabel).join(", ");
  await notifyStaff(deps, notified, version.id, (s) => {
    const n = option.diff.filter((e) => e.before?.staff === s || e.after?.staff === s).length;
    return `${when} 배정이 바뀌었어요 (${n}칸)`;
  });
  return { version, notified };
}

export function reject(deps: Deps, input: ProcedureInput<"proposal.reject">): { ok: true } {
  const p = deps.store.proposals.get(input.proposal_id);
  if (!p) throw new ApiFail("NOT_FOUND", `제안 ${input.proposal_id}이 없어요.`);
  if (p.status === "approved") throw new ApiFail("VALIDATION", "이미 승인한 제안이에요.");
  p.status = "rejected";
  const cr = deps.store.changeRequests.get(p.proposal.change_request_id);
  if (cr) cr.status = "rejected";
  return { ok: true };
}
