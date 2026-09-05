#!/usr/bin/env node
/**
 * Runs the Apps Script test suite (Tests_*.gs) outside of Apps Script, so
 * it can run in GitHub Actions (or anywhere Node is available) without a
 * real Google account or a real spreadsheet.
 *
 * HOW: Apps Script shares one global scope across every .gs file pasted
 * into a project. This loads every production .gs file plus every
 * Tests_*.gs file into ONE shared Node `vm` context — the same
 * shared-global-scope model — with the handful of Apps-Script host
 * globals the code touches (SpreadsheetApp, GmailApp, Utilities,
 * ScriptApp, Logger) pre-declared as plain objects, then calls
 * runAllTests() (defined in Tests_RunAll.gs) and exits non-zero on any
 * failure.
 *
 * File load order does NOT matter here — verified by inspection: no file
 * has top-level (non-function-body) code that calls another file's
 * function at load time, which has to already be true for this codebase
 * to work in real Apps Script (which itself never guarantees file order).
 *
 * RmHierarchy.private.gs (gitignored, real employee emails) is
 * deliberately never loaded here — every reference to its
 * EMPLOYEE_EMAIL_BY_NAME_RAW_ in RmHierarchy.gs is already guarded with
 * `typeof ... === 'undefined'` checks for exactly this situation.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..');

const PRODUCTION_FILES = [
  'Core.gs',
  'EmailInfra.gs',
  'RmHierarchy.gs',
  'SlaEngine.gs',
  'FollowupEngine.gs',
  'MovementTracker.gs',
  'OvernightEmailer.gs',
  'AllIssuesEmailer.gs',
  'UnmatchedCommentLogger.gs',
  'InteractionHistoryLogger.gs',
  'DailyRmIssueLog.gs',
];

const TEST_FILES = [
  'Tests_Mocks.gs',
  'Tests_Core.gs',
  'Tests_SlaEngine.gs',
  'Tests_FollowupEngine.gs',
  'Tests_EmailInfra.gs',
  'Tests_RmHierarchy.gs',
  'Tests_MovementTracker.gs',
  'Tests_UnmatchedCommentLogger.gs',
  'Tests_InteractionHistoryLogger.gs',
  'Tests_OvernightEmailer.gs',
  'Tests_AllIssuesEmailer.gs',
  'Tests_DailyRmIssueLog.gs',
  'Tests_RunAll.gs',
];

// ---- Utilities.formatDate: only the exact tokens this codebase actually
// uses (grepped every real call site — see project memory for the audit),
// not a general SimpleDateFormat implementation. Every call in this
// codebase uses the 'Asia/Kolkata' timezone, which has no DST, so a fixed
// +5:30 offset is exact and doesn't depend on the CI runner's ICU/tz data.
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
const MONTH_ABBR = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function pad2(n) { return String(n).padStart(2, '0'); }

// A sequential chain of blind .replace() calls is NOT safe here: 'MMM'
// resolves to values like 'Mar'/'May'/'Jan'/'Apr'/'Aug', every one of
// which contains a lowercase 'a' that a later `.replace(/a/g, ampm)` pass
// would re-match and corrupt (verified by a self-check that caught this
// exact bug before it shipped). A single regex-with-callback pass scans
// only the ORIGINAL string once, so a token's own substituted text is
// never re-matched by another token in the same pass. Longer/more-specific
// alternatives are listed first so e.g. 'MMM' wins over 'MM' at the same
// position.
function formatDateIST(date, timeZone, format) {
  const d = date instanceof Date ? date : new Date(date);
  const ist = new Date(d.getTime() + IST_OFFSET_MS);
  const h24 = ist.getUTCHours();
  let h12 = h24 % 12; if (h12 === 0) h12 = 12;

  const tokenMap = {
    yyyy: String(ist.getUTCFullYear()),
    MMM: MONTH_ABBR[ist.getUTCMonth()],
    MM: pad2(ist.getUTCMonth() + 1),
    dd: pad2(ist.getUTCDate()),
    HH: pad2(h24),
    mm: pad2(ist.getUTCMinutes()),
    ss: pad2(ist.getUTCSeconds()),
    d: String(ist.getUTCDate()),
    h: String(h12),
    a: h24 < 12 ? 'AM' : 'PM',
  };
  return String(format).replace(/yyyy|MMM|MM|dd|HH|mm|ss|d|h|a/g, function (tok) { return tokenMap[tok]; });
}

function buildSandbox() {
  const sandbox = {
    console,
    SpreadsheetApp: {},
    GmailApp: {},
    Utilities: {
      formatDate: formatDateIST,
      newBlob: function (data) {
        const buf = Buffer.from(String(data), 'utf-8');
        return {
          getBytes: function () { return Array.from(buf); },
          getDataAsString: function () { return String(data); },
          getContentType: function () { return 'application/octet-stream'; },
        };
      },
      base64EncodeWebSafe: function (bytes) {
        const buf = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
        return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_');
      },
      getUuid: function () { return crypto.randomUUID(); },
      sleep: function () {},
    },
    ScriptApp: {},
    Logger: { log: function () { console.log.apply(console, arguments); } },
  };
  vm.createContext(sandbox);
  return sandbox;
}

function loadFile(sandbox, filename) {
  const full = path.join(ROOT, filename);
  const code = fs.readFileSync(full, 'utf8');
  const script = new vm.Script(code, { filename });
  script.runInContext(sandbox);
}

function main() {
  const sandbox = buildSandbox();
  const allFiles = PRODUCTION_FILES.concat(TEST_FILES);
  for (const f of allFiles) {
    const full = path.join(ROOT, f);
    if (!fs.existsSync(full)) {
      console.error('Missing expected file: ' + f);
      process.exit(1);
    }
    loadFile(sandbox, f);
  }

  const result = sandbox.runAllTests();
  console.log('');
  console.log('======================================================');
  console.log('TOTAL (Node/CI run): ' + result.pass + ' passed, ' + result.fail + ' failed');
  if (result.failedFiles && result.failedFiles.length) {
    console.log('Failed: ' + result.failedFiles.join('; '));
  }
  console.log('======================================================');

  if (result.fail > 0 || result.pass === 0) {
    process.exit(1);
  }
  process.exit(0);
}

main();
