/**
 * SSOT: docs/15_API_CONTRACT.md, docs/06_SCREEN_SPEC_INBOX.md
 */
import { fail, ok, type ApiError, type ApiSuccess } from "../../../src/api/contract";
import { sortQueue, submitReview, type ReviewResult, type ReviewTask } from "../../../src/domain/review";
import type { InMemoryStore } from "../store";

interface RequestContext {
  requestId: string;
  nowIso: string;
  today: string;
}

export function registerReviewRoutes(store: InMemoryStore) {
  function getQueue(ctx: RequestContext): ApiSuccess<unknown> {
    const queued = store.reviews.filter((task) => task.status === "queued");
    const sorted = sortQueue(queued, ctx.today);

    const overdueCount = queued.filter((task) => task.dueDate < ctx.today).length;
    const dueTodayCount = queued.filter((task) => task.dueDate === ctx.today).length;

    // Enrich tasks with learning item info
    const enrichedTasks = sorted.map((task) => {
      const learningItem = store.learningItems.find((li) => li.itemId === task.itemId);
      return {
        ...task,
        lemma: learningItem?.lemma ?? task.itemId,
        meaningKo: learningItem?.meaningKo ?? "",
        itemType: learningItem?.itemType ?? "vocab",
        exampleEn: learningItem?.exampleEn ?? "",
      };
    });

    return ok(ctx.requestId, {
      summary: {
        queued_total: queued.length,
        overdue_count: overdueCount,
        due_today_count: dueTodayCount,
      },
      tasks: enrichedTasks,
    });
  }

  function submit(
    ctx: RequestContext,
    reviewId: string,
    result: ReviewResult,
  ): ApiSuccess<unknown> | ApiError {
    const idemKey = `POST:/reviews/${reviewId}/submit:${ctx.requestId}`;
    const cached = store.idempotency.get(idemKey);
    if (cached) {
      return cached as ApiSuccess<unknown>;
    }

    const task = store.reviews.find((it) => it.reviewId === reviewId);
    if (!task) return fail(ctx.requestId, "NOT_FOUND", "review not found");
    if (task.status !== "queued") {
      return fail(ctx.requestId, "CONFLICT", "review already processed");
    }

    const output = submitReview(task, result, ctx.today, ctx.nowIso, (stage, dueDate) => ({
      reviewId: `${task.itemId}-${stage}-${Date.now()}`,
      itemId: task.itemId,
      stage,
      dueDate,
      status: "queued",
      completedAt: null,
    }));

    Object.assign(task, output.updatedTask);

    if (output.nextTask) {
      const duplicateQueued = store.reviews.some(
        (existing) =>
          existing.itemId === output.nextTask?.itemId &&
          existing.stage === output.nextTask?.stage &&
          existing.status === "queued",
      );
      if (!duplicateQueued) {
        store.reviews.push(output.nextTask as ReviewTask);
      }
    }

    // Record event
    store.events.push({
      eventId: `evt-${Date.now()}-review`,
      userId: store.profile.userId,
      eventName: "review_completed",
      entityType: "review_task",
      entityId: reviewId,
      payloadJson: { review_id: reviewId, stage: task.stage, result },
      occurredAt: ctx.nowIso,
    });

    const response = ok(ctx.requestId, {
      review: task,
      next_task_created: output.nextTaskCreated,
      next_task: output.nextTask,
      policy_version: output.policyVersion,
    });
    store.idempotency.set(idemKey, response);
    return response;
  }

  return { getQueue, submit };
}
