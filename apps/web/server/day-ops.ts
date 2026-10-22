// 하루 운영 (attendance.*, cell.*, memo.*, notification.ack)과 기기 연결. 메모리 (v1).
// 지원인력은 오늘 자기 배정에 걸린 학생·칸만 다룬다.
import { randomBytes, randomInt } from "node:crypto";
import type {
  Actor, Attendance, CellCheck, CellNote, CellRef, Memo, Notification, ProcedureInput, ProcedureOutput, StaffCode,
} from "@ssyung/schema";
import { guardText } from "./change.ts";
import type { Deps } from "./deps.ts";
import { ApiFail } from "./errors.ts";
import { activeVersion, dayData, loadBase, loadTimetable } from "./school.ts";
import { cellKey } from "./store.ts";
import { kst } from "./time.ts";
import { todayScope } from "./views.ts";

const forbidden = (what: string) => new ApiFail("FORBIDDEN", `오늘 맡은 ${what}만 다룰 수 있어요.`);

async function assertStudentInScope(deps: Deps, actor: Actor, date: string, student: string) {
  if (actor.kind !== "staff") return;
  const scope = await todayScope(deps, actor.code);
  if (date !== scope.date || !scope.students.has(student)) throw forbidden("학생");
}

async function assertStudentExists(deps: Deps, student: string) {
  if (!(await deps.repo.students.list()).some((s) => s.code === student)) throw new ApiFail("NOT_FOUND", `${student}가 없어요.`);
}

// ---------- 등교 ----------
export async function attendanceSet(deps: Deps, actor: Actor, input: ProcedureInput<"attendance.set">): Promise<Attendance> {
  await assertStudentExists(deps, input.student);
  await assertStudentInScope(deps, actor, input.date, input.student);
  const a: Attendance = { date: input.date, student: input.student, status: "present", checked_by: actor, checked_at: kst(deps.clock()).iso };
  deps.store.attendance.set(`${input.date}|${input.student}`, a);
  return a;
}

export async function attendanceClear(deps: Deps, actor: Actor, input: ProcedureInput<"attendance.clear">): Promise<{ ok: true }> {
  await assertStudentInScope(deps, actor, input.date, input.student);
  deps.store.attendance.delete(`${input.date}|${input.student}`);
  return { ok: true };
}

// ---------- 칸 ----------
/** 칸의 수요와 맡은 지원인력. 지원인력이면 자기가 오늘 맡은 칸이어야 한다 */
async function resolveCell(deps: Deps, actor: Actor, cell: CellRef) {
  const rec = activeVersion(deps);
  const base = await loadBase(deps);
  const demand = rec.version.date_from <= cell.date && cell.date <= rec.version.date_to
    ? dayData(deps, base, await loadTimetable(deps, base.school, [cell.date]), rec, cell.date).demands.find((d) => d.id === cell.demand_id)
    : undefined;
  if (!demand) throw new ApiFail("NOT_FOUND", `${cell.date} ${cell.demand_id} 칸이 없어요.`);
  const assigned = rec.assignments.filter((a) => a.date === cell.date && a.demand_id === cell.demand_id);
  if (actor.kind === "staff") {
    const scope = await todayScope(deps, actor.code);
    if (cell.date !== scope.date || !scope.demandIds.has(cell.demand_id)) throw forbidden("칸");
    return { demand, staff: actor.code };
  }
  const owner = assigned.find((a) => a.start === cell.start) ?? assigned[0];
  return { demand, staff: owner?.staff ?? null };
}

export async function cellCheck(deps: Deps, actor: Actor, input: ProcedureInput<"cell.check">): Promise<CellCheck> {
  const { demand, staff } = await resolveCell(deps, actor, input.cell);
  if (!staff) throw new ApiFail("VALIDATION", "맡은 지원인력이 없는 칸이에요.");
  if (input.arrived_students !== null) {
    if (demand.kind !== "move_group") throw new ApiFail("VALIDATION", "도착 확인은 이동 묶음에서만 해요.");
    const members = new Set(demand.students.map((s) => s.student));
    const stray = input.arrived_students.find((s) => !members.has(s));
    if (stray) throw new ApiFail("VALIDATION", `${stray}는 이 이동 묶음에 없어요.`);
  }
  const c: CellCheck = {
    cell: input.cell, staff, done_at: kst(deps.clock()).iso, done_by: actor, arrived_students: input.arrived_students,
  };
  deps.store.checks.set(cellKey(input.cell), c);
  return c;
}

export async function cellUncheck(deps: Deps, actor: Actor, input: ProcedureInput<"cell.uncheck">): Promise<{ ok: true }> {
  await resolveCell(deps, actor, input.cell);
  deps.store.checks.delete(cellKey(input.cell));
  return { ok: true };
}

export async function cellNote(deps: Deps, actor: Actor, input: ProcedureInput<"cell.note">): Promise<CellNote> {
  guardText(deps, input.body, "body");
  await resolveCell(deps, actor, input.cell);
  const n: CellNote = { id: deps.store.nextId("note"), cell: input.cell, author: actor, body: input.body, created_at: kst(deps.clock()).iso };
  deps.store.notes.push(n);
  return n;
}

// ---------- 메모 ----------
export async function memoPost(deps: Deps, actor: Actor, input: ProcedureInput<"memo.post">): Promise<Memo> {
  guardText(deps, input.body, "body");
  await assertStudentExists(deps, input.student);
  await assertStudentInScope(deps, actor, kst(deps.clock()).date, input.student);
  const m: Memo = {
    id: deps.store.nextId("memo"), student: input.student, author: actor, body: input.body, created_at: kst(deps.clock()).iso, read_by: [],
  };
  deps.store.memos.set(m.id, m);
  return m;
}

export async function memoMarkRead(deps: Deps, actor: Actor, input: ProcedureInput<"memo.markRead">): Promise<{ ok: true }> {
  const m = deps.store.memos.get(input.memo_id);
  if (!m) throw new ApiFail("NOT_FOUND", `메모 ${input.memo_id}가 없어요.`);
  await assertStudentInScope(deps, actor, kst(deps.clock()).date, m.student);
  if (!m.read_by.some((a) => a.kind === actor.kind && a.code === actor.code)) m.read_by.push(actor);
  return { ok: true };
}

// ---------- 알림 ----------
export function notificationAck(deps: Deps, staff: StaffCode, input: ProcedureInput<"notification.ack">): Notification {
  const n = deps.store.notifications.get(input.notification_id);
  if (!n) throw new ApiFail("NOT_FOUND", `알림 ${input.notification_id}이 없어요.`);
  if (n.staff !== staff) throw new ApiFail("FORBIDDEN", "자기 알림만 확인할 수 있어요.");
  n.acknowledged_at ??= kst(deps.clock()).iso;
  return n;
}

// ---------- 기기 (초대 코드 6자리, 만료 하루) ----------
async function staffLabel(deps: Deps, staff: StaffCode): Promise<string> {
  const a = (await deps.repo.staff.list()).find((x) => x.code === staff);
  if (!a) throw new ApiFail("NOT_FOUND", `${staff}가 없어요.`);
  return a.label;
}

export async function issueInvite(deps: Deps, input: ProcedureInput<"staff.issueInvite">): Promise<ProcedureOutput<"staff.issueInvite">> {
  await staffLabel(deps, input.staff);
  const { invites } = deps.store;
  for (const [code, v] of invites) if (v.staff === input.staff) invites.delete(code);
  let code: string;
  do code = String(randomInt(100000, 1000000)); while (invites.has(code));
  const expires = new Date(deps.clock().getTime() + 24 * 60 * 60 * 1000);
  invites.set(code, { staff: input.staff, expires });
  return { code, expires_at: kst(expires).iso };
}

export async function revokeDevice(deps: Deps, input: ProcedureInput<"staff.revokeDevice">): Promise<{ ok: true }> {
  await staffLabel(deps, input.staff);
  const { invites, devices } = deps.store;
  for (const [code, v] of invites) if (v.staff === input.staff) invites.delete(code);
  for (const [token, v] of devices) if (v.staff === input.staff) devices.delete(token);
  return { ok: true };
}

export async function redeemInvite(deps: Deps, input: ProcedureInput<"device.redeemInvite">): Promise<ProcedureOutput<"device.redeemInvite">> {
  const inv = deps.store.invites.get(input.code);
  if (!inv || inv.expires <= deps.clock()) throw new ApiFail("NOT_FOUND", "코드가 없거나 만료됐어요.");
  const label = await staffLabel(deps, inv.staff);
  deps.store.invites.delete(input.code);
  const token = randomBytes(24).toString("base64url");
  deps.store.devices.set(token, { staff: inv.staff, push_token: input.push_token });
  return { staff: inv.staff, label, session_token: token };
}
