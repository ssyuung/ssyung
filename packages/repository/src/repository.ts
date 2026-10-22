// 저장소 (architecture.md §4.6 ②). 지금은 JsonRepository, 나중에 SupabaseRepository.
// 버전·배정·메모는 DB 단계에서 추가한다.
import type { ApiError, ProcedureInput, SchoolBundle, Staff, Student } from "@ssyung/schema";

/** 층 배치 (setup.saveLayout 입력) */
export type FloorLayout = ProcedureInput<"setup.saveLayout">;
export type StudentInput = ProcedureInput<"students.add">;
export type StudentPatch = ProcedureInput<"students.update">["patch"];
export type StaffInput = ProcedureInput<"staff.add">;
export type StaffPatch = ProcedureInput<"staff.update">["patch"];

export interface Repository {
  school: {
    get(): Promise<SchoolBundle>;
    saveLayout(layout: FloorLayout): Promise<SchoolBundle>;
  };
  students: {
    list(): Promise<Student[]>;
    /** 코드는 저장소가 정한다: 지금까지 발급한 가장 큰 번호 + 1 (S08). 지운 번호는 다시 쓰지 않는다 */
    add(input: StudentInput): Promise<Student>;
    update(code: string, patch: StudentPatch): Promise<Student>;
    remove(code: string): Promise<void>;
  };
  staff: {
    list(): Promise<Staff[]>;
    add(input: StaffInput): Promise<Staff>;
    update(code: string, patch: StaffPatch): Promise<Staff>;
    remove(code: string): Promise<void>;
  };
}

/** 저장소 오류. code는 API 오류 코드와 같다 */
export class RepositoryError extends Error {
  readonly code: ApiError["code"];
  readonly details?: Record<string, unknown>;
  constructor(code: ApiError["code"], message: string, details?: Record<string, unknown>) {
    super(message);
    this.code = code;
    this.details = details;
  }
}

/** 지금까지 발급한 가장 큰 번호: 남긴 번호(lastNo)와 남은 코드 중 큰 쪽 */
export function issuedMax(prefix: string, codes: string[], lastNo = 0): number {
  return Math.max(lastNo, ...codes.map((c) => Number(c.slice(prefix.length))).filter(Number.isFinite));
}

/** 새 코드: 발급한 가장 큰 번호 + 1. 두 자리로 맞춘다 (S07 → S08) */
export function nextCode(prefix: string, codes: string[], lastNo = 0): { code: string; no: number } {
  const no = issuedMax(prefix, codes, lastNo) + 1;
  return { code: prefix + String(no).padStart(2, "0"), no };
}
