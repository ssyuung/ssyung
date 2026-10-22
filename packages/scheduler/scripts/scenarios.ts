// pnpm --filter @ssyung/scheduler scenarios
// 연쇄 시나리오를 돌려 기준선(baseline_heuristic)과 비교표를 출력한다. 기준선보다 나빠지거나 위반이 있으면 exit 1.
import { runAll } from "./scenario-lib.ts";

const fmt = (x: { changed: number; gaps: number; late: number }) => `${x.changed}/${x.gaps}/${x.late}`;
const rows = await runAll();

console.log("연쇄 시나리오 — 바뀐 칸/공백/늦게 도착 (지금 · 기준선)\n");
console.log(["#", "A 변경 최소", "B 처음부터 다시", "C 늦게 도착 없음", "결과"].join(" | "));
console.log("---|---|---|---|---");
let failed = 0;
for (const r of rows) {
  if (r.skipped) {
    console.log([r.id, "-", "-", "-", `건너뜀: ${r.skipped}`].join(" | "));
    continue;
  }
  const cells = r.policies!.map((p) => `${fmt(p.got)} · ${fmt(p.base)}${p.worse ? " ✗" : ""}`);
  console.log([r.id, ...cells, r.problems.length ? "실패" : "통과"].join(" | "));
  if (r.problems.length) failed++;
}
for (const r of rows) for (const p of r.problems) console.log(`  ${r.id} ${p}`);
const ran = rows.filter((r) => !r.skipped).length;
console.log(`\n실행 ${ran}개 · 건너뜀 ${rows.length - ran}개 · 실패 ${failed}개`);
process.exit(failed ? 1 : 0);
