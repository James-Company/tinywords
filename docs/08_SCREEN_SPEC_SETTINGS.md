# 08 SCREEN SPEC SETTINGS

이 문서는 TinyWords의 Settings 화면 스펙을 정의한다.  
Settings는 학습 정책(하루 목표 3-5), 알림, 발화 옵션, 데이터 관리 등 사용자 환경을 제어하며, 변경값은 로컬에 즉시 저장되고 다음 학습 사이클에 반영된다.

---

## 1) 화면 목적

- 사용자가 자신의 학습 루틴을 지속 가능하게 조정하도록 돕는다.
- 핵심 정책값(`daily_target`)을 안전하게 변경한다.
- 알림/오디오/데이터 관련 기본 제어를 제공한다.
- 보안/개인정보 관련 안내와 제어 지점을 명확히 제공한다.

---

## 2) 진입 조건 / 종료 조건

### 진입 조건

- 하단 탭 `Settings` 선택
- 권한 안내/오류 배너에서 설정 이동 CTA 선택

### 종료 조건

- 변경 완료 후 사용자 탭 이동(Today/Inbox/History)
- 백 네비게이션으로 이전 화면 복귀

---

## 3) 데이터 의존성

### 읽기

- `UserProfile` (`daily_target`, `level`, `learning_focus`, `reminder_enabled`)
- 앱 권한 상태(알림, 마이크)
- 로컬 저장소 용량/동기화 상태(표시용)

### 쓰기

- `UserProfile` 설정값 업데이트
- 로컬 앱 설정(`speech_enabled`, `reminder_time`, `theme_mode` 등)
- `ActivityEvent` (`settings_opened`, `settings_updated`, `permission_settings_opened`)

---

## 4) 화면 구조(정보 계층)

1. **상단 헤더**
   - 타이틀(`Settings`)
   - 보조 설명("내 학습 루틴 조정")

2. **학습 설정 섹션**
   - 하루 학습량(`daily_target`: 3/4/5)
   - 학습 포커스(여행/업무/시험/일반)
   - 난이도 레벨(선택형)

3. **알림 설정 섹션**
   - 리마인더 ON/OFF
   - 리마인더 시간 선택
   - 시스템 알림 권한 상태 안내

4. **발화/오디오 설정 섹션**
   - 발화 단계 사용 ON/OFF(허용 정책 범위 내)
   - 마이크 권한 상태
   - 권한 설정으로 이동 CTA

5. **데이터/개인정보 섹션**
   - 로컬 데이터 상태(마지막 동기화, 저장 용량)
   - 데이터 내보내기/초기화(확인 다이얼로그 필수)
   - 개인정보/보안 정책 문서 링크

6. **앱 정보 섹션**
   - 앱 버전
   - 문서/문의 링크

---

## 5) 컴포넌트 스펙

### 5.1 Daily Target Selector

- 입력 방식: segmented control (`3`, `4`, `5`)
- 기본값: `3`
- 저장 규칙:
  - 선택 즉시 로컬 저장
  - 같은 날짜의 기존 `DayPlan`에는 즉시 소급 적용하지 않음
  - 다음 `DayPlan` 생성부터 반영

### 5.2 Reminder Toggle + Time Picker

- `reminder_enabled=false`면 시간 선택 비활성
- 시스템 권한 거부 시:
  - 토글 변경 허용하되 안내 배너 노출
  - `시스템 설정 열기` 버튼 제공

### 5.3 Speech Option

- 마이크 권한 없으면 상태를 `제한됨`으로 표시
- 권한 미허용 상태에서도 텍스트 학습은 계속 가능해야 함
- 토글 키(로컬 설정): `speech_required_for_completion` (boolean)
- 기본값: `false` (MVP)
  - `false`: PlanItem 완료 시 `speech_status=skipped` 허용
  - `true`: PlanItem 완료에 `speech_status=done` 필요

### 5.4 Data Management Actions

- `데이터 내보내기`: 비파괴 동작
- `로컬 데이터 초기화`: 파괴 동작, 2단계 확인 필수
  - 1차: 경고 다이얼로그
  - 2차: 확인 액션(명시적 문구)

---

## 6) 상태 정의

### 6.1 화면 상태

- `loading`: 설정 로딩 중
- `ready`: 설정 표시/수정 가능
- `saving`: 특정 항목 저장 중(항목 단위 스피너)
- `error`: 저장 실패 또는 권한 조회 실패

### 6.2 항목 상태

- `synced`: 마지막 저장 성공
- `dirty`: 값 변경됨, 저장 대기(즉시 저장 실패 시)
- `blocked`: 권한/정책으로 변경 제한

---

## 7) 인터랙션 규칙

### 설정 변경

- 단순 값(`daily_target`, 토글)은 즉시 저장
- 저장 성공 시 토스트: "설정이 저장되었어요."
- 저장 실패 시 이전 값 롤백 + 재시도 CTA

### 정책 반영 시점

- `daily_target` 변경: 다음 DayPlan부터 적용
- 알림 변경: 즉시 스케줄 갱신
- 오디오 옵션 변경: 다음 학습 단계 진입 시 반영
- `speech_required_for_completion` 변경: 다음 PlanItem 완료 판정부터 즉시 반영

### 안전 장치

- 파괴 동작(초기화)은 절대 원클릭 허용 금지
- 핵심 학습을 막는 설정 조합은 경고 후 안전값 유지

---

## 8) 예외 처리

### 8.1 저장 실패

- 메시지: "설정을 저장하지 못했어요."
- 처리: 값 롤백, `다시 시도` 버튼 노출, 오류 이벤트 기록

### 8.2 권한 조회 실패

- 메시지: "권한 상태를 확인할 수 없어요."
- 처리: 기능은 보수적으로 제한하고 시스템 설정 이동 제공

### 8.3 데이터 초기화 중단/실패

- 중단 시 기존 데이터 유지
- 실패 시 부분 삭제 금지(트랜잭션 또는 원복 전략)

---

## 9) 카피 가이드

- 톤: 신뢰감 있는 설정 도우미
- 원칙:
  - 위험 동작은 명확하고 직설적으로 안내
  - 사용자가 "언제 반영되는지" 알 수 있게 표현

예시:
- 저장 성공: "다음 학습부터 이 설정이 적용돼요."
- 권한 안내: "마이크 권한이 없어도 학습은 계속할 수 있어요."
- 초기화 경고: "기록이 삭제되며 복구할 수 없어요."

---

## 10) 접근성/사용성 기준

- 모든 토글/선택 항목 터치 타깃 최소 44x44pt
- 위험 액션 버튼은 일반 액션과 시각적으로 구분
- 상태 메시지는 색상 + 텍스트 동시 제공
- 시스템 설정 이동 버튼에 명확한 접근성 라벨 제공

---

## 11) 분석 이벤트

- `settings_opened`
  - props: `entry_point(tab|permission_banner|error_cta)`
- `settings_updated`
  - props: `field_name`, `old_value`, `new_value`, `apply_timing(immediate|next_dayplan)`
- `settings_save_failed`
  - props: `field_name`, `error_type(storage|permission|unknown)`
- `permission_settings_opened`
  - props: `permission_type(notification|microphone)`
- `data_reset_confirmed`
  - props: `reset_scope(local_only|all_local_records)`

---

## 12) 수용 기준(DoD)

1. `daily_target`는 3/4/5만 선택 가능하며 저장 후 유지된다.
2. `daily_target` 변경은 다음 DayPlan 생성부터 반영된다.
3. 알림/마이크 권한 미허용 상태에서도 앱이 중단되지 않고 대체 안내가 제공된다.
4. 파괴 동작(데이터 초기화)은 2단계 확인 후에만 실행된다.
5. 저장 실패 시 값 롤백과 재시도 흐름이 정상 동작한다.
6. UI는 `17_UI_STYLE_NOTEBOOK_THEME.md`의 톤/컴포넌트 규칙을 준수한다.

---

## 13) 관련 문서

- 사용자 플로우: `03_USER_FLOWS.md`
- 데이터 모델: `04_DATA_MODEL.md`
- Today 스펙: `05_SCREEN_SPEC_TODAY.md`
- Inbox 스펙: `06_SCREEN_SPEC_INBOX.md`
- History 스펙: `07_SCREEN_SPEC_HISTORY.md`
- 복습 정책: `11_SPACED_REVIEW_POLICY.md`
- 스트릭 규칙: `12_STREAK_RULES.md`
- 보안/개인정보: `16_SECURITY_PRIVACY_KEYS.md`
- UI 스타일: `17_UI_STYLE_NOTEBOOK_THEME.md`
