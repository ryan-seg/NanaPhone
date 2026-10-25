import { $, NanaCore, update, push, onValue, onDisconnect, query, limitToLast } from "./nana-core.js?v=2.9.2";

(function initNanaTelemetry() {
  if (!NanaCore.SERVICE_TOKEN) return;
  const { role, FAMILY_NAMES, refs, state, hooks } = NanaCore;
  const videoEl = $('nana-video-el');

  let activeCallConnectedAtMs = null, activeCallPartnerId = null;

// --- 0. ACCIDENTAL "END CALL" CONFIRMATION MODAL & JITTER GUARD ---
  let endCallConfirmedByUser = false;
  let endCallModalTimer = null;
  let jitterHoldTimer = null;

  const hangupBtn = $('hangup-btn');
  if (role === 'family') {
    const ecModal = document.createElement('div');
    ecModal.id = 'end-call-confirm-modal';
    ecModal.innerHTML = `
      <div class="end-confirm-card">
        <div style="font-size:1.85rem;font-weight:900;color:#fef08a;">☎️ End Call with Nana?</div>
        <div style="font-size:1.05rem;color:#cbd5e1;font-weight:700;">Tap "Keep Talking" if you pressed End Call by accident.</div>
        <div style="display:flex;gap:14px;width:100%;margin-top:6px;">
          <button class="confirm-btn" style="flex:1;background:#22c55e;color:#000;font-size:1.25rem;padding:14px 10px;" onclick="dismissEndCallConfirm()">📞 Keep Talking</button>
          <button class="confirm-btn" style="flex:1;background:#ef4444;color:#fff;font-size:1.25rem;padding:14px 10px;" onclick="confirmFamilyEndCallNow()">☎️ Yes, End Call</button>
        </div>
      </div>
    `;
    document.body.appendChild(ecModal);

    if (hangupBtn) {
      hangupBtn.onclick = (ev) => {
        if (ev) { ev.preventDefault(); ev.stopPropagation(); }
        window.promptEndCallConfirmation();
      };
    }
  } else if (role === 'nana' && hangupBtn) {
    // When Nana taps End Call herself, hang up immediately without triggering the jitter hold
    hangupBtn.addEventListener('pointerdown', () => {
      endCallConfirmedByUser = true;
      clearTimeout(jitterHoldTimer);
      setTimeout(() => { endCallConfirmedByUser = false; }, 3000);
    }, { capture: true });
  }

  window.promptEndCallConfirmation = () => {
    const m = $('end-call-confirm-modal');
    if (!m) return window.confirmFamilyEndCallNow();
    m.style.display = 'flex';
    clearTimeout(endCallModalTimer);
    endCallModalTimer = setTimeout(() => { m.style.display = 'none'; }, 8000);
  };

  window.dismissEndCallConfirm = () => {
    clearTimeout(endCallModalTimer);
    if ($('end-call-confirm-modal')) $('end-call-confirm-modal').style.display = 'none';
  };

  const origEndCall = window.endCall;
  window.confirmFamilyEndCallNow = async () => {
    clearTimeout(endCallModalTimer);
    clearTimeout(jitterHoldTimer);
    if ($('end-call-confirm-modal')) $('end-call-confirm-modal').style.display = 'none';
    endCallConfirmedByUser = true;
    await origEndCall?.();
    setTimeout(() => { endCallConfirmedByUser = false; }, 3000);
  };

  if (typeof origEndCall === 'function') {
    window.endCall = async (forceImmediate = false) => {
      clearTimeout(jitterHoldTimer);
      if ($('end-call-confirm-modal')) $('end-call-confirm-modal').style.display = 'none';

      // If forceImmediate is passed, or user tapped End Call, or Firebase already says 'idle', exit immediately!
      const isConnectedCall = state.callSnap?.status === 'connected' && $('call-screen')?.classList.contains('active');
      if (forceImmediate || endCallConfirmedByUser || !isConnectedCall) {
        return await origEndCall();
      }

      // Wait 600ms to let Firebase callState sync in case the other person intentionally pressed End Call
      setTimeout(async () => {
        if (state.callSnap?.status !== 'connected' || endCallConfirmedByUser) {
          await origEndCall();
          return;
        }
        const banner = $('call-connecting-banner');
        if (banner) {
          banner.style.display = 'block';
          banner.innerText = '📡 Signal dip — holding call for 30s to reconnect...';
        }
        clearTimeout(jitterHoldTimer);
        jitterHoldTimer = setTimeout(async () => {
          const rv = $('remote-video');
          const videoRecovered = rv && rv.srcObject && !rv.paused && rv.readyState >= 2;
          if (!videoRecovered && state.callSnap?.status === 'connected') {
            await origEndCall();
          } else if (banner) {
            banner.style.display = 'none';
          }
        }, 30000);
      }, 600);
    };
  }
// --- 1. TOP 68PX NO-TOUCH AREA ORIENTATION BANNER ON NANA'S SCREEN ---
  if (role === 'nana') {
    // Physically remove the old clock pill and overlapping "Tap a photo..." title ("T")
    $('clock')?.remove();
    $('grid-header-title')?.remove();

    // Ensure all top navigation tab buttons ("Family Calls", etc.) have white text
    document.querySelectorAll('button[onclick*="switchNanaMainTab"]').forEach(btn => {
      btn.style.setProperty('color', '#ffffff', 'important');
    });

    const topBar = document.createElement('div');
    topBar.id = 'nana-top-orientation-bar';
    document.body.appendChild(topBar);

    const updateTopOrientationBanner = () => {
      const now = new Date();
      const hr = now.getHours();
      let period = '🌙 Night';
      if (hr >= 5 && hr < 12) period = '☀️ Morning';
      else if (hr >= 12 && hr < 17) period = '🌤️ Afternoon';
      else if (hr >= 17 && hr < 21) period = '🌆 Evening';

      const dayName = now.toLocaleDateString('en-GB', { weekday: 'long' });
      const dateStr = now.toLocaleDateString('en-GB', { day: 'numeric', month: 'long' });
      const timeStr = now.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', hour12: true }).toUpperCase();

      topBar.textContent = `${period} • ${dayName} ${dateStr} • ${timeStr}`;
    };

    updateTopOrientationBanner();
    setInterval(updateTopOrientationBanner, 10000);
  }

  // --- 2. ADJUSTABLE BATTERY UNPLUGGED VOICE THRESHOLD (%) IN SETTINGS ---
  const battMuteLbl = document.querySelector('.lbl-battery-mute');
  const battCard = battMuteLbl?.closest('.settings-card');
  if (battCard && !$('batt-threshold-row')) {
    const sub = document.createElement('div');
    sub.className = 'settings-sub';
    sub.style.marginBottom = '4px';
    sub.textContent = '🔌 Start Speaking When Unplugged At or Below:';

    const row = document.createElement('div');
    row.id = 'batt-threshold-row';
    row.className = 'opt-row';
    row.style.marginBottom = '8px';
    row.innerHTML = [
      [100, '100% (Immediately)'],
      [80, '80%'],
      [50, '50%'],
      [35, '35%'],
      [25, '25%']
    ].map(([pct, lbl]) =>
      `<button class="opt-btn" data-battthresh="${pct}" onclick="setBatteryVoiceThresholdPct(${pct})">${lbl}</button>`
    ).join('');

    battCard.insertBefore(sub, battMuteLbl.nextSibling);
    battCard.insertBefore(row, sub.nextSibling);
  }

  function refreshBatteryThresholdUI() {
    const cur = Number(state.batteryVoiceThresholdPct ?? 100);
    document.querySelectorAll('[data-battthresh]').forEach(btn => {
      btn.classList.toggle('selected', Number(btn.dataset.battthresh) === cur);
    });
  }

  window.setBatteryVoiceThresholdPct = async (pct) => {
    state.batteryVoiceThresholdPct = Number(pct) || 100;
    refreshBatteryThresholdUI();
    await update(refs.settings, { batteryVoiceThresholdPct: state.batteryVoiceThresholdPct });
  };

  onValue(refs.settings, snap => {
    const s = snap.val();
    if (s && s.batteryVoiceThresholdPct !== undefined) {
      state.batteryVoiceThresholdPct = Number(s.batteryVoiceThresholdPct) || 100;
    }
    refreshBatteryThresholdUI();
  });

  function checkCustomBatteryThresholdOnNana() {
    if (role !== 'nana' || !window.AndroidBridge?.getBatteryStatusJson) return;
    try {
      const b = JSON.parse(window.AndroidBridge.getBatteryStatusJson());
      const level = b.level, charging = b.charging;
      const threshold = Number(state.batteryVoiceThresholdPct ?? 100);
      if (!charging && level !== null && level <= threshold) {
        window.announceBatteryWarning?.("Please plug in the tablet charger.");
      }
    } catch (_) {}
  }

  if (role === 'nana') {
    setInterval(checkCustomBatteryThresholdOnNana, 20000);
    setTimeout(checkCustomBatteryThresholdOnNana, 4000);
  }

// --- 3. TODAY'S COMPLETED CALLS BANNER (FOR NANA'S HOME SCREEN ONLY, NO DURATION) ---
  function ensureNanaTodaysCallsBannerElement() {
    if (role !== 'nana') return null;
    let banner = $('todays-calls-reassurance-banner');
    if (!banner) {
      const gridScreen = $('grid-screen');
      const familyGrid = $('family-grid');
      if (!gridScreen) return null;
      banner = document.createElement('div');
      banner.id = 'todays-calls-reassurance-banner';
      banner.innerHTML = `
        <span>💚 Spoken to today:</span>
        <div id="todays-calls-chips-container" style="display:flex;flex-wrap:wrap;gap:6px;align-items:center;"></div>
      `;
      if (familyGrid && familyGrid.parentNode === gridScreen) {
        gridScreen.insertBefore(banner, familyGrid);
      } else {
        gridScreen.prepend(banner);
      }
    }
    return banner;
  }

  function getTodaysCompletedCallsList() {
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    const todayMs = startOfToday.getTime();
    return Object.values(state.callHistorySnap || {})
      .filter(c => c && (Number(c.endedAt || c.startedAt) >= todayMs))
      .sort((a, b) => (a.startedAt || 0) - (b.startedAt || 0));
  }

  function renderTodaysCallsBanner() {
    if (role !== 'nana') return;
    const banner = ensureNanaTodaysCallsBannerElement();
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
      const pill = document.createElement('span');
      pill.className = 'todays-call-pill';
      pill.textContent = timeStr ? `✓ ${name} at ${timeStr}` : `✓ ${name}`;
      chipsBox.appendChild(pill);
    });
    banner.style.display = 'flex';
  }
  hooks.renderTodaysCallsBanner = renderTodaysCallsBanner;

onValue(query(refs.callHistory, limitToLast(25)), snap => {
    state.callHistorySnap = snap.val() || {};
    if (role === 'nana') renderTodaysCallsBanner();
    if (role === 'family') setTimeout(applySimpleFamilyPresenceCard, 20);
  });
  if (role === 'nana') setInterval(renderTodaysCallsBanner, 60000);

  // --- 4. TABLET DISCONNECT, WIFI, BACKGROUND & BATTERY TELEMETRY ---
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
    const isPlayingVideo = !!(
      $('video-screen')?.classList.contains('active') &&
      videoEl &&
      !videoEl.paused &&
      !videoEl.ended
    );
    if ($('bulletin-modal')?.style.display === 'flex') {
      screenState = $('bulletin-modal')?.classList.contains('kb-fullscreen') ? 'chat_typing' : 'chat';
    } else if ($('video-screen')?.classList.contains('active')) {
      screenState = isPlayingVideo ? 'video_playing' : 'video_paused';
    } else if ($('radio-screen')?.classList.contains('active')) {
      screenState = 'radio';
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

  ['openFamilyBulletin', 'closeFamilyBulletin', 'openRadioScreen', 'closeRadioScreen', 'openSeniorKeyboard', 'closeSeniorKeyboard'].forEach(fnName => {
    const orig = window[fnName];
    if (typeof orig === 'function') {
      window[fnName] = (...args) => { orig(...args); broadcastNanaCurrentScreen(); };
    }
  });

// --- 5. FAMILY PRESENCE STATUS (ACTIVITY + LAST TOUCHED + CHARGING/BATTERY %) ---
  function formatTouchAgo(ts) {
    if (!ts) return "No recent touch";
    const mins = Math.max(0, Math.floor((Date.now() - Number(ts)) / 60000));
    if (mins < 1) return "Just now";
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60), remMins = mins % 60;
    if (hrs < 24) return remMins > 0 ? `${hrs}h ${remMins}m ago` : `${hrs}h ago`;
    return `${Math.floor(hrs / 24)}d ${hrs % 24}h ago`;
  }

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
        text: st === 'connected' ? `🔴 In a video call with ${withName}` : `🟡 Ringing (${withName})`
      };
    }

    if (isOffline) {
      if (batt !== null && !charging && (batt <= 6 || (batt <= 14 && silenceSec > 600))) {
        return { border: '#ef4444', text: `🔴 Offline (Ran out of battery)` };
      }
      if (p.appState === 'backgrounded' || p.appState === 'closed' || p.lastExitHint === 'backed_out_or_notification' || p.lastExitHint === 'app_closed_or_backed_out') {
        return { border: '#f59e0b', text: `🟠 Left the app` };
      }
      if (p.lastExitHint === 'wifi_turned_off' || p.appState === 'shade_or_overlay' || p.lastExitHint === 'notification_shade_or_overlay') {
        return { border: '#ef4444', text: `🔴 Offline (Wi-Fi turned off)` };
      }
      return { border: '#ef4444', text: `🔴 Offline (Disconnected from internet)` };
    }
    if (p.appState === 'backgrounded') {
      return { border: '#f59e0b', text: `🟠 Left the app` };
    }

    const curItem = NanaCore.getCurrentQueueItem?.();
    const scr = p.currentScreen || 'home';
    if (scr === 'video_playing') {
      return {
        border: '#a855f7',
        text: `🎬 Watching video${curItem?.item?.title ? `: ${curItem.item.title}` : ''}`
      };
    }
    if (scr === 'video_paused') {
      return {
        border: '#a855f7',
        text: `⏸️ On Video Screen (Paused${curItem?.item?.title ? `: ${curItem.item.title}` : ''})`
      };
    }

    if (state.entSnap?.activeKey && state.entSnap.activeKey !== 'off') {
      return { border: '#22c55e', text: `🎻 Listening to Classic FM Radio` };
    }

    if (scr === 'chat_typing') return { border: '#38bdf8', text: `⌨️ On Family Chat (Typing a message)` };
    if (scr === 'chat') return { border: '#38bdf8', text: `✈️ On Family Chat (Reading messages)` };

    return { border: '#22c55e', text: `🟢 Available on Home Screen (Idle)` };
  }

function applySimpleFamilyPresenceCard() {
    if (role !== 'family') return;
    const card = $('nana-presence-card');
    if (!card) return;

    const p = state.presenceSnap || {};
    const summary = getSimpleNanaStatusSummary();
    card.style.borderColor = summary.border;

    // 1. Last touched timestamp directly from presenceSnap
    const lastTouchTs = p.lastTouched || p.lastActive || null;
    const touchHtml = `<span>👆 Last touched: <strong style="color:#f8fafc;">${formatTouchAgo(lastTouchTs)}</strong></span>`;

    // 2. Charging / Unplugged + Battery % directly from presenceSnap
    let battHtml = '';
    if (p.batteryLevel != null) {
      const pct = Number(p.batteryLevel);
      const isCharging = !!p.isCharging;
      const battColor = isCharging ? '#4ade80' : (pct <= 25 ? '#f87171' : '#fbbf24');
      const battLabel = isCharging ? `🔌 Charging (${pct}%)` : `⚠️ UNPLUGGED (${pct}%)`;
      battHtml = ` • <span style="color:${battColor};font-weight:800;">${battLabel}</span>`;
    }

    // 3. Today's completed calls (Name + Time only, no duration)
    const callsToday = getTodaysCompletedCallsList();
    let todayCallsHtml = '';
    if (callsToday.length) {
      const items = callsToday.map(c => {
        const name = FAMILY_NAMES[c.partnerId] || c.partnerName || 'Family';
        const t = c.startedAt ? new Date(c.startedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : '';
        return t ? `${name} (${t})` : name;
      }).join(' • ');
      todayCallsHtml = `<div style="font-size:0.85rem;color:#86efac;font-weight:800;margin-top:4px;">💚 Spoken to today: ${items}</div>`;
    }

    const cleanHtml = `
      <div style="font-size:1.02rem;font-weight:900;color:#fef08a;margin-bottom:4px;">${summary.text}</div>
      <div style="font-size:0.88rem;color:#cbd5e1;font-weight:600;">${touchHtml}${battHtml}</div>
      ${todayCallsHtml}
    `;
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

if (call.status === 'idle') {
      clearTimeout(jitterHoldTimer);
      if ($('end-call-confirm-modal')) $('end-call-confirm-modal').style.display = 'none';
      if (role === 'nana' && $('call-screen')?.classList.contains('active')) {
        origEndCall?.();
        document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
        $('grid-screen')?.classList.add('active');
      }
    }
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
