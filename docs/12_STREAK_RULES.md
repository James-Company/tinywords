# 12 STREAK RULES

이 문서는 TinyWords의 스트릭(streak) 계산 규칙 SSOT이다.  
스트릭의 목적은 사용자에게 압박을 주는 것이 아니라, "작은 학습 루틴의 연속성"을 시각화해 복귀를 돕는 데 있다.

---

## 1) 규칙 목적

- 하루 학습 루틴 유지 여부를 단순하고 일관되게 판정한다.
- 보너스 활동보다 핵심 루틴 완료를 우선한다.
- 공백이 생겨도 빠르게 복귀할 수 있는 경험을 제공한다.

---

## 2) 핵심 원칙

- 스트릭은 **하루 계획(DayPlan) 완료**로만 증가한다.
- 보너스 활동(추가 항목, 추가 문장, 추가 복습)은 스트릭 유지 조건이 아니다.
- 계산 기준은 사용자 **로컬 날짜**이며, 하루에 최대 1회만 증가한다.
- 복습 정책(`11_SPACED_REVIEW_POLICY.md`)과는 분리되지만, 복습 수행은 루틴 지속성 지표로 보조 활용할 수 있다.

---

## 3) 용어 정의

- **Active Day:** 해당 로컬 날짜에 `DayPlan.status = completed`인 날
- **Gap Day:** Active Day가 아닌 날
- **Current Streak:** 오늘 기준 연속 Active Day 수
- **Best Streak:** 과거 포함 최대 연속 Active Day 수
- **Freeze:** MVP에서는 미지원(추후 확장용 개념)

---

## 4) 스트릭 판정 기준

하루 `d`에서 스트릭 유지/증가 조건:

1. `DayPlan(d)`가 존재한다.
2. `DayPlan(d).status = completed` 이다.
3. 같은 날짜에 이미 스트릭 증가 이벤트가 기록되지 않았다.

위 3개를 모두 만족하면:
- `current_streak_days += 1` (단, 전날 연속성 조건에 따라 계산)
- `best_streak_days = max(best_streak_days, current_streak_days)`

---

## 5) 연속성 계산 규칙

마지막 완료일을 `last_completed_date`라고 할 때:

- `d == last_completed_date`:
  - 이미 반영된 날이므로 변화 없음(중복 증가 방지)
- `d == last_completed_date + 1일`:
  - 연속 유지, `current_streak_days += 1`
- `d > last_completed_date + 1일`:
  - 연속 끊김, `current_streak_days = 1`
- `last_completed_date`가 없음(첫 완료):
  - `current_streak_days = 1`

항상 완료 후:
- `last_completed_date = d`

---

## 6) 무엇이 스트릭에 포함/제외되는가

### 포함(Counted)

- Today에서 하루 목표 항목 완료
- DayPlan 최소 완료 조건 충족 후 상태가 `completed`로 전환

### 제외(Not Counted)

- 복습만 수행하고 DayPlan 미완료인 경우
- 추가 학습/추가 문장 작성 같은 보너스 활동
- 앱 접속, 설정 변경, 기록 조회 같은 비학습 행동

---

## 7) 리셋 규칙

- 하루 공백이 1일 이상 발생하면 다음 Active Day에서 스트릭은 `1`로 시작한다.
- 리셋은 페널티가 아니라 상태 전환이며, `best_streak_days`는 유지한다.
- 앱 UI 문구는 비난형이 아니라 복귀형으로 제공한다.

예시:
- 2/10 완료, 2/11 완료, 2/12 미완료, 2/13 완료 -> `current=1`, `best`는 기존 최대 유지

---

## 8) 타임존/날짜 경계 규칙

- 기준: 사용자 로컬 타임존의 자정(00:00)
- 사용자 타임존 변경 시:
  - 미래 날짜로의 오탐 증가를 방지하기 위해 "완료 시점의 로컬 날짜"를 우선 저장
  - 기존 `last_completed_date`와 신규 날짜 비교는 정규화된 로컬 날짜 기준 수행

권장 구현:
- `completed_at`(timestamp) + `completed_local_date`(date) 함께 저장

---

## 9) 오프라인/동기화 규칙

- 오프라인 완료 시 로컬에서 즉시 스트릭 갱신
- 온라인 복구 후 서버 동기화 시 충돌 해결:
  1. 동일 날짜 중복 완료는 1회만 인정
  2. `completed_local_date` 기준으로 idempotent 적용
  3. 충돌 시 최신 `updated_at` 우선, 단 중복 증가 금지

---

## 10) 계산 의사코드

```text
onDayPlanCompleted(userId, date d):
  state = getStreakState(userId)

  if alreadyCounted(userId, d):
    return state

  if state.last_completed_date is null:
    state.current_streak_days = 1
  else if d == state.last_completed_date:
    return state
  else if d == state.last_completed_date + 1 day:
    state.current_streak_days += 1
  else:
    state.current_streak_days = 1

  state.best_streak_days = max(state.best_streak_days, state.current_streak_days)
  state.last_completed_date = d
  save(state)
  recordEvent("streak_updated", {date: d, current: state.current_streak_days})
```

---

## 11) UI 표시 규칙

- 기본 표시:
  - `현재 n일 연속`
  - `최고 m일`
- 공백 발생 직후 문구:
  - "괜찮아요. 오늘부터 다시 이어가요."
- 과도한 압박 표현(예: "연속이 깨졌습니다!")은 사용하지 않는다.

---

## 12) 예외 케이스

### 12.1 하루 2회 완료 처리 시도

- 첫 완료만 반영, 이후는 무시(idempotent)

### 12.2 DayPlan 강제 수정(운영/버그 복구)

- 수정 후 스트릭 재계산 잡(job) 실행
- 재계산은 날짜 오름차순 단일 패스로 처리

### 12.3 기기 시간 수동 변경

- 비정상 점프 감지 시 경고 이벤트 기록
- 스트릭 계산은 서버 동기화 시 재검증 가능하게 설계

---

## 13) 데이터 모델 매핑

`04_DATA_MODEL.md` `StreakState` 사용:

- `current_streak_days`
- `best_streak_days`
- `last_completed_date`
- `updated_at`

이벤트 로그:
- `ActivityEvent.event_name = streak_updated`
- payload 예시:
  - `{"date":"2026-02-15","current":4,"best":9}`

---

## 14) 테스트 기준(요약)

필수 테스트:
1. 첫 완료 시 `current=1` 생성
2. 연속 완료 시 `+1` 증가
3. 공백 후 완료 시 `current=1` 리셋
4. 같은 날 중복 완료 반영 방지
5. 오프라인 완료 후 재실행/동기화 시 중복 증가 없음
6. 타임존 변경 시 날짜 경계 오판정 없음

상세 케이스는 `19_TEST_PLAN.md`에서 관리한다.

---

## 15) 수용 기준(DoD)

1. 스트릭은 DayPlan 완료 기준으로만 증가한다.
2. 보너스 활동은 스트릭 유지/증가에 영향을 주지 않는다.
3. 공백 발생 시 다음 완료일에 `current_streak_days=1`로 정확히 계산된다.
4. 동일 날짜 중복 처리에도 스트릭이 한 번만 반영된다.
5. UI는 복귀 유도 중심 카피로 스트릭 상태를 전달한다.

---

## 16) 관련 문서

- 복습 정책: `11_SPACED_REVIEW_POLICY.md`
- 사용자 플로우: `03_USER_FLOWS.md`
- Today 스펙: `05_SCREEN_SPEC_TODAY.md`
- History 스펙: `07_SCREEN_SPEC_HISTORY.md`
- 데이터 모델: `04_DATA_MODEL.md`
- 테스트 계획: `19_TEST_PLAN.md`
