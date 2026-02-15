-- ============================================================
-- TinyWords – Audio Storage Bucket (Supabase Storage)
-- 녹음 오디오 파일을 Supabase Storage에 저장한다.
-- 파일 경로 형식: {user_id}/{plan_item_id}/{timestamp}.webm
--
-- Supabase SQL Editor에서 실행한다.
-- ============================================================

-- ── 1. 버킷 생성 (private) ──────────────────────────────────
INSERT INTO storage.buckets (id, name, public)
VALUES ('audio-recordings', 'audio-recordings', false)
ON CONFLICT (id) DO NOTHING;

-- ── 2. RLS 정책: 본인 폴더에만 업로드 가능 ─────────────────
CREATE POLICY "Users can upload own audio"
ON storage.objects FOR INSERT
WITH CHECK (
  bucket_id = 'audio-recordings'
  AND auth.uid()::text = (storage.foldername(name))[1]
);

-- ── 3. RLS 정책: 본인 폴더만 조회 가능 ─────────────────────
CREATE POLICY "Users can read own audio"
ON storage.objects FOR SELECT
USING (
  bucket_id = 'audio-recordings'
  AND auth.uid()::text = (storage.foldername(name))[1]
);

-- ── 4. RLS 정책: 본인 파일만 덮어쓰기 가능 ─────────────────
CREATE POLICY "Users can update own audio"
ON storage.objects FOR UPDATE
USING (
  bucket_id = 'audio-recordings'
  AND auth.uid()::text = (storage.foldername(name))[1]
);

-- ============================================================
-- 완료: audio-recordings 버킷 + RLS 정책 4개
-- ============================================================
