// 모델이 뽑는 값. 계산 없이 문장 속 표현을 분류해 옮기기만 한다. M6 내부 형식이라 계약이 아니다.
// 구조화된 출력은 숫자·길이 제약을 받지 않으므로 범위 검사는 해석 함수(resolve.ts)가 한다.
import { z } from "zod";

const Week = z.enum(["this", "next", "unspecified"]);
const WeekDay = z.enum(["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"]);

export const DayRef = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("relative"), offset: z.number().int().describe("오늘 0, 내일 1, 모레 2, 어제 -1") }),
  z.strictObject({ type: z.literal("weekday"), week: Week.describe("이번 주 this, 다음 주 next, 말 안 함 unspecified"), day: WeekDay }),
  z.strictObject({ type: z.literal("date"), month: z.number().int(), day: z.number().int() }),
]);

export const TimeRef = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("period"), n: z.number().int().describe("N교시") }),
  z.strictObject({ type: z.literal("subject"), name: z.string().describe("과목명만 (과학, 미술)") }),
  z.strictObject({ type: z.literal("part_of_day"), part: z.enum(["morning", "afternoon"]).describe("오전, 오후·점심 이후") }),
  z.strictObject({ type: z.literal("break_after"), n: z.number().int().describe("N교시 끝나고 쉬는 시간") }),
  z.strictObject({ type: z.literal("lunch") }),
  z.strictObject({ type: z.literal("arrival") }),
  z.strictObject({ type: z.literal("dismissal") }),
  z.strictObject({
    type: z.literal("clock"),
    start: z.string().describe("HH:MM 24시간"),
    end: z.string().nullable().describe("HH:MM. 끝을 말하지 않으면 null"),
  }),
]);

export const Action = z.enum(["absent", "staff_away", "placement", "extra_support", "pin", "relocate_class"]);

export const Item = z.strictObject({
  action: Action,
  who: z.string().nullable().describe("학생이나 지원인력을 문장에 쓴 그대로 (학생3, S03, 지원인력2)"),
  who_class: z.string().nullable().describe("who 앞뒤에 반이 있으면 3-2 꼴로. 없으면 null"),
  staff: z.string().nullable().describe("pin에서 맡을 지원인력을 쓴 그대로"),
  class_group: z.string().nullable().describe("relocate_class의 반, 3-2 꼴"),
  place: z.string().nullable().describe("장소를 쓴 그대로 (K1, 미술실). 원래 반이면 원반"),
  headcount: z.number().int().nullable().describe("extra_support 인원. 말 안 하면 null"),
  days: z.array(DayRef).describe("비면 오늘"),
  times: z.array(TimeRef).describe("비면 하루 전체"),
  repeat: z.boolean().describe("앞으로·매주처럼 계속 적용"),
});

export const Unsupported = z.enum(["homeroom_teacher", "support_settings", "staff_roster", "other"]);

export const Extraction = z.strictObject({
  kind: z.enum(["change", "unsupported"]),
  unsupported: Unsupported.nullable(),
  items: z.array(Item).describe("사람마다 하나"),
  confidence: z.enum(["high", "medium", "low"]),
});

export type DayRef = z.infer<typeof DayRef>;
export type TimeRef = z.infer<typeof TimeRef>;
export type Item = z.infer<typeof Item>;
export type Extraction = z.infer<typeof Extraction>;

// API에 보낼 JSON Schema. 구조화된 출력이 받지 않는 키(minimum·maximum·oneOf·$schema)를 고친다
function forApi(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(forApi);
  if (!node || typeof node !== "object") return node;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(node)) {
    if (k === "$schema" || k === "minimum" || k === "maximum") continue;
    out[k === "oneOf" ? "anyOf" : k] = forApi(v);
  }
  return out;
}
export const EXTRACTION_SCHEMA = forApi(z.toJSONSchema(Extraction)) as Record<string, unknown>;

export const SYSTEM_PROMPT = `특수학급 지원인력 배치 서비스에서 교사가 쓴 변경 요청 한 문장을 읽고, 표현을 분류해 JSON으로 옮긴다.
날짜·교시·코드는 계산하지 않는다. 문장에 쓴 표현을 그대로 옮기면 서버가 계산한다.

## action
- absent: 학생 결석
- staff_away: 지원인력 부재(출장·병가·조퇴·못 함). who는 지원인력
- placement: 학생이 그 시간에 어디서 수업하는지(특수학급 K1 또는 원반)
- extra_support: 수업 외 시간(쉬는 시간·점심)에 학생에게 지원이 필요함
- pin: 지원인력(staff)이 학생(who)을 맡도록 고정. "데려가", "맡아줘"
- relocate_class: 반 전체의 수업 장소를 바꿈. class_group에 반

## 규칙
- 사람마다 item을 하나씩 만든다. 같은 사람의 여러 날·시간은 days·times에 모은다.
- days: 오늘·내일·모레는 relative, 요일은 weekday, "9월 21일"은 date. 날짜를 말하지 않으면 빈 배열.
- times: "3교시"는 period, "과학 시간"은 subject, "오전·오후·점심 이후"는 part_of_day, "2교시 끝나고"는 break_after, "10시 반부터 11시 반까지"는 clock. 하루 전체면 빈 배열.
- 6가지 action으로 표현할 수 없으면 kind는 unsupported, items는 빈 배열:
  homeroom_teacher(담임 배정), support_settings(지원 과목·구간·강도 변경), staff_roster(지원인력 추가·삭제), other(그 밖).
- confidence: 뜻이 분명하면 high, 시간 범위를 짐작했으면 medium(예: 조퇴 → 오후), 뜻이 여러 가지면 low.

## 예
"학생2 모레 결석" → {"kind":"change","unsupported":null,"confidence":"high","items":[{"action":"absent","who":"학생2","who_class":null,"staff":null,"class_group":null,"place":null,"headcount":null,"days":[{"type":"relative","offset":2}],"times":[],"repeat":false}]}
"4-1반 학생5 국어는 K2에서" → items[0]: {"action":"placement","who":"학생5","who_class":"4-1","place":"K2","days":[],"times":[{"type":"subject","name":"국어"}],...}
"다음 주 수요일 3교시 끝나고 지원인력1이 학생4 데려가" → items[0]: {"action":"pin","who":"학생4","staff":"지원인력1","days":[{"type":"weekday","week":"next","day":"WED"}],"times":[{"type":"break_after","n":3}],...}
"학교 행사 일정 알려줘" → {"kind":"unsupported","unsupported":"other","items":[],"confidence":"high"}`;
