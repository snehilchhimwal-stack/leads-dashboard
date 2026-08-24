/* ===================== REGION EMAIL REPORTS ===================== */
// Maps each raw sheet region value to its main region group, per the
// confirmed rule: take the word(s) in front of a trailing number or
// direction (East/North/South/West); if there's no such suffix, the
// region is its own group.
// Only these 11 main regions get email reports. Any sub-region not listed
// here (Goa, Gurugram, KDMC, Kolkata, Launch Pune East,
// Mumbai-Miscellaneous, Noida) is deliberately excluded — those leads still
// appear everywhere else in the dashboard, just not in reports.
// "HNI" / "HNI - SoBo" fold into SoBo; "Loan" reports as its own group.
//
// This map is a live sheet's raw region TEXT -> report group, so it drifts
// whenever the CRM's region naming changes underneath it — that's what
// produced "NOT IN REPORTS" for HNI, Central Mumbai and Western Mumbai
// (2026-08): the sheet had moved on to those exact strings while this map
// still only recognised "HNI - SoBo", "Central" and "Western". Check the
// live map in reportScopeNotice() any time a flagged lead's region shows
// "NOT IN REPORTS" — that's this map missing the current raw text, not a
// leftover bug.
const REGION_GROUP_MAP = {
  'Bangalore': 'Bangalore',
  'Bangalore 1': 'Bangalore', 'Bangalore 2': 'Bangalore', 'Bangalore 3': 'Bangalore',
  'Central': 'Central', 'Central Mumbai': 'Central',
  'Commercial': 'Commercial',
  'Harbour': 'Harbour',
  'Hyderabad': 'Hyderabad',
  'Loan': 'Loan',
  // "Navi Mumbai 2" is folded in here as the same region. You listed only
  // "Navi Mumbai" — flagging in case you actually want 2 excluded.
  'Navi Mumbai': 'Navi Mumbai', 'Navi Mumbai 2': 'Navi Mumbai',
  'Pune': 'Pune',
  'Pune East': 'Pune', 'Pune North': 'Pune', 'Pune South': 'Pune', 'Pune West': 'Pune',
  // Reports as "SoBo", not "HNI" — HNI is just the CRM's raw label for the
  // same region.
  'SoBo': 'SoBo', 'HNI - SoBo': 'SoBo', 'HNI': 'SoBo',
  'Thane': 'Thane',
  // Both the bare names and the numbered/suffixed variants, since the sheet
  // has used "Western" and "Western Mumbai" at different times.
  'Western': 'Western', 'Western Mumbai': 'Western',
  'Western 1': 'Western', 'Western 2': 'Western', 'Western 3': 'Western', 'Western 4': 'Western',
};

// Keys above are matched loosely: lowercased, with runs of spaces, hyphens
// and underscores collapsed to one space. An exact case-sensitive lookup
// dropped whole regions silently — "western 1", "Western  1" and
// "HNI-SoBo" all returned null, and those leads vanished from the reports
// with no error anywhere to say so.
function normRegionKey(s){
  return String(s).trim().toLowerCase().replace(/[\s\-_]+/g, ' ');
}
const _REGION_LOOKUP = {};
Object.keys(REGION_GROUP_MAP).forEach(k => {
  _REGION_LOOKUP[normRegionKey(k)] = REGION_GROUP_MAP[k];
});

// Single source of truth for "what region does this lead actually belong
// to" — used by both the Region FILTER (dropdown + matching) and the
// email-report grouping (mainRegionFor below). "Loan" isn't geography, so
// it isn't reliably in the region column itself — it's been found under
// project_region, and possibly group_source depending on how a given row
// was tagged. Checked in that order; first match wins. Falls back to the
// region column for everything else.
function effectiveRegion(l){
  if (normRegionKey(l.project_region || '') === 'loan') return 'Loan';
  if (normRegionKey(l.group_source || '') === 'loan') return 'Loan';
  return String(l.region || '').trim();
}

// Returns null for regions outside the reporting scope, so callers can
// filter them out rather than silently creating a report for them. Callers
// should pass effectiveRegion(l), not the raw region column, so "Loan" and
// any other non-geography override is already resolved before this ever
// looks at REGION_GROUP_MAP.
function mainRegionFor(rawRegion){
  const key = normRegionKey(rawRegion);
  const direct = _REGION_LOOKUP[key];
  if (direct) return direct;

  // Sub-regions are numbered ("Bangalore 1", "Western 2"). A number nobody
  // configured yet should still report under its base region rather than
  // dropping out silently — which is exactly how plain "Western" was lost.
  // Only accepted when the base is itself a configured region, so an
  // unrelated value ending in a digit can't be absorbed by accident.
  const base = key.replace(/\s+\d+$/, '');
  if (base !== key && _REGION_LOOKUP[base]) return _REGION_LOOKUP[base];

  return null;
}

// Two raw region values count as the "same real place" if either: (a) they
// resolve to the same REGION_GROUP_MAP entry via mainRegionFor — already
// covers every known sub-region variant ("Pune"/"Pune West"/"Pune East" all
// → "Pune"), so this is a no-op for anything already mapped; or (b), as a
// fallback for a variant NOT yet added to that map, their normalized first
// word matches (e.g. an unmapped "Thane 2"-style suffix, or a typo) —
// without needing a REGION_GROUP_MAP edit every time a new naming variant
// shows up in the sheet. Blank/unresolvable values are never similar to
// anything (including each other) — a customer with one blank-region copy
// and one real-region copy is still a genuine mismatch worth surfacing, not
// something to wave through as "similar" by default. Used both to decide
// whether two same-lead_id/client_id rows should collate into one customer
// (see the identity match in collateLeads) and to group the resulting
// "which regions does this merged card actually span" read.
function regionsAreSimilar(a, b){
  const rawA = String(a || '').trim(), rawB = String(b || '').trim();
  if (!rawA || !rawB) return false;
  const mainA = mainRegionFor(rawA), mainB = mainRegionFor(rawB);
  if (mainA && mainB) return mainA === mainB;
  const keyA = normRegionKey(rawA), keyB = normRegionKey(rawB);
  if (keyA === keyB) return true;
  const firstA = keyA.split(' ')[0], firstB = keyB.split(' ')[0];
  return !!firstA && firstA === firstB;
}

// A collated customer's copies can each need to be reported on their own
// (different regions, or — per copySplits in fetchAndRender — different
// RMs with different issues) rather than as one merged card. Expands to
// copySplits when present; a single-copy item (or one not carrying
// copySplits at all, e.g. a Movement_Log row) is returned as-is. RAW form
// (copySplits entries are unenriched, same as allParsedLeads) — for report
// builders that read raw fields directly (e.g. Overnight Leads'
// current_stage/closing_reason check).
function expandCopySplits(item){
  return (item.copySplits && item.copySplits.length > 1) ? item.copySplits : [item];
}

// Groups any array of lead-shaped items (region + group_source, optionally
// project_region) into per-region buckets using the same effectiveRegion +
// mainRegionFor resolution the Operations tab reports use — so "Loan" and
// REGION_GROUP_MAP aliasing behave identically for the Movement tab's own
// report emails. Items whose region doesn't resolve to a reporting group
// are silently excluded, same as Operations' own out-of-scope handling.
function groupItemsByReportRegion(items){
  const byRegion = {};
  items.forEach(item => {
    expandCopySplits(item).forEach(unit => {
      const main = mainRegionFor(effectiveRegion(unit));
      if (!main) return;
      (byRegion[main] = byRegion[main] || []).push(unit);
    });
  });
  return byRegion;
}

// How many flagged leads fell outside the configured reporting regions on
// the last build — surfaced in the UI so exclusions are visible, not silent.
let _lastReportOutOfScope = 0;
// Raw region text -> count, for every flagged lead whose region matched no
// reporting group. Names the misses so a typo or spacing variant can be
// spotted, rather than only reporting how many were lost.
let _lastReportOutOfScopeNames = {};
// How many flagged leads had no parseable lead_created_at on the last
// build — the only remaining reason reportableIssueFor/buildRegionReports
// silently skip a flagged lead (no more generation-time grace re-check —
// see reportableIssueFor's own comment on why that was removed).
let _lastReportUndatable = 0;

// Reporting covers only the regions configured in REGION_GROUP_MAP; anything
// else is intentionally excluded. Say so on screen so the omission is
// explicit rather than silent.
function reportScopeNotice(){
  const regions = Array.from(new Set(Object.values(REGION_GROUP_MAP))).sort().join(', ');

  const missNames = Object.entries(_lastReportOutOfScopeNames).sort((a,b) => b[1]-a[1]);
  const excluded = _lastReportOutOfScope > 0
    ? ` <b>${_lastReportOutOfScope.toLocaleString()}</b> flagged lead${_lastReportOutOfScope === 1 ? '' : 's'} fell outside these regions:`
      + ` <span class="mono" style="color:var(--amber)">${missNames.map(([r,n]) => esc(r) + ' (' + n + ')').join(' · ')}</span>.`
      + ` If one of those is a region you DO want reported, its sheet text differs from the configured key — send me the exact string.`
    : '';

  const undatableNote = _lastReportUndatable > 0
    ? ` <b style="color:var(--amber)">${_lastReportUndatable.toLocaleString()}</b> flagged lead${_lastReportUndatable === 1 ? '' : 's'} held back — no parseable created date, so it can't be placed in a dated report.`
    : '';

  // Live map of every region value present in the filtered data, so a region
  // producing no report can be told apart from one whose text never matched.
  const seen = {};
  leads.forEach(l => {
    const raw = String(l.region || '(blank)').trim() || '(blank)';
    if (!seen[raw]) seen[raw] = { n: 0, flagged: 0, main: mainRegionFor(effectiveRegion(l)) };
    seen[raw].n++;
    if (ISSUE_PRIORITY.some(r => l[r.key])) seen[raw].flagged++;
  });
  const mapRows = Object.entries(seen).sort((a,b) => b[1].n - a[1].n).map(([raw, info]) => {
    const cls = info.main ? 'dim-chip' : 'amber-warn-chip';
    const dest = info.main ? '\u2192 ' + info.main : '\u2192 NOT IN REPORTS';
    return `<span class="chip ${cls}" title="${esc(raw)}: ${info.n} leads, ${info.flagged} currently flagged">`
      + `${esc(raw)}: ${info.n} (${info.flagged} flagged) <span style="opacity:.72">${esc(dest)}</span></span>`;
  }).join(' ');

  // The actionable warnings (excluded/grace-held-back counts) stay always
  // visible; the full region\u2192destination mapping is reference material,
  // collapsed behind the same toggle pattern as the collation notice above
  // \u2014 useful when a region seems to be missing, not something to read
  // every time this panel opens.
  return `<div class="truncation-notice" style="margin-bottom:12px;">Reports cover: ${esc(regions)}.${excluded}${undatableNote} `
    + `<button type="button" class="info-toggle" style="display:inline; padding:0;" data-label="\u24d8 Region mapping" onclick="toggleInlineDetail(this)">\u24d8 Region mapping</button></div>`
    + `<div class="filter-summary" style="display:none; margin-bottom:12px; line-height:2;">`
    + `<span class="dim">Region values in the current data, and where each one reports. A region with 0 flagged leads produces no email \u2014 that is not a fault:</span><br>${mapRows}</div>`;
}

const ISSUE_REPORT_META = {
  inactiveRm: {
    flag: 'inactiveRmNewLead', label: 'Inactive-RM Lead Added',
    intro: 'Please find below the {SOURCE} leads created today that were assigned to an RM currently marked inactive — these need reassignment, since no one can act on them as routed.',
  },
  notConnected: {
    flag: 'firstContactBreach', label: 'Not Connected in 10 Minutes',
    intro: 'Reminder for the Regional Head: the following RMs did not connect with the client within the first 10 minutes of assignment, on the {SOURCE} leads below (contact did eventually happen — this is a record of how late, not a still-open task). This has already happened and cannot be corrected, so it is for visibility only, not an action list. Leads that still have not connected at all are reported under Not Updated instead.',
  },
  followupOverdue: {
    flag: 'followupOverdue', label: 'Follow-up Overdue (4h Post-Connect)',
    intro: 'Please find below the connected {SOURCE} leads with no CRM update in the last 4 hours.',
  },
  dueToday: {
    flag: 'underCalledToday', label: "Behind on Today's Calls",
    intro: 'Please find below the {SOURCE} leads with fewer than 5 call attempts made today. For a lead created today this is Call Count directly; for an older lead still open it is CRM-logged updates dated today, since there is no true per-day call counter.',
  },
  stuck: {
    flag: 'stageStuck48h', label: 'Leads Pending Beyond 48 Hours (Not Yet Opportunity)',
    intro: "Please find below the {SOURCE} leads open for more than 48 hours that have not yet reached Opportunity stage.",
  },
  notUpdated: {
    flag: 'isNotUpdated', label: 'Not Updated',
    intro: 'Please find below the {SOURCE} leads still in the Not Updated stage.',
  },
};

// Keyed by FLAG, not label text — ISSUE_PRIORITY and ISSUE_REPORT_META can
// still drift to different wording for the same issue over time, so flag
// is the one identifier guaranteed to match consistently between them.
// One professional, specific recommended action per issue, shown in the
// email itself so the recipient knows what to actually do, not just what's
// wrong.
const ISSUE_ACTION_MAP = {
  inactiveRmNewLead: "Reassign this lead to an active RM immediately — it cannot be worked as currently routed.",
  firstContactBreach: "For the record, not for action — contact already happened, just after the 10-minute response window had passed, and that can't be corrected after the fact. Use this as a response-time SLA record per RM; no follow-up is needed on these specific leads.",
  followupOverdue: "Reconnect with the customer without delay — the 4-hour post-connect follow-up window has lapsed.",
  underCalledToday: `Complete the remaining call attempts today — see the Attempts Today column below for exactly how many more each lead needs to reach the ${CONFIG.MIN_CALLS_PER_DAY}/day SOP requirement.`,
  stageStuck48h: "Review this lead and either progress it toward Opportunity or close it out — it has been open more than 48 hours with no advancement.",
  isNotUpdated: "Update the CRM with this lead's current status — no activity has been logged since it was created. If the customer has never been reached, attempt first contact immediately; the 10-minute response window has already been missed.",
};

// reportableIssueFor() (used by the combined "all issues" report) returns
// ISSUE_PRIORITY's label text, not a flag — this maps that label back to
// its flag so ISSUE_ACTION_MAP can still be looked up from it.
const _FLAG_BY_ISSUE_PRIORITY_LABEL = {};
ISSUE_PRIORITY.forEach(rule => { _FLAG_BY_ISSUE_PRIORITY_LABEL[rule.label] = rule.key; });

// Behind on Today's Calls is the one issue where a single static action
// sentence can't say anything precise — every lead has its own attempts
// count. This renders the actual made/needed numbers per lead instead.
function attemptsTodayCell(attemptsToday){
  const made = Number(attemptsToday) || 0;
  const remaining = Math.max(0, CONFIG.MIN_CALLS_PER_DAY - made);
  return `${made}/${CONFIG.MIN_CALLS_PER_DAY} (${remaining} more needed)`;
}

const IST_MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

// Email reports are read in India, so the date on them is the IST date.
function istDayLabel(date){
  const p = istParts(date);
  return `${String(p.d).padStart(2, '0')}-${IST_MONTHS[p.mo]}-${p.y}`;
}

const IST_WEEKDAYS = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat']; // istParts().dow: getUTCDay() on the IST-shifted instant, so 0 = Sunday
// istDayLabel plus the weekday name — used where knowing "was this a
// weekday or weekend" matters (e.g. the Tracking tab's chart axis/hover),
// kept separate from istDayLabel itself since most existing callers just
// want the plain date and shouldn't have their label width grow.
function istDayLabelWithDow(date){
  const p = istParts(date);
  return `${IST_WEEKDAYS[p.dow]} ${istDayLabel(date)}`;
}

function todayDateLabel(){
  return istDayLabel(new Date());
}

// Shared by every report builder below that partitions leads/rows by
// region, RM, or issue — consolidates what used to be three near-identical
// hand-rolled accumulator objects (byRegion in buildRegionReports, groups in
// buildRegionWiseReports, byIssue in renderAllRegionReports).
function groupBy(items, keyFn){
  const out = {};
  items.forEach(item => {
    const k = keyFn(item);
    (out[k] = out[k] || []).push(item);
  });
  return out;
}

// One signature, so a future change to it can't update one report format
// and miss the other.
const EMAIL_SIGNATURE = 'Regards,\nSnehil Chhimwal';

// Appended to every generated subject line — states the Sub-source scope
// so the recipient knows without opening the email. Was a hardcoded
// ' - Google Search & Non-UTM only' string that stayed on every report
// regardless of what the Sub-source filter actually was — if nothing was
// selected (the default: unrestricted, every sub-source included), the
// subject line still falsely claimed a Search/Non-UTM-only scope, right
// next to sourceLabel's own (correct) "All-source" — a self-contradictory,
// misleading label a recipient has no way to catch without re-checking the
// filters themselves. Now built from the actual current Sub-source
// selection, same pattern selectedSourceLabel already uses for Source.
function subjectScopeSuffix(){
  const sel = Array.from(filterState.bucket);
  return sel.length ? ` - ${joinAnd(sel.slice().sort())} only` : '';
}

// HTML rendering for the Gmail-sent version of a report — mailto and Copy
// still use the plain-text body below (mailto can't carry HTML at all;
// Copy is meant for pasting into a chat/doc, where plain text is right).
// Every style is inline and layout is table-based, since email clients
// (Gmail, Outlook…) strip <style> blocks and have inconsistent CSS
// support — this is standard practice for HTML email, not a stylistic
// choice. sections' columns/rows are plain arrays rather than a fixed
// {lead_id, created, age} shape, so the same renderer works for both the
// per-RM report layout and the per-issue one, which show different data.
// action (top-level) renders one recommended-action callout under the
// header — for reports where every lead shares one issue, so one action
// covers the whole email. Sections can carry their OWN action instead
// (sec.action) for reports that combine several issues, where each
// section needs its own recommendation rather than one blanket one.
function renderReportEmailHTML(opts){
  const { eyebrow, title, region, subtitle, kpis, action, highlights, sections, footerNote } = opts;
  const FONT = "font-family:Arial,Helvetica,sans-serif;";

  const actionBox = (text) => `<div style="margin-top:12px; border-left:4px solid #10b981; background:#ecfdf5; border-radius:0 8px 8px 0; padding:10px 14px;">
      <div style="${FONT} font-size:10px; text-transform:uppercase; letter-spacing:.04em; font-weight:700; color:#059669;">Recommended Action</div>
      <div style="${FONT} font-size:12.5px; color:#065f46; margin-top:3px;">${esc(text)}</div>
    </div>`;

  // Deterministic, rule-based takeaways — computed straight from the
  // tallies the caller already built, no AI involved — so a reader gets the
  // shape of the report before skimming every section for it themselves.
  const highlightsBox = (items) => `<div style="margin-top:12px; border-left:4px solid #b45309; background:#fffbeb; border-radius:0 8px 8px 0; padding:10px 14px;">
      <div style="${FONT} font-size:10px; text-transform:uppercase; letter-spacing:.04em; font-weight:700; color:#b45309;">Highlights</div>
      <ul style="${FONT} font-size:12.5px; color:#78350f; margin:5px 0 0; padding-left:18px;">
        ${items.map(h => `<li style="margin-top:2px;">${esc(h)}</li>`).join('')}
      </ul>
    </div>`;

  const kpiCells = kpis.map(k => `<td style="padding:4px;">
      <div style="background:${k.bg}; border-radius:8px; padding:14px 10px; text-align:center;">
        <div style="${FONT} font-size:24px; font-weight:700; color:${k.fg}; line-height:1;">${esc(String(k.value))}</div>
        <div style="${FONT} font-size:10.5px; color:#6b7280; margin-top:5px;">${esc(k.label)}</div>
      </div>
    </td>`).join('');

  // Every section is indigo by default; a section can override to red (or
  // any other accent) via sec.accent — used for Stalled — Not Moved Since
  // Last Email, so the most-important issue visually stands apart from the
  // routine indigo tally sections rather than blending in.
  const sectionsHTML = sections.map(sec => {
    const accentFg = (sec.accent && sec.accent.fg) || '#4338ca';
    const accentHeaderBg = (sec.accent && sec.accent.headerBg) || '#eef2ff';
    const accentBg = (sec.accent && sec.accent.bg) || '#f5f5ff';
    const headerRow = `<tr style="background:${accentHeaderBg};">${sec.columns.map(c =>
      `<td style="padding:7px 10px; color:${accentFg}; font-size:10px; text-transform:uppercase; letter-spacing:.04em; font-weight:700; ${FONT}">${esc(c)}</td>`
    ).join('')}</tr>`;
    const bodyRows = sec.rows.map((row, i) => `<tr style="${i > 0 ? 'border-top:1px solid #f0f0f0;' : ''}">${
      row.map(cell => `<td style="padding:6px 10px; color:#374151; ${FONT}">${esc(String(cell))}</td>`).join('')
    }</tr>`).join('');
    return `<div style="margin-top:16px; border-left:4px solid ${accentFg}; background:${accentBg}; border-radius:0 8px 8px 0; padding:12px 16px;">
      <div style="${FONT} font-weight:700; font-size:14px; color:#1f2937;">${esc(sec.heading)}</div>
      ${sec.subheading ? `<div style="${FONT} font-size:11.5px; color:#6b7280; margin-bottom:8px;">${esc(sec.subheading)}</div>` : ''}
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#ffffff; border-radius:6px; border:1px solid #e5e7eb; font-size:12px; border-collapse:collapse; margin-top:6px;">
        ${headerRow}${bodyRows}
      </table>
      ${sec.action ? actionBox(sec.action) : ''}
    </div>`;
  }).join('');

  return `<div style="${FONT} max-width:640px; margin:0 auto; background:#ffffff; color:#1f2937;">
    <div style="background:#4338ca; padding:22px 26px;">
      <div style="color:#c7d2fe; font-size:11px; letter-spacing:1.4px; text-transform:uppercase; font-weight:700; margin-bottom:6px; ${FONT}">${esc(eyebrow)}</div>
      <div style="color:#ffffff; font-size:21px; font-weight:700; margin-bottom:4px; ${FONT}">${esc(title)}</div>
      ${region ? `<div style="color:#ffffff; font-size:13px; font-weight:600; margin-bottom:2px; ${FONT}">Region: ${esc(region)}</div>` : ''}
      <div style="color:#e0e7ff; font-size:12.5px; ${FONT}">${esc(subtitle)}</div>
    </div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:14px;"><tr>${kpiCells}</tr></table>
    ${action ? actionBox(action) : ''}
    ${(highlights && highlights.length) ? highlightsBox(highlights) : ''}
    ${sectionsHTML}
    ${footerNote ? `<div style="margin-top:18px; font-size:11px; color:#9ca3af; ${FONT}">${esc(footerNote)}</div>` : ''}
    <div style="margin-top:16px; font-size:13px; color:#374151; white-space:pre-line; ${FONT}">${esc(EMAIL_SIGNATURE)}</div>
  </div>`;
}

function buildRegionReports(issueKey){
  const meta = ISSUE_REPORT_META[issueKey];
  if (!meta) return [];

  const now = new Date();

  // No grace re-check here — enrichLead's pastGrace already gates every
  // flag except inactiveRmNewLead (deliberately never gated — the problem
  // is a bad assignment, not RM speed) and isNotUpdated's
  // neverConnectedPastWindow branch (deliberately exempt so a totally
  // silent lead is never invisible for 3 hours). Re-testing age here at
  // generation time used to re-block exactly those two, which is backwards:
  // `created` is fixed and `now` only moves forward between data-load time
  // and generation time, so a flag that already passed grace at load time
  // can never fail an age check again later — the re-check was a no-op for
  // every OTHER rule and only ever hurt these two.
  let undatableCount = 0;

  // issueLeads is already the per-copy view (see its declaration) — each
  // RM's own copy judged on its own call effort/comments/region, not a
  // combined-across-copies total.
  const matching = issueLeads.filter(l => {
    if (!l[meta.flag]) return false;
    if (!parseDate(l.lead_created_at)) { undatableCount++; return false; } // undatable — don't email it
    return true;
  });
  _lastReportUndatable = undatableCount;

  let outOfScopeCount = 0;
  const inScope = matching.filter(l => {
    const main = mainRegionFor(effectiveRegion(l));
    if (main) return true;
    outOfScopeCount++;
    // Record the raw text, not just a tally. A bare count told you leads
    // were dropped but never WHICH region string failed to match, so a
    // near-miss ("Western1", "West 1") was indistinguishable from a region
    // deliberately left out of scope.
    const raw = String(l.region || '(blank)').trim() || '(blank)';
    _lastReportOutOfScopeNames[raw] = (_lastReportOutOfScopeNames[raw] || 0) + 1;
    return false;
  });
  const byRegion = groupBy(inScope, l => mainRegionFor(effectiveRegion(l)));
  _lastReportOutOfScope = outOfScopeCount;

  const dateStr = todayDateLabel();
  const DIVIDER = '='.repeat(50);
  const SUBDIVIDER = '-'.repeat(50);

  // l.lead_id/l.RM are this row's OWN copy (issueLeads is already per-copy —
  // see its declaration). A lightweight note names any sibling copies for
  // context, without folding their data into this row's own numbers.
  const rmNote = (l) => (l.siblingRMs && l.siblingRMs.length) ? `  |  also held by: ${l.siblingRMs.join(', ')}` : '';

  // Each line carries the lead's creation timestamp and how long it's been
  // sitting, so the recipient can verify the flag themselves rather than
  // taking the dashboard's word for it. notConnected shows how late the
  // connect was instead — "how long it's been sitting" doesn't apply to a
  // lead that's already connected, and the lateness figure is the whole
  // point of this specific reminder.
  // underCalledToday (dueToday's flag) is deliberately not age-gated — see
  // enrichLead — so this list mixes fresh leads with ones well past their
  // 48h outcome. Operations' own UI now splits that into a 0–48h primary
  // count and a separate "past 48h" sub-band; the same distinction is
  // tagged per line here so a Regional Head reading the plain-text email
  // isn't left doing that math by eye against the Age figure.
  const ageTierTag = (l) => issueKey === 'dueToday' ? (l.isUnder48h ? '  [0–48h]' : '  [PAST 48h]') : '';

  const leadLine = (l) => {
    const created = parseDate(l.lead_created_at);
    if (!created) return `${l.lead_id}  |  Created: unknown${rmNote(l)}`;
    const stamp = istStamp(l.lead_created_at);
    if (issueKey === 'notConnected') {
      return `${l.lead_id}  |  Created: ${stamp}  |  ${fmtWorkingWait(l.businessMinsToConnect, 'late')}${rmNote(l)}`;
    }
    const hrs = ((now - created) / 36e5).toFixed(1);
    return `${l.lead_id}  |  Created: ${stamp}  |  ${hrs}h ago${ageTierTag(l)}${rmNote(l)}`;
  };

  return Object.keys(byRegion).sort().map(region => {
    const regionLeads = byRegion[region];

    const byRM = groupBy(regionLeads, l => (l.RM || 'Unassigned') + '||' + (l.TL || ''));

    // inactiveRm leads are always created today (isCreatedToday is part of
    // the flag itself) — day-bucketing would always produce exactly one
    // "Today" header, so it's skipped for that issue only.
    const rmLeadLines = (group) => issueKey === 'inactiveRm'
      ? group.map(leadLine).join('\n')
      : groupLeadsByCalendarDay(group, now).map(dg =>
          `  ${dg.label}\n${dg.leads.map(leadLine).join('\n')}`
        ).join('\n\n');

    const blocks = Object.values(byRM).map(group =>
      `${DIVIDER}\nRM      : ${group[0].RM || 'Unassigned'}\nManager : ${group[0].TL || ''}\n${SUBDIVIDER}\n${rmLeadLines(group)}\n`
    ).join('\n');

    // Only true for the issues that actually always wait for grace at the
    // source (enrichLead) — inactiveRm never waits (see the note above
    // `matching`) and notConnected has its own unrelated footer note below,
    // so stating this for either would be false, not just imprecise.
    // Shared between this plaintext note and the HTML footerNote further
    // down, so the two can't drift to different wording per issue.
    const graceExplainer = issueKey === 'inactiveRm' || issueKey === 'notConnected'
      ? ''
      : issueKey === 'notUpdated'
      ? `Most of these leads are excluded for the first ${CONFIG.LEAD_GRACE_HOURS} hours after creation — except one that has never been connected with at all past the first 10 minutes, which reports immediately regardless of age.`
      : `Leads created less than ${CONFIG.LEAD_GRACE_HOURS} hours ago are excluded — RMs are given that window to work a fresh lead.`;
    const graceNote = graceExplainer ? `\n\n(${graceExplainer})` : '';

    // "Total Leads"/"Leads Flagged" has to mean distinct customers, not
    // rows — a customer collated from 2 RM copies otherwise reads as 2
    // flagged leads when it's really one. Detail rows below stay per-copy
    // (each RM still needs their own row), only the headline/KPI dedupes.
    const cloneCounts = countUniqueAndCloned(regionLeads);
    const cloneCountLabel = cloneCounts.cloned > 0
      ? `${cloneCounts.unique} (+${cloneCounts.cloned} cloned cop${cloneCounts.cloned === 1 ? 'y' : 'ies'} of the same customer, listed under their other RM below)`
      : String(cloneCounts.unique);
    const cloneCaveat = cloneCounts.cloned > 0
      ? ` ${cloneCounts.cloned} of the rows below are another RM's copy of a customer already counted — real lead volume is ${cloneCounts.unique}, not ${cloneCounts.total}.`
      : '';

    // dueToday-only split, mirroring Operations' own 0–48h/past-48h
    // sub-band — see ageTierTag above for why this exists.
    const isDueToday = issueKey === 'dueToday';
    const under48Counts = isDueToday ? countUniqueAndCloned(regionLeads.filter(l => l.isUnder48h)) : null;
    const over48Counts = isDueToday ? countUniqueAndCloned(regionLeads.filter(l => !l.isUnder48h)) : null;
    const dueTodaySplitNote = isDueToday
      ? `\n\nOf these, ${under48Counts.unique} are within their first 48 hours; ${over48Counts.unique} are already past 48 hours and are also tracked separately under Leads Pending Beyond 48 Hours.`
      : '';

    const sourceLabel = selectedSourceLabel();
    const intro = meta.intro.replace('{SOURCE}', sourceLabel)
      + (isDueToday ? ' Each line below is tagged [0–48h] or [PAST 48h] so the two populations aren\'t read as one.' : '');
    const isReminder = issueKey === 'notConnected';
    const subject = isReminder
      ? `${region} — 10-Minute Response SLA Reminder (${dateStr})${subjectScopeSuffix()}`
      : `${region} Daily Report (${dateStr}) - ${sourceLabel} Leads with ${meta.label}${subjectScopeSuffix()}`;
    const totalLabel = isReminder ? 'Total Late Connections' : 'Total Leads';
    const body = `Hi,\n\nDate: ${dateStr}\n\n${intro}\n\n${blocks}\n${DIVIDER}\n\n${totalLabel} : ${cloneCountLabel}${dueTodaySplitNote}${graceNote}\n\n${EMAIL_SIGNATURE}`;

    const ages = regionLeads.map(l => {
      const created = parseDate(l.lead_created_at);
      return created ? (now - created) / 36e5 : 0;
    });
    const html = renderReportEmailHTML({
      eyebrow: 'Lead Funnel · SLA Monitor',
      title: isReminder ? '10-Minute Response SLA Reminder' : meta.label,
      region,
      subtitle: `${dateStr} — ${sourceLabel} leads${subjectScopeSuffix()}`,
      action: (ISSUE_ACTION_MAP[meta.flag] || '') + cloneCaveat,
      kpis: [
        // For dueToday, "Leads Flagged" is the 0–48h count specifically —
        // matching Operations' own badge, which stopped counting the
        // past-48h subset as the headline number for the same reason.
        { value: isDueToday ? under48Counts.unique : cloneCounts.unique, label: isReminder ? 'Late Connections' : (isDueToday ? 'Flagged (0–48h)' : 'Leads Flagged'), bg: '#fee2e2', fg: '#dc2626' },
        { value: Object.keys(byRM).length, label: Object.keys(byRM).length === 1 ? 'RM Affected' : 'RMs Affected', bg: '#e0e7ff', fg: '#4338ca' },
        isReminder
          ? { value: fmtWorkingWait(Math.max(...regionLeads.map(l => l.businessMinsToConnect || 0)), 'late'), label: 'Most Delayed', bg: '#fef3c7', fg: '#b45309' }
          : { value: (ages.length ? Math.max(...ages) : 0).toFixed(1) + 'h', label: 'Oldest Flagged', bg: '#fef3c7', fg: '#b45309' },
      ].concat(isDueToday ? [{ value: over48Counts.unique, label: 'Past 48h (tracked separately)', bg: '#f3f4f6', fg: '#4b5563' }] : []),
      sections: Object.values(byRM).map(group => ({
        heading: group[0].RM || 'Unassigned',
        subheading: `Manager: ${group[0].TL || '—'}`,
        // "Date" gives the same calendar-day grouping the plain-text body
        // gets as real section headers — here as a column instead, since
        // this section is already one bordered box per RM and multiplying
        // that into one box per RM×day would get visually heavy in an
        // email. Skipped for inactiveRm, whose leads are always today's by
        // definition (isCreatedToday is part of the flag itself).
        columns: (['Lead ID', 'Created'].concat(issueKey === 'inactiveRm' ? [] : ['Date']).concat(
          issueKey === 'dueToday' ? ['Age', 'Window', 'Attempts Today']
          : isReminder ? ['Age', 'Connected Late By']
          : ['Age']
        )).concat('Suggested Follow-up'),
        rows: group.map(l => {
          const created = parseDate(l.lead_created_at);
          const cells = [
            l.lead_id + ((l.siblingRMs && l.siblingRMs.length) ? ` (also held by: ${l.siblingRMs.join(', ')})` : ''),
            created ? istStamp(l.lead_created_at) : 'unknown',
          ];
          if (issueKey !== 'inactiveRm') {
            cells.push(created ? relativeDayLabel(istDateKey(created), istDateKey(now)) : 'unknown');
          }
          cells.push(created ? ((now - created) / 36e5).toFixed(1) + 'h' : '—');
          if (issueKey === 'dueToday') cells.push(l.isUnder48h ? '0–48h' : 'PAST 48h');
          if (issueKey === 'dueToday') cells.push(attemptsTodayCell(l.attemptsToday));
          if (isReminder) cells.push(fmtWorkingWait(l.businessMinsToConnect, 'late'));
          cells.push(suggestedFollowUp(l));
          return cells;
        }),
      })),
      footerNote: isReminder
        ? 'This is a response-time SLA record, not an action list — every lead below has already connected, just after the 10-minute window. Leads that still have not connected at all are reported under Not Updated instead.'
        : graceExplainer,
    });

    return { region, subject, body, html, count: cloneCounts.unique, regionNames: [region] };
  });
}

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

// Resolves To/Cc for a built report. report.regionNames is the list of
// canonical regions it actually covers — one for a single-region report,
// several for a combined-region email — and this unions their configured
// addresses (deduped) so a combined email reaches everyone it should.
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
  return { to: Array.from(toSet).join(','), cc: Array.from(ccSet).join(','), missing };
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

function sendReport(report){
  if (!report) return;
  const { to, cc, missing } = recipientsForReport(report);
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
          performGmailSend(pending);
        }
      }
    },
  });
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
  let binary = '';
  bytes.forEach(b => { binary += String.fromCharCode(b); });
  return btoa(binary);
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

// Returns true/false so a bulk caller (sendAllReportsGmail below) can track
// how many of a batch actually went through — every existing call site
// still ignores the return value, so this is additive, not a behavior
// change for the single-report Send button.
async function performGmailSend(pending){
  const { report, to, cc, btnId } = pending;
  const btn = btnId ? document.getElementById(btnId) : null;
  if (btn) { btn.disabled = true; btn.textContent = 'Sending…'; }
  try {
    const raw = buildRawEmail(to, cc, report.subject, report.body, report.html);
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

function sendReportViaGmail(report, btnId){
  if (!report) return;
  if (!getGmailClientId()) {
    const panel = document.getElementById('gmailSetupPanel');
    if (panel) { panel.style.display = 'block'; panel.scrollIntoView({ behavior: 'smooth', block: 'center' }); }
    return;
  }
  const { to, cc, missing } = recipientsForReport(report);
  if (!to && !cc) {
    flagMissingRegionRecipients(missing.length ? missing : (report.regionNames || [report.region]));
    return;
  }
  const pending = { kind: 'single', report, to, cc, btnId };
  if (gmailTokenValid()) {
    performGmailSend(pending);
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
  let sent = 0, failed = 0;
  for (let i = 0; i < reports.length; i++) {
    const report = reports[i];
    const { to, cc, missing } = recipientsForReport(report);
    if (!to && !cc) {
      (missing.length ? missing : (report.regionNames || [report.region])).forEach(r => missingRegions.add(r));
      continue;
    }
    setFollowupsPushStatus(`Sending ${i + 1} of ${reports.length}…`, 'var(--text-faint)', statusElId);
    const ok = await performGmailSend({ report, to, cc, btnId: btnIdFn(i) });
    if (ok) sent++; else failed++;
  }

  if (missingRegions.size) flagMissingRegionRecipients(Array.from(missingRegions));
  const parts = [`${sent} sent`];
  if (failed) parts.push(`${failed} failed`);
  if (missingRegions.size) parts.push(`${missingRegions.size} skipped (no recipients)`);
  setFollowupsPushStatus(parts.join(', ') + '.', failed || missingRegions.size ? 'var(--amber)' : 'var(--green)', statusElId);
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
function joinAnd(names){
  const a = Array.from(names).filter(Boolean);
  if (!a.length) return '';
  if (a.length === 1) return a[0];
  return a.slice(0, -1).join(', ') + ' & ' + a[a.length - 1];
}

// Source label comes from the Source filter selection, so the email says
// what you actually filtered to rather than a hardcoded "Google".
function selectedSourceLabel(){
  const sel = Array.from(filterState.source);
  return sel.length ? joinAnd(sel.slice().sort()) : 'All-source';
}

// Region label from the Region filter selection, mapped up to main regions
// and deduplicated (selecting Bangalore 1 + Bangalore 2 reads "Bangalore").
// Falls back to whatever regions are actually present when no filter is set.
function selectedRegionLabel(fallbackRegions){
  const sel = Array.from(filterState.region);
  if (sel.length) {
    const mains = Array.from(new Set(sel.map(r => mainRegionFor(r) || r))).sort();
    return joinAnd(mains);
  }
  return fallbackRegions && fallbackRegions.length ? joinAnd(fallbackRegions) : 'All Regions';
}

/* ============ REGION-WISE REPORTS (all issues in one email) ============ */
// Inverts the issue-wise format: one email per region listing every flagged
// lead with its single primary issue, rather than one email per issue.

// Determines a lead's primary issue for reporting, honouring both the
// ISSUE_PRIORITY order and the grace period. A lead still inside its grace
// window can only report "Not Connected in 10 Minutes" — every other issue
// is suppressed until the lead is old enough, so the grace rule can't be
// bypassed just by a different issue ranking higher.
// Only considers issues ISSUE_REPORT_META actually knows how to email —
// ISSUE_PRIORITY has entries (e.g. loggingGapBreach) deliberately excluded
// from the report engine, and iterating the full list here would let one
// of those slip into the combined "all issues" report by way of a lead
// that isn't ALSO flagged for something genuinely emailable.
const _EMAILABLE_FLAG_KEYS = new Set(Object.values(ISSUE_REPORT_META).map(m => m.flag));

function reportableIssueFor(l){
  const created = parseDate(l.lead_created_at);
  if (!created) return null; // undatable — never email it

  // No blanket grace re-check here — enrichLead's pastGrace already gates
  // followupOverdue/underCalledToday/stageStuck48h, and since `created` is
  // fixed while `now` only ever moves forward between data-load time and
  // generation time, a flag that already passed grace at load time can
  // never fail this same check again later — re-testing it here is a
  // no-op for those three. isNotUpdated (via neverConnectedPastWindow) and
  // inactiveRmNewLead are deliberately grace-EXEMPT by design (see their
  // own comments in enrichLead) specifically so they fire inside the
  // window — a blanket re-check here used to silently re-block exactly
  // those, which is the whole bug: it could only ever suppress leads that
  // were never supposed to wait for grace in the first place.
  for (const rule of ISSUE_PRIORITY) {
    if (!_EMAILABLE_FLAG_KEYS.has(rule.key)) continue;
    if (!l[rule.key]) continue;
    return rule.label;
  }
  return null;
}

// Date range shown in the subject: the explicit filter range if one is set,
// otherwise the actual span of creation dates in the included leads.
function reportDateRange(includedLeads){
  const fromVal = document.getElementById('dateFromInput').value;
  const toVal = document.getElementById('dateToInput').value;
  const fmt = istDayLabel;

  if (fromVal || toVal) {
    // parseDate can return null for a value it can't parse — every other
    // date field in this file guards that before formatting; fmt/istParts
    // do not, so an unparseable non-empty value would otherwise throw
    // instead of degrading to '…' like a blank value already does.
    const fromDate = fromVal ? parseDate(fromVal) : null;
    const toDate = toVal ? parseDate(toVal) : null;
    const a = fromDate ? fmt(fromDate) : '…';
    const b = toDate ? fmt(toDate) : '…';
    return a === b ? a : `${a} to ${b}`;
  }
  const times = includedLeads.map(l => parseDate(l.lead_created_at)).filter(Boolean).map(d => d.getTime());
  if (!times.length) return todayDateLabel();
  const a = fmt(new Date(Math.min(...times)));
  const b = fmt(new Date(Math.max(...times)));
  return a === b ? a : `${a} to ${b}`;
}

// followupLookup is {lead_id: suggested_followup text} sourced from
// Lead_Followups — see renderReports, which builds it from whatever a
// person has typed into that column after reviewing collateFamilyComments'
// export. Only lead_ids that were actually pushed there (the core
// issue-flagged population) will ever have an entry, so this naturally
// only overrides suggestedFollowUp for that population and falls through
// unchanged for notConnected/stuck/stalled rows.
function buildRegionWiseReports(combineAll, followupLookup){
  const now = new Date();
  const DIVIDER = '='.repeat(50);
  const SUBDIVIDER = '-'.repeat(50);
  const STUCK_LABEL = ISSUE_PRIORITY.find(r => r.key === 'stageStuck48h').label;
  const followupTextFor = (r) => (followupLookup && followupLookup[String(r.lead_id).trim()]) || suggestedFollowUp(r);
  let undatableCount = 0, outOfScope = 0;
  // Fresh for this generation — this path previously never touched the
  // names dict at all, so reportScopeNotice()'s "NOT IN REPORTS" breakdown
  // showed whatever a completely different report mode had last left
  // behind (or nothing, if none had run yet this session).
  _lastReportOutOfScopeNames = {};

  // Collect every flagged lead with its primary reportable issue.
  // issueLeads is already the per-copy view (see its declaration) — each
  // RM's own copy judged on its own issue flags, not a combined-across-
  // copies total, and a customer can only belong to one region in an
  // email, which this view's own copy already reflects.
  const rows = [];
  issueLeads.forEach(l => {
    const issue = reportableIssueFor(l);
    if (!issue) {
      // reportableIssueFor only returns null for an undatable lead (no
      // parseable lead_created_at) or one whose only flag isn't one of the
      // emailable rules (e.g. loggingGapBreach alone) — every emailable
      // flag now reports immediately, grace-exempt or not (see
      // reportableIssueFor's own comment).
      const anyFlag = ISSUE_PRIORITY.some(r => l[r.key]);
      if (anyFlag) undatableCount++;
      return;
    }
    const main = mainRegionFor(effectiveRegion(l));
    if (!main) {
      outOfScope++;
      const raw = String(l.region || '(blank)').trim() || '(blank)';
      _lastReportOutOfScopeNames[raw] = (_lastReportOutOfScopeNames[raw] || 0) + 1;
      return;
    }
    rows.push({ mainRegion: main, subRegion: l.region || '—', lead_id: l.lead_id, RM: l.RM || '—', issue, lead_created_at: l.lead_created_at, attemptsToday: l.attemptsToday, businessMinsToConnect: l.businessMinsToConnect, siblingLeadIds: l.siblingLeadIds, siblingRMs: l.siblingRMs, internal_status_comments: l.internal_status_comments, stage_comments: l.stage_comments, last_comment: l.last_comment, closing_reason: l.closing_reason, siblingComments: l.siblingComments });
  });

  // Not Connected in 10 Minutes rides along in this same email as its own
  // trailing section, deliberately collected separately from the pass
  // above — it's independent of reportableIssueFor/ISSUE_PRIORITY (see the
  // note on ISSUE_PRIORITY) so it never competes for or masks a lead's
  // actionable issue, and it can't get lost inside the alphabetically-
  // sorted issue tally either, since it's appended after that instead of
  // being one of its entries.
  const notConnectedRows = [];
  issueLeads.forEach(l => {
    if (!l.firstContactBreach) return;
    const main = mainRegionFor(effectiveRegion(l));
    if (!main) return; // same out-of-scope handling as the main pass, just not double-counted into its tally
    notConnectedRows.push({ mainRegion: main, subRegion: l.region || '—', lead_id: l.lead_id, RM: l.RM || '—', TL: l.TL || '', lead_created_at: l.lead_created_at, businessMinsToConnect: l.businessMinsToConnect, siblingLeadIds: l.siblingLeadIds, siblingRMs: l.siblingRMs, internal_status_comments: l.internal_status_comments, stage_comments: l.stage_comments, last_comment: l.last_comment, closing_reason: l.closing_reason, siblingComments: l.siblingComments });
  });

  // Leads Pending Beyond 48 Hours rides along too, as its own trailing
  // section — reportableIssueFor picks ONE primary issue per lead, and
  // Behind on Today's Calls has no age ceiling, so a lead that's both
  // stuck 48h+ AND behind on today's calls reports as the latter, which
  // silently hides the 48h+ compliance breach from this combined email
  // (it still shows fine in its own dashboard section and single-issue
  // email — this only affects the shared primary-issue pick here). This
  // second pass catches every stuck lead NOT already the primary pick, so
  // it's never fully hidden; leads that already surface under their own
  // "Leads Pending Beyond 48 Hours" entry above aren't duplicated here.
  const stuckRows = [];
  issueLeads.forEach(l => {
    if (!l.stageStuck48h) return;
    if (reportableIssueFor(l) === STUCK_LABEL) return; // already the primary pick, shown above
    const main = mainRegionFor(effectiveRegion(l));
    if (!main) return;
    stuckRows.push({ mainRegion: main, subRegion: l.region || '—', lead_id: l.lead_id, RM: l.RM || '—', TL: l.TL || '', lead_created_at: l.lead_created_at, siblingLeadIds: l.siblingLeadIds, siblingRMs: l.siblingRMs, internal_status_comments: l.internal_status_comments, stage_comments: l.stage_comments, last_comment: l.last_comment, closing_reason: l.closing_reason, siblingComments: l.siblingComments });
  });

  // Possible Premature Closes rides along too, as its own trailing section —
  // closed leads (isLeadClosed) whose most recent logged note across the
  // whole family (latestFamilyOutcome — same pooling suggestedFollowUp uses)
  // still reads as engaged rather than a clear no. Not proof the close was
  // wrong, just a discrepancy worth a second look before it's gone for good.
  // Independent of reportableIssueFor/ISSUE_PRIORITY — a closed lead never
  // carries an open-lead SLA flag, so this population never overlaps with
  // `rows` above.
  const WARM_CLOSE_OUTCOMES = new Set(['Interested', 'Visit Arranged', 'Visit Completed', 'Details Shared', 'Considering', 'Budget Concern', 'Loan In Process', 'DNP']);
  const warmCloseRows = [];
  issueLeads.forEach(l => {
    if (!isLeadClosed(l)) return;
    const latest = latestFamilyOutcome(l);
    if (!latest || !WARM_CLOSE_OUTCOMES.has(latest.outcome)) return;
    const main = mainRegionFor(effectiveRegion(l));
    if (!main) return;
    const closedReason = String(l.lead_closing_reason || l.closing_reason || '').trim() || '—';
    warmCloseRows.push({ mainRegion: main, subRegion: l.region || '—', lead_id: l.lead_id, RM: l.RM || '—', TL: l.TL || '', closedReason, lastNote: latest.comment, lastOutcome: latest.outcome, siblingRMs: l.siblingRMs });
  });

  // Stalled Leads: every lead currently stalled per
  // currentStalledRowsByRegion — the SAME Compare from/to picker selection
  // as the on-screen card and Status Changes (Operations tab), read at
  // whatever it's set to right now — rides along as this email's first,
  // most important section every time, not just on repeat. Keyed by
  // mainRegion (groupItemsByReportRegion already resolves it that way), so
  // it lines up directly with `key` below without a second resolution pass.
  const stalledByRegion = currentStalledRowsByRegion();
  // Cheap to compute directly rather than infer from stalledByRegion being
  // empty — an empty stalledByRegion could also just mean zero leads are
  // currently stalled for the picked pair, not that no pair is picked at
  // all. Used below to explain an absent Stalled section instead of
  // silently omitting it with no reason given.
  const stalledWindowAvailable = !!getPickedMovementWindow();

  _lastReportUndatable = undatableCount;
  _lastReportOutOfScope = outOfScope;

  if (!rows.length && !notConnectedRows.length && !stuckRows.length && !warmCloseRows.length && !Object.keys(stalledByRegion).length) return [];

  const groups = combineAll ? { __ALL__: rows } : groupBy(rows, r => r.mainRegion);
  const notConnectedGroups = combineAll ? { __ALL__: notConnectedRows } : groupBy(notConnectedRows, r => r.mainRegion);
  const stuckGroups = combineAll ? { __ALL__: stuckRows } : groupBy(stuckRows, r => r.mainRegion);
  const warmCloseGroups = combineAll ? { __ALL__: warmCloseRows } : groupBy(warmCloseRows, r => r.mainRegion);
  // A region with ONLY late-connect, ONLY additional-stuck, ONLY premature-
  // close, or ONLY stalled leads and no other actionable issue still needs
  // its own email — without this it would have no key in `groups` (built
  // from `rows` alone) and silently drop out entirely.
  if (!combineAll) {
    Object.keys(notConnectedGroups).concat(Object.keys(stuckGroups)).concat(Object.keys(warmCloseGroups)).concat(Object.keys(stalledByRegion)).forEach(region => {
      if (!groups[region]) groups[region] = [];
    });
  }

  return Object.keys(groups).sort().map(key => {
    const items = groups[key];
    const notConnectedItems = notConnectedGroups[key] || [];
    const stuckItems = stuckGroups[key] || [];
    const warmCloseItems = warmCloseGroups[key] || [];
    // Combined mode spans every region, so gather repeats from all of them;
    // per-region mode's key IS the real region name already.
    const stalledItems = combineAll
      ? Object.keys(stalledByRegion).reduce((acc, r) => acc.concat(stalledByRegion[r]), [])
      : (stalledByRegion[key] || []);
    const regionNames = Array.from(new Set(
      items.concat(notConnectedItems).concat(stuckItems).concat(warmCloseItems).map(r => r.mainRegion)
        .concat(stalledItems.map(r => mainRegionFor(effectiveRegion(r))).filter(Boolean))
        .concat(combineAll ? [] : [key])
    )).sort();
    // In combined mode the email spans everything, so the Region filter
    // selection is the right label. In per-region mode each email covers one
    // region, so it names its own — otherwise every email would carry an
    // identical, misleading subject.
    const regionLabel = combineAll ? selectedRegionLabel(regionNames) : regionNames[0];
    const sourceLabel = selectedSourceLabel();

    // Rows already carry their own lead_created_at directly — no need to
    // look the lead back up in `leads` (which wouldn't even find a split's
    // own id, since `leads` stays one merged record per customer).
    const dateRange = reportDateRange(items.concat(notConnectedItems).concat(stuckItems));

    // r.lead_id/r.RM are this row's OWN copy; a sibling note (not a merged
    // list) names any other RM copies of the same customer for context.
    const idsFor = (r) => r.lead_id;
    const rmsFor = (r) => (r.siblingRMs && r.siblingRMs.length) ? `${r.RM} (also: ${r.siblingRMs.join(', ')})` : r.RM;

    // Fixed-width columns rather than tabs — tab stops render
    // unpredictably across email clients, padding does not.
    const w = {
      id: Math.max(7, ...items.map(r => idsFor(r).length)),
      region: Math.max(6, ...items.map(r => String(r.subRegion).length)),
      rm: Math.max(2, ...items.map(r => rmsFor(r).length)),
    };
    const pad = (s, n) => String(s).padEnd(n);
    const header = `${pad('lead_id', w.id)}  ${pad('region', w.region)}  ${pad('RM', w.rm)}  issue`;
    const ruleLine = '-'.repeat(header.length);

    const sorted = items.slice().sort((a, b) =>
      a.mainRegion.localeCompare(b.mainRegion) ||
      a.issue.localeCompare(b.issue) ||
      String(a.lead_id).localeCompare(String(b.lead_id)));

    const table = sorted.map(r =>
      `${pad(idsFor(r), w.id)}  ${pad(r.subRegion, w.region)}  ${pad(rmsFor(r), w.rm)}  ${r.issue}`
    ).join('\n');

    // Per-issue tally so the recipient sees the shape before the detail.
    // Scoped to `sorted` only — the actionable issues — so Not Connected in
    // 10 Minutes never becomes one of these entries; it gets its own
    // trailing block below instead, appended after this table rather than
    // sorted alphabetically into the middle of it. Left as real instance
    // counts (not deduped) — a customer's two RM copies can be flagged for
    // two DIFFERENT issues, and each is its own actionable item.
    const tally = groupBy(sorted, r => r.issue);
    const summary = Object.keys(tally).sort().map(k => `  ${k}: ${tally[k].length}`).join('\n');
    const mainGraceNote = `(Leads created less than ${CONFIG.LEAD_GRACE_HOURS} hours ago are excluded — RMs are given that window to work a fresh lead.)`;
    const mainSection = sorted.length
      ? `Summary by issue:\n${summary}\n\n${header}\n${ruleLine}\n${table}\n\n${mainGraceNote}`
      : `No other flagged issues right now.`;

    // "Total" has to mean distinct customers, not rows — a customer
    // collated from 2 RM copies (each with their own issue) otherwise
    // reads as 2 flagged leads when it's really one. Per-issue tallies
    // above stay instance-based; only the headline/KPI totals dedupe.
    const cloneCounts = countUniqueAndCloned(sorted);
    const totalCountLabel = cloneCounts.cloned > 0
      ? `${cloneCounts.unique} (+${cloneCounts.cloned} cloned cop${cloneCounts.cloned === 1 ? 'y' : 'ies'} of the same customer, listed under their other RM below)`
      : String(cloneCounts.unique);
    const notConnectedCloneCounts = countUniqueAndCloned(notConnectedItems);
    const notConnectedTotalLabel = notConnectedCloneCounts.cloned > 0
      ? `${notConnectedCloneCounts.unique} (+${notConnectedCloneCounts.cloned} cloned cop${notConnectedCloneCounts.cloned === 1 ? 'y' : 'ies'} of the same customer, listed under their other RM below)`
      : String(notConnectedCloneCounts.unique);
    const stuckCloneCounts = countUniqueAndCloned(stuckItems);
    const stuckTotalLabel = stuckCloneCounts.cloned > 0
      ? `${stuckCloneCounts.unique} (+${stuckCloneCounts.cloned} cloned cop${stuckCloneCounts.cloned === 1 ? 'y' : 'ies'} of the same customer, listed under their other RM below)`
      : String(stuckCloneCounts.unique);

    // Not Connected in 10 Minutes, appended as its own reminder block —
    // grouped by RM like its dedicated single-issue report, addressed to
    // the region's RH, explicitly a record rather than an action list.
    const notConnectedByRM = groupBy(notConnectedItems, r => (r.RM || 'Unassigned') + '||' + (r.TL || ''));
    const notConnectedBlock = notConnectedItems.length ? `

${DIVIDER}
NOT CONNECTED IN 10 MINUTES (Reminder for the Regional Head)
The following RMs did not connect with the client within the first 10 minutes of assignment. Contact did eventually happen — this is a record of how late, not an open task. Already happened and cannot be corrected.
${SUBDIVIDER}
${Object.values(notConnectedByRM).map(group =>
  `RM      : ${group[0].RM || 'Unassigned'}\nManager : ${group[0].TL || ''}\n${group.map(r => `${idsFor(r)}  |  ${r.subRegion}  |  ${fmtWorkingWait(r.businessMinsToConnect, 'late')}${(r.siblingRMs && r.siblingRMs.length) ? `  |  also held by: ${r.siblingRMs.join(', ')}` : ''}`).join('\n')}`
).join('\n\n')}

Total Late Connections : ${notConnectedTotalLabel}` : '';

    // Leads Pending Beyond 48 Hours, appended as its own block — only the
    // leads NOT already surfaced above under their own primary issue (see
    // stuckRows above), so nothing is ever double-listed. Still a normal
    // actionable item, unlike the Not Connected reminder above it.
    const stuckByRM = groupBy(stuckItems, r => (r.RM || 'Unassigned') + '||' + (r.TL || ''));
    const stuckBlock = stuckItems.length ? `

${DIVIDER}
LEADS PENDING BEYOND 48 HOURS (NOT YET OPPORTUNITY) — also true, listed under another issue above
The following leads have been open more than 48 hours without reaching Opportunity, in addition to whatever issue they're already listed under above. Review and progress or close them.
${SUBDIVIDER}
${Object.values(stuckByRM).map(group =>
  `RM      : ${group[0].RM || 'Unassigned'}\nManager : ${group[0].TL || ''}\n${group.map(r => `${idsFor(r)}  |  ${r.subRegion}${(r.siblingRMs && r.siblingRMs.length) ? `  |  also held by: ${r.siblingRMs.join(', ')}` : ''}`).join('\n')}`
).join('\n\n')}

Total : ${stuckTotalLabel}` : '';

    // Stalled Leads: placed FIRST, ahead of even the main tally —
    // zero movement between the two picked Movement_Log snapshots on an
    // already-flagged issue is the most important thing in this email (see
    // stalledItems above).
    const stalledByRM = groupBy(stalledItems, r => (r.RM || 'Unassigned') + '||' + (r.TL || ''));
    const stalledCloneCounts = countUniqueAndCloned(stalledItems);
    const stalledTotalLabel = stalledCloneCounts.cloned > 0
      ? `${stalledCloneCounts.unique} (+${stalledCloneCounts.cloned} cloned cop${stalledCloneCounts.cloned === 1 ? 'y' : 'ies'} of the same customer, listed under their other RM below)`
      : String(stalledCloneCounts.unique);
    const stalledBlock = stalledItems.length ? `${DIVIDER}
STALLED LEADS (MOST IMPORTANT)
The following leads have shown zero movement — no stage change, call attempt, or new comment in any of the four comment columns — between the two Movement_Log snapshots picked in the dashboard (Operations → Stalled Leads), while already flagged for an issue. Review and escalate these first.
${SUBDIVIDER}
${Object.values(stalledByRM).map(group =>
  `RM      : ${group[0].RM || 'Unassigned'}\nManager : ${group[0].TL || ''}\n${group.map(r => `${idsFor(r)}  |  ${r.issue}  |  unchanged since ${istStamp(r.fromAt)}${(r.siblingRMs && r.siblingRMs.length) ? `  |  also held by: ${r.siblingRMs.join(', ')}` : ''}`).join('\n')}`
).join('\n\n')}

Total : ${stalledTotalLabel}
${DIVIDER}

` : '';

    // Possible Premature Closes, appended as its own block — a softer
    // signal than Stalled/Not Connected/Stuck above: these are CLOSED
    // leads, so nothing here is an open compliance breach, just a
    // discrepancy (closed, but the last note still sounded engaged) worth
    // a quick review before it's too late to revisit.
    const warmCloseByRM = groupBy(warmCloseItems, r => (r.RM || 'Unassigned') + '||' + (r.TL || ''));
    const warmCloseCloneCounts = countUniqueAndCloned(warmCloseItems);
    const warmCloseTotalLabel = warmCloseCloneCounts.cloned > 0
      ? `${warmCloseCloneCounts.unique} (+${warmCloseCloneCounts.cloned} cloned cop${warmCloseCloneCounts.cloned === 1 ? 'y' : 'ies'} of the same customer, listed under their other RM below)`
      : String(warmCloseCloneCounts.unique);
    const warmCloseBlock = warmCloseItems.length ? `

${DIVIDER}
POSSIBLE PREMATURE CLOSES (Worth a Second Look)
The following leads were closed, but the most recent logged note across this customer's full history (this copy and any sibling RM copies) still sounded engaged — Interested, Considering, Visit Arranged, etc. — rather than a clear no. Not proof the close was wrong, just worth a quick review before it's too late to revisit.
${SUBDIVIDER}
${Object.values(warmCloseByRM).map(group =>
  `RM      : ${group[0].RM || 'Unassigned'}\nManager : ${group[0].TL || ''}\n${group.map(r => `${idsFor(r)}  |  ${r.subRegion}  |  Closed as: ${r.closedReason}  |  Last note (${r.lastOutcome}): "${r.lastNote}"${(r.siblingRMs && r.siblingRMs.length) ? `  |  also held by: ${r.siblingRMs.join(', ')}` : ''}`).join('\n')}`
).join('\n\n')}

Total : ${warmCloseTotalLabel}` : '';

    // Rule-based highlights: a few short, deterministic takeaways pulled
    // straight from the tallies already computed above — no AI, just
    // surfacing the numbers a manager would otherwise have to skim the
    // whole email to find. Order is priority order, not discovery order.
    const highlights = [];
    if (stalledCloneCounts.unique > 0) {
      highlights.push(`${stalledCloneCounts.unique} lead${stalledCloneCounts.unique === 1 ? '' : 's'} stalled with zero movement — review these first.`);
    }
    if (sorted.length) {
      const byRM = groupBy(sorted, r => r.RM || 'Unassigned');
      const rmNames = Object.keys(byRM);
      const worstRM = rmNames.reduce((a, b) => byRM[b].length > byRM[a].length ? b : a, rmNames[0]);
      if (byRM[worstRM].length > 1) {
        const pct = Math.round((byRM[worstRM].length / sorted.length) * 100);
        highlights.push(`${worstRM} holds ${byRM[worstRM].length} of ${sorted.length} flagged leads (${pct}%) — the most of any RM in this report.`);
      }
      if (regionNames.length > 1) {
        const byRegion = groupBy(sorted, r => r.mainRegion);
        const regionKeys = Object.keys(byRegion);
        const worstRegion = regionKeys.reduce((a, b) => byRegion[b].length > byRegion[a].length ? b : a, regionKeys[0]);
        if (byRegion[worstRegion].length > 1) {
          const pct = Math.round((byRegion[worstRegion].length / sorted.length) * 100);
          highlights.push(`${worstRegion} accounts for ${byRegion[worstRegion].length} of ${sorted.length} flagged leads (${pct}%).`);
        }
      }
      const issueNames = Object.keys(tally);
      const topIssue = issueNames.reduce((a, b) => tally[b].length > tally[a].length ? b : a, issueNames[0]);
      highlights.push(`${topIssue} is the most common issue (${tally[topIssue].length} lead${tally[topIssue].length === 1 ? '' : 's'}).`);
    }
    if (warmCloseItems.length) {
      highlights.push(`${warmCloseCloneCounts.unique} closed lead${warmCloseCloneCounts.unique === 1 ? '' : 's'} had a still-warm-sounding note right before closing — worth a second look.`);
    }
    const highlightsBlock = highlights.length ? `Highlights:\n${highlights.map(h => `  • ${h}`).join('\n')}\n\n` : '';

    const subject = `${regionLabel} Report (${dateRange}) - ${sourceLabel} Leads with Issue${subjectScopeSuffix()}`;
    const body =
`Hi,

Please find below the ${sourceLabel} leads with issues:

Date range : ${dateRange}
Region${regionLabel.includes('&') || regionLabel.includes(',') ? 's' : ''}     : ${regionLabel}
Source     : ${sourceLabel}
Total      : ${totalCountLabel}

${highlightsBlock}${stalledBlock}${mainSection}${notConnectedBlock}${stuckBlock}${warmCloseBlock}

${EMAIL_SIGNATURE}`;

    const sections = Object.keys(tally).sort().map(issueName => {
      const issueFlag = _FLAG_BY_ISSUE_PRIORITY_LABEL[issueName];
      const isDueToday = issueFlag === 'underCalledToday';
      return {
        heading: issueName,
        subheading: `${tally[issueName].length} lead${tally[issueName].length === 1 ? '' : 's'}`,
        action: ISSUE_ACTION_MAP[issueFlag] || '',
        columns: (isDueToday ? ['Lead ID', 'Region', 'RM', 'Age', 'Attempts Today'] : ['Lead ID', 'Region', 'RM', 'Age']).concat('Suggested Follow-up'),
        rows: tally[issueName].map(r => {
          const created = parseDate(r.lead_created_at);
          const cells = [idsFor(r), r.subRegion, rmsFor(r), created ? ((now - created) / 36e5).toFixed(1) + 'h' : '—'];
          if (isDueToday) cells.push(attemptsTodayCell(r.attemptsToday));
          cells.push(followupTextFor(r));
          return cells;
        }),
      };
    });
    // Appended last, deliberately outside the alphabetical sort above —
    // this always reads as the final, separate section regardless of what
    // it would alphabetize to among the actionable issue names.
    if (notConnectedItems.length) {
      sections.push({
        heading: 'Not Connected in 10 Minutes',
        subheading: `${notConnectedTotalLabel} late connection${notConnectedCloneCounts.unique === 1 ? '' : 's'} — already happened, for the record only`,
        columns: ['Lead ID', 'Region', 'RM', 'Connected Late By', 'Suggested Follow-up'],
        rows: notConnectedItems.map(r => [idsFor(r), r.subRegion, rmsFor(r), fmtWorkingWait(r.businessMinsToConnect, 'late'), followupTextFor(r)]),
      });
    }
    if (stuckItems.length) {
      sections.push({
        // Distinct heading from the main-tally section above (which may
        // ALSO be titled "Leads Pending Beyond 48 Hours..." for leads where
        // it IS the primary pick) — same base issue, so the suffix keeps
        // the two from reading as an accidental duplicate section.
        heading: 'Leads Pending Beyond 48 Hours (Not Yet Opportunity) — Also Listed Above',
        subheading: `${stuckTotalLabel} lead${stuckCloneCounts.unique === 1 ? '' : 's'} — already listed under another issue above`,
        action: ISSUE_ACTION_MAP.stageStuck48h || '',
        columns: ['Lead ID', 'Region', 'RM', 'Suggested Follow-up'],
        rows: stuckItems.map(r => [idsFor(r), r.subRegion, rmsFor(r), followupTextFor(r)]),
      });
    }
    if (warmCloseItems.length) {
      sections.push({
        heading: 'Possible Premature Closes',
        subheading: `${warmCloseTotalLabel} closed lead${warmCloseCloneCounts.unique === 1 ? '' : 's'} — most recent logged note still sounded engaged, worth a second look`,
        action: `These leads were closed, but the most recent logged note across the full customer history (this copy and any sibling RM copies) still read as engaged — Interested, Considering, Visit Arranged, etc. — rather than a clear no. Confirm the close was intentional before it's too late to revisit.`,
        columns: ['Lead ID', 'Region', 'RM', 'Closed As', 'Last Note'],
        rows: warmCloseItems.map(r => [idsFor(r), r.subRegion, rmsFor(r), r.closedReason, `(${r.lastOutcome}) "${r.lastNote}"`]),
        accent: { fg: '#b45309', headerBg: '#fef3c7', bg: '#fffbeb' },
      });
    }
    // Stalled Leads, unshifted onto the FRONT so it always renders
    // first regardless of how the issue-name sections above alphabetize —
    // red-accented (see renderReportEmailHTML's sec.accent) so it visually
    // stands apart as the most important thing in the email.
    if (stalledItems.length) {
      sections.unshift({
        heading: 'Stalled Leads',
        subheading: `${stalledTotalLabel} lead${stalledCloneCounts.unique === 1 ? '' : 's'} — zero movement between the two picked Movement_Log snapshots on an already-flagged issue. Review and escalate first.`,
        action: 'These leads have shown no movement — no stage change, call attempt, or new comment in any of the four comment columns — between the two Movement_Log snapshots picked in the dashboard, while already flagged for an issue. Personally follow up and escalate immediately.',
        columns: ['Lead ID', 'Region', 'RM', 'Issue', 'Stalled Since', 'Suggested Follow-up'],
        rows: stalledItems.map(r => [idsFor(r), r.region, rmsFor(r), r.issue, istStamp(r.fromAt), followupTextFor(r)]),
        accent: { fg: '#dc2626', headerBg: '#fee2e2', bg: '#fef2f2' },
      });
    }

    // An absent Stalled section should say why when it's a setup gap (not
    // enough Movement_Log history yet) rather than reading identically to
    // "nothing is currently stalled" (a good outcome, needs no explanation).
    let stalledDiagnostic = '';
    if (!stalledItems.length && !stalledWindowAvailable) {
      stalledDiagnostic = ' Stalled Leads needs the Compare from/to picker above Stalled Leads (Operations tab) to have two Movement_Log snapshots selected before it can compare two points in time.';
    }

    const html = renderReportEmailHTML({
      eyebrow: 'Lead Funnel · SLA Monitor',
      title: 'All Issues',
      region: regionLabel,
      subtitle: `${dateRange} — ${sourceLabel} leads${subjectScopeSuffix()}`,
      kpis: [
        { value: cloneCounts.unique, label: 'Leads Flagged', bg: '#e0e7ff', fg: '#4338ca' },
        { value: stalledCloneCounts.unique, label: stalledCloneCounts.unique === 1 ? 'Stalled Lead' : 'Stalled Leads', bg: '#fee2e2', fg: '#dc2626' },
        { value: warmCloseCloneCounts.unique, label: warmCloseCloneCounts.unique === 1 ? 'Premature Close?' : 'Premature Closes?', bg: '#fef3c7', fg: '#b45309' },
      ],
      highlights,
      sections,
      footerNote: `Leads created less than ${CONFIG.LEAD_GRACE_HOURS} hours ago are excluded.`
        + (notConnectedItems.length ? ' The 10-Minute Response SLA reminder above is independent of that grace period and of the issue counts above — it is a separate record, not one of the tallied issues.' : '')
        + (stuckItems.length ? ' Leads Pending Beyond 48 Hours above are the ones NOT already shown under their own primary issue further up — see the main tally for the rest of that count.' : '')
        + (stalledItems.length ? ' Stalled Leads is a Movement_Log-derived callout and may overlap with leads already counted in the main tally above — it is not an additional count on top of Total.' : stalledDiagnostic)
        + (warmCloseItems.length ? ' Possible Premature Closes is a discrepancy flag on CLOSED leads, not a compliance count — it does not overlap with or add to the open-issue Total above.' : '')
        + ((cloneCounts.cloned > 0 || notConnectedCloneCounts.cloned > 0 || stuckCloneCounts.cloned > 0 || stalledCloneCounts.cloned > 0 || warmCloseCloneCounts.cloned > 0) ? ' Per-issue counts above are per flagged copy, not per customer — a customer with two RM copies can be flagged twice, once for each copy\'s own issue.' : ''),
    });

    // `sorted` (the core issue-flagged population this report's main tally
    // is built from — open, not Opportunity+, one of the 5 SLA issues) is
    // exposed here so renderReports can push exactly these leads' comment
    // history to Lead_Followups. Deliberately NOT notConnectedItems/
    // stuckItems (neither is genuinely "in one of the issues" — see their
    // own comments above) or warmCloseItems (those are closed leads).
    return { region: regionLabel, subject, body, html, count: cloneCounts.unique + notConnectedCloneCounts.unique + stuckCloneCounts.unique + stalledCloneCounts.unique + warmCloseCloneCounts.unique, issueLabel: 'All issues', regionNames, sorted };
  });
}
// Builds every issue/region combination at once. With ~8 issues × up to ~19
// regions that's potentially 150 emails, so bodies render collapsed and
// expand on demand rather than dumping everything into the DOM.

/* ============ ALL ISSUES × ALL REGIONS, ONE CLICK ============ */
// Builds every issue/region combination at once. With ~8 issues × up to ~19
// regions that's potentially 150 emails, so bodies render collapsed and
// expand on demand rather than dumping everything into the DOM.
let _allReports = [];

function buildAllRegionReports(){
  const out = [];
  let totalOutOfScope = 0;
  let totalUndatable = 0;
  _lastReportOutOfScopeNames = {}; // accumulated across all issues below
  Object.keys(ISSUE_REPORT_META).forEach(issueKey => {
    const meta = ISSUE_REPORT_META[issueKey];
    buildRegionReports(issueKey).forEach(r => {
      out.push(Object.assign({}, r, { issueKey, issueLabel: meta.label }));
    });
    // buildRegionReports overwrites the trackers per call — accumulate here
    // so the notice reflects every issue, not just the last one built.
    totalOutOfScope += _lastReportOutOfScope;
    totalUndatable += _lastReportUndatable;
  });
  _lastReportOutOfScope = totalOutOfScope;
  _lastReportUndatable = totalUndatable;
  return out;
}

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
