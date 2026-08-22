// ============================================================
// core.js — shared foundation for the Google Leads Dashboard.
// Loaded FIRST (before every other js/*.js file) — everything
// else in the app depends on functions/state defined here.
// Extracted from dashboard.html's single inline <script> block
// (see the file-split plan) — pure code motion, no logic changed.
// ============================================================

const CONFIG = {
  MIN_CALLS_PER_DAY: 5,
  MIN_CALLS_AFTER_48H: 10,
  LEAD_LIFECYCLE_HOURS: 48,
  FIRST_CONTACT_SLA_MINUTES: 10,
  // SOP Rule 3 — CRM logging after each attempt. call_attempts minus dated
  // comment-log entries is the shortfall between calls made and calls
  // actually written up. A gap of 1-2 is normal logging lag; this is the
  // point it becomes a real compliance problem worth surfacing.
  MIN_UNLOGGED_CALL_GAP: 3,
  // Movement tab's Overnight Leads card — the after-hours window before
  // the morning shift starts, anchored on the selected "To" snapshot's
  // calendar day: 5 PM the day before through 9 AM that day.
  OVERNIGHT_START_HOUR: 17,  // 5 PM, previous day
  OVERNIGHT_END_HOUR: 9,     // 9 AM, "To" day
  // Working hours. The 10-minute first-contact clock only runs inside this
  // window, so a lead arriving at 6:58 PM isn't marked breached overnight —
  // it has 2 minutes of that evening plus 8 the next morning.
  WORK_START_HOUR: 9,   // 9 AM
  WORK_END_HOUR: 19,    // 7 PM
  // Universal grace period, measured from lead creation. Every check EXCEPT
  // the 10-minute first-contact rule stays silent until a lead is this old,
  // so RMs get time to work a fresh lead before anything is flagged.
  LEAD_GRACE_HOURS: 3,
  FOLLOWUP_REVIEW_HOURS: 4,
  GOOGLE_SOURCE_VALUE: 'google',
  FUNNEL_ORDER: ['not updated','suspect','opportunity','visit booked','visit','pipeline','gross eoi application','soft booking','booking'],
  // Real CRM stage text doesn't always match the canonical funnel name
  // exactly (e.g. "Booked" instead of "Booking"). Each canonical stage is
  // matched against any of these substrings, case-insensitive.
  // ORDER MATTERS: canonicalStage returns the FIRST FUNNEL_ORDER entry that
  // matches, and several stage names contain each other's words:
  //   "visit booked"  contains "visit" AND "booked"  -> must precede both
  //   "soft booking"  contains "booking"             -> must precede booking
  // A visit that is merely SCHEDULED must not count as a completed visit,
  // and a soft booking (payment in, papers pending) must not count as a
  // confirmed booking.
  STAGE_ALIASES: {
    'not updated': ['not updated'],
    'suspect': ['suspect'],
    'opportunity': ['opportunity'],
    'visit booked': ['visit booked', 'visit booking', 'visit scheduled'],
    // Revisit already matches on "visit"; hpop and video presentation don't,
    // so they need naming. All are the same funnel tier: the customer was
    // actually met, by whichever channel.
    'visit': ['visit', 'revisit', 'hpop', 'video presentation', 'video call'],
    'pipeline': ['pipeline'],
    'gross eoi application': ['gross eoi application', 'gross eoi', 'eoi application', 'eoi'],
    'soft booking': ['soft booking', 'soft book'],
    'booking': ['booking', 'booked'],
  },
  OPPORTUNITY_STAGE: 'opportunity',
  // SOP defines closure as Won / Lost / Junk / Not Interested. Split into
  // two lists because they need different matching:
  //   EXACT — must appear as a whole word (or full phrase). Keeps "won" from
  //           matching "won't" / "wondering", and "dead" from "deadline".
  //   STEMS — matched as a whole-word prefix, so "cancel" catches
  //           "Cancelled" / "Cancellation" without matching mid-word.
  // Check the stage breakdown after connecting — it shows exactly which of
  // your real stage values got matched here.
  CLOSED_STAGE_EXACT: ['won', 'lost', 'junk', 'dead', 'not interested'],
  CLOSED_STAGE_STEMS: ['cancel', 'close', 'reject'],
};

// Relocated here (from dashboard.html's "Issues CSV Export" section) because
// js/reports.js builds a derived lookup from this array at its OWN top level
// (see _FLAG_BY_ISSUE_PRIORITY_LABEL), which runs at script-load time — this
// has to be defined before that runs, and core.js is the one file guaranteed
// to load first. Read by the filter engine, Tracking, RM Timeline, Movement,
// Reports, and Sheets write-back.
//
// Ordered by priority: when a lead matches more than one check (e.g. both
// "Stuck" and "Behind on Today's Calls" are both legitimately true for the
// same old, under-called lead), each view needing one clear primary reason
// per lead picks the first match here. Dashboard sections themselves are
// unaffected — each still independently shows everything matching its own
// definition, since that's needed for real operational use.
//
// firstContactBreach ("Not Connected in 10 Minutes") is deliberately NOT in
// this list. It's a retrospective fact (first contact happened, just after
// the 10-minute window) that already happened and can't be corrected —
// unlike every other entry here, there is no follow-up action left to take
// on the LEAD itself. Letting it sit in this shared priority list meant it
// could outrank a genuinely still-actionable issue (e.g. Follow-up Overdue)
// for the same lead in the combined report, hiding the thing someone could
// actually still do something about, and it polluted "flagged"/"stalled"/
// "remediate" stats built for things that DO get remediated. It still has
// its own dedicated report — see ISSUE_REPORT_META.notConnected in
// reports.js — which reads as a reminder to the region's RH of which RMs
// missed the response-time SLA, not an action list.
const ISSUE_PRIORITY = [
  { key: 'inactiveRmNewLead', label: 'Inactive-RM Lead Added' },
  { key: 'isNotUpdated', label: 'Not Updated' },
  { key: 'followupOverdue', label: 'Follow-up Overdue (4h Post-Connect)' },
  { key: 'underCalledToday', label: "Behind on Today's Calls" },
  { key: 'stageStuck48h', label: 'Leads Pending Beyond 48 Hours (Not Yet Opportunity)' },
];

/* ========================= IST TIME CORE =========================
 * Every timestamp in the sheet is IST wall-clock (the SQL export was moved
 * from UTC to IST). Those components are converted to real instants HERE,
 * explicitly, rather than by handing them to `new Date(y, m, d, ...)` —
 * that constructor reads the BROWSER's timezone, so the same sheet produced
 * a different instant on a non-IST machine and every age, SLA and
 * business-hours figure silently shifted with it.
 *
 * Internally all dates are absolute instants. IST wall-clock appears only
 * at the two boundaries: reading the sheet, and printing to screen.
 */
const IST_OFFSET_MS = 330 * 60000;   // +05:30, no DST

// IST wall-clock components -> real instant. Overflowing values are fine:
// Date.UTC rolls day 32 into the next month, so istAddDays can lean on it.
function istWallToInstant(y, mo, d, h, mi, s){
  return new Date(Date.UTC(y, mo, d, h || 0, mi || 0, s || 0) - IST_OFFSET_MS);
}

// Real instant -> IST wall-clock parts.
function istParts(date){
  const t = new Date(date.getTime() + IST_OFFSET_MS);
  return {
    y: t.getUTCFullYear(), mo: t.getUTCMonth(), d: t.getUTCDate(),
    h: t.getUTCHours(), mi: t.getUTCMinutes(), s: t.getUTCSeconds(), dow: t.getUTCDay(),
  };
}

function istStartOfDay(date){
  const p = istParts(date);
  return istWallToInstant(p.y, p.mo, p.d, 0, 0, 0);
}

function istAddDays(date, n){
  const p = istParts(date);
  return istWallToInstant(p.y, p.mo, p.d + n, p.h, p.mi, p.s);
}

function istSameDay(a, b){
  if (!a || !b) return false;
  const pa = istParts(a), pb = istParts(b);
  return pa.y === pb.y && pa.mo === pb.mo && pa.d === pb.d;
}

// YYYY-MM-DD in IST — used for day bucketing, so a lead created at 11 PM IST
// lands on the IST day, not the UTC one.
function istDateKey(date){
  const p = istParts(date);
  return `${p.y}-${String(p.mo + 1).padStart(2, '0')}-${String(p.d).padStart(2, '0')}`;
}

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
  lead_created_at: ['lead_created_at','lead created at','created_at','created at','lead created','date created'],
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
  // combinedCommentsText/hasAnyCommentField's "internal comment" checks
  // (Closed with No Work Recorded, etc.): a lead auto-closed with only
  // these filled in and nothing logged in the four internal fields is
  // exactly the "no work recorded" case those checks exist to catch. Used
  // instead as the preferred label wherever the dashboard shows WHY a
  // lead closed (see computeStatusChanges, suggestedFollowUp).
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

/* ============ SIGN-IN GATE (access control) ============
 * Nothing loads until this succeeds. "spreadsheets" is a broad scope (read
 * AND write, needed anyway for the Movement snapshot feature below) but,
 * unlike gmail.send, it isn't Google's "restricted/sensitive" tier — it
 * doesn't need the extra verification review that's been blocking Gmail
 * sign-in. userinfo.email just lets the header show whose account is
 * signed in. The token this produces is reused directly as the Bearer
 * token for every Sheets API read/write in this file (sheetsApiValuesGet,
 * appendToMovementLog) — there's deliberately no separate "Connect Sheets"
 * step anymore.
 *
 * The actual access control isn't anything in this file — it's Google's:
 * a signed-in account that isn't shared on the sheet gets a 403 from the
 * Sheets API itself (see the ACCESS_DENIED handling in fetchAndRender's
 * catch block). Whoever owns the sheet controls who's let in via its own
 * Share dialog, same as any other Google Sheet.
 */
const GATE_SCOPE = 'https://www.googleapis.com/auth/spreadsheets https://www.googleapis.com/auth/userinfo.email';

let gateTokenClient = null;
let gateAccessToken = '';
let gateTokenExpiresAt = 0;
let gateUserEmail = '';
let _gateSignInResolvers = [];

function gateTokenValid(){
  return !!gateAccessToken && Date.now() < gateTokenExpiresAt - 5000;
}

function initGateTokenClient(clientId){
  if (typeof google === 'undefined' || !google.accounts || !google.accounts.oauth2) return null;
  return google.accounts.oauth2.initTokenClient({
    client_id: clientId,
    scope: GATE_SCOPE,
    callback: (resp) => {
      const statusEl = document.getElementById('authGateStatus');
      if (resp.error) {
        if (statusEl) { statusEl.textContent = 'Sign-in failed: ' + resp.error; statusEl.style.color = 'var(--red)'; }
        gateAccessToken = '';
      } else {
        gateAccessToken = resp.access_token;
        gateTokenExpiresAt = Date.now() + (Number(resp.expires_in) || 3600) * 1000;
      }
      const resolvers = _gateSignInResolvers;
      _gateSignInResolvers = [];
      resolvers.forEach(r => r());
    },
  });
}

async function fetchGateUserEmail(){
  try {
    const resp = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
      headers: { Authorization: `Bearer ${gateAccessToken}` },
    });
    if (resp.ok) {
      const data = await resp.json();
      gateUserEmail = data.email || '';
    }
  } catch (e) { /* non-fatal — badge just stays blank */ }
}

// Resolves once a sign-in attempt settles (success OR failure/cancel) —
// callers check gateTokenValid() afterward rather than trusting the
// resolution itself, so a closed popup just leaves the gate as it was.
// Only ever call this from a real click handler the first time; later
// silent re-calls (expired token mid-session) reuse prompt:'' so they
// don't need a fresh gesture.
function gateSignIn(){
  return new Promise((resolve) => {
    const clientIdRow = document.getElementById('authGateClientIdRow');
    const clientIdInput = document.getElementById('gateClientIdInput');
    const statusEl = document.getElementById('authGateStatus');

    let clientId = getGmailClientId(); // same Client ID field Gmail setup uses — one Cloud project
    if (clientIdRow && clientIdRow.style.display !== 'none' && clientIdInput && clientIdInput.value.trim()) {
      clientId = clientIdInput.value.trim();
      setGmailClientId(clientId);
    }
    if (!clientId) {
      if (clientIdRow) clientIdRow.style.display = 'block';
      if (statusEl) { statusEl.textContent = 'Paste your Google OAuth Client ID first (one-time setup), then sign in.'; statusEl.style.color = 'var(--amber)'; }
      resolve();
      return;
    }
    if (clientIdRow) clientIdRow.style.display = 'none';

    if (!gateTokenClient) gateTokenClient = initGateTokenClient(clientId);
    if (!gateTokenClient) {
      if (statusEl) { statusEl.textContent = 'Google Sign-In library still loading — try again in a moment.'; statusEl.style.color = 'var(--amber)'; }
      resolve();
      return;
    }
    if (statusEl) { statusEl.textContent = 'Opening Google sign-in…'; statusEl.style.color = 'var(--text-faint)'; }
    _gateSignInResolvers.push(resolve);
    gateTokenClient.requestAccessToken({ prompt: gateAccessToken ? '' : 'consent' });
  });
}

async function handleGateSignInClick(){
  await gateSignIn();
  if (!gateTokenValid()) return;
  await fetchGateUserEmail();
  document.getElementById('authGate').style.display = 'none';
  document.getElementById('appShell').style.display = '';
  const badge = document.getElementById('gateUserBadge');
  if (badge) badge.textContent = gateUserEmail ? `Signed in as ${gateUserEmail}` : '';
  const statusEl = document.getElementById('authGateStatus');
  if (statusEl) statusEl.textContent = '';
  fetchAndRender();
}

function initAuthGate(){
  const clientId = getGmailClientId();
  const row = document.getElementById('authGateClientIdRow');
  const input = document.getElementById('gateClientIdInput');
  if (row) row.style.display = clientId ? 'none' : 'block';
  if (input && clientId) input.value = clientId;
  const btn = document.getElementById('gateSignInBtn');
  if (btn) btn.addEventListener('click', handleGateSignInClick);
}

function showError(html){
  const box = document.getElementById('errorBox');
  box.innerHTML = html;
  box.style.display = 'block';
  document.getElementById('dashboardContent').style.display = 'none';
}
function hideError(){
  document.getElementById('errorBox').style.display = 'none';
}

function setPulse(live){
  document.getElementById('pulseDot').className = 'pulse' + (live ? ' live' : '');
}

async function fetchAndRender(){
  hideError();
  const rawId = document.getElementById('sheetIdInput').value;
  const tabName = document.getElementById('tabNameInput').value.trim();

  if (!rawId.trim() || !tabName){
    showError('<b>Missing info.</b> Paste your Google Sheet URL/ID and the month tab name above, then click Connect &amp; Refresh.');
    return;
  }

  // Covers the whole fetch/parse/render pass, not just the Refresh button —
  // a filter checkbox is a DIFFERENT element, so disabling only the button
  // (below) doesn't stop a click there from queuing up while this is still
  // reading/collating thousands of rows, which then fires the moment this
  // frees the main thread and stacks a second heavy pass on top.
  showLoadingOverlay('Loading your sheet…');

  // A manual Refresh click can land after the gate token has expired
  // (~1h) — that click is itself a real user gesture, so it's safe to use
  // to silently re-request a token before reading, rather than bouncing
  // the person back to the gate screen.
  if (!gateTokenValid()) {
    await gateSignIn();
    if (!gateTokenValid()) return; // sign-in failed/cancelled — status is already shown on the gate
  }

  const sheetId = extractSheetId(rawId);

  const btn = document.getElementById('refreshBtn');
  btn.disabled = true;
  btn.textContent = 'Refreshing…';
  setPulse(false);

  try {
    let values;
    try {
      // Was A2:Z (26 columns) — the sheet now has 28 (region..duration,
      // with call_count/duration landing in columns AA/AB), so that range
      // silently dropped the last two columns entirely rather than just
      // misreading them: they never appeared in the fetched values at all,
      // which is why they showed as "unmatched" instead of merely blank.
      // Widened with real headroom past the current column count, same
      // reasoning as Movement_Log's own A1:Z range for future additions.
      values = await sheetsApiValuesGet(sheetId, `${tabName}!A2:AZ`);
    } catch (err) {
      if (err.status === 403) throw new Error('ACCESS_DENIED');
      if (err.status === 404) throw new Error('NOT_FOUND');
      if (err.status === 400) throw new Error('BAD_RANGE');
      throw err;
    }

    const isDateColLabel = (label) =>
      HEADER_ALIASES.lead_created_at.indexOf(label) !== -1 || HEADER_ALIASES.last_connect_time.indexOf(label) !== -1;
    const table = valuesToGvizShape(values, isDateColLabel);
    const cols = table.cols;
    const dataRowsRaw = table.rows.map(r => r.c || []);

    if (!cols.length || !dataRowsRaw.length) {
      throw new Error('EMPTY');
    }

    const colIndex = {};
    Object.keys(HEADER_ALIASES).forEach(key => {
      const aliases = HEADER_ALIASES[key];
      let idx = -1;
      cols.forEach((col, i) => {
        if (idx !== -1) return;
        const label = String(col.label || '').trim().toLowerCase();
        if (aliases.indexOf(label) !== -1) idx = i;
      });
      colIndex[key] = idx;
    });

    if (colIndex.lead_id === -1) {
      // The lead_id header cell is sometimes blank even though the data
      // beneath it is real lead IDs — it's reliably the first column, so
      // fall back to that position instead of requiring the label text.
      colIndex.lead_id = 0;
    }

    if (colIndex.group_source === -1) {
      const err = new Error('HEADERS');
      err.headerPreview = cols.map(c => c.label || '');
      err.rowCount = dataRowsRaw.length;
      throw err;
    }

    // Every other column silently resolves to -1 if its header text didn't
    // match — no error is thrown, so a mismatch here quietly zeroes out
    // whatever downstream feature depends on it with no visible symptom.
    // Surface this explicitly instead of letting it fail silently.
    const columnMapEl = document.getElementById('columnMapWarning');
    if (columnMapEl) {
      const unmatched = Object.keys(colIndex).filter(k => colIndex[k] === -1);
      if (unmatched.length) {
        const headerPreview = cols.map((c, i) => `${i}:"${c.label || ''}"`).join('  ');
        columnMapEl.style.display = 'block';
        columnMapEl.innerHTML = `<b>Heads up:</b> these columns didn't match any expected header and will read as blank/zero everywhere: <b>${unmatched.map(esc).join(', ')}</b>. This silently breaks anything that depends on them (dates, stages, comments) without throwing a visible error.<br><span class="mono" style="font-size:11px; word-break:break-all;">Row read as: ${esc(headerPreview)}</span>`;
      } else {
        columnMapEl.style.display = 'none';
      }
    }

    _accessedHeaderKeys = new Set();
    const getVal = (cellsArr, key) => {
      _accessedHeaderKeys.add(key);
      const idx = colIndex[key];
      if (idx === -1 || idx == null) return '';
      return gvizCellRaw(cellsArr[idx]);
    };
    const getDate = (cellsArr, key) => {
      _accessedHeaderKeys.add(key);
      const idx = colIndex[key];
      if (idx === -1 || idx == null) return null;
      return gvizCellDate(cellsArr[idx]);
    };

    const parsedLeads = dataRowsRaw
      .filter(c => String(gvizCellRaw(c[colIndex.lead_id])).trim() !== '')
      .map(c => {
        const createdDate = getDate(c, 'lead_created_at');
        const connectDate = getDate(c, 'last_connect_time');
        return {
          lead_id: getVal(c, 'lead_id'),
          RM: getVal(c, 'RM') || 'Unassigned',
          TL: getVal(c, 'TL') || '',
          rm_is_active: getVal(c, 'rm_is_active') || '',
          project: getVal(c, 'project') || '',
          region: getVal(c, 'region') || 'Unassigned',
          project_region: getVal(c, 'project_region') || '',
          client: getVal(c, 'client') || '',
          lead_created_at: createdDate ? createdDate.toISOString() : getVal(c, 'lead_created_at'),
          group_source: getVal(c, 'group_source'),
          source_bucket: getVal(c, 'source_bucket') || '',
          current_stage: getVal(c, 'current_stage'),
          last_connect: getVal(c, 'last_connect') || '',
          last_connect_time: connectDate ? connectDate.toISOString() : getVal(c, 'last_connect_time'),
          last_comment: getVal(c, 'last_comment') || '',
          internal_status_comments: getVal(c, 'internal_status_comments') || '',
          stage_comments: getVal(c, 'stage_comments') || '',
          client_id: getVal(c, 'client_id') || '',
          // SOP effort is measured in ATTEMPTS. Fall back to call_count only
          // when the column is genuinely ABSENT (checked via colIndex, not
          // via the value) — `||` on the parsed number couldn't tell a real
          // 0 call_attempts apart from a missing column, so a lead that was
          // legitimately never dialed had its 0 silently overwritten by
          // whatever call_count happened to hold.
          call_attempts: colIndex.call_attempts !== -1 ? (Number(getVal(c, 'call_attempts')) || 0) : (Number(getVal(c, 'call_count')) || 0),
          call_count: Number(getVal(c, 'call_count')) || 0,
          duration: Number(getVal(c, 'duration')) || 0,
          closing_reason: getVal(c, 'closing_reason') || '',
          lead_closing_reason: getVal(c, 'lead_closing_reason') || '',
          lead_closing_comment: getVal(c, 'lead_closing_comment') || '',
        };
      });

    // Resilience check: any HEADER_ALIASES key no getVal/getDate call site
    // ever touched is dead — the exact condition that caused a false
    // "unmatched header" warning for region_parent/stage_comments before
    // they were removed (see the comment on HEADER_ALIASES). Skipped when
    // there's no data to have exercised the call sites against.
    if (parsedLeads.length) {
      const deadAliasKeys = Object.keys(HEADER_ALIASES).filter(k => !_accessedHeaderKeys.has(k));
      if (deadAliasKeys.length) {
        console.warn(
          `HEADER_ALIASES has ${deadAliasKeys.length} entr${deadAliasKeys.length === 1 ? 'y' : 'ies'} ` +
          `nothing reads: ${deadAliasKeys.join(', ')}. Each produces a false "unmatched header" warning ` +
          `if its column is ever renamed — either add a real getVal()/getDate() call for it, or remove it.`
        );
      }
    }

    // ---------------------------------------------------------------
    // FOUNDATION STEP: COLLATE, DON'T DEDUPLICATE.
    //
    // When a lead arrives it is pushed to SEVERAL RMs at once; whoever
    // claims it keeps it. So one real customer can appear as several rows,
    // sharing a client_id but not necessarily a lead_id. Dropping the
    // "duplicates" threw away real work — the unclaimed copies still hold
    // call attempts and comments made before someone claimed it.
    //
    // Instead each customer becomes ONE record:
    //   comments   -> merged from every copy, de-duplicated, chronological
    //   attempts   -> summed across copies (total effort on that customer)
    //   duration   -> summed likewise
    //   stage      -> HIGHEST point reached in the funnel by any copy.
    //                 This matters because unclaimed copies are typically
    //                 marked cancelled/junk, so taking the "latest" row
    //                 would report a live lead as closed.
    //   identity   -> the copy that reached that highest stage, tie-broken
    //                 by most recent activity — i.e. whoever actually owns it
    // ---------------------------------------------------------------
    const activityTimeOf = (l) => {
      const d = parseDate(l.last_connect_time) || parseDate(l.lead_created_at);
      return d ? d.getTime() : null;
    };
    // Funnel rank: open stages rank above any closed stage, so a claimed
    // copy always outranks the copies that were closed off unclaimed.
    // "Closed" here matches enrichLead's own definition exactly — stage
    // text OR a filled closing_reason — not just canonicalStage. Checking
    // stage text alone let a copy that's genuinely closed (closing_reason
    // filled) but left sitting on stale open-looking stage text (e.g. the
    // CRM never touched current_stage before closing it) outrank a
    // DIFFERENT RM's copy that's actually still open, so the whole
    // customer read as closed even though someone else still had it live.
    // A collated lead should only read as closed when every copy really is.
    // Closed and "open but unrecognised stage text" must NOT share a rank:
    // they used to both return -1, so an open copy with stage text outside
    // CONFIG.STAGE_ALIASES could tie with a genuinely closed copy and lose
    // the tiebreak (activityTimeOf) to it — a more-recently-touched CLOSED
    // copy could then win primary, making the whole merged customer read as
    // closed even though the open copy was real and unworked.
    const funnelRankOf = (l) => {
      if (isLeadClosed(l)) return -2;
      const canon = canonicalStage(l.current_stage);
      if (canon) return CONFIG.FUNNEL_ORDER.indexOf(canon);
      return -1; // unrecognised stage text
    };

    // Identity match: two rows collate together if they share the SAME
    // lead_id OR the SAME client_id — checked independently, not client_id
    // with lead_id only as a fallback for when it's blank. Dirty/
    // inconsistent tagging across RM copies means the "same customer"
    // signal can come from either column, and matches can chain — row A
    // shares a client_id with row B, row B shares a lead_id with row C —
    // so a simple single-field groupBy would miss that A and C are the
    // same customer too. Union-Find merges every row transitively
    // connected by either key into one group, however many hops apart.
    const _ufParent = parsedLeads.map((_, i) => i);
    function _ufFind(x){
      while (_ufParent[x] !== x) { _ufParent[x] = _ufParent[_ufParent[x]]; x = _ufParent[x]; }
      return x;
    }
    function _ufUnion(a, b){
      const ra = _ufFind(a), rb = _ufFind(b);
      if (ra !== rb) _ufParent[ra] = rb;
    }
    const _firstIndexByKey = new Map();
    parsedLeads.forEach((l, i) => {
      const leadKey = 'lead:' + String(l.lead_id).trim();
      const cid = String(l.client_id || '').trim();
      const clientKey = cid ? 'client:' + cid : null;
      [leadKey, clientKey].forEach(key => {
        if (!key) return;
        if (_firstIndexByKey.has(key)) _ufUnion(i, _firstIndexByKey.get(key));
        else _firstIndexByKey.set(key, i);
      });
    });

    const groupMap = new Map();
    parsedLeads.forEach((l, i) => {
      const key = _ufFind(i);
      if (!groupMap.has(key)) groupMap.set(key, []);
      groupMap.get(key).push(l);
    });

    let collatedGroups = 0, extraCopies = 0, crossRegionGroups = 0;
    _lastCrossRegionCollations = [];

    // Region each row would resolve to on its own — same effectiveRegion +
    // mainRegionFor path everything else uses, so this reflects exactly
    // what the Region filter/report grouping would show for that row.
    const rowRegionLabel = (r) => mainRegionFor(effectiveRegion(r)) || String(r.region || '').trim() || '(blank)';

    // Merges a set of same-customer rows into ONE lead-shaped record: stage
    // taken from whichever copy went furthest (ties broken by most recent
    // activity), comments merged/deduped/re-sorted, attempts/calls/duration
    // summed, earliest creation kept. Factored out so it can run both across
    // ALL of a customer's rows (the general-purpose `merged` record below)
    // and on a single row by itself (copySplits below — a "merge" of one
    // row is just that row, stamped with the same collatedFrom/IDs/RMs
    // shape every other record carries).
    function mergeRowsIntoOneLead(rows){
      if (rows.length === 1) {
        return Object.assign({}, rows[0], {
          collatedFrom: 1,
          collatedRMs: [rows[0].RM || 'Unassigned'],
          collatedLeadIds: [String(rows[0].lead_id).trim()],
          collatedRegions: [rowRegionLabel(rows[0])],
        });
      }

      const primary = rows.slice().sort((a, b) => {
        const fr = funnelRankOf(b) - funnelRankOf(a);
        if (fr !== 0) return fr;
        return (activityTimeOf(b) || 0) - (activityTimeOf(a) || 0);
      })[0];

      // Dedupe/sort a "Name: Comment - YYYY-MM-DD HH:MM | ..." field across
      // every copy — same treatment for internal_status_comments and
      // stage_comments below, since a customer's comment history should
      // read as one merged timeline regardless of which RM copy (or which
      // of the two comment columns) it was logged under.
      const tsOf = (entry) => {
        const m = entry.match(/(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2})\s*$/);
        const d = m ? parseDate(m[1]) : null;
        return d ? d.getTime() : 0;
      };
      const mergeCommentField = (fieldName) => {
        const seen = new Set();
        const out = [];
        rows.forEach(r => {
          String(r[fieldName] || '').split('|').forEach(part => {
            const t = part.trim();
            if (!t || seen.has(t)) return;
            seen.add(t);
            out.push(t);
          });
        });
        out.sort((a, b) => tsOf(a) - tsOf(b));
        return out.join(' | ');
      };
      const mergedComments = mergeCommentField('internal_status_comments');
      const mergedStageComments = mergeCommentField('stage_comments');

      const latestConnect = rows
        .map(r => parseDate(r.last_connect_time))
        .filter(Boolean)
        .sort((a, b) => b - a)[0] || null;

      // call_attempts/call_count/duration are tracked per CLIENT ID by the
      // phone system, not accumulated per RM copy — every copy of the same
      // customer reports the SAME cumulative client-level figure, not a
      // partial contribution. Summing across copies multiplied it by the
      // copy count instead (3 copies each reporting 36 attempts read as
      // 108). Max takes it "as a whole" for the customer, matching
      // whichever copy's snapshot happens to be most complete, without
      // the multiplication.
      // collatedFrom counts DISTINCT lead_ids, not raw rows.length — two
      // rows unioned together (by shared client_id or lead_id) aren't
      // necessarily two different RM copies. A literal duplicate row (the
      // same lead_id appearing twice — a blank lead_id colliding with
      // another blank one is the common case) unions in exactly the same
      // way a genuine second copy would, but it's one customer's one copy
      // read twice, not "multiple RM copies". Every "cloned"/"collated"
      // count and badge in the app reads collatedFrom expecting it to mean
      // distinct copies (see e.g. collationBadge, countCollatedAmong), so
      // it has to actually measure that, not just row multiplicity.
      const distinctLeadIds = Array.from(new Set(rows.map(r => String(r.lead_id).trim())));
      return Object.assign({}, primary, {
        internal_status_comments: mergedComments,
        stage_comments: mergedStageComments,
        call_attempts: Math.max(0, ...rows.map(r => Number(r.call_attempts) || 0)),
        call_count:    Math.max(0, ...rows.map(r => Number(r.call_count) || 0)),
        duration:      Math.max(0, ...rows.map(r => Number(r.duration) || 0)),
        last_connect_time: latestConnect ? latestConnect.toISOString() : primary.last_connect_time,
        // Earliest creation across copies — the moment the customer actually
        // came in, not when a particular RM's copy was generated.
        lead_created_at: rows
          .map(r => parseDate(r.lead_created_at))
          .filter(Boolean)
          .sort((a, b) => a - b)[0]?.toISOString() || primary.lead_created_at,
        collatedFrom: distinctLeadIds.length,
        collatedRMs: Array.from(new Set(rows.map(r => r.RM).filter(Boolean))),
        collatedLeadIds: distinctLeadIds,
        collatedRegions: Array.from(new Set(rows.map(rowRegionLabel))),
      });
    }

    const dedupedLeads = Array.from(groupMap.values()).map(rows => {
      const merged = mergeRowsIntoOneLead(rows);
      if (rows.length === 1) return merged;

      // Tallied here, before the distinct-copy gate below, so "X customers
      // from Y rows read, absorbing Z extra rows" stays arithmetically
      // true regardless of WHY a group had more than one row — a literal
      // duplicate row is still one fewer row than customers, same as a
      // genuine second RM copy is.
      extraCopies += rows.length - 1;

      // A group can have more raw rows than distinct lead_ids (see
      // collatedFrom's own comment in mergeRowsIntoOneLead) — that's still
      // correctly absorbed above, but it isn't "multiple RM copies", so it
      // shouldn't inflate the headline count, the cross-region check, or
      // copySplits (which would otherwise hand issue-detection two
      // identical-lead_id entries for what's really one copy read twice).
      if (merged.collatedLeadIds.length <= 1) return merged;

      collatedGroups++;

      // Merged customers whose copies don't all resolve to the SAME region —
      // this is what makes a Pune-tagged row surface on a card that reads
      // "Thane": the merge picks ONE copy as primary (furthest funnel /
      // most recent) and that copy's region wins, silently absorbing a
      // same-client_id (or same-lead_id) copy from a different region.
      // Sometimes that's correct (one customer, two genuine inquiries in
      // different regions) and sometimes it's a data problem (a shared/
      // placeholder client_id, or a reused lead_id, gluing two unrelated
      // customers together) — either way it's surfaced explicitly via
      // collatedRegions/crossRegionCollations.
      if (merged.collatedRegions.length > 1) {
        crossRegionGroups++;
        _lastCrossRegionCollations.push({
          leadIds: Array.from(new Set(rows.map(r => String(r.lead_id).trim()))),
          clientIds: Array.from(new Set(rows.map(r => String(r.client_id || '').trim()).filter(Boolean))),
          regions: merged.collatedRegions,
          rms: Array.from(new Set(rows.map(r => r.RM).filter(Boolean))),
        });
      }

      // copySplits: one independent, single-copy record per ORIGINAL row —
      // used ONLY for issue detection/reporting (the 5 SLA checks, their
      // sections/emails, Stalled Leads, Overnight Leads). X being
      // closed shouldn't hide Y's Not Updated issue; Z's own call count
      // shouldn't get credited from Y's calls; two RMs both stalled on
      // "Not Updated" are two separate instances, not one. `merged` above
      // (summed calls, comments merged, stage from whichever copy went
      // furthest) is untouched and stays the source of truth for the Total
      // Leads count, Distribution tab, RM Scorecard, and every other
      // non-issue view — those still want "one customer, one card". Each
      // split carries the OTHER copies' lead_id/RM as a lightweight
      // sibling reference (siblingLeadIds/siblingRMs) purely for context;
      // its own issue flags come only from its own data.
      // One row per distinct lead_id first — a genuinely-cloned group can
      // still contain a literal duplicate of one of its copies (the same
      // lead_id logged twice alongside a real second RM's copy), and that
      // duplicate is the same copy read twice, not a third copy. Without
      // this, it would get its own split (double-counting that RM's
      // issues) and would list itself as its own sibling.
      const distinctRows = [];
      const seenSplitIds = new Set();
      rows.forEach(r => {
        const id = String(r.lead_id).trim();
        if (seenSplitIds.has(id)) return;
        seenSplitIds.add(id);
        distinctRows.push(r);
      });
      merged.copySplits = distinctRows.map(row => {
        const split = mergeRowsIntoOneLead([row]);
        const siblings = distinctRows.filter(r => r !== row);
        split.siblingLeadIds = siblings.map(r => String(r.lead_id).trim());
        split.siblingRMs = Array.from(new Set(siblings.map(r => r.RM).filter(Boolean)));
        // Every sibling's own four comment columns, carried alongside the
        // lightweight id/RM references above — suggestedFollowUp reads
        // this to assess a customer's next step from the FULL picture
        // across every RM who's touched them, not just this one copy's
        // own (possibly empty) comment fields.
        split.siblingComments = siblings.map(r => ({
          lead_id: r.lead_id, RM: r.RM,
          internal_status_comments: r.internal_status_comments,
          stage_comments: r.stage_comments,
          last_comment: r.last_comment,
          closing_reason: r.closing_reason,
          lead_closing_reason: r.lead_closing_reason,
          lead_closing_comment: r.lead_closing_comment,
        }));
        return split;
      });

      return merged;
    });

    const dedupeEl = document.getElementById('dedupeNotice');
    if (dedupeEl) {
      if (collatedGroups > 0) {
        dedupeEl.style.display = 'block';
        // One-line summary always visible; the full explanation (what got
        // merged/summed, and the cross-region caveat) sits behind a click
        // instead of running as a paragraph above the fold on every load.
        const crossRegionBit = crossRegionGroups > 0
          ? ` · <b style="color:var(--red)">${crossRegionGroups.toLocaleString()}</b> span multiple regions`
          : '';
        const summary = `<b>${collatedGroups.toLocaleString()}</b> customer${collatedGroups === 1 ? '' : 's'} had multiple RM copies, merged${crossRegionBit}`;
        const detail = `Comments combined, calls and duration summed, stage taken from whichever copy went furthest. `
          + `${dedupedLeads.length.toLocaleString()} customers from ${parsedLeads.length.toLocaleString()} rows read, absorbing ${extraCopies.toLocaleString()} extra row${extraCopies === 1 ? '' : 's'}.`
          + (crossRegionGroups > 0
            ? ` ${crossRegionGroups.toLocaleString()} of those merges span more than one region (e.g. a Pune copy and a Thane copy sharing a lead_id or client_id) — the merged card can only display one, so the others get absorbed. Flagged with a red "Regions:" chip on affected cards; full detail in the console as <span class="mono">_lastCrossRegionCollations</span>.`
            : '');
        dedupeEl.innerHTML = `<div>${summary} `
          + `<button type="button" class="info-toggle" style="display:inline; padding:0;" data-label="ⓘ Details" onclick="toggleInlineDetail(this)">ⓘ Details</button></div>`
          + `<div class="filter-summary" style="display:none; margin:6px 0 0;">${detail}</div>`;
        // The UI text above promises "full detail in the console" — print
        // it here rather than leaving that as a hint someone has to know
        // to act on (typing the bare variable name into devtools) after
        // reading past a collapsed detail panel.
        if (crossRegionGroups > 0) console.table(_lastCrossRegionCollations);
      } else {
        dedupeEl.style.display = 'none';
      }
    }

    const sourceCounts = {};
    dedupedLeads.forEach(l => {
      const key = String(l.group_source).trim() || '(blank)';
      if (!sourceCounts[key]) sourceCounts[key] = { n: 0, collated: 0 };
      sourceCounts[key].n++;
      if ((l.collatedFrom || 1) > 1) sourceCounts[key].collated++;
    });
    renderSourceBreakdown(sourceCounts, dedupedLeads);

    _actionLogCache.clear(); // fresh data — drop cached parses of old comment blobs
    allParsedLeads = dedupedLeads;

    buildFilterUI();
    applyFiltersAndRender();
    _currentSheetId = sheetId; // must be set before snapshotSlaHistory — it writes to SLA_History via this
    snapshotSlaHistory();
    // Best-effort, non-blocking: Movement_Log is a separate tab a helper
    // script writes to, and might not exist yet (setup not done) or the
    // caller might have no data in it yet. Either way the main dashboard
    // must not wait on or fail because of this second fetch.
    fetchMovementLog(sheetId).then(() => {
      populateMovementSnapshotSelectors();
      // Behind on Today's Calls' attemptsToday depends on Movement_Log for
      // a real day-over-day call_attempts delta (see buildTodayCallBaseline)
      // — on first load this fetch resolves AFTER the initial
      // applyFiltersAndRender() already ran with no snapshot data at all,
      // so Operations needs a fresh pass now that a baseline actually
      // exists. This also re-renders the Movement tab itself, so no
      // separate renderMovementTab() call is needed here.
      applyFiltersAndRender();
      // The sign-in gate already holds a live Sheets write token by the
      // time any data has loaded, so this can fire straight away.
      if (autoSnapshotEnabled()) browserSnapshotOpenLeads();
    });

    document.getElementById('configPanel').style.display = 'none';
    document.getElementById('changeSourceBtn').style.display = 'inline-block';
    document.getElementById('dashboardContent').style.display = 'block';
    document.getElementById('filterBar').style.display = 'flex';
    const now = new Date();
    document.getElementById('lastRefreshed').textContent =
      'Last refreshed: ' + istStamp(now);
    setPulse(true);

  } catch (err) {
    setPulse(false);
    if (err.message === 'ACCESS_DENIED') {
      showError(`<b>Access denied.</b> ${esc(gateUserEmail || 'Your signed-in Google account')} isn't shared on this sheet. Ask the sheet owner to add you under <b>Share</b> (Viewer is enough to read; Editor if you'll also take Movement snapshots), then click Refresh.`);
    } else if (err.message === 'NOT_FOUND') {
      showError(`<b>Can't find this sheet.</b> Double-check the Sheet ID/URL is correct.`);
    } else if (err.message === 'BAD_RANGE') {
      showError(`<b>Couldn't read that tab.</b> Check the tab name ("${esc(tabName)}") is spelled exactly as it appears at the bottom of your sheet (case-sensitive).`);
    } else if (err.message === 'EMPTY') {
      showError(`<b>No data found.</b> Check the tab name ("${esc(tabName)}") is spelled exactly as it appears at the bottom of your sheet (case-sensitive), and that row 2 has your headers.`);
    } else if (err.message === 'HEADERS') {
      const preview = err.headerPreview ? err.headerPreview.map((h,i) => `${i}:"${h}"`).join('  ') : '(none)';
      showError(`<b>Couldn't match expected columns.</b> Here's exactly what row 2 was read as (index:value): <div class="mono" style="margin-top:8px; word-break:break-all; color:var(--text-dim);">${esc(preview)}</div><div style="margin-top:8px;">Total sheet rows seen: ${err.rowCount}. Send this back and I can pinpoint the fix.</div>`);
    } else {
      showError(`<b>Couldn't reach the sheet.</b> ${esc(err.message)}. Double check the Sheet ID/URL and the tab name, then try again.`);
    }
  } finally {
    btn.disabled = false;
    btn.textContent = 'Refresh';
    hideLoadingOverlay();
  }
}

// Counts only the minutes that fall inside the working-hours window
// (WORK_START_HOUR–WORK_END_HOUR), walking day by day so overnight and
// multi-day gaps are handled correctly. A lead created at 6:58 PM has
// accrued 2 working minutes by 7:00 PM, then resumes at 9:00 AM.
function businessMinutesBetween(start, end){
  if (!start || !end || end <= start) return 0;
  const startH = CONFIG.WORK_START_HOUR;
  const endH = CONFIG.WORK_END_HOUR;
  let totalMs = 0;
  let cursor = new Date(start);

  // Day boundaries are IST ones. Using setHours() here read the browser's
  // zone, so "9 AM" meant 9 AM wherever the viewer happened to be.
  while (cursor < end) {
    const p = istParts(cursor);
    const dayOpen = istWallToInstant(p.y, p.mo, p.d, startH, 0, 0);
    const dayClose = istWallToInstant(p.y, p.mo, p.d, endH, 0, 0);

    const segStart = cursor > dayOpen ? cursor : dayOpen;
    const segEnd = end < dayClose ? end : dayClose;
    if (segEnd > segStart) totalMs += (segEnd - segStart);

    cursor = istWallToInstant(p.y, p.mo, p.d + 1, 0, 0, 0);
  }
  return totalMs / 60000;
}

function parseDate(v){
  if (!v) return null;
  if (v instanceof Date) return isNaN(v.getTime()) ? null : v;
  const s = String(v).trim();
  if (!s) return null;

  // "2026-08-13 10:18:05" / "2026-08-13T10:18" carry no timezone. That is the
  // sheet's and the comment log's own format, and it is IST — handing it to
  // `new Date()` would resolve it in the browser's zone instead.
  const dt = s.match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?$/);
  if (dt) return istWallToInstant(+dt[1], +dt[2] - 1, +dt[3], +dt[4], +dt[5], +(dt[6] || 0));

  const d0 = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (d0) return istWallToInstant(+d0[1], +d0[2] - 1, +d0[3], 0, 0, 0);

  // Anything with an explicit zone (trailing Z, +05:30) is already absolute —
  // this is the path our own toISOString() round-trip takes, so it must NOT
  // be shifted again.
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

function canonicalStage(stage){
  const s = String(stage).trim().toLowerCase();
  if (!s) return null;
  for (const canon of CONFIG.FUNNEL_ORDER) {
    const aliases = CONFIG.STAGE_ALIASES[canon] || [canon];
    if (aliases.some(a => s === a || s.indexOf(a) !== -1)) return canon;
  }
  return null;
}

function isOppOrAbove(stage){
  const canon = canonicalStage(stage);
  if (!canon) return false;
  const idx = CONFIG.FUNNEL_ORDER.indexOf(canon);
  const oppIdx = CONFIG.FUNNEL_ORDER.indexOf(CONFIG.OPPORTUNITY_STAGE);
  return idx >= oppIdx;
}

// A booking is a booking whether or not the record was subsequently closed —
// closing a won deal shouldn't erase it from the conversion numbers. This is
// deliberately NOT gated on isOpenLead/excluded anywhere it's used.
// It also reads closing_reason, because a CRM that overwrites current_stage
// with the closure word ("Won") otherwise loses the booking entirely:
// canonicalStage("Won") is null, so such a lead would count in no stage at
// all — not even Opportunity+.
function isBookingLead(l){
  if (canonicalStage(l.current_stage) === 'booking') return true;
  const reason = String(l.lead_closing_reason || l.closing_reason || '').trim().toLowerCase();
  if (!reason) return false;
  // Exact band equality, so neither "visit booked" nor "soft booking" — both
  // of which contain booking words — can leak into the confirmed count.
  return canonicalStage(reason) === 'booking';
}

// Payment received, paperwork pending. Counted separately from a confirmed
// booking: it is real commercial progress, but it is not revenue booked.
function isSoftBookingLead(l){
  if (canonicalStage(l.current_stage) === 'soft booking') return true;
  const reason = String(l.lead_closing_reason || l.closing_reason || '').trim().toLowerCase();
  if (!reason) return false;
  return canonicalStage(reason) === 'soft booking';
}

function isClosedStage(stage){
  const s = String(stage).trim().toLowerCase();
  if (!s) return false;

  // Split the stage text into words, treating an apostrophe as part of the
  // word so "won't" stays one token and never matches the word "won".
  // (A plain \b regex does NOT do this — \b treats the apostrophe as a
  // boundary, so /\bwon\b/ happily matches inside "won't".)
  const words = s.split(/[^a-z']+/).filter(Boolean);

  // Exact match: single-word keywords must BE one of the words; multi-word
  // phrases are matched against the full string.
  const exactHit = CONFIG.CLOSED_STAGE_EXACT.some(kw =>
    kw.indexOf(' ') !== -1 ? s.includes(kw) : words.includes(kw)
  );
  if (exactHit) return true;

  // Stem match — the keyword is a prefix of a whole word, so "cancel"
  // still catches "Cancelled"/"Cancellation" without matching mid-word.
  return CONFIG.CLOSED_STAGE_STEMS.some(stem => words.some(w => w.startsWith(stem)));
}

// Single source of truth for "is this lead closed" — stage text OR a
// filled closing_reason (RM-entered) OR lead_closing_reason (the sheet's
// own closing disposition). Previously hand-duplicated verbatim across
// funnelRankOf, enrichLead, computeStatusChanges, overnightStatusLabel, and
// buildOvernightRegionReports, each site's own comment separately swearing
// it "matches enrichLead's own definition exactly" — a future change to
// what counts as closed had to be hunted down and edited in every one of
// those, and missing one would silently desync it from the others. Mirror
// any change here into MovementTracker.gs's isOpenLead_ too (see its
// comment) — that runtime can't share this function directly.
function isLeadClosed(l){
  return isClosedStage(l.current_stage) || !!String(l.closing_reason || '').trim() || !!String(l.lead_closing_reason || '').trim();
}

// All leads in a single render should be evaluated against ONE timestamp.
// Calling new Date() per lead let "now" drift across the loop, so a lead
// near the end of a long list was measured against a slightly later clock
// than one at the start — enough to flip a borderline 10-minute or 48-hour
// check inconsistently within the same view. Set once per render pass.
let _renderNow = new Date();

// customer-key -> call_attempts as of the most recent Movement_Log
// snapshot captured before today (IST) started — the baseline
// attemptsToday subtracts from a lead's current call_attempts to get a
// REAL count of today's calls, instead of guessing from CRM comments.
// Rebuilt once per applyFiltersAndRender() pass (see buildTodayCallBaseline
// there); enrichLead only ever reads it, never rebuilds it, so enriching
// many leads/copySplits in one pass stays cheap.
let _todayCallBaselineByKey = new Map();
// True only while enrichLeadAsOf is enriching a PAST Movement_Log snapshot
// (RM stall leaderboard, time-to-remediate) — attemptsToday falls back to
// the CRM-comment proxy in that case; see enrichLeadAsOf for why.
let _enrichingHistorical = false;

function enrichLead(l){
  const now = _renderNow;
  const created = parseDate(l.lead_created_at);

  // Foundation: is this lead closed? Everything below only ever applies to
  // leads where this is false. No alert/SLA check in this file should ever
  // fire for a closed lead — this is computed first and gates every other
  // flag directly, not as an afterthought filter layered on top.
  // A lead is closed if its stage says so, or if EITHER closing_reason
  // (RM-entered) or lead_closing_reason (the sheet's own closing
  // disposition) is filled. This matters because the CRM can leave
  // current_stage sitting at "Not Updated" on a lead that was actually
  // resolved — without this, those get flagged as issues forever despite
  // being finished. A lead closed via lead_closing_reason alone (the newer
  // field, with the older closing_reason left blank) needs the same
  // treatment, or it would read as still open and get flagged for every
  // SLA issue in the dashboard despite genuinely being done.
  const hasClosingReason = !!String(l.closing_reason || '').trim() || !!String(l.lead_closing_reason || '').trim();
  const excluded = isLeadClosed(l);
  const oppOrAbove = isOppOrAbove(l.current_stage);
  const isOpenLead = !excluded && !oppOrAbove; // "open" = not closed, not already at Opportunity+

  const ageHours = created ? (now - created) / 36e5 : null;
  const past48h = isOpenLead && ageHours !== null && ageHours > CONFIG.LEAD_LIFECYCLE_HOURS;

  // Every check below EXCEPT the two explicitly-48h+ ones is scoped to
  // leads still inside the 48-hour lifecycle. Past that point the 48h+
  // cards take over as the relevant signal, so older leads shouldn't also
  // be cluttering the fresh-lead checks.
  const isUnder48h = ageHours !== null && ageHours <= CONFIG.LEAD_LIFECYCLE_HOURS;

  // New Today: created today AND in the system at least 3 hours, so a lead
  // that just arrived isn't immediately flagged for not having 5 calls yet.
  const isCreatedToday = istSameDay(created, now);   // IST calendar day, not the browser's
  // Grace period from lead creation. Applies to every check below EXCEPT
  // the 10-minute first-contact rule (firstContactBreach and its
  // neverConnectedPastWindow counterpart below) — that rule is precisely
  // the one that must fire inside this window, since it exists to catch
  // leads nobody has touched at all.
  const pastGrace = ageHours !== null && ageHours >= CONFIG.LEAD_GRACE_HOURS;

  // Connection signal, hoisted up from Rule 4 below — Rule 1 needs it too
  // now: "connected" (last_connect / last_connect_time) is a stronger
  // signal than call_attempts, which only proves a dial was placed, not
  // that the customer actually picked up.
  const hasConnected = !!(String(l.last_connect || '').trim() || parseDate(l.last_connect_time));
  const connectDate = parseDate(l.last_connect_time);

  // Rule 1: first contact within 10 minutes of assignment — measured in
  // WORKING minutes only, so time outside 9 AM–7 PM doesn't count against
  // the RM. Two distinct outcomes, deliberately kept apart:
  //   - Connected, but only after the 10-minute window had already
  //     passed: flagged HERE as a retrospective SLA miss — contact did
  //     happen, just late.
  //   - Never connected at all, window passed: NOT flagged here anymore —
  //     folded into Not Updated below instead, since "still nothing has
  //     happened" is a different (and more accurate) story than "we were
  //     late." See neverConnectedPastWindow below.
  let firstContactStatus = 'N/A';
  let businessMinsToConnect = null;
  if (created && connectDate) {
    businessMinsToConnect = businessMinutesBetween(created, connectDate);
    firstContactStatus = businessMinsToConnect > CONFIG.FIRST_CONTACT_SLA_MINUTES ? 'BREACHED' : 'OK';
  }
  const firstContactBreach = isOpenLead && isUnder48h && firstContactStatus === 'BREACHED';

  // The "otherwise" half of Rule 1 — still no VERIFIABLE connection once
  // the 10-minute window has passed. Deliberately exempt from the 3-hour
  // grace (like the old firstContactBreach was), so a silent lead doesn't
  // sit unflagged anywhere in the 10-min–3h gap between this check and Not
  // Updated's own grace period. Gated on !connectDate rather than
  // !hasConnected: last_connect can hold non-empty text with
  // last_connect_time blank/unparseable, which made hasConnected true
  // with no way to ever compute businessMinsToConnect — that ambiguous
  // case fell through both this AND firstContactBreach silently. connectDate
  // specifically means "we have a timestamp we can act on."
  const neverConnectedPastWindow = isOpenLead && isUnder48h && !connectDate &&
    !!created && businessMinutesBetween(created, now) > CONFIG.FIRST_CONTACT_SLA_MINUTES;

  // Detect leads touched by more than one agent over time. The sheet's RM
  // column only shows the current assignee, but internal_status_comments
  // often logs a history of different names — a real signal of
  // reassignment or multiple agents handling the same lead.
  // Multi-agent detection. Collation now tells us this directly — a record
  // built from several RM copies WAS held by several people. Fall back to
  // distinct names in the comment log for records that weren't collated,
  // which still catches reassignment within a single copy.
  const actionLogEntries = parseActionLog(combinedCommentsText(l));
  const distinctAgents = new Set(
    actionLogEntries.map(e => e.loggedBy.trim().toLowerCase()).filter(Boolean)
  );
  const collatedCount = Number(l.collatedFrom) || 1;
  const agentCount = Math.max(collatedCount, distinctAgents.size);
  const isMultiAgent = agentCount > 1;

  // Newest comment timestamp, taken by actual TIMESTAMP rather than array
  // position. The log is usually appended chronologically, but nothing
  // guarantees it — one out-of-order entry would make a stale lead look
  // freshly touched and silently break the Rule 4 follow-up check.
  let hoursSinceLastComment = null;
  let lastCommentAt = null;   // raw timestamp, so the UI can print it
  if (actionLogEntries.length) {
    let newestMs = null;
    for (const e of actionLogEntries) {
      if (!e.ts) continue;
      const d = parseDate(e.ts);
      if (d && (newestMs === null || d.getTime() > newestMs)) newestMs = d.getTime();
    }
    if (newestMs !== null) {
      hoursSinceLastComment = (now - newestMs) / 36e5;
      lastCommentAt = new Date(newestMs);
    }
  }

  // Behind on Today's Calls ("5 calls/day", every day the lead stays open —
  // not just its creation day). For a lead created today, the lifetime-total
  // call_attempts IS today's effort (it didn't exist before today), so that
  // column is used directly. For a lead still open on day 2+, the export has
  // no true per-day counter — only the lifetime-cumulative call_attempts
  // total — so today's real count comes from a day-over-day DELTA instead:
  // today's call_attempts minus its value as of the most recent Movement_Log
  // snapshot from before today (see buildTodayCallBaseline). That's actual
  // call data, not a guess — unlike the old CRM-comment-count proxy, it
  // doesn't undercount a lead that was genuinely called but never
  // commented on (this is exactly the situation Recording Not Working
  // flags separately as a logging problem, not a calling one). Falls back
  // to the comment-log proxy only when no pre-today snapshot exists yet
  // for this lead (fresh Movement_Log setup, or gaps in capture history),
  // or while enriching a past snapshot itself (see _enrichingHistorical).
  const loggedToday = actionLogEntries.filter(e => {
    if (!e.ts) return false;
    const d = parseDate(e.ts);
    return d && istSameDay(d, now);
  }).length;
  let attemptsToday;
  if (isCreatedToday) {
    attemptsToday = l.call_attempts;
  } else if (!_enrichingHistorical) {
    const baselineKey = String(l.client_id || '').trim() || 'l:' + String(l.lead_id).trim();
    const baseline = _todayCallBaselineByKey.get(baselineKey);
    attemptsToday = baseline !== undefined ? Math.max(0, (Number(l.call_attempts) || 0) - baseline) : loggedToday;
  } else {
    attemptsToday = loggedToday;
  }
  const underCalledToday = isOpenLead && pastGrace && attemptsToday < CONFIG.MIN_CALLS_PER_DAY;

  // Stuck: open past 48hrs and still hasn't reached Opportunity — the one
  // check deliberately exempt from the isUnder48h scope, since being old is
  // the whole point of it.
  const stageStuck48h = past48h && pastGrace;

  // Not Updated: currently sitting in the very first funnel stage — never
  // progressed since import. Also absorbs the "otherwise" half of Rule 1
  // (neverConnectedPastWindow, computed above) — a lead nobody has
  // connected with past the 10-minute window belongs here now, not under
  // Not Connected in 10 Minutes, regardless of what its stage text happens
  // to say.
  const isNotUpdated = isOpenLead && isUnder48h &&
    ((pastGrace && canonicalStage(l.current_stage) === 'not updated') || neverConnectedPastWindow);

  // SOP Rule 4 — Post-Connect Follow-up: once connected, CRM should be
  // reviewed every 4 hours. Deliberately independent of call count: a
  // well-called lead that has gone quiet after connecting is exactly what
  // this rule exists to catch.
  // hasConnected/connectDate computed earlier now (Rule 1 needs them too).
  // When no comment has ever been logged, "hours since last comment" is
  // undefined. Treating that as automatically overdue wrongly flags a lead
  // connected 10 minutes ago, so the clock falls back to time since
  // CONNECTION — Rule 4 is about review cadence after connecting.
  const hoursSinceConnect = connectDate ? (now - connectDate) / 36e5 : null;
  const followupStaleHours = hoursSinceLastComment !== null
    ? hoursSinceLastComment
    : (hoursSinceConnect !== null ? hoursSinceConnect : ageHours);
  const followupOverdue = isOpenLead && isUnder48h && pastGrace && hasConnected &&
    followupStaleHours !== null && followupStaleHours > CONFIG.FOLLOWUP_REVIEW_HOURS;

  // Recording Not Working — a pure data-integrity check, deliberately with
  // NO gating: no open/closed filter, no grace period, no priority ranking.
  // Requires BOTH call_count (connected calls) AND call_attempts (every
  // dial, connected or not) to be zero. call_attempts > 0 with call_count
  // still 0 just means the RM dialed and it didn't connect — that attempt
  // WAS recorded by the system, so recording is working fine; it's only a
  // genuine data-integrity gap when NEITHER figure shows any call activity
  // at all, despite a comment saying work happened. "Comment" here means
  // any of the four comment-ish columns (see hasAnyCommentField), not just
  // the structured action log — a lead with only a last_comment or a
  // closing_reason set is still real evidence someone touched it.
  const recordingCommentsNoCalls = l.call_count === 0 && l.call_attempts === 0 && hasAnyCommentField(l);
  // Closed with No Work Recorded is its own separate issue card below —
  // a lead CLOSED with zero comments logged at all, i.e. no evidence any
  // work happened before closure. Deliberately just these two conditions:
  // call_count/call_attempts are dropped from this one (unlike
  // recordingCommentsNoCalls above, which still needs both zero) — a
  // closed lead with literally no comment is the signal on its own,
  // regardless of whatever number sits in the call columns.
  const closedWithNoWork = excluded && !hasAnyCommentField(l);
  const recordingNotWorking = recordingCommentsNoCalls;

  // SOP Rule 3 — CRM logging after each attempt. The mirror image of
  // Recording Not Working above: that check catches comments with no
  // calls (the call counter isn't recording real work); this one catches
  // the opposite — calls piling up with nothing written about any of
  // them. Gated like the other day-to-day SLA checks (open, past grace,
  // still inside the 48h lifecycle) rather than left ungated like
  // Recording Not Working, since this is about ongoing compliance on a
  // live lead, not a pure data-integrity symptom.
  const unloggedCallGap = Math.max(0, (Number(l.call_attempts) || 0) - actionLogEntries.length);
  const loggingGapBreach = isOpenLead && isUnder48h && pastGrace && unloggedCallGap >= CONFIG.MIN_UNLOGGED_CALL_GAP;

  // Inactive-RM Lead Added — a brand-new lead landed on an RM who's
  // currently marked inactive. rm_is_active is a CURRENT snapshot, not a
  // historical log, so "on that day" is only knowable for leads created
  // TODAY — this can't retroactively prove an older lead was misrouted,
  // only that a fresh one just was. Deliberately no grace period: the
  // problem isn't the RM being slow, it's that the assignment itself was
  // wrong and nobody can act on it until it's reassigned.
  const rmActiveRaw = String(l.rm_is_active || '').trim().toLowerCase();
  const rmIsInactive = ['false', 'no', 'inactive', '0', 'n'].includes(rmActiveRaw);
  const inactiveRmNewLead = isOpenLead && isCreatedToday && rmIsInactive;

  return Object.assign({}, l, {
    ageHours, oppOrAbove, excluded, hasClosingReason, isOpenLead, past48h, isUnder48h, stageStuck48h,
    firstContactStatus, firstContactBreach, businessMinsToConnect, neverConnectedPastWindow,
    agentCount, isMultiAgent,
    hoursSinceLastComment, lastCommentAt, isNotUpdated,
    followupOverdue, hasConnected, recordingNotWorking, recordingCommentsNoCalls, closedWithNoWork,
    unloggedCallGap, loggingGapBreach,
    rmIsInactive, inactiveRmNewLead,
    attemptsToday, underCalledToday,
    collatedFrom: l.collatedFrom || 1, collatedRMs: l.collatedRMs || [], collatedLeadIds: l.collatedLeadIds || [],
    collatedRegions: l.collatedRegions || []
  });
}

function esc(s){
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

// Full-page blocking overlay for a heavy recompute — shown BEFORE the
// synchronous work starts and hidden after it finishes, with pointer
// events swallowed by #renderLoadingOverlay's own CSS (position:fixed,
// inset:0, above everything) so a click during the freeze can't reach any
// filter/button underneath and queue up yet another recompute.
// Reference-counted, not a plain show/hide toggle — fetchAndRender shows
// this, then calls applyFiltersAndRender internally (which shows/hides it
// too) before fetchAndRender's OWN finally block hides it again. Because
// applyFiltersAndRender's real work is deferred a couple ticks (see below),
// fetchAndRender's finally runs — and would hide the overlay — before that
// deferred work has even started. A plain boolean toggle would drop the
// overlay right before the heaviest part of the pass; counting nested
// show calls means it only actually disappears once every caller that
// asked for it is done.
let _loadingOverlayDepth = 0;
function showLoadingOverlay(text){
  _loadingOverlayDepth++;
  const el = document.getElementById('renderLoadingOverlay');
  if (!el) return;
  const textEl = document.getElementById('renderLoadingOverlayText');
  if (textEl) textEl.textContent = text || 'Loading…';
  el.classList.add('active');
}
function hideLoadingOverlay(){
  _loadingOverlayDepth = Math.max(0, _loadingOverlayDepth - 1);
  if (_loadingOverlayDepth > 0) return; // still needed by an outer/other in-flight caller
  const el = document.getElementById('renderLoadingOverlay');
  if (el) el.classList.remove('active');
}

let _isApplyingFilters = false;
// Thin wrapper around the real implementation below. Setting the overlay's
// class and immediately calling straight into the expensive synchronous
// work would never actually SHOW the overlay — the browser only paints a
// DOM change on the event loop's next turn, and a long synchronous call
// blocks that turn from ever happening. Two nested setTimeout(…, 0) calls
// force the browser through a real paint in between "show the overlay"
// and "start the work that would otherwise block it from ever appearing".
// Deliberately NOT requestAnimationFrame here — rAF callbacks are tied to
// the visible paint cycle and get throttled or fully paused for a tab
// that isn't the focused/visible one (e.g. the user alt-tabbed away right
// after clicking a filter), which would hang this indefinitely — exactly
// the kind of freeze this is meant to prevent, just silent instead of
// slow. setTimeout keeps firing (browsers only clamp its rate in a
// background tab, never pause it outright). _isApplyingFilters is a
// belt-and-suspenders guard — the overlay already blocks the clicks that
// would cause this, but if a caller ever invokes this programmatically
// while one is in flight, this still keeps two passes from stacking.
function applyFiltersAndRender(){
  if (_isApplyingFilters) return;
  _isApplyingFilters = true;
  showLoadingOverlay('Applying filters…');
  setTimeout(() => {
    setTimeout(() => {
      try {
        _applyFiltersAndRenderImpl();
      } finally {
        hideLoadingOverlay();
        _isApplyingFilters = false;
      }
    }, 0);
  }, 0);
}

function _applyFiltersAndRenderImpl(){
  const projSel = filterState.project;
  const regSel = filterState.region;
  const srcSel = filterState.source;
  const tlSel = filterState.TL;
  const bucketSel = filterState.bucket;
  const srcSelLower = new Set(Array.from(srcSel).map(s => s.toLowerCase()));

  const fromVal = document.getElementById('dateFromInput').value; // "YYYY-MM-DD" or ""
  const toVal = document.getElementById('dateToInput').value;
  const fromDate = fromVal ? parseDate(fromVal + ' 00:00:00') : null;   // IST day start
  const toDate = toVal ? parseDate(toVal + ' 23:59:59') : null;         // inclusive of the whole IST "to" day

  // Extracted so the SAME predicate can be re-applied to each individual
  // copySplit below, not just to the merged parent record — a customer
  // merged from a Thane copy AND a Loan copy (sharing a lead_id/client_id)
  // passes this check as long as ITS PRIMARY copy's region is selected;
  // without re-checking each split on its own, the Loan copy rode along
  // into issueLeads even with Loan unchecked in the Region filter.
  const passesFilters = (l) => {
    if (projSel.size && !projSel.has(l.project)) return false;
    if (regSel.size && !regSel.has(effectiveRegion(l))) return false;
    if (tlSel.size && !tlSel.has(l.TL)) return false;
    if (srcSel.size && !srcSelLower.has(String(l.group_source).trim().toLowerCase())) return false;
    if (bucketSel.size && !bucketSel.has(String(l.source_bucket).trim())) return false;
    if (fromDate || toDate) {
      const created = parseDate(l.lead_created_at);
      if (!created) return false; // can't place an undated lead inside a date range
      if (fromDate && created < fromDate) return false;
      if (toDate && created > toDate) return false;
    }
    return true;
  };

  const filtered = allParsedLeads.filter(passesFilters);

  _renderNow = new Date(); // one consistent clock for this entire pass
  // Rebuilt fresh every pass (cheap — one scan of movementSnapshots) so it
  // always reflects whatever Movement_Log data is currently loaded; see
  // buildTodayCallBaseline and enrichLead's attemptsToday.
  _todayCallBaselineByKey = buildTodayCallBaseline(_renderNow);
  leads = filtered.map(enrichLead);

  // Issue-detection view: every multi-copy customer expanded back into its
  // own separately-enriched entities (see copySplits in fetchAndRender) —
  // X being closed can't hide Y's Not Updated, and Z's own call count
  // can't get credited from Y's calls. Feeds the 5 SLA sections, their
  // emails, and the CSV export. `leads` above (still one card per
  // customer) is untouched and keeps feeding Total Leads, Distribution,
  // RM Scorecard, and everything else that isn't about a specific issue.
  //
  // Built from allParsedLeads directly, NOT from `leads` above — a
  // customer's PARENT record reflects only its primary copy's region
  // (e.g. Thane), so filtering allParsedLeads first and expanding
  // afterward would drop every split of a customer whose primary copy
  // doesn't match the filter, even when a DIFFERENT one of its copies
  // does (a Thane-primary customer with a Loan copy has to still show
  // that Loan copy when the Region filter is set to Loan, even though
  // the parent itself — and Thane — wouldn't pass that filter). Each
  // unit (split, or the record itself when there's no split) is checked
  // against passesFilters independently.
  issueLeads = [];
  allParsedLeads.forEach(l => {
    const units = (l.copySplits && l.copySplits.length > 1) ? l.copySplits : [l];
    units.filter(passesFilters).forEach(raw => issueLeads.push(enrichLead(raw)));
  });

  const summary = document.getElementById('filterSummary');
  // Plain text (this element uses .textContent, not .innerHTML, so no
  // inline styling here — the collatedCountText/Label helpers used
  // elsewhere for HTML contexts aren't a fit for this one).
  const shownCollated = countCollatedAmong(leads).collated;
  const totalCollated = countCollatedAmong(allParsedLeads).collated;
  const shownText = shownCollated > 0 ? `${leads.length} (${shownCollated} cloned)` : String(leads.length);
  const totalText = totalCollated > 0 ? `${allParsedLeads.length} (${totalCollated} cloned)` : String(allParsedLeads.length);
  summary.textContent = `Showing ${shownText} of ${totalText} leads` +
    (projSel.size ? ` · Project: ${Array.from(projSel).join(', ')}` : '') +
    (regSel.size ? ` · Region: ${Array.from(regSel).join(', ')}` : '') +
    (tlSel.size ? ` · TL: ${Array.from(tlSel).join(', ')}` : '') +
    (srcSel.size ? ` · Source: ${Array.from(srcSel).join(', ')}` : ' · Source: All') +
    (bucketSel.size ? ` · Sub-source: ${Array.from(bucketSel).join(', ')}` : '') +
    ((fromVal || toVal) ? ` · Created: ${fromVal || '…'} to ${toVal || '…'}` : '');

  renderAll();
}

// Persists one compliance snapshot into the SLA_History sheet tab — real,
// shared history rather than one browser's own localStorage cache (see
// upsertSlaHistoryRows). Nothing in this dashboard currently displays this
// data (the Overview tab's SLA Compliance Trend chart was removed), but it
// keeps accumulating for direct sheet inspection or future use. Deliberately
// computed over the WHOLE dataset (allParsedLeads), not the currently
// filtered `leads` — otherwise browsing with a region filter active would
// silently write a partial-data snapshot.
//
// asOf defaults to _renderNow (a plain refresh) but callers that need
// their OWN precise moment — browserSnapshotOpenLeads, so its SLA_History
// row lines up with the exact instant its Movement_Log write used, not
// whatever _renderNow happened to be left at from an earlier refresh —
// can pass one explicitly. Overrides _renderNow only, deliberately NOT via
// enrichLeadAsOf: that also flips _enrichingHistorical, which forces
// attemptsToday's cruder loggedToday fallback instead of the accurate
// baseline-based count — right for replaying an OLD Movement_Log row, wrong
// here, since this is a live moment close to the last real refresh where
// the normal baseline lookup is still valid.
async function snapshotSlaHistory(asOf){
  if (!allParsedLeads.length) return;
  if (!_currentSheetId) return;
  const at = asOf || _renderNow;

  const savedRenderNow = _renderNow;
  _renderNow = at;
  let enriched;
  try {
    enriched = allParsedLeads.map(enrichLead);
  } finally {
    _renderNow = savedRenderNow;
  }
  const byCheck = {};
  ISSUE_PRIORITY.forEach(rule => { byCheck[rule.key] = 0; });

  let openTotal = 0, breachedTotal = 0;
  enriched.forEach(l => {
    if (!l.isOpenLead) return;
    openTotal++;
    let isBreached = false;
    ISSUE_PRIORITY.forEach(rule => {
      if (l[rule.key]) { byCheck[rule.key]++; isBreached = true; }
    });
    if (isBreached) breachedTotal++;
  });

  // One row per refresh, keyed by its own exact timestamp (not by day) —
  // see upsertSlaHistoryRows. A person actively refreshing through the day
  // adds extra, finer-grained points on top of whatever MovementTracker.gs
  // is (or will be) writing automatically every 6h; nothing here overwrites
  // an earlier refresh's row, they just accumulate.
  try {
    await upsertSlaHistoryRows([{
      snapshot_at: istDateTimeValue(at), date: istDateKey(at), source: 'Dashboard',
      openTotal, breachedTotal, byCheck,
    }]);
  } catch (e) { /* sheet write failed — this run just won't be recorded */ }
}

// No UI wires to this anymore (the Overview tab's SLA Compliance Trend
// section was removed) — kept as a console-callable utility: run
// `await clearSlaHistory()` to wipe SLA_History if you ever need to.
async function clearSlaHistory(){
  if (!_currentSheetId) return;
  try {
    const sheetId = await getSheetIdByTabName(SLA_HISTORY_TAB_NAME);
    if (sheetId != null) {
      const existingValues = await sheetsApiValuesGet(_currentSheetId, `${SLA_HISTORY_TAB_NAME}!A2:A`);
      if (existingValues.length) {
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
    }
  } catch (e) { console.error('Clear SLA_History failed:', e); }
}

// "Last 7 days" default for the Created date filter — the browser's OWN
// local calendar date, deliberately not IST-shifted like the rest of this
// file's date handling, since this is specifically about whatever "today"
// means on the machine looking at the dashboard.
function defaultDateRangeValue(){
  const now = new Date();
  const from = new Date(now);
  from.setDate(from.getDate() - 7);
  const fmt = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  return { from: fmt(from), to: fmt(now) };
}

function buildFilterUI(){
  // getter lets a field's filter options come from a DERIVED value instead
  // of the raw column — used for Region, so "Loan" (carried in group_source,
  // not the region column — see effectiveRegion) shows up as its own option.
  const uniqueVals = (key, getter) => Array.from(new Set(
    allParsedLeads.map(l => String(getter ? getter(l) : l[key]).trim()).filter(v => v !== '')
  )).sort();

  const countsFor = (key, getter) => {
    const counts = {};
    allParsedLeads.forEach(l => {
      const v = String(getter ? getter(l) : l[key]).trim();
      if (!v) return;
      counts[v] = (counts[v] || 0) + 1;
    });
    return counts;
  };

  buildMultiSelect('msProject', 'Project', uniqueVals('project'), countsFor('project'), filterState.project, applyFiltersAndRender);
  buildMultiSelect('msRegion', 'Region', uniqueVals('region', effectiveRegion), countsFor('region', effectiveRegion), filterState.region, applyFiltersAndRender);
  buildMultiSelect('msTL', 'TL', uniqueVals('TL'), countsFor('TL'), filterState.TL, applyFiltersAndRender);
  buildMultiSelect('msSource', 'Source', uniqueVals('group_source'), countsFor('group_source'), filterState.source, applyFiltersAndRender);
  // Sub-division of the Google source. Empty selection = all buckets, so the
  // dropdown covers one / several / all without a separate "All" entry.
  buildMultiSelect('msBucket', 'Sub-source', uniqueVals('source_bucket'), countsFor('source_bucket'), filterState.bucket, applyFiltersAndRender);

  // Default the Created date range to the last 7 days whenever it isn't
  // already set — first load, or right after Reset Filters below. Never
  // overrides a range already in place, so a deliberately widened range
  // survives a plain refresh instead of snapping back every time.
  const dateFromEl = document.getElementById('dateFromInput');
  const dateToEl = document.getElementById('dateToInput');
  if (dateFromEl && dateToEl && !dateFromEl.value && !dateToEl.value) {
    const def = defaultDateRangeValue();
    dateFromEl.value = def.from;
    dateToEl.value = def.to;
  }

  document.getElementById('clearFiltersBtn').onclick = () => {
    filterState.project.clear();
    filterState.region.clear();
    filterState.source.clear();
    filterState.TL.clear();
    filterState.bucket.clear();
    const def = defaultDateRangeValue();
    document.getElementById('dateFromInput').value = def.from;
    document.getElementById('dateToInput').value = def.to;
    buildFilterUI();
    applyFiltersAndRender();
  };
}

// Generic multi-select dropdown: renders a button + popover checklist into
// containerId, backed by a Set (selectedSet). Empty set = "all included".
function buildMultiSelect(containerId, label, options, counts, selectedSet, onChange){
  const container = document.getElementById(containerId);
  container.innerHTML = '';

  const btn = document.createElement('button');
  btn.className = 'ms-btn' + (selectedSet.size ? ' active' : '');
  btn.innerHTML = `<span>${esc(label)}</span>` +
    (selectedSet.size ? `<span class="count-badge">${selectedSet.size}</span>` : `<span class="dim">All</span>`) +
    `<span class="ms-chevron">▾</span>`;

  const panel = document.createElement('div');
  panel.className = 'ms-panel';

  const search = document.createElement('input');
  search.className = 'ms-search';
  search.placeholder = `Search ${label.toLowerCase()}…`;
  panel.appendChild(search);

  const actions = document.createElement('div');
  actions.className = 'ms-actions';
  const selectAllBtn = document.createElement('button');
  selectAllBtn.textContent = 'Select all';
  const clearBtn = document.createElement('button');
  clearBtn.textContent = 'Clear';
  actions.appendChild(selectAllBtn);
  actions.appendChild(clearBtn);
  panel.appendChild(actions);

  const list = document.createElement('div');
  list.className = 'ms-list';
  panel.appendChild(list);

  function renderOptions(filterText){
    list.innerHTML = '';
    const ft = (filterText || '').toLowerCase();
    options
      .filter(opt => opt.toLowerCase().indexOf(ft) !== -1)
      .forEach(opt => {
        const row = document.createElement('label');
        row.className = 'ms-option';
        const cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.checked = selectedSet.has(opt);
        cb.addEventListener('change', () => {
          if (cb.checked) selectedSet.add(opt); else selectedSet.delete(opt);
          refreshButtonLabel();
          onChange();
        });
        const span = document.createElement('span');
        span.textContent = opt;
        const countEl = document.createElement('span');
        countEl.className = 'opt-count';
        countEl.textContent = counts[opt] || 0;
        row.appendChild(cb);
        row.appendChild(span);
        row.appendChild(countEl);
        list.appendChild(row);
      });
    if (!list.children.length) {
      list.innerHTML = `<div style="padding:10px; color:var(--text-faint); font-size:12px;">No matches</div>`;
    }
  }

  function refreshButtonLabel(){
    btn.className = 'ms-btn' + (selectedSet.size ? ' active' : '');
    btn.innerHTML = `<span>${esc(label)}</span>` +
      (selectedSet.size ? `<span class="count-badge">${selectedSet.size}</span>` : `<span class="dim">All</span>`) +
      `<span class="ms-chevron">▾</span>`;
  }

  search.addEventListener('input', () => renderOptions(search.value));
  selectAllBtn.addEventListener('click', () => {
    // Selects every option, not just the ones matching the current search —
    // so clear the search too, otherwise the list stays filtered and only
    // shows a fraction of what was just ticked.
    options.forEach(o => selectedSet.add(o));
    search.value = '';
    renderOptions('');
    refreshButtonLabel();
    onChange();
  });
  clearBtn.addEventListener('click', () => {
    selectedSet.clear();
    // Also reset the search box — clearing while a search term is active
    // otherwise leaves the list filtered, so it looks like options vanished
    // rather than simply being unticked.
    search.value = '';
    renderOptions('');
    refreshButtonLabel();
    onChange();
  });

  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    const isOpen = panel.classList.contains('open');
    document.querySelectorAll('.ms-panel.open').forEach(p => p.classList.remove('open'));
    if (!isOpen) panel.classList.add('open');
  });

  renderOptions('');
  container.appendChild(btn);
  container.appendChild(panel);
}

document.addEventListener('click', (e) => {
  if (!e.target.closest('.ms')) {
    document.querySelectorAll('.ms-panel.open').forEach(p => p.classList.remove('open'));
  }
});


// ---- family/collation helpers + card primitives (was mid-file) ----

// Action-log tables were previously built eagerly for every card and left
// display:none until clicked. Across 6 sections × 200 cards × ~23 entries
// that's ~27,600 hidden <tr> (~166k cells, ~4.3MB of HTML) constructed and
// parsed on EVERY filter change, for markup almost none of which is ever
// viewed. Now the lead is stashed by id and the table is built on first
// click only, then cached in the DOM.
// Cards render up to this many rows. Anything beyond gets a visible notice
// rather than silently disappearing — a TL looking at 200 cards under a
// "1,340 leads" heading otherwise has no idea they're seeing 15% of it.
const MAX_CARDS = 200;

function truncationNotice(total, shown){
  if (total <= shown) return '';
  return `<div class="truncation-notice">Showing first ${shown} of ${total.toLocaleString()} — narrow the filters or use Download Issues CSV for the full list.</div>`;
}

const _logLeadRegistry = new Map();

function toggleActionLog(logId){
  const el = document.getElementById(logId);
  if (!el) return;
  if (!el.dataset.rendered) {
    const raw = _logLeadRegistry.get(logId);
    const entries = parseActionLog(raw);
    el.innerHTML = actionLogTableMarkup(entries);
    el.dataset.rendered = '1';
  }
  el.classList.toggle('open');
}

function logToggleMarkup(l, logId){
  const combined = combinedCommentsText(l);
  const count = parseActionLog(combined).length;
  if (!count) return '';
  _logLeadRegistry.set(logId, combined);
  return `<button class="log-toggle" onclick="toggleActionLog('${logId}')">View action log (${count}) ▾</button>`
    + `<div class="action-log" id="${logId}"></div>`;
}

function renderAlertCard(l, idx, prefix, requiredCalls){
  const logId = prefix + '_' + idx;
  // Both timestamps matter: creation says when the clock started, last
  // comment says whether anyone has touched it since. A relative figure
  // alone ("9.2h old") answers neither question usefully.
  const lastAt = l.lastCommentAt || null;
  const commentLabel = lastAt
    ? `last comment ${istStamp(lastAt)}`
    : (l.ageHours != null ? `no comment in ${l.ageHours.toFixed(1)}h` : 'no comment');

  return `<div class="alert-card${l.past48h ? '' : ' amber-left'}">
    <div class="alert-id">${leadIdentityLine(l)}</div>
    <div class="alert-age mono">created ${esc(istStamp(l.lead_created_at))}</div>
    <div class="alert-meta">${esc(l.region)} · ${esc(l.project)} · ${esc(l.current_stage)} — <span class="chip amber">${l.call_attempts}/${requiredCalls} attempts</span> <span class="chip ${lastAt ? 'dim-chip' : 'amber'}">${esc(commentLabel)}</span></div>
    ${l.last_comment ? `<div class="alert-comment">"${esc(l.last_comment)}"</div>` : ''}
    ${logToggleMarkup(l, logId)}
  </div>`;
}

// Marks records built from several RM copies of the same customer, so a
// merged call count or stage is never mistaken for one RM's own figures.
// Every RM holding a copy, and every merged lead_id, are always named
// inline: on any issue card the question "who else has this customer" is
// the actionable one, and a name hidden in a tooltip can't be read off a
// shared screen or a screenshot. Previously closed leads collapsed to just
// the count, which meant the RM list disappeared exactly where a
// post-mortem needs it.
function collationBadge(l){
  if (!l.collatedFrom || l.collatedFrom < 2) return '';
  const leadIds = (l.collatedLeadIds || []).join(', ');
  const rms = (l.collatedRMs || []).join(', ');
  const regions = l.collatedRegions || [];

  // Dim, not amber/red — these are identity/provenance chips (who this
  // record is), not urgency signals. Amber and red stay reserved for the
  // actual compliance chips (attempts remaining, staleness) elsewhere on
  // the card, so the eye has one clear place to land on what needs action.
  let out = ` <span class="chip dim-chip" title="Merged from ${l.collatedFrom} copies of this customer">merged ×${l.collatedFrom}</span>`;
  if (leadIds) out += ` <span class="chip dim-chip" title="Every lead_id merged into this record">IDs: ${esc(leadIds)}</span>`;
  if (rms) out += ` <span class="chip dim-chip" title="Every RM who held a copy of this customer">RMs: ${esc(rms)}</span>`;
  if (regions.length > 1) out += ` <span class="chip red" title="These merged copies did not all resolve to the same region — this card can only show one, so the others are absorbed here">Regions: ${esc(regions.join(', '))}</span>`;
  return out;
}

// Lightweight cross-reference for an issue-detection entity (copySplits —
// one RM's own copy of a multi-copy customer, judged on its own issues).
// Deliberately NOT the full IDs/RMs chip treatment collationBadge gives a
// genuine merge: this row's issue is its own, not shared with the sibling
// copies, so it just names them for context rather than presenting them
// as part of the same instance.
function siblingNote(l){
  if (!l.siblingRMs || !l.siblingRMs.length) return '';
  return ` <span class="chip dim-chip" title="This customer also has other RM copies (${esc((l.siblingLeadIds||[]).join(', '))}), shown separately since each is judged on its own issues">also held by: ${esc(l.siblingRMs.join(', '))}</span>`;
}

// The line shown at the top of every issue card. For a genuinely collated
// lead (non-issue views — Total Leads, Distribution, RM Scorecard), the
// badges already list every merged lead_id and every RM in full — putting
// the primary copy's own id/RM in front of that just repeats what the
// badges already say. Everywhere else (a plain single-copy lead, or one
// RM's own split of a multi-copy customer) shows its own id/RM directly,
// plus a sibling note when this is a split with other copies elsewhere.
function leadIdentityLine(l){
  const badge = collationBadge(l);
  if (badge) return badge.trim();
  return `${esc(l.lead_id)} · ${esc(l.RM)}${siblingNote(l)}`;
}

// Groups a copySplit-expanded list back into families using the SAME
// signal every copy's own siblingLeadIds already carries (every copy of
// one customer lists every OTHER copy, so [own id, ...siblings] sorted is
// an identical key across all of them) — a plain, unsplit entity (no
// siblings) is its own family of one, so this works on lists that mix
// split and non-split entities, not just fully-split ones.
function familyKeyOf(l){
  return [String(l.lead_id).trim(), ...((l.siblingLeadIds || []).map(String))].sort().join('|');
}

// Sorts a list so every copy of the same customer (see familyKeyOf) ends
// up adjacent, instead of scattered across the list by whatever the
// section's own sort criterion happens to do — 3 RM copies all flagged
// in the same section should read as one connected story, not 3
// unrelated cards. Each family is sorted internally by compareFn (so
// within a family the ordering still means the same thing it always
// did), and families are ordered relative to EACH OTHER by their own
// most-urgent member (first after that internal sort) — a family
// containing the single oldest/most-overdue lead still surfaces near
// the top, so grouping never buries genuine urgency behind an
// unrelated family that happens to sort earlier.
function groupSiblingsTogether(items, compareFn){
  const families = new Map();
  (items || []).forEach(item => {
    const key = familyKeyOf(item);
    if (!families.has(key)) families.set(key, []);
    families.get(key).push(item);
  });
  const groups = Array.from(families.values()).map(members => members.slice().sort(compareFn));
  groups.sort((a, b) => compareFn(a[0], b[0]));
  return groups.reduce((flat, g) => flat.concat(g), []);
}

// One representative entry per family (first one encountered) — for any
// place that needs a "how many distinct customers, and what does each
// look like" answer without a cloned copy skewing the count or a status
// breakdown. The full per-copy list stays exactly as-is wherever a
// per-copy card/row still needs its own entry (issue sections, region
// email detail rows) — this is only for count/breakdown purposes.
function dedupeToFamilies(items){
  const seen = new Map();
  (items || []).forEach(l => {
    const key = familyKeyOf(l);
    if (!seen.has(key)) seen.set(key, l);
  });
  return Array.from(seen.values());
}

// A "leads created" / "leads flagged" style COUNT should say how many real
// customers that is, not how many rows — a customer collated from 3 RM
// copies still shows up as 3 separate entities in issue-detection lists
// (copySplits — each RM's own copy is judged on its own data, deliberately
// not merged for that purpose), so counting the array length directly
// overstates volume: "12 leads created" reads as 12 distinct people even
// when only 7 are.
function countUniqueAndCloned(items){
  const total = (items || []).length;
  const unique = dedupeToFamilies(items).length;
  return { total, unique, cloned: total - unique };
}

// Renders a countUniqueAndCloned() result as the short phrase used on
// section/panel count badges and KPI-style stats — "7 leads" when nothing
// was cloned, "7 leads (5 cloned)" when some entries are just another RM's
// copy of a customer already counted.
function uniqueCloneLabel(counts, noun){
  const n = noun || 'lead';
  const base = `${counts.unique} ${n}${counts.unique === 1 ? '' : 's'}`;
  return counts.cloned > 0 ? `${base} (${counts.cloned} cloned)` : base;
}

// Same idea as countUniqueAndCloned/uniqueCloneLabel above, but for
// customer-deduped arrays like `leads` (or any subset/filter of it) rather
// than per-copy arrays like issueLeads. Each `leads` record already
// represents ONE customer — a copy collated from 2+ RM rows doesn't show up
// as extra ARRAY ENTRIES here (unlike issueLeads), it shows up as that
// one entry's own collatedFrom > 1 — so countUniqueAndCloned's
// familyKeyOf-based matching (which compares DIFFERENT array entries
// against each other) would never find anything to dedupe: every `leads`
// record already has its own unique lead_id by construction. This instead
// just counts how many of the N records already ARE such a merge.
function countCollatedAmong(arr){
  const total = (arr || []).length;
  const collated = (arr || []).reduce((n, l) => n + ((l.collatedFrom || 1) > 1 ? 1 : 0), 0);
  return { total, collated };
}

// Bare-number form for table cells/KPI numbers: "112" or "112 (4 cloned)".
function collatedCountText(arr){
  const { total, collated } = countCollatedAmong(arr);
  return collated > 0 ? `${total.toLocaleString()} (${collated} cloned)` : total.toLocaleString();
}

// Noun-suffixed form for badges/summaries, matching uniqueCloneLabel's
// phrasing: "112 leads" or "112 leads (4 cloned)".
function collatedCountLabel(arr, noun){
  const n = noun || 'lead';
  const { total, collated } = countCollatedAmong(arr);
  const base = `${total.toLocaleString()} ${n}${total === 1 ? '' : 's'}`;
  return collated > 0 ? `${base} (${collated} cloned)` : base;
}

// Same idea, but for table accumulator loops that already track a running
// count (e.g. `b.total++`) rather than building an array — a parallel
// `b.collated++` alongside the existing counter feeds this directly at
// render time, without needing to also collect every matching lead into
// an array just to hand it to collatedCountText.
function numWithClone(n, collated){
  return collated > 0 ? `${n.toLocaleString()} (${collated} cloned)` : n.toLocaleString();
}

// ---- comment parsing + keyword/outcome engine + follow-up engine (was mid-file) ----

// A lead's comment history lives in TWO columns — internal_status_comments
// (the running action-log history) and stage_comments (logged at
// stage-change events) — either can carry a genuine comment on its own, so
// every "has this lead been commented on" check reads both combined,
// rather than internal_status_comments alone missing a comment that only
// ever landed in stage_comments.
function combinedCommentsText(l){
  return [l.internal_status_comments, l.stage_comments]
    .filter(t => String(t || '').trim())
    .join(' | ');
}

// Broader existence check than combinedCommentsText above: true if ANY of
// the four comment-ish columns (internal_status_comments, stage_comments,
// last_comment, closing_reason) has real content. Used only for "has this
// lead been commented on AT ALL" gates (Recording Not Working / Closed
// with No Work Recorded) — deliberately NOT folded into combinedCommentsText/
// actionLogEntries itself, since last_comment and closing_reason aren't
// structured action-log entries (no per-attempt timestamp, no logger
// name) and counting them as entries would understate a genuine
// logging gap in checks that count entries, like unloggedCallGap.
function hasAnyCommentField(l){
  return !!(String(l.internal_status_comments || '').trim()
    || String(l.stage_comments || '').trim()
    || String(l.last_comment || '').trim()
    || String(l.closing_reason || '').trim());
}

// Your internal_status_comments field (combined with stage_comments via
// combinedCommentsText above) stores a running history like
// "Name: Comment - YYYY-MM-DD HH:MM | Name: Comment - YYYY-MM-DD HH:MM | ..."
// — this parses that into individual attempts matching the SOP's Action Log
// columns (Date, Time, Attempt#, Outcome, CRM Comment, Logged By).
// Outcome is inferred from keywords in the comment text since there's no
// separate Outcome column in the sheet — treat it as best-effort, not exact.
// Parsing the same comment blob is expensive (~150ms across a 7.5k-lead
// sheet) and happens twice per lead — once in enrichLead for multi-agent
// detection, again in renderAlertCard when drawing cards — and re-runs on
// every filter change. The raw text is immutable between refreshes, so
// cache by the string itself. Cleared on each data reload.
const _actionLogCache = new Map();

function parseActionLog(text){
  if (!text || !String(text).trim()) return [];
  const key = String(text);
  const cached = _actionLogCache.get(key);
  if (cached) return cached;

  const entries = key.split('|').map(s => s.trim()).filter(Boolean);
  const parsed = entries.map((entry, i) => {
    const m = entry.match(/^(.*?):\s*(.*?)\s*-\s*(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2})\s*$/);
    let loggedBy = '', comment = entry, ts = null;
    if (m) {
      loggedBy = m[1].trim();
      comment = m[2].trim();
      ts = m[3].trim();
    }
    return { attempt: i + 1, loggedBy, comment, ts, outcome: inferOutcome(comment) };
  });

  _actionLogCache.set(key, parsed);
  return parsed;
}

/* ---------- Fuzzy keyword matching ---------- */
// RMs log outcomes as short telecalling shorthand at least as often as
// full sentences ("RNR", "CB", "NI"), and just as often with a spelling
// mistake typed under time pressure ("buzy", "requriment", "intrested",
// "recieved"). Hand-spelling out every misspelling anyone might type is
// exactly backwards — it grows without bound and still misses the next
// one. Instead, every signal below is checked with typo tolerance: a
// comment word within a small edit distance of a signal word counts as
// that signal, so a spelling mistake attributes to its nearest real
// keyword automatically instead of needing its own hand-added entry.
// Optimal-string-alignment distance — plain edit distance (insert/delete/
// substitute) PLUS an adjacent transposition as a single edit, so the
// "ie"/"ei" swap in "recieved" costs 1 the same way a dropped or doubled
// letter would, not 2. Needs the full 2D table (not a rolling array) since
// the transposition check looks back two rows; words here are always
// short, so that's not a real cost.
function _editDistance(a, b){
  const m = a.length, n = b.length;
  if (!m) return n;
  if (!n) return m;
  // Three rolling rows (this row, one back, two back — the transposition
  // check needs to see two rows back) instead of the full m+1 row table —
  // this runs per word pair, per signal, per comment, across a sheet of
  // thousands of rows, so not allocating m extra arrays per call adds up.
  let twoBack = null;
  let oneBack = new Array(n + 1);
  let cur = new Array(n + 1);
  for (let j = 0; j <= n; j++) oneBack[j] = j;
  for (let i = 1; i <= m; i++){
    cur[0] = i;
    const ai = a[i - 1];
    for (let j = 1; j <= n; j++){
      const cost = ai === b[j - 1] ? 0 : 1;
      let best = Math.min(oneBack[j] + 1, cur[j - 1] + 1, oneBack[j - 1] + cost);
      if (i > 1 && j > 1 && twoBack && ai === b[j - 2] && a[i - 2] === b[j - 1]) {
        best = Math.min(best, twoBack[j - 2] + 1);
      }
      cur[j] = best;
    }
    const tmp = twoBack; twoBack = oneBack; oneBack = cur; cur = (tmp || new Array(n + 1));
  }
  return oneBack[n];
}
// How many edits a word may be off by and still count as a typo of the
// target — scaled by the TARGET's length, not the comment word's, so a
// short telecalling code ("nc", "cb", "wn", "dnd") only ever matches
// itself exactly (one edit away from 2-3 letters is a different word, not
// a typo of it), while a longer word ("requirement") tolerates the single
// dropped/swapped/extra letter an RM actually types. Capped at 2 even for
// very long words — NOT scaled up further — because a 3-edit budget
// turned out to blur genuinely different verb forms that happen to share
// a long root ("disconnected" is 3 edits from "disconnecting", "visit" is
// 2 from "visited"): those are different grammatical forms with different
// meanings here, not typos of one another, and conflating them silently
// misrouted real comments to the wrong outcome.
// The <=4 cutoff (not <=3) was found the hard way: with a 1-edit budget,
// "busy" (4 letters) fuzzy-matched "buy", "bus", and "buys" — genuinely
// different, common, IMPORTANT words (a client saying "buy" is the exact
// opposite signal from a stale line being busy) that just happen to be one
// edit away. At 4 letters there are too many real short words within one
// edit of each other for any of them to safely tolerate a typo; exact
// match only up to that length, same as the 2-3 letter codes.
function _typoBudget(targetLen){
  if (targetLen <= 4) return 0;
  if (targetLen <= 8) return 1;
  return 2;
}
function _wordsMatch(word, target){
  if (word === target) return true;
  const budget = _typoBudget(target.length);
  if (!budget || Math.abs(word.length - target.length) > budget) return false; // cheap pre-filter before the real (more expensive) distance check
  return _editDistance(word, target) <= budget;
}
// Apostrophes are stripped before tokenizing, so "don't"/"didn't"/"can't"
// and the unapostrophed way people actually type on a phone keyboard
// ("dont"/"didnt"/"cant") collapse to the same token — one canonical
// signal covers both instead of needing each spelled out twice.
function _wordsOf(text){
  return String(text).toLowerCase().replace(/'/g, '').match(/[a-z0-9]+/g) || [];
}
// The same ~110 signal strings, across every rule, get tokenized on every
// single comment classified — caching the split means that only happens
// once per DISTINCT signal ever, not once per (signal, comment) pair.
const _signalWordsCache = new Map();
function _signalWordsOf(signal){
  let w = _signalWordsCache.get(signal);
  if (!w) { w = signal.split(' '); _signalWordsCache.set(signal, w); }
  return w;
}
// A signal is one word, or a short space-separated phrase. A single word
// fuzzy-matches ANY word in the comment. A multi-word phrase requires
// that exact sequence to appear consecutively and in order, each word
// individually typo-tolerant — word order is what gives a phrase like
// "not looking" or "switched off" its meaning; a bag-of-words match would
// also fire on an unrelated sentence that happens to contain both words
// separately ("still looking, but not sure" is not "not looking").
function _signalMatches(commentWords, signal){
  const target = _signalWordsOf(signal);
  if (target.length === 1) return commentWords.some(w => _wordsMatch(w, target[0]));
  for (let i = 0; i + target.length <= commentWords.length; i++){
    let ok = true;
    for (let j = 0; j < target.length; j++){
      if (!_wordsMatch(commentWords[i + j], target[j])) { ok = false; break; }
    }
    if (ok) return true;
  }
  return false;
}
function _anySignal(commentWords, signals){
  return signals.some(s => _signalMatches(commentWords, s));
}

// One outcome per entry, checked IN ORDER — the first rule that matches
// wins, same as a real telecaller reading top-to-bottom priority (e.g. a
// request to stop calling overrides whatever else the same comment says,
// so Do Not Disturb is checked before anything else; "booked elsewhere"
// is checked before the generic Not Interested, since it's the more
// specific and more useful signal when a comment mentions both).
// `signals` is the lean list of canonical words/phrases for this outcome
// — typo tolerance (see above) means each one only needs to be spelled
// out ONCE in its correct form, not once per misspelling. `test` is an
// escape hatch for the handful of rules that need independent conditions
// to co-occur without being a single fixed phrase (e.g. "incoming" +
// "barred" anywhere in the comment, not necessarily adjacent).
const OUTCOME_RULES = [
  { outcome: 'Do Not Disturb', signals: ['do not call', 'dont call', 'not to call', 'stop calling', 'dnd'] },
  { outcome: 'Switched Off', signals: [
      'switch off', 'switched off', 'sw off', 'swoff', 'not reachable', 'unreachable', 'not contactable',
      'out of coverage', 'out of service', 'out of network', 'call forwarded', 'call forwarding',
      'voice mail', 'voice message', 'voicemail',
    ], test: (c, w) => _anySignal(w, ['incoming']) && _anySignal(w, ['barred', 'not available']) },
  { outcome: 'Wrong Number', signals: ['wrong number', 'invalid number', 'invalid no', 'wn'] },
  // Customer saw/heard the call and actively ended it — a different
  // signal from RNR (never picked up at all) or Disconnected below (a
  // network/connectivity drop): this one means they chose not to talk, so
  // calling straight back is more likely to annoy than connect.
  { outcome: 'Call Declined', signals: [
      'hung up', 'hangup', 'disconnecting', 'disconnect the call', 'disconnect call', 'declined', 'declining', 'decline',
      'cut the call', 'call cut',
    // Bare "disconnect"/"disconnect -" only, anchored — a plain signal
    // match on the single word 'disconnect' would also swallow
    // "disconnected", which stays its own, later, pre-existing outcome.
    ], test: (c) => /^disconnect\s*-?\s*$/.test(c) },
  // 'buzy' listed explicitly, not left to typo tolerance — see
  // _typoBudget's comment on why 4-letter words match exactly only.
  { outcome: 'Busy', signals: ['busy', 'buzy'] },
  { outcome: 'Booked Elsewhere', signals: [
      'booked elsewhere', 'booked with another', 'purchased elsewhere', 'purchased another',
      'bought elsewhere', 'bought another', 'already bought', 'already purchased',
      'finalized another', 'finalised another', 'gone with another',
    ] },
  // We only sell first-sale (developer/builder to buyer) — a client
  // wanting resale or rental was never in scope, so this is a genuine,
  // valid reason to close, same standing as Booked Elsewhere, not a
  // "lost interest" to chase. 'resale'/'resell'/'second hand'/'to let'
  // name the property TYPE unambiguously, so they're safe as plain
  // signals. "rent"/"rental"/"renting" are NOT — "on rent currently but
  // wants own home" and "currently renting, wants to buy" both contain
  // those words while meaning the OPPOSITE of this outcome (describing
  // the client's PRESENT arrangement, not their ask). The test below only
  // fires when a rent word is paired with an actual seeking verb
  // (want/need/looking/require/search) AND there's no "current(ly)" in
  // the same comment — that combination is what actually distinguishes
  // "I need a place on rent" from "I currently rent".
  { outcome: 'Resale / Rental (Out of Scope)', signals: ['resale', 'resell', 'second hand', 'to let'],
    test: (c, w) => {
      if (!_anySignal(w, ['rent', 'rental', 'renting'])) return false;
      if (_anySignal(w, ['current', 'currently'])) return false;
      return _anySignal(w, ['want', 'wants', 'need', 'needs', 'looking', 'require', 'requires', 'searching', 'search']);
    } },
  { outcome: 'RNR', signals: [
      'rnr', 'cnr', 'nc', 'nr', 'not responding', 'no answer', 'no response', 'not answering', 'not answered',
      'didnt answer', 'not picking', 'did not pick', 'didnt pick', 'pickup the call', 'pick up the call',
      'do not pickup', 'do not pick up', 'call not answered', 'call not received', 'call not receive',
      'not received call', 'not received', 'call not respond', 'call not pick', 'call not picked', 'not receiving',
    ] },
  // Bare "ring" is real telecalling shorthand ("Ring", "ring -") but ALSO
  // a real word in unrelated location context ("near ring road") — a plain
  // word signal would wrongly fire on the latter. The anchored regex only
  // matches when "ring"/"ring -" is the WHOLE comment, the same shape the
  // real shorthand notes actually take, not just any mention of the word.
  { outcome: 'Ringing / RNR', signals: ['ringing'], test: (c) => /^ring\s*-?\s*$/.test(c) },
  // Word-boundary matching (not a bare substring) already keeps "disc"
  // from matching inside "discussed"/"discount"/"disclose" — see
  // _signalMatches, which only ever compares whole tokens.
  { outcome: 'Disconnected', signals: [
      'disconnected', 'call disc', 'disc', 'network issue', 'network problem', 'poor network',
      'call not connecting', 'call not connected', 'call not connect', 'not getting connected',
      'not connecting', 'not connected', 'call drop', 'blank call',
    ] },
  { outcome: 'Out of Station', signals: ['out of station', 'out station', 'out of town', 'not in town', 'travelling'] },
  // Contact has no WhatsApp at all, or it's unreachable there — a
  // different signal from WhatsApp Sent below (a text WAS sent, just not
  // yet answered): this one means texting isn't an option for this
  // contact, so don't keep defaulting back to WhatsApp. Checked first for
  // exactly that reason.
  { outcome: 'WhatsApp Unavailable', test: (c, w) => _anySignal(w, ['whatsapp', 'wp', 'wa']) && _anySignal(w, ['not on', 'not available']) },
  // 'dwm' alone is enough — it already spells out "Dropped WhatsApp
  // Message" as one abbreviation, nothing else needed to confirm it.
  { outcome: 'WhatsApp Sent', signals: ['dwm', 'textedon'],
    // Broadened past the literal word "whatsapp" — "wp"/"wa" shorthand,
    // "whats app"/"whats up" (both common autocorrect mangles of
    // "whatsapp"), and the many verbs RMs actually use for the same
    // action (dropped/shared/sent/pinged/texted a message). Bare "msg"/
    // "message"/"text" without a named channel still counts — in this
    // telecalling shorthand it's WhatsApp by convention. Both "drop" and
    // "dropped" are listed (not just one) deliberately — a 3-letter
    // suffix like "-ped" isn't a typo of the base word, it's a different
    // inflected FORM, so typo-tolerance alone (by design — see
    // _typoBudget) won't bridge "drop" to "dropped" the way it bridges
    // "recieved" to "received". 'textedon' (no space) is the same idea:
    // a missing-space glue of two real words, not a misspelling of one.
    test: (c, w) => _anySignal(w, ['whatsapp', 'whats app', 'whats up', 'wp', 'wa', 'msg', 'mesg', 'message', 'text']) &&
      _anySignal(w, ['drop', 'dropped', 'shared', 'share', 'sent', 'pinged', 'texted']) },
  // Checked before the generic "shared/sent details" match below, since
  // "shared X on whatsapp" would otherwise also satisfy that pattern.
  { outcome: 'Details Shared', test: (c, w) => _anySignal(w, ['shared', 'share', 'sent']) && _anySignal(w, ['detail', 'brochure', 'project', 'info']) },
  // Checked before Visit Arranged below — "visit done"/"visited" is the
  // opposite moment (post-visit) from "visit scheduled"/"visit arranged"
  // (pre-visit), and needs its own follow-up action, not a confirm-
  // attendance reminder for a visit that already happened.
  { outcome: 'Visit Completed', signals: [
      'visit done', 'visited site', 'site visited', 'visit completed', 'came for visit', 'visited the project',
    ] },
  { outcome: 'Visit Arranged', signals: [
      'site visit', 'visit scheduled', 'visit arranged', 'visit booked', 'visit fixed', 'visit confirmed',
      'will visit', 'coming for visit', 'visit planned',
    ] },
  // Checked before Budget Concern — a loan/paperwork update often also
  // mentions amounts, but "in process" is the more specific, more useful
  // signal (keep warm and check status, not "find a cheaper option").
  { outcome: 'Loan In Process', signals: ['document submitted', 'bank process'],
    test: (c, w) => _anySignal(w, ['loan']) && _anySignal(w, ['process', 'sanction', 'approval']) },
  // "not looking"/"no requirement"/"not requirement" cover every "not
  // looking for property"/"not looking any property"/etc. variant on
  // their own (all contain "not looking" as a substring) — a real-estate
  // lead's "not looking" is unambiguous enough in this domain not to need
  // the fuller phrase spelled out.
  { outcome: 'Not Interested', signals: [
      'not interested', 'no interest', 'no longer interested', 'not looking',
      'no requirement', 'not requirement', 'not enquired', 'dropped the plan', 'dropped the idea', 'ni',
    ] },
  // "considering"/"thinking" checked before the bare "interested" match,
  // since a comment like "will think and let us know if interested" should
  // read as still-deciding, not a firm expression of interest.
  { outcome: 'Considering', signals: ['consider', 'think about', 'will think', 'will get back', 'need some time', 'need time', 'will discuss'] },
  { outcome: 'Budget Concern', signals: ['budget', 'expensive', 'too high', 'high price', 'costly', 'cant afford', 'cannot afford', 'out of budget'] },
  { outcome: 'Interested', signals: ['interested'] },
  { outcome: 'DNP', signals: [
      'call again', 'dnp', 'call back', 'callback', 'call later', 'call after', 'call tomorrow',
      'requested callback', 'asked to call', 'cb',
    ] },
  // RM-side admin note (a scheduled follow-up wasn't done in time), not
  // anything the client said — but frequent and unambiguous enough, with
  // a clear next action, to earn a real outcome instead of the generic
  // "no keyword" bucket.
  { outcome: 'Follow-up Missed', signals: ['followup missed', 'follow up missed'] },
];

// Real telecalling shorthand repeats enormously — the same exact comment
// text ("MSG dropped", "Interested", "Busy") gets logged under hundreds of
// different leads (see the Movement tab's Unmatched Comments export, whose
// whole premise is grouping by repeated exact text). Fuzzy signal matching
// is real work per call — a comment that matches nothing sweeps every rule
// before giving up, worst case — so re-running it on text this repetitive,
// once per lead instead of once per DISTINCT text, is the difference
// between a render that's instant and one that visibly freezes the tab on
// a sheet with thousands of rows. Keyed on the untouched input, matching
// exactly what every caller passes.
const _inferOutcomeCache = new Map();
function inferOutcome(comment){
  const cached = _inferOutcomeCache.get(comment);
  if (cached !== undefined) return cached;
  const result = _inferOutcomeUncached(comment);
  _inferOutcomeCache.set(comment, result);
  return result;
}
function _inferOutcomeUncached(comment){
  const c = String(comment).toLowerCase();
  // A placeholder with no real content — a bare "-", ".", "/", or similar
  // punctuation-only note some RMs log when there's nothing to report (by
  // a wide margin the single most common "unmatched" comment in practice —
  // see the Movement tab's Unmatched Comments export). Checked before
  // anything else: there's no keyword TO match here, and without this it
  // fell through to the generic Update/"no clear signal" fallback looking
  // exactly like a genuine unclassifiable comment, when really there's no
  // comment here to classify in the first place.
  if (/^[\s\-_./]+$/.test(c)) return 'No Real Update';
  const words = _wordsOf(c);
  for (const rule of OUTCOME_RULES) {
    if ((rule.signals && _anySignal(words, rule.signals)) || (rule.test && rule.test(c, words))) return rule.outcome;
  }
  return 'Update';
}

// One-time cleanup: an earlier version of this dashboard offered optional
// Claude-reviewed follow-up suggestions, backed by an API key and a
// suggestion cache in local storage. That feature has been removed — this
// clears out any leftover key/cache so nothing unused lingers behind.
try {
  localStorage.removeItem('gsl_claude_api_key');
  localStorage.removeItem('gsl_ai_suggestion_cache_v1');
} catch (e) {}

// One suggested next action per inferOutcome() result — same keyword-based,
// best-effort inference (no separate Outcome column in the sheet), applied
// to region-email issue rows so each lead carries a concrete "what to do
// next" instead of just a bare comment count.
const FOLLOWUP_SUGGESTIONS = {
  'Do Not Disturb': "Client asked not to be called — stop calling immediately, log as DND, and only re-engage via an approved channel (SMS/email) if policy allows.",
  'Switched Off': 'Phone was switched off, out of service/network, or otherwise unreachable — retry later today; try an alternate number if one is on file.',
  'Wrong Number': 'Number appears incorrect — verify the contact number with the source/RM before calling again.',
  'Call Declined': "Customer saw or heard the call and actively ended/declined it — they're avoiding contact right now, so calling straight back is more likely to annoy than connect. Try a different time of day, or switch to WhatsApp/SMS first.",
  'Busy': 'Line was busy — retry within a few hours.',
  'Booked Elsewhere': "Client says they've booked/purchased elsewhere — confirm this is genuinely final before closing; don't assume dead until it's verified.",
  'Resale / Rental (Out of Scope)': "Client is looking for resale or rental, not a new first-sale (developer/builder) property — we don't work that segment. Close with this as the reason rather than treating it as lost interest.",
  'RNR': 'No response — retry at a different time of day; consider a WhatsApp follow-up.',
  'Ringing / RNR': 'Rang but no pickup — retry at a different time of day.',
  'Disconnected': "Call dropped, didn't connect, or connected with no response — retry; flag the number if this keeps happening.",
  'Out of Station': "Client is travelling — schedule the follow-up for when they're back rather than repeat-calling now.",
  'WhatsApp Unavailable': "This contact isn't reachable on WhatsApp (or doesn't have it) — stick to voice calls or SMS instead of defaulting back to a WhatsApp text.",
  'WhatsApp Sent': 'A WhatsApp/text message was sent or dropped but not yet followed by a call — a text may go unseen, call to confirm.',
  'Details Shared': 'Project details were shared — follow up to gauge interest and answer any questions before it goes cold.',
  'Visit Completed': "Site visit already happened — call within 24 hours for feedback while it's fresh, and push toward the next concrete step.",
  'Visit Arranged': 'A site visit is arranged — confirm attendance close to the date, and follow up right after for feedback.',
  'Loan In Process': "Loan/paperwork is in process on their end — check status periodically and keep them warm, don't let this go cold.",
  'Not Interested': 'Client indicated no interest (or no current requirement) — confirm this is final, then close with a clear reason if so.',
  'Considering': 'Client is still deciding — schedule a follow-up in a few days rather than calling again immediately.',
  'Budget Concern': 'Budget was raised as a concern — check for a better-fit option or payment plan before the next call.',
  'Interested': 'Client showed interest — move quickly to the next step (site visit, documents, or pricing).',
  'DNP': 'Client asked to be called back later — schedule the follow-up call.',
  'Follow-up Missed': 'A scheduled follow-up was missed — reach out right away to catch up before it goes any staler.',
  'No Real Update': "RM logged a placeholder with no real content — there's nothing here to act on from the comment alone. Call and get an actual status update, then log what was actually said.",
};

// Fallback for when inferOutcome finds no keyword match at all (a comment
// that's real information — e.g. "looking for 3bhk 3t, pitch tvs or
// purvankara" — just doesn't contain any of the known outcome keywords).
// Previously this returned a generic "read the comments above" line, which
// is actively unhelpful: the comment itself isn't shown anywhere else in
// most callers (email issue tables only carry Lead ID/Region/RM/Age/this
// column), so the one thing that would let a human actually act on it was
// being thrown away. Quoting the real latest note beats a canned message.
function unmatchedFollowUp(comment, loggedBy, ts){
  const text = String(comment || '').trim();
  if (!text) return 'Manual review required — no keyword match found even after checking this customer\'s other RM copies. Read the comments above and log a specific next call/action; do not leave this one unactioned.';
  const who = String(loggedBy || '').trim();
  const when = ts ? istStamp(ts) : '';
  const attribution = [who, when].filter(Boolean).join(', ');
  return `No keyword match — latest note${attribution ? ` (${attribution})` : ''}: "${text}". Read this and log a specific next call/action.`;
}

// Pools every comment-ish signal across a customer's full family (this copy
// + siblingComments — see copySplits in fetchAndRender/computeMovementRows)
// and returns the single most recent one as {outcome, comment, loggedBy, ts},
// or null if the family has no structured action-log entry AND no
// last_comment anywhere. Shared by suggestedFollowUp below (tiers 1-2) and
// the Possible Premature Closes check in buildRegionWiseReports — both need
// "what did this customer most recently say," just for different purposes.
// Priority order:
//   1. The structured action log (combinedCommentsText) across every copy
//      in the family, pooled together — the single MOST RECENT entry across
//      the WHOLE family wins, found by actual timestamp (falls back to the
//      last one parsed if nothing carries a date).
//   2. last_comment, checked across every copy in the family — only once
//      NOT ONE copy in the family has a single dated structured entry.
function latestFamilyOutcome(l){
  const family = [l].concat(l.siblingComments || []);

  const entries = [];
  family.forEach(copy => {
    parseActionLog(combinedCommentsText(copy)).forEach(e => entries.push(e));
  });
  if (entries.length) {
    let latest = entries[entries.length - 1];
    let newestMs = -Infinity;
    entries.forEach(e => {
      if (!e.ts) return;
      const d = parseDate(e.ts);
      if (d && d.getTime() > newestMs) { newestMs = d.getTime(); latest = e; }
    });
    return { outcome: latest.outcome, comment: latest.comment, loggedBy: latest.loggedBy, ts: latest.ts };
  }

  for (const copy of family) {
    const lastComment = String(copy.last_comment || '').trim();
    if (lastComment) {
      return { outcome: inferOutcome(lastComment), comment: lastComment, loggedBy: copy.RM, ts: null };
    }
  }

  return null;
}

// Same family-pooling as latestFamilyOutcome above, but returns every
// structured entry instead of picking just the newest one — feeds the
// Lead_Followups export (pushLeadsToFollowups), where the point is the
// whole history, not a single best-guess line. A copy that contributed no
// structured action-log entry at all still gets one entry here from its
// last_comment (same fallback tier latestFamilyOutcome uses), so a copy
// that only ever got a plain comment isn't silently missing from the
// collated result. Sorted oldest-first — dated entries before undated
// ones, since undated entries have no real position to sort by.
// One copy's own comment entries — structured action-log entries if it has
// any, else a single fallback entry from last_comment (same fallback tier
// latestFamilyOutcome uses), so a copy that only ever got a plain comment
// isn't silently missing from the result. fallbackRM covers a log line that
// didn't parse a logger name (falls back to the copy's own RM, then the
// requesting row's RM). Factored out of collateFamilyComments below so a
// single copy's comments can be read on their own (see ownComments) without
// pulling in every sibling's too.
function commentsForCopy(copy, fallbackRM){
  const entries = [];
  const copyEntries = parseActionLog(combinedCommentsText(copy));
  if (copyEntries.length) {
    // e.loggedBy is who the log line itself says wrote THIS comment — not
    // necessarily copy.RM, the lead's CURRENT assignee, which can differ
    // after a reassignment. Prefer the actual logger; only fall back to
    // the current assignee when the log line didn't parse a name.
    copyEntries.forEach(e => entries.push({ RM: e.loggedBy || copy.RM || fallbackRM || 'Unassigned', comment: e.comment, timestamp: e.ts, outcome: e.outcome }));
    return entries;
  }
  const lastComment = String(copy.last_comment || '').trim();
  if (lastComment) {
    entries.push({ RM: copy.RM || fallbackRM || 'Unassigned', comment: lastComment, timestamp: null, outcome: inferOutcome(lastComment) });
  }
  return entries;
}

// Oldest-first — dated entries before undated ones, since undated entries
// have no real position to sort by. Shared by collateFamilyComments and
// ownComments below so the two lists always order the same way.
function sortCommentEntries(entries){
  return entries.sort((a, b) => {
    const da = a.timestamp ? parseDate(a.timestamp) : null;
    const db = b.timestamp ? parseDate(b.timestamp) : null;
    if (da && db) return da - db;
    if (da) return -1;
    if (db) return 1;
    return 0;
  });
}

// Lead_Followups export (pushLeadsToFollowups), where the point is the
// whole history, not a single best-guess line. A copy that contributed no
// structured action-log entry at all still gets one entry here from its
// last_comment.
function collateFamilyComments(row){
  const family = [row].concat(row.siblingComments || []);
  const entries = [];
  family.forEach(copy => entries.push(...commentsForCopy(copy, row.RM)));
  return sortCommentEntries(entries);
}

// Same idea as collateFamilyComments, but for THIS row's own copy only —
// no sibling RMs' comments mixed in. Lead_Followups' own_comments column
// uses this so a reader can tell, at a glance, what THIS specific RM
// actually logged on THIS specific copy, separate from collated_comments'
// whole-customer picture.
function ownComments(row){
  return sortCommentEntries(commentsForCopy(row, row.RM));
}

// Suggested follow-up for a lead — mandatory best-effort: checked across
// every comment-ish column of THIS copy AND every sibling copy of the
// SAME customer, not just this one card's own fields. A customer's real
// next step should be assessed from the full picture across every RM who's
// touched them — a copy with nothing logged of its own can still often be
// answered from what a sibling copy recorded. Priority order:
//   1-2. latestFamilyOutcome above (structured action log, then last_comment).
//   3. closing_reason, checked across every copy — the only signal left
//      when a copy closed without anything else logged.
//   4. noCommentsFallback (or the generic default) once ALL of the above
//      are genuinely empty on EVERY copy in the family. Lets a caller
//      substitute its own wording (e.g. Overnight Leads' "Connect ASAP")
//      for that last case only.
function suggestedFollowUp(l, noCommentsFallback){
  const latest = latestFamilyOutcome(l);
  if (latest) {
    return FOLLOWUP_SUGGESTIONS[latest.outcome] || unmatchedFollowUp(latest.comment, latest.loggedBy, latest.ts);
  }

  const family = [l].concat(l.siblingComments || []);
  for (const copy of family) {
    // lead_closing_reason/lead_closing_comment (the sheet's own closing
    // disposition) preferred over the RM-entered closing_reason when
    // present — see the matching note in computeStatusChanges.
    const reason = String(copy.lead_closing_reason || copy.closing_reason || '').trim();
    if (reason) {
      const detail = String(copy.lead_closing_comment || '').trim();
      const full = detail ? `${reason} — ${detail}` : reason;
      return `Lead closed (${full}) — no further follow-up needed unless it's reopened.`;
    }
  }

  return noCommentsFallback || 'No comments logged yet — make first contact and log the outcome.';
}

// Inner markup only — no wrapper div, so it can be injected into the
// pre-existing .action-log container on first toggle.
function actionLogTableMarkup(entries){
  if (!entries || !entries.length) return '';
  const rows = entries.map(e => {
    let dateStr = '', timeStr = '';
    if (e.ts) {
      const d = parseDate(e.ts);
      if (d) {
        // Same 12-hour IST convention as everywhere else in the dashboard.
        const p2 = n => String(n).padStart(2, '0');
        const dp = istParts(d);
        dateStr = `${dp.y}-${p2(dp.mo+1)}-${p2(dp.d)}`;
        let hh = dp.h;
        const ap = hh >= 12 ? 'PM' : 'AM';
        hh = hh % 12; if (hh === 0) hh = 12;
        timeStr = `${p2(hh)}:${p2(dp.mi)} ${ap}`;
      } else {
        dateStr = e.ts;
      }
    }
    return `<tr>
      <td>${esc(dateStr)}</td><td>${esc(timeStr)}</td>
      <td class="num">${e.attempt} of ${entries.length}</td>
      <td>${esc(e.outcome)}</td>
      <td>${esc(e.comment)}</td>
      <td>${esc(e.loggedBy)}</td>
    </tr>`;
  }).join('');
  return `<table class="mini-log-table">
      <thead><tr><th>Date</th><th>Time</th><th>Attempt</th><th>Outcome</th><th>CRM Comment</th><th>Logged By</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
}

// Single source of truth for every timestamp shown anywhere: 12-hour clock,
// labelled IST. Date stays YYYY-MM-DD so 07/08 can't be misread as 8 Jul.
// Sheet timestamps carry no timezone marker and are already IST, so the
// components are read back unchanged rather than converted — running them
// through a timezone shift would double-offset them.
function istStamp(v){
  const d = parseDate(v);
  if (!d) return String(v || '—');
  const p = istParts(d);
  const pad = n => String(n).padStart(2, '0');
  let h = p.h;
  const ampm = h >= 12 ? 'PM' : 'AM';
  h = h % 12;
  if (h === 0) h = 12;
  return `${p.y}-${pad(p.mo + 1)}-${pad(p.d)} ${pad(h)}:${pad(p.mi)} ${ampm} IST`;
}
// Kept as aliases so existing call sites all resolve to the same format.
const isoStampIST = istStamp;
const isoStamp = istStamp;

// Raw minute counts stop being readable fast — "1164 working min" is really
// about 2.4 working days, which nobody computes in their head. Scale the
// unit to the magnitude.
function fmtWorkingWait(mins, suffix){
  suffix = suffix || 'waiting';
  if (mins == null) return '';
  if (mins < 60) return `${Math.round(mins)} min ${suffix}`;
  const hrs = mins / 60;
  if (hrs < 10) return `${hrs.toFixed(1)} working hrs ${suffix}`;
  const workDays = hrs / (CONFIG.WORK_END_HOUR - CONFIG.WORK_START_HOUR);
  return `${hrs.toFixed(0)} working hrs (~${workDays.toFixed(1)} work days) ${suffix}`;
}

// Relocated from dashboard.html's inline script (Phase 4 file-split) — generic
// cross-cutting UI utilities used across multiple tabs, so they live in
// core.js rather than any one tab file.
// Generic show/hide for a details block dynamically inserted right after
// an .info-toggle button (dedupeNotice's summary line, rebuilt on every
// fetch, rather than the static per-section explainers below which wire up
// once via initCollapsibleSectionInfo).
function toggleInlineDetail(btn){
  const el = btn.parentElement && btn.parentElement.nextElementSibling;
  if (!el) return;
  const opening = el.style.display === 'none';
  el.style.display = opening ? 'block' : 'none';
  btn.textContent = opening ? '▾ Hide' : (btn.dataset.label || 'ⓘ Details');
}

// Every section-head is followed by a filter-summary paragraph explaining
// exactly what the section does and doesn't include — genuinely useful,
// but rendering all ~20 of them in full meant reading several screens of
// documentation before reaching the first actual lead card. Collapsed
// behind a one-click "Why this section exists" toggle instead; nothing
// about the text itself changes, and no section had to be edited by hand
// to get this — it wires up generically off the existing section-head +
// filter-summary structure every section already has.
function initCollapsibleSectionInfo(){
  document.querySelectorAll('.section-head + .filter-summary').forEach(el => {
    el.style.display = 'none';
    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'info-toggle';
    toggle.textContent = 'ⓘ Why this section exists';
    toggle.setAttribute('aria-expanded', 'false');
    toggle.addEventListener('click', () => {
      const opening = el.style.display === 'none';
      el.style.display = opening ? 'block' : 'none';
      toggle.setAttribute('aria-expanded', String(opening));
      toggle.textContent = opening ? '▾ Hide' : 'ⓘ Why this section exists';
    });
    el.parentNode.insertBefore(toggle, el);
  });
}
