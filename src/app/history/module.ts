/**
 * SSOT: docs/07_SCREEN_SPEC_HISTORY.md
 */
export const HISTORY_SCREEN_ID = "history";

export type HistoryFilter = "all" | "learning" | "review";
export type HistoryScreenState = "loading" | "ready_with_data" | "ready_empty" | "error";

export type DayStatus = "complete_day" | "partial_day" | "inactive_day";

export interface HistoryDaySummary {
  planDate: string;
  dayplanStatus: "open" | "completed" | "expired";
  learningDone: number;
  learningTarget: number;
  reviewDone: number;
  reviewPending: number;
}

export function resolveDayStatus(day: HistoryDaySummary): DayStatus {
  if (day.dayplanStatus === "completed") return "complete_day";
  if (day.learningDone > 0 || day.reviewDone > 0) return "partial_day";
  return "inactive_day";
}

export function resolveHistoryScreenState(
  days: HistoryDaySummary[],
  hasError: boolean,
): HistoryScreenState {
  if (hasError) return "error";
  if (days.length === 0) return "ready_empty";
  return "ready_with_data";
}

export function getStreakCopy(currentStreak: number, lastDate: string | null): string {
  if (currentStreak > 0) {
    return "좋아요. 루틴이 이어지고 있어요.";
  }
  if (lastDate) {
    return "괜찮아요. 오늘부터 다시 쌓아가요.";
  }
  return "첫 기록을 만들어볼까요?";
}

export function getGapCopy(gapDays: number): string {
  if (gapDays >= 2) {
    return "오늘 3개부터 다시 시작해요.";
  }
  return "";
}
