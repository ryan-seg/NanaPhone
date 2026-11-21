import { $, NanaCore, esc, askNana, ref, set, update, push, onValue, query, limitToLast } from "./nana-core.js?v=2.9.6";

const {
  SERVICE_TOKEN, PORTAL_NODE_ID, GOOGLE_SCRIPT_URL,
  basePath, db, role, senderName, refs, settings, state, hooks
} = NanaCore;

let activeQuestionData = null;
let lastUnreadChatPromptMs = Date.now();
let lastAnyPeriodicPromptMs = 0;
let lastHandledQuestionId = null;
let selectedQuestionTimeoutMin = 30;
let questionExpireTimer = null;
const expiredQuestionIdsSent = new Set();

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
        manualPrompt: !!(item.manualPrompt || item.type === 'idle_radio_prompt')
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

    if (videoList.includes(activeSlot)) {
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

  const histNode = await push(refs.questionHistory, {
    type: qType,
    manualPrompt,
    question: text,
    askedBy: senderName,
    silent: state.familyComposerSilent,
    timeoutMin,
    expiresAt,
    status: 'pending',
    answer: null,
    askedAt: now
  });
  await askNana(qType, text, senderName, {
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

window.submitNanaQuestionAnswer = async (choice) => {
  if (!activeQuestionData) return;
  const qData = activeQuestionData;
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
    if (choice === 'YES') window.openFamilyBulletin?.();
    return;
  }

  if (qData.type === 'idle_radio_prompt') {
    if (choice === 'YES') {
      window.openRadioScreen?.();
      set(refs.entertainment, { activeKey: "classicfm", title: "Classic FM Radio 🎻", timestamp: now }).catch(() => {});
    }
    return;
  }

  // Resume Nana's CURRENT active episode without ever changing currentIndex!
  if (qData.type === 'idle_video_prompt') {
    if (choice === 'YES') {
      window.openVideoScreen?.();
      if ((state.streamData.queue || []).length) {
        const blockedLowPower = !!NanaCore.isVideoBlockedByLowPower?.();
        await update(refs.videoStream, blockedLowPower
          ? { state: 'paused', pauseReason: 'low_power_unplugged', updatedAt: now }
          : { state: 'playing', updatedAt: now }
        ).catch(() => {});
      }
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
  if (q && q.status === 'pending' && q.question && !inCall) {
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
      idle_video_prompt: '🎬 Family Video Suggestion'
    };
    $('q-popup-sender').innerText = badgeMap[q.type] || `❓ Question from ${q.askedBy || 'Family'}`;
    $('q-popup-text').innerText = q.question;
    modal.style.display = 'flex';
    if (q.id !== lastHandledQuestionId) {
      lastHandledQuestionId = q.id;
      window.wakeFromNightMode?.();
      hooks.startNormalDimCountdownOnPause?.();
      if (!isSilent) {
        const isSystemPrompt = !!badgeMap[q.type];
        window.speakNote?.(isSystemPrompt ? `${q.question} Touch Yes or No.` : `${q.askedBy || 'Family'} asks: ${q.question}. Touch Yes or No.`);
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
