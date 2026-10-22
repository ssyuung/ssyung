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

/** 평가 세트·목데이터에 있는 원문이면 그 기대 ChangeOps, 아니면 unsupported */
export function fakeInterpreter(cases: { raw_text: string; today: string; expected: ChangeOps }[]): Interpreter {
  const byText = new Map(cases.map((c) => [`${c.today}|${c.raw_text}`, c.expected]));
  return {
    async interpret(req) {
      const result = byText.get(`${req.context.today}|${req.raw_text}`) ?? UNSUPPORTED;
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
