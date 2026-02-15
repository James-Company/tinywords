/**
 * OpenAI 기반 단어 생성 클라이언트
 * SSOT: docs/09_AI_WORD_GENERATION_PROMPT.md
 *
 * - 실제 OpenAI API를 호출하여 학습 단어를 생성
 * - 응답 검증 실패 시 1회 재시도
 * - 최종 실패 시 fallback pool 사용
 */
import OpenAI from "openai";
import {
  buildWordGenSystemPrompt,
  buildWordGenUserPrompt,
  buildSentenceCoachSystemPrompt,
  buildSentenceCoachUserPrompt,
  validateWordGenOutput,
  type WordGenerationInput,
  type WordGenerationItem,
  type WordGenerationOutput,
  type SentenceCoachInput,
  type SentenceCoachOutput,
  type SentenceCoachResult,
  PROMPT_VERSION,
} from "../../src/ai/prompts";
import { pickFallbackWords } from "./fallback-words";

const MAX_RETRIES = 1;

let openaiClient: OpenAI | null = null;

function getClient(): OpenAI | null {
  if (openaiClient) return openaiClient;
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey || apiKey.startsWith("sk-your-")) {
    return null;
  }
  openaiClient = new OpenAI({ apiKey });
  return openaiClient;
}

/**
 * OpenAI Chat Completion 호출 → WordGenerationOutput 파싱
 */
async function callOpenAI(input: WordGenerationInput): Promise<WordGenerationOutput> {
  const client = getClient();
  if (!client) {
    throw new Error("OPENAI_API_KEY is not configured");
  }

  const response = await client.chat.completions.create({
    model: "gpt-4o",
    temperature: 0.8,
    max_tokens: 1500,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: buildWordGenSystemPrompt() },
      { role: "user", content: buildWordGenUserPrompt(input) },
    ],
  });

  const content = response.choices[0]?.message?.content;
  if (!content) {
    throw new Error("Empty response from OpenAI");
  }

  return JSON.parse(content) as WordGenerationOutput;
}

/**
 * 폴백: WORD_POOL에서 랜덤 선택 (AI 실패 시)
 */
function fallbackFromPool(
  dailyTarget: number,
  avoidWords: string[],
): WordGenerationItem[] {
  const selected = pickFallbackWords(dailyTarget, avoidWords);

  return selected.map((w) => ({
    item_type: w.item_type,
    lemma: w.lemma,
    meaning_ko: w.meaning_ko,
    part_of_speech: w.part_of_speech,
    example_en: w.example_en,
    example_ko: w.example_ko,
    difficulty: "A2",
    tags: ["general"],
  }));
}

export interface GenerateWordsResult {
  items: WordGenerationItem[];
  source: "ai" | "fallback";
  meta: WordGenerationOutput["meta"];
}

/**
 * 단어 생성 메인 함수
 *
 * 1. OpenAI 호출 → 검증
 * 2. 검증 실패 시 1회 재시도
 * 3. 최종 실패 시 fallback pool
 */
export async function generateWords(input: WordGenerationInput): Promise<GenerateWordsResult> {
  const avoidWords = input.avoid_words ?? [];

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const output = await callOpenAI(input);
      const errors = validateWordGenOutput(output, input.daily_target, avoidWords);

      if (errors.length === 0) {
        return {
          items: output.items,
          source: "ai",
          meta: output.meta,
        };
      }

      console.warn(
        `[ai-client] Validation failed (attempt ${attempt + 1}/${MAX_RETRIES + 1}):`,
        errors,
      );
    } catch (err) {
      console.warn(
        `[ai-client] OpenAI call failed (attempt ${attempt + 1}/${MAX_RETRIES + 1}):`,
        err instanceof Error ? err.message : err,
      );
    }
  }

  // Fallback
  console.warn("[ai-client] All attempts failed, using fallback word pool");
  const fallbackItems = fallbackFromPool(input.daily_target, avoidWords);

  return {
    items: fallbackItems,
    source: "fallback",
    meta: {
      prompt_version: PROMPT_VERSION,
      generated_at: new Date().toISOString(),
      safety: { contains_sensitive_content: false },
      error_code: "AI_FALLBACK",
      reason: "AI generation failed, using local word pool",
    },
  };
}

/**
 * AI 생성 결과를 LearningItem 형태로 변환
 */
export interface LearningItemData {
  itemType: string;
  lemma: string;
  meaningKo: string;
  partOfSpeech: string;
  exampleEn: string;
  exampleKo: string;
  source: "ai_generated" | "user_added" | "edited";
  isActive: boolean;
}

export function toLeajaItems(items: WordGenerationItem[]): LearningItemData[] {
  return items.map((item) => ({
    itemType: item.item_type,
    lemma: item.lemma,
    meaningKo: item.meaning_ko,
    partOfSpeech: item.part_of_speech,
    exampleEn: item.example_en,
    exampleKo: item.example_ko,
    source: "ai_generated" as const,
    isActive: true,
  }));
}

// ── Sentence Coach AI ─────────────────────────────────────────

const SENTENCE_COACH_FALLBACK: SentenceCoachResult = {
  overall: "needs_fix",
  score: 60,
  feedback_ko: "좋아요. 핵심 단어를 넣어 한 문장만 다시 써볼까요?",
  highlights: [],
  suggestions: [],
  next_action_ko: "한 번 더 직접 고쳐서 말해보세요.",
};

/**
 * OpenAI로 문장 코칭 — SSOT: docs/10_AI_SENTENCE_COACH_PROMPT.md
 * 실패 시 null 반환 (호출자가 fallback 처리)
 */
export async function coachSentence(
  input: SentenceCoachInput,
): Promise<SentenceCoachResult | null> {
  const client = getClient();
  if (!client) {
    console.warn("[ai-client] OpenAI not configured, skipping sentence coach AI");
    return null;
  }

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const response = await client.chat.completions.create({
        model: "gpt-4o-mini",
        temperature: 0.6,
        max_tokens: 800,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: buildSentenceCoachSystemPrompt() },
          { role: "user", content: buildSentenceCoachUserPrompt(input) },
        ],
      });

      const content = response.choices[0]?.message?.content;
      if (!content) {
        throw new Error("Empty response from OpenAI");
      }

      const parsed = JSON.parse(content) as SentenceCoachOutput;
      const result = parsed.result;

      // 기본 검증
      if (!result || !result.overall || typeof result.score !== "number") {
        throw new Error("Invalid coaching response schema");
      }

      // score 범위 클램프
      result.score = Math.max(0, Math.min(100, result.score));

      // suggestions 최대 2개
      if (result.suggestions?.length > 2) {
        result.suggestions = result.suggestions.slice(0, 2);
      }

      return result;
    } catch (err) {
      console.warn(
        `[ai-client] Sentence coach AI failed (attempt ${attempt + 1}/${MAX_RETRIES + 1}):`,
        err instanceof Error ? err.message : err,
      );
    }
  }

  return null; // 모든 시도 실패
}
