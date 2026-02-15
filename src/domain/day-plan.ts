/**
 * SSOT: docs/04_DATA_MODEL.md, docs/11_SPACED_REVIEW_POLICY.md
 */
export type ItemType =
  | "vocab"
  | "preposition"
  | "idiom"
  | "phrasal_verb"
  | "collocation";

import { addDays } from "./date";

export type RecallStatus = "pending" | "success" | "fail";
export type StepStatus = "pending" | "done" | "skipped";

export interface PlanItem {
  planItemId: string;
  itemId: string;
  itemType: ItemType;
  lemma: string;
  meaningKo: string;
  partOfSpeech?: string;
  exampleEn?: string;
  exampleKo?: string;
  recallStatus: RecallStatus;
  sentenceStatus: StepStatus;
  speechStatus: StepStatus;
  isCompleted: boolean;
}

export interface DayPlan {
  planId: string;
  planDate: string;
  dailyTarget: 3 | 4 | 5;
  status: "open" | "completed";
  items: PlanItem[];
  completedAt: string | null;
}

export interface DayPlanProgress {
  total: number;
  completedCount: number;
  progressPercent: number;
  ctaLabel: "학습 시작" | "이어하기" | "오늘 완료";
}

export function isPlanItemCompleted(item: PlanItem): boolean {
  const speechOk = item.speechStatus === "done" || item.speechStatus === "skipped";
  return (
    item.recallStatus === "success" &&
    item.sentenceStatus === "done" &&
    speechOk
  );
}

export function syncPlanItemCompletion(item: PlanItem): PlanItem {
  return { ...item, isCompleted: isPlanItemCompleted(item) };
}

export function getDayPlanProgress(plan: DayPlan): DayPlanProgress {
  const completedCount = plan.items.filter((item) => item.isCompleted).length;
  const progressPercent =
    plan.dailyTarget < 1 ? 0 : Math.floor((completedCount / plan.dailyTarget) * 100);

  if (plan.status === "completed") {
    return { total: plan.dailyTarget, completedCount, progressPercent: 100, ctaLabel: "오늘 완료" };
  }

  if (completedCount === 0) {
    return { total: plan.dailyTarget, completedCount, progressPercent, ctaLabel: "학습 시작" };
  }

  return { total: plan.dailyTarget, completedCount, progressPercent, ctaLabel: "이어하기" };
}

export function canCompleteDayPlan(plan: DayPlan): boolean {
  return plan.items.every((item) => item.isCompleted);
}

export function completeDayPlan(
  plan: DayPlan,
  completedAtIso: string,
): DayPlan {
  if (!canCompleteDayPlan(plan)) {
    return plan;
  }

  return { ...plan, status: "completed", completedAt: completedAtIso };
}

export function getD1DueDate(planDate: string): string {
  return addDays(planDate, 1);
}
