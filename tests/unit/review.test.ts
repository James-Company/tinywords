import { strict as assert } from "node:assert";
import { sortQueue, submitReview, type ReviewTask } from "../../src/domain/review";

function baseTask(reviewId: string, dueDate: string, stage: "d1" | "d3" | "d7"): ReviewTask {
  return {
    reviewId,
    itemId: `item-${reviewId}`,
    dueDate,
    stage,
    status: "queued",
    completedAt: null,
  };
}

{
  const today = "2026-02-15";
  const tasks = [
    baseTask("a", "2026-02-15", "d1"),
    baseTask("b", "2026-02-14", "d3"),
    baseTask("c", "2026-02-10", "d1"),
  ];
  const sorted = sortQueue(tasks, today);
  assert.equal(sorted[0].reviewId, "c");
  assert.equal(sorted[1].reviewId, "b");
  assert.equal(sorted[2].reviewId, "a");
}

{
  const task = baseTask("d1-task", "2026-02-15", "d1");
  const out = submitReview(
    task,
    "success",
    "2026-02-15",
    "2026-02-15T08:00:00Z",
    (stage, dueDate) => ({
      reviewId: "next",
      itemId: task.itemId,
      stage,
      dueDate,
      status: "queued",
      completedAt: null,
    }),
  );

  assert.equal(out.updatedTask.status, "done");
  assert.equal(out.nextTaskCreated, true);
  assert.equal(out.nextTask?.stage, "d3");
}

{
  const task = baseTask("d1-fail", "2026-02-15", "d1");
  const out = submitReview(
    task,
    "fail",
    "2026-02-15",
    "2026-02-15T08:00:00Z",
    () => {
      throw new Error("must not create next task");
    },
  );

  assert.equal(out.updatedTask.status, "queued");
  assert.equal(out.updatedTask.dueDate, "2026-02-16");
  assert.equal(out.nextTaskCreated, false);
}
