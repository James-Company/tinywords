/**
 * Cloudflare Pages Function 타입 선언
 * @cloudflare/workers-types 전체 설치 없이 필요한 타입만 정의한다.
 */

interface EventContext<Env = unknown> {
  request: Request;
  env: Env;
  params: Record<string, string | string[]>;
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
  next(input?: Request | string, init?: RequestInit): Promise<Response>;
}

type PagesFunction<Env = unknown> = (
  context: EventContext<Env>,
) => Response | Promise<Response>;
