import {
  $, NanaCore, esc, ref, set, update, remove
} from "./nana-core.js?v=2.9.5";

const {
  CONFIG, SERVICE_TOKEN, role, activeFamilyMember, isAdminFamilyMember,
  basePath, db, state, hooks, makeFallbackAvatarUrl
} = NanaCore;

// --- 1. SELF-CONTAINED INTERACTIVE FACE CROPPER MODAL ---
const CROP_VIEW_SIZE = 260;
const CROP_OUT_SIZE = 256;

let cropCallback = null;
let cropImg = null;
let cropObjectUrl = null;
let cropZoom = 1.15;
let cropRotDeg = 0;
let cropOffX = 0;
let cropOffY = 0;
let cropMinScale = 1;
const activePointers = new Map();
let lastPinchDist = null;
let lastPanCenter = null;

function ensurePhotoCropModal() {
  let modal = $('photo-crop-modal');
  if (modal) return modal;

  modal = document.createElement('div');
  modal.id = 'photo-crop-modal';
  modal.innerHTML = `
    <div class="crop-modal-card">
      <div style="font-size:1.35rem;font-weight:900;color:#fef08a;">📷 Crop Photo to Face</div>
      <div style="font-size:0.88rem;color:#cbd5e1;font-weight:700;">Drag &amp; zoom so the face fills the bright circle</div>
      <div class="crop-canvas-wrap">
        <canvas id="face-crop-canvas" width="520" height="520"></canvas>
      </div>
      <div class="crop-controls-row">
        <button type="button" class="opt-btn" style="flex:0 0 auto;padding:7px 12px;" id="crop-zoom-out-btn">🔍−</button>
        <input type="range" id="face-crop-zoom-slider" min="1" max="4" step="0.02" value="1.15" style="flex:1;accent-color:#38bdf8;" />
        <button type="button" class="opt-btn" style="flex:0 0 auto;padding:7px 12px;" id="crop-zoom-in-btn">🔍+</button>
        <button type="button" class="opt-btn" style="flex:0 0 auto;padding:7px 12px;" id="crop-rotate-btn">🔄 Turn</button>
      </div>
      <div class="opt-row" style="width:100%;margin-top:4px;">
        <button type="button" class="opt-btn" style="background:#334155;border-color:#94a3b8;color:#fff;" id="crop-cancel-btn">✖ Cancel</button>
        <button type="button" class="opt-btn" style="background:#22c55e;border-color:#fff;color:#000;font-weight:900;" id="crop-confirm-btn">✅ Use This Photo</button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);

  const canvas = $('face-crop-canvas');
  const slider = $('face-crop-zoom-slider');

  const clampOffsets = () => {
    if (!cropImg) return;
    const natW = cropImg.naturalWidth || cropImg.width || 1;
    const natH = cropImg.naturalHeight || cropImg.height || 1;
    const effW = (cropRotDeg % 180 !== 0) ? natH : natW;
    const effH = (cropRotDeg % 180 !== 0) ? natW : natH;
    cropMinScale = Math.max(CROP_VIEW_SIZE / effW, CROP_VIEW_SIZE / effH);
    const drawnW = effW * cropMinScale * cropZoom;
    const drawnH = effH * cropMinScale * cropZoom;
    const maxX = Math.max(0, (drawnW - CROP_VIEW_SIZE) / 2);
    const maxY = Math.max(0, (drawnH - CROP_VIEW_SIZE) / 2);
    cropOffX = Math.max(-maxX, Math.min(maxX, cropOffX));
    cropOffY = Math.max(-maxY, Math.min(maxY, cropOffY));
  };

  const redrawCropCanvas = () => {
    if (!canvas || !cropImg) return;
    clampOffsets();
    const ctx = canvas.getContext('2d');
    const dpr = canvas.width / CROP_VIEW_SIZE;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.scale(dpr, dpr);

    ctx.fillStyle = '#020617';
    ctx.fillRect(0, 0, CROP_VIEW_SIZE, CROP_VIEW_SIZE);

    const natW = cropImg.naturalWidth || cropImg.width || 1;
    const natH = cropImg.naturalHeight || cropImg.height || 1;
    const scale = cropMinScale * cropZoom;

    ctx.save();
    ctx.translate(CROP_VIEW_SIZE / 2 + cropOffX, CROP_VIEW_SIZE / 2 + cropOffY);
    ctx.rotate((cropRotDeg * Math.PI) / 180);
    ctx.scale(scale, scale);
    ctx.drawImage(cropImg, -natW / 2, -natH / 2, natW, natH);
    ctx.restore();

    // Dimmed overlay outside the circular avatar preview
    const r = CROP_VIEW_SIZE / 2 - 8;
    ctx.save();
    ctx.fillStyle = 'rgba(2, 6, 23, 0.68)';
    ctx.beginPath();
    ctx.rect(0, 0, CROP_VIEW_SIZE, CROP_VIEW_SIZE);
    ctx.arc(CROP_VIEW_SIZE / 2, CROP_VIEW_SIZE / 2, r, 0, Math.PI * 2, true);
    ctx.fill('evenodd');

    ctx.strokeStyle = '#fde047';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(CROP_VIEW_SIZE / 2, CROP_VIEW_SIZE / 2, r, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();

    ctx.restore();
  };

  const getPointerInfo = () => {
    const pts = Array.from(activePointers.values());
    if (pts.length === 1) {
      return { center: { x: pts[0].x, y: pts[0].y }, dist: null };
    }
    if (pts.length >= 2) {
      const dx = pts[1].x - pts[0].x;
      const dy = pts[1].y - pts[0].y;
      return {
        center: { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 },
        dist: Math.hypot(dx, dy)
      };
    }
    return { center: null, dist: null };
  };

  canvas.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    canvas.setPointerCapture?.(e.pointerId);
    activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const info = getPointerInfo();
    lastPanCenter = info.center;
    lastPinchDist = info.dist;
  });

  canvas.addEventListener('pointermove', (e) => {
    if (!activePointers.has(e.pointerId)) return;
    e.preventDefault();
    activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const info = getPointerInfo();
    if (info.center && lastPanCenter) {
      const rect = canvas.getBoundingClientRect();
      const pxRatio = rect.width ? (CROP_VIEW_SIZE / rect.width) : 1;
      cropOffX += (info.center.x - lastPanCenter.x) * pxRatio;
      cropOffY += (info.center.y - lastPanCenter.y) * pxRatio;
    }
    if (info.dist && lastPinchDist && lastPinchDist > 10) {
      cropZoom = Math.max(1, Math.min(4, cropZoom * (info.dist / lastPinchDist)));
      if (slider) slider.value = String(cropZoom.toFixed(2));
    }
    lastPanCenter = info.center;
    lastPinchDist = info.dist;
    redrawCropCanvas();
  });

  const endPtr = (e) => {
    activePointers.delete(e.pointerId);
    const info = getPointerInfo();
    lastPanCenter = info.center;
    lastPinchDist = info.dist;
  };
  canvas.addEventListener('pointerup', endPtr);
  canvas.addEventListener('pointercancel', endPtr);

  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? -0.1 : 0.1;
    cropZoom = Math.max(1, Math.min(4, cropZoom + delta));
    if (slider) slider.value = String(cropZoom.toFixed(2));
    redrawCropCanvas();
  }, { passive: false });

  slider.oninput = () => {
    cropZoom = Math.max(1, Math.min(4, Number(slider.value) || 1));
    redrawCropCanvas();
  };

  $('crop-zoom-out-btn').onclick = () => {
    cropZoom = Math.max(1, Number((cropZoom - 0.18).toFixed(2)));
    slider.value = String(cropZoom);
    redrawCropCanvas();
  };
  $('crop-zoom-in-btn').onclick = () => {
    cropZoom = Math.min(4, Number((cropZoom + 0.18).toFixed(2)));
    slider.value = String(cropZoom);
    redrawCropCanvas();
  };
  $('crop-rotate-btn').onclick = () => {
    cropRotDeg = (cropRotDeg + 90) % 360;
    redrawCropCanvas();
  };

  const cleanupCrop = () => {
    modal.style.display = 'none';
    activePointers.clear();
    if (cropObjectUrl) {
      try { URL.revokeObjectURL(cropObjectUrl); } catch (_) {}
      cropObjectUrl = null;
    }
    cropImg = null;
  };

  $('crop-cancel-btn').onclick = () => {
    cleanupCrop();
    cropCallback = null;
  };

  $('crop-confirm-btn').onclick = () => {
    if (!cropImg) return cleanupCrop();
    clampOffsets();
    const outCanvas = document.createElement('canvas');
    outCanvas.width = CROP_OUT_SIZE;
    outCanvas.height = CROP_OUT_SIZE;
    const octx = outCanvas.getContext('2d');
    octx.fillStyle = '#0f172a';
    octx.fillRect(0, 0, CROP_OUT_SIZE, CROP_OUT_SIZE);

    const outRatio = CROP_OUT_SIZE / (CROP_VIEW_SIZE - 16);
    const natW = cropImg.naturalWidth || cropImg.width || 1;
    const natH = cropImg.naturalHeight || cropImg.height || 1;
    const scale = cropMinScale * cropZoom * outRatio;

    octx.translate(CROP_OUT_SIZE / 2 + cropOffX * outRatio, CROP_OUT_SIZE / 2 + cropOffY * outRatio);
    octx.rotate((cropRotDeg * Math.PI) / 180);
    octx.scale(scale, scale);
    octx.drawImage(cropImg, -natW / 2, -natH / 2, natW, natH);

    const dataUrl = outCanvas.toDataURL('image/jpeg', 0.84);
    const cb = cropCallback;
    cleanupCrop();
    cropCallback = null;
    if (typeof cb === 'function') cb(dataUrl);
  };

  modal._redrawCropCanvas = redrawCropCanvas;
  return modal;
}

export function openPhotoCropperForFile(file, onDone) {
  if (!file) return;
  const modal = ensurePhotoCropModal();
  if (cropObjectUrl) {
    try { URL.revokeObjectURL(cropObjectUrl); } catch (_) {}
    cropObjectUrl = null;
  }
  const url = URL.createObjectURL(file);
  cropObjectUrl = url;

  const img = new Image();
  img.onload = () => {
    cropImg = img;
    cropCallback = onDone;
    cropRotDeg = 0;
    cropZoom = 1.15;
    cropOffX = 0;
    cropOffY = 0;
    if ($('face-crop-zoom-slider')) $('face-crop-zoom-slider').value = String(cropZoom);
    modal.style.display = 'flex';
    modal._redrawCropCanvas?.();
  };
  img.onerror = () => {
    try { URL.revokeObjectURL(url); } catch (_) {}
    cropObjectUrl = null;
    alert('Could not open that photo. Please try a JPG or PNG image.');
  };
  img.src = url;
}

// --- 2. FAMILY MEMBER LINK & SORTING HELPERS ---
function buildPersonalMemberUrl(memberId) {
  return `${window.location.origin + window.location.pathname}?role=family&id=${encodeURIComponent(memberId)}&key=${encodeURIComponent(SERVICE_TOKEN)}`;
}

function generateUniqueMemberId(name) {
  const existingIds = new Set(CONFIG.familyMembers.map(m => m.id));
  let base = String(name || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 18);
  if (!base || base === 'nana' || base === 'family') base = base ? `${base}-1` : 'member';
  let candidate = base;
  let n = 2;
  while (existingIds.has(candidate)) {
    candidate = `${base.slice(0, 14)}-${n++}`;
  }
  return candidate;
}

function getMemberRecencyRankMap() {
  const historyMax = {};
  Object.values(state.callHistorySnap || {}).forEach(c => {
    if (!c || !c.partnerId) return;
    const t = Math.max(Number(c.endedAt || 0), Number(c.startedAt || 0));
    if (t > (historyMax[c.partnerId] || 0)) historyMax[c.partnerId] = t;
  });
  const getLastTs = (id) => Math.max(
    Number(state.memberLastCallAtSnap?.[id] || 0),
    Number(state.missedCallsByMember?.[id]?.timestamp || 0),
    Number(historyMax[id] || 0)
  );
  const connected = CONFIG.familyMembers.filter(m => state.connectedMemberIds.includes(m.id));
  const sorted = [...connected]
    .map((m, idx) => ({ id: m.id, idx, ts: getLastTs(m.id) }))
    .sort((a, b) => (b.ts - a.ts) || (a.idx - b.idx));
  const rankMap = {};
  sorted.forEach((x, idx) => { rankMap[x.id] = idx + 1; });
  return { rankMap, getLastTs };
}

function formatLastCallShort(ts) {
  if (!ts) return 'No calls yet';
  const diffM = Math.max(0, Math.floor((Date.now() - ts) / 60000));
  if (diffM < 2) return 'Just now';
  if (diffM < 60) return `${diffM}m ago`;
  const hrs = Math.floor(diffM / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return new Date(ts).toLocaleDateString([], { month: 'short', day: 'numeric' });
}

// --- 3. ADMIN FAMILY MEMBERS MANAGER MODAL ---
let editingMemberId = null;
let pendingFormPhotoDataUrl = null;
let pendingFormHasExistingPhoto = false;

window.openFamilyMembersModal = () => {
  if (role !== 'family' || !isAdminFamilyMember) return;
  resetMemberForm();
  renderManageFamilyMembersList();
  const modal = $('family-members-modal');
  if (modal) modal.style.display = 'flex';
};

window.closeFamilyMembersModal = () => {
  const modal = $('family-members-modal');
  if (modal) modal.style.display = 'none';
};

function resetMemberForm() {
  editingMemberId = null;
  pendingFormPhotoDataUrl = null;
  pendingFormHasExistingPhoto = false;
  if ($('fm-form-heading')) $('fm-form-heading').innerText = '➕ Add New Family Member';
  if ($('fm-name-input')) $('fm-name-input').value = '';
  if ($('fm-cancel-edit-btn')) $('fm-cancel-edit-btn').style.display = 'none';
  if ($('fm-save-member-btn')) $('fm-save-member-btn').innerText = '✅ Add Person';
  if ($('fm-form-error')) $('fm-form-error').innerText = '';
  const prev = $('fm-photo-preview');
  if (prev) {
    prev.style.display = 'none';
    prev.removeAttribute('src');
  }
  const phLbl = $('fm-photo-status');
  if (phLbl) {
    phLbl.innerText = 'Required: choose a photo and crop it to their face';
    phLbl.style.color = '#fbbf24';
  }
}
window.cancelEditFamilyMemberForm = resetMemberForm;

window.triggerAdminMemberPhotoPick = () => {
  const inp = $('fm-photo-file-input');
  if (!inp) return;
  inp.value = '';
  inp.onchange = (ev) => {
    const file = ev.target.files?.[0];
    if (!file) return;
    openPhotoCropperForFile(file, (croppedDataUrl) => {
      pendingFormPhotoDataUrl = croppedDataUrl;
      pendingFormHasExistingPhoto = true;
      const prev = $('fm-photo-preview');
      if (prev) {
        prev.src = croppedDataUrl;
        prev.style.display = 'block';
      }
      const phLbl = $('fm-photo-status');
      if (phLbl) {
        phLbl.innerText = '✅ Face photo cropped & ready';
        phLbl.style.color = '#4ade80';
      }
      if ($('fm-form-error')) $('fm-form-error').innerText = '';
    });
  };
  inp.click();
};

window.startEditFamilyMember = (memberId) => {
  const m = CONFIG.familyMembers.find(x => x.id === memberId);
  if (!m) return;
  editingMemberId = m.id;
  const savedRec = state.familyMembersSnap?.[m.id];
  pendingFormPhotoDataUrl = (typeof savedRec?.photoDataUrl === 'string' && savedRec.photoDataUrl.startsWith('data:image/'))
    ? savedRec.photoDataUrl
    : null;
  pendingFormHasExistingPhoto = !!m.hasProfilePhoto || !!m.isBuiltIn;

  if ($('fm-form-heading')) $('fm-form-heading').innerText = `✏️ Edit ${m.name}`;
  if ($('fm-name-input')) $('fm-name-input').value = m.name;
  if ($('fm-cancel-edit-btn')) $('fm-cancel-edit-btn').style.display = 'inline-block';
  if ($('fm-save-member-btn')) $('fm-save-member-btn').innerText = '💾 Save Changes';
  if ($('fm-form-error')) $('fm-form-error').innerText = '';
  const prev = $('fm-photo-preview');
  if (prev) {
    prev.onerror = () => { prev.src = m.fallback; };
    prev.src = pendingFormPhotoDataUrl || m.photo;
    prev.style.display = 'block';
  }
  const phLbl = $('fm-photo-status');
  if (phLbl) {
    phLbl.innerText = pendingFormPhotoDataUrl
      ? 'Current cropped photo (tap above to change/re-crop)'
      : (m.isBuiltIn ? 'Using default photo (tap above to upload/crop a new one)' : 'Required: choose & crop a face photo');
    phLbl.style.color = pendingFormHasExistingPhoto ? '#93c5fd' : '#fbbf24';
  }
  $('family-members-modal')?.scrollTo?.({ top: 0, behavior: 'smooth' });
};

window.saveFamilyMemberForm = async () => {
  if (!isAdminFamilyMember) return;
  const name = ($('fm-name-input')?.value || '').trim();
  const errEl = $('fm-form-error');
  if (!name) {
    if (errEl) errEl.innerText = '⚠️ Please enter a name for this person.';
    return;
  }

  const isEditing = !!editingMemberId;
  const existing = isEditing ? CONFIG.familyMembers.find(x => x.id === editingMemberId) : null;
  const hasPhotoReady = !!(pendingFormPhotoDataUrl || (isEditing && existing?.hasProfilePhoto));
  if (!hasPhotoReady) {
    if (errEl) errEl.innerText = '⚠️ Please choose a profile photo and crop it to their face.';
    return;
  }

  const btn = $('fm-save-member-btn');
  if (btn) btn.disabled = true;
  if (errEl) errEl.innerText = '';

  try {
    const id = isEditing ? editingMemberId : generateUniqueMemberId(name);
    const oldRec = state.familyMembersSnap?.[id] || {};
    const now = Date.now();
    const record = {
      id,
      name,
      spokenName: name,
      isCustom: isEditing ? !existing?.isBuiltIn : true,
      createdAt: Number(oldRec.createdAt || existing?.createdAt || now),
      updatedAt: now
    };
    if (pendingFormPhotoDataUrl) {
      record.photoDataUrl = pendingFormPhotoDataUrl;
    } else if (typeof oldRec.photoDataUrl === 'string' && oldRec.photoDataUrl.startsWith('data:image/')) {
      record.photoDataUrl = oldRec.photoDataUrl;
    }
    await set(ref(db, `${basePath}/familyMembers/${id}`), record);
    resetMemberForm();
    renderManageFamilyMembersList();
  } catch (err) {
    if (errEl) errEl.innerText = '⚠️ Could not save right now — please try again.';
  } finally {
    if (btn) btn.disabled = false;
  }
};

window.copyFamilyMemberLink = async (memberId, btnEl) => {
  const link = buildPersonalMemberUrl(memberId);
  try {
    await navigator.clipboard.writeText(link);
    if (btnEl) {
      const old = btnEl.innerText;
      btnEl.innerText = '✅ Copied!';
      setTimeout(() => { if (btnEl.isConnected) btnEl.innerText = old; }, 2200);
    }
  } catch (_) {
    window.prompt('Copy personal link to share:', link);
  }
};

window.removeCustomFamilyMember = async (memberId) => {
  if (!isAdminFamilyMember) return;
  const m = CONFIG.familyMembers.find(x => x.id === memberId);
  if (!m || m.isBuiltIn) return;
  if (!confirm(`Remove ${m.name} from NanaPhone?\n\nThey will no longer appear or have an active profile.`)) return;
  try {
    await Promise.all([
      remove(ref(db, `${basePath}/familyMembers/${memberId}`)),
      remove(ref(db, `${basePath}/hiddenContacts/${memberId}`)),
      remove(ref(db, `${basePath}/callSchedules/${memberId}`)),
      remove(ref(db, `${basePath}/missedCalls/${memberId}`)),
      remove(ref(db, `${basePath}/memberLastCallAt/${memberId}`))
    ]);
    if (editingMemberId === memberId) resetMemberForm();
    renderManageFamilyMembersList();
  } catch (_) {
    alert('Could not remove right now — please check connection.');
  }
};

export function renderManageFamilyMembersList() {
  const box = $('fm-members-list-box');
  if (!box) return;
  const { rankMap, getLastTs } = getMemberRecencyRankMap();
  const connectedCount = CONFIG.familyMembers.filter(m => state.connectedMemberIds.includes(m.id)).length;

  const summary = $('fm-grid-summary-lbl');
  if (summary) {
    summary.innerText = `${CONFIG.familyMembers.length} total • ${connectedCount} with Telegram connected${connectedCount > 8 ? ' (top 8 most recently called shown on Nana’s screen)' : ''}`;
  }

  box.innerHTML = CONFIG.familyMembers.map(m => {
    const isTg = state.connectedMemberIds.includes(m.id);
    const rank = rankMap[m.id];
    const lastTs = getLastTs(m.id);
    const statusBadge = isTg
      ? (rank && rank <= 8
          ? `<span class="fm-badge tg-on">🔔 Telegram • Grid #${rank}</span>`
          : `<span class="fm-badge tg-wait">🔔 Telegram • Outside top 8 (${formatLastCallShort(lastTs)})</span>`)
      : `<span class="fm-badge tg-off">📞 Can call Nana (No Telegram)</span>`;

    return `
      <div class="fm-member-row">
        <img src="${esc(m.photo)}" onerror="this.src='${esc(m.fallback)}'" class="fm-row-avatar" alt="${esc(m.name)}">
        <div class="fm-row-info">
          <div class="fm-row-name">${esc(m.name)} ${m.isCustom ? '<span style="font-size:0.74rem;color:#7dd3fc;">(Added)</span>' : ''}</div>
          <div class="fm-row-meta">${statusBadge}</div>
        </div>
        <div class="fm-row-actions">
          <button type="button" class="fm-mini-btn" onclick="copyFamilyMemberLink('${esc(m.id)}', this)" title="Copy personal webpage link">📋 Link</button>
          <button type="button" class="fm-mini-btn" onclick="startEditFamilyMember('${esc(m.id)}')" title="Edit Name &amp; Photo">✏️</button>
          ${m.isBuiltIn ? '' : `<button type="button" class="fm-mini-btn danger" onclick="removeCustomFamilyMember('${esc(m.id)}')" title="Remove member">🗑️</button>`}
        </div>
      </div>
    `;
  }).join('');
}

// --- 4. ANY FAMILY MEMBER'S SELF-PROFILE MODAL (NAME + CROP PHOTO) ---
let selfPendingPhotoDataUrl = null;
let selfRequiredNotice = false;

window.openMyProfileEditorModal = (requireNotice = false) => {
  if (role !== 'family') return;
  selfRequiredNotice = !!requireNotice;
  const savedRec = state.familyMembersSnap?.[activeFamilyMember.id];
  selfPendingPhotoDataUrl = (typeof savedRec?.photoDataUrl === 'string' && savedRec.photoDataUrl.startsWith('data:image/'))
    ? savedRec.photoDataUrl
    : null;

  if ($('self-prof-name-input')) $('self-prof-name-input').value = activeFamilyMember.name || '';
  if ($('self-prof-error')) {
    $('self-prof-error').innerText = selfRequiredNotice
      ? '⚠️ Please add your name and cropped profile photo before calling Nana.'
      : '';
  }
  const prev = $('self-prof-photo-preview');
  if (prev) {
    prev.onerror = () => { prev.src = activeFamilyMember.fallback; };
    prev.src = selfPendingPhotoDataUrl || activeFamilyMember.photo || makeFallbackAvatarUrl(activeFamilyMember.name, activeFamilyMember.id);
  }
  const st = $('self-prof-photo-status');
  if (st) {
    const hasPhoto = !!(selfPendingPhotoDataUrl || activeFamilyMember.hasProfilePhoto || activeFamilyMember.isBuiltIn);
    st.innerText = selfPendingPhotoDataUrl
      ? '✅ Cropped photo saved'
      : (hasPhoto ? 'Using current photo — tap below to upload & crop a new photo' : 'Required: please choose a photo & crop to your face');
    st.style.color = hasPhoto ? '#93c5fd' : '#fbbf24';
  }
  const modal = $('profile-editor-modal');
  if (modal) modal.style.display = 'flex';
};

window.closeMyProfileEditorModal = () => {
  const modal = $('profile-editor-modal');
  if (modal) modal.style.display = 'none';
};

window.triggerSelfPhotoPick = () => {
  const inp = $('self-prof-file-input');
  if (!inp) return;
  inp.value = '';
  inp.onchange = (ev) => {
    const file = ev.target.files?.[0];
    if (!file) return;
    openPhotoCropperForFile(file, (croppedDataUrl) => {
      selfPendingPhotoDataUrl = croppedDataUrl;
      const prev = $('self-prof-photo-preview');
      if (prev) prev.src = croppedDataUrl;
      const st = $('self-prof-photo-status');
      if (st) {
        st.innerText = '✅ Face photo cropped & ready';
        st.style.color = '#4ade80';
      }
      if ($('self-prof-error')) $('self-prof-error').innerText = '';
    });
  };
  inp.click();
};

window.saveMyProfileChanges = async () => {
  if (role !== 'family') return;
  const name = ($('self-prof-name-input')?.value || '').trim();
  const errEl = $('self-prof-error');
  if (!name) {
    if (errEl) errEl.innerText = '⚠️ Please enter your name.';
    return;
  }
  const hasPhoto = !!(selfPendingPhotoDataUrl || activeFamilyMember.hasProfilePhoto || activeFamilyMember.isBuiltIn);
  if (!hasPhoto) {
    if (errEl) errEl.innerText = '⚠️ Please choose a profile photo and crop it to your face.';
    return;
  }

  const btn = $('self-prof-save-btn');
  if (btn) btn.disabled = true;
  try {
    const id = activeFamilyMember.id;
    const oldRec = state.familyMembersSnap?.[id] || {};
    const now = Date.now();
    const record = {
      id,
      name,
      spokenName: name,
      isCustom: !activeFamilyMember.isBuiltIn,
      createdAt: Number(oldRec.createdAt || activeFamilyMember.createdAt || now),
      updatedAt: now
    };
    if (selfPendingPhotoDataUrl) {
      record.photoDataUrl = selfPendingPhotoDataUrl;
    } else if (typeof oldRec.photoDataUrl === 'string' && oldRec.photoDataUrl.startsWith('data:image/')) {
      record.photoDataUrl = oldRec.photoDataUrl;
    }
    await update(ref(db, `${basePath}/familyMembers/${id}`), record);
    window.closeMyProfileEditorModal();
  } catch (_) {
    if (errEl) errEl.innerText = '⚠️ Could not save profile right now.';
  } finally {
    if (btn) btn.disabled = false;
  }
};

export function hasRequiredCallerProfile() {
  const hasName = String(activeFamilyMember.name || '').trim().length > 0;
  const hasPhoto = !!(activeFamilyMember.hasProfilePhoto || activeFamilyMember.isBuiltIn);
  return hasName && hasPhoto;
}
NanaCore.hasRequiredCallerProfile = hasRequiredCallerProfile;

export function syncFamilySelfHeaderUI() {
  if (role !== 'family') return;
  if ($('family-greeting')) $('family-greeting').innerText = `Call Nana (as ${activeFamilyMember.name})`;
  const img = $('family-self-photo');
  if (img) {
    img.onerror = () => { img.src = activeFamilyMember.fallback; };
    img.src = activeFamilyMember.photo;
  }
  if ($('family-manage-members-btn')) {
    $('family-manage-members-btn').style.display = isAdminFamilyMember ? 'inline-block' : 'none';
  }
  if ($('family-profile-setup-warning')) {
    const needsSetup = state.familyMembersLoaded && !hasRequiredCallerProfile();
    $('family-profile-setup-warning').style.display = needsSetup ? 'block' : 'none';
  }
  if ($('family-members-modal')?.style.display === 'flex') {
    renderManageFamilyMembersList();
  }
}

hooks.renderManageFamily = () => {
  if ($('family-members-modal')?.style.display === 'flex') renderManageFamilyMembersList();
};
hooks.onFamilyMembersChanged.push(syncFamilySelfHeaderUI);
if (role === 'family') {
  syncFamilySelfHeaderUI();
}
