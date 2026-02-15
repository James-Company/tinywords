/**
 * SSOT: docs/08_SCREEN_SPEC_SETTINGS.md, docs/21_I18N_LOCALIZATION.md
 */
export const SETTINGS_SCREEN_ID = "settings";

export type DailyTarget = 3 | 4 | 5;
export type SettingsScreenState = "loading" | "ready" | "saving" | "error";

/** Supported locale identifiers (BCP-47). */
export type SupportedLocale = "ko-KR" | "en-US";
export const SUPPORTED_LOCALES: readonly SupportedLocale[] = ["ko-KR", "en-US"] as const;
export const DEFAULT_LOCALE: SupportedLocale = "ko-KR";

export const LOCALE_OPTIONS = [
  { value: "ko-KR" as SupportedLocale, label: "한국어" },
  { value: "en-US" as SupportedLocale, label: "English" },
] as const;

export interface SettingsState {
  dailyTarget: DailyTarget;
  level: string;
  learningFocus: string;
  reminderEnabled: boolean;
  speechRequiredForCompletion: boolean;
  locale: SupportedLocale;
}

export function validateDailyTarget(value: number): value is DailyTarget {
  return value === 3 || value === 4 || value === 5;
}

export function getApplyTimingMessage(field: string): string {
  switch (field) {
    case "daily_target":
      return "다음 학습부터 이 설정이 적용돼요.";
    case "reminder_enabled":
      return "알림 설정이 변경되었어요.";
    case "speech_required_for_completion":
      return "다음 학습 항목부터 적용돼요.";
    case "level":
    case "learning_focus":
      return "다음 학습부터 이 설정이 적용돼요.";
    default:
      return "설정이 저장되었어요.";
  }
}

export const LEVEL_OPTIONS = [
  { value: "A1", label: "A1 (입문)" },
  { value: "A2", label: "A2 (초급)" },
  { value: "B1", label: "B1 (중급)" },
  { value: "B2", label: "B2 (중상)" },
] as const;

export const FOCUS_OPTIONS = [
  { value: "travel", label: "여행" },
  { value: "business", label: "업무" },
  { value: "exam", label: "시험" },
  { value: "general", label: "일반" },
] as const;
