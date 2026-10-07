// ============================================================
// reports-gmail.js — real one-click sending via the Gmail API: the
// OAuth token lifecycle (separate consent grant from the Sheets
// sign-in gate in core-auth.js — see this file's own header comment
// below), the sent-log (localStorage dedupe so a report doesn't
// silently get sent twice), and the raw-MIME email encoding
// (buildRawEmail/utf8ToBase64/toBase64Url). Split out of reports.js
// (Phase 3 — see HANDOVER.md). Pure code motion — no logic changed.
//
// MUST load before reports-ui.js: reports-ui.js's own top-level init
// block calls initGmailUI() immediately at parse time (see that file's
// header comment for why — the same TDZ hazard reports.js's original
// header warned about for initMovementUI). No top-level side effects
// of its own here, so this file's position relative to
// reports-build.js doesn't matter.
// ============================================================

/* ============ REAL SEND VIA GMAIL API (no mail client involved) ============
 * mailto only ever opens a compose window — a human still has to click Send
 * there. This is genuine one-click sending: Google Identity Services (GIS,
 * loaded in <head>) authorizes a short-lived Gmail-send token via OAuth,
 * then the Gmail REST API sends the message directly from the browser.
 * Fully client-side — no backend, no stored secret. The OAuth Client ID
 * is a PUBLIC identifier (every "Sign in with Google" button ships one in
 * its page source) and is fine to keep in localStorage; the access token
 * GIS returns lives in memory only, is never persisted, and expires on
 * Google's own ~1h schedule.
 *
 * Requires the dashboard to be served over http/https — GIS does not
 * complete sign-in from a local file:// page. See the Gmail setup panel
 * in the HTML for the one-time Google Cloud steps.
 */
const GMAIL_CLIENT_ID_KEY = 'gsl_gmail_client_id';
const GMAIL_SCOPE = 'https://www.googleapis.com/auth/gmail.send https://www.googleapis.com/auth/userinfo.email';

// The Client ID is a public identifier by design (Google's own docs: it is
// not treated as a secret) — safe to hardcode into client-side HTML. This
// is what lets a brand-new browser skip straight to "Sign in with Google"
// with no separate "paste your Client ID" step first. localStorage still
// wins if someone's explicitly saved a different one (e.g. pointing at a
// different Cloud project).
const DEFAULT_CLIENT_ID = '888792607049-4u0ok266girae40pt4o1m74uhn08rg19.apps.googleusercontent.com';

let gmailTokenClient = null;
let gmailAccessToken = '';
let gmailTokenExpiresAt = 0;
let gmailUserEmail = '';
let _pendingGmailSend = null; // { report, to, cc, btnId } — sent once a token arrives

// Keyed by report SUBJECT (not array index/btnId) — subjects are
// deterministic from region + issue + date, so this survives a report list
// being regenerated (different array order, different index) and still
// recognizes "this exact report already went out this hour". Persisted in
// localStorage, not just in-memory, so the "Sent" state (and the 1-hour
// resend window) survives a page reload too.
const GMAIL_SENT_LOG_KEY = 'gsl_gmail_sent_log';
const GMAIL_SENT_WINDOW_MS = 60 * 60 * 1000;

function loadGmailSentLog(){
  try {
    const v = JSON.parse(localStorage.getItem(GMAIL_SENT_LOG_KEY) || '{}');
    return (v && typeof v === 'object') ? v : {};
  } catch (e) { return {}; }
}
function markReportSent(subject){
  const log = loadGmailSentLog();
  log[subject] = Date.now();
  // Prune while we're here so this doesn't grow forever across days of use.
  const cutoff = Date.now() - GMAIL_SENT_WINDOW_MS;
  Object.keys(log).forEach(k => { if (log[k] < cutoff) delete log[k]; });
  try { localStorage.setItem(GMAIL_SENT_LOG_KEY, JSON.stringify(log)); } catch (e) {}
}
// null once past the 1-hour window, so callers don't need to re-check age.
function gmailSentAt(subject){
  const ts = loadGmailSentLog()[subject];
  if (!ts || Date.now() - ts >= GMAIL_SENT_WINDOW_MS) return null;
  return ts;
}

// Paints a Gmail-send button as either its normal "Send via Gmail" face or
// (when this exact report subject was sent within the last hour) a
// "Sent ✓ — click to resend" face — the button stays enabled either way,
// so a second click always just sends again; nothing here disables it.
// Also arms a timer to flip it back automatically once the hour is up, so
// a tab left open on the report list doesn't need a click or refresh to
// notice the window closed.
function applyGmailButtonState(btn, subject){
  if (!btn) return;
  clearTimeout(btn._gmailRevertTimer);
  const sentAt = gmailSentAt(subject);
  if (sentAt) {
    btn.textContent = 'Sent ✓ — click to resend';
    btn.classList.add('copied');
    btn.title = 'Sent via Gmail within the last hour — click to send again';
    const remaining = GMAIL_SENT_WINDOW_MS - (Date.now() - sentAt);
    btn._gmailRevertTimer = setTimeout(() => applyGmailButtonState(btn, subject), Math.max(0, remaining) + 50);
  } else {
    btn.textContent = 'Send via Gmail';
    btn.classList.remove('copied');
    btn.title = 'Sends immediately via the Gmail API — no mail client, no extra click';
  }
}
// Applies applyGmailButtonState to every report row just rendered, so
// reports sent within the last hour immediately show "Sent" on a fresh
// render (regenerating the list, switching tabs and back, reloading the
// page) rather than only updating after their own button is next clicked.
function applyGmailButtonStatesFor(reports, btnIdFn){
  (reports || []).forEach((r, i) => {
    if (!r) return;
    applyGmailButtonState(document.getElementById(btnIdFn(i)), r.subject);
  });
}

function getGmailClientId(){
  try { return (localStorage.getItem(GMAIL_CLIENT_ID_KEY) || DEFAULT_CLIENT_ID).trim(); } catch (e) { return DEFAULT_CLIENT_ID; }
}
function setGmailClientId(id){
  try { localStorage.setItem(GMAIL_CLIENT_ID_KEY, id.trim()); } catch (e) {}
}

function gmailTokenValid(){
  return !!gmailAccessToken && Date.now() < gmailTokenExpiresAt - 5000;
}

function updateGmailStatusUI(){
  const el = document.getElementById('gmailAuthStatus');
  const connectBtn = document.getElementById('gmailConnectBtn');
  if (!el) return;
  if (gmailTokenValid()) {
    el.textContent = gmailUserEmail ? `Connected as ${gmailUserEmail}` : 'Connected';
    el.style.color = 'var(--green)';
    if (connectBtn) connectBtn.textContent = 'Reconnect Gmail';
  } else {
    el.textContent = 'Not connected';
    el.style.color = 'var(--text-faint)';
    if (connectBtn) connectBtn.textContent = 'Connect Gmail';
  }
}

// Cosmetic only (shows whose account reports will send from) — failure here
// doesn't block sending, since gmail.send doesn't itself require this scope.
async function fetchGmailUserEmail(){
  try {
    const resp = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
      headers: { Authorization: `Bearer ${gmailAccessToken}` },
    });
    if (resp.ok) {
      const data = await resp.json();
      gmailUserEmail = data.email || '';
    }
  } catch (e) { /* non-fatal */ }
  updateGmailStatusUI();
}

function initGmailTokenClient(clientId){
  if (typeof google === 'undefined' || !google.accounts || !google.accounts.oauth2) return null;
  return google.accounts.oauth2.initTokenClient({
    client_id: clientId,
    scope: GMAIL_SCOPE,
    callback: (resp) => {
      if (resp.error) {
        const el = document.getElementById('gmailAuthStatus');
        if (el) { el.textContent = 'Sign-in failed: ' + resp.error; el.style.color = 'var(--red)'; }
        gmailAccessToken = '';
        _pendingGmailSend = null;
        return;
      }
      gmailAccessToken = resp.access_token;
      gmailTokenExpiresAt = Date.now() + (Number(resp.expires_in) || 3600) * 1000;
      fetchGmailUserEmail();
      updateGmailStatusUI();
      // A Send click that triggered this connect flow completes automatically
      // once the token lands — no second click needed, for either a single
      // report's Send button or a bulk "Send all" click.
      if (_pendingGmailSend) {
        const pending = _pendingGmailSend;
        _pendingGmailSend = null;
        if (pending.kind === 'bulk') {
          _runBulkGmailSend(pending.reports, pending.btnIdFn, pending.statusElId, pending.confirmText);
        } else {
          performGmailSend(pending).then(() => _alertIfGmailSendBlocked(pending));
        }
      }
    },
  });
}

// A single report's Send button gives the user only the button face to read, so a send the safety gate refused also says
// so plainly (the bulk flow reports blocked sends in its own status line instead).
function _alertIfGmailSendBlocked(pending){
  if (pending && pending.blockedReason) alert('Not sent — the safety check refused this email:\n\n' + pending.blockedReason);
}

function connectGmail(){
  const clientId = getGmailClientId();
  if (!clientId) {
    const panel = document.getElementById('gmailSetupPanel');
    if (panel) { panel.style.display = 'block'; panel.scrollIntoView({ behavior: 'smooth', block: 'center' }); }
    return;
  }
  if (!gmailTokenClient) gmailTokenClient = initGmailTokenClient(clientId);
  if (!gmailTokenClient) {
    const el = document.getElementById('gmailAuthStatus');
    if (el) { el.textContent = 'Google Sign-In library still loading — try again in a moment'; el.style.color = 'var(--amber)'; }
    return;
  }
  gmailTokenClient.requestAccessToken({ prompt: gmailAccessToken ? '' : 'consent' });
}

function saveGmailClientId(){
  const input = document.getElementById('gmailClientIdInput');
  if (!input) return;
  setGmailClientId(input.value);
  gmailTokenClient = null; // rebuild against the new client id
  connectGmail();
}

// RFC 2047 header + raw-message encoding. Reports contain non-ASCII
// characters (em dashes, arrows), so both the Subject header and the
// base64url body encoding go through real UTF-8 byte conversion rather
// than btoa() directly, which only handles Latin-1.
function utf8ToBase64(str){
  const bytes = new TextEncoder().encode(str);
  // Chunked String.fromCharCode + array-join instead of the old
  // `binary += String.fromCharCode(b)` per byte — repeated string
  // concatenation in a loop is O(n) per append in the worst case, O(n^2)
  // overall for a long string, and this runs on the FULL email
  // subject/body before every Gmail send (perf pass, 2026-08-28).
  // 8192-byte chunks stay well under String.fromCharCode/apply's
  // argument-count ceiling while still cutting the number of
  // intermediate strings created by ~8192x.
  const CHUNK = 8192;
  const parts = [];
  for (let i = 0; i < bytes.length; i += CHUNK) {
    parts.push(String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK)));
  }
  return btoa(parts.join(''));
}
function encodeHeaderUtf8(str){
  return /^[\x00-\x7F]*$/.test(str) ? str : `=?UTF-8?B?${utf8ToBase64(str)}?=`;
}
function toBase64Url(str){
  return utf8ToBase64(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
// htmlBody is optional. When present, sends multipart/alternative with
// BOTH the plain text and HTML parts — standard practice for HTML email,
// not just belt-and-suspenders: it's what lets a plain-text-preferring
// client (or spam filter) fall back gracefully instead of only ever
// offering the styled version.
function buildRawEmail(to, cc, subject, body, htmlBody){
  const headers = [
    `To: ${to}`,
    cc ? `Cc: ${cc}` : null,
    `Subject: ${encodeHeaderUtf8(subject)}`,
    'MIME-Version: 1.0',
  ];

  if (!htmlBody) {
    headers.push('Content-Type: text/plain; charset="UTF-8"', 'Content-Transfer-Encoding: 8bit');
    return toBase64Url(`${headers.filter(Boolean).join('\r\n')}\r\n\r\n${body}`);
  }

  const boundary = 'gsl_boundary_' + Math.random().toString(36).slice(2);
  headers.push(`Content-Type: multipart/alternative; boundary="${boundary}"`);
  const parts =
    `--${boundary}\r\nContent-Type: text/plain; charset="UTF-8"\r\nContent-Transfer-Encoding: 8bit\r\n\r\n${body}` +
    `\r\n--${boundary}\r\nContent-Type: text/html; charset="UTF-8"\r\nContent-Transfer-Encoding: 8bit\r\n\r\n${htmlBody}` +
    `\r\n--${boundary}--`;
  return toBase64Url(`${headers.filter(Boolean).join('\r\n')}\r\n\r\n${parts}`);
}

/* ============ SEND-SAFETY GATE (email audit P11 / F19) ============
 * performGmailSend used to hand whatever it was given straight to the Gmail API: nothing checked that a recipient was a
 * real address, that the subject/body had any content, or that a line break hidden in a recipient cell or subject could not
 * become an extra header (buildRawEmail pastes `to`/`cc`/subject into the MIME header block). The Apps Script emailers have
 * had this gate since P1 (EmailInfra.gs prepareOutgoingEmailGs_) — this is its browser twin, applied at the one place every
 * browser send funnels through. A blocked send NEVER reaches the Gmail API.
 *
 * Kept in parity BY HAND with EmailInfra.gs (a regex literal and functions are invisible to test/check-runtime-parity.py —
 * HANDOVER.md section 6 lists the pair): GMAIL_ADDRESS_RE = EMAIL_ADDRESS_RE_, gmailAddressListProblems =
 * emailAddressListProblemsGs_, gmailVisibleText = visibleTextOfHtmlGs_. The same address vectors are asserted on both sides
 * (tests/frontend-harness.html 2k / Tests_EmailInfra.gs). Unlike the backend gate this one does not check lead ids: a
 * browser report carries a lead COUNT, not the list, and a combined report can legitimately count zero in its numbered
 * sections.
 */
const GMAIL_ADDRESS_RE = /^[^\s@<>,;"()\[\]\\]+@[^\s@<>,;"()\[\]\\]+\.[^\s@<>,;"()\[\]\\]+$/;

// Problems with an address list ([] = fine). The list may be comma/semicolon separated (how the Region recipients table
// stores it). `required`: an empty list is itself a problem.
function gmailAddressListProblems(list, fieldName, required){
  const raw = Array.isArray(list) ? list.join(',') : String(list == null ? '' : list);
  const parts = raw.split(/[,;]+/).map(s => s.trim()).filter(Boolean);
  if (!parts.length) return required ? [`${fieldName} is empty`] : [];
  const problems = [];
  parts.forEach(a => {
    if (!GMAIL_ADDRESS_RE.test(a)) problems.push(`${fieldName} has an invalid address "${a.replace(/[\r\n]+/g, ' ')}"`);
  });
  return problems;
}

// The text a reader would actually see in an HTML body — style/script/head blocks and tags removed, entities decoded,
// whitespace collapsed. An HTML body that is all markup (empty cells, an empty table) has no visible text.
function gmailVisibleText(html){
  return String(html == null ? '' : html)
    .replace(/<(style|script|head)[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;|&#160;/gi, ' ')
    .replace(/&lt;/gi, '<').replace(/&gt;/gi, '>').replace(/&quot;/gi, '"').replace(/&#39;/gi, "'").replace(/&amp;/gi, '&')
    .replace(/\s+/g, ' ').trim();
}

// Normalises one browser send and returns { msg: <the exact payload that will be sent>, problems: [...] }. CR/LF in the
// subject are collapsed (a header can never carry a line break). At least one of To/Cc must hold an address (the Region
// recipients table can legitimately be Cc-only), and every address in either must be well formed.
function prepareGmailSend(report, to, cc){
  const r = report || {};
  const toList = Array.isArray(to) ? to.join(',') : String(to == null ? '' : to).trim();
  const ccList = Array.isArray(cc) ? cc.join(',') : String(cc == null ? '' : cc).trim();
  const subject = String(r.subject == null ? '' : r.subject).replace(/[\r\n]+/g, ' ').trim();
  const body = r.body == null ? '' : String(r.body);
  const html = r.html == null || r.html === '' ? undefined : String(r.html);

  const problems = [];
  if (!report) problems.push('there is no report to send');
  const hasAddress = (toList + ',' + ccList).split(/[,;]+/).some(s => s.trim());
  if (!hasAddress) problems.push('there is no recipient (To and Cc are both empty)');
  problems.push(...gmailAddressListProblems(toList, 'To', false));
  problems.push(...gmailAddressListProblems(ccList, 'Cc', false));
  if (!subject) problems.push('the subject is empty');
  if (!body.trim()) problems.push('the plain-text body is empty or whitespace-only');
  if (html !== undefined && !gmailVisibleText(html)) problems.push('the HTML body has no visible text');
  return { msg: { to: toList, cc: ccList, subject, body, html }, problems };
}

// Returns true/false so a bulk caller (sendAllReportsGmail below) can track
// how many of a batch actually went through. A send the safety gate (prepareGmailSend, above) REFUSES also returns false, but
// first records why on `pending.blockedReason` — that is how a caller tells "blocked, nothing sent" from "the Gmail call
// failed" without a new return shape.
async function performGmailSend(pending){
  const { report, to, cc, btnId } = pending;
  const btn = btnId ? document.getElementById(btnId) : null;
  const prepared = prepareGmailSend(report, to, cc);
  if (prepared.problems.length) {
    const reason = prepared.problems.join('; ');
    pending.blockedReason = reason;
    console.error('Gmail send BLOCKED by the send-safety gate (nothing was sent):', reason, report && report.subject);
    if (btn) {
      btn.disabled = false;
      btn.textContent = 'Blocked ✗';
      btn.title = 'Not sent: ' + reason;
      btn.style.borderColor = 'var(--red)';
      // Longer than a plain failure's 3s so the tooltip can actually be read.
      setTimeout(() => { btn.style.borderColor = ''; applyGmailButtonState(btn, report && report.subject); }, 6000);
    }
    return false;
  }
  if (btn) { btn.disabled = true; btn.textContent = 'Sending…'; }
  try {
    // The normalised payload (CR/LF collapsed, addresses trimmed) is what is sent; the Sent-state key and the Send_Log row
    // below keep using the report's own subject so a resend within the hour is still recognised.
    const raw = buildRawEmail(prepared.msg.to, prepared.msg.cc, prepared.msg.subject, prepared.msg.body, prepared.msg.html);
    const resp = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
      method: 'POST',
      headers: { Authorization: `Bearer ${gmailAccessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ raw }),
    });
    if (!resp.ok) {
      const errBody = await resp.json().catch(() => ({}));
      throw new Error((errBody.error && errBody.error.message) || `Gmail API error ${resp.status}`);
    }
    markReportSent(report.subject);
    // Durable, shared, issue-wise send log (Send_Log sheet tab) — separate
    // from markReportSent's local-only "Sent ✓" button state above. Not
    // awaited: this is best-effort logging, not part of the send itself
    // (see logEmailSend's own comment), so it shouldn't hold up the button
    // state update or the caller.
    logEmailSend(report, to, cc);
    if (btn) {
      btn.disabled = false;
      applyGmailButtonState(btn, report.subject);
    }
    return true;
  } catch (err) {
    console.error('Gmail send failed:', err);
    if (btn) {
      btn.disabled = false;
      btn.textContent = 'Failed ✗';
      btn.style.borderColor = 'var(--red)';
      // A failed RESEND (button was already showing "Sent" from an earlier
      // success) should fall back to that Sent state, not a bare "Send via
      // Gmail" — the earlier send still went through fine. applyGmailButtonState
      // figures out which one is correct from the log rather than assuming.
      setTimeout(() => { btn.style.borderColor = ''; applyGmailButtonState(btn, report.subject); }, 3000);
    }
    return false;
  }
}

async function sendReportViaGmail(report, btnId){
  if (!report) return;
  if (!getGmailClientId()) {
    const panel = document.getElementById('gmailSetupPanel');
    if (panel) { panel.style.display = 'block'; panel.scrollIntoView({ behavior: 'smooth', block: 'center' }); }
    return;
  }
  const { to, cc, missing } = await recipientsForReport(report);
  if (!to && !cc) {
    flagMissingRegionRecipients(missing.length ? missing : (report.regionNames || [report.region]));
    return;
  }
  const pending = { kind: 'single', report, to, cc, btnId };
  if (gmailTokenValid()) {
    performGmailSend(pending).then(() => _alertIfGmailSendBlocked(pending));
  } else {
    _pendingGmailSend = pending;
    connectGmail(); // performGmailSend fires from the token callback once granted
  }
}

function sendRegionReportGmail(idx){
  sendReportViaGmail(window._regionReports && window._regionReports[idx], 'gmailBtn_' + idx);
}

function sendAllReportGmail(i){
  sendReportViaGmail(_allReports[i], 'gmailAllBtn_' + i);
}

// The actual confirm+send loop, factored out so it can run either right
// after sendAllReportsGmail's own token-valid check, or later from the
// OAuth token callback once a connect-then-resume completes (see
// _pendingGmailSend below). Not Promise.all — a burst of simultaneous
// sends is more likely to trip Gmail's own rate limiting, and going one at
// a time lets each card's own button reflect real progress as it happens
// (via performGmailSend's existing btnId handling).
async function _runBulkGmailSend(reports, btnIdFn, statusElId, confirmText){
  if (!confirm(confirmText || `Send all ${reports.length} emails now?`)) return;

  const missingRegions = new Set();
  let sent = 0, failed = 0, blocked = 0;
  for (let i = 0; i < reports.length; i++) {
    const report = reports[i];
    const { to, cc, missing } = await recipientsForReport(report);
    if (!to && !cc) {
      (missing.length ? missing : (report.regionNames || [report.region])).forEach(r => missingRegions.add(r));
      continue;
    }
    setFollowupsPushStatus(`Sending ${i + 1} of ${reports.length}…`, 'var(--text-faint)', statusElId);
    const job = { report, to, cc, btnId: btnIdFn(i) };
    const ok = await performGmailSend(job);
    if (ok) sent++; else if (job.blockedReason) blocked++; else failed++;
  }

  if (missingRegions.size) flagMissingRegionRecipients(Array.from(missingRegions));
  const parts = [`${sent} sent`];
  if (failed) parts.push(`${failed} failed`);
  if (blocked) parts.push(`${blocked} blocked by the safety check (not sent — hover the red button)`);
  if (missingRegions.size) parts.push(`${missingRegions.size} skipped (no recipients)`);
  setFollowupsPushStatus(parts.join(', ') + '.', failed || blocked || missingRegions.size ? 'var(--amber)' : 'var(--green)', statusElId);
}

// Sends every report in `reports` via Gmail. Mirrors the single-report
// Send button's connect-then-resume behavior: a click while not yet
// connected kicks off the OAuth popup and stashes this bulk send as the
// pending action, so it fires automatically (confirm dialog included, same
// as a normal click) once the token lands — no second click needed.
async function sendAllReportsGmail(reports, btnIdFn, statusElId, confirmText){
  if (!reports || !reports.length) return;
  if (!getGmailClientId()) {
    const panel = document.getElementById('gmailSetupPanel');
    if (panel) { panel.style.display = 'block'; panel.scrollIntoView({ behavior: 'smooth', block: 'center' }); }
    return;
  }
  if (!gmailTokenValid()) {
    setFollowupsPushStatus('Connecting to Gmail…', 'var(--text-faint)', statusElId);
    _pendingGmailSend = { kind: 'bulk', reports, btnIdFn, statusElId, confirmText };
    connectGmail(); // _runBulkGmailSend fires from the token callback once granted
    return;
  }
  await _runBulkGmailSend(reports, btnIdFn, statusElId, confirmText);
}

function initGmailUI(){
  const idInput = document.getElementById('gmailClientIdInput');
  if (idInput) idInput.value = getGmailClientId();
  const connectBtn = document.getElementById('gmailConnectBtn');
  if (connectBtn) connectBtn.addEventListener('click', connectGmail);
  const saveBtn = document.getElementById('gmailSaveClientIdBtn');
  if (saveBtn) saveBtn.addEventListener('click', saveGmailClientId);
  const toggleBtn = document.getElementById('gmailSetupToggle');
  const panel = document.getElementById('gmailSetupPanel');
  if (toggleBtn && panel) {
    toggleBtn.addEventListener('click', () => {
      const open = panel.style.display !== 'none';
      panel.style.display = open ? 'none' : 'block';
    });
  }
  updateGmailStatusUI();
}

