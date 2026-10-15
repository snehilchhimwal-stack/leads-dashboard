/**
 * Unmatched Comment Logger — records every open lead whose latest
 * owner-logged comment has real text but matches NONE of
 * FollowupEngine.gs's OUTCOME_RULES_GS_ keywords (inferOutcomeGs_ falls
 * through to the generic "Update" outcome), into an "Unmatched_Comments_Log"
 * sheet tab for periodic human review.
 *
 * WHY THIS EXISTS: per explicit feedback, many Suggested Follow-up lines
 * were generic or outright wrong because the underlying keyword engine
 * (OUTCOME_RULES_GS_, mirrored in js/core.js) simply doesn't recognize
 * the phrasing an RM used. There was no way to see, in aggregate, WHICH
 * comments the engine keeps failing to classify — this fixes that: a
 * human periodically reviews Unmatched_Comments_Log, and when a real
 * pattern shows up (say, twenty different comments all meaning "will
 * decide by evening" that never match anything), that's the concrete
 * evidence needed to add a new signal to OUTCOME_RULES_GS_ (and its
 * js/core.js mirror). This tool only SURFACES the gap — closing it is
 * still a deliberate, human-reviewed code change, not automatic.
 *
 * WHY THIS PIGGYBACKS ON snapshotOpenLeads_ (MovementTracker.gs) RATHER
 * THAN ITS OWN TRIGGER: the natural cadence for this is "whenever the
 * spreadsheet's data has actually changed" — which for this project is
 * whenever the external CRM sync refreshes it (roughly hourly). Apps
 * Script has no way to react to an external data refresh directly, so
 * the closest available proxy is the existing 4x/day snapshot trigger
 * (00:00/06:00/12:00/18:00 IST, SNAPSHOT_HOURS_) — which ALREADY reads
 * the whole leads tab for Movement_Log capture, so reusing that read
 * costs nothing extra. A genuinely-hourly trigger would need
 * .everyHours(1), which MovementTracker.gs's own header already
 * documents as unreliable in this exact codebase (drifts or skips
 * cycles under load) — or 24 separate .atHour() triggers, which exceeds
 * Apps Script's per-script trigger quota. 4x/day is a fine cadence for a
 * REVIEW tool (nothing here is time-sensitive the way an SLA alert is).
 * Wrapped in its own try/catch at the call site (snapshotOpenLeads_), so
 * a problem here can never block the core Movement_Log capture.
 *
 * VOLUME CONTROL (explicit request: "check only comment after last
 * recorded comment, to keep volume low"): every run reads the leads
 * that are ALREADY logged (by lead_id + the comment's own timestamp, or
 * the raw comment text when there's no timestamp — see
 * unmatchedCommentDedupKeyGs_) and skips anything already present. A
 * lead's comment only produces a NEW row once, the first run that sees
 * it — an unchanged comment is never re-logged on a later run, so
 * steady-state volume stays low; only genuinely new unmatched comments
 * ever add a row.
 *
 * REAL INCIDENT, FIXED 2026-09-03: the de-dup check above was silently
 * broken from this file's very first version. comment_at is written as a
 * plain "yyyy-MM-dd HH:mm" string, which Sheets' own type detection
 * recognizes as a real datetime and silently converts to a Date-typed
 * cell — so reading it back returned a JS Date object, and comparing
 * String(thatDate) against the freshly-computed string key never
 * matched. Every still-open comment was re-logged as a brand-new row on
 * every single 6-hourly run, all the way back to this file's creation —
 * confirmed via a real export showing the same (lead_id, comment) pairs
 * repeating across 20+ consecutive captures. scanUnmatchedCommentsGs_'s
 * read-back now reformats a Date-typed comment_at cell back to the exact
 * string the write side uses before building the key (same "date column
 * silently became a Date" handling this project already uses for
 * Daily_RM_Issues/Overnight_Log/Movement_Log). Run
 * dedupeUnmatchedCommentsNow() ONCE after syncing this fix to collapse
 * the backlog it produced.
 *
 * Depends on Core.gs (getVal_, isOpenLead_, istDayKeyGs_),
 * FollowupEngine.gs (latestOutcomeGs_), EmailInfra.gs (withRetry_,
 * readLeadsTab_) — load order between files doesn't matter to Apps
 * Script.
 *
 * ============================== SETUP ==============================
 * Paste this in as its own file, alongside every other file in this
 * project (see Core.gs's own setup note for the full file list). No
 * separate trigger to install — MovementTracker.gs's own
 * setupMovementTracking already covers this, since scanUnmatchedCommentsGs_
 * is called from inside snapshotOpenLeads_.
 *
 * Reviewing: open the "Unmatched_Comments_Log" tab (created automatically
 * on first run). Each row is one lead's latest unmatched comment. Check
 * the "reviewed" box once you've looked at it; jot anything worth
 * remembering (a candidate new keyword, "same person every time",
 * whatever) in the "note" column. Once a batch is reviewed and dealt
 * with, run clearReviewedUnmatchedCommentsNow (function dropdown) to
 * clear out every reviewed=true row — this stays a manual, human-gated
 * step, unchanged: only a human should decide a review cycle is done.
 *
 * AGE-BASED PRUNING (added 2026-09-29, on top of the manual clear above,
 * not instead of it): pruneUnmatchedCommentsLog_ archives-then-removes
 * ANY row (reviewed or not) older than
 * UNMATCHED_COMMENTS_LOG_RETENTION_DAYS_ (30), on the same 4x/day
 * snapshot trigger. This is a real, deliberate tradeoff Snehil confirmed
 * 2026-09-29: a comment nobody reviewed within 30 days is archived to
 * Drive (never hard-deleted — a human can still pull it from there) and
 * removed from the live review queue, rather than sitting unreviewed
 * forever. Added because the cell-budget diagnostic (Core.gs) found this
 * tab at 383,058 cells 2026-09-28 with no age-based ceiling at all — only
 * the reviewed=true clear existed, which does nothing for a backlog of
 * rows nobody ever got to. See dedupeUnmatchedCommentsNow
 * for the one-off backlog cleanup needed after the 2026-09-03 fix above.
 * ================================================================================
 */

const UNMATCHED_COMMENTS_LOG_SHEET_ = 'Unmatched_Comments_Log';
const UNMATCHED_COMMENTS_LOG_COLUMNS_ = ['date', 'lead_id', 'RM', 'region', 'project', 'comment', 'comment_at', 'logged_at', 'reviewed', 'note'];

// Split into small independently-retried steps, with a flush() right
// after insertSheet — same reasoning as every other ensure*Sheet_ in this
// project (see EmailInfra.gs's ensureRegionRecipientsSheet_).
function ensureUnmatchedCommentsLogSheet_(ss) {
  const existing = withRetry_(function () { return ss.getSheetByName(UNMATCHED_COMMENTS_LOG_SHEET_); }, 'check for existing Unmatched_Comments_Log');
  if (existing) return existing;

  const sheet = withRetry_(function () { return ss.insertSheet(UNMATCHED_COMMENTS_LOG_SHEET_); }, 'insert Unmatched_Comments_Log');
  SpreadsheetApp.flush();
  withRetry_(function () {
    sheet.getRange(1, 1, 1, UNMATCHED_COMMENTS_LOG_COLUMNS_.length).setValues([UNMATCHED_COMMENTS_LOG_COLUMNS_]);
    sheet.setFrozenRows(1);
  }, 'write Unmatched_Comments_Log header');
  return sheet;
}

// lead_id + the comment's own timestamp (when the structured "Name:
// Comment - yyyy-MM-dd HH:mm" log format gives one — see
// latestOutcomeGs_'s own `ts` field) is the natural de-dup key: a NEW
// comment on the same lead always carries a new timestamp, so it always
// produces a new key, while an already-seen comment (same lead, same
// timestamp) never gets logged twice. Falls back to the raw comment TEXT
// when there's no timestamp at all (the last_comment-field fallback path
// in latestOutcomeGs_, which has no timestamp to key off).
//
// Delegates to InteractionHistoryLogger.gs's commentHistoryDedupKeyGs_ (2026-10-13 audit: the two were byte-identical copies), so
// both logs normalise the ts the same way (IH-02).
function unmatchedCommentDedupKeyGs_(leadId, outcomeEntry) {
  return commentHistoryDedupKeyGs_(leadId, outcomeEntry);
}

// The `reviewed` cell as a real boolean (UC-03, 2026-10-13): a checkbox reads back true/false, but a pasted or typed cell can read
// back as the TEXT "TRUE"/"FALSE", and !!"FALSE" is true - which would have cleared an unreviewed row.
function unmatchedCommentIsReviewedGs_(v) {
  if (v === true) return true;
  return String(v === null || v === undefined ? '' : v).trim().toUpperCase() === 'TRUE';
}

// logged_at as comparable 'yyyy-MM-dd HH:mm:ss' text (UC-03): written as text, but a cell Sheets turned into a Date reads back as
// one, and comparing a Date with a string with `<` compares NaN / string forms, not times.
function unmatchedCommentLoggedAtKeyGs_(v) {
  if (v instanceof Date) return isNaN(v.getTime()) ? '' : Utilities.formatDate(v, 'Asia/Kolkata', 'yyyy-MM-dd HH:mm:ss');
  return String(v === null || v === undefined ? '' : v).trim();
}

// ==================== Cleared-review memory (UC-01, 2026-10-13) ====================
// clearReviewedUnmatchedCommentsNow removes reviewed rows, and the scan's dedup only sees the live tab - so a reviewed comment that
// was still the lead's latest came straight back, UNREVIEWED, on the next 6-hourly run, undoing the review. The retention check
// (commentBeyondRetentionGs_) covers rows the 30-day prune removed; this covers rows a human cleared while still inside that window.
// The keys of cleared rows are kept in a small hidden tab, two text columns: the dedup key and the day it stops mattering (the
// comment's own day, after which the retention check takes over; the clearing day for a comment with no ts). Chosen over a Script
// Property because a review batch can be hundreds of keys (a property holds ~9 KB), and over keeping the rows (the point of clearing
// them is a short review queue). Entries older than UNMATCHED_COMMENTS_LOG_RETENTION_DAYS_ are dropped on every clear, so the tab
// stays at most one retention window of cleared rows. A comment with no ts can come back once that window has passed.
const UNMATCHED_COMMENTS_CLEARED_SHEET_ = 'Unmatched_Comments_Cleared';
const UNMATCHED_COMMENTS_CLEARED_COLUMNS_ = ['key', 'day'];

function unmatchedClearedEntryLiveGs_(dayCell, now) {
  const d = parseIstDayKeyOrDateGs_(dayCell);
  return !d || d >= new Date(now.getTime() - UNMATCHED_COMMENTS_LOG_RETENTION_DAYS_ * 24 * 60 * 60 * 1000); // unreadable: kept
}

// key -> 'day' for every live entry; {} when the tab does not exist yet.
function readClearedUnmatchedKeysGs_(ss, now) {
  const out = {};
  const sheet = ss.getSheetByName(UNMATCHED_COMMENTS_CLEARED_SHEET_);
  if (!sheet) return out;
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return out;
  withRetry_(function () { return sheet.getRange(2, 1, lastRow - 1, 2).getValues(); }, 'read Unmatched_Comments_Cleared')
    .forEach(function (r) {
      const key = String(r[0] === null || r[0] === undefined ? '' : r[0]).trim();
      if (key && unmatchedClearedEntryLiveGs_(r[1], now)) out[key] = dailyRmIssueDateKeyGs_(r[1]) || String(r[1] || '');
    });
  return out;
}

// Adds `entries` ([{key, day}]) to the cleared-key tab, dropping expired ones; the tab is small, so it is rewritten whole -
// written first, then only the leftover tail cleared (never clear-then-write).
function recordClearedUnmatchedKeysGs_(ss, entries, now) {
  if (!entries.length) return;
  let sheet = ss.getSheetByName(UNMATCHED_COMMENTS_CLEARED_SHEET_);
  if (!sheet) {
    sheet = withRetry_(function () { return ss.insertSheet(UNMATCHED_COMMENTS_CLEARED_SHEET_); }, 'insert Unmatched_Comments_Cleared');
    withRetry_(function () { sheet.getRange(1, 1, 1, 2).setValues([UNMATCHED_COMMENTS_CLEARED_COLUMNS_]); }, 'write Unmatched_Comments_Cleared header');
    try { if (typeof sheet.hideSheet === 'function') sheet.hideSheet(); } catch (e) { Logger.log('Could not hide ' + UNMATCHED_COMMENTS_CLEARED_SHEET_ + ': ' + e); }
  }
  const merged = readClearedUnmatchedKeysGs_(ss, now);
  entries.forEach(function (en) { merged[en.key] = en.day; });
  const rows = Object.keys(merged).map(function (k) { return [k, merged[k]]; });
  const lastRow = sheet.getLastRow();
  if (rows.length) {
    const range = sheet.getRange(2, 1, rows.length, 2);
    if (typeof range.setNumberFormat === 'function') range.setNumberFormat('@');
    withRetry_(function () { range.setValues(rows); }, 'write Unmatched_Comments_Cleared');
  }
  if (lastRow - 1 > rows.length) {
    withRetry_(function () { sheet.getRange(2 + rows.length, 1, (lastRow - 1) - rows.length, 2).clearContent(); }, 'clear Unmatched_Comments_Cleared tail');
  }
}

/**
 * Core scan — takes the SAME dataRows/colIndex the caller already read
 * (no separate leads-tab read of its own), for every OPEN lead whose
 * latest owner-logged comment classifies as the generic "Update" outcome
 * (real text, but inferOutcomeGs_ matched no rule at all), appends one
 * row UNLESS that exact (lead_id, comment) pair is already logged.
 * Returns the number of new rows actually appended (0 if nothing new).
 */
function scanUnmatchedCommentsGs_(ss, dataRows, colIndex, now) {
  const sheet = ensureUnmatchedCommentsLogSheet_(ss);
  const lastRow = sheet.getLastRow();
  const alreadyLogged = {};
  if (lastRow >= 2) {
    // Reconstruct the SAME key unmatchedCommentDedupKeyGs_ builds at
    // write time (ts when present, else the raw comment text) — reading
    // back ONLY the comment_at column here would build a different key
    // for every row that was logged via the no-timestamp fallback
    // (comment_at blank), silently defeating de-dup for exactly those.
    //
    // 2026-09-03 fix — a real, confirmed production incident: comment_at
    // is written as a plain "yyyy-MM-dd HH:mm" STRING (unmatchedCommentDedupKeyGs_'s
    // own `.ts` format, straight from latestOutcomeGs_'s regex match), but
    // that string is exactly the shape Sheets' own locale-aware type
    // detection recognizes as a real datetime — so the CELL silently
    // becomes a date-typed cell, and getValues() reads it back as a JS
    // Date object, not the original string. String(dateObj) then produces
    // something like "Thu Aug 27 2026 17:26:00 GMT+0530 (India Standard
    // Time)", which can never equal the freshly-computed "2026-08-27
    // 17:26" key — so alreadyLogged NEVER matched, and every comment got
    // re-logged on every single run since this file was created (confirmed
    // via a real Unmatched_Comments_Log export: the same (lead_id,
    // comment) pairs repeating across 20+ consecutive 6-hourly captures).
    // Same "date column auto-converted to serial/Date" gotcha this project
    // already handles elsewhere (Daily_RM_Issues' own `date` column,
    // OvernightEmailer.gs's Overnight_Log read, Movement_Log) — reformat
    // a Date-typed cell back to the exact string format the write side
    // uses before building the key, same as those.
    // Same key as the write side, via the shared read-back helper (IH-02: ts whitespace normalised, a Date cell formatted in the
    // spreadsheet's own zone).
    const tz = commentLogSheetTimeZoneGs_(ss);
    withRetry_(function () { return sheet.getRange(2, 1, lastRow - 1, 7).getValues(); }, 'read Unmatched_Comments_Log for de-dup')
      .forEach(function (r) {
        const leadId = String(r[1] || '').trim();
        if (leadId) alreadyLogged[commentHistoryReadBackKeyGs_(leadId, r[6], r[5], tz)] = true;
      });
  }
  // Comments a human already reviewed and cleared count as logged too (UC-01).
  const cleared = readClearedUnmatchedKeysGs_(ss, now);
  Object.keys(cleared).forEach(function (k) { alreadyLogged[k] = true; });

  const todayKey = istDayKeyGs_(now);
  const loggedAtValue = Utilities.formatDate(now, 'Asia/Kolkata', 'yyyy-MM-dd HH:mm:ss');
  const newRows = [];

  dataRows.forEach(function (row) {
    const leadId = String(getVal_(row, colIndex, 'lead_id') || '').trim();
    if (!leadId) return;

    const stage = getVal_(row, colIndex, 'current_stage');
    const closingReason = getVal_(row, colIndex, 'closing_reason');
    const leadClosingReason = getVal_(row, colIndex, 'lead_closing_reason');
    if (!isOpenLead_(stage, closingReason, leadClosingReason)) return; // closed leads don't need active follow-up review

    const latest = latestOutcomeGs_(row, colIndex);
    if (!latest || !latest.comment) return; // no owner-logged comment at all — nothing to classify
    if (latest.outcome !== 'Update') return; // matched a real rule (or is the punctuation-only "No Real Update") — nothing to review

    // Older than the retention window: its row has been (or is about to be) pruned, so it is not new (UC-01).
    if (commentBeyondRetentionGs_(latest.ts, now, UNMATCHED_COMMENTS_LOG_RETENTION_DAYS_)) return;

    const key = unmatchedCommentDedupKeyGs_(leadId, latest);
    if (alreadyLogged[key]) return; // already logged this exact comment before — see this file's own volume-control note
    alreadyLogged[key] = true; // guard against the SAME lead appearing twice within this one run too (shouldn't normally happen, but stay defensive)

    newRows.push([
      todayKey, leadId,
      String(getVal_(row, colIndex, 'RM') || '').trim() || 'Unassigned',
      String(getVal_(row, colIndex, 'region') || '').trim(),
      String(getVal_(row, colIndex, 'project') || '').trim(),
      latest.comment, commentTsNormaliseGs_(latest.ts), loggedAtValue, false, '',
    ]);
  });

  if (newRows.length) {
    const startRow = sheet.getLastRow() + 1;
    commentAtTextFormatGs_(sheet, startRow, UNMATCHED_COMMENTS_LOG_COLUMNS_.indexOf('comment_at') + 1, newRows.length); // IH-02
    withRetry_(function () {
      sheet.getRange(startRow, 1, newRows.length, UNMATCHED_COMMENTS_LOG_COLUMNS_.length).setValues(newRows);
    }, 'append Unmatched_Comments_Log rows');
    withRetry_(function () {
      sheet.getRange(startRow, 9, newRows.length, 1).insertCheckboxes();
    }, 'insert Unmatched_Comments_Log reviewed checkboxes');
  }

  return newRows.length;
}

// Run manually (function dropdown) to scan right now without waiting for
// the next snapshot trigger — reads the leads tab itself (unlike
// scanUnmatchedCommentsGs_, which reuses an already-read dataRows/
// colIndex when called from snapshotOpenLeads_).
function scanUnmatchedCommentsNow() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const { colIndex, dataRows } = readLeadsTab_(ss);
  const count = scanUnmatchedCommentsGs_(ss, dataRows, colIndex, new Date());
  Logger.log('scanUnmatchedCommentsNow: logged ' + count + ' new unmatched comment(s) to "' + UNMATCHED_COMMENTS_LOG_SHEET_ + '".');
}

// ONE-OFF MAINTENANCE — deletes every row currently checked "reviewed",
// once you've actually gone through them (this is deliberately a manual
// step, not automatic, since only a human should decide a review batch
// is really done). Rewrites the data range with only the not-yet-reviewed
// rows kept: kept rows written FIRST, then only the leftover tail cleared
// (UC-02, 2026-10-13: it used to clear everything first, so an
// interruption between the two steps lost every unreviewed row too). The
// cleared rows' keys are remembered first (UC-01, see
// UNMATCHED_COMMENTS_CLEARED_SHEET_) so the next scan does not bring them
// back unreviewed. Safe to re-run any time; nothing reviewed = no-op.
function clearReviewedUnmatchedCommentsNow() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(UNMATCHED_COMMENTS_LOG_SHEET_);
  if (!sheet) { Logger.log('Unmatched_Comments_Log does not exist yet — nothing to clear.'); return; }
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) { Logger.log('Unmatched_Comments_Log is empty — nothing to clear.'); return; }

  const lastCol = UNMATCHED_COMMENTS_LOG_COLUMNS_.length;
  const values = withRetry_(function () { return sheet.getRange(2, 1, lastRow - 1, lastCol).getValues(); }, 'read Unmatched_Comments_Log for clearing');
  const kept = values.filter(function (row) { return !unmatchedCommentIsReviewedGs_(row[8]); }); // column 9 (index 8) = reviewed
  const clearedCount = values.length - kept.length;
  if (!clearedCount) { Logger.log('Nothing is marked reviewed - nothing to clear.'); return; }

  const now = new Date();
  const todayKey = istDayKeyGs_(now);
  const tz = commentLogSheetTimeZoneGs_(ss);
  const clearedEntries = [];
  values.forEach(function (row) {
    if (!unmatchedCommentIsReviewedGs_(row[8])) return;
    const leadId = String(row[1] || '').trim();
    if (!leadId) return;
    const key = commentHistoryReadBackKeyGs_(leadId, row[6], row[5], tz);
    const m = /\|(\d{4}-\d{2}-\d{2}) \d{2}:\d{2}$/.exec(key);
    clearedEntries.push({ key: key, day: m ? m[1] : todayKey });
  });
  recordClearedUnmatchedKeysGs_(ss, clearedEntries, now); // before the rows go: an interruption then only leaves them in place

  writeKeptUnmatchedRowsGs_(sheet, kept, lastRow, lastCol);
  Logger.log('Cleared ' + clearedCount + ' reviewed row(s) out of ' + values.length + ' total; ' + kept.length + ' not-yet-reviewed row(s) kept.');
}

// Writes `kept` to rows 2.. FIRST (checkboxes back on the reviewed column), then clears only the leftover tail up to `lastRow` -
// never clear-then-write (UC-02, 2026-10-13), the same ordering pruneUnmatchedCommentsLog_ below uses.
function writeKeptUnmatchedRowsGs_(sheet, kept, lastRow, lastCol) {
  if (kept.length) {
    withRetry_(function () { sheet.getRange(2, 1, kept.length, lastCol).setValues(kept); }, 'rewrite kept Unmatched_Comments_Log rows');
    withRetry_(function () { sheet.getRange(2, 9, kept.length, 1).insertCheckboxes(); }, 'restore Unmatched_Comments_Log reviewed checkboxes');
  }
  if (lastRow - 1 > kept.length) {
    withRetry_(function () { sheet.getRange(2 + kept.length, 1, (lastRow - 1) - kept.length, lastCol).clearContent(); }, 'clear Unmatched_Comments_Log tail');
  }
}

// ONE-OFF RECOVERY — run this ONCE after syncing the 2026-09-03 de-dup fix
// above (scanUnmatchedCommentsGs_'s comment_at-is-a-Date read-back bug),
// to collapse the backlog that bug produced back down to one row per
// genuinely unique (lead_id, comment_at-or-comment) pair — every run
// since this file was first created re-logged every still-open comment as
// a brand-new row instead of recognizing it as already logged, so a
// single real comment can currently have dozens of duplicate rows, one
// per 6-hourly capture it survived across. Keeps the EARLIEST row per
// key (oldest `date`/`logged_at` — the first time this comment was truly
// new) UNLESS a later duplicate is marked reviewed=true, in which case
// that reviewed one wins, so no review work already done gets silently
// discarded. Same write-kept-then-clear-tail approach as clearReviewedUnmatchedCommentsNow (UC-02).
// Safe to re-run — a sheet with no duplicates left is a no-op. Not meant
// to run repeatedly: once this bug is actually fixed in the live project,
// new duplicates should stop appearing on their own.
function dedupeUnmatchedCommentsNow() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(UNMATCHED_COMMENTS_LOG_SHEET_);
  if (!sheet) { Logger.log('Unmatched_Comments_Log does not exist yet — nothing to dedupe.'); return; }
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) { Logger.log('Unmatched_Comments_Log is empty — nothing to dedupe.'); return; }

  const lastCol = UNMATCHED_COMMENTS_LOG_COLUMNS_.length;
  const values = withRetry_(function () { return sheet.getRange(2, 1, lastRow - 1, lastCol).getValues(); }, 'read Unmatched_Comments_Log for dedupe');
  const tz = commentLogSheetTimeZoneGs_(ss);

  const byKey = {}; // key -> the row currently kept for it
  values.forEach(function (row) {
    const leadId = String(row[1] || '').trim();
    if (!leadId) return;
    const key = commentHistoryReadBackKeyGs_(leadId, row[6], row[5], tz);
    const existing = byKey[key];
    if (!existing) { byKey[key] = row; return; }
    // Prefer a reviewed duplicate over an unreviewed one (never lose
    // review work already done); otherwise keep whichever has the
    // earlier logged_at (column 8, index 7) — the original first-seen row.
    // Both cells normalised before comparing (UC-03).
    const existingReviewed = unmatchedCommentIsReviewedGs_(existing[8]), rowReviewed = unmatchedCommentIsReviewedGs_(row[8]);
    if (rowReviewed && !existingReviewed) { byKey[key] = row; return; }
    if (rowReviewed === existingReviewed && unmatchedCommentLoggedAtKeyGs_(row[7]) < unmatchedCommentLoggedAtKeyGs_(existing[7])) { byKey[key] = row; }
  });

  const kept = Object.keys(byKey).map(function (k) { return byKey[k]; });
  const clearedCount = values.length - kept.length;
  if (!clearedCount) { Logger.log('No duplicates - nothing to dedupe.'); return; }

  writeKeptUnmatchedRowsGs_(sheet, kept, lastRow, lastCol);
  Logger.log('Deduped: removed ' + clearedCount + ' duplicate row(s) out of ' + values.length + ' total; ' + kept.length + ' unique row(s) kept.');
}

// Added 2026-09-29 — see this file's own header "AGE-BASED PRUNING" note.
// Independent of `reviewed`: a row this old is archived-and-removed either
// way, since the whole point is "nobody dealt with this in time", not
// "nobody CHECKED it in time". Same headroom/chunk reasoning as
// COMMENT_HISTORY_ROW_HEADROOM_/COMMENT_HISTORY_ARCHIVE_CHUNK_
// (InteractionHistoryLogger.gs).
const UNMATCHED_COMMENTS_LOG_RETENTION_DAYS_ = 30;
const UNMATCHED_COMMENTS_LOG_ROW_HEADROOM_ = 2000;
const UNMATCHED_COMMENTS_LOG_ARCHIVE_CHUNK_ = 5000;

// Archives (chunked) and removes Unmatched_Comments_Log rows older than
// UNMATCHED_COMMENTS_LOG_RETENTION_DAYS_, regardless of `reviewed`.
// Same crash-safety ordering as pruneCommentHistory_
// (InteractionHistoryLogger.gs) / pruneMovementLog_ (MovementTracker.gs):
// archive BEFORE any deletion, write `kept` to its final position FIRST,
// THEN clear the leftover tail. Re-inserts checkboxes on the reviewed
// column after rewriting `kept` — same as clearReviewedUnmatchedCommentsNow
// above, since clearContent() strips the column's checkbox validation and
// a plain setValues() of booleans does not restore the interactive UI.
function pruneUnmatchedCommentsLog_(ss) {
  const sheet = ss.getSheetByName(UNMATCHED_COMMENTS_LOG_SHEET_);
  if (!sheet) return;
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return;
  const lastCol = UNMATCHED_COMMENTS_LOG_COLUMNS_.length;
  const values = sheet.getRange(2, 1, lastRow - 1, lastCol).getValues();
  const cutoff = new Date(Date.now() - UNMATCHED_COMMENTS_LOG_RETENTION_DAYS_ * 24 * 60 * 60 * 1000);
  // date (column 0) is written by istDayKeyGs_ — see
  // parseIstDayKeyOrDateGs_'s own comment (Core.gs). An unparseable date
  // is KEPT, never guessed into pruning.
  const isKeptRow_ = function (row) {
    const d = parseIstDayKeyOrDateGs_(row[0]);
    return !d || d >= cutoff;
  };
  const kept = values.filter(isKeptRow_);
  if (kept.length === values.length) return; // nothing old enough to prune — don't touch the sheet at all

  const dropped = values.filter(function (row) { return !isKeptRow_(row); });
  const droppedDates = dropped.map(function (row) { return parseIstDayKeyOrDateGs_(row[0]); }).filter(function (d) { return !!d; });
  const rowDateRangeLabel = droppedDates.length
    ? Utilities.formatDate(new Date(Math.min.apply(null, droppedDates.map(function (d) { return d.getTime(); }))), 'Asia/Kolkata', 'yyyy-MM-dd')
      + '_to_' + Utilities.formatDate(new Date(Math.max.apply(null, droppedDates.map(function (d) { return d.getTime(); }))), 'Asia/Kolkata', 'yyyy-MM-dd')
    : 'unknown-dates';

  // Archive-first, proved, and rolled back if the proof fails (archiveChunksVerifiedGs_, Core.gs) - so a failed prune leaves no
  // surplus file behind, and a retry after a later failure reuses the identical archive instead of writing another copy.
  const archive = archiveChunksVerifiedGs_(UNMATCHED_COMMENTS_LOG_SHEET_, UNMATCHED_COMMENTS_LOG_COLUMNS_, dropped, rowDateRangeLabel, UNMATCHED_COMMENTS_LOG_ARCHIVE_CHUNK_, true);

  // Write kept rows to their final position FIRST, THEN clear only the
  // leftover tail beyond them — never clear-then-write. An interruption
  // between these two steps must never land on a sheet with real,
  // still-in-retention data already erased and nothing written back yet
  // (the exact real incident pruneMovementLog_'s own header documents,
  // MovementTracker.gs). This intentionally does NOT reuse
  // clearReviewedUnmatchedCommentsNow's simpler clear-then-write shape
  // above — that function only ever drops REVIEWED rows a human just
  // finished with, so losing a few to an interruption is recoverable by
  // re-checking them; this prunes on AGE alone and must not risk losing
  // an unreviewed comment nobody has seen yet.
  if (kept.length) {
    sheet.getRange(2, 1, kept.length, lastCol).setValues(kept);
    sheet.getRange(2, 9, kept.length, 1).insertCheckboxes();
  }
  if (lastRow - 1 > kept.length) {
    sheet.getRange(2 + kept.length, 1, (lastRow - 1) - kept.length, lastCol).clearContent();
  }

  const neededRows = 1 + kept.length + UNMATCHED_COMMENTS_LOG_ROW_HEADROOM_;
  const maxRows = sheet.getMaxRows();
  if (maxRows > neededRows) {
    sheet.deleteRows(neededRows + 1, maxRows - neededRows);
  }

  commitArchiveManifestGs_(UNMATCHED_COMMENTS_LOG_SHEET_, archive); // the ledger lists the archive only now that its rows are gone from the sheet
  Logger.log('Pruned ' + dropped.length + ' ' + UNMATCHED_COMMENTS_LOG_SHEET_ + ' row(s) older than ' + UNMATCHED_COMMENTS_LOG_RETENTION_DAYS_ +
    ' days (reviewed or not), archived to ' + archive.length + ' Drive CSV file(s) starting with ' + archive[0].file.getUrl() + '. ' + kept.length + ' row(s) kept.');
}

// Run manually (function dropdown) to prune right now without waiting
// for the next snapshot trigger.
function pruneUnmatchedCommentsLogNow() {
  pruneUnmatchedCommentsLog_(SpreadsheetApp.getActiveSpreadsheet());
}
