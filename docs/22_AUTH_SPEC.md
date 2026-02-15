# 22 AUTH SPEC

이 문서는 TinyWords의 회원가입(Signup) 및 로그인(Login) 구현 SSOT이다.  
인증 전략, 플로우, 토큰 관리, API 변경, 프론트엔드 통합, 마이그레이션 계획을 정의한다.

---

## 1) 현재 상태 분석

### 1.1 문제점

- 서버에 인증 미들웨어 없음 — 모든 API가 인증 없이 접근 가능
- 사용자 식별자가 `"user-1"`로 하드코딩
- 인메모리 저장소 — 서버 재시작 시 데이터 소실
- 멀티 사용자 지원 불가

### 1.2 기존 정책과의 정합

기존 SSOT 문서에서 이미 결정된 인증 관련 사항:

- `15_API_CONTRACT.md §1.2`: `Authorization: Bearer <token>` 방식
- `16_SECURITY_PRIVACY_KEYS.md §4`: Bearer 토큰 기반, 짧은 access token + 갱신 토큰 전략
- `16_SECURITY_PRIVACY_KEYS.md §4`: 웹은 HttpOnly Secure 쿠키 우선
- `16_SECURITY_PRIVACY_KEYS.md §4`: 로그아웃 시 로컬 토큰 즉시 파기

---

## 2) 인증 전략 결정

### 2.1 선택: Supabase Auth

| 기준 | Supabase Auth | Firebase Auth | 자체 구현(JWT) |
|---|---|---|---|
| MVP 속도 | 빠름 | 빠름 | 느림 |
| 이메일/비밀번호 | 내장 | 내장 | 직접 구현 |
| 소셜 로그인 | 내장(Google, Apple 등) | 내장 | 직접 구현 |
| JWT 기반 | O (Bearer 토큰 호환) | O (Firebase ID Token) | O |
| DB 통합 | PostgreSQL 내장 (RLS) | Firestore 별도 | 별도 DB 필요 |
| 오프라인 우선 호환 | 양호 | 양호 | 직접 설계 |
| 비용(MVP) | 무료 티어 충분 | 무료 티어 충분 | 인프라 비용 |
| 한글 지원 | 양호 | 양호 | 해당 없음 |

**결정 근거:**

1. **Bearer 토큰 호환**: Supabase Auth는 JWT 발급 — 기존 `Authorization: Bearer <token>` 정책과 즉시 호환
2. **DB 번들**: 인메모리 → Supabase PostgreSQL 전환 시 인증과 데이터를 한 곳에서 관리 가능
3. **RLS(Row Level Security)**: 사용자별 데이터 격리를 DB 레벨에서 보장
4. **MVP 속도**: 이메일/비밀번호, 소셜 로그인을 별도 구현 없이 즉시 사용
5. **클라이언트 SDK**: 바닐라 JS에서도 `@supabase/supabase-js`로 간단히 통합

### 2.2 MVP 인증 수단

| 단계 | 인증 수단 | 우선순위 |
|---|---|---|
| MVP 1차 | 이메일 + 비밀번호 | Must |
| MVP 1차 | Google OAuth | Must |
| MVP 2차 | Apple Sign In | Should (iOS 배포 시 필수) |
| 후순위 | 카카오/네이버 | Won't (MVP) |

---

## 3) 회원가입(Signup) 플로우

### 3.1 이메일 + 비밀번호 가입

```
[사용자] 가입 화면 진입
  ↓
[사용자] 이메일, 비밀번호 입력
  ↓
[클라이언트] 입력값 검증 (프론트 1차)
  ↓
[클라이언트] supabase.auth.signUp({ email, password })
  ↓
[Supabase] 이메일 중복 확인 → 계정 생성 → 확인 이메일 발송
  ↓
[사용자] 이메일 확인 링크 클릭
  ↓
[Supabase] 이메일 인증 완료 → JWT(access_token + refresh_token) 발급
  ↓
[클라이언트] 토큰 저장 → 온보딩/Today 화면 이동
  ↓
[서버] 첫 API 호출 시 UserProfile 자동 생성 (default 설정 적용)
```

### 3.2 Google OAuth 가입

```
[사용자] "Google로 시작하기" 버튼 클릭
  ↓
[클라이언트] supabase.auth.signInWithOAuth({ provider: 'google' })
  ↓
[브라우저] Google 동의 화면 → 인증 완료
  ↓
[Supabase] OAuth 콜백 처리 → 계정 자동 생성(신규) 또는 로그인(기존) → JWT 발급
  ↓
[클라이언트] 토큰 저장 → 온보딩(신규) 또는 Today(기존) 화면 이동
```

### 3.3 입력 검증 규칙

| 필드 | 규칙 | 에러 메시지(ko) |
|---|---|---|
| 이메일 | 유효한 이메일 형식 | "올바른 이메일 주소를 입력해주세요" |
| 이메일 | 255자 이하 | "이메일이 너무 깁니다" |
| 비밀번호 | 최소 8자 | "비밀번호는 8자 이상이어야 합니다" |
| 비밀번호 | 최대 72자 (bcrypt 제한) | "비밀번호가 너무 깁니다" |
| 비밀번호 | 영문 + 숫자 포함 | "영문과 숫자를 모두 포함해주세요" |

### 3.4 에러 처리

| 상황 | 동작 |
|---|---|
| 이메일 중복 | "이미 가입된 이메일입니다. 로그인해주세요." + 로그인 화면 링크 |
| 네트워크 오류 | "인터넷 연결을 확인해주세요." + 재시도 버튼 |
| Supabase 서비스 오류 | "잠시 후 다시 시도해주세요." |
| 이메일 미확인 | "이메일 인증이 필요합니다. 메일함을 확인해주세요." + 재발송 링크 |

---

## 4) 로그인(Login) 플로우

### 4.1 이메일 + 비밀번호 로그인

```
[사용자] 로그인 화면 진입
  ↓
[사용자] 이메일, 비밀번호 입력
  ↓
[클라이언트] supabase.auth.signInWithPassword({ email, password })
  ↓
[Supabase] 인증 검증 → JWT(access_token + refresh_token) 발급
  ↓
[클라이언트] 토큰 저장 → Today 화면 이동
```

### 4.2 Google OAuth 로그인

- 회원가입과 동일한 `signInWithOAuth` 플로우
- Supabase가 기존 계정 존재 여부를 자동 판별

### 4.3 자동 로그인(세션 유지)

```
[앱 시작]
  ↓
[클라이언트] supabase.auth.getSession()
  ↓
  ├── 유효한 세션 존재 → Today 화면 직행
  ├── access_token 만료, refresh_token 유효 → 자동 갱신 → Today
  └── 세션 없음 또는 refresh_token 만료 → 로그인 화면
```

### 4.4 에러 처리

| 상황 | 동작 |
|---|---|
| 이메일/비밀번호 불일치 | "이메일 또는 비밀번호가 올바르지 않습니다." |
| 이메일 미확인 계정 | "이메일 인증이 필요합니다." + 재발송 링크 |
| 계정 잠김(rate limit) | "잠시 후 다시 시도해주세요." |
| 네트워크 오류 | 오프라인 모드로 전환 안내 (로컬 캐시 데이터 사용) |

---

## 5) 로그아웃 플로우

```
[사용자] Settings > 로그아웃 탭
  ↓
[클라이언트] supabase.auth.signOut()
  ↓
[클라이언트] 로컬 토큰 파기 + 캐시 데이터 정리
  ↓
[클라이언트] 로그인 화면 이동
```

로그아웃 시 규칙 (`16_SECURITY_PRIVACY_KEYS.md §4` 준수):
- 로컬 토큰 즉시 파기
- 학습 데이터는 로컬에 유지 (재로그인 시 복원 가능)
- 민감 데이터(문장 원문 등)는 메모리에서 제거

---

## 6) 토큰 관리

### 6.1 토큰 구조 (Supabase 발급 JWT)

| 항목 | 값 |
|---|---|
| access_token | JWT, 만료 1시간 (Supabase 기본) |
| refresh_token | opaque string, 만료 7일 |
| token_type | `bearer` |

### 6.2 토큰 저장 위치

| 플랫폼 | 저장소 | 근거 |
|---|---|---|
| 웹(MVP) | Supabase JS SDK 내장 관리 (localStorage) | SDK가 자동 갱신/저장 처리 |
| iOS/Android (향후) | OS Keychain/Keystore | `16_SECURITY_PRIVACY_KEYS.md §4` |

> **참고**: MVP 단계에서는 Supabase JS SDK의 기본 토큰 관리를 사용한다.  
> HttpOnly 쿠키 전환은 프로덕션 보안 강화 단계에서 SSR 도입과 함께 검토한다.

### 6.3 토큰 갱신

- Supabase JS SDK가 access_token 만료 전 자동 갱신
- refresh_token 만료 시 로그인 화면으로 리다이렉트
- 갱신 실패 시 3회 재시도 후 로그아웃 처리

---

## 7) 서버 인증 미들웨어

### 7.1 인증 검증 흐름

```
[요청 수신]
  ↓
[미들웨어] Authorization 헤더에서 Bearer 토큰 추출
  ↓
  ├── 토큰 없음 → 401 UNAUTHORIZED 반환
  ↓
[미들웨어] Supabase Admin SDK로 JWT 검증
  ↓
  ├── 검증 실패 (만료/위변조) → 401 UNAUTHORIZED 반환
  ↓
[미들웨어] JWT payload에서 user_id(sub) 추출
  ↓
[미들웨어] RequestContext에 userId 주입
  ↓
[라우트 핸들러] ctx.userId로 사용자 식별
```

### 7.2 인증 제외 엔드포인트

| 엔드포인트 | 이유 |
|---|---|
| `GET /health` | 시스템 상태 확인 |
| `OPTIONS *` | CORS preflight |
| `GET /` , `/app.js`, `/styles.css`, `/i18n.js` | 정적 파일 |
| `GET /i18n/{locale}.json` | 정적 i18n 리소스 |

나머지 `/api/v1/*` 엔드포인트는 모두 인증 필수.

### 7.3 RequestContext 확장

기존:

```typescript
interface RequestContext {
  requestId: string;
  nowIso: string;
  today: string;
}
```

변경 후:

```typescript
interface RequestContext {
  requestId: string;
  nowIso: string;
  today: string;
  userId: string;      // Supabase user UUID (JWT sub claim)
  userEmail?: string;   // JWT email claim (로그/감사용)
}
```

---

## 8) API 변경 사항

### 8.1 신규 엔드포인트

인증 자체는 Supabase 클라이언트 SDK가 직접 처리하므로, 서버에 별도 signup/login API를 만들지 않는다.

단, 다음 엔드포인트를 추가한다:

#### `POST /api/v1/auth/initialize`

**목적**: 첫 로그인 후 UserProfile 초기 생성 및 온보딩 상태 확인

요청:

```json
{
  "timezone": "Asia/Seoul"
}
```

응답 (신규 사용자):

```json
{
  "data": {
    "user_id": "uuid",
    "is_new_user": true,
    "profile": {
      "daily_target": 3,
      "level": null,
      "learning_focus": null,
      "reminder_enabled": false
    }
  },
  "meta": { "request_id": "...", "timestamp": "..." }
}
```

응답 (기존 사용자):

```json
{
  "data": {
    "user_id": "uuid",
    "is_new_user": false,
    "profile": { "..." }
  },
  "meta": { "request_id": "...", "timestamp": "..." }
}
```

### 8.2 기존 엔드포인트 변경

- 모든 `/api/v1/*` 엔드포인트에 인증 미들웨어 적용
- `user_id`를 URL/바디가 아닌 JWT에서 추출 (기존 하드코딩 제거)
- `GET /users/me/profile` → JWT에서 추출한 userId 기반 조회

### 8.3 에러 응답 추가

```json
{
  "error": {
    "code": "UNAUTHORIZED",
    "message": "Authentication required"
  },
  "meta": { "request_id": "...", "timestamp": "..." }
}
```

---

## 9) 프론트엔드 통합

### 9.1 Supabase 클라이언트 초기화

```javascript
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  SUPABASE_URL,      // 환경변수
  SUPABASE_ANON_KEY  // 공개 키 (클라이언트 안전)
);
```

> `SUPABASE_ANON_KEY`는 공개 키이며 RLS가 보안을 담당한다.  
> `SUPABASE_SERVICE_ROLE_KEY`는 서버에서만 사용하며 클라이언트에 절대 노출 금지.

### 9.2 화면 구조 변경

```
[앱 시작]
  ↓
  ├── 세션 있음 → 기존 화면 (Today/Inbox/History/Settings)
  └── 세션 없음 → Auth 화면 (로그인/회원가입)
```

신규 화면:

| 화면 | 설명 |
|---|---|
| Auth Landing | "시작하기" — 로그인/가입 선택 |
| Login | 이메일+비밀번호 입력, Google 버튼 |
| Signup | 이메일+비밀번호 입력, Google 버튼 |
| Email Verification | 이메일 확인 안내 |
| Password Reset | 비밀번호 재설정 요청 |

### 9.3 API 호출 시 토큰 주입

```javascript
async function apiCall(method, path, body) {
  const { data: { session } } = await supabase.auth.getSession();

  if (!session) {
    // 로그인 화면으로 리다이렉트
    return;
  }

  const response = await fetch(`/api/v1${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${session.access_token}`,
      'X-Request-Id': crypto.randomUUID(),
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  if (response.status === 401) {
    // 토큰 갱신 시도 → 실패 시 로그인 화면
    await supabase.auth.refreshSession();
    // 재시도 또는 로그인 리다이렉트
  }

  return response.json();
}
```

### 9.4 Auth 상태 리스너

```javascript
supabase.auth.onAuthStateChange((event, session) => {
  switch (event) {
    case 'SIGNED_IN':
      // initialize API 호출 → 메인 화면 이동
      break;
    case 'SIGNED_OUT':
      // 로그인 화면 이동
      break;
    case 'TOKEN_REFRESHED':
      // 정상 — 아무 동작 불필요
      break;
    case 'USER_UPDATED':
      // 프로필 갱신 반영
      break;
  }
});
```

---

## 10) 환경 변수 추가

### 10.1 클라이언트 (공개 가능)

```env
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=eyJ...  # 공개 키 (RLS로 보호)
```

### 10.2 서버 (비공개)

```env
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJ...  # 서버 전용, 절대 클라이언트 노출 금지
```

### 10.3 `.env.example` 업데이트

```env
APP_ENV=dev
API_BASE_URL=http://localhost:8080/api/v1
APP_VERSION=0.1.0
TIMEZONE=Asia/Seoul
OPENAI_API_KEY=sk-your-openai-api-key-here
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=your-supabase-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-supabase-service-role-key
```

---

## 11) 데이터 모델 변경

### 11.1 Supabase auth.users 연동

Supabase Auth는 `auth.users` 테이블을 자동 관리한다.  
TinyWords의 `UserProfile`은 `auth.users.id`를 외래 키로 참조한다.

### 11.2 UserProfile 변경

기존 `user_id`(하드코딩 문자열) → Supabase `auth.users.id` (UUID) 연결.

```sql
-- Supabase에서 UserProfile 테이블 생성 예시
CREATE TABLE public.user_profiles (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  daily_target INT NOT NULL DEFAULT 3 CHECK (daily_target BETWEEN 3 AND 5),
  level TEXT,
  learning_focus TEXT,
  reminder_enabled BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- RLS 정책: 본인 데이터만 접근
ALTER TABLE public.user_profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own profile"
  ON public.user_profiles FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can update own profile"
  ON public.user_profiles FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own profile"
  ON public.user_profiles FOR INSERT
  WITH CHECK (auth.uid() = user_id);
```

### 11.3 기타 테이블 RLS 패턴

모든 사용자 데이터 테이블에 동일한 RLS 패턴 적용:

```sql
-- 예: day_plans
ALTER TABLE public.day_plans ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can access own day plans"
  ON public.day_plans FOR ALL
  USING (auth.uid() = user_id);
```

---

## 12) 비밀번호 재설정

### 12.1 플로우

```
[사용자] "비밀번호를 잊으셨나요?" 클릭
  ↓
[사용자] 이메일 입력
  ↓
[클라이언트] supabase.auth.resetPasswordForEmail(email)
  ↓
[Supabase] 비밀번호 재설정 이메일 발송
  ↓
[사용자] 이메일의 링크 클릭
  ↓
[브라우저] 재설정 화면으로 이동
  ↓
[사용자] 새 비밀번호 입력
  ↓
[클라이언트] supabase.auth.updateUser({ password: newPassword })
  ↓
[완료] 로그인 화면 이동
```

### 12.2 보안 규칙

- 재설정 링크 유효기간: 1시간 (Supabase 기본)
- 존재하지 않는 이메일에도 동일 응답 ("이메일을 확인해주세요") — 이메일 열거 방지

---

## 13) 오프라인 대응

### 13.1 원칙

`SSOT.md §6` "오프라인 우선" 정책 준수:

- 이미 로그인된 상태에서 오프라인이 되어도 학습 가능
- access_token 만료 + 오프라인 → 로컬 캐시 데이터로 학습 지속
- 온라인 복귀 시 자동 토큰 갱신 + 데이터 동기화

### 13.2 오프라인 시 동작

| 상황 | 동작 |
|---|---|
| 토큰 유효 + 오프라인 | 로컬 데이터로 학습, API 호출은 큐잉 |
| 토큰 만료 + 오프라인 | 로컬 데이터로 학습 (읽기), 쓰기는 큐잉 |
| 세션 없음 + 오프라인 | 로그인 불가 안내 |

---

## 14) UI/UX 가이드라인

### 14.1 디자인 원칙

`17_UI_STYLE_NOTEBOOK_THEME.md`의 수첩 톤을 유지한다:

- 과도한 장식 없이 깔끔한 입력 폼
- 에러 메시지는 부드럽고 행동 중심 ("~해주세요")
- 소셜 로그인 버튼은 각 브랜드 가이드라인 준수
- 로딩 상태는 간결한 스피너 또는 스켈레톤

### 14.2 Auth 화면 레이아웃

```
┌─────────────────────────────┐
│                             │
│        TinyWords 로고       │
│    "하루 조금씩, 내 것으로"   │
│                             │
│  ┌───────────────────────┐  │
│  │  이메일               │  │
│  └───────────────────────┘  │
│  ┌───────────────────────┐  │
│  │  비밀번호             │  │
│  └───────────────────────┘  │
│                             │
│  [       로그인        ]    │
│                             │
│  ─── 또는 ───              │
│                             │
│  [  G  Google로 계속  ]     │
│                             │
│  비밀번호를 잊으셨나요?      │
│  계정이 없으신가요? 가입하기  │
│                             │
└─────────────────────────────┘
```

---

## 15) 구현 단계

### Phase 1: Supabase 프로젝트 설정

1. Supabase 프로젝트 생성
2. 환경 변수 설정 (`.env.development`, `.env.example`)
3. `@supabase/supabase-js` 의존성 추가 (클라이언트)
4. `@supabase/supabase-js` 의존성 추가 (서버 — admin 용)

### Phase 2: 서버 인증 미들웨어

1. `server/src/auth.ts` — JWT 검증 미들웨어 구현
2. `server/src/http.ts` — 인증 미들웨어 적용
3. `RequestContext`에 `userId` 추가
4. 기존 `"user-1"` 하드코딩 제거
5. `POST /api/v1/auth/initialize` 엔드포인트 추가

### Phase 3: 프론트엔드 인증 UI

1. `web/auth.js` — Supabase 클라이언트 초기화 + Auth 유틸리티
2. `web/index.html` — Auth 화면 (로그인/가입) 추가
3. `web/app.js` — 세션 기반 라우팅 (Auth ↔ Main)
4. API 호출에 Bearer 토큰 자동 주입
5. 401 응답 시 자동 갱신/리다이렉트

### Phase 4: 데이터 마이그레이션 (인메모리 → Supabase DB)

1. Supabase에 테이블 생성 (04_DATA_MODEL.md 기반)
2. RLS 정책 적용
3. 서버 store.ts → Supabase 클라이언트 전환
4. 기존 인메모리 로직 제거

### Phase 5: 테스트 및 검증

1. 회원가입 → 이메일 확인 → 로그인 E2E 테스트
2. Google OAuth 플로우 테스트
3. 토큰 만료/갱신 시나리오 테스트
4. 인증 없는 API 접근 차단 테스트
5. 오프라인 전환 시 학습 유지 테스트

---

## 16) 의존성 추가

### 16.1 패키지

```json
{
  "dependencies": {
    "@supabase/supabase-js": "^2.x"
  }
}
```

### 16.2 CDN (바닐라 JS 프론트엔드 대안)

MVP에서 빌드 도구 없이 바닐라 JS를 사용하는 경우:

```html
<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.min.js"></script>
```

또는 ES 모듈:

```html
<script type="module">
  import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
</script>
```

---

## 17) 보안 체크리스트

- [ ] `SUPABASE_SERVICE_ROLE_KEY`가 클라이언트 코드/번들에 포함되지 않음
- [ ] `SUPABASE_ANON_KEY`만 클라이언트에서 사용
- [ ] 모든 API 엔드포인트에 인증 미들웨어 적용 (제외 목록 외)
- [ ] JWT 검증 실패 시 401 반환
- [ ] RLS 정책이 모든 사용자 데이터 테이블에 적용
- [ ] 로그에 토큰/비밀번호 평문 미포함
- [ ] 로그아웃 시 로컬 토큰 즉시 파기
- [ ] 비밀번호 재설정 시 이메일 열거 방지
- [ ] HTTPS 강제 (프로덕션)

---

## 18) 테스트 기준

1. 이메일+비밀번호 가입 → 이메일 확인 → 로그인 성공
2. Google OAuth 가입/로그인 성공
3. 잘못된 비밀번호 → 에러 메시지 표시
4. 중복 이메일 가입 시도 → 에러 메시지 표시
5. 인증 없이 API 호출 → 401 반환
6. 만료된 토큰으로 API 호출 → 401 반환 → 자동 갱신 → 재요청 성공
7. 로그아웃 → 로컬 토큰 파기 확인
8. 오프라인 상태 → 기존 학습 데이터 접근 가능
9. 비밀번호 재설정 플로우 완료
10. RLS 위반 접근 차단 확인 (타인 데이터 접근 불가)

상세 케이스는 `19_TEST_PLAN.md`에서 관리한다.

---

## 19) 관련 문서

- SSOT 원칙: `SSOT.md`
- MVP 범위: `02_MVP_SCOPE.md`
- 데이터 모델: `04_DATA_MODEL.md`
- API 계약: `15_API_CONTRACT.md`
- 보안/개인정보: `16_SECURITY_PRIVACY_KEYS.md`
- UI 스타일: `17_UI_STYLE_NOTEBOOK_THEME.md`
- 테스트: `19_TEST_PLAN.md`

---

## 20) 오픈 이슈 / 결정 필요

| # | 이슈 | 상태 |
|---|---|---|
| 1 | 이메일 확인 없이 즉시 사용 허용 여부 (MVP 마찰 감소) | 미결정 |
| 2 | Apple Sign In 타이밍 (iOS 배포 전 필수) | Phase 2 이후 |
| 3 | 인메모리 → Supabase DB 전환 시점 (Auth와 동시 vs 별도) | 동시 전환 권장 |
| 4 | 계정 삭제 기능 MVP 포함 여부 (앱스토어 정책 요구) | 미결정 |
| 5 | 소셜 로그인 계정과 이메일 계정 연결(linking) 정책 | Supabase 기본 정책 따름 |
