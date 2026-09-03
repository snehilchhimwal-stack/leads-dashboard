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
 * clear out every reviewed=true row and keep the sheet from growing
 * unbounded — this is a manual step, not automatic, since only a human
 * should decide a review cycle is actually done. See dedupeUnmatchedCommentsNow
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
function unmatchedCommentDedupKeyGs_(leadId, outcomeEntry) {
  return leadId + '|' + (outcomeEntry.ts || outcomeEntry.comment);
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
    withRetry_(function () { return sheet.getRange(2, 1, lastRow - 1, 7).getValues(); }, 'read Unmatched_Comments_Log for de-dup')
      .forEach(function (r) {
        const leadId = String(r[1] || '').trim();
        const comment = String(r[5] || '').trim();
        const commentAtRaw = r[6];
        const commentAt = commentAtRaw instanceof Date
          ? Utilities.formatDate(commentAtRaw, 'Asia/Kolkata', 'yyyy-MM-dd HH:mm')
          : String(commentAtRaw || '').trim();
        if (leadId) alreadyLogged[leadId + '|' + (commentAt || comment)] = true;
      });
  }

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

    const key = unmatchedCommentDedupKeyGs_(leadId, latest);
    if (alreadyLogged[key]) return; // already logged this exact comment before — see this file's own volume-control note
    alreadyLogged[key] = true; // guard against the SAME lead appearing twice within this one run too (shouldn't normally happen, but stay defensive)

    newRows.push([
      todayKey, leadId,
      String(getVal_(row, colIndex, 'RM') || '').trim() || 'Unassigned',
      String(getVal_(row, colIndex, 'region') || '').trim(),
      String(getVal_(row, colIndex, 'project') || '').trim(),
      latest.comment, latest.ts || '', loggedAtValue, false, '',
    ]);
  });

  if (newRows.length) {
    withRetry_(function () {
      sheet.getRange(sheet.getLastRow() + 1, 1, newRows.length, UNMATCHED_COMMENTS_LOG_COLUMNS_.length).setValues(newRows);
    }, 'append Unmatched_Comments_Log rows');
    withRetry_(function () {
      sheet.getRange(sheet.getLastRow() - newRows.length + 1, 9, newRows.length, 1).insertCheckboxes();
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
// is really done). Rewrites the whole data range with only the
// not-yet-reviewed rows kept — same simple, safe approach
// pruneMovementLog_ (MovementTracker.gs) uses for its own row removal.
// Safe to re-run any time; a sheet with nothing reviewed yet is a no-op.
function clearReviewedUnmatchedCommentsNow() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(UNMATCHED_COMMENTS_LOG_SHEET_);
  if (!sheet) { Logger.log('Unmatched_Comments_Log does not exist yet — nothing to clear.'); return; }
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) { Logger.log('Unmatched_Comments_Log is empty — nothing to clear.'); return; }

  const lastCol = UNMATCHED_COMMENTS_LOG_COLUMNS_.length;
  const values = sheet.getRange(2, 1, lastRow - 1, lastCol).getValues();
  const kept = values.filter(function (row) { return !row[8]; }); // column 9 (index 8) = reviewed
  const clearedCount = values.length - kept.length;

  sheet.getRange(2, 1, lastRow - 1, lastCol).clearContent();
  if (kept.length) {
    sheet.getRange(2, 1, kept.length, lastCol).setValues(kept);
    sheet.getRange(2, 9, kept.length, 1).insertCheckboxes();
  }
  Logger.log('Cleared ' + clearedCount + ' reviewed row(s) out of ' + values.length + ' total; ' + kept.length + ' not-yet-reviewed row(s) kept.');
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
// discarded. Same clear-and-rewrite approach as clearReviewedUnmatchedCommentsNow.
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
  const values = sheet.getRange(2, 1, lastRow - 1, lastCol).getValues();

  const byKey = {}; // key -> the row currently kept for it
  values.forEach(function (row) {
    const leadId = String(row[1] || '').trim();
    if (!leadId) return;
    const comment = String(row[5] || '').trim();
    const commentAtRaw = row[6];
    const commentAt = commentAtRaw instanceof Date
      ? Utilities.formatDate(commentAtRaw, 'Asia/Kolkata', 'yyyy-MM-dd HH:mm')
      : String(commentAtRaw || '').trim();
    const key = leadId + '|' + (commentAt || comment);
    const existing = byKey[key];
    if (!existing) { byKey[key] = row; return; }
    // Prefer a reviewed duplicate over an unreviewed one (never lose
    // review work already done); otherwise keep whichever has the
    // earlier logged_at (column 8, index 7) — the original first-seen row.
    const existingReviewed = !!existing[8], rowReviewed = !!row[8];
    if (rowReviewed && !existingReviewed) { byKey[key] = row; return; }
    if (rowReviewed === existingReviewed && row[7] < existing[7]) { byKey[key] = row; }
  });

  const kept = Object.keys(byKey).map(function (k) { return byKey[k]; });
  const clearedCount = values.length - kept.length;

  sheet.getRange(2, 1, lastRow - 1, lastCol).clearContent();
  if (kept.length) {
    sheet.getRange(2, 1, kept.length, lastCol).setValues(kept);
    sheet.getRange(2, 9, kept.length, 1).insertCheckboxes();
  }
  Logger.log('Deduped: removed ' + clearedCount + ' duplicate row(s) out of ' + values.length + ' total; ' + kept.length + ' unique row(s) kept.');
}
