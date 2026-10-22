import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import type Anthropic from "@anthropic-ai/sdk";
import { ChangeRequestSet, InterpretContext, InterpretResult } from "@ssyung/schema";
import { EXTRACTION_SCHEMA, interpret, MODELS, SYSTEM_PROMPT, UNSUPPORTED_REASON, type ClaudeClient } from "../src/index.ts";
import { change, EXTRACTIONS, item, today } from "./extractions.ts";

const fixture = async (rel: string) => JSON.parse(await readFile(new URL(`../../../fixtures/${rel}`, import.meta.url), "utf8"));
const context = InterpretContext.parse(await fixture("mock/interpreter/context-2026-09-18.json"));
const { cases } = ChangeRequestSet.parse(await fixture("change-requests/cases.json"));
const byId = (id: string) => cases.find((c) => c.id === id)!;

type Reply = { json?: unknown; text?: string; usage?: Partial<Anthropic.Usage> };

/** 정해 둔 응답을 차례로 돌려주는 가짜. 네트워크를 쓰지 않는다 */
function fakeClaude(replies: Reply[]) {
  const calls: Anthropic.MessageCreateParamsNonStreaming[] = [];
  const client: ClaudeClient = {
    messages: {
      async create(body) {
        calls.push(body);
        const r = replies[calls.length - 1];
        if (!r) throw new Error("응답을 더 준비하지 않음");
        const text = r.json !== undefined ? JSON.stringify(r.json) : (r.text ?? "");
        return {
          id: `msg_${calls.length}`,
          type: "message",
          role: "assistant",
          model: body.model,
          content: [{ type: "text", text, citations: null }],
          stop_reason: "end_turn",
          stop_sequence: null,
          usage: { input_tokens: 800, output_tokens: 120, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, ...r.usage },
        } as unknown as Anthropic.Message;
      },
    },
  };
  return { client, calls };
}

const req = (raw_text: string) => ({ raw_text, context });

test("1차 추출이 맞으면 그대로, 호출 1번", async () => {
  const c = byId("CR05");
  const { client, calls } = fakeClaude([{ json: EXTRACTIONS.CR05 }]);
  const out = InterpretResult.parse(await interpret(req(c.raw_text), { claude: client }));
  assert.deepEqual(out.result, c.expected);
  assert.equal(out.model, MODELS.primary);
  assert.equal(out.escalated, false);
  assert.equal(calls.length, 1);
});

test("JSON이 아니거나 추출 스키마를 어기면 2차로", async () => {
  const c = byId("CR10");
  for (const first of [{ text: "점심시간 지원으로 보입니다" }, { text: "{" }, { json: { ...EXTRACTIONS.CR10, extra: 1 } }, { json: { kind: "change" } }]) {
    const { client, calls } = fakeClaude([first, { json: EXTRACTIONS.CR10 }]);
    const out = await interpret(req(c.raw_text), { claude: client });
    assert.equal(calls.length, 2);
    assert.equal(calls[1]!.model, MODELS.fallback);
    assert.equal(out.escalated, true);
    assert.equal(out.model, MODELS.fallback);
    assert.deepEqual(out.result, c.expected);
  }
});

test("모르는 학생·과목처럼 추출이 틀렸을 수 있으면 2차로", async () => {
  const c = byId("CR01");
  const wrong = change([item("absent", { who: "학생33", days: [today] })]);
  const { client, calls } = fakeClaude([{ json: wrong }, { json: EXTRACTIONS.CR01 }]);
  const out = await interpret(req(c.raw_text), { claude: client });
  assert.equal(calls.length, 2);
  assert.deepEqual(out.result, c.expected);
});

test("confidence low면 2차로, 2차도 실패하면 1차의 low 답", async () => {
  const c = byId("CR03");
  const low = { ...EXTRACTIONS.CR03!, confidence: "low" };
  const { client, calls } = fakeClaude([{ json: low }, { text: "모르겠어요" }]);
  const out = await interpret(req(c.raw_text), { claude: client });
  assert.equal(calls.length, 2);
  assert.equal(out.escalated, true);
  assert.equal(out.model, MODELS.primary);
  assert.deepEqual(out.result, { ...c.expected, confidence: "low" });
});

test("수업일 아님처럼 코드가 확정한 실패는 재시도하지 않는다", async () => {
  const c = byId("CR19");
  const { client, calls } = fakeClaude([{ json: EXTRACTIONS.CR19 }]);
  const out = await interpret(req(c.raw_text), { claude: client });
  assert.equal(calls.length, 1);
  assert.equal(out.escalated, false);
  assert.deepEqual(out.result, c.expected);
});

test("두 번 다 실패하면 unsupported", async () => {
  const { client, calls } = fakeClaude([{ json: { ops: "없음" } }, { text: "해석할 수 없어요" }]);
  const out = InterpretResult.parse(await interpret(req("학생3 내일 어떻게 해"), { claude: client }));
  assert.equal(calls.length, 2);
  assert.deepEqual(out.result, { ops: [], scope: "this_week", confidence: "low", unsupported: UNSUPPORTED_REASON });
  assert.equal(out.escalated, true);
});

test("usage는 두 호출을 합친다", async () => {
  const c = byId("CR05");
  const { client } = fakeClaude([
    { json: { ...EXTRACTIONS.CR05!, confidence: "low" }, usage: { input_tokens: 900, output_tokens: 120 } },
    { json: EXTRACTIONS.CR05, usage: { input_tokens: 100, output_tokens: 90, cache_read_input_tokens: 800 } },
  ]);
  const out = await interpret(req(c.raw_text), { claude: client });
  assert.deepEqual(out.usage, { input_tokens: 1000, output_tokens: 210, cache_read_input_tokens: 800 });

  const one = fakeClaude([{ json: EXTRACTIONS.CR05, usage: { cache_read_input_tokens: null } }]);
  assert.equal((await interpret(req(c.raw_text), { claude: one.client })).usage.cache_read_input_tokens, 0);
});

test("요청 모양: 구조화된 출력, 고정 지시문에 캐시 표시, user에는 원문만", async () => {
  const c = byId("CR21");
  const { client, calls } = fakeClaude([{ json: { ...EXTRACTIONS.CR21!, confidence: "low" } }, { json: EXTRACTIONS.CR21 }]);
  await interpret(req(c.raw_text), { claude: client });
  const [haiku, sonnet] = calls;
  for (const call of [haiku!, sonnet!]) {
    assert.deepEqual(call.output_config?.format, { type: "json_schema", schema: EXTRACTION_SCHEMA });
    assert.equal(call.tools, undefined);
    assert.deepEqual(call.system, [{ type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }]);
    assert.deepEqual(call.messages, [{ role: "user", content: c.raw_text }]);
  }
  assert.equal(haiku!.model, "claude-haiku-5-5");
  assert.deepEqual(haiku!.thinking, { type: "disabled" });
  assert.equal(haiku!.output_config?.effort, "low");
  assert.equal(sonnet!.model, "claude-sonnet-5-5");
  assert.equal(sonnet!.output_config?.effort, "low");
});

test("모델을 바꿔 쓸 수 있다: Haiku 4.5는 effort를 보내지 않는다", async () => {
  const { client, calls } = fakeClaude([{ json: EXTRACTIONS.CR01 }]);
  await interpret(req(byId("CR01").raw_text), { claude: client, models: { primary: "claude-haiku-4-5", fallback: MODELS.fallback } });
  assert.equal(calls[0]!.model, "claude-haiku-4-5");
  assert.equal(calls[0]!.output_config?.effort, undefined);
});

test("프롬프트에는 원문만: 컨텍스트와 계약 밖 필드(메모·연락처)는 보내지 않는다", async () => {
  const { client, calls } = fakeClaude([{ json: EXTRACTIONS.CR01 }]);
  const leaky = {
    raw_text: "학생3 오늘 결석",
    support_memo: "화장실 지원 방법 메모",
    context: { ...context, phone: "010-0000-0000" },
  };
  await interpret(leaky as never, { claude: client });
  const sent = JSON.stringify(calls[0]);
  for (const secret of ["010-", "메모", "support_memo", "2026-09-18", "후문", "5-6", "도덕"]) assert.ok(!sent.includes(secret), secret);
});

test("구조화된 출력 스키마: 받지 않는 키가 없고 모든 객체가 닫혀 있다", () => {
  const walk = (node: unknown): void => {
    if (Array.isArray(node)) return node.forEach(walk);
    if (!node || typeof node !== "object") return;
    const o = node as Record<string, unknown>;
    for (const k of ["oneOf", "minimum", "maximum", "minLength", "maxLength", "$schema"]) assert.ok(!(k in o), k);
    if (o.type === "object") {
      assert.equal(o.additionalProperties, false);
      assert.deepEqual([...(o.required as string[])].sort(), Object.keys(o.properties as object).sort());
    }
    Object.values(o).forEach(walk);
  };
  walk(EXTRACTION_SCHEMA);
  assert.doesNotMatch(SYSTEM_PROMPT, /20\d\d-\d\d-\d\d/);
});
