# 05 SCREEN SPEC TODAY

이 문서는 TinyWords의 Today 화면 스펙을 정의한다.  
Today는 사용자가 가장 먼저 진입해 하루 학습(3-5개)을 완료하는 핵심 화면이며, 완료 시 복습 큐 생성과 스트릭 계산의 출발점이 된다.

---

## 1) 화면 목적

- 오늘 해야 할 학습량과 현재 진행 상태를 한눈에 보여준다.
- 사용자가 바로 학습을 시작/재개하도록 CTA를 제공한다.
- 단어별 학습 단계(회상/문장/발화) 진행을 완료로 이끈다.
- 완료 후 Inbox(복습)로 자연스럽게 전이시킨다.

---

## 2) 진입 조건 / 종료 조건

### 진입 조건

- 하단 탭 `Today` 선택
- 앱 첫 실행 또는 앱 재실행
- 다른 화면에서 "오늘 학습 계속" CTA 선택

### 종료 조건

- 오늘 목표 달성(`DayPlan.status = completed`)
- 사용자 탭 이동(Inbox/History/Settings)

---

## 3) 데이터 의존성

### 읽기

- `DayPlan` (오늘 날짜, `daily_target`, `status`)
- `PlanItem` (오늘 계획 항목, `order_no`, 단계 상태)
- `UserProfile` (`daily_target`)

### 쓰기

- `PlanItem.recall_status`, `sentence_status`, `speech_status`, `is_completed`
- `DayPlan.status`, `completed_at`
- `ActivityEvent` (`today_started`, `word_step_completed`, `today_completed`)
- `ReviewTask` (완료 항목 기반 복습 큐 생성)

---

## 4) 화면 구조(정보 계층)

1. **상단 헤더**
   - 날짜/인사 문구
   - 오늘 목표 배지 (`3개 중 1개 완료`)

2. **진행 요약 카드**
   - 진행률 바(0~100%)
   - 남은 항목 수
   - 핵심 CTA: `학습 시작` 또는 `이어하기`

3. **오늘 항목 리스트**
   - 항목 카드(표제어, 의미, 타입)
   - 단계 상태 칩(회상/문장/발화)
   - 항목별 액션: 시작/재개

4. **완료 영역(조건부)**
   - 오늘 목표 완료 메시지
   - `복습하러 가기(Inbox)` CTA

5. **에러/오프라인 배너(조건부)**
   - 네트워크/AI 실패 시 재시도 안내
   - 오프라인 모드 안내

---

## 5) 컴포넌트 스펙

### 5.1 Header

- 필수 요소: 현재 날짜, 화면 타이틀(`Today`)
- 보조 요소: 스트릭 미니 인디케이터(숫자만, 과도한 강조 금지)

### 5.2 Progress Card

- 표시값:
  - `completed_count / daily_target`
  - `progress_percent = floor(completed_count / daily_target * 100)`
- CTA 라벨 규칙:
  - 미시작: `학습 시작`
  - 진행중: `이어하기`
  - 완료: `오늘 완료`

### 5.3 Plan Item Card

- 표시 필드:
  - `lemma`, `meaning_ko`, `item_type`
  - 단계 칩: `회상`, `문장`, `발화`
- 상태 컬러(의미):
  - `pending`: 중립
  - `done/success`: 성공
  - `fail`: 주의(비파괴적 톤)
- 액션:
  - `시작`, `재개`, `다시 보기`

### 5.4 Completion Panel

- 노출 조건: `DayPlan.status = completed`
- 표시 요소:
  - 완료 축하 카피(격려형)
  - 오늘 완료 시간
  - 다음 행동 CTA: `Inbox에서 복습하기`

---

## 6) 상태 정의

### 6.1 화면 상태

- `loading`: 데이터 로딩 중
- `ready_empty`: 오늘 계획 없음(아직 생성 전)
- `ready_active`: 오늘 계획 존재 + 미완료
- `ready_completed`: 오늘 계획 완료
- `error`: 치명 오류(화면 진행 불가)

### 6.2 항목 상태

- `not_started`: 어떤 단계도 수행 안 됨
- `in_progress`: 일부 단계 완료
- `done`: 최소 완료 조건 충족

최소 완료 조건(PlanItem):
- `recall_status = success`
- `sentence_status = done`
- `speech_status = done` 또는 허용된 `skipped`

---

## 7) 사용자 인터랙션 규칙

### 학습 시작/이어하기

- `학습 시작` 클릭 시 첫 미완료 항목으로 이동
- `이어하기` 클릭 시 마지막 진행 항목으로 이동

### 항목 완료 처리

- 단계 완료 즉시 로컬 저장
- 항목 최소 조건 충족 시 `is_completed = true`
- 모든 항목 완료 시 DayPlan 완료 처리

### 완료 후 전이

- 완료 직후 요약 노출
- 기본 추천 전이: Inbox
- 강제 이동은 하지 않고 CTA로 유도

---

## 8) 예외 처리

### 8.1 오늘 계획 미생성

- 상태: `ready_empty`
- 처리:
  - 로컬 기준으로 DayPlan 생성 시도
  - 실패 시 재시도 버튼 노출

### 8.2 AI/네트워크 실패

- 기존 로컬 항목이 있으면 학습 지속 허용
- 신규 생성 실패 시:
  - 메시지: "지금은 새 항목 생성이 어려워요. 저장된 항목부터 진행해요."
  - 버튼: `다시 시도`

### 8.3 앱 중단 후 복귀

- 마지막 진행 항목/단계를 복원
- 복원 실패 시 첫 미완료 항목으로 fallback

---

## 9) 카피 가이드

- 톤: 조용한 코치, 비난 없는 안내
- 원칙:
  - 짧고 명확한 문장
  - 압박형 표현 금지
  - 실패 시 복귀 행동을 즉시 제시

예시:
- 시작 전: "오늘은 3개만, 확실하게."
- 진행 중: "좋아요. 한 단계씩 내 것으로 만들고 있어요."
- 오류 시: "잠시 문제가 있어요. 저장된 학습부터 이어갈게요."

---

## 10) 접근성/사용성 기준

- 터치 타깃 최소 44x44pt
- 진행률/상태는 색상 + 텍스트 동시 제공
- 음성 기능 없는 환경에서도 학습 완료 가능(설정 기반)
- 로딩/오류 상태에서도 핵심 CTA는 시각적으로 명확해야 함

---

## 11) 분석 이벤트

- `today_started`
  - props: `plan_id`, `daily_target`
- `word_step_completed`
  - props: `plan_item_id`, `step_type(recall|sentence|speech)`
- `today_completed`
  - props: `plan_id`, `completed_count`, `duration_sec`
- `today_resume_clicked`
  - props: `plan_id`, `last_step`
- `today_error_shown`
  - props: `error_type(network|ai|storage|unknown)`

---

## 12) 수용 기준(DoD)

1. Today 진입 후 현재 진행률과 남은 학습량이 정확히 표시된다.
2. 사용자는 2탭 이내로 첫 미완료 항목 학습을 시작할 수 있다.
3. 항목 단계 완료 시 데이터가 즉시 저장되고 앱 재실행 후 복원된다.
4. 모든 항목 완료 시 DayPlan 완료 및 Inbox 전이 CTA가 노출된다.
5. 오프라인/AI 실패 상황에서도 기존 학습 데이터 기반 진행이 가능하다.
6. UI는 `17_UI_STYLE_NOTEBOOK_THEME.md`의 톤/컴포넌트 규칙을 준수한다.

---

## 13) 관련 문서

- 사용자 플로우: `03_USER_FLOWS.md`
- 데이터 모델: `04_DATA_MODEL.md`
- Inbox 스펙: `06_SCREEN_SPEC_INBOX.md`
- History 스펙: `07_SCREEN_SPEC_HISTORY.md`
- Settings 스펙: `08_SCREEN_SPEC_SETTINGS.md`
- 복습 정책: `11_SPACED_REVIEW_POLICY.md`
- 스트릭 규칙: `12_STREAK_RULES.md`
- UI 스타일: `17_UI_STYLE_NOTEBOOK_THEME.md`
