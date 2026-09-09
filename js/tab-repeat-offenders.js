// ============================================================
// tab-repeat-offenders.js — Repeat Offenders section (Operations tab).
// Reads "Movement_Log" (via computeRmPerformance(), core-rm-performance.js)
// to rank RMs/Regions/A1-TM/RH by a workload-normalized "RM Performance"
// methodology — see that file's own header comment for the full
// reconstruction/shrinkage/classification writeup, and HANDOVER.md §9.7
// for the redesign history. All 4 tables (RM/A1-TM/RH/Region) show the
// worst performers first by raw score, regardless of classification,
// excluding only Insufficient Data (filterRmPerformanceRankable +
// sortRmPerformanceByScore, core-rm-performance.js) — RM capped at 20,
// A1-TM at 10, RH at 5, Region uncapped (all shown) — see
// renderRepeatOffenders' own comment for the full 2026-09-07 rationale.
//
// NOT "Daily_RM_Issues" — that was this section's data source before the
// 2026-09-04 redesign, and fetching it (fetchDailyRmIssues) was removed
// entirely once a full-codebase audit confirmed nothing read it anymore:
// it's a violations-only log with no real eligible-population denominator,
// which is exactly what made the pre-redesign "Avg Flagged" ranking
// unfair to begin with (see HANDOVER.md §9.7's "Why" section). Honoring
// the same top-bar Project/Region/TL/Source/Bucket filters every other
// Movement-backed view does, via passesRepeatOffenderFilters
// (core-rm-performance.js — see captureRepeatOffendersFilterSnapshot
// below for how the live filterState becomes an explicit, frozen
// snapshot before this section ever reads it); the top bar's
// Assigned-date RANGE filter does not apply here — this section has its
// own independent Time range picker instead, matched against each
// lead-day's own Movement_Log OBSERVATION day (see
// core-rm-performance.js's header comment for why).
//
// 2026-09-06: the whole calculation (Stages 1-4, all four RM/Region/
// A1-TM/RH rollups) now runs inside a dedicated Web Worker
// (js/rm-performance-worker.js) instead of synchronously on this thread
// — see runRepeatOffendersRecalculation below. This file itself stays
// main-thread-only (it owns the DOM), but everything it used to compute
// inline now gets posted to the worker and rendered from its response.
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

// primaryManagerForRm/rhForRm/passesRepeatOffenderFilters/
// _repeatOffendersRegionKey all moved to core-rm-performance.js
// (2026-09-06, renamed rmPerfPrimaryManagerFor/rmPerfRhFor/
// repeatOffendersRegionKey, passesRepeatOffenderFilters kept its name) —
// that file is DOM-free and importScripts-able from a Worker; this one
// isn't (see captureRepeatOffendersFilterSnapshot below and this file's
// own header comment). All four are now parameterized (explicit
// filters/rmHierarchyByNameLower snapshot instead of reading the live
// filterState/rmHierarchyByNameLower globals ambiently) — every call
// site in this file passes an explicit snapshot from here on.

// Frozen, explicit snapshot of the live filterState Sets — captured once
// per Recalculate click (or any filter change; every filter control's
// onchange already routes through applyFiltersAndRender → renderAll →
// renderRepeatOffenders, see this file's own header comment) and threaded
// through every computeRmPerformance call below. Fresh Set copies, not
// references to the live Sets — a filter changed by the user AFTER this
// snapshot was taken (e.g. mid-calculation, were this ever made async)
// can never retroactively change what an in-flight calculation sees.
function captureRepeatOffendersFilterSnapshot(){
  return {
    project: new Set(filterState.project),
    region: new Set(filterState.region),
    TL: new Set(filterState.TL),
    source: new Set(filterState.source),
    bucket: new Set(filterState.bucket),
  };
}

// Plain-language summary of an active filter snapshot, for the
// recalculation status strip — "All" per dimension when nothing is
// selected (never restricts a dimension it wasn't asked to), otherwise
// the selected values themselves.
function _repeatOffendersFilterSummaryText(filters){
  const parts = [
    ['Project', filters.project], ['Region', filters.region], ['TL', filters.TL],
    ['Source', filters.source], ['Sub-source', filters.bucket],
  ].map(([label, set]) => `${label}: ${set.size ? Array.from(set).join(', ') : 'All'}`);
  return parts.join(' · ');
}

// null return (allTime) means "no date filter at all".
//
// Yesterday/This Week/Last 7 Days are all anchored at YESTERDAY, never
// `now` itself (fixed 2026-09-07, explicit request: "Today may have
// incomplete data, so do not treat today as a completed reporting day").
// yesterdayMs is the ONE shared anchor every named-range branch below
// builds from, so "what day does Yesterday mean" can never quietly
// drift from "what's the most recent day Last 7 Days/This Week include"
// — REAL BUG this replaced: Last 7 Days previously looped i=0..6 off
// `now` directly, which put TODAY (i=0, possibly still-incomplete data)
// in the set and dropped what should have been its 7th day back. Now
// i=1..7 off yesterdayMs, e.g. "today" Sep 7 -> Aug 31 through Sep 6
// inclusive, matching the exact example in the request.
function repeatOffendersDateKeysForRange(range, now){
  if (range === 'today') return new Set([istDateKey(now)]); // dead from the UI (no "Today" option) — kept only as a defensive fallback, deliberately NOT used by any real range below
  const yesterdayMs = now.getTime() - 86400000;
  if (range === 'yesterday') return new Set([istDateKey(new Date(yesterdayMs))]);
  if (range === 'thisWeek') {
    // Completed days of the CURRENT ISO week (Monday start) up to and
    // including yesterday. If yesterday itself is a Monday (today is
    // Tuesday), this correctly returns just that single day, not any
    // of last week's tail.
    const p = istParts(new Date(yesterdayMs));
    const daysSinceMonday = (p.dow + 6) % 7; // Sunday(0)->6, Monday(1)->0, ...
    const set = new Set();
    for (let i = 0; i <= daysSinceMonday; i++) set.add(istDateKey(new Date(yesterdayMs - i * 86400000)));
    return set;
  }
  if (range === 'last7Days') {
    // The 7 CONSECUTIVE COMPLETED calendar days ending yesterday.
    const set = new Set();
    for (let i = 0; i < 7; i++) set.add(istDateKey(new Date(yesterdayMs - i * 86400000)));
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

// "YYYY-MM-DD" -> "Sep 6, 2026" — the one shared date-formatting
// function for this whole section (live tab AND the PDF export both
// call this, neither has its own copy) — reuses IST_MONTHS
// (reports-build.js) rather than a second hardcoded month-name list.
function repeatOffendersFormatDate(dayKey){
  const parts = dayKey.split('-');
  const y = Number(parts[0]), m = Number(parts[1]), d = Number(parts[2]);
  return IST_MONTHS[m - 1] + ' ' + d + ', ' + y;
}

// The resolved {from, to} calendar-day pair (formatted, human-readable)
// for whichever Set repeatOffendersDateKeysForRange just returned —
// derived from that SAME Set's own min/max day, not a second independent
// date computation, so a displayed range can never disagree with what
// was actually used to filter (explicit 2026-09-07 request: "Use the
// same date calculation logic across filters, tables, PDF downloads...
// avoid duplicating date logic in multiple places"). Returns null for
// allTime (dateKeys === null, no bounded range to show) or an incomplete
// custom range (repeatOffendersDateKeysForRange already returns null for
// that too) — both cases already handled identically upstream.
function repeatOffendersResolvedDateRange(dateKeys){
  if (!dateKeys || !dateKeys.size) return null;
  const sorted = Array.from(dateKeys).sort();
  return { from: sorted[0], to: sorted[sorted.length - 1], fromFormatted: repeatOffendersFormatDate(sorted[0]), toFormatted: repeatOffendersFormatDate(sorted[sorted.length - 1]) };
}

// Requirement (2026-09-07): "For 'Last 7 Days', show the calculated
// range clearly as: From: [start date] To: [yesterday]." Shown for every
// bounded range (Yesterday/This Week/Last 7 Days/Custom), not just Last 7
// Days specifically, since the same clarity is just as useful there — a
// single-day range (Yesterday) collapses to "From: X To: X" rather than
// a special-cased single-date format, deliberately, so the label's shape
// never changes across ranges. Blank for "From when history began"
// (dateKeys null, genuinely unbounded — nothing to show) or an
// incomplete Custom range (also null, both From/To not filled in yet).
function _repeatOffendersUpdateRangeDisplay(dateKeys){
  const el = document.getElementById('repeatOffendersRangeDisplay');
  if (!el) return;
  const resolved = repeatOffendersResolvedDateRange(dateKeys);
  el.textContent = resolved ? `From: ${resolved.fromFormatted}  To: ${resolved.toFormatted}` : '';
}

// One Worker in flight at a time. _repeatOffendersRunId is bumped on
// every call to runRepeatOffendersRecalculation and closed over by that
// call's onmessage handler — a response whose runId no longer matches
// the live counter is from a superseded run and is silently dropped,
// which is what actually prevents an old and new calculation's results
// from ever being mixed together (2026-09-06 requirement). terminate()
// on the old worker is belt-and-suspenders on top of that: it stops a
// slow/hung previous run from continuing to burn CPU in the background,
// but the runId check is what guarantees correctness even if terminate()
// raced a message that was already in flight.
let _repeatOffendersWorker = null;
let _repeatOffendersRunId = 0;

function renderRepeatOffenders(){
  const bodyEl = document.getElementById('repeatOffendersBody');
  const noticeEl = document.getElementById('repeatOffendersNotice');
  const countEl = document.getElementById('repeatOffendersCount');
  const statusEl = document.getElementById('repeatOffendersRecalcStatus');
  if (!bodyEl) return;

  const clear = (message) => {
    bodyEl.innerHTML = '';
    if (countEl) countEl.textContent = '';
    if (noticeEl) { noticeEl.style.display = 'block'; noticeEl.innerHTML = message; }
    if (statusEl) statusEl.innerHTML = '';
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
  _repeatOffendersUpdateRangeDisplay(dateKeys);
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
  // Frozen input snapshot — captured exactly once here, at the top of
  // this render pass, before any async/Worker hand-off. Everything the
  // calculation touches (filters, dateKeys, hierarchy) is now a plain
  // value closed over by this one call, not a live global the worker (or
  // a later filter change on this thread) could see mid-flight.
  const filters = captureRepeatOffendersFilterSnapshot();

  runRepeatOffendersRecalculation({ dateKeys, hierarchyMissing, filters, bodyEl, noticeEl, countEl, statusEl, clear });
}

// Runs the ENTIRE Stage 1-4 + RM/Region/A1-TM/RH pipeline inside a
// dedicated Web Worker (js/rm-performance-worker.js) so a large dataset
// never blocks this tab's UI thread — per explicit 2026-09-06 request.
// No LLM/API call anywhere in this path: it's the exact same
// deterministic functions core-rm-performance.js always ran, just off
// the main thread. Falls back to running them synchronously HERE (same
// functions, same results, only the "does it block the tab" property
// differs) if a Worker can't even be constructed — e.g. a locked-down
// environment, or this file opened directly over file:// during local
// testing rather than served over http(s).
function runRepeatOffendersRecalculation(ctx){
  const { dateKeys, hierarchyMissing, filters, bodyEl, noticeEl, countEl, statusEl, clear } = ctx;
  const runId = ++_repeatOffendersRunId;
  const startedAtWall = new Date();
  const t0 = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();

  if (_repeatOffendersWorker) { _repeatOffendersWorker.terminate(); _repeatOffendersWorker = null; }

  if (noticeEl) { noticeEl.style.display = 'block'; noticeEl.innerHTML = 'Recalculation started…'; }
  if (statusEl) statusEl.innerHTML = _repeatOffendersStatusHtml({ phase: 'started', filters, sourceRecordCount: movementSnapshots.length, startedAtWall });

  const onDone = (msg) => {
    if (runId !== _repeatOffendersRunId) return; // superseded by a newer run — drop, never mix
    const elapsedMs = ((typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now()) - t0;
    _renderRepeatOffendersResult({ bodyEl, noticeEl, countEl, statusEl, filters, hierarchyMissing }, msg, elapsedMs, startedAtWall);
  };
  const onFail = (reason) => {
    if (runId !== _repeatOffendersRunId) return;
    clear('Recalculation failed (' + esc(reason) + ') — falling back to a direct, non-worker calculation.');
    _runRepeatOffendersSynchronously({ dateKeys, hierarchyMissing, filters }, onDone);
  };

  let worker;
  try {
    worker = new Worker('js/rm-performance-worker.js');
  } catch (err) {
    onFail(String((err && err.message) || err));
    return;
  }
  _repeatOffendersWorker = worker;

  worker.onmessage = (e) => {
    if (runId !== _repeatOffendersRunId) return;
    const msg = e.data;
    if (msg.type === 'progress') {
      if (statusEl) statusEl.innerHTML = _repeatOffendersStatusHtml({ phase: 'progress', stage: msg.stage, filters, sourceRecordCount: movementSnapshots.length, startedAtWall });
      return;
    }
    worker.terminate();
    if (_repeatOffendersWorker === worker) _repeatOffendersWorker = null;
    if (msg.type === 'error') { onFail(msg.message); return; }
    onDone(msg);
  };
  worker.onerror = (err) => {
    worker.terminate();
    if (_repeatOffendersWorker === worker) _repeatOffendersWorker = null;
    onFail((err && err.message) || 'worker failed to load');
  };

  worker.postMessage({
    snapshots: movementSnapshots,
    dateKeys: dateKeys,
    filters: filters,
    rmHierarchyByNameLower: hierarchyMissing ? null : rmHierarchyByNameLower,
  });
}

// Same 3 real stage functions the worker calls, run right here instead —
// used only when a Worker genuinely cannot be constructed. Produces the
// exact same `msg` shape onDone expects, so the result renderer can't
// tell (and doesn't need to) which path actually ran.
function _runRepeatOffendersSynchronously(ctx, onDone){
  const { dateKeys, hierarchyMissing, filters } = ctx;
  const t0 = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
  const stage1FilteredCount = movementSnapshots.filter(rec => passesRepeatOffenderFilters(rec, filters)).length;

  const rmObservations = reconstructRmPerformanceObservations(dateKeys, undefined, filters, rmHierarchyByNameLower);
  const rmByGroup = aggregateRmPerformance(rmObservations);
  const rmPeerAvg = computeRmPerfPeerAverages(rmByGroup);
  const rm = classifyRmPerformance(rmByGroup);
  const region = computeRmPerformance(dateKeys, rec => repeatOffendersRegionKey(rec), filters, rmHierarchyByNameLower);
  const a1tm = hierarchyMissing ? [] : computeRmPerformance(dateKeys, rec => rmPerfPrimaryManagerFor(rec.RM, rmHierarchyByNameLower), filters, rmHierarchyByNameLower);
  const rh = hierarchyMissing ? [] : computeRmPerformance(dateKeys, rec => rmPerfRhFor(rec.RM, rmHierarchyByNameLower), filters, rmHierarchyByNameLower);

  const composites = rm.map(r => r.composite);
  const compositeRange = composites.length
    ? { min: Math.min(...composites), max: Math.max(...composites), avg: composites.reduce((a, b) => a + b, 0) / composites.length }
    : null;
  const classCounts = (list) => list.reduce((acc, r) => { acc[r.classification] = (acc[r.classification] || 0) + 1; return acc; }, {});

  onDone({
    rm, region, a1tm, rh,
    stageCounts: {
      sourceRecordCount: movementSnapshots.length,
      stage1FilteredCount: stage1FilteredCount,
      stage2ObservationCount: rmObservations.length,
      stage2Sample: rmObservations.slice(0, 3),
      stage3GroupCount: rmByGroup.size,
      stage4PeerAverages: rmPeerAvg,
      stage6CompositeRange: compositeRange,
      stage7ClassificationCounts: { rm: classCounts(rm), region: classCounts(region), a1tm: classCounts(a1tm), rh: classCounts(rh) },
      stage8RollupCounts: { rm: rm.length, region: region.length, a1tm: a1tm.length, rh: rh.length },
      computeMs: ((typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now()) - t0,
    },
  });
}

// Renders the worker's (or the synchronous fallback's) result — the same
// table-building logic this function always ran, just now fed by a
// message instead of a direct function return.
function _renderRepeatOffendersResult(ctx, msg, elapsedMs, startedAtWall){
  const { bodyEl, noticeEl, countEl, statusEl, filters, hierarchyMissing } = ctx;
  const { rm: rmFull, region: regionFull, a1tm: a1tmFull, rh: rhFull, stageCounts } = msg;

  if (!rmFull.length) {
    const activeFilters = [];
    if (filters.project.size) activeFilters.push(`Project (${filters.project.size})`);
    if (filters.region.size) activeFilters.push(`Region (${filters.region.size})`);
    if (filters.TL.size) activeFilters.push(`TL (${filters.TL.size})`);
    if (filters.source.size) activeFilters.push(`Source (${filters.source.size})`);
    if (filters.bucket.size) activeFilters.push(`Sub-source (${filters.bucket.size})`);
    const filterNote = activeFilters.length
      ? `Active filters likely narrowing this to zero: <b>${esc(activeFilters.join(', '))}</b>. Clear them in the filter bar above to check.`
      : 'No Project/Region/TL/Source/Sub-source filters are currently active, so this is NOT a filter issue — no leads in Movement_Log genuinely have SLA-eligible history in this time range (unlikely if the time range is "From when history began").';
    bodyEl.innerHTML = '';
    if (countEl) countEl.textContent = '0';
    if (noticeEl) { noticeEl.style.display = 'block'; noticeEl.innerHTML = `<b>${esc(stageCounts.sourceRecordCount)}</b> total Movement_Log snapshot rows loaded; <b>0</b> RMs have SLA-eligible lead-days after the current time range/top-bar filters. ${filterNote}`; }
    if (statusEl) statusEl.innerHTML = _repeatOffendersStatusHtml({ phase: 'completed', filters, sourceRecordCount: stageCounts.sourceRecordCount, startedAtWall, elapsedMs });
    return;
  }
  if (noticeEl) noticeEl.style.display = 'none';

  // 2026-09-07 (explicit request, supersedes the 2026-09-04/09-06
  // designs): all 4 tables now show the worst N by score, REGARDLESS of
  // classification, EXCEPT Insufficient Data is never shown in any of
  // them, even to pad out a short list — filterRmPerformanceRankable +
  // sortRmPerformanceByScore (both core-rm-performance.js), shared with
  // the PDF export so the two can't drift. The genuine "N below
  // expectations" COUNT (the badge below) still means what it always
  // did — filterRmPerformanceWorst, strict Below Expectations only — it's
  // only the TABLE CONTENTS that now show more than just that count when
  // there are fewer than N real violations.
  const rmRanked = sortRmPerformanceByScore(filterRmPerformanceRankable(rmFull));
  const a1tmRanked = hierarchyMissing ? [] : sortRmPerformanceByScore(filterRmPerformanceRankable(a1tmFull));
  const rhRanked = hierarchyMissing ? [] : sortRmPerformanceByScore(filterRmPerformanceRankable(rhFull));
  // Region: same rankable filter, but uncapped — "show all" was the
  // explicit 2026-09-06 request, still true here, just now also
  // excluding Insufficient Data rows per the newer request.
  const regionRanked = sortRmPerformanceByScore(filterRmPerformanceRankable(regionFull));

  const rmBelowCount = filterRmPerformanceWorst(rmFull).length;
  if (countEl) countEl.textContent = `${rmBelowCount} RM${rmBelowCount === 1 ? '' : 's'} below expectations`;

  const emptyMsg = 'No RM/region/manager has enough eligible data to rank for the current filters/range.';
  bodyEl.innerHTML = `<div class="repeat-offenders-grid">
    ${rmPerformanceTableHtml('RMs — worst 20', rmRanked.slice(0, 20), false, emptyMsg, rmHierarchyByNameLower)}
    ${rmPerformanceTableHtml('By Region — worst first, all shown', regionRanked, false, emptyMsg, rmHierarchyByNameLower)}
    ${rmPerformanceTableHtml('A1 / TM — worst 10', hierarchyMissing ? [] : a1tmRanked.slice(0, 10), hierarchyMissing, emptyMsg, rmHierarchyByNameLower)}
    ${rmPerformanceTableHtml('RH — worst 5', hierarchyMissing ? [] : rhRanked.slice(0, 5), hierarchyMissing, emptyMsg, rmHierarchyByNameLower)}
  </div>
  ${_repeatOffendersDebugPanelHtml(stageCounts, hierarchyMissing)}`;

  if (statusEl) statusEl.innerHTML = _repeatOffendersStatusHtml({ phase: 'completed', filters, sourceRecordCount: stageCounts.sourceRecordCount, startedAtWall, elapsedMs });
}

// The recalculation status strip — "Recalculation started", active
// filters, source-record count, per-stage progress, and (once done) the
// completion timestamp + time taken. Per explicit request (§11.8): "The
// 'Recalculate' button should... Display the recalculation timestamp and
// active filter set."
const _REPEAT_OFFENDERS_PROGRESS_LABEL = { rm: 'RMs', region: 'Regions', a1tm: 'A1/TM managers', rh: 'RHs' };
function _repeatOffendersStatusHtml(opts){
  const { phase, filters, sourceRecordCount, startedAtWall, elapsedMs, stage } = opts;
  const filterLine = `<div class="dim" style="font-size:11px; margin-top:3px;">Filters — ${esc(_repeatOffendersFilterSummaryText(filters))}</div>`;
  const startedLine = `<div class="dim" style="font-size:10.5px;">Started ${esc(startedAtWall.toLocaleTimeString('en-IN', { hour12: false }))} IST · ${esc(sourceRecordCount)} Movement_Log source records</div>`;
  if (phase === 'started') {
    return `<div><b>Recalculation started…</b></div>${filterLine}${startedLine}`;
  }
  if (phase === 'progress') {
    return `<div><b>Recalculating…</b> computing ${esc(_REPEAT_OFFENDERS_PROGRESS_LABEL[stage] || stage)}</div>${filterLine}${startedLine}`;
  }
  // completed (including the "0 RMs eligible" empty case — still a real completion, not a failure)
  return `<div><b>Recalculation completed</b> — ${(elapsedMs / 1000).toFixed(2)}s</div>${filterLine}${startedLine}`;
}

// Validation/debug panel (§9) — collapsed by default (this is diagnostic
// detail, not something every viewer needs open), exposing real counts
// from every stage of the run that just completed, plus how each
// rollup's peer baseline is actually computed — so "is Region really
// independent of RM" is answered by what's on screen, not by trusting a
// comment in the source.
function _repeatOffendersDebugPanelHtml(sc, hierarchyMissing){
  const peerRows = Object.entries(sc.stage4PeerAverages || {})
    .map(([k, v]) => `<tr><td>${esc(k)}</td><td class="num">${(v * 100).toFixed(2)}%</td></tr>`).join('');
  const sampleRows = (sc.stage2Sample || [])
    .map(o => `<tr><td>${esc(o.name)}</td><td>${esc(o.lead_id)}</td><td>${esc(o.dayKey)}</td><td>${esc(o.rule)}</td><td>${o.violated ? 'yes' : 'no'}</td></tr>`).join('');
  const classRow = (label, counts) => `<tr><td>${esc(label)}</td><td class="num">${esc(counts['Below Expectations'] || 0)}</td><td class="num">${esc(counts['Watch — concentrated'] || 0)}</td><td class="num">${esc(counts['On Track'] || 0)}</td><td class="num">${esc(counts['Insufficient Data'] || 0)}</td></tr>`;
  const cr = sc.stage6CompositeRange;

  return `<details style="margin-top:16px;">
    <summary style="cursor:pointer; font-size:12.5px; color:var(--text-faint);">Validation / debug — calculation stages</summary>
    <div style="margin-top:10px; display:grid; gap:14px;">
      <div>
        <div class="repeat-offenders-subtitle">Stage 1 — filtered source records</div>
        <div class="dim" style="font-size:12px;">${esc(sc.sourceRecordCount)} Movement_Log snapshot rows in scope → ${esc(sc.stage1FilteredCount)} pass the active Project/Region/TL/Source/Sub-source filters (before any date/eligibility check).</div>
      </div>
      <div>
        <div class="repeat-offenders-subtitle">Stage 2 — eligible lead/day/rule observations (RM level)</div>
        <div class="dim" style="font-size:12px; margin-bottom:4px;">${esc(sc.stage2ObservationCount)} observations reconstructed. Sample:</div>
        <div class="section-scroll"><table><thead><tr><th>RM</th><th>Lead</th><th>Day</th><th>Rule</th><th>Violated</th></tr></thead><tbody>${sampleRows || '<tr><td colspan="5" class="empty-row">No observations.</td></tr>'}</tbody></table></div>
      </div>
      <div>
        <div class="repeat-offenders-subtitle">Stage 3 — RM aggregation</div>
        <div class="dim" style="font-size:12px;">${esc(sc.stage3GroupCount)} distinct RMs with at least one eligible observation.</div>
      </div>
      <div>
        <div class="repeat-offenders-subtitle">Stage 4 — filtered peer averages (RM level, this filtered population only)</div>
        <div class="section-scroll"><table><thead><tr><th>Rule</th><th style="text-align:right">Peer rate</th></tr></thead><tbody>${peerRows}</tbody></table></div>
      </div>
      <div>
        <div class="repeat-offenders-subtitle">Stage 5 — empirical-Bayes shrinkage</div>
        <div class="dim" style="font-size:12px;">shrunkRate = n/(n+8) × rawRate + 8/(n+8) × peerRate, applied per RM per rule using the Stage 4 peer rates above — the RM table's Score column is exactly this, weighted and summed across the 4 scored rules.</div>
      </div>
      <div>
        <div class="repeat-offenders-subtitle">Stage 6 — composite scores</div>
        <div class="dim" style="font-size:12px;">${cr ? `min ${cr.min.toFixed(2)} · avg ${cr.avg.toFixed(2)} · max ${cr.max.toFixed(2)}, across ${esc(sc.stage3GroupCount)} RMs. Threshold = peer composite × 1.25 (not hard-coded — recomputed from Stage 4's filtered peer averages every run).` : 'No RMs to score.'}</div>
      </div>
      <div>
        <div class="repeat-offenders-subtitle">Stage 7 — classification breakdown</div>
        <div class="section-scroll"><table><thead><tr><th>Level</th><th class="num">Below Exp.</th><th class="num">Watch</th><th class="num">On Track</th><th class="num">Insuff. Data</th></tr></thead><tbody>
          ${classRow('RM', sc.stage7ClassificationCounts.rm)}
          ${classRow('Region', sc.stage7ClassificationCounts.region)}
          ${hierarchyMissing ? '' : classRow('A1/TM', sc.stage7ClassificationCounts.a1tm)}
          ${hierarchyMissing ? '' : classRow('RH', sc.stage7ClassificationCounts.rh)}
        </tbody></table></div>
      </div>
      <div>
        <div class="repeat-offenders-subtitle">Stage 8 — rollup calculation method</div>
        <div class="dim" style="font-size:12px; line-height:1.6;">
          <b>RM</b>: own independent peer population &amp; empirical-Bayes baseline (peer = every OTHER RM in the filtered population) — ${esc(sc.stage8RollupCounts.rm)} RMs scored.<br>
          <b>Region</b>: own independent peer population &amp; baseline (peer = every OTHER region) — NOT rolled up from RM scores — ${esc(sc.stage8RollupCounts.region)} regions scored, all shown.<br>
          <b>A1/TM</b>: own independent peer population &amp; baseline (peer = every OTHER A1/TM) — ${hierarchyMissing ? 'unavailable (RM_Hierarchy not loaded)' : esc(sc.stage8RollupCounts.a1tm) + ' managers scored'}.<br>
          <b>RH</b>: own independent peer population &amp; baseline (peer = every OTHER RH) — ${hierarchyMissing ? 'unavailable (RM_Hierarchy not loaded)' : esc(sc.stage8RollupCounts.rh) + ' RHs scored'}.<br>
          All four re-run Stage 1-4 from scratch with their own grouping key — none is derived by averaging another level's already-computed scores.
        </div>
      </div>
      <div class="dim" style="font-size:11px;">Worker compute time: ${sc.computeMs.toFixed(1)}ms (Stage 1-4 + all rollups, excludes structured-clone/message-passing overhead).</div>
    </div>
  </details>`;
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
//
// 2026-09-07 (explicit request): the "Driven by" column is gone from
// every table. In its place: Instances (totalInstances — total violation-
// day count across the 4 scored rules, the Movement_Log-based equivalent
// of what Daily_RM_Issues used to count, without that log's missing-
// denominator problem) and 4 hierarchy columns — Region / RMs / A1-TM /
// RH (rmPerformanceHierarchyCells, core-rm-performance.js) — so every row,
// at any rollup level, shows exactly which part of the org it belongs to,
// not just a name and a score. `rmHierarchyByNameLower` (may be null) is
// now a required param, needed for the A1-TM/RH hierarchy cells even on
// tables that aren't themselves the A1-TM/RH rollup.
function rmPerformanceTableHtml(title, list, hierarchyMissing, emptyMessage, rmHierarchyByNameLower){
  const headHtml = `<tr>
      <th></th><th>Name</th>
      <th style="text-align:right" title="Exact count of distinct leads eligible for at least one scored SLA rule in the current time range/filters — this group's real book, not just its flagged leads.">Unique Leads</th>
      <th title="${esc(RM_PERF_CLASSIFICATION_TITLE)}">Status</th>
      <th style="text-align:right" title="Severity-weighted, workload-adjusted composite score across Not Updated / Follow-up Overdue / Behind on Today's Calls / Stuck 48h+ (Inactive-RM Lead Added is tracked separately, never scored here — it's a routing/assignment issue, not an execution one). Shrunk toward the peer average so a tiny sample can't dominate the ranking. Higher = worse; shown against the peer composite for scale.">Score<br><span class="dim" style="font-weight:400; font-size:9.5px;">(vs peer)</span></th>
      <th style="text-align:right" title="Total violation-day INSTANCES across the 4 scored rules (Not Updated / Follow-up Overdue / Behind on Today's Calls / Stuck 48h+) — e.g. one lead flagged Not Updated on 3 different days counts as 3 instances. Movement_Log-based, the same real eligible-population methodology as the Score column, not the old Daily_RM_Issues violations-only log.">Instances</th>
      <th title="The region this row's eligible leads are actually concentrated in most.">Region</th>
      <th title="The RM(s) behind this row — the RM's own name for an RM row; a count for a Region/A1-TM/RH row that spans more than one.">RMs</th>
      <th title="The A1/TM manager(s) behind this row — a name when unambiguous, a count when this row spans more than one manager. — when RM_Hierarchy isn't loaded.">A1/TM</th>
      <th title="The RH(s) behind this row — a name when unambiguous, a count when this row spans more than one. — when RM_Hierarchy isn't loaded.">RH</th>
    </tr>`;

  let rows;
  if (hierarchyMissing) {
    rows = `<tr><td colspan="10" class="empty-row">RM_Hierarchy could not be read — rollup unavailable. Every other view on this dashboard works fine without it; only this rollup needs it.</td></tr>`;
  } else if (!list.length) {
    rows = `<tr><td colspan="10" class="empty-row">${esc(emptyMessage || 'No one has enough eligible data to rank for the current filters/range.')}</td></tr>`;
  } else {
    rows = list.map((r, i) => {
      const chipClass = RM_PERF_CLASSIFICATION_CHIP_CLASS[r.classification] || 'dim-chip';
      const routingNote = r.routingIssueDays > 0
        ? `<div class="dim" style="font-size:10px; margin-top:2px;">+${esc(r.routingIssueDays)} Inactive-RM Lead Added day(s) — a routing issue, not scored here</div>` : '';
      const hc = rmPerformanceHierarchyCells(r, rmHierarchyByNameLower);
      return `<tr>
        <td class="num dim">${i + 1}</td>
        <td>${esc(r.name)}${routingNote}</td>
        <td class="num">${esc(r.distinctLeads)}</td>
        <td><span class="chip ${chipClass}">${esc(r.classification)}</span></td>
        <td class="num">${r.composite.toFixed(2)} <span class="dim" style="font-size:10px;">/ ${r.peerComposite.toFixed(2)}</span></td>
        <td class="num">${esc(r.totalInstances)}</td>
        <td>${esc(hc.region)}</td>
        <td>${esc(hc.rms)}</td>
        <td>${esc(hc.a1tm)}</td>
        <td>${esc(hc.rh)}</td>
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

// The "Recalculate" button, moved here from the shared top filter bar
// 2026-09-07 (explicit request — it's specific to this report, not a
// whole-dashboard action, so living inside #tab-repeatoffenders means it
// naturally shows/hides with the tab itself via the existing
// .tab-panel.active CSS toggle, no extra show/hide JS needed). Scoped to
// just this report's own re-render (renderRepeatOffenders), not the full
// applyFiltersAndRender() the old shared button used to call — every
// OTHER tab already re-renders near-instantly on its own whenever a
// filter actually changes, so recalculating them here too would just be
// wasted work for a button whose whole point is now "re-run the slow
// one". _renderNow is refreshed first so Yesterday/This Week/Last 7 Days
// re-anchor to the ACTUAL current moment on every click, not whatever
// stale timestamp the last full page load or filter change happened to
// set — the same freshness a real applyFiltersAndRender() pass would
// have given this section for free.
const _repeatOffendersRecalculateBtnEl = document.getElementById('repeatOffendersRecalculateBtn');
if (_repeatOffendersRecalculateBtnEl) {
  _repeatOffendersRecalculateBtnEl.addEventListener('click', function(){
    _renderNow = new Date();
    renderRepeatOffenders();
  });
}
