/**
 * SSOT: docs/18_PLATFORM_PACKAGING.md
 */
export type SupportedPlatform = "ios" | "ipados" | "android" | "macos";

export interface BuildTarget {
  platform: SupportedPlatform;
  channel: "dev" | "staging" | "prod";
}
