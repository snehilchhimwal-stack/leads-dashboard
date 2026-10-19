/**
 * All-Issues Emailer — automatic email covering every one of the 5
 * Operations SLA checks (Inactive-RM Lead Added / Not Updated / No follow
 * up in last 4 hours / Behind on Today's Calls / Stuck 48h+), scoped to:
 *   - Source = google, Sub-source = Non-UTM or Search only (see
 *     passesGoogleNonUtmSearchGs_, EmailInfra.gs)
 *   - Leads ASSIGNED in the last 3 calendar days (IST) — TODAY plus the 2
 *     full days before it, e.g. run on the 28th, covers the 26th, 27th,
 *     and 28th in full. NOT a rolling 48-hours-back-from-now window (see
 *     allIssuesWindowGs_'s own comment for why that was a real bug: a
 *     rolling window silently drops whatever was assigned before its
 *     start CLOCK TIME on the earliest day, not the earliest CALENDAR
 *     DAY — e.g. running at 5pm meant everything assigned before 5pm on
 *     the earliest day was excluded, even though that day was supposed
 *     to be fully in scope)
 *
 * Content mirrors the dashboard's own Operations tab: same 5 checks, same
 * priority order when a lead qualifies for more than one (primaryIssueGs_,
 * SlaEngine.gs — the SAME function Operations' own combined view uses),
 * same Suggested Follow-up text (overnightFollowupHintGs_,
 * FollowupEngine.gs). Routing mirrors the overnight emailer exactly:
 * resolveRecipientEmailsForRegion_ (EmailInfra.gs) buckets each region's
 * affected RMs by their own A1/TM/RH manager chain, via
 * resolveRecipientBucketsForRms_ (RmHierarchy.gs) — one email per
 * resolved bucket, not one flat email per region — with the same
 * CH-level diversion (notifyChLevelIssuesGs_ below) and the same "leads
 * not sent" audit (notifyLeadSendFailuresGs_, reused directly from
 * EmailInfra.gs) for anything that couldn't be routed or failed to send.
 *
 * Subject line: "<bucketLabel> (<primaryRole>) google Leads With Issue
 * (<from> to <to>)" — e.g. "Omkar Ghate (A1) google Leads With Issue
 * (26-Aug-2026 to 28-Aug-2026)", or "Ayaz Bagwan (TM) google Leads With
 * Issue (26-Aug-2026 to 28-Aug-2026)" for a bucket whose primary is
 * standing in for RMs with no A1 of their own (same tier variability
 * sendOneOvernightEmail_, OvernightEmailer.gs, already documents —
 * primaryRole is never "CH" here; a CH-tier primary is always
 * self-holding and goes through notifyChLevelIssuesGs_ instead —
 * "<chName> (CH) google Leads With Issue (<from> to <to>)" — same split
 * as the overnight script). The date segment is always the actual
 * calendar-day window this run covers (allIssuesDateRangeLabelGs_), not
 * a single day.
 *
 * ============================== SETUP (one-time) ==============================
 *   1. Same Apps Script project as every other file this project needs —
 *      Core.gs, SlaEngine.gs, FollowupEngine.gs, EmailInfra.gs,
 *      MovementTracker.gs, OvernightEmailer.gs, RmHierarchy.gs,
 *      RmHierarchy.private.gs, and DailyRmIssueLog.gs (see Core.gs's own
 *      header for the full list) — paste this in as its own file
 *      (Apps Script editor → + → Script → name it AllIssuesEmailer).
 *   2. In the function dropdown, select setupAllIssuesEmailTrigger, click
 *      Run, approve permissions. Installs ONE daily trigger at
 *      ALL_ISSUES_RUN_HOUR_ (5pm IST — one run a day, per explicit
 *      request; edit the constant and re-run this function to change it).
 *   3. To test without emailing real RMs: set TEST_MODE_OVERRIDE_EMAIL_ at
 *      the top of EmailInfra.gs (shared by every script in this project)
 *      to your own address, then run sendAllIssuesEmailsNow from the
 *      function dropdown. Set it back to '' before relying on the real
 *      trigger.
 * ================================================================================
 */

const ALL_ISSUES_LOG_SHEET_ = 'AllIssues_Log';
// Calendar-day window (IST), not a rolling number of hours — how many
// FULL days before TODAY also get included (2 -> today + the 2 days
// before it = 3 calendar days total). Switched from a rolling
// hours-back-from-now window (2026-08-28) after a real reported
// undercount: that design always missed whatever was assigned before its
// own start CLOCK TIME on the earliest day it touched — e.g. a run at 5pm
// meant every lead assigned that morning on the earliest day (before
// 5pm) was silently excluded, not because it was actually meant to be
// out of scope, just because the window's start point happened to land
// partway through that calendar day rather than at its midnight.
const ALL_ISSUES_WINDOW_DAYS_BACK_ = 2;
const ALL_ISSUES_RUN_HOUR_ = 17; // IST (5pm) — one run a day, see setupAllIssuesEmailTrigger below
// Email Ops EO-9 / plan decision D5: a failed or blocked 17:00 bucket may be re-sent (recoverFailedAllIssuesBucketsNow) until 18:30 IST; after that it
// stays failed and is NOT sent late (it is reported, and the next 17:00 run covers any lead that is still flagged).
const ALL_ISSUES_LATE_CUTOFF_HOUR_ = 18;
const ALL_ISSUES_LATE_CUTOFF_MINUTE_ = 30;

// 2026-10-16 (user request): these primary recipients (bucket primary name, case-insensitive) get ONE 17:00 email covering every
// region they hold leads in, instead of one email per region — e.g. Rajesh Muni had three on 16 Oct (Western, SoBo, Central).
// Same shape as the Futwork email: one pseudo-region (consolidatedRegionKeyGs_, EmailInfra.gs) so the ledger, AllIssues_Log,
// the "already sent today" guard, recovery and the 10:00/13:00 checkpoints all see ONE bucket; each lead keeps its real region
// (region bands in the email, regions spelled out in the subject). Cc is ONLY ALL_ISSUES_CONSOLIDATED_CC_NAME_ — none of the
// per-region Cc lists (leadership, P&L head, EXTRA_CC_FOR_RM_) are carried over (user decision, 2026-10-16).
// The 10:00 job (OvernightEmailer.gs) uses the same list and key: ONE 10:00 email (Section 1 overnight leads of every region, then
// Checkpoint 1) and ONE 13:00 reply in that thread, Cc ONLY this address.
// 2026-10-17 (user request): Snehil Chhimwal is consolidated the same way. His buckets are the leads whose chain resolves to him
// (e.g. Rajesh/Manisha personally holding a lead - their rh is Snehil); Rajesh's/Manisha's own S1s stay in THEIR buckets (every
// RM lands in exactly one bucket, its primary's), so nothing is absorbed or sent twice. His Cc would be himself, so it is dropped
// (consolidatedAllIssuesRecGs_): To = him, no Cc. No role label (his RM_Hierarchy row says "City Lead") is shown in any
// consolidated person's email (emailRoleLabelGs_); RM_Hierarchy is unchanged, so routing is unchanged.
const ALL_ISSUES_CONSOLIDATED_RECIPIENTS_ = ['rajesh muni', 'manisha rathod', 'snehil chhimwal'];
const ALL_ISSUES_CONSOLIDATED_CC_NAME_ = 'Snehil Chhimwal';
// Test override, same convention as OPS_ALERT_EMAIL_ (EmailInfra.gs): blank = look the name up. Nothing in production assigns it.
let ALL_ISSUES_CONSOLIDATED_CC_EMAIL_ = '';
function allIssuesConsolidatedCcGs_() {
  if (ALL_ISSUES_CONSOLIDATED_CC_EMAIL_) return ALL_ISSUES_CONSOLIDATED_CC_EMAIL_;
  const resolved = resolvedEmailForNameGs_(ALL_ISSUES_CONSOLIDATED_CC_NAME_);
  if (resolved) return resolved;
  warnEmailConfigOnceGs_('allIssuesConsolidatedCc', 'no address for "' + ALL_ISSUES_CONSOLIDATED_CC_NAME_ + '" in the private employee table — the consolidated 17:00 emails are cc\'d to the ops address instead.');
  return opsAlertEmailGs_();
}
function isAllIssuesConsolidatedRecipientGs_(bucketLabel) {
  const k = String(bucketLabel || '').trim().toLowerCase();
  return !!k && ALL_ISSUES_CONSOLIDATED_RECIPIENTS_.some(function (n) { return String(n).trim().toLowerCase() === k; });
}

// The role shown in an email for a bucket: none for a consolidated person (2026-10-17: "City Lead" must never appear in Snehil's
// emails; Rajesh/Manisha likewise), otherwise the bucket's recorded role. Display only - the ledger id and AllIssues_Log keep the role.
function emailRoleLabelGs_(bucketLabel, primaryRole) {
  return isAllIssuesConsolidatedRecipientGs_(bucketLabel) ? '' : String(primaryRole || '');
}

// One recipient record for a consolidated person, from their per-region buckets (sorted region order). To = the first region's
// To (the same person — a different To elsewhere is logged, never silently dropped: it is added to Cc); Cc = the one configured
// address. In TEST MODE the real recipients travel as originalTo/originalCc, exactly as for any other bucket.
function consolidatedAllIssuesRecGs_(parts) {
  const first = parts[0].rec;
  const realTo = function (r) { return String(r.originalTo || r.to || '').trim(); };
  const to = realTo(first);
  const ccList = [];
  const taken = {};
  taken[to.toLowerCase()] = true;
  const addCc = function (addr) { const a = String(addr || '').trim(); if (a && !taken[a.toLowerCase()]) { taken[a.toLowerCase()] = true; ccList.push(a); } };
  parts.forEach(function (p) {
    if (realTo(p.rec).toLowerCase() !== to.toLowerCase()) {
      Logger.log('Consolidated 17:00 email for ' + first.bucketLabel + ': ' + p.region + ' resolved To ' + realTo(p.rec) + ' (not ' + to + ') - added to Cc.');
      addCc(realTo(p.rec));
    }
  });
  // The configured Cc is never added to that person's own email (Snehil Chhimwal IS the configured Cc) - by name, so a second
  // address on file for him cannot sneak back in as a Cc; by address it is already dropped (taken[to]).
  if (String(first.bucketLabel || '').trim().toLowerCase() !== String(ALL_ISSUES_CONSOLIDATED_CC_NAME_).trim().toLowerCase()) addCc(allIssuesConsolidatedCcGs_());
  const cc = ccList.join(',') || undefined;
  const rmNames = [];
  parts.forEach(function (p) { p.rec.rmNames.forEach(function (n) { if (rmNames.indexOf(n) === -1) rmNames.push(n); }); });
  const source = 'Consolidated across regions (' + parts.map(function (p) { return p.region; }).join(', ') + '; ' + (cc ? 'Cc ' + cc : 'no Cc') + '): ' +
    parts.map(function (p) { return p.region + ' = ' + p.rec.source; }).join(' + ');
  const rec = { to: to, cc: cc, rmNames: rmNames, source: source, bucketLabel: first.bucketLabel, primaryRole: first.primaryRole };
  if (TEST_MODE_OVERRIDE_EMAIL_) return Object.assign(rec, { to: TEST_MODE_OVERRIDE_EMAIL_, cc: undefined, originalTo: to, originalCc: cc });
  return rec;
}

// TODAY (IST) plus the ALL_ISSUES_WINDOW_DAYS_BACK_ full calendar days
// before it — e.g. run on the 28th, covers the 26th, 27th, and 28th (up
// to whenever this actually runs) in full. Anchored to IST midnight on
// the earliest day, not a fixed number of hours back from `asOf` — see
// ALL_ISSUES_WINDOW_DAYS_BACK_'s own comment for exactly why that
// distinction matters. Deliberately NOT the overnight emailer's fixed
// 5pm-to-9am window (overnightWindowGs_) — this is a genuinely different
// scope (full calendar days, every day, not "since the RM's desk closed
// yesterday").
function allIssuesWindowGs_(asOf) {
  const todayKey = istDayKeyGs_(asOf);
  const todayMidnight = new Date(todayKey + 'T00:00:00+05:30');
  const from = new Date(todayMidnight.getTime() - ALL_ISSUES_WINDOW_DAYS_BACK_ * 24 * 3600 * 1000);
  return { from: from, to: asOf };
}

// Subject-line date segment — e.g. run on the 28th, "(26-Aug-2026 to
// 28-Aug-2026)". Shared by both subject-building sites below (normal
// bucket and CH-level) so the format only has to be right in one place.
function allIssuesDateRangeLabelGs_(win) {
  const fmt = function (d) { return Utilities.formatDate(d, 'Asia/Kolkata', 'dd-MMM-yyyy'); };
  return '(' + fmt(win.from) + ' to ' + fmt(win.to) + ')';
}

// Columns J-N (added 2026-09-23, two-checkpoint email lifecycle redesign
// -- see docs/_planning/EMAIL_LIFECYCLE_TWO_CHECKPOINT_REDESIGN.md Part 5
// for the full design) persist enough per-bucket state that the SAME
// 17:00 population this row already represents (one row per manager
// bucket per run, same grain columns A-I already use) can be followed
// up TWICE -- once at the next day's 10:00 (Checkpoint 1) and again at
// 13:00 (Checkpoint 2) -- without a second sheet or a join. Mirrors
// Overnight_Log's own lead_ids_json pattern (OvernightEmailer.gs), just
// widened to two checkpoints instead of one:
//   issue_snapshot_json  -- written by the 17:00 job at send time:
//     [{lead_id, RM, TL, status, issueLabel, followup}, ...] -- the
//     EXACT population this bucket's email reported, straight from the
//     bucketLeads array sendOneAllIssuesEmail_ already has in scope.
//   checkpoint1_json     -- written by the 10:00 job:
//     [{lead_id, state, currentIssueLabel, currentStatus}, ...] where
//     state is one of 'resolved' / 'still_open' / 'category_changed' /
//     'escalated' / 'not_found' (see the design doc's Part 6 for exactly
//     how each is derived from computeSlaFlags_/primaryIssueGs_).
//   checkpoint1_sent_at  -- timestamp; also the idempotency guard a
//     retried 10:00 run checks before recomputing/resending this row's
//     Checkpoint 1 (design doc Part 10).
//   checkpoint2_json     -- written by the 13:00 job, same shape as
//     checkpoint1_json, computed incrementally against it (not a fresh
//     re-diff from issue_snapshot_json) -- see design doc Part 6.
//   checkpoint2_sent_at  -- idempotency guard, same role as checkpoint1_sent_at.
// All 5 are blank until the corresponding job actually runs for this
// row; a row from BEFORE this change (or a 17:00 run where nothing
// happened to populate them) simply has 5 blank cells, same as any
// other missing-header backfill this function already tolerates.
// Retried on a transient Sheets error: the 17:00 job's first call into the spreadsheet after the preliminary reads used to be unprotected (HANDOVER section 8, 2026-10-10).
// Idempotent: a retry after a timeout that actually created the tab finds it and carries on.
function ensureAllIssuesLogSheet_(ss) {
  return withRetry_(function () { return ensureAllIssuesLogSheetOnce_(ss); }, 'open AllIssues_Log');
}
function ensureAllIssuesLogSheetOnce_(ss) {
  let sheet = ss.getSheetByName(ALL_ISSUES_LOG_SHEET_);
  const headers = ['date', 'region', 'bucket_label', 'primary_role', 'to', 'cc', 'lead_count', 'sent_at', 'thread_id',
    'issue_snapshot_json', 'checkpoint1_json', 'checkpoint1_sent_at', 'checkpoint2_json', 'checkpoint2_sent_at'];
  if (!sheet) {
    sheet = ss.insertSheet(ALL_ISSUES_LOG_SHEET_);
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    sheet.setFrozenRows(1);
    return sheet;
  }
  const lastCol = sheet.getLastColumn();
  const existingHeaders = lastCol > 0 ? sheet.getRange(1, 1, 1, lastCol).getValues()[0] : [];
  const existingSet = {};
  existingHeaders.forEach(function (h) { existingSet[String(h || '').trim()] = true; });
  const missing = headers.filter(function (h) { return !existingSet[h]; });
  if (missing.length) sheet.getRange(1, lastCol + 1, 1, missing.length).setValues([missing]);
  return sheet;
}

/**
 * Trigger entry point (installed by setupAllIssuesEmailTrigger — same
 * function name the trigger targets, so renaming the real body below to
 * sendAllIssuesEmails_ needs no trigger re-registration). Wraps the whole
 * real run in a try/catch: without this, ANYTHING thrown before the
 * per-region send loop even starts (a Sheets error withRetry_ couldn't
 * recover from, a bad row, a bug in a shared dependency) aborted the
 * entire run with NOTHING sent for ANY region and NOTHING logged anywhere
 * a human would see — notifyLeadSendFailuresGs_ (the normal "some leads
 * didn't get an email" report) never even runs if something upstream
 * throws, so a total failure was completely silent: no email to anyone,
 * no ops alert, just an Apps Script Executions log entry nobody was
 * watching. Re-thrown after alerting so Executions still correctly shows
 * this run as Failed — never silently swallowed.
 */
function sendAllIssuesEmails() {
  // Held for the whole run (withEmailJobLockGs_, EmailInfra.gs; email audit P4): this job's "already sent today" guard reads
  // AllIssues_Log rows that are only written after each send, so an overlapping run would send every bucket twice.
  withEmailJobLockGs_('sendAllIssuesEmails', function () {
    try {
      sendAllIssuesEmails_();
    } catch (e) {
      notifyOpsAlertGs_('sendAllIssuesEmails crashed — NO All-Issues emails were sent this run', [
        'sendAllIssuesEmails threw before completing, so nothing was sent for ANY region this run — not even the usual per-lead "not sent" report, which only runs if the function reaches its own end.',
        'Error: ' + (e && e.stack ? e.stack : e),
      ], { immediate: true }); // a whole-job failure: nothing left to confirm (EO-2)
      throw e;
    }
  });
}

/**
 * The real run. Same overall shape as sendOvernightMorningEmails
 * (OvernightEmailer.gs): read the leads tab once, scan every row through
 * the scope gates, compute each lead's SLA flags, dedupe by customer
 * identity, bucket by region then by resolved hierarchy recipient, send
 * one email per bucket, and finish with one consolidated "not sent"
 * report for anything that couldn't be routed or failed to send.
 */
function sendAllIssuesEmails_(opts) {
  // opts.onlyEmailIds (Email Ops EO-9, recovery only): { ledgerEmailId: true } - re-send just those failed buckets. The region "already sent today" guard is
  // skipped for them, everything else is recomputed from the CURRENT data (so a lead that is resolved by now is simply not in the email), and the exclusions
  // and CH-level reports of the original run are not repeated.
  const recoverIds = (opts && opts.onlyEmailIds) || null;
  // Timing breadcrumbs (added 2026-09-02, after a real run took ~50min end
  // to end with no way to tell from Executions alone whether the time went
  // into the preliminary reads or the per-bucket send loop). Purely
  // observational — logged, never alerted on, never changes behavior.
  const runStart = Date.now();
  const elapsed_ = function () { return ((Date.now() - runStart) / 1000).toFixed(1) + 's'; };

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const now = new Date();
  const win = allIssuesWindowGs_(now);
  const { colIndex, dataRows } = readLeadsTab_(ss); // EmailInfra.gs
  Logger.log('[timing] readLeadsTab_ done at ' + elapsed_() + ' (' + dataRows.length + ' rows)');
  // EI-13 (audit 2026-10-13): an empty or truncated Leads tab used to mean zero emails and no word to anyone - it looked exactly
  // like a quiet day. The run still completes (there is nothing to send); ops are told why.
  if (!dataRows.length) {
    notifyOpsAlertGs_('17:00 All-Issues: the Leads tab has NO data rows - no emails were sent', [
      'readLeadsTab_ returned zero data rows (tab "' + resolveTabName_(ss) + '"), so the 17:00 All-Issues run had nothing to check and sent nothing.',
      'Check the Leads tab refresh. Once the tab is filled again, run sendAllIssuesEmailsNow() by hand.',
    ]);
  }
  const recipients = loadRegionRecipients_(ss); // EmailInfra.gs — legacy fallback, same as overnight
  // Loaded ONCE and threaded through resolveRecipientEmailsForRegion_ below
  // (via opts.hierarchyData) instead of letting each region's own call
  // re-load RM_Hierarchy + Manager_Directory from scratch — see
  // resolveRecipientBucketsForRms_'s own comment (RmHierarchy.gs).
  const hierarchyData = withRetry_(function () { return loadRmHierarchyAndEmails_(ss); }, 'loadRmHierarchyAndEmails_');
  Logger.log('[timing] loadRmHierarchyAndEmails_ done at ' + elapsed_());
  // Real per-lead baseline for the "no comment logged" Suggested Follow-up
  // tier (noCommentFollowUpGs_) — WITHOUT this, every no-comment lead gets
  // the same generic "connect and log the outcome" line regardless of
  // whether the RM has actually been dialing (this was missing from the
  // first version of this script — sendOvernightMorningEmails always
  // computes this and passes the real per-lead entry; this now does too).
  // buildMovementLogMapsGs_ (MovementTracker.gs), not the two separate
  // buildTodayCallBaselineGs_/lastSnapshotBeforeGs_ calls this used to
  // make — those each did their own full read of Movement_Log (the
  // largest sheet in this project), so calling both back to back paid
  // for that read TWICE; this reads it once and derives both maps from
  // the same in-memory rows.
  const movementMaps = withRetry_(function () { return buildMovementLogMapsGs_(ss, now); }, 'buildMovementLogMapsGs_');
  const baselineMap = movementMaps.baselineMap;
  const lastSnapshotMap = movementMaps.lastSnapshotMap;
  const lastChangeMap = movementMaps.lastChangeMap || {}; // for the stale-lead block (decision D8)
  Logger.log('[timing] buildMovementLogMapsGs_ done at ' + elapsed_() + ' — all preliminary reads finished, starting the per-region send loop');

  // Flat candidate list first, deduped by customer identity, THEN grouped
  // by region — same reasoning as sendOvernightMorningEmails: a customer
  // held by more than one RM at once must not be counted/emailed as two
  // unrelated leads.
  const candidateLeads = [];
  dataRows.forEach(function (row) {
    const leadId = String(getVal_(row, colIndex, 'lead_id') || '').trim();
    if (!leadId) return;

    if (!passesGoogleNonUtmSearchGs_(getVal_(row, colIndex, 'group_source'), getVal_(row, colIndex, 'source_bucket'))) return;

    const createdRaw = getVal_(row, colIndex, 'lead_assigned_at');
    const created = createdRaw instanceof Date ? createdRaw : null;
    if (!created || created < win.from || created > win.to) return; // not assigned in the last 3 calendar days (allIssuesWindowGs_)

    const rawRegion = getVal_(row, colIndex, 'region');
    const main = mainRegionForGs_(rawRegion);
    if (!main) return; // not one of the 11 configured regions

    const stage = String(getVal_(row, colIndex, 'current_stage') || '').trim();
    const closingReason = getVal_(row, colIndex, 'closing_reason');
    const leadClosingReason = getVal_(row, colIndex, 'lead_closing_reason');
    if (!isOpenLead_(stage, closingReason, leadClosingReason)) return; // closed — no issue to report

    const flags = computeSlaFlags_(row, colIndex, now, baselineMap);
    const issue = primaryIssueGs_(flags); // same priority order Operations' own combined view uses
    if (!issue) return; // open, in scope, but flagged for nothing right now

    const RM = String(getVal_(row, colIndex, 'RM') || '').trim() || 'Unassigned';
    const TL = String(getVal_(row, colIndex, 'TL') || '').trim();
    const clientId = String(getVal_(row, colIndex, 'client_id') || '').trim();
    const stageRank = FUNNEL_ORDER_.indexOf(canonicalStage_(stage) || '');
    const baselineEntry = lastSnapshotMap[leadId]; // per LEAD, not per customer (email audit F18) - call_attempts is a per-lead counter

    candidateLeads.push({
      identityKey: clientId || ('l:' + leadId),
      stageRank: stageRank,
      region: main, lead_id: leadId, RM: RM, TL: TL,
      status: overnightStatusLabelGs_(stage),
      issueLabel: issue.label,
      followup: overnightFollowupHintGs_(row, colIndex, now, baselineEntry),
      staleSince: staleSinceOfRowGs_(row, colIndex, lastChangeMap, now),
    });
  });

  const byIdentity = new Map();
  let dupedAwayCount = 0;
  candidateLeads.forEach(function (l) {
    const existing = byIdentity.get(l.identityKey);
    if (!existing) { byIdentity.set(l.identityKey, l); return; }
    dupedAwayCount++;
    if (l.stageRank > existing.stageRank) byIdentity.set(l.identityKey, l);
  });
  if (dupedAwayCount) {
    Logger.log(dupedAwayCount + ' duplicate customer row(s) collapsed to a single copy each for this run — kept whichever had progressed furthest.');
  }

  const byRegion = {}; // mainRegion -> flagged leads[]; Futwork RMs' leads from EVERY region share one 'Futwork' key (regionKeyForRmGs_)
  byIdentity.forEach(function (l) {
    const groupKey = regionKeyForRmGs_(l.RM, l.region);
    if (!byRegion[groupKey]) byRegion[groupKey] = [];
    byRegion[groupKey].push({
      lead_id: l.lead_id, RM: l.RM, TL: l.TL, region: l.region,
      status: l.status, issueLabel: l.issueLabel, followup: l.followup, staleSince: l.staleSince,
    });
  });

  const logSheet = ensureAllIssuesLogSheet_(ss);
  const dateLabel = Utilities.formatDate(now, 'Asia/Kolkata', 'd MMM yyyy');
  const todayKey = istDayKeyGs_(now);
  // Evidence trail (Email Ops EO-1a, EmailLedger.gs): null in TEST MODE, DISABLED when the sheets cannot be opened - either way
  // every ledger call below is a no-op and the emails go out exactly as before.
  const ledger = emailLedgerOpenGs_(ss);
  const ledgerJob = EMAIL_LEDGER_JOB_ALL_ISSUES_;
  const exLedger = recoverIds ? null : ledger; // a recovery run does not repeat the original run's exclusion rows

  // Idempotency guard — same per-region-per-day pattern
  // sendOvernightMorningEmails uses against Overnight_Log, applied here
  // against AllIssues_Log instead.
  const alreadyLoggedRegionsToday = {};
  const priorLastRow = lastRowRetryGs_(logSheet);
  if (priorLastRow >= 2) {
    withRetry_(function () { return logSheet.getRange(2, 1, priorLastRow - 1, 2).getValues(); }, 'read AllIssues_Log for idempotency check')
      .forEach(function (r) {
        const cell = r[0];
        const key = cell instanceof Date ? istDayKeyGs_(cell) : String(cell);
        if (key === todayKey) alreadyLoggedRegionsToday[String(r[1] || '').trim()] = true;
      });
  }
  // AI-3 (audit 2026-10-13): the log row is written AFTER the send, and its append failing is only logged - so a run that died
  // between send and append, or whose append failed, left no row and a same-day re-run re-sent the whole region. The ledger
  // records the send itself: a region with any 17:00 row today that is ACCEPTED (sent), or ATTEMPTING / UNCONFIRMED (may have
  // been sent) is treated as already sent too. Not in TEST MODE or a recovery (the guard is bypassed there anyway). A ledger
  // that cannot be read falls back to the log alone (logged) - the guard never blocks a run on its own failure.
  if (!TEST_MODE_OVERRIDE_EMAIL_ && !recoverIds) {
    try {
      emailLedgerReadRowsGs_(ss.getSheetByName(EMAIL_LEDGER_SHEET_), EMAIL_LEDGER_HEADERS_, todayKey).forEach(function (r) {
        const status = String(r.status || '');
        if (r.job === ledgerJob && emailLedgerDayKeyOfGs_(r.cycle_day) === todayKey &&
          (status === EMAIL_LEDGER_STATUS_.ACCEPTED || status === EMAIL_LEDGER_STATUS_.ATTEMPTING || status === EMAIL_LEDGER_STATUS_.UNCONFIRMED)) {
          const region = String(r.region || '').trim();
          if (region && !alreadyLoggedRegionsToday[region]) {
            Logger.log('Region ' + region + ' has no AllIssues_Log row today but the ledger shows a 17:00 email ' + status + ' (' + r.email_id + ') - treating it as already sent.');
            alreadyLoggedRegionsToday[region] = true;
          }
        }
      });
    } catch (e) {
      Logger.log('Email_Ledger could not be read for the "already sent today" guard - using AllIssues_Log alone: ' + e);
    }
  }

  const failedLeadEntries = [];
  const recoveredSeen = {}; // recovery only: the targeted email ids that this run produced a bucket for
  // [timing] AI-9 (audit 2026-10-13): attempts and successes are counted apart - the old single counter was logged as "sent"
  // but counted every attempt, failed ones included.
  let bucketSendCount = 0; // bucket emails attempted - the send loop's own duration only means something alongside this count
  let bucketSentOkCount = 0; // …of which Gmail accepted
  // 2026-10-16: consolidated people's buckets, collected from every region and sent once after the region loop.
  const consolidatedParts = {}; // lower-cased bucket label -> [{ region, rec, leads }]

  // Records a region's (or a consolidated person's) buckets as PLANNED in one write.
  const planBuckets_ = function (region, list) {
    emailLedgerPlanGs_(ledger, list.filter(function (b) { return b.leads.length; }).map(function (b) {
      return {
        emailId: b.emailId, job: ledgerJob, dayKey: todayKey, region: region, bucketLabel: b.rec.bucketLabel, primaryRole: b.rec.primaryRole,
        to: b.rec.to, cc: b.rec.cc, subject: allIssuesSubjectGs_(region, b.rec, b.leads, win), leadIds: b.leads.map(function (l) { return String(l.lead_id); }),
      };
    }));
  };
  // Sends one bucket and folds its outcome into the run's counters and the "not sent" report.
  const sendBucket_ = function (region, b) {
    const ledgerCtx = { ledger: ledger, emailId: b.emailId, dropped: [], isRetry: false };
    const failure = sendOneAllIssuesEmail_(ss, logSheet, region, b.rec, b.leads, dateLabel, todayKey, now, win, ledgerCtx);
    bucketSendCount++;
    if (!failure) bucketSentOkCount++;
    // Leads the send-safety gate objected to individually were dropped from this bucket and the rest was resent (decision D3).
    ledgerCtx.dropped.forEach(function (d) {
      failedLeadEntries.push({ lead_id: d.lead.lead_id, RM: d.lead.RM, to: b.rec.to, cc: b.rec.cc || '', reason: 'Left out of the email: ' + d.reason });
    });
    emailLedgerExcludeGs_(ledger, ledgerCtx.dropped.map(function (d) {
      return { job: ledgerJob, dayKey: todayKey, region: region, kind: 'lead', leadId: d.lead.lead_id, rm: d.lead.RM, emailId: b.emailId, reason: d.reason };
    }));
    if (failure) {
      const droppedIds = {};
      ledgerCtx.dropped.forEach(function (d) { droppedIds[String(d.lead.lead_id)] = true; }); // already listed above - not twice
      b.leads.filter(function (l) { return !droppedIds[String(l.lead_id)]; }).forEach(function (l) {
        failedLeadEntries.push({ lead_id: l.lead_id, RM: l.RM, to: b.rec.to, cc: b.rec.cc || '', reason: failure.reason });
      });
    }
  };

  Object.keys(byRegion).sort().forEach(function (region) {
    const regionLeads = byRegion[region];
    if (!regionLeads.length) return;
    if (alreadyLoggedRegionsToday[region] && !TEST_MODE_OVERRIDE_EMAIL_ && !recoverIds) {
      Logger.log('Skipping ' + region + ' — already sent today (' + todayKey + ', AllIssues_Log or Email_Ledger); not re-sending.');
      emailLedgerExcludeGs_(exLedger, [{ job: ledgerJob, dayKey: todayKey, region: region, kind: 'region', reason: 'already sent today - the re-run guard skipped ' + regionLeads.length + ' lead(s)' }]);
      return;
    }
    const regionStart_ = Date.now();

    // Per-lead isolation (plan decision D3): a lead that cannot be shown reliably is left out and recorded; the rest still goes.
    const split = emailLedgerSplitLeadsGs_(regionLeads);
    // AI-1 (audit 2026-10-13): a recovery run walks EVERY region again, so collecting these here re-reported the original run's
    // exclusions in a second all-regions "Leads NOT sent" email. Only the first run reports them (exLedger is null in recovery too).
    if (!recoverIds) split.defective.filter(function (d) { return !d.covered; }).forEach(function (d) { // a duplicate's first copy WAS sent - not "unsent"
      failedLeadEntries.push({ lead_id: d.lead.lead_id, RM: d.lead.RM, to: '', cc: '', reason: 'Left out of the email: ' + d.reason });
    });
    emailLedgerExcludeGs_(exLedger, split.defective.map(function (d) {
      return { job: ledgerJob, dayKey: todayKey, region: region, kind: 'lead', leadId: d.lead.lead_id, rm: d.lead.RM, reason: d.reason };
    }));
    const flaggedLeads = split.valid;
    if (!flaggedLeads.length) return;

    const rmNames = Array.from(new Set(flaggedLeads.map(function (l) { return l.RM; })));
    const rmToLeads = {};
    flaggedLeads.forEach(function (l) {
      if (!rmToLeads[l.RM]) rmToLeads[l.RM] = [];
      rmToLeads[l.RM].push(l);
    });
    const resolution = resolveRecipientEmailsForRegion_(ss, region, rmNames, recipients, { fireAlerts: false, rmToLeads: rmToLeads, dateLabel: dateLabel, hierarchyData: hierarchyData });

    // CH-level self-holding/reports-all-the-way-up RMs — own diversion,
    // same split as the overnight script (resolveRecipientEmailsForRegion_
    // itself doesn't fire this alert when fireAlerts:false, so it's called
    // explicitly here instead). Reads resolution.chLevelRms (which the
    // call just above already computed) instead of calling
    // resolveRecipientBucketsForRms_ a second time with identical
    // arguments — that second call used to double this file's own share
    // of the per-region RM_Hierarchy/Manager_Directory reload cost.
    if (!recoverIds) notifyChLevelIssuesGs_(region, resolution.chLevelRms, rmToLeads, win, ledger);

    const unresolvedExclusions = [];
    resolution.trulyUnresolved.forEach(function (u) {
      (rmToLeads[u.rmName] || []).forEach(function (l) {
        if (!recoverIds) failedLeadEntries.push({ lead_id: l.lead_id, RM: u.rmName, to: '', cc: '', reason: u.reason }); // AI-1
        unresolvedExclusions.push({ job: ledgerJob, dayKey: todayKey, region: region, kind: 'lead', leadId: l.lead_id, rm: u.rmName, reason: 'no recipient could be resolved: ' + u.reason });
      });
    });
    emailLedgerExcludeGs_(exLedger, unresolvedExclusions);

    // Every bucket email of this region is recorded as PLANNED in ONE write before the first send, so an email that never goes
    // out (a crash, a timeout kill) still leaves a row that says it should have.
    const buckets = [];
    resolution.results.forEach(function (rec) {
      const rmSet = new Set(rec.rmNames);
      const bucketLeads = flaggedLeads.filter(function (l) { return rmSet.has(l.RM); });
      // 2026-10-16: a consolidated person's bucket is set aside and sent once, for all regions, after this loop.
      if (!isMultiRegionKeyGs_(region) && isAllIssuesConsolidatedRecipientGs_(rec.bucketLabel)) {
        if (bucketLeads.length) {
          const k = String(rec.bucketLabel).trim().toLowerCase();
          (consolidatedParts[k] = consolidatedParts[k] || []).push({ region: region, rec: rec, leads: bucketLeads });
        }
        return;
      }
      buckets.push({ rec: rec, leads: bucketLeads, emailId: emailLedgerIdGs_(ledgerJob, todayKey, region, rec.primaryRole, rec.bucketLabel) });
    });
    let bucketsToSend = buckets;
    if (recoverIds) {
      bucketsToSend = buckets.filter(function (b) { return recoverIds[b.emailId]; });
      bucketsToSend.forEach(function (b) { recoveredSeen[b.emailId] = true; });
    }
    planBuckets_(region, bucketsToSend);
    bucketsToSend.forEach(function (b) { sendBucket_(region, b); });
    Logger.log('[timing] ' + region + ' done at ' + elapsed_() + ' (' + resolution.results.length + ' bucket(s) this region, ' + ((Date.now() - regionStart_) / 1000).toFixed(1) + 's for this region)');
  });

  // 2026-10-16: ONE email per consolidated person, keyed by their own pseudo-region (consolidatedRegionKeyGs_) — that key is
  // what the "already sent today" guard, the ledger id, AllIssues_Log and recovery see. A real region skipped by the re-run
  // guard above contributes none of its leads here (its own row says it already ran today).
  Object.keys(consolidatedParts).sort().forEach(function (k) {
    const parts = consolidatedParts[k];
    const rec = consolidatedAllIssuesRecGs_(parts);
    const regionKey = consolidatedRegionKeyGs_(rec.bucketLabel);
    const leads = dedupeByLeadIdGs_([].concat.apply([], parts.map(function (p) { return p.leads; })));
    if (alreadyLoggedRegionsToday[regionKey] && !TEST_MODE_OVERRIDE_EMAIL_ && !recoverIds) {
      Logger.log('Skipping ' + regionKey + ' — already sent today (' + todayKey + ', AllIssues_Log or Email_Ledger); not re-sending.');
      emailLedgerExcludeGs_(exLedger, [{ job: ledgerJob, dayKey: todayKey, region: regionKey, kind: 'region', reason: 'already sent today - the re-run guard skipped ' + leads.length + ' lead(s)' }]);
      return;
    }
    const b = { rec: rec, leads: leads, emailId: emailLedgerIdGs_(ledgerJob, todayKey, regionKey, rec.primaryRole, rec.bucketLabel) };
    if (recoverIds) {
      if (!recoverIds[b.emailId]) return;
      recoveredSeen[b.emailId] = true;
    }
    planBuckets_(regionKey, [b]);
    sendBucket_(regionKey, b);
  });
  if (recoverIds) {
    // A targeted bucket that this run did not produce (its leads were resolved meanwhile, or the routing changed): it is closed with the reason, never left failed without one.
    Object.keys(recoverIds).forEach(function (id) {
      if (!recoveredSeen[id]) emailLedgerResultGs_(ledger, id, { status: EMAIL_LEDGER_STATUS_.SKIPPED, reason: 'recovery: no bucket with this id was produced - the flagged leads were resolved or the routing changed since the failure, so nothing was re-sent', leadIds: [] });
    });
  }
  Logger.log('[timing] send loop finished at ' + elapsed_() + ' — ' + bucketSentOkCount + ' of ' + bucketSendCount + ' bucket email(s) sent this run');

  // Reused directly from EmailInfra.gs — same shape entries
  // ({lead_id, RM, to, cc, reason}), same consolidated report, sent to
  // the ops address (opsAlertEmailGs_). The wording is this job's own (EI-2/AI-4, audit 2026-10-13: it used to say "overnight"
  // and "tomorrow's run will NOT retry them", which is the 10:00 job's rule, not this one's).
  notifyLeadSendFailuresGs_(failedLeadEntries, {
    emailLabel: '17:00 All-Issues',
    runLabel: recoverIds ? 'Recovery of failed 17:00 buckets' : '',
    retryNote: 'the next 17:00 run lists a lead again only while it is still flagged and was assigned in the last 3 calendar days (IST).',
  });
  pruneEmailLedgerGs_(ledger, now);
  emailLedgerFinishGs_(ledger, 'the 17:00 All-Issues run');
  Logger.log('[timing] sendAllIssuesEmails_ finished — total ' + elapsed_() + ', ' + bucketSentOkCount + ' of ' + bucketSendCount + ' bucket email(s) sent, ' + failedLeadEntries.length + ' lead(s) not sent');
}

// CH-level report for this script's own scope — same visual shell and
// same self-held-vs-reports-up-to split as notifyChLevelLeadsGs_
// (OvernightEmailer.gs), but framed around SLA issues rather than "still
// open overnight", and sent unconditionally (this script always wants to
// know about a CH-tier person personally holding a flagged lead, not just
// when fireAlerts is on — resolveRecipientEmailsForRegion_ is called with
// fireAlerts:false above specifically so ITS OWN overnight-flavored
// CH alert doesn't ALSO fire; this is the one that actually sends for
// this script).
function notifyChLevelIssuesGs_(region, chLevelRms, rmToLeads, win, ledger) {
  if (!chLevelRms.length) return;
  const byCh = groupChLevelRmsByCh_(chLevelRms);
  const dateRangeLabel = allIssuesDateRangeLabelGs_(win);

  Object.keys(byCh).forEach(function (chName) {
    const entry = byCh[chName];
    // Real recorded role (resolveRecipientBucketsForRms_ — "Cluster Head",
    // "City Lead", "Commercial Head", or "Leadership" for someone with no
    // RM_Hierarchy row at all), not a generic "CH" label — matches the
    // same "Name (real role)" shape the normal-bucket subject uses.
    // 2026-10-17: no role at all when the report goes to a no-role address (chLevelReportRoleGs_, EmailInfra.gs).
    const shownChRole = chLevelReportRoleGs_(entry.chRole || 'CH');
    const subject = chName + (shownChRole ? ' (' + shownChRole + ')' : '') + ' google Leads With Issue ' + dateRangeLabel;

    const split = splitSelfAndReportingRmNames_(chName, entry.rmNames);
    const selfRmNames = split.selfRmNames;
    const reportingRmNames = split.reportingRmNames;
    const noteParts = [];
    if (selfRmNames.length) {
      noteParts.push(chName + ' is personally holding ' + (selfRmNames.length === 1 ? 'this lead' : 'these leads') + ' — there\'s nobody below to route it through automatically.');
    }
    if (reportingRmNames.length) {
      noteParts.push('No A1, TM, or RH configured above ' + reportingRmNames.join(', ') + ' — chain resolves all the way up to ' + chName + '.');
    }
    const noteBanner = {
      html: '<div style="background:#fef3c7; border:2px solid #f59e0b; border-radius:8px; padding:12px 16px; margin-bottom:14px; font-family:Arial,Helvetica,sans-serif;">' +
        '<div style="font-weight:700; color:#92400e; font-size:13px;">Sent to Ops — not to ' + esc_(chName) + '</div>' +
        '<div style="color:#78350f; font-size:12.5px; margin-top:4px;">' + esc_(noteParts.join(' ')) + '</div></div>',
      plain: 'NOTE: sent to Ops, not to ' + chName + ' — ' + noteParts.join(' ') + '\n\n',
    };

    const grouped = groupLeadsByRmAndFlatten_(entry.rmNames, rmToLeads);
    const byRM = grouped.byRM;
    const rmKeys = grouped.rmKeys;
    const allLeads = grouped.allLeads;
    const issueTypeCount = Array.from(new Set(allLeads.map(function (l) { return l.issueLabel; }))).length;

    // 2026-10-05 email audit (P1/F4): same hole as notifyChLevelLeadsGs_ — nothing stopped a "0 Leads Flagged" report from
    // going out when the CH-level RM names resolved but rmToLeads held none of their leads.
    if (!allLeads.length) {
      Logger.log('notifyChLevelIssuesGs_: no flagged leads found for the CH-level RM(s) ' + entry.rmNames.join(', ') + ' (' + region + ') — report not sent.');
      return;
    }
    // Once per day per region + CH (email audit P10 / F11) — see wasChReportSentTodayGs_ (EmailInfra.gs).
    if (wasChReportSentTodayGs_(CH_REPORT_KINDS_.allIssues, region, chName)) {
      Logger.log('notifyChLevelIssuesGs_: the CH-level issues report for ' + chName + ' (' + region + ') was already sent today — not re-sending.');
      return;
    }

    const reportOpts = {
      title: 'Leads With Issue',
      region: region,
      subtitle: 'CH-level — ' + chName + ' · Google, Non-UTM/Search · last 3 calendar days', // AI-4: was "last 48h", which contradicted the footer
      kpis: [
        { value: allLeads.length, label: allLeads.length === 1 ? 'Lead Flagged' : 'Leads Flagged', bg: '#dbeafe', fg: '#2563eb' },
        { value: rmKeys.length, label: rmKeys.length === 1 ? 'RM Affected' : 'RMs Affected', bg: '#e0e7ff', fg: '#4338ca' },
        { value: issueTypeCount, label: issueTypeCount === 1 ? 'Issue Type' : 'Issue Types', bg: '#fef3c7', fg: '#b45309' },
      ],
      action: 'Review and clear these flags — each is one of the 5 Operations SLA checks (Inactive-RM Lead Added, Not Updated, No follow up in last 4 hours, Behind on Today\'s Calls, Stuck 48h+).',
      sections: rmKeys.map(function (rm) {
        return {
          heading: rm,
          subheading: rm.toLowerCase() === chName.toLowerCase() ? 'Held directly by ' + chName : 'Reports up to ' + chName,
          columns: ['Lead ID', 'Issue', 'Status', 'Suggested Follow-up'],
          rows: byRM[rm].map(function (l) { return [l.lead_id, l.issueLabel, l.status, l.followup]; }),
        };
      }),
      footerNote: 'This report is normally addressed to the RM\'s own manager chain — sent here instead because ' + chName + ' has nobody below them to route it through automatically. Scope: Source=google, Sub-source=Non-UTM/Search, leads assigned in the last 3 calendar days (today plus the 2 days before it, IST).',
    };
    applyStaleSplitGs_(reportOpts, staleSinceMapGs_(allLeads)); // stale leads are held at the bottom, and the headline count says so
    const html = noteBanner.html + renderOvernightReportEmailHTML_(reportOpts);
    // The plain-text part lists the leads too (email audit P2) — rendered from the same opts as the HTML.
    const plainBody = noteBanner.plain + 'RM(s): ' + entry.rmNames.join(', ') + '\n\n' + plainTextReportGs_(reportOpts);

    try {
      const chLeadIds = allLeads.map(function (l) { return l.lead_id; });
      const chDay = istDayKeyGs_(new Date());
      emailLedgerTrackSendGs_(ledger, {
        emailId: emailLedgerIdGs_(EMAIL_LEDGER_JOB_CH_ISSUES_, chDay, region, entry.chRole || 'CH', chName), job: EMAIL_LEDGER_JOB_CH_ISSUES_, dayKey: chDay,
        region: region, bucketLabel: chName, primaryRole: entry.chRole || 'CH', to: chLevelReportToGs_(), cc: '', subject: subject, leadIds: chLeadIds.map(String),
      }, function () {
        return sendGuardedEmailGs_({
          to: chLevelReportToGs_(), subject: subject, plainBody: plainBody, htmlBody: html,
          leadIds: chLeadIds,
        }, 'send CH-level issues report (' + chName + ', ' + region + ')');
      });
      markChReportSentGs_(CH_REPORT_KINDS_.allIssues, region, chName);
    } catch (e) {
      Logger.log('notifyChLevelIssuesGs_ failed to send its report for ' + chName + ' (' + region + '): ' + e);
      // AI-2 (audit 2026-10-13): every failure is alerted, not only a gate block. A plain Gmail failure used to leave no trace a
      // human would see, and these reports have no automatic recovery (recoverFailedAllIssuesBucketsNow only re-sends the
      // allIssues17 buckets, never a chLevel17 report) - so the alert says how to re-send by hand.
      notifyOpsAlertGs_('CH-level All-Issues report ' + (e && e.blockedByGuard ? 'BLOCKED' : 'FAILED') + ' - ' + region + ' / ' + chName, [
        String((e && e.message) || e),
        '',
        'Leads in it (' + allLeads.length + '): ' + allLeads.map(function (l) { return l.lead_id; }).join(', '),
        'CH-level reports are NOT covered by recoverFailedAllIssuesBucketsNow(). Re-send by hand: once the cause is fixed, the next sendAllIssuesEmailsNow() run sends this report again only if ' + region + ' has not been sent today (the region guard) - otherwise forward the leads above to ops/the CH yourself.' +
          (e && e.blockedByGuard ? '' : ' Check Gmail Drafts first: createDraft() runs before send(), so one or more drafts of this report may already exist.'),
      ]);
    }
  });
}

// The 17:00 bucket email's subject - one definition, shared with the Email_Ledger plan (D4, 2026-10-16: the plan recorded no subject, so
// EmailSweep.gs could not attribute a bounce arriving more than 15 minutes after the send).
// A Futwork email covers several regions, so its subject spells them out where other buckets show their role.
// AI-6 (audit 2026-10-13): a bucket with no role (the Unmatched-RMs fallbacks) read "Unmatched RMs () google ..." - the empty brackets are omitted.
function allIssuesSubjectGs_(region, rec, leads, win) {
  const subjectRole = isMultiRegionKeyGs_(region) ? regionHeaderOptsGs_(region, leads).region : emailRoleLabelGs_(rec.bucketLabel, rec.primaryRole);
  return rec.bucketLabel + (subjectRole ? ' (' + subjectRole + ')' : '') + ' google Leads With Issue ' + allIssuesDateRangeLabelGs_(win);
}

// Builds and sends ONE all-issues email for a single resolved bucket
// (one A1/TM/RH, or the legacy Region_Recipients catch-all). Subject:
// "<bucketLabel> (<primaryRole>) google Leads With Issue (<from> to <to>)"
// — see this file's header (AI-7, 2026-10-13: this comment still showed a
// retired "<role>/<label>/google/..." format). The role is omitted when a
// bucket has none (the Unmatched-RMs fallbacks), and a Futwork email shows
// its regions instead. Returns null on success, or {reason} on failure — same
// contract as sendOneOvernightEmail_, so the caller can fold a failure
// into the shared notifyLeadSendFailuresGs_ report.
//
// ledgerCtx (optional, Email Ops EO-1a): { ledger, emailId, dropped: [], isRetry } - where this bucket's ledger row is recorded, and
// the out-list for leads the send-safety gate objected to INDIVIDUALLY (plan decision D3): those are left out and the rest of the
// bucket is sent once more, instead of the whole bucket being blocked for one bad lead. Absent for direct callers (tests).
function sendOneAllIssuesEmail_(ss, logSheet, region, rec, leads, dateLabel, todayKey, now, win, ledgerCtx) {
  if (!leads.length) return null;
  // AI-5 (audit 2026-10-13): the default needs its own `dropped` list - with a bare {} a direct caller whose send the gate
  // objected to lead-by-lead crashed on ctx.dropped.push instead of getting the documented {reason}.
  const ctx = ledgerCtx || { dropped: [] };
  if (!ctx.dropped) ctx.dropped = [];

  const byRM = {};
  leads.forEach(function (l) {
    if (!byRM[l.RM]) byRM[l.RM] = { TL: l.TL, leads: [] };
    byRM[l.RM].leads.push(l);
  });
  const rmKeys = Object.keys(byRM).sort();
  const issueTypeCount = Array.from(new Set(leads.map(function (l) { return l.issueLabel; }))).length;

  const headerOpts = regionHeaderOptsGs_(region, leads);
  const subject = allIssuesSubjectGs_(region, rec, leads, win);
  const bucketNote = ' (' + (rec.primaryRole ? rec.primaryRole + '/' : '') + rec.bucketLabel + ')';
  // What the plain-text part shows (2026-10-17): a consolidated person's real regions (never the pseudo-region key) and no role.
  const shownRole = emailRoleLabelGs_(rec.bucketLabel, rec.primaryRole);
  const plainNote = ' (' + (shownRole ? shownRole + '/' : '') + rec.bucketLabel + ')';
  const plainRegion = String(region || '').indexOf(CONSOLIDATED_REGION_KEY_PREFIX_) === 0 ? headerOpts.region : region;

  const testModeBanner = rec.originalTo ? {
    html: '<div style="background:#fef3c7; border:2px solid #f59e0b; border-radius:8px; padding:12px 16px; margin-bottom:14px; font-family:Arial,Helvetica,sans-serif;">' +
      '<div style="font-weight:700; color:#92400e; font-size:13px;">TEST MODE — real send suppressed</div>' +
      '<div style="color:#78350f; font-size:12.5px; margin-top:4px;">This would really have gone to: <b>' + esc_(rec.originalTo) + '</b>' + (rec.originalCc ? ' (cc: ' + esc_(rec.originalCc) + ')' : ' (no cc)') + '</div></div>',
    plain: 'TEST MODE — real send suppressed. This would really have gone to: ' + rec.originalTo + (rec.originalCc ? ' (cc: ' + rec.originalCc + ')' : ' (no cc)') + '\n\n',
  } : null;

  const makeRmSection_ = function (rm, rmLeads) {
    return {
      heading: rm, subheading: 'Manager: ' + (rmLeads[0].TL || '—'),
      columns: ['Lead ID', 'Issue', 'Status', 'Suggested Follow-up'],
      rows: rmLeads.map(function (l) { return [l.lead_id, l.issueLabel, l.status, l.followup]; }),
    };
  };
  const sections = isMultiRegionKeyGs_(region)
    ? sectionsByRegionGs_(leads, function (r, regionLeads) {
      const byRm = {};
      regionLeads.forEach(function (l) { (byRm[l.RM] = byRm[l.RM] || []).push(l); });
      return Object.keys(byRm).sort().map(function (rm) { return makeRmSection_(rm, byRm[rm]); });
    })
    : rmKeys.map(function (rm) { return makeRmSection_(rm, byRM[rm].leads); });

  const reportOpts = {
    title: 'Leads With Issue',
    region: headerOpts.region,
    regionLabel: headerOpts.regionLabel,
    subtitle: Utilities.formatDate(win.from, 'Asia/Kolkata', 'd MMM, h:mm a') + ' – ' + Utilities.formatDate(win.to, 'Asia/Kolkata', 'd MMM, h:mm a') + ' IST · Google, Non-UTM/Search',
    kpis: [
      { value: leads.length, label: leads.length === 1 ? 'Lead Flagged' : 'Leads Flagged', bg: '#dbeafe', fg: '#2563eb' },
      { value: rmKeys.length, label: rmKeys.length === 1 ? 'RM Affected' : 'RMs Affected', bg: '#e0e7ff', fg: '#4338ca' },
      { value: issueTypeCount, label: issueTypeCount === 1 ? 'Issue Type' : 'Issue Types', bg: '#fef3c7', fg: '#b45309' },
    ],
    action: 'Review and clear these flags — each is one of the 5 Operations SLA checks (Inactive-RM Lead Added, Not Updated, No follow up in last 4 hours, Behind on Today\'s Calls, Stuck 48h+).',
    sections: sections,
    footerNote: 'Scope: Source=google, Sub-source=Non-UTM/Search, leads assigned in the last 3 calendar days (today plus the 2 days before it, IST). Status/flags reflect the CURRENT live sheet as of this run.',
  };
  applyStaleSplitGs_(reportOpts, staleSinceMapGs_(leads)); // stale leads (no update for more than 24 h) are held at the bottom, and the headline count says so
  const html = (testModeBanner ? testModeBanner.html : '') + renderOvernightReportEmailHTML_(reportOpts);
  // Plain-text part = a one-line count summary + the full lead list, rendered from the same opts as the HTML (email audit P2).
  const plainBody = (testModeBanner ? testModeBanner.plain : '') + 'Leads with issue for ' + plainRegion + plainNote + ' (' + dateLabel + '): ' + leads.length +
    ' across ' + rmKeys.length + ' RM(s).\n\n' + plainTextReportGs_(reportOpts);

  Logger.log('All-issues email recipients for ' + region + bucketNote + ': ' + rec.source);
  emailLedgerAttemptGs_(ctx.ledger, ctx.emailId); // a row left ATTEMPTING = the run died mid-send; the outcome is unknown
  let sentMessage;
  try {
    sentMessage = sendGuardedEmailGs_({
      to: rec.to, cc: rec.cc, subject: subject, plainBody: plainBody, htmlBody: html,
      leadIds: leads.map(function (l) { return l.lead_id; }),
    }, 'send all-issues email (' + region + bucketNote + ')');
  } catch (e) {
    Logger.log('All-issues email failed for ' + region + bucketNote + ': ' + e);
    // Per-lead isolation (plan decision D3): when the gate objects to SPECIFIC leads (counted but absent from a body), drop only
    // those and send the rest once more; the dropped leads are reported through ctx.dropped. One retry at most - a second refusal
    // is a bucket-level failure like any other. Never when every lead is objected to (that is a bucket-level problem).
    if (e && e.blockedByGuard && !ctx.isRetry && e.missingLeadIds && e.missingLeadIds.length) {
      const objected = {};
      e.missingLeadIds.forEach(function (id) { objected[String(id).trim()] = true; });
      const remaining = leads.filter(function (l) { return !objected[String(l.lead_id).trim()]; });
      if (remaining.length && remaining.length < leads.length) {
        leads.filter(function (l) { return objected[String(l.lead_id).trim()]; }).forEach(function (l) {
          ctx.dropped.push({ lead: l, reason: 'could not be shown in the email body (the send-safety gate objected to this lead only); the rest of the bucket was sent' });
        });
        return sendOneAllIssuesEmail_(ss, logSheet, region, rec, remaining, dateLabel, todayKey, now, win,
          { ledger: ctx.ledger, emailId: ctx.emailId, dropped: ctx.dropped, isRetry: true });
      }
    }
    // EI-5 (audit 2026-10-13): withSendRetry_ creates a NEW draft on every attempt, so after a failure up to 3 identical drafts
    // may be waiting in Gmail Drafts. The texts below say so - sending more than one of them would duplicate the email.
    const draftsNote = ' There may be up to 3 identical drafts (one per send attempt): send ONE and delete the rest.';
    // Same "operation not allowed" detection sendOneOvernightEmail_ uses —
    // createDraft(...).send() is two steps chained together, and a real
    // production case showed the DRAFT succeeds while the immediately-
    // following .send() throws this specific error (a Workspace-level send
    // restriction, unrelated to either script's own logic). When that
    // happens the draft is left sitting in Drafts, unsent, and a manual
    // Send from the Gmail UI works fine since the block is on script-driven
    // sends specifically — called out explicitly so the alert is
    // immediately actionable instead of just reporting failure.
    const guardBlocked = !!(e && e.blockedByGuard);
    const isSendBlocked = !guardBlocked && /operation not allowed/i.test(String((e && e.message) || e));
    const failureReason = guardBlocked
      ? 'Email BLOCKED by the send-safety gate — nothing was drafted or sent: ' + e.guardProblems.join('; ')
      : isSendBlocked
      ? 'Gmail send blocked ("operation not allowed") — check Gmail Drafts for a message to ' + rec.to + ' with subject "' + subject + '", it was very likely created successfully and just needs a manual Send.' + draftsNote
      : 'Send error: ' + e + ' — check Gmail Drafts too (createDraft() runs before send(), so a draft may already exist).' + draftsNote;
    try {
      notifyOpsAlertGs_('All-issues email FAILED - ' + region + bucketNote, [
        'Region: ' + region + bucketNote,
        'Intended recipient: ' + rec.to + (rec.cc ? (' (cc: ' + rec.cc + ')') : ''),
        'Leads affected (' + leads.length + '): ' + leads.map(function (l) { return l.lead_id; }).join(', '),
        '',
        // AI-4 (audit 2026-10-13): the window is 3 calendar days (allIssuesWindowGs_), not a trailing 48h.
        'These leads got no automated email this run — this script covers leads assigned in the last 3 calendar days (IST), so tomorrow\'s run re-checks them only if they are still flagged and inside that window then.',
        'Once the cause is fixed, run recoverFailedAllIssuesBucketsNow() before ' + ALL_ISSUES_LATE_CUTOFF_HOUR_ + ':' + pad2Gs_(ALL_ISSUES_LATE_CUTOFF_MINUTE_) + ' IST: it re-sends ONLY this bucket (its siblings are not repeated) and re-checks the leads first. After that time nothing is sent late.',
        guardBlocked
          ? 'The send-safety gate refused this payload before any draft was created: ' + e.guardProblems.join('; ') + '. Fix the underlying data (recipient address / content) and run the job by hand.'
          : isSendBlocked
          ? 'This looks like a Gmail SEND restriction, not a code error — check Gmail Drafts for a message to ' + rec.to + ' with subject "' + subject + '"; it was very likely created successfully and just needs a manual Send, which works fine since the block is on script-driven sends specifically.' + draftsNote + ' If this keeps happening, check Google Workspace Admin Console -> Security -> API Controls -> App Access Control for this Apps Script project.'
          // Any OTHER error here still carries the same underlying risk —
          // createDraft() and send() are chained, so this could be a
          // genuine failure before any draft existed, OR the draft could
          // have been created with only send() failing (same situation as
          // the branch above, just a different error text — real
          // production case: "Exception: Not found" from this exact
          // chain, no restriction keyword to key off of).
          : 'Error: ' + e + '. Check Gmail Drafts for a message to ' + rec.to + ' with subject "' + subject + '" before assuming nothing was created — createDraft() succeeding while the chained send() fails looks exactly like this from here.' + draftsNote,
      ]);
    } catch (alertErr) {
      Logger.log('notifyOpsAlertGs_ itself failed: ' + alertErr);
    }
    const errStatus = emailLedgerStatusForErrorGs_(e);
    // 2026-10-16 (O3): an UNCONFIRMED email may have been delivered - its row keeps the leads it carried (FAILED/BLOCKED rows still record none).
    emailLedgerResultGs_(ctx.ledger, ctx.emailId, { status: errStatus, reason: failureReason, leadIds: errStatus === EMAIL_LEDGER_STATUS_.UNCONFIRMED ? leads.map(function (l) { return String(l.lead_id); }) : [] });
    return { reason: failureReason };
  }

  // ACCEPTED = Gmail took the message. Recorded BEFORE the AllIssues_Log write below so a failure there cannot lose the evidence.
  const sentIds = emailLedgerSentIdsGs_(sentMessage);
  emailLedgerResultGs_(ctx.ledger, ctx.emailId, {
    status: EMAIL_LEDGER_STATUS_.ACCEPTED, messageId: sentIds.messageId, threadId: sentIds.threadId,
    leadIds: leads.map(function (l) { return String(l.lead_id); }),
  });

  try {
    const threadId = sentMessage ? sentMessage.getThread().getId() : '';
    // issue_snapshot_json (col J, two-checkpoint email lifecycle redesign,
    // docs/_planning/EMAIL_LIFECYCLE_TWO_CHECKPOINT_REDESIGN.md Part 5/8) --
    // `leads` here IS the bucket's exact reported population, already in
    // the {lead_id, RM, TL, status, issueLabel, followup} shape the design
    // calls for (see byRegion's construction above) -- no re-derivation,
    // just persisting what this email already sent. Serialized through
    // jsonForCellGs_ (EmailInfra.gs), which keeps the cell under Sheets'
    // 50,000-character limit and alerts ops if it had to truncate (AI-7,
    // 2026-10-13: this comment still described the older unguarded
    // JSON.stringify). Columns K-N (checkpoint1/2) are left blank -- written
    // later by the 10:00/13:00 jobs (Steps 4-7).
    // Once-only append (email audit P7 / F10) — see appendRowOnceGs_; thread id (col I) is the row's identity.
    writeUnlessTestModeGs_(appendRowOnceGs_(logSheet, [now, region, rec.bucketLabel, rec.primaryRole, rec.to, rec.cc || '', leads.length, new Date(), threadId, jsonForCellGs_(leads, 'issue_snapshot_json (' + region + bucketNote + ')')], 8),
      'append AllIssues_Log row (' + region + bucketNote + ')');
  } catch (e) {
    Logger.log('AllIssues_Log write failed for ' + region + bucketNote + ' (email itself sent fine): ' + e);
  }

  return null;
}

function sendAllIssuesEmailsNow() { sendAllIssuesEmails(); }

// ---- Recovery of failed 17:00 buckets (Email Ops EO-9, plan decisions D3/D5, spec rules 4 and 6) ----
// Why this exists: when ONE bucket of a region fails and its siblings succeed, a plain re-run of the job skips the whole region (the "already sent today"
// guard), so the failed bucket could never be re-sent the same day. This re-sends exactly the buckets the ledger shows as FAILED or BLOCKED today - never
// UNCONFIRMED (it may have been delivered; a second copy is a duplicate), never an ACCEPTED one - after re-checking everything from the current data, and
// only until the late-send cutoff (18:30 IST); after that nothing is sent late. A bucket whose leads were resolved meanwhile is closed as SKIPPED with the reason.
const EMAIL_RECOVERY_JOB_ = 'recoverAllIssuesBuckets';

// Today's recoverable 17:00 buckets from the ledger: [{ emailId, region, bucket, status }] (the shared reader is EmailLedger.gs's).
function allIssuesRecoveryTargetsGs_(ss, now) {
  return emailLedgerRecoveryTargetsGs_(ss, now, EMAIL_LEDGER_JOB_ALL_ISSUES_);
}

function allIssuesLateCutoffPassedGs_(now) {
  return emailLateCutoffPassedGs_(now, ALL_ISSUES_LATE_CUTOFF_HOUR_, ALL_ISSUES_LATE_CUTOFF_MINUTE_);
}

// opts.now (tests), opts.force (past the cutoff on purpose). Returns { targets, cutoff, ran }.
function recoverFailedAllIssuesBuckets_(opts) {
  return emailRecoverBucketsGs_({
    job: EMAIL_LEDGER_JOB_ALL_ISSUES_, label: '17:00', cutoffHour: ALL_ISSUES_LATE_CUTOFF_HOUR_, cutoffMinute: ALL_ISSUES_LATE_CUTOFF_MINUTE_,
    forceName: 'recoverFailedAllIssuesBucketsForceNow', run: function (ids) { sendAllIssuesEmails_({ onlyEmailIds: ids }); },
  }, opts);
}

function recoverFailedAllIssuesBucketsNow() {
  withEmailJobLockGs_(EMAIL_RECOVERY_JOB_, function () { recoverFailedAllIssuesBuckets_({}); });
}

function recoverFailedAllIssuesBucketsForceNow() {
  withEmailJobLockGs_(EMAIL_RECOVERY_JOB_, function () { recoverFailedAllIssuesBuckets_({ force: true }); });
}

// One-time setup — installs a single daily trigger at ALL_ISSUES_RUN_HOUR_
// IST. Safe to re-run: clears any trigger this function previously
// installed for sendAllIssuesEmails before adding the new one, so
// changing ALL_ISSUES_RUN_HOUR_ and re-running never leaves a duplicate.
//
// .nearMinute(0) added 2026-09-02: this was the ONLY fixed-hour trigger in
// the whole project without a pinned minute (sendOvernightMorningEmails/
// sendOvernightFollowupEmails use .nearMinute(0), captureDailyRmIssues uses
// .nearMinute(50) — see their own setup functions). Without it, Apps
// Script only promises firing SOMEWHERE inside the target hour — this
// project's own MovementTracker.gs header already documents atHour()
// alone as landing "within roughly 15 minutes" under normal load, but a
// real run fired 54 minutes late (17:54 instead of ~17:00), which is what
// actually produced the "process takes 50-58 minutes" symptom — the
// SCRIPT itself only took ~4 minutes end to end that same run (see its
// own [timing] Logger.log lines). nearMinute() doesn't guarantee exact-
// minute firing either, but it's the same lever already proven to keep
// this project's other daily email trigger close to its target.
//
// IMPORTANT: editing this function's source does NOT retroactively change
// the trigger already installed in this Apps Script project — a trigger's
// schedule is fixed at the moment it's created. This function must be
// RE-RUN (function dropdown -> setupAllIssuesEmailTrigger -> Run) after
// deploying this change, so the old (unpinned) trigger gets deleted and
// the new (nearMinute-pinned) one takes its place.
function setupAllIssuesEmailTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'sendAllIssuesEmails') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('sendAllIssuesEmails')
    .timeBased()
    .atHour(ALL_ISSUES_RUN_HOUR_)
    .nearMinute(0)
    .everyDays(1)
    .inTimezone('Asia/Kolkata')
    .create();
  Logger.log('All-Issues Emailer trigger installed — runs daily near ' + ALL_ISSUES_RUN_HOUR_ + ':00 IST.');
}

// ==================== One-off: remove the 2026-09-24 TEST MODE rows ====================
// Remediation (2026-09-26, "remove test rows"): a TEST MODE run at 10:16 IST on 2026-09-24 wrote 28 real-looking rows
// (recipient = the tester) into AllIssues_Log before writeUnlessTestModeGs_ existed. They made the real 17:00 job skip
// every region that day and later sent Checkpoint 1 to the tester instead of managers (HANDOVER.md section 8).
//
// Touches NOTHING unless every guard holds: the header is as expected; the matching rows (date inside the window AND
// recipient = the tester) form ONE contiguous block; and there are exactly the expected number of them. The rows are
// archived to a Drive CSV and the archive is checked BEFORE anything is deleted. Not wired to any trigger; safe to
// re-run (a second run finds nothing and does nothing). Precedent: removeDedupIncidentRowsNow (MovementTracker.gs).
const TEST_MODE_ROWS_FROM_ = new Date('2026-09-24T10:00:00+05:30');
const TEST_MODE_ROWS_TO_ = new Date('2026-09-24T10:30:00+05:30');
// The tester whose test-mode rows are removed: the ops address (looked up from the private employee table at run time — email audit P13).
function testModeRowsRecipientGs_() { return opsAlertEmailGs_(); }
const TEST_MODE_ROWS_EXPECTED_ = 28;
function removeTestModeAllIssuesRowsNow() {
  removeAllIssuesLogRowsInWindowGs_(SpreadsheetApp.getActiveSpreadsheet(), TEST_MODE_ROWS_FROM_, TEST_MODE_ROWS_TO_, testModeRowsRecipientGs_(), TEST_MODE_ROWS_EXPECTED_);
}

function removeAllIssuesLogRowsInWindowGs_(ss, from, to, recipient, expectedCount) {
  const sheet = ss.getSheetByName(ALL_ISSUES_LOG_SHEET_);
  if (!sheet) throw new Error(ALL_ISSUES_LOG_SHEET_ + ' sheet not found.');
  const lastCol = sheet.getLastColumn();
  const header = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  if (String(header[0]).trim() !== 'date' || String(header[4]).trim() !== 'to') {
    throw new Error(ALL_ISSUES_LOG_SHEET_ + ' header is not as expected (col A "date", col E "to") - refusing to delete anything.');
  }
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) { Logger.log(ALL_ISSUES_LOG_SHEET_ + ' has no data rows - nothing to remove.'); return; }

  const keys = sheet.getRange(2, 1, lastRow - 1, 5).getValues();
  const wanted = String(recipient).trim().toLowerCase();
  let first = -1, last = -1, count = 0;
  keys.forEach(function (r, i) {
    const when = r[0];
    if (when instanceof Date && when >= from && when <= to && String(r[4]).trim().toLowerCase() === wanted) {
      if (first < 0) first = i;
      last = i;
      count++;
    }
  });
  if (!count) { Logger.log('No ' + ALL_ISSUES_LOG_SHEET_ + ' rows match the test-mode window - nothing to remove (already done?).'); return; }
  if (last - first + 1 !== count) {
    throw new Error('Matching rows are not one contiguous block (' + count + ' rows spread over ' + (last - first + 1) + ' positions) - refusing to delete anything.');
  }
  if (count !== expectedCount) {
    throw new Error('Found ' + count + ' matching rows but expected ' + expectedCount + ' - refusing to delete anything.');
  }

  const startRow = first + 2; // keys[] starts at sheet row 2
  const rows = sheet.getRange(startRow, 1, count, lastCol).getValues();
  const file = archiveRowsToDriveCsv_(ALL_ISSUES_LOG_SHEET_, header, rows, 'test_mode_2026-09-24');
  if (!file) throw new Error('Drive archive was not created - refusing to delete.');
  // Every data row starts with its date rendered as an ISO timestamp (see archiveRowsToDriveCsv_'s csvEscape).
  const archived = (file.getBlob().getDataAsString().match(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z,/gm) || []).length;
  if (archived !== count) {
    throw new Error('Drive archive holds ' + archived + ' data rows but ' + count + ' were expected - refusing to delete. Archive: ' + file.getUrl());
  }

  sheet.deleteRows(startRow, count);
  Logger.log('Removed ' + count + ' ' + ALL_ISSUES_LOG_SHEET_ + ' rows (sheet rows ' + startRow + '-' + (startRow + count - 1) + '), archived first to ' + file.getUrl() + '. ' + ALL_ISSUES_LOG_SHEET_ + ' now has ' + (sheet.getLastRow() - 1) + ' data rows.');
}
