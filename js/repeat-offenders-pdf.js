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
// 2026-09-04, Phase 3 of the RM Performance redesign (HANDOVER.md §9.7):
// rebuilt AGAIN to match Phase 2's live-tab rewrite — this export now
// mirrors computeRmPerformance()'s workload-normalized, confidence-aware
// methodology instead of the old "Avg Flagged" ranking, via the exact
// same core-rm-performance.js engine the live tab uses (never a separate
// PDF-side reimplementation). See core-rm-performance.js's own header
// comment for the full methodology.
//
// Depends on js/tab-repeat-offenders.js (rmHierarchyFetchState,
// repeatOffendersDateKeysForRange, captureRepeatOffendersFilterSnapshot),
// js/core-rm-performance.js (computeRmPerformance, rmPerfPrimaryManagerFor,
// rmPerfRhFor, repeatOffendersRegionKey, filterRmPerformanceRankable,
// sortRmPerformanceByScore, rmPerformanceDrivenBy
// — shared with the live tab so "what's driving an elevated score" and
// "what order to list groups in" can never quietly drift apart between
// the two surfaces), js/tab-movement.js (movementFetchState,
// movementSnapshots, movementFetchError) and js/core-foundation.js
// (istDateKey) / js/core-outcome-engine.js (istStamp) / js/reports-build.js
// (IST_MONTHS) — all loaded earlier in dashboard.html, but this only ever
// runs on a user click, well after every js/*.js file has finished
// loading, so exact script order doesn't matter here (same reasoning
// core-foundation.js's own header comment gives). Also needs jsPDF +
// jspdf-autotable (loaded in dashboard.html's <head>).
// ============================================================

let _repeatOffendersPdfGenerating = false;

const REPEAT_OFFENDERS_PDF_FILTER_NAMES_ = {
  yesterday: 'YESTERDAY',
  thisWeek: 'THIS WEEK',
  last7Days: 'LAST 7 DAYS',
  allTime: 'FROM WHEN HISTORY BEGAN',
  custom: 'CUSTOM RANGE',
};

// null dateKeys (allTime, or an incomplete custom range — see
// repeatOffendersDateKeysForRange's own comment) => no specific date to
// show. One key => "Date: ...". More than one => "Date Range: ... – ...".
// Built from repeatOffendersResolvedDateRange + repeatOffendersFormatDate
// (tab-repeat-offenders.js) — the SAME shared functions the live page's
// own From/To range display uses (2026-09-07), not a second independent
// date-formatting/range-resolution — so the PDF's header can never show
// a different range than what's on screen for the same filter.
function _repeatOffendersPdfDateLine(dateKeys){
  const resolved = repeatOffendersResolvedDateRange(dateKeys);
  if (!resolved) return null;
  if (resolved.from === resolved.to) return 'Date: ' + resolved.fromFormatted;
  return 'Date Range: ' + resolved.fromFormatted + ' – ' + resolved.toFormatted;
}

// Reads the live page's OWN current filter state — same range select,
// same repeatOffendersDateKeysForRange call renderRepeatOffenders itself
// uses — so the PDF can never independently invent a different dataset
// than what's currently on screen. No more usesAssignedDate: the
// pre-2026-09-04 engine matched EITHER a lead's assignment date OR its
// flagged-capture date depending on the selected range; the new
// computeRmPerformance() engine always matches a lead-day against its own
// Movement_Log OBSERVATION day, the same for every range — see
// core-rm-performance.js's own header comment.
function _repeatOffendersPdfCurrentFilterInfo(){
  const rangeSel = document.getElementById('repeatOffendersRangeSelect');
  const range = rangeSel ? rangeSel.value : 'last7Days';
  const now = (typeof _renderNow !== 'undefined' && _renderNow) ? _renderNow : new Date();
  const dateKeys = repeatOffendersDateKeysForRange(range, now);
  return {
    range: range,
    now: now,
    dateKeys: dateKeys,
    displayName: REPEAT_OFFENDERS_PDF_FILTER_NAMES_[range] || String(range).toUpperCase(),
    dateLine: _repeatOffendersPdfDateLine(dateKeys),
  };
}

// One table candidate for a date/section: { title, list } (the same
// `list` shape computeRmPerformance() returns). Filters out empty
// candidates and the two hierarchy-dependent rollups when RM_Hierarchy
// isn't loaded — the live tab would print a "could not be read"
// placeholder row instead, which isn't real data worth a PDF page.
//
// 2026-09-07 (explicit request — "same for pdf download"): matches the
// live tab exactly now, no divergence. Worst N by raw score REGARDLESS
// of classification (rankFor below) — RM 20 / A1-TM 10 / RH 5 / Region
// ALL, uncapped — except Insufficient Data is never shown in any of the
// 4, even to pad out a short list. filterRmPerformanceRankable +
// sortRmPerformanceByScore (both core-rm-performance.js) are the SAME
// functions tab-repeat-offenders.js's renderRepeatOffenders calls, so the
// two can't quietly drift apart on what counts as "worst".
function _repeatOffendersPdfSectionTables(dateKeys){
  const hierarchyMissing = rmHierarchyFetchState !== 'ok';
  // Frozen filter snapshot (core-rm-performance.js's passesRepeatOffenderFilters
  // now requires one explicitly — see captureRepeatOffendersFilterSnapshot,
  // tab-repeat-offenders.js) — captured fresh per PDF generation, same as
  // the live tab does per render.
  const filters = captureRepeatOffendersFilterSnapshot();
  const rankFor = (list) => sortRmPerformanceByScore(filterRmPerformanceRankable(list));
  const candidates = [
    { title: 'RMs — worst 20', list: rankFor(computeRmPerformance(dateKeys, undefined, filters, rmHierarchyByNameLower)).slice(0, 20) },
    { title: 'By Region — worst first, all shown', list: rankFor(computeRmPerformance(dateKeys, rec => repeatOffendersRegionKey(rec), filters, rmHierarchyByNameLower)) },
    { title: 'A1 / TM — worst 10', list: hierarchyMissing ? [] : rankFor(computeRmPerformance(dateKeys, rec => rmPerfPrimaryManagerFor(rec.RM, rmHierarchyByNameLower), filters, rmHierarchyByNameLower)).slice(0, 10) },
    { title: 'RH — worst 5', list: hierarchyMissing ? [] : rankFor(computeRmPerformance(dateKeys, rec => rmPerfRhFor(rec.RM, rmHierarchyByNameLower), filters, rmHierarchyByNameLower)).slice(0, 5) },
  ];
  return candidates.filter(c => c.list.length > 0);
}

// Full ordered list of page specs: { dateLabel, title, list } — ONE
// COMBINED report for whatever range is currently selected (Yesterday/
// This Week/Last 7 Days/Custom/From when history began), dateLabel
// always null. Changed 2026-09-07, explicit request: "the pdf should
// not contain all last 7 days, but a combine report of last 7 days."
//
// Previously this broke a multi-day range into one SEPARATE set of
// tables PER INDIVIDUAL DAY (up to 7 "DATE: ..." sections x 4 tables —
// a 19-page PDF for a single Last 7 Days export), each computed from
// just that one day's own data alone. That's a real, different, far
// noisier calculation than what the live tab shows for the exact same
// "Last 7 Days" selection: computeRmPerformance (core-rm-performance.js)
// always takes the WHOLE dateKeys Set as one unit — one composite score
// per RM built from all 7 days of observations combined, not 7 separate
// 1-day scores — so the old per-day PDF pages could never actually match
// what was on screen. Passing dateKeys through WHOLE, exactly once (same
// as the allTime branch already did), makes the PDF compute the identical
// thing the screen does for whatever range is picked — the header's own
// "Date Range: ..." line (already printed once, see
// _repeatOffendersPdfDateLine) is the only date context needed now, so
// every spec's dateLabel is null (no more per-section "DATE:" headings —
// _repeatOffendersPdfRenderPages already skips drawing one whenever
// dateLabel is falsy).
function _repeatOffendersPdfBuildPageSpecs(filterInfo){
  return _repeatOffendersPdfSectionTables(filterInfo.dateKeys)
    .map(t => ({ dateLabel: null, title: t.title, list: t.list }));
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

// Converts one computeRmPerformance() row into the PDF's own 6 columns
// (#, Name, Unique Leads, Score, Instances, Region) — plain strings for
// autoTable, no HTML/markup involved. PDF-ONLY column set, explicit
// request 2026-09-07: "remove the following from table in pdf only:
// Status, RMs, A1/TM, RH" — the live tab KEEPS all 10 columns
// unchanged (rmPerformanceTableHtml, tab-repeat-offenders.js); this is
// a display-only trim for the printed report, not a change to what data
// exists. Region still reuses rmPerformanceHierarchyCells
// (core-rm-performance.js, shared with the live tab) for the one
// hierarchy column that DOES stay, so it can't disagree with what the
// live tab would show for the same row. "Driven by" was removed from
// both surfaces 2026-09-07 — see rmPerformanceDrivenBy's own comment
// (still defined, just unused by either renderer now).
function _repeatOffendersPdfTableRows(list, rmHierarchyByNameLower){
  return list.map(function (r, i) {
    const score = r.composite.toFixed(2) + ' / ' + r.peerComposite.toFixed(2);
    const hc = rmPerformanceHierarchyCells(r, rmHierarchyByNameLower);
    let name = r.name;
    if (r.routingIssueDays > 0) name += '\n+' + r.routingIssueDays + ' Inactive-RM routing day(s)';
    return [String(i + 1), name, String(r.distinctLeads), score, String(r.totalInstances), hc.region];
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
// spirit. Orientation: portrait (reverted 2026-09-07 — briefly landscape
// on 2026-09-06 while this table had 10 columns/hierarchy detail; those 4
// columns were then dropped from the PDF specifically, see
// _repeatOffendersPdfTableRows' own comment, so the 6 remaining columns
// fit portrait's ~515pt usable width fine again, same as before that
// addition). Still uniformly ONE orientation for every page — addPage
// below also requests 'portrait', not a mix.
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
  y += 12;
  // A static PDF has no hover tooltip to carry the live tab's own column
  // explanations, so they get one printed (wrapped) note instead.
  // splitTextToSize wraps to the usable page width — doc.text does NOT
  // auto-wrap on its own and would otherwise run off the edge.
  doc.setFontSize(8);
  doc.setTextColor(165, 169, 177);
  const methodologyNoteLines = doc.splitTextToSize(
    'Every table shows the WORST performers first, by Score, regardless of classification (RMs -- worst 20, A1/TM -- worst 10, RH -- worst 5, Region -- worst first, all shown) -- once there are fewer genuine Below Expectations rows than a table\'s own cap, the next-worst Watch/On Track rows fill the rest so the table always shows a full worst-N list. The one row NEVER printed, in any table, is Insufficient Data (fewer than 5 distinct eligible leads -- too little evidence to rank at all). A table with no rows means nobody had enough data to rank, not that nothing could be computed. Unique Leads = exact distinct-lead count eligible for at least one scored SLA rule. Score = severity-weighted composite vs. the peer average it\'s shrunk toward -- higher is worse (not printed here, but still what every row is ranked by -- see the live dashboard for the full Status/RMs/A1-TM/RH breakdown per row). Instances = total violation-DAY count across the 4 scored rules (Movement_Log-based, not Daily_RM_Issues -- that log has no real eligible-population denominator, same reason it was dropped as this report\'s data source in the 2026-09-04 redesign). Region shows the region this row\'s leads are actually concentrated in. A note under the Name column flags Inactive-RM Lead Added days when they apply (tracked but never scored -- a routing issue, not an execution one). Built from Movement_Log, which retains only a rolling 7 days -- a Custom range or "From when history began" reaching further back can undercount.',
    pageW - REPEAT_OFFENDERS_PDF_MARGIN_ * 2
  );
  doc.text(methodologyNoteLines, REPEAT_OFFENDERS_PDF_MARGIN_, y);
  y += methodologyNoteLines.length * 10 + 4;
  doc.setDrawColor(220, 223, 228);
  doc.setLineWidth(1);
  doc.line(REPEAT_OFFENDERS_PDF_MARGIN_, y, pageW - REPEAT_OFFENDERS_PDF_MARGIN_, y);
  y += 22;

  // No per-section "DATE: ..." headings any more (2026-09-07 — every spec
  // is now one combined report for the whole selected range, dateLabel
  // always null; see _repeatOffendersPdfBuildPageSpecs' own comment). The
  // single "Date Range: ..." line already printed once in the document
  // header (_repeatOffendersPdfDateLine) is the only date context this
  // report needs now.
  const pageUsableH = doc.internal.pageSize.getHeight() - REPEAT_OFFENDERS_PDF_MARGIN_ * 2;

  specs.forEach(function (spec) {
    const rows = _repeatOffendersPdfTableRows(spec.list, rmHierarchyByNameLower);
    const compact = rows.length > 20; // beyond this app's own current per-table cap — defensive, not expected to trigger today
    // Clamped to one full page's worth: a table taller than that can never
    // fit regardless of where it starts, so there's nothing more this
    // check can do for it — autoTable's own pageBreak:'avoid' still keeps
    // it from being SPLIT, it just runs past the estimate in that rare case.
    const estTableH = Math.min(_repeatOffendersPdfEstimateTableHeight(rows.length, compact), pageUsableH);
    const TITLE_H = 26;

    // Room check covering the table's own title + its estimated height —
    // so a title is never drawn on a page that can't also fit at least
    // the start of its table (the exact bug a fixed, too-small minSpace
    // guess produced: "By Region" printed at the bottom of a page with
    // the actual table pushed to the next one).
    y = _repeatOffendersPdfEnsureRoom(doc, y, TITLE_H + estTableH);

    // Table title
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10.5);
    doc.setTextColor(30, 33, 38);
    doc.text(spec.title, REPEAT_OFFENDERS_PDF_MARGIN_, y);
    y += 12;
    doc.autoTable({
      startY: y,
      head: [['#', 'Name', 'Unique Leads', 'Score (vs peer)', 'Instances', 'Region']],
      body: rows,
      theme: 'grid',
      styles: {
        fontSize: compact ? 7 : 8.5, cellPadding: compact ? 3 : 5,
        textColor: [35, 38, 44], lineColor: [222, 225, 230], lineWidth: 0.6, overflow: 'linebreak',
      },
      headStyles: { fillColor: [23, 27, 33], textColor: [235, 237, 240], fontStyle: 'bold', fontSize: compact ? 7 : 8.5 },
      alternateRowStyles: { fillColor: [246, 247, 249] },
      // 6 columns (Status/RMs/A1-TM/RH dropped 2026-09-07, PDF-only) —
      // widths tuned for portrait A4's ~515pt usable width, back to what
      // this table used before the 2026-09-06 hierarchy-column addition
      // (see _repeatOffendersPdfRenderPages' own comment on the
      // portrait/landscape switch).
      columnStyles: {
        0: { cellWidth: 24, halign: 'right' },
        1: { cellWidth: 140 },
        2: { cellWidth: 65, halign: 'right' },
        3: { cellWidth: 80, halign: 'right' },
        4: { cellWidth: 65, halign: 'right' },
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
// generating is a no-op (not queued, not restarted); no Movement_Log data
// yet, or genuinely nothing to report for the CURRENTLY SELECTED filter,
// shows a clear inline status message instead of downloading a blank/
// near-blank PDF. Gated on movementFetchState/movementSnapshots, not
// Daily_RM_Issues — matches renderRepeatOffenders' own gating
// (tab-repeat-offenders.js), since this export no longer reads
// Daily_RM_Issues at all (2026-09-04 redesign, HANDOVER.md §9.7).
async function downloadRepeatOffendersPdf(){
  if (_repeatOffendersPdfGenerating) return;
  const btn = document.getElementById('repeatOffendersDownloadPdfBtn');
  const statusEl = document.getElementById('repeatOffendersPdfStatus');

  if (movementFetchState === 'loading') {
    if (statusEl) { statusEl.textContent = 'Still loading Movement_Log — try again in a moment.'; statusEl.style.color = 'var(--amber)'; }
    return;
  }
  if (movementFetchState !== 'ok' || !movementSnapshots.length) {
    if (statusEl) { statusEl.textContent = 'No Movement_Log data loaded yet — nothing to export.'; statusEl.style.color = 'var(--amber)'; }
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
      // Movement_Log data existing was already confirmed above (the
      // movementFetchState/movementSnapshots.length gate at the top of
      // this function), so an empty specs list here means every RM/Region/
      // A1-TM/RH group is Insufficient Data (or there are none at all) for
      // every date in range — not that nothing could be computed. Since
      // 2026-09-07, the tables print worst-N regardless of classification,
      // so this is now a rarer case than the old "nobody's Below
      // Expectations" gate — it only fires when there's genuinely too
      // little evidence anywhere to rank.
      if (statusEl) { statusEl.textContent = 'No RM/region/manager has enough eligible data to rank for the selected period — nothing to export.'; statusEl.style.color = 'var(--amber)'; }
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
