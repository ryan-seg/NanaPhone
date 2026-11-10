import {
  $, NanaCore, esc, update, onValue, onDisconnect, query, limitToLast
} from "./nana-core.js?v=2.9.5";

const {
  role, activeFamilyMember, FAMILY_NAMES, refs, settings, state, hooks, isBatteryVoiceCurrentlyMuted
} = NanaCore;

let lastTouchWriteMs = 0;
let webBatteryObj = null;
let cachedBatteryLevel = null;
let cachedIsCharging = null;

// --- 1. TOP 62PX NO-TOUCH ORIENTATION BANNER & DISCREET STAFF BUTTON ---
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
    ensureCornerStaffAccessBtn();
  };

  updateTopOrientationBanner();
  setInterval(updateTopOrientationBanner, 10000);
}

// Discreet "🏥 Staff" button placed inside the tappable header bar (below the top 52px/62px kiosk touch-blocker)
function ensureCornerStaffAccessBtn() {
  if (role !== 'nana') return;

  // Remove any legacy fixed button that was inside the top 0..52px untappable blocker
  const existing = $('nana-corner-staff-btn');
  if (existing && existing.parentElement === document.body) {
    existing.remove();
  }

  const headerPills = document.querySelector('#grid-screen .header-pills');
  if (headerPills && !$('nana-corner-staff-btn')) {
    const btn = document.createElement('button');
    btn.id = 'nana-corner-staff-btn';
    btn.type = 'button';
    btn.className = 'staff-pill';
    btn.textContent = '🏥 Staff';
    btn.title = 'Care Home Staff Controls';
    btn.onclick = (ev) => {
      ev.stopPropagation();
      window.openCareHomeStaffGate();
    };
    const gear = headerPills.querySelector('.gear-pill');
    headerPills.insertBefore(btn, gear || null);
  }

  // Also ensure a tappable "🏥 Staff" pill is available on Radio, Video, and Family Chat headers (all >= 68px from top)
  ['#radio-screen .nana-top-nav', '#video-screen .nana-top-nav', '#bulletin-modal .tg-header'].forEach(sel => {
    const nav = document.querySelector(sel);
    if (nav && !nav.querySelector('.staff-pill')) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'staff-pill';
      b.textContent = '🏥 Staff';
      b.title = 'Care Home Staff Controls';
      b.onclick = (ev) => {
        ev.stopPropagation();
        window.openCareHomeStaffGate();
      };
      nav.appendChild(b);
    }
  });
}

// --- 2. TAPPABLE "PLEASE PLUG IN" BANNER (BELOW TOP 62PX BLOCKER) & CARE HOME ("CANFORD") GATE ---
function ensureUnpluggedWarningBanner() {
  let banner = $('nana-unplugged-warning-banner');
  if (banner) return banner;

  banner = document.createElement('div');
  banner.id = 'nana-unplugged-warning-banner';
  banner.style.cssText = [
    'position:fixed',
    'top:64px',
    'left:50%',
    'transform:translateX(-50%)',
    'min-height:54px',
    'z-index:9995',
    'background:#991b1b',
    'color:#fef08a',
    'border:3px solid #fde047',
    'border-radius:16px',
    'padding:6px 16px 6px 20px',
    'font-size:1.35rem',
    'font-weight:900',
    'box-shadow:0 6px 20px rgba(0,0,0,0.85)',
    'display:none',
    'align-items:center',
    'justify-content:center',
    'gap:14px',
    'text-align:center',
    'width:auto',
    'max-width:96vw',
    'white-space:nowrap',
    'pointer-events:auto'
  ].join(';');
  banner.innerHTML = `
    <span style="font-size:1.7rem;line-height:1;">🔌</span>
    <span id="nana-unplugged-warning-text">PLEASE PLUG IN THE TABLET CHARGER</span>
    <button id="nana-banner-staff-btn" type="button" style="pointer-events:auto;background:#1e293b;color:#fff;border:2px solid #fde047;border-radius:11px;padding:8px 14px;font-size:1.05rem;font-weight:900;cursor:pointer;margin-left:4px;">
      🏥 Care Home
    </button>
  `;
  document.body.appendChild(banner);
  $('nana-banner-staff-btn')?.addEventListener('click', (ev) => {
    ev.stopPropagation();
    window.openCareHomeStaffGate();
  });
  return banner;
}

// --- CARE HOME STAFF MODAL (10s "CANFORD" CONFIRMATION -> MUTE & ANDROID SETTINGS) ---
let careHomeCountdownTimer = null;
let careHomeTypedText = "";
let careHomeSecondsLeft = 10;

function ensureCareHomeModal() {
  let modal = $('care-home-staff-modal');
  if (modal) return modal;

  modal = document.createElement('div');
  modal.id = 'care-home-staff-modal';
  modal.style.cssText = [
    'position:fixed', 'inset:0', 'z-index:10060', 'background:rgba(9,13,22,0.94)',
    'display:none', 'flex-direction:column', 'align-items:center', 'justify-content:center',
    'padding:20px', 'text-align:center', 'user-select:none'
  ].join(';');

  const rows = [
    ['Q','W','E','R','T','Y','U','I','O','P'],
    ['A','S','D','F','G','H','J','K','L'],
    ['Z','X','C','V','B','N','M','⌫','CLR']
  ];

  const kbHtml = rows.map(row => `
    <div style="display:flex;gap:8px;justify-content:center;width:100%;">
      ${row.map(k => {
        const isAction = k === '⌫' || k === 'CLR';
        const bg = k === 'CLR' ? '#7f1d1d' : (k === '⌫' ? '#475569' : '#1e293b');
        const w = isAction ? '86px' : '64px';
        return `<button type="button" class="ch-key-btn" data-chkey="${k}" style="width:${w};height:58px;background:${bg};color:#fff;border:2px solid #94a3b8;border-radius:14px;font-size:1.45rem;font-weight:900;cursor:pointer;box-shadow:0 4px 10px rgba(0,0,0,0.45);">${k}</button>`;
      }).join('')}
    </div>
  `).join('');

  modal.innerHTML = `
    <div style="background:#0f172a;border:4px solid #38bdf8;border-radius:26px;padding:22px 26px;max-width:800px;width:95vw;box-shadow:0 16px 45px rgba(0,0,0,0.9);">
      <!-- STEP 1: 10-SECOND "CANFORD" ANTI-TAMPER CONFIRMATION -->
      <div id="care-home-gate-step">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
          <div style="font-size:1.6rem;font-weight:900;color:#fef08a;">🏥 Care Home Staff Gate</div>
          <div id="care-home-timer-pill" style="background:#7f1d1d;color:#fef08a;border:2px solid #f87171;border-radius:12px;padding:6px 14px;font-size:1.2rem;font-weight:900;">
            ⏱️ 10s
          </div>
        </div>
        
        <div style="background:#1e293b;border:2px dashed #38bdf8;border-radius:16px;padding:12px 16px;margin-bottom:14px;">
          <div style="font-size:1.15rem;font-weight:800;color:#e2e8f0;margin-bottom:4px;">
            To confirm you are a staff member, simply type:
          </div>
          <div style="font-size:2.4rem;font-weight:900;color:#38bdf8;letter-spacing:4px;">
            CANFORD
          </div>
          <div style="font-size:0.92rem;font-weight:600;color:#94a3b8;">
            (Case does not matter — prevents Nana from accidentally accessing device settings)
          </div>
        </div>

        <div id="care-home-typed-box" style="height:56px;background:#020617;border:3px solid #38bdf8;border-radius:16px;display:flex;align-items:center;justify-content:center;font-size:2.1rem;font-weight:900;letter-spacing:6px;color:#4ade80;margin-bottom:14px;">
          _
        </div>
        <div style="display:flex;flex-direction:column;gap:8px;margin-bottom:16px;">
          ${kbHtml}
        </div>
        <button type="button" id="care-home-cancel-btn" style="background:#334155;color:#fff;border:2px solid #94a3b8;border-radius:14px;padding:12px 28px;font-size:1.15rem;font-weight:800;cursor:pointer;">
          ✖ Cancel & Return
        </button>
      </div>

      <!-- STEP 2: UNLOCKED CARE HOME CONTROLS (THANK YOU MESSAGE, MUTE & ANDROID SETTINGS) -->
      <div id="care-home-actions-step" style="display:none;flex-direction:column;gap:14px;">
        <div style="display:flex;justify-content:space-between;align-items:center;">
          <div style="font-size:1.55rem;font-weight:900;color:#4ade80;">✅ Care Home Staff Controls</div>
          <div id="care-home-batt-pill" style="font-size:1.05rem;font-weight:800;color:#fef08a;"></div>
        </div>

        <!-- THANK YOU NOTE TO STAFF -->
        <div style="background:linear-gradient(135deg, rgba(22,101,52,0.4) 0%, rgba(30,58,138,0.4) 100%);border:3px solid #4ade80;border-radius:18px;padding:16px 20px;text-align:center;box-shadow:0 4px 14px rgba(0,0,0,0.5);">
          <div style="font-size:1.35rem;font-weight:900;color:#fef08a;line-height:1.4;">
            "Thank you so much for everything you do, you're amazing. I hope you have a great day"
          </div>
        </div>

        <div style="background:#1e293b;border:2px solid #475569;border-radius:18px;padding:16px;text-align:left;">
          <div style="font-size:1.15rem;font-weight:900;color:#fef08a;margin-bottom:4px;">
            🔕 Mute "Please Plug In" Voice Alerts
          </div>
          <div id="care-home-mute-status" style="font-size:0.98rem;font-weight:700;color:#38bdf8;margin-bottom:12px;">
            Voice alerts are currently active
          </div>
          <div style="display:flex;flex-wrap:wrap;gap:10px;">
            <button type="button" class="ch-mute-btn" data-mins="30" style="flex:1;min-width:120px;background:#0284c7;color:#fff;border:2px solid #7dd3fc;border-radius:14px;padding:14px 10px;font-size:1.1rem;font-weight:900;cursor:pointer;">🔇 Mute 30m</button>
            <button type="button" class="ch-mute-btn" data-mins="60" style="flex:1;min-width:120px;background:#0284c7;color:#fff;border:2px solid #7dd3fc;border-radius:14px;padding:14px 10px;font-size:1.1rem;font-weight:900;cursor:pointer;">🔇 Mute 1 Hour</button>
            <button type="button" class="ch-mute-btn" data-mins="120" style="flex:1;min-width:120px;background:#0284c7;color:#fff;border:2px solid #7dd3fc;border-radius:14px;padding:14px 10px;font-size:1.1rem;font-weight:900;cursor:pointer;">🔇 Mute 2 Hours</button>
            <button type="button" class="ch-mute-btn" data-mins="240" style="flex:1;min-width:120px;background:#0284c7;color:#fff;border:2px solid #7dd3fc;border-radius:14px;padding:14px 10px;font-size:1.1rem;font-weight:900;cursor:pointer;">🔇 Mute 4 Hours</button>
            <button type="button" class="ch-mute-btn" data-mins="0" style="flex:1;min-width:140px;background:#059669;color:#fff;border:2px solid #4ade80;border-radius:14px;padding:14px 10px;font-size:1.1rem;font-weight:900;cursor:pointer;">🔊 Unmute Now</button>
          </div>
        </div>

        <div style="background:#1e293b;border:2px solid #475569;border-radius:18px;padding:16px;text-align:left;">
          <div style="font-size:1.15rem;font-weight:900;color:#fef08a;margin-bottom:10px;">
            ⚙️ Tablet System & Wi-Fi Settings (Unlocks Kiosk for 5 Minutes)
          </div>
          <div style="display:flex;flex-wrap:wrap;gap:12px;">
            <button type="button" id="ch-open-wifi-btn" style="flex:1;min-width:200px;background:#0f766e;color:#fff;border:2px solid #5eead4;border-radius:14px;padding:14px 16px;font-size:1.15rem;font-weight:900;cursor:pointer;">
              📶 Open Wi-Fi Settings
            </button>
            <button type="button" id="ch-open-settings-btn" style="flex:1;min-width:200px;background:#4338ca;color:#fff;border:2px solid #a5b4fc;border-radius:14px;padding:14px 16px;font-size:1.15rem;font-weight:900;cursor:pointer;">
              ⚙️ Open Android Settings
            </button>
          </div>
        </div>

        <button type="button" id="care-home-close-btn" style="background:#dc2626;color:#fff;border:3px solid #fde047;border-radius:16px;padding:14px 24px;font-size:1.25rem;font-weight:900;cursor:pointer;">
          🔒 Re-Lock & Return to NanaPhone
        </button>
      </div>
    </div>
  `;

  document.body.appendChild(modal);

  modal.querySelectorAll('.ch-key-btn').forEach(btn => {
    btn.addEventListener('click', (ev) => {
      ev.stopPropagation();
      handleCareHomeKeyPress(btn.dataset.chkey);
    });
  });

  $('care-home-cancel-btn')?.addEventListener('click', () => window.closeCareHomeStaffModal(false));
  $('care-home-close-btn')?.addEventListener('click', () => window.closeCareHomeStaffModal(true));

  modal.querySelectorAll('.ch-mute-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const mins = Number(btn.dataset.mins) || 0;
      await window.muteBatteryVoiceForMinutesCareHome(mins);
      refreshCareHomeUnlockedUI();
    });
  });

  $('ch-open-wifi-btn')?.addEventListener('click', () => {
    window.closeCareHomeStaffModal(false);
    window.AndroidBridge?.unlockAdminForFiveMinutes?.();
    window.AndroidBridge?.openWifiSettings?.();
  });

  $('ch-open-settings-btn')?.addEventListener('click', () => {
    window.closeCareHomeStaffModal(false);
    window.AndroidBridge?.unlockAdminForFiveMinutes?.();
    window.AndroidBridge?.openAndroidSettings?.();
  });

  return modal;
}

function refreshCareHomeUnlockedUI() {
  const mutedUntil = Number(settings.batteryVoiceMutedUntil) || 0;
  const stEl = $('care-home-mute-status');
  if (stEl) {
    if (mutedUntil > Date.now()) {
      const timeStr = new Date(mutedUntil).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      stEl.textContent = `🔇 Muted until ${timeStr}`;
      stEl.style.color = '#fbbf24';
    } else {
      stEl.textContent = `🔊 Voice alerts are active (dynamic urgency timing)`;
      stEl.style.color = '#4ade80';
    }
  }
  const bp = $('care-home-batt-pill');
  if (bp) {
    bp.textContent = cachedBatteryLevel != null
      ? `${cachedIsCharging ? '⚡ Charging' : '🔌 Unplugged'} (${cachedBatteryLevel}%)`
      : '';
  }
}

function handleCareHomeKeyPress(key) {
  if (!key) return;
  if (key === 'CLR') {
    careHomeTypedText = "";
  } else if (key === '⌫' || key === 'BACKSPACE') {
    careHomeTypedText = careHomeTypedText.slice(0, -1);
  } else if (/^[A-Za-z]$/.test(key) && careHomeTypedText.length < 10) {
    careHomeTypedText += key.toUpperCase();
  }

  const box = $('care-home-typed-box');
  if (box) box.textContent = careHomeTypedText || "_";

  if (careHomeTypedText.trim().toLowerCase() === 'canford') {
    clearInterval(careHomeCountdownTimer);
    careHomeCountdownTimer = null;
    if ($('care-home-gate-step')) $('care-home-gate-step').style.display = 'none';
    if ($('care-home-actions-step')) $('care-home-actions-step').style.display = 'flex';
    refreshCareHomeUnlockedUI();
  }
}

// Physical keyboard support while the 10-second gate is open (case-insensitive)
window.addEventListener('keydown', (ev) => {
  const modal = $('care-home-staff-modal');
  const gate = $('care-home-gate-step');
  if (!modal || modal.style.display !== 'flex' || !gate || gate.style.display === 'none') return;
  if (ev.key === 'Backspace') {
    ev.preventDefault();
    handleCareHomeKeyPress('⌫');
  } else if (ev.key === 'Escape') {
    window.closeCareHomeStaffModal(false);
  } else if (/^[a-zA-Z]$/.test(ev.key)) {
    handleCareHomeKeyPress(ev.key);
  }
});

window.openCareHomeStaffGate = () => {
  const modal = ensureCareHomeModal();
  careHomeTypedText = "";
  careHomeSecondsLeft = 10;
  if ($('care-home-typed-box')) $('care-home-typed-box').textContent = "_";
  if ($('care-home-gate-step')) $('care-home-gate-step').style.display = 'block';
  if ($('care-home-actions-step')) $('care-home-actions-step').style.display = 'none';
  if ($('care-home-timer-pill')) $('care-home-timer-pill').textContent = `⏱️ ${careHomeSecondsLeft}s`;
  modal.style.display = 'flex';

  clearInterval(careHomeCountdownTimer);
  careHomeCountdownTimer = setInterval(() => {
    careHomeSecondsLeft -= 1;
    if ($('care-home-timer-pill')) {
      $('care-home-timer-pill').textContent = `⏱️ ${Math.max(0, careHomeSecondsLeft)}s`;
    }
    if (careHomeSecondsLeft <= 0) {
      window.closeCareHomeStaffModal(false);
    }
  }, 1000);
};

window.closeCareHomeStaffModal = (relockKiosk = false) => {
  clearInterval(careHomeCountdownTimer);
  careHomeCountdownTimer = null;
  careHomeTypedText = "";
  const modal = $('care-home-staff-modal');
  if (modal) modal.style.display = 'none';
  if (relockKiosk) {
    window.AndroidBridge?.relockKioskNow?.();
  }
};

window.muteBatteryVoiceForMinutesCareHome = async (minutes) => {
  const mins = Math.max(0, Number(minutes) || 0);
  const mutedUntil = mins > 0 ? (Date.now() + mins * 60 * 1000) : 0;
  settings.batteryVoiceMutedUntil = mutedUntil;
  window.speechSynthesis?.cancel();
  window.AndroidBridge?.muteBatteryVoiceForMinutes?.(mins);
  syncUnpluggedBannerAndVoice(cachedBatteryLevel, cachedIsCharging);
  await update(refs.settings, { batteryVoiceMutedUntil: mutedUntil }).catch(() => {});
};

function syncUnpluggedBannerAndVoice(level, isCharging) {
  if (role !== 'nana') return;
  const banner = ensureUnpluggedWarningBanner();
  const txtEl = $('nana-unplugged-warning-text');
  const rawThresh = Number(settings.batteryVoiceThresholdPct ?? 30);
  const battThresh = rawThresh >= 95 ? 30 : rawThresh;
  const inCall = !!state.currentState && state.currentState !== 'idle';

  if (battThresh <= 0 || isCharging !== false || level === null || level >= 90 || level > battThresh || inCall) {
    banner.style.display = 'none';
    return;
  }

  const muted = isBatteryVoiceCurrentlyMuted();
  if (txtEl) {
    txtEl.textContent = muted
      ? `PLEASE PLUG IN CHARGER (${level}% • 🔇 MUTED)`
      : `PLEASE PLUG IN THE TABLET CHARGER (${level}%)`;
  }
  banner.style.display = 'flex';

  if (!muted && !NanaCore.isCurrentlyInNightWindow?.()) {
    window.announceBatteryWarning?.(level);
  }
}
hooks.syncBatteryUI = () => syncUnpluggedBannerAndVoice(cachedBatteryLevel, cachedIsCharging);

// Initialize Chromium's native navigator.getBattery() for instant hardware events & real readings
if (role === 'nana' && navigator.getBattery) {
  navigator.getBattery().then(bm => {
    webBatteryObj = bm;
    const onBattChange = () => {
      cachedBatteryLevel = Math.round((bm.level ?? 1) * 100);
      cachedIsCharging = !!bm.charging;
      syncUnpluggedBannerAndVoice(cachedBatteryLevel, cachedIsCharging);
      update(refs.presence, {
        online: true,
        lastPing: Date.now(),
        batteryLevel: cachedBatteryLevel,
        isCharging: cachedIsCharging
      }).catch(() => {});
    };
    bm.addEventListener('chargingchange', onBattChange);
    bm.addEventListener('levelchange', onBattChange);
    onBattChange();
  }).catch(() => {});
}

export function readTabletBatteryStatus() {
  if (webBatteryObj && typeof webBatteryObj.level === 'number' && !Number.isNaN(webBatteryObj.level)) {
    cachedBatteryLevel = Math.round(webBatteryObj.level * 100);
    cachedIsCharging = !!webBatteryObj.charging;
  } else if (window.AndroidBridge?.getBatteryStatusJson) {
    try {
      const b = JSON.parse(window.AndroidBridge.getBatteryStatusJson());
      if (typeof b.level === 'number') {
        cachedBatteryLevel = b.level;
        cachedIsCharging = !!b.charging;
      }
    } catch (_) {}
  }

  syncUnpluggedBannerAndVoice(cachedBatteryLevel, cachedIsCharging);
  return { batteryLevel: cachedBatteryLevel, isCharging: cachedIsCharging };
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
let lastBroadcastScreenState = '';
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
  const appState = document.visibilityState === 'hidden' ? 'backgrounded' : 'foreground';
  const sig = `${screenState}|${appState}`;
  if (sig === lastBroadcastScreenState) return;
  lastBroadcastScreenState = sig;

  update(refs.presence, {
    online: true,
    currentScreen: screenState,
    appState
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
    ensureCornerStaffAccessBtn();
    window.wakeScreenAndResetDimTimer?.();
    recordBackgroundHeartbeat();
    broadcastNanaCurrentScreen();
  }, 2000);
  setInterval(recordBackgroundHeartbeat, 20000);
  setInterval(broadcastNanaCurrentScreen, 10000);
}

// --- 4. TODAY'S CONNECTED CALLS BANNER (NEVER SHOWS MISSED CALLS) ---
export function getTodaysCompletedCallsList() {
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const todayMs = startOfToday.getTime();
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
      text: `🎬 Video is playing${curItem?.item?.title ? ` (${esc(curItem.item.title)})` : ''}`
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
      const name = esc(FAMILY_NAMES[c.partnerId] || c.partnerName || 'Family');
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
