// ============================================================
// tab-movement.js — Movement tab (Movement_Log fetch, stalled
// leads, overnight cohort, status changes, RM stall leaderboard,
// time-to-remediate). Depends on core.js (loaded first).
// NOTE: initMovementUI() still lives in dashboard.html's
// remaining inline script for now, alongside the other
// end-of-file init/bootstrap calls (see tab-rmtimeline.js).
// ============================================================

/* ===================== MOVEMENT: STALLED LEADS =====================
 * Reads a "Movement_Log" sheet tab that a separate Apps Script
 * (MovementTracker.gs) populates every 6 hours, independent of whether this
 * dashboard or the Sheet itself is open — that's the entire reason this
 * lives in a scheduled script rather than something this page could do on
 * its own (a closed browser tab runs no JavaScript, ever).
 *
 * This code's job is comparison only: replay the SAME enrichLead() used
 * everywhere else in this file against each historical snapshot (by
 * temporarily pointing _renderNow at that snapshot's own timestamp), then
 * walk each lead's snapshot history backward to find how many consecutive
 * checks show zero change. No business logic is duplicated here — only
 * the Apps Script side needed a (verbatim, comment-linked) copy of the
 * open/closed stage check, to decide what's worth snapshotting at all.
 */
let movementSnapshots = [];             // raw per-snapshot records, one per (lead, check)
let movementFetchState = 'idle';        // 'idle' | 'loading' | 'ok' | 'missing' | 'error'
let _lastOvernightCohort = null;        // last computeOvernightCohort() result — the "Generate Region Emails" button under Overnight Leads builds from this

const MOVEMENT_LOG_TAB_NAME = 'Movement_Log';
// Comment-history export written on every "Generate" click for the
// combined All Issues email — see pushLeadsToFollowups. A person (or a
// later automation) reads collated_comments and fills in
// suggested_followup by hand; nothing in this file ever writes that column.
const LEAD_FOLLOWUPS_TAB_NAME = 'Lead_Followups';
// Per-snapshot SLA compliance history — see snapshotSlaHistory and
// backfillSlaHistoryFromMovementLog. Replaces the old localStorage-only
// version: a real, shared, durable log instead of one browser's own cache.
// Not currently displayed anywhere in this dashboard (the Overview tab's
// chart reading this was removed) — still written on every refresh/
// Snapshot Now for direct sheet inspection or future use.
const SLA_HISTORY_TAB_NAME = 'SLA_History';
// stage_comments is appended at the END, not grouped near
// internal_status_comments — both this browser's own snapshot-append path
// (SNAPSHOT_FIELD_KEYS below) and MovementTracker.gs's snapshotOpenLeads_
// write values POSITIONALLY, in this array's order, into whatever columns
// the Movement_Log sheet already has. An already-set-up sheet's header row
// predates this field, so a value written mid-array would land under the
// WRONG existing header (shifting every column after it) until the header
// row itself is repaired — appending at the end keeps every pre-existing
// column's position untouched; only the new trailing column is added
// (see ensureMovementLogSheet_'s self-healing header check in the .gs file).
const MOVEMENT_LOG_COLUMNS = [
  'snapshot_at', 'snapshot_label', 'lead_id', 'client_id', 'RM', 'TL', 'project', 'region', 'client',
  'lead_created_at', 'group_source', 'source_bucket', 'current_stage',
  'last_connect', 'last_connect_time', 'last_comment',
  'internal_status_comments', 'closing_reason',
  'call_attempts', 'call_count', 'duration',
  'stage_comments',
];
// Same list minus the two metadata columns — the fields read directly off
// a live lead record when the browser writes its own snapshot.
const SNAPSHOT_FIELD_KEYS = MOVEMENT_LOG_COLUMNS.slice(2);

let _currentSheetId = ''; // set once a fetch succeeds — needed by the Sheets-write path, which can fire from a button click outside fetchAndRender's own scope

const MOVEMENT_LOG_DATE_KEYS = new Set(['snapshot_at', 'lead_created_at', 'last_connect_time']);

// customer-key -> call_attempts as of the LATEST Movement_Log snapshot
// captured before the IST calendar day `asOf` falls in — the baseline
// enrichLead subtracts a lead's current call_attempts against to get a
// real count of today's calls (see attemptsToday there). Returns an empty
// map when there's no snapshot history yet (fresh setup) — callers treat
// a missing key as "no baseline available" and fall back accordingly.
function buildTodayCallBaseline(asOf){
  const map = new Map();
  if (!movementSnapshots.length) return map;
  const p = istParts(asOf);
  const todayStart = istWallToInstant(p.y, p.mo, p.d, 0, 0, 0).getTime();
  const latest = new Map(); // key -> {atMs, call_attempts}
  movementSnapshots.forEach(rec => {
    const atMs = rec.snapshot_at.getTime();
    if (atMs >= todayStart) return; // only snapshots strictly before today count as a baseline
    const key = String(rec.client_id || '').trim() || 'l:' + String(rec.lead_id).trim();
    const cur = latest.get(key);
    if (!cur || atMs > cur.atMs) latest.set(key, { atMs, call_attempts: Number(rec.call_attempts) || 0 });
  });
  latest.forEach((v, key) => map.set(key, v.call_attempts));
  return map;
}

async function fetchMovementLog(sheetId){
  movementFetchState = 'loading';
  try {
    // Movement_Log is a plain tab we control (no import-tool banner row),
    // so headers live in row 1 — unlike the main sheet's A2:Z convention.
    // A1:Z leaves headroom past MOVEMENT_LOG_COLUMNS' current 22 columns
    // for whatever gets appended next, same as the main sheet's own range.
    let values;
    try {
      values = await sheetsApiValuesGet(sheetId, `${MOVEMENT_LOG_TAB_NAME}!A1:Z`);
    } catch (err) {
      // A missing tab (setup not done yet) surfaces as a 400 "Unable to
      // parse range" — same "not set up" outcome as an empty response.
      movementFetchState = err.status === 403 ? 'error' : 'missing';
      movementSnapshots = [];
      return;
    }
    if (!values.length) {
      movementFetchState = 'missing';
      movementSnapshots = [];
      return;
    }

    const table = valuesToGvizShape(values, (label) => MOVEMENT_LOG_DATE_KEYS.has(label));
    const cols = table.cols;
    const rows = table.rows.map(r => r.c || []);
    const idx = {};
    MOVEMENT_LOG_COLUMNS.forEach(key => {
      let found = -1;
      cols.forEach((c, i) => { if (found === -1 && String(c.label || '').trim() === key) found = i; });
      idx[key] = found;
    });
    if (idx.lead_id === -1 || idx.snapshot_at === -1) {
      // Tab exists but doesn't look like ours — treat the same as "not set up".
      movementFetchState = 'missing';
      movementSnapshots = [];
      return;
    }

    const getRaw = (c, key) => idx[key] === -1 ? '' : gvizCellRaw(c[idx[key]]);
    const getDate = (c, key) => idx[key] === -1 ? null : gvizCellDate(c[idx[key]]);

    movementSnapshots = rows
      .filter(c => String(getRaw(c, 'lead_id')).trim() !== '')
      .map(c => {
        const snapAt = getDate(c, 'snapshot_at');
        const createdDate = getDate(c, 'lead_created_at');
        const connectDate = getDate(c, 'last_connect_time');
        return {
          snapshot_at: snapAt,
          snapshot_label: getRaw(c, 'snapshot_label'),
          lead_id: getRaw(c, 'lead_id'),
          client_id: getRaw(c, 'client_id'),
          RM: getRaw(c, 'RM') || 'Unassigned',
          TL: getRaw(c, 'TL') || '',
          project: getRaw(c, 'project') || '',
          region: getRaw(c, 'region') || 'Unassigned',
          client: getRaw(c, 'client') || '',
          lead_created_at: createdDate ? createdDate.toISOString() : getRaw(c, 'lead_created_at'),
          group_source: getRaw(c, 'group_source'),
          source_bucket: getRaw(c, 'source_bucket') || '',
          current_stage: getRaw(c, 'current_stage'),
          last_connect: getRaw(c, 'last_connect') || '',
          last_connect_time: connectDate ? connectDate.toISOString() : getRaw(c, 'last_connect_time'),
          last_comment: getRaw(c, 'last_comment') || '',
          internal_status_comments: getRaw(c, 'internal_status_comments') || '',
          stage_comments: getRaw(c, 'stage_comments') || '',
          closing_reason: getRaw(c, 'closing_reason') || '',
          call_attempts: Number(getRaw(c, 'call_attempts')) || 0,
          call_count: Number(getRaw(c, 'call_count')) || 0,
          duration: Number(getRaw(c, 'duration')) || 0,
        };
      })
      .filter(r => r.snapshot_at); // undated rows can't be sequenced — drop them

    movementFetchState = movementSnapshots.length ? 'ok' : 'missing';
  } catch (err) {
    movementFetchState = 'error';
    movementSnapshots = [];
  }
}

// Groups raw snapshot records by customer (client_id, falling back to
// lead_id — same identity rule the main collation step uses), each list
// sorted chronologically.
// Cached by movementSnapshots array identity — every load site reassigns
// `movementSnapshots = [...]` wholesale rather than mutating it in place
// (confirmed: no .push()/.splice() anywhere), so a `===` check against the
// last-seen array is a safe, cheap invalidation signal. Called 4 times
// (computeMovementRows, computeStatusChanges, computeRmStallLeaderboard,
// computeTimeToRemediate) within a single render pass; without this, the
// same grouping/sorting of the full retained history (up to 7 days of
// snapshots) reran from scratch on every one of those, every filter change.
let _movementHistoriesCache = null;
let _movementHistoriesCacheSrc = null;
function buildMovementHistories(){
  if (_movementHistoriesCacheSrc === movementSnapshots) return _movementHistoriesCache;

  const byLead = new Map();
  movementSnapshots.forEach(rec => {
    const key = String(rec.client_id || '').trim() || 'l:' + String(rec.lead_id).trim();
    if (!byLead.has(key)) byLead.set(key, []);
    byLead.get(key).push(rec);
  });
  byLead.forEach(list => list.sort((a, b) => a.snapshot_at - b.snapshot_at));

  _movementHistoriesCacheSrc = movementSnapshots;
  _movementHistoriesCache = byLead;
  return byLead;
}

// Runs enrichLead() as if "now" were a specific past instant, restoring
// the real _renderNow immediately after — every other render function in
// the current pass, and any later one, must keep seeing the true current
// time. Safe because JS is single-threaded and nothing here awaits. Also
// flips _enrichingHistorical so enrichLead's attemptsToday falls back to
// the CRM-comment proxy instead of the day-over-day call_attempts delta
// (see buildTodayCallBaseline) — that delta is built once per live render
// pass for "today" specifically; recomputing an equivalent baseline for
// every distinct historical day the leaderboard/remediate-time walk
// touches would be a real performance cost for no benefit those views
// actually need.
function enrichLeadAsOf(rawRecord, asOfDate){
  const saved = _renderNow;
  const savedHistorical = _enrichingHistorical;
  _renderNow = asOfDate;
  _enrichingHistorical = true;
  try {
    return enrichLead(rawRecord);
  } finally {
    _renderNow = saved;
    _enrichingHistorical = savedHistorical;
  }
}

// The leaderboard and remediate-time metrics both walk EVERY consecutive
// pair for EVERY lead across the whole retained history, and both need to
// know "was this snapshot flagged" — same question computeMovementRows
// asks about a single pair. A WeakMap keyed by the snapshot record itself
// means the cache needs no manual clearing: a fresh fetchMovementLog()
// call builds a brand new movementSnapshots array, the old record objects
// become unreachable, and their cache entries are simply garbage
// collected along with them.
const _movementEnrichCache = new WeakMap();
function enrichSnapshotCached(rec){
  if (_movementEnrichCache.has(rec)) return _movementEnrichCache.get(rec);
  const enriched = enrichLeadAsOf(rec, rec.snapshot_at);
  _movementEnrichCache.set(rec, enriched);
  return enriched;
}

// Same six-dimension filter (Project/Region/TL/Source/Sub-source/Created
// date range) applyMovementFilters below checks, matched against a single
// snapshot record — used by the whole-history walks (RM Stall Leaderboard,
// Time to Remediate) that check one record at a time instead of filtering
// a whole array up front. Previously only checked Project/Region/TL,
// silently ignoring Source/Sub-source/date-range selections that every
// other Movement view already respects — those two tables would keep
// showing all-source, all-time stats while the rest of the tab had
// narrowed down, with no indication the two had drifted apart. Region goes
// through effectiveRegion, same as applyMovementFilters — a raw .region
// check missed "Loan" leads entirely, since Loan is inferred from
// project_region/group_source, not reliably present in the region column.
function passesMovementFilters(rec){
  const projSel = filterState.project, regSel = filterState.region, tlSel = filterState.TL;
  const srcSel = filterState.source, bucketSel = filterState.bucket;
  if (projSel.size && !projSel.has(rec.project)) return false;
  if (regSel.size && !regSel.has(effectiveRegion(rec))) return false;
  if (tlSel.size && !tlSel.has(rec.TL)) return false;
  if (srcSel.size && !Array.from(srcSel).some(s => s.toLowerCase() === String(rec.group_source).trim().toLowerCase())) return false;
  if (bucketSel.size && !bucketSel.has(String(rec.source_bucket).trim())) return false;
  const fromVal = document.getElementById('dateFromInput').value;
  const toVal = document.getElementById('dateToInput').value;
  if (fromVal || toVal) {
    const fromDate = fromVal ? parseDate(fromVal + ' 00:00:00') : null;
    const toDate = toVal ? parseDate(toVal + ' 23:59:59') : null;
    const created = parseDate(rec.lead_created_at);
    if (!created) return false;
    if (fromDate && created < fromDate) return false;
    if (toDate && created > toDate) return false;
  }
  return true;
}

// "Moved" = stage changed, OR call attempts increased, OR any of the four
// comment-ish columns changed — any activity at all, not specifically
// funnel progress. last_comment and closing_reason are included here too
// (unlike combinedCommentsText/actionLogEntries, which stay scoped to the
// two structured log columns for counting purposes) since a genuine
// change in either is still real evidence something happened, whether or
// not it's formatted as a dated log entry.
function movementChangedBetween(a, b){
  if (String(a.current_stage || '').trim().toLowerCase() !== String(b.current_stage || '').trim().toLowerCase()) return true;
  if (Number(a.call_attempts || 0) !== Number(b.call_attempts || 0)) return true;
  if (String(a.internal_status_comments || '') !== String(b.internal_status_comments || '')) return true;
  if (String(a.stage_comments || '') !== String(b.stage_comments || '')) return true;
  if (String(a.last_comment || '') !== String(b.last_comment || '')) return true;
  if (String(a.closing_reason || '') !== String(b.closing_reason || '')) return true;
  return false;
}

// Every distinct captured run, one entry per unique snapshot_at instant
// (a whole batch shares one exact timestamp — Apps Script stamps every
// row in a run with the same `now`, taken on Google's server when the
// trigger fires — not this browser's clock; see the note on
// fetchMovementLog). Sorted chronologically.
function distinctMovementSnapshotRuns(){
  const seen = new Map();
  movementSnapshots.forEach(rec => {
    const key = rec.snapshot_at.getTime();
    if (!seen.has(key)) seen.set(key, { at: rec.snapshot_at, label: rec.snapshot_label, count: 0 });
    seen.get(key).count++;
  });
  return Array.from(seen.values()).sort((a, b) => a.at - b.at);
}

// Runs grouped by IST calendar day, each day's runs kept chronological —
// this is what backs the Date dropdown; each date's own runs back the
// Time dropdown once a date is picked.
function movementDatesAvailable(){
  const byDate = new Map();
  distinctMovementSnapshotRuns().forEach(run => {
    const dateKey = istDateKey(run.at);
    if (!byDate.has(dateKey)) byDate.set(dateKey, { dateKey, label: istDayLabel(run.at), runs: [] });
    byDate.get(dateKey).runs.push(run);
  });
  return Array.from(byDate.values()).sort((a, b) => a.dateKey.localeCompare(b.dateKey));
}

// Time-of-day only (no date) — the Date dropdown already carries the date.
function istTimeLabel(date){
  const p = istParts(date);
  const pad = n => String(n).padStart(2, '0');
  let h = p.h;
  const ampm = h >= 12 ? 'PM' : 'AM';
  h = h % 12; if (h === 0) h = 12;
  return `${pad(h)}:${pad(p.mi)} ${ampm} IST`;
}

function populateMovementDateSelect(selectId){
  const sel = document.getElementById(selectId);
  if (!sel) return;
  sel.innerHTML = movementDatesAvailable()
    .map(d => `<option value="${d.dateKey}">${esc(d.label)}</option>`)
    .join('');
}

// Rebuilds the Time dropdown for whichever date is currently selected in
// the matching Date dropdown. Defaults to `preferredAt` if it falls on
// that date, otherwise the latest run captured that day.
function populateMovementTimeSelect(dateSelectId, timeSelectId, preferredAt){
  const dateSel = document.getElementById(dateSelectId);
  const timeSel = document.getElementById(timeSelectId);
  if (!dateSel || !timeSel) return;
  const day = movementDatesAvailable().find(d => d.dateKey === dateSel.value);
  if (!day || !day.runs.length) { timeSel.innerHTML = ''; return; }

  timeSel.innerHTML = day.runs
    .map(r => `<option value="${r.at.getTime()}">${esc(istTimeLabel(r.at))} (${r.count} leads)</option>`)
    .join('');

  const preferredMatch = preferredAt && day.runs.find(r => r.at.getTime() === preferredAt.getTime());
  const fallback = day.runs[day.runs.length - 1]; // most recent capture that day
  timeSel.value = String((preferredMatch || fallback).at.getTime());
}

// Rebuilds every dropdown's OPTIONS and picks sensible defaults (from =
// the second-most-recent run overall, to = the most recent). Only called
// once per fresh fetch — never from renderMovementTab(), so a filter
// change or tab switch never resets what the user already picked.
function populateMovementSnapshotSelectors(){
  const fromDateSel = document.getElementById('movementFromDateSelect');
  const toDateSel = document.getElementById('movementToDateSelect');
  if (!fromDateSel || !toDateSel) return;

  populateMovementDateSelect('movementFromDateSelect');
  populateMovementDateSelect('movementToDateSelect');

  const runs = distinctMovementSnapshotRuns();
  const fromRun = runs.length >= 2 ? runs[runs.length - 2] : runs[0];
  const toRun = runs[runs.length - 1];

  if (fromRun) {
    fromDateSel.value = istDateKey(fromRun.at);
    populateMovementTimeSelect('movementFromDateSelect', 'movementFromTimeSelect', fromRun.at);
  }
  if (toRun) {
    toDateSel.value = istDateKey(toRun.at);
    populateMovementTimeSelect('movementToDateSelect', 'movementToTimeSelect', toRun.at);
  }

  // Same fresh-fetch data backs the Tracking tab's own From/To pickers —
  // keeping this one call site means every caller of this function (initial
  // load, and a browser-triggered snapshot write) picks both up for free.
  trackingPopulateSnapshotSelectors();
}

function getSelectedMovementSnapshot(timeSelectId){
  const el = document.getElementById(timeSelectId);
  if (!el || el.value === '') return null;
  const ms = Number(el.value);
  return Number.isFinite(ms) ? new Date(ms) : null;
}

// Same filter bar as the rest of the dashboard — Project/Region/TL/
// Source/Sub-source plus the Created date range — matched against each
// row's OWN recorded fields (shared by the on-screen render and the CSV
// export, so the two can never disagree).
function applyMovementFilters(rawRows){
  const projSel = filterState.project, regSel = filterState.region, tlSel = filterState.TL;
  const srcSel = filterState.source, bucketSel = filterState.bucket;
  const srcSelLower = new Set(Array.from(srcSel).map(s => s.toLowerCase()));
  const fromVal = document.getElementById('dateFromInput').value;
  const toVal = document.getElementById('dateToInput').value;
  const fromDate = fromVal ? parseDate(fromVal + ' 00:00:00') : null;
  const toDate = toVal ? parseDate(toVal + ' 23:59:59') : null;

  return rawRows.filter(r => {
    if (projSel.size && !projSel.has(r.project)) return false;
    if (regSel.size && !regSel.has(effectiveRegion(r))) return false;
    if (tlSel.size && !tlSel.has(r.TL)) return false;
    if (srcSel.size && !srcSelLower.has(String(r.group_source).trim().toLowerCase())) return false;
    if (bucketSel.size && !bucketSel.has(String(r.source_bucket).trim())) return false;
    if (fromDate || toDate) {
      const created = parseDate(r.lead_created_at);
      if (!created) return false;
      if (fromDate && created < fromDate) return false;
      if (toDate && created > toDate) return false;
    }
    return true;
  });
}

// Every customer flagged at the "to" snapshot that shows zero change since
// the "from" snapshot (comparing the pair directly — needn't be adjacent
// checks, whatever the two dropdowns point at). A lead missing from either
// snapshot (wasn't open/didn't exist yet at one of the two checkpoints)
// can't be compared and is skipped.
function computeMovementRows(fromAt, toAt){
  if (!fromAt || !toAt) return [];
  if (fromAt.getTime() > toAt.getTime()) { const t = fromAt; fromAt = toAt; toAt = t; }

  const byLead = buildMovementHistories();
  const rows = [];

  byLead.forEach((history) => {
    // A history bucket is keyed by client_id-or-lead_id (buildMovementHistories
    // above) — the SAME customer can have multiple simultaneous RM copies
    // in it, each its own lead_id, captured at the identical snapshot_at.
    // A plain .find() only ever returns the first one, silently dropping
    // every other copy from Stalled Leads entirely. Matching by
    // lead_id within the timestamp instead catches all of them.
    const toRecs = history.filter(r => r.snapshot_at.getTime() === toAt.getTime());
    const fromRecs = history.filter(r => r.snapshot_at.getTime() === fromAt.getTime());
    if (!toRecs.length || !fromRecs.length) return;

    const flaggedUnchanged = [];
    toRecs.forEach(toRec => {
      const fromRec = fromRecs.find(r => String(r.lead_id).trim() === String(toRec.lead_id).trim());
      if (!fromRec) return; // this copy didn't exist yet at the "from" checkpoint

      const toEnriched = enrichSnapshotCached(toRec);
      if (!ISSUE_PRIORITY.some(rule => toEnriched[rule.key])) return; // not flagged at "to"
      if (movementChangedBetween(fromRec, toRec)) return; // moved — not stalled

      const primaryIssue = (ISSUE_PRIORITY.find(rule => toEnriched[rule.key]) || {}).label || 'Flagged';
      flaggedUnchanged.push({ toRec, fromRec, toEnriched, primaryIssue });
    });
    if (!flaggedUnchanged.length) return;

    // One row per RM copy, not one merged row per customer — two RMs
    // stalled on the very same issue are still two separate instances
    // (each accountable for their own copy), and a customer's copies can
    // easily be stalled on DIFFERENT issues (one Not Updated, another
    // Behind on Today's Calls); merging into one row could only ever show
    // one issue, silently hiding whichever the representative copy wasn't.
    // Each row still carries a lightweight sibling reference to the OTHER
    // copies of the same customer, for context only.
    flaggedUnchanged.forEach(cur => {
      const siblings = flaggedUnchanged.filter(x => x !== cur);
      rows.push({
        lead_id: cur.toRec.lead_id,
        client_id: cur.toRec.client_id,
        RM: cur.toRec.RM,
        TL: cur.toRec.TL,
        region: cur.toRec.region,
        project: cur.toRec.project,
        current_stage: cur.toRec.current_stage,
        group_source: cur.toRec.group_source,
        source_bucket: cur.toRec.source_bucket,
        lead_created_at: cur.toRec.lead_created_at,
        // Same "last touched" signal the Not Updated / Follow-up Overdue
        // sections use elsewhere (newest dated CRM comment) — not just the
        // snapshot check time — so this actually says when the lead itself
        // was last worked, not just when we last looked at it.
        lastCommentAt: cur.toEnriched.lastCommentAt || null,
        // All four comment-ish columns, so a follow-up suggestion built
        // from this row (see suggestedFollowUp/combinedCommentsText/
        // hasAnyCommentField) reads the full picture, not just
        // internal_status_comments alone.
        internal_status_comments: cur.toRec.internal_status_comments || '',
        stage_comments: cur.toRec.stage_comments || '',
        last_comment: cur.toRec.last_comment || '',
        closing_reason: cur.toRec.closing_reason || '',
        fromAt: cur.fromRec.snapshot_at,
        toAt: cur.toRec.snapshot_at,
        issue: cur.primaryIssue,
        collatedFrom: 1,
        collatedLeadIds: [String(cur.toRec.lead_id).trim()],
        collatedRMs: [cur.toRec.RM || 'Unassigned'],
        siblingLeadIds: siblings.map(s => String(s.toRec.lead_id).trim()),
        siblingRMs: Array.from(new Set(siblings.map(s => s.toRec.RM).filter(Boolean))),
        // Every sibling's own four comment columns — see the matching
        // comment on copySplits in fetchAndRender for why.
        siblingComments: siblings.map(s => ({
          lead_id: s.toRec.lead_id, RM: s.toRec.RM,
          internal_status_comments: s.toRec.internal_status_comments || '',
          stage_comments: s.toRec.stage_comments || '',
          last_comment: s.toRec.last_comment || '',
          closing_reason: s.toRec.closing_reason || '',
        })),
      });
    });
  });

  // Grouped so every RM copy of the same customer ends up adjacent in the
  // on-screen Stalled Leads list (see groupSiblingsTogether) —
  // the plain RM-name sort below only ran within/across families before,
  // so 3 copies held by 3 different RMs could land anywhere in the list
  // relative to each other.
  const sortedRows = groupSiblingsTogether(rows, (a, b) => a.RM.localeCompare(b.RM) || String(a.lead_id).localeCompare(String(b.lead_id)));
  return sortedRows;
}

// Stalled Leads rows for the SAME picked Movement_Log window the
// on-screen card and Status Changes use (see getPickedMovementWindow) —
// same filters (applyMovementFilters) and same per-copy row shape
// (computeMovementRows), just pre-grouped by region for the email builder
// below instead of rendered as cards. The region email's Stalled Flagged
// Leads section used to run its own separate, always-current rolling-48h
// window regardless of what was on screen; it now shows exactly what the
// picker above Stalled Leads is set to at the moment Generate is
// clicked, so the email always matches what you were just looking at.
function currentStalledRowsByRegion(){
  const win = getPickedMovementWindow();
  if (!win) return {};
  const rows = applyMovementFilters(computeMovementRows(win.fromAt, win.toAt));
  return groupItemsByReportRegion(rows);
}

// The picker above Stalled Leads — shared with Status Changes below
// (same select IDs, just relocated in the DOM), so both sections always
// compare the identical pair of Movement_Log snapshots.
function getPickedMovementWindow(){
  const fromAt = getSelectedMovementSnapshot('movementFromTimeSelect');
  const toAt = getSelectedMovementSnapshot('movementToTimeSelect');
  if (!fromAt || !toAt) return null;
  return { fromAt, toAt };
}

// Operations tab's Stalled Leads section — reads the SAME picked
// snapshot pair as Status Changes below (see getPickedMovementWindow), so
// the two sections can never disagree about which leads are stalled.
// Previously this was locked to a fixed always-current 48h window with no
// picker of its own; now it follows whatever pair is selected, same as
// Status Changes always has.
function renderStalledFlaggedLeadsOps(){
  const countEl = document.getElementById('stalledCount');
  const breakdownEl = document.getElementById('stalledBreakdown');
  const noticeEl = document.getElementById('stalledNotice');
  const listEl = document.getElementById('stalledList');
  if (!breakdownEl || !listEl) return;

  if (movementFetchState !== 'ok') {
    if (countEl) countEl.textContent = '';
    breakdownEl.innerHTML = '';
    listEl.innerHTML = '';
    if (noticeEl) {
      noticeEl.style.display = 'block';
      noticeEl.innerHTML = movementFetchState === 'loading'
        ? 'Loading movement history…'
        : `<b>No Movement_Log data yet.</b> This section reads a "Movement_Log" sheet tab populated every 6 hours by a small Apps Script that runs independently of this dashboard. See <span class="mono">MovementTracker.gs</span> in the project folder for the one-time setup (open your Sheet → Extensions → Apps Script → paste it in → run <span class="mono">setupMovementTracking()</span> once). It needs at least two captured checks before there's anything to compare — allow ~6-12 hours after setup.`;
    }
    return;
  }

  const win = getPickedMovementWindow();
  if (!win) {
    if (countEl) countEl.textContent = '';
    breakdownEl.innerHTML = '';
    listEl.innerHTML = '';
    if (noticeEl) {
      noticeEl.style.display = 'block';
      noticeEl.innerHTML = 'Only one snapshot captured so far — need at least two before anything can be compared. Check back after the next scheduled run.';
    }
    return;
  }
  if (noticeEl) noticeEl.style.display = 'none';

  // Same filter bar as the rest of Operations — Project/Region/TL/Source/
  // Sub-source plus the Created date range — matched against each row's
  // OWN recorded fields, same as before.
  const rows = applyMovementFilters(computeMovementRows(win.fromAt, win.toAt));

  // dedupeToFamilies computed once and reused for both the count and the
  // breakdown below — countUniqueAndCloned(rows) would silently redo the
  // exact same grouping work a second time on the same array.
  const uniqueRows = dedupeToFamilies(rows);
  const cloneCounts = { total: rows.length, unique: uniqueRows.length, cloned: rows.length - uniqueRows.length };
  if (countEl) countEl.textContent = uniqueCloneLabel(cloneCounts, 'lead');

  const byIssue = {};
  uniqueRows.forEach(r => { byIssue[r.issue] = (byIssue[r.issue] || 0) + 1; });
  renderBreakdownCard(breakdownEl, {
    total: uniqueRows.length,
    totalLabel: `lead${uniqueRows.length === 1 ? '' : 's'} stalled`,
    subNote: cloneCounts.cloned > 0 ? `+ ${cloneCounts.cloned} cloned cop${cloneCounts.cloned === 1 ? 'y' : 'ies'} (same customer, another RM) shown below` : '',
    rangeText: `${istStamp(win.fromAt)} → ${istStamp(win.toAt)}`,
    counts: byIssue,
    colorFn: colorForIssue,
    numColor: 'var(--red)',
    emptyText: 'No flagged lead is unchanged between the two picked snapshots right now.',
  });

  if (!rows.length) { listEl.innerHTML = ''; return; }

  listEl.innerHTML = truncationNotice(rows.length, MAX_CARDS) + rows.slice(0, MAX_CARDS).map(r => {
    const hoursSpan = ((r.toAt - r.fromAt) / 36e5).toFixed(1);
    return `<div class="alert-card">
      <div class="alert-id">${leadIdentityLine(r)}</div>
      <div class="alert-age mono">unchanged ~${hoursSpan}h</div>
      <div class="alert-meta"><span class="cell-hint">${esc(r.region)}<span class="cell-hint-panel">TL: ${esc(r.TL || 'Unassigned')}</span></span> · ${esc(r.project)} · ${esc(r.current_stage)} — <span class="chip red">${esc(r.issue)}</span></div>
      <div class="alert-comment">${esc(suggestedFollowUp(r))}</div>
    </div>`;
  }).join('');
}

// Between the same From/To pair as Status Changes: every lead open
// (tracked) at "From" is sorted into exactly one outcome — Stalled (still
// open, still flagged, computeMovementRows already decided this), Active
// (still open, not flagged/stalled), or dropped out of tracking entirely.
// A dropped-out lead is looked up in the CURRENT live sheet to find out
// why, since Movement_Log only ever snapshots open, under-Opportunity
// leads (isOpenLead excludes both closed AND Opportunity+ stages — see
// enrichLead) — a closure and an Opportunity+ conversion both look
// IDENTICAL from inside the log alone: the lead just stops appearing
// either way. The live sheet is the only place left holding the answer,
// so that's what this cross-references against — meaning the result
// reflects the lead's state as of NOW, not necessarily exactly at the
// "To" timestamp if it moved again since.
function computeStatusChanges(fromAt, toAt, stalledRows){
  if (!fromAt || !toAt) return null;
  if (fromAt.getTime() > toAt.getTime()) { const t = fromAt; fromAt = toAt; toAt = t; }

  // stalledRows (computeMovementRows) is one row per RM copy, keyed by its
  // own lead_id — matched the same way here now that this walk is per-copy
  // too, not the customer-level client_id it used before.
  const stalledIssueByKey = new Map((stalledRows || []).map(r => [String(r.lead_id).trim(), r.issue]));

  // One row per RM copy, not one entry per customer — a customer's two
  // simultaneous copies can land in DIFFERENT outcomes (one stalled, the
  // other closed), and a plain per-customer dedup silently dropped
  // whichever copy .find() didn't happen to pick, exactly the bug already
  // fixed in computeMovementRows above. Matching by lead_id within each
  // history bucket catches every copy; a lightweight sibling reference to
  // the OTHER copies of the same customer travels with each row for
  // context (and so countUniqueAndCloned can tell a cloned pair apart from
  // two genuinely different customers — see familyKeyOf).
  const byLead = buildMovementHistories();
  const toLeadIdsPresent = new Set();
  const fromRecs = [];
  byLead.forEach((history) => {
    const toRecs = history.filter(r => r.snapshot_at.getTime() === toAt.getTime());
    toRecs.forEach(r => toLeadIdsPresent.add(String(r.lead_id).trim()));
    const fromRecsForLead = history.filter(r => r.snapshot_at.getTime() === fromAt.getTime());
    fromRecsForLead.forEach(rec => {
      const siblings = fromRecsForLead.filter(x => x !== rec);
      fromRecs.push(Object.assign({}, rec, {
        siblingLeadIds: siblings.map(s => String(s.lead_id).trim()),
        siblingRMs: Array.from(new Set(siblings.map(s => s.RM).filter(Boolean))),
      }));
    });
  });

  const filteredFromRecs = applyMovementFilters(fromRecs);

  // Live sheet lookup by lead_id (this copy's own identity), not
  // client_id — a customer's OTHER copy staying open shouldn't make THIS
  // specific copy read as active if this lead_id itself closed or
  // converted (or vice versa).
  const liveByLeadId = new Map();
  allParsedLeads.forEach(l => { liveByLeadId.set(String(l.lead_id).trim(), l); });

  const active = [];
  const stalled = [];
  const opportunities = [];
  const closed = [];
  const untraced = [];

  filteredFromRecs.forEach(rec => {
    const leadId = String(rec.lead_id).trim();
    const rowBase = { lead_id: rec.lead_id, RM: rec.RM, region: rec.region, project: rec.project, siblingLeadIds: rec.siblingLeadIds, siblingRMs: rec.siblingRMs };
    if (toLeadIdsPresent.has(leadId)) {
      const issue = stalledIssueByKey.get(leadId);
      if (issue) {
        stalled.push(Object.assign({}, rowBase, { label: issue }));
      } else {
        // Current live stage where available — more useful than the
        // "From" snapshot's now-stale stage for something described as
        // active right now.
        const liveNow = liveByLeadId.get(leadId);
        active.push(Object.assign({}, rowBase, { label: (liveNow && liveNow.current_stage) || rec.current_stage }));
      }
      return;
    }

    const live = liveByLeadId.get(leadId);
    if (!live) {
      untraced.push(Object.assign({}, rowBase, { label: '' }));
      return;
    }

    const closedNow = isLeadClosed(live);
    if (closedNow) {
      let label;
      if (isClosedStage(live.current_stage)) {
        label = String(live.current_stage || '').trim() || 'Closed';
      } else {
        // lead_closing_reason/lead_closing_comment are the sheet's own
        // closing disposition — preferred here over the RM-entered
        // closing_reason when present, since it's the more authoritative
        // "why did this close" signal. Falls back to closing_reason for
        // leads closed before this column existed.
        const reason = String(live.lead_closing_reason || live.closing_reason || '').trim();
        const detail = String(live.lead_closing_comment || '').trim();
        label = reason ? (detail ? `${reason} — ${detail}` : reason) : 'Closed';
      }
      // lead_id/RM/region/project refreshed from the live record here too
      // — same as the opportunities and active branches below — so a lead
      // reassigned to a different RM between the From snapshot and now
      // isn't attributed to whoever held it back at "From".
      closed.push(Object.assign({}, rowBase, { lead_id: live.lead_id, RM: live.RM, region: live.region, project: live.project, label }));
      return;
    }

    if (isOppOrAbove(live.current_stage)) {
      const canon = canonicalStage(live.current_stage);
      const label = canon ? canon.replace(/\b\w/g, c => c.toUpperCase()) : 'Opportunity+';
      opportunities.push(Object.assign({}, rowBase, { lead_id: live.lead_id, RM: live.RM, region: live.region, project: live.project, label }));
      return;
    }

    // Live data says it's still open and under-Opportunity — a missed
    // capture window (e.g. it dipped out and back), not a real status
    // change. Counted as active rather than guessing at a reason.
    active.push(Object.assign({}, rowBase, { lead_id: live.lead_id, RM: live.RM, region: live.region, project: live.project, label: live.current_stage }));
  });

  return { totalFrom: filteredFromRecs.length, active, stalled, opportunities, closed, untraced };
}

function fmtHoursSpan(h){
  if (!Number.isFinite(h)) return '—';
  return h < 24 ? h.toFixed(1) + 'h' : (h / 24).toFixed(1) + 'd';
}

// Whole-history accountability view — unlike the from/to picker above,
// this doesn't compare just one pair. It walks EVERY consecutive pair for
// every lead across the whole retained window (up to 7 days) and counts
// every zero-movement gap it finds, so a lead that sat untouched for 3
// consecutive checks counts 3 times — weighting by how long things
// actually sat, not just whether they're stalled right now.
// buildMovementHistories groups by CUSTOMER (client_id-or-lead_id), so a
// customer with 2 simultaneous RM copies has both interleaved into one
// bucket at the same snapshot_at. Walking that bucket positionally
// (history[i-1] vs history[i]) then risks pairing up two DIFFERENT
// copies captured at the same instant rather than one copy's own
// sequential snapshots — movementChangedBetween would almost always read
// "changed" (different RM/stage data) even though neither individual
// copy actually moved, masking a real stall; or, with a same-run pairing
// that happens to look unchanged, log a spurious 0-hour "stall" against
// whichever RM's row sorted second. computeMovementRows hit this same
// hazard and fixed it by matching same-lead_id rows across two fixed
// endpoints (see its own comment) — this generalizes that to a full
// walk by splitting each customer bucket back into one chronological
// sequence per lead_id (copy) before scanning.
function splitHistoryByCopy(history){
  const byCopy = new Map();
  history.forEach(rec => {
    const key = String(rec.lead_id).trim();
    if (!byCopy.has(key)) byCopy.set(key, []);
    byCopy.get(key).push(rec);
  });
  return Array.from(byCopy.values());
}

function computeRmStallLeaderboard(){
  const byLead = buildMovementHistories();
  const byRM = new Map();

  byLead.forEach((history) => {
    splitHistoryByCopy(history).forEach((copyHistory) => {
      for (let i = 1; i < copyHistory.length; i++) {
        const prev = copyHistory[i - 1], cur = copyHistory[i];
        if (!passesMovementFilters(cur)) continue;

        const curEnriched = enrichSnapshotCached(cur);
        if (!ISSUE_PRIORITY.some(rule => curEnriched[rule.key])) continue; // not flagged at this checkpoint
        if (movementChangedBetween(prev, cur)) continue; // moved — not a stalled gap

        const rm = cur.RM || 'Unassigned';
        if (!byRM.has(rm)) byRM.set(rm, { RM: rm, staleGapCount: 0, leadsWithStall: new Set(), totalStallHours: 0, longestStallHours: 0 });
        const b = byRM.get(rm);
        const hours = (cur.snapshot_at - prev.snapshot_at) / 36e5;
        b.staleGapCount++;
        b.leadsWithStall.add(String(cur.client_id || cur.lead_id));
        b.totalStallHours += hours;
        if (hours > b.longestStallHours) b.longestStallHours = hours;
      }
    });
  });

  return Array.from(byRM.values())
    .map(b => ({ RM: b.RM, staleGapCount: b.staleGapCount, leadsWithStall: b.leadsWithStall.size, totalStallHours: b.totalStallHours, longestStallHours: b.longestStallHours }))
    .sort((a, b) => b.staleGapCount - a.staleGapCount);
}

// For leads that WERE stalled and then actually moved: how long the stall
// ran before it did. A run of consecutive zero-movement gaps is one
// "episode", closed off the moment movement (or the lead leaving flagged
// status) is observed. A stall still ongoing at the end of the retained
// history has no closing point yet, so it contributes no episode here —
// it's still visible in the leaderboard above while it's in progress.
function computeTimeToRemediate(){
  const byLead = buildMovementHistories();
  const episodes = [];

  byLead.forEach((history) => {
    // See splitHistoryByCopy above — walking the customer-level bucket
    // positionally would risk pairing two different RMs' copies as if
    // sequential; each copy needs its own chronological walk.
    splitHistoryByCopy(history).forEach((copyHistory) => {
      let stallStart = null;

      for (let i = 1; i < copyHistory.length; i++) {
        const prev = copyHistory[i - 1], cur = copyHistory[i];
        if (!passesMovementFilters(cur)) { stallStart = null; continue; } // out of scope — don't bridge a stall across a filtered-out gap

        const curEnriched = enrichSnapshotCached(cur);
        const flaggedAtCur = ISSUE_PRIORITY.some(rule => curEnriched[rule.key]);
        const changed = movementChangedBetween(prev, cur);

        if (flaggedAtCur && !changed) {
          if (stallStart === null) stallStart = prev.snapshot_at;
        } else {
          if (stallStart !== null) {
            episodes.push({
              RM: cur.RM || 'Unassigned',
              region: cur.region,
              project: cur.project,
              lead_id: cur.lead_id,
              startAt: stallStart,
              endAt: cur.snapshot_at,
              hours: (cur.snapshot_at - stallStart) / 36e5,
            });
          }
          stallStart = null;
        }
      }
    });
  });

  return episodes;
}

// Approximates "time to Opportunity" for leads whose crossing INTO
// Opportunity+ happened somewhere inside the retained snapshot history —
// duration from lead_created_at (not from the first observed snapshot) to
// the FIRST retained snapshot where the lead already reads as Opportunity+.
// Deliberately EXCLUDES a lead that was already Opportunity+ at its own
// earliest retained snapshot: the true crossing moment for that lead isn't
// observable (it could have happened long before retention began), so
// counting it at that first-seen timestamp would silently understate the
// duration — and understate it specifically for the fastest converters,
// which would bias the whole distribution toward looking slower than it is.
// Returns {RM, hours} entries in the same shape computeTimeToRemediate's
// episodes use, so summarizeTimeToRemediate below can summarize both with
// the same median/average logic, unmodified.
function computeTimeToOpportunity(){
  const byLead = buildMovementHistories();
  const results = [];
  byLead.forEach((history) => {
    splitHistoryByCopy(history).forEach((copyHistory) => {
      if (!copyHistory.length) return;
      const first = copyHistory[0];
      if (!passesMovementFilters(first)) return;
      if (enrichSnapshotCached(first).oppOrAbove) return; // crossing not observable — excluded, not understated

      let crossing = null;
      for (let i = 1; i < copyHistory.length; i++) {
        if (enrichSnapshotCached(copyHistory[i]).oppOrAbove) { crossing = copyHistory[i]; break; }
      }
      if (!crossing) return; // never reached Opportunity+ within retained history

      const created = parseDate(first.lead_created_at);
      if (!created) return;
      const hours = (crossing.snapshot_at.getTime() - created.getTime()) / 36e5;
      if (hours < 0) return;
      results.push({ RM: crossing.RM || 'Unassigned', region: crossing.region, project: crossing.project, lead_id: crossing.lead_id, hours });
    });
  });
  return results;
}

// Generic {RM, hours}[] -> per-RM count/avg/median/max summarizer — also
// used for computeTimeToOpportunity's results above, not just
// computeTimeToRemediate's stall episodes; the name is the older, narrower
// one since this is where the median-handling logic was first proven.
function summarizeTimeToRemediate(episodes){
  const byRM = new Map();
  episodes.forEach(e => {
    const rm = e.RM || 'Unassigned';
    if (!byRM.has(rm)) byRM.set(rm, []);
    byRM.get(rm).push(e.hours);
  });
  return Array.from(byRM.entries()).map(([rm, hoursList]) => {
    const sorted = hoursList.slice().sort((a, b) => a - b);
    const avg = sorted.reduce((s, x) => s + x, 0) / sorted.length;
    // Even-length lists need the average of the two middle values, not
    // just the upper-middle element — sorted[Math.floor(n/2)] alone
    // overstates the median (e.g. [2,4,10,60] gave 10 instead of the true 7).
    const mid = Math.floor(sorted.length / 2);
    const median = sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
    return { RM: rm, count: sorted.length, avgHours: avg, medianHours: median, maxHours: sorted[sorted.length - 1] };
  }).sort((a, b) => b.avgHours - a.avgHours);
}

// Every DISTINCT comment (by exact text) anywhere in the whole captured
// Movement_Log history that inferOutcome() couldn't classify — it fell
// through every known keyword and hit the generic 'Update' catch-all,
// which has no entry in FOLLOWUP_SUGGESTIONS (see unmatchedFollowUp) — so
// suggestedFollowUp had nothing better to offer than "read this yourself".
// Real information an RM wrote that the keyword list just doesn't
// recognize yet. Deliberately whole-history and unfiltered (every
// project/region/TL/source, not gated by the top filter bar or by
// isOpenLead) — the point is surfacing phrasing worth teaching inferOutcome,
// not listing leads that need action right now (see
// renderRMIssueList/issueLeads for that). Deduped by exact comment text
// (case-insensitive) rather than kept per-occurrence: the SAME comment
// resurfaces in every periodic snapshot for as long as it sits unchanged
// (Movement_Log's comment columns carry the running history forward each
// capture, not just what changed), so counting raw occurrences would
// mostly measure how many times the trigger fired, not how many distinct
// notes actually need attention. leadCount instead counts distinct leads
// that comment appeared under — a phrase repeated across many different
// customers is a stronger signal to add a keyword rule for than one that
// only ever showed up on a single lead.
function computeUnmatchedMovementComments(){
  const byText = new Map(); // lowercased text -> { text, leadIds:Set, RM, region, project, timestamp }
  movementSnapshots.forEach(rec => {
    const entries = parseActionLog(combinedCommentsText(rec));
    const items = entries.length
      ? entries.map(e => ({ text: e.comment, ts: e.ts, loggedBy: e.loggedBy }))
      : (String(rec.last_comment || '').trim() ? [{ text: String(rec.last_comment).trim(), ts: null, loggedBy: rec.RM }] : []);

    items.forEach(item => {
      const text = String(item.text || '').trim();
      if (!text || inferOutcome(text) !== 'Update') return; // has a real keyword match — not what we're after

      const key = text.toLowerCase();
      let entry = byText.get(key);
      if (!entry) {
        entry = { text, leadIds: new Set(), RM: item.loggedBy || rec.RM || 'Unassigned', region: rec.region, project: rec.project, timestamp: item.ts || '' };
        byText.set(key, entry);
      }
      entry.leadIds.add(String(rec.lead_id || '').trim());
      if (item.ts && !entry.timestamp) entry.timestamp = item.ts; // prefer a dated occurrence over an earlier undated one
    });
  });
  return Array.from(byText.values())
    .map(e => ({ text: e.text, leadCount: e.leadIds.size, exampleLeadId: Array.from(e.leadIds)[0], RM: e.RM, region: e.region, project: e.project, timestamp: e.timestamp }))
    .sort((a, b) => b.leadCount - a.leadCount || a.text.localeCompare(b.text));
}

function renderUnmatchedCommentsCount(){
  const el = document.getElementById('unmatchedCommentsCount');
  if (!el) return;
  if (movementFetchState !== 'ok') { el.textContent = ''; return; }
  const rows = computeUnmatchedMovementComments();
  el.textContent = rows.length.toLocaleString() + ' distinct comment' + (rows.length === 1 ? '' : 's');
}

function downloadUnmatchedCommentsCSV(){
  const rows = computeUnmatchedMovementComments();
  const header = ['comment', 'lead_count', 'example_lead_id', 'example_rm', 'example_region', 'example_project', 'example_timestamp'];
  const csvRows = [header].concat(rows.map(r => [r.text, r.leadCount, r.exampleLeadId, r.RM, r.region, r.project, r.timestamp]));
  const csvContent = csvRows.map(r => r.map(csvEscape).join(',')).join('\r\n');
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
  a.href = url;
  a.download = `unmatched_comments_${stamp}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function renderRmStallLeaderboard(){
  const table = document.getElementById('rmStallTable');
  if (!table) return;
  const countEl = document.getElementById('rmStallCount');
  const thead = table.querySelector('thead'), tbody = table.querySelector('tbody');

  if (movementFetchState !== 'ok') {
    thead.innerHTML = ''; tbody.innerHTML = '';
    if (countEl) countEl.textContent = '';
    return;
  }

  const rows = computeRmStallLeaderboard();
  if (countEl) countEl.textContent = rows.length + ' RMs';

  thead.innerHTML = `<tr>
    <th>RM</th>
    <th style="text-align:right">Leads w/ stall</th>
    <th style="text-align:right" title="Every zero-movement gap across the whole retained history — a lead unchanged for 3 consecutive checks counts 3 times">Stall gaps</th>
    <th style="text-align:right">Total stalled</th>
    <th style="text-align:right">Longest single stall</th>
  </tr>`;

  if (!rows.length) {
    tbody.innerHTML = `<tr><td colspan="5" class="empty-row">No stalled gaps in the retained history</td></tr>`;
    return;
  }
  tbody.innerHTML = rows.map(r => `<tr>
    <td>${esc(r.RM)}</td>
    <td class="num">${r.leadsWithStall}</td>
    <td class="num" style="color:var(--red)">${r.staleGapCount}</td>
    <td class="num dim">${fmtHoursSpan(r.totalStallHours)}</td>
    <td class="num dim">${fmtHoursSpan(r.longestStallHours)}</td>
  </tr>`).join('');
}

function renderTimeToOpportunity(){
  const table = document.getElementById('opportunityTimeTable');
  if (!table) return;
  const countEl = document.getElementById('opportunityTimeCount');
  const thead = table.querySelector('thead'), tbody = table.querySelector('tbody');

  if (movementFetchState !== 'ok') {
    thead.innerHTML = ''; tbody.innerHTML = '';
    if (countEl) countEl.textContent = '';
    return;
  }

  const results = computeTimeToOpportunity();
  const rows = summarizeTimeToRemediate(results);
  if (countEl) countEl.textContent = results.length + ' observed crossings';

  thead.innerHTML = `<tr>
    <th>RM</th>
    <th style="text-align:right">Observed crossings</th>
    <th style="text-align:right">Avg time</th>
    <th style="text-align:right">Median time</th>
    <th style="text-align:right">Slowest</th>
  </tr>`;

  if (!rows.length) {
    tbody.innerHTML = `<tr><td colspan="5" class="empty-row">No lead's crossing into Opportunity+ was observed within the retained history yet</td></tr>`;
    return;
  }
  tbody.innerHTML = rows.map(r => `<tr>
    <td>${esc(r.RM)}</td>
    <td class="num">${r.count}</td>
    <td class="num">${fmtHoursSpan(r.avgHours)}</td>
    <td class="num dim">${fmtHoursSpan(r.medianHours)}</td>
    <td class="num" style="color:var(--amber)">${fmtHoursSpan(r.maxHours)}</td>
  </tr>`).join('');
}

function renderTimeToRemediate(){
  const table = document.getElementById('remediateTable');
  if (!table) return;
  const countEl = document.getElementById('remediateCount');
  const thead = table.querySelector('thead'), tbody = table.querySelector('tbody');

  if (movementFetchState !== 'ok') {
    thead.innerHTML = ''; tbody.innerHTML = '';
    if (countEl) countEl.textContent = '';
    return;
  }

  const episodes = computeTimeToRemediate();
  const rows = summarizeTimeToRemediate(episodes);
  if (countEl) countEl.textContent = episodes.length + ' resolved stalls';

  thead.innerHTML = `<tr>
    <th>RM</th>
    <th style="text-align:right">Resolved stalls</th>
    <th style="text-align:right">Avg time</th>
    <th style="text-align:right">Median time</th>
    <th style="text-align:right">Worst time</th>
  </tr>`;

  if (!rows.length) {
    tbody.innerHTML = `<tr><td colspan="5" class="empty-row">No stall has resolved within the retained history yet</td></tr>`;
    return;
  }
  tbody.innerHTML = rows.map(r => `<tr>
    <td>${esc(r.RM)}</td>
    <td class="num">${r.count}</td>
    <td class="num">${fmtHoursSpan(r.avgHours)}</td>
    <td class="num dim">${fmtHoursSpan(r.medianHours)}</td>
    <td class="num" style="color:var(--red)">${fmtHoursSpan(r.maxHours)}</td>
  </tr>`).join('');
}

// Fixed colors for the top-level outcome bar — every lead open at "From"
// lands in exactly one of these, so the palette stays constant regardless
// of which buckets happen to be non-empty this time.
const STATUS_OUTCOME_COLORS = {
  'Stalled': 'var(--red)',
  'Still Active': 'var(--blue)',
  'Became Opportunity+': 'var(--green)',
  'Closed': 'var(--teal)',
  'Not Found in Current Sheet': 'var(--text-faint)',
};

function renderStatusChanges(fromAt, toAt, stalledRows){
  const countEl = document.getElementById('statusChangeCount');
  const outcomeEl = document.getElementById('statusOutcomeBar');
  const stalledEl = document.getElementById('statusStalledBreakdown');
  const oppEl = document.getElementById('statusOppBreakdown');
  const closedEl = document.getElementById('statusClosedBreakdown');
  if (!outcomeEl || !stalledEl || !oppEl || !closedEl) return;

  const result = computeStatusChanges(fromAt, toAt, stalledRows);

  if (!result || !result.totalFrom) {
    if (countEl) countEl.textContent = '';
    outcomeEl.innerHTML = '';
    stalledEl.innerHTML = '';
    oppEl.innerHTML = '';
    closedEl.innerHTML = '';
    return;
  }

  // "Tracked at From" has to mean distinct customers, not rows — a
  // customer whose two RM copies both existed at "From" (and landed in
  // different outcomes) otherwise reads as 2 tracked leads when it's
  // really one. computeStatusChanges is per-copy now (see its own
  // comment), same reasoning as everywhere else this pattern applies.
  //
  // Each category's dedupeToFamilies() runs exactly ONCE below and its
  // result is reused for both the outcome bar's per-category count and
  // that category's own breakdown card — previously result.stalled (for
  // example) was deduped 3 separate times (once for outcomeCounts' length,
  // once inside countUniqueAndCloned, once again for uniqueStalled) doing
  // the identical grouping work each time.
  const allFrom = result.active.concat(result.stalled, result.opportunities, result.closed, result.untraced);
  const uniqueFrom = dedupeToFamilies(allFrom);
  const totalCloneCounts = { total: allFrom.length, unique: uniqueFrom.length, cloned: allFrom.length - uniqueFrom.length };
  if (countEl) countEl.textContent = uniqueCloneLabel(totalCloneCounts, 'lead') + ' tracked at "From"';
  const rangeText = `${istStamp(fromAt)} → ${istStamp(toAt)}`;

  const uniqueStalled = dedupeToFamilies(result.stalled);
  const uniqueActive = dedupeToFamilies(result.active);
  const uniqueOpp = dedupeToFamilies(result.opportunities);
  const uniqueClosed = dedupeToFamilies(result.closed);
  const uniqueUntraced = dedupeToFamilies(result.untraced);
  const stalledCloneCounts = { total: result.stalled.length, unique: uniqueStalled.length, cloned: result.stalled.length - uniqueStalled.length };
  const oppCloneCounts = { total: result.opportunities.length, unique: uniqueOpp.length, cloned: result.opportunities.length - uniqueOpp.length };
  const closedCloneCounts = { total: result.closed.length, unique: uniqueClosed.length, cloned: result.closed.length - uniqueClosed.length };

  // One bar reconciling the whole "From" population into its outcomes —
  // reads at a glance instead of a sentence of numbers to parse. Deduped
  // to one entry per customer (like the Stalled Leads breakdown
  // above) so the bar's percentages stay readable against the same
  // unique total shown in countEl, rather than a mix of customers and
  // their cloned copies.
  const outcomeCounts = {};
  if (uniqueStalled.length) outcomeCounts['Stalled'] = uniqueStalled.length;
  if (uniqueActive.length) outcomeCounts['Still Active'] = uniqueActive.length;
  if (uniqueOpp.length) outcomeCounts['Became Opportunity+'] = uniqueOpp.length;
  if (uniqueClosed.length) outcomeCounts['Closed'] = uniqueClosed.length;
  if (uniqueUntraced.length) outcomeCounts['Not Found in Current Sheet'] = uniqueUntraced.length;
  renderBreakdownCard(outcomeEl, {
    total: uniqueFrom.length,
    totalLabel: `lead${uniqueFrom.length === 1 ? '' : 's'} open at "From"`,
    subNote: totalCloneCounts.cloned > 0 ? `+ ${totalCloneCounts.cloned} cloned cop${totalCloneCounts.cloned === 1 ? 'y' : 'ies'} (same customer, another RM) shown below` : '',
    rangeText,
    counts: outcomeCounts,
    colorFn: (label) => STATUS_OUTCOME_COLORS[label] || 'var(--purple)',
    numColor: 'var(--text)',
  });

  const stalledCounts = {};
  uniqueStalled.forEach(s => { stalledCounts[s.label] = (stalledCounts[s.label] || 0) + 1; });
  renderBreakdownCard(stalledEl, {
    total: uniqueStalled.length,
    totalLabel: `lead${uniqueStalled.length === 1 ? '' : 's'} stalled`,
    subNote: stalledCloneCounts.cloned > 0 ? `+ ${stalledCloneCounts.cloned} cloned cop${stalledCloneCounts.cloned === 1 ? 'y' : 'ies'} (same customer, another RM) shown below` : '',
    rangeText,
    counts: stalledCounts,
    colorFn: colorForIssue,
    numColor: 'var(--red)',
    emptyText: 'No stalled leads in this window.',
  });

  const oppCounts = {};
  uniqueOpp.forEach(o => { oppCounts[o.label] = (oppCounts[o.label] || 0) + 1; });
  renderBreakdownCard(oppEl, {
    total: uniqueOpp.length,
    totalLabel: `became Opportunity${uniqueOpp.length === 1 ? '' : 's'}+`,
    subNote: oppCloneCounts.cloned > 0 ? `+ ${oppCloneCounts.cloned} cloned cop${oppCloneCounts.cloned === 1 ? 'y' : 'ies'} (same customer, another RM) shown below` : '',
    rangeText,
    counts: oppCounts,
    colorFn: colorForIssue,
    numColor: 'var(--green)',
    emptyText: 'No leads became Opportunity+ in this window.',
  });

  const closedCounts = {};
  uniqueClosed.forEach(c => { closedCounts[c.label] = (closedCounts[c.label] || 0) + 1; });
  renderBreakdownCard(closedEl, {
    total: uniqueClosed.length,
    totalLabel: `lead${uniqueClosed.length === 1 ? '' : 's'} closed`,
    subNote: closedCloneCounts.cloned > 0 ? `+ ${closedCloneCounts.cloned} cloned cop${closedCloneCounts.cloned === 1 ? 'y' : 'ies'} (same customer, another RM) shown below` : '',
    rangeText,
    counts: closedCounts,
    colorFn: colorForIssue,
    numColor: 'var(--teal)',
    emptyText: 'No leads closed in this window.',
  });
}

// Every lead created in the after-hours window before the "To" snapshot's
// calendar day — pulled from the LIVE sheet (allParsedLeads), not
// Movement_Log, since the log only ever tracks open/under-Opportunity
// leads and a lead that already converted or closed overnight would
// silently vanish from it. That also means status here is CURRENT
// (as of last refresh), not frozen at "To" — the same honest tradeoff
// Status Changes' Opportunity/Closed lookups make, for the same reason.
function computeOvernightCohort(toAt){
  if (!toAt) return null;
  const p = istParts(toAt);
  const windowEnd = istWallToInstant(p.y, p.mo, p.d, CONFIG.OVERNIGHT_END_HOUR, 0, 0);
  const windowStart = istAddDays(
    istWallToInstant(p.y, p.mo, p.d, CONFIG.OVERNIGHT_START_HOUR, 0, 0),
    -1
  );

  // Expand multi-copy customers into their own copies FIRST, then test
  // each copy's OWN creation date against the window — a merged record's
  // lead_created_at is the EARLIEST across its copies, so testing that
  // first could pull in a copy that individually wasn't actually created
  // overnight (or miss one that was, if a different copy's date won).
  const candidates = [];
  allParsedLeads.forEach(l => {
    if (l.copySplits && l.copySplits.length > 1) candidates.push(...l.copySplits);
    else candidates.push(l);
  });

  const inWindow = candidates.filter(l => {
    const created = parseDate(l.lead_created_at);
    return created && created >= windowStart && created <= windowEnd;
  });

  return { windowStart, windowEnd, leads: applyMovementFilters(inWindow) };
}

// "Closed" for exited leads, else the canonical funnel stage (Title Case),
// else the raw stage text verbatim so nothing silently disappears just
// because it doesn't match a known funnel band.
function overnightStatusLabel(l){
  if (isLeadClosed(l)) return 'Closed';
  const canon = canonicalStage(l.current_stage);
  if (canon) return canon.replace(/\b\w/g, c => c.toUpperCase());
  return String(l.current_stage || '').trim() || 'Unrecognized Stage';
}

// Overnight Leads' own fallback wording for suggestedFollowUp's
// no-comments case — these came in after hours and may not have been
// touched at all yet, so the generic "make first contact" reads weaker
// than the urgency actually warrants here.
const OVERNIGHT_NO_COMMENT_FALLBACK = 'Connect ASAP — no contact made yet.';

// Email-only exclusion: the on-screen cohort (renderOvernightCohort)
// deliberately shows every overnight-created lead, closed or not, so
// nothing about last night is hidden from view. The email is a
// follow-up-action list, not a status report — a lead already at
// Opportunity+ or already closed needs no further overnight follow-up, so
// it's dropped here rather than cluttering the RM's inbox. cohortLeads
// comes straight from allParsedLeads (raw), not enrichLead's output, so
// isOpenLead/oppOrAbove aren't already computed on it — same open/closed
// logic as enrichLead, applied directly. Factored out (not inlined in
// buildOvernightRegionReports below) so renderOvernightRegionReports can
// push/wait on exactly this list before the reports get built from it —
// same "preliminary list, then real build" split renderReports uses for
// the Summary email, just without needing a full throwaway report pass.
function overnightEmailableLeads(cohortLeads){
  return cohortLeads.filter(l => !isLeadClosed(l) && !isOppOrAbove(l.current_stage));
}

// Region-wise email reports for Overnight Leads — same {region, subject,
// body, html, count, regionNames} shape as the Stalled report above and
// Operations' own buildRegionReports(), so it reuses the exact same send/
// copy/recipients pipeline. Built from the live sheet (allParsedLeads via
// computeOvernightCohort), which DOES carry project_region, so "Loan"
// resolution here is fully accurate — unlike the Stalled report, which is
// limited by what Movement_Log itself stores. followupLookup (from the
// same Lead_Followups push/wait cycle the Summary email uses — see
// renderOvernightRegionReports) is preferred over the algorithmic
// suggestedFollowUp fallback whenever a human has filled one in, exactly
// like buildRegionWiseReports' own followupTextFor.
function buildOvernightRegionReports(cohortLeads, windowStart, windowEnd, followupLookup){
  const sourceLabel = selectedSourceLabel();
  const rangeLabel = `${istStamp(windowStart)} → ${istStamp(windowEnd)}`;
  const DIVIDER = '='.repeat(50);
  const SUBDIVIDER = '-'.repeat(50);
  const followupTextFor = (l) => (followupLookup && followupLookup[String(l.lead_id).trim()]) || suggestedFollowUp(l, OVERNIGHT_NO_COMMENT_FALLBACK);
  // Each lead's own copy is judged on its own stage — a lightweight
  // sibling note (not a merged status) names any other RM copies of the
  // same customer for context. cohortLeads already arrives pre-expanded
  // per copy (see computeOvernightCohort).
  const leadLine = (l) => `${l.lead_id}  |  ${overnightStatusLabel(l)}  |  ${followupTextFor(l)}${(l.siblingRMs && l.siblingRMs.length) ? `  |  also held by: ${l.siblingRMs.join(', ')}` : ''}`;

  const emailableLeads = overnightEmailableLeads(cohortLeads);

  const byRegion = groupItemsByReportRegion(emailableLeads);
  return Object.keys(byRegion).sort().map(region => {
    const regionLeads = byRegion[region];
    const byRM = groupBy(regionLeads, l => (l.RM || 'Unassigned') + '||' + (l.TL || ''));

    const blocks = Object.values(byRM).map(group =>
      `${DIVIDER}\nRM      : ${group[0].RM || 'Unassigned'}\nManager : ${group[0].TL || ''}\n${SUBDIVIDER}\n${group.map(leadLine).join('\n')}\n`
    ).join('\n');

    // "Leads Created" has to mean distinct customers, not rows — a
    // customer collated from 2 RM copies otherwise reads as 2 leads
    // created when it's really one. The detail rows below stay per-copy
    // (each RM still needs their own row to follow up on), only the
    // headline/summary numbers dedupe.
    const uniqueRegionLeads = dedupeToFamilies(regionLeads);
    const cloneCounts = { total: regionLeads.length, unique: uniqueRegionLeads.length, cloned: regionLeads.length - uniqueRegionLeads.length };
    const totalLabel = cloneCounts.cloned > 0
      ? `${cloneCounts.unique} (+${cloneCounts.cloned} cloned cop${cloneCounts.cloned === 1 ? 'y' : 'ies'} of the same customer, listed under their other RM below)`
      : String(cloneCounts.unique);

    const subject = `${region} Overnight Leads (${todayDateLabel()}) - ${sourceLabel} leads${subjectScopeSuffix()}`;
    const body = `Hi,\n\nPlease find below the ${sourceLabel} leads in ${region} created overnight (${rangeLabel}).\n\n${blocks}\n${DIVIDER}\n\nLeads Created : ${totalLabel}\n\n${EMAIL_SIGNATURE}`;

    const counts = {};
    uniqueRegionLeads.forEach(l => { const k = overnightStatusLabel(l); counts[k] = (counts[k] || 0) + 1; });

    const html = renderReportEmailHTML({
      eyebrow: 'Lead Funnel · SLA Monitor',
      title: 'Overnight Leads',
      region,
      subtitle: `${rangeLabel} — ${sourceLabel} leads${subjectScopeSuffix()}`,
      action: "Review and prioritize follow-up on these leads before the rest of today's queue — they came in after hours and may still be waiting on first contact."
        + (cloneCounts.cloned > 0 ? ` ${cloneCounts.cloned} of the rows below are another RM's copy of a customer already counted — real lead volume is ${cloneCounts.unique}, not ${cloneCounts.total}.` : ''),
      kpis: [
        { value: cloneCounts.unique, label: 'Leads Created', bg: '#dbeafe', fg: '#2563eb' },
        { value: Object.keys(byRM).length, label: Object.keys(byRM).length === 1 ? 'RM Affected' : 'RMs Affected', bg: '#e0e7ff', fg: '#4338ca' },
        { value: Object.keys(counts).length, label: Object.keys(counts).length === 1 ? 'Status Type' : 'Status Types', bg: '#fef3c7', fg: '#b45309' },
      ],
      sections: Object.values(byRM).map(group => ({
        heading: group[0].RM || 'Unassigned',
        subheading: `Manager: ${group[0].TL || '—'}`,
        columns: ['Lead ID', 'Status', 'Suggested Follow-up'],
        rows: group.map(l => [
          l.lead_id,
          overnightStatusLabel(l) + ((l.siblingRMs && l.siblingRMs.length) ? ` (also held by: ${l.siblingRMs.join(', ')})` : ''),
          followupTextFor(l),
        ]),
      })),
      footerNote: 'Status reflects the CURRENT live sheet as of last refresh, not frozen at the window end time. Leads already at Opportunity+ or closed are excluded — see the Movement tab\'s on-screen Overnight Leads list for the full overnight cohort including those.',
    });

    return { region, subject, body, html, count: cloneCounts.unique, regionNames: [region] };
  });
}

function renderOvernightCohort(toAt){
  const countEl = document.getElementById('overnightCount');
  const breakdownEl = document.getElementById('overnightBreakdown');
  const noticeEl = document.getElementById('overnightNotice');
  const listEl = document.getElementById('overnightList');
  if (!breakdownEl || !listEl) return;

  const result = computeOvernightCohort(toAt);
  // Stashed so the "Generate Region Emails" button builds reports from
  // exactly this cohort, without recomputing (and possibly drifting from)
  // what's currently on screen.
  _lastOvernightCohort = result;
  if (!result) {
    if (countEl) countEl.textContent = '';
    breakdownEl.innerHTML = '';
    listEl.innerHTML = '';
    if (noticeEl) { noticeEl.style.display = 'none'; }
    return;
  }

  const { windowStart, windowEnd, leads: cohort } = result;
  // cohort is expanded per RM copy (see computeOvernightCohort) so each
  // copy still gets its own row below — a customer collated from 3 RM
  // copies otherwise reads as "3 leads created" when it's really one.
  // The headline count and breakdown both dedupe back to real customers;
  // the detail list further down stays the full per-copy cohort.
  const uniqueCohort = dedupeToFamilies(cohort);
  const cloneCounts = { total: cohort.length, unique: uniqueCohort.length, cloned: cohort.length - uniqueCohort.length };
  if (countEl) countEl.textContent = uniqueCloneLabel(cloneCounts, 'lead');
  if (noticeEl) noticeEl.style.display = 'none';

  const rangeText = `${istStamp(windowStart)} → ${istStamp(windowEnd)}`;
  const counts = {};
  uniqueCohort.forEach(l => { const k = overnightStatusLabel(l); counts[k] = (counts[k] || 0) + 1; });
  renderBreakdownCard(breakdownEl, {
    total: uniqueCohort.length,
    totalLabel: `lead${uniqueCohort.length === 1 ? '' : 's'} created overnight`,
    subNote: cloneCounts.cloned > 0 ? `+ ${cloneCounts.cloned} cloned cop${cloneCounts.cloned === 1 ? 'y' : 'ies'} (same customer, another RM) shown below` : '',
    rangeText,
    counts,
    colorFn: colorForIssue,
    numColor: 'var(--blue)',
    emptyText: 'No leads were created in this overnight window.',
  });

  if (!cohort.length) { listEl.innerHTML = ''; return; }

  const sorted = groupSiblingsTogether(cohort, (a, b) => (parseDate(b.lead_created_at) || 0) - (parseDate(a.lead_created_at) || 0));
  listEl.innerHTML = truncationNotice(sorted.length, MAX_CARDS) + sorted.slice(0, MAX_CARDS).map(l => {
    const label = overnightStatusLabel(l);
    return `<div class="alert-card">
      <div class="alert-id">${leadIdentityLine(l)}</div>
      <div class="alert-meta">${esc(l.region)} · ${esc(l.project)} — <span class="chip ${label === 'Closed' ? 'dim-chip' : 'amber'}">${esc(label)}</span></div>
      <div class="alert-comment">Next: ${esc(suggestedFollowUp(l, OVERNIGHT_NO_COMMENT_FALLBACK))}</div>
    </div>`;
  }).join('');
}

// Renders the on-screen preview list for Overnight Leads' region emails —
// same report-card markup and Copy/Open in Mail/Send via Gmail buttons as
// Operations' own region reports, just pointed at a different array
// (window._overnightRegionReports) so the two report lists don't collide.
// Goes through the exact same Lead_Followups process renderReports (the
// Summary/All Issues email) uses: clear the tab, push these leads' comment
// history, wait until every one has a human-filled suggested_followup,
// THEN build the real report from that lookup — so an overnight email
// never goes out with the generic "no comments logged" filler when someone
// actually typed in a real suggestion for that lead.
async function renderOvernightRegionReports(){
  // See the same note in reports.js's renderReports — Morning Brief
  // refreshes at this checkpoint too, not on every filter tweak.
  renderMorningBrief();
  const el = document.getElementById('overnightReportList');
  if (!el) return;
  if (!_lastOvernightCohort || !_lastOvernightCohort.leads.length) {
    el.innerHTML = '';
    window._overnightRegionReports = [];
    return;
  }

  const { leads: cohortLeads, windowStart, windowEnd } = _lastOvernightCohort;
  const leadsToPush = overnightEmailableLeads(cohortLeads);
  if (!leadsToPush.length) {
    el.innerHTML = `<div class="empty-row" style="background:var(--surface); border-radius:8px; border:1px solid var(--border);">No overnight leads need a follow-up email right now — either none fall inside a reporting region, or all of last night's leads are already at Opportunity+ or closed</div>`;
    window._overnightRegionReports = [];
    return;
  }

  const btn = document.getElementById('overnightGenerateReportsBtn');
  if (!tryClaimGenerateCycle('overnight')) {
    setFollowupsPushStatus(
      `${generateCycleOwnerLabel('operations')} is currently writing to Lead_Followups — wait for it to finish, then click Generate again.`,
      'var(--amber)', 'overnightFollowupsPushStatus'
    );
    return;
  }
  const originalLabel = btn.textContent;
  let followupLookup;
  btn.disabled = true;
  try {
    // Every Generate starts Lead_Followups clean — see renderReports'
    // identical reasoning on its own clearLeadFollowupsTab call.
    btn.textContent = 'Clearing old follow-ups…';
    try {
      await clearLeadFollowupsTab();
    } catch (err) {
      setFollowupsPushStatus(`Could not clear Lead_Followups: ${err.message}`, 'var(--red)', 'overnightFollowupsPushStatus');
      return;
    }

    btn.textContent = 'Pushing comments…';
    const pushed = await pushLeadsToFollowups(leadsToPush, 'overnightFollowupsPushStatus');
    if (!pushed) {
      el.innerHTML = `<div class="empty-row" style="background:var(--surface); border-radius:8px; border:1px solid var(--border);">Could not write Lead_Followups — see the status above. Nothing sent.</div>`;
      return;
    }
    btn.textContent = 'Waiting for follow-ups…';
    followupLookup = await waitForAllFollowups(
      leadsToPush.map(r => String(r.lead_id).trim()),
      'overnightFollowupsPushStatus', 'overnightFollowupsWaitCancelBtn'
    );
  } finally {
    btn.disabled = false;
    btn.textContent = originalLabel;
    releaseGenerateCycle('overnight');
  }

  // Cancelled: fall back to the algorithmic/keyword-inferred follow-up
  // text (buildOvernightRegionReports with no followupLookup falls back to
  // suggestedFollowUp's own OVERNIGHT_NO_COMMENT_FALLBACK chain) instead of
  // leaving the screen showing nothing — same "unreviewed, but here it is"
  // fallback renderReports offers for the Summary email.
  const usingFallback = !followupLookup;
  const reports = buildOvernightRegionReports(cohortLeads, windowStart, windowEnd, followupLookup);
  window._overnightRegionReports = reports;
  if (!reports.length) {
    el.innerHTML = `<div class="empty-row" style="background:var(--surface); border-radius:8px; border:1px solid var(--border);">No overnight leads need a follow-up email right now — either none fall inside a reporting region, or all of last night's leads are already at Opportunity+ or closed</div>`;
    return;
  }

  const fallbackBanner = usingFallback
    ? `<div class="empty-row" style="background:var(--surface); border-radius:8px; border:1px solid var(--amber); color:var(--amber); text-align:left; padding:10px 14px;">
        Waiting for follow-ups was cancelled. Showing ${reports.length} email${reports.length === 1 ? '' : 's'}
        built from auto-generated (keyword-inferred) follow-up suggestions only — nobody has reviewed these.
        <button class="report-copy-btn" style="margin-left:8px;" onclick="sendAllReportsGmail(window._overnightRegionReports, i => 'overnightRptGmailBtn_' + i, 'overnightFollowupsPushStatus', 'Send all ' + window._overnightRegionReports.length + ' region emails using UNREVIEWED auto-generated follow-up text?')">Send all via Gmail (unreviewed)</button>
      </div>`
    : '';

  el.innerHTML = fallbackBanner + reports.map((r, idx) => `
    <div class="report-card">
      <div class="report-subject">${esc(r.subject)}</div>
      <div class="rr-meta" style="margin-bottom:8px;">${r.count} lead${r.count === 1 ? '' : 's'}</div>
      <div class="report-body" id="overnightRptBody_${idx}">${esc(r.body)}</div>
      <button class="report-copy-btn" onclick="copyGenericReport(window._overnightRegionReports, ${idx}, 'overnightRptCopyBtn_${idx}')" id="overnightRptCopyBtn_${idx}">Copy subject + body</button>
      <button class="report-copy-btn" onclick="sendReport(window._overnightRegionReports[${idx}])" title="Opens your mail client with the region's To/Cc pre-filled">Open in Mail</button>
      <button class="report-copy-btn" onclick="sendReportViaGmail(window._overnightRegionReports[${idx}], 'overnightRptGmailBtn_${idx}')" id="overnightRptGmailBtn_${idx}" title="Sends immediately via the Gmail API">Send via Gmail</button>
    </div>
  `).join('');
  applyGmailButtonStatesFor(reports, i => 'overnightRptGmailBtn_' + i);
}

// Stalled Leads itself now lives in Operations (see
// renderStalledFlaggedLeadsOps) — it reads the SAME picker as Status
// Changes below (see getPickedMovementWindow), so this tab's picker drives
// both sections together, not just this one.
function renderMovementTab(){
  // Whole-history views — independent of the from/to picker below, so
  // they update on every call regardless of which pair is selected.
  renderRmStallLeaderboard();
  renderTimeToRemediate();
  renderTimeToOpportunity();
  renderUnmatchedCommentsCount();

  const noticeEl = document.getElementById('movementNotice');
  if (!noticeEl) return;

  if (movementFetchState !== 'ok') {
    noticeEl.style.display = 'block';
    noticeEl.innerHTML = movementFetchState === 'loading'
      ? 'Loading movement history…'
      : `<b>No Movement_Log data yet.</b> This reads a "Movement_Log" sheet tab populated every 6 hours by a small Apps Script that runs independently of this dashboard. See <span class="mono">MovementTracker.gs</span> in the project folder for the one-time setup (open your Sheet → Extensions → Apps Script → paste it in → run <span class="mono">setupMovementTracking()</span> once). It needs at least two captured checks before there's anything to compare — allow ~6-12 hours after setup.`;
    renderStatusChanges(null, null, []);
    renderOvernightCohort(null);
    return;
  }

  const fromAt = getSelectedMovementSnapshot('movementFromTimeSelect');
  const toAt = getSelectedMovementSnapshot('movementToTimeSelect');
  if (!fromAt || !toAt) {
    noticeEl.style.display = 'block';
    noticeEl.innerHTML = 'Only one snapshot captured so far — need at least two before anything can be compared. Check back after the next scheduled run.';
    renderStatusChanges(null, null, []);
    renderOvernightCohort(null);
    return;
  }
  noticeEl.style.display = 'none';

  // Same filter bar as the rest of the dashboard — Project/Region/TL/
  // Source/Sub-source plus the Created date range — matched against each
  // row's OWN recorded fields — a stalled lead may since have closed and
  // dropped out of the live sheet's currently-open set, so it can't be
  // cross-referenced against `leads`. Feeds Status Changes' own "Stalled"
  // categorization below.
  const rows = applyMovementFilters(computeMovementRows(fromAt, toAt));

  renderStatusChanges(fromAt, toAt, rows);
  renderOvernightCohort(toAt);
}

// Relocated from dashboard.html's inline script (Phase 4 file-split) — this
// tab's own init/wiring function, called from js/main.js after every other
// script has loaded.
function initMovementUI(){
  const fromDateSel = document.getElementById('movementFromDateSelect');
  const toDateSel = document.getElementById('movementToDateSelect');
  const fromTimeSel = document.getElementById('movementFromTimeSelect');
  const toTimeSel = document.getElementById('movementToTimeSelect');

  // Picking a new date rebuilds that side's Time options (defaulting to
  // the latest capture that day) before re-rendering. Stalled Flagged
  // Leads reads this same picker (see getPickedMovementWindow), so every
  // change here refreshes both it and Status Changes together.
  const renderBothMovementSections = () => { renderStalledFlaggedLeadsOps(); renderMovementTab(); };
  if (fromDateSel) fromDateSel.addEventListener('change', () => {
    populateMovementTimeSelect('movementFromDateSelect', 'movementFromTimeSelect', null);
    renderBothMovementSections();
  });
  if (toDateSel) toDateSel.addEventListener('change', () => {
    populateMovementTimeSelect('movementToDateSelect', 'movementToTimeSelect', null);
    renderBothMovementSections();
  });
  if (fromTimeSel) fromTimeSel.addEventListener('change', renderBothMovementSections);
  if (toTimeSel) toTimeSel.addEventListener('change', renderBothMovementSections);

  const snapshotBtn = document.getElementById('snapshotNowBtn');
  if (snapshotBtn) snapshotBtn.addEventListener('click', () => browserSnapshotOpenLeads());
  initAutoSnapshotCheckbox();

  const overnightReportsBtn = document.getElementById('overnightGenerateReportsBtn');
  if (overnightReportsBtn) overnightReportsBtn.addEventListener('click', renderOvernightRegionReports);

  // Tracking tab's own From/To picker + region select — independent of the
  // pair above (see trackingPopulateSnapshotSelectors).
  const trFromDateSel = document.getElementById('trackingFromDateSelect');
  const trToDateSel = document.getElementById('trackingToDateSelect');
  const trFromTimeSel = document.getElementById('trackingFromTimeSelect');
  const trToTimeSel = document.getElementById('trackingToTimeSelect');
  const trRegionSel = document.getElementById('trackingRegionSelect');
  if (trFromDateSel) trFromDateSel.addEventListener('change', () => {
    populateMovementTimeSelect('trackingFromDateSelect', 'trackingFromTimeSelect', null);
    renderTrackingTab();
  });
  if (trToDateSel) trToDateSel.addEventListener('change', () => {
    populateMovementTimeSelect('trackingToDateSelect', 'trackingToTimeSelect', null);
    renderTrackingTab();
  });
  if (trFromTimeSel) trFromTimeSel.addEventListener('change', renderTrackingTab);
  if (trToTimeSel) trToTimeSel.addEventListener('change', renderTrackingTab);
  if (trRegionSel) trRegionSel.addEventListener('change', renderTrackingTab);

  // Daily Cohort by Region's own single-date picker — independent of every
  // other picker on this tab, so it only needs to re-run its own renderer,
  // not the whole tab.
  const trDailyDateInput = document.getElementById('trackingDailyDateInput');
  if (trDailyDateInput) {
    // Defaults to 2 days ago (IST) so every column has a complete number on
    // first load instead of the 48h columns starting out empty/partial.
    if (!trDailyDateInput.value) {
      const twoDaysAgo = new Date(Date.now() - 2 * 24 * 3600 * 1000);
      trDailyDateInput.value = istDateKey(twoDaysAgo);
    }
    trDailyDateInput.addEventListener('change', renderDailyCohortByRegion);
  }
}
