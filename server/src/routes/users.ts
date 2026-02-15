/**
 * SSOT: docs/15_API_CONTRACT.md, docs/08_SCREEN_SPEC_SETTINGS.md
 */
import { fail, ok, type ApiError, type ApiSuccess } from "../../../src/api/contract";
import { getDb } from "../db";
import type { RequestContext } from "../context";

interface PatchProfileInput {
  daily_target?: number;
  level?: string;
  learning_focus?: string;
  reminder_enabled?: boolean;
  speech_required_for_completion?: boolean;
}

export function registerUserRoutes() {
  async function getProfile(ctx: RequestContext): Promise<ApiSuccess<unknown> | ApiError> {
    const db = getDb();
    const { data, error } = await db
      .from("user_profiles")
      .select("*")
      .eq("user_id", ctx.userId)
      .single();

    if (error || !data) {
      return fail(ctx.requestId, "NOT_FOUND", "profile not found");
    }

    return ok(ctx.requestId, {
      user_id: data.user_id,
      daily_target: data.daily_target,
      level: data.level,
      learning_focus: data.learning_focus,
      reminder_enabled: data.reminder_enabled,
      speech_required_for_completion: data.speech_required_for_completion,
      created_at: data.created_at,
      updated_at: data.updated_at,
    });
  }

  async function patchProfile(
    ctx: RequestContext,
    input: PatchProfileInput,
  ): Promise<ApiSuccess<unknown> | ApiError> {
    const db = getDb();

    // 현재 프로필 조회
    const { data: current, error: fetchErr } = await db
      .from("user_profiles")
      .select("*")
      .eq("user_id", ctx.userId)
      .single();

    if (fetchErr || !current) {
      return fail(ctx.requestId, "NOT_FOUND", "profile not found");
    }

    const nextDailyTarget = input.daily_target ?? current.daily_target;
    if (nextDailyTarget < 3 || nextDailyTarget > 5) {
      return fail(ctx.requestId, "VALIDATION_ERROR", "daily_target must be between 3 and 5", [
        { field: "daily_target", reason: "out_of_range" },
      ]);
    }

    const updates = {
      daily_target: nextDailyTarget,
      level: input.level ?? current.level,
      learning_focus: input.learning_focus ?? current.learning_focus,
      reminder_enabled: input.reminder_enabled ?? current.reminder_enabled,
      speech_required_for_completion:
        input.speech_required_for_completion ?? current.speech_required_for_completion,
      updated_at: ctx.nowIso,
    };

    const { error: updateErr } = await db
      .from("user_profiles")
      .update(updates)
      .eq("user_id", ctx.userId);

    if (updateErr) {
      return fail(ctx.requestId, "INTERNAL_ERROR", "failed to update profile");
    }

    // 이벤트 기록
    await db.from("activity_events").insert({
      user_id: ctx.userId,
      event_name: "settings_updated",
      entity_type: "user_profile",
      entity_id: ctx.userId,
      payload: {
        field_name: "daily_target",
        old_value: current.daily_target,
        new_value: nextDailyTarget,
        apply_timing: "next_dayplan",
      },
      occurred_at: ctx.nowIso,
    });

    return getProfile(ctx);
  }

  async function resetData(ctx: RequestContext): Promise<ApiSuccess<unknown>> {
    const db = getDb();

    // 관련 데이터 삭제 (CASCADE로 하위 데이터도 정리됨)
    await db.from("activity_events").delete().eq("user_id", ctx.userId);
    await db.from("speech_attempts").delete().eq("user_id", ctx.userId);
    await db.from("sentence_attempts").delete().eq("user_id", ctx.userId);
    await db.from("review_tasks").delete().eq("user_id", ctx.userId);
    await db.from("plan_items").delete().eq("user_id", ctx.userId);
    await db.from("day_plans").delete().eq("user_id", ctx.userId);
    await db.from("learning_items").delete().eq("user_id", ctx.userId);

    // streak 초기화
    await db
      .from("streak_states")
      .update({
        current_streak: 0,
        longest_streak: 0,
        last_completed_date: null,
        updated_at: ctx.nowIso,
      })
      .eq("user_id", ctx.userId);

    return ok(ctx.requestId, { reset: true });
  }

  /**
   * 첫 로그인 시 프로필 초기화 (없으면 생성, 있으면 기존 반환)
   * SSOT: docs/22_AUTH_SPEC.md §8.1
   */
  async function initializeUser(
    ctx: RequestContext,
    input: { timezone?: string },
  ): Promise<ApiSuccess<unknown> | ApiError> {
    if (!ctx.userId) {
      return fail(ctx.requestId, "UNAUTHORIZED", "Authentication required");
    }

    const db = getDb();

    // 기존 프로필 확인
    const { data: existing } = await db
      .from("user_profiles")
      .select("*")
      .eq("user_id", ctx.userId)
      .single();

    if (existing) {
      return ok(ctx.requestId, {
        user_id: ctx.userId,
        is_new_user: false,
        profile: {
          daily_target: existing.daily_target,
          level: existing.level,
          learning_focus: existing.learning_focus,
          reminder_enabled: existing.reminder_enabled,
        },
      });
    }

    // 새 프로필 생성
    const { error: profileErr } = await db.from("user_profiles").insert({
      user_id: ctx.userId,
      daily_target: 3,
      level: "A2",
      learning_focus: "travel",
      reminder_enabled: false,
      speech_required_for_completion: false,
      updated_at: ctx.nowIso,
    });

    if (profileErr) {
      return fail(ctx.requestId, "INTERNAL_ERROR", "failed to create profile");
    }

    // streak 초기화
    await db.from("streak_states").insert({
      user_id: ctx.userId,
      current_streak: 0,
      longest_streak: 0,
      last_completed_date: null,
    });

    return ok(ctx.requestId, {
      user_id: ctx.userId,
      is_new_user: true,
      profile: {
        daily_target: 3,
        level: "A2",
        learning_focus: "travel",
        reminder_enabled: false,
      },
    });
  }

  return { getProfile, patchProfile, resetData, initializeUser };
}
