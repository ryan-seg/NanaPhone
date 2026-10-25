import { $, NanaCore, set, update, onValue } from "./nana-core.js?v=2.9.2";

(function initNanaVideo() {
  if (!NanaCore.SERVICE_TOKEN) return;
  const { role, refs, state, hooks } = NanaCore;
  const videoEl = $('nana-video-el');

  let editingQueueIndex = -1;
  let lastSavedTimeSec = 0;
  let controlsHideTimer = null;

  // TorBox & stream resolution state
  let activeResolvedUrlForSlot = '';
  let activeRawUrlForSlot = '';
  let resolvedUrlFetchedAtMs = 0;
  let isResolvingVideoUrl = false;

  // --- 1. QUEUE HELPERS & TIME PERSISTENCE ---
  function normalizeQueueData(raw) {
    if (!raw) return { queue: [], currentIndex: 0, state: 'paused', savedTimes: {}, viewCounts: {} };
    let q = [];
    if (Array.isArray(raw.queue)) {
      q = raw.queue.filter(Boolean);
    } else if (raw.queue && typeof raw.queue === 'object') {
      q = Object.values(raw.queue).filter(Boolean);
    } else if (raw.url) {
      q = [{ id: 'legacy_1', title: raw.title || 'Family Video', url: raw.url, subtitleUrl: raw.subtitleUrl || '' }];
    }
    q = q.map((item, idx) => ({
      id: item.id || `vid_${idx}_${ btoa(unescape(encodeURIComponent(item.url || ''))).slice(0, 10) }`,
      title: (item.title || `Video #${idx + 1}`).trim(),
      url: (item.url || '').trim(),
      subtitleUrl: (item.subtitleUrl || '').trim()
    })).filter(item => item.url);

    const maxIdx = Math.max(0, q.length - 1);
    const curIdx = Math.min(maxIdx, Math.max(0, Number(raw.currentIndex) || 0));
    return {
      queue: q,
      currentIndex: curIdx,
      state: raw.state || 'paused',
      savedTimes: raw.savedTimes || {},
      viewCounts: raw.viewCounts || {},
      updatedAt: raw.updatedAt || 0
    };
  }

  function getCurrentQueueItem() {
    const q = state.streamData?.queue || [];
    if (!q.length) return null;
    const idx = Math.min(q.length - 1, Math.max(0, Number(state.streamData.currentIndex) || 0));
    return { item: q[idx], index: idx, total: q.length };
  }
  NanaCore.getCurrentQueueItem = getCurrentQueueItem;

  function isNanaVideoActivelyPlaying() {
    return !!(
      $('video-screen')?.classList.contains('active') &&
      videoEl &&
      !videoEl.paused &&
      !videoEl.ended &&
      videoEl.readyState >= 2
    );
  }
  NanaCore.isNanaVideoActivelyPlaying = isNanaVideoActivelyPlaying;

  function getSavedTimeForItem(item, index) {
    if (!item) return 0;
    const fbSec = Number(state.streamData?.savedTimes?.[item.id] || 0);
    const localSec = Number(localStorage.getItem(`nana_vid_pos_${item.url}`) || 0);
    if (index === 0 && !fbSec && !localSec && state.streamData?.currentTime) {
      return Number(state.streamData.currentTime) || 0;
    }
    return Math.max(fbSec, localSec, 0);
  }

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
        const isPlayingNow = !videoEl.paused && !videoEl.ended && $('video-screen')?.classList.contains('active');
        update(refs.videoStream, {
          state: isPlayingNow ? 'playing' : state.streamData.state,
          [`savedTimes/${curItem.item.id}`]: cur,
          updatedAt: Date.now()
        }).catch(() => {});
        if (isPlayingNow) {
          update(refs.presence, {
            online: true,
            currentScreen: 'video_playing',
            lastActivity: `Watching ${curItem.item.title || 'Video'}`,
            lastPing: Date.now()
          }).catch(() => {});
        }
      }
    }
  }

  // --- 2. TORBOX PERMALINK RESOLVER & SUBTITLE TRACK HANDLER ---
  async function resolvePlayableVideoUrl(rawUrl) {
    if (!rawUrl) return '';
    const trimmed = rawUrl.trim();

    // If it's a TorBox requestdl permalink, fetch JSON with redirect=false to get a fresh direct CDN URL
    if (trimmed.includes('api.torbox.app') && trimmed.includes('/requestdl')) {
      try {
        const u = new URL(trimmed);
        u.searchParams.set('redirect', 'false');
        const res = await fetch(u.toString(), { method: 'GET', cache: 'no-store' });
        const json = await res.json();
        if (json && json.data && typeof json.data === 'string' && json.data.startsWith('http')) {
          return json.data;
        }
      } catch (err) {
        console.warn('TorBox JSON resolve failed, falling back to redirect=true URL:', err);
      }
      return trimmed.includes('redirect=') ? trimmed : `${trimmed}&redirect=true`;
    }

    return trimmed;
  }

  function applySubtitleTrack(subUrl) {
    if (!videoEl) return;
    videoEl.querySelectorAll('track').forEach(t => t.remove());
    if (subUrl && subUrl.trim()) {
      videoEl.setAttribute('crossorigin', 'anonymous');
      const tr = document.createElement('track');
      tr.kind = 'subtitles';
      tr.label = 'English';
      tr.srclang = 'en';
      tr.src = subUrl.trim();
      tr.default = true;
      videoEl.appendChild(tr);
      if (videoEl.textTracks && videoEl.textTracks[0]) {
        videoEl.textTracks[0].mode = 'showing';
      }
    } else {
      // Remove crossorigin when no external subtitles are used so TorBox CDN streams are never blocked by CORS
      videoEl.removeAttribute('crossorigin');
    }
  }

  // --- 3. NANA VIDEO CONTROLS & PLAYBACK ENGINE ---
  function showNanaVideoControlsTemporarily() {
    const bar = $('nana-video-controls');
    if (!bar) return;
    bar.classList.remove('auto-hidden');
    clearTimeout(controlsHideTimer);
    if (videoEl && !videoEl.paused && !videoEl.ended) {
      controlsHideTimer = setTimeout(() => {
        if (videoEl && !videoEl.paused && !videoEl.ended) {
          bar.classList.add('auto-hidden');
        }
      }, 4500);
    }
  }

  function updateNanaVideoControlsUI() {
    const curItem = getCurrentQueueItem();
    const titleBanner = $('nana-video-title-banner');
    const playPauseBtn = $('nana-vid-playpause-btn');
    const statusLbl = $('nana-video-status-lbl');

    if (titleBanner) {
      titleBanner.textContent = curItem
        ? `🎬 ${curItem.item.title} (${curItem.index + 1} of ${curItem.total})`
        : '🎬 Family Video Player';
    }

    if (!videoEl || !curItem) {
      if (playPauseBtn) playPauseBtn.innerHTML = '▶️ Play Video';
      if (statusLbl) statusLbl.textContent = 'No video in queue';
      return;
    }

    const isPlaying = !videoEl.paused && !videoEl.ended;
    if (playPauseBtn) {
      playPauseBtn.innerHTML = isPlaying ? '⏸️ Pause Video' : '▶️ Play Video';
      playPauseBtn.style.background = isPlaying ? '#f59e0b' : '#22c55e';
      playPauseBtn.style.color = '#000';
    }

    if (statusLbl && !isResolvingVideoUrl) {
      const curSec = Math.floor(videoEl.currentTime || getSavedTimeForItem(curItem.item, curItem.index) || 0);
      const mins = Math.floor(curSec / 60), secs = String(curSec % 60).padStart(2, '0');
      statusLbl.textContent = isPlaying
        ? `▶️ Playing (${mins}:${secs})`
        : (curSec > 0 ? `⏸️ Paused at ${mins}:${secs}` : '⏸️ Ready to Play');
    }

    showNanaVideoControlsTemporarily();
  }

  async function startOrResumeVideo() {
    const curItem = getCurrentQueueItem();
    if (!videoEl || !curItem || !curItem.item?.url) return;
    if (isResolvingVideoUrl) return;

    const rawUrl = curItem.item.url.trim();
    const targetResume = getSavedTimeForItem(curItem.item, curItem.index);
    const lbl = $('nana-video-status-lbl');

    // Stop Classic FM if playing so audio doesn't overlap
    if (role === 'nana' && state.entSnap?.activeKey && state.entSnap.activeKey !== 'off') {
      set(refs.entertainment, { activeKey: 'off', timestamp: Date.now() }).catch(() => {});
    }

    const urlAgeMs = Date.now() - resolvedUrlFetchedAtMs;
    const needsFreshLoad =
      activeRawUrlForSlot !== rawUrl ||
      !activeResolvedUrlForSlot ||
      urlAgeMs > 90 * 60 * 1000 ||
      videoEl.error ||
      videoEl.networkState === HTMLMediaElement.NETWORK_NO_SOURCE ||
      !videoEl.getAttribute('src');

    if (needsFreshLoad) {
      isResolvingVideoUrl = true;
      if (lbl) lbl.textContent = '⏳ Loading video...';
      applySubtitleTrack(curItem.item.subtitleUrl);

      const playableUrl = await resolvePlayableVideoUrl(rawUrl);
      isResolvingVideoUrl = false;

      activeRawUrlForSlot = rawUrl;
      activeResolvedUrlForSlot = playableUrl;
      resolvedUrlFetchedAtMs = Date.now();

      videoEl.src = playableUrl;
      videoEl.load();
    }

    const seekAndPlay = () => {
      if (targetResume > 2 && Math.abs((videoEl.currentTime || 0) - targetResume) > 3) {
        try {
          const maxSeek = (videoEl.duration && isFinite(videoEl.duration)) ? Math.max(0, videoEl.duration - 5) : targetResume;
          videoEl.currentTime = Math.min(targetResume, maxSeek);
        } catch (_) {}
      }
      if (lbl) lbl.textContent = '⏳ Starting playback...';
      const playPromise = videoEl.play();
      if (playPromise !== undefined) {
        playPromise.then(() => {
          updateNanaVideoControlsUI();
          if (role === 'nana') {
            update(refs.videoStream, { state: 'playing', updatedAt: Date.now() }).catch(() => {});
            update(refs.presence, {
              online: true,
              currentScreen: 'video_playing',
              lastActivity: `Watching ${curItem.item.title || 'Video'}`,
              lastPing: Date.now()
            }).catch(() => {});
          }
        }).catch(err => {
          console.warn('Video play() rejected:', err);
          if (lbl) lbl.textContent = '▶️ Tap Big Green Play Button to Start';
          updateNanaVideoControlsUI();
        });
      }
    };

    if (videoEl.readyState >= 1) {
      seekAndPlay();
    } else {
      if (lbl) lbl.textContent = '⏳ Loading video stream...';
      let metadataTimeout = null;
      const onMeta = () => {
        clearTimeout(metadataTimeout);
        videoEl.removeEventListener('error', onErr);
        seekAndPlay();
      };
      const onErr = () => {
        clearTimeout(metadataTimeout);
        videoEl.removeEventListener('loadedmetadata', onMeta);
        activeResolvedUrlForSlot = '';
        const errCode = videoEl.error ? videoEl.error.code : 0;
        if (lbl) {
          lbl.textContent = (errCode === 3 || errCode === 4)
            ? '⚠️ Video format unsupported (Needs MP4 / H.264)'
            : '⚠️ Video link error — tap Play to retry';
        }
      };
      videoEl.addEventListener('loadedmetadata', onMeta, { once: true });
      videoEl.addEventListener('error', onErr, { once: true });

      metadataTimeout = setTimeout(() => {
        videoEl.removeEventListener('loadedmetadata', onMeta);
        videoEl.removeEventListener('error', onErr);
        if (videoEl.readyState < 1) {
          activeResolvedUrlForSlot = '';
          if (lbl) lbl.textContent = '⚠️ Slow stream — tap Play to try again';
        }
      }, 12000);
    }
  }

  function pauseNanaVideoInternal(reason = 'manual') {
    if (!videoEl) return;
    if (!videoEl.paused) {
      saveCurrentVideoTime(true);
      videoEl.pause();
    }
    updateNanaVideoControlsUI();
    if (role === 'nana') {
      update(refs.videoStream, { state: 'paused', updatedAt: Date.now() }).catch(() => {});
      if ($('video-screen')?.classList.contains('active') && reason === 'manual') {
        update(refs.presence, { online: true, currentScreen: 'video_paused', lastPing: Date.now() }).catch(() => {});
      }
    }
  }
  hooks.pauseVideo = pauseNanaVideoInternal;

  window.openVideoScreen = () => {
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    $('video-screen')?.classList.add('active');
    if (typeof window.highlightNanaTopTab === 'function') window.highlightNanaTopTab('video');
    updateNanaVideoControlsUI();
    hooks.broadcastScreen?.();
  };

  window.closeVideoScreen = () => {
    pauseNanaVideoInternal('close_screen');
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    $('grid-screen')?.classList.add('active');
    if (typeof window.highlightNanaTopTab === 'function') window.highlightNanaTopTab('calls');
    hooks.broadcastScreen?.();
  };

  window.toggleNanaVideoPlayPause = () => {
    if (!videoEl) return;
    state.lastActivityOrCallMs = Date.now();
    window.wakeScreenAndResetDimTimer?.();
    if (videoEl.paused || videoEl.ended) {
      startOrResumeVideo();
    } else {
      pauseNanaVideoInternal('manual');
    }
  };

  window.rewindNanaVideo15s = () => {
    if (!videoEl) return;
    state.lastActivityOrCallMs = Date.now();
    try {
      videoEl.currentTime = Math.max(0, (videoEl.currentTime || 0) - 15);
      saveCurrentVideoTime(true);
    } catch (_) {}
    showNanaVideoControlsTemporarily();
  };

  // --- 4. RESTART VIDEO CONFIRMATION POP-UP FOR NANA ---
  let restartConfirmTimer = null;
  let wasPlayingBeforeRestartPrompt = false;

  function ensureRestartVideoConfirmModal() {
    let m = $('restart-video-confirm-modal');
    if (!m) {
      m = document.createElement('div');
      m.id = 'restart-video-confirm-modal';
      m.style.cssText = 'display:none;position:fixed;inset:0;background:rgba(9,13,22,0.93);z-index:10006;flex-direction:column;align-items:center;justify-content:center;padding:28px;text-align:center;';
      m.innerHTML = `
        <div style="background:#1e293b;border:6px solid #facc15;border-radius:30px;padding:30px 34px;max-width:680px;width:92vw;box-shadow:0 16px 40px rgba(0,0,0,0.85);display:flex;flex-direction:column;align-items:center;gap:18px;">
          <div style="font-size:clamp(1.8rem,3.2vw,2.4rem);font-weight:900;color:#fef08a;">⏮️ Start Episode From the Beginning?</div>
          <div id="restart-video-confirm-sub" style="font-size:clamp(1.2rem,2.1vw,1.55rem);color:#e2e8f0;font-weight:700;line-height:1.35;">
            Do you want to go back to the very start of this episode?
          </div>
          <div style="display:flex;gap:18px;width:100%;margin-top:8px;">
            <button class="confirm-btn" style="flex:1;background:#22c55e;color:#000;border:4px solid #fff;font-size:clamp(1.3rem,2.3vw,1.7rem);padding:20px 14px;border-radius:20px;font-weight:900;" onclick="cancelRestartNanaVideo()">▶️ No, Keep Watching</button>
            <button class="confirm-btn" style="flex:1;background:#dc2626;color:#fff;border:4px solid #fca5a5;font-size:clamp(1.3rem,2.3vw,1.7rem);padding:20px 14px;border-radius:20px;font-weight:900;" onclick="confirmRestartNanaVideoNow()">⏮️ Yes, Start Again</button>
          </div>
        </div>
      `;
      document.body.appendChild(m);
    }
    return m;
  }

  window.restartNanaVideoFromBeginning = () => {
    const curItem = getCurrentQueueItem();
    if (!videoEl || !curItem) return;

    if (role === 'nana') {
      wasPlayingBeforeRestartPrompt = !videoEl.paused;
      if (wasPlayingBeforeRestartPrompt) videoEl.pause();
      const modal = ensureRestartVideoConfirmModal();
      const subEl = $('restart-video-confirm-sub');
      if (subEl) {
        subEl.textContent = `Are you sure you want to restart "${curItem.item.title || 'this video'}" back to the very beginning?`;
      }
      modal.style.display = 'flex';
      clearTimeout(restartConfirmTimer);
      restartConfirmTimer = setTimeout(() => window.cancelRestartNanaVideo(), 12000);
      return;
    }

    window.confirmRestartNanaVideoNow();
  };

  window.cancelRestartNanaVideo = () => {
    clearTimeout(restartConfirmTimer);
    if ($('restart-video-confirm-modal')) $('restart-video-confirm-modal').style.display = 'none';
    if (wasPlayingBeforeRestartPrompt) {
      wasPlayingBeforeRestartPrompt = false;
      startOrResumeVideo();
    }
  };

  window.confirmRestartNanaVideoNow = () => {
    clearTimeout(restartConfirmTimer);
    wasPlayingBeforeRestartPrompt = false;
    if ($('restart-video-confirm-modal')) $('restart-video-confirm-modal').style.display = 'none';
    const curItem = getCurrentQueueItem();
    if (!videoEl || !curItem) return;
    lastSavedTimeSec = 0;
    localStorage.setItem(`nana_vid_pos_${curItem.item.url}`, '0');
    if (state.streamData.savedTimes) state.streamData.savedTimes[curItem.item.id] = 0;
    if (role === 'nana') {
      update(refs.videoStream, { [`savedTimes/${curItem.item.id}`]: 0, updatedAt: Date.now() }).catch(() => {});
    }
    try { videoEl.currentTime = 0; } catch (_) {}
    startOrResumeVideo();
  };

  // --- 5. VIDEO ELEMENT EVENT LISTENERS ---
  if (videoEl) {
    videoEl.addEventListener('timeupdate', () => {
      saveCurrentVideoTime(false);
      updateNanaVideoControlsUI();
    });

    videoEl.addEventListener('play', () => {
      updateNanaVideoControlsUI();
      hooks.broadcastScreen?.();
    });

    videoEl.addEventListener('pause', () => {
      if (!videoEl.ended) saveCurrentVideoTime(true);
      updateNanaVideoControlsUI();
      hooks.broadcastScreen?.();
    });

    videoEl.addEventListener('ended', async () => {
      const curItem = getCurrentQueueItem();
      if (!curItem) return;
      lastSavedTimeSec = 0;
      localStorage.setItem(`nana_vid_pos_${curItem.item.url}`, '0');
      try { videoEl.currentTime = 0; } catch (_) {}

      if (role === 'nana') {
        const curViews = Number(state.streamData?.viewCounts?.[curItem.item.id] || 0) + 1;
        const nextIdx = (curItem.index + 1) % curItem.total;
        const nextItem = state.streamData.queue[nextIdx];

        await update(refs.videoStream, {
          state: 'paused',
          [`savedTimes/${curItem.item.id}`]: 0,
          [`viewCounts/${curItem.item.id}`]: curViews,
          updatedAt: Date.now()
        }).catch(() => {});

        const promptText = curItem.total > 1
          ? `That episode has finished. Would you like to watch the next video: "${nextItem.title}"?`
          : `That video has finished. Would you like to watch "${curItem.item.title}" again?`;

        await set(refs.quickQuestion, {
          id: `q_nextvid_${Date.now()}`,
          type: 'next_video_prompt',
          nextIndex: nextIdx,
          question: promptText,
          askedBy: 'Video Player',
          silent: !state.speakQuestionsDefault,
          status: 'pending',
          answer: null,
          askedAt: Date.now()
        }).catch(() => {});
      }
      updateNanaVideoControlsUI();
    });

    $('video-screen')?.addEventListener('pointerdown', () => {
      showNanaVideoControlsTemporarily();
    });
  }

  // --- 6. FAMILY PORTAL QUEUE MANAGEMENT ---
  function renderFamilyQueueUI() {
    const box = $('fam-video-queue-list');
    if (!box) return;
    const q = state.streamData?.queue || [];
    const curIdx = Number(state.streamData?.currentIndex) || 0;

    if (!q.length) {
      box.innerHTML = `<div style="color:#94a3b8;font-size:0.86rem;padding:8px;">No videos in queue yet. Add a TorBox permalink or MP4 below!</div>`;
      return;
    }

    box.innerHTML = '';
    q.forEach((item, idx) => {
      const isCurrent = idx === curIdx;
      const savedSec = getSavedTimeForItem(item, idx);
      const mins = Math.floor(savedSec / 60), secs = String(savedSec % 60).padStart(2, '0');
      const views = Number(state.streamData?.viewCounts?.[item.id] || 0);

      const row = document.createElement('div');
      row.className = 'fam-q-hist-item';
      row.style.borderColor = isCurrent ? '#a855f7' : '#334155';
      row.style.background = isCurrent ? 'rgba(168,85,247,0.12)' : '#0f172a';

      row.innerHTML = `
        <div class="fam-q-hist-info">
          <div class="fam-q-hist-text" style="color:${isCurrent ? '#f3e8ff' : '#e2e8f0'};">
            ${isCurrent ? '▶️ ' : ''}${idx + 1}. ${item.title}
          </div>
          <div class="fam-q-hist-meta">
            ⏱️ Saved: ${mins}:${secs} • 👁️ Watched: ${views}x ${item.subtitleUrl ? '• 💬 CC' : ''}
          </div>
        </div>
        <div style="display:flex;gap:6px;flex-wrap:wrap;">
          <button class="fam-q-mini-btn" style="background:#16a34a;border-color:#4ade80;" onclick="playQueueIndexOnNana(${idx})" title="Play this video on Nana's tablet">▶️ Play</button>
          <button class="fam-q-mini-btn" style="background:#2563eb;border-color:#60a5fa;" onclick="editVideoInQueue(${idx})" title="Edit title or link">✏️</button>
          <button class="fam-q-mini-btn" style="background:#7f1d1d;border-color:#f87171;" onclick="removeVideoFromQueue(${idx})" title="Remove from queue">🗑️</button>
        </div>
      `;
      box.appendChild(row);
    });
  }

  window.saveOrAddVideoToQueue = async () => {
    const titleEl = $('fam-vid-title-input');
    const urlEl = $('fam-vid-url-input');
    const subEl = $('fam-vid-sub-input');
    const title = (titleEl?.value || '').trim() || 'Family Video';
    const url = (urlEl?.value || '').trim();
    const subtitleUrl = (subEl?.value || '').trim();

    if (!url) return alert('Please paste a valid TorBox permalink or MP4 URL.');

    const q = [...(state.streamData?.queue || [])];
    const savedTimes = { ...(state.streamData?.savedTimes || {}) };

    if (editingQueueIndex >= 0 && editingQueueIndex < q.length) {
      const oldItem = q[editingQueueIndex];
      const urlChanged = oldItem.url !== url;
      const itemId = urlChanged ? `vid_${Date.now()}` : oldItem.id;
      if (urlChanged) {
        delete savedTimes[oldItem.id];
        localStorage.removeItem(`nana_vid_pos_${oldItem.url}`);
      }
      q[editingQueueIndex] = { id: itemId, title, url, subtitleUrl };
    } else {
      q.push({ id: `vid_${Date.now()}`, title, url, subtitleUrl });
    }

    editingQueueIndex = -1;
    if (titleEl) titleEl.value = '';
    if (urlEl) urlEl.value = '';
    if (subEl) subEl.value = '';
    const saveBtn = $('fam-vid-save-btn');
    if (saveBtn) saveBtn.textContent = '➕ Add to Queue';

    await update(refs.videoStream, {
      queue: q,
      savedTimes,
      updatedAt: Date.now()
    });
  };

  window.editVideoInQueue = (idx) => {
    const q = state.streamData?.queue || [];
    const item = q[idx];
    if (!item) return;
    editingQueueIndex = idx;
    if ($('fam-vid-title-input')) $('fam-vid-title-input').value = item.title || '';
    if ($('fam-vid-url-input')) $('fam-vid-url-input').value = item.url || '';
    if ($('fam-vid-sub-input')) $('fam-vid-sub-input').value = item.subtitleUrl || '';
    const saveBtn = $('fam-vid-save-btn');
    if (saveBtn) saveBtn.textContent = `💾 Save Changes to #${idx + 1}`;
  };

  window.removeVideoFromQueue = async (idx) => {
    const q = [...(state.streamData?.queue || [])];
    if (idx < 0 || idx >= q.length) return;
    q.splice(idx, 1);
    const nextIdx = Math.min(Math.max(0, q.length - 1), Number(state.streamData?.currentIndex) || 0);
    await update(refs.videoStream, {
      queue: q,
      currentIndex: nextIdx,
      state: q.length ? state.streamData.state : 'paused',
      updatedAt: Date.now()
    });
  };

  window.playQueueIndexOnNana = async (idx) => {
    const q = state.streamData?.queue || [];
    if (idx < 0 || idx >= q.length) return;
    await update(refs.videoStream, {
      currentIndex: idx,
      state: 'playing',
      updatedAt: Date.now()
    });
  };

  window.pauseVideoFromFamily = async () => {
    await update(refs.videoStream, { state: 'paused', updatedAt: Date.now() });
  };

  window.remoteToggleNanaVideoPlayPause = async () => {
    const isPlaying = state.streamData?.state === 'playing';
    await update(refs.videoStream, { state: isPlaying ? 'paused' : 'playing', updatedAt: Date.now() });
  };

  // --- 7. FIREBASE REALTIME STREAM SYNC ---
  onValue(refs.videoStream, snap => {
    const prevIdx = state.streamData?.currentIndex;
    const prevUrl = getCurrentQueueItem()?.item?.url;
    state.streamData = normalizeQueueData(snap.val());
    const curItem = getCurrentQueueItem();

    if (role === 'family') {
      renderFamilyQueueUI();
      setTimeout(() => hooks.refreshFamilyPresence?.(), 20);
      const st = $('fam-vid-status');
      if (st) {
        if (!curItem) {
          st.innerText = 'Queue Empty';
          st.style.color = '#94a3b8';
        } else {
          const isTrulyPlaying = state.streamData.state === 'playing' || state.presenceSnap?.currentScreen === 'video_playing';
          const sec = getSavedTimeForItem(curItem.item, curItem.index);
          const mins = Math.floor(sec / 60), secs = String(sec % 60).padStart(2, '0');
          st.innerText = isTrulyPlaying
            ? `▶️ Playing #${curItem.index + 1}: ${curItem.item.title} (${mins}:${secs})`
            : `⏸️ Cued #${curItem.index + 1}: ${curItem.item.title} (${mins}:${secs})`;
          st.style.color = isTrulyPlaying ? '#4ade80' : '#fbbf24';
        }
      }
      return;
    }

    if (role === 'nana' && videoEl) {
      const slotChanged = (curItem?.index !== prevIdx) || (curItem?.item?.url !== prevUrl);
      if (slotChanged) {
        activeRawUrlForSlot = '';
        activeResolvedUrlForSlot = '';
      }

      if (state.streamData.state === 'playing') {
        if (!$('video-screen')?.classList.contains('active')) {
          window.openVideoScreen();
        }
        if (videoEl.paused || slotChanged) {
          startOrResumeVideo();
        }
      } else if (state.streamData.state === 'paused' && !videoEl.paused) {
        videoEl.pause();
        updateNanaVideoControlsUI();
      } else {
        updateNanaVideoControlsUI();
      }
    }
  });
})();
