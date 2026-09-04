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
const DAILY_RM_ISSUES_COLUMNS = ['date', 'RM', 'region', 'project', 'lead_id', 'client_id', 'issue_key', 'issue_label', 'captured_at', 'TL', 'group_source', 'source_bucket', 'lead_assigned_at'];
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
    const table = valuesToGvizShape(values, (label) => label === 'date' || label === 'lead_assigned_at');
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
          lead_assigned_at: getDate(c, 'lead_assigned_at'),
          // IST day-key of lead_assigned_at, computed once here (same
          // pattern as `date` above) rather than per-filter-pass — this is
          // what the Time range selector actually matches against, since
          // "Today" etc. should mean "assigned today", not "flagged
          // tonight". Null when the row predates this column or the repair
          // couldn't resolve it — such rows simply never match a specific
          // range (they still show under All-time, which skips date
          // matching entirely).
          leadAssignedDateKey: (function () { const la = getDate(c, 'lead_assigned_at'); return la ? istDateKey(la) : null; })(),
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
    if (!byKey[key]) byKey[key] = { name: key, days: new Set(), issueTypes: new Set(), byIssue: {}, byIssueLabel: {}, totalInstances: 0, rms: new Set(), leads: new Set() };
    const b = byKey[key];
    b.days.add(rec.date);
    b.issueTypes.add(rec.issue_key);
    b.byIssue[rec.issue_key] = (b.byIssue[rec.issue_key] || 0) + 1;
    // Captured straight from the record's own issue_label (Daily_RM_Issues'
    // own column, ultimately from primaryIssueGs_/ISSUE_PRIORITY_GS_,
    // SlaEngine.gs) rather than a second hardcoded key->label table here
    // that could quietly drift out of sync with the real source.
    if (!b.byIssueLabel[rec.issue_key]) b.byIssueLabel[rec.issue_key] = rec.issue_label || rec.issue_key;
    b.totalInstances++;
    b.rms.add(rec.RM);
    b.leads.add(rec.lead_id);
  });
  return Object.keys(byKey).map(key => {
    const b = byKey[key];
    const distinctLeads = b.leads.size;
    return {
      name: b.name, distinctDays: b.days.size, distinctIssueTypes: b.issueTypes.size,
      totalInstances: b.totalInstances, byIssue: b.byIssue, byIssueLabel: b.byIssueLabel, distinctRMs: b.rms.size,
      distinctLeads: distinctLeads, instancePct: distinctLeads ? (b.totalInstances / distinctLeads * 100) : 0,
    };
  }).sort((a, b) => (b.instancePct - a.instancePct) || (b.totalInstances - a.totalInstances) || (b.distinctLeads - a.distinctLeads));
}

// Total leads assigned to each group-key, REGARDLESS of whether currently
// flagged for any SLA issue — the denominator aggregateRepeatOffenders'
// own comment flags as unavailable ("Daily_RM_Issues only ever contains
// FLAGGED rows, never a complete lead roster").
//
// Reads `movementSnapshots` (Movement_Log, tab-movement.js's own fetch —
// see MOVEMENT_LOG_COLUMNS), NOT `allParsedLeads` (the live "leads" tab).
// This was tried against allParsedLeads first and switched after a real
// gap: the live leads tab only ever holds currently-OPEN leads (a closed/
// converted lead is removed from it entirely), so a Total Leads count
// built from it would silently miss every lead that closed since it was
// assigned — undercounting even for a date well within the ordinary
// window. Movement_Log's own snapshotOpenLeads_ (MovementTracker.gs)
// explicitly captures "every lead... open or closed", so a lead is still
// visible here for as long as ANY of its 4-times-daily snapshots survives
// Movement_Log's own MOVEMENT_LOG_RETENTION_DAYS (7 days) pruning — it
// only drops out once it has been closed AND pruned, not the moment it
// closes.
//
// A lead can appear in several snapshot rows (once per capture run it
// was still reachable for) — deduped to ONE row per lead_id first, taking
// whichever snapshot is LATEST, so a reassigned lead's RM/region/etc.
// reflects its most recently known state (this can occasionally disagree
// with which RM's Daily_RM_Issues instance-count a specific night's flag
// landed under, if the lead was reassigned in between — a documented,
// accepted imprecision for what is fundamentally a denominator/
// sanity-check number, not a payroll-grade attribution).
//
// keyFn/dateKeys use the exact same shape and semantics as
// aggregateRepeatOffenders/repeatOffendersDateKeysForRange (a
// movementSnapshots record has the same .RM/.region/.group_source/.TL/
// .source_bucket field names Daily_RM_Issues rows do, from the same
// HEADER_ALIASES_ convention, so the identical keyFn/
// passesRepeatOffenderFilters work unchanged against this shape too) —
// dateKeys is always matched against the LEAD's OWN lead_assigned_at
// (never a "captured on" concept, which doesn't apply to a plain roster
// count); null means unrestricted, one Set of N dates means "assigned on
// any of those N days", which doubles as both the single-date case (Just
// That Day) and the multi-day case (naturally sums to the union across
// the days — a lead has exactly one assignment date, so summing per-day
// counts and counting the union of days are the same number).
//
// KNOWN LIMITATION, narrower than the allParsedLeads version but not
// eliminated: Movement_Log itself is ALSO pruned to a 7-day rolling
// window (MOVEMENT_LOG_RETENTION_DAYS, MovementTracker.gs) — a lead
// closed AND aged out past that window is gone from here too. Recent
// ranges (Yesterday, Last 7 Days, This Week) are normally within that
// window; a Custom range or All-time reaching further back can still
// undercount.
function totalLeadsByKey(keyFn, dateKeys){
  const counts = {};
  if (typeof movementSnapshots === 'undefined' || !movementSnapshots.length) return counts;

  const latestByLeadId = new Map();
  movementSnapshots.forEach(rec => {
    const id = String(rec.lead_id || '').trim();
    if (!id) return;
    const cur = latestByLeadId.get(id);
    if (!cur || (rec.snapshot_at && (!cur.snapshot_at || rec.snapshot_at > cur.snapshot_at))) latestByLeadId.set(id, rec);
  });

  latestByLeadId.forEach(rec => {
    if (!passesRepeatOffenderFilters(rec)) return;
    if (dateKeys) {
      const assignedDate = parseDate(rec.lead_assigned_at);
      const dk = assignedDate ? istDateKey(assignedDate) : null;
      if (!dk || !dateKeys.has(dk)) return;
    }
    const key = keyFn(rec);
    if (!key) return;
    counts[key] = (counts[key] || 0) + 1;
  });
  return counts;
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

  // 2026-09-04 redesign (see HANDOVER.md §9.7 for the full writeup): this
  // section now reads Movement_Log via computeRmPerformance()
  // (core-rm-performance.js), NOT Daily_RM_Issues — Daily_RM_Issues is a
  // violations-only log and can't supply a true eligible-population
  // denominator, which is exactly what made the old "Avg Flagged" ranking
  // unfair to begin with. Gating below checks Movement_Log's own fetch
  // state accordingly.
  if (movementFetchState === 'loading') { clear('Loading Movement_Log history…'); return; }
  if (movementFetchState === 'error') { clear('Could not load Movement_Log: ' + esc(movementFetchError)); return; }
  if (movementFetchState !== 'ok' || !movementSnapshots.length) {
    clear('No <span class="mono">Movement_Log</span> data yet — see MovementTracker.gs for the one-time setup (open your Sheet → Extensions → Apps Script → paste it in → run <span class="mono">setupMovementTracking()</span> once), or allow ~6–12h after setup for enough captured history to compute a rate against.');
    return;
  }

  const rangeSel = document.getElementById('repeatOffendersRangeSelect');
  const range = rangeSel ? rangeSel.value : 'last7Days';
  const now = (typeof _renderNow !== 'undefined' && _renderNow) ? _renderNow : new Date();
  const dateKeys = repeatOffendersDateKeysForRange(range, now);
  // Movement_Log itself only retains a rolling 7-day window
  // (MOVEMENT_LOG_RETENTION_DAYS, MovementTracker.gs) — Yesterday/This
  // Week/Last 7 Days stay safely inside it, but "From when history began"
  // or a Custom range reaching further back can undercount (a lead
  // closed AND aged out past 7 days is gone from Movement_Log too). Same
  // known limitation totalLeadsByKey already carries — surfaced here via
  // the section's own static filter-summary text (dashboard.html) rather
  // than a dynamic per-range check, to keep this in line with how that
  // existing caveat is already presented.
  const hierarchyMissing = rmHierarchyFetchState !== 'ok';

  const rmFull = computeRmPerformance(dateKeys);
  const regionFull = computeRmPerformance(dateKeys, rec => _repeatOffendersRegionKey(rec));
  const a1tmFull = hierarchyMissing ? [] : computeRmPerformance(dateKeys, rec => primaryManagerForRm(rec.RM));
  const rhFull = hierarchyMissing ? [] : computeRmPerformance(dateKeys, rec => rhForRm(rec.RM));

  if (!rmFull.length) {
    const activeFilters = [];
    if (filterState.project.size) activeFilters.push(`Project (${filterState.project.size})`);
    if (filterState.region.size) activeFilters.push(`Region (${filterState.region.size})`);
    if (filterState.TL.size) activeFilters.push(`TL (${filterState.TL.size})`);
    if (filterState.source.size) activeFilters.push(`Source (${filterState.source.size})`);
    if (filterState.bucket.size) activeFilters.push(`Sub-source (${filterState.bucket.size})`);
    const filterNote = activeFilters.length
      ? `Active filters likely narrowing this to zero: <b>${esc(activeFilters.join(', '))}</b>. Clear them in the filter bar above to check.`
      : 'No Project/Region/TL/Source/Sub-source filters are currently active, so this is NOT a filter issue — no leads in Movement_Log genuinely have SLA-eligible history in this time range (unlikely if the time range is "From when history began").';
    clear(`<b>${esc(movementSnapshots.length)}</b> total Movement_Log snapshot rows loaded; <b>0</b> RMs have SLA-eligible lead-days after the current time range/top-bar filters. ${filterNote}`);
    if (countEl) countEl.textContent = '0';
    return;
  }
  if (noticeEl) noticeEl.style.display = 'none';

  // "Below Expectations only" — per explicit request, every table drops
  // On Track / Watch — concentrated / Insufficient Data entirely, showing
  // only the worst performers to focus on. filterRmPerformanceWorst +
  // sortRmPerformanceByPriority (both core-rm-performance.js) are shared
  // with the PDF export — see their own comments for why.
  const rmWorst = sortRmPerformanceByPriority(filterRmPerformanceWorst(rmFull));
  const regionWorst = sortRmPerformanceByPriority(filterRmPerformanceWorst(regionFull));
  const a1tmWorst = hierarchyMissing ? [] : sortRmPerformanceByPriority(filterRmPerformanceWorst(a1tmFull));
  const rhWorst = hierarchyMissing ? [] : sortRmPerformanceByPriority(filterRmPerformanceWorst(rhFull));

  if (countEl) countEl.textContent = `${rmWorst.length} RM${rmWorst.length === 1 ? '' : 's'} below expectations`;

  // Region needs no hierarchy lookup — it's a field already on every
  // Movement_Log row. Not capped tightly like the RM/A1-TM/RH lists:
  // there are only ~11 canonical regions (REGION_GROUP_MAP, reports.js),
  // so 15 comfortably shows all of them without needing a "show more".
  bodyEl.innerHTML = `<div class="repeat-offenders-grid">
    ${rmPerformanceTableHtml('RMs', rmWorst.slice(0, 20), false)}
    ${rmPerformanceTableHtml('By Region', regionWorst.slice(0, 15), false)}
    ${rmPerformanceTableHtml('A1 / TM', hierarchyMissing ? [] : a1tmWorst.slice(0, 10), hierarchyMissing)}
    ${rmPerformanceTableHtml('RH', hierarchyMissing ? [] : rhWorst.slice(0, 5), hierarchyMissing)}
  </div>`;
}

const RM_PERF_CLASSIFICATION_CHIP_CLASS = {
  'Below Expectations': 'red-chip',
  'Watch — concentrated': 'amber-warn-chip',
  'On Track': 'green-chip',
  'Insufficient Data': 'dim-chip',
};
const RM_PERF_CLASSIFICATION_TITLE = 'Insufficient Data: fewer than 5 distinct eligible leads — too little evidence to judge either way, regardless of how the raw rate looks. On Track: composite score within 25% of the peer average. Watch — concentrated: composite elevated, but driven by one or two chronically-bad leads (a case to check, not a broad pattern). Below Expectations: composite elevated AND spread across the book — a real pattern, not a couple of stuck leads.';

// Same shell every card on this dashboard already uses — header row +
// bounded/scrollable .section-scroll table, so every card in the grid has
// an identical outer shape regardless of row count. Renders
// computeRmPerformance()'s output directly (core-rm-performance.js) —
// see that file's own header comment for the full methodology this
// replaced "Avg Flagged" with, 2026-09-04.
function rmPerformanceTableHtml(title, list, hierarchyMissing){
  const headHtml = `<tr>
      <th></th><th>Name</th>
      <th style="text-align:right" title="Distinct leads eligible for at least one scored SLA rule in the current time range/filters — this group's real workload, not just its flagged leads.">Workload</th>
      <th title="${esc(RM_PERF_CLASSIFICATION_TITLE)}">Status</th>
      <th style="text-align:right" title="Severity-weighted, workload-adjusted composite score across Not Updated / Follow-up Overdue / Behind on Today's Calls / Stuck 48h+ (Inactive-RM Lead Added is tracked separately below, never scored here — it's a routing/assignment issue, not an execution one). Shrunk toward the peer average so a tiny sample can't dominate the ranking. Higher = worse; shown against the peer composite for scale.">Score<br><span class="dim" style="font-weight:400; font-size:9.5px;">(vs peer)</span></th>
      <th>Driven by</th>
    </tr>`;

  let rows;
  if (hierarchyMissing) {
    rows = `<tr><td colspan="6" class="empty-row">RM_Hierarchy could not be read — rollup unavailable. Every other view on this dashboard works fine without it; only this rollup needs it.</td></tr>`;
  } else if (!list.length) {
    rows = `<tr><td colspan="6" class="empty-row">No one classified Below Expectations for the current filters/range — nothing to act on right now.</td></tr>`;
  } else {
    rows = list.map((r, i) => {
      const chipClass = RM_PERF_CLASSIFICATION_CHIP_CLASS[r.classification] || 'dim-chip';
      // rmPerformanceDrivenBy (core-rm-performance.js, shared with the PDF
      // export) already applies the classification gate and the
      // violationDays>0 filter — see its own comment for why shrunkRate>0
      // alone isn't enough (shrinkage gives every rule a small nonzero
      // blended rate toward the peer average even with zero violations).
      const driven = rmPerformanceDrivenBy(r).map(x => {
        const chronicTag = x.concentrated ? ` <span class="dim" style="font-size:10px;">(${x.chronicLeads} chronic)</span>` : '';
        return `<span class="chip ${x.concentrated ? 'amber' : 'red'}" style="margin:0 4px 2px 0;" title="${esc(x.violationDays)} of ${esc(x.eligibleDays)} eligible lead-days, ${esc(x.distinctViolatedLeads)} of ${esc(x.distinctEligibleLeads)} eligible leads affected">${esc(x.label)}: ${(x.rawRate * 100).toFixed(0)}%${chronicTag}</span>`;
      }).join('');
      const routingNote = r.routingIssueDays > 0
        ? `<div class="dim" style="font-size:10px; margin-top:2px;">+${esc(r.routingIssueDays)} Inactive-RM Lead Added day(s) — a routing issue, not scored here</div>` : '';
      return `<tr>
        <td class="num dim">${i + 1}</td>
        <td>${esc(r.name)}</td>
        <td class="num">${esc(r.distinctLeads)}</td>
        <td><span class="chip ${chipClass}">${esc(r.classification)}</span></td>
        <td class="num">${r.composite.toFixed(2)} <span class="dim" style="font-size:10px;">/ ${r.peerComposite.toFixed(2)}</span></td>
        <td>${driven}${routingNote}</td>
      </tr>`;
    }).join('');
  }

  return `<div>
    <div class="repeat-offenders-subtitle">${esc(title)}</div>
    <div class="section-scroll"><table><thead>${headHtml}</thead><tbody>${rows}</tbody></table></div>
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
