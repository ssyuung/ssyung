// tRPC 라우터. 계약 packages/schema/src/api.ts의 procedures 36개와 이름이 정확히 같다(테스트가 확인).
// 클라이언트(M8·M9)는 `import type { AppRouter } from "@ssyung/web/server/router"`로 타입을 쓴다.
import * as change from "./change.ts";
import * as ops from "./day-ops.ts";
import * as schedule from "./schedule.ts";
import * as views from "./views.ts";
import { guardText } from "./change.ts";
import { actorOf, proc, router, staffOf } from "./trpc.ts";

export const appRouter = router({
  school: router({
    search: proc("school.search").query(({ ctx, input }) => ctx.deps.source.searchSchools(input.query)),
    import: proc("school.import").mutation(async ({ ctx, input }) => {
      const { deps } = ctx;
      // 출처는 NEIS 코드로 학교를 찾는다. 이름·주소는 쓰지 않음
      const ref = { label: "", neis_office_code: input.neis_office_code, neis_school_code: input.neis_school_code, address: "" };
      const class_groups = await deps.source.getClassGroups(ref, input.academic_year);
      const tt = await deps.source.getTimetable(ref, deps.importRange.from, deps.importRange.to);
      return {
        class_groups,
        timetable: { date_from: tt.date_from, date_to: tt.date_to, lesson_count: tt.lessons.length, skipped_rows: 0 },
      };
    }),
    get: proc("school.get").query(({ ctx }) => ctx.deps.repo.school.get()),
  }),
  setup: router({
    saveLayout: proc("setup.saveLayout").mutation(({ ctx, input }) => ctx.deps.repo.school.saveLayout(input)),
    previewMoveGroups: proc("setup.previewMoveGroups").query(({ ctx, input }) => views.previewMoveGroups(ctx.deps, input.date)),
  }),
  students: router({
    list: proc("students.list").query(({ ctx }) => ctx.deps.repo.students.list()),
    add: proc("students.add").mutation(({ ctx, input }) => {
      guardText(ctx.deps, input.label, "label");
      return ctx.deps.repo.students.add(input);
    }),
    update: proc("students.update").mutation(({ ctx, input }) => {
      if (input.patch.label) guardText(ctx.deps, input.patch.label, "label");
      return ctx.deps.repo.students.update(input.code, input.patch);
    }),
    remove: proc("students.remove").mutation(async ({ ctx, input }) => {
      await ctx.deps.repo.students.remove(input.code);
      return { ok: true as const };
    }),
  }),
  staff: router({
    list: proc("staff.list").query(({ ctx }) => ctx.deps.repo.staff.list()),
    add: proc("staff.add").mutation(({ ctx, input }) => {
      guardText(ctx.deps, input.label, "label");
      return ctx.deps.repo.staff.add(input);
    }),
    update: proc("staff.update").mutation(({ ctx, input }) => {
      if (input.patch.label) guardText(ctx.deps, input.patch.label, "label");
      return ctx.deps.repo.staff.update(input.code, input.patch);
    }),
    remove: proc("staff.remove").mutation(async ({ ctx, input }) => {
      await ctx.deps.repo.staff.remove(input.code);
      return { ok: true as const };
    }),
    issueInvite: proc("staff.issueInvite").mutation(({ ctx, input }) => ops.issueInvite(ctx.deps, input)),
    revokeDevice: proc("staff.revokeDevice").mutation(({ ctx, input }) => ops.revokeDevice(ctx.deps, input)),
  }),
  view: router({
    day: proc("view.day").query(({ ctx, input }) => views.dayView(ctx.deps, input.date, input.version_id)),
    week: proc("view.week").query(({ ctx, input }) => views.weekView(ctx.deps, input.week_start, input.version_id)),
    staffToday: proc("view.staffToday").query(({ ctx, input }) => views.staffToday(ctx.deps, staffOf(ctx), input.date)),
  }),
  schedule: router({
    generate: proc("schedule.generate").mutation(({ ctx, input }) => schedule.generate(ctx.deps, actorOf(ctx), input)),
    validate: proc("schedule.validate").mutation(({ ctx, input }) => schedule.validateDraft(ctx.deps, input)),
    updateDraft: proc("schedule.updateDraft").mutation(({ ctx, input }) => schedule.updateDraft(ctx.deps, input)),
    activate: proc("schedule.activate").mutation(({ ctx, input }) => schedule.activateDraft(ctx.deps, input)),
    rollback: proc("schedule.rollback").mutation(({ ctx, input }) => schedule.rollback(ctx.deps, actorOf(ctx), input)),
  }),
  change: router({
    interpret: proc("change.interpret").mutation(({ ctx, input }) => change.interpret(ctx.deps, actorOf(ctx), input)),
    confirm: proc("change.confirm").mutation(({ ctx, input }) => change.confirm(ctx.deps, input)),
  }),
  proposal: router({
    approve: proc("proposal.approve").mutation(({ ctx, input }) => change.approve(ctx.deps, actorOf(ctx), input)),
    reject: proc("proposal.reject").mutation(({ ctx, input }) => change.reject(ctx.deps, input)),
  }),
  attendance: router({
    set: proc("attendance.set").mutation(({ ctx, input }) => ops.attendanceSet(ctx.deps, actorOf(ctx), input)),
    clear: proc("attendance.clear").mutation(({ ctx, input }) => ops.attendanceClear(ctx.deps, actorOf(ctx), input)),
  }),
  cell: router({
    check: proc("cell.check").mutation(({ ctx, input }) => ops.cellCheck(ctx.deps, actorOf(ctx), input)),
    uncheck: proc("cell.uncheck").mutation(({ ctx, input }) => ops.cellUncheck(ctx.deps, actorOf(ctx), input)),
    note: proc("cell.note").mutation(({ ctx, input }) => ops.cellNote(ctx.deps, actorOf(ctx), input)),
  }),
  memo: router({
    post: proc("memo.post").mutation(({ ctx, input }) => ops.memoPost(ctx.deps, actorOf(ctx), input)),
    markRead: proc("memo.markRead").mutation(({ ctx, input }) => ops.memoMarkRead(ctx.deps, actorOf(ctx), input)),
  }),
  notification: router({
    ack: proc("notification.ack").mutation(({ ctx, input }) => ops.notificationAck(ctx.deps, staffOf(ctx), input)),
  }),
  device: router({
    redeemInvite: proc("device.redeemInvite").mutation(({ ctx, input }) => ops.redeemInvite(ctx.deps, input)),
  }),
});

export type AppRouter = typeof appRouter;
