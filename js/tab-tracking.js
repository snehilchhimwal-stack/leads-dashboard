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
  // Read + parsed ONCE for this whole scan, not once per snapshot row —
  // see currentDateFilterRange's own comment (tab-movement.js).
  const dateRange = currentDateFilterRange();
  movementSnapshots.forEach(rec => {
    if (!passesMovementFilters(rec, dateRange)) return;
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
    // stage — "how many leads were in the system that day" (whatever
    // sources/filters are currently active) — so a run with only closed
    // leads for this region/filter still gets a tally entry instead of
    // silently vanishing from the chart.
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
// brand-new lead that didn't exist yet at From is excluded entirely), then
// asks of that fixed cohort: how many flagged for each issue at From are STILL
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
  // Read + parsed ONCE for this whole scan — see currentDateFilterRange's
  // own comment (tab-movement.js).
  const dateRange = currentDateFilterRange();
  movementSnapshots.forEach(rec => {
    const atMs = rec.snapshot_at.getTime();
    if (atMs !== fromMs && atMs !== toMs) return;
    if (!passesMovementFilters(rec, dateRange)) return;
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

// The 0–48h Funnel Audit's Population B/C question, answered as precisely
// as retained data allows: of leads ASSIGNED in the selected window (via the
// same top-bar Assigned-date filter every other tab already respects — no
// new date picker), how many had their 48h window fully elapse by now
// (cohort-complete — population B), and of THOSE, how many reached
// Opportunity+ / closed without converting / were still open at their own
// personal 48h mark (not a fixed global snapshot pair — computeCohortComparison
// above answers a related but different question with two shared instants).
//
// Deliberately per-lead-correct pairing, not one global From/To: population
// D (still under 48h right now) is excluded from every rate calculated
// here, exactly the "don't mix incomplete and completed cohorts" rule the
// audit called for — mixing D into B/C would understate the failure rate
// simply because young leads haven't had time to fail yet.
//
// Evidence for "status at the 48h mark" is read directly from this lead's
// OWN retained Movement_Log history (current MovementTracker.gs snapshots
// every lead each run, open or closed — see the .gs file's own comment on
// snapshotOpenLeads_), preferring the latest snapshot AT OR BEFORE the
// deadline and falling back to the first one after it (both carry up to
// ~6h of resolution slack, surfaced in the UI, never hidden) — a lead can't
// un-close or un-convert, so its most recent state that far is trustworthy.
// Only when a lead's history has NO snapshot on either side of its deadline
// (pruned past the 7-day retention window, or Movement_Log's older rows
// predate the "capture closed leads too" behavior) does this fall back to
// the live current sheet's status. A lead with neither is excluded
// entirely rather than guessed.
// Status "as of" a specific deadline for one lead's retained history —
// prefers the latest snapshot AT OR BEFORE the deadline, falls back to the
// first one AFTER it (both carry up to ~6h resolution slack, same as
// computeZeroTo48hCohort's own original inline version of this), and
// finally falls back to the live current sheet when the history has
// nothing on either side (deadline outside Movement_Log's retention
// window). Returns null when there's truly no evidence either way
// (unresolved AND no longer in the live sheet) — callers decide how to
// count that, never guess. Shared by computeZeroTo48hCohort (deadline =
// each lead's own 48h mark) and computeDailyCohortByRegion (deadline =
// either end-of-day or the 48h mark, per lead, per metric).
function evidenceAtDeadline(history, deadlineMs, liveLead){
  let atOrBefore = null, firstAfter = null;
  history.forEach(rec => {
    const atMs = rec.snapshot_at.getTime();
    if (atMs <= deadlineMs) { if (!atOrBefore || atMs > atOrBefore.snapshot_at.getTime()) atOrBefore = rec; }
    else if (!firstAfter || atMs < firstAfter.snapshot_at.getTime()) firstAfter = rec;
  });
  const evidence = atOrBefore || firstAfter;
  if (evidence) {
    const enriched = enrichSnapshotCached(evidence);
    return { oppOrAbove: enriched.oppOrAbove, isOpenLead: enriched.isOpenLead, evidence };
  }
  if (liveLead) return { oppOrAbove: liveLead.oppOrAbove, isOpenLead: liveLead.isOpenLead, evidence: null };
  return null;
}

function computeZeroTo48hCohort(){
  const fromVal = document.getElementById('dateFromInput').value;
  const toVal = document.getElementById('dateToInput').value;
  if (!fromVal && !toVal) return null; // unbounded assignment window — no defined cohort to report
  const fromDate = fromVal ? parseDate(fromVal + ' 00:00:00') : null;
  const toDate = toVal ? parseDate(toVal + ' 23:59:59') : null;

  const byLead = buildMovementHistories();
  const nowMs = Date.now();
  const liveByKey = new Map();
  allParsedLeads.forEach(l => {
    const key = String(l.client_id || '').trim() || 'l:' + String(l.lead_id).trim();
    liveByKey.set(key, l);
  });

  let popA = 0, popB = 0, popC_opp = 0, popC_closed = 0, popC_stillOpen = 0, popUnresolved = 0;
  const stillOpenLeads = [];

  byLead.forEach((history, key) => {
    if (!history.length) return;
    // fromDate/toDate already computed just above — passed through so
    // passesMovementFilters doesn't also re-read + re-parse the same DOM
    // inputs on every one of these per-lead calls (perf pass, 2026-08-28).
    if (!passesMovementFilters(history[0], { fromDate, toDate })) return; // Project/Region/TL/Source/Sub-source — date handled below, against created, not snapshot_at
    const created = parseDate(history[0].lead_assigned_at);
    if (!created) return;
    if (fromDate && created < fromDate) return;
    if (toDate && created > toDate) return;

    popA++;
    const deadlineMs = created.getTime() + CONFIG.LEAD_LIFECYCLE_HOURS * 3600 * 1000;
    if (nowMs < deadlineMs) return; // population D — window hasn't elapsed yet, excluded from every rate below

    popB++;
    const result = evidenceAtDeadline(history, deadlineMs, liveByKey.get(key));
    if (!result) { popUnresolved++; return; }
    if (result.oppOrAbove) popC_opp++;
    else if (result.isOpenLead) { popC_stillOpen++; stillOpenLeads.push({ key, created, evidence: result.evidence, live: liveByKey.get(key) }); }
    else popC_closed++;
  });

  return { popA, popB, popD: popA - popB, popC_opp, popC_closed, popC_stillOpen, popUnresolved, stillOpenLeads };
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

  // Top panel: total leads in the system at each snapshot (whatever
  // sources/filters are currently active) — every matching lead
  // regardless of stage (see computeIssueTalliesByRun's
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

// SLA History Maintenance section (below) — these two actions used to be
// console-only (see their own doc-comments in core.js/sheets-writeback.js);
// wiring them to real buttons here rather than in initMovementUI() since
// this section lives on the Tracking tab, which is the actual consumer of
// SLA_History's data.
function setSlaHistoryAdminStatus(text, color){
  const el = document.getElementById('slaHistoryAdminStatus');
  if (el) { el.textContent = text; el.style.color = color || 'var(--text-faint)'; }
}
const backfillSlaHistoryBtn = document.getElementById('backfillSlaHistoryBtn');
if (backfillSlaHistoryBtn) backfillSlaHistoryBtn.addEventListener('click', async () => {
  if (!movementSnapshots.length) {
    setSlaHistoryAdminStatus('No Movement_Log data loaded yet — refresh first.', 'var(--amber)');
    return;
  }
  const originalLabel = backfillSlaHistoryBtn.textContent;
  backfillSlaHistoryBtn.disabled = true;
  backfillSlaHistoryBtn.textContent = 'Backfilling…';
  setSlaHistoryAdminStatus(`Backfilling from ${movementSnapshots.length.toLocaleString()} loaded Movement_Log rows…`, 'var(--text-faint)');
  try {
    await backfillSlaHistoryFromMovementLog();
    setSlaHistoryAdminStatus('Backfill complete.', 'var(--green)');
  } catch (err) {
    setSlaHistoryAdminStatus(`Backfill failed: ${err.message}`, 'var(--red)');
  } finally {
    backfillSlaHistoryBtn.disabled = false;
    backfillSlaHistoryBtn.textContent = originalLabel;
  }
});
const clearSlaHistoryBtn = document.getElementById('clearSlaHistoryBtn');
if (clearSlaHistoryBtn) clearSlaHistoryBtn.addEventListener('click', async () => {
  if (!confirm('Permanently delete every row in SLA_History? This cannot be undone.')) return;
  const originalLabel = clearSlaHistoryBtn.textContent;
  clearSlaHistoryBtn.disabled = true;
  clearSlaHistoryBtn.textContent = 'Clearing…';
  setSlaHistoryAdminStatus('Clearing SLA_History…', 'var(--text-faint)');
  try {
    await clearSlaHistory();
    setSlaHistoryAdminStatus('SLA_History cleared.', 'var(--green)');
  } catch (err) {
    setSlaHistoryAdminStatus(`Clear failed: ${err.message}`, 'var(--red)');
  } finally {
    clearSlaHistoryBtn.disabled = false;
    clearSlaHistoryBtn.textContent = originalLabel;
  }
});

// Daily Cohort History section (below) — same pattern as SLA History
// Maintenance above: persistDailyCohortHistory already auto-captures on
// every refresh, these two buttons are just for a one-time catch-up
// (whatever's currently loaded from Movement_Log) or a full reset.
function setDailyCohortHistoryAdminStatus(text, color){
  const el = document.getElementById('dailyCohortHistoryAdminStatus');
  if (el) { el.textContent = text; el.style.color = color || 'var(--text-faint)'; }
}
const backfillDailyCohortHistoryBtn = document.getElementById('backfillDailyCohortHistoryBtn');
if (backfillDailyCohortHistoryBtn) backfillDailyCohortHistoryBtn.addEventListener('click', async () => {
  if (!movementSnapshots.length) {
    setDailyCohortHistoryAdminStatus('No Movement_Log data loaded yet — refresh first.', 'var(--amber)');
    return;
  }
  const originalLabel = backfillDailyCohortHistoryBtn.textContent;
  backfillDailyCohortHistoryBtn.disabled = true;
  backfillDailyCohortHistoryBtn.textContent = 'Backfilling…';
  setDailyCohortHistoryAdminStatus(`Backfilling from ${movementSnapshots.length.toLocaleString()} loaded Movement_Log rows…`, 'var(--text-faint)');
  try {
    const n = await backfillDailyCohortHistoryFromMovementLog();
    setDailyCohortHistoryAdminStatus(`Backfill complete — ${n} fully-resolved day×region row(s) written.`, 'var(--green)');
  } catch (err) {
    setDailyCohortHistoryAdminStatus(`Backfill failed: ${err.message}`, 'var(--red)');
  } finally {
    backfillDailyCohortHistoryBtn.disabled = false;
    backfillDailyCohortHistoryBtn.textContent = originalLabel;
  }
});
const clearDailyCohortHistoryBtn = document.getElementById('clearDailyCohortHistoryBtn');
if (clearDailyCohortHistoryBtn) clearDailyCohortHistoryBtn.addEventListener('click', async () => {
  if (!confirm('Permanently delete every row in Daily_Cohort_History? This cannot be undone.')) return;
  const originalLabel = clearDailyCohortHistoryBtn.textContent;
  clearDailyCohortHistoryBtn.disabled = true;
  clearDailyCohortHistoryBtn.textContent = 'Clearing…';
  setDailyCohortHistoryAdminStatus('Clearing Daily_Cohort_History…', 'var(--text-faint)');
  try {
    await clearDailyCohortHistory();
    setDailyCohortHistoryAdminStatus('Daily_Cohort_History cleared.', 'var(--green)');
  } catch (err) {
    setDailyCohortHistoryAdminStatus(`Clear failed: ${err.message}`, 'var(--red)');
  } finally {
    clearDailyCohortHistoryBtn.disabled = false;
    clearDailyCohortHistoryBtn.textContent = originalLabel;
  }
});

// Defaults to the second-most-recent run / most-recent run — a pair that
// could be weeks apart (e.g. "when I sent Tuesday's email" vs "now"), so
// this tab keeps its own From/To picker rather than sharing one meant for
// a short, recent comparison.
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

  // Independent of the From/To snapshot-pair picker checked below (and of
  // every early return that picker's absence causes) — the 0–48h Cohort
  // Outcome section is driven entirely by the top bar's Assigned-date filter
  // instead, so it must not go blank just because no snapshot pair happens
  // to be selected.
  render48hCohort();
  renderDailyCohortByRegion();
  renderWeekOverWeekCohort();

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
      noticeEl.innerHTML = esc(movementUnavailableReason());
    }
    clearCohort(movementUnavailableReason());
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

// Renders the 0–48h Cohort Outcome section (see computeZeroTo48hCohort's
// own comment for the method). Independent of the From/To snapshot picker
// above — driven by the top bar's Assigned-date filter instead, since this
// answers a "what happened to leads assigned in a period" question, not a
// "compare two snapshot instants" one.
function render48hCohort(){
  const countEl = document.getElementById('tracking48hCount');
  const noticeEl = document.getElementById('tracking48hNotice');
  const summaryEl = document.getElementById('tracking48hSummary');
  const listEl = document.getElementById('tracking48hList');
  if (!summaryEl || !listEl) return;

  const clear = (message) => {
    if (countEl) countEl.textContent = '';
    summaryEl.innerHTML = '';
    listEl.innerHTML = '';
    if (noticeEl) { noticeEl.style.display = 'block'; noticeEl.innerHTML = message; }
  };

  if (movementFetchState !== 'ok') { clear(esc(movementUnavailableReason())); return; }

  const result = computeZeroTo48hCohort();
  if (!result) {
    clear('Set an Assigned-date range in the filter bar above (From and/or To) to define which leads this cohort covers — this section reads that same global filter, not the From/To snapshot pickers above.');
    return;
  }
  if (!result.popA) {
    clear('No leads with a Movement_Log history were assigned in the selected date range (for the current Project/Region/TL/Source filters).');
    return;
  }
  if (noticeEl) noticeEl.style.display = 'none';

  const pctOfB = (n) => result.popB ? `${(n / result.popB * 100).toFixed(1)}%` : '—';
  if (countEl) countEl.textContent = `${result.popA} lead${result.popA === 1 ? '' : 's'} assigned in range`;

  const statCard = (label, value, sub, color) => `<div class="hover-card" style="padding:12px 14px;">
    <div class="kpi-num mono" style="font-size:22px;${color ? ` color:${color};` : ''}">${value}</div>
    <div class="kpi-label">${esc(label)}</div>
    ${sub ? `<div class="kpi-sub">${sub}</div>` : ''}
  </div>`;

  summaryEl.innerHTML = `<div style="display:grid; grid-template-columns:repeat(auto-fit,minmax(150px,1fr)); gap:10px; margin-bottom:14px;">
    ${statCard('Assigned in range (A)', result.popA, 'denominator for everything here')}
    ${statCard('48h window complete (B)', result.popB, `${result.popD} still under 48h (D) — excluded below`)}
    ${statCard('Reached Opportunity+', result.popC_opp, `${pctOfB(result.popC_opp)} of B`, 'var(--green)')}
    ${statCard('Closed, never converted', result.popC_closed, `${pctOfB(result.popC_closed)} of B`, 'var(--text-dim)')}
    ${statCard('Still open at 48h (failed)', result.popC_stillOpen, `${pctOfB(result.popC_stillOpen)} of B`, 'var(--red)')}
  </div>
  ${result.popUnresolved ? `<div class="filter-summary" style="margin-bottom:10px;">${result.popUnresolved} lead${result.popUnresolved === 1 ? '' : 's'} in B couldn't be evidenced (no Movement_Log snapshot near their 48h mark and no longer in the live sheet) — excluded rather than guessed.</div>` : ''}
  <div class="filter-summary" style="margin-bottom:10px;">Status at each lead's OWN 48h mark, read from the closest retained Movement_Log snapshot (up to ~6h resolution either side) — not a fixed global snapshot pair. Population D (still under 48h) is excluded from every percentage above, so a rising volume of brand-new leads can't dilute the failure rate.</div>`;

  const group = result.stillOpenLeads.slice().sort((a, b) => a.created - b.created);
  listEl.innerHTML = group.length
    ? truncationNotice(group.length, MAX_CARDS) + group.slice(0, MAX_CARDS).map((item, idx) => {
        const l = item.live;
        const stageTxt = l ? l.current_stage : (item.evidence ? item.evidence.current_stage : '');
        const rm = l ? l.RM : (item.evidence ? item.evidence.RM : '');
        const region = l ? l.region : (item.evidence ? item.evidence.region : '');
        const evidenceNote = item.evidence
          ? `evidence: snapshot ${istStamp(item.evidence.snapshot_at)}`
          : 'evidence: live sheet (no snapshot near the 48h mark)';
        return `<div class="alert-card">
          <div class="alert-id">${esc(item.key)} · ${esc(rm || 'Unassigned')}</div>
          <div class="alert-age mono">assigned ${esc(istStamp(item.created))}</div>
          <div class="alert-meta">${esc(region || '')} · ${esc(stageTxt || '')} — <span class="chip red">Still open at 48h</span></div>
          <div class="alert-comment mono" style="font-size:11px;">${esc(evidenceNote)}</div>
        </div>`;
      }).join('')
    : `<div class="empty-row" style="background:var(--surface); border-radius:8px; border:1px solid var(--border);">Every cohort-complete lead in range either converted or closed by its own 48h mark.</div>`;
}

// One specific calendar day (not a range) of leads, broken down BY REGION,
// answering three questions per region: of the leads ASSIGNED that day, (1)
// what % had already reached Opportunity+ by the END of that same day (or
// "as of right now" if that day isn't over yet), (2) of those whose 48h
// window has fully elapsed by now, what % reached Opportunity+ by their own
// 48h mark, and (3) of that same 48h-complete group, what % closed without
// ever converting. (2) and (3) share one denominator (the 48h-complete
// subset) since both ask "what had happened by the 48h mark" — only the
// outcome differs. Same evidence method as computeZeroTo48hCohort
// (evidenceAtDeadline): nearest retained Movement_Log snapshot at-or-before
// the deadline, live sheet as fallback, unresolved leads excluded rather
// than guessed. Returns null when no date is picked. `opts.ignoreFilters`
// skips the Project/Region/TL/Source/Sub-source check below entirely —
// used by persistDailyCohortHistory, which must always persist the TRUE,
// unfiltered picture rather than whatever filter state the person who
// happens to have the dashboard open right now has selected; the on-screen
// table (renderDailyCohortByRegion) never passes this, so it keeps
// reflecting the current filters exactly as before.
// See computeDailyCohortByRegion's own comment on liveByKey for why this
// is cached (keyed on the allParsedLeads array reference — a WeakMap, so
// a stale entry is garbage-collected normally once a fresh fetch replaces
// allParsedLeads, never leaking).
const _dailyCohortLiveByKeyCacheMap = new WeakMap();
function _dailyCohortLiveByKeyCache(leadsArr){
  const cached = _dailyCohortLiveByKeyCacheMap.get(leadsArr);
  if (cached) return cached;
  const liveByKey = new Map();
  leadsArr.forEach(l => {
    const key = String(l.client_id || '').trim() || 'l:' + String(l.lead_id).trim();
    liveByKey.set(key, l);
  });
  _dailyCohortLiveByKeyCacheMap.set(leadsArr, liveByKey);
  return liveByKey;
}
// See the `entries` build inside computeDailyCohortByRegion for how this
// is used — keyed on the byLead Map reference (buildMovementHistories'
// own cached result).
const _dailyCohortEntriesCacheMap = new WeakMap();

function computeDailyCohortByRegion(dateKey, opts){
  if (!dateKey) return null;
  const ignoreFilters = !!(opts && opts.ignoreFilters);
  const dayStart = parseDate(dateKey + ' 00:00:00');
  const dayEnd = parseDate(dateKey + ' 23:59:59');
  if (!dayStart || !dayEnd) return null;

  const byLead = buildMovementHistories();
  const nowMs = Date.now();
  const sameDayDeadlineMs = Math.min(dayEnd.getTime(), nowMs);
  // liveByKey (and the `entries` merge just below, which is built purely
  // from liveByKey + byLead) are cached across calls, keyed on both input
  // references — computeWeekOverWeekCohort calls this function once PER
  // DAY in a 14-day window, plus renderDailyCohortByRegion calls it once
  // more directly, and every one of those calls used to rebuild the same
  // liveByKey map from the whole allParsedLeads array from scratch (perf
  // pass, 2026-08-28). A fresh data refresh always creates new
  // allParsedLeads/byLead references, so the cache invalidates itself
  // correctly the moment the underlying data actually changes.
  const liveByKey = _dailyCohortLiveByKeyCache(allParsedLeads);

  const byRegion = new Map(); // mainRegion -> stats
  function statsFor(region){
    if (!byRegion.has(region)) byRegion.set(region, {
      region, created: 0,
      sameDayResolved: 0, sameDayOpp: 0,
      windowComplete: 0, resolved48h: 0, opp48h: 0, closed48h: 0,
    });
    return byRegion.get(region);
  }

  // Every lead this cohort could include: everyone with SOME Movement_Log
  // history (byLead), PLUS any live lead assigned this day that
  // Movement_Log never captured a single snapshot of at all —
  // buildMovementHistories only knows about leads that appear in
  // movementSnapshots at least once, so a lead Movement_Log's capture run
  // happened to miss entirely (a real gap, or a lead added and resolved
  // between two 6-hourly captures) has NO entry in byLead whatsoever, not
  // even an empty one, and was silently invisible here even though it's
  // sitting right there in the live sheet. evidenceAtDeadline below
  // already falls back to the live record when history is empty — this
  // just makes sure such a lead reaches that call at all, the same way
  // the Daily_Cohort_History fallback (renderDailyCohortByRegion) catches
  // a DIFFERENT reason a day can go missing (aged out of retention).
  // Cached the same way as liveByKey above, keyed on the byLead Map
  // reference (and re-checked against liveByKey, in case that ever
  // changes while byLead somehow doesn't) — this merge is otherwise
  // rebuilt on every one of computeWeekOverWeekCohort's 14 calls too.
  let entriesCacheEntry = _dailyCohortEntriesCacheMap.get(byLead);
  if (!entriesCacheEntry || entriesCacheEntry.liveByKey !== liveByKey) {
    const built = [];
    byLead.forEach((history, key) => built.push([key, history]));
    liveByKey.forEach((liveLead, key) => { if (!byLead.has(key)) built.push([key, []]); });
    entriesCacheEntry = { liveByKey, entries: built };
    _dailyCohortEntriesCacheMap.set(byLead, entriesCacheEntry);
  }
  const entries = entriesCacheEntry.entries;

  let totalCreated = 0;
  entries.forEach(([key, history]) => {
    const first = history.length ? history[0] : liveByKey.get(key);
    if (!first) return;
    // skipDateFilter: this section has its OWN independent single-day
    // picker (dateKey/dayStart/dayEnd above) — the top bar's Assigned-date
    // RANGE filter must not ALSO gate it, or picking a day outside
    // whatever range happens to be set there silently zeroes out a day
    // that genuinely has leads. Project/Region/TL/Source/Sub-source still
    // apply — region here narrows WHICH regions appear at all, same as
    // every other Movement view.
    if (!ignoreFilters && !passesMovementFilters(first, { skipDateFilter: true })) return;
    const created = parseDate(first.lead_assigned_at);
    if (!created) return;
    if (created < dayStart || created > dayEnd) return; // not created on this day

    totalCreated++;
    const region = mainRegionFor(effectiveRegion(first)) || 'Unmapped';
    const stats = statsFor(region);
    stats.created++;

    const sameDay = evidenceAtDeadline(history, sameDayDeadlineMs, liveByKey.get(key));
    if (sameDay) {
      stats.sameDayResolved++;
      if (sameDay.oppOrAbove) stats.sameDayOpp++;
    }

    const deadline48hMs = created.getTime() + CONFIG.LEAD_LIFECYCLE_HOURS * 3600 * 1000;
    if (nowMs < deadline48hMs) return; // this lead's own 48h window hasn't elapsed yet
    stats.windowComplete++;
    const at48h = evidenceAtDeadline(history, deadline48hMs, liveByKey.get(key));
    if (!at48h) return;
    stats.resolved48h++;
    if (at48h.oppOrAbove) stats.opp48h++;
    else if (!at48h.isOpenLead) stats.closed48h++;
  });

  return { dateKey, totalCreated, byRegion };
}

// Candidate dates for Daily Cohort History — every calendar day whose
// dayEnd falls within Movement_Log's actual RETAINED snapshot coverage
// (so there's real point-in-time evidence nearby to judge outcomes from,
// not just a lead that happens to still be open) AND whose entire 48h
// window has already elapsed (so every stored number is final, never
// partial). Deliberately NOT every distinct lead_assigned_at ever seen —
// a lead stays open, and keeps showing up in every snapshot, for however
// long its own sales cycle runs, which can be months; without this bound
// a handful of very old still-open leads would blow this out to scanning
// one region-wise pass per day across that ENTIRE span. Shared by
// persistDailyCohortHistory below and
// backfillDailyCohortHistoryFromMovementLog (sheets-writeback.js) so the
// bound only has to be right in one place.
function eligibleDailyCohortDates(){
  if (!movementSnapshots.length) return [];
  let earliestSnapshotMs = null;
  movementSnapshots.forEach(rec => {
    const ms = rec.snapshot_at.getTime();
    if (earliestSnapshotMs === null || ms < earliestSnapshotMs) earliestSnapshotMs = ms;
  });

  const byLead = buildMovementHistories();
  const dayKeys = new Set();
  byLead.forEach(history => {
    if (!history.length) return;
    const created = parseDate(history[0].lead_assigned_at);
    if (created) dayKeys.add(istDateKey(created));
  });

  const nowMs = Date.now();
  return Array.from(dayKeys).filter(dateKey => {
    const dayEnd = parseDate(dateKey + ' 23:59:59');
    if (!dayEnd) return false;
    const dayEndMs = dayEnd.getTime();
    return dayEndMs >= earliestSnapshotMs && (dayEndMs + CONFIG.LEAD_LIFECYCLE_HOURS * 3600 * 1000) <= nowMs;
  }).sort();
}

// Auto-persists Daily Cohort by Region into the Daily_Cohort_History sheet
// tab so trend-over-time survives Movement_Log's 7-day retention — without
// this, "are we improving on same-day/48h conversion?" can only ever be
// answered for whatever's still in that 7-day window. Called once per
// dashboard refresh (see fetchMovementLog's .then() in core.js), same
// "opportunistic capture from whoever has the dashboard open" reasoning as
// snapshotSlaHistory there. Always computes with ignoreFilters — the
// persisted record must reflect the TRUE picture regardless of whatever
// Project/Region/TL/Source filters the person currently looking at the
// dashboard happens to have selected; the on-screen table is unaffected,
// it still reads the live filters as before.
//
// Only persists a date once its ENTIRE 48h window has elapsed (every lead
// assigned that day has had its own 48h mark pass), so a stored row is
// always final — same-day and 48h numbers land together, once, rather
// than needing a silent follow-up correction once more data comes in.
// Re-checked and re-upserted on every refresh (cheap: a handful of
// eligible recent days × regions, all from data already loaded) so a run
// missed one day still gets caught on the next, as long as it's re-run
// before that day ages out of Movement_Log's retention — a date that goes
// unresolved AND unretained before any refresh ever covers it is lost,
// same limitation SLA_History already has for gaps longer than that.
//
// Candidate dates come from eligibleDailyCohortDates below, NOT from
// every distinct lead_assigned_at seen in history — a lead stays open
// (and keeps showing up in every snapshot) for however long its sales
// cycle runs, which can be months, so scanning every assignment date
// ever observed would replay this region-wise pass once per day across
// that whole span. Bounding to dates with real nearby snapshot coverage
// keeps this to the small handful of recent days that are actually both
// resolvable AND meaningful (a day outside Movement_Log's retention has
// no real point-in-time evidence to judge same-day/48h outcomes from
// anyway — evidenceAtDeadline would just be falling back to today's live
// sheet state for a deadline months in the past, which isn't a real
// historical answer).
async function persistDailyCohortHistory(){
  if (!movementSnapshots.length) return;
  if (!_currentSheetId) return;

  const eligibleDates = eligibleDailyCohortDates();
  if (!eligibleDates.length) return;

  const entries = [];
  eligibleDates.forEach(dateKey => {
    const result = computeDailyCohortByRegion(dateKey, { ignoreFilters: true });
    if (!result || !result.totalCreated) return;
    result.byRegion.forEach(stats => {
      if (!stats.created) return;
      entries.push({ date: dateKey, region: stats.region, source: 'Dashboard', stats });
    });
  });
  if (!entries.length) return;

  try { await upsertDailyCohortHistoryRows(entries); } catch (e) { /* this refresh's capture just won't be recorded */ }
}

// Renders computeDailyCohortByRegion as a region-wise table — one row per
// region present that day (in the SAME fixed A-Z order every time — see
// the regionList sort below, never re-sorted by count) plus a combined
// total row. Reads its own single-day date picker (trackingDailyDateInput),
// independent of both the From/To snapshot picker above and the global
// Assigned-date range filter in the top bar (computeDailyCohortByRegion's
// own passesMovementFilters call passes skipDateFilter:true to make that
// actually true, not just documented).
//
// Async: Movement_Log only retains a matter of days, so a picked date
// older than that comes back with nothing live even on a day that
// genuinely had leads. Daily_Cohort_History (sheets-writeback.js) is
// exactly the archive meant to survive past that window — once the live
// computation has nothing, this falls back to fetching that sheet tab
// before concluding there's really no data for the date.
async function renderDailyCohortByRegion(){
  const countEl = document.getElementById('trackingDailyCount');
  const noticeEl = document.getElementById('trackingDailyNotice');
  const table = document.getElementById('trackingDailyTable');
  if (!table) return;
  const thead = table.querySelector('thead'), tbody = table.querySelector('tbody');

  const clear = (message) => {
    if (countEl) countEl.textContent = '';
    thead.innerHTML = ''; tbody.innerHTML = '';
    if (noticeEl) { noticeEl.style.display = 'block'; noticeEl.innerHTML = message; }
  };

  if (movementFetchState !== 'ok') { clear(esc(movementUnavailableReason())); return; }

  const dateInput = document.getElementById('trackingDailyDateInput');
  const dateKey = dateInput ? dateInput.value : '';
  if (!dateKey) { clear('Pick a date above to see that day\'s leads broken down by region.'); return; }

  let result = computeDailyCohortByRegion(dateKey);
  let fromHistory = false;
  // Daily_Cohort_History rows are always the TRUE unfiltered picture
  // (persistDailyCohortHistory always writes with ignoreFilters:true —
  // see its own comment), so this fallback can't honor the current
  // Project/Region/TL/Source filters the way the live path does. Flagged
  // in the notice below so a filter that looks like it's "not working"
  // for an archived date isn't mistaken for a bug.
  if (!result || !result.totalCreated) {
    try {
      const archived = await fetchDailyCohortHistoryForDate(dateKey);
      if (archived && archived.totalCreated) { result = archived; fromHistory = true; }
    } catch (e) { /* no archived data either — falls through to the empty-state message below */ }
  }

  if (!result || !result.totalCreated) { clear(`No leads (for the current Project/Region/TL/Source filters) were assigned on ${esc(dateKey)}.`); return; }

  if (noticeEl) {
    if (fromHistory) {
      noticeEl.style.display = 'block';
      noticeEl.innerHTML = `Movement_Log no longer covers ${esc(dateKey)} — showing the final numbers already archived in <span class="mono">Daily_Cohort_History</span> instead. Those are always the unfiltered picture across every region, so the Project/Region/TL/Source filters above don't apply to this row set.`;
    } else {
      noticeEl.style.display = 'none';
    }
  }
  if (countEl) countEl.textContent = `${result.totalCreated} lead${result.totalCreated === 1 ? '' : 's'} assigned ${dateKey}${fromHistory ? ' (archived)' : ''}`;

  thead.innerHTML = `<tr>
    <th>Region</th>
    <th style="text-align:right">Assigned</th>
    <th style="text-align:right" title="Of leads assigned that day, reached Opportunity+ by end of that day (or as of now, if the day isn't over yet)">Same-Day Opp%</th>
    <th style="text-align:right" title="Of leads whose 48h window has fully elapsed by now, reached Opportunity+ by their own 48h mark">48h Opp%</th>
    <th style="text-align:right" title="Of the same 48h-complete group, closed without ever converting">48h Close%</th>
    <th style="text-align:right" title="How many of this region's leads have had their full 48h window elapse — the denominator for the two 48h columns. Fully available ~2 days after the picked date.">48h Window Complete</th>
  </tr>`;

  const pct = (n, d) => d ? `${(n / d * 100).toFixed(1)}%` : '—';
  const regionList = Array.from(new Set(Object.values(REGION_GROUP_MAP))).sort();
  const rowHtml = (stats, rowStyle) => `<tr${rowStyle ? ` style="${rowStyle}"` : ''}>
    <td>${esc(stats.region)}</td>
    <td class="num">${stats.created}</td>
    <td class="num">${pct(stats.sameDayOpp, stats.sameDayResolved)}</td>
    <td class="num">${pct(stats.opp48h, stats.resolved48h)}</td>
    <td class="num">${pct(stats.closed48h, stats.resolved48h)}</td>
    <td class="num dim">${stats.resolved48h} of ${stats.created}${stats.windowComplete < stats.created ? ' (partial)' : ''}</td>
  </tr>`;

  // regionList is already alphabetical (sorted above) and .filter() keeps
  // items in that same order, so no re-sort here — the old
  // `.sort((a,b) => b.created - a.created)` sorted by that DAY's volume,
  // which is exactly why every day's row order used to shuffle: whichever
  // region happened to have the most leads that specific day jumped to the
  // top. Fixed A-Z order now, every day, regardless of volume.
  const rows = regionList
    .map(r => result.byRegion.get(r) || { region: r, created: 0, sameDayResolved: 0, sameDayOpp: 0, windowComplete: 0, resolved48h: 0, opp48h: 0, closed48h: 0 })
    .filter(stats => stats.created > 0)
    .map(stats => rowHtml(stats));

  const totals = { region: 'All Regions', created: 0, sameDayResolved: 0, sameDayOpp: 0, windowComplete: 0, resolved48h: 0, opp48h: 0, closed48h: 0 };
  result.byRegion.forEach(s => {
    totals.created += s.created; totals.sameDayResolved += s.sameDayResolved; totals.sameDayOpp += s.sameDayOpp;
    totals.windowComplete += s.windowComplete; totals.resolved48h += s.resolved48h; totals.opp48h += s.opp48h; totals.closed48h += s.closed48h;
  });
  rows.push(rowHtml(totals, 'font-weight:600; border-top:2px solid var(--border);'));

  tbody.innerHTML = rows.join('');
}

/* ===================== WEEK-OVER-WEEK COHORT COMPARISON ===================== */
// Shared bucket shape for both computeDailyCohortByRegion's live stats and
// fetchAllDailyCohortHistoryRows' archived stats (same fields either way),
// summed across a 7-day window.
function emptyCohortBucket(region){
  return { region, created: 0, sameDayResolved: 0, sameDayOpp: 0, windowComplete: 0, resolved48h: 0, opp48h: 0, closed48h: 0 };
}
function addCohortBucket(dst, src){
  dst.created += src.created; dst.sameDayResolved += src.sameDayResolved; dst.sameDayOpp += src.sameDayOpp;
  dst.windowComplete += src.windowComplete; dst.resolved48h += src.resolved48h; dst.opp48h += src.opp48h; dst.closed48h += src.closed48h;
}

// This week = the 7 most recent FULLY ELAPSED calendar days (yesterday
// back through 7 days ago, IST); last week = the 7 before that. Today is
// deliberately excluded — a half-finished day would skew a week-over-week
// comparison, unlike the single-day picker above where "as of right now"
// is exactly the point. Returns newest-first arrays (index 0 = yesterday).
function weekOverWeekDateKeys(){
  const days = [];
  const now = _renderNow || new Date();
  for (let i = 1; i <= 14; i++) days.push(istDateKey(new Date(now.getTime() - i * 86400000)));
  return { thisWeek: days.slice(0, 7), lastWeek: days.slice(7, 14) };
}

// Builds the region x week matrix behind the Week-over-Week Cohort
// Comparison section. For each of the 14 dates involved: try live
// computeDailyCohortByRegion first (ignoreFilters:true — this section has
// its OWN region control, see renderWeekOverWeekCohort, and no reason to
// also inherit the top bar's Project/TL/Source/date-range filters the way
// every OTHER Movement view does); once live has nothing for a date (aged
// out of Movement_Log's retention), fall back to the Daily_Cohort_History
// archive — fetched ONCE for all 14 dates via fetchAllDailyCohortHistoryRows,
// not once per date. Returns {thisWeek, lastWeek}, each
// {dateKeys, byRegion, daysWithData, totalDays}.
async function computeWeekOverWeekCohort(){
  const { thisWeek, lastWeek } = weekOverWeekDateKeys();
  const allDates = thisWeek.concat(lastWeek);

  let archiveRows = null; // lazy — only fetched if a live date comes back empty
  async function getArchiveRows(){
    if (archiveRows === null) archiveRows = await fetchAllDailyCohortHistoryRows();
    return archiveRows;
  }

  const perDate = new Map(); // dateKey -> {byRegion: Map<region,stats>, ok:boolean}
  for (const dateKey of allDates) {
    const live = computeDailyCohortByRegion(dateKey, { ignoreFilters: true });
    if (live && live.totalCreated) {
      perDate.set(dateKey, { byRegion: live.byRegion, ok: true });
      continue;
    }
    const archived = await getArchiveRows();
    const byRegion = new Map();
    let any = false;
    archived.forEach(row => {
      if (row.date !== dateKey) return;
      byRegion.set(row.region, row.stats);
      any = true;
    });
    perDate.set(dateKey, { byRegion, ok: any });
  }

  function aggregate(dateKeys){
    const byRegion = new Map();
    let daysWithData = 0;
    dateKeys.forEach(dateKey => {
      const entry = perDate.get(dateKey);
      if (!entry || !entry.ok) return;
      daysWithData++;
      entry.byRegion.forEach((stats, region) => {
        if (!byRegion.has(region)) byRegion.set(region, emptyCohortBucket(region));
        addCohortBucket(byRegion.get(region), stats);
      });
    });
    return { dateKeys, byRegion, daysWithData, totalDays: dateKeys.length };
  }

  return { thisWeek: aggregate(thisWeek), lastWeek: aggregate(lastWeek) };
}

// {cur, prev, delta} percentage points for one rate metric — null wherever
// a side has no denominator (e.g. a region with zero leads last week),
// rather than showing a nonsensical divide-by-zero result.
function wowPctDelta(curNum, curDen, prevNum, prevDen){
  const cur = curDen ? curNum / curDen * 100 : null;
  const prev = prevDen ? prevNum / prevDen * 100 : null;
  return { cur, prev, delta: (cur !== null && prev !== null) ? cur - prev : null };
}

// polarity: 1 = higher is better (up is green), -1 = higher is worse (down
// is green) — decided by the caller per metric, never guessed from the
// sign of delta alone (a rising 48h Close% is a WORSE trend, even though
// the number itself went up).
function wowDeltaBadgeHtml(delta, polarity){
  if (delta === null) return `<span class="wow-delta flat">—</span>`;
  if (Math.abs(delta) < 0.05) return `<span class="wow-delta flat">flat</span>`;
  const improved = polarity > 0 ? delta > 0 : delta < 0;
  const arrow = delta > 0 ? '▲' : '▼';
  return `<span class="wow-delta ${improved ? 'up' : 'down'}">${arrow} ${Math.abs(delta).toFixed(1)}pp</span>`;
}

function wowPctCellHtml(curNum, curDen, prevNum, prevDen, polarity){
  const { cur, delta } = wowPctDelta(curNum, curDen, prevNum, prevDen);
  const curTxt = cur === null ? '—' : `${cur.toFixed(1)}%`;
  return `<div class="wow-pct">${curTxt}</div>${wowDeltaBadgeHtml(delta, polarity)}`;
}

// Table: one row per region present in EITHER week, fixed A-Z order (same
// convention as Daily Cohort by Region above — never re-sorted by volume
// or by how much a region moved), plus a combined All Regions row. Used to
// be paired with a chart (narrowed by its own region picker) — removed as
// not useful in practice; the table alone is the whole section now.
async function renderWeekOverWeekCohort(){
  const table = document.getElementById('trackingWowTable');
  if (!table) return;
  const thead = table.querySelector('thead'), tbody = table.querySelector('tbody');
  const countEl = document.getElementById('trackingWowCount');
  const noticeEl = document.getElementById('trackingWowNotice');

  const clear = (message) => {
    if (countEl) countEl.textContent = '';
    thead.innerHTML = ''; tbody.innerHTML = '';
    if (noticeEl) { noticeEl.style.display = 'block'; noticeEl.innerHTML = message; }
  };

  if (movementFetchState !== 'ok') { clear(esc(movementUnavailableReason())); return; }

  const regionList = Array.from(new Set(Object.values(REGION_GROUP_MAP))).sort();
  const { thisWeek, lastWeek } = await computeWeekOverWeekCohort();

  if (!thisWeek.daysWithData && !lastWeek.daysWithData) {
    clear('No Movement_Log or Daily_Cohort_History data available yet for the last two weeks.');
    return;
  }

  if (noticeEl) {
    noticeEl.style.display = 'block';
    noticeEl.innerHTML = `This week: ${esc(thisWeek.dateKeys[6])} to ${esc(thisWeek.dateKeys[0])} (${thisWeek.daysWithData} of ${thisWeek.totalDays} days have data). Last week: ${esc(lastWeek.dateKeys[6])} to ${esc(lastWeek.dateKeys[0])} (${lastWeek.daysWithData} of ${lastWeek.totalDays} days have data). Always the unfiltered picture across every Project/TL/Source.`;
  }
  if (countEl) countEl.textContent = `${regionList.length} regions`;

  thead.innerHTML = `<tr>
    <th>Region</th>
    <th style="text-align:right">Assigned (this wk vs last wk)</th>
    <th style="text-align:right">Same-Day Opp%</th>
    <th style="text-align:right">48h Opp%</th>
    <th style="text-align:right">48h Close%</th>
  </tr>`;

  const rowHtml = (region, cur, prev, rowStyle) => {
    const assignedNote = prev.created ? `<div class="wow-sub">was ${prev.created}</div>` : (cur.created ? '<div class="wow-sub">no data last week</div>' : '');
    return `<tr${rowStyle ? ` style="${rowStyle}"` : ''}>
      <td>${esc(region)}</td>
      <td class="num">${cur.created}${assignedNote}</td>
      <td class="num">${wowPctCellHtml(cur.sameDayOpp, cur.sameDayResolved, prev.sameDayOpp, prev.sameDayResolved, 1)}</td>
      <td class="num">${wowPctCellHtml(cur.opp48h, cur.resolved48h, prev.opp48h, prev.resolved48h, 1)}</td>
      <td class="num">${wowPctCellHtml(cur.closed48h, cur.resolved48h, prev.closed48h, prev.resolved48h, -1)}</td>
    </tr>`;
  };

  const rows = regionList
    .map(r => ({
      region: r,
      cur: thisWeek.byRegion.get(r) || emptyCohortBucket(r),
      prev: lastWeek.byRegion.get(r) || emptyCohortBucket(r),
    }))
    .filter(x => x.cur.created > 0 || x.prev.created > 0)
    .map(x => rowHtml(x.region, x.cur, x.prev));

  const curTotals = emptyCohortBucket('All Regions');
  const prevTotals = emptyCohortBucket('All Regions');
  thisWeek.byRegion.forEach(s => addCohortBucket(curTotals, s));
  lastWeek.byRegion.forEach(s => addCohortBucket(prevTotals, s));
  rows.push(rowHtml('All Regions', curTotals, prevTotals, 'font-weight:600; border-top:2px solid var(--border);'));

  tbody.innerHTML = rows.join('');
}
