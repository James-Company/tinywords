/**
 * SSOT: docs/13_AUDIO_RECORDING_SPEC.md, docs/14_PRONUNCIATION_SCORING_SPEC.md
 */
export type SpeechPermission = "granted" | "denied" | "restricted" | "unknown";

export interface SpeechAttempt {
  speechId: string;
  planItemId: string;
  audioUri: string;
  durationMs: number;
  pronunciationScore: number | null;
  scoringVersion: string | null;
  createdAt: string;
}
