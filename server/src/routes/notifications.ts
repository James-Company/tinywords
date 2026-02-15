/**
 * TinyWords – 푸시 알림 구독 관리 + 리마인더 스케줄러
 * SSOT: docs/08_SCREEN_SPEC_SETTINGS.md – 알림 설정
 */
import { fail, ok, type ApiError, type ApiSuccess } from "../../../src/api/contract";
import { getDb } from "../db";
import type { RequestContext } from "../context";

// ─── 타입 ───
interface PushSubscriptionInput {
  endpoint: string;
  keys: {
    p256dh: string;
    auth: string;
  };
}

// ─── 라우트 ───
export function registerNotificationRoutes() {
  /**
   * 푸시 구독 저장
   * POST /api/v1/notifications/subscribe
   */
  async function subscribe(
    ctx: RequestContext,
    input: PushSubscriptionInput,
  ): Promise<ApiSuccess<unknown> | ApiError> {
    if (!input.endpoint || !input.keys?.p256dh || !input.keys?.auth) {
      return fail(ctx.requestId, "VALIDATION_ERROR", "Invalid push subscription data", [
        { field: "subscription", reason: "missing_fields" },
      ]);
    }

    const db = getDb();

    // upsert: 같은 endpoint가 있으면 키 업데이트
    const { error } = await db.from("push_subscriptions").upsert(
      {
        user_id: ctx.userId,
        endpoint: input.endpoint,
        p256dh: input.keys.p256dh,
        auth: input.keys.auth,
      },
      { onConflict: "user_id,endpoint" },
    );

    if (error) {
      console.error("[notifications] subscribe error:", error);
      return fail(ctx.requestId, "INTERNAL_ERROR", "Failed to save push subscription");
    }

    return ok(ctx.requestId, { subscribed: true });
  }

  /**
   * 푸시 구독 해제
   * POST /api/v1/notifications/unsubscribe
   */
  async function unsubscribe(
    ctx: RequestContext,
    input: { endpoint: string },
  ): Promise<ApiSuccess<unknown> | ApiError> {
    if (!input.endpoint) {
      return fail(ctx.requestId, "VALIDATION_ERROR", "endpoint is required");
    }

    const db = getDb();

    const { error } = await db
      .from("push_subscriptions")
      .delete()
      .eq("user_id", ctx.userId)
      .eq("endpoint", input.endpoint);

    if (error) {
      console.error("[notifications] unsubscribe error:", error);
      return fail(ctx.requestId, "INTERNAL_ERROR", "Failed to remove push subscription");
    }

    return ok(ctx.requestId, { unsubscribed: true });
  }

  /**
   * VAPID 공개키 반환
   * GET /api/v1/notifications/vapid-public-key
   */
  function getVapidPublicKey(ctx: RequestContext): ApiSuccess<unknown> {
    return ok(ctx.requestId, {
      publicKey: process.env.VAPID_PUBLIC_KEY ?? "",
    });
  }

  return { subscribe, unsubscribe, getVapidPublicKey };
}

// ─── 리마인더 스케줄러 ───

/**
 * 매일 정해진 시각(한국 시간 기준 09:00)에
 * reminder_enabled=true인 사용자에게 푸시 알림을 발송한다.
 *
 * 조건:
 * - reminder_enabled = true
 * - 오늘 day_plan이 없거나, status가 'completed'가 아닌 경우
 * - 해당 사용자에 push_subscriptions 레코드가 있는 경우
 */
export async function sendReminders(): Promise<number> {
  const webpush = await import("web-push");

  const vapidPublicKey = process.env.VAPID_PUBLIC_KEY;
  const vapidPrivateKey = process.env.VAPID_PRIVATE_KEY;
  const vapidSubject = process.env.VAPID_SUBJECT || "mailto:tinywords@example.com";

  if (!vapidPublicKey || !vapidPrivateKey) {
    console.warn("[reminder] VAPID keys not configured, skipping");
    return 0;
  }

  webpush.default.setVapidDetails(vapidSubject, vapidPublicKey, vapidPrivateKey);

  const db = getDb();

  // 한국 시간 기준 오늘 날짜
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());

  // 1단계: reminder_enabled = true인 사용자 목록 조회
  const { data: enabledProfiles, error: profileErr } = await db
    .from("user_profiles")
    .select("user_id")
    .eq("reminder_enabled", true);

  if (profileErr || !enabledProfiles || enabledProfiles.length === 0) {
    return 0;
  }

  const enabledUserIds = enabledProfiles.map((p: { user_id: string }) => p.user_id);

  // 2단계: 해당 사용자들의 push subscription 조회
  const { data: subscribers, error: subErr } = await db
    .from("push_subscriptions")
    .select("user_id, endpoint, p256dh, auth")
    .in("user_id", enabledUserIds);

  if (subErr || !subscribers || subscribers.length === 0) {
    return 0;
  }

  // 오늘 이미 학습 완료한 사용자 제외
  const userIds = [...new Set(subscribers.map((s: { user_id: string }) => s.user_id))];
  const { data: completedPlans } = await db
    .from("day_plans")
    .select("user_id")
    .eq("plan_date", today)
    .eq("status", "completed")
    .in("user_id", userIds);

  const completedUserIds = new Set(
    (completedPlans || []).map((p: { user_id: string }) => p.user_id),
  );

  // 완료하지 않은 사용자에게만 발송
  const targets = subscribers.filter(
    (s: { user_id: string }) => !completedUserIds.has(s.user_id),
  );

  const payload = JSON.stringify({
    title: "TinyWords",
    body: "오늘의 단어가 기다리고 있어요! 지금 학습을 시작해볼까요?",
    tag: "tinywords-daily-reminder",
    url: "/",
  });

  let sentCount = 0;

  for (const sub of targets) {
    const pushSub = {
      endpoint: (sub as { endpoint: string }).endpoint,
      keys: {
        p256dh: (sub as { p256dh: string }).p256dh,
        auth: (sub as { auth: string }).auth,
      },
    };

    try {
      await webpush.default.sendNotification(pushSub, payload);
      sentCount++;
    } catch (err: unknown) {
      const statusCode = (err as { statusCode?: number }).statusCode;
      // 410 Gone 또는 404: 구독 만료 → DB에서 제거
      if (statusCode === 410 || statusCode === 404) {
        await db
          .from("push_subscriptions")
          .delete()
          .eq("endpoint", (sub as { endpoint: string }).endpoint);
        console.log("[reminder] Removed expired subscription:", (sub as { endpoint: string }).endpoint);
      } else {
        console.error("[reminder] Push send error:", err);
      }
    }
  }

  console.log(`[reminder] Sent ${sentCount} reminder(s) for ${today}`);
  return sentCount;
}

/**
 * 리마인더 스케줄러 시작
 * 매분 체크하여 한국 시간 09:00에 발송
 */
export function startReminderScheduler() {
  let lastSentDate = "";

  const REMINDER_HOUR = 9; // 한국 시간 오전 9시

  const check = () => {
    const now = new Date();
    // 한국 시간 기준 현재 시각
    const kstParts = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Seoul",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    })
      .formatToParts(now)
      .reduce(
        (acc, part) => {
          acc[part.type] = part.value;
          return acc;
        },
        {} as Record<string, string>,
      );

    const kstDate = `${kstParts.year}-${kstParts.month}-${kstParts.day}`;
    const kstHour = Number(kstParts.hour);
    const kstMinute = Number(kstParts.minute);

    // 오전 9시 0분~4분 사이이고, 오늘 아직 안 보냈으면 발송
    if (kstHour === REMINDER_HOUR && kstMinute < 5 && lastSentDate !== kstDate) {
      lastSentDate = kstDate;
      sendReminders().catch((err) => {
        console.error("[reminder] Scheduler error:", err);
      });
    }
  };

  // 60초마다 체크
  setInterval(check, 60_000);
  console.log("[reminder] Scheduler started (daily at 09:00 KST)");
}
