// ============================================================
// overview-distribution-people-ops.js — the main dashboard overview:
// renderAll() orchestrator, jump nav, tab switching, daily trend, RM
// score table, fan-out/claim-rate, workload balance, allocation matrix,
// source mix, funnel/region/TL/project/RM tables, Operations issue
// lists, Issues CSV export. Extracted from dashboard.html's single
// inline <script> block (see the file-split plan) — pure code motion,
// no logic changed.
// ============================================================

// Both breakdowns below render as compact proportional-bar rows rather
// than a wall of pill chips — same underlying numbers, far less visual
// weight competing with the KPI strip right underneath. toggleInlineDetail
// (core.js) is the same collapse mechanism used elsewhere in this file
// (dedupe notice, section explainers) — it needs the toggle button
// wrapped in its own element whose NEXT sibling is the detail block.
function renderStageBreakdown(){
  const el = document.getElementById('stageBreakdown');
  if (!el) return;
  const stageCounts = {};
  let unmapped = 0;
  leads.forEach(l => {
    const key = String(l.current_stage).trim() || '(blank)';
    if (!stageCounts[key]) stageCounts[key] = { n: 0, booking: 0, collated: 0 };
    stageCounts[key].n++;
    // Tracked per raw value because isBookingLead also reads closing_reason —
    // two leads with the same stage text can land in different funnel bands.
    if (isBookingLead(l)) stageCounts[key].booking++;
    if ((l.collatedFrom || 1) > 1) stageCounts[key].collated++;
  });
  const entries = Object.entries(stageCounts).sort((a,b) => b[1].n - a[1].n);
  const total = leads.length;

  if (!entries.length) {
    el.innerHTML = `<div class="mix-summary-head">No leads match the current filters</div>`;
    return;
  }

  const rows = entries.map(([stage, info]) => {
    const count = info.n;
    const countText = info.collated > 0 ? `${count.toLocaleString()} (${info.collated} cloned)` : count.toLocaleString();
    const pct = total ? Math.round(count / total * 100) : 0;

    let barColor = 'var(--text-dim)';
    let tag = 'Open';
    let title = 'Still active — subject to call/48hr SLA tracking';
    if (isClosedStage(stage)) {
      barColor = 'var(--red)'; tag = 'Closed';
      title = 'Matched a closed-stage keyword (Won/Lost/Junk/Not Interested/etc.) — excluded from SLA tracking';
    } else if (isOppOrAbove(stage)) {
      barColor = 'var(--green)'; tag = 'Opportunity+';
      title = 'At or past the Opportunity stage — excluded from SLA tracking, now sales-owned';
    }

    // Which funnel band this text actually lands in. Without this, a stage
    // whose wording the funnel can't read simply vanishes from the chart
    // with nothing on screen explaining where it went.
    let band = canonicalStage(stage);
    if (info.booking === count) band = 'booking';
    else if (info.booking > 0) band = (band || '—') + ' / booking (mixed)';
    let bandLabel;
    if (band) {
      bandLabel = String(band).replace(/\b\w/g, c => c.toUpperCase());
    } else if (isClosedStage(stage)) {
      // A closed lead has LEFT the funnel — "Closed", "Won", "Junk" are
      // terminal states, not progression stages, so having no band is
      // correct and expected. Flagging these as a problem was a false
      // alarm: it is only a problem when a LIVE lead has no band.
      bandLabel = 'Exits funnel';
    } else {
      bandLabel = 'NO FUNNEL BAND';
      barColor = 'var(--amber)'; tag = 'Unmapped';
      unmapped += count;
      title = 'This stage text matches no funnel band and is not a closed stage, so these live leads are invisible in the Funnel chart. Add the wording to CONFIG.STAGE_ALIASES to fix.';
    }
    return `<div class="mix-row" title="${esc(title)}">
      <span class="mix-label">${esc(stage)}</span>
      <div class="mix-track"><div class="mix-fill" style="width:${pct}%; background:${barColor};"></div></div>
      <span class="mix-count">${countText} <span style="opacity:.65">→ ${esc(bandLabel)} · ${esc(tag)}</span></span>
    </div>`;
  }).join('');

  const warn = unmapped
    ? `<div style="font-size:11px; color:var(--amber); margin-top:6px;"><b>${unmapped.toLocaleString()}</b> live lead${unmapped === 1 ? '' : 's'} sit in a stage the Funnel can't read. Closed stages are excluded by design and are not counted here.</div>`
    : '';

  el.innerHTML = `<div class="mix-summary"><div class="mix-summary-head">Total leads: <b style="color:var(--text)">${collatedCountText(leads)}</b> · Stage breakdown (current filters), with the Funnel band each maps to</div>${rows}${warn}</div>`;
}

function renderSourceBreakdown(sourceCounts, dedupedLeads){
  const el = document.getElementById('sourceBreakdown');
  const entries = Object.entries(sourceCounts).sort((a,b) => b[1].n - a[1].n);
  const total = dedupedLeads.length;

  // Every source stays one neutral tone rather than a rainbow, so the bar
  // lengths do the differentiating, not competing colors — this dashboard
  // covers every lead source, not just one, so no single source gets a
  // special accent here.
  const rowHtml = ([src, info]) => {
    const countText = info.collated > 0 ? `${info.n.toLocaleString()} (${info.collated} cloned)` : info.n.toLocaleString();
    const pct = total ? Math.round(info.n / total * 100) : 0;
    return `<div class="mix-row">
      <span class="mix-label" title="${esc(src)}">${esc(src)}</span>
      <div class="mix-track"><div class="mix-fill" style="width:${pct}%; background:var(--blue);"></div></div>
      <span class="mix-count" style="width:120px; text-align:right;">${countText} · ${pct}%</span>
    </div>`;
  };

  const TOP_N = 5;
  const top = entries.slice(0, TOP_N);
  const rest = entries.slice(TOP_N);
  let html = `<div class="mix-summary-head">Total leads: <b style="color:var(--text)">${collatedCountText(dedupedLeads)}</b> · by group_source, whole tab (not filtered)</div>`;
  html += top.map(rowHtml).join('');
  if (rest.length) {
    const restTotal = rest.reduce((s, [, info]) => s + info.n, 0);
    const label = `ⓘ +${rest.length} more source${rest.length === 1 ? '' : 's'} (${restTotal.toLocaleString()})`;
    html += `<div><button type="button" class="info-toggle" data-label="${esc(label)}" onclick="toggleInlineDetail(this)">${esc(label)}</button></div>`
      + `<div style="display:none;">${rest.map(rowHtml).join('')}</div>`;
  }
  el.innerHTML = `<div class="mix-summary">${html}</div>`;
}


// Hover-detail breakdowns for KPI/summary tiles — groups an array the
// caller already built (leads/oppPlusLeads/dueTodayLeads/stuck leads/etc.),
// so this is purely re-presenting numbers already in scope, not a new
// business rule. groupBy is the existing helper from reports.js (loaded
// before this file). Returns the full bar-row HTML for the hover panel AND
// the single top entry, so a resting (non-hover) card can show one line of
// real context instead of sitting empty until someone hovers it. Hoisted to
// top level (not just renderAll-local) so any render function — e.g. the
// Operations stuck-by-stage breakdown — can reuse it.
function topBreakdown(arr, keyFn, opts){
  const total = arr.length;
  if (!total) {
    return { html: `<div style="font-size:11.5px; color:var(--text-faint);">Nothing in this bucket right now.</div>`, top: null };
  }
  const groups = groupBy(arr, item => keyFn(item) || 'Unknown');
  const pairs = Object.entries(groups).sort((a, b) => b[1].length - a[1].length).slice(0, opts && opts.limit || 4);
  const color = (opts && opts.color) || 'var(--blue)';
  const html = pairs.map(([key, items]) => {
    const pct = Math.round(items.length / total * 100);
    return `<div class="bar-row"><span class="k" title="${esc(key)}">${esc(key)}</span><div class="bar-track"><div class="bar-fill" style="width:${pct}%; background:${color};"></div></div><span class="v">${items.length}</span></div>`;
  }).join('');
  const [topKey, topItems] = pairs[0];
  return { html, top: { key: topKey, pct: Math.round(topItems.length / total * 100) } };
}

const kpiTile = (opts) => `<div class="kpi hover-card${opts.critical ? ' critical' : ''}" style="--card-accent:${opts.accent};">
  <div class="kpi-num mono"${opts.numColor ? ` style="color:${opts.numColor}"` : ''}>${opts.numHtml}</div>
  <div class="kpi-label">${esc(opts.label)}</div>
  ${opts.top ? `<div class="kpi-sub" title="${esc(opts.detailLabel)}">${opts.top.pct}% ${esc(opts.top.key)}</div>` : ''}
  <div class="card-detail"><div class="card-detail-inner">
    <div class="card-detail-label">${esc(opts.detailLabel)}</div>
    ${opts.detailHtml}
  </div></div>
</div>`;

function renderAll(){
  // Every render rebuilds every card from scratch (fresh innerHTML), so the
  // action-log registry only ever needs to hold what's rendered THIS pass —
  // clearing it here keeps it from accumulating stale entries for cards
  // that no longer exist under their old (prefix + index) key.
  _logLeadRegistry.clear();
  renderStageBreakdown();

  // Deliberately gated, not called on every pass — see the flag's own
  // comment in core.js. A plain filter tweak calls renderAll() same as a
  // real refresh does; without this check Morning Brief would recompute on
  // every one of those too, exactly the "live update" behavior it's meant
  // to avoid now.
  if (_refreshMorningBriefOnNextRender) {
    renderMorningBrief();
    _refreshMorningBriefOnNextRender = false;
  }

  // Single pass instead of five separate .filter() traversals — on a
  // 7.5k-lead sheet this runs on every filter change, so the extra
  // full-array walks add up with no benefit. Opportunity+/Total/No-Attempts
  // are customer-level counts (leads, one card per customer); the two
  // issue counts read from issueLeads instead, so a multi-copy customer
  // with two independently-behind RM copies counts as two, not one.
  const oppPlusLeads = [], noCallsLeads = [];
  for (const l of leads) {
    if (l.oppOrAbove) oppPlusLeads.push(l);
    if (l.isOpenLead && l.call_attempts === 0) noCallsLeads.push(l);
  }
  // Distinct customers, not rows — a customer whose two RM copies are each
  // independently behind/not-connected still counts once here, matching
  // the section badges below (see uniqueCloneLabel there) rather than a
  // raw per-copy instance tally.
  const dueTodayLeads = [], notConnLeads = [];
  for (const l of issueLeads) {
    if (l.underCalledToday) dueTodayLeads.push(l);
    if (l.firstContactBreach) notConnLeads.push(l);
  }
  const dueTodayCounts = countUniqueAndCloned(dueTodayLeads);
  const notConnCounts = countUniqueAndCloned(notConnLeads);
  const totalCounts = countCollatedAmong(leads);
  const oppPlusCounts = countCollatedAmong(oppPlusLeads);
  const noCallsCounts = countCollatedAmong(noCallsLeads);

  // Shared by every KPI tile below: the big digit stays the primary count,
  // with a smaller inline "(N cloned)" only when this specific population
  // actually contains any — so a filter/subset with zero cloned customers
  // never shows a pointless "(0 cloned)".
  const kpiNumHtml = (n, clonedN) => `${n.toLocaleString()}${clonedN > 0 ? `<span style="font-size:12px; color:var(--text-faint); font-weight:400;"> (${clonedN} cloned)</span>` : ''}`;

  // topBreakdown/kpiTile are top-level functions now (see above renderAll) —
  // hoisted so other render functions (e.g. the Operations stuck-by-stage
  // breakdown) can reuse them too, not just this one.
  const totalBreakdown = topBreakdown(leads, l => l.group_source, { color: 'var(--blue)' });
  const oppBreakdown = topBreakdown(oppPlusLeads, l => l.current_stage, { color: 'var(--green)' });
  const dueTodayBreakdown = topBreakdown(dueTodayLeads, l => l.region, { color: 'var(--red)' });
  const notConnBreakdown = topBreakdown(notConnLeads, l => l.RM, { color: 'var(--amber)' });
  const noCallsBreakdown = topBreakdown(noCallsLeads, l => l.region, { color: 'var(--purple)' });

  // Org-wide first-contact speed as a real distribution rather than the
  // single MAX value ("Most Delayed") that was previously the only
  // aggregate reading of businessMinsToConnect anywhere in the app.
  const sortedContactMinsAll = [];
  for (const l of leads) { if (l.businessMinsToConnect != null) sortedContactMinsAll.push(l.businessMinsToConnect); }
  sortedContactMinsAll.sort((a, b) => a - b);
  const medianContactAll = medianOfSorted(sortedContactMinsAll);
  const p90ContactAll = percentileOfSorted(sortedContactMinsAll, 90);

  document.getElementById('kpiStrip').innerHTML =
    kpiTile({
      label: 'Total Leads', accent: 'var(--blue)', numHtml: kpiNumHtml(totalCounts.total, totalCounts.collated),
      detailLabel: 'By source', detailHtml: totalBreakdown.html, top: totalBreakdown.top,
    }) +
    kpiTile({
      label: 'Opportunity+', accent: 'var(--green)', numColor: 'var(--green)',
      numHtml: kpiNumHtml(oppPlusCounts.total, oppPlusCounts.collated),
      detailLabel: 'By stage', detailHtml: oppBreakdown.html, top: oppBreakdown.top,
    }) +
    kpiTile({
      label: "Behind on Today's Calls", accent: 'var(--red)', critical: true,
      numHtml: kpiNumHtml(dueTodayCounts.unique, dueTodayCounts.cloned),
      detailLabel: 'By region', detailHtml: dueTodayBreakdown.html, top: dueTodayBreakdown.top,
    }) +
    kpiTile({
      label: 'Not Connected in 10 min', accent: 'var(--amber)', numColor: 'var(--amber)',
      numHtml: kpiNumHtml(notConnCounts.unique, notConnCounts.cloned),
      detailLabel: 'By RM', detailHtml: notConnBreakdown.html, top: notConnBreakdown.top,
    }) +
    kpiTile({
      label: 'No Attempts Yet', accent: 'var(--purple)',
      numHtml: kpiNumHtml(noCallsCounts.total, noCallsCounts.collated),
      detailLabel: 'By region', detailHtml: noCallsBreakdown.html, top: noCallsBreakdown.top,
    }) +
    kpiTile({
      label: 'Median 1st Contact', accent: 'var(--teal)',
      numHtml: medianContactAll == null ? '—' : `${medianContactAll.toFixed(0)}<span style="font-size:14px; color:var(--text-faint); font-weight:400;">m</span>`,
      detailLabel: 'Distribution',
      detailHtml: medianContactAll == null
        ? `<div style="font-size:11.5px; color:var(--text-faint);">No connected leads in the current filters.</div>`
        : `<div style="font-size:11.5px; color:var(--text-dim); line-height:1.5;">p90: ${p90ContactAll.toFixed(0)} min &middot; n = ${sortedContactMinsAll.length} connected lead${sortedContactMinsAll.length === 1 ? '' : 's'}<br>Business-hours minutes from lead_created_at to first connect (open or closed leads).</div>`,
    });

  renderFunnel();
  renderTrackingTab();
  renderRMTimelineTab();
  renderRegionTable();
  renderTLTable();
  renderRMTable();
  renderProjectTable();
  renderStalledFlaggedLeadsOps();
  renderInactiveRmList();
  renderNotUpdatedList();
  renderNotConnectedList();
  renderLoggingGapList();
  renderFollowupList();
  renderDueTodayList();
  renderApproachingDeadlineList();
  renderStuckList();
  renderRecordingList();
  renderClosedNoWorkList();
  renderDailyTrend();
  renderRMScoreTable();
  renderFanout();
  renderWorkloadBalance();
  renderAllocationMatrix();
  renderSourceMix();
  buildAuditControls();
  renderAudit();
  renderActivityByHour();
  renderMovementTab();
  renderJumpNav();
  updateTabBadges();
}

// Severity encoding: a count of 0 reads as "clear" (green, quiet), anything
// above 0 escalates by category weight. This is what lets you scan the nav
// and know where the problems are without scrolling the whole page.
const NAV_SECTIONS = [
  { id: 'sec-funnel',      label: 'Funnel',        countId: null },
  { id: 'sec-trend',       label: 'Daily Volume',  countId: null },
  { id: 'sec-region',      label: 'Regions',       countId: null },
  { id: 'sec-project',     label: 'Projects',      countId: 'projectCount' },
];

// Sections that live outside the Overview tab still need their count pills
// and empty-state styling kept in sync, even though they aren't in the nav.
const OFFTAB_COUNT_SECTIONS = [
  { id: 'sec-stalled',     countId: 'stalledCount',    severity: 'urgent' },
  { id: 'sec-inactivermlead', countId: 'inactiveRmCount', severity: 'urgent' },
  { id: 'sec-tl',          countId: 'tlCount' },
  { id: 'sec-rm',          countId: 'rmCount' },
  { id: 'sec-rmscore',     countId: 'rmScoreCount' },
  { id: 'sec-fanout',      countId: 'fanoutCount' },
  { id: 'sec-balance',     countId: 'balanceCount' },
  { id: 'sec-matrix',      countId: 'matrixCount' },
  { id: 'sec-notupdated',  countId: 'notUpdatedCount', severity: 'has-items' },
  { id: 'sec-notconn',     countId: 'notConnCount',    severity: 'urgent' },
  { id: 'sec-logginggap',  countId: 'loggingGapCount', severity: 'has-items' },
  { id: 'sec-followup',    countId: 'followupCount',   severity: 'urgent' },
  { id: 'sec-duetoday',    countId: 'dueTodayCount',   severity: 'has-items' },
  { id: 'sec-approaching48h', countId: 'approachingDeadlineCount', severity: 'has-items' },
  { id: 'sec-stuck',       countId: 'stuckCount',      severity: 'urgent' },
  { id: 'sec-recording',   countId: 'recordingCount',  severity: 'has-items' },
  { id: 'sec-closednowork', countId: 'closedNoWorkCount', severity: 'urgent' },
  { id: 'sec-reports',     countId: 'regionReportCount' },
];

function numFromCountEl(id){
  const el = document.getElementById(id);
  if (!el) return null;
  const m = String(el.textContent).match(/\d+/);
  return m ? Number(m[0]) : null;
}

function renderJumpNav(){
  const nav = document.getElementById('jumpNav');
  if (!nav) return;

  nav.innerHTML = NAV_SECTIONS.map(s => {
    const n = s.countId ? numFromCountEl(s.countId) : null;
    let badge = '';
    if (n !== null) {
      const cls = n === 0 ? '' : (s.severity || '');
      badge = `<span class="jump-count ${cls}">${n}</span>`;
    }
    return `<a class="jump-link" href="#${s.id}">${esc(s.label)}${badge}</a>`;
  }).join('');

  // Mirror the same severity read onto each section's own count pill, and
  // visually deflate sections that have nothing in them so a zero-result
  // section stops claiming the same space as one with 300 leads. Covers
  // sections in every tab, not just the ones in the nav.
  NAV_SECTIONS.concat(OFFTAB_COUNT_SECTIONS).forEach(s => {
    if (!s.countId) return;
    const el = document.getElementById(s.countId);
    if (!el) return;
    const n = numFromCountEl(s.countId);
    el.className = 'section-count';
    if (s.severity && n > 0) el.classList.add(s.severity);
    else if (s.severity && n === 0) el.classList.add('clear');

    const sec = document.getElementById(s.id);
    const scroll = sec && sec.querySelector('.section-scroll');
    if (scroll && s.severity) scroll.classList.toggle('is-empty', n === 0);
  });
}

/* ===================== TAB SWITCHING ===================== */
document.getElementById('tabBar').addEventListener('click', (e) => {
  const btn = e.target.closest('.tab-btn');
  if (!btn) return;
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
  btn.classList.add('active');
  const panel = document.getElementById(btn.dataset.tab);
  if (panel) panel.classList.add('active');
});

// Operations badge shows total open breaches so you can see there's work
// waiting without switching tabs.
function updateTabBadges(){
  const el = document.getElementById('tabBadgeOps');
  if (!el) return;
  const matched = issueLeads.filter(l =>
    l.inactiveRmNewLead || l.firstContactBreach || l.followupOverdue ||
    l.underCalledToday || l.stageStuck48h || l.isNotUpdated
  );
  // Distinct customers, not rows — a customer whose two RM copies are each
  // separately flagged still counts once here, same as every other
  // headline count in the dashboard.
  const counts = countUniqueAndCloned(matched);
  el.textContent = counts.unique.toLocaleString();
  // This badge is a tight 10px pill on the tab button itself — no room for
  // an inline "(N cloned)" without breaking the layout, so the detail goes
  // in a hover title instead, same pattern already used elsewhere (e.g.
  // Snapshot now's own tooltip) for space-constrained controls.
  el.title = counts.cloned > 0 ? `${counts.cloned} of these are another RM's copy of a customer already counted` : '';
  el.className = 'tab-badge' + (counts.unique > 0 ? ' urgent' : '');
}

/* ===================== DAILY LEAD VOLUME ===================== */
// Real history, derived from lead_created_at. Deliberately NOT attempting
// SLA-compliance-over-time — that needs stored snapshots, which a browser
// page can't reliably keep (we tried; it didn't persist).
// Shared by renderDailyTrend below and the Morning Brief tab's "leads
// entering, last 24h vs. 7-day average" card — one grouping, two readers.
function computeDailyLeadCounts(){
  const byDay = new Map();
  leads.forEach(l => {
    const d = parseDate(l.lead_created_at);
    if (!d) return;
    // IST calendar day, not UTC — d.toISOString() reads UTC, which put any
    // lead created between 12:00-5:29 AM IST on the WRONG (previous) day
    // here, unlike every other date-bucket in this file.
    const key = istDateKey(d);
    if (!byDay.has(key)) byDay.set(key, { total: 0, totalCollated: 0, oppPlus: 0 });
    const b = byDay.get(key);
    b.total++;
    if (l.collatedFrom > 1) b.totalCollated++;
    if (l.oppOrAbove) b.oppPlus++;
  });
  return byDay;
}

function renderDailyTrend(){
  const el = document.getElementById('trendViz');
  if (!el) return;

  const byDay = computeDailyLeadCounts();
  const days = Array.from(byDay.keys()).sort().slice(-30); // last 30 days present
  document.getElementById('trendCount').textContent = days.length + ' days';

  if (!days.length) {
    el.innerHTML = `<div class="empty-row" style="background:var(--surface); border-radius:8px; border:1px solid var(--border);">No dated leads in the current filters</div>`;
    return;
  }

  const max = Math.max(...days.map(d => byDay.get(d).total));
  // Newest first — the most recent day is what you check first, and it
  // shouldn't require scrolling to the bottom to find.
  el.innerHTML = `<div class="trend-chart">` + days.slice().reverse().map(d => {
    const b = byDay.get(d);
    const w = Math.max(1.5, (b.total / max) * 100);
    const convPct = b.total ? (b.oppPlus / b.total) * 100 : 0;
    // Built straight from the IST key's own digits rather than parsing it
    // back through `new Date()` — that constructor reads the string in the
    // BROWSER's local timezone, which would silently reintroduce the same
    // class of bug istDateKey above just fixed.
    const [, mo, da] = d.split('-');
    const label = `${da} ${IST_MONTHS[Number(mo) - 1]}`;
    const cloneNote = b.totalCollated > 0 ? `, ${b.totalCollated} cloned` : '';
    return `<div class="trend-row" title="${esc(label)}: ${b.total} leads${cloneNote}, ${b.oppPlus} reached Opportunity+">
      <div class="trend-date">${esc(label)}</div>
      <div class="trend-track">
        <div class="trend-fill" style="width:${w}%">
          <div class="trend-fill-conv" style="width:${convPct}%"></div>
        </div>
      </div>
      <div class="trend-nums">${numWithClone(b.total, b.totalCollated)} <span class="conv">· ${b.oppPlus} opp+</span></div>
    </div>`;
  }).join('') + `</div>
  <div class="filter-summary" style="margin-top:8px;">
    <span style="display:inline-block;width:9px;height:9px;background:var(--blue);border-radius:2px;"></span> total created
    &nbsp;&nbsp;<span style="display:inline-block;width:9px;height:9px;background:var(--green);border-radius:2px;"></span> of which reached Opportunity+
  </div>`;
}


/* ===================== RM PERFORMANCE & SLA SCORE ===================== */
// Sorted-array median/p90 — same even-length handling already proven
// correct in Movement's summarizeTimeToRemediate (naive sorted[mid] alone
// overstates an even-length median). p90 uses the nearest-rank method.
// Kept top-level since more than one table needs a real distribution
// figure instead of an average an outlier lead can skew.
function medianOfSorted(sorted){
  if (!sorted.length) return null;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}
function percentileOfSorted(sorted, p){
  if (!sorted.length) return null;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx];
}

// Pulled out of renderRMScoreTable so the Morning Brief tab's RM heat table
// can share the exact same per-RM computation (SLA score, breach-by-check,
// median/p90 contact time) instead of re-deriving it — one definition of
// "SLA score," not two that could quietly drift apart.
function computeRMScoreRows(){
  const byRM = {};
  leads.forEach(l => {
    const key = l.RM || 'Unassigned';
    if (!byRM[key]) byRM[key] = {
      RM: key, TL: l.TL || '', total: 0, totalCollated: 0, open: 0, openCollated: 0, breached: 0,
      calls: 0, durationSec: 0, opp: 0, oppCollated: 0, visit: 0, visitCollated: 0,
      softBooking: 0, softBookingCollated: 0, booking: 0, bookingCollated: 0,
      // Every non-null businessMinsToConnect for this RM's leads (open or
      // closed — first-contact speed is a historical fact, not a live
      // compliance flag, so this deliberately isn't gated on isOpenLead
      // like the breach tally below). Previously this value existed only
      // per-lead (sort/max), with no aggregate anywhere in the app.
      contactMins: [],
      // Tallies which of the 5 checks are actually driving this RM's SLA
      // score down — the aggregate breach count below already existed, but
      // discarded which check(s) each breach came from. A TL/RH staring at
      // a low score has no way to tell "consistently behind on calls" from
      // "one bad stuck lead" without this.
      breachByCheck: { firstContactBreach: 0, followupOverdue: 0, underCalledToday: 0, stageStuck48h: 0, isNotUpdated: 0 },
    };
    const b = byRM[key];
    const cloned = l.collatedFrom > 1;
    b.total++; if (cloned) b.totalCollated++;
    b.calls += l.call_attempts;
    b.durationSec += (Number(l.duration) || 0);
    if (l.businessMinsToConnect != null) b.contactMins.push(l.businessMinsToConnect);

    const stage = canonicalStage(l.current_stage);
    if (l.oppOrAbove) { b.opp++; if (cloned) b.oppCollated++; }
    if (stage === 'visit') { b.visit++; if (cloned) b.visitCollated++; }
    if (isSoftBookingLead(l)) { b.softBooking++; if (cloned) b.softBookingCollated++; }
    if (isBookingLead(l)) { b.booking++; if (cloned) b.bookingCollated++; }

    // SLA score is computed over OPEN leads only — a closed or converted
    // lead can't breach, so counting them would just reward volume.
    if (l.isOpenLead) {
      b.open++; if (cloned) b.openCollated++;
      const breached = l.firstContactBreach || l.followupOverdue ||
        l.underCalledToday || l.stageStuck48h || l.isNotUpdated;
      if (breached) b.breached++;
      if (l.firstContactBreach) b.breachByCheck.firstContactBreach++;
      if (l.followupOverdue) b.breachByCheck.followupOverdue++;
      if (l.underCalledToday) b.breachByCheck.underCalledToday++;
      if (l.stageStuck48h) b.breachByCheck.stageStuck48h++;
      if (l.isNotUpdated) b.breachByCheck.isNotUpdated++;
    }
  });

  return Object.values(byRM).map(b => {
    const slaScore = b.open ? Math.round(((b.open - b.breached) / b.open) * 100) : null;
    const sortedContactMins = b.contactMins.slice().sort((x, y) => x - y);
    return Object.assign({}, b, {
      avgCalls: b.total ? b.calls / b.total : 0,
      avgDurationMin: b.calls ? (b.durationSec / b.calls) / 60 : 0,
      convRate: b.total ? (b.opp / b.total) * 100 : 0,
      medianContactMin: medianOfSorted(sortedContactMins),
      p90ContactMin: percentileOfSorted(sortedContactMins, 90),
      contactSampleSize: sortedContactMins.length,
      slaScore
    });
  }).sort((a, b) => {
    // Worst SLA first — this table exists to find who needs help.
    if (a.slaScore === null) return 1;
    if (b.slaScore === null) return -1;
    return a.slaScore - b.slaScore;
  });
}

function renderRMScoreTable(){
  const rows = computeRMScoreRows();
  document.getElementById('rmScoreCount').textContent = rows.length + ' RMs';
  const table = document.getElementById('rmScoreTable');
  table.querySelector('thead').innerHTML = `<tr>
    <th>RM</th><th>TL</th>
    <th style="text-align:right">Leads</th><th style="text-align:right">Open</th>
    <th style="text-align:right">Attempts</th><th style="text-align:right">Avg Attempts</th>
    <th style="text-align:right">Avg Dur</th>
    <th style="text-align:right" title="Median business-hours minutes from lead_created_at to first connect, across this RM's leads that have connected at all (open or closed) — hover a value for the p90. Preferred over an average, which one very late lead can skew.">Median 1st Contact</th>
    <th style="text-align:right">Opp+</th><th style="text-align:right">Visits</th><th style="text-align:right" title="Payment received, paperwork pending">Soft Bk</th><th style="text-align:right">Bookings</th>
    <th style="text-align:right">Conv %</th><th style="text-align:right">SLA Score</th></tr>`;

  const tbody = table.querySelector('tbody');
  if (!rows.length){
    tbody.innerHTML = `<tr><td colspan="14" class="empty-row">No RM data</td></tr>`;
    return;
  }
  const BREACH_LABELS = {
    firstContactBreach: 'Not Connected in 10 min', followupOverdue: 'Follow-up Overdue',
    underCalledToday: "Behind on Today's Calls", stageStuck48h: 'Stuck 48h+', isNotUpdated: 'Not Updated',
  };
  tbody.innerHTML = rows.map(b => {
    const sla = b.slaScore;
    const slaCls = sla === null ? 'heat-green' : sla >= 80 ? 'heat-green' : sla >= 50 ? 'heat-amber' : 'heat-red';
    const slaTxt = sla === null ? 'n/a' : sla + '%';
    const breachParts = Object.entries(b.breachByCheck).filter(([, n]) => n > 0).map(([k, n]) => `${BREACH_LABELS[k]}: ${n}`);
    const slaCell = sla === null
      ? `<span class="heat-cell ${slaCls}">${slaTxt}</span>`
      : `<span class="cell-hint"><span class="heat-cell ${slaCls}">${slaTxt}</span><span class="cell-hint-panel">${breachParts.length ? breachParts.join('<br>') : 'No open-lead breaches'}</span></span>`;
    const contactCell = b.medianContactMin == null
      ? `<span class="dim">—</span>`
      : `<span class="cell-hint">${b.medianContactMin.toFixed(0)}m<span class="cell-hint-panel">p90: ${b.p90ContactMin.toFixed(0)}m<br>n = ${b.contactSampleSize} connected lead${b.contactSampleSize === 1 ? '' : 's'}</span></span>`;
    return `<tr>
      <td>${esc(b.RM)}</td><td class="dim">${esc(b.TL)}</td>
      <td class="num">${numWithClone(b.total, b.totalCollated)}</td><td class="num dim">${numWithClone(b.open, b.openCollated)}</td>
      <td class="num dim">${b.calls}</td><td class="num">${b.avgCalls.toFixed(1)}</td>
      <td class="num dim">${b.avgDurationMin ? b.avgDurationMin.toFixed(1)+'m' : '—'}</td>
      <td class="num">${contactCell}</td>
      <td class="num" style="color:var(--green)">${numWithClone(b.opp, b.oppCollated)}</td>
      <td class="num">${numWithClone(b.visit, b.visitCollated)}</td>
      <td class="num" style="color:var(--amber)" title="Payment received, paperwork pending">${numWithClone(b.softBooking, b.softBookingCollated)}</td>
      <td class="num" style="color:var(--green)">${numWithClone(b.booking, b.bookingCollated)}</td>
      <td class="num">${b.convRate.toFixed(1)}%</td>
      <td class="num">${slaCell}</td>
    </tr>`;
  }).join('');
}

/* ===================== LEAD FAN-OUT & CLAIM RATE ===================== */
// Answers "how are leads actually divided?" — the distribution question
// this project began with. Uses collation-time data, so it reflects the
// whole sheet rather than the currently filtered view.
function renderFanout(){
  const el = document.getElementById('fanoutViz');
  if (!el) return;

  // Derived from the CURRENT filtered set, not a precomputed whole-sheet
  // snapshot — otherwise this section keeps reporting all 7.5k customers
  // while the filter summary directly above says "Showing 340".
  // Fan-out is counted by lead_id: each collated lead_id is one copy that
  // was routed out, and every RM holding a copy "received" that customer
  // while only the record's own RM (the primary) claimed it.
  const histogram = {};
  const claimStats = {};
  leads.forEach(l => {
    const copies = (l.collatedLeadIds && l.collatedLeadIds.length) || l.collatedFrom || 1;
    histogram[copies] = (histogram[copies] || 0) + 1;

    const rms = (l.collatedRMs && l.collatedRMs.length) ? l.collatedRMs : [l.RM || 'Unassigned'];
    const claimer = l.RM || 'Unassigned';
    rms.forEach(rm => {
      if (!claimStats[rm]) claimStats[rm] = { received: 0, claimed: 0 };
      claimStats[rm].received++;
      if (rm === claimer) claimStats[rm].claimed++;
    });
  });

  const keys = Object.keys(histogram).map(Number).sort((a,b) => a-b);
  const totalCustomers = keys.reduce((s,k) => s + histogram[k], 0);
  const totalRows = keys.reduce((s,k) => s + histogram[k] * k, 0);
  document.getElementById('fanoutCount').textContent = totalCustomers.toLocaleString() + ' customers';

  if (!totalCustomers) {
    el.innerHTML = `<div class="empty-row" style="background:var(--surface); border-radius:8px; border:1px solid var(--border);">No leads match the current filters</div>`;
    document.getElementById('fanoutSummary').textContent = '';
    document.getElementById('claimTable').querySelector('tbody').innerHTML = '';
    return;
  }

  const multi = keys.filter(k => k > 1).reduce((s,k) => s + histogram[k], 0);
  const avg = totalRows / totalCustomers;
  const maxFan = keys[keys.length - 1];
  document.getElementById('fanoutSummary').innerHTML =
    `${totalRows.toLocaleString()} lead IDs across ${totalCustomers.toLocaleString()} customers (current filters) · `
    + `<b>${multi.toLocaleString()}</b> (${(multi/totalCustomers*100).toFixed(1)}%) were routed to more than one RM · `
    + `average <b>${avg.toFixed(2)}</b> copies each · widest fan-out <b>${maxFan}</b> RMs on one customer.`;

  const maxCount = Math.max(...keys.map(k => histogram[k]));
  el.innerHTML = `<div class="trend-chart" style="max-height:none;">` + keys.map(k => {
    const c = histogram[k];
    const w = Math.max(1.5, (c / maxCount) * 100);
    return `<div class="trend-row" title="${c} customers were routed to ${k} RM${k===1?'':'s'}">
      <div class="trend-date">${k} RM${k === 1 ? '' : 's'}</div>
      <div class="trend-track"><div class="trend-fill" style="width:${w}%"></div></div>
      <div class="trend-nums">${c.toLocaleString()} <span class="dim">· ${(c/totalCustomers*100).toFixed(1)}%</span></div>
    </div>`;
  }).join('') + `</div>`;

  // Claim rate per RM
  const rows = Object.keys(claimStats).map(rm => {
    const st = claimStats[rm];
    return { rm, received: st.received, claimed: st.claimed, rate: st.received ? (st.claimed/st.received)*100 : 0 };
  }).filter(r => r.received > 0)
    .sort((a,b) => a.rate - b.rate || b.received - a.received); // worst claim rate first

  const table = document.getElementById('claimTable');
  table.querySelector('thead').innerHTML = `<tr>
    <th>RM</th><th style="text-align:right">Copies Received</th>
    <th style="text-align:right">Claimed</th><th style="min-width:120px">Claim Rate</th>
    <th style="text-align:right">%</th></tr>`;
  const tbody = table.querySelector('tbody');
  if (!rows.length){ tbody.innerHTML = `<tr><td colspan="5" class="empty-row">No claim data</td></tr>`; return; }

  const CAP = 200;
  tbody.innerHTML = rows.slice(0, CAP).map(r => {
    const cls = r.rate >= 60 ? 'heat-green' : r.rate >= 30 ? 'heat-amber' : 'heat-red';
    return `<tr>
      <td>${esc(r.rm)}</td>
      <td class="num">${r.received.toLocaleString()}</td>
      <td class="num">${r.claimed.toLocaleString()}</td>
      <td><div class="bar-cell"><div class="bar-track"><div class="bar-fill" style="width:${r.rate.toFixed(0)}%"></div></div></div></td>
      <td class="num"><span class="heat-cell ${cls}">${r.rate.toFixed(0)}%</span></td>
    </tr>`;
  }).join('')
  + (rows.length > CAP ? `<tr><td colspan="5" class="empty-row" style="padding:10px;">Showing first ${CAP} of ${rows.length}</td></tr>` : '');
}

/* ===================== WORKLOAD BALANCE ===================== */
function renderWorkloadBalance(){
  const byRM = {};
  leads.forEach(l => {
    if (!l.isOpenLead) return; // balance is about live workload, not history
    const key = l.RM || 'Unassigned';
    if (!byRM[key]) byRM[key] = { n: 0, collated: 0 };
    byRM[key].n++;
    if (l.collatedFrom > 1) byRM[key].collated++;
  });

  const entries = Object.entries(byRM).sort((a, b) => b[1].n - a[1].n);
  const counts = entries.map(e => e[1].n);
  const total = counts.reduce((s, n) => s + n, 0);
  const avg = counts.length ? total / counts.length : 0;

  document.getElementById('balanceCount').textContent = entries.length + ' RMs';
  const summary = document.getElementById('balanceSummary');

  if (!entries.length) {
    summary.textContent = '';
    document.getElementById('balanceTable').querySelector('tbody').innerHTML =
      `<tr><td colspan="4" class="empty-row">No open leads in the current filters</td></tr>`;
    document.getElementById('balanceTable').querySelector('thead').innerHTML = '';
    return;
  }

  const overloaded = entries.filter(([, e]) => e.n > avg * 1.25).length;
  const under = entries.filter(([, e]) => e.n < avg * 0.75).length;
  summary.innerHTML = `${total.toLocaleString()} open leads across ${entries.length} RMs · average <b>${avg.toFixed(1)}</b> each · `
    + `<b style="color:var(--red)">${overloaded}</b> carrying 25%+ above average · `
    + `<b style="color:var(--amber)">${under}</b> carrying 25%+ below.`
    + `<br><span class="dim">Counts OPEN leads only — closed and Opportunity+ leads are excluded, since balance is about live workload. `
    + `For every lead ever assigned, see the Total column in People → RM Workload.</span>`;

  const max = counts[0];
  const table = document.getElementById('balanceTable');
  table.querySelector('thead').innerHTML = `<tr>
    <th>RM</th><th style="min-width:160px">Open Leads</th>
    <th style="text-align:right">Count</th><th style="text-align:right">vs Average</th></tr>`;
  table.querySelector('tbody').innerHTML = entries.map(([rm, e]) => {
    const n = e.n;
    const pct = Math.round((n / max) * 100);
    const delta = avg ? ((n - avg) / avg) * 100 : 0;
    const cls = delta > 25 ? 'heat-red' : delta < -25 ? 'heat-amber' : 'heat-green';
    return `<tr>
      <td>${esc(rm)}</td>
      <td><div class="bar-cell"><div class="bar-track"><div class="bar-fill" style="width:${pct}%"></div></div></div></td>
      <td class="num">${numWithClone(n, e.collated)}</td>
      <td class="num"><span class="heat-cell ${cls}">${delta >= 0 ? '+' : ''}${delta.toFixed(0)}%</span></td>
    </tr>`;
  }).join('');
}

/* ===================== REGION → TL → RM ALLOCATION ===================== */
function renderAllocationMatrix(){
  const rows = {};
  leads.forEach(l => {
    const key = [l.region || 'Unassigned', l.TL || 'Unassigned', l.RM || 'Unassigned'].join('||');
    if (!rows[key]) rows[key] = {
      region: l.region || 'Unassigned', TL: l.TL || 'Unassigned', RM: l.RM || 'Unassigned',
      total: 0, totalCollated: 0, calls: 0, ageSum: 0, aged: 0,
      opp: 0, oppCollated: 0, visit: 0, visitCollated: 0,
      softBooking: 0, softBookingCollated: 0, booking: 0, bookingCollated: 0
    };
    const b = rows[key];
    const cloned = l.collatedFrom > 1;
    b.total++; if (cloned) b.totalCollated++;
    b.calls += l.call_attempts;
    if (l.ageHours != null) { b.ageSum += l.ageHours; b.aged++; }
    const stage = canonicalStage(l.current_stage);
    if (l.oppOrAbove) { b.opp++; if (cloned) b.oppCollated++; }
    if (stage === 'visit') { b.visit++; if (cloned) b.visitCollated++; }
    if (isSoftBookingLead(l)) { b.softBooking++; if (cloned) b.softBookingCollated++; }
    if (isBookingLead(l)) { b.booking++; if (cloned) b.bookingCollated++; }
  });

  const list = Object.values(rows).sort((a, b) =>
    a.region.localeCompare(b.region) || a.TL.localeCompare(b.TL) || b.total - a.total);

  document.getElementById('matrixCount').textContent = list.length + ' rows';
  const table = document.getElementById('matrixTable');
  table.querySelector('thead').innerHTML = `<tr>
    <th>Region</th><th>TL</th><th>RM</th>
    <th style="text-align:right">Leads</th><th style="text-align:right">Avg Attempts</th>
    <th style="text-align:right">Avg Age</th>
    <th style="text-align:right">Opp+</th><th style="text-align:right">Visits</th><th style="text-align:right" title="Payment received, paperwork pending">Soft Bk</th><th style="text-align:right">Bookings</th></tr>`;

  const tbody = table.querySelector('tbody');
  if (!list.length){
    tbody.innerHTML = `<tr><td colspan="10" class="empty-row">No allocation data</td></tr>`;
    return;
  }
  const CAP = 300;
  tbody.innerHTML = list.slice(0, CAP).map(b => `<tr>
    <td>${esc(b.region)}</td><td class="dim">${esc(b.TL)}</td><td>${esc(b.RM)}</td>
    <td class="num">${numWithClone(b.total, b.totalCollated)}</td>
    <td class="num dim">${(b.total ? b.calls / b.total : 0).toFixed(1)}</td>
    <td class="num dim">${b.aged ? (b.ageSum / b.aged).toFixed(0) + 'h' : '—'}</td>
    <td class="num" style="color:var(--green)">${numWithClone(b.opp, b.oppCollated)}</td>
    <td class="num">${numWithClone(b.visit, b.visitCollated)}</td>
    <td class="num" style="color:var(--amber)" title="Payment received, paperwork pending">${numWithClone(b.softBooking, b.softBookingCollated)}</td>
    <td class="num" style="color:var(--green)">${numWithClone(b.booking, b.bookingCollated)}</td>
  </tr>`).join('')
  + (list.length > CAP ? `<tr><td colspan="10" class="empty-row" style="padding:10px;">Showing first ${CAP} of ${list.length.toLocaleString()} rows</td></tr>` : '');
}

/* ===================== SOURCE MIX BY REGION ===================== */
function renderSourceMix(){
  const sources = Array.from(new Set(leads.map(l => String(l.group_source).trim() || '(blank)'))).sort();
  const byRegion = {};
  leads.forEach(l => {
    const r = l.region || 'Unassigned';
    const s = String(l.group_source).trim() || '(blank)';
    if (!byRegion[r]) byRegion[r] = { region: r, total: 0, totalCollated: 0, counts: {}, countsCollated: {} };
    const cloned = l.collatedFrom > 1;
    byRegion[r].total++; if (cloned) byRegion[r].totalCollated++;
    byRegion[r].counts[s] = (byRegion[r].counts[s] || 0) + 1;
    if (cloned) byRegion[r].countsCollated[s] = (byRegion[r].countsCollated[s] || 0) + 1;
  });

  const list = Object.values(byRegion).sort((a, b) => b.total - a.total);
  const table = document.getElementById('sourceMixTable');
  if (!list.length || !sources.length){
    table.querySelector('thead').innerHTML = '';
    table.querySelector('tbody').innerHTML = `<tr><td class="empty-row">No source data</td></tr>`;
    return;
  }

  table.querySelector('thead').innerHTML = `<tr><th>Region</th>`
    + sources.map(s => `<th style="text-align:right">${esc(s)}</th>`).join('')
    + `<th style="text-align:right">Total</th></tr>`;

  table.querySelector('tbody').innerHTML = list.map(b => `<tr>
    <td>${esc(b.region)}</td>`
    + sources.map(s => {
        const n = b.counts[s] || 0;
        const collated = b.countsCollated[s] || 0;
        const pct = b.total ? Math.round((n / b.total) * 100) : 0;
        const title = collated > 0 ? ` title="${n} (${collated} cloned)"` : '';
        return `<td class="num ${n ? '' : 'dim'}"${title}>${n}${n ? ` <span class="dim" style="font-size:10px">${pct}%</span>` : ''}</td>`;
      }).join('')
    + `<td class="num" style="font-weight:600">${numWithClone(b.total, b.totalCollated)}</td></tr>`).join('');
}

function renderFunnel(){
  const el = document.getElementById('funnelViz');
  const stages = CONFIG.FUNNEL_ORDER; // not updated → suspect → opportunity → visit booked → visit → pipeline → gross eoi application → soft booking → booking
  const oppIdx = stages.indexOf(CONFIG.OPPORTUNITY_STAGE);

  const stageCountsLower = {};
  // Parallel to stageCountsLower, tracked separately rather than folded
  // into it — every width/percentage calculation below reads
  // stageCountsLower[s] as a bare number, and turning that into {n,
  // collated} would mean touching every one of those reads. A bar this
  // narrow (down to a 4% floor) has no room for an inline "(N cloned)"
  // anyway, so it surfaces as a hover title on the row instead.
  const stageCollated = {};
  stages.forEach(s => { stageCountsLower[s] = 0; stageCollated[s] = 0; });
  leads.forEach(l => {
    // Bookings first: a booking closed as "Won" has a stage canonicalStage
    // can't read, and would otherwise fall out of the funnel entirely.
    // Soft booking checked before booking — its text contains "booking".
    const isCollated = (l.collatedFrom || 1) > 1;
    if (isSoftBookingLead(l)) { stageCountsLower['soft booking']++; if (isCollated) stageCollated['soft booking']++; return; }
    if (isBookingLead(l)) { stageCountsLower['booking']++; if (isCollated) stageCollated['booking']++; return; }
    const canon = canonicalStage(l.current_stage);
    if (canon) { stageCountsLower[canon]++; if (isCollated) stageCollated[canon]++; }
  });

  const total = leads.length || 1;
  const maxCount = Math.max(1, ...stages.map(s => stageCountsLower[s]));

  let prevCount = null;
  el.innerHTML = stages.map((s, i) => {
    const count = stageCountsLower[s];
    const pctOfTotal = ((count / total) * 100).toFixed(1);
    const widthPct = Math.max(4, Math.round((count / maxCount) * 100));
    // A band holding 3 leads next to one holding 4,000 renders at the 4%
    // floor — roughly 30px, most of which is padding. The count printed
    // INSIDE that bar gets clipped by the track's overflow:hidden and the
    // band reads as empty. Below 12% the number moves outside the bar.
    const labelOutside = widthPct < 12;
    const conv = (prevCount != null && prevCount > 0) ? ((count / prevCount) * 100).toFixed(1) + '% conv. from prev' : '';
    prevCount = count;
    const label = s.replace(/\b\w/g, c => c.toUpperCase());
    const rowTitle = stageCollated[s] > 0 ? ` title="${count} leads (${stageCollated[s]} collated from multiple RM copies)"` : '';
    return `<div class="funnel-row"${rowTitle}>
      <div class="funnel-label">${esc(label)}</div>
      <div class="funnel-bar-track"><div class="funnel-bar-fill${i >= oppIdx ? ' opp-stage' : ''}" style="width:${widthPct}%">${labelOutside ? '' : `<span class="funnel-fill-label">${count}</span>`}</div>${labelOutside ? `<span class="funnel-outside-label">${count}</span>` : ''}</div>
      <div class="funnel-nums">${pctOfTotal}% of total<div class="funnel-conv">${conv}</div></div>
    </div>`;
  }).join('');

  // The bands only ever hold leads still IN the funnel. Closed leads
  // ("Closed", "Won", "Junk"...) have left it and match no band, so without
  // this row the chart quietly accounts for less than the total and the
  // percentages stop summing to 100 with nothing explaining the shortfall.
  const inFunnel = stages.reduce((sum, s) => sum + stageCountsLower[s], 0);
  const exited = leads.length - inFunnel;
  if (exited > 0) {
    const inFunnelCollated = stages.reduce((sum, s) => sum + stageCollated[s], 0);
    const exitedCollated = countCollatedAmong(leads).collated - inFunnelCollated;
    const exitedTitle = exitedCollated > 0 ? ` title="${exited} leads (${exitedCollated} collated from multiple RM copies)"` : '';
    el.innerHTML += `<div class="funnel-row" style="margin-top:14px; padding-top:12px; border-top:1px dashed var(--border);"${exitedTitle}>
      <div class="funnel-label">Exited</div>
      <div class="funnel-bar-track" style="background:transparent; border-style:dashed;">
        <div class="funnel-bar-fill" style="width:${Math.max(4, Math.round((exited / maxCount) * 100))}%; background:var(--surface-2);"></div>
        <span class="funnel-outside-label">${exited.toLocaleString()}</span>
      </div>
      <div class="funnel-nums">${((exited / total) * 100).toFixed(1)}% of total<div class="funnel-conv">closed — left the funnel</div></div>
    </div>`;
  }
}

function renderRegionTable(){
  const byRegion = {};
  leads.forEach(l => {
    // region_parent was removed from the export, so region alone is the key.
    const key = l.region;
    if (!byRegion[key]) byRegion[key] = { region:l.region, group: mainRegionFor(effectiveRegion(l)) || '—', tls: new Set(), total:0, totalCollated:0, oppPlus:0, oppPlusCollated:0, critical:0, criticalCollated:0, notConn:0, notConnCollated:0, noCalls:0, noCallsCollated:0 };
    const b = byRegion[key];
    const isCollated = (l.collatedFrom || 1) > 1;
    b.tls.add(l.TL || 'Unassigned');
    b.total++;
    if (isCollated) b.totalCollated++;
    if (l.oppOrAbove) { b.oppPlus++; if (isCollated) b.oppPlusCollated++; }
    if (l.underCalledToday) { b.critical++; if (isCollated) b.criticalCollated++; }
    if (l.firstContactBreach) { b.notConn++; if (isCollated) b.notConnCollated++; }
    // isOpenLead gate matches the "No Attempts Yet" KPI card. Without it this
    // column counted closed and Opportunity+ leads too, so the column summed
    // higher than the KPI showing the same thing under the same filters.
    if (l.isOpenLead && l.call_attempts === 0) { b.noCalls++; if (isCollated) b.noCallsCollated++; }
  });

  const table = document.getElementById('regionTable');
  table.querySelector('thead').innerHTML = `<tr>
    <th>Region</th><th>Reports as</th><th style="text-align:right">Total</th>
    <th style="text-align:right">Opp+</th><th style="text-align:right" title="Leads failing today's call-effort check: fewer than 5 calls made today (any lead age — see Operations → Behind on Today's Calls). Does not include the 10-minute, follow-up, Not Updated or Stuck checks.">Call SLA</th>
    <th style="text-align:right">Critical %</th>
    <th style="text-align:right">Not Conn. 10m</th><th style="text-align:right">No Attempts</th></tr>`;

  const rows = Object.values(byRegion).sort((a,b)=> b.total - a.total);
  const tbody = table.querySelector('tbody');
  if (!rows.length){
    tbody.innerHTML = `<tr><td colspan="8" class="empty-row">No leads match the current filters</td></tr>`;
    return;
  }
  tbody.innerHTML = rows.map(b => {
    const pct = b.total ? Math.round((b.critical / b.total) * 100) : 0;
    const heatCls = pct >= 50 ? 'heat-red' : pct >= 20 ? 'heat-amber' : 'heat-green';
    const tlList = Array.from(b.tls).sort();
    return `<tr>
    <td><span class="cell-hint">${esc(b.region)}<span class="cell-hint-panel">TL${tlList.length === 1 ? '' : 's'}: ${esc(tlList.join(', '))}</span></span></td><td class="dim">${esc(b.group)}</td>
    <td class="num">${numWithClone(b.total, b.totalCollated)}</td><td class="num" style="color:var(--green)">${numWithClone(b.oppPlus, b.oppPlusCollated)}</td>
    <td class="num" style="color:${b.critical?'var(--red)':'inherit'}">${numWithClone(b.critical, b.criticalCollated)}</td>
    <td class="num"><span class="heat-cell ${heatCls}">${pct}%</span></td>
    <td class="num" style="color:${b.notConn?'var(--amber)':'inherit'}">${numWithClone(b.notConn, b.notConnCollated)}</td>
    <td class="num dim">${numWithClone(b.noCalls, b.noCallsCollated)}</td>
  </tr>`;
  }).join('');
}

function renderTLTable(){
  const byTL = {};
  leads.forEach(l => {
    const key = l.TL || 'Unassigned';
    if (!byTL[key]) byTL[key] = { TL: key, rms: new Set(), total:0, totalCollated:0, oppPlus:0, oppPlusCollated:0, critical:0, criticalCollated:0, calls:0 };
    const b = byTL[key];
    b.rms.add(l.RM);
    b.total++;
    if (l.collatedFrom > 1) b.totalCollated++;
    if (l.oppOrAbove) { b.oppPlus++; if (l.collatedFrom > 1) b.oppPlusCollated++; }
    if (l.underCalledToday) { b.critical++; if (l.collatedFrom > 1) b.criticalCollated++; }
    b.calls += l.call_attempts;
  });
  const rows = Object.values(byTL).sort((a,b)=> b.total - a.total);
  document.getElementById('tlCount').textContent = rows.length + ' TLs';

  const table = document.getElementById('tlTable');
  table.querySelector('thead').innerHTML = `<tr>
    <th>TL</th><th style="text-align:right">RMs</th><th style="text-align:right">Total Leads</th>
    <th style="text-align:right">Opp+</th><th style="text-align:right" title="Leads failing today's call-effort check: fewer than 5 calls made today (any lead age — see Operations → Behind on Today's Calls). Does not include the 10-minute, follow-up, Not Updated or Stuck checks.">Call SLA</th>
    <th style="text-align:right">Avg Attempts</th></tr>`;
  const tbody = table.querySelector('tbody');
  if (!rows.length){
    tbody.innerHTML = `<tr><td colspan="6" class="empty-row">No TL data</td></tr>`;
    return;
  }
  tbody.innerHTML = rows.map(b => {
    const avg = b.total ? (b.calls / b.total) : 0;
    return `<tr>
      <td>${esc(b.TL)}</td><td class="num dim">${b.rms.size}</td>
      <td class="num">${numWithClone(b.total, b.totalCollated)}</td><td class="num" style="color:var(--green)">${numWithClone(b.oppPlus, b.oppPlusCollated)}</td>
      <td class="num" style="color:${b.critical?'var(--red)':'inherit'}">${numWithClone(b.critical, b.criticalCollated)}</td>
      <td class="num dim">${avg.toFixed(1)}</td>
    </tr>`;
  }).join('');
}

function renderProjectTable(){
  const byProject = {};
  leads.forEach(l => {
    const key = l.project || 'Unassigned';
    if (!byProject[key]) byProject[key] = { project: key, total:0, totalCollated:0, oppPlus:0, oppPlusCollated:0, critical:0, criticalCollated:0, softBooking:0, softBookingCollated:0, booking:0, bookingCollated:0 };
    const b = byProject[key];
    const cloned = l.collatedFrom > 1;
    b.total++; if (cloned) b.totalCollated++;
    if (l.oppOrAbove) { b.oppPlus++; if (cloned) b.oppPlusCollated++; }
    if (l.underCalledToday) { b.critical++; if (cloned) b.criticalCollated++; }
    if (isSoftBookingLead(l)) { b.softBooking++; if (cloned) b.softBookingCollated++; }
    if (isBookingLead(l)) { b.booking++; if (cloned) b.bookingCollated++; }
  });
  const rows = Object.values(byProject).sort((a,b)=> b.total - a.total);
  document.getElementById('projectCount').textContent = rows.length + ' projects';

  const table = document.getElementById('projectTable');
  table.querySelector('thead').innerHTML = `<tr>
    <th>Project</th><th style="text-align:right">Leads</th>
    <th style="text-align:right">Opp+</th><th style="text-align:right">Opp %</th>
    <th style="text-align:right" title="Leads failing today's call-effort check: fewer than 5 calls made today (any lead age — see Operations → Behind on Today's Calls). Does not include the 10-minute, follow-up, Not Updated or Stuck checks.">Call SLA</th>
    <th style="text-align:right" title="Payment received, paperwork pending">Soft Bk</th><th style="text-align:right">Booking</th></tr>`;
  const tbody = table.querySelector('tbody');
  if (!rows.length){
    tbody.innerHTML = `<tr><td colspan="7" class="empty-row">No project data</td></tr>`;
    return;
  }
  const MAX_PROJECT_ROWS = 100;
  tbody.innerHTML = rows.slice(0, MAX_PROJECT_ROWS).map(b => {
    const oppPct = b.total ? (b.oppPlus / b.total) * 100 : 0;
    // Heat thresholds are relative to typical conversion here — a project
    // converting under 5% is worth questioning, over 15% is doing well.
    const cls = oppPct >= 15 ? 'heat-green' : oppPct >= 5 ? 'heat-amber' : 'heat-red';
    return `<tr>
    <td>${esc(b.project)}</td><td class="num">${numWithClone(b.total, b.totalCollated)}</td>
    <td class="num" style="color:var(--green)">${numWithClone(b.oppPlus, b.oppPlusCollated)}</td>
    <td class="num"><span class="heat-cell ${cls}">${oppPct.toFixed(1)}%</span></td>
    <td class="num" style="color:${b.critical?'var(--red)':'inherit'}">${numWithClone(b.critical, b.criticalCollated)}</td>
    <td class="num" style="color:var(--amber)" title="Payment received, paperwork pending">${numWithClone(b.softBooking, b.softBookingCollated)}</td>
    <td class="num" style="color:var(--green)">${numWithClone(b.booking, b.bookingCollated)}</td>
  </tr>`;
  }).join('')
  + (rows.length > MAX_PROJECT_ROWS
      ? `<tr><td colspan="7" class="empty-row" style="padding:10px;">Showing first ${MAX_PROJECT_ROWS} of ${rows.length.toLocaleString()} projects</td></tr>`
      : '');
}

function renderRMTable(){
  const byRM = {};
  let multiAgentTotal = 0;
  leads.forEach(l => {
    // Key on the same 'Unassigned' fallback Workload Balance uses. Keying on
    // a raw blank RM put those leads under an empty-string row here while
    // Workload Balance filed them under "Unassigned" — the two tables then
    // disagreed on the RM list as well as the counts.
    const key = l.RM || 'Unassigned';
    if (!byRM[key]) byRM[key] = { RM:key, region:l.region, total:0, totalCollated:0, open:0, openCollated:0, oppPlus:0, oppPlusCollated:0, critical:0, criticalCollated:0, calls:0, multiAgent:0, multiAgentCollated:0 };
    const b = byRM[key];
    const cloned = l.collatedFrom > 1;
    b.total++; if (cloned) b.totalCollated++;
    // Counted so this table reconciles with Distribution → Workload Balance,
    // which shows OPEN leads only. Without it the same RM appears with two
    // different lead counts across two tabs and neither explains why.
    if (l.isOpenLead) { b.open++; if (cloned) b.openCollated++; }
    if (l.oppOrAbove) { b.oppPlus++; if (cloned) b.oppPlusCollated++; }
    if (l.underCalledToday) { b.critical++; if (cloned) b.criticalCollated++; }
    if (l.isMultiAgent) { b.multiAgent++; multiAgentTotal++; if (cloned) b.multiAgentCollated++; }
    b.calls += l.call_attempts;
  });
  const rows = Object.values(byRM).sort((a,b)=> b.total - a.total);
  const maxTotal = Math.max(1, ...rows.map(r=>r.total));

  document.getElementById('rmCount').textContent = rows.length + ' RMs';

  const summaryEl = document.getElementById('rmMultiAgentSummary');
  if (summaryEl) {
    const pct = leads.length ? Math.round((multiAgentTotal / leads.length) * 100) : 0;
    const openTotal = rows.reduce((s, r) => s + r.open, 0);
    summaryEl.innerHTML = leads.length
      ? `<b>Total</b> counts every lead ever assigned (including closed and Opportunity+); <b>Open</b> counts only live ones — `
        + `${openTotal.toLocaleString()} of ${leads.length.toLocaleString()}. Distribution → Workload Balance ranks by the Open figure. · `
        + `${multiAgentTotal} of ${leads.length} leads (${pct}%) have been handled by more than one agent, based on names logged in internal_status_comments/stage_comments.`
      : '';
  }

  const table = document.getElementById('rmTable');
  table.querySelector('thead').innerHTML = `<tr>
    <th>RM</th><th>Region</th><th style="min-width:140px">Workload</th>
    <th style="text-align:right">Total</th><th style="text-align:right">Open</th>
    <th style="text-align:right">Opp+</th>
    <th style="text-align:right" title="Leads failing today's call-effort check: fewer than 5 calls made today (any lead age — see Operations → Behind on Today's Calls). Does not include the 10-minute, follow-up, Not Updated or Stuck checks.">Call SLA</th><th style="text-align:right">Multi-Agent</th>
    <th style="text-align:right">Avg Attempts</th></tr>`;
  const tbody = table.querySelector('tbody');
  if (!rows.length){
    tbody.innerHTML = `<tr><td colspan="9" class="empty-row">No RM data</td></tr>`;
    return;
  }
  tbody.innerHTML = rows.map(b => {
    const avg = b.total ? (b.calls / b.total) : 0;
    const pct = Math.round((b.total / maxTotal) * 100);
    return `<tr>
      <td>${esc(b.RM)}</td><td class="dim">${esc(b.region)}</td>
      <td><div class="bar-cell"><div class="bar-track"><div class="bar-fill" style="width:${pct}%"></div></div></div></td>
      <td class="num">${numWithClone(b.total, b.totalCollated)}</td><td class="num">${numWithClone(b.open, b.openCollated)}</td>
      <td class="num" style="color:var(--green)">${numWithClone(b.oppPlus, b.oppPlusCollated)}</td>
      <td class="num" style="color:${b.critical?'var(--red)':'inherit'}">${numWithClone(b.critical, b.criticalCollated)}</td>
      <td class="num" style="color:${b.multiAgent?'var(--amber)':'inherit'}">${numWithClone(b.multiAgent, b.multiAgentCollated)}</td>
      <td class="num dim">${avg.toFixed(1)}</td>
    </tr>`;
  }).join('');
}


// Direct check #1: created today (calendar day), under 5 calls, open
// (not closed, not Opportunity+). Starts from isOpenLead as the foundation
// — a closed or Opportunity+ lead can never appear here. Covers every open
// lead regardless of creation date: attemptsToday is call_attempts for a
// lead created today (an exact reading) and CRM-log entries dated today for
// an older lead (a proxy — the export has no true per-day counter). Custom
// card markup rather than renderAlertCard because it must show
// attemptsToday, not the lifetime call_attempts total, for older leads.
function renderDueTodayList(){
  // Ordered by creation date, newest first — today's leads lead the list,
  // then progressively older ones. A fresh lead sitting uncalled is the
  // most urgent; ageHours is used rather than re-parsing lead_created_at
  // since every lead here was already measured against the same _renderNow.
  const group = groupSiblingsTogether(
    issueLeads.filter(l => l.isOpenLead && l.underCalledToday),
    (a,b) => a.ageHours - b.ageHours
  );

  // underCalledToday itself is deliberately not age-gated (call effort is
  // tracked for an open lead at any age) — but a 0–48h operating view needs
  // its own honest number, not one silently blended with leads long past
  // their 48h outcome. Split here, at render time, rather than touching the
  // flag itself, which other surfaces (People's Call SLA column, region
  // reports) intentionally keep age-unbounded.
  const under48 = group.filter(l => l.isUnder48h);
  const over48 = group.filter(l => !l.isUnder48h);

  document.getElementById('dueTodayCount').textContent = uniqueCloneLabel(countUniqueAndCloned(under48), 'lead');
  const el = document.getElementById('dueTodayList');
  if (!group.length) {
    el.innerHTML = `<div class="empty-row" style="background:var(--surface); border-radius:8px; border:1px solid var(--border);">Nothing is behind on today's calls</div>`;
    return;
  }

  const cardHtml = (l, idx, prefix) => {
    const logId = prefix + '_' + idx;
    return `<div class="alert-card amber-left">
      <div class="alert-id">${leadIdentityLine(l)}</div>
      <div class="alert-age mono">created ${esc(isoStampIST(l.lead_created_at))}</div>
      <div class="alert-meta">${esc(l.region)} · ${esc(l.project)} · ${esc(l.current_stage)} — ${l.isCreatedToday ? '<span class="chip red">New today</span> ' : ''}<span class="chip amber">${l.attemptsToday}/${CONFIG.MIN_CALLS_PER_DAY} attempts today</span></div>
      ${l.last_comment ? `<div class="alert-comment">"${esc(l.last_comment)}"</div>` : ''}
      ${logToggleMarkup(l, logId)}
    </div>`;
  };

  const under48Html = under48.length
    ? truncationNotice(under48.length, MAX_CARDS) + under48.slice(0, MAX_CARDS).map((l, idx) => cardHtml(l, idx, 'today')).join('')
    : `<div class="empty-row" style="background:var(--surface); border-radius:8px; border:1px solid var(--border);">Nothing in the 0–48h window is behind on today's calls</div>`;

  const over48Html = over48.length
    ? `<div class="stall-group-label" style="color:var(--text-faint); margin:18px 0 8px;">Past 48h, still under-called today — ${uniqueCloneLabel(countUniqueAndCloned(over48), 'lead')} (tracked separately from the 0–48h window above)</div>`
      + truncationNotice(over48.length, MAX_CARDS) + over48.slice(0, MAX_CARDS).map((l, idx) => cardHtml(l, idx, 'todayold')).join('')
    : '';

  el.innerHTML = under48Html + over48Html;
}

// Early-warning tier: open leads at 36–48h, not yet Opportunity — a preview
// of who's about to join the Stuck list below, so action can happen BEFORE
// the 48h mark instead of only after it. Its own section/badge (not a
// sub-band inside Stuck's list) matches how every other issue type in this
// tab gets its own scannable count — a shared count would hide this signal
// behind the Stuck badge, defeating the point of an early warning. Not one
// of the 5 official SLA checks, so — same as Recording Not Working/Closed
// w/ No Work below — it's deliberately excluded from updateTabBadges'
// aggregate count, the Issues CSV, and RM SLA Score.
function renderApproachingDeadlineList(){
  const group = groupSiblingsTogether(
    issueLeads.filter(l => l.isOpenLead && !l.stageStuck48h && l.ageHours != null && l.ageHours >= 36 && l.ageHours <= 48),
    (a,b) => (b.ageHours||0) - (a.ageHours||0)
  );
  document.getElementById('approachingDeadlineCount').textContent = uniqueCloneLabel(countUniqueAndCloned(group), 'lead');
  const el = document.getElementById('approachingDeadlineList');
  if (!group.length) {
    el.innerHTML = `<div class="empty-row" style="background:var(--surface); border-radius:8px; border:1px solid var(--border);">Nothing approaching the 48h deadline right now</div>`;
    return;
  }
  el.innerHTML = truncationNotice(group.length, MAX_CARDS) + group.slice(0, MAX_CARDS).map((l, idx) => renderAlertCard(l, idx, 'approaching', CONFIG.MIN_CALLS_AFTER_48H)).join('');
}

// Pure stage check: open past 48hrs, still not Opportunity+, regardless of
// call count. Deliberately separate from the under-called list above —
// this catches leads that WERE worked (plenty of calls) but still haven't
// converted, which is a different problem than under-calling. Carries a
// stuck-by-current_stage breakdown above the list, since current_stage
// already sits on every card but previously required manually scanning
// them to see WHERE the funnel is leaking.
function renderStuckList(){
  const group = groupSiblingsTogether(
    issueLeads.filter(l => l.isOpenLead && l.stageStuck48h),
    (a,b) => (b.ageHours||0) - (a.ageHours||0)
  );
  document.getElementById('stuckCount').textContent = uniqueCloneLabel(countUniqueAndCloned(group), 'lead');

  const breakdownEl = document.getElementById('stuckBreakdown');
  if (breakdownEl) {
    if (group.length) {
      const b = topBreakdown(group, l => l.current_stage, { color: 'var(--red)', limit: 6 });
      breakdownEl.innerHTML = `<div class="filter-summary" style="margin:0 0 8px;">Stuck leads by current stage — where the funnel is actually stuck</div>${b.html}`;
    } else {
      breakdownEl.innerHTML = '';
    }
  }

  const el = document.getElementById('stuckList');
  if (!group.length) {
    el.innerHTML = `<div class="empty-row" style="background:var(--surface); border-radius:8px; border:1px solid var(--border);">Nothing stuck past 48h right now</div>`;
    return;
  }
  el.innerHTML = truncationNotice(group.length, MAX_CARDS) + group.slice(0, MAX_CARDS).map((l, idx) => renderAlertCard(l, idx, 'stuck', CONFIG.MIN_CALLS_AFTER_48H)).join('');
}

function renderInactiveRmList(){
  // issueLeads (per-copy), not leads (merged) — matches how this same
  // issue is already judged for the Operations tab badge and its region
  // email (both read l.inactiveRmNewLead off issueLeads) — the on-screen
  // list was the one place still reading the merged view, which could
  // silently miss or misattribute a copy the merge didn't pick as primary.
  const group = groupSiblingsTogether(
    issueLeads.filter(l => l.inactiveRmNewLead),
    (a,b) => (b.ageHours||0) - (a.ageHours||0)
  );
  document.getElementById('inactiveRmCount').textContent = uniqueCloneLabel(countUniqueAndCloned(group), 'lead');
  const el = document.getElementById('inactiveRmList');
  if (!group.length) {
    el.innerHTML = `<div class="empty-row" style="background:var(--surface); border-radius:8px; border:1px solid var(--border);">No new lead today landed on an inactive RM</div>`;
    return;
  }
  el.innerHTML = truncationNotice(group.length, MAX_CARDS) + group.slice(0, MAX_CARDS).map((l, idx) => {
    const logId = 'inactivermlog_' + idx;
    return `<div class="alert-card">
      <div class="alert-id">${leadIdentityLine(l)}</div>
      <div class="alert-age mono">created ${esc(istStamp(l.lead_created_at))}</div>
      <div class="alert-meta">${esc(l.region)} · ${esc(l.project)} · ${esc(l.current_stage)} — <span class="chip red">RM marked inactive</span> <span class="chip amber">${esc(l.TL || 'no TL')}</span></div>
      ${logToggleMarkup(l, logId)}
    </div>`;
  }).join('');
}

function renderNotUpdatedList(){
  const group = groupSiblingsTogether(
    issueLeads.filter(l => l.isOpenLead && l.isNotUpdated),
    (a,b) => (b.ageHours||0) - (a.ageHours||0)
  );
  document.getElementById('notUpdatedCount').textContent = uniqueCloneLabel(countUniqueAndCloned(group), 'lead');
  const el = document.getElementById('notUpdatedList');
  if (!group.length) {
    el.innerHTML = `<div class="empty-row" style="background:var(--surface); border-radius:8px; border:1px solid var(--border);">Nothing sitting in Not Updated right now</div>`;
    return;
  }
  el.innerHTML = truncationNotice(group.length, MAX_CARDS) + renderCardsByDay(group, (l, idx) => {
    const req = l.past48h ? CONFIG.MIN_CALLS_AFTER_48H : CONFIG.MIN_CALLS_PER_DAY;
    return renderAlertCard(l, idx, 'notupdated', req);
  });
}


// Recording Not Working — data-integrity check, not an SLA breach.
// Shows every lead where comments exist but call_count (connected calls)
// is 0, with no filtering of any kind, so the raw scale of the logging
// gap is visible. Closed with No Work Recorded is its own separate card
// below (see renderClosedNoWorkList) — a different symptom (a closed lead
// with NO evidence of work at all) that deserves its own visibility
// rather than being buried inside this one.
function renderRecordingList(){
  // issueLeads (per-copy), not leads (merged) — a customer's copies are
  // judged on their OWN call/comment data; a merged record's pooled
  // comments (from every copy combined) against a maxed call_count could
  // mask a genuine mismatch on the copy that actually has it, or show a
  // false one credited to a copy that never had the calls or the comments.
  const group = groupSiblingsTogether(
    issueLeads.filter(l => l.recordingCommentsNoCalls),
    (a,b) => (b.ageHours||0) - (a.ageHours||0)
  );

  document.getElementById('recordingCount').textContent = uniqueCloneLabel(countUniqueAndCloned(group), 'lead');
  const desc = document.getElementById('recordingDesc');
  if (desc) {
    desc.textContent = 'Call count is zero but comments/work exists. Deliberately unfiltered: no open/closed check, no grace period, no priority ranking.';
  }

  const el = document.getElementById('recordingList');
  if (!group.length) {
    el.innerHTML = `<div class="empty-row" style="background:var(--surface); border-radius:8px; border:1px solid var(--border);">No mismatches — every lead with comments also has calls recorded</div>`;
    return;
  }
  el.innerHTML = truncationNotice(group.length, MAX_CARDS) + renderCardsByDay(group, (l, idx) => {
    const entries = parseActionLog(combinedCommentsText(l));
    const logId = 'recording_' + idx;
    const stateNote = l.excluded ? 'closed' : (l.oppOrAbove ? 'Opportunity+' : 'open');
    const closingNote = l.closing_reason ? ` · reason: ${l.closing_reason}` : '';
    // The flag can fire off last_comment/closing_reason alone (see
    // hasAnyCommentField) even when the structured action log itself is
    // empty — "0 comments, 0 calls" would misleadingly contradict the
    // card being shown at all in that case, so fall back to a generic
    // "comment logged" phrasing rather than a literal zero count.
    const commentLabel = entries.length
      ? `${entries.length} comment${entries.length === 1 ? '' : 's'}, 0 calls`
      : 'comment logged, 0 calls';
    return `<div class="alert-card amber-left">
      <div class="alert-id">${leadIdentityLine(l)}</div>
      <div class="alert-age mono">created ${esc(isoStampIST(l.lead_created_at))}</div>
      <div class="alert-meta">${esc(l.region)} · ${esc(l.project)} · ${esc(l.current_stage)} <span class="dim" style="font-size:11px;">(${esc(stateNote)}${esc(closingNote)})</span> — <span class="chip amber">${esc(commentLabel)}</span></div>
      ${logToggleMarkup(l, logId)}
    </div>`;
  });
}

// Closed with No Work Recorded — split out from Recording Not Working
// above so it gets its own dedicated visibility instead of being one of
// two symptoms mixed into a single card. A lead CLOSED with zero comments
// logged at all — no evidence any work happened before closure — is a
// distinct, more concerning signal than a live lead with a logging
// mismatch. Deliberately just closed + zero comments, regardless of
// whatever the call columns say. Same deliberately-unfiltered approach:
// no grace period, no priority ranking (closedWithNoWork already requires
// the lead be closed, so an open/closed check would be redundant here).
function renderClosedNoWorkList(){
  // issueLeads (per-copy), not leads (merged) — same reasoning as
  // Recording Not Working above: a merged record's pooled comments can
  // hide that ONE specific copy closed with literally nothing logged,
  // even while a sibling copy's comments make the merged record look fine.
  const group = groupSiblingsTogether(
    issueLeads.filter(l => l.closedWithNoWork),
    (a,b) => (b.ageHours||0) - (a.ageHours||0)
  );

  document.getElementById('closedNoWorkCount').textContent = uniqueCloneLabel(countUniqueAndCloned(group), 'lead');

  const el = document.getElementById('closedNoWorkList');
  if (!group.length) {
    el.innerHTML = `<div class="empty-row" style="background:var(--surface); border-radius:8px; border:1px solid var(--border);">No closed lead is missing all work evidence</div>`;
    return;
  }
  el.innerHTML = truncationNotice(group.length, MAX_CARDS) + renderCardsByDay(group, (l, idx) => {
    const logId = 'closednowork_' + idx;
    const closingNote = l.closing_reason ? ` · reason: ${l.closing_reason}` : '';
    return `<div class="alert-card">
      <div class="alert-id">${leadIdentityLine(l)}</div>
      <div class="alert-age mono">created ${esc(isoStampIST(l.lead_created_at))}</div>
      <div class="alert-meta">${esc(l.region)} · ${esc(l.project)} · ${esc(l.current_stage)} <span class="dim" style="font-size:11px;">(closed${esc(closingNote)})</span> — <span class="chip red">Closed with no work recorded</span></div>
      ${logToggleMarkup(l, logId)}
    </div>`;
  });
}

// Newest internal comment timestamp, or null when none is dated.
function lastCommentTimestamp(l){ return l.lastCommentAt || null; }

function renderNotConnectedList(){
  const missed = groupSiblingsTogether(
    issueLeads.filter(l => l.firstContactBreach),
    (a,b) => (b.businessMinsToConnect||0) - (a.businessMinsToConnect||0)
  );
  document.getElementById('notConnCount').textContent = uniqueCloneLabel(countUniqueAndCloned(missed), 'lead');
  const el = document.getElementById('notConnList');
  if (!missed.length){
    el.innerHTML = `<div class="empty-row" style="background:var(--surface); border-radius:8px; border:1px solid var(--border);">No connected leads missed the 10-minute first-contact window</div>`;
    return;
  }
  el.innerHTML = truncationNotice(missed.length, MAX_CARDS) + renderCardsByDay(missed, (l, idx) => {
    const logId = 'notconnlog_' + idx;
    return `<div class="alert-card amber-left">
      <div class="alert-id">${leadIdentityLine(l)}</div>
      <div class="alert-age mono">${esc(fmtWorkingWait(l.businessMinsToConnect, 'late'))}</div>
      <div class="alert-meta">${esc(l.region)} · ${esc(l.TL)} · created ${esc(isoStamp(l.lead_created_at))} · connected ${esc(isoStamp(l.last_connect_time))}</div>
      ${logToggleMarkup(l, logId)}
    </div>`;
  });
}

// SOP Rule 3 — attempts made but not logged in CRM.

// SOP Rule 4 — connected leads with no CRM update in the last 4 hours.
function renderFollowupList(){
  const group = groupSiblingsTogether(
    issueLeads.filter(l => l.followupOverdue),
    (a,b) => (b.hoursSinceLastComment||0) - (a.hoursSinceLastComment||0)
  );
  document.getElementById('followupCount').textContent = uniqueCloneLabel(countUniqueAndCloned(group), 'lead');
  const el = document.getElementById('followupList');
  if (!group.length) {
    el.innerHTML = `<div class="empty-row" style="background:var(--surface); border-radius:8px; border:1px solid var(--border);">All connected leads reviewed within 4 hours</div>`;
    return;
  }
  el.innerHTML = truncationNotice(group.length, MAX_CARDS) + renderCardsByDay(group, (l, idx) => {
    // The 4h clock runs from the last internal comment, so show that
    // timestamp explicitly rather than a relative figure — it's the value
    // the recipient needs to verify the flag themselves.
    const lastCommentAt = lastCommentTimestamp(l);
    const clockLabel = lastCommentAt
      ? `last comment ${isoStampIST(lastCommentAt)}`
      : 'no dated comment since connecting';
    const logId = 'followuplog_' + idx;
    return `<div class="alert-card">
      <div class="alert-id">${leadIdentityLine(l)}</div>
      <div class="alert-age mono">created ${esc(isoStampIST(l.lead_created_at))}</div>
      <div class="alert-meta">${esc(l.region)} · ${esc(l.project)} · ${esc(l.current_stage)} — <span class="chip red">${esc(clockLabel)}</span> <span class="chip amber">${l.call_attempts} attempts</span></div>
      ${logToggleMarkup(l, logId)}
    </div>`;
  });
}

function renderLoggingGapList(){
  // issueLeads (per-copy), not leads (merged) — a customer's copies are
  // judged on their OWN call_attempts vs comment-log gap; merging would
  // credit one copy's calls against another copy's comment log instead.
  const group = groupSiblingsTogether(
    issueLeads.filter(l => l.loggingGapBreach),
    (a,b) => (b.unloggedCallGap||0) - (a.unloggedCallGap||0)
  );
  document.getElementById('loggingGapCount').textContent = uniqueCloneLabel(countUniqueAndCloned(group), 'lead');
  const el = document.getElementById('loggingGapList');
  if (!group.length) {
    el.innerHTML = `<div class="empty-row" style="background:var(--surface); border-radius:8px; border:1px solid var(--border);">No open lead has a meaningful gap between calls made and calls logged</div>`;
    return;
  }
  el.innerHTML = truncationNotice(group.length, MAX_CARDS) + renderCardsByDay(group, (l, idx) => {
    const logId = 'logginggaplog_' + idx;
    return `<div class="alert-card">
      <div class="alert-id">${leadIdentityLine(l)}</div>
      <div class="alert-age mono">created ${esc(isoStampIST(l.lead_created_at))}</div>
      <div class="alert-meta">${esc(l.region)} · ${esc(l.project)} · ${esc(l.current_stage)} — <span class="chip red">${l.call_attempts} calls, ${l.call_attempts - l.unloggedCallGap} logged</span> <span class="chip amber">gap of ${l.unloggedCallGap}</span></div>
      ${logToggleMarkup(l, logId)}
    </div>`;
  });
}


document.getElementById('refreshBtn').addEventListener('click', () => fetchAndRender());
document.getElementById('changeSourceBtn').addEventListener('click', () => {
  document.getElementById('configPanel').style.display = 'block';
});
document.getElementById('dateFromInput').addEventListener('change', () => {
  if (allParsedLeads.length) applyFiltersAndRender();
});
document.getElementById('dateToInput').addEventListener('change', () => {
  if (allParsedLeads.length) applyFiltersAndRender();
});

/* ===================== ISSUES CSV EXPORT ===================== */
// ISSUE_PRIORITY's five categories, plus Recording Not Working, Closed
// with No Work Recorded, and Stalled Leads (see downloadIssuesCSV,
// defined further down once those three checks/computations exist). A lead
// flagged under more than one shows as a single row with all its issues
// joined by "; " rather than duplicate rows per issue.

// Priority order for the CSV export, the combined "all issues" report,
// Stalled Leads, and the RM stall leaderboard / time-to-remediate
// stats — a lead can technically match several categories at once (e.g.
// ISSUE_PRIORITY itself now lives in js/core.js — js/reports.js needs it at
// its own top-level parse time (script-load order), before this inline
// block runs, so it can no longer be declared down here.

// Fixed color per known issue label — keeps the Movement tab's stall
// breakdown chart visually stable across refreshes (same issue, same color
// every time) rather than shuffling with whatever order Object.keys()
// happens to sort into. Falls back to a cycling palette for anything
// unrecognised, so a future issue type still renders instead of breaking.
// "Not Connected in 10 Minutes" deliberately has no entry here — every
// caller that supplies colorFn: colorForIssue sources its labels from
// either ISSUE_PRIORITY (which excludes that issue on purpose, see its own
// comment) or overnightStatusLabel() (stage names / "Closed" / "Unrecognized
// Stage"), so colorForIssue never actually receives that label. An entry
// for it used to sit here anyway, unreachable.
const ISSUE_COLOR_MAP = {
  "Not Updated": 'var(--purple)',
  "Follow-up Overdue (4h Post-Connect)": 'var(--red)',
  "Behind on Today's Calls": 'var(--blue)',
  "Leads Pending Beyond 48 Hours (Not Yet Opportunity)": 'var(--teal)',
  // Added for the Tracking tab's multi-series chart, the first place all
  // five ISSUE_PRIORITY checks are plotted together at once — without a
  // fixed entry this one would fall to the cycling fallback below and could
  // collide with whichever hue Behind on Today's Calls already claims.
  "Inactive-RM Lead Added": 'var(--amber)',
};
const ISSUE_COLOR_FALLBACK = ['var(--blue)', 'var(--red)', 'var(--amber)', 'var(--purple)', 'var(--teal)', 'var(--green)'];
function colorForIssue(issue, indexIfUnknown){
  return ISSUE_COLOR_MAP[issue] || ISSUE_COLOR_FALLBACK[indexIfUnknown % ISSUE_COLOR_FALLBACK.length];
}

// Shared "N leads, broken down by X" count card — big total + proportional
// bar + legend. Used by the Movement tab's Stalled/Opportunity/Closed
// breakdowns; kept generic (caller supplies the counts and a color
// function) rather than tied to issue labels specifically.
function renderBreakdownCard(el, opts){
  if (!el) return;
  const { total, totalLabel, subNote, rangeText, counts, colorFn, numColor, emptyText } = opts;
  if (!total) {
    el.innerHTML = emptyText ? `<div class="stall-card-empty">${esc(emptyText)}</div>` : '';
    return;
  }

  const sortedKeys = Object.keys(counts).sort((a, b) => counts[b] - counts[a]);
  const segs = sortedKeys.map((k, i) => {
    const count = counts[k];
    const pct = count / total * 100;
    const color = colorFn(k, i);
    return `<div class="stall-bar-seg" style="width:${pct}%; background:${color};" title="${esc(k)}: ${count.toLocaleString()} (${pct.toFixed(1)}%)"></div>`;
  }).join('');
  const legend = sortedKeys.map((k, i) => {
    const count = counts[k];
    const pct = (count / total * 100).toFixed(1);
    const color = colorFn(k, i);
    return `<div class="stall-legend-item">
      <span class="stall-legend-dot" style="background:${color};"></span>
      <span>${esc(k)}</span>
      <span class="stall-legend-count">${count.toLocaleString()}</span>
      <span class="stall-legend-pct">${pct}%</span>
    </div>`;
  }).join('');

  el.innerHTML = `<div class="stall-card">
    <div class="stall-card-total">
      <div class="stall-card-num" style="color:${numColor || 'var(--red)'};">${total.toLocaleString()}</div>
      <div class="stall-card-num-label">${esc(totalLabel)}</div>
      ${subNote ? `<div class="stall-card-range" title="Same customer, another RM's copy — counted once above, not shown twice">${esc(subNote)}</div>` : ''}
      ${rangeText ? `<div class="stall-card-range">${esc(rangeText)}</div>` : ''}
    </div>
    <div class="stall-card-body">
      <div class="stall-bar-track">${segs}</div>
      <div class="stall-legend">${legend}</div>
    </div>
  </div>`;
}

function csvEscape(v){
  const s = String(v == null ? '' : v);
  if (/[",\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}

// One lead_id per row for every customer currently passing the filters —
// `leads` (not allParsedLeads), so this always matches whatever the Total
// Leads KPI and every on-screen list are currently showing. Expands via
// collatedLeadIds (same fallback pattern used elsewhere for a merged
// customer — see e.g. line ~2828) rather than each record's own single
// lead_id field, so a customer collated from 2 RM copies contributes BOTH
// of its original lead_ids, not just whichever one happened to become the
// merged record's primary id.
function downloadFilteredLeadIdsCSV(){
  const outRows = [];
  leads.forEach(l => {
    const idList = (l.collatedLeadIds && l.collatedLeadIds.length) ? l.collatedLeadIds : [l.lead_id];
    const cloned = idList.length > 1;
    idList.forEach(id => {
      if (!id) return;
      // "Clone id(s)" lists this row's OWN siblings — every other lead_id
      // collated into the same customer — not the whole idList, so the id
      // in column 1 never appears redundantly in its own clone-id column.
      const cloneIds = cloned ? idList.filter(other => other !== id).join('; ') : '';
      outRows.push([id, l.client || '', cloned ? 'Yes' : 'No', cloneIds]);
    });
  });

  const rows = [['lead_id', 'client', 'cloned', 'clone_id(s)']].concat(outRows);
  const csvContent = rows.map(r => r.map(csvEscape).join(',')).join('\r\n');
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
  a.href = url;
  a.download = `filtered_lead_ids_${stamp}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function downloadIssuesCSV(){
  // Grouped BY issue — one block per issue listing every lead that has it
  // — rather than one row per lead with its issues joined into a cell. A
  // lead with more than one issue deliberately appears once per issue
  // group it belongs to; "issue" is the first column so sorting/filtering
  // on it in a spreadsheet keeps each issue's leads together too.
  const byIssue = new Map();
  const addIssue = (issue, leadId, region, rm) => {
    if (!leadId) return;
    if (!byIssue.has(issue)) byIssue.set(issue, []);
    byIssue.get(issue).push({ lead_id: leadId, region, rm: rm || 'Unassigned' });
  };

  issueLeads.forEach(l => {
    ISSUE_PRIORITY.forEach(rule => { if (l[rule.key]) addIssue(rule.label, l.lead_id, l.region, l.RM); });
    // recordingCommentsNoCalls/closedWithNoWork are deliberately outside
    // ISSUE_PRIORITY (no grace period, no priority ranking — see their own
    // section descriptions) but still belong in a full issues export.
    if (l.recordingCommentsNoCalls) addIssue('Recording Not Working', l.lead_id, l.region, l.RM);
    if (l.closedWithNoWork) addIssue('Closed with No Work Recorded', l.lead_id, l.region, l.RM);
  });

  // Stalled Leads comes from Movement_Log via the Compare from/to
  // picker (see getPickedMovementWindow), not issueLeads — a completely
  // separate per-copy row shape. Silently skipped if no pair is picked yet
  // (same as the on-screen card's own empty state), rather than blocking
  // the rest of the export.
  const win = getPickedMovementWindow();
  if (win) {
    applyMovementFilters(computeMovementRows(win.fromAt, win.toAt)).forEach(r => {
      addIssue('Stalled Leads', r.lead_id, r.region, r.RM);
    });
  }

  const rows = [['issue', 'lead_id', 'region', 'RM Name']];
  // Fixed, stable order (matching ISSUE_PRIORITY's own priority order, then
  // the three checks outside it) rather than whatever order Map insertion
  // happened to produce.
  const issueOrder = ISSUE_PRIORITY.map(r => r.label).concat(['Recording Not Working', 'Closed with No Work Recorded', 'Stalled Leads']);
  issueOrder.forEach(issue => {
    const leads = byIssue.get(issue);
    if (!leads) return;
    leads.forEach(l => rows.push([issue, l.lead_id, l.region, l.rm]));
  });

  const csvContent = rows.map(r => r.map(csvEscape).join(',')).join('\r\n');
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
  a.href = url;
  a.download = `lead_issues_${stamp}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

document.getElementById('downloadIssuesBtn').addEventListener('click', downloadIssuesCSV);
document.getElementById('downloadLeadIdsBtn').addEventListener('click', downloadFilteredLeadIdsCSV);
document.getElementById('downloadUnmatchedCommentsBtn').addEventListener('click', downloadUnmatchedCommentsCSV);
