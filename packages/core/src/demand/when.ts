// When → 날짜·시각 (architecture.md §7). 일과(bell)에서 교시·쉬는 시간의 분을 찾는다.
import type { BellSchedule, Day, IsoDate, Minute, TimeBlock, When } from "@ssyung/schema";

const WEEKDAYS = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"] as const;

/** 날짜의 요일. 주말이면 SAT/SUN */
export const weekdayOf = (date: IsoDate): (typeof WEEKDAYS)[number] =>
  WEEKDAYS[new Date(`${date}T00:00:00Z`).getUTCDay()]!;

/** 그 날짜의 일과 블록. 주말이거나 일과가 없으면 빈 배열 */
export function blocksOn(bell: BellSchedule[], date: IsoDate): TimeBlock[] {
  const day = weekdayOf(date);
  return bell.find((b) => (b.days as string[]).includes(day))?.blocks ?? [];
}

export const classBlock = (blocks: TimeBlock[], period: number) =>
  blocks.find((b) => b.kind === "class" && b.period === period);

/** p교시와 p+1교시 사이의 쉬는 시간. 점심을 사이에 두거나 블록이 없으면 undefined */
export function breakAfter(blocks: TimeBlock[], period: number): TimeBlock | undefined {
  const cur = classBlock(blocks, period);
  const next = classBlock(blocks, period + 1);
  if (!cur || !next) return undefined;
  const between = blocks.filter((b) => b.start >= cur.end && b.end <= next.start);
  return between.length === 1 && between[0]!.kind === "break" ? between[0] : undefined;
}

const toMin = (hhmm: string): Minute => {
  const [h, m] = hhmm.split(":").map(Number);
  return h! * 60 + m!;
};

/** When 하나가 가리키는 구간. whole은 하루 전체({ date }) */
export type ResolvedWhen = { date: IsoDate; start: Minute; end: Minute; period: number | null; whole: boolean };

/**
 * When(또는 배열)을 날짜별 구간으로 푼다.
 * { day, period }는 dates 안의 그 요일 날짜마다 펼친다. 일과에 없는 교시·블록은 건너뛴다.
 */
export function resolveWhen(when: When | When[], bell: BellSchedule[], dates: IsoDate[]): ResolvedWhen[] {
  const out: ResolvedWhen[] = [];
  for (const w of Array.isArray(when) ? when : [when]) {
    const targets = "day" in w ? dates.filter((d) => weekdayOf(d) === (w.day as Day)) : [w.date];
    for (const date of targets) {
      const blocks = blocksOn(bell, date);
      if ("period" in w) {
        const b = classBlock(blocks, w.period);
        if (b) out.push({ date, start: b.start, end: b.end, period: w.period, whole: false });
      } else if ("kind" in w) {
        const b = w.kind === "break" ? breakAfter(blocks, w.after_period) : blocks.find((x) => x.kind === w.kind);
        if (b) out.push({ date, start: b.start, end: b.end, period: null, whole: false });
      } else if ("start" in w) {
        out.push({ date, start: toMin(w.start), end: toMin(w.end), period: null, whole: false });
      } else {
        out.push({ date, start: 0, end: 1440, period: null, whole: true });
      }
    }
  }
  return out;
}

/** 구간과 겹치는 수업 교시 */
export function periodsIn(blocks: TimeBlock[], r: ResolvedWhen): number[] {
  if (r.period !== null) return [r.period];
  return blocks
    .filter((b) => b.kind === "class" && b.period !== null && b.start < r.end && r.start < b.end)
    .map((b) => b.period!);
}
