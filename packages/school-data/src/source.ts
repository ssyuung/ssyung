// 학교 데이터 출처 (architecture.md §4.6 ①). 지금은 목데이터(MockSource), 나중에 NEIS API(NeisSource).
import type { ApiError, ClassGroup, IsoDate, ProcedureOutput, Timetable } from "@ssyung/schema";

/** 학교 검색 결과 한 줄 (school.search 출력) */
export type SchoolRef = ProcedureOutput<"school.search">[number];

export interface SchoolDataSource {
  /** 이름 검색 */
  searchSchools(query: string): Promise<SchoolRef[]>;
  /** 그 학년도 반 목록. 시간표 자료가 없는 반은 has_timetable: false */
  getClassGroups(school: SchoolRef, year: number): Promise<ClassGroup[]>;
  /** [from, to] 날짜의 원반 시간표 (양 끝 포함) */
  getTimetable(school: SchoolRef, from: IsoDate, to: IsoDate): Promise<Timetable>;
}

export class SourceError extends Error {
  readonly code: ApiError["code"];
  constructor(code: ApiError["code"], message: string) {
    super(message);
    this.code = code;
  }
}
