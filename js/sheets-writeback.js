/* ============ BROWSER-TRIGGERED SNAPSHOT (writes to Movement_Log) ============
 * MovementTracker.gs's every-6-hours trigger is the reliable baseline —
 * it runs on Google's servers with or without anyone watching. This is an
 * EXTRA, opt-in capture path: whoever has the dashboard open can also grab
 * an on-the-spot checkpoint, timestamped with THEIR browser's own clock,
 * either automatically each refresh or on demand.
 *
 * Writing needs Sheets WRITE access, which the mandatory sign-in gate
 * already requests (GATE_SCOPE includes the full "spreadsheets" scope, not
 * just .readonly) — so there's no separate connect step here anymore, just
 * gateAccessToken/gateTokenValid() reused directly.
 */
const AUTO_SNAPSHOT_KEY = 'gsl_auto_snapshot_on_refresh';

function initAutoSnapshotCheckbox(){
  const cb = document.getElementById('autoSnapshotCheck');
  if (!cb) return;
  let saved = false;
  try { saved = localStorage.getItem(AUTO_SNAPSHOT_KEY) === '1'; } catch (e) {}
  cb.checked = saved;
  cb.addEventListener('change', () => {
    try { localStorage.setItem(AUTO_SNAPSHOT_KEY, cb.checked ? '1' : '0'); } catch (e) {}
  });
}

function autoSnapshotEnabled(){
  const cb = document.getElementById('autoSnapshotCheck');
  return !!(cb && cb.checked);
}

// Full "YYYY-MM-DD HH:mm:ss" IST wall-clock string — the exact literal
// format parseDate() already treats as an IST timestamp everywhere else in
// this file, and the format Sheets' USER_ENTERED parser will recognize as
// a real datetime (matching how MovementTracker.gs's own writes render),
// AS LONG AS the spreadsheet's own timezone is set to Asia/Kolkata per the
// setup instructions.
function istDateTimeValue(date){
  const p = istParts(date);
  const pad = n => String(n).padStart(2, '0');
  return `${p.y}-${pad(p.mo + 1)}-${pad(p.d)} ${pad(p.h)}:${pad(p.mi)}:${pad(p.s)}`;
}

// Most fields pass straight through as already-fetched values. The two
// date fields get re-rendered as an IST literal rather than the ISO/Z
// string enrichLead's source data carries internally, so this column
// stays visually consistent with MovementTracker.gs's own writes.
function movementCellValue(l, key){
  if (key === 'lead_assigned_at' || key === 'last_connect_time') {
    const d = parseDate(l[key]);
    return d ? istDateTimeValue(d) : '';
  }
  const v = l[key];
  return v == null ? '' : v;
}

// Generic append — used for Movement_Log snapshots, the Lead_Followups
// export, and SLA_History, parameterized by tab name rather than
// duplicated per tab. valueInputOption defaults to USER_ENTERED (Sheets
// parses the value the way typing it into the UI would) since
// Movement_Log's Date objects need that to land as real, sortable date
// cells — pass 'RAW' for a tab where nothing should ever be
// reinterpreted (see upsertSlaHistoryRows: a "2026-08-19" TEXT date-key
// getting silently auto-converted to a bare date-serial number was
// exactly this kind of unwanted interpretation).
async function appendSheetRows(tabName, rows, valueInputOption){
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${_currentSheetId}/values/` +
    `${encodeURIComponent(tabName)}:append?valueInputOption=${valueInputOption || 'USER_ENTERED'}&insertDataOption=INSERT_ROWS`;
  const resp = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${gateAccessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ values: rows }),
  });
  if (!resp.ok) {
    const errBody = await resp.json().catch(() => ({}));
    throw new Error((errBody.error && errBody.error.message) || `Sheets API error ${resp.status}`);
  }
  return resp.json();
}

// Writes multiple, possibly non-contiguous ranges in one request — used by
// pushLeadsToFollowups to update an existing lead's A:E, G and H columns
// without touching F (suggested_followup) in between, which a single
// contiguous range write couldn't do without clobbering it. Same
// valueInputOption override as appendSheetRows above, same reason.
async function sheetsApiValuesBatchUpdate(data, valueInputOption){
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${_currentSheetId}/values:batchUpdate`;
  const resp = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${gateAccessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ valueInputOption: valueInputOption || 'USER_ENTERED', data }),
  });
  if (!resp.ok) {
    const errBody = await resp.json().catch(() => ({}));
    throw new Error((errBody.error && errBody.error.message) || `Sheets API error ${resp.status}`);
  }
  return resp.json();
}

function setFollowupsPushStatus(text, color, elId){
  const el = document.getElementById(elId || 'followupsPushStatus');
  if (el) { el.textContent = text; el.style.color = color; }
}

/* ============ SEND LOG (one row per successful Gmail send) ============
 * A durable, shared record of every region email actually sent — not the
 * "Sent ✓" button state (that's a purely local, 1-hour, per-browser
 * localStorage cache just for the resend-window UI, see markReportSent in
 * reports.js). Every send path (a single report's "Send via Gmail" button,
 * either bulk "Send all via Gmail" flow) funnels through performGmailSend,
 * which is the one place logEmailSend is called from, so every issue type
 * and every entry point is covered without needing to touch each button's
 * own handler individually.
 */
const SEND_LOG_TAB_NAME = 'Send_Log';
const SEND_LOG_COLUMNS = ['sent_at', 'issue_key', 'issue_label', 'region', 'subject', 'to', 'cc', 'lead_count', 'sent_by'];

// Cached per page-load once confirmed present — avoids a metadata round
// trip (getSheetIdByTabName) before every single send, not just the first.
// A tab deleted mid-session would make later sends fail loudly in
// logEmailSend's own catch (console only, per its own comment) rather than
// silently recreating it — acceptable, since that's an unusual enough
// action to just require a page refresh to recover from.
let _sendLogSheetEnsured = false;
async function ensureSendLogSheet_(){
  if (_sendLogSheetEnsured) return;
  const existingId = await getSheetIdByTabName(SEND_LOG_TAB_NAME);
  if (existingId == null) {
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${_currentSheetId}:batchUpdate`;
    const resp = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${gateAccessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ requests: [{ addSheet: { properties: { title: SEND_LOG_TAB_NAME } } }] }),
    });
    if (!resp.ok) {
      const errBody = await resp.json().catch(() => ({}));
      throw new Error((errBody.error && errBody.error.message) || `Sheets API error ${resp.status}`);
    }
    await appendSheetRows(SEND_LOG_TAB_NAME, [SEND_LOG_COLUMNS], 'RAW');
  }
  _sendLogSheetEnsured = true;
}

// Best-effort: the email has already genuinely sent (Gmail API returned
// success) by the time performGmailSend calls this — a logging failure here
// must never look like the send itself failed, so every error stays local
// to a console warning rather than propagating to the caller or the UI.
async function logEmailSend(report, to, cc){
  try {
    await ensureSendLogSheet_();
    await appendSheetRows(SEND_LOG_TAB_NAME, [[
      istDateTimeValue(new Date()),
      report.issueKey || '',
      report.issueLabel || '',
      (report.regionNames && report.regionNames.join(', ')) || report.region || '',
      report.subject || '',
      to || '',
      cc || '',
      report.count != null ? report.count : '',
      gateUserEmail || '',
    ]], 'RAW');
  } catch (err) {
    console.error('Send_Log write failed (email itself was still sent successfully):', err);
  }
}

// Writes/updates Lead_Followups with the exact leads that just appeared in
// the combined All Issues email — see renderReports, which calls this with
// buildRegionWiseReports's own `sorted` (open, not Opportunity+, one of the
// 5 SLA issues; never notConnected/stuck-only/closed leads — see the
// comment on that return statement). Column layout: A lead_id, B region,
// C RM, D issue, E collated_comments, F suggested_followup, G updated_at,
// H own_comments.
//
// collated_comments (E) is the WHOLE customer's history across every RM
// who's held a copy (collateFamilyComments) — own_comments (H) is just
// this one row's own copy (ownComments), so a reader can tell at a glance
// what THIS specific RM actually logged, separate from the full picture.
//
// Upserts by lead_id rather than always appending, so a lead still flagged
// on the next Generate updates its existing row instead of duplicating it.
// Deliberately never writes column F — that's filled in by a person (or a
// later automation) reading collated_comments, and this file has no way to
// know whether a value already sitting there is still meaningful; the only
// safe move is to leave it alone. That's also why existing rows are
// updated as three separate ranges (A:E, G and H) rather than one A:H
// write, which would silently blank out anything in F.
async function pushLeadsToFollowups(rows, statusElId){
  if (!rows.length) return true;
  if (!_currentSheetId) return false;

  if (!gateTokenValid()) {
    setFollowupsPushStatus('Re-signing in…', 'var(--text-faint)', statusElId);
    await gateSignIn();
    if (!gateTokenValid()) {
      setFollowupsPushStatus('Sign-in required to write Lead_Followups.', 'var(--amber)', statusElId);
      return false;
    }
  }

  setFollowupsPushStatus('Writing Lead_Followups…', 'var(--text-faint)', statusElId);

  try {
    const existingValues = await sheetsApiValuesGet(_currentSheetId, `${LEAD_FOLLOWUPS_TAB_NAME}!A2:A`);
    const rowNumberByLeadId = {};
    existingValues.forEach((r, i) => {
      const id = String((r && r[0]) || '').trim();
      if (id) rowNumberByLeadId[id] = i + 2; // +2: row 1 is the header, existingValues is 0-indexed from row 2
    });

    const updatedAt = istDateTimeValue(new Date());
    const updateData = [];
    const appendRows = [];

    const formatEntries = (entries, emptyText) => entries
      .map(e => `${e.RM}: ${e.comment} (${e.timestamp || 'no date'}) [${e.outcome}]`)
      .join('\n') || emptyText;

    rows.forEach(r => {
      const leadId = String(r.lead_id).trim();
      if (!leadId) return;
      const collated = formatEntries(collateFamilyComments(r), '(no comments logged)');
      const own = formatEntries(ownComments(r), '(no comments logged on this copy)');

      const rowNum = rowNumberByLeadId[leadId];
      if (rowNum) {
        updateData.push({ range: `${LEAD_FOLLOWUPS_TAB_NAME}!A${rowNum}:E${rowNum}`, values: [[leadId, r.mainRegion || r.region || '', r.RM || '', r.issue || '', collated]] });
        updateData.push({ range: `${LEAD_FOLLOWUPS_TAB_NAME}!G${rowNum}:G${rowNum}`, values: [[updatedAt]] });
        updateData.push({ range: `${LEAD_FOLLOWUPS_TAB_NAME}!H${rowNum}:H${rowNum}`, values: [[own]] });
      } else {
        appendRows.push([leadId, r.mainRegion || r.region || '', r.RM || '', r.issue || '', collated, '', updatedAt, own]);
      }
    });

    if (updateData.length) await sheetsApiValuesBatchUpdate(updateData);
    if (appendRows.length) await appendSheetRows(LEAD_FOLLOWUPS_TAB_NAME, appendRows);

    setFollowupsPushStatus(
      `Lead_Followups updated: ${updateData.length / 3} updated, ${appendRows.length} added.`,
      'var(--green)', statusElId
    );
    return true;
  } catch (err) {
    setFollowupsPushStatus(`Lead_Followups write failed: ${err.message}`, 'var(--red)', statusElId);
    return false;
  }
}

// A tab's row/column edits go through the `values` endpoints used
// everywhere else in this file, but deleting rows outright is a sheet-
// structure operation, which needs the tab's own internal numeric sheetId
// (unrelated to _currentSheetId, the spreadsheet's string ID) rather than
// its name. Returns null if no tab with that title exists.
async function getSheetIdByTabName(tabName){
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${_currentSheetId}?fields=sheets.properties(sheetId,title)`;
  const resp = await fetch(url, { headers: { Authorization: `Bearer ${gateAccessToken}` } });
  if (!resp.ok) {
    const errBody = await resp.json().catch(() => ({}));
    throw new Error((errBody.error && errBody.error.message) || `Sheets API error ${resp.status}`);
  }
  const data = await resp.json();
  const match = (data.sheets || []).find(s => s.properties && s.properties.title === tabName);
  return match ? match.properties.sheetId : null;
}

// A Generate cycle owns Lead_Followups from its clearLeadFollowupsTab()
// call through to its own re-render — that whole window depends on the
// tab containing exactly THIS run's leads and nothing else. Two Generate
// buttons exist (Operations' own, and Movement's Overnight one), each
// triggerable independently and each capable of running a multi-minute
// wait (waitForAllFollowups has no timeout), so nothing stopped a second
// Generate from clearing/rewriting the tab out from under a first one
// still mid-wait. tryClaimGenerateCycle/releaseGenerateCycle make that a
// hard exclusion instead: whichever Generate asks first gets the tab,
// the other is told to wait rather than silently corrupting it.
let _generateCycleOwner = null; // null | 'operations' | 'overnight'

function tryClaimGenerateCycle(owner){
  if (_generateCycleOwner && _generateCycleOwner !== owner) return false;
  _generateCycleOwner = owner;
  return true;
}
function releaseGenerateCycle(owner){
  if (_generateCycleOwner === owner) _generateCycleOwner = null;
}
function generateCycleOwnerLabel(owner){
  return owner === 'operations' ? "the Operations tab's Generate" : "Movement's Overnight Generate Region Emails";
}

// Wipes every data row (everything below the header) from Lead_Followups —
// called at the START of every Generate cycle (see renderReports and
// renderOvernightRegionReports, both call this before pushing their own
// leads), so a lead's collated history and suggestion never carry over
// from a previous run and get mistaken for something filled in for THIS
// run. Not send-gated: it runs regardless of whether the report that
// follows ends up going out via Gmail or mailto, or gets abandoned/
// cancelled at the wait step — the guarantee this provides is "each
// Generate starts from a clean tab," not "the tab reflects only sent mail."
async function clearLeadFollowupsTab(){
  const sheetId = await getSheetIdByTabName(LEAD_FOLLOWUPS_TAB_NAME);
  if (sheetId == null) return;

  const existingValues = await sheetsApiValuesGet(_currentSheetId, `${LEAD_FOLLOWUPS_TAB_NAME}!A2:A`);
  if (!existingValues.length) return; // already empty

  const url = `https://sheets.googleapis.com/v4/spreadsheets/${_currentSheetId}:batchUpdate`;
  const resp = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${gateAccessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      requests: [{
        // 0-indexed, half-open range: row 2 (first data row) is index 1;
        // deletes through the last row this read actually found data in.
        deleteDimension: { range: { sheetId, dimension: 'ROWS', startIndex: 1, endIndex: 1 + existingValues.length } },
      }],
    }),
  });
  if (!resp.ok) {
    const errBody = await resp.json().catch(() => ({}));
    throw new Error((errBody.error && errBody.error.message) || `Sheets API error ${resp.status}`);
  }
}

// Upserts one row per {snapshot_at, date, source, openTotal, breachedTotal,
// byCheck} entry into SLA_History, keyed by snapshot_at (column I) — one
// row per actual capture instant, not per day, so intra-day swings survive
// instead of collapsing to a single daily number. Shared by the live
// snapshot (snapshotSlaHistory, one entry per refresh, source='Dashboard')
// and the one-time backfillSlaHistoryFromMovementLog below (one entry per
// historical Movement_Log instant, source='Backfill'). Column layout:
// A date, B openTotal, C breachedTotal, D-H one column per ISSUE_PRIORITY
// key, I snapshot_at, J source. date/openTotal/etc. stay in their original
// A-H position (matching the tab as it was first set up) — snapshot_at and
// source were added afterward, at the end, so the existing columns never
// had to be reshuffled.
async function upsertSlaHistoryRows(entries){
  if (!entries.length) return;
  if (!_currentSheetId) return;

  const existingValues = await sheetsApiValuesGet(_currentSheetId, `${SLA_HISTORY_TAB_NAME}!I2:I`);
  const rowNumberBySnapshotAt = {};
  existingValues.forEach((r, i) => {
    const s = String((r && r[0]) || '').trim();
    if (s) rowNumberBySnapshotAt[s] = i + 2; // +2: row 1 is the header, existingValues is 0-indexed from row 2
  });

  const checkKeys = ISSUE_PRIORITY.map(rule => rule.key);
  const updateData = [];
  const appendRows = [];

  entries.forEach(({ snapshot_at, date, source, openTotal, breachedTotal, byCheck }) => {
    const rowValues = [date, openTotal, breachedTotal, ...checkKeys.map(k => byCheck[k] || 0), snapshot_at, source];
    const rowNum = rowNumberBySnapshotAt[snapshot_at];
    if (rowNum) {
      updateData.push({ range: `${SLA_HISTORY_TAB_NAME}!A${rowNum}:J${rowNum}`, values: [rowValues] });
    } else {
      appendRows.push(rowValues);
    }
  });

  // RAW, not the default USER_ENTERED — none of these columns need Sheets'
  // own type interpretation, and USER_ENTERED is exactly what silently
  // turned the "2026-08-19" date TEXT into a bare date-serial number in
  // some rows but not others.
  if (updateData.length) await sheetsApiValuesBatchUpdate(updateData, 'RAW');
  if (appendRows.length) await appendSheetRows(SLA_HISTORY_TAB_NAME, appendRows, 'RAW');

  // Appends land at the bottom regardless of their own snapshot_at, and a
  // backfill batch's internal order doesn't reflect whatever was already
  // in the sheet from earlier live/backfill runs — sort once at the end so
  // the tab always reads chronologically no matter which write path or
  // combination of them produced it.
  if (updateData.length || appendRows.length) {
    try { await sortSlaHistorySheet_(); } catch (e) { /* rows are still correct, just not reordered this time */ }
  }
}

// Sorts SLA_History's data rows (everything below the header) ascending by
// snapshot_at (column I) — called once at the end of every
// upsertSlaHistoryRows batch, not after each individual write.
async function sortSlaHistorySheet_(){
  const sheetId = await getSheetIdByTabName(SLA_HISTORY_TAB_NAME);
  if (sheetId == null) return;

  const url = `https://sheets.googleapis.com/v4/spreadsheets/${_currentSheetId}:batchUpdate`;
  const resp = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${gateAccessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      requests: [{
        sortRange: {
          // startRowIndex is the only bound set — GridRange with no
          // endRowIndex/endColumnIndex means "to the sheet's actual
          // extent," so this doesn't need a fresh row-count read after
          // the writes above.
          range: { sheetId, startRowIndex: 1, startColumnIndex: 0 },
          sortSpecs: [{ dimensionIndex: 8, sortOrder: 'ASCENDING' }], // column I = snapshot_at
        },
      }],
    }),
  });
  if (!resp.ok) {
    const errBody = await resp.json().catch(() => ({}));
    throw new Error((errBody.error && errBody.error.message) || `Sheets API error ${resp.status}`);
  }
}

// Wired to #backfillSlaHistoryBtn on the Tracking tab (see tab-tracking.js)
// — still directly console-callable too (`await
// backfillSlaHistoryFromMovementLog()`). Originally console-only since a
// one-time migration doesn't need permanent UI real estate, but it's also
// exactly the fix for "SLA_History is missing/incomplete data," which is
// worth a real button once one exists.
//
// Reconstructs one SLA_History row for EVERY Movement_Log capture instant
// (not collapsed to one per day) — movementSnapshots is flat, one row per
// (lead, capture instant), so this first regroups by exact snapshot_at,
// then enriches each instant's leads exactly like a live snapshot
// (enrichSnapshotCached applies every SLA rule AS OF that snapshot's own
// timestamp, not now). Marked source='Backfill' so these rows stay
// distinguishable from ones MovementTracker.gs writes automatically going
// forward. Safe to re-run — upserts by snapshot_at, so a repeat run just
// overwrites the same instants with the same numbers, no duplicates.
async function backfillSlaHistoryFromMovementLog(){
  if (!movementSnapshots.length) { console.warn('No Movement_Log data loaded — refresh first.'); return; }

  const byInstant = new Map(); // snapshot_at ms -> records[]
  movementSnapshots.forEach(rec => {
    const ms = rec.snapshot_at.getTime();
    if (!byInstant.has(ms)) byInstant.set(ms, []);
    byInstant.get(ms).push(rec);
  });

  const checkKeys = ISSUE_PRIORITY.map(rule => rule.key);
  const entries = [];
  byInstant.forEach((recs, ms) => {
    const byCheck = {};
    checkKeys.forEach(k => { byCheck[k] = 0; });
    let openTotal = 0, breachedTotal = 0;
    recs.forEach(rec => {
      const enriched = enrichSnapshotCached(rec);
      if (!enriched.isOpenLead) return;
      openTotal++;
      let isBreached = false;
      checkKeys.forEach(k => { if (enriched[k]) { byCheck[k]++; isBreached = true; } });
      if (isBreached) breachedTotal++;
    });
    const at = new Date(ms);
    entries.push({ snapshot_at: istDateTimeValue(at), date: istDateKey(at), source: 'Backfill', openTotal, breachedTotal, byCheck });
  });
  entries.sort((a, b) => a.snapshot_at.localeCompare(b.snapshot_at));

  console.log(`Backfilling ${entries.length} snapshot(s) into ${SLA_HISTORY_TAB_NAME}…`);
  await upsertSlaHistoryRows(entries);
  console.log('Done.');
}

/* ============ DAILY COHORT HISTORY (day-wise Same-Day/48h Opp% per region) ============
 * Tracking's "Daily Cohort by Region" section (tab-tracking.js) only ever
 * computes live, for whichever single date is picked, from whatever's
 * still inside Movement_Log's 7-day retention — there was no way to ask
 * "is same-day/48h conversion actually improving over the last month"
 * without this. Same pattern as SLA_History just above: an upsert-by-key
 * write (persistDailyCohortHistory in tab-tracking.js calls this once per
 * refresh), plus a manual backfill/clear pair for a one-time catch-up or
 * reset. Unlike SLA_History (one row per exact snapshot instant), the key
 * here is date+region — one row per region per calendar day, only ever
 * written once that day's ENTIRE 48h window has elapsed, so a stored row
 * is always a FINAL number, never a partial one a later run has to
 * silently correct.
 */
const DAILY_COHORT_HISTORY_TAB_NAME = 'Daily_Cohort_History';
const DAILY_COHORT_HISTORY_COLUMNS = [
  'date_region', 'date', 'region', 'created', 'same_day_resolved', 'same_day_opp',
  'window_complete', 'resolved_48h', 'opp_48h', 'closed_48h', 'updated_at', 'source',
];

// Same lazy-create-once pattern as ensureSendLogSheet_ above.
let _dailyCohortHistorySheetEnsured = false;
async function ensureDailyCohortHistorySheet_(){
  if (_dailyCohortHistorySheetEnsured) return;
  const existingId = await getSheetIdByTabName(DAILY_COHORT_HISTORY_TAB_NAME);
  if (existingId == null) {
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${_currentSheetId}:batchUpdate`;
    const resp = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${gateAccessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ requests: [{ addSheet: { properties: { title: DAILY_COHORT_HISTORY_TAB_NAME } } }] }),
    });
    if (!resp.ok) {
      const errBody = await resp.json().catch(() => ({}));
      throw new Error((errBody.error && errBody.error.message) || `Sheets API error ${resp.status}`);
    }
    await appendSheetRows(DAILY_COHORT_HISTORY_TAB_NAME, [DAILY_COHORT_HISTORY_COLUMNS], 'RAW');
  }
  _dailyCohortHistorySheetEnsured = true;
}

// Upserts one row per {date, region, source, stats} entry, keyed by
// "date|region" (column A) — stats carries computeDailyCohortByRegion's
// own {created, sameDayResolved, sameDayOpp, windowComplete, resolved48h,
// opp48h, closed48h} shape directly, stored as raw counts (not
// pre-computed percentages) so this stays re-sliceable later, same
// convention as SLA_History's byCheck counts above. RAW, not
// USER_ENTERED, same reasoning as upsertSlaHistoryRows — a "2026-08-19"
// TEXT date-key must never get auto-converted to a bare date serial.
async function upsertDailyCohortHistoryRows(entries){
  if (!entries.length) return;
  if (!_currentSheetId) return;
  await ensureDailyCohortHistorySheet_();

  const existingValues = await sheetsApiValuesGet(_currentSheetId, `${DAILY_COHORT_HISTORY_TAB_NAME}!A2:A`);
  const rowNumberByKey = {};
  existingValues.forEach((r, i) => {
    const k = String((r && r[0]) || '').trim();
    if (k) rowNumberByKey[k] = i + 2; // +2: row 1 is the header, existingValues is 0-indexed from row 2
  });

  const updatedAt = istDateTimeValue(new Date());
  const updateData = [];
  const appendRows = [];

  entries.forEach(({ date, region, source, stats }) => {
    const key = `${date}|${region}`;
    const rowValues = [
      key, date, region, stats.created, stats.sameDayResolved, stats.sameDayOpp,
      stats.windowComplete, stats.resolved48h, stats.opp48h, stats.closed48h, updatedAt, source,
    ];
    const rowNum = rowNumberByKey[key];
    if (rowNum) {
      updateData.push({ range: `${DAILY_COHORT_HISTORY_TAB_NAME}!A${rowNum}:L${rowNum}`, values: [rowValues] });
    } else {
      appendRows.push(rowValues);
    }
  });

  if (updateData.length) await sheetsApiValuesBatchUpdate(updateData, 'RAW');
  if (appendRows.length) await appendSheetRows(DAILY_COHORT_HISTORY_TAB_NAME, appendRows, 'RAW');
  if (updateData.length || appendRows.length) {
    try { await sortDailyCohortHistorySheet_(); } catch (e) { /* rows are still correct, just not reordered this time */ }
  }
}

// Sorts Daily_Cohort_History's data rows ascending by date then region
// (columns B, C) — called once at the end of every upsert batch, same
// pattern as sortSlaHistorySheet_ above.
async function sortDailyCohortHistorySheet_(){
  const sheetId = await getSheetIdByTabName(DAILY_COHORT_HISTORY_TAB_NAME);
  if (sheetId == null) return;

  const url = `https://sheets.googleapis.com/v4/spreadsheets/${_currentSheetId}:batchUpdate`;
  const resp = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${gateAccessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      requests: [{
        sortRange: {
          range: { sheetId, startRowIndex: 1, startColumnIndex: 0 },
          sortSpecs: [{ dimensionIndex: 1, sortOrder: 'ASCENDING' }, { dimensionIndex: 2, sortOrder: 'ASCENDING' }], // B date, then C region
        },
      }],
    }),
  });
  if (!resp.ok) {
    const errBody = await resp.json().catch(() => ({}));
    throw new Error((errBody.error && errBody.error.message) || `Sheets API error ${resp.status}`);
  }
}

// Wired to #backfillDailyCohortHistoryBtn on the Tracking tab (see
// tab-tracking.js) — still directly console-callable too (`await
// backfillDailyCohortHistoryFromMovementLog()`). Reconstructs one row per
// fully-resolved day×region currently reachable from the Movement_Log
// history already loaded in this tab (up to 7 days back) — same
// eligibility rule as persistDailyCohortHistory (a day only counts once
// its whole 48h window has elapsed), and same ignoreFilters:true reasoning
// (a backfill must capture the true picture, not whoever's currently
// filtered view). Safe to re-run — upserts by date+region, never
// duplicates a row. Returns the number of day×region rows written.
async function backfillDailyCohortHistoryFromMovementLog(){
  if (!movementSnapshots.length) { console.warn('No Movement_Log data loaded — refresh first.'); return 0; }

  const byLead = buildMovementHistories();
  const dayKeys = new Set();
  byLead.forEach(history => {
    if (!history.length) return;
    const created = parseDate(history[0].lead_assigned_at);
    if (created) dayKeys.add(istDateKey(created));
  });

  const nowMs = Date.now();
  const eligibleDates = Array.from(dayKeys).filter(dateKey => {
    const dayEnd = parseDate(dateKey + ' 23:59:59');
    return dayEnd && (dayEnd.getTime() + CONFIG.LEAD_LIFECYCLE_HOURS * 3600 * 1000) <= nowMs;
  }).sort();

  const entries = [];
  eligibleDates.forEach(dateKey => {
    const result = computeDailyCohortByRegion(dateKey, { ignoreFilters: true });
    if (!result || !result.totalCreated) return;
    result.byRegion.forEach(stats => {
      if (!stats.created) return;
      entries.push({ date: dateKey, region: stats.region, source: 'Backfill', stats });
    });
  });

  console.log(`Backfilling ${entries.length} day×region row(s) into ${DAILY_COHORT_HISTORY_TAB_NAME}…`);
  await upsertDailyCohortHistoryRows(entries);
  console.log('Done.');
  return entries.length;
}

// Wired to #clearDailyCohortHistoryBtn on the Tracking tab — still
// directly console-callable too (`await clearDailyCohortHistory()`).
// Errors propagate to the caller, same reasoning as clearSlaHistory.
async function clearDailyCohortHistory(){
  if (!_currentSheetId) return;
  const sheetId = await getSheetIdByTabName(DAILY_COHORT_HISTORY_TAB_NAME);
  if (sheetId == null) return;
  const existingValues = await sheetsApiValuesGet(_currentSheetId, `${DAILY_COHORT_HISTORY_TAB_NAME}!A2:A`);
  if (!existingValues.length) return;
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${_currentSheetId}:batchUpdate`;
  const resp = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${gateAccessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      requests: [{ deleteDimension: { range: { sheetId, dimension: 'ROWS', startIndex: 1, endIndex: 1 + existingValues.length } } }],
    }),
  });
  if (!resp.ok) {
    const errBody = await resp.json().catch(() => ({}));
    throw new Error((errBody.error && errBody.error.message) || `Sheets API error ${resp.status}`);
  }
}

// Resolves after `ms`, but wakes up early (checking every 500ms) if
// waitForAllFollowups' Cancel button flips this wait's entry in
// _followupWaitCancelled — so cancelling takes effect within half a second
// instead of waiting out however much of the current poll interval was left.
function sleepCancelable(ms, cancelKey){
  return new Promise(resolve => {
    const start = Date.now();
    const tick = () => {
      if (_followupWaitCancelled.get(cancelKey) || Date.now() - start >= ms) { resolve(); return; }
      setTimeout(tick, 500);
    };
    tick();
  });
}

// Keyed by cancelBtnId rather than one shared flag — the Operations tab's
// "Generate" wait and the Movement tab's Overnight "Generate Region Emails"
// wait are two independently-triggerable flows (nothing stops a user from
// starting one, switching tabs, and starting the other while the first is
// still polling), and previously shared a single boolean: clicking either
// Cancel button cancelled BOTH in-flight waits, and one flow's clean finish
// silently left the other with stale "cancelled" state on its next check.
const _followupWaitCancelled = new Map();

function showFollowupWaitControls(show, btnId){
  const btn = document.getElementById(btnId || 'followupsWaitCancelBtn');
  if (btn) btn.style.display = show ? 'inline-block' : 'none';
}

document.getElementById('followupsWaitCancelBtn').addEventListener('click', () => {
  _followupWaitCancelled.set('followupsWaitCancelBtn', true);
});
document.getElementById('overnightFollowupsWaitCancelBtn').addEventListener('click', () => {
  _followupWaitCancelled.set('overnightFollowupsWaitCancelBtn', true);
});

// Polls Lead_Followups until every leadId in `leadIds` has a non-blank
// suggested_followup (column F), or the user clicks Cancel. Returns
// {lead_id: suggestion} once complete, or null if cancelled — callers
// check for null and bail out without sending anything. No timeout: a
// person may take a while to review and type these in, and the Cancel
// button (not a clock) is the deliberate way out of an abandoned wait.
// statusElId/cancelBtnId let a second caller (Overnight Leads' own
// "Generate Region Emails") drive its own on-screen status/cancel UI
// instead of the one that lives next to the Summary email's Generate
// button — each wait's cancellation is tracked under its own cancelBtnId
// key in _followupWaitCancelled, so the two flows can run concurrently
// (started from different tabs) without one's Cancel click or clean finish
// affecting the other.
async function waitForAllFollowups(leadIds, statusElId, cancelBtnId){
  if (!leadIds.length) return {};
  const cancelKey = cancelBtnId || 'followupsWaitCancelBtn';
  _followupWaitCancelled.set(cancelKey, false);
  showFollowupWaitControls(true, cancelBtnId);
  const POLL_MS = 20000;
  let attempt = 0;
  try {
    while (true) {
      if (_followupWaitCancelled.get(cancelKey)) {
        setFollowupsPushStatus('Cancelled — waiting for follow-ups stopped, nothing sent.', 'var(--amber)', statusElId);
        return null;
      }
      attempt++;
      const rowsData = await sheetsApiValuesGet(_currentSheetId, `${LEAD_FOLLOWUPS_TAB_NAME}!A2:G`);
      const lookup = {};
      rowsData.forEach(r => {
        const id = String((r && r[0]) || '').trim();
        const suggestion = String((r && r[5]) || '').trim();
        if (id && suggestion) lookup[id] = suggestion;
      });
      const missing = leadIds.filter(id => !lookup[id]);
      if (!missing.length) {
        setFollowupsPushStatus(`All ${leadIds.length} follow-up${leadIds.length === 1 ? '' : 's'} ready.`, 'var(--green)', statusElId);
        return lookup;
      }
      setFollowupsPushStatus(
        `Waiting for follow-ups: ${leadIds.length - missing.length} of ${leadIds.length} filled in (check #${attempt})…`,
        'var(--text-faint)', statusElId
      );
      await sleepCancelable(POLL_MS, cancelKey);
    }
  } finally {
    showFollowupWaitControls(false, cancelBtnId);
  }
}

// The actual capture: every lead in the WHOLE fetched dataset (not the
// filtered `leads` view — a browser snapshot should reflect reality, not
// whatever region happens to be selected), written with THIS browser's own
// clock as snapshot_at. No source/open-closed filtering — matches
// MovementTracker.gs's own trigger exactly.
// One button in the header (beside Refresh) feeds both the Movement and
// Tracking tabs' pickers — status is written to its one status span
// regardless of which tab happens to be open when it finishes.
function setSnapshotStatus(text, color){
  const el = document.getElementById('snapshotStatus');
  if (el) { el.textContent = text; el.style.color = color; }
}

async function browserSnapshotOpenLeads(){
  if (!_currentSheetId || !allParsedLeads.length) return;

  if (!gateTokenValid()) {
    setSnapshotStatus('Re-signing in…', 'var(--text-faint)');
    await gateSignIn();
    if (!gateTokenValid()) {
      setSnapshotStatus('Sign-in required to write a snapshot.', 'var(--amber)');
      return;
    }
  }

  setSnapshotStatus('Writing snapshot…', 'var(--text-faint)');

  const now = new Date();
  const label = 'Browser — ' + istDateTimeValue(now);
  const snapshotAtValue = istDateTimeValue(now);

  // Every lead in the currently loaded tab, any source, open or closed —
  // matches MovementTracker.gs's own trigger exactly (see
  // snapshotOpenLeads_), so this manual capture path can never write a
  // different set of leads into Movement_Log than the scheduled trigger
  // would, which would otherwise corrupt that lead's before/after
  // comparison with an inconsistent history.
  const leadsToSnapshot = allParsedLeads;
  if (!leadsToSnapshot.length) {
    setSnapshotStatus('No leads to snapshot.', 'var(--text-faint)');
    return;
  }

  const rows = leadsToSnapshot.map(l => {
    const row = [snapshotAtValue, label];
    SNAPSHOT_FIELD_KEYS.forEach(key => row.push(movementCellValue(l, key)));
    return row;
  });

  try {
    await appendSheetRows(MOVEMENT_LOG_TAB_NAME, rows);
    setSnapshotStatus(`Snapshot written: ${rows.length.toLocaleString()} leads at ${istStamp(now)}.`, 'var(--green)');
    // Same instant as the Movement_Log write above, not a separate
    // "whenever this happens to run" timestamp — this button previously
    // only ever wrote Movement_Log, silently never touching SLA_History
    // at all.
    try { await snapshotSlaHistory(now); } catch (e) { /* Movement_Log write already succeeded either way */ }
    // Pull the new run back in so it shows up in the Compare dropdowns
    // immediately, without needing a full reconnect.
    await fetchMovementLog(_currentSheetId);
    trackingPopulateSnapshotSelectors();
    // The Tracking tab's picker just moved its "to" onto this new run —
    // every section that reads Movement_Log needs to refresh.
    renderStalledFlaggedLeadsOps();
    renderMovementTab();
    renderTrackingTab();
    const rmtlSel = document.getElementById('rmtlRMSelect');
    if (rmtlSel) renderRMIssueHistory(rmtlSel.value); // new run also feeds RM Timeline's history chart
  } catch (err) {
    console.error('Browser snapshot failed:', err);
    setSnapshotStatus('Snapshot failed: ' + err.message, 'var(--red)');
  }
}
