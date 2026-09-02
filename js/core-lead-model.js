// ============================================================
// core-lead-model.js — the lead-shape domain logic: businessMinutesBetween,
// parseDate, the funnel-stage classifiers (canonicalStage/isOppOrAbove/
// isClosedStage/isLeadClosed/isBookingLead/isSoftBookingLead), and
// enrichLead itself — the single source of truth for a lead's derived
// state (SLA flags, stage, funnel position; see HANDOVER.md). Split out
// of core.js (Phase 2). Pure code motion — no logic changed.
// ============================================================

// Counts only the minutes that fall inside the working-hours window
// (WORK_START_HOUR–WORK_END_HOUR), walking day by day so overnight and
// multi-day gaps are handled correctly. A lead assigned at 6:58 PM has
// accrued 2 working minutes by 7:00 PM, then resumes at 9:00 AM.
function businessMinutesBetween(start, end){
  if (!start || !end || end <= start) return 0;
  const startH = CONFIG.WORK_START_HOUR;
  const endH = CONFIG.WORK_END_HOUR;
  let totalMs = 0;
  let cursor = new Date(start);

  // Day boundaries are IST ones. Using setHours() here read the browser's
  // zone, so "9 AM" meant 9 AM wherever the viewer happened to be.
  while (cursor < end) {
    const p = istParts(cursor);
    const dayOpen = istWallToInstant(p.y, p.mo, p.d, startH, 0, 0);
    const dayClose = istWallToInstant(p.y, p.mo, p.d, endH, 0, 0);

    const segStart = cursor > dayOpen ? cursor : dayOpen;
    const segEnd = end < dayClose ? end : dayClose;
    if (segEnd > segStart) totalMs += (segEnd - segStart);

    cursor = istWallToInstant(p.y, p.mo, p.d + 1, 0, 0, 0);
  }
  return totalMs / 60000;
}

// Memoized by the exact string parsed — same rationale/pattern as
// inferOutcome's own cache further down: the SAME date string (e.g. one
// lead's lead_assigned_at) gets parsed repeatedly across dozens of call
// sites in this codebase (enrichLead, passesFilters, snapshotSlaHistory,
// every tab's own history-walking functions — parseDate has ~60 call
// sites total) within a single render pass, and the regex-based parse
// below is real work per call. Date-object inputs are NOT cached — that
// path is already O(1) with no regex, so caching it would add lookup
// overhead for no benefit. Safe to share the returned Date object across
// every caller: confirmed nothing in this codebase ever mutates a
// parseDate() result in place (the one Date .setDate() call in this file,
// defaultDateRangeValue, operates on a fresh `new Date(now)` clone, never
// on a parsed value) — a mutated shared object would otherwise corrupt
// every other caller holding the same cached reference.
const _parseDateCache = new Map();
function parseDate(v){
  if (!v) return null;
  if (v instanceof Date) return isNaN(v.getTime()) ? null : v;
  const s = String(v).trim();
  if (!s) return null;
  const cached = _parseDateCache.get(s);
  if (cached !== undefined) return cached;

  // "2026-08-13 10:18:05" / "2026-08-13T10:18" carry no timezone. That is the
  // sheet's and the comment log's own format, and it is IST — handing it to
  // `new Date()` would resolve it in the browser's zone instead.
  const dt = s.match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?$/);
  let result;
  if (dt) {
    result = istWallToInstant(+dt[1], +dt[2] - 1, +dt[3], +dt[4], +dt[5], +(dt[6] || 0));
  } else {
    const d0 = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (d0) {
      result = istWallToInstant(+d0[1], +d0[2] - 1, +d0[3], 0, 0, 0);
    } else {
      // Anything with an explicit zone (trailing Z, +05:30) is already
      // absolute — this is the path our own toISOString() round-trip
      // takes, so it must NOT be shifted again.
      const d = new Date(s);
      result = isNaN(d.getTime()) ? null : d;
    }
  }
  _parseDateCache.set(s, result);
  return result;
}

function canonicalStage(stage){
  const s = String(stage).trim().toLowerCase();
  if (!s) return null;
  for (const canon of CONFIG.FUNNEL_ORDER) {
    const aliases = CONFIG.STAGE_ALIASES[canon] || [canon];
    if (aliases.some(a => s === a || s.indexOf(a) !== -1)) return canon;
  }
  return null;
}

function isOppOrAbove(stage){
  const canon = canonicalStage(stage);
  if (!canon) return false;
  const idx = CONFIG.FUNNEL_ORDER.indexOf(canon);
  const oppIdx = CONFIG.FUNNEL_ORDER.indexOf(CONFIG.OPPORTUNITY_STAGE);
  return idx >= oppIdx;
}

// A booking is a booking whether or not the record was subsequently closed —
// closing a won deal shouldn't erase it from the conversion numbers. This is
// deliberately NOT gated on isOpenLead/excluded anywhere it's used.
// It also reads closing_reason, because a CRM that overwrites current_stage
// with the closure word ("Won") otherwise loses the booking entirely:
// canonicalStage("Won") is null, so such a lead would count in no stage at
// all — not even Opportunity+.
function isBookingLead(l){
  if (canonicalStage(l.current_stage) === 'booking') return true;
  const reason = String(l.lead_closing_reason || l.closing_reason || '').trim().toLowerCase();
  if (!reason) return false;
  // Exact band equality, so neither "visit booked" nor "soft booking" — both
  // of which contain booking words — can leak into the confirmed count.
  return canonicalStage(reason) === 'booking';
}

// Payment received, paperwork pending. Counted separately from a confirmed
// booking: it is real commercial progress, but it is not revenue booked.
function isSoftBookingLead(l){
  if (canonicalStage(l.current_stage) === 'soft booking') return true;
  const reason = String(l.lead_closing_reason || l.closing_reason || '').trim().toLowerCase();
  if (!reason) return false;
  return canonicalStage(reason) === 'soft booking';
}

function isClosedStage(stage){
  const s = String(stage).trim().toLowerCase();
  if (!s) return false;

  // Split the stage text into words, treating an apostrophe as part of the
  // word so "won't" stays one token and never matches the word "won".
  // (A plain \b regex does NOT do this — \b treats the apostrophe as a
  // boundary, so /\bwon\b/ happily matches inside "won't".)
  const words = s.split(/[^a-z']+/).filter(Boolean);

  // Exact match: single-word keywords must BE one of the words; multi-word
  // phrases are matched against the full string.
  const exactHit = CONFIG.CLOSED_STAGE_EXACT.some(kw =>
    kw.indexOf(' ') !== -1 ? s.includes(kw) : words.includes(kw)
  );
  if (exactHit) return true;

  // Stem match — the keyword is a prefix of a whole word, so "cancel"
  // still catches "Cancelled"/"Cancellation" without matching mid-word.
  return CONFIG.CLOSED_STAGE_STEMS.some(stem => words.some(w => w.startsWith(stem)));
}

// Single source of truth for "is this lead closed" — stage text OR a
// filled closing_reason (RM-entered) OR lead_closing_reason (the sheet's
// own closing disposition). Previously hand-duplicated verbatim across
// funnelRankOf, enrichLead, overnightStatusLabel, and
// buildOvernightRegionReports, each site's own comment separately swearing
// it "matches enrichLead's own definition exactly" — a future change to
// what counts as closed had to be hunted down and edited in every one of
// those, and missing one would silently desync it from the others. Mirror
// any change here into MovementTracker.gs's isOpenLead_ too (see its
// comment) — that runtime can't share this function directly.
function isLeadClosed(l){
  return isClosedStage(l.current_stage) || !!String(l.closing_reason || '').trim() || !!String(l.lead_closing_reason || '').trim();
}

// All leads in a single render should be evaluated against ONE timestamp.
// Calling new Date() per lead let "now" drift across the loop, so a lead
// near the end of a long list was measured against a slightly later clock
// than one at the start — enough to flip a borderline 10-minute or 48-hour
// check inconsistently within the same view. Set once per render pass.
let _renderNow = new Date();

// customer-key -> call_attempts as of the most recent Movement_Log
// snapshot captured before today (IST) started — the baseline
// attemptsToday subtracts from a lead's current call_attempts to get a
// REAL count of today's calls, instead of guessing from CRM comments.
// Rebuilt once per applyFiltersAndRender() pass (see buildTodayCallBaseline
// there); enrichLead only ever reads it, never rebuilds it, so enriching
// many leads/copySplits in one pass stays cheap.
let _todayCallBaselineByKey = new Map();
// Same idea, but for noCommentFollowUp below (see lastSnapshotBefore,
// tab-movement.js) — rebuilt alongside _todayCallBaselineByKey so a
// customer's no-comment fallback text doesn't re-scan the whole
// Movement_Log dataset on every single lead card.
let _lastSnapshotByKey = new Map();
// True only while enrichLeadAsOf is enriching a PAST Movement_Log snapshot
// (RM stall leaderboard, time-to-remediate) — attemptsToday falls back to
// the CRM-comment proxy in that case; see enrichLeadAsOf for why.
let _enrichingHistorical = false;

function enrichLead(l){
  const now = _renderNow;
  const created = parseDate(l.lead_assigned_at);

  // Foundation: is this lead closed? Everything below only ever applies to
  // leads where this is false. No alert/SLA check in this file should ever
  // fire for a closed lead — this is computed first and gates every other
  // flag directly, not as an afterthought filter layered on top.
  // A lead is closed if its stage says so, or if EITHER closing_reason
  // (RM-entered) or lead_closing_reason (the sheet's own closing
  // disposition) is filled. This matters because the CRM can leave
  // current_stage sitting at "Not Updated" on a lead that was actually
  // resolved — without this, those get flagged as issues forever despite
  // being finished. A lead closed via lead_closing_reason alone (the newer
  // field, with the older closing_reason left blank) needs the same
  // treatment, or it would read as still open and get flagged for every
  // SLA issue in the dashboard despite genuinely being done.
  const hasClosingReason = !!String(l.closing_reason || '').trim() || !!String(l.lead_closing_reason || '').trim();
  const excluded = isLeadClosed(l);
  const oppOrAbove = isOppOrAbove(l.current_stage);
  const isOpenLead = !excluded && !oppOrAbove; // "open" = not closed, not already at Opportunity+

  const ageHours = created ? (now - created) / 36e5 : null;
  const past48h = isOpenLead && ageHours !== null && ageHours > CONFIG.LEAD_LIFECYCLE_HOURS;

  // Every check below EXCEPT the two explicitly-48h+ ones is scoped to
  // leads still inside the 48-hour lifecycle. Past that point the 48h+
  // cards take over as the relevant signal, so older leads shouldn't also
  // be cluttering the fresh-lead checks.
  const isUnder48h = ageHours !== null && ageHours <= CONFIG.LEAD_LIFECYCLE_HOURS;

  // New Today: assigned today AND in the system at least 3 hours, so a lead
  // that just arrived isn't immediately flagged for not having 5 calls yet.
  const isCreatedToday = istSameDay(created, now);   // IST calendar day, not the browser's
  // Grace period from lead assignment. Applies to every check below EXCEPT
  // the 10-minute first-contact rule (firstContactBreach and its
  // neverConnectedPastWindow counterpart below) — that rule is precisely
  // the one that must fire inside this window, since it exists to catch
  // leads nobody has touched at all.
  const pastGrace = ageHours !== null && ageHours >= CONFIG.LEAD_GRACE_HOURS;

  // Connection signal, hoisted up from Rule 4 below — Rule 1 needs it too
  // now: "connected" (last_connect / last_connect_time) is a stronger
  // signal than call_attempts, which only proves a dial was placed, not
  // that the customer actually picked up.
  // connectDate computed once and reused for hasConnected below — this
  // used to call parseDate(l.last_connect_time) twice per lead, every
  // render (perf pass, 2026-08-28).
  const connectDate = parseDate(l.last_connect_time);
  const hasConnected = !!(String(l.last_connect || '').trim() || connectDate);

  // Rule 1: first contact within 10 minutes of assignment — measured in
  // WORKING minutes only, so time outside 9 AM–7 PM doesn't count against
  // the RM. Two distinct outcomes, deliberately kept apart:
  //   - Connected, but only after the 10-minute window had already
  //     passed: flagged HERE as a retrospective SLA miss — contact did
  //     happen, just late.
  //   - Never connected at all, window passed: NOT flagged here anymore —
  //     folded into Not Updated below instead, since "still nothing has
  //     happened" is a different (and more accurate) story than "we were
  //     late." See neverConnectedPastWindow below.
  let firstContactStatus = 'N/A';
  let businessMinsToConnect = null;
  if (created && connectDate) {
    businessMinsToConnect = businessMinutesBetween(created, connectDate);
    firstContactStatus = businessMinsToConnect > CONFIG.FIRST_CONTACT_SLA_MINUTES ? 'BREACHED' : 'OK';
  }
  const firstContactBreach = isOpenLead && isUnder48h && firstContactStatus === 'BREACHED';

  // The "otherwise" half of Rule 1 — still no VERIFIABLE connection once
  // the 10-minute window has passed. Deliberately exempt from the 3-hour
  // grace (like the old firstContactBreach was), so a silent lead doesn't
  // sit unflagged anywhere in the 10-min–3h gap between this check and Not
  // Updated's own grace period. Gated on !connectDate rather than
  // !hasConnected: last_connect can hold non-empty text with
  // last_connect_time blank/unparseable, which made hasConnected true
  // with no way to ever compute businessMinsToConnect — that ambiguous
  // case fell through both this AND firstContactBreach silently. connectDate
  // specifically means "we have a timestamp we can act on."
  const neverConnectedPastWindow = isOpenLead && isUnder48h && !connectDate &&
    !!created && businessMinutesBetween(created, now) > CONFIG.FIRST_CONTACT_SLA_MINUTES;

  // Detect leads touched by more than one agent over time. The sheet's RM
  // column only shows the current assignee, but internal_status_comments
  // often logs a history of different names — a real signal of
  // reassignment or multiple agents handling the same lead.
  // Multi-agent detection. Collation now tells us this directly — a record
  // built from several RM copies WAS held by several people. Fall back to
  // distinct names in the comment log for records that weren't collated,
  // which still catches reassignment within a single copy.
  const actionLogEntries = parseActionLog(combinedCommentsText(l));
  const distinctAgents = new Set(
    actionLogEntries.map(e => e.loggedBy.trim().toLowerCase()).filter(Boolean)
  );
  const collatedCount = Number(l.collatedFrom) || 1;
  const agentCount = Math.max(collatedCount, distinctAgents.size);
  const isMultiAgent = agentCount > 1;

  // Newest comment timestamp, taken by actual TIMESTAMP rather than array
  // position. The log is usually appended chronologically, but nothing
  // guarantees it — one out-of-order entry would make a stale lead look
  // freshly touched and silently break the Rule 4 follow-up check.
  let hoursSinceLastComment = null;
  let lastCommentAt = null;   // raw timestamp, so the UI can print it
  if (actionLogEntries.length) {
    let newestMs = null;
    for (const e of actionLogEntries) {
      if (!e.ts) continue;
      const d = parseDate(e.ts);
      if (d && (newestMs === null || d.getTime() > newestMs)) newestMs = d.getTime();
    }
    if (newestMs !== null) {
      hoursSinceLastComment = (now - newestMs) / 36e5;
      lastCommentAt = new Date(newestMs);
    }
  }

  // Behind on Today's Calls ("5 calls/day", every day the lead stays open —
  // not just its assignment day). For a lead assigned today, the lifetime-total
  // call_attempts IS today's effort (it didn't exist before today), so that
  // column is used directly. For a lead still open on day 2+, the export has
  // no true per-day counter — only the lifetime-cumulative call_attempts
  // total — so today's real count comes from a day-over-day DELTA instead:
  // today's call_attempts minus its value as of the most recent Movement_Log
  // snapshot from before today (see buildTodayCallBaseline). That's actual
  // call data, not a guess — unlike the old CRM-comment-count proxy, it
  // doesn't undercount a lead that was genuinely called but never
  // commented on (this is exactly the situation Recording Not Working
  // flags separately as a logging problem, not a calling one). Falls back
  // to the comment-log proxy only when no pre-today snapshot exists yet
  // for this lead (fresh Movement_Log setup, or gaps in capture history),
  // or while enriching a past snapshot itself (see _enrichingHistorical).
  const loggedToday = actionLogEntries.filter(e => {
    if (!e.ts) return false;
    const d = parseDate(e.ts);
    return d && istSameDay(d, now);
  }).length;
  let attemptsToday;
  if (isCreatedToday) {
    attemptsToday = l.call_attempts;
  } else if (!_enrichingHistorical) {
    const baselineKey = String(l.client_id || '').trim() || 'l:' + String(l.lead_id).trim();
    const baseline = _todayCallBaselineByKey.get(baselineKey);
    attemptsToday = baseline !== undefined ? Math.max(0, (Number(l.call_attempts) || 0) - baseline) : loggedToday;
  } else {
    attemptsToday = loggedToday;
  }
  const underCalledToday = isOpenLead && pastGrace && attemptsToday < CONFIG.MIN_CALLS_PER_DAY;

  // Stuck: open past 48hrs and still hasn't reached Opportunity — the one
  // check deliberately exempt from the isUnder48h scope, since being old is
  // the whole point of it.
  const stageStuck48h = past48h && pastGrace;

  // Not Updated: currently sitting in the very first funnel stage — never
  // progressed since import. Also absorbs the "otherwise" half of Rule 1
  // (neverConnectedPastWindow, computed above) — a lead nobody has
  // connected with past the 10-minute window belongs here now, not under
  // Not Connected in 10 Minutes, regardless of what its stage text happens
  // to say.
  const isNotUpdated = isOpenLead && isUnder48h &&
    ((pastGrace && canonicalStage(l.current_stage) === 'not updated') || neverConnectedPastWindow);

  // SOP Rule 4 — Post-Connect Follow-up: once connected, CRM should be
  // reviewed every 4 hours. Deliberately independent of call count: a
  // well-called lead that has gone quiet after connecting is exactly what
  // this rule exists to catch.
  // hasConnected/connectDate computed earlier now (Rule 1 needs them too).
  // When no comment has ever been logged, "hours since last comment" is
  // undefined. Treating that as automatically overdue wrongly flags a lead
  // connected 10 minutes ago, so the clock falls back to time since
  // CONNECTION — Rule 4 is about review cadence after connecting.
  const hoursSinceConnect = connectDate ? (now - connectDate) / 36e5 : null;
  const followupStaleHours = hoursSinceLastComment !== null
    ? hoursSinceLastComment
    : (hoursSinceConnect !== null ? hoursSinceConnect : ageHours);
  const followupOverdue = isOpenLead && isUnder48h && pastGrace && hasConnected &&
    followupStaleHours !== null && followupStaleHours > CONFIG.FOLLOWUP_REVIEW_HOURS;

  // Recording Not Working — a pure data-integrity check, deliberately with
  // NO gating: no open/closed filter, no grace period, no priority ranking.
  // Requires BOTH call_count (connected calls) AND call_attempts (every
  // dial, connected or not) to be zero. call_attempts > 0 with call_count
  // still 0 just means the RM dialed and it didn't connect — that attempt
  // WAS recorded by the system, so recording is working fine; it's only a
  // genuine data-integrity gap when NEITHER figure shows any call activity
  // at all, despite a comment saying work happened. "Comment" here means
  // any of the four comment-ish columns (see hasAnyCommentField), not just
  // the structured action log — a lead with only a last_comment or a
  // closing_reason set is still real evidence someone touched it.
  const recordingCommentsNoCalls = l.call_count === 0 && l.call_attempts === 0 && hasAnyCommentField(l);
  // Closed with No Comment is its own separate issue card below — a lead
  // CLOSED with no real narrative ever logged (see hasAnyNarrativeComment
  // above), i.e. no evidence any work happened before closure. Deliberately
  // just these two conditions: call_count/call_attempts are dropped from
  // this one (unlike recordingCommentsNoCalls above, which still needs
  // both zero) — a closed lead with literally no comment is the signal on
  // its own, regardless of whatever number sits in the call columns. Uses
  // hasAnyNarrativeComment, NOT hasAnyCommentField — closing_reason is
  // excluded from what counts as "a comment" here on purpose: it's very
  // often the ONLY field filled on a lead closed in bulk or via a dropdown
  // reason with current_stage never touched (still reading "Not Updated"),
  // and that closing_reason tag alone is exactly the "no real work" case
  // this check exists to surface, not evidence against it.
  const closedWithNoComment = excluded && !hasAnyNarrativeComment(l);
  const recordingNotWorking = recordingCommentsNoCalls;

  // Inactive-RM Lead Added — a brand-new lead landed on an RM who's
  // currently marked inactive. rm_is_active is a CURRENT snapshot, not a
  // historical log, so "on that day" is only knowable for leads assigned
  // TODAY — this can't retroactively prove an older lead was misrouted,
  // only that a fresh one just was. Deliberately no grace period: the
  // problem isn't the RM being slow, it's that the assignment itself was
  // wrong and nobody can act on it until it's reassigned.
  // `l.rm_is_active != null ? ... : ''`, NOT `l.rm_is_active || ''` — the
  // cell is often a real checkbox (boolean `false` for an inactive RM),
  // and `false || ''` would silently turn that into an empty string,
  // which then reads as "unknown" below instead of "inactive" — the
  // check would never fire for a single checkbox-driven row.
  const rmActiveRaw = String(l.rm_is_active != null ? l.rm_is_active : '').trim().toLowerCase();
  const rmIsInactive = ['false', 'no', 'inactive', '0', 'n'].includes(rmActiveRaw);
  const inactiveRmNewLead = isOpenLead && isCreatedToday && rmIsInactive;

  return Object.assign({}, l, {
    ageHours, oppOrAbove, excluded, hasClosingReason, isOpenLead, past48h, isUnder48h, stageStuck48h,
    firstContactStatus, firstContactBreach, businessMinsToConnect, neverConnectedPastWindow,
    agentCount, isMultiAgent,
    hoursSinceLastComment, lastCommentAt, isNotUpdated,
    followupOverdue, hasConnected, recordingNotWorking, recordingCommentsNoCalls, closedWithNoComment,
    rmIsInactive, inactiveRmNewLead,
    attemptsToday, underCalledToday,
    collatedFrom: l.collatedFrom || 1, collatedRMs: l.collatedRMs || [], collatedLeadIds: l.collatedLeadIds || [],
    collatedRegions: l.collatedRegions || []
  });
}

