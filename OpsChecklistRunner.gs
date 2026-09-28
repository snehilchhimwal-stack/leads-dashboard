/**
 * Ops Checklist Runner — CHECKLIST-006 (2026-09-09): wires
 * OPS_CHECKLIST.md's periodic-operational tier into an actual unattended
 * signal, instead of relying on someone remembering to run 3 separate
 * console functions by hand every week. See OPS_CHECKLIST.md for the full
 * checklist this is one piece of (pre-change / post-deploy tiers stay
 * manual — nothing here covers those).
 *
 * DESIGN DECISION — sends a summary EVERY week, not only when something's
 * flagged: an only-alert-when-something's-wrong design makes a silently
 * broken or deleted trigger look IDENTICAL to "everything's fine" — the
 * exact class of silent-failure risk this whole checklist project exists
 * to catch (see LEADFOLLOWUPS-00x, To-Do Dashboard, for the same
 * reasoning applied to Lead_Followups snapshot staleness specifically). A
 * missing weekly email is itself the alarm for "this stopped running."
 *
 * SCOPE — the 4 checks that reduce to a clean pass/fail an unattended
 * script can judge on its own: auditUnresolvedRms_ (RmHierarchy.gs),
 * auditManagerDirectoryEmailGaps_ (RmHierarchy.gs),
 * checkMovementLogFreshness_ (MovementTracker.gs), and (added 2026-09-28,
 * HANDOVER.md section 9.2/9.3's "not fixed here" item — the workbook hit
 * its 10M-cell ceiling for real 3 times, 09-06/09-19/09-24)
 * computeWorkbookCellUsageGs_ (Core.gs). reportRmPerformanceNow()
 * (a full leaderboard, not a boolean) and the RM_PERF_* constant-parity
 * check (can't be done live — Apps Script can't read a .js file) stay
 * manual, per OPS_CHECKLIST.md — the email ends with a plain-text
 * reminder to run both by hand.
 *
 * ============================== SETUP (one-time) ==============================
 *   1. Same Apps Script project as every other file this project needs —
 *      see Core.gs's own header for the full list.
 *   2. In the function dropdown, select setupWeeklyOpsChecklistTrigger,
 *      click Run, approve permissions. Installs one weekly trigger
 *      (Monday, ~9am IST).
 *   3. To send a test run immediately without waiting for the trigger,
 *      run runWeeklyOpsChecklistNow from the function dropdown — it
 *      always sends to OPS_ALERT_EMAIL_ (EmailInfra.gs), same as every
 *      other ops-only alert in this project.
 * ================================================================================
 */

// Pure(ish) — reads RM_Hierarchy, Manager_Directory, and Movement_Log,
// writes nothing. Returns { issueCount, lines } so the caller (the real
// email-sending function below, or a test) can inspect the summary
// without needing to parse Logger output.
function buildWeeklyOpsChecklistSummary_(ss, now) {
  const lines = [];
  let issueCount = 0;

  const unresolvedRms = withRetry_(function () { return auditUnresolvedRms_(ss); }, 'buildWeeklyOpsChecklistSummary_: auditUnresolvedRms_');
  if (unresolvedRms.length) {
    issueCount += unresolvedRms.length;
    lines.push(unresolvedRms.length + ' RM name(s) do not resolve in RM_Hierarchy (run auditUnresolvedRmsNow for full detail):');
    unresolvedRms.slice(0, 10).forEach(function (r) { lines.push('  - ' + r.name + ' (' + r.count + ' open lead(s))'); });
    if (unresolvedRms.length > 10) lines.push('  ...+' + (unresolvedRms.length - 10) + ' more');
  } else {
    lines.push('RM hierarchy: every open lead\'s RM resolves fine. No gaps.');
  }

  const managerGaps = auditManagerDirectoryEmailGaps_(ss);
  if (managerGaps === null) {
    issueCount++;
    lines.push('Manager_Directory: sheet not found — run setupRmHierarchy.');
  } else if (managerGaps.length) {
    issueCount += managerGaps.length;
    lines.push(managerGaps.length + ' manager(s) have real reports but no email in Manager_Directory (run auditManagerDirectoryEmailGapsNow for full detail):');
    managerGaps.slice(0, 10).forEach(function (g) { lines.push('  - ' + g.name + ' (' + g.reportCount + ' report(s))'); });
    if (managerGaps.length > 10) lines.push('  ...+' + (managerGaps.length - 10) + ' more');
  } else {
    lines.push('Manager_Directory: every manager with real reports has an email on file. No gaps.');
  }

  const freshness = checkMovementLogFreshness_(ss, now);
  if (freshness.status === 'fresh') {
    lines.push('Movement_Log: fresh — last capture ' + freshness.ageHours.toFixed(1) + 'h ago.');
  } else if (freshness.status === 'stale') {
    issueCount++;
    lines.push('Movement_Log: STALE — last capture ' + freshness.ageHours.toFixed(1) + 'h ago. Check Triggers (clock icon) for a paused/deleted snapshotPeriodic (run checkMovementLogFreshnessNow for full detail).');
  } else {
    issueCount++;
    lines.push('Movement_Log: ' + freshness.status + ' — run checkMovementLogFreshnessNow for full detail.');
  }

  // Cell-budget check (Core.gs) — the workbook's shared 10M-cell ceiling,
  // summed across every tab's DECLARED grid, not just Movement_Log/
  // Daily_RM_Issues' own retention windows. WARN/CRITICAL thresholds are
  // percentages of the ceiling (WORKBOOK_CELL_ALERT_WARN_PCT_/
  // WORKBOOK_CELL_ALERT_CRITICAL_PCT_), not an absolute row count, since
  // the mix of tabs and their per-row width both drift over time. Always
  // names the top 3 tabs by cell count — Movement_Log/Daily_RM_Issues have
  // their own scheduled prune, but a CRITICAL reading means their normal
  // 7-day cadence hasn't kept up (same "an after-write prune can't
  // self-heal" trap as the 09-24 incident) and pruneMovementLogNow() /
  // pruneDailyRmIssueLogNow() need running by hand now, not next capture.
  const cellUsage = computeWorkbookCellUsageGs_(ss);
  const cellPct = (cellUsage.pctUsed * 100).toFixed(1) + '%';
  const topTabsLine = cellUsage.sheets.slice(0, 3).map(function (s) { return s.name + ' (' + fmtCellsGs_(s.cells) + ')'; }).join(', ');
  if (cellUsage.pctUsed >= WORKBOOK_CELL_ALERT_CRITICAL_PCT_) {
    issueCount++;
    lines.push('CELL BUDGET CRITICAL: ' + fmtCellsGs_(cellUsage.totalCells) + ' / ' + fmtCellsGs_(cellUsage.ceiling) + ' cells (' + cellPct +
      ') — a capture WILL crash soon (HANDOVER.md section 9.2/9.3). Run pruneMovementLogNow() / pruneDailyRmIssueLogNow() now. Largest tabs: ' + topTabsLine + '.');
  } else if (cellUsage.pctUsed >= WORKBOOK_CELL_ALERT_WARN_PCT_) {
    issueCount++;
    lines.push('Cell budget WARNING: ' + fmtCellsGs_(cellUsage.totalCells) + ' / ' + fmtCellsGs_(cellUsage.ceiling) + ' cells (' + cellPct +
      '). Largest tabs: ' + topTabsLine + '. Not urgent yet — worth a look before it is (run reportWorkbookCellUsageNow() for the full breakdown).');
  } else {
    lines.push('Cell budget: healthy — ' + fmtCellsGs_(cellUsage.totalCells) + ' / ' + fmtCellsGs_(cellUsage.ceiling) + ' cells (' + cellPct + '). Largest: ' + topTabsLine + '.');
  }

  lines.push('');
  lines.push('Not automated — run by hand this week: reportRmPerformanceNow() (DailyRmIssueLog.gs, diff its ranking against the live dashboard\'s People -> RM Performance table) and the RM_PERF_* constant-parity grep-diff (see OPS_CHECKLIST.md, "Worst-performing-RM identification").');

  return { issueCount: issueCount, lines: lines };
}

/**
 * The real run — builds the summary above and sends ONE plain-text email
 * to OPS_ALERT_EMAIL_, every week, regardless of issueCount (see this
 * file's own header for why "always send" is deliberate). Wrapped in
 * try/catch and re-thrown so a failed send still shows up in Executions
 * as Failed, not silently green — same discipline sendAllIssuesEmails
 * (AllIssuesEmailer.gs) uses for its own top-level wrapper.
 *
 * Takes `now` as an explicit parameter (same split as
 * checkMovementLogFreshness_/checkMovementLogFreshnessNow,
 * MovementTracker.gs) specifically so a test can pin it — 2026-09-09
 * incident: the original single `runWeeklyOpsChecklistNow()` (no `now`
 * param) always called `new Date()` internally, so a test built around a
 * "clean, nothing flagged" spreadsheet fixture with a Movement_Log row
 * seeded a fixed few hours before a FIXED anchor date silently turned
 * into a time bomb — it read as "fresh" only while the CI runner's real
 * wall-clock time happened to still be within MOVEMENT_LOG_FRESHNESS_GRACE_HOURS_
 * of that fixed anchor, then started failing for real (not flaking —
 * failing on every run) once enough real time had passed, with zero
 * production code change. Splitting the real logic out so the test can
 * pass the SAME fixed `now` it seeded the fixture with removes the real
 * clock from the test entirely; runWeeklyOpsChecklistNow() below (the
 * actual trigger target) still uses the real `new Date()`, unaffected.
 */
function runWeeklyOpsChecklist_(ss, now) {
  const summary = buildWeeklyOpsChecklistSummary_(ss, now);

  const subject = '[Ops Checklist] ' + (summary.issueCount ? summary.issueCount + ' item(s) to review' : 'all clear') +
    ' — ' + Utilities.formatDate(now, 'Asia/Kolkata', 'd MMM yyyy');
  try {
    withSendRetry_(function () {
      GmailApp.sendEmail(OPS_ALERT_EMAIL_, subject, summary.lines.join('\n'));
    }, 'runWeeklyOpsChecklistNow: send weekly summary');
  } catch (e) {
    Logger.log('runWeeklyOpsChecklistNow failed to send its summary email: ' + e);
    throw e;
  }
  Logger.log('Weekly Ops Checklist sent — ' + summary.issueCount + ' item(s) flagged.');
}

// Trigger target / console-callable wrapper — real spreadsheet, real
// current time. All the actual logic lives in runWeeklyOpsChecklist_
// above so a test can pin `now` instead of racing the real clock.
function runWeeklyOpsChecklistNow() {
  runWeeklyOpsChecklist_(SpreadsheetApp.getActiveSpreadsheet(), new Date());
}

// One-time setup — installs a single weekly trigger, Monday ~9am IST
// (before the work week's own automated emails start mattering for the
// day). .nearMinute(0) pinned from the start — see AllIssuesEmailer.gs's
// setupAllIssuesEmailTrigger for why an unpinned atHour() trigger is
// worth avoiding from day one, not fixed after the fact. Safe to re-run:
// clears any trigger this function previously installed before adding
// the new one.
function setupWeeklyOpsChecklistTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'runWeeklyOpsChecklistNow') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('runWeeklyOpsChecklistNow')
    .timeBased()
    .onWeekDay(ScriptApp.WeekDay.MONDAY)
    .atHour(9)
    .nearMinute(0)
    .inTimezone('Asia/Kolkata')
    .create();
  Logger.log('Weekly Ops Checklist trigger installed — runs every Monday near 9:00 IST.');
}
