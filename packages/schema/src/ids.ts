// 식별자·공통 값. 실명 필드는 어디에도 없다 (architecture.md §5).
import { z } from "zod";

export const StudentCode = z.string().regex(/^S\d{2,3}$/).describe("학생 코드 (S01)");
export const StaffCode = z.string().regex(/^A\d{2,3}$/).describe("지원인력 코드 (A01)");
export const TeacherCode = z.string().regex(/^T\d{2,3}$/).describe("교사 코드 (T01)");
export const SpecialClassCode = z.string().regex(/^K\d{1,2}$/).describe("특수학급 코드 (K1)");
export const ClassGroupCode = z.string().regex(/^\d-\d{1,2}$/).describe("원반 (3-2)");
export const RoomCode = z.string().regex(/^L\d{2,3}$/).describe("특별실·공용 공간 (L06)");
export const DutyCode = z.string().regex(/^D\d{2,3}$/).describe("업무 (D01)");
/** 장소 참조: 원반 교실은 반 코드, 특수학급은 K 코드, 그 밖은 L 코드 */
export const LocationRef = z
  .string()
  .regex(/^(\d-\d{1,2}|K\d{1,2}|L\d{2,3})$/)
  .describe("장소: 반 코드(원반 교실) | K 코드(특수학급) | L 코드(특별실 등)");

export const Id = z.string().min(1).max(64).describe("서버가 만드는 불투명 ID");
/** 교사가 붙이는 별칭. 실명 검사는 서버(M5)에서 하고 스키마는 길이만 본다 */
export const Label = z.string().min(1).max(20);
export const Subject = z.string().min(1).max(20).describe("NEIS 과목명 (과학)");
export const IsoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe("YYYY-MM-DD");
export const IsoDateTime = z.iso.datetime({ offset: true });
/** 층. 건물 밖은 "OUT" (D11) */
export const Floor = z.union([z.number().int().min(1).max(20), z.literal("OUT")]);

export type StudentCode = z.infer<typeof StudentCode>;
export type StaffCode = z.infer<typeof StaffCode>;
export type LocationRef = z.infer<typeof LocationRef>;
export type IsoDate = z.infer<typeof IsoDate>;
export type Floor = z.infer<typeof Floor>;
