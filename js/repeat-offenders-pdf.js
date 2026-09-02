// ============================================================
// repeat-offenders-pdf.js — "Download PDF" export for the Repeat
// Offenders tab. Rebuilt (2026-09-02, v2) to follow whichever Time range
// filter is CURRENTLY SELECTED on screen — Yesterday exports only
// yesterday, Last 7 Days exports only the last 7 days (broken out by
// individual date), This Week the same, From when history began exports
// one unscoped summary, Custom range exports its picked span broken out
// by date — rather than the original fixed "last 3 days + Last 7 Days"
// scheme. Every date/range is computed via repeatOffendersDateKeysForRange
// (tab-repeat-offenders.js), the EXACT function the live page's own
// Time range dropdown uses, so the PDF can never show a different dataset
// than what's on screen for that filter.
//
// v2 also replaces the original screenshot-based approach (html2canvas +
// one raster image per page) with REAL vector tables via jsPDF's
// autoTable plugin — actual text and cell borders, selectable/searchable
// in the resulting PDF, not a picture of the UI. autoTable's own
// pageBreak:'avoid' option is what guarantees a table is moved WHOLE to
// the next page rather than ever split mid-table; multiple small tables
// are free to share a page since each only advances the page cursor by
// its own actual height.
//
// Depends on js/tab-repeat-offenders.js (dailyRmIssues,
// dailyRmIssuesFetchState, rmHierarchyFetchState, aggregateRepeatOffenders,
// primaryManagerForRm, rhForRm, _repeatOffendersRegionKey,
// passesRepeatOffenderFilters, repeatOffendersDateKeysForRange) and
// js/core-foundation.js (istDateKey) / js/core-outcome-engine.js (istStamp)
// / js/reports-build.js (IST_MONTHS) — all loaded earlier in
// dashboard.html, but this only ever runs on a user click, well after
// every js/*.js file has finished loading, so exact script order doesn't
// matter here (same reasoning core-foundation.js's own header comment
// gives). Also needs jsPDF + jspdf-autotable (loaded in dashboard.html's
// <head>).
// ============================================================

let _repeatOffendersPdfGenerating = false;

const REPEAT_OFFENDERS_PDF_FILTER_NAMES_ = {
  yesterday: 'YESTERDAY',
  thisWeek: 'THIS WEEK',
  last7Days: 'LAST 7 DAYS',
  allTime: 'FROM WHEN HISTORY BEGAN',
  custom: 'CUSTOM RANGE',
};

// "YYYY-MM-DD" -> "Sep 2, 2026" — matches the header example format
// exactly. Reuses IST_MONTHS (reports-build.js) rather than a second
// hardcoded month-name list.
function _repeatOffendersPdfFormatDate(dayKey){
  const parts = dayKey.split('-');
  const y = Number(parts[0]), m = Number(parts[1]), d = Number(parts[2]);
  return IST_MONTHS[m - 1] + ' ' + d + ', ' + y;
}

// null dateKeys (allTime, or an incomplete custom range — see
// repeatOffendersDateKeysForRange's own comment) => no specific date to
// show. One key => "Date: ...". More than one => "Date Range: ... – ...".
function _repeatOffendersPdfDateLine(dateKeys){
  if (dateKeys === null) return null;
  const sorted = Array.from(dateKeys).sort();
  if (!sorted.length) return null;
  if (sorted.length === 1) return 'Date: ' + _repeatOffendersPdfFormatDate(sorted[0]);
  return 'Date Range: ' + _repeatOffendersPdfFormatDate(sorted[0]) + ' – ' + _repeatOffendersPdfFormatDate(sorted[sorted.length - 1]);
}

// Reads the live page's OWN current filter state — same range select,
// same repeatOffendersDateKeysForRange call, same usesAssignedDate rule
// renderRepeatOffenders itself uses (Yesterday/Custom => assigned date,
// This Week/Last 7 Days => capture date, All-time => no date filter at
// all) — so the PDF can never independently invent a different dataset
// than what's currently on screen.
function _repeatOffendersPdfCurrentFilterInfo(){
  const rangeSel = document.getElementById('repeatOffendersRangeSelect');
  const range = rangeSel ? rangeSel.value : 'last7Days';
  const now = (typeof _renderNow !== 'undefined' && _renderNow) ? _renderNow : new Date();
  const dateKeys = repeatOffendersDateKeysForRange(range, now);
  const usesAssignedDate = (range === 'yesterday' || range === 'custom');
  return {
    range: range,
    now: now,
    dateKeys: dateKeys,
    usesAssignedDate: usesAssignedDate,
    displayName: REPEAT_OFFENDERS_PDF_FILTER_NAMES_[range] || String(range).toUpperCase(),
    dateLine: _repeatOffendersPdfDateLine(dateKeys),
  };
}

// One table candidate for a date/section: { title, list } (the same
// `list` shape aggregateRepeatOffenders returns). Filters out empty
// candidates and the two hierarchy-dependent rollups when RM_Hierarchy
// isn't loaded — repeatOffenderTableHtml would otherwise print a "could
// not be read" placeholder row on screen, which isn't real data worth a
// PDF page.
function _repeatOffendersPdfSectionTables(dateKeys, useAssignedDate){
  const dateOnlyScoped = dailyRmIssues.filter(rec => !dateKeys || dateKeys.has(useAssignedDate ? rec.leadAssignedDateKey : rec.date));
  const scoped = dateOnlyScoped.filter(passesRepeatOffenderFilters);
  if (!scoped.length) return [];

  const rmListFull = aggregateRepeatOffenders(scoped, rec => rec.RM);
  const hierarchyMissing = rmHierarchyFetchState !== 'ok';
  const candidates = [
    { title: 'Top 20 RMs', list: rmListFull.slice(0, 20) },
    { title: 'Top 20 RMs (Leads > 50)', list: rmListFull.filter(r => r.distinctLeads > 50).slice(0, 20) },
    { title: 'Top 20 RMs (Leads > 100)', list: rmListFull.filter(r => r.distinctLeads > 100).slice(0, 20) },
    { title: 'By Region', list: aggregateRepeatOffenders(scoped, rec => _repeatOffendersRegionKey(rec)).slice(0, 15) },
    { title: 'Top 10 A1 / TM', list: hierarchyMissing ? [] : aggregateRepeatOffenders(scoped, rec => primaryManagerForRm(rec.RM)).slice(0, 10) },
    { title: 'Top 5 RH', list: hierarchyMissing ? [] : aggregateRepeatOffenders(scoped, rec => rhForRm(rec.RM)).slice(0, 5) },
  ];
  return candidates.filter(c => c.list.length > 0);
}

// Full ordered list of page specs: { dateLabel, title, list }.
// - allTime (or an incomplete custom range): dateKeys is null => ONE
//   unscoped section, dateLabel null (no per-date breakdown makes sense
//   over unbounded history).
// - Every other filter: broken out by INDIVIDUAL date, most recent
//   first, so "the reader can tell which day's data they are viewing"
//   even when the filter spans several days (Last 7 Days, This Week, or
//   a multi-day Custom range). A date with nothing populated across all
//   6 candidate tables is simply never added — no heading, no
//   placeholder, exactly the same omission rule a single table gets.
function _repeatOffendersPdfBuildPageSpecs(filterInfo){
  const specs = [];
  if (filterInfo.dateKeys === null) {
    _repeatOffendersPdfSectionTables(null, filterInfo.usesAssignedDate)
      .forEach(t => specs.push({ dateLabel: null, title: t.title, list: t.list }));
    return specs;
  }
  const sortedDayKeys = Array.from(filterInfo.dateKeys).sort().reverse(); // most recent first
  sortedDayKeys.forEach(function (dayKey) {
    const tables = _repeatOffendersPdfSectionTables(new Set([dayKey]), filterInfo.usesAssignedDate);
    if (!tables.length) return; // nothing populated for this date — omit entirely
    const dateLabel = _repeatOffendersPdfFormatDate(dayKey);
    tables.forEach(t => specs.push({ dateLabel: dateLabel, title: t.title, list: t.list }));
  });
  return specs;
}

// One line describing the currently-active top-bar filters (or their
// absence) — printed in the PDF header so the report is self-explanatory
// about its own scope without needing the live dashboard open alongside it.
function _repeatOffendersPdfFilterSummaryLine(){
  const parts = [];
  if (filterState.project.size) parts.push('Project: ' + Array.from(filterState.project).join(', '));
  if (filterState.region.size) parts.push('Region: ' + Array.from(filterState.region).join(', '));
  if (filterState.TL.size) parts.push('TL: ' + Array.from(filterState.TL).join(', '));
  if (filterState.source.size) parts.push('Source: ' + Array.from(filterState.source).join(', '));
  if (filterState.bucket.size) parts.push('Sub-source: ' + Array.from(filterState.bucket).join(', '));
  return parts.length ? parts.join(' · ') : null;
}

// Converts one aggregateRepeatOffenders() row into the exact same 6
// columns repeatOffenderTableHtml shows on screen (#, Name (+RM count),
// Leads, Instances, Avg Flagged, Top Issues) — plain strings for
// autoTable, no HTML/markup involved.
function _repeatOffendersPdfTableRows(list){
  return list.map(function (r, i) {
    const topIssues = Object.keys(r.byIssue).sort((a, b) => r.byIssue[b] - r.byIssue[a]).slice(0, 2)
      .map(k => (r.byIssueLabel[k] || k) + ': ' + r.byIssue[k]).join('    ');
    const name = r.name + (r.distinctRMs > 1 ? ' (' + r.distinctRMs + ' RMs)' : '');
    return [String(i + 1), name, String(r.distinctLeads), String(r.totalInstances), (r.totalInstances / r.distinctLeads).toFixed(1) + 'x', topIssues];
  });
}

const REPEAT_OFFENDERS_PDF_MARGIN_ = 40;
const REPEAT_OFFENDERS_PDF_TABLE_GAP_ = 20;

// Starts a fresh page if fewer than minSpace points remain below the
// current cursor — used before a date heading and before a table's own
// title line, so neither is ever left stranded at the very bottom of a
// page with its content pushed to the next one (the table itself is
// additionally protected by autoTable's own pageBreak:'avoid' below
// regardless of how accurate this estimate is).
function _repeatOffendersPdfEnsureRoom(doc, y, minSpace){
  const pageH = doc.internal.pageSize.getHeight();
  if (pageH - y < minSpace) {
    doc.addPage('a4', 'portrait');
    return REPEAT_OFFENDERS_PDF_MARGIN_;
  }
  return y;
}

// A real (if approximate) height estimate for the table BEFORE handing it
// to autoTable — the room-check below needs this, not a fixed guess, to
// actually keep a heading/title attached to its table. A row is ~fontSize
// + 2*cellPadding + a little leading; "Top Issues" is capped at 2 issue
// entries by _repeatOffendersPdfSectionTables, so it wraps to at most a
// couple of lines even in the worst case — the flat per-row constants
// below already budget for that, so this stays a same-order-of-magnitude
// estimate without needing to actually measure wrapped text width.
function _repeatOffendersPdfEstimateTableHeight(rowCount, compact){
  const rowH = compact ? 15 : 20;
  const headerH = compact ? 20 : 26;
  return headerH + rowCount * rowH;
}

// Builds the whole PDF as real vector content — no canvas, no images.
// One doc.autoTable() call per table; each only advances the page cursor
// by its own actual rendered height, so several small tables naturally
// pack onto one page, while pageBreak:'avoid' moves a table that would
// NOT fit in the remaining space to a fresh page whole, never splitting
// it. A table whose row count is unusually large (beyond this app's own
// current 20-row cap on every candidate table) drops to a smaller font
// instead — the same "appropriate layout for a large table" strategy in
// spirit, chosen over a landscape-orientation switch specifically
// because it composes safely with the page-cursor/heading-room tracking
// above without the added complexity of mixing page orientations.
function _repeatOffendersPdfRenderPages(specs, filterInfo){
  const jsPDFCtor = (window.jspdf && window.jspdf.jsPDF) || window.jsPDF;
  if (!jsPDFCtor) throw new Error('PDF library failed to load — check your connection and try again.');
  const doc = new jsPDFCtor({ orientation: 'portrait', unit: 'pt', format: 'a4' });
  if (typeof doc.autoTable !== 'function') throw new Error('PDF table library failed to load — check your connection and try again.');

  const pageW = doc.internal.pageSize.getWidth();
  let y = REPEAT_OFFENDERS_PDF_MARGIN_;

  // ---- Report header (real vector text — title, active filter, date/range) ----
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(18);
  doc.setTextColor(20, 23, 28);
  doc.text('REPEAT OFFENDERS REPORT', REPEAT_OFFENDERS_PDF_MARGIN_, y);
  y += 8;
  doc.setDrawColor(245, 154, 0); // Homesfy brand gold — same accent the live app's own header/loading screens use
  doc.setLineWidth(2);
  doc.line(REPEAT_OFFENDERS_PDF_MARGIN_, y, REPEAT_OFFENDERS_PDF_MARGIN_ + 46, y);
  y += 22;

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.setTextColor(70, 75, 85);
  doc.text('Filter: ' + filterInfo.displayName, REPEAT_OFFENDERS_PDF_MARGIN_, y);
  y += 16;
  if (filterInfo.dateLine) {
    doc.setFont('helvetica', 'normal');
    doc.text(filterInfo.dateLine, REPEAT_OFFENDERS_PDF_MARGIN_, y);
    y += 16;
  }
  const filterSummaryLine = _repeatOffendersPdfFilterSummaryLine();
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(145, 150, 160);
  // istStamp() already appends "IST" itself (e.g. "2026-09-02 07:46 PM IST") — no separate suffix needed here.
  doc.text('Generated ' + istStamp(new Date()) + (filterSummaryLine ? '   ·   ' + filterSummaryLine : ''), REPEAT_OFFENDERS_PDF_MARGIN_, y);
  y += 14;
  doc.setDrawColor(220, 223, 228);
  doc.setLineWidth(1);
  doc.line(REPEAT_OFFENDERS_PDF_MARGIN_, y, pageW - REPEAT_OFFENDERS_PDF_MARGIN_, y);
  y += 22;

  let currentDateLabel; // undefined sentinel — first spec always draws its own heading (or none, if dateLabel is null)
  let firstSection = true;
  const pageUsableH = doc.internal.pageSize.getHeight() - REPEAT_OFFENDERS_PDF_MARGIN_ * 2;

  specs.forEach(function (spec) {
    const rows = _repeatOffendersPdfTableRows(spec.list);
    const compact = rows.length > 20; // beyond this app's own current per-table cap — defensive, not expected to trigger today
    // Clamped to one full page's worth: a table taller than that can never
    // fit regardless of where it starts, so there's nothing more this
    // check can do for it — autoTable's own pageBreak:'avoid' still keeps
    // it from being SPLIT, it just runs past the estimate in that rare case.
    const estTableH = Math.min(_repeatOffendersPdfEstimateTableHeight(rows.length, compact), pageUsableH);
    const TITLE_H = 26;
    const isNewDate = spec.dateLabel !== currentDateLabel;
    const DATE_HEADING_H = isNewDate && spec.dateLabel ? 32 : 0;

    // ONE combined room check covering date heading (if this table starts
    // a new date section) + table title + the table's own estimated
    // height — so a heading/title is never drawn on a page that can't
    // also fit at least the start of its table (the exact bug a fixed,
    // too-small minSpace guess produced: "By Region" printed at the
    // bottom of a page with the actual table pushed to the next one).
    y = _repeatOffendersPdfEnsureRoom(doc, y, DATE_HEADING_H + TITLE_H + estTableH);

    if (isNewDate) {
      currentDateLabel = spec.dateLabel;
      if (!firstSection) y += 8; // small extra breathing room between date sections
      if (spec.dateLabel) {
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(11);
        doc.setTextColor(55, 59, 68);
        doc.text('DATE: ' + spec.dateLabel.toUpperCase(), REPEAT_OFFENDERS_PDF_MARGIN_, y);
        y += 8;
        doc.setDrawColor(230, 232, 236);
        doc.setLineWidth(0.75);
        doc.line(REPEAT_OFFENDERS_PDF_MARGIN_, y, pageW - REPEAT_OFFENDERS_PDF_MARGIN_, y);
        y += 16;
      }
    }
    firstSection = false;

    // Table title
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10.5);
    doc.setTextColor(30, 33, 38);
    doc.text(spec.title, REPEAT_OFFENDERS_PDF_MARGIN_, y);
    y += 12;
    doc.autoTable({
      startY: y,
      head: [['#', 'Name', 'Leads', 'Instances', 'Avg Flagged', 'Top Issues']],
      body: rows,
      theme: 'grid',
      styles: {
        fontSize: compact ? 7 : 8.5, cellPadding: compact ? 3 : 5,
        textColor: [35, 38, 44], lineColor: [222, 225, 230], lineWidth: 0.6, overflow: 'linebreak',
      },
      headStyles: { fillColor: [23, 27, 33], textColor: [235, 237, 240], fontStyle: 'bold', fontSize: compact ? 7 : 8.5 },
      alternateRowStyles: { fillColor: [246, 247, 249] },
      columnStyles: {
        0: { cellWidth: 22, halign: 'right' },
        1: { cellWidth: 130 },
        2: { cellWidth: 44, halign: 'right' },
        3: { cellWidth: 56, halign: 'right' },
        4: { cellWidth: 68, halign: 'right' },
        5: { cellWidth: 'auto' },
      },
      margin: { left: REPEAT_OFFENDERS_PDF_MARGIN_, right: REPEAT_OFFENDERS_PDF_MARGIN_, bottom: REPEAT_OFFENDERS_PDF_MARGIN_ },
      pageBreak: 'avoid',    // the whole table moves to a fresh page if it doesn't fit — never split mid-table
      rowPageBreak: 'avoid', // a single row's own text is never cut across a page boundary either
    });
    y = doc.lastAutoTable.finalY + REPEAT_OFFENDERS_PDF_TABLE_GAP_;
  });

  // ---- Page numbers (drawn last, once every page exists) ----
  const pageCount = doc.internal.getNumberOfPages();
  for (let p = 1; p <= pageCount; p++) {
    doc.setPage(p);
    const pw = doc.internal.pageSize.getWidth();
    const ph = doc.internal.pageSize.getHeight();
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8.5);
    doc.setTextColor(150, 154, 162);
    doc.text('Page ' + p + ' of ' + pageCount, pw / 2, ph - 18, { align: 'center' });
  }

  return doc;
}

// The button's click handler. Guards: a duplicate click while already
// generating is a no-op (not queued, not restarted); no Daily_RM_Issues
// data yet, or genuinely nothing to report for the CURRENTLY SELECTED
// filter, shows a clear inline status message instead of downloading a
// blank/near-blank PDF.
async function downloadRepeatOffendersPdf(){
  if (_repeatOffendersPdfGenerating) return;
  const btn = document.getElementById('repeatOffendersDownloadPdfBtn');
  const statusEl = document.getElementById('repeatOffendersPdfStatus');

  if (dailyRmIssuesFetchState === 'loading') {
    if (statusEl) { statusEl.textContent = 'Still loading Daily_RM_Issues — try again in a moment.'; statusEl.style.color = 'var(--amber)'; }
    return;
  }
  if (dailyRmIssuesFetchState !== 'ok' || !dailyRmIssues.length) {
    if (statusEl) { statusEl.textContent = 'No Daily_RM_Issues data loaded yet — nothing to export.'; statusEl.style.color = 'var(--amber)'; }
    return;
  }

  _repeatOffendersPdfGenerating = true;
  const originalLabel = btn ? btn.textContent : '';
  if (btn) { btn.disabled = true; btn.textContent = 'Generating PDF…'; }
  if (statusEl) { statusEl.textContent = ''; statusEl.style.color = 'var(--text-faint)'; }

  try {
    const filterInfo = _repeatOffendersPdfCurrentFilterInfo();
    const specs = _repeatOffendersPdfBuildPageSpecs(filterInfo);
    if (!specs.length) {
      if (statusEl) { statusEl.textContent = 'No data available for the selected period.'; statusEl.style.color = 'var(--amber)'; }
      return;
    }
    const doc = _repeatOffendersPdfRenderPages(specs, filterInfo);
    const filenameDate = istDateKey(new Date());
    doc.save(`Repeat-Offender-Report-${filenameDate}.pdf`);
    const pageCount = doc.internal.getNumberOfPages();
    if (statusEl) { statusEl.textContent = `Downloaded (${pageCount} page${pageCount === 1 ? '' : 's'}).`; statusEl.style.color = 'var(--green)'; }
  } catch (err) {
    console.error('downloadRepeatOffendersPdf failed:', err);
    if (statusEl) { statusEl.textContent = 'Could not generate PDF: ' + ((err && err.message) || String(err)); statusEl.style.color = 'var(--red)'; }
  } finally {
    _repeatOffendersPdfGenerating = false;
    if (btn) { btn.disabled = false; btn.textContent = originalLabel || 'Download PDF'; }
  }
}

// Top-level, same reasoning as tab-repeat-offenders.js's own wiring right
// below this file in the load order — the button already exists in the
// static HTML by the time this script runs.
const _repeatOffendersDownloadPdfBtnEl = document.getElementById('repeatOffendersDownloadPdfBtn');
if (_repeatOffendersDownloadPdfBtnEl) _repeatOffendersDownloadPdfBtnEl.addEventListener('click', downloadRepeatOffendersPdf);
