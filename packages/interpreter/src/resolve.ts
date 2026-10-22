// 해석 함수: 모델이 뽑은 값 + InterpretContext → ChangeOps. 날짜·교시·코드 계산은 모두 여기서 한다.
import { hhmmToMinute, minuteToHHMM, weekdayOf } from "@ssyung/schema";
import type { ChangeOp, ChangeOps, InterpretContext, When } from "@ssyung/schema";
import type { DayRef, Extraction, Item, TimeRef } from "./extract.ts";

type Confidence = ChangeOps["confidence"];
type Day = "MON" | "TUE" | "WED" | "THU" | "FRI";

/** retry: 모델이 값을 잘못 뽑았을 수 있어 다른 모델로 다시 볼 만한 실패 */
export type Resolved = { ok: true; result: ChangeOps } | { ok: false; result: ChangeOps; retry: boolean };

export const UNSUPPORTED_TEXT: Record<NonNullable<Extraction["unsupported"]>, string> = {
  homeroom_teacher: "담임 배정은 ssyung에서 다루지 않아요",
  support_settings: "지원 과목·구간은 기초정보의 학생 설정(④)에서 바꿔요",
  staff_roster: "지원인력 추가는 기초정보의 지원인력 설정(⑧)에서 해요",
  other: "이 요청은 변경 명령으로 바꿀 수 없어요. 시간표에서 직접 고쳐 주세요",
};

class Fail extends Error {
  readonly retry: boolean;
  constructor(message: string, retry: boolean) {
    super(message);
    this.retry = retry;
  }
}

const DAY_KO: Record<string, string> = { MON: "월", TUE: "화", WED: "수", THU: "목", FRI: "금", SAT: "토", SUN: "일" };
const WEEK_ORDER = ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"] as const;
const DAY_MS = 86_400_000;
const addDays = (date: string, n: number) => new Date(Date.parse(`${date}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);
const monthDay = (date: string) => `${Number(date.slice(5, 7))}월 ${Number(date.slice(8, 10))}일`;
const koDate = (date: string) => `${monthDay(date)}(${DAY_KO[weekdayOf(date)]})`;
const squash = (s: string) => s.replace(/\s+/g, "");
type SubjectRef = Extract<TimeRef, { type: "subject" }>;
const splitSubjects = (times: TimeRef[]) => ({
  subjects: times.filter((t): t is SubjectRef => t.type === "subject"),
  rest: times.filter((t) => t.type !== "subject"),
});

export function resolve(ex: Extraction, ctx: InterpretContext): Resolved {
  const fail = (reason: string, retry: boolean): Resolved => ({
    ok: false,
    retry,
    result: { ops: [], scope: "this_week", confidence: "low", unsupported: reason.slice(0, 200) },
  });

  if (ex.kind === "unsupported") {
    return { ok: true, result: { ops: [], scope: "this_week", confidence: ex.confidence, unsupported: UNSUPPORTED_TEXT[ex.unsupported ?? "other"] } };
  }
  if (ex.items.length === 0) return fail("무엇을 바꿀지 찾지 못했어요", true);
  const repeats = new Set(ex.items.map((i) => i.repeat));
  if (repeats.size > 1) return fail("이번 주 변경과 매주 규칙은 나눠서 요청해 주세요", false);
  const permanent = repeats.has(true);

  const r = new Resolver(ctx, permanent);
  try {
    const ops = ex.items.map((item) => r.op(item));
    const confidence: Confidence = [ex.confidence, r.confidence].includes("low")
      ? "low"
      : [ex.confidence, r.confidence].includes("medium") ? "medium" : "high";
    return { ok: true, result: { ops, scope: permanent ? "permanent" : "this_week", confidence, unsupported: null } };
  } catch (e) {
    if (e instanceof Fail) return fail(e.message, e.retry);
    throw e;
  }
}

class Resolver {
  confidence: Confidence = "high";
  private readonly ctx: InterpretContext;
  private readonly permanent: boolean;
  private readonly classPeriods: number[];

  constructor(ctx: InterpretContext, permanent: boolean) {
    this.ctx = ctx;
    this.permanent = permanent;
    this.classPeriods = ctx.bell.flatMap((b) => (b.kind === "class" && b.period != null ? [b.period] : []));
  }

  private lower(to: Confidence) {
    if (to === "low" || (to === "medium" && this.confidence === "high")) this.confidence = to;
  }

  op(item: Item): ChangeOp {
    switch (item.action) {
      case "absent": {
        const s = this.student(item);
        return { op: "mark_absent", student: s.code, when: this.whens(item, s.class_group, "student") };
      }
      case "staff_away": {
        const staff = this.staff(item.who ?? item.staff);
        return { op: "staff_unavailable", staff, when: this.whens(item, null, "staff") };
      }
      case "placement": {
        const s = this.student(item);
        const place = this.place(item.place);
        const when = this.whens(item, s.class_group, "student");
        if (place === "homeroom") return { op: "set_placement", student: s.code, when, placement: "homeroom" };
        if (!/^K\d/.test(place)) throw new Fail(`${item.place}은 특수학급이 아니에요. 반 전체 이동이면 반을 함께 써 주세요`, true);
        return { op: "set_placement", student: s.code, when, placement: "special_class", location: place };
      }
      case "extra_support": {
        const s = this.student(item);
        const headcount = item.headcount ?? 1;
        if (headcount < 0 || headcount > 3) throw new Fail("추가 지원 인원은 0~3명이에요", false);
        return { op: "set_support", student: s.code, when: this.whens(item, s.class_group, "student"), headcount };
      }
      case "pin": {
        const s = this.student(item);
        const staff = this.staff(item.staff);
        return { op: "pin_assignment", staff, target: { student: s.code }, when: this.whens(item, s.class_group, "student") };
      }
      case "relocate_class": {
        const group = item.class_group ?? item.who_class;
        if (!group || !this.groups().has(group)) throw new Fail(`반${group ? ` ${group}` : ""}을 찾지 못했어요`, true);
        const place = this.place(item.place);
        if (place === "homeroom") throw new Fail("어느 장소로 옮길지 써 주세요", true);
        return { op: "relocate_class", class_group: group, when: this.whens(item, group, "class"), location: place };
      }
    }
  }

  // ---------- 사람·장소 ----------
  private student(item: Item) {
    const who = item.who && squash(item.who);
    if (!who) throw new Fail("어느 학생인지 써 주세요", true);
    const all = this.ctx.codes.students;
    const byCode = all.find((s) => s.code === who.toUpperCase());
    if (byCode) return byCode;
    let found = all.filter((s) => squash(s.label) === who);
    if (found.length > 1 && item.who_class) found = found.filter((s) => s.class_group === item.who_class);
    if (found.length === 1) return found[0]!;
    if (found.length === 0) throw new Fail(`${item.who}을 학생 목록에서 찾지 못했어요`, true);
    const list = found.map((s) => `${s.code}(${s.class_group}반)`).join(", ");
    throw new Fail(`${item.who}이 ${found.length}명이에요: ${list}. 반이나 코드로 써 주세요`, false);
  }

  private staff(name: string | null) {
    const who = name && squash(name);
    if (!who) throw new Fail("어느 지원인력인지 써 주세요", true);
    const all = this.ctx.codes.staff;
    const byCode = all.find((s) => s.code === who.toUpperCase());
    if (byCode) return byCode.code;
    const found = all.filter((s) => squash(s.label) === who);
    if (found.length === 1) return found[0]!.code;
    if (found.length === 0) throw new Fail(`${name}을 지원인력 목록에서 찾지 못했어요`, true);
    throw new Fail(`${name}이 ${found.length}명이에요: ${found.map((s) => s.code).join(", ")}. 코드로 써 주세요`, false);
  }

  private place(name: string | null): string | "homeroom" {
    const p = name && squash(name);
    if (!p) throw new Fail("어디서 할지 써 주세요", true);
    if (["원반", "원래반", "교실", "자기반", "반"].includes(p)) return "homeroom";
    const all = this.ctx.codes.locations;
    const hit = all.find((l) => l.code === p.toUpperCase())
      ?? all.find((l) => squash(l.label) === p)
      ?? all.find((l) => squash(l.label).endsWith(p));
    if (!hit) throw new Fail(`${name}을 장소 목록에서 찾지 못했어요`, true);
    return hit.code;
  }

  private groups() {
    return new Set([...this.ctx.codes.students.map((s) => s.class_group), ...Object.keys(this.ctx.class_subjects)]);
  }

  // ---------- 날짜 ----------
  private date(ref: DayRef): string {
    const today = this.ctx.today;
    if (ref.type === "relative") return addDays(today, ref.offset);
    if (ref.type === "date") {
      if (ref.month < 1 || ref.month > 12 || ref.day < 1 || ref.day > 31) throw new Fail("날짜를 알아보지 못했어요", true);
      return `${today.slice(0, 4)}-${String(ref.month).padStart(2, "0")}-${String(ref.day).padStart(2, "0")}`;
    }
    const target = WEEK_ORDER.indexOf(ref.day);
    const todayIdx = WEEK_ORDER.indexOf(weekdayOf(today));
    if (ref.week === "unspecified") {
      this.lower("medium");
      return addDays(today, (target - todayIdx + 7) % 7);
    }
    return addDays(today, target - todayIdx + (ref.week === "next" ? 7 : 0));
  }

  /** 수업일 확인까지 */
  private schoolDate(ref: DayRef): string {
    const date = this.date(ref);
    const entry = this.ctx.calendar.find((c) => c.date === date);
    if (!entry) throw new Fail(`${koDate(date)}은 달력에 없어요`, false);
    if (!entry.school_day) {
      const next = this.ctx.calendar.find((c) => c.date > date && c.school_day);
      throw new Fail(`${koDate(date)}은 수업일이 아니에요.${next ? ` 다음 수업일(${monthDay(next.date)} ${DAY_KO[next.day]})인지 확인해 주세요` : ""}`, false);
    }
    return date;
  }

  // ---------- 시간 ----------
  private whens(item: Item, group: string | null, who: "student" | "staff" | "class"): When | When[] {
    const out = this.permanent ? this.weeklyWhens(item, group) : this.datedWhens(item, group, who);
    if (out.length === 0) throw new Fail("해당하는 시간을 찾지 못했어요", true);
    return out.length === 1 ? out[0]! : out;
  }

  private datedWhens(item: Item, group: string | null, who: "student" | "staff" | "class"): When[] {
    const dates = item.days.length ? item.days.map((d) => this.schoolDate(d)) : [this.schoolDate({ type: "relative", offset: 0 })];
    const out: When[] = [];
    for (const date of dates) {
      if (item.times.length === 0) {
        if (item.action === "placement") out.push(...this.subjectPeriods(group, date).map((period) => ({ date, period })));
        else out.push({ date });
        continue;
      }
      out.push(...this.timesOn(item.times, date, group, who));
    }
    return out;
  }

  /** "3교시 미술"처럼 과목을 다른 시간과 함께 쓰면 과목은 거르는 조건이다 */
  private timesOn(times: TimeRef[], date: string, group: string | null, who: "student" | "staff" | "class"): When[] {
    const { subjects, rest } = splitSubjects(times);
    if (subjects.length === 0 || rest.length === 0) return times.flatMap((t) => this.timeOn(t, date, group, who));
    const allowed = new Set(subjects.flatMap((t) => this.subjectIndex(t.name, group, date)));
    const out = rest.flatMap((t) => this.timeOn(t, date, group, who)).filter((w) => "period" in w && allowed.has(w.period));
    if (out.length === 0) throw new Fail(`${koDate(date)} 그 시간에는 ${subjects.map((t) => t.name).join("·")} 수업이 없어요`, true);
    return out;
  }

  private timeOn(t: TimeRef, date: string, group: string | null, who: "student" | "staff" | "class"): When[] {
    switch (t.type) {
      case "period":
        this.period(t.n);
        return [{ date, period: t.n }];
      case "subject":
        return this.bySubject(t.name, group, date).map((period) => ({ date, period }));
      case "part_of_day": {
        if (who === "staff") {
          const blocks = this.ctx.bell.filter((b) => b.part_of_day === t.part);
          if (blocks.length === 0) throw new Fail("오전·오후 시간을 찾지 못했어요", false);
          const start = Math.min(...blocks.map((b) => b.start));
          const end = Math.max(...blocks.map((b) => b.end));
          return [{ date, start: minuteToHHMM(start), end: minuteToHHMM(end) }];
        }
        const inPart = new Set(this.ctx.part_of_day[t.part] ?? []);
        return this.subjectPeriods(group, date).filter((p) => inPart.has(p)).map((period) => ({ date, period }));
      }
      case "break_after": {
        this.period(t.n);
        const end = this.ctx.bell.find((b) => b.kind === "class" && b.period === t.n)!.end;
        if (!this.ctx.bell.some((b) => b.kind === "break" && b.start === end)) throw new Fail(`${t.n}교시 뒤에는 쉬는 시간이 없어요`, false);
        return [{ date, kind: "break", after_period: t.n }];
      }
      case "lunch":
      case "arrival":
      case "dismissal":
        return [{ date, kind: t.type }];
      case "clock": {
        const [start, end] = this.clock(t.start, t.end);
        if (who === "staff") return [{ date, start: minuteToHHMM(start), end: minuteToHHMM(end) }];
        // 학생은 그 시각에 걸친 교시로
        return this.subjectPeriods(group, date)
          .filter((p) => this.ctx.bell.some((b) => b.kind === "class" && b.period === p && b.start < end && b.end > start))
          .map((period) => ({ date, period }));
      }
    }
  }

  private weeklyWhens(item: Item, group: string | null): When[] {
    if (item.days.length === 0) throw new Fail("매주 규칙은 요일을 함께 써 주세요", true);
    const out: When[] = [];
    for (const ref of item.days) {
      const day = ref.type === "weekday" ? ref.day : weekdayOf(this.date(ref));
      if (day === "SAT" || day === "SUN") throw new Fail(`${DAY_KO[day]}요일은 수업일이 아니에요`, false);
      // 과목→교시는 그 요일의 가장 가까운 날짜 시간표로 본다
      const sample = this.ctx.calendar.find((c) => c.date >= this.ctx.today && c.day === day && c.school_day)?.date;
      const { subjects, rest } = splitSubjects(item.times);
      if (subjects.length && rest.length && sample) {
        const allowed = new Set(subjects.flatMap((t) => this.subjectIndex(t.name, group, sample)));
        for (const t of rest) {
          if (t.type !== "period") throw new Fail("매주 규칙은 교시나 과목으로 써 주세요", false);
          this.period(t.n);
          if (!allowed.has(t.n)) throw new Fail(`${DAY_KO[day]}요일 ${t.n}교시는 ${subjects.map((s) => s.name).join("·")} 수업이 아니에요`, true);
          out.push({ day: day as Day, period: t.n });
        }
        continue;
      }
      for (const t of item.times) {
        if (t.type === "period") {
          this.period(t.n);
          out.push({ day: day as Day, period: t.n });
        } else if (t.type === "subject" && sample) {
          out.push(...this.bySubject(t.name, group, sample).map((period) => ({ day: day as Day, period })));
        } else {
          throw new Fail("매주 규칙은 교시나 과목으로 써 주세요", false);
        }
      }
    }
    return out;
  }

  private period(n: number) {
    if (!this.classPeriods.includes(n)) throw new Fail(`${n}교시는 없어요`, true);
  }

  /** 그 반이 그날 수업이 있는 교시 */
  private subjectPeriods(group: string | null, date: string): number[] {
    const subjects = group ? this.ctx.class_subjects[group]?.[date] : undefined;
    if (!subjects) return this.classPeriods;
    return this.classPeriods.filter((p) => subjects[p - 1] != null);
  }

  private bySubject(name: string, group: string | null, date: string): number[] {
    const periods = this.subjectIndex(name, group, date);
    if (periods.length > 1) this.lower("medium");
    return periods;
  }

  /** 그날 그 과목인 교시 */
  private subjectIndex(name: string, group: string | null, date: string): number[] {
    const subjects = group ? this.ctx.class_subjects[group]?.[date] : undefined;
    if (!subjects) throw new Fail(`${koDate(date)} 시간표가 없어 ${name} 교시를 찾지 못했어요`, false);
    const want = squash(name).replace(/(시간|수업)$/, "");
    const periods = subjects.flatMap((s, i) => (s != null && squash(s) === want ? [i + 1] : []));
    if (periods.length === 0) throw new Fail(`${koDate(date)}에는 ${name} 수업이 없어요`, true);
    return periods;
  }

  private clock(startText: string, endText: string | null): [number, number] {
    const valid = (s: string) => /^([01]\d|2[0-3]):[0-5]\d$/.test(s);
    if (!valid(startText) || (endText != null && !valid(endText))) throw new Fail("시각을 알아보지 못했어요", true);
    let start = hhmmToMinute(startText);
    let end = endText == null ? Math.max(...this.ctx.bell.map((b) => b.end)) : hhmmToMinute(endText);
    if (endText == null) this.lower("medium");
    if (start % 10 || end % 10) {
      start = Math.floor(start / 10) * 10;
      end = Math.ceil(end / 10) * 10;
      this.lower("medium");
    }
    if (start >= end) throw new Fail("시작 시각이 끝보다 늦어요", true);
    return [start, end];
  }
}
