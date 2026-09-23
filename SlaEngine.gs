/**
 * SLA Engine — the 5 SLA compliance rules (Inactive-RM Lead Added / Not
 * Updated / Follow-up Overdue / Behind on Today's Calls / Stuck 48h+),
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
 * istDayKeyGs_, businessMinutesBetweenGs_) and FollowupEngine.gs
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
const MIN_CALLS_PER_DAY_ = 5;
const FOLLOWUP_REVIEW_HOURS_ = 4;
const FIRST_CONTACT_SLA_MINUTES_ = 10;
const WORK_START_HOUR_ = 9;
const WORK_END_HOUR_ = 19;

// Faithful port of the 5 SLA rules dashboard.html's enrichLead computes —
// see that function for the canonical definitions this must stay
// traceable back to. Only computes what SLA_History needs (isOpenLead +
// the 5 rules), not the many other fields enrichLead also derives purely
// for the dashboard's own UI (sibling pooling, multi-agent detection, etc.)
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
  const created = createdRaw instanceof Date ? createdRaw : null;
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
  const connectDate = connectTimeRaw instanceof Date ? connectTimeRaw : null;
  const hasConnected = !!connectDate || !!String(getVal_(row, colIndex, 'last_connect') || '').trim();

  // Deliberately grace-exempt, same as dashboard.html — see its own
  // comment on neverConnectedPastWindow: a silent lead shouldn't sit
  // unflagged in the 10-min-to-3h gap this exists to catch.
  const neverConnectedPastWindow = isUnder48h && !connectDate &&
    businessMinutesBetweenGs_(created, now) > FIRST_CONTACT_SLA_MINUTES_;

  // Not Updated — canonical stage text (once past grace), OR never
  // connected past the 10-minute window regardless of stage text.
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
  flags.isNotUpdated = (pastGrace && canonicalStage_(stage) === 'not updated') || neverConnectedPastWindow;

  // Follow-up Overdue (4h Post-Connect).
  const internalComments = getVal_(row, colIndex, 'internal_status_comments');
  const stageComments = getVal_(row, colIndex, 'stage_comments');
  const lastCommentAt = latestCommentTimestamp_(internalComments, stageComments);
  const hoursSinceConnect = connectDate ? (now.getTime() - connectDate.getTime()) / 36e5 : null;
  const hoursSinceLastComment = lastCommentAt ? (now.getTime() - lastCommentAt.getTime()) / 36e5 : null;
  const followupStaleHours = hoursSinceLastComment !== null ? hoursSinceLastComment
    : (hoursSinceConnect !== null ? hoursSinceConnect : ageHours);
  flags.followupOverdue = isUnder48h && pastGrace && hasConnected && followupStaleHours > FOLLOWUP_REVIEW_HOURS_;

  // Behind on Today's Calls.
  const callAttempts = Number(getVal_(row, colIndex, 'call_attempts')) || 0;
  let attemptsToday;
  if (isCreatedToday) {
    attemptsToday = callAttempts;
  } else {
    const clientId = String(getVal_(row, colIndex, 'client_id') || '').trim();
    const leadId = String(getVal_(row, colIndex, 'lead_id') || '').trim();
    const baselineKey = clientId || ('l:' + leadId);
    const baseline = baselineMap[baselineKey];
    attemptsToday = baseline !== undefined
      ? Math.max(0, callAttempts - baseline)
      : countTodayCommentEntries_(internalComments, stageComments, now); // no pre-today baseline yet — same fallback as enrichLead's loggedToday
  }
  flags.underCalledToday = pastGrace && attemptsToday < MIN_CALLS_PER_DAY_;

  return flags;
}

// Which of the 5 SLA checks to report as "the" issue when more than one
// fires — same priority order ISSUE_PRIORITY uses on the dashboard.
const ISSUE_PRIORITY_GS_ = [
  { key: 'inactiveRmNewLead', label: 'Inactive-RM Lead Added' },
  { key: 'isNotUpdated', label: 'Not Updated' },
  { key: 'followupOverdue', label: 'Follow-up Overdue' },
  { key: 'underCalledToday', label: "Behind on Today's Calls" },
  { key: 'stageStuck48h', label: 'Stuck 48h+' },
];
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
  return entry.state !== undefined ? entry.currentIssueLabel : entry.issueLabel;
}
function allIssuesCheckpointPriorWasActive_(entry) {
  return entry.state !== 'resolved' && entry.state !== 'not_found';
}
function computeAllIssuesCheckpointGs_(ss, priorEntries, now, baselineMap) {
  if (!priorEntries || !priorEntries.length) return [];
  const wantedIds = new Set(priorEntries.map(function (e) { return e.lead_id; }));
  const { colIndex, dataRows } = readLeadsTab_(ss);
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
      if (ISSUE_PRIORITY_GS_[i].label === label) return i;
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
    const escalated = wasRank !== -1 && isRank !== -1 && isRank < wasRank; // lower index = higher priority
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
// The rule: suppress ONLY a lead that was ALREADY closed out
// (resolved/not_found) at Checkpoint 1 AND is STILL closed out now --
// that pairing carries no news. Everything else is shown: still
// genuinely active (still_open/category_changed/escalated, even with
// an UNCHANGED label -- an unresolved SLA breach staying unresolved
// all day is itself the news, same reasoning the EXISTING Overnight
// Follow-up already applies: "still flagged for the SAME issue =
// unresolved, shown in red", never suppressed for being unchanged) OR
// any transition into/out of closed-out (newly resolved this leg, or
// reopened after appearing resolved at the prior checkpoint).
//
// `checkpoint1Entries`: Checkpoint 1's own result array (what
// computeAllIssuesCheckpointGs_ returned when first called with the raw
// 17:00 issue_snapshot_json) -- i.e. checkpoint1_json's parsed content.
// `checkpoint2Results`: computeAllIssuesCheckpointGs_'s output from
// calling it a second time with `checkpoint1Entries` as its own
// `priorEntries` argument -- the caller computes this (not done inside
// this function) so the FULL, unfiltered array is still what gets
// persisted to checkpoint2_json (col M) -- the design doc's state model
// needs the complete record, not just what a human ends up seeing;
// filtering is a presentation concern layered on top, kept separate.
function filterAllIssuesCheckpoint2ForEmailGs_(checkpoint1Entries, checkpoint2Results) {
  const checkpoint1ByLeadId = {};
  (checkpoint1Entries || []).forEach(function (e) { checkpoint1ByLeadId[e.lead_id] = e; });
  const closedOutStates = { resolved: true, not_found: true };

  return (checkpoint2Results || []).filter(function (r) {
    const priorState = (checkpoint1ByLeadId[r.lead_id] || {}).state;
    const wasClosedOut = closedOutStates[priorState] === true;
    const stillClosedOut = closedOutStates[r.state] === true;
    return !(wasClosedOut && stillClosedOut);
  });
}
