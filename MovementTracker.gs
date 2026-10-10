/**
 * Movement Tracker — snapshots every lead in the current month tab (every
 * source, open or closed — the only requirement is a non-blank lead_id)
 * four times a day (00:00, 06:00, 12:00, 18:00 IST — see SNAPSHOT_HOURS_
 * below) into a "Movement_Log" tab in this same spreadsheet, pruned to the
 * last 7 days. Runs on Google's servers on a schedule, so it keeps
 * capturing even when the dashboard AND this Sheet are both fully closed —
 * that's the whole point of it.
 *
 * The dashboard's Movement tab reads Movement_Log and does the actual
 * "did this lead change" comparison client-side, replaying the same
 * enrichLead() logic dashboard.html already uses against each snapshot's
 * own timestamp. This script's only job is capturing raw data reliably —
 * it does not filter by source or open/closed status; that's left entirely
 * to the dashboard's own filters at render time.
 *
 * Same trigger also writes one row per run to "SLA_History" — a compliance
 * snapshot (open leads, breached leads, per-rule counts) computed with
 * computeSlaFlags_ (SlaEngine.gs), a ported copy of dashboard.html's 5
 * SLA rules. The dashboard writes its own rows there too on every refresh
 * (source='Dashboard' vs this script's 'AppsScript'); this one just means
 * that tracking never has a gap on a day nobody opens the dashboard.
 *
 * Same trigger ALSO scans for open leads whose latest owner comment
 * matches no known outcome keyword and logs those to
 * "Unmatched_Comments_Log" for periodic human review — see
 * UnmatchedCommentLogger.gs's own header for why it piggybacks here.
 *
 * REQUIRES Core.gs, SlaEngine.gs, FollowupEngine.gs, EmailInfra.gs, and
 * UnmatchedCommentLogger.gs in the SAME Apps Script project — this file
 * reuses resolveTabName_/buildColIndex_/getVal_ (Core.gs),
 * computeSlaFlags_ (SlaEngine.gs), withRetry_/readLeadsTab_ (EmailInfra.gs,
 * used indirectly via scanUnmatchedCommentsGs_), and
 * scanUnmatchedCommentsGs_ itself (UnmatchedCommentLogger.gs) directly
 * rather than duplicating them. See Core.gs's own header for the full
 * file list this project needs.
 *
 * ============================== SETUP (one-time) ==============================
 *   1. Open your Google Sheet → Extensions → Apps Script.
 *   2. Delete any placeholder code in Code.gs. Add every file this project
 *      needs as its own file (Core.gs, SlaEngine.gs, FollowupEngine.gs,
 *      EmailInfra.gs, MovementTracker.gs, OvernightEmailer.gs,
 *      AllIssuesEmailer.gs, RmHierarchy.gs, RmHierarchy.private.gs,
 *      UnmatchedCommentLogger.gs, DailyRmIssueLog.gs — see Core.gs's own
 *      header), pasting each
 *      file's contents in. File names don't matter to Apps Script, only
 *      that every file is present in one project — naming them to match
 *      just keeps the editor's file list self-explanatory.
 *   3. Project Settings (gear icon, left sidebar) → General settings →
 *      set "Time zone" to Asia/Kolkata. Triggers fire against THIS
 *      timezone setting, not the spreadsheet's.
 *   4. Also confirm the SPREADSHEET's own timezone is Asia/Kolkata — in
 *      the Sheet itself: File → Settings → Locale/timezone. The dashboard
 *      treats every timestamp in this sheet as IST wall-clock, and that
 *      only holds if the sheet is actually set to IST.
 *   5. In the function dropdown at the top of the editor, select
 *      setupMovementTracking, click Run. Approve the permissions prompt
 *      (it needs to read/write this spreadsheet and manage its own
 *      triggers). This creates the Movement_Log tab and installs the
 *      four triggers (one per hour in SNAPSHOT_HOURS_).
 *   6. Done. Check Triggers (clock icon, left sidebar) to confirm all
 *      four snapshotPeriodic entries show up. From here it runs unattended.
 *
 * The leads tab has one fixed name, set via TAB_NAME_OVERRIDE (Core.gs) —
 * currently 'leads'. (Earlier versions of this project auto-detected a
 * rotating "Aug"/"Aug-2026"-style monthly tab; the sheet no longer
 * rotates, so if it's ever renamed again, just update that one constant.)
 *
 * Cadence: four separate .atHour() triggers (SNAPSHOT_HOURS_), not one
 * .everyHours(6) trigger — deliberately, after everyHours() was observed
 * running unreliably (drifting or skipping a cycle entirely under load,
 * not just landing a few minutes late). atHour() triggers still land
 * within roughly 15 minutes of their target hour, not the exact minute —
 * so don't expect a snapshot at the literal top of the hour, just close to
 * it, every time.
 * ================================================================================
 */

const MOVEMENT_LOG_SHEET = 'Movement_Log';
const MOVEMENT_LOG_RETENTION_DAYS = 7;
// Extra rows left allocated beyond what pruneMovementLog_ actually needs,
// so a normal run doesn't shrink the sheet down to the bone and then
// immediately have to re-expand it for the very next snapshot's rows —
// see pruneMovementLog_'s own comment for why the sheet gets shrunk at all.
const MOVEMENT_LOG_ROW_HEADROOM_ = 5000;
// Four separate fixed-hour daily triggers (IST), not one
// .timeBased().everyHours(6) trigger — see setupMovementTracking's own
// comment for why: everyHours() only loosely targets its interval and can
// silently skip or drift by hours under load, whereas atHour() triggers
// are Google's tightest-guaranteed clock trigger type. Evenly spaced
// across the day; edit this array (not SNAPSHOT_INTERVAL_HOURS, which no
// longer exists) to change the cadence, then re-run setupMovementTracking.
const SNAPSHOT_HOURS_ = [0, 6, 12, 18];

// Column order written to Movement_Log — matches what dashboard.html's
// enrichLead() needs to fully replay a historical flag check. New fields
// MUST be appended at the END, not inserted in the middle: this array's
// order is exactly the order snapshotOpenLeads_ pushes values into each
// row, positionally, against whatever columns an ALREADY-CREATED
// Movement_Log sheet already has — inserting mid-array would shift every
// later column's data under the wrong (unshifted) existing header until
// that header row was also rebuilt. Appending at the end plus
// ensureMovementLogSheet_'s self-healing header check below keeps a
// sheet set up before this field existed correctly aligned.
const SNAPSHOT_COLUMNS_ = [
  'lead_id', 'client_id', 'RM', 'TL', 'project', 'region', 'client',
  'lead_assigned_at', 'group_source', 'source_bucket', 'current_stage',
  'last_connect', 'last_connect_time', 'last_comment',
  'internal_status_comments', 'closing_reason',
  'call_attempts', 'call_count', 'duration',
  'stage_comments',
  // Added 2026-09-01: neither was ever needed here before, because every
  // consumer that reads them (computeSlaFlags_'s inactiveRmNewLead rule,
  // isOpenLead_'s lead_closing_reason check) always ran against a
  // freshly-read LIVE leads-tab row, never a stored Movement_Log row —
  // see HEADER_ALIASES_'s own comments on both (Core.gs). That stopped
  // being true once backfillDailyRmIssuesFromMovementLog_
  // (DailyRmIssueLog.gs) needed to reconstruct SLA flags for a PAST day
  // using only what Movement_Log itself retained. Appended at the end,
  // not inserted — see ensureMovementLogSheet_'s self-healing header
  // comment on why that matters. A row captured BEFORE this change has
  // neither column at all (not even blank) — only rows captured from
  // here on carry real values.
  'rm_is_active', 'lead_closing_reason',
  // Added 2026-09-21 — the lead's Opportunity-transition timestamp
  // (HEADER_ALIASES_.opp_at above), mirroring js/tab-movement.js's
  // MOVEMENT_LOG_COLUMNS. Captured historically the same way
  // lead_assigned_at already is. Appended at the end, same "never insert"
  // rule as every other column here — see ensureMovementLogSheet_'s
  // self-healing header comment.
  'opp_at',
];

// ==================== Content-hash dedup (Lead History & Versioning
// Review, Phase 6) ====================
// A trailing bookkeeping column, same "append, never insert" rule as
// every other column here — NOT part of SNAPSHOT_COLUMNS_ (that array is
// exactly the tracked LEAD fields; this is a computed value over them).
const CONTENT_HASH_COLUMN_ = 'content_hash';

// SHA-256 hex digest over every SNAPSHOT_COLUMNS_ field, NUL-joined so an
// empty field can never be confused with a field boundary shifting (a
// plain '|'-join would let 'a','b|c' and 'a|b','c' hash identically).
// Deliberately excludes snapshot_at/snapshot_label (capture bookkeeping,
// not lead content) and CONTENT_HASH_COLUMN_ itself. `getFieldValue` is a
// (row, key) => value accessor — passed in rather than assuming
// getVal_/colIndex, so this same function works both against a freshly
// read leads-tab row (via getVal_) and a normalized {key: value} object
// pulled from a Movement_Log row (see _movementLogRowToFieldsGs_ below).
// Date fields get rendered as the SAME IST wall-clock string
// js/sheets-writeback.js's movementCellValue() already produces
// ('yyyy-MM-dd HH:mm:ss') — not getTime() or Date's own toString(),
// which would differ from what the browser writer computes for an
// identical instant. This is NOT cosmetic: the two writers must hash an
// identical lead to an identical digest, or dedup silently breaks across
// runtimes (each treats the other's capture as "different" forever).
//
// The separator is written as the escape '\u0000', NEVER a literal NUL
// byte in this file: pasting a raw NUL into the Apps Script editor
// silently turns it into a space, and until 2026-09-25 that is what the
// live copy was hashing with — so its digests differed from the
// browser's ('\0') for every lead. test/check-staleness.py (detector H)
// flags any raw control character in a .gs file for this reason.
const CONTENT_HASH_DATE_FIELDS_ ={ lead_assigned_at: true, last_connect_time: true, opp_at: true };
function _leadContentHashGs_(getFieldValue) {
  const parts = SNAPSHOT_COLUMNS_.map(function (key) {
    const v = getFieldValue(key);
    if (CONTENT_HASH_DATE_FIELDS_[key]) {
      return v instanceof Date ? Utilities.formatDate(v, 'Asia/Kolkata', 'yyyy-MM-dd HH:mm:ss') : '';
    }
    return v === null || v === undefined ? '' : String(v);
  });
  const bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, parts.join('\u0000'));
  return bytes.map(function (b) { return (b < 0 ? b + 256 : b).toString(16).padStart(2, '0'); }).join('');
}

// ==================== Movement_Log_Runs (Phase 6) ====================
// One row per capture RUN, regardless of how many leads' content actually
// changed — decoupled on purpose from Movement_Log's own per-lead rows,
// so "did a capture happen" stays answerable even once unchanged leads
// stop getting a new Movement_Log row every time (see
// checkMovementLogFreshness_ below, and the Lead History & Versioning
// Review's Phase 2 finding this closes). Mirrors the target design's
// `lead_ingestion_runs` table (docs/_planning/DB_ARCHITECTURE_REVIEW.md)
// as closely as a Sheets tab reasonably can — Apps Script has no real
// transactions, so there's no separate completed_at column here: a run
// either finishes and this row gets written, or it throws and nothing
// after that point runs at all (including this write) — the row's mere
// EXISTENCE is the "completed" signal, not a nullable flag on it.
const MOVEMENT_LOG_RUNS_SHEET_ = 'Movement_Log_Runs';
// total_s / skipped_phases (email audit F23, 2026-10-07): the run row is now written as soon as the CORE capture is down, and
// these two cells are filled in when the run ends. A row whose total_s is still blank is a run that never reached its end (the
// platform killed it) - the same signal the snapshotPeriodic run record gives the watchdog, readable by eye in the sheet.
// failed_phases (2026-10-07): the optional steps that THREW in this run (they are also emailed to ops - alertSnapshotPhaseFailuresGs_).
// phase_s (2026-10-07): where the run's time went - "core capture 95s | SLA_History write 14s | ..." - so a slow run can be diagnosed
// from the sheet without opening the Executions log (a skipped step is absent; a failed one is marked FAILED).
const MOVEMENT_LOG_RUNS_COLUMNS_ = ['run_at', 'run_label', 'lead_count_seen', 'leads_changed', 'total_s', 'skipped_phases', 'failed_phases', 'phase_s'];

function ensureMovementLogRunsSheet_(ss) {
  let sheet = ss.getSheetByName(MOVEMENT_LOG_RUNS_SHEET_);
  if (!sheet) {
    sheet = ss.insertSheet(MOVEMENT_LOG_RUNS_SHEET_);
    sheet.getRange(1, 1, 1, MOVEMENT_LOG_RUNS_COLUMNS_.length).setValues([MOVEMENT_LOG_RUNS_COLUMNS_]);
    sheet.setFrozenRows(1);
    return sheet;
  }
  // Self-heal a sheet created before total_s / skipped_phases existed: append whichever header labels are missing (never
  // reorders or overwrites an existing one), the same pattern ensureSlaHistorySheet_ uses.
  const lastCol = sheet.getLastColumn();
  const existing = lastCol > 0 ? sheet.getRange(1, 1, 1, lastCol).getValues()[0].map(function (h) { return String(h || '').trim(); }) : [];
  const missing = MOVEMENT_LOG_RUNS_COLUMNS_.filter(function (h) { return existing.indexOf(h) === -1; });
  if (missing.length) sheet.getRange(1, lastCol + 1, 1, missing.length).setValues([missing]);
  return sheet;
}

function ensureMovementLogSheet_(ss) {
  let sheet = ss.getSheetByName(MOVEMENT_LOG_SHEET);
  const fullHeaders = ['snapshot_at', 'snapshot_label'].concat(SNAPSHOT_COLUMNS_).concat([CONTENT_HASH_COLUMN_]);
  if (!sheet) {
    sheet = ss.insertSheet(MOVEMENT_LOG_SHEET);
    sheet.getRange(1, 1, 1, fullHeaders.length).setValues([fullHeaders]);
    sheet.setFrozenRows(1);
  } else {
    // Self-heal: a sheet set up before a column was added to
    // SNAPSHOT_COLUMNS_ (e.g. stage_comments) is missing that header
    // label entirely, even though snapshotOpenLeads_ below is about to
    // start writing values into that trailing column position — without
    // this, the dashboard's header-label lookup (and this script's own
    // buildColIndex_) would never find the label and read every value in
    // that column as blank. New fields are always appended to
    // SNAPSHOT_COLUMNS_ rather than inserted mid-array (see its comment),
    // so a missing field belongs immediately BEFORE content_hash — the
    // writers put every field first and the hash last. When the hash
    // column already exists the header is therefore INSERTED there, which
    // also shifts every old row's hash right with its header. Appending
    // at the end instead put the new label AFTER content_hash while the
    // writers put the value BEFORE it: a one-column offset that made the
    // dedup read opp_at where it expected the hash, so every lead was
    // re-appended on every run (2026-09-22 to 09-25; see HANDOVER.md §8).
    // Re-checked on every call — cheap, idempotent.
    const lastCol = sheet.getLastColumn();
    const existingHeaders = lastCol > 0 ? sheet.getRange(1, 1, 1, lastCol).getValues()[0] : [];
    const existingSet = {};
    const trimmedHeaders = existingHeaders.map(function (h) { return String(h || '').trim(); });
    trimmedHeaders.forEach(function (h) { existingSet[h] = true; });
    const missing = fullHeaders.filter(function (h) { return !existingSet[h]; });
    if (missing.length) {
      const hashPos = trimmedHeaders.indexOf(CONTENT_HASH_COLUMN_) + 1; // 1-based; 0 = no hash column yet
      const fieldsMissing = missing.filter(function (h) { return h !== CONTENT_HASH_COLUMN_; });
      if (hashPos > 0 && fieldsMissing.length) {
        sheet.insertColumnsBefore(hashPos, fieldsMissing.length);
        sheet.getRange(1, hashPos, 1, fieldsMissing.length).setValues([fieldsMissing]);
      } else {
        sheet.getRange(1, lastCol + 1, 1, missing.length).setValues([missing]);
      }
    }
  }

  // Force a full date+TIME display format on every date-ish column,
  // re-applied on every call (cheap, idempotent — also self-heals an
  // already-created sheet, not just a brand-new one). Without this,
  // Sheets can auto-format a freshly-written Date column as "Date" only
  // (no time) instead of "Date time" — the underlying value still HAS
  // the correct time, but a date-only-typed column reports through gviz
  // as just Date(y,m,d) with no hour/minute component at all. The
  // dashboard's reader fills a missing time with zeros, so that shows up
  // as every snapshot reading 12:00 AM regardless of when it actually ran.
  const DATETIME_FORMAT = 'yyyy-mm-dd hh:mm:ss';
  const formatRows = Math.max(sheet.getMaxRows() - 1, 1);
  sheet.getRange(2, 1, formatRows, 1).setNumberFormat(DATETIME_FORMAT); // snapshot_at
  const leadAssignedCol = 3 + SNAPSHOT_COLUMNS_.indexOf('lead_assigned_at');
  const lastConnectTimeCol = 3 + SNAPSHOT_COLUMNS_.indexOf('last_connect_time');
  const oppAtCol = 3 + SNAPSHOT_COLUMNS_.indexOf('opp_at');
  sheet.getRange(2, leadAssignedCol, formatRows, 1).setNumberFormat(DATETIME_FORMAT);
  sheet.getRange(2, lastConnectTimeCol, formatRows, 1).setNumberFormat(DATETIME_FORMAT);
  sheet.getRange(2, oppAtCol, formatRows, 1).setNumberFormat(DATETIME_FORMAT);

  return sheet;
}

// Refuses to append into a Movement_Log whose header is not laid out the
// way the writers lay rows out (snapshot_at, snapshot_label, every
// SNAPSHOT_COLUMNS_ field in order, then content_hash). A misaligned
// header does not fail loudly on its own: rows still append, the dedup
// just reads the wrong column and re-appends every lead on every run —
// which is how ~52k junk rows accumulated over 09-22..09-23 before
// anyone noticed. Failing the run instead is visible (Execution log,
// checkMovementLogFreshness_) and loses nothing: the next run captures
// the same leads once the header is fixed.
function assertMovementLogHeaderAligned_(sheet) {
  const want = ['snapshot_at', 'snapshot_label'].concat(SNAPSHOT_COLUMNS_).concat([CONTENT_HASH_COLUMN_]);
  const got = sheet.getRange(1, 1, 1, want.length).getValues()[0];
  for (let i = 0; i < want.length; i++) {
    const actual = String(got[i] === undefined || got[i] === null ? '' : got[i]).trim();
    if (actual !== want[i]) {
      throw new Error('Movement_Log header column ' + (i + 1) + ' is "' + actual + '" but the writers put "' + want[i] +
        '" there - refusing to append rows into a misaligned sheet (see HANDOVER.md section 8, 2026-09-25 incident).');
    }
  }
}

// ==================== SLA_History (automatic, no dashboard needed) ====================
// Writes one row per run to SLA_History using computeSlaFlags_
// (SlaEngine.gs) — so compliance tracking never has a gap on a day
// nobody opens the dashboard. See writeSlaHistorySnapshot_ below, called
// from snapshotOpenLeads_ right alongside the Movement_Log write it
// already does every 6h.
const SLA_HISTORY_SHEET_ = 'SLA_History';
// Order matches dashboard.html's own upsertSlaHistoryRows — snapshot_at/
// source appended at the end so either writer's rows land in the same
// columns regardless of which one created the tab first.
const SLA_HISTORY_COLUMNS_ = [
  'date', 'openTotal', 'breachedTotal',
  'inactiveRmNewLead', 'isNotUpdated', 'followupOverdue', 'underCalledToday', 'stageStuck48h',
  'snapshot_at', 'source',
];

// Raw parsed Movement_Log rows — {key, atMs, call_attempts} per row, NOT
// yet collapsed to "latest per key". Split out from the old
// _lastMovementLogSnapshotByKeyGs_ (2026-08-28, perf pass) so the actual
// Sheets read happens in exactly ONE place: every caller that needs the
// "latest snapshot before some cutoff" answer for MORE than one cutoff
// (every email-send path does — see buildMovementLogMapsGs_ below) can
// now read Movement_Log — the largest sheet in this project — ONCE and
// derive every cutoff's answer from the same in-memory array, instead of
// each cutoff triggering its own full getRange().getValues() round-trip.
//
// KEYED BY LEAD ID, NOT client_id (email audit F18, 2026-10-07). call_attempts is a per-LEAD lifetime counter: all RM copies
// of one lead id carry the identical value (0 of 1,852 multi-row leads differed), but a customer's several leads each carry
// their own. Keyed by client_id, a lead's "calls today" was measured against whichever sibling lead's snapshot happened to
// come first (37 of 764 open Google Non-UTM leads had a different baseline; 3 were wrongly NOT flagged "Behind on Today's
// Calls"). js/tab-movement.js's buildTodayCallBaseline/lastSnapshotBefore key the same way - keep the two in step.
//
// ONLY THE FIVE COLUMNS IT NEEDS are read (email audit F23; RM and content_hash added 2026-10-10 for the stale-lead check, leadStaleStateGs_): this sheet is
// ~48K rows x 26 columns and the full-width read was most of snapshotPeriodic's run time.
function _readMovementLogRowsGs_(ss) {
  const out = [];
  const sheet = ss.getSheetByName(MOVEMENT_LOG_SHEET);
  if (!sheet) return out;
  const data = _readMovementLogColumnsGs_(sheet, ['snapshot_at', 'lead_id', 'call_attempts', 'RM', CONTENT_HASH_COLUMN_]);
  if (!data.rowCount || data.idx.snapshot_at === -1 || data.idx.call_attempts === -1 || data.idx.lead_id === -1) return out;

  for (let i = 0; i < data.rowCount; i++) {
    const ts = data.cols.snapshot_at[i][0];
    if (!(ts instanceof Date)) continue;
    const leadId = String(data.cols.lead_id[i][0] || '').trim();
    if (!leadId) continue; // no lead id: nothing a live lead could ever look this row up by
    out.push({
      key: leadId, atMs: ts.getTime(), call_attempts: Number(data.cols.call_attempts[i][0]) || 0,
      dedupKey: _dedupKeyGs_(leadId, data.idx.RM === -1 ? '' : data.cols.RM[i][0]), // lead id + RM, the same identity the snapshot dedup uses
      hash: data.idx[CONTENT_HASH_COLUMN_] === -1 ? '' : String(data.cols[CONTENT_HASH_COLUMN_][i][0] || '').trim(), // '' for a row captured before hashing existed
    });
  }
  return out;
}

// Reads ONLY the named Movement_Log columns, one single-column range each, instead of the whole 26-column width (email audit
// F23). Returns { rowCount, idx: {name: 0-based column or -1}, cols: {name: [[v], [v], ...]} } - cols[name][i][0] is data row
// i (the sheet's row i + 2). A name the sheet does not have is idx -1 and has no cols entry; an empty sheet is rowCount 0.
function _readMovementLogColumnsGs_(sheet, names) {
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return { rowCount: 0, idx: {}, cols: {} };
  const lastCol = sheet.getLastColumn();
  const headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  const idx = {};
  const cols = {};
  names.forEach(function (name) {
    idx[name] = headers.indexOf(name);
    if (idx[name] !== -1) cols[name] = sheet.getRange(2, idx[name] + 1, lastRow - 1, 1).getValues();
  });
  return { rowCount: lastRow - 1, idx: idx, cols: cols };
}

// For every identity key, keeps the LATEST row strictly before `cutoffMs`
// as {atMs, call_attempts}. Pure in-memory pass over rows already read by
// _readMovementLogRowsGs_ — no Sheets calls here, so a caller applying
// more than one cutoff (see buildMovementLogMapsGs_) can call this
// cheaply as many times as needed against the SAME read.
function _collapseLatestByKeyGs_(rows, cutoffMs) {
  const map = {};
  rows.forEach(function (r) {
    if (r.atMs >= cutoffMs) return;
    const cur = map[r.key];
    if (!cur || r.atMs > cur.atMs) map[r.key] = { atMs: r.atMs, call_attempts: r.call_attempts };
  });
  return map;
}

// For every lead (lead id + RM), the MOST RECENT Movement_Log row that carries a content hash: { atMs, hash }. Because the snapshot only writes a row when a lead's tracked
// content differs from its latest row (content-hash dedup), that row's time is the last time the lead was OBSERVED to change - a stage change, a new comment, a call-count
// increase, a connect, a reassignment. Pure, over rows already read by _readMovementLogRowsGs_.
function _collapseLatestChangeGs_(rows) {
  const map = {};
  rows.forEach(function (r) {
    if (!r.hash) return;
    const cur = map[r.dedupKey];
    if (!cur || r.atMs > cur.atMs) map[r.dedupKey] = { atMs: r.atMs, hash: r.hash };
  });
  return map;
}

// Single-cutoff convenience wrapper — same signature/behavior as before
// this was split into _readMovementLogRowsGs_ + _collapseLatestByKeyGs_.
// Kept for the one caller that only ever needs ONE cutoff
// (buildTodayCallBaselineGs_'s own use inside writeSlaHistorySnapshot_/
// snapshotOpenLeads_, which never also needs lastSnapshotBeforeGs_ in the
// same run) — a caller needing BOTH should use buildMovementLogMapsGs_
// below instead, to avoid two separate reads.
function _lastMovementLogSnapshotByKeyGs_(ss, cutoffMs) {
  return _collapseLatestByKeyGs_(_readMovementLogRowsGs_(ss), cutoffMs);
}

// Content-hash dedup (Phase 6) — one extra, dedicated read of
// Movement_Log's key/timestamp/content_hash columns only (not the full
// row width _readMovementLogHistoryRowsGs_ reads), collapsed to each
// lead's MOST RECENT hash regardless of retention cutoff — unlike
// _collapseLatestByKeyGs_ above, dedup must compare against whatever the
// latest row actually is, not "latest before some boundary". A sheet
// with no content_hash column yet (not upgraded, or genuinely empty)
// returns {} — every lead in that case falls through to "no prior hash",
// so the fresh capture always writes, which is the safe direction to
// fail in (an extra row, never a wrongly-skipped one).
function _latestContentHashByKeyGs_(ss) {
  const map = {};
  const sheet = ss.getSheetByName(MOVEMENT_LOG_SHEET);
  if (!sheet) return map;
  // Only the four columns the lookup needs (email audit F23) - the comment above has always said "key/timestamp/content_hash
  // columns only", but the code read every column of every row.
  const data = _readMovementLogColumnsGs_(sheet, ['snapshot_at', 'lead_id', 'RM', CONTENT_HASH_COLUMN_]);
  if (!data.rowCount || data.idx.snapshot_at === -1 || data.idx[CONTENT_HASH_COLUMN_] === -1) return map; // not upgraded yet

  for (let i = 0; i < data.rowCount; i++) {
    const ts = data.cols.snapshot_at[i][0];
    if (!(ts instanceof Date)) continue;
    const hash = String(data.cols[CONTENT_HASH_COLUMN_][i][0] || '').trim();
    if (!hash) continue; // a pre-upgrade row has no hash to compare against
    const key = _dedupKeyGs_(data.idx.lead_id === -1 ? '' : data.cols.lead_id[i][0], data.idx.RM === -1 ? '' : data.cols.RM[i][0]);
    const cur = map[key];
    if (!cur || ts.getTime() > cur.atMs) map[key] = { atMs: ts.getTime(), hash: hash };
  }

  const out = {};
  Object.keys(map).forEach(function (k) { out[k] = map[k].hash; });
  return out;
}

// Content-hash dedup identity of ONE leads-tab row: lead_id + RM. NOT client_id:
// a customer's several rows (one per RM/assignment) all share a client_id, so only
// one of them could ever match the single hash stored under that key and every
// other row was re-appended on every capture (2026-09-26 analysis: ~2,000 of one
// capture's 5,473 rows were byte-identical to their previous row; lead_id + RM was
// unique across all of them). No stored hash needs migrating - each Movement_Log
// row already carries its own lead_id, RM and hash. js/tab-movement.js's
// movementDedupKey MUST build the identical string (both are asserted against the
// same literal in Tests_MovementTracker.gs and tests/frontend-harness.html).
//
// A blank RM is keyed as 'Unassigned', the same value the browser's parse gives it
// (js/core-fetch-and-render.js) and its Movement_Log reader gives a blank cell.
function _dedupKeyGs_(leadId, rm) {
  return String(leadId === null || leadId === undefined ? '' : leadId).trim() + '|' +
    (String(rm === null || rm === undefined ? '' : rm).trim() || 'Unassigned');
}

// Each lead's call_attempts as of the latest snapshot strictly before
// `beforeDate`'s IST calendar day (i.e. yesterday-or-earlier only) —
// direct port of dashboard.html's buildTodayCallBaseline. Exists to
// compute "calls made so far TODAY" (callAttempts - this baseline, see
// computeSlaFlags_'s underCalledToday, SlaEngine.gs) against a fixed
// start-of-day reference point — deliberately NOT "the most recent
// snapshot, whenever that was", which lastSnapshotBeforeGs_ below is for.
function buildTodayCallBaselineGs_(ss, beforeDate) {
  const todayStart = new Date(istDayKeyGs_(beforeDate) + 'T00:00:00+05:30').getTime();
  const detailed = _lastMovementLogSnapshotByKeyGs_(ss, todayStart);
  const map = {};
  Object.keys(detailed).forEach(function (key) { map[key] = detailed[key].call_attempts; });
  return map;
}

// Each lead's LATEST snapshot strictly before `beforeDate`, whatever
// calendar day it falls on — as {atMs, call_attempts}. Used by
// noCommentFollowUpGs_ (FollowupEngine.gs) to compare against the most
// recent actually-known call_attempts count and tell "genuinely stalled"
// from "actively being worked". Deliberately NOT
// buildTodayCallBaselineGs_'s "yesterday or earlier only" scope: an
// overnight lead's most recent prior snapshot is typically from EARLIER
// TODAY (snapshots run 4x/day, see SNAPSHOT_HOURS_), and that today's
// snapshot is exactly the "N hours ago" reference point this needs —
// buildTodayCallBaselineGs_'s day-boundary gate would incorrectly
// exclude it.
function lastSnapshotBeforeGs_(ss, beforeDate) {
  return _lastMovementLogSnapshotByKeyGs_(ss, beforeDate.getTime());
}

// Both maps at once, from a SINGLE Movement_Log read — every email-send
// path (OvernightEmailer.gs's morning + follow-up runs,
// AllIssuesEmailer.gs's run) needs both buildTodayCallBaselineGs_'s and
// lastSnapshotBeforeGs_'s answers together, and previously called each
// separately, paying for Movement_Log's full read TWICE per run. The two
// cutoffs are genuinely different (start-of-today vs strictly-before-now)
// so neither map can be derived from the other — but both can be derived
// from the SAME raw rows, which is the actual expensive part (the Sheets
// round-trip), not the in-memory collapse.
function buildMovementLogMapsGs_(ss, now) {
  const rows = _readMovementLogRowsGs_(ss);
  const todayStart = new Date(istDayKeyGs_(now) + 'T00:00:00+05:30').getTime();
  const detailedBaseline = _collapseLatestByKeyGs_(rows, todayStart);
  const baselineMap = {};
  Object.keys(detailedBaseline).forEach(function (key) { baselineMap[key] = detailedBaseline[key].call_attempts; });
  return { baselineMap: baselineMap, lastSnapshotMap: _collapseLatestByKeyGs_(rows, now.getTime()), lastChangeMap: _collapseLatestChangeGs_(rows) };
}

function ensureSlaHistorySheet_(ss) {
  let sheet = ss.getSheetByName(SLA_HISTORY_SHEET_);
  if (!sheet) {
    sheet = ss.insertSheet(SLA_HISTORY_SHEET_);
    sheet.getRange(1, 1, 1, SLA_HISTORY_COLUMNS_.length).setValues([SLA_HISTORY_COLUMNS_]);
    sheet.setFrozenRows(1);
    return sheet;
  }
  // Self-heal, same pattern as ensureMovementLogSheet_ — append whatever
  // header columns are missing rather than requiring an exact pre-built
  // match, so a tab created by hand (see the dashboard walkthrough) still
  // ends up with every column this script expects.
  const lastCol = sheet.getLastColumn();
  const existingHeaders = lastCol > 0 ? sheet.getRange(1, 1, 1, lastCol).getValues()[0] : [];
  const existingSet = {};
  existingHeaders.forEach(function (h) { existingSet[String(h || '').trim()] = true; });
  const missing = SLA_HISTORY_COLUMNS_.filter(function (h) { return !existingSet[h]; });
  if (missing.length) {
    sheet.getRange(1, lastCol + 1, 1, missing.length).setValues([missing]);
  }
  return sheet;
}

// Computes SLA compliance for every lead in `dataRows` (the SAME rows
// snapshotOpenLeads_ just read from the source tab — no separate read) and
// appends one row to SLA_History, source='AppsScript'. Plain append, no
// upsert-by-key check — snapshotOpenLeads_ itself doesn't guard against a
// rare trigger double-fire either (see pruneMovementLog_), so this stays
// consistent with that precedent rather than adding one-sided defensive
// code for this write path only.
function writeSlaHistorySnapshot_(ss, dataRows, colIndex, now) {
  const baselineMap = buildTodayCallBaselineGs_(ss, now);
  const checkKeys = ['inactiveRmNewLead', 'isNotUpdated', 'followupOverdue', 'underCalledToday', 'stageStuck48h'];
  const byCheck = {};
  checkKeys.forEach(function (k) { byCheck[k] = 0; });

  let openTotal = 0, breachedTotal = 0;
  dataRows.forEach(function (row) {
    const leadId = String(getVal_(row, colIndex, 'lead_id') || '').trim();
    if (!leadId) return;
    const flags = computeSlaFlags_(row, colIndex, now, baselineMap);
    if (!flags.isOpenLead) return;
    openTotal++;
    let isBreached = false;
    checkKeys.forEach(function (k) { if (flags[k]) { byCheck[k]++; isBreached = true; } });
    if (isBreached) breachedTotal++;
  });

  const sheet = ensureSlaHistorySheet_(ss);
  const snapshotAtValue = Utilities.formatDate(now, 'Asia/Kolkata', 'yyyy-MM-dd HH:mm:ss');
  const record = [istDayKeyGs_(now), openTotal, breachedTotal];
  checkKeys.forEach(function (k) { record.push(byCheck[k]); });
  record.push(snapshotAtValue, 'AppsScript');

  const startRow = sheet.getLastRow() + 1;
  sheet.getRange(startRow, 1, 1, record.length).setValues([record]);
}

// ---- Time budget + phases (email audit F23, 2026-10-07) ----
// snapshotPeriodic hit Apps Script's 30-minute execution limit three times in five days (1,802-1,803 s; 1 Oct 00:18, 2 Oct 18:51,
// 4 Oct 06:08) and several other runs took 12-29 minutes, against a ~48K-row x 26-column Movement_Log it read in full four times
// per run and rewrote in full on nearly every run. The fixes: narrow column reads, a prefix-delete prune (above), and this
// structure - the CORE capture (hash lookup + append, the thing every baseline and every history view depends on) runs FIRST and
// is recorded in Movement_Log_Runs the moment it is down; everything else is an optional phase that STARTS only while the run is
// still inside SNAPSHOT_OPTIONAL_PHASE_DEADLINE_SECONDS_. A skipped phase is not lost work: each one is idempotent and the next
// run does it. The deadline leaves ~16 minutes for the slowest single phase to finish before the platform's 30-minute kill.
const SNAPSHOT_OPTIONAL_PHASE_DEADLINE_SECONDS_ = 840;

// Runs one optional phase if the run is still inside its time budget. ctx = { nowMs: () => ms, startedMs, deadlineS, skipped: [],
// errors: [], failed: [{phase, message}] } (a plain object so a test can drive the clock). A phase that throws is logged, recorded in
// ctx.failed (so it is emailed and shown in Movement_Log_Runs) and the run carries on - UNLESS
// `rethrow` is set, in which case the error is kept in ctx.errors and re-thrown by the caller at the very end, after the run
// record is written (so a failing prune still shows the execution as Failed, as it always did, without costing the later phases).
function runSnapshotPhaseGs_(ctx, name, fn, rethrow) {
  const elapsedS = (ctx.nowMs() - ctx.startedMs) / 1000;
  if (elapsedS > ctx.deadlineS) {
    ctx.skipped.push(name);
    Logger.log('[timing] SKIPPED ' + name + ' at ' + Math.round(elapsedS) + 's - past the ' + ctx.deadlineS + 's budget; the next run does it.');
    return;
  }
  const phaseStartMs = ctx.nowMs();
  try {
    fn();
    const phaseSeconds = Math.round((ctx.nowMs() - phaseStartMs) / 1000);
    if (ctx.timings) ctx.timings.push(name + ' ' + phaseSeconds + 's');
    Logger.log('[timing] ' + name + ' took ' + phaseSeconds + 's (run at ' + Math.round((ctx.nowMs() - ctx.startedMs) / 1000) + 's)');
  } catch (e) {
    if (ctx.timings) ctx.timings.push(name + ' FAILED after ' + Math.round((ctx.nowMs() - phaseStartMs) / 1000) + 's');
    Logger.log(name + ' failed (Movement_Log capture continues): ' + e);
    ctx.failed.push({ phase: name, message: String((e && e.message) || e).slice(0, 400) });
    if (rethrow) ctx.errors.push(e);
  }
}

/**
 * Core snapshot routine — reads the current month tab and appends one row
 * per lead to Movement_Log, for every lead in the tab (any source, open or
 * closed — the only requirement is a non-blank lead_id). `label` is a
 * human-readable tag for the run ("2026-08-13 14:07 IST"), shown as-is in
 * the log for anyone reading the raw tab directly.
 *
 * `opts` is a test hook only: { nowMs: () => ms, deadlineSeconds } replaces the
 * wall clock / the optional-phase budget so a test can simulate a slow run.
 * Returns { leadCountSeen, leadsChanged, totalSeconds, skipped: [phase names], failed: [phase names that threw], timings: ["step 12s", ...] },
 * or null when the tab has nothing to snapshot.
 */
function snapshotOpenLeads_(label, opts) {
  const options = opts || {};
  const ctx = {
    nowMs: options.nowMs || function () { return Date.now(); },
    startedMs: 0,
    deadlineS: options.deadlineSeconds !== undefined ? options.deadlineSeconds : SNAPSHOT_OPTIONAL_PHASE_DEADLINE_SECONDS_,
    skipped: [],
    errors: [],
    failed: [],
    timings: [],
  };
  ctx.startedMs = ctx.nowMs();
  const sinceStartS = function () { return Math.round((ctx.nowMs() - ctx.startedMs) / 1000); };

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const tabName = resolveTabName_(ss);
  const src = ss.getSheetByName(tabName);
  if (!src) throw new Error('Movement Tracker: tab "' + tabName + '" not found.');

  const lastRow = src.getLastRow();
  const lastCol = src.getLastColumn();
  if (lastRow < 3) return null; // nothing but a banner/header row — nothing to snapshot

  const headerRow = src.getRange(2, 1, 1, lastCol).getValues()[0];
  const colIndex = buildColIndex_(headerRow);
  const dataRows = src.getRange(3, 1, lastRow - 2, lastCol).getValues();
  Logger.log('[timing] read ' + dataRows.length + ' leads-tab rows at ' + sinceStartS() + 's');

  const now = new Date();
  const snapshotLabel = label || Utilities.formatDate(now, 'Asia/Kolkata', 'yyyy-MM-dd HH:mm') + ' IST';

  // ---- CORE capture: runs first, before any optional work ----
  // Content-hash dedup (Lead History & Versioning Review, Phase 6) — read
  // every lead's latest hash ONCE, before this run writes anything, same
  // "one read, many lookups" discipline buildMovementLogMapsGs_ already
  // established. A lead whose live values hash identically to its latest
  // Movement_Log row is CONFIRMED (its ingestion run is still recorded
  // below via Movement_Log_Runs) but does NOT get a new duplicate row —
  // see _leadContentHashGs_'s own header for exactly what's hashed and why.
  const latestHashByKey = _latestContentHashByKeyGs_(ss);
  Logger.log('[timing] hash lookup read at ' + sinceStartS() + 's');

  let leadCountSeen = 0;
  const out = [];
  dataRows.forEach(function (row) {
    const leadId = String(getVal_(row, colIndex, 'lead_id') || '').trim();
    if (!leadId) return;
    leadCountSeen++;

    const key = _dedupKeyGs_(leadId, getVal_(row, colIndex, 'RM'));
    const hash = _leadContentHashGs_(function (fieldKey) { return getVal_(row, colIndex, fieldKey); });
    if (latestHashByKey[key] === hash) return; // unchanged since the last capture — no new row

    const record = [now, snapshotLabel];
    SNAPSHOT_COLUMNS_.forEach(function (fieldKey) {
      record.push(getVal_(row, colIndex, fieldKey));
    });
    record.push(hash);
    out.push(record);
  });

  if (out.length) {
    const logSheet = ensureMovementLogSheet_(ss);
    assertMovementLogHeaderAligned_(logSheet);
    const startRow = logSheet.getLastRow() + 1;
    logSheet.getRange(startRow, 1, out.length, out[0].length).setValues(out);
  }
  Logger.log('[timing] core capture: ' + out.length + ' changed of ' + leadCountSeen + ' leads, appended by ' + sinceStartS() + 's');
  ctx.timings.push('core capture (read, hash, append) ' + sinceStartS() + 's');

  // The run record, written as soon as the core capture is down and ALWAYS (even when out.length is 0 — a run happened whether
  // or not any lead's content changed; keeping those two concepts independent is what Phase 6 of the Lead History &
  // Versioning Review requires). total_s / skipped_phases are filled in at the very end; a row that still has them blank is a
  // run the platform killed after its capture. Wrapped so it can never block anything after it.
  let runsSheet = null;
  let runRow = 0;
  try {
    runsSheet = ensureMovementLogRunsSheet_(ss);
    runRow = runsSheet.getLastRow() + 1;
    runsSheet.getRange(runRow, 1, 1, MOVEMENT_LOG_RUNS_COLUMNS_.length)
      .setValues([[now, snapshotLabel, leadCountSeen, out.length, '', '', '', '']]);
  } catch (e) {
    Logger.log('Movement_Log_Runs write failed (Movement_Log capture continues): ' + e);
    runsSheet = null;
  }

  // ---- Optional phases, in priority order, each only while the run is inside its time budget ----
  // Computed from the SAME dataRows/colIndex read above. The today's-calls baseline it looks up is "the latest snapshot strictly
  // BEFORE the start of today (IST)", so this run's own rows - appended above, stamped `now` - can never be what it reads.
  runSnapshotPhaseGs_(ctx, 'SLA_History write', function () { writeSlaHistorySnapshot_(ss, dataRows, colIndex, now); });

  // Same dataRows/colIndex, same wrapped-so-it-can-never-block-the-real-
  // capture treatment as the SLA_History write just above — see
  // UnmatchedCommentLogger.gs's own header for why this lives here
  // rather than on its own trigger.
  runSnapshotPhaseGs_(ctx, 'Unmatched_Comments_Log scan', function () { scanUnmatchedCommentsGs_(ss, dataRows, colIndex, now); });

  // See InteractionHistoryLogger.gs's own header for why this exists (the
  // forward-looking capture decision from the "No real interaction-history
  // data exists anywhere" To-Do task, 2026-09-05).
  runSnapshotPhaseGs_(ctx, 'Comment_History log', function () { logInteractionHistoryGs_(ss, dataRows, colIndex, now); });

  // Pruning old rows is independent of whether any lead's content changed this time. A failure here is re-thrown at the end
  // (after the run record) so the execution still shows Failed.
  runSnapshotPhaseGs_(ctx, 'Movement_Log prune', function () { pruneMovementLog_(ss); }, true);

  // Added 2026-09-29 — see each file's own header ("PRUNING" / "AGE-BASED PRUNING") for why these exist: the cell-budget
  // diagnostic (Core.gs) found both tabs large enough (2026-09-28) that Snehil confirmed a 30-day retention window for both.
  runSnapshotPhaseGs_(ctx, 'Comment_History prune', function () { pruneCommentHistory_(ss); });
  runSnapshotPhaseGs_(ctx, 'Unmatched_Comments_Log prune', function () { pruneUnmatchedCommentsLog_(ss); });

  // Runs LAST, after Movement_Log's own prune, so it reads Movement_Log's
  // true current (post-prune) retained range rather than a stale
  // about-to-be-trimmed one. See persistDailyCohortHistoryGs_'s own header
  // comment for why this needs to run unattended at all.
  runSnapshotPhaseGs_(ctx, 'Daily_Cohort_History persist', function () { persistDailyCohortHistoryGs_(ss, dataRows, colIndex, now); });

  const totalSeconds = sinceStartS();
  Logger.log('[timing] snapshot finished in ' + totalSeconds + 's' + (ctx.skipped.length ? ' - SKIPPED: ' + ctx.skipped.join(', ') : ''));
  if (runsSheet && runRow) {
    try {
      const totalCol = MOVEMENT_LOG_RUNS_COLUMNS_.indexOf('total_s') + 1;
      runsSheet.getRange(runRow, totalCol, 1, 4).setValues([[totalSeconds, ctx.skipped.join(', '), ctx.failed.map(function (f) { return f.phase; }).join(', '), ctx.timings.join(' | ')]]);
    } catch (e) {
      Logger.log('Movement_Log_Runs total_s update failed (the capture itself is complete): ' + e);
    }
  }
  // Tell ops about every step that threw (once per day per step) - BEFORE re-throwing a prune failure below, so that case is emailed too.
  try {
    alertSnapshotPhaseFailuresGs_(ctx.failed, snapshotLabel, now);
  } catch (e) {
    Logger.log('Snapshot phase-failure alert failed (the capture itself is complete): ' + e);
  }
  if (ctx.errors.length) throw ctx.errors[0];
  return { leadCountSeen: leadCountSeen, leadsChanged: out.length, totalSeconds: totalSeconds, skipped: ctx.skipped.slice(), failed: ctx.failed.map(function (f) { return f.phase; }), timings: ctx.timings.slice() };
}

// A phase that FAILED (threw) used to be only logged: nobody was told, so the Comment_History / Unmatched_Comments_Log prunes
// failed for days on a mis-counting archive check without a single email (2026-10-07). Now every failed phase is (1) kept in the
// run's result and in Movement_Log_Runs.failed_phases and (2) emailed to ops - at most ONCE PER DAY PER PHASE (the run is every 6
// hours and a phase that fails will fail again; a different phase failing the same day still alerts). The capture itself is never
// affected by any of this: a failing alert is logged and swallowed. State is one Script Property:
// SNAPSHOT_PHASE_ALERTED = {day, phases: [names already alerted today]}; an unreadable property means "alert anyway".
const SNAPSHOT_PHASE_ALERT_PROPERTY_ = 'SNAPSHOT_PHASE_ALERTED';
function alertSnapshotPhaseFailuresGs_(failed, label, now) {
  if (!failed || !failed.length) return 0;
  const day = istDayKeyGs_(now || new Date());
  let already = [];
  try {
    const raw = PropertiesService.getScriptProperties().getProperty(SNAPSHOT_PHASE_ALERT_PROPERTY_);
    const rec = raw ? JSON.parse(raw) : null;
    if (rec && rec.day === day && Array.isArray(rec.phases)) already = rec.phases;
  } catch (e) {
    already = [];
  }
  const fresh = failed.filter(function (f) { return already.indexOf(f.phase) === -1; });
  if (!fresh.length) return 0;
  const lines = ['The Movement_Log snapshot run "' + (label || '') + '" finished its capture but these steps FAILED:', ''];
  fresh.forEach(function (f) { lines.push('- ' + f.phase + ': ' + f.message); });
  lines.push('');
  lines.push('The capture itself (Movement_Log rows, the call baselines every email uses) is NOT affected. A failed prune means that tab keeps growing past its retention window until it succeeds; a failed log or scan means that run\'s rows are missing from it. Each step is retried on the next run (every 6 hours).');
  lines.push('This email is sent once per day per step. Full error text: the Apps Script Executions list, this run, log lines starting with the step name.');
  notifyOpsAlertGs_('Movement snapshot: ' + fresh.map(function (f) { return f.phase; }).join(', ') + ' FAILED', lines);
  try {
    PropertiesService.getScriptProperties().setProperty(SNAPSHOT_PHASE_ALERT_PROPERTY_, JSON.stringify({ day: day, phases: already.concat(fresh.map(function (f) { return f.phase; })) }));
  } catch (e2) {
    Logger.log('alertSnapshotPhaseFailuresGs_: could not record the alert (a repeat alert may follow): ' + e2);
  }
  return fresh.length;
}


// Rewrites the whole data range with only rows newer than the retention
// window — simpler and safer than deleting individual rows out from under
// a range that keeps shifting. Also shrinks the sheet's actual row
// allocation to match, via deleteRows — see the comment further down for
// why that step is not optional.
//
// SAFETY, added after a real production incident (2026-09-12): this used
// to clearContent() the WHOLE data range FIRST, then write `kept` back —
// meaning any interruption between those two calls left the sheet with
// real, still-in-retention data erased and nothing written back yet.
// That's exactly what happened: at real data volume (Movement_Log had
// grown to ~200K+ rows, because pruning itself had been silently unable
// to run to completion for a long time — see below), a snapshotPeriodic
// run took long enough to hit Apps Script's 30-minute execution ceiling
// and was killed by the platform mid-function, landing inside that
// clear-then-write gap. The sheet was left with its row ALLOCATION still
// at ~196K (confirmed via Ctrl+End) but almost all DATA gone — the
// deleteRows() shrink at the very end of this function, and most of the
// real content, never got written back.
//
// Fixed by reversing the order: WRITE `kept` to its final position
// first, THEN clear only the leftover tail beyond it. An interruption
// at any point during or after the write leaves the sheet with, at
// worst, some already-expired rows still sitting past where they should
// be pruned to (stale, not lost) — which the very next successful run
// re-reads and correctly cleans up. The kept rows themselves are never
// erased before being replaced.
//
// Also skips the whole clear/write/shrink sequence entirely when every
// row is still within retention (kept.length === values.length) — a
// real, meaningful cost reduction on the common case (most runs prune
// nothing), and part of why this sheet was able to balloon to ~200K rows
// in the first place: the old code unconditionally cleared and rewrote
// the ENTIRE range on every single run regardless of whether anything
// actually needed pruning.
//
// FAST PATH (email audit F23, 2026-10-07). The log is append-only in time order, so the rows that have aged out are normally a
// contiguous PREFIX (the oldest rows). With a 7-day window and ~1.7K rows appended per run, SOMETHING expires on every run - so
// the rewrite above ran in full (read ~48K x 26 cells, write them all back) on nearly every snapshotPeriodic run, and that was
// the single biggest cost in a job that hit the 30-minute wall three times in five days. Now: read ONLY the snapshot_at column,
// and when the expired rows are a clean prefix, archive just those rows and delete just those rows (one deleteRows call; nothing
// is cleared first, so there is still no window in which in-retention data is erased). Anything that is not a clean prefix - a
// restored/backfilled older row sitting later in the sheet, a blank or non-date cell in the middle, or EVERY row expired (Sheets
// refuses to delete all non-frozen rows) - falls through to the full rewrite below, which is unchanged.
function pruneMovementLog_(ss) {
  const logSheet = ss.getSheetByName(MOVEMENT_LOG_SHEET);
  if (!logSheet) return;
  const lastRow = logSheet.getLastRow();
  if (lastRow < 2) return;
  const cutoff = new Date(Date.now() - MOVEMENT_LOG_RETENTION_DAYS * 24 * 60 * 60 * 1000);

  // Narrow pre-check: just the snapshot_at column (column A - this function has always read the timestamp from index 0).
  const stamps = logSheet.getRange(2, 1, lastRow - 1, 1).getValues();
  let expiredCount = 0;
  let keptSeen = false;
  let expiredIsPrefix = true;
  for (let i = 0; i < stamps.length; i++) {
    const ts = stamps[i][0];
    if (ts instanceof Date && ts >= cutoff) { keptSeen = true; continue; }
    expiredCount++;
    if (keptSeen) expiredIsPrefix = false; // an expired row AFTER a kept one - not a prefix
  }
  if (!expiredCount) return; // nothing to prune — don't touch the sheet at all

  const lastCol = logSheet.getLastColumn();
  const header = logSheet.getRange(1, 1, 1, lastCol).getValues()[0];

  if (expiredIsPrefix && expiredCount < lastRow - 1) {
    const droppedPrefix = logSheet.getRange(2, 1, expiredCount, lastCol).getValues();
    archiveDroppedMovementLogRowsGs_(header, droppedPrefix); // archive FIRST; a failure throws before anything is deleted
    logSheet.deleteRows(2, expiredCount);
    shrinkMovementLogAllocationGs_(logSheet, lastRow - 1 - expiredCount);
    return;
  }

  const values = logSheet.getRange(2, 1, lastRow - 1, lastCol).getValues();
  const isKeptRow_ = function (row) {
    const ts = row[0];
    return ts instanceof Date && ts >= cutoff;
  };
  const kept = values.filter(isKeptRow_);

  if (kept.length === values.length) return; // nothing to prune — don't touch the sheet at all

  // Archive what's about to be dropped, before it's gone for good — see
  // archiveRowsToDriveCsv_'s own comment (Core.gs) for why this is a Drive
  // CSV rather than an in-workbook backup, and why it runs on every prune
  // now instead of only removeEarlyCorruptedMovementLogDataNow's one-off.
  const dropped = values.filter(function (row) { return !isKeptRow_(row); });
  archiveDroppedMovementLogRowsGs_(header, dropped);

  if (kept.length) {
    logSheet.getRange(2, 1, kept.length, lastCol).setValues(kept);
  }
  // Only the leftover tail beyond the just-written kept rows — never the
  // range kept.length itself occupies, which was just populated above.
  if (lastRow - 1 > kept.length) {
    logSheet.getRange(2 + kept.length, 1, (lastRow - 1) - kept.length, lastCol).clearContent();
  }
  shrinkMovementLogAllocationGs_(logSheet, kept.length);
}

// Drive-CSV archive of rows about to be pruned, labelled with the IST date range they cover. Throws if the archive fails, so the
// caller never deletes rows it could not archive.
function archiveDroppedMovementLogRowsGs_(header, dropped) {
  // snapshot_at (column 0) is always a real Date here — pruneMovementLog_'s
  // own cutoff check already assumes this (`ts instanceof Date`).
  let minMs = null;
  let maxMs = null;
  dropped.forEach(function (row) {
    const d = row[0];
    if (!(d instanceof Date)) return;
    const ms = d.getTime();
    if (minMs === null || ms < minMs) minMs = ms;
    if (maxMs === null || ms > maxMs) maxMs = ms;
  });
  const rowDateRangeLabel = minMs !== null
    ? Utilities.formatDate(new Date(minMs), 'Asia/Kolkata', 'yyyy-MM-dd') + '_to_' + Utilities.formatDate(new Date(maxMs), 'Asia/Kolkata', 'yyyy-MM-dd')
    : 'unknown-dates';
  archiveRowsToDriveCsv_('Movement_Log', header, dropped, rowDateRangeLabel);
}

// Shrinks the sheet's declared row allocation back to the kept rows + headroom (see the long comment inside for why this is not
// optional). Shared by both prune paths.
function shrinkMovementLogAllocationGs_(logSheet, keptCount) {
  // clearContent above only empties cell VALUES — it does not shrink the
  // sheet's actual row allocation (getMaxRows()), and Google Sheets'
  // 10,000,000-cell cap is on the WORKBOOK's total declared grid size
  // (rows x columns, summed across every tab), not on cells that hold
  // real content. Without this step the sheet's row count only ever
  // grows — every setValues() call in snapshotOpenLeads_ that needs more
  // rows than currently allocated auto-expands the grid, and nothing
  // before this ever shrank it back down — which ratchets the whole
  // workbook toward that ceiling forever even though the actual DATA here
  // stays bounded to MOVEMENT_LOG_RETENTION_DAYS. Real production
  // failure this fixes: snapshotOpenLeads_'s own setValues() call
  // throwing "This action would increase the number of cells in the
  // workbook above the limit of 10000000 cells" — and because that throw
  // happens BEFORE this function is even reached (see
  // snapshotOpenLeads_), pruning could never run again to self-heal once
  // the sheet was already over the edge; see pruneMovementLogNow for the
  // one-time manual recovery that's needed once that's already happened.
  const neededRows = 1 + keptCount + MOVEMENT_LOG_ROW_HEADROOM_;
  const maxRows = logSheet.getMaxRows();
  if (maxRows > neededRows) {
    logSheet.deleteRows(neededRows + 1, maxRows - neededRows);
  }
}

// ONE-OFF RECOVERY — run this manually (function dropdown -> Run) if
// snapshotOpenLeads_/snapshotPeriodic has started failing with "This
// action would increase the number of cells in the workbook above the
// limit of 10000000 cells." That error fires from snapshotOpenLeads_'s
// own append, BEFORE it ever reaches pruneMovementLog_ — so once the
// sheet is already over the edge, the normal periodic trigger can't
// self-heal; this runs the (now row-shrinking) prune directly, without
// needing a successful snapshot append first. Safe to re-run any time.
function pruneMovementLogNow() {
  pruneMovementLog_(SpreadsheetApp.getActiveSpreadsheet());
}

/**
 * Daily Cohort History — automatic, unattended persistence of the
 * dashboard's own "Daily Cohort by Region" table (js/tab-tracking.js:
 * computeDailyCohortByRegion) into a Daily_Cohort_History sheet tab, on
 * the SAME 6-hourly trigger snapshotOpenLeads_ already runs on. Direct
 * port of computeDailyCohortByRegion / eligibleDailyCohortDates /
 * persistDailyCohortHistory (js/tab-tracking.js) and
 * upsertDailyCohortHistoryRows (js/sheets-writeback.js) — same schema,
 * same eligibility rule, same evidence-at-deadline fallback order, so a
 * row written from here is indistinguishable in shape from one the
 * browser wrote (only the `source` column differs — 'AppsScript' here
 * vs 'Dashboard'/'Backfill' from the browser).
 *
 * WHY THIS EXISTS: the browser-side persistDailyCohortHistory only runs
 * when someone actually has the dashboard open at a moment Movement_Log
 * still covers the day in question — miss that window (nobody opens the
 * dashboard for a stretch) and that day's true same-day/48h evidence is
 * gone forever once Movement_Log prunes past MOVEMENT_LOG_RETENTION_DAYS,
 * silently replaced by degraded fallback evidence (both "same-day" and
 * "48h" deadlines start resolving to the same nearest-surviving snapshot,
 * which is what made those two columns read identical for an old date).
 * Running this from the SAME unattended trigger that already captures
 * Movement_Log itself closes that gap: every day gets a real chance to be
 * recorded within 6 hours of becoming eligible, regardless of browser
 * activity.
 *
 * SELF-HEALING, GAPS ONLY, NEVER OVERWRITES AN ALREADY-ARCHIVED DAY:
 * eligibleDailyCohortDatesGs_ below always recomputes the FULL
 * currently-eligible window (every day still inside Movement_Log's
 * retention whose 48h window has elapsed), not just "today" — but
 * persistDailyCohortHistoryGs_ only ever computes and writes a date that
 * has NO row in Daily_Cohort_History yet (see _readArchivedDailyCohortDatesGs_).
 * A day missed on one run (a trigger failure, a temporary error) is
 * simply re-attempted and correctly filled in on the next run, as long as
 * it's still within Movement_Log's retention window when that next run
 * happens. A day that ages out of retention before ANY run ever covers it
 * is a genuine, permanent gap — no amount of retrying recovers data that
 * has already been pruned from Movement_Log.
 *
 * WHY NEVER RE-TOUCH AN ALREADY-ARCHIVED DAY (this is not optional):
 * evidenceAtDeadline's fallback order (nearest at-or-before the deadline,
 * else nearest after it) is only ACCURATE while genuine near-deadline
 * evidence is still retained. If a day were blindly recomputed on every
 * eligible run forever, then once its true near-48h-mark snapshot
 * eventually ages out of the 7-day window, a later re-run would fall back
 * to whatever snapshot happens to survive next — which could be a lead's
 * status from DAYS after its real 48h deadline, silently crediting a late
 * conversion that should never count, and overwriting an already-correct,
 * already-final archived row with a wrong one. Write-once avoids this
 * entirely: a day's numbers are locked in using the freshest possible
 * evidence, the very first time it becomes eligible, and never touched
 * again.
 */

const DAILY_COHORT_HISTORY_SHEET_ = 'Daily_Cohort_History';
// Must exactly match DAILY_COHORT_HISTORY_COLUMNS in js/sheets-writeback.js
// — both sides write into the same tab and must agree on column order.
const DAILY_COHORT_HISTORY_COLUMNS_ = [
  'date_region', 'date', 'region', 'created', 'same_day_resolved', 'same_day_opp',
  'window_complete', 'resolved_48h', 'opp_48h', 'closed_48h', 'updated_at', 'source',
];

function ensureDailyCohortHistorySheetGs_(ss) {
  let sheet = ss.getSheetByName(DAILY_COHORT_HISTORY_SHEET_);
  if (!sheet) {
    sheet = ss.insertSheet(DAILY_COHORT_HISTORY_SHEET_);
    sheet.getRange(1, 1, 1, DAILY_COHORT_HISTORY_COLUMNS_.length).setValues([DAILY_COHORT_HISTORY_COLUMNS_]);
    sheet.setFrozenRows(1);
  }
  return sheet;
}

// Full-row Movement_Log reader (region/stage/closing_reason/lead_assigned_at
// included) — deliberately separate from _readMovementLogRowsGs_ above,
// which only reads the {key, atMs, call_attempts} shape the SLA baseline
// maps need. Returns every retained row, unfiltered by date — callers
// slice by lead (key) and deadline themselves.
function _readMovementLogHistoryRowsGs_(ss) {
  const out = [];
  const sheet = ss.getSheetByName(MOVEMENT_LOG_SHEET);
  if (!sheet) return out;
  // The 8 columns below, not the sheet's full 26-column width (email audit F23).
  const data = _readMovementLogColumnsGs_(sheet, ['snapshot_at', 'lead_id', 'client_id', 'region', 'group_source', 'current_stage', 'closing_reason', 'lead_assigned_at']);
  if (!data.rowCount || data.idx.snapshot_at === -1) return out;
  const idx = data.idx;
  const cell = function (name, i) { return idx[name] === -1 ? '' : data.cols[name][i][0]; };

  for (let i = 0; i < data.rowCount; i++) {
    const ts = data.cols.snapshot_at[i][0];
    if (!(ts instanceof Date)) continue;
    const leadId = String(cell('lead_id', i) || '').trim();
    if (!leadId) continue;
    const clientId = String(cell('client_id', i) || '').trim();
    out.push({
      key: clientId || ('l:' + leadId), // customer identity ON PURPOSE - the daily cohort is counted per customer, not per lead
      atMs: ts.getTime(),
      region: cell('region', i),
      groupSource: cell('group_source', i),
      stage: cell('current_stage', i),
      closingReason: cell('closing_reason', i),
      leadAssignedAt: cell('lead_assigned_at', i),
    });
  }
  return out;
}

// Port of dashboard.html/reports.js's effectiveRegion, GROUP_SOURCE-only:
// Movement_Log never captures a project_region column (not in
// SNAPSHOT_COLUMNS_ above), so the browser's project_region-based Loan
// override can never fire off a stored snapshot row either — this mirrors
// exactly what's actually reachable from Movement_Log data, not a
// hypothetical fuller port.
function _effectiveRegionGs_(groupSource, region) {
  if (normRegionKeyGs_(String(groupSource || '')) === 'loan') return 'Loan';
  return String(region || '').trim();
}

// Port of evidenceAtDeadline (js/tab-tracking.js): prefers the latest
// history record at-or-before the deadline, falls back to the first one
// after it, and finally to precomputed live-sheet evidence when history
// has nothing on either side. `liveEvidence` is {oppOrAbove, isOpenLead}
// or null — precomputed once per lead by the caller, not per deadline.
function _evidenceAtDeadlineGs_(historyForKey, deadlineMs, liveEvidence) {
  let atOrBefore = null, firstAfter = null;
  historyForKey.forEach(function (rec) {
    if (rec.atMs <= deadlineMs) { if (!atOrBefore || rec.atMs > atOrBefore.atMs) atOrBefore = rec; }
    else if (!firstAfter || rec.atMs < firstAfter.atMs) firstAfter = rec;
  });
  const evidence = atOrBefore || firstAfter;
  if (evidence) {
    return { oppOrAbove: isOppOrAbove_(evidence.stage, evidence.closingReason, ''), isOpenLead: isOpenLead_(evidence.stage, evidence.closingReason, '') };
  }
  return liveEvidence || null;
}

// Port of eligibleDailyCohortDates (js/tab-tracking.js): every calendar
// day whose dayEnd falls within Movement_Log's actual retained coverage
// (real point-in-time evidence nearby) AND whose entire 48h window has
// already elapsed (every stored number final, never partial).
function eligibleDailyCohortDatesGs_(historyRows, now) {
  if (!historyRows.length) return [];
  let earliestMs = null;
  historyRows.forEach(function (r) { if (earliestMs === null || r.atMs < earliestMs) earliestMs = r.atMs; });

  const earliestByKey = {};
  historyRows.forEach(function (r) {
    if (!earliestByKey[r.key] || r.atMs < earliestByKey[r.key].atMs) earliestByKey[r.key] = r;
  });
  const dayKeys = {};
  Object.keys(earliestByKey).forEach(function (key) {
    const created = earliestByKey[key].leadAssignedAt;
    if (!(created instanceof Date)) return;
    dayKeys[istDayKeyGs_(created)] = true;
  });

  const nowMs = now.getTime();
  return Object.keys(dayKeys).filter(function (dateKey) {
    const dayEndMs = new Date(dateKey + 'T23:59:59+05:30').getTime();
    return dayEndMs >= earliestMs && (dayEndMs + LEAD_LIFECYCLE_HOURS_ * 3600 * 1000) <= nowMs;
  }).sort();
}

// Builds a live-lead lookup from the current month tab's just-read rows
// (the SAME dataRows/colIndex snapshotOpenLeads_ already has this run) —
// covers the rare case where Movement_Log never captured a single
// snapshot of a lead at all (added and resolved between two 6-hourly
// captures, or a genuine capture gap), same reasoning as
// computeDailyCohortByRegion's own liveByKey merge. First copy of a
// customer split across 2 RM rows wins — only region/stage/created are
// read from this, and both copies carry the same lead_assigned_at.
function _buildLiveLeadIndexGs_(dataRows, colIndex) {
  const out = {};
  dataRows.forEach(function (row) {
    const leadId = String(getVal_(row, colIndex, 'lead_id') || '').trim();
    if (!leadId) return;
    const clientId = String(getVal_(row, colIndex, 'client_id') || '').trim();
    const key = clientId || ('l:' + leadId);
    if (out[key]) return;
    out[key] = {
      region: getVal_(row, colIndex, 'region'),
      groupSource: getVal_(row, colIndex, 'group_source'),
      stage: getVal_(row, colIndex, 'current_stage'),
      closingReason: getVal_(row, colIndex, 'closing_reason'),
      leadClosingReason: getVal_(row, colIndex, 'lead_closing_reason'),
      leadAssignedAt: getVal_(row, colIndex, 'lead_assigned_at'),
    };
  });
  return out;
}

// Port of computeDailyCohortByRegion (js/tab-tracking.js) for one
// calendar day — returns {region -> stats}. Always the TRUE unfiltered
// picture (no Project/Region/TL/Source filtering — those are a dashboard
// browser-UI concept only), matching persistDailyCohortHistory's own
// ignoreFilters:true call, since a persisted archive row must reflect
// reality regardless of who has the dashboard open with which filters.
function computeDailyCohortByRegionGs_(dateKey, historyRows, liveByKey, now) {
  const dayStart = new Date(dateKey + 'T00:00:00+05:30');
  const dayEnd = new Date(dateKey + 'T23:59:59+05:30');
  const nowMs = now.getTime();
  const sameDayDeadlineMs = Math.min(dayEnd.getTime(), nowMs);

  const byKey = {};
  historyRows.forEach(function (r) {
    if (!byKey[r.key]) byKey[r.key] = [];
    byKey[r.key].push(r);
  });

  // Every lead with Movement_Log history, PLUS any live-only lead
  // Movement_Log never captured at all — same union computeDailyCohortByRegion
  // builds in the browser.
  const allKeys = {};
  Object.keys(byKey).forEach(function (k) { allKeys[k] = true; });
  Object.keys(liveByKey).forEach(function (k) { allKeys[k] = true; });

  const byRegion = {};
  function statsFor(region) {
    if (!byRegion[region]) byRegion[region] = {
      region: region, created: 0, sameDayResolved: 0, sameDayOpp: 0,
      windowComplete: 0, resolved48h: 0, opp48h: 0, closed48h: 0,
    };
    return byRegion[region];
  }

  Object.keys(allKeys).forEach(function (key) {
    const history = byKey[key] || [];
    const live = liveByKey[key];

    let first = null;
    history.forEach(function (r) { if (!first || r.atMs < first.atMs) first = r; });
    const source = first || live;
    if (!source) return;
    const created = first ? first.leadAssignedAt : live.leadAssignedAt;
    if (!(created instanceof Date)) return;
    if (created < dayStart || created > dayEnd) return;

    const region = mainRegionForGs_(_effectiveRegionGs_(source.groupSource, source.region)) || 'Unmapped';
    const stats = statsFor(region);
    stats.created++;

    const liveEvidence = live
      ? { oppOrAbove: isOppOrAbove_(live.stage, live.closingReason, live.leadClosingReason), isOpenLead: isOpenLead_(live.stage, live.closingReason, live.leadClosingReason) }
      : null;

    const sameDay = _evidenceAtDeadlineGs_(history, sameDayDeadlineMs, liveEvidence);
    if (sameDay) {
      stats.sameDayResolved++;
      if (sameDay.oppOrAbove) stats.sameDayOpp++;
    }

    const deadline48hMs = created.getTime() + LEAD_LIFECYCLE_HOURS_ * 3600 * 1000;
    if (nowMs < deadline48hMs) return; // this lead's own 48h window hasn't elapsed yet
    stats.windowComplete++;
    const at48h = _evidenceAtDeadlineGs_(history, deadline48hMs, liveEvidence);
    if (!at48h) return;
    stats.resolved48h++;
    if (at48h.oppOrAbove) stats.opp48h++;
    else if (!at48h.isOpenLead) stats.closed48h++;
  });

  return byRegion;
}

// Port of upsertDailyCohortHistoryRows (js/sheets-writeback.js): upserts
// one row per {date, region, stats} entry, keyed by "date|region" (column
// A), same schema/column order as the browser's writer. source is always
// 'AppsScript' here so a reader can tell which side wrote a given row.
// Re-sorts by date then region after any append, same as the browser's
// own sortDailyCohortHistorySheet_ — keeps the tab readable regardless of
// which side wrote most recently.
function upsertDailyCohortHistoryRowsGs_(ss, entries, now) {
  if (!entries.length) return;
  const sheet = ensureDailyCohortHistorySheetGs_(ss);
  const lastRow = sheet.getLastRow();
  const rowNumberByKey = {};
  if (lastRow >= 2) {
    const existingKeys = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
    existingKeys.forEach(function (r, i) {
      const k = String(r[0] || '').trim();
      if (k) rowNumberByKey[k] = i + 2; // +2: row 1 is the header
    });
  }

  const updatedAt = Utilities.formatDate(now, 'Asia/Kolkata', 'yyyy-MM-dd HH:mm:ss');
  const toAppend = [];
  entries.forEach(function (e) {
    const key = e.date + '|' + e.region;
    const s = e.stats;
    const rowValues = [
      key, e.date, e.region, s.created, s.sameDayResolved, s.sameDayOpp,
      s.windowComplete, s.resolved48h, s.opp48h, s.closed48h, updatedAt, 'AppsScript',
    ];
    const rowNum = rowNumberByKey[key];
    if (rowNum) {
      sheet.getRange(rowNum, 1, 1, rowValues.length).setValues([rowValues]);
    } else {
      toAppend.push(rowValues);
    }
  });

  if (toAppend.length) {
    const startRow = sheet.getLastRow() + 1;
    sheet.getRange(startRow, 1, toAppend.length, toAppend[0].length).setValues(toAppend);
    const dataRowCount = sheet.getLastRow() - 1;
    if (dataRowCount > 1) {
      sheet.getRange(2, 1, dataRowCount, DAILY_COHORT_HISTORY_COLUMNS_.length)
        .sort([{ column: 2, ascending: true }, { column: 3, ascending: true }]); // date, then region
    }
  }
}

// Orchestrator — called from snapshotOpenLeads_ on every 6-hourly run.
// `dataRows`/`colIndex` are the SAME current-month-tab rows that run
// already read, reused here for the live-lead fallback rather than a
// second read of the source tab.
// Reads just column B (date) of every existing Daily_Cohort_History row,
// as a {dateKey: true} set — cheap single-column read used to decide
// which eligible dates are genuinely new vs. already final. Returns {} if
// the tab doesn't exist yet (nothing archived at all).
function _readArchivedDailyCohortDatesGs_(ss) {
  const out = {};
  const sheet = ss.getSheetByName(DAILY_COHORT_HISTORY_SHEET_);
  if (!sheet) return out;
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return out;
  const values = sheet.getRange(2, 2, lastRow - 1, 1).getValues(); // column B = date
  values.forEach(function (r) {
    const d = String(r[0] || '').trim();
    if (d) out[d] = true;
  });
  return out;
}

function persistDailyCohortHistoryGs_(ss, dataRows, colIndex, now) {
  const historyRows = _readMovementLogHistoryRowsGs_(ss);
  if (!historyRows.length) return;

  const eligibleDates = eligibleDailyCohortDatesGs_(historyRows, now);
  if (!eligibleDates.length) return;

  // Only ever compute/write a date that has NO row in Daily_Cohort_History
  // yet — see this section's own header comment for why re-touching an
  // already-archived day is actively dangerous, not just wasted work.
  const archivedDates = _readArchivedDailyCohortDatesGs_(ss);
  const newDates = eligibleDates.filter(function (d) { return !archivedDates[d]; });
  if (!newDates.length) return;

  const liveByKey = _buildLiveLeadIndexGs_(dataRows, colIndex);

  const entries = [];
  newDates.forEach(function (dateKey) {
    const byRegion = computeDailyCohortByRegionGs_(dateKey, historyRows, liveByKey, now);
    Object.keys(byRegion).forEach(function (region) {
      const stats = byRegion[region];
      if (!stats.created) return;
      entries.push({ date: dateKey, region: region, stats: stats });
    });
  });
  if (!entries.length) return;

  upsertDailyCohortHistoryRowsGs_(ss, entries, now);
}

// Manual run (function dropdown -> Run) — recomputes and upserts
// Daily_Cohort_History for every currently-eligible date without waiting
// for the next scheduled snapshotPeriodic trigger. Useful right after
// deploying this, or to force an immediate catch-up. Reads the current
// month tab itself rather than requiring snapshotOpenLeads_ to have just
// run.
function persistDailyCohortHistoryNow() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const tabName = resolveTabName_(ss);
  const src = ss.getSheetByName(tabName);
  if (!src) throw new Error('Daily Cohort History: tab "' + tabName + '" not found.');
  const lastRow = src.getLastRow();
  const lastCol = src.getLastColumn();
  if (lastRow < 3) { Logger.log('Nothing to read from ' + tabName + '.'); return; }
  const headerRow = src.getRange(2, 1, 1, lastCol).getValues()[0];
  const colIndex = buildColIndex_(headerRow);
  const dataRows = src.getRange(3, 1, lastRow - 2, lastCol).getValues();
  persistDailyCohortHistoryGs_(ss, dataRows, colIndex, new Date());
  Logger.log('Daily_Cohort_History persist run complete.');
}

// ---- Trigger entry point ----
// Label is generated from the actual moment the trigger fires rather than
// a fixed target time, since an every-N-hours trigger's real firing times
// aren't pinned to specific clock hours (see the "known limitation" note
// above) — the label should say what actually happened, not what was asked for.
//
// Leaves a run record (email audit F23 - the same Script Properties record the email jobs use, key
// EMAIL_JOB_RUN_snapshotPeriodic): `running` when it starts, `completed` (with how long it took and which optional phases it
// skipped) or `failed` when it ends. A run the platform kills (the 30-minute limit) never writes its ending, so its record stays
// `running` - which is how emailJobWatchdog (EmailInfra.gs) tells it from one that is simply still going. Writing the record can
// never stop the snapshot (writeEmailJobRunGs_ swallows its own errors). snapshotNow() (manual) deliberately leaves no record.
const SNAPSHOT_RUN_JOB_ = 'snapshotPeriodic';
function snapshotPeriodic() {
  const started = new Date();
  const base = { day: istDayKeyGs_(started), startedAt: started.toISOString() };
  writeEmailJobRunGs_(SNAPSHOT_RUN_JOB_, Object.assign({}, base, { status: 'running' }));
  let summary;
  try {
    summary = snapshotOpenLeads_(Utilities.formatDate(started, 'Asia/Kolkata', 'yyyy-MM-dd HH:mm') + ' IST');
  } catch (e) {
    writeEmailJobRunGs_(SNAPSHOT_RUN_JOB_, Object.assign({}, base, { finishedAt: new Date().toISOString(), status: 'failed', error: String((e && e.message) || e).slice(0, 300) }));
    throw e;
  }
  writeEmailJobRunGs_(SNAPSHOT_RUN_JOB_, Object.assign({}, base, {
    finishedAt: new Date().toISOString(),
    status: 'completed',
    totalSeconds: summary ? summary.totalSeconds : 0,
    skipped: summary ? summary.skipped : [],
    failed: summary ? summary.failed : [],
  }));
}

// What is wrong with the latest snapshotPeriodic run as of `now`? Returns at most ONE problem (the watchdog de-duplicates its
// alerts per job, so two different problems for one job would re-alert each other every hour): 'stuck' (still `running` more
// than EMAIL_JOB_MAX_RUN_MINUTES_ after it started - the platform killed it), 'failed', 'overdue' (the newest run started more
// than MOVEMENT_LOG_FRESHNESS_GRACE_HOURS_ ago, so a scheduled run did not happen), or 'degraded' (it completed but skipped
// optional phases to stay inside the time limit). Each problem carries its own `marker` (the run's start time + kind) so it is
// reported once per run, not once per day. No record at all (not deployed yet, or the Properties service unreadable - the
// email-job check already reports that) is no problem. Pure apart from reading the record.
function snapshotRunProblemsGs_(now) {
  const rec = readEmailJobRunGs_(SNAPSHOT_RUN_JOB_);
  if (!rec || rec.unreadable) return [];
  const startedMs = new Date(rec.startedAt).getTime();
  if (isNaN(startedMs)) return [];
  const ageMin = (now.getTime() - startedMs) / 60000;
  const at = Utilities.formatDate(new Date(startedMs), 'Asia/Kolkata', 'yyyy-MM-dd HH:mm') + ' IST';
  const make = function (kind, detail, hint) {
    return [{ job: SNAPSHOT_RUN_JOB_, kind: kind, detail: detail, marker: rec.startedAt + '|' + kind, hint: hint }];
  };
  const checkHint = 'Open the Apps Script Executions list for snapshotPeriodic and its log (every line starting [timing] shows where the time went). The next scheduled run re-captures; to capture right now, run snapshotNow by hand.';
  if (rec.status === 'running' && ageMin > EMAIL_JOB_MAX_RUN_MINUTES_) {
    return make('stuck', 'The Movement_Log snapshot that started at ' + at + ' never finished (' + Math.round(ageMin) + ' minutes ago) - the platform probably stopped it at the 30-minute limit. Its core capture is normally already written (see Movement_Log_Runs: a blank total_s marks this run), but the history/prune steps after it did not complete.', checkHint);
  }
  if (rec.status === 'failed') {
    return make('failed', 'The Movement_Log snapshot that started at ' + at + ' ended in an error: ' + (rec.error || '(no message recorded)'), checkHint);
  }
  if (ageMin / 60 > MOVEMENT_LOG_FRESHNESS_GRACE_HOURS_) {
    return make('overdue', 'The newest Movement_Log snapshot started at ' + at + ' (' + (ageMin / 60).toFixed(1) + ' hours ago); snapshotPeriodic runs four times a day, so at least one scheduled run did not happen.', 'Check Triggers (clock icon) for a paused or deleted snapshotPeriodic trigger (setupMovementTracking reinstalls them), and the Executions list for failures.');
  }
  if (rec.status === 'completed' && rec.skipped && rec.skipped.length) {
    return make('degraded', 'The Movement_Log snapshot that started at ' + at + ' finished in ' + rec.totalSeconds + 's but skipped: ' + rec.skipped.join(', ') + ' - it ran out of its time budget, so that work waits for the next run. The call baselines in the emails are not affected (the core capture is always done first).', checkHint);
  }
  return [];
}

// ---- One-time setup — run this once from the editor ----
function setupMovementTracking() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  ensureMovementLogSheet_(ss);
  ensureMovementLogRunsSheet_(ss);

  // Idempotent: safe to re-run any time you need to reinstall or reschedule
  // the triggers — it won't create duplicates. Deletes EVERY existing
  // snapshotPeriodic trigger first (there may be several — one per hour in
  // SNAPSHOT_HOURS_ — or a single leftover .everyHours() trigger from
  // before this switch) before installing a fresh set, so re-running this
  // after editing SNAPSHOT_HOURS_ never leaves stale triggers at the old
  // hours running alongside the new ones. Also cleans up the old
  // twice-a-day trigger names (snapshotEvening/snapshotMorning) from an
  // earlier version of this script.
  ScriptApp.getProjectTriggers().forEach(function (t) {
    const fn = t.getHandlerFunction();
    if (fn === 'snapshotPeriodic' || fn === 'snapshotEvening' || fn === 'snapshotMorning') {
      ScriptApp.deleteTrigger(t);
    }
  });

  // One atHour() trigger per entry in SNAPSHOT_HOURS_, all firing the same
  // handler — deliberately NOT .timeBased().everyHours(6): Apps Script
  // does not guarantee even spacing for everyHours() and, under load, can
  // skip a firing outright rather than just running it a few minutes late
  // (see the file header's "Known limitation" note). atHour() is Google's
  // tightest clock-trigger guarantee — each one independently targets its
  // own hour, so a bad cycle for one doesn't cascade into the others.
  SNAPSHOT_HOURS_.forEach(function (hour) {
    ScriptApp.newTrigger('snapshotPeriodic').timeBased().atHour(hour).everyDays(1).inTimezone('Asia/Kolkata').create();
  });

  Logger.log(
    'Movement tracking installed: snapshots daily at ' + SNAPSHOT_HOURS_.join(':00, ') + ':00 IST, ' +
    'Movement_Log tab ready, retaining ' + MOVEMENT_LOG_RETENTION_DAYS + ' days.'
  );
}

// Run manually any time (function dropdown → snapshotNow → Run) to capture
// an extra snapshot right now — handy for testing the setup without
// waiting for the next scheduled trigger.
function snapshotNow() {
  snapshotOpenLeads_();
}

/**
 * Movement_Log capture-freshness check — CHECKLIST-005 (2026-09-09). Both
 * the live dashboard's Repeat Offenders tab AND DailyRmIssueLog.gs's own
 * reportRmPerformanceNow() console leaderboard depend on Movement_Log
 * having recent, regularly-captured history — a silently paused, deleted,
 * or repeatedly-failing capture trigger degrades BOTH surfaces the same
 * way (a stale, gapped picture presented as current), and neither one
 * currently checks for that on its own. SNAPSHOT_HOURS_ = [0, 6, 12, 18]
 * IST means a healthy Movement_Log should never go much past ~6-7 hours
 * without a new row (atHour() lands within roughly 15 minutes — see
 * setupMovementTracking's own comment) — this flags anything past a
 * generous grace window as genuinely worth checking, rather than assuming
 * silence means everything is fine.
 *
 * Pure(ish) — one read, no writes. **Reads Movement_Log_Runs, not
 * Movement_Log itself** (changed in Phase 6 of the Lead History &
 * Versioning Review, docs/_planning/DB_ARCHITECTURE_REVIEW.md) — since
 * content-hash dedup means an unchanged lead no longer gets a new
 * Movement_Log row every run, "Movement_Log's last row" stopped being a
 * reliable "did a capture happen" signal (it would now read as
 * increasingly stale on a perfectly healthy system with few real
 * changes). Movement_Log_Runs gets a row on every run regardless of
 * whether anything changed, so it stays a correct freshness signal.
 * Returns { status: 'missing'|'empty'|'unreadable'|'fresh'|'stale',
 * ...detail } so a caller can act on it programmatically;
 * checkMovementLogFreshnessNow below is the console-callable wrapper
 * that logs this in a readable form — same split as
 * auditUnresolvedRms_/auditUnresolvedRmsNow (RmHierarchy.gs).
 */
const MOVEMENT_LOG_FRESHNESS_GRACE_HOURS_ = 8;
function checkMovementLogFreshness_(ss, now) {
  const sheet = ss.getSheetByName(MOVEMENT_LOG_RUNS_SHEET_);
  if (!sheet) return { status: 'missing' };
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return { status: 'empty' };

  const lastSnapshotAt = withRetry_(function () { return sheet.getRange(lastRow, 1).getValue(); }, 'checkMovementLogFreshness_: read last run_at');
  if (!(lastSnapshotAt instanceof Date)) return { status: 'unreadable', rawValue: lastSnapshotAt, rowNum: lastRow };

  const ageHours = ((now || new Date()).getTime() - lastSnapshotAt.getTime()) / 36e5;
  const stale = ageHours > MOVEMENT_LOG_FRESHNESS_GRACE_HOURS_;
  return { status: stale ? 'stale' : 'fresh', lastSnapshotAt: lastSnapshotAt, ageHours: ageHours, rowNum: lastRow };
}

// Console-callable wrapper (function dropdown -> Run) — logs
// checkMovementLogFreshness_'s result in a readable form. See that
// function's own header for the full explanation of what this catches.
function checkMovementLogFreshnessNow() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const result = checkMovementLogFreshness_(ss, new Date());
  if (result.status === 'missing') { Logger.log('Movement_Log_Runs sheet not found — run setupMovementTracking first.'); return; }
  if (result.status === 'empty') { Logger.log('Movement_Log_Runs has no rows yet — allow time after setupMovementTracking for the first scheduled capture to fire.'); return; }
  if (result.status === 'unreadable') {
    Logger.log('Movement_Log_Runs row ' + result.rowNum + ' has an unreadable run_at value (' + result.rawValue + ') — check the sheet directly.');
    return;
  }
  const label = Utilities.formatDate(result.lastSnapshotAt, 'Asia/Kolkata', 'yyyy-MM-dd HH:mm') + ' IST';
  if (result.status === 'fresh') {
    Logger.log('Movement_Log is fresh — last capture ' + label + ', ' + result.ageHours.toFixed(1) + 'h ago (within the ' + MOVEMENT_LOG_FRESHNESS_GRACE_HOURS_ + 'h grace window for the [0,6,12,18] IST schedule).');
    return;
  }
  Logger.log('Movement_Log capture looks STALE — last row is ' + label + ', ' + result.ageHours.toFixed(1) + 'h ago, past the ' + MOVEMENT_LOG_FRESHNESS_GRACE_HOURS_ + 'h grace window for the [0,6,12,18] IST schedule. Check Triggers (clock icon, left sidebar) for a paused/deleted snapshotPeriodic trigger, or its own execution history for a recent failure, before trusting Repeat Offenders or reportRmPerformanceNow right now.');
}

// One-time console-callable cleanup for the Sep 2026 Movement_Log data-loss
// incident: backs up the rows about to be removed, then drops every row
// snapshotted before 12 Sep 2026 IST (the earlier 9-11 Sep rows were
// restored from a corrupted source and are unreliable for dedup/reporting).
// Safe to re-run — it always takes a fresh timestamped backup first and
// no-ops on rows already gone.
//
// Backup is a Drive CSV file, not a second in-workbook sheet, and covers
// only the rows actually being deleted (not the whole table) — two
// independent fixes for two independent failures hit running the earlier
// full-sheet-duplicate versions of this function: sheet.copyTo() threw
// "This operation is not supported" on a sheet this large, and a plain-
// values full duplicate then threw "This action would increase the number
// of cells in the workbook above the limit of 10000000 cells" — because
// ANY full duplicate of a ~100k-row sheet competes for the same finite
// per-workbook cell budget the live data already needs room in. A Drive
// file has no such ceiling, and the ~kept majority isn't at risk (it's
// staying in the sheet), so only the doomed rows need a safety copy.
function removeEarlyCorruptedMovementLogDataNow() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(MOVEMENT_LOG_SHEET);
  const CHUNK = 10000;

  const lastRow = sheet.getLastRow();
  const lastCol = sheet.getLastColumn();
  const header = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  const values = sheet.getRange(2, 1, lastRow - 1, lastCol).getValues();

  const cutoff = new Date('2026-09-12T00:00:00+05:30');
  const kept = [];
  const removed = [];
  values.forEach(function (row) {
    (row[0] instanceof Date && row[0] >= cutoff ? kept : removed).push(row);
  });

  const csvEscape = function (cell) {
    if (cell instanceof Date) return cell.toISOString();
    const s = String(cell == null ? '' : cell);
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  const csv = [header].concat(removed).map(function (row) {
    return row.map(csvEscape).join(',');
  }).join('\n');
  const backupName = 'Movement_Log_removed_rows_' + Utilities.formatDate(new Date(), 'Asia/Kolkata', 'yyyy-MM-dd_HHmm') + '.csv';
  const backupFile = DriveApp.createFile(backupName, csv, MimeType.CSV);
  Logger.log('Backup of ' + removed.length + ' removed rows written to Drive: ' + backupFile.getUrl());

  sheet.getRange(2, 1, lastRow - 1, lastCol).clearContent();
  for (let i = 0; i < kept.length; i += CHUNK) {
    const chunk = kept.slice(i, i + CHUNK);
    sheet.getRange(2 + i, 1, chunk.length, lastCol).setValues(chunk);
  }

  // Real bug found 2026-09-17: an earlier version of this function stopped
  // here, and it achieved NOTHING toward the workbook's 10M-cell ceiling —
  // clearContent() only empties cell VALUES, it never shrinks the sheet's
  // actual row allocation (getMaxRows()), and that ceiling is on the
  // workbook's total declared grid size (rows x columns, summed across
  // every tab), not on cells holding real content. Without this step the
  // sheet's row count never drops, which is exactly what let
  // captureDailyRmIssues_ (DailyRmIssueLog.gs) crash with the same "This
  // action would increase the number of cells..." error hours after this
  // function had already "succeeded" — same mechanism pruneMovementLog_
  // (this file, #L644) and pruneDailyRmIssueLog_ (DailyRmIssueLog.gs)
  // already handle correctly; this one-off script was the one gap.
  const neededRows = 1 + kept.length + MOVEMENT_LOG_ROW_HEADROOM_;
  const maxRows = sheet.getMaxRows();
  if (maxRows > neededRows) {
    sheet.deleteRows(neededRows + 1, maxRows - neededRows);
  }

  Logger.log('Kept ' + kept.length + ' of ' + values.length + ' rows (removed everything before 12 Sep 2026 IST). Row allocation shrunk to ' + sheet.getMaxRows() + '. Backup (' + removed.length + ' rows): ' + backupFile.getUrl());
}

// ==================== One-off: remove the 2026-09-22..09-25 dedup-incident rows ====================
// Remediation for the Movement_Log dedup incident (assertMovementLogHeaderAligned_,
// HANDOVER.md section 8): the five captures from 2026-09-22 12:44 to 2026-09-23 12:44 IST each appended EVERY open
// lead (52,060 rows, ~1.35M cells) because the dedup read the wrong column, and the sheet has been too big for a
// capture to finish since. Archives exactly those rows to a Drive CSV, checks the archive, then deletes them.
//
// Touches NOTHING unless every guard holds: the header is aligned; the rows inside the window form ONE contiguous
// block; and their count equals the sum of leads_changed that Movement_Log_Runs recorded for the same runs (so a row
// written by anything else inside the window, e.g. a browser snapshot, makes it abort instead of deleting real data).
// The archive is written and verified BEFORE any deletion. Not wired to any trigger; safe to re-run (a second run
// finds nothing in the window and does nothing). Precedent: removeEarlyCorruptedMovementLogDataNow above.
const DEDUP_INCIDENT_FROM_ = new Date('2026-09-22T12:30:00+05:30');
const DEDUP_INCIDENT_TO_ = new Date('2026-09-23T13:30:00+05:30');
function removeDedupIncidentRowsNow() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(MOVEMENT_LOG_SHEET);
  if (!sheet) throw new Error('Movement_Log sheet not found.');
  assertMovementLogHeaderAligned_(sheet);

  const lastRow = sheet.getLastRow();
  if (lastRow < 2) { Logger.log('Movement_Log has no data rows - nothing to remove.'); return; }
  const times = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
  let first = -1, last = -1, count = 0;
  times.forEach(function (r, i) {
    const ts = r[0];
    if (ts instanceof Date && ts >= DEDUP_INCIDENT_FROM_ && ts <= DEDUP_INCIDENT_TO_) {
      if (first < 0) first = i;
      last = i;
      count++;
    }
  });
  if (!count) { Logger.log('No Movement_Log rows inside the incident window - nothing to remove (already done?).'); return; }
  if (last - first + 1 !== count) {
    throw new Error('Rows inside the incident window are not one contiguous block (' + count + ' rows spread over ' +
      (last - first + 1) + ' positions) - refusing to delete anything.');
  }

  const runsSheet = ss.getSheetByName(MOVEMENT_LOG_RUNS_SHEET_);
  if (!runsSheet || runsSheet.getLastRow() < 2) throw new Error('Movement_Log_Runs is missing or empty - cannot cross-check the row count; refusing to delete.');
  let expected = 0;
  runsSheet.getRange(2, 1, runsSheet.getLastRow() - 1, MOVEMENT_LOG_RUNS_COLUMNS_.length).getValues().forEach(function (r) {
    if (r[0] instanceof Date && r[0] >= DEDUP_INCIDENT_FROM_ && r[0] <= DEDUP_INCIDENT_TO_) expected += Number(r[3]) || 0;
  });
  if (expected !== count) {
    throw new Error('Movement_Log has ' + count + ' rows in the incident window but Movement_Log_Runs says those runs appended ' +
      expected + ' - they do not match, so something else wrote here; refusing to delete.');
  }

  const startRow = first + 2; // times[] starts at sheet row 2
  const lastCol = sheet.getLastColumn();
  const header = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  const rows = sheet.getRange(startRow, 1, count, lastCol).getValues();

  const file = archiveRowsToDriveCsv_(MOVEMENT_LOG_SHEET, header, rows, '2026-09-22_to_2026-09-23');
  if (!file) throw new Error('Drive archive was not created - refusing to delete.');
  // Every data row starts with the snapshot_at Date rendered as an ISO timestamp (see archiveRowsToDriveCsv_'s
  // csvEscape); count those line starts instead of parsing the ~25 MB file.
  const archived = (file.getBlob().getDataAsString().match(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z,/gm) || []).length;
  if (archived !== count) {
    throw new Error('Drive archive holds ' + archived + ' data rows but ' + count + ' were expected - refusing to delete. Archive: ' + file.getUrl());
  }

  sheet.deleteRows(startRow, count);
  Logger.log('Removed ' + count + ' Movement_Log rows (sheet rows ' + startRow + '-' + (startRow + count - 1) + ', ' +
    '2026-09-22 12:44 to 2026-09-23 12:45 IST), archived first to ' + file.getUrl() + '. Movement_Log now has ' +
    (sheet.getLastRow() - 1) + ' data rows; row allocation ' + sheet.getMaxRows() + '.');
}

// ==================== One-off: remove the leftover 2026-09-17 in-workbook backup tab ====================
// removeEarlyCorruptedMovementLogDataNow's FIRST version (commit 9413f6a, 2026-09-17 ~11:15 IST) backed up
// Movement_Log by duplicating the whole ~100k-row sheet into a new in-workbook tab -- exactly what pushed the
// workbook toward its 10M-cell ceiling, and got fixed 20 minutes later (834d7ea, same day) to archive only the
// removed rows to a Drive CSV instead, same as every prune function since. The fix landed same-day and has been
// stable for 11 days; the ONE backup tab the buggy version already created before the fix was never deleted, and
// has sat costing ~2,860,000 cells (29% of the workbook) ever since -- found by computeWorkbookCellUsageGs_
// (Core.gs) on 2026-09-28 at 98.2% total usage.
//
// Archives the tab's own content to a Drive CSV before deleting it (belt and suspenders -- the data is also
// still reconstructable from Movement_Log's live history up to 2026-09-17, but this costs nothing and matches
// the same archive-then-delete discipline as every other cleanup here). Refuses to touch anything unless the
// tab's header matches the exact schema the original backup copied, and the archive's own row count matches
// what was about to be deleted -- same two-guard shape as removeDedupIncidentRowsNow above.
const STALE_MOVEMENT_LOG_BACKUP_TAB_ = 'Movement_Log_backup_2026-09-17_1115';
function removeStaleMovementLogBackupTabNow() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(STALE_MOVEMENT_LOG_BACKUP_TAB_);
  if (!sheet) { Logger.log(STALE_MOVEMENT_LOG_BACKUP_TAB_ + ' not found - nothing to remove (already done?).'); return; }

  const lastRow = sheet.getLastRow();
  if (lastRow < 2) throw new Error(STALE_MOVEMENT_LOG_BACKUP_TAB_ + ' has no data rows - refusing to touch a tab that does not look like the expected backup.');
  const lastCol = sheet.getLastColumn();
  const header = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  // The exact schema the FIRST version of removeEarlyCorruptedMovementLogDataNow copied (Movement_Log's own
  // header as of 2026-09-17 -- no opp_at, added 2026-09-21, after this backup was made).
  if (String(header[0]).trim() !== 'snapshot_at' || String(header[2]).trim() !== 'lead_id') {
    throw new Error(STALE_MOVEMENT_LOG_BACKUP_TAB_ + '\'s header does not look like the expected Movement_Log backup shape - refusing to delete.');
  }
  const rows = sheet.getRange(2, 1, lastRow - 1, lastCol).getValues();

  // Archived in chunks, not one archiveRowsToDriveCsv_ call for all 109,999
  // rows -- real failure, 2026-09-28: DriveApp.createFile threw "exceeds
  // the maximum file size" on the full-size CSV. archiveRowsToDriveCsv_
  // never hits this in its NORMAL callers (pruneMovementLog_/
  // pruneDailyRmIssueLog_ only ever archive one retention window's worth
  // per run, far smaller than a full-sheet one-off backup) so the shared
  // helper itself is untouched; this call site chunks instead. A smaller
  // chunk than this file's usual 10000 (sheet read/write quota headroom)
  // on purpose -- this is a Drive file-SIZE ceiling, a different
  // constraint, and this backup's rows carry long free-text comment
  // fields that make each row heavier than a typical Movement_Log row.
  const ARCHIVE_CHUNK = 5000;
  const files = [];
  for (let i = 0; i < rows.length; i += ARCHIVE_CHUNK) {
    const chunkRows = rows.slice(i, i + ARCHIVE_CHUNK);
    const partLabel = '2026-09-10_to_2026-09-17_superseded_backup_part' + (files.length + 1);
    const file = archiveRowsToDriveCsv_('Movement_Log', header, chunkRows, partLabel);
    if (!file) throw new Error('Drive archive chunk ' + (files.length + 1) + ' was not created - refusing to delete.');
    files.push(file);
  }

  // Every data row starts with the snapshot_at Date rendered as an ISO timestamp (see archiveRowsToDriveCsv_'s
  // csvEscape); count those line starts instead of parsing multi-MB files. Summed across every chunk file.
  let archived = 0;
  files.forEach(function (file) {
    archived += (file.getBlob().getDataAsString().match(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z,/gm) || []).length;
  });
  if (archived !== rows.length) {
    throw new Error('Drive archive holds ' + archived + ' data rows across ' + files.length + ' file(s) but ' + rows.length + ' were expected - refusing to delete.');
  }

  ss.deleteSheet(sheet);
  Logger.log('Removed the stale ' + STALE_MOVEMENT_LOG_BACKUP_TAB_ + ' tab (' + rows.length + ' rows), archived first to ' + files.length +
    ' Drive CSV file(s) starting with ' + files[0].getUrl() +
    '. This tab was a leftover artifact of a bug fixed same-day it was created (834d7ea, 2026-09-17) - see this function\'s own header comment.');
}
