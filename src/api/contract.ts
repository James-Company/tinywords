/**
 * SSOT: docs/15_API_CONTRACT.md
 */
export interface ResponseMeta {
  request_id: string;
  timestamp: string;
}

export interface ApiSuccess<TData> {
  data: TData;
  meta: ResponseMeta;
}

export interface ApiError {
  error: {
    code: string;
    message: string;
    details?: Array<{ field: string; reason: string }>;
  };
  meta: ResponseMeta;
}

export function createMeta(requestId: string, timestamp = new Date().toISOString()): ResponseMeta {
  return { request_id: requestId, timestamp };
}

export function ok<TData>(requestId: string, data: TData): ApiSuccess<TData> {
  return { data, meta: createMeta(requestId) };
}

export function fail(
  requestId: string,
  code: string,
  message: string,
  details?: Array<{ field: string; reason: string }>,
): ApiError {
  return { error: { code, message, details }, meta: createMeta(requestId) };
}
