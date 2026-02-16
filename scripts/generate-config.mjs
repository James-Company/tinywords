/**
 * 빌드 시 web/config.js를 환경변수로부터 생성한다.
 *
 * 개발 환경에서는 Node.js 서버가 /config.js를 동적으로 제공하지만,
 * 프로덕션(Cloudflare Pages) 및 Capacitor 네이티브 빌드에서는
 * 정적 파일로 존재해야 한다.
 *
 * 환경변수 로드 우선순위:
 *   1. 셸 환경변수 (CI/CD)
 *   2. .env.production (프로덕션 빌드)
 *   3. .env.development (개발 빌드)
 *
 * 필요한 환경변수:
 *   SUPABASE_URL        — Supabase 프로젝트 URL
 *   SUPABASE_ANON_KEY   — Supabase 공개 키 (클라이언트 안전)
 *   VAPID_PUBLIC_KEY     — 웹 푸시 VAPID 공개 키
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");

/**
 * .env 파일을 파싱하여 key=value 쌍을 반환한다.
 * 셸 환경변수가 이미 설정되어 있으면 덮어쓰지 않는다.
 */
function loadEnvFile(filePath) {
  if (!existsSync(filePath)) return;
  const lines = readFileSync(filePath, "utf-8").split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const value = trimmed.slice(eqIdx + 1).trim();
    // 셸 환경변수가 이미 있으면 유지 (CI/CD 우선)
    if (!process.env[key]) {
      process.env[key] = value;
    }
  }
}

// 환경에 따라 .env 파일 로드
const envMode = process.env.NODE_ENV || "development";
loadEnvFile(resolve(ROOT, `.env.${envMode}`));
loadEnvFile(resolve(ROOT, ".env.development")); // fallback

const SUPABASE_URL = process.env.SUPABASE_URL || "";
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || "";
const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY || "";
// 네이티브 앱(Capacitor)에서 API 호출 시 사용할 원격 서버 origin.
// 웹에서는 빈 문자열(같은 origin에서 상대 경로로 동작).
const API_ORIGIN = process.env.API_ORIGIN || "";

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  console.warn(
    "[generate-config] ⚠ SUPABASE_URL 또는 SUPABASE_ANON_KEY가 설정되지 않았습니다.",
  );
}

const content = `// Auto-generated at build time — do not edit manually
export const SUPABASE_URL = ${JSON.stringify(SUPABASE_URL)};
export const SUPABASE_ANON_KEY = ${JSON.stringify(SUPABASE_ANON_KEY)};
export const VAPID_PUBLIC_KEY = ${JSON.stringify(VAPID_PUBLIC_KEY)};
export const API_ORIGIN = ${JSON.stringify(API_ORIGIN)};
`;

writeFileSync("web/config.js", content, "utf-8");
console.log("[generate-config] ✓ web/config.js generated");
