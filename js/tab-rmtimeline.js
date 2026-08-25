// ============================================================
// tab-rmtimeline.js — RM Timeline tab (per-RM daily calendar,
// day timeline, issue history). Depends on core.js (loaded first).
// NOTE: initRMTimelineUI() (the tab's own init/wiring function)
// still lives in dashboard.html's remaining inline script for
// now — it'll move here in a later phase alongside the other
// end-of-file init/bootstrap calls.
// ============================================================

/* ===================== RM TIMELINE ===================== */
// Tracks which RM was selected the last time this tab rendered, so a Day
// Timeline the user manually picked survives an unrelated re-render (a
// filter change, a fresh fetch), but resets to a sensible default the
// moment the RM selection itself changes.
let _rmtlLastRM = '';

// Project/Region/TL/Source/Sub-source only — deliberately NOT the top
// filter bar's Assigned-date range (dateFromInput/dateToInput), unlike
// `leads` itself. Every section in this tab does its own date scoping
// locally (the calendar's fixed 7-day window, the day timeline's picked
// day), so gating the underlying lead set by that SEPARATE, arbitrary
// top-of-page date range too was a real bug: moving "To" earlier than
// "From" (e.g. "From" left at its default of today-7 while "To" gets
// dragged back further) makes that range invalid, `leads` goes completely
// empty, and every RM's calendar shows "no dated leads" at once — not a
// per-RM problem, a global one. Mirrors applyFiltersAndRender's own
// passesFilters predicate minus the date clause.
function rmtlScopedLeads(){
  const projSel = filterState.project, regSel = filterState.region, tlSel = filterState.TL;
  const srcSel = filterState.source, bucketSel = filterState.bucket;
  const srcSelLower = new Set(Array.from(srcSel).map(s => s.toLowerCase()));
  return allParsedLeads.filter(l => {
    if (projSel.size && !projSel.has(l.project)) return false;
    if (regSel.size && !regSel.has(effectiveRegion(l))) return false;
    if (tlSel.size && !tlSel.has(l.TL)) return false;
    if (srcSel.size && !srcSelLower.has(String(l.group_source).trim().toLowerCase())) return false;
    if (bucketSel.size && !bucketSel.has(String(l.source_bucket).trim())) return false;
    return true;
  });
}

function populateRMTimelineSelect(){
  const sel = document.getElementById('rmtlRMSelect');
  if (!sel) return null;
  const rmList = Array.from(new Set(rmtlScopedLeads().map(l => l.RM || 'Unassigned').filter(Boolean))).sort();
  const prevValue = sel.value;
  sel.innerHTML = rmList.map(rm => `<option value="${esc(rm)}">${esc(rm)}</option>`).join('');
  if (prevValue && rmList.includes(prevValue)) sel.value = prevValue;
  return sel.value || null;
}

// Always exactly 7 day-cells, anchored to the SAME "To" date the Assigned-
// date filter at the top of the page uses (dateToInput) — defaults to
// today's browser date the same way that filter's own default does (via
// defaultDateRangeValue), and shifts with it if the user changes it. Per
// feedback: "last 7 days browser date by default, if to date is changed
// then from there". Reads rmtlScopedLeads(), NOT `leads` — see its comment
// for why: `leads` is ALSO gated by that same dateFromInput/dateToInput
// range, which could exclude or entirely empty out the window this
// calendar is trying to show on its own terms.
function renderRMDailyCalendar(rm, selectedDay){
  const el = document.getElementById('rmtlDailyTrend');
  const countEl = document.getElementById('rmtlDailyCount');
  if (!el) return;
  if (!rm) { el.innerHTML = ''; if (countEl) countEl.textContent = ''; return; }

  const byDay = new Map();
  rmtlScopedLeads().forEach(l => {
    if ((l.RM || 'Unassigned') !== rm) return;
    const d = parseDate(l.lead_assigned_at);
    if (!d) return;
    const key = istDateKey(d);
    if (!byDay.has(key)) byDay.set(key, { n: 0, collated: 0 });
    const b = byDay.get(key);
    b.n++;
    if (l.collatedFrom > 1) b.collated++;
  });

  if (!byDay.size) {
    if (countEl) countEl.textContent = '';
    el.innerHTML = `<div class="empty-row" style="background:var(--surface); border-radius:8px; border:1px solid var(--border);">No dated leads for this RM in the current filters</div>`;
    return;
  }

  const toVal = document.getElementById('dateToInput').value || defaultDateRangeValue().to;
  const toDate = parseDate(toVal + ' 00:00:00');
  const todayKey = istDateKey(new Date()); // browser-local "today", not IST — same convention defaultDateRangeValue itself uses

  const windowKeys = [];
  for (let i = 6; i >= 0; i--) windowKeys.push(istDateKey(istAddDays(toDate, -i)));

  const windowTotal = windowKeys.reduce((sum, k) => sum + (byDay.get(k)?.n || 0), 0);
  const windowCollated = windowKeys.reduce((sum, k) => sum + (byDay.get(k)?.collated || 0), 0);
  if (countEl) countEl.textContent = numWithClone(windowTotal, windowCollated) + ' in the last 7 days';

  const max = Math.max(1, ...windowKeys.map(k => byDay.get(k)?.n || 0));
  const cells = windowKeys.map(key => {
    const cellDate = parseDate(key + ' 00:00:00');
    const count = byDay.get(key)?.n || 0;
    const collated = byDay.get(key)?.collated || 0;
    const opacity = count ? Math.min(0.85, 0.15 + (count / max) * 0.7) : 0;
    const classes = ['rmtl-cal-day'];
    if (key === todayKey) classes.push('today');
    if (key === selectedDay) classes.push('selected');
    const cloneNote = collated > 0 ? ` (${collated} cloned)` : '';
    return `<div class="${classes.join(' ')}" data-day="${key}" style="background:rgba(91,141,239,${opacity});">
      <span class="rmtl-cal-d">${esc(IST_WEEKDAYS[istParts(cellDate).dow])} ${istParts(cellDate).d}</span>
      ${count ? `<span class="rmtl-cal-n">${count}</span>` : ''}
      <span class="day-hint">${esc(istDayLabelWithDow(cellDate))}: ${count} lead${count === 1 ? '' : 's'} assigned${cloneNote}</span>
    </div>`;
  });

  el.innerHTML = `<div class="rmtl-cal">${cells.join('')}</div>`;
}

// Every dated touch (call connect + individually-dated comment log lines,
// via updateEventsFor — same event model the Audit tab's Updated Leads and
// Activity by Hour use) across one RM's leads on one IST day, chronological.
// Reads rmtlScopedLeads() (Project/Region/TL/Source only, no Assigned-date
// gate) for the same reason the calendar above does — a picked day
// shouldn't go empty just because the top-of-page date filter's range
// doesn't happen to cover it.
function renderRMDayTimeline(rm, dayKey){
  const listEl = document.getElementById('rmtlTimelineList');
  const countEl = document.getElementById('rmtlTimelineCount');
  if (!listEl) return;
  if (!rm || !dayKey) { listEl.innerHTML = ''; if (countEl) countEl.textContent = ''; return; }

  const rmLeads = rmtlScopedLeads().filter(l => (l.RM || 'Unassigned') === rm);
  const events = [];
  rmLeads.forEach(l => {
    updateEventsFor(l).forEach(ev => {
      if (istDateKey(ev.at) === dayKey) events.push(Object.assign({ lead: l }, ev));
    });
  });
  events.sort((a, b) => a.at - b.at); // chronological — a day timeline reads earliest-first

  if (countEl) countEl.textContent = events.length + ' event' + (events.length === 1 ? '' : 's');

  const dayLabel = istDayLabelWithDow(parseDate(dayKey + ' 00:00:00'));
  if (!events.length) {
    listEl.innerHTML = `<div class="empty-row" style="background:var(--surface); border-radius:8px; border:1px solid var(--border);">No logged activity for this RM on ${esc(dayLabel)}</div>`;
    return;
  }

  listEl.innerHTML = events.map(ev => {
    const l = ev.lead;
    return `<div class="alert-card" style="border-left-color:var(--blue); margin-bottom:8px;">
      <div class="alert-id">${esc(istTimeLabel(ev.at))} — ${leadIdentityLine(l)}</div>
      <div class="alert-age mono">${esc(ev.kind)}</div>
      <div class="alert-meta">${ev.by ? 'By ' + esc(ev.by) + ' — ' : ''}${esc(ev.text || '—')}</div>
      <div class="alert-comment">Stage: ${esc(l.current_stage || '—')} · Last comment: ${esc(l.last_comment || '—')} · Closing reason: ${esc(l.closing_reason || '—')}</div>
    </div>`;
  }).join('');
}

function renderRMIssueList(rm){
  const table = document.getElementById('rmtlIssueTable');
  const countEl = document.getElementById('rmtlIssueCount');
  if (!table) return;
  const thead = table.querySelector('thead'), tbody = table.querySelector('tbody');
  if (!rm) { thead.innerHTML = ''; tbody.innerHTML = ''; if (countEl) countEl.textContent = ''; return; }

  const rows = issueLeads.filter(l => (l.RM || 'Unassigned') === rm && ISSUE_PRIORITY.some(rule => l[rule.key]));
  if (countEl) countEl.textContent = uniqueCloneLabel(countUniqueAndCloned(rows));

  thead.innerHTML = `<tr><th>Lead ID</th><th>Stage</th><th>Assigned</th><th>Issue(s)</th></tr>`;
  if (!rows.length) {
    tbody.innerHTML = `<tr><td colspan="4" class="empty-row">No current issues for this RM</td></tr>`;
    return;
  }
  tbody.innerHTML = rows.map(l => {
    const issues = ISSUE_PRIORITY.filter(rule => l[rule.key]).map(rule => rule.label);
    return `<tr>
      <td>${esc(l.lead_id)}</td><td class="dim">${esc(l.current_stage)}</td><td class="dim">${esc(istStamp(l.lead_assigned_at))}</td>
      <td>${issues.map(i => `<span class="chip red" style="margin:0 4px 4px 0;">${esc(i)}</span>`).join('')}</td>
    </tr>`;
  }).join('');
}

// Same run-tally shape computeIssueTalliesByRun produces for a region, just
// grouped by rec.RM instead — so buildTrackingChartSvg (built generically
// around that shape) renders this RM's history with zero changes needed.
// totalAll here means "leads assigned to this RM at that snapshot".
function computeIssueTalliesByRunForRM(rmName){
  const byRun = new Map();
  movementSnapshots.forEach(rec => {
    if (!passesMovementFilters(rec)) return;
    if ((rec.RM || 'Unassigned') !== rmName) return;

    const atMs = rec.snapshot_at.getTime();
    let tally = byRun.get(atMs);
    if (!tally) {
      tally = { at: rec.snapshot_at, totalAll: 0, openTotal: 0, breachedTotal: 0, byCheck: {} };
      ISSUE_PRIORITY.forEach(rule => { tally.byCheck[rule.key] = 0; });
      byRun.set(atMs, tally);
    }
    tally.totalAll++;

    const enriched = enrichSnapshotCached(rec);
    if (!enriched.isOpenLead) return;
    tally.openTotal++;
    let breached = false;
    ISSUE_PRIORITY.forEach(rule => {
      if (enriched[rule.key]) { tally.byCheck[rule.key]++; breached = true; }
    });
    if (breached) tally.breachedTotal++;
  });
  return Array.from(byRun.values()).sort((a, b) => a.at - b.at);
}

// No separate From/To picker here (unlike the Tracking tab) — just shows
// this RM's whole captured history automatically, since the point is a
// quick "how has this RM trended" look rather than a specific comparison.
function renderRMIssueHistory(rm){
  const el = document.getElementById('rmtlHistoryChart');
  const countEl = document.getElementById('rmtlHistoryCount');
  if (!el) return;
  if (!rm) { el.innerHTML = ''; if (countEl) countEl.textContent = ''; return; }

  if (movementFetchState !== 'ok') {
    if (countEl) countEl.textContent = '';
    el.innerHTML = `<div class="empty-row">${movementFetchState === 'loading' ? 'Loading movement history…' : 'No Movement_Log data yet — see MovementTracker.gs, or the Snapshot now button up in the header.'}</div>`;
    return;
  }

  const runs = computeIssueTalliesByRunForRM(rm);
  if (runs.length < 2) {
    if (countEl) countEl.textContent = '';
    el.innerHTML = `<div class="empty-row">${runs.length === 0 ? 'No captured snapshots for this RM yet.' : 'Only one snapshot captured for this RM so far — need at least two to draw a trend.'}</div>`;
    return;
  }

  if (countEl) countEl.textContent = runs.length + ' snapshots';
  el.innerHTML = buildTrackingChartSvg(runs, runs[0].at, runs[runs.length - 1].at);
}

function renderRMTimelineTab(){
  const rm = populateRMTimelineSelect();
  const dayInput = document.getElementById('rmtlDayInput');
  if (!dayInput) return;

  // Reset the picked day to this RM's most recent activity only when the
  // RM selection itself just changed — an unrelated re-render (filters, a
  // fresh fetch) shouldn't yank a day the user deliberately picked.
  if (rm && rm !== _rmtlLastRM) {
    _rmtlLastRM = rm;
    const rmLeads = rmtlScopedLeads().filter(l => (l.RM || 'Unassigned') === rm);
    let latest = null;
    rmLeads.forEach(l => {
      const evs = updateEventsFor(l);
      if (evs.length && (!latest || evs[0].at > latest)) latest = evs[0].at;
    });
    dayInput.value = istDateKey(latest || _renderNow);
  }

  renderRMDailyCalendar(rm, dayInput.value);
  renderRMDayTimeline(rm, dayInput.value);
  renderRMIssueList(rm);
  renderRMIssueHistory(rm);
}

// Relocated from dashboard.html's inline script (Phase 4 file-split) — this
// tab's own init/wiring function, called from js/main.js after every other
// script has loaded.
// RM select change picks up renderRMTimelineTab's own default-day reset
// (see _rmtlLastRM); the day input and calendar day clicks only need a
// re-render, not a reset, since the user is deliberately picking a day.
// The window itself isn't independently navigable — it always tracks
// dateToInput (see renderRMDailyCalendar), which already has its own
// change listener elsewhere that re-renders the whole page. The calendar's
// day cells are rebuilt on every render (inside #rmtlDailyTrend's own
// innerHTML), so clicks are handled via delegation on the container rather
// than binding to the cells directly.
function initRMTimelineUI(){
  const rmSelect = document.getElementById('rmtlRMSelect');
  const dayInput = document.getElementById('rmtlDayInput');
  const dailyEl = document.getElementById('rmtlDailyTrend');
  if (rmSelect) rmSelect.addEventListener('change', renderRMTimelineTab);
  if (dayInput) dayInput.addEventListener('change', () => {
    renderRMDailyCalendar(rmSelect.value, dayInput.value);
    renderRMDayTimeline(rmSelect.value, dayInput.value);
  });
  if (dailyEl) dailyEl.addEventListener('click', (e) => {
    if (!dayInput) return;
    const dayCell = e.target.closest('.rmtl-cal-day[data-day]');
    if (!dayCell) return;
    dayInput.value = dayCell.dataset.day;
    renderRMDailyCalendar(rmSelect.value, dayInput.value);
    renderRMDayTimeline(rmSelect.value, dayInput.value);
  });
}
