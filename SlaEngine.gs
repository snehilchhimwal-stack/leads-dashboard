/**
 * SLA Engine — the 5 SLA compliance rules (Inactive-RM Lead Added / Not
 * Updated / No follow up in last 4 hours / Behind on Today's Calls / Stuck 48h+),
 * faithfully ported from dashboard.html's enrichLead, plus the shared
 * priority order for picking "the" issue when a lead qualifies for more
 * than one. Used by MovementTracker.gs (writeSlaHistorySnapshot_, for the
 * automatic SLA_History capture) AND by OvernightEmailer.gs/
 * AllIssuesEmailer.gs (via primaryIssueGs_, to decide which flagged
 * leads get an email and what issue label to show).
 *
 * Split out of MovementTracker.gs/OvernightEmailer.gs (2026-08-28) as
 * part of a full compartmentalization pass — this logic was never
 * specific to either script, just historically defined wherever it was
 * first needed. Moving code between .gs files in the SAME Apps Script
 * project has no functional effect (one shared namespace across every
 * file in a project) — this is a pure organization change.
 *
 * Depends on Core.gs (getVal_, isOpenLead_, canonicalStage_,
 * istDayKeyGs_) and FollowupEngine.gs
 * (latestCommentTimestamp_, countTodayCommentEntries_) — load order
 * between files doesn't matter to Apps Script (see Core.gs's own note),
 * this is just documenting the real dependency.
 *
 * Mirrors dashboard.html's CONFIG values these rules depend on — keep in
 * sync if either changes.
 *
 * ============================== SETUP ==============================
 * Paste this in as its own file, alongside every other file in this
 * project. See Core.gs's own setup note for the full file list.
 * ================================================================================
 */

const LEAD_GRACE_HOURS_ = 3;
const LEAD_LIFECYCLE_HOURS_ = 48;
const MIN_CALLS_PER_DAY_ = 3; // 2026-10-19: was 5 (user request)
const FOLLOWUP_REVIEW_HOURS_ = 4;
const WORK_START_HOUR_ = 9;
const WORK_END_HOUR_ = 19;

// SE-2 (2026-10-13): lead_assigned_at / last_connect_time read the way the dashboard's parseDate (js/core-lead-model.js)
// reads them. A real Date cell is used as is (an invalid one is null). A text cell is parsed too, instead of being treated as
// "no date": "YYYY-MM-DD HH:MM[:SS]" (space or T) and a bare "YYYY-MM-DD" are IST wall time (+05:30), and anything else is
// handed to new Date() (which handles an explicit zone such as "...Z" / "+05:30"). Numbers and other types stay null, as before.
function parseSlaDateGs_(v) {
  if (v instanceof Date) return isNaN(v.getTime()) ? null : v;
  if (typeof v !== 'string') return null;
  const s = v.trim();
  if (!s) return null;
  const dt = s.match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?$/);
  let d;
  if (dt) d = new Date(dt[1] + '-' + dt[2] + '-' + dt[3] + 'T' + dt[4] + ':' + dt[5] + ':' + (dt[6] || '00') + '+05:30');
  else if (/^\d{4}-\d{2}-\d{2}$/.test(s)) d = new Date(s + 'T00:00:00+05:30');
  else d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

// Faithful port of the 5 SLA rules dashboard.html's enrichLead computes —
// see that function for the canonical definitions this must stay
// traceable back to. Only computes what SLA_History needs (isOpenLead +
// the 5 rules), not the many other fields enrichLead also derives purely
// for the dashboard's own UI (sibling pooling, multi-agent detection, etc.)
// DR-10 (2026-10-13): KEEP IN SYNC with DailyRmIssueLog.gs computeRmPerfEligibilityGs_, which copies this function's
// open / dated / grace / 48h eligibility - a change to those gates here must be made there too. (As of 2026-10-13 that copy
// still reads lead_assigned_at / last_connect_time as Date cells only; it should use parseSlaDateGs_ like this one, SE-2.)
function computeSlaFlags_(row, colIndex, now, baselineMap) {
  const stage = getVal_(row, colIndex, 'current_stage');
  const closingReason = getVal_(row, colIndex, 'closing_reason');
  const leadClosingReason = getVal_(row, colIndex, 'lead_closing_reason');
  const isOpenLead = isOpenLead_(stage, closingReason, leadClosingReason);

  const flags = {
    isOpenLead: isOpenLead,
    inactiveRmNewLead: false, isNotUpdated: false, followupOverdue: false,
    underCalledToday: false, stageStuck48h: false,
  };
  if (!isOpenLead) return flags;

  const createdRaw = getVal_(row, colIndex, 'lead_assigned_at');
  const created = parseSlaDateGs_(createdRaw); // SE-2
  if (!created) return flags; // undatable — no rule can fire, same as enrichLead's ageHours=null path

  const ageHours = (now.getTime() - created.getTime()) / 36e5;
  const pastGrace = ageHours >= LEAD_GRACE_HOURS_;
  const isUnder48h = ageHours <= LEAD_LIFECYCLE_HOURS_;
  const past48h = ageHours > LEAD_LIFECYCLE_HOURS_;
  const isCreatedToday = istDayKeyGs_(created) === istDayKeyGs_(now);

  // Inactive-RM Lead Added — deliberately no grace period (the problem is
  // the assignment, not RM speed). getVal_ already returns real `false`
  // for a checkbox-typed cell (only '' on a truly null/undefined value —
  // see its own comment), so `|| ''` here would silently swallow that
  // `false` into an empty string that reads as "unknown" below instead
  // of "inactive" — same fix as dashboard.html's enrichLead().
  const rmActiveRawVal = getVal_(row, colIndex, 'rm_is_active');
  const rmActiveRaw = String(rmActiveRawVal != null ? rmActiveRawVal : '').trim().toLowerCase();
  const rmIsInactive = ['false', 'no', 'inactive', '0', 'n'].indexOf(rmActiveRaw) !== -1;
  flags.inactiveRmNewLead = isCreatedToday && rmIsInactive;

  // Leads Pending Beyond 48 Hours.
  flags.stageStuck48h = past48h && pastGrace;

  const connectTimeRaw = getVal_(row, colIndex, 'last_connect_time');
  const connectDate = parseSlaDateGs_(connectTimeRaw); // SE-2
  const hasConnected = !!connectDate || !!String(getVal_(row, colIndex, 'last_connect') || '').trim();

  // Not Updated — open lead, past the 3h grace, canonical stage text is
  // 'not updated'. Nothing else. (2026-10-19, user request: the old second
  // branch — "never connected past the 10-business-minute window", which
  // fired regardless of stage text and inside the grace — was removed.)
  //
  // Deliberately NOT gated on isUnder48h (2026-09-03 fix — real data check
  // found ~40% of leads whose stage is STILL literally "Not Updated" were
  // over 48h old and had silently stopped being counted here, because the
  // old `isUnder48h &&` gate cut them off the instant they crossed 48h —
  // even though nothing about them had changed. They didn't vanish, they
  // just started being reported ONLY as stageStuck48h instead, which
  // doesn't distinguish "still sitting at the CRM's default untouched
  // stage" from any other 48h+-stuck lead — exactly the gap a Repeat
  // Offenders user noticed (a genuinely neglected lead never builds up
  // more than ~2 nights of "Not Updated" history before this gate silently
  // reclassified it). Now isNotUpdated and stageStuck48h can both be true
  // for the same lead at once; ISSUE_PRIORITY_GS_ picks isNotUpdated first
  // (it outranks stageStuck48h), so a lead whose stage still literally
  // reads "Not Updated" is reported as that — not silently absorbed into
  // Stuck — no matter how old it gets. This changes what
  // AllIssuesEmailer.gs/OvernightEmailer.gs report for such leads (now
  // "Not Updated" instead of "Stuck 48h+") — an intentional, requested
  // side effect, not an oversight.
  flags.isNotUpdated = pastGrace && canonicalStage_(stage) === 'not updated';

  // No follow up in last 4 hours (key followupOverdue; label was "Follow-up
  // Overdue" until 2026-10-19). Staleness is measured from the LATEST of the
  // last comment and the last call. The leads data has no last-call-attempt
  // timestamp column, so last_connect_time stands in for "last call". With
  // neither, the clock runs from assignment (ageHours), as before.
  // Gates kept: under 48h, past grace, connected.
  const internalComments = getVal_(row, colIndex, 'internal_status_comments');
  const stageComments = getVal_(row, colIndex, 'stage_comments');
  const lastCommentAt = latestCommentTimestamp_(internalComments, stageComments);
  const lastTouchMs = Math.max(lastCommentAt ? lastCommentAt.getTime() : -Infinity, connectDate ? connectDate.getTime() : -Infinity);
  const followupStaleHours = lastTouchMs !== -Infinity ? (now.getTime() - lastTouchMs) / 36e5 : ageHours;
  flags.followupOverdue = isUnder48h && pastGrace && hasConnected && followupStaleHours > FOLLOWUP_REVIEW_HOURS_;

  // Behind on Today's Calls.
  //
  // 2026-10-01 fix (real incident — lead 2245665/Riya Yadav, Minas Patel's
  // Western team, confirmed live via a read-only diagnostic against the
  // production sheet): the delta-vs-baseline approach alone can
  // UNDERCOUNT — a real, dated, TODAY-timestamped "Calling Status/Comment
  // : Not Reachable" entry existed in internal_status_comments, but
  // call_attempts was identical to its own pre-today baseline (11 = 11),
  // so the delta read 0 despite a genuine logged interaction today. The
  // comment-count fallback (countTodayCommentEntries_) used to run ONLY
  // when no baseline existed at all — now it's computed unconditionally
  // (mirrors js/core-lead-model.js's loggedToday, always computed up
  // front) and the delta branch takes MAX(delta, commentCount) instead of
  // the delta alone. This doesn't reopen the original problem the delta
  // was built to fix (an uncommented real call still wins via the delta,
  // unaffected) and also can't be fooled by a commented interaction the
  // counter failed to increment for. Sent a real, incorrect "Still open —
  // Behind on Today's Calls" follow-up email (OvernightEmailer.gs
  // Checkpoint 1+2) before this fix. Byte-for-byte mirror of the JS fix —
  // keep both in sync (HANDOVER.md §6).
  const callAttempts = Number(getVal_(row, colIndex, 'call_attempts')) || 0;
  const commentCountToday = countTodayCommentEntries_(internalComments, stageComments, now);
  let attemptsToday;
  if (isCreatedToday) {
    attemptsToday = callAttempts;
  } else {
    // Keyed by LEAD id, not client_id (email audit F18): call_attempts is a per-lead lifetime counter, and a customer's several
    // leads carry different counters - under the old client key a lead was compared with whichever sibling's snapshot came first.
    // (Every RM copy of ONE lead id carries the identical counter, so copies agree.) Mirrors js/core-lead-model.js enrichLead.
    const leadId = String(getVal_(row, colIndex, 'lead_id') || '').trim();
    const baseline = leadId ? baselineMap[leadId] : undefined;
    attemptsToday = baseline !== undefined
      ? Math.max(0, callAttempts - baseline, commentCountToday)
      : commentCountToday; // no pre-today baseline yet — same fallback as enrichLead's loggedToday
  }
  flags.underCalledToday = pastGrace && attemptsToday < MIN_CALLS_PER_DAY_;

  return flags;
}

// Which of the 5 SLA checks to report as "the" issue when more than one
// fires — same priority order ISSUE_PRIORITY uses on the dashboard.
const ISSUE_PRIORITY_GS_ = [
  { key: 'inactiveRmNewLead', label: 'Inactive-RM Lead Added' },
  { key: 'isNotUpdated', label: 'Not Updated' },
  { key: 'followupOverdue', label: 'No follow up in last 4 hours' },
  { key: 'underCalledToday', label: "Behind on Today's Calls" },
  { key: 'stageStuck48h', label: 'Stuck 48h+' },
];
// Labels that were renamed. Stored rows (AllIssues_Log snapshots, Overnight
// issue logs, Daily_RM_Issues.issue_label) keep the old text, so every
// reader that compares or shows a stored label maps it through
// canonicalIssueLabelGs_ first. 2026-10-19: "Follow-up Overdue" became
// "No follow up in last 4 hours".
const LEGACY_ISSUE_LABELS_GS_ = {
  'Follow-up Overdue': 'No follow up in last 4 hours',
};
function canonicalIssueLabelGs_(label) {
  return Object.prototype.hasOwnProperty.call(LEGACY_ISSUE_LABELS_GS_, label) ? LEGACY_ISSUE_LABELS_GS_[label] : label;
}
function primaryIssueGs_(flags) {
  for (let i = 0; i < ISSUE_PRIORITY_GS_.length; i++) {
    if (flags[ISSUE_PRIORITY_GS_[i].key]) return ISSUE_PRIORITY_GS_[i];
  }
  return null;
}

// Two-checkpoint email lifecycle redesign (Step 4/11 -- see
// docs/_planning/EMAIL_LIFECYCLE_TWO_CHECKPOINT_REDESIGN.md Part 6 for
// the full state model this implements) -- compares a set of "prior"
// per-lead entries against the CURRENT live leads tab and returns one
// {lead_id, state, currentIssueLabel, currentStatus} per entry.
//
// `priorEntries` deliberately accepts EITHER shape this function's own
// two callers use, so it is reused VERBATIM for both checkpoints rather
// than copy-pasted:
//   - a raw AllIssues_Log issue_snapshot_json array (Checkpoint 1's
//     input) -- each entry has `issueLabel` directly, no `state` field
//     at all, since it was never itself a checkpoint result;
//   - this function's OWN previous return value (Checkpoint 2's input)
//     -- each entry has `state` + `currentIssueLabel` instead.
// allIssuesCheckpointPriorLabel_/allIssuesCheckpointPriorWasActive_
// below normalize over that difference; nothing else in this function
// needs to know which shape it was actually handed.
//
// `state` is one of:
//   'not_found'       -- the lead_id no longer exists in the leads tab.
//   'resolved'        -- closed / past Opportunity+ / no longer flagged
//                        by computeSlaFlags_+primaryIssueGs_. Disappearing
//                        from a read is NEVER treated as resolved on its
//                        own -- that is 'not_found', a different state,
//                        per the design doc's explicit "disappearance !=
//                        resolution" rule.
//   'still_open'      -- open, flagged, SAME issue label as the prior entry.
//   'category_changed'-- open, flagged, DIFFERENT issue label, and the
//                        new one is not higher-priority than the old one.
//   'escalated'        -- same as category_changed, but the new issue
//                        outranks the old one in ISSUE_PRIORITY_GS_ (a
//                        display distinction only -- no new SLA rule).
//   'reopened'         -- the PRIOR entry was itself 'resolved' or
//                        'not_found', but the lead is open and flagged
//                        again now. Only ever reachable when this
//                        function is called with another checkpoint's
//                        own output as `priorEntries` (Checkpoint 2+) --
//                        a raw 17:00 snapshot entry is by definition
//                        always an active issue, so Checkpoint 1 itself
//                        can never produce this state, but the check
//                        stays in this ONE shared function rather than
//                        being bolted on one level up at Checkpoint 2.
//
// `baselineMap` is threaded straight through to computeSlaFlags_ — same
// Movement_Log-derived baseline the 17:00 job itself already built via
// buildMovementLogMapsGs_, needed for underCalledToday's isCreatedToday
// === false branch (true for nearly every lead by the time a checkpoint
// runs, since the snapshot itself is never from earlier today).
function allIssuesCheckpointPriorLabel_(entry) {
  return canonicalIssueLabelGs_(entry.state !== undefined ? entry.currentIssueLabel : entry.issueLabel);
}
function allIssuesCheckpointPriorWasActive_(entry) {
  return entry.state !== 'resolved' && entry.state !== 'not_found';
}
// `leadsData` (optional, the {colIndex, dataRows} object readLeadsTab_ returns) — email audit P8 / F8: a job that already read
// the leads tab passes ITS snapshot here, so a 10:00 / 13:00 run does ONE whole-sheet read instead of one per bucket (~30; the
// 3 Oct 13:00 run took 663 s), and every bucket — Section 1 and Section 2 of the same email — is judged against the SAME moment
// of a sheet that is re-imported underneath the run. Omitted (or not a usable {colIndex, dataRows}), it reads the tab itself,
// exactly as before.
function computeAllIssuesCheckpointGs_(ss, priorEntries, now, baselineMap, leadsData) {
  if (!priorEntries || !priorEntries.length) return [];
  const wantedIds = new Set(priorEntries.map(function (e) { return e.lead_id; }));
  const { colIndex, dataRows } = (leadsData && leadsData.colIndex && leadsData.dataRows) ? leadsData : readLeadsTab_(ss);
  const byLeadId = {};
  dataRows.forEach(function (row) {
    const leadId = String(getVal_(row, colIndex, 'lead_id') || '').trim();
    // First match wins -- same "don't let a duplicate customer row
    // silently overwrite the one already found" caution the 17:00 job's
    // own byIdentity dedupe already applies, just simpler here since a
    // checkpoint only ever looks up a FIXED, already-known lead_id list
    // rather than building a fresh candidate set.
    if (leadId && wantedIds.has(leadId) && !byLeadId[leadId]) byLeadId[leadId] = row;
  });

  const priorityIndexOf = function (label) {
    for (let i = 0; i < ISSUE_PRIORITY_GS_.length; i++) {
      if (ISSUE_PRIORITY_GS_[i].label === canonicalIssueLabelGs_(label)) return i;
    }
    return -1;
  };

  return priorEntries.map(function (entry) {
    const row = byLeadId[entry.lead_id];
    if (!row) return { lead_id: entry.lead_id, state: 'not_found', currentIssueLabel: null, currentStatus: null };

    const stage = String(getVal_(row, colIndex, 'current_stage') || '').trim();
    const stillOpen = isOpenLead_(stage, getVal_(row, colIndex, 'closing_reason'), getVal_(row, colIndex, 'lead_closing_reason'));
    const currentStatus = overnightStatusLabelGs_(stage);
    if (!stillOpen) return { lead_id: entry.lead_id, state: 'resolved', currentIssueLabel: null, currentStatus: currentStatus };

    const issue = primaryIssueGs_(computeSlaFlags_(row, colIndex, now, baselineMap));
    if (!issue) return { lead_id: entry.lead_id, state: 'resolved', currentIssueLabel: null, currentStatus: currentStatus };

    if (!allIssuesCheckpointPriorWasActive_(entry)) {
      return { lead_id: entry.lead_id, state: 'reopened', currentIssueLabel: issue.label, currentStatus: currentStatus };
    }
    const priorLabel = allIssuesCheckpointPriorLabel_(entry);
    if (issue.label === priorLabel) {
      return { lead_id: entry.lead_id, state: 'still_open', currentIssueLabel: issue.label, currentStatus: currentStatus };
    }
    const wasRank = priorityIndexOf(priorLabel);
    const isRank = priorityIndexOf(issue.label);
    // SE-1 (2026-10-13, product decision): "Behind on Today's Calls" counts calls since IST midnight against a FULL-day
    // minimum, so at 10:00 / 13:00 most leads read as behind just because the day has started. A move INTO that label is
    // therefore reported as category_changed, never escalated. (17:00 flags and computeSlaFlags_ itself are unchanged.)
    const escalated = wasRank !== -1 && isRank !== -1 && isRank < wasRank // lower index = higher priority
      && issue.label !== "Behind on Today's Calls";
    return { lead_id: entry.lead_id, state: escalated ? 'escalated' : 'category_changed', currentIssueLabel: issue.label, currentStatus: currentStatus };
  });
}

// Two-checkpoint email lifecycle redesign (Step 5/11 -- see the design
// doc's Part 6/8: "Part 6's incremental diff is a second pass over this
// same function's output plus the prior checkpoint"). Checkpoint 2 is
// produced by calling computeAllIssuesCheckpointGs_ AGAIN, with
// Checkpoint 1's own result array as `priorEntries` (already proven to
// work by Tests_SlaEngine.gs's own "reused on its own output" case) --
// that call alone is the full comparison, nothing new needed there.
// What IS new here is deciding which of THOSE results are worth a
// human seeing again at 13:00, since blindly showing the whole
// population a second time would be exactly the "recreate the 17:00
// table" the design doc explicitly says not to do.
//
// The rule (changed 2026-09-26 at the user's request -- "no need to send
// email for resolved status, only if not resolved"): show ONLY leads that
// are still genuinely active (still_open/category_changed/escalated, even
// with an UNCHANGED label -- an unresolved SLA breach staying unresolved
// all day is itself the news, same reasoning the EXISTING Overnight
// Follow-up already applies: "still flagged for the SAME issue =
// unresolved, shown in red", never suppressed for being unchanged) or
// reopened after appearing resolved at the prior checkpoint. A lead that
// is resolved / no longer found is never shown -- including one that was
// newly resolved this leg, which used to be listed once as news.
//
// `checkpoint1Entries`: Checkpoint 1's own result array (what
// computeAllIssuesCheckpointGs_ returned when first called with the raw
// 17:00 issue_snapshot_json) -- i.e. checkpoint1_json's parsed content.
// `checkpoint2Results`: computeAllIssuesCheckpointGs_'s output from
// calling it a second time with `checkpoint1Entries` as its own
// `priorEntries` argument -- the caller computes this (not done inside
// this function). The caller persists this function's OUTPUT (the still-
// unresolved leads that were emailed) to checkpoint2_json (col M), not the
// full raw array: keeping resolved leads out also keeps that cell small (a
// 2026-09-25 oversized checkpoint2 write crashed the 13:00 job).
// checkpoint1_json (col K) still records every lead's state, resolved included.
function filterAllIssuesCheckpoint2ForEmailGs_(checkpoint1Entries, checkpoint2Results) {
  // 2026-09-26: only leads that are STILL UNRESOLVED are ever emailed — a lead that just got resolved is no longer
  // "news" (previously shown once as Resolved). checkpoint1Entries is kept in the signature for the existing callers.
  return (checkpoint2Results || []).filter(allIssuesCheckpointIsActiveGs_);
}

// A checkpoint result is "active" (worth emailing about) only while its lead still has an open SLA issue; resolved and
// not_found never trigger an email and are never listed in one.
function allIssuesCheckpointIsActiveGs_(result) {
  return !!result && result.state !== 'resolved' && result.state !== 'not_found';
}
