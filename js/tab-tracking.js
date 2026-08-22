// ============================================================
// tab-tracking.js — Tracking tab (issue-count-over-time chart,
// cohort comparison). Depends on core.js (loaded first).
// ============================================================

// Short column headers / legend captions — ISSUE_PRIORITY's labels are full
// sentences (right for an email/legend title, too wide for a chart legend
// or axis tick). Falls back to the full label for anything not listed here.
const TRACKING_SHORT_LABEL = {
  inactiveRmNewLead: 'Inactive RM',
  isNotUpdated: 'Not Updated',
  followupOverdue: 'Follow-up Overdue',
  underCalledToday: 'Behind on Calls',
  stageStuck48h: 'Stuck 48h+',
};

// One tally per distinct Movement_Log snapshot run, across the WHOLE
// captured history (not just the picked From/To pair) — a single pass over
// movementSnapshots rather than calling a per-run tally function once per
// run, which would be O(runs × rows) instead of O(rows). Replays the same
// enrichLead() logic every other issue check in this file uses (via
// enrichSnapshotCached, which pins _renderNow to the snapshot's own
// instant), grouped with mainRegionFor(effectiveRegion()) — the SAME logic
// the region emails use, so a count here lines up with what an email at
// that same moment would have shown. `regionFilter` is '__all__' or one
// main region string; passesMovementFilters still applies the top filter
// bar's Project/TL/Source/Sub-source/date-range — this layers its own
// region grouping on top of that, it doesn't replace it. Returns runs
// sorted oldest to newest; a run with zero matching open leads for the
// current region/filters is simply absent (not a zero-value entry).
function computeIssueTalliesByRun(regionFilter){
  // Grouped first by run, then by CUSTOMER within that run (client_id,
  // falling back to lead_id — same identity movementSnapshots' own
  // client_id field and buildMovementHistories use) — a customer held by
  // 2 RMs at once is 2 rows in movementSnapshots for the same instant, and
  // counting both straight would double them into totalAll/openTotal/
  // breachedTotal. A customer counts as open if ANY of their copies is
  // open, and flagged for a check if ANY copy is flagged for it — each
  // copy is still judged on its own issue data (nothing here merges the
  // underlying records), this only decides how many DISTINCT customers
  // that adds up to.
  const byRunCustomers = new Map(); // atMs -> Map(customerKey -> {at, isOpenLead, flags})
  movementSnapshots.forEach(rec => {
    if (!passesMovementFilters(rec)) return;
    if (regionFilter !== '__all__' && mainRegionFor(effectiveRegion(rec)) !== regionFilter) return;

    const atMs = rec.snapshot_at.getTime();
    let customers = byRunCustomers.get(atMs);
    if (!customers) { customers = new Map(); byRunCustomers.set(atMs, customers); }
    const key = String(rec.client_id || '').trim() || 'l:' + String(rec.lead_id).trim();
    let cust = customers.get(key);
    if (!cust) { cust = { at: rec.snapshot_at, isOpenLead: false, flags: {} }; customers.set(key, cust); }

    const enriched = enrichSnapshotCached(rec);
    if (enriched.isOpenLead) cust.isOpenLead = true;
    ISSUE_PRIORITY.forEach(rule => { if (enriched[rule.key]) cust.flags[rule.key] = true; });
  });

  const byRun = new Map(); // at(ms) -> tally
  byRunCustomers.forEach((customers, atMs) => {
    // totalAll counts every matching customer in this run regardless of
    // stage — "how many Google leads were in the system that day" — so a
    // run with only closed leads for this region/filter still gets a
    // tally entry instead of silently vanishing from the chart.
    const tally = { at: null, totalAll: 0, openTotal: 0, breachedTotal: 0, byCheck: {} };
    ISSUE_PRIORITY.forEach(rule => { tally.byCheck[rule.key] = 0; });
    customers.forEach(cust => {
      tally.at = cust.at;
      tally.totalAll++;
      if (!cust.isOpenLead) return;
      tally.openTotal++;
      let breached = false;
      ISSUE_PRIORITY.forEach(rule => {
        if (cust.flags[rule.key]) { tally.byCheck[rule.key]++; breached = true; }
      });
      if (breached) tally.breachedTotal++;
    });
    byRun.set(atMs, tally);
  });
  return Array.from(byRun.values()).sort((a, b) => a.at - b.at);
}

// Nearest thing to "the tally at exactly this instant" — used for the
// summary table under the chart, which reads the two runs the From/To
// pickers point at. A zero-tally fallback covers the (rare) case where
// this region had no matching leads at that exact run — a legitimate
// zero, not a lookup failure, since fromAt/toAt come from the picker built
// off ALL regions combined.
function findRunTally(runs, at){
  const found = runs.find(r => r.at.getTime() === at.getTime());
  if (found) return found;
  const empty = { at, totalAll: 0, openTotal: 0, breachedTotal: 0, byCheck: {} };
  ISSUE_PRIORITY.forEach(rule => { empty.byCheck[rule.key] = 0; });
  return empty;
}

// Companion to computeIssueTalliesByRun/findRunTally above, answering a
// different question: those two compare raw totals at From and To
// independently, which drift apart as new leads keep getting added between
// the two snapshots — a flat or rising count there doesn't distinguish
// "nothing got worked on" from "new volume offset real progress." This
// instead matches leads by lead_id present at BOTH From and To (a
// brand-new lead that didn't exist yet at From is excluded entirely, same
// principle computeMovementRows already uses for Stalled Leads), then asks
// of that fixed cohort: how many flagged for each issue at From are STILL
// flagged for that SAME issue at To?
function computeCohortComparison(regionFilter, fromAt, toAt){
  const fromMs = fromAt.getTime(), toMs = toAt.getTime();
  // Keyed by CUSTOMER (client_id, falling back to lead_id), not by the
  // per-copy lead_id — a customer held by 2 RMs shows up as 2
  // movementSnapshots rows at the same instant, and matching by lead_id
  // let both into the cohort as separate entries, double-counting one
  // customer's issue toward flaggedAtFrom/stillFlaggedAtTo. A customer
  // counts as flagged at a side if ANY of their copies is flagged there,
  // and "still flagged" if ANY copy is still flagged at To — the copies
  // themselves stay judged independently elsewhere, this only decides how
  // many distinct customers the fixed cohort adds up to.
  const byCustomer = new Map(); // customerKey -> {fromSeen, toSeen, fromFlags, toFlags}
  movementSnapshots.forEach(rec => {
    const atMs = rec.snapshot_at.getTime();
    if (atMs !== fromMs && atMs !== toMs) return;
    if (!passesMovementFilters(rec)) return;
    if (regionFilter !== '__all__' && mainRegionFor(effectiveRegion(rec)) !== regionFilter) return;
    const leadId = String(rec.lead_id || '').trim();
    if (!leadId) return;
    const key = String(rec.client_id || '').trim() || 'l:' + leadId;
    if (!byCustomer.has(key)) byCustomer.set(key, { fromSeen: false, toSeen: false, fromFlags: {}, toFlags: {} });
    const entry = byCustomer.get(key);
    const enriched = enrichSnapshotCached(rec);
    if (atMs === fromMs) {
      entry.fromSeen = true;
      ISSUE_PRIORITY.forEach(rule => { if (enriched[rule.key]) entry.fromFlags[rule.key] = true; });
    } else {
      entry.toSeen = true;
      ISSUE_PRIORITY.forEach(rule => { if (enriched[rule.key]) entry.toFlags[rule.key] = true; });
    }
  });

  const checkKeys = ISSUE_PRIORITY.map(rule => rule.key);
  const byCheck = {};
  checkKeys.forEach(k => { byCheck[k] = { flaggedAtFrom: 0, stillFlaggedAtTo: 0 }; });
  let matchedCount = 0, breachedAtFromCount = 0, stillBreachedCount = 0;

  byCustomer.forEach(entry => {
    if (!entry.fromSeen || !entry.toSeen) return; // present at only one side — not part of this fixed cohort
    matchedCount++;
    let breachedAtFrom = false, stillBreached = false;
    checkKeys.forEach(k => {
      if (!entry.fromFlags[k]) return;
      byCheck[k].flaggedAtFrom++;
      breachedAtFrom = true;
      if (entry.toFlags[k]) { byCheck[k].stillFlaggedAtTo++; stillBreached = true; }
    });
    if (breachedAtFrom) breachedAtFromCount++;
    if (breachedAtFrom && stillBreached) stillBreachedCount++;
  });

  return { matchedCount, breachedAtFromCount, stillBreachedCount, byCheck };
}

// One point per IST calendar day for the chart's main connected line — a
// day with several captures (the every-6-hours trigger, plus any manual
// Snapshot now clicks) used to plot every single one, making the line as
// dense and noisy as the capture cadence rather than showing the day-over-
// day shape. Picks each day's LATEST run as that day's representative
// (the most complete/final count for the day), same convention as a
// candlestick chart's daily close. Returns { daily, scatter } — scatter is
// every OTHER run that day, kept for the background-only dots in
// buildTrackingChartSvg so nothing captured is actually hidden, it's just
// not part of the connected trend.
function splitDailyAndScatter(runs){
  const byDay = new Map(); // dayKey -> run
  runs.forEach(r => {
    const key = istDateKey(r.at);
    const existing = byDay.get(key);
    if (!existing || r.at.getTime() > existing.at.getTime()) byDay.set(key, r);
  });
  const daily = Array.from(byDay.values()).sort((a, b) => a.at - b.at);
  const dailyAtSet = new Set(daily.map(r => r.at.getTime()));
  const scatter = runs.filter(r => !dailyAtSet.has(r.at.getTime()));
  return { daily, scatter };
}

// Builds the Region Issue Trend chart as an SVG string, as TWO stacked
// panels sharing one X (time) axis rather than one chart with two Y scales
// — total lead volume runs in the thousands while issue counts run in the
// tens/hundreds, so one shared axis would flatten every issue line to
// noise near the bottom. Scoped to ONLY the picked From→To window — an
// earlier version also drew the rest of the captured history dimmed in the
// background, which was dropped per feedback in favor of a chart that just
// shows the selected range. The connected line/dots still plot one point
// per calendar day within that range (see splitDailyAndScatter); every
// OTHER same-day capture (the 6-hourly trigger plus any manual Snapshot
// now clicks) still renders as a small, always-dim, unconnected dot, so
// nothing captured in the window is hidden, it's just not part of the
// daily trend line. Both the line and every dot carry a hover title naming
// the series, so hovering anywhere on a line (not just a dot) says which
// issue it is.
function buildTrackingChartSvg(allRuns, fromAt, toAt){
  const W = 900;
  const marginL = 46, marginR = 14, marginT = 16, marginB = 28, panelGap = 18;
  const topPanelH = 66, bottomPanelH = 210;
  const topY0 = marginT, topY1 = marginT + topPanelH;
  const bottomY0 = topY1 + panelGap, bottomY1 = bottomY0 + bottomPanelH;
  const H = bottomY1 + marginB;
  const plotW = W - marginL - marginR;

  const fromMs = fromAt.getTime(), toMs = toAt.getTime();
  const runs = allRuns.filter(r => r.at.getTime() >= fromMs && r.at.getTime() <= toMs);
  const { daily, scatter } = splitDailyAndScatter(runs);

  const span = Math.max(1, toMs - fromMs);
  const scaleX = (t) => marginL + ((t - fromMs) / span) * plotW;
  const points = daily.map(r => ({ at: r.at, x: scaleX(r.at.getTime()) }));
  const scatterPoints = scatter.map(r => ({ at: r.at, x: scaleX(r.at.getTime()) }));
  const drawScatterDots = scatter.length <= 800; // caps DOM size — intraday captures can outnumber days by a lot

  // Draws one series against a given panel's own y0/y1/maxVal — shared by
  // both panels below so the two don't duplicate this logic with two
  // different scales. `s.get(run)` reads this series' value off a run
  // object (works for both a daily and a scatter run, same shape).
  //
  // Hover used to be native SVG <title> elements on each dot/line — slow to
  // appear, styled by the OS not the page, and unusable on touch. Real hit
  // targets (invisible, generously-sized circles carrying a data-tt
  // attribute) are collected into `hitCircles` and painted LAST, on top of
  // every series, so a real floating tooltip (see chartHoverTip below) can
  // find them via one delegated listener — same computed point data as
  // before, just a real panel instead of a UA tooltip.
  function drawSeries(s, y0, y1, maxVal){
    const scaleY = (v) => y0 + (y1 - y0) - (v / maxVal) * (y1 - y0);
    const pts = daily.map((r, i) => ({ x: points[i].x, y: scaleY(s.get(r)), at: r.at, v: s.get(r) }));
    let out = '';

    // Every non-daily-representative capture in the window — small, always
    // dim, never connected — "in the background" behind the daily trend.
    if (drawScatterDots) {
      scatter.forEach((r, i) => {
        const v = s.get(r);
        const y = scaleY(v);
        out += `<circle cx="${scatterPoints[i].x.toFixed(1)}" cy="${y.toFixed(1)}" r="${Math.max(1, s.dot - 2)}" fill="${s.color}" opacity="0.28"></circle>`;
        hitCircles += `<circle cx="${scatterPoints[i].x.toFixed(1)}" cy="${y.toFixed(1)}" r="7" fill="transparent" data-tt="${esc(s.label)} — ${esc(istDayLabelWithDow(r.at))} ${esc(istTimeLabel(r.at))}: ${v}"></circle>`;
      });
    }

    if (pts.length >= 2) {
      const poly = pts.map(p => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
      out += `<polyline points="${poly}" fill="none" stroke="${s.color}" stroke-width="${s.width}" stroke-linecap="round" stroke-linejoin="round"></polyline>`;
    }
    pts.forEach(p => {
      out += `<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="${s.dot}" fill="${s.color}"></circle>`;
      // A larger invisible hit circle on top of the small visible dot —
      // easier to hover precisely, and its radius covers most of the gap
      // to a neighboring point along the line too (the original reason the
      // polyline itself carried a <title>).
      hitCircles += `<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="9" fill="transparent" data-tt="${esc(s.label)} — ${esc(istDayLabelWithDow(p.at))} ${esc(istTimeLabel(p.at))}: ${p.v}"></circle>`;
    });
    return out;
  }
  let hitCircles = '';

  function gridFor(y0, y1, maxVal, steps){
    let out = '';
    for (let i = 0; i <= steps; i++) {
      const v = Math.round((maxVal / steps) * i);
      const y = y0 + (y1 - y0) - (v / maxVal) * (y1 - y0);
      out += `<line x1="${marginL}" y1="${y.toFixed(1)}" x2="${W - marginR}" y2="${y.toFixed(1)}" stroke="var(--border)" stroke-width="1" />`;
      out += `<text x="${marginL - 8}" y="${(y + 3.5).toFixed(1)}" text-anchor="end" font-size="10" fill="var(--text-faint)">${v}</text>`;
    }
    return out;
  }

  // Top panel: total Google leads in the system at each snapshot — every
  // matching lead regardless of stage (see computeIssueTalliesByRun's
  // totalAll), drawn bright green so it reads as the headline volume figure
  // rather than one more issue color. Y-axis max is taken over ALL runs
  // (daily + scatter), not just the daily ones, so a scatter dot never
  // clips off the top of its own panel.
  const totalLeadsSeries = {
    key: '__totalLeads__', label: 'Total Leads in System', color: 'var(--green)', width: 2.5, dot: 3.5,
    get: (r) => r.totalAll,
  };
  const topMax = Math.ceil(Math.max(1, ...runs.map(r => r.totalAll)) * 1.15) || 1;
  const topGridSvg = gridFor(topY0, topY1, topMax, 2);
  const topLabelSvg = `<text x="${marginL}" y="${topY0 - 5}" font-size="10" fill="var(--text-dim)">Total Leads in System</text>`;
  const topLinesSvg = drawSeries(totalLeadsSeries, topY0, topY1, topMax);

  // Bottom panel: the five issue checks plus Total Breaching, unchanged
  // from before — its own scale so it isn't flattened by lead-volume magnitude.
  let bottomMax = 1;
  runs.forEach(r => {
    bottomMax = Math.max(bottomMax, r.breachedTotal, ...ISSUE_PRIORITY.map(c => r.byCheck[c.key] || 0));
  });
  bottomMax = Math.ceil(bottomMax * 1.15) || 1;
  const issueSeries = ISSUE_PRIORITY.map(c => ({
    key: c.key, label: TRACKING_SHORT_LABEL[c.key] || c.label,
    color: colorForIssue(c.label, 0), width: 1.75, dot: 3,
    get: (r) => r.byCheck[c.key] || 0,
  }));
  issueSeries.push({
    key: '__total__', label: 'Total Breaching', color: 'var(--text)', width: 2.75, dot: 4,
    get: (r) => r.breachedTotal,
  });
  const bottomGridSvg = gridFor(bottomY0, bottomY1, bottomMax, 4);
  const bottomLinesSvg = issueSeries.map(s => drawSeries(s, bottomY0, bottomY1, bottomMax)).join('');

  // X-axis date ticks under the bottom panel only — the top panel shares
  // the same X positions, so repeating them would just be visual noise.
  // Each label carries the weekday too (istDayLabelWithDow), not just the
  // date, since a plain date number doesn't say whether that day was a
  // weekday or weekend.
  const tickStep = Math.max(1, Math.ceil(points.length / 7));
  let axisSvg = '';
  for (let i = 0; i < points.length; i += tickStep) {
    axisSvg += `<text x="${points[i].x.toFixed(1)}" y="${H - 8}" text-anchor="middle" font-size="10" fill="var(--text-faint)">${esc(istDayLabelWithDow(points[i].at))}</text>`;
  }
  const last = points[points.length - 1];
  if (points.length && (points.length - 1) % tickStep !== 0) {
    axisSvg += `<text x="${last.x.toFixed(1)}" y="${H - 8}" text-anchor="middle" font-size="10" fill="var(--text-faint)">${esc(istDayLabelWithDow(last.at))}</text>`;
  }

  // Reuses the Movement tab's own breakdown-card legend classes rather than
  // introducing new ones — same dot-plus-label look throughout the file.
  const allSeries = [totalLeadsSeries, ...issueSeries];
  const legendSvg = `<div class="stall-legend" style="margin-top:8px;">` + allSeries.map(s =>
    `<span class="stall-legend-item"><span class="stall-legend-dot" style="background:${s.color}; border-radius:50%;"></span>${esc(s.label)}</span>`
  ).join('') + `</div>`;

  return `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" style="width:100%; height:${H}px; display:block;" class="chart-hover-target">` +
    topGridSvg + bottomGridSvg + topLinesSvg + bottomLinesSvg + axisSvg + topLabelSvg + hitCircles +
    `</svg>` + legendSvg;
}

// Real floating tooltip for the [data-tt] hit circles buildTrackingChartSvg
// paints above — one shared tooltip element and one delegated listener for
// every chart on the page (Tracking's own chart and RM Timeline's issue
// history chart both call buildTrackingChartSvg), rather than wiring a
// listener per chart instance re-rendered on every filter change.
let _chartHoverTipEl = null;
function _ensureChartHoverTip(){
  if (_chartHoverTipEl) return _chartHoverTipEl;
  const el = document.createElement('div');
  el.className = 'chart-hover-tip';
  document.body.appendChild(el);
  _chartHoverTipEl = el;
  return el;
}
document.addEventListener('mousemove', (e) => {
  const hit = e.target.closest && e.target.closest('[data-tt]');
  const tip = _ensureChartHoverTip();
  if (!hit) { tip.classList.remove('visible'); return; }
  tip.textContent = hit.getAttribute('data-tt');
  tip.style.left = e.clientX + 'px';
  tip.style.top = (e.clientY - 10) + 'px';
  tip.classList.add('visible');
});
document.addEventListener('mouseout', (e) => {
  if (e.target.closest && e.target.closest('[data-tt]') && !e.relatedTarget) {
    _ensureChartHoverTip().classList.remove('visible');
  }
});

// Own copy of populateMovementSnapshotSelectors' From/To defaulting logic
// (second-most-recent run / most-recent run), kept as a separate function
// rather than sharing IDs with the Movement tab's picker — that one is
// deliberately a short, recent pair for Stalled Leads; this one is meant for
// picking two points that could be weeks apart (e.g. "when I sent Tuesday's
// email" vs "now").
function trackingPopulateSnapshotSelectors(){
  const fromDateSel = document.getElementById('trackingFromDateSelect');
  const toDateSel = document.getElementById('trackingToDateSelect');
  if (!fromDateSel || !toDateSel) return;

  populateMovementDateSelect('trackingFromDateSelect');
  populateMovementDateSelect('trackingToDateSelect');

  const runs = distinctMovementSnapshotRuns();
  const fromRun = runs.length >= 2 ? runs[runs.length - 2] : runs[0];
  const toRun = runs[runs.length - 1];

  if (fromRun) {
    fromDateSel.value = istDateKey(fromRun.at);
    populateMovementTimeSelect('trackingFromDateSelect', 'trackingFromTimeSelect', fromRun.at);
  }
  if (toRun) {
    toDateSel.value = istDateKey(toRun.at);
    populateMovementTimeSelect('trackingToDateSelect', 'trackingToTimeSelect', toRun.at);
  }
}

function getPickedTrackingWindow(){
  const fromAt = getSelectedMovementSnapshot('trackingFromTimeSelect');
  const toAt = getSelectedMovementSnapshot('trackingToTimeSelect');
  if (!fromAt || !toAt) return null;
  return { fromAt, toAt };
}

// Region Issue Trend: a chart spanning the WHOLE captured history (dimmed)
// with the picked From→To window highlighted at full color, plus a compact
// From/To/Change table underneath for the two exact picked points — lets
// you line up "the snapshot closest to when I sent that region's email"
// against "now" and see whether each count actually dropped, both as a
// trend shape and as exact numbers. Entirely sheet-sourced: nothing here
// reads or writes browser storage.
function renderTrackingTab(){
  const chartEl = document.getElementById('trackingChart');
  const table = document.getElementById('trackingTable');
  const regionSelect = document.getElementById('trackingRegionSelect');
  const countEl = document.getElementById('trackingCount');
  const noticeEl = document.getElementById('trackingNotice');
  const cohortTable = document.getElementById('trackingCohortTable');
  const cohortCountEl = document.getElementById('trackingCohortCount');
  const cohortNoticeEl = document.getElementById('trackingCohortNotice');
  if (!table || !regionSelect || !chartEl) return;

  const cohortThead = cohortTable ? cohortTable.querySelector('thead') : null;
  const cohortTbody = cohortTable ? cohortTable.querySelector('tbody') : null;
  // Shared by every early-return below — the cohort table has nothing
  // meaningful to show whenever the main table doesn't either.
  const clearCohort = (message) => {
    if (cohortCountEl) cohortCountEl.textContent = '';
    if (cohortThead) cohortThead.innerHTML = '';
    if (cohortTbody) cohortTbody.innerHTML = '';
    if (cohortNoticeEl) { cohortNoticeEl.style.display = 'block'; cohortNoticeEl.innerHTML = message; }
  };

  // Region dropdown built from the fixed region map, preserving whatever
  // was already selected across re-renders.
  const regionList = Array.from(new Set(Object.values(REGION_GROUP_MAP))).sort();
  const prevValue = regionSelect.value;
  regionSelect.innerHTML = `<option value="__all__">All regions (combined)</option>` +
    regionList.map(r => `<option value="${esc(r)}">${esc(r)}</option>`).join('');
  regionSelect.value = (prevValue && (prevValue === '__all__' || regionList.includes(prevValue))) ? prevValue : '__all__';
  const selectedRegion = regionSelect.value;

  const thead = table.querySelector('thead'), tbody = table.querySelector('tbody');

  if (movementFetchState !== 'ok') {
    if (countEl) countEl.textContent = '';
    chartEl.innerHTML = ''; thead.innerHTML = ''; tbody.innerHTML = '';
    if (noticeEl) {
      noticeEl.style.display = 'block';
      noticeEl.innerHTML = movementFetchState === 'loading'
        ? 'Loading movement history…'
        : `<b>No Movement_Log data yet.</b> This tab reads the same "Movement_Log" sheet tab as the Movement tab — see <span class="mono">MovementTracker.gs</span> for the one-time setup, or click Snapshot now above once you're signed in to start capturing without it.`;
    }
    clearCohort('Same as above.');
    return;
  }

  const win = getPickedTrackingWindow();
  if (!win) {
    if (countEl) countEl.textContent = '';
    chartEl.innerHTML = ''; thead.innerHTML = ''; tbody.innerHTML = '';
    if (noticeEl) {
      noticeEl.style.display = 'block';
      noticeEl.innerHTML = 'Only one snapshot captured so far — need at least two before anything can be compared. Click Snapshot now above, or check back after the next scheduled run.';
    }
    clearCohort('Same as above.');
    return;
  }

  const runs = computeIssueTalliesByRun(selectedRegion);
  if (!runs.length) {
    if (countEl) countEl.textContent = '';
    chartEl.innerHTML = ''; thead.innerHTML = ''; tbody.innerHTML = '';
    if (noticeEl) {
      noticeEl.style.display = 'block';
      noticeEl.innerHTML = `No leads matched ${esc(selectedRegion === '__all__' ? 'the current filters' : selectedRegion)} in any captured snapshot.`;
    }
    clearCohort('Same as above.');
    return;
  }
  if (noticeEl) noticeEl.style.display = 'none';

  const windowedRuns = runs.filter(r => r.at.getTime() >= win.fromAt.getTime() && r.at.getTime() <= win.toAt.getTime());
  if (countEl) countEl.textContent = windowedRuns.length + ' snapshot' + (windowedRuns.length === 1 ? '' : 's') + ' in range: ' + istStamp(win.fromAt) + ' → ' + istStamp(win.toAt);

  chartEl.innerHTML = windowedRuns.length >= 2
    ? buildTrackingChartSvg(runs, win.fromAt, win.toAt)
    : windowedRuns.length === 1
    ? `<div class="empty-row">Only one snapshot for this region falls in the picked range — need at least two to draw a trend. Pick a wider From/To.</div>`
    : `<div class="empty-row">No snapshots for this region fall in the picked range. Pick a wider From/To.</div>`;

  const fromTally = findRunTally(runs, win.fromAt);
  const toTally = findRunTally(runs, win.toAt);

  thead.innerHTML = `<tr>
    <th>Issue</th>
    <th style="text-align:right">From</th>
    <th style="text-align:right">To</th>
    <th style="text-align:right">Change</th>
    <th style="text-align:right" title="Issue count ÷ Total Leads in System at that snapshot">% of Total (From)</th>
    <th style="text-align:right" title="Issue count ÷ Total Leads in System at that snapshot">% of Total (To)</th>
  </tr>`;

  const deltaBadge = (curr, prev) => {
    const diff = curr - prev;
    if (diff === 0) return `<span class="dim">±0</span>`;
    const color = diff < 0 ? 'var(--green)' : 'var(--red)';
    const arrow = diff < 0 ? '▼' : '▲';
    return `<span style="color:${color}; font-weight:600;">${arrow} ${Math.abs(diff)}</span>`;
  };
  const pctCell = (count, total) => total ? `${(count / total * 100).toFixed(1)}%` : '—';

  const rows = ISSUE_PRIORITY.map(c => {
    const f = fromTally.byCheck[c.key] || 0;
    const t = toTally.byCheck[c.key] || 0;
    return `<tr>
      <td>${esc(c.label)}</td><td class="num">${f}</td><td class="num">${t}</td><td class="num">${deltaBadge(t, f)}</td>
      <td class="num dim">${pctCell(f, fromTally.totalAll)}</td><td class="num dim">${pctCell(t, toTally.totalAll)}</td>
    </tr>`;
  });
  rows.push(`<tr style="font-weight:600;">
    <td>Total Breaching</td><td class="num">${fromTally.breachedTotal}</td><td class="num">${toTally.breachedTotal}</td>
    <td class="num">${deltaBadge(toTally.breachedTotal, fromTally.breachedTotal)}</td>
    <td class="num dim">${pctCell(fromTally.breachedTotal, fromTally.totalAll)}</td><td class="num dim">${pctCell(toTally.breachedTotal, toTally.totalAll)}</td>
  </tr>`);
  rows.push(`<tr class="dim">
    <td>Open Leads</td><td class="num">${fromTally.openTotal}</td><td class="num">${toTally.openTotal}</td>
    <td class="num">${deltaBadge(toTally.openTotal, fromTally.openTotal)}</td>
    <td class="num">${pctCell(fromTally.openTotal, fromTally.totalAll)}</td><td class="num">${pctCell(toTally.openTotal, toTally.totalAll)}</td>
  </tr>`);
  rows.push(`<tr class="dim">
    <td>Total Leads in System</td><td class="num">${fromTally.totalAll}</td><td class="num">${toTally.totalAll}</td>
    <td class="num">${deltaBadge(toTally.totalAll, fromTally.totalAll)}</td>
    <td class="num">100%</td><td class="num">100%</td>
  </tr>`);

  tbody.innerHTML = rows.join('');

  if (cohortTable) {
    const cohort = computeCohortComparison(selectedRegion, win.fromAt, win.toAt);
    if (!cohort.matchedCount) {
      clearCohort('No lead was present in both the From and To snapshots for this region/filter combination — every lead in range is either new since From or gone by To, so there is no fixed cohort to compare.');
    } else {
      if (cohortNoticeEl) cohortNoticeEl.style.display = 'none';
      if (cohortCountEl) cohortCountEl.textContent = `${cohort.matchedCount} lead${cohort.matchedCount === 1 ? '' : 's'} present at both points`;

      cohortThead.innerHTML = `<tr>
        <th>Issue</th>
        <th style="text-align:right" title="Of the matched cohort, flagged for this issue at the From snapshot">Flagged at From</th>
        <th style="text-align:right" title="Of those, STILL flagged for the same issue at the To snapshot">Still Flagged at To</th>
        <th style="text-align:right">Resolved</th>
        <th style="text-align:right" title="Resolved ÷ Flagged at From">Resolved %</th>
      </tr>`;

      const resolvedPctCell = (flaggedAtFrom, stillFlaggedAtTo) => {
        const resolved = flaggedAtFrom - stillFlaggedAtTo;
        const pct = flaggedAtFrom ? `${(resolved / flaggedAtFrom * 100).toFixed(1)}%` : '—';
        return { resolved, pct };
      };

      const cohortRows = ISSUE_PRIORITY.map(c => {
        const stats = cohort.byCheck[c.key] || { flaggedAtFrom: 0, stillFlaggedAtTo: 0 };
        const { resolved, pct } = resolvedPctCell(stats.flaggedAtFrom, stats.stillFlaggedAtTo);
        return `<tr>
          <td>${esc(c.label)}</td><td class="num">${stats.flaggedAtFrom}</td><td class="num">${stats.stillFlaggedAtTo}</td>
          <td class="num" style="color:${resolved > 0 ? 'var(--green)' : 'inherit'};">${resolved}</td><td class="num dim">${pct}</td>
        </tr>`;
      });
      const { resolved: totalResolved, pct: totalPct } = resolvedPctCell(cohort.breachedAtFromCount, cohort.stillBreachedCount);
      cohortRows.push(`<tr style="font-weight:600;">
        <td>Breaching Any Issue</td><td class="num">${cohort.breachedAtFromCount}</td><td class="num">${cohort.stillBreachedCount}</td>
        <td class="num" style="color:${totalResolved > 0 ? 'var(--green)' : 'inherit'};">${totalResolved}</td><td class="num dim">${totalPct}</td>
      </tr>`);
      cohortTbody.innerHTML = cohortRows.join('');
    }
  }
}
