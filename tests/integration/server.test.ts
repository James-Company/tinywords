import { strict as assert } from "node:assert";
import { createServer } from "../../server/src/index";

/**
 * 통합 테스트 — Supabase DB 의존성이 있으므로
 * 환경 변수(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)가 설정된 환경에서만 실행 가능.
 *
 * 테스트 유저 ID는 고정값을 사용한다.
 */
const TEST_USER_ID = "00000000-0000-0000-0000-000000000001";

const server = createServer();

// userId를 포함한 context 생성 헬퍼
function makeCtx(requestId: string, nowIso: string) {
  const base = server.createContext(requestId, nowIso);
  return { ...base, userId: TEST_USER_ID };
}

async function runTests() {
  // Profile validation test
  {
    const ctx = makeCtx("req-profile-1", "2026-02-15T09:00:00Z");
    const bad = await server.users.patchProfile(ctx, { daily_target: 8 });
    assert.ok("error" in bad);
    if ("error" in bad) {
      assert.equal(bad.error.code, "VALIDATION_ERROR");
    }
  }

  console.log("✓ profile validation test passed");

  // DayPlan + complete test
  {
    const ctx = makeCtx("req-dayplan-1", "2026-02-15T09:00:00Z");
    const today = await server.dayPlans.getTodayDayPlan(ctx, true);
    assert.ok("data" in today);
    if ("data" in today) {
      const plan = today.data;
      for (const item of plan.items) {
        await server.dayPlans.patchPlanItem(ctx, plan.planId, item.planItemId, {
          recallStatus: "success",
          sentenceStatus: "done",
          speechStatus: "done",
        });
      }
      const completed = await server.dayPlans.completePlan(ctx, plan.planId);
      assert.ok("data" in completed);
    }
  }

  console.log("✓ day plan test passed");

  // Review queue test
  {
    const ctx = makeCtx("req-queue-1", "2026-02-15T10:00:00Z");
    const queue = await server.reviews.getQueue(ctx);
    assert.ok("data" in queue);
  }

  console.log("✓ review queue test passed");
  console.log("All tests passed!");
}

runTests().catch((err) => {
  console.error("Test failed:", err);
  process.exit(1);
});
