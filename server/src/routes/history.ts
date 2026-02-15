/**
 * SSOT: docs/07_SCREEN_SPEC_HISTORY.md, docs/15_API_CONTRACT.md
 */
import { ok, type ApiSuccess } from "../../../src/api/contract";
import { getDb } from "../db";
import type { RequestContext } from "../context";

interface HistoryDay {
  plan_date: string;
  dayplan_status: "open" | "completed";
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

export function registerHistoryRoutes() {
  async function getHistory(
    ctx: RequestContext,
    _type: string = "all",
  ): Promise<ApiSuccess<unknown>> {
    const db = getDb();

    // 모든 플랜 (최신순)
    const { data: plans } = await db
      .from("day_plans")
      .select("*")
      .eq("user_id", ctx.userId)
      .order("plan_date", { ascending: false })
      .limit(30);

    const days: HistoryDay[] = [];

    for (const plan of plans ?? []) {
      const { data: items } = await db
        .from("plan_items")
        .select("*")
        .eq("plan_id", plan.id)
        .order("order_num");

      const planDate = (plan.plan_date as string).slice(0, 10);
      const completedCount = (items ?? []).filter(
        (i: Record<string, unknown>) => i.is_completed === true,
      ).length;

      // 해당 날짜의 리뷰 통계
      const { count: reviewsDone } = await db
        .from("review_tasks")
        .select("*", { count: "exact", head: true })
        .eq("user_id", ctx.userId)
        .eq("status", "done")
        .gte("completed_at", `${planDate}T00:00:00`)
        .lt("completed_at", `${planDate}T23:59:59.999`);

      const { count: reviewsPending } = await db
        .from("review_tasks")
        .select("*", { count: "exact", head: true })
        .eq("user_id", ctx.userId)
        .eq("status", "queued")
        .lte("due_date", planDate);

      days.push({
        plan_date: planDate,
        dayplan_status: plan.status as "open" | "completed",
        learning_done: completedCount,
        learning_target: plan.daily_target as number,
        review_done: reviewsDone ?? 0,
        review_pending: plan.status === "open" ? (reviewsPending ?? 0) : 0,
        items: (items ?? []).map((item: Record<string, unknown>) => ({
          lemma: item.lemma as string,
          meaning_ko: item.meaning_ko as string,
          item_type: item.item_type as string,
          recall_status: item.recall_status as string,
          sentence_status: item.sentence_status as string,
          speech_status: item.speech_status as string,
          is_completed: item.is_completed as boolean,
        })),
      });
    }

    // streak 조회
    const { data: streak } = await db
      .from("streak_states")
      .select("*")
      .eq("user_id", ctx.userId)
      .single();

    // 이벤트 기록
    await db.from("activity_events").insert({
      user_id: ctx.userId,
      event_name: "history_opened",
      entity_type: null,
      entity_id: null,
      payload: { record_count: days.length },
      occurred_at: ctx.nowIso,
    });

    return ok(ctx.requestId, {
      streak: {
        current_streak_days: streak?.current_streak ?? 0,
        best_streak_days: streak?.longest_streak ?? 0,
        last_completed_date: streak?.last_completed_date ?? null,
      },
      days,
    });
  }

  return { getHistory };
}
