# 23 SCREEN SPEC ONBOARDING

이 문서는 TinyWords의 온보딩 화면 스펙을 정의한다.  
온보딩은 첫 가입/로그인 사용자가 자신에게 맞는 학습 설정을 선택하도록 안내하며, 4단계로 구성된다.

---

## 1) 화면 목적

- 새 사용자에게 TinyWords의 핵심 가치(회상 중심, 소량 학습, 자동 복습)를 빠르게 전달한다.
- 기본값이 아닌, 사용자가 직접 선택한 학습 설정으로 첫 학습을 시작하게 한다.
- 온보딩은 **30-60초 내 완료** 가능한 가벼운 경험을 지향한다.

---

## 2) 진입 조건 / 종료 조건

### 진입 조건

- 가입 후 첫 로그인 또는 이메일 인증 완료 후 첫 진입
- `user_profiles.onboarding_completed = false`인 경우

### 종료 조건

- 4단계 완료 → `onboarding_completed = true` 저장 → 메인 앱(홈 탭)으로 진입

---

## 3) 데이터 의존성

### 읽기

- `user_profiles.onboarding_completed` (온보딩 표시 여부 판단)

### 쓰기

- `user_profiles.level` — 사용자 선택 CEFR 레벨
- `user_profiles.learning_focus` — 학습 목적
- `user_profiles.daily_target` — 하루 학습량
- `user_profiles.onboarding_completed` — `true`로 업데이트
- `activity_events` — `onboarding_completed` 이벤트 기록

---

## 4) 화면 구조 (4단계)

### Step 1: 환영 + 핵심 가치 소개

- TinyWords 브랜드 아이콘 + 타이틀
- 핵심 태그라인: "매일 3-5개, 확실하게 내 것으로."
- 3가지 핵심 기능 소개:
  - 🧠 회상 중심 학습
  - ✍️ 문장으로 연결
  - 🔁 자동 복습
- CTA: "시작하기"

### Step 2: 영어 수준 선택

- 라벨: "STEP 1/3"
- 질문: "현재 영어 수준은 어느 정도인가요?"
- 보조 텍스트: "수준에 맞는 단어를 AI가 추천해드려요."
- 선택지 (카드형, 단일 선택):
  - A1 — 완전 초보 / "apple, book 같은 기본 단어부터"
  - A2 — 기초 (기본 선택) / "일상 표현은 어느 정도 알아요"
  - B1 — 중급 / "간단한 대화는 가능해요"
  - B2 — 중상급 / "뉴스, 업무 영어도 이해해요"

### Step 3: 학습 목적 선택

- 라벨: "STEP 2/3"
- 질문: "어떤 상황에서 영어를 쓰고 싶나요?"
- 보조 텍스트: "상황에 맞는 단어를 우선 추천해드려요."
- 선택지:
  - ✈️ 여행 (기본 선택)
  - 💼 업무
  - 📖 시험
  - 🌍 일상

### Step 4: 하루 학습량 선택

- 라벨: "STEP 3/3"
- 질문: "하루에 몇 개 단어를 학습할까요?"
- 보조 텍스트: "처음이라면 3개부터 시작하는 걸 추천해요."
- 선택지:
  - 3개 / "약 3-5분 · 가볍게 시작" (기본 선택)
  - 4개 / "약 5-7분 · 적당한 속도"
  - 5개 / "약 7-10분 · 빠르게 쌓기"
- 하단 안내: "나중에 Settings에서 언제든 변경할 수 있어요."
- CTA: "첫 학습 시작하기"

---

## 5) 상태 정의

### 온보딩 상태

- `step_1`: 환영 화면 표시 중
- `step_2`: 수준 선택 중
- `step_3`: 목적 선택 중
- `step_4`: 학습량 선택 중
- `completing`: 서버에 설정 저장 중
- `done`: 온보딩 완료, 메인 앱으로 전환

### 선택 상태 (클라이언트 메모리)

- `level`: 기본 "A2"
- `learningFocus`: 기본 "travel"
- `dailyTarget`: 기본 3

---

## 6) 인터랙션 규칙

### 네비게이션

- Step 1에는 "이전" 버튼 없음 (첫 화면)
- Step 2-4에는 "이전" / "다음" 버튼 제공
- 뒤로가기 시 이전 선택값 유지
- 프로그레스 도트로 현재 위치 시각화 (4개 도트)

### 선택

- 각 단계에서 기본 선택값이 존재 (선택 없이 "다음" 가능)
- 카드 클릭 시 즉시 선택 변경 (선택형 하이라이트)
- 저장은 Step 4 완료 시 한 번에 서버로 전송

### 완료

- "첫 학습 시작하기" 클릭 → 버튼 비활성화 + 텍스트 "준비 중..."
- 서버 저장 성공 → 메인 앱 진입 + 환영 토스트
- 서버 저장 실패 → 버튼 복원 + 실패 토스트

---

## 7) API 엔드포인트

### POST /api/v1/users/me/onboarding/complete

**요청:**

```json
{
  "level": "A2",
  "learning_focus": "travel",
  "daily_target": 3
}
```

**응답:**

```json
{
  "data": {
    "onboarding_completed": true,
    "profile": {
      "level": "A2",
      "learning_focus": "travel",
      "daily_target": 3
    }
  }
}
```

---

## 8) 예외 처리

### 온보딩 중 앱 종료

- `onboarding_completed = false` 유지
- 다음 로그인 시 Step 1부터 재시작

### 서버 저장 실패

- 실패 토스트: "설정 저장에 실패했어요. 다시 시도해주세요."
- 버튼 복원, 재시도 가능

---

## 9) 분석 이벤트

- `onboarding_completed`
  - props: `level`, `learning_focus`, `daily_target`

---

## 10) 수용 기준(DoD)

1. `onboarding_completed = false`인 사용자는 로그인 후 온보딩 화면으로 진입한다.
2. 4단계를 모두 완료하면 선택값이 서버에 저장되고 메인 앱으로 진입한다.
3. 기존 사용자(`onboarding_completed = true`)는 온보딩을 건너뛴다.
4. 온보딩 중 앱 종료 후 재진입 시 온보딩이 다시 표시된다.
5. UI는 `17_UI_STYLE_NOTEBOOK_THEME.md`의 톤/컴포넌트 규칙을 준수한다.

---

## 11) 관련 문서

- 사용자 플로우: `03_USER_FLOWS.md`
- 데이터 모델: `04_DATA_MODEL.md`
- Settings 스펙: `08_SCREEN_SPEC_SETTINGS.md`
- Auth 스펙: `22_AUTH_SPEC.md`
- UI 스타일: `17_UI_STYLE_NOTEBOOK_THEME.md`
