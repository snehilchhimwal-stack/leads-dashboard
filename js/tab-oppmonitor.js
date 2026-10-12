// Opp Monitor tab — display of the recurring Google Non-UTM/Search
// Same-day/48h Opp% workflow (12 steps/month: 3 periods x 3 steps + 3
// month-level steps, tracked as its own recurring cycle in a separate
// To-Do Dashboard tool this file has no connection to). This tab still
// reads neither `filterState` nor the shared date-range filter — its
// official numbers are a fixed monthly aggregate an external analytics
// session writes into Opp_Monitor_Period / Opp_Monitor_Month by hand, not
// sliceable by Project/Region/TL/Source/Sub-source (see the
// filter-bar-hiding block in overview-distribution-people-ops.js's
// tab-switch handler).
//
// It also reads `allParsedLeads` (added 2026-09-21, once the source
// `leads` tab gained a real `opp_at` column — HEADER_ALIASES,
// core-sheets-fetch.js): for any period/month slot with no
// externally-sourced row yet, it computes the same metrics itself,
// straight from lead_assigned_at vs opp_at, for Google Non-UTM/Search
// leads only, and renders that as a clearly-labeled "Live" row instead of
// leaving the slot empty. Until 2026-10-12 it read the global `leads`
// instead -- i.e. AFTER the hidden filter bar (default last 7 days) --
// which silently zeroed or skewed most live rows (audit H-2). The leads tab
// itself only holds ~7 days, so a period it only partly covers is flagged
// "Live · partial" and never compared against its neighbours. A slot
// that already has a real Opp_Monitor_Period/Month row is never
// overridden by a live computation — the external session's number is
// always the one shown once it exists, live rows only fill genuine gaps
// (most usefully the current, in-progress period/month, which never has
// an official row until its own cycle completes).

const OPP_MONITOR_PERIOD_TAB_NAME = 'Opp_Monitor_Period';
const OPP_MONITOR_MONTH_TAB_NAME = 'Opp_Monitor_Month';

const OPP_MONITOR_PERIOD_COLUMNS = [
  'period_key', 'year_month', 'period_number', 'period_label', 'date_from', 'date_to',
  'total_leads', 'same_day_count', 'h48_count', 'same_day_pct', 'h48_pct',
  'step1_status', 'step1_at', 'step2_status', 'step2_at', 'step3_status', 'step3_at',
  'updated_at', 'source', 'avg_days_to_opp', 'avg_hrs_to_opp',
];
const OPP_MONITOR_MONTH_COLUMNS = [
  'month_key', 'year_month', 'month_label',
  'total_leads', 'same_day_count', 'h48_count', 'same_day_pct', 'h48_pct',
  'step1_status', 'step1_at', 'step2_status', 'step2_at', 'step3_status', 'step3_at',
  'updated_at', 'source', 'avg_days_to_opp', 'avg_hrs_to_opp',
];

let oppMonitorPeriodFetchState = 'idle'; // 'idle'|'loading'|'ok'|'missing'|'error'
let oppMonitorMonthFetchState = 'idle';
let oppMonitorPeriodRows = [];
let oppMonitorMonthRows = [];

// Generic reader — mirrors fetchRmHierarchyForRollup (tab-repeat-offenders.js)
// and fetchDailyCohortHistoryForDate (sheets-writeback.js): a missing tab
// (Sheets API 400 on a bad range) is a normal "nothing archived yet" state,
// never a thrown error this caller has to handle specially.
async function _fetchOppMonitorTab(sheetId, tabName, columns){
  let values;
  try {
    values = await sheetsApiValuesGet(sheetId, `${tabName}!A1:Z`);
  } catch (err) {
    return { rows: [], state: err.status === 400 ? 'missing' : 'error' };
  }
  if (!values.length) return { rows: [], state: 'missing' };
  const table = valuesToGvizShape(values, () => false); // dates stored as plain text columns, no gviz date reconstruction needed
  const cols = table.cols;
  const idx = {};
  columns.forEach(key => {
    let found = -1;
    cols.forEach((c, i) => { if (found === -1 && String(c.label || '').trim() === key) found = i; });
    idx[key] = found;
  });
  if (idx[columns[0]] === -1) return { rows: [], state: 'missing' }; // no key column at all — not really this sheet
  const getRaw = (c, key) => idx[key] === -1 ? '' : gvizCellRaw(c[idx[key]]);
  const rows = table.rows.map(r => r.c || [])
    .map(c => {
      const o = {};
      columns.forEach(k => { o[k] = getRaw(c, k); });
      return o;
    })
    .filter(o => o[columns[0]]); // must carry the upsert key
  return { rows, state: rows.length ? 'ok' : 'missing' };
}

// Two independent fetch states, not one combined state: Opp_Monitor_Period
// fills in every ~10 days, Opp_Monitor_Month only at month-end — one
// existing without the other yet is expected, not an error.
async function fetchOppMonitorData(sheetId){
  oppMonitorPeriodFetchState = 'loading';
  oppMonitorMonthFetchState = 'loading';
  const [period, month] = await Promise.all([
    _fetchOppMonitorTab(sheetId, OPP_MONITOR_PERIOD_TAB_NAME, OPP_MONITOR_PERIOD_COLUMNS),
    _fetchOppMonitorTab(sheetId, OPP_MONITOR_MONTH_TAB_NAME, OPP_MONITOR_MONTH_COLUMNS),
  ]);
  oppMonitorPeriodRows = period.rows;
  oppMonitorPeriodFetchState = period.state;
  oppMonitorMonthRows = month.rows;
  oppMonitorMonthFetchState = month.state;
}

// Percentages are already computed by the external analytics session (not
// derived from raw counts locally like wowPctDelta does), so this only
// diffs two already-computed percentage values.
function oppMonitorPctDelta(curPct, prevPct){
  const cur = (curPct === '' || curPct == null) ? null : Number(curPct);
  const prev = (prevPct === '' || prevPct == null) ? null : Number(prevPct);
  return { cur, prev, delta: (cur !== null && prev !== null && !isNaN(cur) && !isNaN(prev)) ? cur - prev : null };
}

function _oppMonitorPctCellHtml(curPct, prevPct){
  const { cur, delta } = oppMonitorPctDelta(curPct, prevPct);
  const curTxt = cur === null ? '—' : `${cur.toFixed(1)}%`;
  // polarity 1: higher Same-day/48h Opp% is always the better direction for this metric.
  return `<div class="wow-pct">${curTxt}</div>${wowDeltaBadgeHtml(delta, 1)}`;
}

function _oppMonitorYearMonth(date){
  const p = istParts(date);
  return `${p.y}-${String(p.mo + 1).padStart(2, '0')}`;
}

function _oppMonitorShiftYearMonth(yearMonth, n){
  const [y, mo] = yearMonth.split('-').map(Number);
  const d = new Date(Date.UTC(y, mo - 1 + n, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

const OPP_MONITOR_MONTH_NAMES_ = ['January','February','March','April','May','June','July','August','September','October','November','December'];
function _oppMonitorMonthName(yearMonth){
  const [y, mo] = String(yearMonth || '').split('-').map(Number);
  if (!y || !mo || mo < 1 || mo > 12) return String(yearMonth || '');
  return `${OPP_MONITOR_MONTH_NAMES_[mo - 1]} ${y}`;
}

// --------------------------- Live computation (2026-09-21) ---------------------------
// Everything below computes the same METRICS Opp_Monitor_Period/Month
// store, directly from `allParsedLeads` (never the filtered `leads` -- see
// _oppMonitorInLiveScope), for whichever period/month slots don't have a
// real externally-sourced row yet. NOT the same population or day boundary
// as the official Jul/Aug 2026 rows (those used all Google leads and an
// 18:30-to-18:30 "day" -- docs/_planning/OPP_MONITOR_DATA_GAP_2026-10-12.md),
// which is why the render never computes a change across the two. Here:
// Google Non-UTM/Search leads only; same-day = the lead's first
// Opportunity-stage transition (opp_at) falls on the same IST calendar day
// as lead_assigned_at; within-48h = the gap is <=48 hours; a lead that
// never reached Opportunity (opp_at blank) counts
// toward total_leads but neither the same-day nor the 48h count. Negative
// gaps (opp_at before lead_assigned_at — a data anomaly, not a real
// conversion) are excluded from every metric, the same defensive guard a
// real incident (2026-09-21, the ClickHouse epoch-zero sentinel bug)
// showed is genuinely necessary, not theoretical, for this exact
// calculation shape.

function _oppMonitorOrdinal(n){
  if (n % 100 >= 11 && n % 100 <= 13) return n + 'th';
  const last = n % 10;
  return n + (last === 1 ? 'st' : last === 2 ? 'nd' : last === 3 ? 'rd' : 'th');
}

// {fromDay, toDay, label} for one of a month's 3 periods — label matches
// the exact "1st–10th" / "21st–31st" style already used for
// externally-sourced period_label values, so a live row's date range
// reads identically to a real one.
function _oppMonitorPeriodDayRange(yearMonth, periodNumber){
  const [y, mo] = String(yearMonth).split('-').map(Number);
  const lastDay = new Date(Date.UTC(y, mo, 0)).getUTCDate(); // day 0 of next month = last day of this one
  if (periodNumber === 1) return { fromDay: 1, toDay: 10, label: `${_oppMonitorOrdinal(1)}–${_oppMonitorOrdinal(10)}` };
  if (periodNumber === 2) return { fromDay: 11, toDay: 20, label: `${_oppMonitorOrdinal(11)}–${_oppMonitorOrdinal(20)}` };
  return { fromDay: 21, toDay: lastDay, label: `${_oppMonitorOrdinal(21)}–${_oppMonitorOrdinal(lastDay)}` };
}

function _oppMonitorDateStr(yearMonth, day){
  const [y, mo] = String(yearMonth).split('-').map(Number);
  return `${y}-${String(mo).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

// ---- Live figures: scope and coverage (fixes audit H-2, 2026-10-12) ----
//
// Live rows are computed from `allParsedLeads` -- every lead the leads tab
// holds, one row per customer -- NEVER from the global `leads`, which is
// `allParsedLeads` after the shared filter bar (default Assigned range =
// last 7 days, plus any Project/Region/Source filter picked on another
// tab). This tab hides that bar, so those filters used to silently shrink
// or skew the "company-wide" live numbers with no way to see why.
//
// Scope: Google Non-UTM/Search only -- the same rule the automatic emails
// apply (passesGoogleNonUtmSearchGs_, EmailInfra.gs) and the scope this tab
// is labelled with.
function _oppMonitorInLiveScope(l){
  if (String(l.group_source || '').trim().toLowerCase() !== 'google') return false;
  const bucket = String(l.source_bucket || '').trim().toLowerCase();
  return bucket === 'non-utm' || bucket === 'search';
}

// The leads tab is a rolling window (the MySQL import keeps roughly the
// last 7 days of assignments), so a live figure for a period that started
// before the window's first day would be computed from only part of that
// period's leads. Returns the earliest IST day (YYYY-MM-DD) any lead in
// the tab was assigned -- the first day the tab can be trusted for -- or
// null when there's nothing loaded.
function _oppMonitorLiveCoverageStart(allLeadsArr){
  let earliest = null;
  (allLeadsArr || []).forEach(l => {
    const d = parseDate(l.lead_assigned_at);
    if (d && (!earliest || d < earliest)) earliest = d;
  });
  if (!earliest) return null;
  const p = istParts(earliest);
  return `${p.y}-${String(p.mo + 1).padStart(2, '0')}-${String(p.d).padStart(2, '0')}`;
}

// A customer merged from several RM copies keeps the furthest-progressed
// copy's opp_at; the customer actually first reached Opportunity at the
// EARLIEST opp_at across its copies.
function _oppMonitorEarliestOpp(l){
  const candidates = [l].concat(Array.isArray(l.copySplits) ? l.copySplits : []);
  let earliest = null;
  candidates.forEach(c => {
    const d = parseDate(c && c.opp_at);
    if (d && (!earliest || d < earliest)) earliest = d;
  });
  return earliest;
}

// The actual metrics, scoped to in-scope leads (_oppMonitorInLiveScope)
// whose lead_assigned_at (IST calendar day) falls in [fromDay, toDay] of
// yearMonth AND on or after coverageStart (the leads tab's first trusted
// day). When the period starts before coverageStart, only the covered days
// are counted and the result is flagged `_partial` with `_coveredFrom`.
// Returns null (not a zeroed object) when the period ends before the
// coverage window or has no in-scope leads at all, so callers can tell
// "nothing to show" apart from "0 of N".
function _oppMonitorComputeLiveMetrics(leadsArr, yearMonth, fromDay, toDay, coverageStart){
  const [ty, tmo] = String(yearMonth).split('-').map(Number);
  const periodFrom = _oppMonitorDateStr(yearMonth, fromDay);
  const periodTo = _oppMonitorDateStr(yearMonth, toDay);
  if (!coverageStart || periodTo < coverageStart) return null; // the tab holds none of this period
  const partial = periodFrom < coverageStart;
  let total = 0, sameDay = 0, h48 = 0, hoursSum = 0, hoursCount = 0;
  (leadsArr || []).forEach(l => {
    if (!_oppMonitorInLiveScope(l)) return;
    const created = parseDate(l.lead_assigned_at);
    if (!created) return;
    const p = istParts(created);
    if (p.y !== ty || (p.mo + 1) !== tmo || p.d < fromDay || p.d > toDay) return;
    if (_oppMonitorDateStr(yearMonth, p.d) < coverageStart) return;
    total++;
    const opp = _oppMonitorEarliestOpp(l);
    if (!opp) return;
    const hours = (opp - created) / 36e5;
    if (hours < 0) return; // data anomaly — never a real conversion
    if (istSameDay(created, opp)) sameDay++;
    if (hours <= 48) h48++;
    hoursSum += hours;
    hoursCount++;
  });
  if (!total) return null;
  const avgHrs = hoursCount ? hoursSum / hoursCount : null;
  return {
    total_leads: total,
    same_day_count: sameDay,
    h48_count: h48,
    same_day_pct: +(sameDay / total * 100).toFixed(1),
    h48_pct: +(h48 / total * 100).toFixed(1),
    avg_hrs_to_opp: avgHrs === null ? '' : +avgHrs.toFixed(2),
    avg_days_to_opp: avgHrs === null ? '' : +(avgHrs / 24).toFixed(2),
    _live: true,
    _partial: partial,
    _coveredFrom: partial ? coverageStart : null,
  };
}

// Synthesizes a period/month row in the exact shape a real
// Opp_Monitor_Period/Month row has, so the existing render code (built
// for sheet-sourced rows) can display a live one identically, only the
// `_live`/`_partial` flags and `source` differ.
function _oppMonitorLivePeriodRow(yearMonth, periodNumber, allLeadsArr, coverageStart){
  const { fromDay, toDay, label } = _oppMonitorPeriodDayRange(yearMonth, periodNumber);
  const metrics = _oppMonitorComputeLiveMetrics(allLeadsArr, yearMonth, fromDay, toDay, coverageStart);
  if (!metrics) return null;
  return Object.assign({
    period_key: `${yearMonth}_P${periodNumber}`, year_month: yearMonth, period_number: periodNumber,
    period_label: label, date_from: _oppMonitorDateStr(yearMonth, fromDay), date_to: _oppMonitorDateStr(yearMonth, toDay),
    source: 'live',
  }, metrics);
}

function _oppMonitorLiveMonthRow(yearMonth, allLeadsArr, coverageStart){
  const [y, mo] = String(yearMonth).split('-').map(Number);
  const lastDay = new Date(Date.UTC(y, mo, 0)).getUTCDate();
  const metrics = _oppMonitorComputeLiveMetrics(allLeadsArr, yearMonth, 1, lastDay, coverageStart);
  if (!metrics) return null;
  return Object.assign({
    month_key: yearMonth, year_month: yearMonth, month_label: _oppMonitorMonthName(yearMonth),
    source: 'live',
  }, metrics);
}

function _oppMonitorStepDone(status){
  return String(status || '').trim().toLowerCase() === 'done';
}

function _oppMonitorStepChipHtml(label, status, at){
  const done = _oppMonitorStepDone(status);
  const tsHtml = done && at ? ` <span style="opacity:.7;">(${esc(String(at))})</span>` : '';
  return `<span class="chip ${done ? 'green-chip' : 'dim-chip'}" style="margin:2px 6px 2px 0;">${esc(label)}: ${done ? 'Done' : 'Pending'}${tsHtml}</span>`;
}

// --------------------------- Checklist ---------------------------

function _renderOppMonitorChecklist(){
  const container = document.getElementById('oppMonitorChecklist');
  const noticeEl = document.getElementById('oppMonitorChecklistNotice');
  const countEl = document.getElementById('oppMonitorChecklistCount');
  if (!container) return;

  // A read error (permissions/network) used to fall through to 12 silent
  // "Pending" chips, indistinguishable from "nothing done yet" (audit H-20).
  const anyError = oppMonitorPeriodFetchState === 'error' || oppMonitorMonthFetchState === 'error';
  if (anyError) {
    if (noticeEl) {
      noticeEl.style.display = 'block';
      noticeEl.textContent = 'Could not read ' + [
        oppMonitorPeriodFetchState === 'error' ? 'Opp_Monitor_Period' : null,
        oppMonitorMonthFetchState === 'error' ? 'Opp_Monitor_Month' : null,
      ].filter(Boolean).join(' / ') + ' — the checklist below can\'t show what\'s done. Check the sheet tab exists and is shared correctly, then Refresh.';
    }
    container.innerHTML = '';
    if (countEl) countEl.textContent = '';
    return;
  }
  const bothMissing = oppMonitorPeriodFetchState === 'missing' && oppMonitorMonthFetchState === 'missing';
  if (bothMissing) {
    if (noticeEl) {
      noticeEl.style.display = 'block';
      noticeEl.textContent = 'No Opp_Monitor data yet — this fills in as the recurring workflow writes results.';
    }
    container.innerHTML = '';
    if (countEl) countEl.textContent = '';
    return;
  }
  if (noticeEl) noticeEl.style.display = 'none';

  const currentYm = _oppMonitorYearMonth(_renderNow);
  const periodRowsThisMonth = oppMonitorPeriodRows.filter(r => r.year_month === currentYm);
  const monthRow = oppMonitorMonthRows.find(r => r.month_key === currentYm) || null;

  let doneCount = 0;
  let totalCount = 0;
  const blocks = [];

  [1, 2, 3].forEach(periodNum => {
    const row = periodRowsThisMonth.find(r => String(r.period_number) === String(periodNum));
    const label = row ? row.period_label : `Period ${periodNum}`;
    let chips = '';
    [1, 2, 3].forEach(stepNum => {
      totalCount++;
      const status = row ? row[`step${stepNum}_status`] : '';
      const at = row ? row[`step${stepNum}_at`] : '';
      if (_oppMonitorStepDone(status)) doneCount++;
      const stepLabel = stepNum === 1 ? 'Data collection' : stepNum === 2 ? 'Analysis' : 'Leadership email';
      chips += _oppMonitorStepChipHtml(stepLabel, status, at);
    });
    blocks.push(`<div style="margin-bottom:8px;"><span style="font-weight:600; margin-right:8px;">Period ${periodNum} (${esc(label)})</span>${chips}</div>`);
  });

  let monthChips = '';
  [1, 2, 3].forEach(stepNum => {
    totalCount++;
    const status = monthRow ? monthRow[`step${stepNum}_status`] : '';
    const at = monthRow ? monthRow[`step${stepNum}_at`] : '';
    if (_oppMonitorStepDone(status)) doneCount++;
    const stepLabel = stepNum === 1 ? 'Monthly aggregation' : stepNum === 2 ? 'Historical comparison' : 'Trend summary';
    monthChips += _oppMonitorStepChipHtml(stepLabel, status, at);
  });
  blocks.push(`<div><span style="font-weight:600; margin-right:8px;">Monthly</span>${monthChips}</div>`);

  container.innerHTML = blocks.join('');
  if (countEl) {
    countEl.textContent = `${doneCount}/${totalCount}`;
    countEl.className = 'section-count' + (doneCount === totalCount ? ' clear' : doneCount > 0 ? ' has-items' : '');
  }
}

// ---------------- Shared row rendering (period + month tables) ----------------

// A change vs the previous row is only meaningful between two rows
// measured the same way over their whole range: never across a partial
// live row (missing its earliest days), and never between an official row
// and a live one (different population and day boundary -- see the Live
// computation section above). Otherwise no delta badge is shown at all.
function _oppMonitorComparable(row, prevRow){
  if (!row || !prevRow) return false;
  if (row._partial || prevRow._partial) return false;
  return !!row._live === !!prevRow._live;
}

// A real 0 is "0", not a blank cell (audit H-19); only a missing value is blank.
function _oppMonitorCountText(v){
  return (v === '' || v == null) ? '' : String(v);
}

function _oppMonitorLiveTagHtml(row){
  if (!row._live) return '';
  const style = 'font-size:10px; padding:1px 6px;';
  if (row._partial) {
    return ` <span class="chip amber" style="${style}" title="Computed live from the leads tab, which only holds leads assigned from ${esc(row._coveredFrom)} on (it keeps about the last 7 days) -- so the earlier days of this range are missing. Not comparable with other rows; not the official figure.">Live · partial (from ${esc(row._coveredFrom)})</span>`;
  }
  return ` <span class="chip dim-chip" style="${style}" title="Computed live from the leads tab (Google Non-UTM/Search only) -- not yet the official recorded figure">Live</span>`;
}

// --------------------------- Period results table ---------------------------

function _oppMonitorOrderedPeriodSlots(){
  // Oldest first: 2-months-ago P1-3, 1-month-ago P1-3, current P1-3 — so
  // each slot's immediate predecessor in this array is unambiguously "the
  // immediately preceding period," including across a month boundary (a
  // month's P1 compares against the PRIOR month's P3).
  const currentYm = _oppMonitorYearMonth(_renderNow);
  const months = [
    _oppMonitorShiftYearMonth(currentYm, -2),
    _oppMonitorShiftYearMonth(currentYm, -1),
    currentYm,
  ];
  const slots = [];
  months.forEach(ym => {
    [1, 2, 3].forEach(periodNum => {
      slots.push({ year_month: ym, period_number: periodNum });
    });
  });
  return slots;
}

function _renderOppMonitorPeriodTable(){
  const tableEl = document.getElementById('oppMonitorPeriodTable');
  const noticeEl = document.getElementById('oppMonitorPeriodNotice');
  const countEl = document.getElementById('oppMonitorPeriodCount');
  if (!tableEl) return;
  const thead = tableEl.querySelector('thead');
  const tbody = tableEl.querySelector('tbody');

  if (oppMonitorPeriodFetchState === 'error') {
    thead.innerHTML = '';
    tbody.innerHTML = '';
    if (noticeEl) {
      noticeEl.style.display = 'block';
      noticeEl.textContent = 'Could not read Opp_Monitor_Period — check the sheet tab exists and is shared correctly.';
    }
    if (countEl) countEl.textContent = '';
    return;
  }
  if (noticeEl) noticeEl.style.display = 'none';

  const slots = _oppMonitorOrderedPeriodSlots();
  // Live rows: every lead in the leads tab (never the filtered `leads`),
  // limited to the days the tab actually holds -- see the Live computation
  // section above (audit H-2).
  const coverageStart = _oppMonitorLiveCoverageStart(allParsedLeads);
  // A missing sheet tab reads as an empty oppMonitorPeriodRows, same as a
  // present-but-empty one — either way, every slot below falls straight
  // through to its own live computation instead of a separate early return.
  const rowsBySlot = slots.map(slot => {
    const sourced = oppMonitorPeriodRows.find(r => r.year_month === slot.year_month && String(r.period_number) === String(slot.period_number));
    if (sourced) return sourced;
    return _oppMonitorLivePeriodRow(slot.year_month, slot.period_number, allParsedLeads, coverageStart);
  });

  thead.innerHTML = '<tr><th>Month</th><th>Period</th><th>Date range</th><th>Total Leads</th><th>Same-Day Opps</th><th>Same-Day Opp%</th><th>48h Opps</th><th>Within-48h Opp%</th><th>Avg Days to Opp</th><th>Avg Hrs to Opp</th></tr>';

  const bodyRows = [];
  rowsBySlot.forEach((row, i) => {
    if (!row) return; // no official row AND outside the leads tab's window (or no in-scope leads) — genuinely nothing to show
    const prevRow = i > 0 ? rowsBySlot[i - 1] : null;
    const cmpRow = _oppMonitorComparable(row, prevRow) ? prevRow : null;
    bodyRows.push(`<tr>
      <td>${esc(_oppMonitorMonthName(row.year_month))}</td>
      <td>${esc(row.period_label || `P${row.period_number}`)}${_oppMonitorLiveTagHtml(row)}</td>
      <td>${esc(row._partial ? row._coveredFrom : row.date_from)} – ${esc(row.date_to)}</td>
      <td>${esc(_oppMonitorCountText(row.total_leads))}</td>
      <td>${esc(_oppMonitorCountText(row.same_day_count))}</td>
      <td>${_oppMonitorPctCellHtml(row.same_day_pct, cmpRow ? cmpRow.same_day_pct : null)}</td>
      <td>${esc(_oppMonitorCountText(row.h48_count))}</td>
      <td>${_oppMonitorPctCellHtml(row.h48_pct, cmpRow ? cmpRow.h48_pct : null)}</td>
      <td>${row.avg_days_to_opp === '' || row.avg_days_to_opp == null ? '—' : esc(String(row.avg_days_to_opp))}</td>
      <td>${row.avg_hrs_to_opp === '' || row.avg_hrs_to_opp == null ? '—' : esc(String(row.avg_hrs_to_opp))}</td>
    </tr>`);
  });

  tbody.innerHTML = bodyRows.length ? bodyRows.join('') : '';
  if (!bodyRows.length && noticeEl) {
    noticeEl.style.display = 'block';
    noticeEl.textContent = 'No periods recorded yet for the current or previous 2 months, and no leads in that window to compute live either.';
  }
  if (countEl) countEl.textContent = bodyRows.length ? String(bodyRows.length) : '';
}

// --------------------------- Monthly trend table ---------------------------

function _renderOppMonitorMonthTable(){
  const tableEl = document.getElementById('oppMonitorMonthTable');
  const noticeEl = document.getElementById('oppMonitorMonthNotice');
  const countEl = document.getElementById('oppMonitorMonthCount');
  if (!tableEl) return;
  const thead = tableEl.querySelector('thead');
  const tbody = tableEl.querySelector('tbody');

  if (oppMonitorMonthFetchState === 'error') {
    thead.innerHTML = '';
    tbody.innerHTML = '';
    if (noticeEl) {
      noticeEl.style.display = 'block';
      noticeEl.textContent = 'Could not read Opp_Monitor_Month — check the sheet tab exists and is shared correctly.';
    }
    if (countEl) countEl.textContent = '';
    return;
  }
  if (noticeEl) noticeEl.style.display = 'none';

  const currentYm = _oppMonitorYearMonth(_renderNow);
  const months = [
    _oppMonitorShiftYearMonth(currentYm, -2),
    _oppMonitorShiftYearMonth(currentYm, -1),
    currentYm,
  ];
  const coverageStart = _oppMonitorLiveCoverageStart(allParsedLeads);
  const rowsByMonth = months.map(ym => {
    const sourced = oppMonitorMonthRows.find(r => r.month_key === ym);
    if (sourced) return sourced;
    return _oppMonitorLiveMonthRow(ym, allParsedLeads, coverageStart);
  });

  thead.innerHTML = '<tr><th>Month</th><th>Total Leads</th><th>Same-Day Opps</th><th>Same-Day Opp%</th><th>48h Opps</th><th>Within-48h Opp%</th><th>Avg Days to Opp</th><th>Avg Hrs to Opp</th></tr>';

  const bodyRows = [];
  rowsByMonth.forEach((row, i) => {
    if (!row) return; // no official row AND outside the leads tab's window (or no in-scope leads)
    const prevRow = i > 0 ? rowsByMonth[i - 1] : null;
    const cmpRow = _oppMonitorComparable(row, prevRow) ? prevRow : null;
    bodyRows.push(`<tr>
      <td>${esc(row.month_label || _oppMonitorMonthName(row.month_key))}${_oppMonitorLiveTagHtml(row)}</td>
      <td>${esc(_oppMonitorCountText(row.total_leads))}</td>
      <td>${esc(_oppMonitorCountText(row.same_day_count))}</td>
      <td>${_oppMonitorPctCellHtml(row.same_day_pct, cmpRow ? cmpRow.same_day_pct : null)}</td>
      <td>${esc(_oppMonitorCountText(row.h48_count))}</td>
      <td>${_oppMonitorPctCellHtml(row.h48_pct, cmpRow ? cmpRow.h48_pct : null)}</td>
      <td>${row.avg_days_to_opp === '' || row.avg_days_to_opp == null ? '—' : esc(String(row.avg_days_to_opp))}</td>
      <td>${row.avg_hrs_to_opp === '' || row.avg_hrs_to_opp == null ? '—' : esc(String(row.avg_hrs_to_opp))}</td>
    </tr>`);
  });

  tbody.innerHTML = bodyRows.length ? bodyRows.join('') : '';
  if (!bodyRows.length && noticeEl) {
    noticeEl.style.display = 'block';
    noticeEl.textContent = 'No monthly rollups recorded yet for the current or previous 2 months, and no leads in that window to compute live either.';
  }
  if (countEl) countEl.textContent = bodyRows.length ? String(bodyRows.length) : '';
}

function renderOppMonitorTab(){
  _renderOppMonitorChecklist();
  _renderOppMonitorPeriodTable();
  _renderOppMonitorMonthTable();
}
