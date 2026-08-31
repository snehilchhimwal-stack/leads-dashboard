/**
 * Tests: Mocks & Harness — shared, reusable test infrastructure for every
 * other Tests_*.gs file. Nothing in here tests anything itself; it's the
 * "how do we fake SpreadsheetApp/GmailApp/Utilities/ScriptApp/Gmail and
 * assert on the result" layer every test file builds on. Mirrors the
 * production split's own Core.gs — one shared foundation, everything else
 * depends on it.
 *
 * ============================== WHY THIS IS SAFE ==============================
 * Every test run REASSIGNS the global SpreadsheetApp/GmailApp/Utilities/
 * ScriptApp/Gmail identifiers to in-memory fakes for the duration of that
 * one function call, then restores the real ones in a `finally` block —
 * the exact same "swap the global, always restore it" pattern used to
 * unit-test Apps Script in the wild (there's no official mocking API,
 * because Apps Script's built-in services are ordinary reassignable
 * globals under the hood, not frozen/immutable). NOTHING here ever calls
 * the real SpreadsheetApp/GmailApp against your real spreadsheet or a
 * real inbox — every "sheet" is a plain in-memory object, every "email"
 * is a JS object pushed into an array (TestGmailLog_.sent /
 * TestGmailLog_.drafts), never actually transmitted anywhere. You can run
 * the whole suite as many times as you like without it touching a single
 * real row or sending a single real message.
 *
 * EMAIL SCOPE: per explicit request, every test fixture email resolves to
 * ONLY one of two addresses — TEST_EMAIL_PRIMARY_ (ordinary manager/RM
 * recipient) and TEST_EMAIL_CH_ (CH-level/leadership alerts, which
 * already matches the real CH_LEVEL_EMAIL_ constant). To make that
 * literally true even for the leadership-Cc and ops-alert paths (which
 * read real hardcoded constants — OPS_ALERT_EMAIL_, CH_LEVEL_EMAIL_,
 * ALWAYS_CC_EMAILS_, LEADERSHIP_NAME_TO_EMAIL_), those 5 constants were
 * changed from `const` to `let` in EmailInfra.gs/RmHierarchy.gs (see each
 * one's own comment) so TestEnv_setUp_ below can reassign them here and
 * TestEnv_tearDown_ can restore the real values afterward — nothing in
 * real production code ever reassigns them itself. TestAssertOnlyTestEmails_
 * (below) then asserts, after every test file runs, that literally
 * nothing else ever slipped into a captured send.
 *
 * ============================== SETUP ==============================
 * Paste this in as its own file, alongside every other file in this
 * project (see Core.gs's own header for the full production file list).
 * Then add Tests_Core.gs, Tests_SlaEngine.gs, Tests_FollowupEngine.gs,
 * Tests_EmailInfra.gs, Tests_RmHierarchy.gs, Tests_MovementTracker.gs,
 * Tests_OvernightEmailer.gs, Tests_AllIssuesEmailer.gs, and Tests_RunAll.gs.
 * Run `runAllTests` from the function dropdown to run everything, or any
 * single file's own `runXyzTestsNow` to run just that one concern.
 * ================================================================================
 */

const TEST_EMAIL_PRIMARY_ = 'snehil.chhimwal@gmail.com';
const TEST_EMAIL_CH_ = 'ashish.ivlekar@homesfy.in';
const TEST_ALLOWED_EMAILS_ = [TEST_EMAIL_PRIMARY_, TEST_EMAIL_CH_];

// ============================== Assertions ==============================

// Reset at the start of every runXyzTests() function — see TestEnv_setUp_.
let TestResults_ = null;

function TestResults_reset_(fileLabel) {
  TestResults_ = { file: fileLabel, pass: 0, fail: 0, failures: [] };
}

function TestAssert_(condition, description) {
  if (!TestResults_) throw new Error('TestAssert_ called outside a test run — call TestEnv_setUp_ first.');
  if (condition) {
    TestResults_.pass++;
  } else {
    TestResults_.fail++;
    TestResults_.failures.push(description);
    Logger.log('  FAIL: ' + description);
  }
}

function TestAssertEqual_(actual, expected, description) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  TestAssert_(ok, description + ' (expected ' + JSON.stringify(expected) + ', got ' + JSON.stringify(actual) + ')');
}

function TestAssertContains_(haystack, needle, description) {
  const ok = String(haystack || '').indexOf(needle) !== -1;
  TestAssert_(ok, description + ' (expected to find "' + needle + '" in "' + String(haystack).slice(0, 200) + '...")');
}

function TestAssertThrows_(fn, description) {
  let threw = false;
  try { fn(); } catch (e) { threw = true; }
  TestAssert_(threw, description + ' (expected this to throw, it did not)');
}

// Scans every captured send (drafts + plain sendEmail calls) across the
// whole run and fails if ANY To/Cc address is not one of the two allowed
// test addresses — the literal enforcement of "only use these two emails
// for the test" the whole mock setup exists to make possible. Call this
// once at the end of a test file, after everything it does has run.
function TestAssertOnlyTestEmails_() {
  const allEmails = [];
  TestGmailLog_.sent.concat(TestGmailLog_.drafts).forEach(function (e) {
    (String(e.to || '').split(',')).concat(String(e.cc || '').split(',')).forEach(function (addr) {
      const trimmed = addr.trim();
      if (trimmed) allEmails.push(trimmed);
    });
  });
  const stray = allEmails.filter(function (e) { return TEST_ALLOWED_EMAILS_.indexOf(e) === -1; });
  TestAssert_(stray.length === 0, 'No email besides ' + TEST_ALLOWED_EMAILS_.join('/') + ' appears in any captured send' +
    (stray.length ? (' — found: ' + Array.from(new Set(stray)).join(', ')) : ''));
}

// ============================== Mock Sheet / Spreadsheet ==============================

function TestMockRange_(sheet, row, col, numRows, numCols) {
  return {
    getValues: function () {
      const out = [];
      for (let r = 0; r < numRows; r++) {
        const rowVals = [];
        for (let c = 0; c < numCols; c++) {
          const existingRow = sheet._data[row - 1 + r];
          rowVals.push(existingRow ? (existingRow[col - 1 + c] === undefined ? '' : existingRow[col - 1 + c]) : '');
        }
        out.push(rowVals);
      }
      return out;
    },
    getValue: function () { return this.getValues()[0][0]; },
    setValues: function (values) {
      for (let r = 0; r < values.length; r++) {
        const targetRow = row - 1 + r;
        while (sheet._data.length <= targetRow) sheet._data.push([]);
        for (let c = 0; c < values[r].length; c++) {
          sheet._data[targetRow][col - 1 + c] = values[r][c];
        }
      }
      sheet._syncDims_();
      return this;
    },
    setValue: function (v) { return this.setValues([[v]]); },
    setNumberFormat: function () { return this; }, // formatting is inert in-memory — nothing reads it back in this suite
    insertCheckboxes: function () { return this; }, // same — booleans are already written as real booleans by setValues
    clearContent: function () {
      for (let r = 0; r < numRows; r++) {
        const targetRow = row - 1 + r;
        if (sheet._data[targetRow]) {
          for (let c = 0; c < numCols; c++) sheet._data[targetRow][col - 1 + c] = '';
        }
      }
      return this;
    },
    // Real Range.sort(sortSpecObj) column indices are absolute sheet
    // columns (1 = A), not relative to the range's own start column —
    // matters here since every real caller's range happens to start at
    // column 1 too, so this stays correct either way. Stable multi-key
    // sort restricted to this range's own row span, same "only within
    // the range" semantics as the real API. Added for
    // upsertDailyCohortHistoryRowsGs_ (MovementTracker.gs), the first
    // production caller to need it.
    sort: function (sortSpecs) {
      const specs = Array.isArray(sortSpecs) ? sortSpecs : [sortSpecs];
      const rows = [];
      for (let r = 0; r < numRows; r++) rows.push(sheet._data[row - 1 + r] || []);
      rows.sort(function (a, b) {
        for (let i = 0; i < specs.length; i++) {
          const spec = specs[i];
          const idx = spec.column - 1;
          const av = a[idx], bv = b[idx];
          let cmp;
          if (av === bv) cmp = 0;
          else if (av === undefined || av === '') cmp = (bv === undefined || bv === '') ? 0 : -1;
          else if (bv === undefined || bv === '') cmp = 1;
          else cmp = av < bv ? -1 : (av > bv ? 1 : 0);
          if (cmp !== 0) return spec.ascending === false ? -cmp : cmp;
        }
        return 0;
      });
      for (let r = 0; r < numRows; r++) sheet._data[row - 1 + r] = rows[r];
      return this;
    },
  };
}

// initialRows: 2D array, row 0 = whatever the real sheet's row 1 holds
// (banner row for a leads tab, real header for everything else) — same
// shape TestMockSpreadsheet_'s callers pass, matching how each production
// file actually reads its own tabs (readLeadsTab_ skips to row 2/3;
// everything else reads row 1 as the header).
function TestMockSheet_(name, initialRows) {
  const sheet = {
    _name: name,
    _data: (initialRows || []).map(function (r) { return r.slice(); }),
    _maxRows: (initialRows || []).length + 200, // headroom, mirrors a real sheet always having more allocated rows than data
    getName: function () { return sheet._name; },
    // Matches real Google Sheets semantics: a row that clearContent()
    // left fully blank (and nothing rewrote) does NOT count toward
    // getLastRow() — real production code (e.g. pruneMovementLog_,
    // clearContent then a SHORTER setValues) relies on this to shrink
    // correctly, so the mock must too, or a test could pass against a
    // stale trailing "row" that no longer exists in a real sheet.
    getLastRow: function () {
      for (let i = sheet._data.length - 1; i >= 0; i--) {
        const r = sheet._data[i];
        if (r && r.some(function (v) { return v !== '' && v !== undefined && v !== null; })) return i + 1;
      }
      return 0;
    },
    getLastColumn: function () { return sheet._data.reduce(function (max, r) { return Math.max(max, r.length); }, 0); },
    getMaxRows: function () { return sheet._maxRows; },
    getRange: function (row, col, numRows, numCols) {
      return TestMockRange_(sheet, row, col, numRows || 1, numCols || 1);
    },
    appendRow: function (values) { sheet._data.push(values.slice()); sheet._syncDims_(); },
    setFrozenRows: function () { return sheet; },
    deleteRows: function (startRow, howMany) {
      sheet._data.splice(startRow - 1, howMany);
      sheet._maxRows = Math.max(sheet._maxRows - howMany, sheet._data.length);
    },
    _syncDims_: function () {
      if (sheet._data.length + 50 > sheet._maxRows) sheet._maxRows = sheet._data.length + 200;
    },
  };
  return sheet;
}

// sheetsByName: { 'RM_Hierarchy': TestMockSheet_(...), ... }. Supports
// getSheetByName / insertSheet / deleteSheet — the only Spreadsheet-level
// methods any production file actually calls.
function TestMockSpreadsheet_(sheetsByName) {
  const sheets = Object.assign({}, sheetsByName || {});
  return {
    getSheetByName: function (name) { return sheets[name] || null; },
    insertSheet: function (name) {
      if (sheets[name]) throw new Error('TestMockSpreadsheet_: sheet "' + name + '" already exists');
      sheets[name] = TestMockSheet_(name, []);
      return sheets[name];
    },
    deleteSheet: function (sheet) { delete sheets[sheet.getName()]; },
    _sheets: sheets, // exposed for test setup convenience (seeding extra tabs after construction)
  };
}

// ============================== Mock GmailApp / Gmail (Advanced Service) ==============================

// Reset at the start of every runXyzTests() — see TestEnv_setUp_. Captures
// every "send" this run makes; nothing is ever actually transmitted.
let TestGmailLog_ = null;

function TestGmailLog_reset_() {
  TestGmailLog_ = { sent: [], drafts: [], threadReplies: [], nextThreadId: 1 };
}

// blockedThreadIds/blockedSendTos (optional): make a specific send throw
// "Gmail operation not allowed" (to test withSendRetry_/failure paths)
// instead of succeeding. Passed in per-test so each test controls its own
// failure scenario without global state leaking between tests.
function TestMockGmailApp_(opts) {
  const failSendCount = (opts && opts.failSendCountFor) || {}; // { 'to@x': attemptsToFailBeforeSucceeding }
  const attemptCounts = {};
  return {
    createDraft: function (to, subject, body, options) {
      const draft = { to: to, subject: subject, body: body, cc: (options && options.cc) || '', htmlBody: options && options.htmlBody };
      TestGmailLog_.drafts.push(draft);
      return {
        send: function () {
          const key = to + '|' + subject;
          attemptCounts[key] = (attemptCounts[key] || 0) + 1;
          const failCount = failSendCount[to] || 0;
          if (attemptCounts[key] <= failCount) {
            throw new Error('Gmail operation not allowed for user ' + to);
          }
          const threadId = 'thread_' + (TestGmailLog_.nextThreadId++);
          draft._sent = true;
          draft._threadId = threadId;
          return { getThread: function () { return { getId: function () { return threadId; } }; } };
        },
      };
    },
    sendEmail: function (to, subject, body, options) {
      TestGmailLog_.sent.push({ to: to, subject: subject, body: body, cc: (options && options.cc) || '', htmlBody: options && options.htmlBody });
    },
  };
}

// The Advanced "Gmail" service (Gmail.Users.Threads.get / Messages.send)
// used only by sendThreadedGmailReply_. `shouldFail: true` makes it throw
// on Threads.get, exercising sendOvernightFollowupEmails' documented
// fallback-to-plain-send path.
function TestMockGmailAdvanced_(opts) {
  const shouldFail = !!(opts && opts.shouldFail);
  return {
    Users: {
      Threads: {
        get: function (userId, threadId) {
          if (shouldFail) throw new Error('Gmail API not enabled for this project (mock)');
          return { messages: [{ payload: { headers: [{ name: 'Message-ID', value: '<' + threadId + '@mock>' }] } }] };
        },
      },
      Messages: {
        send: function (payload, userId) {
          // Real threaded sends aren't decoded here (base64 MIME) — the
          // suite only needs to know ONE landed, with which threadId,
          // which is enough to assert the threaded path was actually
          // taken instead of the plain-send fallback.
          TestGmailLog_.threadReplies.push({ threadId: payload.threadId, raw: payload.raw });
          return { id: 'msg_' + Math.random().toString(36).slice(2) };
        },
      },
    },
  };
}

// ============================== Mock Utilities / ScriptApp ==============================

// Wraps the REAL Utilities — formatDate/newBlob/base64EncodeWebSafe/
// getUuid are pure, side-effect-free, and needed for correct IST date
// math and MIME building, so they stay real. Only `sleep` is replaced
// with a no-op: withRetry_'s backoff and waitForFollowupSuggestions_'s
// ~2-minute poll loop would otherwise make every test run take minutes
// for no benefit — nothing in this suite needs wall-clock time to
// actually pass.
function TestMockUtilities_() {
  const real = TestEnv_realGlobals_.Utilities;
  return {
    formatDate: function () { return real.formatDate.apply(real, arguments); },
    newBlob: function () { return real.newBlob.apply(real, arguments); },
    base64EncodeWebSafe: function () { return real.base64EncodeWebSafe.apply(real, arguments); },
    getUuid: function () { return real.getUuid.apply(real, arguments); },
    sleep: function () { /* no-op — see file header */ },
  };
}

// Captures trigger install/delete calls instead of touching your real
// project's real triggers — running the test suite must never leave a
// stray real-hourly trigger installed on your actual Apps Script project.
// existingTriggers (optional): preset [{handlerFunction}] list, to test
// that a setup*Trigger function correctly deletes its own prior triggers
// before installing fresh ones.
function TestMockScriptApp_(existingTriggers) {
  const state = { created: [], deleted: [] };
  const triggers = (existingTriggers || []).map(function (fn) {
    return { getHandlerFunction: function () { return fn; }, _fn: fn };
  });
  const scriptApp = {
    _state: state,
    getProjectTriggers: function () { return triggers; },
    deleteTrigger: function (t) { state.deleted.push(t._fn); },
    newTrigger: function (fnName) {
      const spec = { fnName: fnName, type: null, hour: null, minute: null, days: null, tz: null };
      const builder = {
        timeBased: function () { spec.type = 'timeBased'; return builder; },
        atHour: function (h) { spec.hour = h; return builder; },
        nearMinute: function (m) { spec.minute = m; return builder; },
        everyDays: function (d) { spec.days = d; return builder; },
        inTimezone: function (tz) { spec.tz = tz; return builder; },
        create: function () { state.created.push(spec); return { getHandlerFunction: function () { return fnName; } }; },
      };
      return builder;
    },
  };
  return scriptApp;
}

// ============================== Shared fixtures ==============================

// Small, deliberately-covers-every-branch RM_Hierarchy fixture reused
// across Tests_RmHierarchy.gs, Tests_EmailInfra.gs, Tests_OvernightEmailer.gs,
// Tests_AllIssuesEmailer.gs — one row per interesting resolution case:
//   Test RM One   -> Test A1 One (a plain A1)   — normal single-bucket case
//   Test RM Two   -> Test A1 One (SAME A1)      — proves same-A1 RMs bucket together
//   Test RM Three -> Test TM One (no A1 at all) — TM-as-primary case
//   Test RM Excl  -> Test A1 One, but Excluded=true — "marked Excluded" unresolved case
//   Test RM Orphan-> nothing at all, role S1     — "no TL/TM/RH/CH on record" unresolved case
//   Test RM NoMail-> Test A1 NoMail (no email)   — "manager has no email" unresolved case
//   Test CH Self  -> nobody, role Cluster Head    — CH self-holding case (chLevelRms)
//   Test Ceo Self -> nobody, no row at all        — leadership self-holding case (via a
//                                                    synthetic LEADERSHIP_NAME_TO_EMAIL_ entry)
//   Test RM Suffix S 1 -> resolves to "Test RM One"'s row via stripRoleSuffix_
function TestFixture_rmHierarchyRows_() {
  return [
    ['team', 'role', 'name', 'tl', 'tm', 'rh', 'ch', 'excluded', 'note', 'email'],
    ['Test Region', 'S1', 'Test RM One', 'Test A1 One', '', '', 'Test CH Self', false, '', ''],
    ['Test Region', 'S1', 'Test RM Two', 'Test A1 One', '', '', 'Test CH Self', false, '', ''],
    ['Test Region', 'S1', 'Test RM Three', '', 'Test TM One', '', 'Test CH Self', false, '', ''],
    ['Test Region', 'S1', 'Test RM Excl', 'Test A1 One', '', '', 'Test CH Self', true, '', ''],
    ['Test Region', 'S1', 'Test RM Orphan', '', '', '', '', false, 'No manager on file for this person.', ''],
    ['Test Region', 'S1', 'Test RM NoMail', 'Test A1 NoMail', '', '', 'Test CH Self', false, '', ''],
    ['Test Region', 'Cluster Head', 'Test CH Self', '', '', '', '', false, '', TEST_EMAIL_CH_],
    // Every manager referenced above ALSO gets its own row here, exactly
    // like the real RM_HIERARCHY_RAW_ table does (e.g. Ayaz Bagwan/Rahul
    // Poudel are both someone's "tm" reference AND have their own row) —
    // without this, resolveRecipientBucketsForRms_' own primaryChain
    // fallback ("prefer the primary's own row; fall back to the
    // reporting RM's row only if the primary has none") would silently
    // fall back to the REPORTING RM's role/chain instead, which is not
    // the real shape this is meant to test.
    ['Test Region', 'A1', 'Test A1 One', '', '', '', 'Test CH Self', false, '', ''],
    ['Test Region', 'TM', 'Test TM One', '', '', '', 'Test CH Self', false, '', ''],
    ['Test Region', 'A1', 'Test A1 NoMail', '', '', '', 'Test CH Self', false, '', ''],
  ];
}

function TestFixture_managerDirectoryRows_() {
  // manager_name, roles, regions, email, people_reporting_up_to_them, email_source
  return [
    ['manager_name', 'roles', 'regions', 'email', 'people_reporting_up_to_them', 'email_source'],
    ['Test A1 One', 'TL', 'Test Region', TEST_EMAIL_PRIMARY_, 2, 'manual'],
    ['Test TM One', 'TM', 'Test Region', TEST_EMAIL_PRIMARY_, 1, 'manual'],
    ['Test A1 NoMail', 'TL', 'Test Region', '', 1, ''],
    ['Test CH Self', 'CH', 'Test Region', TEST_EMAIL_CH_, 7, 'manual'],
  ];
}

// A minimal but complete leads-tab fixture: row 0 = banner (ignored, same
// as the real sheet's row 1), row 1 = real header, row 2+ = data. Covers
// every SLA-flag branch and every stage/scope gate the suite needs.
// hoursAgo/daysAgo are resolved against `now` at fixture-build time so
// every test run uses fresh, correctly-relative dates regardless of when
// it's actually run.
function TestFixture_leadsHeader_() {
  return [
    'lead_id', 'client_id', 'RM', 'TL', 'project', 'region', 'client',
    'lead_assigned_at', 'group_source', 'source_bucket', 'current_stage',
    'last_connect', 'last_connect_time', 'last_comment',
    'internal_status_comments', 'stage_comments', 'closing_reason',
    'lead_closing_reason', 'rm_is_active', 'call_attempts', 'call_count', 'duration',
  ];
}

function TestFixture_hoursAgo_(now, h) { return new Date(now.getTime() - h * 3600000); }
function TestFixture_daysAgo_(now, d) { return new Date(now.getTime() - d * 86400000); }

// ============================== Test env lifecycle ==============================

// Populated once by TestEnv_setUp_ with the REAL global service objects,
// so TestEnv_tearDown_ can restore them and TestMockUtilities_ can wrap
// the real formatDate/newBlob/etc.
let TestEnv_realGlobals_ = null;

// Call at the very top of every runXyzTests() function. ss: a
// TestMockSpreadsheet_(...) — pass null to skip installing a spreadsheet
// mock (rare; a couple of pure-function test files don't need one).
// gmailOpts/gmailAdvancedOpts/scriptAppTriggers: passed straight through
// to the mock builders above.
function TestEnv_setUp_(fileLabel, ss, gmailOpts, gmailAdvancedOpts, scriptAppTriggers) {
  TestResults_reset_(fileLabel);
  TestGmailLog_reset_();
  TestEnv_realGlobals_ = {
    SpreadsheetApp: SpreadsheetApp, GmailApp: GmailApp, Utilities: Utilities,
    ScriptApp: ScriptApp, Gmail: (typeof Gmail === 'undefined' ? undefined : Gmail),
    TEST_MODE_OVERRIDE_EMAIL_: TEST_MODE_OVERRIDE_EMAIL_, OPS_ALERT_EMAIL_: OPS_ALERT_EMAIL_,
    CH_LEVEL_EMAIL_: CH_LEVEL_EMAIL_, ALWAYS_CC_EMAILS_: ALWAYS_CC_EMAILS_,
    LEADERSHIP_NAME_TO_EMAIL_: LEADERSHIP_NAME_TO_EMAIL_,
  };

  SpreadsheetApp = { getActiveSpreadsheet: function () { return ss; }, flush: function () {} };
  GmailApp = TestMockGmailApp_(gmailOpts);
  Utilities = TestMockUtilities_();
  ScriptApp = TestMockScriptApp_(scriptAppTriggers);
  Gmail = TestMockGmailAdvanced_(gmailAdvancedOpts);

  // Confine every test's email surface to the two allowed addresses —
  // see this file's own header. Restored in TestEnv_tearDown_.
  TEST_MODE_OVERRIDE_EMAIL_ = '';
  OPS_ALERT_EMAIL_ = TEST_EMAIL_PRIMARY_;
  CH_LEVEL_EMAIL_ = TEST_EMAIL_CH_;
  ALWAYS_CC_EMAILS_ = []; // no extra real leadership Cc during tests — see TestAssertOnlyTestEmails_
  LEADERSHIP_NAME_TO_EMAIL_ = { 'test ceo self': TEST_EMAIL_CH_ }; // synthetic — see TestFixture_rmHierarchyRows_' own comment on "Test Ceo Self"

  Logger.log('=== ' + fileLabel + ' ===');
}

// Call in a `finally` block (or at the very end) of every runXyzTests()
// function — restores every real global this file swapped out, and logs
// the file's own pass/fail tally. Returns the tally so Tests_RunAll.gs
// can aggregate it.
function TestEnv_tearDown_() {
  const g = TestEnv_realGlobals_;
  SpreadsheetApp = g.SpreadsheetApp; GmailApp = g.GmailApp; Utilities = g.Utilities;
  ScriptApp = g.ScriptApp; Gmail = g.Gmail;
  TEST_MODE_OVERRIDE_EMAIL_ = g.TEST_MODE_OVERRIDE_EMAIL_; OPS_ALERT_EMAIL_ = g.OPS_ALERT_EMAIL_;
  CH_LEVEL_EMAIL_ = g.CH_LEVEL_EMAIL_; ALWAYS_CC_EMAILS_ = g.ALWAYS_CC_EMAILS_;
  LEADERSHIP_NAME_TO_EMAIL_ = g.LEADERSHIP_NAME_TO_EMAIL_;

  const r = TestResults_;
  Logger.log(r.file + ': ' + r.pass + ' passed, ' + r.fail + ' failed' + (r.fail ? (' — ' + r.failures.join('; ')) : ''));
  return r;
}
