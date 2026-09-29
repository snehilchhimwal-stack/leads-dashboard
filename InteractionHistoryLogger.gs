/**
 * Interaction History Logger — records every open lead's genuinely NEW
 * owner-logged comment (any outcome, not just unmatched ones) into a
 * "Comment_History" sheet tab, going forward from whenever this is synced
 * live. This is the forward-looking capture decision from the To-Do
 * board's "No real interaction-history data exists anywhere" task
 * (2026-09-05): neither the 2-year historical CSV, a comments re-export,
 * nor Movement_Log's own 7-day window can retroactively reconstruct a
 * real interaction timeline — this can only start collecting one from
 * here on.
 *
 * WHY NOT JUST EXTEND MOVEMENT_LOG_RETENTION_DAYS INSTEAD: real measured
 * scale (2026-09-05) is 232,607 Movement_Log rows at the CURRENT 7-day
 * retention (~33,229 rows/day) — because snapshotOpenLeads_ writes a full
 * 24-column row for EVERY open lead on EVERY capture (4x/day),
 * unconditionally, whether or not anything actually changed. Extending
 * retention to even 14 days projects to ~465,000 rows = ~11.16 million
 * cells for Movement_Log ALONE, already past the workbook's hard
 * 10,000,000-cell ceiling before counting any other tab — a ceiling this
 * project has already hit for real once (see pruneMovementLog_'s own
 * comment on the one-time manual recovery that needed). A log that only
 * writes on an ACTUAL comment change scales with real interaction volume
 * instead of clock-ticks x open-lead-count, and stays a small fraction of
 * Movement_Log's write volume.
 *
 * WHY THIS PIGGYBACKS ON snapshotOpenLeads_ (MovementTracker.gs) RATHER
 * THAN ITS OWN TRIGGER — same reasoning as UnmatchedCommentLogger.gs's own
 * header: the natural cadence is "whenever the leads tab has actually
 * refreshed", and the existing 4x/day snapshot trigger is the closest
 * available proxy, already reading the whole tab for Movement_Log capture
 * (so reusing that read costs nothing extra). Wrapped in its own
 * try/catch at the call site, so a problem here can never block the core
 * Movement_Log capture.
 *
 * VOLUME CONTROL: same proven de-dup approach as
 * UnmatchedCommentLogger.gs's scanUnmatchedCommentsGs_ (lead_id + the
 * comment's own timestamp, falling back to the raw comment text when
 * there's no timestamp) — a lead's comment only produces a new row once,
 * the first run that sees it. Built the de-dup read-back to reformat a
 * Date-typed comment_at cell back to the exact string the write side
 * uses BEFORE building the key, from day one — see
 * UnmatchedCommentLogger.gs's own 2026-09-03 incident writeup for exactly
 * why this matters: Sheets silently converts a "yyyy-MM-dd HH:mm"-shaped
 * string into a date-typed cell, so getValues() hands back a JS Date, not
 * the original string, and a naive comparison would silently defeat
 * de-dup and re-log every open lead's comment on every single run.
 *
 * DELIBERATELY NOT filtered to a specific outcome (unlike
 * UnmatchedCommentLogger.gs's "Update"-only filter) — this log's whole
 * purpose is real interaction CADENCE, so every genuinely new
 * owner-logged comment counts, regardless of what it classifies as.
 *
 * PRUNING (added 2026-09-29): this file shipped 2026-09-05 with NO
 * automatic pruning, on the stated assumption that write volume here —
 * bounded by how often RMs actually log a NEW comment, not by a fixed
 * clock cadence — would grow an order of magnitude slower than
 * Movement_Log's. That assumption held on RATE but not on absolute scale:
 * by 2026-09-28 this tab alone was 1,048,164 cells (~10.5% of the whole
 * workbook's 10,000,000-cell ceiling), found by the cell-budget
 * diagnostic (Core.gs). Snehil confirmed pruning should apply (30-day
 * retention) — see pruneCommentHistory_ below, which follows
 * pruneMovementLog_'s own precedent (MovementTracker.gs) exactly as this
 * comment originally anticipated. This does NOT reverse the tab's
 * forward-capture PURPOSE (still every genuinely new comment, still no
 * outcome filter) — only how long a row stays in the live sheet before
 * being archived to Drive (never hard-deleted) and removed from it.
 *
 * Depends on Core.gs (getVal_, isOpenLead_, istDayKeyGs_),
 * FollowupEngine.gs (latestOutcomeGs_), EmailInfra.gs (withRetry_,
 * readLeadsTab_) — same dependencies as UnmatchedCommentLogger.gs, load
 * order between files doesn't matter to Apps Script.
 *
 * ============================== SETUP ==============================
 * Paste this in as its own file, alongside every other file in this
 * project (see Core.gs's own setup note for the full file list). No
 * separate trigger to install — MovementTracker.gs's own
 * setupMovementTracking already covers this, since
 * logInteractionHistoryGs_ is called from inside snapshotOpenLeads_.
 * ================================================================================
 */

const COMMENT_HISTORY_SHEET_ = 'Comment_History';
const COMMENT_HISTORY_COLUMNS_ = ['date', 'lead_id', 'client_id', 'RM', 'region', 'project', 'comment', 'comment_at', 'logged_at'];

// Same split-steps-with-a-flush pattern as every other ensure*Sheet_ in
// this project (see EmailInfra.gs's ensureRegionRecipientsSheet_).
function ensureCommentHistorySheet_(ss) {
  const existing = withRetry_(function () { return ss.getSheetByName(COMMENT_HISTORY_SHEET_); }, 'check for existing Comment_History');
  if (existing) return existing;

  const sheet = withRetry_(function () { return ss.insertSheet(COMMENT_HISTORY_SHEET_); }, 'insert Comment_History');
  SpreadsheetApp.flush();
  withRetry_(function () {
    sheet.getRange(1, 1, 1, COMMENT_HISTORY_COLUMNS_.length).setValues([COMMENT_HISTORY_COLUMNS_]);
    sheet.setFrozenRows(1);
  }, 'write Comment_History header');
  return sheet;
}

// Identical shape to UnmatchedCommentLogger.gs's unmatchedCommentDedupKeyGs_
// — lead_id + the comment's own timestamp when the structured "Name:
// Comment - yyyy-MM-dd HH:mm" log format gives one, else the raw comment
// text (the last_comment-field fallback path in latestOutcomeGs_, which
// has no timestamp to key off).
function commentHistoryDedupKeyGs_(leadId, outcomeEntry) {
  return leadId + '|' + (outcomeEntry.ts || outcomeEntry.comment);
}

/**
 * Core scan — takes the SAME dataRows/colIndex the caller already read (no
 * separate leads-tab read of its own), for every OPEN lead with a real
 * owner-logged comment, appends one row UNLESS that exact (lead_id,
 * comment) pair is already logged. Returns the number of new rows
 * actually appended (0 if nothing new).
 */
function logInteractionHistoryGs_(ss, dataRows, colIndex, now) {
  const sheet = ensureCommentHistorySheet_(ss);
  const lastRow = sheet.getLastRow();
  const alreadyLogged = {};
  if (lastRow >= 2) {
    // Same Date-vs-string handling as UnmatchedCommentLogger.gs's
    // scanUnmatchedCommentsGs_ — see this file's own header for why this
    // has to be right from day one, not learned the hard way again.
    withRetry_(function () { return sheet.getRange(2, 1, lastRow - 1, 8).getValues(); }, 'read Comment_History for de-dup')
      .forEach(function (r) {
        const leadId = String(r[1] || '').trim();
        const comment = String(r[6] || '').trim();
        const commentAtRaw = r[7];
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
    if (!isOpenLead_(stage, closingReason, leadClosingReason)) return; // closed leads add no more real interaction history

    const latest = latestOutcomeGs_(row, colIndex);
    if (!latest || !latest.comment) return; // no owner-logged comment at all — nothing to record

    const key = commentHistoryDedupKeyGs_(leadId, latest);
    if (alreadyLogged[key]) return; // already logged this exact comment before — see this file's own volume-control note
    alreadyLogged[key] = true; // guard against the SAME lead appearing twice within this one run too (shouldn't normally happen, but stay defensive)

    newRows.push([
      todayKey, leadId,
      String(getVal_(row, colIndex, 'client_id') || '').trim(),
      String(getVal_(row, colIndex, 'RM') || '').trim() || 'Unassigned',
      String(getVal_(row, colIndex, 'region') || '').trim(),
      String(getVal_(row, colIndex, 'project') || '').trim(),
      latest.comment, latest.ts || '', loggedAtValue,
    ]);
  });

  if (newRows.length) {
    withRetry_(function () {
      sheet.getRange(sheet.getLastRow() + 1, 1, newRows.length, COMMENT_HISTORY_COLUMNS_.length).setValues(newRows);
    }, 'append Comment_History rows');
  }

  return newRows.length;
}

// Run manually (function dropdown) to scan right now without waiting for
// the next snapshot trigger — reads the leads tab itself (unlike
// logInteractionHistoryGs_, which reuses an already-read dataRows/
// colIndex when called from snapshotOpenLeads_).
function logInteractionHistoryNow() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const { colIndex, dataRows } = readLeadsTab_(ss);
  const count = logInteractionHistoryGs_(ss, dataRows, colIndex, new Date());
  Logger.log('logInteractionHistoryNow: logged ' + count + ' new comment(s) to "' + COMMENT_HISTORY_SHEET_ + '".');
}

// 30-day retention, added 2026-09-29 — see this file's own header
// "PRUNING" note for why. Extra rows left allocated beyond what's
// actually needed after a prune, same reasoning as
// MOVEMENT_LOG_ROW_HEADROOM_ (MovementTracker.gs) but smaller, since this
// tab's write volume is a fraction of Movement_Log's.
const COMMENT_HISTORY_RETENTION_DAYS_ = 30;
const COMMENT_HISTORY_ROW_HEADROOM_ = 2000;
// Smaller than MovementTracker.gs's usual 10000-row read/write batches on
// purpose — a Drive file-SIZE ceiling, not a Sheets quota, and this tab's
// rows carry long free-text comment fields that make each row heavier
// than a typical structured row. Real precedent for exactly this failure:
// removeStaleMovementLogBackupTabNow_'s first live run (MovementTracker.gs,
// 2026-09-28) hit "exceeds the maximum file size" archiving 109,999 rows
// in one Drive file — this tab has never been pruned before, so its
// FIRST run here could face a similarly large backlog in one call.
const COMMENT_HISTORY_ARCHIVE_CHUNK_ = 5000;

// Archives (chunked — see COMMENT_HISTORY_ARCHIVE_CHUNK_'s own comment)
// and removes Comment_History rows older than
// COMMENT_HISTORY_RETENTION_DAYS_. Follows pruneMovementLog_'s own
// crash-safety ordering (MovementTracker.gs) exactly: archive BEFORE any
// deletion, write `kept` to its final position FIRST, THEN clear only the
// leftover tail — an interruption at any point never loses data, at
// worst leaves some already-expired rows stale until the next run
// re-prunes them. Skips the whole clear/write/shrink sequence entirely
// when nothing is old enough to prune (the common case on every run
// after the first).
function pruneCommentHistory_(ss) {
  const sheet = ss.getSheetByName(COMMENT_HISTORY_SHEET_);
  if (!sheet) return;
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return;
  const lastCol = sheet.getLastColumn();
  const values = sheet.getRange(2, 1, lastRow - 1, lastCol).getValues();
  const cutoff = new Date(Date.now() - COMMENT_HISTORY_RETENTION_DAYS_ * 24 * 60 * 60 * 1000);
  // date (column 0) is written by istDayKeyGs_ — see
  // parseIstDayKeyOrDateGs_'s own comment (Core.gs) for why the cell can
  // come back as either a string or a Date. An unparseable date is KEPT,
  // never guessed into pruning.
  const isKeptRow_ = function (row) {
    const d = parseIstDayKeyOrDateGs_(row[0]);
    return !d || d >= cutoff;
  };
  const kept = values.filter(isKeptRow_);
  if (kept.length === values.length) return; // nothing old enough to prune — don't touch the sheet at all

  const dropped = values.filter(function (row) { return !isKeptRow_(row); });
  const header = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  const droppedDates = dropped.map(function (row) { return parseIstDayKeyOrDateGs_(row[0]); }).filter(function (d) { return !!d; });
  const rowDateRangeLabel = droppedDates.length
    ? Utilities.formatDate(new Date(Math.min.apply(null, droppedDates.map(function (d) { return d.getTime(); }))), 'Asia/Kolkata', 'yyyy-MM-dd')
      + '_to_' + Utilities.formatDate(new Date(Math.max.apply(null, droppedDates.map(function (d) { return d.getTime(); }))), 'Asia/Kolkata', 'yyyy-MM-dd')
    : 'unknown-dates';

  const files = [];
  for (let i = 0; i < dropped.length; i += COMMENT_HISTORY_ARCHIVE_CHUNK_) {
    const chunkRows = dropped.slice(i, i + COMMENT_HISTORY_ARCHIVE_CHUNK_);
    const file = archiveRowsToDriveCsv_(COMMENT_HISTORY_SHEET_, header, chunkRows, rowDateRangeLabel + '_part' + (files.length + 1));
    if (!file) throw new Error('Drive archive chunk ' + (files.length + 1) + ' was not created - refusing to prune ' + COMMENT_HISTORY_SHEET_ + '.');
    files.push(file);
  }
  // Total lines across every chunk file, minus one header line PER chunk
  // (archiveRowsToDriveCsv_ writes [header].concat(rows) into every file
  // it creates) — a general row-count proof that works regardless of
  // what shape column 0 happens to be, unlike a format-specific regex.
  let archivedLines = 0;
  files.forEach(function (file) { archivedLines += file.getBlob().getDataAsString().split('\n').length; });
  const archivedRows = archivedLines - files.length;
  if (archivedRows !== dropped.length) {
    throw new Error('Drive archive holds ' + archivedRows + ' row(s) across ' + files.length + ' file(s) but ' + dropped.length +
      ' were expected - refusing to prune ' + COMMENT_HISTORY_SHEET_ + '.');
  }

  if (kept.length) {
    sheet.getRange(2, 1, kept.length, lastCol).setValues(kept);
  }
  if (lastRow - 1 > kept.length) {
    sheet.getRange(2 + kept.length, 1, (lastRow - 1) - kept.length, lastCol).clearContent();
  }

  // Shrinks the sheet's declared row allocation, same reasoning as
  // pruneMovementLog_'s own final step (MovementTracker.gs) — clearContent
  // above only empties cell VALUES, never the workbook's declared grid
  // size that the 10,000,000-cell ceiling actually counts against.
  const neededRows = 1 + kept.length + COMMENT_HISTORY_ROW_HEADROOM_;
  const maxRows = sheet.getMaxRows();
  if (maxRows > neededRows) {
    sheet.deleteRows(neededRows + 1, maxRows - neededRows);
  }

  Logger.log('Pruned ' + dropped.length + ' ' + COMMENT_HISTORY_SHEET_ + ' row(s) older than ' + COMMENT_HISTORY_RETENTION_DAYS_ +
    ' days, archived to ' + files.length + ' Drive CSV file(s) starting with ' + files[0].getUrl() + '. ' + kept.length + ' row(s) kept.');
}

// Run manually (function dropdown) to prune right now without waiting
// for the next snapshot trigger.
function pruneCommentHistoryNow() {
  pruneCommentHistory_(SpreadsheetApp.getActiveSpreadsheet());
}
