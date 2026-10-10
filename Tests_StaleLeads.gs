/**
 * Tests: stale leads (decision D8, 2026-10-10) - a lead with no update at all for more than 24 hours, whenever it was created or assigned, is shown in a separate block at the
 * bottom of every email. Covers leadStaleStateGs_ / _collapseLatestChangeGs_ / staleSinceOfRowGs_ (MovementTracker.gs) and splitStaleSectionsGs_ / staleSinceMapGs_ /
 * staleSinceForLeadIdsGs_ (EmailInfra.gs), then the real 17:00, 10:00 and 13:00 jobs and both CH-level reports against a fake workbook with a real-shaped Movement_Log.
 * Run runStaleLeadsTestsNow() from the function dropdown, or via runAllTests() (Tests_RunAll.gs). Everything is in-memory; nothing is sent for real.
 */

// ---- helpers ----

// A leads-tab row and its column index, built the way the real tab is read.
function TestSL_row_(overrides) {
  const header = TestFixture_leadsHeader_();
  const banner = header.map(function () { return ''; });
  const row = TestEL_leadRow_(header, Object.assign({ lead_id: 'L-1', client_id: 'C-1', RM: 'Test RM One', current_stage: 'Not Updated', lead_assigned_at: new Date('2026-10-05T08:00:00+05:30'), call_attempts: 2 }, overrides || {}));
  const ss = TestMockSpreadsheet_({ 'leads': TestMockSheet_('leads', [banner, header, row]) });
  const read = readLeadsTab_(ss);
  return { row: read.dataRows[0], colIndex: read.colIndex };
}

// The change-map entry for a live row: its real content hash and the given time.
function TestSL_entry_(r, atMs) {
  return { atMs: atMs, hash: _leadContentHashGs_(function (key) { return getVal_(r.row, r.colIndex, key); }) };
}

// A Movement_Log sheet (real header order) with one row per lead id in hoursAgoById, each carrying the live row's own content hash - i.e. "nothing changed since then".
function TestSL_movementLog_(ss, hoursAgoById, now) {
  const header = ['snapshot_at', 'snapshot_label'].concat(SNAPSHOT_COLUMNS_).concat([CONTENT_HASH_COLUMN_]);
  const sheet = TestMockSheet_('Movement_Log', [header]);
  const read = readLeadsTab_(ss);
  read.dataRows.forEach(function (row) {
    const id = String(getVal_(row, read.colIndex, 'lead_id') || '').trim();
    if (hoursAgoById[id] === undefined) return;
    const fields = SNAPSHOT_COLUMNS_.map(function (k) { return getVal_(row, read.colIndex, k); });
    const hash = _leadContentHashGs_(function (key) { return getVal_(row, read.colIndex, key); });
    sheet.appendRow([TestFixture_hoursAgo_(now, hoursAgoById[id]), '0600'].concat(fields).concat([hash]));
  });
  ss._sheets['Movement_Log'] = sheet;
}

// Two overnight-window leads (Pune, Thane), flagged by a rule that does not depend on the clock; optional extra rows.
function TestSL_world_(extra) {
  const header = TestFixture_leadsHeader_();
  const banner = header.map(function () { return ''; });
  const eve = new Date(istDayKeyGs_(new Date(Date.now() - 24 * 3600 * 1000)) + 'T18:00:00+05:30');
  const ss = TestMockSpreadsheet_({
    'RM_Hierarchy': TestMockSheet_('RM_Hierarchy', TestFixture_rmHierarchyRows_()),
    'Manager_Directory': TestMockSheet_('Manager_Directory', TestFixture_managerDirectoryRows_()),
  });
  const row = function (o) { return TestEL_leadRow_(header, Object.assign({ RM: 'Test RM One', current_stage: 'Not Updated', lead_assigned_at: eve }, o)); };
  ss._sheets['leads'] = TestMockSheet_('leads', [banner, header, row({ lead_id: 'L-PUNE', client_id: 'C-PUNE', region: 'Pune' }), row({ lead_id: 'L-THANE', client_id: 'C-THANE', region: 'Thane' })]
    .concat((extra || []).map(row)));
  return ss;
}

function TestSL_headings_(sections) { return sections.map(function (s) { return s.heading; }); }
function TestSL_ids_(sections) { return [].concat.apply([], sections.filter(function (s) { return s.columns && s.columns[0] === 'Lead ID'; }).map(function (s) { return s.rows.map(function (r) { return r[0]; }); })); }

function runStaleLeadsTests_() {
  TestEnv_setUp_('Tests_StaleLeads', TestMockSpreadsheet_({}));
  const realRender = renderOvernightReportEmailHTML_;
  try {
    const now = new Date('2026-10-10T12:00:00+05:30');
    const hrs = function (h) { return now.getTime() - h * 3600000; };

    // ================= the change map =================
    {
      const rows = [
        { key: 'A', dedupKey: 'A|Pooja', atMs: 100, hash: 'h1' }, { key: 'A', dedupKey: 'A|Pooja', atMs: 300, hash: 'h2' }, { key: 'A', dedupKey: 'A|Pooja', atMs: 200, hash: 'h3' },
        { key: 'A', dedupKey: 'A|Ravi', atMs: 50, hash: 'r1' }, { key: 'B', dedupKey: 'B|Pooja', atMs: 999, hash: '' },
      ];
      const m = _collapseLatestChangeGs_(rows);
      TestAssertEqual_(m['A|Pooja'].atMs + ':' + m['A|Pooja'].hash, '300:h2', 'change map: the LATEST row of a lead is kept');
      TestAssertEqual_(m['A|Ravi'].hash, 'r1', 'change map: the same lead under another RM is a separate entry (the dedup identity is lead id + RM)');
      TestAssertEqual_(String(m['B|Pooja']), 'undefined', 'change map: a row with no hash (captured before hashing existed) says nothing');
      TestAssertEqual_(Object.keys(_collapseLatestChangeGs_([])).length, 0, 'change map: no rows -> an empty map');
    }
    {
      const ss = TestMockSpreadsheet_({});
      const header = ['snapshot_at', 'snapshot_label'].concat(SNAPSHOT_COLUMNS_).concat([CONTENT_HASH_COLUMN_]);
      const rowOf = function (at, id, rm, hash, calls) {
        const o = { lead_id: id, RM: rm, call_attempts: calls };
        return [at, '0600'].concat(SNAPSHOT_COLUMNS_.map(function (k) { return o[k] === undefined ? '' : o[k]; })).concat([hash]);
      };
      ss._sheets['Movement_Log'] = TestMockSheet_('Movement_Log', [header, rowOf(new Date(hrs(30)), 'L-1', 'Pooja', 'old', 2), rowOf(new Date(hrs(10)), 'L-1', 'Pooja', 'new', 3), rowOf(new Date(hrs(40)), 'L-2', '', 'z', 1)]);
      const maps = buildMovementLogMapsGs_(ss, now);
      TestAssertEqual_(maps.lastChangeMap['L-1|Pooja'].hash + ',' + maps.lastChangeMap['L-1|Pooja'].atMs + ',' + (maps.lastChangeMap['L-2|Unassigned'] ? maps.lastChangeMap['L-2|Unassigned'].hash : 'missing'), 'new,' + hrs(10) + ',z', 'maps: read from a real-shaped Movement_Log - the latest hash per lead + RM, a blank RM as "Unassigned"');
      TestAssertEqual_(maps.baselineMap['L-1'] !== undefined && maps.lastSnapshotMap['L-1'].call_attempts === 3, true, 'maps: the two older maps are unchanged');
    }

    // ================= is one lead stale? =================
    {
      const r = TestSL_row_({});
      const stateAt = function (ageH, rowOverride) {
        const rr = rowOverride || r;
        const entry = TestSL_entry_(r, hrs(ageH));
        return leadStaleStateGs_(rr.row, rr.colIndex, { 'L-1|Test RM One': entry }, now);
      };
      const s30 = stateAt(30);
      TestAssertEqual_(s30.stale + ',' + (s30.lastChangeAt && s30.lastChangeAt.getTime() === hrs(30)) + ',' + s30.reason, 'true,true,unchanged for 30 h', 'stale: unchanged since a snapshot 30 h ago -> stale, with the time it last changed');
      TestAssertEqual_([stateAt(23.9).stale, stateAt(24).stale, stateAt(24.01).stale].join(','), 'false,false,true', 'stale: "more than 24 hours" - 23.9 h and exactly 24 h are not stale, 24.01 h is');
      const fresh = stateAt(2);
      TestAssertEqual_(fresh.stale + ',' + fresh.reason, 'false,unchanged for 2 h', 'stale: unchanged for only 2 h -> not stale');
      // the lead's creation / assignment time is never consulted
      const old = TestSL_row_({ lead_assigned_at: new Date('2026-09-01T10:00:00+05:30') }), recent = TestSL_row_({ lead_assigned_at: new Date(hrs(1)) });
      const staleOf = function (rr) { return leadStaleStateGs_(rr.row, rr.colIndex, { 'L-1|Test RM One': TestSL_entry_(rr, hrs(30)) }, now).stale; };
      TestAssertEqual_(staleOf(old) + ',' + staleOf(recent), 'true,true', 'stale: no matter when the lead was created or assigned - only its last update counts');
      // any tracked change since the snapshot makes it not stale
      const changes = { 'a new stage': { current_stage: 'Suspect' }, 'a new comment': { internal_status_comments: 'Test RM One: Ringing - 2026-10-10 11:00' }, 'a stage comment': { stage_comments: 'called' },
        'a call-count increase': { call_attempts: 3 }, 'a new connect': { last_connect_time: new Date(hrs(1)), last_connect: 'Connected' }, 'a new last comment': { last_comment: 'x' }, 'a reassignment': { RM: 'Test RM Two' } };
      Object.keys(changes).forEach(function (what) {
        const changed = TestSL_row_(changes[what]);
        // the history entry belongs to the same lead + RM the live row now has, so the only difference is the content
        const entry = { atMs: hrs(30), hash: TestSL_entry_(r, hrs(30)).hash };
        const key = 'L-1|' + (changes[what].RM || 'Test RM One');
        const st = leadStaleStateGs_(changed.row, changed.colIndex, (function () { const m = {}; m[key] = entry; return m; })(), now);
        TestAssertEqual_(st.stale + ',' + String(st.lastChangeAt) + ',' + st.reason, 'false,null,it changed after the last snapshot', 'stale: ' + what + ' since the last snapshot means the lead was updated -> not stale');
      });
      // no evidence -> never stale
      TestAssertEqual_(leadStaleStateGs_(r.row, r.colIndex, {}, now).stale + ',' + leadStaleStateGs_(r.row, r.colIndex, {}, now).reason, 'false,no Movement_Log history for this lead', 'stale: a lead with no history is not called stale (no evidence either way)');
      TestAssertEqual_(leadStaleStateGs_(r.row, r.colIndex, null, now).stale + ',' + leadStaleStateGs_(r.row, r.colIndex, undefined, now).stale, 'false,false', 'stale: no change map at all -> not stale');
      TestAssertEqual_(leadStaleStateGs_(r.row, r.colIndex, { 'L-1|Someone Else': TestSL_entry_(r, hrs(30)) }, now).stale, false, 'stale: the history of the same lead under ANOTHER RM does not count');
      const blankRm = TestSL_row_({ RM: '' });
      TestAssertEqual_(leadStaleStateGs_(blankRm.row, blankRm.colIndex, { 'L-1|Unassigned': TestSL_entry_(blankRm, hrs(30)) }, now).stale, true, 'stale: a lead with no RM is keyed as "Unassigned", like the snapshot does');
      // the one-liner the emailers use
      TestAssertEqual_(staleSinceOfRowGs_(r.row, r.colIndex, { 'L-1|Test RM One': TestSL_entry_(r, hrs(30)) }, now).getTime(), hrs(30), 'staleSinceOfRow: the Date a stale lead last changed');
      TestAssertEqual_(String(staleSinceOfRowGs_(r.row, r.colIndex, { 'L-1|Test RM One': TestSL_entry_(r, hrs(2)) }, now)), 'null', 'staleSinceOfRow: null for a lead that is not stale');
      TestAssertEqual_(String(staleSinceOfRowGs_(null, null, {}, now)), 'null', 'staleSinceOfRow: fail-open - bad input is "not stale", never an exception');
      TestAssertEqual_(LEAD_STALE_HOURS_, 24, 'the stale line is 24 hours');
    }

    // ================= the lookups the emailers use =================
    {
      const d1 = new Date(hrs(30));
      const m = staleSinceMapGs_([{ lead_id: 'A', staleSince: d1 }, { lead_id: 'B', staleSince: null }, { lead_id: 'C' }, null, { lead_id: 7, staleSince: d1 }]);
      TestAssertEqual_(Object.keys(m).sort().join(','), '7,A', 'staleSinceMap: only leads that carry a stale Date, keyed by lead id');
      TestAssertEqual_(Object.keys(staleSinceMapGs_(null)).length, 0, 'staleSinceMap: nothing -> empty');
      const r1 = TestSL_row_({ lead_id: 'L-1' }), r2 = TestSL_row_({ lead_id: 'L-2', client_id: 'C-2' });
      const rows = [r1.row, r2.row];
      const leadsData = { colIndex: r1.colIndex, dataRows: rows, lastChangeMap: { 'L-1|Test RM One': TestSL_entry_(r1, hrs(30)), 'L-2|Test RM One': TestSL_entry_(r2, hrs(3)) } };
      const got = staleSinceForLeadIdsGs_(['L-1', 'L-2', 'L-9'], leadsData, now);
      TestAssertEqual_(Object.keys(got).join(',') + ',' + got['L-1'].getTime(), 'L-1,' + hrs(30), 'staleSinceForLeadIds: the stale one among the wanted ids, with its time');
      TestAssertEqual_(Object.keys(staleSinceForLeadIdsGs_(['L-2'], leadsData, now)).length, 0, 'staleSinceForLeadIds: a lead that is not stale gives nothing');
      TestAssertEqual_(Object.keys(staleSinceForLeadIdsGs_(['L-1'], { colIndex: r1.colIndex, dataRows: rows }, now)).length + ',' + Object.keys(staleSinceForLeadIdsGs_(['L-1'], null, now)).length, '0,0', 'staleSinceForLeadIds: no change map or no data -> nothing is called stale');
      TestAssertEqual_(Object.keys(staleSinceForLeadIdsGs_(['L-1'], { colIndex: r1.colIndex, dataRows: 'not rows', lastChangeMap: {} }, now)).length, 0, 'staleSinceForLeadIds: fail-open on bad data');
    }

    // ================= splitting a report =================
    {
      const sec = function (heading, ids, extra) {
        return Object.assign({ heading: heading, subheading: 'Manager: M', columns: ['Lead ID', 'Issue'], rows: ids.map(function (id) { return [id, 'Not Updated']; }) }, extra || {});
      };
      const st = {};
      st['B'] = new Date(hrs(30)); st['C'] = new Date(hrs(50)); st['E'] = new Date(hrs(26));
      const original = [sec('Pooja', ['A', 'B']), sec('Ravi', ['C']), sec('Sita', ['D', 'E', 'F'])];
      const snapshot = JSON.stringify(original);
      const out = splitStaleSectionsGs_(original, st);
      TestAssertEqual_(JSON.stringify(original), snapshot, 'split: the input sections are never modified');
      TestAssertEqual_(out.map(function (s) { return s.heading + ':' + s.rows.length; }).join(','), 'Pooja:1,Sita:2,Pooja:1,Ravi:1,Sita:1', 'split: fresh tables first (Ravi\'s emptied table is gone), then the stale copies in the original order');
      TestAssertEqual_(TestSL_ids_(out.slice(0, 2)).join(',') + '|' + TestSL_ids_(out.slice(2)).join(','), 'A,D,F|B,C,E', 'split: the fresh ids and the stale ids are exactly separated');
      TestAssertEqual_(out[2].regionBand + '|' + String(out[3].regionBand) + '|' + String(out[4].regionBand), 'Stale leads - no update for more than 24 hours|undefined|undefined', 'split: ONE band heads the stale block');
      TestAssertEqual_(out[2].columns.join(',') + ',' + out[2].rows[0].join(' | '), 'Lead ID,Issue,No update since,B | Not Updated | ' + Utilities.formatDate(st['B'], 'Asia/Kolkata', 'd MMM HH:mm') + ' IST', 'split: the stale copy has a "No update since" column with the IST time');
      TestAssertEqual_(out[2].accent && out[2].accent.fg, '#dc2626', 'split: stale tables are red');
      TestAssertEqual_(out[0].regionBand === undefined && out[0].rows.length === 1, true, 'split: a fresh table keeps its own shape');
      // oldest first within a table
      const two = splitStaleSectionsGs_([sec('X', ['P', 'Q', 'R'])], { P: new Date(hrs(26)), Q: new Date(hrs(60)), R: new Date(hrs(40)) });
      TestAssertEqual_(two.length + ',' + two[0].rows.map(function (r) { return r[0]; }).join(','), '1,Q,R,P', 'split: the stale copy lists the quietest lead first');
    }
    {
      const sec = function (heading, ids, extra) {
        return Object.assign({ heading: heading, subheading: '', columns: ['Lead ID', 'Issue'], rows: ids.map(function (id) { return [id, 'x']; }) }, extra || {});
      };
      // a table whose leads are all stale disappears entirely
      const all = splitStaleSectionsGs_([sec('X', ['P', 'Q'])], { P: new Date(hrs(30)), Q: new Date(hrs(31)) });
      TestAssertEqual_(all.length + ',' + all[0].regionBand + ',' + all[0].rows.map(function (r) { return r[0]; }).join(','), '1,Stale leads - no update for more than 24 hours,Q,P', 'split: when every lead is stale only the stale block remains (oldest first)');
      // nothing stale -> the very same array; other tables untouched
      const plain = [sec('X', ['P'])];
      TestAssertEqual_(splitStaleSectionsGs_(plain, {}) === plain && splitStaleSectionsGs_(plain, { Z: new Date() }) === plain && splitStaleSectionsGs_(plain, null) === plain && splitStaleSectionsGs_(null, { P: new Date() }) === null, true, 'split: nothing stale (or nothing to split) returns the input untouched');
      const notice = { heading: 'Note', columns: ['Notice'], rows: [['P']] };
      const mixed = splitStaleSectionsGs_([sec('X', ['P', 'Q']), notice], { P: new Date(hrs(30)) });
      TestAssertEqual_(mixed.map(function (s) { return s.heading; }).join(',') + '|' + (mixed[1] === notice), 'X,Note,X|true', 'split: a table that is not a lead table is left exactly where it was');
      // Futwork-style region bands: the band follows the leads that stay
      const withBands = [sec('A1', ['a', 'b'], { regionBand: 'Pune' }), sec('A2', ['c'], {}), sec('B1', ['d'], { regionBand: 'Thane' })];
      const wb = splitStaleSectionsGs_(withBands, { a: new Date(hrs(30)), b: new Date(hrs(31)) });
      TestAssertEqual_(wb.map(function (s) { return s.heading + ':' + s.regionBand; }).join(','), 'A2:Pune,B1:Thane,A1:Stale leads - no update for more than 24 hours', 'split: when a region\'s first table empties, the region band moves on to its next table');
      TestAssertContains_(wb[2].subheading, 'Pune', 'split: a stale copy of a banded table keeps its region in the sub-heading');
      const wb2 = splitStaleSectionsGs_(withBands, { a: new Date(hrs(30)), b: new Date(hrs(31)), c: new Date(hrs(32)) });
      TestAssertEqual_(wb2.map(function (s) { return s.heading + ':' + s.regionBand; }).join(','), 'B1:Thane,A1:Stale leads - no update for more than 24 hours,A2:undefined', 'split: a region with no fresh lead left loses its band and its tables');
      // the band also moves on when the next table of the region is only PARTLY stale
      const wb3 = splitStaleSectionsGs_([sec('A1', ['a', 'b'], { regionBand: 'Pune' }), sec('A2', ['c', 'e'])], { a: new Date(hrs(30)), b: new Date(hrs(31)), e: new Date(hrs(32)) });
      TestAssertEqual_(wb3[0].heading + ':' + wb3[0].regionBand + ':' + wb3[0].rows.length, 'A2:Pune:1', 'split: the band of a region passes to its next table even when that table loses some rows too');
      // the plain-text twin carries the block too
      const text = plainTextFromReportOptsGs_({ title: 't', sections: splitStaleSectionsGs_([sec('X', ['P', 'Q'])], { P: new Date(hrs(30)) }) });
      TestAssertContains_(text, '== Stale leads - no update for more than 24 hours ==', 'split: the plain-text version has the band');
      TestAssertContains_(text, 'Lead ID | Issue | No update since', 'split: …and the extra column');
    }

    // ================= the real jobs =================
    const bodyOf = function (draft) { return draft.htmlBody + '\n' + draft.body; };
    const capture = function (fn) {
      const out = { single: [], two: [] };
      const realTwo = renderTwoSectionEmailHTML_;
      renderOvernightReportEmailHTML_ = function (opts) { out.single.push(opts); return realRender(opts); };
      renderTwoSectionEmailHTML_ = function (s1, s2) { out.two.push([s1, s2]); return realTwo(s1, s2); };
      try { fn(); } finally { renderOvernightReportEmailHTML_ = realRender; renderTwoSectionEmailHTML_ = realTwo; }
      out.standalone = out.single.filter(function (o) { return !out.two.some(function (p) { return p[0] === o || p[1] === o; }); });
      return out;
    };
    const BAND = 'Stale leads - no update for more than 24 hours';
    const staleTail = function (opts) {
      const secs = opts.sections.filter(function (s) { return s.columns && s.columns[0] === 'Lead ID'; });
      const i = secs.map(function (s) { return s.regionBand; }).indexOf(BAND);
      return i === -1 ? null : { fresh: secs.slice(0, i), stale: secs.slice(i) };
    };

    // ---- 17:00 (Pune and Thane are separate buckets, so two emails) ----
    const emailWith = function (got, id) { return got.single.filter(function (o) { return TestSL_ids_(o.sections).indexOf(id) !== -1; })[0]; };
    {
      const ss = TestSL_world_([{ lead_id: 'L-OLD', client_id: 'C-OLD' }, { lead_id: 'L-PFRESH', client_id: 'C-PFRESH' }]);
      TestSL_movementLog_(ss, { 'L-PUNE': 30, 'L-OLD': 50, 'L-THANE': 5 }, new Date()); // Pune and OLD unchanged for over a day; Thane for only 5 h; L-PFRESH has no history
      TestEL_bind_(ss);
      const got = capture(function () { sendAllIssuesEmails(); });
      TestAssertEqual_(TestGmailLog_.drafts.length, 2, '17:00: two bucket emails (Pune, Thane)');
      const pune = emailWith(got, 'L-PUNE');
      const tail = staleTail(pune);
      TestAssert_(!!tail, '17:00: the Pune email has a stale block');
      TestAssertEqual_(TestSL_ids_(tail.fresh).join(','), 'L-PFRESH', '17:00: the ordinary tables hold only the lead that is not stale');
      TestAssertEqual_(TestSL_ids_(tail.stale).join(','), 'L-OLD,L-PUNE', '17:00: the stale block holds the two quiet leads, the quietest first');
      TestAssertEqual_(pune.sections[pune.sections.length - 1].columns.slice(-1)[0], 'No update since', '17:00: the stale block is the LAST thing in the email');
      const d = TestGmailLog_.drafts.filter(function (x) { return x.htmlBody.indexOf('L-PUNE') !== -1; })[0];
      ['L-PUNE', 'L-OLD', 'L-PFRESH'].forEach(function (id) { TestAssertContains_(d.htmlBody, id, '17:00: ' + id + ' is still in the html (the send-safety gate is satisfied)'); TestAssertContains_(d.body, id, '17:00: ' + id + ' is still in the plain text'); });
      TestAssertContains_(d.body, '== ' + BAND + ' ==', '17:00: the plain text has the band');
      TestAssert_(d.htmlBody.indexOf(BAND) > d.htmlBody.indexOf('L-PFRESH'), '17:00: the stale block comes after the fresh table in the html');
      const led = TestEL_objects_(ss.getSheetByName(EMAIL_LEDGER_SHEET_), EMAIL_LEDGER_HEADERS_);
      TestAssertEqual_(led.length + ',' + led.map(function (r) { return r.status; }).join('/') + ',' + led.reduce(function (n, r) { return n + Number(r.leads_sent); }, 0), '2,ACCEPTED/ACCEPTED,4', '17:00: both emails ACCEPTED, all four leads counted as sent');
      TestAssertEqual_(pune.kpis[0].value, 3, '17:00: the flagged-leads count of the Pune email still includes the stale ones');
      TestAssertEqual_(staleTail(emailWith(got, 'L-THANE')) === null, true, '17:00: the Thane email (nothing stale) has no stale block');
    }
    {
      // updated since the snapshot -> not stale; a snapshot only 20 h old -> not stale; no history at all -> not stale
      const ss = TestSL_world_([{ lead_id: 'L-CHG', client_id: 'C-CHG' }, { lead_id: 'L-NEW', client_id: 'C-NEW' }]);
      TestSL_movementLog_(ss, { 'L-PUNE': 20, 'L-CHG': 30 }, new Date());
      const callsCol = TestFixture_leadsHeader_().indexOf('call_attempts') + 1;
      ss._sheets['leads'].getRange(5, callsCol, 1, 1).setValues([[7]]); // L-CHG (the third lead row, row 5): its call count went up after its snapshot
      TestEL_bind_(ss);
      const got = capture(function () { sendAllIssuesEmails(); });
      const pune = emailWith(got, 'L-PUNE');
      TestAssertEqual_(String(staleTail(pune)) + '|' + TestSL_ids_(pune.sections).sort().join(','), 'null|L-CHG,L-NEW,L-PUNE', '17:00: a recent snapshot, a call-count increase since the snapshot and a lead with no history are none of them stale - one ordinary list, no stale block');
    }
    {
      // every lead stale: both emails still go, each holding only the stale block
      const ss = TestSL_world_();
      TestSL_movementLog_(ss, { 'L-PUNE': 40, 'L-THANE': 41 }, new Date());
      TestEL_bind_(ss);
      const got = capture(function () { sendAllIssuesEmails(); });
      const tails = got.single.map(staleTail);
      TestAssertEqual_(TestGmailLog_.drafts.length + ',' + tails.every(function (x) { return x && x.fresh.length === 0; }) + ',' + tails.map(function (x) { return TestSL_ids_(x.stale).join('+'); }).sort().join(','), '2,true,L-PUNE,L-THANE', '17:00, every lead stale: both emails are still sent, each holding only the stale block');
    }
    {
      // no Movement_Log at all: exactly the email as before
      const ss = TestSL_world_();
      TestEL_bind_(ss);
      const got = capture(function () { sendAllIssuesEmails(); });
      TestAssertEqual_(got.single.every(function (o) { return staleTail(o) === null; }) && TestGmailLog_.drafts.length === 2, true, '17:00, no Movement_Log: no stale block anywhere, the emails are unchanged');
    }
    {
      // an unreadable Movement_Log must never stop the emails
      const ss = TestSL_world_();
      ss._sheets['Movement_Log'] = TestMockSheet_('Movement_Log', [['not', 'the', 'header']]);
      TestEL_bind_(ss);
      const got = capture(function () { sendAllIssuesEmails(); });
      TestAssertEqual_(got.single.every(function (o) { return staleTail(o) === null; }) && TestGmailLog_.drafts.length === 2, true, '17:00, a Movement_Log without the expected columns: no stale block, the emails still go');
    }
    {
      // the CH-level 17:00 report
      const ss = TestSL_world_([{ lead_id: 'L-CH', client_id: 'C-CH', RM: 'Test CH Self', region: 'Pune' }]);
      TestSL_movementLog_(ss, { 'L-CH': 33 }, new Date());
      TestEL_bind_(ss);
      const got = capture(function () { sendAllIssuesEmails(); });
      const ch = got.single.filter(function (o) { return /CH-level/.test(o.subtitle || ''); })[0];
      const tail = ch && staleTail(ch);
      TestAssertEqual_(tail ? TestSL_ids_(tail.stale).join(',') : 'no CH-level report / no block', 'L-CH', '17:00 CH-level report: the CH\'s own stale lead is in the stale block');
    }

    // ---- 10:00 and 13:00 ----
    {
      const ss = TestSL_world_([{ lead_id: 'L-CH', client_id: 'C-CH', RM: 'Test CH Self', region: 'Pune' }]);
      TestSL_movementLog_(ss, { 'L-PUNE': 30, 'L-CH': 31 }, new Date()); // Pune's lead and the CH's lead are stale; Thane's is not
      TestEL_bind_(ss);
      sendAllIssuesEmails(); // the 17:00 run gives the 10:00 job a Checkpoint 1 to follow up
      ss.getSheetByName('AllIssues_Log').getRange(2, 1, ss.getSheetByName('AllIssues_Log').getLastRow() - 1, 1).setValues(ss.getSheetByName('AllIssues_Log').getRange(2, 1, ss.getSheetByName('AllIssues_Log').getLastRow() - 1, 1).getValues().map(function () { return [TestFixture_daysAgo_(new Date(), 1)]; }));
      TestGmailLog_.drafts.length = 0;
      const got10 = capture(function () { sendOvernightMorningEmails(); });
      const punePair = got10.two.filter(function (p) { return TestSL_ids_(p[0].sections.concat(p[1].sections)).indexOf('L-PUNE') !== -1; })[0];
      TestAssert_(!!punePair, '10:00: the Pune bucket\'s combined email was built');
      TestAssertEqual_(staleTail(punePair[0]) ? TestSL_ids_(staleTail(punePair[0]).stale).join(',') : 'no block', 'L-PUNE', '10:00 Section 1: the stale overnight lead is in the stale block');
      TestAssertEqual_(staleTail(punePair[1]) ? TestSL_ids_(staleTail(punePair[1]).stale).join(',') : 'no block', 'L-PUNE', '10:00 Section 2 (Checkpoint 1): the stale lead is in the stale block there too');
      const thanePair = got10.two.filter(function (p) { return TestSL_ids_(p[0].sections.concat(p[1].sections)).indexOf('L-THANE') !== -1; })[0];
      TestAssertEqual_(staleTail(thanePair[0]) === null && staleTail(thanePair[1]) === null, true, '10:00: the Thane bucket (nothing stale) is exactly as before');
      const chOvernight = got10.standalone.filter(function (o) { return /CH-level/.test(o.subtitle || ''); })[0];
      TestAssertEqual_(chOvernight && staleTail(chOvernight) ? TestSL_ids_(staleTail(chOvernight).stale).join(',') : 'no CH-level block', 'L-CH', '10:00 CH-level overnight report: the CH\'s stale lead is in the stale block');
      TestAssertEqual_(TestGmailLog_.drafts.filter(function (d) { return d.htmlBody.indexOf('L-PUNE') !== -1; }).length, 1, '10:00: the Pune email was sent once');
      const got13 = capture(function () { sendOvernightFollowupEmails(); });
      const pune13 = got13.two.filter(function (p) { return TestSL_ids_(p[0].sections.concat(p[1].sections)).indexOf('L-PUNE') !== -1; })[0];
      TestAssert_(!!pune13, '13:00: the Pune reply was built');
      TestAssertEqual_(staleTail(pune13[0]) ? TestSL_ids_(staleTail(pune13[0]).stale).join(',') : 'no block', 'L-PUNE', '13:00 Section 1 (still unresolved): the stale lead is in the stale block');
      TestAssertEqual_(staleTail(pune13[1]) ? TestSL_ids_(staleTail(pune13[1]).stale).join(',') : 'no block', 'L-PUNE', '13:00 Section 2 (Checkpoint 2): the stale lead is in the stale block');
      TestAssertEqual_(TestGmailLog_.threadReplies.length >= 1, true, '13:00: the replies are sent');
      const led = TestEL_objects_(ss.getSheetByName(EMAIL_LEDGER_SHEET_), EMAIL_LEDGER_HEADERS_).filter(function (r) { return r.job === 'morning10' || r.job === 'followup13'; });
      TestAssertEqual_(led.every(function (r) { return r.status === 'ACCEPTED'; }), true, '10:00 / 13:00: every email is ACCEPTED - holding stale leads at the bottom never holds the email');
    }

    TestAssertOnlyTestEmails_();
  } finally {
    renderOvernightReportEmailHTML_ = realRender;
    TEST_MODE_OVERRIDE_EMAIL_ = '';
    TestEnv_tearDown_();
  }
  return TestResults_;
}

function runStaleLeadsTestsNow() { runStaleLeadsTests_(); }
