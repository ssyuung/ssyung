// 아직 merge되지 않은 모듈의 가짜. 인터페이스는 각 모듈 지시서와 같게 두어 나중에 deps.ts에서 바꿔 끼운다.
import type { ChangeOps, InterpretRequest, InterpretResult, Notification } from "@ssyung/schema";

/** 해석기 (M6 @ssyung/interpreter) */
export interface Interpreter {
  interpret(req: InterpretRequest): Promise<InterpretResult>;
}
/** 실명 검사 (M5 @ssyung/name-guard) */
export interface NameGuard {
  detect(text: string): { start: number; end: number; text: string; reason: string }[];
}
/** 알림 (M10). 보낸 알림을 기록한다 */
export interface Notifier {
  send(n: Notification): Promise<void>;
  readonly sent: Notification[];
}

const UNSUPPORTED: ChangeOps = {
  ops: [], scope: "this_week", confidence: "low", unsupported: "아직 이 요청은 해석하지 못해요",
};

const DAY_MS = 86_400_000;
const dayNo = (d: string) => Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10)) / DAY_MS;
/** ops 안의 날짜(YYYY-MM-DD)를 모두 days일 옮긴다 */
const shiftDates = (ops: ChangeOps, days: number): ChangeOps =>
  JSON.parse(JSON.stringify(ops).replace(/"(\d{4}-\d{2}-\d{2})"/g, (_, d: string) =>
    `"${new Date((dayNo(d) + days) * DAY_MS).toISOString().slice(0, 10)}"`));

/**
 * 평가 세트·목데이터에 있는 원문이면 그 기대 ChangeOps, 아니면 unsupported.
 * 예시는 모두 오늘이 9/18(금)이라고 가정한다. 오늘이 다르면 같은 문장의 날짜를 그 차이만큼 옮겨 준다(개발용).
 * "오늘 …"은 항상 맞고, "다음 주 월요일"처럼 요일을 가리키는 날짜는 오늘이 금요일일 때만 정확하다
 */
export function fakeInterpreter(cases: { raw_text: string; today: string; expected: ChangeOps }[]): Interpreter {
  const byText = new Map(cases.map((c) => [`${c.today}|${c.raw_text}`, c.expected]));
  const byRaw = new Map<string, { today: string; expected: ChangeOps }>();
  for (const c of cases) if (!byRaw.has(c.raw_text)) byRaw.set(c.raw_text, c);
  return {
    async interpret(req) {
      const today = req.context.today;
      let result = byText.get(`${today}|${req.raw_text}`);
      const near = result ? undefined : byRaw.get(req.raw_text);
      if (near) {
        const days = dayNo(today) - dayNo(near.today);
        result = shiftDates(near.expected, days);
      }
      result ??= UNSUPPORTED;
      return {
        result: structuredClone(result), model: "fake", escalated: false,
        usage: { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0 },
      };
    },
  };
}

/** 목데이터 NAME_SUSPECTED 예시의 이름만 잡는다 */
export function fakeNameGuard(names: string[]): NameGuard {
  return {
    detect(text) {
      const out: ReturnType<NameGuard["detect"]> = [];
      for (const name of names) {
        for (let i = text.indexOf(name); i >= 0; i = text.indexOf(name, i + name.length)) {
          out.push({ start: i, end: i + name.length, text: name, reason: "목데이터 예시 이름" });
        }
      }
      return out.sort((a, b) => a.start - b.start);
    },
  };
}

export function fakeNotifier(): Notifier {
  const sent: Notification[] = [];
  return {
    sent,
    async send(n) {
      sent.push(structuredClone(n));
    },
  };
}
