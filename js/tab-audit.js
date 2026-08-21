// ============================================================
// tab-audit.js — Audit tab ("when was a lead last touched").
// Depends on core.js (loaded first). Extracted via the file-split
// plan — pure code motion, no logic changed.
// ============================================================

/* ===================== AUDIT: WHEN WAS A LEAD LAST TOUCHED ===================== */

// Audit windows are IST days — see the IST TIME CORE block.
const startOfDay = istStartOfDay;
const addDays = istAddDays;

// Week starts Monday. Every preset resolves against _renderNow so the whole
// render pass shares one "now" — see the note on _renderNow itself.
const AUDIT_PRESETS = {
  'Today':        () => { const n = _renderNow; return { from: startOfDay(n), to: n }; },
  'Yesterday':    () => { const n = _renderNow; const s = startOfDay(addDays(n, -1));
                          return { from: s, to: new Date(startOfDay(n).getTime() - 1) }; },
  'This week':    () => { const n = _renderNow; const dow = (istParts(n).dow + 6) % 7; // IST weekday, Mon = 0
                          return { from: startOfDay(addDays(n, -dow)), to: n }; },
  'Last 7 days':  () => { const n = _renderNow; return { from: startOfDay(addDays(n, -6)), to: n }; },
  'Custom range': () => {
    const f = document.getElementById('auditFrom');
    const t = document.getElementById('auditTo');
    if (!f || !t || !f.value || !t.value) return null;
    const from = parseDate(f.value + ' 00:00:00');           // IST day start
    const to   = parseDate(t.value + ' 23:59:59');           // IST day end
    if (!from || !to) return null;
    if (isNaN(from) || isNaN(to) || to < from) return null;
    return { from, to };
  },
};

const auditState = { periods: new Set(['Today']) };

// Every discrete "someone touched this" moment on a lead. Comments are read
// individually rather than via lastCommentAt, because a lead commented on
// both yesterday and today must answer to BOTH periods — the newest-only
// timestamp would silently drop the earlier day.
function updateEventsFor(l){
  const events = [];
  const connect = parseDate(l.last_connect_time);
  if (connect) events.push({ kind: 'Call connect', at: connect, by: l.RM || '', text: '' });
  parseActionLog(combinedCommentsText(l)).forEach(e => {
    const at = e.ts ? parseDate(e.ts) : null;
    if (at) events.push({ kind: 'Comment', at, by: e.loggedBy || '', text: e.comment || '' });
  });
  return events.sort((a, b) => b.at - a.at);
}

function activeAuditRanges(){
  const out = [];
  auditState.periods.forEach(name => {
    const fn = AUDIT_PRESETS[name];
    if (!fn) return;
    const r = fn();
    if (r) out.push(Object.assign({ name }, r));
  });
  return out;
}

function auditMatches(){
  const ranges = activeAuditRanges();
  if (!ranges.length) return { ranges, rows: [] };

  const rows = [];
  leads.forEach(l => {
    const hits = updateEventsFor(l).filter(ev =>
      ranges.some(r => ev.at >= r.from && ev.at <= r.to));
    if (hits.length) rows.push({ lead: l, hits, latest: hits[0] });
  });
  rows.sort((a, b) => b.latest.at - a.latest.at);
  return { ranges, rows };
}

function auditLeadIds(rows){
  // Collated records carry several lead_ids; all of them are listed, since a
  // single displayed row can represent up to a dozen rows in the sheet and
  // exporting only the primary would under-report the audit.
  const ids = [];
  rows.forEach(r => {
    const l = r.lead;
    const list = (l.collatedLeadIds && l.collatedLeadIds.length) ? l.collatedLeadIds : [l.lead_id];
    list.forEach(id => ids.push(String(id)));
  });
  return Array.from(new Set(ids));
}

function renderAudit(){
  const table = document.getElementById('auditTable');
  if (!table) return;
  const wrap = document.getElementById('auditCustomWrap');
  if (wrap) wrap.style.display = auditState.periods.has('Custom range') ? 'flex' : 'none';

  const { ranges, rows } = auditMatches();
  const tbody = table.querySelector('tbody');
  const summary = document.getElementById('auditSummary');

  table.querySelector('thead').innerHTML = `<tr>
    <th>Lead ID(s)</th><th>RM</th><th>Region</th><th>Stage</th>
    <th>Last update</th><th>Type</th><th style="text-align:right">Updates<br>in window</th><th>By</th></tr>`;

  if (!ranges.length) {
    document.getElementById('auditCount').textContent = '';
    summary.innerHTML = auditState.periods.has('Custom range') && auditState.periods.size === 1
      ? '<span style="color:var(--amber)">Pick a valid From and To date to run the custom range.</span>'
      : 'Select at least one period above.';
    tbody.innerHTML = `<tr><td colspan="8" class="empty-row">No period selected</td></tr>`;
    return;
  }

  const ids = auditLeadIds(rows);
  const totalEvents = rows.reduce((s, r) => s + r.hits.length, 0);
  const auditCollated = rows.reduce((s, r) => s + (r.lead.collatedFrom > 1 ? 1 : 0), 0);
  document.getElementById('auditCount').textContent = numWithClone(rows.length, auditCollated) + ' leads';

  const rangeLabel = ranges.map(r =>
    `${esc(r.name)} (${istStamp(r.from)} → ${istStamp(r.to)})`).join(' · ');
  summary.innerHTML = rows.length
    ? `<b>${rows.length.toLocaleString()}</b> leads${auditCollated ? ` (<b>${auditCollated.toLocaleString()}</b> cloned)` : ''} carrying <b>${ids.length.toLocaleString()}</b> lead IDs were updated `
      + `across <b>${totalEvents.toLocaleString()}</b> events. Window: ${rangeLabel}`
    : `No leads were updated in this window. Window: ${rangeLabel}`;

  if (!rows.length) {
    tbody.innerHTML = `<tr><td colspan="8" class="empty-row">Nothing was touched in the selected period</td></tr>`;
    return;
  }

  const CAP = 300;
  tbody.innerHTML = rows.slice(0, CAP).map(r => {
    const l = r.lead;
    const idList = (l.collatedLeadIds && l.collatedLeadIds.length) ? l.collatedLeadIds : [l.lead_id];
    const idCell = idList.length > 1
      ? `<span class="audit-ids">${esc(idList.join(', '))}</span> <span class="chip dim-chip">×${idList.length}</span>`
      : `<span class="audit-ids">${esc(String(l.lead_id))}</span>`;
    const others = (l.collatedRMs || []).filter(x => x && x !== l.RM);
    return `<tr>
      <td>${idCell}</td>
      <td>${esc(l.RM || 'Unassigned')}${others.length ? ` <span class="chip amber" title="These RMs also hold a copy">+${others.length}</span>` : ''}</td>
      <td class="dim">${esc(l.region)}</td>
      <td class="dim">${esc(l.current_stage)}</td>
      <td class="audit-when">${esc(istStamp(r.latest.at))}</td>
      <td><span class="chip dim-chip">${esc(r.latest.kind)}</span></td>
      <td class="num">${r.hits.length}</td>
      <td class="dim">${esc(r.latest.by || '—')}</td>
    </tr>`;
  }).join('')
  + (rows.length > CAP
      ? `<tr><td colspan="8" class="empty-row" style="padding:10px;">Showing first ${CAP} of ${rows.length.toLocaleString()} — Copy and CSV cover all of them</td></tr>`
      : '');
}

const HOUR_LABELS = ['12 AM','1 AM','2 AM','3 AM','4 AM','5 AM','6 AM','7 AM','8 AM','9 AM','10 AM','11 AM',
  '12 PM','1 PM','2 PM','3 PM','4 PM','5 PM','6 PM','7 PM','8 PM','9 PM','10 PM','11 PM'];

// Vertical stacked bar chart of every touch event (Comments + Call connect,
// see updateEventsFor) in the SAME period Updated Leads above is showing,
// bucketed by IST hour of day — reuses auditMatches() rather than
// recomputing it, so the two sections can never disagree about which
// events are "in the window". Comments dominate the volume (one per logged
// call attempt/note); Call connect is one timestamp per lead, so it's
// drawn as a thin top layer rather than a real per-call log.
function renderActivityByHour(){
  const el = document.getElementById('hourActivityChart');
  const countEl = document.getElementById('hourActivityCount');
  if (!el) return;

  const { ranges, rows } = auditMatches();
  if (!ranges.length) {
    if (countEl) countEl.textContent = '';
    el.innerHTML = `<div class="empty-row" style="background:var(--surface); border-radius:8px; border:1px solid var(--border);">Select at least one period above</div>`;
    return;
  }

  const events = rows.flatMap(r => r.hits);
  if (!events.length) {
    if (countEl) countEl.textContent = '';
    el.innerHTML = `<div class="empty-row" style="background:var(--surface); border-radius:8px; border:1px solid var(--border);">No logged activity in this window</div>`;
    return;
  }

  const comments = new Array(24).fill(0);
  const connects = new Array(24).fill(0);
  events.forEach(ev => {
    const h = istParts(ev.at).h;
    if (ev.kind === 'Call connect') connects[h]++; else comments[h]++;
  });

  if (countEl) countEl.textContent = events.length.toLocaleString() + ' events';

  const totals = comments.map((c, i) => c + connects[i]);
  const max = Math.max(1, ...totals);

  // Label every 3rd hour only — 24 labels side by side on a narrow chart
  // collide into an unreadable smear. Segment presence/proportion is driven
  // off the RAW counts (not a rounded intermediate %), with a 2% minimum
  // bar height applied only at the whole-stack level — otherwise an hour
  // with a real but small count (e.g. 1 event against a busy 200-event max)
  // could round to a stack that's tall enough to see but whose two
  // segments each round to 0% and render as an invisible gap.
  el.innerHTML = `<div class="hour-chart">` + totals.map((total, h) => {
    const stackPct = total ? Math.max(2, (total / max) * 100) : 0;
    const connectShare = total ? (connects[h] / total) * 100 : 0;
    const commentShare = total ? (comments[h] / total) * 100 : 0;
    const label = h % 3 === 0 ? HOUR_LABELS[h] : '';
    const title = `${HOUR_LABELS[h]}: ${total} event${total === 1 ? '' : 's'} (${comments[h]} comment${comments[h] === 1 ? '' : 's'}, ${connects[h]} connect${connects[h] === 1 ? '' : 's'})`;
    return `<div class="hour-bar-col" title="${esc(title)}">
      <div class="hour-bar-stack" style="height:${stackPct.toFixed(1)}%;">
        ${connects[h] ? `<div class="hour-bar-seg connects" style="height:${connectShare.toFixed(1)}%;"></div>` : ''}
        ${comments[h] ? `<div class="hour-bar-seg comments" style="height:${commentShare.toFixed(1)}%;"></div>` : ''}
      </div>
      <div class="hour-bar-label">${esc(label)}</div>
    </div>`;
  }).join('') + `</div>
  <div class="stall-legend" style="margin-top:10px;">
    <span class="stall-legend-item"><span class="stall-legend-dot" style="background:var(--blue);"></span>Comments (logged calls/notes)</span>
    <span class="stall-legend-item"><span class="stall-legend-dot" style="background:var(--teal);"></span>Call connect (most recent per lead)</span>
  </div>`;
}

function copyAuditIds(){
  const { rows } = auditMatches();
  const ids = auditLeadIds(rows);
  if (!ids.length) return;
  navigator.clipboard.writeText(ids.join('\n')).then(() => {
    const b = document.getElementById('auditCopyBtn');
    const prev = b.textContent;
    b.textContent = `Copied ${ids.length} IDs`;
    setTimeout(() => { b.textContent = prev; }, 1800);
  });
}

function downloadAuditCSV(){
  const { rows } = auditMatches();
  if (!rows.length) return;
  // One row per EVENT, not per lead — an audit trail needs each touch on its
  // own line to be sortable and countable outside the dashboard.
  const out = [['lead_id', 'all_lead_ids', 'RM', 'TL', 'region', 'project', 'stage', 'updated_at', 'type', 'by', 'comment']];
  const ranges = activeAuditRanges();
  rows.forEach(r => {
    const l = r.lead;
    const idList = (l.collatedLeadIds && l.collatedLeadIds.length) ? l.collatedLeadIds : [l.lead_id];
    r.hits.filter(ev => ranges.some(g => ev.at >= g.from && ev.at <= g.to)).forEach(ev => {
      out.push([l.lead_id, idList.join(' '), l.RM || '', l.TL || '', l.region || '',
                l.project || '', l.current_stage || '', istStamp(ev.at), ev.kind, ev.by || '', ev.text || '']);
    });
  });
  const csv = out.map(r => r.map(csvEscape).join(',')).join('\r\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `lead_audit_${new Date().toISOString().slice(0,16).replace(/[:T]/g,'-')}.csv`;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function buildAuditControls(){
  // Counts per period are computed up front so the dropdown shows how much
  // each window holds before it's selected.
  const counts = {};
  Object.keys(AUDIT_PRESETS).forEach(name => {
    const r = AUDIT_PRESETS[name]();
    counts[name] = r ? leads.filter(l => updateEventsFor(l).some(ev => ev.at >= r.from && ev.at <= r.to)).length : 0;
  });
  buildMultiSelect('msAuditPeriod', 'Period', Object.keys(AUDIT_PRESETS), counts,
                   auditState.periods, () => { buildAuditControls(); renderAudit(); renderActivityByHour(); });
}

document.addEventListener('DOMContentLoaded', () => {
  ['auditFrom', 'auditTo'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('change', () => { renderAudit(); renderActivityByHour(); });
  });
  const c = document.getElementById('auditCopyBtn');
  if (c) c.addEventListener('click', copyAuditIds);
  const d = document.getElementById('auditCsvBtn');
  if (d) d.addEventListener('click', downloadAuditCSV);
});
