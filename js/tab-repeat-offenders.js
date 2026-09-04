// ============================================================
// tab-repeat-offenders.js — Repeat Offenders section (Operations tab).
// Reads "Movement_Log" (via computeRmPerformance(), core-rm-performance.js)
// to rank RMs/Regions/A1-TM/RH by a workload-normalized "RM Performance"
// methodology — see that file's own header comment for the full
// reconstruction/shrinkage/classification writeup, and HANDOVER.md §9.7
// for the redesign history. Every table shows Below Expectations rows
// only, worst first (filterRmPerformanceWorst/sortRmPerformanceByPriority,
// also core-rm-performance.js).
//
// NOT "Daily_RM_Issues" — that was this section's data source before the
// 2026-09-04 redesign, and fetching it (fetchDailyRmIssues) was removed
// entirely once a full-codebase audit confirmed nothing read it anymore:
// it's a violations-only log with no real eligible-population denominator,
// which is exactly what made the pre-redesign "Avg Flagged" ranking
// unfair to begin with (see HANDOVER.md §9.7's "Why" section). Honoring
// the same top-bar Project/Region/TL/Source/Bucket filters every other
// Movement-backed view does, via passesRepeatOffenderFilters below; the
// top bar's Assigned-date RANGE filter does not apply here — this section
// has its own independent Time range picker instead, matched against each
// lead-day's own Movement_Log OBSERVATION day (see
// core-rm-performance.js's header comment for why).
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

// Guards against stacking more than one pending 1s re-render timer while
// Movement_Log is still loading — see renderRepeatOffenders' own comment
// on why this exists (elapsed-time progress feedback, added 2026-09-05).
let _repeatOffendersLoadingPollScheduled = false;

let rmHierarchyByNameLower = new Map(); // lowercased RM name -> {name, role, tl, tm, rh, ch}
let rmHierarchyFetchState = 'idle';     // 'idle' | 'loading' | 'ok' | 'missing' | 'error'

const RM_HIERARCHY_TAB_NAME = 'RM_Hierarchy';
const RM_HIERARCHY_COLUMNS = ['team', 'role', 'name', 'tl', 'tm', 'rh', 'ch', 'excluded', 'note', 'email'];

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

// The By Region table's own grouping key — mirrors effectiveRegion +
// mainRegionFor (reports.js), the SAME normalization every other
// region-based view on this dashboard uses, so a sub-region variant
// (e.g. "Pune East") correctly rolls up into its canonical main region
// ("Pune") instead of forming its own separate row and silently
// under-counting the main region's true total (real bug, found via a
// user report comparing this table's Pune count against Overview's).
// Movement_Log has group_source (so that half of the Loan override
// applies) but never project_region (not one of SNAPSHOT_COLUMNS_'s
// captured columns) — same gap _effectiveRegionGs_ (MovementTracker.gs)
// already documents for the identical reason. Falls back to the raw
// region for anything mainRegionFor doesn't recognize, rather than
// dropping it silently.
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
  //
  // Added 2026-09-05, after a real root-cause investigation (HANDOVER.md
  // §9.7.2): at current real data volume, Movement_Log's OWN fetch alone
  // measured ~12s live (232k+ rows) — a static, unchanging "Loading…"
  // message for that whole window reads as "stuck", especially since
  // every other tab in this dashboard renders near-instantly by
  // comparison. This self-schedules ONE re-render 1s later, purely to
  // refresh the elapsed-time text — it does NOT re-fetch anything, and
  // the moment movementFetchState stops being 'loading' the chain simply
  // stops rescheduling itself (the next call falls through to a
  // different branch entirely). _repeatOffendersLoadingPollScheduled
  // guards against stacking more than one pending timer if something else
  // also calls renderRepeatOffenders() while one is already pending.
  if (movementFetchState === 'loading') {
    const elapsedSec = (typeof movementFetchStartedAt !== 'undefined' && movementFetchStartedAt)
      ? Math.max(0, Math.round((Date.now() - movementFetchStartedAt.getTime()) / 1000)) : null;
    const elapsedNote = elapsedSec !== null ? ` (${elapsedSec}s elapsed — Movement_Log is large; this can take up to ~15s)` : '';
    clear('Loading Movement_Log history…' + esc(elapsedNote));
    if (!_repeatOffendersLoadingPollScheduled) {
      _repeatOffendersLoadingPollScheduled = true;
      setTimeout(() => { _repeatOffendersLoadingPollScheduled = false; renderRepeatOffenders(); }, 1000);
    }
    return;
  }
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
  // closed AND aged out past 7 days is gone from Movement_Log too) — same
  // 7-day-retention limitation this whole feature already carries (see
  // core-rm-performance.js's own header comment) — surfaced here via
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
// (no re-fetch needed): every range's data is already in movementSnapshots.
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
