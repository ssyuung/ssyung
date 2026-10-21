// 해석기(M6) 계약. 서버가 날짜·교시·과목을 미리 풀어 컨텍스트로 넘긴다 (cost-strategy.md §2.3).
import { z } from "zod";
import { ClassGroupCode, IsoDate, Label, LocationRef, StaffCode, StudentCode, Subject } from "./ids.ts";
import { Day, PartOfDay, TimeBlock } from "./time.ts";
import { ChangeOps } from "./change-ops.ts";

export const InterpretContext = z.object({
  today: IsoDate,
  calendar: z.array(z.object({ date: IsoDate, day: z.union([Day, z.enum(["SAT", "SUN"])]), school_day: z.boolean() })),
  bell: z.array(TimeBlock),
  part_of_day: z.record(PartOfDay, z.array(z.number().int())).describe("오전·오후에 드는 교시"),
  class_subjects: z
    .record(ClassGroupCode, z.record(IsoDate, z.array(Subject.nullable())))
    .describe("반 → 날짜 → 교시별 과목 (index 0 = 1교시). 학생이 속한 반만"),
  codes: z.object({
    students: z.array(z.object({ code: StudentCode, label: Label, class_group: ClassGroupCode })),
    staff: z.array(z.object({ code: StaffCode, label: Label })),
    locations: z.array(z.object({ code: LocationRef, label: Label })),
  }),
});

export const InterpretRequest = z.object({
  raw_text: z.string().min(1).max(500).describe("실명 검사(M5)를 통과한 원문"),
  context: InterpretContext,
});

export const InterpretResult = z.object({
  result: ChangeOps,
  model: z.string(),
  escalated: z.boolean().describe("Haiku → Sonnet 재시도 여부"),
  usage: z.object({
    input_tokens: z.number().int(),
    output_tokens: z.number().int(),
    cache_read_input_tokens: z.number().int(),
  }),
});

/** 해석기 평가 세트 한 건 (fixtures/mock/interpreter/change-requests.json) */
export const ChangeRequestCase = z.object({
  id: z.string().regex(/^CR\d{2,3}$/),
  raw_text: z.string(),
  today: IsoDate,
  tags: z.array(z.enum([
    "absent", "staff", "time-range", "placement", "subject-to-period", "part-of-day", "relative-date",
    "multi-op", "relocate", "break", "lunch", "pin", "permanent", "dismissal", "unsupported", "non-school-day",
  ])),
  expected: ChangeOps,
});
export const ChangeRequestSet = z.object({ _note: z.string().optional(), cases: z.array(ChangeRequestCase) });

export type InterpretContext = z.infer<typeof InterpretContext>;
export type InterpretRequest = z.infer<typeof InterpretRequest>;
export type InterpretResult = z.infer<typeof InterpretResult>;
