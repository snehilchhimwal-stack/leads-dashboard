// ============================================================
// core-filters.js — the filter/render orchestration layer:
// applyFiltersAndRender/_applyFiltersAndRenderImpl (which enrichLead()s
// every visible lead and drives renderAll()), the SLA_History admin
// actions (snapshotSlaHistory/clearSlaHistory) that live right beside it
// in the original file, defaultDateRangeValue, and the filter-bar UI
// builders (buildFilterUI/buildMultiSelect). Split out of core.js
// (Phase 2 — see HANDOVER.md). Pure code motion — no logic changed.
// ============================================================

let _isApplyingFilters = false;

// Morning Brief is deliberately NOT live — it should read as a stable
// checkpoint, not something that silently drifts as someone tweaks filters
// while exploring other tabs. renderAll() only calls renderMorningBrief()
// when this is true, then resets it — set back to true here at the top of
// every real fetchAndRender() (refresh), and directly re-called (bypassing
// this flag/renderAll entirely) from each "Generate" report handler, since
// those don't go through the filter/render pipeline at all.
let _refreshMorningBriefOnNextRender = true;
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
      const created = parseDate(l.lead_assigned_at);
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
  _lastSnapshotByKey = lastSnapshotBefore(_renderNow);
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
  // Just the count — which filters are active and what they're set to is
  // already visible on the filter bar itself (each pill's own count badge,
  // plus the From/To inputs showing their actual values directly), so
  // restating every selected Project/Region/TL/Source/Sub-source value
  // here in prose was pure duplication competing with the KPI strip right
  // below for the same "first thing you read" attention. The shown-vs-total
  // count is the one number that duplication used to carry — kept, in
  // plainer form.
  const shownCollated = countCollatedAmong(leads).collated;
  const totalCollated = countCollatedAmong(allParsedLeads).collated;
  const shownText = shownCollated > 0 ? `${leads.length} (${shownCollated} cloned)` : String(leads.length);
  const totalText = totalCollated > 0 ? `${allParsedLeads.length} (${totalCollated} cloned)` : String(allParsedLeads.length);
  summary.textContent = leads.length === allParsedLeads.length
    ? `Showing all ${totalText} leads`
    : `Showing ${shownText} of ${totalText} leads`;

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

// Wired to #clearSlaHistoryBtn on the Tracking tab (see tab-tracking.js) —
// still directly console-callable too (`await clearSlaHistory()`). Errors
// propagate to the caller rather than being swallowed here: the button
// wiring needs to know whether the write actually succeeded so it can show
// accurate status instead of always reporting success.
async function clearSlaHistory(){
  if (!_currentSheetId) return;
  const sheetId = await getSheetIdByTabName(SLA_HISTORY_TAB_NAME);
  if (sheetId == null) return;
  const existingValues = await sheetsApiValuesGet(_currentSheetId, `${SLA_HISTORY_TAB_NAME}!A2:A`);
  if (!existingValues.length) return;
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

// "Last 7 days" default for the Assigned date filter — the browser's OWN
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
  // Sub-division of whichever source(s) are selected above. Empty selection
  // = all buckets, so the dropdown covers one / several / all without a
  // separate "All" entry.
  buildMultiSelect('msBucket', 'Sub-source', uniqueVals('source_bucket'), countsFor('source_bucket'), filterState.bucket, applyFiltersAndRender);

  // Default the Assigned date range to the last 7 days whenever it isn't
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
