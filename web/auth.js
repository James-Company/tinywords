/**
 * TinyWords – Auth Module (Supabase Auth)
 * SSOT: docs/22_AUTH_SPEC.md
 *
 * Supabase 클라이언트 초기화, 인증 상태 관리, 토큰 주입 유틸리티.
 * 바닐라 JS 환경에서 ES 모듈 CDN으로 로드한다.
 */

// Supabase JS SDK (CDN ESM)
import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";

// ─── Supabase 설정 ───
// 환경 변수는 서버가 /auth-config 엔드포인트로 전달하거나,
// 빌드 시 주입할 수 있지만, MVP에서는 인라인 설정을 사용한다.
// SUPABASE_ANON_KEY는 공개 키이므로 클라이언트에 노출해도 안전하다.
// RLS가 데이터 보안을 담당한다.

const SUPABASE_URL = "https://eabegbtbirupyhtafldw.supabase.co";
const SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVhYmVnYnRiaXJ1cHlodGFmbGR3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzExMzExMTgsImV4cCI6MjA4NjcwNzExOH0.YteKbNxdSbNmGTQBFcwPrX_2qtFx8XkAKt52al8x0dY";

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ─── Auth State ───
let _currentSession = null;
const _authListeners = [];

/**
 * 인증 상태 변경 리스너 등록
 * callback(event, session) — event: 'SIGNED_IN' | 'SIGNED_OUT' | 'TOKEN_REFRESHED' | etc.
 */
export function onAuthStateChange(callback) {
  _authListeners.push(callback);
  // Supabase SDK 내장 리스너 등록
  supabase.auth.onAuthStateChange((event, session) => {
    _currentSession = session;
    callback(event, session);
  });
}

/**
 * 현재 세션 가져오기. 없으면 null.
 */
export async function getSession() {
  const { data, error } = await supabase.auth.getSession();
  if (error || !data.session) return null;
  _currentSession = data.session;
  return data.session;
}

/**
 * 현재 access_token 가져오기. 없으면 null.
 */
export async function getAccessToken() {
  const session = _currentSession || (await getSession());
  return session?.access_token || null;
}

// ─── 회원가입 ───

/**
 * 이메일 + 비밀번호 회원가입
 * @returns { success: boolean, error?: string, needsConfirmation?: boolean }
 */
export async function signUpWithEmail(email, password) {
  const { data, error } = await supabase.auth.signUp({ email, password });

  if (error) {
    if (error.message.includes("already registered")) {
      return { success: false, error: "이미 가입된 이메일입니다. 로그인해주세요." };
    }
    return { success: false, error: error.message };
  }

  // Supabase는 이메일 확인이 필요한 경우 user는 있지만 session은 null일 수 있다
  if (data.user && !data.session) {
    return { success: true, needsConfirmation: true };
  }

  return { success: true, needsConfirmation: false };
}

// ─── 로그인 ───

/**
 * 이메일 + 비밀번호 로그인
 * @returns { success: boolean, error?: string }
 */
export async function signInWithEmail(email, password) {
  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });

  if (error) {
    if (error.message.includes("Invalid login")) {
      return { success: false, error: "이메일 또는 비밀번호가 올바르지 않습니다." };
    }
    if (error.message.includes("Email not confirmed")) {
      return { success: false, error: "이메일 인증이 필요합니다. 메일함을 확인해주세요." };
    }
    return { success: false, error: error.message };
  }

  _currentSession = data.session;
  return { success: true };
}

/**
 * Google OAuth 로그인/가입
 */
export async function signInWithGoogle() {
  const { error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo: window.location.origin,
    },
  });

  if (error) {
    return { success: false, error: error.message };
  }

  // OAuth는 리다이렉트 플로우이므로 여기서 결과를 받지 않음
  return { success: true };
}

// ─── 로그아웃 ───

/**
 * 로그아웃 — 로컬 토큰 파기
 * SSOT: docs/22_AUTH_SPEC.md §5
 */
export async function signOut() {
  await supabase.auth.signOut();
  _currentSession = null;
}

// ─── 비밀번호 재설정 ───

/**
 * 비밀번호 재설정 이메일 발송
 */
export async function resetPassword(email) {
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${window.location.origin}?reset=true`,
  });

  if (error) {
    return { success: false, error: error.message };
  }

  // 이메일 열거 방지: 항상 성공 메시지 반환
  return { success: true };
}

// ─── API 호출 헬퍼 (토큰 자동 주입) ───

/**
 * 인증된 API 호출. Bearer 토큰을 자동 주입한다.
 * 401 응답 시 세션 갱신을 시도한다.
 */
export async function authenticatedFetch(path, options = {}) {
  const token = await getAccessToken();

  if (!token) {
    throw new Error("AUTH_REQUIRED");
  }

  const headers = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${token}`,
    "X-Request-Id": crypto.randomUUID(),
    "X-Client-Timezone":
      Intl.DateTimeFormat().resolvedOptions().timeZone || "Asia/Seoul",
    ...options.headers,
  };

  let res = await fetch(path, { ...options, headers });

  // 401인 경우 세션 갱신 시도 후 재요청
  if (res.status === 401) {
    const { data, error } = await supabase.auth.refreshSession();
    if (error || !data.session) {
      throw new Error("AUTH_REQUIRED");
    }
    _currentSession = data.session;
    headers.Authorization = `Bearer ${data.session.access_token}`;
    res = await fetch(path, { ...options, headers });
  }

  const json = await res.json();
  if (!res.ok) {
    throw new Error(json?.error?.message ?? "request failed");
  }
  return json.data;
}

// ─── 초기화 API 호출 ───

/**
 * 로그인 후 서버에 사용자 초기화 요청
 * SSOT: docs/22_AUTH_SPEC.md §8.1
 */
export async function initializeUser() {
  return authenticatedFetch("/api/v1/auth/initialize", {
    method: "POST",
    body: JSON.stringify({
      timezone:
        Intl.DateTimeFormat().resolvedOptions().timeZone || "Asia/Seoul",
    }),
  });
}

// ─── 입력 검증 ───

/**
 * 이메일 검증
 */
export function validateEmail(email) {
  if (!email) return "이메일을 입력해주세요.";
  if (email.length > 255) return "이메일이 너무 깁니다.";
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) return "올바른 이메일 주소를 입력해주세요.";
  return null;
}

/**
 * 비밀번호 검증
 */
export function validatePassword(password) {
  if (!password) return "비밀번호를 입력해주세요.";
  if (password.length < 8) return "비밀번호는 8자 이상이어야 합니다.";
  if (password.length > 72) return "비밀번호가 너무 깁니다.";
  if (!/[a-zA-Z]/.test(password) || !/[0-9]/.test(password)) {
    return "영문과 숫자를 모두 포함해주세요.";
  }
  return null;
}
