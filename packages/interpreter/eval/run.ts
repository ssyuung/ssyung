// 평가: fixtures/change-requests/cases.json 전체를 실제 API로 돌린다 (cost-strategy.md §3). 사람이 실행한다.
//   루트 .env에 ANTHROPIC_API_KEY를 넣고(cp .env.example .env) pnpm --filter @ssyung/interpreter eval
//   옵션: --primary claude-haiku-5-5,claude-haiku-4-5 (1차 모델을 차례로 비교, 기본은 Haiku 5.5, 2차는 Sonnet 5.5)  --only CR01,CR05
import { readFile } from "node:fs/promises";
import Anthropic from "@anthropic-ai/sdk";
import { ChangeRequestSet, InterpretContext } from "@ssyung/schema";
import { Extraction, interpret, MODELS, resolve, sameOps, type ClaudeClient } from "../src/index.ts";

if (!process.env.ANTHROPIC_API_KEY) {
  console.log("ANTHROPIC_API_KEY가 없어 평가를 건너뜁니다.");
  process.exit(0);
}

/** 100만 토큰당 달러. 캐시 쓰기 1.25배, 읽기 0.1배 (2026-10 정가) */
const PRICE: Record<string, { input: number; output: number }> = {
  "claude-haiku-4-5": { input: 1, output: 5 },
  "claude-haiku-5-5": { input: 0.1, output: 0.5 },
  "claude-sonnet-5-5": { input: 2, output: 10 },
};
const KRW_PER_USD = 1400;

const arg = (name: string) => process.argv.find((_, i) => process.argv[i - 1] === name)?.split(",");
const fixture = async (rel: string) => JSON.parse(await readFile(new URL(`../../../fixtures/${rel}`, import.meta.url), "utf8"));
const context = InterpretContext.parse(await fixture("mock/interpreter/context-2026-09-18.json"));
const { cases: all } = ChangeRequestSet.parse(await fixture("change-requests/cases.json"));
const only = arg("--only");
const cases = (only ? all.filter((c) => only.includes(c.id)) : all).filter((c) => {
  if (c.today === context.today) return true;
  console.log(`${c.id} 건너뜀: 기준일 ${c.today}의 컨텍스트가 없음`);
  return false;
});

type Call = { model: string; usage: Anthropic.Usage; text: string | undefined };
const sdk = new Anthropic();
let calls: Call[] = [];
// 호출마다 모델·usage·응답을 기록한다 (InterpretResult.usage는 모델을 합친 값이라 비용 계산에 모자람)
const claude: ClaudeClient = {
  messages: {
    async create(body) {
      const res = await sdk.messages.create(body);
      calls.push({ model: body.model, usage: res.usage, text: res.content.find((b) => b.type === "text")?.text });
      return res;
    },
  },
};

const cost = (c: Call) => {
  const p = PRICE[c.model] ?? { input: NaN, output: NaN };
  const u = c.usage;
  const input = u.input_tokens + (u.cache_creation_input_tokens ?? 0) * 1.25 + (u.cache_read_input_tokens ?? 0) * 0.1;
  return (input * p.input + u.output_tokens * p.output) / 1e6;
};

/** 1차 응답만으로 맞았는지 (재시도 없이) */
function firstCorrect(text: string | undefined, expected: (typeof cases)[number]["expected"]) {
  try {
    const ex = Extraction.safeParse(JSON.parse(text ?? ""));
    return ex.success && sameOps(resolve(ex.data, context).result, expected);
  } catch {
    return false;
  }
}

const pct = (a: number, b: number) => (b ? `${((a / b) * 100).toFixed(1)}%` : "-");
const summary: string[] = [];

for (const primary of arg("--primary") ?? [MODELS.primary]) {
  const models = { primary, fallback: MODELS.fallback };
  console.log(`\n# 1차 ${primary} → 2차 ${models.fallback}`);
  let correct = 0, primaryCorrect = 0, escalated = 0, errors = 0, confidenceMatch = 0;
  let unsupportedExpected = 0, unsupportedCaught = 0, falseOps = 0;
  const runCalls: Call[] = [];

  for (const c of cases) {
    calls = [];
    try {
      const out = await interpret({ raw_text: c.raw_text, context }, { claude, models });
      const ok = sameOps(out.result, c.expected);
      if (ok) correct++;
      if (firstCorrect(calls[0]?.text, c.expected)) primaryCorrect++;
      if (out.escalated) escalated++;
      if (out.result.confidence === c.expected.confidence) confidenceMatch++;
      if (c.expected.unsupported != null) {
        unsupportedExpected++;
        if (out.result.unsupported != null) unsupportedCaught++;
      } else if (out.result.unsupported == null && !ok) {
        falseOps++;
      }
      console.log(`${ok ? "✓" : "✗"} ${c.id} ${out.escalated ? "↑" : " "} ${out.result.confidence.padEnd(6)} ${c.raw_text}`);
      if (!ok) {
        console.log(`    기대: ${JSON.stringify(c.expected.ops)} ${c.expected.scope}${c.expected.unsupported ? " unsupported" : ""}`);
        console.log(`    결과: ${JSON.stringify(out.result.ops)} ${out.result.scope}${out.result.unsupported ? ` unsupported: ${out.result.unsupported}` : ""}`);
        console.log(`    1차 추출: ${calls[0]?.text}`);
      }
    } catch (e) {
      errors++;
      console.log(`! ${c.id} API 오류: ${e instanceof Anthropic.APIError ? `${e.status} ${e.message}` : String(e)}`);
    }
    runCalls.push(...calls);
  }

  const n = cases.length;
  const total = runCalls.reduce((s, c) => s + cost(c), 0);
  const sum = (k: keyof Anthropic.Usage) => runCalls.reduce((s, c) => s + (Number(c.usage[k]) || 0), 0);
  console.log("\n## 결과");
  console.log(`정확도 (ops 일치)       ${correct}/${n} = ${pct(correct, n)}`);
  console.log(`  1차만                 ${primaryCorrect}/${n} = ${pct(primaryCorrect, n)}`);
  console.log(`escalation 비율         ${escalated}/${n} = ${pct(escalated, n)}`);
  console.log(`unsupported 판정        ${unsupportedCaught}/${unsupportedExpected}`);
  console.log(`틀린 ops를 그대로 냄     ${falseOps}건 (가장 위험한 실패)`);
  console.log(`confidence 일치         ${pct(confidenceMatch, n)}`);
  console.log(`API 오류                ${errors}건`);
  for (const model of Object.keys(PRICE)) {
    const mine = runCalls.filter((c) => c.model === model);
    if (mine.length) console.log(`${model.padEnd(22)} ${mine.length}회, $${mine.reduce((s, c) => s + cost(c), 0).toFixed(4)}`);
  }
  console.log(`토큰 입력 ${sum("input_tokens")} · 캐시 쓰기 ${sum("cache_creation_input_tokens")} · 캐시 읽기 ${sum("cache_read_input_tokens")} · 출력 ${sum("output_tokens")}`);
  console.log(`1회 평균 입력 ${Math.round((sum("input_tokens") + sum("cache_creation_input_tokens") + sum("cache_read_input_tokens")) / Math.max(runCalls.length, 1))} 토큰`);
  console.log(`비용 합계 $${total.toFixed(4)} (약 ${Math.round(total * KRW_PER_USD)}원), 요청 1건당 약 ${((total / n) * KRW_PER_USD).toFixed(2)}원`);
  summary.push(`${primary.padEnd(18)} 정확도 ${pct(correct, n)} · 1차만 ${pct(primaryCorrect, n)} · 재시도 ${pct(escalated, n)} · 틀린 ops ${falseOps}건 · 1건당 ${((total / n) * KRW_PER_USD).toFixed(2)}원`);
}

if (summary.length > 1) console.log(`\n# 비교\n${summary.join("\n")}`);
