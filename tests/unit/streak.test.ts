import { strict as assert } from "node:assert";
import { applyDayCompletion, type StreakState } from "../../src/domain/streak";

const init: StreakState = {
  currentStreak: 0,
  longestStreak: 0,
  lastCompletedDate: null,
};

{
  const next = applyDayCompletion(init, "2026-02-15");
  assert.equal(next.currentStreak, 1);
  assert.equal(next.longestStreak, 1);
  assert.equal(next.lastCompletedDate, "2026-02-15");
}

{
  const a = applyDayCompletion(init, "2026-02-15");
  const b = applyDayCompletion(a, "2026-02-16");
  assert.equal(b.currentStreak, 2);
  assert.equal(b.longestStreak, 2);
}

{
  const a = applyDayCompletion(init, "2026-02-15");
  const b = applyDayCompletion(a, "2026-02-17");
  assert.equal(b.currentStreak, 1);
  assert.equal(b.longestStreak, 1);
}

{
  const a = applyDayCompletion(init, "2026-02-15");
  const b = applyDayCompletion(a, "2026-02-15");
  assert.equal(b.currentStreak, 1);
  assert.equal(b.longestStreak, 1);
}
