# TinyWords

`docs/`의 SSOT 문서를 기준으로 구성한 TinyWords 프로젝트 골격이다.

## 구조

- `src/app`: 화면 단위 모듈 (Today/Inbox/History/Settings)
- `src/domain`: 학습/복습/스트릭/발화 도메인 규칙
- `src/api`: API 계약 타입 및 클라이언트 인터페이스
- `src/ai`: AI 생성/코칭 프롬프트 인터페이스
- `src/security`: 키/개인정보 정책 가드
- `src/platform`: 멀티플랫폼 패키징 정책
- `server/src/routes`: API 라우트 스켈레톤
- `tests`: unit/integration/e2e 테스트 디렉토리
- `scripts/release`: 릴리즈 체크리스트 운용 스크립트 위치

## 실행 방법

1. 의존성 설치

```bash
npm install
```

2. 개발 서버 실행

```bash
npm run dev
```

기본 주소: `http://localhost:8080`

3. 테스트 실행

```bash
npm test
```

## 현재 동작 API (MVP 인메모리)

- `GET /health`
- `GET /api/v1/users/me/profile`
- `PATCH /api/v1/users/me/profile`
- `GET /api/v1/day-plans/today?create_if_missing=true`
- `PATCH /api/v1/day-plans/:planId/items/:planItemId`
- `POST /api/v1/day-plans/:planId/complete`
- `GET /api/v1/reviews/queue`
- `POST /api/v1/reviews/:reviewId/submit`
- `POST /api/v1/ai/word-generation`
- `POST /api/v1/ai/sentence-coach`
- `POST /api/v1/speech-attempts`
- `PATCH /api/v1/speech/:speechId/score`

## SSOT 우선순위

실제 구현 전 `docs/SSOT.md`를 기준으로 아래 문서를 반드시 확인한다.

- 화면: `05~08`
- 정책: `11`, `12`
- 음성/발음: `13`, `14`
- API: `15`
- 보안: `16`
- UI: `17`
- 패키징: `18`
- 테스트/릴리즈: `19`, `20`
