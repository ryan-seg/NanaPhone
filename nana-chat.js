import {
  $, NanaCore, esc, ref, update, push, onValue, query, limitToLast
} from "./nana-core.js?v=2.9.5";

const {
  CONFIG, SERVICE_TOKEN, PORTAL_NODE_ID, role, activeFamilyMember,
  basePath, db, refs, settings, state, hooks
} = NanaCore;

let savedChatScrollTop = null;
let forceScrollBottomNextRender = false;
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
  "withyou": "with you", "withme": "with me", "inthed": "in the", "inthe": "in the", "onthe": "on the",
  "tothe": "to the", "fothe": "for the", "forthe": "for the", "inhere": "in here",
  "toknow": "to know", "tkono": "to know", "tkoono": "to know",
  "loveyou": "love you", "loveyouboth": "love you both", "loveyouboths": "love you both",
  "lovemum": "love Mum", "lovenana": "love Nana", "somuch": "so much", "mumuch": "much",
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
  "meer": "meet", "dib": "did", "mun": "Mum", "anum": "Mum", "uum": "Mum", "nan": "Nana",
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
  "pl": "pleased", "pll": "pleased", "pleeses": "pleased", "wit": "with", "booth": "both", "booths": "both",
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
  "i am": ["so pleased", "pleased to know", "sure"],
  "am pleased": ["to know", "to hear", "you are"],
  "pleased to": ["know", "hear", "see you"],
  "am so": ["pleased", "sorry", "happy"],
  "so pleased": ["to see", "to know", "all is well"],
  "so good": ["to see you", "to hear", "to be together"],
  "enjoy your": ["evening", "day", "holiday"],
  "have a": ["good day", "lovely evening", "good night"],
  "had a": ["good night", "lovely day", "lovely visit"],
  "love you": ["both", "all", "so much"],
  "you both": ["so much", "very much", "love Mum"],
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
  "with me": ["today", "love Mum", "now"],
  "looking forward": ["to seeing you", "to our chat", "to it"]
};

// Single-word next-word predictions
const NANA_NEXT_WORD_MAP = {
  "hi": ["my love", "my loves", "darling"],
  "oh": ["my darling", "my love", "so pleased"],
  "my": ["love", "loves", "darling"],
  "i": ["do hope", "am pleased", "have had"],
  "do": ["hope", "enjoy", "know"],
  "hope": ["you", "all is well", "your journey"],
  "am": ["pleased", "so pleased", "sure"],
  "pleased": ["to know", "to see", "that"],
  "so": ["pleased", "good to see", "much"],
  "you": ["both", "all", "enjoy"],
  "both": ["so much", "of you", "love Mum"],
  "enjoy": ["your", "the", "it all"],
  "your": ["evening", "journey", "visit"],
  "have": ["a good day", "had a", "been"],
  "good": ["morning", "night", "to see you"],
  "morning": ["my loves", "my love", "everyone"],
  "sunny": ["day", "morning", "afternoon"],
  "lots": ["of love", "of", "love"],
  "of": ["love", "yourselves", "you both"],
  "love": ["you both", "to you all", "Mum"],
  "take": ["care", "good care", "care my loves"],
  "care": ["of yourselves", "my loves", "of yourself"],
  "god": ["bless you", "bless you all", "bless my darling"],
  "bless": ["you all", "you both", "Mum"],
  "night": ["night", "God bless", "Mum"],
  "safe": ["and sound", "journey", "home"],
  "happy": ["to be", "smiling faces", "with me"],
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
  "with": ["me", "you all", "her"],
  "she": ["is with me", "is happy", "is well"],
  "gill": ["is here", "and Louis", "is well"],
  "looking": ["forward to", "so well", "good"],
  "all": ["is well", "my love", "the difference"],
  "mum": ["and Nana", "xxxx", "Nana"],
  "nana": ["xxxxxxx", "and Supanana", "God bless"]
};

// Core vocabulary sorted by frequency in Nana's messages for instant prefix & fuzzy matching
const NANA_VOCAB = [
  "love", "loves", "darling", "darlings", "hope", "hoping", "enjoy", "enjoyed", "enjoying",
  "good", "night", "morning", "afternoon", "evening", "day", "today", "tomorrow", "weekend",
  "lovely", "pleased", "delighted", "thrilled", "certain", "sure", "always", "usually",
  "both", "much", "with", "here", "know", "she", "family", "company", "visit", "visited",
  "visitors", "welcome", "wonderful", "super", "garden", "seafront", "beach", "sunshine",
  "sunny", "weather", "forecast", "shade", "warm", "peace", "serenity", "blossom", "tree",
  "outside", "walk", "walking", "sitting", "reading", "lunch", "supper", "breakfast",
  "drink", "quiche", "cheese", "onion", "salad", "fruit", "journey", "drive", "traffic",
  "roads", "car", "flight", "holiday", "home", "house", "bedroom", "bathroom", "room",
  "floor", "flooring", "freezer", "lobby", "seat", "bed", "sleep", "awake", "tired", "dozy",
  "muddled", "lazy", "busy", "occupied", "relaxed", "better", "well", "healthy", "happy",
  "smiling", "faces", "pleasure", "joy", "lucky", "bless", "thank", "thanks", "thankful",
  "thoughtful", "kindness", "appreciate", "helpful", "repaired", "fixed", "working",
  "project", "gift", "present", "photos", "news", "chat", "message", "call", "calling",
  "phone", "tablet", "glasses", "hearing", "sight", "eyes", "ears", "Scrivens", "hospital",
  "nurse", "doctor", "stockings", "shoes", "rollator", "wheelchair", "shul", "neighbours",
  "friends", "children", "wedding", "parents", "together", "minutes", "hours", "week",
  "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday", "sorry",
  "please", "understand", "remember", "thinking", "longing", "missing", "concerning",
  "worried", "carefree", "trouble", "difference", "annoying",
  "Mum", "Nana", "Supanana", "Ryan", "Megan", "Gill", "Louis", "Denise", "Darien",
  "Nicky", "John", "Phil", "Zara", "Marcus", "Nicola", "Jo", "Lois", "Simon",
  "Yolanda", "Helen", "Lynda", "Steve", "Mike", "Luma", "TG", "xxxxxxx"
];

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

// Pre-compute all valid prefixes that legitimately contain a double letter (e.g. "goo" in "good", "see", "wee", "all", "hap" -> "happ")
const VALID_DOUBLE_LETTER_PREFIXES = new Set();
VALID_WORD_SET.forEach(word => {
  if (/([a-z])\1/.test(word)) {
    for (let i = 2; i <= word.length; i++) {
      VALID_DOUBLE_LETTER_PREFIXES.add(word.slice(0, i));
    }
  }
});

// Letters that NEVER double in any word Nana uses
const NEVER_DOUBLE_LETTERS = new Set(['a', 'h', 'i', 'j', 'k', 'q', 'u', 'v', 'w', 'y', 'z']);

// Determine if pressing `c` twice in a row at the end of `lastWord` is a legitimate English double letter or a tremor bounce
function shouldAllowDoubleLetter(lastWord, c, timeSinceLastTapMs) {
  if (c === 'x') return true; // Always allow "xxxx" kisses
  if (NEVER_DOUBLE_LETTERS.has(c)) return false; // Never allow vv, uu, yy, ww, hh, ii, aa, kk
  if (lastWord.length <= 1) return false; // NO English word starts with a double letter (blocks LL, mm, gg, ss, bb at word start)
  if (timeSinceLastTapMs < 850) return false; // Require deliberate pause (>850ms) for any double letter
  // Block if the word already has a double letter immediately preceding (stops "lloovvee")
  if (lastWord.length >= 3 && lastWord.slice(-2, -1) === lastWord.slice(-3, -2)) return false;
  // Only allow if `lastWord + c` is an actual prefix of a valid double-letter word in Nana's vocabulary!
  const candidatePrefix = (lastWord + c).toLowerCase();
  return VALID_DOUBLE_LETTER_PREFIXES.has(candidatePrefix);
}

// Strip accidental tremor double-bounces from a word (e.g. "lloovvee" -> "love", "bboothh" -> "both", "mmuumm" -> "mum")
function deStutterWord(rawWord) {
  const lower = (rawWord || "").toLowerCase().replace(/[^a-z]/g, "");
  if (lower.length < 2) return lower;
  if (/^x+$/.test(lower)) return lower;

  // 1. Collapse any alternating 2-letter tremor loops like "eesseesseesess" or "eseseses" -> "es"
  let collapsed = lower
    .replace(/([a-z])\1+/g, (match, ch, offset) => {
      // Keep legitimate double letters only if not at offset 0 and not in NEVER_DOUBLE_LETTERS
      if (offset === 0 || NEVER_DOUBLE_LETTERS.has(ch)) return ch;
      return ch + ch;
    })
    .replace(/([a-z]{2})\1{2,}/g, '$1');

  if (NANA_TYPO_MAP[collapsed]) return NANA_TYPO_MAP[collapsed];
  if (VALID_WORD_SET.has(collapsed)) return collapsed;

  // 2. Fully single-collapse all repeated letters ("lloovvee" -> "love", "bboothh" -> "both", "mmuumm" -> "mum")
  const single = lower.replace(/([a-z])\1+/g, '$1');
  if (NANA_TYPO_MAP[single]) return NANA_TYPO_MAP[single];
  if (VALID_WORD_SET.has(single)) return single;

  return single;
}

const PROPER_NOUN_CAPITALIZATION = Object.fromEntries(
  NANA_VOCAB.filter(w => /^[A-Z]/.test(w)).map(w => [w.toLowerCase(), w])
);
PROPER_NOUN_CAPITALIZATION["i"] = "I";

function restoreProperCasing(word) {
  return word.split(' ').map(part => {
    const clean = part.toLowerCase();
    return PROPER_NOUN_CAPITALIZATION[clean] || part;
  }).join(' ');
}

// Split 2 or 3 glued words when Nana misses the spacebar (e.g. "loveyouboth" -> "love you both", "gillishere" -> "Gill is here")
function trySplitRunTogetherWord(rawCleanWord) {
  const cleanWord = deStutterWord(rawCleanWord);
  if (cleanWord.length < 4 || VALID_WORD_SET.has(cleanWord)) return null;
  if (NANA_TYPO_MAP[cleanWord]) return NANA_TYPO_MAP[cleanWord];

  const isKnownToken = (s) => s.length >= 2 && (VALID_WORD_SET.has(s) || !!NANA_TYPO_MAP[s]);
  const resolveToken = (s) => restoreProperCasing(NANA_TYPO_MAP[s] || s);

  // Try 2-word split (e.g. "loveyou", "withme", "toknow", "somuch")
  for (let i = 2; i <= cleanWord.length - 2; i++) {
    const w1 = cleanWord.slice(0, i);
    const w2 = cleanWord.slice(i);
    if ((w1 === 'i' || w1 === 'l' || isKnownToken(w1)) && isKnownToken(w2)) {
      const p1 = (w1 === 'i' || w1 === 'l') ? 'I' : resolveToken(w1);
      return `${p1} ${resolveToken(w2)}`;
    }
  }

  // Try 3-word split (e.g. "loveyouboth", "gillishere", "sheishappy")
  if (cleanWord.length >= 7) {
    for (let i = 2; i <= cleanWord.length - 4; i++) {
      const w1 = cleanWord.slice(0, i);
      if (!(w1 === 'i' || w1 === 'l' || isKnownToken(w1))) continue;
      for (let j = i + 2; j <= cleanWord.length - 2; j++) {
        const w2 = cleanWord.slice(i, j);
        const w3 = cleanWord.slice(j);
        const w3Trim = (w3.endsWith('s') && ! isKnownToken(w3) && isKnownToken(w3.slice(0, -1))) ? w3.slice(0, -1) : w3;
        if (isKnownToken(w2) && isKnownToken(w3Trim)) {
          const p1 = (w1 === 'i' || w1 === 'l') ? 'I' : resolveToken(w1);
          return `${p1} ${resolveToken(w2)} ${resolveToken(w3Trim)}`;
        }
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
        return ["Lots of love", "Love you both", timeGreeting];
      }
    }
  }
  return [timeGreeting, "I do hope", "Love you both"];
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
  const rawCleanCur = currentWord.toLowerCase().replace(/[^a-z]/g, "");
  const cleanCur = deStutterWord(rawCleanCur);

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
    const formatted = restoreProperCasing(word);
    const key = formatted.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      results.push({ text: formatted, replaceCurrent: true, isAutoFix });
    }
  };

  // 1. Direct match in Nana's personal typo map (using both raw & de-stuttered forms)
  if (NANA_TYPO_MAP[rawCleanCur]) addCandidate(NANA_TYPO_MAP[rawCleanCur], true);
  if (NANA_TYPO_MAP[cleanCur]) addCandidate(NANA_TYPO_MAP[cleanCur], true);

  // 2. Check if she missed the spacebar between 2 or 3 valid words (e.g. "loveyouboth" -> "love you both")
  const splitAttempt = trySplitRunTogetherWord(rawCleanCur);
  if (splitAttempt) {
    addCandidate(splitAttempt, true);
  }

  // 3. If de-stuttering produced a clean valid word (e.g. "lloovvee" -> "love"), offer it as #1 auto-fix
  if (cleanCur !== rawCleanCur && VALID_WORD_SET.has(cleanCur)) {
    addCandidate(cleanCur, true);
  }

  // 4. Prefix match in Nana's vocabulary
  for (const w of NANA_VOCAB) {
    if (w.toLowerCase().startsWith(cleanCur) && w.toLowerCase() !== rawCleanCur) {
      addCandidate(w, false);
      if (results.length >= 3) break;
    }
  }

  // 5. Fuzzy typo match (edit distance <= 2) for words >= 3 chars
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
  const fallbacks = ["love", "hope", "pleased", "good", "Mum"];
  for (const f of fallbacks) {
    if (results.length >= 3) break;
    addCandidate(f, false);
  }

  return results.slice(0, 3);
}

// If Nana mistyped a word fragment ("cerai" or "mmuu") and then re-typed the word ("certain" or "Mum"), collapse the fragment
function collapseRestartedWordFragment(text) {
  const parts = text.trimEnd().split(/\s+/);
  if (parts.length < 2) return text;
  const last = parts[parts.length - 1];
  const prev = parts[parts.length - 2];
  const cleanLast = deStutterWord(last);
  const cleanPrev = deStutterWord(prev);
  if (cleanLast.length >= 3 && cleanPrev.length >= 2 && cleanPrev.length <= cleanLast.length) {
    if (cleanLast === cleanPrev || (cleanLast.slice(0, 2) === cleanPrev.slice(0, 2) && (!VALID_WORD_SET.has(cleanPrev) || cleanLast.startsWith(cleanPrev)))) {
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
  if (item.systemAlert) return false;
  const isOut = !!item.fromNana || item.author?.toLowerCase() === 'nana';
  if (isOut) return false;
  const clearedAt = Number(settings.bulletinClearedAt) || 0;
  return !(item.readByNanaAt || (Number(item.timestamp) || 0) <= clearedAt);
}
NanaCore.isMessageUnreadByNana = isMessageUnreadByNana;

const photoDataUrlCache = new Map();
function setBoundedBlobCache(cacheMap, key, val, maxEntries) {
  if (cacheMap.has(key)) {
    const old = cacheMap.get(key);
    if (old && old !== val && String(old).startsWith('blob:')) {
      try { URL.revokeObjectURL(old); } catch (_) {}
    }
    cacheMap.delete(key);
  }
  cacheMap.set(key, val);
  while (cacheMap.size > maxEntries) {
    const oldestKey = cacheMap.keys().next().value;
    const oldestVal = cacheMap.get(oldestKey);
    cacheMap.delete(oldestKey);
    if (oldestVal && String(oldestVal).startsWith('blob:')) {
      try { URL.revokeObjectURL(oldestVal); } catch (_) {}
    }
  }
}

async function loadLegacyPhotoIntoImg(fileId, imgEl) {
  if (!fileId || !imgEl || !CONFIG?.googleScriptUrl || !SERVICE_TOKEN) return;
  try {
    let url = photoDataUrlCache.get(fileId);
    if (!url) {
      const proxyUrl = `${CONFIG.googleScriptUrl}?action=get_photo&fileId=${encodeURIComponent(fileId)}&secret=${encodeURIComponent(SERVICE_TOKEN)}`;
      const res = await fetch(proxyUrl);
      if (!res.ok) return;
      const ct = (res.headers.get('content-type') || '').toLowerCase();
      if (ct.includes('application/json')) {
        const data = await res.json();
        url = data?.dataUrl || (data?.base64 ? `data:${data.mimeType || 'image/jpeg'};base64,${data.base64}` : null);
      } else {
        const blob = await res.blob();
        url = URL.createObjectURL(blob);
      }
      if (url) setBoundedBlobCache(photoDataUrlCache, fileId, url, 15);
    }
    if (url && imgEl.isConnected) imgEl.src = url;
  } catch (_) {}
}

function resolveChatPhotoUrl(item) {
  if (!item) return null;
  const raw = String(item.imageUrl || item.photoUrl || item.image || item.photo || item.mediaUrl || '').trim();
  if (raw) {
    if (/^(data:image\/|https?:\/\/|blob:)/i.test(raw)) return raw;
    if (/^[A-Za-z0-9+/=]{100,}$/.test(raw)) return `data:image/jpeg;base64,${raw}`;
    return raw;
  }
  return null;
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
    const msg = key ? state.bulletinSnap[key] : null;
    if (key && msg && !isVoiceMessageItem(msg) && !isVideoChatItem(msg) && isMessageUnreadByNana(msg)) {
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
  if (role === 'nana' && settings.voiceMessagingEnabled !== false) {
    const mode = settings.nanaMessageEntryMode || 'choice';
    ph.textContent = mode === 'voice'
      ? '🎙️ Tap here to speak a voice message...'
      : (mode === 'keyboard' ? 'Tap here to open big keyboard...' : '💬 Tap here to speak or type a message...');
  } else {
    ph.textContent = 'Tap here to open big keyboard...';
  }
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
  pauseActiveChatVoiceMessage?.();
  cancelNanaVoiceRecording?.(true);
  window.closeChatVideoOverlay?.();
  window.closeReplyChooser?.();
  $('bulletin-modal').style.display = 'none';
  window.closeSeniorKeyboard(false);
  window.speechSynthesis?.cancel();
  window.wakeScreenAndResetDimTimer?.();
  NanaCore.recordTouchActivity?.("On Home Grid");
  hooks.broadcastScreen?.();
};

window.openActualSeniorKeyboard = () => {
  if (role !== 'nana') return;
  window.closeReplyChooser?.();
  const modal = $('bulletin-modal');
  const input = $('nana-chat-input');
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

window.openSeniorKeyboard = () => {
  if (role !== 'nana') return;
  const modal = $('bulletin-modal');
  const input = $('nana-chat-input');
  if (modal?.classList.contains('kb-fullscreen')) {
    if (input?.value?.trim()) window.speakNote?.(input.value.trim());
    return;
  }
  if (role === 'nana' && settings.voiceMessagingEnabled !== false && !(input?.value || '').trim()) {
    const entryMode = settings.nanaMessageEntryMode || 'choice';
    if (entryMode === 'voice') {
      window.startNanaVoiceRecording?.();
      return;
    }
    if (entryMode === 'choice') {
      window.openReplyChooser?.();
      return;
    }
  }
  window.openActualSeniorKeyboard();
};

window.closeSeniorKeyboard = (restoreScroll = true) => {
  clearTimeout(keyboardHideTimer);
  window.closeReplyChooser?.();
  const modal = $('bulletin-modal');
  const wasFullscreen = modal?.classList.contains('kb-fullscreen');
  if ($('senior-onscreen-keyboard')) $('senior-onscreen-keyboard').style.display = 'none';
  modal?.classList.remove('kb-fullscreen');
  syncChatInputDisplay();
  if (modal?.style.display === 'flex' && (wasFullscreen || !restoreScroll)) {
    if (!restoreScroll) savedChatScrollTop = null;
    setTimeout(() => {
      const feed = $('bulletin-posts-container');
      if (feed) {
        if (restoreScroll && savedChatScrollTop !== null) feed.scrollTop = savedChatScrollTop;
        else if (!restoreScroll) feed.scrollTop = feed.scrollHeight;
        setupNanaChatReadObserver();
        scheduleNanaScrollPhotoUpdate(feed);
      }
    }, 30);
  }
  hooks.broadcastScreen?.();
};

let chatPhotoScaleRaf = null;
function updateNanaScrollPhotoSizes(feedEl = $('bulletin-posts-container')) {
  if (role !== 'nana' || !feedEl || $('bulletin-modal')?.classList.contains('kb-fullscreen')) return;
  const stages = feedEl.querySelectorAll('.tg-photo-stage');
  if (!stages.length) return;
  const feedRect = feedEl.getBoundingClientRect();
  if (!feedRect.height) return;
  const feedCenterY = feedRect.top + feedRect.height * 0.48;
  const maxDist = Math.max(180, feedRect.height * 0.58);

  stages.forEach(stage => {
    const img = stage.querySelector('.tg-chat-photo.nana-scroll-photo');
    if (!img) return;
    const r = stage.getBoundingClientRect();
    const photoCenterY = r.top + r.height / 2;
    const dist = Math.abs(photoCenterY - feedCenterY);
    const p = Math.max(0, Math.min(1, 1 - dist / maxDist));
    const eased = p * p * (3 - 2 * p);
    const scale = 0.66 + eased * 0.34;
    const opacity = 0.82 + eased * 0.18;
    img.style.setProperty('--photo-scale', scale.toFixed(3));
    img.style.setProperty('--photo-opacity', opacity.toFixed(3));
    img.classList.toggle('is-photo-focused', eased >= 0.7);
  });
}

function scheduleNanaScrollPhotoUpdate(feedEl = $('bulletin-posts-container')) {
  if (role !== 'nana' || chatPhotoScaleRaf) return;
  chatPhotoScaleRaf = requestAnimationFrame(() => {
    chatPhotoScaleRaf = null;
    updateNanaScrollPhotoSizes(feedEl);
  });
}

window.handleChatScroll = (el) => {
  if (role === 'nana' && el && !$('bulletin-modal')?.classList.contains('kb-fullscreen')) {
    savedChatScrollTop = el.scrollTop;
    scheduleNanaScrollPhotoUpdate(el);
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

// Auto-correct the last completed word (de-stuttering tremor doubles & splitting run-togethers) when Nana presses Space or Send
function autoCorrectLastWordInString(str) {
  const match = str.match(/^(.*?)([A-Za-z]+)$/);
  if (!match) return str;
  const prefix = match[1];
  const word = match[2];
  const lower = word.toLowerCase();
  const destuttered = deStutterWord(lower);
  let fixed = str;

  if (NANA_TYPO_MAP[lower]) {
    fixed = prefix + NANA_TYPO_MAP[lower];
  } else if (NANA_TYPO_MAP[destuttered]) {
    fixed = prefix + NANA_TYPO_MAP[destuttered];
  } else {
    const split = trySplitRunTogetherWord(lower);
    if (split) {
      fixed = prefix + split;
    } else if (VALID_WORD_SET.has(destuttered)) {
      fixed = prefix + restoreProperCasing(destuttered);
    }
  }
  const collapsed = collapseRestartedWordFragment(fixed);
  return collapsed.charAt(0).toUpperCase() + collapsed.slice(1);
}

window.typeSeniorKey = (char, ev) => {
  if (ev) {
    ev.preventDefault();
    ev.stopPropagation();
    if (ev.isPrimary === false) return;
  }

  const now = Date.now();
  const isEmoji = ['💋','❤️','☘️','👍','😘'].includes(char);
  const guardMs = Math.max(450, Number(settings.keyGuardMs ?? 450));
  const sameKey = (char === lastKeyChar);
  const timeSinceLastTap = now - lastKeyTapMs;

  // 1. Emoji Knuckle Guard: Ignore accidental emoji brushes within 550ms of typing a letter
  if (isEmoji && (now - lastLetterTapMs < 550)) return;

  // 2. Global Cooldown: 280ms between different keys; 550ms minimum on same key
  const minGap = char === 'BACKSPACE'
    ? (sameKey ? 220 : 100)
    : (sameKey ? Math.max(guardMs, 550) : 280);
  if (timeSinceLastTap < minGap) return;

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
    const lastWord = (cur.split(/\s+/).pop() || "").toLowerCase();

    // 3. Smart Double-Letter Tremor Filter (Stops "Llooveeyooubboothhs" & "mm uumm")
    if (lastWord.length >= 1 && lastWord.slice(-1) === c) {
      if (!shouldAllowDoubleLetter(lastWord, c, timeSinceLastTap)) {
        return;
      }
    }

    // 4. Never allow 3 identical letters in a row (except 'x' for kisses)
    if (c !== 'x' && lastWord.length >= 2 && lastWord.slice(-1) === c && lastWord.slice(-2, -1) === c) {
      return;
    }

    // 5. Alternating 2-Key Tremor Bounce Guard (Stops "eesseesseesess" / "eseseses")
    if (lastWord.length >= 3) {
      const a = lastWord.slice(-3, -2), b = lastWord.slice(-2, -1), d = lastWord.slice(-1);
      if (a === d && a !== b && c === b) {
        return; // Blocks 4th character of an A-B-A-B rock!
      }
    }

    // 6. Consonant-mash guard: if the current word already has 4 consonants in a row (not 'x'), ignore further consonant mashing
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
  if (role === 'family') {
    const nativeInp = $('family-chat-native-input');
    const text = (nativeInp?.value || '').trim();
    if (!nativeInp || !text) return;
    if (Date.now() - lastChatSendMs < 4000) {
      const st = $('tg-send-status');
      if (st) { st.style.color = "#ffff00"; st.innerText = "⏳ One moment, then tap Send again"; }
      return;
    }
    nativeInp.value = "";
    savedChatScrollTop = null;
    await window.sendNanaChatMessage(text);
    return;
  }
  const input = $('nana-chat-input');
  if (!input || (Date.now() - lastKeyTapMs < 350) || !input.value.trim()) return;
  if (Date.now() - lastChatSendMs < 4000) {
    const st = $('tg-send-status');
    if (st) { st.style.color = "#ffff00"; st.innerText = "⏳ One moment, then tap Send again"; }
    return;
  }
  // Clean up all words in the final sentence before sending
  const cleanedWords = input.value.trim().split(/\s+/).map(w => autoCorrectLastWordInString(w)).join(' ');
  const text = collapseRestartedWordFragment(cleanedWords);
  input.value = "";
  savedChatScrollTop = null;
  syncChatInputDisplay();
  window.closeSeniorKeyboard(false);
  await window.sendNanaChatMessage(text);
};

if (role === 'family') {
  $('family-chat-native-input')?.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter' && !ev.shiftKey) {
      ev.preventDefault();
      window.submitTypedNanaMessage();
    }
  });
}

window.sendNanaChatMessage = async (rawText) => {
  const text = (rawText || "").trim();
  if (!text || (Date.now() - lastChatSendMs < 4000)) return;
  lastChatSendMs = Date.now();
  const author = role === 'nana' ? 'Nana' : activeFamilyMember.name;
  const st = $('tg-send-status');
  if (st) { st.style.color = "#ffff00"; st.innerText = "⏳ Sending message to Telegram..."; }
  try {
    const now = Date.now();
    savedChatScrollTop = null;
    forceScrollBottomNextRender = true;
    await push(refs.bulletin, { author, fromNana: role === 'nana', text, timestamp: now, ...(role === 'nana' ? { readByNanaAt: now } : {}) });
    const res = await fetch(CONFIG.googleScriptUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ secret: SERVICE_TOKEN, portalNode: PORTAL_NODE_ID, action: "nana_reply", author, text })
    });
    const data = await res.json().catch(() => null);
    if (st) {
      st.style.color = data?.ok ? "#4ade80" : "#f87171";
      st.innerText = data?.ok ? "✅ Sent to Family Telegram Group!" : `⚠️ ${data?.error || 'Telegram not linked'}`;
      setTimeout(() => { if ($('tg-send-status')) { $('tg-send-status').style.color = "#4ade80"; $('tg-send-status').innerText = "🟢 Connected to Family Group"; } }, 5000);
    }
  } catch (_) {
    if (st) {
      st.style.color = "#f87171";
      st.innerText = "⚠️ Saved on tablet";
      setTimeout(() => { if ($('tg-send-status')) { $('tg-send-status').style.color = "#4ade80"; $('tg-send-status').innerText = "🟢 Connected to Family Group"; } }, 5000);
    }
  }
};

// --- 4. BULLETIN CHAT FEED RENDERER ---
export function renderBulletinFeed(forceInitialScroll = false) {
  const container = $('bulletin-posts-container');
  if (!container) return;
  const previousScroll = container.scrollTop;
  const wasAtBottom = (container.scrollHeight - container.scrollTop - container.clientHeight) <= 60;
  const shouldScrollBottom = forceScrollBottomNextRender;
  forceScrollBottomNextRender = false;
  container.innerHTML = "";
  const validEntries = Object.entries(state.bulletinSnap || {})
    .filter(([, item]) => item && typeof item === 'object')
    .slice(-25);
  lastRenderedReadAloud = !!settings.showReadAloud;

  if (validEntries.length) {
    const newest = validEntries[validEntries.length - 1][1];
    if ($('ticker-preview-text')) {
      const previewTxt = newest.text || (isVoiceMessageItem(newest) ? '🎙️ Sent a voice message' : (isVideoChatItem(newest) ? '📹 Sent a video' : 'Sent a photo 📷'));
      $('ticker-preview-text').innerText = `💬 ${newest.author || 'Family'}: "${previewTxt}"`;
    }
  } else {
    container.innerHTML = `<div style="margin:auto;color:var(--text-muted);font-size:1.5rem;font-weight:700;padding:30px;">No messages yet. Tap below to send a voice message or open the keyboard!</div>`;
  }
  updateBulletinTickerVisibility();
  let insertedDivider = false;

  validEntries.forEach(([k, item]) => {
    try {
      const isSys = !!item.systemAlert;
      const isOut = !isSys && (!!item.fromNana || item.author?.toLowerCase() === 'nana');
      const isUnread = isMessageUnreadByNana(item);
      const hasVoice = isVoiceMessageItem(item);
      const hasVideo = isVideoChatItem(item);

      if (isUnread && !insertedDivider) {
        insertedDivider = true;
        const d = document.createElement('div');
        d.id = 'first-unread-divider';
        d.className = 'tg-unread-divider';
        d.textContent = '⬇️ NEW UNREAD MESSAGES BELOW ⬇️';
        container.appendChild(d);
      }

      const b = document.createElement('div');
      b.className = `tg-bubble ${isSys ? 'system-alert' : (isOut ? 'outgoing' : 'incoming')}${isUnread ? ' unread-msg' : ''}`;
      b.dataset.msgKey = k;

      const top = document.createElement('div');
      top.className = 'tg-sender-row';
      const auth = document.createElement('span');
      auth.className = 'tg-sender-name';
      auth.textContent = isSys
        ? `🔋 ${item.author || 'Tablet Status'}`
        : (isOut ? (role === 'nana' ? '👵 Nana (You)' : '👵 Nana') : `👤 ${item.author || 'Family'}`);
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
      const legacyFid = item.fileId || item.photoFileId || item.telegramFileId;
      if (photoSrc || legacyFid) {
        const img = document.createElement('img');
        img.className = role === 'nana' ? 'tg-chat-photo nana-scroll-photo' : 'tg-chat-photo';
        img.referrerPolicy = 'no-referrer';
        img.loading = 'eager';
        img.alt = 'Family Photo';
        if (role === 'nana') {
          img.onload = () => scheduleNanaScrollPhotoUpdate(container);
        }
        if (photoSrc) {
          img.src = photoSrc;
          img.onerror = () => {
            if (legacyFid && !img.dataset.retriedProxy) {
              img.dataset.retriedProxy = '1';
              loadLegacyPhotoIntoImg(legacyFid, img);
            }
          };
        } else {
          loadLegacyPhotoIntoImg(legacyFid, img);
        }
        if (role === 'nana') {
          b.classList.add('nana-photo-bubble');
          const stage = document.createElement('div');
          stage.className = 'tg-photo-stage';
          stage.appendChild(img);
          b.appendChild(stage);
        } else {
          b.appendChild(img);
        }
      }

      if (hasVoice && !isOut && settings.voiceMessagingEnabled !== false) {
        const voiceWrap = document.createElement('div');
        voiceWrap.innerHTML = buildVoiceMessageCardHtml(k, item);
        b.appendChild(voiceWrap);
      }

      if (hasVideo && !isOut) {
        const vidWrap = document.createElement('div');
        vidWrap.innerHTML = buildChatVideoCardHtml(k, item);
        b.appendChild(vidWrap);
      }

      if (item.text) {
        const p = document.createElement('div');
        p.className = 'tg-msg-text';
        p.textContent = item.text;
        b.appendChild(p);
      }

      if (role === 'family' && !isOut && !isSys) {
        const rc = document.createElement('div');
        if (hasVoice) {
          if (item.listenedByNanaAt) {
            const lt = new Date(item.listenedByNanaAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
            rc.className = 'tg-read-receipt read';
            rc.textContent = `🎧 Listened by Nana (${lt})`;
          } else {
            rc.className = 'tg-read-receipt unread';
            rc.textContent = '⏳ Not listened by Nana yet';
          }
        } else if (hasVideo) {
          if (item.watchedByNanaAt) {
            const wt = new Date(item.watchedByNanaAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
            rc.className = 'tg-read-receipt read';
            rc.textContent = `🎬 Watched by Nana (${wt})`;
          } else {
            rc.className = 'tg-read-receipt unread';
            rc.textContent = '⏳ Not watched by Nana yet';
          }
        } else if (!isUnread) {
          const readTime = item.readByNanaAt ? new Date(item.readByNanaAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
          rc.className = 'tg-read-receipt read';
          rc.textContent = `✓✓ Read by Nana${readTime ? ' (' + readTime + ')' : ''}`;
        } else {
          rc.className = 'tg-read-receipt unread';
          rc.textContent = '⏳ Unread by Nana';
        }
        b.appendChild(rc);
      }

      if (item.text && settings.showReadAloud && !hasVoice && !hasVideo) {
        const btn = document.createElement('button');
        btn.className = 'tg-speak-chip';
        btn.textContent = '🔊 Read Aloud';
        btn.onclick = () => window.speakNote(`${item.author || 'Family'} says: ${item.text}`);
        b.appendChild(btn);
      }
      container.appendChild(b);
    } catch (err) {
      console.warn('Error rendering chat message:', k, err);
    }
  });

  if ($('bulletin-modal')?.style.display === 'flex' && !$('bulletin-modal')?.classList.contains('kb-fullscreen')) {
    if (forceInitialScroll) setTimeout(scrollToFirstUnreadOrBottom, 60);
    else {
      container.scrollTop = (shouldScrollBottom || wasAtBottom) ? container.scrollHeight : previousScroll;
      setTimeout(() => {
        setupNanaChatReadObserver();
        scheduleNanaScrollPhotoUpdate(container);
      }, 60);
    }
  }
}
hooks.renderBulletinFeed = renderBulletinFeed;

let lastRenderedVoiceEnabled = !!settings.voiceMessagingEnabled;
hooks.onSettingsChanged.push((s) => {
  if (lastRenderedKbLayout !== (s.keyboardLayout || 'qwerty')) renderSeniorKeyboardLayout();
  if (s.videoVolume !== undefined) syncChatVideoVolume?.();
  if (lastRenderedReadAloud !== !!s.showReadAloud || lastRenderedVoiceEnabled !== (s.voiceMessagingEnabled !== false)) {
    lastRenderedVoiceEnabled = s.voiceMessagingEnabled !== false;
    if (!lastRenderedVoiceEnabled) {
      pauseActiveChatVoiceMessage();
      cancelNanaVoiceRecording(true);
    }
    ensureVoiceMessagingUI();
    renderBulletinFeed(false);
  }
  if ((s.nanaMessageEntryMode || 'choice') !== 'choice') {
    window.closeReplyChooser?.();
  }
  syncChatInputDisplay();
});

let lastBulletinContentSig = null;
const bulletinContentSig = (snapObj) => Object.entries(snapObj || {})
  .map(([k, v]) => `${k}|${v?.author || ''}|${v?.fromNana ? 1 : 0}|${v?.type || ''}|${v?.text || ''}|${v?.timestamp || ''}|${v?.fileId || v?.photoFileId || v?.telegramFileId || v?.imageUrl || v?.photoUrl || v?.image || v?.photo || v?.mediaUrl || ''}|${v?.voiceFileId || v?.audioUrl || v?.voiceUrl || v?.audioData || ''}|${v?.listenedByNanaAt || ''}|${v?.videoFileId || ''}|${v?.watchedByNanaAt || ''}`)
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
    if (sig === lastBulletinContentSig && !forceScrollBottomNextRender) {
      syncUnreadMarkersInPlace();
      return;
    }
    renderBulletinFeed(false);
    lastBulletinContentSig = sig;
    return;
  }
  renderBulletinFeed(false);
});

// --- 5. TWO-WAY VOICE MESSAGING (LISTEN WITH -5s RESUME + SINGLE-TOUCH SPEAK NOW) ---
const VOICE_TAP_GUARD_MS = 1500;
let lastVoiceTapAt = 0;
let activeVoiceMsgKey = null;
let activeVoiceAudio = null;
const voicePausedPositions = new Map();
const voiceBlobUrlCache = new Map();

function isVoiceMessageItem(item) {
  return !!(item && (item.voiceFileId || item.audioUrl || item.voiceUrl || item.audioData || item.type === 'voice'));
}

function fmtVoiceDur(sec) {
  const s = Math.max(0, Math.round(Number(sec) || 0));
  if (!s) return '';
  const m = Math.floor(s / 60), r = s % 60;
  return m > 0 ? `${m}:${String(r).padStart(2, '0')}` : `${r}s`;
}

function buildVoiceMessageCardHtml(msgKey, item) {
  const isPlayingThis = !!(activeVoiceMsgKey === msgKey && activeVoiceAudio && !activeVoiceAudio.paused);
  const pausedAt = voicePausedPositions.get(msgKey) || 0;
  const durLabel = fmtVoiceDur(item.voiceDurationSec);
  const listened = !!item.listenedByNanaAt;
  const btnText = isPlayingThis
    ? '⏸️ PAUSE VOICE MESSAGE'
    : (pausedAt > 0 ? '▶️ RESUME (5s BACK)' : (listened ? '▶️ PLAY AGAIN' : '▶️ PLAY VOICE MESSAGE'));
  const btnBg = isPlayingThis ? '#b45309' : (listened ? '#334155' : '#059669');
  const restartBtn = (pausedAt > 0 && !isPlayingThis)
    ? `<button type="button" onclick="restartChatVoiceMessage('${esc(msgKey)}')" style="margin-top:6px;width:100%;padding:10px;border-radius:12px;border:2px solid #94a3b8;background:#1e293b;color:#e2e8f0;font-size:1.1rem;font-weight:800;cursor:pointer;">↺ Restart from Beginning</button>`
    : '';
  return `<div class="nana-voice-card" data-voice-key="${esc(msgKey)}" style="margin:8px 0;">
    <button type="button" class="nana-voice-play-btn" onclick="toggleChatVoiceMessage('${esc(msgKey)}')" style="width:100%;padding:16px 14px;border-radius:16px;border:3px solid #fef08a;background:${btnBg};color:#fff;font-size:1.35rem;font-weight:900;cursor:pointer;">
      ${btnText}${durLabel ? ` (${esc(durLabel)})` : ''}
    </button>
    ${restartBtn}
    <div class="nana-voice-status" style="margin-top:4px;font-size:0.95rem;color:#cbd5e1;font-weight:700;"></div>
  </div>`;
}

function refreshVoiceCardUI(msgKey, statusMsg = '') {
  const card = document.querySelector(`.nana-voice-card[data-voice-key="${msgKey}"]`);
  const item = state.bulletinSnap[msgKey];
  if (!card || !item) return;
  card.outerHTML = buildVoiceMessageCardHtml(msgKey, item);
  if (statusMsg) {
    const newCard = document.querySelector(`.nana-voice-card[data-voice-key="${msgKey}"]`);
    const st = newCard?.querySelector('.nana-voice-status');
    if (st) st.textContent = statusMsg;
  }
}

function pauseActiveChatVoiceMessage() {
  if (!activeVoiceAudio || !activeVoiceMsgKey) return;
  const k = activeVoiceMsgKey;
  if (!activeVoiceAudio.paused && !activeVoiceAudio.ended) {
    voicePausedPositions.set(k, activeVoiceAudio.currentTime || 0);
    activeVoiceAudio.pause();
  }
  refreshVoiceCardUI(k);
}

async function resolveVoiceAudioUrl(item) {
  const direct = item.audioUrl || item.voiceUrl || item.audioData;
  if (direct) return direct;
  const fid = item.voiceFileId;
  if (!fid) return null;
  if (voiceBlobUrlCache.has(fid)) return voiceBlobUrlCache.get(fid);
  const proxyUrl = `${CONFIG.googleScriptUrl}?action=get_audio&fileId=${encodeURIComponent(fid)}&secret=${encodeURIComponent(SERVICE_TOKEN)}`;
  const res = await fetch(proxyUrl);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const ct = (res.headers.get('content-type') || '').toLowerCase();
  if (ct.includes('application/json')) {
    const data = await res.json();
    const url = data.dataUrl || (data.base64 ? `data:${data.mimeType || 'audio/ogg'};base64,${data.base64}` : null);
    if (!url) throw new Error(data.error || 'No audio data');
    setBoundedBlobCache(voiceBlobUrlCache, fid, url, 15);
    return url;
  }
  const blob = await res.blob();
  const objUrl = URL.createObjectURL(blob);
  setBoundedBlobCache(voiceBlobUrlCache, fid, objUrl, 15);
  return objUrl;
}

async function markVoiceListenedByNana(msgKey) {
  if (role !== 'nana' || !msgKey) return;
  const item = state.bulletinSnap[msgKey];
  if (!item || item.listenedByNanaAt) return;
  const now = Date.now();
  item.listenedByNanaAt = now;
  item.readByNanaAt = item.readByNanaAt || now;
  syncUnreadMarkersInPlace();
  update(ref(db, `${basePath}/bulletin/${msgKey}`), {
    listenedByNanaAt: now,
    readByNanaAt: item.readByNanaAt
  }).catch(() => {});
}

window.toggleChatVoiceMessage = async (msgKey) => {
  if (settings.voiceMessagingEnabled === false) return;
  const now = Date.now();
  if (now - lastVoiceTapAt < VOICE_TAP_GUARD_MS) return; // Shaky-finger debounce
  lastVoiceTapAt = now;

  const item = state.bulletinSnap[msgKey];
  if (!item) return;

  if (activeVoiceMsgKey === msgKey && activeVoiceAudio && !activeVoiceAudio.paused) {
    voicePausedPositions.set(msgKey, activeVoiceAudio.currentTime || 0);
    activeVoiceAudio.pause();
    refreshVoiceCardUI(msgKey, '⏸️ Paused — tap Resume to hear from 5s earlier');
    return;
  }

  if (activeVoiceMsgKey && activeVoiceMsgKey !== msgKey) {
    pauseActiveChatVoiceMessage();
  }

  window.stopRadioAndSync?.(false);
  hooks.pauseVideo?.('voice_message');
  window.wakeScreenAndResetDimTimer?.();

  try {
    refreshVoiceCardUI(msgKey, '⏳ Loading voice message...');
    if (!activeVoiceAudio || activeVoiceMsgKey !== msgKey) {
      const src = await resolveVoiceAudioUrl(item);
      if (!src) throw new Error('Audio unavailable');
      if (activeVoiceAudio) {
        try {
          activeVoiceAudio.pause();
          activeVoiceAudio.removeAttribute('src');
          activeVoiceAudio.load();
        } catch (_) {}
      }
      activeVoiceAudio = new Audio(src);
      activeVoiceMsgKey = msgKey;
      activeVoiceAudio.ontimeupdate = () => {
        if (!activeVoiceAudio || activeVoiceMsgKey !== msgKey) return;
        const dur = Number(activeVoiceAudio.duration) || Number(item.voiceDurationSec) || 0;
        const cur = Number(activeVoiceAudio.currentTime) || 0;
        if ((dur > 0 && cur / dur >= 0.8) || (dur === 0 && cur >= 3)) {
          markVoiceListenedByNana(msgKey);
        }
      };
      activeVoiceAudio.onended = () => {
        voicePausedPositions.delete(msgKey);
        markVoiceListenedByNana(msgKey);
        activeVoiceMsgKey = null;
        refreshVoiceCardUI(msgKey, '✅ Finished');
      };
      activeVoiceAudio.onerror = () => {
        activeVoiceMsgKey = null;
        refreshVoiceCardUI(msgKey, '⚠️ Could not play this voice message');
      };
    }

    const pausedAt = voicePausedPositions.get(msgKey) || 0;
    if (pausedAt > 0) {
      try { activeVoiceAudio.currentTime = Math.max(0, pausedAt - 5); } catch (_) {}
    }
    await activeVoiceAudio.play();
    refreshVoiceCardUI(msgKey, '🔊 Playing...');
  } catch (err) {
    console.warn('Voice playback failed:', err);
    activeVoiceMsgKey = null;
    refreshVoiceCardUI(msgKey, '⚠️ Could not load voice message');
  }
};

window.restartChatVoiceMessage = async (msgKey) => {
  const now = Date.now();
  if (now - lastVoiceTapAt < VOICE_TAP_GUARD_MS) return;
  lastVoiceTapAt = now;
  voicePausedPositions.delete(msgKey);
  if (activeVoiceMsgKey === msgKey && activeVoiceAudio) {
    try { activeVoiceAudio.currentTime = 0; } catch (_) {}
  }
  lastVoiceTapAt = 0; // Allow immediate play via toggleChatVoiceMessage
  return window.toggleChatVoiceMessage(msgKey);
};

// --- Single-Touch Voice Recording ("SPEAK NOW") ---
let activeRecorder = null;
let activeRecStream = null;
let activeRecChunks = [];
let recTimerInterval = null;
let recCallWatchInterval = null;
let recVadInterval = null;
let recMicSource = null;
let recMicFilter = null;
let recMicAnalyser = null;
let recStartedAtMs = 0;
let recDeadlineMs = 0;
let recHardDeadlineMs = 0;
let recLastSpeechAtMs = 0;
let recTotalSpeechMs = 0;
let recVadAvailable = false;
let recManualDone = false;
let recCancelled = false;

function playVoiceChime() {
  try {
    const ctx = NanaCore.audioCtx;
    if (ctx.state === 'suspended') ctx.resume();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(660, ctx.currentTime);
    osc.frequency.setValueAtTime(880, ctx.currentTime + 0.12);
    gain.gain.setValueAtTime(0.18, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.3);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.32);
  } catch (_) {}
}

function stopRecStreams() {
  clearInterval(recTimerInterval);
  clearInterval(recCallWatchInterval);
  clearInterval(recVadInterval);
  recTimerInterval = null;
  recCallWatchInterval = null;
  recVadInterval = null;
  if (recMicSource) {
    try { recMicSource.disconnect(); } catch (_) {}
    recMicSource = null;
  }
  if (recMicFilter) {
    try { recMicFilter.disconnect(); } catch (_) {}
    recMicFilter = null;
  }
  if (recMicAnalyser) {
    try { recMicAnalyser.disconnect(); } catch (_) {}
    recMicAnalyser = null;
  }
  if (activeRecStream) {
    try { activeRecStream.getTracks().forEach(t => t.stop()); } catch (_) {}
    activeRecStream = null;
  }
}

function cancelNanaVoiceRecording(silent = false) {
  recCancelled = true;
  if (activeRecorder && activeRecorder.state !== 'inactive') {
    try { activeRecorder.stop(); } catch (_) {}
  }
  activeRecorder = null;
  stopRecStreams();
  const ov = $('nana-voice-record-overlay');
  if (ov) ov.style.display = 'none';
  if (!silent && $('tg-send-status')) {
    $('tg-send-status').innerText = 'Voice message cancelled';
    setTimeout(() => { if ($('tg-send-status')) $('tg-send-status').innerText = '🟢 Connected to Family Group'; }, 2500);
  }
}

function ensureVoiceRecordOverlay() {
  if ($('nana-voice-record-overlay')) return $('nana-voice-record-overlay');
  const ov = document.createElement('div');
  ov.id = 'nana-voice-record-overlay';
  ov.style.cssText = 'display:none;position:fixed;inset:0;z-index:9999;background:rgba(2,6,23,0.96);flex-direction:column;align-items:center;justify-content:center;padding:24px;text-align:center;';
  ov.innerHTML = `
    <div style="font-size:clamp(2.4rem,6vw,3.8rem);font-weight:900;color:#4ade80;letter-spacing:2px;margin-bottom:10px;">🎙️ SPEAK NOW</div>
    <div id="nana-rec-countdown" style="font-size:clamp(1.8rem,4.5vw,2.6rem);font-weight:900;color:#fef08a;margin-bottom:14px;">30s left</div>
    <div style="width:min(520px,88vw);height:18px;background:#1e293b;border-radius:999px;overflow:hidden;border:2px solid #475569;margin-bottom:12px;">
      <div id="nana-rec-progress" style="width:100%;height:100%;background:#22c55e;transition:width 0.25s linear;"></div>
    </div>
    <div id="nana-rec-auto-status" style="font-size:1.1rem;font-weight:800;color:#bae6fd;min-height:1.5em;margin-bottom:18px;"></div>
    <button type="button" id="nana-rec-done-btn" style="width:min(520px,90vw);padding:22px 18px;border-radius:18px;border:3px solid #fff;background:#16a34a;color:#fff;font-size:1.6rem;font-weight:900;margin-bottom:14px;cursor:pointer;">✅ DONE — SEND NOW</button>
    <div style="display:flex;gap:12px;width:min(520px,90vw);">
      <button type="button" id="nana-rec-more-btn" style="flex:1;padding:16px;border-radius:14px;border:2px solid #38bdf8;background:#0f172a;color:#bae6fd;font-size:1.25rem;font-weight:800;cursor:pointer;">➕ +15s</button>
      <button type="button" id="nana-rec-cancel-btn" style="flex:1;padding:16px;border-radius:14px;border:2px solid #f87171;background:#7f1d1d;color:#fee2e2;font-size:1.25rem;font-weight:800;cursor:pointer;">🗑️ Cancel</button>
    </div>
  `;
  document.body.appendChild(ov);

  $('nana-rec-done-btn').onclick = () => {
    if (Date.now() - recStartedAtMs < VOICE_TAP_GUARD_MS) return;
    recManualDone = true;
    if (activeRecorder && activeRecorder.state === 'recording') {
      try { activeRecorder.stop(); } catch (_) { cancelNanaVoiceRecording(true); }
    } else {
      cancelNanaVoiceRecording(true);
    }
  };
  $('nana-rec-more-btn').onclick = () => {
    recDeadlineMs += 15000;
    if (recDeadlineMs > recHardDeadlineMs) recHardDeadlineMs = recDeadlineMs;
    recLastSpeechAtMs = Date.now();
  };
  $('nana-rec-cancel-btn').onclick = () => {
    if (Date.now() - recStartedAtMs < VOICE_TAP_GUARD_MS) return;
    cancelNanaVoiceRecording(false);
  };
  return ov;
}

window.startNanaVoiceRecording = async () => {
  if (role !== 'nana' || settings.voiceMessagingEnabled === false) return;
  if (state.currentState && state.currentState !== 'idle') return;
  if (activeRecorder && activeRecorder.state === 'recording') return;

  window.closeSeniorKeyboard?.(false);
  pauseActiveChatVoiceMessage();
  window.stopRadioAndSync?.(false);
  hooks.pauseVideo?.('voice_recording');
  window.wakeScreenAndResetDimTimer?.();

  const useNoiseSupp = settings.voiceNoiseSuppression !== false;
  const audioConstraint = useNoiseSupp
    ? { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 }
    : true;
  try {
    activeRecStream = await navigator.mediaDevices.getUserMedia({ audio: audioConstraint });
  } catch (err) {
    if (useNoiseSupp) {
      try {
        activeRecStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      } catch (fallbackErr) {
        console.warn('Mic access denied:', fallbackErr);
        activeRecStream = null;
      }
    } else {
      console.warn('Mic access denied:', err);
      activeRecStream = null;
    }
    if (!activeRecStream) {
      if ($('tg-send-status')) {
        $('tg-send-status').innerText = '⚠️ Microphone unavailable';
        setTimeout(() => { if ($('tg-send-status')) $('tg-send-status').innerText = '🟢 Connected to Family Group'; }, 4000);
      }
      return;
    }
  }

  const mimeCandidates = ['audio/ogg;codecs=opus', 'audio/mp4', 'audio/webm;codecs=opus', 'audio/webm'];
  const chosenMime = mimeCandidates.find(m => window.MediaRecorder?.isTypeSupported?.(m)) || '';
  activeRecChunks = [];
  recCancelled = false;
  recManualDone = false;
  recTotalSpeechMs = 0;
  recVadAvailable = false;

  let recorder;
  try {
    const recOpts = chosenMime
      ? { mimeType: chosenMime, audioBitsPerSecond: 24000 }
      : { audioBitsPerSecond: 24000 };
    recorder = new MediaRecorder(activeRecStream, recOpts);
  } catch (_) {
    try {
      recorder = chosenMime
        ? new MediaRecorder(activeRecStream, { mimeType: chosenMime })
        : new MediaRecorder(activeRecStream);
    } catch (__) {
      recorder = new MediaRecorder(activeRecStream);
    }
  }
  activeRecorder = recorder;

  const baseSec = Math.max(10, Number(settings.voiceMessageMaxSec) || 30);
  const autoExtendEnabled = settings.voiceAutoExtendEnabled !== false;
  const hardCapSec = autoExtendEnabled
    ? Math.max(baseSec, Number(settings.voiceHardCapSec) || 120)
    : baseSec;
  const noSpeechCancelSec = Math.max(0, Number(settings.voiceNoSpeechCancelSec ?? 15) || 0);
  const noSpeechCancelMs = noSpeechCancelSec * 1000;
  const tvGuardMode = String(settings.voiceTvGuardMode || 'normal').toLowerCase();

  const ov = ensureVoiceRecordOverlay();
  ov.style.display = 'flex';
  const doneBtn = $('nana-rec-done-btn');
  const cancelBtn = $('nana-rec-cancel-btn');
  if (doneBtn) doneBtn.disabled = true;
  if (cancelBtn) cancelBtn.disabled = true;

  playVoiceChime();
  await new Promise(r => setTimeout(r, 360));
  if (recCancelled || !activeRecStream || activeRecorder !== recorder) {
    if (activeRecorder === recorder) activeRecorder = null;
    ov.style.display = 'none';
    stopRecStreams();
    return;
  }

  recStartedAtMs = Date.now();
  recDeadlineMs = recStartedAtMs + baseSec * 1000;
  recHardDeadlineMs = recStartedAtMs + hardCapSec * 1000;
  setTimeout(() => {
    if (doneBtn) doneBtn.disabled = false;
    if (cancelBtn) cancelBtn.disabled = false;
  }, VOICE_TAP_GUARD_MS);

  recorder.ondataavailable = (e) => {
    if (e.data && e.data.size > 0) activeRecChunks.push(e.data);
  };

  recorder.onstop = async () => {
    stopRecStreams();
    if (activeRecorder === recorder) activeRecorder = null;
    ov.style.display = 'none';
    if (recCancelled) return;

    const rawElapsedSec = (Date.now() - recStartedAtMs) / 1000;
    const elapsedSec = Math.round(rawElapsedSec);
    const mimeType = recorder?.mimeType || chosenMime || 'audio/webm';
    const blob = new Blob(activeRecChunks, { type: mimeType });
    activeRecChunks = [];

    const noSpeechDetected = !recManualDone && recVadAvailable && noSpeechCancelMs > 0 && recTotalSpeechMs < 700;
    if (rawElapsedSec < 1.5 || blob.size < 1000 || noSpeechDetected) {
      if ($('tg-send-status')) {
        $('tg-send-status').innerText = '🎙️ Didn’t hear anything — tap to try again';
        setTimeout(() => { if ($('tg-send-status')) $('tg-send-status').innerText = '🟢 Connected to Family Group'; }, 3500);
      }
      return;
    }

    if ($('tg-send-status')) $('tg-send-status').innerText = '📤 Sending voice message...';
    try {
      const dataUrl = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(String(reader.result || ''));
        reader.onerror = reject;
        reader.readAsDataURL(blob);
      });
      const base64 = dataUrl.includes(',') ? dataUrl.split(',')[1] : dataUrl;

      if (CONFIG?.googleScriptUrl && SERVICE_TOKEN) {
        const res = await fetch(CONFIG.googleScriptUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'text/plain' },
          body: JSON.stringify({
            secret: SERVICE_TOKEN,
            portalNode: PORTAL_NODE_ID,
            action: 'nana_voice_reply',
            author: 'Nana',
            audioBase64: base64,
            mimeType,
            durationSec: elapsedSec
          })
        });
        const resJson = await res.json().catch(() => null);
        if (!res.ok || (resJson && resJson.ok === false)) {
          throw new Error(resJson?.error || `HTTP ${res.status}`);
        }
      }

      const now = Date.now();
      savedChatScrollTop = null;
      forceScrollBottomNextRender = true;
      await push(refs.bulletin, {
        author: 'Nana',
        fromNana: true,
        type: 'voice',
        voiceDurationSec: elapsedSec,
        text: `🎙️ Voice Message (${elapsedSec}s)`,
        timestamp: now,
        readByNanaAt: now
      });

      if ($('tg-send-status')) {
        $('tg-send-status').innerText = '✅ Voice message sent!';
        setTimeout(() => { if ($('tg-send-status')) $('tg-send-status').innerText = '🟢 Connected to Family Group'; }, 3000);
      }
    } catch (err) {
      console.warn('Voice send failed:', err);
      if ($('tg-send-status')) {
        $('tg-send-status').innerText = '⚠️ Could not send voice message';
        setTimeout(() => { if ($('tg-send-status')) $('tg-send-status').innerText = '🟢 Connected to Family Group'; }, 5000);
      }
    }
  };

  try {
    recorder.start(250);
  } catch (err) {
    console.warn('MediaRecorder start failed:', err);
    activeRecorder = null;
    stopRecStreams();
    ov.style.display = 'none';
    if ($('tg-send-status')) {
      $('tg-send-status').innerText = '⚠️ Could not start recording';
      setTimeout(() => { if ($('tg-send-status')) $('tg-send-status').innerText = '🟢 Connected to Family Group'; }, 4000);
    }
    return;
  }

  const autoStatusEl = $('nana-rec-auto-status');
  const autoSilenceSec = Math.max(0, Number(settings.voiceAutoSendSilenceSec ?? 5) || 0);
  const autoSilenceMs = autoSilenceSec * 1000;
  recLastSpeechAtMs = Date.now();

  if (autoStatusEl) {
    autoStatusEl.innerText = autoSilenceMs > 0
      ? `🎙️ Start speaking — sends ${autoSilenceSec}s after you finish`
      : 'Tap ✅ DONE — SEND NOW when finished';
    autoStatusEl.style.color = '#bae6fd';
  }

  let hasSpoken = false;
  let continuousTvNoise = false;
  const needVad = autoSilenceMs > 0 || autoExtendEnabled || noSpeechCancelMs > 0;

  if (needVad) {
    try {
      const ctx = NanaCore.audioCtx;
      if (ctx.state === 'suspended') ctx.resume().catch(() => {});
      recMicSource = ctx.createMediaStreamSource(activeRecStream);
      recMicAnalyser = ctx.createAnalyser();
      recMicAnalyser.fftSize = 1024;
      recMicAnalyser.smoothingTimeConstant = 0.25;

      // Voice-band filter (300–3400 Hz) feeds ONLY the detector — recording stays natural
      if (tvGuardMode !== 'off' && typeof ctx.createBiquadFilter === 'function') {
        recMicFilter = ctx.createBiquadFilter();
        recMicFilter.type = 'bandpass';
        recMicFilter.frequency.value = 1100;
        recMicFilter.Q.value = 0.7;
        recMicSource.connect(recMicFilter);
        recMicFilter.connect(recMicAnalyser);
      } else {
        recMicSource.connect(recMicAnalyser);
      }

      recVadAvailable = true;
      const vadBuf = new Uint8Array(recMicAnalyser.fftSize);
      const recentRms = [];
      let speechStreak = 0;
      let noiseFloor = 0.01;
      let calSamples = 0;
      let totalFrames = 0;
      let activeFrames = 0;
      const floorCap = tvGuardMode === 'off' ? 0.035 : 0.16;

      recVadInterval = setInterval(() => {
        if (!recMicAnalyser || recorder?.state !== 'recording') return;
        recMicAnalyser.getByteTimeDomainData(vadBuf);
        let sumSq = 0;
        for (let i = 0; i < vadBuf.length; i++) {
          const d = (vadBuf[i] - 128) / 128;
          sumSq += d * d;
        }
        const rms = Math.sqrt(sumSq / vadBuf.length);
        const now = Date.now();
        const elapsedMs = now - recStartedAtMs;

        const calTarget = tvGuardMode === 'off' ? 5 : 8;
        if (calSamples < calTarget) {
          noiseFloor = Math.min(floorCap, calSamples === 0 ? rms : (noiseFloor * 0.7 + rms * 0.3));
          calSamples++;
        }

        if (tvGuardMode !== 'off') {
          recentRms.push(rms);
          if (recentRms.length > 30) recentRms.shift();
          if (recentRms.length >= 10) {
            const sorted = recentRms.slice().sort((a, b) => a - b);
            const p20 = sorted[Math.floor(sorted.length * 0.2)];
            noiseFloor = Math.min(floorCap, noiseFloor * 0.94 + p20 * 0.06);
          }
        }

        let speechThreshold;
        if (tvGuardMode === 'off') {
          speechThreshold = Math.max(0.018, Math.min(0.075, noiseFloor * 2.4));
        } else if (tvGuardMode === 'strict') {
          speechThreshold = Math.max(0.022, Math.min(0.26, noiseFloor * 2.8 + 0.015));
        } else {
          speechThreshold = Math.max(0.016, Math.min(0.22, noiseFloor * 2.2 + 0.010));
        }

        if (rms < speechThreshold) {
          noiseFloor = Math.min(floorCap, noiseFloor * 0.96 + rms * 0.04);
        }

        if (elapsedMs >= 500) {
          totalFrames++;
          if (rms >= speechThreshold) activeFrames++;
          const dutyCycle = totalFrames >= 40 ? (activeFrames / totalFrames) : 0;
          continuousTvNoise = (tvGuardMode === 'normal' && dutyCycle > 0.92) ||
                              (tvGuardMode === 'strict' && dutyCycle > 0.82);
        }

        if (elapsedMs >= 350 && rms >= speechThreshold) {
          speechStreak++;
          if (hasSpoken || speechStreak >= 2) {
            hasSpoken = true;
            recLastSpeechAtMs = now;
            recTotalSpeechMs += 100;
          }
        } else {
          speechStreak = 0;
        }

        if (!hasSpoken && noSpeechCancelMs > 0 && elapsedMs >= noSpeechCancelMs) {
          cancelNanaVoiceRecording(true);
          if ($('tg-send-status')) {
            $('tg-send-status').innerText = '🎙️ Didn’t hear anything — tap Speak to try again';
            setTimeout(() => { if ($('tg-send-status')) $('tg-send-status').innerText = '🟢 Connected to Family Group'; }, 3500);
          }
          return;
        }

        if (hasSpoken && autoSilenceMs > 0) {
          const silentForMs = Math.max(0, now - recLastSpeechAtMs);
          const remSilenceMs = Math.max(0, autoSilenceMs - silentForMs);
          if (autoStatusEl) {
            if (silentForMs >= 1200) {
              autoStatusEl.innerText = `⏳ Sending automatically in ${Math.ceil(remSilenceMs / 1000)}s...`;
              autoStatusEl.style.color = '#fef08a';
            } else {
              autoStatusEl.innerText = `🗣️ Listening... (sends ${autoSilenceSec}s after you stop)`;
              autoStatusEl.style.color = '#bbf7d0';
            }
          }
          if (silentForMs >= autoSilenceMs && recorder?.state === 'recording') {
            try { recorder.stop(); } catch (_) { cancelNanaVoiceRecording(true); }
          }
        }
      }, 100);
    } catch (vadErr) {
      console.warn('Voice silence detector unavailable:', vadErr);
      recVadAvailable = false;
      if (autoStatusEl) autoStatusEl.innerText = 'Tap ✅ DONE — SEND NOW when finished';
    }
  }

  recTimerInterval = setInterval(() => {
    const now = Date.now();
    let remMs = Math.max(0, recDeadlineMs - now);
    const hardRemMs = Math.max(0, recHardDeadlineMs - now);

    // Smart auto-extend: if Nana is still talking near the deadline, add +15s up to hard cap
    if (autoExtendEnabled && hasSpoken && !continuousTvNoise && remMs <= 5000 &&
        (now - recLastSpeechAtMs) < 2500 && recDeadlineMs < recHardDeadlineMs) {
      recDeadlineMs = Math.min(recHardDeadlineMs, recDeadlineMs + 15000);
      remMs = Math.max(0, recDeadlineMs - now);
    }

    const elapsedSec = Math.floor((now - recStartedAtMs) / 1000);
    const remSec = Math.ceil(remMs / 1000);
    const totalMs = Math.max(1000, recDeadlineMs - recStartedAtMs);
    const cdEl = $('nana-rec-countdown');
    const progEl = $('nana-rec-progress');

    if (autoExtendEnabled && hardRemMs > 15000 && !continuousTvNoise) {
      if (cdEl) cdEl.innerText = hasSpoken ? `🎙️ Listening... (${elapsedSec}s)` : `🎙️ Ready (${elapsedSec}s)`;
      if (progEl) {
        const usedPct = Math.min(100, ((now - recStartedAtMs) / Math.max(1000, recHardDeadlineMs - recStartedAtMs)) * 100);
        progEl.style.width = `${Math.max(8, 100 - usedPct)}%`;
        progEl.style.background = '#22c55e';
      }
    } else {
      if (cdEl) cdEl.innerText = remSec <= 10 ? `⏳ Finishing soon (${remSec}s)` : `${remSec}s left`;
      if (progEl) {
        progEl.style.width = `${Math.max(0, Math.min(100, (remMs / totalMs) * 100))}%`;
        progEl.style.background = remSec <= 10 ? '#f59e0b' : '#22c55e';
      }
    }

    if (remMs <= 0 && recorder?.state === 'recording') {
      // Natural-pause grace (up to 5s past hard cap) so she isn't cut off mid-word
      const inPauseGrace = autoExtendEnabled && hasSpoken && !continuousTvNoise &&
                           (now - recLastSpeechAtMs) < 1200 && (now - recHardDeadlineMs) < 5000;
      if (!inPauseGrace) {
        try { recorder.stop(); } catch (_) { cancelNanaVoiceRecording(true); }
      }
    }
  }, 250);

  recCallWatchInterval = setInterval(() => {
    if (state.currentState && state.currentState !== 'idle') {
      cancelNanaVoiceRecording(true);
    }
  }, 500);
};

function ensureReplyChooserOverlay() {
  if ($('nana-reply-chooser-overlay')) return $('nana-reply-chooser-overlay');
  const ov = document.createElement('div');
  ov.id = 'nana-reply-chooser-overlay';
  ov.style.cssText = 'display:none;position:fixed;inset:0;z-index:9997;background:rgba(2,6,23,0.94);flex-direction:column;align-items:center;justify-content:center;padding:24px;text-align:center;gap:18px;';
  ov.innerHTML = `
    <div style="font-size:clamp(1.6rem,4vw,2.2rem);font-weight:900;color:#fef08a;">💬 How would you like to reply?</div>
    <button type="button" id="nana-chooser-speak-btn" style="width:min(540px,92vw);padding:32px 20px;border-radius:22px;border:4px solid #fef08a;background:linear-gradient(135deg,#065f46,#059669);color:#fff;font-size:clamp(1.7rem,4.5vw,2.3rem);font-weight:900;cursor:pointer;box-shadow:0 8px 24px rgba(0,0,0,0.45);">
      🎙️ SPEAK A MESSAGE
      <span style="display:block;font-size:1.05rem;font-weight:700;color:#d1fae5;margin-top:6px;">Just talk — no typing needed</span>
    </button>
    <button type="button" id="nana-chooser-type-btn" style="width:min(540px,92vw);padding:20px;border-radius:18px;border:2px solid #64748b;background:#1e293b;color:#e2e8f0;font-size:1.35rem;font-weight:800;cursor:pointer;">
      ⌨️ Type a Message
    </button>
    <button type="button" id="nana-chooser-back-btn" style="width:min(540px,92vw);padding:16px;border-radius:16px;border:2px solid #475569;background:#0f172a;color:#cbd5e1;font-size:1.2rem;font-weight:800;cursor:pointer;">
      ⬅️ Back to Messages
    </button>
  `;
  document.body.appendChild(ov);

  $('nana-chooser-speak-btn').onclick = () => {
    window.closeReplyChooser();
    window.startNanaVoiceRecording();
  };
  $('nana-chooser-type-btn').onclick = () => {
    window.openActualSeniorKeyboard();
  };
  $('nana-chooser-back-btn').onclick = () => {
    window.closeReplyChooser();
  };
  return ov;
}

window.openReplyChooser = () => {
  if (role !== 'nana' || settings.voiceMessagingEnabled === false) return;
  const ov = ensureReplyChooserOverlay();
  ov.style.display = 'flex';
  window.wakeScreenAndResetDimTimer?.();
};

window.closeReplyChooser = () => {
  const ov = $('nana-reply-chooser-overlay');
  if (ov) ov.style.display = 'none';
};

function ensureVoiceMessagingUI() {
  if (role !== 'nana') return;
  $('nana-voice-coax-banner')?.remove();
  $('nana-kb-voice-coax-btn')?.remove();
  if (settings.voiceMessagingEnabled === false) window.closeReplyChooser?.();
}

if (role === 'nana') {
  renderSeniorKeyboardLayout();
  ensureVoiceMessagingUI();
}

// --- 6. TELEGRAM GROUP VIDEO PLAYBACK IN FAMILY CHAT ---
const chatVideoBlobCache = new Map();
let chatVideoCallWatchInterval = null;
let lastChatVideoWakeMs = 0;

NanaCore.isChatVideoActivelyPlaying = () => {
  const ov = $('nana-chat-video-overlay');
  const vid = $('nana-chat-video-el');
  return !!(ov && ov.style.display === 'flex' && vid && !vid.paused && !vid.ended);
};

if (role === 'nana') {
  hooks.onPowerModeChanged.push((_isLP, _lvl, videoBlocked) => {
    if (videoBlocked) window.closeChatVideoOverlay?.();
    if ($('bulletin-modal')?.style.display === 'flex') renderBulletinFeed(false);
  });
}

function isVideoChatItem(item) {
  return !!(item && (item.videoFileId || item.type === 'video'));
}

function syncChatVideoVolume() {
  const vol = Math.max(10, Math.min(100, Number(settings.videoVolume) || 80));
  const lbl = $('nana-chat-video-vol-lbl');
  if (lbl) lbl.innerText = `${vol}%`;
  const vid = $('nana-chat-video-el');
  if (vid) vid.volume = Math.min(1.0, Math.max(0.1, vol / 100));
}

function ensureChatVideoOverlay() {
  if ($('nana-chat-video-overlay')) return $('nana-chat-video-overlay');
  const ov = document.createElement('div');
  ov.id = 'nana-chat-video-overlay';
  ov.style.cssText = 'display:none;position:fixed;inset:0;z-index:9998;background:#020617;flex-direction:column;justify-content:space-between;padding:14px;box-sizing:border-box;';
  ov.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;">
      <div id="nana-chat-video-title" style="font-size:1.25rem;font-weight:900;color:#fef08a;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">📹 Family Video</div>
      <button type="button" onclick="closeChatVideoOverlay()" style="padding:12px 20px;border-radius:14px;border:2px solid #f87171;background:#991b1b;color:#fff;font-size:1.2rem;font-weight:900;cursor:pointer;flex-shrink:0;">✕ Close</button>
    </div>
    <div style="flex:1;display:flex;align-items:center;justify-content:center;min-height:0;margin:10px 0;">
      <video id="nana-chat-video-el" controls autoplay playsinline style="width:100%;height:100%;max-height:70vh;border-radius:14px;background:#000;"></video>
    </div>
    <div style="display:flex;flex-wrap:wrap;gap:10px;align-items:center;justify-content:center;">
      <button type="button" class="vol-step-btn" onclick="adjustNanaVideoVolume(-15)">🔉 Quieter</button>
      <span id="nana-chat-video-vol-lbl" style="font-size:1.2rem;font-weight:900;color:#38bdf8;min-width:52px;text-align:center;">80%</span>
      <button type="button" class="vol-step-btn" style="background:#0284c7;" onclick="adjustNanaVideoVolume(15)">🔊 Louder</button>
      <button type="button" onclick="closeChatVideoOverlay()" style="flex:1;min-width:190px;padding:16px 20px;border-radius:16px;border:3px solid #fff;background:#dc2626;color:#fff;font-size:1.35rem;font-weight:900;cursor:pointer;">⬅️ Back to Family Chat</button>
    </div>
  `;
  document.body.appendChild(ov);
  return ov;
}

window.closeChatVideoOverlay = () => {
  clearInterval(chatVideoCallWatchInterval);
  chatVideoCallWatchInterval = null;
  const vid = $('nana-chat-video-el');
  if (vid) {
    try { vid.pause(); } catch (_) {}
    vid.removeAttribute('src');
    try { vid.load(); } catch (_) {}
  }
  const ov = $('nana-chat-video-overlay');
  if (ov) ov.style.display = 'none';
  window.wakeScreenAndResetDimTimer?.();
};

function buildChatVideoCardHtml(msgKey, item) {
  const durLabel = fmtVoiceDur(item.videoDurationSec);
  const tooBig = Number(item.videoFileSize || 0) > 20 * 1024 * 1024;
  if (tooBig) {
    return `<div class="nana-chat-video-card" data-vid-key="${esc(msgKey)}" style="margin:8px 0;padding:12px;border-radius:14px;border:2px solid #f87171;background:#1e293b;color:#fca5a5;font-size:1.05rem;font-weight:800;">
      📹 Video is too large to play here (&gt;20 MB) — ask family to send a shorter clip
    </div>`;
  }
  if (role === 'nana' && NanaCore.isVideoBlockedByLowPower?.()) {
    const lpMsg = state.isTabletUnplugged
      ? '🔌 Plug in the tablet charger to watch this family video'
      : '🔋 Low Power Mode is active — video playback paused';
    return `<div class="nana-chat-video-card" data-vid-key="${esc(msgKey)}" style="margin:8px 0;padding:14px;border-radius:16px;border:2px solid #fbbf24;background:#1e293b;color:#fde68a;font-size:1.15rem;font-weight:800;">
      ${lpMsg}${durLabel ? ` (${esc(durLabel)})` : ''}
    </div>`;
  }
  const watched = !!item.watchedByNanaAt;
  const btnBg = watched ? '#334155' : '#0284c7';
  return `<div class="nana-chat-video-card" data-vid-key="${esc(msgKey)}" style="margin:8px 0;">
    <button type="button" onclick="toggleChatVideoMessage('${esc(msgKey)}')" style="width:100%;padding:16px 14px;border-radius:16px;border:3px solid #fef08a;background:${btnBg};color:#fff;font-size:1.35rem;font-weight:900;cursor:pointer;">
      ${watched ? '▶️ WATCH VIDEO AGAIN' : '▶️ PLAY FAMILY VIDEO'}${durLabel ? ` (${esc(durLabel)})` : ''}
    </button>
    <div class="nana-chat-video-status" style="margin-top:4px;font-size:0.95rem;color:#cbd5e1;font-weight:700;"></div>
  </div>`;
}

window.toggleChatVideoMessage = async (msgKey) => {
  const item = state.bulletinSnap[msgKey];
  const card = document.querySelector(`.nana-chat-video-card[data-vid-key="${msgKey}"]`);
  if (!item || !card) return;
  const statusEl = card.querySelector('.nana-chat-video-status');

  if (role === 'nana' && NanaCore.isVideoBlockedByLowPower?.()) {
    if (statusEl) statusEl.textContent = state.isTabletUnplugged ? '🔌 Low Power Mode — plug in charger to watch videos' : '🔋 Low Power Mode is active';
    if (!NanaCore.isCurrentlyInNightWindow?.()) {
      NanaCore.speakMsg?.(state.isTabletUnplugged ? 'Please plug in the tablet charger to watch videos.' : 'Low power mode is active.');
    }
    return;
  }

  pauseActiveChatVoiceMessage?.();
  window.stopRadioAndSync?.(false);
  hooks.pauseVideo?.('chat_video');
  window.wakeScreenAndResetDimTimer?.();

  try {
    if (statusEl) statusEl.textContent = '⏳ Loading video...';
    let src = chatVideoBlobCache.get(item.videoFileId);
    if (!src) {
      const proxyUrl = `${CONFIG.googleScriptUrl}?action=get_media&fileId=${encodeURIComponent(item.videoFileId)}&secret=${encodeURIComponent(SERVICE_TOKEN)}`;
      const res = await fetch(proxyUrl);
      const data = await res.json();
      if (!data?.ok) {
        if (statusEl) statusEl.textContent = data?.tooLarge
          ? '⚠️ Video too large (>20 MB) — ask family to send a shorter clip'
          : `⚠️ ${data?.error || 'Could not load video'}`;
        return;
      }
      if (data.base64) {
        const bin = atob(data.base64);
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        src = URL.createObjectURL(new Blob([bytes], { type: data.mimeType || 'video/mp4' }));
      } else {
        src = data.dataUrl;
      }
      if (!src) throw new Error('No video data');
      setBoundedBlobCache(chatVideoBlobCache, item.videoFileId, src, 3);
    }

    if (role === 'nana' && NanaCore.isVideoBlockedByLowPower?.()) return;
    if (statusEl) statusEl.textContent = '';
    const ov = ensureChatVideoOverlay();
    if ($('nana-chat-video-title')) {
      $('nana-chat-video-title').innerText = `📹 From ${item.author || 'Family'}`;
    }
    ov.style.display = 'flex';
    const vid = $('nana-chat-video-el');
    syncChatVideoVolume();
    vid.src = src;

    vid.onplay = () => {
      syncChatVideoVolume();
      window.wakeScreenAndResetDimTimer?.();
      if (role === 'nana' && !item.watchedByNanaAt) {
        const now = Date.now();
        item.watchedByNanaAt = now;
        item.readByNanaAt = item.readByNanaAt || now;
        syncUnreadMarkersInPlace();
        update(ref(db, `${basePath}/bulletin/${msgKey}`), {
          watchedByNanaAt: now,
          readByNanaAt: item.readByNanaAt
        }).catch(() => {});
      }
    };

    vid.ontimeupdate = () => {
      const now = Date.now();
      if (now - lastChatVideoWakeMs >= 5000) {
        lastChatVideoWakeMs = now;
        window.wakeScreenAndResetDimTimer?.();
      }
    };

    vid.onended = () => {
      window.closeChatVideoOverlay();
    };

    clearInterval(chatVideoCallWatchInterval);
    chatVideoCallWatchInterval = setInterval(() => {
      if ((state.currentState && state.currentState !== 'idle') || (role === 'nana' && NanaCore.isVideoBlockedByLowPower?.())) {
        window.closeChatVideoOverlay();
      }
    }, 500);

    vid.play().catch(() => {});
  } catch (err) {
    console.warn('Chat video load failed:', err);
    if (statusEl) statusEl.textContent = '⚠️ Could not load video';
  }
};

// --- 7. PLUGGED-IN FAMILY PHOTO FRAME SCREENSAVER (BURN-IN SAFE) ---
let screensaverSlideTimer = null;
let screensaverGuardInterval = null;
let screensaverPhotos = [];
let screensaverIndex = 0;
let screensaverDriftToggle = false;
const SS_CORNERS = ['corner-bl', 'corner-br', 'corner-tl', 'corner-tr'];

function formatScreensaverDayAndAgo(tsMs) {
  const ts = Number(tsMs) || 0;
  if (!ts) return '';
  const d = new Date(ts);
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const startOfPhotoDay = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const diffDays = Math.max(0, Math.round((startOfToday - startOfPhotoDay) / 86400000));

  const dayStr = d.toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'short' });
  let agoStr = 'Today';
  if (diffDays === 1) agoStr = 'Yesterday';
  else if (diffDays > 1 && diffDays < 7) agoStr = `${diffDays} days ago`;
  else if (diffDays >= 7 && diffDays < 30) {
    const wks = Math.floor(diffDays / 7);
    agoStr = wks === 1 ? '1 week ago' : `${wks} weeks ago`;
  } else if (diffDays >= 30) {
    const mos = Math.max(1, Math.round(diffDays / 30));
    agoStr = mos === 1 ? '1 month ago' : `${mos} months ago`;
  }
  return `${dayStr} • ${agoStr}`;
}

function getRecentScreensaverPhotos() {
  const maxPhotos = Math.max(5, Math.min(50, Number(settings.photoScreensaverMaxPhotos ?? 20) || 20));
  return Object.entries(state.bulletinSnap || {})
    .map(([key, item]) => ({ key, ...(item || {}) }))
    .filter(item => {
      if (!item || item.systemAlert) return false;
      const direct = resolveChatPhotoUrl(item);
      const fid = item.fileId || item.photoFileId || item.telegramFileId;
      return !!(direct || fid);
    })
    .sort((a, b) => (Number(b.timestamp) || 0) - (Number(a.timestamp) || 0))
    .slice(0, maxPhotos);
}

function isScreensaverAllowedNow() {
  if (role !== 'nana') return false;
  if (settings.photoScreensaverEnabled === false) return false;
  if (state.isCharging !== true || state.isTabletUnplugged) return false;
  if (state.isBatteryDecreasingWhilePlugged) return false;
  if (NanaCore.isLowPowerMode?.() || NanaCore.isCurrentlyInNightWindow?.()) return false;
  if (state.currentState && state.currentState !== 'idle') return false;
  if (NanaCore.isNanaVideoActivelyPlaying?.() || NanaCore.isChatVideoActivelyPlaying?.()) return false;

  const blockingModals = [
    'nana-question-modal', 'confirm-modal', 'admin-pin-modal',
    'care-home-staff-modal', 'bulletin-modal', 'nana-voice-record-overlay',
    'nana-reply-chooser-overlay', 'chat-video-overlay'
  ];
  for (const id of blockingModals) {
    const el = $(id);
    if (el && el.style.display === 'flex') return false;
  }
  return true;
}

function ensurePhotoScreensaverOverlay() {
  let ov = $('nana-photo-screensaver');
  if (ov) return ov;
  ov = document.createElement('div');
  ov.id = 'nana-photo-screensaver';
  ov.innerHTML = `
    <div class="nana-ss-stage">
      <img id="nana-ss-img" class="nana-ss-img" alt="Family Photo" referrerpolicy="no-referrer">
      <div id="nana-ss-caption" class="nana-ss-caption corner-bl">
        <div id="nana-ss-meta" class="nana-ss-meta"></div>
        <div id="nana-ss-text" class="nana-ss-text"></div>
        <div class="nana-ss-hint">Tap anywhere to wake screen</div>
      </div>
    </div>
  `;
  const wakeFromScreensaver = (ev) => {
    ev?.stopPropagation?.();
    stopPhotoScreensaver('tap');
    window.wakeScreenAndResetDimTimer?.();
  };
  ov.addEventListener('pointerdown', wakeFromScreensaver);
  ov.addEventListener('click', wakeFromScreensaver);
  document.body.appendChild(ov);
  return ov;
}

function showScreensaverSlide(idx) {
  if (!state.isPhotoScreensaverActive || !screensaverPhotos.length) return;
  const item = screensaverPhotos[idx % screensaverPhotos.length];
  const img = $('nana-ss-img');
  const cap = $('nana-ss-caption');
  const metaEl = $('nana-ss-meta');
  const textEl = $('nana-ss-text');
  if (!img || !cap || !metaEl || !textEl) return;

  img.classList.remove('visible');
  cap.style.opacity = '0';

  const reveal = () => {
    if (!state.isPhotoScreensaverActive) return;
    screensaverDriftToggle = !screensaverDriftToggle;
    img.classList.remove('drift-a', 'drift-b');
    void img.offsetWidth;
    img.classList.add(screensaverDriftToggle ? 'drift-a' : 'drift-b', 'visible');

    // Rotate caption corner + subtle pixel shift each slide to prevent burn-in
    const corner = SS_CORNERS[idx % SS_CORNERS.length];
    cap.className = `nana-ss-caption ${corner}`;
    const shiftX = Math.round((Math.random() - 0.5) * 18);
    const shiftY = Math.round((Math.random() - 0.5) * 14);
    cap.style.transform = `translate(${shiftX}px, ${shiftY}px)`;

    const sender = item.fromNana ? 'Nana' : (item.author || 'Family');
    const when = formatScreensaverDayAndAgo(item.timestamp);
    metaEl.textContent = when ? `📷 ${sender} • ${when}` : `📷 ${sender}`;

    const showCaption = settings.photoScreensaverShowCaption !== false;
    const rawCaption = String(item.text || '').trim();
    if (showCaption && rawCaption) {
      textEl.textContent = rawCaption;
      textEl.style.display = 'block';
    } else {
      textEl.textContent = '';
      textEl.style.display = 'none';
    }
    cap.style.opacity = '1';
  };

  setTimeout(() => {
    if (!state.isPhotoScreensaverActive) return;
    const direct = resolveChatPhotoUrl(item);
    const legacyFid = item.fileId || item.photoFileId || item.telegramFileId;
    img.onload = () => reveal();
    img.onerror = () => {
      if (legacyFid && !img.dataset.ssRetried) {
        img.dataset.ssRetried = '1';
        loadLegacyPhotoIntoImg(legacyFid, img);
      }
    };
    delete img.dataset.ssRetried;
    if (direct) {
      img.src = direct;
    } else if (legacyFid) {
      loadLegacyPhotoIntoImg(legacyFid, img);
    }
  }, 280);
}

function stopPhotoScreensaver(reason = 'manual') {
  clearInterval(screensaverSlideTimer);
  clearInterval(screensaverGuardInterval);
  screensaverSlideTimer = null;
  screensaverGuardInterval = null;
  const wasActive = state.isPhotoScreensaverActive;
  state.isPhotoScreensaverActive = false;
  const ov = $('nana-photo-screensaver');
  if (ov) ov.style.display = 'none';
  if (wasActive && (reason === 'unplugged' || reason === 'battery_decreasing' || reason === 'night_mode')) {
    const dimTarget = NanaCore.isLowPowerMode?.() ? 5 : (settings.dimBrightness ?? 15);
    NanaCore.applyScreenBrightness?.(dimTarget, true);
  }
}

function tryStartPhotoScreensaver() {
  if (!isScreensaverAllowedNow()) return false;
  const photos = getRecentScreensaverPhotos();
  if (!photos.length) return false;

  screensaverPhotos = photos;
  screensaverIndex = 0;
  state.isPhotoScreensaverActive = true;

  const ov = ensurePhotoScreensaverOverlay();
  ov.style.display = 'flex';

  // Cap brightness below full (max 55%) for burn-in & battery protection
  const ssBright = Math.max(15, Math.min(55, Number(settings.photoScreensaverBrightness ?? 40) || 40));
  NanaCore.applyScreenBrightness?.(ssBright, true);

  showScreensaverSlide(screensaverIndex);

  const intervalMs = Math.max(10, Number(settings.photoScreensaverIntervalSec ?? 30) || 30) * 1000;
  clearInterval(screensaverSlideTimer);
  screensaverSlideTimer = setInterval(() => {
    if (!isScreensaverAllowedNow()) {
      stopPhotoScreensaver('guard');
      return;
    }
    const fresh = getRecentScreensaverPhotos();
    if (!fresh.length) {
      stopPhotoScreensaver('no_photos');
      return;
    }
    screensaverPhotos = fresh;
    screensaverIndex = (screensaverIndex + 1) % screensaverPhotos.length;
    showScreensaverSlide(screensaverIndex);
  }, intervalMs);

  clearInterval(screensaverGuardInterval);
  screensaverGuardInterval = setInterval(() => {
    if (!isScreensaverAllowedNow()) {
      stopPhotoScreensaver(state.isBatteryDecreasingWhilePlugged ? 'battery_decreasing' : 'guard');
    }
  }, 5000);

  return true;
}

hooks.tryStartPhotoScreensaver = tryStartPhotoScreensaver;
hooks.stopPhotoScreensaver = stopPhotoScreensaver;

