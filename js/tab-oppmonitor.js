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
// It DOES now read the global `leads` array (added 2026-09-21, once the
// source `leads` tab gained a real `opp_at` column — HEADER_ALIASES,
// core-sheets-fetch.js): for any period/month slot with no
// externally-sourced row yet, it computes the same metrics itself,
// straight from lead_assigned_at vs opp_at, and renders that as a
// clearly-labeled "Live" row instead of leaving the slot empty. A slot
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
// Everything below computes the SAME metrics Opp_Monitor_Period/Month
// store, directly from the in-memory `leads` array, for whichever
// period/month slots don't have a real externally-sourced row yet. Method
// matches the external analytics session's own methodology exactly (same
// scoping the Opp Monitor workflow was designed around): same-day = the
// lead's first Opportunity-stage transition (opp_at) falls on the same
// IST calendar day as lead_assigned_at; within-48h = the gap is <=48
// hours; a lead that never reached Opportunity (opp_at blank) counts
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

// The actual metrics, scoped to leads whose lead_assigned_at (IST
// calendar day) falls in [fromDay, toDay] of yearMonth. Returns null (not
// a zeroed object) when there are no leads in scope at all, so callers
// can tell "genuinely nothing happened" apart from "0 of 0."
function _oppMonitorComputeLiveMetrics(leadsArr, yearMonth, fromDay, toDay){
  const [ty, tmo] = String(yearMonth).split('-').map(Number);
  let total = 0, sameDay = 0, h48 = 0, hoursSum = 0, hoursCount = 0;
  (leadsArr || []).forEach(l => {
    const created = parseDate(l.lead_assigned_at);
    if (!created) return;
    const p = istParts(created);
    if (p.y !== ty || (p.mo + 1) !== tmo || p.d < fromDay || p.d > toDay) return;
    total++;
    const opp = parseDate(l.opp_at);
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
  };
}

// Synthesizes a period/month row in the exact shape a real
// Opp_Monitor_Period/Month row has, so the existing render code (built
// for sheet-sourced rows) can display a live one identically, only the
// `_live` flag and `source` differ.
function _oppMonitorLivePeriodRow(yearMonth, periodNumber, leadsArr){
  const { fromDay, toDay, label } = _oppMonitorPeriodDayRange(yearMonth, periodNumber);
  const metrics = _oppMonitorComputeLiveMetrics(leadsArr, yearMonth, fromDay, toDay);
  if (!metrics) return null;
  return Object.assign({
    period_key: `${yearMonth}_P${periodNumber}`, year_month: yearMonth, period_number: periodNumber,
    period_label: label, date_from: _oppMonitorDateStr(yearMonth, fromDay), date_to: _oppMonitorDateStr(yearMonth, toDay),
    source: 'live',
  }, metrics);
}

function _oppMonitorLiveMonthRow(yearMonth, leadsArr){
  const [y, mo] = String(yearMonth).split('-').map(Number);
  const lastDay = new Date(Date.UTC(y, mo, 0)).getUTCDate();
  const metrics = _oppMonitorComputeLiveMetrics(leadsArr, yearMonth, 1, lastDay);
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
  // A missing sheet tab reads as an empty oppMonitorPeriodRows, same as a
  // present-but-empty one — either way, every slot below falls straight
  // through to its own live computation instead of a separate early return.
  const rowsBySlot = slots.map(slot => {
    const sourced = oppMonitorPeriodRows.find(r => r.year_month === slot.year_month && String(r.period_number) === String(slot.period_number));
    if (sourced) return sourced;
    return _oppMonitorLivePeriodRow(slot.year_month, slot.period_number, leads);
  });

  thead.innerHTML = '<tr><th>Month</th><th>Period</th><th>Date range</th><th>Total Leads</th><th>Same-Day Opps</th><th>Same-Day Opp%</th><th>48h Opps</th><th>Within-48h Opp%</th><th>Avg Days to Opp</th><th>Avg Hrs to Opp</th></tr>';

  const bodyRows = [];
  rowsBySlot.forEach((row, i) => {
    if (!row) return; // no backfill AND no leads in scope yet — genuinely nothing to show
    const prevRow = i > 0 ? rowsBySlot[i - 1] : null;
    const liveTag = row._live ? ' <span class="chip dim-chip" style="font-size:10px; padding:1px 6px;" title="Computed live from the leads tab — not yet the official recorded figure">Live</span>' : '';
    bodyRows.push(`<tr>
      <td>${esc(_oppMonitorMonthName(row.year_month))}</td>
      <td>${esc(row.period_label || `P${row.period_number}`)}${liveTag}</td>
      <td>${esc(row.date_from)} – ${esc(row.date_to)}</td>
      <td>${esc(String(row.total_leads || ''))}</td>
      <td>${esc(String(row.same_day_count || ''))}</td>
      <td>${_oppMonitorPctCellHtml(row.same_day_pct, prevRow ? prevRow.same_day_pct : null)}</td>
      <td>${esc(String(row.h48_count || ''))}</td>
      <td>${_oppMonitorPctCellHtml(row.h48_pct, prevRow ? prevRow.h48_pct : null)}</td>
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
  const rowsByMonth = months.map(ym => {
    const sourced = oppMonitorMonthRows.find(r => r.month_key === ym);
    if (sourced) return sourced;
    return _oppMonitorLiveMonthRow(ym, leads);
  });

  thead.innerHTML = '<tr><th>Month</th><th>Total Leads</th><th>Same-Day Opps</th><th>Same-Day Opp%</th><th>48h Opps</th><th>Within-48h Opp%</th><th>Avg Days to Opp</th><th>Avg Hrs to Opp</th></tr>';

  const bodyRows = [];
  rowsByMonth.forEach((row, i) => {
    if (!row) return; // no backfill AND no leads in scope yet
    const prevRow = i > 0 ? rowsByMonth[i - 1] : null;
    const liveTag = row._live ? ' <span class="chip dim-chip" style="font-size:10px; padding:1px 6px;" title="Computed live from the leads tab — not yet the official recorded figure">Live</span>' : '';
    bodyRows.push(`<tr>
      <td>${esc(row.month_label || _oppMonitorMonthName(row.month_key))}${liveTag}</td>
      <td>${esc(String(row.total_leads || ''))}</td>
      <td>${esc(String(row.same_day_count || ''))}</td>
      <td>${_oppMonitorPctCellHtml(row.same_day_pct, prevRow ? prevRow.same_day_pct : null)}</td>
      <td>${esc(String(row.h48_count || ''))}</td>
      <td>${_oppMonitorPctCellHtml(row.h48_pct, prevRow ? prevRow.h48_pct : null)}</td>
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
