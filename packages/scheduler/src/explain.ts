// 연쇄 변경 설명 (§8.7). 엔진은 최종 해만 주므로, 이전·새 배정을 비교해 인과 순서를 다시 만든다.
// 요청 명령마다 뿌리 단계(REQUESTED)를 두고, 나머지 칸은 이전 담당자에게 무슨 일이 있었는지로 이유를 붙인다.
import type { Assignment, ChangeOp, DiffEntry, ExplanationStep, ProposeInput, StaffWindow } from "@ssyung/schema";
import type { Plan } from "./diff.ts";
import { canWork, overlaps } from "./util.ts";

type Code = ExplanationStep["reason"]["code"];
/** 단계 번호를 매길 때 같은 깊이에서의 순서 */
const ORDER: Code[] = ["REQUESTED", "TIMETABLE_CHANGED", "MOVE_SUPPORT_NEEDED", "UNAVAILABLE", "OVERLAP", "CONTINUITY", "EDGE_RELEASED", "GAP"];

type Tagged = { id: string; code: Code; causeIds: string[]; causeCode?: Code };

export type ExplainInput = {
  previous: Plan | null;
  next: Plan;
  staff: StaffWindow[];
  request: ProposeInput["request"];
  /** 이전 배정에 묶이지 않는 정책(fresh). 연쇄로 설명 못 하는 칸은 다시 배정한 결과로 보고 1단계에 둔다 */
  replanned?: boolean;
};

/** diff 항목마다 이유 코드를 붙인다. 붙이지 못한 항목은 unexplained로 돌려준다 (테스트에서 실패) */
export function classify(diff: DiffEntry[], { previous, next, staff }: ExplainInput) {
  const demands = new Map([...(previous?.demands ?? []), ...next.demands].map((d) => [d.id, d]));
  const win = new Map(staff.map((w) => [`${w.staff}|${w.date}`, w]));
  const date = (id: string) => demands.get(id)!.date;
  /** 새 배정에서 그 사람이 [s, e)에 맡은 다른 수요 */
  const busyWith = (staffCode: string, day: string, s: number, e: number, self: string) =>
    next.assignments
      .filter((a: Assignment) => a.staff === staffCode && a.date === day && a.demand_id !== self && overlaps(a.start, a.end, s, e))
      .map((a) => a.demand_id);

  const tagged: Tagged[] = [];
  const unexplained: string[] = [];
  for (const e of diff) {
    const d = demands.get(e.demand_id)!;
    const day = date(e.demand_id);
    const regrouped = !!e.before && !!e.after && e.before.students.join() !== e.after.students.join();
    if (e.type === "removed" || e.type === "added" || e.type === "group" || regrouped) {
      tagged.push({ id: e.demand_id, code: d.kind === "move_group" ? "MOVE_SUPPORT_NEEDED" : "REQUESTED", causeIds: [] });
      continue;
    }
    const b = e.before, a = e.after!;
    if (!b) {
      tagged.push({ id: e.demand_id, code: "GAP", causeIds: [] }); // 새 수요인데 맡을 사람 없음
      continue;
    }
    const p = b.staff;
    const away = p !== null && !canWork(win.get(`${p}|${day}`), b.start, b.end);
    const blockers = p !== null && !away ? busyWith(p, day, b.start, b.end, e.demand_id) : [];
    const viaAway = away ? ("UNAVAILABLE" as const) : undefined;

    if (e.type === "retimed") {
      // 담당이 그대로면, 비운 시작 10분을 가져간 두 번째 이동이 원인
      const own = p !== null && p === a.staff && a.start > b.start ? busyWith(p, day, b.start, a.start, e.demand_id) : [];
      tagged.push({ id: e.demand_id, code: "EDGE_RELEASED", causeIds: [...blockers, ...own], causeCode: viaAway });
    } else if (e.type === "gap") {
      tagged.push({ id: e.demand_id, code: "GAP", causeIds: blockers, causeCode: viaAway });
    } else if (away) {
      tagged.push({ id: e.demand_id, code: "UNAVAILABLE", causeIds: [] });
    } else if (blockers.length) {
      tagged.push({ id: e.demand_id, code: "OVERLAP", causeIds: blockers });
    } else {
      // 같은 학생의 바로 앞뒤 칸이 같은 사람에게 옮겨졌으면 함께 옮긴 것
      const mine = new Set(b.students);
      const near = diff.find(
        (f) => f !== e && f.after?.staff === a.staff && f.after.students.some((s) => mine.has(s)) &&
          (f.after.end === a.start || f.after.start === a.end),
      );
      if (near) tagged.push({ id: e.demand_id, code: "CONTINUITY", causeIds: [near.demand_id] });
      else unexplained.push(e.demand_id);
    }
  }
  return { tagged, unexplained };
}

/** 요청 명령마다 1단계짜리 뿌리를 둔다. 칸이 어느 명령에서 나왔는지는 학생·지원인력으로 찾고, 못 찾으면 첫 명령 */
function opFinder(request: ProposeInput["request"]) {
  const ops = request?.ops ?? [];
  const find = (hit: (op: ChangeOp) => boolean) => Math.max(0, ops.findIndex(hit));
  return {
    count: Math.max(1, ops.length),
    hasOps: ops.length > 0,
    byStudents: (students: string[]) => find((op) => "student" in op && students.includes(op.student)),
    byStaff: (staffCode: string | null) => find((op) => op.op === "staff_unavailable" && op.staff === staffCode),
  };
}

const keyOf = (code: Code, op?: number) => (op === undefined ? code : `${code}#${op}`);
const codeOfKey = (k: string) => k.split("#")[0] as Code;
const rank = (k: string) => ORDER.indexOf(codeOfKey(k)) * 100 + Number(k.split("#")[1] ?? 0);

export function explain(diff: DiffEntry[], input: ExplainInput): ExplanationStep[] {
  const { tagged, unexplained } = classify(diff, input);
  // 계약에 '다시 배정' 이유 코드가 없어 요청 단계에 둔다 (contracts/requests/M1-replanned-reason.md)
  if (input.replanned) for (const id of unexplained) tagged.push({ id, code: "REQUESTED", causeIds: [] });

  const ops = opFinder(input.request);
  const entry = new Map(diff.map((e) => [e.demand_id, e]));
  const studentsAt = (id: string) => [...(entry.get(id)?.before?.students ?? []), ...(entry.get(id)?.after?.students ?? [])];
  const opOf = (t: Tagged): number | undefined => {
    if (t.code === "REQUESTED" || t.code === "MOVE_SUPPORT_NEEDED") return ops.byStudents(studentsAt(t.id));
    if (t.code === "UNAVAILABLE") return ops.byStaff(entry.get(t.id)?.before?.staff ?? null);
    return undefined;
  };
  const groupKey = new Map(tagged.map((t) => [t.id, keyOf(t.code, opOf(t))]));
  const causeKeyOf = (t: Tagged) => (t.causeCode ? keyOf(t.causeCode, ops.byStaff(entry.get(t.id)?.before?.staff ?? null)) : undefined);

  const roots = Array.from({ length: ops.count }, (_, i) => keyOf("REQUESTED", i));
  const groups = new Map<string, { ids: string[]; cause: string | null }>(roots.map((k) => [k, { ids: [], cause: null }]));
  const position = (id: string) => diff.findIndex((e) => e.demand_id === id);
  for (const t of [...tagged].sort((x, y) => position(x.id) - position(y.id))) {
    const k = groupKey.get(t.id)!;
    const g = groups.get(k) ?? { ids: [], cause: null };
    g.ids.push(t.id);
    groups.set(k, g);
  }
  // 단계의 원인 = 구성원의 원인 중 자기 단계가 아닌 가장 앞선 것. 없으면 그 명령의 요청 단계
  for (const [k, g] of groups) {
    if (roots.includes(k)) continue;
    const causes = tagged
      .filter((t) => groupKey.get(t.id) === k)
      .flatMap((t) => [...t.causeIds.map((id) => groupKey.get(id) ?? roots[0]), causeKeyOf(t) ?? []].flat())
      .filter((c) => c !== k && groups.has(c));
    const op = k.split("#")[1];
    g.cause = causes.sort((x, y) => rank(x) - rank(y))[0] ?? (op !== undefined ? keyOf("REQUESTED", +op) : roots[0]);
  }
  // 원인을 따라 너비 우선으로 번호. 순환으로 닿지 못한 단계는 첫 요청에 붙인다
  const order = [...roots];
  for (let i = 0; i < order.length; i++) {
    const kids = [...groups].filter(([k, g]) => g.cause === order[i] && !order.includes(k)).map(([k]) => k);
    order.push(...kids.sort((x, y) => rank(x) - rank(y)));
    if (i === order.length - 1)
      for (const [k, g] of [...groups].sort(([x], [y]) => rank(x) - rank(y)))
        if (!order.includes(k)) { g.cause = roots[0]; order.push(k); }
  }
  const stepOf = new Map(order.map((k, i) => [k, i + 1]));
  return order.map((k) => {
    const g = groups.get(k)!;
    const code = codeOfKey(k);
    const opIndex = roots.includes(k) && ops.hasOps ? { op_index: roots.indexOf(k) } : {};
    return { step: stepOf.get(k)!, cause: g.cause ? stepOf.get(g.cause)! : null, reason: { code, ...opIndex }, demand_ids: g.ids };
  });
}

