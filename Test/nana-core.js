import { getApps, getApp, initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getDatabase, ref, set, update, push, onValue, remove, runTransaction, onDisconnect, query, limitToLast } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js";

export const APP_VERSION = "2.9.3";
export const $ = (id) => document.getElementById(id);
export { ref, set, update, push, onValue, remove, runTransaction, onDisconnect, query, limitToLast };

// --- 1. VERSION GUARD & CACHE BUSTER ---
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
  } else {
    sessionStorage.removeItem('nana_vguard');
  }
})();
window.__nanaAppLoaded = true;

// --- 2. ZERO-KNOWLEDGE SHA-256 VERIFICATION ---
export const EXPECTED_KEY_HASH = "6b1b29f5d03d71ed2fdef0b65a19d5a7230f5e6684b7a13d33ef7e50ff55f93e";
export const EXPECTED_PIN_HASH = "21c6f9835cd57d3477b314cc62426c063918538b8c0317e620bb62f9e6832373";

export async function sha256Hex(str) {
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

export function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  $(id)?.classList.add('active');
}

const computedKeyHash = SERVICE_TOKEN ? await sha256Hex("nana-v2-salt:" + SERVICE_TOKEN) : "";
if (computedKeyHash !== EXPECTED_KEY_HASH) {
  localStorage.removeItem('nana_service_token');
  showScreen('auth-error-screen');
  throw new Error("Unauthorized: Valid access key required.");
} else {
  // Immediately show the appropriate home screen as soon as auth succeeds
  showScreen(role === 'family' ? 'family-screen' : 'grid-screen');
}

const PORTAL_NODE_ID = `nana_${computedKeyHash.slice(0, 24)}`;
const DERIVED_DAILY_ROOM = `NanaPhone_${computedKeyHash.slice(0, 12)}`;

// --- 3. CONFIGURATION & FAMILY MEMBERS ---
const mkMember = (id, name, spokenName, av, bg) => ({
  id, name, spokenName, photo: `photos/${id}.jpg`,
  fallback: `https://ui-avatars.com/api/?name=${av}&size=256&background=${bg}&color=fff&bold=true`
});

export const CONFIG = {
  appVersion: APP_VERSION,
  apkFileName: "nanaphone.apk",
  dailyRoomUrl: "https://nanaphone.daily.co/" + (params.get('room') || DERIVED_DAILY_ROOM),
  telegramBotUsername: "Nanaphone_Bot",
  googleScriptUrl: "https://script.google.com/macros/s/AKfycbwsFHE8oyj1RBGxLJT79bbPsvJ2hTkVrF9dCoj369ApEREXyrdQKE_vA0QrobBOeLE2/exec",
  classicFmStream: "https://media-ice.musicradio.com/ClassicFMMP3",
  silentWav: "data:audio/wav;base64,UklGRigAAABXQVZFZm10IBIAAAABAAEARKwAAIhYAQACABAAAABkYXRhAgAAAAEA",
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

export const FAMILY_NAMES = Object.fromEntries(CONFIG.familyMembers.map(m => [m.id, m.name]));
export const activeFamilyMember = CONFIG.familyMembers.find(m => m.id === callerId) || CONFIG.familyMembers[4];
export const isAdminFamilyMember = (role === 'family' && activeFamilyMember.id === 'ryan');

// --- 4. TEST MODE SANDBOX INTERCEPTOR ---
if (TEST_MODE) {
  const realFetch = window.fetch.bind(window);
  window.fetch = (url, opts) => String(url).startsWith(CONFIG.googleScriptUrl)
    ? Promise.resolve(new Response(JSON.stringify({
        ok: true, messageId: null, connected: CONFIG.familyMembers.map(m => m.id),
        groupChatId: null, broadcastCount: 0, test: true
      }), { headers: { 'Content-Type': 'application/json' } }))
    : realFetch(url, opts);
  const r = document.createElement('div');
  r.innerText = "🧪 TEST MODE - separate from Nana's real tablet";
  r.style.cssText = 'position:fixed;top:0;left:0;z-index:99999;background:#7c3aed;color:#fff;font:700 12px sans-serif;padding:3px 10px;border-bottom-right-radius:10px;pointer-events:none;';
  document.body.appendChild(r);
}

// --- 5. FIREBASE INITIALIZATION & CENTRAL REFS ---
const app = getApps().length ? getApp() : initializeApp(CONFIG.firebase);
const db = getDatabase(app);
const basePath = TEST_MODE ? `portals/${PORTAL_NODE_ID}__test` : `portals/${PORTAL_NODE_ID}`;

export const refs = {
  callState:        ref(db, `${basePath}/callState`),
  callHistory:      ref(db, `${basePath}/callHistory`),
  presence:         ref(db, `${basePath}/presence`),
  bulletin:         ref(db, `${basePath}/bulletin`),
  settings:         ref(db, `${basePath}/settings`),
  missedCalls:      ref(db, `${basePath}/missedCalls`),
  connectedMembers: ref(db, `${basePath}/connectedMembers`),
  hiddenContacts:   ref(db, `${basePath}/hiddenContacts`),
  callSchedules:    ref(db, `${basePath}/callSchedules`),
  entertainment:    ref(db, `${basePath}/entertainment`),
  videoStream:      ref(db, `${basePath}/videoStream`),
  quickQuestion:    ref(db, `${basePath}/quickQuestion`),
  questionHistory:  ref(db, `${basePath}/questionHistory`),
  reloadCmd:        ref(db, `${basePath}/commands/reloadAt`),
  connectedInfo:    ref(db, `.info/connected`)
};

if (TEST_MODE) set(refs.connectedMembers, CONFIG.familyMembers.map(m => m.id)).catch(() => {});

// --- 6. SHARED AUDIO, SPEECH & CENTRAL STATE ---
export const audioCtx = new (window.AudioContext || window.webkitAudioContext)();

export const settings = {
  callVolume: 85, radioVolume: 75, ringVolume: 85, videoVolume: 80,
  nanaMicDspMode: 'vocal-boost', familyVoiceBoostPct: 180,
  ringDurationSec: 60, ringtone: 'uk-phone', voicePrompts: true, autoAnswer: false,
  speechRate: 0.9, awakeBrightness: 85, dimBrightness: 15, dimDelaySec: 120,
  nightModeEnabled: true, nightStartHour: 21, nightEndHour: 8, nightBlockCalls: false,
  batteryVoiceMutedUntil: 0, batteryVoiceIntervalMin: 3, batteryVoiceVolume: 85, batteryVoiceThresholdPct: 100,
  showBulletinBar: true, showReadAloud: false, colorTheme: 'classic-dark',
  keyboardLayout: 'qwerty', keyboardTimeoutSec: 60, keyGuardMs: 350, bulletinClearedAt: 0,
  callingEnabled: TEST_MODE,
  showTodaysCallsBanner: true, periodicPopupsEnabled: true, unreadChatPopupMin: 30,
  radioPromptHours: [10, 15], videoPromptHours: [14, 19], speakQuestions: true
};

export const state = {
  settingsLoaded: false,
  currentState: 'idle',
  isRadioPlaying: false,
  callSnap: { status: 'idle' },
  presenceSnap: {},
  bulletinSnap: {},
  entSnap: { activeKey: 'off', title: 'Off' },
  missedCallsByMember: {},
  connectedMemberIds: [],
  hiddenSnap: {},
  callSchedulesSnap: {},
  callHistorySnap: {},
  questionHistorySnap: {},
  streamData: { queue: [], currentIndex: 0, state: "paused", savedTimes: {}, viewCounts: {} },
  familyComposerSilent: false,
  lastActivityOrCallMs: Date.now()
};

export const hooks = {
  onSettingsChanged: [],
  pauseVideo: null,
  openVideoScreen: null,
  broadcastScreen: null,
  refreshFamilyPresence: null,
  renderTodaysCallsBanner: null,
  startNormalDimCountdownOnPause: null,
  renderContacts: null,
  renderBulletinFeed: null,
  updateBulletinTicker: null
};

export const isBatteryVoiceCurrentlyMuted = () => (Number(settings.batteryVoiceMutedUntil) || 0) > Date.now();

export function speakMsg(text, isBatt = false, customVol = 1.0) {
  if (!settings.voicePrompts && !isBatt) return;
  if ((isBatt || /battery|charger|plug|power/i.test(text)) && isBatteryVoiceCurrentlyMuted()) return;
  if ('speechSynthesis' in window && text) {
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.rate = Number(settings.speechRate) || 0.9;
    u.volume = Math.min(1.0, Math.max(0.2, Number(customVol) || 1.0));
    window.speechSynthesis.speak(u);
  }
}

window.speakNote = (txt) => {
  if ('speechSynthesis' in window && txt) {
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(txt);
    u.rate = Number(settings.speechRate) || 0.9;
    window.speechSynthesis.speak(u);
  }
};

export const NanaCore = {
  APP_VERSION, CONFIG, SERVICE_TOKEN, TEST_MODE, PORTAL_NODE_ID,
  GOOGLE_SCRIPT_URL: CONFIG.googleScriptUrl,
  role, callerId, autoAnswerFromTelegram, isRealAndroidTablet,
  activeFamilyMember, isAdminFamilyMember, isAdminFamily: isAdminFamilyMember,
  FAMILY_NAMES, senderName: activeFamilyMember.name,
  basePath, db, refs, settings, state, hooks, audioCtx,
  showScreen, speakMsg, isBatteryVoiceCurrentlyMuted,
  isNanaVideoActivelyPlaying: () => false,
  getCurrentQueueItem: () => null
};

// --- 7. GLOBAL NAVIGATION & VERSION FOOTER ---
(function initVersionBadges() {
  const stylesV = (getComputedStyle(document.documentElement).getPropertyValue('--nana-styles-version') || '').replace(/["'\s]/g, '') || '?';
  const pageV = window.__NANA_PAGE_VERSION || '?';
  const allMatch = (pageV === APP_VERSION && stylesV === APP_VERSION);
  const txt = `Page ${pageV} | App ${APP_VERSION} | Styles ${stylesV}${allMatch ? '' : ' ⚠️ MISMATCH'}`;
  document.querySelectorAll('.file-versions-line').forEach(e => { e.innerText = txt; e.style.color = allMatch ? '#94a3b8' : '#fbbf24'; });
  document.querySelectorAll('.gear-pill').forEach(e => { e.innerText = `⚙️ v${APP_VERSION}${allMatch ? '' : ' ⚠️'}`; });
})();

window.switchFamilyPortalTab = (tab) => {
  ['avail', 'ask', 'media'].forEach(t => {
    $(`fam-tab-btn-${t}`)?.classList.toggle('active', t === tab);
    $(`fam-pane-${t}`)?.classList.toggle('active', t === tab);
  });
};

window.switchNanaMainTab = (tab) => {
  if (tab !== 'video') hooks.pauseVideo?.('switched_tab');
  if (tab !== 'chat' && $('bulletin-modal')?.style.display === 'flex') window.closeFamilyBulletin?.();
  if (tab !== 'radio') window.stopRadioAndSync?.(true);

  if (tab === 'calls') showScreen('grid-screen');
  else if (tab === 'chat') window.openFamilyBulletin?.();
  else if (tab === 'radio') window.openRadioScreen?.();
  else if (tab === 'video') hooks.openVideoScreen?.();

  hooks.broadcastScreen?.();
};