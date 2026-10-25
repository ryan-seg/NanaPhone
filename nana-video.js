// --- TORBOX PERMALINK RESOLVER & ROBUST VIDEO PLAYBACK ---
  let activeResolvedUrlForSlot = '';
  let activeRawUrlForSlot = '';
  let resolvedUrlFetchedAtMs = 0;
  let isResolvingVideoUrl = false;

  // Converts a TorBox permalink into a fresh direct CDN URL on the fly (avoids 302 CORS black screens & expired cache)
  async function resolvePlayableVideoUrl(rawUrl) {
    if (!rawUrl) return '';
    const trimmed = rawUrl.trim();

    // If it's a TorBox requestdl permalink, fetch the JSON response (redirect=false) to get a fresh CDN link
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
        console.warn('TorBox JSON resolve failed, falling back to direct redirect URL:', err);
      }
      // Fallback: ensure redirect=true if fetch failed
      return trimmed.includes('redirect=') ? trimmed : `${trimmed}&redirect=true`;
    }

    return trimmed;
  }

  function applySubtitleTrack(subUrl) {
    if (!videoEl) return;
    videoEl.querySelectorAll('track').forEach(t => t.remove());
    if (subUrl && subUrl.trim()) {
      // Only set crossOrigin if we actually have an external subtitle track
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
      // CRITICAL: Remove crossorigin when no subtitles are used so TorBox CDN streams are never CORS-blocked!
      videoEl.removeAttribute('crossorigin');
    }
  }

  async function startOrResumeVideo() {
    const curItem = getCurrentQueueItem();
    if (!videoEl || !curItem || !curItem.item?.url) return;
    if (isResolvingVideoUrl) return;

    const rawUrl = curItem.item.url.trim();
    const targetResume = getSavedTimeForItem(curItem.item, curItem.index);
    const lbl = $('nana-video-status-lbl');

    // Refresh the TorBox CDN URL if the slot changed, or if the link is older than 90 minutes, or if the video previously errored
    const urlAgeMs = Date.now() - resolvedUrlFetchedAtMs;
    const needsFreshLoad =
      activeRawUrlForSlot !== rawUrl ||
      !activeResolvedUrlForSlot ||
      urlAgeMs > 90 * 60 * 1000 ||
      videoEl.error ||
      videoEl.networkState === HTMLMediaElement.NETWORK_NO_SOURCE;

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

    // Safely seek ONLY after metadata has loaded (seeking at readyState 0 causes black-screen hangs on Android)
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
            update(refs.presence, { online: true, currentScreen: 'video_playing', lastPing: Date.now() }).catch(() => {});
          }
        }).catch(err => {
          console.warn('Video play() rejected:', err);
          // If unmuted autoplay was blocked by WebView policy, prompt tap or retry
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
        activeResolvedUrlForSlot = ''; // Force re-resolve on next tap
        const errCode = videoEl.error ? videoEl.error.code : 0;
        // Code 3 or 4 often means an MKV / AC3 / HEVC codec unsupported by Android WebView
        if (lbl) {
          lbl.textContent = (errCode === 3 || errCode === 4)
            ? '⚠️ Video format unsupported (Needs MP4 / H.264)'
            : '⚠️ Video link error — tap Play to retry';
        }
      };
      videoEl.addEventListener('loadedmetadata', onMeta, { once: true });
      videoEl.addEventListener('error', onErr, { once: true });

      // 12-second watchdog in case the stream hangs on loading metadata
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
