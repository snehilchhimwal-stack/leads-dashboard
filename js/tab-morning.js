// ============================================================
// tab-morning.js — Morning Brief tab: the 10 things from the 0–48 Hour
// Funnel Audit's closing section ("THE 10 THINGS I SHOULD KNOW EVERY
// MORNING"), each backed by data already computed elsewhere in the app.
// No new business logic lives here — every card either calls an existing
// shared function (computeRMScoreRows, computeDailyLeadCounts, topBreakdown)
// or filters `leads`/`issueLeads` the exact same way the section it mirrors
// already does (Operations' Approaching Deadline / Stuck / No Attempts
// Yet). Where the audit's own trigger threshold can't be evaluated from
// data actually in this sheet (team capacity, "since yesterday" with no
// persisted state), the card shows the raw number instead of a fabricated
// status — see the pill logic below.
// Depends on core.js and overview-distribution-people-ops.js (loaded
// before this file's functions are ever CALLED, though not necessarily
// before this file is loaded — nothing here runs until renderAll()).
// ============================================================

function briefPill(status, label){
  if (!status) return '';
  const cls = status === 'ok' ? 'green-chip' : status === 'warn' ? 'amber' : 'red';
  return `<span class="chip ${cls}" style="margin-left:8px;">${esc(label)}</span>`;
}

// One consistent card shell for all 10 — number/label up top (status pill
// inline), then Why / Action always visible (not hover-gated, unlike the
// KPI tiles — this tab exists to be read once, top to bottom, not explored).
function briefCard(opts){
  return `<div style="background:var(--surface); border:1px solid var(--border); border-radius:10px; padding:16px 18px; margin-bottom:12px;">
    <div style="display:flex; align-items:baseline; gap:10px; flex-wrap:wrap;">
      <span style="font-family:'Space Grotesk',sans-serif; font-size:15px; font-weight:700; color:var(--text-faint);">${opts.rank}.</span>
      <span class="mono" style="font-size:26px; font-weight:700;${opts.numColor ? ` color:${opts.numColor};` : ''}">${opts.numHtml}</span>
      <span style="font-size:14px; font-weight:600;">${esc(opts.label)}</span>
      ${briefPill(opts.status, opts.statusLabel)}
    </div>
    ${opts.detailHtml || ''}
    <div style="margin-top:10px; font-size:12.5px; color:var(--text-dim); line-height:1.6;">
      <b style="color:var(--text-faint);">Why:</b> ${esc(opts.why)}<br>
      <b style="color:var(--text-faint);">Action:</b> ${esc(opts.action)}
    </div>
  </div>`;
}

function renderMorningBrief(){
  const el = document.getElementById('morningBriefCards');
  if (!el) return;

  const cards = [];

  // 1. Leads entering, last 24h, vs the trailing 7-day average (7 full IST
  // calendar days before today, excluding today itself since it's still
  // accumulating). Reuses the same day-bucketing renderDailyTrend uses.
  {
    const in24h = leads.filter(l => l.ageHours != null && l.ageHours <= 24).length;
    const byDay = computeDailyLeadCounts();
    const todayKey = istDateKey(_renderNow);
    const priorDays = Array.from(byDay.keys()).filter(k => k < todayKey).sort().slice(-7);
    const avg7d = priorDays.length ? priorDays.reduce((s, k) => s + byDay.get(k).total, 0) / priorDays.length : null;
    let status = null, statusLabel = '', detailHtml = '';
    if (avg7d != null && avg7d > 0) {
      const pctDiff = ((in24h - avg7d) / avg7d) * 100;
      status = Math.abs(pctDiff) > 30 ? 'warn' : 'ok';
      statusLabel = `${pctDiff >= 0 ? '+' : ''}${pctDiff.toFixed(0)}% vs 7d avg`;
      detailHtml = `<div style="font-size:11.5px; color:var(--text-faint); margin-top:4px;">7-day average (prior ${priorDays.length} day${priorDays.length === 1 ? '' : 's'}): ${avg7d.toFixed(1)}/day</div>`;
    }
    cards.push(briefCard({
      rank: 1, numHtml: in24h.toLocaleString(), label: 'Leads entering, last 24h',
      status, statusLabel, detailHtml,
      why: 'Baseline for everything else today — every other card below is a fraction or a rate of leads assigned around this window.',
      action: 'If the swing is ±30% or more, check Overview → source breakdown for a channel spike or drop before assuming anything downstream changed.',
    }));
  }

  // 2. Currently in the 0–48h window, right now.
  {
    const inWindow = leads.filter(l => l.isUnder48h).length;
    cards.push(briefCard({
      rank: 2, numHtml: inWindow.toLocaleString(), label: 'Currently in the 0–48h window',
      why: "Today's live workload — every lead still inside its first-48-hour outcome window.",
      action: "No automatic threshold here (this dashboard has no per-RM capacity figure to compare against) — cross-check against People → RM Workload if this count feels high.",
    }));
  }

  // 3. 48h failure rate, LIVE (not the cohort-correct version — see card
  // text). Denominator: leads whose 48h window has already elapsed
  // (ageHours > 48, regardless of current status); numerator: of those,
  // still open and not yet Opportunity+ (exactly stageStuck48h's own
  // definition, since past48h implies pastGrace already).
  {
    const cohortLive = leads.filter(l => l.ageHours != null && l.ageHours > 48);
    const failedLive = cohortLive.filter(l => l.isOpenLead);
    const rate = cohortLive.length ? (failedLive.length / cohortLive.length) * 100 : null;
    cards.push(briefCard({
      rank: 3, numHtml: rate == null ? '—' : `${rate.toFixed(1)}%`,
      numColor: rate != null && rate > 20 ? 'var(--red)' : null,
      label: '48h failure rate (live)',
      status: rate == null ? null : (rate > 20 ? 'bad' : 'ok'),
      statusLabel: rate == null ? '' : (rate > 20 ? '> 20% threshold' : 'within 20%'),
      detailHtml: `<div style="font-size:11.5px; color:var(--text-faint); margin-top:4px;">${failedLive.length.toLocaleString()} still open of ${cohortLive.length.toLocaleString()} whose 48h window has elapsed (live snapshot — re-evaluated against right now, not a persisted cohort outcome; see Tracking → 0–48h Cohort Outcome for the historical/cohort-correct version)</div>`,
      why: 'The single headline number for this window.',
      action: 'Above 20%, open Operations → Leads Pending Beyond 48 Hours and check the stage breakdown for where the leak actually is.',
    }));
  }

  // 4 & 10. Median + p90 time to first action — org-wide, same source as
  // the People-tab column and the Overview KPI tile.
  let medianContact = null, p90Contact = null, contactN = 0;
  {
    const mins = [];
    leads.forEach(l => { if (l.businessMinsToConnect != null) mins.push(l.businessMinsToConnect); });
    mins.sort((a, b) => a - b);
    medianContact = medianOfSorted(mins);
    p90Contact = percentileOfSorted(mins, 90);
    contactN = mins.length;
    cards.push(briefCard({
      rank: 4, numHtml: medianContact == null ? '—' : `${medianContact.toFixed(0)}m`,
      numColor: medianContact != null && medianContact > CONFIG.FIRST_CONTACT_SLA_MINUTES ? 'var(--red)' : null,
      label: 'Median time to first action',
      status: medianContact == null ? null : (medianContact > CONFIG.FIRST_CONTACT_SLA_MINUTES ? 'bad' : 'ok'),
      statusLabel: medianContact == null ? '' : (medianContact > CONFIG.FIRST_CONTACT_SLA_MINUTES ? `> ${CONFIG.FIRST_CONTACT_SLA_MINUTES}min SLA` : 'within SLA'),
      detailHtml: `<div style="font-size:11.5px; color:var(--text-faint); margin-top:4px;">n = ${contactN.toLocaleString()} connected lead${contactN === 1 ? '' : 's'} (open or closed) · business-hours minutes from lead_assigned_at to first connect</div>`,
      why: 'The fastest-actionable lever in the whole 0–48h window.',
      action: `Above ${CONFIG.FIRST_CONTACT_SLA_MINUTES} minutes, check People → RM Performance's Median 1st Contact column for which RM/region is driving it.`,
    }));
  }

  // 5. Zero action, past grace — same definition as Overview's "No
  // Attempts Yet" KPI tile (isOpenLead && call_attempts === 0), with the
  // audit's explicit "past grace" clause added (ageHours >= LEAD_GRACE_HOURS
  // — not itself an exposed field on the lead object, so recomputed here
  // from the same public ageHours + CONFIG value enrichLead already uses).
  {
    const zeroAction = leads.filter(l => l.isOpenLead && l.call_attempts === 0 && l.ageHours != null && l.ageHours >= CONFIG.LEAD_GRACE_HOURS);
    cards.push(briefCard({
      rank: 5, numHtml: zeroAction.length.toLocaleString(),
      numColor: zeroAction.length > 0 ? 'var(--red)' : null,
      label: 'Leads with zero action, past grace',
      status: zeroAction.length > 0 ? 'bad' : 'ok', statusLabel: zeroAction.length > 0 ? 'needs a call' : 'clear',
      why: 'Pure inaction — the cheapest fix available. No calls at all, past the 3-hour grace period.',
      action: 'Any count above zero past mid-morning: message the owning RM directly rather than waiting for the next SLA cycle.',
    }));
  }

  // 6. 36–48h "approaching deadline" tier — same population as Operations'
  // own Approaching 48h Deadline section.
  {
    const approaching = issueLeads.filter(l => l.isOpenLead && !l.stageStuck48h && l.ageHours != null && l.ageHours >= 36 && l.ageHours <= 48);
    const approachingUnique = countUniqueAndCloned(approaching).unique;
    cards.push(briefCard({
      rank: 6, numHtml: approachingUnique.toLocaleString(), label: 'Leads in the 36–48h amber tier',
      why: "Tomorrow's failures, visible today — the whole reason this tier exists as its own section.",
      action: 'No day-over-day comparison available (would need a persisted count from yesterday) — reassign or personally intervene on these before the 48h mark, via Operations → Approaching 48h Deadline.',
    }));
  }

  // 7. Stuck-by-stage breakdown — reuses topBreakdown against exactly the
  // Stuck section's own population, same as Operations' own stage bar.
  {
    const stuck = issueLeads.filter(l => l.isOpenLead && l.stageStuck48h);
    const b = topBreakdown(stuck, l => l.current_stage, { color: 'var(--red)', limit: 5 });
    const topPct = b.top ? b.top.pct : 0;
    cards.push(briefCard({
      rank: 7, numHtml: stuck.length.toLocaleString(), label: 'Stuck leads, by stage',
      status: stuck.length ? (topPct > 40 ? 'bad' : 'ok') : null,
      statusLabel: stuck.length ? (topPct > 40 ? `${esc(b.top.key)} = ${topPct}%` : 'spread across stages') : '',
      detailHtml: stuck.length ? `<div style="margin-top:8px;">${b.html}</div>` : '',
      why: 'Shows WHERE the funnel leaks, not just that it does.',
      action: 'If any one stage holds more than 40% of all stuck leads, investigate that stage specifically — a process problem, not scattered individual cases.',
    }));
  }

  // 8. RM/TL SLA heat — worst 8 by SLA score, reusing computeRMScoreRows()
  // verbatim (same numbers as People → RM Performance & SLA Score).
  {
    const rmRows = computeRMScoreRows().filter(r => r.open > 0).slice(0, 8);
    const belowThreshold = rmRows.filter(r => r.slaScore != null && r.slaScore < 60).length;
    const rowsHtml = rmRows.length
      ? `<div class="tablewrap-plain" style="margin-top:10px; overflow-x:auto;"><table style="width:100%; border-collapse:collapse; font-size:12.5px;">
          <thead><tr style="color:var(--text-faint); text-align:left;">
            <th style="padding:4px 8px;">RM</th><th style="padding:4px 8px;">TL</th>
            <th style="padding:4px 8px; text-align:right;">Open</th><th style="padding:4px 8px; text-align:right;">SLA Score</th>
          </tr></thead>
          <tbody>${rmRows.map(r => {
            const sla = r.slaScore;
            const color = sla == null ? 'var(--text-faint)' : sla >= 80 ? 'var(--green)' : sla >= 50 ? 'var(--amber)' : 'var(--red)';
            return `<tr style="border-top:1px solid var(--border);">
              <td style="padding:4px 8px;">${esc(r.RM)}</td><td style="padding:4px 8px; color:var(--text-dim);">${esc(r.TL)}</td>
              <td style="padding:4px 8px; text-align:right;">${r.open}</td>
              <td style="padding:4px 8px; text-align:right; color:${color}; font-weight:600;">${sla == null ? 'n/a' : sla + '%'}</td>
            </tr>`;
          }).join('')}</tbody>
        </table></div>`
      : `<div style="font-size:12px; color:var(--text-faint); margin-top:6px;">No RM has any open leads in the current filters.</div>`;
    cards.push(briefCard({
      rank: 8, numHtml: belowThreshold.toLocaleString(), label: 'RMs below 60% SLA (worst 8 shown)',
      status: belowThreshold > 0 ? 'bad' : 'ok', statusLabel: belowThreshold > 0 ? 'needs coaching' : 'all clear',
      detailHtml: rowsHtml,
      why: 'Who needs coaching today, not this week — full table at People → RM Performance & SLA Score.',
      action: 'Any RM below 60%: a 1:1 today, using the SLA Score cell\'s own hover breakdown to see which specific check is driving it down.',
    }));
  }

  // 9. Data-quality notices — reads the CURRENT state of the two warning
  // elements fetchAndRender already populates (column-mapping mismatch,
  // dedupe/cross-region collation), plus a live recount of leads whose
  // stage text maps to no funnel band — same three checks already
  // surfaced elsewhere in the app, rolled up here rather than reimplemented.
  {
    const notices = [];
    const columnMapEl = document.getElementById('columnMapWarning');
    if (columnMapEl && columnMapEl.style.display !== 'none' && columnMapEl.textContent.trim()) {
      notices.push('Column mapping — one or more expected headers didn\'t match (see the warning banner at the top of the page)');
    }
    const dedupeEl = document.getElementById('dedupeNotice');
    if (dedupeEl && dedupeEl.style.display !== 'none' && dedupeEl.textContent.trim()) {
      const crossRegion = dedupeEl.textContent.includes('span multiple regions');
      notices.push(crossRegion
        ? 'Duplicate customer copies merged, including some spanning multiple regions (Overview → dedupe notice)'
        : 'Duplicate customer copies merged this refresh (Overview → dedupe notice)');
    }
    const unmapped = leads.filter(l => !isClosedStage(l.current_stage) && !canonicalStage(l.current_stage)).length;
    if (unmapped > 0) {
      notices.push(`${unmapped.toLocaleString()} open lead${unmapped === 1 ? '' : 's'} sit in a stage the Funnel chart can't read (unmapped stage text)`);
    }
    cards.push(briefCard({
      rank: 9, numHtml: notices.length.toLocaleString(), label: 'Data-quality notices active',
      status: notices.length > 0 ? 'warn' : 'ok', statusLabel: notices.length > 0 ? 'review before trusting the rest' : 'clean',
      detailHtml: notices.length ? `<ul style="margin:8px 0 0; padding-left:18px; font-size:12px; color:var(--text-dim);">${notices.map(n => `<li>${esc(n)}</li>`).join('')}</ul>` : '',
      why: 'Every number above is only as good as this — a silent column mismatch or an unmerged duplicate quietly skews everything upstream of it.',
      action: notices.length ? 'Resolve or at least understand each notice before treating the cards above as reliable.' : 'No day-over-day comparison available (no persisted history of prior warnings) — this reflects the current refresh only.',
    }));
  }

  // 10. Median vs p90 gap — same two numbers as card 4, presented as a
  // ratio: a wide gap means a few very bad outliers, not a systemic
  // problem, and calls for a different fix than a blanket policy change.
  {
    const gapRatio = (medianContact != null && medianContact > 0 && p90Contact != null) ? (p90Contact / medianContact) : null;
    cards.push(briefCard({
      rank: 10, numHtml: gapRatio == null ? '—' : `${gapRatio.toFixed(1)}×`,
      numColor: gapRatio != null && gapRatio > 3 ? 'var(--amber)' : null,
      label: 'Median vs p90 gap, first-action time',
      status: gapRatio == null ? null : (gapRatio > 3 ? 'warn' : 'ok'),
      statusLabel: gapRatio == null ? '' : (gapRatio > 3 ? '> 3× median' : 'within 3×'),
      detailHtml: gapRatio == null ? '' : `<div style="font-size:11.5px; color:var(--text-faint); margin-top:4px;">Median ${medianContact.toFixed(0)}m · p90 ${p90Contact.toFixed(0)}m</div>`,
      why: 'A wide gap means a handful of very bad outliers, not a systemic problem — a different diagnosis than the median alone gives.',
      action: 'Above 3×, find and fix the specific outlier leads (check Not Connected in 10 Minutes) rather than changing policy for everyone.',
    }));
  }

  el.innerHTML = cards.join('');
}
