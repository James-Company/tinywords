import { createServer as createHttpServer } from "node:http";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import nodePath from "node:path";
import { URL } from "node:url";
import { fileURLToPath } from "node:url";
import { createServer } from "./index";
import { verifyAuth, isAuthError } from "./auth";
import { startReminderScheduler } from "./routes/notifications";

type JsonObject = Record<string, unknown>;

function readBody(req: import("node:http").IncomingMessage): Promise<JsonObject> {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => {
      data += chunk;
    });
    req.on("end", () => {
      if (!data) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(data) as JsonObject);
      } catch (error) {
        reject(error);
      }
    });
    req.on("error", reject);
  });
}

function sendJson(res: import("node:http").ServerResponse, statusCode: number, payload: unknown) {
  res.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET, POST, PATCH, DELETE, OPTIONS",
    "access-control-allow-headers": "Content-Type, Authorization, X-Request-Id, X-App-Version, X-Client-Timezone",
  });
  res.end(JSON.stringify(payload));
}

async function sendStaticFile(
  res: import("node:http").ServerResponse,
  rootDir: string,
  requestPath: string,
) {
  const normalized = requestPath === "/" ? "/index.html" : requestPath;
  const filePath = nodePath.join(rootDir, normalized);
  const ext = nodePath.extname(filePath);
  const mimeType =
    ext === ".html"
      ? "text/html; charset=utf-8"
      : ext === ".css"
        ? "text/css; charset=utf-8"
        : ext === ".js"
          ? "text/javascript; charset=utf-8"
          : ext === ".json"
            ? "application/json; charset=utf-8"
            : ext === ".svg"
              ? "image/svg+xml"
              : "application/octet-stream";

  try {
    const content = await readFile(filePath);
    res.writeHead(200, { "content-type": mimeType });
    res.end(content);
  } catch {
    res.writeHead(404, { "content-type": "text/plain" });
    res.end("not found");
  }
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

export function startHttpServer(port = 8080) {
  const app = createServer();
  const currentFile = fileURLToPath(import.meta.url);
  const webRoot = nodePath.resolve(nodePath.dirname(currentFile), "../../web");
  const server = createHttpServer(async (req, res) => {
    try {
      if (!req.url || !req.method) {
        sendJson(res, 400, { error: "invalid request" });
        return;
      }

      // Handle CORS preflight
      if (req.method === "OPTIONS") {
        sendJson(res, 204, null);
        return;
      }

      const requestId = req.headers["x-request-id"]?.toString() || randomUUID();
      const clientTimezone = req.headers["x-client-timezone"]?.toString() || undefined;
      const ctx = app.createContext(requestId, undefined, clientTimezone);
      const url = new URL(req.url, "http://localhost");
      const reqPath = url.pathname;
      const method = req.method.toUpperCase();

      // Health check
      if (method === "GET" && reqPath === "/health") {
        sendJson(res, 200, app.health());
        return;
      }

      // Static file serving
      if (method === "GET" && (reqPath === "/" || reqPath === "/index.html")) {
        await sendStaticFile(res, webRoot, "/index.html");
        return;
      }
      if (method === "GET" && (reqPath === "/terms.html" || reqPath === "/privacy.html")) {
        await sendStaticFile(res, webRoot, reqPath);
        return;
      }
      if (method === "GET" && (reqPath === "/app.js" || reqPath === "/auth.js" || reqPath === "/styles.css" || reqPath === "/i18n.js" || reqPath === "/sw.js")) {
        await sendStaticFile(res, webRoot, reqPath);
        return;
      }

      // Dynamic config.js — Supabase + VAPID 설정을 환경변수에서 주입
      if (method === "GET" && reqPath === "/config.js") {
        const supabaseUrl = process.env.SUPABASE_URL ?? "";
        const supabaseAnonKey = process.env.SUPABASE_ANON_KEY ?? "";
        const vapidPublicKey = process.env.VAPID_PUBLIC_KEY ?? "";
        const js = `// Auto-generated from server environment\nexport const SUPABASE_URL = ${JSON.stringify(supabaseUrl)};\nexport const SUPABASE_ANON_KEY = ${JSON.stringify(supabaseAnonKey)};\nexport const VAPID_PUBLIC_KEY = ${JSON.stringify(vapidPublicKey)};\n`;
        res.writeHead(200, {
          "content-type": "text/javascript; charset=utf-8",
          "cache-control": "no-cache",
        });
        res.end(js);
        return;
      }

      // i18n locale JSON files
      const i18nMatch = reqPath.match(/^\/i18n\/([a-z]{2}-[A-Z]{2})\.json$/);
      if (method === "GET" && i18nMatch) {
        const localeRoot = nodePath.resolve(nodePath.dirname(currentFile), "../../src/i18n/locales");
        await sendStaticFile(res, localeRoot, `/${i18nMatch[1]}.json`);
        return;
      }

      // === API Routes (인증 필수) ===
      if (reqPath.startsWith("/api/v1/")) {
        const authResult = await verifyAuth(req.headers.authorization);
        if (isAuthError(authResult)) {
          sendJson(res, 401, {
            error: { code: authResult.code, message: authResult.message },
            meta: { request_id: requestId, timestamp: new Date().toISOString() },
          });
          return;
        }

        const authedCtx = {
          ...ctx,
          userId: authResult.userId,
          userEmail: authResult.userEmail,
        };

        // Auth initialize
        if (method === "POST" && reqPath === "/api/v1/auth/initialize") {
          const body = await readBody(req);
          const out = await app.users.initializeUser(authedCtx, {
            timezone: (body.timezone as string) || undefined,
          });
          sendJson(res, mapStatus(out), out);
          return;
        }

        // Onboarding complete
        if (method === "POST" && reqPath === "/api/v1/users/me/onboarding/complete") {
          const body = await readBody(req);
          const out = await app.users.completeOnboarding(authedCtx, body as never);
          sendJson(res, mapStatus(out), out);
          return;
        }

        // User profile
        if (method === "GET" && reqPath === "/api/v1/users/me/profile") {
          const out = await app.users.getProfile(authedCtx);
          sendJson(res, mapStatus(out), out);
          return;
        }
        if (method === "PATCH" && reqPath === "/api/v1/users/me/profile") {
          const body = await readBody(req);
          const out = await app.users.patchProfile(authedCtx, body);
          sendJson(res, mapStatus(out), out);
          return;
        }
        if (method === "POST" && reqPath === "/api/v1/users/me/reset") {
          const out = await app.users.resetData(authedCtx);
          sendJson(res, mapStatus(out), out);
          return;
        }
        if (method === "DELETE" && reqPath === "/api/v1/users/me") {
          const out = await app.users.deleteAccount(authedCtx);
          sendJson(res, mapStatus(out), out);
          return;
        }

        // DayPlan / Today
        if (method === "GET" && reqPath === "/api/v1/day-plans/today") {
          const createIfMissing = url.searchParams.get("create_if_missing") === "true";
          const out = await app.dayPlans.getTodayDayPlan(authedCtx, createIfMissing);
          sendJson(res, mapStatus(out), out);
          return;
        }

        const planItemMatch = reqPath.match(/^\/api\/v1\/day-plans\/([^/]+)\/items\/([^/]+)$/);
        if (method === "PATCH" && planItemMatch) {
          const body = await readBody(req);
          const out = await app.dayPlans.patchPlanItem(authedCtx, planItemMatch[1], planItemMatch[2], body);
          sendJson(res, mapStatus(out), out);
          return;
        }

        const planCompleteMatch = reqPath.match(/^\/api\/v1\/day-plans\/([^/]+)\/complete$/);
        if (method === "POST" && planCompleteMatch) {
          const out = await app.dayPlans.completePlan(authedCtx, planCompleteMatch[1]);
          sendJson(res, mapStatus(out), out);
          return;
        }

        // Reviews / Inbox
        if (method === "GET" && reqPath === "/api/v1/reviews/queue") {
          const out = await app.reviews.getQueue(authedCtx);
          sendJson(res, mapStatus(out), out);
          return;
        }

        const reviewSubmitMatch = reqPath.match(/^\/api\/v1\/reviews\/([^/]+)\/submit$/);
        if (method === "POST" && reviewSubmitMatch) {
          const body = await readBody(req);
          const out = await app.reviews.submit(
            authedCtx,
            reviewSubmitMatch[1],
            (body.result as "success" | "hard" | "fail") ?? "fail",
          );
          sendJson(res, mapStatus(out), out);
          return;
        }

        // History
        if (method === "GET" && reqPath === "/api/v1/history") {
          const type = url.searchParams.get("type") || "all";
          const out = await app.history.getHistory(authedCtx, type);
          sendJson(res, mapStatus(out), out);
          return;
        }

        // AI endpoints
        if (method === "POST" && reqPath === "/api/v1/ai/word-generation") {
          const body = await readBody(req);
          const out = await app.ai.wordGeneration(authedCtx, body as never);
          sendJson(res, mapStatus(out), out);
          return;
        }

        if (method === "POST" && reqPath === "/api/v1/ai/sentence-coach") {
          const body = await readBody(req);
          const out = await app.ai.sentenceCoach(authedCtx, body as never);
          sendJson(res, mapStatus(out), out);
          return;
        }

        // Speech
        if (method === "POST" && reqPath === "/api/v1/speech-attempts") {
          const body = await readBody(req);
          const out = await app.speech.createAttempt(authedCtx, body as never);
          sendJson(res, mapStatus(out), out);
          return;
        }

        const speechScoreMatch = reqPath.match(/^\/api\/v1\/speech\/([^/]+)\/score$/);
        if (method === "PATCH" && speechScoreMatch) {
          const body = await readBody(req);
          const out = await app.speech.updateScore(authedCtx, speechScoreMatch[1], body as never);
          sendJson(res, mapStatus(out), out);
          return;
        }

        // Notifications / Push
        if (method === "GET" && reqPath === "/api/v1/notifications/vapid-public-key") {
          const out = app.notifications.getVapidPublicKey(authedCtx);
          sendJson(res, 200, out);
          return;
        }
        if (method === "POST" && reqPath === "/api/v1/notifications/subscribe") {
          const body = await readBody(req);
          const out = await app.notifications.subscribe(authedCtx, body as never);
          sendJson(res, mapStatus(out), out);
          return;
        }
        if (method === "POST" && reqPath === "/api/v1/notifications/unsubscribe") {
          const body = await readBody(req);
          const out = await app.notifications.unsubscribe(authedCtx, body as never);
          sendJson(res, mapStatus(out), out);
          return;
        }

        sendJson(res, 404, { error: { code: "NOT_FOUND", message: "route not found" } });
        return;
      }

    } catch {
      sendJson(res, 500, { error: { code: "INTERNAL_ERROR", message: "unexpected error" } });
    }
  });

  server.listen(port, () => {
    process.stdout.write(`TinyWords API listening on http://localhost:${port}\n`);
    // 리마인더 스케줄러 시작 (매일 09:00 KST)
    startReminderScheduler();
  });
  return server;
}

if (process.argv[1]?.endsWith("/server/src/http.ts")) {
  const port = Number(process.env.PORT ?? 8080);
  startHttpServer(port);
}
