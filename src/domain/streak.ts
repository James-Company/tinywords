/**
 * SSOT: docs/12_STREAK_RULES.md
 */
import { addDays, compareLocalDate } from "./date";

export interface StreakState {
  currentStreak: number;
  longestStreak: number;
  lastCompletedDate: string | null;
}

export function applyDayCompletion(
  state: StreakState,
  completedLocalDate: string,
): StreakState {
  if (!state.lastCompletedDate) {
    return {
      currentStreak: 1,
      longestStreak: Math.max(1, state.longestStreak),
      lastCompletedDate: completedLocalDate,
    };
  }

  if (state.lastCompletedDate === completedLocalDate) {
    return state;
  }

  const expectedNext = addDays(state.lastCompletedDate, 1);
  const isConsecutive = compareLocalDate(expectedNext, completedLocalDate) === 0;
  const nextCurrent = isConsecutive ? state.currentStreak + 1 : 1;

  return {
    currentStreak: nextCurrent,
    longestStreak: Math.max(state.longestStreak, nextCurrent),
    lastCompletedDate: completedLocalDate,
  };
}
