-- ============================================================
-- TinyWords – Supabase PostgreSQL 스키마
-- SSOT: docs/04_DATA_MODEL.md
--
-- Supabase SQL Editor에서 실행한다.
-- 모든 테이블에 RLS를 활성화하고 auth.uid() 기반 정책을 적용한다.
-- ============================================================

-- ── 1. user_profiles ──────────────────────────────────────────

CREATE TABLE user_profiles (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE UNIQUE,
  daily_target SMALLINT NOT NULL DEFAULT 3 CHECK (daily_target BETWEEN 3 AND 5),
  level       TEXT NOT NULL DEFAULT 'A2',
  learning_focus TEXT NOT NULL DEFAULT 'travel',
  reminder_enabled BOOLEAN NOT NULL DEFAULT false,
  speech_required_for_completion BOOLEAN NOT NULL DEFAULT false,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE user_profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users_own_profile" ON user_profiles
  FOR ALL USING (auth.uid() = user_id);

-- ── 2. learning_items ─────────────────────────────────────────

CREATE TABLE learning_items (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  item_type     TEXT NOT NULL CHECK (item_type IN ('vocab','preposition','idiom','phrasal_verb','collocation')),
  lemma         TEXT NOT NULL,
  meaning_ko    TEXT NOT NULL,
  part_of_speech TEXT NOT NULL DEFAULT '',
  example_en    TEXT NOT NULL DEFAULT '',
  example_ko    TEXT NOT NULL DEFAULT '',
  source        TEXT NOT NULL DEFAULT 'ai_generated' CHECK (source IN ('ai_generated','user_added','edited')),
  is_active     BOOLEAN NOT NULL DEFAULT true,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE learning_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users_own_items" ON learning_items
  FOR ALL USING (auth.uid() = user_id);

CREATE INDEX idx_learning_items_user ON learning_items(user_id);
CREATE INDEX idx_learning_items_active ON learning_items(user_id, is_active);

-- ── 3. day_plans ──────────────────────────────────────────────

CREATE TABLE day_plans (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  plan_date    DATE NOT NULL,
  daily_target SMALLINT NOT NULL CHECK (daily_target BETWEEN 3 AND 5),
  status       TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','completed')),
  completed_at TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, plan_date)
);

ALTER TABLE day_plans ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users_own_plans" ON day_plans
  FOR ALL USING (auth.uid() = user_id);

CREATE INDEX idx_day_plans_user_date ON day_plans(user_id, plan_date DESC);

-- ── 4. plan_items ─────────────────────────────────────────────

CREATE TABLE plan_items (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id           UUID NOT NULL REFERENCES day_plans(id) ON DELETE CASCADE,
  user_id           UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  learning_item_id  UUID REFERENCES learning_items(id) ON DELETE SET NULL,
  item_type         TEXT NOT NULL,
  lemma             TEXT NOT NULL,
  meaning_ko        TEXT NOT NULL,
  part_of_speech    TEXT DEFAULT '',
  example_en        TEXT DEFAULT '',
  example_ko        TEXT DEFAULT '',
  recall_status     TEXT NOT NULL DEFAULT 'pending' CHECK (recall_status IN ('pending','success','fail')),
  sentence_status   TEXT NOT NULL DEFAULT 'pending' CHECK (sentence_status IN ('pending','done','skipped')),
  speech_status     TEXT NOT NULL DEFAULT 'pending' CHECK (speech_status IN ('pending','done','skipped')),
  is_completed      BOOLEAN NOT NULL DEFAULT false,
  order_num         SMALLINT NOT NULL DEFAULT 0,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE plan_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users_own_plan_items" ON plan_items
  FOR ALL USING (auth.uid() = user_id);

CREATE INDEX idx_plan_items_plan ON plan_items(plan_id);

-- ── 5. review_tasks ───────────────────────────────────────────

CREATE TABLE review_tasks (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  learning_item_id  UUID NOT NULL REFERENCES learning_items(id) ON DELETE CASCADE,
  due_date          DATE NOT NULL,
  stage             TEXT NOT NULL CHECK (stage IN ('d1','d3','d7','custom')),
  status            TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','done','missed')),
  completed_at      TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE review_tasks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users_own_reviews" ON review_tasks
  FOR ALL USING (auth.uid() = user_id);

CREATE INDEX idx_review_tasks_queue ON review_tasks(user_id, status, due_date);

-- ── 6. speech_attempts ────────────────────────────────────────

CREATE TABLE speech_attempts (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  plan_item_id        UUID NOT NULL REFERENCES plan_items(id) ON DELETE CASCADE,
  audio_uri           TEXT NOT NULL,
  duration_ms         INTEGER NOT NULL DEFAULT 0,
  pronunciation_score SMALLINT,
  scoring_version     TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE speech_attempts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users_own_speech" ON speech_attempts
  FOR ALL USING (auth.uid() = user_id);

-- ── 7. sentence_attempts ──────────────────────────────────────

CREATE TABLE sentence_attempts (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  plan_item_id    UUID NOT NULL REFERENCES plan_items(id) ON DELETE CASCADE,
  sentence_en     TEXT NOT NULL,
  coach_feedback  TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE sentence_attempts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users_own_sentences" ON sentence_attempts
  FOR ALL USING (auth.uid() = user_id);

-- ── 8. streak_states ──────────────────────────────────────────

CREATE TABLE streak_states (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id              UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE UNIQUE,
  current_streak       INTEGER NOT NULL DEFAULT 0,
  longest_streak       INTEGER NOT NULL DEFAULT 0,
  last_completed_date  DATE,
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE streak_states ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users_own_streak" ON streak_states
  FOR ALL USING (auth.uid() = user_id);

-- ── 9. activity_events ────────────────────────────────────────

CREATE TABLE activity_events (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  event_name   TEXT NOT NULL,
  entity_type  TEXT,
  entity_id    TEXT,
  payload      JSONB,
  occurred_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE activity_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users_own_events" ON activity_events
  FOR ALL USING (auth.uid() = user_id);

CREATE INDEX idx_activity_events_user ON activity_events(user_id, occurred_at DESC);

-- ============================================================
-- 완료: 9 테이블, RLS 활성화, 인덱스 생성
-- Supabase SQL Editor에서 이 파일을 실행하세요.
-- ============================================================
