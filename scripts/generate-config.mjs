/**
 * 빌드 시 web/config.js를 환경변수로부터 생성한다.
 *
 * 개발 환경에서는 Node.js 서버가 /config.js를 동적으로 제공하지만,
 * 프로덕션(Cloudflare Pages)에서는 정적 파일로 존재해야 한다.
 *
 * 필요한 환경변수:
 *   SUPABASE_URL        — Supabase 프로젝트 URL
 *   SUPABASE_ANON_KEY   — Supabase 공개 키 (클라이언트 안전)
 *   VAPID_PUBLIC_KEY     — 웹 푸시 VAPID 공개 키
 */

import { writeFileSync } from "node:fs";

const SUPABASE_URL = process.env.SUPABASE_URL || "";
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || "";
const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY || "";

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  console.warn(
    "[generate-config] ⚠ SUPABASE_URL 또는 SUPABASE_ANON_KEY가 설정되지 않았습니다.",
  );
}

const content = `// Auto-generated at build time — do not edit manually
export const SUPABASE_URL = ${JSON.stringify(SUPABASE_URL)};
export const SUPABASE_ANON_KEY = ${JSON.stringify(SUPABASE_ANON_KEY)};
export const VAPID_PUBLIC_KEY = ${JSON.stringify(VAPID_PUBLIC_KEY)};
`;

writeFileSync("web/config.js", content, "utf-8");
console.log("[generate-config] ✓ web/config.js generated");
