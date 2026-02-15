/**
 * TinyWords API 서버 엔트리 (Supabase PostgreSQL)
 */
import { registerDayPlanRoutes } from "./routes/day-plans";
import { registerReviewRoutes } from "./routes/reviews";
import { registerAiRoutes } from "./routes/ai";
import { registerSpeechRoutes } from "./routes/speech";
import { registerUserRoutes } from "./routes/users";
import { registerHistoryRoutes } from "./routes/history";

/**
 * 지정 타임존 기준 오늘 날짜(YYYY-MM-DD)를 반환한다.
 * Intl.DateTimeFormat("en-CA")는 YYYY-MM-DD 형식을 출력한다.
 * 타임스탬프 저장은 UTC, "오늘" 판별은 클라이언트 타임존 기준.
 * SSOT: docs/21_I18N_LOCALIZATION.md §6
 */
const DEFAULT_TIMEZONE = "Asia/Seoul";

function getTodayForTimezone(timeZone: string, refDate?: Date): string {
  const d = refDate ?? new Date();
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(d);
  } catch {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: DEFAULT_TIMEZONE,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(d);
  }
}

export function createServer() {
  const dayPlans = registerDayPlanRoutes();
  const reviews = registerReviewRoutes();
  const users = registerUserRoutes();
  const ai = registerAiRoutes();
  const speech = registerSpeechRoutes();
  const history = registerHistoryRoutes();

  function createContext(
    requestId: string,
    nowIso = new Date().toISOString(),
    clientTimezone?: string,
  ) {
    const tz = clientTimezone || DEFAULT_TIMEZONE;
    const today = getTodayForTimezone(tz, new Date(nowIso));
    return { requestId, nowIso, today };
  }

  return {
    health() {
      return { ok: true };
    },
    users,
    dayPlans,
    reviews,
    ai,
    speech,
    history,
    createContext,
  };
}
