/**
 * SSOT: docs/15_API_CONTRACT.md, docs/08_SCREEN_SPEC_SETTINGS.md
 */
import { fail, ok, type ApiError, type ApiSuccess } from "../../../src/api/contract";
import type { InMemoryStore } from "../store";

interface RequestContext {
  requestId: string;
  nowIso: string;
  userId?: string;
  userEmail?: string;
}

interface PatchProfileInput {
  daily_target?: number;
  level?: string;
  learning_focus?: string;
  reminder_enabled?: boolean;
  speech_required_for_completion?: boolean;
}

export function registerUserRoutes(store: InMemoryStore) {
  function getProfile(ctx: RequestContext): ApiSuccess<unknown> {
    return ok(ctx.requestId, {
      user_id: store.profile.userId,
      daily_target: store.profile.dailyTarget,
      level: store.profile.level,
      learning_focus: store.profile.learningFocus,
      reminder_enabled: store.profile.reminderEnabled,
      speech_required_for_completion: store.profile.speechRequiredForCompletion,
      updated_at: store.profile.updatedAt,
    });
  }

  function patchProfile(ctx: RequestContext, input: PatchProfileInput): ApiSuccess<unknown> | ApiError {
    const nextDailyTarget = input.daily_target ?? store.profile.dailyTarget;
    if (nextDailyTarget < 3 || nextDailyTarget > 5) {
      return fail(ctx.requestId, "VALIDATION_ERROR", "daily_target must be between 3 and 5", [
        { field: "daily_target", reason: "out_of_range" },
      ]);
    }

    const oldTarget = store.profile.dailyTarget;
    store.profile = {
      ...store.profile,
      dailyTarget: nextDailyTarget as 3 | 4 | 5,
      level: input.level ?? store.profile.level,
      learningFocus: input.learning_focus ?? store.profile.learningFocus,
      reminderEnabled: input.reminder_enabled ?? store.profile.reminderEnabled,
      speechRequiredForCompletion: input.speech_required_for_completion ?? store.profile.speechRequiredForCompletion,
      updatedAt: ctx.nowIso,
    };

    // Record event
    store.events.push({
      eventId: `evt-${Date.now()}-settings`,
      userId: store.profile.userId,
      eventName: "settings_updated",
      entityType: "user_profile",
      entityId: store.profile.userId,
      payloadJson: {
        field_name: "daily_target",
        old_value: oldTarget,
        new_value: nextDailyTarget,
        apply_timing: "next_dayplan",
      },
      occurredAt: ctx.nowIso,
    });

    return getProfile(ctx);
  }

  function resetData(ctx: RequestContext): ApiSuccess<unknown> {
    store.todayPlan = null;
    store.reviews = [];
    store.speechAttempts = [];
    store.sentenceAttempts = [];
    store.events = [];
    store.completedPlans = [];
    store.streak = { currentStreak: 0, longestStreak: 0, lastCompletedDate: null };
    store.idempotency.clear();

    return ok(ctx.requestId, { reset: true });
  }

  /**
   * 첫 로그인 시 프로필 초기화 (없으면 생성, 있으면 기존 반환)
   * SSOT: docs/22_AUTH_SPEC.md §8.1
   */
  function initializeUser(
    ctx: RequestContext,
    input: { timezone?: string },
  ): ApiSuccess<unknown> | ApiError {
    const userId = ctx.userId;
    if (!userId) {
      return fail(ctx.requestId, "UNAUTHORIZED", "Authentication required");
    }

    // 기존 프로필이 있는 경우 (하드코딩 user-1이 아닌 실제 userId 확인)
    if (store.profile.userId === userId) {
      return ok(ctx.requestId, {
        user_id: userId,
        is_new_user: false,
        profile: {
          daily_target: store.profile.dailyTarget,
          level: store.profile.level,
          learning_focus: store.profile.learningFocus,
          reminder_enabled: store.profile.reminderEnabled,
        },
      });
    }

    // 새로운 사용자 — 프로필 초기화
    store.profile = {
      userId,
      dailyTarget: 3,
      level: "A2",
      learningFocus: "travel",
      reminderEnabled: false,
      speechRequiredForCompletion: false,
      updatedAt: ctx.nowIso,
    };

    // 기존 데이터 초기화
    store.todayPlan = null;
    store.reviews = [];
    store.speechAttempts = [];
    store.sentenceAttempts = [];
    store.events = [];
    store.completedPlans = [];
    store.streak = { currentStreak: 0, longestStreak: 0, lastCompletedDate: null };
    store.idempotency.clear();

    return ok(ctx.requestId, {
      user_id: userId,
      is_new_user: true,
      profile: {
        daily_target: store.profile.dailyTarget,
        level: store.profile.level,
        learning_focus: store.profile.learningFocus,
        reminder_enabled: store.profile.reminderEnabled,
      },
    });
  }

  return { getProfile, patchProfile, resetData, initializeUser };
}
