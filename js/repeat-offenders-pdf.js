// ============================================================
// repeat-offenders-pdf.js — "Download PDF" export for the Repeat
// Offenders tab: a Date-wise section (last 3 IST days, by lead
// assignment date) plus a Last 7 Days section (by capture/flag date,
// matching the on-screen "Last 7 Days" Time range option exactly),
// covering the same 6 possible tables the live page shows (Top 20 RMs /
// Leads>50 / Leads>100, By Region, Top 10 A1/TM, Top 5 RH). A table with
// zero rows — or an A1/TM/RH rollup when RM_Hierarchy isn't loaded — is
// left out entirely, never printed as an empty placeholder; a date with
// no populated tables is left out too.
//
// Depends on js/tab-repeat-offenders.js (dailyRmIssues,
// dailyRmIssuesFetchState, rmHierarchyFetchState, aggregateRepeatOffenders,
// primaryManagerForRm, rhForRm, _repeatOffendersRegionKey,
// passesRepeatOffenderFilters, repeatOffenderTableHtml,
// repeatOffendersDateKeysForRange) and js/core-foundation.js
// (istDateKey, relativeDayLabel) / js/core-outcome-engine.js (istStamp) /
// js/core-ui.js (esc) — all loaded earlier in dashboard.html, but this
// only ever runs on a user click, well after every js/*.js file has
// finished loading, so exact script order doesn't matter here (same
// reasoning core-foundation.js's own header comment gives). Also needs
// html2canvas + jsPDF (loaded in dashboard.html's <head>).
//
// APPROACH: each table (heading + the table itself) is composed as one
// off-screen DOM node using the EXACT SAME repeatOffenderTableHtml()
// markup/CSS the live page renders with — so the PDF's table names,
// columns and data can never drift from what's on screen — then
// snapshotted as one image via html2canvas and placed on its own PDF
// page (scaled to fit, portrait or landscape depending on the table's
// own rendered shape) via jsPDF. A table is therefore physically
// incapable of splitting across a page boundary: it's one atomic image,
// scaled down to fit the page rather than cropped or split if it's ever
// too large. Tradeoff: the PDF's text isn't selectable/searchable (it's
// a raster image, not vector text) — acceptable here since the explicit
// priority was visual fidelity to the existing UI. A vector-text
// alternative (jsPDF's autoTable plugin) is noted in HANDOVER.md if that
// tradeoff ever needs revisiting — autoTable's own default pagination
// SPLITS a long table across pages, which is the opposite of what was
// asked for here, so it would need extra work to match this behavior.
// ============================================================

let _repeatOffendersPdfGenerating = false;

// One table candidate for a section: { title, list } (the same `list`
// shape aggregateRepeatOffenders returns). Filters out empty candidates
// and the two hierarchy-dependent rollups when RM_Hierarchy isn't
// loaded — repeatOffenderTableHtml would otherwise print a "could not be
// read" placeholder row, which isn't real data worth a PDF page.
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

// Full ordered list of page specs: { sectionLabel, dateLabel, title, list }.
// Date-wise = today, yesterday, 2 days ago (IST calendar days, matching
// every other date grouping on this tab — "Today" here means the same
// IST "today" the rest of the app already uses, not a raw browser-local
// date, so it stays consistent with Yesterday/This Week/Last 7 Days
// right next to it), scoped by ASSIGNED date — same convention this
// tab's own "Yesterday" option already uses ("how many of that day's
// leads are already a problem"), extended to 3 individual days. Last 7
// Days is scoped by CAPTURE date instead, identical to the on-screen
// "Last 7 Days" option (see renderRepeatOffenders's own comment on why:
// a genuine repeat offender is almost always an old lead whose
// assignment date is never recent). Empty dates/tables are already
// excluded by _repeatOffendersPdfSectionTables above.
function _repeatOffendersPdfBuildPageSpecs(){
  const specs = [];
  const now = (typeof _renderNow !== 'undefined' && _renderNow) ? _renderNow : new Date();
  const todayKey = istDateKey(now);

  for (let offset = 0; offset < 3; offset++) {
    const dayKey = istDateKey(new Date(now.getTime() - offset * 86400000));
    const dateLabel = relativeDayLabel(dayKey, todayKey);
    const tables = _repeatOffendersPdfSectionTables(new Set([dayKey]), true);
    tables.forEach(t => specs.push({ sectionLabel: 'Date-wise', dateLabel: dateLabel, title: t.title, list: t.list }));
  }

  const last7Keys = repeatOffendersDateKeysForRange('last7Days', now);
  const last7Tables = _repeatOffendersPdfSectionTables(last7Keys, false);
  last7Tables.forEach(t => specs.push({ sectionLabel: 'Last 7 Days', dateLabel: null, title: t.title, list: t.list }));

  return specs;
}

// One line describing the currently-active top-bar filters (or their
// absence) — printed on the cover page so the PDF is self-explanatory
// about its own scope without needing the live dashboard open alongside it.
function _repeatOffendersPdfFilterSummaryLine(){
  const parts = [];
  if (filterState.project.size) parts.push('Project: ' + Array.from(filterState.project).join(', '));
  if (filterState.region.size) parts.push('Region: ' + Array.from(filterState.region).join(', '));
  if (filterState.TL.size) parts.push('TL: ' + Array.from(filterState.TL).join(', '));
  if (filterState.source.size) parts.push('Source: ' + Array.from(filterState.source).join(', '));
  if (filterState.bucket.size) parts.push('Sub-source: ' + Array.from(filterState.bucket).join(', '));
  return parts.length ? ('Filters applied (top of page): ' + parts.join(' · ')) : 'No Project/Region/TL/Source/Sub-source filters applied — full dataset.';
}

// One off-screen page node: a small heading (section + date, matching
// relativeDayLabel's own "Today (2 Sep)" style already used throughout
// the app) directly above the real table markup — repeatOffenderTableHtml
// already renders its own title line in the same visual style the live
// grid uses, so nothing here duplicates it.
// Sizes to its own content (display:inline-block, no fixed width) rather
// than a uniform width for every table — a short RM-name/issue-chip mix
// wants ~550-650px, a table with longer names or more/longer issue
// labels naturally wants more, up to ~850px+. That measured width (not a
// width-vs-height aspect ratio, which a mostly-empty SHORT table would
// always "win" regardless of how few columns it has) is what decides
// portrait vs landscape below — a real per-table content decision matching
// what "wide table" actually means, not an artifact of a fixed render width.
function _repeatOffendersPdfBuildTableNode(spec){
  const wrap = document.createElement('div');
  wrap.className = 'repeat-pdf-render';
  wrap.style.cssText = 'display:inline-block; min-width:480px; padding:28px; background:var(--bg); font-family:"Inter",system-ui,sans-serif; color:var(--text); box-sizing:border-box;';
  const dateHtml = spec.dateLabel ? ` · ${esc(spec.dateLabel)}` : '';
  wrap.innerHTML = `
    <div style="display:flex; justify-content:space-between; align-items:baseline; margin-bottom:16px; padding-bottom:10px; border-bottom:1px solid var(--border);">
      <div class="eyebrow">${esc(spec.sectionLabel)}${dateHtml}</div>
      <div class="eyebrow" style="opacity:.55;">Repeat Offenders Report</div>
    </div>
    ${repeatOffenderTableHtml(spec.title, spec.list, false)}
  `;
  return wrap;
}

// The report's cover page — title, generation timestamp, a one-line
// explanation of the two sections, and the active-filter summary.
function _repeatOffendersPdfBuildCoverNode(filterSummaryLine){
  const wrap = document.createElement('div');
  wrap.className = 'repeat-pdf-render';
  wrap.style.cssText = 'width:760px; height:520px; padding:56px; background:var(--bg); display:flex; flex-direction:column; justify-content:center; font-family:"Inter",system-ui,sans-serif; color:var(--text); box-sizing:border-box;';
  wrap.innerHTML = `
    <div class="eyebrow">Lead Funnel · SLA Monitor</div>
    <div style="font-family:'Space Grotesk',sans-serif; font-size:32px; font-weight:700; color:var(--text); margin:10px 0 6px;">Repeat Offenders Report</div>
    <div style="color:var(--text-dim); font-size:13px; margin-bottom:26px;">Generated ${esc(istStamp(new Date()))} IST</div>
    <div style="display:flex; flex-direction:column; gap:9px; font-size:12.5px; color:var(--text-dim); margin-bottom:22px;">
      <div><span class="chip dim-chip" style="margin-right:8px;">Date-wise</span>Today, Yesterday, and 2 days ago — by lead assignment date</div>
      <div><span class="chip dim-chip" style="margin-right:8px;">Last 7 Days</span>The most recent 7 nights' captures — by flag date, same as the on-screen Time range option</div>
    </div>
    <div class="filter-summary" style="margin:0;">${esc(filterSummaryLine)}</div>
    <div class="filter-summary" style="margin:6px 0 0;">Tables with zero entries — and any date with no populated tables — are left out of this report.</div>
  `;
  return wrap;
}

// A table's rendered width beyond this comfortably fills (or exceeds) a
// portrait A4 page's content area at a readable scale — past it,
// landscape gives the same content more room instead of shrinking small.
const REPEAT_OFFENDERS_PDF_LANDSCAPE_WIDTH_PX = 700;

// Renders every page node to canvas (html2canvas) and assembles the PDF
// (jsPDF), one page per node — a cover page first (always portrait — a
// title page, not a data table, so it isn't subject to the width rule
// below), then one page per entry in `specs`. Portrait vs landscape for
// a TABLE page is decided from that node's own measured DOM width (see
// REPEAT_OFFENDERS_PDF_LANDSCAPE_WIDTH_PX above and
// _repeatOffendersPdfBuildTableNode's own comment on why width — not a
// width-vs-height aspect ratio — is what actually distinguishes a
// genuinely wide table from a merely short one). The resulting image is
// always scaled to fit fully within the page's printable area (shrinking
// to fit height if fitting the width alone would overflow) — the "never
// split, shrink instead" strategy.
async function _repeatOffendersPdfRenderPages(specs, filterSummaryLine){
  const jsPDFCtor = (window.jspdf && window.jspdf.jsPDF) || window.jsPDF;
  if (!jsPDFCtor || !window.html2canvas) {
    throw new Error('PDF library failed to load — check your connection and try again.');
  }

  const totalPages = specs.length + 1; // +1 for the cover page
  const host = document.createElement('div');
  host.style.cssText = 'position:fixed; left:-99999px; top:0; z-index:-1;';
  document.body.appendChild(host);

  const MARGIN = 32;
  const FOOTER_SPACE = 20;
  let doc = null;
  const bgColor = getComputedStyle(document.body).backgroundColor || '#0f1216';

  const renderNodeToDoc = async (node, pageNum, forceLandscape) => {
    const isLandscape = forceLandscape != null ? forceLandscape : (node.scrollWidth > REPEAT_OFFENDERS_PDF_LANDSCAPE_WIDTH_PX);
    const canvas = await html2canvas(node, { backgroundColor: bgColor, scale: 2, useCORS: true });
    // JPEG, not PNG: jsPDF's addImage doesn't preserve a PNG's own
    // compression — it decodes to a raw bitmap and re-encodes with only
    // generic Flate compression, which for anti-aliased text on a dark
    // background lands close to the UNCOMPRESSED bitmap size (a single
    // table page came out ~2.5MB as "PNG" vs ~40-55KB as JPEG at quality
    // 0.95 — the same page, a ~50x difference). Every page here is fully
    // opaque (backgroundColor above + each node's own solid background),
    // so JPEG's lack of alpha support costs nothing.
    const imgData = canvas.toDataURL('image/jpeg', 0.95);
    if (!doc) {
      doc = new jsPDFCtor({ orientation: isLandscape ? 'landscape' : 'portrait', unit: 'pt', format: 'a4' });
    } else {
      doc.addPage('a4', isLandscape ? 'landscape' : 'portrait');
    }
    const pageW = doc.internal.pageSize.getWidth();
    const pageH = doc.internal.pageSize.getHeight();
    const availW = pageW - MARGIN * 2;
    const availH = pageH - MARGIN * 2 - FOOTER_SPACE;
    const imgRatio = canvas.width / canvas.height;
    let drawW = availW;
    let drawH = drawW / imgRatio;
    if (drawH > availH) { drawH = availH; drawW = drawH * imgRatio; } // shrink-to-fit rather than crop/split
    const x = (pageW - drawW) / 2;
    const y = MARGIN;
    doc.addImage(imgData, 'JPEG', x, y, drawW, drawH);
    doc.setFontSize(9);
    doc.setTextColor(140, 140, 140);
    doc.text(`Page ${pageNum} of ${totalPages}`, pageW / 2, pageH - 16, { align: 'center' });
  };

  try {
    const coverNode = _repeatOffendersPdfBuildCoverNode(filterSummaryLine);
    host.appendChild(coverNode);
    await renderNodeToDoc(coverNode, 1, false); // cover page: always portrait
    host.removeChild(coverNode);

    for (let i = 0; i < specs.length; i++) {
      const node = _repeatOffendersPdfBuildTableNode(specs[i]);
      host.appendChild(node);
      await renderNodeToDoc(node, i + 2);
      host.removeChild(node);
    }
  } finally {
    document.body.removeChild(host);
  }

  return doc;
}

// The button's click handler. Guards: a duplicate click while already
// generating is a no-op (not queued, not restarted); no Daily_RM_Issues
// data yet, or genuinely nothing to report across every section, shows a
// clear inline status message instead of downloading a blank/near-blank
// PDF.
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
    const specs = _repeatOffendersPdfBuildPageSpecs();
    if (!specs.length) {
      if (statusEl) { statusEl.textContent = 'No flagged instances in the last 3 days or Last 7 Days under the current filters — nothing to export.'; statusEl.style.color = 'var(--amber)'; }
      return;
    }
    const filterSummaryLine = _repeatOffendersPdfFilterSummaryLine();
    const doc = await _repeatOffendersPdfRenderPages(specs, filterSummaryLine);
    const filenameDate = istDateKey(new Date());
    doc.save(`Repeat-Offender-Report-${filenameDate}.pdf`);
    const pageCount = specs.length + 1;
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
