/**
 * Tests: Email lifecycle MATRIX (2026-10-16) - the failure / branch matrix of the email lifecycle that the other suites do not
 * already assert. Plan, traceability table and defect report: docs/_planning/EMAIL_E2E_COVERAGE_2026-10-16.md.
 * Run runEmailLifecycleMatrixTestsNow() from the function dropdown, or via runAllTests() (Tests_RunAll.gs).
 *
 * Like Tests_EmailLifecycleFullCycle.gs this is an INTEGRATION suite with no production file of its own
 * (test/check-gs-registration.py lists it as such). Everything is in-memory (Tests_Mocks.gs); nothing is sent for real and the only
 * addresses used are TEST_EMAIL_PRIMARY_ / TEST_EMAIL_SECONDARY_ / TEST_EMAIL_CH_.
 *
 * WHAT IS NEW HERE (vs Tests_EmailLedger / Tests_AllIssuesEmailer / Tests_EmailSweep / Tests_CycleReport):
 *   - a fault-injecting Gmail fake that separates "the provider DELIVERED it" from "the call returned" (a timeout after delivery,
 *     a platform kill mid-send), so "no duplicate, nothing lost" is counted from what was delivered, not from what the ledger says;
 *   - first / middle / last bucket failing in a 3-region batch with exact ledger counts, retry exhaustion at the bucket level;
 *   - ledger-write faults: a result write that fails after acceptance, and a plan write that LANDS but reports an error;
 *   - recovery under a busy lock, a stale duplicate ledger row, out-of-order / duplicate bounce notices;
 *   - cycle-report aggregates checked against counts this file computes itself from a seeded random ledger;
 *   - header injection / Bcc / recipient confinement on the exact provider call, and IST day-boundary fields.
 * Assertions labelled "KNOWN DEFECT Dn" pin CURRENT (defective) production behaviour on purpose - see the defect report. When the
 * defect is fixed the assertion fails, and must be flipped to the corrected expectation.
 */

// ---- helpers ----

const TestLM_REGIONS_ = ['Bangalore', 'Pune', 'Thane']; // the send loop walks regions in sorted order: first / middle / last

// The region an outgoing email belongs to: the region whose (only) lead id it carries - every fixture lead is 'L-<REGION>' and each bucket email
// carries its own region's lead only (asserted in M1) - else the region named in a 17:00 plain body, else '?'.
function TestLM_keyOf_(text) {
  const s = String(text || '');
  const byLead = TestLM_REGIONS_.filter(function (r) { return s.indexOf('L-' + r.toUpperCase()) !== -1; });
  if (byLead.length === 1) return byLead[0];
  const m = /Leads with issue for (.+?) \(/.exec(s);
  return m ? m[1] : '?';
}

// Gmail fake with fault injection. state = { script(key, attemptNo, channel) -> null | { throwMsg, delivered } | { kill, delivered }, attempts, delivered, kill }.
// key = TestLM_keyOf_ of the email. channel = 'draft' (GmailApp) or 'thread' (the 13:00 raw threaded reply, TestLM_gmailAdv_). `delivered` = the provider
// really sent it (independent of what the call returned).
function TestLM_gmail_(state) {
  return {
    createDraft: function (to, subject, body, options) {
      const draft = { to: to, subject: subject, body: body, cc: (options && options.cc) || '', htmlBody: options && options.htmlBody, options: Object.assign({}, options || {}), key: TestLM_keyOf_(String(body) + '\n' + String((options && options.htmlBody) || '')), channel: 'draft' };
      TestGmailLog_.drafts.push(draft);
      return {
        send: function () {
          const key = draft.key;
          state.attempts[key] = (state.attempts[key] || 0) + 1;
          const out = state.script ? state.script(key, state.attempts[key], 'draft') : null;
          if (!out || out.delivered) state.delivered.push(draft);
          if (out && out.kill) throw state.kill;
          if (out && out.throwMsg) throw new Error(out.throwMsg);
          const tid = 'lm_thread_' + (TestGmailLog_.nextThreadId++);
          draft._threadId = tid;
          return { getId: function () { return 'lm_msg_' + tid; }, getThread: function () { return { getId: function () { return tid; } }; } };
        },
      };
    },
    sendEmail: function (to, subject, body, options) {
      TestGmailLog_.sent.push({ to: to, subject: subject, body: body, cc: (options && options.cc) || '', htmlBody: options && options.htmlBody });
    },
  };
}

// Advanced Gmail fake (the 13:00 threaded reply) with the same fault injection; attempts are counted under 'thread:<key>'.
function TestLM_gmailAdv_(state) {
  return {
    Users: {
      Threads: { get: function (userId, threadId) { return { messages: [{ payload: { headers: [{ name: 'Message-ID', value: '<' + threadId + '@lm>' }] } }] }; } },
      Messages: {
        send: function (payload) {
          const mime = TestOE_decodeRawMime_(payload.raw);
          const subj = (/\r\nSubject: ([^\r\n]*)/.exec('\r\n' + mime) || [])[1] || '';
          const reply = { channel: 'thread', key: TestLM_keyOf_(mime), threadId: payload.threadId, subject: subj, mime: mime };
          const n = state.attempts['thread:' + reply.key] = (state.attempts['thread:' + reply.key] || 0) + 1;
          const out = state.script ? state.script(reply.key, n, 'thread') : null;
          if (!out || out.delivered) { state.delivered.push(reply); TestGmailLog_.threadReplies.push({ threadId: payload.threadId, raw: payload.raw }); }
          if (out && out.kill) throw state.kill;
          if (out && out.throwMsg) throw new Error(out.throwMsg);
          return { id: 'lm_reply_' + (TestGmailLog_.nextThreadId++), threadId: payload.threadId };
        },
      },
    },
  };
}

// A "platform kill": an exception that cannot be handled - reading its message or turning it into text throws it again, so it escapes
// every catch block on the send path exactly like an execution killed mid-send (the code after the send never runs).
function TestLM_killObject_() {
  const kill = {};
  Object.defineProperty(kill, 'message', { get: function () { throw kill; } });
  kill.toString = function () { throw kill; };
  kill.valueOf = function () { throw kill; };
  return kill;
}

function TestLM_world_() {
  return TestEL_world_(function (header, now) {
    return TestLM_REGIONS_.map(function (r) {
      return TestEL_leadRow_(header, { lead_id: 'L-' + r.toUpperCase(), client_id: 'C-' + r.toUpperCase(), RM: 'Test RM One', region: r, lead_assigned_at: now, rm_is_active: false });
    });
  });
}

// Fresh world + fault-injecting Gmail. Returns { ss, st }.
function TestLM_start_() {
  const ss = TestLM_world_();
  TestEL_bind_(ss);
  const st = { attempts: {}, delivered: [], script: null, kill: TestLM_killObject_() };
  GmailApp = TestLM_gmail_(st);
  Gmail = TestLM_gmailAdv_(st);
  return { ss: ss, st: st };
}

// The 10:00 / 13:00 world: one lead per region, assigned yesterday 18:00 IST (inside the overnight window) and flagged by a rule that does not depend on
// the clock (the Tests_EmailLedger EO-9b fixture, three regions). Returns { ss, st }.
function TestLM_startMorning_() {
  const header = TestFixture_leadsHeader_();
  const banner = header.map(function () { return ''; });
  const eve = new Date(istDayKeyGs_(new Date(Date.now() - 24 * 3600 * 1000)) + 'T18:00:00+05:30');
  const ss = TestMockSpreadsheet_({
    'RM_Hierarchy': TestMockSheet_('RM_Hierarchy', TestFixture_rmHierarchyRows_()),
    'Manager_Directory': TestMockSheet_('Manager_Directory', TestFixture_managerDirectoryRows_()),
  });
  ss._sheets['leads'] = TestMockSheet_('leads', [banner, header].concat(TestLM_REGIONS_.map(function (r) {
    return TestEL_leadRow_(header, { lead_id: 'L-' + r.toUpperCase(), client_id: 'C-' + r.toUpperCase(), RM: 'Test RM One', region: r, current_stage: 'Not Updated', lead_assigned_at: eve });
  })));
  TestEL_bind_(ss);
  const st = { attempts: {}, delivered: [], script: null, kill: TestLM_killObject_() };
  GmailApp = TestLM_gmail_(st);
  Gmail = TestLM_gmailAdv_(st);
  return { ss: ss, st: st };
}

// The 13:00 world: the 10:00 job has run cleanly (one email per region); the counters are then cleared so only 13:00 deliveries are counted.
function TestLM_startFollowup_() {
  const w = TestLM_startMorning_();
  sendOvernightMorningEmails_();
  w.st.delivered.length = 0;
  w.st.attempts = {};
  TestGmailLog_.drafts.length = 0;
  TestGmailLog_.sent.length = 0;
  return w;
}

function TestLM_delivered_(st, key) { return st.delivered.filter(function (d) { return d.key === key; }).length; }
function TestLM_draftsFor_(key) { return TestGmailLog_.drafts.filter(function (d) { return d.key === key; }).length; }
function TestLM_deliveredSummary_(st) { return TestLM_REGIONS_.map(function (r) { return r + '=' + TestLM_delivered_(st, r); }).join(' '); }

// job: the ledger job (default the 17:00 allIssues17).
function TestLM_ledger_(ss, job) {
  const sh = ss.getSheetByName(EMAIL_LEDGER_SHEET_);
  return sh ? TestEL_objects_(sh, EMAIL_LEDGER_HEADERS_).filter(function (r) { return r.job === (job || EMAIL_LEDGER_JOB_ALL_ISSUES_); }) : [];
}
// "Bangalore=ACCEPTED/1/1 Pune=..." (status/attempts/leads_sent; 'none' when the region has no row).
function TestLM_ledgerSummary_(ss, job) {
  const rows = TestLM_ledger_(ss, job);
  return TestLM_REGIONS_.map(function (r) {
    const mine = rows.filter(function (x) { return x.region === r; });
    return r + '=' + (mine.length ? mine.map(function (x) { return x.status + '/' + x.attempts + '/' + x.leads_sent; }).join('+') : 'none');
  }).join(' ');
}
// The buckets a re-run guard skipped on the ledger's account (D5/D6): 'Region:STATUS' of every exclusion row of `job` that names an email id, sorted.
function TestLM_guardSkips_(ss, job) {
  const sh = ss.getSheetByName(EMAIL_LEDGER_EXCLUSIONS_SHEET_);
  if (!sh) return '';
  const H = EMAIL_LEDGER_EXCLUSION_HEADERS_;
  return sh._data.slice(1).filter(function (r) { return r[H.indexOf('job')] === job && r[H.indexOf('email_id')] && /re-run guard skipped this/.test(r[H.indexOf('reason')]); })
    .map(function (r) { return r[H.indexOf('region')] + ':' + (/already (\w+) today/.exec(r[H.indexOf('reason')]) || [])[1]; }).sort().join(',');
}
function TestLM_logRows_(ss) { const sh = ss.getSheetByName(ALL_ISSUES_LOG_SHEET_); return sh ? Math.max(0, sh.getLastRow() - 1) : 0; }

// Wraps every setValues on the ledger sheet: fault(row, col, values, write) decides whether to write and/or throw.
function TestLM_faultLedger_(ss, fault) {
  const sh = ss.getSheetByName(EMAIL_LEDGER_SHEET_) || (emailLedgerOpenGs_(ss), ss.getSheetByName(EMAIL_LEDGER_SHEET_));
  const realGetRange = sh.getRange;
  sh.getRange = function (row, col, numRows, numCols) {
    const rg = realGetRange.call(sh, row, col, numRows, numCols);
    const realSet = rg.setValues;
    rg.setValues = function (vals) { return fault(row, col, vals, function () { return realSet.call(rg, vals); }); };
    return rg;
  };
  return sh;
}

// Independent IST helpers (fixed +05:30, no DST) - NOT the production istDayKeyGs_/istStampGs_.
function TestLM_istKey_(d) { return new Date(d.getTime() + 19800000).toISOString().slice(0, 10); }
function TestLM_istStamp_(d) { return new Date(d.getTime() + 19800000).toISOString().slice(0, 16).replace('T', ' '); }

// Deterministic PRNG (mulberry32) so the "random" ledger is the same on every run.
function TestLM_rng_(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function runEmailLifecycleMatrixTests_() {
  TestEnv_setUp_('Tests_EmailLifecycleMatrix', TestMockSpreadsheet_({}));
  const realRender = renderOvernightReportEmailHTML_;
  const realRerouteHandler = emailRerouteHandleBouncesGs_;
  const H = EMAIL_LEDGER_HEADERS_;
  const statusIdx = emailLedgerCol_('status') - 1;
  try {
    const noon = new Date(istDayKeyGs_(new Date()) + 'T12:00:00+05:30'); // recovery "now": before every late-send cutoff, same IST day as the rows

    // ================= M1: provider timeout AFTER delivery (ambiguous) - no retry, no duplicate, ever =================
    {
      const w = TestLM_start_();
      w.st.script = function (key) { return key === 'Pune' ? { throwMsg: 'Service timed out: Gmail', delivered: true } : null; };
      sendAllIssuesEmails_();
      TestAssertEqual_(TestLM_deliveredSummary_(w.st), 'Bangalore=1 Pune=1 Thane=1', 'M1: every bucket was delivered once (Pune\'s call timed out AFTER the provider sent it)');
      TestAssertEqual_(TestLM_draftsFor_('Pune'), 1, 'M1: a timeout is not retried by withSendRetry_ - one draft, one provider call');
      TestAssertEqual_(TestLM_ledgerSummary_(w.ss), 'Bangalore=ACCEPTED/1/1 Pune=UNCONFIRMED/1/0 Thane=ACCEPTED/1/1', 'M1: the ledger says UNCONFIRMED (may have gone) for Pune, never FAILED');
      TestAssertEqual_(TestLM_logRows_(w.ss), 2, 'M1: AllIssues_Log holds only the two confirmed sends');
      w.st.script = null; // Gmail healthy again
      const rec = recoverFailedAllIssuesBuckets_({ now: noon });
      TestAssertEqual_(rec.targets.length + ',' + rec.ran, '0,false', 'M1: the recovery does not target an UNCONFIRMED bucket');
      sendAllIssuesEmails_(); // a same-day re-run of the main job
      TestAssertEqual_(TestLM_deliveredSummary_(w.st), 'Bangalore=1 Pune=1 Thane=1', 'M1: after recovery + a same-day re-run still exactly one delivery per bucket (no duplicate)');
      TestAssertEqual_(TestLM_ledger_(w.ss).length, 3, 'M1: no extra ledger rows');

      // ---- field inventory, computed independently on the real rows ----
      const rows = TestLM_ledger_(w.ss);
      const log = TestEL_objects_(w.ss.getSheetByName(ALL_ISSUES_LOG_SHEET_), ['date', 'region', 'bucket_label', 'primary_role', 'to', 'cc', 'lead_count', 'sent_at', 'thread_id', 'issue_snapshot_json']);
      rows.forEach(function (r) {
        TestAssertEqual_(r.cycle_day, TestLM_istKey_(r.planned_at), 'M1 fields: ' + r.region + ' cycle_day is the IST day of planned_at');
        TestAssert_(r.planned_at <= r.attempted_at && r.attempted_at <= r.finished_at, 'M1 fields: ' + r.region + ' planned_at <= attempted_at <= finished_at');
        TestAssertEqual_(r.email_id, r.cycle_day.replace(/-/g, '') + '|allIssues17|' + r.region + '|A1|Test A1 One', 'M1 fields: ' + r.region + ' email_id = day|job|region|role|bucket');
        // O3 (FIXED 2026-10-16): the result write records the leads the email carried - also on an UNCONFIRMED row (it may have been delivered);
        // leads_sent still counts only ACCEPTED emails. (FAILED rows keep [] - asserted in M2.)
        TestAssertEqual_(r.leads_planned + ',' + r.lead_ids_json + ',' + r.leads_sent, '1,["L-' + r.region.toUpperCase() + '"],' + (r.status === 'ACCEPTED' ? 1 : 0), 'M1 fields: ' + r.region + ' (' + r.status + ') planned lead count, lead ids kept (O3 fixed), leads_sent only when ACCEPTED');
        TestAssertEqual_(r.to + '|' + r.cc, TEST_EMAIL_PRIMARY_ + '|' + TEST_EMAIL_CH_, 'M1 fields: ' + r.region + ' recipients recorded (A1 in To, the chain CH in Cc)');
        const sentDraft = w.st.delivered.filter(function (d) { return d.key === r.region; })[0];
        TestAssertEqual_(sentDraft.to + '|' + sentDraft.cc, r.to + '|' + r.cc, 'M1 confinement: ' + r.region + ' was delivered to exactly the recipients its ledger row records');
        TestAssert_(TestLM_REGIONS_.every(function (o) { return (o === r.region) === (sentDraft.body.indexOf('L-' + o.toUpperCase()) !== -1); }), 'M1 confinement: the ' + r.region + ' email carries its own lead and no other region\'s');
        if (r.status === 'ACCEPTED') {
          const l = log.filter(function (x) { return x.region === r.region; });
          TestAssertEqual_(l.length + ',' + l[0].thread_id + ',' + r.message_id, '1,' + r.thread_id + ',lm_msg_' + r.thread_id, 'M1 fields: ' + r.region + ' AllIssues_Log thread_id = ledger thread_id, message id recorded');
          TestAssertEqual_(TestLM_istKey_(l[0].date) + ',' + l[0].lead_count, r.cycle_day + ',1', 'M1 fields: ' + r.region + ' log row day (IST) and lead_count');
        }
      });

      // ---- D4 (FIXED 2026-10-16): the 17:00 ledger rows record the subject that was sent, so a bounce later than 15 minutes is attributed ----
      const bRow = rows.filter(function (r) { return r.region === 'Bangalore'; })[0];
      const bSubject = w.st.delivered.filter(function (d) { return d.key === 'Bangalore'; })[0].subject;
      TestAssertEqual_(bRow.subject, 'Test A1 One (A1) google Leads With Issue ' + allIssuesDateRangeLabelGs_(allIssuesWindowGs_(bRow.planned_at)), 'D4 fixed: the 17:00 plan records the bucket subject in Email_Ledger');
      TestAssertEqual_(bRow.subject, bSubject, 'D4 fixed: ...exactly the subject the provider received');
      TestAssert_(rows.every(function (r) { return r.subject === w.st.delivered.filter(function (d) { return d.key === r.region; })[0].subject; }), 'D4 fixed: every 17:00 row (ACCEPTED and UNCONFIRMED) holds its own sent subject');
      const bounceAt = function (min, subj) { return { at: new Date(bRow.finished_at.getTime() + min * 60000), subject: 'Delivery Status Notification (Failure)', body: 'Your message wasn\'t delivered to ' + TEST_EMAIL_PRIMARY_ + '\nSubject: ' + (subj === undefined ? bSubject : subj) }; };
      TestAssert_(emailSweepMatchBounceGs_(bRow, [bounceAt(5)]) !== null, 'D4 control: a bounce 5 minutes after the send IS attributed (the quick-bounce rule)');
      TestAssert_(emailSweepMatchBounceGs_(bRow, [bounceAt(40)]) !== null, 'D4 fixed: a bounce 40 minutes later that quotes the exact subject IS attributed');
      TestAssert_(emailSweepMatchBounceGs_(bRow, [bounceAt(40, 'Some other email')]) === null, 'D4 control: a bounce 40 minutes later quoting a different subject is still not attributed');
    }

    // ================= M2: partial batch - first / middle / last bucket refused, retries exhausted; then recovered =================
    TestLM_REGIONS_.forEach(function (target, pos) {
      const w = TestLM_start_();
      w.st.script = function (key) { return key === target ? { throwMsg: 'Gmail operation not allowed for this user', delivered: false } : null; };
      sendAllIssuesEmails_();
      const expectLedger = TestLM_REGIONS_.map(function (r) { return r + '=' + (r === target ? 'FAILED/1/0' : 'ACCEPTED/1/1'); }).join(' ');
      const expectDelivered = TestLM_REGIONS_.map(function (r) { return r + '=' + (r === target ? 0 : 1); }).join(' ');
      const label = 'M2[' + ['first', 'middle', 'last'][pos] + '=' + target + ']: ';
      TestAssertEqual_(TestLM_ledgerSummary_(w.ss), expectLedger, label + 'exact ledger state - one FAILED, its siblings ACCEPTED');
      TestAssertEqual_(TestLM_ledger_(w.ss).filter(function (r) { return r.region === target; })[0].lead_ids_json, '[]', label + 'a FAILED row records no lead ids (unchanged by the O3 fix)');
      TestAssertEqual_(TestLM_deliveredSummary_(w.st), expectDelivered, label + 'nothing delivered for the refused bucket, siblings unaffected');
      TestAssertEqual_(TestLM_draftsFor_(target), 3, label + 'retry exhaustion: 3 provider attempts (3 drafts), then FAILED');
      TestAssertEqual_(TestLM_logRows_(w.ss), 2, label + 'AllIssues_Log holds only the two delivered buckets');
      TestAssert_(TestGmailLog_.sent.some(function (e) { return e.body.indexOf('L-' + target.toUpperCase()) !== -1; }), label + 'ops are told which lead was not sent');
      w.st.script = null;
      const rec = recoverFailedAllIssuesBuckets_({ now: noon });
      TestAssertEqual_(rec.targets.map(function (t) { return t.region + ':' + t.status; }).join(','), target + ':FAILED', label + 'the recovery targets exactly the failed bucket');
      TestAssertEqual_(TestLM_deliveredSummary_(w.st), 'Bangalore=1 Pune=1 Thane=1', label + 'after recovery: every bucket delivered exactly once');
      TestAssertEqual_(TestLM_ledgerSummary_(w.ss), TestLM_REGIONS_.map(function (r) { return r + '=' + (r === target ? 'ACCEPTED/2/1' : 'ACCEPTED/1/1'); }).join(' '), label + 'after recovery: the target took a 2nd attempt, the siblings were not touched');
      TestAssertEqual_(TestLM_logRows_(w.ss), 3, label + 'after recovery: one log row per bucket');
    });

    // ---- M2b: refused twice, then accepted on the provider's 3rd try - one delivery, ledger attempt count stays 1 ----
    {
      const w = TestLM_start_();
      w.st.script = function (key, n) { return key === 'Pune' && n <= 2 ? { throwMsg: 'Gmail operation not allowed', delivered: false } : null; };
      sendAllIssuesEmails_();
      TestAssertEqual_(TestLM_draftsFor_('Pune') + ',' + TestLM_delivered_(w.st, 'Pune'), '3,1', 'M2b: 3 drafts (EI-5: two orphan drafts left behind), exactly one delivery');
      TestAssertEqual_(TestLM_ledgerSummary_(w.ss), 'Bangalore=ACCEPTED/1/1 Pune=ACCEPTED/1/1 Thane=ACCEPTED/1/1', 'M2b: the ledger counts bucket attempts, not provider retries');
    }

    // ================= M3: the run is KILLED mid-send (Pune delivered, the run died before recording it) =================
    {
      const w = TestLM_start_();
      w.st.script = function (key, n) { return key === 'Pune' && n === 1 ? { kill: true, delivered: true } : null; };
      let killed = false;
      try { sendAllIssuesEmails_(); } catch (e) { killed = (e === w.st.kill); }
      TestAssert_(killed, 'M3: the kill escaped the job (nothing after the send ran)');
      TestAssertEqual_(TestLM_ledgerSummary_(w.ss), 'Bangalore=ACCEPTED/1/1 Pune=ATTEMPTING/1/0 Thane=none', 'M3: Pune is left ATTEMPTING (outcome unknown), Thane was never planned');
      TestAssertEqual_(TestLM_deliveredSummary_(w.st), 'Bangalore=1 Pune=1 Thane=0', 'M3: before any repair - Thane lost so far, Pune delivered');
      const rec = recoverFailedAllIssuesBuckets_({ now: noon });
      TestAssertEqual_(rec.targets.length, 0, 'M3: the recovery alone finds nothing (ATTEMPTING is never re-sent; Thane has no row) - see the coverage doc, operator must re-run the main job');
      sendAllIssuesEmails_();
      TestAssertEqual_(TestLM_deliveredSummary_(w.st), 'Bangalore=1 Pune=1 Thane=1', 'M3: a same-day re-run of the main job sends Thane and repeats neither Bangalore nor Pune - nothing lost, no duplicate');
      TestAssertEqual_(TestLM_ledgerSummary_(w.ss), 'Bangalore=ACCEPTED/1/1 Pune=ATTEMPTING/1/0 Thane=ACCEPTED/1/1', 'M3: Pune stays ATTEMPTING (a human must check it), Thane ACCEPTED');
      const ex = TestEL_objects_(w.ss.getSheetByName(EMAIL_LEDGER_EXCLUSIONS_SHEET_), EMAIL_LEDGER_EXCLUSION_HEADERS_);
      TestAssertEqual_(ex.filter(function (x) { return x.kind === 'region' && /already sent today/.test(x.reason); }).map(function (x) { return x.region; }).sort().join(','), 'Bangalore,Pune', 'M3: the re-run records exactly the two regions its guard skipped');
    }

    // ---- M3b: killed BEFORE the attempt (while building Pune's email): the main re-run alone repairs everything ----
    {
      const w = TestLM_start_();
      let thrown = false;
      renderOvernightReportEmailHTML_ = function (opts) {
        if (!thrown && JSON.stringify(opts).indexOf('L-PUNE') !== -1) { thrown = true; throw new Error('simulated: killed while building the Pune email'); }
        return realRender.apply(null, arguments);
      };
      try { TestAssertThrows_(function () { sendAllIssuesEmails_(); }, 'M3b: the crash surfaces'); } finally { renderOvernightReportEmailHTML_ = realRender; }
      TestAssertEqual_(TestLM_ledgerSummary_(w.ss), 'Bangalore=ACCEPTED/1/1 Pune=PLANNED/0/0 Thane=none', 'M3b: Pune PLANNED (never attempted), Thane never planned');
      sendAllIssuesEmails_();
      TestAssertEqual_(TestLM_deliveredSummary_(w.st), 'Bangalore=1 Pune=1 Thane=1', 'M3b: the re-run sends Pune and Thane once each');
      TestAssertEqual_(TestLM_ledgerSummary_(w.ss), 'Bangalore=ACCEPTED/1/1 Pune=ACCEPTED/1/1 Thane=ACCEPTED/1/1', 'M3b: Pune\'s existing row is reused (no second row), one attempt');
      TestAssertEqual_(recoverFailedAllIssuesBuckets_({ now: noon }).targets.length, 0, 'M3b: nothing left for the recovery');
    }

    // ================= M4: Gmail ACCEPTED, then the ledger RESULT write fails =================
    {
      const w = TestLM_start_();
      emailLedgerOpenGs_(w.ss); // creates the tabs so the fault can be installed
      const attCol = emailLedgerCol_('attempted_at');
      const sh = TestLM_faultLedger_(w.ss, function (row, col, vals, write) {
        if (col === attCol && vals[0][statusIdx - (attCol - 1)] === 'ACCEPTED' && String(sh._data[row - 1][0]).indexOf('|Pune|') !== -1) throw new Error('simulated: Sheets rejected the ledger write');
        return write();
      });
      sendAllIssuesEmails_();
      TestAssertEqual_(TestLM_ledgerSummary_(w.ss), 'Bangalore=ACCEPTED/1/1 Pune=ATTEMPTING/1/0 Thane=ACCEPTED/1/1', 'M4: the sheet still says ATTEMPTING for Pune (its result write failed)');
      TestAssertEqual_(TestLM_delivered_(w.st, 'Pune') + ',' + TestLM_logRows_(w.ss), '1,3', 'M4: the email itself went out and AllIssues_Log recorded it (fail-open)');
      TestAssert_(TestGmailLog_.sent.some(function (e) { return /Email ledger: 1 write\(s\) failed/.test(e.subject); }), 'M4: ops get ONE "ledger write failed" note');
      TestAssertEqual_(recoverFailedAllIssuesBuckets_({ now: noon }).targets.length, 0, 'M4: the recovery does not re-send it');
      sendAllIssuesEmails_();
      TestAssertEqual_(TestLM_deliveredSummary_(w.st), 'Bangalore=1 Pune=1 Thane=1', 'M4: a same-day re-run does not re-send it either (no duplicate)');
    }

    // ================= M5 / D1 (FIXED 2026-10-16): the PLAN write lands but reports an error -> the block is re-located by email_id -> no re-send =================
    [true, false].forEach(function (landed) {
      const w = TestLM_start_();
      emailLedgerOpenGs_(w.ss);
      let fired = false;
      TestLM_faultLedger_(w.ss, function (row, col, vals, write) {
        if (!fired && col === 1 && String(vals[0][0]).indexOf('|Pune|') !== -1 && vals[0][statusIdx] === 'PLANNED') {
          fired = true;
          if (landed) write(); // the append really landed (or, the control case, did not)...
          throw new Error('simulated: Sheets reported an error on the plan write'); // ...but the call failed (non-transient: not retried)
        }
        return write();
      });
      const label = landed ? 'D1 fixed (write landed): ' : 'D1 control (write did not land): ';
      sendAllIssuesEmails_();
      TestAssertEqual_(TestLM_delivered_(w.st, 'Pune') + ',' + TestLM_logRows_(w.ss), '1,3', label + 'Pune was delivered and logged in AllIssues_Log');
      TestAssertEqual_(TestLM_ledgerSummary_(w.ss), landed ? 'Bangalore=ACCEPTED/1/1 Pune=ACCEPTED/1/1 Thane=ACCEPTED/1/1' : 'Bangalore=ACCEPTED/1/1 Pune=none Thane=ACCEPTED/1/1',
        label + (landed ? 'the landed row is found by its email_id and records the attempt and the acceptance' : 'no row exists, none is invented'));
      TestAssert_(TestGmailLog_.sent.some(function (e) { return /Email ledger: 1 write\(s\) failed/.test(e.subject); }), label + 'ops still get ONE "ledger write failed" note');
      const rec = recoverFailedAllIssuesBuckets_({ now: noon });
      TestAssertEqual_(rec.targets.length, 0, label + 'the recovery finds nothing to re-send');
      TestAssertEqual_(TestLM_delivered_(w.st, 'Pune'), 1, label + 'Pune delivered exactly once (no duplicate)');
    });

    // ================= M6 / D2 (FIXED 2026-10-16): a stale duplicate ledger row of an email that may already have gone =================
    // The real row is ACCEPTED / UNCONFIRMED / ATTEMPTING; a stale FAILED (or PLANNED) copy of the same email_id sits above or below it.
    [['ACCEPTED', true], ['UNCONFIRMED', false], ['ATTEMPTING', true]].forEach(function (c) {
      ['FAILED', 'PLANNED'].forEach(function (staleStatus) {
        const w = TestLM_start_();
        sendAllIssuesEmails_();
        const sh = w.ss.getSheetByName(EMAIL_LEDGER_SHEET_);
        const i = sh._data.findIndex(function (r) { return String(r[0]).indexOf('|Pune|') !== -1; });
        sh._data[i][statusIdx] = c[0];
        const stale = sh._data[i].slice();
        stale[statusIdx] = staleStatus;
        sh._data.splice(c[1] ? i : i + 1, 0, stale); // e.g. a row restored from a backup copy / a manual edit, above (or below) the real one
        const label = 'D2 fixed [' + c[0] + ' + stale ' + staleStatus + ' ' + (c[1] ? 'above' : 'below') + ']: ';
        const rec = recoverFailedAllIssuesBuckets_({ now: noon });
        TestAssertEqual_(rec.targets.length + ',' + rec.ran, '0,false', label + 'the email id is not a recovery target');
        TestAssertEqual_(TestLM_delivered_(w.st, 'Pune'), 1, label + 'Pune delivered exactly once (no duplicate)');
      });
    });
    // ---- control: two stale FAILED copies of an id that never went out -> ONE target, ONE delivery ----
    {
      const w = TestLM_start_();
      w.st.script = function (key) { return key === 'Pune' ? { throwMsg: 'Gmail operation not allowed', delivered: false } : null; };
      sendAllIssuesEmails_();
      w.st.script = null;
      const sh = w.ss.getSheetByName(EMAIL_LEDGER_SHEET_);
      const i = sh._data.findIndex(function (r) { return String(r[0]).indexOf('|Pune|') !== -1; });
      sh._data.splice(i, 0, sh._data[i].slice());
      const rec = recoverFailedAllIssuesBuckets_({ now: noon });
      TestAssertEqual_(rec.targets.map(function (t) { return t.region + ':' + t.status; }).join(','), 'Pune:FAILED', 'D2 control: two FAILED rows of one never-sent id are ONE target');
      TestAssertEqual_(TestLM_delivered_(w.st, 'Pune'), 1, 'D2 control: ...and it is recovered (delivered once)');
    }

    // ================= M7: recovery while another email job holds the script lock =================
    {
      const w = TestLM_start_();
      w.st.script = function (key) { return key === 'Pune' ? { throwMsg: 'Gmail operation not allowed', delivered: false } : null; };
      sendAllIssuesEmails_();
      w.st.script = null;
      LockService = TestMockLockService_({ denyLock: true });
      const sentBefore = TestGmailLog_.sent.length;
      recoverFailedAllIssuesBucketsNow();
      TestAssertEqual_(TestLM_delivered_(w.st, 'Pune'), 0, 'M7: lock busy - the recovery sends nothing');
      TestAssertEqual_(TestLM_ledgerSummary_(w.ss).split(' ')[1], 'Pune=FAILED/1/0', 'M7: lock busy - the FAILED row is untouched (still recoverable)');
      TestAssertEqual_(LockService._state.tryLockCalls + ',' + LockService._state.releases, '1,0', 'M7: one lock attempt, nothing to release (never acquired)');
      TestAssert_(TestGmailLog_.sent.slice(sentBefore).some(function (e) { return /recoverAllIssuesBuckets SKIPPED/.test(e.subject); }), 'M7: ops are told the recovery was skipped');
      LockService = TestMockLockService_();
    }

    // ================= M8: the bounce sweep - out-of-order and duplicate bounce notices; a bounce older than the send =================
    {
      emailRerouteHandleBouncesGs_ = function () { return {}; }; // the escalation has its own suite
      const ss = TestMockSpreadsheet_({});
      TestSW_bind_(ss);
      const h = emailLedgerOpenGs_(ss);
      const subjA = 'LMA (A1) google Leads With Issue (14-Oct-2026 to 16-Oct-2026)';
      const subjB = 'LMB (A1) google Leads With Issue (14-Oct-2026 to 16-Oct-2026)';
      const a = TestSW_ledgerRow_(ss, h, { bucket: 'LMA', to: TEST_EMAIL_PRIMARY_, subject: subjA, threadId: 't-lma', minutesAgo: 120 });
      const b = TestSW_ledgerRow_(ss, h, { bucket: 'LMB', to: TEST_EMAIL_SECONDARY_, subject: subjB, threadId: 't-lmb', minutesAgo: 60 });
      const daemon = 'Mail Delivery Subsystem <mailer-daemon@googlemail.com>';
      const bounce = function (addr, at, subj) { return TestSW_msg_(daemon, at, 'Delivery Status Notification (Failure)', 'Your message wasn\'t delivered to ' + addr + ' because the address couldn\'t be found.\nSubject: ' + subj); };
      const b1 = bounce(TEST_EMAIL_PRIMARY_, new Date(a.finished.getTime() + 3 * 60000), subjA);
      const b2 = bounce(TEST_EMAIL_PRIMARY_, new Date(a.finished.getTime() + 20 * 60000), subjA); // a second notice for the same email
      const b0 = bounce(TEST_EMAIL_SECONDARY_, new Date(b.finished.getTime() - 5 * 60000), subjB); // older than B's send: about some earlier mail
      const alerts = function () { return TestGmailLog_.sent.filter(function (e) { return /Email BOUNCED/.test(e.subject); }).length; };
      TestSW_gmail_([b2, b0, b1], { 't-lma': [], 't-lmb': [] });
      const s1 = sweepEmailBouncesAndReplies_({ now: new Date() });
      TestAssertEqual_(s1.bounced + ',' + s1.newBounces.length + ',' + alerts(), '1,1,1', 'M8: two notices for one email = ONE bounce, ONE alert');
      TestAssertEqual_(TestSW_row_(ss, a.rowNo).bounce_status, 'BOUNCED ' + TestLM_istStamp_(b1.getDate()), 'M8 (O2 fixed): the stamp is the EARLIEST matching notice (b1), not the first in search order (b2)');
      TestAssertEqual_(TestSW_row_(ss, b.rowNo).bounce_status, 'NO_BOUNCE_SEEN', 'M8: a notice older than the send is never attributed to it');
      TestSW_gmail_([b1, b0, b2], { 't-lma': [], 't-lmb': [] }); // the search returns them in the other order
      const s2 = sweepEmailBouncesAndReplies_({ now: new Date() });
      TestAssertEqual_(s2.bounced + ',' + s2.newBounces.length + ',' + alerts(), '1,0,1', 'M8: a re-sweep in a different order raises no second alert');
      TestAssertEqual_(TestSW_row_(ss, a.rowNo).bounce_status, 'BOUNCED ' + TestLM_istStamp_(b1.getDate()), 'M8 (O2 fixed): a re-sweep in the other order records the same (earliest) stamp');
      TestSW_gmail_([b2, b0], { 't-lma': [], 't-lmb': [] }); // the earlier notice has dropped out of the search; only the later one is seen
      const s3 = sweepEmailBouncesAndReplies_({ now: new Date() });
      TestAssertEqual_(s3.bounced + ',' + s3.newBounces.length + ',' + alerts(), '1,0,1', 'M8: the later notice alone is still the same bounce - no new alert');
      TestAssertEqual_(TestSW_row_(ss, a.rowNo).bounce_status, 'BOUNCED ' + TestLM_istStamp_(b1.getDate()), 'M8 (O2 fixed): an already-recorded earlier time is never overwritten by a later one');
      TestAssert_(TestLM_istStamp_(b1.getDate()) !== TestLM_istStamp_(b2.getDate()), 'M8 (set-up): the two notices have different minute stamps');
      emailRerouteHandleBouncesGs_ = realRerouteHandler;

      // ---- suspected defect D3 REFUTED: a 13:00 reply's bounce is not attributed to the 10:00 row ----
      const t10 = new Date(a.finished.getTime() - 3 * 3600000);
      const subj10 = 'Pune Google Overnight Leads (16 Oct 2026)';
      // Since the D4 fix the 10:00 row records its own subject, so the guard is now the "re: " rule in emailSweepQuotesSubjectGs_ (EmailSweep.gs).
      const row10 = { job: 'morning10', status: 'ACCEPTED', finished_at: t10, to: TEST_EMAIL_PRIMARY_, cc: '', subject: subj10 };
      const row13 = { job: 'followup13', status: 'ACCEPTED', finished_at: new Date(t10.getTime() + 3 * 3600000), to: TEST_EMAIL_PRIMARY_, cc: '', subject: subj10 }; // the 13:00 plan stores the 10:00 subject (OvernightEmailer.gs, follow-up plan)
      const dsn = function (at, quoted) { return { at: at, subject: 'Delivery Status Notification (Failure)', body: 'Your message wasn\'t delivered to ' + TEST_EMAIL_PRIMARY_ + '\nSubject: ' + quoted }; };
      const reply = dsn(new Date(row13.finished_at.getTime() + 3 * 60000), 'Re: ' + subj10);
      const lateReply = dsn(new Date(row13.finished_at.getTime() + 40 * 60000), 'Re: ' + subj10);
      TestAssert_(emailSweepMatchBounceGs_(row13, [reply]) !== null, 'D3: the 13:00 reply\'s bounce is attributed to the 13:00 row');
      TestAssert_(emailSweepMatchBounceGs_(row13, [lateReply]) !== null, 'D3: ...also 40 minutes later, by its "Re: " subject');
      TestAssert_(emailSweepMatchBounceGs_(row10, [reply]) === null && emailSweepMatchBounceGs_(row10, [lateReply]) === null, 'D3 still refuted after the D4 fix: the 13:00 reply\'s bounce is NOT attributed to the 10:00 row of the same thread (subject now recorded)');
      TestAssert_(emailSweepMatchBounceGs_(row10, [dsn(new Date(t10.getTime() + 40 * 60000), subj10)]) !== null, 'D4 fixed (10:00): a 40-minute-late bounce quoting the 10:00 subject IS attributed to the 10:00 row');
      TestAssert_(emailSweepMatchBounceGs_(row13, [dsn(new Date(row13.finished_at.getTime() + 40 * 60000), subj10)]) === null, 'D3: a late bounce quoting the bare 10:00 subject is not the 13:00 reply\'s');
    }

    // ================= M9: cycle-report aggregates vs a seeded random ledger, counted independently =================
    {
      const rnd = TestLM_rng_(20261016);
      const pick = function (arr) { return arr[Math.floor(rnd() * arr.length)]; };
      const start = new Date('2026-10-15T16:30:00+05:30'), end = new Date('2026-10-16T16:30:00+05:30');
      const jobs = ['allIssues17', 'chLevel17', 'morning10', 'chLevel10', 'followup13', 'reroute'];
      const statuses = ['PLANNED', 'ATTEMPTING', 'ACCEPTED', 'ACCEPTED', 'ACCEPTED', 'FAILED', 'UNCONFIRMED', 'BLOCKED', 'SKIPPED', '', 'WEIRD'];
      const special = [start, end, new Date(start.getTime() - 1), new Date(end.getTime() + 1)];
      const ledgerRows = [];
      for (let k = 0; k < 120; k++) {
        const t = k < special.length ? special[k] : new Date(start.getTime() - 20 * 3600000 + Math.floor(rnd() * 46 * 3600000));
        ledgerRows.push({ email_id: 'LM9-' + k, job: pick(jobs), region: pick(TestLM_REGIONS_), bucket_label: 'B' + k, to: TEST_EMAIL_PRIMARY_, status: pick(statuses), planned_at: t, leads_sent: Math.floor(rnd() * 6), status_reason: '' });
      }
      const exclusionRows = [];
      for (let k = 0; k < 40; k++) exclusionRows.push({ recorded_at: new Date(start.getTime() - 6 * 3600000 + Math.floor(rnd() * 36 * 3600000)), kind: rnd() < 0.3 ? 'region' : 'lead', reason: pick(['already sent today', 'no recipient', 'the lead has no id']) });

      // ---- the expected numbers, from first principles ----
      const inWin = function (t) { return t.getTime() >= start.getTime() && t.getTime() < end.getTime(); }; // [start, end) - end exclusive since 2026-10-16 (O1)
      const blank = function () { return { planned: 0, accepted: 0, skipped: 0, failed: 0, unconfirmed: 0, blocked: 0, unfinished: 0, leadsSent: 0 }; };
      const expTotals = blank(), expByJob = {};
      let expAttention = 0;
      ledgerRows.forEach(function (r) {
        if (!inWin(r.planned_at)) return;
        [expTotals, expByJob[r.job] = expByJob[r.job] || blank()].forEach(function (c) {
          c.planned++;
          if (r.status === 'ACCEPTED') { c.accepted++; c.leadsSent += r.leads_sent; } else if (r.status === 'SKIPPED') c.skipped++;
          else if (r.status === 'FAILED') c.failed++; else if (r.status === 'UNCONFIRMED') c.unconfirmed++; else if (r.status === 'BLOCKED') c.blocked++;
          else c.unfinished++;
        });
        if (r.status !== 'ACCEPTED' && r.status !== 'SKIPPED') expAttention++;
      });
      let expLeadsOut = 0, expRegions = 0;
      exclusionRows.forEach(function (x) { if (inWin(x.recorded_at)) { if (x.kind === 'region') expRegions++; else expLeadsOut++; } });
      const fmt = function (c) { return ['planned', 'accepted', 'skipped', 'failed', 'unconfirmed', 'blocked', 'unfinished', 'leadsSent'].map(function (k) { return k + '=' + c[k]; }).join(' '); };
      TestAssertEqual_(expTotals.planned > 20 && expTotals.accepted > 0 && expTotals.unfinished > 0, true, 'M9 (set-up): the seeded ledger exercises every bucket of the count');

      const data = cycleReportDataGs_({ window: { start: start, end: end, boundary: end }, ledgerRows: ledgerRows, exclusionRows: exclusionRows, incidentRows: [] });
      TestAssertEqual_(fmt(data.totals), fmt(expTotals), 'M9: totals equal the independent count');
      TestAssertEqual_(Object.keys(data.byJob).sort().map(function (j) { return j + '{' + fmt(data.byJob[j]) + '}'; }).join(' '),
        Object.keys(expByJob).sort().map(function (j) { return j + '{' + fmt(expByJob[j]) + '}'; }).join(' '), 'M9: per-job counts equal the independent count');
      TestAssertEqual_(data.attemptable + ',' + data.exclusions.leads + ',' + data.exclusions.regions + ',' + data.attention.length + ',' + data.allClear,
        (expTotals.planned - expTotals.skipped) + ',' + expLeadsOut + ',' + expRegions + ',' + expAttention + ',false', 'M9: attemptable, left-out leads, skipped regions, attention rows, all-clear');
      const sumJobs = Object.keys(data.byJob).reduce(function (s, j) { return s + data.byJob[j].planned; }, 0);
      TestAssertEqual_(sumJobs, data.totals.planned, 'M9: the per-job rows add up to the total');

      // ---- the same rows through the real sheet reader (buildEmailCycleReportGs_) ----
      const ss = TestLM_world_();
      TestEL_bind_(ss);
      const toRow = function (o, headers) { return headers.map(function (h) { return o[h] === undefined ? '' : o[h]; }); };
      const sorted = ledgerRows.slice().sort(function (x, y) { return x.planned_at - y.planned_at; });
      ss._sheets[EMAIL_LEDGER_SHEET_] = TestMockSheet_(EMAIL_LEDGER_SHEET_, [EMAIL_LEDGER_HEADERS_].concat(sorted.map(function (o) { return toRow(Object.assign({ cycle_day: TestLM_istKey_(o.planned_at) }, o), EMAIL_LEDGER_HEADERS_); })));
      const exSorted = exclusionRows.slice().sort(function (x, y) { return x.recorded_at - y.recorded_at; });
      ss._sheets[EMAIL_LEDGER_EXCLUSIONS_SHEET_] = TestMockSheet_(EMAIL_LEDGER_EXCLUSIONS_SHEET_, [EMAIL_LEDGER_EXCLUSION_HEADERS_].concat(exSorted.map(function (o) { return toRow(Object.assign({ cycle_day: TestLM_istKey_(o.recorded_at) }, o), EMAIL_LEDGER_EXCLUSION_HEADERS_); })));
      const built = buildEmailCycleReportGs_(ss, end, { scheduled: true });
      TestAssertEqual_(fmt(built.data.totals), fmt(expTotals), 'M9: the report built from the sheets has the same totals');
      TestAssertEqual_(built.data.exclusions.leads + ',' + built.data.exclusions.regions, expLeadsOut + ',' + expRegions, 'M9: ...and the same exclusion counts');

      // ---- O1 (FIXED 2026-10-16): the window is [start, end), so a row planned exactly at 16:30:00.000 is in exactly ONE report (the next one) ----
      const nextWin = cycleReportWindowGs_(new Date('2026-10-17T16:30:00+05:30'));
      TestAssertEqual_(nextWin.start.getTime(), end.getTime(), 'M9 (O1, set-up): the next cycle starts at this cycle\'s end');
      TestAssertEqual_(cycleReportInWindowGs_(end, { start: start, end: end }) + ',' + cycleReportInWindowGs_(end, nextWin), 'false,true', 'M9 (O1 fixed): the 16:30:00.000 instant belongs to the next cycle only');
      TestAssertEqual_(cycleReportInWindowGs_(new Date(end.getTime() - 1), { start: start, end: end }) + ',' + cycleReportInWindowGs_(new Date(end.getTime() - 1), nextWin), 'true,false', 'M9 (O1 fixed): 16:29:59.999 belongs to this cycle only');
      TestAssertEqual_(cycleReportInWindowGs_(start, { start: start, end: end }), true, 'M9 (O1 fixed): the start instant is inclusive');
    }

    // ================= M10: header injection, Bcc, recipient confinement on the exact provider call =================
    {
      const ss = TestLM_world_();
      TestEL_bind_(ss);
      const captured = [];
      GmailApp = {
        createDraft: function (to, subject, body, options) {
          captured.push({ to: to, subject: subject, options: Object.assign({}, options || {}) });
          TestGmailLog_.drafts.push({ to: to, subject: subject, body: body, cc: (options && options.cc) || '', htmlBody: options && options.htmlBody });
          return { send: function () { return { getId: function () { return 'm'; }, getThread: function () { return { getId: function () { return 't-inj'; } }; } }; } };
        },
        sendEmail: function (to, subject, body, options) { TestGmailLog_.sent.push({ to: to, subject: subject, body: body, cc: (options && options.cc) || '' }); },
      };
      const now = new Date();
      const win = allIssuesWindowGs_(now);
      const logSheet = ensureAllIssuesLogSheet_(ss);
      const leads = [{ lead_id: 'L-INJ', RM: 'Test RM One', TL: 'Test A1 One', region: 'Pune', status: 'New', issueLabel: 'Not Updated', followup: 'Call', staleSince: '' }];
      const injected = '\r\nBcc: ' + TEST_EMAIL_SECONDARY_;
      const ok = sendOneAllIssuesEmail_(ss, logSheet, 'Pune', { to: TEST_EMAIL_PRIMARY_, cc: TEST_EMAIL_CH_, bucketLabel: 'Test A1 One' + injected, primaryRole: 'A1', source: 'test', rmNames: ['Test RM One'] }, leads, 'x', istDayKeyGs_(now), now, win, null);
      TestAssertEqual_(ok + ',' + captured.length, 'null,1', 'M10: a line break in a bucket label does not stop the send');
      TestAssert_(!/[\r\n]/.test(captured[0].subject), 'M10: the subject reaching the provider has no CR/LF (no header can be injected)');
      TestAssertEqual_(Object.keys(captured[0].options).sort().join(','), 'cc,htmlBody,name', 'M10: the provider call carries only name/cc/htmlBody - no bcc, replyTo or from');
      TestAssertEqual_(captured[0].to + '|' + captured[0].options.cc, TEST_EMAIL_PRIMARY_ + '|' + TEST_EMAIL_CH_, 'M10: To/Cc are exactly the resolved recipients; the injected address is in neither');
      const blocked = sendOneAllIssuesEmail_(ss, logSheet, 'Pune', { to: TEST_EMAIL_PRIMARY_ + injected, cc: '', bucketLabel: 'Test A1 One', primaryRole: 'A1', source: 'test', rmNames: ['Test RM One'] }, leads, 'x', istDayKeyGs_(now), now, win, null);
      TestAssert_(blocked && /BLOCKED/.test(blocked.reason) && captured.length === 1, 'M10: a line break in the To address is blocked before any draft exists');

      sendThreadedGmailReply_('t-inj', TEST_EMAIL_PRIMARY_, '', 'Re: X' + injected, 'L-1 plain', '<p>L-1</p>');
      const mime = TestOE_decodeRawMime_(TestGmailLog_.threadReplies[TestGmailLog_.threadReplies.length - 1].raw);
      const head = mime.split('\r\n\r\n')[0].split('\r\n');
      TestAssert_(!head.some(function (l) { return /^bcc:/i.test(l); }), 'M10: the raw threaded reply has no Bcc header');
      TestAssertEqual_(head.filter(function (l) { return /^subject:/i.test(l); }).length + ',' + head.filter(function (l) { return /^to:/i.test(l); }).join(''), '1,To: ' + TEST_EMAIL_PRIMARY_, 'M10: exactly one Subject header and To is only the recipient');
    }

    // ================= M11: IST day boundaries =================
    {
      const before = new Date('2026-10-16T18:29:59.999Z'), after = new Date('2026-10-16T18:30:00.000Z');
      TestAssertEqual_(istDayKeyGs_(before) + ',' + istDayKeyGs_(after), TestLM_istKey_(before) + ',' + TestLM_istKey_(after), 'M11: the IST day flips at 18:30:00.000 UTC');
      TestAssertEqual_(TestLM_istKey_(before) + ',' + TestLM_istKey_(after), '2026-10-16,2026-10-17', 'M11: (the independent helper agrees with the calendar)');
      [[18, 30], [12, 45], [16, 0]].forEach(function (c) {
        const at = new Date('2026-10-16T' + pad2Gs_(c[0]) + ':' + pad2Gs_(c[1]) + ':00.000+05:30');
        TestAssertEqual_(emailLateCutoffPassedGs_(at, c[0], c[1]) + ',' + emailLateCutoffPassedGs_(new Date(at.getTime() + 1), c[0], c[1]), 'false,true', 'M11: the ' + c[0] + ':' + pad2Gs_(c[1]) + ' IST late-send cutoff is exclusive at the exact instant');
      });
      const mk = function (o) { return H.map(function (h) { return o[h] === undefined ? '' : o[h]; }); };
      const ss = TestMockSpreadsheet_({});
      ss._sheets[EMAIL_LEDGER_SHEET_] = TestMockSheet_(EMAIL_LEDGER_SHEET_, [H,
        mk({ email_id: 'Y', cycle_day: '2026-10-15', job: 'allIssues17', region: 'Pune', status: 'FAILED' }),
        mk({ email_id: 'T', cycle_day: new Date('2026-10-16T00:10:00+05:30'), job: 'allIssues17', region: 'Pune', status: 'FAILED' }), // a cell Sheets turned into a Date (UTC day is still the 15th)
      ]);
      const ids = function (now) { return emailLedgerRecoveryTargetsGs_(ss, now, 'allIssues17').map(function (t) { return t.emailId; }).join(','); };
      TestAssertEqual_(ids(new Date('2026-10-15T23:59:59.999+05:30')), 'Y', 'M11: one millisecond before IST midnight only that day\'s failed bucket is recoverable');
      TestAssertEqual_(ids(new Date('2026-10-16T00:00:00.000+05:30')), 'T', 'M11: at IST midnight yesterday\'s failure is no longer a target; a Date cell is read by its IST day');
    }

    // ================= M12: the same fault matrix for the 10:00 job (sendOvernightMorningEmails_, ledger job morning10) =================
    const J10 = EMAIL_LEDGER_JOB_MORNING_, J13 = EMAIL_LEDGER_JOB_FOLLOWUP_;
    const allOnce = 'Bangalore=1 Pune=1 Thane=1';
    const opsNote = function () { return TestGmailLog_.sent.filter(function (e) { return /Email ledger: 1 write\(s\) failed/.test(e.subject); }).length; };
    // M12a: provider timeout AFTER delivery - UNCONFIRMED, no retry, no duplicate after recovery + a same-day re-run
    {
      const w = TestLM_startMorning_();
      w.st.script = function (key) { return key === 'Pune' ? { throwMsg: 'Service timed out: Gmail', delivered: true } : null; };
      sendOvernightMorningEmails_();
      TestAssertEqual_(TestLM_deliveredSummary_(w.st), allOnce, 'M12a 10:00: every bucket delivered once (Pune\'s call timed out AFTER the provider sent it)');
      TestAssertEqual_(TestLM_draftsFor_('Pune'), 1, 'M12a 10:00: a timeout is not retried - one provider call');
      TestAssertEqual_(TestLM_ledgerSummary_(w.ss, J10), 'Bangalore=ACCEPTED/1/1 Pune=UNCONFIRMED/1/0 Thane=ACCEPTED/1/1', 'M12a 10:00: Pune UNCONFIRMED, never FAILED');
      const pune = TestLM_ledger_(w.ss, J10).filter(function (r) { return r.region === 'Pune'; })[0];
      TestAssertEqual_(pune.lead_ids_json, '["L-PUNE"]', 'M12a 10:00 (O3 fixed): the UNCONFIRMED row keeps the lead it may have delivered');
      TestAssert_(TestLM_ledger_(w.ss, J10).every(function (r) { return r.subject && r.subject === w.st.delivered.filter(function (d) { return d.key === r.region; })[0].subject; }), 'M12a 10:00 (D4 fixed): every morning10 row records exactly the subject the provider received');
      const late = { at: new Date(pune.finished_at.getTime() + 40 * 60000), subject: 'Delivery Status Notification (Failure)', body: 'Your message wasn\'t delivered to ' + pune.to + '\nSubject: ' + pune.subject };
      TestAssert_(emailSweepMatchBounceGs_(pune, [late]) !== null, 'M12a 10:00 (D4 fixed): a bounce 40 minutes after the send that quotes the subject is attributed to the real row');
      w.st.script = null;
      const rec = recoverFailedMorningBuckets_({ now: noon });
      TestAssertEqual_(rec.targets.length + ',' + rec.ran, '0,false', 'M12a 10:00: the recovery does not target an UNCONFIRMED bucket');
      TestAssertEqual_(TestLM_deliveredSummary_(w.st), allOnce, 'M12a 10:00: after the recovery still exactly one delivery per bucket');
      sendOvernightMorningEmails_(); // a same-day MANUAL re-run of the main job
      TestAssertEqual_(TestLM_deliveredSummary_(w.st), allOnce, 'M12a 10:00 (D5 fixed): a same-day re-run does not re-send the UNCONFIRMED Pune email (the ledger shows it may have been sent)');
      TestAssertEqual_(TestLM_ledgerSummary_(w.ss, J10), 'Bangalore=ACCEPTED/1/1 Pune=UNCONFIRMED/1/0 Thane=ACCEPTED/1/1', 'M12a 10:00 (D5 fixed): the re-run leaves every row as it was - Pune stays UNCONFIRMED for a human to check');
      TestAssertEqual_(TestLM_guardSkips_(w.ss, J10), 'Pune:UNCONFIRMED', 'M12a 10:00 (D5 fixed): the ledger-only skip is recorded once in Email_Ledger_Exclusions with its email id and status (Bangalore/Thane are skipped by the Overnight_Log guard first, as before)');
      TestAssertEqual_(TestLM_ledger_(w.ss, J10).length, 3, 'M12a 10:00: no extra ledger rows');
    }
    // M12b: partial batch - first / middle / last refused, retries exhausted (3 provider attempts), then recovered
    TestLM_REGIONS_.forEach(function (target, pos) {
      const w = TestLM_startMorning_();
      w.st.script = function (key) { return key === target ? { throwMsg: 'Gmail operation not allowed for this user', delivered: false } : null; };
      sendOvernightMorningEmails_();
      const label = 'M12b 10:00 [' + ['first', 'middle', 'last'][pos] + '=' + target + ']: ';
      TestAssertEqual_(TestLM_ledgerSummary_(w.ss, J10), TestLM_REGIONS_.map(function (r) { return r + '=' + (r === target ? 'FAILED/1/0' : 'ACCEPTED/1/1'); }).join(' '), label + 'exact ledger state - one FAILED, its siblings ACCEPTED');
      TestAssertEqual_(TestLM_deliveredSummary_(w.st), TestLM_REGIONS_.map(function (r) { return r + '=' + (r === target ? 0 : 1); }).join(' '), label + 'nothing delivered for the refused bucket, siblings unaffected');
      TestAssertEqual_(TestLM_draftsFor_(target), 3, label + 'retry exhaustion: 3 provider attempts, then FAILED');
      w.st.script = null;
      const rec = recoverFailedMorningBuckets_({ now: noon });
      TestAssertEqual_(rec.targets.map(function (t) { return t.region + ':' + t.status; }).join(','), target + ':FAILED', label + 'the recovery targets exactly the failed bucket');
      TestAssertEqual_(TestLM_deliveredSummary_(w.st), allOnce, label + 'after recovery: every bucket delivered exactly once');
      TestAssertEqual_(TestLM_ledgerSummary_(w.ss, J10), TestLM_REGIONS_.map(function (r) { return r + '=' + (r === target ? 'ACCEPTED/2/1' : 'ACCEPTED/1/1'); }).join(' '), label + 'after recovery: the target took a 2nd attempt, siblings untouched');
    });
    // M12c: refused twice, accepted on the provider's 3rd try - one delivery, one ledger attempt
    {
      const w = TestLM_startMorning_();
      w.st.script = function (key, n) { return key === 'Pune' && n <= 2 ? { throwMsg: 'Gmail operation not allowed', delivered: false } : null; };
      sendOvernightMorningEmails_();
      TestAssertEqual_(TestLM_draftsFor_('Pune') + ',' + TestLM_delivered_(w.st, 'Pune'), '3,1', 'M12c 10:00: 3 provider attempts, exactly one delivery');
      TestAssertEqual_(TestLM_ledgerSummary_(w.ss, J10), 'Bangalore=ACCEPTED/1/1 Pune=ACCEPTED/1/1 Thane=ACCEPTED/1/1', 'M12c 10:00: the ledger counts bucket attempts, not provider retries');
    }
    // M12d: the run is KILLED mid-send (Pune delivered, nothing after the send ran)
    {
      const w = TestLM_startMorning_();
      w.st.script = function (key, n) { return key === 'Pune' && n === 1 ? { kill: true, delivered: true } : null; };
      let killed = false;
      try { sendOvernightMorningEmails_(); } catch (e) { killed = (e === w.st.kill); }
      TestAssert_(killed, 'M12d 10:00: the kill escaped the job');
      TestAssertEqual_(TestLM_ledgerSummary_(w.ss, J10), 'Bangalore=ACCEPTED/1/1 Pune=ATTEMPTING/1/0 Thane=none', 'M12d 10:00: Pune left ATTEMPTING (outcome unknown), Thane never planned');
      TestAssertEqual_(TestLM_deliveredSummary_(w.st), 'Bangalore=1 Pune=1 Thane=0', 'M12d 10:00: before any repair - Pune delivered, Thane not yet');
      TestAssertEqual_(recoverFailedMorningBuckets_({ now: noon }).targets.length, 0, 'M12d 10:00: the recovery alone re-sends nothing (ATTEMPTING is never re-sent; Thane has no row)');
      sendOvernightMorningEmails_(); // the repair the 17:00 job allows (M3): a same-day MANUAL re-run of the main job
      TestAssertEqual_(TestLM_delivered_(w.st, 'Thane') + ',' + TestLM_delivered_(w.st, 'Bangalore'), '1,1', 'M12d 10:00: the re-run sends the lost Thane email and does not repeat Bangalore');
      TestAssertEqual_(TestLM_delivered_(w.st, 'Pune') + ',' + TestLM_ledgerSummary_(w.ss, J10), '1,Bangalore=ACCEPTED/1/1 Pune=ATTEMPTING/1/0 Thane=ACCEPTED/1/1', 'M12d 10:00 (D5 fixed): ...and does not re-send the ATTEMPTING (possibly delivered) Pune email; its row is left ATTEMPTING for a human');
    }
    // M12f (D5 regression): a FAILED bucket is NOT "already sent" - a same-day manual re-run still sends it (only ACCEPTED / ATTEMPTING / UNCONFIRMED are skipped)
    {
      const w = TestLM_startMorning_();
      w.st.script = function (key) { return key === 'Pune' ? { throwMsg: 'Gmail operation not allowed for this user', delivered: false } : null; };
      sendOvernightMorningEmails_();
      TestAssertEqual_(TestLM_ledgerSummary_(w.ss, J10), 'Bangalore=ACCEPTED/1/1 Pune=FAILED/1/0 Thane=ACCEPTED/1/1', 'M12f 10:00: set-up - Pune FAILED');
      w.st.script = null;
      sendOvernightMorningEmails_(); // a same-day MANUAL re-run of the main job, not the recovery
      TestAssertEqual_(TestLM_deliveredSummary_(w.st), allOnce, 'M12f 10:00 (D5 regression): the re-run re-sends the FAILED Pune email and repeats neither ACCEPTED sibling');
      TestAssertEqual_(TestLM_ledgerSummary_(w.ss, J10), 'Bangalore=ACCEPTED/1/1 Pune=ACCEPTED/2/1 Thane=ACCEPTED/1/1', 'M12f 10:00 (D5 regression): the FAILED row is reused (2nd attempt), not duplicated');
      TestAssertEqual_(TestLM_guardSkips_(w.ss, J10), '', 'M12f 10:00 (D5 regression): nothing is recorded as skipped by the ledger guard');
    }
    // M12g (D5): an ACCEPTED bucket whose Overnight_Log row is missing (the OE-03 append failure) is not re-sent by a re-run either
    {
      const w = TestLM_startMorning_();
      sendOvernightMorningEmails_();
      const ol = w.ss.getSheetByName(OVERNIGHT_LOG_SHEET_);
      const before = ol._data.length;
      ol._data = ol._data.filter(function (r, i) { return i === 0 || r[1] !== 'Pune'; });
      TestAssertEqual_(before - ol._data.length, 1, 'M12g 10:00: set-up - the Pune Overnight_Log row removed (as if its append had failed)');
      sendOvernightMorningEmails_();
      TestAssertEqual_(TestLM_deliveredSummary_(w.st), allOnce, 'M12g 10:00 (D5 fixed): the re-run does not repeat the ACCEPTED Pune email (the ledger shows it sent with the same leads)');
      TestAssertEqual_(TestLM_guardSkips_(w.ss, J10), 'Pune:ACCEPTED', 'M12g 10:00 (D5 fixed): the skip is recorded in Email_Ledger_Exclusions');
    }
    // M12e: Gmail ACCEPTED, then the ledger RESULT write fails
    {
      const w = TestLM_startMorning_();
      const attCol = emailLedgerCol_('attempted_at');
      const sh = TestLM_faultLedger_(w.ss, function (row, col, vals, write) {
        if (col === attCol && vals[0][statusIdx - (attCol - 1)] === 'ACCEPTED' && String(sh._data[row - 1][0]).indexOf('|' + J10 + '|Pune|') !== -1) throw new Error('simulated: Sheets rejected the ledger write');
        return write();
      });
      sendOvernightMorningEmails_();
      TestAssertEqual_(TestLM_ledgerSummary_(w.ss, J10), 'Bangalore=ACCEPTED/1/1 Pune=ATTEMPTING/1/0 Thane=ACCEPTED/1/1', 'M12e 10:00: the sheet still says ATTEMPTING for Pune');
      TestAssertEqual_(TestLM_delivered_(w.st, 'Pune') + ',' + opsNote(), '1,1', 'M12e 10:00: the email went out, ops get ONE "ledger write failed" note');
      TestAssertEqual_(recoverFailedMorningBuckets_({ now: noon }).targets.length, 0, 'M12e 10:00: the recovery does not re-send it');
      sendOvernightMorningEmails_();
      TestAssertEqual_(TestLM_deliveredSummary_(w.st), allOnce, 'M12e 10:00: a same-day re-run does not re-send it either');
    }

    // ================= M13: the same fault matrix for the 13:00 job (sendOvernightFollowupEmails_, ledger job followup13) =================
    const threads = function (st, key) { return st.delivered.filter(function (d) { return d.key === key && d.channel === 'thread'; }).length; };
    // M13a: threaded send times out AFTER delivery - UNCONFIRMED, no plain fallback, no duplicate after recovery + re-run
    {
      const w = TestLM_startFollowup_();
      TestAssertEqual_(TestLM_ledgerSummary_(w.ss, J10), 'Bangalore=ACCEPTED/1/1 Pune=ACCEPTED/1/1 Thane=ACCEPTED/1/1', 'M13 (set-up): the 10:00 emails all went out');
      w.st.script = function (key, n, ch) { return key === 'Pune' && ch === 'thread' ? { throwMsg: 'Service timed out: Gmail', delivered: true } : null; };
      sendOvernightFollowupEmails_();
      TestAssertEqual_(TestLM_deliveredSummary_(w.st), allOnce, 'M13a 13:00: every reply delivered once (Pune\'s call timed out AFTER the provider sent it)');
      TestAssertEqual_(w.st.attempts['thread:Pune'] + ',' + TestLM_draftsFor_('Pune'), '1,0', 'M13a 13:00: no retry and NO plain fallback copy after an ambiguous failure');
      TestAssertEqual_(TestLM_ledgerSummary_(w.ss, J13), 'Bangalore=ACCEPTED/1/1 Pune=UNCONFIRMED/1/0 Thane=ACCEPTED/1/1', 'M13a 13:00: Pune UNCONFIRMED');
      TestAssertEqual_(TestLM_ledger_(w.ss, J13).filter(function (r) { return r.region === 'Pune'; })[0].lead_ids_json, '["L-PUNE"]', 'M13a 13:00 (O3 fixed): the UNCONFIRMED reply keeps its lead');
      TestAssert_(w.st.delivered.every(function (d) { return d.subject === 'Re: ' + TestLM_ledger_(w.ss, J10).filter(function (r) { return r.region === d.key; })[0].subject; }), 'M13a 13:00: each reply\'s subject is "Re: " + its 10:00 row\'s recorded subject');
      w.st.script = null;
      const rec = recoverFailedFollowupBuckets_({ now: noon });
      TestAssertEqual_(rec.targets.length + ',' + rec.ran, '0,false', 'M13a 13:00: the recovery does not target an UNCONFIRMED reply');
      sendOvernightFollowupEmails_();
      TestAssertEqual_(TestLM_deliveredSummary_(w.st), allOnce, 'M13a 13:00: after recovery + a same-day re-run still exactly one reply per bucket');
      TestAssertEqual_(TestLM_ledger_(w.ss, J13).length, 3, 'M13a 13:00: no extra ledger rows');
    }
    // M13b: partial batch - first / middle / last: the threaded send AND the plain fallback are refused (retries exhausted), then recovered
    TestLM_REGIONS_.forEach(function (target, pos) {
      const w = TestLM_startFollowup_();
      w.st.script = function (key) { return key === target ? { throwMsg: 'Gmail operation not allowed for this user', delivered: false } : null; };
      sendOvernightFollowupEmails_();
      const label = 'M13b 13:00 [' + ['first', 'middle', 'last'][pos] + '=' + target + ']: ';
      TestAssertEqual_(TestLM_ledgerSummary_(w.ss, J13), TestLM_REGIONS_.map(function (r) { return r + '=' + (r === target ? 'FAILED/1/0' : 'ACCEPTED/1/1'); }).join(' '), label + 'exact ledger state - one FAILED, its siblings ACCEPTED');
      TestAssertEqual_(TestLM_deliveredSummary_(w.st), TestLM_REGIONS_.map(function (r) { return r + '=' + (r === target ? 0 : 1); }).join(' '), label + 'nothing delivered for the refused reply, siblings unaffected');
      TestAssertEqual_(w.st.attempts['thread:' + target] + ',' + TestLM_draftsFor_(target), '3,3', label + 'retry exhaustion: 3 threaded attempts, then 3 plain-fallback attempts, then FAILED');
      w.st.script = null;
      const rec = recoverFailedFollowupBuckets_({ now: noon });
      TestAssertEqual_(rec.targets.map(function (t) { return t.region + ':' + t.status; }).join(','), target + ':FAILED', label + 'the recovery targets exactly the failed reply');
      TestAssertEqual_(TestLM_deliveredSummary_(w.st) + ',' + threads(w.st, target), allOnce + ',1', label + 'after recovery: every reply delivered exactly once, the recovered one threaded');
      TestAssertEqual_(TestLM_ledgerSummary_(w.ss, J13), TestLM_REGIONS_.map(function (r) { return r + '=' + (r === target ? 'ACCEPTED/2/1' : 'ACCEPTED/1/1'); }).join(' '), label + 'after recovery: the target took a 2nd attempt, siblings untouched');
    });
    // M13c: the threaded send is refused for good, the plain fallback is accepted - one delivery, ACCEPTED
    {
      const w = TestLM_startFollowup_();
      w.st.script = function (key, n, ch) { return key === 'Pune' && ch === 'thread' ? { throwMsg: 'Gmail operation not allowed', delivered: false } : null; };
      sendOvernightFollowupEmails_();
      TestAssertEqual_(w.st.attempts['thread:Pune'] + ',' + TestLM_draftsFor_('Pune') + ',' + TestLM_delivered_(w.st, 'Pune'), '3,1,1', 'M13c 13:00: 3 threaded attempts, then ONE plain fallback that is delivered');
      TestAssertEqual_(TestLM_ledgerSummary_(w.ss, J13), 'Bangalore=ACCEPTED/1/1 Pune=ACCEPTED/1/1 Thane=ACCEPTED/1/1', 'M13c 13:00: the fallback counts as ACCEPTED, one ledger attempt');
    }
    // M13d: the run is KILLED mid-send (Pune's reply delivered, nothing after it ran). The 13:00 job plans every reply up front, so Thane is PLANNED.
    {
      const w = TestLM_startFollowup_();
      w.st.script = function (key, n, ch) { return key === 'Pune' && ch === 'thread' && n === 1 ? { kill: true, delivered: true } : null; };
      let killed = false;
      try { sendOvernightFollowupEmails_(); } catch (e) { killed = (e === w.st.kill); }
      TestAssert_(killed, 'M13d 13:00: the kill escaped the job');
      TestAssertEqual_(TestLM_ledgerSummary_(w.ss, J13), 'Bangalore=ACCEPTED/1/1 Pune=ATTEMPTING/1/0 Thane=PLANNED/0/0', 'M13d 13:00: Pune left ATTEMPTING, Thane PLANNED (never attempted)');
      TestAssertEqual_(TestLM_deliveredSummary_(w.st), 'Bangalore=1 Pune=1 Thane=0', 'M13d 13:00: before any repair - Pune delivered, Thane not yet');
      const rec = recoverFailedFollowupBuckets_({ now: noon });
      TestAssertEqual_(rec.targets.map(function (t) { return t.region + ':' + t.status; }).join(','), 'Thane:PLANNED', 'M13d 13:00: the recovery targets only the never-attempted Thane reply (never the ATTEMPTING one)');
      TestAssertEqual_(TestLM_deliveredSummary_(w.st), allOnce, 'M13d 13:00: after recovery - nothing lost, no duplicate');
      TestAssertEqual_(TestLM_ledgerSummary_(w.ss, J13), 'Bangalore=ACCEPTED/1/1 Pune=ATTEMPTING/1/0 Thane=ACCEPTED/1/1', 'M13d 13:00: after the recovery Pune stays ATTEMPTING (a human must check it), Thane ACCEPTED');
      sendOvernightFollowupEmails_(); // a same-day MANUAL re-run of the main job
      TestAssertEqual_(TestLM_delivered_(w.st, 'Pune') + ',' + TestLM_delivered_(w.st, 'Thane') + ',' + TestLM_delivered_(w.st, 'Bangalore'), '1,1,1', 'M13d 13:00 (D6 fixed): a same-day re-run does not re-send the ATTEMPTING (possibly delivered) Pune reply, although the killed run never wrote its followup_sent_at');
      TestAssertEqual_(TestLM_ledgerSummary_(w.ss, J13), 'Bangalore=ACCEPTED/1/1 Pune=ATTEMPTING/1/0 Thane=ACCEPTED/1/1', 'M13d 13:00 (D6 fixed): the re-run leaves Pune ATTEMPTING for a human');
      TestAssertEqual_(TestLM_guardSkips_(w.ss, J13), 'Pune:ATTEMPTING', 'M13d 13:00 (D6 fixed): the ledger-only skip is recorded in Email_Ledger_Exclusions (Bangalore/Thane are skipped by followup_sent_at first, as before)');
    }
    // M13f (D6 regression): a FAILED reply is NOT "already sent" - a same-day manual re-run still sends it, threaded
    {
      const w = TestLM_startFollowup_();
      w.st.script = function (key) { return key === 'Pune' ? { throwMsg: 'Gmail operation not allowed for this user', delivered: false } : null; };
      sendOvernightFollowupEmails_();
      TestAssertEqual_(TestLM_ledgerSummary_(w.ss, J13), 'Bangalore=ACCEPTED/1/1 Pune=FAILED/1/0 Thane=ACCEPTED/1/1', 'M13f 13:00: set-up - Pune FAILED');
      w.st.script = null;
      sendOvernightFollowupEmails_(); // a same-day MANUAL re-run of the main job, not the recovery
      TestAssertEqual_(TestLM_deliveredSummary_(w.st) + ',' + threads(w.st, 'Pune'), allOnce + ',1', 'M13f 13:00 (D6 regression): the re-run re-sends the FAILED Pune reply (threaded) and repeats neither ACCEPTED sibling');
      TestAssertEqual_(TestLM_ledgerSummary_(w.ss, J13), 'Bangalore=ACCEPTED/1/1 Pune=ACCEPTED/2/1 Thane=ACCEPTED/1/1', 'M13f 13:00 (D6 regression): the FAILED row is reused (2nd attempt), not duplicated');
    }
    // M13e: the reply is ACCEPTED, then the ledger RESULT write fails
    {
      const w = TestLM_startFollowup_();
      const attCol = emailLedgerCol_('attempted_at');
      const sh = TestLM_faultLedger_(w.ss, function (row, col, vals, write) {
        if (col === attCol && vals[0][statusIdx - (attCol - 1)] === 'ACCEPTED' && String(sh._data[row - 1][0]).indexOf('|' + J13 + '|Pune|') !== -1) throw new Error('simulated: Sheets rejected the ledger write');
        return write();
      });
      sendOvernightFollowupEmails_();
      TestAssertEqual_(TestLM_ledgerSummary_(w.ss, J13), 'Bangalore=ACCEPTED/1/1 Pune=ATTEMPTING/1/0 Thane=ACCEPTED/1/1', 'M13e 13:00: the sheet still says ATTEMPTING for Pune');
      TestAssertEqual_(TestLM_delivered_(w.st, 'Pune') + ',' + opsNote(), '1,1', 'M13e 13:00: the reply went out, ops get ONE "ledger write failed" note');
      TestAssertEqual_(recoverFailedFollowupBuckets_({ now: noon }).targets.length, 0, 'M13e 13:00: the recovery does not re-send it');
      sendOvernightFollowupEmails_();
      TestAssertEqual_(TestLM_deliveredSummary_(w.st), allOnce, 'M13e 13:00: a same-day re-run does not re-send it either');
    }

    TestAssertOnlyTestEmails_();
  } catch (e) {
    let msg;
    try { msg = e && e.stack ? e.stack : String(e); } catch (unprintable) { msg = '(an unprintable error - the simulated kill escaped a scenario)'; }
    TestAssert_(false, 'Tests_EmailLifecycleMatrix threw: ' + msg);
  } finally {
    renderOvernightReportEmailHTML_ = realRender;
    emailRerouteHandleBouncesGs_ = realRerouteHandler;
    LockService = TestMockLockService_();
    Gmail = TestMockGmailAdvanced_({});
  }
  return TestEnv_tearDown_();
}

function runEmailLifecycleMatrixTestsNow() { runEmailLifecycleMatrixTests_(); }
