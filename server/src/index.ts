/**
 * TinyWords API 서버 엔트리(인메모리 구현)
 */
import { registerDayPlanRoutes } from "./routes/day-plans";
import { registerReviewRoutes } from "./routes/reviews";
import { registerAiRoutes } from "./routes/ai";
import { registerSpeechRoutes } from "./routes/speech";
import { registerUserRoutes } from "./routes/users";
import { registerHistoryRoutes } from "./routes/history";
import { createStore } from "./store";

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
    // 잘못된 타임존이 들어오면 기본값 사용
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: DEFAULT_TIMEZONE,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(d);
  }
}

export function createServer() {
  const today = getTodayForTimezone(DEFAULT_TIMEZONE);
  const store = createStore(today);
  const dayPlans = registerDayPlanRoutes(store);
  const reviews = registerReviewRoutes(store);
  const users = registerUserRoutes(store);
  const ai = registerAiRoutes(store);
  const speech = registerSpeechRoutes({ attempts: store.speechAttempts });
  const history = registerHistoryRoutes(store);

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
