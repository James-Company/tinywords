# 06 SCREEN SPEC INBOX

이 문서는 TinyWords의 Inbox 화면 스펙을 정의한다.  
Inbox는 복습 큐를 처리하는 화면으로, 망각 곡선을 따라 회상 중심 복습을 수행하고 다음 복습 일정을 갱신하는 역할을 한다.

---

## 1) 화면 목적

- 오늘 처리해야 할 복습 항목을 우선순위에 따라 제시한다.
- 복습 수행 후 상태를 `queued -> done/missed`로 정확히 갱신한다.
- 복습 완료 경험을 간결하게 제공하고 다음 행동(Today/History)으로 연결한다.

---

## 2) 진입 조건 / 종료 조건

### 진입 조건

- 하단 탭 `Inbox` 선택
- Today 완료 후 "복습하러 가기" CTA 선택
- 알림/딥링크로 복습 진입

### 종료 조건

- 당일 처리 대상 복습 항목 0개
- 사용자 탭 이동(Today/History/Settings)

---

## 3) 데이터 의존성

### 읽기

- `ReviewTask` (`status`, `due_date`, `stage`, `item_id`)
- `LearningItem` (`lemma`, `meaning_ko`, `item_type`, `example_en`)
- `StreakState` (요약 표시용)

### 쓰기

- `ReviewTask.status`, `completed_at`, `updated_at`
- 다음 단계 `ReviewTask` 생성(정책 기반)
- `ActivityEvent` (`review_started`, `review_completed`, `review_empty`)

---

## 4) 큐 우선순위 규칙

복습 항목 정렬 기준(상위 우선):

1. `overdue` 항목 (`due_date < today && status=queued`)
2. `due today` 항목 (`due_date = today && status=queued`)
3. 같은 그룹 내 오래된 `due_date` 우선
4. 동일 due에서는 `stage` 순서 `d1 -> d3 -> d7 -> custom`

노출 개수:
- MVP 기본은 전체 표시
- 항목 수가 과도할 경우 배치 처리(예: 10개 단위)는 추후 확장

---

## 5) 화면 구조(정보 계층)

1. **상단 헤더**
   - 타이틀(`Inbox`)
   - 오늘 복습 카운트 배지(`오늘 4개`)

2. **요약 카드**
   - `overdue`, `today_due`, `done_today` 개수
   - 핵심 CTA: `복습 시작` / `이어서 복습`

3. **복습 큐 리스트**
   - 항목 카드(표현, 의미, 단계, due 상태)
   - 상태 라벨: `밀림`, `오늘`, `완료`
   - 항목 액션: `복습하기`

4. **빈 상태(조건부)**
   - 오늘 복습 없음 메시지
   - 보조 CTA: `Today로 이동`

5. **완료 영역(조건부)**
   - 당일 복습 완료 메시지
   - 보조 CTA: `History 확인`

---

## 6) 컴포넌트 스펙

### 6.1 Header

- 필수 요소: 화면 타이틀, 복습 대기 개수
- 보조 요소: 스트릭 미니 인디케이터(선택)

### 6.2 Review Summary Card

- 표시값:
  - `queued_total`
  - `overdue_count`
  - `done_today_count`
- CTA 라벨:
  - 대기 0개: `복습 없음`
  - 미시작: `복습 시작`
  - 진행중: `이어서 복습`

### 6.3 Review Item Card

- 표시 필드:
  - `lemma`, `meaning_ko`, `item_type`
  - `stage` (`D-1`, `D-3`, `D-7`, `Custom`)
  - due 배지(`밀림` 또는 `오늘`)
- 액션:
  - `복습하기`
  - 완료 후 `다음 항목`

### 6.4 Empty/Done Panel

- Empty 노출 조건: `queued_total = 0`
- Done 노출 조건: `queued_total = 0 && done_today_count > 0`
- CTA:
  - Empty: `Today로 이동`
  - Done: `History 보기`

---

## 7) 상태 정의

### 7.1 화면 상태

- `loading`: 큐 조회 중
- `ready_with_queue`: 처리할 복습 있음
- `ready_empty`: 처리할 복습 없음
- `error`: 복습 데이터 조회 실패

### 7.2 항목 상태

- `queued`: 복습 대기
- `done`: 복습 완료
- `missed`: 기한 경과로 미수행 처리

---

## 8) 사용자 인터랙션 규칙

### 복습 시작/재개

- `복습 시작` 클릭 시 우선순위 1순위 항목부터 진입
- `이어서 복습` 클릭 시 마지막 진행 지점으로 복귀

### 복습 완료 처리

- 사용자가 항목 완료 시 즉시 `status=done`, `completed_at` 저장
- 정책에 따라 다음 stage 복습 태스크를 생성/갱신
- 완료 후 자동으로 다음 우선순위 항목 제시

### 복습 종료

- 큐 소진 시 완료 패널 노출
- 강제 화면 이동 없이 CTA로 다음 화면 유도

---

## 9) 예외 처리

### 9.1 큐 조회 실패

- 메시지: "복습 목록을 불러오지 못했어요."
- 버튼: `다시 시도`
- 로컬 캐시가 있으면 캐시 우선 렌더링

### 9.2 아이템 참조 누락(item_id 불일치)

- 해당 항목은 숨기고 오류 이벤트 기록
- 사용자에게는 진행 가능 항목만 노출

### 9.3 오프라인 상태

- 로컬 큐 기반으로 복습 진행 허용
- 서버 동기화는 연결 복구 후 백그라운드 처리

---

## 10) 카피 가이드

- 톤: 압박 없는 리마인더
- 원칙:
  - "밀림"은 사실 전달로만 사용, 죄책감 유발 금지
  - 즉시 가능한 다음 행동을 함께 제시

예시:
- 대기 있음: "짧게 복습하고 오늘 기억을 단단히 만들어요."
- 밀림 있음: "괜찮아요. 오래된 복습부터 차근히 정리해요."
- 없음: "오늘 복습은 모두 끝났어요."

---

## 11) 접근성/사용성 기준

- 항목 카드 터치 타깃 최소 44x44pt
- `밀림/오늘/완료` 상태는 색상 + 텍스트 동시 제공
- 리스트 길이가 길어도 첫 행동 CTA가 화면 내 즉시 보여야 함
- 네트워크 불안정 시에도 로컬 복습은 중단되지 않아야 함

---

## 12) 분석 이벤트

- `review_started`
  - props: `queue_size`, `overdue_count`
- `review_item_opened`
  - props: `review_id`, `stage`, `is_overdue`
- `review_completed`
  - props: `review_id`, `stage`, `duration_sec`
- `review_queue_drained`
  - props: `done_today_count`
- `review_error_shown`
  - props: `error_type(network|storage|data_ref|unknown)`

---

## 13) 수용 기준(DoD)

1. Inbox 진입 시 우선순위 규칙에 맞게 복습 항목이 정렬되어 노출된다.
2. 복습 완료 시 `ReviewTask.status`와 `completed_at`이 즉시 저장된다.
3. 큐 소진 시 빈 상태/완료 상태가 올바르게 표시된다.
4. 오프라인에서도 로컬 큐 기반 복습 수행이 가능하다.
5. 참조 누락 항목이 있어도 화면 전체 플로우가 중단되지 않는다.
6. UI는 `17_UI_STYLE_NOTEBOOK_THEME.md`의 톤/컴포넌트 규칙을 준수한다.

---

## 14) 관련 문서

- 사용자 플로우: `03_USER_FLOWS.md`
- 데이터 모델: `04_DATA_MODEL.md`
- Today 스펙: `05_SCREEN_SPEC_TODAY.md`
- History 스펙: `07_SCREEN_SPEC_HISTORY.md`
- Settings 스펙: `08_SCREEN_SPEC_SETTINGS.md`
- 복습 정책: `11_SPACED_REVIEW_POLICY.md`
- 스트릭 규칙: `12_STREAK_RULES.md`
- UI 스타일: `17_UI_STYLE_NOTEBOOK_THEME.md`
