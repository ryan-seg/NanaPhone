import {
  $, NanaCore, update, onValue, onDisconnect, query, limitToLast
} from "./nana-core.js?v=2.9.3";

const {
  role, activeFamilyMember, FAMILY_NAMES, refs, settings, state, hooks, isBatteryVoiceCurrentlyMuted
} = NanaCore;

let lastTouchWriteMs = 0;

// --- 1. TOP 62PX NO-TOUCH ORIENTATION BANNER (DAY, TIME OF DAY, DATE & CLOCK) ---
if (role === 'nana') {
  const updateTopOrientationBanner = () => {
    const topBar = $('nana-top-orientation-bar');
    if (!topBar) return;
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

// --- 2. BATTERY READING, TOUCH ACTIVITY & BACKGROUND HEARTBEAT ---
export function readTabletBatteryStatus() {
  let batteryLevel = null, isCharging = null;
  if (window.AndroidBridge?.getBatteryStatusJson) {
    try {
      const b = JSON.parse(window.AndroidBridge.getBatteryStatusJson());
      batteryLevel = b.level;
      isCharging = b.charging;
      const battThresh = Number(settings.batteryVoiceThresholdPct ?? 100);
      if (!isCharging && batteryLevel !== null && batteryLevel <= battThresh && !isBatteryVoiceCurrentlyMuted()) {
        window.announceBatteryWarning?.("Please plug in the tablet charger.");
      }
    } catch (_) {}
  }
  return { batteryLevel, isCharging };
}

export function recordTouchActivity(customActivity = null) {
  state.lastActivityOrCallMs = Date.now();
  if (role !== 'nana') return;
  const now = Date.now();
  if (!customActivity && (now - lastTouchWriteMs < 15000)) return;
  lastTouchWriteMs = now;
  const { batteryLevel, isCharging } = readTabletBatteryStatus();
  const payload = { online: true, lastTouched: now, lastActive: now, lastPing: now, batteryLevel, isCharging };
  if (customActivity) payload.lastActivity = customActivity;
  update(refs.presence, payload).catch(() => {});
}
NanaCore.recordTouchActivity = recordTouchActivity;

function recordBackgroundHeartbeat() {
  if (role !== 'nana') return;
  const { batteryLevel, isCharging } = readTabletBatteryStatus();
  update(refs.presence, { online: true, lastPing: Date.now(), batteryLevel, isCharging }).catch(() => {});
}

window.resetIdleTimer = () => {
  window.wakeScreenAndResetDimTimer?.();
  recordTouchActivity();
};

window.addEventListener('pointerdown', () => {
  window.wakeScreenAndResetDimTimer?.();
  recordTouchActivity();
}, { passive: true });

// --- 3. TABLET DISCONNECT, WIFI, BACKGROUND & SCREEN STATE TELEMETRY ---
export function broadcastNanaCurrentScreen() {
  if (role !== 'nana') return;
  const videoEl = $('nana-video-el');
  let screenState = 'home';
  const isPlayingVideo = !!(
    $('video-screen')?.classList.contains('active') &&
    videoEl && !videoEl.paused && !videoEl.ended
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
  onValue(refs.connectedInfo, snap => {
    if (snap.val() === true) {
      onDisconnect(refs.presence).update({ online: false, disconnectedAt: Date.now() }).catch(() => {});
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

  setTimeout(() => {
    window.wakeScreenAndResetDimTimer?.();
    recordBackgroundHeartbeat();
    broadcastNanaCurrentScreen();
  }, 2000);
  setInterval(recordBackgroundHeartbeat, 30000);
  setInterval(broadcastNanaCurrentScreen, 10000);
}

// --- 4. TODAY'S CONNECTED CALLS BANNER (NEVER SHOWS MISSED CALLS) ---
export function getTodaysCompletedCallsList() {
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const todayMs = startOfToday.getTime();
  // Strictly include only connected calls from today lasting >= 15 seconds (never missed or unanswered calls)
  return Object.values(state.callHistorySnap || {})
    .filter(c =>
      c &&
      c.status !== 'missed' &&
      c.connected !== false &&
      Number(c.durationSec) >= 15 &&
      Number(c.endedAt || c.startedAt) >= todayMs
    )
    .sort((a, b) => (a.startedAt || 0) - (b.startedAt || 0));
}

export function renderTodaysCallsBanner() {
  const banner = $('todays-calls-reassurance-banner');
  const chipsBox = $('todays-calls-chips-container');
  if (!banner || !chipsBox) return;

  if (settings.showTodaysCallsBanner === false) {
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
  if (role === 'family') updateFamilyPresenceBanner();
});
setInterval(renderTodaysCallsBanner, 60000);

// --- 5. UNIFIED FAMILY PRESENCE CARD RENDERER ---
function formatDurationAgo(timestampMs) {
  if (!timestampMs) return "No recent touch";
  const diffMins = Math.max(0, Math.floor((Date.now() - timestampMs) / 60000));
  if (diffMins < 1) return "Just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  const hrs = Math.floor(diffMins / 60), mins = diffMins % 60;
  if (hrs < 24) return mins > 0 ? `${hrs}h ${mins}m ago` : `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ${hrs % 24}h ago`;
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
      text: st === 'connected' ? `🔴 In a call with ${withName}` : `🟡 Ringing (${withName})`
    };
  }

  if (!settings.callingEnabled) {
    return { border: '#f59e0b', text: `📵 Video calling is switched off` };
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

export function updateFamilyPresenceBanner() {
  if (role !== 'family') return;
  const card = $('nana-presence-card'), ringBtn = $('family-ring-btn');
  if (!card) return;

  const p = state.presenceSnap || {};
  const summary = getSimpleNanaStatusSummary();
  card.style.borderColor = summary.border;

  const lastTouchTs = p.lastTouched || p.lastActive || null;
  const touchText = `👆 Last touched: ${formatDurationAgo(lastTouchTs)}`;
  const battText = p.batteryLevel != null
    ? ` • ${p.isCharging ? "🔌 Charging" : "⚠️ UNPLUGGED"} (${p.batteryLevel}%)`
    : "";

  const callsToday = getTodaysCompletedCallsList();
  let todayLineHtml = '';
  if (callsToday.length) {
    const summaryItems = callsToday.map(c => {
      const name = FAMILY_NAMES[c.partnerId] || c.partnerName || 'Family';
      const t = c.startedAt ? new Date(c.startedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : '';
      const m = Math.max(1, Math.round((Number(c.durationSec) || 60) / 60));
      return `${name} (${t}, ${m}m)`;
    }).join(' • ');
    todayLineHtml = `<br><span class="fam-today-calls-line" style="color:#86efac;font-size:0.84rem;font-weight:800;">💚 Connected calls today: ${summaryItems}</span>`;
  }

  const tgConnected = state.connectedMemberIds.includes(activeFamilyMember.id);
  const tgStatus = tgConnected
    ? `<span class="fam-tg-status-line" style="color:#4ade80;font-size:0.88rem;">✅ Your Telegram alerts are connected</span>`
    : `<span class="fam-tg-status-line" style="color:#fbbf24;font-size:0.88rem;">⚠️ Tap "1. Connect Telegram" below so Nana can call you</span>`;

  card.innerHTML = `<div style="font-size:1.05rem;font-weight:900;color:#fef08a;margin-bottom:2px;">${summary.text}</div><span class="fam-touch-batt-line" style="color:#cbd5e1;font-size:0.9rem;">${touchText}${battText}</span>${todayLineHtml}<br>${tgStatus}`;

  const st = state.callSnap?.status || 'idle';
  if (ringBtn) {
    if (st !== 'idle') {
      const otherId = state.callSnap.callerId === 'nana' ? state.callSnap.targetId : state.callSnap.callerId;
      if (otherId && otherId !== activeFamilyMember.id) ringBtn.disabled = true;
    } else {
      ringBtn.disabled = !settings.callingEnabled;
    }
  }
}
hooks.refreshFamilyPresence = updateFamilyPresenceBanner;

if (role === 'family') {
  onValue(refs.presence, snap => {
    state.presenceSnap = snap.val() || {};
    updateFamilyPresenceBanner();
  });
  setInterval(updateFamilyPresenceBanner, 15000);
}