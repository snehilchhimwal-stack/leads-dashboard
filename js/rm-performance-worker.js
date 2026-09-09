// ============================================================
// rm-performance-worker.js — dedicated Web Worker running the ENTIRE RM
// Performance calculation (Stages 1-4, plus the RM/Region/A1-TM/RH
// rollups) off the main thread, per explicit request (2026-09-06): "Do
// NOT send the raw data to an LLM simply to perform arithmetic or
// aggregation... use Web Workers/background processing so the UI remains
// responsive."
//
// importScripts() loads the REAL, unmodified production files — not a
// parallel reimplementation. Every one of them was individually confirmed
// DOM/window-free (grepped for document./window. at every level, not just
// assumed) before this worker was written:
//   - core-foundation.js    (CONFIG, istDateKey/istParts/istSameDay/
//                             istWallToInstant, parseDate)
//   - core-lead-model.js    (businessMinutesBetween, canonicalStage,
//                             isOppOrAbove, isLeadClosed, enrichLead,
//                             _renderNow/_todayCallBaselineByKey/
//                             _lastSnapshotByKey module state)
//   - core-outcome-engine.js (parseActionLog, combinedCommentsText,
//                             hasAnyCommentField, hasAnyNarrativeComment)
//   - reports-build.js      (normRegionKey, mainRegionFor, effectiveRegion)
//   - tab-movement.js       (movementSnapshots, buildMovementHistories,
//                             splitHistoryByCopy, enrichSnapshotCached,
//                             enrichLeadAsOf — this file DOES define many
//                             DOM-touching functions too, e.g. renderStalled
//                             Leads, but none of them execute at module-
//                             parse time, only when called, and this worker
//                             never calls those; confirmed zero top-level
//                             document./window. references anywhere in the
//                             file before relying on this)
//   - core-rm-performance.js (the actual Stage 1-4 pipeline, plus
//                             passesRepeatOffenderFilters/
//                             rmPerfPrimaryManagerFor/rmPerfRhFor/
//                             repeatOffendersRegionKey — relocated here
//                             2026-09-06 specifically so this worker could
//                             exist without duplicating their logic)
//
// tab-repeat-offenders.js is DELIBERATELY not imported — it wires its own
// range-select listeners via document.getElementById at its own top
// level, which would throw immediately (`document is not defined`) the
// moment importScripts tried to load it in a Worker. Nothing in it is
// needed here any more; its filter/hierarchy helpers all moved to
// core-rm-performance.js for exactly this reason.
//
// Message contract:
//   IN  (postMessage from tab-repeat-offenders.js):
//     { snapshots: Array, dateKeys: Set<string>|null,
//       filters: {project,region,TL,source,bucket: Set<string>},
//       rmHierarchyByNameLower: Map|null }
//   OUT (postMessage back):
//     { type: 'progress', stage: 'rm'|'region'|'a1tm'|'rh'|'byRegion' } -- 3-5 of these
//     { type: 'done', rm, region, a1tm, rh, byRegion, stageCounts }     -- exactly one
//     { type: 'error', message, stack }                       -- OR this, exactly one
//
// byRegion (added 2026-09-09, "Region wise repeat offender list" —
// ADDITIONAL to rm/region/a1tm/rh above, doesn't replace or resize any of
// them): [{region, list}, ...] from computeRmPerformanceByRegion
// (core-rm-performance.js) — see that function's own header comment for
// the full reasoning. Computed last since it re-runs the RM-keyed
// pipeline once per region internally (small — a handful of regions —
// but the other 4 stages are always cheaper to compute first regardless).
// ============================================================

importScripts(
  'core-foundation.js',
  'core-lead-model.js',
  'core-outcome-engine.js',
  'reports-build.js',
  'tab-movement.js',
  'core-rm-performance.js'
);

function _rmPerfWorkerClassificationCounts(list){
  return list.reduce((acc, r) => { acc[r.classification] = (acc[r.classification] || 0) + 1; return acc; }, {});
}

onmessage = function(e){
  const t0 = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
  try {
    const { snapshots, dateKeys, filters, rmHierarchyByNameLower } = e.data;

    // Worker-local assignment to the SAME `movementSnapshots` global
    // tab-movement.js declares (`let movementSnapshots = []`) — every
    // function importScripts just loaded (buildMovementHistories,
    // reconstructRmPerformanceObservations, etc.) reads this exact
    // identifier. One fresh Worker per Recalculate click (see
    // tab-repeat-offenders.js's runRepeatOffendersRecalculation) means
    // buildMovementHistories'/splitHistoryByCopy's own internal
    // array-identity caches start cold and populate correctly here.
    movementSnapshots = snapshots || [];

    // Stage 1's own filtered-record count, independent of grouping level
    // (the filter predicate doesn't depend on keyFn) — one linear pass,
    // negligible next to the 4 full pipeline runs below.
    const stage1FilteredCount = movementSnapshots.filter(rec => passesRepeatOffenderFilters(rec, filters)).length;

    postMessage({ type: 'progress', stage: 'rm' });
    // Called stage-by-stage (not via computeRmPerformance's one-shot
    // wrapper) specifically so the intermediate observations/byGroup/
    // peer-average objects are available to report back for the
    // validation/debug panel — same 3 real functions computeRmPerformance
    // itself calls, in the same order, nothing reimplemented.
    const rmObservations = reconstructRmPerformanceObservations(dateKeys, undefined, filters, rmHierarchyByNameLower);
    const rmByGroup = aggregateRmPerformance(rmObservations);
    const rmPeerAvg = computeRmPerfPeerAverages(rmByGroup);
    const rm = classifyRmPerformance(rmByGroup);

    postMessage({ type: 'progress', stage: 'region' });
    const region = computeRmPerformance(dateKeys, rec => repeatOffendersRegionKey(rec), filters, rmHierarchyByNameLower);

    let a1tm = [], rh = [];
    if (rmHierarchyByNameLower) {
      postMessage({ type: 'progress', stage: 'a1tm' });
      a1tm = computeRmPerformance(dateKeys, rec => rmPerfPrimaryManagerFor(rec.RM, rmHierarchyByNameLower), filters, rmHierarchyByNameLower);
      postMessage({ type: 'progress', stage: 'rh' });
      rh = computeRmPerformance(dateKeys, rec => rmPerfRhFor(rec.RM, rmHierarchyByNameLower), filters, rmHierarchyByNameLower);
    }

    postMessage({ type: 'progress', stage: 'byRegion' });
    const byRegion = computeRmPerformanceByRegion(dateKeys, filters, rmHierarchyByNameLower);

    const composites = rm.map(r => r.composite);
    const compositeRange = composites.length
      ? { min: Math.min(...composites), max: Math.max(...composites), avg: composites.reduce((a, b) => a + b, 0) / composites.length }
      : null;

    const t1 = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();

    postMessage({
      type: 'done',
      rm, region, a1tm, rh, byRegion,
      stageCounts: {
        sourceRecordCount: movementSnapshots.length,
        stage1FilteredCount: stage1FilteredCount,
        stage2ObservationCount: rmObservations.length,
        stage2Sample: rmObservations.slice(0, 3),
        stage3GroupCount: rmByGroup.size,
        stage4PeerAverages: rmPeerAvg,
        stage6CompositeRange: compositeRange,
        stage7ClassificationCounts: {
          rm: _rmPerfWorkerClassificationCounts(rm),
          region: _rmPerfWorkerClassificationCounts(region),
          a1tm: _rmPerfWorkerClassificationCounts(a1tm),
          rh: _rmPerfWorkerClassificationCounts(rh),
        },
        stage8RollupCounts: { rm: rm.length, region: region.length, a1tm: a1tm.length, rh: rh.length },
        computeMs: t1 - t0,
      },
    });
  } catch (err) {
    postMessage({ type: 'error', message: String((err && err.message) || err), stack: (err && err.stack) || '' });
  }
};
