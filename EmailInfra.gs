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
// address (e.g. your own) to redirect EVERY resolved
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

// ---- Corporate addresses are NOT in this public file (email audit P13 / F24) ----
// This repository is public. The ops, CH-level and Futwork-route addresses used to be string literals here (and the two
// leadership Cc addresses in RmHierarchy.gs). They now live ONLY in RmHierarchy.private.gs (git-ignored, pasted into the Apps
// Script project beside RmHierarchy.gs — the same file that already holds every employee's address): this file keeps the NAME
// of the person each role belongs to, and the address is looked up from that private table (lookupEmployeeEmail_,
// RmHierarchy.gs) when it is needed, never at load time (Apps Script does not guarantee file load order — see that function).
//
// The `let` address variables below are OVERRIDES: blank (the real setting) means "look it up by name"; Tests_Mocks.gs assigns
// them test addresses for the duration of a test run and restores them. Nothing in real production code assigns them. Read the
// address through the accessors (opsAlertEmailGs_ / chLevelEmailGs_ / futworkRouteEmailGs_), never the variable.
//
// If the private table is missing or a person has no row, the accessor falls back SAFELY and LOUDLY instead of dropping mail:
// ops -> the Spreadsheet's owner; CH-level and Futwork -> the ops address; leadership Cc -> skipped. The hourly watchdog
// (emailConfigProblemsGs_) alerts ops once a day while any of that is true.
const OPS_ALERT_NAME_ = 'Snehil Chhimwal';
const CH_LEVEL_NAME_ = 'Ashish Ivlekar';
const FUTWORK_ROUTE_NAME_ = 'Snehil Chhimwal';

// The address from the private employee table for a person's name — lower-cased, or '' when the table or the person is absent.
function resolvedEmailForNameGs_(name) {
  try {
    if (typeof lookupEmployeeEmail_ !== 'function') return '';
    return String(lookupEmployeeEmail_(name) || '').trim().toLowerCase();
  } catch (e) {
    Logger.log('resolvedEmailForNameGs_(' + name + ') failed: ' + e);
    return '';
  }
}
const _emailConfigWarned_ = {};
function warnEmailConfigOnceGs_(key, text) {
  if (_emailConfigWarned_[key]) return;
  _emailConfigWarned_[key] = true;
  Logger.log('EMAIL CONFIG WARNING: ' + text);
}

// Where a script alert goes when a script could NOT get an automated email out at all for some region/RM — no resolvable
// recipient, the send itself failed after retries, or a chain resolved all the way to a CH. These failures are otherwise
// invisible outside the Apps Script Executions log, which nobody watches proactively. `let`: test override, see above.
let OPS_ALERT_EMAIL_ = '';
function opsAlertEmailGs_() {
  if (OPS_ALERT_EMAIL_) return OPS_ALERT_EMAIL_;
  const resolved = resolvedEmailForNameGs_(OPS_ALERT_NAME_);
  if (resolved) return resolved;
  // Last resort: the workbook's owner (needs no extra OAuth scope). Better a possibly-wrong inbox than a silently lost alert.
  try {
    const owner = SpreadsheetApp.getActiveSpreadsheet().getOwner();
    const ownerEmail = owner && owner.getEmail ? String(owner.getEmail() || '').trim().toLowerCase() : '';
    if (ownerEmail) {
      warnEmailConfigOnceGs_('ops', 'no address for "' + OPS_ALERT_NAME_ + '" in the private employee table — ops alerts are going to the workbook owner (' + ownerEmail + ') instead.');
      return ownerEmail;
    }
  } catch (e) { /* no owner available */ }
  warnEmailConfigOnceGs_('ops', 'no address for "' + OPS_ALERT_NAME_ + '" in the private employee table and no workbook owner — ops alerts CANNOT be delivered.');
  return '';
}

// Second recipient specifically for CH-level reports (OvernightEmailer.gs's notifyChLevelLeadsGs_, AllIssuesEmailer.gs's
// notifyChLevelIssuesGs_) — leads held directly by the CEO or a Cluster Head/City Lead, with nobody below them to route through
// automatically, go to the ops address AND this one. Also the last-resort recipient of the "no RM_Hierarchy match" backstop
// bucket. Deliberately separate from the leadership Cc (RmHierarchy.gs alwaysCcEmailsGs_) — that applies to every normal
// per-RM email; this is scoped to CH-level reports only. `let`: test override, see above.
let CH_LEVEL_EMAIL_ = '';
function chLevelEmailGs_() {
  if (CH_LEVEL_EMAIL_) return CH_LEVEL_EMAIL_;
  const resolved = resolvedEmailForNameGs_(CH_LEVEL_NAME_);
  if (resolved) return resolved;
  warnEmailConfigOnceGs_('ch', 'no address for "' + CH_LEVEL_NAME_ + '" in the private employee table — CH-level mail is going to the ops address only.');
  return opsAlertEmailGs_();
}

// Any RM whose name contains "Futwork" (tele-calling vendor agents) is emailed ONLY here — never their manager chain,
// Region_Recipients, the CH backstop, or the leadership Cc. `let`: test override, see above.
let FUTWORK_ROUTE_EMAIL_ = '';
function futworkRouteEmailGs_() {
  if (FUTWORK_ROUTE_EMAIL_) return FUTWORK_ROUTE_EMAIL_;
  const resolved = resolvedEmailForNameGs_(FUTWORK_ROUTE_NAME_);
  if (resolved) return resolved;
  warnEmailConfigOnceGs_('futwork', 'no address for "' + FUTWORK_ROUTE_NAME_ + '" in the private employee table — the Futwork email is going to the ops address instead.');
  return opsAlertEmailGs_();
}

// What is NOT resolvable right now: [{ key, detail }]. Empty = every configured address comes from a real source. Used by the
// hourly watchdog (checkEmailJobsCompletedGs_) and showEmailConfigNow. Overrides count as resolved (a test run is not a problem).
function emailConfigProblemsGs_() {
  const problems = [];
  const need = function (key, override, name, effect) {
    if (!override && !resolvedEmailForNameGs_(name)) problems.push({ key: key, detail: 'no address for "' + name + '" in the private employee table (RmHierarchy.private.gs) — ' + effect });
  };
  need('ops', OPS_ALERT_EMAIL_, OPS_ALERT_NAME_, 'ops alerts fall back to the workbook owner.');
  need('ch', CH_LEVEL_EMAIL_, CH_LEVEL_NAME_, 'CH-level reports and the "no RM_Hierarchy match" backstop go to the ops address only.');
  need('futwork', FUTWORK_ROUTE_EMAIL_, FUTWORK_ROUTE_NAME_, 'the Futwork email goes to the ops address.');
  if (!Array.isArray(ALWAYS_CC_EMAILS_)) {
    LEADERSHIP_NAMES_.forEach(function (name) {
      if (!resolvedEmailForNameGs_(name)) problems.push({ key: 'leadership:' + name.toLowerCase(), detail: 'no address for "' + name + '" in the private employee table — the leadership Cc is being SKIPPED for them on every email.' });
    });
  }
  return problems;
}

// Logs where each configured address comes from (the Executions log) — for a human checking a deploy.
function showEmailConfigNow() {
  Logger.log('ops alert      : ' + (OPS_ALERT_EMAIL_ ? 'OVERRIDE ' : '') + (opsAlertEmailGs_() || '(none)'));
  Logger.log('CH-level       : ' + (CH_LEVEL_EMAIL_ ? 'OVERRIDE ' : '') + (chLevelEmailGs_() || '(none)'));
  Logger.log('Futwork route  : ' + (FUTWORK_ROUTE_EMAIL_ ? 'OVERRIDE ' : '') + (futworkRouteEmailGs_() || '(none)'));
  Logger.log('leadership Cc  : ' + (Array.isArray(ALWAYS_CC_EMAILS_) ? 'OVERRIDE ' : '') + (alwaysCcEmailsGs_().join(', ') || '(none)'));
  const problems = emailConfigProblemsGs_();
  Logger.log(problems.length ? 'PROBLEMS:\n  ' + problems.map(function (p) { return p.detail; }).join('\n  ') : 'Every configured address resolves.');
}
function isFutworkRmNameGs_(name) { return /futwork/i.test(String(name || '')); }

// P&L head Cc'd on every automatic email for a region (2026-09-26, "add pnl head of Hyderabad and Bangalore in cc";
// 2026-09-30, "also add pnl head in cc for both the region of each email" [Thane, Navi Mumbai]).
// Holds NAMES, not addresses — this repo is public, so the address is looked up at send time from Manager_Directory
// (filled from RmHierarchy.private.gs, which is never committed). Source of the names: the HR export's P&L column.
// Keyed by region; `let` for test-overridability.
let REGION_PNL_HEAD_CC_ = { 'Hyderabad': 'Mukesh Mishra', 'Bangalore': 'Mukesh Mishra', 'Thane': 'Shitij Kaushal', 'Navi Mumbai': 'Shitij Kaushal' };

// The email address of a region's P&L head, or '' when the region has none configured or Manager_Directory has no
// address for that name (logged, never thrown — a missing Cc must not stop an email).
function regionPnlHeadEmailGs_(ss, region, hierarchyData) {
  const key = String(region || '').trim().toLowerCase();
  let name = '';
  Object.keys(REGION_PNL_HEAD_CC_).forEach(function (r) {
    if (r.trim().toLowerCase() === key) name = String(REGION_PNL_HEAD_CC_[r] || '').trim();
  });
  if (!name) return '';
  const data = hierarchyData || loadRmHierarchyAndEmails_(ss);
  const email = String((data.emailByManagerNameLower || {})[name.toLowerCase()] || '').trim();
  if (!email) Logger.log('No email on record in Manager_Directory for the ' + region + ' P&L head "' + name + '" - so no P&L Cc was added.');
  return email;
}

// Adds a P&L head's address to a Cc list (comma text in, comma text or undefined out). Never Cc's someone who is
// already the To of this email, and never duplicates an address already present.
function withRegionPnlHeadCcGs_(pnlHeadEmail, to, cc) {
  const list = String(cc || '').split(',').map(function (x) { return x.trim(); }).filter(Boolean);
  const head = String(pnlHeadEmail || '').trim();
  if (head) {
    const taken = {};
    list.concat(String(to || '').split(',')).forEach(function (e) { taken[String(e).trim().toLowerCase()] = true; });
    if (!taken[head.toLowerCase()]) list.push(head);
  }
  return list.join(',') || undefined;
}

// TEST MODE must never write production state (log rows, checkpoint state) — a 2026-09-24 test run's rows
// made the real 17:00 job skip every region and later sent Checkpoint 1 to the tester instead of managers.
function writeUnlessTestModeGs_(fn, label) {
  if (TEST_MODE_OVERRIDE_EMAIL_) { Logger.log('TEST MODE — skipped production write: ' + label); return undefined; }
  // flush() inside the retry: Sheets reports a bad write (e.g. a cell over 50,000 chars) only on the NEXT sheet call,
  // which was outside every caller's try/catch and aborted the whole 2026-09-25 13:00 run.
  return withRetry_(function () { const result = fn(); SpreadsheetApp.flush(); return result; }, label);
}

// Changed 2026-10-05 (email audit P7 / F10). Every log append runs inside a retry wrapper (withRetry_ / writeUnlessTestModeGs_),
// and a timeout can arrive AFTER Sheets already wrote the row — the retry then appended a SECOND identical row, and a duplicate
// Overnight_Log row becomes a duplicate 13:00 reply into the same thread. appendRowOnceGs_ returns the write as a closure to
// hand to those wrappers: its first attempt just appends; any later attempt first looks for THIS row (by its key column —
// the Gmail thread id, unique per sent email) in the last APPEND_ONCE_TAIL_ROWS_ rows and, if it is already there, does
// nothing. No extra Sheets read on the normal, first-attempt path. A blank key cannot be matched, so it appends as before.
const APPEND_ONCE_TAIL_ROWS_ = 100;
function appendRowOnceGs_(sheet, row, keyIndex) {
  const rawKey = row[keyIndex];
  const key = (rawKey === undefined || rawKey === null) ? '' : String(rawKey).trim();
  let attempted = false;
  return function () {
    if (attempted && key) {
      const lastRow = sheet.getLastRow();
      if (lastRow >= 2) {
        const firstRow = Math.max(2, lastRow - APPEND_ONCE_TAIL_ROWS_ + 1);
        const tail = sheet.getRange(firstRow, keyIndex + 1, lastRow - firstRow + 1, 1).getValues();
        for (let i = 0; i < tail.length; i++) {
          if (String(tail[i][0]).trim() === key) return false; // an earlier attempt already landed — do not append a second copy
        }
      }
    }
    attempted = true; // set BEFORE the write: an attempt that throws may still have written
    sheet.appendRow(row);
    return true;
  };
}

// Sheets rejects a cell over 50,000 characters. Serializes entries for one cell, dropping trailing entries (and alerting
// ops) rather than ever attempting an oversize write.
const MAX_CELL_JSON_CHARS_ = 45000;
function jsonForCellGs_(entries, label) {
  let list = entries || [];
  let json = JSON.stringify(list);
  if (json.length <= MAX_CELL_JSON_CHARS_) return json;
  const total = list.length;
  while (list.length > 0 && json.length > MAX_CELL_JSON_CHARS_) {
    list = list.slice(0, Math.floor(list.length * 0.9));
    json = JSON.stringify(list);
  }
  notifyOpsAlertGs_('A log cell was too large and was truncated (' + label + ')', [
    label + ': ' + total + ' entries did not fit in one cell (limit 50,000 characters); kept the first ' + list.length + '.',
    'The email itself was not affected — only the stored copy used by the later follow-up checkpoints is shorter.',
  ]);
  return json;
}

// CH-level reports go to OPS + CH, or only the tester in TEST MODE (both sends used to ignore TEST MODE).
function chLevelReportToGs_() {
  if (TEST_MODE_OVERRIDE_EMAIL_) return TEST_MODE_OVERRIDE_EMAIL_;
  const ops = opsAlertEmailGs_(), ch = chLevelEmailGs_();
  return (ch && ch !== ops) ? ops + ',' + ch : ops; // chLevelEmailGs_ falls back to the ops address: never "a,a"
}

// CH-level reports once per day (email audit P10 / F11). A CH-level report (a CH personally holding leads, or an RM whose chain
// resolves up to a CH) is sent to OPS + the CH-level address, but it was never LOGGED: the region guards of the 10:00 and 17:00
// jobs key off a log row, which a region with ONLY CH-level leads never gets — so every re-run of the job re-sent the same
// report. (A region that also had a normal bucket was protected by that bucket's row.) The record below is one Script
// Property per report type, `EMAIL_CH_REPORTS_<kind>` = `{day, keys: ['<region>|<ch>', ...]}`; it holds only TODAY's keys and
// is replaced when the IST day changes, so it never grows. Same-day only, like the region guards: a re-run is a recovery action,
// not a way to pick up leads that arrived later. Fails OPEN — an unreadable or unwritable record means the report may be sent
// again (annoying), never that it is withheld (harmful). TEST MODE neither reads nor writes it (a test run must not be
// suppressed by, or write into, production state — same rule as the region guards).
const CH_REPORT_KINDS_ = { overnight: 'overnight', allIssues: 'allissues' };
function chReportKeyGs_(region, chName) {
  return String(region || '').trim().toLowerCase() + '|' + String(chName || '').trim().toLowerCase();
}
function chReportPropertyGs_(kind) { return 'EMAIL_CH_REPORTS_' + kind; }
function readChReportsTodayGs_(kind) {
  try {
    if (typeof PropertiesService === 'undefined') return null;
    const raw = PropertiesService.getScriptProperties().getProperty(chReportPropertyGs_(kind));
    const rec = raw ? JSON.parse(raw) : null;
    return (rec && rec.day === istDayKeyGs_(new Date()) && Array.isArray(rec.keys)) ? rec.keys : [];
  } catch (e) {
    Logger.log('CH-level report record (' + kind + ') could not be read — treating it as "not sent yet": ' + e);
    return null;
  }
}
// true when this report type was already sent today for this region + CH.
function wasChReportSentTodayGs_(kind, region, chName) {
  if (TEST_MODE_OVERRIDE_EMAIL_) return false;
  const keys = readChReportsTodayGs_(kind);
  return !!keys && keys.indexOf(chReportKeyGs_(region, chName)) !== -1;
}
// Records a SUCCESSFUL send. Never throws.
function markChReportSentGs_(kind, region, chName) {
  if (TEST_MODE_OVERRIDE_EMAIL_) return false;
  try {
    if (typeof PropertiesService === 'undefined') return false;
    const keys = readChReportsTodayGs_(kind) || [];
    const key = chReportKeyGs_(region, chName);
    if (keys.indexOf(key) === -1) keys.push(key);
    PropertiesService.getScriptProperties().setProperty(chReportPropertyGs_(kind), JSON.stringify({ day: istDayKeyGs_(new Date()), keys: keys }));
    return true;
  } catch (e) {
    Logger.log('CH-level report record (' + kind + ') could not be written — this report may be re-sent by a same-day re-run: ' + e);
    return false;
  }
}

// Futwork leads from EVERY region are grouped under this one pseudo-region, so each job (17:00 / 10:00 / 13:00)
// sends ONE Futwork email; each lead keeps its real region (.region) and the email shows them as separate bands.
const FUTWORK_REGION_KEY_ = 'Futwork';
function regionKeyForRmGs_(rmName, region) { return isFutworkRmNameGs_(rmName) ? FUTWORK_REGION_KEY_ : region; }

// Real regions (sorted) + lead counts for items carrying .region, e.g. { regions: ['Pune','Thane'], label: 'Pune (3) · Thane (1)' }.
function regionSummaryGs_(items) {
  const counts = {};
  (items || []).forEach(function (i) { if (i && i.region) counts[i.region] = (counts[i.region] || 0) + 1; });
  const regions = Object.keys(counts).sort();
  return { regions: regions, counts: counts, label: regions.map(function (r) { return r + ' (' + counts[r] + ')'; }).join(' · ') };
}

// Header opts for an email: the region itself, or — for the Futwork pseudo-region — every real region spelled out.
function regionHeaderOptsGs_(regionKey, items) {
  if (regionKey !== FUTWORK_REGION_KEY_) return { region: regionKey };
  const s = regionSummaryGs_(items);
  if (!s.regions.length) return { region: FUTWORK_REGION_KEY_ };
  return { region: s.regions.join(', '), regionLabel: (s.regions.length === 1 ? 'Region: ' : 'Regions: ') + s.label };
}

// Splits items by real region (sorted) and lets sectionsForRegion(region, regionItems) build that region's sections;
// the first section of each region carries a region band so regions stay visibly separate inside one email.
function sectionsByRegionGs_(items, sectionsForRegion) {
  const byRegion = {};
  items.forEach(function (i) { const r = i.region || 'Unknown region'; (byRegion[r] = byRegion[r] || []).push(i); });
  const out = [];
  Object.keys(byRegion).sort().forEach(function (region) {
    const secs = sectionsForRegion(region, byRegion[region]);
    if (secs.length) secs[0].regionBand = region + ' — ' + byRegion[region].length + (byRegion[region].length === 1 ? ' lead' : ' leads');
    out.push.apply(out, secs);
  });
  return out;
}

// First occurrence of each lead_id wins — merged buckets must not repeat a lead.
function dedupeByLeadIdGs_(entries) {
  const seen = {};
  return (entries || []).filter(function (e) { const id = e && e.lead_id; if (id === undefined || seen[id]) return false; seen[id] = true; return true; });
}

// Best-effort alert for a send that could not happen at all this run —
// wrapped in its own try/catch so a failure to send the ALERT itself can
// never take down the real run it's reporting on. Kept deliberately
// plain-text/no-frills — this is an ops ping, not a report. Always to
// OPS_ALERT_EMAIL_ only, no Cc.
//
// Changed 2026-10-05 (email audit P9 / F21): the alert used to be ONE un-retried GmailApp call, so an alert about a platform
// outage was lost to that same outage (the 2 Oct 13:00 failure left no alert at all). It now tries GmailApp twice (3 s apart),
// then a second path — the Advanced Gmail Service, already authorized for the threaded replies — and only then gives up (logged).
// A retry after an ambiguous timeout can deliver the alert twice; a duplicate alert is harmless, a lost one is not. Returns true
// when some path sent it.
function notifyOpsAlertGs_(subject, bodyLines, opts) {
  // Email Ops EO-2 (plan decision D2): while one of the three email jobs runs, an alert is recorded as an incident at once but SENT only
  // after the job, as one message behind a count of how many emails went out - an error never delays or interrupts the safe work.
  // opts.immediate (a whole-job failure: nothing left to confirm) sends at once; opts.severity / opts.scope override the guess.
  const immediate = !!(opts && opts.immediate);
  const hold = EMAIL_ALERT_HOLD_;
  const held = !!(hold && !immediate);
  let incidentId = '';
  if (typeof incidentRecordGs_ === 'function') {
    try { incidentId = incidentRecordGs_({ subject: subject, bodyLines: bodyLines, job: hold ? hold.job : '', held: held, severity: opts && opts.severity, scope: opts && opts.scope }); } catch (incidentErr) { incidentId = ''; }
  }
  if (held) { hold.items.push({ subject: subject, bodyLines: bodyLines, incidentId: incidentId }); return true; }
  const sent = sendOpsAlertNowGs_(subject, bodyLines);
  if (incidentId && typeof incidentNotifiedGs_ === 'function') incidentNotifiedGs_([incidentId], sent ? 'SENT' : 'SEND-FAILED');
  return sent;
}

// The actual send of an ops alert (the retries and the second path described above). Returns true when some path sent it.
function sendOpsAlertNowGs_(subject, bodyLines) {
  const fullSubject = '[Overnight Emailer] ' + subject;
  const body = bodyLines.join('\n');
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      GmailApp.sendEmail(opsAlertEmailGs_(), fullSubject, body);
      return true;
    } catch (e) {
      Logger.log('notifyOpsAlertGs_: GmailApp send failed (attempt ' + attempt + '/2) for alert "' + subject + '": ' + e);
      if (attempt === 1) Utilities.sleep(3000);
    }
  }
  try {
    sendOpsAlertViaGmailApiGs_(fullSubject, body);
    return true;
  } catch (e2) {
    Logger.log('notifyOpsAlertGs_ failed to send its own alert ("' + subject + '") by every path: ' + e2);
    return false;
  }
}

// Second send path for an ops alert: a plain-text raw MIME message through the Advanced Gmail Service. Non-ASCII subjects
// (the alerts use an em dash) are sent as an RFC 2047 encoded word; a line break can never reach a header.
function sendOpsAlertViaGmailApiGs_(subject, body) {
  if (typeof Gmail === 'undefined' || !Gmail || !Gmail.Users || !Gmail.Users.Messages) throw new Error('the Advanced Gmail Service is not available');
  const cleanSubject = String(subject).replace(/[\r\n]+/g, ' ');
  const encodedSubject = /^[\x20-\x7e]*$/.test(cleanSubject)
    ? cleanSubject
    : '=?UTF-8?B?' + Utilities.base64Encode(Utilities.newBlob(cleanSubject).getBytes()) + '?=';
  const mime = ['To: ' + opsAlertEmailGs_(), 'Subject: ' + encodedSubject, 'MIME-Version: 1.0', 'Content-Type: text/plain; charset="UTF-8"', '', body].join('\r\n');
  return Gmail.Users.Messages.send({ raw: Utilities.base64EncodeWebSafe(Utilities.newBlob(mime).getBytes()) }, 'me');
}

// "yyyy-MM-dd HH:mm:ss" in IST for NOW (or the given date) — the stamp every log cell uses. Log stamps are taken at the moment of
// the write, not the job's start time (email audit P9 / F12: the 3 Oct reply went out at 13:12 but was stamped 13:01:49).
function istStampGs_(date) {
  return Utilities.formatDate(date || new Date(), 'Asia/Kolkata', 'yyyy-MM-dd HH:mm:ss');
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
    GmailApp.sendEmail(opsAlertEmailGs_(), subject, plainBody, { htmlBody: html });
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
//
// Changed 2026-10-07 (email audit P12 / F22): the platform's OWN wording for a transient failure — "We're sorry, a server
// error occurred. Please wait a bit and try again." — matched none of the patterns, so the first such error from a Sheets call
// aborted the whole job (very likely the 2 Oct 13:00 failure, which ended Failed with exactly that message). It is now in the
// list. Safe to retry: the log appends that run inside this wrapper are once-only (appendRowOnceGs_, P7) and every other
// write here (setValues, header heals) is idempotent. Deliberately NOT the generic "please wait a bit" part of that message:
// a permanent refusal (quota, permission) never says "server error occurred".
const TRANSIENT_ERROR_RE_ = /timed out|service (spreadsheets|gmail|error)|internal error|server error occurred/i;
function withRetry_(fn, label) {
  const maxAttempts = 4;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return fn();
    } catch (e) {
      const msg = String((e && e.message) || e);
      const isTransient = TRANSIENT_ERROR_RE_.test(msg);
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

// ============================== OUTGOING EMAIL SAFETY GATE ==============================
// Added 2026-10-05 (email audit P1, docs/_planning/EMAIL_AUDIT.md F3/F4/F14). Before this, every report email was built
// inline at its own call site and handed straight to GmailApp — nothing between "the body was built" and "the provider
// call" checked that the recipient was a real address, that the subject/body had any content, or that the leads the email
// claims to report are actually in the body that goes out. The skip rules at each call site ("nothing unresolved -> don't
// send") are the FIRST line of defence; this is the LAST one, and it works on the exact payload about to be sent, so
// validation and send can never disagree.
//
// A blocked send throws an Error with .blockedByGuard = true BEFORE any draft exists; every caller already turns a thrown
// send error into an ops alert + a "not sent" entry, so a blocked email is recorded, never silent, and nothing is marked
// as sent (the state stays recoverable).

// Deliberately simple: one address, no display name, no quotes/brackets/commas/whitespace anywhere. Whitespace and CR/LF are
// excluded on purpose — an address with a line break inside it is a header-injection attempt or a corrupt cell, not mail.
// (Checked 2026-10-05 against every address ever sent to or configured — 7,854 — none is rejected.)
const EMAIL_ADDRESS_RE_ = /^[^\s@<>,;"()\[\]\\]+@[^\s@<>,;"()\[\]\\]+\.[^\s@<>,;"()\[\]\\]+$/;

// Problems with a comma-separated address list ([] = fine). `required` = an empty list is itself a problem (the To field).
function emailAddressListProblemsGs_(list, fieldName, required) {
  const raw = Array.isArray(list) ? list.join(',') : String(list == null ? '' : list);
  const parts = raw.split(',').map(function (s) { return s.trim(); }).filter(Boolean);
  if (!parts.length) return required ? [fieldName + ' is empty'] : [];
  const problems = [];
  parts.forEach(function (a) {
    if (!EMAIL_ADDRESS_RE_.test(a)) problems.push(fieldName + ' has an invalid address "' + a.replace(/[\r\n]+/g, ' ') + '"');
  });
  return problems;
}

// The text a reader would actually see in an HTML body — style/script/head blocks and tags removed, entities decoded,
// whitespace collapsed. An HTML body that is all markup (empty cells, empty table) has no visible text.
function visibleTextOfHtmlGs_(html) {
  return String(html == null ? '' : html)
    .replace(/<(style|script|head)[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;|&#160;/gi, ' ')
    .replace(/&lt;/gi, '<').replace(/&gt;/gi, '>').replace(/&quot;/gi, '"').replace(/&#39;/gi, "'").replace(/&amp;/gi, '&')
    .replace(/\s+/g, ' ').trim();
}

// Normalizes a message (CR/LF in the subject collapsed — a header can never carry a line break) and returns
// { msg: <the exact payload that will be sent>, problems: [...] }. `msg` = { to, cc, subject, plainBody, htmlBody, leadIds }.
// leadIds (optional) is the list of lead ids this report email CLAIMS to report: when given, it must be non-empty and every
// id must appear in BOTH the visible text of the HTML body and the plain-text body (email audit P2 gave the plain part the
// lead list too) — a report that names no leads, or whose body does not contain the leads it counts, is never sent. Omit
// leadIds for a non-report mail.
function prepareOutgoingEmailGs_(msg) {
  const m = msg || {};
  const to = Array.isArray(m.to) ? m.to.join(',') : String(m.to == null ? '' : m.to).trim();
  const cc = Array.isArray(m.cc) ? m.cc.join(',') : String(m.cc == null ? '' : m.cc).trim();
  const subject = String(m.subject == null ? '' : m.subject).replace(/[\r\n]+/g, ' ').trim();
  const plainBody = m.plainBody == null ? '' : String(m.plainBody);
  const htmlBody = m.htmlBody == null ? undefined : String(m.htmlBody);

  const problems = [];
  let missingLeadIds = []; // the counted leads that are absent from a body (Email Ops EO-1a: lets a caller drop just those leads and resend)
  problems.push.apply(problems, emailAddressListProblemsGs_(to, 'To', true));
  problems.push.apply(problems, emailAddressListProblemsGs_(cc, 'Cc', false));
  if (!subject) problems.push('the subject is empty');
  if (!plainBody.trim()) problems.push('the plain-text body is empty or whitespace-only');
  let visible = '';
  if (htmlBody !== undefined) {
    visible = visibleTextOfHtmlGs_(htmlBody);
    if (!visible) problems.push('the HTML body has no visible text');
  }
  if (m.leadIds !== undefined) {
    const ids = (m.leadIds || []).map(function (id) { return String(id == null ? '' : id).trim(); }).filter(Boolean);
    if (!ids.length) {
      problems.push('the email reports no leads — nothing to send');
    } else {
      const missingPlain = ids.filter(function (id) { return plainBody.indexOf(id) === -1; });
      const missingHtml = htmlBody === undefined ? [] : ids.filter(function (id) { return visible.indexOf(id) === -1; });
      if (missingPlain.length) problems.push('lead(s) counted but missing from the plain-text body: ' + missingPlain.slice(0, 5).join(', '));
      if (missingHtml.length) problems.push('lead(s) counted but missing from the HTML body: ' + missingHtml.slice(0, 5).join(', '));
      missingLeadIds = ids.filter(function (id) { return missingPlain.indexOf(id) !== -1 || missingHtml.indexOf(id) !== -1; });
    }
  }
  return { msg: { to: to, cc: cc, subject: subject, plainBody: plainBody, htmlBody: htmlBody }, problems: problems, missingLeadIds: missingLeadIds };
}

// A send error after which the message MAY still have been delivered (the request reached Gmail, the answer was lost or Gmail
// failed mid-way) — as opposed to a definitive refusal ("operation not allowed", a bad id, bad arguments, a quota refusal),
// after which nothing was sent. The 13:00 threaded send falls back to a second, plain send when the first one fails (email
// audit P6 / F7); for an ambiguous error that fallback would deliver a DUPLICATE if the first send had in fact gone through.
// Deliberately a short allow-list of "may have happened" wordings; anything else is treated as a definite failure.
function isAmbiguousSendErrorGs_(err) {
  const msg = String((err && err.message) || err || '');
  return /timed out|timeout|deadline|internal error|server error|backend error|service error|service (gmail )?failed|unavailable|empty response|socket|network|temporar|\b50[0234]\b/i.test(msg);
}

function sendBlockedErrorGs_(label, problems, missingLeadIds) {
  const err = new Error('Send blocked by the safety gate (' + (label || 'email') + '): ' + problems.join('; '));
  err.blockedByGuard = true;
  err.guardProblems = problems;
  err.missingLeadIds = missingLeadIds || []; // leads the gate could not find in a body (empty for any other kind of refusal)
  return err;
}

// THE single sender for every report email: validate the exact payload, then draft+send it with the retry rules in
// withSendRetry_. Throws (never sends) when the payload fails validation.
function sendGuardedEmailGs_(msg, label) {
  const prepared = prepareOutgoingEmailGs_(msg);
  if (prepared.problems.length) throw sendBlockedErrorGs_(label, prepared.problems, prepared.missingLeadIds);
  const m = prepared.msg;
  const options = { name: 'Homesfy Lead Ops' };
  if (m.cc) options.cc = m.cc;
  if (m.htmlBody !== undefined) options.htmlBody = m.htmlBody;
  return withSendRetry_(function () {
    return GmailApp.createDraft(m.to, m.subject, m.plainBody, options).send();
  }, label);
}

// ---- Held alerts (Email Ops EO-2, plan decision D2) ----
// While one of the three email jobs runs, notifyOpsAlertGs_ holds its alerts (they are already recorded in Incident_Log, status HELD).
// emailAlertHoldFlushGs_ sends them once the job has ended, as ONE message that starts with the ledger's count of how many emails Gmail
// accepted. If the job is killed before it can flush, the hourly watchdog releases them (releaseHeldIncidentsGs_, EmailLedger.gs).
const EMAIL_ALERT_HOLD_JOBS_ = ['sendOvernightMorningEmails', 'sendOvernightFollowupEmails', 'sendAllIssuesEmails', 'recoverAllIssuesBuckets', 'recoverMorningBuckets', 'recoverFollowupBuckets'];
let EMAIL_ALERT_HOLD_ = null; // { job, items: [{ subject, bodyLines, incidentId }] } while a hold-job runs

function emailAlertHoldStartGs_(jobName) {
  EMAIL_ALERT_HOLD_ = { job: jobName, items: [] };
  if (typeof emailLedgerResetActiveGs_ === 'function') emailLedgerResetActiveGs_(); // the count must describe THIS run
}

function emailAlertHoldFlushGs_() {
  const hold = EMAIL_ALERT_HOLD_;
  EMAIL_ALERT_HOLD_ = null;
  if (!hold || !hold.items.length) return;
  try {
    const confirmation = typeof emailLedgerConfirmationLineGs_ === 'function'
      ? emailLedgerConfirmationLineGs_()
      : 'CONFIRMATION UNAVAILABLE: the email ledger is not installed, so the number of emails that went out cannot be stated.';
    const label = (emailJobScheduleGs_()[hold.job] || {}).label || hold.job;
    let subject, lines;
    if (hold.items.length === 1) {
      subject = hold.items[0].subject;
      lines = [confirmation, ''].concat(hold.items[0].bodyLines);
    } else {
      subject = label + ': ' + hold.items.length + ' alerts from this run';
      lines = [confirmation, ''];
      hold.items.forEach(function (it, i) {
        lines.push('--- Alert ' + (i + 1) + ' of ' + hold.items.length + ': ' + it.subject + ' ---');
        Array.prototype.push.apply(lines, it.bodyLines);
        lines.push('');
      });
    }
    const sent = sendOpsAlertNowGs_(subject, lines);
    if (typeof incidentNotifiedGs_ === 'function') {
      incidentNotifiedGs_(hold.items.map(function (it) { return it.incidentId; }), sent ? 'SENT' : 'SEND-FAILED', confirmation);
    }
  } catch (e) {
    Logger.log('emailAlertHoldFlushGs_ failed (' + (hold.items.length) + ' held alert(s)): ' + e);
  }
}

// ---- Overlapping-run lock (email audit P4 / F5) ----
// Every "already sent today?" guard in this project reads a log row that is only WRITTEN after the send, so two runs that
// overlap (a manual run alongside the trigger, a double-fired trigger, a slow run still going when the next one starts) both
// see "nothing sent yet" and both send to everyone. One script-wide lock around each automated-email job makes overlap
// impossible: a second job waits briefly, then SKIPS and tells ops (a skipped job is not retried — run it by hand once the
// other has finished).
//
// FAILS OPEN: only a clear "someone else holds the lock" (tryLock returns false) skips a job. If the lock service itself
// errors (cannot be reached, authorization problem), the job runs WITHOUT the lock and ops are alerted — a broken lock must
// never silently stop all three daily emails, which would be a worse failure than the overlap it guards against.
const EMAIL_JOB_LOCK_WAIT_MS_ = 30000;
function withEmailJobLockGs_(jobName, fn) {
  if (typeof LockService === 'undefined') {
    Logger.log(jobName + ': LockService is unavailable here — running without the overlap lock.');
    runEmailJobTrackedGs_(jobName, fn);
    return true;
  }
  let lock = null;
  let acquired = false;
  let lockError = null;
  try {
    lock = LockService.getScriptLock();
    acquired = lock.tryLock(EMAIL_JOB_LOCK_WAIT_MS_);
  } catch (e) {
    lockError = e;
  }
  if (lockError) {
    Logger.log(jobName + ': the overlap lock could not be used (' + lockError + ') — running WITHOUT it.');
    notifyOpsAlertGs_(jobName + ' ran WITHOUT its overlap lock', [
      jobName + ' ran, but the script lock could not be used: ' + lockError,
      'The job was NOT skipped. Until this is fixed an overlapping run (a manual run during the schedule, a double-fired trigger) is not prevented. Check the Apps Script project\'s authorization/quotas.',
    ]);
    runEmailJobTrackedGs_(jobName, fn);
    return true;
  }
  if (!acquired) {
    Logger.log(jobName + ' SKIPPED: another automated-email job still holds the script lock.');
    notifyOpsAlertGs_(jobName + ' SKIPPED — another email job was still running', [
      jobName + ' did not run: another automated-email job held the script lock for more than ' + (EMAIL_JOB_LOCK_WAIT_MS_ / 1000) + ' seconds.',
      'Running both at once would send duplicate emails, so this run was skipped, not queued. Check the Apps Script Executions list for the other run; if this run is still needed, run it by hand once that one has finished.',
    ]);
    return false;
  }
  try {
    runEmailJobTrackedGs_(jobName, fn);
    return true;
  } finally {
    try { lock.releaseLock(); } catch (relErr) { Logger.log(jobName + ': releaseLock failed: ' + relErr); }
  }
}

// ---- Job run records ("heartbeat") + completion watchdog (email audit P9 / F20 / F21) ----
// 2 Oct 2026: the 13:00 job ended `Failed` with a platform "server error occurred" and NOTHING told anyone — its own crash
// alert never arrived, and no check anywhere asked "did today's jobs run?". Each automated-email job now leaves a run record in
// Script Properties (written by withEmailJobLockGs_ above): `running` when it starts, `completed` or `failed` when it ends. A
// job killed by the platform (timeout, server error) never gets to write the ending, so its record stays `running` — which is
// exactly how the watchdog tells "died mid-run" from "still running" (a run older than the 30-minute execution cap) and from
// "never started" (no record for today). A quiet day — jobs that completed having nothing to send — is a `completed` record, so
// it never raises a false alarm the way "no log rows today" would.
//
// The record is machine state, not a report: it holds only the latest run per job. A broken Properties service never stops a
// job (every call here is wrapped), and a TEST MODE run writes nothing (test runs must not write production state — see
// writeUnlessTestModeGs_).
const EMAIL_JOB_DEADLINE_MINUTES_ = 30; // a job should have STARTED by its scheduled hour + this many minutes
const EMAIL_JOB_MAX_RUN_MINUTES_ = 35;  // a run still `running` this long after it started died (Apps Script's cap is 30)
function emailJobScheduleGs_() {
  const schedule = {
    sendOvernightMorningEmails: { hour: 10, label: '10:00 Overnight + Checkpoint 1 emails' },
    sendOvernightFollowupEmails: { hour: 13, label: '13:00 follow-up replies' },
    sendAllIssuesEmails: { hour: ALL_ISSUES_RUN_HOUR_, label: '17:00 All-Issues emails' },
  };
  // RmHierarchySync.gs (2026-10-08): the nightly HR-roster sync. Not an email job, but it shares the lock + run record, and a night
  // it silently does not run is a night the hierarchy keeps drifting. Only watched once that file is part of the project.
  if (typeof RMSYNC_RUN_HOUR_ !== 'undefined') schedule.syncRmHierarchyNightly = { hour: RMSYNC_RUN_HOUR_, label: '23:15 RM hierarchy sync' };
  // CycleReport.gs (Email Ops EO-8): the daily 16:30 report to Snehil. A job with a `minute` is due at hour:minute, so its deadline is that plus
  // EMAIL_JOB_DEADLINE_MINUTES_ (17:00 for this one). Only watched once that file is part of the project.
  // EmailSweep.gs (Email Ops EO-5): the daily 15:45 bounce/reply sweep that feeds the 16:30 report.
  if (typeof EMAIL_SWEEP_HOUR_ !== 'undefined') schedule.sweepEmailBouncesAndReplies = { hour: EMAIL_SWEEP_HOUR_, minute: EMAIL_SWEEP_MINUTE_, label: '15:45 bounce/reply sweep' };
  if (typeof CYCLE_REPORT_HOUR_ !== 'undefined') schedule.sendEmailCycleReport = { hour: CYCLE_REPORT_HOUR_, minute: CYCLE_REPORT_MINUTE_, label: '16:30 cycle report' };
  // OpsAudit.gs (Email Ops EO-3 / EO-4): the three silent audits that follow each email job (11:15, 14:00, 18:00). A silent job that stops running is invisible by design,
  // so the watchdog watches them like any other. Only watched once that file is part of the project.
  if (typeof OPS_AUDIT_SPECS_ !== 'undefined') {
    Object.keys(OPS_AUDIT_SPECS_).forEach(function (k) {
      const a = OPS_AUDIT_SPECS_[k];
      schedule[a.job] = { hour: a.hour, minute: a.minute, label: pad2Gs_(a.hour) + ':' + pad2Gs_(a.minute) + ' audit of the ' + a.label };
    });
  }
  return schedule;
}
function emailJobRunKeyGs_(jobName) { return 'EMAIL_JOB_RUN_' + jobName; }
function emailJobAlertedKeyGs_(jobName) { return 'EMAIL_JOB_ALERTED_' + jobName; }

// The latest run record for a job: the parsed object, null when there is none, or { unreadable: '<reason>' } when the Properties
// service itself failed (the watchdog treats that as a problem; it must not read as "never ran").
function readEmailJobRunGs_(jobName) {
  try {
    if (typeof PropertiesService === 'undefined') return { unreadable: 'PropertiesService is unavailable' };
    const raw = PropertiesService.getScriptProperties().getProperty(emailJobRunKeyGs_(jobName));
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    return { unreadable: String((e && e.message) || e) };
  }
}
function writeEmailJobRunGs_(jobName, record) {
  try {
    if (typeof PropertiesService === 'undefined') return false;
    PropertiesService.getScriptProperties().setProperty(emailJobRunKeyGs_(jobName), JSON.stringify(record));
    return true;
  } catch (e) {
    Logger.log(jobName + ': could not write its run record (' + e + ') — the job is not affected.');
    return false;
  }
}

// Runs the job body and records `running` -> `completed` / `failed`. A failure is re-thrown unchanged (the Executions list must
// still show Failed). In TEST MODE nothing is recorded and ops are told the run was a test run (F20: a left-on test mode silently
// redirects every real email to one address and skips every production log write).
function runEmailJobTrackedGs_(jobName, fn) {
  if (TEST_MODE_OVERRIDE_EMAIL_) {
    notifyOpsAlertGs_(jobName + ' ran in TEST MODE — real recipients suppressed', [
      jobName + ' started with TEST_MODE_OVERRIDE_EMAIL_ set (' + TEST_MODE_OVERRIDE_EMAIL_ + '): every email goes to that address only, and no log rows or run records are written.',
      'If this was a scheduled run, the real recipients got NOTHING and the "already sent today" guards saw nothing — clear TEST_MODE_OVERRIDE_EMAIL_ in EmailInfra.gs and run the job by hand.',
    ]);
    fn();
    return;
  }
  const started = new Date();
  const day = istDayKeyGs_(started);
  writeEmailJobRunGs_(jobName, { day: day, startedAt: started.toISOString(), status: 'running' });
  const holding = EMAIL_ALERT_HOLD_JOBS_.indexOf(jobName) !== -1; // EO-2: the three email jobs hold their alerts until they have ended
  if (holding) emailAlertHoldStartGs_(jobName);
  let failure = null;
  let failed = false;
  try {
    fn();
  } catch (e) {
    failure = e;
    failed = true;
  }
  writeEmailJobRunGs_(jobName, failed
    ? { day: day, startedAt: started.toISOString(), finishedAt: new Date().toISOString(), status: 'failed', error: String((failure && failure.message) || failure).slice(0, 300) }
    : { day: day, startedAt: started.toISOString(), finishedAt: new Date().toISOString(), status: 'completed' });
  if (holding) emailAlertHoldFlushGs_(); // never throws; sends the held alerts as one message behind the delivery count
  if (failed) throw failure; // re-thrown unchanged: the Executions list must still show Failed
}

// What is wrong with today's runs as of `now`? Returns [{ job, kind, detail }] — kind is 'never_started' (no record for today
// and the job's deadline has passed), 'stuck' (still `running` more than EMAIL_JOB_MAX_RUN_MINUTES_ after it started — it died),
// 'failed' (the run ended in an error), or 'unreadable' (the Properties service failed). A job whose deadline has not passed yet
// is never a problem. Pure apart from reading the records.
function emailJobProblemsGs_(now) {
  const day = istDayKeyGs_(now);
  const minutesIntoDay = Number(Utilities.formatDate(now, 'Asia/Kolkata', 'HH')) * 60 + Number(Utilities.formatDate(now, 'Asia/Kolkata', 'mm'));
  const schedule = emailJobScheduleGs_();
  const problems = [];
  Object.keys(schedule).forEach(function (job) {
    const spec = schedule[job];
    const dueAtMinutes = spec.hour * 60 + (spec.minute || 0) + EMAIL_JOB_DEADLINE_MINUTES_; // hour:minute + the grace period
    if (minutesIntoDay < dueAtMinutes) return; // not due yet
    const rec = readEmailJobRunGs_(job);
    if (rec && rec.unreadable) { problems.push({ job: job, kind: 'unreadable', detail: 'the run record could not be read: ' + rec.unreadable }); return; }
    if (!rec || rec.day !== day) {
      problems.push({ job: job, kind: 'never_started', detail: 'No run of ' + spec.label + ' is recorded for today (' + day + '), and it should have started by ' + Math.floor(dueAtMinutes / 60) + ':' + pad2Gs_(dueAtMinutes % 60) + ' IST.' });
      return;
    }
    if (rec.status === 'failed') {
      problems.push({ job: job, kind: 'failed', detail: spec.label + ' ended in an error: ' + (rec.error || '(no message recorded)') });
    } else if (rec.status === 'running') {
      const ageMin = (now.getTime() - new Date(rec.startedAt).getTime()) / 60000;
      if (ageMin > EMAIL_JOB_MAX_RUN_MINUTES_) {
        problems.push({ job: job, kind: 'stuck', detail: spec.label + ' started at ' + Utilities.formatDate(new Date(rec.startedAt), 'Asia/Kolkata', 'HH:mm:ss') + ' IST and never finished (' + Math.round(ageMin) + ' minutes ago) — the platform probably killed it (timeout or "server error occurred").' });
      }
    }
  });
  return problems;
}

// The watchdog body: alerts ops ONCE per job per day per kind of problem (an hourly trigger would otherwise repeat it) and
// returns the problems it found. 'unreadable' is not de-duplicated — a broken Properties service is exactly when the dedupe
// record cannot be trusted, and being told hourly is the right amount of noise.
function checkEmailJobsCompletedGs_(now) {
  // The Movement_Log snapshot job (MovementTracker.gs, email audit F23) shares this watchdog: its baselines feed the "Behind on
  // Today's Calls" flag in every email, and it is the job that hit the 30-minute limit. Its problems carry their own `marker`
  // (reported once per RUN, not once per day - it runs four times a day) and `hint`.
  const problems = emailJobProblemsGs_(now).concat(typeof snapshotRunProblemsGs_ === 'function' ? snapshotRunProblemsGs_(now) : []);
  const day = istDayKeyGs_(now);
  problems.forEach(function (p) {
    const alertedKey = emailJobAlertedKeyGs_(p.job);
    const marker = p.marker || (day + '|' + p.kind);
    if (p.kind !== 'unreadable') {
      let already = null;
      try { already = PropertiesService.getScriptProperties().getProperty(alertedKey); } catch (e) { already = null; }
      if (already === marker) return;
    }
    const whatByKind = { never_started: 'did not run', stuck: 'did not finish', failed: 'failed', overdue: 'is overdue', degraded: 'skipped work to stay inside its time limit' };
    const what = whatByKind[p.kind] || 'cannot be checked';
    notifyOpsAlertGs_('WATCHDOG: ' + p.job + ' ' + what, [
      p.detail,
      '',
      p.hint ? p.hint
        : p.kind === 'never_started' || p.kind === 'stuck'
          ? 'Check the Apps Script Executions list for ' + p.job + ' and the Triggers page. Once the cause is clear, run ' + p.job + 'Now by hand (it is safe to re-run: its "already sent today" guards stop it re-sending what already went out).'
          : 'See the Executions list for the full error. This watchdog alerts once per day per job and problem.',
    ]);
    if (p.kind !== 'unreadable') {
      try { PropertiesService.getScriptProperties().setProperty(alertedKey, marker); } catch (e2) { Logger.log('watchdog: could not record its alert for ' + p.job + ': ' + e2); }
    }
  });

  // Address configuration (email audit P13): the corporate addresses are looked up from the private employee table, so a missing
  // table / a person with no row must not go unnoticed. One alert per day for as long as the SAME set of problems persists.
  const configProblems = emailConfigProblemsGs_();
  if (configProblems.length) {
    const configKey = emailJobAlertedKeyGs_('__config');
    const configMarker = day + '|config|' + configProblems.map(function (p) { return p.key; }).join(',');
    let alreadyAlerted = null;
    try { alreadyAlerted = PropertiesService.getScriptProperties().getProperty(configKey); } catch (e) { alreadyAlerted = null; }
    if (alreadyAlerted !== configMarker) {
      notifyOpsAlertGs_('WATCHDOG: an email address cannot be resolved', configProblems.map(function (p) { return p.detail; }).concat([
        '',
        'The corporate addresses are no longer in the public repository: they come from RmHierarchy.private.gs (the git-ignored employee table pasted beside RmHierarchy.gs). Check that file is present in the Apps Script project and that each person above has a row; run showEmailConfigNow() to see exactly what resolves.',
      ]));
      try { PropertiesService.getScriptProperties().setProperty(configKey, configMarker); } catch (e2) { Logger.log('watchdog: could not record its config alert: ' + e2); }
    }
  }
  // Email Ops EO-2: alerts held by a job that was killed before it could send them are released here (EmailLedger.gs).
  if (typeof releaseHeldIncidentsGs_ === 'function') releaseHeldIncidentsGs_(now);
  return problems;
}

// The trigger entry point (installed by setupEmailJobWatchdogTrigger). Never throws into the platform — a watchdog that itself
// fails silently would be the same hole one level up.
function emailJobWatchdog() {
  try {
    checkEmailJobsCompletedGs_(new Date());
  } catch (e) {
    Logger.log('emailJobWatchdog failed: ' + e);
    notifyOpsAlertGs_('WATCHDOG itself failed', ['emailJobWatchdog threw: ' + (e && e.stack ? e.stack : e)]);
  }
}
function emailJobWatchdogNow() { emailJobWatchdog(); }

// One-time setup — ONE hourly trigger for emailJobWatchdog (safe to re-run: deletes its own earlier trigger first). Hourly,
// not pinned to a minute: the watchdog only compares the clock with each job's deadline, so loose firing is harmless — it alerts
// at the first run after a job's hh:30 deadline (about an hour of latency at worst). Run this ONCE after pasting this file
// (function dropdown -> setupEmailJobWatchdogTrigger -> Run).
function setupEmailJobWatchdogTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'emailJobWatchdog') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('emailJobWatchdog').timeBased().everyHours(1).create();
  Logger.log('Installed one hourly trigger for emailJobWatchdog. It alerts ' + opsAlertEmailGs_() + ' when an automated email job did not run, did not finish, or failed.');
}

// Logs each job's latest run record — for a human checking what the watchdog sees (Executions log).
function showEmailJobRunsNow() {
  const schedule = emailJobScheduleGs_();
  Object.keys(schedule).forEach(function (job) {
    Logger.log(job + ': ' + JSON.stringify(readEmailJobRunGs_(job)));
  });
  Logger.log('snapshotPeriodic: ' + JSON.stringify(readEmailJobRunGs_('snapshotPeriodic')));
}

// ---- Leads-tab freshness (Email Ops EO-10; plan decision D4) ----
// The Leads tab is refreshed about every other hour, at varying times, and carries no "last imported" cell, so its freshness is judged from the newest lead
// assignment time: more than 3 h old = AMBER, more than 5 h = RED. If the refresh process ever writes a timestamp cell, use that instead. It is a WARNING in the 16:30
// report only - it never changes or holds an email. (Not to be confused with a STALE LEAD - one with no activity for more than 24 h - see leadStaleStateGs_, MovementTracker.gs.)
const LEADS_FRESH_AMBER_HOURS_ = 3;
const LEADS_FRESH_RED_HOURS_ = 5;

function leadsFreshnessLevelGs_(ageHours) {
  if (ageHours > LEADS_FRESH_RED_HOURS_) return 'RED';
  if (ageHours > LEADS_FRESH_AMBER_HOURS_) return 'AMBER';
  return 'GREEN';
}

// How fresh the rows look: { level: GREEN|AMBER|RED|UNKNOWN, ageHours, newest, text }. UNKNOWN (never a guess) when no row has an assignment time. Times in the
// future (bad data) are ignored. Pure.
function leadsFreshnessFromRowsGs_(colIndex, dataRows, now) {
  let newest = null;
  (dataRows || []).forEach(function (row) {
    const v = getVal_(row, colIndex, 'lead_assigned_at');
    if (v instanceof Date && v.getTime() <= now.getTime() + 3600000 && (!newest || v.getTime() > newest.getTime())) newest = v;
  });
  if (!newest) return { level: 'UNKNOWN', ageHours: null, newest: null, text: 'UNKNOWN: the Leads tab has no lead assignment times to judge by' };
  const ageHours = Math.max(0, (now.getTime() - newest.getTime()) / 3600000);
  const level = leadsFreshnessLevelGs_(ageHours);
  const when = Utilities.formatDate(newest, 'Asia/Kolkata', 'd MMM HH:mm');
  const text = level + ': the newest lead was assigned ' + (Math.round(ageHours * 10) / 10) + ' h ago (' + when + ' IST)' +
    (level === 'GREEN' ? '' : ' - older than ' + (level === 'RED' ? LEADS_FRESH_RED_HOURS_ : LEADS_FRESH_AMBER_HOURS_) + ' h; the Leads tab refresh (about every 2 h) may be late, so the 17:00 emails would describe stale data');
  return { level: level, ageHours: ageHours, newest: newest, text: text };
}

// ---- Plain-text twin of a report email (email audit P2 / F13) ----
// The plain-text part used to be a one-line stub ("... Open this email in Gmail for the full breakdown."), so a text-only
// client or preview showed an email with no leads in it. This renders the SAME opts object the HTML is built from, so the two
// parts can never describe different content.
function plainTextFromReportOptsGs_(opts) {
  const o = opts || {};
  const lines = [];
  lines.push(String(o.title || ''));
  const regionLine = o.regionLabel || (o.region ? 'Region: ' + o.region : '');
  if (regionLine) lines.push(String(regionLine));
  if (o.subtitle) lines.push(String(o.subtitle));
  const kpis = (o.kpis || []).map(function (k) { return k.value + ' ' + k.label; });
  if (kpis.length) lines.push(kpis.join(' | '));
  if (o.action) { lines.push(''); lines.push('Recommended action: ' + o.action); }
  (o.sections || []).forEach(function (sec) {
    lines.push('');
    if (sec.regionBand) lines.push('== ' + sec.regionBand + ' ==');
    lines.push(String(sec.heading || '') + (sec.subheading ? ' - ' + sec.subheading : ''));
    lines.push('  ' + (sec.columns || []).join(' | '));
    (sec.rows || []).forEach(function (row) {
      lines.push('  ' + row.map(function (c) { return c == null ? '' : String(c); }).join(' | '));
    });
  });
  if (o.footerNote) { lines.push(''); lines.push(String(o.footerNote)); }
  return lines.join('\n');
}

// Single-section email: the section text plus the same signature the HTML carries.
function plainTextReportGs_(opts) {
  return plainTextFromReportOptsGs_(opts) + '\n\nRegards,\nHomesfy Lead Ops';
}

// Two-section email (10:00 digest, 13:00 reply): both sections, labelled, then one signature.
function plainTextTwoSectionGs_(section1Opts, section2Opts) {
  return 'Section 1 - ' + section1Opts.title + '\n' + plainTextFromReportOptsGs_(section1Opts) +
    '\n\n----------------------------------------\n\n' +
    'Section 2 - ' + section2Opts.title + '\n' + plainTextFromReportOptsGs_(section2Opts) +
    '\n\nRegards,\nHomesfy Lead Ops';
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
  const ledger = opts && opts.ledger; // Email Ops EO-1b: the evidence trail, passed on to the CH-level report
  const futworkRmNames = rmNames.filter(isFutworkRmNameGs_);
  const regularRmNames = rmNames.filter(function (n) { return !isFutworkRmNameGs_(n); });
  const pnlHeadEmail = regionPnlHeadEmailGs_(ss, region, hierarchyData);
  const resolved = withRetry_(function () { return resolveRecipientBucketsForRms_(ss, regularRmNames, hierarchyData); }, 'resolveRecipientBucketsForRms_ (' + region + ')');
  const results = resolved.buckets.map(function (b) {
    return { to: b.primaryEmail, cc: withRegionPnlHeadCcGs_(pnlHeadEmail, b.primaryEmail, b.cc.join(',')), rmNames: b.rmNames, source: 'RM_Hierarchy (' + b.primaryRole + ': ' + b.primaryName + ')', bucketLabel: b.primaryName, primaryRole: b.primaryRole };
  });

  if (fireAlerts) notifyChLevelLeadsGs_(region, resolved.chLevelRms, rmToLeads, dateLabel, ledger);

  let trulyUnresolved = [];
  if (resolved.unresolved.length) {
    const legacy = legacyRecipients[region];
    if (legacy) {
      // ALWAYS_CC_EMAILS_ (RmHierarchy.gs) applies even on the legacy
      // fallback path — it's an unconditional business requirement on every
      // overnight email, not something specific to RM_Hierarchy resolution.
      const ccSet = new Set((legacy.cc || '').split(',').map(function (s) { return s.trim(); }).filter(Boolean));
      alwaysCcEmailsGs_().forEach(function (e) { ccSet.add(e); });
      const unresolvedNames = resolved.unresolved.map(function (u) { return u.rmName; });
      results.push({ to: legacy.to, cc: withRegionPnlHeadCcGs_(pnlHeadEmail, legacy.to, Array.from(ccSet).join(',')), rmNames: unresolvedNames, source: 'Region_Recipients (fallback — RM_Hierarchy could not resolve: ' + unresolvedNames.join(', ') + ')', bucketLabel: 'Unmatched RMs', primaryRole: '' });
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
      // pending. Deliberately NO Cc here (fixed 2026-09-24, real
      // production case — this branch was cc'ing ALWAYS_CC_EMAILS_
      // (Ashish Kukreja + Saurabh Mishra) on a raw "couldn't route this at
      // all" backstop email, inconsistent with the SAME company-wide
      // backstop's other trigger (notifyChLevelLeadsGs_/
      // notifyChLevelIssuesGs_, OvernightEmailer.gs/AllIssuesEmailer.gs),
      // which already deliberately excludes leadership from this specific
      // kind of email — see that function's own comment: "per explicit
      // request, this goes only to OPS_ALERT_EMAIL_ + CH_LEVEL_EMAIL_, not
      // leadership". This branch now matches that same rule.
      const chUnresolvedNames = resolved.unresolved.map(function (u) { return u.rmName; });
      results.push({ to: chLevelEmailGs_(), cc: undefined, rmNames: chUnresolvedNames, source: 'CH-level backstop (no RM_Hierarchy match and no Region_Recipients fallback for ' + region + ': ' + chUnresolvedNames.join(', ') + ')', bucketLabel: 'Unmatched RMs (backstop)', primaryRole: '' });
    }
  }

  // Changed 2026-10-05 (email audit P7 / F9): two buckets that resolve to the SAME address (e.g. a Region_Recipients fallback
  // equal to an A1's own address) become ONE bucket here, before test mode redirects every address. The 10:00 job keyed its
  // Section 1 buckets by address, so the second bucket REPLACED the first: those leads were never emailed and never
  // reported as "not sent". The Futwork bucket is added AFTER the merge and stays its own bucket — Futwork RMs are keyed to
  // their own pseudo-region (regionKeyForRmGs_), so they never share a call with the regular buckets in a real run.
  const mergedResults = mergeBucketsByAddressGs_(results);

  if (futworkRmNames.length) {
    mergedResults.push({ to: futworkRouteEmailGs_(), cc: undefined, rmNames: futworkRmNames, source: 'Futwork override (RM name contains "Futwork": ' + futworkRmNames.join(', ') + ')', bucketLabel: 'Futwork', primaryRole: '' });
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
    const testResults = mergedResults.map(function (r) {
      return { to: TEST_MODE_OVERRIDE_EMAIL_, cc: undefined, rmNames: r.rmNames, source: r.source + ' [TEST MODE — real recipients suppressed, sent to ' + TEST_MODE_OVERRIDE_EMAIL_ + ' only]', bucketLabel: r.bucketLabel, primaryRole: r.primaryRole, originalTo: r.to, originalCc: r.cc };
    });
    return { results: testResults, trulyUnresolved: trulyUnresolved, chLevelRms: resolved.chLevelRms };
  }

  return { results: mergedResults, trulyUnresolved: trulyUnresolved, chLevelRms: resolved.chLevelRms };
}

// Merges resolved recipient buckets that share a To address (case-insensitive, trimmed) into one: the first bucket keeps its
// label/role/address, takes the union of the RM names, and the union of the Cc addresses (never the To address itself, never
// a repeat); `source` shows every origin. A bucket with no To address is left alone (the send gate reports it). Pure — the
// input buckets are not modified. Used by resolveRecipientEmailsForRegion_ (email audit P7 / F9).
function mergeBucketsByAddressGs_(buckets) {
  const merged = [];
  const byAddress = {};
  const ccList = function (cc) { return String(cc || '').split(',').map(function (x) { return x.trim(); }).filter(Boolean); };
  buckets.forEach(function (b) {
    const key = String(b.to || '').trim().toLowerCase();
    if (!key) { merged.push(b); return; }
    const first = byAddress[key];
    if (!first) {
      const copy = Object.assign({}, b, { rmNames: (b.rmNames || []).slice() });
      byAddress[key] = copy;
      merged.push(copy);
      return;
    }
    (b.rmNames || []).forEach(function (n) { if (first.rmNames.indexOf(n) === -1) first.rmNames.push(n); });
    const seen = {};
    seen[key] = true;
    const ccs = [];
    ccList(first.cc).concat(ccList(b.cc)).forEach(function (addr) {
      const k = addr.toLowerCase();
      if (!seen[k]) { seen[k] = true; ccs.push(addr); }
    });
    first.cc = ccs.join(',') || undefined;
    first.source = first.source + ' + ' + b.source;
  });
  return merged;
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

// ============ CH-LEVEL REPORT GROUPING (shared) ============
// Extracted from OvernightEmailer.gs's notifyChLevelLeadsGs_ and
// AllIssuesEmailer.gs's notifyChLevelIssuesGs_ — both built the exact
// same three groupings inline, byte-for-byte identical, before diverging
// into their own subject/KPI/section wording (2026-09 modularity
// refactor; pure code motion — the two callers' own logic is unchanged,
// they just call these instead of repeating them).

// Groups a resolveRecipientBucketsForRms_ chLevelRms list by the CH each
// entry routes to — {chName: {chEmail, chRole, rmNames: [...]}}.
function groupChLevelRmsByCh_(chLevelRms) {
  const byCh = {};
  chLevelRms.forEach(function (r) {
    if (!byCh[r.chName]) byCh[r.chName] = { chEmail: r.chEmail, chRole: r.chRole, rmNames: [] };
    byCh[r.chName].rmNames.push(r.rmName);
  });
  return byCh;
}

// Splits one CH-level entry's rmNames into the CH's own self-held leads
// (rmName === chName, case-insensitive) vs. names that genuinely report
// up to the CH — two different situations each caller explains with its
// own note/action wording (a self-held lead has nobody below to route
// through; a reporting-up name is missing a TL/TM/RH in RM_Hierarchy).
function splitSelfAndReportingRmNames_(chName, rmNames) {
  const selfRmNames = rmNames.filter(function (n) { return n.toLowerCase() === chName.toLowerCase(); });
  const reportingRmNames = rmNames.filter(function (n) { return n.toLowerCase() !== chName.toLowerCase(); });
  return { selfRmNames: selfRmNames, reportingRmNames: reportingRmNames };
}

// Groups one CH-level entry's leads by whoever actually holds each one
// (the real RM name, looked up in rmToLeads — the CH's own name for a
// self-held case, per splitSelfAndReportingRmNames_ above), drops any RM
// with zero leads, and flattens into one list sorted by RM name — same
// "who currently holds this" grouping a normal per-RM email already uses.
function groupLeadsByRmAndFlatten_(rmNames, rmToLeads) {
  const byRM = {};
  rmNames.forEach(function (rmName) {
    const leads = (rmToLeads && rmToLeads[rmName]) || [];
    if (leads.length) byRM[rmName] = leads;
  });
  const rmKeys = Object.keys(byRM).sort();
  const allLeads = [];
  rmKeys.forEach(function (rm) { allLeads.push.apply(allLeads, byRM[rm]); });
  return { byRM: byRM, rmKeys: rmKeys, allLeads: allLeads };
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
        // esc_ already maps null/undefined to '' — String(cell) first turned a missing cell into the literal text "undefined".
        row.map(function (cell) { return '<td style="padding:6px 10px; color:#374151; ' + FONT + '">' + esc_(cell) + '</td>'; }).join('') +
        '</tr>';
    }).join('');
    const regionBandHtml = sec.regionBand
      ? '<div style="margin-top:22px; background:#1f2937; color:#ffffff; border-radius:6px; padding:8px 14px; font-size:12px; font-weight:700; letter-spacing:.06em; text-transform:uppercase; ' + FONT + '">' + esc_(sec.regionBand) + '</div>'
      : '';
    return regionBandHtml + '<div style="margin-top:' + (sec.regionBand ? '8' : '16') + 'px; border-left:4px solid ' + accentFg + '; background:' + accentBg + '; border-radius:0 8px 8px 0; padding:12px 16px;">' +
      '<div style="' + FONT + ' font-weight:700; font-size:14px; color:#1f2937;">' + esc_(sec.heading) + '</div>' +
      (sec.subheading ? '<div style="' + FONT + ' font-size:11.5px; color:#6b7280; margin-bottom:8px;">' + esc_(sec.subheading) + '</div>' : '') +
      '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#ffffff; border-radius:6px; border:1px solid #e5e7eb; font-size:12px; border-collapse:collapse; margin-top:6px;">' +
      headerRow + bodyRows + '</table></div>';
  }).join('');

  return '<div style="' + FONT + ' max-width:640px; margin:0 auto; background:#ffffff; color:#1f2937;">' +
    '<div style="background:#4338ca; padding:22px 26px;">' +
    '<div style="color:#c7d2fe; font-size:11px; letter-spacing:1.4px; text-transform:uppercase; font-weight:700; margin-bottom:6px; ' + FONT + '">Lead Funnel · SLA Monitor</div>' +
    '<div style="color:#ffffff; font-size:21px; font-weight:700; margin-bottom:4px; ' + FONT + '">' + esc_(opts.title) + '</div>' +
    '<div style="color:#ffffff; font-size:13px; font-weight:600; margin-bottom:2px; ' + FONT + '">' + esc_(opts.regionLabel || ('Region: ' + opts.region)) + '</div>' +
    '<div style="color:#e0e7ff; font-size:12.5px; ' + FONT + '">' + esc_(opts.subtitle) + '</div>' +
    '</div>' +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:14px;"><tr>' + kpiCells + '</tr></table>' +
    actionBox + sectionsHtml +
    (opts.footerNote ? '<div style="margin-top:18px; font-size:11px; color:#9ca3af; ' + FONT + '">' + esc_(opts.footerNote) + '</div>' : '') +
    '<div style="margin-top:16px; font-size:13px; color:#374151; white-space:pre-line; ' + FONT + '">Regards,\nHomesfy Lead Ops</div>' +
    '</div>';
}
