# 14 PRONUNCIATION SCORING SPEC

이 문서는 TinyWords의 발음 점수 산출/표시 규칙 SSOT이다.  
발음 점수는 사용자를 평가하는 등급이 아니라, 반복 발화를 유도하는 보조 피드백 지표로 사용한다.

---

## 1) 기능 목적

- 사용자가 발화 후 즉시 피드백을 받아 재시도 동기를 얻도록 한다.
- 문장 단위 발화 품질을 단순 점수 + 행동 제안으로 전달한다.
- 점수가 학습 루틴(회상-문장-발화)을 대체하지 않도록 설계한다.

---

## 2) 핵심 원칙

- 점수는 **보조 지표**이며, 학습 완료의 필수 유일 조건이 아니다.
- 점수는 문장 단위로 제공한다(단어/음소 단위 정밀 평가는 후속).
- 낮은 점수에도 비난형 문구를 금지하고 다음 행동을 제시한다.
- 점수 산출은 서버 호출 방식을 우선한다(키 보안).

---

## 3) 범위

### MVP 포함

- 문장 단위 점수(0~100)
- 간단한 품질 레벨(`good`, `ok`, `retry`)
- 핵심 피드백 1~2개(짧은 한국어)
- 재시도 유도 CTA

### MVP 제외(후속)

- 음소별 세부 발음 히트맵
- 억양/강세/리듬의 정밀 시각화
- 원어민 음성과 실시간 비교 파형

---

## 4) 입력/출력 계약

### 4.1 입력(Scoring Request)

```json
{
  "request_id": "uuid",
  "app_version": "1.0.0",
  "locale": "ko-KR",
  "plan_item_id": "uuid",
  "speech_id": "uuid",
  "text_reference": "I checked in at the hotel at 3 p.m.",
  "audio": {
    "audio_uri": "local://user/plan_item/speech.m4a",
    "duration_ms": 4200,
    "sample_rate": 44100,
    "format": "m4a"
  },
  "context": {
    "user_level": "A2",
    "attempt_index": 2
  }
}
```

필수 규칙:
- `text_reference` 빈 값 금지
- `duration_ms` 최소 500ms 권장(너무 짧으면 retry 판정 가능)
- 멱등 처리 기준은 API 헤더 `X-Request-Id`를 사용
- 바디 `request_id`는 추적용(옵션)으로 사용 가능

### 4.2 출력(Scoring Response)

```json
{
  "result": {
    "score": 82,
    "level": "ok",
    "dimensions": {
      "clarity": 84,
      "pace": 78,
      "stability": 83
    },
    "feedback_ko": "좋아요. 전반적으로 또렷해요. 문장 끝 발음을 조금 더 분명히 해보세요.",
    "next_action_ko": "같은 문장을 한 번 더 천천히 말해보세요."
  },
  "meta": {
    "scoring_version": "tw-pron-v1",
    "generated_at": "2026-02-15T09:30:00Z"
  }
}
```

제약:
- `score` 범위: 0~100
- `level` 허용값: `good`, `ok`, `retry`
- `dimensions` 값도 각각 0~100
- `feedback_ko`, `next_action_ko`는 짧고 실행 가능한 문장

---

## 5) 점수 모델(단순 버전, MVP)

MVP에서는 설명 가능한 가중 평균 모델을 사용한다.

### 5.1 차원 정의

- `clarity`: 발화 선명도/인식 가능성
- `pace`: 발화 속도 적정성
- `stability`: 발화의 끊김/흔들림 정도

### 5.2 계산식

```text
raw = clarity * 0.5 + pace * 0.2 + stability * 0.3
score = round(clamp(raw, 0, 100))
```

### 5.3 레벨 매핑

- `good`: 85~100
- `ok`: 60~84
- `retry`: 0~59

주의:
- 레벨 경계값은 모델/데이터 변화에 따라 조정 가능하며, 조정 시 `scoring_version`을 변경한다.

---

## 6) 품질/안전 가드레일

- 배경 소음/무음 구간이 과도하면 `retry` 우선
- 길이 과소(예: <500ms) 또는 과대(예: >20s) 시 품질 경고
- 공격적/모욕적 피드백 문구 금지
- 점수는 상대 비교가 아닌 개인 반복 학습 맥락으로 제시

---

## 7) UX 표시 규칙

- 기본 표기:
  - 점수 숫자
  - 레벨 배지(`good/ok/retry`)
  - 한 줄 피드백 + 다음 행동 CTA
- 표시 원칙:
  - 점수 단독 노출 금지(반드시 행동 제안 동반)
  - `retry`일 때도 격려형 카피 유지

예시 카피:
- `good`: "좋아요! 흐름이 자연스러워요."
- `ok`: "좋아요. 한 번 더 또렷하게 말해보면 더 좋아져요."
- `retry`: "괜찮아요. 천천히 다시 말해볼까요?"

---

## 8) 데이터 모델 매핑

`04_DATA_MODEL.md` `SpeechAttempt` 필드 사용:

- `pronunciation_score` <- `result.score`
- `scoring_version` <- `meta.scoring_version`
- `created_at` <- 녹음 저장 시각(점수 산출 시각은 별도 이벤트 로그 권장)

이벤트 로그 권장:
- `pron_score_requested`
- `pron_score_completed`
- `pron_score_failed`

---

## 9) 오류/예외 처리

### 9.1 스코어링 호출 실패

- 사용자 메시지: "점수를 불러오지 못했어요. 녹음은 저장됐어요."
- 처리:
  - `pronunciation_score = null` 유지
  - 재시도 버튼 제공

### 9.2 오디오 품질 불충분

- 기준: 무음/잡음/짧은 길이 등
- 결과:
  - `level=retry`, `score`는 보수적으로 낮게 산정 또는 null
  - "주변 소음을 줄이고 다시 시도해보세요." 안내

### 9.3 버전 불일치

- 클라이언트가 알 수 없는 `scoring_version` 수신 시:
  - 점수는 표시하되 세부 차원 시각화는 축소
  - 호환성 이벤트 기록

---

## 10) 성능 목표

- 점수 요청 후 응답 표시: 1.5초 이내(일반 네트워크)
- 실패 시 피드백 표기: 2초 이내
- UI 블로킹 금지(점수 수신 전에도 학습 플로우 진행 가능)

---

## 11) 보안/개인정보 원칙

- AI/스코어링 키는 클라이언트에 저장하지 않는다.
- 오디오 원본의 외부 전송은 명시적 정책/동의 범위 내에서만 수행한다.
- 로그에는 원문 오디오/문장 전체를 직접 저장하지 않거나 최소화한다.
- 디버그 로그 마스킹 기본 적용

---

## 12) 테스트 기준(요약)

필수 테스트:
1. 정상 입력에서 점수/레벨/피드백 반환 검증
2. 짧은/무음/노이즈 입력에서 `retry` 처리 검증
3. 실패 응답 시 UI fallback(점수 없음 + 재시도) 검증
4. `SpeechAttempt` 필드 저장(`pronunciation_score`, `scoring_version`) 검증
5. 버전 업 시 구버전/신버전 호환 표시 검증

상세 케이스는 `19_TEST_PLAN.md`에서 관리한다.

---

## 13) 수용 기준(DoD)

1. 녹음 1건에 대해 문장 단위 점수(0~100)를 일관되게 제공한다.
2. 점수와 함께 최소 1개의 실행 가능한 다음 행동 안내를 제공한다.
3. 점수 실패 시에도 학습 플로우가 중단되지 않는다.
4. 점수는 `SpeechAttempt`에 저장되고 버전 정보가 함께 기록된다.
5. UX 카피가 압박보다 반복 유도를 우선한다.

---

## 14) 관련 문서

- 오디오 녹음 스펙: `13_AUDIO_RECORDING_SPEC.md`
- 데이터 모델: `04_DATA_MODEL.md`
- 문장 코칭 프롬프트: `10_AI_SENTENCE_COACH_PROMPT.md`
- API 계약: `15_API_CONTRACT.md`
- 보안/개인정보: `16_SECURITY_PRIVACY_KEYS.md`
- 테스트 계획: `19_TEST_PLAN.md`
