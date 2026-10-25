import { $, NanaCore, set, update, onValue } from "./nana-core.js?v=2.9.3";

(function initNanaVideo() {
  if (!NanaCore.SERVICE_TOKEN) return;
  const { role, senderName, refs, state, hooks } = NanaCore;
  const canEditQueue = (role === 'family');
  const videoEl = $('nana-video-el');

  // CRITICAL FIX 1: Remove crossorigin="anonymous" so external MKV/MP4 servers without CORS headers aren't blocked!
  if (videoEl) {
    videoEl.removeAttribute('crossorigin');
  }

  if (canEditQueue && $('btn-toggle-admin-drawer')) {
    $('btn-toggle-admin-drawer').style.display = 'block';
  }

  let videoVolume = 80;
  let editingQueueIndex = null;
  let lastLoadedVideoUrl = "", lastLoadedSubUrl = "", activeSubBlobUrl = null;
  let lastSavedTimeSec = 0, screenWakeLock = null;

  function isNanaVideoActivelyPlaying() {
    return !!(role === 'nana' && videoEl && !videoEl.paused && !videoEl.ended && $('video-screen')?.classList.contains('active'));
  }
  NanaCore.isNanaVideoActivelyPlaying = isNanaVideoActivelyPlaying;

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

  function keepScreenAwakeIfPlayingVideo() {
    if (!isNanaVideoActivelyPlaying()) return;
    const overlay = $('brightness-overlay');
    if (overlay) { overlay.style.opacity = '0'; overlay.style.pointerEvents = 'none'; }
    if ($('night-dimmer') && $('night-dimmer').style.display !== 'none') window.wakeFromNightMode?.();
    window.wakeScreenAndResetDimTimer?.();
  }

  function startNormalDimCountdownOnPause() {
    releaseVideoWakeLock();
    window.wakeScreenAndResetDimTimer?.();
  }
  hooks.startNormalDimCountdownOnPause = startNormalDimCountdownOnPause;

  setInterval(() => { if (isNanaVideoActivelyPlaying()) keepScreenAwakeIfPlayingVideo(); }, 5000);

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

  function getCurrentQueueItem(data = state.streamData) {
    if (!data.queue || !data.queue.length) return null;
    const idx = Math.max(0, Math.min(data.queue.length - 1, Number(data.currentIndex) || 0));
    return { item: data.queue[idx], index: idx, total: data.queue.length };
  }
  NanaCore.getCurrentQueueItem = getCurrentQueueItem;

  function getSavedTimeForItem(item, idx, data = state.streamData) {
    if (!item) return 0;
    const localSec = item.url ? Number(localStorage.getItem(`nana_vid_pos_${item.url}`) || 0) : 0;
    const byId = Number(data.savedTimes?.[item.id] ?? data.savedTimes?.[idx] ?? 0);
    return Math.max(localSec, byId);
  }

  function getViewCountForItem(item, data = state.streamData) {
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
    await update(refs.settings, { videoVolume: nextVol });
  };

  onValue(refs.settings, snap => {
    const s = snap.val();
    if (s && s.videoVolume !== undefined) applyVideoVolume(s.videoVolume);
  });

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

  window.openVideoScreen = () => {
    if ($('bulletin-modal')?.style.display === 'flex') window.closeFamilyBulletin?.();
    window.stopRadioAndSync?.(true);
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    $('video-screen')?.classList.add('active');
    window.wakeScreenAndResetDimTimer?.();
    update(refs.presence, { online: true, lastActivity: "Opened Video Player", currentScreen: "video_paused", lastTouched: Date.now() }).catch(() => {});
    syncVideoUI();
  };
  hooks.openVideoScreen = window.openVideoScreen;

  function saveCurrentVideoTime(force = false) {
    const curItem = getCurrentQueueItem();
    if (!videoEl || !curItem) return;
    const cur = Math.floor(videoEl.currentTime || 0);
    if (cur > 0 && (force || Math.abs(cur - lastSavedTimeSec) >= 4)) {
      lastSavedTimeSec = cur;
      localStorage.setItem(`nana_vid_pos_${curItem.item.url}`, String(cur));
      if (!state.streamData.savedTimes) state.streamData.savedTimes = {};
      state.streamData.savedTimes[curItem.item.id] = cur;
      if (role === 'nana') {
        update(refs.videoStream, { [`savedTimes/${curItem.item.id}`]: cur, updatedAt: Date.now() }).catch(() => {});
      }
    }
  }

  function syncVideoUI(customStatusMessage = null) {
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
      if (sub) sub.innerText = 'Family can add videos from their phone (Entertainment tab)';
    } else if (playing && !customStatusMessage) {
      overlay?.classList.add('playing-hidden');
    } else {
      overlay?.classList.remove('playing-hidden');
      const rem = getSavedTimeForItem(curItem.item, curItem.index);
      const mins = Math.floor(rem / 60), secs = String(rem % 60).padStart(2, '0');
      if (icon) icon.innerText = customStatusMessage ? '⏳' : '▶️';
      if (main) {
        main.innerText = customStatusMessage
          || (rem > 2 ? `${curItem.item.title || 'Video'} — Paused at ${mins}:${secs}` : `Ready: ${curItem.item.title || 'Video'} (${curItem.index + 1} of ${curItem.total})`);
      }
      if (sub) sub.innerText = 'Tap anywhere on the video screen or press Play Video below';
    }
    if (btn) {
      btn.innerText = playing ? '⏸️ Pause Video' : '▶️ Play Video';
      btn.style.background = playing ? '#b45309' : '#059669';
      btn.style.borderColor = playing ? '#fde047' : '#4ade80';
    }
  }

  function pauseVideoAndSavePosition(reason = 'manual') {
    if (!videoEl || videoEl.paused) {
      startNormalDimCountdownOnPause();
      if (role === 'nana' && state.streamData.state === 'playing') {
        update(refs.videoStream, { state: 'paused', pauseReason: reason, updatedAt: Date.now() }).catch(() => {});
      }
      hooks.broadcastScreen?.();
      return;
    }
    saveCurrentVideoTime(true);
    videoEl.pause();
    syncVideoUI();
    startNormalDimCountdownOnPause();
    hooks.broadcastScreen?.();
    const curItem = getCurrentQueueItem();
    if (role === 'nana' && curItem) {
      update(refs.videoStream, {
        state: 'paused',
        [`savedTimes/${curItem.item.id}`]: Math.floor(videoEl.currentTime || 0),
        pauseReason: reason,
        updatedAt: Date.now()
      }).catch(() => {});
    }
  }
  hooks.pauseVideo = pauseVideoAndSavePosition;

  // CRITICAL FIX 2 & 3: Synchronously invoke videoEl.play() inside the tap gesture (no await before .play()!)
  function startOrResumeVideo() {
    const curItem = getCurrentQueueItem();
    if (!videoEl || !curItem || !curItem.item.url) {
      syncVideoUI('No video URL in queue yet — add one in Family Entertainment tab');
      return;
    }
    window.stopRadioAndSync?.(false);

    const { item, index } = curItem;
    videoEl.removeAttribute('crossorigin');

    if (lastLoadedVideoUrl !== item.url || !videoEl.getAttribute('src')) {
      lastLoadedVideoUrl = item.url;
      videoEl.src = item.url;
    }

    // Load subtitles asynchronously in the background so we never block the synchronous tap gesture
    attachSubtitleTrack(item.subtitleUrl || '');

    const targetResume = getSavedTimeForItem(item, index);
    const applySeek = () => {
      if (targetResume > 2 && Math.abs((videoEl.currentTime || 0) - targetResume) > 3) {
        try { videoEl.currentTime = targetResume; } catch (_) {}
      }
      if (videoEl.textTracks?.[0]) videoEl.textTracks[0].mode = 'showing';
    };

    if (videoEl.readyState >= 1) {
      applySeek();
    } else {
      syncVideoUI(`⏳ Loading "${item.title || 'Video'}"...`);
      videoEl.addEventListener('loadedmetadata', applySeek, { once: true });
    }

    applyVideoVolume(videoVolume);
    videoEl.muted = false;

    const playPromise = videoEl.play();
    if (playPromise !== undefined) {
      playPromise.then(() => {
        requestVideoWakeLock();
        keepScreenAwakeIfPlayingVideo();
        syncVideoUI();
        hooks.broadcastScreen?.();
        if (role === 'nana') {
          update(refs.videoStream, {
            state: 'playing',
            currentIndex: index,
            [`savedTimes/${item.id}`]: Math.floor(videoEl.currentTime || targetResume || 0),
            updatedAt: Date.now()
          }).catch(() => {});
        }
      }).catch((err) => {
        console.warn("Video play interrupted or blocked:", err);
        syncVideoUI();
        startNormalDimCountdownOnPause();
        if (role === 'nana') {
          update(refs.videoStream, { state: 'paused', pauseReason: 'autoplay_blocked', updatedAt: Date.now() }).catch(() => {});
          hooks.broadcastScreen?.();
        }
      });
    }
  }

  window.handleVideoStageTap = (ev) => {
    if (ev) ev.stopPropagation();
    const curItem = getCurrentQueueItem();
    if (!videoEl || !curItem) {
      syncVideoUI('No video in queue yet');
      return;
    }
    if (!videoEl.paused) pauseVideoAndSavePosition('screen_touch');
    else startOrResumeVideo();
  };

  window.toggleNanaVideoPlayback = () => {
    const curItem = getCurrentQueueItem();
    if (!videoEl || !curItem) {
      syncVideoUI('No video in queue yet');
      return;
    }
    if (!videoEl.paused) pauseVideoAndSavePosition('button_tap');
    else startOrResumeVideo();
  };

  window.restartNanaVideoFromBeginning = () => {
    const curItem = getCurrentQueueItem();
    if (!videoEl || !curItem) return;
    localStorage.setItem(`nana_vid_pos_${curItem.item.url}`, '0');
    if (state.streamData.savedTimes) state.streamData.savedTimes[curItem.item.id] = 0;
    try { videoEl.currentTime = 0; } catch (_) {}
    startOrResumeVideo();
  };

  async function handleVideoEndedOnNana() {
    startNormalDimCountdownOnPause();
    const curItem = getCurrentQueueItem();
    if (!curItem) return;
    localStorage.setItem(`nana_vid_pos_${curItem.item.url}`, '0');
    if (state.streamData.savedTimes) state.streamData.savedTimes[curItem.item.id] = 0;

    const newViewCount = getViewCountForItem(curItem.item) + 1;
    if (!state.streamData.viewCounts) state.streamData.viewCounts = {};
    state.streamData.viewCounts[curItem.item.id] = newViewCount;

    const nextIndex = (curItem.index + 1) % curItem.total;
    const nextItem = state.streamData.queue[nextIndex];
    localStorage.setItem(`nana_vid_pos_${nextItem.url}`, '0');

    await update(refs.videoStream, {
      state: 'paused',
      [`savedTimes/${curItem.item.id}`]: 0,
      [`savedTimes/${nextItem.id}`]: 0,
      [`viewCounts/${curItem.item.id}`]: newViewCount,
      updatedAt: Date.now()
    }).catch(() => {});

    syncVideoUI();
    hooks.broadcastScreen?.();

    const nextTitle = nextItem.title || `Video ${nextIndex + 1}`;
    const promptText = curItem.total > 1
      ? `That video has finished. Would you like to watch the next video: "${nextTitle}"?`
      : `That video has finished. Would you like to watch "${nextTitle}" again?`;

    await set(refs.quickQuestion, {
      id: `q_nextvid_${Date.now()}`,
      type: 'next_video_prompt',
      nextIndex,
      question: promptText,
      askedBy: 'Video Player',
      silent: !state.speakQuestionsDefault,
      status: 'pending',
      answer: null,
      askedAt: Date.now()
    });
  }

  if (videoEl) {
    videoEl.addEventListener('timeupdate', () => { saveCurrentVideoTime(false); keepScreenAwakeIfPlayingVideo(); });
    videoEl.addEventListener('playing', () => { syncVideoUI(); hooks.broadcastScreen?.(); });
    videoEl.addEventListener('pause', () => { syncVideoUI(); startNormalDimCountdownOnPause(); hooks.broadcastScreen?.(); });
    videoEl.addEventListener('play', () => { requestVideoWakeLock(); keepScreenAwakeIfPlayingVideo(); syncVideoUI(); hooks.broadcastScreen?.(); });
    videoEl.addEventListener('ended', () => { if (role === 'nana') handleVideoEndedOnNana(); });
    videoEl.addEventListener('error', () => {
      syncVideoUI('⚠️ Could not load video file — check video URL or format');
    });
  }

  // Admin Drawer & Queue Management
  window.toggleAdminVideoDrawer = (forceOpen = null) => {
    const drawer = $('fam-admin-video-editor'), btn = $('btn-toggle-admin-drawer');
    if (!drawer) return;
    const nextOpen = forceOpen !== null ? forceOpen : (drawer.style.display === 'none');
    drawer.style.display = nextOpen ? 'block' : 'none';
    if (btn) btn.innerText = nextOpen ? '🔼 Hide Add / Edit & Sort Controls' : '➕ Add / Edit Video Links & Sort Queue ▾';
  };

  window.sortVideoQueue = async (mode) => {
    if (!canEditQueue) return;
    const q = [...(state.streamData.queue || [])];
    if (q.length < 2) return;
    if (editingQueueIndex !== null) window.cancelEditQueueItem();

    const activeId = q[state.streamData.currentIndex || 0]?.id;
    q.sort((a, b) => {
      if (mode === 'alpha_asc') return (a.title || '').localeCompare(b.title || '', undefined, { numeric: true, sensitivity: 'base' });
      if (mode === 'alpha_desc') return (b.title || '').localeCompare(a.title || '', undefined, { numeric: true, sensitivity: 'base' });
      const vA = getViewCountForItem(a), vB = getViewCountForItem(b);
      if (mode === 'views_asc') return vA !== vB ? vA - vB : (a.title || '').localeCompare(b.title || '');
      if (mode === 'views_desc') return vB !== vA ? vB - vA : (a.title || '').localeCompare(b.title || '');
      return 0;
    });

    const newActiveIndex = activeId ? Math.max(0, q.findIndex(item => item.id === activeId)) : 0;
    await update(refs.videoStream, { queue: q, currentIndex: newActiveIndex, updatedBy: senderName, updatedAt: Date.now() });
  };

  function setEditFormUI(isEditing, idx = null) {
    if (!canEditQueue) return;
    editingQueueIndex = isEditing ? idx : null;
    if (isEditing) window.toggleAdminVideoDrawer(true);
    if ($('fam-vid-add-row')) $('fam-vid-add-row').style.display = isEditing ? 'none' : 'flex';
    if ($('fam-vid-edit-row')) $('fam-vid-edit-row').style.display = isEditing ? 'flex' : 'none';
    if ($('fam-vid-form-heading')) $('fam-vid-form-heading').innerText = isEditing ? `✏️ Editing Video #${idx + 1}` : '🎬 Video Queue on Nana\'s Tablet';
    ['fam-vid-title', 'fam-vid-url', 'fam-vid-sub'].forEach(id => $(id)?.classList.toggle('editing-active', isEditing));
    renderFamilyQueueUI();
  }

  window.editQueueIndex = (idx) => {
    if (!canEditQueue) return;
    const item = state.streamData.queue?.[idx];
    if (!item) return;
    if ($('fam-vid-title')) $('fam-vid-title').value = item.title || '';
    if ($('fam-vid-url')) $('fam-vid-url').value = item.url || '';
    if ($('fam-vid-sub')) $('fam-vid-sub').value = item.subtitleUrl || '';
    setEditFormUI(true, idx);
    $('fam-vid-url')?.focus();
  };

  window.cancelEditQueueItem = () => {
    if (!canEditQueue) return;
    if ($('fam-vid-title')) $('fam-vid-title').value = '';
    if ($('fam-vid-url')) $('fam-vid-url').value = '';
    if ($('fam-vid-sub')) $('fam-vid-sub').value = '';
    setEditFormUI(false, null);
  };

  window.saveEditedQueueItem = async () => {
    if (!canEditQueue) return;
    const idx = editingQueueIndex;
    const q = [...(state.streamData.queue || [])];
    if (idx === null || !q[idx]) return window.cancelEditQueueItem();

    const newUrl = ($('fam-vid-url')?.value || '').trim();
    const newSub = ($('fam-vid-sub')?.value || '').trim();
    const newTitle = ($('fam-vid-title')?.value || '').trim() || `Video ${idx + 1}`;
    if (!newUrl) return alert("Please enter a valid video URL (.mkv or .mp4)");

    const prevItem = q[idx];
    const urlChanged = prevItem.url !== newUrl;
    q[idx] = { ...prevItem, title: newTitle, url: newUrl, subtitleUrl: newSub };

    const nextSavedTimes = { ...(state.streamData.savedTimes || {}) };
    if (urlChanged && prevItem.id) {
      nextSavedTimes[prevItem.id] = 0;
      localStorage.removeItem(`nana_vid_pos_${prevItem.url}`);
      localStorage.removeItem(`nana_vid_pos_${newUrl}`);
    }

    window.cancelEditQueueItem();
    await update(refs.videoStream, { queue: q, savedTimes: nextSavedTimes, updatedBy: senderName, updatedAt: Date.now() });
  };

  function renderFamilyQueueUI() {
    const box = $('fam-queue-container');
    if (!box) return;
    box.innerHTML = '';
    const q = state.streamData.queue || [];
    if (!q.length) {
      box.innerHTML = `<div style="color:#94a3b8;font-size:0.85rem;padding:6px;">No videos in queue yet.</div>`;
      return;
    }
    const isTrulyPlayingOnTablet = state.presenceSnap?.currentScreen === 'video_playing';
    q.forEach((item, idx) => {
      const isCur = idx === state.streamData.currentIndex;
      const isEditingThis = canEditQueue && idx === editingQueueIndex;
      const isPlayingNow = isCur && isTrulyPlayingOnTablet;
      const savedSec = getSavedTimeForItem(item, idx);
      const views = getViewCountForItem(item);
      const timeTag = savedSec > 0 ? ` (${Math.floor(savedSec / 60)}:${String(savedSec % 60).padStart(2, '0')})` : '';
      const row = document.createElement('div');
      row.className = `fam-queue-item${isCur ? ' active-q' : ''}${isEditingThis ? ' editing-q' : ''}`;

      const adminBtns = canEditQueue ? `
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
        <div class="fam-q-title" onclick="selectQueueIndex(${idx}, ${!canEditQueue})">
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
    if (!canEditQueue) return;
    const url = ($('fam-vid-url')?.value || '').trim();
    const subUrl = ($('fam-vid-sub')?.value || '').trim();
    const rawTitle = ($('fam-vid-title')?.value || '').trim();
    if (!url) return alert("Please enter a valid video URL (.mkv or .mp4)");

    const q = [...(state.streamData.queue || [])];
    const title = rawTitle || `Video ${q.length + 1}`;
    const id = `vid_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    q.push({ id, title, url, subtitleUrl: subUrl, views: 0 });

    const newIndex = playImmediately ? (q.length - 1) : (state.streamData.currentIndex || 0);
    await set(refs.videoStream, {
      queue: q,
      currentIndex: newIndex,
      state: playImmediately ? 'playing' : (state.streamData.state || 'paused'),
      savedTimes: state.streamData.savedTimes || {},
      viewCounts: state.streamData.viewCounts || {},
      updatedBy: senderName,
      updatedAt: Date.now()
    });

    if ($('fam-vid-title')) $('fam-vid-title').value = '';
    if ($('fam-vid-url')) $('fam-vid-url').value = '';
    if ($('fam-vid-sub')) $('fam-vid-sub').value = '';
  };

  window.selectQueueIndex = async (idx, startPlaying = true) => {
    const q = state.streamData.queue || [];
    if (!q[idx]) return;
    await update(refs.videoStream, { currentIndex: idx, state: startPlaying ? 'playing' : 'paused', updatedBy: senderName, updatedAt: Date.now() });
  };
  window.playQueueIndex = (idx) => window.selectQueueIndex(idx, true);

  window.moveQueueItem = async (idx, direction) => {
    if (!canEditQueue) return;
    const q = [...(state.streamData.queue || [])];
    const targetIdx = idx + direction;
    if (targetIdx < 0 || targetIdx >= q.length) return;
    if (editingQueueIndex !== null) window.cancelEditQueueItem();

    const activeId = q[state.streamData.currentIndex || 0]?.id;
    const temp = q[idx]; q[idx] = q[targetIdx]; q[targetIdx] = temp;
    const newActiveIndex = activeId ? Math.max(0, q.findIndex(item => item.id === activeId)) : 0;

    await update(refs.videoStream, { queue: q, currentIndex: newActiveIndex, updatedBy: senderName, updatedAt: Date.now() });
  };

  window.removeQueueIndex = async (idx) => {
    if (!canEditQueue) return;
    const q = [...(state.streamData.queue || [])];
    if (!q[idx]) return;
    if (editingQueueIndex === idx) window.cancelEditQueueItem();
    const removed = q.splice(idx, 1)[0];
    let nextIdx = state.streamData.currentIndex || 0;
    if (idx < nextIdx) nextIdx = Math.max(0, nextIdx - 1);
    if (nextIdx >= q.length) nextIdx = 0;

    const nextSavedTimes = { ...(state.streamData.savedTimes || {}) };
    const nextViewCounts = { ...(state.streamData.viewCounts || {}) };
    if (removed?.id) { delete nextSavedTimes[removed.id]; delete nextViewCounts[removed.id]; }

    await set(refs.videoStream, {
      queue: q,
      currentIndex: nextIdx,
      state: q.length ? state.streamData.state : 'paused',
      savedTimes: nextSavedTimes,
      viewCounts: nextViewCounts,
      updatedBy: senderName,
      updatedAt: Date.now()
    });
  };

  window.remoteCommandVideo = async (cmd) => {
    const q = state.streamData.queue || [];
    if (!q.length) {
      if (canEditQueue) {
        const typedUrl = ($('fam-vid-url')?.value || '').trim();
        if (typedUrl) return window.addVideoToQueue(cmd === 'play');
      }
      return alert("No videos in the queue yet.");
    }
    let nextIndex = state.streamData.currentIndex || 0;
    let nextState = state.streamData.state || 'paused';
    if (cmd === 'play') nextState = 'playing';
    else if (cmd === 'pause') nextState = 'paused';
    else if (cmd === 'next') nextIndex = (nextIndex + 1) % q.length;
    else if (cmd === 'prev') nextIndex = (nextIndex - 1 + q.length) % q.length;

    await update(refs.videoStream, { currentIndex: nextIndex, state: nextState, updatedBy: senderName, updatedAt: Date.now() });
  };

  onValue(refs.videoStream, snap => {
    const prevItem = getCurrentQueueItem();
    state.streamData = normalizeStreamData(snap.val());
    const curItem = getCurrentQueueItem();

    if (role === 'family') {
      renderFamilyQueueUI();
      hooks.refreshFamilyPresence?.();
      const st = $('fam-vid-status');
      if (st) {
        if (!curItem) { st.innerText = 'Queue Empty'; st.style.color = '#94a3b8'; }
        else {
          const isTrulyPlaying = state.presenceSnap?.currentScreen === 'video_playing';
          const sec = getSavedTimeForItem(curItem.item, curItem.index);
          const mins = Math.floor(sec / 60), secs = String(sec % 60).padStart(2, '0');
          st.innerText = isTrulyPlaying
            ? `▶️ Playing #${curItem.index + 1}: ${curItem.item.title} (${mins}:${secs})`
            : `⏸️ Cued #${curItem.index + 1}: ${curItem.item.title} (${mins}:${secs})`;
          st.style.color = isTrulyPlaying ? '#4ade80' : '#fbbf24';
        }
      }
    } else if (role === 'nana') {
      const urlChanged = prevItem?.item?.url !== curItem?.item?.url;
      const subChanged = prevItem?.item?.subtitleUrl !== curItem?.item?.subtitleUrl;
      const idChanged  = prevItem?.item?.id !== curItem?.item?.id;
      if (curItem && (urlChanged || idChanged) && videoEl) {
        videoEl.removeAttribute('crossorigin');
        lastLoadedVideoUrl = curItem.item.url;
        videoEl.src = curItem.item.url;
        attachSubtitleTrack(curItem.item.subtitleUrl || '', true);
      } else if (curItem && subChanged && videoEl) {
        attachSubtitleTrack(curItem.item.subtitleUrl || '', true);
      }
      if (state.streamData.state === 'playing' && curItem) {
        if (!$('video-screen')?.classList.contains('active')) window.openVideoScreen();
        if (videoEl?.paused || urlChanged || idChanged) startOrResumeVideo();
      } else if (state.streamData.state === 'paused') {
        if (videoEl && !videoEl.paused) videoEl.pause();
        else startNormalDimCountdownOnPause();
      }
      syncVideoUI();
    }
  });
})();
