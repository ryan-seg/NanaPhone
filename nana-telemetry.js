import {
  $, NanaCore, esc, update, remove, push, onValue, runTransaction, onDisconnect, query, limitToLast
} from "./nana-core.js?v=2.9.6";

const {
  CONFIG, SERVICE_TOKEN, PORTAL_NODE_ID,
  role, activeFamilyMember, isAdminFamilyMember, FAMILY_NAMES, refs, settings, state, hooks, isBatteryVoiceCurrentlyMuted
} = NanaCore;

const PAGE_LOAD_MS = Date.now();
let lastTouchWriteMs = 0;
let webBatteryObj = null;
let cachedBatteryLevel = null;
let cachedIsCharging = null;
let alertsLoaded = false;
let firebaseConnected = false;
let prevPresenceReady = (role !== 'nana');
let bootPrevPresence = null;
let bootAbruptDeathChecked = false;
let batteryAlertTxInFlight = false;

async function postSystemFamilyChatAlert(text) {
  const cleanText = String(text || '').trim();
  if (!cleanText) return;
  const now = Date.now();
  try {
    await push(refs.bulletin, {
      author: 'Tablet Status',
      fromNana: true,
      systemAlert: true,
      text: cleanText,
      timestamp: now,
      readByNanaAt: now
    });
  } catch (_) {}
  if (CONFIG?.googleScriptUrl && SERVICE_TOKEN) {
    try {
      await fetch(CONFIG.googleScriptUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({
          secret: SERVICE_TOKEN,
          portalNode: PORTAL_NODE_ID,
          action: 'system_alert',
          text: cleanText
        })
      });
    } catch (_) {}
  }
}

function evaluateNanaBatteryChatAlerts() {
  if (role !== 'nana' || batteryAlertTxInFlight) return;
  if (!firebaseConnected || !state.settingsLoaded || !alertsLoaded || !prevPresenceReady) return;
  if (settings.batteryChatAlertsEnabled === false) {
    bootAbruptDeathChecked = true;
    return;
  }
  if (cachedBatteryLevel === null || typeof cachedIsCharging !== 'boolean') return;

  const level = Math.round(cachedBatteryLevel);
  const charging = !!cachedIsCharging;
  const alerts = state.alertsSnap || {};
  const now = Date.now();

  let abruptCandidate = false;
  if (!bootAbruptDeathChecked) {
    const prevLastPing = Number(bootPrevPresence?.lastPing || 0);
    const prevBatt = bootPrevPresence?.batteryLevel != null ? Number(bootPrevPresence.batteryLevel) : null;
    const prevCharging = bootPrevPresence?.isCharging;
    const offlineGapMs = prevLastPing > 0 ? (PAGE_LOAD_MS - prevLastPing) : 0;
    const isAbruptLowBatteryDeath = !alerts.batteryOutActive
      && prevCharging === false
      && prevBatt !== null
      && prevBatt <= 15
      && offlineGapMs > 180000
      && (now - (Number(alerts.backOnlineSentAt) || 0) > 300000);
    if (isAbruptLowBatteryDeath) {
      abruptCandidate = (charging || level > 6);
    } else {
      bootAbruptDeathChecked = true;
    }
  }

  // 1. Back online notification (after battery-out or abrupt low-battery shutdown)
  if ((alerts.batteryOutActive === true || abruptCandidate) && (charging || level > 6)) {
    batteryAlertTxInFlight = true;
    let postKind = null;
    runTransaction(refs.alerts, current => {
      postKind = null;
      const cur = (current && typeof current === 'object') ? { ...current } : {};
      const curOut = !!cur.batteryOutActive;
      const lastBack = Number(cur.backOnlineSentAt || 0);
      if (!curOut && !abruptCandidate) return;
      if (!curOut && (Date.now() - lastBack < 300000)) return;
      postKind = curOut ? 'marked' : 'abrupt';
      return {
        ...cur,
        batteryOutActive: false,
        backOnlineSentAt: Date.now(),
        backOnlineSource: 'tablet',
        backOnlineLevel: level,
        backOnlineCharging: charging
      };
    }).then(txRes => {
      bootAbruptDeathChecked = true;
      if (txRes.committed && postKind) {
        const chTxt = charging ? '🔌 Charging' : '⚠️ Unplugged';
        const msgText = postKind === 'marked'
          ? `✅🔋 Nana's tablet is back online! (Battery: ${level}% • ${chTxt})`
          : `✅🔋 Nana's tablet is back online after running out of battery! (Battery: ${level}% • ${chTxt})`;
        return postSystemFamilyChatAlert(msgText);
      }
    }).catch(() => {}).finally(() => {
      batteryAlertTxInFlight = false;
    });
    return;
  }

  // 2. Critically low battery alert before tablet powers off (<= 5% and unplugged)
  if (!charging && level <= 5 && !alerts.batteryOutActive && (now - (Number(alerts.backOnlineSentAt) || 0) > 120000)) {
    batteryAlertTxInFlight = true;
    let shouldPost = false;
    runTransaction(refs.alerts, current => {
      shouldPost = false;
      const cur = (current && typeof current === 'object') ? { ...current } : {};
      if (cur.batteryOutActive) return;
      if (Date.now() - (Number(cur.backOnlineSentAt) || 0) < 120000) return;
      shouldPost = true;
      return {
        ...cur,
        batteryOutActive: true,
        batteryOutSentAt: Date.now(),
        batteryOutSource: 'tablet',
        batteryOutLevel: level
      };
    }).then(txRes => {
      if (txRes.committed && shouldPost) {
        return postSystemFamilyChatAlert(`🪫 Nana's tablet battery has nearly run out (${level}%) and may switch off — please plug in the charger.`);
      }
    }).catch(() => {}).finally(() => {
      batteryAlertTxInFlight = false;
    });
  }
}

function evaluateFamilyBatteryChatAlerts() {
  if (role !== 'family' || batteryAlertTxInFlight) return;
  if (!state.settingsLoaded || !alertsLoaded) return;
  if (settings.batteryChatAlertsEnabled === false) return;

  const p = state.presenceSnap || {};
  const lastPing = Number(p.lastPing || 0);
  if (!lastPing) return;

  const now = Date.now();
  const lastSeenMs = Math.max(lastPing, Number(p.lastConnectedAt || 0));
  const silenceSec = Math.floor((now - lastSeenMs) / 1000);
  const isOffline = (p.online === false) || (silenceSec > 75);
  const sustainedDeadOffline = silenceSec >= 180 && (p.online === false || silenceSec >= 300);
  const batt = p.batteryLevel != null ? Number(p.batteryLevel) : null;
  const charging = !!p.isCharging;
  const alerts = state.alertsSnap || {};

  // 1. Tablet is sustainably offline with dead/critically low unplugged battery
  if (isOffline && sustainedDeadOffline && batt !== null && !charging && (batt <= 6 || (batt <= 14 && silenceSec > 600))) {
    if (!alerts.batteryOutActive && (now - (Number(alerts.backOnlineSentAt) || 0) > 300000)) {
      batteryAlertTxInFlight = true;
      let shouldPost = false;
      runTransaction(refs.alerts, current => {
        shouldPost = false;
        const cur = (current && typeof current === 'object') ? { ...current } : {};
        if (cur.batteryOutActive) return;
        if (Date.now() - (Number(cur.backOnlineSentAt) || 0) < 300000) return;
        shouldPost = true;
        return {
          ...cur,
          batteryOutActive: true,
          batteryOutSentAt: Date.now(),
          batteryOutSource: 'family',
          batteryOutLevel: batt
        };
      }).then(txRes => {
        if (txRes.committed && shouldPost) {
          return postSystemFamilyChatAlert(`🪫 Nana's tablet appears to have run out of battery (last seen at ${batt}%) and is offline.`);
        }
      }).catch(() => {}).finally(() => {
        batteryAlertTxInFlight = false;
      });
    }
    return;
  }

  // 2. Fallback back-online alert if tablet came back online >45s ago and alerts.batteryOutActive is still set
  if (!isOffline && silenceSec < 60 && alerts.batteryOutActive === true && (charging || (batt !== null && batt > 6))) {
    const connAgeMs = p.lastConnectedAt ? (now - Number(p.lastConnectedAt)) : 999999;
    const outAgeMs = now - (Number(alerts.batteryOutSentAt) || 0);
    if (connAgeMs > 45000 && outAgeMs > 45000) {
      batteryAlertTxInFlight = true;
      let shouldPost = false;
      runTransaction(refs.alerts, current => {
        shouldPost = false;
        const cur = (current && typeof current === 'object') ? { ...current } : {};
        if (!cur.batteryOutActive) return;
        shouldPost = true;
        return {
          ...cur,
          batteryOutActive: false,
          backOnlineSentAt: Date.now(),
          backOnlineSource: 'family',
          backOnlineLevel: batt,
          backOnlineCharging: charging
        };
      }).then(txRes => {
        if (txRes.committed && shouldPost) {
          const chTxt = charging ? '🔌 Charging' : '⚠️ Unplugged';
          const battPart = batt != null ? `${batt}% • ` : '';
          return postSystemFamilyChatAlert(`✅🔋 Nana's tablet is back online! (Battery: ${battPart}${chTxt})`);
        }
      }).catch(() => {}).finally(() => {
        batteryAlertTxInFlight = false;
      });
    }
  }
}

onValue(refs.alerts, snap => {
  state.alertsSnap = snap.val() || {};
  alertsLoaded = true;
  if (role === 'nana') evaluateNanaBatteryChatAlerts();
  else evaluateFamilyBatteryChatAlerts();
});
hooks.onSettingsChanged.push(() => {
  if (role === 'nana') {
    evaluateNanaBatteryChatAlerts();
  } else {
    updateFamilyPresenceBanner();
    evaluateFamilyBatteryChatAlerts();
  }
});

// --- 1. TOP 62PX NO-TOUCH ORIENTATION BANNER & DISCREET STAFF BUTTON ---
if (role === 'nana') {
  let lastOrientationBannerText = '';
  let lastOrientationTickMs = 0;
  const updateTopOrientationBanner = (force = false) => {
    const nowMs = Date.now();
    if (!force && NanaCore.isLowPowerMode?.() && (nowMs - lastOrientationTickMs < 29000)) return;
    lastOrientationTickMs = nowMs;

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

    const nextText = `${period} • ${dayName} ${dateStr} • ${timeStr}`;
    if (nextText !== lastOrientationBannerText) {
      lastOrientationBannerText = nextText;
      topBar.textContent = nextText;
    }
    ensureCornerStaffAccessBtn();
  };

  updateTopOrientationBanner(true);
  setInterval(() => updateTopOrientationBanner(false), 10000);
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

  // Also ensure a tappable "🏥 Staff" pill is available on Radio, Video, Patience, and Family Chat headers (all >= 68px from top)
  ['#radio-screen .nana-top-nav', '#video-screen .nana-top-nav', '#patience-screen .nana-top-nav', '#bulletin-modal .tg-header'].forEach(sel => {
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
function positionUnpluggedBannerOverRadioAndVideo() {
  if (role !== 'nana') return;
  const banner = $('nana-unplugged-warning-banner');
  if (!banner || banner.style.display === 'none') return;

  let navSel = '#grid-screen .header-bar';
  if ($('bulletin-modal')?.style.display === 'flex') navSel = '#bulletin-modal .tg-header';
  else if ($('radio-screen')?.classList.contains('active')) navSel = '#radio-screen .nana-top-nav';
  else if ($('video-screen')?.classList.contains('active')) navSel = '#video-screen .nana-top-nav';
  else if ($('patience-screen')?.classList.contains('active')) navSel = '#patience-screen .nana-top-nav';

  const nav = document.querySelector(navSel);
  const chatBtn = nav?.querySelector('.chat-pill-x');
  const radioBtn = nav?.querySelector('.radio-pill-x');
  const videoBtn = nav?.querySelector('.video-pill-x');
  const gearBtn = nav?.querySelector('.gear-pill');

  const vw = window.innerWidth || 1024;
  const chatRect = chatBtn?.getBoundingClientRect();
  const radioRect = radioBtn?.getBoundingClientRect();
  const videoRect = videoBtn?.getBoundingClientRect();
  const gearRect = gearBtn?.getBoundingClientRect();
  if (!nav || (!(chatRect?.width > 0) && !(radioRect?.width > 0) && !(videoRect?.width > 0))) return;

  const afterChatLeft = (chatRect && chatRect.width > 0) ? Math.ceil(chatRect.right + 8) : Math.round(vw * 0.45);
  let leftPx = (radioRect && radioRect.width > 0)
    ? Math.max(afterChatLeft, Math.floor(radioRect.left))
    : afterChatLeft;

  let rightEdgePx = vw - 10;
  if (navSel === '#grid-screen .header-bar' && gearRect && gearRect.width > 0) {
    const beforeGear = Math.floor(gearRect.left - 8);
    if (beforeGear - leftPx >= 240) rightEdgePx = beforeGear;
  } else if (videoRect && videoRect.width > 0) {
    rightEdgePx = Math.max(rightEdgePx, Math.ceil(videoRect.right));
  }

  rightEdgePx = Math.min(vw - 8, Math.max(leftPx + 180, rightEdgePx));
  const rightPx = Math.max(8, vw - rightEdgePx);

  const refRect = (radioRect && radioRect.height > 0) ? radioRect : videoRect;
  const topPx = (refRect && refRect.height > 0) ? Math.max(64, Math.floor(refRect.top - 2)) : 64;
  const minH = (refRect && refRect.height > 0) ? Math.max(44, Math.ceil(refRect.height + 4)) : 48;

  banner.style.top = `${topPx}px`;
  banner.style.left = `${leftPx}px`;
  banner.style.right = `${rightPx}px`;
  banner.style.transform = 'none';
  banner.style.width = 'auto';
  banner.style.maxWidth = 'none';
  banner.style.minHeight = `${minH}px`;
}

function ensureUnpluggedWarningBanner() {
  let banner = $('nana-unplugged-warning-banner');
  if (banner) return banner;

  banner = document.createElement('div');
  banner.id = 'nana-unplugged-warning-banner';
  banner.style.cssText = [
    'position:fixed',
    'top:64px',
    'left:50%',
    'right:10px',
    'min-height:46px',
    'z-index:138',
    'background:#991b1b',
    'color:#fef08a',
    'border:3px solid #fde047',
    'border-radius:14px',
    'padding:4px 8px 4px 10px',
    'font-size:clamp(0.78rem, 1.18vw, 1.02rem)',
    'font-weight:900',
    'line-height:1.15',
    'box-shadow:0 6px 20px rgba(0,0,0,0.85)',
    'display:none',
    'align-items:center',
    'justify-content:center',
    'gap:6px',
    'text-align:center',
    'flex-wrap:wrap',
    'pointer-events:auto'
  ].join(';');
  banner.innerHTML = `
    <span style="font-size:1.15rem;line-height:1;">🔌</span>
    <span id="nana-unplugged-warning-text">LOW POWER • PLUG IN CHARGER</span>
    <button id="nana-banner-staff-btn" type="button" style="pointer-events:auto;background:#1e293b;color:#fff;border:2px solid #fde047;border-radius:10px;padding:4px 8px;font-size:0.84rem;font-weight:900;white-space:nowrap;cursor:pointer;margin-left:2px;">
      🏥 Care Home
    </button>
  `;
  document.body.appendChild(banner);
  $('nana-banner-staff-btn')?.addEventListener('click', (ev) => {
    ev.stopPropagation();
    window.openCareHomeStaffGate();
  });
  window.addEventListener('resize', positionUnpluggedBannerOverRadioAndVideo);
  return banner;
}

// --- CARE HOME STAFF MODAL (10s "CANFORD" CONFIRMATION -> MUTE & ANDROID SETTINGS) ---
let careHomeCountdownTimer = null;
let careHomeUnlockedIdleTimer = null;
let careHomeTypedText = "";
let careHomeSecondsLeft = 10;

function resetCareHomeUnlockedIdleTimer() {
  clearTimeout(careHomeUnlockedIdleTimer);
  careHomeUnlockedIdleTimer = null;
  if ($('care-home-staff-modal')?.style.display === 'flex' && $('care-home-actions-step')?.style.display === 'flex') {
    careHomeUnlockedIdleTimer = setTimeout(() => {
      window.closeCareHomeStaffModal(false);
    }, 60000);
  }
}

function ensureCareHomeModal() {
  let modal = $('care-home-staff-modal');
  if (modal) return modal;

  modal = document.createElement('div');
  modal.id = 'care-home-staff-modal';
  modal.style.cssText = [
    'position:fixed', 'inset:0', 'z-index:10060', 'background:rgba(9,13,22,0.94)',
    'display:none', 'flex-direction:column', 'align-items:center', 'justify-content:flex-start',
    'overflow-y:auto', 'padding:68px 20px 24px 20px', 'text-align:center', 'user-select:none'
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
    <div style="background:#0f172a;border:4px solid #38bdf8;border-radius:26px;padding:22px 26px;max-width:800px;width:95vw;margin:auto;box-shadow:0 16px 45px rgba(0,0,0,0.9);">
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

  modal.addEventListener('pointerdown', resetCareHomeUnlockedIdleTimer, { passive: true });
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
      resetCareHomeUnlockedIdleTimer();
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
    resetCareHomeUnlockedIdleTimer();
  }
}

// Physical keyboard support while the Care Home modal is open (case-insensitive)
window.addEventListener('keydown', (ev) => {
  const modal = $('care-home-staff-modal');
  if (!modal || modal.style.display !== 'flex') return;
  if (ev.key === 'Escape') {
    window.closeCareHomeStaffModal(false);
    return;
  }
  if (ev.ctrlKey || ev.metaKey || ev.altKey) return;
  const gate = $('care-home-gate-step');
  if (!gate || gate.style.display === 'none') return;
  if (ev.key === 'Backspace') {
    ev.preventDefault();
    handleCareHomeKeyPress('⌫');
  } else if (/^[a-zA-Z]$/.test(ev.key)) {
    handleCareHomeKeyPress(ev.key);
  }
});

window.openCareHomeStaffGate = () => {
  const modal = ensureCareHomeModal();
  clearTimeout(careHomeUnlockedIdleTimer);
  careHomeUnlockedIdleTimer = null;
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
  clearTimeout(careHomeUnlockedIdleTimer);
  careHomeUnlockedIdleTimer = null;
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

let lastEffectiveLowPowerNotified = null;
let lastVideoBlockedNotified = null;
let prevObservedCharging = null;
let unplugVoicePending = false;

function applyPowerModeFromChargingState(isCharging, level) {
  if (role !== 'nana') return;
  state.isTabletUnplugged = (isCharging === false);
  const effectiveLP = !!NanaCore.isLowPowerMode?.();
  const videoBlocked = !!NanaCore.isVideoBlockedByLowPower?.();
  document.body.classList.toggle('low-power-mode', effectiveLP);
  const changed = (lastEffectiveLowPowerNotified !== effectiveLP) || (lastVideoBlockedNotified !== videoBlocked);
  if (changed) {
    lastEffectiveLowPowerNotified = effectiveLP;
    lastVideoBlockedNotified = videoBlocked;
    hooks.onPowerModeChanged.forEach(fn => {
      try { fn(effectiveLP, level, videoBlocked); } catch (_) {}
    });
  }
}

let pluggedPeakBatteryLevel = null;

function syncUnpluggedBannerAndVoice(level, isCharging) {
  if (role !== 'nana') return;
  if (typeof level === 'number' && !Number.isNaN(level)) state.batteryLevel = level;
  if (typeof isCharging === 'boolean') {
    const prevCharging = state.isCharging;
    state.isCharging = isCharging;
    if (isCharging) {
      unplugVoicePending = false;
      if (typeof level === 'number' && !Number.isNaN(level)) {
        const prevReduction = Number(state.screensaverPowerReductionPct || 0);
        if (pluggedPeakBatteryLevel === null || level >= pluggedPeakBatteryLevel) {
          pluggedPeakBatteryLevel = level;
          state.isBatteryDecreasingWhilePlugged = false;
          state.screensaverPowerReductionPct = 0;
        } else {
          const drop = pluggedPeakBatteryLevel - level;
          if (level >= 98) {
            state.isBatteryDecreasingWhilePlugged = false;
            state.screensaverPowerReductionPct = 0;
          } else if (drop === 1) {
            state.isBatteryDecreasingWhilePlugged = false;
            state.screensaverPowerReductionPct = 10;
          } else if (drop === 2) {
            state.isBatteryDecreasingWhilePlugged = false;
            state.screensaverPowerReductionPct = 20;
          } else if (level < 97 && drop >= 3) {
            state.isBatteryDecreasingWhilePlugged = true;
            state.screensaverPowerReductionPct = 35;
            hooks.stopPhotoScreensaver?.('battery_decreasing');
          }
        }
        if (state.screensaverPowerReductionPct !== prevReduction && state.isPhotoScreensaverActive) {
          hooks.updateScreensaverBrightness?.();
        }
      }
    } else {
      pluggedPeakBatteryLevel = null;
      state.isBatteryDecreasingWhilePlugged = false;
      state.screensaverPowerReductionPct = 0;
      hooks.stopPhotoScreensaver?.('unplugged');
      if (prevObservedCharging === true) {
        unplugVoicePending = true;
      }
    }
    prevObservedCharging = isCharging;
    if (prevCharging !== true && isCharging === true) {
      if (document.body.classList.contains('screen-dimmed') && !state.isPhotoScreensaverActive) {
        hooks.tryStartPhotoScreensaver?.();
      } else if (!state.isPhotoScreensaverActive) {
        window.wakeScreenAndResetDimTimer?.();
      }
    }
  }

  applyPowerModeFromChargingState(isCharging, level);
  const banner = ensureUnpluggedWarningBanner();
  const txtEl = $('nana-unplugged-warning-text');
  const rawThresh = Number(settings.batteryVoiceThresholdPct ?? 30);
  const battThresh = rawThresh >= 100 ? 30 : rawThresh;
  const inCall = !!state.currentState && state.currentState !== 'idle';

  if (isCharging !== false || level === null || inCall) {
    banner.style.display = 'none';
    return;
  }

  const muted = isBatteryVoiceCurrentlyMuted();
  const inNight = !!NanaCore.isCurrentlyInNightWindow?.();
  let spokeUnplugJustNow = false;
  if (unplugVoicePending) {
    unplugVoicePending = false;
    if (!muted && !inNight) {
      const battVol = Math.min(1.0, Math.max(0.2, (Number(settings.batteryVoiceVolume ?? 85)) / 100));
      NanaCore.speakMsg?.('Please keep tablet cable connected, thank you.', true, battVol);
      spokeUnplugJustNow = true;
    }
  }

  const lpPrefix = NanaCore.isLowPowerMode?.() ? 'LOW POWER' : 'UNPLUGGED';
  if (txtEl) {
    txtEl.textContent = muted
      ? `${lpPrefix} (${level}%) • UNPLUGGED • 🔇 MUTED`
      : `${lpPrefix} (${level}%) • PLUG IN CHARGER`;
  }
  banner.style.display = 'flex';
  positionUnpluggedBannerOverRadioAndVideo();
  requestAnimationFrame(positionUnpluggedBannerOverRadioAndVideo);

  const shouldSpeak = battThresh > 0 && level <= battThresh && !muted && !inNight;
  if (!spokeUnplugJustNow && shouldSpeak) {
    window.announceBatteryWarning?.(level);
  }
}
hooks.syncBatteryUI = () => syncUnpluggedBannerAndVoice(cachedBatteryLevel, cachedIsCharging);

function refreshCachedBatteryValues() {
  if (window.AndroidBridge?.getBatteryStatusJson) {
    try {
      const b = JSON.parse(window.AndroidBridge.getBatteryStatusJson());
      if (typeof b.level === 'number') {
        cachedBatteryLevel = b.level;
        cachedIsCharging = !!b.charging;
        return;
      }
    } catch (_) {}
  }
  if (webBatteryObj && typeof webBatteryObj.level === 'number' && !Number.isNaN(webBatteryObj.level)) {
    cachedBatteryLevel = Math.round(webBatteryObj.level * 100);
    cachedIsCharging = !!webBatteryObj.charging;
  }
}

// Initialize Chromium's native navigator.getBattery() for instant hardware events & real readings
if (role === 'nana' && navigator.getBattery) {
  navigator.getBattery().then(bm => {
    webBatteryObj = bm;
    const onBattChange = () => {
      refreshCachedBatteryValues();
      syncUnpluggedBannerAndVoice(cachedBatteryLevel, cachedIsCharging);
      evaluateNanaBatteryChatAlerts();
      if (!prevPresenceReady) return;
      update(refs.presence, {
        online: true,
        lastPing: Date.now(),
        batteryLevel: cachedBatteryLevel,
        isCharging: cachedIsCharging,
        lowPowerMode: NanaCore.isLowPowerMode()
      }).catch(() => {});
    };
    bm.addEventListener('chargingchange', onBattChange);
    bm.addEventListener('levelchange', onBattChange);
    onBattChange();
  }).catch(() => {});
}

export function readTabletBatteryStatus() {
  refreshCachedBatteryValues();
  syncUnpluggedBannerAndVoice(cachedBatteryLevel, cachedIsCharging);
  evaluateNanaBatteryChatAlerts();
  return { batteryLevel: cachedBatteryLevel, isCharging: cachedIsCharging };
}
if (role === 'nana') readTabletBatteryStatus();

export function recordTouchActivity(customActivity = null) {
  state.lastActivityOrCallMs = Date.now();
  if (role !== 'nana') return;
  const now = Date.now();
  const minGapMs = NanaCore.isLowPowerMode() ? 30000 : 15000;
  if (!customActivity && (now - lastTouchWriteMs < minGapMs)) return;
  const { batteryLevel, isCharging } = readTabletBatteryStatus();
  if (!prevPresenceReady) return;
  lastTouchWriteMs = now;
  const payload = {
    online: true,
    appState: 'foreground',
    lastExitHint: 'active_in_app',
    lastTouched: now,
    lastActive: now,
    lastPing: now,
    batteryLevel,
    isCharging,
    lowPowerMode: NanaCore.isLowPowerMode()
  };
  if (customActivity) payload.lastActivity = customActivity;
  update(refs.presence, payload).catch(() => {});
}
NanaCore.recordTouchActivity = recordTouchActivity;

let lastHeartbeatWriteMs = 0;
function recordBackgroundHeartbeat(force = false) {
  if (role !== 'nana') return;
  const { batteryLevel, isCharging } = readTabletBatteryStatus();
  if (!prevPresenceReady) return;
  const now = Date.now();
  // In Low Power Mode write every ~40s (well under the 75s offline threshold) instead of every 20s
  const minHeartbeatGapMs = NanaCore.isLowPowerMode() ? 38000 : 18000;
  if (!force && (now - lastHeartbeatWriteMs < minHeartbeatGapMs)) return;
  lastHeartbeatWriteMs = now;

  const isHidden = document.visibilityState === 'hidden';
  const payload = {
    online: true,
    appState: isHidden ? 'backgrounded' : 'foreground',
    lastPing: now,
    batteryLevel,
    isCharging,
    lowPowerMode: NanaCore.isLowPowerMode()
  };
  if (!isHidden) payload.lastExitHint = 'active_in_app';
  update(refs.presence, payload).catch(() => {});
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
  positionUnpluggedBannerOverRadioAndVideo();
  requestAnimationFrame(positionUnpluggedBannerOverRadioAndVideo);
  if (!prevPresenceReady) return;
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
  } else if ($('patience-screen')?.classList.contains('active')) {
    screenState = 'patience';
  }
  const appState = document.visibilityState === 'hidden' ? 'backgrounded' : 'foreground';
  const sig = `${screenState}|${appState}`;
  if (sig === lastBroadcastScreenState) return;
  lastBroadcastScreenState = sig;

  const payload = {
    online: true,
    currentScreen: screenState,
    appState
  };
  if (appState === 'foreground') payload.lastExitHint = 'active_in_app';
  update(refs.presence, payload).catch(() => {});
}
hooks.broadcastScreen = broadcastNanaCurrentScreen;

if (role === 'nana') {
  const writeConnectedPresence = () => {
    const appState = document.visibilityState === 'hidden' ? 'backgrounded' : 'foreground';
    const payload = {
      online: true,
      appState,
      networkOnline: navigator.onLine !== false,
      lastConnectedAt: Date.now()
    };
    if (appState === 'foreground') payload.lastExitHint = 'active_in_app';
    update(refs.presence, payload).catch(() => {});
  };

  const finalizePrevPresenceCapture = (val) => {
    if (prevPresenceReady) return;
    bootPrevPresence = val || {};
    prevPresenceReady = true;
    if (firebaseConnected) writeConnectedPresence();
    recordBackgroundHeartbeat(true);
    lastBroadcastScreenState = '';
    broadcastNanaCurrentScreen();
    evaluateNanaBatteryChatAlerts();
  };
  onValue(refs.presence, snap => finalizePrevPresenceCapture(snap.val()), { onlyOnce: true });
  setTimeout(() => finalizePrevPresenceCapture({}), 3000);

  onValue(refs.connectedInfo, snap => {
    firebaseConnected = (snap.val() === true);
    if (firebaseConnected) {
      onDisconnect(refs.presence).update({ online: false, disconnectedAt: Date.now() }).catch(() => {});
      if (prevPresenceReady) {
        writeConnectedPresence();
        evaluateNanaBatteryChatAlerts();
      }
    }
  });

  document.addEventListener('visibilitychange', () => {
    if (!prevPresenceReady) return;
    const isHidden = document.visibilityState === 'hidden';
    update(refs.presence, {
      appState: isHidden ? 'backgrounded' : 'foreground',
      appStateChangedAt: Date.now(),
      lastExitHint: isHidden ? 'backed_out_or_notification' : 'active_in_app'
    }).catch(() => {});
  });

  window.addEventListener('blur', () => {
    if (!prevPresenceReady) return;
    if (document.visibilityState !== 'hidden') {
      update(refs.presence, {
        appState: 'shade_or_overlay',
        appStateChangedAt: Date.now(),
        lastExitHint: 'notification_shade_or_overlay'
      }).catch(() => {});
    }
  });

  window.addEventListener('focus', () => {
    if (!prevPresenceReady) return;
    update(refs.presence, {
      appState: 'foreground',
      appStateChangedAt: Date.now(),
      lastExitHint: 'active_in_app'
    }).catch(() => {});
  });

  window.addEventListener('offline', () => {
    if (!prevPresenceReady) return;
    update(refs.presence, {
      networkOnline: false,
      lastExitHint: 'wifi_turned_off',
      wifiDroppedAt: Date.now()
    }).catch(() => {});
  });

  window.addEventListener('online', () => {
    if (!prevPresenceReady) return;
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
    recordBackgroundHeartbeat(true);
    broadcastNanaCurrentScreen();
  }, 2000);
  setInterval(() => recordBackgroundHeartbeat(false), 20000);
  let screenTickCount = 0;
  setInterval(() => {
    screenTickCount++;
    if (NanaCore.isLowPowerMode() && screenTickCount % 3 !== 0) return;
    broadcastNanaCurrentScreen();
  }, 10000);
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

function getCondensedTodaysCallsSummary(callsToday = getTodaysCompletedCallsList()) {
  const byPerson = new Map();
  callsToday.forEach(c => {
    const key = c.partnerId || (c.partnerName || 'Family').toLowerCase();
    const name = FAMILY_NAMES[c.partnerId] || c.partnerName || 'Family';
    const durSec = Math.max(0, Number(c.durationSec) || 0);
    const startedAt = Number(c.startedAt || c.endedAt || 0);
    const prev = byPerson.get(key);
    if (!prev) {
      byPerson.set(key, { key, name, count: 1, totalSec: durSec, lastStartedAt: startedAt });
    } else {
      prev.count += 1;
      prev.totalSec += durSec;
      if (startedAt >= prev.lastStartedAt) {
        prev.lastStartedAt = startedAt;
        prev.name = name;
      }
    }
  });
  return Array.from(byPerson.values())
    .sort((a, b) => b.lastStartedAt - a.lastStartedAt)
    .map(g => ({ ...g, totalMin: Math.max(1, Math.round(g.totalSec / 60)) }));
}

let lastCallsRenderSig = null;
export function renderTodaysCallsBanner() {
  const banner = $('todays-calls-reassurance-banner');
  const chipsBox = $('todays-calls-chips-container');
  const labelEl = $('todays-calls-label');
  if (!banner || !chipsBox) return;

  if (settings.showTodaysCallsBanner === false) {
    lastCallsRenderSig = 'hidden';
    banner.style.display = 'none';
    return;
  }

  const callsToday = getTodaysCompletedCallsList();
  if (!callsToday.length) {
    lastCallsRenderSig = 'empty';
    banner.style.display = 'none';
    return;
  }

  const grouped = getCondensedTodaysCallsSummary(callsToday);
  const sig = `${callsToday.length}|` + grouped.map(g => `${g.key}_${g.count}_${g.lastStartedAt}_${g.totalMin}`).join('|');
  if (sig === lastCallsRenderSig && banner.style.display === 'flex') return;
  lastCallsRenderSig = sig;

  if (labelEl) {
    labelEl.textContent = callsToday.length > 1 ? `💚 Today (${callsToday.length}):` : '💚 Today:';
  }

  chipsBox.innerHTML = '';
  grouped.forEach(g => {
    const timeStr = g.lastStartedAt
      ? new Date(g.lastStartedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false })
      : '';
    const pill = document.createElement('span');
    pill.className = 'todays-call-pill';
    pill.textContent = g.count > 1
      ? `✓ ${g.name} ×${g.count} • ${timeStr} (${g.totalMin}m)`
      : `✓ ${g.name} ${timeStr} (${g.totalMin}m)`;
    chipsBox.appendChild(pill);
  });
  banner.style.display = 'flex';
}
hooks.renderTodaysCallsBanner = renderTodaysCallsBanner;

onValue(query(refs.callHistory, limitToLast(60)), snap => {
  state.callHistorySnap = snap.val() || {};
  renderTodaysCallsBanner();
  if (role === 'nana') hooks.renderContacts?.(state.connectedMemberIds);
  else updateFamilyPresenceBanner();
});
hooks.onFamilyMembersChanged.push(() => {
  lastCallsRenderSig = null;
  renderTodaysCallsBanner();
  if (role === 'family') updateFamilyPresenceBanner();
});
setInterval(renderTodaysCallsBanner, 60000);

// --- 5. UNIFIED FAMILY PRESENCE CARD RENDERER ---
function formatDurationAgo(timestampMs) {
  const ts = Number(timestampMs);
  if (!Number.isFinite(ts) || ts <= 0) return "No recent touch";
  const diffMins = Math.max(0, Math.floor((Date.now() - ts) / 60000));
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
  const lastAliveMs = Math.max(Number(p.lastPing || 0), Number(p.lastConnectedAt || 0));
  const lastSeenMs = Math.max(lastAliveMs, Number(p.disconnectedAt || 0), Number(p.appStateChangedAt || 0));
  const silenceSec = lastSeenMs ? Math.floor((now - (lastAliveMs || lastSeenMs)) / 1000) : 0;
  const isOffline = (p.online === false) || (lastAliveMs > 0 && silenceSec > 75);
  const batt = p.batteryLevel != null ? Number(p.batteryLevel) : null;
  const charging = !!p.isCharging;

  const st = state.callSnap?.status || 'idle';
  if (st !== 'idle') {
    const otherId = state.callSnap.callerId === 'nana' ? state.callSnap.targetId : state.callSnap.callerId;
    const withName = esc(FAMILY_NAMES[otherId] || state.callSnap.callerName || 'Family');
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
  if (scr === 'patience') return { border: '#22c55e', text: `🕷️ Playing Patience` };

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
  const lpMode = settings.lowPowerModeSetting || 'auto';
  const isLpForFamily = lpMode === 'on' || (lpMode === 'auto' && (p.lowPowerMode || p.isCharging === false));
  const lpLabel = isLpForFamily ? ' • 🔋 Low Power Mode' : '';
  const battNum = (p.batteryLevel != null && Number.isFinite(Number(p.batteryLevel))) ? Math.round(Number(p.batteryLevel)) : null;
  const battText = battNum !== null
    ? ` • ${p.isCharging ? "🔌 Charging" : "⚠️ UNPLUGGED"} (${battNum}%)${lpLabel}`
    : "";

  const callsToday = getTodaysCompletedCallsList();
  let todayLineHtml = '';
  if (callsToday.length) {
    const grouped = getCondensedTodaysCallsSummary(callsToday);
    const summaryItems = grouped.map(g => {
      const name = esc(g.name);
      const t = g.lastStartedAt ? new Date(g.lastStartedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false }) : '';
      return g.count > 1
        ? `${name} ×${g.count} (${t}, ${g.totalMin}m)`
        : `${name} (${t}, ${g.totalMin}m)`;
    }).join(' • ');
    const countTag = callsToday.length > 1 ? ` (${callsToday.length})` : '';
    todayLineHtml = `<br><span class="fam-today-calls-line" style="color:#86efac;font-size:0.84rem;font-weight:800;">💚 Today${countTag}: ${summaryItems}</span>`;
  }

  const tgConnected = state.connectedMemberIds.includes(activeFamilyMember.id);
  const tgStatus = tgConnected
    ? `<span class="fam-tg-status-line" style="color:#4ade80;font-size:0.88rem;">✅ Telegram connected — Nana can call you</span>`
    : `<span class="fam-tg-status-line" style="color:#93c5fd;font-size:0.86rem;">📞 You can call Nana anytime • Connect Telegram below to also receive calls</span>`;

  card.innerHTML = `<div style="font-size:1.05rem;font-weight:900;color:#fef08a;margin-bottom:2px;">${summary.text}</div><span class="fam-touch-batt-line" style="color:#cbd5e1;font-size:0.9rem;">${touchText}${battText}</span>${todayLineHtml}<br>${tgStatus}`;

  const st = state.callSnap?.status || 'idle';
  if (ringBtn) {
    const otherId = st !== 'idle'
      ? (state.callSnap.callerId === 'nana' ? state.callSnap.targetId : state.callSnap.callerId)
      : null;
    const busyOtherCall = st !== 'idle' && (!otherId || otherId !== activeFamilyMember?.id);
    ringBtn.disabled = !settings.callingEnabled || busyOtherCall;
  }
  hooks.updateFamilyVideoStatus?.();
}
hooks.refreshFamilyPresence = updateFamilyPresenceBanner;

function getUsageDateKey() {
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: settings.tabletTimezone || 'Europe/London',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    }).format(new Date());
  } catch (_) {
    return new Date().toISOString().slice(0, 10);
  }
}

function formatMediaDurationNearest5m(totalSec) {
  const s = Math.max(0, Number(totalSec) || 0);
  const mins = Math.round(s / 300) * 5;
  if (mins <= 0) return '0m';
  const hrs = Math.floor(mins / 60);
  const remM = mins % 60;
  return hrs > 0 ? `${hrs}h ${remM}m` : `${mins}m`;
}

function renderRyanControlsInsights() {
  if (role !== 'family' || !isAdminFamilyMember) return;
  const mount = $('family-settings-mount');
  if (!mount) return;

  let acc = $('ryan-insights-accordion');
  let card = $('ryan-media-insights-card');
  if (!acc) {
    acc = document.createElement('details');
    acc.id = 'ryan-insights-accordion';
    acc.className = 'controls-accordion';
    acc.innerHTML = `
      <summary><span>📊 Usage Stats &amp; Video Alerts</span><span id="ryan-insights-acc-meta" class="controls-acc-meta"></span></summary>
      <div class="controls-acc-body"><div id="ryan-media-insights-card" class="settings-card"></div></div>
    `;
    const shared = $('shared-settings-cards');
    const toolbar = shared?.querySelector?.('.controls-toolbar');
    if (toolbar && toolbar.parentNode) {
      toolbar.after(acc);
    } else if (shared) {
      shared.prepend(acc);
    } else {
      mount.prepend(acc);
    }
    card = $('ryan-media-insights-card');
  }
  if (!card) return;

  const usage = state.dailyUsageSnap || {};
  const todayKey = getUsageDateKey();
  const todayRec = usage[todayKey] || { videoSec: 0, radioSec: 0, patienceSec: 0, patienceGames: 0 };
  const fmtPatienceMin = (sec) => {
    const s = Math.max(0, Number(sec) || 0);
    if (s < 30) return '0m';
    const mins = Math.max(1, Math.round(s / 60));
    const hrs = Math.floor(mins / 60);
    const remM = mins % 60;
    return hrs > 0 ? `${hrs}h ${remM}m` : `${mins}m`;
  };
  const fmtGames = (n) => {
    const c = Math.max(0, Number(n) || 0);
    return c === 1 ? '1 game' : `${c} games`;
  };
  const dayKeys = Object.keys(usage).filter(k => /^\d{4}-\d{2}-\d{2}$/.test(k)).sort().reverse().slice(0, 14);
  const historyRows = dayKeys.length
    ? dayKeys.map(k => {
        const d = usage[k] || {};
        return `<div style="display:flex;justify-content:space-between;gap:10px;padding:3px 0;border-bottom:1px solid rgba(148,163,184,0.15);"><span>${esc(k)}</span><span>🎬 ${formatMediaDurationNearest5m(d.videoSec)} &nbsp;|&nbsp; 🎻 ${formatMediaDurationNearest5m(d.radioSec)} &nbsp;|&nbsp; 🕷️ ${fmtPatienceMin(d.patienceSec)} (${fmtGames(d.patienceGames)})</span></div>`;
      }).join('')
    : `<div style="color:#94a3b8;">No daily stats recorded yet.</div>`;

  const issuesObj = state.videoIssuesSnap || {};
  const issueList = Object.entries(issuesObj)
    .map(([id, v]) => ({ id, ...(v || {}) }))
    .sort((a, b) => (Number(b.timestamp) || 0) - (Number(a.timestamp) || 0))
    .slice(0, 15);
  const issuesHtml = issueList.length
    ? issueList.map(it => {
        const when = it.timestamp ? new Date(it.timestamp).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';
        return `<div style="padding:4px 0;border-bottom:1px solid rgba(148,163,184,0.15);font-size:0.8rem;">
          <div style="color:#fca5a5;font-weight:700;">⚠️ ${esc(it.title || 'Unknown video')}</div>
          <div style="color:#94a3b8;">${esc(it.reason || 'failed')} ${when ? `• ${esc(when)}` : ''}</div>
          ${it.url ? `<div style="color:#64748b;word-break:break-all;font-size:0.75rem;">${esc(it.url)}</div>` : ''}
        </div>`;
      }).join('')
    : `<div style="color:#4ade80;font-size:0.82rem;">✅ No broken video alerts</div>`;

  const metaEl = $('ryan-insights-acc-meta');
  if (metaEl) {
    const warnPart = issueList.length ? ` • ⚠️ ${issueList.length}` : '';
    metaEl.innerText = `🎬 ${formatMediaDurationNearest5m(todayRec.videoSec)} • 🎻 ${formatMediaDurationNearest5m(todayRec.radioSec)} • 🕷️ ${fmtPatienceMin(todayRec.patienceSec)} (${Number(todayRec.patienceGames) || 0})${warnPart}`;
    metaEl.style.color = issueList.length ? '#fca5a5' : '#38bdf8';
  }

  card.innerHTML = `
    <div style="font-weight:900;color:#fef08a;margin-bottom:6px;">📊 Nana's Daily Video, Radio &amp; Patience Use</div>
    <div style="font-size:0.9rem;color:#bae6fd;font-weight:800;margin-bottom:6px;">
      Today: 🎬 ${formatMediaDurationNearest5m(todayRec.videoSec)} &nbsp;•&nbsp; 🎻 ${formatMediaDurationNearest5m(todayRec.radioSec)} &nbsp;•&nbsp; 🕷️ ${fmtPatienceMin(todayRec.patienceSec)} (${fmtGames(todayRec.patienceGames)})
    </div>
    <details style="margin-bottom:10px;font-size:0.82rem;color:#cbd5e1;">
      <summary style="cursor:pointer;color:#93c5fd;font-weight:700;">📅 Daily History (${dayKeys.length}d)</summary>
      <div style="margin-top:4px;background:rgba(15,23,42,0.75);border:1px solid #334155;border-radius:8px;padding:6px 8px;max-height:150px;overflow-y:auto;">${historyRows}</div>
    </details>
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;">
      <span style="font-weight:900;color:#fca5a5;font-size:0.9rem;">⚠️ Broken Video Alerts (${issueList.length})</span>
      ${issueList.length ? `<button type="button" id="btn-clear-video-issues" class="tone-btn" style="padding:3px 10px;font-size:0.75rem;background:#334155;">Clear</button>` : ''}
    </div>
    <div style="background:rgba(15,23,42,0.75);border:1px solid #334155;border-radius:8px;padding:6px 8px;max-height:150px;overflow-y:auto;">${issuesHtml}</div>
  `;

  const clearBtn = $('btn-clear-video-issues');
  if (clearBtn) {
    clearBtn.onclick = () => remove(refs.videoIssues).catch(() => {});
  }
}

if (role === 'nana') {
  onValue(refs.dailyUsage, snap => {
    state.dailyUsageSnap = snap.val() || {};
  });

  let pendingVideoSec = 0;
  let pendingRadioSec = 0;
  let pendingPatienceSec = 0;
  let pendingPatienceGames = 0;
  let lastUsageTickMs = Date.now();
  let lastTrackedVideoTime = -1;
  let lastFlushMs = Date.now();
  let lpUsageTick = 0;

  const flushDailyUsage = () => {
    const addV = Math.floor(pendingVideoSec);
    const addR = Math.floor(pendingRadioSec);
    const addP = Math.floor(pendingPatienceSec);
    const addG = Math.floor(pendingPatienceGames);
    if (addV <= 0 && addR <= 0 && addP <= 0 && addG <= 0) return;
    pendingVideoSec -= addV;
    pendingRadioSec -= addR;
    pendingPatienceSec -= addP;
    pendingPatienceGames -= addG;
    const dayKey = getUsageDateKey();
    runTransaction(refs.dailyUsage, current => {
      const next = (current && typeof current === 'object') ? { ...current } : {};
      const curDay = (next[dayKey] && typeof next[dayKey] === 'object') ? next[dayKey] : {};
      next[dayKey] = {
        videoSec: (Number(curDay.videoSec) || 0) + addV,
        radioSec: (Number(curDay.radioSec) || 0) + addR,
        patienceSec: (Number(curDay.patienceSec) || 0) + addP,
        patienceGames: (Number(curDay.patienceGames) || 0) + addG,
        updatedAt: Date.now()
      };
      // Keep most recent 30 days
      const keys = Object.keys(next).filter(k => /^\d{4}-\d{2}-\d{2}$/.test(k)).sort();
      while (keys.length > 30) {
        delete next[keys.shift()];
      }
      return next;
    }).catch(() => {
      pendingVideoSec += addV;
      pendingRadioSec += addR;
      pendingPatienceSec += addP;
      pendingPatienceGames += addG;
    });
  };

  hooks.onPatienceGameStarted = () => {
    pendingPatienceGames += 1;
    flushDailyUsage();
  };

  setInterval(() => {
    const lowPower = NanaCore.isLowPowerMode();
    if (lowPower) {
      lpUsageTick++;
      if (lpUsageTick % 5 !== 0) return;
    } else {
      lpUsageTick = 0;
    }

    const now = Date.now();
    const dtSec = Math.min(lowPower ? 12 : 5, Math.max(0, (now - lastUsageTickMs) / 1000));
    lastUsageTickMs = now;
    const inCall = !!(state.currentState && state.currentState !== 'idle');

    const videoEl = $('nana-video-el');
    const videoPlaying = !!(
      !NanaCore.isVideoBlockedByLowPower() &&
      !inCall &&
      $('video-screen')?.classList.contains('active') &&
      videoEl && !videoEl.paused && !videoEl.ended && videoEl.readyState >= 2
    );
    if (videoPlaying) {
      const vt = Number(videoEl.currentTime) || 0;
      if (lastTrackedVideoTime >= 0 && vt > lastTrackedVideoTime + 0.1) {
        pendingVideoSec += dtSec;
      }
      lastTrackedVideoTime = vt;
    } else {
      lastTrackedVideoTime = -1;
    }

    const radioEl = $('nana-radio-stream');
    const radioPlaying = !!(
      !inCall &&
      radioEl && !radioEl.paused && !radioEl.ended && radioEl.readyState >= 2
    );
    if (radioPlaying) {
      pendingRadioSec += dtSec;
    }

    const patienceActive = !!(
      !inCall &&
      document.visibilityState === 'visible' &&
      !document.body.classList.contains('screen-dimmed') &&
      !state.isPhotoScreensaverActive &&
      $('patience-screen')?.classList.contains('active') &&
      $('bulletin-modal')?.style.display !== 'flex' &&
      (now - (Number(state.lastPatienceActivityMs) || 0) < 120000)
    );
    if (patienceActive) {
      pendingPatienceSec += dtSec;
    }

    const flushGapMs = lowPower ? 120000 : 30000;
    if (now - lastFlushMs >= flushGapMs) {
      lastFlushMs = now;
      flushDailyUsage();
    }
  }, 2000);

  window.addEventListener('pagehide', flushDailyUsage);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flushDailyUsage();
  });
}

if (role === 'family') {
  onValue(refs.presence, snap => {
    state.presenceSnap = snap.val() || {};
    updateFamilyPresenceBanner();
    evaluateFamilyBatteryChatAlerts();
  });
  if (isAdminFamilyMember) {
    hooks.onSettingsChanged.push(renderRyanControlsInsights);
    onValue(refs.dailyUsage, snap => {
      state.dailyUsageSnap = snap.val() || {};
      renderRyanControlsInsights();
    });
    onValue(refs.videoIssues, snap => {
      state.videoIssuesSnap = snap.val() || {};
      renderRyanControlsInsights();
    });
  }
  setInterval(() => {
    updateFamilyPresenceBanner();
    evaluateFamilyBatteryChatAlerts();
  }, 15000);
}
