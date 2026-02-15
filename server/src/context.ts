/**
 * TinyWords – 요청 컨텍스트 공통 인터페이스
 */
export interface RequestContext {
  requestId: string;
  nowIso: string;
  today: string;
  userId: string;
  userEmail?: string;
}
