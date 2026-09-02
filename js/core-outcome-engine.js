// ============================================================
// core-outcome-engine.js — the comment/outcome-classification engine:
// the two comment-existence checks (combinedCommentsText/
// hasAnyCommentField/hasAnyNarrativeComment), the action-log parser,
// the fuzzy keyword-matching machinery (_editDistance/_wordsMatch/
// _signalMatches/_anySignal), OUTCOME_RULES + inferOutcome (the
// keyword-driven classifier the whole "Suggested Follow-up" feature is
// built on), FOLLOWUP_SUGGESTIONS, the family-comment collation used by
// the RM Timeline and alert cards, and the IST timestamp/duration
// formatters (istStamp/fmtWorkingWait) that sit right beside them in the
// original file. Split out of core.js (Phase 2 — see HANDOVER.md). Pure
// code motion — no logic changed.
// ============================================================

// A lead's comment history lives in TWO columns — internal_status_comments
// (the running action-log history) and stage_comments (logged at
// stage-change events) — either can carry a genuine comment on its own, so
// every "has this lead been commented on" check reads both combined,
// rather than internal_status_comments alone missing a comment that only
// ever landed in stage_comments.
function combinedCommentsText(l){
  return [l.internal_status_comments, l.stage_comments]
    .filter(t => String(t || '').trim())
    .join(' | ');
}

// Broader existence check than combinedCommentsText above: true if ANY of
// the four comment-ish columns (internal_status_comments, stage_comments,
// last_comment, closing_reason) has real content. Used only for "has this
// lead been commented on AT ALL" gates (Recording Not Working) —
// deliberately NOT folded into combinedCommentsText/actionLogEntries
// itself, since last_comment and closing_reason aren't structured
// action-log entries (no per-attempt timestamp, no logger name) and
// counting them as entries would understate a genuine logging gap in
// checks that count entries.
function hasAnyCommentField(l){
  return !!(String(l.internal_status_comments || '').trim()
    || String(l.stage_comments || '').trim()
    || String(l.last_comment || '').trim()
    || String(l.closing_reason || '').trim());
}

// Narrower than hasAnyCommentField above: real narrative content only
// (internal_status_comments, stage_comments, last_comment), excluding
// closing_reason. closing_reason is a classification tag — often the very
// thing that makes a lead read as closed in the first place (see
// isLeadClosed) — not evidence an RM actually worked it. Used only by
// Closed with No Comment: a lead closed via closing_reason alone, with
// nothing else ever logged, is exactly the case that check exists to
// catch; hasAnyCommentField would wrongly clear it since closing_reason
// itself satisfies that broader check.
function hasAnyNarrativeComment(l){
  return !!(String(l.internal_status_comments || '').trim()
    || String(l.stage_comments || '').trim()
    || String(l.last_comment || '').trim());
}

// Your internal_status_comments field (combined with stage_comments via
// combinedCommentsText above) stores a running history like
// "Name: Comment - YYYY-MM-DD HH:MM | Name: Comment - YYYY-MM-DD HH:MM | ..."
// — this parses that into individual attempts matching the SOP's Action Log
// columns (Date, Time, Attempt#, Outcome, CRM Comment, Logged By).
// Outcome is inferred from keywords in the comment text since there's no
// separate Outcome column in the sheet — treat it as best-effort, not exact.
// Parsing the same comment blob is expensive (~150ms across a 7.5k-lead
// sheet) and happens twice per lead — once in enrichLead for multi-agent
// detection, again in renderAlertCard when drawing cards — and re-runs on
// every filter change. The raw text is immutable between refreshes, so
// cache by the string itself. Cleared on each data reload.
const _actionLogCache = new Map();

function parseActionLog(text){
  if (!text || !String(text).trim()) return [];
  const key = String(text);
  const cached = _actionLogCache.get(key);
  if (cached) return cached;

  const entries = key.split('|').map(s => s.trim()).filter(Boolean);
  const parsed = entries.map((entry, i) => {
    const m = entry.match(/^(.*?):\s*(.*?)\s*-\s*(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2})\s*$/);
    let loggedBy = '', comment = entry, ts = null;
    if (m) {
      loggedBy = m[1].trim();
      comment = m[2].trim();
      ts = m[3].trim();
    }
    return { attempt: i + 1, loggedBy, comment, ts, outcome: inferOutcome(comment) };
  });

  _actionLogCache.set(key, parsed);
  return parsed;
}

/* ---------- Fuzzy keyword matching ---------- */
// RMs log outcomes as short telecalling shorthand at least as often as
// full sentences ("RNR", "CB", "NI"), and just as often with a spelling
// mistake typed under time pressure ("buzy", "requriment", "intrested",
// "recieved"). Hand-spelling out every misspelling anyone might type is
// exactly backwards — it grows without bound and still misses the next
// one. Instead, every signal below is checked with typo tolerance: a
// comment word within a small edit distance of a signal word counts as
// that signal, so a spelling mistake attributes to its nearest real
// keyword automatically instead of needing its own hand-added entry.
// Optimal-string-alignment distance — plain edit distance (insert/delete/
// substitute) PLUS an adjacent transposition as a single edit, so the
// "ie"/"ei" swap in "recieved" costs 1 the same way a dropped or doubled
// letter would, not 2. Needs the full 2D table (not a rolling array) since
// the transposition check looks back two rows; words here are always
// short, so that's not a real cost.
function _editDistance(a, b){
  const m = a.length, n = b.length;
  if (!m) return n;
  if (!n) return m;
  // Three rolling rows (this row, one back, two back — the transposition
  // check needs to see two rows back) instead of the full m+1 row table —
  // this runs per word pair, per signal, per comment, across a sheet of
  // thousands of rows, so not allocating m extra arrays per call adds up.
  let twoBack = null;
  let oneBack = new Array(n + 1);
  let cur = new Array(n + 1);
  for (let j = 0; j <= n; j++) oneBack[j] = j;
  for (let i = 1; i <= m; i++){
    cur[0] = i;
    const ai = a[i - 1];
    for (let j = 1; j <= n; j++){
      const cost = ai === b[j - 1] ? 0 : 1;
      let best = Math.min(oneBack[j] + 1, cur[j - 1] + 1, oneBack[j - 1] + cost);
      if (i > 1 && j > 1 && twoBack && ai === b[j - 2] && a[i - 2] === b[j - 1]) {
        best = Math.min(best, twoBack[j - 2] + 1);
      }
      cur[j] = best;
    }
    const tmp = twoBack; twoBack = oneBack; oneBack = cur; cur = (tmp || new Array(n + 1));
  }
  return oneBack[n];
}
// How many edits a word may be off by and still count as a typo of the
// target — scaled by the TARGET's length, not the comment word's, so a
// short telecalling code ("nc", "cb", "wn", "dnd") only ever matches
// itself exactly (one edit away from 2-3 letters is a different word, not
// a typo of it), while a longer word ("requirement") tolerates the single
// dropped/swapped/extra letter an RM actually types. Capped at 2 even for
// very long words — NOT scaled up further — because a 3-edit budget
// turned out to blur genuinely different verb forms that happen to share
// a long root ("disconnected" is 3 edits from "disconnecting", "visit" is
// 2 from "visited"): those are different grammatical forms with different
// meanings here, not typos of one another, and conflating them silently
// misrouted real comments to the wrong outcome.
// The <=4 cutoff (not <=3) was found the hard way: with a 1-edit budget,
// "busy" (4 letters) fuzzy-matched "buy", "bus", and "buys" — genuinely
// different, common, IMPORTANT words (a client saying "buy" is the exact
// opposite signal from a stale line being busy) that just happen to be one
// edit away. At 4 letters there are too many real short words within one
// edit of each other for any of them to safely tolerate a typo; exact
// match only up to that length, same as the 2-3 letter codes.
function _typoBudget(targetLen){
  if (targetLen <= 4) return 0;
  if (targetLen <= 8) return 1;
  return 2;
}
function _wordsMatch(word, target){
  if (word === target) return true;
  const budget = _typoBudget(target.length);
  if (!budget || Math.abs(word.length - target.length) > budget) return false; // cheap pre-filter before the real (more expensive) distance check
  return _editDistance(word, target) <= budget;
}
// Apostrophes are stripped before tokenizing, so "don't"/"didn't"/"can't"
// and the unapostrophed way people actually type on a phone keyboard
// ("dont"/"didnt"/"cant") collapse to the same token — one canonical
// signal covers both instead of needing each spelled out twice.
function _wordsOf(text){
  return String(text).toLowerCase().replace(/'/g, '').match(/[a-z0-9]+/g) || [];
}
// The same ~110 signal strings, across every rule, get tokenized on every
// single comment classified — caching the split means that only happens
// once per DISTINCT signal ever, not once per (signal, comment) pair.
const _signalWordsCache = new Map();
function _signalWordsOf(signal){
  let w = _signalWordsCache.get(signal);
  if (!w) { w = signal.split(' '); _signalWordsCache.set(signal, w); }
  return w;
}
// A signal is one word, or a short space-separated phrase. A single word
// fuzzy-matches ANY word in the comment. A multi-word phrase requires
// that exact sequence to appear consecutively and in order, each word
// individually typo-tolerant — word order is what gives a phrase like
// "not looking" or "switched off" its meaning; a bag-of-words match would
// also fire on an unrelated sentence that happens to contain both words
// separately ("still looking, but not sure" is not "not looking").
function _signalMatches(commentWords, signal){
  const target = _signalWordsOf(signal);
  if (target.length === 1) return commentWords.some(w => _wordsMatch(w, target[0]));
  for (let i = 0; i + target.length <= commentWords.length; i++){
    let ok = true;
    for (let j = 0; j < target.length; j++){
      if (!_wordsMatch(commentWords[i + j], target[j])) { ok = false; break; }
    }
    if (ok) return true;
  }
  return false;
}
function _anySignal(commentWords, signals){
  return signals.some(s => _signalMatches(commentWords, s));
}

// One outcome per entry, checked IN ORDER — the first rule that matches
// wins, same as a real telecaller reading top-to-bottom priority (e.g. a
// request to stop calling overrides whatever else the same comment says,
// so Do Not Disturb is checked before anything else; "booked elsewhere"
// is checked before the generic Not Interested, since it's the more
// specific and more useful signal when a comment mentions both).
// `signals` is the lean list of canonical words/phrases for this outcome
// — typo tolerance (see above) means each one only needs to be spelled
// out ONCE in its correct form, not once per misspelling. `test` is an
// escape hatch for the handful of rules that need independent conditions
// to co-occur without being a single fixed phrase (e.g. "incoming" +
// "barred" anywhere in the comment, not necessarily adjacent).
// This array was audited against a real batch of ~400 rows pulled from
// Apps Script's Unmatched_Comments_Log tab on 2026-08-28 (see
// UnmatchedCommentLogger.gs) — every addition/new entry below (marked at
// its own site) traces back to a genuine, RECURRING pattern in that
// batch, not a one-off. Two real, recurring phrases from that same batch
// were deliberately left OUT rather than guessed at: "BPCL" (appeared 5+
// times — "not giving BPCL", "bpcl not given" — meaning unconfirmed) and
// "already visited [some other project]" alone (visited OUR project vs a
// COMPETITOR's is genuinely ambiguous from the text alone, and guessing
// wrong here risks giving the OPPOSITE advice of what's actually true).
// Kept in sync with FollowupEngine.gs's identical OUTCOME_RULES_GS_ —
// mirror any future change there here too (and vice versa).
const OUTCOME_RULES = [
  { outcome: 'Do Not Disturb', signals: ['do not call', 'dont call', 'not to call', 'stop calling', 'dnd'] },
  { outcome: 'Switched Off', signals: [
      'switch off', 'switched off', 'sw off', 'swoff', 'not reachable', 'unreachable', 'not contactable',
      'out of coverage', 'out of service', 'out of network', 'call forwarded', 'call forwarding',
      'voice mail', 'voice message', 'voicemail',
      // 'no incoming'/'incoming not avail(able)' — a real, recurring
      // telecom-technical complaint (line can't receive calls), same
      // family as the other network/service signals above it.
      'no incoming', 'incoming not avail', 'incoming not available',
    // 'unavailable' is checked as an exact word here, not a fuzzy signal —
    // it's a real, common way RMs log this outcome ("number unavailable"),
    // but as a fuzzy target its typo budget (2, at 11 letters) is wide
    // enough to also match "available" (2 edits away: insert "u","n"),
    // the literal opposite meaning. 'ivr' is the same real-world signal as
    // voicemail/voice message above (call reached an automated system, not
    // a person), just not phrased as "voice mail/message".
    ], test: (c, w) => (_anySignal(w, ['incoming']) && _anySignal(w, ['barred', 'not available']))
      || w.indexOf('unavailable') !== -1 || w.indexOf('ivr') !== -1 },
  { outcome: 'Wrong Number', signals: [
      'wrong number', 'invalid number', 'invalid no', 'wn',
      // 'not exist'/'does not exist' — a distinct, recurring phrasing of
      // the same underlying meaning as "invalid number" above.
      'not exist', 'does not exist', 'number doesnt exist',
    ] },
  // NEW outcome — real, recurring pattern: an RM flagging the LEAD ITSELF
  // as not genuine (fake/duplicate/accidental), not a real customer who
  // declined. Checked early, same tier as Wrong Number, since neither is
  // really about call OUTCOME at all — the lead isn't real to begin with.
  { outcome: 'Junk / Duplicate Lead', signals: [
      'fake enquiry', 'fake inquiry', 'duplicate lead', 'inquiry by mistake', 'enquiry by mistake',
      'casual inquiry', 'casual enquiry',
    ] },
  // Customer saw/heard the call and actively ended it — a different
  // signal from RNR (never picked up at all) or Disconnected below (a
  // network/connectivity drop): this one means they chose not to talk, so
  // calling straight back is more likely to annoy than connect.
  { outcome: 'Call Declined', signals: [
      'hung up', 'hangup', 'disconnecting', 'disconnect the call', 'disconnect call', 'declined', 'declining', 'decline',
      'cut the call', 'call cut',
      // 'call rejected'/'rejected the call' — a very common, distinct
      // phrasing of the same active-decline meaning; 'disconect' is an
      // explicit typo alias (edit distance from 'disconnected' exceeds
      // the fuzzy-match budget at that word length, so it needs a literal
      // entry — same reasoning as 'buzy' below).
      'call rejected', 'rejected the call', 'disconect',
    // Bare "disconnect"/"disconnect -" only, anchored — a plain signal
    // match on the single word 'disconnect' would also swallow
    // "disconnected", which stays its own, later, pre-existing outcome.
    ], test: (c) => /^disconnect\s*-?\s*$/.test(c) },
  // 'buzy' listed explicitly, not left to typo tolerance — see
  // _typoBudget's comment on why 4-letter words match exactly only.
  { outcome: 'Busy', signals: ['busy', 'buzy'] },
  { outcome: 'Booked Elsewhere', signals: [
      'booked elsewhere', 'booked with another', 'purchased elsewhere', 'purchased another',
      'bought elsewhere', 'bought another', 'already bought', 'already purchased',
      'finalized another', 'finalised another', 'gone with another',
      // Broadened from requiring an explicit "elsewhere"/"another"
      // qualifier — real comments very often just say "already booked" /
      // "already finalized" and name the specific competing project
      // instead (which this engine has no way to recognize as a
      // competitor vs our own project — see this array's own top note).
      'already booked', 'already finalized', 'already finalised',
      'finalize the property', 'finalise the property',
    ] },
  // NEW outcome — real, recurring pattern: an RM flagging that this needs
  // a hand-off to another team/project ("cross call"/"cross pitch" —
  // Homesfy-internal shorthand). Checked at the same tier as Booked
  // Elsewhere, since both are "this needs a different kind of handling,
  // not another retry call" signals.
  { outcome: 'Needs Cross-Team Routing', signals: [
      'cross call', 'cross pitch', 'need a cross', 'need to cross', 'needs a cross',
    ] },
  // NEW outcome — "BPCL" (Budget, Possession timeline, Configuration,
  // Location — Homesfy-internal shorthand, confirmed 2026-08-28) was left
  // out of the initial batch review since its meaning wasn't known yet;
  // real, recurring pattern (5+ occurrences: "not giving BPCL", "bpcl not
  // given", "not cleared BPCL"). Every observed real instance is negative
  // ("not sharing it"), so this requires BOTH 'bpcl' AND a nearby
  // negation word rather than assuming every mention is negative.
  { outcome: 'BPCL Not Shared', test: (c, w) => {
      if (!_anySignal(w, ['bpcl'])) return false;
      return _anySignal(w, ['not', 'nahi', 'didnt', 'doesnt', 'no']);
    } },
  // We only sell first-sale (developer/builder to buyer) — a client
  // wanting resale or rental was never in scope, so this is a genuine,
  // valid reason to close, same standing as Booked Elsewhere, not a
  // "lost interest" to chase. 'resale'/'resell'/'second hand'/'to let'
  // name the property TYPE unambiguously, so they're safe as plain
  // signals. "rent"/"rental"/"renting" are NOT — "on rent currently but
  // wants own home" and "currently renting, wants to buy" both contain
  // those words while meaning the OPPOSITE of this outcome (describing
  // the client's PRESENT arrangement, not their ask). The test below only
  // fires when a rent word is paired with an actual seeking verb
  // (want/need/looking/require/search) AND there's no "current(ly)" in
  // the same comment — that combination is what actually distinguishes
  // "I need a place on rent" from "I currently rent".
  { outcome: 'Resale / Rental (Out of Scope)', signals: ['resale', 'resell', 'second hand', 'to let'],
    test: (c, w) => {
      if (!_anySignal(w, ['rent', 'rental', 'renting'])) return false;
      if (_anySignal(w, ['current', 'currently'])) return false;
      return _anySignal(w, ['want', 'wants', 'need', 'needs', 'looking', 'require', 'requires', 'searching', 'search']);
    } },
  { outcome: 'RNR', signals: [
      'rnr', 'cnr', 'nc', 'nr', 'not responding', 'no answer', 'no response', 'not answering', 'not answered',
      'didnt answer', 'not picking', 'did not pick', 'didnt pick', 'pickup the call', 'pick up the call',
      'do not pickup', 'do not pick up', 'call not answered', 'call not received', 'call not receive',
      'not received call', 'not received', 'call not respond', 'call not pick', 'call not picked', 'not receiving',
      // 'no respond'/'not respond'/'not response' — "respond"/"response"
      // used interchangeably by RMs, but neither fuzzy-matches the other
      // at their word lengths (edit distance 2 exceeds the budget of 1) —
      // a real, recurring miss, confirmed 4+ times in one batch alone.
      // 'not attending' and 'not able to connect' are distinct real
      // phrasings of the same "couldn't reach them" meaning.
      'no respond', 'not respond', 'not response', 'not attending', 'not able to connect',
    ] },
  // Bare "ring" is real telecalling shorthand ("Ring", "ring -") but ALSO
  // a real word in unrelated location context ("near ring road") — a plain
  // word signal would wrongly fire on the latter. The anchored regex only
  // matches when "ring"/"ring -" is the WHOLE comment, the same shape the
  // real shorthand notes actually take, not just any mention of the word.
  { outcome: 'Ringing / RNR', signals: ['ringing'], test: (c) => /^ring\s*-?\s*$/.test(c) },
  // Word-boundary matching (not a bare substring) already keeps "disc"
  // from matching inside "discussed"/"discount"/"disclose" — see
  // _signalMatches, which only ever compares whole tokens.
  { outcome: 'Disconnected', signals: [
      'disconnected', 'call disc', 'disc', 'network issue', 'network problem', 'poor network',
      'call not connecting', 'call not connected', 'call not connect', 'not getting connected',
      'not connecting', 'not connected', 'call drop', 'blank call',
    ] },
  { outcome: 'Out of Station', signals: ['out of station', 'out station', 'out of town', 'not in town', 'travelling'] },
  // Contact has no WhatsApp at all, or it's unreachable there — a
  // different signal from WhatsApp Sent below (a text WAS sent, just not
  // yet answered): this one means texting isn't an option for this
  // contact, so don't keep defaulting back to WhatsApp. Checked first for
  // exactly that reason.
  { outcome: 'WhatsApp Unavailable', test: (c, w) => _anySignal(w, ['whatsapp', 'wp', 'wa']) && _anySignal(w, ['not on', 'not available']) },
  // 'dwm' alone is enough — it already spells out "Dropped WhatsApp
  // Message" as one abbreviation, nothing else needed to confirm it.
  { outcome: 'WhatsApp Sent', signals: ['dwm', 'textedon'],
    // Broadened past the literal word "whatsapp" — "wp"/"wa" shorthand,
    // "whats app"/"whats up" (both common autocorrect mangles of
    // "whatsapp"), and the many verbs RMs actually use for the same
    // action (dropped/shared/sent/pinged/texted a message). Bare "msg"/
    // "message"/"text" without a named channel still counts — in this
    // telecalling shorthand it's WhatsApp by convention. Both "drop" and
    // "dropped" are listed (not just one) deliberately — a 3-letter
    // suffix like "-ped" isn't a typo of the base word, it's a different
    // inflected FORM, so typo-tolerance alone (by design — see
    // _typoBudget) won't bridge "drop" to "dropped" the way it bridges
    // "recieved" to "received". 'textedon' (no space) is the same idea:
    // a missing-space glue of two real words, not a misspelling of one.
    test: (c, w) => _anySignal(w, ['whatsapp', 'whats app', 'whats up', 'wp', 'wa', 'msg', 'mesg', 'message', 'text']) &&
      _anySignal(w, ['drop', 'dropped', 'shared', 'share', 'sent', 'pinged', 'texted']) },
  // Checked before the generic "shared/sent details" match below, since
  // "shared X on whatsapp" would otherwise also satisfy that pattern.
  { outcome: 'Details Shared', test: (c, w) => _anySignal(w, ['shared', 'share', 'sent']) && _anySignal(w, ['detail', 'brochure', 'project', 'info']) },
  // Checked before Visit Arranged below — "visit done"/"visited" is the
  // opposite moment (post-visit) from "visit scheduled"/"visit arranged"
  // (pre-visit), and needs its own follow-up action, not a confirm-
  // attendance reminder for a visit that already happened.
  { outcome: 'Visit Completed', signals: [
      'visit done', 'visited site', 'site visited', 'visit completed', 'came for visit', 'visited the project',
    ] },
  { outcome: 'Visit Arranged', signals: [
      'site visit', 'visit scheduled', 'visit arranged', 'visit booked', 'visit fixed', 'visit confirmed',
      'will visit', 'coming for visit', 'visit planned',
    ] },
  // Checked before Budget Concern — a loan/paperwork update often also
  // mentions amounts, but "in process" is the more specific, more useful
  // signal (keep warm and check status, not "find a cheaper option").
  { outcome: 'Loan In Process', signals: ['document submitted', 'bank process'],
    test: (c, w) => _anySignal(w, ['loan']) && _anySignal(w, ['process', 'sanction', 'approval']) },
  // "not looking"/"no requirement"/"not requirement" cover every "not
  // looking for property"/"not looking any property"/etc. variant on
  // their own (all contain "not looking" as a substring) — a real-estate
  // lead's "not looking" is unambiguous enough in this domain not to need
  // the fuller phrase spelled out.
  { outcome: 'Not Interested', signals: [
      'not interested', 'no interest', 'no longer interested', 'not looking',
      'no requirement', 'not requirement', 'not enquired', 'dropped the plan', 'dropped the idea', 'ni',
    ] },
  // "considering"/"thinking" checked before the bare "interested" match,
  // since a comment like "will think and let us know if interested" should
  // read as still-deciding, not a firm expression of interest.
  { outcome: 'Considering', signals: [
      'consider', 'think about', 'will think', 'will get back', 'need some time', 'need time', 'will discuss',
      // 'will update'/'will let you know'/'will let know'/'will check'/
      // 'will confirm' — real, very common RM shorthand for the same
      // "still deciding, will come back to us" meaning as 'will get
      // back' above, just phrased differently.
      'will update', 'will let you know', 'will let know', 'will check', 'will confirm',
    ] },
  { outcome: 'Budget Concern', signals: ['budget', 'expensive', 'too high', 'high price', 'costly', 'cant afford', 'cannot afford', 'out of budget'] },
  { outcome: 'Interested', signals: ['interested'] },
  { outcome: 'DNP', signals: [
      'call again', 'dnp', 'call back', 'callback', 'call later', 'call after', 'call tomorrow',
      'requested callback', 'asked to call', 'cb',
    // "call me <time>"/"connect <time>"/Hindi "<time> baje call karo" —
    // the plain multi-word `signals` above only ever match CONSECUTIVE
    // words with nothing between them, so "call me tomorrow"/"call me
    // back" never matches "call tomorrow"/"call back" because of the
    // inserted "me" — this was, by a wide margin, the single biggest
    // recurring miss found in a real batch of Unmatched_Comments_Log rows
    // (dozens of comments shaped exactly like "SHE SAID CALL ME 3.30 PM" /
    // "asked me to connect tomorrow at 11 Am").
    ], test: (c) => {
      if (/\bcall\s+me\b/.test(c)) return true;
      if (/\b(asked|told|said)\s+(me\s+)?to\s+connect\b/.test(c)) return true;
      if (/\bconnect\s+(on|at|after|tomorrow|back|evening|later)\b/.test(c)) return true;
      if (/\bcall\s*karo\b/.test(c)) return true; // Hindi/Hinglish "call karo" = "call [me]"
      return false;
    } },
  // RM-side admin note (a scheduled follow-up wasn't done in time), not
  // anything the client said — but frequent and unambiguous enough, with
  // a clear next action, to earn a real outcome instead of the generic
  // "no keyword" bucket.
  { outcome: 'Follow-up Missed', signals: ['followup missed', 'follow up missed'] },
  // NEW outcome — genuinely ambiguous whether "already visited [X]" means
  // OUR project or a COMPETITOR's from the comment text alone (originally
  // left out of the batch review for exactly this reason). Resolved with
  // a suggestion that's useful either way, per explicit request: sharing
  // a few DIFFERENT project options gives the client something new to
  // compare regardless of which case it actually is, rather than trying
  // (and risking getting wrong) to diagnose which one it is.
  { outcome: 'Already Visited (Other Project)', signals: [
      'already visited', 'has already visited', 'has visited', 'visited already',
    ] },
  // NEW outcome, deliberately LAST — only reached once nothing more
  // specific matched anywhere above. RM logged what the customer WANTS
  // (budget/BHK/location — "Looking for 2bhk in 1.5cr", "1bhk in 50L")
  // but no call OUTCOME at all — every rule above describes what HAPPENED
  // on a call; this is the one case where nothing happened, or at least
  // nothing was said about it. This was easily the single LARGEST bucket
  // in a real batch of Unmatched_Comments_Log rows — dozens of comments
  // shaped exactly like this, previously all landing on the fully-generic
  // "Update"/no-keyword-match fallback.
  { outcome: 'Requirement Noted (No Status)', signals: ['client wants', 'customer wants'],
    // A `signals` phrase list alone missed the MORE common real shape:
    // "Looking 2bhk under 50 lac" (no "for"), not "Looking FOR 2bhk...".
    // Requires BOTH a seeking word AND an actual property-shape mention
    // (BHK count, budget unit, or property type) — same defensive pairing
    // as the Resale/Rental rule above — so a bare "looking" elsewhere in
    // an unrelated sentence can't misfire this; this rule is deliberately
    // LAST anyway, so everything more specific has already had first
    // refusal by the time it runs.
    test: (c, w) => {
      if (!_anySignal(w, ['looking', 'want', 'wants', 'searching', 'search'])) return false;
      // "2bhk"/"3bhk" (digit glued directly to "bhk", no space) is
      // extremely common and can NEVER match as a fuzzy word signal — a
      // leading digit makes the whole token "2bhk", not "bhk", and short
      // words like "bhk" get zero typo tolerance (see _typoBudget) —
      // checked directly against the raw comment text instead of the
      // tokenized word list for exactly that reason.
      if (/\d\s*bhk\b/i.test(c)) return true;
      // Deliberately no 'rent' here — "currently on rent, wants to buy"
      // is a real, tested case (their PRESENT situation, not what they
      // want) that would otherwise misfire; genuine rental-seeking is
      // already handled by the dedicated Resale/Rental rule above, which
      // has its own currently/current exclusion for exactly this reason.
      return _anySignal(w, [
        'cr', 'crore', 'lac', 'lacs', 'lakh', 'lakhs', 'sqft', 'carpet',
        'plot', 'shop', 'commercial', 'office', 'flat', 'penthouse',
        'villa', 'rowhouse', 'property',
      ]);
    } },
];

// Real telecalling shorthand repeats enormously — the same exact comment
// text ("MSG dropped", "Interested", "Busy") gets logged under hundreds of
// different leads (see the Movement tab's Unmatched Comments export, whose
// whole premise is grouping by repeated exact text). Fuzzy signal matching
// is real work per call — a comment that matches nothing sweeps every rule
// before giving up, worst case — so re-running it on text this repetitive,
// once per lead instead of once per DISTINCT text, is the difference
// between a render that's instant and one that visibly freezes the tab on
// a sheet with thousands of rows. Keyed on the untouched input, matching
// exactly what every caller passes.
const _inferOutcomeCache = new Map();
function inferOutcome(comment){
  const cached = _inferOutcomeCache.get(comment);
  if (cached !== undefined) return cached;
  const result = _inferOutcomeUncached(comment);
  _inferOutcomeCache.set(comment, result);
  return result;
}
function _inferOutcomeUncached(comment){
  const c = String(comment).toLowerCase();
  // A placeholder with no real content — a bare "-", ".", "/", or similar
  // punctuation-only note some RMs log when there's nothing to report (by
  // a wide margin the single most common "unmatched" comment in practice —
  // see the Movement tab's Unmatched Comments export). Checked before
  // anything else: there's no keyword TO match here, and without this it
  // fell through to the generic Update/"no clear signal" fallback looking
  // exactly like a genuine unclassifiable comment, when really there's no
  // comment here to classify in the first place.
  if (/^[\s\-_./]+$/.test(c)) return 'No Real Update';
  const words = _wordsOf(c);
  for (const rule of OUTCOME_RULES) {
    if ((rule.signals && _anySignal(words, rule.signals)) || (rule.test && rule.test(c, words))) return rule.outcome;
  }
  return 'Update';
}

// One-time cleanup: an earlier version of this dashboard offered optional
// Claude-reviewed follow-up suggestions, backed by an API key and a
// suggestion cache in local storage. That feature has been removed — this
// clears out any leftover key/cache so nothing unused lingers behind.
try {
  localStorage.removeItem('gsl_claude_api_key');
  localStorage.removeItem('gsl_ai_suggestion_cache_v1');
} catch (e) {}

// One suggested next action per inferOutcome() result — same keyword-based,
// best-effort inference (no separate Outcome column in the sheet), applied
// to region-email issue rows so each lead carries a concrete "what to do
// next" instead of just a bare comment count.
const FOLLOWUP_SUGGESTIONS = {
  'Do Not Disturb': "Client asked not to be called — stop calling immediately, log as DND, and only re-engage via an approved channel (SMS/email) if policy allows.",
  'Switched Off': 'Phone was switched off, out of service/network, or otherwise unreachable — retry later today; try an alternate number if one is on file.',
  'Wrong Number': 'Number appears incorrect — verify the contact number with the source/RM before calling again.',
  'Junk / Duplicate Lead': 'RM flagged this as not a genuine lead (fake/duplicate/accidental enquiry) — verify quickly, then close with the right reason instead of continuing normal follow-up.',
  'Call Declined': "Customer saw or heard the call and actively ended/declined it — they're avoiding contact right now, so calling straight back is more likely to annoy than connect. Try a different time of day, or switch to WhatsApp/SMS first.",
  'Busy': 'Line was busy — retry within a few hours.',
  'Booked Elsewhere': "Client says they've booked/purchased elsewhere — confirm this is genuinely final before closing; don't assume dead until it's verified.",
  'Needs Cross-Team Routing': "RM flagged this needs a cross-call/cross-pitch handoff to another project or team — confirm that hand-off actually happened rather than letting it sit untouched.",
  'BPCL Not Shared': "Customer hasn't shared their BPCL (Budget, Possession timeline, Configuration, Location) — keep working to pin these down; without them it's hard to pitch a relevant option.",
  'Resale / Rental (Out of Scope)': "Client is looking for resale or rental, not a new first-sale (developer/builder) property — we don't work that segment. Close with this as the reason rather than treating it as lost interest.",
  'RNR': 'No response — retry at a different time of day; consider a WhatsApp follow-up.',
  'Ringing / RNR': 'Rang but no pickup — retry at a different time of day.',
  'Disconnected': "Call dropped, didn't connect, or connected with no response — retry; flag the number if this keeps happening.",
  'Out of Station': "Client is travelling — schedule the follow-up for when they're back rather than repeat-calling now.",
  'WhatsApp Unavailable': "This contact isn't reachable on WhatsApp (or doesn't have it) — stick to voice calls or SMS instead of defaulting back to a WhatsApp text.",
  'WhatsApp Sent': 'A WhatsApp/text message was sent or dropped but not yet followed by a call — a text may go unseen, call to confirm.',
  'Details Shared': 'Project details were shared — follow up to gauge interest and answer any questions before it goes cold.',
  'Visit Completed': "Site visit already happened — call within 24 hours for feedback while it's fresh, and push toward the next concrete step.",
  'Visit Arranged': 'A site visit is arranged — confirm attendance close to the date, and follow up right after for feedback.',
  'Loan In Process': "Loan/paperwork is in process on their end — check status periodically and keep them warm, don't let this go cold.",
  'Not Interested': 'Client indicated no interest (or no current requirement) — confirm this is final, then close with a clear reason if so.',
  'Considering': 'Client is still deciding — schedule a follow-up in a few days rather than calling again immediately.',
  'Budget Concern': 'Budget was raised as a concern — check for a better-fit option or payment plan before the next call.',
  'Interested': 'Client showed interest — move quickly to the next step (site visit, documents, or pricing).',
  'DNP': 'Client asked to be called back later — schedule the follow-up call.',
  'Follow-up Missed': 'A scheduled follow-up was missed — reach out right away to catch up before it goes any staler.',
  'Already Visited (Other Project)': "Client mentioned already visiting a project — unclear from the comment whether it's ours or a competitor's. Either way, share details on a couple of DIFFERENT project options to keep them engaged and give them something new to compare, rather than re-pushing the same one.",
  'Requirement Noted (No Status)': "RM logged the customer's stated requirement (budget/BHK/location) but no call outcome — call and pin down where this actually stands, then log a real status, not just the requirement.",
  'No Real Update': "RM logged a placeholder with no real content — there's nothing here to act on from the comment alone. Call and get an actual status update, then log what was actually said.",
};

// Fallback for when inferOutcome finds no keyword match at all (a comment
// that's real information — e.g. "looking for 3bhk 3t, pitch tvs or
// purvankara" — just doesn't contain any of the known outcome keywords).
// Previously this returned a generic "read the comments above" line, which
// is actively unhelpful: the comment itself isn't shown anywhere else in
// most callers (email issue tables only carry Lead ID/Region/RM/Age/this
// column), so the one thing that would let a human actually act on it was
// being thrown away. Quoting the real latest note beats a canned message.
function unmatchedFollowUp(comment, loggedBy, ts){
  const text = String(comment || '').trim();
  if (!text) return 'Manual review required — no keyword match found. Read the comments above and log a specific next call/action; do not leave this one unactioned.';
  const who = String(loggedBy || '').trim();
  const when = ts ? istStamp(ts) : '';
  const attribution = [who, when].filter(Boolean).join(', ');
  return `No keyword match — latest note${attribution ? ` (${attribution})` : ''}: "${text}". Read this and log a specific next call/action.`;
}

// Despite the name (kept for now to avoid touching every call site —
// see suggestedFollowUp/the Possible Premature Closes check below),
// this NO LONGER pools sibling RM copies of the same customer. Only
// entries logged by THIS lead's own assigned RM ("the lead owner")
// count — a comment logged by someone else who'd also touched this
// lead's history (a different RM, a TL covering a call, a sibling copy
// under a different RM) isn't the current owner's own read on the
// customer, so it shouldn't drive what the owner is told to do next.
// Real production case: a lead assigned to one RM had a comment blob
// that also carried a note from a completely different person — using
// that note to generate the owner's Suggested Follow-up would have
// been telling them to act on someone else's read, not their own.
// Returns {outcome, comment, loggedBy, ts}, or null if this lead has no
// owner-logged structured action-log entry AND no last_comment. Shared
// by suggestedFollowUp below (tiers 1-2) and the Possible Premature
// Closes check in buildRegionWiseReports — both need "what did the
// assigned RM most recently say," just for different purposes.
// Priority order:
//   1. The structured action log (combinedCommentsText), filtered to
//      entries logged by this lead's own RM — the single MOST RECENT
//      entry that actually has text wins, found by actual timestamp
//      (falls back to the last one parsed if nothing carries a date). A
//      blank entry (a timestamp logged with no comment, e.g. "RM: -
//      2026-08-26 09:03") is skipped when picking "most recent" — real
//      production case: a genuinely informative note ("Not enquired")
//      from hours earlier was getting silently shadowed by a later
//      blank check-in that happened to have a newer timestamp, purely
//      because "latest" only compared timestamps and never looked at
//      whether the entry said anything. Only once NOT ONE owner-logged
//      entry has any text does this fall back to considering blank
//      owner-logged entries too — "no keyword match, here's the
//      (blank) latest note" is still more honest than silently
//      reverting to an earlier stage of the fallback chain once the
//      owner really did log multiple attempts, just without notes.
//   2. This lead's own last_comment — only once there's not a single
//      owner-attributed structured entry. If l.RM is blank
//      ("Unassigned"), there's no owner to filter by, so every entry is
//      kept rather than filtering down to nothing.
// Entries kept by the owner filter above: logged by this row's own RM,
// PLUS any entry with no parseable "Name:"/timestamp prefix at all
// (unattributed — there's no name on it to prove it belongs to someone
// ELSE, so it isn't discarded just for lacking structure). An entry
// logged under a matched, DIFFERENT name is still excluded. Mirrors
// OvernightEmailer.gs's latestOutcomeGs_ — keep in sync.
function latestFamilyOutcome(l){
  const ownerName = String(l.RM || '').trim().toLowerCase();
  const allEntries = parseActionLog(combinedCommentsText(l));
  const entries = ownerName ? allEntries.filter(e => {
    const logger = String(e.loggedBy || '').trim().toLowerCase();
    return !logger || logger === ownerName;
  }) : allEntries;
  if (entries.length) {
    const withText = entries.filter(e => e.comment);
    const candidates = withText.length ? withText : entries;
    let latest = candidates[candidates.length - 1];
    let newestMs = -Infinity;
    candidates.forEach(e => {
      if (!e.ts) return;
      const d = parseDate(e.ts);
      if (d && d.getTime() > newestMs) { newestMs = d.getTime(); latest = e; }
    });
    return { outcome: latest.outcome, comment: latest.comment, loggedBy: latest.loggedBy, ts: latest.ts };
  }

  const lastComment = String(l.last_comment || '').trim();
  if (lastComment) {
    return { outcome: inferOutcome(lastComment), comment: lastComment, loggedBy: l.RM, ts: null };
  }

  return null;
}

// Same family-pooling as latestFamilyOutcome above, but returns every
// structured entry instead of picking just the newest one — feeds the
// Lead_Followups export (pushLeadsToFollowups), where the point is the
// whole history, not a single best-guess line. A copy that contributed no
// structured action-log entry at all still gets one entry here from its
// last_comment (same fallback tier latestFamilyOutcome uses), so a copy
// that only ever got a plain comment isn't silently missing from the
// collated result. Sorted oldest-first — dated entries before undated
// ones, since undated entries have no real position to sort by.
// One copy's own comment entries — structured action-log entries if it has
// any, else a single fallback entry from last_comment (same fallback tier
// latestFamilyOutcome uses), so a copy that only ever got a plain comment
// isn't silently missing from the result. fallbackRM covers a log line that
// didn't parse a logger name (falls back to the copy's own RM, then the
// requesting row's RM). Factored out of collateFamilyComments below so a
// single copy's comments can be read on their own (see ownComments) without
// pulling in every sibling's too.
function commentsForCopy(copy, fallbackRM){
  const entries = [];
  const copyEntries = parseActionLog(combinedCommentsText(copy));
  if (copyEntries.length) {
    // e.loggedBy is who the log line itself says wrote THIS comment — not
    // necessarily copy.RM, the lead's CURRENT assignee, which can differ
    // after a reassignment. Prefer the actual logger; only fall back to
    // the current assignee when the log line didn't parse a name.
    copyEntries.forEach(e => entries.push({ RM: e.loggedBy || copy.RM || fallbackRM || 'Unassigned', comment: e.comment, timestamp: e.ts, outcome: e.outcome }));
    return entries;
  }
  const lastComment = String(copy.last_comment || '').trim();
  if (lastComment) {
    entries.push({ RM: copy.RM || fallbackRM || 'Unassigned', comment: lastComment, timestamp: null, outcome: inferOutcome(lastComment) });
  }
  return entries;
}

// Oldest-first — dated entries before undated ones, since undated entries
// have no real position to sort by. Shared by collateFamilyComments and
// ownComments below so the two lists always order the same way.
function sortCommentEntries(entries){
  return entries.sort((a, b) => {
    const da = a.timestamp ? parseDate(a.timestamp) : null;
    const db = b.timestamp ? parseDate(b.timestamp) : null;
    if (da && db) return da - db;
    if (da) return -1;
    if (db) return 1;
    return 0;
  });
}

// Lead_Followups export (pushLeadsToFollowups), where the point is the
// whole history, not a single best-guess line. A copy that contributed no
// structured action-log entry at all still gets one entry here from its
// last_comment.
function collateFamilyComments(row){
  const family = [row].concat(row.siblingComments || []);
  const entries = [];
  family.forEach(copy => entries.push(...commentsForCopy(copy, row.RM)));
  return sortCommentEntries(entries);
}

// Same idea as collateFamilyComments, but for THIS row's own copy only —
// no sibling RMs' comments mixed in. Lead_Followups' own_comments column
// uses this so a reader can tell, at a glance, what THIS specific RM
// actually logged on THIS specific copy, separate from collated_comments'
// whole-customer picture.
function ownComments(row){
  return sortCommentEntries(commentsForCopy(row, row.RM));
}

// Suggested follow-up for a lead — mandatory best-effort, scoped to THIS
// copy's own fields only. Deliberately does NOT pool sibling copies of
// the same customer (see latestFamilyOutcome's own comment for why) —
// a customer's real next step, as far as THIS RM's own card is
// concerned, should reflect what THIS RM's own record says, not what a
// different RM logged on their own separate copy. Priority order:
//   1. latestFamilyOutcome above (this lead's own structured action log
//      entries, owner-filtered, then its own last_comment) — but only
//      when that entry actually has text. An owner-logged entry that's
//      just a blank timestamp check-in (no text at all) is NOT treated
//      as a real comment here — falls through to tier 3 instead of
//      landing on the generic "no keyword match" line, which used to
//      read as if a real comment just didn't match a keyword when
//      really nothing was said.
//   2. This lead's own closing_reason — the only signal left when it
//      closed without anything else logged.
//   3. noCommentFollowUp below, once there's truly no usable comment or
//      closing reason anywhere on this lead's own copy.
function suggestedFollowUp(l){
  const latest = latestFamilyOutcome(l);
  if (latest && latest.comment) {
    return FOLLOWUP_SUGGESTIONS[latest.outcome] || unmatchedFollowUp(latest.comment, latest.loggedBy, latest.ts);
  }

  // lead_closing_reason/lead_closing_comment (the sheet's own closing
  // disposition) preferred over the RM-entered closing_reason when
  // present — the more authoritative "why did this close" signal.
  const reason = String(l.lead_closing_reason || l.closing_reason || '').trim();
  if (reason) {
    const detail = String(l.lead_closing_comment || '').trim();
    const full = detail ? `${reason} — ${detail}` : reason;
    return `Lead closed (${full}) — no further follow-up needed unless it's reopened.`;
  }

  return noCommentFollowUp(l);
}

// Dashboard counterpart to OvernightEmailer.gs's noCommentFollowUpGs_ —
// see that function's own comment for the full reasoning. Fired from
// suggestedFollowUp above when the lead's own assigned RM hasn't logged
// any usable comment (or closing reason) at all — instead of a flat
// "no comments logged yet" line regardless of how long this has been
// sitting untouched, reads call_attempts against the lead's last known
// Movement_Log snapshot (lastSnapshotBefore, tab-movement.js) to tell
// "genuinely stalled, nobody's dialing" from "actively being worked,
// just not narrated yet" — the two need different advice. Only draws
// that comparison once the baseline snapshot is itself at least 4 hours
// old; a snapshot from 20 minutes ago reading "unchanged" doesn't mean
// much on its own, the RM may simply not have re-attempted that
// recently yet. Replaces the old per-caller noCommentsFallback override
// (e.g. Overnight Leads' blanket "Connect ASAP") — this is strictly more
// specific than any fixed wording could be, so every caller now gets the
// same real signal instead of a guess.
function noCommentFollowUp(l){
  const key = String(l.client_id || '').trim() || 'l:' + String(l.lead_id).trim();
  const baseline = _lastSnapshotByKey.get(key);
  if (!baseline || (_renderNow.getTime() - baseline.atMs) < 4 * 3600000) {
    return 'No comment added — connect and log the outcome.';
  }
  const currentAttempts = Number(l.call_attempts) || 0;
  if (currentAttempts <= baseline.call_attempts) {
    return 'No comment added — no new call attempts in over 4 hours. Connect ASAP.';
  }
  const newAttempts = currentAttempts - baseline.call_attempts;
  return `No comment added — ${newAttempts} more call attempt${newAttempts === 1 ? '' : 's'} made since the last check. Keep trying to connect, and also send a WhatsApp message.`;
}

// Inner markup only — no wrapper div, so it can be injected into the
// pre-existing .action-log container on first toggle.
function actionLogTableMarkup(entries){
  if (!entries || !entries.length) return '';
  const rows = entries.map(e => {
    let dateStr = '', timeStr = '';
    if (e.ts) {
      const d = parseDate(e.ts);
      if (d) {
        // Same 12-hour IST convention as everywhere else in the dashboard.
        const p2 = n => String(n).padStart(2, '0');
        const dp = istParts(d);
        dateStr = `${dp.y}-${p2(dp.mo+1)}-${p2(dp.d)}`;
        let hh = dp.h;
        const ap = hh >= 12 ? 'PM' : 'AM';
        hh = hh % 12; if (hh === 0) hh = 12;
        timeStr = `${p2(hh)}:${p2(dp.mi)} ${ap}`;
      } else {
        dateStr = e.ts;
      }
    }
    return `<tr>
      <td>${esc(dateStr)}</td><td>${esc(timeStr)}</td>
      <td class="num">${e.attempt} of ${entries.length}</td>
      <td>${esc(e.outcome)}</td>
      <td>${esc(e.comment)}</td>
      <td>${esc(e.loggedBy)}</td>
    </tr>`;
  }).join('');
  return `<table class="mini-log-table">
      <thead><tr><th>Date</th><th>Time</th><th>Attempt</th><th>Outcome</th><th>CRM Comment</th><th>Logged By</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
}

// Single source of truth for every timestamp shown anywhere: 12-hour clock,
// labelled IST. Date stays YYYY-MM-DD so 07/08 can't be misread as 8 Jul.
// Sheet timestamps carry no timezone marker and are already IST, so the
// components are read back unchanged rather than converted — running them
// through a timezone shift would double-offset them.
function istStamp(v){
  const d = parseDate(v);
  if (!d) return String(v || '—');
  const p = istParts(d);
  const pad = n => String(n).padStart(2, '0');
  let h = p.h;
  const ampm = h >= 12 ? 'PM' : 'AM';
  h = h % 12;
  if (h === 0) h = 12;
  return `${p.y}-${pad(p.mo + 1)}-${pad(p.d)} ${pad(h)}:${pad(p.mi)} ${ampm} IST`;
}
// Kept as aliases so existing call sites all resolve to the same format.
const isoStampIST = istStamp;
const isoStamp = istStamp;

// Raw minute counts stop being readable fast — "1164 working min" is really
// about 2.4 working days, which nobody computes in their head. Scale the
// unit to the magnitude.
function fmtWorkingWait(mins, suffix){
  suffix = suffix || 'waiting';
  if (mins == null) return '';
  if (mins < 60) return `${Math.round(mins)} min ${suffix}`;
  const hrs = mins / 60;
  if (hrs < 10) return `${hrs.toFixed(1)} working hrs ${suffix}`;
  const workDays = hrs / (CONFIG.WORK_END_HOUR - CONFIG.WORK_START_HOUR);
  return `${hrs.toFixed(0)} working hrs (~${workDays.toFixed(1)} work days) ${suffix}`;
}

