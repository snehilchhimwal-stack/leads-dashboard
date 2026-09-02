// ============================================================
// core-foundation.js — CONFIG, ISSUE_PRIORITY, and the IST time core.
// Loaded FIRST of the 9 files core.js was split into (Phase 2 of the
// modularity refactor pass — see HANDOVER.md). Zero-dependency data
// (CONFIG, ISSUE_PRIORITY) plus the IST wall-clock <-> instant helpers
// everything else in the app is built on. Pure code motion out of the
// original core.js — no logic changed; see that file's own former
// header for why core.js itself was loaded first.
//
// A few functions below (renderCardsByDay in particular) reference
// MAX_CARDS/_renderNow, which are defined in LATER-loading split files
// (core-ui.js/core-lead-model.js) — safe because every classic <script>
// on this page shares one global scope, and none of these are called
// until well after every js/*.js file has finished loading (the sign-in
// gate blocks all real work until then). Load order across the 9 core
// splits only matters for code that runs at SCRIPT-PARSE time, not
// inside a function body — see core-foundation.js's own note in
// HANDOVER.md for the one real instance of that (reports.js's top-level
// use of ISSUE_PRIORITY, which is why every core split loads before
// every tab-*.js/reports.js file, same as core.js always did as a whole).
// ============================================================

// ============================================================
// core.js — shared foundation for the Leads Dashboard.
// Loaded FIRST (before every other js/*.js file) — everything
// else in the app depends on functions/state defined here.
// Extracted from dashboard.html's single inline <script> block
// (see the file-split plan) — pure code motion, no logic changed.
// ============================================================

const CONFIG = {
  MIN_CALLS_PER_DAY: 5,
  MIN_CALLS_AFTER_48H: 10,
  LEAD_LIFECYCLE_HOURS: 48,
  FIRST_CONTACT_SLA_MINUTES: 10,
  // Movement tab's Overnight Leads card — the after-hours window before
  // the morning shift starts, anchored on _renderNow's own calendar day:
  // 5 PM the day before through 9 AM today.
  OVERNIGHT_START_HOUR: 17,  // 5 PM, previous day
  OVERNIGHT_END_HOUR: 9,     // 9 AM, "To" day
  // Working hours. The 10-minute first-contact clock only runs inside this
  // window, so a lead arriving at 6:58 PM isn't marked breached overnight —
  // it has 2 minutes of that evening plus 8 the next morning.
  WORK_START_HOUR: 9,   // 9 AM
  WORK_END_HOUR: 19,    // 7 PM
  // Universal grace period, measured from lead assignment. Every check EXCEPT
  // the 10-minute first-contact rule stays silent until a lead is this old,
  // so RMs get time to work a fresh lead before anything is flagged.
  LEAD_GRACE_HOURS: 3,
  FOLLOWUP_REVIEW_HOURS: 4,
  FUNNEL_ORDER: ['not updated','suspect','opportunity','visit booked','visit','pipeline','gross eoi application','soft booking','booking'],
  // Real CRM stage text doesn't always match the canonical funnel name
  // exactly (e.g. "Booked" instead of "Booking"). Each canonical stage is
  // matched against any of these substrings, case-insensitive.
  // ORDER MATTERS: canonicalStage returns the FIRST FUNNEL_ORDER entry that
  // matches, and several stage names contain each other's words:
  //   "visit booked"  contains "visit" AND "booked"  -> must precede both
  //   "soft booking"  contains "booking"             -> must precede booking
  // A visit that is merely SCHEDULED must not count as a completed visit,
  // and a soft booking (payment in, papers pending) must not count as a
  // confirmed booking.
  STAGE_ALIASES: {
    'not updated': ['not updated'],
    'suspect': ['suspect'],
    'opportunity': ['opportunity'],
    'visit booked': ['visit booked', 'visit booking', 'visit scheduled'],
    // Revisit already matches on "visit"; hpop and video presentation don't,
    // so they need naming. All are the same funnel tier: the customer was
    // actually met, by whichever channel.
    'visit': ['visit', 'revisit', 'hpop', 'video presentation', 'video call'],
    'pipeline': ['pipeline'],
    'gross eoi application': ['gross eoi application', 'gross eoi', 'eoi application', 'eoi'],
    'soft booking': ['soft booking', 'soft book'],
    'booking': ['booking', 'booked'],
  },
  OPPORTUNITY_STAGE: 'opportunity',
  // SOP defines closure as Won / Lost / Junk / Not Interested. Split into
  // two lists because they need different matching:
  //   EXACT — must appear as a whole word (or full phrase). Keeps "won" from
  //           matching "won't" / "wondering", and "dead" from "deadline".
  //   STEMS — matched as a whole-word prefix, so "cancel" catches
  //           "Cancelled" / "Cancellation" without matching mid-word.
  // Check the stage breakdown after connecting — it shows exactly which of
  // your real stage values got matched here.
  CLOSED_STAGE_EXACT: ['won', 'lost', 'junk', 'dead', 'not interested'],
  CLOSED_STAGE_STEMS: ['cancel', 'close', 'reject'],
};

// Relocated here (from dashboard.html's "Issues CSV Export" section) because
// js/reports-build.js builds a derived lookup from this array at its OWN top
// level (see _FLAG_BY_ISSUE_PRIORITY_LABEL), which runs at script-load time
// — this has to be defined before that runs, and this file is the first of
// the 9 core-*.js splits, guaranteed to load before every other js/*.js
// file. Read by the filter engine, Tracking, RM Timeline, Movement,
// Reports, and Sheets write-back.
//
// Ordered by priority: when a lead matches more than one check (e.g. both
// "Stuck" and "Behind on Today's Calls" are both legitimately true for the
// same old, under-called lead), each view needing one clear primary reason
// per lead picks the first match here. Dashboard sections themselves are
// unaffected — each still independently shows everything matching its own
// definition, since that's needed for real operational use.
//
// firstContactBreach ("Not Connected in 10 Minutes") is deliberately NOT in
// this list. It's a retrospective fact (first contact happened, just after
// the 10-minute window) that already happened and can't be corrected —
// unlike every other entry here, there is no follow-up action left to take
// on the LEAD itself. Letting it sit in this shared priority list meant it
// could outrank a genuinely still-actionable issue (e.g. Follow-up Overdue)
// for the same lead in the combined report, hiding the thing someone could
// actually still do something about, and it polluted "flagged"/"stalled"/
// "remediate" stats built for things that DO get remediated. It still has
// its own dedicated report — see ISSUE_REPORT_META.notConnected in
// reports.js — which reads as a reminder to the region's RH of which RMs
// missed the response-time SLA, not an action list.
const ISSUE_PRIORITY = [
  { key: 'inactiveRmNewLead', label: 'Inactive-RM Lead Added' },
  { key: 'isNotUpdated', label: 'Not Updated' },
  { key: 'followupOverdue', label: 'Follow-up Overdue (4h Post-Connect)' },
  { key: 'underCalledToday', label: "Behind on Today's Calls" },
  { key: 'stageStuck48h', label: 'Leads Pending Beyond 48 Hours (Not Yet Opportunity)' },
];

/* ========================= IST TIME CORE =========================
 * Every timestamp in the sheet is IST wall-clock (the SQL export was moved
 * from UTC to IST). Those components are converted to real instants HERE,
 * explicitly, rather than by handing them to `new Date(y, m, d, ...)` —
 * that constructor reads the BROWSER's timezone, so the same sheet produced
 * a different instant on a non-IST machine and every age, SLA and
 * business-hours figure silently shifted with it.
 *
 * Internally all dates are absolute instants. IST wall-clock appears only
 * at the two boundaries: reading the sheet, and printing to screen.
 */
const IST_OFFSET_MS = 330 * 60000;   // +05:30, no DST

// IST wall-clock components -> real instant. Overflowing values are fine:
// Date.UTC rolls day 32 into the next month, so istAddDays can lean on it.
function istWallToInstant(y, mo, d, h, mi, s){
  return new Date(Date.UTC(y, mo, d, h || 0, mi || 0, s || 0) - IST_OFFSET_MS);
}

// Real instant -> IST wall-clock parts.
function istParts(date){
  const t = new Date(date.getTime() + IST_OFFSET_MS);
  return {
    y: t.getUTCFullYear(), mo: t.getUTCMonth(), d: t.getUTCDate(),
    h: t.getUTCHours(), mi: t.getUTCMinutes(), s: t.getUTCSeconds(), dow: t.getUTCDay(),
  };
}

function istStartOfDay(date){
  const p = istParts(date);
  return istWallToInstant(p.y, p.mo, p.d, 0, 0, 0);
}

function istAddDays(date, n){
  const p = istParts(date);
  return istWallToInstant(p.y, p.mo, p.d + n, p.h, p.mi, p.s);
}

function istSameDay(a, b){
  if (!a || !b) return false;
  const pa = istParts(a), pb = istParts(b);
  return pa.y === pb.y && pa.mo === pb.mo && pa.d === pb.d;
}

// YYYY-MM-DD in IST — used for day bucketing, so a lead assigned at 11 PM IST
// lands on the IST day, not the UTC one.
function istDateKey(date){
  const p = istParts(date);
  return `${p.y}-${String(p.mo + 1).padStart(2, '0')}-${String(p.d).padStart(2, '0')}`;
}

// "Today (22 Aug)" / "Yesterday (21 Aug)" / "3 days ago (19 Aug)" — the
// relative half is what a reader scans for, the absolute date is what
// makes the label unambiguous once it's a few days old. dayKey/todayKey
// are both istDateKey() strings ("YYYY-MM-DD"), diffed as plain calendar
// dates (UTC-based Date.UTC on the same y/m/d numbers) rather than real
// elapsed time — the point is which IST calendar day, not a 24h duration.
// IST_MONTHS is defined in reports.js, but nothing here resolves it until
// this function actually runs (long after every script has loaded), so
// the load-order difference doesn't matter — same reasoning applies
// throughout this codebase's classic-script/global-function split.
function relativeDayLabel(dayKey, todayKey){
  const [y1, m1, d1] = dayKey.split('-').map(Number);
  const [y2, m2, d2] = todayKey.split('-').map(Number);
  const diffDays = Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86400000);
  const dateLabel = `${d1} ${IST_MONTHS[m1 - 1]}`;
  if (diffDays === 0) return `Today (${dateLabel})`;
  if (diffDays === 1) return `Yesterday (${dateLabel})`;
  if (diffDays > 1) return `${diffDays} days ago (${dateLabel})`;
  return dateLabel; // future-dated — shouldn't normally happen, just show the date
}

// Buckets an array of leads by lead_assigned_at's IST calendar day, newest
// day first, WITHOUT re-sorting within a bucket — a leads array arriving
// already sorted by the caller's own criterion (age, delay, whatever gap
// metric that section cares about) keeps that order inside each day
// bucket, since Array.forEach/push is stable. Undatable leads (no
// parseable lead_assigned_at) land in one trailing "Unknown date" bucket
// rather than being silently dropped or crashing the date math.
function groupLeadsByCalendarDay(leadsArr, asOfDate){
  const byDay = new Map();
  const unknown = [];
  leadsArr.forEach(l => {
    const d = parseDate(l.lead_assigned_at);
    if (!d) { unknown.push(l); return; }
    const key = istDateKey(d);
    if (!byDay.has(key)) byDay.set(key, []);
    byDay.get(key).push(l);
  });
  const todayKey = istDateKey(asOfDate || _renderNow);
  const keys = Array.from(byDay.keys()).sort((a, b) => (a < b ? 1 : a > b ? -1 : 0)); // newest calendar day first
  const groups = keys.map(key => ({ key, label: relativeDayLabel(key, todayKey), leads: byDay.get(key) }));
  if (unknown.length) groups.push({ key: 'unknown', label: 'Unknown date', leads: unknown });
  return groups;
}

// Shared card-list day-header — same visual pattern as the amber/red
// sub-band labels already used elsewhere (Approaching Deadline vs Stuck,
// the 0–48h/past-48h split) so a day boundary reads as the same kind of
// thing, not a new UI element.
function dayGroupHeaderHtml(label, isFirst){
  return `<div class="stall-group-label" style="color:var(--text-faint); margin:${isFirst ? '0' : '16px'} 0 8px;">${esc(label)}</div>`;
}

// Renders a truncated, already-sorted lead group as day-bucketed cards —
// MAX_CARDS applies to the whole group FIRST (so the cap means "the N
// most relevant cards overall," not "N per day"), then what's left is
// bucketed by calendar day. cardFn(lead, globalIdx) builds one card's
// HTML; globalIdx is a running index across the ENTIRE shown list, not
// reset per bucket — several render functions build a logToggle id from
// this index (prefix + '_' + idx), and resetting per bucket would produce
// colliding ids across buckets.
function renderCardsByDay(group, cardFn){
  const shown = group.slice(0, MAX_CARDS);
  const dayGroups = groupLeadsByCalendarDay(shown, _renderNow);
  let globalIdx = 0;
  return dayGroups.map((dg, gi) => {
    const header = dayGroupHeaderHtml(dg.label, gi === 0);
    const cards = dg.leads.map(l => cardFn(l, globalIdx++)).join('');
    return header + cards;
  }).join('');
}

