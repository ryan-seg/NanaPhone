import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getDatabase, ref, set, update, push, onValue, remove, runTransaction, query, limitToLast } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js";

// =====================================================================
// NanaPhone app.js -- VERSION 2.9.0
// =====================================================================
const APP_VERSION = "2.9.0";

(function versionGuard() {
  const pageV = window.__NANA_PAGE_VERSION;
  try {
    if (pageV && pageV !== APP_VERSION) {
      if (!sessionStorage.getItem('nana_vguard')) {
        sessionStorage.setItem('nana_vguard', '1');
        const u = new URL(window.location.href);
        u.searchParams.set('r', String(Date.now()));
        window.location.replace(u.toString());
        throw new Error('Version mismatch');
      }
    } else {
      sessionStorage.removeItem('nana_vguard');
    }
  } catch (e) { if (String(e.message).startsWith('Version mismatch')) throw e; }
})();
window.__nanaAppLoaded = true;

const params = new URLSearchParams(window.location.search);
if (params.get('key')) localStorage.setItem('nana_service_token', params.get('key').trim());
const SERVICE_TOKEN = (localStorage.getItem('nana_service_token') || 'Westerham8').trim();
const TEST_MODE = params.get('test') === '1';
const role = params.get('role') || 'nana';
const callerId = (params.get('id') || 'ryan').toLowerCase();
const autoAnswerFromTelegram = params.get('answer') === 'true';
const isRealAndroidTablet = !!(window.AndroidBridge || /Lenovo|TB-|Tab/i.test(navigator.userAgent));

document.body.classList.add(role === 'nana' ? 'role-nana' : 'role-family');

function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(id)?.classList.add('active');
}

if (SERVICE_TOKEN !== 'Westerham8') {
  showScreen('auth-error-screen');
  if (isRealAndroidTablet) {
    setTimeout(() => {
      try { localStorage.removeItem('nana_service_token'); } catch (e) {}
      const u = new URL(window.location.href);
      u.searchParams.delete('key');
      window.location.replace(u.toString());
    }, 10000);
  }
  throw new Error("Invalid verification key.");
}

const CONFIG = {
  appVersion: APP_VERSION,
  adminPin: "1929",
  apkFileName: "nanaphone.apk",
  dailyRoomUrl: "https://nanaphone.daily.co/" + (params.get('room') || 'NanaPhone'),
  telegramBotUsername: "Nanaphone_Bot",
  googleScriptUrl: "https://script.google.com/macros/s/AKfycbwsFHE8oyj1RBGxLJT79bbPsvJ2hTkVrF9dCoj369ApEREXyrdQKE_vA0QrobBOeLE2/exec",
  firebase: { databaseURL: "https://nanaphone-f644b-default-rtdb.europe-west1.firebasedatabase.app" },
  familyMembers: [
    { id: "phil",     name: "Phil",     spokenName: "Phil",   photo: "photos/phil.jpg",     fallback: "https://ui-avatars.com/api/?name=Phil&size=256&background=1d4ed8&color=fff&bold=true" },
    { id: "nicky-s",  name: "Nicky S",  spokenName: "Nicky",  photo: "photos/nicky-s.jpg",  fallback: "https://ui-avatars.com/api/?name=NS&size=256&background=be185d&color=fff&bold=true" },
    { id: "denise",   name: "Denise",   spokenName: "Denise", photo: "photos/denise.jpg",   fallback: "https://ui-avatars.com/api/?name=Denise&size=256&background=047857&color=fff&bold=true" },
    { id: "gill",     name: "Gill",     spokenName: "Gill",   photo: "photos/gill.jpg",     fallback: "https://ui-avatars.com/api/?name=Gill&size=256&background=b45309&color=fff&bold=true" },
    { id: "ryan",     name: "Ryan",     spokenName: "Ryan",   photo: "photos/ryan.jpg",     fallback: "https://ui-avatars.com/api/?name=Ryan&size=256&background=4338ca&color=fff&bold=true" },
    { id: "nicola-p", name: "Nicola P", spokenName: "Nicola", photo: "photos/nicola-p.jpg", fallback: "https://ui-avatars.com/api/?name=NP&size=256&background=0e7490&color=fff&bold=true" },
    { id: "zara",     name: "Zara",     spokenName: "Zara",   photo: "photos/zara.jpg",     fallback: "https://ui-avatars.com/api/?name=Zara&size=256&background=6d28d9&color=fff&bold=true" },
    { id: "megan",    name: "Megan",    spokenName: "Megan",  photo: "photos/megan.jpg",    fallback: "https://ui-avatars.com/api/?name=Megan&size=256&background=be123c&color=fff&bold=true" }
  ]
};

const CLASSIC_FM_STREAM = "https://media-ice.musicradio.com/ClassicFMMP3";
const SILENT_WAV = "data:audio/wav;base64,UklGRigAAABXQVZFZm10IBIAAAABAAEARKwAAIhYAQACABAAAABkYXRhAgAAAAEA";
const activeFamilyMember = CONFIG.familyMembers.find(m => m.id === callerId) || CONFIG.familyMembers[4];
const isAdminFamilyMember = (role === 'family' && activeFamilyMember.id === 'ryan');

if (TEST_MODE) {
  const realFetch = window.fetch.bind(window);
  window.fetch = (url, opts) => {
    if (String(url).startsWith(CONFIG.googleScriptUrl)) {
      const all = CONFIG.familyMembers.map(m => m.id);
      return Promise.resolve(new Response(
        JSON.stringify({ ok: true, messageId: null, connected: all, groupChatId: null, broadcastCount: 0, test: true }),
        { headers: { 'Content-Type': 'application/json' } }
      ));
    }
    return realFetch(url, opts);
  };
  const ribbon = document.createElement('div');
  ribbon.innerText = '🧪 TEST MODE - separate from Nana\'s real tablet';
  ribbon.style.cssText = 'position:fixed;top:0;left:0;z-index:99999;background:#7c3aed;color:#fff;font:700 12px sans-serif;padding:3px 10px;border-bottom-right-radius:10px;pointer-events:none;';
  document.body.appendChild(ribbon);
}

(function showVersions() {
  const stylesV = (getComputedStyle(document.documentElement).getPropertyValue('--nana-styles-version') || '').replace(/["'\s]/g, '') || '?';
  const pageV = window.__NANA_PAGE_VERSION || '?';
  const allMatch = (pageV === APP_VERSION && stylesV === APP_VERSION);
  const txt = `Page ${pageV} | App ${APP_VERSION} | Styles ${stylesV}${allMatch ? '' : ' ⚠️ MISMATCH'}`;
  document.querySelectorAll('.file-versions-line').forEach(e => { e.innerText = txt; e.style.color = allMatch ? '#94a3b8' : '#fbbf24'; });
  document.querySelectorAll('.gear-pill').forEach(e => { e.innerText = `⚙️ v${APP_VERSION}${allMatch ? '' : ' ⚠️'}`; });
})();

(function adaptRemoteFit() {
  const rv = document.getElementById('remote-video');
  if (!rv) return;
  const apply = () => {
    if (!rv.videoWidth || !rv.videoHeight) return;
    const videoAspect = rv.videoWidth / rv.videoHeight;
    const screenAspect = (rv.clientWidth || window.innerWidth) / (rv.clientHeight || window.innerHeight);
    rv.style.objectFit = (Math.abs(videoAspect / screenAspect - 1) < 0.2) ? 'cover' : 'contain';
  };
  ['loadedmetadata', 'resize'].forEach(ev => rv.addEventListener(ev, apply));
  window.addEventListener('resize', apply);
})();

(function callScreenTapToHear() {
  const cs = document.getElementById('call-screen');
  if (!cs) return;
  cs.addEventListener('pointerdown', () => {
    if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
    const ra = document.getElementById('remote-audio');
    if (ra && ra.srcObject) { ra.muted = false; ra.play().catch(() => {}); }
    const rv = document.getElementById('remote-video');
    if (rv && rv.srcObject && rv.paused) rv.play().catch(() => {});
  }, { passive: true });
})();

// Firebase Setup
const app = initializeApp(CONFIG.firebase);
const db = getDatabase(app);
const basePath = TEST_MODE ? `portals/${SERVICE_TOKEN}__test` : `portals/${SERVICE_TOKEN}`;
const callStateRef = ref(db, `${basePath}/callState`);
const presenceRef = ref(db, `${basePath}/presence`);
const bulletinRef = ref(db, `${basePath}/bulletin`);
const settingsRef = ref(db, `${basePath}/settings`);
const missedCallsMapRef = ref(db, `${basePath}/missedCalls`);
const connectedMembersRef = ref(db, `${basePath}/connectedMembers`);
const hiddenRef = ref(db, `${basePath}/hiddenContacts`);
const entertainmentRef = ref(db, `${basePath}/entertainment`);
const reloadCmdRef = ref(db, `${basePath}/commands/reloadAt`);

if (TEST_MODE) {
  set(connectedMembersRef, CONFIG.familyMembers.map(m => m.id)).catch(() => {});
}

// State
let callObject = null;
let isJoiningOrInRoom = false;
let didManuallyInitiateOrAnswerOnThisTab = false;
let currentFacingMode = 'user';
let isRadioPlaying = false;
let latestEntState = { activeKey: "off", title: "Off" };
let pendingCallContact = null;
let missedCallsByMember = {};
let latestBulletinPosts = {};
let unreadBulletinCount = 0;
let chatSessionReadCutoff = null;
let confirmTimer = null;
let ringInterval = null;
let telegramBurstInterval = null;
let lastTelegramMsgId = null;
let currentDialedMember = null;
let outboundTimeout = null;
let incomingRingTimeout = null;
let autoAnswerTimeout = null;
let idleDimTimer = null;
let keyboardHideTimer = null;
let lastKeyTapMs = 0;
let lastKeyChar = null;
let lastChatSendMs = 0;
let lastHeartbeatWriteMs = 0;
let lastRenderedKbLayout = null;
let lastRenderedReadAloud = null;
let settingsLoaded = false;
let latestHidden = {};
let currentState = 'idle';
let latestCallData = { status: 'idle' };
let latestPresenceData = {};
let connectedMemberIds = [];
let enteredPin = "";
let nightDismissedUntilMs = 0;
let lastBatterySpokenMs = 0;

const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
let activeMp3Ringtone = null;
const radioPlayer = document.getElementById('nana-radio-stream');

let tabletSettings = {
  callVolume: 85,
  radioVolume: 75,
  ringVolume: 85,
  ringDurationSec: 60,
  ringtone: 'uk-phone',
  voicePrompts: true,
  autoAnswer: false,
  speechRate: 0.9,
  awakeBrightness: 85,
  dimBrightness: 15,
  dimDelaySec: 120,
  nightModeEnabled: true,
  nightStartHour: 21,
  nightEndHour: 8,
  nightBlockCalls: false,
  batteryVoiceMutedUntil: 0,
  showBulletinBar: true,
  showReadAloud: false,
  colorTheme: 'classic-dark',
  keyboardLayout: 'qwerty',
  keyboardTimeoutSec: 60,
  keyGuardMs: 350,
  bulletinClearedAt: 0,
  callingEnabled: TEST_MODE
};

// ========================================================================
// BRIGHTNESS, DIMMING (INCLUDING RADIO & CHAT) & NIGHT MODE
// ========================================================================
function applyColorTheme(themeKey) {
  const safeKey = themeKey || 'classic-dark';
  document.body.classList.remove('theme-yellow-black', 'theme-white-black', 'theme-black-cream');
  if (safeKey !== 'classic-dark') document.body.classList.add(`theme-${safeKey}`);
}

function getActiveSpeakerVolumePercent() {
  if (currentState === 'connected') return Number(tabletSettings.callVolume ?? 85);
  if (isRadioPlaying) return Number(tabletSettings.radioVolume ?? 75);
  return Number(tabletSettings.ringVolume ?? 85);
}

function applyScreenBrightness(targetPercent) {
  if (role !== 'nana') return;
  const pct = Math.max(5, Math.min(100, Number(targetPercent) || 85));
  const overlay = document.getElementById('brightness-overlay');
  if (overlay) {
    const darkness = Math.max(0, Math.min(0.88, (100 - pct) / 105));
    overlay.style.opacity = darkness.toFixed(2);
    overlay.style.pointerEvents = pct < (tabletSettings.awakeBrightness ?? 85) ? 'auto' : 'none';
  }
  if (window.AndroidBridge?.updateTabletHardwareSettings) {
    window.AndroidBridge.updateTabletHardwareSettings(
      getActiveSpeakerVolumePercent(),
      pct,
      Number(tabletSettings.dimDelaySec ?? 120),
      Number(tabletSettings.speechRate) || 0.9
    );
  }
}

window.wakeScreenAndResetDimTimer = function wakeScreenAndResetDimTimer() {
  if (role !== 'nana') return;
  applyScreenBrightness(tabletSettings.awakeBrightness ?? 85);
  if (idleDimTimer) { clearTimeout(idleDimTimer); idleDimTimer = null; }

  const delaySec = Number(tabletSettings.dimDelaySec ?? 120);
  // Screen dims when idle on Home, Chat, OR Radio (only stays bright during active video calls)
  if (delaySec > 0 && currentState === 'idle') {
    idleDimTimer = setTimeout(() => {
      if (currentState === 'idle') {
        window.closeSeniorKeyboard();
        applyScreenBrightness(tabletSettings.dimBrightness ?? 15);
      }
    }, delaySec * 1000);
  }
};

function isCurrentlyInNightWindow() {
  if (!tabletSettings.nightModeEnabled) return false;
  const hour = new Date().getHours();
  const startH = Number(tabletSettings.nightStartHour ?? 21);
  const endH = Number(tabletSettings.nightEndHour ?? 8);
  return startH > endH ? (hour >= startH || hour < endH) : (hour >= startH && hour < endH);
}

function updateClock() {
  const timeStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const clockEl = document.getElementById('clock');
  const nightClockEl = document.getElementById('night-clock');
  if (clockEl) clockEl.innerText = timeStr;
  if (nightClockEl) nightClockEl.innerText = timeStr;

  const canShowDimmer = isCurrentlyInNightWindow() && currentState === 'idle' && Date.now() > nightDismissedUntilMs;
  const dimmerEl = document.getElementById('night-dimmer');
  if (dimmerEl) dimmerEl.style.display = canShowDimmer ? 'flex' : 'none';
}

window.wakeFromNightMode = () => {
  nightDismissedUntilMs = Date.now() + 15 * 60 * 1000;
  document.getElementById('night-dimmer').style.display = 'none';
  wakeScreenAndResetDimTimer();
};

// ========================================================================
// BATTERY VOICE & MISSED CALLS
// ========================================================================
function isBatteryVoiceCurrentlyMuted() {
  return (Number(tabletSettings.batteryVoiceMutedUntil) || 0) > Date.now();
}

window.muteBatteryVoiceForHours = async (hours) => {
  const mutedUntil = hours > 0 ? (Date.now() + hours * 3600 * 1000) : 0;
  tabletSettings.batteryVoiceMutedUntil = mutedUntil;
  if ('speechSynthesis' in window) window.speechSynthesis.cancel();
  window.AndroidBridge?.muteBatteryVoiceForMinutes?.(hours * 60);
  refreshSettingsUI();
  await update(settingsRef, { batteryVoiceMutedUntil: mutedUntil });
};

window.announceBatteryWarning = (warningText) => {
  if (isBatteryVoiceCurrentlyMuted() || (Date.now() - lastBatterySpokenMs < 180000)) return;
  lastBatterySpokenMs = Date.now();
  speakMsg(warningText, true);
};

async function incrementMissedCallForMember(memberId) {
  await runTransaction(ref(db, `${basePath}/missedCalls/${memberId}`), (cur) => ({
    count: (cur?.count ? Number(cur.count) : 0) + 1,
    timestamp: Date.now()
  }));
}

async function clearMissedCallsForMember(memberId) {
  if (memberId) await remove(ref(db, `${basePath}/missedCalls/${memberId}`));
}

window.clearAllMissedCalls = async () => {
  await remove(missedCallsMapRef);
  missedCallsByMember = {};
  renderMissedCallsBanner();
  if (role === 'nana') renderContacts(connectedMemberIds);
};

onValue(missedCallsMapRef, (snap) => {
  missedCallsByMember = snap.val() || {};
  renderMissedCallsBanner();
  if (role === 'nana') renderContacts(connectedMemberIds);
});

function renderMissedCallsBanner() {
  const banner = document.getElementById('missed-call-banner');
  const chipsContainer = document.getElementById('missed-chips-container');
  if (!banner || !chipsContainer) return;
  chipsContainer.innerHTML = "";
  const entries = Object.entries(missedCallsByMember)
    .filter(([, info]) => info && info.count > 0)
    .sort((a, b) => (b[1].timestamp || 0) - (a[1].timestamp || 0));

  if (entries.length === 0) { banner.style.display = 'none'; return; }
  entries.forEach(([memberId, info]) => {
    const member = CONFIG.familyMembers.find(m => m.id === memberId);
    if (!member) return;
    const timeStr = info.timestamp ? new Date(info.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
    const btn = document.createElement('button');
    btn.className = 'missed-chip-btn';
    btn.innerText = `📞 Call ${member.name} (${info.count}${timeStr ? ' • ' + timeStr : ''})`;
    btn.onclick = () => startCallFromNana(member);
    chipsContainer.appendChild(btn);
  });
  banner.style.display = 'flex';
}

// ========================================================================
// FAMILY CHAT, UNREAD SCROLL & FULL-SCREEN KEYBOARD WITH FLASHING CURSOR
// ========================================================================
function syncChatInputDisplay() {
  const input = document.getElementById('nana-chat-input');
  const typedEl = document.getElementById('nana-chat-typed');
  const placeholderEl = document.getElementById('nana-chat-placeholder');
  const displayBox = document.getElementById('nana-chat-display');
  if (!input || !typedEl || !placeholderEl) return;

  const val = input.value || "";
  const kbOpen = document.getElementById('bulletin-modal')?.classList.contains('kb-fullscreen');
  placeholderEl.style.display = (val.length === 0 && !kbOpen) ? 'inline' : 'none';
  // Convert regular spaces to non-breaking spaces so trailing spaces visibly push the flashing cursor forward
  typedEl.textContent = val.replace(/ /g, '\u00A0');
  if (displayBox) displayBox.scrollLeft = displayBox.scrollWidth;
}

window.dismissCurrentBulletinBar = async (forceFromAdmin = false) => {
  if (role !== 'nana' && !forceFromAdmin) return;
  const now = Date.now();
  tabletSettings.bulletinClearedAt = now;
  chatSessionReadCutoff = now;
  updateBulletinTickerVisibility();
  // Remove visual unread styling smoothly once she reaches the bottom
  document.getElementById('first-unread-divider')?.remove();
  document.querySelectorAll('.tg-bubble.unread-msg').forEach(b => b.classList.remove('unread-msg'));
  document.querySelectorAll('.tg-new-tag').forEach(t => t.remove());
  await update(settingsRef, { bulletinClearedAt: now });
};

function updateBulletinTickerVisibility() {
  const bar = document.getElementById('message-ticker-bar');
  const badge = document.getElementById('chat-unread-badge');
  const isEnabled = tabletSettings.showBulletinBar !== false;
  const clearedAt = Number(tabletSettings.bulletinClearedAt) || 0;

  unreadBulletinCount = 0;
  Object.values(latestBulletinPosts).forEach(p => {
    if (!p.fromNana && (Number(p.timestamp) || 0) > clearedAt) unreadBulletinCount++;
  });

  const hasUnread = unreadBulletinCount > 0;
  if (bar) bar.style.display = (isEnabled && hasUnread) ? 'flex' : 'none';
  if (badge) {
    badge.innerText = unreadBulletinCount > 9 ? '9+' : `${unreadBulletinCount} NEW`;
    badge.style.display = hasUnread ? 'inline-block' : 'none';
  }
}

function renderSeniorKeyboardLayout() {
  const container = document.getElementById('senior-kb-letters-container');
  if (!container) return;
  const layout = tabletSettings.keyboardLayout || 'qwerty';
  lastRenderedKbLayout = layout;

  const rows = layout === 'abcdef'
    ? [['A','B','C','D','E','F','G','H','I','J'], ['K','L','M','N','O','P','Q','R','S','T'], ['U','V','W','X','Y','Z']]
    : [['Q','W','E','R','T','Y','U','I','O','P'], ['A','S','D','F','G','H','J','K','L'], ['Z','X','C','V','B','N','M']];

  container.innerHTML = '';

  const buildRow = (letters, cols, extraStyle = '') => {
    const r = document.createElement('div');
    r.className = 'kb-row-grid';
    r.style.cssText = `display:grid; grid-template-columns:repeat(${cols}, 1fr); gap:10px; ${extraStyle}`;
    letters.forEach(letter => {
      const b = document.createElement('button');
      b.className = 'kb-letter-btn';
      b.textContent = letter;
      b.onpointerdown = (ev) => window.typeSeniorKey(letter, ev);
      r.appendChild(b);
    });
    return r;
  };

  container.appendChild(buildRow(rows[0], 10));
  container.appendChild(buildRow(rows[1], layout === 'abcdef' ? 10 : 9, layout === 'abcdef' ? '' : 'padding:0 22px;'));

  const r3 = buildRow(rows[2], 9);
  const delBtn = document.createElement('button');
  delBtn.className = 'kb-letter-btn';
  const delSpan = layout === 'abcdef' ? 3 : 2;
  delBtn.style.cssText = `background:#7f1d1d; color:#ffffff; grid-column:span ${delSpan}; border-color:#f87171;`;
  delBtn.textContent = '⌫ Delete';
  delBtn.onpointerdown = (ev) => window.typeSeniorKey('BACKSPACE', ev);
  r3.appendChild(delBtn);
  container.appendChild(r3);
}

function resetKeyboardAutoHideTimer() {
  if (keyboardHideTimer) { clearTimeout(keyboardHideTimer); keyboardHideTimer = null; }
  const timeoutSec = Number(tabletSettings.keyboardTimeoutSec ?? 60);
  if (timeoutSec > 0) {
    keyboardHideTimer = setTimeout(() => {
      const input = document.getElementById('nana-chat-input');
      if (input) input.value = '';
      syncChatInputDisplay();
      window.closeSeniorKeyboard();
    }, timeoutSec * 1000);
  }
}

function scrollToFirstUnreadOrBottom() {
  const feed = document.getElementById('bulletin-posts-container');
  const divider = document.getElementById('first-unread-divider');
  if (!feed) return;
  if (divider) {
    divider.scrollIntoView({ behavior: 'auto', block: 'start' });
    setTimeout(() => window.handleChatScroll(feed), 150);
  } else {
    feed.scrollTop = feed.scrollHeight;
  }
}

window.openFamilyBulletin = () => {
  chatSessionReadCutoff = Number(tabletSettings.bulletinClearedAt) || 0;
  const modal = document.getElementById('bulletin-modal');
  modal.classList.remove('kb-fullscreen');
  modal.style.display = 'flex';
  window.closeSeniorKeyboard();
  renderBulletinFeed();
  syncChatInputDisplay();
  wakeScreenAndResetDimTimer();
  recordHeartbeat("Opened Family Chat");
  setTimeout(scrollToFirstUnreadOrBottom, 80);
};

window.closeFamilyBulletin = () => {
  document.getElementById('bulletin-modal').style.display = 'none';
  window.closeSeniorKeyboard();
  if ('speechSynthesis' in window) window.speechSynthesis.cancel();
  wakeScreenAndResetDimTimer();
  recordHeartbeat("On Home Grid");
  chatSessionReadCutoff = null;
};

window.openSeniorKeyboard = () => {
  renderSeniorKeyboardLayout();
  const modal = document.getElementById('bulletin-modal');
  const kb = document.getElementById('senior-onscreen-keyboard');
  if (modal) modal.classList.add('kb-fullscreen');
  if (kb) kb.style.display = 'flex';
  syncChatInputDisplay();
  resetKeyboardAutoHideTimer();
  wakeScreenAndResetDimTimer();
};

window.closeSeniorKeyboard = () => {
  if (keyboardHideTimer) { clearTimeout(keyboardHideTimer); keyboardHideTimer = null; }
  const modal = document.getElementById('bulletin-modal');
  const kb = document.getElementById('senior-onscreen-keyboard');
  if (kb) kb.style.display = 'none';
  if (modal) modal.classList.remove('kb-fullscreen');
  syncChatInputDisplay();
  setTimeout(scrollToFirstUnreadOrBottom, 50);
};

window.handleChatScroll = (el) => {
  if (role !== 'nana' || !el) return;
  const isAtBottom = (el.scrollHeight - el.scrollTop - el.clientHeight) <= 45;
  if (isAtBottom && unreadBulletinCount > 0) {
    window.dismissCurrentBulletinBar(true);
  }
};

window.typeSeniorKey = (char, ev) => {
  if (ev) {
    ev.preventDefault();
    ev.stopPropagation();
  }
  const now = Date.now();
  const guardMs = Number(tabletSettings.keyGuardMs ?? 350);
  const sameKey = (char === lastKeyChar);
  // Different keys react immediately (80ms); only identical repeated keys use the shaky-finger guard
  const minGap = char === 'BACKSPACE'
    ? (sameKey ? Math.min(guardMs, 250) : 60)
    : (sameKey && guardMs > 0 ? guardMs : 80);
  if (now - lastKeyTapMs < minGap) return;

  const input = document.getElementById('nana-chat-input');
  if (!input) return;
  const cur = input.value;
  if (char === ' ' && (cur.length === 0 || cur.endsWith(' '))) return;
  if (guardMs > 0 && char.length === 1 && /[A-Za-z]/.test(char)) {
    const c = char.toLowerCase();
    if (cur.length >= 2 && cur.slice(-1).toLowerCase() === c && cur.slice(-2, -1).toLowerCase() === c) return;
  }

  lastKeyTapMs = now;
  lastKeyChar = char;

  if (ev?.currentTarget) {
    const btn = ev.currentTarget;
    btn.classList.add('kb-flash');
    setTimeout(() => btn.classList.remove('kb-flash'), 160);
  }

  resetKeyboardAutoHideTimer();
  wakeScreenAndResetDimTimer();

  if (char === 'BACKSPACE') {
    input.value = Array.from(cur).slice(0, -1).join('');
  } else if (['💋', '❤️', '☘️', '👍', '😘'].includes(char)) {
    input.value = cur + char;
  } else {
    input.value = cur + (cur.length === 0 ? char : char.toLowerCase());
  }
  syncChatInputDisplay();
};

window.kbHideTapped = () => {
  if (Date.now() - lastKeyTapMs < 350) return;
  window.closeSeniorKeyboard();
};

window.submitTypedNanaMessage = async () => {
  const input = document.getElementById('nana-chat-input');
  if (!input || (Date.now() - lastKeyTapMs < 350)) return;
  const text = input.value.trim();
  if (!text) return;
  input.value = "";
  syncChatInputDisplay();
  window.closeSeniorKeyboard();
  await window.sendNanaChatMessage(text);
};

window.sendNanaChatMessage = async (rawText) => {
  const text = (rawText || "").trim();
  if (!text || (Date.now() - lastChatSendMs < 4000)) return;
  lastChatSendMs = Date.now();

  const senderLabel = role === 'nana' ? 'Nana' : activeFamilyMember.name;
  const isFromNana = role === 'nana';
  const statusEl = document.getElementById('tg-send-status');
  if (statusEl) { statusEl.style.color = "#ffff00"; statusEl.innerText = "⏳ Sending message to Telegram..."; }

  try {
    await push(bulletinRef, { author: senderLabel, fromNana: isFromNana, text, timestamp: Date.now() });
    if (role === 'nana') await window.dismissCurrentBulletinBar(true);

    const res = await fetch(CONFIG.googleScriptUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ secret: SERVICE_TOKEN, action: "nana_reply", text })
    });
    const data = await res.json();
    if (statusEl) {
      statusEl.style.color = data?.ok ? "#4ade80" : "#f87171";
      statusEl.innerText = data?.ok ? "✅ Sent to Family Telegram Group!" : `⚠️ ${data?.error || 'Telegram not linked'}`;
      setTimeout(() => { statusEl.style.color = "#4ade80"; statusEl.innerText = "🟢 Connected to Family Group"; }, 5000);
    }
  } catch (e) {
    if (statusEl) { statusEl.style.color = "#f87171"; statusEl.innerText = "⚠️ Saved on tablet"; }
  }
};

function renderBulletinFeed() {
  const container = document.getElementById('bulletin-posts-container');
  if (!container) return;
  container.innerHTML = "";
  const keys = Object.keys(latestBulletinPosts).slice(-25);
  const clearedAt = (chatSessionReadCutoff !== null) ? chatSessionReadCutoff : (Number(tabletSettings.bulletinClearedAt) || 0);
  lastRenderedReadAloud = !!tabletSettings.showReadAloud;

  if (keys.length > 0) {
    const newest = latestBulletinPosts[keys[keys.length - 1]];
    document.getElementById('ticker-preview-text').innerText = `💬 ${newest.author || 'Family'}: "${newest.text || 'Sent a photo 📷'}"`;
  } else {
    container.innerHTML = `<div style="margin:auto; color:var(--text-muted); font-size:1.5rem; font-weight:700; padding:30px;">No messages yet. Tap the box below to open the keyboard and say hello!</div>`;
  }

  updateBulletinTickerVisibility();
  let insertedUnreadDivider = false;

  keys.forEach(k => {
    const item = latestBulletinPosts[k];
    const isOutgoing = !!item.fromNana || (item.author && item.author.toLowerCase() === 'nana');
    const msgTime = Number(item.timestamp) || 0;
    const isUnread = !isOutgoing && msgTime > clearedAt;

    if (isUnread && !insertedUnreadDivider) {
      insertedUnreadDivider = true;
      const divider = document.createElement('div');
      divider.id = 'first-unread-divider';
      divider.className = 'tg-unread-divider';
      divider.textContent = '⬇️ NEW UNREAD MESSAGES BELOW ⬇️';
      container.appendChild(divider);
    }

    const bubble = document.createElement('div');
    bubble.className = (isOutgoing ? 'tg-bubble outgoing' : 'tg-bubble incoming') + (isUnread ? ' unread-msg' : '');

    const topRow = document.createElement('div');
    topRow.className = 'tg-sender-row';
    const authorEl = document.createElement('span');
    authorEl.className = 'tg-sender-name';
    authorEl.textContent = isOutgoing ? '👵 Nana (You)' : `👤 ${item.author || 'Family'}`;
    if (isUnread) {
      const newTag = document.createElement('span');
      newTag.className = 'tg-new-tag';
      newTag.textContent = 'NEW';
      authorEl.appendChild(newTag);
    }
    topRow.appendChild(authorEl);

    if (item.timestamp) {
      const timeEl = document.createElement('span');
      timeEl.className = 'tg-msg-time';
      timeEl.textContent = new Date(item.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      topRow.appendChild(timeEl);
    }
    bubble.appendChild(topRow);

    if (item.text) {
      const p = document.createElement('div');
      p.className = 'tg-msg-text';
      p.textContent = item.text;
      bubble.appendChild(p);
    }

    if (item.imageUrl && (/^data:image\//i.test(item.imageUrl) || /^https:\/\//i.test(item.imageUrl))) {
      const img = document.createElement('img');
      img.src = item.imageUrl;
      img.style.cssText = 'width:100%; max-height:340px; object-fit:contain; border-radius:14px; margin-top:4px; background:#000;';
      bubble.appendChild(img);
    }

    if (item.text && tabletSettings.showReadAloud) {
      const btn = document.createElement('button');
      btn.className = 'tg-speak-chip';
      btn.textContent = '🔊 Read Aloud';
      btn.onclick = () => speakNote(`${item.author || 'Family'} says: ${item.text}`);
      bubble.appendChild(btn);
    }

    container.appendChild(bubble);
  });

  if (document.getElementById('bulletin-modal')?.style.display === 'flex') {
    setTimeout(scrollToFirstUnreadOrBottom, 50);
  }
}

onValue(query(bulletinRef, limitToLast(25)), (snap) => {
  latestBulletinPosts = snap.val() || {};
  renderBulletinFeed();
});

window.speakNote = (rawText) => {
  if ('speechSynthesis' in window && rawText) {
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(rawText);
    u.rate = Number(tabletSettings.speechRate) || 0.9;
    window.speechSynthesis.speak(u);
  }
};

// ========================================================================
// CLASSIC FM RADIO ENGINE (SEPARATE VOLUME & IDLE DIMMING SUPPORT)
// ========================================================================
window.openRadioScreen = () => {
  showScreen('radio-screen');
  wakeScreenAndResetDimTimer();
  recordHeartbeat("Opened Classic FM Radio");
};

window.closeRadioScreen = () => {
  window.stopRadioAndSync(true);
  showScreen('grid-screen');
  wakeScreenAndResetDimTimer();
  recordHeartbeat("On Home Grid");
};

window.toggleClassicFM = async () => {
  if (isRadioPlaying) await window.stopRadioAndSync(true);
  else await set(entertainmentRef, { activeKey: "classicfm", title: "Classic FM Radio 🎻", timestamp: Date.now() });
};

window.remoteSetEntertainment = async (key) => {
  if (key !== 'off' && !confirm("Turn Classic FM radio ON on Nana's tablet now?")) return;
  await set(entertainmentRef, {
    activeKey: key === 'off' ? "off" : "classicfm",
    title: key === 'off' ? "Off" : "Classic FM Radio 🎻",
    timestamp: Date.now()
  });
};

window.stopRadioAndSync = async (syncToFirebase = true) => {
  isRadioPlaying = false;
  if (radioPlayer) { radioPlayer.pause(); radioPlayer.removeAttribute('src'); radioPlayer.load(); }
  document.getElementById('btn-classicfm')?.classList.remove('playing');
  document.getElementById('radio-action-prompt').innerText = "(Tap to Turn On)";
  document.getElementById('radio-status-label').innerText = "Radio Off";
  wakeScreenAndResetDimTimer();
  if (syncToFirebase) await set(entertainmentRef, { activeKey: "off", title: "Off", timestamp: Date.now() });
};

function startLocalRadioStream() {
  if (!radioPlayer) return;
  isRadioPlaying = true;
  wakeScreenAndResetDimTimer();
  const radVol = Math.min(1.0, Math.max(0.15, (Number(tabletSettings.radioVolume ?? 75)) / 100));
  radioPlayer.volume = radVol;
  radioPlayer.src = CLASSIC_FM_STREAM;
  radioPlayer.play().catch(() => {});
  document.getElementById('btn-classicfm')?.classList.add('playing');
  document.getElementById('radio-action-prompt').innerText = "Playing Live...";
  document.getElementById('radio-status-label').innerText = "Playing Classic FM 🎻";
  speakMsg("Playing Classic FM");
}

window.adjustNanaRadioVolume = async (delta) => {
  const nextVol = Math.max(15, Math.min(100, (Number(tabletSettings.radioVolume ?? 75)) + delta));
  await window.updateSetting('radioVolume', nextVol);
};

onValue(entertainmentRef, (snap) => {
  const data = snap.val() || { activeKey: "off", title: "Off" };
  latestEntState = data;
  const activeKey = data.activeKey || "off";

  if (role === 'family') {
    const lbl = document.getElementById('lbl-remote-ent-status');
    if (lbl) lbl.innerText = activeKey === 'off' ? 'Off' : 'Playing 🎻';
    document.getElementById('fam-ent-classicfm')?.classList.toggle('selected', activeKey !== 'off');
    updateFamilyPresenceBanner();
  } else if (role === 'nana' && currentState === 'idle') {
    if (activeKey === 'off') {
      if (isRadioPlaying) { window.stopRadioAndSync(false); showScreen('grid-screen'); }
      return;
    }
    if (!document.getElementById('radio-screen').classList.contains('active')) showScreen('radio-screen');
    if (!isRadioPlaying) startLocalRadioStream();
  }
});

// ========================================================================
// MODALS, SUPERVISOR PIN & SHARED SETTINGS MOUNT
// ========================================================================
window.openPhoneGuideModal = () => {
  switchGuideTab(/iPad|iPhone|iPod/.test(navigator.userAgent) ? 'ios' : 'android');
  document.getElementById('phone-guide-modal').style.display = 'flex';
};
window.closePhoneGuideModal = () => { document.getElementById('phone-guide-modal').style.display = 'none'; };
window.switchGuideTab = (os) => {
  document.getElementById('tab-btn-ios').classList.toggle('active', os === 'ios');
  document.getElementById('tab-btn-android').classList.toggle('active', os === 'android');
  document.getElementById('guide-content-ios').style.display = os === 'ios' ? 'block' : 'none';
  document.getElementById('guide-content-android').style.display = os === 'android' ? 'block' : 'none';
};

window.openAdminPinModal = () => {
  enteredPin = "";
  document.getElementById('pin-dots-display').innerText = "";
  document.getElementById('admin-modal-title').innerText = `⚙️ Supervisor & Controls (v${CONFIG.appVersion})`;
  document.getElementById('pin-keypad-section').style.display = 'flex';
  document.getElementById('admin-actions-section').style.display = 'none';
  document.getElementById('admin-pin-modal').style.display = 'flex';
};
window.closeAdminPinModal = () => { enteredPin = ""; document.getElementById('admin-pin-modal').style.display = 'none'; };
window.clearPinDigits = () => { enteredPin = ""; document.getElementById('pin-dots-display').innerText = ""; };

window.pressPinDigit = (digit) => {
  if (enteredPin.length >= 4) return;
  enteredPin += digit;
  document.getElementById('pin-dots-display').innerText = "●".repeat(enteredPin.length);
  if (enteredPin.length === 4) {
    if (enteredPin === CONFIG.adminPin) {
      window.AndroidBridge?.unlockAdminForFiveMinutes?.();
      const cards = document.getElementById('shared-settings-cards');
      const gearMount = document.getElementById('gear-settings-mount');
      if (cards && gearMount && cards.parentElement !== gearMount) gearMount.appendChild(cards);
      document.getElementById('admin-modal-title').innerText = `🔓 Unlocked (v${CONFIG.appVersion})`;
      document.getElementById('pin-keypad-section').style.display = 'none';
      document.getElementById('admin-actions-section').style.display = 'flex';
      refreshSettingsUI();
    } else {
      document.getElementById('pin-dots-display').innerText = "❌";
      setTimeout(window.clearPinDigits, 700);
    }
  }
};

window.adminExecuteAction = (action) => {
  const baseFolderUrl = window.location.origin + window.location.pathname.replace(/\/[^\/]*$/, '/');
  const apkDownloadUrl = `${baseFolderUrl}${CONFIG.apkFileName}?t=${Date.now()}`;
  if (action === 'update_apk') {
    if (window.AndroidBridge?.downloadAndInstallApk) window.AndroidBridge.downloadAndInstallApk(apkDownloadUrl);
    else window.location.href = apkDownloadUrl;
  } else if (action === 'update_web') {
    if (window.AndroidBridge?.clearCacheAndReload) window.AndroidBridge.clearCacheAndReload();
    else window.location.reload(true);
  } else if (window.AndroidBridge) {
    const map = {
      pin_screen: 'enableScreenPinning',
      settings: 'openAndroidSettings',
      wifi: 'openWifiSettings',
      launcher: 'openLenovoLauncher',
      relock: 'relockKioskNow'
    };
    if (map[action] && window.AndroidBridge[map[action]]) window.AndroidBridge[map[action]]();
  }
  closeAdminPinModal();
};

// ========================================================================
// PRESENCE, CONTACTS & HIDE-ME MODE
// ========================================================================
window.resetIdleTimer = () => { wakeScreenAndResetDimTimer(); recordHeartbeat(); };
window.addEventListener('pointerdown', () => { wakeScreenAndResetDimTimer(); recordHeartbeat(); }, { passive: true });

function recordHeartbeat(customActivity = null) {
  if (role !== 'nana') return;
  const now = Date.now();
  if (!customActivity && (now - lastHeartbeatWriteMs < 30000)) return;
  lastHeartbeatWriteMs = now;

  let batteryLevel = null, isCharging = null;
  if (window.AndroidBridge?.getBatteryStatusJson) {
    try {
      const b = JSON.parse(window.AndroidBridge.getBatteryStatusJson());
      batteryLevel = b.level;
      isCharging = b.charging;
      if (!isCharging && batteryLevel !== null && batteryLevel <= 25 && !isBatteryVoiceCurrentlyMuted()) {
        window.announceBatteryWarning("Please plug in the tablet charger.");
      }
    } catch (e) {}
  }
  const payload = { lastActive: now, batteryLevel, isCharging };
  if (customActivity) payload.lastActivity = customActivity;
  update(presenceRef, payload);
}

if (role === 'nana') {
  setTimeout(() => { wakeScreenAndResetDimTimer(); recordHeartbeat("Tablet Online"); }, 3000);
  setInterval(() => recordHeartbeat(), 120000);
}

function updateFamilyPresenceBanner() {
  if (role !== 'family') return;
  const card = document.getElementById('nana-presence-card');
  const ringBtn = document.getElementById('family-ring-btn');
  if (!card) return;

  let touchText = "👆 Last touched: No recent activity";
  if (latestPresenceData?.lastActive) {
    const diffMins = Math.max(0, Math.round((Date.now() - latestPresenceData.lastActive) / 60000));
    touchText = `👆 Last touched: ${diffMins <= 1 ? 'Just now' : diffMins + 'm ago'}`;
  }
  const battText = latestPresenceData?.batteryLevel != null
    ? ` • ${latestPresenceData.isCharging ? "🔌 Charging" : "⚠️ UNPLUGGED"} (${latestPresenceData.batteryLevel}%)`
    : "";
  const radioStatus = (latestEntState?.activeKey && latestEntState.activeKey !== 'off')
    ? `<div style="color:#fef08a; font-weight:800; margin-top:2px;">🎻 Listening to Classic FM Radio</div>`
    : `<div style="color:#94a3b8; font-size:0.9rem;">🎻 Radio: Off</div>`;
  const tgStatusLine = connectedMemberIds.includes(activeFamilyMember.id)
    ? `<span style="color:#4ade80; font-size:0.88rem;">✅ Your Telegram alerts are connected</span>`
    : `<span style="color:#fbbf24; font-size:0.88rem;">⚠️ Tap "1. Connect Telegram" below so Nana can call you</span>`;

  const st = latestCallData?.status || 'idle';
  if (st !== 'idle') {
    const otherId = latestCallData.callerId === 'nana' ? latestCallData.targetId : latestCallData.callerId;
    const withName = CONFIG.familyMembers.find(m => m.id === otherId)?.name || 'Family';
    card.style.borderColor = '#f87171';
    card.innerHTML = `${st === 'connected' ? `🔴 <strong>On a video call with ${withName}</strong>` : `🟡 <strong>Ringing (${withName})</strong>`}<br><span style="color:#cbd5e1; font-size:0.9rem;">${touchText}${battText}</span><br>${tgStatusLine}`;
    if (ringBtn && otherId && otherId !== activeFamilyMember.id) ringBtn.disabled = true;
  } else {
    card.style.borderColor = tabletSettings.callingEnabled ? '#22c55e' : '#f59e0b';
    card.innerHTML = tabletSettings.callingEnabled
      ? `🟢 <strong>Nana is available</strong>${radioStatus}<span style="color:#cbd5e1; font-size:0.9rem;">${touchText}${battText}</span><br>${tgStatusLine}`
      : `📵 <strong>Video calling is switched off</strong><br><span style="color:#cbd5e1; font-size:0.9rem;">${touchText}${battText}</span><br>${tgStatusLine}`;
    if (ringBtn) ringBtn.disabled = !tabletSettings.callingEnabled;
  }
}

if (role === 'family') {
  onValue(presenceRef, (snap) => { latestPresenceData = snap.val() || {}; updateFamilyPresenceBanner(); });
  setInterval(updateFamilyPresenceBanner, 30000);
}

onValue(connectedMembersRef, (snap) => {
  const val = snap.val();
  connectedMemberIds = Array.isArray(val) ? val : (val && typeof val === 'object' ? Object.values(val) : []);
  if (role === 'nana') renderContacts(connectedMemberIds);
  if (role === 'family') updateFamilyPresenceBanner();
});

window.syncConnectedFamilyFromTelegram = async () => {
  try {
    const portalBaseUrl = window.location.origin + window.location.pathname;
    const res = await fetch(CONFIG.googleScriptUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ secret: SERVICE_TOKEN, action: "sync", webhookUrl: CONFIG.googleScriptUrl, portalBaseUrl })
    });
    const data = await res.json();
    if (data.ok && Array.isArray(data.connected)) {
      connectedMemberIds = data.connected;
      if (role === 'nana') renderContacts(connectedMemberIds);
      if (role === 'family') updateFamilyPresenceBanner();
    }
    return data;
  } catch (e) { return { ok: false, error: e.toString() }; }
};

window.forceWebhookAndMemberSync = async () => {
  const lbl = document.getElementById('lbl-sync-status');
  if (lbl) lbl.innerText = "Syncing...";
  const res = await window.syncConnectedFamilyFromTelegram();
  if (res?.ok) {
    if (lbl) lbl.innerText = `✅ Linked (${(res.connected || []).length} connected)`;
    alert(`Synced! Connected family members: ${(res.connected || []).join(", ") || "None yet"}`);
  } else {
    if (lbl) lbl.innerText = "⚠️ Check Script Deployment";
  }
};

// Hide Me From Nana
const HIDE_FOREVER = 4102444800000;
function isHiddenFromNana(id) { return Number(latestHidden[id] || 0) > Date.now(); }
function fmtHiddenUntil(ts) {
  if (ts >= HIDE_FOREVER) return 'until you turn it back on';
  const d = new Date(ts);
  const time = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  return 'until ' + (d.toDateString() === new Date().toDateString() ? time : d.toLocaleDateString([], { weekday: 'short' }) + ' ' + time);
}

window.hideMeFromNana = async (choice) => {
  if (role !== 'family' || !activeFamilyMember) return;
  const mins = { '30m': 30, '1h': 60, '2h': 120, '5h': 300, '10h': 600 };
  let until = HIDE_FOREVER;
  if (mins[choice]) until = Date.now() + mins[choice] * 60000;
  else if (choice === 'tomorrow') {
    const d = new Date(); d.setHours(7, 0, 0, 0);
    if (d.getTime() <= Date.now()) d.setDate(d.getDate() + 1);
    until = d.getTime();
  }
  await set(ref(db, `${basePath}/hiddenContacts/${activeFamilyMember.id}`), until);
};

window.showMeToNana = async () => {
  if (role === 'family' && activeFamilyMember) {
    await remove(ref(db, `${basePath}/hiddenContacts/${activeFamilyMember.id}`));
  }
};

function refreshHideUI() {
  if (role !== 'family' || !activeFamilyMember) return;
  const until = Number(latestHidden[activeFamilyMember.id] || 0);
  const hidden = until > Date.now();
  const txt = hidden ? `🙈 Hidden from Nana ${fmtHiddenUntil(until)}` : `👁️ Visible on Nana's tablet`;
  document.querySelectorAll('.hide-status-lbl').forEach(e => {
    e.innerText = txt;
    e.style.color = hidden ? '#fbbf24' : '#4ade80';
  });
}

onValue(hiddenRef, (snap) => {
  latestHidden = snap.val() || {};
  if (role === 'nana') renderContacts(connectedMemberIds); else refreshHideUI();
});
setInterval(() => { if (role === 'nana') renderContacts(connectedMemberIds); else refreshHideUI(); }, 30000);

function renderContacts(connectedList = []) {
  const grid = document.getElementById('family-grid');
  if (!grid) return;
  grid.innerHTML = "";
  const connectedMembers = CONFIG.familyMembers.filter(m => connectedList.includes(m.id));
  const displayList = connectedMembers.filter(m => !isHiddenFromNana(m.id)).slice(0, 8);

  if (displayList.length === 0) {
    grid.innerHTML = connectedMembers.length > 0
      ? `<div style="grid-column:1/-1;grid-row:1/-1;display:flex;align-items:center;justify-content:center;color:var(--text-muted);font-size:1.8rem;font-weight:700;padding:20px;">😴 Nobody is available to call right now.<br>Try again later or send a Family Chat message.</div>`
      : `<div style="grid-column:1/-1;grid-row:1/-1;display:flex;flex-direction:column;align-items:center;justify-content:center;color:var(--text-muted);font-size:1.6rem;font-weight:700;padding:20px;"><p>⏳ Waiting for family members to connect Telegram...</p><button class="tone-btn" style="font-size:1.2rem;background:#0284c7;" onclick="syncConnectedFamilyFromTelegram()">🔄 Check Now</button></div>`;
    return;
  }

  displayList.forEach(member => {
    const missedCount = Number(missedCallsByMember[member.id]?.count) || 0;
    const card = document.createElement('div');
    card.className = missedCount > 0 ? 'family-card has-missed' : 'family-card';
    card.innerHTML = `
      ${missedCount > 0 ? `<div class="missed-card-badge">📞 ${missedCount} MISSED</div>` : ''}
      <div class="photo-wrapper"><img src="${member.photo}" onerror="this.src='${member.fallback}'"></div>
      <div class="contact-nameplate">${member.name}</div>
    `;
    card.onclick = () => openCallConfirmation(member);
    grid.appendChild(card);
  });
}

// Confirm Call Modal
window.openCallConfirmation = (member) => {
  pendingCallContact = member;
  document.getElementById('confirm-prompt-title').innerText = `Call ${member.name}?`;
  const img = document.getElementById('confirm-photo');
  img.onerror = () => { img.src = member.fallback; };
  img.src = member.photo;

  const missedCount = Number(missedCallsByMember[member.id]?.count) || 0;
  const missedNoteEl = document.getElementById('confirm-missed-note');
  if (missedCount > 0) {
    missedNoteEl.innerText = `📞 ${member.name} tried calling you ${missedCount} ${missedCount === 1 ? 'time' : 'times'}`;
    missedNoteEl.style.display = 'block';
  } else {
    missedNoteEl.style.display = 'none';
  }

  document.getElementById('confirm-modal').style.display = 'flex';
  let seconds = 15;
  document.getElementById('confirm-timer').innerText = seconds;
  clearInterval(confirmTimer);
  confirmTimer = setInterval(() => {
    seconds--;
    document.getElementById('confirm-timer').innerText = seconds;
    if (seconds <= 0) dismissCallConfirm();
  }, 1000);
};

window.dismissCallConfirm = () => {
  clearInterval(confirmTimer);
  document.getElementById('confirm-modal').style.display = 'none';
  pendingCallContact = null;
};

window.executeConfirmedCall = () => {
  const target = pendingCallContact;
  dismissCallConfirm();
  if (target) startCallFromNana(target);
};

// ========================================================================
// SETTINGS & RYAN-ONLY CONTROLS
// ========================================================================
window.openSettingsModal = () => {
  if (role === 'family' && !isAdminFamilyMember) return;
  const cards = document.getElementById('shared-settings-cards');
  const famMount = document.getElementById('family-settings-mount');
  if (cards && famMount && cards.parentElement !== famMount) famMount.appendChild(cards);
  document.getElementById('settings-modal').style.display = 'flex';
};
window.closeSettingsModal = () => { document.getElementById('settings-modal').style.display = 'none'; };

window.updateSetting = async (key, value) => {
  tabletSettings[key] = value;
  refreshSettingsUI();
  updateClock();
  updateBulletinTickerVisibility();
  wakeScreenAndResetDimTimer();
  await update(settingsRef, { [key]: value });
};

window.stepNanaCallVolume = async (delta) => {
  const nextVol = Math.max(25, Math.min(100, (Number(tabletSettings.callVolume) || 85) + delta));
  await window.updateSetting('callVolume', nextVol);
};

window.previewAndSetTone = async (toneName) => {
  tabletSettings.ringtone = toneName;
  refreshSettingsUI();
  playSelectedRingtoneAudio(toneName, tabletSettings.ringVolume || 85, true);
  await update(settingsRef, { ringtone: toneName });
};

window.setCallingEnabled = (on) => window.updateSetting('callingEnabled', !!on);

window.copyTestLink = async (kind) => {
  const base = window.location.origin + window.location.pathname;
  const link = kind === 'nana' ? `${base}?role=nana&test=1` : `${base}?role=family&id=${encodeURIComponent(callerId)}&test=1`;
  try { await navigator.clipboard.writeText(link); alert('Copied:\n' + link); }
  catch (e) { window.prompt('Copy link:', link); }
};

function formatDimDelayLabel(sec) {
  const s = Number(sec ?? 120);
  return s === 0 ? "Never" : (s < 60 ? `${s}s` : `${Math.round(s / 60)}m`);
}

function enforceCallingOff() {
  if (role === 'nana' && settingsLoaded && !tabletSettings.callingEnabled && latestCallData?.status !== 'idle') {
    stopRingingUI();
    set(callStateRef, { status: 'idle', timestamp: Date.now() });
  }
}

function refreshSettingsUI() {
  const callingOn = !!tabletSettings.callingEnabled;
  document.body.classList.toggle('calling-off', !callingOn);
  const gridTitle = document.getElementById('grid-header-title');
  if (gridTitle) gridTitle.innerText = callingOn ? 'Tap a photo to call family' : 'Family Chat & Radio';
  document.querySelectorAll('.calling-on-btn').forEach(b => b.classList.toggle('selected', callingOn));
  document.querySelectorAll('.calling-off-btn').forEach(b => b.classList.toggle('selected', !callingOn));
  document.querySelectorAll('.calling-status-lbl').forEach(l => {
    l.innerText = callingOn ? '✅ Calling is ON' : '📵 Calling is OFF';
    l.style.color = callingOn ? '#4ade80' : '#fca5a5';
  });

  const ringBtnEl = document.getElementById('family-ring-btn');
  if (ringBtnEl) {
    ringBtnEl.innerText = callingOn ? '📹 Ring Nana Now' : '📵 Calling is switched off';
    if (!callingOn) ringBtnEl.disabled = true;
  }

  applyColorTheme(tabletSettings.colorTheme);

  const callVol = Number(tabletSettings.callVolume ?? 85);
  const radVol = Number(tabletSettings.radioVolume ?? 75);
  const ringVol = Number(tabletSettings.ringVolume ?? 85);
  const awakeB = Number(tabletSettings.awakeBrightness ?? 85);
  const dimB = Number(tabletSettings.dimBrightness ?? 15);
  const dimSec = Number(tabletSettings.dimDelaySec ?? 120);
  const nStart = Number(tabletSettings.nightStartHour ?? 21);
  const nEnd = Number(tabletSettings.nightEndHour ?? 8);
  const kbLayout = tabletSettings.keyboardLayout || 'qwerty';
  const kbHideSec = Number(tabletSettings.keyboardTimeoutSec ?? 60);

  const inCallVolLbl = document.getElementById('in-call-vol-label');
  const nanaRadVolLbl = document.getElementById('nana-vol-display');
  if (inCallVolLbl) inCallVolLbl.innerText = `${callVol}%`;
  if (nanaRadVolLbl) nanaRadVolLbl.innerText = `${radVol}%`;

  const brightSum = `${awakeB}% ➔ ${dimB}% (${formatDimDelayLabel(dimSec)})`;
  document.querySelectorAll('.lbl-bright-summary').forEach(e => { e.innerText = brightSum; });
  document.querySelectorAll('.lbl-kb-summary').forEach(e => { e.innerText = `${kbLayout.toUpperCase()} • ${formatDimDelayLabel(kbHideSec)}`; });
  document.querySelectorAll('.lbl-vol-summary').forEach(e => { e.innerText = `Call ${callVol}% • Radio ${radVol}% • Ring ${ringVol}%`; });

  const winStr = `${String(nStart).padStart(2, '0')}:00 – ${String(nEnd).padStart(2, '0')}:00`;
  document.querySelectorAll('.lbl-night-window').forEach(e => { e.innerText = tabletSettings.nightModeEnabled ? winStr : "Disabled"; });

  const mutedUntil = Number(tabletSettings.batteryVoiceMutedUntil) || 0;
  const muteText = mutedUntil > Date.now()
    ? `🔇 Muted until ${new Date(mutedUntil).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
    : `🔊 Battery Voice: Active`;
  document.querySelectorAll('.lbl-battery-mute').forEach(e => { e.innerText = muteText; });

  // Apply separate Call Volume vs Radio Volume
  const scaledCallVol = Math.min(1.0, Math.max(0.2, callVol / 100));
  const scaledRadVol = Math.min(1.0, Math.max(0.15, radVol / 100));
  const remAudio = document.getElementById('remote-audio');
  const remVideo = document.getElementById('remote-video');
  if (remAudio) remAudio.volume = (role === 'nana') ? scaledCallVol : 1.0;
  if (remVideo) remVideo.volume = (role === 'nana') ? scaledCallVol : 1.0;
  if (radioPlayer && role === 'nana') radioPlayer.volume = scaledRadVol;

  // Data-driven button selection highlighting
  document.querySelectorAll('[data-skey]').forEach(btn => {
    const k = btn.dataset.skey;
    const v = btn.dataset.sval;
    btn.classList.toggle('selected', String(tabletSettings[k]) === String(v));
  });

  if (lastRenderedKbLayout !== kbLayout) renderSeniorKeyboardLayout();
  if (lastRenderedReadAloud !== !!tabletSettings.showReadAloud) renderBulletinFeed();
}

onValue(settingsRef, (snap) => {
  const remote = snap.val();
  if (remote) tabletSettings = { ...tabletSettings, ...remote };
  settingsLoaded = true;
  refreshSettingsUI();
  updateClock();
  updateBulletinTickerVisibility();
  wakeScreenAndResetDimTimer();
  enforceCallingOff();
  if (role === 'family') updateFamilyPresenceBanner();
});

// ========================================================================
// RINGTONE SYNTHESIZER & TELEGRAM 6-STAGE BURST
// ========================================================================
function playNote(freq, startTime, duration, type = 'sine', baseGain = 0.6, volPercent = 85) {
  if (audioCtx.state === 'suspended') audioCtx.resume();
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, startTime);
  gain.gain.setValueAtTime(baseGain * (volPercent / 100), startTime);
  gain.gain.exponentialRampToValueAtTime(0.008, startTime + duration);
  osc.connect(gain);
  gain.connect(audioCtx.destination);
  osc.start(startTime);
  osc.stop(startTime + duration);
}

function playSelectedRingtoneAudio(toneName, volume = 85, isPreview = false) {
  const scaledVol = Math.min(1.0, Math.max(0.2, volume / 100));
  if (toneName.endsWith('.mp3')) {
    if (activeMp3Ringtone && !isPreview) return;
    if (activeMp3Ringtone) activeMp3Ringtone.pause();
    activeMp3Ringtone = new Audio(toneName);
    activeMp3Ringtone.volume = scaledVol;
    if (!isPreview) activeMp3Ringtone.loop = true;
    activeMp3Ringtone.play().catch(() => {});
    return;
  }
  if (audioCtx.state === 'suspended') audioCtx.resume();
  const now = audioCtx.currentTime;
  if (toneName === 'uk-phone') {
    [0, 0.55].forEach(o => { playNote(400, now + o, 0.35, 'square', 0.45, volume); playNote(450, now + o, 0.35, 'square', 0.45, volume); });
  } else if (toneName === 'westminster') {
    [[329.63, 0, 0.35], [415.30, 0.35, 0.35], [369.99, 0.70, 0.35], [246.94, 1.05, 0.65]].forEach(([f, o, d]) => playNote(f, now + o, d, 'triangle', 0.8, volume));
  } else if (toneName === 'marimba') {
    [[523.25, 0, 0.25], [659.25, 0.22, 0.25], [783.99, 0.44, 0.25], [1046.5, 0.66, 0.55]].forEach(([f, o, d]) => playNote(f, now + o, d, 'sine', 0.8, volume));
  } else if (toneName === 'bell') {
    [0, 0.35, 0.70].forEach(o => { playNote(880, now + o, 0.28, 'sine', 0.75, volume); playNote(1760, now + o, 0.28, 'triangle', 0.5, volume); });
  }
}

async function sendSingleTelegramRing(member, stepNum, maxSteps) {
  const answerUrl = `${window.location.origin + window.location.pathname}?role=family&id=${encodeURIComponent(member.id)}&key=${encodeURIComponent(SERVICE_TOKEN)}&answer=true`;
  try {
    const subEl = document.getElementById('outbound-sub');
    if (subEl) subEl.innerText = `Ringing their mobile now (${stepNum}/${maxSteps})...`;
    const res = await fetch(CONFIG.googleScriptUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ secret: SERVICE_TOKEN, action: "ring", memberId: member.id, answerUrl, ringCount: stepNum, maxRings: maxSteps, previousMessageId: lastTelegramMsgId })
    });
    const data = await res.json();
    if (data.ok && data.messageId) lastTelegramMsgId = data.messageId;
  } catch (e) {}
}

function startTelegramRingBurst(member) {
  stopTelegramRingBurst();
  currentDialedMember = member;
  lastTelegramMsgId = null;
  let step = 1;
  sendSingleTelegramRing(member, step, 6);
  telegramBurstInterval = setInterval(() => {
    if (currentState !== 'calling_family' || step >= 6) {
      clearInterval(telegramBurstInterval);
      telegramBurstInterval = null;
      return;
    }
    step++;
    sendSingleTelegramRing(member, step, 6);
  }, 8500);
}

function stopTelegramRingBurst() {
  if (telegramBurstInterval) { clearInterval(telegramBurstInterval); telegramBurstInterval = null; }
  if (currentDialedMember && lastTelegramMsgId) {
    const memberId = currentDialedMember.id, messageId = lastTelegramMsgId;
    lastTelegramMsgId = null;
    fetch(CONFIG.googleScriptUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ secret: SERVICE_TOKEN, action: "clear_rings", memberId, messageId })
    }).catch(() => {});
  }
}

// ========================================================================
// HD WEBRTC VIDEO ENGINE + CAMERA FLIP (FRONT / REAR)
// ========================================================================
function unlockCallAudio() {
  try {
    if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
    const ra = document.getElementById('remote-audio');
    const rv = document.getElementById('remote-video');
    if (ra) {
      ra.muted = false;
      ra.volume = (role === 'nana') ? Math.min(1.0, Math.max(0.2, (Number(tabletSettings.callVolume) || 85) / 100)) : 1.0;
      if (!ra.srcObject) ra.src = SILENT_WAV;
      ra.play().catch(() => {});
    }
    if (rv) { rv.muted = true; rv.play().catch(() => {}); }
  } catch (e) {}
}

window.switchFamilyCamera = async () => {
  if (!callObject) return;
  try {
    currentFacingMode = currentFacingMode === 'user' ? 'environment' : 'user';
    if (typeof callObject.cycleCamera === 'function') {
      await callObject.cycleCamera();
    } else {
      await callObject.setInputDevicesAsync({ videoSource: { facingMode: currentFacingMode } });
    }
    const localVid = document.getElementById('local-video');
    if (localVid) localVid.style.transform = currentFacingMode === 'environment' ? 'scaleX(1)' : 'scaleX(-1)';
  } catch (e) {
    try { await callObject.setInputDevicesAsync({ videoSource: { facingMode: currentFacingMode } }); } catch (_) {}
  }
};

async function joinDailyRoom() {
  if (isJoiningOrInRoom || callObject) return;
  isJoiningOrInRoom = true;
  currentFacingMode = 'user';

  const banner = document.getElementById('call-connecting-banner');
  banner.style.display = 'block';
  banner.innerText = '📹 Connecting video...';

  if (!window.DailyIframe) {
    banner.innerText = '⚠️ Video library failed to load';
    isJoiningOrInRoom = false;
    return;
  }

  const co = window.DailyIframe.createCallObject({
    audioSource: true,
    videoSource: true,
    dailyConfig: {
      avoidEval: true,
      userMediaAudioConstraints: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true
      },
      userMediaVideoConstraints: {
        facingMode: 'user',
        width: { ideal: 1280 },
        height: { ideal: 720 },
        frameRate: { ideal: 30 }
      }
    }
  });
  callObject = co;

  let hadRemote = false;
  let emptyTimer = null;
  let soundBlocked = false;

  const targetVol = () => (role === 'nana')
    ? Math.min(1.0, Math.max(0.2, (Number(tabletSettings.callVolume) || 85) / 100))
    : 1.0;

  const showProblem = (text) => { banner.style.display = 'block'; banner.innerText = text; };

  const promptTapToUnmute = () => {
    soundBlocked = true;
    showProblem('🔈 Tap anywhere on screen to hear the call');
    const resumeAll = () => {
      if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
      const rv = document.getElementById('remote-video');
      const ra = document.getElementById('remote-audio');
      if (rv) { rv.muted = false; rv.volume = targetVol(); rv.play().catch(() => {}); }
      if (ra) { ra.muted = false; ra.volume = targetVol(); ra.play().catch(() => {}); }
      soundBlocked = false;
      banner.style.display = 'none';
    };
    document.addEventListener('pointerdown', resumeAll, { once: true });
  };

  const pickBestRemoteParticipant = () => {
    const remotes = Object.values(co.participants()).filter(p => !p.local);
    if (remotes.length === 0) return null;
    if (role === 'family') {
      return remotes.find(p => p.user_name === 'Nana_Tablet')
          || remotes.find(p => (p.user_name || '').startsWith('Nana'))
          || remotes[0];
    }
    return remotes.find(p => (p.user_name || '').startsWith('Family_')) || remotes[0];
  };

  const attachTracks = () => {
    if (callObject !== co) return;
    const parts = co.participants();

    const localTrack = parts.local?.tracks?.video?.persistentTrack || parts.local?.tracks?.video?.track;
    if (localTrack) {
      const localVid = document.getElementById('local-video');
      if (localVid && localVid.srcObject?.getVideoTracks()[0] !== localTrack) {
        localVid.srcObject = new MediaStream([localTrack]);
        localVid.play().catch(() => {});
      }
    }

    const targetRemote = pickBestRemoteParticipant();
    if (!targetRemote) return;

    hadRemote = true;
    clearTimeout(emptyTimer);

    const remVidTrack = targetRemote.tracks?.video?.persistentTrack || targetRemote.tracks?.video?.track;
    const remAudTrack = targetRemote.tracks?.audio?.persistentTrack || targetRemote.tracks?.audio?.track;
    const remVid = document.getElementById('remote-video');
    const remAud = document.getElementById('remote-audio');

    if (remVidTrack && remVid) {
      if (!soundBlocked) banner.style.display = 'none';
      const curVidTrack = remVid.srcObject?.getVideoTracks()[0];
      const curVidAudTrack = remVid.srcObject?.getAudioTracks()[0];
      if (curVidTrack !== remVidTrack || (remAudTrack && curVidAudTrack !== remAudTrack)) {
        remVid.srcObject = new MediaStream(remAudTrack ? [remVidTrack, remAudTrack] : [remVidTrack]);
        remVid.volume = targetVol();
        remVid.muted = false;
        remVid.play().catch(() => {
          remVid.muted = true;
          remVid.play().catch(() => {});
          promptTapToUnmute();
        });
      }
    }

    if (remAudTrack && remAud) {
      const curAudTrack = remAud.srcObject?.getAudioTracks()[0];
      if (curAudTrack !== remAudTrack) {
        remAud.removeAttribute('src');
        remAud.srcObject = new MediaStream([remAudTrack]);
        remAud.muted = !!(remVid && !remVid.muted);
        remAud.volume = targetVol();
        remAud.play().catch(() => promptTapToUnmute());
      }
    }
  };

  co
    .on('joined-meeting', attachTracks)
    .on('participant-joined', attachTracks)
    .on('participant-updated', attachTracks)
    .on('track-started', attachTracks)
    .on('track-stopped', attachTracks)
    .on('participant-left', () => {
      if (callObject !== co) return;
      clearTimeout(emptyTimer);
      emptyTimer = setTimeout(() => {
        if (callObject !== co) return;
        const remotes = Object.values(co.participants()).filter(p => !p.local);
        if (hadRemote && remotes.length === 0) endCall();
      }, 10000);
    })
    .on('camera-error', (e) => showProblem('⚠️ Camera/mic error: ' + (e?.errorMsg?.errorMsg || 'check permissions')))
    .on('error', (e) => {
      showProblem('⚠️ Video error: ' + (e?.errorMsg || 'reconnecting'));
      setTimeout(() => { if (callObject === co) endCall(); }, 8000);
    });

  const participantTag = role === 'nana'
    ? (isRealAndroidTablet ? 'Nana_Tablet' : 'Nana_Browser')
    : `Family_${activeFamilyMember.id}`;

  try {
    await co.join({ url: CONFIG.dailyRoomUrl, userName: participantTag });
    co.setLocalVideo(true);
    co.setLocalAudio(true);
    try { co.setBandwidth({ kbs: 1800, trackConstraints: { width: 1280, height: 720, frameRate: 30 } }); } catch (_) {}
  } catch (err) {
    showProblem('⚠️ Could not join video room');
    isJoiningOrInRoom = false;
    setTimeout(() => { if (callObject === co) endCall(); }, 8000);
  }
}

async function destroyDailyRoom() {
  isJoiningOrInRoom = false;
  didManuallyInitiateOrAnswerOnThisTab = false;
  if (callObject) {
    const co = callObject;
    callObject = null;
    try { await co.leave(); await co.destroy(); } catch (e) {}
  }
  ['remote-video', 'remote-audio', 'local-video'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.srcObject = null;
  });
}

// ========================================================================
// CALL SIGNALING & ROUTER
// ========================================================================
async function startCallFromNana(member) {
  if (!tabletSettings.callingEnabled || isHiddenFromNana(member.id)) return;
  unlockCallAudio();
  didManuallyInitiateOrAnswerOnThisTab = true;
  await window.stopRadioAndSync(true);
  document.getElementById('bulletin-modal').style.display = 'none';
  window.closeSeniorKeyboard();

  currentState = 'calling_family';
  wakeScreenAndResetDimTimer();
  const outImg = document.getElementById('outbound-photo');
  outImg.onerror = () => { outImg.src = member.fallback; };
  outImg.src = member.photo;
  document.getElementById('outbound-title').innerText = `Calling ${member.name}...`;
  showScreen('outbound-screen');
  speakMsg(`Calling ${member.spokenName} now. Please wait.`);

  try {
    await clearMissedCallsForMember(member.id);
    await set(callStateRef, { status: 'calling_family', callerId: 'nana', targetId: member.id, timestamp: Date.now() });
  } catch (e) {
    currentState = 'idle';
    showScreen('grid-screen');
    return;
  }
  startTelegramRingBurst(member);

  clearTimeout(outboundTimeout);
  outboundTimeout = setTimeout(async () => {
    if (currentState === 'calling_family') {
      speakMsg(`Sorry, ${member.spokenName} could not answer right now.`);
      await incrementMissedCallForMember(member.id);
      await endCall();
    }
  }, (Number(tabletSettings.ringDurationSec) || 60) * 1000);
}

window.confirmFamilyPickupFromTelegram = async () => {
  unlockCallAudio();
  didManuallyInitiateOrAnswerOnThisTab = true;
  showScreen('call-screen');
  joinDailyRoom();
  await clearMissedCallsForMember(activeFamilyMember.id);
  await set(callStateRef, { status: 'connected', callerId: 'nana', targetId: activeFamilyMember.id, timestamp: Date.now() });
};

window.startCallFromFamily = async () => {
  unlockCallAudio();
  if (!tabletSettings.callingEnabled) {
    alert("Video calling is currently switched off.");
    return;
  }
  if (!confirm("Ring Nana's tablet now?")) return;
  didManuallyInitiateOrAnswerOnThisTab = true;
  const ringBtn = document.getElementById('family-ring-btn');
  if (ringBtn) ringBtn.disabled = true;

  try {
    const result = await runTransaction(callStateRef, (current) => {
      const isStale = current?.timestamp && (Date.now() - current.timestamp > 90000);
      if (current && current.status !== 'idle' && !isStale) return;
      return { status: 'ringing_nana', callerId: activeFamilyMember.id, targetId: 'nana', timestamp: Date.now() };
    });

    if (!result.committed) {
      alert("Nana's tablet is currently busy on another call.");
      if (ringBtn) ringBtn.disabled = false;
      return;
    }

    showScreen('call-screen');
    const banner = document.getElementById('call-connecting-banner');
    if (banner) { banner.style.display = 'block'; banner.innerText = '🔔 Ringing Nana... Waiting for her to answer...'; }
  } catch (e) {
    if (ringBtn) ringBtn.disabled = !tabletSettings.callingEnabled;
  }
};

window.answerCallAsNana = async () => {
  unlockCallAudio();
  didManuallyInitiateOrAnswerOnThisTab = true;
  clearTimeout(autoAnswerTimeout);
  stopRingingUI();
  showScreen('call-screen');
  joinDailyRoom();
  const activeCallerId = latestCallData?.callerId;
  if (activeCallerId && activeCallerId !== 'nana') await clearMissedCallsForMember(activeCallerId);
  await set(callStateRef, { status: 'connected', callerId: activeCallerId || 'family', targetId: 'nana', timestamp: Date.now() });
};

window.endCall = async () => {
  clearTimeout(outboundTimeout);
  clearTimeout(incomingRingTimeout);
  clearTimeout(autoAnswerTimeout);
  stopTelegramRingBurst();
  stopRingingUI();
  const ringBtn = document.getElementById('family-ring-btn');
  if (ringBtn) ringBtn.disabled = !tabletSettings.callingEnabled;
  await set(callStateRef, { status: 'idle', timestamp: Date.now() });
  await destroyDailyRoom();
  showScreen(role === 'family' ? 'family-screen' : 'grid-screen');
};

window.requestTabletReload = async () => {
  const btn = document.getElementById('remote-refresh-btn');
  try {
    await set(reloadCmdRef, Date.now());
    if (btn) { btn.innerText = '✅ Sent!'; setTimeout(() => { btn.innerText = '🔄 Refresh Now'; }, 3000); }
  } catch (e) {}
};

if (role === 'nana') {
  let reloadPending = false;
  const tryReload = () => {
    if (reloadPending && !['connected', 'ringing_nana', 'calling_family'].includes(currentState)) {
      if (window.AndroidBridge?.clearCacheAndReload) window.AndroidBridge.clearCacheAndReload();
      else window.location.reload(true);
    }
  };
  onValue(reloadCmdRef, (snap) => {
    const val = Number(snap.val() || 0);
    if (!val) return;
    const last = localStorage.getItem('nana_last_reload_cmd');
    localStorage.setItem('nana_last_reload_cmd', String(val));
    if (last !== null && val > Number(last)) { reloadPending = true; tryReload(); }
  });
  setInterval(tryReload, 5000);
}

onValue(callStateRef, (snap) => {
  const data = snap.val();
  if (!data) return;
  latestCallData = data;
  currentState = data.status;

  if (role === 'nana' && settingsLoaded && !tabletSettings.callingEnabled && data.status !== 'idle') {
    enforceCallingOff();
    return;
  }
  if (role === 'family') updateFamilyPresenceBanner();

  if (data.status !== 'idle') {
    document.getElementById('bulletin-modal').style.display = 'none';
    window.closeSeniorKeyboard();
    if (role === 'nana' && isRadioPlaying) window.stopRadioAndSync(true);
  }

  if (role === 'nana') {
    const shouldActAsNanaDevice = isRealAndroidTablet || TEST_MODE || didManuallyInitiateOrAnswerOnThisTab;

    if (data.status === 'ringing_nana') {
      const caller = CONFIG.familyMembers.find(m => m.id === data.callerId) || CONFIG.familyMembers[0];
      if (isRealAndroidTablet && isCurrentlyInNightWindow() && tabletSettings.nightBlockCalls) {
        incrementMissedCallForMember(caller.id);
        endCall();
        return;
      }

      document.getElementById('night-dimmer').style.display = 'none';
      wakeScreenAndResetDimTimer();
      const callerImg = document.getElementById('caller-photo');
      callerImg.onerror = () => { callerImg.src = caller.fallback; };
      callerImg.src = caller.photo;
      document.getElementById('caller-title').innerText = `${caller.name} is calling!`;
      showScreen('ringing-screen');

      stopRingingUI();
      if (shouldActAsNanaDevice) {
        playSelectedRingtoneAudio(tabletSettings.ringtone, tabletSettings.ringVolume || 85);
        if (tabletSettings.autoAnswer) {
          speakMsg(`${caller.spokenName} is calling you. Connecting automatically.`);
          clearTimeout(autoAnswerTimeout);
          autoAnswerTimeout = setTimeout(() => { if (currentState === 'ringing_nana') window.answerCallAsNana(); }, 10000);
        } else {
          speakMsg(`${caller.spokenName} is calling you. Touch anywhere on the screen to answer.`);
        }
        ringInterval = setInterval(() => {
          playSelectedRingtoneAudio(tabletSettings.ringtone, tabletSettings.ringVolume || 85);
          speakMsg(`${caller.spokenName} is calling you.`);
        }, 6000);

        clearTimeout(incomingRingTimeout);
        incomingRingTimeout = setTimeout(async () => {
          if (currentState === 'ringing_nana') {
            await incrementMissedCallForMember(caller.id);
            await endCall();
          }
        }, (Number(tabletSettings.ringDurationSec) || 60) * 1000);
      }
    } else if (data.status === 'connected') {
      document.getElementById('night-dimmer').style.display = 'none';
      wakeScreenAndResetDimTimer();
      clearTimeout(outboundTimeout);
      clearTimeout(incomingRingTimeout);
      clearTimeout(autoAnswerTimeout);
      stopTelegramRingBurst();
      stopRingingUI();

      const connectedPartnerId = data.callerId === 'nana' ? data.targetId : data.callerId;
      if (connectedPartnerId && shouldActAsNanaDevice) clearMissedCallsForMember(connectedPartnerId);

      if (shouldActAsNanaDevice) {
        showScreen('call-screen');
        joinDailyRoom();
      } else {
        showScreen('grid-screen');
      }
    } else if (data.status === 'idle') {
      clearTimeout(outboundTimeout);
      clearTimeout(incomingRingTimeout);
      clearTimeout(autoAnswerTimeout);
      stopTelegramRingBurst();
      stopRingingUI();
      destroyDailyRoom();
      if (!isRadioPlaying) showScreen('grid-screen');
      wakeScreenAndResetDimTimer();
      updateClock();
    }
  } else if (role === 'family') {
    const isMyCall = (data.callerId === activeFamilyMember.id || data.targetId === activeFamilyMember.id);
    if (data.status === 'calling_family' && data.targetId === activeFamilyMember.id) {
      showScreen('family-pickup-screen');
    } else if (data.status === 'connected' && isMyCall) {
      showScreen('call-screen');
      joinDailyRoom();
    } else if (data.status === 'idle' || !isMyCall) {
      destroyDailyRoom();
      showScreen('family-screen');
    }
  }
});

function stopRingingUI() {
  if (ringInterval) { clearInterval(ringInterval); ringInterval = null; }
  if ('speechSynthesis' in window) window.speechSynthesis.cancel();
  if (activeMp3Ringtone) {
    activeMp3Ringtone.pause();
    activeMp3Ringtone.currentTime = 0;
    activeMp3Ringtone = null;
  }
}

function speakMsg(text, isBatteryAlert = false) {
  if (!tabletSettings.voicePrompts) return;
  if ((isBatteryAlert || /battery|charger|plug|power/i.test(text)) && isBatteryVoiceCurrentlyMuted()) return;
  if ('speechSynthesis' in window && text) {
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.rate = Number(tabletSettings.speechRate) || 0.9;
    window.speechSynthesis.speak(u);
  }
}

// ========================================================================
// INITIALIZATION
// ========================================================================
if (role === 'family') {
  document.getElementById('family-greeting').innerText = `Call Nana (as ${activeFamilyMember.name})`;
  const selfImg = document.getElementById('family-self-photo');
  selfImg.onerror = () => { selfImg.src = activeFamilyMember.fallback; };
  selfImg.src = activeFamilyMember.photo;
  document.getElementById('in-call-volume-bar').style.display = 'flex';
  document.getElementById('telegram-link-btn').href = `https://t.me/${CONFIG.telegramBotUsername}?start=${activeFamilyMember.id}`;

  // Only show ⚙️ Controls button to Ryan
  const ctrlBtn = document.getElementById('family-controls-btn');
  const inCallCtrlBtn = document.getElementById('in-call-settings-btn');
  if (ctrlBtn) ctrlBtn.style.display = isAdminFamilyMember ? 'inline-block' : 'none';
  if (inCallCtrlBtn) inCallCtrlBtn.style.display = isAdminFamilyMember ? 'inline-block' : 'none';

  window.syncConnectedFamilyFromTelegram();

  if (autoAnswerFromTelegram) {
    window.history.replaceState({}, document.title, `${window.location.pathname}?role=family&id=${encodeURIComponent(activeFamilyMember.id)}&key=${encodeURIComponent(SERVICE_TOKEN)}&answer=true${TEST_MODE ? '&test=1' : ''}`);
    showScreen('family-pickup-screen');
  } else {
    showScreen('family-screen');
  }
} else {
  renderContacts(connectedMemberIds);
  renderSeniorKeyboardLayout();
  window.syncConnectedFamilyFromTelegram();
  showScreen('grid-screen');
  setInterval(updateClock, 10000);
  updateClock();
  wakeScreenAndResetDimTimer();
}
