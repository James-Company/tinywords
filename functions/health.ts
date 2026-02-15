/**
 * TinyWords – Health Check (Cloudflare Pages Function)
 * GET /health
 */
export const onRequest: PagesFunction = async () => {
  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
};
