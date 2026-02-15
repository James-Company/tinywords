/**
 * SSOT: docs/07_SCREEN_SPEC_HISTORY.md, docs/15_API_CONTRACT.md
 */
import { ok, type ApiSuccess } from "../../../src/api/contract";
import type { InMemoryStore } from "../store";

interface RequestContext {
  requestId: string;
  nowIso: string;
  today: string;
}

interface HistoryDay {
  plan_date: string;
  dayplan_status: "open" | "completed" | "expired";
  learning_done: number;
  learning_target: number;
  review_done: number;
  review_pending: number;
  items: Array<{
    lemma: string;
    meaning_ko: string;
    item_type: string;
    recall_status: string;
    sentence_status: string;
    speech_status: string;
    is_completed: boolean;
  }>;
}

export function registerHistoryRoutes(store: InMemoryStore) {
  function getHistory(
    ctx: RequestContext,
    _type: string = "all",
  ): ApiSuccess<unknown> {
    const days: HistoryDay[] = [];

    // Current today plan
    if (store.todayPlan) {
      const completedCount = store.todayPlan.items.filter((i) => i.isCompleted).length;
      const reviewsDoneToday = store.reviews.filter(
        (r) => r.status === "done" && r.completedAt?.slice(0, 10) === store.todayPlan!.planDate,
      ).length;
      const reviewsPending = store.reviews.filter(
        (r) => r.status === "queued" && r.dueDate <= store.todayPlan!.planDate,
      ).length;

      days.push({
        plan_date: store.todayPlan.planDate,
        dayplan_status: store.todayPlan.status,
        learning_done: completedCount,
        learning_target: store.todayPlan.dailyTarget,
        review_done: reviewsDoneToday,
        review_pending: reviewsPending,
        items: store.todayPlan.items.map((item) => ({
          lemma: item.lemma,
          meaning_ko: item.meaningKo,
          item_type: item.itemType,
          recall_status: item.recallStatus,
          sentence_status: item.sentenceStatus,
          speech_status: item.speechStatus,
          is_completed: item.isCompleted,
        })),
      });
    }

    // Historical completed plans
    for (const plan of [...store.completedPlans].reverse()) {
      const completedCount = plan.items.filter((i) => i.isCompleted).length;
      const reviewsDone = store.reviews.filter(
        (r) => r.status === "done" && r.completedAt?.slice(0, 10) === plan.planDate,
      ).length;

      days.push({
        plan_date: plan.planDate,
        dayplan_status: plan.status,
        learning_done: completedCount,
        learning_target: plan.dailyTarget,
        review_done: reviewsDone,
        review_pending: 0,
        items: plan.items.map((item) => ({
          lemma: item.lemma,
          meaning_ko: item.meaningKo,
          item_type: item.itemType,
          recall_status: item.recallStatus,
          sentence_status: item.sentenceStatus,
          speech_status: item.speechStatus,
          is_completed: item.isCompleted,
        })),
      });
    }

    // Sort by date desc
    days.sort((a, b) => (a.plan_date > b.plan_date ? -1 : a.plan_date < b.plan_date ? 1 : 0));

    // Record event
    store.events.push({
      eventId: `evt-${Date.now()}-history`,
      userId: store.profile.userId,
      eventName: "history_opened",
      entityType: null,
      entityId: null,
      payloadJson: { record_count: days.length },
      occurredAt: ctx.nowIso,
    });

    return ok(ctx.requestId, {
      streak: {
        current_streak_days: store.streak.currentStreak,
        best_streak_days: store.streak.longestStreak,
        last_completed_date: store.streak.lastCompletedDate,
      },
      days,
    });
  }

  return { getHistory };
}
