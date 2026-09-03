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
