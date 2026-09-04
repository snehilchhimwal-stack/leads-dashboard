// ============================================================
// core-rm-performance.js — RM Performance engine (Phase 1 of the Repeat
// Offenders redesign, 2026-09-04). Replaces "Avg Flagged = instances ÷
// distinct flagged leads" (the old ranking key in tab-repeat-offenders.js)
// with a workload-normalized, confidence-aware methodology. Full
// first-principles rationale was worked out in chat before this file was
// written — the short version: Avg Flagged has no real denominator (it's
// conditioned on ALREADY-flagged leads, never on the RM's actual book), so
// it can't tell "2 of this RM's 30 leads went chronically bad" from "both
// of this RM's 2 total leads went chronically bad" — same score, radically
// different stories. See HANDOVER.md for the full writeup once this
// lands.
//
// THE CORE IDEA: for every (lead, calendar day, one of the 5 SLA rules),
// was the lead ELIGIBLE for that rule that day, and if so did it PASS or
// FAIL? Roll that up per RM per rule into a real rate — violations ÷
// eligible lead-days — then adjust for small samples (shrinkage) and
// weight by how serious each rule actually is.
//
// WHERE THE DATA COMES FROM, DELIBERATELY: this reconstructs eligibility
// AND outcome for all 5 rules by re-running enrichLead (via the ALREADY-
// EXISTING enrichLeadAsOf/enrichSnapshotCached helpers, tab-movement.js)
// against each day's Movement_Log snapshot — not by reading
// Daily_RM_Issues. Daily_RM_Issues only ever stores the SINGLE highest-
// priority issue per lead per night (ISSUE_PRIORITY, primaryIssueGs_) and
// never records a lead that was eligible and PASSED — it's a violations-
// only log, which makes it structurally unable to supply a true
// denominator. Movement_Log's snapshots, by contrast, already carry every
// raw field enrichLead needs (confirmed against MovementTracker.gs's own
// SNAPSHOT_COLUMNS_), so re-deriving ALL 5 flags at once, pass or fail, is
// both more complete and requires no new capture-side changes. This means
// the same 7-day retention window that already limits totalLeadsByKey
// (tab-repeat-offenders.js) limits this too — see that function's own
// comment for the same caveat, repeated here: undercounts only affect a
// Custom/All-time range reaching further back than 7 days, not the
// Yesterday/This Week/Last 7 Days ranges this feature is built around.
//
// Depends on (all loaded earlier in dashboard.html): core-foundation.js
// (CONFIG, istDateKey, istSameDay, parseDate), core-lead-model.js
// (businessMinutesBetween — used only indirectly, via enrichLead's own
// neverConnectedPastWindow field), tab-movement.js (movementSnapshots,
// buildMovementHistories, splitHistoryByCopy, enrichSnapshotCached),
// tab-repeat-offenders.js (passesRepeatOffenderFilters — the Movement_Log-
// shaped filter matcher totalLeadsByKey already reuses for exactly this
// reason: a Movement_Log row's region is the raw captured value, not run
// through effectiveRegion()'s Loan-source inference the way a live lead
// row is).
//
// SCOPE OF THIS FILE: the reconstruction + aggregation + classification
// engine only. Nothing here renders to the DOM — wiring this into the
// Repeat Offenders tab (replacing its tables), the PDF export, and the
// DailyRmIssueLog.gs console leaderboard are separate, later phases (the
// live Movement_Log data needed for real-data verification requires a
// signed-in session; this phase is verified against a hand-computed
// synthetic fixture instead — see _verify-rm-performance.html).
// ============================================================

// Which of the 5 SLA rules count toward the composite score, and how much
// each one is weighted. "Inactive-RM Lead Added" is DELIBERATELY excluded
// from the composite — it fires because of who a lead got ROUTED to, not
// anything the RM did after receiving it (an org/assignment-process
// failure, not an RM execution failure). It's still tracked (see
// routingIssueDays on the classified result) and should be reported
// separately, never folded into an RM's own performance number. Weights
// are a starting point calibrated to how directly each rule reflects RM
// diligence, not a fixed truth — revisit with an ops manager if the
// ranking doesn't match ground truth once real data flows through this.
const RM_PERF_RULE_WEIGHTS = {
  isNotUpdated: 1.5,      // total neglect — the worst signal, and (since 2026-09-03) never capped by age
  followupOverdue: 1.2,   // direct post-connect diligence failure
  underCalledToday: 1.0,  // baseline effort signal
  stageStuck48h: 0.8,     // often overlaps with the more specific rules above; lowest in ISSUE_PRIORITY already
};
const RM_PERF_SCORED_RULE_KEYS = Object.keys(RM_PERF_RULE_WEIGHTS);

// Empirical-Bayes shrinkage constant, in DISTINCT-LEADS units (not lead-
// days — see aggregateRmPerformance's own comment on why lead-days would
// overstate confidence). Roughly "how many leads of evidence equal one
// unit of trust in the peer average" — an RM at this many eligible leads
// sits about half-way between their own observed rate and the peer
// average; far fewer leads pulls them almost entirely to the peer
// average; far more lets their own rate dominate. Calibrated near a
// typical RM's 7-day lead volume — revisit if that changes materially.
const RM_PERF_SHRINKAGE_K = 8;

// Below this many distinct eligible leads (across all scored rules
// combined), classification is always "Insufficient Data" regardless of
// how extreme the observed rate looks — a single bad lead should never be
// enough to brand someone the worst performer. See chat writeup §4.
const RM_PERF_MIN_VOLUME_LEADS = 5;

// A lead violating the SAME rule for this many CONSECUTIVE captured days
// (not just this many total instances) counts as a "chronic" lead for
// that rule — the concentration/persistence signal, tracked separately
// from the rate (see chat writeup §7 on why lead-level persistence and
// RM-level rate are two different questions, not one number).
const RM_PERF_CHRONIC_STREAK_DAYS = 3;

// An RM's composite must exceed the peer composite by this ratio before
// being flagged at all (Watch or Below Expectations) — a small, noisy
// excess over average isn't "below expectations", it's normal variance.
const RM_PERF_FLAG_RATIO = 1.25;

// A rule's elevated rate is "concentrated" (a case-management question —
// go check those specific leads) rather than "broad" (a coaching
// question — the RM's whole book is affected) when at least one violated
// lead is chronic (see above) AND violated leads are a SMALL SLICE of the
// RM's total eligible book for that rule. Breadth, not "share of violated
// leads that are chronic", is what actually distinguishes the two —
// deliberately NOT `chronicLeads / distinctViolatedLeads`, which cannot
// tell "6 of this RM's 6 leads are all chronically bad" (breadth 100%,
// definitely NOT a 2-lead case-management problem, arguably the worst
// case there is) apart from "2 of this RM's 30 leads are chronically bad"
// (breadth 6.7%, genuinely a small-case problem) — both would read as
// "every violated lead is chronic" under a violated-leads-only ratio.
// See chat writeup's worked examples (E vs F) for why this distinction is
// the whole point of this redesign.
const RM_PERF_CONCENTRATION_BREADTH_CEILING = 0.25; // violated leads must be <=25% of the eligible book

// Per-rule eligibility gates, expressed purely in terms of what
// enrichLead/enrichSnapshotCached ALREADY returns (ageHours, isUnder48h,
// hasConnected, neverConnectedPastWindow — see core-lead-model.js) plus
// two cheap local derivations (pastGrace from ageHours, isCreatedThatDay
// from istSameDay) — never a reimplementation of the rules themselves,
// only of WHEN each one applies. Ported from SlaEngine.gs's
// computeSlaFlags_ / js/core-lead-model.js's enrichLead — keep in sync
// with those if a rule's own gating condition ever changes.
//
//   inactiveRmNewLead — eligible only on the lead's OWN creation day
//     (computeSlaFlags_'s own comment: rm_is_active is a CURRENT snapshot,
//     not historical, so this can only ever be evaluated "as of" a day
//     that IS the creation day).
//   isNotUpdated — eligible once pastGrace (3h), OR immediately via the
//     neverConnectedPastWindow path (which itself already encodes "not
//     connected, isUnder48h, >10 business minutes old" — reusing that
//     returned field instead of re-deriving business-minutes here).
//   followupOverdue — only ever applies to CONNECTED leads under 48h old,
//     past grace.
//   underCalledToday / stageStuck48h — both simply "open, past grace";
//     stageStuck48h's OUTCOME (not eligibility) is what actually depends
//     on the 48h age threshold.
const RM_PERF_RULES = [
  { key: 'inactiveRmNewLead', label: 'Inactive-RM Lead Added',
    eligible: (e, ctx) => ctx.isCreatedThatDay },
  { key: 'isNotUpdated', label: 'Not Updated',
    eligible: (e, ctx) => ctx.pastGrace || e.neverConnectedPastWindow },
  { key: 'followupOverdue', label: 'Follow-up Overdue',
    eligible: (e, ctx) => e.isUnder48h && ctx.pastGrace && e.hasConnected },
  { key: 'underCalledToday', label: "Behind on Today's Calls",
    eligible: (e, ctx) => ctx.pastGrace },
  { key: 'stageStuck48h', label: 'Stuck 48h+',
    eligible: (e, ctx) => ctx.pastGrace },
];

// Calendar-day difference between two "YYYY-MM-DD" istDateKey strings.
// Parsed as UTC noon specifically to dodge any local-timezone DST edge
// (irrelevant to IST itself, which has none, but this runs in the
// browser's OWN local timezone, not IST) — noon anchoring means a day
// offset can never round to the wrong side from an hour-level DST shift
// in whatever zone the browser happens to be in.
function _rmPerfDaysBetweenKeys(a, b){
  const pa = a.split('-').map(Number), pb = b.split('-').map(Number);
  const da = Date.UTC(pa[0], pa[1] - 1, pa[2], 12);
  const db = Date.UTC(pb[0], pb[1] - 1, pb[2], 12);
  return Math.round((db - da) / 86400000);
}

// Stage 1 — walk every retained Movement_Log lead-copy history and emit
// one {name, lead_id, dayKey, rule, violated} record for every (lead, day,
// rule) combination where the lead was actually ELIGIBLE for that rule.
// dateKeys: null = every day Movement_Log still retains; a Set of
// istDateKey strings = restrict to those days only (same convention as
// totalLeadsByKey/repeatOffendersDateKeysForRange).
//
// keyFn(rec) picks the GROUPING key from the raw Movement_Log snapshot
// record — defaults to the RM, but the exact same reconstruction/rate/
// shrinkage/classification pipeline works unchanged for Region/A1-TM/RH
// rollups by passing a different keyFn, mirroring how
// aggregateRepeatOffenders(rows, keyFn) already generalizes across all 4
// of Repeat Offenders' old grouping levels. A record whose key resolves
// to null/'' (e.g. an RM not found in RM_Hierarchy for an A1-TM/RH
// rollup) is dropped entirely — same "unresolvable, excluded" population
// aggregateRepeatOffenders and totalLeadsByKey both already use.
//
// ONE reference snapshot per (lead-copy, calendar day) — the LATEST
// snapshot of that day — is used, mirroring totalLeadsByKey's own
// "latest snapshot wins" convention. Movement_Log's 4x-daily cadence
// (00:00/06:00/12:00/18:00 IST) means that's the 18:00 capture when
// present, the closest available proxy to Daily_RM_Issues' own 22:50 IST
// nightly capture time.
function reconstructRmPerformanceObservations(dateKeys, keyFn){
  const observations = [];
  if (typeof movementSnapshots === 'undefined' || !movementSnapshots.length) return observations;
  const getKey = keyFn || (rec => rec.RM || 'Unassigned');

  const byLead = buildMovementHistories();
  byLead.forEach(history => {
    splitHistoryByCopy(history).forEach(copyHistory => {
      const byDay = new Map(); // dayKey -> latest snapshot record that day
      copyHistory.forEach(rec => {
        if (!passesRepeatOffenderFilters(rec)) return;
        const dayKey = istDateKey(rec.snapshot_at);
        if (dateKeys && !dateKeys.has(dayKey)) return;
        const cur = byDay.get(dayKey);
        if (!cur || rec.snapshot_at > cur.snapshot_at) byDay.set(dayKey, rec);
      });
      if (!byDay.size) return;

      Array.from(byDay.keys()).sort().forEach(dayKey => {
        const rec = byDay.get(dayKey);
        const groupKey = getKey(rec);
        if (!groupKey) return; // unresolvable for this rollup — excluded, not "Unassigned"

        const enriched = enrichSnapshotCached(rec);
        if (!enriched.isOpenLead) return; // a closed lead is eligible for nothing

        const ctx = {
          pastGrace: enriched.ageHours !== null && enriched.ageHours >= CONFIG.LEAD_GRACE_HOURS,
          isCreatedThatDay: istSameDay(parseDate(rec.lead_assigned_at), rec.snapshot_at),
        };

        RM_PERF_RULES.forEach(rule => {
          if (!rule.eligible(enriched, ctx)) return;
          observations.push({
            name: groupKey,
            lead_id: String(rec.lead_id || '').trim(),
            dayKey: dayKey,
            rule: rule.key,
            violated: !!enriched[rule.key],
          });
        });
      });
    });
  });

  return observations;
}

// Stage 2 — roll Stage 1's raw observations up to group x rule: eligible/
// violation lead-day counts, distinct eligible/violated lead counts, and
// the persistence signal (longest run of CONSECUTIVE-CALENDAR-DAY
// violations on any single lead, plus how many leads hit the chronic
// threshold). Returns a Map keyed by the same grouping key
// reconstructRmPerformanceObservations was called with (RM name by
// default, or whatever keyFn produced — a region, an A1/TM, an RH).
//
// Confidence for the shrinkage step (Stage 3) is deliberately based on
// DISTINCT ELIGIBLE LEADS, not eligible lead-days, even though the RATE
// itself is computed from lead-days — a lead flagged 5 consecutive nights
// is 5 correlated observations of the same underlying problem, not 5
// independent trials, so counting lead-days as "sample size" would
// overstate how much evidence a single chronic lead actually provides.
function aggregateRmPerformance(observations){
  const byGroup = new Map();

  observations.forEach(o => {
    if (!byGroup.has(o.name)) byGroup.set(o.name, { name: o.name, rules: new Map() });
    const groupEntry = byGroup.get(o.name);
    if (!groupEntry.rules.has(o.rule)) {
      groupEntry.rules.set(o.rule, {
        eligibleDays: 0, violationDays: 0,
        eligibleLeads: new Set(), violatedLeads: new Set(),
        perLead: new Map(), // lead_id -> [{dayKey, violated}, ...]
      });
    }
    const r = groupEntry.rules.get(o.rule);
    r.eligibleDays++;
    r.eligibleLeads.add(o.lead_id);
    if (o.violated) { r.violationDays++; r.violatedLeads.add(o.lead_id); }
    if (!r.perLead.has(o.lead_id)) r.perLead.set(o.lead_id, []);
    r.perLead.get(o.lead_id).push({ dayKey: o.dayKey, violated: o.violated });
  });

  byGroup.forEach(groupEntry => {
    groupEntry.rules.forEach(r => {
      r.rate = r.eligibleDays ? r.violationDays / r.eligibleDays : 0;
      r.distinctEligibleLeads = r.eligibleLeads.size;
      r.distinctViolatedLeads = r.violatedLeads.size;

      let maxStreak = 0, chronicLeads = 0;
      r.perLead.forEach(days => {
        days.sort((a, b) => a.dayKey < b.dayKey ? -1 : (a.dayKey > b.dayKey ? 1 : 0));
        let streak = 0, best = 0, prevDayKey = null;
        days.forEach(d => {
          const adjacent = prevDayKey !== null && _rmPerfDaysBetweenKeys(prevDayKey, d.dayKey) === 1;
          streak = d.violated ? (adjacent ? streak + 1 : 1) : 0;
          if (streak > best) best = streak;
          prevDayKey = d.dayKey;
        });
        if (best > maxStreak) maxStreak = best;
        if (best >= RM_PERF_CHRONIC_STREAK_DAYS) chronicLeads++;
      });
      r.maxStreak = maxStreak;
      r.chronicLeads = chronicLeads;
    });
  });

  return byGroup;
}

// Company-wide (all groups currently in byGroup) violation rate per rule,
// weighted by lead-days rather than a plain average-of-group-rates — a
// group with 200 eligible lead-days should influence the peer baseline
// more than one with 6, same reasoning as any exposure-weighted rate.
function computeRmPerfPeerAverages(byGroup){
  const totals = {};
  byGroup.forEach(groupEntry => {
    groupEntry.rules.forEach((r, ruleKey) => {
      if (!totals[ruleKey]) totals[ruleKey] = { violationDays: 0, eligibleDays: 0 };
      totals[ruleKey].violationDays += r.violationDays;
      totals[ruleKey].eligibleDays += r.eligibleDays;
    });
  });
  const peerAvg = {};
  Object.keys(totals).forEach(ruleKey => {
    peerAvg[ruleKey] = totals[ruleKey].eligibleDays ? totals[ruleKey].violationDays / totals[ruleKey].eligibleDays : 0;
  });
  return peerAvg;
}

// Stage 3+4 — shrink each group's per-rule rate toward the peer average
// (weighted by distinct-lead confidence, see aggregateRmPerformance's own
// comment), combine into one severity-weighted composite score, and
// classify. Returns an array, most-concerning first (highest composite),
// each entry: { name, distinctLeads, composite, peerComposite, rules:
// {ruleKey: {eligibleDays, violationDays, distinctEligibleLeads,
// distinctViolatedLeads, rawRate, shrunkRate, maxStreak, chronicLeads,
// concentrated}}, routingIssueDays, classification }.
//
// classification is one of:
//   'Insufficient Data'      — fewer than RM_PERF_MIN_VOLUME_LEADS distinct
//                               eligible leads; too little evidence to say
//                               anything, regardless of how the rate looks.
//   'On Track'                — composite within RM_PERF_FLAG_RATIO of peer.
//   'Watch — concentrated'    — composite elevated, but driven by chronic
//                               leads (a case-management question).
//   'Below Expectations'      — composite elevated, and NOT concentrated —
//                               a broad pattern across the group's own book.
function classifyRmPerformance(byGroup){
  const peerAvg = computeRmPerfPeerAverages(byGroup);
  const peerComposite = RM_PERF_SCORED_RULE_KEYS.reduce(
    (sum, k) => sum + RM_PERF_RULE_WEIGHTS[k] * (peerAvg[k] || 0), 0);

  const results = [];
  byGroup.forEach(groupEntry => {
    let composite = 0;
    const allEligibleLeads = new Set();
    let anyConcentrated = false;
    const perRuleOut = {};

    RM_PERF_SCORED_RULE_KEYS.forEach(ruleKey => {
      const r = groupEntry.rules.get(ruleKey);
      const eligibleDays = r ? r.eligibleDays : 0;
      const violationDays = r ? r.violationDays : 0;
      const distinctEligibleLeads = r ? r.distinctEligibleLeads : 0;
      const distinctViolatedLeads = r ? r.distinctViolatedLeads : 0;
      const rawRate = eligibleDays ? violationDays / eligibleDays : 0;
      const shrunkRate = (distinctEligibleLeads / (distinctEligibleLeads + RM_PERF_SHRINKAGE_K)) * rawRate
        + (RM_PERF_SHRINKAGE_K / (distinctEligibleLeads + RM_PERF_SHRINKAGE_K)) * (peerAvg[ruleKey] || 0);
      const chronicLeads = r ? r.chronicLeads : 0;
      const concentrated = chronicLeads > 0 && distinctEligibleLeads > 0
        && (distinctViolatedLeads / distinctEligibleLeads) <= RM_PERF_CONCENTRATION_BREADTH_CEILING;

      composite += RM_PERF_RULE_WEIGHTS[ruleKey] * shrunkRate;
      if (r) r.eligibleLeads.forEach(id => allEligibleLeads.add(id));
      if (concentrated) anyConcentrated = true;

      perRuleOut[ruleKey] = {
        eligibleDays, violationDays, distinctEligibleLeads, distinctViolatedLeads,
        rawRate, shrunkRate, maxStreak: r ? r.maxStreak : 0, chronicLeads, concentrated,
      };
    });

    const inactiveRmRule = groupEntry.rules.get('inactiveRmNewLead');
    const nLeads = allEligibleLeads.size;

    let classification;
    if (nLeads < RM_PERF_MIN_VOLUME_LEADS) classification = 'Insufficient Data';
    else if (composite <= peerComposite * RM_PERF_FLAG_RATIO) classification = 'On Track';
    else if (anyConcentrated) classification = 'Watch — concentrated';
    else classification = 'Below Expectations';

    results.push({
      name: groupEntry.name,
      distinctLeads: nLeads,
      composite: composite,
      peerComposite: peerComposite,
      rules: perRuleOut,
      routingIssueDays: inactiveRmRule ? inactiveRmRule.violationDays : 0,
      classification: classification,
    });
  });

  return results.sort((a, b) => b.composite - a.composite);
}

// Top-level orchestration — the one function UI wiring should actually
// call. dateKeys: same convention as reconstructRmPerformanceObservations
// (null = all retained history, a Set of istDateKey strings = restrict to
// those days). keyFn: same convention too (defaults to RM) — pass
// rec => primaryManagerForRm(rec.RM) / rec => rhForRm(rec.RM) /
// rec => _repeatOffendersRegionKey(rec) (all tab-repeat-offenders.js) for
// the A1-TM / RH / Region rollups, exactly as aggregateRepeatOffenders'
// own callers already do.
function computeRmPerformance(dateKeys, keyFn){
  const observations = reconstructRmPerformanceObservations(dateKeys, keyFn);
  const byGroup = aggregateRmPerformance(observations);
  return classifyRmPerformance(byGroup);
}

// Shared display helpers — used by BOTH the live tab
// (js/tab-repeat-offenders.js's rmPerformanceTableHtml) and the PDF export
// (js/repeat-offenders-pdf.js), so "which rule is actually driving an
// elevated score" and "what order to list groups in" can never quietly
// drift apart between the two surfaces the way this dashboard's dual .gs/
// browser SLA logic already has to be deliberately kept in sync (see
// HANDOVER.md §6) — here it's the same JS runtime on both sides, so
// there's no excuse for two copies at all.

// The 1-2 scored rules actually pushing a classified result's score up,
// ranked by their real weighted contribution to the composite (weight ×
// shrunkRate), worst first. Filtered to rules with a REAL violation
// (violationDays>0), not merely a nonzero shrunkRate — shrinkage alone
// gives every rule a small nonzero blended rate toward the peer average
// even with zero actual violations, which would otherwise list a rule the
// group never broke. Returns [] for On Track/Insufficient Data (nothing
// worth calling out) — same gate both renderers already need, extracted
// here so neither can forget it. Each entry: {key, label, weight,
// eligibleDays, violationDays, distinctEligibleLeads, distinctViolatedLeads,
// rawRate, shrunkRate, maxStreak, chronicLeads, concentrated}.
function rmPerformanceDrivenBy(r){
  if (r.classification !== 'Below Expectations' && r.classification !== 'Watch — concentrated') return [];
  return RM_PERF_SCORED_RULE_KEYS
    .map(k => Object.assign(
      { key: k, weight: RM_PERF_RULE_WEIGHTS[k], label: (RM_PERF_RULES.find(rr => rr.key === k) || {}).label || k },
      r.rules[k]
    ))
    .filter(x => x.violationDays > 0)
    .sort((a, b) => (b.weight * b.shrunkRate) - (a.weight * a.shrunkRate))
    .slice(0, 2);
}

// Most-concerning first: classification tier before composite score, so
// an "Insufficient Data" row (which can still carry a nonzero shrunk
// composite — shrinkage still blends toward the peer average even below
// the volume gate) never outranks a real "Below Expectations" finding
// just because its raw number happens to be higher. classifyRmPerformance's
// own return is only sorted by raw composite — this is the display-order
// pass both renderers need on top of that.
function sortRmPerformanceByPriority(list){
  const rank = c => c === 'Below Expectations' ? 0 : c === 'Watch — concentrated' ? 1 : c === 'On Track' ? 2 : 3;
  return list.slice().sort((a, b) => (rank(a.classification) - rank(b.classification)) || (b.composite - a.composite));
}
