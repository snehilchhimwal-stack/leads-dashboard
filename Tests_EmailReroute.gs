/**
 * Tests: EmailReroute.gs - bounce escalation (Email Ops EO-13, decision D9: a bounced email, and that bucket's follow-ups, go to the person next in the hierarchy; to the ops
 * address when nobody is above). Run runEmailRerouteTestsNow() from the function dropdown, or via runAllTests() (Tests_RunAll.gs). Everything is in-memory: sheets, Gmail,
 * Properties and triggers are fakes (Tests_Mocks.gs); nothing is sent for real, and every captured send goes to one of the three allowed test addresses.
 *
 * Layers: the pure rules (the table, the chain, the translation, the banner, who is next, the re-send window), the table on a sheet, the redirect inside the real senders,
 * then the real sweep against a ledger with a bounce - complete first, then damaged one piece at a time - and finally the reports that read the outcome.
 */

// ---- fixtures ----

// The org used by the end-to-end blocks: Dead Dan (A1) reports to Boss Bea (TM) who reports to Top Tia (City Lead). Addresses are the three allowed test addresses:
// Dead Dan = the CH test address, Boss Bea = the secondary, Top Tia = the primary (which is also the ops address during tests).
function TestRR_hierarchy_(extra) {
  const byRm = {
    'dead dan': { role: 'A1', tl: '', tm: 'Boss Bea', rh: '', ch: 'Top Tia', excluded: false },
    'boss bea': { role: 'TM', tl: '', tm: '', rh: '', ch: 'Top Tia', excluded: false },
    'top tia': { role: 'City Lead', tl: '', tm: '', rh: '', ch: '', excluded: false },
  };
  const dir = { 'dead dan': TEST_EMAIL_CH_, 'boss bea': TEST_EMAIL_SECONDARY_, 'top tia': TEST_EMAIL_PRIMARY_ };
  const e = extra || {};
  Object.keys(e.byRm || {}).forEach(function (k) { byRm[k] = e.byRm[k]; });
  Object.keys(e.dir || {}).forEach(function (k) { dir[k] = e.dir[k]; });
  return { byRmNameLower: byRm, emailByManagerNameLower: dir };
}

function TestRR_bind_(ss) {
  SpreadsheetApp.getActiveSpreadsheet = function () { return ss; };
  TestGmailLog_reset_();
  GmailApp = TestMockGmailApp_({});
  Gmail = TestMockGmailAdvanced_({});
  PropertiesService = TestMockPropertiesService_();
  emailRerouteResetCacheGs_();
}

// Installs fake Gmail search / thread / message lookups. messages: { messageId: { subject, html, plain } }.
function TestRR_gmail_(bounces, messages) {
  TestSW_gmail_(bounces, {});
  GmailApp.getMessageById = function (id) {
    const m = messages[id];
    if (!m) throw new Error('simulated: no such message ' + id);
    return { getId: function () { return id; }, getSubject: function () { return m.subject; }, getBody: function () { return m.html; }, getPlainBody: function () { return m.plain; } };
  };
}

// One ACCEPTED ledger row through the real ledger API, finished `minutesAgo` minutes ago. spec: { job, region, bucket, role, to, cc, subject, messageId, minutesAgo }.
function TestRR_ledgerRow_(ss, h, spec) {
  const job = spec.job || 'allIssues17', region = spec.region || 'Pune', role = spec.role || 'A1', day = istDayKeyGs_(new Date());
  const id = emailLedgerIdGs_(job, day, region, role, spec.bucket, job === 'morning10' || job === 'followup13' ? spec.to : '');
  emailLedgerPlanGs_(h, [{ emailId: id, job: job, dayKey: day, region: region, bucketLabel: spec.bucket, primaryRole: role, to: spec.to, cc: spec.cc || '', subject: spec.subject, leadIds: ['L-100'] }]);
  emailLedgerAttemptGs_(h, id);
  emailLedgerResultGs_(h, id, { status: spec.status || 'ACCEPTED', messageId: spec.messageId === undefined ? 'm-' + spec.bucket : spec.messageId, threadId: 'T-' + spec.bucket, leadIds: ['L-100'] });
  const rowNo = h.rowById[id];
  const finished = new Date(Date.now() - (spec.minutesAgo === undefined ? 40 : spec.minutesAgo) * 60000);
  ss.getSheetByName(EMAIL_LEDGER_SHEET_).getRange(rowNo, emailLedgerCol_('finished_at'), 1, 1).setValues([[finished]]);
  return { id: id, rowNo: rowNo, finished: finished };
}

// A delivery-failure message that names `address` and quotes `subject`, three minutes after `after`.
function TestRR_bounce_(after, address, subject) {
  return TestSW_msg_('Mail Delivery Subsystem <mailer-daemon@googlemail.com>', new Date(after.getTime() + 3 * 60000), 'Delivery Status Notification (Failure)',
    'Message to ' + address + ' could not be delivered. Subject: ' + subject);
}

function TestRR_ledgerById_(ss, id) {
  const rows = TestEL_objects_(ss.getSheetByName(EMAIL_LEDGER_SHEET_), EMAIL_LEDGER_HEADERS_);
  return rows.filter(function (r) { return r.email_id === id; })[0] || null;
}

function TestRR_entries_(ss) { const sheet = ss.getSheetByName(EMAIL_REROUTE_SHEET_); return sheet ? TestEL_objects_(sheet, EMAIL_REROUTE_HEADERS_) : []; }

// A table row, as emailRerouteReadEntriesGs_ returns it.
function TestRR_entry_(o) {
  return Object.assign({ created_at: new Date('2026-10-01T10:00:00+05:30'), expires_at: new Date('2026-10-15T10:00:00+05:30'), dead_email: 'dead@x.test', dead_name: 'Dead Dan', new_email: 'boss@x.test', new_name: 'Boss Bea', new_role: 'TM', via: 'hierarchy', source_email_id: 'E1', source_job: 'allIssues17', status: 'ACTIVE', note: '' }, o || {});
}

function runEmailRerouteTests_() {
  TestEnv_setUp_('Tests_EmailReroute', TestMockSpreadsheet_({}));
  const realHierarchy = emailRerouteHierarchyGs_;
  const realWindow = emailRerouteWindowOpenGs_;
  try {
    const DEAD = TEST_EMAIL_CH_, BOSS = TEST_EMAIL_SECONDARY_, TOP = TEST_EMAIL_PRIMARY_;
    const at = function (iso) { return new Date(iso).getTime(); };

    // ================= the table: which rows are in force =================
    {
      const e = TestRR_entry_();
      TestAssertEqual_(emailRerouteIsActiveGs_(e, at('2026-10-05T10:00:00+05:30')), true, 'in force: between created and expires');
      TestAssertEqual_(emailRerouteIsActiveGs_(e, at('2026-10-01T10:00:00+05:30')), true, 'in force: exactly at created_at');
      TestAssertEqual_(emailRerouteIsActiveGs_(e, at('2026-10-01T09:59:59+05:30')), false, 'in force: not before it was created (an email sent before the bounce was not redirected)');
      TestAssertEqual_(emailRerouteIsActiveGs_(e, at('2026-10-15T10:00:00+05:30')), false, 'in force: not at expires_at (the dead address is tried again)');
      TestAssertEqual_(emailRerouteIsActiveGs_(TestRR_entry_({ status: 'ENDED' }), at('2026-10-05T10:00:00+05:30')), false, 'in force: an ENDED row is not');
      TestAssertEqual_(emailRerouteIsActiveGs_(TestRR_entry_({ expires_at: 'not a date' }), at('2026-10-05T10:00:00+05:30')), false, 'in force: a row with a broken date is not (fail-safe)');
      TestAssertEqual_(emailRerouteIsActiveGs_(null, 0), false, 'in force: nothing is not');
      const stale = TestRR_entry_({ new_email: 'old@x.test', created_at: new Date('2026-10-02T10:00:00+05:30') });
      const map = emailRerouteMapGs_([e, stale, TestRR_entry_({ dead_email: 'gone@x.test', status: 'ENDED' }), TestRR_entry_({ dead_email: 'Other@X.test', new_email: '' })], at('2026-10-05T10:00:00+05:30'));
      TestAssertEqual_(Object.keys(map).join(',') + ',' + map['dead@x.test'].new_email, 'dead@x.test,old@x.test', 'map: keyed by the lower-cased dead address, the newest row wins, ended rows and rows without a replacement are left out');
    }

    // ================= the chain =================
    {
      const m = function (rows) { const o = {}; rows.forEach(function (r) { o[r.dead_email.toLowerCase()] = r; }); return o; };
      const a = TestRR_entry_({ dead_email: 'a@x.test', new_email: 'B@x.test' }), b = TestRR_entry_({ dead_email: 'b@x.test', new_email: 'c@x.test', via: 'ops fallback' });
      const r1 = emailRerouteResolveGs_(m([a]), ' A@X.test ');
      TestAssertEqual_(r1.address + ',' + r1.changed, 'B@x.test,true', 'resolve: matched case-insensitively and trimmed; the replacement keeps the case the directory has');
      const r2 = emailRerouteResolveGs_(m([a, b]), 'a@x.test');
      TestAssertEqual_(r2.address + ',' + r2.changed + ',' + r2.viaOps, 'c@x.test,true,true', 'resolve: a replacement that is itself dead is followed to the end, and viaOps says the chain ends at the ops fallback');
      const r3 = emailRerouteResolveGs_(m([a, b]), 'z@x.test');
      TestAssertEqual_(r3.address + ',' + r3.changed, 'z@x.test,false', 'resolve: an address nobody replaced is returned as it is');
      const loop = emailRerouteResolveGs_(m([a, TestRR_entry_({ dead_email: 'b@x.test', new_email: 'a@x.test' })]), 'a@x.test');
      TestAssertEqual_(loop.address + ',' + loop.changed, 'a@x.test,false', 'resolve: a loop falls back to the original address');
      const longRows = [];
      for (let i = 0; i < 8; i++) longRows.push(TestRR_entry_({ dead_email: 'p' + i + '@x.test', new_email: 'p' + (i + 1) + '@x.test' }));
      TestAssertEqual_(emailRerouteResolveGs_(m(longRows), 'p0@x.test').changed, false, 'resolve: a chain longer than ' + EMAIL_REROUTE_MAX_HOPS_ + ' falls back to the original address');
      TestAssertEqual_(emailRerouteResolveGs_(m(longRows.slice(0, 4)), 'p0@x.test').address, 'p4@x.test', 'resolve: a chain within the limit is followed to its end');
      TestAssertEqual_(emailRerouteResolveGs_(m(longRows.slice(0, EMAIL_REROUTE_MAX_HOPS_)), 'p0@x.test').address, 'p' + EMAIL_REROUTE_MAX_HOPS_ + '@x.test', 'resolve: a chain of exactly the limit is still followed');
      TestAssertEqual_(emailRerouteResolveGs_(m(longRows.slice(0, EMAIL_REROUTE_MAX_HOPS_ + 1)), 'p0@x.test').changed, false, 'resolve: one link more than the limit falls back to the original');
    }

    // ================= translating a To/Cc pair =================
    {
      const hier = TestRR_entry_({ dead_email: 'dead@x.test', new_email: 'boss@x.test' }), ops = TestRR_entry_({ dead_email: 'solo@x.test', new_email: 'ops@x.test', via: 'ops fallback' });
      const map = emailRerouteMapGs_([hier, ops], at('2026-10-05T10:00:00+05:30'));
      const t1 = emailRerouteTranslateAddressesGs_('dead@x.test', 'lead@x.test, Dead@X.test', map);
      TestAssertEqual_(t1.to.join('|') + ' / ' + t1.cc.join('|') + ' / ' + t1.changes.map(function (c) { return c.part; }).join('+'), 'boss@x.test / lead@x.test / to+cc', 'translate: a dead To and a dead Cc are both replaced (the replacement of the Cc is the To already, so it is not repeated)');
      const t2 = emailRerouteTranslateAddressesGs_('dead@x.test', 'boss@x.test, lead@x.test', map);
      TestAssertEqual_(t2.to.join('|') + ' / ' + t2.cc.join('|'), 'boss@x.test / lead@x.test', 'translate: the replacement is not repeated in Cc');
      const t3 = emailRerouteTranslateAddressesGs_('ok@x.test', 'solo@x.test, lead@x.test', map);
      TestAssertEqual_(t3.to.join('|') + ' / ' + t3.cc.join('|') + ' / ' + t3.changes.length, 'ok@x.test / lead@x.test / 1', 'translate: a dead Cc whose chain ends at the ops fallback is dropped (the ops address is not added to other people\'s mail)');
      const t4 = emailRerouteTranslateAddressesGs_('solo@x.test', '', map);
      TestAssertEqual_(t4.to.join('|') + ',' + t4.changes[0].part, 'ops@x.test,to', 'translate: a dead To whose chain ends at the ops fallback goes to the ops address');
      const t5 = emailRerouteTranslateAddressesGs_(['dead@x.test', 'ok@x.test'], ['dead@x.test'], map);
      TestAssertEqual_(t5.to.join('|') + ' / ' + t5.cc.join('|'), 'boss@x.test|ok@x.test / ', 'translate: arrays work, only the dead one of two To addresses is replaced, a Cc already in To disappears');
      const t6 = emailRerouteTranslateAddressesGs_('ok@x.test', 'lead@x.test', map);
      TestAssertEqual_(t6.changes.length + ',' + t6.to.join('|') + ',' + t6.cc.join('|'), '0,ok@x.test,lead@x.test', 'translate: nothing dead, nothing changed');
      const t7 = emailRerouteTranslateAddressesGs_('a@x.test, a@x.test', 'b@x.test, B@x.test', map);
      TestAssertEqual_(t7.to.join('|') + '/' + t7.cc.join('|'), 'a@x.test/b@x.test', 'translate: repeated addresses are collapsed');
      TestAssertEqual_(emailRerouteSplitGs_('a@x.test; b@x.test,, ').join('|'), 'a@x.test|b@x.test', 'split: commas and semicolons, blanks dropped');
    }

    // ================= the banner and the ledger note =================
    {
      const change = { dead: 'dead@x.test', final: 'boss@x.test', part: 'to', entry: TestRR_entry_() };
      const b = emailRerouteBannerGs_([change]);
      TestAssertContains_(b.html, 'Re-routed to you', 'banner: the html says it was re-routed');
      TestAssertContains_(b.html, 'Dead Dan &lt;dead@x.test&gt;', 'banner: …names whom it was meant for, escaped');
      TestAssertContains_(b.html, 'next person in the hierarchy (TM)', 'banner: …and why it reached the reader (with the role)');
      TestAssertEqual_(b.plain.indexOf('RE-ROUTED TO YOU: ') === 0 && /\n\n$/.test(b.plain), true, 'banner: the plain text opens with the same notice and ends with a blank line');
      const o = emailRerouteBannerGs_([{ dead: 'solo@x.test', final: 'ops@x.test', part: 'to', entry: TestRR_entry_({ via: 'ops fallback', dead_name: '' }) }]);
      TestAssertContains_(o.plain, 'nobody above that person is on record, so it came to the ops address', 'banner: the ops fallback says nobody is above');
      TestAssertContains_(o.plain, 'addressed to solo@x.test', 'banner: with no name on record the address stands alone');
      const evil = emailRerouteBannerGs_([{ dead: 'd@x.test', final: 'b@x.test', part: 'to', entry: TestRR_entry_({ dead_name: '<script>x</script>' }) }]);
      TestAssert_(evil.html.indexOf('<script>') === -1, 'banner: a name from the sheet cannot inject markup');
      TestAssertEqual_(emailRerouteNoteTextGs_([change, { dead: 'c@x.test', final: 'd@x.test', part: 'cc', entry: null }, { dead: 'e@x.test', final: '', part: 'cc', entry: null }]),
        're-routed to boss@x.test (the bounced dead@x.test); Cc c@x.test replaced by d@x.test; Cc e@x.test dropped (bounced)', 'ledger note: says what was redirected, replaced and dropped');
    }

    // ================= who is next =================
    {
      const data = {
        byRmNameLower: {
          'dan': { role: 'A1', tl: '', tm: 'Tom', rh: 'Rhea', ch: 'Chad' },
          'tom': { role: 'TM', tl: '', tm: '', rh: 'Rhea', ch: 'Chad' },
          'ann': { role: 'A1', tl: 'Nomail Nick', tm: '', rh: 'Rhea', ch: 'Chad' },
          'bob': { role: 'A1', tl: '', tm: 'Dup Dee', rh: '', ch: 'Chad' },
          'rhea': { role: 'RH', tl: '', tm: '', rh: '', ch: 'Chad' },
          'solo': { role: 'A1', tl: '', tm: '', rh: '', ch: '' },
          'chad': { role: 'Cluster Head', tl: '', tm: '', rh: '', ch: '' },
        },
        emailByManagerNameLower: { dan: 'dan@x.test', tom: 'tom@x.test', ann: 'ann@x.test', bob: 'bob@x.test', 'dup dee': 'bob@x.test', rhea: 'rhea@x.test', chad: 'chad@x.test', solo: 'solo@x.test', 'snehil chhimwal': 'ops@x.test' },
      };
      const next = function (addr, hint) { return emailRerouteNextGs_(data, addr, hint || '', 'ops@x.test'); };
      TestAssertEqual_(next('dan@x.test').name + ',' + next('dan@x.test').via + ',' + next('dan@x.test').role + ',' + next('dan@x.test').deadName, 'Tom,hierarchy,TM,Dan', 'next: the nearest tier above, with its role; the dead person is named from the directory');
      TestAssertEqual_(next('tom@x.test').name, 'Rhea', 'next: a TM with no TL/TM above goes to the RH');
      TestAssertEqual_(next('rhea@x.test').name, 'Chad', 'next: an RH goes to the CH');
      TestAssertEqual_(next('ann@x.test').name, 'Rhea', 'next: a manager with no email in the directory is skipped (Nomail Nick)');
      TestAssertEqual_(next('bob@x.test').name, 'Chad', 'next: a manager who shares the dead address is skipped (Dup Dee)');
      const s = next('solo@x.test');
      TestAssertEqual_(s.email + ',' + s.via + ',' + s.name + ',' + s.role, 'ops@x.test,ops fallback,Snehil Chhimwal,ops', 'next: nobody above -> the ops address (Snehil), marked as the fallback');
      TestAssertEqual_(next('chad@x.test').via, 'ops fallback', 'next: the top of the org has nobody above either');
      const u = next('stranger@x.test');
      TestAssertEqual_(u.via + ',' + u.deadName, 'ops fallback,', 'next: an address that is nobody in the directory (a legacy fallback address) goes to the ops address');
      TestAssertEqual_(next('ops@x.test'), null, 'next: the ops address itself has nobody above - nothing to re-route');
      TestAssertEqual_(next(''), null, 'next: no address, nothing to do');
      TestAssertEqual_(emailRerouteNextGs_(data, 'dan@x.test', 'Dan', 'ops@x.test').deadName, 'Dan', 'next: a name hint is used for the label');
      const shared = { byRmNameLower: { 'one': { tm: 'Up Una' }, 'two': { tm: 'Up Ula' } }, emailByManagerNameLower: { one: 's@x.test', two: 's@x.test', 'up una': 'una@x.test', 'up ula': 'ula@x.test' } };
      TestAssertEqual_(emailRerouteNextGs_(shared, 's@x.test', 'Two', 'ops@x.test').name, 'Up Ula', 'next: when two people share the address the hint picks whose chain is used');
      TestAssertEqual_(emailRerouteNextGs_(shared, 's@x.test', '', 'ops@x.test').name, 'Up Una', 'next: without a hint the first one is used');
      TestAssertEqual_(emailRerouteNextGs_(null, 'dan@x.test', '', 'ops@x.test').via, 'ops fallback', 'next: no hierarchy data at all -> the ops address');
    }

    // ================= the re-send window =================
    {
      const row = function (job, hhmm, day) { return { job: job, finished_at: new Date((day || '2026-10-08') + 'T' + hhmm + ':00+05:30') }; };
      const open = function (r, hhmm, day) { return emailRerouteWindowOpenGs_(r, new Date((day || '2026-10-08') + 'T' + hhmm + ':00+05:30')); };
      TestAssertEqual_(open(row('allIssues17', '17:05'), '18:29') + ',' + open(row('allIssues17', '17:05'), '18:31'), 'true,false', 'window: a 17:00 email may be re-sent until 18:30 (decision D5)');
      TestAssertEqual_(open(row('allIssues17', '17:05'), '10:30', '2026-10-09'), false, 'window: …and the cutoff is on the email\'s OWN day - next morning it is closed');
      TestAssertEqual_(open(row('morning10', '10:05'), '12:44') + ',' + open(row('morning10', '10:05'), '12:46'), 'true,false', 'window: a 10:00 email until 12:45');
      TestAssertEqual_(open(row('followup13', '13:05'), '15:59') + ',' + open(row('followup13', '13:05'), '16:01'), 'true,false', 'window: a 13:00 reply until 16:00');
      TestAssertEqual_(open(row('reroute', '17:35'), '20:34') + ',' + open(row('reroute', '17:35'), '20:36'), 'true,false', 'window: a re-sent copy that bounces again has ' + EMAIL_REROUTE_RESEND_MAX_HOURS_ + ' hours');
      TestAssertEqual_(emailRerouteWindowOpenGs_({ job: 'allIssues17', finished_at: '' }, new Date()), false, 'window: no send time, closed');
    }

    // ================= which address an email really went to =================
    {
      const row = { to: 'dead@x.test', cc: 'lead@x.test', finished_at: new Date('2026-10-05T10:00:00+05:30') };
      TestAssertEqual_(emailRerouteEffectiveAddressesGs_(row, [TestRR_entry_()]).join('|'), 'boss@x.test|lead@x.test', 'effective: a row in force at the send changes the recipients');
      TestAssertEqual_(emailRerouteEffectiveAddressesGs_(row, [TestRR_entry_({ created_at: new Date('2026-10-05T10:00:01+05:30') })]).length, 0, 'effective: a row created after the send did not redirect it');
      TestAssertEqual_(emailRerouteEffectiveAddressesGs_(row, [TestRR_entry_({ expires_at: new Date('2026-10-05T09:00:00+05:30') })]).length, 0, 'effective: a row that had expired before the send did not');
      TestAssertEqual_(emailRerouteEffectiveAddressesGs_({ to: 'dead@x.test', finished_at: '' }, [TestRR_entry_()]).length, 0, 'effective: no send time, nothing');
      TestAssertEqual_(emailRerouteEffectiveAddressesGs_(row, []).length, 0, 'effective: no rows, nothing');
    }

    // ================= the table on a sheet =================
    {
      const ss = TestMockSpreadsheet_({});
      TestRR_bind_(ss);
      TestAssertEqual_(emailRerouteReadEntriesGs_(ss).length, 0, 'sheet: no tab yet reads as no rows');
      const now = new Date();
      const spec = { deadEmail: 'dead@x.test', deadName: 'Dead Dan', newEmail: 'boss@x.test', newName: 'Boss Bea', newRole: 'TM', via: 'hierarchy', sourceId: 'E1', sourceJob: 'allIssues17', note: '' };
      const first = emailRerouteRecordGs_(ss, spec, now);
      TestAssertEqual_(first.created, true, 'record: the first row is created');
      const rows = TestRR_entries_(ss);
      TestAssertEqual_(rows.length + ',' + rows[0].dead_email + ',' + rows[0].new_email + ',' + rows[0].status + ',' + rows[0].via + ',' + rows[0].source_email_id, '1,dead@x.test,boss@x.test,ACTIVE,hierarchy,E1', 'record: the row says who replaces whom and which email proved it');
      TestAssertEqual_(Math.round((rows[0].expires_at.getTime() - rows[0].created_at.getTime()) / 86400000), EMAIL_REROUTE_DAYS_, 'record: the row lasts ' + EMAIL_REROUTE_DAYS_ + ' days');
      TestAssertEqual_(emailRerouteRecordGs_(ss, Object.assign({}, spec, { deadEmail: 'DEAD@x.test' }), now).created, false, 'record: an address that already has a row in force gets no second one');
      TestAssertEqual_(TestRR_entries_(ss).length, 1, 'record: …(still one row)');
      TestAssertEqual_(emailRerouteRecordGs_(ss, Object.assign({}, spec, { deadEmail: 'other@x.test' }), now).created, true, 'record: another dead address gets its own row');
      TestAssertEqual_(emailRerouteRecordGs_(ss, spec, new Date(now.getTime() + 15 * 86400000)).created, true, 'record: after the row has expired the address gets a fresh one (it is tried again)');
      TestAssertEqual_(TestRR_entries_(ss).length, 3, 'record: …three rows in all');

      // the cache: one read per run, refreshed after a record
      emailRerouteResetCacheGs_();
      const c1 = emailRerouteEntriesCachedGs_();
      TestAssertEqual_(c1.length, 3, 'cache: reads the table');
      ss.getSheetByName(EMAIL_REROUTE_SHEET_).getRange(2, EMAIL_REROUTE_HEADERS_.indexOf('status') + 1, 1, 1).setValues([['ENDED']]);
      TestAssertEqual_(emailRerouteEntriesCachedGs_()[0].status, 'ACTIVE', 'cache: a second call in the same run does not read the sheet again');
      emailRerouteResetCacheGs_();
      TestAssertEqual_(emailRerouteEntriesCachedGs_()[0].status, 'ENDED', 'cache: …until it is reset');
      TestAssertEqual_(emailRerouteRecordGs_(ss, Object.assign({}, spec, { deadEmail: 'third@x.test' }), now).created, true, 'cache: a new row');
      TestAssertEqual_(emailRerouteEntriesCachedGs_().length, 4, 'cache: …is visible at once (a record resets the cache)');

      // ending them by hand
      showEmailReroutesNow();
      const ended = endAllEmailReroutesNow();
      TestAssert_(ended >= 1, 'end: ' + ended + ' row(s) in force were ended');
      TestAssertEqual_(Object.keys(emailRerouteMapGs_(emailRerouteEntriesCachedGs_(), Date.now())).length, 0, 'end: …and the redirect map is empty at once (the cache was reset)');
      TestAssertEqual_(endAllEmailReroutesNow(), 0, 'end: nothing left to end');

      // an unreadable table never throws: it reads as empty
      const brokenSs = TestMockSpreadsheet_({});
      brokenSs.getSheetByName = function () { throw new Error('simulated: the spreadsheet is unreachable'); };
      SpreadsheetApp.getActiveSpreadsheet = function () { return brokenSs; };
      emailRerouteResetCacheGs_();
      TestAssertEqual_(emailRerouteEntriesCachedGs_().length, 0, 'cache: an unreadable table reads as empty (the emails go to their original addresses)');
    }

    // ================= the redirect inside the real senders =================
    {
      const ss = TestMockSpreadsheet_({});
      TestRR_bind_(ss);
      const msg = { to: DEAD, cc: '', subject: 'Subject S', plainBody: 'Lead L-200 needs a call', htmlBody: '<p>Lead L-200 needs a call</p>', leadIds: ['L-200'] };
      TestAssert_(emailRerouteApplyGs_(msg) === msg, 'apply: with no table the very same message comes back');
      sendGuardedEmailGs_(msg, 'plain');
      TestAssertEqual_(TestGmailLog_.drafts.length + ',' + TestGmailLog_.drafts[0].to, '1,' + DEAD, 'apply: with no row in force the email goes to its own address');

      emailRerouteRecordGs_(ss, { deadEmail: DEAD, deadName: 'Dead Dan', newEmail: BOSS, newName: 'Boss Bea', newRole: 'TM', via: 'hierarchy', sourceId: 'E1', sourceJob: 'allIssues17' }, new Date(Date.now() - 1000));
      TestGmailLog_reset_();
      const result = sendGuardedEmailGs_(msg, 'redirected');
      const d = TestGmailLog_.drafts[0];
      TestAssertEqual_(TestGmailLog_.drafts.length + ',' + d.to + ',' + d.cc + ',' + d.subject, '1,' + BOSS + ',,Subject S', 'apply: the email goes to the replacement, the subject is untouched');
      TestAssert_(d.htmlBody.indexOf('Re-routed to you') !== -1 && d.htmlBody.indexOf('<p>Lead L-200 needs a call</p>') > d.htmlBody.indexOf('Re-routed to you'), 'apply: the html opens with the banner and still carries the original body');
      TestAssert_(d.body.indexOf('RE-ROUTED TO YOU') === 0 && d.body.indexOf('Lead L-200 needs a call') !== -1, 'apply: so does the plain text');
      TestAssert_(!!result && typeof result.getId === 'function', 'apply: the send result is returned as usual');
      TestAssertEqual_(msg.to + ',' + msg.plainBody, DEAD + ',Lead L-200 needs a call', 'apply: the caller\'s own message is not modified');

      // Cc handling and a mixed list
      TestGmailLog_reset_();
      sendGuardedEmailGs_({ to: TOP, cc: DEAD + ',' + BOSS, subject: 'S2', plainBody: 'Lead L-201', htmlBody: '<p>Lead L-201</p>', leadIds: ['L-201'] }, 'cc');
      TestAssertEqual_(TestGmailLog_.drafts[0].to + ' / ' + TestGmailLog_.drafts[0].cc, TOP + ' / ' + BOSS, 'apply: a dead Cc is replaced (and not repeated); a To that was fine is left alone');
      TestAssert_(TestGmailLog_.drafts[0].htmlBody.indexOf('Re-routed to you') === -1, 'apply: no banner when only a Cc changed');
      TestGmailLog_reset_();
      sendGuardedEmailGs_({ to: TOP, cc: '', subject: 'S3', plainBody: 'Lead L-202', htmlBody: '<p>Lead L-202</p>', leadIds: ['L-202'] }, 'untouched');
      TestAssertEqual_(TestGmailLog_.drafts[0].to + ',' + TestGmailLog_.drafts[0].htmlBody, TOP + ',<p>Lead L-202</p>', 'apply: an email to somebody else is byte-for-byte what it was');

      // the safety gate still judges the payload that is really sent
      TestAssertThrows_(function () { sendGuardedEmailGs_({ to: DEAD, subject: 'S4', plainBody: 'Lead L-203', htmlBody: '<p>nothing</p>', leadIds: ['L-203'] }, 'gate'); }, 'apply: the gate still refuses a body that lacks the leads it counts');

      // a threaded reply (the 13:00 follow-up) is redirected too
      const realNewBlob = Utilities.newBlob;
      let mime = '';
      Utilities.newBlob = function (s) { mime = s; return realNewBlob.apply(null, arguments); };
      try {
        sendThreadedGmailReply_('T-1', DEAD, '', 'Re: S', 'Lead L-300 still open', '<p>Lead L-300 still open</p>');
      } finally { Utilities.newBlob = realNewBlob; }
      TestAssertContains_(mime, 'To: ' + BOSS + '\r\n', 'threaded reply: the To header carries the replacement');
      TestAssert_(mime.split('\r\n\r\n')[0].indexOf(DEAD) === -1, 'threaded reply: …and the dead address is in no header');
      TestAssertContains_(mime, 'RE-ROUTED TO YOU', 'threaded reply: …with the banner in both parts');
      TestAssertEqual_(TestGmailLog_.threadReplies.length + ',' + TestGmailLog_.threadReplies[0].threadId, '1,T-1', 'threaded reply: it still lands in the original thread');

      // an ordinary reply is untouched
      mime = '';
      Utilities.newBlob = function (s) { mime = s; return realNewBlob.apply(null, arguments); };
      try {
        sendThreadedGmailReply_('T-2', TOP, undefined, 'Re: S', 'Lead L-301', '<p>Lead L-301</p>');
      } finally { Utilities.newBlob = realNewBlob; }
      TestAssertContains_(mime, 'To: ' + TOP + '\r\n', 'threaded reply: an ordinary recipient is left as it was');
      TestAssert_(mime.indexOf('RE-ROUTED') === -1, 'threaded reply: …without a banner');

      // TEST MODE never redirects
      TEST_MODE_OVERRIDE_EMAIL_ = TEST_EMAIL_PRIMARY_;
      try {
        TestAssert_(emailRerouteApplyGs_(msg) === msg, 'TEST MODE: the message is never redirected');
      } finally { TEST_MODE_OVERRIDE_EMAIL_ = ''; }

      // an expired row stops applying by itself
      const sheet = ss.getSheetByName(EMAIL_REROUTE_SHEET_);
      sheet.getRange(2, EMAIL_REROUTE_HEADERS_.indexOf('expires_at') + 1, 1, 1).setValues([[new Date(Date.now() - 1000)]]);
      emailRerouteResetCacheGs_();
      TestAssert_(emailRerouteApplyGs_(msg) === msg, 'expiry: after the date the dead address is used again');

      // fail-open: a table that cannot be read changes nothing
      const brokenSs = TestMockSpreadsheet_({});
      brokenSs.getSheetByName = function () { throw new Error('simulated: unreachable'); };
      SpreadsheetApp.getActiveSpreadsheet = function () { return brokenSs; };
      emailRerouteResetCacheGs_();
      TestAssert_(emailRerouteApplyGs_(msg) === msg, 'fail-open: an unreadable table leaves the message as it was');
      const realMap = emailRerouteMapGs_;
      emailRerouteMapGs_ = function () { throw new Error('simulated bug'); };
      try { TestAssert_(emailRerouteApplyGs_(msg) === msg, 'fail-open: even a bug inside the redirect leaves the message as it was'); } finally { emailRerouteMapGs_ = realMap; }
    }

    // ================= a 17:00 email bounces (the whole story) =================
    const nowSweep = new Date();
    {
      const ss = TestMockSpreadsheet_({});
      TestRR_bind_(ss);
      emailRerouteHierarchyGs_ = function () { return TestRR_hierarchy_(); };
      emailRerouteWindowOpenGs_ = function () { return true; };
      const h = emailLedgerOpenGs_(ss);
      const subject = 'A1/Dead Dan/google/Leads With Issue/10 Oct 2026';
      const e1 = TestRR_ledgerRow_(ss, h, { bucket: 'Dead Dan', to: DEAD, cc: TOP, subject: subject, messageId: 'M1' });
      const e2 = TestRR_ledgerRow_(ss, h, { bucket: 'Fine Fay', to: BOSS, subject: 'A1/Fine Fay/google/Leads With Issue/10 Oct 2026', messageId: 'M2', region: 'Thane' });
      TestRR_gmail_([TestRR_bounce_(e1.finished, DEAD, subject)], { M1: { subject: subject, html: '<table><tr><td>L-100</td></tr></table>', plain: 'Lead L-100 needs a call' } });
      const s = sweepEmailBouncesAndReplies_({ now: nowSweep });
      TestAssertEqual_(s.checked + ',' + s.bounced + ',' + s.newBounces.length, '2,1,1', 'story: two emails checked, one bounced');
      TestAssertEqual_(s.reroutes[e1.id].action, 'RESENT', 'story: the bounced email was re-sent');
      TestAssertContains_(s.reroutes[e1.id].text, 're-sent to ' + BOSS, 'story: …to the person next in the hierarchy');
      TestAssert_(s.reroutes[e2.id] === undefined, 'story: the email that did not bounce is not touched');

      const ent = TestRR_entries_(ss);
      TestAssertEqual_(ent.length + ',' + ent[0].dead_email + ',' + ent[0].new_email + ',' + ent[0].new_name + ',' + ent[0].new_role + ',' + ent[0].via + ',' + ent[0].source_email_id + ',' + ent[0].source_job,
        '1,' + DEAD + ',' + BOSS + ',Boss Bea,TM,hierarchy,' + e1.id + ',allIssues17', 'story: the dead address is recorded with its replacement and the email that proved it');
      TestAssertEqual_(ent[0].dead_name, 'Dead Dan', 'story: …named from the bucket');

      TestAssertEqual_(TestGmailLog_.drafts.length + ',' + TestGmailLog_.drafts[0].to + ',' + TestGmailLog_.drafts[0].subject, '1,' + BOSS + ',' + subject, 'story: one copy went out, to the replacement, with the original subject');
      TestAssertEqual_(TestGmailLog_.drafts[0].cc, TOP, 'story: …and the original Cc is kept');
      const storyHtml = TestGmailLog_.drafts[0].htmlBody;
      TestAssert_(storyHtml.indexOf('<div') === 0 && storyHtml.indexOf('Re-routed to you') !== -1 && storyHtml.indexOf('<td>L-100</td>') > storyHtml.indexOf('Re-routed to you'), 'story: …the banner first, then the original email');
      const rr = TestRR_ledgerById_(ss, 'RR|' + e1.id);
      TestAssertEqual_(rr.job + ',' + rr.status + ',' + rr.to + ',' + rr.region + ',' + rr.bucket_label + ',' + rr.leads_sent, 'reroute,ACCEPTED,' + BOSS + ',Pune,Dead Dan,1', 'story: the copy has its own ledger row, ACCEPTED, with the Gmail ids');
      TestAssertContains_(rr.status_reason, 're-routed to ' + BOSS + ' (the bounced ' + DEAD + ')', 'story: …saying it was re-routed');
      TestAssert_(rr.message_id !== '' && rr.thread_id !== '', 'story: …with the evidence Gmail gave');
      TestAssertEqual_(TestSW_row_(ss, e1.rowNo).status + ',' + /^BOUNCED/.test(TestSW_row_(ss, e1.rowNo).bounce_status), 'ACCEPTED,true', 'story: the original row keeps its own history: ACCEPTED, and BOUNCED');

      const alert = TestGmailLog_.sent.filter(function (m) { return /Email BOUNCED/.test(m.subject); })[0];
      TestAssertContains_(alert.body, '=> re-sent to ' + BOSS, 'story: the bounce alert says what was done');
      TestAssertContains_(alert.body, 'Email_Reroutes', 'story: …and where to look');
      TestAssertContains_(alert.body, 'after ' + EMAIL_REROUTE_DAYS_ + ' days', 'story: …and that the address is tried again');

      // the next check finds nothing new to do
      const before = TestGmailLog_.drafts.length + TestGmailLog_.sent.length;
      const again = sweepEmailBouncesAndReplies_({ now: new Date(nowSweep.getTime() + 60000) });
      TestAssertEqual_(again.reroutes[e1.id].action, 'ALREADY', 'story: the next check sees the email was already re-sent');
      TestAssertEqual_(TestGmailLog_.drafts.length + TestGmailLog_.sent.length - before, 0, 'story: …and sends nothing, no second copy and no second alert');
      TestAssertEqual_(TestRR_entries_(ss).length, 1, 'story: …and adds no second row');

      // the follow-ups: the 10:00 / 13:00 emails to the dead address now reach the replacement
      TestGmailLog_reset_();
      sendGuardedEmailGs_({ to: DEAD, cc: TOP, subject: 'Next day 10:00', plainBody: 'Lead L-400 checkpoint', htmlBody: '<p>Lead L-400 checkpoint</p>', leadIds: ['L-400'] }, '10:00');
      TestAssertEqual_(TestGmailLog_.drafts[0].to, BOSS, 'story: the next day\'s email to the same bucket goes to the replacement');
      const track = emailLedgerOpenGs_(ss);
      const meta = { emailId: 'T|1', job: 'morning10', dayKey: istDayKeyGs_(new Date()), region: 'Pune', bucketLabel: '', primaryRole: '', to: DEAD, cc: '', subject: 'S', leadIds: ['L-401'] };
      emailLedgerTrackSendGs_(track, meta, function () { return sendGuardedEmailGs_({ to: DEAD, subject: 'S', plainBody: 'Lead L-401', htmlBody: '<p>Lead L-401</p>', leadIds: ['L-401'] }, 'tracked'); });
      const tracked = TestRR_ledgerById_(ss, 'T|1');
      TestAssertEqual_(tracked.to + ',' + tracked.status, DEAD + ',ACCEPTED', 'story: the ledger row of that follow-up keeps the ORIGINAL address (so the audits and the tracker still match it)');
      TestAssertContains_(tracked.status_reason, 're-routed to ' + BOSS, 'story: …and says it was re-routed');
      const plainMeta = { emailId: 'T|2', job: 'morning10', dayKey: istDayKeyGs_(new Date()), region: 'Pune', bucketLabel: '', primaryRole: '', to: TOP, cc: '', subject: 'S', leadIds: ['L-402'] };
      emailLedgerTrackSendGs_(track, plainMeta, function () { return sendGuardedEmailGs_({ to: TOP, subject: 'S', plainBody: 'Lead L-402', htmlBody: '<p>Lead L-402</p>', leadIds: ['L-402'] }, 'plain'); });
      TestAssertEqual_(TestRR_ledgerById_(ss, 'T|2').status_reason, '', 'story: the note never leaks into the next, ordinary row');
      const failMeta = { emailId: 'T|3', job: 'morning10', dayKey: istDayKeyGs_(new Date()), region: 'Pune', bucketLabel: '', primaryRole: '', to: DEAD, cc: '', subject: 'S', leadIds: ['L-403'] };
      try { emailLedgerTrackSendGs_(track, failMeta, function () { return sendGuardedEmailGs_({ to: DEAD, subject: 'S', plainBody: 'no lead here', htmlBody: '<p>no lead here</p>', leadIds: ['L-403'] }, 'blocked'); }); } catch (e) { /* the gate refused it: expected */ }
      const plain2Meta = { emailId: 'T|4', job: 'morning10', dayKey: istDayKeyGs_(new Date()), region: 'Pune', bucketLabel: '', primaryRole: '', to: TOP, cc: '', subject: 'S', leadIds: ['L-404'] };
      emailLedgerTrackSendGs_(track, plain2Meta, function () { return sendGuardedEmailGs_({ to: TOP, subject: 'S', plainBody: 'Lead L-404', htmlBody: '<p>Lead L-404</p>', leadIds: ['L-404'] }, 'plain2'); });
      TestAssertEqual_(TestRR_ledgerById_(ss, 'T|3').status + ',' + TestRR_ledgerById_(ss, 'T|4').status_reason, 'BLOCKED,', 'story: a send the gate refused is BLOCKED, and its note does not leak into the next row either');

      TestAssertOnlyTestEmails_();
    }

    // ================= only a Cc address bounces =================
    {
      const ss = TestMockSpreadsheet_({});
      TestRR_bind_(ss);
      emailRerouteHierarchyGs_ = function () { return TestRR_hierarchy_(); };
      emailRerouteWindowOpenGs_ = function () { return true; };
      const h = emailLedgerOpenGs_(ss);
      const subject = 'A1/Fine Fay/google/Leads With Issue/10 Oct 2026';
      const e1 = TestRR_ledgerRow_(ss, h, { bucket: 'Fine Fay', to: BOSS, cc: DEAD, subject: subject, messageId: 'M1' });
      TestRR_gmail_([TestRR_bounce_(e1.finished, DEAD, subject)], { M1: { subject: subject, html: '<p>L-100</p>', plain: 'L-100' } });
      const s = sweepEmailBouncesAndReplies_({ now: nowSweep });
      TestAssertEqual_(s.reroutes[e1.id].action, 'CC_ONLY', 'cc only: recognised');
      TestAssertEqual_(TestGmailLog_.drafts.length, 0, 'cc only: nothing is re-sent (the To person received it)');
      const ent = TestRR_entries_(ss);
      TestAssertEqual_(ent.length + ',' + ent[0].dead_email + ',' + ent[0].note, '1,' + DEAD + ',cc only', 'cc only: the dead address still gets its row, marked');
      TestGmailLog_reset_();
      sendGuardedEmailGs_({ to: BOSS, cc: DEAD, subject: 'S', plainBody: 'Lead L-1', htmlBody: '<p>Lead L-1</p>', leadIds: ['L-1'] }, 'later');
      TestAssertEqual_(TestGmailLog_.drafts[0].to + ' / ' + TestGmailLog_.drafts[0].cc, BOSS + ' / ', 'cc only: later emails drop the dead Cc (its replacement is the To already)');
    }

    // ================= a bounce that names only the ops address =================
    {
      const ss = TestMockSpreadsheet_({});
      TestRR_bind_(ss);
      emailRerouteHierarchyGs_ = function () { return TestRR_hierarchy_(); };
      emailRerouteWindowOpenGs_ = function () { return true; };
      const h = emailLedgerOpenGs_(ss);
      const subject = 'A1/Fine Fay/google/Leads With Issue/10 Oct 2026';
      const e1 = TestRR_ledgerRow_(ss, h, { bucket: 'Fine Fay', to: BOSS, cc: TOP, subject: subject, messageId: 'M1' });
      TestRR_gmail_([TestRR_bounce_(e1.finished, TOP, subject)], { M1: { subject: subject, html: '<p>L-100</p>', plain: 'L-100' } });
      const s = sweepEmailBouncesAndReplies_({ now: nowSweep });
      TestAssertEqual_(s.reroutes[e1.id].action + ',' + TestRR_entries_(ss).length + ',' + TestGmailLog_.drafts.length, 'NONE,0,0', 'ops address: a bounce naming only the ops address has nobody above it - the alert is all there is');
    }

    // ================= a copy that may already have gone out is never repeated =================
    {
      const ss = TestMockSpreadsheet_({});
      TestRR_bind_(ss);
      emailRerouteHierarchyGs_ = function () { return TestRR_hierarchy_(); };
      emailRerouteWindowOpenGs_ = function () { return true; };
      const h = emailLedgerOpenGs_(ss);
      const subject = 'A1/Dead Dan/google/Leads With Issue/10 Oct 2026';
      const e1 = TestRR_ledgerRow_(ss, h, { bucket: 'Dead Dan', to: DEAD, subject: subject, messageId: 'M1' });
      TestRR_gmail_([TestRR_bounce_(e1.finished, DEAD, subject)], { M1: { subject: subject, html: '<p>L-100</p>', plain: 'Lead L-100' } });
      sweepEmailBouncesAndReplies_({ now: nowSweep });
      const rrRow = TestRR_rowNoOf_(ss, 'RR|' + e1.id);
      const drafts = TestGmailLog_.drafts.length;
      ['UNCONFIRMED', 'ATTEMPTING'].forEach(function (status, i) {
        ss.getSheetByName(EMAIL_LEDGER_SHEET_).getRange(rrRow, emailLedgerCol_('status'), 1, 1).setValues([[status]]);
        const again = sweepEmailBouncesAndReplies_({ now: new Date(nowSweep.getTime() + (i + 1) * 60000) });
        TestAssertEqual_(again.reroutes[e1.id].action + ',' + (TestGmailLog_.drafts.length - drafts), 'ALREADY,0', 'not repeated: a copy left ' + status + ' (it may have been delivered) is never sent a second time');
      });
      ss.getSheetByName(EMAIL_LEDGER_SHEET_).getRange(rrRow, emailLedgerCol_('status'), 1, 1).setValues([['BLOCKED']]);
      const retried = sweepEmailBouncesAndReplies_({ now: new Date(nowSweep.getTime() + 180000) });
      TestAssertEqual_(retried.reroutes[e1.id].action + ',' + (TestGmailLog_.drafts.length - drafts), 'RESENT,1', 'not repeated: …but one that was refused (BLOCKED) is retried');
    }

    // ================= the copy bounces too: the chain climbs =================
    {
      const ss = TestMockSpreadsheet_({});
      TestRR_bind_(ss);
      emailRerouteHierarchyGs_ = function () { return TestRR_hierarchy_(); };
      emailRerouteWindowOpenGs_ = function () { return true; };
      const h = emailLedgerOpenGs_(ss);
      const subject = 'A1/Dead Dan/google/Leads With Issue/10 Oct 2026';
      const e1 = TestRR_ledgerRow_(ss, h, { bucket: 'Dead Dan', to: DEAD, subject: subject, messageId: 'M1', minutesAgo: 60 });
      const msgs = { M1: { subject: subject, html: '<p>L-100</p>', plain: 'Lead L-100' } };
      TestRR_gmail_([TestRR_bounce_(e1.finished, DEAD, subject)], msgs);
      sweepEmailBouncesAndReplies_({ now: nowSweep });
      const rr1 = TestRR_ledgerById_(ss, 'RR|' + e1.id);
      TestAssertEqual_(rr1.to, BOSS, 'chain: the first copy went to Boss Bea');
      // the copy's message must be readable now, and it bounces
      msgs[rr1.message_id] = { subject: subject, html: '<div>banner</div><p>L-100</p>', plain: 'RE-ROUTED. Lead L-100' };
      const rrFinished = new Date(Date.now() - 20 * 60000);
      ss.getSheetByName(EMAIL_LEDGER_SHEET_).getRange(TestRR_rowNoOf_(ss, 'RR|' + e1.id), emailLedgerCol_('finished_at'), 1, 1).setValues([[rrFinished]]);
      TestRR_gmail_([TestRR_bounce_(e1.finished, DEAD, subject), TestRR_bounce_(rrFinished, BOSS, subject)], msgs);
      TestGmailLog_.drafts.length = 0;
      const s2 = sweepEmailBouncesAndReplies_({ now: new Date() });
      TestAssertEqual_(s2.reroutes['RR|' + e1.id].action, 'RESENT', 'chain: the bounce of the copy is handled too');
      const ent = TestRR_entries_(ss);
      TestAssertEqual_(ent.map(function (r) { return r.dead_email + '>' + r.new_email + '(' + r.via + ')'; }).join(' '), DEAD + '>' + BOSS + '(hierarchy) ' + BOSS + '>' + TOP + '(hierarchy)', 'chain: Boss Bea\'s address gets its own row, pointing one level up');
      TestAssertEqual_(TestGmailLog_.drafts.length + ',' + TestGmailLog_.drafts[0].to, '1,' + TOP, 'chain: the second copy went to the next one up');
      TestAssertContains_(TestGmailLog_.drafts[0].htmlBody, 'Boss Bea', 'chain: …whose banner names the person it was addressed to');
      TestAssertEqual_(TestRR_ledgerById_(ss, 'RR|RR|' + e1.id).to, TOP, 'chain: …recorded as its own ledger row');
      // and everything for the original address now ends at the top
      TestGmailLog_reset_();
      sendGuardedEmailGs_({ to: DEAD, subject: 'S', plainBody: 'Lead L-1', htmlBody: '<p>Lead L-1</p>', leadIds: ['L-1'] }, 'later');
      TestAssertEqual_(TestGmailLog_.drafts[0].to, TOP, 'chain: later emails to the original address follow the chain to its end');
      TestAssertOnlyTestEmails_();
    }

    // ================= the bounce names the address the email REALLY went to =================
    {
      const ss = TestMockSpreadsheet_({});
      TestRR_bind_(ss);
      emailRerouteHierarchyGs_ = function () { return TestRR_hierarchy_(); };
      emailRerouteWindowOpenGs_ = function () { return true; };
      const h = emailLedgerOpenGs_(ss);
      // Dead Dan's address was redirected to Boss Bea two hours ago (an earlier bounce); this morning email was planned for Dead Dan and went to Boss Bea
      emailRerouteRecordGs_(ss, { deadEmail: DEAD, deadName: 'Dead Dan', newEmail: BOSS, newName: 'Boss Bea', newRole: 'TM', via: 'hierarchy', sourceId: 'EARLIER', sourceJob: 'allIssues17' }, new Date(Date.now() - 2 * 3600000));
      const subject = 'Dead Dan 10:00 email';
      const e1 = TestRR_ledgerRow_(ss, h, { job: 'morning10', bucket: 'Dead Dan', to: DEAD, subject: subject, messageId: 'M1' });
      TestRR_gmail_([TestRR_bounce_(e1.finished, BOSS, subject)], { M1: { subject: subject, html: '<p>L-100</p>', plain: 'Lead L-100' } });
      const s = sweepEmailBouncesAndReplies_({ now: nowSweep });
      TestAssertEqual_(s.bounced + ',' + s.newBounces.length, '1,1', 'really sent: a bounce naming the replacement is matched to the email that was planned for the dead address');
      TestAssertEqual_(TestRR_entries_(ss).map(function (r) { return r.dead_email + '>' + r.new_email; }).join(' '), DEAD + '>' + BOSS + ' ' + BOSS + '>' + TOP, 'really sent: the replacement gets its own row, one level up');
      TestAssertEqual_(s.reroutes[e1.id].action + ',' + TestGmailLog_.drafts.length + ',' + TestGmailLog_.drafts[0].to, 'RESENT,1,' + TOP, 'really sent: the email is re-sent to the end of the chain');
    }

    // ================= too late to re-send =================
    {
      const ss = TestMockSpreadsheet_({});
      TestRR_bind_(ss);
      emailRerouteHierarchyGs_ = function () { return TestRR_hierarchy_(); };
      emailRerouteWindowOpenGs_ = function () { return false; };
      const h = emailLedgerOpenGs_(ss);
      const subject = 'A1/Dead Dan/google/Leads With Issue/10 Oct 2026';
      const e1 = TestRR_ledgerRow_(ss, h, { bucket: 'Dead Dan', to: DEAD, subject: subject, messageId: 'M1' });
      TestRR_gmail_([TestRR_bounce_(e1.finished, DEAD, subject)], { M1: { subject: subject, html: '<p>L-100</p>', plain: 'L-100' } });
      const s = sweepEmailBouncesAndReplies_({ now: nowSweep });
      TestAssertEqual_(s.reroutes[e1.id].action + ',' + TestGmailLog_.drafts.length, 'TOO_OLD,0', 'too late: the old email is not repeated');
      TestAssertEqual_(TestRR_entries_(ss).length, 1, 'too late: …but the address is still redirected from now on');
      const alert = TestGmailLog_.sent.filter(function (m) { return /Email BOUNCED/.test(m.subject); })[0];
      TestAssertContains_(alert.body, 'NOT re-sent', 'too late: the alert says so');
      TestAssertContains_(alert.body, 'every later email to ' + DEAD + ' goes to ' + BOSS, 'too late: …and where the later emails go');
    }

    // ================= the hierarchy cannot be read: no guess, retried at the next check =================
    {
      const ss = TestMockSpreadsheet_({});
      TestRR_bind_(ss);
      emailRerouteWindowOpenGs_ = function () { return true; };
      emailRerouteHierarchyGs_ = function () { throw new Error('simulated: RM_Hierarchy is unreadable'); };
      const h = emailLedgerOpenGs_(ss);
      const subject = 'A1/Dead Dan/google/Leads With Issue/10 Oct 2026';
      const e1 = TestRR_ledgerRow_(ss, h, { bucket: 'Dead Dan', to: DEAD, subject: subject, messageId: 'M1' });
      TestRR_gmail_([TestRR_bounce_(e1.finished, DEAD, subject)], { M1: { subject: subject, html: '<p>L-100</p>', plain: 'L-100' } });
      const s = sweepEmailBouncesAndReplies_({ now: nowSweep });
      TestAssertEqual_(s.reroutes[e1.id].action, 'ERROR', 'no hierarchy: reported as an error');
      TestAssertContains_(s.reroutes[e1.id].text, 'the next check retries', 'no hierarchy: …saying it will be retried');
      TestAssertEqual_(TestRR_entries_(ss).length + ',' + TestGmailLog_.drafts.length, '0,0', 'no hierarchy: no row is made and nothing is sent to a guessed person');
      TestAssert_(/^BOUNCED/.test(TestSW_row_(ss, e1.rowNo).bounce_status), 'no hierarchy: the bounce itself is still recorded');
      emailRerouteHierarchyGs_ = function () { return TestRR_hierarchy_(); };
      const s2 = sweepEmailBouncesAndReplies_({ now: new Date(nowSweep.getTime() + 60000) });
      TestAssertEqual_(s2.reroutes[e1.id].action + ',' + s2.newBounces.length, 'RESENT,0', 'no hierarchy: the next check completes it (the bounce is not new, the work is)');
      TestAssertEqual_(TestRR_entries_(ss).length + ',' + TestGmailLog_.drafts.length, '1,1', 'no hierarchy: one row, one copy');
    }

    // ================= nobody above: the ops address =================
    {
      const ss = TestMockSpreadsheet_({});
      TestRR_bind_(ss);
      emailRerouteWindowOpenGs_ = function () { return true; };
      emailRerouteHierarchyGs_ = function () { return TestRR_hierarchy_({ byRm: { 'solo sam': { role: 'A1', tl: '', tm: '', rh: '', ch: '' } }, dir: { 'solo sam': DEAD, 'dead dan': 'elsewhere@x.test' } }); };
      const h = emailLedgerOpenGs_(ss);
      const subject = 'A1/Solo Sam/google/Leads With Issue/10 Oct 2026';
      const e1 = TestRR_ledgerRow_(ss, h, { bucket: 'Solo Sam', to: DEAD, cc: BOSS, subject: subject, messageId: 'M1' });
      TestRR_gmail_([TestRR_bounce_(e1.finished, DEAD, subject)], { M1: { subject: subject, html: '<p>L-100</p>', plain: 'L-100' } });
      const s = sweepEmailBouncesAndReplies_({ now: nowSweep });
      const ent = TestRR_entries_(ss)[0];
      TestAssertEqual_(ent.new_email + ',' + ent.via + ',' + ent.new_role, TOP + ',ops fallback,ops', 'ops fallback: nobody above, so the ops address (Snehil)');
      TestAssertEqual_(TestGmailLog_.drafts.length + ',' + TestGmailLog_.drafts[0].to + ',' + TestGmailLog_.drafts[0].cc, '1,' + TOP + ',' + BOSS, 'ops fallback: the copy goes to the ops address, the original Cc kept');
      TestAssertContains_(TestGmailLog_.drafts[0].body, 'nobody above that person is on record', 'ops fallback: the banner says why it came to the ops address');
      TestAssertEqual_(s.reroutes[e1.id].action, 'RESENT', 'ops fallback: re-sent');
    }

    // ================= the original cannot be copied =================
    {
      const ss = TestMockSpreadsheet_({});
      TestRR_bind_(ss);
      emailRerouteWindowOpenGs_ = function () { return true; };
      emailRerouteHierarchyGs_ = function () { return TestRR_hierarchy_(); };
      const h = emailLedgerOpenGs_(ss);
      const subject = 'A1/Dead Dan/google/Leads With Issue/10 Oct 2026';
      const noId = TestRR_ledgerRow_(ss, h, { bucket: 'No Id', to: DEAD, subject: subject, messageId: '', minutesAgo: 50 });
      const lost = TestRR_ledgerRow_(ss, h, { bucket: 'Lost', to: BOSS, subject: subject, messageId: 'GONE' });
      const gated = TestRR_ledgerRow_(ss, h, { bucket: 'Gate', to: DEAD, subject: subject, messageId: 'M9', minutesAgo: 45 });
      TestRR_gmail_([TestRR_bounce_(noId.finished, DEAD, subject), TestRR_bounce_(lost.finished, BOSS, subject), TestRR_bounce_(gated.finished, DEAD, subject)],
        { M9: { subject: subject, html: '<p>nothing here</p>', plain: 'nothing here' } });
      const s = sweepEmailBouncesAndReplies_({ now: nowSweep });
      TestAssertEqual_(s.reroutes[gated.id].action, 'RESEND_FAILED', 'no copy: the safety gate still judges the copy - a body that lacks the leads the row counted is refused');
      TestAssertContains_(s.reroutes[gated.id].text, 'safety gate', 'no copy: …and the alert says the gate refused it');
      const refused = TestRR_ledgerById_(ss, 'RR|' + gated.id);
      TestAssertEqual_(refused.status + ',' + refused.status_reason.indexOf('re-routed to'), 'BLOCKED,-1', 'no copy: the refused copy is BLOCKED in the ledger and carries no re-route note');
      TestAssertEqual_(s.reroutes[noId.id].action, 'NO_ID', 'no copy: a row without a Gmail message id cannot be copied');
      TestAssertContains_(s.reroutes[noId.id].text, 'every later email to ' + DEAD + ' goes to ' + BOSS, 'no copy: …but later emails are redirected, and the alert says so');
      TestAssertEqual_(s.reroutes[lost.id].action, 'RESEND_FAILED', 'no copy: a message that Gmail cannot find fails the re-send');
      TestAssertContains_(s.reroutes[lost.id].text, 'could not be read', 'no copy: …with the reason');
      TestAssertEqual_(TestGmailLog_.drafts.length, 0, 'no copy: nothing was sent');
      TestAssertEqual_(TestRR_ledgerById_(ss, 'RR|' + lost.id), null, 'no copy: no ledger row is made for a copy that was never attempted');
    }

    // ================= the re-send itself fails, then succeeds at the next check =================
    {
      const ss = TestMockSpreadsheet_({});
      TestRR_bind_(ss);
      emailRerouteWindowOpenGs_ = function () { return true; };
      emailRerouteHierarchyGs_ = function () { return TestRR_hierarchy_(); };
      const h = emailLedgerOpenGs_(ss);
      const subject = 'A1/Dead Dan/google/Leads With Issue/10 Oct 2026';
      const e1 = TestRR_ledgerRow_(ss, h, { bucket: 'Dead Dan', to: DEAD, subject: subject, messageId: 'M1' });
      const msgs = { M1: { subject: subject, html: '<p>L-100</p>', plain: 'Lead L-100' } };
      TestRR_gmail_([TestRR_bounce_(e1.finished, DEAD, subject)], msgs);
      const okMessages = GmailApp.getMessageById, okSearch = GmailApp.search, okThread = GmailApp.getThreadById;
      GmailApp = TestMockGmailApp_({ failSendCountFor: (function () { const o = {}; o[BOSS] = 99; return o; })() });
      GmailApp.getMessageById = okMessages; GmailApp.search = okSearch; GmailApp.getThreadById = okThread;
      const s = sweepEmailBouncesAndReplies_({ now: nowSweep });
      TestAssertEqual_(s.reroutes[e1.id].action, 'RESEND_FAILED', 'send fails: reported');
      TestAssertEqual_(TestRR_ledgerById_(ss, 'RR|' + e1.id).status, 'FAILED', 'send fails: the copy\'s ledger row says FAILED');
      TestAssertEqual_(TestRR_entries_(ss).length, 1, 'send fails: the redirect is in place regardless');
      GmailApp = TestMockGmailApp_({});
      GmailApp.getMessageById = okMessages; GmailApp.search = okSearch; GmailApp.getThreadById = okThread;
      const s2 = sweepEmailBouncesAndReplies_({ now: new Date(nowSweep.getTime() + 60000) });
      TestAssertEqual_(s2.reroutes[e1.id].action, 'RESENT', 'send fails: the next check re-sends it');
      const rr = TestRR_ledgerById_(ss, 'RR|' + e1.id);
      TestAssertEqual_(rr.status + ',' + rr.attempts + ',' + TestRR_ledgerRowsCount_(ss, 'RR|' + e1.id), 'ACCEPTED,2,1', 'send fails: the same ledger row is reused (two attempts, one row)');
      const s3 = sweepEmailBouncesAndReplies_({ now: new Date(nowSweep.getTime() + 120000) });
      TestAssertEqual_(s3.reroutes[e1.id].action + ',' + TestGmailLog_.drafts.filter(function (d) { return d._sent; }).length, 'ALREADY,1', 'send fails: once accepted, never again');
    }

    // ================= reports that go to the ops address are not re-routed =================
    {
      const ss = TestMockSpreadsheet_({});
      TestRR_bind_(ss);
      emailRerouteWindowOpenGs_ = function () { return true; };
      emailRerouteHierarchyGs_ = function () { return TestRR_hierarchy_(); };
      const h = emailLedgerOpenGs_(ss);
      const subject = 'Dead Dan (City Lead) google Leads With Issue';
      const e1 = TestRR_ledgerRow_(ss, h, { job: 'chLevel17', bucket: 'Dead Dan', role: 'CH', to: TOP + ',' + DEAD, subject: subject, messageId: 'M1' });
      TestRR_gmail_([TestRR_bounce_(e1.finished, DEAD, subject)], { M1: { subject: subject, html: '<p>L-100</p>', plain: 'L-100' } });
      const s = sweepEmailBouncesAndReplies_({ now: nowSweep });
      TestAssertEqual_(s.reroutes[e1.id].action + ',' + TestGmailLog_.drafts.length + ',' + (ss.getSheetByName(EMAIL_REROUTE_SHEET_) ? TestRR_entries_(ss).length : 0), 'OPS_REPORT,0,0', 'ops report: a bounce of a CH-level report only raises the alert');
    }

    // ================= TEST MODE: nothing is re-routed or re-sent =================
    {
      const ss = TestMockSpreadsheet_({});
      TestRR_bind_(ss);
      emailRerouteWindowOpenGs_ = function () { return true; };
      emailRerouteHierarchyGs_ = function () { return TestRR_hierarchy_(); };
      const h = emailLedgerOpenGs_(ss);
      const subject = 'A1/Dead Dan/google/Leads With Issue/10 Oct 2026';
      const e1 = TestRR_ledgerRow_(ss, h, { bucket: 'Dead Dan', to: DEAD, subject: subject, messageId: 'M1' });
      TestRR_gmail_([TestRR_bounce_(e1.finished, DEAD, subject)], { M1: { subject: subject, html: '<p>L-100</p>', plain: 'L-100' } });
      TEST_MODE_OVERRIDE_EMAIL_ = TEST_EMAIL_PRIMARY_;
      try {
        const s = sweepEmailBouncesAndReplies_({ now: nowSweep });
        TestAssertEqual_(s.reroutes[e1.id].action + ',' + TestGmailLog_.drafts.length + ',' + (ss.getSheetByName(EMAIL_REROUTE_SHEET_) ? 1 : 0), 'TEST_MODE,0,0', 'TEST MODE: no row, no copy');
      } finally { TEST_MODE_OVERRIDE_EMAIL_ = ''; }
    }

    // ================= the bounce-only checks =================
    {
      const ss = TestMockSpreadsheet_({});
      TestRR_bind_(ss);
      emailRerouteWindowOpenGs_ = function () { return true; };
      emailRerouteHierarchyGs_ = function () { return TestRR_hierarchy_(); };
      const h = emailLedgerOpenGs_(ss);
      const subject = 'A1/Dead Dan/google/Leads With Issue/10 Oct 2026';
      const e1 = TestRR_ledgerRow_(ss, h, { bucket: 'Dead Dan', to: DEAD, subject: subject, messageId: 'M1' });
      const e2 = TestRR_ledgerRow_(ss, h, { bucket: 'Calm Cal', to: BOSS, subject: 'Subject C', messageId: 'M2' });
      const stamp = new Date(Date.now() - 5 * 3600000);
      const sheet = ss.getSheetByName(EMAIL_LEDGER_SHEET_);
      [e1, e2].forEach(function (e) { sheet.getRange(e.rowNo, emailLedgerCol_('reply_status'), 1, 1).setValues([['REPLIED 1 (latest 2026-10-10 12:00)']]); sheet.getRange(e.rowNo, emailLedgerCol_('swept_at'), 1, 1).setValues([[stamp]]); });
      TestRR_gmail_([TestRR_bounce_(e1.finished, DEAD, subject)], { M1: { subject: subject, html: '<p>L-100</p>', plain: 'Lead L-100' } });
      GmailApp.getThreadById = function () { throw new Error('a bounce-only check must not read threads'); };
      const s = sweepEmailBouncesAndReplies_({ now: nowSweep, bouncesOnly: true });
      TestAssertEqual_(s.checked + ',' + s.bounced + ',' + s.replied, '2,1,0', 'bounce-only: both emails checked, one bounce, no reply work');
      const r1 = TestSW_row_(ss, e1.rowNo), r2 = TestSW_row_(ss, e2.rowNo);
      TestAssertEqual_(/^BOUNCED/.test(r1.bounce_status) + ',' + r2.bounce_status, 'true,NO_BOUNCE_SEEN', 'bounce-only: bounce_status is written');
      TestAssertEqual_(r1.reply_status + ',' + r2.reply_status, 'REPLIED 1 (latest 2026-10-10 12:00),REPLIED 1 (latest 2026-10-10 12:00)', 'bounce-only: reply_status is left exactly as it was');
      TestAssertEqual_(r1.swept_at.getTime() + ',' + r2.swept_at.getTime(), stamp.getTime() + ',' + stamp.getTime(), 'bounce-only: swept_at is left exactly as it was (it means "last full sweep")');
      TestAssertEqual_(s.reroutes[e1.id].action, 'RESENT', 'bounce-only: the bounce is still escalated');
      // an email only 5 minutes old is not examined; one 15 minutes old is
      const young = TestRR_ledgerRow_(ss, h, { bucket: 'Young', to: BOSS, subject: 'Subject Y', messageId: 'M3', minutesAgo: 5 });
      const older = TestRR_ledgerRow_(ss, h, { bucket: 'Older', to: BOSS, subject: 'Subject O', messageId: 'M4', minutesAgo: 15 });
      TestRR_gmail_([], {});
      GmailApp.getThreadById = function () { throw new Error('a bounce-only check must not read threads'); };
      const s2 = sweepEmailBouncesAndReplies_({ now: new Date(), bouncesOnly: true });
      TestAssertEqual_(TestSW_row_(ss, young.rowNo).bounce_status + ',' + TestSW_row_(ss, older.rowNo).bounce_status, ',NO_BOUNCE_SEEN', 'bounce-only: the minimum age is ' + EMAIL_SWEEP_MIN_AGE_MINUTES_ + ' minutes');
    }

    // ================= the checks: entry points, triggers, watchdog =================
    {
      const ss = TestMockSpreadsheet_({});
      TestRR_bind_(ss);
      TestSW_gmail_([], {});
      const calls = [];
      const realSweep = sweepEmailBouncesAndReplies_;
      sweepEmailBouncesAndReplies_ = function (o) { calls.push(JSON.stringify(o || {})); return realSweep(o); };
      try {
        sweepBouncesAfterMorning(); sweepBouncesAfterFollowup(); sweepBouncesAfterAllIssues(); sweepEmailBouncesAndReplies();
      } finally { sweepEmailBouncesAndReplies_ = realSweep; }
      TestAssertEqual_(calls.join(' '), '{"bouncesOnly":true} {"bouncesOnly":true} {"bouncesOnly":true} {}', 'entry points: the three post-email checks are bounce-only, the 15:30 one is the full sweep');
      TestAssertEqual_(EMAIL_SWEEP_SLOTS_.map(function (s) { return readEmailJobRunGs_(s.job).status; }).join(',') + ',' + readEmailJobRunGs_(EMAIL_SWEEP_JOB_).status, 'completed,completed,completed,completed', 'entry points: each is recorded under its own job name');
      const failing = function (fn) { const r = sweepEmailBouncesAndReplies_; sweepEmailBouncesAndReplies_ = function () { throw new Error('simulated'); }; try { TestAssertThrows_(fn, 'entry points: a crash is re-thrown'); } finally { sweepEmailBouncesAndReplies_ = r; } };
      failing(sweepBouncesAfterAllIssues);
      TestAssertEqual_(TestGmailLog_.sent.filter(function (m) { return /sweepBouncesAfterAllIssues crashed/.test(m.subject); }).length + ',' + readEmailJobRunGs_('sweepBouncesAfterAllIssues').status, '1,failed', 'entry points: a crash alerts once and the run record says failed');
      LockService = TestMockLockService_({ denyLock: true });
      sweepBouncesAfterMorning();
      TestAssertEqual_(LockService._state.tryLockCalls + ',' + LockService._state.getCalls, '0,0', 'entry points: the checks never take the script-wide job lock');
      LockService = TestMockLockService_();

      ScriptApp = TestMockScriptApp_(['sweepEmailBouncesAndReplies', 'sweepBouncesAfterMorning', 'sendAllIssuesEmails', 'other']);
      setupEmailSweepTrigger();
      const made = ScriptApp._state.created.map(function (c) { return c.fnName + '@' + c.hour + ':' + c.minute; }).join(' ');
      TestAssertEqual_(made, 'sweepEmailBouncesAndReplies@15:30 sweepBouncesAfterMorning@10:30 sweepBouncesAfterFollowup@13:30 sweepBouncesAfterAllIssues@17:30', 'setup: four daily triggers - 15:30 full, 10:30, 13:30, 17:30 bounce-only');
      TestAssertEqual_(ScriptApp._state.deleted.join(','), 'sweepEmailBouncesAndReplies,sweepBouncesAfterMorning', 'setup: only its own earlier triggers are deleted (the 17:00 email trigger and others are untouched)');
      TestAssert_(ScriptApp._state.created.every(function (c) { return c.tz === 'Asia/Kolkata'; }), 'setup: all in IST');

      PropertiesService = TestMockPropertiesService_();
      const sched = emailJobScheduleGs_();
      TestAssertEqual_(['sweepBouncesAfterMorning', 'sweepBouncesAfterFollowup', 'sweepBouncesAfterAllIssues'].map(function (j) { return sched[j] ? sched[j].hour + ':' + sched[j].minute : 'missing'; }).join(' '), '10:30 13:30 17:30', 'watchdog: the three checks are on the schedule');
      TestAssertEqual_(sched.sweepEmailBouncesAndReplies.hour + ':' + sched.sweepEmailBouncesAndReplies.minute + ' ' + sched.sweepEmailBouncesAndReplies.label, '15:30 15:30 bounce/reply sweep', 'watchdog: the full sweep is now 15:30');
      TestAssertContains_(sched.sweepBouncesAfterAllIssues.label, 'after the 17:00 emails', 'watchdog: a check is labelled with the email job it follows');
      const flagged = function (hhmm) { return emailJobProblemsGs_(new Date('2026-10-09T' + hhmm + ':00+05:30')).filter(function (p) { return /^sweepBouncesAfter/.test(p.job); }).map(function (p) { return p.job + ':' + p.kind; }).join(','); };
      TestAssertEqual_(flagged('10:50'), '', 'watchdog: before its deadline a check is not a problem');
      TestAssertEqual_(flagged('11:05'), 'sweepBouncesAfterMorning:never_started', 'watchdog: a 10:30 check that did not run is flagged after 11:00');
      TestAssertEqual_(flagged('18:05'), 'sweepBouncesAfterMorning:never_started,sweepBouncesAfterFollowup:never_started,sweepBouncesAfterAllIssues:never_started', 'watchdog: and the others at their own deadlines');
    }

    // ================= the reports read the outcome =================
    {
      const win = { start: new Date('2026-10-08T11:00:00.000Z'), end: new Date('2026-10-09T11:05:00.000Z') };
      const inWin = function (h) { return new Date(win.start.getTime() + h * 3600000); };
      const L = function (job, status, extra) { return Object.assign({ job: job, status: status, region: 'Pune', bucket_label: 'Dead Dan', to: 'dead@x.test', cc: '', status_reason: '', leads_sent: 2, planned_at: inWin(1), finished_at: inWin(1), email_id: 'E1', bounce_status: '', reply_status: '', swept_at: inWin(2) }, extra || {}); };
      const bounced = L('allIssues17', 'ACCEPTED', { bounce_status: 'BOUNCED 2026-10-08 17:05' });
      const copy = L('reroute', 'ACCEPTED', { email_id: 'RR|E1', to: 'boss@x.test' });
      const stage = function (data, s) { return data.checklist.filter(function (r) { return r.stage === s; })[0]; };

      const handled = cycleReportDataGs_({ window: win, ledgerRows: [bounced, copy], reroutes: [TestRR_entry_({ created_at: inWin(1), expires_at: new Date(win.end.getTime() + 86400000) })] });
      TestAssertEqual_(handled.sweep.bounced + ',' + handled.sweep.rerouted, '1,1', 'cycle report: a bounced email that was re-sent counts as re-routed');
      const att = handled.attention.filter(function (a) { return a.status === 'BOUNCED - RE-ROUTED'; })[0];
      TestAssert_(!!att && att.reason.indexOf('re-sent to boss@x.test') !== -1 && att.reason.indexOf('Manager_Directory') !== -1, 'cycle report: …and its attention line says where it went and what to fix');
      TestAssertEqual_(handled.attention.filter(function (a) { return a.status === 'BOUNCED'; }).length, 0, 'cycle report: …and is not also listed as a plain failure');
      TestAssertEqual_(stage(handled, 'J').flag, 'AMBER', 'checklist J: all bounces re-routed -> AMBER (the address still needs fixing), not RED');
      TestAssertContains_(stage(handled, 'J').evidence, 'all re-routed', 'checklist J: …and says so');
      TestAssertEqual_(handled.reroutes.length, 1, 'cycle report: the re-routes in force at the end of the cycle are listed');
      const html = cycleReportRenderGs_(handled, win.end);
      TestAssertContains_(html.plainBody, 'Re-routed addresses in force (1)', 'cycle report: the section is in the report');
      TestAssertContains_(html.plainBody, 'Boss Bea boss@x.test', 'cycle report: …naming who now receives the emails');
      TestAssertContains_(html.plainBody, 'of which re-routed to the next person', 'cycle report: …and the bounce table has the re-routed count');

      const unhandled = cycleReportDataGs_({ window: win, ledgerRows: [bounced] });
      TestAssertEqual_(unhandled.sweep.rerouted + ',' + unhandled.attention.filter(function (a) { return a.status === 'BOUNCED'; }).length + ',' + stage(unhandled, 'J').flag, '0,1,RED', 'cycle report: a bounce with no re-send is a plain BOUNCED and checklist J stays RED');
      TestAssertContains_(stage(unhandled, 'J').evidence, '1 of 1 bounced email(s) were NOT re-routed', 'checklist J: …counting the ones not re-routed');
      const failedCopy = cycleReportDataGs_({ window: win, ledgerRows: [bounced, L('reroute', 'FAILED', { email_id: 'RR|E1' })] });
      TestAssertEqual_(failedCopy.sweep.rerouted + ',' + stage(failedCopy, 'J').flag, '0,RED', 'cycle report: a re-send that FAILED is not "handled"');
      const ccOnly = cycleReportDataGs_({ window: win, ledgerRows: [bounced], reroutes: [TestRR_entry_({ note: 'cc only', source_email_id: 'E1', created_at: inWin(1), expires_at: new Date(win.end.getTime() + 86400000) })] });
      TestAssertEqual_(ccOnly.sweep.rerouted + ',' + stage(ccOnly, 'J').flag, '1,AMBER', 'cycle report: a Cc-only bounce is handled (the To person received it)');
      const mixed = cycleReportDataGs_({ window: win, ledgerRows: [bounced, copy, L('morning10', 'ACCEPTED', { email_id: 'E2', bounce_status: 'BOUNCED 2026-10-09 10:05' })] });
      TestAssertEqual_(mixed.sweep.bounced + ',' + mixed.sweep.rerouted + ',' + stage(mixed, 'J').flag, '2,1,RED', 'checklist J: one handled and one not is still RED');
      const expired = cycleReportDataGs_({ window: win, ledgerRows: [], reroutes: [TestRR_entry_({ created_at: inWin(-30), expires_at: inWin(-1) }), TestRR_entry_({ status: 'ENDED', created_at: inWin(-1), expires_at: inWin(60) })] });
      TestAssertEqual_(expired.reroutes.length, 0, 'cycle report: an expired or ended row is not listed');
      TestAssertEqual_(cycleReportRenderGs_(expired, win.end).plainBody.indexOf('Re-routed addresses in force'), -1, 'cycle report: …and with none in force there is no section');

      // the follow-up tracker
      const day = '2026-10-09';
      const tl = function (job, status, extra) { return Object.assign({ job: job, cycle_day: day, region: 'Pune', bucket_label: 'Dead Dan', to: 'dead@x.test', status: status, status_reason: '', bounce_status: '', reply_status: '', email_id: 'E1' }, extra || {}); };
      const log = [{ region: 'Pune', label: 'Dead Dan', role: 'A1', to: 'dead@x.test', leadCount: 2, cp1At: 'x', cp2At: 'y' }];
      const run = function (ledger) { return followupTrackerGs_({ cycleDay: day, logRows: log, ledgerRows: ledger, now: new Date('2026-10-10T16:30:00+05:30') }); };
      const rerouted = run([tl('allIssues17', 'ACCEPTED', { bounce_status: 'BOUNCED 2026-10-09 17:05' }), tl('reroute', 'ACCEPTED', { email_id: 'RR|E1', cycle_day: day, to: 'boss@x.test' })]);
      TestAssertEqual_(rerouted.rows[0].email + ',' + rerouted.rows[0].stop + ',' + rerouted.attention.length, 'REROUTED,false,0', 'tracker: a bounced 17:00 email that was re-routed reads REROUTED and raises no STOP');
      const stopped = run([tl('allIssues17', 'ACCEPTED', { bounce_status: 'BOUNCED 2026-10-09 17:05' })]);
      TestAssertEqual_(stopped.rows[0].email + ',' + stopped.rows[0].stop + ',' + stopped.attention[0].status, 'BOUNCED,true,STOP', 'tracker: one that could not be re-routed is still STOP');
      TestAssertContains_(stopped.attention[0].note, 'could not be re-routed', 'tracker: …and the note says so');
      const failedTracker = run([tl('allIssues17', 'ACCEPTED', { bounce_status: 'BOUNCED 2026-10-09 17:05' }), tl('reroute', 'FAILED', { email_id: 'RR|E1' })]);
      TestAssertEqual_(failedTracker.rows[0].email + ',' + failedTracker.rows[0].stop, 'BOUNCED,true', 'tracker: a failed re-send is still STOP');
      TestAssertEqual_(followupTrackerSectionsGs_(rerouted)[0].subheading.indexOf('REROUTED') !== -1, true, 'tracker: the section explains REROUTED');
    }

    TestAssertOnlyTestEmails_();
  } finally {
    emailRerouteHierarchyGs_ = realHierarchy;
    emailRerouteWindowOpenGs_ = realWindow;
    emailRerouteResetCacheGs_();
    TEST_MODE_OVERRIDE_EMAIL_ = '';
    TestEnv_tearDown_();
  }
  return TestResults_;
}

// The sheet row number of a ledger id (0 when absent).
function TestRR_rowNoOf_(ss, id) {
  const rows = TestEL_objects_(ss.getSheetByName(EMAIL_LEDGER_SHEET_), EMAIL_LEDGER_HEADERS_);
  for (let i = 0; i < rows.length; i++) if (rows[i].email_id === id) return i + 2;
  return 0;
}

function TestRR_ledgerRowsCount_(ss, id) {
  return TestEL_objects_(ss.getSheetByName(EMAIL_LEDGER_SHEET_), EMAIL_LEDGER_HEADERS_).filter(function (r) { return r.email_id === id; }).length;
}

function runEmailRerouteTestsNow() { runEmailRerouteTests_(); }
