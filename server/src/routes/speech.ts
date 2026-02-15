/**
 * SSOT: docs/13_AUDIO_RECORDING_SPEC.md, docs/14_PRONUNCIATION_SCORING_SPEC.md
 */
import { fail, ok, type ApiError, type ApiSuccess } from "../../../src/api/contract";
import { getDb } from "../db";
import type { RequestContext } from "../context";

export function registerSpeechRoutes() {
  async function createAttempt(
    ctx: RequestContext,
    input: { plan_item_id: string; audio_uri: string; duration_ms: number },
  ): Promise<ApiSuccess<unknown> | ApiError> {
    if (!input.audio_uri) {
      return fail(ctx.requestId, "VALIDATION_ERROR", "audio_uri is required", [
        { field: "audio_uri", reason: "required" },
      ]);
    }

    const db = getDb();

    const { data, error } = await db
      .from("speech_attempts")
      .insert({
        user_id: ctx.userId,
        plan_item_id: input.plan_item_id,
        audio_uri: input.audio_uri,
        duration_ms: input.duration_ms,
      })
      .select("id")
      .single();

    if (error || !data) {
      return fail(ctx.requestId, "INTERNAL_ERROR", "failed to create speech attempt");
    }

    return ok(ctx.requestId, { speech_id: data.id });
  }

  async function updateScore(
    ctx: RequestContext,
    speechId: string,
    input: { pronunciation_score: number; scoring_version: string },
  ): Promise<ApiSuccess<unknown> | ApiError> {
    if (input.pronunciation_score < 0 || input.pronunciation_score > 100) {
      return fail(ctx.requestId, "VALIDATION_ERROR", "pronunciation_score must be 0..100", [
        { field: "pronunciation_score", reason: "out_of_range" },
      ]);
    }

    const db = getDb();

    const { data, error } = await db
      .from("speech_attempts")
      .update({
        pronunciation_score: input.pronunciation_score,
        scoring_version: input.scoring_version,
      })
      .eq("id", speechId)
      .eq("user_id", ctx.userId)
      .select("*")
      .single();

    if (error || !data) {
      return fail(ctx.requestId, "NOT_FOUND", "speech not found");
    }

    return ok(ctx.requestId, {
      speechId: data.id,
      planItemId: data.plan_item_id,
      audioUri: data.audio_uri,
      durationMs: data.duration_ms,
      pronunciationScore: data.pronunciation_score,
      scoringVersion: data.scoring_version,
      createdAt: data.created_at,
    });
  }

  return { createAttempt, updateScore };
}
