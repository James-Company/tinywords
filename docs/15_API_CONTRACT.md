# 15 API CONTRACT

이 문서는 TinyWords MVP의 API 계약(요청/응답/오류/멱등성) SSOT이다.  
클라이언트와 서버, AI 연동 계층이 동일한 규약으로 동작하도록 최소/필수 계약을 정의한다.

---

## 1) 공통 규약

### 1.1 Base

- Base URL (예시): `/api/v1`
- Content-Type: `application/json`
- 시간 표기: ISO-8601 UTC (`2026-02-15T09:00:00Z`)
- 날짜 표기: 로컬 날짜 문자열 (`YYYY-MM-DD`)

### 1.2 인증

- MVP 기본: `Authorization: Bearer <token>`
- 로컬 전용 모드에서는 인증 없이 동작 가능(개발/단일 사용자)

### 1.3 공통 헤더

- `X-Request-Id`: 클라이언트 요청 식별자(UUID, 멱등/추적용)
- `X-App-Version`: 앱 버전
- `X-Client-Timezone`: 예 `Asia/Seoul`

멱등성 기준:
- 멱등 키의 정답은 `X-Request-Id` 헤더다.
- 요청 바디의 `request_id`는 선택적 추적 필드이며, 멱등 판정 기준으로 사용하지 않는다.

### 1.4 공통 응답 envelope

성공:

```json
{
  "data": {},
  "meta": {
    "request_id": "uuid",
    "timestamp": "2026-02-15T09:00:00Z"
  }
}
```

실패:

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "daily_target must be between 3 and 5",
    "details": [
      {"field": "daily_target", "reason": "out_of_range"}
    ]
  },
  "meta": {
    "request_id": "uuid",
    "timestamp": "2026-02-15T09:00:00Z"
  }
}
```

---

## 2) 에러 코드 표준

- `VALIDATION_ERROR` (400)
- `UNAUTHORIZED` (401)
- `FORBIDDEN` (403)
- `NOT_FOUND` (404)
- `CONFLICT` (409)
- `RATE_LIMITED` (429)
- `AI_UPSTREAM_ERROR` (502)
- `INTERNAL_ERROR` (500)

도메인 특화:
- `DAYPLAN_ALREADY_EXISTS`
- `REVIEW_STAGE_DUPLICATED`
- `INVALID_SPEECH_REFERENCE`
- `GENERATION_CONSTRAINT_FAILED`
- `SCORING_UNAVAILABLE`

---

## 3) 사용자/설정 API

### 3.1 현재 사용자 프로필 조회

- `GET /users/me/profile`

응답 `data`:

```json
{
  "user_id": "uuid",
  "daily_target": 3,
  "level": "A2",
  "learning_focus": "travel",
  "reminder_enabled": true,
  "updated_at": "2026-02-15T09:00:00Z"
}
```

### 3.2 사용자 프로필 수정

- `PATCH /users/me/profile`

요청 `data`:

```json
{
  "daily_target": 4,
  "level": "A2",
  "learning_focus": "travel",
  "reminder_enabled": false
}
```

검증:
- `daily_target`는 3~5

---

## 4) DayPlan / Today API

### 4.1 오늘 DayPlan 조회 또는 생성

- `GET /day-plans/today?create_if_missing=true`

응답 `data`:

```json
{
  "plan_id": "uuid",
  "plan_date": "2026-02-15",
  "daily_target": 3,
  "status": "open",
  "items": [
    {
      "plan_item_id": "uuid",
      "item_id": "uuid",
      "order_no": 1,
      "item_type": "vocab",
      "lemma": "itinerary",
      "meaning_ko": "여행 일정표",
      "recall_status": "pending",
      "sentence_status": "pending",
      "speech_status": "pending",
      "is_completed": false
    }
  ]
}
```

### 4.2 PlanItem 단계 업데이트

- `PATCH /day-plans/{plan_id}/items/{plan_item_id}`

요청:

```json
{
  "recall_status": "success",
  "sentence_status": "done",
  "speech_status": "done"
}
```

응답:
- 업데이트된 PlanItem + `is_completed`

### 4.3 DayPlan 완료 처리

- `POST /day-plans/{plan_id}/complete`

동작:
- DayPlan 상태 `completed`
- 복습 정책에 따라 `ReviewTask` 생성
- 스트릭 업데이트 트리거

---

## 5) Review / Inbox API

### 5.1 복습 큐 조회

- `GET /reviews/queue?date=2026-02-15`

응답 `data`:

```json
{
  "summary": {
    "queued_total": 7,
    "overdue_count": 2,
    "due_today_count": 5
  },
  "tasks": [
    {
      "review_id": "uuid",
      "item_id": "uuid",
      "lemma": "check in",
      "meaning_ko": "체크인하다",
      "stage": "d1",
      "due_date": "2026-02-14",
      "status": "queued",
      "is_overdue": true
    }
  ]
}
```

정렬:
- overdue -> due today -> due_date asc -> stage order
- 위 정렬은 **서버 정렬이 정답**이며, 클라이언트는 표시 목적으로만 동일 순서를 재사용한다.

`missed` 상태 부여 규칙:
- `missed`는 submit API가 아니라 daily sweep 배치(예: 1일 1회)에서만 갱신한다.
- queue 조회 기본 응답은 `status=queued` 중심이며, 필요 시 `include_missed=true`로 조회한다.

### 5.2 복습 결과 제출

- `POST /reviews/{review_id}/submit`

요청:

```json
{
  "result": "success",
  "submitted_at": "2026-02-15T09:10:00Z"
}
```

`result` 허용값:
- `success`, `hard`, `fail`

응답:
- 현재 task 업데이트 + 다음 stage 생성 여부
- 응답 `meta`에 `policy_version` 포함(예: `v1`)

서버 동작(`policy_version=v1`):
- `success`: 현재 task `done`, 다음 stage task 생성
- `hard`: 현재 task `done`, 다음 stage task 생성 (`success`와 동일 처리)
- `fail`: 현재 task `queued` 유지 + `due_date=today+1` 재예약, 다음 stage 미생성(`next_task_created=false`)

---

## 6) History API

### 6.1 학습/복습 히스토리 조회

- `GET /history?from=2026-02-01&to=2026-02-15&type=all`

응답 `data`:

```json
{
  "streak": {
    "current_streak_days": 4,
    "best_streak_days": 9,
    "last_completed_date": "2026-02-15"
  },
  "days": [
    {
      "plan_date": "2026-02-15",
      "dayplan_status": "completed",
      "learning_done": 3,
      "learning_target": 3,
      "review_done": 4,
      "review_pending": 1
    }
  ]
}
```

---

## 7) AI 단어 생성 API

### 7.1 일일 학습 항목 생성

- `POST /ai/word-generation`

요청은 `09_AI_WORD_GENERATION_PROMPT.md` 입력 계약을 따른다.

응답은 해당 문서의 출력 계약을 따르며, 서버는 추가로 아래 검증 후 반환:
- 스키마 검증
- 중복 lemma 제거/실패 처리
- 금칙어/민감 주제 필터

실패 시:
- `AI_UPSTREAM_ERROR` 또는 `GENERATION_CONSTRAINT_FAILED`

---

## 8) AI 문장 코칭 API

### 8.1 문장 코칭 요청

- `POST /ai/sentence-coach`

요청/응답은 `10_AI_SENTENCE_COACH_PROMPT.md` 계약 준수.

추가 규칙:
- `sentence_en` 빈 값이면 400 + `VALIDATION_ERROR`
- `item_context.lemma` 누락 시 400

---

## 9) 발음 점수 API

### 9.1 발음 점수 산출

- `POST /speech/pronunciation-score`

요청/응답은 `14_PRONUNCIATION_SCORING_SPEC.md` 계약 준수.

추가 규칙:
- `speech_id`가 없거나 소유권 불일치면 404/403
- 실패해도 녹음 저장 상태는 유지되어야 함
- 요청 바디의 `request_id`가 있더라도 멱등성 판정은 `X-Request-Id`를 사용

### 9.2 점수 결과 저장

- `PATCH /speech/{speech_id}/score`

요청:

```json
{
  "pronunciation_score": 82,
  "scoring_version": "tw-pron-v1"
}
```

---

## 10) 오디오 메타 API

### 10.1 녹음 메타 등록

- `POST /speech-attempts`

요청:

```json
{
  "plan_item_id": "uuid",
  "audio_uri": "local://user/plan_item/speech.m4a",
  "duration_ms": 4200
}
```

응답:
- 생성된 `speech_id`

---

## 11) 멱등성/중복 방지

- `POST` 중 상태 변화를 발생시키는 API는 `X-Request-Id` 기반 멱등 처리
- 동일 `request_id` 재요청 시 기존 결과 재반환
- 적용 대상:
  - `POST /day-plans/{plan_id}/complete`
  - `POST /reviews/{review_id}/submit`
  - `POST /speech-attempts`
  - `POST /ai/*`

---

## 12) 페이지네이션/필터

- 리스트 API 기본:
  - `limit` (기본 20, 최대 100)
  - `cursor` (opaque string)
- 정렬 파라미터:
  - `sort_by`, `sort_order`

History 예:
- `GET /history?type=review&limit=30&cursor=...`

---

## 13) 버전 관리/호환성

- API 버전은 URL(`/v1`)로 구분
- 비호환 변경 시 `/v2` 추가, `/v1`는 deprecation 기간 유지
- AI/점수 버전은 응답 `meta`에 포함:
  - `prompt_version`
  - `scoring_version`

---

## 14) 보안 정책(요약)

- 민감 키는 서버 보관, 클라이언트 노출 금지
- 요청 본문/로그에 원문 오디오 직접 포함 금지(URI 참조 우선)
- rate limiting:
  - AI 코칭/점수 API에 사용자별 제한 적용
- 감사 로그:
  - 주요 상태 전이(완료, 리뷰 제출, 설정 변경) 기록

---

## 15) 관측성/모니터링

필수 메트릭:
- API 성공률/지연시간(P50/P95)
- AI upstream 실패율
- 멱등 키 충돌률
- `VALIDATION_ERROR` 상위 필드

필수 로그 필드:
- `request_id`, `user_id`, `endpoint`, `status_code`, `latency_ms`

---

## 16) 테스트 기준(요약)

1. 스키마 검증 실패 시 표준 에러 반환 검증
2. 멱등 키 중복 요청 재반환 검증
3. DayPlan 완료 시 ReviewTask/Streak 연계 검증
4. AI API 실패 fallback 경로 검증
5. 권한 없는 speech score 요청 차단 검증

상세 케이스는 `19_TEST_PLAN.md`에서 관리한다.

---

## 17) 관련 문서

- 데이터 모델: `04_DATA_MODEL.md`
- 단어 생성 프롬프트: `09_AI_WORD_GENERATION_PROMPT.md`
- 문장 코칭 프롬프트: `10_AI_SENTENCE_COACH_PROMPT.md`
- 복습 정책: `11_SPACED_REVIEW_POLICY.md`
- 스트릭 규칙: `12_STREAK_RULES.md`
- 오디오 녹음: `13_AUDIO_RECORDING_SPEC.md`
- 발음 점수: `14_PRONUNCIATION_SCORING_SPEC.md`
- 보안/개인정보: `16_SECURITY_PRIVACY_KEYS.md`
