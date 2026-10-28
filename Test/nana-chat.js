import {
  $, NanaCore, ref, update, push, onValue, query, limitToLast
} from "./nana-core.js?v=2.9.3";

const {
  CONFIG, SERVICE_TOKEN, PORTAL_NODE_ID, role, activeFamilyMember,
  basePath, db, refs, settings, state, hooks
} = NanaCore;

let savedChatScrollTop = null;
let chatIntersectionObserver = null;
let keyboardHideTimer = null;
let lastKeyTapMs = 0;
let lastKeyChar = null;
let lastChatSendMs = 0;
let lastRenderedKbLayout = null;
let lastRenderedReadAloud = null;
const pendingReadMarks = new Set();

// --- 1. UNREAD CHECK & PHOTO URL RESOLUTION ---
export function isMessageUnreadByNana(item) {
  if (!item) return false;
  const isOut = !!item.fromNana || item.author?.toLowerCase() === 'nana';
  if (isOut) return false;
  const clearedAt = Number(settings.bulletinClearedAt) || 0;
  return !(item.readByNanaAt || (Number(item.timestamp) || 0) <= clearedAt);
}
NanaCore.isMessageUnreadByNana = isMessageUnreadByNana;

function resolveChatPhotoUrl(item) {
  if (!item) return null;
  const raw = (item.imageUrl || item.photoUrl || item.image || item.photo || item.mediaUrl || '').trim();
  if (raw) {
    if (/^(data:image\/|https?:\/\/|blob:)/i.test(raw)) return raw;
    if (/^[A-Za-z0-9+/=]{100,}$/.test(raw)) return `data:image/jpeg;base64,${raw}`;
    return raw;
  }
  const fid = item.fileId || item.photoFileId || item.telegramFileId;
  return fid
    ? `${CONFIG.googleScriptUrl}?action=get_photo&fileId=${encodeURIComponent(fid)}&secret=${encodeURIComponent(SERVICE_TOKEN)}`
    : null;
}

// --- 2. VIEWPORT READ RECEIPTS & TICKER VISIBILITY ---
async function markSingleMessageReadByNana(msgKey, bubbleEl) {
  if (role !== 'nana' || !msgKey || pendingReadMarks.has(msgKey)) return;
  const item = state.bulletinSnap[msgKey];
  if (!item || !isMessageUnreadByNana(item)) return;
  pendingReadMarks.add(msgKey);
  const now = Date.now();
  item.readByNanaAt = now;

  if (bubbleEl) {
    bubbleEl.classList.remove('unread-msg');
    bubbleEl.querySelector('.tg-new-tag')?.remove();
  }
  updateBulletinTickerVisibility();
  if (!Object.values(state.bulletinSnap).some(p => isMessageUnreadByNana(p))) {
    $('first-unread-divider')?.remove();
  }

  try {
    await update(ref(db, `${basePath}/bulletin/${msgKey}`), { readByNanaAt: now });
  } catch (_) {
    pendingReadMarks.delete(msgKey);
  }
}

function setupNanaChatReadObserver() {
  if (role !== 'nana') return;
  if (chatIntersectionObserver) chatIntersectionObserver.disconnect();
  const feed = $('bulletin-posts-container'), modal = $('bulletin-modal');
  if (!feed || modal?.style.display !== 'flex' || modal?.classList.contains('kb-fullscreen')) return;

  chatIntersectionObserver = new IntersectionObserver((entries) => {
    if (modal?.style.display !== 'flex' || modal?.classList.contains('kb-fullscreen')) return;
    entries.forEach(entry => {
      if (entry.isIntersecting && entry.intersectionRatio >= 0.55) {
        const key = entry.target.dataset.msgKey;
        if (key) markSingleMessageReadByNana(key, entry.target);
      }
    });
  }, { root: feed, threshold: [0.55, 0.85] });

  feed.querySelectorAll('.tg-bubble[data-msg-key]').forEach(el => {
    const key = el.dataset.msgKey;
    if (key && isMessageUnreadByNana(state.bulletinSnap[key])) {
      chatIntersectionObserver.observe(el);
    }
  });
}

export function updateBulletinTickerVisibility() {
  const bar = $('message-ticker-bar'), badge = $('chat-unread-badge');
  const unreadCount = Object.values(state.bulletinSnap).filter(p => isMessageUnreadByNana(p)).length;
  const hasUnread = unreadCount > 0;
  if (bar) bar.style.display = (settings.showBulletinBar !== false && hasUnread) ? 'flex' : 'none';
  if (badge) {
    badge.innerText = unreadCount > 9 ? '9+' : `${unreadCount} NEW`;
    badge.style.display = hasUnread ? 'inline-block' : 'none';
  }
}
hooks.updateBulletinTicker = updateBulletinTickerVisibility;

window.dismissCurrentBulletinBar = async (force = false) => {
  if (role !== 'nana' && !force) return;
  const now = Date.now();
  settings.bulletinClearedAt = now;
  const updates = { [`${basePath}/settings/bulletinClearedAt`]: now };
  Object.entries(state.bulletinSnap).forEach(([k, item]) => {
    if (isMessageUnreadByNana(item)) {
      item.readByNanaAt = now;
      updates[`${basePath}/bulletin/${k}/readByNanaAt`] = now;
    }
  });
  updateBulletinTickerVisibility();
  $('first-unread-divider')?.remove();
  document.querySelectorAll('.tg-bubble.unread-msg').forEach(b => b.classList.remove('unread-msg'));
  document.querySelectorAll('.tg-new-tag').forEach(t => t.remove());
  await update(ref(db), updates);
};

// --- 3. SENIOR ONSCREEN KEYBOARD & INPUT COMPOSER ---
function syncChatInputDisplay() {
  const input = $('nana-chat-input'), typed = $('nana-chat-typed'), ph = $('nana-chat-placeholder'), box = $('nana-chat-display');
  if (!input || !typed || !ph) return;
  const val = input.value || "", kbOpen = $('bulletin-modal')?.classList.contains('kb-fullscreen');
  ph.style.display = (!val.length && !kbOpen) ? 'inline' : 'none';
  typed.textContent = val.replace(/ /g, '\u00A0');
  if (box) box.scrollLeft = box.scrollWidth;
}

export function renderSeniorKeyboardLayout() {
  const container = $('senior-kb-letters-container');
  if (!container) return;
  const layout = settings.keyboardLayout || 'qwerty';
  lastRenderedKbLayout = layout;
  const rows = layout === 'abcdef'
    ? [['A','B','C','D','E','F','G','H','I','J'], ['K','L','M','N','O','P','Q','R','S','T'], ['U','V','W','X','Y','Z']]
    : [['Q','W','E','R','T','Y','U','I','O','P'], ['A','S','D','F','G','H','J','K','L'], ['Z','X','C','V','B','N','M']];
  container.innerHTML = '';

  const buildRow = (letters, cols, extra = '') => {
    const r = document.createElement('div');
    r.className = 'kb-row-grid';
    r.style.cssText = `display:grid;grid-template-columns:repeat(${cols},1fr);gap:10px;${extra}`;
    letters.forEach(l => {
      const b = document.createElement('button');
      b.className = 'kb-letter-btn';
      b.textContent = l;
      b.onpointerdown = (ev) => window.typeSeniorKey(l, ev);
      r.appendChild(b);
    });
    return r;
  };

  container.appendChild(buildRow(rows[0], 10));
  container.appendChild(buildRow(rows[1], layout === 'abcdef' ? 10 : 9, layout === 'abcdef' ? '' : 'padding:0 22px;'));
  const r3 = buildRow(rows[2], 9);
  const del = document.createElement('button');
  del.className = 'kb-letter-btn';
  del.style.cssText = `background:#7f1d1d;color:#fff;grid-column:span ${layout === 'abcdef' ? 3 : 2};border-color:#f87171;`;
  del.textContent = '⌫ Delete';
  del.onpointerdown = (ev) => window.typeSeniorKey('BACKSPACE', ev);
  r3.appendChild(del);
  container.appendChild(r3);
}

function resetKeyboardAutoHideTimer() {
  clearTimeout(keyboardHideTimer);
  const sec = Number(settings.keyboardTimeoutSec ?? 60);
  if (sec > 0) {
    keyboardHideTimer = setTimeout(() => {
      if ($('nana-chat-input')) $('nana-chat-input').value = '';
      syncChatInputDisplay();
      window.closeSeniorKeyboard(true);
    }, sec * 1000);
  }
}

function scrollToFirstUnreadOrBottom() {
  const feed = $('bulletin-posts-container'), div = $('first-unread-divider');
  if (!feed) return;
  if (div) div.scrollIntoView({ behavior: 'auto', block: 'start' });
  else {
    const firstUnread = feed.querySelector('.tg-bubble.unread-msg');
    if (firstUnread) firstUnread.scrollIntoView({ behavior: 'auto', block: 'start' });
    else feed.scrollTop = feed.scrollHeight;
  }
  setTimeout(() => {
    setupNanaChatReadObserver();
    window.handleChatScroll(feed);
  }, 150);
}

window.openFamilyBulletin = () => {
  savedChatScrollTop = null;
  const m = $('bulletin-modal');
  m.classList.remove('kb-fullscreen');
  m.style.display = 'flex';
  if ($('senior-onscreen-keyboard')) $('senior-onscreen-keyboard').style.display = 'none';
  renderBulletinFeed(true);
  syncChatInputDisplay();
  window.wakeScreenAndResetDimTimer?.();
  NanaCore.recordTouchActivity?.("Opened Family Chat");
  hooks.broadcastScreen?.();
};

window.closeFamilyBulletin = () => {
  if (chatIntersectionObserver) chatIntersectionObserver.disconnect();
  $('bulletin-modal').style.display = 'none';
  window.closeSeniorKeyboard(false);
  window.speechSynthesis?.cancel();
  window.wakeScreenAndResetDimTimer?.();
  NanaCore.recordTouchActivity?.("On Home Grid");
  hooks.broadcastScreen?.();
};

window.openSeniorKeyboard = () => {
  const feed = $('bulletin-posts-container');
  if (feed && !$('bulletin-modal')?.classList.contains('kb-fullscreen')) {
    savedChatScrollTop = feed.scrollTop;
  }
  if (chatIntersectionObserver) chatIntersectionObserver.disconnect();
  renderSeniorKeyboardLayout();
  $('bulletin-modal')?.classList.add('kb-fullscreen');
  if ($('senior-onscreen-keyboard')) $('senior-onscreen-keyboard').style.display = 'flex';
  syncChatInputDisplay();
  resetKeyboardAutoHideTimer();
  window.wakeScreenAndResetDimTimer?.();
  hooks.broadcastScreen?.();
};

window.closeSeniorKeyboard = (restoreScroll = true) => {
  clearTimeout(keyboardHideTimer);
  const modal = $('bulletin-modal');
  const wasFullscreen = modal?.classList.contains('kb-fullscreen');
  if ($('senior-onscreen-keyboard')) $('senior-onscreen-keyboard').style.display = 'none';
  modal?.classList.remove('kb-fullscreen');
  syncChatInputDisplay();
  if (wasFullscreen && modal?.style.display === 'flex') {
    setTimeout(() => {
      const feed = $('bulletin-posts-container');
      if (feed) {
        if (restoreScroll && savedChatScrollTop !== null) feed.scrollTop = savedChatScrollTop;
        else if (!restoreScroll) feed.scrollTop = feed.scrollHeight;
        setupNanaChatReadObserver();
      }
    }, 30);
  }
  hooks.broadcastScreen?.();
};

window.handleChatScroll = (el) => {
  if (role === 'nana' && el && !$('bulletin-modal')?.classList.contains('kb-fullscreen')) {
    savedChatScrollTop = el.scrollTop;
    const feedRect = el.getBoundingClientRect();
    el.querySelectorAll('.tg-bubble.unread-msg[data-msg-key]').forEach(bubble => {
      const r = bubble.getBoundingClientRect();
      const visibleHeight = Math.min(r.bottom, feedRect.bottom) - Math.max(r.top, feedRect.top);
      if (visibleHeight >= Math.min(r.height * 0.55, feedRect.height * 0.5)) {
        markSingleMessageReadByNana(bubble.dataset.msgKey, bubble);
      }
    });
  }
};

window.typeSeniorKey = (char, ev) => {
  if (ev) { ev.preventDefault(); ev.stopPropagation(); }
  const now = Date.now(), guardMs = Number(settings.keyGuardMs ?? 350), sameKey = (char === lastKeyChar);
  const minGap = char === 'BACKSPACE' ? (sameKey ? Math.min(guardMs, 250) : 60) : (sameKey && guardMs > 0 ? guardMs : 80);
  if (now - lastKeyTapMs < minGap) return;

  const input = $('nana-chat-input');
  if (!input) return;
  const cur = input.value;
  if (char === ' ' && (!cur.length || cur.endsWith(' '))) return;
  if (guardMs > 0 && char.length === 1 && /[A-Za-z]/.test(char)) {
    const c = char.toLowerCase();
    if (cur.length >= 2 && cur.slice(-1).toLowerCase() === c && cur.slice(-2, -1).toLowerCase() === c) return;
  }
  lastKeyTapMs = now;
  lastKeyChar = char;
  if (ev?.currentTarget) {
    const b = ev.currentTarget;
    b.classList.add('kb-flash');
    setTimeout(() => b.classList.remove('kb-flash'), 160);
  }
  resetKeyboardAutoHideTimer();
  window.wakeScreenAndResetDimTimer?.();
  input.value = char === 'BACKSPACE'
    ? Array.from(cur).slice(0, -1).join('')
    : cur + (['💋','❤️','☘️','👍','😘'].includes(char) || !cur.length ? char : char.toLowerCase());
  syncChatInputDisplay();
};

window.kbHideTapped = () => { if (Date.now() - lastKeyTapMs >= 350) window.closeSeniorKeyboard(true); };

window.submitTypedNanaMessage = async () => {
  const input = $('nana-chat-input');
  if (!input || (Date.now() - lastKeyTapMs < 350) || !input.value.trim()) return;
  const text = input.value.trim();
  input.value = "";
  savedChatScrollTop = null;
  syncChatInputDisplay();
  window.closeSeniorKeyboard(false);
  await window.sendNanaChatMessage(text);
};

window.sendNanaChatMessage = async (rawText) => {
  const text = (rawText || "").trim();
  if (!text || (Date.now() - lastChatSendMs < 4000)) return;
  lastChatSendMs = Date.now();
  const author = role === 'nana' ? 'Nana' : activeFamilyMember.name;
  const st = $('tg-send-status');
  if (st) { st.style.color = "#ffff00"; st.innerText = "⏳ Sending message to Telegram..."; }
  try {
    const now = Date.now();
    await push(refs.bulletin, { author, fromNana: role === 'nana', text, timestamp: now, ...(role === 'nana' ? { readByNanaAt: now } : {}) });
    const res = await fetch(CONFIG.googleScriptUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ secret: SERVICE_TOKEN, portalNode: PORTAL_NODE_ID, action: "nana_reply", author, text })
    });
    const data = await res.json();
    if (st) {
      st.style.color = data?.ok ? "#4ade80" : "#f87171";
      st.innerText = data?.ok ? "✅ Sent to Family Telegram Group!" : `⚠️ ${data?.error || 'Telegram not linked'}`;
      setTimeout(() => { st.style.color = "#4ade80"; st.innerText = "🟢 Connected to Family Group"; }, 5000);
    }
  } catch (_) {
    if (st) { st.style.color = "#f87171"; st.innerText = "⚠️ Saved on tablet"; }
  }
};

// --- 4. BULLETIN CHAT FEED RENDERER ---
export function renderBulletinFeed(forceInitialScroll = false) {
  const container = $('bulletin-posts-container');
  if (!container) return;
  const previousScroll = container.scrollTop;
  const wasAtBottom = (container.scrollHeight - container.scrollTop - container.clientHeight) <= 60;
  container.innerHTML = "";
  const keys = Object.keys(state.bulletinSnap).slice(-25);
  lastRenderedReadAloud = !!settings.showReadAloud;

  if (keys.length) {
    const newest = state.bulletinSnap[keys[keys.length - 1]];
    if ($('ticker-preview-text')) {
      $('ticker-preview-text').innerText = `💬 ${newest.author || 'Family'}: "${newest.text || 'Sent a photo 📷'}"`;
    }
  } else {
    container.innerHTML = `<div style="margin:auto;color:var(--text-muted);font-size:1.5rem;font-weight:700;padding:30px;">No messages yet. Tap the box below to open the keyboard and say hello!</div>`;
  }
  updateBulletinTickerVisibility();
  let insertedDivider = false;

  keys.forEach(k => {
    const item = state.bulletinSnap[k];
    const isOut = !!item.fromNana || item.author?.toLowerCase() === 'nana';
    const isUnread = isMessageUnreadByNana(item);

    if (isUnread && !insertedDivider) {
      insertedDivider = true;
      const d = document.createElement('div');
      d.id = 'first-unread-divider';
      d.className = 'tg-unread-divider';
      d.textContent = '⬇️ NEW UNREAD MESSAGES BELOW ⬇️';
      container.appendChild(d);
    }

    const b = document.createElement('div');
    b.className = `tg-bubble ${isOut ? 'outgoing' : 'incoming'}${isUnread ? ' unread-msg' : ''}`;
    b.dataset.msgKey = k;

    const top = document.createElement('div');
    top.className = 'tg-sender-row';
    const auth = document.createElement('span');
    auth.className = 'tg-sender-name';
    auth.textContent = isOut ? (role === 'nana' ? '👵 Nana (You)' : '👵 Nana') : `👤 ${item.author || 'Family'}`;
    if (isUnread) {
      const tag = document.createElement('span');
      tag.className = 'tg-new-tag';
      tag.textContent = 'NEW';
      auth.appendChild(tag);
    }
    top.appendChild(auth);

    if (item.timestamp) {
      const tm = document.createElement('span');
      tm.className = 'tg-msg-time';
      tm.textContent = new Date(item.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      top.appendChild(tm);
    }
    b.appendChild(top);

    const photoSrc = resolveChatPhotoUrl(item);
    if (photoSrc) {
      const img = document.createElement('img');
      img.className = 'tg-chat-photo';
      img.referrerPolicy = 'no-referrer';
      img.loading = 'eager';
      img.alt = 'Family Photo';
      img.src = photoSrc;
      img.onerror = () => {
        if (item.fileId && !img.dataset.retriedProxy) {
          img.dataset.retriedProxy = '1';
          img.src = `${CONFIG.googleScriptUrl}?action=get_photo&fileId=${encodeURIComponent(item.fileId)}&secret=${encodeURIComponent(SERVICE_TOKEN)}`;
        }
      };
      b.appendChild(img);
    }

    if (item.text) {
      const p = document.createElement('div');
      p.className = 'tg-msg-text';
      p.textContent = item.text;
      b.appendChild(p);
    }

    if (role === 'family' && !isOut) {
      const rc = document.createElement('div');
      if (!isUnread) {
        const readTime = item.readByNanaAt ? new Date(item.readByNanaAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
        rc.className = 'tg-read-receipt read';
        rc.textContent = `✓✓ Read by Nana${readTime ? ' (' + readTime + ')' : ''}`;
      } else {
        rc.className = 'tg-read-receipt unread';
        rc.textContent = '⏳ Unread by Nana';
      }
      b.appendChild(rc);
    }

    if (item.text && settings.showReadAloud) {
      const btn = document.createElement('button');
      btn.className = 'tg-speak-chip';
      btn.textContent = '🔊 Read Aloud';
      btn.onclick = () => window.speakNote(`${item.author || 'Family'} says: ${item.text}`);
      b.appendChild(btn);
    }
    container.appendChild(b);
  });

  if ($('bulletin-modal')?.style.display === 'flex' && !$('bulletin-modal')?.classList.contains('kb-fullscreen')) {
    if (forceInitialScroll) setTimeout(scrollToFirstUnreadOrBottom, 60);
    else {
      container.scrollTop = wasAtBottom ? container.scrollHeight : previousScroll;
      setTimeout(setupNanaChatReadObserver, 60);
    }
  }
}
hooks.renderBulletinFeed = renderBulletinFeed;

hooks.onSettingsChanged.push((s) => {
  if (lastRenderedKbLayout !== (s.keyboardLayout || 'qwerty')) renderSeniorKeyboardLayout();
  if (lastRenderedReadAloud !== !!s.showReadAloud) renderBulletinFeed(false);
});

onValue(query(refs.bulletin, limitToLast(25)), snap => {
  state.bulletinSnap = snap.val() || {};
  renderBulletinFeed(false);
});

if (role === 'nana') renderSeniorKeyboardLayout();