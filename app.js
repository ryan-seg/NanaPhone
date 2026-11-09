import {
  $, NanaCore, ref, set, update, push, onValue, remove, runTransaction
} from "./nana-core.js?v=2.9.4";
import { updateClock, isCurrentlyInNightWindow, isHiddenFromNana } from "./nana-settings.js?v=2.9.4";

const {
  CONFIG, SERVICE_TOKEN, TEST_MODE, PORTAL_NODE_ID,
  role, autoAnswerFromTelegram, isRealAndroidTablet,
  activeFamilyMember, isAdminFamilyMember, FAMILY_NAMES,
  basePath, db, refs, settings, state, hooks, audioCtx,
  showScreen, speakMsg
} = NanaCore;

// Unique per-tab ID so only the exact tab that pressed Call/Answer joins the video room
const CLIENT_TAB_ID = `tab_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

let callObject = null;
let isJoiningOrInRoom = false;
let didManuallyInitiateOrAnswerOnThisTab = false;
let currentFacingMode = 'user';
let appliedNanaCameraMode = null;
let appliedNanaMicDeviceId = null;
let failedNanaCameraMode = null;
let pendingCallContact = null;
let confirmTimer = null;
let ringInterval = null;
let telegramBurstInterval = null;
let lastTelegramMsgId = null;
let currentDialedMember = null;
let outboundTimeout = null;
let incomingRingTimeout = null;
let autoAnswerTimeout = null;
let activeMp3Ringtone = null;
let activeCallConnectedAtMs = null;
let activeCallPartnerId = null;
let hadRemoteMediaInCurrentCall = false;
let endCallConfirmedByUser = false;
let endCallModalTimer = null;
let jitterHoldTimer = null;

// Web Audio DSP Nodes (Outbound Nana Mic & Inbound Family Voice Boost)
let nanaRawMicStream = null;
let nanaMicNodes = null;
let familyBoostNodes = null;
let attachedRemoteAudioTrack = null;

const radioPlayer = $('nana-radio-stream');

// --- 1. DISPLAY ADAPTERS, DEVICE ENUMERATION & AUDIO UNLOCK ---
async function publishNanaHardwareDevices() {
  if (role !== 'nana' || !navigator.mediaDevices?.enumerateDevices || !refs.nanaDevices) return;
  try {
    const list = await navigator.mediaDevices.enumerateDevices();
    const cameras = list
      .filter(d => d.kind === 'videoinput' && d.deviceId)
      .map((d, i) => ({ deviceId: d.deviceId, label: (d.label || `Camera ${i + 1}`).slice(0, 38) }));
    const mics = list
      .filter(d => d.kind === 'audioinput' && d.deviceId)
      .map((d, i) => ({ deviceId: d.deviceId, label: (d.label || `Mic ${i + 1}`).slice(0, 38) }));
    await set(refs.nanaDevices, { cameras, mics, updatedAt: Date.now() });
  } catch (_) {}
}

if (role === 'nana' && navigator.mediaDevices) {
  setTimeout(publishNanaHardwareDevices, 2500);
  navigator.mediaDevices.addEventListener?.('devicechange', publishNanaHardwareDevices);
}

// Modest 640x480 @ 20-24fps resolution on Nana's tablet while honoring selected camera
function getNanaVideoConstraintObject(camSetting = settings.nanaCameraMode) {
  const mode = camSetting || 'user';
  const baseRes = {
    width: { ideal: 640, max: 640 },
    height: { ideal: 480, max: 480 },
    frameRate: { ideal: 20, max: 24 }
  };
  if (mode === 'user' || mode === 'environment') {
    return { ...baseRes, facingMode: mode };
  }
  return { ...baseRes, deviceId: { ideal: mode } };
}

// Synchronous Audio Pre-Unlock (Run during physical Answer/Call tap AFTER any confirm() dialog)
function unlockCallAudioImmediate() {
  try {
    if (audioCtx?.state === 'suspended') audioCtx.resume().catch(() => {});
    const ra = $('remote-audio');
    const rv = $('remote-video');
    if (ra) {
      ra.muted = false;
      ra.loop = true; // Keep element actively playing silent audio until WebRTC stream swaps in
      ra.volume = role === 'nana' ? Math.min(1.0, Math.max(0.2, (Number(settings.callVolume) || 85) / 100)) : 1.0;
      if (!ra.srcObject) {
        ra.src = CONFIG.silentWav;
        ra.play().catch(() => {});
      }
    }
    if (rv) {
      // Permanently keep #remote-video muted so mobile/desktop browsers never block video autoplay
      rv.muted = true;
      rv.play().catch(() => {});
    }
  } catch (_) {}
}

(function initVideoCallStageAdapters() {
  let inCallTouchWakeTimer = null;

  window.wakeInCallControls = (ev) => {
    window.resetIdleTimer?.();
    const cs = $('call-screen');
    if (!cs) return;

    // Make translucent End Call button & status pill opaque for 5 seconds
    cs.classList.add('touch-awake');

    // Close the top-right cog drawer if tapping outside the menu
    if (!ev || !ev.target?.closest?.('#in-call-menu-wrap')) {
      $('in-call-menu-wrap')?.classList.remove('menu-open');
    }

    clearTimeout(inCallTouchWakeTimer);
    inCallTouchWakeTimer = setTimeout(() => {
      cs.classList.remove('touch-awake');
    }, 5000);
  };

  window.toggleInCallMenu = (ev) => {
    if (ev) ev.stopPropagation();
    const wrap = $('in-call-menu-wrap');
    if (!wrap) return;
    const isOpen = wrap.classList.toggle('menu-open');
    if (isOpen) {
      $('call-screen')?.classList.add('touch-awake');
      clearTimeout(inCallTouchWakeTimer);
      inCallTouchWakeTimer = setTimeout(() => {
        $('call-screen')?.classList.remove('touch-awake');
      }, 5000);
    }
  };

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

  const cs = $('call-screen');
  if (cs) {
    ['pointerdown', 'touchstart'].forEach(evtName => {
      cs.addEventListener(evtName, (ev) => {
        window.wakeInCallControls(ev);
        if (audioCtx?.state === 'suspended') audioCtx.resume().catch(() => {});
        const ra = $('remote-audio');
        if (ra?.srcObject) {
          ra.muted = role === 'family' ? familyAmpIsExclusive() : false;
          ra.play().catch(() => {});
        }
        if (rv?.srcObject && rv.paused) {
          rv.muted = true;
          rv.play().catch(() => {});
        }
      }, { passive: true });
    });
  }
})();

// --- 2. OUTBOUND NANA MIC DSP PIPELINE & INBOUND FAMILY VOICE AMPLIFIER ---
function applyNanaMicDspParameters() {
  if (!nanaMicNodes) return;
  const mode = settings.nanaMicDspMode || 'vocal-boost';
  const now = audioCtx.currentTime;
  const isRaw = mode === 'raw';

  nanaMicNodes.hp.frequency.setTargetAtTime(isRaw ? 20 : 130, now, 0.03);
  nanaMicNodes.lp.frequency.setTargetAtTime(isRaw ? 18000 : 4200, now, 0.03);
  nanaMicNodes.presence.gain.setTargetAtTime(isRaw ? 0 : (mode === 'max-boost' ? 6.0 : 4.5), now, 0.03);
  nanaMicNodes.comp.threshold.setTargetAtTime(isRaw ? -6 : -34, now, 0.03);
  nanaMicNodes.comp.ratio.setTargetAtTime(isRaw ? 1.5 : 5, now, 0.03);

  const targetGain = isRaw ? 1.0 : (mode === 'max-boost' ? 2.5 : 1.8);
  nanaMicNodes.makeupGain.gain.setTargetAtTime(targetGain, now, 0.03);
}

async function buildNanaProcessedMicTrack(preferredMicId = settings.nanaMicDeviceId) {
  cleanupNanaMicDsp();
  try {
    if (audioCtx.state === 'suspended') await audioCtx.resume();
    const audioConstraints = {
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
      channelCount: 1
    };
    if (preferredMicId && preferredMicId !== 'default') {
      audioConstraints.deviceId = { ideal: preferredMicId };
    }

    nanaRawMicStream = await navigator.mediaDevices.getUserMedia({
      audio: audioConstraints,
      video: false
    });
    appliedNanaMicDeviceId = preferredMicId || 'default';

    const source = audioCtx.createMediaStreamSource(nanaRawMicStream);

    const hp = audioCtx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 130;
    hp.Q.value = 0.7;

    const lp = audioCtx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 4200;
    lp.Q.value = 0.7;

    const presence = audioCtx.createBiquadFilter();
    presence.type = 'peaking';
    presence.frequency.value = 2200;
    presence.Q.value = 1.1;
    presence.gain.value = 4.5;

    const comp = audioCtx.createDynamicsCompressor();
    comp.threshold.value = -34;
    comp.knee.value = 18;
    comp.ratio.value = 5;
    comp.attack.value = 0.004;
    comp.release.value = 0.22;

    const makeupGain = audioCtx.createGain();
    const dest = audioCtx.createMediaStreamDestination();

    source.connect(hp);
    hp.connect(lp);
    lp.connect(presence);
    presence.connect(comp);
    comp.connect(makeupGain);
    makeupGain.connect(dest);

    nanaMicNodes = { source, hp, lp, presence, comp, makeupGain, dest };
    applyNanaMicDspParameters();

    const processedTrack = dest.stream.getAudioTracks()[0];
    return processedTrack || true;
  } catch (e) {
    console.warn("Falling back to default browser mic stream:", e);
    return true;
  }
}

function cleanupNanaMicDsp() {
  if (nanaMicNodes) {
    try { nanaMicNodes.source.disconnect(); nanaMicNodes.makeupGain.disconnect(); } catch (_) {}
    nanaMicNodes = null;
  }
  if (nanaRawMicStream) {
    nanaRawMicStream.getTracks().forEach(t => t.stop());
    nanaRawMicStream = null;
  }
}

// Resolve Front/Rear into a real device ID using the cached device list first (avoids opening a 2nd camera stream on Android)
async function resolveNanaCameraDeviceId(mode) {
  if (mode !== 'user' && mode !== 'environment') return mode;
  const cams = state.nanaDevicesSnap?.cameras || [];
  const pattern = mode === 'environment' ? /back|rear|environment|0/i : /front|user|selfie|1/i;
  const matched = cams.find(c => pattern.test(c.label)) || (mode === 'environment' ? cams[1] : cams[0]);
  if (matched?.deviceId) return matched.deviceId;

  const s = await navigator.mediaDevices.getUserMedia({ video: { facingMode: mode } });
  const id = s.getVideoTracks()[0]?.getSettings?.().deviceId || null;
  s.getTracks().forEach(t => t.stop());
  return id;
}

async function applyLiveNanaCameraAndMicChanges() {
  if (role !== 'nana' || !callObject) return;

  const targetCam = settings.nanaCameraMode || 'user';
  if (failedNanaCameraMode && targetCam !== failedNanaCameraMode) failedNanaCameraMode = null;
  if (targetCam !== appliedNanaCameraMode && targetCam !== failedNanaCameraMode) {
    try {
      const camId = await resolveNanaCameraDeviceId(targetCam);
      if (!camId) throw new Error('camera not found');
      await callObject.setInputDevicesAsync({ videoDeviceId: camId });
      appliedNanaCameraMode = targetCam;
      if ($('local-video')) {
        $('local-video').style.transform = targetCam === 'environment' ? 'scaleX(1)' : 'scaleX(-1)';
      }
      logCall('cam-switch', targetCam);
    } catch (e) {
      failedNanaCameraMode = targetCam;
      logCall('cam-switch-fail', e?.message || e);
    }
  }

  const targetMic = settings.nanaMicDeviceId || 'default';
  if (targetMic !== appliedNanaMicDeviceId) {
    try {
      const newProcessedTrack = await buildNanaProcessedMicTrack(targetMic);
      if (newProcessedTrack && typeof newProcessedTrack === 'object') {
        await callObject.setInputDevicesAsync({ audioSource: newProcessedTrack });
        callObject.setLocalAudio(true);
        logCall('mic-switch', targetMic);
      }
    } catch (e) {
      console.warn("Could not switch Nana microphone:", e);
    }
  }
}

// Detect ALL Safari / WebKit browsers (iOS, iPadOS with "Request Desktop Website", and macOS Safari)
// Safari WebKit has a known bug where routing a WebRTC MediaStreamTrack into AudioContext.createMediaStreamSource
// causes crackling/dropouts, so Safari must always play directly through the native #remote-audio element.
const isSafariOrIOS = /iPad|iPhone|iPod/.test(navigator.userAgent)
  || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  || /^((?!chrome|android).)*safari/i.test(navigator.userAgent);

// The Web Audio amplifier is the ONLY audible path while it is running (the muted #remote-audio element just keeps
// Chrome decoding the stream). If audioCtx isn't running, on Safari/iOS, or boost <= 100%, #remote-audio is unmuted directly.
const familyAmpIsExclusive = () => !isSafariOrIOS && !!familyBoostNodes && audioCtx.state === 'running';

function applyFamilyVoiceBoostGain() {
  const ra = $('remote-audio');
  const boostPct = Number(settings.familyVoiceBoostPct) || 180;
  if (isSafariOrIOS || boostPct <= 100) {
    cleanupFamilyVoiceAmplifier();
    if (ra && role === 'family') ra.muted = false;
    return;
  }
  if (!familyBoostNodes) {
    if (ra && role === 'family') ra.muted = false;
    return;
  }
  const gain = familyAmpIsExclusive() ? boostPct / 100 : (boostPct - 100) / 100;
  familyBoostNodes.gainNode.gain.setTargetAtTime(Math.max(0, Math.min(3.5, gain)), audioCtx.currentTime, 0.03);
  if (ra && role === 'family') ra.muted = familyAmpIsExclusive();
}

function attachFamilyVoiceAmplifier(aTrack) {
  if (role !== 'family' || !aTrack) return false;
  if (isSafariOrIOS || (Number(settings.familyVoiceBoostPct) || 180) <= 100) return false;
  if (attachedRemoteAudioTrack === aTrack && familyBoostNodes) {
    applyFamilyVoiceBoostGain();
    return true;
  }
  cleanupFamilyVoiceAmplifier();
  try {
    if (audioCtx.state === 'suspended') audioCtx.resume().catch(() => {});
    const stream = new MediaStream([aTrack]);
    const source = audioCtx.createMediaStreamSource(stream);

    const hp = audioCtx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 115;

    const presence = audioCtx.createBiquadFilter();
    presence.type = 'peaking';
    presence.frequency.value = 2200;
    presence.Q.value = 1.0;
    presence.gain.value = 2.5;

    const gainNode = audioCtx.createGain();

    const limiter = audioCtx.createDynamicsCompressor();
    limiter.threshold.value = -3.0;
    limiter.knee.value = 6.0;
    limiter.ratio.value = 12.0;
    limiter.attack.value = 0.002;
    limiter.release.value = 0.15;

    source.connect(hp);
    hp.connect(presence);
    presence.connect(gainNode);
    gainNode.connect(limiter);
    limiter.connect(audioCtx.destination);

    familyBoostNodes = { source, hp, presence, gainNode, limiter };
    attachedRemoteAudioTrack = aTrack;
    applyFamilyVoiceBoostGain();
    return true;
  } catch (e) {
    console.warn("Web Audio Family Amplifier fallback:", e);
    return false;
  }
}

function cleanupFamilyVoiceAmplifier() {
  attachedRemoteAudioTrack = null;
  if (familyBoostNodes) {
    try { familyBoostNodes.source.disconnect(); familyBoostNodes.limiter.disconnect(); } catch (_) {}
    familyBoostNodes = null;
  }
}

hooks.onSettingsChanged.push((s) => {
  applyNanaMicDspParameters();
  applyFamilyVoiceBoostGain();
  applyLiveNanaCameraAndMicChanges();
  if (role === 'nana' && state.settingsLoaded && !s.callingEnabled && state.callSnap?.status !== 'idle') {
    stopRingingUI();
    set(refs.callState, { status: 'idle', timestamp: Date.now() });
  }
});

// --- 3. MISSED CALLS & CONTACT GRID ---
const incrementMissedCallForMember = (id) =>
  runTransaction(ref(db, `${basePath}/missedCalls/${id}`), cur => ({
    count: (Number(cur?.count) || 0) + 1,
    timestamp: Date.now()
  }));

const clearMissedCallsForMember = (id) => id ? remove(ref(db, `${basePath}/missedCalls/${id}`)) : null;

window.clearAllMissedCalls = async () => {
  await remove(refs.missedCalls);
  state.missedCallsByMember = {};
  renderMissedCallsBanner();
  if (role === 'nana') renderContacts(state.connectedMemberIds);
};

function renderMissedCallsBanner() {
  const banner = $('missed-call-banner'), chips = $('missed-chips-container');
  if (!banner || !chips) return;
  chips.innerHTML = "";
  const entries = Object.entries(state.missedCallsByMember)
    .filter(([, v]) => v?.count > 0)
    .sort((a, b) => (b[1].timestamp || 0) - (a[1].timestamp || 0));
  if (!entries.length) {
    banner.style.display = 'none';
    return;
  }
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

export function renderContacts(connectedList = []) {
  const grid = $('family-grid');
  if (!grid) return;
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
    const missed = Number(state.missedCallsByMember[m.id]?.count) || 0;
    const card = document.createElement('div');
    card.className = missed > 0 ? 'family-card has-missed' : 'family-card';
    card.innerHTML = `${missed > 0 ? `<div class="missed-card-badge">📞 ${missed} MISSED</div>` : ''}<div class="photo-wrapper"><img src="${m.photo}" onerror="this.src='${m.fallback}'"></div><div class="contact-nameplate">${m.name}</div>`;
    card.onclick = () => window.openCallConfirmation(m);
    grid.appendChild(card);
  });
}
hooks.renderContacts = renderContacts;

onValue(refs.missedCalls, snap => {
  state.missedCallsByMember = snap.val() || {};
  renderMissedCallsBanner();
  if (role === 'nana') renderContacts(state.connectedMemberIds);
});

onValue(refs.connectedMembers, snap => {
  const val = snap.val();
  state.connectedMemberIds = Array.isArray(val) ? val : (val && typeof val === 'object' ? Object.values(val) : []);
  if (role === 'nana') renderContacts(state.connectedMemberIds);
  else hooks.refreshFamilyPresence?.();
});

window.syncConnectedFamilyFromTelegram = async () => {
  try {
    const res = await fetch(CONFIG.googleScriptUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({
        secret: SERVICE_TOKEN, portalNode: PORTAL_NODE_ID, action: "sync",
        webhookUrl: CONFIG.googleScriptUrl, portalBaseUrl: window.location.origin + window.location.pathname
      })
    });
    const data = await res.json();
    if (data.ok && Array.isArray(data.connected)) {
      state.connectedMemberIds = data.connected;
      if (role === 'nana') renderContacts(state.connectedMemberIds);
      else hooks.refreshFamilyPresence?.();
    }
    return data;
  } catch (e) {
    return { ok: false, error: e.toString() };
  }
};

window.forceWebhookAndMemberSync = async () => {
  const lbl = $('lbl-sync-status');
  if (lbl) lbl.innerText = "Syncing...";
  const res = await window.syncConnectedFamilyFromTelegram();
  if (res?.ok) {
    if (lbl) lbl.innerText = `✅ Linked (${(res.connected || []).length} connected)`;
    alert(`Synced! Connected: ${(res.connected || []).join(", ") || "None yet"}`);
  } else if (lbl) {
    lbl.innerText = "⚠️ Check Script Deployment";
  }
};

window.openCallConfirmation = (member) => {
  pendingCallContact = member;
  $('confirm-prompt-title').innerText = `Call ${member.name}?`;
  const img = $('confirm-photo');
  img.onerror = () => { img.src = member.fallback; };
  img.src = member.photo;
  const missed = Number(state.missedCallsByMember[member.id]?.count) || 0;
  const note = $('confirm-missed-note');
  note.innerText = missed > 0 ? `📞 ${member.name} tried calling you ${missed} ${missed === 1 ? 'time' : 'times'}` : '';
  note.style.display = missed > 0 ? 'block' : 'none';
  $('confirm-modal').style.display = 'flex';
  let s = 15;
  $('confirm-timer').innerText = s;
  clearInterval(confirmTimer);
  confirmTimer = setInterval(() => {
    if (--s <= 0) window.dismissCallConfirm();
    else $('confirm-timer').innerText = s;
  }, 1000);
};
window.dismissCallConfirm = () => {
  clearInterval(confirmTimer);
  $('confirm-modal').style.display = 'none';
  pendingCallContact = null;
};
window.executeConfirmedCall = () => {
  unlockCallAudioImmediate();
  const t = pendingCallContact;
  window.dismissCallConfirm();
  if (t) startCallFromNana(t);
};

// --- 4. CLASSIC FM RADIO STREAMING ---
function updateRadioButtonsUI(playing) {
  $('btn-classicfm')?.classList.toggle('playing', playing);
  if ($('radio-action-prompt')) $('radio-action-prompt').innerText = playing ? "Playing Live... (Tap to Stop)" : "(Tap to Start Radio)";
  if ($('radio-status-label')) $('radio-status-label').innerText = playing ? "Playing Classic FM 🎻" : "Radio Off";
  const bottomBtn = $('btn-bottom-radio-toggle');
  if (bottomBtn) {
    bottomBtn.innerText = playing ? "⏹️ Stop Radio" : "▶️ Start Radio";
    bottomBtn.style.background = playing ? "#7f1d1d" : "#059669";
    bottomBtn.style.borderColor = playing ? "#f87171" : "#4ade80";
  }
}

window.openRadioScreen = () => {
  showScreen('radio-screen');
  updateRadioButtonsUI(state.isRadioPlaying);
  window.wakeScreenAndResetDimTimer?.();
  NanaCore.recordTouchActivity?.("Opened Classic FM Radio");
  hooks.broadcastScreen?.();
};

window.closeRadioScreen = () => {
  window.stopRadioAndSync(true);
  showScreen('grid-screen');
  window.wakeScreenAndResetDimTimer?.();
  NanaCore.recordTouchActivity?.("On Home Grid");
  hooks.broadcastScreen?.();
};

window.toggleClassicFM = () => state.isRadioPlaying
  ? window.stopRadioAndSync(true)
  : set(refs.entertainment, { activeKey: "classicfm", title: "Classic FM Radio 🎻", timestamp: Date.now() });

window.remoteSetEntertainment = async (key) => {
  if (key !== 'off' && !confirm("Turn Classic FM radio ON on Nana's tablet now?")) return;
  await set(refs.entertainment, { activeKey: key === 'off' ? "off" : "classicfm", title: key === 'off' ? "Off" : "Classic FM Radio 🎻", timestamp: Date.now() });
};

window.stopRadioAndSync = async (sync = true) => {
  state.isRadioPlaying = false;
  if (radioPlayer) {
    radioPlayer.pause();
    radioPlayer.removeAttribute('src');
    radioPlayer.load();
  }
  updateRadioButtonsUI(false);
  window.wakeScreenAndResetDimTimer?.();
  if (sync) await set(refs.entertainment, { activeKey: "off", title: "Off", timestamp: Date.now() });
};

function startLocalRadioStream() {
  if (!radioPlayer) return;
  state.isRadioPlaying = true;
  window.wakeScreenAndResetDimTimer?.();
  radioPlayer.volume = Math.min(1.0, Math.max(0.15, (Number(settings.radioVolume ?? 75)) / 100));
  radioPlayer.src = CONFIG.classicFmStream;
  radioPlayer.play().catch(() => {});
  updateRadioButtonsUI(true);
  speakMsg("Playing Classic FM");
}

onValue(refs.entertainment, snap => {
  const data = snap.val() || { activeKey: "off", title: "Off" };
  const activeKey = data.activeKey || "off";
  state.entSnap = data;
  if (role === 'family') {
    if ($('lbl-remote-ent-status')) $('lbl-remote-ent-status').innerText = activeKey === 'off' ? 'Off' : 'Playing 🎻';
    $('fam-ent-classicfm')?.classList.toggle('selected', activeKey !== 'off');
    hooks.refreshFamilyPresence?.();
  } else if (role === 'nana' && state.currentState === 'idle') {
    if (activeKey === 'off') {
      if (state.isRadioPlaying) {
        window.stopRadioAndSync(false);
        showScreen('grid-screen');
      }
      return;
    }
    if ($('video-screen')?.classList.contains('active')) {
      hooks.pauseVideo?.('switched_to_radio');
    }
    if (!$('radio-screen').classList.contains('active')) showScreen('radio-screen');
    if (!state.isRadioPlaying) startLocalRadioStream();
    hooks.broadcastScreen?.();
  }
});

// --- 5. RINGTONE SYNTHESIZER (WITH HTML5 WAV FALLBACK) & 6-STAGE TELEGRAM RING BURST ---
function playNote(freq, start, dur, type = 'sine', baseGain = 0.6, vol = 85) {
  if (audioCtx.state === 'suspended') audioCtx.resume();
  const osc = audioCtx.createOscillator(), gain = audioCtx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, start);
  gain.gain.setValueAtTime(baseGain * (vol / 100), start);
  gain.gain.exponentialRampToValueAtTime(0.008, start + dur);
  osc.connect(gain);
  gain.connect(audioCtx.destination);
  osc.start(start);
  osc.stop(start + dur);
}

// Generate a loud UK dual-tone phone ring WAV blob so HTML5 <audio> rings out loud even when AudioContext is suspended after a reload
let cachedUkRingWavUrl = null;
function getFallbackRingWavUrl() {
  if (cachedUkRingWavUrl) return cachedUkRingWavUrl;
  const sampleRate = 8000, durationSec = 1.6, numSamples = sampleRate * durationSec;
  const buf = new ArrayBuffer(44 + numSamples * 2);
  const view = new DataView(buf);
  const writeStr = (off, s) => { for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i)); };
  writeStr(0, 'RIFF'); view.setUint32(4, 36 + numSamples * 2, true); writeStr(8, 'WAVE');
  writeStr(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true); view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true); view.setUint16(34, 16, true);
  writeStr(36, 'data'); view.setUint32(40, numSamples * 2, true);
  for (let i = 0; i < numSamples; i++) {
    const t = i / sampleRate;
    const isOn = (t >= 0 && t < 0.4) || (t >= 0.6 && t < 1.0);
    const sample = isOn ? 0.45 * (Math.sin(2 * Math.PI * 400 * t) + Math.sin(2 * Math.PI * 450 * t)) : 0;
    view.setInt16(44 + i * 2, Math.max(-1, Math.min(1, sample)) * 32767, true);
  }
  cachedUkRingWavUrl = URL.createObjectURL(new Blob([buf], { type: 'audio/wav' }));
  return cachedUkRingWavUrl;
}

export function playSelectedRingtoneAudio(tone, vol = 85, isPreview = false) {
  const safeVol = Math.min(1.0, Math.max(0.25, (Number(vol) || 85) / 100));
  if (tone.endsWith('.mp3')) {
    if (activeMp3Ringtone && !isPreview) return;
    activeMp3Ringtone?.pause();
    activeMp3Ringtone = new Audio(tone);
    activeMp3Ringtone.volume = safeVol;
    if (!isPreview) activeMp3Ringtone.loop = true;
    activeMp3Ringtone.play().catch(() => {});
    return;
  }

  // Try resuming AudioContext; if still suspended (e.g. after a remote reload with no screen touch yet),
  // immediately play the HTML5 <audio> WAV ringtone so the tablet NEVER rings silently!
  if (audioCtx.state === 'suspended') {
    audioCtx.resume().catch(() => {});
  }
  if (audioCtx.state !== 'running') {
    if (!activeMp3Ringtone || isPreview) {
      activeMp3Ringtone?.pause();
      activeMp3Ringtone = new Audio(getFallbackRingWavUrl());
      activeMp3Ringtone.volume = safeVol;
      if (!isPreview) activeMp3Ringtone.loop = true;
      activeMp3Ringtone.play().catch(() => {});
    }
    return;
  }

  const now = audioCtx.currentTime;
  if (tone === 'uk-phone') [0, 0.55].forEach(o => { playNote(400, now + o, 0.35, 'square', 0.45, vol); playNote(450, now + o, 0.35, 'square', 0.45, vol); });
  else if (tone === 'westminster') [[329.63,0,0.35],[415.3,0.35,0.35],[369.99,0.7,0.35],[246.94,1.05,0.65]].forEach(([f,o,d]) => playNote(f, now + o, d, 'triangle', 0.8, vol));
  else if (tone === 'marimba') [[523.25,0,0.25],[659.25,0.22,0.25],[783.99,0.44,0.25],[1046.5,0.66,0.55]].forEach(([f,o,d]) => playNote(f, now + o, d, 'sine', 0.8, vol));
  else if (tone === 'bell') [0, 0.35, 0.7].forEach(o => { playNote(880, now + o, 0.28, 'sine', 0.75, vol); playNote(1760, now + o, 0.28, 'triangle', 0.5, vol); });
}

window.previewAndSetTone = async (tone) => {
  settings.ringtone = tone;
  playSelectedRingtoneAudio(tone, settings.ringVolume || 85, true);
  await window.updateSetting('ringtone', tone);
};

async function sendSingleTelegramRing(member, step, max) {
  const answerUrl = `${window.location.origin + window.location.pathname}?role=family&id=${encodeURIComponent(member.id)}&key=${encodeURIComponent(SERVICE_TOKEN)}&answer=true`;
  try {
    if ($('outbound-sub')) $('outbound-sub').innerText = `Ringing their mobile now (${step}/${max})...`;
    const res = await fetch(CONFIG.googleScriptUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({
        secret: SERVICE_TOKEN, portalNode: PORTAL_NODE_ID, action: "ring",
        memberId: member.id, answerUrl, ringCount: step, maxRings: max, previousMessageId: lastTelegramMsgId
      })
    });
    const data = await res.json();
    if (data.ok && data.messageId) lastTelegramMsgId = data.messageId;
  } catch (_) {}
}

function startTelegramRingBurst(member) {
  stopTelegramRingBurst();
  currentDialedMember = member;
  lastTelegramMsgId = null;
  let step = 1;
  sendSingleTelegramRing(member, step, 6);
  telegramBurstInterval = setInterval(() => {
    if (state.currentState !== 'calling_family' || step >= 6) {
      clearInterval(telegramBurstInterval);
      telegramBurstInterval = null;
      return;
    }
    sendSingleTelegramRing(member, ++step, 6);
  }, 8500);
}

function stopTelegramRingBurst() {
  clearInterval(telegramBurstInterval);
  telegramBurstInterval = null;
  if (currentDialedMember && lastTelegramMsgId) {
    const memberId = currentDialedMember.id, messageId = lastTelegramMsgId;
    lastTelegramMsgId = null;
    fetch(CONFIG.googleScriptUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ secret: SERVICE_TOKEN, portalNode: PORTAL_NODE_ID, action: "clear_rings", memberId, messageId })
    }).catch(() => {});
  }
}

// --- 6. DAILY.CO WEBRTC VIDEO ENGINE (WITH VOCAL DSP, KRISP & AMPLIFIER) ---
window.switchFamilyCamera = async () => {
  if (!callObject) return;
  try {
    currentFacingMode = currentFacingMode === 'user' ? 'environment' : 'user';
    if (typeof callObject.cycleCamera === 'function') await callObject.cycleCamera();
    else await callObject.setInputDevicesAsync({ videoSource: { facingMode: currentFacingMode } });
    if ($('local-video')) $('local-video').style.transform = currentFacingMode === 'environment' ? 'scaleX(1)' : 'scaleX(-1)';
  } catch (_) {
    try { await callObject.setInputDevicesAsync({ videoSource: { facingMode: currentFacingMode } }); } catch (__) {}
  }
};

// ---------------------------------------------------------------------------
// CALL RELIABILITY HELPERS
// ---------------------------------------------------------------------------
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const withTimeout = (p, ms) => Promise.race([Promise.resolve(p), sleep(ms).then(() => '__timeout__')]);
let rejoinAttempts = 0;
let callBeatTimer = null;

// Last 30 call events per device, saved to Firebase (callDiag/<nana|member>) so sporadic failures can be diagnosed
const diagKey = role === 'nana' ? 'nana' : activeFamilyMember.id;
const diagEvents = [];
let diagTimer = null;
function logCall(evt, detail = '') {
  diagEvents.push(`${new Date().toISOString().slice(11, 19)} ${evt}${detail ? ' ' + String(detail).slice(0, 140) : ''}`);
  if (diagEvents.length > 60) diagEvents.shift();
  clearTimeout(diagTimer);
  diagTimer = setTimeout(() => {
    set(ref(db, `${basePath}/callDiag/${diagKey}`), {
      events: diagEvents.slice(), ua: navigator.userAgent.slice(0, 100), updatedAt: Date.now()
    }).catch(() => {});
  }, 3000);
}

onValue(refs.callBeat, snap => { state.callBeatMs = Number(snap.val()) || 0; });

function thisTabShouldBeInCall() {
  const d = state.callSnap || {};
  if (d.status !== 'connected') return false;
  return role === 'nana'
    ? (isRealAndroidTablet || TEST_MODE || didManuallyInitiateOrAnswerOnThisTab)
    : (didManuallyInitiateOrAnswerOnThisTab && (!d.familyTabId || d.familyTabId === CLIENT_TAB_ID));
}

async function teardownCallObject() {
  if (!callObject) return;
  const co = callObject;
  callObject = null;
  logCall('leave');
  try {
    const t = co.participants()?.local?.tracks;
    [t?.video, t?.audio].forEach(x => { try { (x?.persistentTrack || x?.track)?.stop(); } catch (_) {} });
  } catch (_) {}
  try { co.setLocalVideo(false); co.setLocalAudio(false); } catch (_) {}
  try { await withTimeout(co.leave(), 4000); } catch (_) {}
  try { await withTimeout(co.destroy(), 3000); } catch (_) {}
}

// Recover browsers that blocked audio autoplay: any touch during a call retries playback
document.addEventListener('pointerdown', () => {
  if (!callObject) return;
  if (audioCtx?.state === 'suspended') audioCtx.resume().catch(() => {});
  ['remote-audio', 'remote-video'].forEach(id => {
    const el = $(id);
    if (el?.srcObject && el.paused) el.play().catch(() => {});
  });
}, { passive: true });

window.addEventListener('online', () => {
  logCall('network-online');
  if (!callObject && !isJoiningOrInRoom && thisTabShouldBeInCall()) joinDailyRoom();
});
window.addEventListener('offline', () => logCall('network-offline'));
window.addEventListener('pagehide', () => { try { callObject?.leave(); } catch (_) {} });

async function joinDailyRoom() {
  if (isJoiningOrInRoom || callObject) return;
  isJoiningOrInRoom = true;
  currentFacingMode = 'user';
  window.wakeInCallControls();
  const banner = $('call-connecting-banner');
  banner.style.display = 'block';
  banner.innerText = '📹 Connecting video...';
  if (!window.DailyIframe) {
    banner.innerText = '⚠️ Video library failed to load';
    isJoiningOrInRoom = false;
    return;
  }

  // Ensure any lingering camera tracks from a previous call are fully released first
  const lvPrev = $('local-video');
  if (lvPrev?.srcObject) {
    lvPrev.srcObject.getTracks().forEach(t => t.stop());
    lvPrev.srcObject = null;
  }

  // Always resume AudioContext and build Nana's processed vocal-boost mic track
  let customAudioSource = true;
  if (role === 'nana') {
    try { await withTimeout(audioCtx.resume(), 2000); } catch (_) {}
    const t = await withTimeout(buildNanaProcessedMicTrack(settings.nanaMicDeviceId), 6000);
    if (t && t !== '__timeout__' && typeof t === 'object' && audioCtx.state === 'running') {
      customAudioSource = t;
      logCall('mic-dsp-active', settings.nanaMicDspMode || 'vocal-boost');
    } else {
      cleanupNanaMicDsp();
      logCall('mic-dsp-fallback', 'ctx=' + audioCtx.state);
    }
  }
  logCall('join-start');
  const nanaCamConstraint = role === 'nana'
    ? getNanaVideoConstraintObject(settings.nanaCameraMode)
    : { facingMode: 'user', width: { ideal: 640, max: 960 }, height: { ideal: 480, max: 540 }, frameRate: { ideal: 20, max: 24 } };

  if (role === 'nana') appliedNanaCameraMode = settings.nanaCameraMode || 'user';

  const co = window.DailyIframe.createCallObject({
    audioSource: customAudioSource,
    videoSource: true,
    dailyConfig: {
      avoidEval: true,
      userMediaAudioConstraints: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      userMediaVideoConstraints: nanaCamConstraint
    }
  });
  callObject = co;
  let hadRemote = false, emptyTimer = null;
  let boundVideoTrack = null;
  const targetVol = () => role === 'nana' ? Math.min(1.0, Math.max(0.2, (Number(settings.callVolume) || 85) / 100)) : 1.0;
  const showProblem = (t) => { banner.style.display = 'block'; banner.innerText = t; };
  let audioBlocked = false;
  let videoPausedForNetwork = false;
  let joinedOk = false;
  const hideBannerIfOk = () => { if (!audioBlocked) banner.style.display = 'none'; };
  const playEl = (el) => el.play().then(() => { if (el.id === 'remote-audio') audioBlocked = false; }).catch(() => {
    if (el.id === 'remote-audio') { audioBlocked = true; showProblem('🔇 Touch the screen to hear'); }
  });

  const tryRecover = (why) => {
    if (callObject !== co) return;
    if (!joinedOk) { logCall('error-before-join', why); return; }
    logCall('recover', why);
    if (thisTabShouldBeInCall() && rejoinAttempts < 2) {
      rejoinAttempts++;
      showProblem('🔄 Reconnecting video...');
      setTimeout(async () => {
        if (callObject !== co || !thisTabShouldBeInCall()) return;
        await teardownCallObject();
        isJoiningOrInRoom = false;
        joinDailyRoom();
      }, 1500);
    } else {
      showProblem('⚠️ Video connection lost');
      setTimeout(() => { if (callObject === co) window.endCall(true); }, 3000);
    }
  };

  const pickBestRemoteParticipant = (remotes) => {
    if (!remotes.length) return null;
    const scoreParticipant = (p) => {
      let score = 0;
      const vState = p.tracks?.video?.state;
      const aState = p.tracks?.audio?.state;
      if (vState === 'playable') score += 100;
      else if (vState === 'loading' || vState === 'sendable') score += 40;
      if (aState === 'playable') score += 50;
      if (role === 'family' && (p.user_name || '').startsWith('Nana')) score += 25;
      if (role === 'nana' && (p.user_name || '').startsWith('Family_')) score += 25;
      if (p.joined_at) score += (new Date(p.joined_at).getTime() / 1e13);
      return score;
    };
    return [...remotes].sort((a, b) => scoreParticipant(b) - scoreParticipant(a))[0];
  };

  const attachTracks = () => {
    if (callObject !== co) return;
    const parts = co.participants();
    const localTrack = parts.local?.tracks?.video?.persistentTrack || parts.local?.tracks?.video?.track;
    const lv = $('local-video');
    if (localTrack && lv && lv.srcObject?.getVideoTracks()[0] !== localTrack) {
      lv.srcObject = new MediaStream([localTrack]);
      lv.play().catch(() => {});
    }

    const remotes = Object.values(parts).filter(p => !p.local);
    const target = pickBestRemoteParticipant(remotes);
    if (!target) return;
    hadRemote = true;
    hadRemoteMediaInCurrentCall = true;
    rejoinAttempts = 0;
    clearTimeout(emptyTimer);

    const vTrack = target.tracks?.video?.persistentTrack || target.tracks?.video?.track;
    const aTrack = target.tracks?.audio?.persistentTrack || target.tracks?.audio?.track;
    const rv = $('remote-video'), ra = $('remote-audio');

    if (vTrack && vTrack !== boundVideoTrack) {
      boundVideoTrack = vTrack;
      vTrack.onunmute = () => {
        if (rv) {
          rv.muted = true;
          rv.srcObject = new MediaStream([vTrack]);
          rv.play().catch(() => {});
          hideBannerIfOk();
        }
      };
    }

    if (vTrack && rv && vTrack.readyState === 'live') {
      hideBannerIfOk();
      if (rv.srcObject?.getVideoTracks()[0] !== vTrack) {
        rv.muted = true;
        rv.srcObject = new MediaStream([vTrack]);
        rv.play().catch(() => {});
      } else if (rv.paused) {
        rv.muted = true;
        rv.play().catch(() => {});
      }
    } else if (role === 'family' && (!vTrack || target.tracks?.video?.state === 'loading' || target.tracks?.video?.state === 'interrupted')) {
      showProblem('📹 Waiting for Nana\'s camera video...');
    }

    if (aTrack && aTrack.readyState === 'live') {
      if (role === 'family') {
        if (!isSafariOrIOS && audioCtx.state === 'suspended') audioCtx.resume().catch(() => {});
        attachFamilyVoiceAmplifier(aTrack);
        if (ra && ra.srcObject?.getAudioTracks()[0] !== aTrack) {
          ra.loop = false;
          ra.removeAttribute('src');
          ra.srcObject = new MediaStream([aTrack]);
          ra.muted = false;
          ra.volume = 1.0;
          playEl(ra);
        }
        if (ra) ra.muted = familyAmpIsExclusive();
        applyFamilyVoiceBoostGain();
      } else if (ra && ra.srcObject?.getAudioTracks()[0] !== aTrack) {
        ra.loop = false;
        ra.removeAttribute('src');
        ra.srcObject = new MediaStream([aTrack]);
        ra.muted = false;
        ra.volume = targetVol();
        playEl(ra);
      }
      if (ra && ra.srcObject && ra.paused) { ra.muted = role === 'family' ? familyAmpIsExclusive() : false; playEl(ra); }
    }
  };

  ['joined-meeting', 'participant-joined', 'participant-updated', 'track-started', 'track-stopped'].forEach(ev => co.on(ev, attachTracks));

  const camWatchdog = setInterval(() => {
    if (callObject !== co) { clearInterval(camWatchdog); return; }
    if (role === 'nana') {
      const localV = co.participants()?.local?.tracks?.video;
      if (localV && !videoPausedForNetwork && (localV.state === 'off' || localV.state === 'blocked')) {
        co.setLocalVideo(true);
      }
    }
    attachTracks();
  }, 3500);

  co.on('participant-left', () => {
    if (callObject !== co) return;
    attachTracks();
    clearTimeout(emptyTimer);
    emptyTimer = setTimeout(() => {
      if (callObject === co && hadRemote && !Object.values(co.participants()).some(p => !p.local)) window.endCall();
    }, 10000);
  });
  co.on('camera-error', e => {
    logCall('camera-error', e?.errorMsg?.errorMsg || e?.errorMsg || '');
    showProblem('⚠️ Camera/mic error: ' + (e?.errorMsg?.errorMsg || 'check permissions'));
  });
  co.on('nonfatal-error', e => logCall('nonfatal-error', e?.errorMsg || e?.type || ''));
  co.on('network-connection', e => {
    logCall('network', e?.event || '');
    if (callObject === co && e?.event === 'interrupted') showProblem('📡 Connection wobble - please hold on...');
  });
  co.on('error', e => tryRecover('error ' + (e?.errorMsg || '')));

  // Step down outgoing video on EITHER side if Wi-Fi/4G packet loss spikes so voice packets always get priority
  co.on('network-quality-change', e => {
    if (callObject !== co) return;
    const s = e?.networkState || (e?.threshold === 'very-low' ? 'bad' : e?.threshold === 'low' ? 'warning' : 'good');
    logCall('quality', `${s} ${(e?.networkStateReasons || []).join(',')}`);
    if (s === 'bad' && !videoPausedForNetwork) {
      videoPausedForNetwork = true;
      try { co.setLocalVideo(false); } catch (_) {}
      logCall('video-off-network');
    } else if (s === 'good' && videoPausedForNetwork) {
      videoPausedForNetwork = false;
      try { co.setLocalVideo(true); } catch (_) {}
      logCall('video-on-network');
    }
  });
  co.on('cpu-load-change', e => {
    if (callObject !== co) return;
    logCall('cpu', e?.cpuLoadState || '');
    co.updateSendSettings({ video: e?.cpuLoadState === 'high' ? { maxQuality: 'low' } : 'bandwidth-optimized' }).catch(() => {});
  });

  try {
    let joined = false;
    for (let attempt = 1; attempt <= 3 && callObject === co; attempt++) {
      try {
        if (attempt > 1) {
          showProblem(`📹 Connecting video... (try ${attempt})`);
          try { await withTimeout(co.leave(), 2000); } catch (_) {}
        }
        await co.join({
          url: CONFIG.dailyRoomUrl,
          userName: role === 'nana' ? (isRealAndroidTablet ? 'Nana_Tablet' : 'Nana_Browser') : `Family_${activeFamilyMember.id}`,
          startVideoOff: false,
          startAudioOff: false
        });
        joined = true;
        break;
      } catch (e) {
        logCall('join-fail', `try${attempt} ${e?.errorMsg || e?.message || e}`);
        await sleep(attempt * 1500);
      }
    }
    if (!joined) throw new Error('join failed');
    joinedOk = true;
    logCall('joined');
    co.setLocalVideo(true);
    co.setLocalAudio(true);

    if (role === 'nana') publishNanaHardwareDevices();

    clearInterval(callBeatTimer);
    const beat = () => set(refs.callBeat, Date.now()).catch(() => {});
    beat();
    callBeatTimer = setInterval(beat, 25000);

    setTimeout(() => { if (callObject === co && !hadRemote) window.endCall(true); }, 90000);

    if (typeof co.updateInputSettings === 'function') {
      co.updateInputSettings({ audio: { processor: { type: 'krisp' } } }).catch(() => {});
    }

    // Cap video at 600 kbps and use bandwidth-optimized layers on BOTH sides so video bursts never starve voice audio
    try { co.setBandwidth({ kbs: 600 }); } catch (_) {}
    co.updateSendSettings({ video: 'bandwidth-optimized' }).catch(() => {});

    logCall('audio', `ctx=${audioCtx.state} safari=${isSafariOrIOS} base=${Math.round((audioCtx.baseLatency || 0) * 1000)}ms out=${Math.round((audioCtx.outputLatency || 0) * 1000)}ms`);
    try { co.getNetworkTopology?.().then(t => logCall('topology', t?.topology)).catch(() => {}); } catch (_) {}
    const statsTimer = setInterval(async () => {
      if (callObject !== co) { clearInterval(statsTimer); return; }
      try {
        const n = await co.getNetworkStats();
        const l = n?.stats?.latest || {};
        logCall('stats', `${n?.networkState || n?.threshold} rtt=${Math.round((n?.stats?.averageNetworkRoundTripTime || 0) * 1000)}ms in=${Math.round((l.recvBitsPerSecond || 0) / 1000)}k out=${Math.round((l.sendBitsPerSecond || 0) / 1000)}k ctxOut=${Math.round((audioCtx.outputLatency || 0) * 1000)}ms`);
      } catch (_) {}
    }, 30000);
  } catch (_) {
    clearInterval(camWatchdog);
    if (callObject !== co) return;
    showProblem('⚠️ Could not join video room');
    setTimeout(() => { if (callObject === co) window.endCall(true); }, 4000);
  }
}

async function destroyDailyRoom() {
  isJoiningOrInRoom = false;
  didManuallyInitiateOrAnswerOnThisTab = false;
  appliedNanaCameraMode = null;
  appliedNanaMicDeviceId = null;
  failedNanaCameraMode = null;
  rejoinAttempts = 0;
  clearInterval(callBeatTimer);
  callBeatTimer = null;
  cleanupNanaMicDsp();
  cleanupFamilyVoiceAmplifier();
  await teardownCallObject();
  ['remote-video', 'remote-audio', 'local-video'].forEach(id => {
    const el = $(id);
    if (el) {
      el.loop = false;
      if (el.srcObject && typeof el.srcObject.getTracks === 'function') {
        el.srcObject.getTracks().forEach(t => { try { t.stop(); } catch (_) {} });
      }
      el.srcObject = null;
    }
  });
}

function stopRingingUI() {
  clearInterval(ringInterval);
  ringInterval = null;
  window.speechSynthesis?.cancel();
  if (activeMp3Ringtone) {
    activeMp3Ringtone.pause();
    activeMp3Ringtone.currentTime = 0;
    activeMp3Ringtone = null;
  }
}

// --- 7. CALL SIGNALING, ACCIDENTAL END-CALL MODAL & SIGNAL-DIP JITTER GUARD ---
async function startCallFromNana(member) {
  if (!settings.callingEnabled || isHiddenFromNana(member.id)) return;
  unlockCallAudioImmediate();
  didManuallyInitiateOrAnswerOnThisTab = true;
  await window.stopRadioAndSync(true);
  $('bulletin-modal').style.display = 'none';
  window.closeSeniorKeyboard?.(false);
  state.currentState = 'calling_family';
  window.wakeScreenAndResetDimTimer?.();

  const img = $('outbound-photo');
  img.onerror = () => { img.src = member.fallback; };
  img.src = member.photo;
  $('outbound-title').innerText = `Calling ${member.name}...`;
  showScreen('outbound-screen');
  speakMsg(`Calling ${member.spokenName} now. Please wait.`);

  try {
    await clearMissedCallsForMember(member.id);
    await set(refs.callState, {
      status: 'calling_family',
      callerId: 'nana',
      targetId: member.id,
      nanaTabId: CLIENT_TAB_ID,
      timestamp: Date.now()
    });
  } catch (_) {
    state.currentState = 'idle';
    showScreen('grid-screen');
    return;
  }
  startTelegramRingBurst(member);
  clearTimeout(outboundTimeout);
  outboundTimeout = setTimeout(async () => {
    if (state.currentState === 'calling_family') {
      speakMsg(`Sorry, ${member.spokenName} could not answer right now.`);
      await incrementMissedCallForMember(member.id);
      await executeEndCallCleanup();
    }
  }, (Number(settings.ringDurationSec) || 60) * 1000);
}

window.confirmFamilyPickupFromTelegram = async () => {
  unlockCallAudioImmediate();
  let res = null;
  try {
    res = await runTransaction(refs.callState, cur => {
      if (cur === null) return cur;
      if (cur.status !== 'calling_family' || cur.targetId !== activeFamilyMember.id) return;
      return {
        status: 'connected',
        callerId: 'nana',
        targetId: activeFamilyMember.id,
        familyTabId: CLIENT_TAB_ID,
        nanaTabId: cur.nanaTabId || null,
        timestamp: Date.now()
      };
    });
  } catch (_) {}
  if (!res?.committed || res.snapshot?.val()?.status !== 'connected') {
    showScreen('family-screen');
    alert("Nana's call has already finished. You can ring her from here whenever you like.");
    return;
  }
  didManuallyInitiateOrAnswerOnThisTab = true;
  showScreen('call-screen');
  joinDailyRoom();
  clearMissedCallsForMember(activeFamilyMember.id);
};

window.startCallFromFamily = async () => {
  if (!settings.callingEnabled) return alert("Video calling is currently switched off.");
  if (!confirm("Ring Nana's tablet now?")) return;
  // Unlock audio AFTER confirm() returns so Android Chrome keeps the user gesture active!
  unlockCallAudioImmediate();
  didManuallyInitiateOrAnswerOnThisTab = true;
  const btn = $('family-ring-btn');
  if (btn) btn.disabled = true;
  try {
    const lastBeat = Math.max(Number(state.callBeatMs) || 0, Number(state.callSnap?.timestamp) || 0);
    if (state.callSnap?.status === 'connected' && Date.now() - lastBeat > 120000) {
      try { await withTimeout(set(refs.callState, { status: 'idle', timestamp: Date.now() }), 4000); } catch (_) {}
    }
    const res = await runTransaction(refs.callState, cur => {
      if (cur && cur.status !== 'idle') {
        if (cur.status === 'connected') return;
        if (!(cur.timestamp && Date.now() - cur.timestamp > 90000)) return;
      }
      return {
        status: 'ringing_nana',
        callerId: activeFamilyMember.id,
        targetId: 'nana',
        familyTabId: CLIENT_TAB_ID,
        nanaRingingConfirmedAt: null,
        timestamp: Date.now()
      };
    });
    if (!res.committed) {
      didManuallyInitiateOrAnswerOnThisTab = false;
      alert("Nana's tablet is currently busy on another call.");
      if (btn) btn.disabled = false;
      return;
    }
    showScreen('call-screen');
    const b = $('call-connecting-banner');
    if (b) { b.style.display = 'block'; b.innerText = '🔔 Calling Nana\'s tablet...'; }
    clearTimeout(outboundTimeout);
    outboundTimeout = setTimeout(async () => {
      if (state.currentState === 'ringing_nana' && didManuallyInitiateOrAnswerOnThisTab) {
        await executeEndCallCleanup();
        alert("Nana didn't answer. Her tablet may be switched off or offline, so please try again later.");
      }
    }, ((Number(settings.ringDurationSec) || 60) + 15) * 1000);
  } catch (_) {
    didManuallyInitiateOrAnswerOnThisTab = false;
    if (btn) btn.disabled = !settings.callingEnabled;
  }
};

window.answerCallAsNana = async () => {
  unlockCallAudioImmediate();
  didManuallyInitiateOrAnswerOnThisTab = true;
  clearTimeout(autoAnswerTimeout);
  stopRingingUI();
  showScreen('call-screen');
  joinDailyRoom();
  const cId = state.callSnap?.callerId;
  if (cId && cId !== 'nana') await clearMissedCallsForMember(cId);
  await set(refs.callState, {
    status: 'connected',
    callerId: cId || 'family',
    targetId: 'nana',
    familyTabId: state.callSnap?.familyTabId || null,
    nanaTabId: CLIENT_TAB_ID,
    timestamp: Date.now()
  });
};

async function executeEndCallCleanup() {
  clearTimeout(outboundTimeout);
  clearTimeout(incomingRingTimeout);
  clearTimeout(autoAnswerTimeout);
  clearTimeout(jitterHoldTimer);
  if ($('end-call-confirm-modal')) $('end-call-confirm-modal').style.display = 'none';
  stopTelegramRingBurst();
  stopRingingUI();
  if ($('family-ring-btn')) $('family-ring-btn').disabled = !settings.callingEnabled;
  set(refs.callState, { status: 'idle', timestamp: Date.now() }).catch(() => {});
  await destroyDailyRoom();
  logCall('ended');
  if (role === 'family') {
    showScreen('family-screen');
  } else if (state.returnToVideoAfterCall) {
    state.returnToVideoAfterCall = false;
    showScreen('video-screen');
    hooks.openVideoScreen?.();
  } else {
    showScreen('grid-screen');
  }
}

window.promptEndCallConfirmation = () => {
  const m = $('end-call-confirm-modal');
  if (!m) return window.confirmFamilyEndCallNow();
  m.style.display = 'flex';
  clearTimeout(endCallModalTimer);
  endCallModalTimer = setTimeout(() => { m.style.display = 'none'; }, 8000);
};

window.dismissEndCallConfirm = () => {
  clearTimeout(endCallModalTimer);
  if ($('end-call-confirm-modal')) $('end-call-confirm-modal').style.display = 'none';
};

window.confirmFamilyEndCallNow = async () => {
  clearTimeout(endCallModalTimer);
  clearTimeout(jitterHoldTimer);
  if ($('end-call-confirm-modal')) $('end-call-confirm-modal').style.display = 'none';
  endCallConfirmedByUser = true;
  await executeEndCallCleanup();
  setTimeout(() => { endCallConfirmedByUser = false; }, 2000);
};

window.endCall = async (forceImmediate = false) => {
  if (role === 'family') {
    const isConnectedCall = state.callSnap?.status === 'connected' && $('call-screen')?.classList.contains('active');
    if (!forceImmediate && !endCallConfirmedByUser && isConnectedCall) {
      const banner = $('call-connecting-banner');
      if (banner) {
        banner.style.display = 'block';
        banner.innerText = '📡 Signal dip — holding call for 35s to reconnect...';
      }
      clearTimeout(jitterHoldTimer);
      jitterHoldTimer = setTimeout(async () => {
        const rv = $('remote-video');
        const videoRecovered = rv && rv.srcObject && !rv.paused && rv.readyState >= 2;
        if (!videoRecovered && state.callSnap?.status === 'connected') {
          await executeEndCallCleanup();
        } else if (banner) {
          banner.style.display = 'none';
        }
      }, 35000);
      return;
    }
  }
  await executeEndCallCleanup();
};

// --- REMOTE RELOAD, 4AM QUIET MAINTENANCE RELOAD & FAMILY UPDATE PROMPT ---
const PAGE_BOOT_MS = Date.now();
const MIN_UPTIME_FOR_NIGHTLY_RELOAD_MS = 24 * 60 * 60 * 1000; // 24 hours

window.forceCacheBustReload = () => {
  if (window.AndroidBridge?.clearCacheAndReload) {
    window.AndroidBridge.clearCacheAndReload();
    return;
  }
  const u = new URL(window.location.href);
  u.searchParams.set('u', String(Date.now()));
  window.location.replace(u.toString());
};

function showFamilyUpdatePromptModal() {
  if ($('family-update-banner-modal')) {
    $('family-update-banner-modal').style.display = 'flex';
    return;
  }
  const modal = document.createElement('div');
  modal.id = 'family-update-banner-modal';
  modal.style.cssText = 'position:fixed;inset:0;background:rgba(9,13,22,0.95);z-index:10050;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:24px;text-align:center;';
  modal.innerHTML = `
    <div style="background:#1e293b;border:4px solid #38bdf8;border-radius:28px;padding:28px 24px;max-width:460px;width:92vw;box-shadow:0 16px 40px rgba(0,0,0,0.85);display:flex;flex-direction:column;align-items:center;gap:16px;">
      <div style="font-size:3.2rem;line-height:1;">🔄</div>
      <div style="font-size:1.5rem;font-weight:900;color:#fef08a;">New Update Available</div>
      <div style="font-size:1.05rem;font-weight:700;color:#e2e8f0;line-height:1.4;">
        NanaPhone has been updated with the latest call and audio fixes. Tap below to refresh your page so you're on the newest version.
      </div>
      <button onclick="forceCacheBustReload()" style="width:100%;background:#22c55e;color:#000;border:3px solid #fff;border-radius:18px;padding:14px 20px;font-size:1.25rem;font-weight:900;cursor:pointer;box-shadow:0 6px 16px rgba(0,0,0,0.5);">
        🔄 Refresh & Update Now
      </button>
    </div>
  `;
  document.body.appendChild(modal);
}

{
  let reloadPending = false;
  const tryReload = () => {
    if (!reloadPending || state.currentState === 'connected') return;
    if (role === 'nana') {
      window.forceCacheBustReload();
    } else {
      showFamilyUpdatePromptModal();
    }
  };

  onValue(refs.reloadCmd, snap => {
    const val = Number(snap.val() || 0);
    if (!val) return;
    const storageKey = `nana_last_reload_cmd_${role}`;
    const last = localStorage.getItem(storageKey);
    localStorage.setItem(storageKey, String(val));

    if (last !== null && val > Number(last)) {
      reloadPending = true;
      tryReload();
    } else if (last === null && (Date.now() - val < 3600 * 1000)) {
      const lastBust = Number(new URLSearchParams(window.location.search).get('u') || 0);
      if (val > lastBust + 10000) {
        reloadPending = true;
        tryReload();
      }
    }
  });
  setInterval(tryReload, 5000);

  // Quiet nightly maintenance reload around 4:00 AM on Nana's tablet
  // Runs only when idle and up for >24 hours to clear memory build-up and pick up new code
  if (role === 'nana') {
    setInterval(() => {
      const now = Date.now();
      if (now - PAGE_BOOT_MS < MIN_UPTIME_FOR_NIGHTLY_RELOAD_MS) return;
      if (new Date(now).getHours() !== 4) return;
      const isIdle = state.currentState === 'idle'
        && !callObject
        && !isJoiningOrInRoom
        && !state.isRadioPlaying
        && !NanaCore.isNanaVideoActivelyPlaying?.()
        && !$('bulletin-modal')?.classList.contains('kb-fullscreen')
        && (now - state.lastActivityOrCallMs > 30 * 60 * 1000);
      if (isIdle) {
        window.forceCacheBustReload();
      }
    }, 5 * 60 * 1000);
  }
}

// Unified Call State Listener
onValue(refs.callState, snap => {
  const data = snap.val();
  if (!data) return;
  state.callSnap = data;
  state.currentState = data.status;
  state.lastActivityOrCallMs = Date.now();

  if (role === 'nana' && state.settingsLoaded && !settings.callingEnabled && data.status !== 'idle') {
    stopRingingUI();
    set(refs.callState, { status: 'idle', timestamp: Date.now() });
    return;
  }

  if (role === 'family') hooks.refreshFamilyPresence?.();

  const isActiveNanaTab = role === 'nana' && (isRealAndroidTablet || TEST_MODE || didManuallyInitiateOrAnswerOnThisTab);
  const isActiveFamilyTab = role === 'family' && didManuallyInitiateOrAnswerOnThisTab && (!data.familyTabId || data.familyTabId === CLIENT_TAB_ID);

  if (data.status === 'idle') {
    clearTimeout(jitterHoldTimer);
    if ($('end-call-confirm-modal')) $('end-call-confirm-modal').style.display = 'none';
  } else if (isActiveNanaTab || isActiveFamilyTab) {
    $('bulletin-modal').style.display = 'none';
    if ($('nana-question-modal')) $('nana-question-modal').style.display = 'none';
    window.closeSeniorKeyboard?.(false);
    if (role === 'nana') {
      if (state.isRadioPlaying) window.stopRadioAndSync(true);
      if ($('video-screen')?.classList.contains('active')) {
        state.returnToVideoAfterCall = true;
      }
      hooks.pauseVideo?.('incoming_call');
    }
  }

  if (role === 'nana') {
    if (data.status === 'connected') {
      if (!activeCallConnectedAtMs) {
        activeCallConnectedAtMs = Date.now();
        activeCallPartnerId = data.callerId === 'nana' ? data.targetId : data.callerId;
      }
    } else if (data.status === 'idle' && activeCallConnectedAtMs) {
      const endedAt = Date.now();
      const durationSec = Math.round((endedAt - activeCallConnectedAtMs) / 1000);
      const partnerId = activeCallPartnerId || 'family';
      const startedAt = activeCallConnectedAtMs;
      const wasMediaConnected = hadRemoteMediaInCurrentCall;
      activeCallConnectedAtMs = null;
      activeCallPartnerId = null;
      hadRemoteMediaInCurrentCall = false;
      if (wasMediaConnected && durationSec >= 15) {
        push(refs.callHistory, {
          partnerId,
          partnerName: FAMILY_NAMES[partnerId] || 'Family',
          connected: true,
          startedAt,
          endedAt,
          durationSec
        }).catch(() => {});
      }
    }

    const act = isActiveNanaTab;
    if (data.status === 'ringing_nana') {
      const caller = CONFIG.familyMembers.find(m => m.id === data.callerId) || CONFIG.familyMembers[0];
      if (isRealAndroidTablet && isCurrentlyInNightWindow() && settings.nightBlockCalls) {
        incrementMissedCallForMember(caller.id);
        executeEndCallCleanup();
        return;
      }
      if (!act) return;

      // 1. Force Night Dimmer & Brightness Overlay completely out of the way so 1st tap ALWAYS answers
      if ($('night-dimmer')) $('night-dimmer').style.display = 'none';
      if ($('brightness-overlay')) {
        $('brightness-overlay').style.opacity = '0';
        $('brightness-overlay').style.pointerEvents = 'none';
      }
      window.wakeFromNightMode?.();
      window.wakeScreenAndResetDimTimer?.();

      // 2. Force Lenovo hardware speaker volume to ringVolume & screen brightness to 100%
      const rVol = Number(settings.ringVolume) || 85;
      window.AndroidBridge?.updateTabletHardwareSettings?.(rVol, 100, Number(settings.dimDelaySec ?? 120), Number(settings.speechRate) || 0.9);

      const img = $('caller-photo');
      img.onerror = () => { img.src = caller.fallback; };
      img.src = caller.photo;
      $('caller-title').innerText = `${caller.name} is calling!`;
      showScreen('ringing-screen');
      stopRingingUI();
      playSelectedRingtoneAudio(settings.ringtone, rVol);

      // 3. Report back to the caller's phone that Nana's tablet is awake and ringing out loud!
      if (!data.nanaRingingConfirmedAt) {
        update(refs.callState, { nanaRingingConfirmedAt: Date.now() }).catch(() => {});
      }

      if (settings.autoAnswer) {
        speakMsg(`${caller.spokenName} is calling you. Connecting automatically.`, false, rVol / 100);
        clearTimeout(autoAnswerTimeout);
        autoAnswerTimeout = setTimeout(() => { if (state.currentState === 'ringing_nana') window.answerCallAsNana(); }, 10000);
      } else {
        speakMsg(`${caller.spokenName} is calling you. Touch anywhere on the screen to answer.`, false, rVol / 100);
      }
      ringInterval = setInterval(() => {
        playSelectedRingtoneAudio(settings.ringtone, rVol);
        speakMsg(`${caller.spokenName} is calling you. Touch the green button to answer.`, false, rVol / 100);
      }, 6000);
      clearTimeout(incomingRingTimeout);
      incomingRingTimeout = setTimeout(async () => {
        if (state.currentState === 'ringing_nana') {
          await incrementMissedCallForMember(caller.id);
          await executeEndCallCleanup();
        }
      }, (Number(settings.ringDurationSec) || 60) * 1000);
    } else if (data.status === 'connected') {
      if ($('night-dimmer')) $('night-dimmer').style.display = 'none';
      if ($('brightness-overlay')) {
        $('brightness-overlay').style.opacity = '0';
        $('brightness-overlay').style.pointerEvents = 'none';
      }
      window.wakeScreenAndResetDimTimer?.();
      clearTimeout(outboundTimeout);
      clearTimeout(incomingRingTimeout);
      clearTimeout(autoAnswerTimeout);
      stopTelegramRingBurst();
      stopRingingUI();
      const partnerId = data.callerId === 'nana' ? data.targetId : data.callerId;
      if (partnerId && act) clearMissedCallsForMember(partnerId);
      if (act) { showScreen('call-screen'); joinDailyRoom(); }
      else showScreen('grid-screen');
    } else if (data.status === 'idle') {
      clearTimeout(outboundTimeout);
      clearTimeout(incomingRingTimeout);
      clearTimeout(autoAnswerTimeout);
      stopTelegramRingBurst();
      stopRingingUI();
      destroyDailyRoom();
      if (state.returnToVideoAfterCall) {
        state.returnToVideoAfterCall = false;
        showScreen('video-screen');
        hooks.openVideoScreen?.();
      } else if (!state.isRadioPlaying && !$('video-screen')?.classList.contains('active')) {
        showScreen('grid-screen');
      }
      window.wakeScreenAndResetDimTimer?.();
      updateClock();
      window.refreshNanaQuestionPopup?.();
    }
  } else {
    const isMyCall = (data.callerId === activeFamilyMember.id || data.targetId === activeFamilyMember.id);
    if (data.status === 'calling_family' && data.targetId === activeFamilyMember.id) {
      showScreen('family-pickup-screen');
    } else if (data.status === 'connected' && isMyCall && isActiveFamilyTab) {
      showScreen('call-screen');
      joinDailyRoom();
    } else if (data.status === 'ringing_nana' && isMyCall && isActiveFamilyTab) {
      showScreen('call-screen');
      const b = $('call-connecting-banner');
      if (b) {
        b.style.display = 'block';
        b.innerText = data.nanaRingingConfirmedAt
          ? '🔊 Ringing out loud on Nana\'s tablet! Waiting for her to answer...'
          : '🔔 Calling Nana\'s tablet...';
      }
    } else {
      if (callObject || isJoiningOrInRoom) destroyDailyRoom();
      showScreen('family-screen');
    }
  }
});

// --- 8. INITIALIZATION ---
if (role === 'family') {
  if ($('family-greeting')) $('family-greeting').innerText = `Call Nana (as ${activeFamilyMember.name})`;
  const img = $('family-self-photo');
  if (img) {
    img.onerror = () => { img.src = activeFamilyMember.fallback; };
    img.src = activeFamilyMember.photo;
  }
  if ($('telegram-link-btn')) $('telegram-link-btn').href = `https://t.me/${CONFIG.telegramBotUsername}?start=${activeFamilyMember.id}_${SERVICE_TOKEN}`;
  if ($('family-controls-btn')) $('family-controls-btn').style.display = isAdminFamilyMember ? 'inline-block' : 'none';
  if ($('in-call-settings-btn')) $('in-call-settings-btn').style.display = isAdminFamilyMember ? 'inline-block' : 'none';
  window.syncConnectedFamilyFromTelegram();
  showScreen(autoAnswerFromTelegram ? 'family-pickup-screen' : 'family-screen');
} else {
  renderContacts(state.connectedMemberIds);
  window.syncConnectedFamilyFromTelegram();
  showScreen('grid-screen');
  setInterval(updateClock, 10000);
  updateClock();
  window.wakeScreenAndResetDimTimer?.();
}

if (!document.querySelector('.screen.active')) {
  showScreen(role === 'family' ? 'family-screen' : 'grid-screen');
}
