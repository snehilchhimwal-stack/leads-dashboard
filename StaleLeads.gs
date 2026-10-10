/**
 * StaleLeads.gs - stale leads in the emails (Email Operations System, decision D8, 2026-10-10).
 *
 * A STALE LEAD is a lead with no update at all for MORE than 24 hours - no stage change, no comment added, no call-count increase, nothing - NO MATTER WHEN it was created or
 * assigned (the user's definition). Every automatic email (the 17:00 bucket and CH-level emails, the 10:00 combined email and CH-level report, the 13:00 reply) lists its stale
 * leads in a SEPARATE block at the very bottom, after the ordinary tables. They are still in the email - every lead the email counts stays in its body, so the send-safety gate
 * and the ledger are unaffected - and nothing about who receives it changes.
 *
 * It only READS: the live Leads tab row and the Movement_Log history (which the snapshot job already keeps). It never writes, blocks or re-sends; any problem means "not stale".
 * Wiring: MovementTracker.gs reads the history (buildMovementLogMapsGs_ -> lastChangeMap); AllIssuesEmailer.gs and OvernightEmailer.gs put `staleSince` on each lead and call
 * splitStaleSectionsGs_ when they build a report.
 */

// ==================== Stale leads (decision D8, 2026-10-10) ====================
// A STALE LEAD is one with no update at all for MORE than 24 hours - no stage change, no comment added, no call-count increase, nothing - NO MATTER WHEN it was created or
// assigned (user definition, 2026-10-10). The emails show stale leads in a separate block at the bottom (EmailInfra.gs splitStaleSectionsGs_).
//
// How it is judged from what the system already keeps: the snapshot job writes a Movement_Log row for a lead ONLY when its tracked content (stage, comments, call counts,
// connect time, RM, ...) differs from its latest row, so the latest row's time is the last observed change. A lead is stale when its LIVE content still hashes the same as
// that row (nothing changed since the snapshot) AND that row is more than 24 h old. A live row that already differs from its latest snapshot changed within the last
// snapshot gap, so it is not stale; a lead with no history (new, or pruned) is not stale - there is no evidence either way. The snapshot runs four times a day, so the
// observed time is never earlier than the real change: a lead is only ever called stale when it has really been quiet for more than 24 h.
const LEAD_STALE_HOURS_ = 24;

// The Date a STALE lead was last observed to change, or null (not stale / unknown) - the one-liner the emailers put on each lead. Fail-open: a problem means "not stale".
function staleSinceOfRowGs_(row, colIndex, lastChangeMap, now) {
  try {
    const st = leadStaleStateGs_(row, colIndex, lastChangeMap, now);
    return st.stale ? st.lastChangeAt : null;
  } catch (e) { return null; }
}

// Pure. row = a live leads-tab row; lastChangeMap from buildMovementLogMapsGs_. Returns { stale, lastChangeAt (Date, or null when unknown/changed just now), reason }.
function leadStaleStateGs_(row, colIndex, lastChangeMap, now) {
  const leadId = String(getVal_(row, colIndex, 'lead_id') || '').trim();
  const entry = lastChangeMap && lastChangeMap[_dedupKeyGs_(leadId, getVal_(row, colIndex, 'RM'))];
  if (!entry) return { stale: false, lastChangeAt: null, reason: 'no Movement_Log history for this lead' };
  const liveHash = _leadContentHashGs_(function (fieldKey) { return getVal_(row, colIndex, fieldKey); });
  if (liveHash !== entry.hash) return { stale: false, lastChangeAt: null, reason: 'it changed after the last snapshot' };
  const ageHours = (now.getTime() - entry.atMs) / 3600000;
  return { stale: ageHours > LEAD_STALE_HOURS_, lastChangeAt: new Date(entry.atMs), reason: 'unchanged for ' + (Math.round(ageHours * 10) / 10) + ' h' };
}

// ---- Stale leads in the emails (decision D8, 2026-10-10) ----
// A STALE LEAD (MovementTracker.gs leadStaleStateGs_) is one with no update at all for more than 24 hours, whenever it was created or assigned. Every email lists such leads in a
// SEPARATE block at the very bottom ("held at the bottom"), after the ordinary tables - they are still in the email (every lead the email counts stays in its body, so the
// send-safety gate is unaffected), just apart from the leads that need first-contact attention. Nothing about who receives the email changes.

// { leadId: Date } for the stale leads among items that carry `lead_id` and `staleSince` (a Date for a stale lead, null otherwise). Pure.
function staleSinceMapGs_(items) {
  const map = {};
  (items || []).forEach(function (l) { if (l && l.staleSince instanceof Date) map[String(l.lead_id)] = l.staleSince; });
  return map;
}

// { leadId: Date } for the stale ones among `leadIds`, judged against the live leads-tab rows in leadsData = { colIndex, dataRows, lastChangeMap }. Fail-open: {} (nothing is
// called stale) if the rows or the Movement_Log history are missing or anything throws - a warning block must never stop an email.
function staleSinceForLeadIdsGs_(leadIds, leadsData, now) {
  const map = {};
  try {
    if (!leadsData || !leadsData.dataRows || !leadsData.colIndex || !leadsData.lastChangeMap) return map;
    const wanted = {};
    (leadIds || []).forEach(function (id) { wanted[String(id)] = true; });
    leadsData.dataRows.forEach(function (row) {
      const id = String(getVal_(row, leadsData.colIndex, 'lead_id') || '').trim();
      if (!id || !wanted[id] || map[id]) return;
      const st = leadStaleStateGs_(row, leadsData.colIndex, leadsData.lastChangeMap, now);
      if (st.stale) map[id] = st.lastChangeAt;
    });
  } catch (e) {
    Logger.log('Stale-lead check failed - the email is sent without a stale block: ' + e);
    return {};
  }
  return map;
}

// Moves the stale leads of a report into a separate block at the bottom. sections = the report's sections; every table whose first column is 'Lead ID' is split: its stale rows
// leave it (a table left with no rows disappears, handing its region band to the next table of the same region) and reappear, oldest first, in a copy of that table with an extra
// "No update since" column, under one band headed "Stale leads - no update for more than N hours". Nothing stale -> the SAME array comes back untouched. Pure.
function splitStaleSectionsGs_(sections, staleSince) {
  if (!sections || !staleSince || !Object.keys(staleSince).length) return sections;
  const fresh = [], stale = [];
  let pendingBand = '';
  sections.forEach(function (sec) {
    if (!sec || !sec.columns || !sec.rows || sec.columns[0] !== 'Lead ID') { fresh.push(sec); return; }
    const keep = [], moved = [];
    sec.rows.forEach(function (r) { (staleSince[String(r[0])] ? moved : keep).push(r); });
    if (!moved.length) {
      fresh.push(pendingBand && !sec.regionBand ? Object.assign({}, sec, { regionBand: pendingBand }) : sec);
      pendingBand = '';
      return;
    }
    if (!keep.length) {
      if (sec.regionBand) pendingBand = sec.regionBand;
    } else {
      fresh.push(Object.assign({}, sec, { rows: keep }, pendingBand && !sec.regionBand ? { regionBand: pendingBand } : {}));
      pendingBand = '';
    }
    moved.sort(function (a, b) { return staleSince[String(a[0])].getTime() - staleSince[String(b[0])].getTime(); });
    stale.push(Object.assign({}, sec, {
      regionBand: undefined,
      subheading: (sec.regionBand ? sec.regionBand + (sec.subheading ? ' · ' : '') : '') + (sec.subheading || ''),
      accent: { fg: '#dc2626', headerBg: '#fee2e2', bg: '#fef2f2' },
      columns: sec.columns.concat(['No update since']),
      rows: moved.map(function (r) { return r.concat([Utilities.formatDate(staleSince[String(r[0])], 'Asia/Kolkata', 'd MMM HH:mm') + ' IST']); }),
    }));
  });
  if (!stale.length) return sections;
  stale[0].regionBand = 'Stale leads - no update for more than ' + LEAD_STALE_HOURS_ + ' hours';
  return fresh.concat(stale);
}
