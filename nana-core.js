import { getApps, getApp, initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getDatabase, ref, set, update, push, onValue, remove, runTransaction, onDisconnect, query, limitToLast } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js";

export const APP_VERSION = "2.9.6";
export const $ = (id) => document.getElementById(id);
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
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
const callerId = (params.get('id') || 'ryan').toLowerCase().replace(/[^a-z0-9_-]/g, '') || 'ryan';
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
  showScreen(role === 'family' ? 'family-screen' : 'grid-screen');
}

const PORTAL_NODE_ID = `nana_${computedKeyHash.slice(0, 24)}`;
const DERIVED_DAILY_ROOM = `NanaPhone_${computedKeyHash.slice(0, 12)}`;

// --- 3. CONFIGURATION & FAMILY MEMBERS ---
const mkMember = (id, name, spokenName, av, bg) => ({
  id, name, spokenName, photo: `photos/${id}.jpg`,
  fallback: `https://ui-avatars.com/api/?name=${av}&size=256&background=${bg}&color=fff&bold=true`,
  isBuiltIn: true, hasProfilePhoto: true
});

export const DEFAULT_FAMILY_MEMBERS = [
  mkMember("phil", "Phil", "Phil", "Phil", "1d4ed8"),
  mkMember("nicky-s", "Nicky S", "Nicky", "NS", "be185d"),
  mkMember("denise", "Denise", "Denise", "Denise", "047857"),
  mkMember("gill", "Gill", "Gill", "Gill", "b45309"),
  mkMember("ryan", "Ryan", "Ryan", "Ryan", "4338ca"),
  mkMember("nicola-p", "Nicola P", "Nicola", "NP", "0e7490"),
  mkMember("zara", "Zara", "Zara", "Zara", "6d28d9"),
  mkMember("megan", "Megan", "Megan", "Megan", "be123c")
];

const BUILTIN_MEMBER_IDS = new Set(DEFAULT_FAMILY_MEMBERS.map(m => m.id));
const CUSTOM_AVATAR_PALETTE = ["0284c7", "059669", "7c3aed", "d97706", "db2777", "4338ca", "0f766e", "b91c1c"];
export const makeFallbackAvatarUrl = (name, idHint = '') => {
  const clean = String(name || idHint || 'Family').trim() || 'Family';
  let hash = 0;
  for (let i = 0; i < clean.length; i++) hash = ((hash << 5) - hash + clean.charCodeAt(i)) | 0;
  const bg = CUSTOM_AVATAR_PALETTE[Math.abs(hash) % CUSTOM_AVATAR_PALETTE.length];
  const safeName = encodeURIComponent(clean).replace(/[!'()*]/g, c => '%' + c.charCodeAt(0).toString(16).toUpperCase());
  return `https://ui-avatars.com/api/?name=${safeName}&size=256&background=${bg}&color=fff&bold=true`;
};
const prettifyMemberId = (id) => String(id || 'family')
  .split(/[-_]+/).filter(Boolean).map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ') || 'Family';

const CUSTOM_MEMBERS_CACHE_KEY = `nana_family_members_cache_${PORTAL_NODE_ID}_${TEST_MODE ? 'test' : 'live'}`;
let initialCachedMembersMap = {};
try {
  const raw = localStorage.getItem(CUSTOM_MEMBERS_CACHE_KEY);
  if (raw) {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object') initialCachedMembersMap = parsed;
  }
} catch (_) {}

function buildResolvedMemberList(overridesMap = {}) {
  const resolved = DEFAULT_FAMILY_MEMBERS.map(base => {
    const ov = overridesMap?.[base.id];
    if (!ov || typeof ov !== 'object') return { ...base };
    const name = String(ov.name || base.name).trim() || base.name;
    const defaultSpoken = name === base.name ? base.spokenName : name;
    const spokenName = String(ov.spokenName || defaultSpoken).trim() || defaultSpoken;
    const customPhoto = typeof ov.photoDataUrl === 'string' && ov.photoDataUrl.startsWith('data:image/') ? ov.photoDataUrl : null;
    return {
      ...base,
      name,
      spokenName,
      photo: customPhoto || base.photo,
      fallback: customPhoto ? base.fallback : makeFallbackAvatarUrl(name, base.id),
      isBuiltIn: true,
      hasProfilePhoto: true,
      updatedAt: Number(ov.updatedAt || 0)
    };
  });

  const customList = Object.entries(overridesMap || {})
    .map(([k, v]) => ({ key: String(v?.id || k).toLowerCase(), raw: v }))
    .filter(x => /^[a-z0-9_-]+$/.test(x.key))
    .filter(x => x.raw && typeof x.raw === 'object' && !BUILTIN_MEMBER_IDS.has(x.key))
    .filter(x => String(x.raw.name || '').trim().length > 0)
    .sort((a, b) => (Number(a.raw.createdAt || 0) - Number(b.raw.createdAt || 0)) || a.key.localeCompare(b.key));

  customList.forEach(({ key, raw }) => {
    const name = String(raw.name || prettifyMemberId(key)).trim();
    const spokenName = String(raw.spokenName || name).trim() || name;
    const fb = makeFallbackAvatarUrl(name, key);
    const hasCustomPhoto = typeof raw.photoDataUrl === 'string' && raw.photoDataUrl.startsWith('data:image/');
    resolved.push({
      id: key,
      name,
      spokenName,
      photo: hasCustomPhoto ? raw.photoDataUrl : fb,
      fallback: fb,
      isBuiltIn: false,
      isCustom: true,
      hasProfilePhoto: hasCustomPhoto,
      createdAt: Number(raw.createdAt || 0),
      updatedAt: Number(raw.updatedAt || 0)
    });
  });

  return resolved;
}

const initialMembers = buildResolvedMemberList(initialCachedMembersMap);

export const CONFIG = {
  appVersion: APP_VERSION,
  apkFileName: "nanaphone.apk",
  dailyRoomUrl: "https://nanaphone.daily.co/" + (params.get('room') || DERIVED_DAILY_ROOM),
  telegramBotUsername: "Nanaphone_Bot",
  googleScriptUrl: "https://script.google.com/macros/s/AKfycbwsFHE8oyj1RBGxLJT79bbPsvJ2hTkVrF9dCoj369ApEREXyrdQKE_vA0QrobBOeLE2/exec",
  classicFmStream: "https://media-ice.musicradio.com/ClassicFMMP3",
  // Clean 100ms 8kHz 16-bit mono all-zero PCM WAV (prevents 1-sample buffer-underrun clicking/popping)
  silentWav: (() => {
    const sr = 8000, samples = 800, buf = new ArrayBuffer(44 + samples * 2), v = new DataView(buf);
    const w = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
    w(0, 'RIFF'); v.setUint32(4, 36 + samples * 2, true); w(8, 'WAVE');
    w(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
    v.setUint32(24, sr, true); v.setUint32(28, sr * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
    w(36, 'data'); v.setUint32(40, samples * 2, true);
    return URL.createObjectURL(new Blob([buf], { type: 'audio/wav' }));
  })(),
  firebase: { databaseURL: "https://nanaphone-f644b-default-rtdb.europe-west1.firebasedatabase.app" },
  familyMembers: initialMembers
};

export const FAMILY_NAMES = Object.fromEntries(CONFIG.familyMembers.map(m => [m.id, m.name]));
const resolveActiveMemberSnapshot = (membersList) => {
  const match = membersList.find(m => m.id === callerId);
  if (match) return { ...match };
  if (params.get('id')) {
    const pretty = prettifyMemberId(callerId);
    const fb = makeFallbackAvatarUrl(pretty, callerId);
    return { id: callerId, name: pretty, spokenName: pretty, photo: fb, fallback: fb, isBuiltIn: false, isCustom: true, hasProfilePhoto: false };
  }
  return { ...(membersList.find(m => m.id === 'ryan') || membersList[0]) };
};
export const activeFamilyMember = resolveActiveMemberSnapshot(CONFIG.familyMembers);
export const isAdminFamilyMember = (role === 'family' && callerId === 'ryan');

// --- 4. TEST MODE SANDBOX INTERCEPTOR ---
if (TEST_MODE) {
  const realFetch = window.fetch.bind(window);
  window.fetch = (url, opts) => {
    if (!String(url).startsWith(CONFIG.googleScriptUrl)) return realFetch(url, opts);
    let parsedBody = null;
    try { parsedBody = opts?.body ? JSON.parse(opts.body) : null; } catch (_) {}
    if (parsedBody?.action === 'add_google_album') {
      return Promise.resolve(new Response(JSON.stringify({
        ok: false, error: 'Google Photos sync requires live mode (TEST_MODE intercepts Apps Script requests).', test: true
      }), { headers: { 'Content-Type': 'application/json' } }));
    }
    return Promise.resolve(new Response(JSON.stringify({
      ok: true, messageId: null, connected: CONFIG.familyMembers.map(m => m.id),
      groupChatId: null, broadcastCount: 0, syncedCount: 0, test: true
    }), { headers: { 'Content-Type': 'application/json' } }));
  };
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
  googleAlbums:     ref(db, `${basePath}/googleAlbums`),
  settings:         ref(db, `${basePath}/settings`),
  missedCalls:      ref(db, `${basePath}/missedCalls`),
  connectedMembers: ref(db, `${basePath}/connectedMembers`),
  familyMembers:    ref(db, `${basePath}/familyMembers`),
  memberLastCallAt: ref(db, `${basePath}/memberLastCallAt`),
  hiddenContacts:   ref(db, `${basePath}/hiddenContacts`),
  callSchedules:    ref(db, `${basePath}/callSchedules`),
  entertainment:    ref(db, `${basePath}/entertainment`),
  videoStream:      ref(db, `${basePath}/videoStream`),
  quickQuestion:    ref(db, `${basePath}/quickQuestion`),
  questionHistory:  ref(db, `${basePath}/questionHistory`),
  callBeat:         ref(db, `${basePath}/callBeat`),
  dailyUsage:       ref(db, `${basePath}/dailyUsage`),
  videoIssues:      ref(db, `${basePath}/videoIssues`),
  alerts:           ref(db, `${basePath}/alerts`),
  reloadCmd:        ref(db, `${basePath}/commands/reloadAt`),
  reloadNanaCmd:    ref(db, `${basePath}/commands/reloadNanaAt`),
  reloadFamilyCmd:  ref(db, `${basePath}/commands/reloadFamilyAt`),
  connectedInfo:    ref(db, `.info/connected`)
};

if (TEST_MODE) set(refs.connectedMembers, CONFIG.familyMembers.map(m => m.id)).catch(() => {});

// --- 6. SHARED AUDIO, SPEECH & CENTRAL STATE ---
export const audioCtx = new (window.AudioContext || window.webkitAudioContext)();

export const settings = {
  callVolume: 85, radioVolume: 75, ringVolume: 85, videoVolume: 80,
  ringDurationSec: 60, ringtone: 'uk-phone', voicePrompts: true, autoAnswer: false,
  speechRate: 0.9, awakeBrightness: 85, dimBrightness: 15, dimDelaySec: 120,
  nightModeEnabled: true, nightStartHour: 21, nightEndHour: 8, nightBlockCalls: false,
  batteryVoiceMutedUntil: 0, batteryVoiceIntervalMin: 0, batteryVoiceVolume: 85, batteryVoiceThresholdPct: 30,
  batteryChatAlertsEnabled: true,
  lowPowerModeSetting: 'auto', lowPowerBlockVideo: true, lowPowerMaxBrightness: 50, lowPowerDimDelaySec: 45,
  showBulletinBar: true, showReadAloud: false, colorTheme: 'classic-dark',
  voiceMessagingEnabled: true, voiceMessageMaxSec: 30, voiceAutoExtendEnabled: true, voiceHardCapSec: 120, voiceAutoSendSilenceSec: 5, voiceNoSpeechCancelSec: 15, voiceNoiseSuppression: true, voiceTvGuardMode: 'normal', nanaMessageEntryMode: 'choice',
  keyboardLayout: 'qwerty', keyboardTimeoutSec: 60, keyGuardMs: 350, bulletinClearedAt: 0,
  callingEnabled: TEST_MODE,
  showTodaysCallsBanner: true, periodicPopupsEnabled: true, unreadChatPopupMin: 30,
  radioPromptHours: [10, 15], videoPromptHours: [14, 19], speakQuestions: true,
  guidedStarEnabled: true, guidedStarSpeed: 'normal', guidedStarSize: 'large', guidedStarEngagement: 'lively',
  guidedStarChat: true, guidedStarRadio: true, guidedStarVideo: true, guidedStarPatience: true,
  photoScreensaverEnabled: true, photoScreensaverDelaySec: 120, photoScreensaverIntervalSec: 30,
  photoScreensaverBrightness: 65, photoScreensaverShowCaption: true, photoScreensaverShowAlbumName: true,
  photoScreensaverMaxPhotos: 20, photoScreensaverSource: 'both', photoScreensaverOrder: 'recent_plus_shuffle'
};

export function askNana(type, question, askedBy, extra = {}) {
  const now = Date.now();
  hooks.clearPendingQuestionHistoryIfOverwritten?.(now);
  const shortPromptTypes = new Set(['leave_video_prompt', 'restart_video_prompt']);
  const defaultTimeoutMin = shortPromptTypes.has(type) ? 3 : 20;
  const defaultExpiresAt = now + defaultTimeoutMin * 60 * 1000;
  return set(refs.quickQuestion, {
    id: `q_${type}_${now}`, type, question, askedBy,
    silent: !settings.speakQuestions, status: 'pending', answer: null, askedAt: now,
    timeoutMin: defaultTimeoutMin, expiresAt: defaultExpiresAt,
    ...extra
  });
}

export const state = {
  settingsLoaded: false,
  familyMembersLoaded: false,
  currentState: 'idle',
  isRadioPlaying: false,
  isTabletUnplugged: false,
  batteryLevel: null,
  isCharging: null,
  isBatteryDecreasingWhilePlugged: false,
  screensaverPowerReductionPct: 0,
  isPhotoScreensaverActive: false,
  lastPatienceActivityMs: 0,
  returnToVideoAfterCall: false,
  returnToPatienceAfterCall: false,
  callSnap: { status: 'idle' },
  presenceSnap: {},
  bulletinSnap: {},
  googleAlbumsSnap: {},
  entSnap: { activeKey: 'off', title: 'Off' },
  missedCallsByMember: {},
  connectedMemberIds: [],
  familyMembersSnap: { ...initialCachedMembersMap },
  memberLastCallAtSnap: {},
  hiddenSnap: {},
  callSchedulesSnap: {},
  callHistorySnap: {},
  questionHistorySnap: {},
  dailyUsageSnap: {},
  videoIssuesSnap: {},
  alertsSnap: {},
  streamData: { queue: [], currentIndex: 0, state: "paused", savedTimes: {}, viewCounts: {} },
  familyComposerSilent: false,
  lastActivityOrCallMs: Date.now()
};

export const hooks = {
  onSettingsChanged: [],
  onPowerModeChanged: [],
  onFamilyMembersChanged: [],
  pauseVideo: null,
  resumeVideo: null,
  syncVideoUI: null,
  openVideoScreen: null,
  confirmRestartVideo: null,
  broadcastScreen: null,
  syncBatteryUI: null,
  refreshFamilyPresence: null,
  renderTodaysCallsBanner: null,
  startNormalDimCountdownOnPause: null,
  renderContacts: null,
  renderManageFamily: null,
  updateFamilyVideoStatus: null,
  clearPendingQuestionHistoryIfOverwritten: null,
  renderBulletinFeed: null,
  updateBulletinTicker: null,
  tryStartPhotoScreensaver: null,
  stopPhotoScreensaver: null,
  updateScreensaverBrightness: null,
  openPatienceScreen: null,
  cancelPatienceInteraction: null,
  onPatienceGameStarted: null
};

export const isLowPowerMode = () => {
  if (role !== 'nana') return false;
  const mode = settings.lowPowerModeSetting || 'auto';
  if (mode === 'on') return true;
  if (mode === 'off') return false;
  return state.isTabletUnplugged === true;
};

export const isVideoBlockedByLowPower = () => isLowPowerMode() && settings.lowPowerBlockVideo !== false;

export const isBatteryVoiceCurrentlyMuted = () => (Number(settings.batteryVoiceMutedUntil) || 0) > Date.now();

export function speakMsg(text, isBatt = false, customVol = 1.0) {
  if (!settings.voicePrompts && !isBatt) return;
  if (isBatt && isBatteryVoiceCurrentlyMuted()) return;
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
  showScreen, speakMsg, isBatteryVoiceCurrentlyMuted, isLowPowerMode, isVideoBlockedByLowPower, askNana,
  makeFallbackAvatarUrl,
  isNanaVideoActivelyPlaying: () => false,
  isChatVideoActivelyPlaying: () => false,
  getCurrentQueueItem: () => null
};

onValue(refs.familyMembers, snap => {
  const remoteMap = snap.val() || {};
  state.familyMembersSnap = remoteMap;
  state.familyMembersLoaded = true;
  try { localStorage.setItem(CUSTOM_MEMBERS_CACHE_KEY, JSON.stringify(remoteMap)); } catch (_) {}

  const nextMembers = buildResolvedMemberList(remoteMap);
  CONFIG.familyMembers.splice(0, CONFIG.familyMembers.length, ...nextMembers);

  Object.keys(FAMILY_NAMES).forEach(k => delete FAMILY_NAMES[k]);
  nextMembers.forEach(m => { FAMILY_NAMES[m.id] = m.name; });

  const resolvedSelf = resolveActiveMemberSnapshot(nextMembers);
  Object.keys(activeFamilyMember).forEach(k => delete activeFamilyMember[k]);
  Object.assign(activeFamilyMember, resolvedSelf);
  NanaCore.senderName = activeFamilyMember.name;

  hooks.onFamilyMembersChanged.forEach(fn => {
    try { fn(nextMembers, activeFamilyMember); } catch (_) {}
  });
  if (TEST_MODE) set(refs.connectedMembers, nextMembers.map(m => m.id)).catch(() => {});
});

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
  ['avail', 'ask', 'media', 'photos'].forEach(t => {
    $(`fam-tab-btn-${t}`)?.classList.toggle('active', t === tab);
    $(`fam-pane-${t}`)?.classList.toggle('active', t === tab);
  });
};

window.openFamilyBulletin = window.openFamilyBulletin || (() => {
  const m = $('bulletin-modal');
  if (m) { m.classList.remove('kb-fullscreen'); m.style.display = 'flex'; }
});

window.closeFamilyBulletin = window.closeFamilyBulletin || (() => {
  if ($('bulletin-modal')) $('bulletin-modal').style.display = 'none';
});

window.openRadioScreen = window.openRadioScreen || (() => {
  showScreen('radio-screen');
});

window.openVideoScreen = window.openVideoScreen || (() => {
  showScreen('video-screen');
});

window.switchNanaMainTab = async (tab, forceLeaveVideo = false) => {
  if (role === 'nana' && tab !== 'video' && !forceLeaveVideo && NanaCore.isNanaVideoActivelyPlaying?.()) {
    hooks.pauseVideo?.('confirm_leave_video');
    const tabLabels = {
      calls: 'Family Calls',
      chat: 'Family Chat',
      radio: 'Classic FM Radio',
      patience: 'Patience'
    };
    const destName = tabLabels[tab] || 'another screen';
    await askNana('leave_video_prompt', `Your video is paused. Are you sure you want to leave the video to open ${destName}?`, 'Video Player', { targetTab: tab });
    return;
  }

  if (tab !== 'video') {
    state.returnToVideoAfterCall = false;
    hooks.pauseVideo?.('switched_tab');
  }
  if (tab !== 'patience' && tab !== 'chat') {
    state.returnToPatienceAfterCall = false;
    hooks.cancelPatienceInteraction?.();
  }
  if (tab !== 'chat' && $('bulletin-modal')?.style.display === 'flex') {
    window.closeFamilyBulletin?.();
  }
  if (tab !== 'radio') window.stopRadioAndSync?.(true);

  if (tab === 'calls') {
    showScreen('grid-screen');
  } else if (tab === 'chat') {
    window.openFamilyBulletin?.();
  } else if (tab === 'radio') {
    showScreen('radio-screen');
    window.openRadioScreen?.();
  } else if (tab === 'video') {
    showScreen('video-screen');
    hooks.openVideoScreen?.();
  } else if (tab === 'patience') {
    showScreen('patience-screen');
    hooks.openPatienceScreen?.();
  }

  hooks.broadcastScreen?.();
};
