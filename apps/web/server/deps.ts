// 서버가 쓰는 모듈을 모으는 곳. 다른 모듈 패키지는 이 파일에서만 import한다 (CLAUDE.md 규칙 2의 M7 예외).
// 라우터·서비스는 Deps를 받아 쓰고, 모듈 타입도 여기서 다시 내보낸다.
import { cp, mkdtemp, stat } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { apiMockSchema, ChangeRequestSet, procedures, ScheduleSnapshot } from "@ssyung/schema";
import type { ApiError, ProcedureInput, ProcedureName, ProcedureOutput } from "@ssyung/schema";
import { blocksOn, generateDemands, periodsIn, resolveWhen } from "@ssyung/core";
import { JsonRepository, type Repository } from "@ssyung/repository";
import { MockSource, type SchoolDataSource, type SchoolRef } from "@ssyung/school-data";
import { computeDiff, computeMetrics, propose, validate } from "@ssyung/scheduler";
import { fakeInterpreter, fakeNameGuard, fakeNotifier, type Interpreter, type NameGuard, type Notifier } from "./fakes.ts";
import { createStore, type Store } from "./store.ts";

export type { Repository, SchoolDataSource, SchoolRef };

export const SCHOOL_ID = "sch_gaepo";
const SCHOOL_DIR = "서울개포초등학교";

export interface Deps {
  mode: "dev" | "test";
  repo: Repository;
  source: SchoolDataSource;
  core: {
    generateDemands: typeof generateDemands; resolveWhen: typeof resolveWhen; blocksOn: typeof blocksOn; periodsIn: typeof periodsIn;
  };
  engine: { propose: typeof propose; validate: typeof validate; computeMetrics: typeof computeMetrics; computeDiff: typeof computeDiff };
  interpreter: Interpreter;
  nameGuard: NameGuard;
  notifier: Notifier;
  clock: () => Date;
  store: Store;
  /** school.import가 가져올 시간표 기간. 목데이터 출처는 9월만 있다 */
  importRange: { from: string; to: string };
  /** 저장소 작업 폴더 */
  dataDir: string;
}

export interface CreateDepsOptions {
  mode: "dev" | "test";
  clock?: () => Date;
  /** 저장소 작업 폴더. dev 기본은 <저장소>/.data/<학교>, test 기본은 임시 디렉터리 */
  dataDir?: string;
}

/** pnpm-workspace.yaml이 있는 저장소 루트 */
export function repoRoot(from = process.cwd()): string {
  for (let d = from; ; d = dirname(d)) {
    if (existsSync(join(d, "pnpm-workspace.yaml"))) return d;
    if (dirname(d) === d) throw new Error("저장소 루트(pnpm-workspace.yaml)를 찾지 못했어요.");
  }
}

export async function createDeps(opts: CreateDepsOptions): Promise<Deps> {
  const root = repoRoot();
  const mockDir = join(root, "fixtures/mock");
  const readJson = (rel: string): unknown => JSON.parse(readFileSync(/* turbopackIgnore: true */ join(root, rel), "utf8"));

  // 커밋된 dataset/db/는 고치지 않는다. 작업 폴더로 복사해 쓴다
  const seed = join(root, "dataset/db", SCHOOL_DIR);
  const dataDir = opts.dataDir
    ?? (opts.mode === "dev" ? join(root, ".data", SCHOOL_DIR) : join(await mkdtemp(join(tmpdir(), "ssyung-web-")), SCHOOL_DIR));
  if (!(await stat(dataDir).catch(() => null))) await cp(seed, dataDir, { recursive: true });

  const source = new MockSource({ mockDir });
  const repo = new JsonRepository({ dir: dataDir, schoolId: SCHOOL_ID, source });
  const active = ScheduleSnapshot.parse(readJson("fixtures/mock/schedule/active-2026-09.json"));

  // 가짜 해석기: 평가 세트 + change.interpret 목데이터의 원문
  const cases = ChangeRequestSet.parse(readJson("fixtures/change-requests/cases.json")).cases
    .map((c) => ({ raw_text: c.raw_text, today: c.today, expected: c.expected }));
  for (const ex of mockExamples("change.interpret", readJson)) {
    if ("output" in ex && ex.output.parsed) cases.push({ raw_text: ex.input.raw_text, today: ex.input.today, expected: ex.output.parsed });
  }

  return {
    mode: opts.mode,
    repo,
    source,
    core: { generateDemands, resolveWhen, blocksOn, periodsIn },
    engine: { propose, validate, computeMetrics, computeDiff },
    interpreter: fakeInterpreter(cases),
    nameGuard: fakeNameGuard(suspectedNames(readJson)),
    notifier: fakeNotifier(),
    clock: opts.clock ?? (() => new Date()),
    store: createStore(active),
    importRange: { from: "2026-09-01", to: "2026-09-30" },
    dataDir,
  };
}

type MockExample<N extends ProcedureName> =
  | { title: string; input: ProcedureInput<N>; output: ProcedureOutput<N> }
  | { title: string; input: ProcedureInput<N>; error: ApiError };

/** fixtures/mock/api/<프로시저>.json 예시 (계약으로 검증) */
function mockExamples<N extends ProcedureName>(name: N, readJson: (rel: string) => unknown): MockExample<N>[] {
  return apiMockSchema(name).parse(readJson(`fixtures/mock/api/${name}.json`)).examples as MockExample<N>[];
}

/** 목데이터 NAME_SUSPECTED 예시에 나온 이름 (가짜 실명 검사기용) */
function suspectedNames(readJson: (rel: string) => unknown): string[] {
  const names = new Set<string>();
  for (const name of Object.keys(procedures) as ProcedureName[]) {
    for (const ex of mockExamples(name, readJson)) {
      if (!("error" in ex) || ex.error.code !== "NAME_SUSPECTED") continue;
      const input = ex.input as Record<string, unknown>;
      const spans = ex.error.details?.spans as [number, number][] | undefined;
      if (typeof input.raw_text === "string" && spans) for (const [s, e] of spans) names.add(input.raw_text.slice(s, e));
      if (typeof input.label === "string") names.add(input.label);
    }
  }
  return [...names];
}
