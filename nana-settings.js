import {
  $, NanaCore, EXPECTED_PIN_HASH, sha256Hex,
  ref, set, update, onValue, remove
} from "./nana-core.js?v=2.9.5";

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

  window.toggleAllControlsSections = (expand) => {
    document.querySelectorAll('#family-settings-mount details.controls-accordion').forEach(d => {
      d.open = !!expand;
    });
  };

  sc.innerHTML = `
    <div class="controls-toolbar">
      <button type="button" class="opt-btn" style="flex:0;padding:6px 12px;font-size:0.82rem;" onclick="toggleAllControlsSections(true)">➕ Expand All</button>
      <button type="button" class="opt-btn" style="flex:0;padding:6px 12px;font-size:0.82rem;" onclick="toggleAllControlsSections(false)">➖ Collapse All</button>
    </div>

    <details class="controls-accordion" open>
      <summary><span>📞 Calling, Family &amp; Quick Actions</span><span class="controls-acc-meta calling-status-lbl"></span></summary>
      <div class="controls-acc-body">
        <div class="settings-card">
          <div class="settings-label"><span>📞 Video Calling on Nana's Tablet</span><span class="calling-status-lbl" style="font-size:0.95rem;"></span></div>
          <div class="opt-row" style="margin-bottom:6px;">
            <button class="opt-btn calling-off-btn" onclick="setCallingEnabled(false)">📵 Turn OFF (hide)</button>
            <button class="opt-btn calling-on-btn" onclick="setCallingEnabled(true)">✅ Turn ON</button>
          </div>
          <div class="opt-row">
            <button class="opt-btn" style="background:#dc2626;border-color:#fff;color:#fff;" onclick="clearAllMissedCalls()">🧹 Clear Missed Calls</button>
          </div>
        </div>
        ${isAdminFamilyMember ? `<div class="settings-card">
          <div class="settings-label"><span>👥 Family Members &amp; Call Grid</span></div>
          <div class="settings-sub" style="margin-bottom:6px;">Add new family members, edit names &amp; face-cropped photos, and copy personal links (top 8 recent Telegram-connected appear on Nana's grid).</div>
          <button class="opt-btn" style="width:100%;background:#0f766e;border-color:#5eead4;color:#fff;" onclick="closeSettingsModal(); openFamilyMembersModal();">👥 Add / Manage Family Members</button>
        </div>` : ''}
        <div class="settings-card">
          <div class="settings-label"><span>🔄 Refresh Nana's Tablet &amp; Prompt Family Devices</span></div>
          <div class="settings-sub" style="margin-bottom:6px;">Refresh Nana's tablet or prompt family members' browsers independently.</div>
          <div class="opt-row">
            <button class="opt-btn" id="remote-refresh-nana-btn" onclick="requestNanaReload()">🔄 Refresh Nana's Tablet</button>
            <button class="opt-btn" id="remote-refresh-family-btn" onclick="requestFamilyReload()">📱 Prompt Family Update</button>
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
          <div class="settings-label"><span>🔧 Telegram Bot Sync &amp; Webhook</span><span id="lbl-sync-status" style="font-size:0.9rem;color:#38bdf8;"></span></div>
          <button class="opt-btn" style="width:100%;background:#0284c7;border-color:#38bdf8;color:#fff;" onclick="forceWebhookAndMemberSync()">🔄 Flush Telegram Queue &amp; Sync Contacts Now</button>
        </div>
      </div>
    </details>

    <details class="controls-accordion">
      <summary><span>🔊 Volumes, Ringtone &amp; Auto-Answer</span><span class="controls-acc-meta lbl-vol-summary"></span></summary>
      <div class="controls-acc-body">
        <div class="settings-card">
          <div class="settings-label"><span>🔊 Tablet Volumes</span><span class="lbl-vol-summary" style="color:#38bdf8;font-size:0.92rem;"></span></div>
          <div class="settings-sub" style="margin-bottom:4px;">📹 Video Call Voice Volume (On Nana's Tablet Speaker):</div>
          <div class="opt-row" style="margin-bottom:8px;">${optBtns('callVolume', [[30,'30%'],[50,'50%'],[70,'70%'],[85,'85%'],[100,'100%']])}</div>
          <div class="settings-sub" style="margin-bottom:4px;">🎻 Classic FM Radio Volume:</div>
          <div class="opt-row" style="margin-bottom:8px;">${optBtns('radioVolume', [[25,'25%'],[45,'45%'],[60,'60%'],[75,'75%'],[90,'90%'],[100,'100%']])}</div>
          <div class="settings-sub" style="margin-bottom:4px;">🔔 Incoming Call Ringing Volume:</div>
          <div class="opt-row">${optBtns('ringVolume', [[30,'30%'],[50,'50%'],[70,'70%'],[85,'85%'],[100,'100%']])}</div>
        </div>
        <div class="settings-card">
          <div class="settings-label"><span>🎵 Nana's Ringtone, Auto-Answer &amp; Duration</span></div>
          <div class="opt-row" style="margin-bottom:8px;">
            ${[['uk-phone','☎️ Phone'],['westminster','🕰️ Chime'],['marimba','🎵 Marimba'],['bell','🔔 Bell'],['nana_song1.mp3','🎶 Song 1'],['nana_song2.mp3','🎶 Song 2']].map(([t,l]) => `<button class="opt-btn" data-skey="ringtone" data-sval="${t}" onclick="previewAndSetTone('${t}')">${l}</button>`).join('')}
          </div>
          <div class="opt-row" style="margin-bottom:8px;">
            ${optBtns('autoAnswer', [[false,'👆 Tap to Answer'],[true,'⚡ Auto-Answer (10s)']])}
            ${optBtns('voicePrompts', [[true,'🗣️ Voice ID On'],[false,'🔇 Voice ID Off']])}
          </div>
          <div class="opt-row">${optBtns('ringDurationSec', [[30,'30s'],[45,'45s'],[60,'60s'],[90,'90s'],[120,'2m']])}</div>
        </div>
      </div>
    </details>

    <details class="controls-accordion">
      <summary><span>🔆 Display, Themes &amp; Night Mode</span><span class="controls-acc-meta lbl-bright-summary">85% ➔ 15%</span></summary>
      <div class="controls-acc-body">
        <div class="settings-card">
          <div class="settings-label"><span>🎨 High-Contrast Visibility Theme</span></div>
          <div class="opt-row">${optBtns('colorTheme', [['classic-dark','🌙 Classic Dark'],['yellow-black','👁️ Yellow on Black'],['white-black','🤍 White on Black'],['black-cream','☀️ Black on Cream']])}</div>
        </div>
        <div class="settings-card">
          <div class="settings-label"><span>🔆 Screen Brightness &amp; Idle Dimming</span><span class="lbl-bright-summary" style="color:#38bdf8;font-size:0.95rem;">85% ➔ 15% (2m)</span></div>
          <div class="settings-sub" style="margin-bottom:4px;">Normal (Awake) Brightness:</div>
          <div class="opt-row" style="margin-bottom:8px;">${optBtns('awakeBrightness', [[40,'40%'],[60,'60%'],[85,'85%'],[100,'100%']])}</div>
          <div class="settings-sub" style="margin-bottom:4px;">Dimmed Brightness Level (Idle on Home, Chat &amp; Radio):</div>
          <div class="opt-row" style="margin-bottom:8px;">${optBtns('dimBrightness', [[5,'5% (Dark)'],[15,'15% (Soft)'],[30,'30% (Low)'],[50,'50% (Med)']])}</div>
          <div class="settings-sub" style="margin-bottom:4px;">Time Until Dimming Happens:</div>
          <div class="opt-row">${optBtns('dimDelaySec', [[30,'30s'],[60,'1m'],[120,'2m'],[300,'5m'],[600,'10m'],[0,'Never']])}</div>
        </div>
        <div class="settings-card">
          <div class="settings-label"><span>🖼️ Family Photo Frame Screensaver</span><span class="lbl-screensaver-summary" style="color:#38bdf8;font-size:0.9rem;">Plugged In Only</span></div>
          <div class="settings-sub" style="margin-bottom:6px;">Cycles recent Family Chat photos with burn-in protection. Only runs when plugged in and battery is not dropping.</div>
          <div class="opt-row" style="margin-bottom:6px;">${optBtns('photoScreensaverEnabled', [[true,'🖼️ Photo Frame ON'],[false,'🚫 Off (Normal Dim)']])}</div>
          <div class="settings-sub" style="margin-bottom:4px;">Start After Inactivity:</div>
          <div class="opt-row" style="margin-bottom:6px;">${optBtns('photoScreensaverDelaySec', [[60,'1m'],[120,'2m'],[180,'3m'],[300,'5m']])}</div>
          <div class="settings-sub" style="margin-bottom:4px;">Change Photo Every:</div>
          <div class="opt-row" style="margin-bottom:6px;">${optBtns('photoScreensaverIntervalSec', [[15,'15s'],[30,'30s'],[60,'1m'],[120,'2m']])}</div>
          <div class="settings-sub" style="margin-bottom:4px;">Screensaver Brightness (capped below full for burn-in safety):</div>
          <div class="opt-row" style="margin-bottom:6px;">${optBtns('photoScreensaverBrightness', [[25,'25%'],[35,'35%'],[40,'40%'],[55,'55%']])}</div>
          <div class="settings-sub" style="margin-bottom:4px;">Show Family Captions &amp; Recent Photo Pool:</div>
          <div class="opt-row" style="margin-bottom:6px;">${optBtns('photoScreensaverShowCaption', [[true,'💬 Show Captions'],[false,'🙈 Hide Captions']])}</div>
          <div class="opt-row">${optBtns('photoScreensaverMaxPhotos', [[10,'Last 10'],[20,'Last 20'],[30,'Last 30']])}</div>
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
      </div>
    </details>

    <details class="controls-accordion">
      <summary><span>🔋 Low Power &amp; Battery Alerts</span><span class="controls-acc-meta lbl-lowpower-summary">Auto</span></summary>
      <div class="controls-acc-body">
        <div class="settings-card">
          <div class="settings-label"><span>⚡ Nana's Low Power Mode Controls</span><span class="lbl-lowpower-summary" style="color:#38bdf8;font-size:0.9rem;">Auto</span></div>
          <div class="settings-sub" style="margin-bottom:6px;">Lowers brightness, dims sooner, reduces background updates, and skips Radio/Video prompts (Unread Family Chat prompts stay active).</div>
          <div class="settings-sub" style="margin-bottom:4px;">Activation Mode:</div>
          <div class="opt-row" style="margin-bottom:8px;">${optBtns('lowPowerModeSetting', [['auto','🔋 Auto (Unplugged)'],['on','⚡ Force ON'],['off','🔌 Off']])}</div>
          <div class="settings-sub" style="margin-bottom:4px;">Video Playback in Low Power Mode:</div>
          <div class="opt-row" style="margin-bottom:8px;">${optBtns('lowPowerBlockVideo', [[true,'🚫 Block Videos'],[false,'🎬 Allow Videos']])}</div>
          <div class="settings-sub" style="margin-bottom:4px;">Max Awake Brightness in Low Power Mode:</div>
          <div class="opt-row" style="margin-bottom:8px;">${optBtns('lowPowerMaxBrightness', [[30,'30%'],[40,'40%'],[50,'50%'],[70,'70%']])}</div>
          <div class="settings-sub" style="margin-bottom:4px;">Dim Screen After Inactivity in Low Power Mode:</div>
          <div class="opt-row">${optBtns('lowPowerDimDelaySec', [[20,'20s'],[30,'30s'],[45,'45s'],[60,'1m']])}</div>
        </div>
        <div class="settings-card">
          <div class="settings-label"><span>🔋 Battery Unplugged Banner &amp; Voice Alerts</span><span class="lbl-battery-summary" style="color:#38bdf8;font-size:0.92rem;"></span></div>
          <div class="settings-sub lbl-battery-mute">Top banner always shows when unplugged. Voice alerts stay silent during Night Mode.</div>
          <div class="settings-sub" style="margin-bottom:4px;">🗣️ Speak Voice Alert When Unplugged At or Below:</div>
          <div class="opt-row" style="margin-bottom:8px;">${optBtns('batteryVoiceThresholdPct', [[0,'Off'],[15,'15%'],[25,'25%'],[30,'30%'],[50,'50%'],[80,'80%'],[99,'Whenever Unplugged']])}</div>
          <div class="settings-sub" style="margin-bottom:4px;">⏱️ Voice Alert Frequency (Dynamic speeds up as battery drops: &gt;50%=20m, 31-50%=10m, 16-30%=5m, ≤15%=2m):</div>
          <div class="opt-row" style="margin-bottom:8px;">${optBtns('batteryVoiceIntervalMin', [[0,'⚡ Dynamic'],[3,'3m'],[5,'5m'],[10,'10m'],[15,'15m'],[30,'30m']])}</div>
          <div class="settings-sub" style="margin-bottom:4px;">🔊 Unplugged Voice Alert Volume:</div>
          <div class="opt-row" style="margin-bottom:8px;">${optBtns('batteryVoiceVolume', [[30,'30%'],[50,'50%'],[70,'70%'],[85,'85%'],[100,'100%']])}</div>
          <div class="settings-sub" style="margin-bottom:4px;">💬 Post Battery-Out &amp; Back-Online Messages to Family Chat:</div>
          <div class="opt-row" style="margin-bottom:8px;">${optBtns('batteryChatAlertsEnabled', [[true,'🔋 Chat Alerts ON'],[false,'🔕 Off']])}</div>
          <div class="opt-row" style="margin-bottom:8px;">
            <button class="opt-btn" onclick="muteBatteryVoiceForHours(0)">🔊 Unmute Battery Voice</button>
          </div>
          <div class="opt-row">
            ${[1,4,12,24].map(h => `<button class="opt-btn" onclick="muteBatteryVoiceForHours(${h})">🔇 Mute ${h}h</button>`).join('')}
          </div>
        </div>
      </div>
    </details>

    <details class="controls-accordion">
      <summary><span>💬 Family Chat, Voice &amp; Keyboard</span><span class="controls-acc-meta lbl-kb-summary">QWERTY • 1m</span></summary>
      <div class="controls-acc-body">
        <div class="settings-card">
          <div class="settings-label"><span>💬 Family Notes Alert Bar, Voice &amp; Read Aloud</span></div>
          <div class="opt-row" style="margin-bottom:6px;">
            ${optBtns('showBulletinBar', [[true,'💬 Show Alert Bar'],[false,'🙈 Hide Alert Bar']])}
            <button class="opt-btn" style="background:#0284c7;border-color:#fff;color:#fff;" onclick="dismissCurrentBulletinBar(true)">🧹 Mark All Read</button>
          </div>
          <div class="opt-row" style="margin-bottom:6px;">${optBtns('showReadAloud', [[false,'🙈 Hide "Read Aloud"'],[true,'🔊 Show "Read Aloud"']])}</div>
          <div class="settings-sub" style="margin-bottom:4px;">🎙️ Voice Messaging (Listen to Telegram voice notes &amp; let Nana speak replies):</div>
          <div class="opt-row" style="margin-bottom:6px;">${optBtns('voiceMessagingEnabled', [[true,'🎙️ Voice Messaging ON'],[false,'🚫 Off (Text Only)']])}</div>
          <div class="settings-sub" style="margin-bottom:4px;">💬 Tapping Message Box on Nana's Tablet Opens:</div>
          <div class="opt-row" style="margin-bottom:6px;">${optBtns('nanaMessageEntryMode', [['choice','💬 Choice Screen'],['keyboard','⌨️ Keyboard'],['voice','🎙️ Voice Message']])}</div>
          <div class="settings-sub" style="margin-bottom:4px;">⏱️ Voice Recording Base Time:</div>
          <div class="opt-row" style="margin-bottom:6px;">${optBtns('voiceMessageMaxSec', [[15,'15s'],[20,'20s'],[30,'30s'],[45,'45s'],[60,'60s']])}</div>
          <div class="settings-sub" style="margin-bottom:4px;">➕ Auto-Extend While Nana Is Still Talking (+15s automatically):</div>
          <div class="opt-row" style="margin-bottom:6px;">${optBtns('voiceAutoExtendEnabled', [[true,'✅ Auto-Extend ON'],[false,'🚫 Off (Hard Stop at Base)']])}</div>
          <div class="settings-sub" style="margin-bottom:4px;">🛑 Hard Safety Limit (maximum recording length when Auto-Extend is ON):</div>
          <div class="opt-row" style="margin-bottom:6px;">${optBtns('voiceHardCapSec', [[60,'1m'],[90,'1m 30s'],[120,'2m'],[180,'3m']])}</div>
          <div class="settings-sub" style="margin-bottom:4px;">🤫 Auto-Send Once Nana Stops Talking (silence timeout):</div>
          <div class="opt-row" style="margin-bottom:6px;">${optBtns('voiceAutoSendSilenceSec', [[0,'Off (Tap Done)'],[3,'3s'],[5,'5s'],[8,'8s']])}</div>
          <div class="settings-sub" style="margin-bottom:4px;">🔇 Auto-Cancel If No Voice Heard (prevents silent messages):</div>
          <div class="opt-row" style="margin-bottom:6px;">${optBtns('voiceNoSpeechCancelSec', [[0,'Off'],[10,'10s'],[15,'15s'],[20,'20s']])}</div>
          <div class="settings-sub" style="margin-bottom:4px;">🛡️ Mic Noise Suppression &amp; Echo Cancel (turn Off if Nana's voice sounds clipped):</div>
          <div class="opt-row" style="margin-bottom:6px;">${optBtns('voiceNoiseSuppression', [[true,'🛡️ ON (Reduces TV/Radio)'],[false,'🎤 Off (Raw Mic)']])}</div>
          <div class="settings-sub" style="margin-bottom:4px;">📺 TV / Radio Background Guard (voice detector sensitivity &amp; anti-runaway):</div>
          <div class="opt-row">${optBtns('voiceTvGuardMode', [['off','🔓 Off (Simple)'],['normal','📺 Normal'],['strict','🛡️ Strict (Loud TV)']])}</div>
        </div>
        <div class="settings-card">
          <div class="settings-label"><span>⌨️ Nana's Keyboard Layout &amp; Auto-Hide</span><span class="lbl-kb-summary" style="color:#38bdf8;font-size:0.95rem;">QWERTY • 1m</span></div>
          <div class="opt-row" style="margin-bottom:8px;">${optBtns('keyboardLayout', [['qwerty','⌨️ QWERTY Layout'],['abcdef','🔤 ABCDEF Layout']])}</div>
          <div class="settings-sub" style="margin-bottom:4px;">Hide Keyboard After Inactivity:</div>
          <div class="opt-row">${optBtns('keyboardTimeoutSec', [[30,'30s'],[60,'1m'],[120,'2m'],[180,'3m']])}</div>
          <div class="settings-sub" style="margin:8px 0 4px 0;">🖐️ Same-Key Repeat Guard (ignores accidental double-taps on the same letter):</div>
          <div class="opt-row">${optBtns('keyGuardMs', [[0,'Off'],[350,'Normal'],[600,'Strong'],[900,'Max']])}</div>
        </div>
      </div>
    </details>

    <details class="controls-accordion">
      <summary><span>💚 Today's Calls &amp; Scheduled Prompts</span><span class="controls-acc-meta" id="lbl-periodic-summary">Active</span></summary>
      <div class="controls-acc-body">
        <div class="settings-card">
          <div class="settings-label"><span>💚 Today's Calls Memory Banner &amp; Scheduled Prompts</span></div>
          <div class="settings-sub">Reassures Nana with a summary of who she has spoken to today, and offers scheduled entertainment prompts (in Low Power Mode, Radio &amp; Video prompts stay off while Unread Chat reminders remain active).</div>
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
          <div class="settings-sub" style="margin-bottom:4px;">🗣️ Pop-Up Question &amp; Prompt Voice:</div>
          <div class="opt-row">${optBtns('speakQuestions', [[true,'🔊 Read Prompts Aloud'],[false,'🔇 Silent Pop-Ups Only']], 'setGlobalQuestionSpeak')}</div>
        </div>
      </div>
    </details>
  `;
})();

// --- 2. BRIGHTNESS, NIGHT MODE & CLOCK ---
let lastAppliedBrightnessPct = null;
let lastAppliedInCallState = null;
let lastAppliedDimDelaySec = null;
let isScreenDimmed = false;

function getEffectiveDimDelaySec() {
  const raw = Number(settings.dimDelaySec ?? 120);
  if (NanaCore.isLowPowerMode?.()) {
    const lpCap = Number(settings.lowPowerDimDelaySec ?? 45);
    return raw > 0 ? Math.min(raw, lpCap) : lpCap;
  }
  return raw;
}

export function applyScreenBrightness(targetPercent, dimmed = false) {
  if (role !== 'nana') return;
  const inCallOrRinging = !!(state.currentState && state.currentState !== 'idle');
  const isLP = !!NanaCore.isLowPowerMode?.();
  isScreenDimmed = !inCallOrRinging && !!dimmed;

  let effectiveTarget = Number(targetPercent);
  if (!Number.isFinite(effectiveTarget)) effectiveTarget = dimmed ? 15 : 85;
  if (!inCallOrRinging && isLP) {
    const lpMaxAwake = Math.max(20, Math.min(100, Number(settings.lowPowerMaxBrightness ?? 50)));
    effectiveTarget = dimmed ? Math.min(effectiveTarget, 5) : Math.min(effectiveTarget, lpMaxAwake);
  }
  const pct = inCallOrRinging ? 100 : Math.max(5, Math.min(100, effectiveTarget));

  document.body.classList.toggle('screen-dimmed', isScreenDimmed);
  const overlay = $('brightness-overlay');
  if (overlay) {
    overlay.style.opacity = inCallOrRinging ? '0' : Math.max(0, Math.min(0.90, (100 - pct) / 105)).toFixed(2);
    overlay.style.pointerEvents = isScreenDimmed ? 'auto' : 'none';
  }

  const effectiveDelay = getEffectiveDimDelaySec();
  if (pct !== lastAppliedBrightnessPct || inCallOrRinging !== lastAppliedInCallState || effectiveDelay !== lastAppliedDimDelaySec) {
    lastAppliedBrightnessPct = pct;
    lastAppliedInCallState = inCallOrRinging;
    lastAppliedDimDelaySec = effectiveDelay;
    // MainActivity.AndroidBridge.updateTabletHardwareSettings(volumePct, brightnessPct, dimDelaySec, speechRate)
    window.AndroidBridge?.updateTabletHardwareSettings?.(
      100,
      pct,
      effectiveDelay,
      Number(settings.speechRate ?? 0.9)
    );
  }
}
NanaCore.applyScreenBrightness = applyScreenBrightness;

window.wakeScreenAndResetDimTimer = function () {
  if (role !== 'nana') return;
  hooks.stopPhotoScreensaver?.('wake');
  if (state.currentState === 'ringing_nana' || (state.currentState && state.currentState !== 'idle')) {
    applyScreenBrightness(100, false);
    clearTimeout(idleDimTimer);
    return;
  }
  applyScreenBrightness(settings.awakeBrightness ?? 85, false);
  clearTimeout(idleDimTimer);
  const usePhotoDelay = settings.photoScreensaverEnabled !== false && state.isCharging === true && !NanaCore.isLowPowerMode?.();
  const delaySec = usePhotoDelay
    ? Math.max(30, Number(settings.photoScreensaverDelaySec ?? 120) || 120)
    : getEffectiveDimDelaySec();
  const anyVideoPlaying = () => !!(NanaCore.isNanaVideoActivelyPlaying?.() || NanaCore.isChatVideoActivelyPlaying?.());
  if (delaySec > 0 && state.currentState === 'idle' && !anyVideoPlaying()) {
    idleDimTimer = setTimeout(() => {
      if (state.currentState === 'idle' && !anyVideoPlaying()) {
        window.closeSeniorKeyboard?.(true);
        if (hooks.tryStartPhotoScreensaver?.()) return;
        const dimTarget = NanaCore.isLowPowerMode?.() ? 5 : (settings.dimBrightness ?? 15);
        applyScreenBrightness(dimTarget, true);
      }
    }, delaySec * 1000);
  }
};

hooks.onPowerModeChanged.push(() => {
  if (role === 'nana') {
    window.wakeScreenAndResetDimTimer?.();
  }
});

export function isCurrentlyInNightWindow() {
  if (!settings.nightModeEnabled) return false;
  const h = new Date().getHours();
  const s = Number(settings.nightStartHour ?? 21), e = Number(settings.nightEndHour ?? 8);
  return s > e ? (h >= s || h < e) : (h >= s && h < e);
}
NanaCore.isCurrentlyInNightWindow = isCurrentlyInNightWindow;

let lastClockText = '';
let lastNightDimDisplay = '';
export function updateClock() {
  const t = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  if (t !== lastClockText) {
    lastClockText = t;
    if ($('night-clock')) $('night-clock').innerText = t;
  }
  if ($('night-dimmer')) {
    const anyVideoPlaying = !!(NanaCore.isNanaVideoActivelyPlaying?.() || NanaCore.isChatVideoActivelyPlaying?.());
    const showNight = isCurrentlyInNightWindow() && state.currentState === 'idle' && !anyVideoPlaying && Date.now() > nightDismissedUntilMs;
    if (showNight) hooks.stopPhotoScreensaver?.('night_mode');
    const disp = showNight ? 'flex' : 'none';
    if (disp !== lastNightDimDisplay) {
      lastNightDimDisplay = disp;
      $('night-dimmer').style.display = disp;
    }
  }
}

window.wakeFromNightMode = () => {
  nightDismissedUntilMs = Date.now() + 15 * 60 * 1000;
  lastNightDimDisplay = 'none';
  if ($('night-dimmer')) $('night-dimmer').style.display = 'none';
  if (state.currentState === 'ringing_nana') {
    applyScreenBrightness(100, false);
    return;
  }
  window.wakeScreenAndResetDimTimer();
};

// --- 3. BATTERY VOICE WARNINGS & MUTE (DYNAMIC OR FIXED INTERVAL, QUIET HOURS RESPECTED, NO SCREEN WAKE) ---
function getDynamicBatteryAlertPlan(levelPct) {
  const lvl = (typeof levelPct === 'number' && !Number.isNaN(levelPct)) ? Math.round(levelPct) : 30;
  const baseVol = Math.min(100, Math.max(25, Number(settings.batteryVoiceVolume) || 85));
  const fixedMin = Number(settings.batteryVoiceIntervalMin ?? 0);

  let dynamicMin = 20;
  if (lvl <= 15) dynamicMin = 2;
  else if (lvl <= 30) dynamicMin = 5;
  else if (lvl <= 50) dynamicMin = 10;

  const intervalMin = fixedMin > 0 ? fixedMin : dynamicMin;
  const volumePct = lvl <= 15 ? 100 : (lvl <= 30 ? Math.max(baseVol, 85) : baseVol);
  const message = lvl <= 30
    ? `Please plug in the tablet charger. The battery is at ${lvl} percent.`
    : `Please plug in the tablet charger when you can. The battery is at ${lvl} percent.`;

  return { intervalMin, volumePct, message };
}

window.muteBatteryVoiceForHours = async (hours) => {
  const mutedUntil = hours > 0 ? (Date.now() + hours * 3600 * 1000) : 0;
  settings.batteryVoiceMutedUntil = mutedUntil;
  window.speechSynthesis?.cancel();
  window.AndroidBridge?.muteBatteryVoiceForMinutes?.(hours * 60);
  refreshSettingsUI();
  hooks.syncBatteryUI?.();
  await update(refs.settings, { batteryVoiceMutedUntil: mutedUntil });
};

window.announceBatteryWarning = (levelOrText) => {
  if (state.currentState && state.currentState !== 'idle') return;
  if (isBatteryVoiceCurrentlyMuted() || isCurrentlyInNightWindow()) return;

  const isNumericLevel = typeof levelOrText === 'number' && !Number.isNaN(levelOrText);
  const plan = getDynamicBatteryAlertPlan(isNumericLevel ? levelOrText : 30);
  const intervalMs = plan.intervalMin * 60000;

  if (Date.now() - lastBatterySpokenMs < intervalMs) return;
  lastBatterySpokenMs = Date.now();

  const spokenText = isNumericLevel ? plan.message : String(levelOrText || plan.message);
  const volNorm = plan.volumePct / 100;

  // Do NOT wake the screen here so battery is preserved while dimmed/asleep
  try { window.speechSynthesis?.cancel(); } catch (_) {}
  speakMsg(spokenText, true, volNorm);
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

let adminPinCountdownTimer = null;
let adminPinSecondsLeft = 5;

function clearAdminPinTimer() {
  clearInterval(adminPinCountdownTimer);
  adminPinCountdownTimer = null;
}

window.openAdminPinModal = () => {
  clearAdminPinTimer();
  enteredPin = "";
  adminPinSecondsLeft = 5;
  if ($('pin-dots-display')) $('pin-dots-display').innerText = "";
  if ($('admin-modal-title')) $('admin-modal-title').innerText = `⚙️ Supervisor & Controls (v${CONFIG.appVersion})`;
  if ($('admin-modal-sub')) $('admin-modal-sub').innerText = `Enter 4-digit Supervisor PIN — closes in ${adminPinSecondsLeft}s`;
  if ($('pin-keypad-section')) $('pin-keypad-section').style.display = 'flex';
  if ($('admin-actions-section')) $('admin-actions-section').style.display = 'none';
  $('admin-pin-modal').style.display = 'flex';

  adminPinCountdownTimer = setInterval(() => {
    adminPinSecondsLeft -= 1;
    if (adminPinSecondsLeft <= 0) {
      window.closeAdminPinModal();
      return;
    }
    if ($('admin-modal-sub')) {
      $('admin-modal-sub').innerText = `Enter 4-digit Supervisor PIN — closes in ${adminPinSecondsLeft}s`;
    }
  }, 1000);
};
window.closeAdminPinModal = () => {
  clearAdminPinTimer();
  enteredPin = "";
  $('admin-pin-modal').style.display = 'none';
};
window.clearPinDigits = () => { enteredPin = ""; if ($('pin-dots-display')) $('pin-dots-display').innerText = ""; };

window.pressPinDigit = async (d) => {
  if (enteredPin.length >= 4) return;
  enteredPin += d;
  if ($('pin-dots-display')) $('pin-dots-display').innerText = "●".repeat(enteredPin.length);
  if (enteredPin.length === 4) {
    const candidateHash = await sha256Hex("nana-pin-salt:" + enteredPin);
    if (candidateHash === EXPECTED_PIN_HASH) {
      clearAdminPinTimer();
      window.AndroidBridge?.unlockAdminForFiveMinutes?.();
      const cards = $('shared-settings-cards'), mount = $('gear-settings-mount');
      if (cards && mount && cards.parentElement !== mount) mount.appendChild(cards);
      if ($('admin-modal-title')) $('admin-modal-title').innerText = `🔓 Unlocked (v${CONFIG.appVersion})`;
      if ($('admin-modal-sub')) $('admin-modal-sub').innerText = 'Supervisor controls unlocked';
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

window.requestNanaReload = async () => {
  const b = $('remote-refresh-nana-btn');
  try {
    await set(refs.callState, { status: 'idle', timestamp: Date.now() });
    await set(refs.reloadNanaCmd, Date.now());
    if (b) { b.innerText = '✅ Refreshed Nana!'; setTimeout(() => { b.innerText = "🔄 Refresh Nana's Tablet"; }, 3000); }
  } catch (_) {}
};

window.requestFamilyReload = async () => {
  const b = $('remote-refresh-family-btn');
  try {
    await set(refs.reloadFamilyCmd, Date.now());
    if (b) { b.innerText = '✅ Prompted Family!'; setTimeout(() => { b.innerText = '📱 Prompt Family Update'; }, 3000); }
  } catch (_) {}
};

window.requestTabletReload = window.requestNanaReload;

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
    const busyOtherCall = !!(state.callSnap?.status && state.callSnap.status !== 'idle');
    ringBtn.disabled = !callingOn || busyOtherCall;
  }

  const theme = settings.colorTheme || 'classic-dark';
  document.body.classList.remove('theme-yellow-black', 'theme-white-black', 'theme-black-cream');
  if (theme !== 'classic-dark') document.body.classList.add(`theme-${theme}`);

  const callVol = Number(settings.callVolume ?? 85), radVol = Number(settings.radioVolume ?? 75), ringVol = Number(settings.ringVolume ?? 85);
  const awakeB = Number(settings.awakeBrightness ?? 85), dimB = Number(settings.dimBrightness ?? 15), dimSec = Number(settings.dimDelaySec ?? 120);
  const nStart = Number(settings.nightStartHour ?? 21), nEnd = Number(settings.nightEndHour ?? 8);
  const kbLayout = settings.keyboardLayout || 'qwerty', kbHideSec = Number(settings.keyboardTimeoutSec ?? 60);
  const battVol = Number(settings.batteryVoiceVolume ?? 85);
  const battThresh = Number(settings.batteryVoiceThresholdPct ?? 30);
  const battInterval = Number(settings.batteryVoiceIntervalMin ?? 0);
  const battThreshLabel = battThresh >= 99 ? 'Always' : `≤${battThresh}%`;
  const battFreqLabel = battInterval > 0 ? `Every ${battInterval}m` : '⚡ Dynamic';

  if ($('in-call-vol-label')) $('in-call-vol-label').innerText = `${callVol}%`;
  if ($('nana-vol-display')) $('nana-vol-display').innerText = `${radVol}%`;

  document.querySelectorAll('.lbl-bright-summary').forEach(e => { e.innerText = `${awakeB}% ➔ ${dimB}% (${fmtDelay(dimSec)})`; });
  const ssOn = settings.photoScreensaverEnabled !== false;
  const ssDelay = Number(settings.photoScreensaverDelaySec ?? 120);
  const ssInt = Number(settings.photoScreensaverIntervalSec ?? 30);
  const ssBright = Math.max(15, Math.min(55, Number(settings.photoScreensaverBrightness ?? 40)));
  document.querySelectorAll('.lbl-screensaver-summary').forEach(e => {
    e.innerText = ssOn ? `ON • ${fmtDelay(ssDelay)} / ${fmtDelay(ssInt)} • ${ssBright}%` : 'Off';
    e.style.color = ssOn ? '#4ade80' : '#94a3b8';
  });
  document.querySelectorAll('.lbl-kb-summary').forEach(e => { e.innerText = `${kbLayout.toUpperCase()} • ${fmtDelay(kbHideSec)}`; });
  document.querySelectorAll('.lbl-vol-summary').forEach(e => {
    e.innerText = `Call ${callVol}% • Radio ${radVol}% • Ring ${ringVol}%`;
  });
  const lpMode = settings.lowPowerModeSetting || 'auto';
  const lpModeTxt = lpMode === 'on' ? 'Forced ON' : (lpMode === 'off' ? 'Off' : 'Auto');
  const lpVidTxt = settings.lowPowerBlockVideo !== false ? 'Videos Blocked' : 'Videos Allowed';
  const lpActiveNow = role === 'nana'
    ? !!NanaCore.isLowPowerMode?.()
    : (lpMode === 'on' || (lpMode === 'auto' && (state.presenceSnap?.lowPowerMode || state.presenceSnap?.isCharging === false)));
  document.querySelectorAll('.lbl-lowpower-summary').forEach(e => {
    e.innerText = `${lpModeTxt}${lpActiveNow ? ' (Active now)' : ''} • ${lpVidTxt}`;
    e.style.color = lpActiveNow ? '#fbbf24' : '#38bdf8';
  });
  document.querySelectorAll('.lbl-battery-summary').forEach(e => {
    e.innerText = battThresh <= 0 ? 'Off' : `${battThreshLabel} • ${battFreqLabel} • Vol ${battVol}%`;
  });
  document.querySelectorAll('.lbl-night-window').forEach(e => {
    e.innerText = settings.nightModeEnabled ? `${String(nStart).padStart(2,'0')}:00 – ${String(nEnd).padStart(2,'0')}:00` : "Disabled";
  });

  const mutedUntil = Number(settings.batteryVoiceMutedUntil) || 0;
  const muteTxt = mutedUntil > Date.now()
    ? `🔇 Muted until ${new Date(mutedUntil).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
    : (battThresh <= 0 ? '🔕 Unplugged voice alerts switched OFF' : `🔊 Alerts ${battThresh >= 99 ? 'whenever unplugged' : `when unplugged at ≤${battThresh}%`} (${battFreqLabel})`);
  document.querySelectorAll('.lbl-battery-mute').forEach(e => { e.innerText = muteTxt; });

  const sCall = Math.min(1.0, Math.max(0.2, callVol / 100)), sRad = Math.min(1.0, Math.max(0.15, radVol / 100));
  if ($('remote-audio')) $('remote-audio').volume = role === 'nana' ? sCall : 1.0;
  if ($('remote-video') && role === 'nana') $('remote-video').volume = 0;
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

  hooks.syncBatteryUI?.();
  hooks.renderTodaysCallsBanner?.();
  hooks.onSettingsChanged.forEach(fn => fn(settings));
}

onValue(refs.settings, snap => {
  const remote = snap.val();
  if (remote) {
    Object.assign(settings, remote);
    // Migrate legacy 100% battery threshold to 30% while preserving 99% ("Whenever Unplugged")
    if (Number(remote.batteryVoiceThresholdPct) >= 100) {
      settings.batteryVoiceThresholdPct = 30;
    }
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
  } else {
    refreshHideUI();
  }
}, 30000);

if (role === 'nana') updateClock();
else refreshCallScheduleUI();
