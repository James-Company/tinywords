import { fail, ok, type ApiError, type ApiSuccess } from "../../../src/api/contract";
import type { SpeechAttempt } from "../../../src/domain/speech";

interface RequestContext {
  requestId: string;
  nowIso: string;
}

interface SpeechStore {
  attempts: SpeechAttempt[];
}

export function registerSpeechRoutes(store: SpeechStore) {
  function createAttempt(
    ctx: RequestContext,
    input: { plan_item_id: string; audio_uri: string; duration_ms: number },
  ): ApiSuccess<unknown> | ApiError {
    if (!input.audio_uri.startsWith("local://")) {
      return fail(ctx.requestId, "VALIDATION_ERROR", "audio_uri must be local:// path", [
        { field: "audio_uri", reason: "invalid_scheme" },
      ]);
    }

    const speechId = `speech-${store.attempts.length + 1}`;
    const attempt: SpeechAttempt = {
      speechId,
      planItemId: input.plan_item_id,
      audioUri: input.audio_uri,
      durationMs: input.duration_ms,
      pronunciationScore: null,
      scoringVersion: null,
      createdAt: ctx.nowIso,
    };
    store.attempts.push(attempt);
    return ok(ctx.requestId, { speech_id: speechId });
  }

  function updateScore(
    ctx: RequestContext,
    speechId: string,
    input: { pronunciation_score: number; scoring_version: string },
  ): ApiSuccess<unknown> | ApiError {
    const target = store.attempts.find((it) => it.speechId === speechId);
    if (!target) return fail(ctx.requestId, "NOT_FOUND", "speech not found");
    if (input.pronunciation_score < 0 || input.pronunciation_score > 100) {
      return fail(ctx.requestId, "VALIDATION_ERROR", "pronunciation_score must be 0..100", [
        { field: "pronunciation_score", reason: "out_of_range" },
      ]);
    }

    target.pronunciationScore = input.pronunciation_score;
    target.scoringVersion = input.scoring_version;
    return ok(ctx.requestId, target);
  }

  return { createAttempt, updateScore };
}
