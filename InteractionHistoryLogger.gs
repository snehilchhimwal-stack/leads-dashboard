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
 * NO AUTOMATIC PRUNING (unlike Movement_Log/Unmatched_Comments_Log):
 * write volume here is bounded by how often RMs actually log a NEW
 * comment, not by a fixed clock cadence, so growth should be an order of
 * magnitude slower than Movement_Log's. Revisit if that assumption turns
 * out wrong once real volume is observed — see pruneMovementLog_'s own
 * precedent for the pattern to copy if a manual prune ever becomes
 * necessary.
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
