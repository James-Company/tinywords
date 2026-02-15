-- 003: push_subscriptions 테이블 생성 (Web Push 알림용)
-- SSOT: docs/08_SCREEN_SPEC_SETTINGS.md – 리마인더 알림

CREATE TABLE IF NOT EXISTS push_subscriptions (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  endpoint    TEXT NOT NULL,
  p256dh      TEXT NOT NULL,
  auth        TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id, endpoint)
);

-- RLS
ALTER TABLE push_subscriptions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own push subscriptions"
  ON push_subscriptions
  FOR ALL
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- 인덱스: 리마인더 발송 시 reminder_enabled 사용자 조회
CREATE INDEX idx_push_subscriptions_user_id ON push_subscriptions(user_id);
