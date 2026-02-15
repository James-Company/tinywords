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
  /** 개별 서브태스크(암기/문장/말하기) 완료 수 */
  stepsCompleted: number;
  /** 전체 서브태스크 수 (items.length × 3) */
  stepsTotal: number;
  /** 서브태스크 기반 진행률 (0–100) */
  stepPercent: number;
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

/** 개별 PlanItem의 완료된 서브태스크(암기/문장/말하기) 수를 반환 (0–3) */
export function countCompletedSteps(item: PlanItem): number {
  let count = 0;
  if (item.recallStatus === "success") count += 1;
  if (item.sentenceStatus === "done") count += 1;
  if (item.speechStatus === "done" || item.speechStatus === "skipped") count += 1;
  return count;
}

export function getDayPlanProgress(plan: DayPlan): DayPlanProgress {
  const completedCount = plan.items.filter((item) => item.isCompleted).length;
  const progressPercent =
    plan.dailyTarget < 1 ? 0 : Math.floor((completedCount / plan.dailyTarget) * 100);

  const stepsTotal = plan.items.length * 3;
  const stepsCompleted = plan.items.reduce((sum, item) => sum + countCompletedSteps(item), 0);
  const stepPercent = stepsTotal < 1 ? 0 : Math.floor((stepsCompleted / stepsTotal) * 100);

  if (plan.status === "completed") {
    return { total: plan.dailyTarget, completedCount, progressPercent: 100, stepsCompleted, stepsTotal, stepPercent: 100, ctaLabel: "오늘 완료" };
  }

  if (completedCount === 0 && stepsCompleted === 0) {
    return { total: plan.dailyTarget, completedCount, progressPercent, stepsCompleted, stepsTotal, stepPercent, ctaLabel: "학습 시작" };
  }

  return { total: plan.dailyTarget, completedCount, progressPercent, stepsCompleted, stepsTotal, stepPercent, ctaLabel: "이어하기" };
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
