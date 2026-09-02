// ============================================================
// core-collation.js — the multi-RM-copy collation/dedup display layer:
// collationBadge, siblingNote, leadIdentityLine, the family-grouping
// helpers (familyKeyOf/groupSiblingsTogether/dedupeToFamilies), and the
// unique-vs-cloned counting/label helpers used throughout the dashboard
// wherever a collated customer needs to read as "N leads (M cloned)".
// Split out of core.js (Phase 2 — see HANDOVER.md). Pure code motion —
// no logic changed.
// ============================================================

// Marks records built from several RM copies of the same customer, so a
// merged call count or stage is never mistaken for one RM's own figures.
// Every RM holding a copy, and every merged lead_id, are always named
// inline: on any issue card the question "who else has this customer" is
// the actionable one, and a name hidden in a tooltip can't be read off a
// shared screen or a screenshot. Previously closed leads collapsed to just
// the count, which meant the RM list disappeared exactly where a
// post-mortem needs it.
function collationBadge(l){
  if (!l.collatedFrom || l.collatedFrom < 2) return '';
  const leadIds = (l.collatedLeadIds || []).join(', ');
  const rms = (l.collatedRMs || []).join(', ');
  const regions = l.collatedRegions || [];

  // Dim, not amber/red — these are identity/provenance chips (who this
  // record is), not urgency signals. Amber and red stay reserved for the
  // actual compliance chips (attempts remaining, staleness) elsewhere on
  // the card, so the eye has one clear place to land on what needs action.
  let out = ` <span class="chip dim-chip" title="Merged from ${l.collatedFrom} copies of this customer">merged ×${l.collatedFrom}</span>`;
  if (leadIds) out += ` <span class="chip dim-chip" title="Every lead_id merged into this record">IDs: ${esc(leadIds)}</span>`;
  if (rms) out += ` <span class="chip dim-chip" title="Every RM who held a copy of this customer">RMs: ${esc(rms)}</span>`;
  if (regions.length > 1) out += ` <span class="chip red" title="These merged copies did not all resolve to the same region — this card can only show one, so the others are absorbed here">Regions: ${esc(regions.join(', '))}</span>`;
  return out;
}

// Lightweight cross-reference for an issue-detection entity (copySplits —
// one RM's own copy of a multi-copy customer, judged on its own issues).
// Deliberately NOT the full IDs/RMs chip treatment collationBadge gives a
// genuine merge: this row's issue is its own, not shared with the sibling
// copies, so it just names them for context rather than presenting them
// as part of the same instance.
function siblingNote(l){
  if (!l.siblingRMs || !l.siblingRMs.length) return '';
  return ` <span class="chip dim-chip" title="This customer also has other RM copies (${esc((l.siblingLeadIds||[]).join(', '))}), shown separately since each is judged on its own issues">also held by: ${esc(l.siblingRMs.join(', '))}</span>`;
}

// The line shown at the top of every issue card. For a genuinely collated
// lead (non-issue views — Total Leads, Distribution, RM Scorecard), the
// badges already list every merged lead_id and every RM in full — putting
// the primary copy's own id/RM in front of that just repeats what the
// badges already say. Everywhere else (a plain single-copy lead, or one
// RM's own split of a multi-copy customer) shows its own id/RM directly,
// plus a sibling note when this is a split with other copies elsewhere.
function leadIdentityLine(l){
  const badge = collationBadge(l);
  if (badge) return badge.trim();
  return `${esc(l.lead_id)} · ${esc(l.RM)}${siblingNote(l)}`;
}

// Groups a copySplit-expanded list back into families using the SAME
// signal every copy's own siblingLeadIds already carries (every copy of
// one customer lists every OTHER copy, so [own id, ...siblings] sorted is
// an identical key across all of them) — a plain, unsplit entity (no
// siblings) is its own family of one, so this works on lists that mix
// split and non-split entities, not just fully-split ones.
function familyKeyOf(l){
  return [String(l.lead_id).trim(), ...((l.siblingLeadIds || []).map(String))].sort().join('|');
}

// Sorts a list so every copy of the same customer (see familyKeyOf) ends
// up adjacent, instead of scattered across the list by whatever the
// section's own sort criterion happens to do — 3 RM copies all flagged
// in the same section should read as one connected story, not 3
// unrelated cards. Each family is sorted internally by compareFn (so
// within a family the ordering still means the same thing it always
// did), and families are ordered relative to EACH OTHER by their own
// most-urgent member (first after that internal sort) — a family
// containing the single oldest/most-overdue lead still surfaces near
// the top, so grouping never buries genuine urgency behind an
// unrelated family that happens to sort earlier.
function groupSiblingsTogether(items, compareFn){
  const families = new Map();
  (items || []).forEach(item => {
    const key = familyKeyOf(item);
    if (!families.has(key)) families.set(key, []);
    families.get(key).push(item);
  });
  const groups = Array.from(families.values()).map(members => members.slice().sort(compareFn));
  groups.sort((a, b) => compareFn(a[0], b[0]));
  return groups.reduce((flat, g) => flat.concat(g), []);
}

// One representative entry per family (first one encountered) — for any
// place that needs a "how many distinct customers, and what does each
// look like" answer without a cloned copy skewing the count or a status
// breakdown. The full per-copy list stays exactly as-is wherever a
// per-copy card/row still needs its own entry (issue sections, region
// email detail rows) — this is only for count/breakdown purposes.
function dedupeToFamilies(items){
  const seen = new Map();
  (items || []).forEach(l => {
    const key = familyKeyOf(l);
    if (!seen.has(key)) seen.set(key, l);
  });
  return Array.from(seen.values());
}

// A "leads assigned" / "leads flagged" style COUNT should say how many real
// customers that is, not how many rows — a customer collated from 3 RM
// copies still shows up as 3 separate entities in issue-detection lists
// (copySplits — each RM's own copy is judged on its own data, deliberately
// not merged for that purpose), so counting the array length directly
// overstates volume: "12 leads assigned" reads as 12 distinct people even
// when only 7 are.
function countUniqueAndCloned(items){
  const total = (items || []).length;
  const unique = dedupeToFamilies(items).length;
  return { total, unique, cloned: total - unique };
}

// Renders a countUniqueAndCloned() result as the short phrase used on
// section/panel count badges and KPI-style stats — "7 leads" when nothing
// was cloned, "7 leads (5 cloned)" when some entries are just another RM's
// copy of a customer already counted.
function uniqueCloneLabel(counts, noun){
  const n = noun || 'lead';
  const base = `${counts.unique} ${n}${counts.unique === 1 ? '' : 's'}`;
  return counts.cloned > 0 ? `${base} (${counts.cloned} cloned)` : base;
}

// Same idea as countUniqueAndCloned/uniqueCloneLabel above, but for
// customer-deduped arrays like `leads` (or any subset/filter of it) rather
// than per-copy arrays like issueLeads. Each `leads` record already
// represents ONE customer — a copy collated from 2+ RM rows doesn't show up
// as extra ARRAY ENTRIES here (unlike issueLeads), it shows up as that
// one entry's own collatedFrom > 1 — so countUniqueAndCloned's
// familyKeyOf-based matching (which compares DIFFERENT array entries
// against each other) would never find anything to dedupe: every `leads`
// record already has its own unique lead_id by construction. This instead
// just counts how many of the N records already ARE such a merge.
function countCollatedAmong(arr){
  const total = (arr || []).length;
  const collated = (arr || []).reduce((n, l) => n + ((l.collatedFrom || 1) > 1 ? 1 : 0), 0);
  return { total, collated };
}

// Bare-number form for table cells/KPI numbers: "112" or "112 (4 cloned)".
function collatedCountText(arr){
  const { total, collated } = countCollatedAmong(arr);
  return collated > 0 ? `${total.toLocaleString()} (${collated} cloned)` : total.toLocaleString();
}

// Noun-suffixed form for badges/summaries, matching uniqueCloneLabel's
// phrasing: "112 leads" or "112 leads (4 cloned)".
function collatedCountLabel(arr, noun){
  const n = noun || 'lead';
  const { total, collated } = countCollatedAmong(arr);
  const base = `${total.toLocaleString()} ${n}${total === 1 ? '' : 's'}`;
  return collated > 0 ? `${base} (${collated} cloned)` : base;
}

// Same idea, but for table accumulator loops that already track a running
// count (e.g. `b.total++`) rather than building an array — a parallel
// `b.collated++` alongside the existing counter feeds this directly at
// render time, without needing to also collect every matching lead into
// an array just to hand it to collatedCountText.
function numWithClone(n, collated){
  return collated > 0 ? `${n.toLocaleString()} (${collated} cloned)` : n.toLocaleString();
}

// ---- comment parsing + keyword/outcome engine + follow-up engine (was mid-file) ----

