/**
 * TinyWords Frontend
 * SSOT: docs/05~08 Screen Specs, docs/17 UI Style, docs/21 I18N, docs/22 Auth
 */
import { initI18n, setLocale, getLocale, getSupportedLocales, t, onLocaleChange } from "./i18n.js";
import {
  onAuthStateChange,
  getSession,
  authenticatedFetch,
  initializeUser,
  signInWithEmail,
  signUpWithEmail,
  signInWithGoogle,
  signOut,
  resetPassword,
  validateEmail,
  validatePassword,
} from "./auth.js";

// ─── State ───
const state = {
  profile: null,
  plan: null,
  reviews: [],
  history: null,
  sentenceDrafts: {},
  sentenceFeedbacks: {},
  recordings: {},
  activeTab: "today",
  historyFilter: "all",
  expandedDays: new Set(),
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
    throw err;
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
    state.reviews = queueRes.tasks || [];
    todayLoaded = true;
    renderToday();
  } catch (err) {
    showError(t("errors.load_data") + " " + err.message);
  }
}

async function refreshToday() {
  try {
    state.plan = await api("/api/v1/day-plans/today?create_if_missing=true");
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

// ─── Streak Mini ───
function renderStreakMini() {
  const el = document.getElementById("streak-mini");
  if (!state.history) {
    el.textContent = "";
    return;
  }
  const streak = state.history.streak;
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
        },
      }),
    });

    state.sentenceFeedbacks[item.planItemId] = coached.result || coached;
    await patchItem(item.planItemId, { sentenceStatus: "done" });
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

    state.recordings[item.planItemId] = {
      status: "recording",
      mediaRecorder,
      chunks,
      startedAt,
      blobUrl: null,
      durationMs: 0,
      speechId: null,
      score: null,
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
}

async function saveRecording(item) {
  const recording = state.recordings[item.planItemId];
  if (!recording || !recording.blobUrl) {
    showToast(t("errors.no_recording"));
    return;
  }

  try {
    const created = await api("/api/v1/speech-attempts", {
      method: "POST",
      body: JSON.stringify({
        plan_item_id: item.planItemId,
        audio_uri: `local://${item.planItemId}/${Date.now()}.webm`,
        duration_ms: recording.durationMs,
      }),
    });

    const speechId = created.speech_id;
    const score = Math.max(45, Math.min(98, Math.floor(60 + Math.random() * 35)));
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
    el.innerHTML = `<div class="loading-spinner">${escapeHtml(t("common.loading"))}</div>`;
    return;
  }

  const completedCount = plan.items.filter((i) => i.isCompleted).length;
  const total = plan.dailyTarget;
  const percent = Math.floor((completedCount / total) * 100);
  const isCompleted = plan.status === "completed";
  const allItemsDone = plan.items.every((i) => i.isCompleted);

  let ctaLabel, summaryCopy;
  if (isCompleted) {
    ctaLabel = t("today.cta.completed");
    summaryCopy = t("today.summary.completed");
  } else if (completedCount === 0) {
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
        <div class="progress-bar-inner" style="width: ${isCompleted ? 100 : percent}%"></div>
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

    html += `
      <div class="card" id="card-${item.planItemId}">
        <div class="card-header">
          <div>
            <span class="card-title">${escapeHtml(item.lemma)}</span>
            <span class="type-badge">${itemTypeLabel(item.itemType)}</span>
          </div>
          ${item.isCompleted ? `<span class="chip chip-success">${escapeHtml(t("common.complete"))}</span>` : ""}
        </div>
        <div class="meta-text mb-8">${escapeHtml(item.meaningKo)}</div>

        ${learningItem.exampleEn ? `
        <div class="example-sentence">
          <div class="example-en">${escapeHtml(learningItem.exampleEn || `I used ${item.lemma} in my sentence.`)}</div>
          <div class="example-ko">${escapeHtml(learningItem.exampleKo || "")}</div>
        </div>
        ` : ""}

        <div class="chips-row mt-8">
          ${recallChip}
          ${sentenceChip}
          ${speechChip}
        </div>

        <!-- Step 1: Recall -->
        ${!item.isCompleted ? `
        <div class="actions-row">
          <button class="btn btn-primary btn-sm" data-item="${item.planItemId}" data-type="recall-success"
            ${item.recallStatus === "success" ? "disabled" : ""}>
            ${escapeHtml(t("today.recall.success"))}
          </button>
          <button class="btn btn-secondary btn-sm" data-item="${item.planItemId}" data-type="recall-fail"
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
          ${item.speechStatus !== "done" ? `
          <div class="actions-row">
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
          </div>
          ` : ""}
          ${recording?.blobUrl ? `<audio controls src="${recording.blobUrl}"></audio>` : ""}
          ${recording?.score
            ? `<div class="score-badge ${recording.score >= 80 ? "score-high" : recording.score >= 60 ? "score-mid" : "score-low"}">
                ${escapeHtml(t("today.speech.score", { score: recording.score }))}
              </div>`
            : ""
          }
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

  // Bind events
  el.querySelectorAll("button[data-item]").forEach((button) => {
    button.addEventListener("click", async () => {
      const itemId = button.dataset.item;
      const type = button.dataset.type;
      const item = state.plan.items.find((it) => it.planItemId === itemId);
      if (!item) return;

      if (type === "recall-success") await patchItem(itemId, { recallStatus: "success" });
      else if (type === "recall-fail") await patchItem(itemId, { recallStatus: "fail" });
      else if (type === "coach") await requestSentenceCoach(item);
      else if (type === "record-start") await startRecording(item);
      else if (type === "record-stop") stopRecording(item);
      else if (type === "record-save") await saveRecording(item);
      else if (type === "skip-speech") await patchItem(itemId, { speechStatus: "skipped" });
    });
  });

  el.querySelectorAll("textarea[data-sentence-input]").forEach((input) => {
    input.addEventListener("input", (event) => {
      state.sentenceDrafts[event.target.dataset.sentenceInput] = event.target.value;
    });
  });

  const completeBtn = document.getElementById("complete-day");
  if (completeBtn) completeBtn.addEventListener("click", completeToday);
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
    button.addEventListener("click", async () => {
      await submitReview(button.dataset.review, button.dataset.result);
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
    el.innerHTML = `<div class="loading-spinner">${escapeHtml(t("common.loading"))}</div>`;
    return;
  }

  const streak = data.streak;
  const days = data.days || [];

  let html = "";

  html += `<div class="section-title">${escapeHtml(t("history.title"))}</div>`;

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
    days.forEach((day) => {
      const isCompleted = day.dayplan_status === "completed";
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

        if (!isCompleted) {
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
  try {
    await api("/api/v1/users/me/profile", {
      method: "PATCH",
      body: JSON.stringify({ [field]: value }),
    });
    state.profile = await api("/api/v1/users/me/profile");
    showToast(t("settings.toast.saved"));
    renderSettings();
  } catch (err) {
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

function renderSettings() {
  const el = document.getElementById("settings");
  const p = state.profile;
  if (!p) {
    el.innerHTML = `<div class="loading-spinner">${escapeHtml(t("common.loading"))}</div>`;
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
        <select id="language-select">
          <option value="ko-KR" ${currentLang === "ko-KR" ? "selected" : ""}>${escapeHtml(t("settings.language.ko"))}</option>
          <option value="en-US" ${currentLang === "en-US" ? "selected" : ""}>${escapeHtml(t("settings.language.en"))}</option>
        </select>
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
        <select id="learning-focus">
          <option value="travel" ${focus === "travel" ? "selected" : ""}>${escapeHtml(t("settings.learning.focus.travel"))}</option>
          <option value="business" ${focus === "business" ? "selected" : ""}>${escapeHtml(t("settings.learning.focus.business"))}</option>
          <option value="exam" ${focus === "exam" ? "selected" : ""}>${escapeHtml(t("settings.learning.focus.exam"))}</option>
          <option value="general" ${focus === "general" ? "selected" : ""}>${escapeHtml(t("settings.learning.focus.general"))}</option>
        </select>
      </div>

      <div class="setting-row">
        <span class="setting-label">${escapeHtml(t("settings.learning.level"))}</span>
        <select id="level-select">
          <option value="A1" ${level === "A1" ? "selected" : ""}>${escapeHtml(t("settings.learning.level.A1"))}</option>
          <option value="A2" ${level === "A2" ? "selected" : ""}>${escapeHtml(t("settings.learning.level.A2"))}</option>
          <option value="B1" ${level === "B1" ? "selected" : ""}>${escapeHtml(t("settings.learning.level.B1"))}</option>
          <option value="B2" ${level === "B2" ? "selected" : ""}>${escapeHtml(t("settings.learning.level.B2"))}</option>
        </select>
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

    <!-- App Info -->
    <div class="app-info">
      <p>${escapeHtml(t("settings.version"))}</p>
      <p>${escapeHtml(t("common.tagline"))}</p>
    </div>
  `;

  // Bind language select
  document.getElementById("language-select").addEventListener("change", (e) => {
    changeLanguage(e.target.value);
  });

  // Bind daily target
  el.querySelectorAll("#daily-target-control .segment").forEach((btn) => {
    btn.addEventListener("click", () => {
      saveSettings("daily_target", Number(btn.dataset.target));
    });
  });

  // Bind focus
  document.getElementById("learning-focus").addEventListener("change", (e) => {
    saveSettings("learning_focus", e.target.value);
  });

  // Bind level
  document.getElementById("level-select").addEventListener("change", (e) => {
    saveSettings("level", e.target.value);
  });

  // Bind reminder toggle
  document.getElementById("reminder-toggle").addEventListener("click", () => {
    saveSettings("reminder_enabled", !reminderOn);
  });

  // Bind speech toggle
  document.getElementById("speech-toggle").addEventListener("click", () => {
    saveSettings("speech_required_for_completion", !speechRequired);
  });

  // Bind reset
  document.getElementById("reset-data-btn").addEventListener("click", resetAllData);

  // Bind logout
  document.getElementById("logout-btn").addEventListener("click", async () => {
    await signOut();
    showAuthScreen();
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
  renderHeader();
  updateTabLabels();
  renderStreakMini();

  // 활성 탭에 따라 해당 패널만 렌더링
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
}

// ─── Auth / Main Screen 전환 ───
// SSOT: docs/22_AUTH_SPEC.md §9.2

function showAuthScreen() {
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
  document.getElementById("auth-screen").classList.add("hidden");
  document.getElementById("main-app").classList.remove("hidden");

  // 홈 탭을 기본 활성 탭으로 설정
  document.querySelectorAll(".tab").forEach((tab) => {
    const isHome = tab.dataset.tab === "home";
    tab.classList.toggle("active", isHome);
    tab.setAttribute("aria-selected", isHome ? "true" : "false");
  });
  document.querySelectorAll(".panel").forEach((panel) => {
    panel.classList.toggle("hidden", panel.id !== "home");
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

  agreeAllCheckbox.addEventListener("change", () => {
    const checked = agreeAllCheckbox.checked;
    termsCheckbox.checked = checked;
    privacyCheckbox.checked = checked;
  });

  // 개별 체크박스 변경 시 전체동의 상태 동기화
  function syncAgreeAll() {
    agreeAllCheckbox.checked = termsCheckbox.checked && privacyCheckbox.checked;
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
    legalBody.innerHTML = `<div class="loading-spinner">불러오는 중...</div>`;
    legalOverlay.classList.remove("hidden");

    if (legalCache[type]) {
      legalBody.innerHTML = legalCache[type];
      return;
    }

    try {
      const res = await fetch(url);
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
        legalBody.innerHTML = `<p>내용을 불러올 수 없습니다. <a href="${url}" target="_blank">새 탭에서 보기</a></p>`;
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
 */
async function onSignedIn() {
  // 초기 상태 리셋
  todayLoaded = false;
  state.plan = null;
  state.reviews = [];
  state.activeTab = "home";

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
        <p>잠시만요...</p>
      </div>
    `;
  }

  // 서버에 사용자 초기화 요청
  try {
    await initializeUser();
  } catch {
    // Non-blocking — 이미 초기화된 사용자일 수 있음
  }

  // 빠른 데이터만 로드 (프로필 + 히스토리, AI 호출 없음)
  await loadDashboardData();

  renderAll();
}

async function main() {
  // Initialize i18n before anything else
  await initI18n();

  // Re-render everything when locale changes
  onLocaleChange(() => renderAll());

  // Auth UI 바인딩
  bindAuthUI();

  // Auth 상태 리스너 등록
  onAuthStateChange(async (event, session) => {
    if (event === "SIGNED_IN" && session) {
      await onSignedIn();
    } else if (event === "SIGNED_OUT") {
      showAuthScreen();
    }
  });

  // 기존 세션 확인
  const session = await getSession();
  if (session) {
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
