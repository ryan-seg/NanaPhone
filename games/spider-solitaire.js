/* ==========================================================================
   NanaPhone Standalone Spider Solitaire Engine & UI (MobilityWare-Inspired)
   --------------------------------------------------------------------------
   - Tap any movable card -> automatically flies to the best valid destination.
   - Hold (220ms) or drag (10px) -> lifts the card/run smoothly for drag & drop.
   - Future integration: import { createSpiderSolitaire } from './games/spider-solitaire.js'
     and call createSpiderSolitaire(mountEl, { onExit, onActivity, onWin }).
   ========================================================================== */

const STORAGE_KEY = 'nana_spider_solitaire_v1';
const HOLD_DRAG_MS = 220;
const MOVE_DRAG_PX = 10;
const MAX_UNDO_STEPS = 250;

const SUIT_META = {
  spades:   { symbol: '♠', color: 'black', label: 'Spades' },
  hearts:   { symbol: '♥', color: 'red',   label: 'Hearts' },
  clubs:    { symbol: '♣', color: 'black', label: 'Clubs' },
  diamonds: { symbol: '♦', color: 'red',   label: 'Diamonds' }
};

const RANK_LABELS = {
  1: 'A', 2: '2', 3: '3', 4: '4', 5: '5', 6: '6', 7: '7',
  8: '8', 9: '9', 10: '10', 11: 'J', 12: 'Q', 13: 'K'
};

// --- CRISP INLINE SVG ASSETS (IDENTICAL ACROSS ANDROID, iOS & DESKTOP) ---
function getSuitSvg(suit) {
  switch (suit) {
    case 'spades':
      return `<svg viewBox="0 0 100 100" aria-hidden="true"><path d="M50 8 C34 28 12 45 12 63 C12 76 22 83 33 83 C40 83 45 79 48 75 C47 83 43 89 36 93 L64 93 C57 89 53 83 52 75 C55 79 60 83 67 83 C78 83 88 76 88 63 C88 45 66 28 50 8 Z"/></svg>`;
    case 'hearts':
      return `<svg viewBox="0 0 100 100" aria-hidden="true"><path d="M50 89 C46 86 12 61 12 36 C12 20 24 10 37 10 C44 10 48 14 50 19 C52 14 56 10 63 10 C76 10 88 20 88 36 C88 61 54 86 50 89 Z"/></svg>`;
    case 'clubs':
      return `<svg viewBox="0 0 100 100" aria-hidden="true"><path d="M50 10 C38 10 29 19 29 31 C29 38 33 44 38 47 C35 45 31 44 27 44 C15 44 7 53 7 64 C7 75 16 83 27 83 C36 83 43 78 46 71 C45 81 42 88 35 93 L65 93 C58 88 55 81 54 71 C57 78 64 83 73 83 C84 83 93 75 93 64 C93 53 85 44 73 44 C69 44 65 45 62 47 C67 44 71 38 71 31 C71 19 62 10 50 10 Z"/></svg>`;
    case 'diamonds':
      return `<svg viewBox="0 0 100 100" aria-hidden="true"><path d="M50 7 L86 50 L50 93 L14 50 Z"/></svg>`;
    default:
      return '';
  }
}

const SPIDER_BACK_SVG = `
<svg viewBox="0 0 100 100" aria-hidden="true">
  <g fill="#160909" stroke="#160909" stroke-linecap="round" stroke-linejoin="round">
    <ellipse cx="50" cy="60" rx="13" ry="17"/>
    <circle cx="50" cy="39" r="9"/>
    <path d="M44 33 L39 25 M56 33 L61 25" stroke-width="3" fill="none"/>
    <path d="M42 42 C28 34 20 22 14 14" stroke-width="3.6" fill="none"/>
    <path d="M58 42 C72 34 80 22 86 14" stroke-width="3.6" fill="none"/>
    <path d="M40 48 C24 44 14 40 7 37" stroke-width="3.6" fill="none"/>
    <path d="M60 48 C76 44 86 40 93 37" stroke-width="3.6" fill="none"/>
    <path d="M40 55 C23 58 14 66 8 76" stroke-width="3.6" fill="none"/>
    <path d="M60 55 C77 58 86 66 92 76" stroke-width="3.6" fill="none"/>
    <path d="M42 64 C29 74 24 83 20 93" stroke-width="3.6" fill="none"/>
    <path d="M58 64 C71 74 76 83 80 93" stroke-width="3.6" fill="none"/>
    <path d="M50 51 L54 58 L50 66 L46 58 Z" fill="#dc2626" stroke="none"/>
  </g>
</svg>`;

function getCourtArtSvg(rank, suit) {
  const isRed = SUIT_META[suit]?.color === 'red';
  const primary = isRed ? '#b91c1c' : '#1e3a8a';
  const accent  = isRed ? '#f59e0b' : '#b91c1c';
  const gold    = '#eab308';
  if (rank === 13) {
    // Classic King portrait (crown, beard, royal robes & sword)
    return `<svg viewBox="0 0 100 112" aria-hidden="true">
      <rect x="3" y="3" width="94" height="106" rx="6" fill="#fffbeb" stroke="#d97706" stroke-width="2"/>
      <path d="M18 106 C18 76 30 68 50 68 C70 68 82 76 82 106 Z" fill="${primary}"/>
      <path d="M36 69 L50 106 L64 69 Z" fill="${accent}"/>
      <path d="M45 70 L55 70 L53 106 L47 106 Z" fill="${gold}"/>
      <circle cx="50" cy="46" r="17" fill="#fde68a" stroke="#92400e" stroke-width="1.5"/>
      <path d="M34 49 C35 63 43 69 50 69 C57 69 65 63 66 49 C61 55 56 56 50 56 C44 56 39 55 34 49 Z" fill="#e2e8f0" stroke="#64748b" stroke-width="1.2"/>
      <circle cx="44" cy="44" r="2.2" fill="#1e293b"/><circle cx="56" cy="44" r="2.2" fill="#1e293b"/>
      <path d="M45 52 Q50 55 55 52" fill="none" stroke="#64748b" stroke-width="1.8" stroke-linecap="round"/>
      <path d="M31 35 L35 16 L44 27 L50 13 L56 27 L65 16 L69 35 Z" fill="${gold}" stroke="#92400e" stroke-width="1.8" stroke-linejoin="round"/>
      <circle cx="50" cy="24" r="2.6" fill="#dc2626"/>
      <rect x="78" y="34" width="5" height="44" rx="2" fill="#cbd5e1" stroke="#475569" stroke-width="1.2"/>
      <rect x="73" y="64" width="15" height="4.5" rx="2" fill="${gold}" stroke="#92400e" stroke-width="1"/>
    </svg>`;
  }
  if (rank === 12) {
    // Classic Queen portrait (tiara, flowing hair, royal gown & golden rose)
    return `<svg viewBox="0 0 100 112" aria-hidden="true">
      <rect x="3" y="3" width="94" height="106" rx="6" fill="#fffbeb" stroke="#d97706" stroke-width="2"/>
      <path d="M29 36 C24 52 24 72 30 82 L70 82 C76 72 76 52 71 36 Z" fill="#92400e"/>
      <path d="M18 106 C20 77 32 68 50 68 C68 68 80 77 82 106 Z" fill="${primary}"/>
      <path d="M35 71 L50 96 L65 71 Z" fill="#fef08a"/>
      <path d="M40 73 L50 91 L60 73 Z" fill="${accent}"/>
      <circle cx="50" cy="46" r="16" fill="#fde68a" stroke="#92400e" stroke-width="1.5"/>
      <circle cx="44" cy="44" r="2.2" fill="#1e293b"/><circle cx="56" cy="44" r="2.2" fill="#1e293b"/>
      <path d="M45 53 Q50 57 55 53" fill="none" stroke="#b91c1c" stroke-width="2" stroke-linecap="round"/>
      <path d="M33 34 L38 19 L45 28 L50 15 L55 28 L62 19 L67 34 Z" fill="${gold}" stroke="#92400e" stroke-width="1.8" stroke-linejoin="round"/>
      <circle cx="50" cy="25" r="2.8" fill="#2563eb"/>
      <circle cx="77" cy="64" r="7" fill="#dc2626" stroke="${gold}" stroke-width="2"/>
      <circle cx="77" cy="64" r="2.8" fill="#fef08a"/>
    </svg>`;
  }
  // Classic Jack portrait (feathered cap & tunic)
  return `<svg viewBox="0 0 100 112" aria-hidden="true">
    <rect x="3" y="3" width="94" height="106" rx="6" fill="#fffbeb" stroke="#d97706" stroke-width="2"/>
    <path d="M19 106 C20 77 31 69 50 69 C69 69 80 77 81 106 Z" fill="${primary}"/>
    <path d="M28 74 L72 106 L58 106 L25 83 Z" fill="${gold}"/>
    <path d="M39 70 L50 86 L61 70 Z" fill="${accent}"/>
    <circle cx="50" cy="48" r="16" fill="#fde68a" stroke="#92400e" stroke-width="1.5"/>
    <circle cx="44" cy="46" r="2.2" fill="#1e293b"/><circle cx="56" cy="46" r="2.2" fill="#1e293b"/>
    <path d="M45 55 Q50 58 55 55" fill="none" stroke="#92400e" stroke-width="1.8" stroke-linecap="round"/>
    <path d="M29 37 C32 22 44 17 64 21 L72 34 C60 32 42 33 29 37 Z" fill="${accent}" stroke="#7f1d1d" stroke-width="1.6"/>
    <path d="M62 21 C71 13 79 14 82 22 C75 23 69 25 65 28 Z" fill="${gold}" stroke="#92400e" stroke-width="1.4"/>
  </svg>`;
}

// --- PURE SPIDER SOLITAIRE GAME ENGINE (EXPORTED FOR TESTING & INTEGRATION) ---
export function buildDeck(suitsCount = 1) {
  const suitPool = suitsCount === 4
    ? ['spades', 'hearts', 'clubs', 'diamonds', 'spades', 'hearts', 'clubs', 'diamonds']
    : suitsCount === 2
      ? ['spades', 'hearts', 'spades', 'hearts', 'spades', 'hearts', 'spades', 'hearts']
      : ['spades', 'spades', 'spades', 'spades', 'spades', 'spades', 'spades', 'spades'];

  const deck = [];
  let nextId = 1;
  suitPool.forEach(suit => {
    for (let rank = 1; rank <= 13; rank++) {
      deck.push({ id: `c_${nextId++}`, suit, rank, faceUp: false });
    }
  });
  return deck;
}

export function shuffleCards(cards, rng = Math.random) {
  const arr = cards.slice();
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

export function createInitialGameState(suitsCount = 1, rng = Math.random) {
  const validSuits = [1, 2, 4].includes(Number(suitsCount)) ? Number(suitsCount) : 1;
  const deck = shuffleCards(buildDeck(validSuits), rng);
  const tableau = Array.from({ length: 10 }, () => []);
  let cursor = 0;

  // Classic Spider deal: 4 cols of 6 cards + 6 cols of 5 cards = 54 cards; top card face-up
  for (let col = 0; col < 10; col++) {
    const count = col < 4 ? 6 : 5;
    for (let i = 0; i < count; i++) {
      const card = { ...deck[cursor++], faceUp: i === count - 1 };
      tableau[col].push(card);
    }
  }
  const stock = deck.slice(cursor).map(c => ({ ...c, faceUp: false }));

  return {
    suitsCount: validSuits,
    tableau,
    stock,
    completed: [],
    score: 500,
    moves: 0,
    startedAt: Date.now(),
    countedInStats: false
  };
}

export function cloneGameState(gs) {
  return {
    suitsCount: gs.suitsCount,
    tableau: gs.tableau.map(col => col.map(c => ({ ...c }))),
    stock: gs.stock.map(c => ({ ...c })),
    completed: gs.completed.slice(),
    score: gs.score,
    moves: gs.moves,
    startedAt: gs.startedAt,
    countedInStats: !!gs.countedInStats
  };
}

export function isMovableStack(tableau, colIdx, cardIdx) {
  const col = tableau[colIdx];
  if (!col || cardIdx < 0 || cardIdx >= col.length) return false;
  if (!col[cardIdx].faceUp) return false;
  for (let i = cardIdx; i < col.length - 1; i++) {
    const upper = col[i];
    const lower = col[i + 1];
    if (!lower.faceUp) return false;
    if (upper.suit !== lower.suit || upper.rank !== lower.rank + 1) return false;
  }
  return true;
}

export function getTopOfMovableRun(tableau, colIdx, fromIdx) {
  const col = tableau[colIdx];
  if (!col || fromIdx < 0 || fromIdx >= col.length || !col[fromIdx].faceUp) return fromIdx;
  let top = fromIdx;
  while (top > 0) {
    const above = col[top - 1];
    const cur = col[top];
    if (above.faceUp && above.suit === cur.suit && above.rank === cur.rank + 1) {
      top--;
    } else {
      break;
    }
  }
  return top;
}

export function getTrailingSameSuitRunLength(col) {
  if (!col || !col.length) return 0;
  const last = col[col.length - 1];
  if (!last.faceUp) return 0;
  let len = 1;
  for (let i = col.length - 2; i >= 0; i--) {
    const prev = col[i];
    const next = col[i + 1];
    if (prev.faceUp && prev.suit === next.suit && prev.rank === next.rank + 1) len++;
    else break;
  }
  return len;
}

export function canDropStackOnColumn(tableau, srcCol, cardIdx, dstCol) {
  if (srcCol === dstCol) return false;
  if (!isMovableStack(tableau, srcCol, cardIdx)) return false;
  const dst = tableau[dstCol];
  if (!dst) return false;
  if (dst.length === 0) return true;
  const leadCard = tableau[srcCol][cardIdx];
  const dstTop = dst[dst.length - 1];
  return dstTop.faceUp && dstTop.rank === leadCard.rank + 1;
}

function wouldCompleteSuitOnDrop(tableau, srcCol, cardIdx, dstCol) {
  const src = tableau[srcCol];
  const dst = tableau[dstCol];
  const moving = src.slice(cardIdx);
  if (!moving.length) return false;
  const suit = moving[0].suit;
  if (moving[moving.length - 1].rank !== 1) return false; // Must end at Ace
  let runLen = moving.length;
  if (dst.length > 0) {
    const dstTop = dst[dst.length - 1];
    if (dstTop.faceUp && dstTop.suit === suit && dstTop.rank === moving[0].rank + 1) {
      runLen += getTrailingSameSuitRunLength(dst);
    }
  }
  return runLen >= 13;
}

export function scoreMoveCandidate(tableau, srcCol, cardIdx, dstCol) {
  if (!canDropStackOnColumn(tableau, srcCol, cardIdx, dstCol)) return -Infinity;
  const src = tableau[srcCol];
  const dst = tableau[dstCol];
  const lead = src[cardIdx];
  const movingLen = src.length - cardIdx;
  const parentAbove = cardIdx > 0 ? src[cardIdx - 1] : null;
  const exposesFaceDown = !!(parentAbove && !parentAbove.faceUp);
  const emptiesSrc = cardIdx === 0;
  const currentlyOnSameSuit = !!(parentAbove && parentAbove.faceUp && parentAbove.suit === lead.suit && parentAbove.rank === lead.rank + 1);
  const currentlyOnOffSuit = !!(parentAbove && parentAbove.faceUp && parentAbove.suit !== lead.suit && parentAbove.rank === lead.rank + 1);

  // 1. Completing a full K->A suit is always the #1 move
  if (wouldCompleteSuitOnDrop(tableau, srcCol, cardIdx, dstCol)) {
    return 10000 + movingLen * 10;
  }

  // 2. Empty column destination
  if (dst.length === 0) {
    // Never auto-move an entire column into another empty column (pointless loop)
    if (emptiesSrc) return -Infinity;
    let score = 220;
    if (exposesFaceDown) score += 360;
    if (lead.rank === 13) score += 200; // Kings shine in empty columns
    if (currentlyOnOffSuit) score += 160; // Unblocks a different suit underneath
    if (currentlyOnSameSuit) score -= 500; // Don't split a healthy same-suit run into empty unless desperate
    // Slight preference for the closest empty column so Nana's eye doesn't jump unnecessarily
    score -= Math.abs(dstCol - srcCol) * 2;
    return score;
  }

  const dstTop = dst[dst.length - 1];
  const dstSameSuitLen = getTrailingSameSuitRunLength(dst);

  // 3. Same-suit build (great move!)
  if (dstTop.suit === lead.suit) {
    let score = 5000 + dstSameSuitLen * 130 + movingLen * 25;
    if (exposesFaceDown) score += 400;
    if (emptiesSrc) score += 320;
    if (currentlyOnOffSuit) score += 260;
    if (currentlyOnSameSuit) {
      const srcSameSuitAbove = (() => {
        let count = 0;
        for (let i = cardIdx - 1; i >= 0; i--) {
          if (src[i].faceUp && src[i].suit === lead.suit && src[i].rank === src[i + 1].rank + 1) count++;
          else break;
        }
        return count;
      })();
      // Moving off an equal/longer same-suit chain onto a shorter one is unhelpful
      if (dstSameSuitLen <= srcSameSuitAbove) score -= 4500;
    }
    score -= Math.abs(dstCol - srcCol);
    return score;
  }

  // 4. Off-suit build (legal in 2-suit and 4-suit)
  let score = 1100;
  if (exposesFaceDown) score += 450;
  if (emptiesSrc) score += 350;
  if (currentlyOnSameSuit) score -= 950; // Discourage breaking a same-suit run for an off-suit build
  if (currentlyOnOffSuit && !exposesFaceDown && !emptiesSrc) score -= 180;
  score -= Math.abs(dstCol - srcCol);
  return score;
}

export function findBestMoveForTap(tableau, srcCol, cardIdx) {
  if (!isMovableStack(tableau, srcCol, cardIdx)) return null;

  const pickBestDest = (idx) => {
    let best = null;
    for (let dstCol = 0; dstCol < 10; dstCol++) {
      const score = scoreMoveCandidate(tableau, srcCol, idx, dstCol);
      if (score > 0 && (!best || score > best.score)) {
        best = { srcCol, cardIdx: idx, dstCol, score };
      }
    }
    return best;
  };

  const direct = pickBestDest(cardIdx);
  // If the exact tapped card has a strong build move (or no larger same-suit run exists), use it!
  const topRunIdx = getTopOfMovableRun(tableau, srcCol, cardIdx);
  if (direct && (direct.score >= 900 || topRunIdx === cardIdx)) {
    return direct;
  }

  // Smart Nana assist: if she tapped slightly low on a same-suit run (e.g. tapped 10♠ in Q♠-J♠-10♠)
  // and the whole Q♠-J♠-10♠ run can land cleanly on a K♠, move the whole run!
  if (topRunIdx < cardIdx) {
    const wholeRunMove = pickBestDest(topRunIdx);
    if (wholeRunMove && (!direct || wholeRunMove.score > direct.score)) {
      return wholeRunMove;
    }
  }

  return direct;
}

export function findBestHintMove(tableau) {
  let best = null;
  for (let srcCol = 0; srcCol < 10; srcCol++) {
    const col = tableau[srcCol];
    for (let cardIdx = 0; cardIdx < col.length; cardIdx++) {
      if (!isMovableStack(tableau, srcCol, cardIdx)) continue;
      const parentAbove = cardIdx > 0 ? col[cardIdx - 1] : null;
      const isMidSameSuit = !!(parentAbove && parentAbove.faceUp && parentAbove.suit === col[cardIdx].suit && parentAbove.rank === col[cardIdx].rank + 1);
      for (let dstCol = 0; dstCol < 10; dstCol++) {
        const score = scoreMoveCandidate(tableau, srcCol, cardIdx, dstCol);
        if (score <= 0) continue;
        // Skip hint suggestions that split a healthy same-suit run unless they complete a suit or build a much longer same-suit chain
        if (isMidSameSuit && score < 5000) continue;
        // Avoid pointless off-suit lateral shuffles in hints
        const dst = tableau[dstCol];
        if (dst.length > 0 && dst[dst.length - 1].suit !== col[cardIdx].suit && parentAbove?.faceUp && parentAbove.rank === col[cardIdx].rank + 1) {
          continue;
        }
        if (!best || score > best.score) {
          best = { srcCol, cardIdx, dstCol, score };
        }
      }
    }
  }
  return best;
}

export function canAutoFinishGame(gs) {
  if (!gs || !Array.isArray(gs.tableau) || gs.stock.length > 0 || gs.completed.length >= 8) return false;
  for (let colIdx = 0; colIdx < 10; colIdx++) {
    const col = gs.tableau[colIdx];
    if (!col.length) continue;
    for (let i = 0; i < col.length; i++) {
      if (!col[i].faceUp) return false;
    }
    if (!isMovableStack(gs.tableau, colIdx, 0)) return false;
  }
  return !!findBestHintMove(gs.tableau);
}

export function extractCompletedRuns(gameState) {
  const extracted = [];
  for (let colIdx = 0; colIdx < 10; colIdx++) {
    const col = gameState.tableau[colIdx];
    while (col.length >= 13) {
      const start = col.length - 13;
      const suit = col[start].suit;
      let complete = col[start].faceUp && col[start].rank === 13;
      if (complete) {
        for (let k = 0; k < 13; k++) {
          const c = col[start + k];
          if (!c.faceUp || c.suit !== suit || c.rank !== 13 - k) {
            complete = false;
            break;
          }
        }
      }
      if (!complete) break;
      const removed = col.splice(start, 13);
      gameState.completed.push(suit);
      gameState.score += 100;
      let flippedCard = null;
      if (col.length > 0 && !col[col.length - 1].faceUp) {
        col[col.length - 1].faceUp = true;
        flippedCard = col[col.length - 1];
      }
      extracted.push({ colIdx, suit, cards: removed, flippedCard });
    }
  }
  return extracted;
}

export function applyMove(gameState, srcCol, cardIdx, dstCol, { deferCompletion = false } = {}) {
  if (!canDropStackOnColumn(gameState.tableau, srcCol, cardIdx, dstCol)) return null;
  const moving = gameState.tableau[srcCol].splice(cardIdx);
  gameState.tableau[dstCol].push(...moving);
  let flippedCard = null;
  const src = gameState.tableau[srcCol];
  if (src.length > 0 && !src[src.length - 1].faceUp) {
    src[src.length - 1].faceUp = true;
    flippedCard = src[src.length - 1];
  }
  gameState.moves += 1;
  gameState.score = Math.max(0, gameState.score - 1);
  const completedRuns = deferCompletion ? [] : extractCompletedRuns(gameState);
  return { moving, flippedCard, completedRuns };
}

export function applyDealRow(gameState, allowEmptyColumns = true, { deferCompletion = false } = {}) {
  if (gameState.stock.length < 10) return { ok: false, reason: 'no_stock' };
  if (!allowEmptyColumns && gameState.tableau.some(col => col.length === 0)) {
    return { ok: false, reason: 'empty_column' };
  }
  const dealt = [];
  for (let colIdx = 0; colIdx < 10; colIdx++) {
    const card = gameState.stock.pop();
    card.faceUp = true;
    gameState.tableau[colIdx].push(card);
    dealt.push({ colIdx, card });
  }
  const completedRuns = deferCompletion ? [] : extractCompletedRuns(gameState);
  return { ok: true, dealt, completedRuns };
}

// --- GENTLE WEB AUDIO CARD SOUNDS (ZERO EXTERNAL FILES) ---
function createCardAudio(initialEnabled = true) {
  let enabled = !!initialEnabled;
  let ctx = null;

  const ensureCtx = () => {
    if (!enabled || typeof window === 'undefined') return null;
    const AudioCtor = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtor) return null;
    if (!ctx) ctx = new AudioCtor();
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    return ctx;
  };

  const playCardSlide = () => {
    const c = ensureCtx();
    if (!c) return;
    try {
      const now = c.currentTime;
      const len = Math.floor(c.sampleRate * 0.065);
      const buf = c.createBuffer(1, len, c.sampleRate);
      const data = buf.getChannelData(0);
      for (let i = 0; i < len; i++) {
        data[i] = (Math.random() * 2 - 1) * Math.sin((i / len) * Math.PI);
      }
      const src = c.createBufferSource();
      src.buffer = buf;
      const filter = c.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.setValueAtTime(1600, now);
      filter.Q.value = 1.2;
      const gain = c.createGain();
      gain.gain.setValueAtTime(0.14, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.065);
      src.connect(filter);
      filter.connect(gain);
      gain.connect(c.destination);
      src.start(now);
    } catch (_) {}
  };

  const playSoftThud = () => {
    const c = ensureCtx();
    if (!c) return;
    try {
      const now = c.currentTime;
      const osc = c.createOscillator();
      const gain = c.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(190, now);
      osc.frequency.exponentialRampToValueAtTime(110, now + 0.09);
      gain.gain.setValueAtTime(0.11, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.095);
      osc.connect(gain);
      gain.connect(c.destination);
      osc.start(now);
      osc.stop(now + 0.1);
    } catch (_) {}
  };

  const playSuitComplete = () => {
    const c = ensureCtx();
    if (!c) return;
    try {
      const notes = [523.25, 659.25, 783.99, 1046.5];
      notes.forEach((freq, i) => {
        const now = c.currentTime + i * 0.075;
        const osc = c.createOscillator();
        const gain = c.createGain();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(freq, now);
        gain.gain.setValueAtTime(0.16, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.32);
        osc.connect(gain);
        gain.connect(c.destination);
        osc.start(now);
        osc.stop(now + 0.34);
      });
    } catch (_) {}
  };

  const playVictory = () => {
    const c = ensureCtx();
    if (!c) return;
    try {
      const notes = [523.25, 659.25, 783.99, 1046.5, 987.77, 1046.5, 1318.5];
      notes.forEach((freq, i) => {
        const now = c.currentTime + i * 0.11;
        const osc = c.createOscillator();
        const gain = c.createGain();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(freq, now);
        gain.gain.setValueAtTime(0.18, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.45);
        osc.connect(gain);
        gain.connect(c.destination);
        osc.start(now);
        osc.stop(now + 0.48);
      });
    } catch (_) {}
  };

  return {
    isEnabled: () => enabled,
    setEnabled: (v) => { enabled = !!v; },
    playCardSlide,
    playSoftThud,
    playSuitComplete,
    playVictory
  };
}

// --- MAIN COMPONENT FACTORY (READY FOR STANDALONE OR FUTURE NANAPHONE MOUNT) ---
export function createSpiderSolitaire(mountEl, options = {}) {
  if (!mountEl) throw new Error('createSpiderSolitaire requires a mount element.');

  const opts = {
    defaultSuits: [1, 2, 4].includes(Number(options.defaultSuits)) ? Number(options.defaultSuits) : 1,
    relaxedDeal: options.relaxedDeal !== false,
    soundEnabled: options.soundEnabled !== false,
    persist: options.persist !== false,
    onExit: typeof options.onExit === 'function' ? options.onExit : null,
    onActivity: typeof options.onActivity === 'function' ? options.onActivity : null,
    onGameStarted: typeof options.onGameStarted === 'function' ? options.onGameStarted : null,
    onWin: typeof options.onWin === 'function' ? options.onWin : null
  };

  let relaxedDeal = opts.relaxedDeal;
  let pendingNewSuits = opts.defaultSuits;
  let gameState = null;
  let undoStack = [];
  let isAnimating = false;
  let activeHint = null;
  let hintClearTimer = null;
  let toastTimer = null;
  let confettiRaf = null;
  let destroyed = false;

  const audio = createCardAudio(opts.soundEnabled);

  // Build root DOM
  mountEl.innerHTML = '';
  const root = document.createElement('div');
  root.className = 'nana-spider-root';
  root.innerHTML = `
    <header class="ss-topbar">
      <div class="ss-top-left">
        <button type="button" class="ss-exit-btn${opts.onExit ? ' visible' : ''}" data-ss="exit">⬅️ Back Home</button>
        <div class="ss-title">🕷️ Spider Solitaire</div>
        <span class="ss-mode-pill" data-ss="mode-pill">1 Suit • Easy</span>
      </div>
      <div class="ss-top-right">
        <div class="ss-stat-group">
          <div class="ss-stat"><span class="ss-stat-lbl">Suits</span><span class="ss-stat-val" data-ss="suits-val">0/8</span></div>
          <div class="ss-stat"><span class="ss-stat-lbl">Moves</span><span class="ss-stat-val" data-ss="moves-val">0</span></div>
          <div class="ss-stat"><span class="ss-stat-lbl">Score</span><span class="ss-stat-val" data-ss="score-val">500</span></div>
        </div>
        <button type="button" class="ss-icon-btn" data-ss="sound-btn" title="Toggle Card Sounds" aria-label="Toggle Card Sounds">🔊 Sound ON</button>
      </div>
    </header>

    <main class="ss-board" data-ss="board" aria-label="Spider Solitaire Board"></main>

    <footer class="ss-dock">
      <div class="ss-stock-wrap">
        <button type="button" class="ss-stock-btn" data-ss="stock-btn" aria-label="Deal 10 new cards">
          <div class="ss-stock-cards" data-ss="stock-cards"></div>
          <div class="ss-stock-label">
            <span class="ss-stock-title" data-ss="stock-title">Deal Cards</span>
            <span class="ss-stock-sub" data-ss="stock-sub">5 deals left</span>
          </div>
        </button>
      </div>

      <div class="ss-actions">
        <button type="button" class="ss-btn ss-btn-undo" data-ss="undo-btn">↩️ Undo</button>
        <button type="button" class="ss-btn ss-btn-hint" data-ss="hint-btn">💡 Hint</button>
        <button type="button" class="ss-btn ss-btn-new" data-ss="new-btn">🃏 New Game</button>
      </div>

      <div class="ss-foundations">
        <div class="ss-found-tray" data-ss="found-tray"></div>
      </div>
    </footer>

    <div class="ss-toast" data-ss="toast" role="status" aria-live="polite"></div>
    <div class="ss-flight-layer" data-ss="flight-layer"></div>
    <div class="ss-drag-layer" data-ss="drag-layer"></div>
    <canvas class="ss-confetti-canvas" data-ss="confetti"></canvas>

    <div class="ss-modal-backdrop" data-ss="new-modal">
      <div class="ss-modal-card">
        <h2 class="ss-modal-title">🃏 Start a New Game?</h2>
        <p class="ss-modal-sub">Tap a card to move it automatically, or hold &amp; drag it to any pile.</p>
        <div class="ss-choice-grid" data-ss="suit-choices">
          <button type="button" class="ss-choice-btn selected" data-suits="1">♠ 1 Suit<span class="ss-choice-sub">Easy (Best for Nana)</span></button>
          <button type="button" class="ss-choice-btn" data-suits="2">♠♥ 2 Suits<span class="ss-choice-sub">Medium</span></button>
          <button type="button" class="ss-choice-btn" data-suits="4">♠♥♣♦ 4 Suits<span class="ss-choice-sub">Classic</span></button>
        </div>
        <div class="ss-toggle-row">
          <div>
            <div class="ss-toggle-text">Easy Dealing (Allow Empty Spaces)</div>
            <div class="ss-toggle-sub">Lets Nana deal new cards even if a pile is empty</div>
          </div>
          <button type="button" class="ss-toggle-pill" data-ss="relaxed-toggle">ON</button>
        </div>
        <div class="ss-modal-actions">
          <button type="button" class="ss-btn" data-ss="new-cancel">Keep Playing</button>
          <button type="button" class="ss-btn ss-btn-new" data-ss="new-confirm">Deal New Game</button>
        </div>
      </div>
    </div>

    <div class="ss-modal-backdrop" data-ss="win-modal">
      <div class="ss-modal-card">
        <h2 class="ss-modal-title">🎉 Well Done!</h2>
        <p class="ss-modal-sub" data-ss="win-summary">You completed all 8 suits!</p>
        <div class="ss-modal-actions">
          <button type="button" class="ss-btn ss-btn-new" data-ss="win-play-again">🃏 Play Another Game</button>
        </div>
      </div>
    </div>
  `;
  mountEl.appendChild(root);

  const q = (name) => root.querySelector(`[data-ss="${name}"]`);
  const boardEl      = q('board');
  const stockBtn     = q('stock-btn');
  const stockCards   = q('stock-cards');
  const stockTitle   = q('stock-title');
  const stockSub     = q('stock-sub');
  const foundTray    = q('found-tray');
  const undoBtn      = q('undo-btn');
  const hintBtn      = q('hint-btn');
  const autoBtn      = q('auto-btn');
  const newBtn       = q('new-btn');
  const exitBtn      = q('exit');
  const soundBtn     = q('sound-btn');
  const modePill     = q('mode-pill');
  const suitsVal     = q('suits-val');
  const movesVal     = q('moves-val');
  const scoreVal     = q('score-val');
  const toastEl      = q('toast');
  const flightLayer  = q('flight-layer');
  const dragLayer    = q('drag-layer');
  const confettiCanvas = q('confetti');
  const newModal     = q('new-modal');
  const winModal     = q('win-modal');
  const winSummary   = q('win-summary');
  const relaxedToggleBtn = q('relaxed-toggle');

  // Create 10 permanent column containers
  const colEls = [];
  for (let i = 0; i < 10; i++) {
    const colEl = document.createElement('div');
    colEl.className = 'ss-col';
    colEl.dataset.col = String(i);
    const slot = document.createElement('div');
    slot.className = 'ss-slot-outline';
    colEl.appendChild(slot);
    boardEl.appendChild(colEl);
    colEls.push(colEl);
  }

  function notifyActivity() {
    opts.onActivity?.();
  }

  function showToast(msg, durationMs = 2400) {
    clearTimeout(toastTimer);
    toastEl.textContent = msg;
    toastEl.classList.add('show');
    toastTimer = setTimeout(() => toastEl.classList.remove('show'), durationMs);
  }

  function clearHint() {
    clearTimeout(hintClearTimer);
    hintClearTimer = null;
    activeHint = null;
    root.querySelectorAll('.is-hint-src, .is-hint-dest, .is-hint-deal').forEach(el => {
      el.classList.remove('is-hint-src', 'is-hint-dest', 'is-hint-deal');
    });
  }

  function saveToStorage() {
    if (!opts.persist || !gameState) return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        gameState,
        undoStack: undoStack.slice(-30),
        relaxedDeal,
        soundEnabled: audio.isEnabled()
      }));
    } catch (_) {}
  }

  function loadFromStorage() {
    if (!opts.persist) return false;
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return false;
      const parsed = JSON.parse(raw);
      if (!parsed?.gameState || !Array.isArray(parsed.gameState.tableau) || parsed.gameState.tableau.length !== 10) {
        return false;
      }
      gameState = parsed.gameState;
      if (typeof parsed.relaxedDeal === 'boolean') relaxedDeal = parsed.relaxedDeal;
      if (typeof parsed.soundEnabled === 'boolean') audio.setEnabled(parsed.soundEnabled);
      pendingNewSuits = gameState.suitsCount || opts.defaultSuits;
      undoStack = Array.isArray(parsed.undoStack) ? parsed.undoStack.slice(-30) : [];
      return true;
    } catch (_) {
      return false;
    }
  }

  function pushUndoSnapshot() {
    undoStack.push(cloneGameState(gameState));
    if (undoStack.length > MAX_UNDO_STEPS) undoStack.shift();
  }

  // --- CARD DOM ELEMENT BUILDER ---
  function buildCardElement(card, colIdx, cardIdx, movable) {
    const el = document.createElement('div');
    const suitInfo = SUIT_META[card.suit] || SUIT_META.spades;
    el.dataset.cardId = card.id;
    el.dataset.col = String(colIdx);
    el.dataset.idx = String(cardIdx);

    if (!card.faceUp) {
      el.className = 'ss-card face-down';
      el.innerHTML = `<div class="ss-back-inner"><div class="ss-back-spider">${SPIDER_BACK_SVG}</div></div>`;
      return el;
    }

    const rankText = RANK_LABELS[card.rank] || String(card.rank);
    const suitSvg = getSuitSvg(card.suit);
    const bodyHtml = card.rank >= 11
      ? `<div class="ss-court-art">${getCourtArtSvg(card.rank, card.suit)}</div>`
      : `<div class="ss-center-pip">${suitSvg}</div>`;

    el.className = `ss-card face-up suit-${suitInfo.color}${movable ? ' movable' : ' locked'}`;
    el.innerHTML = `
      <div class="ss-card-head">
        <span class="ss-rank">${rankText}</span>
        <span class="ss-suit-mini">${suitSvg}</span>
      </div>
      <div class="ss-card-body">${bodyHtml}</div>
    `;
    return el;
  }

  // --- DYNAMIC PER-COLUMN VERTICAL COMPRESSION (NEVER CLIPS OFF BOTTOM) ---
  function computeColumnOffsets(cards, cardWidth, availHeight) {
    if (!cards.length) return { tops: [], upStep: 44 };
    const cardHeight = cardWidth * 1.38;
    let downStep = Math.max(4, Math.min(9, Math.round(cardHeight * 0.06)));
    let upStep   = Math.max(28, Math.min(48, Math.round(cardHeight * 0.33)));

    let numDown = 0;
    let numUpGaps = 0;
    for (let i = 0; i < cards.length - 1; i++) {
      if (cards[i].faceUp) numUpGaps++;
      else numDown++;
    }

    const maxStackH = Math.max(cardHeight + 12, availHeight - 6);
    const calcHeight = (ds, us) => numDown * ds + numUpGaps * us + cardHeight;

    // Compress face-down cards first so face-up rank headers stay tall and readable
    if (calcHeight(downStep, upStep) > maxStackH && numDown > 0) {
      const targetForDown = maxStackH - cardHeight - numUpGaps * upStep;
      downStep = Math.max(3, Math.floor(targetForDown / numDown));
    }
    if (calcHeight(downStep, upStep) > maxStackH && numUpGaps > 0) {
      const targetForUp = maxStackH - cardHeight - numDown * downStep;
      upStep = Math.max(18, Math.floor(targetForUp / numUpGaps));
    }
    if (calcHeight(downStep, upStep) > maxStackH && cards.length > 1) {
      const availGap = Math.max(12, maxStackH - cardHeight);
      const ratio = availGap / Math.max(1, numDown * downStep + numUpGaps * upStep);
      downStep = Math.max(2, downStep * ratio);
      upStep = Math.max(14, upStep * ratio);
    }

    const tops = [0];
    let y = 0;
    for (let i = 0; i < cards.length - 1; i++) {
      y += cards[i].faceUp ? upStep : downStep;
      tops.push(Math.round(y));
    }
    return { tops, upStep: Math.floor(upStep) };
  }

  function layoutAllColumnPositions() {
    const boardHeight = boardEl.clientHeight || 500;
    const padTop = parseFloat(getComputedStyle(boardEl).paddingTop) || 8;
    const padBottom = parseFloat(getComputedStyle(boardEl).paddingBottom) || 6;
    const availH = Math.max(140, boardHeight - padTop - padBottom);

    for (let colIdx = 0; colIdx < 10; colIdx++) {
      const colEl = colEls[colIdx];
      const cards = gameState.tableau[colIdx];
      const cardWidth = colEl.clientWidth || 90;
      const { tops, upStep } = computeColumnOffsets(cards, cardWidth, availH);
      colEl.style.setProperty('--ss-col-up-step', `${Math.max(14, upStep)}px`);
      const cardDomList = colEl.querySelectorAll('.ss-card');
      cardDomList.forEach((el, i) => {
        el.style.top = `${tops[i] ?? 0}px`;
        el.style.zIndex = String(i + 2);
      });
    }
  }

  function renderHeaderAndDock() {
    const modeLabel = gameState.suitsCount === 4
      ? '4 Suits • Classic'
      : gameState.suitsCount === 2 ? '2 Suits • Medium' : '1 Suit • Easy';
    modePill.textContent = modeLabel;
    suitsVal.textContent = `${gameState.completed.length}/8`;
    movesVal.textContent = String(gameState.moves);
    scoreVal.textContent = String(gameState.score);
    undoBtn.disabled = undoStack.length === 0;
    if (autoBtn) {
      autoBtn.style.display = canAutoFinishGame(gameState) ? 'inline-flex' : 'none';
    }
    soundBtn.textContent = audio.isEnabled() ? '🔊 Sound ON' : '🔇 Muted';

    // Stock pile (fanned red spider decks: 5 -> 0) inside unified Deal Cards button
    const dealsLeft = Math.floor(gameState.stock.length / 10);
    stockBtn.disabled = dealsLeft === 0;
    stockCards.innerHTML = '';
    if (dealsLeft === 0) {
      stockCards.innerHTML = `<div class="ss-stock-empty-slot">Empty</div>`;
      stockTitle.textContent = 'No Deals Left';
      stockSub.textContent = 'All 104 cards dealt';
    } else {
      for (let i = 0; i < dealsLeft; i++) {
        const cardBack = document.createElement('div');
        cardBack.className = 'ss-stock-pile-card';
        cardBack.style.left = `${i * 10}px`;
        cardBack.style.zIndex = String(i + 1);
        cardBack.innerHTML = `<div class="ss-back-inner"><div class="ss-back-spider">${SPIDER_BACK_SVG}</div></div>`;
        stockCards.appendChild(cardBack);
      }
      stockTitle.textContent = 'Deal Cards';
      stockSub.textContent = dealsLeft === 1 ? '1 deal left' : `${dealsLeft} deals left`;
    }

    // Completed suit foundations (hide cramped 0/8 placeholder when empty; show fanned Kings once suits complete)
    foundTray.innerHTML = '';
    const foundWrap = foundTray.parentElement;
    if (gameState.completed.length === 0) {
      if (foundWrap) foundWrap.style.display = 'none';
    } else {
      if (foundWrap) foundWrap.style.display = '';
      gameState.completed.forEach((suit, idx) => {
        const info = SUIT_META[suit] || SUIT_META.spades;
        const fc = document.createElement('div');
        fc.className = `ss-found-card suit-${info.color}`;
        fc.style.right = `${(gameState.completed.length - 1 - idx) * 14}px`;
        fc.style.zIndex = String(idx + 1);
        fc.innerHTML = `
          <div class="ss-found-top"><span>K</span><span>${info.symbol}</span></div>
          <div class="ss-found-pip">${getSuitSvg(suit)}</div>
        `;
        foundTray.appendChild(fc);
      });
    }
  }

  function renderBoard(hiddenCardIds = null) {
    for (let colIdx = 0; colIdx < 10; colIdx++) {
      const colEl = colEls[colIdx];
      // Preserve the slot outline element
      const slot = colEl.firstElementChild;
      colEl.innerHTML = '';
      colEl.appendChild(slot);
      colEl.classList.remove('is-drop-target', 'is-hint-dest');

      const cards = gameState.tableau[colIdx];
      cards.forEach((card, cardIdx) => {
        const movable = card.faceUp && isMovableStack(gameState.tableau, colIdx, cardIdx);
        const cardEl = buildCardElement(card, colIdx, cardIdx, movable);
        if (hiddenCardIds && hiddenCardIds.has(card.id)) {
          cardEl.style.opacity = '0';
        }
        colEl.appendChild(cardEl);
      });
    }
    layoutAllColumnPositions();
    renderHeaderAndDock();
  }

  // --- SMOOTH FLIGHT ANIMATIONS ---
  function animateStackFlight(cards, startRects, dstCol, onDone) {
    if (!cards.length || !startRects.length) {
      onDone?.();
      return;
    }
    const dstColEl = colEls[dstCol];
    const dstCardEls = cards.map(c => dstColEl.querySelector(`[data-card-id="${c.id}"]`)).filter(Boolean);
    if (!dstCardEls.length) {
      onDone?.();
      return;
    }

    const firstStart = startRects[0];
    const firstEnd = dstCardEls[0].getBoundingClientRect();
    const stackWrap = document.createElement('div');
    stackWrap.className = 'ss-flying-stack';
    stackWrap.style.width = `${firstStart.width}px`;
    stackWrap.style.transform = `translate3d(${firstStart.left}px, ${firstStart.top}px, 0)`;

    cards.forEach((card, i) => {
      const clone = buildCardElement(card, dstCol, i, true);
      const r = startRects[i] || firstStart;
      clone.style.position = 'absolute';
      clone.style.left = '0';
      clone.style.top = `${r.top - firstStart.top}px`;
      clone.style.width = `${firstStart.width}px`;
      clone.style.zIndex = String(i + 1);
      stackWrap.appendChild(clone);
    });

    flightLayer.appendChild(stackWrap);
    void stackWrap.offsetWidth;

    stackWrap.style.transition = 'transform 220ms cubic-bezier(0.22, 1, 0.36, 1)';
    stackWrap.style.transform = `translate3d(${firstEnd.left}px, ${firstEnd.top}px, 0)`;

    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      stackWrap.remove();
      dstCardEls.forEach(el => { el.style.opacity = ''; });
      onDone?.();
    };
    stackWrap.addEventListener('transitionend', finish, { once: true });
    setTimeout(finish, 260);
  }

  function animateCompletedSuitFlight(completedRuns) {
    if (!completedRuns || !completedRuns.length) return;
    audio.playSuitComplete();
    const trayRect = foundTray.getBoundingClientRect();

    completedRuns.forEach((run, i) => {
      const colRect = colEls[run.colIdx].getBoundingClientRect();
      const card = { id: `fly_done_${Date.now()}_${i}`, suit: run.suit, rank: 13, faceUp: true };
      const el = buildCardElement(card, run.colIdx, 0, true);
      el.classList.add('ss-flying-stack');
      el.style.position = 'fixed';
      el.style.left = '0';
      el.style.top = '0';
      el.style.width = `${colRect.width}px`;
      el.style.transform = `translate3d(${colRect.left}px, ${colRect.top + 60}px, 0) scale(1.06)`;
      el.style.zIndex = String(70 + i);
      flightLayer.appendChild(el);
      void el.offsetWidth;

      const destX = trayRect.right - colRect.width * 0.65;
      const destY = trayRect.top + 4;
      el.style.transition = 'transform 460ms cubic-bezier(0.22, 1, 0.36, 1), opacity 460ms ease';
      el.style.transform = `translate3d(${destX}px, ${destY}px, 0) scale(0.55)`;
      el.style.opacity = '0.25';
      setTimeout(() => el.remove(), 500);
    });

    const suitName = SUIT_META[completedRuns[completedRuns.length - 1].suit]?.label || 'Suit';
    showToast(`✨ ${suitName} Completed! (${gameState.completed.length} of 8)`, 3000);
  }

  function checkVictoryAndCelebrate() {
    if (gameState.completed.length < 8) return;
    audio.playVictory();
    winSummary.textContent = `You completed all 8 suits in ${gameState.moves} moves (Score: ${gameState.score})!`;
    winModal.classList.add('open');
    startConfetti();
    opts.onWin?.({
      suitsCount: gameState.suitsCount,
      moves: gameState.moves,
      score: gameState.score,
      elapsedSec: Math.max(1, Math.round((Date.now() - (gameState.startedAt || Date.now())) / 1000))
    });
  }

  function startConfetti() {
    stopConfetti();
    const ctx = confettiCanvas.getContext('2d');
    if (!ctx) return;
    confettiCanvas.width = root.clientWidth;
    confettiCanvas.height = root.clientHeight;
    const colors = ['#fde047', '#4ade80', '#38bdf8', '#f87171', '#ffffff', '#fb923c'];
    const pieces = Array.from({ length: 85 }, () => ({
      x: Math.random() * confettiCanvas.width,
      y: -20 - Math.random() * 260,
      w: 8 + Math.random() * 8,
      h: 5 + Math.random() * 6,
      vx: (Math.random() - 0.5) * 3.2,
      vy: 2.2 + Math.random() * 3.6,
      rot: Math.random() * Math.PI * 2,
      vrot: (Math.random() - 0.5) * 0.14,
      color: colors[Math.floor(Math.random() * colors.length)]
    }));

    const startMs = Date.now();
    const tick = () => {
      if (destroyed || Date.now() - startMs > 6500) {
        ctx.clearRect(0, 0, confettiCanvas.width, confettiCanvas.height);
        confettiRaf = null;
        return;
      }
      ctx.clearRect(0, 0, confettiCanvas.width, confettiCanvas.height);
      pieces.forEach(p => {
        p.x += p.vx;
        p.y += p.vy;
        p.rot += p.vrot;
        if (p.y > confettiCanvas.height + 20) {
          p.y = -15;
          p.x = Math.random() * confettiCanvas.width;
        }
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        ctx.fillStyle = p.color;
        ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
        ctx.restore();
      });
      confettiRaf = requestAnimationFrame(tick);
    };
    confettiRaf = requestAnimationFrame(tick);
  }

  function stopConfetti() {
    if (confettiRaf) {
      cancelAnimationFrame(confettiRaf);
      confettiRaf = null;
    }
    const ctx = confettiCanvas.getContext('2d');
    if (ctx) ctx.clearRect(0, 0, confettiCanvas.width, confettiCanvas.height);
  }

  // --- EXECUTE MOVE (WITH OPTIONAL FLIGHT ANIMATION) ---
  function commitMove(srcCol, cardIdx, dstCol, animateFlight = false) {
    if (isAnimating) return false;
    if (!canDropStackOnColumn(gameState.tableau, srcCol, cardIdx, dstCol)) return false;

    clearHint();
    notifyActivity();

    const movingCards = gameState.tableau[srcCol].slice(cardIdx);
    const startRects = animateFlight
      ? movingCards.map(c => colEls[srcCol].querySelector(`[data-card-id="${c.id}"]`)?.getBoundingClientRect()).filter(Boolean)
      : [];

    const willAnimate = animateFlight && startRects.length === movingCards.length;
    pushUndoSnapshot();
    const res = applyMove(gameState, srcCol, cardIdx, dstCol, { deferCompletion: willAnimate });
    if (!res) {
      undoStack.pop();
      return false;
    }

    audio.playCardSlide();
    if (!gameState.countedInStats) {
      gameState.countedInStats = true;
      undoStack.forEach(s => { s.countedInStats = true; });
      opts.onGameStarted?.({ suitsCount: gameState.suitsCount });
    }
    saveToStorage();

    if (willAnimate) {
      isAnimating = true;
      const hiddenIds = new Set(movingCards.map(c => c.id));
      renderBoard(hiddenIds);
      animateStackFlight(movingCards, startRects, dstCol, () => {
        isAnimating = false;
        const completedRuns = extractCompletedRuns(gameState);
        if (completedRuns.length) {
          saveToStorage();
          renderBoard();
          animateCompletedSuitFlight(completedRuns);
          checkVictoryAndCelebrate();
        }
      });
    } else {
      renderBoard();
      if (res.completedRuns.length) {
        animateCompletedSuitFlight(res.completedRuns);
        checkVictoryAndCelebrate();
      }
    }
    return true;
  }

  function shakeCardEl(colIdx, cardIdx) {
    const card = gameState.tableau[colIdx]?.[cardIdx];
    if (!card) return;
    const el = colEls[colIdx]?.querySelector(`[data-card-id="${card.id}"]`);
    if (!el) return;
    el.classList.remove('is-shake');
    void el.offsetWidth;
    el.classList.add('is-shake');
    setTimeout(() => el.classList.remove('is-shake'), 380);
  }

  function tryAutoMoveByTap(colIdx, cardIdx) {
    const move = findBestMoveForTap(gameState.tableau, colIdx, cardIdx);
    if (!move) {
      audio.playSoftThud();
      shakeCardEl(colIdx, cardIdx);
      return false;
    }
    return commitMove(move.srcCol, move.cardIdx, move.dstCol, true);
  }

  // --- UNIFIED TOUCH / MOUSE GESTURE ENGINE (HOLD TO DRAG + TAP FOR BEST AUTO-MOVE) ---
  let gesture = null;

  function findBestDropColumn(dragRect, srcCol, cardIdx) {
    let bestCol = -1;
    let bestScore = -Infinity;
    const dragCenterX = dragRect.left + dragRect.width / 2;

    for (let dstCol = 0; dstCol < 10; dstCol++) {
      if (!canDropStackOnColumn(gameState.tableau, srcCol, cardIdx, dstCol)) continue;
      const colRect = colEls[dstCol].getBoundingClientRect();
      const overlapX = Math.max(0, Math.min(dragRect.right, colRect.right) - Math.max(dragRect.left, colRect.left));
      const distX = Math.abs(dragCenterX - (colRect.left + colRect.width / 2));

      // Forgiving drop zone for senior hands: overlap OR within 0.65 card width of column center
      if (overlapX > 0 || distX <= dragRect.width * 0.65) {
        const proximityScore = overlapX * 3 - distX;
        if (proximityScore > bestScore) {
          bestScore = proximityScore;
          bestCol = dstCol;
        }
      }
    }
    return bestCol;
  }

  function updateDropTargetHighlight(dstCol) {
    colEls.forEach((el, idx) => {
      const isTarget = idx === dstCol;
      el.classList.toggle('is-drop-target', isTarget);
      const lastCard = el.querySelector('.ss-card:last-of-type');
      if (lastCard) lastCard.classList.toggle('is-drop-highlight', isTarget);
    });
  }

  function beginDragMode() {
    if (!gesture || gesture.isDragging) return;
    gesture.isDragging = true;
    clearTimeout(gesture.holdTimer);
    gesture.holdTimer = null;
    clearHint();

    const { srcCol, cardIdx, pointerType } = gesture;
    const cards = gameState.tableau[srcCol].slice(cardIdx);
    const sourceEls = cards.map(c => colEls[srcCol].querySelector(`[data-card-id="${c.id}"]`)).filter(Boolean);
    if (!sourceEls.length) return;

    const firstRect = sourceEls[0].getBoundingClientRect();
    const touchLiftY = pointerType === 'touch' ? 24 : 4;
    gesture.grabOffsetX = gesture.curX - firstRect.left;
    gesture.grabOffsetY = gesture.curY - firstRect.top + touchLiftY;
    gesture.firstRect = firstRect;
    gesture.sourceEls = sourceEls;

    const stackWrap = document.createElement('div');
    stackWrap.className = 'ss-drag-stack';
    stackWrap.style.width = `${firstRect.width}px`;

    cards.forEach((card, i) => {
      const clone = buildCardElement(card, srcCol, cardIdx + i, true);
      const r = sourceEls[i].getBoundingClientRect();
      clone.style.position = 'absolute';
      clone.style.left = '0';
      clone.style.top = `${r.top - firstRect.top}px`;
      clone.style.width = `${firstRect.width}px`;
      clone.style.zIndex = String(i + 1);
      stackWrap.appendChild(clone);
      sourceEls[i].classList.add('is-dragging-hidden');
    });

    dragLayer.innerHTML = '';
    dragLayer.appendChild(stackWrap);
    gesture.dragStackEl = stackWrap;

    if (pointerType === 'touch' && navigator.vibrate) {
      try { navigator.vibrate(10); } catch (_) {}
    }
    positionDraggedStack();
  }

  function positionDraggedStack() {
    if (!gesture || !gesture.isDragging || !gesture.dragStackEl) return;
    const x = gesture.curX - gesture.grabOffsetX;
    const y = gesture.curY - gesture.grabOffsetY;
    gesture.dragX = x;
    gesture.dragY = y;
    gesture.dragStackEl.style.transform = `translate3d(${x}px, ${y}px, 0) scale(1.04)`;

    const probeRect = {
      left: x,
      right: x + gesture.firstRect.width,
      top: y,
      bottom: y + gesture.firstRect.height,
      width: gesture.firstRect.width,
      height: gesture.firstRect.height
    };
    const dstCol = findBestDropColumn(probeRect, gesture.srcCol, gesture.cardIdx);
    gesture.hoverDstCol = dstCol;
    updateDropTargetHighlight(dstCol);
  }

  function cleanupGesture() {
    if (!gesture) return;
    clearTimeout(gesture.holdTimer);
    window.removeEventListener('pointermove', onPointerMove);
    window.removeEventListener('pointerup', onPointerUp);
    window.removeEventListener('pointercancel', onPointerCancel);
    updateDropTargetHighlight(-1);
    gesture = null;
  }

  function onPointerMove(e) {
    if (!gesture || e.pointerId !== gesture.pointerId) return;
    gesture.curX = e.clientX;
    gesture.curY = e.clientY;
    if (!gesture.isDragging) {
      const dx = e.clientX - gesture.startX;
      const dy = e.clientY - gesture.startY;
      if (Math.hypot(dx, dy) >= MOVE_DRAG_PX) {
        beginDragMode();
      }
    } else {
      positionDraggedStack();
    }
  }

  function onPointerUp(e) {
    if (!gesture || e.pointerId !== gesture.pointerId) return;
    const g = gesture;
    cleanupGesture();

    if (!g.isDragging) {
      // Quick touch/click -> automatically move to best valid option!
      tryAutoMoveByTap(g.srcCol, g.cardIdx);
      return;
    }

    // Drag release
    if (g.hoverDstCol >= 0) {
      dragLayer.innerHTML = '';
      commitMove(g.srcCol, g.cardIdx, g.hoverDstCol, false);
    } else if (g.dragStackEl && g.firstRect) {
      // Smoothly glide back home
      isAnimating = true;
      audio.playSoftThud();
      const wrap = g.dragStackEl;
      wrap.style.transition = 'transform 180ms cubic-bezier(0.22, 1, 0.36, 1)';
      wrap.style.transform = `translate3d(${g.firstRect.left}px, ${g.firstRect.top}px, 0) scale(1)`;
      const done = () => {
        wrap.remove();
        g.sourceEls?.forEach(el => el.classList.remove('is-dragging-hidden'));
        isAnimating = false;
      };
      wrap.addEventListener('transitionend', done, { once: true });
      setTimeout(done, 210);
    } else {
      dragLayer.innerHTML = '';
      g.sourceEls?.forEach(el => el.classList.remove('is-dragging-hidden'));
    }
  }

  function onPointerCancel(e) {
    if (!gesture || e.pointerId !== gesture.pointerId) return;
    const g = gesture;
    cleanupGesture();
    dragLayer.innerHTML = '';
    g.sourceEls?.forEach(el => el.classList.remove('is-dragging-hidden'));
  }

  boardEl.addEventListener('pointerdown', (e) => {
    if (isAnimating || (e.pointerType === 'mouse' && e.button !== 0)) return;
    const cardEl = e.target.closest('.ss-card.face-up');
    if (!cardEl) return;
    const srcCol = Number(cardEl.dataset.col);
    const cardIdx = Number(cardEl.dataset.idx);
    if (!Number.isInteger(srcCol) || !Number.isInteger(cardIdx)) return;

    notifyActivity();
    if (!isMovableStack(gameState.tableau, srcCol, cardIdx)) {
      audio.playSoftThud();
      shakeCardEl(srcCol, cardIdx);
      return;
    }

    e.preventDefault();
    cleanupGesture();
    gesture = {
      pointerId: e.pointerId,
      pointerType: e.pointerType || 'touch',
      srcCol,
      cardIdx,
      startX: e.clientX,
      startY: e.clientY,
      curX: e.clientX,
      curY: e.clientY,
      isDragging: false,
      hoverDstCol: -1,
      holdTimer: setTimeout(beginDragMode, HOLD_DRAG_MS)
    };
    window.addEventListener('pointermove', onPointerMove, { passive: true });
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerCancel);
  });

  // --- DEAL 10 CARDS FROM STOCK ---
  function handleDealClick() {
    if (isAnimating || gameState.stock.length < 10) return;
    clearHint();
    notifyActivity();

    if (!relaxedDeal && gameState.tableau.some(col => col.length === 0)) {
      audio.playSoftThud();
      colEls.forEach((el, idx) => {
        if (gameState.tableau[idx].length === 0) el.classList.add('is-hint-dest');
      });
      showToast('Place a card in each empty space before dealing', 3000);
      hintClearTimer = setTimeout(clearHint, 3000);
      return;
    }

    const stockRect = stockBtn.getBoundingClientRect();
    pushUndoSnapshot();
    const res = applyDealRow(gameState, relaxedDeal, { deferCompletion: true });
    if (!res.ok) {
      undoStack.pop();
      return;
    }

    isAnimating = true;
    if (!gameState.countedInStats) {
      gameState.countedInStats = true;
      undoStack.forEach(s => { s.countedInStats = true; });
      opts.onGameStarted?.({ suitsCount: gameState.suitsCount });
    }
    saveToStorage();
    const dealtIds = new Set(res.dealt.map(d => d.card.id));
    renderBoard(dealtIds);

    let remaining = res.dealt.length;
    res.dealt.forEach((entry, i) => {
      setTimeout(() => {
        audio.playCardSlide();
        const dstEl = colEls[entry.colIdx].querySelector(`[data-card-id="${entry.card.id}"]`);
        if (!dstEl) {
          remaining--;
          if (remaining <= 0) finishDeal();
          return;
        }
        const endRect = dstEl.getBoundingClientRect();
        const fly = buildCardElement(entry.card, entry.colIdx, 0, true);
        fly.classList.add('ss-flying-stack');
        fly.style.position = 'fixed';
        fly.style.left = '0';
        fly.style.top = '0';
        fly.style.width = `${endRect.width}px`;
        fly.style.transform = `translate3d(${stockRect.left + 12}px, ${stockRect.top}px, 0) scale(0.65)`;
        fly.style.zIndex = String(65 + i);
        flightLayer.appendChild(fly);
        void fly.offsetWidth;

        fly.style.transition = 'transform 220ms cubic-bezier(0.22, 1, 0.36, 1)';
        fly.style.transform = `translate3d(${endRect.left}px, ${endRect.top}px, 0) scale(1)`;

        let done = false;
        const onEnd = () => {
          if (done) return;
          done = true;
          fly.remove();
          dstEl.style.opacity = '';
          remaining--;
          if (remaining <= 0) finishDeal();
        };
        fly.addEventListener('transitionend', onEnd, { once: true });
        setTimeout(onEnd, 260);
      }, i * 36);
    });

    function finishDeal() {
      isAnimating = false;
      const completedRuns = extractCompletedRuns(gameState);
      if (completedRuns.length) {
        saveToStorage();
        renderBoard();
        animateCompletedSuitFlight(completedRuns);
        checkVictoryAndCelebrate();
      }
    }
  }

  // --- UNDO ---
  function handleUndo() {
    if (isAnimating || !undoStack.length) return;
    clearHint();
    notifyActivity();
    gameState = undoStack.pop();
    audio.playCardSlide();
    renderBoard();
    saveToStorage();
  }

  // --- HINT ---
  function handleHint() {
    if (isAnimating) return;
    clearHint();
    notifyActivity();

    const best = findBestHintMove(gameState.tableau);
    if (!best) {
      if (gameState.stock.length >= 10) {
        stockBtn.classList.add('is-hint-deal');
        showToast('💡 Tap "Deal Cards" for 10 new cards!', 3500);
        hintClearTimer = setTimeout(clearHint, 3800);
      } else {
        showToast('No moves left — tap Undo or New Game', 3500);
      }
      return;
    }

    activeHint = best;
    const srcCards = gameState.tableau[best.srcCol].slice(best.cardIdx);
    srcCards.forEach(c => {
      colEls[best.srcCol].querySelector(`[data-card-id="${c.id}"]`)?.classList.add('is-hint-src');
    });

    const dstCards = gameState.tableau[best.dstCol];
    if (dstCards.length === 0) {
      colEls[best.dstCol].classList.add('is-hint-dest');
    } else {
      const topDst = dstCards[dstCards.length - 1];
      colEls[best.dstCol].querySelector(`[data-card-id="${topDst.id}"]`)?.classList.add('is-hint-dest');
    }

    const lead = srcCards[0];
    const leadLabel = `${RANK_LABELS[lead.rank]}${SUIT_META[lead.suit].symbol}`;
    showToast(`💡 Tap the glowing ${leadLabel} to move it`, 3500);
    hintClearTimer = setTimeout(clearHint, 4000);
  }

  // --- NEW GAME & OPTIONS MODAL ---
  function syncNewModalUI() {
    root.querySelectorAll('[data-suits]').forEach(btn => {
      btn.classList.toggle('selected', Number(btn.dataset.suits) === pendingNewSuits);
    });
    relaxedToggleBtn.textContent = relaxedDeal ? 'ON' : 'Classic';
    relaxedToggleBtn.classList.toggle('off', !relaxedDeal);
  }

  function startNewGame(suitsCount = pendingNewSuits) {
    clearHint();
    stopConfetti();
    newModal.classList.remove('open');
    winModal.classList.remove('open');
    gameState = createInitialGameState(suitsCount);
    pendingNewSuits = gameState.suitsCount;
    undoStack = [];
    renderBoard();
    saveToStorage();
    audio.playCardSlide();
    notifyActivity();
  }

  function openNewGameModal() {
    notifyActivity();
    pendingNewSuits = gameState.suitsCount;
    syncNewModalUI();
    newModal.classList.add('open');
  }

  function runAutoFinish() {
    if (isAnimating || !canAutoFinishGame(gameState)) return;
    let steps = 0;
    const step = () => {
      if (destroyed || gameState.completed.length >= 8 || steps >= 64) return;
      if (isAnimating) {
        setTimeout(step, 90);
        return;
      }
      const best = findBestHintMove(gameState.tableau);
      if (!best) return;
      steps++;
      if (commitMove(best.srcCol, best.cardIdx, best.dstCol, true)) {
        setTimeout(step, 210);
      }
    };
    step();
  }

  // Wire UI buttons
  stockBtn.addEventListener('click', handleDealClick);
  undoBtn.addEventListener('click', handleUndo);
  hintBtn.addEventListener('click', handleHint);
  autoBtn?.addEventListener('click', runAutoFinish);
  modePill?.addEventListener('click', openNewGameModal);
  newBtn.addEventListener('click', openNewGameModal);
  q('new-cancel').addEventListener('click', () => newModal.classList.remove('open'));
  q('new-confirm').addEventListener('click', () => startNewGame(pendingNewSuits));
  q('win-play-again').addEventListener('click', () => startNewGame(gameState.suitsCount));
  soundBtn.addEventListener('click', () => {
    audio.setEnabled(!audio.isEnabled());
    renderHeaderAndDock();
    saveToStorage();
  });
  relaxedToggleBtn.addEventListener('click', () => {
    relaxedDeal = !relaxedDeal;
    syncNewModalUI();
    saveToStorage();
  });
  root.querySelectorAll('[data-suits]').forEach(btn => {
    btn.addEventListener('click', () => {
      pendingNewSuits = Number(btn.dataset.suits) || 1;
      syncNewModalUI();
    });
  });
  if (opts.onExit) {
    exitBtn.addEventListener('click', () => opts.onExit());
  }

  // Keep layout perfectly fitted on orientation change or window resize
  let resizeObserver = null;
  const onResize = () => { if (gameState) layoutAllColumnPositions(); };
  if (typeof ResizeObserver !== 'undefined') {
    resizeObserver = new ResizeObserver(onResize);
    resizeObserver.observe(boardEl);
  }
  window.addEventListener('resize', onResize);

  // Boot game (resume saved game or deal fresh 1-suit game)
  if (!loadFromStorage()) {
    gameState = createInitialGameState(opts.defaultSuits);
  }
  renderBoard();
  saveToStorage();

  return {
    newGame: (suits = gameState.suitsCount) => startNewGame(suits),
    undo: handleUndo,
    hint: handleHint,
    deal: handleDealClick,
    relayout: () => layoutAllColumnPositions(),
    cancelInteraction: () => {
      const g = gesture;
      cleanupGesture();
      dragLayer.innerHTML = '';
      g?.sourceEls?.forEach(el => el.classList.remove('is-dragging-hidden'));
      clearHint();
      newModal.classList.remove('open');
    },
    getState: () => cloneGameState(gameState),
    destroy: () => {
      destroyed = true;
      cleanupGesture();
      clearHint();
      stopConfetti();
      clearTimeout(toastTimer);
      resizeObserver?.disconnect();
      window.removeEventListener('resize', onResize);
      mountEl.innerHTML = '';
    }
  };
}

// Auto-mount cleanly when opened directly via games/spider-solitaire.html
if (typeof document !== 'undefined') {
  const autoMount = document.getElementById('spider-solitaire-app');
  if (autoMount && !window.__NANA_SPIDER_NO_AUTOBOOT) {
    window.__nanaSpiderGame = createSpiderSolitaire(autoMount, {
      defaultSuits: 1,
      relaxedDeal: true,
      soundEnabled: true
    });
  }
}
