# 07 SCREEN SPEC HISTORY

이 문서는 TinyWords의 History 화면 스펙을 정의한다.  
History는 사용자의 학습/복습 이력을 시간축으로 보여주고, 연속성(스트릭)과 누락 지점을 파악해 다음 행동으로 복귀시키는 화면이다.

---

## 1) 화면 목적

- 날짜별 학습/복습 완료 내역을 명확히 보여준다.
- 사용자가 자신의 학습 지속성(연속 일수, 공백일)을 이해하도록 돕는다.
- 누락된 항목을 Today 또는 Inbox로 즉시 전이할 수 있게 한다.

---

## 2) 진입 조건 / 종료 조건

### 진입 조건

- 하단 탭 `History` 선택
- Today/Inbox 완료 후 "기록 보기" CTA 선택

### 종료 조건

- 사용자 탭 이동(Today/Inbox/Settings)
- 특정 날짜 상세에서 뒤로 이동

---

## 3) 데이터 의존성

### 읽기

- `DayPlan` (날짜별 완료 여부, `daily_target`, `status`, `completed_at`)
- `ReviewTask` (복습 완료/미완료 상태, `stage`, `due_date`)
- `PlanItem` (항목별 단계 수행 여부)
- `StreakState` (`current_streak_days`, `best_streak_days`)
- `ActivityEvent` (상세 타임라인 구성)

### 쓰기

- `ActivityEvent` (`history_opened`, `history_filter_changed`, `history_drilldown_opened`)

History는 조회 중심 화면이며 도메인 상태를 직접 변경하지 않는다.

---

## 4) 화면 구조(정보 계층)

1. **상단 헤더**
   - 타이틀(`History`)
   - 기간 선택(최근 7일/30일/전체)

2. **연속성 요약 카드**
   - 현재 스트릭, 최고 스트릭
   - 최근 7일 완료 히트맵(또는 체크 인디케이터)

3. **필터 바**
   - `전체`, `학습`, `복습`
   - 상태 필터: `완료`, `미완료`, `밀림`

4. **기록 리스트**
   - 날짜 섹션별 그룹
   - 날짜 요약: 학습 n/m, 복습 done/queued
   - 항목 진입 CTA: `상세 보기`

5. **상세 패널/화면**
   - 항목별 단계 상태(회상/문장/발화)
   - 복습 stage와 수행 결과
   - 보조 CTA: `Today로 이동`, `Inbox로 이동`

---

## 5) 컴포넌트 스펙

### 5.1 Streak Summary Card

- 표시값:
  - `current_streak_days`
  - `best_streak_days`
  - 최근 완료일 `last_completed_date`
- 카피 원칙:
  - 성과 강조 + 복귀 유도
  - 경쟁/비교형 표현 금지

### 5.2 History Filter Bar

- 기본값: `전체`
- 필터 변경 시:
  - 현재 스크롤 위치 유지 시도
  - 불가 시 섹션 상단으로 이동

### 5.3 Day Section Row

- 표시 필드:
  - `plan_date`
  - `DayPlan.status`
  - 학습 완료 수(`completed_plan_items / daily_target`)
  - 복습 요약(`done_count`, `queued_or_missed_count`)
- 상태 배지:
  - `완료`, `부분 완료`, `미완료`

### 5.4 Drilldown Detail

- PlanItem별 상태:
  - 회상 `success/fail/pending`
  - 문장 `done/pending`
  - 발화 `done/skipped/pending`
- ReviewTask 상세:
  - `stage`, `status`, `due_date`, `completed_at`

---

## 6) 상태 정의

### 6.1 화면 상태

- `loading`: 이력 조회 중
- `ready_with_data`: 이력 데이터 존재
- `ready_empty`: 이력 없음(신규 사용자)
- `error`: 조회 실패

### 6.2 날짜 상태

- `complete_day`: DayPlan 완료 + 해당일 주요 복습 처리 완료
- `partial_day`: DayPlan 또는 복습 일부만 완료
- `inactive_day`: 활동 없음

MVP 표시 원칙:
- `inactive_day`는 별도 레코드로 리스트에 렌더링하지 않는다.
- 공백일은 상단 배너/요약(예: "2일 공백")으로만 안내한다.
- 최근 7일 히트맵이 필요한 경우에만 UI 계산으로 빈 날짜를 채운다(데이터 생성 금지).

---

## 7) 정렬/그룹핑 규칙

- 기본 정렬: 최신 날짜 우선(desc)
- 그룹 단위: 로컬 날짜(`plan_date`)
- 같은 날짜 내 정렬:
  1. DayPlan 요약
  2. 학습 항목( `order_no` 순 )
  3. 복습 항목( overdue -> due today -> done )
- 복습 정렬 용어/우선순위는 `06_SCREEN_SPEC_INBOX.md`와 동일 SSOT를 따른다.

---

## 8) 사용자 인터랙션 규칙

### 필터 변경

- 필터 탭 클릭 시 리스트 즉시 재구성
- 선택 필터는 세션 동안 유지

### 날짜 상세 진입

- 날짜 행 탭 시 상세 패널 오픈
- 상세에서 미완료 항목 발견 시:
  - 학습 누락 -> `Today로 이동`
  - 복습 누락/밀림 -> `Inbox로 이동`

### 복귀 유도

- 2일 이상 공백 감지 시 상단 인라인 메시지 노출:
  - "오늘 3개부터 다시 시작해요."

---

## 9) 예외 처리

### 9.1 이력 데이터 없음

- 메시지: "아직 기록이 없어요. 오늘 학습부터 시작해볼까요?"
- CTA: `Today로 이동`

### 9.2 일부 데이터 누락(참조 불일치)

- 손상된 항목은 숨기고 나머지 이력은 정상 표시
- 오류 이벤트 기록 후 다음 동기화 시 복구 시도

### 9.3 대용량 이력

- 페이징/지연 로딩 적용
- 초기 로드 목표: 첫 화면 1초 내 표시(로컬 기준)

---

## 10) 카피 가이드

- 톤: 회고 + 격려, 비난 없음
- 원칙:
  - "못했다"보다 "다시 시작" 중심 표현
  - 기록은 사실 중심, 평가형 표현 최소화

예시:
- 연속 유지: "좋아요. 루틴이 이어지고 있어요."
- 공백 감지: "괜찮아요. 오늘부터 다시 쌓아가요."
- 기록 없음: "첫 기록을 만들어볼까요?"

---

## 11) 접근성/사용성 기준

- 날짜/상태 정보는 색상 + 텍스트 동시 제공
- 필터 탭은 스크린리더 라벨 제공
- 리스트 가독성을 위해 날짜 섹션 간 명확한 간격 유지
- 상세 패널 진입/복귀 시 포커스 이동 일관성 보장

---

## 12) 분석 이벤트

- `history_opened`
  - props: `range(7d|30d|all)`, `record_count`
- `history_filter_changed`
  - props: `filter_type(all|learning|review)`, `status_filter`
- `history_day_drilldown_opened`
  - props: `plan_date`, `has_gap`, `incomplete_count`
- `history_resume_cta_clicked`
  - props: `target(today|inbox)`, `reason(gap|incomplete|overdue)`
- `history_error_shown`
  - props: `error_type(storage|data_ref|unknown)`

---

## 13) 수용 기준(DoD)

1. History 진입 시 최신 날짜 기준으로 학습/복습 이력이 정확히 노출된다.
2. 필터(`전체/학습/복습`) 변경 시 데이터가 정확히 재구성된다.
3. 날짜 상세에서 단계별 상태(회상/문장/발화)와 복습 stage를 확인할 수 있다.
4. 이력이 없거나 일부 손상된 경우에도 화면이 중단되지 않는다.
5. 미완료/밀림 항목에서 Today/Inbox 복귀 CTA가 올바르게 동작한다.
6. UI는 `17_UI_STYLE_NOTEBOOK_THEME.md`의 톤/컴포넌트 규칙을 준수한다.

---

## 14) 관련 문서

- 사용자 플로우: `03_USER_FLOWS.md`
- 데이터 모델: `04_DATA_MODEL.md`
- Today 스펙: `05_SCREEN_SPEC_TODAY.md`
- Inbox 스펙: `06_SCREEN_SPEC_INBOX.md`
- Settings 스펙: `08_SCREEN_SPEC_SETTINGS.md`
- 복습 정책: `11_SPACED_REVIEW_POLICY.md`
- 스트릭 규칙: `12_STREAK_RULES.md`
- UI 스타일: `17_UI_STYLE_NOTEBOOK_THEME.md`
