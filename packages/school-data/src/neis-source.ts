// NEIS 오픈API 출처. 자리만 둔다 (보류).
// 붙일 때: 1회 응답 행 수 한도가 있어 페이지 단위로 받는다. 정규화 규칙은 architecture.md §4.6 ①.
import type { ClassGroup, IsoDate, Timetable } from "@ssyung/schema";
import { SourceError, type SchoolDataSource, type SchoolRef } from "./source.ts";

const notYet = () => new SourceError("NOT_IMPLEMENTED", "NEIS 연결은 아직 준비 중이에요.");

export class NeisSource implements SchoolDataSource {
  async searchSchools(_query: string): Promise<SchoolRef[]> {
    throw notYet();
  }

  async getClassGroups(_school: SchoolRef, _year: number): Promise<ClassGroup[]> {
    throw notYet();
  }

  async getTimetable(_school: SchoolRef, _from: IsoDate, _to: IsoDate): Promise<Timetable> {
    throw notYet();
  }
}
