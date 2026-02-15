/**
 * SSOT: docs/05_SCREEN_SPEC_TODAY.md
 */
import type { DayPlan } from "../../domain/day-plan";
import { getDayPlanProgress } from "../../domain/day-plan";

export const TODAY_SCREEN_ID = "today";

export type TodayCompletionState = "open" | "completed";
export type TodayScreenState =
  | "loading"
  | "ready_empty"
  | "ready_active"
  | "ready_completed"
  | "error";

export function resolveTodayScreenState(plan: DayPlan | null, hasError: boolean): TodayScreenState {
  if (hasError) return "error";
  if (!plan) return "ready_empty";
  if (plan.status === "completed") return "ready_completed";
  return "ready_active";
}

export function getTodaySummaryCopy(plan: DayPlan): string {
  const progress = getDayPlanProgress(plan);
  if (progress.ctaLabel === "학습 시작") return `오늘은 ${plan.dailyTarget}개만, 확실하게.`;
  if (progress.ctaLabel === "이어하기") return "좋아요. 한 단계씩 내 것으로 만들고 있어요.";
  return "오늘 학습 완료! Inbox에서 복습해요.";
}

export function getTodayErrorCopy(errorType: "network" | "ai" | "storage" | "unknown"): string {
  switch (errorType) {
    case "network":
      return "잠시 문제가 있어요. 저장된 학습부터 이어갈게요.";
    case "ai":
      return "지금은 새 항목 생성이 어려워요. 저장된 항목부터 진행해요.";
    case "storage":
      return "데이터를 불러오지 못했어요.";
    default:
      return "잠시 문제가 있어요. 저장된 학습부터 이어갈게요.";
  }
}
