import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getDatabase, ref, set, update, push, onValue, remove, runTransaction, query, limitToLast } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js";

const APP_VERSION = "2.9.1";
const $ = (id) => document.getElementById(id);

(function versionGuard() {
  const pageV = window.__NANA_PAGE_VERSION;
  if (pageV && pageV !== APP_VERSION) {
    if (!sessionStorage.getItem('nana_vguard')) {
      sessionStorage.setItem('nana_vguard', '1');
      const u = new URL(window.location.href);
      u.searchParams.set('r', String(Date.now()));
      window.location.replace(u.toString());
      throw new Error('Version mismatch');
    }
  } else sessionStorage.removeItem('nana_vguard');
})();
window.__nanaAppLoaded = true;

// --- ZERO-KNOWLEDGE SHA-256 VERIFICATION (No Plaintext Secrets in Repo) ---
const EXPECTED_KEY_HASH = "d497b848f0915364d299c002495232b7c32a9992023309d31100fb56267b604e"; // SHA-256("nana-v2-salt:" + familySecret)
const EXPECTED_PIN_HASH = "b3560b47fb827ce8f069b2f7bc40fa9db204d9e898c0bb7bc7875fa6e73fa2e0"; // SHA-256("nana-pin-salt:" + adminPin)

async function sha256Hex(str) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(str));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, "0")).join("");
}

window.submitManualKey = () => {
  const val = ($('manual-key-input')?.value || '').trim();
  if (val) {
    localStorage.setItem('nana_service_token', val);
    window.location.reload();
  }
};

const params = new URLSearchParams(window.location.search);
if (params.get('key')) {
  localStorage.setItem('nana_service_token', params.get('key').trim());
  // Scrub the secret key from the visible URL bar so it isn't leaked via screenshots/referrers
  const cleanUrl = new URL(window.location.href);
  cleanUrl.searchParams.delete('key');
  window.history.replaceState({}, document.title, cleanUrl.pathname + cleanUrl.search);
}

const SERVICE_TOKEN = (localStorage.getItem('nana_service_token') || '').trim();
const TEST_MODE = params.get('test') === '1';
const role = params.get('role') || 'nana';
const callerId = (params.get('id') || 'ryan').toLowerCase();
const autoAnswerFromTelegram = params.get('answer') === 'true';
const isRealAndroidTablet = !!(window.AndroidBridge || /Lenovo|TB-|Tab/i.test(navigator.userAgent));

document.body.classList.add(role === 'nana' ? 'role-nana' : 'role-family');
function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  $(id)?.classList.add('active');
}

const computedKeyHash = SERVICE_TOKEN ? await sha256Hex("nana-v2-salt:" + SERVICE_TOKEN) : "";
if (computedKeyHash !== EXPECTED_KEY_HASH) {
  localStorage.removeItem('nana_service_token');
  showScreen('auth-error-screen');
  throw new Error("Unauthorized: Valid access key required.");
}

// Derive unguessable Firebase path & Daily room name from the verified hash
const PORTAL_NODE_ID = `nana_${computedKeyHash.slice(0, 24)}`;
const DERIVED_DAILY_ROOM = `NanaPhone_${computedKeyHash.slice(0, 12)}`;

const mkMember = (id, name, spokenName, av, bg) => ({
  id, name, spokenName, photo: `photos/${id}.jpg`,
  fallback: `https://ui-avatars.com/api/?name=${av}&size=256&background=${bg}&color=fff&bold=true`
});

const CONFIG = {
  appVersion: APP_VERSION, apkFileName: "nanaphone.apk",
  dailyRoomUrl: "https://nanaphone.daily.co/" + (params.get('room') || DERIVED_DAILY_ROOM),
  telegramBotUsername: "Nanaphone_Bot",
  googleScriptUrl: "https://script.google.com/macros/s/AKfycbwsFHE8oyj1RBGxLJT79bbPsvJ2hTkVrF9dCoj369ApEREXyrdQKE_vA0QrobBOeLE2/exec",
  firebase: { databaseURL: "https://nanaphone-f644b-default-rtdb.europe-west1.firebasedatabase.app" },
  familyMembers: [
    mkMember("phil", "Phil", "Phil", "Phil", "1d4ed8"),
    mkMember("nicky-s", "Nicky S", "Nicky", "NS", "be185d"),
    mkMember("denise", "Denise", "Denise", "Denise", "047857"),
    mkMember("gill", "Gill", "Gill", "Gill", "b45309"),
    mkMember("ryan", "Ryan", "Ryan", "Ryan", "4338ca"),
    mkMember("nicola-p", "Nicola P", "Nicola", "NP", "0e7490"),
    mkMember("zara", "Zara", "Zara", "Zara", "6d28d9"),
    mkMember("megan", "Megan", "Megan", "Megan", "be123c")
  ]
};

const CLASSIC_FM_STREAM = "https://media-ice.musicradio.com/ClassicFMMP3";
const SILENT_WAV = "data:audio/wav;base64,UklGRigAAABXQVZFZm10IBIAAAABAAEARKwAAIhYAQACABAAAABkYXRhAgAAAAEA";
const activeFamilyMember = CONFIG.familyMembers.find(m => m.id === callerId) || CONFIG.familyMembers[4];
const isAdminFamilyMember = (role === 'family' && activeFamilyMember.id === 'ryan');

// Build Supervisor PIN keypad & Shared Settings Cards dynamically
(function buildDynamicControls() {
  const kp = $('pin-keypad-grid');
  if (kp) {
    ['1','2','3','4','5','6','7','8','9','CLR','0','✖'].forEach(k => {
      const b = document.createElement('button');
      b.className = 'key-btn';
      if (k === 'CLR') { b.style.background = '#7f1d1d'; b.onclick = () => window.clearPinDigits(); }
      else if (k === '✖') { b.style.background = '#334155'; b.onclick = () => window.closeAdminPinModal(); }
      else b.onclick = () => window.pressPinDigit(k);
      b.textContent = k;
      kp.appendChild(b);
    });
  }

  const sc = $('shared-settings-cards');
  if (!sc) return;
  const optBtns = (key, pairs, fn = 'updateSetting') => pairs.map(([val, lbl]) =>
    `<button class="opt-btn" data-skey="${key}" data-sval="${val}" onclick="${fn}('${key}', ${typeof val === 'string' ? `'${val}'` : val})">${lbl}</button>`
  ).join('');

  sc.innerHTML = `
    <div class="settings-card">
      <div class="settings-label"><span>📞 Video Calling on Nana's Tablet</span><span class="calling-status-lbl" style="font-size:0.95rem;"></span></div>
      <div class="opt-row">
        <button class="opt-btn calling-off-btn" onclick="setCallingEnabled(false)">📵 Turn OFF (hide)</button>
        <button class="opt-btn calling-on-btn" onclick="setCallingEnabled(true)">✅ Turn ON</button>
      </div>
    </div>
    <div class="settings-card" id="test-links-card">
      <div class="settings-label"><span>🧪 Test Calls Without Nana</span></div>
      <div class="settings-sub">Practice calls in a private sandbox without ringing Nana's tablet.</div>
      <div class="opt-row">
        <button class="opt-btn" onclick="copyTestLink('nana')">📋 Copy "Pretend Nana" link</button>
        <button class="opt-btn" onclick="copyTestLink('family')">📋 Copy "Me" link</button>
      </div>
    </div>
    <div class="settings-card">
      <div class="settings-label"><span>🔄 Refresh Nana's Tablet</span></div>
      <div class="opt-row"><button class="opt-btn" id="remote-refresh-btn" onclick="requestTabletReload()">🔄 Refresh Now</button></div>
    </div>
    <div class="settings-card">
      <div class="settings-label"><span>🎨 High-Contrast Visibility Theme</span></div>
      <div class="opt-row">${optBtns('colorTheme', [['classic-dark','🌙 Classic Dark'],['yellow-black','👁️ Yellow on Black'],['white-black','🤍 White on Black'],['black-cream','☀️ Black on Cream']])}</div>
    </div>
    <div class="settings-card">
      <div class="settings-label"><span>⌨️ Nana's Keyboard Layout & Auto-Hide</span><span class="lbl-kb-summary" style="color:#38bdf8;font-size:0.95rem;">QWERTY • 1m</span></div>
      <div class="opt-row" style="margin-bottom:8px;">${optBtns('keyboardLayout', [['qwerty','⌨️ QWERTY Layout'],['abcdef','🔤 ABCDEF Layout']])}</div>
      <div class="settings-sub" style="margin-bottom:4px;">Hide Keyboard After Inactivity:</div>
      <div class="opt-row">${optBtns('keyboardTimeoutSec', [[30,'30s'],[60,'1m'],[120,'2m'],[180,'3m']])}</div>
      <div class="settings-sub" style="margin:8px 0 4px 0;">🖐️ Same-Key Repeat Guard (ignores accidental double-taps on the same letter):</div>
      <div class="opt-row">${optBtns('keyGuardMs', [[0,'Off'],[350,'Normal'],[600,'Strong'],[900,'Max']])}</div>
    </div>
    <div class="settings-card">
      <div class="settings-label"><span>🔆 Screen Brightness & Idle Dimming</span><span class="lbl-bright-summary" style="color:#38bdf8;font-size:0.95rem;">85% ➔ 15% (2m)</span></div>
      <div class="settings-sub" style="margin-bottom:4px;">Normal (Awake) Brightness:</div>
      <div class="opt-row" style="margin-bottom:8px;">${optBtns('awakeBrightness', [[40,'40%'],[60,'60%'],[85,'85%'],[100,'100%']])}</div>
      <div class="settings-sub" style="margin-bottom:4px;">Dimmed Brightness Level (Idle on Home, Chat & Radio):</div>
      <div class="opt-row" style="margin-bottom:8px;">${optBtns('dimBrightness', [[5,'5% (Dark)'],[15,'15% (Soft)'],[30,'30% (Low)'],[50,'50% (Med)']])}</div>
      <div class="settings-sub" style="margin-bottom:4px;">Time Until Dimming Happens:</div>
      <div class="opt-row">${optBtns('dimDelaySec', [[30,'30s'],[60,'1m'],[120,'2m'],[300,'5m'],[600,'10m'],[0,'Never']])}</div>
    </div>
    <div class="settings-card">
      <div class="settings-label"><span>🔊 Separate Call, Radio & Ring Volumes</span><span class="lbl-vol-summary" style="color:#38bdf8;font-size:0.92rem;"></span></div>
      <div class="settings-sub" style="margin-bottom:4px;">📹 Video Call Voice Volume:</div>
      <div class="opt-row" style="margin-bottom:8px;">${optBtns('callVolume', [[30,'30%'],[50,'50%'],[70,'70%'],[85,'85%'],[100,'100%']])}</div>
      <div class="settings-sub" style="margin-bottom:4px;">🎻 Classic FM Radio Volume:</div>
      <div class="opt-row" style="margin-bottom:8px;">${optBtns('radioVolume', [[25,'25%'],[45,'45%'],[60,'60%'],[75,'75%'],[90,'90%'],[100,'100%']])}</div>
      <div class="settings-sub" style="margin-bottom:4px;">🔔 Incoming Call Ringing Volume:</div>
      <div class="opt-row">${optBtns('ringVolume', [[30,'30%'],[50,'50%'],[70,'70%'],[85,'85%'],[100,'100%']])}</div>
    </div>
    <div class="settings-card">
      <div class="settings-label"><span>🌙 Do Not Disturb (Night Mode)</span><span class="lbl-night-window" style="color:#38bdf8;">21:00 – 08:00</span></div>
      <div class="opt-row" style="margin-bottom:8px;">
        ${optBtns('nightModeEnabled', [[true,'🌙 Night Mode ON'],[false,'☀️ Always Awake']])}
        <button class="opt-btn" data-skey="nightBlockCalls" data-sval="true" onclick="toggleSetting('nightBlockCalls')">🔕 Block Night Rings</button>
      </div>
      <div class="settings-sub" style="margin-bottom:4px;">Evening Start Time:</div>
      <div class="opt-row" style="margin-bottom:8px;">${optBtns('nightStartHour', [[20,'20:00'],[21,'21:00'],[22,'22:00'],[23,'23:00']])}</div>
      <div class="settings-sub" style="margin-bottom:4px;">Morning Wake Time:</div>
      <div class="opt-row">${optBtns('nightEndHour', [[6,'06:00'],[7,'07:00'],[8,'08:00'],[9,'09:00']])}</div>
    </div>
    <div class="settings-card">
      <div class="settings-label"><span>🧹 Missed Calls & Battery Voice Mute</span></div>
      <div class="settings-sub lbl-battery-mute">Battery Voice Status: Active</div>
      <div class="opt-row" style="margin-bottom:8px;">
        <button class="opt-btn" style="background:#dc2626;border-color:#fff;color:#fff;" onclick="clearAllMissedCalls()">🧹 Clear Missed Calls</button>
        <button class="opt-btn" onclick="muteBatteryVoiceForHours(0)">🔊 Unmute Battery Voice</button>
      </div>
      <div class="opt-row">
        ${[1,4,12,24].map(h => `<button class="opt-btn" onclick="muteBatteryVoiceForHours(${h})">🔇 ${h}h</button>`).join('')}
      </div>
    </div>
    <div class="settings-card">
      <div class="settings-label"><span>💬 Family Notes Alert Bar & Read Aloud</span></div>
      <div class="opt-row" style="margin-bottom:6px;">
        ${optBtns('showBulletinBar', [[true,'💬 Show Alert Bar'],[false,'🙈 Hide Alert Bar']])}
        <button class="opt-btn" style="background:#0284c7;border-color:#fff;color:#fff;" onclick="dismissCurrentBulletinBar(true)">🧹 Mark Read</button>
      </div>
      <div class="opt-row">${optBtns('showReadAloud', [[false,'🙈 Hide "Read Aloud"'],[true,'🔊 Show "Read Aloud"']])}</div>
    </div>
    <div class="settings-card">
      <div class="settings-label"><span>🎵 Nana's Ringtone, Auto-Answer & Duration</span></div>
      <div class="opt-row" style="margin-bottom:8px;">
        ${[['uk-phone','☎️ Phone'],['westminster','🕰️ Chime'],['marimba','🎵 Marimba'],['bell','🔔 Bell'],['nana_song1.mp3','🎶 Song 1'],['nana_song2.mp3','🎶 Song 2']].map(([t,l]) => `<button class="opt-btn" data-skey="ringtone" data-sval="${t}" onclick="previewAndSetTone('${t}')">${l}</button>`).join('')}
      </div>
      <div class="opt-row" style="margin-bottom:8px;">
        ${optBtns('autoAnswer', [[false,'👆 Tap to Answer'],[true,'⚡ Auto-Answer (10s)']])}
        ${optBtns('voicePrompts', [[true,'🗣️ Voice ID On'],[false,'🔇 Voice ID Off']])}
      </div>
      <div class="opt-row">${optBtns('ringDurationSec', [[30,'30s'],[45,'45s'],[60,'60s'],[90,'90s'],[120,'2m']])}</div>
    </div>
    <div class="settings-card">
      <div class="settings-label"><span>🔧 Telegram Bot Sync & Webhook</span><span id="lbl-sync-status" style="font-size:0.9rem;color:#38bdf8;"></span></div>
      <button class="opt-btn" style="width:100%;background:#0284c7;border-color:#38bdf8;color:#fff;" onclick="forceWebhookAndMemberSync()">🔄 Flush Telegram Queue & Sync Contacts Now</button>
    </div>
  `;
})();

if (TEST_MODE) {
  const realFetch = window.fetch.bind(window);
  window.fetch = (url, opts) => String(url).startsWith(CONFIG.googleScriptUrl)
    ? Promise.resolve(new Response(JSON.stringify({ ok: true, messageId: null, connected: CONFIG.familyMembers.map(m => m.id), groupChatId: null, broadcastCount: 0, test: true }), { headers: { 'Content-Type': 'application/json' } }))
    : realFetch(url, opts);
  const r = document.createElement('div');
  r.innerText = '🧪 TEST MODE - separate from Nana\'s real tablet';
  r.style.cssText = 'position:fixed;top:0;left:0;z-index:99999;background:#7c3aed;color:#fff;font:700 12px sans-serif;padding:3px 10px;border-bottom-right-radius:10px;pointer-events:none;';
  document.body.appendChild(r);
}

(function initDisplayAdapters() {
  const stylesV = (getComputedStyle(document.documentElement).getPropertyValue('--nana-styles-version') || '').replace(/["'\s]/g, '') || '?';
  const pageV = window.__NANA_PAGE_VERSION || '?';
  const allMatch = (pageV === APP_VERSION && stylesV === APP_VERSION);
  const txt = `Page ${pageV} | App ${APP_VERSION} | Styles ${stylesV}${allMatch ? '' : ' ⚠️ MISMATCH'}`;
  document.querySelectorAll('.file-versions-line').forEach(e => { e.innerText = txt; e.style.color = allMatch ? '#94a3b8' : '#fbbf24'; });
  document.querySelectorAll('.gear-pill').forEach(e => { e.innerText = `⚙️ v${APP_VERSION}${allMatch ? '' : ' ⚠️'}`; });

  const rv = $('remote-video');
  if (rv) {
    const apply = () => {
      if (!rv.videoWidth || !rv.videoHeight) return;
      const vAsp = rv.videoWidth / rv.videoHeight;
      const sAsp = (rv.clientWidth || window.innerWidth) / (rv.clientHeight || window.innerHeight);
      rv.style.objectFit = (Math.abs(vAsp / sAsp - 1) < 0.2) ? 'cover' : 'contain';
    };
    ['loadedmetadata', 'resize'].forEach(ev => rv.addEventListener(ev, apply));
    window.addEventListener('resize', apply);
  }

  $('call-screen')?.addEventListener('pointerdown', () => {
    if (audioCtx?.state === 'suspended') audioCtx.resume();
    const ra = $('remote-audio');
    if (ra?.srcObject) { ra.muted = false; ra.play().catch(() => {}); }
    if (rv?.srcObject && rv.paused) rv.play().catch(() => {});
  }, { passive: true });
})();

const app = initializeApp(CONFIG.firebase);
const db = getDatabase(app);
const basePath = TEST_MODE ? `portals/${PORTAL_NODE_ID}__test` : `portals/${PORTAL_NODE_ID}`;
const callStateRef = ref(db, `${basePath}/callState`);
const presenceRef = ref(db, `${basePath}/presence`);
const bulletinRef = ref(db, `${basePath}/bulletin`);
const settingsRef = ref(db, `${basePath}/settings`);
const missedCallsMapRef = ref(db, `${basePath}/missedCalls`);
const connectedMembersRef = ref(db, `${basePath}/connectedMembers`);
const hiddenRef = ref(db, `${basePath}/hiddenContacts`);
const entertainmentRef = ref(db, `${basePath}/entertainment`);
const reloadCmdRef = ref(db, `${basePath}/commands/reloadAt`);

if (TEST_MODE) set(connectedMembersRef, CONFIG.familyMembers.map(m => m.id)).catch(() => {});

let callObject = null, isJoiningOrInRoom = false, didManuallyInitiateOrAnswerOnThisTab = false;
let currentFacingMode = 'user', isRadioPlaying = false, latestEntState = { activeKey: "off", title: "Off" };
let pendingCallContact = null, missedCallsByMember = {}, latestBulletinPosts = {}, unreadBulletinCount = 0;
let chatSessionReadCutoff = null, confirmTimer = null, ringInterval = null, telegramBurstInterval = null;
let lastTelegramMsgId = null, currentDialedMember = null, outboundTimeout = null, incomingRingTimeout = null;
let autoAnswerTimeout = null, idleDimTimer = null, keyboardHideTimer = null, lastKeyTapMs = 0, lastKeyChar = null;
let lastChatSendMs = 0, lastHeartbeatWriteMs = 0, lastRenderedKbLayout = null, lastRenderedReadAloud = null;
let settingsLoaded = false, latestHidden = {}, currentState = 'idle', latestCallData = { status: 'idle' };
let latestPresenceData = {}, connectedMemberIds = [], enteredPin = "", nightDismissedUntilMs = 0, lastBatterySpokenMs = 0;

const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
let activeMp3Ringtone = null;
const radioPlayer = $('nana-radio-stream');

let tabletSettings = {
  callVolume: 85, radioVolume: 75, ringVolume: 85, ringDurationSec: 60, ringtone: 'uk-phone',
  voicePrompts: true, autoAnswer: false, speechRate: 0.9, awakeBrightness: 85, dimBrightness: 15,
  dimDelaySec: 120, nightModeEnabled: true, nightStartHour: 21, nightEndHour: 8, nightBlockCalls: false,
  batteryVoiceMutedUntil: 0, showBulletinBar: true, showReadAloud: false, colorTheme: 'classic-dark',
  keyboardLayout: 'qwerty', keyboardTimeoutSec: 60, keyGuardMs: 350, bulletinClearedAt: 0, callingEnabled: TEST_MODE
};

function applyScreenBrightness(targetPercent) {
  if (role !== 'nana') return;
  const pct = Math.max(5, Math.min(100, Number(targetPercent) || 85));
  const overlay = $('brightness-overlay');
  if (overlay) {
    overlay.style.opacity = Math.max(0, Math.min(0.88, (100 - pct) / 105)).toFixed(2);
    overlay.style.pointerEvents = pct < (tabletSettings.awakeBrightness ?? 85) ? 'auto' : 'none';
  }
  const activeVol = currentState === 'connected' ? Number(tabletSettings.callVolume ?? 85) : (isRadioPlaying ? Number(tabletSettings.radioVolume ?? 75) : Number(tabletSettings.ringVolume ?? 85));
  window.AndroidBridge?.updateTabletHardwareSettings?.(activeVol, pct, Number(tabletSettings.dimDelaySec ?? 120), Number(tabletSettings.speechRate) || 0.9);
}

window.wakeScreenAndResetDimTimer = function () {
  if (role !== 'nana') return;
  applyScreenBrightness(tabletSettings.awakeBrightness ?? 85);
  clearTimeout(idleDimTimer);
  const delaySec = Number(tabletSettings.dimDelaySec ?? 120);
  if (delaySec > 0 && currentState === 'idle') {
    idleDimTimer = setTimeout(() => {
      if (currentState === 'idle') { window.closeSeniorKeyboard(); applyScreenBrightness(tabletSettings.dimBrightness ?? 15); }
    }, delaySec * 1000);
  }
};

function isCurrentlyInNightWindow() {
  if (!tabletSettings.nightModeEnabled) return false;
  const h = new Date().getHours(), s = Number(tabletSettings.nightStartHour ?? 21), e = Number(tabletSettings.nightEndHour ?? 8);
  return s > e ? (h >= s || h < e) : (h >= s && h < e);
}

function updateClock() {
  const t = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  if ($('clock')) $('clock').innerText = t;
  if ($('night-clock')) $('night-clock').innerText = t;
  if ($('night-dimmer')) $('night-dimmer').style.display = (isCurrentlyInNightWindow() && currentState === 'idle' && Date.now() > nightDismissedUntilMs) ? 'flex' : 'none';
}

window.wakeFromNightMode = () => {
  nightDismissedUntilMs = Date.now() + 15 * 60 * 1000;
  $('night-dimmer').style.display = 'none';
  window.wakeScreenAndResetDimTimer();
};

const isBatteryVoiceCurrentlyMuted = () => (Number(tabletSettings.batteryVoiceMutedUntil) || 0) > Date.now();
window.muteBatteryVoiceForHours = async (hours) => {
  const mutedUntil = hours > 0 ? (Date.now() + hours * 3600 * 1000) : 0;
  tabletSettings.batteryVoiceMutedUntil = mutedUntil;
  window.speechSynthesis?.cancel();
  window.AndroidBridge?.muteBatteryVoiceForMinutes?.(hours * 60);
  refreshSettingsUI();
  await update(settingsRef, { batteryVoiceMutedUntil: mutedUntil });
};

window.announceBatteryWarning = (text) => {
  if (isBatteryVoiceCurrentlyMuted() || (Date.now() - lastBatterySpokenMs < 180000)) return;
  lastBatterySpokenMs = Date.now();
  speakMsg(text, true);
};

const incrementMissedCallForMember = (id) => runTransaction(ref(db, `${basePath}/missedCalls/${id}`), cur => ({ count: (Number(cur?.count) || 0) + 1, timestamp: Date.now() }));
const clearMissedCallsForMember = (id) => id ? remove(ref(db, `${basePath}/missedCalls/${id}`)) : null;
window.clearAllMissedCalls = async () => { await remove(missedCallsMapRef); missedCallsByMember = {}; renderMissedCallsBanner(); if (role === 'nana') renderContacts(connectedMemberIds); };

onValue(missedCallsMapRef, snap => {
  missedCallsByMember = snap.val() || {};
  renderMissedCallsBanner();
  if (role === 'nana') renderContacts(connectedMemberIds);
});

function renderMissedCallsBanner() {
  const banner = $('missed-call-banner'), chips = $('missed-chips-container');
  if (!banner || !chips) return;
  chips.innerHTML = "";
  const entries = Object.entries(missedCallsByMember).filter(([, v]) => v?.count > 0).sort((a, b) => (b[1].timestamp || 0) - (a[1].timestamp || 0));
  if (!entries.length) { banner.style.display = 'none'; return; }
  entries.forEach(([id, info]) => {
    const m = CONFIG.familyMembers.find(x => x.id === id);
    if (!m) return;
    const t = info.timestamp ? new Date(info.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
    const btn = document.createElement('button');
    btn.className = 'missed-chip-btn';
    btn.innerText = `📞 Call ${m.name} (${info.count}${t ? ' • ' + t : ''})`;
    btn.onclick = () => startCallFromNana(m);
    chips.appendChild(btn);
  });
  banner.style.display = 'flex';
}

// Chat & Senior Keyboard
function syncChatInputDisplay() {
  const input = $('nana-chat-input'), typed = $('nana-chat-typed'), ph = $('nana-chat-placeholder'), box = $('nana-chat-display');
  if (!input || !typed || !ph) return;
  const val = input.value || "", kbOpen = $('bulletin-modal')?.classList.contains('kb-fullscreen');
  ph.style.display = (!val.length && !kbOpen) ? 'inline' : 'none';
  typed.textContent = val.replace(/ /g, '\u00A0');
  if (box) box.scrollLeft = box.scrollWidth;
}

window.dismissCurrentBulletinBar = async (force = false) => {
  if (role !== 'nana' && !force) return;
  const now = Date.now();
  tabletSettings.bulletinClearedAt = now; chatSessionReadCutoff = now;
  updateBulletinTickerVisibility();
  $('first-unread-divider')?.remove();
  document.querySelectorAll('.tg-bubble.unread-msg').forEach(b => b.classList.remove('unread-msg'));
  document.querySelectorAll('.tg-new-tag').forEach(t => t.remove());
  await update(settingsRef, { bulletinClearedAt: now });
};

function updateBulletinTickerVisibility() {
  const bar = $('message-ticker-bar'), badge = $('chat-unread-badge'), clearedAt = Number(tabletSettings.bulletinClearedAt) || 0;
  unreadBulletinCount = Object.values(latestBulletinPosts).filter(p => !p.fromNana && (Number(p.timestamp) || 0) > clearedAt).length;
  const hasUnread = unreadBulletinCount > 0;
  if (bar) bar.style.display = (tabletSettings.showBulletinBar !== false && hasUnread) ? 'flex' : 'none';
  if (badge) { badge.innerText = unreadBulletinCount > 9 ? '9+' : `${unreadBulletinCount} NEW`; badge.style.display = hasUnread ? 'inline-block' : 'none'; }
}

function renderSeniorKeyboardLayout() {
  const container = $('senior-kb-letters-container');
  if (!container) return;
  const layout = tabletSettings.keyboardLayout || 'qwerty';
  lastRenderedKbLayout = layout;
  const rows = layout === 'abcdef'
    ? [['A','B','C','D','E','F','G','H','I','J'], ['K','L','M','N','O','P','Q','R','S','T'], ['U','V','W','X','Y','Z']]
    : [['Q','W','E','R','T','Y','U','I','O','P'], ['A','S','D','F','G','H','J','K','L'], ['Z','X','C','V','B','N','M']];
  container.innerHTML = '';
  const buildRow = (letters, cols, extra = '') => {
    const r = document.createElement('div');
    r.className = 'kb-row-grid';
    r.style.cssText = `display:grid;grid-template-columns:repeat(${cols},1fr);gap:10px;${extra}`;
    letters.forEach(l => {
      const b = document.createElement('button');
      b.className = 'kb-letter-btn'; b.textContent = l;
      b.onpointerdown = (ev) => window.typeSeniorKey(l, ev);
      r.appendChild(b);
    });
    return r;
  };
  container.appendChild(buildRow(rows[0], 10));
  container.appendChild(buildRow(rows[1], layout === 'abcdef' ? 10 : 9, layout === 'abcdef' ? '' : 'padding:0 22px;'));
  const r3 = buildRow(rows[2], 9);
  const del = document.createElement('button');
  del.className = 'kb-letter-btn';
  del.style.cssText = `background:#7f1d1d;color:#fff;grid-column:span ${layout === 'abcdef' ? 3 : 2};border-color:#f87171;`;
  del.textContent = '⌫ Delete';
  del.onpointerdown = (ev) => window.typeSeniorKey('BACKSPACE', ev);
  r3.appendChild(del);
  container.appendChild(r3);
}

function resetKeyboardAutoHideTimer() {
  clearTimeout(keyboardHideTimer);
  const sec = Number(tabletSettings.keyboardTimeoutSec ?? 60);
  if (sec > 0) {
    keyboardHideTimer = setTimeout(() => {
      if ($('nana-chat-input')) $('nana-chat-input').value = '';
      syncChatInputDisplay(); window.closeSeniorKeyboard();
    }, sec * 1000);
  }
}

function scrollToFirstUnreadOrBottom() {
  const feed = $('bulletin-posts-container'), div = $('first-unread-divider');
  if (!feed) return;
  if (div) { div.scrollIntoView({ behavior: 'auto', block: 'start' }); setTimeout(() => window.handleChatScroll(feed), 150); }
  else feed.scrollTop = feed.scrollHeight;
}

window.openFamilyBulletin = () => {
  chatSessionReadCutoff = Number(tabletSettings.bulletinClearedAt) || 0;
  const m = $('bulletin-modal');
  m.classList.remove('kb-fullscreen'); m.style.display = 'flex';
  window.closeSeniorKeyboard(); renderBulletinFeed(); syncChatInputDisplay();
  window.wakeScreenAndResetDimTimer(); recordHeartbeat("Opened Family Chat");
  setTimeout(scrollToFirstUnreadOrBottom, 80);
};

window.closeFamilyBulletin = () => {
  $('bulletin-modal').style.display = 'none';
  window.closeSeniorKeyboard(); window.speechSynthesis?.cancel();
  window.wakeScreenAndResetDimTimer(); recordHeartbeat("On Home Grid");
  chatSessionReadCutoff = null;
};

window.openSeniorKeyboard = () => {
  renderSeniorKeyboardLayout();
  $('bulletin-modal')?.classList.add('kb-fullscreen');
  if ($('senior-onscreen-keyboard')) $('senior-onscreen-keyboard').style.display = 'flex';
  syncChatInputDisplay(); resetKeyboardAutoHideTimer(); window.wakeScreenAndResetDimTimer();
};

window.closeSeniorKeyboard = () => {
  clearTimeout(keyboardHideTimer);
  if ($('senior-onscreen-keyboard')) $('senior-onscreen-keyboard').style.display = 'none';
  $('bulletin-modal')?.classList.remove('kb-fullscreen');
  syncChatInputDisplay(); setTimeout(scrollToFirstUnreadOrBottom, 50);
};

window.handleChatScroll = (el) => {
  if (role === 'nana' && el && (el.scrollHeight - el.scrollTop - el.clientHeight) <= 45 && unreadBulletinCount > 0) {
    window.dismissCurrentBulletinBar(true);
  }
};

window.typeSeniorKey = (char, ev) => {
  if (ev) { ev.preventDefault(); ev.stopPropagation(); }
  const now = Date.now(), guardMs = Number(tabletSettings.keyGuardMs ?? 350), sameKey = (char === lastKeyChar);
  const minGap = char === 'BACKSPACE' ? (sameKey ? Math.min(guardMs, 250) : 60) : (sameKey && guardMs > 0 ? guardMs : 80);
  if (now - lastKeyTapMs < minGap) return;

  const input = $('nana-chat-input');
  if (!input) return;
  const cur = input.value;
  if (char === ' ' && (!cur.length || cur.endsWith(' '))) return;
  if (guardMs > 0 && char.length === 1 && /[A-Za-z]/.test(char)) {
    const c = char.toLowerCase();
    if (cur.length >= 2 && cur.slice(-1).toLowerCase() === c && cur.slice(-2, -1).toLowerCase() === c) return;
  }
  lastKeyTapMs = now; lastKeyChar = char;
  if (ev?.currentTarget) {
    const b = ev.currentTarget; b.classList.add('kb-flash'); setTimeout(() => b.classList.remove('kb-flash'), 160);
  }
  resetKeyboardAutoHideTimer(); window.wakeScreenAndResetDimTimer();
  input.value = char === 'BACKSPACE' ? Array.from(cur).slice(0, -1).join('') : cur + (['💋','❤️','☘️','👍','😘'].includes(char) || !cur.length ? char : char.toLowerCase());
  syncChatInputDisplay();
};

window.kbHideTapped = () => { if (Date.now() - lastKeyTapMs >= 350) window.closeSeniorKeyboard(); };
window.submitTypedNanaMessage = async () => {
  const input = $('nana-chat-input');
  if (!input || (Date.now() - lastKeyTapMs < 350) || !input.value.trim()) return;
  const text = input.value.trim(); input.value = "";
  syncChatInputDisplay(); window.closeSeniorKeyboard();
  await window.sendNanaChatMessage(text);
};

window.sendNanaChatMessage = async (rawText) => {
  const text = (rawText || "").trim();
  if (!text || (Date.now() - lastChatSendMs < 4000)) return;
  lastChatSendMs = Date.now();
  const author = role === 'nana' ? 'Nana' : activeFamilyMember.name, st = $('tg-send-status');
  if (st) { st.style.color = "#ffff00"; st.innerText = "⏳ Sending message to Telegram..."; }
  try {
    await push(bulletinRef, { author, fromNana: role === 'nana', text, timestamp: Date.now() });
    if (role === 'nana') await window.dismissCurrentBulletinBar(true);
    const res = await fetch(CONFIG.googleScriptUrl, {
      method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ secret: SERVICE_TOKEN, portalNode: PORTAL_NODE_ID, action: "nana_reply", author, text })
    });
    const data = await res.json();
    if (st) {
      st.style.color = data?.ok ? "#4ade80" : "#f87171";
      st.innerText = data?.ok ? "✅ Sent to Family Telegram Group!" : `⚠️ ${data?.error || 'Telegram not linked'}`;
      setTimeout(() => { st.style.color = "#4ade80"; st.innerText = "🟢 Connected to Family Group"; }, 5000);
    }
  } catch (e) { if (st) { st.style.color = "#f87171"; st.innerText = "⚠️ Saved on tablet"; } }
};

function renderBulletinFeed() {
  const container = $('bulletin-posts-container');
  if (!container) return;
  container.innerHTML = "";
  const keys = Object.keys(latestBulletinPosts).slice(-25);
  const clearedAt = chatSessionReadCutoff !== null ? chatSessionReadCutoff : (Number(tabletSettings.bulletinClearedAt) || 0);
  lastRenderedReadAloud = !!tabletSettings.showReadAloud;

  if (keys.length) {
    const newest = latestBulletinPosts[keys[keys.length - 1]];
    $('ticker-preview-text').innerText = `💬 ${newest.author || 'Family'}: "${newest.text || 'Sent a photo 📷'}"`;
  } else {
    container.innerHTML = `<div style="margin:auto;color:var(--text-muted);font-size:1.5rem;font-weight:700;padding:30px;">No messages yet. Tap the box below to open the keyboard and say hello!</div>`;
  }
  updateBulletinTickerVisibility();
  let insertedDivider = false;

  keys.forEach(k => {
    const item = latestBulletinPosts[k];
    const isOut = !!item.fromNana || item.author?.toLowerCase() === 'nana';
    const isUnread = !isOut && (Number(item.timestamp) || 0) > clearedAt;

    if (isUnread && !insertedDivider) {
      insertedDivider = true;
      const d = document.createElement('div');
      d.id = 'first-unread-divider'; d.className = 'tg-unread-divider';
      d.textContent = '⬇️ NEW UNREAD MESSAGES BELOW ⬇️';
      container.appendChild(d);
    }
    const b = document.createElement('div');
    b.className = `tg-bubble ${isOut ? 'outgoing' : 'incoming'}${isUnread ? ' unread-msg' : ''}`;
    const top = document.createElement('div'); top.className = 'tg-sender-row';
    const auth = document.createElement('span'); auth.className = 'tg-sender-name';
    auth.textContent = isOut ? '👵 Nana (You)' : `👤 ${item.author || 'Family'}`;
    if (isUnread) { const tag = document.createElement('span'); tag.className = 'tg-new-tag'; tag.textContent = 'NEW'; auth.appendChild(tag); }
    top.appendChild(auth);
    if (item.timestamp) {
      const tm = document.createElement('span'); tm.className = 'tg-msg-time';
      tm.textContent = new Date(item.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      top.appendChild(tm);
    }
    b.appendChild(top);
    if (item.text) { const p = document.createElement('div'); p.className = 'tg-msg-text'; p.textContent = item.text; b.appendChild(p); }
    if (item.imageUrl && /^(data:image\/|https:\/\/)/i.test(item.imageUrl)) {
      const img = document.createElement('img'); img.src = item.imageUrl;
      img.style.cssText = 'width:100%;max-height:340px;object-fit:contain;border-radius:14px;margin-top:4px;background:#000;';
      b.appendChild(img);
    }
    if (item.text && tabletSettings.showReadAloud) {
      const btn = document.createElement('button'); btn.className = 'tg-speak-chip'; btn.textContent = '🔊 Read Aloud';
      btn.onclick = () => window.speakNote(`${item.author || 'Family'} says: ${item.text}`);
      b.appendChild(btn);
    }
    container.appendChild(b);
  });
  if ($('bulletin-modal')?.style.display === 'flex') setTimeout(scrollToFirstUnreadOrBottom, 50);
}

onValue(query(bulletinRef, limitToLast(25)), snap => { latestBulletinPosts = snap.val() || {}; renderBulletinFeed(); });
window.speakNote = (txt) => {
  if ('speechSynthesis' in window && txt) {
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(txt); u.rate = Number(tabletSettings.speechRate) || 0.9;
    window.speechSynthesis.speak(u);
  }
};

// Classic FM Radio
window.openRadioScreen = () => { showScreen('radio-screen'); window.wakeScreenAndResetDimTimer(); recordHeartbeat("Opened Classic FM Radio"); };
window.closeRadioScreen = () => { window.stopRadioAndSync(true); showScreen('grid-screen'); window.wakeScreenAndResetDimTimer(); recordHeartbeat("On Home Grid"); };
window.toggleClassicFM = () => isRadioPlaying ? window.stopRadioAndSync(true) : set(entertainmentRef, { activeKey: "classicfm", title: "Classic FM Radio 🎻", timestamp: Date.now() });
window.remoteSetEntertainment = async (key) => {
  if (key !== 'off' && !confirm("Turn Classic FM radio ON on Nana's tablet now?")) return;
  await set(entertainmentRef, { activeKey: key === 'off' ? "off" : "classicfm", title: key === 'off' ? "Off" : "Classic FM Radio 🎻", timestamp: Date.now() });
};
window.stopRadioAndSync = async (sync = true) => {
  isRadioPlaying = false;
  if (radioPlayer) { radioPlayer.pause(); radioPlayer.removeAttribute('src'); radioPlayer.load(); }
  $('btn-classicfm')?.classList.remove('playing');
  $('radio-action-prompt').innerText = "(Tap to Turn On)"; $('radio-status-label').innerText = "Radio Off";
  window.wakeScreenAndResetDimTimer();
  if (sync) await set(entertainmentRef, { activeKey: "off", title: "Off", timestamp: Date.now() });
};
function startLocalRadioStream() {
  if (!radioPlayer) return;
  isRadioPlaying = true; window.wakeScreenAndResetDimTimer();
  radioPlayer.volume = Math.min(1.0, Math.max(0.15, (Number(tabletSettings.radioVolume ?? 75)) / 100));
  radioPlayer.src = CLASSIC_FM_STREAM; radioPlayer.play().catch(() => {});
  $('btn-classicfm')?.classList.add('playing');
  $('radio-action-prompt').innerText = "Playing Live..."; $('radio-status-label').innerText = "Playing Classic FM 🎻";
  speakMsg("Playing Classic FM");
}
window.adjustNanaRadioVolume = (delta) => window.updateSetting('radioVolume', Math.max(15, Math.min(100, (Number(tabletSettings.radioVolume ?? 75)) + delta)));

onValue(entertainmentRef, snap => {
  const data = snap.val() || { activeKey: "off", title: "Off" }, activeKey = data.activeKey || "off";
  latestEntState = data;
  if (role === 'family') {
    if ($('lbl-remote-ent-status')) $('lbl-remote-ent-status').innerText = activeKey === 'off' ? 'Off' : 'Playing 🎻';
    $('fam-ent-classicfm')?.classList.toggle('selected', activeKey !== 'off');
    updateFamilyPresenceBanner();
  } else if (role === 'nana' && currentState === 'idle') {
    if (activeKey === 'off') { if (isRadioPlaying) { window.stopRadioAndSync(false); showScreen('grid-screen'); } return; }
    if (!$('radio-screen').classList.contains('active')) showScreen('radio-screen');
    if (!isRadioPlaying) startLocalRadioStream();
  }
});

// Modals & Hashed Admin PIN Verification
window.openPhoneGuideModal = () => { window.switchGuideTab(/iPad|iPhone|iPod/.test(navigator.userAgent) ? 'ios' : 'android'); $('phone-guide-modal').style.display = 'flex'; };
window.closePhoneGuideModal = () => { $('phone-guide-modal').style.display = 'none'; };
window.switchGuideTab = (os) => {
  $('tab-btn-ios').classList.toggle('active', os === 'ios'); $('tab-btn-android').classList.toggle('active', os === 'android');
  $('guide-content-ios').style.display = os === 'ios' ? 'block' : 'none'; $('guide-content-android').style.display = os === 'android' ? 'block' : 'none';
};

window.openAdminPinModal = () => {
  enteredPin = ""; $('pin-dots-display').innerText = "";
  $('admin-modal-title').innerText = `⚙️ Supervisor & Controls (v${CONFIG.appVersion})`;
  $('pin-keypad-section').style.display = 'flex'; $('admin-actions-section').style.display = 'none';
  $('admin-pin-modal').style.display = 'flex';
};
window.closeAdminPinModal = () => { enteredPin = ""; $('admin-pin-modal').style.display = 'none'; };
window.clearPinDigits = () => { enteredPin = ""; $('pin-dots-display').innerText = ""; };
window.pressPinDigit = async (d) => {
  if (enteredPin.length >= 4) return;
  enteredPin += d; $('pin-dots-display').innerText = "●".repeat(enteredPin.length);
  if (enteredPin.length === 4) {
    const candidateHash = await sha256Hex("nana-pin-salt:" + enteredPin);
    if (candidateHash === EXPECTED_PIN_HASH) {
      window.AndroidBridge?.unlockAdminForFiveMinutes?.();
      const cards = $('shared-settings-cards'), mount = $('gear-settings-mount');
      if (cards && mount && cards.parentElement !== mount) mount.appendChild(cards);
      $('admin-modal-title').innerText = `🔓 Unlocked (v${CONFIG.appVersion})`;
      $('pin-keypad-section').style.display = 'none'; $('admin-actions-section').style.display = 'flex';
      refreshSettingsUI();
    } else { $('pin-dots-display').innerText = "❌"; setTimeout(window.clearPinDigits, 700); }
  }
};

window.adminExecuteAction = (action) => {
  const apkUrl = `${window.location.origin + window.location.pathname.replace(/\/[^\/]*$/, '/')}${CONFIG.apkFileName}?t=${Date.now()}`;
  if (action === 'update_apk') window.AndroidBridge?.downloadAndInstallApk ? window.AndroidBridge.downloadAndInstallApk(apkUrl) : (window.location.href = apkUrl);
  else if (action === 'update_web') window.AndroidBridge?.clearCacheAndReload ? window.AndroidBridge.clearCacheAndReload() : window.location.reload(true);
  else {
    const map = { pin_screen: 'enableScreenPinning', settings: 'openAndroidSettings', wifi: 'openWifiSettings', launcher: 'openLenovoLauncher', relock: 'relockKioskNow' };
    window.AndroidBridge?.[map[action]]?.();
  }
  window.closeAdminPinModal();
};

// Presence, Contacts & Hide-Me
window.resetIdleTimer = () => { window.wakeScreenAndResetDimTimer(); recordHeartbeat(); };
window.addEventListener('pointerdown', () => { window.wakeScreenAndResetDimTimer(); recordHeartbeat(); }, { passive: true });

function recordHeartbeat(customActivity = null) {
  if (role !== 'nana') return;
  const now = Date.now();
  if (!customActivity && (now - lastHeartbeatWriteMs < 30000)) return;
  lastHeartbeatWriteMs = now;
  let batteryLevel = null, isCharging = null;
  if (window.AndroidBridge?.getBatteryStatusJson) {
    try {
      const b = JSON.parse(window.AndroidBridge.getBatteryStatusJson());
      batteryLevel = b.level; isCharging = b.charging;
      if (!isCharging && batteryLevel !== null && batteryLevel <= 25 && !isBatteryVoiceCurrentlyMuted()) window.announceBatteryWarning("Please plug in the tablet charger.");
    } catch (e) {}
  }
  const p = { lastActive: now, batteryLevel, isCharging };
  if (customActivity) p.lastActivity = customActivity;
  update(presenceRef, p);
}
if (role === 'nana') { setTimeout(() => { window.wakeScreenAndResetDimTimer(); recordHeartbeat("Tablet Online"); }, 3000); setInterval(recordHeartbeat, 120000); }

function updateFamilyPresenceBanner() {
  if (role !== 'family') return;
  const card = $('nana-presence-card'), ringBtn = $('family-ring-btn');
  if (!card) return;
  const diffMins = latestPresenceData?.lastActive ? Math.max(0, Math.round((Date.now() - latestPresenceData.lastActive) / 60000)) : null;
  const touchText = diffMins !== null ? `👆 Last touched: ${diffMins <= 1 ? 'Just now' : diffMins + 'm ago'}` : "👆 Last touched: No recent activity";
  const battText = latestPresenceData?.batteryLevel != null ? ` • ${latestPresenceData.isCharging ? "🔌 Charging" : "⚠️ UNPLUGGED"} (${latestPresenceData.batteryLevel}%)` : "";
  const radioStatus = (latestEntState?.activeKey && latestEntState.activeKey !== 'off') ? `<div style="color:#fef08a;font-weight:800;margin-top:2px;">🎻 Listening to Classic FM Radio</div>` : `<div style="color:#94a3b8;font-size:0.9rem;">🎻 Radio: Off</div>`;
  const tgStatus = connectedMemberIds.includes(activeFamilyMember.id) ? `<span style="color:#4ade80;font-size:0.88rem;">✅ Your Telegram alerts are connected</span>` : `<span style="color:#fbbf24;font-size:0.88rem;">⚠️ Tap "1. Connect Telegram" below so Nana can call you</span>`;
  const st = latestCallData?.status || 'idle';
  if (st !== 'idle') {
    const otherId = latestCallData.callerId === 'nana' ? latestCallData.targetId : latestCallData.callerId;
    const withName = CONFIG.familyMembers.find(m => m.id === otherId)?.name || 'Family';
    card.style.borderColor = '#f87171';
    card.innerHTML = `${st === 'connected' ? `🔴 <strong>On a video call with ${withName}</strong>` : `🟡 <strong>Ringing (${withName})</strong>`}<br><span style="color:#cbd5e1;font-size:0.9rem;">${touchText}${battText}</span><br>${tgStatus}`;
    if (ringBtn && otherId && otherId !== activeFamilyMember.id) ringBtn.disabled = true;
  } else {
    card.style.borderColor = tabletSettings.callingEnabled ? '#22c55e' : '#f59e0b';
    card.innerHTML = tabletSettings.callingEnabled
      ? `🟢 <strong>Nana is available</strong>${radioStatus}<span style="color:#cbd5e1;font-size:0.9rem;">${touchText}${battText}</span><br>${tgStatus}`
      : `📵 <strong>Video calling is switched off</strong><br><span style="color:#cbd5e1;font-size:0.9rem;">${touchText}${battText}</span><br>${tgStatus}`;
    if (ringBtn) ringBtn.disabled = !tabletSettings.callingEnabled;
  }
}

if (role === 'family') { onValue(presenceRef, snap => { latestPresenceData = snap.val() || {}; updateFamilyPresenceBanner(); }); setInterval(updateFamilyPresenceBanner, 30000); }
onValue(connectedMembersRef, snap => {
  const val = snap.val();
  connectedMemberIds = Array.isArray(val) ? val : (val && typeof val === 'object' ? Object.values(val) : []);
  if (role === 'nana') renderContacts(connectedMemberIds); else updateFamilyPresenceBanner();
});

window.syncConnectedFamilyFromTelegram = async () => {
  try {
    const res = await fetch(CONFIG.googleScriptUrl, {
      method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ secret: SERVICE_TOKEN, portalNode: PORTAL_NODE_ID, action: "sync", webhookUrl: CONFIG.googleScriptUrl, portalBaseUrl: window.location.origin + window.location.pathname })
    });
    const data = await res.json();
    if (data.ok && Array.isArray(data.connected)) {
      connectedMemberIds = data.connected;
      if (role === 'nana') renderContacts(connectedMemberIds); else updateFamilyPresenceBanner();
    }
    return data;
  } catch (e) { return { ok: false, error: e.toString() }; }
};

window.forceWebhookAndMemberSync = async () => {
  const lbl = $('lbl-sync-status'); if (lbl) lbl.innerText = "Syncing...";
  const res = await window.syncConnectedFamilyFromTelegram();
  if (res?.ok) { if (lbl) lbl.innerText = `✅ Linked (${(res.connected || []).length} connected)`; alert(`Synced! Connected: ${(res.connected || []).join(", ") || "None yet"}`); }
  else if (lbl) lbl.innerText = "⚠️ Check Script Deployment";
};

const HIDE_FOREVER = 4102444800000;
const isHiddenFromNana = (id) => Number(latestHidden[id] || 0) > Date.now();
window.hideMeFromNana = async (choice) => {
  if (role !== 'family' || !activeFamilyMember) return;
  const mins = { '30m': 30, '1h': 60, '2h': 120, '5h': 300, '10h': 600 };
  let until = HIDE_FOREVER;
  if (mins[choice]) until = Date.now() + mins[choice] * 60000;
  else if (choice === 'tomorrow') { const d = new Date(); d.setHours(7,0,0,0); if (d <= Date.now()) d.setDate(d.getDate() + 1); until = d.getTime(); }
  await set(ref(db, `${basePath}/hiddenContacts/${activeFamilyMember.id}`), until);
};
window.showMeToNana = () => (role === 'family' && activeFamilyMember) ? remove(ref(db, `${basePath}/hiddenContacts/${activeFamilyMember.id}`)) : null;

function refreshHideUI() {
  if (role !== 'family' || !activeFamilyMember) return;
  const until = Number(latestHidden[activeFamilyMember.id] || 0), hidden = until > Date.now();
  const d = new Date(until), tStr = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const fmt = until >= HIDE_FOREVER ? 'until you turn it back on' : 'until ' + (d.toDateString() === new Date().toDateString() ? tStr : d.toLocaleDateString([], { weekday: 'short' }) + ' ' + tStr);
  document.querySelectorAll('.hide-status-lbl').forEach(e => { e.innerText = hidden ? `🙈 Hidden from Nana ${fmt}` : `👁️ Visible on Nana's tablet`; e.style.color = hidden ? '#fbbf24' : '#4ade80'; });
}
onValue(hiddenRef, snap => { latestHidden = snap.val() || {}; if (role === 'nana') renderContacts(connectedMemberIds); else refreshHideUI(); });
setInterval(() => { if (role === 'nana') renderContacts(connectedMemberIds); else refreshHideUI(); }, 30000);

function renderContacts(connectedList = []) {
  const grid = $('family-grid'); if (!grid) return;
  grid.innerHTML = "";
  const connected = CONFIG.familyMembers.filter(m => connectedList.includes(m.id));
  const display = connected.filter(m => !isHiddenFromNana(m.id)).slice(0, 8);
  if (!display.length) {
    grid.innerHTML = connected.length
      ? `<div style="grid-column:1/-1;grid-row:1/-1;display:flex;align-items:center;justify-content:center;color:var(--text-muted);font-size:1.8rem;font-weight:700;padding:20px;">😴 Nobody is available to call right now.<br>Try again later or send a Family Chat message.</div>`
      : `<div style="grid-column:1/-1;grid-row:1/-1;display:flex;flex-direction:column;align-items:center;justify-content:center;color:var(--text-muted);font-size:1.6rem;font-weight:700;padding:20px;"><p>⏳ Waiting for family members to connect Telegram...</p><button class="tone-btn" style="font-size:1.2rem;background:#0284c7;" onclick="syncConnectedFamilyFromTelegram()">🔄 Check Now</button></div>`;
    return;
  }
  display.forEach(m => {
    const missed = Number(missedCallsByMember[m.id]?.count) || 0;
    const card = document.createElement('div');
    card.className = missed > 0 ? 'family-card has-missed' : 'family-card';
    card.innerHTML = `${missed > 0 ? `<div class="missed-card-badge">📞 ${missed} MISSED</div>` : ''}<div class="photo-wrapper"><img src="${m.photo}" onerror="this.src='${m.fallback}'"></div><div class="contact-nameplate">${m.name}</div>`;
    card.onclick = () => window.openCallConfirmation(m);
    grid.appendChild(card);
  });
}

window.openCallConfirmation = (member) => {
  pendingCallContact = member;
  $('confirm-prompt-title').innerText = `Call ${member.name}?`;
  const img = $('confirm-photo'); img.onerror = () => { img.src = member.fallback; }; img.src = member.photo;
  const missed = Number(missedCallsByMember[member.id]?.count) || 0, note = $('confirm-missed-note');
  note.innerText = missed > 0 ? `📞 ${member.name} tried calling you ${missed} ${missed === 1 ? 'time' : 'times'}` : '';
  note.style.display = missed > 0 ? 'block' : 'none';
  $('confirm-modal').style.display = 'flex';
  let s = 15; $('confirm-timer').innerText = s;
  clearInterval(confirmTimer);
  confirmTimer = setInterval(() => { if (--s <= 0) window.dismissCallConfirm(); else $('confirm-timer').innerText = s; }, 1000);
};
window.dismissCallConfirm = () => { clearInterval(confirmTimer); $('confirm-modal').style.display = 'none'; pendingCallContact = null; };
window.executeConfirmedCall = () => { const t = pendingCallContact; window.dismissCallConfirm(); if (t) startCallFromNana(t); };

// Settings & Controls
window.openSettingsModal = () => {
  if (role === 'family' && !isAdminFamilyMember) return;
  const cards = $('shared-settings-cards'), mount = $('family-settings-mount');
  if (cards && mount && cards.parentElement !== mount) mount.appendChild(cards);
  $('settings-modal').style.display = 'flex';
};
window.closeSettingsModal = () => { $('settings-modal').style.display = 'none'; };
window.updateSetting = async (key, value) => {
  tabletSettings[key] = value;
  refreshSettingsUI(); updateClock(); updateBulletinTickerVisibility(); window.wakeScreenAndResetDimTimer();
  await update(settingsRef, { [key]: value });
};
window.toggleSetting = (key) => window.updateSetting(key, !tabletSettings[key]);
window.stepNanaCallVolume = (delta) => window.updateSetting('callVolume', Math.max(25, Math.min(100, (Number(tabletSettings.callVolume) || 85) + delta)));
window.previewAndSetTone = async (tone) => { tabletSettings.ringtone = tone; refreshSettingsUI(); playSelectedRingtoneAudio(tone, tabletSettings.ringVolume || 85, true); await update(settingsRef, { ringtone: tone }); };
window.setCallingEnabled = (on) => window.updateSetting('callingEnabled', !!on);
window.copyTestLink = async (kind) => {
  const base = window.location.origin + window.location.pathname;
  const link = kind === 'nana'
    ? `${base}?role=nana&key=${encodeURIComponent(SERVICE_TOKEN)}&test=1`
    : `${base}?role=family&id=${encodeURIComponent(callerId)}&key=${encodeURIComponent(SERVICE_TOKEN)}&test=1`;
  try { await navigator.clipboard.writeText(link); alert('Copied:\n' + link); } catch (e) { window.prompt('Copy link:', link); }
};

const fmtDelay = (sec) => { const s = Number(sec ?? 120); return s === 0 ? "Never" : (s < 60 ? `${s}s` : `${Math.round(s / 60)}m`); };

function refreshSettingsUI() {
  const callingOn = !!tabletSettings.callingEnabled;
  document.body.classList.toggle('calling-off', !callingOn);
  if ($('grid-header-title')) $('grid-header-title').innerText = callingOn ? 'Tap a photo to call family' : 'Family Chat & Radio';
  document.querySelectorAll('.calling-on-btn').forEach(b => b.classList.toggle('selected', callingOn));
  document.querySelectorAll('.calling-off-btn').forEach(b => b.classList.toggle('selected', !callingOn));
  document.querySelectorAll('.calling-status-lbl').forEach(l => { l.innerText = callingOn ? '✅ Calling is ON' : '📵 Calling is OFF'; l.style.color = callingOn ? '#4ade80' : '#fca5a5'; });

  const ringBtn = $('family-ring-btn');
  if (ringBtn) { ringBtn.innerText = callingOn ? '📹 Ring Nana Now' : '📵 Calling is switched off'; if (!callingOn) ringBtn.disabled = true; }

  const theme = tabletSettings.colorTheme || 'classic-dark';
  document.body.classList.remove('theme-yellow-black', 'theme-white-black', 'theme-black-cream');
  if (theme !== 'classic-dark') document.body.classList.add(`theme-${theme}`);

  const callVol = Number(tabletSettings.callVolume ?? 85), radVol = Number(tabletSettings.radioVolume ?? 75), ringVol = Number(tabletSettings.ringVolume ?? 85);
  const awakeB = Number(tabletSettings.awakeBrightness ?? 85), dimB = Number(tabletSettings.dimBrightness ?? 15), dimSec = Number(tabletSettings.dimDelaySec ?? 120);
  const nStart = Number(tabletSettings.nightStartHour ?? 21), nEnd = Number(tabletSettings.nightEndHour ?? 8);
  const kbLayout = tabletSettings.keyboardLayout || 'qwerty', kbHideSec = Number(tabletSettings.keyboardTimeoutSec ?? 60);

  if ($('in-call-vol-label')) $('in-call-vol-label').innerText = `${callVol}%`;
  if ($('nana-vol-display')) $('nana-vol-display').innerText = `${radVol}%`;
  document.querySelectorAll('.lbl-bright-summary').forEach(e => { e.innerText = `${awakeB}% ➔ ${dimB}% (${fmtDelay(dimSec)})`; });
  document.querySelectorAll('.lbl-kb-summary').forEach(e => { e.innerText = `${kbLayout.toUpperCase()} • ${fmtDelay(kbHideSec)}`; });
  document.querySelectorAll('.lbl-vol-summary').forEach(e => { e.innerText = `Call ${callVol}% • Radio ${radVol}% • Ring ${ringVol}%`; });
  document.querySelectorAll('.lbl-night-window').forEach(e => { e.innerText = tabletSettings.nightModeEnabled ? `${String(nStart).padStart(2,'0')}:00 – ${String(nEnd).padStart(2,'0')}:00` : "Disabled"; });

  const mutedUntil = Number(tabletSettings.batteryVoiceMutedUntil) || 0;
  const muteTxt = mutedUntil > Date.now() ? `🔇 Muted until ${new Date(mutedUntil).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : `🔊 Battery Voice: Active`;
  document.querySelectorAll('.lbl-battery-mute').forEach(e => { e.innerText = muteTxt; });

  const sCall = Math.min(1.0, Math.max(0.2, callVol / 100)), sRad = Math.min(1.0, Math.max(0.15, radVol / 100));
  if ($('remote-audio')) $('remote-audio').volume = role === 'nana' ? sCall : 1.0;
  if ($('remote-video')) $('remote-video').volume = role === 'nana' ? sCall : 1.0;
  if (radioPlayer && role === 'nana') radioPlayer.volume = sRad;

  document.querySelectorAll('[data-skey]').forEach(btn => btn.classList.toggle('selected', String(tabletSettings[btn.dataset.skey]) === String(btn.dataset.sval)));
  if (lastRenderedKbLayout !== kbLayout) renderSeniorKeyboardLayout();
  if (lastRenderedReadAloud !== !!tabletSettings.showReadAloud) renderBulletinFeed();
}

onValue(settingsRef, snap => {
  const remote = snap.val();
  if (remote) tabletSettings = { ...tabletSettings, ...remote };
  settingsLoaded = true;
  refreshSettingsUI(); updateClock(); updateBulletinTickerVisibility(); window.wakeScreenAndResetDimTimer();
  if (role === 'nana' && !tabletSettings.callingEnabled && latestCallData?.status !== 'idle') {
    stopRingingUI(); set(callStateRef, { status: 'idle', timestamp: Date.now() });
  }
  if (role === 'family') updateFamilyPresenceBanner();
});

// Ringtone Synthesizer & Telegram 6-Stage Burst
function playNote(freq, start, dur, type = 'sine', baseGain = 0.6, vol = 85) {
  if (audioCtx.state === 'suspended') audioCtx.resume();
  const osc = audioCtx.createOscillator(), gain = audioCtx.createGain();
  osc.type = type; osc.frequency.setValueAtTime(freq, start);
  gain.gain.setValueAtTime(baseGain * (vol / 100), start);
  gain.gain.exponentialRampToValueAtTime(0.008, start + dur);
  osc.connect(gain); gain.connect(audioCtx.destination);
  osc.start(start); osc.stop(start + dur);
}

function playSelectedRingtoneAudio(tone, vol = 85, isPreview = false) {
  if (tone.endsWith('.mp3')) {
    if (activeMp3Ringtone && !isPreview) return;
    activeMp3Ringtone?.pause();
    activeMp3Ringtone = new Audio(tone);
    activeMp3Ringtone.volume = Math.min(1.0, Math.max(0.2, vol / 100));
    if (!isPreview) activeMp3Ringtone.loop = true;
    activeMp3Ringtone.play().catch(() => {});
    return;
  }
  if (audioCtx.state === 'suspended') audioCtx.resume();
  const now = audioCtx.currentTime;
  if (tone === 'uk-phone') [0, 0.55].forEach(o => { playNote(400, now + o, 0.35, 'square', 0.45, vol); playNote(450, now + o, 0.35, 'square', 0.45, vol); });
  else if (tone === 'westminster') [[329.63,0,0.35],[415.3,0.35,0.35],[369.99,0.7,0.35],[246.94,1.05,0.65]].forEach(([f,o,d]) => playNote(f, now + o, d, 'triangle', 0.8, vol));
  else if (tone === 'marimba') [[523.25,0,0.25],[659.25,0.22,0.25],[783.99,0.44,0.25],[1046.5,0.66,0.55]].forEach(([f,o,d]) => playNote(f, now + o, d, 'sine', 0.8, vol));
  else if (tone === 'bell') [0, 0.35, 0.7].forEach(o => { playNote(880, now + o, 0.28, 'sine', 0.75, vol); playNote(1760, now + o, 0.28, 'triangle', 0.5, vol); });
}

async function sendSingleTelegramRing(member, step, max) {
  const answerUrl = `${window.location.origin + window.location.pathname}?role=family&id=${encodeURIComponent(member.id)}&key=${encodeURIComponent(SERVICE_TOKEN)}&answer=true`;
  try {
    if ($('outbound-sub')) $('outbound-sub').innerText = `Ringing their mobile now (${step}/${max})...`;
    const res = await fetch(CONFIG.googleScriptUrl, {
      method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ secret: SERVICE_TOKEN, portalNode: PORTAL_NODE_ID, action: "ring", memberId: member.id, answerUrl, ringCount: step, maxRings: max, previousMessageId: lastTelegramMsgId })
    });
    const data = await res.json();
    if (data.ok && data.messageId) lastTelegramMsgId = data.messageId;
  } catch (e) {}
}

function startTelegramRingBurst(member) {
  stopTelegramRingBurst(); currentDialedMember = member; lastTelegramMsgId = null;
  let step = 1; sendSingleTelegramRing(member, step, 6);
  telegramBurstInterval = setInterval(() => {
    if (currentState !== 'calling_family' || step >= 6) { clearInterval(telegramBurstInterval); telegramBurstInterval = null; return; }
    sendSingleTelegramRing(member, ++step, 6);
  }, 8500);
}

function stopTelegramRingBurst() {
  clearInterval(telegramBurstInterval); telegramBurstInterval = null;
  if (currentDialedMember && lastTelegramMsgId) {
    const memberId = currentDialedMember.id, messageId = lastTelegramMsgId; lastTelegramMsgId = null;
    fetch(CONFIG.googleScriptUrl, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ secret: SERVICE_TOKEN, portalNode: PORTAL_NODE_ID, action: "clear_rings", memberId, messageId }) }).catch(() => {});
  }
}

// WebRTC Video Engine
function unlockCallAudio() {
  try {
    if (audioCtx?.state === 'suspended') audioCtx.resume();
    const ra = $('remote-audio'), rv = $('remote-video');
    if (ra) { ra.muted = false; ra.volume = role === 'nana' ? Math.min(1.0, Math.max(0.2, (Number(tabletSettings.callVolume) || 85) / 100)) : 1.0; if (!ra.srcObject) ra.src = SILENT_WAV; ra.play().catch(() => {}); }
    if (rv) { rv.muted = true; rv.play().catch(() => {}); }
  } catch (e) {}
}

window.switchFamilyCamera = async () => {
  if (!callObject) return;
  try {
    currentFacingMode = currentFacingMode === 'user' ? 'environment' : 'user';
    if (typeof callObject.cycleCamera === 'function') await callObject.cycleCamera();
    else await callObject.setInputDevicesAsync({ videoSource: { facingMode: currentFacingMode } });
    if ($('local-video')) $('local-video').style.transform = currentFacingMode === 'environment' ? 'scaleX(1)' : 'scaleX(-1)';
  } catch (e) { try { await callObject.setInputDevicesAsync({ videoSource: { facingMode: currentFacingMode } }); } catch (_) {} }
};

async function joinDailyRoom() {
  if (isJoiningOrInRoom || callObject) return;
  isJoiningOrInRoom = true; currentFacingMode = 'user';
  const banner = $('call-connecting-banner');
  banner.style.display = 'block'; banner.innerText = '📹 Connecting video...';
  if (!window.DailyIframe) { banner.innerText = '⚠️ Video library failed to load'; isJoiningOrInRoom = false; return; }

  const co = window.DailyIframe.createCallObject({
    audioSource: true, videoSource: true,
    dailyConfig: {
      avoidEval: true,
      userMediaAudioConstraints: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      userMediaVideoConstraints: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } }
    }
  });
  callObject = co;
  let hadRemote = false, emptyTimer = null, soundBlocked = false;
  const targetVol = () => role === 'nana' ? Math.min(1.0, Math.max(0.2, (Number(tabletSettings.callVolume) || 85) / 100)) : 1.0;
  const showProblem = (t) => { banner.style.display = 'block'; banner.innerText = t; };
  const promptTapToUnmute = () => {
    soundBlocked = true; showProblem('🔈 Tap anywhere on screen to hear the call');
    document.addEventListener('pointerdown', () => {
      if (audioCtx?.state === 'suspended') audioCtx.resume();
      ['remote-video', 'remote-audio'].forEach(id => { const el = $(id); if (el) { el.muted = false; el.volume = targetVol(); el.play().catch(() => {}); } });
      soundBlocked = false; banner.style.display = 'none';
    }, { once: true });
  };

  const attachTracks = () => {
    if (callObject !== co) return;
    const parts = co.participants();
    const localTrack = parts.local?.tracks?.video?.persistentTrack || parts.local?.tracks?.video?.track;
    const lv = $('local-video');
    if (localTrack && lv && lv.srcObject?.getVideoTracks()[0] !== localTrack) { lv.srcObject = new MediaStream([localTrack]); lv.play().catch(() => {}); }

    const remotes = Object.values(parts).filter(p => !p.local);
    const target = role === 'family' ? (remotes.find(p => p.user_name === 'Nana_Tablet') || remotes.find(p => (p.user_name || '').startsWith('Nana')) || remotes[0]) : (remotes.find(p => (p.user_name || '').startsWith('Family_')) || remotes[0]);
    if (!target) return;
    hadRemote = true; clearTimeout(emptyTimer);

    const vTrack = target.tracks?.video?.persistentTrack || target.tracks?.video?.track;
    const aTrack = target.tracks?.audio?.persistentTrack || target.tracks?.audio?.track;
    const rv = $('remote-video'), ra = $('remote-audio');

    if (vTrack && rv) {
      if (!soundBlocked) banner.style.display = 'none';
      if (rv.srcObject?.getVideoTracks()[0] !== vTrack || (aTrack && rv.srcObject?.getAudioTracks()[0] !== aTrack)) {
        rv.srcObject = new MediaStream(aTrack ? [vTrack, aTrack] : [vTrack]);
        rv.volume = targetVol(); rv.muted = false;
        rv.play().catch(() => { rv.muted = true; rv.play().catch(() => {}); promptTapToUnmute(); });
      }
    }
    if (aTrack && ra && ra.srcObject?.getAudioTracks()[0] !== aTrack) {
      ra.removeAttribute('src'); ra.srcObject = new MediaStream([aTrack]);
      ra.muted = !!(rv && !rv.muted); ra.volume = targetVol();
      ra.play().catch(() => promptTapToUnmute());
    }
  };

  ['joined-meeting', 'participant-joined', 'participant-updated', 'track-started', 'track-stopped'].forEach(ev => co.on(ev, attachTracks));
  co.on('participant-left', () => {
    if (callObject !== co) return;
    clearTimeout(emptyTimer);
    emptyTimer = setTimeout(() => { if (callObject === co && hadRemote && !Object.values(co.participants()).some(p => !p.local)) window.endCall(); }, 10000);
  });
  co.on('camera-error', e => showProblem('⚠️ Camera/mic error: ' + (e?.errorMsg?.errorMsg || 'check permissions')));
  co.on('error', e => { showProblem('⚠️ Video error: ' + (e?.errorMsg || 'reconnecting')); setTimeout(() => { if (callObject === co) window.endCall(); }, 8000); });

  try {
    await co.join({ url: CONFIG.dailyRoomUrl, userName: role === 'nana' ? (isRealAndroidTablet ? 'Nana_Tablet' : 'Nana_Browser') : `Family_${activeFamilyMember.id}` });
    co.setLocalVideo(true); co.setLocalAudio(true);
    try { co.setBandwidth({ kbs: 1800, trackConstraints: { width: 1280, height: 720, frameRate: 30 } }); } catch (_) {}
  } catch (err) {
    showProblem('⚠️ Could not join video room'); isJoiningOrInRoom = false;
    setTimeout(() => { if (callObject === co) window.endCall(); }, 8000);
  }
}

async function destroyDailyRoom() {
  isJoiningOrInRoom = false; didManuallyInitiateOrAnswerOnThisTab = false;
  if (callObject) { const co = callObject; callObject = null; try { await co.leave(); await co.destroy(); } catch (e) {} }
  ['remote-video', 'remote-audio', 'local-video'].forEach(id => { if ($(id)) $(id).srcObject = null; });
}

// Call Signaling
async function startCallFromNana(member) {
  if (!tabletSettings.callingEnabled || isHiddenFromNana(member.id)) return;
  unlockCallAudio(); didManuallyInitiateOrAnswerOnThisTab = true;
  await window.stopRadioAndSync(true);
  $('bulletin-modal').style.display = 'none'; window.closeSeniorKeyboard();
  currentState = 'calling_family'; window.wakeScreenAndResetDimTimer();
  const img = $('outbound-photo'); img.onerror = () => { img.src = member.fallback; }; img.src = member.photo;
  $('outbound-title').innerText = `Calling ${member.name}...`;
  showScreen('outbound-screen'); speakMsg(`Calling ${member.spokenName} now. Please wait.`);
  try {
    await clearMissedCallsForMember(member.id);
    await set(callStateRef, { status: 'calling_family', callerId: 'nana', targetId: member.id, timestamp: Date.now() });
  } catch (e) { currentState = 'idle'; showScreen('grid-screen'); return; }
  startTelegramRingBurst(member);
  clearTimeout(outboundTimeout);
  outboundTimeout = setTimeout(async () => {
    if (currentState === 'calling_family') { speakMsg(`Sorry, ${member.spokenName} could not answer right now.`); await incrementMissedCallForMember(member.id); await window.endCall(); }
  }, (Number(tabletSettings.ringDurationSec) || 60) * 1000);
}

window.confirmFamilyPickupFromTelegram = async () => {
  unlockCallAudio(); didManuallyInitiateOrAnswerOnThisTab = true;
  showScreen('call-screen'); joinDailyRoom();
  await clearMissedCallsForMember(activeFamilyMember.id);
  await set(callStateRef, { status: 'connected', callerId: 'nana', targetId: activeFamilyMember.id, timestamp: Date.now() });
};

window.startCallFromFamily = async () => {
  unlockCallAudio();
  if (!tabletSettings.callingEnabled) return alert("Video calling is currently switched off.");
  if (!confirm("Ring Nana's tablet now?")) return;
  didManuallyInitiateOrAnswerOnThisTab = true;
  const btn = $('family-ring-btn'); if (btn) btn.disabled = true;
  try {
    const res = await runTransaction(callStateRef, cur => {
      if (cur && cur.status !== 'idle' && !(cur.timestamp && Date.now() - cur.timestamp > 90000)) return;
      return { status: 'ringing_nana', callerId: activeFamilyMember.id, targetId: 'nana', timestamp: Date.now() };
    });
    if (!res.committed) { alert("Nana's tablet is currently busy on another call."); if (btn) btn.disabled = false; return; }
    showScreen('call-screen');
    const b = $('call-connecting-banner'); if (b) { b.style.display = 'block'; b.innerText = '🔔 Ringing Nana... Waiting for her to answer...'; }
  } catch (e) { if (btn) btn.disabled = !tabletSettings.callingEnabled; }
};

window.answerCallAsNana = async () => {
  unlockCallAudio(); didManuallyInitiateOrAnswerOnThisTab = true;
  clearTimeout(autoAnswerTimeout); stopRingingUI();
  showScreen('call-screen'); joinDailyRoom();
  const cId = latestCallData?.callerId;
  if (cId && cId !== 'nana') await clearMissedCallsForMember(cId);
  await set(callStateRef, { status: 'connected', callerId: cId || 'family', targetId: 'nana', timestamp: Date.now() });
};

window.endCall = async () => {
  clearTimeout(outboundTimeout); clearTimeout(incomingRingTimeout); clearTimeout(autoAnswerTimeout);
  stopTelegramRingBurst(); stopRingingUI();
  if ($('family-ring-btn')) $('family-ring-btn').disabled = !tabletSettings.callingEnabled;
  await set(callStateRef, { status: 'idle', timestamp: Date.now() });
  await destroyDailyRoom();
  showScreen(role === 'family' ? 'family-screen' : 'grid-screen');
};

window.requestTabletReload = async () => {
  const b = $('remote-refresh-btn');
  try { await set(reloadCmdRef, Date.now()); if (b) { b.innerText = '✅ Sent!'; setTimeout(() => { b.innerText = '🔄 Refresh Now'; }, 3000); } } catch (e) {}
};

if (role === 'nana') {
  let reloadPending = false;
  const tryReload = () => {
    if (reloadPending && !['connected', 'ringing_nana', 'calling_family'].includes(currentState)) {
      window.AndroidBridge?.clearCacheAndReload ? window.AndroidBridge.clearCacheAndReload() : window.location.reload(true);
    }
  };
  onValue(reloadCmdRef, snap => {
    const val = Number(snap.val() || 0); if (!val) return;
    const last = localStorage.getItem('nana_last_reload_cmd');
    localStorage.setItem('nana_last_reload_cmd', String(val));
    if (last !== null && val > Number(last)) { reloadPending = true; tryReload(); }
  });
  setInterval(tryReload, 5000);
}

onValue(callStateRef, snap => {
  const data = snap.val(); if (!data) return;
  latestCallData = data; currentState = data.status;
  if (role === 'nana' && settingsLoaded && !tabletSettings.callingEnabled && data.status !== 'idle') {
    stopRingingUI(); set(callStateRef, { status: 'idle', timestamp: Date.now() }); return;
  }
  if (role === 'family') updateFamilyPresenceBanner();
  if (data.status !== 'idle') {
    $('bulletin-modal').style.display = 'none'; window.closeSeniorKeyboard();
    if (role === 'nana' && isRadioPlaying) window.stopRadioAndSync(true);
  }

  if (role === 'nana') {
    const act = isRealAndroidTablet || TEST_MODE || didManuallyInitiateOrAnswerOnThisTab;
    if (data.status === 'ringing_nana') {
      const caller = CONFIG.familyMembers.find(m => m.id === data.callerId) || CONFIG.familyMembers[0];
      if (isRealAndroidTablet && isCurrentlyInNightWindow() && tabletSettings.nightBlockCalls) {
        incrementMissedCallForMember(caller.id); window.endCall(); return;
      }
      $('night-dimmer').style.display = 'none'; window.wakeScreenAndResetDimTimer();
      const img = $('caller-photo'); img.onerror = () => { img.src = caller.fallback; }; img.src = caller.photo;
      $('caller-title').innerText = `${caller.name} is calling!`;
      showScreen('ringing-screen'); stopRingingUI();
      if (act) {
        playSelectedRingtoneAudio(tabletSettings.ringtone, tabletSettings.ringVolume || 85);
        if (tabletSettings.autoAnswer) {
          speakMsg(`${caller.spokenName} is calling you. Connecting automatically.`);
          clearTimeout(autoAnswerTimeout);
          autoAnswerTimeout = setTimeout(() => { if (currentState === 'ringing_nana') window.answerCallAsNana(); }, 10000);
        } else speakMsg(`${caller.spokenName} is calling you. Touch anywhere on the screen to answer.`);
        ringInterval = setInterval(() => { playSelectedRingtoneAudio(tabletSettings.ringtone, tabletSettings.ringVolume || 85); speakMsg(`${caller.spokenName} is calling you.`); }, 6000);
        clearTimeout(incomingRingTimeout);
        incomingRingTimeout = setTimeout(async () => { if (currentState === 'ringing_nana') { await incrementMissedCallForMember(caller.id); await window.endCall(); } }, (Number(tabletSettings.ringDurationSec) || 60) * 1000);
      }
    } else if (data.status === 'connected') {
      $('night-dimmer').style.display = 'none'; window.wakeScreenAndResetDimTimer();
      clearTimeout(outboundTimeout); clearTimeout(incomingRingTimeout); clearTimeout(autoAnswerTimeout);
      stopTelegramRingBurst(); stopRingingUI();
      const partnerId = data.callerId === 'nana' ? data.targetId : data.callerId;
      if (partnerId && act) clearMissedCallsForMember(partnerId);
      if (act) { showScreen('call-screen'); joinDailyRoom(); } else showScreen('grid-screen');
    } else if (data.status === 'idle') {
      clearTimeout(outboundTimeout); clearTimeout(incomingRingTimeout); clearTimeout(autoAnswerTimeout);
      stopTelegramRingBurst(); stopRingingUI(); destroyDailyRoom();
      if (!isRadioPlaying) showScreen('grid-screen');
      window.wakeScreenAndResetDimTimer(); updateClock();
    }
  } else {
    const isMyCall = (data.callerId === activeFamilyMember.id || data.targetId === activeFamilyMember.id);
    if (data.status === 'calling_family' && data.targetId === activeFamilyMember.id) showScreen('family-pickup-screen');
    else if (data.status === 'connected' && isMyCall) { showScreen('call-screen'); joinDailyRoom(); }
    else if (data.status === 'idle' || !isMyCall) { destroyDailyRoom(); showScreen('family-screen'); }
  }
});

function stopRingingUI() {
  clearInterval(ringInterval); ringInterval = null;
  window.speechSynthesis?.cancel();
  if (activeMp3Ringtone) { activeMp3Ringtone.pause(); activeMp3Ringtone.currentTime = 0; activeMp3Ringtone = null; }
}

function speakMsg(text, isBatt = false) {
  if (!tabletSettings.voicePrompts || ((isBatt || /battery|charger|plug|power/i.test(text)) && isBatteryVoiceCurrentlyMuted())) return;
  if ('speechSynthesis' in window && text) {
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text); u.rate = Number(tabletSettings.speechRate) || 0.9;
    window.speechSynthesis.speak(u);
  }
}

if (role === 'family') {
  $('family-greeting').innerText = `Call Nana (as ${activeFamilyMember.name})`;
  const img = $('family-self-photo'); img.onerror = () => { img.src = activeFamilyMember.fallback; }; img.src = activeFamilyMember.photo;
  $('in-call-volume-bar').style.display = 'flex';
  // Include secret in deep link so family member is automatically authorized by the bot
  $('telegram-link-btn').href = `https://t.me/${CONFIG.telegramBotUsername}?start=${activeFamilyMember.id}_${SERVICE_TOKEN}`;
  if ($('family-controls-btn')) $('family-controls-btn').style.display = isAdminFamilyMember ? 'inline-block' : 'none';
  if ($('in-call-settings-btn')) $('in-call-settings-btn').style.display = isAdminFamilyMember ? 'inline-block' : 'none';
  window.syncConnectedFamilyFromTelegram();
  if (autoAnswerFromTelegram) showScreen('family-pickup-screen');
  else showScreen('family-screen');
} else {
  renderContacts(connectedMemberIds); renderSeniorKeyboardLayout();
  window.syncConnectedFamilyFromTelegram(); showScreen('grid-screen');
  setInterval(updateClock, 10000); updateClock(); window.wakeScreenAndResetDimTimer();
}
