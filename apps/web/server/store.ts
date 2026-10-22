// 메모리 저장소 (v1). 버전·배정·제안·하루 운영 기록. DB 저장은 M4 v2.
import type {
  Assignment, Attendance, CellCheck, CellNote, ChangeOp, ChangeOps, ChangeRequest, Demand, DemandSet, IsoDate, Memo,
  Metrics, Notification, Now, Proposal, ScheduleSnapshot, ScheduleVersion, Shortfall, StaffCode, StaffWindow,
} from "@ssyung/schema";

/**
 * 그날 배정을 만들 때 쓴 수요·근무와 그 입력(변경, 요청 시각).
 * 화면의 학생 행도 같은 ops·now로 계산해 수요와 어긋나지 않게 한다
 */
export type DayData = {
  demands: Demand[];
  unplaced: DemandSet["unplaced"];
  staff: StaffWindow[];
  ops: ChangeOp[];
  now: Now | null;
};

export type VersionRecord = {
  version: ScheduleVersion;
  assignments: Assignment[];
  shortfalls: Shortfall[];
  metrics_by_date: Record<IsoDate, Metrics>;
  /** 이 버전까지 반영된 변경. 수요·근무를 다시 만들 때 쓴다 */
  ops: ChangeOp[];
  /** 배정을 계산할 때 쓴 날짜별 수요·근무. 없는 날짜는 지금 기초정보와 ops로 다시 만든다 */
  days: Map<IsoDate, DayData>;
};

export type ProposalRecord = {
  proposal: Proposal;
  status: "pending" | "approved" | "rejected";
  ops: ChangeOps;
  days: Map<IsoDate, DayData>;
};

export type Store = {
  versions: Map<string, VersionRecord>;
  activeId: string;
  changeRequests: Map<string, ChangeRequest>;
  proposals: Map<string, ProposalRecord>;
  attendance: Map<string, Attendance>; // 날짜|학생
  checks: Map<string, CellCheck>; // 칸 키
  notes: CellNote[];
  memos: Map<string, Memo>;
  notifications: Map<string, Notification>;
  invites: Map<string, { staff: StaffCode; expires: Date }>; // 코드 → 지원인력
  devices: Map<string, { staff: StaffCode; push_token: string | null }>; // 세션 토큰 → 기기
  nextId(prefix: string): string;
};

export const cellKey = (c: { date: string; start: number; demand_id: string }) => `${c.date}|${c.start}|${c.demand_id}`;

/** active 스냅숏 하나로 시작한다 */
export function createStore(active: ScheduleSnapshot): Store {
  const seq = new Map<string, number>();
  const versions = new Map<string, VersionRecord>();
  versions.set(active.version.id, {
    version: active.version,
    assignments: active.assignments,
    shortfalls: active.shortfalls,
    metrics_by_date: active.metrics_by_date,
    ops: [],
    days: new Map(),
  });
  return {
    versions,
    activeId: active.version.id,
    changeRequests: new Map(),
    proposals: new Map(),
    attendance: new Map(),
    checks: new Map(),
    notes: [],
    memos: new Map(),
    notifications: new Map(),
    invites: new Map(),
    devices: new Map(),
    nextId(prefix) {
      const n = (seq.get(prefix) ?? 0) + 1;
      seq.set(prefix, n);
      return `${prefix}_${String(n).padStart(4, "0")}`;
    },
  };
}
