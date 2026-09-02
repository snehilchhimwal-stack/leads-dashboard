// ============================================================
// core-fetch-and-render.js — showError/hideError/setPulse, and
// fetchAndRender itself: the single largest function in the app (the
// whole fetch -> parse -> collate pipeline that builds leads/issueLeads/
// allParsedLeads from a raw Sheets read). Split out of core.js as one
// unbroken unit (Phase 2 — see HANDOVER.md) rather than decomposed
// further — its internal collation logic ("COLLATE, DON'T DEDUPLICATE",
// see the comment inside) is entangled enough with its own local
// closures that pulling pieces out would mean rewriting it, which this
// refactor's own rule (pure code motion, no logic changed) forbids.
// ============================================================

function showError(html){
  const box = document.getElementById('errorBox');
  box.innerHTML = html;
  box.style.display = 'block';
  document.getElementById('dashboardContent').style.display = 'none';
}
function hideError(){
  document.getElementById('errorBox').style.display = 'none';
}

function setPulse(live){
  document.getElementById('pulseDot').className = 'pulse' + (live ? ' live' : '');
}

async function fetchAndRender(){
  hideError();
  const rawId = document.getElementById('sheetIdInput').value;
  const tabName = document.getElementById('tabNameInput').value.trim();

  if (!rawId.trim() || !tabName){
    showError('<b>Missing info.</b> Paste your Google Sheet URL/ID and the leads tab name above, then click Connect &amp; Refresh.');
    return;
  }

  // A real refresh — the next renderAll() pass this triggers should update
  // Morning Brief; every filter-only renderAll() pass after that shouldn't,
  // until either another refresh happens or a report gets generated.
  _refreshMorningBriefOnNextRender = true;

  // Covers the whole fetch/parse/render pass, not just the Refresh button —
  // a filter checkbox is a DIFFERENT element, so disabling only the button
  // (below) doesn't stop a click there from queuing up while this is still
  // reading/collating thousands of rows, which then fires the moment this
  // frees the main thread and stacks a second heavy pass on top.
  showLoadingOverlay('Loading your sheet…', true);

  // A manual Refresh click can land after the gate token has expired
  // (~1h) — that click is itself a real user gesture, so it's safe to use
  // to silently re-request a token before reading, rather than bouncing
  // the person back to the gate screen.
  if (!gateTokenValid()) {
    await gateSignIn();
    if (!gateTokenValid()) return; // sign-in failed/cancelled — status is already shown on the gate
  }

  const sheetId = extractSheetId(rawId);

  const btn = document.getElementById('refreshBtn');
  btn.disabled = true;
  btn.textContent = 'Refreshing…';
  setPulse(false);

  try {
    let values;
    try {
      // Was A2:Z (26 columns) — the sheet now has 28 (region..duration,
      // with call_count/duration landing in columns AA/AB), so that range
      // silently dropped the last two columns entirely rather than just
      // misreading them: they never appeared in the fetched values at all,
      // which is why they showed as "unmatched" instead of merely blank.
      // Widened with real headroom past the current column count, same
      // reasoning as Movement_Log's own A1:Z range for future additions.
      values = await sheetsApiValuesGet(sheetId, `${tabName}!A2:AZ`);
    } catch (err) {
      if (err.status === 403) throw new Error('ACCESS_DENIED');
      if (err.status === 404) throw new Error('NOT_FOUND');
      if (err.status === 400) throw new Error('BAD_RANGE');
      throw err;
    }

    const isDateColLabel = (label) =>
      HEADER_ALIASES.lead_assigned_at.indexOf(label) !== -1 || HEADER_ALIASES.last_connect_time.indexOf(label) !== -1;
    const table = valuesToGvizShape(values, isDateColLabel);
    const cols = table.cols;
    const dataRowsRaw = table.rows.map(r => r.c || []);

    if (!cols.length || !dataRowsRaw.length) {
      throw new Error('EMPTY');
    }

    const colIndex = {};
    Object.keys(HEADER_ALIASES).forEach(key => {
      const aliases = HEADER_ALIASES[key];
      let idx = -1;
      cols.forEach((col, i) => {
        if (idx !== -1) return;
        const label = String(col.label || '').trim().toLowerCase();
        if (aliases.indexOf(label) !== -1) idx = i;
      });
      colIndex[key] = idx;
    });

    if (colIndex.lead_id === -1) {
      // The lead_id header cell is sometimes blank even though the data
      // beneath it is real lead IDs — it's reliably the first column, so
      // fall back to that position instead of requiring the label text.
      colIndex.lead_id = 0;
    }

    if (colIndex.group_source === -1) {
      const err = new Error('HEADERS');
      err.headerPreview = cols.map(c => c.label || '');
      err.rowCount = dataRowsRaw.length;
      throw err;
    }

    // Every other column silently resolves to -1 if its header text didn't
    // match — no error is thrown, so a mismatch here quietly zeroes out
    // whatever downstream feature depends on it with no visible symptom.
    // Surface this explicitly instead of letting it fail silently.
    const columnMapEl = document.getElementById('columnMapWarning');
    if (columnMapEl) {
      const unmatched = Object.keys(colIndex).filter(k => colIndex[k] === -1);
      if (unmatched.length) {
        const headerPreview = cols.map((c, i) => `${i}:"${c.label || ''}"`).join('  ');
        columnMapEl.style.display = 'block';
        columnMapEl.innerHTML = `<b>Heads up:</b> these columns didn't match any expected header and will read as blank/zero everywhere: <b>${unmatched.map(esc).join(', ')}</b>. This silently breaks anything that depends on them (dates, stages, comments) without throwing a visible error.<br><span class="mono" style="font-size:11px; word-break:break-all;">Row read as: ${esc(headerPreview)}</span>`;
      } else {
        columnMapEl.style.display = 'none';
      }
    }

    _accessedHeaderKeys = new Set();
    const getVal = (cellsArr, key) => {
      _accessedHeaderKeys.add(key);
      const idx = colIndex[key];
      if (idx === -1 || idx == null) return '';
      return gvizCellRaw(cellsArr[idx]);
    };
    const getDate = (cellsArr, key) => {
      _accessedHeaderKeys.add(key);
      const idx = colIndex[key];
      if (idx === -1 || idx == null) return null;
      return gvizCellDate(cellsArr[idx]);
    };

    const parsedLeads = dataRowsRaw
      .filter(c => String(gvizCellRaw(c[colIndex.lead_id])).trim() !== '')
      .map(c => {
        const createdDate = getDate(c, 'lead_assigned_at');
        const connectDate = getDate(c, 'last_connect_time');
        return {
          lead_id: getVal(c, 'lead_id'),
          RM: getVal(c, 'RM') || 'Unassigned',
          TL: getVal(c, 'TL') || '',
          // NOT `|| ''` — rm_is_active is often a real Sheets checkbox
          // column, which gviz reports as a native JS boolean. `false || ''`
          // would silently collapse a genuinely inactive RM's `false` into
          // an empty string, which is exactly the value rmIsInactive below
          // (built from this field) treats as "unknown/active". getVal
          // already returns '' on its own for a truly missing/blank cell
          // (see gvizCellRaw), so no fallback is needed here.
          rm_is_active: getVal(c, 'rm_is_active'),
          project: getVal(c, 'project') || '',
          region: getVal(c, 'region') || 'Unassigned',
          project_region: getVal(c, 'project_region') || '',
          client: getVal(c, 'client') || '',
          lead_assigned_at: createdDate ? createdDate.toISOString() : getVal(c, 'lead_assigned_at'),
          group_source: getVal(c, 'group_source'),
          source_bucket: getVal(c, 'source_bucket') || '',
          current_stage: getVal(c, 'current_stage'),
          last_connect: getVal(c, 'last_connect') || '',
          last_connect_time: connectDate ? connectDate.toISOString() : getVal(c, 'last_connect_time'),
          last_comment: getVal(c, 'last_comment') || '',
          internal_status_comments: getVal(c, 'internal_status_comments') || '',
          stage_comments: getVal(c, 'stage_comments') || '',
          client_id: getVal(c, 'client_id') || '',
          // SOP effort is measured in ATTEMPTS. Fall back to call_count only
          // when the column is genuinely ABSENT (checked via colIndex, not
          // via the value) — `||` on the parsed number couldn't tell a real
          // 0 call_attempts apart from a missing column, so a lead that was
          // legitimately never dialed had its 0 silently overwritten by
          // whatever call_count happened to hold.
          call_attempts: colIndex.call_attempts !== -1 ? (Number(getVal(c, 'call_attempts')) || 0) : (Number(getVal(c, 'call_count')) || 0),
          call_count: Number(getVal(c, 'call_count')) || 0,
          duration: Number(getVal(c, 'duration')) || 0,
          closing_reason: getVal(c, 'closing_reason') || '',
          lead_closing_reason: getVal(c, 'lead_closing_reason') || '',
          lead_closing_comment: getVal(c, 'lead_closing_comment') || '',
        };
      });

    // Resilience check: any HEADER_ALIASES key no getVal/getDate call site
    // ever touched is dead — the exact condition that caused a false
    // "unmatched header" warning for region_parent/stage_comments before
    // they were removed (see the comment on HEADER_ALIASES). Skipped when
    // there's no data to have exercised the call sites against.
    if (parsedLeads.length) {
      const deadAliasKeys = Object.keys(HEADER_ALIASES).filter(k => !_accessedHeaderKeys.has(k));
      if (deadAliasKeys.length) {
        console.warn(
          `HEADER_ALIASES has ${deadAliasKeys.length} entr${deadAliasKeys.length === 1 ? 'y' : 'ies'} ` +
          `nothing reads: ${deadAliasKeys.join(', ')}. Each produces a false "unmatched header" warning ` +
          `if its column is ever renamed — either add a real getVal()/getDate() call for it, or remove it.`
        );
      }
    }

    // ---------------------------------------------------------------
    // FOUNDATION STEP: COLLATE, DON'T DEDUPLICATE.
    //
    // When a lead arrives it is pushed to SEVERAL RMs at once; whoever
    // claims it keeps it. So one real customer can appear as several rows,
    // sharing a client_id but not necessarily a lead_id. Dropping the
    // "duplicates" threw away real work — the unclaimed copies still hold
    // call attempts and comments made before someone claimed it.
    //
    // Instead each customer becomes ONE record:
    //   comments   -> merged from every copy, de-duplicated, chronological
    //   attempts   -> summed across copies (total effort on that customer)
    //   duration   -> summed likewise
    //   stage      -> HIGHEST point reached in the funnel by any copy.
    //                 This matters because unclaimed copies are typically
    //                 marked cancelled/junk, so taking the "latest" row
    //                 would report a live lead as closed.
    //   identity   -> the copy that reached that highest stage, tie-broken
    //                 by most recent activity — i.e. whoever actually owns it
    // ---------------------------------------------------------------
    const activityTimeOf = (l) => {
      const d = parseDate(l.last_connect_time) || parseDate(l.lead_assigned_at);
      return d ? d.getTime() : null;
    };
    // Funnel rank: open stages rank above any closed stage, so a claimed
    // copy always outranks the copies that were closed off unclaimed.
    // "Closed" here matches enrichLead's own definition exactly — stage
    // text OR a filled closing_reason — not just canonicalStage. Checking
    // stage text alone let a copy that's genuinely closed (closing_reason
    // filled) but left sitting on stale open-looking stage text (e.g. the
    // CRM never touched current_stage before closing it) outrank a
    // DIFFERENT RM's copy that's actually still open, so the whole
    // customer read as closed even though someone else still had it live.
    // A collated lead should only read as closed when every copy really is.
    // Closed and "open but unrecognised stage text" must NOT share a rank:
    // they used to both return -1, so an open copy with stage text outside
    // CONFIG.STAGE_ALIASES could tie with a genuinely closed copy and lose
    // the tiebreak (activityTimeOf) to it — a more-recently-touched CLOSED
    // copy could then win primary, making the whole merged customer read as
    // closed even though the open copy was real and unworked.
    const funnelRankOf = (l) => {
      if (isLeadClosed(l)) return -2;
      const canon = canonicalStage(l.current_stage);
      if (canon) return CONFIG.FUNNEL_ORDER.indexOf(canon);
      return -1; // unrecognised stage text
    };

    // Identity match: two rows collate together if they share the SAME
    // lead_id OR the SAME client_id AND their regions are the same real
    // place (regionsAreSimilar — handles known sub-region variants like
    // "Pune"/"Pune West" via REGION_GROUP_MAP, plus an unmapped-variant
    // fallback). Two RM copies sharing an ID but tagged to genuinely
    // different regions (e.g. Thane vs Hyderabad) are a real, separate
    // conflict, not one customer — merging them used to pick a single
    // region for the whole customer from whichever copy happened to reach
    // the furthest funnel stage, which had nothing to do with which region
    // was actually correct, and could show either region depending on
    // funnel progress alone. Checked independently, not client_id with
    // lead_id only as a fallback for when it's blank — dirty/inconsistent
    // tagging across RM copies means the "same customer" signal can come
    // from either column, and matches can chain (row A shares a client_id
    // with row B, row B shares a lead_id with row C) — so a simple
    // single-field groupBy would miss that A and C are the same customer
    // too. Union-Find merges every row transitively connected by either
    // key AND a region match into one group, however many hops apart —
    // and because every individual union only ever happens between two
    // rows whose regions were directly checked as similar, no chain of
    // hops can smuggle two genuinely dissimilar regions into one group.
    const _ufParent = parsedLeads.map((_, i) => i);
    function _ufFind(x){
      while (_ufParent[x] !== x) { _ufParent[x] = _ufParent[_ufParent[x]]; x = _ufParent[x]; }
      return x;
    }
    function _ufUnion(a, b){
      const ra = _ufFind(a), rb = _ufFind(b);
      if (ra !== rb) _ufParent[ra] = rb;
    }
    // key -> [{index, region}, ...] — one entry per distinct-region cluster
    // seen so far under that key, not just the first row. A new row unions
    // into whichever existing cluster has a similar region; if none match,
    // it starts its own new cluster under the same key (so a LATER row
    // sharing that ID AND that row's specific region can still join it).
    const _clustersByKey = new Map();
    parsedLeads.forEach((l, i) => {
      const leadKey = 'lead:' + String(l.lead_id).trim();
      const cid = String(l.client_id || '').trim();
      const clientKey = cid ? 'client:' + cid : null;
      const iRegion = effectiveRegion(l);
      [leadKey, clientKey].forEach(key => {
        if (!key) return;
        const clusters = _clustersByKey.get(key);
        if (!clusters) { _clustersByKey.set(key, [{ index: i, region: iRegion }]); return; }
        const match = clusters.find(c => regionsAreSimilar(c.region, iRegion));
        if (match) _ufUnion(i, match.index);
        else clusters.push({ index: i, region: iRegion });
      });
    });

    const groupMap = new Map();
    parsedLeads.forEach((l, i) => {
      const key = _ufFind(i);
      if (!groupMap.has(key)) groupMap.set(key, []);
      groupMap.get(key).push(l);
    });

    let collatedGroups = 0, extraCopies = 0, crossRegionGroups = 0;
    _lastCrossRegionCollations = [];

    // Region each row would resolve to on its own — same effectiveRegion +
    // mainRegionFor path everything else uses, so this reflects exactly
    // what the Region filter/report grouping would show for that row.
    const rowRegionLabel = (r) => mainRegionFor(effectiveRegion(r)) || String(r.region || '').trim() || '(blank)';

    // Dedupes a group's row-region labels using the SAME regionsAreSimilar
    // check the union-find identity match above now uses, not plain string
    // equality — keeps this consistent with why the group merged in the
    // first place. In practice, after that fix, a group reaching here with
    // 2+ rows should already have directly-checked-similar regions, so this
    // should read as one label almost always; kept as a safety net (and
    // still informative if it ever isn't) rather than removed.
    const dedupeSimilarRegions = (labels) => {
      const out = [];
      labels.forEach(label => {
        if (!out.some(existing => regionsAreSimilar(existing, label))) out.push(label);
      });
      return out;
    };

    // Merges a set of same-customer rows into ONE lead-shaped record: stage
    // taken from whichever copy went furthest (ties broken by most recent
    // activity), comments merged/deduped/re-sorted, attempts/calls/duration
    // summed, earliest assignment kept. Factored out so it can run both across
    // ALL of a customer's rows (the general-purpose `merged` record below)
    // and on a single row by itself (copySplits below — a "merge" of one
    // row is just that row, stamped with the same collatedFrom/IDs/RMs
    // shape every other record carries).
    function mergeRowsIntoOneLead(rows){
      if (rows.length === 1) {
        return Object.assign({}, rows[0], {
          collatedFrom: 1,
          collatedRMs: [rows[0].RM || 'Unassigned'],
          collatedLeadIds: [String(rows[0].lead_id).trim()],
          collatedRegions: [rowRegionLabel(rows[0])],
        });
      }

      const primary = rows.slice().sort((a, b) => {
        const fr = funnelRankOf(b) - funnelRankOf(a);
        if (fr !== 0) return fr;
        return (activityTimeOf(b) || 0) - (activityTimeOf(a) || 0);
      })[0];

      // Dedupe/sort a "Name: Comment - YYYY-MM-DD HH:MM | ..." field across
      // every copy — same treatment for internal_status_comments and
      // stage_comments below, since a customer's comment history should
      // read as one merged timeline regardless of which RM copy (or which
      // of the two comment columns) it was logged under.
      const tsOf = (entry) => {
        const m = entry.match(/(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2})\s*$/);
        const d = m ? parseDate(m[1]) : null;
        return d ? d.getTime() : 0;
      };
      const mergeCommentField = (fieldName) => {
        const seen = new Set();
        const out = [];
        rows.forEach(r => {
          String(r[fieldName] || '').split('|').forEach(part => {
            const t = part.trim();
            if (!t || seen.has(t)) return;
            seen.add(t);
            out.push(t);
          });
        });
        out.sort((a, b) => tsOf(a) - tsOf(b));
        return out.join(' | ');
      };
      const mergedComments = mergeCommentField('internal_status_comments');
      const mergedStageComments = mergeCommentField('stage_comments');

      const latestConnect = rows
        .map(r => parseDate(r.last_connect_time))
        .filter(Boolean)
        .sort((a, b) => b - a)[0] || null;

      // call_attempts/call_count/duration are tracked per CLIENT ID by the
      // phone system, not accumulated per RM copy — every copy of the same
      // customer reports the SAME cumulative client-level figure, not a
      // partial contribution. Summing across copies multiplied it by the
      // copy count instead (3 copies each reporting 36 attempts read as
      // 108). Max takes it "as a whole" for the customer, matching
      // whichever copy's snapshot happens to be most complete, without
      // the multiplication.
      // collatedFrom counts DISTINCT lead_ids, not raw rows.length — two
      // rows unioned together (by shared client_id or lead_id) aren't
      // necessarily two different RM copies. A literal duplicate row (the
      // same lead_id appearing twice — a blank lead_id colliding with
      // another blank one is the common case) unions in exactly the same
      // way a genuine second copy would, but it's one customer's one copy
      // read twice, not "multiple RM copies". Every "cloned"/"collated"
      // count and badge in the app reads collatedFrom expecting it to mean
      // distinct copies (see e.g. collationBadge, countCollatedAmong), so
      // it has to actually measure that, not just row multiplicity.
      const distinctLeadIds = Array.from(new Set(rows.map(r => String(r.lead_id).trim())));
      return Object.assign({}, primary, {
        internal_status_comments: mergedComments,
        stage_comments: mergedStageComments,
        call_attempts: Math.max(0, ...rows.map(r => Number(r.call_attempts) || 0)),
        call_count:    Math.max(0, ...rows.map(r => Number(r.call_count) || 0)),
        duration:      Math.max(0, ...rows.map(r => Number(r.duration) || 0)),
        last_connect_time: latestConnect ? latestConnect.toISOString() : primary.last_connect_time,
        // Earliest assignment across copies — the moment this customer was
        // actually first assigned, not when a particular RM's copy was generated.
        lead_assigned_at: rows
          .map(r => parseDate(r.lead_assigned_at))
          .filter(Boolean)
          .sort((a, b) => a - b)[0]?.toISOString() || primary.lead_assigned_at,
        collatedFrom: distinctLeadIds.length,
        collatedRMs: Array.from(new Set(rows.map(r => r.RM).filter(Boolean))),
        collatedLeadIds: distinctLeadIds,
        collatedRegions: dedupeSimilarRegions(rows.map(rowRegionLabel)),
      });
    }

    const dedupedLeads = Array.from(groupMap.values()).map(rows => {
      const merged = mergeRowsIntoOneLead(rows);
      if (rows.length === 1) return merged;

      // Tallied here, before the distinct-copy gate below, so "X customers
      // from Y rows read, absorbing Z extra rows" stays arithmetically
      // true regardless of WHY a group had more than one row — a literal
      // duplicate row is still one fewer row than customers, same as a
      // genuine second RM copy is.
      extraCopies += rows.length - 1;

      // A group can have more raw rows than distinct lead_ids (see
      // collatedFrom's own comment in mergeRowsIntoOneLead) — that's still
      // correctly absorbed above, but it isn't "multiple RM copies", so it
      // shouldn't inflate the headline count, the cross-region check, or
      // copySplits (which would otherwise hand issue-detection two
      // identical-lead_id entries for what's really one copy read twice).
      if (merged.collatedLeadIds.length <= 1) return merged;

      collatedGroups++;

      // Merged customers whose copies don't all resolve to the SAME region —
      // this is what makes a Pune-tagged row surface on a card that reads
      // "Thane": the merge picks ONE copy as primary (furthest funnel /
      // most recent) and that copy's region wins, silently absorbing a
      // same-client_id (or same-lead_id) copy from a different region.
      // Sometimes that's correct (one customer, two genuine inquiries in
      // different regions) and sometimes it's a data problem (a shared/
      // placeholder client_id, or a reused lead_id, gluing two unrelated
      // customers together) — either way it's surfaced explicitly via
      // collatedRegions/crossRegionCollations.
      if (merged.collatedRegions.length > 1) {
        crossRegionGroups++;
        _lastCrossRegionCollations.push({
          leadIds: Array.from(new Set(rows.map(r => String(r.lead_id).trim()))),
          clientIds: Array.from(new Set(rows.map(r => String(r.client_id || '').trim()).filter(Boolean))),
          regions: merged.collatedRegions,
          rms: Array.from(new Set(rows.map(r => r.RM).filter(Boolean))),
        });
      }

      // copySplits: one independent, single-copy record per ORIGINAL row —
      // used ONLY for issue detection/reporting (the 5 SLA checks, their
      // sections/emails, Stalled Leads, Overnight Leads). X being
      // closed shouldn't hide Y's Not Updated issue; Z's own call count
      // shouldn't get credited from Y's calls; two RMs both stalled on
      // "Not Updated" are two separate instances, not one. `merged` above
      // (summed calls, comments merged, stage from whichever copy went
      // furthest) is untouched and stays the source of truth for the Total
      // Leads count, Distribution tab, RM Scorecard, and every other
      // non-issue view — those still want "one customer, one card". Each
      // split carries the OTHER copies' lead_id/RM as a lightweight
      // sibling reference (siblingLeadIds/siblingRMs) purely for context;
      // its own issue flags come only from its own data.
      // One row per distinct lead_id first — a genuinely-cloned group can
      // still contain a literal duplicate of one of its copies (the same
      // lead_id logged twice alongside a real second RM's copy), and that
      // duplicate is the same copy read twice, not a third copy. Without
      // this, it would get its own split (double-counting that RM's
      // issues) and would list itself as its own sibling.
      const distinctRows = [];
      const seenSplitIds = new Set();
      rows.forEach(r => {
        const id = String(r.lead_id).trim();
        if (seenSplitIds.has(id)) return;
        seenSplitIds.add(id);
        distinctRows.push(r);
      });
      merged.copySplits = distinctRows.map(row => {
        const split = mergeRowsIntoOneLead([row]);
        const siblings = distinctRows.filter(r => r !== row);
        split.siblingLeadIds = siblings.map(r => String(r.lead_id).trim());
        split.siblingRMs = Array.from(new Set(siblings.map(r => r.RM).filter(Boolean)));
        // Every sibling's own four comment columns, carried alongside the
        // lightweight id/RM references above — suggestedFollowUp reads
        // this to assess a customer's next step from the FULL picture
        // across every RM who's touched them, not just this one copy's
        // own (possibly empty) comment fields.
        split.siblingComments = siblings.map(r => ({
          lead_id: r.lead_id, RM: r.RM,
          internal_status_comments: r.internal_status_comments,
          stage_comments: r.stage_comments,
          last_comment: r.last_comment,
          closing_reason: r.closing_reason,
          lead_closing_reason: r.lead_closing_reason,
          lead_closing_comment: r.lead_closing_comment,
        }));
        return split;
      });

      return merged;
    });

    const dedupeEl = document.getElementById('dedupeNotice');
    if (dedupeEl) {
      if (collatedGroups > 0) {
        dedupeEl.style.display = 'block';
        // One-line summary always visible; the full explanation (what got
        // merged/summed, and the cross-region caveat) sits behind a click
        // instead of running as a paragraph above the fold on every load.
        const crossRegionBit = crossRegionGroups > 0
          ? ` · <b style="color:var(--red)">${crossRegionGroups.toLocaleString()}</b> span multiple regions`
          : '';
        const summary = `<b>${collatedGroups.toLocaleString()}</b> customer${collatedGroups === 1 ? '' : 's'} had multiple RM copies, merged${crossRegionBit}`;
        const detail = `Comments combined, calls and duration summed, stage taken from whichever copy went furthest. `
          + `${dedupedLeads.length.toLocaleString()} customers from ${parsedLeads.length.toLocaleString()} rows read, absorbing ${extraCopies.toLocaleString()} extra row${extraCopies === 1 ? '' : 's'}.`
          + (crossRegionGroups > 0
            ? ` ${crossRegionGroups.toLocaleString()} of those merges span more than one region (e.g. a Pune copy and a Thane copy sharing a lead_id or client_id) — the merged card can only display one, so the others get absorbed. Flagged with a red "Regions:" chip on affected cards; full detail in the console as <span class="mono">_lastCrossRegionCollations</span>.`
            : '');
        dedupeEl.innerHTML = `<div class="notice-pill">${summary} `
          + `<button type="button" class="info-toggle" style="display:inline; padding:0; margin:0;" data-label="ⓘ Details" onclick="toggleInlineDetail(this)">ⓘ Details</button></div>`
          + `<div class="filter-summary" style="display:none; margin:6px 0 14px;">${detail}</div>`;
        // The UI text above promises "full detail in the console" — print
        // it here rather than leaving that as a hint someone has to know
        // to act on (typing the bare variable name into devtools) after
        // reading past a collapsed detail panel.
        if (crossRegionGroups > 0) console.table(_lastCrossRegionCollations);
      } else {
        dedupeEl.style.display = 'none';
      }
    }

    const sourceCounts = {};
    dedupedLeads.forEach(l => {
      const key = String(l.group_source).trim() || '(blank)';
      if (!sourceCounts[key]) sourceCounts[key] = { n: 0, collated: 0 };
      sourceCounts[key].n++;
      if ((l.collatedFrom || 1) > 1) sourceCounts[key].collated++;
    });
    renderSourceBreakdown(sourceCounts, dedupedLeads);

    _actionLogCache.clear(); // fresh data — drop cached parses of old comment blobs
    allParsedLeads = dedupedLeads;

    buildFilterUI();
    applyFiltersAndRender();
    _currentSheetId = sheetId; // must be set before snapshotSlaHistory — it writes to SLA_History via this
    snapshotSlaHistory();
    // Best-effort, non-blocking: Movement_Log is a separate tab a helper
    // script writes to, and might not exist yet (setup not done) or the
    // caller might have no data in it yet. Either way the main dashboard
    // must not wait on or fail because of this second fetch.
    fetchMovementLog(sheetId).then(() => {
      trackingPopulateSnapshotSelectors();
      // Behind on Today's Calls' attemptsToday depends on Movement_Log for
      // a real day-over-day call_attempts delta (see buildTodayCallBaseline)
      // — on first load this fetch resolves AFTER the initial
      // applyFiltersAndRender() already ran with no snapshot data at all,
      // so Operations needs a fresh pass now that a baseline actually
      // exists. This also re-renders the Movement tab itself, so no
      // separate renderMovementTab() call is needed here.
      applyFiltersAndRender();
      // The sign-in gate already holds a live Sheets write token by the
      // time any data has loaded, so this can fire straight away.
      if (autoSnapshotEnabled()) browserSnapshotOpenLeads();
      // Best-effort, same reasoning as snapshotSlaHistory above — persists
      // Daily Cohort by Region into Daily_Cohort_History so it survives
      // Movement_Log's 7-day retention (see persistDailyCohortHistory's
      // own comment in tab-tracking.js).
      persistDailyCohortHistory().catch(() => {});
    });
    // Same best-effort, non-blocking treatment as fetchMovementLog above
    // — Repeat Offenders' two source tabs (Daily_RM_Issues, RM_Hierarchy)
    // are each written/maintained by separate Apps Script logic that
    // might not be set up yet, and the main dashboard must never wait on
    // or fail because of either fetch. Independent of fetchMovementLog's
    // own fetch/render pass (different tabs, no shared dependency), and
    // renderRepeatOffenders() alone is enough here — it doesn't need the
    // rest of the dashboard re-rendered, just its own section.
    Promise.all([fetchDailyRmIssues(sheetId), fetchRmHierarchyForRollup(sheetId)]).then(() => {
      renderRepeatOffenders();
    });

    document.getElementById('configPanel').style.display = 'none';
    document.getElementById('changeSourceBtn').style.display = 'inline-block';
    document.getElementById('dashboardContent').style.display = 'block';
    document.getElementById('filterBar').style.display = 'flex';
    const now = new Date();
    document.getElementById('lastRefreshed').textContent =
      'Last refreshed: ' + istStamp(now);
    setPulse(true);

  } catch (err) {
    setPulse(false);
    if (err.message === 'ACCESS_DENIED') {
      showError(`<b>Access denied.</b> ${esc(gateUserEmail || 'Your signed-in Google account')} isn't shared on this sheet. Ask the sheet owner to add you under <b>Share</b> (Viewer is enough to read; Editor if you'll also take Movement snapshots), then click Refresh.`);
    } else if (err.message === 'NOT_FOUND') {
      showError(`<b>Can't find this sheet.</b> Double-check the Sheet ID/URL is correct.`);
    } else if (err.message === 'BAD_RANGE') {
      showError(`<b>Couldn't read that tab.</b> Check the tab name ("${esc(tabName)}") is spelled exactly as it appears at the bottom of your sheet (case-sensitive).`);
    } else if (err.message === 'EMPTY') {
      showError(`<b>No data found.</b> Check the tab name ("${esc(tabName)}") is spelled exactly as it appears at the bottom of your sheet (case-sensitive), and that row 2 has your headers.`);
    } else if (err.message === 'HEADERS') {
      const preview = err.headerPreview ? err.headerPreview.map((h,i) => `${i}:"${h}"`).join('  ') : '(none)';
      showError(`<b>Couldn't match expected columns.</b> Here's exactly what row 2 was read as (index:value): <div class="mono" style="margin-top:8px; word-break:break-all; color:var(--text-dim);">${esc(preview)}</div><div style="margin-top:8px;">Total sheet rows seen: ${err.rowCount}. Send this back and I can pinpoint the fix.</div>`);
    } else {
      showError(`<b>Couldn't reach the sheet.</b> ${esc(err.message)}. Double check the Sheet ID/URL and the tab name, then try again.`);
    }
  } finally {
    btn.disabled = false;
    btn.textContent = 'Refresh';
    hideLoadingOverlay(true);
  }
}

