/**
 * SSOT: docs/11_SPACED_REVIEW_POLICY.md
 */
import { addDays, compareLocalDate } from "./date";

export type ReviewStage = "d1" | "d3" | "d7" | "custom";
export type ReviewStatus = "queued" | "done" | "missed";
export type ReviewResult = "success" | "hard" | "fail";

export interface ReviewTask {
  reviewId: string;
  itemId: string;
  dueDate: string;
  stage: ReviewStage;
  status: ReviewStatus;
  completedAt: string | null;
}

const STAGE_ORDER: ReviewStage[] = ["d1", "d3", "d7", "custom"];

function nextStage(stage: ReviewStage): ReviewStage | null {
  if (stage === "d1") return "d3";
  if (stage === "d3") return "d7";
  return null;
}

function stageRank(stage: ReviewStage): number {
  const index = STAGE_ORDER.indexOf(stage);
  return index === -1 ? Number.MAX_SAFE_INTEGER : index;
}

export function isOverdue(task: ReviewTask, today: string): boolean {
  return task.status === "queued" && compareLocalDate(task.dueDate, today) < 0;
}

export function sortQueue(tasks: ReviewTask[], today: string): ReviewTask[] {
  return [...tasks].sort((a, b) => {
    const aOverdue = isOverdue(a, today);
    const bOverdue = isOverdue(b, today);

    if (aOverdue !== bOverdue) {
      return aOverdue ? -1 : 1;
    }

    const dateCmp = compareLocalDate(a.dueDate, b.dueDate);
    if (dateCmp !== 0) return dateCmp;
    return stageRank(a.stage) - stageRank(b.stage);
  });
}

export interface SubmitReviewOutput {
  updatedTask: ReviewTask;
  nextTask: ReviewTask | null;
  nextTaskCreated: boolean;
  policyVersion: "v1";
}

export function submitReview(
  task: ReviewTask,
  result: ReviewResult,
  today: string,
  submittedAt: string,
  createTask: (stage: ReviewStage, dueDate: string) => ReviewTask,
): SubmitReviewOutput {
  if (result === "fail") {
    return {
      updatedTask: { ...task, dueDate: addDays(today, 1), status: "queued" },
      nextTask: null,
      nextTaskCreated: false,
      policyVersion: "v1",
    };
  }

  const doneTask: ReviewTask = { ...task, status: "done", completedAt: submittedAt };
  const next = nextStage(task.stage);

  if (!next) {
    return {
      updatedTask: doneTask,
      nextTask: null,
      nextTaskCreated: false,
      policyVersion: "v1",
    };
  }

  const dueDate = addDays(today, next === "d3" ? 2 : 4);
  return {
    updatedTask: doneTask,
    nextTask: createTask(next, dueDate),
    nextTaskCreated: true,
    policyVersion: "v1",
  };
}
