/**
 * SSOT: docs/15_API_CONTRACT.md, docs/05_SCREEN_SPEC_TODAY.md
 */
import { fail, ok, type ApiError, type ApiSuccess } from "../../../src/api/contract";
import {
  completeDayPlan,
  getD1DueDate,
  syncPlanItemCompletion,
  type DayPlan,
  type PlanItem,
} from "../../../src/domain/day-plan";
import { applyDayCompletion } from "../../../src/domain/streak";
import { getDb } from "../db";
import { generateWords, toLeajaItems } from "../ai-client";
import { pickFallbackWords } from "../fallback-words";
import type { RequestContext } from "../context";

// ── DB row → domain 변환 ──────────────────────────────────────

function toPlanItem(row: Record<string, unknown>): PlanItem {
  return {
    planItemId: row.id as string,
    itemId: (row.learning_item_id as string) ?? "",
    itemType: row.item_type as PlanItem["itemType"],
    lemma: row.lemma as string,
    meaningKo: row.meaning_ko as string,
    partOfSpeech: (row.part_of_speech as string) ?? "",
    exampleEn: (row.example_en as string) ?? "",
    exampleKo: (row.example_ko as string) ?? "",
    recallStatus: row.recall_status as PlanItem["recallStatus"],
    sentenceStatus: row.sentence_status as PlanItem["sentenceStatus"],
    speechStatus: row.speech_status as PlanItem["speechStatus"],
    isCompleted: row.is_completed as boolean,
  };
}

function toDayPlan(
  planRow: Record<string, unknown>,
  itemRows: Record<string, unknown>[],
): DayPlan {
  return {
    planId: planRow.id as string,
    planDate: (planRow.plan_date as string).slice(0, 10),
    dailyTarget: planRow.daily_target as 3 | 4 | 5,
    status: planRow.status as "open" | "completed",
    completedAt: (planRow.completed_at as string) ?? null,
    items: itemRows.map(toPlanItem),
  };
}

export function registerDayPlanRoutes() {
  async function getTodayDayPlan(
    ctx: RequestContext,
    createIfMissing: boolean,
  ): Promise<ApiSuccess<DayPlan> | ApiError> {
    const db = getDb();

    // 오늘 플랜 조회
    const { data: planRow } = await db
      .from("day_plans")
      .select("*")
      .eq("user_id", ctx.userId)
      .eq("plan_date", ctx.today)
      .single();

    if (planRow) {
      const { data: items } = await db
        .from("plan_items")
        .select("*")
        .eq("plan_id", planRow.id)
        .order("order_num");

      const plan = toDayPlan(planRow, items ?? []);
      const itemIds = (items ?? []).map((r: Record<string, unknown>) => r.id as string);
      const [speechAttempts, savedSentences] = await Promise.all([
        fetchSpeechAttempts(itemIds),
        fetchSentenceAttempts(itemIds),
      ]);
      return ok(ctx.requestId, { ...plan, speechAttempts, savedSentences });
    }

    if (!createIfMissing) {
      return fail(ctx.requestId, "NOT_FOUND", "today plan not found");
    }

    // 유저 프로필에서 설정 가져오기
    const { data: profile } = await db
      .from("user_profiles")
      .select("daily_target, level, learning_focus")
      .eq("user_id", ctx.userId)
      .single();

    const dailyTarget = (profile?.daily_target ?? 3) as 3 | 4 | 5;
    const level = (profile?.level as string) ?? "A2";
    const learningFocus = (profile?.learning_focus as string) ?? "travel";

    // 이전 학습 이력 수집 (AI 컨텍스트용)
    const knownWords = await collectKnownWords(ctx.userId);
    const recentWords = await collectRecentWords(ctx.userId);

    let learningItemIds: string[] = [];

    try {
      // AI 단어 생성
      const result = await generateWords({
        daily_target: dailyTarget,
        level,
        learning_focus: learningFocus,
        known_words_hint: knownWords,
        avoid_words: recentWords,
        reason: "daily_plan",
      });

      const learningItems = toLeajaItems(result.items);

      // learning_items에 저장
      const insertRows = learningItems.map((item) => ({
        user_id: ctx.userId,
        item_type: item.itemType,
        lemma: item.lemma,
        meaning_ko: item.meaningKo,
        part_of_speech: item.partOfSpeech,
        example_en: item.exampleEn,
        example_ko: item.exampleKo,
        source: item.source,
        is_active: true,
      }));

      const { data: inserted } = await db
        .from("learning_items")
        .insert(insertRows)
        .select("id");

      learningItemIds = (inserted ?? []).map((r: Record<string, unknown>) => r.id as string);
    } catch (err) {
      // AI 실패 시 폴백 풀 사용
      console.warn("[day-plans] AI generation failed, falling back:", err);
      const fallbackWords = pickFallbackWords(dailyTarget, recentWords);

      const insertRows = fallbackWords.map((w) => ({
        user_id: ctx.userId,
        item_type: w.item_type,
        lemma: w.lemma,
        meaning_ko: w.meaning_ko,
        part_of_speech: w.part_of_speech,
        example_en: w.example_en,
        example_ko: w.example_ko,
        source: "ai_generated",
        is_active: true,
      }));

      const { data: inserted } = await db
        .from("learning_items")
        .insert(insertRows)
        .select("id");

      learningItemIds = (inserted ?? []).map((r: Record<string, unknown>) => r.id as string);
    }

    // learning_items에서 방금 삽입한 항목 조회
    const { data: wordRows } = await db
      .from("learning_items")
      .select("*")
      .in("id", learningItemIds);

    const words = wordRows ?? [];

    // day_plan 생성 (동시 요청 시 유니크 제약 충돌 대비)
    const { data: newPlan, error: planErr } = await db
      .from("day_plans")
      .insert({
        user_id: ctx.userId,
        plan_date: ctx.today,
        daily_target: dailyTarget,
        status: "open",
      })
      .select("*")
      .single();

    if (planErr || !newPlan) {
      // 유니크 제약 충돌(동시 요청) → 기존 plan 재조회
      const { data: existingPlan } = await db
        .from("day_plans")
        .select("*")
        .eq("user_id", ctx.userId)
        .eq("plan_date", ctx.today)
        .single();

      if (existingPlan) {
        const { data: existingItems } = await db
          .from("plan_items")
          .select("*")
          .eq("plan_id", existingPlan.id)
          .order("order_num");

        const plan = toDayPlan(existingPlan, existingItems ?? []);
        const itemIds = (existingItems ?? []).map((r: Record<string, unknown>) => r.id as string);
        const [speechAttempts, savedSentences] = await Promise.all([
          fetchSpeechAttempts(itemIds),
          fetchSentenceAttempts(itemIds),
        ]);
        return ok(ctx.requestId, { ...plan, speechAttempts, savedSentences });
      }

      return fail(ctx.requestId, "INTERNAL_ERROR", "failed to create day plan");
    }

    // plan_items 생성
    const planItemRows = words.map((w: Record<string, unknown>, i: number) => ({
      plan_id: newPlan.id,
      user_id: ctx.userId,
      learning_item_id: w.id,
      item_type: w.item_type,
      lemma: w.lemma,
      meaning_ko: w.meaning_ko,
      part_of_speech: w.part_of_speech ?? "",
      example_en: w.example_en ?? "",
      example_ko: w.example_ko ?? "",
      recall_status: "pending",
      sentence_status: "pending",
      speech_status: "pending",
      is_completed: false,
      order_num: i + 1,
    }));

    const { data: insertedItems } = await db
      .from("plan_items")
      .insert(planItemRows)
      .select("*");

    // 이벤트 기록
    await db.from("activity_events").insert({
      user_id: ctx.userId,
      event_name: "today_started",
      entity_type: "day_plan",
      entity_id: newPlan.id,
      payload: { plan_id: newPlan.id, daily_target: dailyTarget },
      occurred_at: ctx.nowIso,
    });

    return ok(ctx.requestId, { ...toDayPlan(newPlan, insertedItems ?? []), speechAttempts: {}, savedSentences: {} });
  }

  async function patchPlanItem(
    ctx: RequestContext,
    planId: string,
    planItemId: string,
    input: {
      recallStatus?: "pending" | "success" | "fail";
      sentenceStatus?: "pending" | "done" | "skipped";
      speechStatus?: "pending" | "done" | "skipped";
      userSentence?: string;
    },
  ): Promise<ApiSuccess<unknown> | ApiError> {
    const db = getDb();

    // 플랜 소유자 확인
    const { data: plan } = await db
      .from("day_plans")
      .select("id")
      .eq("id", planId)
      .eq("user_id", ctx.userId)
      .single();

    if (!plan) {
      return fail(ctx.requestId, "NOT_FOUND", "plan not found");
    }

    // plan_item 조회
    const { data: itemRow } = await db
      .from("plan_items")
      .select("*")
      .eq("id", planItemId)
      .eq("plan_id", planId)
      .single();

    if (!itemRow) {
      return fail(ctx.requestId, "NOT_FOUND", "plan item not found");
    }

    const item = toPlanItem(itemRow);
    const merged = syncPlanItemCompletion({
      ...item,
      recallStatus: input.recallStatus ?? item.recallStatus,
      sentenceStatus: input.sentenceStatus ?? item.sentenceStatus,
      speechStatus: input.speechStatus ?? item.speechStatus,
    });

    // DB 업데이트
    await db
      .from("plan_items")
      .update({
        recall_status: merged.recallStatus,
        sentence_status: merged.sentenceStatus,
        speech_status: merged.speechStatus,
        is_completed: merged.isCompleted,
      })
      .eq("id", planItemId);

    // 문장 저장 (sentenceStatus === "done" && 문장이 있을 때)
    if (input.userSentence && merged.sentenceStatus === "done") {
      await db.from("sentence_attempts").insert({
        user_id: ctx.userId,
        plan_item_id: planItemId,
        sentence_en: input.userSentence,
      });
    }

    // 이벤트 기록
    const stepType = input.recallStatus ? "recall" : input.sentenceStatus ? "sentence" : "speech";
    await db.from("activity_events").insert({
      user_id: ctx.userId,
      event_name: "word_step_completed",
      entity_type: "plan_item",
      entity_id: planItemId,
      payload: { plan_item_id: planItemId, step_type: stepType },
      occurred_at: ctx.nowIso,
    });

    return ok(ctx.requestId, merged);
  }

  async function completePlan(
    ctx: RequestContext,
    planId: string,
  ): Promise<ApiSuccess<unknown> | ApiError> {
    const db = getDb();

    // 플랜 + 아이템 조회
    const { data: planRow } = await db
      .from("day_plans")
      .select("*")
      .eq("id", planId)
      .eq("user_id", ctx.userId)
      .single();

    if (!planRow) {
      return fail(ctx.requestId, "NOT_FOUND", "plan not found");
    }

    // 이미 완료된 플랜이면 현재 상태 반환 (멱등성)
    if (planRow.status === "completed") {
      const { data: items } = await db
        .from("plan_items")
        .select("*")
        .eq("plan_id", planId)
        .order("order_num");

      const { data: streak } = await db
        .from("streak_states")
        .select("*")
        .eq("user_id", ctx.userId)
        .single();

      return ok(ctx.requestId, {
        plan: toDayPlan(planRow, items ?? []),
        streak: streak
          ? {
              currentStreak: streak.current_streak,
              longestStreak: streak.longest_streak,
              lastCompletedDate: streak.last_completed_date,
            }
          : { currentStreak: 0, longestStreak: 0, lastCompletedDate: null },
        review_tasks_created: 0,
      });
    }

    const { data: itemRows } = await db
      .from("plan_items")
      .select("*")
      .eq("plan_id", planId)
      .order("order_num");

    const plan = toDayPlan(planRow, itemRows ?? []);
    const completed = completeDayPlan(plan, ctx.nowIso);

    if (completed.status !== "completed") {
      return fail(ctx.requestId, "VALIDATION_ERROR", "plan is not ready to complete");
    }

    // 플랜 완료 처리
    await db
      .from("day_plans")
      .update({ status: "completed", completed_at: ctx.nowIso })
      .eq("id", planId);

    // D1 리뷰 태스크 생성
    const reviewInserts = completed.items
      .filter((item) => item.itemId)
      .map((item) => ({
        user_id: ctx.userId,
        learning_item_id: item.itemId,
        due_date: getD1DueDate(completed.planDate),
        stage: "d1",
        status: "queued",
      }));

    // 중복 방지: 이미 queued인 동일 item+stage가 없는 것만 삽입
    let reviewTasksCreated = 0;
    for (const insert of reviewInserts) {
      const { data: existing } = await db
        .from("review_tasks")
        .select("id")
        .eq("user_id", ctx.userId)
        .eq("learning_item_id", insert.learning_item_id)
        .eq("stage", "d1")
        .eq("status", "queued")
        .limit(1);

      if (!existing || existing.length === 0) {
        await db.from("review_tasks").insert(insert);
        reviewTasksCreated++;
      }
    }

    // streak 업데이트
    const { data: streakRow } = await db
      .from("streak_states")
      .select("*")
      .eq("user_id", ctx.userId)
      .single();

    const currentStreak = streakRow
      ? {
          currentStreak: streakRow.current_streak as number,
          longestStreak: streakRow.longest_streak as number,
          lastCompletedDate: streakRow.last_completed_date as string | null,
        }
      : { currentStreak: 0, longestStreak: 0, lastCompletedDate: null };

    const newStreak = applyDayCompletion(currentStreak, completed.planDate);

    await db
      .from("streak_states")
      .upsert({
        user_id: ctx.userId,
        current_streak: newStreak.currentStreak,
        longest_streak: newStreak.longestStreak,
        last_completed_date: newStreak.lastCompletedDate,
        updated_at: ctx.nowIso,
      }, { onConflict: "user_id" });

    // 이벤트 기록
    await db.from("activity_events").insert([
      {
        user_id: ctx.userId,
        event_name: "today_completed",
        entity_type: "day_plan",
        entity_id: planId,
        payload: { plan_id: planId, completed_count: completed.items.length },
        occurred_at: ctx.nowIso,
      },
      {
        user_id: ctx.userId,
        event_name: "streak_updated",
        entity_type: "streak",
        entity_id: ctx.userId,
        payload: {
          date: completed.planDate,
          current: newStreak.currentStreak,
          best: newStreak.longestStreak,
        },
        occurred_at: ctx.nowIso,
      },
    ]);

    return ok(ctx.requestId, {
      plan: completed,
      streak: newStreak,
      review_tasks_created: reviewTasksCreated,
    });
  }

  return { getTodayDayPlan, patchPlanItem, completePlan };
}

// ── Speech Attempts 조회 헬퍼 ────────────────────────────────

async function fetchSpeechAttempts(
  itemIds: string[],
): Promise<Record<string, { speechId: string; score: number | null; durationMs: number; audioUri: string | null }>> {
  if (itemIds.length === 0) return {};

  const db = getDb();
  const { data: attempts } = await db
    .from("speech_attempts")
    .select("id, plan_item_id, pronunciation_score, duration_ms, audio_uri")
    .in("plan_item_id", itemIds)
    .order("created_at", { ascending: false });

  const result: Record<string, { speechId: string; score: number | null; durationMs: number; audioUri: string | null }> = {};
  for (const sa of (attempts ?? [])) {
    const planItemId = sa.plan_item_id as string;
    if (!result[planItemId]) {
      const uri = sa.audio_uri as string;
      result[planItemId] = {
        speechId: sa.id as string,
        score: sa.pronunciation_score as number | null,
        durationMs: sa.duration_ms as number,
        audioUri: uri && !uri.startsWith("local://") ? uri : null,
      };
    }
  }
  return result;
}

// ── Sentence Attempts 조회 헬퍼 ──────────────────────────────

async function fetchSentenceAttempts(
  itemIds: string[],
): Promise<Record<string, string>> {
  if (itemIds.length === 0) return {};

  const db = getDb();
  const { data: attempts } = await db
    .from("sentence_attempts")
    .select("plan_item_id, sentence_en")
    .in("plan_item_id", itemIds)
    .order("created_at", { ascending: false });

  const result: Record<string, string> = {};
  for (const sa of (attempts ?? [])) {
    const planItemId = sa.plan_item_id as string;
    if (!result[planItemId]) {
      result[planItemId] = sa.sentence_en as string;
    }
  }
  return result;
}

// ── 학습 이력 수집 헬퍼 ─────────────────────────────────────

async function collectKnownWords(userId: string): Promise<string[]> {
  const db = getDb();
  const { data } = await db
    .from("plan_items")
    .select("lemma")
    .eq("user_id", userId)
    .eq("recall_status", "success");

  if (!data) return [];
  const known = new Set(data.map((r: Record<string, unknown>) => r.lemma as string));
  return [...known];
}

async function collectRecentWords(userId: string, limit = 25): Promise<string[]> {
  const db = getDb();
  const { data } = await db
    .from("plan_items")
    .select("lemma, created_at")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (!data) return [];
  const recent = new Set(data.map((r: Record<string, unknown>) => r.lemma as string));
  return [...recent];
}
