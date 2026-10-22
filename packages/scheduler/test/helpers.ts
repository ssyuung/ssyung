// 테스트 공통: 목데이터 읽기와 계약 검사
import assert from "node:assert/strict";
import { z } from "zod";
import type { ProposeInput, ProposeOutput, ValidateInput, ValidateOutput } from "@ssyung/schema";
import { readJson } from "../scripts/scenario-lib.ts";

export const mock = {
  proposeInput: (name: string): ProposeInput => readJson(`fixtures/mock/scheduler/propose.${name}.input.json`),
  proposeOutput: (name: string): ProposeOutput => readJson(`fixtures/mock/scheduler/propose.${name}.output.json`),
  validateInput: (name: string): ValidateInput => readJson(`fixtures/mock/scheduler/validate.${name}.input.json`),
  validateOutput: (name: string): ValidateOutput => readJson(`fixtures/mock/scheduler/validate.${name}.output.json`),
};
export const PROPOSE_CASES = ["absent", "staff-away"];

export function assertSchema(schema: z.ZodType, data: unknown, label: string) {
  const r = schema.safeParse(data);
  assert.ok(r.success, `${label}\n${r.success ? "" : z.prettifyError(r.error)}`);
}

/** elapsed_ms를 뺀 결과 (결정성 비교용) */
export const stable = (o: ProposeOutput) => JSON.stringify({ ...o, engine: { ...o.engine, elapsed_ms: 0 } });
