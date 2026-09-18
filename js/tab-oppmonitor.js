// Opp Monitor tab — read-only display of the recurring Google Non-UTM/Search
// Same-day/48h Opp% workflow (12 steps/month: 3 periods x 3 steps + 3
// month-level steps, tracked as its own recurring cycle in a separate
// To-Do Dashboard tool this file has no connection to). This app never
// computes any of these numbers — an external analytics session writes
// completed results into Opp_Monitor_Period / Opp_Monitor_Month by hand;
// this file only fetches and renders whatever is already there. Unlike
// every other tab, this one reads neither `leads` nor `filterState` — its
// data is a fixed monthly aggregate, not sliceable by Project/Region/TL/
// Source/Sub-source (see the filter-bar-hiding block in
// overview-distribution-people-ops.js's tab-switch handler).

const OPP_MONITOR_PERIOD_TAB_NAME = 'Opp_Monitor_Period';
const OPP_MONITOR_MONTH_TAB_NAME = 'Opp_Monitor_Month';

const OPP_MONITOR_PERIOD_COLUMNS = [
  'period_key', 'year_month', 'period_number', 'period_label', 'date_from', 'date_to',
  'total_leads', 'same_day_count', 'h48_count', 'same_day_pct', 'h48_pct',
  'step1_status', 'step1_at', 'step2_status', 'step2_at', 'step3_status', 'step3_at',
  'updated_at', 'source',
];
const OPP_MONITOR_MONTH_COLUMNS = [
  'month_key', 'year_month', 'month_label',
  'total_leads', 'same_day_count', 'h48_count', 'same_day_pct', 'h48_pct',
  'step1_status', 'step1_at', 'step2_status', 'step2_at', 'step3_status', 'step3_at',
  'updated_at', 'source',
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

  if (oppMonitorPeriodFetchState === 'missing' || oppMonitorPeriodFetchState === 'error') {
    thead.innerHTML = '';
    tbody.innerHTML = '';
    if (noticeEl) {
      noticeEl.style.display = 'block';
      noticeEl.textContent = oppMonitorPeriodFetchState === 'error'
        ? 'Could not read Opp_Monitor_Period — check the sheet tab exists and is shared correctly.'
        : 'No periods recorded yet.';
    }
    if (countEl) countEl.textContent = '';
    return;
  }
  if (noticeEl) noticeEl.style.display = 'none';

  const slots = _oppMonitorOrderedPeriodSlots();
  const rowsBySlot = slots.map(slot => oppMonitorPeriodRows.find(r => r.year_month === slot.year_month && String(r.period_number) === String(slot.period_number)) || null);

  thead.innerHTML = '<tr><th>Month</th><th>Period</th><th>Date range</th><th>Total Leads</th><th>Same-Day Opp%</th><th>Within-48h Opp%</th></tr>';

  const bodyRows = [];
  rowsBySlot.forEach((row, i) => {
    if (!row) return; // no backfill — absent slots are simply not shown, never a dash placeholder
    const prevRow = i > 0 ? rowsBySlot[i - 1] : null;
    bodyRows.push(`<tr>
      <td>${esc(row.year_month)}</td>
      <td>${esc(row.period_label || `P${row.period_number}`)}</td>
      <td>${esc(row.date_from)} – ${esc(row.date_to)}</td>
      <td>${esc(String(row.total_leads || ''))}</td>
      <td>${_oppMonitorPctCellHtml(row.same_day_pct, prevRow ? prevRow.same_day_pct : null)}</td>
      <td>${_oppMonitorPctCellHtml(row.h48_pct, prevRow ? prevRow.h48_pct : null)}</td>
    </tr>`);
  });

  tbody.innerHTML = bodyRows.length ? bodyRows.join('') : '';
  if (!bodyRows.length && noticeEl) {
    noticeEl.style.display = 'block';
    noticeEl.textContent = 'No periods recorded yet for the current or previous 2 months.';
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

  if (oppMonitorMonthFetchState === 'missing' || oppMonitorMonthFetchState === 'error') {
    thead.innerHTML = '';
    tbody.innerHTML = '';
    if (noticeEl) {
      noticeEl.style.display = 'block';
      noticeEl.textContent = oppMonitorMonthFetchState === 'error'
        ? 'Could not read Opp_Monitor_Month — check the sheet tab exists and is shared correctly.'
        : 'No monthly rollups recorded yet.';
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
  const rowsByMonth = months.map(ym => oppMonitorMonthRows.find(r => r.month_key === ym) || null);

  thead.innerHTML = '<tr><th>Month</th><th>Total Leads</th><th>Same-Day Opp%</th><th>Within-48h Opp%</th></tr>';

  const bodyRows = [];
  rowsByMonth.forEach((row, i) => {
    if (!row) return; // no backfill
    const prevRow = i > 0 ? rowsByMonth[i - 1] : null;
    bodyRows.push(`<tr>
      <td>${esc(row.month_label || row.month_key)}</td>
      <td>${esc(String(row.total_leads || ''))}</td>
      <td>${_oppMonitorPctCellHtml(row.same_day_pct, prevRow ? prevRow.same_day_pct : null)}</td>
      <td>${_oppMonitorPctCellHtml(row.h48_pct, prevRow ? prevRow.h48_pct : null)}</td>
    </tr>`);
  });

  tbody.innerHTML = bodyRows.length ? bodyRows.join('') : '';
  if (!bodyRows.length && noticeEl) {
    noticeEl.style.display = 'block';
    noticeEl.textContent = 'No monthly rollups recorded yet for the current or previous 2 months.';
  }
  if (countEl) countEl.textContent = bodyRows.length ? String(bodyRows.length) : '';
}

function renderOppMonitorTab(){
  _renderOppMonitorChecklist();
  _renderOppMonitorPeriodTable();
  _renderOppMonitorMonthTable();
}
