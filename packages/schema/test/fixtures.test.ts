// 모든 테스트 데이터·목데이터를 계약에 대어 검증한다. 계약이나 목데이터가 바뀌면 여기서 먼저 깨진다.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import * as S from "../src/index.ts";

const ROOT = join(import.meta.dirname, "..", "..", "..");
const read = (p: string) => JSON.parse(readFileSync(join(ROOT, p), "utf8"));
const check = (schema: z.ZodType, data: unknown, label: string) => {
  const r = schema.safeParse(data);
  assert.ok(r.success, `${label}\n${r.success ? "" : z.prettifyError(r.error)}`);
  return r.success ? r.data : undefined;
};

const NAMED: Record<string, z.ZodType> = {
  SchoolBundle: S.SchoolBundle, "Student[]": z.array(S.Student), "Staff[]": z.array(S.Staff), Timetable: S.Timetable,
  DemandSet: S.DemandSet, ScheduleSnapshot: S.ScheduleSnapshot, ProposeInput: S.ProposeInput, ProposeOutput: S.ProposeOutput,
  ValidateInput: S.ValidateInput, ValidateOutput: S.ValidateOutput, AssignRequest: S.AssignRequest, AssignResponse: S.AssignResponse,
  InterpretContext: S.InterpretContext,
};
const manifest = read("fixtures/mock/manifest.json");

test("목데이터: manifest의 모든 파일이 계약을 따른다", () => {
  for (const [file, name] of Object.entries<string>(manifest.files)) {
    const schema = name.startsWith("api:") ? S.apiMockSchema(name.slice(4) as S.ProcedureName) : NAMED[name];
    assert.ok(schema, `스키마 이름을 모름: ${name}`);
    check(schema, read(`fixtures/mock/${file}`), `fixtures/mock/${file} (${name})`);
  }
});

test("목데이터: 모든 API 프로시저에 예시가 있다", () => {
  const missing = Object.keys(S.procedures).filter((n) => !(`api/${n}.json` in manifest.files));
  assert.deepEqual(missing, []);
});

test("목데이터: 배정은 존재하는 수요를 가리키고 겹치지 않는다", () => {
  const snap = read("fixtures/mock/schedule/active-2026-09.json");
  const ids = new Set(read("fixtures/mock/demand/2026-09.json").demands.map((d: S.Demand) => d.id));
  const byStaffDay: Record<string, S.Assignment[]> = {};
  for (const a of snap.assignments as S.Assignment[]) {
    assert.ok(ids.has(a.demand_id), `없는 수요: ${a.demand_id}`);
    (byStaffDay[a.staff + a.date] ??= []).push(a);
  }
  for (const list of Object.values(byStaffDay)) {
    list.sort((x, y) => x.start - y.start);
    for (let i = 1; i < list.length; i++) assert.ok(list[i].start >= list[i - 1].end, `겹침: ${JSON.stringify([list[i - 1], list[i]])}`);
  }
});

test("dataset/: 파일 형식", () => {
  const d = "dataset";
  check(S.FloorLayoutFile, read(`${d}/db/서울개포초등학교/층배치.json`), "층배치.json");
  check(S.StudentsFile, read(`${d}/db/서울개포초등학교/학생.json`), "학생.json");
  check(S.StaffFile, read(`${d}/db/서울개포초등학교/지원인력.json`), "지원인력.json");
  check(S.NeisClassInfoFile, read(`${d}/api/서울개포초등학교/학급정보.json`).slice(1), "학급정보.json");
  check(S.NeisTimetableFile, read(`${d}/api/서울개포초등학교/초등학교시간표.json`).slice(1), "초등학교시간표.json");
});

test("fixtures/scenarios: 연쇄 시나리오와 입력 파일", () => {
  const set = check(S.CascadeScenarioSet, read("fixtures/scenarios/cascade-scenarios.json"), "cascade-scenarios.json") as z.infer<typeof S.CascadeScenarioSet>;
  const withInput = set.scenarios.filter((x) => x.input);
  assert.ok(withInput.length >= 6, "시나리오 입력이 6개 이상");
  for (const sc of withInput) {
    const input = check(S.ProposeInput, read(`fixtures/scenarios/${sc.input}`), sc.input!) as S.ProposeInput;
    assert.deepEqual(input.dates, [sc.date], `${sc.id}: 날짜`);
    assert.deepEqual(input.request?.ops ?? [], sc.trigger.type === "change_ops" ? sc.trigger.ops : [], `${sc.id}: 변경 명령`);
  }
});

test("계약: 공용 시간 함수와 기본 일과", () => {
  assert.equal(S.hhmmToMinute("09:30"), 570);
  assert.equal(S.minuteToHHMM(570), "09:30");
  assert.equal(S.ceil10(615), 620);
  assert.equal(S.weekdayOf("2026-09-18"), "FRI");
  check(z.array(S.BellSchedule), S.DEFAULT_BELL, "DEFAULT_BELL");
  assert.deepEqual(read("fixtures/mock/domain/school.json").bell, S.DEFAULT_BELL, "목데이터 일과 = 기본 일과");
});

test("fixtures/change-requests: 해석기 평가 세트", () => {
  const set = check(S.ChangeRequestSet, read("fixtures/change-requests/cases.json"), "cases.json") as z.infer<typeof S.ChangeRequestSet>;
  for (const c of set.cases) assert.equal(c.expected.unsupported === null, c.expected.ops.length > 0, `${c.id}: unsupported와 ops가 어긋남`);
});
