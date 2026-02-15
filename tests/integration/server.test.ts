import { strict as assert } from "node:assert";
import { createServer } from "../../server/src/index";

const server = createServer();

{
  const ctx = server.createContext("req-profile-1", "2026-02-15T09:00:00Z");
  const bad = server.users.patchProfile(ctx, { daily_target: 8 });
  assert.ok("error" in bad);
  if ("error" in bad) {
    assert.equal(bad.error.code, "VALIDATION_ERROR");
  }
}

{
  const ctx = server.createContext("req-dayplan-1", "2026-02-15T09:00:00Z");
  const today = await server.dayPlans.getTodayDayPlan(ctx, true);
  assert.ok("data" in today);
  if ("data" in today) {
    const plan = today.data;
    for (const item of plan.items) {
      server.dayPlans.patchPlanItem(ctx, plan.planId, item.planItemId, {
        recallStatus: "success",
        sentenceStatus: "done",
        speechStatus: "done",
      });
    }
    const completed = server.dayPlans.completePlan(ctx, plan.planId);
    assert.ok("data" in completed);
  }
}

{
  const ctx = server.createContext("req-queue-1", "2026-02-15T10:00:00Z");
  const queue = server.reviews.getQueue(ctx);
  assert.ok("data" in queue);
}
