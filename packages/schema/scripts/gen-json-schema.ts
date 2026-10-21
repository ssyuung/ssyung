// zod 계약 → JSON Schema (generated/json). Python(Pydantic, M2)과 Claude tool input_schema(M6)가 이것을 쓴다.
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import * as S from "../src/index.ts";

const OUT = join(import.meta.dirname, "..", "generated", "json");
const TARGETS: Record<string, z.ZodType> = {
  Demand: S.Demand, DemandSet: S.DemandSet, ChangeOps: S.ChangeOps,
  ProposeInput: S.ProposeInput, ProposeOutput: S.ProposeOutput, ValidateInput: S.ValidateInput, ValidateOutput: S.ValidateOutput,
  AssignRequest: S.AssignRequest, AssignResponse: S.AssignResponse,
  InterpretRequest: S.InterpretRequest, InterpretResult: S.InterpretResult,
  DayView: S.DayView, StaffTodayView: S.StaffTodayView, Proposal: S.Proposal, ChangeRequest: S.ChangeRequest,
  SchoolBundle: S.SchoolBundle, Student: S.Student, Staff: S.Staff, Timetable: S.Timetable,
};
rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });
for (const [name, schema] of Object.entries(TARGETS)) {
  const js = z.toJSONSchema(schema, { target: "draft-2020-12", io: "input", unrepresentable: "any" });
  writeFileSync(join(OUT, `${name}.json`), JSON.stringify({ $id: `ssyung/${name}`, "x-contract-version": S.CONTRACT_VERSION, ...js }, null, 2) + "\n");
}
console.log(`generated/json: ${Object.keys(TARGETS).length}개 (계약 ${S.CONTRACT_VERSION})`);
