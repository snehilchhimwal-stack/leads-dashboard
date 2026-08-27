// ============================================================
// tab-movement.js — Movement tab (Movement_Log fetch, stalled
// leads, overnight cohort, RM stall leaderboard, time-to-Opportunity).
// Depends on core.js (loaded first).
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
// The actual error text behind a 'error' state — '' for every other
// state. Exists so a genuine failure (a timeout, a permissions error, a
// malformed row) can say WHAT went wrong instead of showing the exact
// same "no data" placeholder as a sheet that's simply never been set
// up — see movementUnavailableReason below, the one place every
// Tracking-tab section and the RM Timeline calendar go to explain an
// empty state, so this never has to be duplicated per call site.
let movementFetchError = '';
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
  'lead_assigned_at', 'group_source', 'source_bucket', 'current_stage',
  'last_connect', 'last_connect_time', 'last_comment',
  'internal_status_comments', 'closing_reason',
  'call_attempts', 'call_count', 'duration',
  'stage_comments',
];
// Same list minus the two metadata columns — the fields read directly off
// a live lead record when the browser writes its own snapshot.
const SNAPSHOT_FIELD_KEYS = MOVEMENT_LOG_COLUMNS.slice(2);

let _currentSheetId = ''; // set once a fetch succeeds — needed by the Sheets-write path, which can fire from a button click outside fetchAndRender's own scope

const MOVEMENT_LOG_DATE_KEYS = new Set(['snapshot_at', 'lead_assigned_at', 'last_connect_time']);

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

// Same scan as buildTodayCallBaseline above, but keeps each entry's own
// snapshot timestamp instead of discarding it, and applies NO "before
// today" gate — returns every customer's LATEST snapshot strictly
// before `asOf`, whatever calendar day it falls on, as
// key -> {atMs, call_attempts}. buildTodayCallBaseline's day-boundary
// gate exists for a different purpose (today's-calls delta against a
// fixed start-of-day baseline) and would incorrectly exclude an
// overnight lead's most recent snapshot from earlier today — see
// noCommentFollowUp (core.js), the one caller that needs this. Mirrors
// OvernightEmailer.gs's lastSnapshotBeforeGs_ — keep in sync.
function lastSnapshotBefore(asOf){
  const map = new Map();
  if (!movementSnapshots.length) return map;
  const cutoffMs = asOf.getTime();
  movementSnapshots.forEach(rec => {
    const atMs = rec.snapshot_at.getTime();
    if (atMs >= cutoffMs) return;
    const key = String(rec.client_id || '').trim() || 'l:' + String(rec.lead_id).trim();
    const cur = map.get(key);
    if (!cur || atMs > cur.atMs) map.set(key, { atMs, call_attempts: Number(rec.call_attempts) || 0 });
  });
  return map;
}

async function fetchMovementLog(sheetId){
  movementFetchState = 'loading';
  movementFetchError = '';
  try {
    // Movement_Log is a plain tab we control (no import-tool banner row),
    // so headers live in row 1 — unlike the main sheet's A2:Z convention.
    // A1:Z leaves headroom past MOVEMENT_LOG_COLUMNS' current 22 columns
    // for whatever gets appended next, same as the main sheet's own range.
    //
    // Timeboxed at 30s — Movement_Log's row ALLOCATION (not necessarily
    // its content) can grow very large if pruneMovementLog_
    // (MovementTracker.gs) hasn't run its row-shrinking step yet (see
    // that function's own comment on the real 10,000,000-cell workbook
    // ceiling this can hit), and a fetch against a sheet in that state
    // can take far longer than a normal Sheets API call, or hang
    // outright. Without a bound here, every Tracking-tab section just
    // sits on "Loading movement history…" forever with nothing to tell
    // a reader whether it's still working or has actually failed —
    // timing out surfaces that as a real 'error' state instead, with an
    // actual message (see movementFetchError / movementUnavailableReason).
    let values;
    try {
      values = await Promise.race([
        sheetsApiValuesGet(sheetId, `${MOVEMENT_LOG_TAB_NAME}!A1:Z`),
        new Promise((_, reject) => setTimeout(() => {
          reject(Object.assign(new Error('Timed out after 30s waiting for Movement_Log.'), { timedOut: true }));
        }, 30000)),
      ]);
    } catch (err) {
      // 'missing' is the NARROW, specific case — a missing tab (setup
      // not done yet) surfaces as exactly HTTP 400 "Unable to parse
      // range", the one expected shape that genuinely means "not set up
      // yet." Everything else (403, 500, a network failure, a timeout,
      // anything unrecognized) is a real 'error' with its message kept —
      // the previous version of this check treated ANY non-403 error as
      // 'missing', which silently hid a genuine failure (a real network
      // error, a 500, a malformed response) behind the exact same "no
      // data yet" message a legitimately-not-set-up sheet shows,
      // discovered while fixing the timeout above.
      if (err.status === 400) {
        movementFetchState = 'missing';
      } else if (err.timedOut) {
        movementFetchState = 'error';
        movementFetchError = err.message + ' The sheet may still need MovementTracker.gs\'s pruneMovementLogNow run once — see that function\'s own comment.';
      } else {
        movementFetchState = 'error';
        movementFetchError = err.status ? ('HTTP ' + err.status + ': ' + err.message) : String((err && err.message) || err);
      }
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
        const createdDate = getDate(c, 'lead_assigned_at');
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
          lead_assigned_at: createdDate ? createdDate.toISOString() : getRaw(c, 'lead_assigned_at'),
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
    movementFetchError = String((err && err.message) || err);
    movementSnapshots = [];
  }
}

// Single source of truth for why a Movement_Log-backed section has
// nothing to show — every Tracking-tab section and the RM Timeline
// calendar call this instead of hardcoding their own text, so a genuine
// failure ('error' — a timeout, a permissions error, a malformed row)
// never again looks identical to "this just hasn't been set up yet"
// ('missing') the way a single generic "needs Movement_Log data" message
// used to. Callers only reach this while movementFetchState !== 'ok', so
// no separate check for that case here.
function movementUnavailableReason(){
  if (movementFetchState === 'loading') return 'Loading movement history…';
  if (movementFetchState === 'error') {
    return 'Movement_Log fetch failed' + (movementFetchError ? (': ' + movementFetchError) : '') + ' — try Refresh; if this keeps happening, check MovementTracker.gs.';
  }
  return 'No Movement_Log data yet — see MovementTracker.gs, or the Snapshot now button up in the header.';
}

// Groups raw snapshot records by customer (client_id, falling back to
// lead_id — same identity rule the main collation step uses), each list
// sorted chronologically.
// Cached by movementSnapshots array identity — every load site reassigns
// `movementSnapshots = [...]` wholesale rather than mutating it in place
// (confirmed: no .push()/.splice() anywhere), so a `===` check against the
// last-seen array is a safe, cheap invalidation signal. Called by
// computeStalledLeads, computeRmStallLeaderboard and computeTimeToOpportunity
// within a single render pass; without this, the same grouping/sorting of
// the full retained history (up to 7 days of snapshots) reran from scratch
// on every one of those, every filter change.
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

// The stall leaderboard walks EVERY consecutive pair for EVERY lead across
// the whole retained history, and needs to know "was this snapshot
// flagged" for each one. A WeakMap keyed by the snapshot record itself
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

// Same six-dimension filter (Project/Region/TL/Source/Sub-source/Assigned
// date range) applyMovementFilters below checks, matched against a single
// snapshot record — used by the whole-history walks (RM Stall Leaderboard,
// Time to Opportunity) that check one record at a time instead of filtering
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
    const created = parseDate(rec.lead_assigned_at);
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


function getSelectedMovementSnapshot(timeSelectId){
  const el = document.getElementById(timeSelectId);
  if (!el || el.value === '') return null;
  const ms = Number(el.value);
  return Number.isFinite(ms) ? new Date(ms) : null;
}

// Same filter bar as the rest of the dashboard — Project/Region/TL/
// Source/Sub-source plus the Assigned date range — matched against each
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
      const created = parseDate(r.lead_assigned_at);
      if (!created) return false;
      if (fromDate && created < fromDate) return false;
      if (toDate && created > toDate) return false;
    }
    return true;
  });
}

// Stalled Leads — a lead counts as stalled once it's at least 2 days
// since lead_assigned_at (too fresh otherwise — no time to judge it),
// AND:
//   - it has SOME comment history at all: no comment logged in the last
//     6 hours, OR
//   - it has NEVER had a single comment logged: call_attempts hasn't
//     increased from what it was ~6 hours ago (via Movement_Log history)
// The comment check always wins when the lead has any comment history —
// the attempts check is only a fallback for a lead nobody has ever
// commented on, not a second independent signal checked alongside it.
// Only open, not-yet-Opportunity+ leads are considered (matches every
// other issue check in this codebase — a closed or converted lead isn't
// "stalled," it's just done). Built from issueLeads (already filtered,
// already per-copy-expanded, already carrying siblingRMs/siblingComments
// etc. — the same array every other Operations issue card reads).
function computeStalledLeads(){
  const histories = buildMovementHistories();
  const SIX_HOURS_MS = 6 * 3600 * 1000;
  const TWO_DAYS_MS = 2 * 24 * 3600 * 1000;
  const now = _renderNow;

  const rows = [];
  issueLeads.forEach(l => {
    if (!l.isOpenLead) return;
    const assignedAt = parseDate(l.lead_assigned_at);
    if (!assignedAt) return;
    if (now - assignedAt < TWO_DAYS_MS) return; // too fresh to judge

    let sinceAt, reason;
    if (l.lastCommentAt) {
      const hoursSince = (now - l.lastCommentAt) / 36e5;
      if (hoursSince <= 6) return; // commented recently — not stalled
      sinceAt = l.lastCommentAt;
      reason = 'No Comment in 6h+';
    } else {
      // Never commented — fall back to attempts vs ~6h ago. Finds the
      // latest retained snapshot at or before that cutoff; a lead too
      // new for Movement_Log to have a snapshot that old yet (or with no
      // history at all) can't be judged this way — skipped, not flagged.
      const key = String(l.client_id || '').trim() || 'l:' + String(l.lead_id).trim();
      const history = histories.get(key);
      if (!history || !history.length) return;
      const cutoffMs = now.getTime() - SIX_HOURS_MS;
      let baseline = null;
      for (let i = history.length - 1; i >= 0; i--) {
        if (history[i].snapshot_at.getTime() <= cutoffMs) { baseline = history[i]; break; }
      }
      if (!baseline) return;
      if ((Number(l.call_attempts) || 0) > (Number(baseline.call_attempts) || 0)) return; // attempts DID increase — not stalled
      sinceAt = baseline.snapshot_at;
      reason = 'Attempts Unchanged (6h+)';
    }

    rows.push(Object.assign({}, l, { issue: reason, stalledSinceAt: sinceAt }));
  });

  return rows;
}

// Stalled Leads rows, pre-grouped by region for the email builder below
// instead of rendered as cards — same computeStalledLeads every render
// pass and the region email itself both read, so the two can never
// disagree about which leads are stalled.
function currentStalledRowsByRegion(){
  const rows = applyMovementFilters(computeStalledLeads());
  return groupItemsByReportRegion(rows);
}

// Operations tab's Stalled Leads section — reads computeStalledLeads
// directly. The Movement_Log dependency is optional, not required: a
// never-commented lead needs history to judge (the attempts-vs-6h-ago
// fallback), but a lead with any comment history at all is judged from
// `leads`/`issueLeads` alone, so this section still has something useful
// to say even before Movement_Log has any real history yet.
function renderStalledFlaggedLeadsOps(){
  const countEl = document.getElementById('stalledCount');
  const breakdownEl = document.getElementById('stalledBreakdown');
  const noticeEl = document.getElementById('stalledNotice');
  const listEl = document.getElementById('stalledList');
  if (!breakdownEl || !listEl) return;
  if (noticeEl) noticeEl.style.display = 'none';

  // Same filter bar as the rest of Operations — Project/Region/TL/Source/
  // Sub-source plus the Assigned date range — matched against each row's
  // OWN recorded fields, same as before.
  const rows = applyMovementFilters(computeStalledLeads());

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
    counts: byIssue,
    colorFn: colorForIssue,
    numColor: 'var(--red)',
    emptyText: 'No lead assigned 2+ days ago is currently stalled.',
  });

  if (!rows.length) { listEl.innerHTML = ''; return; }

  // Segregated by lead_assigned_at's calendar day (renderCardsByDay) —
  // same day-bucketed pattern used elsewhere, so a stalled lead assigned
  // a week ago doesn't get lost among ones assigned yesterday.
  const sortedRows = rows.slice().sort((a, b) => a.stalledSinceAt - b.stalledSinceAt);
  listEl.innerHTML = truncationNotice(sortedRows.length, MAX_CARDS) + renderCardsByDay(sortedRows, (r) => {
    const hoursSince = ((_renderNow - r.stalledSinceAt) / 36e5).toFixed(1);
    return `<div class="alert-card">
      <div class="alert-id">${leadIdentityLine(r)}</div>
      <div class="alert-age mono">${esc(r.issue)} · ${hoursSince}h</div>
      <div class="alert-meta"><span class="cell-hint">${esc(r.region)}<span class="cell-hint-panel">TL: ${esc(r.TL || 'Unassigned')}</span></span> · ${esc(r.project)} · ${esc(r.current_stage)} · assigned ${esc(istStamp(r.lead_assigned_at))}</div>
      <div class="alert-comment">${esc(suggestedFollowUp(r))}</div>
    </div>`;
  });
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
// whichever RM's row sorted second. Fixed by splitting each customer
// bucket back into one chronological sequence per lead_id (copy) before
// scanning.
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

// Approximates "time to Opportunity" for leads whose crossing INTO
// Opportunity+ happened somewhere inside the retained snapshot history —
// duration from lead_assigned_at (not from the first observed snapshot) to
// the FIRST retained snapshot where the lead already reads as Opportunity+.
// Deliberately EXCLUDES a lead that was already Opportunity+ at its own
// earliest retained snapshot: the true crossing moment for that lead isn't
// observable (it could have happened long before retention began), so
// counting it at that first-seen timestamp would silently understate the
// duration — and understate it specifically for the fastest converters,
// which would bias the whole distribution toward looking slower than it is.
// Returns {RM, hours} entries, summarized below by summarizeTimeToRemediate
// (name predates this being the only caller — see its own comment).
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

      const created = parseDate(first.lead_assigned_at);
      if (!created) return;
      const hours = (crossing.snapshot_at.getTime() - created.getTime()) / 36e5;
      if (hours < 0) return;
      results.push({ RM: crossing.RM || 'Unassigned', region: crossing.region, project: crossing.project, lead_id: crossing.lead_id, hours });
    });
  });
  return results;
}

// Generic {RM, hours}[] -> per-RM count/avg/median/max summarizer, used
// by renderTimeToOpportunity below (name predates Time to Remediate's
// removal — this is where the median-handling logic was first proven).
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

// Every lead assigned in the after-hours window before `asOf`'s calendar
// day — pulled from the LIVE sheet (allParsedLeads), not Movement_Log,
// since the log only ever tracks open/under-Opportunity leads and a lead
// that already converted or closed overnight would silently vanish from
// it. That also means status here is CURRENT (as of last refresh), not
// frozen at the window's end. `asOf` only ever contributes its own IST
// calendar day (see below) — pass `_renderNow` for "as of right now".
function computeOvernightCohort(asOf){
  if (!asOf) return null;
  const p = istParts(asOf);
  const windowEnd = istWallToInstant(p.y, p.mo, p.d, CONFIG.OVERNIGHT_END_HOUR, 0, 0);
  const windowStart = istAddDays(
    istWallToInstant(p.y, p.mo, p.d, CONFIG.OVERNIGHT_START_HOUR, 0, 0),
    -1
  );

  // Expand multi-copy customers into their own copies FIRST, then test
  // each copy's OWN assignment date against the window — a merged record's
  // lead_assigned_at is the EARLIEST across its copies, so testing that
  // first could pull in a copy that individually wasn't actually assigned
  // overnight (or miss one that was, if a different copy's date won).
  const candidates = [];
  allParsedLeads.forEach(l => {
    if (l.copySplits && l.copySplits.length > 1) candidates.push(...l.copySplits);
    else candidates.push(l);
  });

  const inWindow = candidates.filter(l => {
    const created = parseDate(l.lead_assigned_at);
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

// Email-only exclusion: the on-screen cohort (renderOvernightCohort)
// deliberately shows every overnight-assigned lead, closed or not, so
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
  const followupTextFor = (l) => (followupLookup && followupLookup[String(l.lead_id).trim()]) || suggestedFollowUp(l);
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

    // "Leads Assigned" has to mean distinct customers, not rows — a
    // customer collated from 2 RM copies otherwise reads as 2 leads
    // assigned when it's really one. The detail rows below stay per-copy
    // (each RM still needs their own row to follow up on), only the
    // headline/summary numbers dedupe.
    const uniqueRegionLeads = dedupeToFamilies(regionLeads);
    const cloneCounts = { total: regionLeads.length, unique: uniqueRegionLeads.length, cloned: regionLeads.length - uniqueRegionLeads.length };
    const totalLabel = cloneCounts.cloned > 0
      ? `${cloneCounts.unique} (+${cloneCounts.cloned} cloned cop${cloneCounts.cloned === 1 ? 'y' : 'ies'} of the same customer, listed under their other RM below)`
      : String(cloneCounts.unique);

    const subject = `${region} Overnight Leads (${todayDateLabel()}) - ${sourceLabel} leads${subjectScopeSuffix()}`;
    const body = `Hi,\n\nPlease find below the ${sourceLabel} leads in ${region} assigned overnight (${rangeLabel}).\n\n${blocks}\n${DIVIDER}\n\nLeads Assigned : ${totalLabel}\n\n${EMAIL_SIGNATURE}`;

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
        { value: cloneCounts.unique, label: 'Leads Assigned', bg: '#dbeafe', fg: '#2563eb' },
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

function renderOvernightCohort(asOf){
  const countEl = document.getElementById('overnightCount');
  const breakdownEl = document.getElementById('overnightBreakdown');
  const noticeEl = document.getElementById('overnightNotice');
  const listEl = document.getElementById('overnightList');
  if (!breakdownEl || !listEl) return;

  const result = computeOvernightCohort(asOf);
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
  // copies otherwise reads as "3 leads assigned" when it's really one.
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
    totalLabel: `lead${uniqueCohort.length === 1 ? '' : 's'} assigned overnight`,
    subNote: cloneCounts.cloned > 0 ? `+ ${cloneCounts.cloned} cloned cop${cloneCounts.cloned === 1 ? 'y' : 'ies'} (same customer, another RM) shown below` : '',
    rangeText,
    counts,
    colorFn: colorForIssue,
    numColor: 'var(--blue)',
    emptyText: 'No leads were assigned in this overnight window.',
  });

  if (!cohort.length) { listEl.innerHTML = ''; return; }

  const sorted = groupSiblingsTogether(cohort, (a, b) => (parseDate(b.lead_assigned_at) || 0) - (parseDate(a.lead_assigned_at) || 0));
  listEl.innerHTML = truncationNotice(sorted.length, MAX_CARDS) + sorted.slice(0, MAX_CARDS).map(l => {
    const label = overnightStatusLabel(l);
    return `<div class="alert-card">
      <div class="alert-id">${leadIdentityLine(l)}</div>
      <div class="alert-meta">${esc(l.region)} · ${esc(l.project)} — <span class="chip ${label === 'Closed' ? 'dim-chip' : 'amber'}">${esc(label)}</span></div>
      <div class="alert-comment">Next: ${esc(suggestedFollowUp(l))}</div>
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
  // suggestedFollowUp's own noCommentFollowUp chain) instead of
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

// Whole-history views (RM Stall Leaderboard, Time to Opportunity, Unmatched
// Comments) plus Overnight Leads, which needs no picker at all — its
// window is just "the last after-hours stretch before now" (see
// computeOvernightCohort), so it's driven off _renderNow directly and
// works even before Movement_Log has any history yet.
function renderMovementTab(){
  renderRmStallLeaderboard();
  renderTimeToOpportunity();
  renderUnmatchedCommentsCount();

  const noticeEl = document.getElementById('movementNotice');
  if (noticeEl) {
    if (movementFetchState !== 'ok') {
      noticeEl.style.display = 'block';
      noticeEl.innerHTML = movementFetchState === 'loading' ? 'Loading movement history…'
        : movementFetchState === 'error' ? esc(movementUnavailableReason())
        : `<b>No Movement_Log data yet.</b> This reads a "Movement_Log" sheet tab populated every 6 hours by a small Apps Script that runs independently of this dashboard. See <span class="mono">MovementTracker.gs</span> in the project folder for the one-time setup (open your Sheet → Extensions → Apps Script → paste it in → run <span class="mono">setupMovementTracking()</span> once). RM Stall Leaderboard, Time to Opportunity and Unmatched Comments above need at least two captured checks before they have anything to show — allow ~6-12 hours after setup; Overnight Leads below works from the live sheet regardless.`;
    } else {
      noticeEl.style.display = 'none';
    }
  }

  renderOvernightCohort(_renderNow);
}

// Relocated from dashboard.html's inline script (Phase 4 file-split) — this
// tab's own init/wiring function, called from js/main.js after every other
// script has loaded.
function initMovementUI(){
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
