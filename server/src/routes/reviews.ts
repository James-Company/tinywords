/**
 * SSOT: docs/15_API_CONTRACT.md, docs/06_SCREEN_SPEC_INBOX.md
 */
import { fail, ok, type ApiError, type ApiSuccess } from "../../../src/api/contract";
import { sortQueue, submitReview, type ReviewResult, type ReviewTask } from "../../../src/domain/review";
import { getDb } from "../db";
import type { RequestContext } from "../context";

// DB row → domain 변환
function toReviewTask(row: Record<string, unknown>): ReviewTask {
  return {
    reviewId: row.id as string,
    itemId: row.learning_item_id as string,
    dueDate: (row.due_date as string).slice(0, 10),
    stage: row.stage as ReviewTask["stage"],
    status: row.status as ReviewTask["status"],
    completedAt: (row.completed_at as string) ?? null,
  };
}

export function registerReviewRoutes() {
  async function getQueue(ctx: RequestContext): Promise<ApiSuccess<unknown>> {
    const db = getDb();

    // queued 리뷰 + learning_item 정보 조인 (due_date가 오늘 이하인 것만)
    const { data: rows } = await db
      .from("review_tasks")
      .select(`
        *,
        learning_items (
          lemma,
          meaning_ko,
          item_type,
          example_en
        )
      `)
      .eq("user_id", ctx.userId)
      .eq("status", "queued")
      .lte("due_date", ctx.today);

    const tasks = (rows ?? []).map((row: Record<string, unknown>) => toReviewTask(row));
    const sorted = sortQueue(tasks, ctx.today);

    const overdueCount = tasks.filter((t) => t.dueDate < ctx.today).length;
    const dueTodayCount = tasks.filter((t) => t.dueDate === ctx.today).length;

    // learning_item 정보로 enrich
    const enrichedTasks = sorted.map((task) => {
      const raw = (rows ?? []).find(
        (r: Record<string, unknown>) => r.id === task.reviewId,
      );
      const li = raw?.learning_items as Record<string, unknown> | null;

      return {
        ...task,
        lemma: (li?.lemma as string) ?? task.itemId,
        meaningKo: (li?.meaning_ko as string) ?? "",
        itemType: (li?.item_type as string) ?? "vocab",
        exampleEn: (li?.example_en as string) ?? "",
      };
    });

    return ok(ctx.requestId, {
      summary: {
        queued_total: tasks.length,
        overdue_count: overdueCount,
        due_today_count: dueTodayCount,
      },
      tasks: enrichedTasks,
    });
  }

  async function submit(
    ctx: RequestContext,
    reviewId: string,
    result: ReviewResult,
  ): Promise<ApiSuccess<unknown> | ApiError> {
    const db = getDb();

    const { data: row } = await db
      .from("review_tasks")
      .select("*")
      .eq("id", reviewId)
      .eq("user_id", ctx.userId)
      .single();

    if (!row) return fail(ctx.requestId, "NOT_FOUND", "review not found");

    const task = toReviewTask(row);

    if (task.status !== "queued") {
      return fail(ctx.requestId, "CONFLICT", "review already processed");
    }

    const output = submitReview(task, result, ctx.today, ctx.nowIso, (stage, dueDate) => ({
      reviewId: "", // DB가 UUID를 생성
      itemId: task.itemId,
      stage,
      dueDate,
      status: "queued",
      completedAt: null,
    }));

    // 기존 태스크 업데이트
    if (result === "fail") {
      // fail: due_date 변경, status는 queued 유지
      await db
        .from("review_tasks")
        .update({ due_date: output.updatedTask.dueDate })
        .eq("id", reviewId);
    } else {
      // success/hard: 완료 처리
      await db
        .from("review_tasks")
        .update({ status: "done", completed_at: ctx.nowIso })
        .eq("id", reviewId);
    }

    // 다음 단계 태스크 생성
    let nextTaskData = null;
    if (output.nextTask) {
      // 중복 방지
      const { data: existing } = await db
        .from("review_tasks")
        .select("id")
        .eq("user_id", ctx.userId)
        .eq("learning_item_id", output.nextTask.itemId)
        .eq("stage", output.nextTask.stage)
        .eq("status", "queued")
        .limit(1);

      if (!existing || existing.length === 0) {
        const { data: inserted } = await db
          .from("review_tasks")
          .insert({
            user_id: ctx.userId,
            learning_item_id: output.nextTask.itemId,
            stage: output.nextTask.stage,
            due_date: output.nextTask.dueDate,
            status: "queued",
          })
          .select("*")
          .single();

        if (inserted) {
          nextTaskData = toReviewTask(inserted);
        }
      }
    }

    // 이벤트 기록
    await db.from("activity_events").insert({
      user_id: ctx.userId,
      event_name: "review_completed",
      entity_type: "review_task",
      entity_id: reviewId,
      payload: { review_id: reviewId, stage: task.stage, result },
      occurred_at: ctx.nowIso,
    });

    return ok(ctx.requestId, {
      review: output.updatedTask,
      next_task_created: output.nextTaskCreated,
      next_task: nextTaskData,
      policy_version: output.policyVersion,
    });
  }

  return { getQueue, submit };
}
