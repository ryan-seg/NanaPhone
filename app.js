    import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
    import { getDatabase, ref, set, update, push, onValue, remove, runTransaction } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js";

    // =====================================================================
    // NanaPhone app.js  --  VERSION 2.8.4
    // VERSION MUST MATCH: index.html (2 places), styles.css (2 places), app.js (APP_VERSION below)
    // =====================================================================
    const APP_VERSION = "2.8.4";

    // If the page (index.html) is an old cached copy, reload it once with a fresh address.
    (function versionGuard() {
      const pageV = window.__NANA_PAGE_VERSION;
      try {
        if (pageV && pageV !== APP_VERSION) {
          if (!sessionStorage.getItem('nana_vguard')) {
            sessionStorage.setItem('nana_vguard', '1');
            const u = new URL(window.location.href);
            u.searchParams.set('r', String(Date.now()));
            window.location.replace(u.toString());
            throw new Error('Version mismatch - reloading fresh page');
          }
        } else {
          sessionStorage.removeItem('nana_vguard');
        }
      } catch (e) { if (String(e.message).indexOf('Version mismatch') === 0) throw e; }
    })();
    window.__nanaAppLoaded = true;


    function showScreen(id) {
      document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
      document.getElementById(id).classList.add('active');
    }

    const params = new URLSearchParams(window.location.search);
    if (params.get('key')) localStorage.setItem('nana_service_token', params.get('key').trim());
    const SERVICE_TOKEN = (localStorage.getItem('nana_service_token') || 'Westerham8').trim();

    if (SERVICE_TOKEN !== 'Westerham8') {
      showScreen('auth-error-screen');
      setTimeout(() => {
        try { localStorage.removeItem('nana_service_token'); } catch (e) {}
        const u = new URL(window.location.href);
        u.searchParams.delete('key');
        window.location.replace(u.toString());
      }, 10000);
      throw new Error("Invalid verification key.");
    }

    // ?test=1 -> private sandbox: separate Firebase path, no Telegram messages, test ribbon.
    const TEST_MODE = params.get('test') === '1';

    const CONFIG = {
      appVersion: APP_VERSION,
      adminPin: "1929",
      apkFileName: "nanaphone.apk",
      dailyRoomUrl: "https://nanaphone.daily.co/" + (params.get('room') || 'NanaPhone'),
      telegramBotUsername: "Nanaphone_Bot",
      googleScriptUrl: "https://script.google.com/macros/s/AKfycbwsFHE8oyj1RBGxLJT79bbPsvJ2hTkVrF9dCoj369ApEREXyrdQKE_vA0QrobBOeLE2/exec",
      firebase: { databaseURL: "https://nanaphone-f644b-default-rtdb.europe-west1.firebasedatabase.app" },
      dailyMinuteQuota: 300,
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

    if (TEST_MODE) {
      // Swallow every Telegram / Apps Script request so nobody gets alerts during tests.
      const realFetch = window.fetch.bind(window);
      window.fetch = (url, opts) => {
        if (String(url).startsWith(CONFIG.googleScriptUrl)) {
          console.log('[TEST MODE] Telegram call skipped:', opts && opts.body);
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

    // Show page / app / styles versions on screen so they can be checked at a glance.
    (function showVersions() {
      const stylesV = (getComputedStyle(document.documentElement).getPropertyValue('--nana-styles-version') || '').replace(/["'\s]/g, '') || '?';
      const pageV = window.__NANA_PAGE_VERSION || '?';
      const allMatch = (pageV === APP_VERSION && stylesV === APP_VERSION);
      const txt = 'Page ' + pageV + ' | App ' + APP_VERSION + ' | Styles ' + stylesV + (allMatch ? '' : '  ⚠️ MISMATCH - tap Refresh');
      document.querySelectorAll('.file-versions-line').forEach(e => { e.innerText = txt; e.style.color = allMatch ? '#94a3b8' : '#fbbf24'; });
      document.querySelectorAll('.gear-pill').forEach(e => { e.innerText = '⚙️ v' + APP_VERSION + (allMatch ? '' : ' ⚠️'); });
    })();

    // Remote picture: show the WHOLE image (no zoomed-in crop) unless its shape already matches the screen.
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

    const CLASSIC_FM_STREAM = "https://media-ice.musicradio.com/ClassicFMMP3";

    const role = params.get('role') || 'nana';
    const callerId = params.get('id') || 'ryan';
    const autoAnswerFromTelegram = params.get('answer') === 'true';
    const activeFamilyMember = CONFIG.familyMembers.find(m => m.id === callerId) || CONFIG.familyMembers[4];
    const isRealAndroidTablet = !!(window.AndroidBridge || /Lenovo|TB-|Tab/i.test(navigator.userAgent));

    const app = initializeApp(CONFIG.firebase);
    const db = getDatabase(app);
    const basePath = TEST_MODE ? `portals/${SERVICE_TOKEN}__test` : `portals/${SERVICE_TOKEN}`;
    const callStateRef = ref(db, `${basePath}/callState`);
    const presenceRef = ref(db, `${basePath}/presence`);
    const bulletinRef = ref(db, `${basePath}/bulletin`);
    const settingsRef = ref(db, `${basePath}/settings`);
    const missedCallsMapRef = ref(db, `${basePath}/missedCalls`);
    const connectedMembersRef = ref(db, `${basePath}/connectedMembers`);
    const loveToastRef = ref(db, `${basePath}/loveToast`);
    const hiddenRef = ref(db, `${basePath}/hiddenContacts`);
    // Test sandbox: pretend every family member has connected Telegram so Nana's test grid is full.
    if (TEST_MODE) {
      // Visible status strip at the bottom: confirms the test database works and shows any error.
      const testBar = document.createElement('div');
      testBar.style.cssText = 'position:fixed;left:0;right:0;bottom:0;z-index:99998;font:700 14px monospace;padding:6px 10px;color:#fff;background:#334155;pointer-events:none;white-space:pre-wrap;';
      testBar.innerText = '🧪 Checking test database...';
      document.body.appendChild(testBar);
      const setTestStatus = (txt, bad) => {
        testBar.style.display = 'block';
        testBar.innerText = txt;
        testBar.style.background = bad ? '#b91c1c' : '#166534';
      };
      window.__setTestStatus = setTestStatus;
      set(ref(db, `${basePath}/_ping`), Date.now())
        .then(() => {
          setTestStatus('🧪 Test database OK (' + role + ')', false);
          setTimeout(() => { testBar.style.display = 'none'; }, 6000);
        })
        .catch((e) => setTestStatus('❌ TEST DATABASE BLOCKED: ' + (e && e.message ? e.message : e) +
          '\nFirebase rules must allow portals/' + SERVICE_TOKEN + '__test', true));
      window.addEventListener('error', (ev) => setTestStatus('❌ JS error: ' + ev.message + ' (line ' + ev.lineno + ')', true));
      window.addEventListener('unhandledrejection', (ev) => setTestStatus('❌ ' + (ev.reason && ev.reason.message ? ev.reason.message : ev.reason), true));
      set(connectedMembersRef, CONFIG.familyMembers.map(m => m.id)).catch(() => {});
    }
    const entertainmentRef = ref(db, `${basePath}/entertainment`);

    function getMemberMissedCallRef(memberId) {
      return ref(db, `${basePath}/missedCalls/${memberId}`);
    }

    function getTodayUsageRef() {
      return ref(db, `${basePath}/usage/${new Date().toISOString().split('T')[0]}`);
    }

    let callObject = null;
    let isJoiningOrInRoom = false;
    let didManuallyInitiateOrAnswerOnThisTab = false;
    let isRadioPlaying = false;
    let latestEntState = { activeKey: "off", title: "Off" };
    let pendingCallContact = null;
    let missedCallsByMember = {};
    let latestBulletinPosts = {};
    let newestBulletinTimestamp = 0;
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
    let callTimerInterval = null;
    let idleDimTimer = null;
    let keyboardHideTimer = null;
    let lastKeyTapMs = 0;
    let lastChatSendMs = 0;
    let settingsLoaded = false;
    let latestHidden = {};
    let isCurrentlyIdleDimmed = false;
    let currentState = 'idle';
    let latestCallData = { status: 'idle' };
    let latestPresenceData = {};
    let connectedMemberIds = [];
    let enteredPin = "";
    let todayMinutesUsed = 0;
    let nightDismissedUntilMs = 0;
    let lastBatterySpokenMs = 0;
    
    let audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    let activeMp3Ringtone = null;

    let tabletSettings = {
      callVolume: 85,
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
      bulletinClearedAt: 0,
      // Live portal starts with calling OFF until a family member switches it on. Test sandbox starts ON.
      callingEnabled: TEST_MODE
    };

    // ========================================================================
    // HIGH-CONTRAST MACULAR DEGENERATION THEME ENGINE
    // ========================================================================
    function applyColorTheme(themeKey) {
      const safeKey = themeKey || 'classic-dark';
      document.body.classList.remove('theme-yellow-black', 'theme-white-black', 'theme-black-cream');
      if (safeKey !== 'classic-dark') {
        document.body.classList.add(`theme-${safeKey}`);
      }
    }

    // ========================================================================
    // SCREEN BRIGHTNESS & IDLE DIMMING ENGINE
    // ========================================================================
    function applyScreenBrightness(targetPercent) {
      if (role !== 'nana') return;
      const pct = Math.max(5, Math.min(100, Number(targetPercent) || 85));

      const overlay = document.getElementById('brightness-overlay');
      if (overlay) {
        const darkness = Math.max(0, Math.min(0.88, (100 - pct) / 105));
        overlay.style.opacity = darkness.toFixed(2);
      }

      if (window.AndroidBridge && window.AndroidBridge.updateTabletHardwareSettings) {
        const activeVol = (currentState === 'connected' || isRadioPlaying)
          ? (tabletSettings.callVolume ?? 85)
          : (tabletSettings.ringVolume ?? 85);

        window.AndroidBridge.updateTabletHardwareSettings(
          Number(activeVol) || 85,
          pct,
          Number(tabletSettings.dimDelaySec ?? 120),
          Number(tabletSettings.speechRate) || 0.9
        );
      }
    }

    function wakeScreenAndResetDimTimer() {
      if (role !== 'nana') return;
      isCurrentlyIdleDimmed = false;
      applyScreenBrightness(tabletSettings.awakeBrightness ?? 85);

      if (idleDimTimer) {
        clearTimeout(idleDimTimer);
        idleDimTimer = null;
      }

      const delaySec = Number(tabletSettings.dimDelaySec ?? 120);
      if (delaySec > 0 && currentState === 'idle' && !isRadioPlaying) {
        idleDimTimer = setTimeout(() => {
          if (currentState === 'idle' && !isRadioPlaying) {
            window.closeSeniorKeyboard();
            const chatOpen = document.getElementById('bulletin-modal')?.style.display === 'flex';
            if (chatOpen) {
              window.dismissCurrentBulletinBar(true);
            }
            isCurrentlyIdleDimmed = true;
            applyScreenBrightness(tabletSettings.dimBrightness ?? 15);
          }
        }, delaySec * 1000);
      }
    }

    // ========================================================================
    // BATTERY VOICE MUTE, MISSED CALL CLEAR & BULLETIN VISIBILITY
    // ========================================================================
    window.muteBatteryVoiceForHours = async (hours) => {
      const mutedUntil = hours > 0 ? (Date.now() + hours * 3600 * 1000) : 0;
      tabletSettings.batteryVoiceMutedUntil = mutedUntil;
      if ('speechSynthesis' in window) window.speechSynthesis.cancel();
      if (window.AndroidBridge && window.AndroidBridge.muteBatteryVoiceForMinutes) {
        window.AndroidBridge.muteBatteryVoiceForMinutes(hours * 60);
      }
      refreshSettingsUI();
      await update(settingsRef, { batteryVoiceMutedUntil: mutedUntil });
    };

    window.clearAllMissedCalls = async () => {
      await remove(missedCallsMapRef);
      missedCallsByMember = {};
      renderMissedCallsBanner();
      if (role === 'nana') renderContacts(connectedMemberIds);
    };

    window.dismissCurrentBulletinBar = async (forceFromAdmin = false) => {
      if (role !== 'nana' && !forceFromAdmin) return;
      const now = Date.now();
      tabletSettings.bulletinClearedAt = now;
      chatSessionReadCutoff = now;
      updateBulletinTickerVisibility();
      await update(settingsRef, { bulletinClearedAt: now });
    };

    function updateBulletinTickerVisibility() {
      const bar = document.getElementById('message-ticker-bar');
      const badge = document.getElementById('chat-unread-badge');
      const isEnabled = tabletSettings.showBulletinBar !== false;
      const clearedAt = Number(tabletSettings.bulletinClearedAt) || 0;

      unreadBulletinCount = 0;
      Object.values(latestBulletinPosts).forEach(p => {
        if (!p.fromNana && (Number(p.timestamp) || 0) > clearedAt) {
          unreadBulletinCount++;
        }
      });

      const hasUnread = unreadBulletinCount > 0;
      if (bar) {
        bar.style.display = (isEnabled && hasUnread) ? 'flex' : 'none';
      }
      if (badge) {
        badge.innerText = unreadBulletinCount > 9 ? '9+' : `${unreadBulletinCount} NEW`;
        badge.style.display = hasUnread ? 'inline-block' : 'none';
      }
    }

    function isBatteryVoiceCurrentlyMuted() {
      return (Number(tabletSettings.batteryVoiceMutedUntil) || 0) > Date.now();
    }

    window.announceBatteryWarning = (warningText) => {
      if (isBatteryVoiceCurrentlyMuted()) return;
      if (Date.now() - lastBatterySpokenMs < 180000) return;
      lastBatterySpokenMs = Date.now();
      speakMsg(warningText, true);
    };

    // ========================================================================
    // SENIOR TELEGRAM CHAT & ON-SCREEN KEYBOARD ENGINE
    // ========================================================================
    function renderSeniorKeyboardLayout() {
      const container = document.getElementById('senior-kb-letters-container');
      if (!container) return;
      const layout = tabletSettings.keyboardLayout || 'qwerty';

      const rows = layout === 'abcdef'
        ? [
            ['A','B','C','D','E','F','G','H','I','J'],
            ['K','L','M','N','O','P','Q','R','S','T'],
            ['U','V','W','X','Y','Z']
          ]
        : [
            ['Q','W','E','R','T','Y','U','I','O','P'],
            ['A','S','D','F','G','H','J','K','L'],
            ['Z','X','C','V','B','N','M']
          ];

      container.innerHTML = '';

      // Row 1 (10 keys)
      const r1 = document.createElement('div');
      r1.style.cssText = 'display:grid; grid-template-columns:repeat(10, 1fr); gap:6px;';
      rows[0].forEach(letter => {
        const b = document.createElement('button');
        b.className = 'kb-letter-btn';
        b.textContent = letter;
        b.onclick = () => window.typeSeniorKey(letter);
        r1.appendChild(b);
      });
      container.appendChild(r1);

      // Row 2 (9 keys for QWERTY, 10 keys for ABCDEF)
      const r2 = document.createElement('div');
      r2.style.cssText = layout === 'abcdef'
        ? 'display:grid; grid-template-columns:repeat(10, 1fr); gap:6px;'
        : 'display:grid; grid-template-columns:repeat(9, 1fr); gap:6px; padding:0 18px;';
      rows[1].forEach(letter => {
        const b = document.createElement('button');
        b.className = 'kb-letter-btn';
        b.textContent = letter;
        b.onclick = () => window.typeSeniorKey(letter);
        r2.appendChild(b);
      });
      container.appendChild(r2);

      // Row 3 (Letters + oversized Delete button)
      const r3 = document.createElement('div');
      r3.style.cssText = 'display:grid; grid-template-columns:repeat(9, 1fr); gap:6px;';
      rows[2].forEach(letter => {
        const b = document.createElement('button');
        b.className = 'kb-letter-btn';
        b.textContent = letter;
        b.onclick = () => window.typeSeniorKey(letter);
        r3.appendChild(b);
      });
      const delBtn = document.createElement('button');
      delBtn.className = 'kb-letter-btn';
      const delSpan = layout === 'abcdef' ? 3 : 2;
      delBtn.style.cssText = `background:#7f1d1d; color:#ffffff; grid-column:span ${delSpan}; border-color:#f87171;`;
      delBtn.textContent = '⌫ Delete';
      delBtn.onclick = () => window.typeSeniorKey('BACKSPACE');
      r3.appendChild(delBtn);
      container.appendChild(r3);
    }

    function resetKeyboardAutoHideTimer() {
      if (keyboardHideTimer) {
        clearTimeout(keyboardHideTimer);
        keyboardHideTimer = null;
      }
      const timeoutSec = Number(tabletSettings.keyboardTimeoutSec ?? 60);
      if (timeoutSec > 0) {
        keyboardHideTimer = setTimeout(() => {
          const input = document.getElementById('nana-chat-input');
          if (input) input.value = '';
          window.closeSeniorKeyboard();
        }, timeoutSec * 1000);
      }
    }

    window.openFamilyBulletin = () => {
      chatSessionReadCutoff = Number(tabletSettings.bulletinClearedAt) || 0;
      document.getElementById('bulletin-modal').style.display = 'flex';
      renderBulletinFeed();
      wakeScreenAndResetDimTimer();
      recordHeartbeat("Opened Family Chat");

      setTimeout(() => {
        const divider = document.getElementById('first-unread-divider');
        const feed = document.getElementById('bulletin-posts-container');
        if (divider) {
          divider.scrollIntoView({ behavior: 'smooth', block: 'start' });
        } else if (feed) {
          feed.scrollTop = feed.scrollHeight;
        }
      }, 120);
    };

    window.closeFamilyBulletin = async () => {
      document.getElementById('bulletin-modal').style.display = 'none';
      window.closeSeniorKeyboard();
      if ('speechSynthesis' in window) window.speechSynthesis.cancel();
      wakeScreenAndResetDimTimer();
      recordHeartbeat("On Home Grid");
      if (role === 'nana') {
        await window.dismissCurrentBulletinBar(true);
      }
      chatSessionReadCutoff = null;
    };

    window.openSeniorKeyboard = () => {
      renderSeniorKeyboardLayout();
      const kb = document.getElementById('senior-onscreen-keyboard');
      const comp = document.querySelector('.tg-composer-area');
      if (kb) kb.style.display = 'flex';
      if (comp) comp.classList.add('kb-open');
      resetKeyboardAutoHideTimer();
      wakeScreenAndResetDimTimer();
      setTimeout(() => {
        const feed = document.getElementById('bulletin-posts-container');
        if (feed) feed.scrollTop = feed.scrollHeight;
      }, 60);
    };

    window.closeSeniorKeyboard = () => {
      if (keyboardHideTimer) {
        clearTimeout(keyboardHideTimer);
        keyboardHideTimer = null;
      }
      const kb = document.getElementById('senior-onscreen-keyboard');
      const comp = document.querySelector('.tg-composer-area');
      if (kb) kb.style.display = 'none';
      if (comp) comp.classList.remove('kb-open');
    };

    window.handleChatScroll = (el) => {
      if (role !== 'nana') return;
      // If Nana scrolls all the way down to the bottom (viewing most recent messages), mark as read
      const isAtBottom = (el.scrollHeight - el.scrollTop - el.clientHeight) < 40;
      if (isAtBottom && chatSessionReadCutoff !== null) {
        window.dismissCurrentBulletinBar(true);
      }
    };

    window.typeSeniorKey = (char) => {
      const now = Date.now();
      if (char !== 'BACKSPACE' && (now - lastKeyTapMs < 280)) return;
      lastKeyTapMs = now;

      resetKeyboardAutoHideTimer();
      wakeScreenAndResetDimTimer();

      const input = document.getElementById('nana-chat-input');
      if (!input) return;
      if (char === 'BACKSPACE') {
        input.value = Array.from(input.value).slice(0, -1).join('');
      } else if (['💋', '❤️', '☘️', '👍', '😘'].includes(char)) {
        input.value += char;
      } else {
        const nextChar = input.value.length === 0 ? char : char.toLowerCase();
        input.value += nextChar;
      }
    };

    window.submitTypedNanaMessage = async () => {
      const input = document.getElementById('nana-chat-input');
      if (!input) return;
      const text = input.value.trim();
      if (!text) return;
      input.value = "";
      window.closeSeniorKeyboard();
      await window.sendNanaChatMessage(text);
    };

    window.sendNanaChatMessage = async (rawText) => {
      const text = (rawText || "").trim();
      if (!text) return;

      const now = Date.now();
      if (now - lastChatSendMs < 5000) return;
      lastChatSendMs = now;

      const senderLabel = role === 'nana' ? 'Nana' : activeFamilyMember.name;
      const isFromNana = role === 'nana';
      const statusEl = document.getElementById('tg-send-status');
      if (statusEl) {
        statusEl.style.color = "#ffff00";
        statusEl.innerText = "⏳ Sending message to Telegram...";
      }

      try {
        await push(bulletinRef, {
          author: senderLabel,
          fromNana: isFromNana,
          text: text,
          timestamp: Date.now()
        });

        // Instantly mark read for Nana when she posts a message
        if (role === 'nana') {
          await window.dismissCurrentBulletinBar(true);
        }

        const res = await fetch(CONFIG.googleScriptUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'text/plain;charset=utf-8' },
          body: JSON.stringify({
            secret: SERVICE_TOKEN,
            action: "nana_reply",
            text: text
          })
        });
        const data = await res.json();

        if (data && data.ok) {
          if (statusEl) {
            statusEl.style.color = "#4ade80";
            statusEl.innerText = `✅ Sent to Telegram (${data.broadcastCount} chat${data.broadcastCount === 1 ? '' : 's'})!`;
          }
        } else {
          if (statusEl) {
            statusEl.style.color = "#f87171";
            statusEl.innerText = `⚠️ ${data?.error || 'Telegram not linked yet'}`;
          }
        }
        setTimeout(() => {
          if (statusEl) {
            statusEl.style.color = "#4ade80";
            statusEl.innerText = "🟢 Connected to Family Group";
          }
        }, 5000);
      } catch (e) {
        if (statusEl) {
          statusEl.style.color = "#f87171";
          statusEl.innerText = "⚠️ Saved on tablet (Script unreachable)";
        }
      }
    };

    function renderBulletinFeed() {
      const container = document.getElementById('bulletin-posts-container');
      if (!container) return;
      container.innerHTML = "";
      const keys = Object.keys(latestBulletinPosts).slice(-25);

      const clearedAt = (chatSessionReadCutoff !== null)
        ? chatSessionReadCutoff
        : (Number(tabletSettings.bulletinClearedAt) || 0);

      newestBulletinTimestamp = 0;
      if (keys.length > 0) {
        const newest = latestBulletinPosts[keys[keys.length - 1]];
        newestBulletinTimestamp = Number(newest.timestamp) || 1;
        document.getElementById('ticker-preview-text').innerText = `💬 ${newest.author || 'Family'}: "${newest.text || 'Sent a photo 📷'}"`;
      } else {
        container.innerHTML = `
          <div style="margin:auto; color:var(--text-muted); font-size:1.5rem; font-weight:700; padding:30px;">
            No messages yet. Tap the box below to open the keyboard and say hello!
          </div>
        `;
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

        if (item.imageUrl) {
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
    }

    onValue(bulletinRef, (snap) => {
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
    // CLASSIC FM RADIO ENGINE
    // ========================================================================
    const radioPlayer = document.getElementById('nana-radio-stream');

    window.openRadioScreen = () => {
      showScreen('radio-screen');
      recordHeartbeat("Opened Classic FM Radio");
    };

    window.closeRadioScreen = () => {
      window.stopRadioAndSync(true);
      showScreen('grid-screen');
      recordHeartbeat("On Home Grid");
    };

    window.toggleClassicFM = async () => {
      if (isRadioPlaying) {
        await window.stopRadioAndSync(true);
      } else {
        await set(entertainmentRef, {
          activeKey: "classicfm",
          title: "Classic FM Radio 🎻",
          timestamp: Date.now()
        });
      }
    };

    window.remoteSetEntertainment = async (key) => {
      if (key !== 'off' && !confirm("Turn Classic FM radio ON on Nana's tablet now?")) return;
      if (key === 'off') {
        await set(entertainmentRef, { activeKey: "off", title: "Off", timestamp: Date.now() });
      } else {
        await set(entertainmentRef, { activeKey: "classicfm", title: "Classic FM Radio 🎻", timestamp: Date.now() });
      }
    };

    window.stopRadioAndSync = async (syncToFirebase = true) => {
      isRadioPlaying = false;
      if (radioPlayer) {
        radioPlayer.pause();
        radioPlayer.removeAttribute('src');
        radioPlayer.load();
      }
      const btn = document.getElementById('btn-classicfm');
      if (btn) btn.classList.remove('playing');
      document.getElementById('radio-action-prompt').innerText = "(Tap to Turn On)";
      document.getElementById('radio-status-label').innerText = "Radio Off";

      wakeScreenAndResetDimTimer();

      if (syncToFirebase) {
        await set(entertainmentRef, { activeKey: "off", title: "Off", timestamp: Date.now() });
      }
    };

    function startLocalRadioStream() {
      if (!radioPlayer) return;
      isRadioPlaying = true;
      wakeScreenAndResetDimTimer();

      const vol = Math.min(1.0, Math.max(0.2, (Number(tabletSettings.callVolume) || 85) / 100));
      radioPlayer.volume = vol;
      radioPlayer.src = CLASSIC_FM_STREAM;
      radioPlayer.play().catch(() => {});

      const btn = document.getElementById('btn-classicfm');
      if (btn) btn.classList.add('playing');
      document.getElementById('radio-action-prompt').innerText = "Playing Live...";
      document.getElementById('radio-status-label').innerText = "Playing Classic FM 🎻";
      speakMsg("Playing Classic FM");
    }

    window.adjustNanaRadioVolume = async (delta) => {
      const nextVol = Math.max(25, Math.min(100, (Number(tabletSettings.callVolume) || 85) + delta));
      await window.updateSetting('callVolume', nextVol);
    };

    onValue(entertainmentRef, (snap) => {
      const data = snap.val() || { activeKey: "off", title: "Off" };
      latestEntState = data;
      const activeKey = data.activeKey || "off";

      if (role === 'family') {
        const lbl = document.getElementById('lbl-remote-ent-status');
        if (lbl) lbl.innerText = activeKey === 'off' ? 'Off' : 'Classic FM Playing 🎻';
        const famBtn = document.getElementById('fam-ent-classicfm');
        if (famBtn) famBtn.classList.toggle('selected', activeKey !== 'off');
        updateFamilyPresenceBanner();
      } else if (role === 'nana') {
        if (currentState !== 'idle') return;

        if (activeKey === 'off') {
          if (isRadioPlaying) {
            window.stopRadioAndSync(false);
            showScreen('grid-screen');
          }
          return;
        }

        document.getElementById('night-dimmer').style.display = 'none';
        if (!document.getElementById('radio-screen').classList.contains('active')) {
          showScreen('radio-screen');
        }
        if (!isRadioPlaying) {
          startLocalRadioStream();
        }
      }
    });

    // iOS & Android Guide Modal
    window.openPhoneGuideModal = () => {
      const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
      switchGuideTab(isIOS ? 'ios' : 'android');
      document.getElementById('phone-guide-modal').style.display = 'flex';
    };

    window.closePhoneGuideModal = () => {
      document.getElementById('phone-guide-modal').style.display = 'none';
    };

    window.switchGuideTab = (os) => {
      document.getElementById('tab-btn-ios').classList.toggle('active', os === 'ios');
      document.getElementById('tab-btn-android').classList.toggle('active', os === 'android');
      document.getElementById('guide-content-ios').style.display = os === 'ios' ? 'block' : 'none';
      document.getElementById('guide-content-android').style.display = os === 'android' ? 'block' : 'none';
    };

    // Supervisor PIN Keypad & Gear Settings (1929)
    window.openAdminPinModal = () => {
      enteredPin = "";
      document.getElementById('pin-dots-display').innerText = "";
      document.getElementById('admin-modal-title').innerText = `⚙️ Supervisor & Controls (v${CONFIG.appVersion})`;
      document.getElementById('admin-modal-sub').innerText = "Enter 4-digit PIN (1929) to unlock settings & updates";
      document.getElementById('pin-keypad-section').style.display = 'flex';
      document.getElementById('admin-actions-section').style.display = 'none';
      document.getElementById('admin-pin-modal').style.display = 'flex';
    };

    window.closeAdminPinModal = () => {
      enteredPin = "";
      document.getElementById('admin-pin-modal').style.display = 'none';
    };

    window.clearPinDigits = () => {
      enteredPin = "";
      document.getElementById('pin-dots-display').innerText = "";
    };

    window.pressPinDigit = (digit) => {
      if (enteredPin.length >= 4) return;
      enteredPin += digit;
      document.getElementById('pin-dots-display').innerText = "●".repeat(enteredPin.length);

      if (enteredPin.length === 4) {
        if (enteredPin === CONFIG.adminPin) {
          if (window.AndroidBridge && window.AndroidBridge.unlockAdminForFiveMinutes) {
            window.AndroidBridge.unlockAdminForFiveMinutes();
          }
          document.getElementById('admin-modal-title').innerText = `🔓 Unlocked (v${CONFIG.appVersion})`;
          document.getElementById('admin-modal-sub').innerText = "Configure Brightness, Themes, Keyboard, Volumes, or Update:";
          document.getElementById('pin-keypad-section').style.display = 'none';
          document.getElementById('admin-actions-section').style.display = 'flex';
          refreshSettingsUI();
        } else {
          document.getElementById('pin-dots-display').innerText = "❌";
          setTimeout(() => {
            enteredPin = "";
            document.getElementById('pin-dots-display').innerText = "";
          }, 700);
        }
      }
    };

    window.adminExecuteAction = (action) => {
      const baseFolderUrl = window.location.origin + window.location.pathname.replace(/\/[^\/]*$/, '/');
      const apkDownloadUrl = `${baseFolderUrl}${CONFIG.apkFileName}?t=${Date.now()}`;

      if (action === 'update_apk') {
        if (window.AndroidBridge && window.AndroidBridge.downloadAndInstallApk) {
          window.AndroidBridge.downloadAndInstallApk(apkDownloadUrl);
        } else {
          window.location.href = apkDownloadUrl;
        }
      } else if (action === 'update_web') {
        if (window.AndroidBridge && window.AndroidBridge.clearCacheAndReload) {
          window.AndroidBridge.clearCacheAndReload();
        } else {
          window.location.reload(true);
        }
      } else if (window.AndroidBridge) {
        if (action === 'pin_screen' && window.AndroidBridge.enableScreenPinning) {
          window.AndroidBridge.enableScreenPinning();
        } else if (action === 'settings' && window.AndroidBridge.openAndroidSettings) {
          window.AndroidBridge.openAndroidSettings();
        } else if (action === 'wifi' && window.AndroidBridge.openWifiSettings) {
          window.AndroidBridge.openWifiSettings();
        } else if (action === 'launcher' && window.AndroidBridge.openLenovoLauncher) {
          window.AndroidBridge.openLenovoLauncher();
        } else if (action === 'relock' && window.AndroidBridge.relockKioskNow) {
          window.AndroidBridge.relockKioskNow();
        }
      }
      closeAdminPinModal();
    };

    // Presence & Live Activity Telemetry
    window.resetIdleTimer = () => {
      wakeScreenAndResetDimTimer();
      recordHeartbeat();
    };
    window.addEventListener('pointerdown', () => {
      wakeScreenAndResetDimTimer();
      recordHeartbeat();
    }, { passive: true });
    window.addEventListener('touchstart', () => {
      wakeScreenAndResetDimTimer();
      recordHeartbeat();
    }, { passive: true });

    function recordHeartbeat(customActivity = null) {
      if (role !== 'nana') return;
      let batteryLevel = null;
      let isCharging = null;
      if (window.AndroidBridge && window.AndroidBridge.getBatteryStatusJson) {
        try {
          const b = JSON.parse(window.AndroidBridge.getBatteryStatusJson());
          batteryLevel = b.level;
          isCharging = b.charging;
          if (!isCharging && batteryLevel !== null && batteryLevel <= 25 && !isBatteryVoiceCurrentlyMuted()) {
            window.announceBatteryWarning("Please plug in the tablet charger.");
          }
        } catch (e) {}
      }
      const payload = {
        lastActive: Date.now(),
        batteryLevel: batteryLevel,
        isCharging: isCharging
      };
      if (customActivity) payload.lastActivity = customActivity;
      update(presenceRef, payload);
    }

    if (role === 'nana') {
      setTimeout(() => {
        wakeScreenAndResetDimTimer();
        recordHeartbeat("Tablet Online");
      }, 3000);
      setInterval(() => {
        if (window.AndroidBridge && window.AndroidBridge.getBatteryStatusJson) {
          try {
            const b = JSON.parse(window.AndroidBridge.getBatteryStatusJson());
            update(presenceRef, { batteryLevel: b.level, isCharging: b.charging });
            if (!b.charging && b.level !== null && b.level <= 25 && !isBatteryVoiceCurrentlyMuted()) {
              window.announceBatteryWarning("Please plug in the tablet charger.");
            }
          } catch (e) {}
        }
      }, 120000);
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

      let battText = "";
      if (latestPresenceData?.batteryLevel != null) {
        const icon = latestPresenceData.isCharging ? "🔌 Charging" : "⚠️ UNPLUGGED";
        battText = ` • ${icon} (${latestPresenceData.batteryLevel}%)`;
      }

      const radioStatus = (latestEntState && latestEntState.activeKey && latestEntState.activeKey !== 'off')
        ? `<div style="color:#fef08a; font-weight:800; margin-top:2px;">🎻 Listening to Classic FM Radio</div>`
        : `<div style="color:#94a3b8; font-size:0.9rem;">🎻 Radio: Off (On Home Screen)</div>`;

      const isConnectedToTelegram = connectedMemberIds.includes(activeFamilyMember.id);
      const tgStatusLine = isConnectedToTelegram
        ? `<span style="color:#4ade80; font-size:0.88rem;">✅ Your Telegram alerts are connected</span>`
        : `<span style="color:#fbbf24; font-size:0.88rem;">⚠️ Tap "1. Connect Telegram" below so Nana can call you</span>`;

      const st = latestCallData?.status || 'idle';
      if (st !== 'idle') {
        const otherId = latestCallData.callerId === 'nana' ? latestCallData.targetId : latestCallData.callerId;
        const otherMember = CONFIG.familyMembers.find(m => m.id === otherId);
        const withName = otherMember ? otherMember.name : 'Family';
        const statusLabel = st === 'connected'
          ? `🔴 <strong>On a video call with ${withName}</strong>`
          : `🟡 <strong>Ringing (${withName})</strong>`;
        card.style.borderColor = '#f87171';
        card.innerHTML = `${statusLabel}<br><span style="color:#cbd5e1; font-size:0.9rem;">${touchText}${battText}</span><br>${tgStatusLine}`;
        if (ringBtn && otherId && otherId !== activeFamilyMember.id) {
          ringBtn.disabled = true;
        }
      } else {
        card.style.borderColor = '#22c55e';
        card.innerHTML = `🟢 <strong>Nana is available</strong>${radioStatus}<span style="color:#cbd5e1; font-size:0.9rem;">${touchText}${battText}</span><br>${tgStatusLine}`;
        if (ringBtn) ringBtn.disabled = !tabletSettings.callingEnabled;
        if (!tabletSettings.callingEnabled) {
          card.style.borderColor = '#f59e0b';
          card.innerHTML = `📵 <strong>Video calling is switched off</strong><br><span style="color:#cbd5e1; font-size:0.9rem;">Turn it on in ⚙️ Controls when you're ready.</span><br>${tgStatusLine}`;
        }
      }
    }

    if (role === 'family') {
      onValue(presenceRef, (snap) => {
        latestPresenceData = snap.val() || {};
        updateFamilyPresenceBanner();
      });
      setInterval(updateFamilyPresenceBanner, 30000);
    }

    // Love Toast Banner
    window.sendLoveToastToNana = async () => {
      await set(loveToastRef, {
        senderName: activeFamilyMember.name,
        spokenName: activeFamilyMember.spokenName,
        timestamp: Date.now()
      });
    };

    if (role === 'nana') {
      onValue(loveToastRef, (snap) => {
        const val = snap.val();
        if (!val || !val.timestamp || Date.now() - val.timestamp > 15000) return;
        wakeScreenAndResetDimTimer();
        const banner = document.getElementById('love-toast-banner');
        banner.innerText = `❤️ ${val.senderName} sent you a big hug!`;
        banner.style.display = 'block';
        speakMsg(`${val.spokenName || val.senderName} sent you a big hug and is thinking of you!`);
        setTimeout(() => { banner.style.display = 'none'; }, 7000);
      });
    }

    // Dynamic Connected Contacts Sync
    onValue(connectedMembersRef, (snap) => {
      const val = snap.val();
      if (Array.isArray(val)) {
        connectedMemberIds = val;
      } else if (val && typeof val === 'object') {
        connectedMemberIds = Object.values(val);
      } else {
        connectedMemberIds = [];
      }
      if (role === 'nana') renderContacts(connectedMemberIds);
      if (role === 'family') updateFamilyPresenceBanner();
    });

    window.syncConnectedFamilyFromTelegram = async () => {
      try {
        const res = await fetch(CONFIG.googleScriptUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'text/plain;charset=utf-8' },
          body: JSON.stringify({
            secret: SERVICE_TOKEN,
            action: "sync",
            webhookUrl: CONFIG.googleScriptUrl
          })
        });
        const data = await res.json();
        if (data.ok && Array.isArray(data.connected)) {
          connectedMemberIds = data.connected;
          if (role === 'nana') renderContacts(connectedMemberIds);
          if (role === 'family') updateFamilyPresenceBanner();
        }
        return data;
      } catch (e) {
        return { ok: false, error: e.toString() };
      }
    };

    window.forceWebhookAndMemberSync = async () => {
      const lbl = document.getElementById('lbl-sync-status');
      if (lbl) lbl.innerText = "Syncing...";
      const res = await window.syncConnectedFamilyFromTelegram();
      if (res && res.ok) {
        if (lbl) lbl.innerText = `✅ Linked (${(res.connected || []).length} connected)`;
        alert(`Telegram queue flushed & synced! Connected family members: ${(res.connected || []).join(", ") || "None yet"}`);
      } else {
        if (lbl) lbl.innerText = "⚠️ Check Script Deployment";
        alert("Could not reach Google Apps Script. Make sure you deployed a New Version with 'Who has access: Anyone'.");
      }
    };

    // Per-Person Missed Calls Tracking
    async function incrementMissedCallForMember(memberId) {
      await runTransaction(getMemberMissedCallRef(memberId), (current) => {
        const prevCount = current && current.count ? Number(current.count) : 0;
        return {
          count: prevCount + 1,
          timestamp: Date.now()
        };
      });
    }

    async function clearMissedCallsForMember(memberId) {
      if (!memberId) return;
      await remove(getMemberMissedCallRef(memberId));
    }

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
        .filter(([id, info]) => info && info.count > 0)
        .sort((a, b) => (b[1].timestamp || 0) - (a[1].timestamp || 0));

      if (entries.length === 0) {
        banner.style.display = 'none';
        return;
      }

      entries.forEach(([memberId, info]) => {
        const member = CONFIG.familyMembers.find(m => m.id === memberId);
        if (!member) return;
        const timeStr = info.timestamp
          ? new Date(info.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
          : '';
        const btn = document.createElement('button');
        btn.className = 'missed-chip-btn';
        btn.innerText = `📞 Call ${member.name} (${info.count}${timeStr ? ' • ' + timeStr : ''})`;
        btn.onclick = () => startCallFromNana(member);
        chipsContainer.appendChild(btn);
      });

      banner.style.display = 'flex';
    }

    // ---- Hide me from Nana's contacts (family) ----
    const HIDE_FOREVER = 4102444800000; // year 2100 = "until I turn it back on"
    function isHiddenFromNana(id) { return Number(latestHidden[id] || 0) > Date.now(); }
    function fmtHiddenUntil(ts) {
      if (ts >= HIDE_FOREVER) return 'until you turn it back on';
      const d = new Date(ts);
      const time = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
      const sameDay = d.toDateString() === new Date().toDateString();
      return 'until ' + (sameDay ? time : d.toLocaleDateString([], { weekday: 'short' }) + ' ' + time);
    }
    window.hideMeFromNana = async (choice) => {
      if (role !== 'family' || !activeFamilyMember) return;
      const mins = { '30m': 30, '1h': 60, '2h': 120, '5h': 300, '10h': 600 };
      let until;
      if (mins[choice]) {
        until = Date.now() + mins[choice] * 60000;
      } else if (choice === 'tomorrow') {
        const d = new Date();
        d.setHours(7, 0, 0, 0);
        if (d.getTime() <= Date.now()) d.setDate(d.getDate() + 1);
        until = d.getTime();
      } else {
        until = HIDE_FOREVER;
      }
      try {
        await set(ref(db, `${basePath}/hiddenContacts/${activeFamilyMember.id}`), until);
      } catch (e) {
        alert('Could not hide you: ' + (e && e.message ? e.message : e));
      }
    };
    window.showMeToNana = async () => {
      if (role !== 'family' || !activeFamilyMember) return;
      try {
        await remove(ref(db, `${basePath}/hiddenContacts/${activeFamilyMember.id}`));
      } catch (e) {
        alert('Could not turn you back on: ' + (e && e.message ? e.message : e));
      }
    };
    function refreshHideUI() {
      if (role !== 'family' || typeof activeFamilyMember === 'undefined' || !activeFamilyMember) return;
      const until = Number(latestHidden[activeFamilyMember.id] || 0);
      const hidden = until > Date.now();
      const txt = hidden
        ? `🙈 You're hidden from Nana's contacts ${fmtHiddenUntil(until)}`
        : `👁️ You're visible to Nana (she can call you)`;
      document.querySelectorAll('.hide-status-lbl').forEach(e => { e.innerText = txt; e.style.color = hidden ? '#fbbf24' : '#4ade80'; });
      const line = document.getElementById('hidden-status-line');
      if (line) {
        line.style.display = hidden ? 'flex' : 'none';
        document.getElementById('hidden-status-text').innerText = txt;
      }
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

      if (displayList.length === 0 && connectedMembers.length > 0) {
        grid.innerHTML = `
          <div style="grid-column: 1 / -1; grid-row: 1 / -1; display:flex; flex-direction:column; align-items:center; justify-content:center; width:100%; height:100%; color:var(--text-muted); font-size:1.8rem; font-weight:700; padding:20px; text-align:center;">
            <p style="margin:0;">😴 Nobody is available to call right now.<br>Try again a little later, or send a Family Chat message.</p>
          </div>
        `;
        return;
      }

      if (displayList.length === 0) {
        grid.innerHTML = `
          <div style="grid-column: 1 / -1; grid-row: 1 / -1; display:flex; flex-direction:column; align-items:center; justify-content:center; width:100%; height:100%; color:var(--text-muted); font-size:1.6rem; font-weight:700; padding:20px;">
            <p style="margin:0 0 12px 0;">⏳ Waiting for family members to connect their Telegram alerts...</p>
            <button class="tone-btn" style="font-size:1.2rem; background:#0284c7; border-color:#38bdf8;" onclick="syncConnectedFamilyFromTelegram()">🔄 Check for Connected Family Now</button>
          </div>
        `;
        return;
      }

      displayList.forEach(member => {
        const missedInfo = missedCallsByMember[member.id];
        const missedCount = missedInfo && missedInfo.count ? Number(missedInfo.count) : 0;

        const card = document.createElement('div');
        card.className = missedCount > 0 ? 'family-card has-missed' : 'family-card';

        const badgeHtml = missedCount > 0
          ? `<div class="missed-card-badge">📞 ${missedCount} MISSED</div>`
          : '';

        card.innerHTML = `
          ${badgeHtml}
          <div class="photo-wrapper"><img src="${member.photo}" onerror="this.src='${member.fallback}'"></div>
          <div class="contact-nameplate">${member.name}</div>
        `;
        card.onclick = () => openCallConfirmation(member);
        grid.appendChild(card);
      });
    }

    onValue(getTodayUsageRef(), (snap) => {
      todayMinutesUsed = Number(snap.val()) || 0;
      if (role === 'family') updateFamilyPresenceBanner();
    });

    // Confirm Call Modal Logic
    window.openCallConfirmation = (member) => {
      pendingCallContact = member;
      document.getElementById('confirm-prompt-title').innerText = `Call ${member.name}?`;
      const img = document.getElementById('confirm-photo');
      img.onerror = () => { img.src = member.fallback; };
      img.src = member.photo;

      const missedInfo = missedCallsByMember[member.id];
      const missedNoteEl = document.getElementById('confirm-missed-note');
      if (missedInfo && missedInfo.count > 0) {
        missedNoteEl.innerText = `📞 ${member.name} tried calling you ${missedInfo.count} ${missedInfo.count === 1 ? 'time' : 'times'}`;
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

    // Remote Audio & Settings Controls
    window.openSettingsModal = () => document.getElementById('settings-modal').style.display = 'flex';
    window.closeSettingsModal = () => document.getElementById('settings-modal').style.display = 'none';

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

    function formatDimDelayLabel(sec) {
      const s = Number(sec ?? 120);
      if (s === 0) return "Never";
      if (s < 60) return `${s}s`;
      return `${Math.round(s / 60)}m`;
    }

    window.setCallingEnabled = (on) => window.updateSetting('callingEnabled', !!on);

    window.copyTestLink = async (kind) => {
      const base = window.location.origin + window.location.pathname;
      const link = kind === 'nana'
        ? `${base}?role=nana&test=1`
        : `${base}?role=family&id=${encodeURIComponent(callerId)}&test=1`;
      try {
        await navigator.clipboard.writeText(link);
        alert('Link copied. Open it on a different device:\n' + link);
      } catch (e) {
        window.prompt('Copy this link:', link);
      }
    };

    // If calling is OFF, make sure no call state is left hanging (stops a tablet that keeps ringing).
    function enforceCallingOff() {
      if (role !== 'nana' || !settingsLoaded || tabletSettings.callingEnabled) return;
      if (!latestCallData || latestCallData.status === 'idle') return;
      stopRingingUI();
      set(callStateRef, { status: 'idle', timestamp: Date.now() });
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
      const tlCard = document.getElementById('test-links-card');
      if (tlCard && TEST_MODE) {
        document.getElementById('test-links-sub').innerText = '🧪 You are in TEST MODE. Nothing here touches Nana\'s real tablet. Remove "&test=1" from the address to return to the real portal.';
        document.getElementById('test-links-row').style.display = 'none';
      }

      applyColorTheme(tabletSettings.colorTheme);

      const callVol = tabletSettings.callVolume ?? tabletSettings.volume ?? 85;
      const ringVol = tabletSettings.ringVolume ?? tabletSettings.volume ?? 85;
      const awakeB = tabletSettings.awakeBrightness ?? 85;
      const dimB = tabletSettings.dimBrightness ?? 15;
      const dimSec = tabletSettings.dimDelaySec ?? 120;
      const nStart = tabletSettings.nightStartHour ?? 21;
      const nEnd = tabletSettings.nightEndHour ?? 8;
      const showNotes = tabletSettings.showBulletinBar !== false;
      const showRead = !!tabletSettings.showReadAloud;
      const kbLayout = tabletSettings.keyboardLayout || 'qwerty';
      const kbHideSec = tabletSettings.keyboardTimeoutSec ?? 60;

      document.getElementById('lbl-call-vol').innerText = `${callVol}%`;
      document.getElementById('lbl-ring-vol').innerText = `${ringVol}%`;
      document.getElementById('in-call-vol-label').innerText = `${callVol}%`;
      document.getElementById('nana-vol-display').innerText = `${callVol}%`;
      document.getElementById('lbl-ringtime').innerText = `${tabletSettings.ringDurationSec}s`;

      const brightSum = `${awakeB}% ➔ ${dimB}% (${formatDimDelayLabel(dimSec)})`;
      const gBrightEl = document.getElementById('lbl-gear-bright-summary');
      const rBrightEl = document.getElementById('lbl-remote-bright-summary');
      if (gBrightEl) gBrightEl.innerText = brightSum;
      if (rBrightEl) rBrightEl.innerText = brightSum;

      const kbSummary = `${kbLayout.toUpperCase()} • ${formatDimDelayLabel(kbHideSec)}`;
      const gKbEl = document.getElementById('lbl-gear-kb-summary');
      const rKbEl = document.getElementById('lbl-remote-kb-summary');
      if (gKbEl) gKbEl.innerText = kbSummary;
      if (rKbEl) rKbEl.innerText = kbSummary;

      const gVolEl = document.getElementById('lbl-gear-vol-summary');
      if (gVolEl) gVolEl.innerText = `Call ${callVol}% • Ring ${ringVol}%`;

      const winStr = `${String(nStart).padStart(2, '0')}:00 – ${String(nEnd).padStart(2, '0')}:00`;
      const gWin = document.getElementById('lbl-gear-night-window');
      const rWin = document.getElementById('lbl-remote-night-window');
      if (gWin) gWin.innerText = tabletSettings.nightModeEnabled ? winStr : "Disabled";
      if (rWin) rWin.innerText = tabletSettings.nightModeEnabled ? winStr : "Disabled";

      const mutedUntil = Number(tabletSettings.batteryVoiceMutedUntil) || 0;
      const muteText = mutedUntil > Date.now()
        ? `🔇 Battery Voice Muted until ${new Date(mutedUntil).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
        : `🔊 Battery Voice Announcements: Active`;
      const lblGearMute = document.getElementById('lbl-battery-mute-status');
      const lblRemMute = document.getElementById('lbl-remote-battery-mute');
      if (lblGearMute) lblGearMute.innerText = muteText;
      if (lblRemMute) lblRemMute.innerText = muteText;

      const scaledVol = Math.min(1.0, Math.max(0.2, callVol / 100));
      const remAudio = document.getElementById('remote-audio');
      if (remAudio && role === 'nana') remAudio.volume = scaledVol;
      if (radioPlayer && role === 'nana') radioPlayer.volume = scaledVol;

      const highlight = (prefix, val) => {
        document.querySelectorAll(`[id^="${prefix}"]`).forEach(b => b.classList.remove('selected'));
        const safeVal = String(val).replace('.mp3', '');
        const el = document.getElementById(`${prefix}${safeVal}`);
        if (el) el.classList.add('selected');
      };

      highlight('set-theme-', tabletSettings.colorTheme || 'classic-dark');
      highlight('gear-theme-', tabletSettings.colorTheme || 'classic-dark');

      highlight('set-kblayout-', kbLayout);
      highlight('gear-kblayout-', kbLayout);
      highlight('set-kbhide-', kbHideSec);
      highlight('gear-kbhide-', kbHideSec);

      highlight('set-callvol-', callVol);
      highlight('gear-callvol-', callVol);
      highlight('set-ringvol-', ringVol);
      highlight('gear-ringvol-', ringVol);

      highlight('set-bright-', awakeB);
      highlight('gear-bright-', awakeB);
      highlight('set-dimlvl-', dimB);
      highlight('gear-dimlvl-', dimB);
      highlight('set-dim-', dimSec);
      highlight('gear-dim-', dimSec);

      highlight('set-ring-', tabletSettings.ringDurationSec);
      highlight('set-tone-', tabletSettings.ringtone);
      highlight('set-autoans-', tabletSettings.autoAnswer ? 'on' : 'off');
      highlight('set-voice-', tabletSettings.voicePrompts ? 'on' : 'off');

      highlight('set-notes-', showNotes ? 'on' : 'off');
      highlight('gear-notes-', showNotes ? 'on' : 'off');

      highlight('set-readaloud-', showRead ? 'on' : 'off');
      highlight('gear-readaloud-', showRead ? 'on' : 'off');

      highlight('set-night-', tabletSettings.nightModeEnabled ? 'on' : 'off');
      highlight('gear-night-', tabletSettings.nightModeEnabled ? 'on' : 'off');
      highlight('set-nstart-', nStart);
      highlight('gear-nstart-', nStart);
      highlight('set-nend-', nEnd);
      highlight('gear-nend-', nEnd);

      const dndRem = document.getElementById('set-dnd-block');
      const dndGear = document.getElementById('gear-dnd-block');
      if (dndRem) dndRem.classList.toggle('selected', !!tabletSettings.nightBlockCalls);
      if (dndGear) dndGear.classList.toggle('selected', !!tabletSettings.nightBlockCalls);

      renderSeniorKeyboardLayout();
      renderBulletinFeed();
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

    // WebAudio Synthesizer & MP3 Player
    function playNote(freq, startTime, duration, type = 'sine', baseGain = 0.6, volPercent = 85) {
      if (audioCtx.state === 'suspended') audioCtx.resume();
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      const scaledGain = baseGain * (volPercent / 100);
      osc.type = type;
      osc.frequency.setValueAtTime(freq, startTime);
      gain.gain.setValueAtTime(scaledGain, startTime);
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

        if (activeMp3Ringtone) {
          activeMp3Ringtone.pause();
        }

        activeMp3Ringtone = new Audio(toneName);
        activeMp3Ringtone.volume = scaledVol;
        if (!isPreview) activeMp3Ringtone.loop = true;
        activeMp3Ringtone.play().catch(() => {});
        return;
      }

      if (audioCtx.state === 'suspended') audioCtx.resume();
      const now = audioCtx.currentTime;
      if (toneName === 'uk-phone') {
        [0, 0.55].forEach(offset => {
          playNote(400, now + offset, 0.35, 'square', 0.45, volume);
          playNote(450, now + offset, 0.35, 'square', 0.45, volume);
        });
      } else if (toneName === 'westminster') {
        playNote(329.63, now, 0.35, 'triangle', 0.8, volume);
        playNote(415.30, now + 0.35, 0.35, 'triangle', 0.8, volume);
        playNote(369.99, now + 0.70, 0.35, 'triangle', 0.8, volume);
        playNote(246.94, now + 1.05, 0.65, 'triangle', 0.8, volume);
      } else if (toneName === 'marimba') {
        playNote(523.25, now, 0.25, 'sine', 0.8, volume);
        playNote(659.25, now + 0.22, 0.25, 'sine', 0.8, volume);
        playNote(783.99, now + 0.44, 0.25, 'sine', 0.8, volume);
        playNote(1046.50, now + 0.66, 0.55, 'sine', 0.8, volume);
      } else if (toneName === 'bell') {
        [0, 0.35, 0.70].forEach(offset => {
          playNote(880, now + offset, 0.28, 'sine', 0.75, volume);
          playNote(1760, now + offset, 0.28, 'triangle', 0.5, volume);
        });
      }
    }

    // 6-Stage Telegram Burst Ringing
    async function sendSingleTelegramRing(member, stepNum, maxSteps) {
      const answerUrl = `${window.location.origin + window.location.pathname}?role=family&id=${encodeURIComponent(member.id)}&key=${encodeURIComponent(SERVICE_TOKEN)}&answer=true`;
      try {
        const subEl = document.getElementById('outbound-sub');
        if (subEl) subEl.innerText = `Ringing their mobile now (${stepNum}/${maxSteps})...`;

        const res = await fetch(CONFIG.googleScriptUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'text/plain;charset=utf-8' },
          body: JSON.stringify({
            secret: SERVICE_TOKEN,
            action: "ring",
            memberId: member.id,
            answerUrl: answerUrl,
            ringCount: stepNum,
            maxRings: maxSteps,
            previousMessageId: lastTelegramMsgId
          })
        });
        const data = await res.json();
        if (data.ok && data.messageId) {
          lastTelegramMsgId = data.messageId;
        }
      } catch (e) {}
    }

    function startTelegramRingBurst(member) {
      stopTelegramRingBurst();
      currentDialedMember = member;
      lastTelegramMsgId = null;
      let currentRingStep = 1;
      const maxRings = 6;

      sendSingleTelegramRing(member, currentRingStep, maxRings);

      telegramBurstInterval = setInterval(() => {
        if (currentState !== 'calling_family' || currentRingStep >= maxRings) {
          clearInterval(telegramBurstInterval);
          telegramBurstInterval = null;
          return;
        }
        currentRingStep++;
        sendSingleTelegramRing(member, currentRingStep, maxRings);
      }, 8500);
    }

    function stopTelegramRingBurst() {
      if (telegramBurstInterval) {
        clearInterval(telegramBurstInterval);
        telegramBurstInterval = null;
      }
      if (currentDialedMember && lastTelegramMsgId) {
        const memberId = currentDialedMember.id;
        const msgId = lastTelegramMsgId;
        lastTelegramMsgId = null;
        fetch(CONFIG.googleScriptUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'text/plain;charset=utf-8' },
          body: JSON.stringify({ secret: SERVICE_TOKEN, action: "clear_rings", memberId, messageId: msgId })
        }).catch(() => {});
      }
    }

    // Pre-unlocks mobile Chrome / Android WebView audio on user gesture
    function unlockCallAudio() {
      try {
        if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
        const ra = document.getElementById('remote-audio');
        const rv = document.getElementById('remote-video');
        if (rv) {
          rv.muted = true;
          rv.play().catch(() => {});
        }
        if (ra) {
          ra.muted = false;
          const p = ra.play();
          if (p && p.catch) p.catch(() => {});
        }
      } catch (e) {}
    }

    // Custom WebRTC Video Engine
    async function joinDailyRoom() {
      if (isJoiningOrInRoom || callObject) return;
      isJoiningOrInRoom = true;

      const banner = document.getElementById('call-connecting-banner');
      banner.style.display = 'block';
      banner.innerText = '📹 Connecting video...';

      if (!window.DailyIframe) {
        banner.innerText = '⚠️ Video library failed to load - check connection';
        isJoiningOrInRoom = false;
        return;
      }

      const co = window.DailyIframe.createCallObject({
        audioSource: true,
        videoSource: true
      });
      callObject = co;

      let hadRemote = false;
      let emptyTimer = null;

      const showProblem = (text) => {
        banner.style.display = 'block';
        banner.innerText = text;
      };

      const playEl = (el) => {
        const pr = el.play();
        if (pr && pr.catch) pr.catch(() => {
          showProblem('🔈 Tap anywhere on screen to hear the call');
          const resumeBoth = () => {
            document.getElementById('remote-video')?.play().catch(() => {});
            document.getElementById('remote-audio')?.play().catch(() => {});
            banner.style.display = 'none';
          };
          document.addEventListener('pointerdown', resumeBoth, { once: true });
          document.addEventListener('touchstart', resumeBoth, { once: true });
        });
      };

      let dbg = document.getElementById('call-debug');
      if (!dbg) {
        dbg = document.createElement('div');
        dbg.id = 'call-debug';
        dbg.style.cssText = 'position:absolute;bottom:4px;left:50%;transform:translateX(-50%);z-index:9999;' +
          'font:12px monospace;color:#cbd5e1;background:rgba(0,0,0,0.65);padding:2px 8px;border-radius:6px;pointer-events:none;';
        document.getElementById('call-screen').appendChild(dbg);
      }
      const showDebug = (role !== 'nana') || new URLSearchParams(location.search).has('debug');

      const pickBestRemoteParticipant = () => {
        const remotes = Object.values(co.participants()).filter(p => !p.local);
        if (remotes.length === 0) return null;
        if (role === 'family') {
          return remotes.find(p => p.user_name === 'Nana_Tablet')
              || remotes.find(p => (p.user_name || '').startsWith('Nana'))
              || remotes[0];
        } else {
          return remotes.find(p => (p.user_name || '').startsWith('Family_'))
              || remotes[0];
        }
      };

      const updateDebug = () => {
        if (!showDebug || callObject !== co) { dbg.style.display = 'none'; return; }
        const remotes = Object.values(co.participants()).filter(p => !p.local);
        const r = pickBestRemoteParticipant();
        dbg.style.display = 'block';
        dbg.innerText = `remotes: ${remotes.length} (${r?.user_name || 'none'}) | vid: ${r?.tracks?.video?.state || '?'} | aud: ${r?.tracks?.audio?.state || '?'}`;
      };

      const attachTracks = () => {
        if (callObject !== co) return;
        updateDebug();
        const parts = co.participants();

        const localTrack = parts.local?.tracks?.video?.persistentTrack || parts.local?.tracks?.video?.track;
        if (localTrack) {
          const localVid = document.getElementById('local-video');
          const currentLocalTrack = localVid.srcObject?.getVideoTracks()[0];
          if (currentLocalTrack !== localTrack) {
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

        if (remVidTrack) {
          banner.style.display = 'none';
          const remVid = document.getElementById('remote-video');
          const curVidTrack = remVid.srcObject?.getVideoTracks()[0];
          if (curVidTrack !== remVidTrack) {
            remVid.muted = true;
            remVid.srcObject = new MediaStream([remVidTrack]);
            playEl(remVid);
          }
        }

        if (remAudTrack) {
          const remAud = document.getElementById('remote-audio');
          const curAudTrack = remAud.srcObject?.getAudioTracks()[0];
          if (curAudTrack !== remAudTrack) {
            remAud.muted = false;
            remAud.srcObject = new MediaStream([remAudTrack]);
            playEl(remAud);
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
          updateDebug();
          if (callObject !== co) return;
          clearTimeout(emptyTimer);
          emptyTimer = setTimeout(() => {
            if (callObject !== co) return;
            const remotes = Object.values(co.participants()).filter(p => !p.local);
            if (hadRemote && remotes.length === 0) endCall();
          }, 10000);
        })
        .on('camera-error', (e) => {
          showProblem('⚠️ Camera/microphone problem: ' + (e?.errorMsg?.errorMsg || e?.error?.msg || 'permission denied?'));
        })
        .on('error', (e) => {
          showProblem('⚠️ Video error: ' + (e?.errorMsg || e?.error?.msg || e?.error?.message || 'unknown'));
          setTimeout(() => { if (callObject === co) endCall(); }, 8000);
        });

      const participantTag = role === 'nana'
        ? (isRealAndroidTablet ? 'Nana_Tablet' : 'Nana_Browser')
        : `Family_${activeFamilyMember.id}`;

      try {
        await co.join({
          url: CONFIG.dailyRoomUrl,
          userName: participantTag
        });
        co.setLocalVideo(true);
        co.setLocalAudio(true);
      } catch (err) {
        showProblem('⚠️ Could not join video room: ' + (err?.message || err?.errorMsg || err));
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
        try {
          await co.leave();
          await co.destroy();
        } catch (e) {}
      }
      document.getElementById('remote-video').srcObject = null;
      document.getElementById('remote-audio').srcObject = null;
      document.getElementById('local-video').srcObject = null;
    }

    async function startCallFromNana(member) {
      if (!tabletSettings.callingEnabled) return;
      if (isHiddenFromNana(member.id)) return;
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
        alert('Could not start the call: ' + (e && e.message ? e.message : e));
        return;
      }
      startTelegramRingBurst(member);

      const ringTimeoutMs = (Number(tabletSettings.ringDurationSec) || 60) * 1000;
      clearTimeout(outboundTimeout);
      outboundTimeout = setTimeout(async () => {
        if (currentState === 'calling_family') {
          speakMsg(`Sorry, ${member.spokenName} could not answer right now.`);
          await incrementMissedCallForMember(member.id);
          await endCall();
        }
      }, ringTimeoutMs);
    }

    window.confirmFamilyPickupFromTelegram = async () => {
      unlockCallAudio();
      didManuallyInitiateOrAnswerOnThisTab = true;
      showScreen('call-screen');
      joinDailyRoom();
      await clearMissedCallsForMember(activeFamilyMember.id);
      await set(callStateRef, {
        status: 'connected',
        callerId: 'nana',
        targetId: activeFamilyMember.id,
        timestamp: Date.now()
      });
    };

    window.startCallFromFamily = async () => {
      if (!tabletSettings.callingEnabled) {
        alert("Video calling is switched off for now. Turn it on in ⚙️ Controls when you're ready.");
        return;
      }
      if (!confirm("Ring Nana's tablet now?\n\nPress OK only if you want to video call her.")) return;
      unlockCallAudio();
      didManuallyInitiateOrAnswerOnThisTab = true;
      const ringBtn = document.getElementById('family-ring-btn');
      if (ringBtn) ringBtn.disabled = true;

      try {
        const result = await runTransaction(callStateRef, (current) => {
          const isStale = current && current.timestamp && (Date.now() - current.timestamp > 90000);
          if (current && current.status !== 'idle' && !isStale) {
            return;
          }
          return {
            status: 'ringing_nana',
            callerId: activeFamilyMember.id,
            targetId: 'nana',
            timestamp: Date.now()
          };
        });

        if (!result.committed) {
          alert("Nana's tablet is currently busy on another call. Please wait a moment.");
          if (ringBtn) ringBtn.disabled = false;
          return;
        }

        showScreen('call-screen');
        const banner = document.getElementById('call-connecting-banner');
        if (banner) {
          banner.style.display = 'block';
          banner.innerText = '🔔 Ringing Nana... Waiting for her to answer...';
        }
      } catch (e) {
        if (ringBtn) ringBtn.disabled = !tabletSettings.callingEnabled;
        alert('Could not start the call: ' + (e && e.message ? e.message : e));
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
      if (activeCallerId && activeCallerId !== 'nana') {
        await clearMissedCallsForMember(activeCallerId);
      }
      await set(callStateRef, {
        status: 'connected',
        callerId: activeCallerId || 'family',
        targetId: 'nana',
        timestamp: Date.now()
      });
    };

    window.endCall = async () => {
      clearTimeout(outboundTimeout);
      clearTimeout(incomingRingTimeout);
      clearTimeout(autoAnswerTimeout);
      stopTelegramRingBurst();
      stopCallUsageTimer();
      stopRingingUI();
      const ringBtn = document.getElementById('family-ring-btn');
      if (ringBtn) ringBtn.disabled = !tabletSettings.callingEnabled;
      await set(callStateRef, { status: 'idle', timestamp: Date.now() });
      await destroyDailyRoom();
      showScreen(role === 'family' ? 'family-screen' : 'grid-screen');
    };

    function startCallUsageTimer() {
      if (role !== 'nana' || callTimerInterval) return;
      callTimerInterval = setInterval(() => {
        runTransaction(getTodayUsageRef(), (current) => (Number(current) || 0) + 1);
      }, 60000);
    }

    function stopCallUsageTimer() {
      if (callTimerInterval) {
        clearInterval(callTimerInterval);
        callTimerInterval = null;
      }
    }

    function isCurrentlyInNightWindow() {
      if (!tabletSettings.nightModeEnabled) return false;
      const hour = new Date().getHours();
      const startH = Number(tabletSettings.nightStartHour ?? 21);
      const endH = Number(tabletSettings.nightEndHour ?? 8);
      if (startH > endH) {
        return hour >= startH || hour < endH;
      } else {
        return hour >= startH && hour < endH;
      }
    }

    // Remote refresh of Nana's tablet
    const reloadCmdRef = ref(db, `${basePath}/commands/reloadAt`);

    window.requestTabletReload = async () => {
      const btn = document.getElementById('remote-refresh-btn');
      try {
        await set(reloadCmdRef, Date.now());
        if (btn) { btn.innerText = '✅ Sent!'; setTimeout(() => { btn.innerText = '🔄 Refresh Now'; }, 3000); }
      } catch (e) {
        if (btn) { btn.innerText = '⚠️ Failed - try again'; setTimeout(() => { btn.innerText = '🔄 Refresh Now'; }, 3000); }
      }
    };

    if (role === 'nana') {
      let reloadPending = false;
      const doReload = () => {
        if (window.AndroidBridge && window.AndroidBridge.clearCacheAndReload) {
          window.AndroidBridge.clearCacheAndReload();
        } else {
          window.location.reload(true);
        }
      };
      const tryReload = () => {
        const busy = ['connected', 'ringing_nana', 'calling_family'].includes(currentState);
        if (reloadPending && !busy) doReload();
      };
      onValue(reloadCmdRef, (snap) => {
        const val = Number(snap.val() || 0);
        if (!val) return;
        let last = null;
        try { last = localStorage.getItem('nana_last_reload_cmd'); } catch (e) {}
        try { localStorage.setItem('nana_last_reload_cmd', String(val)); } catch (e) {}
        if (last === null) return;
        if (val > Number(last)) {
          reloadPending = true;
          tryReload();
        }
      });
      setInterval(tryReload, 5000);
    }

    // Call State Router
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
        if (role === 'nana' && isRadioPlaying) {
          window.stopRadioAndSync(true);
        }
      }

      if (role === 'nana') {
        const shouldActAsNanaDevice = isRealAndroidTablet || didManuallyInitiateOrAnswerOnThisTab;

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
          if (isRealAndroidTablet) {
            playSelectedRingtoneAudio(tabletSettings.ringtone, tabletSettings.ringVolume || 85);

            if (tabletSettings.autoAnswer) {
              speakMsg(`${caller.spokenName} is calling you. Connecting automatically.`);
              clearTimeout(autoAnswerTimeout);
              autoAnswerTimeout = setTimeout(() => {
                if (currentState === 'ringing_nana') window.answerCallAsNana();
              }, 10000);
            } else {
              speakMsg(`${caller.spokenName} is calling you. Touch anywhere on the screen to answer.`);
            }

            ringInterval = setInterval(() => {
              playSelectedRingtoneAudio(tabletSettings.ringtone, tabletSettings.ringVolume || 85);
              speakMsg(`${caller.spokenName} is calling you.`);
            }, 6000);

            const ringTimeoutMs = (Number(tabletSettings.ringDurationSec) || 60) * 1000;
            clearTimeout(incomingRingTimeout);
            incomingRingTimeout = setTimeout(async () => {
              if (currentState === 'ringing_nana') {
                await incrementMissedCallForMember(caller.id);
                await endCall();
              }
            }, ringTimeoutMs);
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
          if (connectedPartnerId && isRealAndroidTablet) {
            clearMissedCallsForMember(connectedPartnerId);
          }

          if (shouldActAsNanaDevice) {
            showScreen('call-screen');
            joinDailyRoom();
            startCallUsageTimer();
          } else {
            showScreen('grid-screen');
          }
        } else if (data.status === 'idle') {
          clearTimeout(outboundTimeout);
          clearTimeout(incomingRingTimeout);
          clearTimeout(autoAnswerTimeout);
          stopTelegramRingBurst();
          stopCallUsageTimer();
          stopRingingUI();
          destroyDailyRoom();
          if (!isRadioPlaying) {
            showScreen('grid-screen');
          }
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
      if (ringInterval) clearInterval(ringInterval);
      ringInterval = null;
      if ('speechSynthesis' in window) window.speechSynthesis.cancel();
      
      if (activeMp3Ringtone) {
        activeMp3Ringtone.pause();
        activeMp3Ringtone.currentTime = 0;
        activeMp3Ringtone = null;
      }
    }

    function speakMsg(text, isBatteryAlert = false) {
      if (!tabletSettings.voicePrompts) return;
      if (isBatteryAlert && isBatteryVoiceCurrentlyMuted()) return;
      if (isBatteryVoiceCurrentlyMuted() && /battery|charger|plug|power/i.test(text)) return;

      if ('speechSynthesis' in window && text) {
        window.speechSynthesis.cancel();
        const u = new SpeechSynthesisUtterance(text);
        u.rate = Number(tabletSettings.speechRate) || 0.9;
        window.speechSynthesis.speak(u);
      }
    }

    // Role Router
    if (role === 'family') {
      document.getElementById('family-greeting').innerText = `Call Nana (as ${activeFamilyMember.name})`;
      const selfImg = document.getElementById('family-self-photo');
      selfImg.onerror = () => { selfImg.src = activeFamilyMember.fallback; };
      selfImg.src = activeFamilyMember.photo;
      document.getElementById('in-call-volume-bar').style.display = 'flex';
      document.getElementById('telegram-link-btn').href = `https://t.me/${CONFIG.telegramBotUsername}?start=${activeFamilyMember.id}`;
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

    function updateClock() {
      const timeStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      const clockEl = document.getElementById('clock');
      const nightClockEl = document.getElementById('night-clock');
      if (clockEl) clockEl.innerText = timeStr;
      if (nightClockEl) nightClockEl.innerText = timeStr;

      const canShowDimmer = isCurrentlyInNightWindow() && currentState === 'idle' && !isRadioPlaying && Date.now() > nightDismissedUntilMs;
      const dimmerEl = document.getElementById('night-dimmer');
      if (dimmerEl) dimmerEl.style.display = canShowDimmer ? 'flex' : 'none';
    }

    window.wakeFromNightMode = () => {
      nightDismissedUntilMs = Date.now() + 15 * 60 * 1000;
      document.getElementById('night-dimmer').style.display = 'none';
      wakeScreenAndResetDimTimer();
    };
  