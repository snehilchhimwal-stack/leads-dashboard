/**
 * Tests: RmHierarchySync.gs — the nightly HR-roster sync of RM_Hierarchy / Manager_Directory. Run runRmHierarchySyncTestsNow() from
 * the function dropdown, or via runAllTests() (Tests_RunAll.gs). Everything is in-memory: the HR sheet, the two tabs, Drive, Gmail,
 * Script Properties and the triggers are fakes (see Tests_Mocks.gs), and the report recipients are looked up from a stub table
 * so the live private employee table can never put a real address into a captured send.
 */

// ---- fixtures ----

// The HR sheet as the script reads it: a 36-column header with the labels the sync checks at fixed positions, then one row per person.
// p: { name, role, team, chain: [names in the order of the positional chain columns], exit, email }. `fillers` extra out-of-scope people
// keep the sheet above the "looks like a broken read" size gate (RMSYNC_MIN_PEOPLE_).
function rmSyncTestHrValues_(people, fillers) {
  const header = [];
  for (let i = 0; i < 36; i++) header.push('');
  header[0] = 'New           E Code'; header[1] = 'Name'; header[2] = 'Role'; header[6] = 'A1 - 1/S2'; header[8] = 'A1 - 2';
  header[10] = 'RH'; header[12] = 'CH/CL'; header[15] = 'Team'; header[17] = 'Exit'; header[35] = 'Official Mail Id';
  const rows = [];
  const slots = [6, 8, 10, 12];
  const add = function (p) {
    const r = [];
    for (let i = 0; i < 36; i++) r.push('-');
    r[0] = 'H' + (1000 + rows.length); r[1] = p.name; r[2] = p.role; r[15] = p.team || '-'; r[17] = p.exit || '-'; r[35] = p.email || '-';
    (p.chain || []).forEach(function (c, i) { r[slots[i]] = c; });
    rows.push(r);
  };
  people.forEach(add);
  const extra = fillers === undefined ? 260 : fillers;
  for (let i = 0; i < extra; i++) add({ name: 'Filler Person ' + i, role: 'Executive', team: 'Ops' });
  return [header].concat(rows);
}

function rmSyncTestPeople_() {
  const A1 = 'Test A1 Pune', TM = 'Test TM Pune', RH = 'Test RH Pune', CH = 'Test CH Pune';
  return [
    { name: CH, role: 'Cluster Head', team: 'Pune', email: 'ch.pune@example.test' },
    { name: RH, role: 'RH', team: 'Pune', chain: [CH], email: 'rh.pune@example.test' },
    { name: TM, role: 'TM', team: 'Pune', chain: [RH, CH], email: 'tm.pune@example.test' },
    { name: A1, role: 'A1', team: 'Pune', chain: [TM, RH, CH], email: 'a1.pune@example.test' },
    { name: 'Test S1 Steady', role: 'S1', team: 'Pune', chain: [A1, TM, RH, CH] },
    { name: 'Test S1 Moved', role: 'S1', team: 'Pune', chain: [A1, TM, RH, CH] },
    { name: 'Test A1 Solo', role: 'A1', team: 'Pune', chain: [TM] },
    { name: 'Test S1 Override', role: 'S1', team: 'Pune', chain: [A1, TM, RH, CH] },
    { name: 'Test Exited', role: 'S1', team: 'Pune', chain: [A1], exit: '2026-10-01' },
    { name: 'Test Zed A1', role: 'A1', team: 'Pune', chain: [TM, RH, CH] },
    { name: 'Test Abe S1', role: 'S1', team: 'Pune', chain: ['Test Zed A1', TM, RH, CH] },
    { name: 'Test New S1', role: 'S1', team: 'Pune', chain: [A1, TM, RH, CH], email: 'new.s1@example.test' },
    { name: 'Test Low S1', role: 'S1', team: 'Pune', chain: ['Nobody Known'] },
    { name: 'Test No Chain', role: 'S1', team: 'Pune' },
    { name: 'Test Magnet S1', role: 'S1', team: 'Magnet Pune', chain: [A1] },
    { name: 'Test Finance Person', role: 'Accountant', team: 'Finance' },
    { name: 'Test Exited New', role: 'S1', team: 'Pune', chain: [A1], exit: '2026-10-02' },
    { name: 'Snehil Chhimwal', role: 'Business Analyst', team: 'MIS', email: TEST_EMAIL_PRIMARY_ },
    { name: 'Sushil Kannojiya', role: 'MIS', team: 'MIS', email: TEST_EMAIL_CH_ },
    { name: 'Ashish Ivlekar', role: 'Operation', team: 'Operations', email: TEST_EMAIL_SECONDARY_ },
  ];
}

function rmSyncTestTabRows_() {
  const A1 = 'Test A1 Pune', TM = 'Test TM Pune', RH = 'Test RH Pune', CH = 'Test CH Pune';
  return [
    ['team', 'role', 'name', 'tl', 'tm', 'rh', 'ch', 'excluded', 'note', 'email'],
    ['Pune', 'Cluster Head', CH, '', '', '', '', false, '', ''],
    ['Pune', 'RH', RH, '', '', '', CH, false, '', ''],
    ['Pune', 'TM', TM, '', '', RH, CH, false, '', ''],
    ['Pune', 'A1', A1, '', TM, RH, CH, false, '', ''],
    ['Pune', 'S1', 'Test S1 Steady', A1, TM, RH, CH, false, '', ''],
    ['Pune', 'S1', 'Test S1 Moved', 'Test A1 Old', TM, RH, CH, false, '', ''],
    ['Pune', 'A1', 'Test A1 Solo', '', 'Test TM Old', '', '', false, '', ''],
    ['Pune', 'S1', 'Test S1 Override', A1, TM, RH, 'Test CH Override', false, '', ''],
    ['Pune', 'S1', 'Test Gone', A1, TM, RH, CH, false, '', ''],
    ['Pune', 'S1', 'Test Exited', A1, TM, RH, CH, false, '', ''],
    ['Pune', 'S1', 'Test Excluded Gone', A1, TM, RH, CH, true, '', ''],
  ];
}

function rmSyncTestDirRows_() {
  return [
    ['manager_name', 'roles', 'regions', 'email', 'people_reporting_up_to_them', 'email_source'],
    ['Test CH Pune', 'CH', 'Pune', '', 7, ''],
    ['Test RH Pune', 'RH', 'Pune', 'old.rh@example.test', 3, 'manual'],
    ['Test TM Pune', 'TM', 'Pune', 'tm.pune@example.test', 2, 'manual'],
  ];
}

// o: { people, fillers, tabRows, dirRows, noDirectory, noTab, openThrows }. Installs fakes for the global services and returns handles.
function rmSyncTestWorld_(o) {
  const opts = o || {};
  const hrSheet = TestMockSheet_('Roster', rmSyncTestHrValues_(opts.people || rmSyncTestPeople_(), opts.fillers));
  const hrSs = { getSheets: function () { return [hrSheet, TestMockSheet_('Second tab', [['ignored']])]; } };
  const tab = TestMockSheet_('RM_Hierarchy', opts.tabRows || rmSyncTestTabRows_());
  const dir = TestMockSheet_('Manager_Directory', opts.dirRows || rmSyncTestDirRows_());
  const sheets = {};
  if (!opts.noTab) sheets['RM_Hierarchy'] = tab;
  if (!opts.noDirectory) sheets['Manager_Directory'] = dir;
  const ss = TestMockSpreadsheet_(sheets);
  const opened = [];
  SpreadsheetApp = Object.assign({}, SpreadsheetApp, {
    getActiveSpreadsheet: function () { return ss; },
    openById: function (id) {
      opened.push(id);
      if (opts.openThrows) throw new Error('You do not have permission to access the requested document.');
      return hrSs;
    },
  });
  PropertiesService = TestMockPropertiesService_();
  DriveApp = TestMockDriveApp_();
  return { ss: ss, tab: tab, dir: dir, hrSheet: hrSheet, opened: opened };
}

function rmSyncTestSetApply_(on) { PropertiesService.getScriptProperties().setProperty(RMSYNC_APPLY_PROPERTY_, on ? 'true' : 'false'); }
function rmSyncTestState_() { const raw = PropertiesService.getScriptProperties().getProperty(RMSYNC_STATE_PROPERTY_); return raw ? JSON.parse(raw) : null; }
function rmSyncTestTabNames_(tab) { return readRmHierarchyRowsGs_(tab).map(function (r) { return r.name; }); }
function rmSyncTestRow_(tab, name) { return readRmHierarchyRowsGs_(tab).filter(function (r) { return r.name === name; })[0]; }
function rmSyncTestNames_(list) { return list.map(function (x) { return x.name; }); }

const RMSYNC_TEST_THU_ = new Date('2026-10-08T17:45:00Z'); // Thu 8 Oct 23:15 IST
const RMSYNC_TEST_FRI_ = new Date('2026-10-09T17:45:00Z');
const RMSYNC_TEST_MON_ = new Date('2026-10-12T17:45:00Z'); // Mon 12 Oct 23:15 IST

function runRmHierarchySyncTests_() {
  TestEnv_setUp_('Tests_RmHierarchySync', null);
  const realDrive = DriveApp;
  const realLookup = lookupEmployeeEmail_;
  // The report recipients come from the private employee table by name — stubbed so a live run never resolves real addresses.
  const lookupTable = { 'snehil chhimwal': TEST_EMAIL_PRIMARY_, 'sushil kannojiya': TEST_EMAIL_CH_, 'ashish ivlekar': TEST_EMAIL_SECONDARY_ };
  lookupEmployeeEmail_ = function (name) { return lookupTable[String(name || '').trim().toLowerCase()] || ''; };
  const allThree = [TEST_EMAIL_CH_, TEST_EMAIL_PRIMARY_, TEST_EMAIL_SECONDARY_].sort();
  // The real pinned overrides (2026-10-19) name live people: every test runs with none unless it supplies its own.
  const realPins = rmSyncPinnedOverridesGs_;
  rmSyncPinnedOverridesGs_ = function () { return []; };
  try {
    // ================= parseHrRosterGs_ =================
    {
      const people = [
        { name: 'Dup Person', role: 'S1', team: 'Pune', chain: ['Mgr One'] },
        { name: 'Dup  Person', role: 'S1', team: 'Pune', chain: ['Mgr Two', 'Mgr One'], exit: '2026-09-30', email: 'dup@example.test' },
        { name: 'Plain Person', role: 'RH', team: 'Pune' },
      ];
      const values = rmSyncTestHrValues_(people, 0);
      values.push(['x', '', 'S1']); // a row with no name is skipped
      const parsed = parseHrRosterGs_(values);
      TestAssertEqual_(parsed.problems, [], 'parseHrRosterGs_: a sheet laid out as expected has no problems');
      TestAssertEqual_(parsed.count, 2, 'parseHrRosterGs_: a person on two rows (even with different spacing in the name) counts once; a nameless row is skipped');
      const dup = parsed.people['dup person'];
      TestAssertEqual_(dup.chainNames, ['Mgr One', 'Mgr Two'], 'parseHrRosterGs_: the chain names of a person with two rows are unioned, "-" cells ignored');
      TestAssert_(dup.exited, 'parseHrRosterGs_: an Exit date on any of a person\'s rows marks them exited');
      TestAssertEqual_(dup.email, 'dup@example.test', 'parseHrRosterGs_: the email from the row that has one is kept');
      TestAssert_(!parsed.people['plain person'].exited && parsed.people['plain person'].chainNames.length === 0, 'parseHrRosterGs_: "-" in Exit and in every chain column means not exited, no chain');
      const dateExit = rmSyncTestHrValues_([{ name: 'Date Exit', role: 'S1', team: 'Pune' }], 0);
      dateExit[1][17] = new Date('2026-10-01T00:00:00Z');
      TestAssert_(parseHrRosterGs_(dateExit).people['date exit'].exited, 'parseHrRosterGs_: an Exit cell holding a real Date counts as exited');
      const wrong = rmSyncTestHrValues_(people, 0);
      wrong[0][6] = 'Surprise';
      const wrongParsed = parseHrRosterGs_(wrong);
      TestAssertEqual_(wrongParsed.problems.length, 1, 'parseHrRosterGs_: one header label in the wrong place is one problem');
      TestAssertContains_(wrongParsed.problems[0], 'column 7', 'parseHrRosterGs_: the problem names the column');
      TestAssertEqual_(wrongParsed.count, 0, 'parseHrRosterGs_: a wrong layout yields no people at all (nothing is trusted)');
      TestAssertEqual_(parseHrRosterGs_([]).problems.length, 1, 'parseHrRosterGs_: an empty sheet is a problem');
    }

    // ================= classifyRmSyncJoinerGs_ =================
    {
      const roles = { 'test a1': 'a1', 'test a1b': 'tl', 'test tm': 'tm', 'test rh': 'rh', 'test ch': 'cluster head' };
      const high = classifyRmSyncJoinerGs_({ chainNames: ['Test A1', 'Test TM', 'Test RH', 'Test CH'] }, roles);
      TestAssertEqual_(high.confidence, 'HIGH', 'classifyRmSyncJoinerGs_: every slot resolving to a distinct tier is HIGH');
      TestAssertEqual_(high.fields, { tl: 'Test A1', tm: 'Test TM', rh: 'Test RH', ch: 'Test CH' }, 'classifyRmSyncJoinerGs_: each name goes to the field its OWN role belongs to');
      TestAssertEqual_(classifyRmSyncJoinerGs_({ chainNames: [] }, roles).confidence, 'LOW', 'classifyRmSyncJoinerGs_: a blank chain is LOW (never guessed)');
      const unknown = classifyRmSyncJoinerGs_({ chainNames: ['Test TM', 'Stranger'] }, roles);
      TestAssertEqual_(unknown.confidence, 'LOW', 'classifyRmSyncJoinerGs_: a slot that resolves to nobody known makes the whole chain LOW');
      TestAssertContains_(unknown.notes, 'Stranger', 'classifyRmSyncJoinerGs_: the note names the unresolved manager');
      const clash = classifyRmSyncJoinerGs_({ chainNames: ['Test A1', 'Test A1b'] }, roles);
      TestAssertEqual_(clash.confidence, 'LOW', 'classifyRmSyncJoinerGs_: two different names for one tier (a1 and tl are both the TL field) is LOW');
      TestAssertEqual_(classifyRmSyncJoinerGs_({ chainNames: ['Test A1b'] }, roles).fields, { tl: 'Test A1b' }, 'classifyRmSyncJoinerGs_: the role "TL" maps to the same field as "A1"');
    }

    // ================= computeRmHierarchySyncPlanGs_ =================
    {
      const world = rmSyncTestWorld_();
      const hr = parseHrRosterGs_(readHrRosterValuesGs_());
      const plan = computeRmHierarchySyncPlanGs_(hr, readRmHierarchyRowsGs_(world.tab), readManagerDirectoryRowsGs_(world.dir));
      TestAssertEqual_(plan.fixes.length, 1, 'plan: exactly one stale field is safe to fix');
      TestAssertEqual_([plan.fixes[0].name, plan.fixes[0].field, plan.fixes[0].oldValue, plan.fixes[0].newValue], ['Test A1 Solo', 'tm', 'Test TM Old', 'Test TM Pune'],
        'plan: a stale TM whose person has ONE current manager, who is a TM, is fixed to that manager');
      TestAssertEqual_(rmSyncTestNames_(plan.needsHuman).sort(), ['Test S1 Moved', 'Test S1 Override'], 'plan: a stale field on a person with a long chain is NOT written - it needs a person');
      const moved = plan.needsHuman.filter(function (n) { return n.name === 'Test S1 Moved'; })[0];
      TestAssertEqual_([moved.field, moved.suggestion], ['tl', 'Test A1 Pune'], 'plan: the flagged field carries a suggestion when the whole HR chain resolves cleanly');
      const override = plan.needsHuman.filter(function (n) { return n.name === 'Test S1 Override'; })[0];
      TestAssertEqual_([override.field, override.oldValue], ['ch', 'Test CH Override'], 'plan: a deliberate CH override that differs from the HR chain is flagged, never overwritten');
      TestAssertEqual_(rmSyncTestNames_(plan.leavers).sort(), ['Test Exited', 'Test Gone'], 'plan: someone missing from the HR sheet, or with an Exit date, is a possible leaver; a hand-Excluded row is ignored');
      TestAssertEqual_(plan.leavers.filter(function (l) { return l.name === 'Test Exited'; })[0].reason, 'has an Exit date in the HR sheet', 'plan: the leaver reason says why');
      TestAssertEqual_(rmSyncTestNames_(plan.newJoiners), ['Test New S1', 'Test Zed A1', 'Test Abe S1'], 'plan: new people with a clean chain are added; a joiner under another joiner resolves on the second pass');
      const abe = plan.newJoiners.filter(function (j) { return j.name === 'Test Abe S1'; })[0];
      TestAssertEqual_([abe.team, abe.role, abe.tl, abe.tm, abe.rh, abe.ch], ['Pune', 'S1', 'Test Zed A1', 'Test TM Pune', 'Test RH Pune', 'Test CH Pune'], 'plan: a new joiner row is resolved by each manager\'s own role');
      TestAssertEqual_(plan.newJoiners.filter(function (j) { return j.name === 'Test New S1'; })[0].email, 'new.s1@example.test', 'plan: a new joiner\'s HR email is carried onto the row');
      TestAssertEqual_(rmSyncTestNames_(plan.newJoinersLow).sort(), ['Test Low S1', 'Test No Chain'], 'plan: a joiner with an unresolvable or blank chain is reported, not added');
      const allNames = rmSyncTestNames_(plan.newJoiners).concat(rmSyncTestNames_(plan.newJoinersLow));
      ['Test Magnet S1', 'Test Finance Person', 'Test Exited New', 'Snehil Chhimwal', 'Filler Person 1'].forEach(function (n) {
        TestAssert_(allNames.indexOf(n) === -1, 'plan: ' + n + ' (Magnet team / non-sales role / exited / not an RM) is never a new joiner');
      });
      TestAssert_(plan.fixes.concat(plan.needsHuman).every(function (x) { return x.name !== 'Test S1 Steady'; }), 'plan: a person whose row already matches the HR chain produces nothing');
      TestAssertEqual_(plan.emailFills.map(function (e) { return e.name + ':' + e.email; }), ['Test CH Pune:ch.pune@example.test'], 'plan: a blank Manager_Directory email is filled from the HR sheet');
      TestAssertEqual_(plan.emailChanges.map(function (e) { return e.name + ':' + e.existing + '>' + e.hr; }), ['Test RH Pune:old.rh@example.test>rh.pune@example.test'], 'plan: a different existing email is only reported');
      TestAssertEqual_(plan.directoryAdds.map(function (d) { return d.name + '|' + d.email; }), ['Test A1 Pune|a1.pune@example.test', 'Test Zed A1|'], 'plan: a current manager missing from Manager_Directory is added (stale / unknown manager names are not)');
      // Purity: planning wrote nothing.
      TestAssertEqual_(world.tab._data.length, rmSyncTestTabRows_().length, 'plan: computing it changes nothing in the tab');
    }

    // ================= run: report-only (the default) =================
    {
      const world = rmSyncTestWorld_();
      const tabBefore = JSON.stringify(world.tab._data);
      const dirBefore = JSON.stringify(world.dir._data);
      const sentBefore = TestGmailLog_.sent.length;
      const res = runRmHierarchySyncGs_({ now: RMSYNC_TEST_THU_ });
      TestAssertEqual_(world.opened, [RMSYNC_HR_SHEET_ID_], 'run: the HR sheet is opened by its id');
      TestAssertEqual_(res.mode, 'REPORT-ONLY', 'run: with no apply setting it is report-only');
      TestAssertEqual_(JSON.stringify(world.tab._data), tabBefore, 'run (report-only): RM_Hierarchy is untouched');
      TestAssertEqual_(JSON.stringify(world.dir._data), dirBefore, 'run (report-only): Manager_Directory is untouched');
      TestAssertEqual_(TestGmailLog_.sent.length, sentBefore + 1, 'run (report-only): one report email goes out');
      const mail = TestGmailLog_.sent[TestGmailLog_.sent.length - 1];
      TestAssertEqual_(mail.to.split(',').sort(), allThree, 'run: the report goes to the three named people (addresses resolved by name)');
      TestAssertContains_(mail.subject, 'REPORT-ONLY', 'run: the subject says report-only');
      TestAssertContains_(mail.subject, '4 change(s)', 'run: the subject counts the pending changes (1 manager change + 3 new people)');
      TestAssertContains_(mail.body, 'WOULD BE APPLIED', 'run (report-only): the changes are labelled "would be applied"');
      ['Test Abe S1', 'Test Zed A1', 'Test New S1', 'Test A1 Solo'].forEach(function (n) { TestAssertContains_(mail.body, n, 'run: the report names ' + n); });
      TestAssertContains_(mail.body, 'POSSIBLE LEAVERS', 'run: the report has a possible-leavers section');
      TestAssertContains_(mail.body, 'Test Gone', 'run: a missing person is listed as a possible leaver');
      TestAssertContains_(mail.body, 'kept in RM_Hierarchy', 'run: the report says leavers are kept');
      TestAssertContains_(mail.body, 'Suggested: "Test A1 Pune"', 'run: a flagged field carries its suggestion');
      TestAssertContains_(mail.body, 'MANAGER EMAIL DIFFERENCES', 'run: a differing manager email is reported');
      const state = rmSyncTestState_();
      TestAssertEqual_(Object.keys(state.items).length, 7, 'run: the 7 items for a person (2 fields, 2 joiners, 2 leavers, 1 email) are remembered');
      TestAssert_(!state.appliedEver, 'run (report-only): the sync is not marked as having applied anything');
      TestAssert_(!rmHierarchySyncIsActiveGs_(), 'run (report-only): the rebuild guard stays off');

      // Next night, nothing new: the pending changes are still listed, the leavers are NOT repeated.
      runRmHierarchySyncGs_({ now: RMSYNC_TEST_FRI_ });
      TestAssertEqual_(TestGmailLog_.sent.length, sentBefore + 2, 'run (report-only): the next night\'s report goes out too while changes are pending');
      const second = TestGmailLog_.sent[TestGmailLog_.sent.length - 1];
      TestAssertContains_(second.body, 'WOULD BE APPLIED', 'run (report-only): the pending changes are listed again');
      TestAssert_(second.body.indexOf('POSSIBLE LEAVERS') === -1, 'run: a leaver already reported is not repeated the next night');
      TestAssert_(second.body.indexOf('MONDAY REMINDER') === -1, 'run: no reminder on a Friday');

      // Monday: the open items come back once.
      runRmHierarchySyncGs_({ now: RMSYNC_TEST_MON_ });
      const monday = TestGmailLog_.sent[TestGmailLog_.sent.length - 1];
      TestAssertContains_(monday.body, 'MONDAY REMINDER', 'run: on Monday the still-open items are reminded');
      TestAssertContains_(monday.body, 'Test Gone', 'run: the Monday reminder lists the open leaver');
      runRmHierarchySyncGs_({ now: RMSYNC_TEST_MON_ });
      TestAssert_(TestGmailLog_.sent[TestGmailLog_.sent.length - 1].body.indexOf('MONDAY REMINDER') === -1, 'run: the Monday reminder is sent once a day');
      TestAssertOnlyTestEmails_();
    }

    // ================= run: apply =================
    {
      const world = rmSyncTestWorld_();
      rmSyncTestSetApply_(true);
      const sentBefore = TestGmailLog_.sent.length;
      const res = runRmHierarchySyncGs_({ now: RMSYNC_TEST_THU_ });
      TestAssertEqual_(res.mode, 'APPLIED', 'apply: with the setting on, the run applies');
      const solo = rmSyncTestRow_(world.tab, 'Test A1 Solo');
      TestAssertEqual_(solo.tm, 'Test TM Pune', 'apply: the stale TM is fixed');
      TestAssertContains_(solo.note, 'sync 2026-10-08: tm Test TM Old -> Test TM Pune', 'apply: the change is recorded in the person\'s note');
      TestAssertEqual_(rmSyncTestRow_(world.tab, 'Test S1 Moved').tl, 'Test A1 Old', 'apply: a field that needs a person is NOT changed');
      TestAssertEqual_(rmSyncTestRow_(world.tab, 'Test S1 Override').ch, 'Test CH Override', 'apply: a deliberate override is NOT changed');
      const abe = rmSyncTestRow_(world.tab, 'Test Abe S1');
      TestAssertEqual_([abe.tl, abe.tm, abe.rh, abe.ch, abe.excluded], ['Test Zed A1', 'Test TM Pune', 'Test RH Pune', 'Test CH Pune', false], 'apply: a new person is appended with a resolved chain and Excluded off');
      TestAssertContains_(abe.note, 'added by the nightly sync 2026-10-08', 'apply: a new row says where it came from');
      TestAssertEqual_(rmSyncTestRow_(world.tab, 'Test New S1').email, 'new.s1@example.test', 'apply: the new row carries the HR email');
      TestAssertEqual_(rmSyncTestRow_(world.tab, 'Test Low S1'), undefined, 'apply: a person the sync could not place is not added');
      TestAssert_(!!rmSyncTestRow_(world.tab, 'Test Gone') && !!rmSyncTestRow_(world.tab, 'Test Exited'), 'apply: a possible leaver is NEVER removed');
      TestAssertEqual_(world.tab._data.length, rmSyncTestTabRows_().length + 3, 'apply: exactly the 3 new people were added');
      const ch = world.dir._data.filter(function (r) { return r[0] === 'Test CH Pune'; })[0];
      TestAssertEqual_([ch[3], ch[5]], ['ch.pune@example.test', 'HR sheet sync'], 'apply: a blank manager email is filled and marked as coming from the sync');
      TestAssertEqual_(world.dir._data.filter(function (r) { return r[0] === 'Test RH Pune'; })[0][3], 'old.rh@example.test', 'apply: an existing manager email is never overwritten');
      TestAssertEqual_(world.dir._data.slice(4).map(function (r) { return r[0]; }), ['Test A1 Pune', 'Test Zed A1'], 'apply: missing managers are added to Manager_Directory');
      const archive = DriveApp._folders[ARCHIVE_ROOT_FOLDER_];
      TestAssertEqual_(archive._folders['RM_Hierarchy_sync_backup']._filesList.length, 1, 'apply: RM_Hierarchy is backed up to Drive first');
      TestAssertEqual_(archive._folders['Manager_Directory_sync_backup']._filesList.length, 1, 'apply: Manager_Directory is backed up to Drive first');
      const backupCsv = archive._folders['RM_Hierarchy_sync_backup']._filesList[0]._content;
      TestAssertContains_(backupCsv, 'Test TM Old', 'apply: the backup holds the rows as they were BEFORE the change');
      TestAssert_(rmSyncTestState_().appliedEver, 'apply: the sync is marked as having applied');
      TestAssert_(rmHierarchySyncIsActiveGs_(), 'apply: the rebuild guard is now on');
      TestAssertEqual_(res.applyProblems, [], 'apply: the read-back found nothing wrong');
      const mail = TestGmailLog_.sent[TestGmailLog_.sent.length - 1];
      TestAssertContains_(mail.subject, 'APPLIED', 'apply: the subject says applied');
      TestAssert_(mail.body.indexOf('WOULD BE APPLIED') === -1 && mail.body.indexOf('APPLIED:') !== -1, 'apply: the body lists what WAS applied');
      TestAssertEqual_(TestGmailLog_.sent.length, sentBefore + 1, 'apply: one report email');

      // Second night: nothing left to do and nothing new to say.
      const tabAfter = JSON.stringify(world.tab._data);
      runRmHierarchySyncGs_({ now: RMSYNC_TEST_FRI_ });
      TestAssertEqual_(JSON.stringify(world.tab._data), tabAfter, 'apply: running again changes nothing (idempotent)');
      TestAssertEqual_(TestGmailLog_.sent.length, sentBefore + 1, 'apply: a night with nothing new sends no email');
      TestAssertOnlyTestEmails_();
    }

    // ================= run: held (too many changes) =================
    {
      const bulk = rmSyncTestPeople_();
      for (let i = 0; i < 30; i++) bulk.push({ name: 'Test Bulk ' + i, role: 'S1', team: 'Pune', chain: ['Test A1 Pune', 'Test TM Pune', 'Test RH Pune', 'Test CH Pune'] });
      const world = rmSyncTestWorld_({ people: bulk });
      rmSyncTestSetApply_(true);
      const tabBefore = JSON.stringify(world.tab._data);
      const res = runRmHierarchySyncGs_({ now: RMSYNC_TEST_THU_ });
      TestAssertEqual_(res.mode, 'HELD', 'held: more than the allowed changes in one night is held');
      TestAssertEqual_(JSON.stringify(world.tab._data), tabBefore, 'held: nothing was written');
      const mail = TestGmailLog_.sent[TestGmailLog_.sent.length - 1];
      TestAssertContains_(mail.subject, 'HELD', 'held: the subject says held');
      TestAssertContains_(mail.body, 'NOTHING was written', 'held: the body says nothing was written');
      TestAssertContains_(mail.body, 'Test Bulk 0', 'held: the pending changes are still listed');
      TestAssert_(!rmSyncTestState_().appliedEver, 'held: a held night does not mark the sync as applied');
      TestAssertOnlyTestEmails_();
    }

    // ================= run: things that stop it =================
    {
      const world = rmSyncTestWorld_();
      const tabBefore = JSON.stringify(world.tab._data);
      const sent = TestGmailLog_.sent.length;
      rmSyncTestSetApply_(true);
      world.hrSheet._data[0][6] = 'Surprise';
      let err = null;
      try { runRmHierarchySyncGs_({ now: RMSYNC_TEST_THU_ }); } catch (e) { err = e; }
      TestAssert_(!!err && /not laid out as expected/.test(err.message), 'stop: a changed HR column layout stops the run with a clear message');
      TestAssertEqual_(JSON.stringify(world.tab._data), tabBefore, 'stop: nothing was written');
      TestAssertEqual_(TestGmailLog_.sent.length, sent, 'stop: no report is emailed (the job wrapper alerts ops)');

      const small = rmSyncTestWorld_({ fillers: 0 });
      rmSyncTestSetApply_(true);
      let smallErr = null;
      try { runRmHierarchySyncGs_({ now: RMSYNC_TEST_THU_ }); } catch (e) { smallErr = e; }
      TestAssert_(!!smallErr && /lists only/.test(smallErr.message), 'stop: far fewer people than expected is treated as a broken read');
      TestAssertEqual_(small.tab._data.length, rmSyncTestTabRows_().length, 'stop: nothing was written after the size check');

      const noAccess = rmSyncTestWorld_({ openThrows: true });
      let accessErr = null;
      try { runRmHierarchySyncGs_({ now: RMSYNC_TEST_THU_ }); } catch (e) { accessErr = e; }
      TestAssert_(!!accessErr && /Cannot open the HR roster sheet/.test(accessErr.message) && /Anyone in Homesfy/.test(accessErr.message), 'stop: no access to the HR sheet says so and says how to fix it');
      TestAssertEqual_(noAccess.tab._data.length, rmSyncTestTabRows_().length, 'stop: no access means no writes');

      rmSyncTestWorld_({ noTab: true });
      TestAssertThrows_(function () { runRmHierarchySyncGs_({ now: RMSYNC_TEST_THU_ }); }, 'stop: a missing RM_Hierarchy tab stops the run');

      const badTab = rmSyncTestWorld_();
      badTab.tab._data[0][3] = 'boss';
      let tabErr = null;
      try { runRmHierarchySyncGs_({ now: RMSYNC_TEST_THU_ }); } catch (e) { tabErr = e; }
      TestAssert_(!!tabErr && /header row/.test(tabErr.message), 'stop: a changed RM_Hierarchy header stops the run');

      const noDir = rmSyncTestWorld_({ noDirectory: true });
      const before = TestGmailLog_.sent.length;
      runRmHierarchySyncGs_({ now: RMSYNC_TEST_THU_ });
      TestAssertContains_(TestGmailLog_.sent[before].body, 'Manager_Directory tab does not exist', 'stop: a missing Manager_Directory is a note in the report, not a failure');
      TestAssertEqual_(noDir.ss.getSheetByName('Manager_Directory'), null, 'stop: the sync does not create a Manager_Directory tab');
    }

    // ================= applyRmHierarchySyncPlanGs_: a cell edited since it was read =================
    {
      const world = rmSyncTestWorld_();
      const hr = parseHrRosterGs_(readHrRosterValuesGs_());
      const rows = readRmHierarchyRowsGs_(world.tab);
      const directory = readManagerDirectoryRowsGs_(world.dir);
      const plan = computeRmHierarchySyncPlanGs_(hr, rows, directory);
      const solo = rows.filter(function (r) { return r.name === 'Test A1 Solo'; })[0];
      world.tab.getRange(solo.rowNumber, 5, 1, 1).setValue('Hand Edited Manager');
      world.dir.getRange(2, 4, 1, 1).setValue('typed.by.hand@example.test');
      const result = applyRmHierarchySyncPlanGs_(world.ss, world.tab, rows, world.dir, directory, plan, '2026-10-08');
      TestAssert_(result.problems.some(function (p) { return p.indexOf('skipped Test A1 Solo') === 0; }), 'apply: a cell edited by a person since it was read is skipped and reported');
      TestAssertEqual_(rmSyncTestRow_(world.tab, 'Test A1 Solo').tm, 'Hand Edited Manager', 'apply: the person\'s edit is kept');
      TestAssert_(result.problems.some(function (p) { return p.indexOf('skipped the email for Test CH Pune') === 0; }), 'apply: a Manager_Directory email typed since it was read is skipped and reported');
      TestAssertEqual_(world.dir._data[1][3], 'typed.by.hand@example.test', 'apply: the typed email is kept');
    }

    // ================= TEST MODE =================
    {
      const world = rmSyncTestWorld_();
      rmSyncTestSetApply_(true);
      TEST_MODE_OVERRIDE_EMAIL_ = TEST_EMAIL_PRIMARY_;
      const tabBefore = JSON.stringify(world.tab._data);
      const before = TestGmailLog_.sent.length;
      let res;
      try { res = runRmHierarchySyncGs_({ now: RMSYNC_TEST_THU_ }); } finally { TEST_MODE_OVERRIDE_EMAIL_ = ''; }
      TestAssertEqual_(res.mode, 'REPORT-ONLY', 'test mode: a run in TEST MODE never applies, whatever the setting');
      TestAssertEqual_(JSON.stringify(world.tab._data), tabBefore, 'test mode: nothing is written');
      TestAssertEqual_(TestGmailLog_.sent[before].to, TEST_EMAIL_PRIMARY_, 'test mode: the report goes only to the override address');
      TestAssertEqual_(rmSyncTestState_(), null, 'test mode: no state is saved');
    }

    // ================= recipients =================
    {
      const people = rmSyncTestPeople_().filter(function (p) { return p.name !== 'Sushil Kannojiya'; });
      const world = rmSyncTestWorld_({ people: people });
      lookupEmployeeEmail_ = function () { return ''; }; // the private table has nobody: fall back to each person's HR-sheet address
      const before = TestGmailLog_.sent.length;
      runRmHierarchySyncGs_({ now: RMSYNC_TEST_THU_ });
      const mail = TestGmailLog_.sent[before];
      TestAssertEqual_(mail.to.split(',').sort(), [TEST_EMAIL_PRIMARY_, TEST_EMAIL_SECONDARY_].sort(), 'recipients: a name the private table lacks falls back to the address on their HR row; a person in neither is left out');
      TestAssertContains_(mail.body, 'no email address found for Sushil Kannojiya', 'recipients: the report says who it could not reach');

      const nobody = rmSyncTestWorld_({ people: rmSyncTestPeople_().filter(function (p) { return ['Snehil Chhimwal', 'Sushil Kannojiya', 'Ashish Ivlekar'].indexOf(p.name) === -1; }) });
      const before2 = TestGmailLog_.sent.length;
      runRmHierarchySyncGs_({ now: RMSYNC_TEST_THU_ });
      TestAssertEqual_(TestGmailLog_.sent[before2].to, TEST_EMAIL_PRIMARY_, 'recipients: with nobody resolvable the report goes to the ops address, never nowhere');
      lookupEmployeeEmail_ = function (name) { return lookupTable[String(name || '').trim().toLowerCase()] || ''; };
      TestAssertOnlyTestEmails_();
    }

    // ================= the job wrapper, watchdog and trigger =================
    {
      rmSyncTestWorld_();
      const before = TestGmailLog_.sent.length;
      syncRmHierarchyNightly();
      const rec = readEmailJobRunGs_('syncRmHierarchyNightly');
      TestAssertEqual_(rec.status, 'completed', 'job: a successful run leaves a "completed" run record for the watchdog');

      rmSyncTestWorld_({ openThrows: true });
      const alertsBefore = TestGmailLog_.sent.length;
      TestAssertThrows_(function () { syncRmHierarchyNightly(); }, 'job: a failure is re-thrown so Executions shows Failed');
      const alert = TestGmailLog_.sent.slice(alertsBefore).filter(function (e) { return /syncRmHierarchyNightly failed/.test(e.subject); })[0];
      TestAssert_(!!alert, 'job: a failure alerts ops');
      TestAssertContains_(alert.body, 'Cannot open the HR roster sheet', 'job: the alert carries the real reason');
      TestAssertEqual_(readEmailJobRunGs_('syncRmHierarchyNightly').status, 'failed', 'job: a failed run leaves a "failed" record');

      const schedule = emailJobScheduleGs_();
      TestAssertEqual_(schedule.syncRmHierarchyNightly.hour, 23, 'watchdog: the sync is watched, due by 23:30 IST');
      const lateNight = new Date('2026-10-08T18:15:00Z'); // 23:45 IST
      PropertiesService = TestMockPropertiesService_();
      TestAssert_(emailJobProblemsGs_(lateNight).some(function (p) { return p.job === 'syncRmHierarchyNightly' && p.kind === 'never_started'; }), 'watchdog: a night with no run record is reported as never started');
      writeEmailJobRunGs_('syncRmHierarchyNightly', { day: '2026-10-08', startedAt: lateNight.toISOString(), status: 'completed' });
      TestAssert_(!emailJobProblemsGs_(lateNight).some(function (p) { return p.job === 'syncRmHierarchyNightly'; }), 'watchdog: a completed run is fine');

      ScriptApp = TestMockScriptApp_(['syncRmHierarchyNightly', 'someOtherJob']);
      setupRmHierarchySync();
      TestAssertEqual_(ScriptApp._state.deleted, ['syncRmHierarchyNightly'], 'setup: re-running removes only its own earlier trigger');
      TestAssertEqual_(ScriptApp._state.created.length, 1, 'setup: exactly one trigger is created');
      const spec = ScriptApp._state.created[0];
      TestAssertEqual_([spec.fnName, spec.hour, spec.minute, spec.days, spec.tz], ['syncRmHierarchyNightly', 23, 15, 1, 'Asia/Kolkata'], 'setup: daily near 23:15 IST');
    }

    // ================= switches, status and the rebuild guard =================
    {
      const world = rmSyncTestWorld_();
      TestAssert_(!rmHierarchySyncApplyEnabledGs_(), 'switch: apply is off by default');
      enableRmHierarchySyncApplyNow();
      TestAssert_(rmHierarchySyncApplyEnabledGs_() && rmHierarchySyncIsActiveGs_(), 'switch: enableRmHierarchySyncApplyNow turns apply on');
      const tabBefore = JSON.stringify(world.tab._data);
      rebuildRmHierarchy();
      TestAssertEqual_(JSON.stringify(world.ss.getSheetByName('RM_Hierarchy')._data), tabBefore, 'guard: rebuildRmHierarchy refuses while the sync is applying - the live tab is untouched');
      rebuildRmHierarchyForce();
      TestAssertEqual_(world.ss.getSheetByName('RM_Hierarchy')._data.length, RM_HIERARCHY_RAW_.length + 1, 'guard: rebuildRmHierarchyForce rebuilds from the embedded table on purpose');
      disableRmHierarchySyncApplyNow();
      TestAssert_(!rmHierarchySyncApplyEnabledGs_() && !rmHierarchySyncIsActiveGs_(), 'switch: disableRmHierarchySyncApplyNow turns it off again (and nothing has ever been applied)');
      let threw = null;
      try { showRmHierarchySyncPlanNow(); showRmHierarchySyncStatusNow(); } catch (e) { threw = e; }
      TestAssertEqual_(threw, null, 'show: the read-only plan and status helpers run');
      TestAssertEqual_(rmSyncHashGs_('a') === rmSyncHashGs_('a') && rmSyncHashGs_('a') !== rmSyncHashGs_('b'), true, 'hash: stable, and different inputs differ');
      TestAssertEqual_([rmSyncIsMondayIstGs_(RMSYNC_TEST_MON_), rmSyncIsMondayIstGs_(RMSYNC_TEST_THU_), rmSyncIsMondayIstGs_(new Date('2026-10-11T17:00:00Z')), rmSyncIsMondayIstGs_(new Date('2026-10-11T19:00:00Z')), rmSyncIsMondayIstGs_(new Date('2026-10-12T19:00:00Z'))],
        [true, false, false, true, false], 'monday: judged in IST (Sun 22:30 IST is not Monday; Sun 19:00 UTC is already Monday 00:30 IST; Mon 19:00 UTC is Tuesday in IST)');
    }

    // ================= near-name matching: old spellings are not leavers =================
    {
      TestAssertEqual_(rmSyncNameTokensGs_('Mamtaben S 1 Account'), ['mamtaben'], 'tokens: initials, numbers and the word "Account" are dropped');
      TestAssertEqual_(rmSyncNameTokensGs_('Atharva P. Belose'), ['atharva', 'belose'], 'tokens: a one-letter initial and punctuation are dropped');
      TestAssertEqual_(rmSyncNameTokensGs_('Sourabh Sareen Pnl'), ['sourabh', 'sareen'], 'tokens: the label word "Pnl" is dropped');
      TestAssertEqual_([rmSyncEditDistanceGs_('abc', 'abc'), rmSyncEditDistanceGs_('mohmmad', 'mohammad'), rmSyncEditDistanceGs_('anasair', 'ansari'), rmSyncEditDistanceGs_('ab', 'ba')], [0, 1, 2, 1],
        'edit distance: equal 0, one missing letter 1, a missing letter plus a swap 2, a swap of neighbours 1');
      TestAssertEqual_([rmSyncTokenCloseGs_('renavikar', 'renaviker'), rmSyncTokenCloseGs_('anasair', 'ansari'), rmSyncTokenCloseGs_('khan', 'khat'), rmSyncTokenCloseGs_('rahul', 'rohit'), rmSyncTokenCloseGs_('rahul', 'rahull')], [true, true, false, false, true],
        'token match: long words may differ by an edit or two, short words must match exactly, different words never match');
      const near = function (row, hr) { return rmSyncNearNameGs_(row, { rawName: hr }); };
      TestAssertEqual_([
        near('Peddapally Shivaji', 'Peddapally Veera Shivaji'), near('Atharva P Belose', 'Atharva Belose'), near('Akash Ugale', 'Akash A Ugale'), near('Sourabh Sareen Pnl', 'Sourabh Sareen'),
        near('Jay Renavikar', 'Jay Renaviker'), near('Mohmmad Azaz Izhar Anasair', 'Mohammad Azaz Izhar Ansari'), near('Mamtaben S 1 Account', 'Mamtaben Sosa'), near('Wasim Shaikh', 'Shaikh Wasim'),
      ], [true, true, true, true, true, true, true, true], 'near name: every kind of old spelling seen in the real data is recognised (middle name, initial, label word, spelling slip, "Account" label, word order)');
      TestAssertEqual_([
        near('G Kumar', 'Avinash Kumar'), near('Pratapkumar Yadav', 'Angad Yadav'), near('Sonam Dubey', 'Deepali Dubey'), near('Adil Shaikh', 'Firoj Shaikh'), near('Mohd Ali Abdul Gaffar', 'Mohd Ali Khan'),
        near('Mohammed Khan', 'Fahim Khan'), near('Mamtaben S 1 Account', 'Mohd Sosa'), near('Rahul Singh', 'Rohit Singh'),
      ], [false, false, false, false, false, false, false, false], 'near name: different people who share a first name, a surname or a title never match');

      const aliasPeople = [
        { name: 'Orlan Veera Zhivaji', role: 'S1', team: 'Pune' }, { name: 'Brisa Kellow', role: 'S1', team: 'Pune' }, { name: 'Tavi A Ostrel', role: 'S1', team: 'Pune' },
        { name: 'Pelor Wanes', role: 'S1', team: 'Pune' }, { name: 'Jorv Renaviker', role: 'S1', team: 'Pune' }, { name: 'Mohammad Quill Ansari', role: 'S1', team: 'Pune' },
        { name: 'Zorbit Sosa', role: 'S1', team: 'Pune' }, { name: 'Avi Kumar', role: 'S1', team: 'Pune' }, { name: 'Dev Amit Sharma', role: 'S1', team: 'Pune' },
        { name: 'Dev Amit Verma', role: 'S1', team: 'Pune' }, { name: 'Mohd Ali Khan', role: 'S1', team: 'Pune' }, { name: 'Rina Exitt Two', role: 'S1', team: 'Pune', exit: '2026-10-01' },
      ];
      const aliasRows = [['team', 'role', 'name', 'tl', 'tm', 'rh', 'ch', 'excluded', 'note', 'email']];
      ['Orlan Veera Zhivaji', 'Brisa Kellow', 'Tavi A Ostrel', 'Pelor Wanes', 'Jorv Renaviker', 'Mohammad Quill Ansari', 'Zorbit Sosa', 'Avi Kumar', 'Dev Amit Sharma', 'Dev Amit Verma', 'Mohd Ali Khan']
        .concat(['Orlan Zhivaji', 'Brisa P Kellow', 'Tavi Ostrel', 'Pelor Wanes Pnl', 'Jorv Renavikar', 'Mohmmad Quill Anasair', 'Zorbit S 1 Account', 'G Kumar', 'Dev Amit', 'Rina Exitt', 'Nobody Atall', 'Mohd Ali Abdul Gaffar'])
        .forEach(function (n) { aliasRows.push(['Pune', 'S1', n, '', '', '', '', false, '', '']); });
      const aliasWorld = rmSyncTestWorld_({ people: aliasPeople, tabRows: aliasRows });
      const aliasHr = parseHrRosterGs_(readHrRosterValuesGs_());
      const aliasPlan = computeRmHierarchySyncPlanGs_(aliasHr, readRmHierarchyRowsGs_(aliasWorld.tab), readManagerDirectoryRowsGs_(aliasWorld.dir));
      TestAssertEqual_(aliasPlan.aliases.map(function (a) { return a.name + ' -> ' + a.matchedName; }).sort(), [
        'Brisa P Kellow -> Brisa Kellow', 'Jorv Renavikar -> Jorv Renaviker', 'Mohmmad Quill Anasair -> Mohammad Quill Ansari', 'Orlan Zhivaji -> Orlan Veera Zhivaji',
        'Pelor Wanes Pnl -> Pelor Wanes', 'Tavi Ostrel -> Tavi A Ostrel', 'Zorbit S 1 Account -> Zorbit Sosa',
      ], 'plan: seven kinds of old spelling are recognised as the one current person they match');
      TestAssertEqual_(aliasPlan.aliases.filter(function (a) { return a.name === 'Orlan Zhivaji'; })[0].matchedCode, aliasHr.people['orlan veera zhivaji'].code, 'plan: an old spelling carries the employee code of the person it matches');
      TestAssertEqual_(rmSyncTestNames_(aliasPlan.leavers).sort(), ['Dev Amit', 'G Kumar', 'Mohd Ali Abdul Gaffar', 'Nobody Atall', 'Rina Exitt'],
        'plan: a name that matches nobody, matches two people, matches only an exited person or only shares a first name stays a possible leaver');
      TestAssertEqual_(aliasPlan.leavers.filter(function (l) { return l.name === 'Dev Amit'; })[0].similar, ['Dev Amit Sharma', 'Dev Amit Verma'], 'plan: an ambiguous name lists the similar names so a person can decide');
      TestAssertEqual_([aliasPlan.fixes.length, aliasPlan.needsHuman.length, aliasPlan.newJoiners.length], [0, 0, 0], 'plan: recognising old spellings changes nothing else');

      const before = TestGmailLog_.sent.length;
      runRmHierarchySyncGs_({ now: RMSYNC_TEST_THU_ });
      const aliasMail = TestGmailLog_.sent[before];
      TestAssertContains_(aliasMail.body, 'OLD SPELLINGS OF CURRENT STAFF', 'report: old spellings have their own section');
      TestAssertContains_(aliasMail.body, 'Orlan Zhivaji (Pune, S1): old spelling of Orlan Veera Zhivaji (H', 'report: the line names the person it matches and their code');
      const leaverPart = aliasMail.body.slice(aliasMail.body.indexOf('POSSIBLE LEAVERS'), aliasMail.body.indexOf('OLD SPELLINGS OF CURRENT STAFF'));
      TestAssert_(leaverPart.indexOf('Brisa P Kellow') === -1 && leaverPart.indexOf('Zorbit S 1 Account') === -1 && leaverPart.indexOf('Nobody Atall') !== -1, 'report: an old spelling is not under possible leavers, a real leaver is');
      TestAssertContains_(leaverPart, 'similar name in the HR sheet: Dev Amit Sharma, Dev Amit Verma', 'report: an ambiguous leaver shows the similar names');
      TestAssertContains_(aliasMail.subject, '5 for a person to look at', 'report: only the 5 leavers count as work; the 7 old spellings are information');
      TestAssertEqual_(Object.keys(rmSyncTestState_().items).length, 12, 'report: the 12 listed items are remembered');
      runRmHierarchySyncGs_({ now: RMSYNC_TEST_FRI_ });
      TestAssertEqual_(TestGmailLog_.sent.length, before + 1, 'report: the next night nothing is new, so nothing is sent');
      TestAssertOnlyTestEmails_();
    }
    // ================= Pinned user-confirmed changes + applyRmHierarchyReassignmentsGs_ (2026-10-19) =================
    {
      const A1 = 'Test A1 Pune', RH = 'Test RH Pune', CH = 'Test CH Pune', TM = 'Test TM Pune';
      // HR Live still shows the OLD picture: Pin S1 One under the departed TM, Pin S1 Two under Test TM Pune, the leaver still current staff.
      const pinPeople = function () {
        return rmSyncTestPeople_().concat([
          { name: 'Pin Old TM', role: 'TM', team: 'Pune', chain: [RH, CH] },
          { name: 'Pin S1 One', role: 'S1', team: 'Pune', chain: ['Pin Old TM', CH] },
          { name: 'Pin S1 Two', role: 'S1', team: 'Pune', chain: [TM] },
        ]);
      };
      // Our tab already holds the user-confirmed values; the leaver's row is gone.
      const pinTab = function () {
        return rmSyncTestTabRows_().concat([
          ['Pune', 'S1', 'Pin S1 One', A1, '', RH, CH, false, '', ''],
          ['Pune', 'S1', 'Pin S1 Two', '', 'Pin New TM', '', '', false, '', ''],
        ]);
      };
      const pins = [
        { name: 'Pin S1 One', set: { tl: A1, tm: '', rh: RH, ch: CH }, was: ['Pin Old TM'], since: '2026-10-19', why: 'TM left' },
        { name: 'Pin S1 Two', set: { tl: '', tm: 'Pin New TM', rh: '', ch: '' }, was: [TM], since: '2026-10-19' },
        { name: 'Pin Old TM', leaver: true, since: '2026-10-19', why: 'left' },
      ];
      const hrRow = function (world, name) { return world.hrSheet._data.filter(function (r) { return r[1] === name; })[0]; };
      const backups = function () {
        const root = DriveApp._folders[ARCHIVE_ROOT_FOLDER_];
        return root && root._folders['RM_Hierarchy_sync_backup'] ? root._folders['RM_Hierarchy_sync_backup']._filesList : [];
      };

      // The plan: without pins the sync would revert / re-add; with pins it does neither.
      {
        const world = rmSyncTestWorld_({ people: pinPeople(), tabRows: pinTab() });
        const hr = parseHrRosterGs_(readHrRosterValuesGs_());
        const rows = readRmHierarchyRowsGs_(world.tab);
        const bare = computeRmHierarchySyncPlanGs_(hr, rows, readManagerDirectoryRowsGs_(world.dir));
        TestAssert_(bare.fixes.some(function (f) { return f.name === 'Pin S1 Two' && f.newValue === TM; }), 'pins: (control) without a pin the sync would revert Pin S1 Two to HR\'s old TM');
        TestAssert_(rmSyncTestNames_(bare.newJoiners).indexOf('Pin Old TM') !== -1, 'pins: (control) without a pin the departed TM would be re-added as a new joiner');
        const plan = computeRmHierarchySyncPlanGs_(hr, rows, readManagerDirectoryRowsGs_(world.dir), { pins: pins, pinsDone: {} });
        TestAssert_(plan.fixes.concat(plan.needsHuman).every(function (x) { return x.name !== 'Pin S1 One' && x.name !== 'Pin S1 Two'; }), 'pins: a pending pinned row gets no fix and no "needs a person" item');
        TestAssert_(rmSyncTestNames_(plan.newJoiners).concat(rmSyncTestNames_(plan.newJoinersLow)).indexOf('Pin Old TM') === -1, 'pins: a pinned leaver is never re-added');
        TestAssert_(plan.directoryAdds.every(function (d) { return d.name !== 'Pin Old TM'; }), 'pins: a pinned leaver is never added to Manager_Directory');
        TestAssertEqual_(rmSyncTestNames_(plan.pinPending), ['Pin S1 One', 'Pin S1 Two', 'Pin Old TM'], 'pins: all three are pending while HR Live shows the old picture');
        TestAssertEqual_(plan.pinResolved, [], 'pins: nothing matches HR yet');
        // A confirmed leaver (RMSYNC_CONFIRMED_LEAVERS_) is never re-added either, even without a pin.
        const sanketWorld = rmSyncTestWorld_({ people: rmSyncTestPeople_().concat([{ name: 'Sanket Yadav', role: 'TM', team: 'Pune', chain: [RH, CH] }]) });
        const sanketPlan = computeRmHierarchySyncPlanGs_(parseHrRosterGs_(readHrRosterValuesGs_()), readRmHierarchyRowsGs_(sanketWorld.tab), null);
        TestAssert_(rmSyncTestNames_(sanketPlan.newJoiners).indexOf('Sanket Yadav') === -1, 'pins: a confirmed leaver still current in HR Live is not re-added as a new joiner');
      }

      // The nightly run in APPLY mode: pins respected, PENDING section every night, then "now matches HR" once, then silence.
      {
        const world = rmSyncTestWorld_({ people: pinPeople(), tabRows: pinTab() });
        rmSyncPinnedOverridesGs_ = function () { return pins; };
        try {
          rmSyncTestSetApply_(true);
          const n0 = TestGmailLog_.sent.length;
          const res = runRmHierarchySyncGs_({ now: RMSYNC_TEST_THU_ });
          TestAssertEqual_(res.mode, 'APPLIED', 'pins apply: the night really applied');
          TestAssertEqual_(rmSyncTestRow_(world.tab, 'Pin S1 Two').tm, 'Pin New TM', 'pins apply: APPLY mode does NOT revert a pinned change to HR\'s old manager');
          TestAssertEqual_([rmSyncTestRow_(world.tab, 'Pin S1 One').tl, rmSyncTestRow_(world.tab, 'Pin S1 One').rh], [A1, RH], 'pins apply: the other pinned row is untouched');
          TestAssert_(rmSyncTestTabNames_(world.tab).indexOf('Pin Old TM') === -1, 'pins apply: the pinned leaver is not re-added');
          const mail1 = TestGmailLog_.sent[n0];
          TestAssertContains_(mail1.body, 'PENDING IN HR LIVE', 'pins report: the pending section is in the email');
          TestAssertContains_(mail1.body, 'Pin S1 Two (Pune, S1): ours TM Pin New TM', 'pins report: our value is shown');
          TestAssertContains_(mail1.body, 'HR Live still lists Test TM Pune', 'pins report: HR\'s current value is shown');
          TestAssertContains_(mail1.body, 'Pin Old TM: ours LEFT', 'pins report: the leaver is listed');
          TestAssertContains_(mail1.body, 'the manager of 1: Pin S1 One', 'pins report: the leaver line says who HR still has under them');
          TestAssertContains_(mail1.subject, '3 pending in HR Live', 'pins report: the subject counts the pending pins');

          // Night 2: nothing else is new, yet the email still goes, with the pending section again.
          runRmHierarchySyncGs_({ now: RMSYNC_TEST_FRI_ });
          TestAssertEqual_(TestGmailLog_.sent.length, n0 + 2, 'pins report: sent again the next night although nothing else is new');
          const mail2 = TestGmailLog_.sent[n0 + 1];
          TestAssertContains_(mail2.body, 'PENDING IN HR LIVE', 'pins report: the pending section repeats every night (not silenced by the "already reported" state)');
          TestAssert_(mail2.body.indexOf('NOW MATCHES HR') === -1, 'pins report: nothing is reported as matching yet');

          // HR Live catches up: the new managers in the chains, the leaver given an Exit date and nobody under him.
          const one = hrRow(world, 'Pin S1 One'); one[6] = A1; one[8] = RH; one[10] = CH; one[12] = '-';
          const two = hrRow(world, 'Pin S1 Two'); two[6] = 'Pin New TM';
          hrRow(world, 'Pin Old TM')[17] = '2026-10-19';
          runRmHierarchySyncGs_({ now: new Date('2026-10-10T17:45:00Z') });
          TestAssertEqual_(TestGmailLog_.sent.length, n0 + 3, 'pins report: the night HR matches, an email goes');
          const mail3 = TestGmailLog_.sent[n0 + 2];
          TestAssertContains_(mail3.body, 'NOW MATCHES HR', 'pins report: the catch-up is reported');
          TestAssert_(mail3.body.indexOf('PENDING IN HR LIVE') === -1, 'pins report: nothing is pending any more');
          ['Pin S1 One', 'Pin S1 Two', 'Pin Old TM'].forEach(function (n) { TestAssertContains_(mail3.body, '  * ' + n, 'pins report: ' + n + ' is listed as matching'); });
          TestAssertEqual_(Object.keys(rmSyncTestState_().pinsDone).length, 3, 'pins state: the three matched pins are remembered');

          // Night 4: reported once only - nothing new, nothing sent; the pins are inert.
          runRmHierarchySyncGs_({ now: new Date('2026-10-11T17:45:00Z') });
          TestAssertEqual_(TestGmailLog_.sent.length, n0 + 3, 'pins report: "now matches HR" is reported once, then the pin stops being listed');
          TestAssertOnlyTestEmails_();
        } finally {
          rmSyncPinnedOverridesGs_ = function () { return []; };
        }
      }

      // applyRmHierarchyReassignmentsGs_: backup, exact match, idempotent, directory only reported.
      {
        const tab = rmSyncTestTabRows_().concat([
          ['Pune', 'S1', 'pin  s1 ONE', '', 'Pin Old TM', '', CH, false, 'old note', ''],
          ['Pune', 'S1', 'Pin S1 One Extra', '', 'Pin Old TM', '', CH, false, '', ''], // a near name: untouched
          ['Pune', 'S1', 'Pin S1 Two', '', 'Pin New TM', '', '', false, '', ''], // already as confirmed
        ]);
        const pinsPlus = pins.concat([{ name: 'Pin Nobody', set: { tl: A1, tm: '', rh: '', ch: '' } }]);
        const world = rmSyncTestWorld_({ tabRows: tab });
        const res = applyRmHierarchyReassignmentsGs_(pinsPlus, { now: RMSYNC_TEST_THU_ });
        TestAssertEqual_(res.changed, ['pin  s1 ONE'], 'reassign: the exact (case/space-normalised) match is changed');
        TestAssertEqual_(res.already, ['Pin S1 Two'], 'reassign: a row already as confirmed is left alone');
        TestAssertEqual_(res.notFound, ['Pin Nobody'], 'reassign: a name not in the tab is reported');
        const r = rmSyncTestRow_(world.tab, 'pin  s1 ONE');
        TestAssertEqual_([r.tl, r.tm, r.rh, r.ch], [A1, '', RH, CH], 'reassign: tl/tm/rh/ch are set exactly');
        TestAssertContains_(r.note, 'old note | reassigned 2026-10-08 (user-confirmed): tl (blank) -> Test A1 Pune, tm Pin Old TM -> (blank), rh (blank) -> Test RH Pune', 'reassign: the note is appended with what changed');
        TestAssertEqual_(rmSyncTestRow_(world.tab, 'Pin S1 One Extra').tm, 'Pin Old TM', 'reassign: a near-name row is untouched');
        TestAssertEqual_(backups().length, 1, 'reassign: the tab is backed up to Drive first');
        TestAssertContains_(backups()[0]._content, 'Pin Old TM', 'reassign: the backup holds the old values');
        TestAssertEqual_(res.problems, [], 'reassign: read-back is clean');
        TestAssert_(res.directoryNotes.indexOf('Test A1 Pune has no Manager_Directory row') !== -1 && res.directoryNotes.indexOf('Test CH Pune has a Manager_Directory row with no email') !== -1, 'reassign: Manager_Directory gaps are reported');
        const dirBefore = JSON.stringify(world.dir._data);
        const snapshot = JSON.stringify(world.tab._data);
        const again = applyRmHierarchyReassignmentsGs_(pinsPlus, { now: RMSYNC_TEST_THU_ });
        TestAssertEqual_(again.changed, [], 'reassign: a re-run changes nothing');
        TestAssertEqual_(JSON.stringify(world.tab._data), snapshot, 'reassign: a re-run writes nothing');
        TestAssertEqual_(backups().length, 1, 'reassign: a re-run makes no new backup');
        TestAssertEqual_(JSON.stringify(world.dir._data), dirBefore, 'reassign: Manager_Directory is never changed');
      }
      // TEST MODE: says what it would change, writes nothing.
      {
        const world = rmSyncTestWorld_({ tabRows: rmSyncTestTabRows_().concat([['Pune', 'S1', 'Pin S1 One', '', 'Pin Old TM', '', CH, false, '', '']]) });
        const snapshot = JSON.stringify(world.tab._data);
        TEST_MODE_OVERRIDE_EMAIL_ = TEST_EMAIL_PRIMARY_;
        let res;
        try { res = applyRmHierarchyReassignmentsGs_(pins, { now: RMSYNC_TEST_THU_ }); } finally { TEST_MODE_OVERRIDE_EMAIL_ = ''; }
        TestAssertEqual_(res.wouldChange.length, 1, 'reassign test mode: lists the row it would change');
        TestAssertEqual_(res.changed, [], 'reassign test mode: changes nothing');
        TestAssertEqual_(JSON.stringify(world.tab._data), snapshot, 'reassign test mode: the tab is unchanged');
        TestAssertEqual_(backups().length, 0, 'reassign test mode: no backup is written');
      }

      // The real 2026-10-19 case: Sanket Yadav's three S1s, pinned with exactly the RM_HIERARCHY_RAW_ values, and Sanket as a leaver.
      {
        const real = realPins();
        const byName = {};
        real.forEach(function (p) { byName[p.name] = p; });
        TestAssertEqual_(Object.keys(byName).sort(), ['Mohit Manwani', 'Riyan Jamadar', 'Sanket Yadav', 'Tisha Valecha'], 'real pins: the 2026-10-19 entries');
        TestAssert_(byName['Sanket Yadav'].leaver === true, 'real pins: Sanket Yadav is a pinned leaver');
        const raw = {};
        RM_HIERARCHY_RAW_.forEach(function (r) { raw[normPersonName_(r[2])] = r; });
        TestAssert_(!raw['sanket yadav'], 'real pins: Sanket Yadav is gone from RM_HIERARCHY_RAW_');
        TestAssertEqual_(raw['mohit manwani'], ['Thane', 'S1', 'Mohit Manwani', 'Ganesh Saroj', '', 'Swapnil Gowalkar', 'Bipin More'], 'real pins: Mohit Manwani reports to A1 Ganesh Saroj in RM_HIERARCHY_RAW_');
        ['Riyan Jamadar', 'Tisha Valecha'].forEach(function (n) {
          TestAssertEqual_(raw[normPersonName_(n)], ['Thane', 'S1', n, 'Mayuresh Jadhav', '', '', 'Bipin More'], 'real pins: ' + n + ' reports to A1 Mayuresh Jadhav in RM_HIERARCHY_RAW_');
        });
        ['Mohit Manwani', 'Riyan Jamadar', 'Tisha Valecha'].forEach(function (n) {
          const r = raw[normPersonName_(n)];
          TestAssertEqual_([byName[n].set.tl, byName[n].set.tm, byName[n].set.rh, byName[n].set.ch], [r[3], r[4], r[5], r[6]], 'real pins: ' + n + '\'s pin equals the RM_HIERARCHY_RAW_ row');
          TestAssertEqual_(byName[n].was, ['Sanket Yadav'], 'real pins: ' + n + ' was under Sanket Yadav');
        });
        TestAssert_(RM_HIERARCHY_RAW_.every(function (r) { return [r[3], r[4], r[5], r[6]].every(function (v) { return normPersonName_(v) !== 'sanket yadav'; }); }), 'real pins: nobody in RM_HIERARCHY_RAW_ still reports to Sanket Yadav');

        // The real functions on a mock tab: reassign the three, then remove Sanket (refused while he has an open lead).
        const tab = rmSyncTestTabRows_().concat([
          ['Thane', 'S1', 'Mohit Manwani', '', 'Sanket Yadav', '', 'Bipin More', false, '', ''],
          ['Thane', 'TM', 'Sanket Yadav', '', '', '', 'Bipin More', false, '', ''],
          ['Thane', 'S1', 'Riyan Jamadar', '', 'Sanket Yadav', '', 'Bipin More', false, '', ''],
          ['Thane', 'S1', 'Tisha Valecha', '', 'Sanket Yadav', '', 'Bipin More', false, '', ''],
        ]);
        const world = rmSyncTestWorld_({ tabRows: tab });
        world.ss._sheets['leads'] = TestMockSheet_('leads', [['banner'], ['lead_id', 'RM', 'current_stage', 'closing_reason', 'lead_closing_reason'], ['L-SY-1', 'Sanket Yadav', 'Suspect', '', '']]);
        const resA = applyRmHierarchyReassignmentsGs_(real, { now: RMSYNC_TEST_THU_ });
        TestAssertEqual_(resA.changed, ['Mohit Manwani', 'Riyan Jamadar', 'Tisha Valecha'], 'real reassign: exactly the three S1s change');
        TestAssertEqual_(['Mohit Manwani', 'Riyan Jamadar', 'Tisha Valecha'].map(function (n) { const r = rmSyncTestRow_(world.tab, n); return [r.tl, r.tm, r.rh, r.ch].join('/'); }),
          ['Ganesh Saroj//Swapnil Gowalkar/Bipin More', 'Mayuresh Jadhav///Bipin More', 'Mayuresh Jadhav///Bipin More'], 'real reassign: the confirmed managers are on the live rows');
        const blocked = removeRmHierarchyLeaversGs_(RMSYNC_CONFIRMED_LEAVERS_, { now: RMSYNC_TEST_THU_ });
        TestAssertEqual_(blocked.blocked.map(function (b) { return b.name + ':' + b.leadIds.join(','); }), ['Sanket Yadav:L-SY-1'], 'real leaver: Sanket Yadav is refused while he has an open lead, and the lead is listed');
        TestAssert_(rmSyncTestTabNames_(world.tab).indexOf('Sanket Yadav') !== -1, 'real leaver: ... and stays in the tab');
        TestAssertEqual_(blocked.managerRefs, [], 'real leaver: after the reassignment nobody names him as a manager');
        world.ss._sheets['leads'] = TestMockSheet_('leads', [['banner'], ['lead_id', 'RM', 'current_stage', 'closing_reason', 'lead_closing_reason'], ['L-SY-1', 'Sanket Yadav', 'Won', '', '']]);
        const removed = removeRmHierarchyLeaversGs_(RMSYNC_CONFIRMED_LEAVERS_, { now: RMSYNC_TEST_THU_ });
        TestAssertEqual_(removed.removed, ['Sanket Yadav'], 'real leaver: removed once no open lead is left');
        TestAssert_(rmSyncTestTabNames_(world.tab).indexOf('Sanket Yadav') === -1, 'real leaver: gone from the tab');
      }
    }
    // ================= removeRmHierarchyLeaversGs_ (2026-10-16) =================
    {
      const leaverTab = function () {
        return rmSyncTestTabRows_().concat([
          ['Navi Mumbai', 'S1', 'Test Leaver One', '', '', '', 'Test CH Pune', false, '', ''],
          ['Harbour', 'S1', 'Test  leaver TWO', 'Test A1 Pune', '', '', 'Test CH Pune', false, '', ''], // odd case/spacing still matches
          ['Harbour', 'S1', 'Test Leaver Two Extra', 'Test A1 Pune', '', '', 'Test CH Pune', false, '', ''], // only a near name: kept
          ['Harbour', 'S1', 'Test Leaver P Two', 'Test A1 Pune', '', '', 'Test CH Pune', false, '', ''],
        ]);
      };
      const names = ['Test Leaver One', 'Test Leaver Two', 'Test Leaver P Two'];
      const leadsTab = function (rows) {
        return TestMockSheet_('leads', [['banner'], ['lead_id', 'RM', 'current_stage', 'closing_reason', 'lead_closing_reason']].concat(rows || []));
      };
      const backups = function () {
        const root = DriveApp._folders[ARCHIVE_ROOT_FOLDER_];
        return root && root._folders['RM_Hierarchy_sync_backup'] ? root._folders['RM_Hierarchy_sync_backup']._filesList : [];
      };
      const others = ['Test CH Pune', 'Test RH Pune', 'Test TM Pune', 'Test A1 Pune', 'Test S1 Steady', 'Test Leaver Two Extra'];

      // Clean removal: exact (normalised) matches go, everyone else stays, backup taken first, state forgotten.
      {
        const world = rmSyncTestWorld_({ tabRows: leaverTab() });
        world.ss._sheets['leads'] = leadsTab([
          ['L-1', 'Test Leaver One', 'Won', '', ''], // closed: does not block
          ['L-2', 'Test Steady', 'Suspect', '', ''],
        ]);
        PropertiesService.getScriptProperties().setProperty(RMSYNC_STATE_PROPERTY_, JSON.stringify({ items: (function () {
          const items = {}; items[rmSyncHashGs_('L|test leaver one')] = 1; items[rmSyncHashGs_('L|test steady other')] = 1; items[rmSyncHashGs_('A|test leaver p two|test leaver two')] = 1; return items;
        })(), lastReminderDay: '', appliedEver: true }));
        const before = rmSyncTestTabNames_(world.tab).length;
        const res = removeRmHierarchyLeaversGs_(names, { now: RMSYNC_TEST_THU_ });
        TestAssertEqual_(res.removed, ['Test Leaver One', 'Test  leaver TWO', 'Test Leaver P Two'], 'leavers: every exact (case/space-normalised) match is removed');
        const after = rmSyncTestTabNames_(world.tab);
        TestAssertEqual_(after.length, before - 3, 'leavers: exactly three rows are gone');
        others.forEach(function (n) { TestAssert_(after.indexOf(n) !== -1, 'leavers: ' + n + ' is untouched'); });
        TestAssertEqual_(rmSyncTestRow_(world.tab, 'Test Leaver Two Extra').tl, 'Test A1 Pune', 'leavers: a near-name row keeps its data (rows below a deleted one are not shifted wrongly)');
        TestAssertEqual_(backups().length, 1, 'leavers: RM_Hierarchy is backed up to Drive');
        TestAssertContains_(backups()[0]._content, 'Test Leaver P Two', 'leavers: the backup was taken BEFORE the rows were removed');
        TestAssert_(!!res.backupUrl, 'leavers: the backup url is returned');
        const state = rmSyncTestState_();
        TestAssert_(!state.items[rmSyncHashGs_('L|test leaver one')] && !state.items[rmSyncHashGs_('A|test leaver p two|test leaver two')], 'leavers: the sync forgets the removed people');
        TestAssert_(!!state.items[rmSyncHashGs_('L|test steady other')] && state.appliedEver === true, 'leavers: everything else in the sync state is kept');

        // Idempotent: a second run finds nothing, writes nothing, makes no second backup.
        const snapshot = JSON.stringify(world.tab._data);
        const again = removeRmHierarchyLeaversGs_(names, { now: RMSYNC_TEST_THU_ });
        TestAssertEqual_(again.removed, [], 'leavers: a re-run removes nothing');
        TestAssertEqual_(again.notFound.slice().sort(), names.slice().sort(), 'leavers: a re-run reports every name as already gone');
        TestAssertEqual_(JSON.stringify(world.tab._data), snapshot, 'leavers: a re-run writes nothing');
        TestAssertEqual_(backups().length, 1, 'leavers: a re-run makes no new backup');

        // The nightly plan no longer lists them (they are simply not in the tab any more).
        const plan = computeRmHierarchySyncPlanGs_(parseHrRosterGs_(readHrRosterValuesGs_()), readRmHierarchyRowsGs_(world.tab), null);
        TestAssert_(rmSyncTestNames_(plan.leavers).every(function (n) { return names.map(normPersonName_).indexOf(normPersonName_(n)) === -1; }), 'leavers: the nightly plan no longer lists the removed people');
      }

      // Open leads: that person is refused (lead ids returned), the others still go; force removes them too.
      {
        const world = rmSyncTestWorld_({ tabRows: leaverTab() });
        world.ss._sheets['leads'] = leadsTab([
          ['L-OPEN-1', 'Test Leaver One', 'Suspect', '', ''],
          ['L-OPEN-2', ' test leaver one ', 'Suspect', '', ''],
          ['L-CLOSED', 'Test Leaver One', '', 'Not interested', ''],
          ['L-OTHER', 'Test Leaver Two Extra', 'Suspect', '', ''], // a near name's leads never block anyone
        ]);
        const res = removeRmHierarchyLeaversGs_(names, { now: RMSYNC_TEST_THU_ });
        TestAssertEqual_(res.blocked.map(function (b) { return b.name + ':' + b.leadIds.join(','); }), ['Test Leaver One:L-OPEN-1,L-OPEN-2'], 'leavers: a person with open leads is refused and the open lead ids are listed (closed ones are not)');
        TestAssertEqual_(res.removed, ['Test  leaver TWO', 'Test Leaver P Two'], 'leavers: the people without open leads are still removed');
        TestAssert_(rmSyncTestTabNames_(world.tab).indexOf('Test Leaver One') !== -1, 'leavers: the refused person stays in the tab');
        const forced = removeRmHierarchyLeaversGs_(names, { force: true, now: RMSYNC_TEST_THU_ });
        TestAssertEqual_(forced.removed, ['Test Leaver One'], 'leavers: force removes the person despite open leads');
        TestAssertEqual_(forced.blocked, [], 'leavers: nobody is refused when forced');
        TestAssert_(rmSyncTestTabNames_(world.tab).indexOf('Test Leaver One') === -1, 'leavers: forced removal really deletes the row');
      }

      // No leads tab: refuses (nothing written) unless forced.
      {
        const world = rmSyncTestWorld_({ tabRows: leaverTab() });
        const snapshot = JSON.stringify(world.tab._data);
        TestAssertThrows_(function () { removeRmHierarchyLeaversGs_(names, { now: RMSYNC_TEST_THU_ }); }, 'leavers: a missing leads tab stops the removal');
        TestAssertEqual_(JSON.stringify(world.tab._data), snapshot, 'leavers: ... and nothing was written');
      }

      // Side reports: a row naming a leaver as manager, and a Manager_Directory row, are reported but not changed.
      {
        const tab = leaverTab();
        tab.push(['Pune', 'S1', 'Test Reports To Leaver', 'Test Leaver One', '', '', '', false, '', '']);
        const dirRows = rmSyncTestDirRows_().concat([['Test Leaver One', 'TL', 'Navi Mumbai', '', 0, '']]);
        const world = rmSyncTestWorld_({ tabRows: tab, dirRows: dirRows });
        world.ss._sheets['leads'] = leadsTab([]);
        const dirBefore = JSON.stringify(world.dir._data);
        const res = removeRmHierarchyLeaversGs_(names, { now: RMSYNC_TEST_THU_ });
        TestAssertEqual_(res.managerRefs, ['Test Reports To Leaver has TL = Test Leaver One'], 'leavers: a row still naming a leaver as manager is reported');
        TestAssertEqual_(res.directoryRows.length, 1, 'leavers: a Manager_Directory row for a leaver is reported');
        TestAssertEqual_(JSON.stringify(world.dir._data), dirBefore, 'leavers: Manager_Directory is never changed');
        TestAssertEqual_(rmSyncTestRow_(world.tab, 'Test Reports To Leaver').tl, 'Test Leaver One', 'leavers: the reporting row is not changed');
      }

      // TEST MODE: says what it would remove, writes nothing (no tab change, no backup, no state).
      {
        const world = rmSyncTestWorld_({ tabRows: leaverTab() });
        world.ss._sheets['leads'] = leadsTab([]);
        const snapshot = JSON.stringify(world.tab._data);
        TEST_MODE_OVERRIDE_EMAIL_ = TEST_EMAIL_PRIMARY_;
        let res;
        try { res = removeRmHierarchyLeaversGs_(names, { now: RMSYNC_TEST_THU_ }); } finally { TEST_MODE_OVERRIDE_EMAIL_ = ''; }
        TestAssertEqual_(res.wouldRemove.length, 3, 'leavers test mode: lists the three rows it would remove');
        TestAssertEqual_(res.removed, [], 'leavers test mode: removes nothing');
        TestAssertEqual_(JSON.stringify(world.tab._data), snapshot, 'leavers test mode: the tab is unchanged');
        TestAssertEqual_(backups().length, 0, 'leavers test mode: no backup is written');
        TestAssertEqual_(rmSyncTestState_(), null, 'leavers test mode: no state is saved');
      }

      TestAssertEqual_(RMSYNC_CONFIRMED_LEAVERS_, ['Jitendra Phulwaria', 'Atharva Belose', 'Atharva P Belose', 'Sanket Yadav'], 'leavers: the 2026-10-16 confirmed list + Sanket Yadav (2026-10-19)');
      const rawNames = RM_HIERARCHY_RAW_.map(function (r) { return normPersonName_(r[2]); });
      RMSYNC_CONFIRMED_LEAVERS_.forEach(function (n) { TestAssert_(rawNames.indexOf(normPersonName_(n)) === -1, 'leavers: ' + n + ' is gone from RM_HIERARCHY_RAW_ too (a rebuild cannot restore them)'); });
    }

    TestAssertOnlyTestEmails_();
  } finally {
    lookupEmployeeEmail_ = realLookup;
    rmSyncPinnedOverridesGs_ = realPins;
    DriveApp = realDrive;
    TEST_MODE_OVERRIDE_EMAIL_ = '';
    TestEnv_tearDown_();
  }
  return TestResults_;
}

function runRmHierarchySyncTestsNow() { runRmHierarchySyncTests_(); }
