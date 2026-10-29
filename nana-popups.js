import { $, NanaCore, ref, set, update, push, onValue, query, limitToLast } from "./nana-core.js?v=2.9.3";

const {
  SERVICE_TOKEN, PORTAL_NODE_ID, GOOGLE_SCRIPT_URL,
  basePath, db, role, senderName, refs, settings, state, hooks
} = NanaCore;

let activeQuestionData = null;
let lastUnreadChatPromptMs = Date.now();
let lastAnyPeriodicPromptMs = 0;
let lastHandledQuestionId = null;

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
    let ansBadge = `<span style="color:#facc15;">⏳ Waiting for answer</span>`;
    if (item.status === 'answered') {
      const ansTime = item.answeredAt ? new Date(item.answeredAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
      ansBadge = item.answer === 'YES'
        ? `<span style="color:#4ade80;">✅ Answered YES${ansTime ? ' at ' + ansTime : ''}</span>`
        : `<span style="color:#f87171;">✖ Answered NO${ansTime ? ' at ' + ansTime : ''}</span>`;
    } else if (item.status === 'cleared') {
      ansBadge = `<span style="color:#94a3b8;">✖ Cleared</span>`;
    }

    const row = document.createElement('div');
    row.className = 'fam-q-hist-item';
    row.innerHTML = `
      <div class="fam-q-hist-info">
        <div class="fam-q-hist-text">"${item.question}"</div>
        <div class="fam-q-hist-meta">👤 ${item.askedBy || 'Family'} • ${askedStr} • ${ansBadge}</div>
      </div>
      <button class="fam-q-mini-btn" style="background:#059669;border-color:#4ade80;padding:6px 10px;white-space:nowrap;" title="Send this question to Nana's screen again">🔄 Ask Again</button>
    `;
    row.querySelector('button').onclick = () => window.askFamilyQuestionAgain(item.question);
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
  if (role !== 'nana' || !settings.periodicPopupsEnabled || NanaCore.isCurrentlyInNightWindow?.()) return;
  if (state.callSnap?.status && state.callSnap.status !== 'idle') return;
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
      await set(refs.quickQuestion, {
        id: `q_unread_${now}`,
        type: 'unread_chat_prompt',
        question: 'You have unread messages, would you like to read them?',
        askedBy: 'Family Chat',
        silent: !settings.speakQuestions,
        status: 'pending',
        answer: null,
        askedAt: now
      });
      return;
    }
  }

  if (chatOpen || radioOpenOrPlaying || videoPlaying) return;
  if (now - state.lastActivityOrCallMs < 180000) return;

  const d = new Date();
  const curHour = d.getHours(), curMin = d.getMinutes();

  // Match either :00 window (mins 0..20) or :30 window (mins 30..50)
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
        await set(refs.quickQuestion, {
          id: `q_schedradio_${now}`,
          type: 'idle_radio_prompt',
          question: 'Would you like to listen to Classic FM?',
          askedBy: 'Classic FM Radio',
          silent: !settings.speakQuestions,
          status: 'pending',
          answer: null,
          askedAt: now
        });
        return;
      }
    }

    if (videoList.includes(activeSlot)) {
      const storageKey = `nana_sched_video_${slotKey}`;
      if (!localStorage.getItem(storageKey)) {
        localStorage.setItem(storageKey, '1');
        lastAnyPeriodicPromptMs = now;
        await set(refs.quickQuestion, {
          id: `q_schedvideo_${now}`,
          type: 'idle_video_prompt',
          question: 'Would you like to watch Judge John Deed?',
          askedBy: 'Video Player',
          silent: !settings.speakQuestions,
          status: 'pending',
          answer: null,
          askedAt: now
        });
      }
    }
  }
}

if (role === 'nana') setInterval(evaluateScheduledPopupsOnNana, 20000);

// --- 3. QUESTION DISPATCH, CLEAR & NANA YES/NO ANSWER ---
async function dispatchFamilyQuestionPopup(questionText) {
  const text = (questionText || '').trim();
  if (!text) return alert("Please type a question for Nana first.");
  const now = Date.now();
  const histNode = await push(refs.questionHistory, {
    question: text,
    askedBy: senderName,
    silent: state.familyComposerSilent,
    status: 'pending',
    answer: null,
    askedAt: now
  });
  await set(refs.quickQuestion, {
    id: `q_${now}`,
    historyKey: histNode.key,
    type: 'family_question',
    question: text,
    askedBy: senderName,
    silent: state.familyComposerSilent,
    status: 'pending',
    answer: null,
    askedAt: now
  });
}

window.sendQuestionToNana = async () => {
  const input = $('fam-q-input');
  const text = (input?.value || '').trim();
  if (!text) return alert("Please type a question for Nana first.");
  await dispatchFamilyQuestionPopup(text);
  if (input) input.value = '';
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
  const isSilent = !!(qData.silent || !settings.speakQuestions);
  $('nana-question-modal').style.display = 'none';
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
      // Stay on video screen and resume playing from saved position
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

  if (qData.type === 'next_video_prompt') {
    const targetIdx = Number(qData.nextIndex) || 0;
    const nextItem = state.streamData.queue?.[targetIdx];
    if (nextItem) localStorage.setItem(`nana_vid_pos_${nextItem.url}`, '0');
    const updatePayload = { currentIndex: targetIdx, state: choice === 'YES' ? 'playing' : 'paused', updatedAt: now };
    if (nextItem?.id) updatePayload[`savedTimes/${nextItem.id}`] = 0;
    await update(refs.videoStream, updatePayload);
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

  if (qData.type === 'idle_video_prompt') {
    if (choice === 'YES') {
      window.openVideoScreen?.();
      const q = state.streamData.queue || [];
      if (q.length) {
        const jjdIdx = q.findIndex(item => /judge\s*john\s*deed/i.test(item.title || ''));
        const targetIdx = jjdIdx >= 0 ? jjdIdx : (state.streamData.currentIndex || 0);
        await update(refs.videoStream, { currentIndex: targetIdx, state: 'playing', updatedAt: now }).catch(() => {});
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

onValue(refs.quickQuestion, snap => {
  const q = snap.val();
  activeQuestionData = q;
  if (role === 'family') {
    const st = $('fam-q-status');
    if (!st) return;
    if (!q || q.status === 'cleared') {
      st.innerText = 'No active popup';
      st.style.color = '#94a3b8';
    } else if (q.status === 'pending') {
      const modeTag = (q.silent || !settings.speakQuestions) ? '🔇 Silent' : '🔊 Spoken';
      st.innerText = `⏳ Showing (${modeTag}): "${q.question}"`;
      st.style.color = '#facc15';
    } else if (q.status === 'answered') {
      const ansTime = q.answeredAt ? new Date(q.answeredAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
      st.innerText = `Nana answered: ${q.answer === 'YES' ? '✅ YES' : '✖ NO'} (${ansTime})`;
      st.style.color = q.answer === 'YES' ? '#4ade80' : '#f87171';
    }
  } else if (role === 'nana') {
    const modal = $('nana-question-modal');
    if (!modal) return;
    if (q && q.status === 'pending' && q.question) {
      hooks.pauseVideo?.('question_popup');
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
});