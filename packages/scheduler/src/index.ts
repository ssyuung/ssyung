// @ssyung/scheduler: 배치 엔진 (architecture.md §8). API는 propose()·validate()만 부른다.
export { propose } from "./propose.ts";
export { validate } from "./validate.ts";
export { heuristic } from "./engines/heuristic.ts";
export { POLICIES } from "./policies/index.ts";
export { computeDiff } from "./diff.ts";
export { explain, classify } from "./explain.ts";
export { computeMetrics } from "./metrics.ts";
export { computeShortfalls } from "./shortfalls.ts";
