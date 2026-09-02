// ============================================================
// reports-ui.js — the report UI layer: region-recipient management
// (the chip-input table), the plain mailto send flow (one click opens
// the user's own mail client — see "ONE-CLICK ESCALATION DELIVERY"
// below for why this exists alongside the real Gmail send), and every
// render/copy/download/generate function for both the single-issue-mode
// and combined "all issues x regions" report views. Split out of
// reports.js (Phase 3 — see HANDOVER.md). Pure code motion — no logic
// changed.
//
// Loads LAST of the 3 reports-*.js files: this file's own top-level
// code (near the end) wires up #generateBtn's click handler and calls
// syncReportControls()/initRegionRecipientsPanel()/initGmailUI()
// immediately at parse time — so reports-gmail.js (which defines
// initGmailUI) must already be loaded and executed by the time this
// file runs. reports.js's original header comment already flagged
// this exact class of hazard (calling something whose defining `let`/
// function hasn't run yet throws an uncaught TDZ ReferenceError that
// silently aborts the rest of THIS script) for why initMovementUI()
// is deliberately NOT called from here either — that one still waits
// until main.js, unchanged by this split.
// ============================================================

/* ============ ONE-CLICK ESCALATION DELIVERY (mailto) ============ */
// Genuine unattended auto-send (SOP's "same-day escalation") needs a
// backend that can run without a human present — e.g. an Apps Script
// MailApp trigger — which a static, manually-refreshed page can't do.
// This is the honest client-side version: one click opens the recipient's
// own mail client with subject/body already filled in, cutting the
// copy/paste step down to a review-and-hit-send. mailto has no guaranteed
// length across mail clients, so a very long report may arrive truncated —
// the Copy button next to every Send button is the guaranteed-complete
// fallback for those.
//
// Recipients are per REGION, not one address for every report — a Pune
// report and a Bangalore report go to different Cluster Heads. Stored as
// {region: {to, cc}} keyed by the same canonical region names
// REGION_GROUP_MAP produces, editable from the table below the report
// controls.
const REGION_RECIPIENTS_KEY = 'gsl_region_recipients_v1';

// The 10 canonical groups reports can target — same set reportScopeNotice
// already computes, reused here so the recipients table always lists
// exactly the regions reports can actually be sent for.
function reportRegionNames(){
  return Array.from(new Set(Object.values(REGION_GROUP_MAP))).sort();
}

function loadRegionRecipients(){
  let store = {};
  try { store = JSON.parse(localStorage.getItem(REGION_RECIPIENTS_KEY) || '{}'); } catch (e) { store = {}; }
  return (store && typeof store === 'object') ? store : {};
}

function saveRegionRecipients(store){
  try { localStorage.setItem(REGION_RECIPIENTS_KEY, JSON.stringify(store)); } catch (e) {}
}

function setRegionRecipientField(region, field, value){
  const store = loadRegionRecipients();
  if (!store[region]) store[region] = { to: '', cc: '' };
  store[region][field] = value.trim();
  saveRegionRecipients(store);
}

function splitEmails(s){
  return String(s || '').split(/[,;]+/).map(x => x.trim()).filter(Boolean);
}

const regionRowId = (region) => region.replace(/[^a-zA-Z0-9]/g, '_');
const recipientCellId = (region, field) => `rec${field === 'to' ? 'To' : 'Cc'}Cell_${regionRowId(region)}`;

// Each email renders as its own removable chip rather than one long
// comma-separated string to hand-edit — add via typing + Enter/comma
// (or pasting a whole comma-separated list at once, still supported),
// remove one via its × or Backspace-on-empty, or clear the whole field
// in one click.
function emailChipBoxHTML(region, field){
  const store = loadRegionRecipients();
  const r = store[region] || { to: '', cc: '' };
  const emails = splitEmails(r[field]);
  const chips = emails.map(e => `<span class="email-chip">${esc(e)}<button type="button" class="email-chip-x" data-region="${esc(region)}" data-field="${field}" data-email="${esc(e)}" title="Remove ${esc(e)}">×</button></span>`).join('');
  const placeholder = emails.length ? 'Add another…' : (field === 'to' ? 'name@company.com' : 'optional');
  return `<div class="email-chip-box">
      ${chips}
      <input type="text" class="email-chip-input" data-region="${esc(region)}" data-field="${field}" placeholder="${esc(placeholder)}" />
    </div>
    ${emails.length ? `<button type="button" class="email-clear-all" data-region="${esc(region)}" data-field="${field}">Clear all</button>` : ''}`;
}

function refreshRecipientCell(region, field){
  const cell = document.getElementById(recipientCellId(region, field));
  if (cell) cell.innerHTML = emailChipBoxHTML(region, field);
}

// Accepts either a single address or a comma/semicolon-separated batch
// (e.g. pasted straight from an email client's own To field) — splitEmails
// already handles both, so typing one at a time and pasting many both work
// through the same path. Case-insensitive de-dup against what's already saved.
function addRegionRecipientEmails(region, field, rawValue){
  const newEmails = splitEmails(rawValue);
  if (!newEmails.length) return;
  const store = loadRegionRecipients();
  const r = store[region] || { to: '', cc: '' };
  const emails = splitEmails(r[field]);
  const seen = new Set(emails.map(e => e.toLowerCase()));
  newEmails.forEach(e => {
    if (!seen.has(e.toLowerCase())) { emails.push(e); seen.add(e.toLowerCase()); }
  });
  setRegionRecipientField(region, field, emails.join(','));
  refreshRecipientCell(region, field);
  const cell = document.getElementById(recipientCellId(region, field));
  const input = cell && cell.querySelector('.email-chip-input');
  if (input) input.focus(); // stays put so adding several in a row doesn't need re-clicking
}

function removeRegionRecipientEmail(region, field, email){
  const store = loadRegionRecipients();
  const r = store[region] || { to: '', cc: '' };
  const emails = splitEmails(r[field]).filter(e => e !== email);
  setRegionRecipientField(region, field, emails.join(','));
  refreshRecipientCell(region, field);
}

function clearRegionRecipientField(region, field){
  setRegionRecipientField(region, field, '');
  refreshRecipientCell(region, field);
}

// Delegated on the table container itself, which the innerHTML rewrites
// below never replace wholesale (only individual cells get refreshed) —
// so this only needs attaching once, in initRegionRecipientsPanel.
function initEmailChipHandlers(container){
  container.addEventListener('click', (e) => {
    const xBtn = e.target.closest('.email-chip-x');
    if (xBtn) {
      removeRegionRecipientEmail(xBtn.dataset.region, xBtn.dataset.field, xBtn.dataset.email);
      return;
    }
    const clearBtn = e.target.closest('.email-clear-all');
    if (clearBtn) clearRegionRecipientField(clearBtn.dataset.region, clearBtn.dataset.field);
  });

  container.addEventListener('keydown', (e) => {
    const input = e.target.closest('.email-chip-input');
    if (!input) return;
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      addRegionRecipientEmails(input.dataset.region, input.dataset.field, input.value);
      input.value = '';
    } else if (e.key === 'Backspace' && !input.value) {
      // Familiar tag-input shortcut: Backspace on an empty box deletes
      // the last chip instead of doing nothing.
      const box = input.closest('.email-chip-box');
      const chips = box ? box.querySelectorAll('.email-chip-x') : [];
      const lastChip = chips[chips.length - 1];
      if (lastChip) removeRegionRecipientEmail(lastChip.dataset.region, lastChip.dataset.field, lastChip.dataset.email);
    }
  });

  // Clicking away with unsaved typed text commits it too, so nothing
  // typed is silently lost by forgetting to press Enter first.
  container.addEventListener('focusout', (e) => {
    const input = e.target.closest('.email-chip-input');
    if (!input || !input.value.trim()) return;
    addRegionRecipientEmails(input.dataset.region, input.dataset.field, input.value);
    input.value = '';
  });
}

function renderRegionRecipientsTable(){
  const el = document.getElementById('regionRecipientsTable');
  if (!el) return;

  el.innerHTML = `<table style="width:100%; border-collapse:collapse; font-size:12.5px; min-width:520px;">
    <thead><tr>
      <th style="text-align:left; padding:6px 8px; color:var(--text-faint); font-size:10.5px; text-transform:uppercase; letter-spacing:.04em; border-bottom:1px solid var(--border);">Region</th>
      <th style="text-align:left; padding:6px 8px; color:var(--text-faint); font-size:10.5px; text-transform:uppercase; letter-spacing:.04em; border-bottom:1px solid var(--border);">To</th>
      <th style="text-align:left; padding:6px 8px; color:var(--text-faint); font-size:10.5px; text-transform:uppercase; letter-spacing:.04em; border-bottom:1px solid var(--border);">Cc</th>
    </tr></thead>
    <tbody>${reportRegionNames().map(region => {
      return `<tr>
        <td style="padding:8px 8px; border-bottom:1px solid #1c2027; font-weight:600; white-space:nowrap; vertical-align:top;">${esc(region)}</td>
        <td id="${recipientCellId(region, 'to')}" style="padding:5px 8px; border-bottom:1px solid #1c2027; min-width:220px; vertical-align:top;">${emailChipBoxHTML(region, 'to')}</td>
        <td id="${recipientCellId(region, 'cc')}" style="padding:5px 8px; border-bottom:1px solid #1c2027; min-width:180px; vertical-align:top;">${emailChipBoxHTML(region, 'cc')}</td>
      </tr>`;
    }).join('')}</tbody>
  </table>`;
}

function initRegionRecipientsPanel(){
  renderRegionRecipientsTable();
  initEmailChipHandlers(document.getElementById('regionRecipientsTable'));
  const btn = document.getElementById('regionRecipientsToggle');
  const panel = document.getElementById('regionRecipientsPanel');
  if (!btn || !panel) return;
  btn.addEventListener('click', () => {
    const open = panel.style.display !== 'none';
    panel.style.display = open ? 'none' : 'block';
    btn.textContent = open ? 'Edit region recipients ▾' : 'Hide region recipients ▾';
  });
}

// TEMPORARY TEST OVERRIDE — leave '' for real sends. Set from the browser
// console (e.g. `TEST_MODE_OVERRIDE_EMAIL = 'snehil.chhimwal@homesfy.in'`)
// to redirect EVERY resolved To/Cc for any report — the per-region panel,
// every issue/report type — to just that one address, so a manual "Send
// via Gmail" click can never reach a real recipient by accident. Applied
// in recipientsForReport, the single choke point every send path already
// goes through. Set it back to '' before sending for real — while it's
// set, real recipients are effectively disabled.
let TEST_MODE_OVERRIDE_EMAIL = '';

// Resolves To/Cc for a built report, always from the Region Recipients
// panel (the editable per-region table above the report list) — every
// report type, including the combined "All Issues" email, deliberately.
// RM_Hierarchy/Manager_Directory-based routing (real per-RM TL/RH/CH
// chains) is intentionally NOT used here — that's the overnight
// automation's own thing (RmHierarchy.gs/OvernightEmailer.gs, a separate
// Apps-Script-side implementation this dashboard doesn't touch); this
// email always uses only what's configured in the panel, so the two
// stay independently predictable rather than one silently depending on
// whether RM_Hierarchy happens to be set up in the current sheet.
// report.regionNames is the list of canonical regions it actually
// covers — one for a single-region report, several for a combined-region
// email — and this unions their configured addresses (deduped) so a
// combined email reaches everyone it should.
function recipientsForReport(report){
  const store = loadRegionRecipients();
  const names = (report.regionNames && report.regionNames.length) ? report.regionNames : [report.region];
  const toSet = new Set(), ccSet = new Set();
  const missing = [];
  names.forEach(region => {
    const r = store[region];
    const to = r ? splitEmails(r.to) : [];
    const cc = r ? splitEmails(r.cc) : [];
    if (!to.length && !cc.length) missing.push(region);
    to.forEach(e => toSet.add(e));
    cc.forEach(e => ccSet.add(e));
  });
  const result = { to: Array.from(toSet).join(','), cc: Array.from(ccSet).join(','), missing };
  // Single choke point every path above funnels through — see
  // TEST_MODE_OVERRIDE_EMAIL's own comment.
  if (TEST_MODE_OVERRIDE_EMAIL) {
    return { to: TEST_MODE_OVERRIDE_EMAIL, cc: '', missing: [] };
  }
  return result;
}

function openMailto(subject, body, to, cc){
  let url = `mailto:${encodeURIComponent(to || '')}?subject=${encodeURIComponent(subject)}`;
  if (cc) url += `&cc=${encodeURIComponent(cc)}`;
  url += `&body=${encodeURIComponent(body)}`;
  const a = document.createElement('a');
  a.href = url;
  a.click();
}

// Shared by both send paths (mailto and Gmail API) below — reveals the
// recipients table and flashes the row(s) that are blocking a complete
// send, rather than leaving someone wondering why an address didn't get
// included.
function flagMissingRegionRecipients(regions){
  const panel = document.getElementById('regionRecipientsPanel');
  const toggleBtn = document.getElementById('regionRecipientsToggle');
  if (panel && panel.style.display === 'none') {
    panel.style.display = 'block';
    if (toggleBtn) toggleBtn.textContent = 'Hide region recipients ▾';
  }
  if (panel) panel.scrollIntoView({ behavior: 'smooth', block: 'center' });
  regions.forEach(region => {
    // recipientCellId is the real id the table actually gives this cell
    // (see line ~5027) — the old 'recTo_'+regionRowId(region) never
    // matched anything, so this highlight silently never fired for any
    // region. The "To" input itself carries no id (only data-region/
    // data-field), so the cell is what gets outlined instead.
    const cell = document.getElementById(recipientCellId(region, 'to'));
    if (cell) {
      cell.style.outline = '2px solid var(--red)';
      setTimeout(() => { cell.style.outline = ''; }, 2000);
    }
  });
}

async function sendReport(report){
  if (!report) return;
  const { to, cc, missing } = await recipientsForReport(report);
  // Still opens with whatever WAS configured, so a partially-configured
  // combined email isn't blocked outright.
  if (missing.length) flagMissingRegionRecipients(missing);
  openMailto(report.subject, report.body, to, cc);
}

function sendRegionReport(idx){
  sendReport(window._regionReports && window._regionReports[idx]);
}

function sendAllReport(i){
  sendReport(_allReports[i]);
}

function renderRegionReports(){
  const issueKey = document.getElementById('reportIssueSelect').value;
  // Fresh for this single-issue generation — buildRegionReports only ever
  // ACCUMULATES into this dict, never resets it, since buildAllRegionReports
  // deliberately wants it to accumulate across its own multi-issue batch.
  // Without this reset, repeated single-issue generates (or switching the
  // issue dropdown) kept stacking prior runs' miss-counts on top of the
  // current one.
  _lastReportOutOfScopeNames = {};
  const reports = buildRegionReports(issueKey);
  document.getElementById('regionReportCount').textContent = reports.length + ' regions';
  // Bulk download belongs to the all-issues set — hide it here so it can't
  // download a stale batch that doesn't match what's on screen.
  document.getElementById('downloadAllReportsBtn').style.display = 'none';

  const el = document.getElementById('regionReportList');
  if (!reports.length) {
    el.innerHTML = `<div class="empty-row" style="background:var(--surface); border-radius:8px; border:1px solid var(--border);">No leads match this issue right now</div>`;
    return;
  }

  el.innerHTML = reportScopeNotice() + reports.map((r, idx) => `
    <div class="report-card">
      <div class="report-subject">${esc(r.subject)}</div>
      <div class="report-body" id="reportBody_${idx}">${esc(r.body)}</div>
      <button class="report-copy-btn" onclick="copyRegionReport(${idx})" id="reportCopyBtn_${idx}">Copy subject + body</button>
      <button class="report-copy-btn" onclick="sendRegionReport(${idx})" title="Opens your mail client with the region's To/Cc pre-filled">Open in Mail</button>
      <button class="report-copy-btn" onclick="sendRegionReportGmail(${idx})" id="gmailBtn_${idx}" title="Sends immediately via the Gmail API — no mail client, no extra click">Send via Gmail</button>
    </div>
  `).join('');

  window._regionReports = reports;
  applyGmailButtonStatesFor(reports, i => 'gmailBtn_' + i);
}

function copyRegionReport(idx){
  const r = window._regionReports[idx];
  const text = `${r.subject}\n\n${r.body}`;
  navigator.clipboard.writeText(text).then(() => {
    const btn = document.getElementById(`reportCopyBtn_${idx}`);
    btn.textContent = 'Copied ✓';
    btn.classList.add('copied');
    setTimeout(() => {
      btn.textContent = 'Copy subject + body';
      btn.classList.remove('copied');
    }, 1500);
  });
}

// Generic version of copyRegionReport/copyAllReport above, parameterized
// by array + button id instead of hardcoded to one global — used by the
// Movement tab's Stalled/Overnight report lists so they don't need their
// own copy-pasted copies of this function.
function copyGenericReport(reportsArray, idx, btnId){
  const r = reportsArray && reportsArray[idx];
  if (!r) return;
  const text = `${r.subject}\n\n${r.body}`;
  navigator.clipboard.writeText(text).then(() => {
    const btn = document.getElementById(btnId);
    if (!btn) return;
    const original = btn.dataset.originalLabel || btn.textContent;
    btn.dataset.originalLabel = original;
    btn.textContent = 'Copied ✓';
    btn.classList.add('copied');
    setTimeout(() => { btn.textContent = original; btn.classList.remove('copied'); }, 1500);
  });
}

/* ============ REPORT MODE DISPATCH ============ */
function syncReportControls(){
  const mode = document.getElementById('reportModeSelect').value;
  const isRegion = mode === 'region';
  document.getElementById('issueSelectWrap').style.display = isRegion ? 'none' : 'flex';
  document.getElementById('combineWrap').style.display = isRegion ? 'flex' : 'none';
  document.getElementById('generateAllReportsBtn').style.display = isRegion ? 'none' : 'inline-block';
}

// Three phases: (1) a preliminary build just to know which leads qualify
// and need a follow-up; (2) push their comment history to Lead_Followups
// and wait until EVERY one of them has a filled-in suggested_followup —
// the email must never go out with a blank follow-up for a lead it
// actually lists; (3) build the real report using those suggestions and
// render it. Phase 1's report output itself is thrown away — only its
// `sorted` lead list is used — so the SLA/region logic never has to be
// duplicated between a "preview" and a "real" pass.
async function renderReports(){
  // Morning Brief is deliberately NOT live-updated on every filter tweak
  // (see renderAll) — it only refreshes on an actual data refresh or here,
  // when a report is generated, so its numbers stay a stable "as of the
  // last real checkpoint" read rather than silently drifting with whatever
  // filter someone happened to leave set in another tab.
  renderMorningBrief();
  const mode = document.getElementById('reportModeSelect').value;
  if (mode === 'issue') { renderRegionReports(); return; }

  const combine = document.getElementById('combineRegionsCheck').checked;
  const el = document.getElementById('regionReportList');
  const preliminary = buildRegionWiseReports(combine);

  if (!preliminary.length) {
    document.getElementById('regionReportCount').textContent = '0 emails';
    el.innerHTML = reportScopeNotice()
      + `<div class="empty-row" style="background:var(--surface); border-radius:8px; border:1px solid var(--border);">No reportable leads right now</div>`;
    document.getElementById('downloadAllReportsBtn').style.display = 'none';
    return;
  }

  // Dedup by lead_id across regions — each customer belongs to exactly one
  // region so `combine: false` runs shouldn't ever collide, but a plain
  // object guard costs nothing and removes any doubt.
  const seenLeadIds = {};
  const leadsToPush = [];
  preliminary.forEach(r => (r.sorted || []).forEach(row => {
    const id = String(row.lead_id).trim();
    if (!id || seenLeadIds[id]) return;
    seenLeadIds[id] = true;
    leadsToPush.push(row);
  }));

  const genBtn = document.getElementById('generateBtn');
  if (!tryClaimGenerateCycle('operations')) {
    setFollowupsPushStatus(
      `${generateCycleOwnerLabel('overnight')} is currently writing to Lead_Followups — wait for it to finish, then click Generate again.`,
      'var(--amber)'
    );
    return;
  }
  const originalLabel = genBtn.textContent;
  let followupLookup;
  genBtn.disabled = true;
  try {
    // Every Generate starts Lead_Followups clean — no lead carries a
    // history or suggestion in from a prior run, so what's in the tab
    // during the wait below is always exactly this run's own leads, never
    // something stale left over (or already filled in) from before.
    genBtn.textContent = 'Clearing old follow-ups…';
    try {
      await clearLeadFollowupsTab();
    } catch (err) {
      setFollowupsPushStatus(`Could not clear Lead_Followups: ${err.message}`, 'var(--red)');
      return;
    }

    genBtn.textContent = 'Pushing comments…';
    const pushed = await pushLeadsToFollowups(leadsToPush);
    if (!pushed) {
      el.innerHTML = reportScopeNotice()
        + `<div class="empty-row" style="background:var(--surface); border-radius:8px; border:1px solid var(--border);">Could not write Lead_Followups — see the status above. Nothing sent.</div>`;
      return;
    }
    genBtn.textContent = 'Waiting for follow-ups…';
    followupLookup = await waitForAllFollowups(leadsToPush.map(r => String(r.lead_id).trim()));
  } finally {
    genBtn.disabled = false;
    genBtn.textContent = originalLabel;
    releaseGenerateCycle('operations');
  }

  // Cancelled: rather than leaving whatever was on screen before, fall
  // back to `preliminary` — already built above, from the same
  // buildRegionWiseReports call, just without a followupLookup, so every
  // suggested follow-up is the algorithmic/keyword-inferred one
  // (suggestedFollowUp's own fallback chain) instead of a human-reviewed
  // one. Clearly labeled as unreviewed, with a bulk-send option for
  // whoever decides the auto-generated wording is good enough to go out
  // as-is rather than waiting on Lead_Followups any further.
  const usingFallback = !followupLookup;
  _allReports = usingFallback ? preliminary : buildRegionWiseReports(combine, followupLookup);
  document.getElementById('regionReportCount').textContent =
    _allReports.length + (combine ? ' email' : ' region' + (_allReports.length === 1 ? '' : 's'));

  const fallbackBanner = usingFallback
    ? `<div class="empty-row" style="background:var(--surface); border-radius:8px; border:1px solid var(--amber); color:var(--amber); text-align:left; padding:10px 14px;">
        Waiting for follow-ups was cancelled. Showing ${_allReports.length} email${_allReports.length === 1 ? '' : 's'}
        built from auto-generated (keyword-inferred) follow-up suggestions only — nobody has reviewed these.
        <button class="report-copy-btn" style="margin-left:8px;" onclick="sendAllReportsGmail(_allReports, i => 'gmailAllBtn_' + i, 'followupsPushStatus', 'Send all ' + _allReports.length + ' region emails using UNREVIEWED auto-generated follow-up text?')">Send all via Gmail (unreviewed)</button>
      </div>`
    : '';

  el.innerHTML = reportScopeNotice() + fallbackBanner + _allReports.map((r, i) => `
    <div class="report-card">
      <div class="report-subject">${esc(r.subject)}</div>
      <div class="rr-meta" style="margin-bottom:8px;">${r.count} lead${r.count === 1 ? '' : 's'}</div>
      <div class="report-body" id="rwBody_${i}">${esc(r.body)}</div>
      <button class="report-copy-btn" onclick="copyAllReport(${i})" id="allCopyBtn_${i}">Copy subject + body</button>
      <button class="report-copy-btn" onclick="sendAllReport(${i})" title="Opens your mail client with the region's To/Cc pre-filled">Open in Mail</button>
      <button class="report-copy-btn" onclick="sendAllReportGmail(${i})" id="gmailAllBtn_${i}" title="Sends immediately via the Gmail API — no mail client, no extra click">Send via Gmail</button>
    </div>
  `).join('');

  document.getElementById('downloadAllReportsBtn').style.display = 'inline-block';
  applyGmailButtonStatesFor(_allReports, i => 'gmailAllBtn_' + i);
}

document.getElementById('reportModeSelect').addEventListener('change', syncReportControls);
document.getElementById('generateBtn').addEventListener('click', renderReports);
syncReportControls();
initRegionRecipientsPanel();
initGmailUI();
// initMovementUI() is called at the very end of this script, not here —
// it depends on movementFetchState, declared much further down. Calling it
// this early throws a TDZ ReferenceError (uncaught, since nothing here is
// wrapped in try/catch), which silently aborts the REST of this top-level
// script — meaning movementFetchState's own `let` line never runs, so a
// later Connect & Refresh click fails with "Cannot access
// 'movementFetchState' before initialization" the moment fetchMovementLog()
// tries to set it. Keep this call at the bottom.

// Joins names naturally: "A", "A & B", "A, B & C".
function renderAllRegionReports(){
  // See the same note in renderReports above — Morning Brief refreshes at
  // this checkpoint too, not on every filter tweak.
  renderMorningBrief();
  const btn = document.getElementById('generateAllReportsBtn');
  btn.disabled = true;
  btn.textContent = 'Generating…';

  // Defer so the button state paints before the (potentially heavy) build.
  setTimeout(() => {
    _allReports = buildAllRegionReports();
    const el = document.getElementById('regionReportList');

    document.getElementById('regionReportCount').textContent =
      _allReports.length + ' emails';

    if (!_allReports.length) {
      el.innerHTML = `<div class="empty-row" style="background:var(--surface); border-radius:8px; border:1px solid var(--border);">No leads match any issue right now</div>`;
      document.getElementById('downloadAllReportsBtn').style.display = 'none';
      btn.disabled = false;
      btn.textContent = 'Generate all issues × regions';
      return;
    }

    // Group by issue so the list reads as "issue → its regions".
    const byIssue = groupBy(_allReports.map((r, i) => ({ r, i })), x => x.r.issueLabel);

    el.innerHTML = reportScopeNotice() + Object.keys(byIssue).map(label => {
      const items = byIssue[label];
      const totalLeads = items.reduce((s, x) => s + x.r.count, 0);
      const rows = items.map(({ r, i }) => `
        <div class="report-row">
          <span class="rr-region">${esc(r.region)}</span>
          <span class="rr-meta">${r.count} lead${r.count === 1 ? '' : 's'}</span>
          <span class="rr-actions">
            <button onclick="toggleReportPreview(${i})">Preview</button>
            <button onclick="copyAllReport(${i})" id="allCopyBtn_${i}">Copy</button>
            <button onclick="sendAllReport(${i})" title="Opens your mail client with the region's To/Cc pre-filled">Open in Mail</button>
            <button onclick="sendAllReportGmail(${i})" id="gmailAllBtn_${i}" title="Sends immediately via the Gmail API — no mail client, no extra click">Send via Gmail</button>
          </span>
        </div>
        <div class="report-preview" id="allPreview_${i}"></div>
      `).join('');
      return `<div class="report-group">
        <div class="report-group-head">${esc(label)} <span class="grp-count">${items.length} region${items.length === 1 ? '' : 's'} · ${totalLeads} leads</span></div>
        ${rows}
      </div>`;
    }).join('');

    document.getElementById('downloadAllReportsBtn').style.display = 'inline-block';
    btn.disabled = false;
    btn.textContent = 'Generate all issues × regions';
    applyGmailButtonStatesFor(_allReports, i => 'gmailAllBtn_' + i);
  }, 10);
}

function toggleReportPreview(i){
  const el = document.getElementById('allPreview_' + i);
  if (!el) return;
  if (!el.dataset.rendered) {
    const r = _allReports[i];
    el.textContent = `${r.subject}\n\n${r.body}`;
    el.dataset.rendered = '1';
  }
  el.classList.toggle('open');
}

function copyAllReport(i){
  const r = _allReports[i];
  const text = `${r.subject}\n\n${r.body}`;
  navigator.clipboard.writeText(text).then(() => {
    const btn = document.getElementById('allCopyBtn_' + i);
    btn.textContent = 'Copied ✓';
    btn.classList.add('copied');
    setTimeout(() => { btn.textContent = 'Copy'; btn.classList.remove('copied'); }, 1500);
  });
}

function downloadAllReports(){
  if (!_allReports.length) return;
  const SEP = '\n\n' + '='.repeat(70) + '\n\n';
  const content = _allReports.map(r =>
    `[${r.issueLabel || 'Report'} — ${r.region}]\n${r.subject}\n\n${r.body}`
  ).join(SEP);

  const blob = new Blob([content], { type: 'text/plain;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
  a.href = url;
  a.download = `region_emails_${stamp}.txt`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

document.getElementById('generateAllReportsBtn').addEventListener('click', renderAllRegionReports);
document.getElementById('downloadAllReportsBtn').addEventListener('click', downloadAllReports);
