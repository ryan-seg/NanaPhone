import {
  $, NanaCore, ref, update, push, onValue, query, limitToLast
} from "./nana-core.js?v=2.9.4";

const {
  CONFIG, SERVICE_TOKEN, PORTAL_NODE_ID, role, activeFamilyMember,
  basePath, db, refs, settings, state, hooks
} = NanaCore;

let savedChatScrollTop = null;
let chatIntersectionObserver = null;
let keyboardHideTimer = null;
let lastKeyTapMs = 0;
let lastLetterTapMs = 0;
let lastKeyChar = null;
let lastChatSendMs = 0;
let lastRenderedKbLayout = null;
let lastRenderedReadAloud = null;
const pendingReadMarks = new Set();

// --- NANA'S PERSONALIZED TYPO & RUN-TOGETHER WORD AUTO-FIXER ---
const NANA_TYPO_MAP = {
  // Pronouns & common 'l' for 'I' substitutions
  "l": "I", "i": "I", "im": "I'm", "iam": "I am", "lam": "I am", "an": "am",
  "ido": "I do", "ldo": "I do", "lhope": "I hope", "ihope": "I hope", "dohope": "do hope",
  "lhave": "I have", "ihave": "I have", "lwill": "I will", "iwill": "I will",
  "ljust": "I just", "ijust": "I just", "lfeel": "I feel", "ifeel": "I feel",
  "ltook": "I took", "lthink": "I think", "lcan": "I can", "lknow": "I know",
  "lwishyou": "I wish you", "hopeyou": "hope you", "allhave": "all have",
  "withyou": "with you", "inthed": "in the", "inthe": "in the", "onthe": "on the",
  "tothe": "to the", "fothe": "for the", "forthe": "for the", "inhere": "in here",
  "lotsof": "lots of", "oflove": "of love", "lotsoflove": "lots of love",
  "loys": "lots", "loyts": "lots", "lotts": "lots", "lotttss": "lots",
  // Historical run-togethers from Nana's messages
  "ryanand": "Ryan and", "itvwas": "it was", "ltwas": "it was", "itis": "it is", "lts": "it's",
  "anhis": "and his", "allmy": "all my", "hadsome": "had some", "areally": "a really",
  "massesof": "masses of", "somany": "so many", "theyare": "they are", "itall": "it all",
  "mydarlings": "my darlings", "nanaxxxxx": "Nana xxxxx", "nanaxxxxxxxx": "Nana xxxxxxxx",
  "nanaxxxxxxxxx": "Nana xxxxxxxxx", "xxxxxxxxxxxxxc": "xxxxxxxxxxxxx",
  // Common single-letter slips & neighbor hits
  "goog": "good", "goood": "good", "goodnews": "good news",
  "jusr": "just", "sust": "just", "thar": "that", "tht": "that", "tat": "that", "tha": "that", "tthat": "that",
  "fot": "for", "forr": "for", "yiu": "you", "yout": "your", "yoiur": "your", "yoryoiur": "your",
  "wou": "you", "yo": "you", "tu": "to", "nd": "and", "ut": "but", "ny": "my", "gid": "God",
  "tis": "this", "thi": "this", "thhis": "this", "afrer": "after", "wether": "weather",
  "thankks": "thanks", "tseem": "seem", "begining": "beginning", "succesful": "successful",
  "diffference": "difference", "tomorro": "tomorrow", "pocketr": "pocket", "migh": "might",
  "mighht": "might", "sill": "will", "wiiii": "will", "wiill": "will", "wil": "will",
  "meer": "meet", "dib": "did", "mun": "Mum", "anum": "Mum", "nan": "Nana",
  "amso": "am so", "aso": "am so", "quie": "quite", "abit": "a bit", "alls": "all is",
  "cerai": "certain", "certa": "certain", "eveng": "evening", "eeniipgz": "evening",
  "enjo": "enjoy", "ennjoy": "enjoy", "enejoyed": "enjoyed", "ebjoy": "enjoy", "dnjoy": "enjoy", "njoy": "enjoy",
  "aftenoon": "afternoon", "ahternoon": "afternoon", "ahternoonsleep": "afternoon sleep",
  "mimutes": "minutes", "minuit": "minute", "miiinute": "minute",
  "togther": "together", "tigetherv": "together", "togeth": "together",
  "happpy": "happy", "veryhapppy": "very happy", "loveily": "lovely",
  "dellbght": "delightful", "trilled": "thrilled", "thrlled": "thrilled",
  "frisfrared": "frustrated", "relaxsd": "relaxed", "arrve": "arrive",
  "recieved": "received", "appreciats": "appreciates", "strorms": "storms",
  "eyses": "eyes", "eysewere": "eyes were", "glssses": "glasses", "glassssout": "glasses out",
  "hearin": "hearing", "scivens": "Scrivens", "rolatori": "rollator",
  "neiighboutrs": "neighbours", "eighours": "neighbours", "fiiend": "friends", "friiends": "friends",
  "somone": "someone", "cansomr": "can some", "asssist": "assist",
  "goddess": "God", "godbess": "God bless", "godhelllp": "God help", "nightnight": "night night",
  "dunt": "don't", "dont": "don't", "doesnt": "doesn't", "cant": "can't", "wont": "won't",
  "tg": "TG"
};

// Two-word phrase chains so Nana can build full sentences by tapping suggestions in sequence
const NANA_TRIGRAM_MAP = {
  "hi my": ["loves", "love", "darling"],
  "my love": ["I do hope", "how are you", "thanks so much"],
  "my loves": ["I do hope", "hope all is well", "have a good day"],
  "good morning": ["my loves", "my love", "I hope"],
  "i do": ["hope", "enjoy", "know"],
  "do hope": ["you are all well", "you enjoy your", "your journey"],
  "i hope": ["you", "all is well", "your day"],
  "hope you": ["had a good day", "enjoy your evening", "are all well"],
  "hope all": ["is well", "goes well", "is fine"],
  "all is": ["well", "well with you", "good here"],
  "i am": ["so pleased", "sure", "feeling better"],
  "am so": ["pleased", "sorry", "happy"],
  "so pleased": ["to see", "you had", "all is well"],
  "so good": ["to see you", "to hear", "to be together"],
  "enjoy your": ["evening", "day", "holiday"],
  "have a": ["good day", "lovely evening", "good night"],
  "had a": ["good night", "lovely day", "lovely visit"],
  "lots of": ["love", "love as always", "love Mum and Nana"],
  "of love": ["to you all", "as always Mum", "Nana xxxxx"],
  "love to": ["you all", "both of you", "everyone"],
  "take care": ["of yourselves", "my loves", "on your journey"],
  "care of": ["yourselves", "yourself", "each other"],
  "god bless": ["you all", "you both", "my darling"],
  "bless you": ["all", "both", "my loves"],
  "night night": ["God bless", "all my loves", "Mum xxxxx"],
  "thank you": ["so much", "for all your help", "my love"],
  "thanks so": ["much", "very much", "much for"],
  "in the": ["garden", "afternoon", "morning"],
  "on the": ["way", "seafront", "phone"],
  "looking forward": ["to seeing you", "to our chat", "to it"]
};

// Single-word next-word predictions
const NANA_NEXT_WORD_MAP = {
  "hi": ["my love", "my loves", "darling"],
  "oh": ["my darling", "my love", "so pleased"],
  "my": ["love", "loves", "darling"],
  "i": ["do hope", "am so", "have had"],
  "do": ["hope", "enjoy", "know"],
  "hope": ["you", "all is well", "your journey"],
  "am": ["so pleased", "sure", "certain"],
  "so": ["pleased", "good to see", "lovely"],
  "you": ["all", "both", "enjoy"],
  "enjoy": ["your", "the", "it all"],
  "your": ["evening", "journey", "visit"],
  "have": ["a good day", "had a", "been"],
  "good": ["morning", "night", "to see you"],
  "morning": ["my loves", "my love", "everyone"],
  "sunny": ["day", "morning", "afternoon"],
  "lots": ["of love", "of", "love"],
  "of": ["love", "yourselves", "you both"],
  "love": ["to you all", "Mum", "Nana"],
  "take": ["care", "good care", "care my loves"],
  "care": ["of yourselves", "my loves", "of yourself"],
  "god": ["bless you", "bless you all", "bless my darling"],
  "bless": ["you all", "you both", "Mum"],
  "night": ["night", "God bless", "Mum"],
  "safe": ["and sound", "journey", "home"],
  "happy": ["smiling faces", "to see", "day"],
  "smiling": ["faces", "and happy", "today"],
  "hugs": ["and kisses", "to you all", "Nana"],
  "keep": ["fit and well", "well", "warm"],
  "fit": ["and well", "and happy", "today"],
  "catch": ["up on", "up", "you later"],
  "thanks": ["so much", "for your", "once again"],
  "thank": ["you so much", "goodness", "you"],
  "in": ["the garden", "good time", "my room"],
  "the": ["garden", "weather", "seafront"],
  "for": ["lunch", "supper", "all your help"],
  "looking": ["forward to", "so well", "good"],
  "all": ["is well", "my love", "the difference"],
  "mum": ["and Nana", "Nana", "xxxxxxx"],
  "nana": ["xxxxxxx", "and Supanana", "God bless"]
};

// Core vocabulary sorted by frequency in Nana's messages for instant prefix & fuzzy matching
const NANA_VOCAB = [
  "love", "loves", "darling", "darlings", "hope", "hoping", "enjoy", "enjoyed", "enjoying",
  "good", "night", "morning", "afternoon", "evening", "day", "today", "tomorrow", "weekend",
  "lovely", "pleased", "delighted", "thrilled", "certain", "sure", "always", "usually",
  "family", "company", "visit", "visited", "visitors", "welcome", "wonderful", "super",
  "garden", "seafront", "beach", "sunshine", "sunny", "weather", "forecast", "shade", "warm",
  "peace", "serenity", "blossom", "tree", "outside", "walk", "walking", "sitting", "reading",
  "lunch", "supper", "breakfast", "drink", "quiche", "cheese", "onion", "salad", "fruit",
  "journey", "drive", "traffic", "roads", "car", "flight", "holiday", "home", "house",
  "bedroom", "bathroom", "room", "floor", "flooring", "freezer", "lobby", "seat", "bed",
  "sleep", "awake", "tired", "dozy", "muddled", "lazy", "busy", "occupied", "relaxed",
  "better", "well", "healthy", "happy", "smiling", "faces", "pleasure", "joy", "lucky",
  "bless", "thank", "thanks", "thankful", "thoughtful", "kindness", "appreciate", "helpful",
  "repaired", "fixed", "working", "project", "gift", "present", "photos", "news", "chat",
  "message", "call", "calling", "phone", "tablet", "glasses", "hearing", "sight", "eyes",
  "ears", "Scrivens", "hospital", "nurse", "doctor", "stockings", "shoes", "rollator",
  "wheelchair", "shul", "neighbours", "friends", "children", "wedding", "parents", "together",
  "minutes", "hours", "week", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday",
  "Saturday", "Sunday", "sorry", "please", "understand", "remember", "thinking", "longing",
  "missing", "concerning", "worried", "carefree", "trouble", "difference", "annoying",
  "Mum", "Nana", "Supanana", "Ryan", "Megan", "Gill", "Louis", "Denise", "Darien",
  "Nicky", "John", "Phil", "Zara", "Marcus", "Nicola", "Jo", "Lois", "Simon",
  "Yolanda", "Helen", "Lynda", "Steve", "Mike", "Luma", "TG", "xxxxxxx"
];

const SPLIT_PREFIXES = ["i", "l", "do", "am", "so", "in", "on", "to", "for", "all", "with", "lots", "good", "night", "very", "hope", "love", "thank", "my", "the", "had", "was", "are", "you"];
const VALID_WORD_SET = new Set([
  ...NANA_VOCAB.map(w => w.toLowerCase()),
  "i", "a", "am", "an", "as", "at", "be", "by", "do", "go", "he", "hi", "if", "in", "is", "it",
  "me", "my", "no", "of", "oh", "on", "or", "so", "to", "up", "us", "we", "all", "and", "are",
  "but", "can", "did", "for", "get", "got", "had", "has", "her", "him", "his", "how", "its",
  "lot", "not", "now", "off", "old", "one", "our", "out", "own", "see", "she", "too", "try",
  "two", "use", "was", "way", "who", "why", "you", "able", "also", "back", "been", "best",
  "both", "busy", "came", "care", "come", "cope", "days", "dear", "does", "done", "down",
  "each", "easy", "else", "even", "ever", "feel", "felt", "find", "fine", "fit", "folks",
  "fond", "free", "from", "full", "gave", "give", "glad", "goes", "gone", "great", "have",
  "hear", "help", "here", "high", "hold", "into", "jobs", "join", "just", "keep", "kept",
  "kind", "knew", "know", "lady", "last", "late", "left", "less", "life", "like", "look",
  "lost", "made", "make", "many", "meet", "miss", "more", "most", "much", "must", "near",
  "need", "next", "nice", "note", "once", "only", "open", "over", "part", "past", "plan",
  "pray", "pure", "put", "quite", "read", "real", "rest", "room", "safe", "said", "same",
  "save", "seat", "seem", "seen", "send", "sent", "shut", "side", "sit", "slow", "some",
  "soon", "sort", "stay", "step", "stop", "such", "sure", "take", "talk", "tell", "than",
  "that", "them", "then", "they", "this", "time", "told", "took", "town", "tree", "true",
  "turn", "used", "very", "wait", "wake", "walk", "want", "warm", "week", "well", "went",
  "were", "what", "when", "will", "wind", "wise", "wish", "with", "woke", "work", "year", "your"
]);

function trySplitRunTogetherWord(cleanWord) {
  if (cleanWord.length < 4 || VALID_WORD_SET.has(cleanWord)) return null;
  for (const pref of SPLIT_PREFIXES) {
    if (cleanWord.startsWith(pref) && cleanWord.length > pref.length + 1) {
      const rest = cleanWord.slice(pref.length);
      const fixedRest = NANA_TYPO_MAP[rest] || (VALID_WORD_SET.has(rest) ? rest : null);
      if (fixedRest) {
        const fixedPref = (pref === "l" || pref === "i") ? "I" : pref;
        return `${fixedPref} ${fixedRest}`;
      }
    }
  }
  return null;
}

function getEmptyBoxContextStarters() {
  const hr = new Date().getHours();
  const timeGreeting = hr < 12 ? "Good morning my loves" : (hr >= 19 ? "Night night God bless" : "Hi my loves");

  const keys = Object.keys(state.bulletinSnap || {});
  if (keys.length) {
    const lastMsg = state.bulletinSnap[keys[keys.length - 1]];
    const isFromFamily = lastMsg && !lastMsg.fromNana && lastMsg.author?.toLowerCase() !== 'nana';
    if (isFromFamily) {
      const hasPhoto = !!(lastMsg.fileId || lastMsg.photoFileId || lastMsg.imageUrl || lastMsg.photoUrl || lastMsg.photo);
      if (hasPhoto) return ["Lovely photo", "Thanks for the photos", timeGreeting];
      if (/^[❤️💋😘☘️👍\s]+$/.test(lastMsg.text || '')) {
        return ["Lots of love", "Love you too", timeGreeting];
      }
    }
  }
  return [timeGreeting, "I do hope", "Lots of love"];
}

// Compute Levenshtein edit distance for fuzzy matching (handles 1–2 letter slips)
function editDistance(a, b) {
  if (Math.abs(a.length - b.length) > 2) return 99;
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i]);
  for (let j = 1; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      dp[i][j] = a[i - 1] === b[j - 1]
        ? dp[i - 1][j - 1]
        : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[a.length][b.length];
}

function getCurrentTypingContext(rawText) {
  const val = rawText || "";
  const endsWithSpace = val.endsWith(" ");
  const parts = val.trim().split(/\s+/).filter(Boolean);
  if (!val.length) return { currentWord: "", prevWord: "", prevTwoWords: "" };
  const clean = (s) => (s || "").toLowerCase().replace(/[^a-z]/g, "");
  if (endsWithSpace) {
    const p1 = clean(parts[parts.length - 1]);
    const p2 = clean(parts[parts.length - 2]);
    return { currentWord: "", prevWord: p1, prevTwoWords: p2 ? `${p2} ${p1}` : "" };
  }
  const p1 = clean(parts[parts.length - 2]);
  const p2 = clean(parts[parts.length - 3]);
  return {
    currentWord: parts[parts.length - 1] || "",
    prevWord: p1,
    prevTwoWords: p2 ? `${p2} ${p1}` : ""
  };
}

function computeSmartSuggestions(rawText) {
  const { currentWord, prevWord, prevTwoWords } = getCurrentTypingContext(rawText);
  const cleanCur = currentWord.toLowerCase().replace(/[^a-z]/g, "");

  // Case 1: Empty box or just finished a word -> check 2-word Trigram map, then 1-word Bigram map, then context starters
  if (!cleanCur) {
    const chain = (prevTwoWords && NANA_TRIGRAM_MAP[prevTwoWords])
      || (prevWord && NANA_NEXT_WORD_MAP[prevWord])
      || getEmptyBoxContextStarters();
    return chain.map(w => ({
      text: w,
      replaceCurrent: false,
      isAutoFix: false
    }));
  }

  const results = [];
  const seen = new Set();
  const addCandidate = (word, isAutoFix = false) => {
    const key = word.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      results.push({ text: word, replaceCurrent: true, isAutoFix });
    }
  };

  // 1. Direct match in Nana's personal typo map
  if (NANA_TYPO_MAP[cleanCur]) {
    addCandidate(NANA_TYPO_MAP[cleanCur], true);
  }

  // 2. Check if she missed the spacebar between two valid words (e.g. "verygood" -> "very good")
  const splitAttempt = trySplitRunTogetherWord(cleanCur);
  if (splitAttempt) {
    addCandidate(splitAttempt, true);
  }

  // 3. Prefix match in Nana's vocabulary
  for (const w of NANA_VOCAB) {
    if (w.toLowerCase().startsWith(cleanCur) && w.toLowerCase() !== cleanCur) {
      addCandidate(w, false);
      if (results.length >= 3) break;
    }
  }

  // 4. Fuzzy typo match (edit distance <= 2) for words >= 3 chars
  if (results.length < 3 && cleanCur.length >= 3) {
    const fuzzyMatches = [];
    for (const w of NANA_VOCAB) {
      const lw = w.toLowerCase();
      if (seen.has(lw)) continue;
      const distFull = editDistance(cleanCur, lw);
      const distPref = lw.length > cleanCur.length ? editDistance(cleanCur, lw.slice(0, cleanCur.length)) : 99;
      const bestDist = Math.min(distFull, distPref);
      if (bestDist <= (cleanCur.length >= 5 ? 2 : 1)) {
        fuzzyMatches.push({ w, d: bestDist });
      }
    }
    fuzzyMatches.sort((a, b) => a.d - b.d).forEach(m => {
      if (results.length < 3) addCandidate(m.w, true);
    });
  }

  // Fill any remaining slots with helpful defaults
  const fallbacks = ["love", "hope", "enjoy", "good", "Nana"];
  for (const f of fallbacks) {
    if (results.length >= 3) break;
    addCandidate(f, false);
  }

  return results.slice(0, 3);
}

// If Nana mistyped a word fragment ("cerai") and then re-typed the word ("certain"), collapse the fragment
function collapseRestartedWordFragment(text) {
  const parts = text.trimEnd().split(/\s+/);
  if (parts.length < 2) return text;
  const last = parts[parts.length - 1];
  const prev = parts[parts.length - 2];
  const cleanLast = last.toLowerCase().replace(/[^a-z]/g, "");
  const cleanPrev = prev.toLowerCase().replace(/[^a-z]/g, "");
  if (cleanLast.length >= 4 && cleanPrev.length >= 2 && cleanPrev.length <= cleanLast.length) {
    // If previous token is not a normal valid word (or is an unfinished prefix of the new word) and shares the same first 2 letters
    if (cleanLast.slice(0, 2) === cleanPrev.slice(0, 2) && (!VALID_WORD_SET.has(cleanPrev) || cleanLast.startsWith(cleanPrev))) {
      parts.splice(parts.length - 2, 1);
      return parts.join(' ') + (text.endsWith(' ') ? ' ' : '');
    }
  }
  return text;
}

function renderWordSuggestionsBar() {
  const bar = $('nana-word-suggestions');
  if (!bar) return;
  const input = $('nana-chat-input');
  const suggestions = computeSmartSuggestions(input?.value || "");
  bar.innerHTML = '';

  suggestions.forEach(sug => {
    const btn = document.createElement('button');
    btn.className = 'nana-predict-btn' + (sug.isAutoFix ? ' autocorrect-match' : '');
    btn.textContent = sug.isAutoFix ? `✨ ${sug.text}` : sug.text;
    btn.onpointerup = (ev) => {
      if (ev) { ev.preventDefault(); ev.stopPropagation(); }
      applySuggestedWord(sug);
    };
    bar.appendChild(btn);
  });
}

function applySuggestedWord(sug) {
  const input = $('nana-chat-input');
  if (!input) return;
  let cur = input.value || "";

  if (sug.replaceCurrent) {
    cur = cur.replace(/\S+$/, '') + sug.text + ' ';
  } else {
    if (cur.length && !cur.endsWith(' ')) cur += ' ';
    cur += sug.text + ' ';
  }

  cur = collapseRestartedWordFragment(cur);
  cur = cur.charAt(0).toUpperCase() + cur.slice(1);
  input.value = cur;
  lastKeyTapMs = Date.now();
  resetKeyboardAutoHideTimer();
  window.wakeScreenAndResetDimTimer?.();
  syncChatInputDisplay();
}

window.deleteLastSeniorWord = (ev) => {
  if (ev) { ev.preventDefault(); ev.stopPropagation(); }
  const now = Date.now();
  if (now - lastKeyTapMs < 220) return;
  lastKeyTapMs = now;
  const input = $('nana-chat-input');
  if (!input) return;
  input.value = (input.value || '').trimEnd().replace(/\S+$/, '');
  resetKeyboardAutoHideTimer();
  window.wakeScreenAndResetDimTimer?.();
  syncChatInputDisplay();
};

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
  const raw = String(item.imageUrl || item.photoUrl || item.image || item.photo || item.mediaUrl || '').trim();
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
  renderWordSuggestionsBar();
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
      // Trigger on pointer release (onpointerup) so resting/sliding fingers don't machine-gun adjacent keys
      b.onpointerup = (ev) => window.typeSeniorKey(l, ev);
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
  del.onpointerup = (ev) => window.typeSeniorKey('BACKSPACE', ev);
  r3.appendChild(del);
  container.appendChild(r3);
  renderWordSuggestionsBar();
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
  const modal = $('bulletin-modal');
  const input = $('nana-chat-input');
  // If keyboard is ALREADY open and Nana taps the yellow text display, read her typed message aloud!
  if (modal?.classList.contains('kb-fullscreen') && input?.value?.trim()) {
    window.speakNote?.(input.value.trim());
    return;
  }
  const feed = $('bulletin-posts-container');
  if (feed && !modal?.classList.contains('kb-fullscreen')) {
    savedChatScrollTop = feed.scrollTop;
  }
  if (chatIntersectionObserver) chatIntersectionObserver.disconnect();
  renderSeniorKeyboardLayout();
  modal?.classList.add('kb-fullscreen');
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

// Auto-correct the last completed word (and split run-togethers / collapse restarted fragments) when Nana presses Space or Send
function autoCorrectLastWordInString(str) {
  const match = str.match(/^(.*?)([A-Za-z]+)$/);
  if (!match) return str;
  const prefix = match[1];
  const word = match[2];
  const lower = word.toLowerCase();
  let fixed = str;
  if (NANA_TYPO_MAP[lower]) {
    fixed = prefix + NANA_TYPO_MAP[lower];
  } else {
    const split = trySplitRunTogetherWord(lower);
    if (split) fixed = prefix + split;
  }
  return collapseRestartedWordFragment(fixed);
}

window.typeSeniorKey = (char, ev) => {
  if (ev) {
    ev.preventDefault();
    ev.stopPropagation();
    // Ignore secondary fingers/palms resting on screen (multi-touch guard)
    if (ev.isPrimary === false) return;
  }

  const now = Date.now();
  const isEmoji = ['💋','❤️','☘️','👍','😘'].includes(char);
  const guardMs = Math.max(350, Number(settings.keyGuardMs ?? 350));
  const sameKey = (char === lastKeyChar);

  // 1. Emoji Knuckle Guard: Ignore accidental emoji brushes within 550ms of typing a letter
  if (isEmoji && (now - lastLetterTapMs < 550)) return;

  // 2. Global Anti-Rocking Cooldown: 280ms between ANY two keys (stops r-q-r-q-s-z palm bursts)
  const minGap = char === 'BACKSPACE'
    ? (sameKey ? 220 : 100)
    : (sameKey ? Math.max(guardMs, 500) : 280);
  if (now - lastKeyTapMs < minGap) return;

  const input = $('nana-chat-input');
  if (!input) return;
  let cur = input.value || "";

  if (char === ' ') {
    if (!cur.length || cur.endsWith(' ')) return;
    cur = autoCorrectLastWordInString(cur) + ' ';
    lastKeyTapMs = now;
    lastKeyChar = char;
    input.value = cur;
    resetKeyboardAutoHideTimer();
    window.wakeScreenAndResetDimTimer?.();
    syncChatInputDisplay();
    return;
  }

  if (char !== 'BACKSPACE' && !isEmoji && char.length === 1 && /[A-Za-z]/.test(char)) {
    const c = char.toLowerCase();
    // Never allow 3 identical letters in a row (except 'x' for kisses)
    if (c !== 'x' && cur.length >= 2 && cur.slice(-1).toLowerCase() === c && cur.slice(-2, -1).toLowerCase() === c) {
      return;
    }
    // Consonant-mash guard: if the current word already has 4 consonants in a row (not 'x'), ignore further consonant mashing
    const lastWord = (cur.split(/\s+/).pop() || "").toLowerCase();
    if (c !== 'x' && !/[aeiouy]/.test(c) && /[bcdfghjklmnpqrstvwz]{4}$/.test(lastWord)) {
      return;
    }
    lastLetterTapMs = now;
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

  if (char === 'BACKSPACE') {
    input.value = Array.from(cur).slice(0, -1).join('');
  } else if (isEmoji) {
    const needsSpace = cur.length > 0 && !cur.endsWith(' ') && /[A-Za-z0-9]$/.test(cur);
    input.value = cur + (needsSpace ? ' ' : '') + char + ' ';
  } else {
    const shouldCap = !cur.length || /[.!?]\s+$/.test(cur);
    input.value = cur + (shouldCap ? char.toUpperCase() : char.toLowerCase());
  }
  syncChatInputDisplay();
};

window.kbHideTapped = () => { if (Date.now() - lastKeyTapMs >= 350) window.closeSeniorKeyboard(true); };

window.submitTypedNanaMessage = async () => {
  const input = $('nana-chat-input');
  if (!input || (Date.now() - lastKeyTapMs < 350) || !input.value.trim()) return;
  if (Date.now() - lastChatSendMs < 4000) {
    const st = $('tg-send-status');
    if (st) { st.style.color = "#ffff00"; st.innerText = "⏳ One moment, then tap Send again"; }
    return;
  }
  const text = autoCorrectLastWordInString(input.value.trim());
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

let lastBulletinContentSig = null;
const bulletinContentSig = (snapObj) => Object.entries(snapObj)
  .map(([k, v]) => `${k}|${v?.author || ''}|${v?.text || ''}|${v?.timestamp || ''}|${v?.fileId || v?.imageUrl || v?.photoUrl || v?.image || v?.photo || v?.mediaUrl || ''}`)
  .join('\n');

function syncUnreadMarkersInPlace() {
  document.querySelectorAll('#bulletin-posts-container .tg-bubble[data-msg-key]').forEach(b => {
    if (!isMessageUnreadByNana(state.bulletinSnap[b.dataset.msgKey])) {
      b.classList.remove('unread-msg');
      b.querySelector('.tg-new-tag')?.remove();
    }
  });
  if (!Object.values(state.bulletinSnap).some(p => isMessageUnreadByNana(p))) $('first-unread-divider')?.remove();
  updateBulletinTickerVisibility();
}

onValue(query(refs.bulletin, limitToLast(25)), snap => {
  state.bulletinSnap = snap.val() || {};
  if (role === 'nana') {
    const sig = bulletinContentSig(state.bulletinSnap);
    if (sig === lastBulletinContentSig) { syncUnreadMarkersInPlace(); return; }
    lastBulletinContentSig = sig;
  }
  renderBulletinFeed(false);
});

if (role === 'nana') renderSeniorKeyboardLayout();
