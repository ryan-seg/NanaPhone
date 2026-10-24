import { $, NanaCore, set, update, push, onValue, query, limitToLast } from "./nana-core.js?v=2.9.2";

(function initNanaPopups() {
  if (!NanaCore.SERVICE_TOKEN) return;
  const { SERVICE_TOKEN, PORTAL_NODE_ID, GOOGLE_SCRIPT_URL, role, senderName, refs, state, hooks } = NanaCore;

  // Inject Scheduled Prompts & Today's Calls Banner Toggle into Shared Settings Modal
  const sharedSettingsMount = $('shared-settings-cards');
  if (sharedSettingsMount) {
    const buildIntervalBtns = (settingKey, options) => options.map(([val, lbl]) =>
      `<button class="opt-btn" data-ppset="${settingKey}" data-ppval="${val}" onclick="updatePeriodicPopupSetting('${settingKey}', ${val})">${lbl}</button>`
    ).join('');

    const buildHourToggles = (listKey, hours) => hours.map(h =>
      `<button class="opt-btn" data-pphourlist="${listKey}" data-pphour="${h}" onclick="toggleScheduledPromptHour('${listKey}', ${h})">${String(h).padStart(2, '0')}:00</button>`
    ).join('');

    const periodicCard = document.createElement('div');
    periodicCard.className = 'settings-card';
    periodicCard.innerHTML = `
      <div class="settings-label">
        <span>💚 Today's Calls Memory Banner & Scheduled Prompts</span>
        <span id="lbl-periodic-summary" style="color:#38bdf8;font-size:0.88rem;">Active</span>
      </div>
      <div class="settings-sub">Reassures Nana with a summary of who she has spoken to today, and offers scheduled entertainment prompts.</div>
      <div class="opt-row" style="margin-bottom:8px;">
        <button class="opt-btn" data-ppset="showTodaysCallsBanner" data-ppval="true" onclick="updatePeriodicPopupSetting('showTodaysCallsBanner', true)">💚 Show Today's Calls Banner</button>
        <button class="opt-btn" data-ppset="showTodaysCallsBanner" data-ppval="false" onclick="updatePeriodicPopupSetting('showTodaysCallsBanner', false)">🙈 Hide Today's Calls Banner</button>
      </div>
      <div class="opt-row" style="margin-bottom:8px;">
        <button class="opt-btn" data-ppset="periodicPopupsEnabled" data-ppval="true" onclick="updatePeriodicPopupSetting('periodicPopupsEnabled', true)">✅ Scheduled Pop-Ups ON</button>
        <button class="opt-btn" data-ppset="periodicPopupsEnabled" data-ppval="false" onclick="updatePeriodicPopupSetting('periodicPopupsEnabled', false)">🔕 Scheduled Pop-Ups OFF</button>
      </div>
      <div class="settings-sub" style="margin-bottom:4px;">🎻 Classic FM Radio Prompt Times (Tap hours to toggle on/off):</div>
      <div class="opt-row" style="margin-bottom:8px;">
        ${buildHourToggles('radioPromptHours', [9, 10, 11, 13, 14, 15, 16, 19])}
        <button class="opt-btn" style="background:#7f1d1d;color:#fff;" onclick="clearScheduledPromptHours('radioPromptHours')">Off</button>
      </div>
      <div class="settings-sub" style="margin-bottom:4px;">🎬 Judge John Deed Video Prompt Times (Tap hours to toggle on/off):</div>
      <div class="opt-row" style="margin-bottom:8px;">
        ${buildHourToggles('videoPromptHours', [11, 14, 16, 17, 18, 19, 20])}
        <button class="opt-btn" style="background:#7f1d1d;color:#fff;" onclick="clearScheduledPromptHours('videoPromptHours')">Off</button>
      </div>
      <div class="settings-sub" style="margin-bottom:4px;">💬 Unread Family Chat Reminder ("You have unread messages, would you like to read them?"):</div>
      <div class="opt-row" style="margin-bottom:8px;">
        ${buildIntervalBtns('unreadChatPopupMin', [[0,'Off'],[15,'15m'],[30,'30m'],[60,'1h'],[120,'2h']])}
      </div>
      <div class="settings-sub" style="margin-bottom:4px;">🗣️ Pop-Up Question & Prompt Voice:</div>
      <div class="opt-row">
        <button id="global-q-voice-on" class="opt-btn selected" onclick="setGlobalQuestionSpeak(true)">🔊 Read Prompts Aloud</button>
        <button id="global-q-voice-off" class="opt-btn" onclick="setGlobalQuestionSpeak(false)">🔇 Silent Pop-Ups Only</button>
      </div>
    `;
    sharedSettingsMount.appendChild(periodicCard);
  }

  let periodicConfig = {
    showTodaysCallsBanner: true,
    periodicPopupsEnabled: true,
    unreadChatPopupMin: 30,
    radioPromptHours: [10, 15],
    videoPromptHours: [14, 19],
    nightModeEnabled: true,
    nightStartHour: 21,
    nightEndHour: 8,
    bulletinClearedAt: 0
  };
  NanaCore.periodicConfig = periodicConfig;

  let activeQuestionData = null;
  let lastUnreadChatPromptMs = Date.now();
  let lastAnyPeriodicPromptMs = 0;

  function parseHoursArray(val, fallback) {
    if (Array.isArray(val)) return val.map(Number).filter(n => !isNaN(n));
    if (val && typeof val === 'object') return Object.values(val).map(Number).filter(n => !isNaN(n));
    if (val === 'none') return [];
    return fallback;
  }

  function refreshPeriodicSettingsUI() {
    document.querySelectorAll('[data-ppset]').forEach(btn => {
      const k = btn.dataset.ppset, v = btn.dataset.ppval;
      btn.classList.toggle('selected', String(periodicConfig[k]) === String(v));
    });
    ['radioPromptHours', 'videoPromptHours'].forEach(listKey => {
      const arr = periodicConfig[listKey] || [];
      document.querySelectorAll(`[data-pphourlist="${listKey}"]`).forEach(btn => {
        const hr = Number(btn.dataset.pphour);
        btn.classList.toggle('selected', arr.includes(hr));
      });
    });
    const sumEl = $('lbl-periodic-summary');
    if (sumEl) {
      if (!periodicConfig.periodicPopupsEnabled) {
        sumEl.innerText = '🔕 Pop-Ups Off';
        sumEl.style.color = '#fca5a5';
      } else {
        const rHrs = (periodicConfig.radioPromptHours || []).map(h => `${String(h).padStart(2,'0')}:00`).join(', ') || 'Off';
        const vHrs = (periodicConfig.videoPromptHours || []).map(h => `${String(h).padStart(2,'0')}:00`).join(', ') || 'Off';
        sumEl.innerText = `Radio [${rHrs}] • Video [${vHrs}]`;
        sumEl.style.color = '#38bdf8';
      }
    }
    hooks.renderTodaysCallsBanner?.();
  }

  window.updatePeriodicPopupSetting = async (key, val) => {
    periodicConfig[key] = val;
    refreshPeriodicSettingsUI();
    await update(refs.settings, { [key]: val });
  };

  window.toggleScheduledPromptHour = async (listKey, hour) => {
    const cur = [...(periodicConfig[listKey] || [])];
    const idx = cur.indexOf(hour);
    if (idx >= 0) cur.splice(idx, 1);
    else cur.push(hour);
    cur.sort((a, b) => a - b);
    periodicConfig[listKey] = cur;
    refreshPeriodicSettingsUI();
    await update(refs.settings, { [listKey]: cur.length ? cur : 'none' });
  };

  window.clearScheduledPromptHours = async (listKey) => {
    periodicConfig[listKey] = [];
    refreshPeriodicSettingsUI();
    await update(refs.settings, { [listKey]: 'none' });
  };

  window.setFamilyQuestionSilentMode = (silent) => {
    state.familyComposerSilent = !!silent;
    $('btn-q-voice-loud')?.classList.toggle('selected', !state.familyComposerSilent);
    $('btn-q-voice-silent')?.classList.toggle('selected', state.familyComposerSilent);
  };

  window.setGlobalQuestionSpeak = async (speakOn) => {
    state.speakQuestionsDefault = !!speakOn;
    window.setFamilyQuestionSilentMode(!state.speakQuestionsDefault);
    $('global-q-voice-on')?.classList.toggle('selected', state.speakQuestionsDefault);
    $('global-q-voice-off')?.classList.toggle('selected', !state.speakQuestionsDefault);
    await update(refs.settings, { speakQuestions: state.speakQuestionsDefault });
  };

  onValue(refs.settings, snap => {
    const s = snap.val();
    if (!s) return;
    if (s.speakQuestions !== undefined) {
      state.speakQuestionsDefault = !!s.speakQuestions;
      $('global-q-voice-on')?.classList.toggle('selected', state.speakQuestionsDefault);
      $('global-q-voice-off')?.classList.toggle('selected', !state.speakQuestionsDefault);
      window.setFamilyQuestionSilentMode(!state.speakQuestionsDefault);
    }
    ['showTodaysCallsBanner', 'periodicPopupsEnabled', 'unreadChatPopupMin', 'nightModeEnabled', 'nightStartHour', 'nightEndHour', 'bulletinClearedAt'].forEach(k => {
      if (s[k] !== undefined) periodicConfig[k] = s[k];
    });
    if (s.radioPromptHours !== undefined) periodicConfig.radioPromptHours = parseHoursArray(s.radioPromptHours, [10, 15]);
    if (s.videoPromptHours !== undefined) periodicConfig.videoPromptHours = parseHoursArray(s.videoPromptHours, [14, 19]);
    refreshPeriodicSettingsUI();
  });

  onValue(query(refs.bulletin, limitToLast(25)), snap => {
    state.bulletinSnap = snap.val() || {};
  });

  function isInNightModeWindow() {
    if (!periodicConfig.nightModeEnabled) return false;
    const h = new Date().getHours();
    const s = Number(periodicConfig.nightStartHour ?? 21), e = Number(periodicConfig.nightEndHour ?? 8);
    return s > e ? (h >= s || h < e) : (h >= s && h < e);
  }

  function hasUnreadFamilyChatMessages() {
    const clearedAt = Number(periodicConfig.bulletinClearedAt) || 0;
    return Object.values(state.bulletinSnap).some(item => {
      if (!item) return false;
      const isOut = !!item.fromNana || item.author?.toLowerCase() === 'nana';
      if (isOut) return false;
      if (item.readByNanaAt || (Number(item.timestamp) || 0) <= clearedAt) return false;
      return true;
    });
  }

  async function evaluateScheduledPopupsOnNana() {
    if (role !== 'nana' || !periodicConfig.periodicPopupsEnabled || isInNightModeWindow()) return;
    if (state.callSnap?.status && state.callSnap.status !== 'idle') return;
    if ($('nana-question-modal')?.style.display === 'flex' || $('confirm-modal')?.style.display === 'flex') return;

    const now = Date.now();
    if (now - lastAnyPeriodicPromptMs < 120000) return;

    const chatOpen = $('bulletin-modal')?.style.display === 'flex';
    const radioOpenOrPlaying = $('radio-screen')?.classList.contains('active') || (state.entSnap?.activeKey && state.entSnap.activeKey !== 'off');
    const videoPlaying = !!NanaCore.isNanaVideoActivelyPlaying?.();

    const unreadMin = Number(periodicConfig.unreadChatPopupMin ?? 30);
    if (unreadMin > 0 && !chatOpen && !videoPlaying && hasUnreadFamilyChatMessages()) {
      if (now - lastUnreadChatPromptMs >= unreadMin * 60000) {
        lastUnreadChatPromptMs = now;
        lastAnyPeriodicPromptMs = now;
        await set(refs.quickQuestion, {
          id: `q_unread_${now}`,
          type: 'unread_chat_prompt',
          question: 'You have unread messages, would you like to read them?',
          askedBy: 'Family Chat',
          silent: !state.speakQuestionsDefault,
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
    const dateKey = `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}_${curHour}`;

    if (curMin <= 20) {
      if ((periodicConfig.radioPromptHours || []).includes(curHour)) {
        const storageKey = `nana_sched_radio_${dateKey}`;
        if (!localStorage.getItem(storageKey)) {
          localStorage.setItem(storageKey, '1');
          lastAnyPeriodicPromptMs = now;
          await set(refs.quickQuestion, {
            id: `q_schedradio_${now}`,
            type: 'idle_radio_prompt',
            question: 'Would you like to listen to Classic FM?',
            askedBy: 'Classic FM Radio',
            silent: !state.speakQuestionsDefault,
            status: 'pending',
            answer: null,
            askedAt: now
          });
          return;
        }
      }

      if ((periodicConfig.videoPromptHours || []).includes(curHour)) {
        const storageKey = `nana_sched_video_${dateKey}`;
        if (!localStorage.getItem(storageKey)) {
          localStorage.setItem(storageKey, '1');
          lastAnyPeriodicPromptMs = now;
          await set(refs.quickQuestion, {
            id: `q_schedvideo_${now}`,
            type: 'idle_video_prompt',
            question: 'Would you like to watch Judge John Deed?',
            askedBy: 'Video Player',
            silent: !state.speakQuestionsDefault,
            status: 'pending',
            answer: null,
            askedAt: now
          });
        }
      }
    }
  }

  if (role === 'nana') setInterval(evaluateScheduledPopupsOnNana, 20000);

  window.sendQuestionToNana = async () => {
    const input = $('fam-q-input');
    const text = (input?.value || '').trim();
    if (!text) return alert("Please type a question for Nana first.");
    await set(refs.quickQuestion, {
      id: `q_${Date.now()}`,
      type: 'family_question',
      question: text,
      askedBy: senderName,
      silent: state.familyComposerSilent,
      status: 'pending',
      answer: null,
      askedAt: Date.now()
    });
    if (input) input.value = '';
  };

  window.clearQuestionOnNana = async () => {
    await set(refs.quickQuestion, { status: 'cleared', updatedAt: Date.now() });
  };

  window.submitNanaQuestionAnswer = async (choice) => {
    if (!activeQuestionData) return;
    const qData = activeQuestionData;
    const isSilent = !!(qData.silent || !state.speakQuestionsDefault);
    $('nana-question-modal').style.display = 'none';
    state.lastActivityOrCallMs = Date.now();
    window.wakeScreenAndResetDimTimer?.();

    const now = Date.now();
    await update(refs.quickQuestion, { status: 'answered', answer: choice, answeredAt: now });

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

  let lastHandledQuestionId = null;
  onValue(refs.quickQuestion, snap => {
    const q = snap.val();
    activeQuestionData = q;
    if (role === 'family') {
      const st = $('fam-q-status');
      if (!st) return;
      if (!q || q.status === 'cleared') { st.innerText = 'No active popup'; st.style.color = '#94a3b8'; }
      else if (q.status === 'pending') {
        const modeTag = (q.silent || !state.speakQuestionsDefault) ? '🔇 Silent' : '🔊 Spoken';
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
        const isSilent = !!(q.silent || !state.speakQuestionsDefault);
        const badgeMap = {
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
      } else modal.style.display = 'none';
    }
  });
})();
