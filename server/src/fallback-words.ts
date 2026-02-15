/**
 * TinyWords – 폴백 단어 풀
 * AI 생성 실패 시 기본 단어로 사용한다.
 */
import type { ItemType } from "../../src/domain/day-plan";

export interface FallbackWord {
  item_type: ItemType;
  lemma: string;
  meaning_ko: string;
  part_of_speech: string;
  example_en: string;
  example_ko: string;
}

export const FALLBACK_WORD_POOL: FallbackWord[] = [
  {
    item_type: "vocab",
    lemma: "itinerary",
    meaning_ko: "여행 일정표",
    part_of_speech: "noun",
    example_en: "I shared my itinerary with my family.",
    example_ko: "나는 가족에게 내 여행 일정을 공유했다.",
  },
  {
    item_type: "phrasal_verb",
    lemma: "check in",
    meaning_ko: "체크인하다",
    part_of_speech: "verb",
    example_en: "We need to check in two hours early.",
    example_ko: "우리는 두 시간 일찍 체크인해야 한다.",
  },
  {
    item_type: "collocation",
    lemma: "make a reservation",
    meaning_ko: "예약하다",
    part_of_speech: "verb phrase",
    example_en: "Let's make a reservation for dinner.",
    example_ko: "저녁 식사 예약을 하자.",
  },
  {
    item_type: "vocab",
    lemma: "commute",
    meaning_ko: "통근하다",
    part_of_speech: "verb",
    example_en: "I commute to work by subway every day.",
    example_ko: "나는 매일 지하철로 통근한다.",
  },
  {
    item_type: "idiom",
    lemma: "break the ice",
    meaning_ko: "분위기를 풀다",
    part_of_speech: "idiom",
    example_en: "She told a joke to break the ice.",
    example_ko: "그녀는 분위기를 풀기 위해 농담을 했다.",
  },
  {
    item_type: "vocab",
    lemma: "accommodate",
    meaning_ko: "수용하다, 편의를 제공하다",
    part_of_speech: "verb",
    example_en: "The hotel can accommodate up to 200 guests.",
    example_ko: "그 호텔은 최대 200명의 손님을 수용할 수 있다.",
  },
  {
    item_type: "preposition",
    lemma: "in terms of",
    meaning_ko: "~의 관점에서",
    part_of_speech: "preposition",
    example_en: "In terms of cost, this option is the best.",
    example_ko: "비용 관점에서 이 옵션이 최고다.",
  },
  {
    item_type: "vocab",
    lemma: "deadline",
    meaning_ko: "마감 기한",
    part_of_speech: "noun",
    example_en: "The deadline for the report is next Friday.",
    example_ko: "보고서 마감 기한은 다음 주 금요일이다.",
  },
  {
    item_type: "phrasal_verb",
    lemma: "look forward to",
    meaning_ko: "~을 기대하다",
    part_of_speech: "verb",
    example_en: "I look forward to meeting you.",
    example_ko: "만나 뵙기를 기대합니다.",
  },
  {
    item_type: "collocation",
    lemma: "take notes",
    meaning_ko: "메모하다, 필기하다",
    part_of_speech: "verb phrase",
    example_en: "Please take notes during the meeting.",
    example_ko: "회의 중에 메모해 주세요.",
  },
];

/**
 * 폴백 풀에서 랜덤 단어 선택
 */
export function pickFallbackWords(
  count: number,
  avoidLemmas: string[] = [],
): FallbackWord[] {
  const avoidSet = new Set(avoidLemmas.map((w) => w.toLowerCase()));
  const available = FALLBACK_WORD_POOL.filter(
    (w) => !avoidSet.has(w.lemma.toLowerCase()),
  );
  const shuffled = [...available].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, count);
}
