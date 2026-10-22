// 해석 확인 문장 (ChangeRequest.summary). ops 하나에 한 줄: "지원인력1 · 9월 18일(금) 10:30–11:30 부재"
import type { ChangeOp, When } from "@ssyung/schema";
import { dateLabel } from "./time.ts";

const DAY_KO = { MON: "월", TUE: "화", WED: "수", THU: "목", FRI: "금" } as const;
const KIND_KO = { lunch: "점심", arrival: "등교", dismissal: "하교" } as const;

function whenText(w: When): string {
  if ("day" in w) return `매주 ${DAY_KO[w.day]}요일 ${w.period}교시`;
  const d = dateLabel(w.date);
  if ("period" in w) return `${d} ${w.period}교시`;
  if ("kind" in w) return w.kind === "break" ? `${d} ${w.after_period}교시 뒤 쉬는 시간` : `${d} ${KIND_KO[w.kind]}`;
  if ("start" in w) return `${d} ${w.start}–${w.end}`;
  return d;
}
const whens = (w: When | When[]) => (Array.isArray(w) ? w : [w]).map(whenText).join(", ");

/** labelOf: 코드(학생·지원인력·장소) → 별칭. 모르면 코드 그대로 */
export function summarize(ops: ChangeOp[], labelOf: (code: string) => string): string[] {
  return ops.map((op) => {
    switch (op.op) {
      case "staff_unavailable":
        return `${labelOf(op.staff)} · ${whens(op.when)} 부재`;
      case "mark_absent":
        return `${labelOf(op.student)} · ${whens(op.when)} 결석`;
      case "set_placement": {
        const where = op.placement === "homeroom" ? "원반" : op.location ? labelOf(op.location) : "특수학급";
        return `${labelOf(op.student)} · ${whens(op.when)} ${where}에서 수업`;
      }
      case "set_support":
        return `${labelOf(op.student)} · ${whens(op.when)} ${op.headcount === 0 ? "추가 지원 해제" : `추가 지원 ${op.headcount}명`}`;
      case "pin_assignment": {
        const target = "student" in op.target ? labelOf(op.target.student) : labelOf(op.target.duty);
        return `${labelOf(op.staff)} · ${whens(op.when)} ${target} 맡음`;
      }
      case "relocate_class":
        return `${op.class_group}반 · ${whens(op.when)} ${labelOf(op.location)}에서 수업`;
    }
  });
}
