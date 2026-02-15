/**
 * TinyWords – Cloudflare Pages Function (catch-all)
 * /api/v1/* 요청을 처리하는 서버리스 함수.
 *
 * 기존 server/src 로직을 재사용하여
 * Cloudflare Workers 런타임에서 실행한다.
 */
import { createServer } from "../../../server/src/index";
import { verifyAuth, isAuthError } from "../../../server/src/auth";

interface Env {
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  OPENAI_API_KEY: string;
}

// ─── CORS 헤더 ───
const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
  "Access-Control-Allow-Headers":
    "Content-Type, Authorization, X-Request-Id, X-App-Version, X-Client-Timezone",
};

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      ...CORS_HEADERS,
    },
  });
}

function mapStatus(payload: unknown): number {
  if (!payload || typeof payload !== "object" || !("error" in payload)) return 200;
  const code = (payload as { error: { code?: string } }).error.code;
  switch (code) {
    case "VALIDATION_ERROR":
      return 400;
    case "UNAUTHORIZED":
      return 401;
    case "FORBIDDEN":
      return 403;
    case "NOT_FOUND":
      return 404;
    case "CONFLICT":
      return 409;
    case "RATE_LIMITED":
      return 429;
    case "AI_UPSTREAM_ERROR":
      return 502;
    default:
      return 500;
  }
}

// 모듈 레벨 싱글턴: 같은 isolate 내 요청 간 재사용
let app: ReturnType<typeof createServer> | null = null;

function getApp(): ReturnType<typeof createServer> {
  if (!app) app = createServer();
  return app;
}

type JsonObject = Record<string, unknown>;

// ─── Pages Function Handler ───

export const onRequest: PagesFunction<Env> = async (context) => {
  const { request, env } = context;

  // Cloudflare env → process.env 브릿지 (기존 코드 호환)
  process.env.SUPABASE_URL = env.SUPABASE_URL;
  process.env.SUPABASE_SERVICE_ROLE_KEY = env.SUPABASE_SERVICE_ROLE_KEY;
  process.env.OPENAI_API_KEY = env.OPENAI_API_KEY;

  const method = request.method.toUpperCase();

  // CORS preflight
  if (method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  const server = getApp();
  const url = new URL(request.url);
  const reqPath = url.pathname;
  const requestId = request.headers.get("x-request-id") || crypto.randomUUID();
  const clientTimezone = request.headers.get("x-client-timezone") || undefined;
  const ctx = server.createContext(requestId, undefined, clientTimezone);

  // ── 인증 검증 ──
  const authResult = await verifyAuth(
    request.headers.get("authorization") ?? undefined,
  );

  if (isAuthError(authResult)) {
    return jsonResponse(401, {
      error: { code: authResult.code, message: authResult.message },
      meta: { request_id: requestId, timestamp: new Date().toISOString() },
    });
  }

  const authedCtx = {
    ...ctx,
    userId: authResult.userId,
    userEmail: authResult.userEmail,
  };

  try {
    // Body 파싱
    let body: JsonObject = {};
    if (method === "POST" || method === "PATCH" || method === "PUT") {
      try {
        body = (await request.json()) as JsonObject;
      } catch {
        body = {};
      }
    }

    // ── Auth initialize ──
    if (method === "POST" && reqPath === "/api/v1/auth/initialize") {
      const out = await server.users.initializeUser(authedCtx, {
        timezone: (body.timezone as string) || undefined,
      });
      return jsonResponse(mapStatus(out), out);
    }

    // ── User profile ──
    if (method === "GET" && reqPath === "/api/v1/users/me/profile") {
      const out = await server.users.getProfile(authedCtx);
      return jsonResponse(mapStatus(out), out);
    }
    if (method === "PATCH" && reqPath === "/api/v1/users/me/profile") {
      const out = await server.users.patchProfile(authedCtx, body);
      return jsonResponse(mapStatus(out), out);
    }
    if (method === "POST" && reqPath === "/api/v1/users/me/reset") {
      const out = await server.users.resetData(authedCtx);
      return jsonResponse(mapStatus(out), out);
    }

    // ── DayPlan / Today ──
    if (method === "GET" && reqPath === "/api/v1/day-plans/today") {
      const createIfMissing = url.searchParams.get("create_if_missing") === "true";
      const out = await server.dayPlans.getTodayDayPlan(authedCtx, createIfMissing);
      return jsonResponse(mapStatus(out), out);
    }

    const planItemMatch = reqPath.match(
      /^\/api\/v1\/day-plans\/([^/]+)\/items\/([^/]+)$/,
    );
    if (method === "PATCH" && planItemMatch) {
      const out = await server.dayPlans.patchPlanItem(
        authedCtx,
        planItemMatch[1],
        planItemMatch[2],
        body,
      );
      return jsonResponse(mapStatus(out), out);
    }

    const planCompleteMatch = reqPath.match(
      /^\/api\/v1\/day-plans\/([^/]+)\/complete$/,
    );
    if (method === "POST" && planCompleteMatch) {
      const out = await server.dayPlans.completePlan(authedCtx, planCompleteMatch[1]);
      return jsonResponse(mapStatus(out), out);
    }

    // ── Reviews / Inbox ──
    if (method === "GET" && reqPath === "/api/v1/reviews/queue") {
      const out = await server.reviews.getQueue(authedCtx);
      return jsonResponse(mapStatus(out), out);
    }

    const reviewSubmitMatch = reqPath.match(
      /^\/api\/v1\/reviews\/([^/]+)\/submit$/,
    );
    if (method === "POST" && reviewSubmitMatch) {
      const out = await server.reviews.submit(
        authedCtx,
        reviewSubmitMatch[1],
        (body.result as "success" | "hard" | "fail") ?? "fail",
      );
      return jsonResponse(mapStatus(out), out);
    }

    // ── History ──
    if (method === "GET" && reqPath === "/api/v1/history") {
      const type = url.searchParams.get("type") || "all";
      const out = await server.history.getHistory(authedCtx, type);
      return jsonResponse(mapStatus(out), out);
    }

    // ── AI endpoints ──
    if (method === "POST" && reqPath === "/api/v1/ai/word-generation") {
      const out = await server.ai.wordGeneration(authedCtx, body as never);
      return jsonResponse(mapStatus(out), out);
    }

    if (method === "POST" && reqPath === "/api/v1/ai/sentence-coach") {
      const out = server.ai.sentenceCoach(authedCtx, body as never);
      return jsonResponse(mapStatus(out), out);
    }

    // ── Speech ──
    if (method === "POST" && reqPath === "/api/v1/speech-attempts") {
      const out = await server.speech.createAttempt(authedCtx, body as never);
      return jsonResponse(mapStatus(out), out);
    }

    const speechScoreMatch = reqPath.match(
      /^\/api\/v1\/speech\/([^/]+)\/score$/,
    );
    if (method === "PATCH" && speechScoreMatch) {
      const out = await server.speech.updateScore(
        authedCtx,
        speechScoreMatch[1],
        body as never,
      );
      return jsonResponse(mapStatus(out), out);
    }

    return jsonResponse(404, {
      error: { code: "NOT_FOUND", message: "route not found" },
    });
  } catch {
    return jsonResponse(500, {
      error: { code: "INTERNAL_ERROR", message: "unexpected error" },
    });
  }
};
