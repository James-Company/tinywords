# 11 SPACED REVIEW POLICY

이 문서는 TinyWords의 간격 반복(Spaced Review) 정책 SSOT이다.  
목표는 하루 3-5개 학습 루틴을 유지하면서, 회상 중심 복습을 통해 장기 기억 전환을 안정적으로 만드는 것이다.

---

## 1) 정책 목적

- 학습 직후 망각을 줄이기 위한 적절한 재노출 타이밍 제공
- "많이 보기"가 아니라 "떠올리기" 중심 복습 행동 강화
- 밀린 복습이 생겨도 루틴이 무너지지 않도록 우선순위 제공

---

## 2) 기본 원칙

- 복습은 **재읽기**가 아니라 **회상**이어야 한다.
- 기본 복습 슬롯은 `D-1`, `D-3`, `D-7`을 사용한다.
- 복습이 밀리면 가장 오래된 항목부터 처리한다.
- 복습 정책은 스트릭과 분리하되, 일일 루틴 유지에 기여하도록 설계한다.
- 정책 계산 기준 날짜는 사용자 로컬 날짜를 따른다.

---

## 3) 용어 정의

- **학습 완료(learning complete):** DayPlan 내 항목이 최소 완료 조건 충족
- **복습 태스크(ReviewTask):** 항목별 복습 단위 (`stage`, `due_date`, `status`)
- **overdue:** `due_date < today && status=queued`
- **due today:** `due_date = today && status=queued`
- **복습 완료(review done):** 해당 ReviewTask 수행 후 `status=done`

---

## 4) 기본 스케줄 정책

학습일을 `D0`라고 할 때 기본 복습 시점은 아래와 같다.

- `D1`: `D0 + 1일`
- `D3`: `D0 + 3일`
- `D7`: `D0 + 7일`

ReviewTask 생성 규칙:
1. 항목이 DayPlan에서 완료되면 `D1` 태스크 생성
2. `D1` 완료 시 `D3` 태스크 생성
3. `D3` 완료 시 `D7` 태스크 생성
4. `D7` 완료 시 기본 주기 종료(추가 주기는 `custom`으로 확장 가능)

---

## 5) 복습 큐 우선순위

Inbox 노출 정렬(상위 우선):

1. `overdue` 항목
2. `due today` 항목
3. 같은 그룹 내 `due_date` 오래된 순
4. 같은 `due_date` 내 `stage` 순 (`d1 -> d3 -> d7 -> custom`)

정책 의도:
- 누적 부채를 먼저 줄여 루틴 복귀 난이도를 낮춘다.

---

## 6) 일일 처리량 정책(Review Budget)

MVP 기본:
- 복습 항목은 전체 노출 가능
- 단, 사용자 과부하 방지를 위해 UI에서 "우선 처리 묶음"을 제시할 수 있다

권장 가이드:
- `daily_target=3` 사용자: 하루 복습 권장 상한 9개
- `daily_target=4` 사용자: 하루 복습 권장 상한 12개
- `daily_target=5` 사용자: 하루 복습 권장 상한 15개

상한 초과 시:
- 오래된 overdue 우선 처리 안내
- 나머지는 다음 날로 자연 이월(`queued` 유지)

---

## 7) 정답/오답 기반 반영 규칙

복습 수행 시 결과는 최소 3가지로 처리한다.

- `success`: 회상 성공
- `hard`: 회상했으나 어려움 큼
- `fail`: 회상 실패

MVP 반영 규칙:
- `success`:
  - 현재 stage 완료(`done`)
  - 다음 stage 태스크 생성
- `hard`:
  - 기본 정책(`policy_version=v1`)에서는 `success`와 동일 처리
  - 확장 정책에서는 `custom` 중간 복습 1회 삽입 가능(옵션)
- `fail`:
  - 기본 정책(`policy_version=v1`)에서는 현재 stage `queued` 유지 + `next_task_created=false`
  - 기본 정책(`policy_version=v1`)에서는 `due_date = today + 1일`로 재예약
  - 확장 정책에서만 `custom` 재시도 생성 허용

참고:
- API/서버 구현은 응답 `meta.policy_version`으로 실제 동작 모드를 명시한다.

---

## 8) 밀림(overdue) 처리 규칙

- `queued` 상태에서 due_date가 지나면 자동으로 overdue로 분류한다(별도 상태값 불필요).
- overdue 항목은 리스트 최상단에서 노출한다.
- overdue가 많아도 새 학습은 금지하지 않지만, Today에서 "복습 우선" 안내를 제공한다.
- `missed` 상태값은 기본 경로가 아니라 daily sweep/관리 배치에서만 선택적으로 부여한다.

권장 UX:
- overdue 5개 이상: 요약 배너 노출
- overdue 10개 이상: "오래된 것부터 5개 처리" CTA 제안

---

## 9) 생성/갱신 알고리즘(의사코드)

```text
onPlanItemCompleted(item, planDate):
  createReviewTask(stage=d1, dueDate=planDate+1, status=queued)

onReviewSubmitted(task, result, today):
  if result == success:
    mark task done
    createNextStageTask(task.stage, item, today)
  else if result == hard:
    mark task done
    if policyVersion != v1 and hardModeEnabled:
      createCustomTask(item, today+1)
    createNextStageTask(task.stage, item, today)
  else if result == fail:
    keep task queued
    if policyVersion == v1:
      task.dueDate = today + 1 day
    else if failCreatesCustom:
      createCustomTask(item, today+1)

dailySweep(today):
  for each queued task:
    if task.dueDate < today:
      task is treated as overdue
```

---

## 10) 데이터 모델 매핑

`04_DATA_MODEL.md`의 `ReviewTask` 필드와 매핑:

- `stage`: `d1 | d3 | d7 | custom`
- `due_date`: 로컬 날짜 기준 예정일
- `status`: `queued | done | missed`
- `completed_at`: `done`일 때 필수

무결성 규칙:
- 같은 항목에 대해 동일 `stage`의 `queued` 태스크는 동시에 1개만 허용
- `done`으로 바뀐 태스크는 재사용하지 않고 이력으로 보존

---

## 11) 시간/타임존 정책

- 기준 시간대: 사용자 기기 로컬 타임존
- 날짜 경계: 로컬 자정(00:00)
- 사용자 타임존 변경 시:
  - 기존 태스크는 `due_date` 절대 날짜 기준 유지
  - 표시만 새 로컬 타임존 기준으로 재계산

---

## 12) 오프라인 정책

- 복습 결과 저장은 로컬 우선(write-through local)
- 네트워크 복구 시 서버 동기화
- 동기화 충돌 시:
  1. `completed_at`이 존재하는 `done` 우선
  2. 동일 필드 충돌은 최신 `updated_at` 우선

---

## 13) 예외 정책

### 13.1 대량 누적

- 짧은 세션 복귀를 위해 "상위 우선 5개" 모드 제공 가능
- 전체 처리를 강제하지 않는다

### 13.2 잘못된 생성(중복/누락)

- 검증 단계에서 중복 stage 제거
- 필수 stage 누락 시 자동 재생성(백필)

### 13.3 정책 버전 변경

- 기존 태스크는 구버전으로 유지 가능
- 신규 태스크부터 신버전 적용(점진 전환)

---

## 14) 분석 지표

- `review_due_count` (일별 예정 복습 수)
- `review_done_rate` (완료율)
- `overdue_backlog` (밀림 누적 수)
- `stage_pass_rate` (`d1/d3/d7` 통과율)
- `review_recovery_time` (overdue 복구까지 평균 일수)

MVP 핵심 KPI:
- `due today` 기준 당일 복습 완료율

---

## 15) 테스트 기준(요약)

필수 테스트:
1. DayPlan 완료 시 `D1` 생성 검증
2. `D1 -> D3 -> D7` 단계 전이 검증
3. overdue 정렬 우선순위 검증
4. 오프라인 완료 후 재실행 복원 검증
5. 타임존 변경 후 due 표시 일관성 검증

상세 케이스는 `19_TEST_PLAN.md`에서 관리한다.

---

## 16) 수용 기준(DoD)

1. 학습 완료 항목에서 기본 복습 슬롯(`D1/D3/D7`)이 정확히 생성된다.
2. Inbox가 overdue 우선 규칙대로 항목을 노출한다.
3. 복습 완료 시 다음 stage가 정책대로 생성된다.
4. 밀림 발생 시에도 루틴이 중단되지 않고 복귀 가능하다.
5. 정책 계산 결과가 로컬 재실행/오프라인 환경에서도 일관된다.

---

## 17) 관련 문서

- 스트릭 규칙: `12_STREAK_RULES.md`
- 사용자 플로우: `03_USER_FLOWS.md`
- Inbox 스펙: `06_SCREEN_SPEC_INBOX.md`
- 데이터 모델: `04_DATA_MODEL.md`
- 테스트 계획: `19_TEST_PLAN.md`
