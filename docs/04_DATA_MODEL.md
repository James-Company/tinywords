# 04 DATA MODEL

이 문서는 TinyWords MVP의 데이터 모델(엔티티, 관계, 제약, 저장 원칙)을 정의한다.  
복습 주기와 스트릭 계산의 정답은 각각 `11_SPACED_REVIEW_POLICY.md`, `12_STREAK_RULES.md`이며, 본 문서는 그 계산이 동작하도록 필요한 데이터 구조를 명시한다.

---

## 1) 모델링 원칙

- **도메인 우선:** Day Plan, Learning Item, Review Queue를 중심으로 설계한다.
- **오프라인 우선:** 핵심 학습 데이터는 로컬 저장소에 우선 기록한다.
- **추적 가능성:** 스트릭/복습 계산에 필요한 이벤트를 재현 가능하게 남긴다.
- **불변 로그 + 가변 상태:** 활동 로그는 append-only, 화면용 상태는 최신 스냅샷을 유지한다.
- **개인정보 최소화:** 학습에 불필요한 민감정보는 저장하지 않는다.
- **시간 저장 일관성:** `datetime` 필드(`created_at`, `updated_at`, `completed_at`, `occurred_at`)는 항상 UTC ISO-8601로 저장한다.

---

## 2) 핵심 엔티티 개요

1. `UserProfile` - 사용자 기본 설정
2. `DayPlan` - 날짜 단위 학습 계획(3-5개)
3. `LearningItem` - 학습 대상 항목(단어/숙어 등)
4. `PlanItem` - DayPlan과 LearningItem의 연결 및 진행 상태
5. `SentenceAttempt` - 사용자 문장 작성 기록
6. `SpeechAttempt` - 발화(녹음/점수) 기록
7. `ReviewTask` - 복습 큐 항목
8. `StreakState` - 현재 스트릭 스냅샷
9. `ActivityEvent` - 분석/복구용 이벤트 로그

---

## 3) 엔티티 상세

### 3.1 UserProfile

**목적:** 사용자 학습 정책과 앱 환경 설정 보관

| 필드 | 타입 | 필수 | 설명 |
|---|---|---|---|
| `user_id` | string (UUID) | Y | 로컬 기준 사용자 식별자 |
| `daily_target` | int | Y | 하루 목표(3~5) |
| `level` | string enum | N | CEFR 등 사용자 난이도 |
| `learning_focus` | string | N | 여행/업무/시험 등 포인트 |
| `reminder_enabled` | boolean | Y | 리마인더 사용 여부 |
| `created_at` | datetime | Y | 생성 시각 |
| `updated_at` | datetime | Y | 수정 시각 |

제약:
- `daily_target`는 3~5 범위만 허용

### 3.2 LearningItem

**목적:** 학습 대상 원본 정의

| 필드 | 타입 | 필수 | 설명 |
|---|---|---|---|
| `item_id` | string (UUID) | Y | 항목 식별자 |
| `item_type` | enum | Y | `vocab`, `preposition`, `idiom`, `phrasal_verb`, `collocation` |
| `lemma` | string | Y | 표제어/핵심 표현 |
| `meaning_ko` | string | Y | 한국어 의미 |
| `part_of_speech` | string | N | 품사 |
| `example_en` | string | Y | 기본 예문(영문) |
| `example_ko` | string | N | 예문 번역 |
| `source` | enum | Y | `ai_generated`, `user_added`, `edited` |
| `is_active` | boolean | Y | 사용 가능 여부 |
| `created_at` | datetime | Y | 생성 시각 |
| `updated_at` | datetime | Y | 수정 시각 |

제약:
- `lemma`, `meaning_ko`는 빈 문자열 금지

### 3.3 DayPlan

**목적:** 날짜 단위 학습 컨테이너(스트릭 판정 기준 단위)

| 필드 | 타입 | 필수 | 설명 |
|---|---|---|---|
| `plan_id` | string (UUID) | Y | 계획 식별자 |
| `user_id` | string | Y | 사용자 식별자 |
| `plan_date` | date (local) | Y | 로컬 날짜 기준 계획일 |
| `daily_target` | int | Y | 생성 시점 목표치 스냅샷 |
| `status` | enum | Y | `open`, `completed`, `expired` |
| `completed_at` | datetime | N | 계획 완료 시각 |
| `created_at` | datetime | Y | 생성 시각 |
| `updated_at` | datetime | Y | 수정 시각 |

제약:
- `(user_id, plan_date)` 유니크
- `status = completed`면 `completed_at` 필수

### 3.4 PlanItem

**목적:** DayPlan 내 항목별 학습 진행 추적

| 필드 | 타입 | 필수 | 설명 |
|---|---|---|---|
| `plan_item_id` | string (UUID) | Y | 연결 식별자 |
| `plan_id` | string | Y | DayPlan FK |
| `item_id` | string | Y | LearningItem FK |
| `order_no` | int | Y | Today 노출 순서 |
| `recall_status` | enum | Y | `pending`, `success`, `fail` |
| `sentence_status` | enum | Y | `pending`, `done` |
| `speech_status` | enum | Y | `pending`, `done`, `skipped` |
| `is_completed` | boolean | Y | 항목 완료 여부 |
| `completed_at` | datetime | N | 항목 완료 시각 |
| `created_at` | datetime | Y | 생성 시각 |
| `updated_at` | datetime | Y | 수정 시각 |

제약:
- `(plan_id, order_no)` 유니크
- `(plan_id, item_id)` 유니크

### 3.5 SentenceAttempt

**목적:** 사용자 문장 작성 이력 저장

| 필드 | 타입 | 필수 | 설명 |
|---|---|---|---|
| `sentence_id` | string (UUID) | Y | 식별자 |
| `plan_item_id` | string | Y | PlanItem FK |
| `sentence_en` | text | Y | 사용자 작성 문장 |
| `coach_feedback` | text | N | AI 코칭 결과 |
| `created_at` | datetime | Y | 생성 시각 |

제약:
- `sentence_en` 최소 길이 1 이상

### 3.6 SpeechAttempt

**목적:** 발화 시도와 점수 기록

| 필드 | 타입 | 필수 | 설명 |
|---|---|---|---|
| `speech_id` | string (UUID) | Y | 식별자 |
| `plan_item_id` | string | Y | PlanItem FK |
| `audio_uri` | string | Y | 로컬 오디오 파일 경로 |
| `duration_ms` | int | N | 녹음 길이 |
| `pronunciation_score` | float | N | 발음 점수(보조 지표) |
| `scoring_version` | string | N | 점수 알고리즘 버전 |
| `created_at` | datetime | Y | 생성 시각 |

제약:
- `pronunciation_score` 존재 시 0~100 범위
- `audio_uri`는 MVP에서 `local://` 스킴만 허용

### 3.7 ReviewTask

**목적:** 복습 큐와 일정 관리

| 필드 | 타입 | 필수 | 설명 |
|---|---|---|---|
| `review_id` | string (UUID) | Y | 식별자 |
| `user_id` | string | Y | 사용자 식별자 |
| `item_id` | string | Y | LearningItem FK |
| `source_plan_id` | string | Y | 생성 원본 DayPlan |
| `due_date` | date (local) | Y | 복습 예정일 |
| `stage` | enum | Y | `d1`, `d3`, `d7`, `custom` |
| `status` | enum | Y | `queued`, `done`, `missed` |
| `completed_at` | datetime | N | 복습 완료 시각 |
| `created_at` | datetime | Y | 생성 시각 |
| `updated_at` | datetime | Y | 수정 시각 |

제약:
- `status = done`면 `completed_at` 필수
- overdue는 `due_date < today && status = queued`로 계산
- 동일 사용자/항목/단계에서 `queued` 상태는 동시 1개만 허용

무결성 구현 권장:
- partial unique index 지원 시: `(user_id, item_id, stage)` where `status='queued'`
- 미지원 시: `active_queued_key`(예: `{user_id}:{item_id}:{stage}`) 컬럼으로 유사 제약 강제

### 3.8 StreakState

**목적:** 현재 스트릭 값 조회 최적화

| 필드 | 타입 | 필수 | 설명 |
|---|---|---|---|
| `user_id` | string | Y | PK |
| `current_streak_days` | int | Y | 현재 연속 일수 |
| `best_streak_days` | int | Y | 최고 연속 일수 |
| `last_completed_date` | date | N | 마지막 DayPlan 완료일 |
| `updated_at` | datetime | Y | 수정 시각 |

제약:
- 상세 계산 규칙은 `12_STREAK_RULES.md`를 따른다.

### 3.9 ActivityEvent

**목적:** 상태 복구/디버깅/지표 산출을 위한 이벤트 로그

| 필드 | 타입 | 필수 | 설명 |
|---|---|---|---|
| `event_id` | string (UUID) | Y | 이벤트 식별자 |
| `user_id` | string | Y | 사용자 식별자 |
| `event_name` | string enum | Y | 표준 이벤트명 |
| `entity_type` | string | N | `day_plan`, `review_task` 등 |
| `entity_id` | string | N | 대상 식별자 |
| `payload_json` | json | N | 부가 데이터 |
| `occurred_at` | datetime | Y | 이벤트 시각 |

`event_name` 표준 목록(권장 enum):
- `app_opened`
- `today_started`
- `word_step_completed`
- `today_completed`
- `review_started`
- `review_completed`
- `review_queue_drained`
- `streak_updated`
- `settings_updated`
- `history_opened`
- `history_filter_changed`
- `recording_started`
- `recording_saved`
- `pron_score_completed`
- `flow_error_occurred`

확장 규칙:
- 신규 이벤트는 `{domain}_{action}` 네이밍을 따른다.
  - 예: `today_started`, `review_completed`, `history_opened`
- 단순 화면 열림 이벤트는 `_opened`, 완료 이벤트는 `_completed` 접미사 사용을 권장한다.
- 표준 목록에 없는 이벤트를 추가할 때는 `19_TEST_PLAN.md`의 이벤트 검증 케이스를 함께 갱신한다.

---

## 4) 관계(ER 요약)

- `UserProfile` 1 : N `DayPlan`
- `DayPlan` 1 : N `PlanItem`
- `LearningItem` 1 : N `PlanItem`
- `PlanItem` 1 : N `SentenceAttempt`
- `PlanItem` 1 : N `SpeechAttempt`
- `LearningItem` 1 : N `ReviewTask`
- `UserProfile` 1 : 1 `StreakState`
- `UserProfile` 1 : N `ActivityEvent`

---

## 5) 상태 전이 규칙

### DayPlan 상태

- `open` -> `completed`: 필수 PlanItem 완료 조건 충족 시
- `open` -> `expired`: 날짜가 지나고 완료 조건 미충족 시

### PlanItem 완료 조건(최소)

- `recall_status = success`
- `sentence_status = done`
- `speech_status = done` 또는 사용자 설정에 따른 허용된 `skipped`

### ReviewTask 상태

- `queued` -> `done`: 복습 수행 완료
- `queued` -> `missed`: due_date 경과 후 미완료

---

## 6) 인덱스 및 조회 최적화

권장 인덱스:

- `DayPlan(user_id, plan_date)`
- `PlanItem(plan_id, order_no)`
- `ReviewTask(user_id, status, due_date)`
- `ActivityEvent(user_id, occurred_at desc)`

주요 조회:

- Today 화면: 오늘 `DayPlan` + 해당 `PlanItem`
- Inbox 화면: `ReviewTask` 중 `status=queued` and `due_date <= today`
- History 화면: 최근 `DayPlan`, `ReviewTask`, `ActivityEvent`

---

## 7) 오프라인/동기화 정책

- 로컬 DB를 시스템 오브 레코드(SoR)로 사용한다.
- 네트워크 복구 시 서버 동기화는 이벤트 타임스탬프 기반 증분 처리한다.
- 충돌 시 원칙:
  1. 사용자 직접 입력(`sentence_en`, 설정값) 우선
  2. 같은 타입 충돌은 최신 `updated_at` 우선
  3. 삭제보다 비활성(`is_active=false`) 우선

---

## 8) 보안/개인정보 모델링 원칙

- AI API 키는 클라이언트 저장 금지 (`16_SECURITY_PRIVACY_KEYS.md` 준수)
- 오디오 파일 경로는 로컬 sandbox 내 저장
- 개인 식별이 가능한 원문 데이터는 수집 최소화
- 분석 이벤트 `payload_json`에는 민감정보 삽입 금지

---

## 9) 데이터 무결성 체크리스트

- `daily_target` 범위(3~5) 위반 데이터가 없는가
- 한 사용자-하루에 `DayPlan`이 1개만 존재하는가
- 완료된 `DayPlan`은 필수 PlanItem 조건을 만족하는가
- `ReviewTask`의 상태와 완료 시각이 일관적인가
- `StreakState`가 DayPlan 완료 이력과 재계산 시 일치하는가

---

## 10) 버전 관리 및 마이그레이션

- 스키마 변경은 `schema_version`으로 관리한다.
- 마이그레이션은 항상 **추가(ADD) 우선, 파괴적 변경 지양** 원칙을 따른다.
- 계산 규칙 변경(복습/스트릭)은 데이터 구조 변경과 분리해 릴리즈 노트에 명시한다.

스키마 버전 저장 위치:
- 레코드별 필드가 아닌 DB 메타 테이블 `AppMeta`로 관리
- 예: `AppMeta(schema_version, last_migrated_at_utc)`

---

## 11) 관련 문서

- 사용자 플로우: `03_USER_FLOWS.md`
- Today 화면: `05_SCREEN_SPEC_TODAY.md`
- Inbox 화면: `06_SCREEN_SPEC_INBOX.md`
- History 화면: `07_SCREEN_SPEC_HISTORY.md`
- Settings 화면: `08_SCREEN_SPEC_SETTINGS.md`
- 복습 정책: `11_SPACED_REVIEW_POLICY.md`
- 스트릭 규칙: `12_STREAK_RULES.md`
- 오디오 녹음: `13_AUDIO_RECORDING_SPEC.md`
- 발음 점수: `14_PRONUNCIATION_SCORING_SPEC.md`
- API 계약: `15_API_CONTRACT.md`
- 보안/개인정보: `16_SECURITY_PRIVACY_KEYS.md`
