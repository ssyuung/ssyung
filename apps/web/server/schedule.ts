// 배정 (schedule.*): 최초 생성, 검증·수동 수정, 활성화, 되돌리기. 버전·배정은 메모리 (v1).
import type {
  Actor, Assignment, ChangeOp, Demand, DiffEntry, IsoDate, Metrics, ProcedureInput, ProcedureOutput, ScheduleVersion,
  Shortfall, StaffCode,
} from "@ssyung/schema";
import type { Deps } from "./deps.ts";
import { ApiFail } from "./errors.ts";
import {
  activeVersion, assertInVersion, dayData, getVersion, loadBase, loadTimetable, staffWindows,
} from "./school.ts";
import type { DayData, VersionRecord } from "./store.ts";
import { dateLabel, kst } from "./time.ts";
import { placementWarnings } from "./warnings.ts";

const dateOfDemandId = (id: string) => id.split(":")[1]!;

/** 날짜마다 지표 (엔진 지표 함수를 날짜별로) */
export function metricsByDate(
  deps: Deps, dates: IsoDate[], demands: Demand[], assignments: Assignment[], shortfalls: Shortfall[], diff: DiffEntry[],
  staffCodes: string[],
): Record<IsoDate, Metrics> {
  return Object.fromEntries(dates.map((d) => [d, deps.engine.computeMetrics(
    demands.filter((x) => x.date === d), assignments.filter((a) => a.date === d), shortfalls.filter((s) => s.date === d),
    diff.filter((e) => dateOfDemandId(e.demand_id) === d), staffCodes,
  )]));
}

/** 날짜별 수요·근무를 DayData로 나눔 */
export function splitDays(
  dates: IsoDate[], demands: Demand[], unplaced: DayData["unplaced"], staff: DayData["staff"], ops: DayData["ops"], now: DayData["now"],
) {
  return new Map(dates.map((d): [IsoDate, DayData] => [d, {
    demands: demands.filter((x) => x.date === d),
    unplaced: unplaced.filter((u) => u.date === d),
    staff: staff.filter((w) => w.date === d),
    ops,
    now: now?.date === d ? now : null,
  }]));
}

/** 새 버전을 active로. 이전 active는 archived */
export function activate(deps: Deps, rec: VersionRecord, at: string): void {
  const prev = deps.store.versions.get(deps.store.activeId);
  if (prev && prev !== rec) prev.version = { ...prev.version, status: "archived" };
  rec.version = { ...rec.version, status: "active", activated_at: at };
  deps.store.versions.set(rec.version.id, rec);
  deps.store.activeId = rec.version.id;
}

/** 배정이 바뀐 지원인력에게 버전 알림 (가짜 알림: 메모리 기록) */
export async function notifyStaff(deps: Deps, staff: StaffCode[], versionId: string, summaryOf: (s: StaffCode) => string) {
  const at = kst(deps.clock()).iso;
  for (const code of staff) {
    const n = {
      id: deps.store.nextId("ntf"), staff: code, kind: "version" as const, version_id: versionId, ref_id: null,
      channel: "push" as const, sent_at: at, acknowledged_at: null, summary: summaryOf(code).slice(0, 200),
    };
    deps.store.notifications.set(n.id, n);
    await deps.notifier.send(n);
  }
}

/** 날짜 범위의 수요 → 처음부터 배정 → draft 버전 */
export async function generate(deps: Deps, actor: Actor, input: ProcedureInput<"schedule.generate">): Promise<ProcedureOutput<"schedule.generate">> {
  if (input.date_from > input.date_to) throw new ApiFail("VALIDATION", "시작 날짜가 끝 날짜보다 늦어요.");
  const base = await loadBase(deps);
  const timetable = await loadTimetable(deps, base.school, [input.date_from, input.date_to]);
  const dates = timetable.school_days.filter((d) => input.date_from <= d && d <= input.date_to);
  if (dates.length === 0) throw new ApiFail("NOT_SCHOOL_DAY", "그 기간에는 수업일이 없어요.");

  const ds = deps.core.generateDemands({ school: base.school, timetable, students: base.students, dates });
  const staff = dates.flatMap((d) => staffWindows(deps, base, d, []));
  const out = await deps.engine.propose({
    dates, now: null, demands: ds.demands, staff, previous: null, pinned: [], policies: ["fresh"], request: null,
  });
  const option = out.options[0]!;
  const now = kst(deps.clock()).iso;
  const version: ScheduleVersion = {
    id: deps.store.nextId("ver"), parent_id: null, status: "draft", date_from: input.date_from, date_to: input.date_to,
    cause: "setup", created_by: actor, created_at: now, activated_at: null,
  };
  deps.store.versions.set(version.id, {
    version,
    assignments: option.assignments,
    shortfalls: option.shortfalls,
    metrics_by_date: metricsByDate(deps, dates, ds.demands, option.assignments, option.shortfalls, [], base.staff.map((a) => a.code)),
    ops: [],
    days: splitDays(dates, ds.demands, ds.unplaced, staff, [], null),
  });
  return { version, option };
}

async function check(deps: Deps, input: ProcedureInput<"schedule.validate">) {
  const rec = getVersion(deps, input.version_id);
  assertInVersion(rec, input.date);
  const stray = input.assignments.find((a) => a.date !== input.date);
  if (stray) throw new ApiFail("VALIDATION", `배정 날짜(${stray.date})가 ${input.date}와 달라요.`);
  const base = await loadBase(deps);
  const timetable = await loadTimetable(deps, base.school, [input.date]);
  const dd = dayData(deps, base, timetable, rec, input.date);
  const pinned = rec.assignments.filter((a) => a.date === input.date && a.pinned);
  const res = deps.engine.validate({ demands: dd.demands, staff: dd.staff, pinned, assignments: input.assignments });
  const output = {
    violations: res.violations,
    shortfalls: res.shortfalls,
    warnings: placementWarnings(deps, base, timetable, input.date, dd),
  };
  return { rec, dd, base, output };
}

/** 엔진 검증 + 배치 경고 */
export async function validateDraft(deps: Deps, input: ProcedureInput<"schedule.validate">): Promise<ProcedureOutput<"schedule.validate">> {
  return (await check(deps, input)).output;
}

/** draft의 그날 배정을 바꿔 저장. 위반이 있어도 저장하고 결과로 돌려준다 */
export async function updateDraft(deps: Deps, input: ProcedureInput<"schedule.updateDraft">): Promise<ProcedureOutput<"schedule.updateDraft">> {
  const rec = getVersion(deps, input.version_id);
  if (rec.version.status !== "draft") throw new ApiFail("VALIDATION", "draft 버전만 고칠 수 있어요.");
  const { dd, base, output } = await check(deps, input);
  const d = input.date;
  rec.assignments = [...rec.assignments.filter((a) => a.date !== d), ...input.assignments];
  rec.shortfalls = [...rec.shortfalls.filter((s) => s.date !== d), ...output.shortfalls];
  rec.metrics_by_date = {
    ...rec.metrics_by_date,
    ...metricsByDate(deps, [d], dd.demands, input.assignments, output.shortfalls, [], base.staff.map((a) => a.code)),
  };
  rec.days.set(d, dd);
  return output;
}

/** 두 버전에서 날짜들의 배정이 다른 지원인력 */
function changedStaff(a: Assignment[], b: Assignment[], dates: (d: IsoDate) => boolean): StaffCode[] {
  const sig = (list: Assignment[]) => {
    const m = new Map<string, string[]>();
    for (const x of list.filter((x) => dates(x.date))) {
      if (!m.has(x.staff)) m.set(x.staff, []);
      m.get(x.staff)!.push(`${x.date}|${x.start}|${x.end}|${x.demand_id}|${x.mode}`);
    }
    return new Map([...m].map(([k, v]) => [k, v.sort().join(",")]));
  };
  const sa = sig(a);
  const sb = sig(b);
  return [...new Set([...sa.keys(), ...sb.keys()])].filter((s) => sa.get(s) !== sb.get(s)).sort();
}

/** 기간 밖 날짜만 남긴 변경. 날짜가 기간 안인 지칭은 뺀다 */
function opsOutside(ops: ChangeOp[], inRange: (d: IsoDate) => boolean): ChangeOp[] {
  return ops.flatMap((op) => {
    const whens = (Array.isArray(op.when) ? op.when : [op.when]).filter((w) => !("date" in w) || !inRange(w.date));
    return whens.length === 0 ? [] : [{ ...op, when: whens } as ChangeOp];
  });
}

/**
 * draft → active. draft 기간만 draft 배정으로 바꾸고, 그 밖의 날짜는 이전 active 배정을 그대로 둔다(Q3).
 * 새 버전의 기간은 둘을 합친 것. 배정이 바뀐 지원인력에게 알림
 */
export async function activateDraft(deps: Deps, input: ProcedureInput<"schedule.activate">): Promise<ProcedureOutput<"schedule.activate">> {
  const rec = getVersion(deps, input.version_id);
  if (rec.version.status !== "draft") throw new ApiFail("VALIDATION", "draft 버전만 활성화할 수 있어요.");
  const prev = activeVersion(deps);
  const { date_from, date_to } = rec.version;
  const inDraft = (d: IsoDate) => date_from <= d && d <= date_to;
  const notified = changedStaff(prev.assignments, rec.assignments, inDraft);

  rec.version = {
    ...rec.version,
    date_from: prev.version.date_from < date_from ? prev.version.date_from : date_from,
    date_to: prev.version.date_to > date_to ? prev.version.date_to : date_to,
  };
  rec.assignments = [...prev.assignments.filter((a) => !inDraft(a.date)), ...rec.assignments.filter((a) => inDraft(a.date))];
  rec.shortfalls = [...prev.shortfalls.filter((s) => !inDraft(s.date)), ...rec.shortfalls.filter((s) => inDraft(s.date))];
  rec.metrics_by_date = {
    ...Object.fromEntries(Object.entries(prev.metrics_by_date).filter(([d]) => !inDraft(d))),
    ...Object.fromEntries(Object.entries(rec.metrics_by_date).filter(([d]) => inDraft(d))),
  };
  rec.ops = [...opsOutside(prev.ops, inDraft), ...rec.ops];
  rec.days = new Map([...[...prev.days].filter(([d]) => !inDraft(d)), ...[...rec.days].filter(([d]) => inDraft(d))]);
  activate(deps, rec, kst(deps.clock()).iso);
  await notifyStaff(deps, notified, rec.version.id,
    () => `${dateLabel(date_from)}–${dateLabel(date_to)} 배정이 바뀌었어요`);
  return { version: rec.version, notified };
}

/** 과거 버전을 복제해 draft로 */
export function rollback(deps: Deps, actor: Actor, input: ProcedureInput<"schedule.rollback">): ProcedureOutput<"schedule.rollback"> {
  const src = getVersion(deps, input.version_id);
  if (src.version.status === "draft") throw new ApiFail("VALIDATION", "draft 버전은 되돌릴 대상이 아니에요.");
  const version: ScheduleVersion = {
    ...src.version, id: deps.store.nextId("ver"), parent_id: src.version.id, status: "draft", cause: "rollback",
    created_by: actor, created_at: kst(deps.clock()).iso, activated_at: null,
  };
  deps.store.versions.set(version.id, {
    version,
    assignments: structuredClone(src.assignments),
    shortfalls: structuredClone(src.shortfalls),
    metrics_by_date: structuredClone(src.metrics_by_date),
    ops: structuredClone(src.ops),
    days: new Map(src.days),
  });
  return version;
}

