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
 * SCOPE — the 5 checks that reduce to a clean pass/fail an unattended
 * script can judge on its own: auditUnresolvedRms_ (RmHierarchy.gs),
 * auditManagerDirectoryEmailGaps_ (RmHierarchy.gs),
 * checkMovementLogFreshness_ (MovementTracker.gs), (added 2026-09-28,
 * HANDOVER.md section 9.2/9.3's "not fixed here" item — the workbook hit
 * its 10M-cell ceiling for real 3 times, 09-06/09-19/09-24)
 * computeWorkbookCellUsageGs_ (Core.gs), and (added 2026-10-03, Part 4 of
 * the dead-code-audit follow-up, docs/_planning/DEAD_CODE_AUDIT_2026-10-03.md)
 * checkStaleComponents_, below — reads Feature_Usage (SHEET-018, written
 * by js/sheets-writeback.js's client-side usage tracking, Part 3 of the
 * same follow-up) and flags any of the 9 tracked dashboard tabs that
 * haven't been used in 30+ days. reportRmPerformanceNow()
 * (a full leaderboard, not a boolean) and the RM_PERF_* constant-parity
 * check (can't be done live — Apps Script can't read a .js file) stay
 * manual, per OPS_CHECKLIST.md — the email ends with a plain-text
 * reminder to run both by hand.
 *
 * ROLLOUT NOTE (Part 4) — right after Feature_Usage first starts
 * accumulating rows, every tracked tab reads as "never recorded as used
 * yet," not "stale." That's expected, not a bug: there's no 30 days of
 * history to judge yet. checkStaleComponents_ only promotes a
 * never-observed tab into a real flagged issue once
 * FEATURE_USAGE_TRACKING_STARTED_GS_ itself is more than
 * STALE_COMPONENT_DAYS_GS_ days in the past — see that function's own
 * comment for why. A future reader who sees "9 tab(s) never used" in the
 * first weekly email after shipping this should NOT read that as the
 * checker being broken.
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

// ===== Part 4 (2026-10-03) — 30-day stale-component checker =====
// Reads Feature_Usage (SHEET-018, js/sheets-writeback.js) — the
// client-side usage-tracking tab Part 3 of the 2026-10-03 dead-code-audit
// follow-up added. TRACKED_COMPONENT_IDS_GS_ is a byte-for-byte mirror of
// js/sheets-writeback.js's own TRACKED_COMPONENT_IDS — kept in sync by
// hand, same "duplicated across runtimes on purpose" discipline CLAUDE.md
// already documents for every other duplicated pair in this project. If a
// component is ever added/removed on the browser side, update this list
// too, in the same commit.
const FEATURE_USAGE_SHEET_GS_ = 'Feature_Usage';
const TRACKED_COMPONENT_IDS_GS_ = [
  'tab-morning', 'tab-overview', 'tab-operations', 'tab-repeatoffenders',
  'tab-people', 'tab-audit', 'tab-movement', 'tab-tracking', 'tab-oppmonitor',
];
const STALE_COMPONENT_DAYS_GS_ = 30;

// The date Feature_Usage started accumulating real rows (SHEET-018's own
// "Version / change reference" date). Used ONLY to decide whether a
// component with NO row at all is "too early to judge" or "has had a full
// 30-day window with zero recorded use" — see checkStaleComponents_ below.
// Months are 0-indexed in the JS Date constructor: 9 = October.
const FEATURE_USAGE_TRACKING_STARTED_GS_ = new Date(2026, 9, 3);

// Parses a cell written by js/sheets-writeback.js's istDateTimeValue — a
// literal 'YYYY-MM-DD HH:mm:ss' string, written RAW over the Sheets REST
// API, which (unlike an Apps Script setValue() of a date-shaped string —
// see parseIstDayKeyOrDateGs_'s own comment, Core.gs, for THAT gotcha) is
// NOT auto-coerced into a date serial. Handles both shapes the cell can
// still come back as: a real Date (if a human ever hand-edits the cell in
// the Sheets UI, which does trigger normal auto-parsing), or the original
// literal string. Returns null for anything unparseable.
function parseFeatureUsageTimestampGs_(cell) {
  if (cell instanceof Date) return cell;
  const s = String(cell || '').trim();
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/.exec(s);
  if (!m) return null;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]), Number(m[6]));
}

// Pure(ish) — reads Feature_Usage, writes nothing. Buckets every tracked
// component into stale (>= STALE_COMPONENT_DAYS_GS_ days since last
// recorded use, OR never recorded at all once tracking itself has run
// that long) / neverObserved (no row yet, but tracking hasn't had a full
// window to judge that absence) / recent. neverObserved and "stale because
// never used" are kept visually distinct in the email (see
// buildWeeklyOpsChecklistSummary_'s call site) — "too early to tell" and
// "had 30 days to show up and didn't" are different findings, and
// collapsing them would either spam the very first weekly email after
// rollout or permanently hide a genuinely-unused tab behind "still early."
function checkStaleComponents_(ss, now) {
  const nowMs = (now || new Date()).getTime();
  const trackingAgeDays = (nowMs - FEATURE_USAGE_TRACKING_STARTED_GS_.getTime()) / 86400000;
  const neverObservedIsStale = trackingAgeDays > STALE_COMPONENT_DAYS_GS_;

  const sheet = ss.getSheetByName(FEATURE_USAGE_SHEET_GS_);
  const lastRow = sheet ? sheet.getLastRow() : 0;
  if (!sheet || lastRow < 2) {
    const never = TRACKED_COMPONENT_IDS_GS_.slice();
    return {
      status: sheet ? 'empty' : 'missing',
      stale: neverObservedIsStale ? never.map(function (id) { return { id: id, neverUsed: true }; }) : [],
      neverObserved: neverObservedIsStale ? [] : never,
      recent: [],
    };
  }

  const values = withRetry_(function () { return sheet.getRange(2, 1, lastRow - 1, 4).getValues(); }, 'checkStaleComponents_: read Feature_Usage rows');
  const byComponent = {};
  values.forEach(function (r) {
    const id = String(r[0] || '').trim();
    if (id) byComponent[id] = { lastUsedAt: parseFeatureUsageTimestampGs_(r[1]), useCount: r[2] };
  });

  const neverObserved = [], stale = [], recent = [];
  TRACKED_COMPONENT_IDS_GS_.forEach(function (id) {
    const row = byComponent[id];
    if (!row || !row.lastUsedAt) {
      if (neverObservedIsStale) stale.push({ id: id, neverUsed: true });
      else neverObserved.push(id);
      return;
    }
    const ageDays = (nowMs - row.lastUsedAt.getTime()) / 86400000;
    if (ageDays > STALE_COMPONENT_DAYS_GS_) {
      stale.push({ id: id, ageDays: ageDays, useCount: row.useCount });
    } else {
      recent.push({ id: id, ageDays: ageDays });
    }
  });

  return { status: 'ok', neverObserved: neverObserved, stale: stale, recent: recent };
}

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

  // Stale-component check (Part 4, 2026-10-03) — see checkStaleComponents_'s
  // own header for the neverObserved vs. stale distinction and the
  // rollout-grace reasoning.
  const componentUsage = checkStaleComponents_(ss, now);
  if (componentUsage.status === 'missing') {
    lines.push('Feature usage tracking: Feature_Usage sheet not found yet — it is created on first use by the dashboard\'s recordComponentUsage (js/sheets-writeback.js). Nothing to report until someone signs in and uses a tracked tab.');
  } else {
    if (componentUsage.stale.length) {
      issueCount += componentUsage.stale.length;
      lines.push(componentUsage.stale.length + ' dashboard tab(s) not used in ' + STALE_COMPONENT_DAYS_GS_ + '+ days (run check-staleness on this before assuming the feature is dead — see docs/_planning/DEAD_CODE_AUDIT_2026-10-03.md):');
      componentUsage.stale.forEach(function (c) {
        lines.push('  - ' + c.id + (c.neverUsed ? ' (never recorded as used — Feature_Usage has had a full ' + STALE_COMPONENT_DAYS_GS_ + '-day window)' : ' (' + c.ageDays.toFixed(0) + 'd ago, used ' + c.useCount + ' time(s) total)'));
      });
    }
    if (componentUsage.neverObserved.length) {
      lines.push(componentUsage.neverObserved.length + ' dashboard tab(s) never recorded as used yet: ' + componentUsage.neverObserved.join(', ') + ' — expected for a while right after Feature_Usage tracking started; worth a look if it persists past ' + STALE_COMPONENT_DAYS_GS_ + ' days.');
    }
    if (!componentUsage.stale.length && !componentUsage.neverObserved.length) {
      lines.push('Feature usage: all ' + TRACKED_COMPONENT_IDS_GS_.length + ' tracked tab(s) used within the last ' + STALE_COMPONENT_DAYS_GS_ + ' days.');
    }
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
      GmailApp.sendEmail(opsAlertEmailGs_(), subject, summary.lines.join('\n'));
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
