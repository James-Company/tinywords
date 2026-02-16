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
  onboarding_completed?: boolean;
}

interface CompleteOnboardingInput {
  level: string;
  learning_focus: string;
  daily_target: number;
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
      onboarding_completed: data.onboarding_completed,
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
      onboarding_completed: input.onboarding_completed ?? current.onboarding_completed,
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

    // 프로필 created_at 초기화 (함께한 시간 리셋)
    await db
      .from("user_profiles")
      .update({ created_at: ctx.nowIso, updated_at: ctx.nowIso })
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
        onboarding_completed: existing.onboarding_completed,
        profile: {
          daily_target: existing.daily_target,
          level: existing.level,
          learning_focus: existing.learning_focus,
          reminder_enabled: existing.reminder_enabled,
          onboarding_completed: existing.onboarding_completed,
        },
      });
    }

    // 새 프로필 생성 (온보딩 미완료 상태)
    const { error: profileErr } = await db.from("user_profiles").insert({
      user_id: ctx.userId,
      daily_target: 3,
      level: "A2",
      learning_focus: "travel",
      reminder_enabled: false,
      speech_required_for_completion: false,
      onboarding_completed: false,
      updated_at: ctx.nowIso,
    });

    if (profileErr) {
      console.error("[initializeUser] profile insert error:", profileErr);
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
      onboarding_completed: false,
      profile: {
        daily_target: 3,
        level: "A2",
        learning_focus: "travel",
        reminder_enabled: false,
        onboarding_completed: false,
      },
    });
  }

  /**
   * 온보딩 완료: 사용자가 선택한 설정을 저장하고 onboarding_completed를 true로 설정
   */
  async function completeOnboarding(
    ctx: RequestContext,
    input: CompleteOnboardingInput,
  ): Promise<ApiSuccess<unknown> | ApiError> {
    if (!ctx.userId) {
      return fail(ctx.requestId, "UNAUTHORIZED", "Authentication required");
    }

    const db = getDb();

    // 입력값 검증
    const validLevels = ["A1", "A2", "B1", "B2"];
    const validFocus = ["travel", "business", "exam", "general"];
    const level = validLevels.includes(input.level) ? input.level : "A2";
    const learningFocus = validFocus.includes(input.learning_focus) ? input.learning_focus : "travel";
    const dailyTarget = input.daily_target >= 3 && input.daily_target <= 5 ? input.daily_target : 3;

    const { error: updateErr } = await db
      .from("user_profiles")
      .update({
        level,
        learning_focus: learningFocus,
        daily_target: dailyTarget,
        onboarding_completed: true,
        updated_at: ctx.nowIso,
      })
      .eq("user_id", ctx.userId);

    if (updateErr) {
      console.error("[completeOnboarding] update error:", updateErr);
      return fail(ctx.requestId, "INTERNAL_ERROR", "failed to complete onboarding");
    }

    // 이벤트 기록
    await db.from("activity_events").insert({
      user_id: ctx.userId,
      event_name: "onboarding_completed",
      entity_type: "user_profile",
      entity_id: ctx.userId,
      payload: { level, learning_focus: learningFocus, daily_target: dailyTarget },
      occurred_at: ctx.nowIso,
    });

    return ok(ctx.requestId, {
      onboarding_completed: true,
      profile: { level, learning_focus: learningFocus, daily_target: dailyTarget },
    });
  }

  /**
   * 회원 탈퇴: 모든 사용자 데이터 삭제 후 Auth 계정 삭제
   */
  async function deleteAccount(ctx: RequestContext): Promise<ApiSuccess<unknown> | ApiError> {
    if (!ctx.userId) {
      return fail(ctx.requestId, "UNAUTHORIZED", "Authentication required");
    }

    const db = getDb();

    // 1) 모든 사용자 데이터 삭제 (resetData와 동일 + 프로필/streak/push 구독)
    await db.from("push_subscriptions").delete().eq("user_id", ctx.userId);
    await db.from("activity_events").delete().eq("user_id", ctx.userId);
    await db.from("speech_attempts").delete().eq("user_id", ctx.userId);
    await db.from("sentence_attempts").delete().eq("user_id", ctx.userId);
    await db.from("review_tasks").delete().eq("user_id", ctx.userId);
    await db.from("plan_items").delete().eq("user_id", ctx.userId);
    await db.from("day_plans").delete().eq("user_id", ctx.userId);
    await db.from("learning_items").delete().eq("user_id", ctx.userId);
    await db.from("streak_states").delete().eq("user_id", ctx.userId);
    await db.from("user_profiles").delete().eq("user_id", ctx.userId);

    // 2) Supabase Auth 계정 삭제 (service_role 권한)
    const { error: authErr } = await db.auth.admin.deleteUser(ctx.userId);
    if (authErr) {
      console.error("[deleteAccount] auth delete error:", authErr);
      return fail(ctx.requestId, "INTERNAL_ERROR", "failed to delete auth account");
    }

    return ok(ctx.requestId, { deleted: true });
  }

  return { getProfile, patchProfile, resetData, initializeUser, completeOnboarding, deleteAccount };
}
