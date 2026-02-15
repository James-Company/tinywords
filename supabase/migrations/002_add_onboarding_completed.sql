-- ============================================================
-- TinyWords – 온보딩 완료 플래그 추가
-- SSOT: docs/09_SCREEN_SPEC_ONBOARDING.md
--
-- user_profiles에 onboarding_completed 컬럼을 추가한다.
-- 기존 사용자(이미 학습 이력이 있는)는 true, 신규 사용자는 false.
-- ============================================================

ALTER TABLE user_profiles
  ADD COLUMN onboarding_completed BOOLEAN NOT NULL DEFAULT false;

-- 기존 사용자 중 day_plans 이력이 있으면 온보딩 완료로 처리
UPDATE user_profiles
SET onboarding_completed = true
WHERE user_id IN (SELECT DISTINCT user_id FROM day_plans);
