// dataset/ 파일 형식. api/는 NEIS 응답 그대로(FileSource), db/는 화면에서 고치는 정보(JsonRepository).
import { z } from "zod";
import { ClassGroupCode, LocationRef, RoomCode, SpecialClassCode, StaffCode, StudentCode, Label, Subject } from "./ids.ts";
import { Day, HHMM } from "./time.ts";

// ---------- dataset/api/<학교>/ : NEIS 응답 행. 첫 행은 한글 열 이름이라 FileSource가 건너뛴다 ----------
export const NeisClassInfoRow = z.looseObject({
  ATPT_OFCDC_SC_CODE: z.string(),
  SD_SCHUL_CODE: z.string(),
  SCHUL_NM: z.string(),
  AY: z.string(),
  GRADE: z.string(),
  CLASS_NM: z.string(),
});
export const NeisTimetableRow = z.looseObject({
  ATPT_OFCDC_SC_CODE: z.string(),
  SD_SCHUL_CODE: z.string(),
  AY: z.string(),
  SEM: z.string(),
  ALL_TI_YMD: z.string().describe("YYYYMMDD"),
  GRADE: z.string(),
  CLASS_NM: z.string(),
  PERIO: z.string(),
  ITRT_CNTNT: z.string().describe("과목. 빈 값은 토요일·휴일 자리표시"),
});
export const NeisClassInfoFile = z.array(NeisClassInfoRow);
export const NeisTimetableFile = z.array(NeisTimetableRow);

// ---------- dataset/db/<학교>/ ----------
export const FloorLayoutFile = z.object({
  _note: z.string().optional(),
  school: z.object({
    name: z.string(),
    neis_office_code: z.string(),
    neis_school_code: z.string(),
    academic_year: z.number().int(),
  }),
  floors: z.number().int().min(1).max(20),
  special_classes: z.array(z.object({ code: SpecialClassCode, floor: z.number().int().min(1) })),
  classes: z.array(z.object({ class: ClassGroupCode, grade: z.number().int().min(1).max(6), floor: z.number().int().min(1) })),
  rooms: z.array(z.object({ code: RoomCode, label: Label, floor: z.number().int().min(1).nullable(), outdoor: z.boolean() })),
});

export const SpecialClassSubject = z.object({
  subject: Subject,
  location: LocationRef.describe("그 과목 수업 장소. 과목마다 다를 수 있음 (D20)"),
});
export const SupportSubject = z.object({
  subject: Subject,
  need_start: z.boolean(),
  need_mid: z.boolean(),
  need_end: z.boolean(),
});
export const StudentsFile = z.object({
  _note: z.string().optional(),
  students: z.array(
    z.object({
      code: StudentCode,
      label: Label,
      class: ClassGroupCode,
      special_class: SpecialClassCode,
      special_class_subjects: z.array(SpecialClassSubject),
      support_subjects: z.array(SupportSubject),
      support_note: z.string().max(500),
    }),
  ),
});

export const StaffFile = z.object({
  _note: z.string().optional(),
  staff: z.array(
    z.object({
      code: StaffCode,
      label: Label,
      availability: z.array(z.object({ day: Day, start: HHMM, end: HHMM })),
    }),
  ),
});
