# 09 AI WORD GENERATION PROMPT

이 문서는 TinyWords의 "학습 항목 생성" AI 프롬프트 SSOT이다.  
목표는 사용자의 설정에 맞는 오늘 학습 항목(기본 3개, 최대 5개)을 품질 일관성 있게 생성하는 것이다.

---

## 1) 목적

- 사용자의 레벨/포커스에 맞는 학습 항목 생성
- 회상 중심 학습에 적합한 난이도와 명확한 의미 제공
- 앱 데이터 모델(`LearningItem`)에 바로 적재 가능한 구조화 JSON 반환

---

## 2) 운영 원칙

- 기본 생성은 하루 1회로 제한한다.
- 재생성은 사용자의 명시적 행동(교체/설정 변경)에서만 허용한다.
- AI 결과는 "제안"이며, 사용자가 편집/교체 가능해야 한다.
- 모델 출력은 반드시 JSON 스키마를 만족해야 하며 서버/클라이언트에서 검증한다.

---

## 3) 입력 계약(Input Contract)

요청 입력(JSON):

```json
{
  "request_id": "uuid",
  "app_version": "1.0.0",
  "locale": "ko-KR",
  "daily_target": 3,
  "user_profile": {
    "level": "A2",
    "learning_focus": "travel",
    "known_words_hint": ["airport", "ticket"],
    "avoid_words": ["hello", "thanks"]
  },
  "generation_context": {
    "date": "2026-02-15",
    "regenerate": false,
    "reason": "daily_plan"
  }
}
```

필수 규칙:
- `daily_target`는 3~5
- `known_words_hint`, `avoid_words`는 중복 제거 후 전달
- `regenerate=false`가 기본

---

## 4) 출력 계약(Output Contract)

AI는 아래 스키마를 만족하는 JSON만 반환한다.

```json
{
  "items": [
    {
      "item_type": "vocab",
      "lemma": "itinerary",
      "meaning_ko": "여행 일정표",
      "part_of_speech": "noun",
      "example_en": "I shared my itinerary with my family.",
      "example_ko": "나는 가족에게 내 여행 일정을 공유했다.",
      "difficulty": "A2",
      "tags": ["travel", "planning"]
    }
  ],
  "meta": {
    "prompt_version": "tw-wordgen-v1",
    "generated_at": "2026-02-15T09:00:00Z",
    "safety": {
      "contains_sensitive_content": false
    }
  }
}
```

제약:
- `items.length == daily_target`
- `item_type` 허용값: `vocab`, `preposition`, `idiom`, `phrasal_verb`, `collocation`
- `lemma`, `meaning_ko`, `example_en`은 빈 문자열 금지
- 같은 응답 내 `lemma` 중복 금지
- `example_en`은 자연스러운 단문(권장 6~16 단어)

---

## 5) 시스템 프롬프트(System Prompt)

```text
You are TinyWords Word Generator.
Your job is to generate daily English learning items for Korean learners.

Hard requirements:
1) Output must be valid JSON only. No markdown, no prose.
2) Follow the provided output schema exactly.
3) Generate exactly {daily_target} items.
4) Respect item_type enum:
   vocab | preposition | idiom | phrasal_verb | collocation
5) Avoid duplicates and avoid words listed in avoid_words.
6) Keep meanings concise, practical, and beginner-friendly for the given level.
7) Provide one natural English example sentence per item.
8) Do not include unsafe, hateful, sexual, violent, or personally identifying content.
9) If constraints cannot be satisfied, return:
   {"items":[],"meta":{"error_code":"GENERATION_CONSTRAINT_FAILED","reason":"..."}}
```

---

## 6) 사용자 프롬프트 템플릿(User Prompt Template)

```text
Generate daily learning items for TinyWords.

Input:
- level: {level}
- learning_focus: {learning_focus}
- daily_target: {daily_target}
- locale: {locale}
- known_words_hint: {known_words_hint}
- avoid_words: {avoid_words}
- regenerate: {regenerate}
- reason: {reason}

Quality goals:
- Useful in daily real-life contexts
- Easy to recall and use in one sentence
- Balanced difficulty for the user level

Return JSON only.
```

---

## 7) 품질 규칙(Quality Guardrails)

- 과도하게 학술적/희귀 표현 금지
- 초급 레벨에 다의어·추상어 과다 배치 금지
- 정치/종교/혐오/성인/의학 민감 주제 우선 회피
- 같은 품사/유형 편중 완화(가능한 범위에서 다양성 유지)
- 한국어 의미는 사전식 장문보다 실사용 중심으로 간결하게 작성

---

## 8) 후처리/검증 규칙(Post Validation)

응답 수신 후 아래 검증을 통과해야 채택한다.

1. JSON 파싱 성공
2. 스키마 검증 성공
3. `items.length == daily_target`
4. `lemma` 중복 없음
5. `avoid_words` 포함 없음(대소문자 무시)
6. 금칙 토픽/금칙어 검사 통과

실패 시 처리:
- 1차: 동일 프롬프트로 재시도(최대 1회)
- 2차: 보수적 fallback 항목 세트 사용 + 사용자에게 재시도 CTA 제공

---

## 9) 버전 관리

- 프롬프트 버전 키: `tw-wordgen-v1`
- 변경 시:
  - `meta.prompt_version` 업데이트
  - `19_TEST_PLAN.md`의 AI 케이스 갱신
  - 릴리즈 노트에 품질 영향 범위 기록

---

## 10) 실패/예외 응답 규약

생성 불가 시 AI는 아래 형태를 반환한다.

```json
{
  "items": [],
  "meta": {
    "prompt_version": "tw-wordgen-v1",
    "error_code": "GENERATION_CONSTRAINT_FAILED",
    "reason": "avoid_words too restrictive"
  }
}
```

앱 처리 원칙:
- 빈 배열 수신 시 기존 로컬 항목 우선 노출
- 사용자에게 "다시 생성" 버튼 제공

---

## 11) 예시 출력(Sample)

```json
{
  "items": [
    {
      "item_type": "vocab",
      "lemma": "itinerary",
      "meaning_ko": "여행 일정표",
      "part_of_speech": "noun",
      "example_en": "I shared my itinerary with my family.",
      "example_ko": "나는 가족에게 내 여행 일정을 공유했다.",
      "difficulty": "A2",
      "tags": ["travel", "planning"]
    },
    {
      "item_type": "phrasal_verb",
      "lemma": "check in",
      "meaning_ko": "체크인하다",
      "part_of_speech": "verb",
      "example_en": "We need to check in two hours early.",
      "example_ko": "우리는 두 시간 일찍 체크인해야 한다.",
      "difficulty": "A2",
      "tags": ["travel", "airport"]
    },
    {
      "item_type": "collocation",
      "lemma": "make a reservation",
      "meaning_ko": "예약하다",
      "part_of_speech": "verb phrase",
      "example_en": "Let's make a reservation for dinner.",
      "example_ko": "저녁 식사 예약을 하자.",
      "difficulty": "A2",
      "tags": ["travel", "restaurant"]
    }
  ],
  "meta": {
    "prompt_version": "tw-wordgen-v1",
    "generated_at": "2026-02-15T09:00:00Z",
    "safety": {
      "contains_sensitive_content": false
    }
  }
}
```

---

## 12) 관련 문서

- 문장 코칭 프롬프트: `10_AI_SENTENCE_COACH_PROMPT.md`
- 복습 정책: `11_SPACED_REVIEW_POLICY.md`
- 데이터 모델: `04_DATA_MODEL.md`
- API 계약: `15_API_CONTRACT.md`
- 보안/키 관리: `16_SECURITY_PRIVACY_KEYS.md`
