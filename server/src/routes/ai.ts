/**
 * SSOT: docs/09_AI_WORD_GENERATION_PROMPT.md, docs/10_AI_SENTENCE_COACH_PROMPT.md
 */
import { fail, ok, type ApiError, type ApiSuccess } from "../../../src/api/contract";
import {
  validateSentenceCoachInput,
  type SentenceCoachInput,
  type WordGenerationInput,
} from "../../../src/ai/prompts";
import { generateWords, toLeajaItems } from "../ai-client";
import { getDb } from "../db";
import type { RequestContext } from "../context";

export function registerAiRoutes() {
  async function wordGeneration(
    ctx: RequestContext,
    input: WordGenerationInput,
  ): Promise<ApiSuccess<unknown> | ApiError> {
    if (input.daily_target < 3 || input.daily_target > 5) {
      return fail(ctx.requestId, "VALIDATION_ERROR", "daily_target must be between 3 and 5", [
        { field: "daily_target", reason: "out_of_range" },
      ]);
    }

    const db = getDb();

    // 유저 프로필에서 기본값 가져오기
    const { data: profile } = await db
      .from("user_profiles")
      .select("level, learning_focus")
      .eq("user_id", ctx.userId)
      .single();

    // 학습 이력에서 컨텍스트 수집
    const { data: knownRows } = await db
      .from("plan_items")
      .select("lemma")
      .eq("user_id", ctx.userId)
      .eq("recall_status", "success");

    const knownWords = [...new Set((knownRows ?? []).map((r: Record<string, unknown>) => r.lemma as string))];

    const { data: recentRows } = await db
      .from("plan_items")
      .select("lemma")
      .eq("user_id", ctx.userId)
      .order("created_at", { ascending: false })
      .limit(25);

    const recentWords = [...new Set((recentRows ?? []).map((r: Record<string, unknown>) => r.lemma as string))];

    const enrichedInput: WordGenerationInput = {
      ...input,
      level: input.level || (profile?.level as string) || "A2",
      learning_focus: input.learning_focus || (profile?.learning_focus as string) || "travel",
      known_words_hint: input.known_words_hint ?? knownWords,
      avoid_words: input.avoid_words ?? recentWords,
    };

    const result = await generateWords(enrichedInput);

    // AI 생성 결과를 learning_items에 저장
    if (result.source === "ai") {
      const newItems = toLeajaItems(result.items);
      const insertRows = newItems.map((item) => ({
        user_id: ctx.userId,
        item_type: item.itemType,
        lemma: item.lemma,
        meaning_ko: item.meaningKo,
        part_of_speech: item.partOfSpeech,
        example_en: item.exampleEn,
        example_ko: item.exampleKo,
        source: item.source,
        is_active: true,
      }));

      await db.from("learning_items").insert(insertRows);
    }

    return ok(ctx.requestId, {
      items: result.items,
      source: result.source,
      meta: result.meta,
    });
  }

  function sentenceCoach(
    ctx: RequestContext,
    input: SentenceCoachInput,
  ): ApiSuccess<unknown> | ApiError {
    const errors = validateSentenceCoachInput(input);
    if (errors.length > 0) {
      return fail(ctx.requestId, "VALIDATION_ERROR", errors.join(", "));
    }

    const sentence = input.sentence_en.trim();
    const lemma = input.item_context.lemma;

    // Simple coaching heuristic
    const usesLemma = sentence.toLowerCase().includes(lemma.toLowerCase());
    const hasArticle = /\b(a|an|the)\b/i.test(sentence);
    const wordCount = sentence.split(/\s+/).length;
    const endsWithPeriod = sentence.endsWith(".");

    const highlights: Array<{ type: string; message_ko: string }> = [];
    let score = 85;
    let overall: "good" | "needs_fix" | "retry" = "good";

    if (!usesLemma) {
      highlights.push({
        type: "vocabulary",
        message_ko: `학습 단어 "${lemma}"을(를) 문장에 포함해 보세요.`,
      });
      score -= 25;
      overall = "needs_fix";
    }

    if (wordCount < 3) {
      highlights.push({
        type: "length",
        message_ko: "조금 더 긴 문장을 만들어 보세요.",
      });
      score -= 15;
      overall = "needs_fix";
    }

    if (!endsWithPeriod) {
      highlights.push({
        type: "punctuation",
        message_ko: "문장 끝에 마침표를 추가해 보세요.",
      });
      score -= 5;
    }

    if (!hasArticle && wordCount > 3) {
      highlights.push({
        type: "grammar",
        message_ko: "필요한 곳에 관사(a/an/the)를 넣어보세요.",
      });
      score -= 10;
      if (overall === "good") overall = "needs_fix";
    }

    score = Math.max(0, Math.min(100, score));
    if (score < 50) overall = "retry";

    const feedbackKo =
      overall === "good"
        ? "좋아요! 자연스러운 문장이에요. 이제 소리 내어 말해보세요."
        : overall === "needs_fix"
          ? "좋아요. 의미는 잘 전달됐어요. 아래 포인트만 다듬으면 더 자연스러워요."
          : "핵심 단어를 넣어 한 문장만 다시 써볼까요?";

    const suggestions: string[] = [];
    if (overall !== "good" && usesLemma) {
      suggestions.push(`${sentence.replace(/\.$/, "")} (revised).`);
    }
    if (!usesLemma) {
      suggestions.push(`I used ${lemma} in my daily routine.`);
    }

    const nextActionKo =
      overall === "good"
        ? "이제 첫 문장을 소리 내어 한 번 말해보세요."
        : "한 번 더 직접 고쳐서 말해보세요.";

    return ok(ctx.requestId, {
      result: {
        overall,
        score,
        feedback_ko: feedbackKo,
        highlights: highlights.slice(0, 2),
        suggestions: suggestions.slice(0, 2),
        next_action_ko: nextActionKo,
      },
      meta: {
        prompt_version: "tw-scoach-v1",
        generated_at: new Date().toISOString(),
        safety: { contains_sensitive_content: false },
      },
    });
  }

  return { wordGeneration, sentenceCoach };
}
