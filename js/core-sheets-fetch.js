// ============================================================
// core-sheets-fetch.js — HEADER_ALIASES + the parsed-lead state
// (leads/issueLeads/allParsedLeads/filterState), plus the low-level
// Sheets API v4 read + gviz-shape parsing helpers everything else in
// the fetch pipeline builds on. Split out of core.js (Phase 2 — see
// HANDOVER.md). Pure code motion — no logic changed.
// ============================================================

/* This list drives the "unmatched header" warning, so it must contain ONLY
 * columns the code actually reads. A dead entry here produces a false alarm
 * that trains you to ignore a genuinely useful check — which is exactly what
 * happened with region_parent after it was dropped from the export.
 * Removed as unread: region_parent. Re-add alongside a real getVal() call
 * if it's ever needed. stage_comments was also removed for the same
 * reason, then re-added — a lead can carry a real comment there that
 * internal_status_comments alone misses (see combinedCommentsText). */
const HEADER_ALIASES = {
  lead_id: ['lead_id','leadid','lead id'],
  RM: ['rm'],
  TL: ['tl'],
  rm_is_active: ['rm_is_active','rm is active'],
  project: ['project'],
  region: ['region'],
  project_region: ['project_region','project region'],
  client: ['client'],
  lead_assigned_at: ['lead_assigned_at','lead assigned at','assigned_at','assigned at','lead assigned','date assigned'],
  group_source: ['group_source','group source','source'],
  source_bucket: ['source_bucket','source bucket','sub_source','sub source'],
  current_stage: ['current_stage','current stage','stage'],
  client_id: ['client_id','client id'],
  last_connect: ['last_connect','last connect'],
  last_connect_time: ['last_connect_time','last connect time'],
  last_comment: ['last_comment','last comment'],
  internal_status_comments: ['internal_status_comments','internal status comments'],
  // Every discrete comment logged at a stage-change event — a separate
  // source from internal_status_comments (the running action-log history).
  // Combined with it everywhere "has this lead been commented on" is
  // checked (see combinedCommentsText) so a comment logged only here isn't
  // read as silence.
  stage_comments: ['stage_comments','stage comments'],
  closing_reason: ['closing_reason','closing reason'],
  // The sheet's OWN closing disposition — distinct from closing_reason
  // above (an RM-entered/internal field). Deliberately kept separate from
  // combinedCommentsText/hasAnyCommentField/hasAnyNarrativeComment's
  // "internal comment" checks: a lead auto-closed with only this filled in
  // and nothing logged anywhere else is exactly the "no comment" case
  // Closed with No Comment exists to catch. Used instead as the preferred
  // label wherever the dashboard shows WHY a lead closed (see
  // suggestedFollowUp).
  lead_closing_reason: ['lead_closing_reason','lead closing reason'],
  lead_closing_comment: ['lead_closing_comment','lead closing comment'],
  // call_attempts is the SOP's "attempt" — every dial, connected or not.
  // call_count (connected calls only) is still read, but only for display.
  call_attempts: ['call_attempts','call attempts','attempts'],
  call_count: ['call_count','call count'],
  duration: ['duration'],
};

// Runtime resilience check for HEADER_ALIASES (see the comment above it):
// getVal/getDate stamp every key they're actually called with into this set
// on each fetch. Any HEADER_ALIASES key that never shows up here is dead
// code — nothing reads it — which is exactly the condition that once
// produced a false "unmatched header" warning for region_parent (and,
// briefly, stage_comments before it gained a real reader). Checked once
// per fetch, right after parsing.
let _accessedHeaderKeys = new Set();

let leads = [];
// Same leads, but any multi-copy customer is expanded into one entity per
// original RM copy (see copySplits in fetchAndRender) — the view every SLA
// issue check/section/email/CSV export reads from, so one RM's closed copy
// or higher call count never masks a DIFFERENT RM's own separate issue on
// the same underlying customer. `leads` above stays one-card-per-customer
// for everything that isn't about a specific issue.
let issueLeads = [];
let allParsedLeads = [];
// Every collated customer whose underlying copies didn't all resolve to the
// SAME region — e.g. a Pune row and a Thane row sharing a client_id or
// lead_id, merged into one record that can only display one region. Reset
// and repopulated on every fetch; inspect via console for the full detail
// behind the "N span more than one region" line in the collation notice.
let _lastCrossRegionCollations = [];
const filterState = { project: new Set(), region: new Set(), source: new Set(), TL: new Set(), bucket: new Set() };
// Empty set on any filter means "no restriction, show all" — every filter
// starts unrestricted, so all leads across all sources are shown by default.

function extractSheetId(raw){
  const trimmed = raw.trim();
  const m = trimmed.match(/\/d\/([a-zA-Z0-9-_]+)/);
  if (m) return m[1];
  return trimmed;
}

// Authenticated read via Sheets API v4 — replaces the old anonymous gviz
// JSONP endpoint now that the dashboard requires sign-in. UNFORMATTED_VALUE
// + SERIAL_NUMBER keep numbers/dates as raw values (no locale-formatted
// strings to re-parse); range must be "TabName!A1:Z"-style, tab included.
// A 403 here means the signed-in account isn't shared on the sheet — that
// denial, enforced by Google itself, IS the access control.
async function sheetsApiValuesGet(sheetId, range){
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${encodeURIComponent(range)}` +
    `?valueRenderOption=UNFORMATTED_VALUE&dateTimeRenderOption=SERIAL_NUMBER`;
  const resp = await fetch(url, { headers: { Authorization: `Bearer ${gateAccessToken}` } });
  if (!resp.ok) {
    let msg = `Sheets API error ${resp.status}`;
    try {
      const body = await resp.json();
      if (body.error && body.error.message) msg = body.error.message;
    } catch (e) { /* body wasn't JSON */ }
    const err = new Error(msg);
    err.status = resp.status;
    throw err;
  }
  const data = await resp.json();
  return data.values || [];
}

// Reconstructs a Sheets date serial (days since Dec 30, 1899 + time-of-day
// fraction) into gviz's own "Date(y,mo,d,h,mi,s)" string literal — the
// EXACT format gvizCellDate already parses. Keeping that shape means every
// existing parser below (built and tested against the old gviz endpoint)
// keeps working unchanged; only the fetch mechanism changed.
function serialToGvizDateString(serial){
  const wholeDays = Math.floor(serial);
  const fracDay = serial - wholeDays;
  const epochUtcMs = Date.UTC(1899, 11, 30);
  const totalMs = epochUtcMs + wholeDays * 86400000 + Math.round(fracDay * 86400000);
  const d = new Date(totalMs);
  return `Date(${d.getUTCFullYear()},${d.getUTCMonth()},${d.getUTCDate()},${d.getUTCHours()},${d.getUTCMinutes()},${d.getUTCSeconds()})`;
}

// Wraps a plain Sheets API values[][] response (header row + data rows)
// into the same {cols, rows:[{c:[...]}]} shape the gviz endpoint used to
// return, so gvizCellRaw/gvizCellDate and everything built on them keep
// working unchanged. isDateColumnLabel(lowercasedTrimmedLabel) => bool
// tells it which columns to reconstruct as gviz Date(...) cells rather
// than passing the raw serial number straight through.
function valuesToGvizShape(values, isDateColumnLabel){
  if (!values.length) return { cols: [], rows: [] };
  const headerRow = values[0] || [];
  const cols = headerRow.map(label => ({ label: String(label == null ? '' : label) }));

  const dateColIndices = new Set();
  headerRow.forEach((label, i) => {
    if (isDateColumnLabel(String(label || '').trim().toLowerCase())) dateColIndices.add(i);
  });

  const rows = values.slice(1).map(row => ({
    c: cols.map((_, i) => {
      const raw = row[i];
      if (raw == null || raw === '') return null;
      if (dateColIndices.has(i) && typeof raw === 'number') {
        return { v: serialToGvizDateString(raw) };
      }
      return { v: raw };
    })
  }));

  return { cols, rows };
}

function gvizCellRaw(cell){
  if (!cell) return '';
  return cell.v != null ? cell.v : (cell.f != null ? cell.f : '');
}

function gvizCellDate(cell){
  if (!cell) return null;
  const v = cell.v;
  if (typeof v === 'string' && v.indexOf('Date(') === 0) {
    const m = v.match(/Date\((\d+),(\d+),(\d+)(?:,(\d+),(\d+),(\d+))?\)/);
    if (m) {
      // These components are the sheet's own wall-clock, which is IST.
      return istWallToInstant(
        Number(m[1]), Number(m[2]), Number(m[3]),
        Number(m[4] || 0), Number(m[5] || 0), Number(m[6] || 0)
      );
    }
  }
  if (cell.f) return parseDate(cell.f);
  if (typeof v === 'string') return parseDate(v);
  return null;
}
