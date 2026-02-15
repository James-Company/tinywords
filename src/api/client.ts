import type { ApiSuccess } from "./contract";
import type { DayPlan } from "../domain/day-plan";

/**
 * 실제 HTTP 구현 전 인터페이스 레벨 스켈레톤.
 */
export interface TinyWordsApiClient {
  getTodayDayPlan(createIfMissing: boolean): Promise<ApiSuccess<DayPlan>>;
}
