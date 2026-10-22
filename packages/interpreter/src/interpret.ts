// 변경 요청 원문 → ChangeOps.
// 모델은 구조화된 출력으로 값만 뽑고(extract.ts), 날짜·교시·코드는 해석 함수가 계산한다(resolve.ts).
// 1차 모델의 값이 애매하거나 해석에 실패하면 2차 모델로 한 번 더 뽑는다 (cost-strategy.md §2.4).
import type Anthropic from "@anthropic-ai/sdk";
import { ChangeOps, InterpretRequest } from "@ssyung/schema";
import type { InterpretResult } from "@ssyung/schema";
import { checkOps } from "./check.ts";
import { EXTRACTION_SCHEMA, Extraction, SYSTEM_PROMPT } from "./extract.ts";
import { resolve } from "./resolve.ts";

/** 공식 SDK 클라이언트(new Anthropic())가 그대로 맞는 최소 모양. 테스트는 가짜를 넣는다 */
export interface ClaudeClient {
  messages: { create(body: Anthropic.MessageCreateParamsNonStreaming): Promise<Anthropic.Message> };
}

// 1차는 Haiku 5.5: eval 22건에서 Haiku 4.5와 정확도가 같고 비용은 약 1/45 (2026-10-22, 사람이 정함)
export const MODELS = { primary: "claude-haiku-5-5", fallback: "claude-sonnet-5-5" };
export type Models = typeof MODELS;

export const UNSUPPORTED_REASON = "요청을 해석하지 못했어요. 다시 써 주거나 시간표에서 직접 고쳐 주세요";

type Usage = InterpretResult["usage"];
/** resolved: 해석에 성공함. done: 이 답으로 끝낸다(아니면 다른 모델로 다시 볼 만함) */
type Attempt = { model: string; usage: Usage; result: ChangeOps | null; resolved: boolean; done: boolean };

/** 모델에는 지시문·스키마(고정)와 원문만 보낸다. 컨텍스트는 보내지 않는다 */
export function buildParams(model: string, rawText: string): Anthropic.MessageCreateParamsNonStreaming {
  const format = { type: "json_schema" as const, schema: EXTRACTION_SCHEMA };
  const base = {
    model,
    max_tokens: 1024,
    system: [{ type: "text" as const, text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" as const } }],
    messages: [{ role: "user" as const, content: rawText }],
  };
  // Haiku 4.5는 effort를 받지 않는다. Haiku 5.5는 추론을 끄고, Sonnet 5.5는 추론을 끌 수 없어 effort만 낮춘다
  if (model === "claude-haiku-4-5") return { ...base, output_config: { format } };
  if (model.startsWith("claude-haiku-")) return { ...base, thinking: { type: "disabled" }, output_config: { format, effort: "low" } };
  return { ...base, max_tokens: 4096, output_config: { format, effort: "low" } };
}

async function attempt(client: ClaudeClient, model: string, req: InterpretRequest): Promise<Attempt> {
  const res = await client.messages.create(buildParams(model, req.raw_text));
  const usage: Usage = {
    input_tokens: res.usage.input_tokens,
    output_tokens: res.usage.output_tokens,
    cache_read_input_tokens: res.usage.cache_read_input_tokens ?? 0,
  };
  const retry = { model, usage, result: null, resolved: false, done: false };
  const text = res.content.find((b) => b.type === "text")?.text;
  if (text == null) return retry;
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return retry;
  }
  const ex = Extraction.safeParse(json);
  if (!ex.success) return retry;

  const r = resolve(ex.data, req.context);
  // 해석 함수 결과도 계약·컨텍스트 검사를 한 번 더 거친다 (해석 함수 버그 방어)
  const ok = ChangeOps.safeParse(r.result);
  if (!ok.success || checkOps(ok.data, req.context).length > 0) return retry;
  if (!r.ok) return { model, usage, result: ok.data, resolved: false, done: !r.retry };
  return { model, usage, result: ok.data, resolved: true, done: ok.data.confidence !== "low" };
}

const addUsage = (a: Usage, b: Usage): Usage => ({
  input_tokens: a.input_tokens + b.input_tokens,
  output_tokens: a.output_tokens + b.output_tokens,
  cache_read_input_tokens: a.cache_read_input_tokens + b.cache_read_input_tokens,
});

export async function interpret(
  input: InterpretRequest,
  deps: { claude: ClaudeClient; models?: Models },
): Promise<InterpretResult> {
  const req = InterpretRequest.parse(input);
  const models = deps.models ?? MODELS;

  const first = await attempt(deps.claude, models.primary, req);
  if (first.done && first.result) return { result: first.result, model: first.model, escalated: false, usage: first.usage };

  const second = await attempt(deps.claude, models.fallback, req);
  const usage = addUsage(first.usage, second.usage);
  // 해석에 성공한 답(2차 먼저) → 실패 이유가 있는 답 → 해석 실패
  const pick = [second, first].find((a) => a.resolved) ?? [second, first].find((a) => a.result);
  return {
    result: pick?.result ?? { ops: [], scope: "this_week", confidence: "low", unsupported: UNSUPPORTED_REASON },
    model: pick?.model ?? second.model,
    escalated: true,
    usage,
  };
}
