# 19 TEST PLAN

이 문서는 TinyWords MVP 테스트 전략과 실행 계획의 SSOT이다.  
목표는 핵심 학습 루프(Today -> Inbox -> History)가 안정적으로 동작하고, 복습/스트릭/AI/오디오 기능이 정책 문서와 일치함을 검증하는 것이다.

---

## 1) 테스트 목표

- 핵심 사용자 가치(하루 3-5개 학습 루틴) 보장
- 정책 일치성(복습, 스트릭, 보안, UI 톤) 검증
- 오프라인/권한/오류 상황에서의 복구 가능성 검증
- 릴리즈 전 회귀(regression) 위험 최소화

---

## 2) 테스트 범위

### 2.1 포함(In Scope)

- 화면: Today, Inbox, History, Settings
- 도메인: DayPlan, PlanItem, ReviewTask, StreakState
- AI: 단어 생성, 문장 코칭
- 오디오: 녹음/저장/재생/점수
- API: 핵심 엔드포인트, 에러 포맷, 멱등성
- 보안: 키 노출 금지, 민감 로그 차단, 권한 흐름

### 2.2 제외(Out of Scope for MVP)

- 대규모 부하 테스트(수만 동시 사용자)
- 고급 발음(음소 단위) 품질 벤치마크
- 데스크톱 전용 UI 심층 테스트

---

## 3) 테스트 레벨 전략

### 3.1 Unit Test

- 대상: 순수 로직
  - 복습 스케줄 계산
  - 스트릭 계산
  - 상태 전이 유틸
  - 입력 검증 스키마
- 목표: 로직 회귀 조기 탐지

### 3.2 Integration Test

- 대상: 데이터 + 서비스 조합
  - DayPlan 완료 시 ReviewTask 생성
  - Review 제출 시 다음 stage 생성
  - SpeechAttempt 저장 후 점수 기록 매핑
  - API 에러 포맷 일관성

### 3.3 E2E Test

- 대상: 사용자 흐름 전체
  - 온보딩 -> Today 완료
  - Inbox 복습 처리
  - History 확인 및 복귀
  - Settings 변경 반영
  - 오프라인/권한 거부 예외

---

## 4) 테스트 환경

- `local`: 개발자 로컬
- `staging`: 릴리즈 전 통합 검증
- `release-candidate`: 스토어 제출 직전 빌드 검증

환경 원칙:
- 테스트 데이터는 프로덕션 데이터와 분리
- 시계/타임존 제어 가능한 테스트 훅 제공

---

## 5) 디바이스/플랫폼 매트릭스

최소 검증 조합(릴리즈 전 필수):

- iOS: 최신-1, 최신
- iPadOS: 최신
- Android: LTS 범위 내 2개 버전 이상

검증 항목:
- 권한 플로우(알림/마이크)
- 오디오 저장/재생
- 오프라인 모드
- 앱 업데이트 후 데이터 유지

---

## 6) 기능별 테스트 매트릭스

### 6.1 Today / DayPlan

- 목표:
  - `daily_target(3~5)` 정확 반영
  - PlanItem 단계 완료 조건 충족 시 완료 처리
- 핵심 케이스:
  - 첫 진입, 이어하기, 완료 후 전이(Inbox)

### 6.2 Inbox / Review

- 목표:
  - overdue 우선 정렬 검증
  - `D1 -> D3 -> D7` 전이 검증
- 핵심 케이스:
  - success/hard/fail 제출 결과 분기

### 6.3 History / Streak

- 목표:
  - 날짜별 이력 정확 표시
  - 스트릭 증가/리셋/중복 방지

### 6.4 Settings

- 목표:
  - 설정 저장/복원
  - `daily_target` 다음 DayPlan 반영
  - 권한 미허용 시 대체 안내

### 6.5 AI

- 단어 생성:
  - JSON 스키마 준수
  - 항목 수/중복/금칙 검증
- 문장 코칭:
  - 피드백 구조/길이/톤
  - invalid input fallback

### 6.6 Audio / Pronunciation

- 녹음:
  - 권한 상태별 플로우
  - 저장/재생/삭제/복원
- 점수:
  - 0~100 범위, 버전 기록
  - 실패 시 점수 null + 재시도

### 6.7 API / Security

- 에러 envelope 규약
- 멱등성(`X-Request-Id`) 재요청 검증
- 401/403/429 처리
- 민감 로그 차단

---

## 7) 핵심 테스트 케이스(우선순위 P0)

### P0-01 온보딩 후 첫 학습 완료

- 전제: 신규 사용자
- 절차: 온보딩 -> Today 학습 3개 완료
- 기대: DayPlan `completed`, ReviewTask 생성

### P0-02 복습 단계 전이

- 전제: D1 queued 항목 존재
- 절차: 리뷰 success 제출
- 기대: D1 done + D3 queued 생성

### P0-03 overdue 우선 노출

- 전제: overdue 2개, due today 3개
- 절차: Inbox 진입
- 기대: overdue가 상단 정렬

### P0-04 스트릭 중복 증가 방지

- 전제: 같은 날짜 DayPlan 완료 처리 2회 시도
- 절차: complete API 재호출
- 기대: current_streak 1회만 증가

### P0-05 오프라인 학습 복원

- 전제: 네트워크 차단
- 절차: Today 일부 진행 -> 앱 재실행
- 기대: 진행 상태 복원, 데이터 유실 없음

### P0-06 마이크 권한 거부 대체 흐름

- 전제: 마이크 denied
- 절차: 발화 단계 진입
- 기대: 권한 안내 + 학습 흐름 지속 가능

### P0-07 AI 생성 실패 fallback

- 전제: AI upstream 에러 시뮬레이션
- 절차: 단어 생성 요청
- 기대: 표준 에러 + 사용자 재시도 경로 제공

### P0-08 API 에러 포맷 검증

- 전제: validation 실패 입력
- 절차: profile PATCH 잘못된 daily_target 전송
- 기대: 400 + `VALIDATION_ERROR` + details 필드

### P0-09 SSOT 정합성 diff 체크

- 전제: 릴리즈 후보 문서/코드 동결 상태
- 절차: 정책 문서(11/12)와 데이터 모델(04), API 계약(15), 화면 스펙(05~08) 간 핵심 규칙 비교
- 기대: 상태명/필드 제약/정렬 규칙/멱등 기준 불일치 0건

---

## 8) 테스트 데이터 전략

- 사용자 유형:
  - 신규, 활성, 복귀 사용자 샘플
- 일정 데이터:
  - 정상/overdue/대량 backlog 세트
- 음성 샘플:
  - 정상/짧은/무음/노이즈 샘플
- AI 샘플:
  - 정상/제약 실패/유해 콘텐츠 필터 케이스

원칙:
- 재현 가능한 고정 시드 데이터 사용
- 케이스별 독립 데이터로 상호 오염 방지

---

## 9) 자동화 우선순위

- 1순위(반드시 자동화):
  - 복습/스트릭 계산 로직(Unit)
  - API 계약/에러 포맷(Integration)
  - P0 E2E 4개 이상(핵심 루프)
- 2순위:
  - 플랫폼 권한 플로우 E2E
  - AI 응답 스키마/가드레일 검증
- 3순위:
  - 비핵심 UI 회귀 스냅샷

---

## 10) 비기능 테스트

### 성능

- 앱 첫 화면 로드 목표(로컬 기준): 1초 내
- Today 진입 후 학습 시작 가능: 2탭 이내
- 발음 점수 응답 목표: 1.5초 내(일반 네트워크)

### 안정성

- 크래시 프리 세션 목표: 99%+
- 치명 오류(진행 불가) 0건

### 접근성

- 상태 전달: 색상 + 텍스트
- 터치 타깃 최소 44x44

---

## 11) 보안 테스트

- 키/토큰 로그 노출 차단
- HTTPS 강제 및 평문 요청 차단
- 권한 없는 API 접근(401/403) 검증
- 민감 데이터(문장/오디오) 로그 마스킹 검증
- 멱등성 악용(중복 POST) 방지 검증

---

## 12) 회귀 테스트 정책

- 트리거:
  - 복습/스트릭/AI/오디오 관련 코드 변경
  - API 계약 변경
  - 스토어 제출 직전 RC 빌드
- 최소 회귀 세트:
  - P0 전체 + 플랫폼 스모크

---

## 13) 결함 분류/우선순위

- `Blocker`: 핵심 플로우 진행 불가, 데이터 유실, 보안 사고 가능
- `Critical`: 주요 기능 실패, 우회 어려움
- `Major`: 기능 저하, 우회 가능
- `Minor`: UI/카피 경미 이슈

릴리즈 정책:
- Blocker/Critical 미해결 시 출시 금지

---

## 14) 품질 게이트(Go/No-Go)

출시 전 모두 충족:

1. P0 테스트 100% pass
2. Blocker/Critical open 이슈 0건
3. 7일 시뮬레이션에서 복습/스트릭 불일치 0건
4. 오프라인 복원/권한 거부 플로우 pass
5. 보안 체크(키/민감 로그) pass

하나라도 실패하면 No-Go.

---

## 15) 실행 책임/리포팅

- QA 리드: 테스트 범위/결과 취합
- 기능 담당 개발자: 실패 케이스 수정/재검증
- 릴리즈 오너: 최종 Go/No-Go 결정

리포팅 산출물:
- 테스트 결과 요약
- 미해결 결함 목록
- 리스크/완화 계획

---

## 16) 변경 관리

- 정책/스펙 변경 시:
  1. 해당 SSOT 문서 수정
  2. 테스트 케이스 업데이트
  3. 자동화/수동 테스트 재실행

문서 변경 없이 테스트만 수정하는 것은 금지한다.

---

## 17) 관련 문서

- 제품 비전: `01_PRODUCT_VISION.md`
- MVP 범위: `02_MVP_SCOPE.md`
- 사용자 플로우: `03_USER_FLOWS.md`
- 데이터 모델: `04_DATA_MODEL.md`
- 화면 스펙: `05_SCREEN_SPEC_TODAY.md` ~ `08_SCREEN_SPEC_SETTINGS.md`
- AI 프롬프트: `09_AI_WORD_GENERATION_PROMPT.md`, `10_AI_SENTENCE_COACH_PROMPT.md`
- 복습/스트릭: `11_SPACED_REVIEW_POLICY.md`, `12_STREAK_RULES.md`
- 오디오/발음: `13_AUDIO_RECORDING_SPEC.md`, `14_PRONUNCIATION_SCORING_SPEC.md`
- API/보안: `15_API_CONTRACT.md`, `16_SECURITY_PRIVACY_KEYS.md`
- 플랫폼/릴리즈: `18_PLATFORM_PACKAGING.md`, `20_RELEASE_CHECKLIST.md`
