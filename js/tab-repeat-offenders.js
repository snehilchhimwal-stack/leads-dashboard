// ============================================================
// tab-repeat-offenders.js — Repeat Offenders section (Operations tab).
// Reads "Daily_RM_Issues", a nightly 22:50 IST snapshot a separate Apps
// Script (DailyRmIssueLog.gs) writes independently of whether this
// dashboard or the Sheet itself is open — same reasoning as
// Movement_Log (tab-movement.js's own header comment). Shows a top-20
// RM leaderboard plus a hierarchy rollup to top-10 A1/TM and top-5 RH,
// with a Today/Yesterday/This Week/Last 7 Days/All-time selector,
// honoring the same top-bar Project/Region/TL/Source/Bucket filters
// every other Movement-backed view does (see passesMovementFilters's
// own comment on skipDateFilter for the same "this section has its own
// independent time control" reasoning — the top bar's Assigned-date
// RANGE filter does not apply here either, same as Daily Cohort by
// Region in tab-tracking.js).
//
// Depends on core.js (filterState, mainRegionFor, sheetsApiValuesGet,
// valuesToGvizShape/gvizCellRaw/gvizCellDate, istDateKey/istParts, esc)
// loaded first.
//
// RM_Hierarchy is fetched here for the FIRST time from the browser side
// — reports.js deliberately never reads it (real per-RM TL/RH/CH
// routing is the overnight automation's own separate Apps-Script-side
// thing, kept independent on purpose — see recipientsForReport's own
// comment). That principle is about not duplicating ROUTING decisions;
// this is a read-only rollup for display, a different concern, so
// reading RM_Hierarchy here doesn't violate it.
// ============================================================

let dailyRmIssues = [];               // {date, RM, region, project, lead_id, client_id, issue_key, issue_label, TL, group_source, source_bucket}
let dailyRmIssuesFetchState = 'idle'; // 'idle' | 'loading' | 'ok' | 'missing' | 'error'
let dailyRmIssuesFetchError = '';

let rmHierarchyByNameLower = new Map(); // lowercased RM name -> {name, role, tl, tm, rh, ch}
let rmHierarchyFetchState = 'idle';     // 'idle' | 'loading' | 'ok' | 'missing' | 'error'

const DAILY_RM_ISSUES_TAB_NAME = 'Daily_RM_Issues';
const DAILY_RM_ISSUES_COLUMNS = ['date', 'RM', 'region', 'project', 'lead_id', 'client_id', 'issue_key', 'issue_label', 'captured_at', 'TL', 'group_source', 'source_bucket'];
const RM_HIERARCHY_TAB_NAME = 'RM_Hierarchy';
const RM_HIERARCHY_COLUMNS = ['team', 'role', 'name', 'tl', 'tm', 'rh', 'ch', 'excluded', 'note', 'email'];

async function fetchDailyRmIssues(sheetId){
  dailyRmIssuesFetchState = 'loading';
  dailyRmIssuesFetchError = '';
  try {
    let values;
    try {
      values = await sheetsApiValuesGet(sheetId, `${DAILY_RM_ISSUES_TAB_NAME}!A1:Z`);
    } catch (err) {
      // Same 400-vs-everything-else split as fetchMovementLog — a missing
      // tab (setup not done yet) is the expected/common case, not an error.
      if (err.status === 400) { dailyRmIssuesFetchState = 'missing'; dailyRmIssues = []; return; }
      dailyRmIssuesFetchState = 'error';
      dailyRmIssuesFetchError = err.status ? `HTTP ${err.status}: ${err.message}` : String((err && err.message) || err);
      dailyRmIssues = [];
      return;
    }
    if (!values.length) { dailyRmIssuesFetchState = 'missing'; dailyRmIssues = []; return; }

    // 'date' was written by Apps Script as a plain "yyyy-MM-dd" STRING
    // (istDayKeyGs_), but Sheets can auto-detect that as a real date and
    // store it as a serial number instead — same gotcha the Overnight_Log
    // read (OvernightEmailer.gs) and Movement_Log both already handle.
    // Declaring it a date column here is safe either way: gvizCellDate
    // falls back to parseDate() on a plain string when the raw value
    // wasn't actually converted to a serial.
    const table = valuesToGvizShape(values, (label) => label === 'date');
    const cols = table.cols;
    const rows = table.rows.map(r => r.c || []);
    const idx = {};
    DAILY_RM_ISSUES_COLUMNS.forEach(key => {
      let found = -1;
      cols.forEach((c, i) => { if (found === -1 && String(c.label || '').trim() === key) found = i; });
      idx[key] = found;
    });
    if (idx.RM === -1 || idx.date === -1) { dailyRmIssuesFetchState = 'missing'; dailyRmIssues = []; return; }

    const getRaw = (c, key) => idx[key] === -1 ? '' : gvizCellRaw(c[idx[key]]);
    const getDate = (c, key) => idx[key] === -1 ? null : gvizCellDate(c[idx[key]]);

    dailyRmIssues = rows
      .filter(c => String(getRaw(c, 'RM')).trim() !== '')
      .map(c => {
        const dateVal = getDate(c, 'date');
        return {
          date: dateVal ? istDateKey(dateVal) : String(getRaw(c, 'date')).trim(),
          RM: getRaw(c, 'RM') || 'Unassigned',
          region: getRaw(c, 'region') || 'Unassigned',
          project: getRaw(c, 'project') || '',
          lead_id: getRaw(c, 'lead_id'),
          client_id: getRaw(c, 'client_id'),
          issue_key: getRaw(c, 'issue_key'),
          issue_label: getRaw(c, 'issue_label'),
          TL: getRaw(c, 'TL') || '',
          group_source: getRaw(c, 'group_source') || '',
          source_bucket: getRaw(c, 'source_bucket') || '',
        };
      })
      .filter(r => r.date); // undated rows can't be placed into a time range — drop them

    dailyRmIssuesFetchState = dailyRmIssues.length ? 'ok' : 'missing';
  } catch (err) {
    dailyRmIssuesFetchState = 'error';
    dailyRmIssuesFetchError = String((err && err.message) || err);
    dailyRmIssues = [];
  }
}

async function fetchRmHierarchyForRollup(sheetId){
  rmHierarchyFetchState = 'loading';
  rmHierarchyByNameLower = new Map();
  try {
    let values;
    try {
      values = await sheetsApiValuesGet(sheetId, `${RM_HIERARCHY_TAB_NAME}!A1:Z`);
    } catch (err) {
      rmHierarchyFetchState = err.status === 400 ? 'missing' : 'error';
      return;
    }
    if (!values.length) { rmHierarchyFetchState = 'missing'; return; }

    const table = valuesToGvizShape(values, () => false); // no date columns in RM_Hierarchy
    const cols = table.cols;
    const rows = table.rows.map(r => r.c || []);
    const idx = {};
    RM_HIERARCHY_COLUMNS.forEach(key => {
      let found = -1;
      cols.forEach((c, i) => { if (found === -1 && String(c.label || '').trim() === key) found = i; });
      idx[key] = found;
    });
    if (idx.name === -1) { rmHierarchyFetchState = 'missing'; return; }

    const getRaw = (c, key) => idx[key] === -1 ? '' : gvizCellRaw(c[idx[key]]);

    rows.forEach(c => {
      const name = String(getRaw(c, 'name') || '').trim();
      if (!name) return;
      rmHierarchyByNameLower.set(name.toLowerCase(), {
        name: name,
        role: getRaw(c, 'role') || '',
        tl: getRaw(c, 'tl') || '',
        tm: getRaw(c, 'tm') || '',
        rh: getRaw(c, 'rh') || '',
        ch: getRaw(c, 'ch') || '',
      });
    });
    rmHierarchyFetchState = rmHierarchyByNameLower.size ? 'ok' : 'missing';
  } catch (err) {
    rmHierarchyFetchState = 'error';
  }
}

// This RM's primary people-manager — A1 if they have one, else TM, same
// "prefer A1, fall back to TM" preference resolveRecipientBucketsForRms_
// (RmHierarchy.gs) uses for real email routing. Returns null when the RM
// isn't in RM_Hierarchy at all (departed, or an unaliased spelling
// variant — same population auditUnresolvedRmsNow() already surfaces).
function primaryManagerForRm(rmName){
  const row = rmHierarchyByNameLower.get(String(rmName || '').trim().toLowerCase());
  if (!row) return null;
  return row.tl || row.tm || null;
}
function rhForRm(rmName){
  const row = rmHierarchyByNameLower.get(String(rmName || '').trim().toLowerCase());
  return row ? (row.rh || null) : null;
}

// Same Project/Region/TL/Source/Bucket filters every other Movement-
// backed view honors (see passesMovementFilters, tab-movement.js) —
// deliberately NOT re-using that function directly, since a
// Daily_RM_Issues row's `region` is the raw value captured at flag time
// (getVal_ off the live leads tab or a Movement_Log row), not run
// through effectiveRegion()'s cross-field Loan-source inference the way
// a live lead record is. A "Loan" lead may not filter perfectly under
// the Region control here as a result — a narrow, documented gap, not a
// silent one.
function passesRepeatOffenderFilters(rec){
  const projSel = filterState.project, regSel = filterState.region, tlSel = filterState.TL;
  const srcSel = filterState.source, bucketSel = filterState.bucket;
  if (projSel.size && !projSel.has(rec.project)) return false;
  if (regSel.size && !regSel.has(rec.region) && !regSel.has(mainRegionFor(rec.region))) return false;
  if (tlSel.size && !tlSel.has(rec.TL)) return false;
  if (srcSel.size && !Array.from(srcSel).some(s => s.toLowerCase() === String(rec.group_source).trim().toLowerCase())) return false;
  if (bucketSel.size && !bucketSel.has(String(rec.source_bucket).trim())) return false;
  return true;
}

// null return (allTime) means "no date filter at all".
function repeatOffendersDateKeysForRange(range, now){
  if (range === 'today') return new Set([istDateKey(now)]);
  if (range === 'yesterday') return new Set([istDateKey(new Date(now.getTime() - 86400000))]);
  if (range === 'thisWeek') {
    const p = istParts(now);
    const daysSinceMonday = (p.dow + 6) % 7; // Sunday(0)->6, Monday(1)->0, ...
    const set = new Set();
    for (let i = 0; i <= daysSinceMonday; i++) set.add(istDateKey(new Date(now.getTime() - i * 86400000)));
    return set;
  }
  if (range === 'last7Days') {
    const set = new Set();
    for (let i = 0; i < 7; i++) set.add(istDateKey(new Date(now.getTime() - i * 86400000)));
    return set;
  }
  if (range === 'custom') {
    const fromEl = document.getElementById('repeatOffendersCustomFrom');
    const toEl = document.getElementById('repeatOffendersCustomTo');
    const fromVal = fromEl ? fromEl.value : ''; // "YYYY-MM-DD" from <input type="date">, or "" if unset
    const toVal = toEl ? toEl.value : '';
    if (!fromVal || !toVal) return null; // incomplete custom range — no restriction rather than a confusing empty result
    const fromMs = new Date(fromVal + 'T00:00:00+05:30').getTime();
    const toMs = new Date(toVal + 'T00:00:00+05:30').getTime();
    const set = new Set();
    for (let ms = Math.min(fromMs, toMs); ms <= Math.max(fromMs, toMs); ms += 86400000) set.add(istDateKey(new Date(ms)));
    return set;
  }
  return null; // allTime
}

// Generic aggregator: groups the given (already filtered/time-scoped)
// Daily_RM_Issues rows by keyFn(rec). Ranked by instancePct (total
// flagged-instances per distinct flagged lead — kept ×100 internally
// for the sort, but shown in the UI as a plain "2.5x avg flagged
// nights" ratio, not a %, per explicit request) — NOT raw totalInstances
// alone. Raw instances rewards volume: a rollup with 60 flagged leads
// and 75 instances (75/60 = 1.25x, each lead flagged about once) would
// outrank one with 10 flagged leads and 25 instances (25/10 = 2.5x,
// each lead flagged on average two and a half times) purely for having
// more leads, even though the SECOND is the genuinely worse repeat
// pattern per lead. distinctLeads has no "total leads this RM owns"
// denominator available — Daily_RM_Issues only ever contains FLAGGED
// rows, never a complete lead roster — so this is specifically "how many
// times did each already-flagged lead get flagged again", not "what
// fraction of this RM's whole book is flagged." distinctDays/
// distinctIssueTypes are still computed (harmless, available if a future
// view wants them) but not sorted on or displayed. distinctRMs (how many
// different RMs roll up into this one key) is extra context for a
// manager/RH/region-level row, always 1 at the RM level itself.
function aggregateRepeatOffenders(rows, keyFn){
  const byKey = {};
  rows.forEach(rec => {
    const key = keyFn(rec);
    if (!key) return; // unresolvable (e.g. not in RM_Hierarchy for a manager/RH rollup) — excluded, same population auditUnresolvedRmsNow flags
    if (!byKey[key]) byKey[key] = { name: key, days: new Set(), issueTypes: new Set(), byIssue: {}, totalInstances: 0, rms: new Set(), leads: new Set() };
    const b = byKey[key];
    b.days.add(rec.date);
    b.issueTypes.add(rec.issue_key);
    b.byIssue[rec.issue_key] = (b.byIssue[rec.issue_key] || 0) + 1;
    b.totalInstances++;
    b.rms.add(rec.RM);
    b.leads.add(rec.lead_id);
  });
  return Object.keys(byKey).map(key => {
    const b = byKey[key];
    const distinctLeads = b.leads.size;
    return {
      name: b.name, distinctDays: b.days.size, distinctIssueTypes: b.issueTypes.size,
      totalInstances: b.totalInstances, byIssue: b.byIssue, distinctRMs: b.rms.size,
      distinctLeads: distinctLeads, instancePct: distinctLeads ? (b.totalInstances / distinctLeads * 100) : 0,
    };
  }).sort((a, b) => (b.instancePct - a.instancePct) || (b.totalInstances - a.totalInstances) || (b.distinctLeads - a.distinctLeads));
}

// The By Region table's own grouping key — mirrors effectiveRegion +
// mainRegionFor (reports.js), the SAME normalization every other
// region-based view on this dashboard uses, so a sub-region variant
// (e.g. "Pune East") correctly rolls up into its canonical main region
// ("Pune") instead of forming its own separate row and silently
// under-counting the main region's true total (real bug, found via a
// user report comparing this table's Pune count against Overview's).
// Daily_RM_Issues has group_source (so that half of the Loan override
// applies) but never project_region (not one of its captured columns) —
// same gap _effectiveRegionGs_ (MovementTracker.gs) already documents
// for the identical reason. Falls back to the raw region for anything
// mainRegionFor doesn't recognize, rather than dropping it silently.
function _repeatOffendersRegionKey(rec){
  const raw = normRegionKey(rec.group_source || '') === 'loan' ? 'Loan' : String(rec.region || '').trim();
  return mainRegionFor(raw) || raw || 'Unassigned';
}

function renderRepeatOffenders(){
  const bodyEl = document.getElementById('repeatOffendersBody');
  const noticeEl = document.getElementById('repeatOffendersNotice');
  const countEl = document.getElementById('repeatOffendersCount');
  if (!bodyEl) return;

  const clear = (message) => {
    bodyEl.innerHTML = '';
    if (countEl) countEl.textContent = '';
    if (noticeEl) { noticeEl.style.display = 'block'; noticeEl.innerHTML = message; }
  };

  if (dailyRmIssuesFetchState === 'loading') { clear('Loading repeat-offender history…'); return; }
  if (dailyRmIssuesFetchState === 'error') { clear('Could not load Daily_RM_Issues: ' + esc(dailyRmIssuesFetchError)); return; }
  if (dailyRmIssuesFetchState !== 'ok' || !dailyRmIssues.length) {
    clear('No <span class="mono">Daily_RM_Issues</span> data yet — run <span class="mono">setupDailyRmIssueLog()</span> then <span class="mono">backfillDailyRmIssuesFromMovementLogNow()</span> in Apps Script (DailyRmIssueLog.gs), or wait for tonight\'s 22:50 IST capture.');
    return;
  }

  const rangeSel = document.getElementById('repeatOffendersRangeSelect');
  const range = rangeSel ? rangeSel.value : 'last7Days';
  const now = (typeof _renderNow !== 'undefined' && _renderNow) ? _renderNow : new Date();
  const dateKeys = repeatOffendersDateKeysForRange(range, now);

  // Split into two passes (date-range, then the top-bar filters) instead
  // of one combined filter — so an empty result can say WHICH of the two
  // actually caused it, rather than a single opaque "nothing matches"
  // message that leaves "is my 26k rows of data even being read?"
  // unanswerable from the UI alone.
  const dateOnlyScoped = dailyRmIssues.filter(rec => !dateKeys || dateKeys.has(rec.date));
  const scoped = dateOnlyScoped.filter(passesRepeatOffenderFilters);

  if (!scoped.length) {
    const activeFilters = [];
    if (filterState.project.size) activeFilters.push(`Project (${filterState.project.size})`);
    if (filterState.region.size) activeFilters.push(`Region (${filterState.region.size})`);
    if (filterState.TL.size) activeFilters.push(`TL (${filterState.TL.size})`);
    if (filterState.source.size) activeFilters.push(`Source (${filterState.source.size})`);
    if (filterState.bucket.size) activeFilters.push(`Sub-source (${filterState.bucket.size})`);
    const filterNote = activeFilters.length
      ? `Active filters likely narrowing this to zero: <b>${esc(activeFilters.join(', '))}</b>. Clear them in the filter bar above to check.`
      : 'No Project/Region/TL/Source/Sub-source filters are currently active, so this is NOT a filter issue — the flagged leads in this time range genuinely have no matching rows (unlikely if the time range is "From when history began").';
    clear(`<b>${esc(dailyRmIssues.length)}</b> total flagged instance${dailyRmIssues.length === 1 ? '' : 's'} loaded from Daily_RM_Issues; <b>${esc(dateOnlyScoped.length)}</b> fall in this time range; <b>0</b> match after the top-bar filters below. ${filterNote} (The top-bar Assigned-date range filter never applies here, by design — only this section\'s own Time range selector does.)`);
    if (countEl) countEl.textContent = '0';
    return;
  }
  if (noticeEl) noticeEl.style.display = 'none';
  if (countEl) countEl.textContent = `${scoped.length} flagged instance${scoped.length === 1 ? '' : 's'}`;

  // Full RM ranking, computed once — the two volume-cut tables below
  // (Leads > 50 / > 100) just re-filter this same already-sorted list
  // rather than re-aggregating from scratch. Ranking by Avg Flagged
  // (aggregateRepeatOffenders' own sort) deliberately favors RATE over
  // volume — see this section's own filter-summary text — so an RM
  // carrying a genuinely large number of distinct flagged leads can sit
  // far down (or off) the plain Top 20 despite the sheer size of their
  // problem. These two extra cuts restore that visibility directly,
  // still ranked by the same Avg Flagged rule within each cut.
  const rmListFull = aggregateRepeatOffenders(scoped, rec => rec.RM);
  const rmList = rmListFull.slice(0, 20);
  const rmListOver50 = rmListFull.filter(r => r.distinctLeads > 50).slice(0, 20);
  const rmListOver100 = rmListFull.filter(r => r.distinctLeads > 100).slice(0, 20);
  const a1tmList = aggregateRepeatOffenders(scoped, rec => primaryManagerForRm(rec.RM)).slice(0, 10);
  const rhList = aggregateRepeatOffenders(scoped, rec => rhForRm(rec.RM)).slice(0, 5);
  // Region needs no hierarchy lookup at all — it's a field already on
  // every Daily_RM_Issues row. Not capped tightly like the RM/A1-TM/RH
  // lists: there are only ~11 canonical regions (REGION_GROUP_MAP,
  // reports.js), so 15 comfortably shows all of them without needing a
  // separate "show more" affordance.
  const regionList = aggregateRepeatOffenders(scoped, rec => _repeatOffendersRegionKey(rec)).slice(0, 15);
  const hierarchyMissing = rmHierarchyFetchState !== 'ok';

  // Grid order is deliberately NOT "biggest cap first" — it pairs tables
  // whose typical row counts are closest, so the 2-column grid doesn't
  // routinely pair a 20-row table against a 5-row one and leave a tall
  // gap. The three RM-cut tables (cap 20 each) pair with each other and
  // with Region (cap 15, the next closest); A1/TM (cap 10) and RH
  // (cap 5) — both always small — pair together last.
  bodyEl.innerHTML = `<div class="repeat-offenders-grid">
    ${repeatOffenderTableHtml('Top 20 RMs', rmList, false)}
    ${repeatOffenderTableHtml('Top 20 RMs (Leads > 50)', rmListOver50, false)}
    ${repeatOffenderTableHtml('Top 20 RMs (Leads > 100)', rmListOver100, false)}
    ${repeatOffenderTableHtml('By Region', regionList, false)}
    ${repeatOffenderTableHtml('Top 10 A1 / TM', a1tmList, hierarchyMissing)}
    ${repeatOffenderTableHtml('Top 5 RH', rhList, hierarchyMissing)}
  </div>`;
}

function repeatOffenderTableHtml(title, list, hierarchyMissing){
  if (hierarchyMissing) {
    return `<div>
      <div class="repeat-offenders-subtitle">${esc(title)}</div>
      <div class="dim" style="font-size:12px;">RM_Hierarchy could not be read — rollup unavailable. Every other view on this dashboard works fine without it; only this rollup needs it.</div>
    </div>`;
  }
  if (!list.length) {
    return `<div>
      <div class="repeat-offenders-subtitle">${esc(title)}</div>
      <div class="dim" style="font-size:12px;">Nothing to show for the current filters/range.</div>
    </div>`;
  }
  const rows = list.map((r, i) => {
    const topIssues = Object.keys(r.byIssue).sort((a, b) => r.byIssue[b] - r.byIssue[a]).slice(0, 2)
      .map(k => `${esc(k)}: ${r.byIssue[k]}`).join(', ');
    return `<tr>
      <td class="num dim">${i + 1}</td>
      <td>${esc(r.name)}${r.distinctRMs > 1 ? ` <span class="dim" style="font-size:11px;">(${r.distinctRMs} RMs)</span>` : ''}</td>
      <td class="num">${r.distinctLeads}</td>
      <td class="num">${r.totalInstances}</td>
      <td class="num">${(r.totalInstances / r.distinctLeads).toFixed(1)}x</td>
      <td class="dim" style="font-size:11.5px;">${topIssues}</td>
    </tr>`;
  }).join('');
  return `<div>
    <div class="repeat-offenders-subtitle">${esc(title)}</div>
    <div class="section-scroll no-cap"><table><thead><tr>
      <th></th><th>Name</th>
      <th style="text-align:right" title="Distinct leads that got flagged at least once in the current time range/filters.">Leads</th>
      <th style="text-align:right" title="Total flagged-lead-rows. The same lead flagged on 3 different nights counts 3 times.">Instances</th>
      <th style="text-align:right" title="Sort key: Instances ÷ Leads — average number of times each already-flagged lead got flagged again. 2.5x means each flagged lead averaged 2.5 flagged nights. Ranks higher than a bigger Instances count with more Leads behind it (that's volume, not a worse per-lead pattern).">Avg Flagged<br><span class="dim" style="font-weight:400; font-size:9.5px;">(Instances ÷ Leads)</span></th>
      <th>Top Issues</th>
    </tr></thead><tbody>${rows}</tbody></table></div>
  </div>`;
}

// Shows/hides the custom From/To date inputs based on the range select's
// current value — called once at load (in case "Custom range…" is ever
// pre-selected, e.g. after a browser back/forward restoring form state)
// and again on every change.
function _repeatOffendersSyncCustomRangeVisibility(){
  const rangeEl = document.getElementById('repeatOffendersRangeSelect');
  const isCustom = !!rangeEl && rangeEl.value === 'custom';
  const fromWrap = document.getElementById('repeatOffendersCustomFromWrap');
  const toWrap = document.getElementById('repeatOffendersCustomToWrap');
  if (fromWrap) fromWrap.style.display = isCustom ? '' : 'none';
  if (toWrap) toWrap.style.display = isCustom ? '' : 'none';
}

// Top-level, same reasoning as reports.js's own reportModeSelect wiring
// — this script tag loads after the static HTML it targets, so every
// element already exists by the time this runs. Purely local re-render
// (no re-fetch needed): every range's data is already in dailyRmIssues.
const _repeatOffendersRangeSelectEl = document.getElementById('repeatOffendersRangeSelect');
if (_repeatOffendersRangeSelectEl) {
  _repeatOffendersRangeSelectEl.addEventListener('change', function(){
    _repeatOffendersSyncCustomRangeVisibility();
    renderRepeatOffenders();
  });
}
const _repeatOffendersCustomFromEl = document.getElementById('repeatOffendersCustomFrom');
if (_repeatOffendersCustomFromEl) _repeatOffendersCustomFromEl.addEventListener('change', renderRepeatOffenders);
const _repeatOffendersCustomToEl = document.getElementById('repeatOffendersCustomTo');
if (_repeatOffendersCustomToEl) _repeatOffendersCustomToEl.addEventListener('change', renderRepeatOffenders);
_repeatOffendersSyncCustomRangeVisibility();
