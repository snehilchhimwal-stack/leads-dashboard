/**
 * Followup Engine — the comment-classification and Suggested Follow-up
 * text engine, a port of dashboard.html's own inferOutcome/OUTCOME_RULES/
 * FOLLOWUP_SUGGESTIONS (js/core-outcome-engine.js). Used by OvernightEmailer.gs's own
 * send path AND by AllIssuesEmailer.gs (both call overnightFollowupHintGs_
 * directly) — genuinely shared, not specific to either script, even
 * though several function names below still carry an "overnight" prefix
 * from before AllIssuesEmailer.gs existed.
 *
 * Split out of MovementTracker.gs/OvernightEmailer.gs (2026-08-28) as
 * part of a full compartmentalization pass — this file previously lived
 * split across a "movement tracking" script and an "overnight emailer"
 * script despite doing neither's actual job. Function/const names were
 * NOT renamed as part of this move (a rename is a separate, riskier
 * change requiring every call site to be found and updated) — only their
 * FILE changed. Moving code between .gs files in the SAME Apps Script
 * project has no functional effect (one shared namespace across every
 * file in a project).
 *
 * Real RM comments are short telecalling shorthand ("Ringing", "Switch
 * off. Wp msg sent.") at least as often as full sentences, and just as
 * often misspelled — every signal below is checked with typo tolerance (a
 * comment word within a small edit distance of a signal word counts as
 * that signal) so a spelling mistake attributes to its nearest real
 * keyword automatically. Kept traceable to js/core-outcome-engine.js: OUTCOME_RULES_GS_
 * and FOLLOWUP_SUGGESTIONS_GS_ below must stay in sync with that file's
 * OUTCOME_RULES/FOLLOWUP_SUGGESTIONS — mirror any change there here too.
 * See js/core-outcome-engine.js for the full rationale behind each rule's ordering,
 * signal choice, and typo-budget sizing.
 *
 * INTENDED differences from the dashboard's Suggested Follow-up (FE-5, 2026-10-13 - documented, not bugs; the outcome
 * rules themselves must stay identical):
 *   - the email appends FOLLOWUP_MODIFIERS_GS_ clauses (budget, preferred time/channel, decision-maker); the dashboard
 *     shows the primary suggestion only.
 *   - unmatchedFollowUpGs_ quotes the logger but not the timestamp, and its blank-comment line is shorter.
 *   - no closing_reason tier: emailed leads are open, so the dashboard's "Lead closed (...)" line never applies here.
 *   - latestOutcomeGs_'s last_comment fallback leaves loggedBy blank (the dashboard fills in the RM).
 *   - comment timestamps are read in the fixed "YYYY-MM-DD HH:MM" IST form only (the dashboard uses parseDate).
 *
 * Depends on Core.gs (getVal_, canonicalStage_, istDayKeyGs_) — load
 * order between files doesn't matter to Apps Script.
 *
 * ============================== SETUP ==============================
 * Paste this in as its own file, alongside every other file in this
 * project. See Core.gs's own setup note for the full file list.
 * ================================================================================
 */

// Extracts every dated entry's timestamp from the same
// "Name: Comment - YYYY-MM-DD HH:MM" pipe-separated log format
// dashboard.html's parseActionLog/combinedCommentsText parse. Only the
// timestamps are needed here (for followupOverdue's staleness check and
// underCalledToday's logged-today fallback in SlaEngine.gs) — not the
// outcome-keyword vocabulary those two exist for on the dashboard side,
// which nothing here needs.
function parseDatedCommentEntries_(internalComments, stageComments) {
  const combined = [internalComments, stageComments]
    .filter(function (t) { return String(t || '').trim(); })
    .join(' | ');
  if (!combined) return [];
  const dates = [];
  combined.split('|').forEach(function (entry) {
    // SE-3 (2026-10-13): the same entry regex as parseActionLog (JS) and latestOutcomeGs_ below - a "Name:" prefix is
    // required. Without it an unattributed dated line counted here but not on the dashboard, so the email and the
    // dashboard could disagree on No follow up in last 4 hours / Behind on Today's Calls.
    const m = entry.trim().match(/^(.*?):\s*(.*?)\s*-\s*(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2})\s*$/);
    if (!m) return;
    const d = new Date(m[3].replace(' ', 'T') + ':00+05:30');
    if (!isNaN(d.getTime())) dates.push(d);
  });
  return dates;
}

function latestCommentTimestamp_(internalComments, stageComments) {
  const dates = parseDatedCommentEntries_(internalComments, stageComments);
  if (!dates.length) return null;
  return dates.reduce(function (a, b) { return b > a ? b : a; });
}

function countTodayCommentEntries_(internalComments, stageComments, now) {
  const todayKey = istDayKeyGs_(now);
  return parseDatedCommentEntries_(internalComments, stageComments)
    .filter(function (d) { return istDayKeyGs_(d) === todayKey; }).length;
}

// ---------------------------------------------------------------------
// Keyword-based outcome inference.
// ---------------------------------------------------------------------
function _editDistanceGs_(a, b) {
  const m = a.length, n = b.length;
  if (!m) return n;
  if (!n) return m;
  let twoBack = null;
  let oneBack = new Array(n + 1);
  let cur = new Array(n + 1);
  for (let j = 0; j <= n; j++) oneBack[j] = j;
  for (let i = 1; i <= m; i++) {
    cur[0] = i;
    const ai = a[i - 1];
    for (let j = 1; j <= n; j++) {
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
function _typoBudgetGs_(targetLen) {
  if (targetLen <= 4) return 0;
  if (targetLen <= 8) return 1;
  return 2;
}
// Signal words that only ever match EXACTLY, with no typo budget (FE-1..3, 2026-10-13): each sits within its budget of a
// common, unrelated word - 'declining' of "deciding" (2 edits), 'broker' of "broken" (1), 'ringing' of "bringing" (1) - so
// "client still deciding" read as Call Declined, "voice broken" as CP/Broker and "bringing wife" as Ringing. The real typos
// worth keeping get literal entries in the rule instead ('rining', 'brokers'), the 'buzy'/'disconect' precedent.
// KEEP IN SYNC with js/core-outcome-engine.js _EXACT_ONLY_SIGNAL_WORDS.
const _EXACT_ONLY_SIGNAL_WORDS_GS_ = { declining: true, broker: true, ringing: true };
function _wordsMatchGs_(word, target) {
  if (word === target) return true;
  if (_EXACT_ONLY_SIGNAL_WORDS_GS_[target] === true) return false;
  const budget = _typoBudgetGs_(target.length);
  if (!budget || Math.abs(word.length - target.length) > budget) return false;
  return _editDistanceGs_(word, target) <= budget;
}
// ===== CRM CALL STATUS (query v3, 2026-11-20, user request after checking 3 leads against Metabase) =====
// Every status entry the RM logs carries the call status they picked (Ringing, Busy, Call Declined, ...); query v3 puts it
// in brackets before the note: "Name: [Busy] Talking to someone else - date", or "Name: [Ringing] - date" for a call logged
// with no note (24% of entries). The STATUS decides whether the call reached the customer - "Talking to someone else" under
// [Busy] is a customer on another call, not a conversation - and the note adds detail. An unknown bracket stays in the note.
// Data without brackets (query v2) reads exactly as before. KEEP IN SYNC with the twin.
const CALL_STATUS_KIND_GS_ = { 'ringing': 'noreach', 'busy': 'noreach', 'call declined': 'noreach', 'not reachable': 'noreach',
  'followup missed': 'noreach', 'invalid no': 'stop', 'call connected': 'conversation', 'connected on whatsapp': 'conversation' };
const CALL_STATUS_OUTCOME_GS_ = { 'ringing': 'Ringing / RNR', 'busy': 'Busy', 'call declined': 'Call Declined',
  'not reachable': 'Switched Off', 'followup missed': 'Follow-up Missed', 'invalid no': 'Wrong Number' };
function splitCallStatusGs_(comment) {
  const m = String(comment || '').match(/^\s*\[([^\]]{2,40})\]\s*(.*)$/);
  if (m && Object.prototype.hasOwnProperty.call(CALL_STATUS_KIND_GS_, m[1].trim().toLowerCase())) {
    return { status: m[1].trim(), key: m[1].trim().toLowerCase(), text: m[2].trim() };
  }
  return { status: '', key: '', text: String(comment || '').trim() };
}
// ===== SPELLING FIXES (2026-11-20, user request: "make a list of all wrong spelling so that you can identify even if
// there is a wrong spelling") =====
// The keyword matcher already forgives 1 typo in a 5-8 letter word and 2 in a longer one, but RMs' real misspellings go
// further ("wtsapp", "tommorow", "dissus", "ringning" - and 'ringing' is exact-only, see _EXACT_ONLY_SIGNAL_WORDS). This list
// was mined from every comment in the live sheet (leads + Movement_Log, 10,398 distinct comments) on 2026-11-20: each word
// within 2-3 edits / same consonant skeleton of a classifier keyword, then checked by hand - real words that only LOOK close
// (next/text, calls/call, pitched/picked, ready/already) were left out on purpose. Each comment is rewritten through this
// list, whole words only, BEFORE any rule or modifier reads it. To add one: append it here AND in the twin, then run
// python3 test/check-twin-behaviour.py (it feeds every entry through both copies).
// KEEP IN SYNC with js/core-outcome-engine.js SPELLING_FIXES.
const SPELLING_FIXES_GS_ = {
  watsup: 'whatsapp', wtsapp: 'whatsapp', wtsap: 'whatsapp', wattsapp: 'whatsapp', whtsap: 'whatsapp',
  whtatsaap: 'whatsapp', whtsp: 'whatsapp', whtsup: 'whatsapp', whstsap: 'whatsapp', wtsp: 'whatsapp',
  watsap: 'whatsapp', watsp: 'whatsapp', onwhatsapp: 'on whatsapp', ringning: 'ringing', ringgg: 'ringing',
  ringg: 'ringing', ringign: 'ringing', ringingn: 'ringing', ringinga: 'ringing', ringinb: 'ringing',
  ringinh: 'ringing', ringinv: 'ringing', ringin: 'ringing', runging: 'ringing', ringjng: 'ringing',
  ringinjg: 'ringing', ringig: 'ringing', rignign: 'ringing', riniging: 'ringing', bussy: 'busy', buay: 'busy',
  bsuy: 'busy', busyv: 'busy', nusy: 'busy', busyu: 'busy', busyt: 'busy', swkicth: 'switch', swcth: 'switch',
  calll: 'call', ccall: 'call', xall: 'call', ansswerv: 'answer', hanged: 'hung', msgg: 'message', mssg: 'message',
  masage: 'message', meesages: 'message', msged: 'texted', messeged: 'texted', messageed: 'texted', semt: 'sent',
  sebt: 'sent', deop: 'drop', dropm: 'drop', dpped: 'dropped', tommorow: 'tomorrow', tommarow: 'tomorrow',
  tomarow: 'tomorrow', tmrw: 'tomorrow', tmrow: 'tomorrow', evining: 'evening', dissus: 'discuss',
  deatils: 'details', detailes: 'details', deails: 'details', detals: 'details', indetail: 'in detail',
  broucher: 'brochure', brocher: 'brochure', brokeer: 'broker', brokerge: 'broker', projrcts: 'projects',
  enequeir: 'enquiry', laon: 'loan', ivaild: 'invalid', dicided: 'decided', cnfrm: 'confirm', bujet: 'budget',
  bget: 'budget', nmbr: 'number', nedd: 'need', newd: 'need', knpow: 'know', knkow: 'know', knoe: 'know',
  wabt: 'want', wiht: 'with', withi: 'with', abck: 'back', bacj: 'back', nack: 'back', prefered: 'prefer',
  wifes: 'wife', costumer: 'customer', plann: 'plan', alrdy: 'already', allredy: 'already', mistakely: 'mistake'
};
// Whole words only: each run of letters/digits is looked up as a unit, so "wtsapp" is fixed but "awtsapps" is not.
function fixSpellingGs_(lowerText) {
  return String(lowerText).replace(/[a-z0-9]+/g, function (w) {
    return Object.prototype.hasOwnProperty.call(SPELLING_FIXES_GS_, w) ? SPELLING_FIXES_GS_[w] : w;
  });
}
function _wordsOfGs_(text) {
  return String(text).toLowerCase().replace(/'/g, '').match(/[a-z0-9]+/g) || [];
}
const _signalWordsCacheGs_ = {};
function _signalWordsOfGs_(signal) {
  let w = _signalWordsCacheGs_[signal];
  if (!w) { w = signal.split(' '); _signalWordsCacheGs_[signal] = w; }
  return w;
}
function _signalMatchesGs_(commentWords, signal) {
  const target = _signalWordsOfGs_(signal);
  if (target.length === 1) return commentWords.some(function (w) { return _wordsMatchGs_(w, target[0]); });
  for (let i = 0; i + target.length <= commentWords.length; i++) {
    let ok = true;
    for (let j = 0; j < target.length; j++) {
      if (!_wordsMatchGs_(commentWords[i + j], target[j])) { ok = false; break; }
    }
    if (ok) return true;
  }
  return false;
}
function _anySignalGs_(commentWords, signals) {
  return signals.some(function (s) { return _signalMatchesGs_(commentWords, s); });
}
// "to let" as the property type ("flat is to let", "to-let board", "to let his flat") - but not the ordinary verb phrase
// "to let him/her/me/us/them/you know" or "to let know" (FE-3, 2026-10-13). KEEP IN SYNC with js/core-outcome-engine.js _hasToLetProperty.
const _TO_LET_NOT_PROPERTY_NEXT_GS_ = { him: true, her: true, me: true, us: true, them: true, you: true, know: true };
function _hasToLetPropertyGs_(commentWords) {
  for (let i = 0; i + 1 < commentWords.length; i++) {
    if (commentWords[i] !== 'to' || commentWords[i + 1] !== 'let') continue;
    if (_TO_LET_NOT_PROPERTY_NEXT_GS_[commentWords[i + 2]] !== true) return true;
  }
  return false;
}

// This array was audited against a real batch of ~400 rows pulled from
// Unmatched_Comments_Log on 2026-08-28 — every addition/new entry below
// (marked at its own site) traces back to a genuine, RECURRING pattern in
// that batch, not a one-off. Two real, recurring phrases from that same
// batch were deliberately left OUT rather than guessed at: "BPCL"
// (appeared 5+ times — "not giving BPCL", "bpcl not given" — meaning
// unconfirmed) and "already visited [some other project]" alone (visited
// OUR project vs a COMPETITOR's is genuinely ambiguous from the text
// alone, and guessing wrong here risks giving the OPPOSITE advice of
// what's actually true) — see UnmatchedCommentLogger.gs's own review
// workflow for how a pattern like this should get resolved.
const OUTCOME_RULES_GS_ = [
  { outcome: 'Do Not Disturb', signals: ['do not call', 'dont call', 'not to call', 'stop calling', 'dnd'] },
  { outcome: 'Switched Off', signals: [
      'switch off', 'switched off', 'sw off', 'swoff', 'not reachable', 'unreachable', 'not contactable',
      'out of coverage', 'out of service', 'out of network', 'call forwarded', 'call forwarding',
      'voice mail', 'voice message', 'voicemail',
      // 'no incoming'/'incoming not avail(able)' — a real, recurring
      // telecom-technical complaint (line can't receive calls), same
      // family as the other network/service signals above it.
      'no incoming', 'incoming not avail', 'incoming not available',
    ], test: function (c, w) {
      return (_anySignalGs_(w, ['incoming']) && _anySignalGs_(w, ['barred', 'not available']))
        || w.indexOf('unavailable') !== -1 || w.indexOf('ivr') !== -1;
    } },
  { outcome: 'Wrong Number', signals: [
      'wrong number', 'invalid number', 'invalid no', 'wn',
      // 'not exist'/'does not exist' — a distinct, recurring phrasing of
      // the same underlying meaning as "invalid number" above.
      'not exist', 'does not exist', 'number doesnt exist',
    // 2026-09-03: real, recurring reversed phrasing the plain multi-word
    // signals above miss entirely — "Number is invalid"/"No.is invalid"
    // (noun-then-verb-then-adjective, not "invalid number"'s
    // adjective-then-noun) and "doesnt exist" as its own contracted
    // 2-word form (the existing 'does not exist' signal needs 3
    // CONSECUTIVE words and can never match a 2-word contraction). 'no'
    // paired with 'invalid' is safe despite being a near-universal word
    // elsewhere — 'invalid' itself is rare/specific enough that the AND
    // pairing still only fires on genuine wrong-number comments.
    ], test: function (c, w) {
      return (_anySignalGs_(w, ['invalid']) && _anySignalGs_(w, ['number', 'no']))
        || (_anySignalGs_(w, ['exist']) && _anySignalGs_(w, ['doesnt', 'does', 'not', 'nahi']));
    } },
  // NEW outcome — real, recurring pattern: an RM flagging the LEAD ITSELF
  // as not genuine (fake/duplicate/accidental), not a real customer who
  // declined. Checked early, same tier as Wrong Number, since neither is
  // really about call OUTCOME at all — the lead isn't real to begin with.
  { outcome: 'Junk / Duplicate Lead', signals: [
      'fake enquiry', 'fake inquiry', 'duplicate lead', 'inquiry by mistake', 'enquiry by mistake',
      'casual inquiry', 'casual enquiry',
    ] },
  { outcome: 'Call Declined', signals: [
      'hung up', 'hangup', 'disconnecting', 'disconnect the call', 'disconnect call', 'declined', 'declining', 'decline',
      'cut the call', 'call cut',
      // 'call rejected'/'rejected the call' — a very common, distinct
      // phrasing of the same active-decline meaning; 'disconect' is an
      // explicit typo alias (edit distance from 'disconnected' exceeds
      // the fuzzy-match budget at that word length, so it needs a literal
      // entry — same reasoning as 'buzy' just below).
      'call rejected', 'rejected the call', 'disconect',
    ], test: function (c) { return /^disconnect\s*-?\s*$/.test(c); } },
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
  // NEW outcome, added 2026-09-03 — real, recurring pattern, audited
  // against a fresh ~2,500-comment Unmatched_Comments_Log export (after
  // fixing this same file's de-dup bug — see UnmatchedCommentLogger.gs):
  // by far the SINGLE LARGEST recurring bucket in that batch was a
  // customer already being worked by a DIFFERENT RM or channel partner —
  // "already in touch with RM X", "she already touch with someone",
  // "already discussed with other rtmi", "already spoke to someone
  // asking details directly". Distinct from Booked Elsewhere (no
  // purchase decision implied, just a duplicate/overlapping lead) and
  // from Needs Cross-Team Routing (that's the RM asking for a hand-off;
  // this is the CUSTOMER reporting they're already someone else's).
  // Checked at the same tier, since both mean "don't just retry the call
  // — this needs de-duplication/ownership resolved first".
  { outcome: 'Already With Another RM/CP', signals: [
      'already in touch', 'already touch', 'in touch with someone', 'already discussed with',
      'already spoke to', 'already talked with', 'in contact with', 'has conversation with',
      'to other rm', 'touch with another', 'contact with another',
    ] },
  // NEW outcome, added 2026-09-03 — same audit as above: the lead itself
  // is a channel partner/broker calling on a client's behalf, not the end
  // customer — a real, recurring, unambiguous pattern ("He is cp", "Its a
  // channel partners,", "Name is channel partner,,", "This is from tatva
  // real estate advisor,,"). Distinct from Junk/Duplicate Lead (a CP
  // enquiry is a genuine lead, just needing the CP handling process, not
  // a fake/accidental one) and from Already With Another RM/CP above
  // (this is about WHO the caller is, not who else is working the
  // customer). 'cp' as a bare 2-letter exact-match signal mirrors this
  // same file's existing precedent ('ni', 'wn', 'cb' above) — Homesfy-
  // internal telecalling shorthand this specific and this frequent is
  // safe at zero typo tolerance.
  { outcome: 'Channel Partner / Broker Lead', signals: [
      'channel partner', 'broker', 'brokers', 'cp', 'real estate advisor',
    ] },
  // NEW outcome — "BPCL" (Budget, Possession timeline, Configuration,
  // Location — Homesfy-internal shorthand, confirmed 2026-08-28) was left
  // out of the initial batch review since its meaning wasn't known yet;
  // real, recurring pattern (5+ occurrences: "not giving BPCL", "bpcl not
  // given", "not cleared BPCL"). Every observed real instance is negative
  // ("not sharing it"), so this requires BOTH 'bpcl' AND a nearby
  // negation word rather than assuming every mention is negative.
  { outcome: 'BPCL Not Shared', test: function (c, w) {
      if (!_anySignalGs_(w, ['bpcl'])) return false;
      return _anySignalGs_(w, ['not', 'nahi', 'didnt', 'doesnt', 'no']);
    } },
  // FE-3 (2026-10-13): 'to let' moved from `signals` into the test - as a plain phrase it matched "asked to let him know".
  { outcome: 'Resale / Rental (Out of Scope)', signals: ['resale', 'resell', 'second hand'],
    test: function (c, w) {
      if (_hasToLetPropertyGs_(w)) return true;
      if (!_anySignalGs_(w, ['rent', 'rental', 'renting'])) return false;
      if (_anySignalGs_(w, ['current', 'currently'])) return false;
      return _anySignalGs_(w, ['want', 'wants', 'need', 'needs', 'looking', 'require', 'requires', 'searching', 'search']);
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
  { outcome: 'Ringing / RNR', signals: ['ringing', 'rining'], test: function (c) { return /^ring\s*-?\s*$/.test(c); } },
  { outcome: 'Disconnected', signals: [
      'disconnected', 'call disc', 'disc', 'network issue', 'network problem', 'poor network',
      'call not connecting', 'call not connected', 'call not connect', 'not getting connected',
      'not connecting', 'not connected', 'call drop', 'blank call',
    ] },
  // NEW outcome, added 2026-09-03 — real, recurring pattern from the same
  // Unmatched_Comments_Log audit as Already With Another RM/CP above: the
  // call CONNECTED (unlike Disconnected/RNR above) but the audio itself
  // was unusable ("Voice not audible", "wasn't audible", "Voice prblm",
  // "Voice was cracking", "Not getting voice properly"). A genuinely
  // different problem from a dropped/never-connected call — the fix is
  // "retry or switch channel", not "the call failed to connect at all".
  // Bare 'audible'/'cracking' are included despite being single common
  // words because in this domain they are near-universally used to flag
  // exactly this problem (an RM has no reason to remark on audio quality
  // except to report it was bad) — same risk tolerance this file already
  // applies to other bare single-word signals like 'interested'/'busy'.
  { outcome: 'Voice Unclear', signals: [
      'voice not audible', 'not audible', 'audible', 'voice unclear', 'voice not clear', 'cracking',
      'voice problem', 'voice prblm', 'not getting voice', 'voice issue',
    ] },
  { outcome: 'Out of Station', signals: ['out of station', 'out station', 'out of town', 'not in town', 'travelling'] },
  { outcome: 'WhatsApp Unavailable', test: function (c, w) { return _anySignalGs_(w, ['whatsapp', 'wp', 'wa']) && _anySignalGs_(w, ['not on', 'not available']); } },
  { outcome: 'WhatsApp Sent', signals: ['dwm', 'textedon'],
    test: function (c, w) {
      return _anySignalGs_(w, ['whatsapp', 'whats app', 'whats up', 'wp', 'wa', 'msg', 'mesg', 'message', 'text']) &&
        _anySignalGs_(w, ['drop', 'dropped', 'shared', 'share', 'sent', 'pinged', 'texted']);
    } },
  { outcome: 'Details Shared', test: function (c, w) { return _anySignalGs_(w, ['shared', 'share', 'sent']) && _anySignalGs_(w, ['detail', 'brochure', 'project', 'info']); } },
  { outcome: 'Visit Completed', signals: [
      'visit done', 'visited site', 'site visited', 'visit completed', 'came for visit', 'visited the project',
    ] },
  { outcome: 'Visit Arranged', signals: [
      'site visit', 'visit scheduled', 'visit arranged', 'visit booked', 'visit fixed', 'visit confirmed',
      'will visit', 'coming for visit', 'visit planned',
    ] },
  { outcome: 'Loan In Process', signals: ['document submitted', 'bank process'],
    test: function (c, w) { return _anySignalGs_(w, ['loan']) && _anySignalGs_(w, ['process', 'sanction', 'approval']); } },
  { outcome: 'Not Interested', signals: [
      'not interested', 'no interest', 'no longer interested', 'not looking',
      'no requirement', 'not requirement', 'not enquired', 'dropped the plan', 'dropped the idea', 'ni',
    ] },
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
    ], test: function (c) {
      // "call me <time>"/"connect <time>"/Hindi "<time> baje call karo" —
      // the plain multi-word `signals` above only ever match CONSECUTIVE
      // words with nothing between them, so "call me tomorrow"/"call me
      // back" never matches "call tomorrow"/"call back" because of the
      // inserted "me" — this was, by a wide margin, the single biggest
      // recurring miss found in a real batch of Unmatched_Comments_Log
      // rows (dozens of comments shaped exactly like "SHE SAID CALL ME
      // 3.30 PM" / "asked me to connect tomorrow at 11 Am").
      if (/\bcall\s+me\b/.test(c)) return true;
      if (/\b(asked|told|said)\s+(me\s+)?to\s+connect\b/.test(c)) return true;
      if (/\bconnect\s+(on|at|after|tomorrow|back|evening|later)\b/.test(c)) return true;
      if (/\bcall\s*karo\b/.test(c)) return true; // Hindi/Hinglish "call karo" = "call [me]"
      return false;
    } },
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
    test: function (c, w) {
      // A `signals` phrase list alone missed the MORE common real shape:
      // "Looking 2bhk under 50 lac" (no "for"), not "Looking FOR 2bhk...".
      // Requires BOTH a seeking word AND an actual property-shape mention
      // (BHK count, budget unit, or property type) — same defensive
      // pairing as the Resale/Rental rule above — so a bare "looking"
      // elsewhere in an unrelated sentence can't misfire this; this rule
      // is deliberately LAST anyway, so everything more specific has
      // already had first refusal by the time it runs.
      if (!_anySignalGs_(w, ['looking', 'want', 'wants', 'searching', 'search'])) return false;
      // "2bhk"/"3bhk" (digit glued directly to "bhk", no space) is
      // extremely common and can NEVER match as a fuzzy word signal — a
      // leading digit makes the whole token "2bhk", not "bhk", and short
      // words like "bhk" get zero typo tolerance (see _typoBudgetGs_) —
      // checked directly against the raw comment text instead of the
      // tokenized word list for exactly that reason.
      if (/\d\s*bhk\b/i.test(c)) return true;
      // Deliberately no 'rent' here — "currently on rent, wants to buy"
      // is a real, tested case (their PRESENT situation, not what they
      // want) that would otherwise misfire; genuine rental-seeking is
      // already handled by the dedicated Resale/Rental rule above, which
      // has its own currently/current exclusion for exactly this reason.
      return _anySignalGs_(w, [
        'cr', 'crore', 'lac', 'lacs', 'lakh', 'lakhs', 'sqft', 'carpet',
        'plot', 'shop', 'commercial', 'office', 'flat', 'penthouse',
        'villa', 'rowhouse', 'property',
      ]);
    } },
];

// P-5 (2026-11-05): results are cached by comment text for the execution (the same text always gets the same outcome; the
// dashboard twin inferOutcome caches the same way). Many leads share identical comments ("RNR", "Busy", ...), and the fuzzy
// matching against every signal is the most CPU-heavy step of the snapshot run.
const INFER_OUTCOME_CACHE_GS_ = new Map();
function inferOutcomeGs_(comment) {
  const cacheKey = String(comment);
  const cached = INFER_OUTCOME_CACHE_GS_.get(cacheKey);
  if (cached !== undefined) return cached;
  const result = inferOutcomeUncachedGs_(comment);
  if (INFER_OUTCOME_CACHE_GS_.size > 50000) INFER_OUTCOME_CACHE_GS_.clear(); // a bound, far above one run's distinct comments
  INFER_OUTCOME_CACHE_GS_.set(cacheKey, result);
  return result;
}
function inferOutcomeUncachedGs_(comment) {
  const call = splitCallStatusGs_(comment);
  if (call.key && (!call.text || /^[\s\-_./]+$/.test(call.text))) return CALL_STATUS_OUTCOME_GS_[call.key] || 'No Real Update';
  const c = fixSpellingGs_(call.text.toLowerCase());
  if (/^[\s\-_./]+$/.test(c)) return 'No Real Update';
  const words = _wordsOfGs_(c);
  for (let i = 0; i < OUTCOME_RULES_GS_.length; i++) {
    const rule = OUTCOME_RULES_GS_[i];
    if ((rule.signals && _anySignalGs_(words, rule.signals)) || (rule.test && rule.test(c, words))) return rule.outcome;
  }
  return 'Update';
}

const FOLLOWUP_SUGGESTIONS_GS_ = {
  'Do Not Disturb': "Client indicated they don't want to be called — cross-call once to verify this is a genuine do-not-call request before logging it as DND and stopping outreach; once confirmed, re-engage only via an approved channel (SMS/email) if policy allows.",
  'Switched Off': 'Phone was switched off, out of service/network, or otherwise unreachable — retry later today; try an alternate number if one is on file.',
  'Wrong Number': 'Number appears incorrect — verify the contact number with the source/RM before calling again.',
  'Junk / Duplicate Lead': 'RM flagged this as not a genuine lead (fake/duplicate/accidental enquiry) — verify quickly, then close with the right reason instead of continuing normal follow-up.',
  'Call Declined': "Customer saw or heard the call and actively ended/declined it — they're avoiding contact right now, so calling straight back is more likely to annoy than connect. Try a different time of day, or switch to WhatsApp/SMS first.",
  'Busy': 'Line was busy — retry within a few hours.',
  'Booked Elsewhere': "Client says they've booked/purchased elsewhere — confirm this is genuinely final before closing; don't assume dead until it's verified.",
  'Needs Cross-Team Routing': "RM flagged this needs a cross-call/cross-pitch handoff to another project or team — confirm that hand-off actually happened rather than letting it sit untouched.",
  'Already With Another RM/CP': "Customer says they're already being worked by a different RM or channel partner — confirm who actually owns this customer and resolve the duplicate before continuing normal follow-up on both copies.",
  'Channel Partner / Broker Lead': "The lead itself is a channel partner/broker calling on a client's behalf, not the end customer — verify quickly and route through the CP process rather than treating this as a direct-customer follow-up.",
  'BPCL Not Shared': "Customer hasn't shared their BPCL (Budget, Possession timeline, Configuration, Location) — keep working to pin these down; without them it's hard to pitch a relevant option.",
  'Resale / Rental (Out of Scope)': "Client is looking for resale or rental, not a new first-sale (developer/builder) property — we don't work that segment. Close with this as the reason rather than treating it as lost interest.",
  'RNR': 'No response — retry at a different time of day; consider a WhatsApp follow-up.',
  'Ringing / RNR': 'Rang but no pickup — retry at a different time of day.',
  'Disconnected': "Call dropped, didn't connect, or connected with no response — retry; flag the number if this keeps happening.",
  'Voice Unclear': 'Call connected but audio was unclear or cracking — retry the call, or switch to a WhatsApp call/voice note if the network keeps degrading.',
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

// Fallback for when inferOutcomeGs_ finds no keyword match at all — a
// comment that's real information but doesn't contain any known outcome
// keyword. Quoting the real latest note beats a canned "read the
// comments" line, since the overnight email doesn't otherwise show
// comment text anywhere near the Suggested Follow-up column.
function unmatchedFollowUpGs_(comment, loggedBy) {
  const text = String(comment || '').trim();
  if (!text) return 'Manual review required — no keyword match found. Read the comments and log a specific next call/action.';
  const who = String(loggedBy || '').trim();
  return 'No keyword match — latest note' + (who ? ' (' + who + ')' : '') + ': "' + text + '". Read this and log a specific next call/action.';
}

// ===== FOLLOW-UP MODIFIERS =====
// A second, INDEPENDENT pass over the same comment text, run in addition
// to (not instead of) inferOutcomeGs_/FOLLOWUP_SUGGESTIONS_GS_ above. The
// primary outcome picks the FIRST matching category in priority order and
// stops there — real comments often carry a second, genuinely actionable
// signal that the primary category never gets a chance to surface (e.g. a
// comment that reads as "Call Declined" because of "cut the call" ALSO
// names a specific callback time, which the generic Call Declined text
// has no way to mention). Modifiers don't compete with each other or
// with the primary outcome — every one that fires gets appended, so a
// comment can carry a primary label plus several stacked clauses.
//
// Deliberately scoped to 4 self-contained modifiers for this first pass
// (budget, preferred time, preferred channel, decision-maker-elsewhere) —
// each is a pure keyword/pattern check with no external data dependency.
// Two more discussed but NOT built here (rejected-a-specific-project /
// interested-in-an-alternative-project) need a reliable project-name list
// to match against plus positive/negative sentiment disambiguation around
// the name — meaningfully higher false-positive risk, left for a
// follow-up once this simpler set has been seen against real data.
//
// Each entry: id (for future reference/logging), an optional `signals`
// list checked via the same _anySignalGs_ fuzzy matching every
// OUTCOME_RULES_GS_ entry uses, an optional `skipIf` (outcome name to
// suppress this modifier for — avoids a clause that just restates the
// primary suggestion), and `detect(c, words)` returning either null (no
// match) or the clause string to append — a function rather than a
// static string so a modifier can quote back the SPECIFIC phrase it
// found (e.g. the actual time mentioned), not just a generic template.
const FOLLOWUP_MODIFIERS_GS_ = [
  {
    id: 'budgetConcern',
    skipIf: 'Budget Concern', // primary suggestion already covers this — don't say it twice
    signals: ['budget', 'expensive', 'too high', 'high price', 'costly', 'costlier', 'cant afford', 'cannot afford', 'out of budget', 'beyond budget'],
    detect: function (c, words) {
      if (!_anySignalGs_(words, this.signals)) return null;
      return 'They also raised a budget concern — confirm their actual range and check whether a lower-ticket unit/project fits before writing them off.';
    },
  },
  {
    id: 'preferredTime',
    detect: function (c) {
      // Explicit time ("after 6pm", "before 10 am", "by 7pm") — quote the
      // exact phrase back, since "call them back at the right time" is
      // far more useful with the actual time attached.
      // FE-4 (2026-10-13): the hour must carry am/pm or minutes ("after 6pm", "around 5:30") - a bare number read "after 2
      // days" / "by 3 weeks" as a clock time. Minutes followed by a money unit ("around 1.25 cr") are a budget, not a time.
      const explicit = c.match(/\b(after|before|around|by)\s*\d{1,2}(?:\s*(?:am|pm|a\.m\.?|p\.m\.?)|[:.]\d{2}(?!\s*(?:cr|crore|crores|lac|lacs|lakh|lakhs|l|k)\b)(?:\s*(?:am|pm|a\.m\.?|p\.m\.?))?)(?![a-z0-9])/);
      if (explicit) {
        return 'They mentioned a specific time ("' + explicit[0].trim() + '") — target the callback for then, not a random slot.';
      }
      // Looser part-of-day mention with no exact hour — still worth a
      // callback-timing nudge, just without a phrase to quote. EXACT word
      // match only, not the fuzzy _anySignalGs_ every other signal check
      // in this file uses — found via this file's own test suite
      // (Tests_FollowupEngine.gs): "right now" was fuzzy-matching "night"
      // (edit distance 1, within the typo budget for a 5-letter word),
      // producing a false "preferred time of day: night" clause on a
      // comment that never mentioned a time at all. Ordinary short
      // English words like these collide with real typos far more easily
      // than the domain-specific multi-word signal phrases elsewhere in
      // this file, so this one check stays exact.
      const words = _wordsOfGs_(c);
      const partOfDay = ['evening', 'morning', 'afternoon', 'night'].find(function (w) { return words.indexOf(w) !== -1; });
      if (partOfDay) return 'They mentioned a preferred time of day (' + partOfDay + ') — target the callback for then, not a random slot.';
      return null;
    },
  },
  {
    id: 'preferredChannel',
    detect: function (c, words) {
      // Needs BOTH a channel word AND an explicit preference word — a bare
      // mention of "whatsapp" (e.g. from the existing WhatsApp
      // Sent/Unavailable outcomes) isn't the same as "only reach me on
      // WhatsApp, don't call".
      const hasPreferenceWord = _anySignalGs_(words, ['only', 'prefer', 'dont call', 'not call', 'reach on', 'contact on', 'message me']);
      if (!hasPreferenceWord) return null;
      if (_anySignalGs_(words, ['whatsapp', 'wp', 'wa'])) return 'They asked to be reached via WhatsApp instead of a call — switch channels for this follow-up.';
      if (_anySignalGs_(words, ['sms', 'text', 'message', 'msg'])) return 'They asked to be reached via text/SMS instead of a call — switch channels for this follow-up.';
      return null;
    },
  },
  {
    id: 'decisionMakerElsewhere',
    detect: function (c, words) {
      const hasFamilyWord = _anySignalGs_(words, ['husband', 'wife', 'spouse', 'partner', 'family']);
      const hasConsultWord = _anySignalGs_(words, ['decide', 'discuss', 'consult', 'ask', 'check with', 'talk to']);
      if (!hasFamilyWord || !hasConsultWord) return null;
      return 'Decision involves someone who wasn\'t part of this call — find out who, and when they\'ll be available together.';
    },
  },
];

// Runs every FOLLOWUP_MODIFIERS_GS_ entry against one comment and returns
// the clause strings for whichever ones fire (0 or more) — the caller
// (overnightFollowupHintGs_) appends these to the primary suggestion.
// `primaryOutcome` lets a modifier suppress itself when the primary
// suggestion already covers the same ground (see budgetConcern's skipIf).
function detectFollowupModifiersGs_(comment, primaryOutcome) {
  const c = fixSpellingGs_(splitCallStatusGs_(comment).text.toLowerCase());
  if (!c) return [];
  const words = _wordsOfGs_(c);
  const clauses = [];
  FOLLOWUP_MODIFIERS_GS_.forEach(function (mod) {
    if (mod.skipIf && mod.skipIf === primaryOutcome) return;
    const clause = mod.detect(c, words);
    if (clause) clauses.push(clause);
  });
  return clauses;
}

// Own-comment text only (internal_status_comments + stage_comments,
// pipe-joined) — NOT the dashboard's own richer collateFamilyComments
// (js/core-outcome-engine.js), which also folds in every sibling copy of the SAME
// customer across other regions/sources. That sibling collation depends on
// the dashboard's own in-browser identity-clustering over the WHOLE
// fetched dataset — state that only exists in a signed-in browser tab, not
// in an unattended server-side trigger. A human filling in Lead_Followups'
// suggested_followup column still sees this row's real comment history;
// they just don't get other copies' comments folded in automatically the
// way the dashboard's own Generate flow provides.
function combinedCommentsTextGs_(row, colIndex) {
  const internal = String(getVal_(row, colIndex, 'internal_status_comments') || '').trim();
  const stage = String(getVal_(row, colIndex, 'stage_comments') || '').trim();
  return [internal, stage].filter(function (s) { return s; }).join(' | ') || '(no comments logged)';
}

// Mirrors the dashboard's own overnightStatusLabel (js/tab-movement.js) —
// canonical funnel stage, Title Cased, or the raw stage text verbatim when
// it doesn't match a known funnel band, so nothing silently disappears.
// Never called for a closed lead — those are excluded before this runs.
function overnightStatusLabelGs_(stage) {
  const canon = canonicalStage_(stage);
  if (canon) return canon.replace(/\b\w/g, function (c) { return c.toUpperCase(); });
  return String(stage || '').trim() || 'Unrecognized Stage';
}

// Port of the dashboard's own suggestedFollowUp (js/core-outcome-engine.js) — see
// inferOutcomeGs_/OUTCOME_RULES_GS_/FOLLOWUP_SUGGESTIONS_GS_ above for the
// keyword engine this reads combinedCommentsTextGs_ through. Scoped to
// THIS row's own comments only — see latestOutcomeGs_'s own comment for
// why sibling RM copies of the same customer are deliberately NOT pooled
// in. Real production finding: last_connect (a status-text field — "Not
// Reachable"/"Ringing"/"Call Connected"/"Call Declined") and
// last_connect_time both get set on every logged ATTEMPT, not
// specifically a successful connection — so neither field alone can tell
// a real connection from a failed one, and the old hasConnected-only
// fallback below silently treated "Ringing"/"Not Reachable"/"Call
// Declined" leads as no different from "Keep working, no issue" once ANY
// attempt was logged. The keyword engine reads what the comment actually
// SAYS instead, so each of those gets its own specific, actionable
// suggestion (retry timing, alternate channel, etc.) rather than a
// generic line.
// Priority, same tiers as suggestedFollowUp:
//   1. The latest logged comment on this row's own copy, from this
//      row's own assigned RM (structured action-log entry, or
//      last_comment if no structured entry exists) — its inferred
//      outcome mapped through FOLLOWUP_SUGGESTIONS_GS_, or a quoted "no
//      keyword match" note when the comment has real content but
//      nothing recognizable. Any FOLLOWUP_MODIFIERS_GS_ that also fire on
//      the same comment (budget concern, a preferred callback time,
//      preferred contact channel, decision-maker not on the call) get
//      appended after the primary suggestion — see
//      detectFollowupModifiersGs_ above for why this is a second,
//      independent pass rather than more OUTCOME_RULES_GS_ entries: the
//      primary outcome only ever returns its FIRST matching category, so
//      a genuinely useful second signal in the same comment (e.g. "cut
//      the call... price too high") would otherwise never surface just
//      because a higher-priority rule already claimed the match.
//   2. Once there's truly no owner-logged comment text at all (no entry,
//      or the owner's only logged entry was a blank check-in with no
//      text) — see noCommentFollowUpGs_ below, which reads call_attempts
//      against the last known snapshot instead of guessing from
//      hasConnected/SLA flags. Modifiers don't apply here — there's no
//      comment text to scan.
// now/baselineEntry feed tier 2 only — see noCommentFollowUpGs_.
function overnightFollowupHintGs_(row, colIndex, now, baselineEntry) {
  // 2026-11-20 (user request): read EVERY comment on the lead first, not just the newest one - see historyFollowUpGs_.
  // Only when the lead has no dated, worded comment at all does this fall through to the single-comment path below.
  // 2026-11-20 (2nd pass): a lead with dated comments but none with words (blank check-ins, bare stage changes) used to fall
  // through to the single-comment reader below, which quoted the stage name "Suspect" as the RM's latest note. Now the
  // single-comment reader runs ONLY for old-format data with no dates at all (legacySingleCommentFollowUpGs_); otherwise
  // the answer is the no-comment advice. test/check-followup-single-path.py fails the build if this order ever changes.
  const fromHistory = historyFollowUpGs_(row, colIndex);
  if (fromHistory) return fromHistory;
  const legacy = legacySingleCommentFollowUpGs_(row, colIndex);
  if (legacy) return legacy;
  return noCommentFollowUpGs_(row, colIndex, now, baselineEntry);
}

// True when the lead's comment columns are in the dated "Name: text - YYYY-MM-DD HH:MM" format (Coefficient query v2).
// Then historyFollowUpGs_ has already read every comment, and finding nothing worded means there IS no comment.
function hasDatedCommentEntriesGs_(row, colIndex) {
  const dated = /\s-\s\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}\s*(\||$)/;
  return dated.test(String(getVal_(row, colIndex, 'internal_status_comments') || '')) ||
    dated.test(String(getVal_(row, colIndex, 'stage_comments') || ''));
}
// Only for undated, old-format data (e.g. after a rollback to query v1): there are no dates to order the comments by, so
// the newest-looking comment is all that can be read, and the text says so. Returns null for dated data.
function legacySingleCommentFollowUpGs_(row, colIndex) {
  if (hasDatedCommentEntriesGs_(row, colIndex)) return null;
  const latest = latestOutcomeGs_(row, colIndex);
  if (!latest || !latest.comment) return null;
  const base = FOLLOWUP_SUGGESTIONS_GS_[latest.outcome] || unmatchedFollowUpGs_(latest.comment, latest.loggedBy);
  const modifierClauses = detectFollowupModifiersGs_(latest.comment, latest.outcome);
  return (modifierClauses.length ? base + ' ' + modifierClauses.join(' ') : base) +
    ' History: comments are not dated, so only the last one could be read.';
}

// ===== FULL-HISTORY FOLLOW-UP (2026-11-20, user request: "read all the comments and then decide on next action") =====
// The single-comment path (latestOutcomeGs_) judged a lead on ONE note - the newest, or, when the comments could not be
// dated, the last one in the list. This reads the lead's WHOLE comment history - internal_status_comments plus any note
// typed on a stage change in stage_comments - from everyone who logged on this copy (who said it is shown when it was not
// the lead's own RM), classifies every comment, and decides from the pattern (rules agreed with Snehil 2026-11-20):
//   1. a STOP signal with no real conversation after it        -> that STOP's advice, quoting what was said and when
//   2. latest is NO-REACH but there WAS a conversation before  -> recap that conversation + the unanswered streak since
//   3. never a real conversation                                -> the try count; 6+ tries over 3+ days -> switch slot,
//                                                                  WhatsApp, close as Not Contactable after 2 more days
//   4. latest is a CONVERSATION                                 -> its advice + requirement/milestone/earlier STOP context
//   + preference clauses (time / channel / budget / decision-maker) from ANY comment, newest first, and a "History:" line.
// Stage changes themselves ("Name: Suspect - date") are events, not comments: only a note typed WITH the stage change
// ("Name: Suspect / note - date") is read. Returns null when there is no dated comment with text - the caller then uses
// the old single-comment / last_comment / no-comment path. KEEP IN SYNC with js/core-outcome-engine.js historyFollowUp.
const HISTORY_NOREACH_GS_ = { 'Switched Off': true, 'Call Declined': true, 'Busy': true, 'RNR': true, 'Ringing / RNR': true,
  'Disconnected': true, 'Voice Unclear': true, 'WhatsApp Sent': true, 'WhatsApp Unavailable': true, 'Follow-up Missed': true };
const HISTORY_STOP_GS_ = { 'Do Not Disturb': true, 'Wrong Number': true, 'Junk / Duplicate Lead': true, 'Booked Elsewhere': true,
  'Not Interested': true, 'Resale / Rental (Out of Scope)': true, 'Channel Partner / Broker Lead': true, 'Already With Another RM/CP': true };
// Higher = further down the funnel. Used to remind the RM of the best point the conversation ever reached.
const HISTORY_MILESTONE_RANK_GS_ = { 'Visit Completed': 6, 'Visit Arranged': 5, 'Loan In Process': 5, 'Interested': 4, 'Details Shared': 3,
  'Requirement Noted (No Status)': 3, 'Budget Concern': 2, 'Considering': 2 };
const HISTORY_MILESTONE_LABEL_GS_ = { 'Visit Completed': 'site visit done', 'Visit Arranged': 'visit arranged', 'Loan In Process': 'loan in process',
  'Interested': 'showed interest', 'Details Shared': 'details shared', 'Requirement Noted (No Status)': 'requirement noted',
  'Budget Concern': 'budget discussed', 'Considering': 'was considering' };
const HISTORY_MONTHS_GS_ = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const HISTORY_ENTRY_RE_GS_ = /^(.*?):\s*(.*?)\s*-\s*(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2})\s*$/;

// "2026-11-19 12:40" -> "19 Nov". Pure string work - no Date, so no timezone can shift the day.
function historyShortDateGs_(ts) {
  const m = String(ts || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? (Number(m[3]) + ' ' + HISTORY_MONTHS_GS_[Number(m[2]) - 1]) : '';
}
// Quote ~120 chars of a long comment centred on its requirement words (BHK / budget), so a long note does not
// get cut before the part that matters.
function historyQuoteRequirementGs_(text) {
  const t = String(text || '').replace(/\s+/g, ' ').trim();
  const m = t.match(/\d\s*bhk\b|\b\d+(\.\d+)?\s*(cr|crore|crores|lac|lacs|lakh|lakhs|l)\b/i);
  if (t.length <= 120 || !m) return historyQuoteGs_(t);
  const start = Math.max(0, Math.min(m.index - 50, t.length - 117));
  return (start > 0 ? '...' : '') + t.slice(start, start + 114).trim() + '...';
}
function historyQuoteGs_(text) {
  const t = String(text || '').replace(/\s+/g, ' ').trim();
  return t.length > 120 ? t.slice(0, 117) + '...' : t;
}
// Every dated entry with text, oldest first. Status comments as they are; stage entries only when a note was typed with
// the stage change ("Stage / note"), and then only the note.
function historyEntriesGs_(internalComments, stageComments) {
  const out = [];
  const take = function (blob, isStage) {
    String(blob || '').split('|').forEach(function (part, i) {
      const m = part.trim().match(HISTORY_ENTRY_RE_GS_);
      if (!m) return;
      let comment = m[2].trim();
      if (isStage) {
        const slash = comment.indexOf(' / ');
        if (slash === -1) return; // a bare stage change - an event, not a comment
        comment = comment.slice(slash + 3).trim();
        if (/^closing lead as \d+ users? closed this lead$/i.test(comment)) return; // CRM auto-note, nobody said it
      }
      const call = isStage ? { status: '', key: '', text: comment } : splitCallStatusGs_(comment);
      const note = /^[\s\-_./]+$/.test(call.text) ? '' : call.text;
      if (!note && !call.key) return; // a blank check-in with no call status says nothing
      out.push({ loggedBy: m[1].trim(), comment: note, status: call.status, statusKey: call.key,
        statusKind: call.key ? CALL_STATUS_KIND_GS_[call.key] : '', ts: m[3].trim(), order: (isStage ? 100000 : 0) + i });
    });
  };
  take(internalComments, false);
  take(stageComments, true);
  out.sort(function (a, b) { return a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : a.order - b.order; });
  out.forEach(function (e) { e.outcome = historyEntryOutcomeGs_(e); });
  return out;
}
// The outcome used for advice: the note's own outcome, except that a not-reached call status overrides a note that
// does not itself say not-reached or stop ("[Busy] Talking to someone else" -> Busy).
function historyEntryOutcomeGs_(e) {
  const fromNote = e.comment ? inferOutcomeGs_(e.comment) : '';
  const fromStatus = e.statusKey ? (CALL_STATUS_OUTCOME_GS_[e.statusKey] || '') : '';
  if (!fromNote) return fromStatus || 'No Real Update';
  if (e.statusKind === 'noreach' && fromStatus && !HISTORY_STOP_GS_[fromNote] && !HISTORY_NOREACH_GS_[fromNote]) return fromStatus;
  return fromNote;
}
function historyKindGs_(e) {
  if (HISTORY_STOP_GS_[e.outcome]) return 'stop';
  if (e.statusKind) return e.statusKind;
  if (HISTORY_NOREACH_GS_[e.outcome]) return 'noreach';
  return 'conversation';
}
// Pure: entries (oldest first, from historyEntriesGs_) + the lead's own RM -> the follow-up text, or null for no entries.
// 2026-11-20 (user request): a WhatsApp message already sent during the current unanswered streak - don't advise sending
// another. True for a 'WhatsApp Sent' note, or a note that mentions WhatsApp together with a sending word ("Not answering --
// have texted on WhatsApp"), but not a note saying the customer is not on WhatsApp. KEEP IN SYNC with the twin.
function historyWhatsAppSentGs_(e) {
  if (!e.comment || e.outcome === 'WhatsApp Unavailable') return false;
  if (e.outcome === 'WhatsApp Sent') return true;
  const t = fixSpellingGs_(String(e.comment).toLowerCase());
  return /\b(whatsapp|whats app|wp|wa)\b/.test(t) &&
    /\b(text|texted|sent|send|msg|msgd|message|messaged|drop|dropped|ping|pinged|shared)\b/.test(t);
}
// The not-reached advice for an outcome, minus any "send a WhatsApp" step when one already went out with no reply.
function historyNoReachAdviceGs_(outcome, whatsAppAlreadySent) {
  let advice = FOLLOWUP_SUGGESTIONS_GS_[outcome] || 'Retry at a different time of day.';
  if (!whatsAppAlreadySent) return advice;
  advice = advice.replace(/;\s*consider a WhatsApp follow-up\.?\s*$/i, '.');
  return /whatsapp/i.test(advice) ? 'Retry at a different time of day.' : advice;
}
// dials / connectedCalls (optional, 2026-11-20): the lead's call_attempts and call_count columns - every CRM click-to-call
// and phone dial, logged with a status or not. Used only while the customer has never been reached: the logged statuses
// alone undercount the tries (lead 2278821: 4 logged, 11 dialled).
// talkSeconds / createdAt (optional, 2026-11-20): the duration and lead_created_at columns - talk time decides whether
// connected calls are worth flagging (a 1-second connect is a pickup-and-drop), and the creation date is where the dial
// count's day span starts (dials carry no dates in the sheet).
// 2026-11-20: a date-ish value (Date, "2026-11-15 10:35:00", ISO, or "11/15/2026 ...") -> "2026-11-15" in IST, or ''.
function historyDayKeyGs_(v) {
  if (v && typeof v.getTime === 'function') {
    const ms = v.getTime();
    return isNaN(ms) ? '' : new Date(ms + 330 * 60000).toISOString().slice(0, 10);
  }
  const t = String(v || '');
  let m = t.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (m) return m[1] + '-' + m[2] + '-' + m[3];
  m = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  return m ? m[3] + '-' + ('0' + m[1]).slice(-2) + '-' + ('0' + m[2]).slice(-2) : '';
}
// Inclusive calendar days from one "YYYY-MM-DD" to another (0 if either is missing or they are out of order).
function historyDaysBetweenGs_(fromKey, toKey) {
  if (!fromKey || !toKey || fromKey > toKey) return 0;
  const utc = function (k) { return Date.UTC(Number(k.slice(0, 4)), Number(k.slice(5, 7)) - 1, Number(k.slice(8, 10))); };
  return Math.round((utc(toKey) - utc(fromKey)) / 864e5) + 1;
}
function historyTalkTimeGs_(seconds) {
  const s = Math.round(Number(seconds) || 0), m = Math.floor(s / 60), r = s % 60;
  return m ? m + ' min' + (r ? ' ' + r + ' s' : '') : r + ' s';
}
function historyDecideGs_(entries, ownerName, dials, connectedCalls, talkSeconds, createdAt) {
  if (!entries || !entries.length) return null;
  const owner = String(ownerName || '').trim().toLowerCase();
  const by = function (e) {
    const who = String(e.loggedBy || '').trim();
    return (who && who.toLowerCase() !== owner) ? ' (by ' + who + ')' : '';
  };
  const said = function (e) {
    return historyShortDateGs_(e.ts) + by(e) + (e.status ? ' [' + e.status + ']' : '') +
      (e.comment ? ': "' + historyQuoteGs_(e.comment) + '"' : ' (no note)');
  };
  let lastConv = -1, lastStop = -1, bestMilestone = -1, lastRequirement = -1;
  entries.forEach(function (e, i) {
    const kind = historyKindGs_(e);
    if (kind === 'conversation') lastConv = i;
    if (kind === 'stop') lastStop = i;
    const rank = HISTORY_MILESTONE_RANK_GS_[e.outcome] || 0;
    if (rank && (bestMilestone === -1 || rank >= (HISTORY_MILESTONE_RANK_GS_[entries[bestMilestone].outcome] || 0))) bestMilestone = i;
    if (/\d\s*bhk\b/i.test(e.comment) || /\b\d+(\.\d+)?\s*(cr|crore|crores|lac|lacs|lakh|lakhs|l)\b/i.test(e.comment)) lastRequirement = i;
  });
  const last = entries[entries.length - 1];
  const lastKind = historyKindGs_(last);
  const parts = [];

  if (lastStop > lastConv) {
    // Rule 1 - the newest meaningful thing the customer said was a STOP.
    parts.push((FOLLOWUP_SUGGESTIONS_GS_[entries[lastStop].outcome] || 'Customer gave a reason to stop') + ' Said ' + said(entries[lastStop]) + '.');
  } else if (lastKind === 'noreach') {
    const fromIdx = lastConv + 1;
    const tries = entries.slice(fromIdx).filter(function (e) { return historyKindGs_(e) === 'noreach'; });
    const days = {};
    tries.forEach(function (e) { days[e.ts.slice(0, 10)] = true; });
    const n = tries.length, d = Object.keys(days).length;
    const dialTotal = lastConv < 0 ? (Number(dials) || 0) : 0; // lifetime dials only mean something while never reached
    const useDials = dialTotal > n;
    const tryCount = useDials ? dialTotal : n;
    // With dials, the day span runs from the lead's creation (dials have no dates in the sheet; logged days undercount).
    const createdKey = useDials ? historyDayKeyGs_(createdAt) : '';
    const spanDays = createdKey ? historyDaysBetweenGs_(createdKey, last.ts.slice(0, 10)) : 0;
    const dayCount = Math.max(d, spanDays);
    const span = (useDials ? dialTotal + ' dial' + (dialTotal === 1 ? '' : 's') : n + ' unanswered attempt' + (n === 1 ? '' : 's')) +
      (spanDays ? ' since ' + historyShortDateGs_(createdKey) : (d > 1 ? ' over ' + d + ' days' : ''));
    const tally = {}, order = [];
    tries.forEach(function (e) { const k = e.status || e.outcome; if (!tally[k]) { tally[k] = 0; order.push(k); } tally[k]++; });
    const mix = (useDials ? n + ' logged: ' : '') + order.map(function (k) { return k + (tally[k] > 1 ? ' x' + tally[k] : ''); }).join(', ');
    // Connected calls with no conversation logged: flagged only with at least 10 s of talk time in total (or when the talk
    // time is unknown) - a 1-second connect is a pickup-and-drop or an IVR, not a conversation.
    const talk = Number(talkSeconds) || 0;
    const connectedNote = lastConv < 0 && (Number(connectedCalls) || 0) > 0 && !(talk > 0 && talk < 10) ? ' The call logs show ' +
      connectedCalls + ' connected call' + (Number(connectedCalls) === 1 ? '' : 's') +
      (talk ? ' (' + historyTalkTimeGs_(talk) + ' talk time)' : '') + ' - check with whoever made them whether a conversation happened, and log it. Do not close it as Not Contactable until then.' : '';
    const declined = tries.filter(function (e) { return e.statusKey === 'call declined' || e.outcome === 'Call Declined'; }).length;
    const waSent = tries.filter(function (e) { return historyWhatsAppSentGs_(e); });
    const waLast = waSent.length ? waSent[waSent.length - 1] : null;
    const waNote = waLast ? ' A WhatsApp message already went out on ' + historyShortDateGs_(waLast.ts) +
      ' with no reply since - do not send another; call at a different time, or try an SMS.' : '';
    const declinedNote = declined ? ' The customer declined the call ' + (declined === 1 ? 'once' : declined + ' times') +
      (waLast ? ' - call at a different time.' : ' - send a WhatsApp message before the next call, and call at a different time.') : '';
    if (lastConv >= 0) {
      // Rule 2 - they did talk before; the RM should pick up where that left off.
      parts.push('Last real conversation ' + said(entries[lastConv]) + '. Since then ' + span + ' (' + mix + ').' + declinedNote);
      parts.push(historyNoReachAdviceGs_(last.outcome, !!waLast) + waNote);
      if (bestMilestone >= 0 && bestMilestone !== lastConv) {
        parts.push('Earlier ' + HISTORY_MILESTONE_LABEL_GS_[entries[bestMilestone].outcome] + ' (' + said(entries[bestMilestone]) + ') - open the next call from there.');
      }
      if (lastRequirement >= 0 && lastRequirement !== lastConv && lastRequirement !== bestMilestone) {
        parts.push('Requirement on record ' + historyShortDateGs_(entries[lastRequirement].ts) + by(entries[lastRequirement]) + ': "' + historyQuoteRequirementGs_(entries[lastRequirement].comment) + '".');
      }
    } else if (tryCount >= 6 && dayCount >= 3 && !connectedNote) { // not while connected calls are unexplained
      // Rule 3 - never reached, and it has been going on.
      parts.push(span.charAt(0).toUpperCase() + span.slice(1) + ' and the customer has never been reached (' + mix + '). Switch to a different time slot' +
        (waLast ? ' (a WhatsApp message already went out on ' + historyShortDateGs_(waLast.ts) + ' with no reply)' : ' and send a WhatsApp message') +
        '; if there is still no answer after 2 more days, close it as Not Contactable.' + declinedNote + connectedNote);
    } else {
      parts.push('Not reached yet - ' + span + ' (' + mix + ').' + declinedNote + ' ' + historyNoReachAdviceGs_(last.outcome, !!waLast) + waNote + connectedNote);
    }
  } else {
    // Rule 4 - the newest meaningful comment is a real conversation.
    const conv = entries[lastConv];
    parts.push(FOLLOWUP_SUGGESTIONS_GS_[conv.outcome] || unmatchedFollowUpGs_(conv.comment, conv.loggedBy));
    if (bestMilestone >= 0 && bestMilestone !== lastConv &&
        (HISTORY_MILESTONE_RANK_GS_[entries[bestMilestone].outcome] || 0) > (HISTORY_MILESTONE_RANK_GS_[conv.outcome] || 0)) {
      parts.push('Earlier ' + HISTORY_MILESTONE_LABEL_GS_[entries[bestMilestone].outcome] + ' (' + said(entries[bestMilestone]) + ').');
    }
    if (lastRequirement >= 0 && lastRequirement !== lastConv && lastRequirement !== bestMilestone) {
      parts.push('Requirement on record ' + historyShortDateGs_(entries[lastRequirement].ts) + by(entries[lastRequirement]) + ': "' + historyQuoteRequirementGs_(entries[lastRequirement].comment) + '".');
    }
    if (lastStop >= 0) parts.push('Note: earlier said ' + said(entries[lastStop]) + ', but the conversation continued after that.');
  }

  // Preference clauses from ANY comment, newest first, each kind once (the same modifiers the single-comment path used).
  const seen = {};
  const primaryOutcome = lastStop > lastConv ? entries[lastStop].outcome : (lastConv >= 0 && lastKind !== 'noreach' ? entries[lastConv].outcome : last.outcome);
  for (let i = entries.length - 1; i >= 0; i--) {
    detectFollowupModifiersGs_(entries[i].comment, primaryOutcome).forEach(function (clause) {
      const key = clause.slice(0, 25);
      if (!seen[key]) { seen[key] = true; parts.push(clause); }
    });
  }

  const first = entries[0];
  parts.push('History: ' + entries.length + (entries.length === 1 ? ' call/comment' : ' calls/comments') +
    (first.ts.slice(0, 10) !== last.ts.slice(0, 10) ? ', ' + historyShortDateGs_(first.ts) + ' to ' + historyShortDateGs_(last.ts) : ', ' + historyShortDateGs_(last.ts)) +
    (lastConv >= 0 ? '; last real conversation ' + historyShortDateGs_(entries[lastConv].ts) : '; customer never reached yet') + '.');
  return parts.join(' ');
}
function historyFollowUpGs_(row, colIndex) {
  const entries = historyEntriesGs_(getVal_(row, colIndex, 'internal_status_comments'), getVal_(row, colIndex, 'stage_comments'));
  return historyDecideGs_(entries, getVal_(row, colIndex, 'RM'),
    Number(getVal_(row, colIndex, 'call_attempts')) || 0, Number(getVal_(row, colIndex, 'call_count')) || 0,
    Number(getVal_(row, colIndex, 'duration')) || 0, getVal_(row, colIndex, 'lead_created_at'));
}

// Fallback for when the lead's own assigned RM hasn't logged any usable
// comment at all — real production case: a lead's only owner-logged
// entry was a blank timestamp check-in ("RM: - 2026-08-25 19:08"), and
// the old wording ("no keyword match found") read as if a real comment
// just didn't match a keyword, when really nothing was said. Says so
// plainly instead, then reads call_attempts against the last known
// Movement_Log snapshot (lastSnapshotBeforeGs_, MovementTracker.gs) to
// tell "genuinely stalled, nobody's dialing" from "actively being
// worked, just not narrated yet" — the two need different advice. Only
// draws that comparison once the baseline snapshot is itself at least 4
// hours old; a snapshot from 20 minutes ago reading "unchanged" doesn't
// mean much on its own, the RM may simply not have re-attempted that
// recently yet.
function noCommentFollowUpGs_(row, colIndex, now, baselineEntry) {
  if (!baselineEntry || (now.getTime() - baselineEntry.atMs) < 4 * 3600000) {
    return 'No comment added — connect and log the outcome.';
  }
  const currentAttempts = Number(getVal_(row, colIndex, 'call_attempts')) || 0;
  if (currentAttempts <= baselineEntry.call_attempts) {
    return 'No comment added — no new call attempts in over 4 hours. Connect ASAP.';
  }
  const newAttempts = currentAttempts - baselineEntry.call_attempts;
  return 'No comment added — ' + newAttempts + ' more call attempt' + (newAttempts === 1 ? '' : 's') +
    ' made since the last check. Keep trying to connect, and also send a WhatsApp message.';
}

// Single-copy, owner-filtered port of js/core-outcome-engine.js's latestFamilyOutcome —
// see that function's own comment for the real production case this
// filtering fixes. Sibling RM copies of the same customer are NOT pooled
// in, and neither is any comment entry logged by someone other than
// THIS row's own assigned RM ("the lead owner") — a note left by a
// different person who'd also touched this row's comment history isn't
// the current owner's own read on the customer, so it shouldn't drive
// what the owner is told to do next.
// Splits combinedCommentsTextGs_'s "Name: Comment - timestamp | ..."
// blob into entries, keeps the ones logged by this row's own RM PLUS any
// entry with no parseable "Name:"/timestamp prefix at all (unattributed —
// there's no name on it to prove it belongs to someone ELSE, so it isn't
// discarded just for lacking structure; a comment logged by anyone else
// under a matched, DIFFERENT name is still excluded) — (all entries, if RM
// is blank — no owner to filter by), and returns whichever remaining entry
// has the most recent real timestamp AND actual text (falling back to
// considering blank owner-logged entries
// only once NOT ONE has any text; falling back to the last entry parsed
// if none carry a timestamp) as {outcome, comment, loggedBy, ts}. Falls
// back to this row's own last_comment field only once there's not a
// single owner-attributed structured entry. Returns null when this row
// has neither — the caller's cue to fall back to the flags-based hint.
function latestOutcomeGs_(row, colIndex) {
  const ownerName = String(getVal_(row, colIndex, 'RM') || '').trim().toLowerCase();
  const combined = combinedCommentsTextGs_(row, colIndex);
  const text = combined === '(no comments logged)' ? '' : combined;
  const allEntries = [];
  if (text) {
    text.split('|').map(function (s) { return s.trim(); }).filter(Boolean).forEach(function (entry) {
      const m = entry.match(/^(.*?):\s*(.*?)\s*-\s*(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2})\s*$/);
      let loggedBy = '', comment = entry, ts = null;
      if (m) { loggedBy = m[1].trim(); comment = m[2].trim(); ts = m[3].trim(); }
      allEntries.push({ loggedBy: loggedBy, comment: comment, ts: ts }); // outcome: only for the entry returned (P-5, below)
    });
  }
  const entries = ownerName ? allEntries.filter(function (e) {
    const logger = String(e.loggedBy || '').trim().toLowerCase();
    return !logger || logger === ownerName;
  }) : allEntries;
  if (entries.length) {
    // Prefer the most recent entry that actually SAYS something — a
    // blank entry (a timestamp logged with no comment) is skipped when
    // picking "most recent". Real production case: "Mamtaben Sosa: Not
    // enquired - 2026-08-25 16:44" (a clean, classifiable signal) was
    // getting silently shadowed by a later blank "Mamtaben Sosa: -
    // 2026-08-26 09:03" check-in, purely because it had a newer
    // timestamp — nothing ever looked at whether the entry said
    // anything. Only once NOT ONE owner-logged entry has any text does
    // this fall back to considering blank entries too — "no keyword
    // match, here's the (blank) latest note" is still more honest than
    // silently reverting to an earlier fallback tier (e.g. "no contact
    // made yet") once the owner really did log multiple attempts, just
    // without notes. Mirrors js/core-outcome-engine.js's latestFamilyOutcome — keep in
    // sync.
    const withText = entries.filter(function (e) { return e.comment; });
    const candidates = withText.length ? withText : entries;
    let latest = candidates[candidates.length - 1];
    let newestMs = -Infinity;
    candidates.forEach(function (e) {
      if (!e.ts) return;
      const d = new Date(e.ts.replace(' ', 'T') + ':00+05:30');
      if (!isNaN(d.getTime()) && d.getTime() > newestMs) { newestMs = d.getTime(); latest = e; }
    });
    // P-5 (2026-11-05): only the returned entry's outcome is ever read, so only it is classified. This used to classify every
    // comment in the lead's whole history, on ~8,000 open leads per snapshot run (the Comment_History log / unmatched scan spikes).
    latest.outcome = inferOutcomeGs_(latest.comment);
    return latest;
  }
  const lastComment = String(getVal_(row, colIndex, 'last_comment') || '').trim();
  if (lastComment) return { outcome: inferOutcomeGs_(lastComment), comment: lastComment, loggedBy: '', ts: null };
  return null;
}
