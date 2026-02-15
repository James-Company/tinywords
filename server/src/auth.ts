/**
 * TinyWords – Supabase Auth 미들웨어
 * SSOT: docs/22_AUTH_SPEC.md §7
 *
 * JWT 검증 후 userId를 추출하여 RequestContext에 주입한다.
 * Supabase service_role 키로 서버 사이드 검증을 수행한다.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export interface AuthResult {
  userId: string;
  userEmail?: string;
}

export interface AuthError {
  code: "UNAUTHORIZED";
  message: string;
}

let _supabaseAdmin: SupabaseClient | null = null;

/**
 * Supabase Admin 클라이언트를 지연 초기화한다.
 * service_role 키를 사용하므로 서버에서만 호출해야 한다.
 */
function getSupabaseAdmin(): SupabaseClient {
  if (_supabaseAdmin) return _supabaseAdmin;

  const url = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceKey) {
    throw new Error(
      "SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in environment variables",
    );
  }

  _supabaseAdmin = createClient(url, serviceKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });

  return _supabaseAdmin;
}

/**
 * Authorization 헤더에서 Bearer 토큰을 추출한다.
 */
function extractBearerToken(authHeader: string | undefined): string | null {
  if (!authHeader) return null;
  const parts = authHeader.split(" ");
  if (parts.length !== 2 || parts[0] !== "Bearer") return null;
  return parts[1];
}

/**
 * Bearer 토큰을 검증하고 사용자 정보를 반환한다.
 *
 * 성공 시 { userId, userEmail } 반환.
 * 실패 시 { code, message } 반환.
 */
export async function verifyAuth(
  authHeader: string | undefined,
): Promise<AuthResult | AuthError> {
  const token = extractBearerToken(authHeader);

  if (!token) {
    return { code: "UNAUTHORIZED", message: "Missing or invalid Authorization header" };
  }

  try {
    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase.auth.getUser(token);

    if (error || !data.user) {
      return { code: "UNAUTHORIZED", message: "Invalid or expired token" };
    }

    return {
      userId: data.user.id,
      userEmail: data.user.email,
    };
  } catch {
    return { code: "UNAUTHORIZED", message: "Token verification failed" };
  }
}

/**
 * 인증 결과가 에러인지 확인하는 타입 가드
 */
export function isAuthError(result: AuthResult | AuthError): result is AuthError {
  return "code" in result;
}
