/**
 * SSOT: docs/15_API_CONTRACT.md, docs/05_SCREEN_SPEC_TODAY.md
 */
import { fail, ok, type ApiError, type ApiSuccess } from "../../../src/api/contract";
import {
  completeDayPlan,
  getD1DueDate,
  syncPlanItemCompletion,
  type DayPlan,
} from "../../../src/domain/day-plan";
import { applyDayCompletion } from "../../../src/domain/streak";
import type { ReviewTask } from "../../../src/domain/review";
import {
  buildDayPlan,
  pickWordsForPlan,
  collectKnownWords,
  collectRecentWords,
  type InMemoryStore,
} from "../store";
import { generateWords, toLeajaItems } from "../ai-client";

interface RequestContext {
  requestId: string;
  nowIso: string;
  today: string;
}

export function registerDayPlanRoutes(store: InMemoryStore) {
  /**
   * AI를 사용하여 오늘의 학습 단어를 생성한다.
   * 실패 시 fallback pool에서 선택한다.
   */
  async function generateTodayWords(dailyTarget: 3 | 4 | 5) {
    const knownWords = collectKnownWords(store);
    const recentWords = collectRecentWords(store);

    const result = await generateWords({
      daily_target: dailyTarget,
      level: store.profile.level,
      learning_focus: store.profile.learningFocus,
      known_words_hint: knownWords,
      avoid_words: recentWords,
      reason: "daily_plan",
    });

    const learningItems = toLeajaItems(result.items);

    // AI 생성 단어를 store에 등록 (이력 추적용)
    store.learningItems.push(...learningItems);

    return learningItems;
  }

  async function getTodayDayPlan(
    ctx: RequestContext,
    createIfMissing: boolean,
  ): Promise<ApiSuccess<DayPlan> | ApiError> {
    // If today's plan already exists, return it
    if (store.todayPlan && store.todayPlan.planDate === ctx.today) {
      return ok(ctx.requestId, store.todayPlan);
    }

    // Archive old plan if it exists for a different date
    if (store.todayPlan && store.todayPlan.planDate !== ctx.today) {
      store.completedPlans.push(store.todayPlan);
      store.todayPlan = null;
    }

    if (!store.todayPlan && !createIfMissing) {
      return fail(ctx.requestId, "NOT_FOUND", "today plan not found");
    }

    // AI로 단어를 생성하고 플랜을 만든다
    try {
      const words = await generateTodayWords(store.profile.dailyTarget);
      store.todayPlan = buildDayPlan(ctx.today, store.profile.dailyTarget, words);
    } catch (err) {
      // AI 완전 실패 시 기존 풀에서 선택
      console.warn("[day-plans] AI generation failed, falling back to pool:", err);
      const usedItemIds = new Set<string>();
      for (const plan of store.completedPlans) {
        for (const item of plan.items) {
          usedItemIds.add(item.itemId);
        }
      }

      let words = pickWordsForPlan(store.learningItems, store.profile.dailyTarget, usedItemIds);
      if (words.length < store.profile.dailyTarget) {
        usedItemIds.clear();
        words = pickWordsForPlan(store.learningItems, store.profile.dailyTarget, usedItemIds);
      }
      store.todayPlan = buildDayPlan(ctx.today, store.profile.dailyTarget, words);
    }

    // Record event
    store.events.push({
      eventId: `evt-${Date.now()}`,
      userId: store.profile.userId,
      eventName: "today_started",
      entityType: "day_plan",
      entityId: store.todayPlan.planId,
      payloadJson: { plan_id: store.todayPlan.planId, daily_target: store.profile.dailyTarget },
      occurredAt: ctx.nowIso,
    });

    return ok(ctx.requestId, store.todayPlan);
  }

  function patchPlanItem(
    ctx: RequestContext,
    planId: string,
    planItemId: string,
    input: {
      recallStatus?: "pending" | "success" | "fail";
      sentenceStatus?: "pending" | "done" | "skipped";
      speechStatus?: "pending" | "done" | "skipped";
    },
  ): ApiSuccess<unknown> | ApiError {
    if (!store.todayPlan || store.todayPlan.planId !== planId) {
      return fail(ctx.requestId, "NOT_FOUND", "plan not found");
    }

    const item = store.todayPlan.items.find((it) => it.planItemId === planItemId);
    if (!item) {
      return fail(ctx.requestId, "NOT_FOUND", "plan item not found");
    }

    const merged = syncPlanItemCompletion({
      ...item,
      recallStatus: input.recallStatus ?? item.recallStatus,
      sentenceStatus: input.sentenceStatus ?? item.sentenceStatus,
      speechStatus: input.speechStatus ?? item.speechStatus,
    });

    Object.assign(item, merged);

    // Record step event
    const stepType = input.recallStatus ? "recall" : input.sentenceStatus ? "sentence" : "speech";
    store.events.push({
      eventId: `evt-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      userId: store.profile.userId,
      eventName: "word_step_completed",
      entityType: "plan_item",
      entityId: planItemId,
      payloadJson: { plan_item_id: planItemId, step_type: stepType },
      occurredAt: ctx.nowIso,
    });

    return ok(ctx.requestId, item);
  }

  function completePlan(ctx: RequestContext, planId: string): ApiSuccess<unknown> | ApiError {
    if (!store.todayPlan || store.todayPlan.planId !== planId) {
      return fail(ctx.requestId, "NOT_FOUND", "plan not found");
    }

    const idemKey = `POST:/day-plans/${planId}/complete:${ctx.requestId}`;
    const cached = store.idempotency.get(idemKey);
    if (cached) {
      return cached as ApiSuccess<unknown>;
    }

    const completed = completeDayPlan(store.todayPlan, ctx.nowIso);
    if (completed.status !== "completed") {
      return fail(ctx.requestId, "VALIDATION_ERROR", "plan is not ready to complete");
    }

    store.todayPlan = completed;
    store.streak = applyDayCompletion(store.streak, completed.planDate);

    // Create D1 review tasks per spaced review policy
    const newReviewTasks: ReviewTask[] = completed.items.map((item, index) => ({
      reviewId: `review-${item.itemId}-d1-${Date.now()}-${index}`,
      itemId: item.itemId,
      stage: "d1" as const,
      dueDate: getD1DueDate(completed.planDate),
      status: "queued" as const,
      completedAt: null,
    }));

    for (const task of newReviewTasks) {
      const exists = store.reviews.some(
        (existing) =>
          existing.itemId === task.itemId &&
          existing.stage === task.stage &&
          existing.status === "queued",
      );
      if (!exists) {
        store.reviews.push(task);
      }
    }

    // Record events
    store.events.push({
      eventId: `evt-${Date.now()}-complete`,
      userId: store.profile.userId,
      eventName: "today_completed",
      entityType: "day_plan",
      entityId: planId,
      payloadJson: {
        plan_id: planId,
        completed_count: completed.items.length,
      },
      occurredAt: ctx.nowIso,
    });

    store.events.push({
      eventId: `evt-${Date.now()}-streak`,
      userId: store.profile.userId,
      eventName: "streak_updated",
      entityType: "streak",
      entityId: store.profile.userId,
      payloadJson: {
        date: completed.planDate,
        current: store.streak.currentStreak,
        best: store.streak.longestStreak,
      },
      occurredAt: ctx.nowIso,
    });

    const response = ok(ctx.requestId, {
      plan: store.todayPlan,
      streak: store.streak,
      review_tasks_created: newReviewTasks.length,
    });
    store.idempotency.set(idemKey, response);
    return response;
  }

  return { getTodayDayPlan, patchPlanItem, completePlan };
}
