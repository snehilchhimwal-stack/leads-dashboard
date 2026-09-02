// ============================================================
// core-ui.js — generic, cross-cutting UI chrome used across multiple
// tabs: esc() (HTML-escaping), the loading overlay, the lazy action-log
// expand (_logLeadRegistry/toggleActionLog/logToggleMarkup), the shared
// renderAlertCard used by most Operations issue cards, and the
// collapsible section-info toggle. Split out of core.js (Phase 2 — see
// HANDOVER.md), reassembled here from three non-adjacent ranges of the
// original file (esc/loading-overlay, then the action-log/alert-card
// block, then toggleInlineDetail/initCollapsibleSectionInfo at the very
// end of the original file) since they're the same kind of thing despite
// not having sat next to each other originally. Pure code motion — no
// logic changed.
// ============================================================

function esc(s){
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

// Full-page blocking overlay for a heavy recompute — shown BEFORE the
// synchronous work starts and hidden after it finishes, with pointer
// events swallowed by #renderLoadingOverlay's own CSS (position:fixed,
// inset:0, above everything) so a click during the freeze can't reach any
// filter/button underneath and queue up yet another recompute.
// Reference-counted, not a plain show/hide toggle — fetchAndRender shows
// this, then calls applyFiltersAndRender internally (which shows/hides it
// too) before fetchAndRender's OWN finally block hides it again. Because
// applyFiltersAndRender's real work is deferred a couple ticks (see below),
// fetchAndRender's finally runs — and would hide the overlay — before that
// deferred work has even started. A plain boolean toggle would drop the
// overlay right before the heaviest part of the pass; counting nested
// show calls means it only actually disappears once every caller that
// asked for it is done.
let _loadingOverlayDepth = 0;
// `heavy` marks an actual sheet load (post-sign-in, or Refresh) rather than
// a quick filter-change recompute — the CSS uses it to swap the light
// blur-scrim (current dashboard still dimly visible underneath) for a
// solid, fully-branded screen (nothing worth showing yet behind a fresh
// load). A heavy caller always wins the visual even if a lighter recompute
// somehow overlaps it, since depth-tracking alone can't express "which of
// several concurrent callers wanted the heavy look."
let _loadingOverlayHeavyDepth = 0;
function showLoadingOverlay(text, heavy){
  _loadingOverlayDepth++;
  if (heavy) _loadingOverlayHeavyDepth++;
  const el = document.getElementById('renderLoadingOverlay');
  if (!el) return;
  const textEl = document.getElementById('renderLoadingOverlayText');
  if (textEl) textEl.textContent = text || 'Loading…';
  el.classList.add('active');
  el.classList.toggle('heavy', _loadingOverlayHeavyDepth > 0);
}
function hideLoadingOverlay(heavy){
  _loadingOverlayDepth = Math.max(0, _loadingOverlayDepth - 1);
  if (heavy) _loadingOverlayHeavyDepth = Math.max(0, _loadingOverlayHeavyDepth - 1);
  const el = document.getElementById('renderLoadingOverlay');
  if (_loadingOverlayDepth > 0) {
    if (el) el.classList.toggle('heavy', _loadingOverlayHeavyDepth > 0);
    return; // still needed by an outer/other in-flight caller
  }
  if (el) { el.classList.remove('active'); el.classList.remove('heavy'); }
}

// display:none until clicked. Across 6 sections × 200 cards × ~23 entries
// that's ~27,600 hidden <tr> (~166k cells, ~4.3MB of HTML) constructed and
// parsed on EVERY filter change, for markup almost none of which is ever
// viewed. Now the lead is stashed by id and the table is built on first
// click only, then cached in the DOM.
// Cards render up to this many rows. Anything beyond gets a visible notice
// rather than silently disappearing — a TL looking at 200 cards under a
// "1,340 leads" heading otherwise has no idea they're seeing 15% of it.
const MAX_CARDS = 200;

function truncationNotice(total, shown){
  if (total <= shown) return '';
  return `<div class="truncation-notice">Showing first ${shown} of ${total.toLocaleString()} — narrow the filters or use Download Issues CSV for the full list.</div>`;
}

const _logLeadRegistry = new Map();

function toggleActionLog(logId){
  const el = document.getElementById(logId);
  if (!el) return;
  if (!el.dataset.rendered) {
    const raw = _logLeadRegistry.get(logId);
    const entries = parseActionLog(raw);
    el.innerHTML = actionLogTableMarkup(entries);
    el.dataset.rendered = '1';
  }
  el.classList.toggle('open');
}

function logToggleMarkup(l, logId){
  const combined = combinedCommentsText(l);
  const count = parseActionLog(combined).length;
  if (!count) return '';
  _logLeadRegistry.set(logId, combined);
  return `<button class="log-toggle" onclick="toggleActionLog('${logId}')">View action log (${count}) ▾</button>`
    + `<div class="action-log" id="${logId}"></div>`;
}

function renderAlertCard(l, idx, prefix, requiredCalls){
  const logId = prefix + '_' + idx;
  // Both timestamps matter: assignment says when the clock started, last
  // comment says whether anyone has touched it since. A relative figure
  // alone ("9.2h old") answers neither question usefully.
  const lastAt = l.lastCommentAt || null;
  const commentLabel = lastAt
    ? `last comment ${istStamp(lastAt)}`
    : (l.ageHours != null ? `no comment in ${l.ageHours.toFixed(1)}h` : 'no comment');

  return `<div class="alert-card${l.past48h ? '' : ' amber-left'}">
    <div class="alert-id">${leadIdentityLine(l)}</div>
    <div class="alert-age mono">assigned ${esc(istStamp(l.lead_assigned_at))}</div>
    <div class="alert-meta">${esc(l.region)} · ${esc(l.project)} · ${esc(l.current_stage)} — <span class="chip amber">${l.call_attempts}/${requiredCalls} attempts</span> <span class="chip ${lastAt ? 'dim-chip' : 'amber'}">${esc(commentLabel)}</span></div>
    ${l.last_comment ? `<div class="alert-comment">"${esc(l.last_comment)}"</div>` : ''}
    ${logToggleMarkup(l, logId)}
  </div>`;
}

// Relocated from dashboard.html's inline script (Phase 4 file-split) — generic
// cross-cutting UI utilities used across multiple tabs, so they live in
// core.js rather than any one tab file.
// Generic show/hide for a details block dynamically inserted right after
// an .info-toggle button (dedupeNotice's summary line, rebuilt on every
// fetch, rather than the static per-section explainers below which wire up
// once via initCollapsibleSectionInfo).
function toggleInlineDetail(btn){
  const el = btn.parentElement && btn.parentElement.nextElementSibling;
  if (!el) return;
  const opening = el.style.display === 'none';
  el.style.display = opening ? 'block' : 'none';
  btn.textContent = opening ? '▾ Hide' : (btn.dataset.label || 'ⓘ Details');
}

// Every section-head is followed by a filter-summary paragraph explaining
// exactly what the section does and doesn't include — genuinely useful,
// but rendering all ~20 of them in full meant reading several screens of
// documentation before reaching the first actual lead card. Collapsed
// behind a one-click "Why this section exists" toggle instead; nothing
// about the text itself changes, and no section had to be edited by hand
// to get this — it wires up generically off the existing section-head +
// filter-summary structure every section already has.
function initCollapsibleSectionInfo(){
  document.querySelectorAll('.section-head + .filter-summary').forEach(el => {
    el.style.display = 'none';
    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'info-toggle';
    toggle.textContent = 'ⓘ Why this section exists';
    toggle.setAttribute('aria-expanded', 'false');
    toggle.addEventListener('click', () => {
      const opening = el.style.display === 'none';
      el.style.display = opening ? 'block' : 'none';
      toggle.setAttribute('aria-expanded', String(opening));
      toggle.textContent = opening ? '▾ Hide' : 'ⓘ Why this section exists';
    });
    el.parentNode.insertBefore(toggle, el);
  });
}
