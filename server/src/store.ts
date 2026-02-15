import type { DayPlan, PlanItem, ItemType } from "../../src/domain/day-plan";
import type { ReviewTask } from "../../src/domain/review";
import type { SpeechAttempt } from "../../src/domain/speech";
import type { StreakState } from "../../src/domain/streak";

export interface UserProfile {
  userId: string;
  dailyTarget: 3 | 4 | 5;
  level: string;
  learningFocus: string;
  reminderEnabled: boolean;
  speechRequiredForCompletion: boolean;
  updatedAt: string;
}

export interface LearningItem {
  itemId: string;
  itemType: ItemType;
  lemma: string;
  meaningKo: string;
  partOfSpeech: string;
  exampleEn: string;
  exampleKo: string;
  source: "ai_generated" | "user_added" | "edited";
  isActive: boolean;
  createdAt: string;
}

export interface SentenceAttempt {
  sentenceId: string;
  planItemId: string;
  sentenceEn: string;
  coachFeedback: string | null;
  createdAt: string;
}

export interface ActivityEvent {
  eventId: string;
  userId: string;
  eventName: string;
  entityType: string | null;
  entityId: string | null;
  payloadJson: Record<string, unknown> | null;
  occurredAt: string;
}

export interface InMemoryStore {
  profile: UserProfile;
  todayPlan: DayPlan | null;
  learningItems: LearningItem[];
  reviews: ReviewTask[];
  speechAttempts: SpeechAttempt[];
  sentenceAttempts: SentenceAttempt[];
  streak: StreakState;
  events: ActivityEvent[];
  completedPlans: DayPlan[];
  idempotency: Map<string, unknown>;
}

// ── Fallback word pool (AI 실패 시에만 사용) ──────────────────────

const FALLBACK_WORD_POOL: LearningItem[] = [
  {
    itemId: "fb-1",
    itemType: "vocab",
    lemma: "itinerary",
    meaningKo: "여행 일정표",
    partOfSpeech: "noun",
    exampleEn: "I shared my itinerary with my family.",
    exampleKo: "나는 가족에게 내 여행 일정을 공유했다.",
    source: "ai_generated",
    isActive: true,
    createdAt: new Date().toISOString(),
  },
  {
    itemId: "fb-2",
    itemType: "phrasal_verb",
    lemma: "check in",
    meaningKo: "체크인하다",
    partOfSpeech: "verb",
    exampleEn: "We need to check in two hours early.",
    exampleKo: "우리는 두 시간 일찍 체크인해야 한다.",
    source: "ai_generated",
    isActive: true,
    createdAt: new Date().toISOString(),
  },
  {
    itemId: "fb-3",
    itemType: "collocation",
    lemma: "make a reservation",
    meaningKo: "예약하다",
    partOfSpeech: "verb phrase",
    exampleEn: "Let's make a reservation for dinner.",
    exampleKo: "저녁 식사 예약을 하자.",
    source: "ai_generated",
    isActive: true,
    createdAt: new Date().toISOString(),
  },
  {
    itemId: "fb-4",
    itemType: "vocab",
    lemma: "commute",
    meaningKo: "통근하다",
    partOfSpeech: "verb",
    exampleEn: "I commute to work by subway every day.",
    exampleKo: "나는 매일 지하철로 통근한다.",
    source: "ai_generated",
    isActive: true,
    createdAt: new Date().toISOString(),
  },
  {
    itemId: "fb-5",
    itemType: "idiom",
    lemma: "break the ice",
    meaningKo: "분위기를 풀다",
    partOfSpeech: "idiom",
    exampleEn: "She told a joke to break the ice.",
    exampleKo: "그녀는 분위기를 풀기 위해 농담을 했다.",
    source: "ai_generated",
    isActive: true,
    createdAt: new Date().toISOString(),
  },
  {
    itemId: "fb-6",
    itemType: "vocab",
    lemma: "accommodate",
    meaningKo: "수용하다, 편의를 제공하다",
    partOfSpeech: "verb",
    exampleEn: "The hotel can accommodate up to 200 guests.",
    exampleKo: "그 호텔은 최대 200명의 손님을 수용할 수 있다.",
    source: "ai_generated",
    isActive: true,
    createdAt: new Date().toISOString(),
  },
  {
    itemId: "fb-7",
    itemType: "preposition",
    lemma: "in terms of",
    meaningKo: "~의 관점에서",
    partOfSpeech: "preposition",
    exampleEn: "In terms of cost, this option is the best.",
    exampleKo: "비용 관점에서 이 옵션이 최고다.",
    source: "ai_generated",
    isActive: true,
    createdAt: new Date().toISOString(),
  },
  {
    itemId: "fb-8",
    itemType: "vocab",
    lemma: "deadline",
    meaningKo: "마감 기한",
    partOfSpeech: "noun",
    exampleEn: "The deadline for the report is next Friday.",
    exampleKo: "보고서 마감 기한은 다음 주 금요일이다.",
    source: "ai_generated",
    isActive: true,
    createdAt: new Date().toISOString(),
  },
  {
    itemId: "fb-9",
    itemType: "phrasal_verb",
    lemma: "look forward to",
    meaningKo: "~을 기대하다",
    partOfSpeech: "verb",
    exampleEn: "I look forward to meeting you.",
    exampleKo: "만나 뵙기를 기대합니다.",
    source: "ai_generated",
    isActive: true,
    createdAt: new Date().toISOString(),
  },
  {
    itemId: "fb-10",
    itemType: "collocation",
    lemma: "take notes",
    meaningKo: "메모하다, 필기하다",
    partOfSpeech: "verb phrase",
    exampleEn: "Please take notes during the meeting.",
    exampleKo: "회의 중에 메모해 주세요.",
    source: "ai_generated",
    isActive: true,
    createdAt: new Date().toISOString(),
  },
];

function buildPlanItemFromLearning(item: LearningItem, orderNo: number): PlanItem {
  return {
    planItemId: `pi-${item.itemId}-${Date.now()}-${orderNo}`,
    itemId: item.itemId,
    itemType: item.itemType,
    lemma: item.lemma,
    meaningKo: item.meaningKo,
    partOfSpeech: item.partOfSpeech,
    exampleEn: item.exampleEn,
    exampleKo: item.exampleKo,
    recallStatus: "pending",
    sentenceStatus: "pending",
    speechStatus: "pending",
    isCompleted: false,
  };
}

export function pickWordsForPlan(
  pool: LearningItem[],
  count: number,
  usedItemIds: Set<string>,
): LearningItem[] {
  const available = pool.filter((w) => w.isActive && !usedItemIds.has(w.itemId));
  const shuffled = [...available].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, count);
}

export function buildDayPlan(
  planDate: string,
  dailyTarget: 3 | 4 | 5,
  words: LearningItem[],
): DayPlan {
  return {
    planId: `plan-${planDate}`,
    planDate,
    dailyTarget,
    status: "open",
    completedAt: null,
    items: words.map((w, i) => buildPlanItemFromLearning(w, i + 1)),
  };
}

// ── 학습 이력 수집 헬퍼 ─────────────────────────────────────────

/**
 * 완료된 플랜들에서 사용자가 학습한 모든 lemma를 수집한다.
 * recall 성공한 단어 → known_words_hint로 AI에 전달
 */
export function collectKnownWords(store: InMemoryStore): string[] {
  const known = new Set<string>();
  for (const plan of store.completedPlans) {
    for (const item of plan.items) {
      if (item.recallStatus === "success") {
        known.add(item.lemma);
      }
    }
  }
  // 오늘 학습 중인 단어 중 recall 성공한 것도 포함
  if (store.todayPlan) {
    for (const item of store.todayPlan.items) {
      if (item.recallStatus === "success") {
        known.add(item.lemma);
      }
    }
  }
  return [...known];
}

/**
 * 최근 학습에 사용된 모든 lemma를 수집한다.
 * 중복 방지용 avoid_words로 AI에 전달
 */
export function collectRecentWords(store: InMemoryStore, maxPlans = 5): string[] {
  const recent = new Set<string>();
  // 최근 완료된 플랜 (최대 maxPlans개)
  const recentPlans = store.completedPlans.slice(-maxPlans);
  for (const plan of recentPlans) {
    for (const item of plan.items) {
      recent.add(item.lemma);
    }
  }
  // 오늘 학습 중인 단어
  if (store.todayPlan) {
    for (const item of store.todayPlan.items) {
      recent.add(item.lemma);
    }
  }
  return [...recent];
}

export function createStore(today: string): InMemoryStore {
  const defaultWords = FALLBACK_WORD_POOL.slice(0, 3);
  const todayPlan = buildDayPlan(today, 3, defaultWords);

  return {
    profile: {
      userId: "user-1",
      dailyTarget: 3,
      level: "A2",
      learningFocus: "travel",
      reminderEnabled: true,
      speechRequiredForCompletion: false,
      updatedAt: new Date().toISOString(),
    },
    learningItems: [...FALLBACK_WORD_POOL],
    todayPlan,
    reviews: [],
    speechAttempts: [],
    sentenceAttempts: [],
    streak: {
      currentStreak: 0,
      longestStreak: 0,
      lastCompletedDate: null,
    },
    events: [],
    completedPlans: [],
    idempotency: new Map<string, unknown>(),
  };
}

export function getWordPool(): LearningItem[] {
  return FALLBACK_WORD_POOL;
}
