import { getApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getDatabase, ref, set, update, push, onValue, onDisconnect, query, limitToLast } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js";

export const $ = (id) => document.getElementById(id);
export { ref, set, update, push, onValue, onDisconnect, query, limitToLast };

async function sha256Hex(str) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(str));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, "0")).join("");
}

const SERVICE_TOKEN = (localStorage.getItem('nana_service_token') || '').trim();
const params = new URLSearchParams(window.location.search);
const TEST_MODE = params.get('test') === '1';
const role = params.get('role') || 'nana';
const callerId = (params.get('id') || 'ryan').toLowerCase();
const isAdminFamily = (role === 'family' && callerId === 'ryan');

const FAMILY_NAMES = {
  "phil": "Phil", "nicky-s": "Nicky S", "denise": "Denise", "gill": "Gill",
  "ryan": "Ryan", "nicola-p": "Nicola P", "zara": "Zara", "megan": "Megan"
};
const senderName = FAMILY_NAMES[callerId] || "Family";
const GOOGLE_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbwsFHE8oyj1RBGxLJT79bbPsvJ2hTkVrF9dCoj369ApEREXyrdQKE_vA0QrobBOeLE2/exec";

const keyHash = SERVICE_TOKEN ? await sha256Hex("nana-v2-salt:" + SERVICE_TOKEN) : "";
const PORTAL_NODE_ID = `nana_${keyHash.slice(0, 24)}`;
const basePath = TEST_MODE ? `portals/${PORTAL_NODE_ID}__test` : `portals/${PORTAL_NODE_ID}`;

const app = getApp();
const db = getDatabase(app);

export const NanaCore = {
  SERVICE_TOKEN,
  TEST_MODE,
  role,
  callerId,
  isAdminFamily,
  FAMILY_NAMES,
  senderName,
  GOOGLE_SCRIPT_URL,
  PORTAL_NODE_ID,
  basePath,
  db,
  refs: {
    quickQuestion:   ref(db, `${basePath}/quickQuestion`),
    questionHistory: ref(db, `${basePath}/questionHistory`),
    videoStream:     ref(db, `${basePath}/videoStream`),
    settings:        ref(db, `${basePath}/settings`),
    callState:       ref(db, `${basePath}/callState`),
    callHistory:     ref(db, `${basePath}/callHistory`),
    bulletin:        ref(db, `${basePath}/bulletin`),
    presence:        ref(db, `${basePath}/presence`),
    entertainment:   ref(db, `${basePath}/entertainment`),
    connectedInfo:   ref(db, `.info/connected`)
  },
  state: {
    streamData: { queue: [], currentIndex: 0, state: "paused", savedTimes: {}, viewCounts: {} },
    presenceSnap: {},
    bulletinSnap: {},
    callSnap: { status: 'idle' },
    entSnap: { activeKey: 'off' },
    callHistorySnap: {},
    questionHistorySnap: {},
    speakQuestionsDefault: true,
    familyComposerSilent: false,
    batteryVoiceThresholdPct: 100,
    lastActivityOrCallMs: Date.now()
  },
  hooks: {
    pauseVideo: null,
    openVideoScreen: null,
    broadcastScreen: null,
    refreshFamilyPresence: null
  }
};

window.addEventListener('pointerdown', () => {
  NanaCore.state.lastActivityOrCallMs = Date.now();
}, { passive: true });

// Family 3-Tab Switcher
window.switchFamilyPortalTab = (tab) => {
  ['avail', 'ask', 'media'].forEach(t => {
    $(`fam-tab-btn-${t}`)?.classList.toggle('active', t === tab);
    $(`fam-pane-${t}`)?.classList.toggle('active', t === tab);
  });
};

// Nana Top 4-Tab Switcher
window.switchNanaMainTab = (tab) => {
  if (tab !== 'video') NanaCore.hooks.pauseVideo?.('switched_tab');
  if (tab !== 'chat' && $('bulletin-modal')?.style.display === 'flex') window.closeFamilyBulletin?.();
  if (tab !== 'radio') window.stopRadioAndSync?.(true);

  if (tab === 'calls') {
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    $('grid-screen')?.classList.add('active');
  } else if (tab === 'chat') {
    window.openFamilyBulletin?.();
  } else if (tab === 'radio') {
    window.openRadioScreen?.();
  } else if (tab === 'video') {
    NanaCore.hooks.openVideoScreen?.();
  }
  NanaCore.hooks.broadcastScreen?.();
};
