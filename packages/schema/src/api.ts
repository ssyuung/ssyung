// 시스템 API 계약 (architecture.md §9.1). tRPC 프로시저마다 input·output을 고정한다.
// 계약 라우터(M7)·가짜 라우터(packages/testing)·화면(M8·M9)이 모두 이 표를 쓴다.
// 목데이터: fixtures/mock/api/<프로시저>.json  ({ input, output } 또는 { input, error })
import { z } from "zod";
import {
  ClassGroupCode, Id, IsoDate, IsoDateTime, Label, LocationRef, SpecialClassCode, StaffCode, StudentCode, Subject,
} from "./ids.ts";
import { Interval, Minute, TimeBlock } from "./time.ts";
import {
  Attendance, CellCheck, CellNote, CellRef, ClassGroup, Memo, Notification, ScheduleVersion, SchoolBundle,
  Staff, StaffInput, Student, StudentInput,
} from "./domain.ts";
import { FloorLayoutFile } from "./dataset.ts";
import { Demand, DemandId } from "./demand.ts";
import { ChangeOps } from "./change-ops.ts";
import { Assignment, Metrics, Option, Shortfall, ValidateOutput } from "./scheduler.ts";

// ---------- 오류 ----------
export const ApiErrorCode = z.enum([
  "UNAUTHORIZED", "FORBIDDEN", "NOT_FOUND", "VALIDATION",
  "NAME_SUSPECTED", // 실명으로 보이는 입력 (M5)
  "BASE_VERSION_CHANGED", // 승인 시점 active 버전이 다름 → 재계산 필요
  "NOT_SCHOOL_DAY", "NOT_IMPLEMENTED",
]);
export const ApiError = z.object({
  code: ApiErrorCode,
  message: z.string(),
  details: z.record(z.string(), z.unknown()).optional(),
});

// ---------- 읽기 화면 모델 ----------
/** 학생 한 명의 그날 수업 (W2·T1 행) */
export const StudentDayRow = z.object({
  code: StudentCode,
  label: Label,
  class_group: ClassGroupCode,
  special_class: SpecialClassCode,
  lessons: z.array(z.object({
    period: z.number().int(),
    subject: Subject,
    placement: z.enum(["homeroom", "special_class"]),
    location: LocationRef,
  })),
});
/** W2 학생 현황·W2b 지원인력 현황·T1 교사 앱이 공통으로 쓰는 하루 */
export const DayView = z.object({
  date: IsoDate,
  version: ScheduleVersion.pick({ id: true, status: true }),
  bell: z.array(TimeBlock),
  students: z.array(StudentDayRow),
  staff: z.array(z.object({ code: StaffCode, label: Label, available: z.array(Interval), absent: z.array(Interval) })),
  demands: z.array(Demand),
  assignments: z.array(Assignment),
  shortfalls: z.array(Shortfall),
  attendance: z.array(Attendance),
  checks: z.array(CellCheck),
  notes: z.array(CellNote),
  metrics: Metrics.pick({ staff_minutes: true }),
});
/** A1 지원인력 앱 오늘 화면 */
export const StaffTodayView = z.object({
  staff: StaffCode,
  date: IsoDate,
  now: Minute.describe("서버 기준 현재 시각(10분 내림). 지금 할 일·이동 카드 계산용"),
  day: DayView.describe("이 지원인력이 맡은 배정과 관련 학생만 남긴 하루"),
  pending_move: DemandId.nullable().describe("[도착] 확인을 기다리는 이동 묶음 (§6.6)"),
  unacked: z.array(Notification).describe("열 때 팝업으로 띄울 미확인 버전 알림"),
});
export const WeekView = z.object({
  week_start: IsoDate,
  days: z.array(DayView).max(5),
});

// ---------- 변경 요청 ----------
export const ChangeRequestStatus = z.enum(["parsed", "confirmed", "proposed", "approved", "rejected", "failed"]);
export const ChangeRequest = z.object({
  id: Id,
  base_version_id: Id,
  raw_text: z.string(),
  parsed: ChangeOps.nullable(),
  summary: z.array(z.string()).describe("해석 확인 화면에 보일 문장 (packages/core가 ops에서 만듦)"),
  status: ChangeRequestStatus,
  created_by: z.string(),
  created_at: IsoDateTime,
});
export const Proposal = z.object({
  id: Id,
  change_request_id: Id,
  base_version_id: Id,
  dates: z.array(IsoDate),
  options: z.array(Option).min(1),
  recommended: z.string().regex(/^[A-Z]$/),
});

// ---------- 프로시저 ----------
const ok = z.object({ ok: z.literal(true) });
const p = <I extends z.ZodType, O extends z.ZodType>(input: I, output: O, caller: string) => ({ input, output, caller });

export const procedures = {
  // 학교·설정 (W1)
  "school.search": p(z.object({ query: z.string().min(2) }), z.array(z.object({
    label: z.string(), neis_office_code: z.string(), neis_school_code: z.string(), address: z.string(),
  })), "교사"),
  "school.import": p(z.object({ neis_office_code: z.string(), neis_school_code: z.string(), academic_year: z.number().int() }),
    z.object({ class_groups: z.array(ClassGroup), timetable: z.object({ date_from: IsoDate, date_to: IsoDate, lesson_count: z.number().int(), skipped_rows: z.number().int() }) }), "교사"),
  "school.get": p(z.object({}), SchoolBundle, "교사·지원인력"),
  "setup.saveLayout": p(FloorLayoutFile.omit({ _note: true, school: true }), SchoolBundle, "교사"),
  "setup.previewMoveGroups": p(z.object({ date: IsoDate }), z.array(Demand), "교사"),
  // 학생·지원인력 (W1 ④⑧)
  "students.list": p(z.object({}), z.array(Student), "교사"),
  "students.add": p(StudentInput, Student, "교사"),
  "students.update": p(z.object({ code: StudentCode, patch: StudentInput.partial() }), Student, "교사"),
  "students.remove": p(z.object({ code: StudentCode }), ok, "교사"),
  "staff.list": p(z.object({}), z.array(Staff), "교사"),
  "staff.add": p(StaffInput, Staff, "교사"),
  "staff.update": p(z.object({ code: StaffCode, patch: StaffInput.partial() }), Staff, "교사"),
  "staff.remove": p(z.object({ code: StaffCode }), ok, "교사"),
  // 읽기 (W2·W2b·W3·A1·T1). 서버가 조립한다
  "view.day": p(z.object({ date: IsoDate, version_id: Id.optional() }), DayView, "교사"),
  "view.week": p(z.object({ week_start: IsoDate, version_id: Id.optional() }), WeekView, "교사"),
  "view.staffToday": p(z.object({ date: IsoDate }), StaffTodayView, "지원인력 (자기 것만)"),
  // 배정 (W4)
  "schedule.generate": p(z.object({ date_from: IsoDate, date_to: IsoDate }),
    z.object({ version: ScheduleVersion, option: Option }), "교사"),
  "schedule.validate": p(z.object({ version_id: Id, date: IsoDate, assignments: z.array(Assignment) }), ValidateOutput, "교사"),
  "schedule.updateDraft": p(z.object({ version_id: Id, date: IsoDate, assignments: z.array(Assignment) }), ValidateOutput, "교사"),
  "schedule.activate": p(z.object({ version_id: Id }), z.object({ version: ScheduleVersion, notified: z.array(StaffCode) }), "교사"),
  "schedule.rollback": p(z.object({ version_id: Id }), ScheduleVersion, "교사"),
  // 변경 요청 (W5·T3)
  "change.interpret": p(z.object({ raw_text: z.string().min(1).max(500), today: IsoDate }), ChangeRequest, "교사"),
  "change.confirm": p(z.object({ change_request_id: Id, ops: ChangeOps }), Proposal, "교사"),
  "proposal.approve": p(z.object({ proposal_id: Id, option_key: z.string().regex(/^[A-Z]$/) }),
    z.object({ version: ScheduleVersion, notified: z.array(StaffCode) }), "교사"),
  "proposal.reject": p(z.object({ proposal_id: Id }), ok, "교사"),
  // 하루 운영 (A1·T1)
  "attendance.set": p(z.object({ date: IsoDate, student: StudentCode }), Attendance, "지원인력(오늘 맡은 학생)·교사"),
  "attendance.clear": p(z.object({ date: IsoDate, student: StudentCode }), ok, "지원인력·교사"),
  "cell.check": p(z.object({ cell: CellRef, arrived_students: z.array(StudentCode).nullable() }), CellCheck, "지원인력·교사"),
  "cell.uncheck": p(z.object({ cell: CellRef }), ok, "지원인력·교사"),
  "cell.note": p(z.object({ cell: CellRef, body: z.string().min(1).max(500) }), CellNote, "지원인력·교사"),
  "memo.post": p(z.object({ student: StudentCode, body: z.string().min(1).max(1000) }), Memo, "지원인력·교사"),
  "memo.markRead": p(z.object({ memo_id: Id }), ok, "지원인력·교사"),
  "notification.ack": p(z.object({ notification_id: Id }), Notification, "지원인력"),
  // 기기 (A2–A4)
  "staff.issueInvite": p(z.object({ staff: StaffCode }), z.object({ code: z.string().length(6), expires_at: IsoDateTime }), "교사"),
  "staff.revokeDevice": p(z.object({ staff: StaffCode }), ok, "교사"),
  "device.redeemInvite": p(z.object({ code: z.string().length(6), push_token: z.string().nullable() }),
    z.object({ staff: StaffCode, label: Label, session_token: z.string() }), "지원인력 앱"),
} as const;

export type ProcedureName = keyof typeof procedures;
export type ProcedureInput<N extends ProcedureName> = z.infer<(typeof procedures)[N]["input"]>;
export type ProcedureOutput<N extends ProcedureName> = z.infer<(typeof procedures)[N]["output"]>;

/** fixtures/mock/api/*.json 한 파일의 형식 */
export const apiMockSchema = (name: ProcedureName) =>
  z.object({
    _note: z.string().optional(),
    procedure: z.literal(name),
    examples: z.array(z.union([
      z.object({ title: z.string(), input: procedures[name].input, output: procedures[name].output }),
      z.object({ title: z.string(), input: procedures[name].input, error: ApiError }),
    ])).min(1),
  });

export type DayView = z.infer<typeof DayView>;
export type StaffTodayView = z.infer<typeof StaffTodayView>;
export type ChangeRequest = z.infer<typeof ChangeRequest>;
export type Proposal = z.infer<typeof Proposal>;
export type ApiError = z.infer<typeof ApiError>;

/** 버전 하나의 날짜 범위 배정 전체 (목데이터 schedule/*.json, JsonRepository 저장 형식) */
export const ScheduleSnapshot = z.object({
  _note: z.string().optional(),
  version: ScheduleVersion,
  assignments: z.array(Assignment),
  shortfalls: z.array(Shortfall),
  metrics_by_date: z.record(IsoDate, Metrics),
});
export type ScheduleSnapshot = z.infer<typeof ScheduleSnapshot>;
