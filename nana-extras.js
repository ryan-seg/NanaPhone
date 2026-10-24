import { getApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getDatabase, ref, set, update, push, onValue, onDisconnect, query, limitToLast } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js";

const $ = (id) => document.getElementById(id);

async function sha256Hex(str) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(str));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, "0")).join("");
}

(async function initNanaExtras() {
  const SERVICE_TOKEN = (localStorage.getItem('nana_service_token') || '').trim();
  if (!SERVICE_TOKEN) return;

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
  const keyHash = await sha256Hex("nana-v2-salt:" + SERVICE_TOKEN);
  const PORTAL_NODE_ID = `nana_${keyHash.slice(0, 24)}`;
  const basePath = TEST_MODE ? `portals/${PORTAL_NODE_ID}__test` : `portals/${PORTAL_NODE_ID}`;

  const app = getApp();
  const db = getDatabase(app);

  const quickQuestionRef = ref(db, `${basePath}/quickQuestion`);
  const videoStreamRef   = ref(db, `${basePath}/videoStream`);
  const settingsRef      = ref(db, `${basePath}/settings`);
  const callStateRef     = ref(db, `${basePath}/callState`);
  const bulletinRef      = ref(db, `${basePath}/bulletin`);
  const presenceRef      = ref(db, `${basePath}/presence`);
  const entertainmentRef = ref(db, `${basePath}/entertainment`);
  const connectedInfoRef = ref(db, `.info/connected`);

  const styleEl = document.createElement('style');
  styleEl.textContent = `
    /* Fix "🔽 View Messages" button text fitting on Nana's onscreen keyboard */
    #senior-onscreen-keyboard .kb-bottom-bar {
      grid-template-columns: 2.7fr 3.9fr 2.4fr !important;
    }
    #senior-onscreen-keyboard .kb-bottom-bar > button:first-child {
      font-size: clamp(1.1rem, 2vw, 1.48rem) !important;
      white-space: nowrap !important;
      padding: 0 10px !important;
      letter-spacing: -0.02em;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    #video-screen { justify-content:space-between; padding:68px 18px 16px 18px; gap:10px; }
    .nana-top-nav { width:100%; display:flex; justify-content:space-between; align-items:center; gap:8px; flex-shrink:0; flex-wrap:wrap; }
    .nana-nav-pills { display:flex; gap:8px; align-items:center; flex-wrap:wrap; }
    .nav-pill-btn { font-size:clamp(1.1rem,1.8vw,1.45rem); font-weight:900; color:#fff; padding:7px 15px; border-radius:14px; border:3px solid #fff; white-space:nowrap; cursor:pointer; box-shadow:0 4px 12px rgba(0,0,0,0.5); }
    .nav-pill-btn.calls-pill { background:#16a34a; color:#000; }
    .nav-pill-btn.chat-pill-x { background:#006699; }
    .nav-pill-btn.radio-pill-x { background:#047857; }
    .nav-pill-btn.video-pill-x { background:#7c3aed; }
    .nav-pill-btn.active-tab { border-color:#fef08a; box-shadow:0 0 14px rgba(250,204,21,0.85); transform:scale(1.03); }
    body.theme-black-cream .nav-pill-btn { border-color:#000; }
    .video-stage-box { position:relative; width:100%; flex:1; min-height:0; background:#000; border:4px solid var(--border-main); border-radius:24px; overflow:hidden; display:flex; align-items:center; justify-content:center; cursor:pointer; }
    #nana-video-el { width:100%; height:100%; object-fit:contain; background:#000; pointer-events:none; }
    #nana-video-el::cue { background:rgba(0,0,0,0.85); color:#fef08a; font-size:2.1rem; font-weight:900; text-shadow:2px 2px 4px #000; }
    #video-tap-overlay { position:absolute; inset:0; display:flex; flex-direction:column; align-items:center; justify-content:center; background:rgba(0,0,0,0.68); color:#fef08a; font-size:clamp(1.8rem,3.2vw,2.7rem); font-weight:900; text-align:center; padding:24px; gap:12px; transition:opacity 0.2s; }
    #video-tap-overlay.playing-hidden { opacity:0; pointer-events:none; }
    .video-bottom-bar { width:100%; background:var(--bg-card); border:3px solid var(--border-main); border-radius:22px; padding:10px 18px; display:flex; align-items:center; justify-content:space-between; gap:12px; flex-shrink:0; flex-wrap:wrap; }
    #nana-question-modal { display:none; position:fixed; inset:0; background:rgba(9,13,22,0.96); z-index:142; flex-direction:column; align-items:center; justify-content:center; padding:28px; text-align:center; gap:22px; }
    .q-popup-card { background:var(--bg-card); border:6px solid #facc15; border-radius:32px; padding:28px 32px; max-width:820px; width:94vw; box-shadow:0 16px 40px rgba(0,0,0,0.85); display:flex; flex-direction:column; align-items:center; gap:18px; }
    .q-sender-badge { font-size:clamp(1.4rem,2.3vw,2rem); font-weight:900; color:#38bdf8; }
    .q-main-text { font-size:clamp(2.1rem,3.8vw,3.3rem); font-weight:900; color:var(--text-accent); line-height:1.25; word-wrap:break-word; }
    .q-btn-row { display:flex; gap:28px; width:100%; justify-content:center; margin-top:8px; flex-wrap:wrap; }
    .q-giant-choice { flex:1; min-width:220px; min-height:130px; font-size:clamp(2.2rem,3.8vw,3.2rem); font-weight:900; border-radius:26px; border:6px solid #fff; cursor:pointer; display:flex; align-items:center; justify-content:center; gap:12px; box-shadow:0 8px 22px rgba(0,0,0,0.6); }
    .q-giant-choice:active { transform:scale(0.96); }
    .q-yes-btn { background:#22c55e; color:#000; }
    .q-no-btn { background:#ef4444; color:#fff; }

    /* Tidy Tabbed Family Screen Layout */
    #family-screen { padding: 12px 12px 28px 12px !important; gap: 8px !important; }
    .fam-tabs-bar {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 6px;
      width: 92vw;
      max-width: 540px;
      background: #0f172a;
      padding: 5px;
      border-radius: 16px;
      border: 2px solid #334155;
      flex-shrink: 0;
    }
    .fam-tab-btn {
      background: transparent;
      color: #94a3b8;
      border: 2px solid transparent;
      border-radius: 11px;
      padding: 8px 4px;
      font-size: 0.86rem;
      font-weight: 900;
      cursor: pointer;
      text-align: center;
      white-space: nowrap;
      transition: all 0.15s;
    }
    .fam-tab-btn.active {
      background: #1e293b;
      color: #fef08a;
      border-color: #38bdf8;
      box-shadow: 0 2px 8px rgba(0,0,0,0.4);
    }
    .fam-tab-pane {
      display: none;
      flex-direction: column;
      align-items: center;
      gap: 8px;
      width: 92vw;
      max-width: 540px;
    }
    .fam-tab-pane.active { display: flex; }

    .family-input-box { width:100%; padding:9px 12px; border-radius:12px; border:2px solid #38bdf8; background:#0f172a; color:#fff; font-size:0.94rem; font-weight:700; margin-bottom:6px; user-select:text; -webkit-user-select:text; }
    .family-input-box.editing-active { border-color:#facc15; background:#1e1b4b; }
    .fam-queue-list { display:flex; flex-direction:column; gap:6px; max-height:210px; overflow-y:auto; margin:6px 0; width:100%; }
    .fam-queue-item { display:flex; align-items:center; justify-content:space-between; gap:6px; background:#0f172a; border:2px solid #334155; border-radius:12px; padding:7px 10px; font-size:0.86rem; }
    .fam-queue-item.active-q { border-color:#22c55e; background:rgba(6,78,59,0.55); box-shadow:0 0 10px rgba(34,197,94,0.35); }
    .fam-queue-item.editing-q { border-color:#facc15; background:rgba(120,53,15,0.45); }
    .fam-q-title { flex:1; font-weight:800; color:#f8fafc; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; text-align:left; cursor:pointer; }
    .fam-q-badge { display:inline-block; padding:1px 6px; border-radius:6px; font-size:0.72rem; font-weight:900; margin-right:5px; background:#22c55e; color:#000; }
    .fam-view-pill { display:inline-block; padding:1px 6px; border-radius:6px; font-size:0.74rem; font-weight:800; margin-left:5px; background:#1e293b; color:#38bdf8; border:1px solid #38bdf8; }
    .fam-q-mini-btn { background:#1e293b; color:#fff; border:2px solid #64748b; border-radius:8px; padding:4px 7px; font-size:0.78rem; font-weight:800; cursor:pointer; }
    .fam-q-mini-btn:disabled { opacity:0.35; cursor:default; }
    .admin-drawer-toggle {
      width: 100%;
      background: #0f172a;
      color: #7dd3fc;
      border: 2px dashed #38bdf8;
      border-radius: 12px;
      padding: 7px 10px;
      font-size: 0.85rem;
      font-weight: 800;
      cursor: pointer;
      margin-bottom: 6px;
    }
  `;
  document.head.appendChild(styleEl);

  const homeHeaderPills = document.querySelector('#grid-screen .header-pills');
  if (homeHeaderPills) {
    const callsBtn = document.createElement('div');
    callsBtn.className = 'nav-pill-btn calls-pill active-tab';
    callsBtn.innerHTML = '📞 Family Calls';
    callsBtn.onclick = () => window.switchNanaMainTab('calls');
    homeHeaderPills.insertBefore(callsBtn, homeHeaderPills.firstChild);

    const videoBtn = document.createElement('div');
    videoBtn.className = 'nav-pill-btn video-pill-x';
    videoBtn.innerHTML = '🎬 Video';
    videoBtn.onclick = () => window.openVideoScreen();
    homeHeaderPills.insertBefore(videoBtn, $('clock') || null);
  }

  const tgHeader = document.querySelector('#bulletin-modal .tg-header');
  if (tgHeader) {
    tgHeader.innerHTML = `
      <div class="nana-nav-pills">
        <button class="nav-pill-btn calls-pill" onclick="switchNanaMainTab('calls')">📞 Family Calls</button>
        <button class="nav-pill-btn chat-pill-x active-tab">✈️ Family Chat</button>
        <button class="nav-pill-btn radio-pill-x" onclick="switchNanaMainTab('radio')">🎻 Classic FM</button>
        <button class="nav-pill-btn video-pill-x" onclick="switchNanaMainTab('video')">🎬 Video</button>
      </div>
      <div id="tg-send-status" style="font-size:0.95rem;color:#4ade80;font-weight:800;">🟢 Connected to Family Group</div>
    `;
  }

  const radioTopRow = document.querySelector('#radio-screen > div:first-child');
  if (radioTopRow) {
    radioTopRow.innerHTML = `
      <div class="nana-nav-pills">
        <button class="nav-pill-btn calls-pill" onclick="switchNanaMainTab('calls')">📞 Family Calls</button>
        <button class="nav-pill-btn chat-pill-x" onclick="switchNanaMainTab('chat')">✈️ Family Chat</button>
        <button class="nav-pill-btn radio-pill-x active-tab">🎻 Classic FM</button>
        <button class="nav-pill-btn video-pill-x" onclick="switchNanaMainTab('video')">🎬 Video</button>
      </div>
      <div id="radio-status-label" style="font-size:1.45rem;font-weight:900;color:var(--text-accent);">Radio Off</div>
    `;
  }

  const videoScreen = document.createElement('div');
  videoScreen.id = 'video-screen';
  videoScreen.className = 'screen';
  videoScreen.innerHTML = `
    <div class="nana-top-nav">
      <div class="nana-nav-pills">
        <button class="nav-pill-btn calls-pill" onclick="switchNanaMainTab('calls')">📞 Family Calls</button>
        <button class="nav-pill-btn chat-pill-x" onclick="switchNanaMainTab('chat')">✈️ Family Chat</button>
        <button class="nav-pill-btn radio-pill-x" onclick="switchNanaMainTab('radio')">🎻 Classic FM</button>
        <button class="nav-pill-btn video-pill-x active-tab">🎬 Video</button>
      </div>
      <div id="video-title-banner" style="font-size:1.3rem;font-weight:900;color:var(--text-accent);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">🎬 Family Video Player</div>
    </div>
    <div class="video-stage-box" id="video-stage-touch" onclick="handleVideoStageTap(event)">
      <video id="nana-video-el" crossorigin="anonymous" playsinline preload="metadata"></video>
      <div id="video-tap-overlay">
        <div id="video-overlay-icon" style="font-size:4.2rem;">▶️</div>
        <div id="video-overlay-main">Tap Screen to Play Video</div>
        <div id="video-overlay-sub" style="font-size:1.35rem;color:#cbd5e1;font-weight:700;">Touching the screen while playing pauses the video</div>
      </div>
    </div>
    <div class="video-bottom-bar">
      <div style="font-size:1.35rem;font-weight:900;color:var(--text-accent);">🔊 Video Vol: <span id="nana-video-vol-display">80%</span></div>
      <div style="display:flex;gap:12px;">
        <button class="vol-step-btn" style="font-size:1.45rem;padding:10px 22px;" onclick="adjustNanaVideoVolume(-15)">🔉 Quieter</button>
        <button class="vol-step-btn" style="font-size:1.45rem;padding:10px 22px;background:#0284c7;" onclick="adjustNanaVideoVolume(15)">🔊 Louder</button>
      </div>
      <div style="display:flex;gap:10px;">
        <button id="btn-bottom-video-toggle" class="cancel-btn" style="font-size:1.35rem;padding:10px 22px;background:#059669;border-color:#4ade80;color:#fff;" onclick="toggleNanaVideoPlayback()">▶️ Play Video</button>
        <button class="cancel-btn" style="font-size:1.2rem;padding:10px 16px;background:#334155;border-color:#94a3b8;color:#fff;" onclick="restartNanaVideoFromBeginning()">⏮️ Restart</button>
      </div>
    </div>
  `;
  document.body.appendChild(videoScreen);

  const qModal = document.createElement('div');
  qModal.id = 'nana-question-modal';
  qModal.innerHTML = `
    <div class="q-popup-card">
      <div class="q-sender-badge" id="q-popup-sender">💬 Question from Family</div>
      <div class="q-main-text" id="q-popup-text">Would you like a cup of tea?</div>
      <div class="q-btn-row">
        <button class="q-giant-choice q-yes-btn" onclick="submitNanaQuestionAnswer('YES')">✅ YES</button>
        <button class="q-giant-choice q-no-btn" onclick="submitNanaQuestionAnswer('NO')">✖ NO</button>
      </div>
    </div>
  `;
  document.body.appendChild(qModal);

  // --- REORGANIZE FAMILY SCREEN TABS: 1. AVAILABILITY -> 2. ASK NANA -> 3. ENTERTAINMENT ---
  const famScreen = $('family-screen');
  if (famScreen) {
    const hideCard = $('hide-me-card');
    const hoursCard = $('call-hours-card');
    const allCards = Array.from(famScreen.querySelectorAll('.settings-card'));
    const radioCard = allCards.find(c => c.id !== 'hide-me-card' && c.id !== 'call-hours-card');
    const bottomRows = Array.from(famScreen.children).filter(el => el.tagName === 'DIV' && !el.id && !el.classList.contains('settings-card') && el !== famScreen.firstElementChild);
    const chatAndControlsRow = bottomRows[0];
    const tgAndGuideRow = bottomRows[1];

    const qCard = document.createElement('div');
    qCard.className = 'settings-card';
    qCard.style.cssText = 'width:100%;margin-bottom:0;padding:12px;';
    qCard.innerHTML = `
      <div class="settings-label" style="font-size:1.02rem;">
        <span>❓ Pop-Up Yes/No Question on Nana's Screen</span>
        <span id="fam-q-status" style="font-size:0.85rem;color:#38bdf8;">Idle</span>
      </div>
      <div class="settings-sub" style="margin-bottom:8px;">Pops up a giant Yes/No question on Nana's screen and posts her answer to Family Chat.</div>
      <input id="fam-q-input" class="family-input-box" type="text" placeholder="Type a Yes/No question for Nana..." />
      <div class="opt-row" style="margin-bottom:8px;">
        <button id="btn-q-voice-loud" class="opt-btn selected" style="padding:7px 8px;font-size:0.86rem;" onclick="setFamilyQuestionSilentMode(false)">🔊 Read Aloud</button>
        <button id="btn-q-voice-silent" class="opt-btn" style="padding:7px 8px;font-size:0.86rem;" onclick="setFamilyQuestionSilentMode(true)">🔇 Silent Pop-Up</button>
      </div>
      <div class="opt-row">
        <button class="opt-btn" style="background:#059669;border-color:#4ade80;color:#fff;" onclick="sendQuestionToNana()">📤 Send Pop-Up</button>
        <button class="opt-btn" style="background:#7f1d1d;border-color:#f87171;color:#fff;flex:0.45;" onclick="clearQuestionOnNana()">✖ Clear</button>
      </div>
    `;

    const adminEditorHtml = isAdminFamily ? `
      <button id="btn-toggle-admin-drawer" class="admin-drawer-toggle" onclick="toggleAdminVideoDrawer()">➕ Add / Edit Video Links & Sort Queue ▾</button>
      <div id="fam-admin-video-editor" style="display:none;background:#090d16;border:1px solid #334155;border-radius:12px;padding:8px;margin-bottom:6px;">
        <input id="fam-vid-title" class="family-input-box" type="text" placeholder="Video Title (e.g. Judge John Deed - Ep 1)" />
        <input id="fam-vid-url" class="family-input-box" type="url" placeholder="Video URL (https://server/video.mkv or .mp4)" />
        <input id="fam-vid-sub" class="family-input-box" type="url" placeholder="Optional Subtitles URL (.vtt or .srt)" />
        <div id="fam-vid-add-row" class="opt-row" style="margin-bottom:6px;">
          <button class="opt-btn" style="background:#0284c7;border-color:#7dd3fc;color:#fff;" onclick="addVideoToQueue(false)">➕ Add to Queue</button>
          <button class="opt-btn" style="background:#7c3aed;border-color:#c4b5fd;color:#fff;" onclick="addVideoToQueue(true)">▶️ Add & Play Now</button>
        </div>
        <div id="fam-vid-edit-row" class="opt-row" style="margin-bottom:6px;display:none;">
          <button class="opt-btn" style="background:#d97706;border-color:#fef08a;color:#000;" onclick="saveEditedQueueItem()">💾 Save Changes</button>
          <button class="opt-btn" style="background:#334155;border-color:#94a3b8;color:#fff;flex:0.45;" onclick="cancelEditQueueItem()">✖ Cancel</button>
        </div>
        <div class="opt-row">
          <button class="opt-btn" style="padding:5px 4px;font-size:0.78rem;" onclick="sortVideoQueue('alpha_asc')">🔤 A–Z</button>
          <button class="opt-btn" style="padding:5px 4px;font-size:0.78rem;" onclick="sortVideoQueue('alpha_desc')">🔤 Z–A</button>
          <button class="opt-btn" style="padding:5px 4px;font-size:0.78rem;" onclick="sortVideoQueue('views_asc')">👁️ Views ↑</button>
          <button class="opt-btn" style="padding:5px 4px;font-size:0.78rem;" onclick="sortVideoQueue('views_desc')">👁️ Views ↓</button>
        </div>
      </div>
    ` : '';

    const vCard = document.createElement('div');
    vCard.className = 'settings-card';
    vCard.style.cssText = 'width:100%;margin-bottom:0;padding:10px 12px;';
    vCard.innerHTML = `
      <div class="settings-label" style="font-size:1.02rem;">
        <span id="fam-vid-form-heading">🎬 Video Queue on Nana's Tablet</span>
        <span id="fam-vid-status" style="font-size:0.85rem;color:#4ade80;">Stopped</span>
      </div>
      ${adminEditorHtml}
      <div id="fam-queue-container" class="fam-queue-list"></div>
      <div class="opt-row">
        <button class="opt-btn" style="background:#334155;border-color:#94a3b8;color:#fff;flex:0.6;" onclick="remoteCommandVideo('prev')">⏮️ Prev</button>
        <button class="opt-btn" style="background:#059669;border-color:#4ade80;color:#fff;" onclick="remoteCommandVideo('play')">▶️ Play</button>
        <button class="opt-btn" style="background:#b45309;border-color:#fde047;color:#fff;" onclick="remoteCommandVideo('pause')">⏸️ Pause</button>
        <button class="opt-btn" style="background:#334155;border-color:#94a3b8;color:#fff;flex:0.6;" onclick="remoteCommandVideo('next')">⏭️ Next</button>
      </div>
    `;

    if (chatAndControlsRow) {
      famScreen.insertBefore(chatAndControlsRow, hideCard || null);
    }

    // Tabs order: 1. Availability (active first) -> 2. Ask Nana -> 3. Entertainment (last)
    const tabsBar = document.createElement('div');
    tabsBar.className = 'fam-tabs-bar';
    tabsBar.innerHTML = `
      <button id="fam-tab-btn-avail" class="fam-tab-btn active" onclick="switchFamilyPortalTab('avail')">⏰ Availability</button>
      <button id="fam-tab-btn-ask" class="fam-tab-btn" onclick="switchFamilyPortalTab('ask')">❓ Ask Nana</button>
      <button id="fam-tab-btn-media" class="fam-tab-btn" onclick="switchFamilyPortalTab('media')">🎬 Entertainment</button>
    `;

    const paneAvail = document.createElement('div');
    paneAvail.id = 'fam-pane-avail';
    paneAvail.className = 'fam-tab-pane active';
    if (hideCard) {
      hideCard.style.width = '100%';
      hideCard.style.marginBottom = '0';
      paneAvail.appendChild(hideCard);
    }
    if (hoursCard) {
      hoursCard.style.width = '100%';
      hoursCard.style.marginBottom = '0';
      paneAvail.appendChild(hoursCard);
    }
    if (tgAndGuideRow) {
      tgAndGuideRow.style.width = '100%';
      paneAvail.appendChild(tgAndGuideRow);
    }

    const paneAsk = document.createElement('div');
    paneAsk.id = 'fam-pane-ask';
    paneAsk.className = 'fam-tab-pane';
    paneAsk.appendChild(qCard);

    const paneMedia = document.createElement('div');
    paneMedia.id = 'fam-pane-media';
    paneMedia.className = 'fam-tab-pane';
    if (radioCard) {
      radioCard.style.width = '100%';
      radioCard.style.marginBottom = '0';
      paneMedia.appendChild(radioCard);
    }
    paneMedia.appendChild(vCard);

    famScreen.appendChild(tabsBar);
    famScreen.appendChild(paneAvail);
    famScreen.appendChild(paneAsk);
    famScreen.appendChild(paneMedia);
  }

  window.switchFamilyPortalTab = (tab) => {
    ['avail', 'ask', 'media'].forEach(t => {
      $(`fam-tab-btn-${t}`)?.classList.toggle('active', t === tab);
      $(`fam-pane-${t}`)?.classList.toggle('active', t === tab);
    });
  };

  window.toggleAdminVideoDrawer = (forceOpen = null) => {
    const drawer = $('fam-admin-video-editor');
    const btn = $('btn-toggle-admin-drawer');
    if (!drawer) return;
    const nextOpen = forceOpen !== null ? forceOpen : (drawer.style.display === 'none');
    drawer.style.display = nextOpen ? 'block' : 'none';
    if (btn) {
      btn.innerText = nextOpen
        ? '🔼 Hide Add / Edit & Sort Controls'
        : '➕ Add / Edit Video Links & Sort Queue ▾';
    }
  };

  // --- INJECT TIME-OF-DAY POP-UP SCHEDULES INTO SHARED SETTINGS MODAL ---
  const sharedSettingsMount = $('shared-settings-cards');
  if (sharedSettingsMount) {
    const buildIntervalBtns = (settingKey, options) => options.map(([val, lbl]) =>
      `<button class="opt-btn" data-ppset="${settingKey}" data-ppval="${val}" onclick="updatePeriodicPopupSetting('${settingKey}', ${val})">${lbl}</button>`
    ).join('');

    const buildHourToggles = (listKey, hours) => hours.map(h =>
      `<button class="opt-btn" data-pphourlist="${listKey}" data-pphour="${h}" onclick="toggleScheduledPromptHour('${listKey}', ${h})">${String(h).padStart(2, '0')}:00</button>`
    ).join('');

    const periodicCard = document.createElement('div');
    periodicCard.className = 'settings-card';
    periodicCard.innerHTML = `
      <div class="settings-label">
        <span>⏰ Scheduled Pop-Up Prompts (Times of Day)</span>
        <span id="lbl-periodic-summary" style="color:#38bdf8;font-size:0.88rem;">Active</span>
      </div>
      <div class="settings-sub">Choose times of day to ask Nana if she wants Classic FM or Judge John Deed (when she's idle), plus unread chat reminders.</div>
      <div class="opt-row" style="margin-bottom:8px;">
        <button class="opt-btn" data-ppset="periodicPopupsEnabled" data-ppval="true" onclick="updatePeriodicPopupSetting('periodicPopupsEnabled', true)">✅ Pop-Ups ON</button>
        <button class="opt-btn" data-ppset="periodicPopupsEnabled" data-ppval="false" onclick="updatePeriodicPopupSetting('periodicPopupsEnabled', false)">🔕 All Pop-Ups OFF</button>
      </div>
      <div class="settings-sub" style="margin-bottom:4px;">🎻 Classic FM Radio Prompt Times (Tap hours to toggle on/off):</div>
      <div class="opt-row" style="margin-bottom:8px;">
        ${buildHourToggles('radioPromptHours', [9, 10, 11, 13, 14, 15, 16, 19])}
        <button class="opt-btn" style="background:#7f1d1d;color:#fff;" onclick="clearScheduledPromptHours('radioPromptHours')">Off</button>
      </div>
      <div class="settings-sub" style="margin-bottom:4px;">🎬 Judge John Deed Video Prompt Times (Tap hours to toggle on/off):</div>
      <div class="opt-row" style="margin-bottom:8px;">
        ${buildHourToggles('videoPromptHours', [11, 14, 16, 17, 18, 19, 20])}
        <button class="opt-btn" style="background:#7f1d1d;color:#fff;" onclick="clearScheduledPromptHours('videoPromptHours')">Off</button>
      </div>
      <div class="settings-sub" style="margin-bottom:4px;">💬 Unread Family Chat Reminder ("You have unread messages, would you like to read them?"):</div>
      <div class="opt-row" style="margin-bottom:8px;">
        ${buildIntervalBtns('unreadChatPopupMin', [[0,'Off'],[15,'15m'],[30,'30m'],[60,'1h'],[120,'2h']])}
      </div>
      <div class="settings-sub" style="margin-bottom:4px;">🗣️ Pop-Up Question & Prompt Voice:</div>
      <div class="opt-row">
        <button id="global-q-voice-on" class="opt-btn selected" onclick="setGlobalQuestionSpeak(true)">🔊 Read Prompts Aloud</button>
        <button id="global-q-voice-off" class="opt-btn" onclick="setGlobalQuestionSpeak(false)">🔇 Silent Pop-Ups Only</button>
      </div>
    `;
    sharedSettingsMount.appendChild(periodicCard);
  }

  const videoEl = $('nana-video-el');
  let videoVolume = 80, speakQuestionsDefault = true, familyComposerSilent = false;
  let periodicConfig = {
    periodicPopupsEnabled: true,
    unreadChatPopupMin: 30,
    radioPromptHours: [10, 15],
    videoPromptHours: [14, 19],
    nightModeEnabled: true,
    nightStartHour: 21,
    nightEndHour: 8,
    bulletinClearedAt: 0
  };
  let currentStreamData = { queue: [], currentIndex: 0, state: "paused", savedTimes: {}, viewCounts: {} };
  let latestPresenceSnap = {}, latestBulletinSnap = {}, latestCallSnap = { status: 'idle' }, latestEntSnap = { activeKey: 'off' };
  let editingQueueIndex = null;
  let lastLoadedVideoUrl = "", lastLoadedSubUrl = "", activeSubBlobUrl = null;
  let lastSavedTimeSec = 0, activeQuestionData = null, screenWakeLock = null;

  let lastActivityOrCallMs = Date.now();
  let lastUnreadChatPromptMs = Date.now();
  let lastAnyPeriodicPromptMs = 0;

  window.addEventListener('pointerdown', () => { lastActivityOrCallMs = Date.now(); }, { passive: true });

  function parseHoursArray(val, fallback) {
    if (Array.isArray(val)) return val.map(Number).filter(n => !isNaN(n));
    if (val && typeof val === 'object') return Object.values(val).map(Number).filter(n => !isNaN(n));
    if (val === 'none') return [];
    return fallback;
  }

  function refreshPeriodicSettingsUI() {
    document.querySelectorAll('[data-ppset]').forEach(btn => {
      const k = btn.dataset.ppset, v = btn.dataset.ppval;
      btn.classList.toggle('selected', String(periodicConfig[k]) === String(v));
    });
    ['radioPromptHours', 'videoPromptHours'].forEach(listKey => {
      const arr = periodicConfig[listKey] || [];
      document.querySelectorAll(`[data-pphourlist="${listKey}"]`).forEach(btn => {
        const hr = Number(btn.dataset.pphour);
        btn.classList.toggle('selected', arr.includes(hr));
      });
    });
    const sumEl = $('lbl-periodic-summary');
    if (sumEl) {
      if (!periodicConfig.periodicPopupsEnabled) {
        sumEl.innerText = '🔕 All Off';
        sumEl.style.color = '#fca5a5';
      } else {
        const rHrs = (periodicConfig.radioPromptHours || []).map(h => `${String(h).padStart(2,'0')}:00`).join(', ') || 'Off';
        const vHrs = (periodicConfig.videoPromptHours || []).map(h => `${String(h).padStart(2,'0')}:00`).join(', ') || 'Off';
        sumEl.innerText = `Radio [${rHrs}] • Video [${vHrs}]`;
        sumEl.style.color = '#38bdf8';
      }
    }
  }

  window.updatePeriodicPopupSetting = async (key, val) => {
    periodicConfig[key] = val;
    refreshPeriodicSettingsUI();
    await update(settingsRef, { [key]: val });
  };

  window.toggleScheduledPromptHour = async (listKey, hour) => {
    const cur = [...(periodicConfig[listKey] || [])];
    const idx = cur.indexOf(hour);
    if (idx >= 0) cur.splice(idx, 1);
    else cur.push(hour);
    cur.sort((a, b) => a - b);
    periodicConfig[listKey] = cur;
    refreshPeriodicSettingsUI();
    await update(settingsRef, { [listKey]: cur.length ? cur : 'none' });
  };

  window.clearScheduledPromptHours = async (listKey) => {
    periodicConfig[listKey] = [];
    refreshPeriodicSettingsUI();
    await update(settingsRef, { [listKey]: 'none' });
  };

  // --- TABLET DISCONNECT, WIFI, BACKGROUND & BATTERY TELEMETRY ---
  if (role === 'nana') {
    onValue(connectedInfoRef, snap => {
      if (snap.val() === true) {
        const od = onDisconnect(presenceRef);
        od.update({ online: false, disconnectedAt: Date.now() }).catch(() => {});
        update(presenceRef, {
          online: true,
          appState: document.visibilityState === 'hidden' ? 'backgrounded' : 'foreground',
          networkOnline: navigator.onLine !== false,
          lastConnectedAt: Date.now()
        }).catch(() => {});
      }
    });

    document.addEventListener('visibilitychange', () => {
      const isHidden = document.visibilityState === 'hidden';
      update(presenceRef, {
        appState: isHidden ? 'backgrounded' : 'foreground',
        appStateChangedAt: Date.now(),
        lastExitHint: isHidden ? 'backed_out_or_notification' : 'active_in_app'
      }).catch(() => {});
    });

    window.addEventListener('blur', () => {
      if (document.visibilityState !== 'hidden') {
        update(presenceRef, {
          appState: 'shade_or_overlay',
          appStateChangedAt: Date.now(),
          lastExitHint: 'notification_shade_or_overlay'
        }).catch(() => {});
      }
    });

    window.addEventListener('focus', () => {
      update(presenceRef, {
        appState: 'foreground',
        appStateChangedAt: Date.now(),
        lastExitHint: 'active_in_app'
      }).catch(() => {});
    });

    window.addEventListener('offline', () => {
      update(presenceRef, {
        networkOnline: false,
        lastExitHint: 'wifi_turned_off',
        wifiDroppedAt: Date.now()
      }).catch(() => {});
    });

    window.addEventListener('online', () => {
      update(presenceRef, {
        online: true,
        networkOnline: true,
        lastExitHint: 'active_in_app'
      }).catch(() => {});
    });

    window.addEventListener('pagehide', () => {
      update(presenceRef, {
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
    if ($('bulletin-modal')?.style.display === 'flex') {
      screenState = $('bulletin-modal')?.classList.contains('kb-fullscreen') ? 'chat_typing' : 'chat';
    } else if ($('video-screen')?.classList.contains('active')) {
      screenState = (videoEl && !videoEl.paused && !videoEl.ended) ? 'video_playing' : 'video_paused';
    } else if ($('radio-screen')?.classList.contains('active')) {
      screenState = 'radio';
    }
    update(presenceRef, {
      online: true,
      currentScreen: screenState,
      appState: document.visibilityState === 'hidden' ? 'backgrounded' : 'foreground'
    }).catch(() => {});
  }

  if (role === 'nana') {
    setInterval(broadcastNanaCurrentScreen, 10000);
    setTimeout(broadcastNanaCurrentScreen, 1500);
  }

  // --- CONCISE SINGLE-STATUS REPLACE ON FAMILY PRESENCE CARD ---
  function getSimpleNanaStatusSummary() {
    const p = latestPresenceSnap || {};
    const now = Date.now();
    const lastSeenMs = Math.max(Number(p.lastPing || 0), Number(p.disconnectedAt || 0), Number(p.appStateChangedAt || 0));
    const silenceSec = lastSeenMs ? Math.floor((now - Number(p.lastPing || lastSeenMs)) / 1000) : 0;
    const isOffline = (p.online === false) || (p.lastPing && silenceSec > 75);
    const batt = p.batteryLevel != null ? Number(p.batteryLevel) : null;
    const charging = !!p.isCharging;

    // 1. In a Call or Ringing
    const st = latestCallSnap?.status || 'idle';
    if (st !== 'idle') {
      const otherId = latestCallSnap.callerId === 'nana' ? latestCallSnap.targetId : latestCallSnap.callerId;
      const withName = FAMILY_NAMES[otherId] || 'Family';
      return {
        border: '#f87171',
        text: st === 'connected' ? `🔴 In a call with ${withName}` : `🟡 Ringing (${withName})`
      };
    }

    // 2. Disconnected or Left the App
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

    // 3. Watching a Video
    const curItem = getCurrentQueueItem();
    const scr = p.currentScreen || 'home';
    if ((currentStreamData.state === 'playing' && curItem) || scr === 'video_playing') {
      return {
        border: '#a855f7',
        text: `🎬 Video is playing${curItem?.item?.title ? ` (${curItem.item.title})` : ''}`
      };
    }

    // 4. Listening to the Radio
    if (latestEntSnap?.activeKey && latestEntSnap.activeKey !== 'off') {
      return { border: '#22c55e', text: `🎻 Listening to the radio` };
    }

    // 5. On the Family Chat (Reading or Typing)
    if (scr === 'chat_typing') {
      return { border: '#38bdf8', text: `⌨️ On the family chat (typing)` };
    }
    if (scr === 'chat') {
      return { border: '#38bdf8', text: `✈️ On the family chat (reading)` };
    }

    // 6. Idle / Not doing anything
    return { border: '#22c55e', text: `🟢 Not doing anything` };
  }

  function applySimpleFamilyPresenceCard() {
    if (role !== 'family') return;
    const card = $('nana-presence-card');
    if (!card) return;

    const summary = getSimpleNanaStatusSummary();
    card.style.borderColor = summary.border;

    // Keep the existing touch/battery span & Telegram status span from app.js, but replace the clutter above them with 1 status line
    const spans = Array.from(card.querySelectorAll('span'));
    const touchBattHtml = spans[0] ? spans[0].outerHTML : '';
    const tgStatusHtml = spans[1] ? `<br>${spans[1].outerHTML}` : '';

    const cleanHtml = `<div style="font-size:1.05rem;font-weight:900;color:#fef08a;margin-bottom:2px;">${summary.text}</div>${touchBattHtml}${tgStatusHtml}`;
    if (card.innerHTML !== cleanHtml) {
      card.innerHTML = cleanHtml;
    }
  }

  if (role === 'family') {
    onValue(presenceRef, snap => {
      latestPresenceSnap = snap.val() || {};
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

  function isNanaVideoActivelyPlaying() {
    return !!(role === 'nana' && videoEl && !videoEl.paused && !videoEl.ended && $('video-screen')?.classList.contains('active'));
  }

  async function requestVideoWakeLock() {
    if (role !== 'nana' || !('wakeLock' in navigator)) return;
    try {
      if (!screenWakeLock) {
        screenWakeLock = await navigator.wakeLock.request('screen');
        screenWakeLock.addEventListener('release', () => { screenWakeLock = null; });
      }
    } catch (_) {}
  }

  function releaseVideoWakeLock() {
    if (screenWakeLock) { screenWakeLock.release().catch(() => {}); screenWakeLock = null; }
  }

  const origWakeFn = window.wakeScreenAndResetDimTimer;
  function keepScreenAwakeIfPlayingVideo() {
    if (!isNanaVideoActivelyPlaying()) return;
    const overlay = $('brightness-overlay');
    if (overlay) { overlay.style.opacity = '0'; overlay.style.pointerEvents = 'none'; }
    if ($('night-dimmer') && $('night-dimmer').style.display !== 'none') window.wakeFromNightMode?.();
    origWakeFn?.();
  }

  function startNormalDimCountdownOnPause() {
    releaseVideoWakeLock();
    origWakeFn?.();
  }

  setInterval(() => { if (isNanaVideoActivelyPlaying()) keepScreenAwakeIfPlayingVideo(); }, 5000);

  window.setFamilyQuestionSilentMode = (silent) => {
    familyComposerSilent = !!silent;
    $('btn-q-voice-loud')?.classList.toggle('selected', !familyComposerSilent);
    $('btn-q-voice-silent')?.classList.toggle('selected', familyComposerSilent);
  };

  window.setGlobalQuestionSpeak = async (speakOn) => {
    speakQuestionsDefault = !!speakOn;
    window.setFamilyQuestionSilentMode(!speakQuestionsDefault);
    $('global-q-voice-on')?.classList.toggle('selected', speakQuestionsDefault);
    $('global-q-voice-off')?.classList.toggle('selected', !speakQuestionsDefault);
    await update(settingsRef, { speakQuestions: speakQuestionsDefault });
  };

  function normalizeStreamData(raw) {
    const d = raw || {};
    let queue = Array.isArray(d.queue) ? d.queue.filter(Boolean)
      : (d.queue && typeof d.queue === 'object' ? Object.values(d.queue).filter(Boolean)
      : (d.url ? [{ id: 'v_legacy', url: d.url, title: d.title || 'Family Video', subtitleUrl: d.subtitleUrl || '' }] : []));
    const viewCounts = (d.viewCounts && typeof d.viewCounts === 'object') ? { ...d.viewCounts } : {};
    queue = queue.map((item, idx) => {
      const id = item.id || `vid_item_${idx}`;
      return {
        id,
        title: item.title || `Video ${idx + 1}`,
        url: item.url || '',
        subtitleUrl: item.subtitleUrl || '',
        views: Number(viewCounts[id] ?? item.views ?? 0)
      };
    });
    const currentIndex = queue.length ? Math.max(0, Math.min(queue.length - 1, Number(d.currentIndex) || 0)) : 0;
    const savedTimes = (d.savedTimes && typeof d.savedTimes === 'object') ? { ...d.savedTimes } : {};
    return { queue, currentIndex, state: d.state || 'paused', savedTimes, viewCounts };
  }

  function getCurrentQueueItem(data = currentStreamData) {
    if (!data.queue || !data.queue.length) return null;
    const idx = Math.max(0, Math.min(data.queue.length - 1, Number(data.currentIndex) || 0));
    return { item: data.queue[idx], index: idx, total: data.queue.length };
  }

  function getSavedTimeForItem(item, idx, data = currentStreamData) {
    if (!item) return 0;
    const localSec = item.url ? Number(localStorage.getItem(`nana_vid_pos_${item.url}`) || 0) : 0;
    const byId = Number(data.savedTimes?.[item.id] ?? data.savedTimes?.[idx] ?? 0);
    return Math.max(localSec, byId);
  }

  function getViewCountForItem(item, data = currentStreamData) {
    if (!item) return 0;
    return Number(data.viewCounts?.[item.id] ?? item.views ?? 0);
  }

  function applyVideoVolume(volPct) {
    videoVolume = Math.max(10, Math.min(100, Number(volPct) || 80));
    if ($('nana-video-vol-display')) $('nana-video-vol-display').innerText = `${videoVolume}%`;
    if (videoEl) videoEl.volume = Math.min(1.0, Math.max(0.1, videoVolume / 100));
    if (role === 'nana' && !videoEl?.paused) window.AndroidBridge?.updateTabletHardwareSettings?.(videoVolume, 85, 120, 0.9);
  }

  window.adjustNanaVideoVolume = async (delta) => {
    const nextVol = Math.max(10, Math.min(100, videoVolume + delta));
    applyVideoVolume(nextVol);
    await update(settingsRef, { videoVolume: nextVol });
  };

  onValue(settingsRef, snap => {
    const s = snap.val();
    if (!s) return;
    if (s.videoVolume !== undefined) applyVideoVolume(s.videoVolume);
    if (s.speakQuestions !== undefined) {
      speakQuestionsDefault = !!s.speakQuestions;
      $('global-q-voice-on')?.classList.toggle('selected', speakQuestionsDefault);
      $('global-q-voice-off')?.classList.toggle('selected', !speakQuestionsDefault);
      window.setFamilyQuestionSilentMode(!speakQuestionsDefault);
    }
    ['periodicPopupsEnabled', 'unreadChatPopupMin', 'nightModeEnabled', 'nightStartHour', 'nightEndHour', 'bulletinClearedAt'].forEach(k => {
      if (s[k] !== undefined) periodicConfig[k] = s[k];
    });
    if (s.radioPromptHours !== undefined) {
      periodicConfig.radioPromptHours = parseHoursArray(s.radioPromptHours, [10, 15]);
    }
    if (s.videoPromptHours !== undefined) {
      periodicConfig.videoPromptHours = parseHoursArray(s.videoPromptHours, [14, 19]);
    }
    refreshPeriodicSettingsUI();
  });

  onValue(query(bulletinRef, limitToLast(25)), snap => {
    latestBulletinSnap = snap.val() || {};
  });

  onValue(entertainmentRef, snap => {
    latestEntSnap = snap.val() || { activeKey: 'off' };
    if (role === 'family') setTimeout(applySimpleFamilyPresenceCard, 20);
  });

  // --- TIME-OF-DAY & UNREAD CHAT POP-UP ENGINE ---
  function isInNightModeWindow() {
    if (!periodicConfig.nightModeEnabled) return false;
    const h = new Date().getHours();
    const s = Number(periodicConfig.nightStartHour ?? 21);
    const e = Number(periodicConfig.nightEndHour ?? 8);
    return s > e ? (h >= s || h < e) : (h >= s && h < e);
  }

  function hasUnreadFamilyChatMessages() {
    const clearedAt = Number(periodicConfig.bulletinClearedAt) || 0;
    return Object.values(latestBulletinSnap).some(item => {
      if (!item) return false;
      const isOut = !!item.fromNana || item.author?.toLowerCase() === 'nana';
      if (isOut) return false;
      if (item.readByNanaAt || (Number(item.timestamp) || 0) <= clearedAt) return false;
      return true;
    });
  }

  async function evaluateScheduledPopupsOnNana() {
    if (role !== 'nana') return;
    if (!periodicConfig.periodicPopupsEnabled) return;
    if (isInNightModeWindow()) return;
    if (latestCallSnap?.status && latestCallSnap.status !== 'idle') return;
    if ($('nana-question-modal')?.style.display === 'flex') return;
    if ($('confirm-modal')?.style.display === 'flex') return;

    const now = Date.now();
    if (now - lastAnyPeriodicPromptMs < 120000) return;

    const chatOpen = $('bulletin-modal')?.style.display === 'flex';
    const radioOpenOrPlaying = $('radio-screen')?.classList.contains('active') || (latestEntSnap?.activeKey && latestEntSnap.activeKey !== 'off');
    const videoPlaying = isNanaVideoActivelyPlaying();

    // 1. Unread Family Chat Prompt
    const unreadMin = Number(periodicConfig.unreadChatPopupMin ?? 30);
    if (unreadMin > 0 && !chatOpen && !videoPlaying && hasUnreadFamilyChatMessages()) {
      if (now - lastUnreadChatPromptMs >= unreadMin * 60000) {
        lastUnreadChatPromptMs = now;
        lastAnyPeriodicPromptMs = now;
        await set(quickQuestionRef, {
          id: `q_unread_${now}`,
          type: 'unread_chat_prompt',
          question: 'You have unread messages, would you like to read them?',
          askedBy: 'Family Chat',
          silent: !speakQuestionsDefault,
          status: 'pending',
          answer: null,
          askedAt: now
        });
        return;
      }
    }

    // Only trigger scheduled Radio / Video prompts if Nana is not already busy and hasn't touched the screen in the last 3 minutes
    if (chatOpen || radioOpenOrPlaying || videoPlaying) return;
    if (now - lastActivityOrCallMs < 180000) return;

    const d = new Date();
    const curHour = d.getHours();
    const curMin = d.getMinutes();
    const dateKey = `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}_${curHour}`;

    // Trigger within the first 20 minutes of any scheduled hour (once per scheduled hour per day)
    if (curMin <= 20) {
      // 2. Scheduled Time-of-Day Classic FM Prompt
      if ((periodicConfig.radioPromptHours || []).includes(curHour)) {
        const storageKey = `nana_sched_radio_${dateKey}`;
        if (!localStorage.getItem(storageKey)) {
          localStorage.setItem(storageKey, '1');
          lastAnyPeriodicPromptMs = now;
          await set(quickQuestionRef, {
            id: `q_schedradio_${now}`,
            type: 'idle_radio_prompt',
            question: 'Would you like to listen to Classic FM?',
            askedBy: 'Classic FM Radio',
            silent: !speakQuestionsDefault,
            status: 'pending',
            answer: null,
            askedAt: now
          });
          return;
        }
      }

      // 3. Scheduled Time-of-Day Judge John Deed Video Prompt
      if ((periodicConfig.videoPromptHours || []).includes(curHour)) {
        const storageKey = `nana_sched_video_${dateKey}`;
        if (!localStorage.getItem(storageKey)) {
          localStorage.setItem(storageKey, '1');
          lastAnyPeriodicPromptMs = now;
          await set(quickQuestionRef, {
            id: `q_schedvideo_${now}`,
            type: 'idle_video_prompt',
            question: 'Would you like to watch Judge John Deed?',
            askedBy: 'Video Player',
            silent: !speakQuestionsDefault,
            status: 'pending',
            answer: null,
            askedAt: now
          });
        }
      }
    }
  }

  if (role === 'nana') {
    setInterval(evaluateScheduledPopupsOnNana, 20000);
  }

  async function attachSubtitleTrack(subUrl, forceReload = false) {
    if (!videoEl) return;
    if (!forceReload && subUrl === lastLoadedSubUrl) return;
    lastLoadedSubUrl = subUrl;
    videoEl.querySelectorAll('track').forEach(t => t.remove());
    if (activeSubBlobUrl) { URL.revokeObjectURL(activeSubBlobUrl); activeSubBlobUrl = null; }
    if (!subUrl) return;

    let trackSrc = subUrl;
    try {
      const res = await fetch(subUrl);
      if (res.ok) {
        let text = await res.text();
        if (!text.trim().startsWith('WEBVTT')) {
          text = 'WEBVTT\n\n' + text.replace(/\r\n/g, '\n').replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, '$1.$2');
        }
        activeSubBlobUrl = URL.createObjectURL(new Blob([text], { type: 'text/vtt' }));
        trackSrc = activeSubBlobUrl;
      }
    } catch (_) { trackSrc = subUrl; }

    const track = document.createElement('track');
    track.kind = 'subtitles'; track.label = 'English'; track.srclang = 'en'; track.default = true;
    track.src = trackSrc;
    videoEl.appendChild(track);
    const enableTrack = () => { if (videoEl.textTracks?.[0]) videoEl.textTracks[0].mode = 'showing'; };
    track.addEventListener('load', enableTrack);
    setTimeout(enableTrack, 300);
  }

  const origOpenBulletin = window.openFamilyBulletin;
  if (origOpenBulletin) window.openFamilyBulletin = () => { origOpenBulletin(); broadcastNanaCurrentScreen(); };
  const origCloseBulletin = window.closeFamilyBulletin;
  if (origCloseBulletin) window.closeFamilyBulletin = () => { origCloseBulletin(); broadcastNanaCurrentScreen(); };
  const origOpenRadio = window.openRadioScreen;
  if (origOpenRadio) window.openRadioScreen = () => { origOpenRadio(); broadcastNanaCurrentScreen(); };
  const origCloseRadio = window.closeRadioScreen;
  if (origCloseRadio) window.closeRadioScreen = () => { origCloseRadio(); broadcastNanaCurrentScreen(); };
  const origOpenKb = window.openSeniorKeyboard;
  if (origOpenKb) window.openSeniorKeyboard = () => { origOpenKb(); broadcastNanaCurrentScreen(); };
  const origCloseKb = window.closeSeniorKeyboard;
  if (origCloseKb) window.closeSeniorKeyboard = (r) => { origCloseKb(r); broadcastNanaCurrentScreen(); };

  window.switchNanaMainTab = (tab) => {
    if (tab !== 'video') pauseVideoAndSavePosition('switched_tab');
    if (tab !== 'chat' && $('bulletin-modal')?.style.display === 'flex') window.closeFamilyBulletin?.();
    if (tab !== 'radio') window.stopRadioAndSync?.(true);
    if (tab === 'calls') {
      document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
      $('grid-screen')?.classList.add('active');
    } else if (tab === 'chat') window.openFamilyBulletin?.();
    else if (tab === 'radio') window.openRadioScreen?.();
    else if (tab === 'video') window.openVideoScreen();
    broadcastNanaCurrentScreen();
  };

  window.openVideoScreen = () => {
    if ($('bulletin-modal')?.style.display === 'flex') window.closeFamilyBulletin?.();
    window.stopRadioAndSync?.(true);
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    $('video-screen')?.classList.add('active');
    window.wakeScreenAndResetDimTimer?.();
    update(presenceRef, { online: true, lastActivity: "Opened Video Player", currentScreen: "video_paused", lastTouched: Date.now() }).catch(() => {});
    syncVideoUI();
  };

  function saveCurrentVideoTime(force = false) {
    const curItem = getCurrentQueueItem();
    if (!videoEl || !curItem) return;
    const cur = Math.floor(videoEl.currentTime || 0);
    if (cur > 0 && (force || Math.abs(cur - lastSavedTimeSec) >= 4)) {
      lastSavedTimeSec = cur;
      localStorage.setItem(`nana_vid_pos_${curItem.item.url}`, String(cur));
      if (!currentStreamData.savedTimes) currentStreamData.savedTimes = {};
      currentStreamData.savedTimes[curItem.item.id] = cur;
      if (role === 'nana') {
        update(videoStreamRef, { [`savedTimes/${curItem.item.id}`]: cur, updatedAt: Date.now() }).catch(() => {});
      }
    }
  }

  function syncVideoUI() {
    const curItem = getCurrentQueueItem();
    const playing = !!(videoEl && !videoEl.paused && !videoEl.ended && curItem);
    const overlay = $('video-tap-overlay'), icon = $('video-overlay-icon'), main = $('video-overlay-main'), sub = $('video-overlay-sub'), btn = $('btn-bottom-video-toggle');

    if ($('video-title-banner')) {
      $('video-title-banner').innerText = curItem
        ? `🎬 (${curItem.index + 1}/${curItem.total}) ${curItem.item.title || 'Family Video'}${curItem.item.subtitleUrl ? ' [CC]' : ''}`
        : '🎬 Family Video Player';
    }
    if (!curItem) {
      overlay?.classList.remove('playing-hidden');
      if (icon) icon.innerText = '🎬';
      if (main) main.innerText = 'No videos in queue yet';
      if (sub) sub.innerText = 'Family can start a video from their phone';
    } else if (playing) {
      overlay?.classList.add('playing-hidden');
    } else {
      overlay?.classList.remove('playing-hidden');
      const rem = getSavedTimeForItem(curItem.item, curItem.index);
      const mins = Math.floor(rem / 60), secs = String(rem % 60).padStart(2, '0');
      if (icon) icon.innerText = '⏸️';
      if (main) main.innerText = rem > 2 ? `${curItem.item.title || 'Video'} — Paused at ${mins}:${secs}` : `Ready: ${curItem.item.title || 'Video'} (${curItem.index + 1} of ${curItem.total})`;
      if (sub) sub.innerText = 'Tap anywhere on the video screen to play';
    }
    if (btn) {
      btn.innerText = playing ? '⏸️ Pause Video' : '▶️ Play Video';
      btn.style.background = playing ? '#b45309' : '#059669';
      btn.style.borderColor = playing ? '#fde047' : '#4ade80';
    }
  }

  function pauseVideoAndSavePosition(reason = 'manual') {
    if (!videoEl || videoEl.paused) { startNormalDimCountdownOnPause(); return; }
    saveCurrentVideoTime(true);
    videoEl.pause();
    syncVideoUI();
    startNormalDimCountdownOnPause();
    broadcastNanaCurrentScreen();
    const curItem = getCurrentQueueItem();
    if (role === 'nana' && curItem) {
      update(videoStreamRef, {
        state: 'paused',
        [`savedTimes/${curItem.item.id}`]: Math.floor(videoEl.currentTime || 0),
        pauseReason: reason,
        updatedAt: Date.now()
      }).catch(() => {});
    }
  }

  async function startOrResumeVideo() {
    const curItem = getCurrentQueueItem();
    if (!videoEl || !curItem) return;
    window.stopRadioAndSync?.(true);
    const { item, index } = curItem;
    if (lastLoadedVideoUrl !== item.url) {
      lastLoadedVideoUrl = item.url;
      videoEl.src = item.url;
      videoEl.load();
    }
    await attachSubtitleTrack(item.subtitleUrl || '');
    const targetResume = getSavedTimeForItem(item, index);
    const playNow = () => {
      if (targetResume > 2 && Math.abs((videoEl.currentTime || 0) - targetResume) > 3) {
        try { videoEl.currentTime = targetResume; } catch (_) {}
      }
      if (videoEl.textTracks?.[0]) videoEl.textTracks[0].mode = 'showing';
      applyVideoVolume(videoVolume);
      videoEl.play().then(() => {
        requestVideoWakeLock();
        keepScreenAwakeIfPlayingVideo();
        syncVideoUI();
        broadcastNanaCurrentScreen();
        if (role === 'nana') {
          update(videoStreamRef, {
            state: 'playing',
            currentIndex: index,
            [`savedTimes/${item.id}`]: Math.floor(videoEl.currentTime || targetResume || 0),
            updatedAt: Date.now()
          }).catch(() => {});
        }
      }).catch(() => { syncVideoUI(); startNormalDimCountdownOnPause(); });
    };
    if (videoEl.readyState >= 1) playNow();
    else videoEl.addEventListener('loadedmetadata', playNow, { once: true });
  }

  window.handleVideoStageTap = (ev) => {
    if (ev) ev.stopPropagation();
    const curItem = getCurrentQueueItem();
    if (!videoEl || !curItem) return;
    if (!videoEl.paused) pauseVideoAndSavePosition('screen_touch');
    else startOrResumeVideo();
  };

  window.toggleNanaVideoPlayback = () => {
    const curItem = getCurrentQueueItem();
    if (!videoEl || !curItem) return;
    if (!videoEl.paused) pauseVideoAndSavePosition('button_tap');
    else startOrResumeVideo();
  };

  window.restartNanaVideoFromBeginning = () => {
    const curItem = getCurrentQueueItem();
    if (!videoEl || !curItem) return;
    localStorage.setItem(`nana_vid_pos_${curItem.item.url}`, '0');
    if (currentStreamData.savedTimes) currentStreamData.savedTimes[curItem.item.id] = 0;
    try { videoEl.currentTime = 0; } catch (_) {}
    startOrResumeVideo();
  };

  async function handleVideoEndedOnNana() {
    startNormalDimCountdownOnPause();
    const curItem = getCurrentQueueItem();
    if (!curItem) return;
    localStorage.setItem(`nana_vid_pos_${curItem.item.url}`, '0');
    if (currentStreamData.savedTimes) currentStreamData.savedTimes[curItem.item.id] = 0;

    const newViewCount = getViewCountForItem(curItem.item) + 1;
    if (!currentStreamData.viewCounts) currentStreamData.viewCounts = {};
    currentStreamData.viewCounts[curItem.item.id] = newViewCount;

    const nextIndex = (curItem.index + 1) % curItem.total;
    const nextItem = currentStreamData.queue[nextIndex];
    localStorage.setItem(`nana_vid_pos_${nextItem.url}`, '0');

    await update(videoStreamRef, {
      state: 'paused',
      [`savedTimes/${curItem.item.id}`]: 0,
      [`savedTimes/${nextItem.id}`]: 0,
      [`viewCounts/${curItem.item.id}`]: newViewCount,
      updatedAt: Date.now()
    }).catch(() => {});

    syncVideoUI();
    broadcastNanaCurrentScreen();

    const nextTitle = nextItem.title || `Video ${nextIndex + 1}`;
    const promptText = curItem.total > 1
      ? `That video has finished. Would you like to watch the next video: "${nextTitle}"?`
      : `That video has finished. Would you like to watch "${nextTitle}" again?`;

    await set(quickQuestionRef, {
      id: `q_nextvid_${Date.now()}`,
      type: 'next_video_prompt',
      nextIndex,
      question: promptText,
      askedBy: 'Video Player',
      silent: !speakQuestionsDefault,
      status: 'pending',
      answer: null,
      askedAt: Date.now()
    });
  }

  if (videoEl) {
    videoEl.addEventListener('timeupdate', () => { saveCurrentVideoTime(false); keepScreenAwakeIfPlayingVideo(); });
    videoEl.addEventListener('pause', () => { syncVideoUI(); startNormalDimCountdownOnPause(); broadcastNanaCurrentScreen(); });
    videoEl.addEventListener('play', () => { requestVideoWakeLock(); keepScreenAwakeIfPlayingVideo(); syncVideoUI(); broadcastNanaCurrentScreen(); });
    videoEl.addEventListener('ended', () => { if (role === 'nana') handleVideoEndedOnNana(); });
  }

  window.sortVideoQueue = async (mode) => {
    if (!isAdminFamily) return;
    const q = [...(currentStreamData.queue || [])];
    if (q.length < 2) return;
    if (editingQueueIndex !== null) window.cancelEditQueueItem();

    const activeId = q[currentStreamData.currentIndex || 0]?.id;
    q.sort((a, b) => {
      if (mode === 'alpha_asc') return (a.title || '').localeCompare(b.title || '', undefined, { numeric: true, sensitivity: 'base' });
      if (mode === 'alpha_desc') return (b.title || '').localeCompare(a.title || '', undefined, { numeric: true, sensitivity: 'base' });
      const vA = getViewCountForItem(a), vB = getViewCountForItem(b);
      if (mode === 'views_asc') return vA !== vB ? vA - vB : (a.title || '').localeCompare(b.title || '');
      if (mode === 'views_desc') return vB !== vA ? vB - vA : (a.title || '').localeCompare(b.title || '');
      return 0;
    });

    const newActiveIndex = activeId ? Math.max(0, q.findIndex(item => item.id === activeId)) : 0;
    await update(videoStreamRef, { queue: q, currentIndex: newActiveIndex, updatedBy: senderName, updatedAt: Date.now() });
  };

  function setEditFormUI(isEditing, idx = null) {
    if (!isAdminFamily) return;
    editingQueueIndex = isEditing ? idx : null;
    if (isEditing) window.toggleAdminVideoDrawer(true);
    if ($('fam-vid-add-row')) $('fam-vid-add-row').style.display = isEditing ? 'none' : 'flex';
    if ($('fam-vid-edit-row')) $('fam-vid-edit-row').style.display = isEditing ? 'flex' : 'none';
    if ($('fam-vid-form-heading')) {
      $('fam-vid-form-heading').innerText = isEditing ? `✏️ Editing Video #${idx + 1}` : '🎬 Video Queue on Nana\'s Tablet';
    }
    ['fam-vid-title', 'fam-vid-url', 'fam-vid-sub'].forEach(id => $(id)?.classList.toggle('editing-active', isEditing));
    renderFamilyQueueUI();
  }

  window.editQueueIndex = (idx) => {
    if (!isAdminFamily) return;
    const item = currentStreamData.queue?.[idx];
    if (!item) return;
    if ($('fam-vid-title')) $('fam-vid-title').value = item.title || '';
    if ($('fam-vid-url')) $('fam-vid-url').value = item.url || '';
    if ($('fam-vid-sub')) $('fam-vid-sub').value = item.subtitleUrl || '';
    setEditFormUI(true, idx);
    $('fam-vid-url')?.focus();
  };

  window.cancelEditQueueItem = () => {
    if (!isAdminFamily) return;
    if ($('fam-vid-title')) $('fam-vid-title').value = '';
    if ($('fam-vid-url')) $('fam-vid-url').value = '';
    if ($('fam-vid-sub')) $('fam-vid-sub').value = '';
    setEditFormUI(false, null);
  };

  window.saveEditedQueueItem = async () => {
    if (!isAdminFamily) return;
    const idx = editingQueueIndex;
    const q = [...(currentStreamData.queue || [])];
    if (idx === null || !q[idx]) return window.cancelEditQueueItem();

    const newUrl = ($('fam-vid-url')?.value || '').trim();
    const newSub = ($('fam-vid-sub')?.value || '').trim();
    const newTitle = ($('fam-vid-title')?.value || '').trim() || `Video ${idx + 1}`;
    if (!newUrl) return alert("Please enter a valid video URL (.mkv or .mp4)");

    const prevItem = q[idx];
    const urlChanged = prevItem.url !== newUrl;
    q[idx] = { ...prevItem, title: newTitle, url: newUrl, subtitleUrl: newSub };

    const nextSavedTimes = { ...(currentStreamData.savedTimes || {}) };
    if (urlChanged && prevItem.id) {
      nextSavedTimes[prevItem.id] = 0;
      localStorage.removeItem(`nana_vid_pos_${newUrl}`);
    }

    window.cancelEditQueueItem();
    await update(videoStreamRef, { queue: q, savedTimes: nextSavedTimes, updatedBy: senderName, updatedAt: Date.now() });
  };

  function renderFamilyQueueUI() {
    const box = $('fam-queue-container');
    if (!box) return;
    box.innerHTML = '';
    const q = currentStreamData.queue || [];
    if (!q.length) {
      box.innerHTML = `<div style="color:#94a3b8;font-size:0.85rem;padding:6px;">No videos in queue yet.</div>`;
      return;
    }
    q.forEach((item, idx) => {
      const isCur = idx === currentStreamData.currentIndex;
      const isEditingThis = isAdminFamily && idx === editingQueueIndex;
      const isPlayingNow = isCur && currentStreamData.state === 'playing';
      const savedSec = getSavedTimeForItem(item, idx);
      const views = getViewCountForItem(item);
      const timeTag = savedSec > 0 ? ` (${Math.floor(savedSec / 60)}:${String(savedSec % 60).padStart(2, '0')})` : '';
      const row = document.createElement('div');
      row.className = `fam-queue-item${isCur ? ' active-q' : ''}${isEditingThis ? ' editing-q' : ''}`;

      const adminBtns = isAdminFamily ? `
        <button class="fam-q-mini-btn" title="Edit Video & Subtitle Links" style="background:#b45309;border-color:#fde047;" onclick="editQueueIndex(${idx})">✏️</button>
        <button class="fam-q-mini-btn" title="Move Up" ${idx === 0 ? 'disabled' : ''} onclick="moveQueueItem(${idx}, -1)">⬆️</button>
        <button class="fam-q-mini-btn" title="Move Down" ${idx === q.length - 1 ? 'disabled' : ''} onclick="moveQueueItem(${idx}, 1)">⬇️</button>
        <button class="fam-q-mini-btn" title="Cue / Select" style="background:#0284c7;border-color:#7dd3fc;" onclick="selectQueueIndex(${idx}, false)">🎯</button>
        <button class="fam-q-mini-btn" title="Play Now" style="background:#059669;border-color:#4ade80;" onclick="selectQueueIndex(${idx}, true)">▶️</button>
        <button class="fam-q-mini-btn" title="Delete" style="background:#7f1d1d;border-color:#f87171;" onclick="removeQueueIndex(${idx})">🗑️</button>
      ` : `
        <button class="fam-q-mini-btn" title="Play This Video on Nana's Tablet" style="background:#059669;border-color:#4ade80;padding:5px 12px;" onclick="selectQueueIndex(${idx}, true)">▶️ Play</button>
      `;

      row.innerHTML = `
        <div class="fam-q-title" onclick="selectQueueIndex(${idx}, ${!isAdminFamily})">
          ${isCur ? `<span class="fam-q-badge">${isPlayingNow ? 'PLAYING' : 'SELECTED'}</span>` : `<strong>${idx + 1}.</strong> `}
          ${item.title || 'Video'}${item.subtitleUrl ? ' 💬' : ''}${timeTag}
          <span class="fam-view-pill" title="Number of times Nana has watched this video">👁️ ${views}</span>
        </div>
        <div style="display:flex;gap:4px;flex-shrink:0;">${adminBtns}</div>
      `;
      box.appendChild(row);
    });
  }

  window.addVideoToQueue = async (playImmediately = false) => {
    if (!isAdminFamily) return;
    const url = ($('fam-vid-url')?.value || '').trim();
    const subUrl = ($('fam-vid-sub')?.value || '').trim();
    const rawTitle = ($('fam-vid-title')?.value || '').trim();
    if (!url) return alert("Please enter a valid video URL (.mkv or .mp4)");

    const q = [...(currentStreamData.queue || [])];
    const title = rawTitle || `Video ${q.length + 1}`;
    const id = `vid_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    q.push({ id, title, url, subtitleUrl: subUrl, views: 0 });

    const newIndex = playImmediately ? (q.length - 1) : (currentStreamData.currentIndex || 0);
    await set(videoStreamRef, {
      queue: q,
      currentIndex: newIndex,
      state: playImmediately ? 'playing' : (currentStreamData.state || 'paused'),
      savedTimes: currentStreamData.savedTimes || {},
      viewCounts: currentStreamData.viewCounts || {},
      updatedBy: senderName,
      updatedAt: Date.now()
    });

    if ($('fam-vid-title')) $('fam-vid-title').value = '';
    if ($('fam-vid-url')) $('fam-vid-url').value = '';
    if ($('fam-vid-sub')) $('fam-vid-sub').value = '';
  };

  window.selectQueueIndex = async (idx, startPlaying = true) => {
    const q = currentStreamData.queue || [];
    if (!q[idx]) return;
    await update(videoStreamRef, { currentIndex: idx, state: startPlaying ? 'playing' : 'paused', updatedBy: senderName, updatedAt: Date.now() });
  };
  window.playQueueIndex = (idx) => window.selectQueueIndex(idx, true);

  window.moveQueueItem = async (idx, direction) => {
    if (!isAdminFamily) return;
    const q = [...(currentStreamData.queue || [])];
    const targetIdx = idx + direction;
    if (targetIdx < 0 || targetIdx >= q.length) return;
    if (editingQueueIndex !== null) window.cancelEditQueueItem();

    const activeId = q[currentStreamData.currentIndex || 0]?.id;
    const temp = q[idx]; q[idx] = q[targetIdx]; q[targetIdx] = temp;
    const newActiveIndex = activeId ? Math.max(0, q.findIndex(item => item.id === activeId)) : 0;

    await update(videoStreamRef, { queue: q, currentIndex: newActiveIndex, updatedBy: senderName, updatedAt: Date.now() });
  };

  window.removeQueueIndex = async (idx) => {
    if (!isAdminFamily) return;
    const q = [...(currentStreamData.queue || [])];
    if (!q[idx]) return;
    if (editingQueueIndex === idx) window.cancelEditQueueItem();
    const removed = q.splice(idx, 1)[0];
    let nextIdx = currentStreamData.currentIndex || 0;
    if (idx < nextIdx) nextIdx = Math.max(0, nextIdx - 1);
    if (nextIdx >= q.length) nextIdx = 0;

    const nextSavedTimes = { ...(currentStreamData.savedTimes || {}) };
    const nextViewCounts = { ...(currentStreamData.viewCounts || {}) };
    if (removed?.id) { delete nextSavedTimes[removed.id]; delete nextViewCounts[removed.id]; }

    await set(videoStreamRef, {
      queue: q,
      currentIndex: nextIdx,
      state: q.length ? currentStreamData.state : 'paused',
      savedTimes: nextSavedTimes,
      viewCounts: nextViewCounts,
      updatedBy: senderName,
      updatedAt: Date.now()
    });
  };

  window.remoteCommandVideo = async (cmd) => {
    const q = currentStreamData.queue || [];
    if (!q.length) {
      if (isAdminFamily) {
        const typedUrl = ($('fam-vid-url')?.value || '').trim();
        if (typedUrl) return window.addVideoToQueue(cmd === 'play');
      }
      return alert("No videos in the queue yet.");
    }
    let nextIndex = currentStreamData.currentIndex || 0;
    let nextState = currentStreamData.state || 'paused';
    if (cmd === 'play') nextState = 'playing';
    else if (cmd === 'pause') nextState = 'paused';
    else if (cmd === 'next') nextIndex = (nextIndex + 1) % q.length;
    else if (cmd === 'prev') nextIndex = (nextIndex - 1 + q.length) % q.length;

    await update(videoStreamRef, { currentIndex: nextIndex, state: nextState, updatedBy: senderName, updatedAt: Date.now() });
  };

  onValue(videoStreamRef, snap => {
    const prevItem = getCurrentQueueItem();
    currentStreamData = normalizeStreamData(snap.val());
    const curItem = getCurrentQueueItem();

    if (role === 'family') {
      renderFamilyQueueUI();
      applySimpleFamilyPresenceCard();
      const st = $('fam-vid-status');
      if (st) {
        if (!curItem) { st.innerText = 'Queue Empty'; st.style.color = '#94a3b8'; }
        else {
          const sec = getSavedTimeForItem(curItem.item, curItem.index);
          const mins = Math.floor(sec / 60), secs = String(sec % 60).padStart(2, '0');
          st.innerText = currentStreamData.state === 'playing'
            ? `▶️ Playing #${curItem.index + 1}: ${curItem.item.title} (${mins}:${secs})`
            : `⏸️ Cued #${curItem.index + 1}: ${curItem.item.title} (${mins}:${secs})`;
          st.style.color = currentStreamData.state === 'playing' ? '#4ade80' : '#fbbf24';
        }
      }
    } else if (role === 'nana') {
      const urlChanged = prevItem?.item?.url !== curItem?.item?.url;
      const subChanged = prevItem?.item?.subtitleUrl !== curItem?.item?.subtitleUrl;
      const idChanged  = prevItem?.item?.id !== curItem?.item?.id;
      if (curItem && (urlChanged || idChanged) && videoEl) {
        lastLoadedVideoUrl = curItem.item.url;
        videoEl.src = curItem.item.url;
        videoEl.load();
        attachSubtitleTrack(curItem.item.subtitleUrl || '', true);
      } else if (curItem && subChanged && videoEl) {
        attachSubtitleTrack(curItem.item.subtitleUrl || '', true);
      }
      if (currentStreamData.state === 'playing' && curItem) {
        if (!$('video-screen')?.classList.contains('active')) window.openVideoScreen();
        if (videoEl?.paused || urlChanged || idChanged) startOrResumeVideo();
      } else if (currentStreamData.state === 'paused') {
        if (videoEl && !videoEl.paused) videoEl.pause();
        else startNormalDimCountdownOnPause();
      }
      syncVideoUI();
    }
  });

  onValue(callStateRef, snap => {
    const call = snap.val();
    if (!call) return;
    latestCallSnap = call;
    lastActivityOrCallMs = Date.now();
    if (role === 'family') setTimeout(applySimpleFamilyPresenceCard, 20);
    if (call.status !== 'idle' && role === 'nana') {
      if ($('nana-question-modal')) $('nana-question-modal').style.display = 'none';
      if (videoEl && !videoEl.paused) pauseVideoAndSavePosition('incoming_call');
    }
  });

  window.sendQuestionToNana = async () => {
    const input = $('fam-q-input');
    const text = (input?.value || '').trim();
    if (!text) return alert("Please type a question for Nana first.");
    await set(quickQuestionRef, {
      id: `q_${Date.now()}`,
      type: 'family_question',
      question: text,
      askedBy: senderName,
      silent: familyComposerSilent,
      status: 'pending',
      answer: null,
      askedAt: Date.now()
    });
    if (input) input.value = '';
  };

  window.clearQuestionOnNana = async () => {
    await set(quickQuestionRef, { status: 'cleared', updatedAt: Date.now() });
  };

  window.submitNanaQuestionAnswer = async (choice) => {
    if (!activeQuestionData) return;
    const qData = activeQuestionData;
    const isSilent = !!(qData.silent || !speakQuestionsDefault);
    $('nana-question-modal').style.display = 'none';
    lastActivityOrCallMs = Date.now();
    window.wakeScreenAndResetDimTimer?.();

    const now = Date.now();
    await update(quickQuestionRef, { status: 'answered', answer: choice, answeredAt: now });

    if (qData.type === 'next_video_prompt') {
      const targetIdx = Number(qData.nextIndex) || 0;
      const nextItem = currentStreamData.queue?.[targetIdx];
      if (nextItem) localStorage.setItem(`nana_vid_pos_${nextItem.url}`, '0');
      const updatePayload = { currentIndex: targetIdx, state: choice === 'YES' ? 'playing' : 'paused', updatedAt: now };
      if (nextItem?.id) updatePayload[`savedTimes/${nextItem.id}`] = 0;
      await update(videoStreamRef, updatePayload);
      return;
    }

    if (qData.type === 'unread_chat_prompt') {
      lastUnreadChatPromptMs = now;
      if (choice === 'YES') window.openFamilyBulletin?.();
      return;
    }

    if (qData.type === 'idle_radio_prompt') {
      if (choice === 'YES') {
        window.openRadioScreen?.();
        set(entertainmentRef, { activeKey: "classicfm", title: "Classic FM Radio 🎻", timestamp: now }).catch(() => {});
      }
      return;
    }

    if (qData.type === 'idle_video_prompt') {
      if (choice === 'YES') {
        window.openVideoScreen();
        const q = currentStreamData.queue || [];
        if (q.length) {
          const jjdIdx = q.findIndex(item => /judge\s*john\s*deed/i.test(item.title || ''));
          const targetIdx = jjdIdx >= 0 ? jjdIdx : (currentStreamData.currentIndex || 0);
          await update(videoStreamRef, { currentIndex: targetIdx, state: 'playing', updatedAt: now }).catch(() => {});
        }
      }
      return;
    }

    const qText = qData.question || '', askedBy = qData.askedBy || 'Family';
    const replySummary = `${choice === 'YES' ? '✅ YES' : '✖ NO'} — (In reply to ${askedBy}: "${qText}")`;
    await push(bulletinRef, { author: 'Nana', fromNana: true, text: replySummary, timestamp: now, readByNanaAt: now });

    fetch(GOOGLE_SCRIPT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ secret: SERVICE_TOKEN, portalNode: PORTAL_NODE_ID, action: "nana_reply", author: "Nana", text: replySummary })
    }).catch(() => {});

    if (!isSilent) window.speakNote?.(`Sent ${choice} to ${askedBy}`);
  };

  let lastHandledQuestionId = null;
  onValue(quickQuestionRef, snap => {
    const q = snap.val();
    activeQuestionData = q;
    if (role === 'family') {
      const st = $('fam-q-status');
      if (!st) return;
      if (!q || q.status === 'cleared') { st.innerText = 'No active popup'; st.style.color = '#94a3b8'; }
      else if (q.status === 'pending') {
        const modeTag = (q.silent || !speakQuestionsDefault) ? '🔇 Silent' : '🔊 Spoken';
        st.innerText = `⏳ Showing (${modeTag}): "${q.question}"`;
        st.style.color = '#facc15';
      } else if (q.status === 'answered') {
        const ansTime = q.answeredAt ? new Date(q.answeredAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
        st.innerText = `Nana answered: ${q.answer === 'YES' ? '✅ YES' : '✖ NO'} (${ansTime})`;
        st.style.color = q.answer === 'YES' ? '#4ade80' : '#f87171';
      }
    } else if (role === 'nana') {
      const modal = $('nana-question-modal');
      if (!modal) return;
      if (q && q.status === 'pending' && q.question) {
        if (videoEl && !videoEl.paused) pauseVideoAndSavePosition('question_popup');
        const isSilent = !!(q.silent || !speakQuestionsDefault);
        const badgeMap = {
          next_video_prompt: '🎬 Up Next in Video Queue',
          unread_chat_prompt: '✈️ Unread Family Chat Messages',
          idle_radio_prompt: '🎻 Classic FM Radio',
          idle_video_prompt: '🎬 Family Video Suggestion'
        };
        $('q-popup-sender').innerText = badgeMap[q.type] || `❓ Question from ${q.askedBy || 'Family'}`;
        $('q-popup-text').innerText = q.question;
        modal.style.display = 'flex';
        if (q.id !== lastHandledQuestionId) {
          lastHandledQuestionId = q.id;
          window.wakeFromNightMode?.();
          startNormalDimCountdownOnPause();
          if (!isSilent) {
            const isSystemPrompt = !!badgeMap[q.type];
            window.speakNote?.(isSystemPrompt ? `${q.question} Touch Yes or No.` : `${q.askedBy || 'Family'} asks: ${q.question}. Touch Yes or No.`);
          }
        }
      } else modal.style.display = 'none';
    }
  });
})();
