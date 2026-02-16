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
// 서버가 환경변수를 기반으로 /config.js를 동적 생성하여 제공한다.
// 개발/프로덕션 환경에 따라 올바른 Supabase 프로젝트가 자동 선택된다.
// SUPABASE_ANON_KEY는 공개 키이므로 클라이언트에 노출해도 안전하다.
// RLS가 데이터 보안을 담당한다.
import { SUPABASE_URL, SUPABASE_ANON_KEY, API_ORIGIN } from "./config.js";

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

  // Supabase는 이메일 열거 방지를 위해 이미 가입된 이메일에도 에러를 반환하지 않는다.
  // 대신 identities가 빈 배열이면 이미 존재하는 사용자이다.
  if (data.user && data.user.identities && data.user.identities.length === 0) {
    return { success: false, error: "이미 가입된 이메일입니다. 로그인해주세요." };
  }

  // 이메일 확인이 필요한 경우 user는 있지만 session은 null
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

// ─── 회원 탈퇴 ───

/**
 * 회원 탈퇴 — 서버에서 모든 데이터 + Auth 계정 삭제 후 로컬 세션 정리
 * @returns { success: boolean, error?: string }
 */
export async function deleteAccount() {
  try {
    await authenticatedFetch("/api/v1/users/me", { method: "DELETE" });
    _currentSession = null;
    await supabase.auth.signOut();
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message || "탈퇴 처리에 실패했습니다." };
  }
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
 * API 경로를 전체 URL로 변환한다.
 * 웹 환경(같은 origin)에서는 상대 경로 그대로 사용.
 * Capacitor 네이티브 환경에서는 API_ORIGIN을 앞에 붙여 원격 서버로 요청.
 * Android 에뮬레이터에서 localhost → 10.0.2.2 자동 치환.
 */
export function resolveApiUrl(path) {
  if (path.startsWith("http")) return path;
  let origin = API_ORIGIN || "";
  if (!origin) return path;

  // Android 에뮬레이터에서 localhost는 에뮬레이터 자체를 가리킴
  // 호스트 머신 접근 시 10.0.2.2 사용 필요
  if (
    typeof window !== "undefined" &&
    window.Capacitor?.getPlatform?.() === "android" &&
    origin.includes("localhost")
  ) {
    origin = origin.replace("localhost", "10.0.2.2");
  }

  return `${origin}${path}`;
}

/**
 * 인증된 API 호출. Bearer 토큰을 자동 주입한다.
 * 401 응답 시 세션 갱신을 시도한다.
 */
export async function authenticatedFetch(path, options = {}) {
  const token = await getAccessToken();

  if (!token) {
    throw new Error("AUTH_REQUIRED");
  }

  const url = resolveApiUrl(path);

  const headers = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${token}`,
    "X-Request-Id": crypto.randomUUID(),
    "X-Client-Timezone":
      Intl.DateTimeFormat().resolvedOptions().timeZone || "Asia/Seoul",
    ...options.headers,
  };

  let res = await fetch(url, { ...options, headers });

  // 401인 경우 세션 갱신 시도 후 재요청
  if (res.status === 401) {
    const { data, error } = await supabase.auth.refreshSession();
    if (error || !data.session) {
      throw new Error("AUTH_REQUIRED");
    }
    _currentSession = data.session;
    headers.Authorization = `Bearer ${data.session.access_token}`;
    res = await fetch(url, { ...options, headers });
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

/**
 * 현재 사용자 ID 반환. 없으면 null.
 */
export function getCurrentUserId() {
  return _currentSession?.user?.id || null;
}

// ─── Audio Storage (Supabase Storage) ───

const AUDIO_BUCKET = "audio-recordings";

/**
 * 오디오 Blob을 Supabase Storage에 업로드한다.
 * @param {string} userId
 * @param {string} planItemId
 * @param {Blob} blob
 * @returns {{ path: string } | null} 저장된 파일 경로 (bucket 상대 경로)
 */
export async function uploadAudioFile(userId, planItemId, blob) {
  const ts = Date.now();
  const filePath = `${userId}/${planItemId}/${ts}.webm`;

  const { error } = await supabase.storage
    .from(AUDIO_BUCKET)
    .upload(filePath, blob, {
      contentType: "audio/webm",
      upsert: false,
    });

  if (error) {
    console.error("[audio-upload]", error);
    return null;
  }
  return { path: filePath };
}

/**
 * Supabase Storage 파일의 Signed URL(1시간 유효)을 반환한다.
 * @param {string} storagePath - bucket 상대 경로
 * @returns {string|null}
 */
export async function getAudioSignedUrl(storagePath) {
  if (!storagePath || storagePath.startsWith("local://")) return null;

  const { data, error } = await supabase.storage
    .from(AUDIO_BUCKET)
    .createSignedUrl(storagePath, 3600); // 1시간 유효

  if (error) {
    console.error("[audio-url]", error);
    return null;
  }
  return data?.signedUrl || null;
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
