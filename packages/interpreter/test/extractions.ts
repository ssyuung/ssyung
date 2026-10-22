// 테스트 공용: 평가 세트 22건마다 모델이 냈어야 할 추출값 (M6 내부 형식이라 fixtures가 아닌 여기에 둔다)
import type { Extraction, Item } from "../src/extract.ts";

export const item = (action: Item["action"], fields: Partial<Item>): Item => ({
  action, who: null, who_class: null, staff: null, class_group: null, place: null, headcount: null, days: [], times: [], repeat: false, ...fields,
});
export const change = (items: Item[], confidence: Extraction["confidence"] = "high"): Extraction => ({ kind: "change", unsupported: null, items, confidence });
export const unsupported = (why: NonNullable<Extraction["unsupported"]>): Extraction => ({ kind: "unsupported", unsupported: why, items: [], confidence: "high" });
export const today = { type: "relative", offset: 0 } as const;
export const nextWeek = (day: "MON" | "TUE") => ({ type: "weekday", week: "next", day }) as const;

export const EXTRACTIONS: Record<string, Extraction> = {
  CR01: change([item("absent", { who: "학생3", days: [today] })]),
  CR02: change([item("staff_away", { who: "지원인력1", times: [{ type: "clock", start: "10:30", end: "11:30" }] })]),
  CR03: change([item("staff_away", { who: "지원인력3", days: [today] })]),
  CR04: change([item("placement", { who: "학생1", place: "K1", times: [{ type: "period", n: 3 }] })]),
  CR05: change([item("placement", { who: "학생6", place: "K2", days: [today], times: [{ type: "subject", name: "과학" }] })]),
  CR06: change([item("placement", { who: "학생2", place: "K1", times: [{ type: "part_of_day", part: "afternoon" }] })]),
  CR07: change([item("staff_away", { who: "지원인력2", days: [nextWeek("MON")], times: [{ type: "part_of_day", part: "morning" }] })]),
  CR08: change([item("relocate_class", { class_group: "3-2", place: "미술실", days: [today], times: [{ type: "period", n: 4 }] })]),
  CR09: change([item("extra_support", { who: "학생5", times: [{ type: "break_after", n: 2 }] })]),
  CR10: change([item("extra_support", { who: "학생7", headcount: 1, times: [{ type: "lunch" }] })]),
  CR11: change([item("pin", { who: "학생4", staff: "지원인력1", days: [today], times: [{ type: "period", n: 2 }] })]),
  CR12: change([item("absent", { who: "학생3", days: [nextWeek("MON")] }), item("absent", { who: "학생6", days: [nextWeek("MON")] })]),
  CR13: change([item("placement", { who: "학생5", place: "K1", days: [{ type: "weekday", week: "unspecified", day: "MON" }], times: [{ type: "period", n: 1 }], repeat: true })]),
  CR14: change([item("staff_away", { who: "지원인력2", days: [nextWeek("TUE")], times: [{ type: "dismissal" }] })]),
  CR15: unsupported("homeroom_teacher"),
  CR16: unsupported("support_settings"),
  CR17: unsupported("staff_roster"),
  CR18: change([item("staff_away", { who: "지원인력3", days: [today], times: [{ type: "part_of_day", part: "afternoon" }] })], "medium"),
  CR19: change([item("absent", { who: "학생4", days: [{ type: "relative", offset: 1 }] })]),
  CR20: change([item("pin", { who: "학생2", staff: "지원인력3", times: [{ type: "break_after", n: 2 }] })]),
  CR21: change([item("placement", { who: "학생6", place: "K2", days: [nextWeek("TUE")], times: [{ type: "subject", name: "영어" }] })]),
  CR22: change([item("absent", { who: "학생3", days: [today] }), item("staff_away", { who: "지원인력2", times: [{ type: "period", n: 3 }] })]),
};
