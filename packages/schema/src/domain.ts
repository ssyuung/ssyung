// 도메인 객체. Repository(M4)가 돌려주고 API(M7)·화면(M8·M9)이 쓴다. 이름 필드 없음.
import { z } from "zod";
import {
  ClassGroupCode, DutyCode, Floor, Id, IsoDate, IsoDateTime, Label, LocationRef, SpecialClassCode,
  StaffCode, StudentCode, Subject, TeacherCode,
} from "./ids.ts";
import { BellSchedule, Day, Interval, Minute } from "./time.ts";
import { SpecialClassSubject, SupportSubject } from "./dataset.ts";

export const School = z.object({
  id: Id,
  label: z.string().max(40),
  neis_office_code: z.string(),
  neis_school_code: z.string(),
  academic_year: z.number().int(),
  floors: z.number().int().min(1).max(20),
  timezone: z.literal("Asia/Seoul"),
});

export const LocationKind = z.enum(["homeroom", "special_class", "special_room", "office", "outdoor"]);
export const Location = z.object({
  code: LocationRef,
  label: Label,
  kind: LocationKind,
  floor: Floor,
});

export const ClassGroup = z.object({
  code: ClassGroupCode,
  grade: z.number().int().min(1).max(6),
  home_location: LocationRef,
  has_timetable: z.boolean().describe("시간표 자료가 없는 반(개발 데이터의 1-3)은 false"),
});

export const SpecialClass = z.object({
  code: SpecialClassCode,
  location: LocationRef,
  teachers: z.array(TeacherCode),
});

/** ①③ 결과를 한 번에: 학교, 일과, 장소, 반, 특수학급 */
export const SchoolBundle = z.object({
  school: School,
  bell: z.array(BellSchedule),
  locations: z.array(Location),
  class_groups: z.array(ClassGroup),
  special_classes: z.array(SpecialClass),
});

/** 날짜별 원반 시간표 한 칸 (D18). 시각은 일과(bell)에서 찾는다 */
export const ClassLesson = z.object({
  class_group: ClassGroupCode,
  date: IsoDate,
  period: z.number().int().min(1).max(8),
  subject: Subject,
});
export const Timetable = z.object({
  source: z.enum(["file", "neis_api"]),
  date_from: IsoDate,
  date_to: IsoDate,
  school_days: z.array(IsoDate),
  lessons: z.array(ClassLesson),
});

export const Student = z.object({
  code: StudentCode,
  label: Label,
  class_group: ClassGroupCode,
  special_class: SpecialClassCode,
  special_class_subjects: z.array(SpecialClassSubject),
  support_subjects: z.array(SupportSubject),
  support_note: z.string().max(500),
});
export const StudentInput = Student.omit({ code: true });

export const StaffAvailability = z.object({ day: Day, start: Minute, end: Minute });
export const Staff = z.object({
  code: StaffCode,
  label: Label,
  availability: z.array(StaffAvailability),
});
export const StaffInput = Staff.omit({ code: true });

export const Duty = z.object({
  code: DutyCode,
  label: Label,
  day: Day,
  start: Minute,
  end: Minute,
  location: LocationRef,
  headcount: z.number().int().min(1),
  students: z.array(StudentCode).describe("동행 학생 (D9)"),
});

/** 누가 했는지. 교사는 member(T 코드), 지원인력은 staff(A 코드) */
export const Actor = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("member"), code: TeacherCode }),
  z.object({ kind: z.literal("staff"), code: StaffCode }),
]);

// ---------- 버전 ----------
export const VersionStatus = z.enum(["draft", "active", "archived"]);
export const VersionCause = z.enum(["setup", "change_request", "timetable_import", "manual", "rollback"]);
export const ScheduleVersion = z.object({
  id: Id,
  parent_id: Id.nullable(),
  status: VersionStatus,
  date_from: IsoDate,
  date_to: IsoDate,
  cause: VersionCause,
  created_by: Actor.nullable(),
  created_at: IsoDateTime,
  activated_at: IsoDateTime.nullable(),
});

// ---------- 하루 운영: 등교, 완료 체크, 칸 메모, 메모, 알림 ----------
/** D21: 지원인력 앱에는 등교만. 결석은 변경 요청(mark_absent)으로 */
export const Attendance = z.object({
  date: IsoDate,
  student: StudentCode,
  status: z.literal("present"),
  checked_by: Actor,
  checked_at: IsoDateTime,
});

/** 칸 = (날짜, 시작 시각, 수요). 버전이 아니라 칸에 붙어 배정이 바뀌어도 남는다 (D16) */
export const CellRef = z.object({
  date: IsoDate,
  start: Minute,
  demand_id: z.string(),
});
export const CellCheck = z.object({
  cell: CellRef,
  staff: StaffCode,
  done_at: IsoDateTime,
  done_by: Actor,
  arrived_students: z.array(StudentCode).nullable().describe("이동 묶음일 때 도착 확인한 학생"),
});
export const CellNote = z.object({
  id: Id,
  cell: CellRef,
  author: Actor,
  body: z.string().min(1).max(500),
  created_at: IsoDateTime,
});
export const Memo = z.object({
  id: Id,
  student: StudentCode,
  author: Actor,
  body: z.string().min(1).max(1000),
  created_at: IsoDateTime,
  read_by: z.array(Actor),
});
export const Notification = z.object({
  id: Id,
  staff: StaffCode,
  kind: z.enum(["version", "cell_note", "memo"]),
  version_id: Id.nullable(),
  ref_id: Id.nullable(),
  channel: z.enum(["push", "sms", "in_app"]),
  sent_at: IsoDateTime,
  acknowledged_at: IsoDateTime.nullable(),
  summary: z.string().max(200),
});

export type School = z.infer<typeof School>;
export type SchoolBundle = z.infer<typeof SchoolBundle>;
export type Location = z.infer<typeof Location>;
export type ClassGroup = z.infer<typeof ClassGroup>;
export type ClassLesson = z.infer<typeof ClassLesson>;
export type Timetable = z.infer<typeof Timetable>;
export type Student = z.infer<typeof Student>;
export type Staff = z.infer<typeof Staff>;
export type Duty = z.infer<typeof Duty>;
export type Actor = z.infer<typeof Actor>;
export type ScheduleVersion = z.infer<typeof ScheduleVersion>;
export type Attendance = z.infer<typeof Attendance>;
export type CellRef = z.infer<typeof CellRef>;
export type CellCheck = z.infer<typeof CellCheck>;
export type CellNote = z.infer<typeof CellNote>;
export type Memo = z.infer<typeof Memo>;
export type Notification = z.infer<typeof Notification>;
