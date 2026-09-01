/**
 * Email Infra — shared, cross-script email-sending infrastructure: retry
 * wrappers, the leads-tab reader, region-name mapping, ops alerting, and
 * the shared HTML report template. Used by OvernightEmailer.gs's own send
 * path AND by AllIssuesEmailer.gs, which calls essentially all of this
 * directly (readLeadsTab_, withRetry_/withSendRetry_, notifyOpsAlertGs_,
 * notifyLeadSendFailuresGs_, mainRegionForGs_, renderOvernightReportEmailHTML_).
 *
 * Split out of OvernightEmailer.gs (2026-08-28) as part of a full
 * compartmentalization pass — this was genuinely shared infrastructure
 * living in a file named for one specific script, which is what made it
 * easy to miss that AllIssuesEmailer.gs depended on nearly all of it.
 * Function/const names were NOT renamed as part of this move (several
 * still carry "Overnight"-flavored names, e.g. renderOvernightReportEmailHTML_ —
 * a rename is a separate, riskier change requiring every call site to be
 * found and updated) — only their FILE changed. Moving code between .gs
 * files in the SAME Apps Script project has no functional effect (one
 * shared namespace across every file in a project).
 *
 * Depends on Core.gs (esc_, resolveTabName_, buildColIndex_) and
 * RmHierarchy.gs (resolveRecipientBucketsForRms_, ALWAYS_CC_EMAILS_) —
 * load order between files doesn't matter to Apps Script.
 *
 * ============================== SETUP ==============================
 * Paste this in as its own file, alongside every other file in this
 * project. See Core.gs's own setup note for the full file list.
 * ================================================================================
 */

// TEMPORARY TEST OVERRIDE — leave '' for real sends. Set to a single email
// address (e.g. 'snehil.chhimwal@homesfy.in') to redirect EVERY resolved
// To/Cc on EVERY email this project sends — real recipients, RM_Hierarchy
// or Region_Recipients fallback alike, and even the always-cc leadership
// addresses — to just that one address, so a manual test run can never
// reach a real TL/RH/CH by accident. Applied in
// resolveRecipientEmailsForRegion_ below, the single choke point every
// send path already goes through (both OvernightEmailer.gs's own sends
// and AllIssuesEmailer.gs's). Blank this out again before trusting the
// daily triggers — while it's set, the real automation is effectively
// disabled. `let`, not `const` — Tests_Mocks.gs reassigns this (and
// restores it) for the duration of a test run so tests never need this
// file hand-edited; nothing in real production code ever reassigns it.
let TEST_MODE_OVERRIDE_EMAIL_ = '';

const REGION_RECIPIENTS_SHEET_ = 'Region_Recipients';

// Where to alert when a script could NOT get an automated email out at
// all for some region/RM — no resolvable recipient, the send itself
// failed after retries, or a chain resolved all the way to a CH. These
// failures are otherwise invisible outside the Apps Script Executions
// log, which nobody watches proactively. `let`, not `const` — same
// test-overridability reason as TEST_MODE_OVERRIDE_EMAIL_ above;
// Tests_Mocks.gs reassigns this for the duration of a test run and
// restores it afterward. Never reassigned by real production code.
let OPS_ALERT_EMAIL_ = 'snehil.chhimwal@homesfy.in';

// Second recipient specifically for CH-level reports (OvernightEmailer.gs's
// notifyChLevelLeadsGs_, AllIssuesEmailer.gs's notifyChLevelIssuesGs_) —
// leads held directly by the CEO or a Cluster Head/City Lead, with nobody
// below them to route through automatically, go to OPS_ALERT_EMAIL_ AND
// this address. Deliberately separate from ALWAYS_CC_EMAILS_
// (RmHierarchy.gs) — that Cc applies to every normal per-RM email; this
// is scoped to CH-level reports only. `let`, same test-overridability
// reason as OPS_ALERT_EMAIL_ above.
let CH_LEVEL_EMAIL_ = 'ashish.ivlekar@homesfy.in';

// Best-effort alert for a send that could not happen at all this run —
// wrapped in its own try/catch so a failure to send the ALERT itself can
// never take down the real run it's reporting on. Kept deliberately
// plain-text/no-frills — this is an ops ping, not a report. Always to
// OPS_ALERT_EMAIL_ only, no Cc.
function notifyOpsAlertGs_(subject, bodyLines) {
  try {
    GmailApp.sendEmail(OPS_ALERT_EMAIL_, '[Overnight Emailer] ' + subject, bodyLines.join('\n'));
  } catch (e) {
    Logger.log('notifyOpsAlertGs_ failed to send its own alert ("' + subject + '"): ' + e);
  }
}

// ONE consolidated report, across every region in a run, naming every
// LEAD (not just region/RM) that got no automated email at all — either
// its RM had no resolvable recipient anywhere (not in RM_Hierarchy,
// excluded, no manager email — and no Region_Recipients fallback either)
// or its bucket's real send failed after retries. Per explicit request:
// one row per lead with the RM, the computed To/Cc chain (blank when
// there genuinely was none to compute), and the specific reason. Sent to
// OPS_ALERT_EMAIL_ only — this is a diagnostic audit trail, not a report
// anyone else needs to see. Entries is [{lead_id, RM, to, cc, reason}].
// Called once, at the end of a run, rather than per-region — one
// complete picture of everything that didn't go out, instead of several
// small alerts scattered across the run. Reused directly by
// AllIssuesEmailer.gs — no separate copy needed just because the run
// that produced the entries is different.
function notifyLeadSendFailuresGs_(entries) {
  if (!entries.length) return;
  const dateLabel = Utilities.formatDate(new Date(), 'Asia/Kolkata', 'd MMM yyyy');
  const subject = 'Leads NOT sent (' + entries.length + ') - ' + dateLabel;
  const html = renderOvernightReportEmailHTML_({
    title: 'Leads Not Sent',
    region: 'All regions',
    subtitle: entries.length + ' lead(s) got no automated overnight email this run',
    kpis: [
      { value: entries.length, label: entries.length === 1 ? 'Lead Not Sent' : 'Leads Not Sent', bg: '#fee2e2', fg: '#dc2626' },
    ],
    action: 'Review each row below and either fix the underlying RM_Hierarchy/Manager_Directory gap, or follow up on these leads manually — the window is fixed to this morning\'s run, so tomorrow\'s run will NOT retry them.',
    sections: [{
      heading: 'Not Sent', accent: { fg: '#dc2626', headerBg: '#fee2e2', bg: '#fef2f2' },
      columns: ['Lead ID', 'RM', 'To', 'Cc', 'Reason'],
      rows: entries.map(function (e) { return [e.lead_id, e.RM, e.to || '(none)', e.cc || '(none)', e.reason]; }),
    }],
    footerNote: 'This is an internal ops report — not sent to any RM or manager.',
  });
  const plainBody = entries.map(function (e) {
    return 'Lead ' + e.lead_id + ' (RM: ' + e.RM + ') — To: ' + (e.to || '(none)') + ', Cc: ' + (e.cc || '(none)') + ' — ' + e.reason;
  }).join('\n');
  try {
    GmailApp.sendEmail(OPS_ALERT_EMAIL_, subject, plainBody, { htmlBody: html });
  } catch (e) {
    Logger.log('notifyLeadSendFailuresGs_ failed to send its own report: ' + e);
  }
}

// Mirrors REGION_GROUP_MAP in reports.js — keep the two in sync if either
// changes. Only these 11 main regions get an automated email; a raw region
// value not listed here (or a numbered/directional sub-region not covered by
// the trailing-suffix fallback below) is skipped, same as the dashboard's
// own reportScopeNotice() behavior.
const REGION_GROUP_MAP_ = {
  'Bangalore': 'Bangalore',
  'Bangalore 1': 'Bangalore', 'Bangalore 2': 'Bangalore', 'Bangalore 3': 'Bangalore',
  'Central': 'Central', 'Central Mumbai': 'Central',
  'Commercial': 'Commercial',
  'Harbour': 'Harbour',
  'Hyderabad': 'Hyderabad',
  'Loan': 'Loan',
  'Navi Mumbai': 'Navi Mumbai', 'Navi Mumbai 2': 'Navi Mumbai',
  'Pune': 'Pune',
  'Pune East': 'Pune', 'Pune North': 'Pune', 'Pune South': 'Pune', 'Pune West': 'Pune',
  'SoBo': 'SoBo', 'HNI - SoBo': 'SoBo', 'HNI': 'SoBo',
  'Thane': 'Thane',
  'Western': 'Western', 'Western Mumbai': 'Western',
  'Western 1': 'Western', 'Western 2': 'Western', 'Western 3': 'Western', 'Western 4': 'Western',
};
function normRegionKeyGs_(s) {
  return String(s || '').trim().toLowerCase().replace(/[\s\-_]+/g, ' ');
}
const _REGION_LOOKUP_ = {};
Object.keys(REGION_GROUP_MAP_).forEach(function (k) { _REGION_LOOKUP_[normRegionKeyGs_(k)] = REGION_GROUP_MAP_[k]; });
function mainRegionForGs_(rawRegion) {
  const key = normRegionKeyGs_(rawRegion);
  if (_REGION_LOOKUP_[key]) return _REGION_LOOKUP_[key];
  const base = key.replace(/\s+\d+$/, '');
  if (base !== key && _REGION_LOOKUP_[base]) return _REGION_LOOKUP_[base];
  return null;
}

// Source = google, Sub-source = Non-UTM or Search — the shared definition
// of "Google Non-UTM/Search" scope, checked as the very FIRST gate on
// every row by BOTH OvernightEmailer.gs's sendOvernightMorningEmails AND
// AllIssuesEmailer.gs's sendAllIssuesEmails, so the two scripts can't
// drift apart on what this scope means. Originally defined in
// AllIssuesEmailer.gs (moved here 2026-08-28 once OvernightEmailer.gs
// started depending on it too — a function one script needs from
// another is exactly the kind of thing that belongs in the shared layer,
// not in whichever script happened to need it first).
function passesGoogleNonUtmSearchGs_(groupSourceRaw, sourceBucketRaw) {
  const groupSource = String(groupSourceRaw || '').trim().toLowerCase();
  if (groupSource !== 'google') return false;
  const sourceBucket = String(sourceBucketRaw || '').trim().toLowerCase();
  return sourceBucket === 'non-utm' || sourceBucket === 'search';
}

// "Service Spreadsheets timed out..." (and its siblings — "Service error",
// "Internal error") are Google's own transient infrastructure hiccups, not
// a bug in this script — they happen more often against a large sheet
// (thousands of leads) under load, and they're exactly the kind of thing
// genuinely UNATTENDED automation has to shrug off on its own, since
// there's no human at the trigger to just click retry. Every Spreadsheet-
// service call across this project that reads/writes a real range goes
// through this wrapper. Deliberately narrow on WHICH errors it retries: a
// real bug (bad range, permission denied, a formula error) fails the exact
// same way on every attempt, so retrying it only delays surfacing the
// actual problem by the backoff budget below — not swallow it.
//
// 4 attempts / up to ~12s of total backoff (2s + 4s + 6s), not 3
// attempts / ~6s — real production hit this exact transient class three
// separate times against the same spreadsheet, including on a
// single-row, 6-cell header write, which points at that specific
// spreadsheet needing more headroom to ride out a slow patch than a
// generic "large sheet" assumption accounted for. Still comfortably
// inside Apps Script's own execution-time ceiling even if several
// withRetry_ calls in one run each hit the full budget.
function withRetry_(fn, label) {
  const maxAttempts = 4;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return fn();
    } catch (e) {
      const msg = String((e && e.message) || e);
      const isTransient = /timed out|service (spreadsheets|gmail|error)|internal error/i.test(msg);
      if (!isTransient || attempt === maxAttempts) throw e;
      Logger.log((label || 'Sheets operation') + ' failed transiently (attempt ' + attempt + '/' + maxAttempts + '): ' + msg + ' — retrying in ' + attempt * 2 + 's');
      Utilities.sleep(attempt * 2000);
    }
  }
}

// Narrower cousin of withRetry_, used ONLY for the actual Gmail send
// calls. withRetry_ itself is deliberately NOT used there — a Sheets
// read/write is safe to blindly retry, but retrying a SEND risks
// creating a genuine duplicate email if the original attempt actually
// succeeded and only the confirmation was lost (a "timed out"-class
// error is exactly this kind of ambiguous). Both errors below are
// different: each is Google either explicitly REFUSING the send, or
// (see "not found") a case we've since confirmed the send definitely did
// NOT go through — no ambiguity about whether it already succeeded, so
// retrying either can't produce a duplicate SEND (worst case for "not
// found": one extra harmless unsent draft left behind, never a second
// real send, since createDraft() runs fresh on every attempt).
//   - "Gmail operation not allowed": Google explicitly refusing the send.
//     Real production case this addresses: one run sent 15 emails in ~30
//     seconds and exactly 2 failed with this error, each one surrounded
//     by successful sends immediately before and after — a persistent
//     policy block would have failed every send, not 2 scattered ones,
//     so this reads as a brief, intermittent Gmail-side hiccup (plausibly
//     a soft rate-limit reaction to sending that many emails in quick
//     succession) that a short retry would very likely clear.
//   - "...Not found" (added 2026-08-31): createDraft(...).send() chains
//     two calls — draft creation, then an immediate send lookup BY that
//     draft's ID. Real production case: 9 leads in one region's bucket
//     failed with exactly this error; the user found a real, fully-formed
//     draft sitting in Gmail Drafts and sent it manually without any
//     issue — confirming createDraft() had already succeeded and only the
//     immediately-chained lookup-and-send failed to find it yet. This is
//     a documented Apps Script GmailApp eventual-consistency gap (the
//     freshly-created draft isn't always instantly resolvable by that
//     internal lookup) — exactly the kind of brief, transient condition a
//     short retry clears, not a permission or logic problem.
function withSendRetry_(fn, label) {
  const maxAttempts = 3;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return fn();
    } catch (e) {
      const msg = String((e && e.message) || e);
      const isNotFoundRace = /not found/i.test(msg);
      const isSafeToRetry = /operation not allowed/i.test(msg) || isNotFoundRace;
      if (!isSafeToRetry || attempt === maxAttempts) throw e;
      // Two different failure modes, two different waits. "Not found" is a
      // millisecond-scale eventual-consistency gap between createDraft()
      // and the immediately-chained send()'s lookup-by-ID (see this
      // function's own header comment) — not load-related, so a short flat
      // wait clears it just as reliably as a longer backoff, without
      // paying for one. "Operation not allowed" is different: a soft
      // rate-limit reaction to sending many emails in quick succession,
      // which genuinely benefits from the longer, increasing wait.
      // Added 2026-09-02: a real run showed the "not found" race is common
      // enough (not rare) that the original 2s/4s backoff — sized for the
      // rate-limit case — was measurably lengthening the whole run once
      // applied to this race too.
      const waitMs = isNotFoundRace ? 400 : attempt * 2000;
      Logger.log((label || 'Gmail send') + ' failed with a known-safe-to-retry error (attempt ' + attempt + '/' + maxAttempts + '): ' + msg + ' — retrying in ' + waitMs + 'ms');
      Utilities.sleep(waitMs);
    }
  }
}

// Split into small independently-retried steps, with a flush() right
// after insertSheet — same reasoning as RmHierarchy.gs's identical
// functions (see ensureRmHierarchySheet_'s comment): one big withRetry_
// around insert+write makes every retry redo the whole thing, and a
// freshly inserted sheet isn't always immediately ready for a write.
function ensureRegionRecipientsSheet_(ss) {
  const existing = withRetry_(function () { return ss.getSheetByName(REGION_RECIPIENTS_SHEET_); }, 'check for existing Region_Recipients');
  if (existing) return existing;

  const sheet = withRetry_(function () { return ss.insertSheet(REGION_RECIPIENTS_SHEET_); }, 'insert Region_Recipients');
  SpreadsheetApp.flush();
  withRetry_(function () {
    sheet.getRange(1, 1, 1, 3).setValues([['region', 'to', 'cc']]);
    sheet.setFrozenRows(1);
  }, 'write Region_Recipients header');
  const regions = Array.from(new Set(Object.keys(REGION_GROUP_MAP_).map(function (k) { return REGION_GROUP_MAP_[k]; }))).sort();
  withRetry_(function () {
    sheet.getRange(2, 1, regions.length, 1).setValues(regions.map(function (r) { return [r]; }));
  }, 'write Region_Recipients region list');
  return sheet;
}

// Per-A1-bucketed recipients for one region's email — see
// resolveRecipientBucketsForRms_'s (RmHierarchy.gs) own comment for the
// bucketing rule (one email per distinct A1, never several combined into
// one To) and for chLevelRms (RMs whose chain resolves all the way to a
// real CH — diverted to a CH-level report by the caller rather than an
// email addressed to the CH). Whichever RMs couldn't be resolved via
// RM_Hierarchy at all (no chain, excluded, or no email on record) fall
// back to ONE combined email via the legacy Region_Recipients entry —
// keeps the automation sending during the gradual rollout instead of
// going silent the moment RM_Hierarchy exists but some emails aren't
// filled in yet. If THAT'S not configured for this region either, they
// fall back a second time to CH_LEVEL_EMAIL_ (a company-wide backstop,
// not region-specific) — see the "no fallback configured" branch below
// for why. Returns an array of { to, cc, rmNames, source, bucketLabel,
// primaryRole } — one entry per email that should actually be sent for
// this region (zero, one, or many).
//
// opts.fireAlerts (default false) gates the CH-level alert this function
// can send — only the real unattended send paths (OvernightEmailer.gs's
// sendOvernightMorningEmails) pass true. Diagnostic/maintenance callers
// that just need to know what a recipient WOULD be
// (backfillTodaysOvernightLogRecipientsNow) leave it false, so
// re-running them repeatedly while debugging can't fire the same real
// alert over and over as an unintended side effect. AllIssuesEmailer.gs
// also passes false and fires its OWN CH-level report explicitly instead
// (notifyChLevelIssuesGs_) — it wants the SLA-issue-flavored report, not
// the overnight-flavored one this function would otherwise send.
// opts.rmToLeads (optional, RM name -> array of full lead objects) and
// opts.dateLabel (optional, "d MMM yyyy" string) — only used to pass
// through to the CH-level alert so it can send a full per-lead report,
// not just a bare lead-ID list. Fine to omit both. opts.hierarchyData
// (optional, the object loadRmHierarchyAndEmails_ returns) — pass this
// when a caller already loaded it once for the whole run (see
// resolveRecipientBucketsForRms_'s own comment on why); omitted, this
// falls back to a fresh per-call load exactly as before.
// Returns { results: [...], trulyUnresolved: [{rmName, reason}],
// chLevelRms: [...] }. trulyUnresolved is kept in the return shape for
// callers that already read it, but as of 2026-09-01 it should always be
// empty in practice — see the CH_LEVEL_EMAIL_ backstop below, which now
// covers every case that used to land here. Callers with fireAlerts on
// should still fold anything that DOES show up in it into the per-lead
// "not sent" report (notifyLeadSendFailuresGs_ above) instead of
// alerting here directly, as a belt-and-braces measure. chLevelRms is
// returned so a caller that needs it directly (AllIssuesEmailer.gs's own
// CH-level report) doesn't have to call resolveRecipientBucketsForRms_ a
// second time just to get it — see that call site's own comment.
function resolveRecipientEmailsForRegion_(ss, region, rmNames, legacyRecipients, opts) {
  const fireAlerts = !!(opts && opts.fireAlerts);
  const rmToLeads = (opts && opts.rmToLeads) || {};
  const dateLabel = (opts && opts.dateLabel) || Utilities.formatDate(new Date(), 'Asia/Kolkata', 'd MMM yyyy');
  const hierarchyData = opts && opts.hierarchyData;
  const resolved = withRetry_(function () { return resolveRecipientBucketsForRms_(ss, rmNames, hierarchyData); }, 'resolveRecipientBucketsForRms_ (' + region + ')');
  const results = resolved.buckets.map(function (b) {
    return { to: b.primaryEmail, cc: b.cc.join(',') || undefined, rmNames: b.rmNames, source: 'RM_Hierarchy (' + b.primaryRole + ': ' + b.primaryName + ')', bucketLabel: b.primaryName, primaryRole: b.primaryRole };
  });

  if (fireAlerts) notifyChLevelLeadsGs_(region, resolved.chLevelRms, rmToLeads, dateLabel);

  let trulyUnresolved = [];
  if (resolved.unresolved.length) {
    const legacy = legacyRecipients[region];
    if (legacy) {
      // ALWAYS_CC_EMAILS_ (RmHierarchy.gs) applies even on the legacy
      // fallback path — it's an unconditional business requirement on every
      // overnight email, not something specific to RM_Hierarchy resolution.
      const ccSet = new Set((legacy.cc || '').split(',').map(function (s) { return s.trim(); }).filter(Boolean));
      ALWAYS_CC_EMAILS_.forEach(function (e) { ccSet.add(e); });
      const unresolvedNames = resolved.unresolved.map(function (u) { return u.rmName; });
      results.push({ to: legacy.to, cc: Array.from(ccSet).join(',') || undefined, rmNames: unresolvedNames, source: 'Region_Recipients (fallback — RM_Hierarchy could not resolve: ' + unresolvedNames.join(', ') + ')', bucketLabel: 'Unmatched RMs', primaryRole: '' });
    } else {
      // No recipient configured anywhere for these RMs — used to mean
      // their leads got no automated email at all this run (trulyUnresolved
      // below, surfaced only in the ops-only "Leads Not Sent" diagnostic —
      // never actually reaching anyone who could act on the lead itself).
      // As of 2026-09-01: real production case was a departed RM (own row
      // removed from RM_Hierarchy entirely, e.g. Prathamesh A Pande) with
      // one straggler lead still naming them, in a region with no
      // Region_Recipients row filled in either — that lead got silently
      // dropped from all coverage until someone happened to run
      // auditUnresolvedRmsNow() and noticed. Instead of dropping it,
      // route it to CH_LEVEL_EMAIL_ (EmailInfra.gs) — the SAME
      // company-wide backstop already used when a real top-of-org person
      // personally holds a lead (see isTopOfOrgRole_'s branch above in
      // resolveRecipientBucketsForRms_) — so a genuinely broken chain
      // still reaches a real, actionable inbox automatically, with no
      // human needing to notice and configure a fallback first. This does
      // NOT fix the underlying gap (the alias/reassignment still needs
      // doing — auditUnresolvedRmsNow() still surfaces it for that), it
      // just means nothing silently falls through the floor while that's
      // pending.
      const chCcSet = new Set();
      ALWAYS_CC_EMAILS_.forEach(function (e) { chCcSet.add(e); });
      const chUnresolvedNames = resolved.unresolved.map(function (u) { return u.rmName; });
      results.push({ to: CH_LEVEL_EMAIL_, cc: Array.from(chCcSet).join(',') || undefined, rmNames: chUnresolvedNames, source: 'CH-level backstop (no RM_Hierarchy match and no Region_Recipients fallback for ' + region + ': ' + chUnresolvedNames.join(', ') + ')', bucketLabel: 'Unmatched RMs (backstop)', primaryRole: '' });
    }
  }

  // Single choke point every path above funnels through — see
  // TEST_MODE_OVERRIDE_EMAIL_'s own comment. Bucketing is preserved even in
  // test mode (each bucket still becomes its own email, just redirected)
  // so a test run can actually verify "does each A1 get their own email"
  // instead of collapsing the very thing being tested into one message.
  // originalTo/originalCc carry the REAL resolved recipients through
  // (rather than discarding them) so the caller's send function can print
  // them visibly inside the test email itself — otherwise the only way
  // to see what a real send would have targeted is digging through the
  // Executions log rather than just reading the email you got.
  if (TEST_MODE_OVERRIDE_EMAIL_) {
    const testResults = results.map(function (r) {
      return { to: TEST_MODE_OVERRIDE_EMAIL_, cc: undefined, rmNames: r.rmNames, source: r.source + ' [TEST MODE — real recipients suppressed, sent to ' + TEST_MODE_OVERRIDE_EMAIL_ + ' only]', bucketLabel: r.bucketLabel, primaryRole: r.primaryRole, originalTo: r.to, originalCc: r.cc };
    });
    return { results: testResults, trulyUnresolved: trulyUnresolved, chLevelRms: resolved.chLevelRms };
  }

  return { results: results, trulyUnresolved: trulyUnresolved, chLevelRms: resolved.chLevelRms };
}

function loadRegionRecipients_(ss) {
  const sheet = ensureRegionRecipientsSheet_(ss);
  return withRetry_(function () {
    const lastRow = sheet.getLastRow();
    const map = {};
    if (lastRow < 2) return map;
    sheet.getRange(2, 1, lastRow - 1, 3).getValues().forEach(function (row) {
      const region = String(row[0] || '').trim();
      const to = String(row[1] || '').trim();
      const cc = String(row[2] || '').trim();
      if (region && to) map[region] = { to: to, cc: cc };
    });
    return map;
  }, 'loadRegionRecipients_');
}

// Reads the leads tab and returns {colIndex, dataRows} — same
// shape MovementTracker.gs's snapshotOpenLeads_ reads, factored out here
// so every send path (OvernightEmailer.gs's morning + follow-up runs,
// AllIssuesEmailer.gs's run) shares one read path. This is the single
// biggest read in any of these scripts (thousands of leads, every
// column) — by far the most likely place a transient Spreadsheets
// timeout actually shows up, hence its own retry wrapper around the
// real reads.
function readLeadsTab_(ss) {
  const tabName = resolveTabName_(ss);
  const src = ss.getSheetByName(tabName);
  if (!src) throw new Error('Tab "' + tabName + '" not found.');
  return withRetry_(function () {
    const lastRow = src.getLastRow();
    const lastCol = src.getLastColumn();
    if (lastRow < 3) return { colIndex: {}, dataRows: [] };
    const headerRow = src.getRange(2, 1, 1, lastCol).getValues()[0];
    const colIndex = buildColIndex_(headerRow);
    const dataRows = src.getRange(3, 1, lastRow - 2, lastCol).getValues();
    return { colIndex: colIndex, dataRows: dataRows };
  }, 'readLeadsTab_');
}

// Apps Script port of the dashboard's renderReportEmailHTML (js/reports.js)
// — same eyebrow/KPI-card/section visual shell, hand-built here since
// Apps Script is a separate runtime with no access to that browser-side
// function. Shared across every email this project sends: OvernightEmailer.gs's
// morning email, 1pm follow-up reply, and CH-level report; AllIssuesEmailer.gs's
// own per-bucket and CH-level reports; and notifyLeadSendFailuresGs_ above.
// Narrower than the original: no `highlights` param (nothing here uses
// one) and the eyebrow/signature are fixed rather than parameterized,
// since every caller wants the same ones.
function renderOvernightReportEmailHTML_(opts) {
  const FONT = 'font-family:Arial,Helvetica,sans-serif;';
  const kpiCells = opts.kpis.map(function (k) {
    return '<td style="padding:4px;"><div style="background:' + k.bg + '; border-radius:8px; padding:14px 10px; text-align:center;">' +
      '<div style="' + FONT + ' font-size:24px; font-weight:700; color:' + k.fg + '; line-height:1;">' + esc_(String(k.value)) + '</div>' +
      '<div style="' + FONT + ' font-size:10.5px; color:#6b7280; margin-top:5px;">' + esc_(k.label) + '</div>' +
      '</div></td>';
  }).join('');

  const actionBox = opts.action
    ? '<div style="margin-top:12px; border-left:4px solid #10b981; background:#ecfdf5; border-radius:0 8px 8px 0; padding:10px 14px;">' +
      '<div style="' + FONT + ' font-size:10px; text-transform:uppercase; letter-spacing:.04em; font-weight:700; color:#059669;">Recommended Action</div>' +
      '<div style="' + FONT + ' font-size:12.5px; color:#065f46; margin-top:3px;">' + esc_(opts.action) + '</div></div>'
    : '';

  // sec.accent lets a section stand out from the default indigo (e.g. red
  // for "still unresolved", green for "resolved") — same mechanism as the
  // dashboard's own renderReportEmailHTML (js/reports.js) uses for its
  // Stalled Leads section.
  const sectionsHtml = opts.sections.map(function (sec) {
    const accentFg = (sec.accent && sec.accent.fg) || '#4338ca';
    const accentHeaderBg = (sec.accent && sec.accent.headerBg) || '#eef2ff';
    const accentBg = (sec.accent && sec.accent.bg) || '#f5f5ff';
    const headerRow = '<tr style="background:' + accentHeaderBg + ';">' + sec.columns.map(function (c) {
      return '<td style="padding:7px 10px; color:' + accentFg + '; font-size:10px; text-transform:uppercase; letter-spacing:.04em; font-weight:700; ' + FONT + '">' + esc_(c) + '</td>';
    }).join('') + '</tr>';
    const bodyRows = sec.rows.map(function (row, i) {
      return '<tr style="' + (i > 0 ? 'border-top:1px solid #f0f0f0;' : '') + '">' +
        row.map(function (cell) { return '<td style="padding:6px 10px; color:#374151; ' + FONT + '">' + esc_(String(cell)) + '</td>'; }).join('') +
        '</tr>';
    }).join('');
    return '<div style="margin-top:16px; border-left:4px solid ' + accentFg + '; background:' + accentBg + '; border-radius:0 8px 8px 0; padding:12px 16px;">' +
      '<div style="' + FONT + ' font-weight:700; font-size:14px; color:#1f2937;">' + esc_(sec.heading) + '</div>' +
      (sec.subheading ? '<div style="' + FONT + ' font-size:11.5px; color:#6b7280; margin-bottom:8px;">' + esc_(sec.subheading) + '</div>' : '') +
      '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#ffffff; border-radius:6px; border:1px solid #e5e7eb; font-size:12px; border-collapse:collapse; margin-top:6px;">' +
      headerRow + bodyRows + '</table></div>';
  }).join('');

  return '<div style="' + FONT + ' max-width:640px; margin:0 auto; background:#ffffff; color:#1f2937;">' +
    '<div style="background:#4338ca; padding:22px 26px;">' +
    '<div style="color:#c7d2fe; font-size:11px; letter-spacing:1.4px; text-transform:uppercase; font-weight:700; margin-bottom:6px; ' + FONT + '">Lead Funnel · SLA Monitor</div>' +
    '<div style="color:#ffffff; font-size:21px; font-weight:700; margin-bottom:4px; ' + FONT + '">' + esc_(opts.title) + '</div>' +
    '<div style="color:#ffffff; font-size:13px; font-weight:600; margin-bottom:2px; ' + FONT + '">Region: ' + esc_(opts.region) + '</div>' +
    '<div style="color:#e0e7ff; font-size:12.5px; ' + FONT + '">' + esc_(opts.subtitle) + '</div>' +
    '</div>' +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:14px;"><tr>' + kpiCells + '</tr></table>' +
    actionBox + sectionsHtml +
    (opts.footerNote ? '<div style="margin-top:18px; font-size:11px; color:#9ca3af; ' + FONT + '">' + esc_(opts.footerNote) + '</div>' : '') +
    '<div style="margin-top:16px; font-size:13px; color:#374151; white-space:pre-line; ' + FONT + '">Regards,\nHomesfy Lead Ops</div>' +
    '</div>';
}
