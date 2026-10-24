import { $, NanaCore, update, push, onValue, onDisconnect, query, limitToLast } from "./nana-core.js?v=2.9.2";

(function initNanaTelemetry() {
  if (!NanaCore.SERVICE_TOKEN) return;
  const { role, FAMILY_NAMES, refs, state, hooks } = NanaCore;
  const videoEl = $('nana-video-el');

  let activeCallConnectedAtMs = null, activeCallPartnerId = null;

  // --- 1. TODAY'S COMPLETED CALLS LOGGING & REASSURANCE BANNER ---
  function getTodaysCompletedCallsList() {
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    const todayMs = startOfToday.getTime();
    return Object.values(state.callHistorySnap || {})
      .filter(c => c && (Number(c.endedAt || c.startedAt) >= todayMs))
      .sort((a, b) => (a.startedAt || 0) - (b.startedAt || 0));
  }

  function renderTodaysCallsBanner() {
    const banner = $('todays-calls-reassurance-banner');
    const chipsBox = $('todays-calls-chips-container');
    if (!banner || !chipsBox) return;

    if (NanaCore.periodicConfig?.showTodaysCallsBanner === false) {
      banner.style.display = 'none';
      return;
    }

    const callsToday = getTodaysCompletedCallsList();
    if (!callsToday.length) {
      banner.style.display = 'none';
      return;
    }

    chipsBox.innerHTML = '';
    callsToday.forEach(c => {
      const name = FAMILY_NAMES[c.partnerId] || c.partnerName || 'Family';
      const timeStr = c.startedAt ? new Date(c.startedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : '';
      const mins = Math.max(1, Math.round((Number(c.durationSec) || 60) / 60));
      const pill = document.createElement('span');
      pill.className = 'todays-call-pill';
      pill.textContent = `✓ ${name} at ${timeStr} (${mins}m chat)`;
      chipsBox.appendChild(pill);
    });
    banner.style.display = 'flex';
  }
  hooks.renderTodaysCallsBanner = renderTodaysCallsBanner;

  onValue(query(refs.callHistory, limitToLast(25)), snap => {
    state.callHistorySnap = snap.val() || {};
    renderTodaysCallsBanner();
    if (role === 'family') setTimeout(applySimpleFamilyPresenceCard, 20);
  });
  setInterval(renderTodaysCallsBanner, 60000);

  // --- 2. TABLET DISCONNECT, WIFI, BACKGROUND & BATTERY TELEMETRY ---
  if (role === 'nana') {
    onValue(refs.connectedInfo, snap => {
      if (snap.val() === true) {
        const od = onDisconnect(refs.presence);
        od.update({ online: false, disconnectedAt: Date.now() }).catch(() => {});
        update(refs.presence, {
          online: true,
          appState: document.visibilityState === 'hidden' ? 'backgrounded' : 'foreground',
          networkOnline: navigator.onLine !== false,
          lastConnectedAt: Date.now()
        }).catch(() => {});
      }
    });

    document.addEventListener('visibilitychange', () => {
      const isHidden = document.visibilityState === 'hidden';
      update(refs.presence, {
        appState: isHidden ? 'backgrounded' : 'foreground',
        appStateChangedAt: Date.now(),
        lastExitHint: isHidden ? 'backed_out_or_notification' : 'active_in_app'
      }).catch(() => {});
    });

    window.addEventListener('blur', () => {
      if (document.visibilityState !== 'hidden') {
        update(refs.presence, {
          appState: 'shade_or_overlay',
          appStateChangedAt: Date.now(),
          lastExitHint: 'notification_shade_or_overlay'
        }).catch(() => {});
      }
    });

    window.addEventListener('focus', () => {
      update(refs.presence, {
        appState: 'foreground',
        appStateChangedAt: Date.now(),
        lastExitHint: 'active_in_app'
      }).catch(() => {});
    });

    window.addEventListener('offline', () => {
      update(refs.presence, {
        networkOnline: false,
        lastExitHint: 'wifi_turned_off',
        wifiDroppedAt: Date.now()
      }).catch(() => {});
    });

    window.addEventListener('online', () => {
      update(refs.presence, {
        online: true,
        networkOnline: true,
        lastExitHint: 'active_in_app'
      }).catch(() => {});
    });

    window.addEventListener('pagehide', () => {
      update(refs.presence, {
        online: false,
        appState: 'closed',
        lastExitHint: 'app_closed_or_backed_out',
        disconnectedAt: Date.now()
      }).catch(() => {});
    });
  }

  function broadcastNanaCurrentScreen() {
    if (role !== 'nana') return;
    let screenState = 'home';
    const isActuallyPlayingVideo = !!(
      $('video-screen')?.classList.contains('active') &&
      videoEl &&
      !videoEl.paused &&
      !videoEl.ended &&
      videoEl.readyState >= 2
    );
    if ($('bulletin-modal')?.style.display === 'flex') {
      screenState = $('bulletin-modal')?.classList.contains('kb-fullscreen') ? 'chat_typing' : 'chat';
    } else if ($('video-screen')?.classList.contains('active')) {
      screenState = isActuallyPlayingVideo ? 'video_playing' : 'video_paused';
    } else if ($('radio-screen')?.classList.contains('active')) {
      screenState = 'radio';
    }
    if (state.streamData.state === 'playing' && !isActuallyPlayingVideo) {
      update(refs.videoStream, { state: 'paused', updatedAt: Date.now() }).catch(() => {});
    }
    update(refs.presence, {
      online: true,
      currentScreen: screenState,
      appState: document.visibilityState === 'hidden' ? 'backgrounded' : 'foreground'
    }).catch(() => {});
  }
  hooks.broadcastScreen = broadcastNanaCurrentScreen;

  if (role === 'nana') {
    setInterval(broadcastNanaCurrentScreen, 10000);
    setTimeout(broadcastNanaCurrentScreen, 1500);
  }

  // Wrap app.js navigation functions so screen changes broadcast immediately
  ['openFamilyBulletin', 'closeFamilyBulletin', 'openRadioScreen', 'closeRadioScreen', 'openSeniorKeyboard', 'closeSeniorKeyboard'].forEach(fnName => {
    const orig = window[fnName];
    if (typeof orig === 'function') {
      window[fnName] = (...args) => { orig(...args); broadcastNanaCurrentScreen(); };
    }
  });

  // --- 3. CONCISE SINGLE-LINE FAMILY PRESENCE STATUS ---
  function getSimpleNanaStatusSummary() {
    const p = state.presenceSnap || {};
    const now = Date.now();
    const lastSeenMs = Math.max(Number(p.lastPing || 0), Number(p.disconnectedAt || 0), Number(p.appStateChangedAt || 0));
    const silenceSec = lastSeenMs ? Math.floor((now - Number(p.lastPing || lastSeenMs)) / 1000) : 0;
    const isOffline = (p.online === false) || (p.lastPing && silenceSec > 75);
    const batt = p.batteryLevel != null ? Number(p.batteryLevel) : null;
    const charging = !!p.isCharging;

    const st = state.callSnap?.status || 'idle';
    if (st !== 'idle') {
      const otherId = state.callSnap.callerId === 'nana' ? state.callSnap.targetId : state.callSnap.callerId;
      const withName = FAMILY_NAMES[otherId] || 'Family';
      return {
        border: '#f87171',
        text: st === 'connected' ? `🔴 In a call with ${withName}` : `🟡 Ringing (${withName})`
      };
    }

    if (isOffline) {
      if (batt !== null && !charging && (batt <= 6 || (batt <= 14 && silenceSec > 600))) {
        return { border: '#ef4444', text: `🔴 Offline (Ran out of battery)` };
      }
      if (p.appState === 'backgrounded' || p.appState === 'closed' || p.lastExitHint === 'backed_out_or_notification' || p.lastExitHint === 'app_closed_or_backed_out') {
        return { border: '#ef4444', text: `🟠 Left the app` };
      }
      if (p.lastExitHint === 'wifi_turned_off' || p.appState === 'shade_or_overlay' || p.lastExitHint === 'notification_shade_or_overlay') {
        return { border: '#ef4444', text: `🔴 Offline (Wi-Fi turned off)` };
      }
      return { border: '#ef4444', text: `🔴 Offline (Disconnected from internet)` };
    }
    if (p.appState === 'backgrounded') {
      return { border: '#facc15', text: `🟠 Left the app` };
    }

    const curItem = NanaCore.getCurrentQueueItem?.();
    const scr = p.currentScreen || 'home';
    if (scr === 'video_playing') {
      return {
        border: '#a855f7',
        text: `🎬 Video is playing${curItem?.item?.title ? ` (${curItem.item.title})` : ''}`
      };
    }

    if (state.entSnap?.activeKey && state.entSnap.activeKey !== 'off') {
      return { border: '#22c55e', text: `🎻 Listening to the radio` };
    }

    if (scr === 'chat_typing') return { border: '#38bdf8', text: `⌨️ On the family chat (typing)` };
    if (scr === 'chat') return { border: '#38bdf8', text: `✈️ On the family chat (reading)` };

    return { border: '#22c55e', text: `🟢 Not doing anything` };
  }

  function applySimpleFamilyPresenceCard() {
    if (role !== 'family') return;
    const card = $('nana-presence-card');
    if (!card) return;

    const summary = getSimpleNanaStatusSummary();
    card.style.borderColor = summary.border;

    const spans = Array.from(card.querySelectorAll('span')).filter(s => !s.classList.contains('fam-today-calls-line'));
    const touchBattHtml = spans[0] ? spans[0].outerHTML : '';
    const tgStatusHtml = spans[1] ? `<br>${spans[1].outerHTML}` : '';

    const callsToday = getTodaysCompletedCallsList();
    let todayLineHtml = '';
    if (callsToday.length) {
      const summaryItems = callsToday.map(c => {
        const name = FAMILY_NAMES[c.partnerId] || c.partnerName || 'Family';
        const t = c.startedAt ? new Date(c.startedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : '';
        const m = Math.max(1, Math.round((Number(c.durationSec) || 60) / 60));
        return `${name} (${t}, ${m}m)`;
      }).join(' • ');
      todayLineHtml = `<br><span class="fam-today-calls-line" style="color:#86efac;font-size:0.84rem;font-weight:800;">💚 Calls today: ${summaryItems}</span>`;
    }

    const cleanHtml = `<div style="font-size:1.05rem;font-weight:900;color:#fef08a;margin-bottom:2px;">${summary.text}</div>${touchBattHtml}${todayLineHtml}${tgStatusHtml}`;
    if (card.innerHTML !== cleanHtml) card.innerHTML = cleanHtml;
  }
  hooks.refreshFamilyPresence = applySimpleFamilyPresenceCard;

  if (role === 'family') {
    onValue(refs.presence, snap => {
      state.presenceSnap = snap.val() || {};
      setTimeout(applySimpleFamilyPresenceCard, 20);
    });
    setInterval(applySimpleFamilyPresenceCard, 15000);
    const cardEl = $('nana-presence-card');
    if (cardEl) {
      let obsLock = false;
      const obs = new MutationObserver(() => {
        if (obsLock) return;
        obsLock = true;
        applySimpleFamilyPresenceCard();
        obsLock = false;
      });
      obs.observe(cardEl, { childList: true });
    }
  }

  onValue(refs.entertainment, snap => {
    state.entSnap = snap.val() || { activeKey: 'off' };
    if (role === 'family') setTimeout(applySimpleFamilyPresenceCard, 20);
  });

  onValue(refs.callState, snap => {
    const call = snap.val();
    if (!call) return;
    state.callSnap = call;
    state.lastActivityOrCallMs = Date.now();
    if (role === 'family') setTimeout(applySimpleFamilyPresenceCard, 20);

    if (role === 'nana') {
      if (call.status === 'connected') {
        if (!activeCallConnectedAtMs) {
          activeCallConnectedAtMs = Date.now();
          activeCallPartnerId = call.callerId === 'nana' ? call.targetId : call.callerId;
        }
      } else if (call.status === 'idle' && activeCallConnectedAtMs) {
        const endedAt = Date.now();
        const durationSec = Math.round((endedAt - activeCallConnectedAtMs) / 1000);
        const partnerId = activeCallPartnerId || 'family';
        const startedAt = activeCallConnectedAtMs;
        activeCallConnectedAtMs = null;
        activeCallPartnerId = null;
        if (durationSec >= 15) {
          push(refs.callHistory, {
            partnerId,
            partnerName: FAMILY_NAMES[partnerId] || 'Family',
            startedAt,
            endedAt,
            durationSec
          }).catch(() => {});
        }
      }

      if (call.status !== 'idle') {
        if ($('nana-question-modal')) $('nana-question-modal').style.display = 'none';
        hooks.pauseVideo?.('incoming_call');
      }
    }
  });
})();
