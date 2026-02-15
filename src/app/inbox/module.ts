/**
 * SSOT: docs/06_SCREEN_SPEC_INBOX.md
 */
import type { ReviewTask } from "../../domain/review";
import { isOverdue, sortQueue } from "../../domain/review";

export const INBOX_SCREEN_ID = "inbox";

export type InboxSortRule = "overdue_first";
export type InboxScreenState = "loading" | "ready_with_queue" | "ready_empty" | "error";

export interface InboxSummary {
  queuedTotal: number;
  overdueCount: number;
  dueTodayCount: number;
  doneTodayCount: number;
}

export function resolveInboxScreenState(tasks: ReviewTask[], hasError: boolean): InboxScreenState {
  if (hasError) return "error";
  const queued = tasks.filter((t) => t.status === "queued");
  if (queued.length === 0) return "ready_empty";
  return "ready_with_queue";
}

export function summarizeInbox(tasks: ReviewTask[], today: string): InboxSummary {
  return {
    queuedTotal: tasks.filter((task) => task.status === "queued").length,
    overdueCount: tasks.filter((task) => isOverdue(task, today)).length,
    dueTodayCount: tasks.filter(
      (task) => task.status === "queued" && task.dueDate === today,
    ).length,
    doneTodayCount: tasks.filter(
      (task) => task.status === "done" && (task.completedAt ?? "").slice(0, 10) === today,
    ).length,
  };
}

export function getInboxQueue(tasks: ReviewTask[], today: string): ReviewTask[] {
  return sortQueue(tasks.filter((task) => task.status === "queued"), today);
}

export function getInboxCTALabel(summary: InboxSummary): string {
  if (summary.queuedTotal === 0) return "복습 없음";
  if (summary.doneTodayCount > 0) return "이어서 복습";
  return "복습 시작";
}

export function getInboxCopy(summary: InboxSummary): string {
  if (summary.queuedTotal === 0 && summary.doneTodayCount > 0) {
    return "오늘 복습은 모두 끝났어요.";
  }
  if (summary.queuedTotal === 0) {
    return "오늘 복습은 모두 끝났어요.";
  }
  if (summary.overdueCount > 0) {
    return "괜찮아요. 오래된 복습부터 차근히 정리해요.";
  }
  return "짧게 복습하고 오늘 기억을 단단히 만들어요.";
}
