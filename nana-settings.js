import {
  $, NanaCore, EXPECTED_PIN_HASH, sha256Hex,
  ref, set, update, onValue, remove
} from "./nana-core.js?v=2.9.3";

const {
  CONFIG, SERVICE_TOKEN, role, callerId, activeFamilyMember, isAdminFamilyMember,
  basePath, db, refs, settings, state, hooks, speakMsg, isBatteryVoiceCurrentlyMuted
} = NanaCore;

let enteredPin = "";
let idleDimTimer = null;
let nightDismissedUntilMs = 0;
let lastBatterySpokenMs = 0;
const HIDE_FOREVER = 4102444800000;

function parseHoursArray(val, fallback) {
  if (Array.isArray(val)) return val.map(Number).filter(n => !isNaN(n));
  if (val && typeof val === 'object') return Object.values(val).map(Number).filter(n => !isNaN(n));
  if (val === 'none') return [];
  return fallback;
}

export function formatPromptSlotLabel(slot) {
  const num = Number(slot);
  const hr = Math.floor(num);
  const mins = Math.round((num - hr) * 60) === 30 ? '30' : '00';
  return `${String(hr).padStart(2, '0')}:${mins}`;
}

const fmtDelay = (sec) => {
  const s = Number(sec ?? 120);
  return s === 0 ? "Never" : (s < 60 ? `${s}s` : `${Math.round(s / 60)}m`);
};

// --- 1. SINGLE-PASS DYNAMIC CONTROLS & SETTINGS BUILDER ---
(function buildAllSettingsControls() {
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

  const startSel = $('sched-start-hour'), endSel = $('sched-end-hour');
  if (startSel && endSel) {
    for (let h = 0; h < 24; h++) {
      const label = `${String(h).padStart(2, '0')}:00`;
      startSel.add(new Option(label, String(h)));
      endSel.add(new Option(label, String(h)));
    }
    startSel.value = "8";
    endSel.value = "21";
  }

  const sc = $('shared-settings-cards');
  if (!sc) return;

  const optBtns = (key, pairs, fn = 'updateSetting') => pairs.map(([val, lbl]) =>
    `<button class="opt-btn" data-skey="${key}" data-sval="${val}" onclick="${fn}('${key}', ${typeof val === 'string' ? `'${val}'` : val})">${lbl}</button>`
  ).join('');

  const hourToggles = (listKey, slots) => slots.map(slot =>
    `<button class="opt-btn" style="min-width:62px;padding:7px 6px;font-size:0.86rem;" data-pphourlist="${listKey}" data-pphour="${slot}" onclick="toggleScheduledPromptHour('${listKey}', ${slot})">${formatPromptSlotLabel(slot)}</button>`
  ).join('');

  const radioTimeSlots = [9, 9.5, 10, 10.5, 11, 11.5, 13, 13.5, 14, 14.5, 15, 15.5, 16, 16.5, 19, 19.5];
  const videoTimeSlots = [11, 11.5, 14, 14.5, 16, 16.5, 17, 17.5, 18, 18.5, 19, 19.5, 20, 20.5];

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
      <div class="settings-label"><span>🔊 Volumes & Vocal Clarity DSP</span><span class="lbl-vol-summary" style="color:#38bdf8;font-size:0.92rem;"></span></div>
      <div class="settings-sub" style="margin-bottom:4px;">🎙️ Nana's Tablet Mic DSP (Bandpass 130Hz–4.2kHz + 2.2kHz Presence EQ + Leveller + Krisp AI):</div>
      <div class="opt-row" style="margin-bottom:8px;">${optBtns('nanaMicDspMode', [['raw','🎙️ Raw Mic'],['vocal-boost','🗣️ Vocal Boost (1.8x)'],['max-boost','📢 Max Vocal Boost (2.5x)']])}</div>
      <div class="settings-sub" style="margin-bottom:4px;">📢 Boost Nana's Incoming Voice on Family Phones (Web Audio Amplifier):</div>
      <div class="opt-row" style="margin-bottom:8px;">${optBtns('familyVoiceBoostPct', [[100,'100% (Normal)'],[180,'180% (Boost)'],[250,'250% (High)'],[300,'300% (Max)']])}</div>
      <div class="settings-sub" style="margin-bottom:4px;">📹 Video Call Voice Volume (On Nana's Tablet Speaker):</div>
      <div class="opt-row" style="margin-bottom:8px;">${optBtns('callVolume', [[30,'30%'],[50,'50%'],[70,'70%'],[85,'85%'],[100,'100%']])}</div>
      <div class="settings-sub" style="margin-bottom:4px;">🎻 Classic FM Radio Volume:</div>
      <div class="opt-row" style="margin-bottom:8px;">${optBtns('radioVolume', [[25,'25%'],[45,'45%'],[60,'60%'],[75,'75%'],[90,'90%'],[100,'100%']])}</div>
      <div class="settings-sub" style="margin-bottom:4px;">🔔 Incoming Call Ringing Volume:</div>
      <div class="opt-row">${optBtns('ringVolume', [[30,'30%'],[50,'50%'],[70,'70%'],[85,'85%'],[100,'100%']])}</div>
    </div>
    <div class="settings-card">
      <div class="settings-label"><span>🔋 Battery Unplugged Voice Interval, Volume & Mute</span><span class="lbl-battery-summary" style="color:#38bdf8;font-size:0.92rem;">Every 3m • 85%</span></div>
      <div class="settings-sub lbl-battery-mute">Battery Voice Status: Active</div>
      <div class="settings-sub" style="margin-bottom:4px;">🔌 Start Speaking When Unplugged At or Below:</div>
      <div class="opt-row" style="margin-bottom:8px;">${optBtns('batteryVoiceThresholdPct', [[100,'100% (Immediately)'],[80,'80%'],[50,'50%'],[35,'35%'],[25,'25%']])}</div>
      <div class="settings-sub" style="margin-bottom:4px;">⏱️ Unplugged Voice Repeat Interval:</div>
      <div class="opt-row" style="margin-bottom:8px;">${optBtns('batteryVoiceIntervalMin', [[1,'1m'],[3,'3m'],[5,'5m'],[10,'10m'],[15,'15m'],[30,'30m']])}</div>
      <div class="settings-sub" style="margin-bottom:4px;">🔊 Unplugged Voice Alert Volume:</div>
      <div class="opt-row" style="margin-bottom:8px;">${optBtns('batteryVoiceVolume', [[30,'30%'],[50,'50%'],[70,'70%'],[85,'85%'],[100,'100%']])}</div>
      <div class="opt-row" style="margin-bottom:8px;">
        <button class="opt-btn" style="background:#dc2626;border-color:#fff;color:#fff;" onclick="clearAllMissedCalls()">🧹 Clear Missed Calls</button>
        <button class="opt-btn" onclick="muteBatteryVoiceForHours(0)">🔊 Unmute Battery Voice</button>
      </div>
      <div class="opt-row">
        ${[1,4,12,24].map(h => `<button class="opt-btn" onclick="muteBatteryVoiceForHours(${h})">🔇 Mute ${h}h</button>`).join('')}
      </div>
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
      <div class="settings-label"><span>💬 Family Notes Alert Bar & Read Aloud</span></div>
      <div class="opt-row" style="margin-bottom:6px;">
        ${optBtns('showBulletinBar', [[true,'💬 Show Alert Bar'],[false,'🙈 Hide Alert Bar']])}
        <button class="opt-btn" style="background:#0284c7;border-color:#fff;color:#fff;" onclick="dismissCurrentBulletinBar(true)">🧹 Mark All Read</button>
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
    <div class="settings-card">
      <div class="settings-label">
        <span>💚 Today's Calls Memory Banner & Scheduled Prompts</span>
        <span id="lbl-periodic-summary" style="color:#38bdf8;font-size:0.88rem;">Active</span>
      </div>
      <div class="settings-sub">Reassures Nana with a summary of who she has spoken to today, and offers scheduled entertainment prompts (supports on-the-hour and half-past times).</div>
      <div class="opt-row" style="margin-bottom:8px;">${optBtns('showTodaysCallsBanner', [[true,"💚 Show Today's Calls Banner"],[false,"🙈 Hide Today's Calls Banner"]])}</div>
      <div class="opt-row" style="margin-bottom:8px;">${optBtns('periodicPopupsEnabled', [[true,'✅ Scheduled Pop-Ups ON'],[false,'🔕 Scheduled Pop-Ups OFF']])}</div>
      <div class="settings-sub" style="margin-bottom:4px;">🎻 Classic FM Radio Prompt Times (Tap times to toggle on/off):</div>
      <div class="opt-row" style="margin-bottom:8px;">
        ${hourToggles('radioPromptHours', radioTimeSlots)}
        <button class="opt-btn" style="background:#7f1d1d;color:#fff;min-width:62px;" onclick="clearScheduledPromptHours('radioPromptHours')">Off</button>
      </div>
      <div class="settings-sub" style="margin-bottom:4px;">🎬 Judge John Deed Video Prompt Times (Tap times to toggle on/off):</div>
      <div class="opt-row" style="margin-bottom:8px;">
        ${hourToggles('videoPromptHours', videoTimeSlots)}
        <button class="opt-btn" style="background:#7f1d1d;color:#fff;min-width:62px;" onclick="clearScheduledPromptHours('videoPromptHours')">Off</button>
      </div>
      <div class="settings-sub" style="margin-bottom:4px;">💬 Unread Family Chat Reminder ("You have unread messages, would you like to read them?"):</div>
      <div class="opt-row" style="margin-bottom:8px;">${optBtns('unreadChatPopupMin', [[0,'Off'],[15,'15m'],[30,'30m'],[60,'1h'],[120,'2h']])}</div>
      <div class="settings-sub" style="margin-bottom:4px;">🗣️ Pop-Up Question & Prompt Voice:</div>
      <div class="opt-row">${optBtns('speakQuestions', [[true,'🔊 Read Prompts Aloud'],[false,'🔇 Silent Pop-Ups Only']], 'setGlobalQuestionSpeak')}</div>
    </div>
  `;
})();

// --- 2. BRIGHTNESS, NIGHT MODE & CLOCK ---
export function applyScreenBrightness(targetPercent) {
  if (role !== 'nana') return;
  const pct = Math.max(5, Math.min(100, Number(targetPercent) || 85));
  const overlay = $('brightness-overlay');
  if (overlay) {
    overlay.style.opacity = Math.max(0, Math.min(0.88, (100 - pct) / 105)).toFixed(2);
    overlay.style.pointerEvents = pct < (settings.awakeBrightness ?? 85) ? 'auto' : 'none';
  }
  const activeVol = state.currentState === 'connected'
    ? Number(settings.callVolume ?? 85)
    : (state.isRadioPlaying ? Number(settings.radioVolume ?? 75) : Number(settings.ringVolume ?? 85));
  window.AndroidBridge?.updateTabletHardwareSettings?.(activeVol, pct, Number(settings.dimDelaySec ?? 120), Number(settings.speechRate) || 0.9);
}

window.wakeScreenAndResetDimTimer = function () {
  if (role !== 'nana') return;
  applyScreenBrightness(settings.awakeBrightness ?? 85);
  clearTimeout(idleDimTimer);
  const delaySec = Number(settings.dimDelaySec ?? 120);
  if (delaySec > 0 && state.currentState === 'idle' && !NanaCore.isNanaVideoActivelyPlaying()) {
    idleDimTimer = setTimeout(() => {
      if (state.currentState === 'idle' && !NanaCore.isNanaVideoActivelyPlaying()) {
        window.closeSeniorKeyboard?.(true);
        applyScreenBrightness(settings.dimBrightness ?? 15);
      }
    }, delaySec * 1000);
  }
};

export function isCurrentlyInNightWindow() {
  if (!settings.nightModeEnabled) return false;
  const h = new Date().getHours();
  const s = Number(settings.nightStartHour ?? 21), e = Number(settings.nightEndHour ?? 8);
  return s > e ? (h >= s || h < e) : (h >= s && h < e);
}
NanaCore.isCurrentlyInNightWindow = isCurrentlyInNightWindow;

export function updateClock() {
  const t = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  if ($('clock')) $('clock').innerText = t;
  if ($('night-clock')) $('night-clock').innerText = t;
  if ($('night-dimmer')) {
    const showNight = isCurrentlyInNightWindow() && state.currentState === 'idle' && !NanaCore.isNanaVideoActivelyPlaying() && Date.now() > nightDismissedUntilMs;
    $('night-dimmer').style.display = showNight ? 'flex' : 'none';
  }
}

window.wakeFromNightMode = () => {
  nightDismissedUntilMs = Date.now() + 15 * 60 * 1000;
  if ($('night-dimmer')) $('night-dimmer').style.display = 'none';
  window.wakeScreenAndResetDimTimer();
};

// --- 3. BATTERY VOICE WARNINGS & MUTE ---
window.muteBatteryVoiceForHours = async (hours) => {
  const mutedUntil = hours > 0 ? (Date.now() + hours * 3600 * 1000) : 0;
  settings.batteryVoiceMutedUntil = mutedUntil;
  window.speechSynthesis?.cancel();
  window.AndroidBridge?.muteBatteryVoiceForMinutes?.(hours * 60);
  refreshSettingsUI();
  await update(refs.settings, { batteryVoiceMutedUntil: mutedUntil });
};

window.announceBatteryWarning = (text) => {
  const intervalMs = Math.max(1, Number(settings.batteryVoiceIntervalMin) || 3) * 60000;
  if (isBatteryVoiceCurrentlyMuted() || (Date.now() - lastBatterySpokenMs < intervalMs)) return;
  lastBatterySpokenMs = Date.now();
  const battVol = Math.min(100, Math.max(20, Number(settings.batteryVoiceVolume) || 85));
  if (role === 'nana' && window.AndroidBridge?.updateTabletHardwareSettings) {
    window.AndroidBridge.updateTabletHardwareSettings(battVol, Number(settings.awakeBrightness ?? 85), Number(settings.dimDelaySec ?? 120), Number(settings.speechRate) || 0.9);
  }
  speakMsg(text, true, battVol / 100);
};

// --- 4. SUPERVISOR PIN, ANDROID ADMIN & PHONE GUIDE MODALS ---
window.openPhoneGuideModal = () => {
  window.switchGuideTab(/iPad|iPhone|iPod/.test(navigator.userAgent) ? 'ios' : 'android');
  $('phone-guide-modal').style.display = 'flex';
};
window.closePhoneGuideModal = () => { $('phone-guide-modal').style.display = 'none'; };
window.switchGuideTab = (os) => {
  $('tab-btn-ios')?.classList.toggle('active', os === 'ios');
  $('tab-btn-android')?.classList.toggle('active', os === 'android');
  if ($('guide-content-ios')) $('guide-content-ios').style.display = os === 'ios' ? 'block' : 'none';
  if ($('guide-content-android')) $('guide-content-android').style.display = os === 'ios' ? 'none' : 'block';
};

window.openAdminPinModal = () => {
  enteredPin = "";
  if ($('pin-dots-display')) $('pin-dots-display').innerText = "";
  if ($('admin-modal-title')) $('admin-modal-title').innerText = `⚙️ Supervisor & Controls (v${CONFIG.appVersion})`;
  if ($('pin-keypad-section')) $('pin-keypad-section').style.display = 'flex';
  if ($('admin-actions-section')) $('admin-actions-section').style.display = 'none';
  $('admin-pin-modal').style.display = 'flex';
};
window.closeAdminPinModal = () => { enteredPin = ""; $('admin-pin-modal').style.display = 'none'; };
window.clearPinDigits = () => { enteredPin = ""; if ($('pin-dots-display')) $('pin-dots-display').innerText = ""; };

window.pressPinDigit = async (d) => {
  if (enteredPin.length >= 4) return;
  enteredPin += d;
  if ($('pin-dots-display')) $('pin-dots-display').innerText = "●".repeat(enteredPin.length);
  if (enteredPin.length === 4) {
    const candidateHash = await sha256Hex("nana-pin-salt:" + enteredPin);
    if (candidateHash === EXPECTED_PIN_HASH) {
      window.AndroidBridge?.unlockAdminForFiveMinutes?.();
      const cards = $('shared-settings-cards'), mount = $('gear-settings-mount');
      if (cards && mount && cards.parentElement !== mount) mount.appendChild(cards);
      if ($('admin-modal-title')) $('admin-modal-title').innerText = `🔓 Unlocked (v${CONFIG.appVersion})`;
      if ($('pin-keypad-section')) $('pin-keypad-section').style.display = 'none';
      if ($('admin-actions-section')) $('admin-actions-section').style.display = 'flex';
      refreshSettingsUI();
    } else {
      if ($('pin-dots-display')) $('pin-dots-display').innerText = "❌";
      setTimeout(window.clearPinDigits, 700);
    }
  }
};

window.adminExecuteAction = (action) => {
  const apkUrl = `${window.location.origin + window.location.pathname.replace(/\/[^\/]*$/, '/')}${CONFIG.apkFileName}?t=${Date.now()}`;
  if (action === 'update_apk') {
    window.AndroidBridge?.downloadAndInstallApk ? window.AndroidBridge.downloadAndInstallApk(apkUrl) : (window.location.href = apkUrl);
  } else if (action === 'update_web') {
    window.AndroidBridge?.clearCacheAndReload ? window.AndroidBridge.clearCacheAndReload() : window.location.reload(true);
  } else {
    const map = { pin_screen: 'enableScreenPinning', settings: 'openAndroidSettings', wifi: 'openWifiSettings', launcher: 'openLenovoLauncher', relock: 'relockKioskNow' };
    window.AndroidBridge?.[map[action]]?.();
  }
  window.closeAdminPinModal();
};

// --- 5. REMOTE SETTINGS MODAL & UPDATERS ---
window.openSettingsModal = () => {
  if (role === 'family' && !isAdminFamilyMember) return;
  const cards = $('shared-settings-cards'), mount = $('family-settings-mount');
  if (cards && mount && cards.parentElement !== mount) mount.appendChild(cards);
  refreshSettingsUI();
  $('settings-modal').style.display = 'flex';
};
window.closeSettingsModal = () => { $('settings-modal').style.display = 'none'; };

window.updateSetting = async (key, value) => {
  settings[key] = value;
  refreshSettingsUI();
  updateClock();
  hooks.updateBulletinTicker?.();
  window.wakeScreenAndResetDimTimer();
  await update(refs.settings, { [key]: value });
};

window.toggleSetting = (key) => window.updateSetting(key, !settings[key]);
window.setCallingEnabled = (on) => window.updateSetting('callingEnabled', !!on);
window.stepNanaCallVolume = (delta) => window.updateSetting('callVolume', Math.max(25, Math.min(100, (Number(settings.callVolume) || 85) + delta)));
window.adjustNanaRadioVolume = (delta) => window.updateSetting('radioVolume', Math.max(15, Math.min(100, (Number(settings.radioVolume ?? 75)) + delta)));

window.cycleFamilyVoiceBoost = () => {
  const steps = [100, 180, 250, 300];
  const cur = Number(settings.familyVoiceBoostPct ?? 180);
  const next = steps[(steps.indexOf(cur) + 1) % steps.length] || 180;
  window.updateSetting('familyVoiceBoostPct', next);
};

window.setFamilyQuestionSilentMode = (silent) => {
  state.familyComposerSilent = !!silent;
  $('btn-q-voice-loud')?.classList.toggle('selected', !state.familyComposerSilent);
  $('btn-q-voice-silent')?.classList.toggle('selected', state.familyComposerSilent);
};

window.setGlobalQuestionSpeak = async (_key, speakOn) => {
  const val = typeof _key === 'boolean' ? _key : !!speakOn;
  settings.speakQuestions = val;
  window.setFamilyQuestionSilentMode(!val);
  refreshSettingsUI();
  await update(refs.settings, { speakQuestions: val });
};

window.toggleScheduledPromptHour = async (listKey, slot) => {
  const numSlot = Number(slot);
  const cur = [...(settings[listKey] || [])].map(Number);
  const idx = cur.indexOf(numSlot);
  if (idx >= 0) cur.splice(idx, 1);
  else cur.push(numSlot);
  cur.sort((a, b) => a - b);
  settings[listKey] = cur;
  refreshSettingsUI();
  await update(refs.settings, { [listKey]: cur.length ? cur : 'none' });
};

window.clearScheduledPromptHours = async (listKey) => {
  settings[listKey] = [];
  refreshSettingsUI();
  await update(refs.settings, { [listKey]: 'none' });
};

window.copyTestLink = async (kind) => {
  const base = window.location.origin + window.location.pathname;
  const link = kind === 'nana'
    ? `${base}?role=nana&key=${encodeURIComponent(SERVICE_TOKEN)}&test=1`
    : `${base}?role=family&id=${encodeURIComponent(callerId)}&key=${encodeURIComponent(SERVICE_TOKEN)}&test=1`;
  try { await navigator.clipboard.writeText(link); alert('Copied:\n' + link); }
  catch (_) { window.prompt('Copy link:', link); }
};

window.requestTabletReload = async () => {
  const b = $('remote-refresh-btn');
  try {
    // Also clear any stuck ringing/call state so the tablet is never blocked from reloading
    await set(refs.callState, { status: 'idle', timestamp: Date.now() });
    await set(refs.reloadCmd, Date.now());
    if (b) { b.innerText = '✅ Sent!'; setTimeout(() => { b.innerText = '🔄 Refresh Now'; }, 3000); }
  } catch (_) {}
};

export function refreshSettingsUI() {
  const callingOn = !!settings.callingEnabled;
  document.body.classList.toggle('calling-off', !callingOn);
  if ($('grid-header-title')) $('grid-header-title').innerText = callingOn ? 'Tap a photo to call family' : 'Family Chat & Radio';
  document.querySelectorAll('.calling-on-btn').forEach(b => b.classList.toggle('selected', callingOn));
  document.querySelectorAll('.calling-off-btn').forEach(b => b.classList.toggle('selected', !callingOn));
  document.querySelectorAll('.calling-status-lbl').forEach(l => {
    l.innerText = callingOn ? '✅ Calling is ON' : '📵 Calling is OFF';
    l.style.color = callingOn ? '#4ade80' : '#fca5a5';
  });

  const ringBtn = $('family-ring-btn');
  if (ringBtn) {
    ringBtn.innerText = callingOn ? '📹 Ring Nana Now' : '📵 Calling is switched off';
    if (!callingOn) ringBtn.disabled = true;
  }

  const theme = settings.colorTheme || 'classic-dark';
  document.body.classList.remove('theme-yellow-black', 'theme-white-black', 'theme-black-cream');
  if (theme !== 'classic-dark') document.body.classList.add(`theme-${theme}`);

  const callVol = Number(settings.callVolume ?? 85), radVol = Number(settings.radioVolume ?? 75);
  const boostPct = Number(settings.familyVoiceBoostPct ?? 180);
  const dspMode = settings.nanaMicDspMode || 'vocal-boost';
  const awakeB = Number(settings.awakeBrightness ?? 85), dimB = Number(settings.dimBrightness ?? 15), dimSec = Number(settings.dimDelaySec ?? 120);
  const nStart = Number(settings.nightStartHour ?? 21), nEnd = Number(settings.nightEndHour ?? 8);
  const kbLayout = settings.keyboardLayout || 'qwerty', kbHideSec = Number(settings.keyboardTimeoutSec ?? 60);
  const battIntMin = Number(settings.batteryVoiceIntervalMin ?? 3), battVol = Number(settings.batteryVoiceVolume ?? 85);

  if ($('in-call-vol-label')) $('in-call-vol-label').innerText = `${callVol}%`;
  if ($('nana-vol-display')) $('nana-vol-display').innerText = `${radVol}%`;

  const boostBtn = $('btn-family-voice-boost');
  if (boostBtn) {
    boostBtn.innerText = `📢 Boost Nana: ${boostPct}%`;
    boostBtn.style.background = boostPct > 100 ? '#7c3aed' : '#334155';
    boostBtn.style.borderColor = boostPct >= 250 ? '#fef08a' : '#fff';
  }

  document.querySelectorAll('.lbl-bright-summary').forEach(e => { e.innerText = `${awakeB}% ➔ ${dimB}% (${fmtDelay(dimSec)})`; });
  document.querySelectorAll('.lbl-kb-summary').forEach(e => { e.innerText = `${kbLayout.toUpperCase()} • ${fmtDelay(kbHideSec)}`; });
  document.querySelectorAll('.lbl-vol-summary').forEach(e => {
    e.innerText = `Mic: ${dspMode} • Boost: ${boostPct}% • Call ${callVol}%`;
  });
  document.querySelectorAll('.lbl-battery-summary').forEach(e => { e.innerText = `Every ${battIntMin}m • Vol ${battVol}%`; });
  document.querySelectorAll('.lbl-night-window').forEach(e => {
    e.innerText = settings.nightModeEnabled ? `${String(nStart).padStart(2,'0')}:00 – ${String(nEnd).padStart(2,'0')}:00` : "Disabled";
  });

  const mutedUntil = Number(settings.batteryVoiceMutedUntil) || 0;
  const muteTxt = mutedUntil > Date.now()
    ? `🔇 Muted until ${new Date(mutedUntil).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
    : `🔊 Battery Voice: Active (Every ${battIntMin}m at ${battVol}% vol, <= ${settings.batteryVoiceThresholdPct ?? 100}%)`;
  document.querySelectorAll('.lbl-battery-mute').forEach(e => { e.innerText = muteTxt; });

  const sCall = Math.min(1.0, Math.max(0.2, callVol / 100)), sRad = Math.min(1.0, Math.max(0.15, radVol / 100));
  if ($('remote-audio') && role === 'nana') $('remote-audio').volume = sCall;
  if ($('remote-video') && role === 'nana') $('remote-video').volume = sCall;
  if ($('nana-radio-stream') && role === 'nana') $('nana-radio-stream').volume = sRad;

  document.querySelectorAll('[data-skey]').forEach(btn => {
    btn.classList.toggle('selected', String(settings[btn.dataset.skey]) === String(btn.dataset.sval));
  });

  ['radioPromptHours', 'videoPromptHours'].forEach(listKey => {
    const arr = (settings[listKey] || []).map(Number);
    document.querySelectorAll(`[data-pphourlist="${listKey}"]`).forEach(btn => {
      btn.classList.toggle('selected', arr.includes(Number(btn.dataset.pphour)));
    });
  });

  const sumEl = $('lbl-periodic-summary');
  if (sumEl) {
    if (!settings.periodicPopupsEnabled) {
      sumEl.innerText = '🔕 Pop-Ups Off';
      sumEl.style.color = '#fca5a5';
    } else {
      const rHrs = (settings.radioPromptHours || []).map(formatPromptSlotLabel).join(', ') || 'Off';
      const vHrs = (settings.videoPromptHours || []).map(formatPromptSlotLabel).join(', ') || 'Off';
      sumEl.innerText = `Radio [${rHrs}] • Video [${vHrs}]`;
      sumEl.style.color = '#38bdf8';
    }
  }

  hooks.renderTodaysCallsBanner?.();
  hooks.onSettingsChanged.forEach(fn => fn(settings));
}

onValue(refs.settings, snap => {
  const remote = snap.val();
  if (remote) {
    Object.assign(settings, remote);
    if (remote.radioPromptHours !== undefined) settings.radioPromptHours = parseHoursArray(remote.radioPromptHours, [10, 15]);
    if (remote.videoPromptHours !== undefined) settings.videoPromptHours = parseHoursArray(remote.videoPromptHours, [14, 19]);
    if (remote.speakQuestions !== undefined) window.setFamilyQuestionSilentMode(!settings.speakQuestions);
  }
  state.settingsLoaded = true;
  refreshSettingsUI();
  updateClock();
  hooks.updateBulletinTicker?.();
  window.wakeScreenAndResetDimTimer();
  hooks.refreshFamilyPresence?.();
});

// --- 6. HIDE-ME & TIMEZONE-AWARE CALLING SCHEDULES ---
function getCurrentHourInTimezone(tz) {
  try {
    const parts = new Intl.DateTimeFormat('en-GB', { timeZone: tz || 'Europe/London', hour: 'numeric', hour12: false }).formatToParts(new Date());
    const hrVal = Number(parts.find(p => p.type === 'hour')?.value ?? new Date().getHours());
    return hrVal === 24 ? 0 : hrVal;
  } catch (_) {
    return new Date().getHours();
  }
}

export function isMemberWithinAllowedCallHours(id) {
  const sched = state.callSchedulesSnap[id];
  if (!sched || !sched.enabled) return true;
  const h = getCurrentHourInTimezone(sched.timezone || 'Europe/London');
  const s = Number(sched.startHour ?? 8), e = Number(sched.endHour ?? 21);
  if (s === e) return true;
  return s < e ? (h >= s && h < e) : (h >= s || h < e);
}

export const isHiddenFromNana = (id) => (Number(state.hiddenSnap[id] || 0) > Date.now()) || !isMemberWithinAllowedCallHours(id);
NanaCore.isHiddenFromNana = isHiddenFromNana;

window.hideMeFromNana = async (choice) => {
  if (role !== 'family' || !activeFamilyMember) return;
  const mins = { '30m': 30, '1h': 60, '2h': 120, '5h': 300, '10h': 600 };
  let until = HIDE_FOREVER;
  if (mins[choice]) until = Date.now() + mins[choice] * 60000;
  else if (choice === 'tomorrow') {
    const d = new Date(); d.setHours(7,0,0,0);
    if (d <= Date.now()) d.setDate(d.getDate() + 1);
    until = d.getTime();
  }
  await set(ref(db, `${basePath}/hiddenContacts/${activeFamilyMember.id}`), until);
};

window.showMeToNana = () => (role === 'family' && activeFamilyMember)
  ? remove(ref(db, `${basePath}/hiddenContacts/${activeFamilyMember.id}`))
  : null;

window.setMyCallScheduleMode = async (enabled) => {
  if (role !== 'family' || !activeFamilyMember) return;
  const myTz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'Europe/London';
  const cur = state.callSchedulesSnap[activeFamilyMember.id] || {};
  const startHour = Number($('sched-start-hour')?.value ?? cur.startHour ?? 8);
  const endHour = Number($('sched-end-hour')?.value ?? cur.endHour ?? 21);
  await set(ref(db, `${basePath}/callSchedules/${activeFamilyMember.id}`), {
    enabled: !!enabled, startHour, endHour, timezone: myTz, updatedAt: Date.now()
  });
};

window.saveMyCallScheduleHours = async () => {
  if (role !== 'family' || !activeFamilyMember) return;
  const myTz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'Europe/London';
  const startHour = Number($('sched-start-hour')?.value ?? 8);
  const endHour = Number($('sched-end-hour')?.value ?? 21);
  await set(ref(db, `${basePath}/callSchedules/${activeFamilyMember.id}`), {
    enabled: true, startHour, endHour, timezone: myTz, updatedAt: Date.now()
  });
};

export function refreshCallScheduleUI() {
  if (role !== 'family' || !activeFamilyMember) return;
  const detectedTz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'Europe/London';
  const sched = state.callSchedulesSnap[activeFamilyMember.id] || { enabled: false, startHour: 8, endHour: 21, timezone: detectedTz };
  const tz = sched.timezone || detectedTz;
  if ($('call-hours-tz-badge')) $('call-hours-tz-badge').innerText = `🌍 ${tz.replace(/_/g, ' ')}`;
  if ($('sched-start-hour')) $('sched-start-hour').value = String(sched.startHour ?? 8);
  if ($('sched-end-hour')) $('sched-end-hour').value = String(sched.endHour ?? 21);
  $('btn-sched-anytime')?.classList.toggle('selected', !sched.enabled);
  $('btn-sched-custom')?.classList.toggle('selected', !!sched.enabled);
  if ($('call-hours-pickers')) $('call-hours-pickers').style.display = sched.enabled ? 'flex' : 'none';

  const stLbl = $('call-hours-status-lbl');
  if (stLbl) {
    if (!sched.enabled) {
      stLbl.innerText = "🌐 Nana can call you anytime (unless hidden above)";
      stLbl.style.color = "#4ade80";
    } else {
      const openNow = isMemberWithinAllowedCallHours(activeFamilyMember.id);
      const sStr = `${String(sched.startHour ?? 8).padStart(2, '0')}:00`;
      const eStr = `${String(sched.endHour ?? 21).padStart(2, '0')}:00`;
      stLbl.innerText = openNow
        ? `✅ Within your calling hours (${sStr}–${eStr} your time)`
        : `🌙 Outside your hours (${sStr}–${eStr}) — Hidden on Nana's tablet now`;
      stLbl.style.color = openNow ? "#4ade80" : "#fbbf24";
    }
  }
}

export function refreshHideUI() {
  if (role !== 'family' || !activeFamilyMember) return;
  const until = Number(state.hiddenSnap[activeFamilyMember.id] || 0), hidden = until > Date.now();
  const d = new Date(until), tStr = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const fmt = until >= HIDE_FOREVER
    ? 'until you turn it back on'
    : 'until ' + (d.toDateString() === new Date().toDateString() ? tStr : d.toLocaleDateString([], { weekday: 'short' }) + ' ' + tStr);
  document.querySelectorAll('.hide-status-lbl').forEach(e => {
    e.innerText = hidden ? `🙈 Hidden from Nana ${fmt}` : `👁️ Visible on Nana's tablet`;
    e.style.color = hidden ? '#fbbf24' : '#4ade80';
  });
  refreshCallScheduleUI();
}

onValue(refs.hiddenContacts, snap => {
  state.hiddenSnap = snap.val() || {};
  if (role === 'nana') hooks.renderContacts?.(state.connectedMemberIds);
  else refreshHideUI();
});

onValue(refs.callSchedules, snap => {
  state.callSchedulesSnap = snap.val() || {};
  if (role === 'nana') hooks.renderContacts?.(state.connectedMemberIds);
  else refreshCallScheduleUI();
});

setInterval(() => {
  if (role === 'nana') {
    hooks.renderContacts?.(state.connectedMemberIds);
    updateClock();
  } else {
    refreshHideUI();
  }
}, 30000);

if (role === 'nana') updateClock();
else refreshCallScheduleUI();
