import { $, NanaCore, esc, askNana, ref, set, update, push, onValue, query, limitToLast } from "./nana-core.js?v=2.9.6";

const {
  SERVICE_TOKEN, PORTAL_NODE_ID, GOOGLE_SCRIPT_URL,
  basePath, db, role, senderName, refs, settings, state, hooks
} = NanaCore;

let activeQuestionData = null;
let lastUnreadChatPromptMs = Date.now();
let lastAnyPeriodicPromptMs = 0;
let lastHandledQuestionId = (() => {
  try { return localStorage.getItem('nana_last_handled_qid') || null; } catch (_) { return null; }
})();
let selectedQuestionTimeoutMin = 30;
let questionExpireTimer = null;
const expiredQuestionIdsSent = new Set();

hooks.clearPendingQuestionHistoryIfOverwritten = (now = Date.now()) => {
  if (activeQuestionData?.status === 'pending' && activeQuestionData?.historyKey) {
    update(ref(db, `${basePath}/questionHistory/${activeQuestionData.historyKey}`), {
      status: 'cleared',
      clearedAt: now
    }).catch(() => {});
  }
};

function formatTimeoutLabel(mins) {
  const m = Number(mins) || 0;
  if (m <= 0) return 'No limit';
  if (m < 60) return `${m}m`;
  if (m === 1440) return '1d';
  return `${Math.round(m / 60)}h`;
}

function formatRemainingTime(expiresAt) {
  const remMs = Math.max(0, Number(expiresAt || 0) - Date.now());
  if (remMs <= 0) return 'Expired';
  const totalMin = Math.ceil(remMs / 60000);
  if (totalMin < 60) return `${totalMin}m`;
  const hrs = Math.floor(totalMin / 60);
  const mins = totalMin % 60;
  return mins ? `${hrs}h ${mins}m` : `${hrs}h`;
}

function isQuestionExpired(q) {
  return !!(q && q.status === 'pending' && Number(q.expiresAt) > 0 && Date.now() >= Number(q.expiresAt));
}

async function expireQuestionIfNeeded(q) {
  if (!isQuestionExpired(q)) return false;
  const qKey = q.id || `${q.askedAt || 0}`;
  if (expiredQuestionIdsSent.has(qKey)) return true;
  expiredQuestionIdsSent.add(qKey);
  if (expiredQuestionIdsSent.size > 30) {
    expiredQuestionIdsSent.delete(expiredQuestionIdsSent.values().next().value);
  }
  const now = Date.now();
  if (q.historyKey) {
    update(ref(db, `${basePath}/questionHistory/${q.historyKey}`), {
      status: 'expired',
      expiredAt: now
    }).catch(() => {});
  }
  if (!activeQuestionData || activeQuestionData.id === q.id) {
    await update(refs.quickQuestion, {
      status: 'expired',
      expiredAt: now
    }).catch(() => {});
  }
  return true;
}

function scheduleQuestionExpiryTimer(q) {
  clearTimeout(questionExpireTimer);
  questionExpireTimer = null;
  if (!q || q.status !== 'pending' || !(Number(q.expiresAt) > 0)) return;
  const delayMs = Math.max(0, Number(q.expiresAt) - Date.now());
  if (delayMs === 0) {
    expireQuestionIfNeeded(q);
    return;
  }
  // Cap single setTimeout delay to 24h max safe timer; re-checks automatically on wake
  questionExpireTimer = setTimeout(() => {
    if (isQuestionExpired(activeQuestionData)) {
      if (role === 'nana' && $('nana-question-modal')) $('nana-question-modal').style.display = 'none';
      expireQuestionIfNeeded(activeQuestionData);
      if (role === 'family') refreshFamilyQuestionStatusUI();
    }
  }, Math.min(delayMs + 250, 2147483000));
}

window.setFamilyQuestionTimeout = (mins) => {
  selectedQuestionTimeoutMin = Math.max(0, Number(mins) || 0);
  document.querySelectorAll('.fam-q-timeout-btn').forEach(btn => {
    btn.classList.toggle('selected', Number(btn.dataset.qtimeout) === selectedQuestionTimeoutMin);
  });
};

// --- 1. RENDER LAST 5 FAMILY QUESTIONS LOG & ASK AGAIN ---
function formatQuestionTimestamp(ms) {
  if (!ms) return '';
  const d = new Date(ms);
  const isToday = d.toDateString() === new Date().toDateString();
  const timeStr = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  return isToday
    ? `Today ${timeStr}`
    : `${d.toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' })} ${timeStr}`;
}

function renderFamilyQuestionHistory() {
  const box = $('fam-q-history-box');
  if (!box) return;
  const entries = Object.entries(state.questionHistorySnap || {})
    .map(([k, v]) => ({ key: k, ...v }))
    .filter(item => item && item.question)
    .sort((a, b) => (b.askedAt || 0) - (a.askedAt || 0))
    .slice(0, 5);

  if (!entries.length) {
    box.innerHTML = `<div style="color:#94a3b8;font-size:0.84rem;padding:6px;">No questions asked yet.</div>`;
    return;
  }

  box.innerHTML = '';
  entries.forEach(item => {
    const askedStr = formatQuestionTimestamp(item.askedAt);
    const tLabel = Number(item.timeoutMin) > 0 ? ` • ⏱️ ${formatTimeoutLabel(item.timeoutMin)}` : '';
    const effectiveExpired = item.status === 'expired' || isQuestionExpired(item);
    let ansBadge = `<span style="color:#facc15;">⏳ Waiting for answer</span>`;
    if (item.status === 'answered') {
      const ansTime = item.answeredAt ? new Date(item.answeredAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
      ansBadge = item.answer === 'YES'
        ? `<span style="color:#4ade80;">✅ Answered YES${ansTime ? ' at ' + ansTime : ''}</span>`
        : `<span style="color:#f87171;">✖ Answered NO${ansTime ? ' at ' + ansTime : ''}</span>`;
    } else if (effectiveExpired) {
      ansBadge = `<span style="color:#94a3b8;">⌛ Timed out</span>`;
    } else if (item.status === 'cleared') {
      ansBadge = `<span style="color:#94a3b8;">✖ Cleared</span>`;
    }

    const row = document.createElement('div');
    row.className = 'fam-q-hist-item';
    row.innerHTML = `
      <div class="fam-q-hist-info">
        <div class="fam-q-hist-text">"${esc(item.question)}"</div>
        <div class="fam-q-hist-meta">👤 ${esc(item.askedBy || 'Family')} • ${askedStr}${tLabel} • ${ansBadge}</div>
      </div>
      <button class="fam-q-mini-btn" style="background:#059669;border-color:#4ade80;padding:6px 10px;white-space:nowrap;" title="Send this question to Nana's screen again">🔄 Ask Again</button>
    `;
    row.querySelector('button').onclick = () => {
      if (item.type === 'idle_video_prompt') {
        return window.sendQuickMediaPromptToNana('video');
      }
      return dispatchFamilyQuestionPopup(item.question, {
        type: item.type || 'family_question',
        manualPrompt: !!(item.manualPrompt || item.type === 'idle_radio_prompt' || item.type === 'idle_patience_prompt')
      });
    };
    box.appendChild(row);
  });
}

onValue(query(refs.questionHistory, limitToLast(10)), snap => {
  state.questionHistorySnap = snap.val() || {};
  if (role === 'family') renderFamilyQuestionHistory();
});

// --- 2. TIME-OF-DAY (:00 & :30) & UNREAD CHAT POP-UP ENGINE ---
function hasUnreadFamilyChatMessages() {
  return Object.values(state.bulletinSnap).some(item => NanaCore.isMessageUnreadByNana?.(item));
}

async function evaluateScheduledPopupsOnNana() {
  if (role !== 'nana') return;
  if (isQuestionExpired(activeQuestionData)) {
    if ($('nana-question-modal')) $('nana-question-modal').style.display = 'none';
    await expireQuestionIfNeeded(activeQuestionData);
  }
  if (!settings.periodicPopupsEnabled || NanaCore.isCurrentlyInNightWindow?.()) return;
  if (state.callSnap?.status && state.callSnap.status !== 'idle') return;
  if (activeQuestionData?.status === 'pending') return;
  if ($('nana-question-modal')?.style.display === 'flex' || $('confirm-modal')?.style.display === 'flex') return;

  const now = Date.now();
  if (now - lastAnyPeriodicPromptMs < 120000) return;

  const chatOpen = $('bulletin-modal')?.style.display === 'flex';
  const radioOpenOrPlaying = $('radio-screen')?.classList.contains('active') || (state.entSnap?.activeKey && state.entSnap.activeKey !== 'off');
  const videoPlaying = !!NanaCore.isNanaVideoActivelyPlaying?.();

  const unreadMin = Number(settings.unreadChatPopupMin ?? 30);
  if (unreadMin > 0 && !chatOpen && !videoPlaying && hasUnreadFamilyChatMessages()) {
    if (now - lastUnreadChatPromptMs >= unreadMin * 60000) {
      lastUnreadChatPromptMs = now;
      lastAnyPeriodicPromptMs = now;
      await askNana('unread_chat_prompt', 'You have unread messages, would you like to read them?', 'Family Chat');
      return;
    }
  }

  // During Low Power Mode, skip Radio and Video prompts (Unread Family Chat prompts above remain active)
  if (NanaCore.isLowPowerMode?.() || chatOpen || radioOpenOrPlaying || videoPlaying) return;
  if (now - state.lastActivityOrCallMs < 180000) return;

  const d = new Date();
  const curHour = d.getHours(), curMin = d.getMinutes();

  let activeSlot = null;
  if (curMin >= 0 && curMin <= 20) activeSlot = curHour;
  else if (curMin >= 30 && curMin <= 50) activeSlot = curHour + 0.5;

  if (activeSlot !== null) {
    const slotKey = `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}_${activeSlot}`;
    const radioList = (settings.radioPromptHours || []).map(Number);
    const videoList = (settings.videoPromptHours || []).map(Number);

    if (radioList.includes(activeSlot)) {
      const storageKey = `nana_sched_radio_${slotKey}`;
      if (!localStorage.getItem(storageKey)) {
        localStorage.setItem(storageKey, '1');
        lastAnyPeriodicPromptMs = now;
        await askNana('idle_radio_prompt', 'Would you like to listen to Classic FM?', 'Classic FM Radio');
        return;
      }
    }

    if (videoList.includes(activeSlot) && (state.streamData?.queue || []).length > 0) {
      const storageKey = `nana_sched_video_${slotKey}`;
      if (!localStorage.getItem(storageKey)) {
        localStorage.setItem(storageKey, '1');
        lastAnyPeriodicPromptMs = now;
        await askNana('idle_video_prompt', 'Would you like to watch Judge John Deed?', 'Video Player');
      }
    }
  }
}

if (role === 'nana') setInterval(evaluateScheduledPopupsOnNana, 20000);

// --- 3. QUESTION DISPATCH, QUICK MEDIA PROMPTS, EXPIRY & NANA YES/NO ANSWER ---
async function dispatchFamilyQuestionPopup(questionText, opts = {}) {
  const text = (questionText || '').trim();
  if (!text) return alert("Please type a question for Nana first.");
  const qType = opts.type || 'family_question';
  const manualPrompt = opts.manualPrompt !== undefined ? !!opts.manualPrompt : (qType !== 'family_question');
  const timeoutMin = Math.max(0, Number(opts.timeoutMin ?? selectedQuestionTimeoutMin ?? 30));
  const now = Date.now();
  const expiresAt = timeoutMin > 0 ? (now + timeoutMin * 60000) : 0;
  const currentSender = NanaCore.senderName || senderName || 'Family';

  const histNode = await push(refs.questionHistory, {
    type: qType,
    manualPrompt,
    question: text,
    askedBy: currentSender,
    silent: state.familyComposerSilent,
    timeoutMin,
    expiresAt,
    status: 'pending',
    answer: null,
    askedAt: now
  });
  await askNana(qType, text, currentSender, {
    historyKey: histNode.key,
    silent: state.familyComposerSilent,
    manualPrompt,
    timeoutMin,
    expiresAt
  });
}

window.sendQuestionToNana = async () => {
  const input = $('fam-q-input');
  const text = (input?.value || '').trim();
  if (!text) return alert("Please type a question for Nana first.");
  await dispatchFamilyQuestionPopup(text, { type: 'family_question', manualPrompt: false });
  if (input) input.value = '';
};

window.sendQuickMediaPromptToNana = async (kind) => {
  if (role !== 'family') return;
  if (kind === 'radio') {
    await dispatchFamilyQuestionPopup('Would you like to listen to Classic FM Radio?', {
      type: 'idle_radio_prompt',
      manualPrompt: true
    });
    return;
  }
  if (kind === 'video') {
    const lpMode = settings.lowPowerModeSetting || 'auto';
    const lpActive = lpMode === 'on' || (lpMode === 'auto' && (state.presenceSnap?.isCharging === false || !!state.presenceSnap?.lowPowerMode));
    if (lpActive && settings.lowPowerBlockVideo !== false) {
      if (!confirm("Nana's tablet appears to be unplugged / in Low Power Mode (which blocks video playback). Send the Judge John Deed pop-up anyway?")) {
        return;
      }
    }
    await dispatchFamilyQuestionPopup('Would you like to watch Judge John Deed?', {
      type: 'idle_video_prompt',
      manualPrompt: true
    });
    return;
  }
  if (kind === 'patience') {
    await dispatchFamilyQuestionPopup('Would you like to play Patience?', {
      type: 'idle_patience_prompt',
      manualPrompt: true
    });
  }
};

window.askFamilyQuestionAgain = (questionText) => dispatchFamilyQuestionPopup(questionText);

window.clearQuestionOnNana = async () => {
  const now = Date.now();
  if (activeQuestionData?.historyKey) {
    update(ref(db, `${basePath}/questionHistory/${activeQuestionData.historyKey}`), {
      status: 'cleared',
      clearedAt: now
    }).catch(() => {});
  }
  await set(refs.quickQuestion, { status: 'cleared', updatedAt: now });
};

// --- 3B. GUIDED NAVIGATION STAR (TEACHES NANA HOW TO NAVIGATE AFTER TAPPING YES) ---
const GUIDED_STAR_SVG = `
<svg viewBox="0 0 100 100" aria-hidden="true">
  <defs>
    <radialGradient id="nanaStarGrad" cx="42%" cy="34%" r="68%">
      <stop offset="0%" stop-color="#ffffff"/>
      <stop offset="32%" stop-color="#fef08a"/>
      <stop offset="72%" stop-color="#facc15"/>
      <stop offset="100%" stop-color="#d97706"/>
    </radialGradient>
  </defs>
  <path d="M50 5 L62.5 34.5 L95 37.5 L70.2 58.6 L77.8 90.5 L50 73.4 L22.2 90.5 L29.8 58.6 L5 37.5 L37.5 34.5 Z"
        fill="url(#nanaStarGrad)" stroke="#ffffff" stroke-width="4.5" stroke-linejoin="round"/>
</svg>`;

let guidedStarRunToken = 0;

function cancelGuidedStarTour() {
  guidedStarRunToken++;
  const layer = $('nana-guided-star-layer');
  if (layer) {
    layer.innerHTML = '';
    layer.style.display = 'none';
  }
  document.querySelectorAll('.nana-star-target-pulse').forEach(el => el.classList.remove('nana-star-target-pulse'));
}

function getGuidedStarConfig() {
  const speedKey = settings.guidedStarSpeed || 'normal';
  const sizeKey = settings.guidedStarSize || 'large';
  const engKey = settings.guidedStarEngagement || 'lively';

  const speedTable = {
    very_slow: { travelMs: 2200, prePauseMs: 560, clickMs: 520, postPauseMs: 420 },
    slow:      { travelMs: 1550, prePauseMs: 420, clickMs: 420, postPauseMs: 320 },
    normal:    { travelMs: 1050, prePauseMs: 300, clickMs: 340, postPauseMs: 240 },
    fast:      { travelMs: 650,  prePauseMs: 180, clickMs: 240, postPauseMs: 160 }
  };
  const sizeTable = { small: 44, medium: 62, large: 82, xl: 106 };
  const engTable = {
    gentle: { cls: 'eng-gentle', enlargeScale: 1.35, sparkles: 6,  trailEveryMs: 0,  chime: false, doubleRipple: false },
    normal: { cls: 'eng-normal', enlargeScale: 1.58, sparkles: 10, trailEveryMs: 85, chime: true,  doubleRipple: false },
    lively: { cls: 'eng-lively', enlargeScale: 1.82, sparkles: 16, trailEveryMs: 50, chime: true,  doubleRipple: true }
  };

  return {
    ...(speedTable[speedKey] || speedTable.normal),
    sizePx: sizeTable[sizeKey] || 82,
    ...(engTable[engKey] || engTable.lively)
  };
}

function isGuidedStarEnabledForFeature(featureKey) {
  if (role !== 'nana') return false;
  if (settings.guidedStarEnabled === false) return false;
  const flagMap = {
    chat: 'guidedStarChat',
    radio: 'guidedStarRadio',
    video: 'guidedStarVideo',
    patience: 'guidedStarPatience'
  };
  const k = flagMap[featureKey];
  return k ? (settings[k] !== false) : false;
}

function playStarSparkleChime(isSilent) {
  if (isSilent || NanaCore.isCurrentlyInNightWindow?.()) return;
  try {
    const ctx = NanaCore.audioCtx;
    if (!ctx) return;
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    const notes = [880, 1174.66, 1567.98];
    notes.forEach((freq, i) => {
      const t = ctx.currentTime + i * 0.055;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, t);
      gain.gain.setValueAtTime(0.09, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.22);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(t);
      osc.stop(t + 0.24);
    });
  } catch (_) {}
}

function getVisibleNavButton(pillClass) {
  const candidates = [];
  if ($('bulletin-modal')?.style.display === 'flex') {
    candidates.push(document.querySelector(`#bulletin-modal .tg-header .${pillClass}`));
  }
  const activeScreen = document.querySelector('.screen.active');
  if (activeScreen) {
    candidates.push(activeScreen.querySelector(`.${pillClass}`));
  }
  candidates.push(document.querySelector(`.${pillClass}`));
  for (const el of candidates) {
    if (!el) continue;
    const r = el.getBoundingClientRect();
    if (r.width > 0 && r.height > 0) return el;
  }
  return null;
}

function getElementCenter(el) {
  if (!el) return null;
  const r = el.getBoundingClientRect();
  if (r.width <= 0 || r.height <= 0) return null;
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}

function isGuidedStarBlockedNow() {
  if (state.currentState && state.currentState !== 'idle') return true;
  if ($('confirm-modal')?.style.display === 'flex') return true;
  if ($('admin-pin-modal')?.style.display === 'flex') return true;
  if ($('care-home-staff-modal')?.style.display === 'flex') return true;
  return false;
}

function waitGuidedMs(ms, token) {
  return new Promise(resolve => {
    setTimeout(() => {
      const stillOk = token === guidedStarRunToken && !isGuidedStarBlockedNow();
      resolve(stillOk);
    }, ms);
  });
}

function ensureGuidedStarLayer() {
  let layer = $('nana-guided-star-layer');
  if (!layer) {
    layer = document.createElement('div');
    layer.id = 'nana-guided-star-layer';
    document.body.appendChild(layer);
  }
  return layer;
}

function spawnStarSparkles(layer, x, y, cfg) {
  const glyphs = ['✦', '★', '✧', '•'];
  const ripple = document.createElement('div');
  ripple.className = 'nana-star-ripple';
  ripple.style.left = `${x}px`;
  ripple.style.top = `${y}px`;
  ripple.style.width = `${Math.round(cfg.sizePx * 1.15)}px`;
  ripple.style.height = `${Math.round(cfg.sizePx * 1.15)}px`;
  layer.appendChild(ripple);
  setTimeout(() => ripple.remove(), 620);

  if (cfg.doubleRipple) {
    setTimeout(() => {
      if (!layer.isConnected) return;
      const r2 = document.createElement('div');
      r2.className = 'nana-star-ripple';
      r2.style.left = `${x}px`;
      r2.style.top = `${y}px`;
      r2.style.width = `${Math.round(cfg.sizePx * 1.35)}px`;
      r2.style.height = `${Math.round(cfg.sizePx * 1.35)}px`;
      layer.appendChild(r2);
      setTimeout(() => r2.remove(), 620);
    }, 130);
  }

  for (let i = 0; i < cfg.sparkles; i++) {
    const sp = document.createElement('div');
    sp.className = 'nana-star-sparkle';
    const angle = (Math.PI * 2 * i) / cfg.sparkles + (Math.random() - 0.5) * 0.35;
    const dist = cfg.sizePx * (0.8 + Math.random() * 0.85);
    const dx = Math.round(Math.cos(angle) * dist);
    const dy = Math.round(Math.sin(angle) * dist);
    const spSize = Math.max(14, Math.round(cfg.sizePx * (0.24 + Math.random() * 0.16)));
    sp.textContent = glyphs[i % glyphs.length];
    sp.style.left = `${x}px`;
    sp.style.top = `${y}px`;
    sp.style.fontSize = `${spSize}px`;
    sp.style.setProperty('--sp-dx', `${dx}px`);
    sp.style.setProperty('--sp-dy', `${dy}px`);
    sp.style.setProperty('--sp-rot', `${Math.round((Math.random() - 0.5) * 260)}deg`);
    sp.style.setProperty('--sp-dur', `${460 + Math.round(Math.random() * 200)}ms`);
    layer.appendChild(sp);
    setTimeout(() => sp.remove(), 720);
  }
}

function glideStarArc(layer, starEl, fromPt, toPt, cfg, token) {
  return new Promise(resolve => {
    const startMs = performance.now();
    let lastTrailMs = 0;
    const half = cfg.sizePx / 2;
    const midX = (fromPt.x + toPt.x) / 2;
    const midY = (fromPt.y + toPt.y) / 2;
    const dist = Math.hypot(toPt.x - fromPt.x, toPt.y - fromPt.y);
    const arcLift = Math.min(110, Math.max(24, dist * 0.18));
    const ctrlX = midX + (toPt.y >= fromPt.y ? 18 : -18);
    const ctrlY = Math.max(36, midY - arcLift);

    const frame = (now) => {
      if (token !== guidedStarRunToken || isGuidedStarBlockedNow()) {
        resolve(false);
        return;
      }
      const rawT = Math.min(1, (now - startMs) / cfg.travelMs);
      const t = rawT < 0.5 ? 4 * rawT * rawT * rawT : 1 - Math.pow(-2 * rawT + 2, 3) / 2;
      const omt = 1 - t;
      const x = omt * omt * fromPt.x + 2 * omt * t * ctrlX + t * t * toPt.x;
      const y = omt * omt * fromPt.y + 2 * omt * t * ctrlY + t * t * toPt.y;
      const rot = t * 180;
      const scale = 0.92 + Math.sin(t * Math.PI) * 0.2;
      starEl.style.transform = `translate3d(${x - half}px, ${y - half}px, 0) scale(${scale.toFixed(3)}) rotate(${rot.toFixed(1)}deg)`;

      if (cfg.trailEveryMs > 0 && now - lastTrailMs >= cfg.trailEveryMs && rawT > 0.05 && rawT < 0.95) {
        lastTrailMs = now;
        const dot = document.createElement('div');
        dot.className = 'nana-star-trail-dot';
        const dotSz = Math.max(8, Math.round(cfg.sizePx * 0.22));
        dot.style.left = `${x}px`;
        dot.style.top = `${y}px`;
        dot.style.width = `${dotSz}px`;
        dot.style.height = `${dotSz}px`;
        layer.appendChild(dot);
        setTimeout(() => dot.remove(), 580);
      }

      if (rawT < 1) {
        requestAnimationFrame(frame);
      } else {
        starEl.style.transform = `translate3d(${toPt.x - half}px, ${toPt.y - half}px, 0) scale(1) rotate(0deg)`;
        resolve(true);
      }
    };
    requestAnimationFrame(frame);
  });
}

async function runGuidedStarTour(featureKey, startPt, steps, isSilent) {
  if (!isGuidedStarEnabledForFeature(featureKey)) {
    for (const s of steps) {
      await s.action?.();
    }
    return;
  }

  cancelGuidedStarTour();
  const token = guidedStarRunToken;
  const cfg = getGuidedStarConfig();
  const layer = ensureGuidedStarLayer();
  layer.innerHTML = '';
  layer.style.display = 'block';

  const starEl = document.createElement('div');
  starEl.className = `nana-guided-star ${cfg.cls}`;
  starEl.style.width = `${cfg.sizePx}px`;
  starEl.style.height = `${cfg.sizePx}px`;
  starEl.innerHTML = GUIDED_STAR_SVG;

  const half = cfg.sizePx / 2;
  let curPt = startPt || { x: window.innerWidth / 2, y: window.innerHeight * 0.65 };
  starEl.style.opacity = '0';
  starEl.style.transform = `translate3d(${curPt.x - half}px, ${curPt.y - half}px, 0) scale(0.45)`;
  layer.appendChild(starEl);
  void starEl.offsetWidth;

  // Pop-in at YES button
  starEl.style.transition = 'transform 220ms cubic-bezier(0.22, 1, 0.36, 1), opacity 180ms ease';
  starEl.style.opacity = '1';
  starEl.style.transform = `translate3d(${curPt.x - half}px, ${curPt.y - half}px, 0) scale(1.12)`;
  if (!(await waitGuidedMs(230, token))) { cancelGuidedStarTour(); return; }
  starEl.style.transition = 'none';

  for (const step of steps) {
    if (token !== guidedStarRunToken || isGuidedStarBlockedNow()) {
      cancelGuidedStarTour();
      return;
    }
    window.wakeScreenAndResetDimTimer?.();
    const targetEl = step.getTarget?.();
    const targetPt = getElementCenter(targetEl);
    if (!targetEl || !targetPt) {
      await step.action?.();
      continue;
    }

    const okGlide = await glideStarArc(layer, starEl, curPt, targetPt, cfg, token);
    if (!okGlide) { cancelGuidedStarTour(); return; }
    curPt = targetPt;

    // Highlight button & brief gaze pause before the fake click
    targetEl.classList.add('nana-star-target-pulse');
    if (!(await waitGuidedMs(cfg.prePauseMs, token))) {
      targetEl.classList.remove('nana-star-target-pulse');
      cancelGuidedStarTour();
      return;
    }

    // Fake click: enlarge star + emit sparkles + gentle chime
    starEl.style.transition = `transform ${Math.round(cfg.clickMs * 0.52)}ms cubic-bezier(0.22, 1, 0.36, 1)`;
    starEl.style.transform = `translate3d(${curPt.x - half}px, ${curPt.y - half}px, 0) scale(${cfg.enlargeScale}) rotate(18deg)`;
    spawnStarSparkles(layer, curPt.x, curPt.y, cfg);
    if (cfg.chime) playStarSparkleChime(isSilent);

    if (!(await waitGuidedMs(Math.round(cfg.clickMs * 0.55), token))) {
      targetEl.classList.remove('nana-star-target-pulse');
      cancelGuidedStarTour();
      return;
    }

    // Settle star back down and execute the real navigation click
    starEl.style.transition = `transform ${Math.round(cfg.clickMs * 0.45)}ms ease-in`;
    starEl.style.transform = `translate3d(${curPt.x - half}px, ${curPt.y - half}px, 0) scale(0.95) rotate(0deg)`;
    targetEl.classList.remove('nana-star-target-pulse');
    await step.action?.();

    if (!(await waitGuidedMs(cfg.postPauseMs, token))) {
      cancelGuidedStarTour();
      return;
    }
    starEl.style.transition = 'none';
  }

  // Gentle fade-out at final destination
  starEl.style.transition = 'opacity 260ms ease, transform 260ms ease';
  starEl.style.opacity = '0';
  starEl.style.transform = `translate3d(${curPt.x - half}px, ${curPt.y - half}px, 0) scale(0.45)`;
  await waitGuidedMs(280, token);
  if (token === guidedStarRunToken) cancelGuidedStarTour();
}

window.submitNanaQuestionAnswer = async (choice) => {
  if (!activeQuestionData || activeQuestionData.status !== 'pending') return;
  const qData = activeQuestionData;
  activeQuestionData = { ...activeQuestionData, status: 'answered' };
  const yesBtnCenter = choice === 'YES' ? getElementCenter(document.querySelector('#nana-question-modal .q-yes-btn')) : null;
  $('nana-question-modal').style.display = 'none';
  if (isQuestionExpired(qData)) {
    await expireQuestionIfNeeded(qData);
    return;
  }

  const isSilent = !!(qData.silent || !settings.speakQuestions);
  state.lastActivityOrCallMs = Date.now();
  window.wakeScreenAndResetDimTimer?.();

  const now = Date.now();
  await update(refs.quickQuestion, { status: 'answered', answer: choice, answeredAt: now });

  if (qData.historyKey) {
    update(ref(db, `${basePath}/questionHistory/${qData.historyKey}`), {
      status: 'answered',
      answer: choice,
      answeredAt: now
    }).catch(() => {});
  }

  // Handle "Are you sure you want to leave the video?" confirmation
  if (qData.type === 'leave_video_prompt') {
    if (choice === 'YES') {
      window.switchNanaMainTab?.(qData.targetTab || 'calls', true);
    } else {
      hooks.resumeVideo?.();
    }
    return;
  }

  // Handle "Are you sure you want to return to the start of the episode?"
  if (qData.type === 'restart_video_prompt') {
    if (choice === 'YES') {
      await hooks.confirmRestartVideo?.();
    } else if (qData.resumeOnCancel) {
      hooks.resumeVideo?.();
    }
    return;
  }

  // Advance to next video in queue after Nana's confirmation at the end of an episode
  if (qData.type === 'next_video_prompt') {
    const targetIdx = Number(qData.nextIndex) || 0;
    const nextItem = state.streamData.queue?.[targetIdx];
    if (choice === 'YES') {
      if (nextItem) localStorage.setItem(`nana_vid_pos_${nextItem.url}`, '0');
      const blockedLowPower = !!NanaCore.isVideoBlockedByLowPower?.();
      const updatePayload = {
        currentIndex: targetIdx,
        state: blockedLowPower ? 'paused' : 'playing',
        updatedAt: now
      };
      if (blockedLowPower) updatePayload.pauseReason = 'low_power_unplugged';
      if (nextItem?.id) updatePayload[`savedTimes/${nextItem.id}`] = 0;
      await update(refs.videoStream, updatePayload);
      if (blockedLowPower) hooks.syncVideoUI?.();
    }
    return;
  }

  if (qData.type === 'unread_chat_prompt') {
    lastUnreadChatPromptMs = now;
    if (choice === 'YES') {
      const steps = [{
        getTarget: () => getVisibleNavButton('chat-pill-x'),
        action: () => window.openFamilyBulletin?.()
      }];
      await runGuidedStarTour('chat', yesBtnCenter, steps, isSilent);
    }
    return;
  }

  if (qData.type === 'idle_radio_prompt') {
    if (choice === 'YES') {
      const steps = [];
      const alreadyOnRadio = $('radio-screen')?.classList.contains('active') && $('bulletin-modal')?.style.display !== 'flex';
      if (!alreadyOnRadio) {
        steps.push({
          getTarget: () => getVisibleNavButton('radio-pill-x'),
          action: () => {
            if ($('bulletin-modal')?.style.display === 'flex') window.closeFamilyBulletin?.();
            hooks.pauseVideo?.('switched_tab');
            window.openRadioScreen?.();
          }
        });
      }
      steps.push({
        getTarget: () => $('btn-classicfm'),
        action: () => set(refs.entertainment, { activeKey: "classicfm", title: "Classic FM Radio 🎻", timestamp: Date.now() }).catch(() => {})
      });
      await runGuidedStarTour('radio', yesBtnCenter, steps, isSilent);
    }
    return;
  }

  // Resume Nana's CURRENT active episode without ever changing currentIndex!
  if (qData.type === 'idle_video_prompt') {
    if (choice === 'YES') {
      const steps = [];
      const alreadyOnVideo = $('video-screen')?.classList.contains('active') && $('bulletin-modal')?.style.display !== 'flex';
      if (!alreadyOnVideo) {
        steps.push({
          getTarget: () => getVisibleNavButton('video-pill-x'),
          action: () => window.openVideoScreen?.()
        });
      }
      steps.push({
        getTarget: () => $('btn-bottom-video-toggle') || $('video-stage-touch'),
        action: async () => {
          if ((state.streamData.queue || []).length) {
            const blockedLowPower = !!NanaCore.isVideoBlockedByLowPower?.();
            await update(refs.videoStream, blockedLowPower
              ? { state: 'paused', pauseReason: 'low_power_unplugged', updatedAt: Date.now() }
              : { state: 'playing', updatedAt: Date.now() }
            ).catch(() => {});
          }
        }
      });
      await runGuidedStarTour('video', yesBtnCenter, steps, isSilent);
    }
    return;
  }

  if (qData.type === 'idle_patience_prompt') {
    if (choice === 'YES') {
      const steps = [];
      const alreadyOnHome = $('grid-screen')?.classList.contains('active') && $('bulletin-modal')?.style.display !== 'flex';
      if (!alreadyOnHome) {
        steps.push({
          getTarget: () => getVisibleNavButton('calls-pill'),
          action: () => {
            if ($('bulletin-modal')?.style.display === 'flex') window.closeFamilyBulletin?.();
            hooks.pauseVideo?.('switched_tab');
            window.stopRadioAndSync?.(true);
            NanaCore.showScreen?.('grid-screen');
            hooks.renderContacts?.(state.connectedMemberIds);
          }
        });
      }
      steps.push({
        getTarget: () => {
          const gridCard = document.querySelector('#family-grid .patience-card');
          return getElementCenter(gridCard) ? gridCard : $('calling-off-patience-btn');
        },
        action: () => window.switchNanaMainTab?.('patience', true)
      });
      await runGuidedStarTour('patience', yesBtnCenter, steps, isSilent);
    }
    return;
  }

  const qText = qData.question || '', askedBy = qData.askedBy || 'Family';
  const replySummary = `${choice === 'YES' ? '✅ YES' : '✖ NO'} — (In reply to ${askedBy}: "${qText}")`;
  await push(refs.bulletin, { author: 'Nana', fromNana: true, text: replySummary, timestamp: now, readByNanaAt: now });

  fetch(GOOGLE_SCRIPT_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ secret: SERVICE_TOKEN, portalNode: PORTAL_NODE_ID, action: "nana_reply", author: "Nana", text: replySummary })
  }).catch(() => {});

  if (!isSilent) window.speakNote?.(`Sent ${choice} to ${askedBy}`);
};

function showNanaQuestionPopup() {
  if (role !== 'nana') return;
  const modal = $('nana-question-modal');
  if (!modal) return;
  const q = activeQuestionData;
  if (isQuestionExpired(q)) {
    modal.style.display = 'none';
    expireQuestionIfNeeded(q);
    return;
  }
  const inCall = !!state.currentState && state.currentState !== 'idle';
  if (inCall) cancelGuidedStarTour();
  if (q && q.status === 'pending' && q.question && !inCall) {
    cancelGuidedStarTour();
    if (!q.manualPrompt && NanaCore.isLowPowerMode?.() && (q.type === 'idle_radio_prompt' || q.type === 'idle_video_prompt')) {
      modal.style.display = 'none';
      return;
    }
    // Do not call pauseVideo when the video has already ended and is showing next_video_prompt
    if (q.type !== 'next_video_prompt') {
      hooks.pauseVideo?.('question_popup');
    }
    const isSilent = !!(q.silent || !settings.speakQuestions);
    const badgeMap = {
      leave_video_prompt: '🎬 Leave Video Player?',
      restart_video_prompt: '⏮️ Restart Video?',
      next_video_prompt: '🎬 Up Next in Video Queue',
      unread_chat_prompt: '✈️ Unread Family Chat Messages',
      idle_radio_prompt: '🎻 Classic FM Radio',
      idle_video_prompt: '🎬 Family Video Suggestion',
      idle_patience_prompt: '🕷️ Patience Card Game'
    };
    $('q-popup-sender').innerText = badgeMap[q.type] || `❓ Question from ${q.askedBy || 'Family'}`;
    $('q-popup-text').innerText = q.question;
    modal.style.display = 'flex';
    if (q.id !== lastHandledQuestionId) {
      lastHandledQuestionId = q.id;
      try { if (q.id) localStorage.setItem('nana_last_handled_qid', String(q.id)); } catch (_) {}
      const inNight = !!NanaCore.isCurrentlyInNightWindow?.();
      if (!inNight) {
        window.wakeFromNightMode?.();
        hooks.startNormalDimCountdownOnPause?.();
        if (!isSilent) {
          const isSystemPrompt = !!badgeMap[q.type];
          window.speakNote?.(isSystemPrompt ? `${q.question} Touch Yes or No.` : `${q.askedBy || 'Family'} asks: ${q.question}. Touch Yes or No.`);
        }
      }
    }
  } else {
    modal.style.display = 'none';
  }
}
window.refreshNanaQuestionPopup = showNanaQuestionPopup;

function refreshFamilyQuestionStatusUI() {
  if (role !== 'family') return;
  const st = $('fam-q-status');
  if (!st) return;
  const q = activeQuestionData;
  if (isQuestionExpired(q)) {
    expireQuestionIfNeeded(q);
  }
  if (!q || q.status === 'cleared') {
    st.innerText = 'No active popup';
    st.style.color = '#94a3b8';
  } else if (q.status === 'expired' || isQuestionExpired(q)) {
    st.innerText = '⌛ Pop-up timed out (not answered)';
    st.style.color = '#94a3b8';
  } else if (q.status === 'pending') {
    const modeTag = (q.silent || !settings.speakQuestions) ? '🔇 Silent' : '🔊 Spoken';
    const remTag = Number(q.expiresAt) > 0 ? ` • ⏱️ ${formatRemainingTime(q.expiresAt)} left` : '';
    st.innerText = `⏳ Showing (${modeTag}${remTag}): "${q.question}"`;
    st.style.color = '#facc15';
  } else if (q.status === 'answered') {
    const ansTime = q.answeredAt ? new Date(q.answeredAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
    st.innerText = `Nana answered: ${q.answer === 'YES' ? '✅ YES' : '✖ NO'} (${ansTime})`;
    st.style.color = q.answer === 'YES' ? '#4ade80' : '#f87171';
  }
}

if (role === 'family') {
  setInterval(() => {
    if (activeQuestionData?.status === 'pending' && Number(activeQuestionData.expiresAt) > 0) {
      refreshFamilyQuestionStatusUI();
    }
  }, 15000);
}

onValue(refs.quickQuestion, snap => {
  const q = snap.val();
  activeQuestionData = q;
  scheduleQuestionExpiryTimer(q);
  if (role === 'family') {
    refreshFamilyQuestionStatusUI();
  } else if (role === 'nana') {
    showNanaQuestionPopup();
  }
});