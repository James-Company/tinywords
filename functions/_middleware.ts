/**
 * TinyWords – Cloudflare Pages Middleware
 *
 * /config.js 요청을 가로채서 런타임 환경변수로부터 동적 생성한다.
 * 개발 환경의 server/src/http.ts가 /config.js를 동적 제공하는 것과 동일한 역할.
 */

interface Env {
  SUPABASE_URL?: string;
  SUPABASE_ANON_KEY?: string;
  VAPID_PUBLIC_KEY?: string;
  API_ORIGIN?: string;
}

export const onRequest: PagesFunction<Env> = async (context) => {
  const url = new URL(context.request.url);

  if (url.pathname === "/config.js") {
    const { env } = context;
    const js = `// Auto-generated from runtime environment
export const SUPABASE_URL = ${JSON.stringify(env.SUPABASE_URL || "")};
export const SUPABASE_ANON_KEY = ${JSON.stringify(env.SUPABASE_ANON_KEY || "")};
export const VAPID_PUBLIC_KEY = ${JSON.stringify(env.VAPID_PUBLIC_KEY || "")};
export const API_ORIGIN = ${JSON.stringify(env.API_ORIGIN || "")};
`;
    return new Response(js, {
      headers: {
        "Content-Type": "text/javascript; charset=utf-8",
        "Cache-Control": "no-cache",
      },
    });
  }

  return context.next();
};
