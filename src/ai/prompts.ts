/**
 * SSOT: docs/09_AI_WORD_GENERATION_PROMPT.md, docs/10_AI_SENTENCE_COACH_PROMPT.md
 */
export const PROMPT_VERSION = "tw-wordgen-v1";

export type PromptType = "word_generation" | "sentence_coach";

// ── Word Generation ─────────────────────────────────────────────

export interface WordGenerationInput {
  daily_target: 3 | 4 | 5;
  level: string;
  learning_focus: string;
  known_words_hint?: string[];
  avoid_words?: string[];
  regenerate?: boolean;
  reason?: string;
}

export interface WordGenerationItem {
  item_type: "vocab" | "preposition" | "idiom" | "phrasal_verb" | "collocation";
  lemma: string;
  meaning_ko: string;
  part_of_speech: string;
  example_en: string;
  example_ko: string;
  difficulty: string;
  tags: string[];
}

export interface WordGenerationOutput {
  items: WordGenerationItem[];
  meta: {
    prompt_version: string;
    generated_at: string;
    safety: { contains_sensitive_content: boolean };
    error_code?: string;
    reason?: string;
  };
}

/**
 * 시스템 프롬프트 — SSOT: docs/09 §5
 */
export function buildWordGenSystemPrompt(): string {
  return `You are TinyWords Word Generator.
Your job is to generate daily English learning items for Korean learners.

Hard requirements:
1) Output must be valid JSON only. No markdown, no prose, no code fences.
2) Follow the provided output schema exactly.
3) Generate exactly {daily_target} items.
4) Respect item_type enum:
   vocab | preposition | idiom | phrasal_verb | collocation
5) Avoid duplicates and avoid words listed in avoid_words.
6) Keep meanings concise, practical, and beginner-friendly for the given level.
7) Provide one natural English example sentence per item (6-16 words).
8) Do not include unsafe, hateful, sexual, violent, or personally identifying content.
9) If constraints cannot be satisfied, return:
   {"items":[],"meta":{"error_code":"GENERATION_CONSTRAINT_FAILED","reason":"..."}}

Quality goals for word selection:
- Words MUST be thematically related to each other and to the learning_focus.
- Words should build on previously learned vocabulary (known_words_hint) to reinforce connections.
- Prioritize practical, high-frequency words that appear in real-life contexts.
- Balance item_type diversity (mix vocab, phrasal verbs, collocations, etc.).
- Progress difficulty gradually from the user's current level.
- Korean meanings should be concise and practical (not dictionary-style long definitions).`;
}

/**
 * 사용자 프롬프트 — SSOT: docs/09 §6
 * 학습 이력 기반으로 연관 단어를 추천하도록 컨텍스트 전달
 */
export function buildWordGenUserPrompt(input: WordGenerationInput): string {
  const knownWords = input.known_words_hint?.length
    ? input.known_words_hint.join(", ")
    : "(none yet)";

  const avoidWords = input.avoid_words?.length
    ? input.avoid_words.join(", ")
    : "(none)";

  return `Generate daily learning items for TinyWords.

Input:
- level: ${input.level}
- learning_focus: ${input.learning_focus}
- daily_target: ${input.daily_target}
- locale: ko-KR
- known_words_hint: [${knownWords}]
- avoid_words: [${avoidWords}]
- regenerate: ${input.regenerate ?? false}
- reason: ${input.reason ?? "daily_plan"}

The user already knows these words, so pick NEW words that are semantically related
to their existing vocabulary. For example, if they know "airport" and "ticket",
suggest words like "boarding pass", "layover", or "terminal" — NOT random unrelated words.

The ${input.daily_target} words you generate should form a cohesive mini-theme
within "${input.learning_focus}" that helps the user expand their vocabulary
in a meaningful, connected way.

Return JSON only. Output schema:
{
  "items": [
    {
      "item_type": "vocab|preposition|idiom|phrasal_verb|collocation",
      "lemma": "word or phrase",
      "meaning_ko": "한국어 뜻",
      "part_of_speech": "noun|verb|adjective|...",
      "example_en": "Natural example sentence.",
      "example_ko": "한국어 예문.",
      "difficulty": "${input.level}",
      "tags": ["${input.learning_focus}", "..."]
    }
  ],
  "meta": {
    "prompt_version": "${PROMPT_VERSION}",
    "generated_at": "<ISO timestamp>",
    "safety": { "contains_sensitive_content": false }
  }
}`;
}

// ── Sentence Coach ──────────────────────────────────────────────

export interface SentenceCoachInput {
  sentence_en: string;
  item_context: {
    lemma: string;
    meaning_ko: string;
  };
}

export function validateSentenceCoachInput(input: SentenceCoachInput): string[] {
  const errors: string[] = [];
  if (!input.sentence_en.trim()) {
    errors.push("sentence_en is required");
  }
  if (!input.item_context.lemma.trim()) {
    errors.push("item_context.lemma is required");
  }
  return errors;
}

// ── Validation helpers ──────────────────────────────────────────

const VALID_ITEM_TYPES = new Set(["vocab", "preposition", "idiom", "phrasal_verb", "collocation"]);

/**
 * AI 응답 후처리 검증 — SSOT: docs/09 §8
 */
export function validateWordGenOutput(
  output: WordGenerationOutput,
  dailyTarget: number,
  avoidWords: string[],
): string[] {
  const errors: string[] = [];

  if (!output.items || !Array.isArray(output.items)) {
    errors.push("items must be an array");
    return errors;
  }

  // error response from AI
  if (output.meta?.error_code) {
    errors.push(`AI returned error: ${output.meta.error_code} — ${output.meta.reason}`);
    return errors;
  }

  if (output.items.length !== dailyTarget) {
    errors.push(`expected ${dailyTarget} items, got ${output.items.length}`);
  }

  const lemmas = new Set<string>();
  const avoidSet = new Set(avoidWords.map((w) => w.toLowerCase()));

  for (const item of output.items) {
    if (!item.lemma?.trim()) {
      errors.push("lemma is empty");
    }
    if (!item.meaning_ko?.trim()) {
      errors.push(`meaning_ko is empty for "${item.lemma}"`);
    }
    if (!item.example_en?.trim()) {
      errors.push(`example_en is empty for "${item.lemma}"`);
    }
    if (!VALID_ITEM_TYPES.has(item.item_type)) {
      errors.push(`invalid item_type "${item.item_type}" for "${item.lemma}"`);
    }

    const lowerLemma = item.lemma?.toLowerCase();
    if (lemmas.has(lowerLemma)) {
      errors.push(`duplicate lemma: "${item.lemma}"`);
    }
    lemmas.add(lowerLemma);

    if (avoidSet.has(lowerLemma)) {
      errors.push(`"${item.lemma}" is in avoid_words`);
    }
  }

  return errors;
}
