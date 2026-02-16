/**
 * TinyWords Frontend
 * SSOT: docs/05~08 Screen Specs, docs/17 UI Style, docs/21 I18N, docs/22 Auth
 */
import { initI18n, setLocale, getLocale, getSupportedLocales, t, onLocaleChange } from "./i18n.js";
import {
  onAuthStateChange,
  getSession,
  authenticatedFetch,
  resolveApiUrl,
  initializeUser,
  signInWithEmail,
  signUpWithEmail,
  signInWithGoogle,
  signOut,
  deleteAccount,
  resetPassword,
  validateEmail,
  validatePassword,
  uploadAudioFile,
  getAudioSignedUrl,
  getCurrentUserId,
} from "./auth.js";

// ─── State ───
const state = {
  profile: null,
  plan: null,
  reviews: null,
  history: null,
  sentenceDrafts: {},
  sentenceFeedbacks: {},
  recordings: {},
  activeTab: "today",
  historyFilter: "all",
  expandedDays: new Set(),
  expandedCards: new Set(),
};

// ─── Timezone (auto-detect via Intl) ───
// 저장: UTC, 표시: 사용자 로컬. SSOT: docs/21_I18N_LOCALIZATION.md §6
// 브라우저 Intl API로 타임존을 자동 감지한다. 감지 실패 시 Asia/Seoul fallback.

const CLIENT_TIMEZONE = (() => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "Asia/Seoul";
  } catch {
    return "Asia/Seoul";
  }
})();

/** en-CA 로케일은 YYYY-MM-DD 형식을 반환한다 */
const _dateFmt = new Intl.DateTimeFormat("en-CA", {
  timeZone: CLIENT_TIMEZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

const _timeFmt = new Intl.DateTimeFormat("en-GB", {
  timeZone: CLIENT_TIMEZONE,
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

/** 사용자 타임존 기준 오늘 날짜(YYYY-MM-DD) */
function getLocalToday() {
  return _dateFmt.format(new Date());
}

/** UTC ISO 타임스탬프 → 사용자 타임존 기준 날짜(YYYY-MM-DD) */
function utcToLocalDate(isoString) {
  if (!isoString) return "";
  return _dateFmt.format(new Date(isoString));
}

/** UTC ISO 타임스탬프 → 사용자 타임존 기준 시각(HH:MM) */
function utcToLocalTime(isoString) {
  if (!isoString) return "";
  return _timeFmt.format(new Date(isoString));
}

// ─── API Helper (인증 토큰 자동 주입) ───
// SSOT: docs/22_AUTH_SPEC.md §9.3
async function api(path, options = {}) {
  try {
    return await authenticatedFetch(path, options);
  } catch (err) {
    if (err.message === "AUTH_REQUIRED") {
      // 인증 만료 → Auth 화면으로 전환
      showAuthScreen();
      throw err;
    }
    throw err;
  }
}

// ─── Utility ───
function escapeHtml(raw) {
  if (!raw) return "";
  return String(raw)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function showToast(msg) {
  const el = document.getElementById("toast");
  el.textContent = msg;
  el.classList.remove("hidden");
  setTimeout(() => el.classList.add("hidden"), 2500);
}

// ─── Push Notification Helpers ───

/**
 * 서비스 워커를 등록하고, 알림 권한을 요청한 뒤 푸시 구독을 생성하여 서버에 저장한다.
 * @returns {Promise<boolean>} 구독 성공 여부
 */
async function subscribePushNotifications() {
  // 브라우저 지원 확인
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
    showToast(t("settings.notification.not_supported"));
    return false;
  }

  // 알림 권한 요청
  const permission = await Notification.requestPermission();
  if (permission !== "granted") {
    showToast(t("settings.notification.permission_denied"));
    return false;
  }

  try {
    // 서비스 워커 등록
    const registration = await navigator.serviceWorker.register("/sw.js");
    await navigator.serviceWorker.ready;

    // VAPID 공개키를 config.js에서 가져오기
    const { VAPID_PUBLIC_KEY } = await import("./config.js");
    if (!VAPID_PUBLIC_KEY) {
      console.error("[push] VAPID_PUBLIC_KEY not configured");
      return false;
    }

    // urlBase64ToUint8Array 변환
    const applicationServerKey = urlBase64ToUint8Array(VAPID_PUBLIC_KEY);

    // 기존 구독이 있으면 재활용, 없으면 새로 생성
    let subscription = await registration.pushManager.getSubscription();
    if (!subscription) {
      subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey,
      });
    }

    // 서버에 구독 정보 전송
    const subJson = subscription.toJSON();
    await api("/api/v1/notifications/subscribe", {
      method: "POST",
      body: JSON.stringify({
        endpoint: subJson.endpoint,
        keys: subJson.keys,
      }),
    });

    return true;
  } catch (err) {
    console.error("[push] Subscribe error:", err);
    showToast(t("settings.notification.subscribe_fail"));
    return false;
  }
}

/**
 * 푸시 구독을 해제하고 서버에서도 제거한다.
 */
async function unsubscribePushNotifications() {
  try {
    if (!("serviceWorker" in navigator)) return;

    const registration = await navigator.serviceWorker.getRegistration();
    if (!registration) return;

    const subscription = await registration.pushManager.getSubscription();
    if (subscription) {
      // 서버에서 구독 제거
      await api("/api/v1/notifications/unsubscribe", {
        method: "POST",
        body: JSON.stringify({ endpoint: subscription.endpoint }),
      });
      // 브라우저에서도 구독 해제
      await subscription.unsubscribe();
    }
  } catch (err) {
    console.error("[push] Unsubscribe error:", err);
  }
}

/**
 * VAPID 공개키를 PushManager에서 사용하는 Uint8Array로 변환
 */
function urlBase64ToUint8Array(base64String) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

/** 버튼 클릭 시 로딩 상태를 표시하고, 작업 완료 후 복원한다. */
async function withLoading(button, asyncFn) {
  if (button.disabled) return;
  const originalText = button.textContent;
  button.disabled = true;
  button.classList.add("btn-loading");
  try {
    await asyncFn();
  } finally {
    button.disabled = false;
    button.classList.remove("btn-loading");
    button.textContent = originalText;
  }
}

function showError(msg) {
  const banner = document.getElementById("error-banner");
  banner.innerHTML = `<span>${escapeHtml(msg)}</span><button class="retry-btn" onclick="location.reload()">${escapeHtml(t("common.retry"))}</button>`;
  banner.classList.remove("hidden");
}

function hideError() {
  document.getElementById("error-banner").classList.add("hidden");
}

function showModal(title, message, actions) {
  const overlay = document.getElementById("modal-overlay");
  const content = document.getElementById("modal-content");
  content.innerHTML = `
    <h3>${escapeHtml(title)}</h3>
    <p>${escapeHtml(message)}</p>
    <div class="actions-row" id="modal-actions"></div>
  `;
  overlay.classList.remove("hidden");
  const actionsEl = document.getElementById("modal-actions");
  actions.forEach((action) => {
    const btn = document.createElement("button");
    btn.className = `btn ${action.className || "btn-secondary"}`;
    btn.textContent = action.label;
    btn.addEventListener("click", () => {
      overlay.classList.add("hidden");
      if (action.onClick) action.onClick();
    });
    actionsEl.appendChild(btn);
  });
}

/**
 * YYYY-MM-DD 로컬 날짜 문자열을 로케일에 맞게 포맷한다.
 * 브라우저 타임존에 의존하지 않고 UTC 기준으로 파싱하여 요일을 계산한다.
 */
function formatDate(dateStr) {
  if (!dateStr) return "";
  const [y, m, d] = dateStr.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  const weekday = t(`common.weekday.${date.getUTCDay()}`);
  return t("common.date_format", { month: m, day: d, weekday });
}

function itemTypeLabel(type) {
  return t(`common.item_type.${type}`) || type;
}

// ─── Tab Handling ───
function setTab(tabId) {
  state.activeTab = tabId;
  try { sessionStorage.setItem("tw_active_tab", tabId); } catch {}
  document.querySelectorAll(".tab").forEach((tab) => {
    const isActive = tab.dataset.tab === tabId;
    tab.classList.toggle("active", isActive);
    tab.setAttribute("aria-selected", isActive ? "true" : "false");
  });
  document.querySelectorAll(".panel").forEach((panel) => {
    panel.classList.toggle("hidden", panel.id !== tabId);
  });

  // Refresh data when switching tabs
  if (tabId === "today") loadTodayData();
  if (tabId === "inbox") refreshInbox();
  if (tabId === "history") refreshHistory();
  if (tabId === "settings") refreshSettings();
}

/** Update tab labels with current locale */
function updateTabLabels() {
  document.querySelectorAll(".tab").forEach((tab) => {
    const key = `common.tab.${tab.dataset.tab}`;
    tab.textContent = t(key);
  });
}

// ─── Data Loading ───

/** 빠른 데이터만 로드 (프로필 + 스트릭/히스토리) — AI 호출 없음 */
async function loadDashboardData() {
  try {
    const [profile, history] = await Promise.all([
      api("/api/v1/users/me/profile"),
      api("/api/v1/history?type=all").catch(() => null),
    ]);
    state.profile = profile;
    if (history) state.history = history;
    hideError();
  } catch (err) {
    showError(t("errors.load_data") + " " + err.message);
  }
}

/** Today 탭 전용: day plan + reviews 로드 (AI 단어 생성 포함, 느릴 수 있음) */
let todayLoaded = false;
async function loadTodayData() {
  if (todayLoaded && state.plan) return; // 이미 로드됨

  const todayEl = document.getElementById("today");
  if (todayEl && !state.plan) {
    todayEl.innerHTML = `
      <div class="loading-state">
        <div class="loading-spinner"></div>
        <p>오늘의 학습을 준비하고 있어요...</p>
      </div>
    `;
  }

  try {
    const [planRes, queueRes] = await Promise.all([
      api("/api/v1/day-plans/today?create_if_missing=true"),
      api("/api/v1/reviews/queue"),
    ]);
    state.plan = planRes;
    await restoreRecordingsFromServer(planRes);
    restoreSentencesFromServer(planRes);
    state.reviews = queueRes.tasks || [];
    todayLoaded = true;
    renderToday();
  } catch (err) {
    showError(t("errors.load_data") + " " + err.message);
  }
}

async function refreshToday() {
  try {
    const planRes = await api("/api/v1/day-plans/today?create_if_missing=true");
    state.plan = planRes;
    await restoreRecordingsFromServer(planRes);
    restoreSentencesFromServer(planRes);
    renderToday();
  } catch (err) {
    showError(t("errors.network"));
  }
}

async function refreshInbox() {
  try {
    const queue = await api("/api/v1/reviews/queue");
    state.reviews = queue.tasks || [];
    renderInbox();
  } catch (err) {
    showError(t("errors.load_reviews"));
  }
}

async function refreshHistory() {
  try {
    state.history = await api("/api/v1/history?type=" + state.historyFilter);
    renderHistory();
  } catch (err) {
    showError(t("errors.load_history"));
  }
}

async function refreshSettings() {
  try {
    state.profile = await api("/api/v1/users/me/profile");
    renderSettings();
  } catch (err) {
    showError(t("errors.load_settings"));
  }
}

// ─── Speech Attempts 복원 ───
/** 서버에서 받은 speechAttempts 데이터를 state.recordings에 복원한다 */
async function restoreRecordingsFromServer(planRes) {
  if (!planRes || !planRes.speechAttempts) return;
  const urlPromises = [];
  for (const [planItemId, attempt] of Object.entries(planRes.speechAttempts)) {
    const existing = state.recordings[planItemId];
    // 로컬에 더 최신 데이터(녹음 중이거나 blob 있음)가 있으면 덮어쓰지 않음
    if (existing && (existing.blobUrl || existing.status === "recording")) continue;
    state.recordings[planItemId] = {
      status: "saved",
      speechId: attempt.speechId,
      score: attempt.score,
      durationMs: attempt.durationMs,
      audioUri: attempt.audioUri || null,
      blobUrl: null,
      blob: null,
      mediaRecorder: null,
      chunks: [],
      startedAt: 0,
      recognition: null,
      recognizedText: "",
    };
    // Supabase Storage에서 signed URL 생성
    if (attempt.audioUri) {
      urlPromises.push(
        getAudioSignedUrl(attempt.audioUri).then((signedUrl) => {
          if (signedUrl) {
            state.recordings[planItemId] = {
              ...state.recordings[planItemId],
              blobUrl: signedUrl,
            };
          }
        })
      );
    }
  }
  await Promise.all(urlPromises);
}

// ─── Sentence Drafts 복원 ───
/** 서버에서 받은 savedSentences 데이터를 state.sentenceDrafts에 복원한다 */
function restoreSentencesFromServer(planRes) {
  if (!planRes || !planRes.savedSentences) return;
  for (const [planItemId, sentence] of Object.entries(planRes.savedSentences)) {
    // 로컬에 이미 입력 중인 문장이 있으면 덮어쓰지 않음
    if (state.sentenceDrafts[planItemId]) continue;
    state.sentenceDrafts[planItemId] = sentence;
  }
}

// ─── Streak Mini ───
function renderStreakMini() {
  const el = document.getElementById("streak-mini");
  if (!el) return;
  const streak = state.history?.streak;
  if (!streak) {
    el.textContent = "";
    return;
  }
  if (streak.current_streak_days > 0) {
    el.textContent = t("streak.mini.active", { days: streak.current_streak_days });
  } else {
    el.textContent = t("streak.mini.start");
  }
}

// ─── Today Screen (docs/05) ───
async function patchItem(itemId, patch) {
  await api(`/api/v1/day-plans/${state.plan.planId}/items/${itemId}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
  await refreshToday();
}

async function completeToday() {
  try {
    await api(`/api/v1/day-plans/${state.plan.planId}/complete`, { method: "POST" });
    await Promise.all([refreshToday(), refreshInbox()]);
    showToast(t("today.toast.completed"));
  } catch (err) {
    showToast(t("today.toast.not_ready"));
  }
}

async function requestSentenceCoach(item) {
  const sentence = (state.sentenceDrafts[item.planItemId] ?? "").trim();
  if (!sentence) {
    showToast(t("errors.sentence_empty"));
    return;
  }

  try {
    const coached = await api("/api/v1/ai/sentence-coach", {
      method: "POST",
      body: JSON.stringify({
        sentence_en: sentence,
        item_context: {
          lemma: item.lemma,
          meaning_ko: item.meaningKo,
          example_en: item.exampleEn || "",
        },
      }),
    });

    const result = coached.result || coached;
    state.sentenceFeedbacks[item.planItemId] = result;

    // "good"일 때만 완료 처리, needs_fix/retry면 수정 가능
    if (result.overall === "good") {
      await patchItem(item.planItemId, { sentenceStatus: "done", userSentence: sentence });
    } else {
      renderToday();
    }
  } catch (err) {
    showToast(t("errors.coach_fail"));
  }
}

async function startRecording(item) {
  if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
    showToast(t("errors.browser_no_recording"));
    return;
  }

  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const mediaRecorder = new MediaRecorder(stream);
    const chunks = [];
    const startedAt = Date.now();

    // Web Speech API로 음성인식 병행 (발음 점수 산출용)
    let recognition = null;
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (SpeechRecognition) {
      recognition = new SpeechRecognition();
      recognition.lang = "en-US";
      recognition.continuous = true;
      recognition.interimResults = false;
      recognition.maxAlternatives = 1;
      const transcripts = [];
      recognition.onresult = (event) => {
        for (let i = event.resultIndex; i < event.results.length; i++) {
          if (event.results[i].isFinal) {
            transcripts.push(event.results[i][0].transcript);
          }
        }
        const rec = state.recordings[item.planItemId];
        if (rec) rec.recognizedText = transcripts.join(" ");
      };
      recognition.onerror = () => {}; // 조용히 무시
      try { recognition.start(); } catch { recognition = null; }
    }

    state.recordings[item.planItemId] = {
      status: "recording",
      mediaRecorder,
      chunks,
      startedAt,
      blobUrl: null,
      durationMs: 0,
      speechId: null,
      score: null,
      recognition,
      recognizedText: "",
    };

    mediaRecorder.ondataavailable = (event) => {
      if (event.data.size > 0) chunks.push(event.data);
    };

    mediaRecorder.onstop = () => {
      const blob = new Blob(chunks, { type: "audio/webm" });
      const blobUrl = URL.createObjectURL(blob);
      const durationMs = Date.now() - startedAt;
      stream.getTracks().forEach((track) => track.stop());

      state.recordings[item.planItemId] = {
        ...state.recordings[item.planItemId],
        status: "recorded",
        blob,
        blobUrl,
        durationMs,
      };
      renderToday();
    };

    mediaRecorder.start();
    renderToday();
  } catch {
    showToast(t("errors.mic_permission"));
  }
}

function stopRecording(item) {
  const recording = state.recordings[item.planItemId];
  if (!recording || recording.status !== "recording") return;
  recording.mediaRecorder.stop();
  if (recording.recognition) {
    try { recording.recognition.stop(); } catch { /* already stopped */ }
  }
}

/**
 * 발음 점수 산출
 * 1) SpeechRecognition이 있으면: 인식된 텍스트와 기대 문장의 단어 매칭률로 산출
 * 2) SpeechRecognition이 없으면: 녹음 시간과 기대 문장 길이 비율로 근사 산출
 */
function calculatePronunciationScore(recognized, expected, durationMs, hasRecognition) {
  const expectedWords = (expected || "")
    .toLowerCase().replace(/[^\w\s]/g, "").split(/\s+/).filter((w) => w);

  if (expectedWords.length === 0) {
    // 비교 대상 문장이 없으면 보수적 점수
    return Math.max(20, Math.min(60, Math.floor(30 + Math.random() * 20)));
  }

  if (hasRecognition) {
    const recognizedWords = (recognized || "")
      .toLowerCase().replace(/[^\w\s]/g, "").split(/\s+/).filter((w) => w);

    if (recognizedWords.length === 0) {
      // 영어가 전혀 인식되지 않음 — 엉뚱한 발화 가능성 높음
      return Math.max(10, Math.min(30, Math.floor(15 + Math.random() * 10)));
    }

    // 단어 매칭률 계산
    const recognizedSet = new Set(recognizedWords);
    let matchCount = 0;
    for (const w of expectedWords) {
      if (recognizedSet.has(w)) matchCount++;
    }
    const matchRatio = matchCount / expectedWords.length;

    // 20(기본) + matchRatio * 70(최대) + 작은 랜덤 편차
    const base = 20 + Math.floor(matchRatio * 70);
    const variance = Math.floor(Math.random() * 8 - 4);
    return Math.max(10, Math.min(98, base + variance));
  }

  // SpeechRecognition 미지원 → 녹음 시간 기반 휴리스틱
  const expectedDurationMs = expectedWords.length * 500; // 단어당 ~500ms
  const ratio = durationMs / expectedDurationMs;

  if (ratio < 0.2) return Math.floor(15 + Math.random() * 10);
  if (ratio < 0.4) return Math.floor(30 + Math.random() * 10);
  if (ratio > 4.0) return Math.floor(25 + Math.random() * 10);
  if (ratio > 2.5) return Math.floor(35 + Math.random() * 15);

  // 합리적 범위 (0.4~2.5)
  return Math.floor(45 + Math.random() * 30);
}

async function saveRecording(item) {
  const recording = state.recordings[item.planItemId];
  if (!recording || !recording.blobUrl) {
    showToast(t("errors.no_recording"));
    return;
  }

  try {
    // 1) Supabase Storage에 오디오 업로드
    const userId = getCurrentUserId();
    let audioUri = `local://${item.planItemId}/${Date.now()}.webm`; // fallback

    if (userId && recording.blob) {
      const uploadResult = await uploadAudioFile(userId, item.planItemId, recording.blob);
      if (uploadResult) {
        audioUri = uploadResult.path;
      }
    }

    // 2) speech_attempts 레코드 생성
    const created = await api("/api/v1/speech-attempts", {
      method: "POST",
      body: JSON.stringify({
        plan_item_id: item.planItemId,
        audio_uri: audioUri,
        duration_ms: recording.durationMs,
      }),
    });

    // 3) 발음 점수 계산 & 저장
    const speechId = created.speech_id;
    const score = calculatePronunciationScore(
      recording.recognizedText || "",
      state.sentenceDrafts[item.planItemId] || item.exampleEn || "",
      recording.durationMs,
      !!recording.recognition,
    );
    await api(`/api/v1/speech/${speechId}/score`, {
      method: "PATCH",
      body: JSON.stringify({
        pronunciation_score: score,
        scoring_version: "tw-pron-v1",
      }),
    });

    state.recordings[item.planItemId] = {
      ...recording,
      speechId,
      score,
      status: "saved",
      audioUri,
    };

    await patchItem(item.planItemId, { speechStatus: "done" });
    showToast(t("today.toast.score", { score }));
  } catch (err) {
    showToast(t("errors.recording_save_fail"));
  }
}

function renderToday() {
  const el = document.getElementById("today");
  const plan = state.plan;
  if (!plan) {
    el.innerHTML = `
      <div class="loading-state">
        <div class="loading-spinner"></div>
        <p>${escapeHtml(t("common.loading"))}</p>
      </div>
    `;
    return;
  }

  const completedCount = plan.items.filter((i) => i.isCompleted).length;
  const total = plan.dailyTarget;
  const isCompleted = plan.status === "completed";

  // 서브태스크(암기/문장/말하기) 기반 프로그레스 바 계산
  const stepsTotal = plan.items.length * 3;
  const stepsCompleted = plan.items.reduce((sum, item) => {
    let c = 0;
    if (item.recallStatus === "success") c += 1;
    if (item.sentenceStatus === "done") c += 1;
    if (item.speechStatus === "done" || item.speechStatus === "skipped") c += 1;
    return sum + c;
  }, 0);
  const stepPercent = stepsTotal < 1 ? 0 : Math.floor((stepsCompleted / stepsTotal) * 100);
  const allItemsDone = plan.items.every((i) => i.isCompleted);

  let ctaLabel, summaryCopy;
  if (isCompleted) {
    ctaLabel = t("today.cta.completed");
    summaryCopy = t("today.summary.completed");
  } else if (completedCount === 0 && stepsCompleted === 0) {
    ctaLabel = t("today.cta.start");
    summaryCopy = t("today.summary.start", { target: total });
  } else {
    ctaLabel = t("today.cta.continue");
    summaryCopy = t("today.summary.continue");
  }

  let html = "";

  // Completion panel
  if (isCompleted) {
    html += `
      <div class="completion-panel">
        <h3>${escapeHtml(t("today.completion.title"))}</h3>
        <p>${escapeHtml(summaryCopy)}</p>
        <button class="btn btn-primary" onclick="setTab('inbox')">${escapeHtml(t("today.completion.go_inbox"))}</button>
      </div>
    `;
  }

  // Progress card
  html += `
    <div class="progress-card">
      <div class="progress-header">
        <span class="progress-label">${formatDate(plan.planDate)}</span>
        <span class="progress-count">${completedCount}/${total}</span>
      </div>
      <div class="progress-bar-outer">
        <div class="progress-bar-inner" style="width: ${isCompleted ? 100 : stepPercent}%"></div>
      </div>
      <p class="progress-copy">${escapeHtml(summaryCopy)}</p>
    </div>
  `;

  // Items
  plan.items.forEach((item, idx) => {
    const recallChip = item.recallStatus === "success"
      ? `<span class="chip chip-success">${escapeHtml(t("today.chip.recall_success"))}</span>`
      : item.recallStatus === "fail"
        ? `<span class="chip chip-fail">${escapeHtml(t("today.chip.recall_fail"))}</span>`
        : `<span class="chip chip-pending">${escapeHtml(t("today.chip.recall_pending"))}</span>`;

    const sentenceChip = item.sentenceStatus === "done"
      ? `<span class="chip chip-success">${escapeHtml(t("today.chip.sentence_done"))}</span>`
      : `<span class="chip chip-pending">${escapeHtml(t("today.chip.sentence_pending"))}</span>`;

    const speechChip = item.speechStatus === "done"
      ? `<span class="chip chip-success">${escapeHtml(t("today.chip.speech_done"))}</span>`
      : item.speechStatus === "skipped"
        ? `<span class="chip chip-pending">${escapeHtml(t("today.chip.speech_skipped"))}</span>`
        : `<span class="chip chip-pending">${escapeHtml(t("today.chip.speech_pending"))}</span>`;

    const recording = state.recordings[item.planItemId];
    const feedback = state.sentenceFeedbacks[item.planItemId];
    const learningItem = state.plan.items.find((i) => i.itemId === item.itemId) || item;

    const isExpanded = state.expandedCards.has(item.planItemId);

    html += `
      <div class="card ${isExpanded ? "card-expanded" : ""}" id="card-${item.planItemId}">
        <div class="card-header card-toggle" data-toggle-card="${item.planItemId}">
          <div class="card-header-left">
            <span class="card-title">${escapeHtml(item.lemma)}</span>
            <span class="type-badge">${itemTypeLabel(item.itemType)}</span>
            ${item.isCompleted ? `<span class="chip chip-success">${escapeHtml(t("common.complete"))}</span>` : ""}
          </div>
          <span class="card-chevron ${isExpanded ? "card-chevron-open" : ""}">▾</span>
        </div>
        <div class="meta-text">${escapeHtml(item.meaningKo)}</div>
        <div class="chips-row mt-8 mb-8">
          ${recallChip}
          ${sentenceChip}
          ${speechChip}
        </div>

        <div class="card-body ${isExpanded ? "card-body-open" : ""}">
          <div class="card-body-inner">
          ${learningItem.exampleEn ? `
          <div class="example-sentence">
            <div class="example-en">${escapeHtml(learningItem.exampleEn || `I used ${item.lemma} in my sentence.`)}</div>
            <div class="example-ko">${escapeHtml(learningItem.exampleKo || "")}</div>
          </div>
          ` : ""}

          <!-- Step 1: Recall -->
          ${!item.isCompleted ? `
          <div class="actions-row">
            <button class="btn ${item.recallStatus === "success" ? "btn-primary" : "btn-secondary"} btn-sm" data-item="${item.planItemId}" data-type="recall-success"
              ${item.recallStatus === "success" ? "disabled" : ""}>
              ${escapeHtml(t("today.recall.success"))}
            </button>
            <button class="btn ${item.recallStatus === "fail" ? "btn-primary" : "btn-secondary"} btn-sm" data-item="${item.planItemId}" data-type="recall-fail"
              ${item.recallStatus !== "pending" ? "disabled" : ""}>
              ${escapeHtml(t("today.recall.fail"))}
            </button>
          </div>
          ` : ""}

          <!-- Step 2: Sentence -->
          <div class="compose-area">
            <label class="compose-label" for="sentence-${item.planItemId}">${escapeHtml(t("today.sentence.label", { lemma: item.lemma }))}</label>
            <textarea
              id="sentence-${item.planItemId}"
              data-sentence-input="${item.planItemId}"
              placeholder="${escapeHtml(t("today.sentence.placeholder", { lemma: item.lemma }))}"
              ${item.sentenceStatus === "done" ? "disabled" : ""}
            >${escapeHtml(state.sentenceDrafts[item.planItemId] ?? "")}</textarea>
            ${item.sentenceStatus !== "done" ? `
            <div class="actions-row">
              <button class="btn btn-secondary btn-sm" data-item="${item.planItemId}" data-type="coach">${escapeHtml(t("today.sentence.coach_btn"))}</button>
            </div>
            ` : ""}
            ${feedback ? renderCoachFeedback(feedback) : ""}
          </div>

          <!-- Step 3: Speech -->
          <div class="record-area">
            <div class="record-status">
              ${recording?.status === "recording"
                ? `<div class="record-dot"></div><span>${escapeHtml(t("today.speech.recording"))}</span>`
                : recording?.status === "saved"
                  ? `<span class="meta-text">${escapeHtml(t("today.speech.recorded"))}</span>`
                  : `<span class="meta-text">${escapeHtml(t("today.speech.label"))}</span>`
              }
            </div>
            <div class="actions-row">
              ${item.speechStatus !== "done" ? `
              ${!recording || recording.status === "idle" || !recording.status
                ? `<button class="btn btn-secondary btn-sm" data-item="${item.planItemId}" data-type="record-start">${escapeHtml(t("today.speech.start"))}</button>`
                : ""
              }
              ${recording?.status === "recording"
                ? `<button class="btn btn-primary btn-sm" data-item="${item.planItemId}" data-type="record-stop">${escapeHtml(t("today.speech.stop"))}</button>`
                : ""
              }
              ${recording?.status === "recorded"
                ? `<button class="btn btn-primary btn-sm" data-item="${item.planItemId}" data-type="record-save">${escapeHtml(t("today.speech.save"))}</button>
                   <button class="btn btn-secondary btn-sm" data-item="${item.planItemId}" data-type="record-start">${escapeHtml(t("today.speech.retry"))}</button>`
                : ""
              }
              <button class="btn btn-tertiary btn-sm" data-item="${item.planItemId}" data-type="skip-speech">${escapeHtml(t("today.speech.skip"))}</button>
              ` : `
              ${recording?.status !== "recording" && recording?.status !== "recorded"
                ? `<button class="btn btn-tertiary btn-sm" data-item="${item.planItemId}" data-type="record-start">${escapeHtml(t("today.speech.retry"))}</button>`
                : ""
              }
              ${recording?.status === "recording"
                ? `<button class="btn btn-primary btn-sm" data-item="${item.planItemId}" data-type="record-stop">${escapeHtml(t("today.speech.stop"))}</button>`
                : ""
              }
              ${recording?.status === "recorded"
                ? `<button class="btn btn-primary btn-sm" data-item="${item.planItemId}" data-type="record-save">${escapeHtml(t("today.speech.save"))}</button>
                   <button class="btn btn-secondary btn-sm" data-item="${item.planItemId}" data-type="record-start">${escapeHtml(t("today.speech.retry"))}</button>`
                : ""
              }
              `}
            </div>
            ${recording?.blobUrl ? `<audio controls src="${recording.blobUrl}"></audio>` : ""}
            ${recording?.score
              ? `<div class="score-badge ${recording.score >= 80 ? "score-high" : recording.score >= 60 ? "score-mid" : "score-low"}">
                  ${escapeHtml(t("today.speech.score", { score: recording.score }))}
                </div>`
              : ""
            }
          </div>
          </div>
        </div>
      </div>
    `;
  });

  // Complete button
  if (!isCompleted) {
    html += `
      <div class="mt-16">
        <button class="btn btn-primary btn-block" id="complete-day" ${allItemsDone ? "" : "disabled"}>
          ${allItemsDone ? escapeHtml(t("today.complete_btn")) : escapeHtml(t("today.complete_btn_progress", { done: completedCount, total }))}
        </button>
      </div>
    `;
  }

  el.innerHTML = html;

  // Bind card toggle events
  el.querySelectorAll("[data-toggle-card]").forEach((header) => {
    header.addEventListener("click", (e) => {
      // Don't toggle when clicking on buttons/chips inside header
      if (e.target.closest("button")) return;
      const cardId = header.dataset.toggleCard;
      const card = document.getElementById(`card-${cardId}`);
      const body = card?.querySelector(".card-body");
      const chevron = header.querySelector(".card-chevron");
      if (!body) return;

      if (state.expandedCards.has(cardId)) {
        state.expandedCards.delete(cardId);
        body.classList.remove("card-body-open");
        chevron?.classList.remove("card-chevron-open");
        card.classList.remove("card-expanded");
      } else {
        state.expandedCards.add(cardId);
        body.classList.add("card-body-open");
        chevron?.classList.add("card-chevron-open");
        card.classList.add("card-expanded");
      }
    });
  });

  // Bind events
  el.querySelectorAll("button[data-item]").forEach((button) => {
    button.addEventListener("click", async () => {
      const itemId = button.dataset.item;
      const type = button.dataset.type;
      const item = state.plan.items.find((it) => it.planItemId === itemId);
      if (!item) return;

      // 녹음 시작/정지는 즉시 동작이므로 로딩 불필요
      if (type === "record-start") { await startRecording(item); return; }
      if (type === "record-stop") { stopRecording(item); return; }

      await withLoading(button, async () => {
        if (type === "recall-success") await patchItem(itemId, { recallStatus: "success" });
        else if (type === "recall-fail") await patchItem(itemId, { recallStatus: "fail" });
        else if (type === "coach") await requestSentenceCoach(item);
        else if (type === "record-save") await saveRecording(item);
        else if (type === "skip-speech") await patchItem(itemId, { speechStatus: "skipped" });
      });
    });
  });

  el.querySelectorAll("textarea[data-sentence-input]").forEach((input) => {
    input.addEventListener("input", (event) => {
      state.sentenceDrafts[event.target.dataset.sentenceInput] = event.target.value;
    });
  });

  const completeBtn = document.getElementById("complete-day");
  if (completeBtn) completeBtn.addEventListener("click", () => withLoading(completeBtn, completeToday));
}

function renderCoachFeedback(feedback) {
  const f = feedback;
  if (!f) return "";

  const overall = f.overall || "needs_fix";
  const feedbackKo = f.feedback_ko || f.feedback || "";
  const score = f.score ?? "";
  const highlights = f.highlights || [];
  const suggestions = f.suggestions || [];
  const nextAction = f.next_action_ko || "";

  return `
    <div class="coach-feedback">
      <div class="coach-overall ${overall}">
        ${overall === "good" ? escapeHtml(t("coach.overall.good")) : overall === "needs_fix" ? escapeHtml(t("coach.overall.needs_fix")) : escapeHtml(t("coach.overall.retry"))}
      </div>
      ${score ? `<div class="coach-score">${escapeHtml(t("coach.score", { score }))}</div>` : ""}
      <div class="coach-message">${escapeHtml(feedbackKo)}</div>
      ${highlights.map((h) => `<div class="coach-highlight">• ${escapeHtml(h.message_ko)}</div>`).join("")}
      ${suggestions.map((s) => `<div class="coach-suggestion">"${escapeHtml(s)}"</div>`).join("")}
      ${nextAction ? `<div class="coach-next-action">→ ${escapeHtml(nextAction)}</div>` : ""}
    </div>
  `;
}

// ─── Inbox Screen (docs/06) ───
async function submitReview(reviewId, result) {
  try {
    await api(`/api/v1/reviews/${reviewId}/submit`, {
      method: "POST",
      body: JSON.stringify({ result, submitted_at: new Date().toISOString() }),
    });
    await refreshInbox();

    if (result === "success") showToast(t("inbox.toast.success"));
    else if (result === "hard") showToast(t("inbox.toast.hard"));
    else showToast(t("inbox.toast.fail"));
  } catch (err) {
    showToast(t("errors.review_save_fail"));
  }
}

function renderInbox() {
  const el = document.getElementById("inbox");
  if (!state.reviews) {
    el.innerHTML = `
      <div class="loading-state">
        <div class="loading-spinner"></div>
        <p>${escapeHtml(t("common.loading"))}</p>
      </div>
    `;
    return;
  }
  const tasks = state.reviews.filter((t) => t.status === "queued");
  const today = getLocalToday();

  const overdueCount = tasks.filter((t) => t.dueDate < today).length;
  const dueTodayCount = tasks.filter((t) => t.dueDate === today).length;
  const doneTodayCount = state.reviews.filter(
    (t) => t.status === "done" && utcToLocalDate(t.completedAt) === today,
  ).length;

  let html = "";

  html += `<div class="section-title">${escapeHtml(t("inbox.title"))}</div>`;

  // Summary card
  html += `
    <div class="summary-card">
      <div class="summary-row">
        <div class="summary-item">
          <span class="summary-number ${overdueCount > 0 ? "style-warning" : ""}">${overdueCount}</span>
          <span class="summary-label">${escapeHtml(t("inbox.summary.overdue"))}</span>
        </div>
        <div class="summary-item">
          <span class="summary-number">${dueTodayCount}</span>
          <span class="summary-label">${escapeHtml(t("inbox.summary.today"))}</span>
        </div>
        <div class="summary-item">
          <span class="summary-number">${doneTodayCount}</span>
          <span class="summary-label">${escapeHtml(t("inbox.summary.done"))}</span>
        </div>
      </div>
      ${tasks.length > 0
        ? `<button class="btn btn-primary btn-block" onclick="scrollToFirstReview()">
            ${doneTodayCount > 0 ? escapeHtml(t("inbox.cta.continue")) : escapeHtml(t("inbox.cta.start"))}
          </button>`
        : ""
      }
    </div>
  `;

  if (tasks.length === 0 && doneTodayCount > 0) {
    // All done
    html += `
      <div class="completion-panel">
        <h3>${escapeHtml(t("inbox.all_done.title"))}</h3>
        <p>${escapeHtml(t("inbox.all_done.message"))}</p>
        <button class="btn btn-secondary" onclick="setTab('history')">${escapeHtml(t("inbox.all_done.go_history"))}</button>
      </div>
    `;
  } else if (tasks.length === 0) {
    // Empty
    html += `
      <div class="empty-state">
        <div class="empty-icon">📚</div>
        <p>${escapeHtml(t("inbox.empty.message"))}</p>
        <button class="btn btn-secondary" onclick="setTab('today')">${escapeHtml(t("common.go_today"))}</button>
      </div>
    `;
  } else {
    if (overdueCount >= 5) {
      html += `
        <div class="card" style="background: var(--state-warning-bg); border-color: var(--state-warning);">
          <div class="meta-text" style="color: var(--state-warning);">
            ${escapeHtml(t("inbox.overdue.message"))}
          </div>
        </div>
      `;
    } else if (tasks.length > 0) {
      html += `<p class="meta-text mb-12">${escapeHtml(t("inbox.ready.message"))}</p>`;
    }

    tasks.forEach((task) => {
      const isOverdue = task.dueDate < today;
      const planItem = state.plan?.items.find((i) => i.itemId === task.itemId);
      const lemma = planItem?.lemma || task.lemma || task.itemId;
      const meaningKo = planItem?.meaningKo || task.meaningKo || "";

      const stageLabel = task.stage === "d1" ? "D-1" : task.stage === "d3" ? "D-3" : task.stage === "d7" ? "D-7" : "Custom";
      const dueChip = isOverdue
        ? `<span class="chip chip-overdue">${escapeHtml(t("inbox.chip.overdue"))}</span>`
        : `<span class="chip chip-today">${escapeHtml(t("inbox.chip.today"))}</span>`;

      html += `
        <div class="card" id="review-${task.reviewId}">
          <div class="card-header">
            <div>
              <span class="card-title">${escapeHtml(lemma)}</span>
              <span class="chip chip-type">${stageLabel}</span>
            </div>
            ${dueChip}
          </div>
          ${meaningKo ? `<div class="meta-text mb-8">${escapeHtml(meaningKo)}</div>` : ""}
          <div class="caption mb-8">due: ${task.dueDate}</div>
          <div class="actions-row">
            <button class="btn btn-primary btn-sm" data-review="${task.reviewId}" data-result="success">${escapeHtml(t("inbox.review.remembered"))}</button>
            <button class="btn btn-secondary btn-sm" data-review="${task.reviewId}" data-result="hard">${escapeHtml(t("inbox.review.hard"))}</button>
            <button class="btn btn-secondary btn-sm" data-review="${task.reviewId}" data-result="fail">${escapeHtml(t("inbox.review.forgot"))}</button>
          </div>
        </div>
      `;
    });
  }

  el.innerHTML = html;

  el.querySelectorAll("button[data-review]").forEach((button) => {
    button.addEventListener("click", () => {
      withLoading(button, () => submitReview(button.dataset.review, button.dataset.result));
    });
  });
}

function scrollToFirstReview() {
  const first = document.querySelector("[id^='review-']");
  if (first) first.scrollIntoView({ behavior: "smooth", block: "start" });
}

// ─── History Screen (docs/07) ───
function renderHistory() {
  const el = document.getElementById("history");
  const data = state.history;

  if (!data) {
    el.innerHTML = `
      <div class="loading-state">
        <div class="loading-spinner"></div>
        <p>${escapeHtml(t("common.loading"))}</p>
      </div>
    `;
    return;
  }

  const streak = data.streak;
  const days = data.days || [];
  const hasActivity = days.some((d) => d.learning_done > 0 || d.review_done > 0);

  let html = "";

  html += `<div class="section-title">${escapeHtml(t("history.title"))}</div>`;

  // If no meaningful activity yet, show empty state
  if (!hasActivity) {
    html += `
      <div class="empty-state">
        <div class="empty-icon">📝</div>
        <p>${escapeHtml(t("history.empty.message"))}</p>
        <button class="btn btn-primary" onclick="setTab('today')">${escapeHtml(t("common.go_today"))}</button>
      </div>
    `;

    el.innerHTML = html;
    return;
  }

  // Streak summary
  html += `
    <div class="streak-summary">
      <div class="summary-item">
        <span class="streak-value">${streak.current_streak_days}</span>
        <span class="streak-label">${escapeHtml(t("history.streak.current"))}</span>
      </div>
      <div class="summary-item">
        <span class="streak-value">${streak.best_streak_days}</span>
        <span class="streak-label">${escapeHtml(t("history.streak.best"))}</span>
      </div>
    </div>
  `;

  // Streak copy
  if (streak.current_streak_days > 0) {
    html += `<p class="meta-text text-center mb-16">${escapeHtml(t("history.streak.active"))}</p>`;
  } else if (streak.last_completed_date) {
    html += `<p class="meta-text text-center mb-16">${escapeHtml(t("history.streak.restart"))}</p>`;
  }

  // Filter bar
  html += `
    <div class="filter-bar">
      <button class="filter-btn ${state.historyFilter === "all" ? "active" : ""}" data-filter="all">${escapeHtml(t("history.filter.all"))}</button>
      <button class="filter-btn ${state.historyFilter === "learning" ? "active" : ""}" data-filter="learning">${escapeHtml(t("history.filter.learning"))}</button>
      <button class="filter-btn ${state.historyFilter === "review" ? "active" : ""}" data-filter="review">${escapeHtml(t("history.filter.review"))}</button>
    </div>
  `;

  // Days
  if (days.length === 0) {
    html += `
      <div class="empty-state">
        <div class="empty-icon">📝</div>
        <p>${escapeHtml(t("history.empty.message"))}</p>
        <button class="btn btn-primary" onclick="setTab('today')">${escapeHtml(t("common.go_today"))}</button>
      </div>
    `;
  } else {
    const todayDate = getLocalToday();
    days.forEach((day) => {
      const isCompleted = day.dayplan_status === "completed";
      const isToday = day.plan_date === todayDate;
      const isExpanded = state.expandedDays.has(day.plan_date);
      const statusLabel = isCompleted
        ? t("history.day.completed")
        : day.learning_done > 0
          ? t("history.day.partial")
          : t("history.day.incomplete");
      const statusClass = isCompleted ? "chip-success" : day.learning_done > 0 ? "chip-overdue" : "chip-pending";

      let detailCaption = t("history.day.learning", { done: day.learning_done, target: day.learning_target });
      if (day.review_done > 0) detailCaption += ` · ${t("history.day.review_done", { count: day.review_done })}`;
      if (day.review_pending > 0) detailCaption += ` · ${t("history.day.review_pending", { count: day.review_pending })}`;

      html += `
        <div class="day-section">
          <div class="day-header" data-day="${day.plan_date}" style="cursor: pointer;">
            <div>
              <span class="day-date">${formatDate(day.plan_date)}</span>
              <span class="chip ${statusClass}">${escapeHtml(statusLabel)}</span>
            </div>
            <div class="caption">${escapeHtml(detailCaption)}</div>
          </div>
      `;

      if (isExpanded && day.items) {
        html += `<div class="day-detail">`;
        day.items.forEach((item) => {
          const recallIcon = item.recall_status === "success" ? "✓" : item.recall_status === "fail" ? "✗" : "○";
          const sentIcon = item.sentence_status === "done" ? "✓" : "○";
          const speechIcon = item.speech_status === "done" ? "✓" : item.speech_status === "skipped" ? "-" : "○";

          html += `
            <div class="detail-row">
              <div>
                <strong>${escapeHtml(item.lemma)}</strong>
                <span class="caption"> ${escapeHtml(item.meaning_ko)}</span>
              </div>
              <div class="caption">
                ${recallIcon} ${escapeHtml(t("history.detail.recall"))} · ${sentIcon} ${escapeHtml(t("history.detail.sentence"))} · ${speechIcon} ${escapeHtml(t("history.detail.speech"))}
              </div>
            </div>
          `;
        });

        if (isToday && !isCompleted) {
          html += `
            <div class="actions-row mt-8">
              <button class="btn btn-secondary btn-sm" onclick="setTab('today')">${escapeHtml(t("common.go_today"))}</button>
            </div>
          `;
        }

        html += `</div>`;
      }

      html += `</div>`;
    });
  }

  el.innerHTML = html;

  // Bind filter buttons
  el.querySelectorAll(".filter-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.historyFilter = btn.dataset.filter;
      refreshHistory();
    });
  });

  // Bind day expansion
  el.querySelectorAll(".day-header").forEach((header) => {
    header.addEventListener("click", () => {
      const day = header.dataset.day;
      if (state.expandedDays.has(day)) {
        state.expandedDays.delete(day);
      } else {
        state.expandedDays.add(day);
      }
      renderHistory();
    });
  });
}

// ─── Settings Screen (docs/08) ───
async function saveSettings(field, value) {
  // Optimistic update: 즉시 state 반영 + UI 갱신
  const previousValue = state.profile[field];
  state.profile[field] = value;
  renderSettings();

  try {
    const updated = await api("/api/v1/users/me/profile", {
      method: "PATCH",
      body: JSON.stringify({ [field]: value }),
    });
    // PATCH 응답으로 state 동기화 (GET 재요청 불필요)
    if (updated && typeof updated === "object") {
      state.profile = updated;
    }
    showToast(t("settings.toast.saved"));
  } catch (err) {
    // 실패 시 롤백
    state.profile[field] = previousValue;
    renderSettings();
    showToast(t("settings.toast.save_fail"));
  }
}

async function changeLanguage(locale) {
  await setLocale(locale);
  showToast(t("settings.toast.language_changed"));
}

async function resetAllData() {
  showModal(
    t("settings.data.reset_modal_title"),
    t("settings.data.reset_modal_message"),
    [
      { label: t("common.cancel"), className: "btn-secondary" },
      {
        label: t("settings.data.reset_btn"),
        className: "btn-danger",
        onClick: async () => {
          showModal(t("settings.data.reset_confirm_title"), t("settings.data.reset_confirm_message"), [
            { label: t("common.cancel"), className: "btn-secondary" },
            {
              label: t("settings.data.reset_confirm_btn"),
              className: "btn-danger",
              onClick: async () => {
                try {
                  await api("/api/v1/users/me/reset", { method: "POST" });
                  showToast(t("settings.toast.reset_done"));
                  await loadData();
                  renderAll();
                } catch {
                  showToast(t("settings.toast.reset_fail"));
                }
              },
            },
          ]);
        },
      },
    ],
  );
}

function closeCustomSelect() {
  const overlay = document.querySelector(".custom-select-overlay");
  const panel = document.querySelector(".custom-select-panel");
  if (!overlay || !panel) return;

  document.querySelectorAll(".custom-select.open").forEach((s) => s.classList.remove("open"));
  panel.classList.remove("visible");
  overlay.classList.remove("visible");
  setTimeout(() => { overlay.remove(); panel.remove(); }, 300);
}

function bindCustomSelect(id, options, onChange) {
  const wrapper = document.getElementById(id);
  if (!wrapper) return;
  const trigger = wrapper.querySelector(".custom-select-trigger");

  trigger.addEventListener("click", () => {
    const currentValue = wrapper.dataset.value;
    const title = wrapper.dataset.title || "";

    const overlay = document.createElement("div");
    overlay.className = "custom-select-overlay";

    const panel = document.createElement("div");
    panel.className = "custom-select-panel";
    panel.innerHTML = `
      <div class="custom-select-panel-header">
        <span class="custom-select-panel-title">${escapeHtml(title)}</span>
        <button class="custom-select-panel-close" type="button" aria-label="Close">✕</button>
      </div>
      ${options.map((opt) => `
        <div class="custom-select-option${opt.value === currentValue ? " selected" : ""}" data-value="${escapeHtml(opt.value)}">
          <span>${escapeHtml(opt.label)}</span>
          <span class="radio"></span>
        </div>
      `).join("")}
    `;

    document.body.appendChild(overlay);
    document.body.appendChild(panel);

    requestAnimationFrame(() => {
      overlay.classList.add("visible");
      panel.classList.add("visible");
      wrapper.classList.add("open");
    });

    overlay.addEventListener("click", closeCustomSelect);
    panel.querySelector(".custom-select-panel-close").addEventListener("click", closeCustomSelect);

    panel.querySelectorAll(".custom-select-option").forEach((opt) => {
      opt.addEventListener("click", () => {
        const val = opt.dataset.value;
        wrapper.dataset.value = val;
        trigger.querySelector("span:first-child").textContent = opt.querySelector("span:first-child").textContent;
        closeCustomSelect();
        onChange(val);
      });
    });
  });
}

function renderSettings() {
  const el = document.getElementById("settings");
  const p = state.profile;
  if (!p) {
    el.innerHTML = `
      <div class="loading-state">
        <div class="loading-spinner"></div>
        <p>${escapeHtml(t("common.loading"))}</p>
      </div>
    `;
    return;
  }

  const target = p.daily_target;
  const level = p.level || "A2";
  const focus = p.learning_focus || "travel";
  const reminderOn = p.reminder_enabled;
  const speechRequired = p.speech_required_for_completion || false;
  const currentLang = getLocale();

  el.innerHTML = `
    <div class="section-title">${escapeHtml(t("settings.title"))}</div>
    <p class="meta-text mb-16">${escapeHtml(t("settings.subtitle"))}</p>

    <!-- Language Settings -->
    <div class="settings-section">
      <div class="settings-section-title">${escapeHtml(t("settings.language.title"))}</div>

      <div class="setting-row">
        <span class="setting-label">${escapeHtml(t("settings.language.label"))}</span>
        <div class="custom-select" id="language-select"
             data-value="${escapeHtml(currentLang)}"
             data-title="${escapeHtml(t("settings.language.label"))}">
          <button class="custom-select-trigger" type="button">
            <span>${currentLang === "ko-KR" ? escapeHtml(t("settings.language.ko")) : escapeHtml(t("settings.language.en"))}</span>
            <span class="chevron">▼</span>
          </button>
        </div>
      </div>
    </div>

    <!-- Learning Settings -->
    <div class="settings-section">
      <div class="settings-section-title">${escapeHtml(t("settings.learning.title"))}</div>

      <div class="setting-row">
        <span class="setting-label">${escapeHtml(t("settings.learning.daily_target"))}</span>
        <div class="segmented-control" id="daily-target-control">
          <button class="segment ${target === 3 ? "active" : ""}" data-target="3">${escapeHtml(t("settings.learning.daily_target_unit", { n: 3 }))}</button>
          <button class="segment ${target === 4 ? "active" : ""}" data-target="4">${escapeHtml(t("settings.learning.daily_target_unit", { n: 4 }))}</button>
          <button class="segment ${target === 5 ? "active" : ""}" data-target="5">${escapeHtml(t("settings.learning.daily_target_unit", { n: 5 }))}</button>
        </div>
      </div>

      <div class="setting-row">
        <span class="setting-label">${escapeHtml(t("settings.learning.focus"))}</span>
        <div class="custom-select" id="learning-focus"
             data-value="${escapeHtml(focus)}"
             data-title="${escapeHtml(t("settings.learning.focus"))}">
          <button class="custom-select-trigger" type="button">
            <span>${escapeHtml(t("settings.learning.focus." + focus))}</span>
            <span class="chevron">▼</span>
          </button>
        </div>
      </div>

      <div class="setting-row">
        <span class="setting-label">${escapeHtml(t("settings.learning.level"))}</span>
        <div class="custom-select" id="level-select"
             data-value="${escapeHtml(level)}"
             data-title="${escapeHtml(t("settings.learning.level"))}">
          <button class="custom-select-trigger" type="button">
            <span>${escapeHtml(t("settings.learning.level." + level))}</span>
            <span class="chevron">▼</span>
          </button>
        </div>
      </div>
    </div>

    <!-- Notification Settings -->
    <div class="settings-section">
      <div class="settings-section-title">${escapeHtml(t("settings.notification.title"))}</div>

      <div class="setting-row">
        <span class="setting-label">${escapeHtml(t("settings.notification.reminder"))}</span>
        <button class="toggle ${reminderOn ? "on" : ""}" id="reminder-toggle" aria-label="${escapeHtml(t("settings.notification.reminder"))}"></button>
      </div>
      <p class="caption mt-8">${reminderOn ? escapeHtml(t("settings.notification.reminder_on")) : escapeHtml(t("settings.notification.reminder_off"))}</p>
    </div>

    <!-- Speech Settings -->
    <div class="settings-section">
      <div class="settings-section-title">${escapeHtml(t("settings.speech.title"))}</div>

      <div class="setting-row">
        <span class="setting-label">${escapeHtml(t("settings.speech.required"))}</span>
        <button class="toggle ${speechRequired ? "on" : ""}" id="speech-toggle" aria-label="${escapeHtml(t("settings.speech.required"))}"></button>
      </div>
      <p class="caption mt-8">
        ${speechRequired
          ? escapeHtml(t("settings.speech.required_on"))
          : escapeHtml(t("settings.speech.required_off"))
        }
      </p>
      <p class="caption">${escapeHtml(t("settings.speech.mic_note"))}</p>
    </div>

    <!-- Data Management -->
    <div class="settings-section">
      <div class="settings-section-title">${escapeHtml(t("settings.data.title"))}</div>

      <div class="setting-row">
        <span class="setting-label">${escapeHtml(t("settings.data.reset_label"))}</span>
        <button class="btn btn-danger btn-sm" id="reset-data-btn">${escapeHtml(t("settings.data.reset_btn"))}</button>
      </div>
      <p class="caption mt-8" style="color: var(--state-error);">${escapeHtml(t("settings.data.reset_warning"))}</p>
    </div>

    <!-- 로그아웃 -->
    <div class="settings-section">
      <div class="settings-section-title">계정</div>
      <div class="setting-row">
        <span class="setting-label">로그아웃</span>
        <button class="btn btn-secondary btn-sm" id="logout-btn">로그아웃</button>
      </div>
    </div>

    <!-- 탈퇴하기 -->
    <div class="settings-section">
      <div class="setting-row">
        <span class="setting-label">탈퇴하기</span>
        <button class="btn btn-danger btn-sm" id="delete-account-btn">탈퇴</button>
      </div>
      <p class="caption mt-8" style="color: var(--state-error);">계정과 모든 학습 데이터가 영구 삭제됩니다.</p>
    </div>

    <!-- App Info -->
    <div class="app-info">
      <p>${escapeHtml(t("settings.version"))}</p>
      <p>${escapeHtml(t("common.tagline"))}</p>
    </div>
  `;

  // Bind language select (custom dropdown)
  bindCustomSelect("language-select", [
    { value: "ko-KR", label: t("settings.language.ko") },
    { value: "en-US", label: t("settings.language.en") },
  ], (val) => changeLanguage(val));

  // Bind daily target
  el.querySelectorAll("#daily-target-control .segment").forEach((btn) => {
    btn.addEventListener("click", () => {
      saveSettings("daily_target", Number(btn.dataset.target));
    });
  });

  // Bind focus (custom dropdown)
  bindCustomSelect("learning-focus", [
    { value: "travel", label: t("settings.learning.focus.travel") },
    { value: "business", label: t("settings.learning.focus.business") },
    { value: "exam", label: t("settings.learning.focus.exam") },
    { value: "general", label: t("settings.learning.focus.general") },
  ], (val) => saveSettings("learning_focus", val));

  // Bind level (custom dropdown)
  bindCustomSelect("level-select", [
    { value: "A1", label: t("settings.learning.level.A1") },
    { value: "A2", label: t("settings.learning.level.A2") },
    { value: "B1", label: t("settings.learning.level.B1") },
    { value: "B2", label: t("settings.learning.level.B2") },
  ], (val) => saveSettings("level", val));

  // Bind reminder toggle (알림 권한 + 푸시 구독 연동)
  document.getElementById("reminder-toggle").addEventListener("click", async () => {
    const newValue = !reminderOn;
    const toggleBtn = document.getElementById("reminder-toggle");

    // 즉시 토글 시각 반영
    toggleBtn.classList.toggle("on", newValue);

    if (newValue) {
      // 켜기: 알림 권한 요청 → 푸시 구독 → 서버 저장
      const subscribed = await subscribePushNotifications();
      if (!subscribed) {
        // 권한 거부 또는 실패 시 토글 롤백
        toggleBtn.classList.toggle("on", !newValue);
        return;
      }
    } else {
      // 끄기: 푸시 구독 해제
      await unsubscribePushNotifications();
    }

    saveSettings("reminder_enabled", newValue);
  });

  // Bind speech toggle
  document.getElementById("speech-toggle").addEventListener("click", () => {
    const toggleBtn = document.getElementById("speech-toggle");
    // 즉시 토글 시각 반영
    toggleBtn.classList.toggle("on", !speechRequired);
    saveSettings("speech_required_for_completion", !speechRequired);
  });

  // Bind reset
  document.getElementById("reset-data-btn").addEventListener("click", resetAllData);

  // Bind logout
  document.getElementById("logout-btn").addEventListener("click", async () => {
    await signOut();
    showAuthScreen();
  });

  // Bind delete account
  document.getElementById("delete-account-btn").addEventListener("click", async () => {
    const confirmed = confirm("정말 탈퇴하시겠습니까?\n모든 학습 데이터가 영구 삭제되며 복구할 수 없습니다.");
    if (!confirmed) return;

    const secondConfirm = confirm("마지막 확인입니다.\n탈퇴하면 되돌릴 수 없습니다. 계속하시겠습니까?");
    if (!secondConfirm) return;

    const btn = document.getElementById("delete-account-btn");
    btn.disabled = true;
    btn.textContent = "처리 중...";

    const result = await deleteAccount();
    if (result.success) {
      alert("탈퇴가 완료되었습니다. 이용해 주셔서 감사합니다.");
      showAuthScreen();
    } else {
      alert("탈퇴 처리에 실패했습니다: " + (result.error || "알 수 없는 오류"));
      btn.disabled = false;
      btn.textContent = "탈퇴";
    }
  });
}

// ─── Header ───
function renderHeader() {
  document.querySelector(".sub").textContent = t("common.subtitle");
}

// ─── Render All ───
// ─── Home Dashboard (docs/05) ───

function getGreeting() {
  const h = new Date().getHours();
  if (h < 6) return { emoji: "🌙", text: "늦은 밤에도 학습하시는군요!" };
  if (h < 12) return { emoji: "☀️", text: "좋은 아침이에요!" };
  if (h < 18) return { emoji: "🌤️", text: "오늘도 한 걸음 더!" };
  return { emoji: "🌙", text: "하루를 마무리하며 학습해요!" };
}

function getDaysTogether() {
  if (!state.profile?.created_at) return 1;
  const created = new Date(state.profile.created_at);
  const now = new Date();
  const diffMs = now - created;
  const days = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  return Math.max(1, days + 1); // 최소 1일
}

function getTotalWordsLearned() {
  if (!state.history?.days) return 0;
  let total = 0;
  for (const day of state.history.days) {
    total += day.learning_done;
  }
  return total;
}

function getTodayProgress() {
  if (!state.history?.days) return { done: 0, target: 0 };
  const today = getLocalToday();
  const todayDay = state.history.days.find((d) => d.plan_date === today);
  if (!todayDay) return { done: 0, target: state.profile?.daily_target ?? 3 };
  return { done: todayDay.learning_done, target: todayDay.learning_target };
}

function renderHome() {
  const el = document.getElementById("home");
  if (!el) return;

  if (!state.profile) {
    el.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">📝</div>
        <p>${escapeHtml(t("common.loading"))}</p>
        <button class="btn btn-primary" onclick="location.reload()">${escapeHtml(t("common.retry"))}</button>
      </div>
    `;
    return;
  }

  const greeting = getGreeting();
  const streak = state.history?.streak;
  const currentStreak = streak?.current_streak_days ?? 0;
  const bestStreak = streak?.best_streak_days ?? 0;
  const daysTogether = getDaysTogether();
  const totalWords = getTotalWordsLearned();
  const todayProgress = getTodayProgress();

  const todayDone = todayProgress.done > 0;
  const ctaText = todayDone ? "이어서 학습하기" : "오늘 학습 시작하기";

  el.innerHTML = `
    <div class="home-greeting">
      <div class="greeting-emoji">${greeting.emoji}</div>
      <h2>${escapeHtml(greeting.text)}</h2>
      <p>오늘도 조금씩, 확실하게.</p>
    </div>

    <div class="home-stats">
      <div class="home-stat-card${currentStreak > 0 ? " highlight" : ""}">
        <div class="stat-icon">🔥</div>
        <div class="stat-value">${currentStreak}<span style="font-size:14px;font-weight:400;">일</span></div>
        <div class="stat-label">연속 학습</div>
      </div>
      <div class="home-stat-card">
        <div class="stat-icon">📚</div>
        <div class="stat-value">${totalWords}<span style="font-size:14px;font-weight:400;">개</span></div>
        <div class="stat-label">총 학습 단어</div>
      </div>
      <div class="home-stat-card">
        <div class="stat-icon">📝</div>
        <div class="stat-value">${todayProgress.done}/${todayProgress.target}</div>
        <div class="stat-label">오늘 학습량</div>
      </div>
      <div class="home-stat-card">
        <div class="stat-icon">🤝</div>
        <div class="stat-value">${daysTogether}<span style="font-size:14px;font-weight:400;">일</span></div>
        <div class="stat-label">함께한 시간</div>
      </div>
    </div>

    <div class="home-actions">
      <button class="btn btn-primary" onclick="setTab('today')">${escapeHtml(ctaText)}</button>
    </div>

    ${bestStreak > 0 ? `<div class="home-tip">🏆 최고 기록: ${bestStreak}일 연속</div>` : `<div class="home-tip">첫 학습을 시작하면 연속 기록이 쌓여요!</div>`}
  `;
}

function renderAll() {
  try { renderHeader(); } catch (e) { console.error("renderHeader:", e); }
  try { updateTabLabels(); } catch (e) { console.error("updateTabLabels:", e); }
  try { renderStreakMini(); } catch (e) { console.error("renderStreakMini:", e); }

  // 활성 탭에 따라 해당 패널만 렌더링
  try {
    switch (state.activeTab) {
      case "home":
        renderHome();
        break;
      case "today":
        if (state.plan) renderToday();
        break;
      case "inbox":
        renderInbox();
        break;
      case "history":
        renderHistory();
        break;
      case "settings":
        renderSettings();
        break;
    }
  } catch (e) {
    console.error("renderAll tab render:", e);
    const panel = document.getElementById(state.activeTab);
    if (panel) {
      panel.innerHTML = `
        <div class="empty-state">
          <div class="empty-icon">⚠️</div>
          <p>화면 렌더링에 실패했습니다: ${escapeHtml(e.message)}</p>
          <button class="btn btn-primary" onclick="location.reload()">다시 시도</button>
        </div>
      `;
    }
  }
}

// ─── Onboarding ───
// SSOT: docs/09_SCREEN_SPEC_ONBOARDING.md

const onboardingState = {
  currentStep: 1,
  level: "A2",
  learningFocus: "travel",
  dailyTarget: 3,
};

function showOnboardingScreen() {
  hideSplash();
  document.getElementById("auth-screen").classList.add("hidden");
  document.getElementById("main-app").classList.add("hidden");
  document.getElementById("onboarding-screen").classList.remove("hidden");
  onboardingState.currentStep = 1;
  renderOnboardingStep(1);
}

function hideOnboardingScreen() {
  document.getElementById("onboarding-screen").classList.add("hidden");
}

function renderOnboardingStep(step) {
  onboardingState.currentStep = step;

  // Hide all steps, show the current one
  for (let i = 1; i <= 4; i++) {
    const el = document.getElementById(`onboarding-step-${i}`);
    if (el) el.classList.toggle("hidden", i !== step);
  }

  // Update progress dots
  const progressEl = document.getElementById("onboarding-progress");
  const totalSteps = 4;
  let dotsHtml = "";
  for (let i = 1; i <= totalSteps; i++) {
    const cls =
      i < step ? "onboarding-progress-dot done" :
      i === step ? "onboarding-progress-dot active" :
      "onboarding-progress-dot";
    dotsHtml += `<div class="${cls}"></div>`;
  }
  progressEl.innerHTML = dotsHtml;
}

function bindOnboardingOptionCards(containerId, stateKey) {
  const container = document.getElementById(containerId);
  if (!container) return;
  container.querySelectorAll(".onboarding-option-card").forEach((card) => {
    card.addEventListener("click", () => {
      // Deselect all in this group
      container.querySelectorAll(".onboarding-option-card").forEach((c) => c.classList.remove("selected"));
      card.classList.add("selected");
      onboardingState[stateKey] = card.dataset.value;
    });
  });
}

async function completeOnboarding() {
  const btn = document.getElementById("onboarding-complete-btn");
  btn.disabled = true;
  btn.textContent = "준비 중...";

  try {
    await api("/api/v1/users/me/onboarding/complete", {
      method: "POST",
      body: JSON.stringify({
        level: onboardingState.level,
        learning_focus: onboardingState.learningFocus,
        daily_target: Number(onboardingState.dailyTarget),
      }),
    });

    hideOnboardingScreen();
    showMainApp();
    bindTabs();
    renderHeader();
    updateTabLabels();

    // 홈에 로딩 표시
    const homeEl = document.getElementById("home");
    if (homeEl) {
      homeEl.innerHTML = `
        <div class="loading-state">
          <div class="loading-spinner"></div>
          <p>첫 학습을 준비하고 있어요...</p>
        </div>
      `;
    }

    await loadDashboardData();
    renderAll();
    showToast("환영해요! 첫 학습을 시작해볼까요?");
  } catch (err) {
    btn.disabled = false;
    btn.textContent = "첫 학습 시작하기";
    showToast("설정 저장에 실패했어요. 다시 시도해주세요.");
  }
}

function bindOnboardingUI() {
  // Step 1 → Step 2
  document.getElementById("onboarding-start-btn").addEventListener("click", () => {
    renderOnboardingStep(2);
  });

  // Step 2: Level options
  bindOnboardingOptionCards("level-options", "level");

  // Step 2 → Step 3
  document.getElementById("onboarding-next-2").addEventListener("click", () => {
    renderOnboardingStep(3);
  });

  // Step 2 ← back
  document.getElementById("onboarding-back-2").addEventListener("click", () => {
    renderOnboardingStep(1);
  });

  // Step 3: Focus options
  bindOnboardingOptionCards("focus-options", "learningFocus");

  // Step 3 → Step 4
  document.getElementById("onboarding-next-3").addEventListener("click", () => {
    renderOnboardingStep(4);
  });

  // Step 3 ← back
  document.getElementById("onboarding-back-3").addEventListener("click", () => {
    renderOnboardingStep(2);
  });

  // Step 4: Target options
  bindOnboardingOptionCards("target-options", "dailyTarget");

  // Step 4 ← back
  document.getElementById("onboarding-back-4").addEventListener("click", () => {
    renderOnboardingStep(3);
  });

  // Step 4: Complete
  document.getElementById("onboarding-complete-btn").addEventListener("click", () => {
    completeOnboarding();
  });
}

// ─── Auth / Main Screen 전환 ───
// SSOT: docs/22_AUTH_SPEC.md §9.2

const SPLASH_MIN_MS = 3800;
const splashShownAt = Date.now();

function destroySplashLottie() {
  if (window.__splashLottie) {
    window.__splashLottie.destroy();
    window.__splashLottie = null;
  }
}

function hideSplash() {
  const el = document.getElementById("splash-screen");
  if (!el || el.classList.contains("hidden")) return;

  const elapsed = Date.now() - splashShownAt;
  const remaining = Math.max(0, SPLASH_MIN_MS - elapsed);

  setTimeout(() => {
    el.classList.add("hidden");
    el.addEventListener("transitionend", () => {
      destroySplashLottie();
      el.remove();
    }, { once: true });
  }, remaining);
}

function showAuthScreen() {
  hideSplash();
  document.getElementById("auth-screen").classList.remove("hidden");
  document.getElementById("main-app").classList.add("hidden");
  resetAuthForms();
}

/**
 * 인증 폼 전체 초기화 — 입력값, 체크박스, 에러 메시지 모두 리셋
 */
function resetAuthForms() {
  // 모든 input 필드 초기화
  document
    .querySelectorAll("#auth-screen input[type='email'], #auth-screen input[type='password'], #auth-screen input[type='text']")
    .forEach((el) => { el.value = ""; });

  // 체크박스 초기화
  document
    .querySelectorAll("#auth-screen input[type='checkbox']")
    .forEach((el) => { el.checked = false; });

  // 에러/성공 메시지 숨기기
  document
    .querySelectorAll("#auth-screen .auth-error, #auth-screen .auth-success")
    .forEach((el) => { el.classList.add("hidden"); el.textContent = ""; });

  // 기본 폼(로그인)으로 전환
  showAuthForm("auth-login-form");
}

function showMainApp() {
  hideSplash();
  document.getElementById("auth-screen").classList.add("hidden");
  document.getElementById("main-app").classList.remove("hidden");

  // 저장된 탭 또는 홈 탭으로 설정
  const tab = state.activeTab || "home";
  document.querySelectorAll(".tab").forEach((t) => {
    const isActive = t.dataset.tab === tab;
    t.classList.toggle("active", isActive);
    t.setAttribute("aria-selected", isActive ? "true" : "false");
  });
  document.querySelectorAll(".panel").forEach((panel) => {
    panel.classList.toggle("hidden", panel.id !== tab);
  });
}

function showAuthForm(formId) {
  // 모든 auth form 숨기기
  document.querySelectorAll(".auth-form, .auth-confirm-notice").forEach((el) => {
    el.classList.add("hidden");
  });

  // 전환 대상 폼의 입력값 초기화
  const target = document.getElementById(formId);
  target.querySelectorAll("input[type='email'], input[type='password'], input[type='text']").forEach((el) => { el.value = ""; });
  target.querySelectorAll("input[type='checkbox']").forEach((el) => { el.checked = false; });
  target.querySelectorAll(".auth-error, .auth-success").forEach((el) => { el.classList.add("hidden"); el.textContent = ""; });

  target.classList.remove("hidden");
}

function showAuthError(elementId, message) {
  const el = document.getElementById(elementId);
  el.textContent = message;
  el.classList.remove("hidden");
}

function hideAuthError(elementId) {
  document.getElementById(elementId).classList.add("hidden");
}

function setAuthLoading(buttonId, loading) {
  const btn = document.getElementById(buttonId);
  btn.disabled = loading;
  if (loading) {
    btn.classList.add("btn-loading");
  } else {
    btn.classList.remove("btn-loading");
  }
}

// ─── Auth UI 바인딩 ───

function bindAuthUI() {
  // 로그인/가입 폼 전환
  document.getElementById("show-signup-link").addEventListener("click", (e) => {
    e.preventDefault();
    showAuthForm("auth-signup-form");
  });
  document.getElementById("show-login-link").addEventListener("click", (e) => {
    e.preventDefault();
    showAuthForm("auth-login-form");
  });

  // 비밀번호 재설정
  document.getElementById("forgot-password-link").addEventListener("click", (e) => {
    e.preventDefault();
    showAuthForm("auth-reset-form");
  });
  document.getElementById("back-to-login-link").addEventListener("click", (e) => {
    e.preventDefault();
    showAuthForm("auth-login-form");
  });
  document.getElementById("back-to-login-from-confirm").addEventListener("click", (e) => {
    e.preventDefault();
    showAuthForm("auth-login-form");
  });

  // 이메일 로그인
  document.getElementById("auth-login-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    hideAuthError("login-error");

    const email = document.getElementById("login-email").value.trim();
    const password = document.getElementById("login-password").value;

    const emailErr = validateEmail(email);
    if (emailErr) { showAuthError("login-error", emailErr); return; }

    setAuthLoading("login-submit-btn", true);
    const result = await signInWithEmail(email, password);
    setAuthLoading("login-submit-btn", false);

    if (!result.success) {
      showAuthError("login-error", result.error);
    }
    // 성공 시 onAuthStateChange 리스너가 화면 전환 처리
  });

  // 이메일 가입
  document.getElementById("auth-signup-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    hideAuthError("signup-error");

    const email = document.getElementById("signup-email").value.trim();
    const password = document.getElementById("signup-password").value;
    const passwordConfirm = document.getElementById("signup-password-confirm").value;
    const termsChecked = document.getElementById("signup-terms").checked;
    const privacyChecked = document.getElementById("signup-privacy").checked;

    const emailErr = validateEmail(email);
    if (emailErr) { showAuthError("signup-error", emailErr); return; }
    const passErr = validatePassword(password);
    if (passErr) { showAuthError("signup-error", passErr); return; }
    if (password !== passwordConfirm) {
      showAuthError("signup-error", "비밀번호가 일치하지 않습니다.");
      return;
    }
    if (!termsChecked) {
      showAuthError("signup-error", "이용약관에 동의해주세요.");
      return;
    }
    if (!privacyChecked) {
      showAuthError("signup-error", "개인정보처리방침에 동의해주세요.");
      return;
    }

    setAuthLoading("signup-submit-btn", true);
    const result = await signUpWithEmail(email, password);
    setAuthLoading("signup-submit-btn", false);
    updateSignupButtonState();

    if (!result.success) {
      showAuthError("signup-error", result.error);
      return;
    }

    if (result.needsConfirmation) {
      showAuthForm("auth-confirm-notice");
    }
    // 이메일 확인 불필요 설정이면 onAuthStateChange가 처리
  });

  // 비밀번호 재설정
  document.getElementById("auth-reset-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    hideAuthError("reset-error");

    const email = document.getElementById("reset-email").value.trim();
    const emailErr = validateEmail(email);
    if (emailErr) { showAuthError("reset-error", emailErr); return; }

    setAuthLoading("reset-submit-btn", true);
    const result = await resetPassword(email);
    setAuthLoading("reset-submit-btn", false);

    if (result.success) {
      const successEl = document.getElementById("reset-success");
      successEl.textContent = "이메일을 확인해주세요. 재설정 링크를 보냈습니다.";
      successEl.classList.remove("hidden");
    } else {
      showAuthError("reset-error", result.error);
    }
  });

  // 전체 동의 체크박스 토글
  const agreeAllCheckbox = document.getElementById("signup-agree-all");
  const termsCheckbox = document.getElementById("signup-terms");
  const privacyCheckbox = document.getElementById("signup-privacy");

  // ─── 가입하기 버튼 활성화/비활성화 ───
  const signupEmailInput = document.getElementById("signup-email");
  const signupPasswordInput = document.getElementById("signup-password");
  const signupPasswordConfirmInput = document.getElementById("signup-password-confirm");
  const signupSubmitBtn = document.getElementById("signup-submit-btn");

  function updateSignupButtonState() {
    const email = signupEmailInput.value.trim();
    const password = signupPasswordInput.value;
    const passwordConfirm = signupPasswordConfirmInput.value;

    const hasEmail = email.length > 0;
    const hasValidPassword = validatePassword(password) === null;
    const passwordsMatch = password.length > 0 && password === passwordConfirm;
    const termsAgreed = termsCheckbox.checked && privacyCheckbox.checked;

    signupSubmitBtn.disabled = !(hasEmail && hasValidPassword && passwordsMatch && termsAgreed);
  }

  // 입력 필드 이벤트 바인딩
  signupEmailInput.addEventListener("input", updateSignupButtonState);
  signupPasswordInput.addEventListener("input", updateSignupButtonState);
  signupPasswordConfirmInput.addEventListener("input", updateSignupButtonState);

  agreeAllCheckbox.addEventListener("change", () => {
    const checked = agreeAllCheckbox.checked;
    termsCheckbox.checked = checked;
    privacyCheckbox.checked = checked;
    updateSignupButtonState();
  });

  // 개별 체크박스 변경 시 전체동의 상태 동기화 + 버튼 상태 업데이트
  function syncAgreeAll() {
    agreeAllCheckbox.checked = termsCheckbox.checked && privacyCheckbox.checked;
    updateSignupButtonState();
  }
  termsCheckbox.addEventListener("change", syncAgreeAll);
  privacyCheckbox.addEventListener("change", syncAgreeAll);

  // 약관/개인정보 모달
  const legalOverlay = document.getElementById("legal-modal-overlay");
  const legalTitle = document.getElementById("legal-modal-title");
  const legalBody = document.getElementById("legal-modal-body");
  const legalCache = {};

  async function openLegalModal(type) {
    const url = type === "terms" ? "/terms.html" : "/privacy.html";
    const title = type === "terms" ? "이용약관" : "개인정보처리방침";
    legalTitle.textContent = title;
    legalBody.innerHTML = `
      <div class="loading-state">
        <div class="loading-spinner"></div>
        <p>불러오는 중...</p>
      </div>
    `;
    legalOverlay.classList.remove("hidden");

    if (legalCache[type]) {
      legalBody.innerHTML = legalCache[type];
      return;
    }

    try {
      const res = await fetch(resolveApiUrl(url));
      const html = await res.text();
      // HTML에서 <div class="legal-page">...</div> 본문만 추출
      const match = html.match(/<div class="legal-page">([\s\S]*?)<\/div>\s*<\/body>/);
      if (match) {
        // "돌아가기" 링크와 제목/날짜 제거 (모달에선 불필요)
        let content = match[1];
        content = content.replace(/<a[^>]*class="legal-back"[^>]*>.*?<\/a>/g, "");
        content = content.replace(/<h1>.*?<\/h1>/g, "");
        content = content.replace(/<p class="updated">.*?<\/p>/g, "");
        legalCache[type] = content.trim();
        legalBody.innerHTML = legalCache[type];
      } else {
        legalBody.innerHTML = `<p>내용을 불러올 수 없습니다. <a href="${resolveApiUrl(url)}" target="_blank">새 탭에서 보기</a></p>`;
      }
    } catch {
      legalBody.innerHTML = `<p>내용을 불러올 수 없습니다. <a href="${url}" target="_blank">새 탭에서 보기</a></p>`;
    }
  }

  function closeLegalModal() {
    legalOverlay.classList.add("hidden");
  }

  document.getElementById("legal-modal-close").addEventListener("click", closeLegalModal);
  legalOverlay.addEventListener("click", (e) => {
    if (e.target === legalOverlay) closeLegalModal();
  });

  // [data-legal] 링크 클릭 시 모달 열기
  document.querySelectorAll("[data-legal]").forEach((link) => {
    link.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation(); // 체크박스 토글 방지
      openLegalModal(link.dataset.legal);
    });
  });

  // Google 로그인
  document.getElementById("google-login-btn").addEventListener("click", async () => {
    await signInWithGoogle();
  });
  document.getElementById("google-signup-btn").addEventListener("click", async () => {
    await signInWithGoogle();
  });
}

// ─── Init ───
function bindTabs() {
  document.querySelectorAll(".tab").forEach((tab) => {
    tab.addEventListener("click", () => setTab(tab.dataset.tab));
  });
}

// Make setTab and scrollToFirstReview accessible from inline onclick
window.setTab = setTab;
window.scrollToFirstReview = scrollToFirstReview;

/**
 * 로그인 성공 후 앱 초기화
 * 온보딩 미완료 시 온보딩 화면으로, 완료 시 메인 앱으로 분기
 */
async function onSignedIn() {
  // 초기 상태 리셋
  todayLoaded = false;
  state.plan = null;
  state.reviews = null;
  const savedTab = (() => { try { return sessionStorage.getItem("tw_active_tab"); } catch { return null; } })();
  state.activeTab = savedTab || "home";

  // 서버에 사용자 초기화 요청 (온보딩 완료 여부 확인)
  let initResult = null;
  try {
    initResult = await initializeUser();
  } catch {
    // Non-blocking — 이미 초기화된 사용자일 수 있음
  }

  // 온보딩 미완료 → 온보딩 화면 표시
  if (initResult && initResult.onboarding_completed === false) {
    showOnboardingScreen();
    return;
  }

  showMainApp();
  bindTabs();
  renderHeader();
  updateTabLabels();

  // 먼저 탭 전환 (로딩 스피너 표시) → 데이터 로드 → 리렌더링
  setTab(state.activeTab);

  // 빠른 데이터만 로드 (프로필 + 히스토리, AI 호출 없음)
  try {
    await loadDashboardData();
  } catch {
    // 에러 배너는 loadDashboardData 내부에서 표시됨
    // 여기서는 앱 전체가 멈추지 않도록 catch
  }

  // 데이터 로드 후 현재 탭 리렌더링
  renderAll();
}

async function main() {
  // iOS StatusBar 스타일 설정 (Android는 MainActivity.java에서 네이티브 처리)
  if (window.Capacitor?.getPlatform?.() === "ios") {
    try {
      const { StatusBar } = window.Capacitor.Plugins;
      await StatusBar.setStyle({ style: "LIGHT" });
    } catch { /* StatusBar plugin not available */ }
  }

  // Initialize i18n before anything else
  await initI18n();

  // Re-render everything when locale changes
  onLocaleChange(() => renderAll());

  // Auth UI 바인딩
  bindAuthUI();

  // Onboarding UI 바인딩
  bindOnboardingUI();

  // Auth 상태 리스너 등록
  // 이미 초기화된 상태에서 TOKEN_REFRESHED/SIGNED_IN 재발생 시
  // onSignedIn() 중복 실행을 방지한다.
  let appInitialized = false;

  onAuthStateChange(async (event, session) => {
    if (event === "SIGNED_IN" && session) {
      if (!appInitialized) {
        appInitialized = true;
        await onSignedIn();
      }
    } else if (event === "SIGNED_OUT") {
      appInitialized = false;
      showAuthScreen();
    }
  });

  // 기존 세션 확인
  const session = await getSession();
  if (session) {
    appInitialized = true;
    await onSignedIn();
  } else {
    showAuthScreen();
  }
}

main().catch((error) => {
  // 인증 관련 에러면 Auth 화면 유지
  if (error.message === "AUTH_REQUIRED") {
    showAuthScreen();
    return;
  }
  const el = document.getElementById("home") || document.getElementById("today");
  if (el) {
    el.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">⚠️</div>
        <p>${escapeHtml(t("errors.init_fail", { message: error.message }))}</p>
        <button class="btn btn-primary" onclick="location.reload()">${escapeHtml(t("common.retry"))}</button>
      </div>
    `;
  }
});
