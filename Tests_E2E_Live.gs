/**
 * Tests_E2E_Live.gs — LIVE end-to-end test of the primary flow (the 17:00 All-Issues email), run by hand from the editor.
 *
 * Run: runLiveE2E. Re-run cleanup at any time (idempotent): cleanupLiveE2E. Independent check: verifyLiveE2ECleanup.
 *
 * What it touches, and why it is safe:
 *  - Builds its OWN throwaway spreadsheet "E2E <runId>" (header rows copied from the live leads tab, a copy of RM_Hierarchy and
 *    Manager_Directory, and 2 synthetic leads whose lead_id starts with the run id). The production code is pointed at it by a
 *    proxy on SpreadsheetApp.getActiveSpreadsheet, so the live workbook is only READ (row 1-2 of the leads tab + 2 tab copies).
 *  - TEST_MODE_OVERRIDE_EMAIL_ = E2E_TEST_EMAIL_: every To/Cc is replaced by that one address, the ledger is off and CH-report
 *    marks are not recorded. Ops alerts are captured in memory, not sent. The log writes test mode normally skips are let
 *    through, but they land in the throwaway workbook, so the chain 17:00 -> 10:00 (Checkpoint 1) -> 13:00 reply in the 10:00
 *    thread runs for real.
 *  - Every created resource is written to the manifest (Script Property E2E_MANIFEST_<runId>) immediately after creation.
 *    Cleanup (in finally) trashes them in reverse order and verifies each one; the manifest is removed only when all verify.
 *  - Script Properties are compared before/after and any difference is REPORTED, never auto-restored (a real trigger may have
 *    written in the meantime).
 * Not removable by this script: the copy delivered to E2E_TEST_EMAIL_'s inbox if that is a different mailbox.
 */
const E2E_TEST_EMAIL_ = 'snehil.chhimwal@homesfy.in';
const E2E_MANIFEST_PREFIX_ = 'E2E_MANIFEST_';

function runLiveE2E() {
  const runId = 'E2E' + istFormatGs_(new Date(), 'yyyy-MM-dd HH:mm:ss').replace(/\D/g, '') + Utilities.getUuid().slice(0, 4).toUpperCase();
  const props = PropertiesService.getScriptProperties();
  const manifest = { runId: runId, startedAt: new Date().toISOString(), resources: [] };
  const save = function () { props.setProperty(E2E_MANIFEST_PREFIX_ + runId, JSON.stringify(manifest)); };
  const add = function (type, id, label, deletion) { manifest.resources.push({ type: type, id: id, label: label, created: 'ok', deletion: deletion, deleted: false, verified: false }); save(); };
  const results = [];
  const check = function (ok, name, detail) { results.push((ok ? 'PASS ' : 'FAIL ') + name + (detail ? ' - ' + detail : '')); };

  const live = SpreadsheetApp.getActiveSpreadsheet();
  const realSsApp = SpreadsheetApp, realNotify = notifyOpsAlertGs_, realLeadFail = notifyLeadSendFailuresGs_, realOverride = TEST_MODE_OVERRIDE_EMAIL_, realWrite = writeUnlessTestModeGs_;
  const propsBefore = props.getProperties();
  const liveRows = function (name) { const s = live.getSheetByName(name); return s ? s.getLastRow() : -1; };
  const liveBefore = { AllIssues_Log: liveRows('AllIssues_Log'), Email_Ledger: liveRows(EMAIL_LEDGER_SHEET_) };
  const alerts = [];
  Logger.log('E2E run ' + runId + ' starting; manifest key ' + E2E_MANIFEST_PREFIX_ + runId);
  save();
  add('scriptProperty', E2E_MANIFEST_PREFIX_ + runId, 'cleanup manifest', 'deleteProperty after verified cleanup');
  try {
    // ---- arrange: the throwaway workbook ----
    const testSs = SpreadsheetApp.create('E2E ' + runId);
    add('spreadsheet', testSs.getId(), testSs.getName(), 'DriveApp.getFileById().setTrashed(true)');
    const src = live.getSheetByName(resolveTabName_(live));
    const head = src.getRange(1, 1, 2, src.getLastColumn()).getValues();
    const leads = testSs.getSheets()[0].setName(resolveTabName_(live));
    leads.getRange(1, 1, 2, head[0].length).setValues(head);
    ['RM_Hierarchy', 'Manager_Directory'].forEach(function (n) { const s = live.getSheetByName(n); if (s) s.copyTo(testSs).setName(n); });
    const rh = testSs.getSheetByName('RM_Hierarchy').getDataRange().getValues();
    const rmRow = rh.filter(function (r) { return String(r[1]).trim() === 'S1' && String(r[2]).trim(); })[0] || rh[1];
    const colIndex = buildColIndex_(head[1]);
    const assigned = istFormatGs_(new Date(Date.now() - 5 * 3600000), 'yyyy-MM-dd HH:mm:ss');
    const leadIds = [runId + '-L1', runId + '-L2'];
    const rows = leadIds.map(function (id) {
      const row = head[1].map(function () { return ''; });
      const set = function (k, v) { if (colIndex[k] !== undefined) row[colIndex[k]] = v; };
      set('lead_id', id); set('client_id', 'C-' + id); set('RM', String(rmRow[2]).trim()); set('region', String(rmRow[0]).trim());
      set('project', 'E2E Test Project'); set('current_stage', 'Not Updated'); set('lead_assigned_at', assigned);
      set('call_attempts', 0); set('group_source', 'google'); set('source_bucket', 'Non-UTM');
      return row;
    });
    leads.getRange(3, 1, rows.length, rows[0].length).setValues(rows);
    SpreadsheetApp.flush();
    check(leads.getLastRow() === 4, 'arrange: 2 synthetic leads tagged ' + runId, 'RM ' + rmRow[2] + ' / ' + rmRow[0]);

    // ---- act: the real 17:00 flow, pointed at the throwaway workbook ----
    SpreadsheetApp = new Proxy(realSsApp, { get: function (t, k) { return k === 'getActiveSpreadsheet' ? function () { return testSs; } : (typeof t[k] === 'function' ? t[k].bind(t) : t[k]); } });
    TEST_MODE_OVERRIDE_EMAIL_ = E2E_TEST_EMAIL_;
    notifyOpsAlertGs_ = function (subject) { alerts.push(String(subject)); return true; };
    notifyLeadSendFailuresGs_ = function (entries) { if (entries && entries.length) alerts.push('lead send failures: ' + entries.length); }; // called with [] on every clean run
    // Log writes normally skipped in test mode go to the THROWAWAY workbook here (the proxy), so the 10:00 / 13:00 steps have the
    // AllIssues_Log / Overnight_Log rows they chain on. Recipients stay overridden by TEST_MODE_OVERRIDE_EMAIL_.
    writeUnlessTestModeGs_ = function (fn, label) { return withRetry_(function () { const r = fn(); realSsApp.flush(); return r; }, label); };
    const sentAt = new Date();
    try {
      sendAllIssuesEmails_();                                                     // 17:00: All-Issues email + AllIssues_Log row
      const ail = testSs.getSheetByName('AllIssues_Log');
      check(ail && ail.getLastRow() >= 2, '17:00 wrote its AllIssues_Log row (throwaway workbook)');
      const yKey = istDayKeyGs_(new Date(Date.now() - 24 * 3600000));         // the 10:00 job checkpoints YESTERDAY's 17:00 rows
      if (ail && ail.getLastRow() >= 2) ail.getRange(2, 1, ail.getLastRow() - 1, 1).setValues(ail.getRange(2, 1, ail.getLastRow() - 1, 1).getValues().map(function () { return [yKey]; }));
      sendOvernightMorningEmails_();                                              // 10:00: combined email, Checkpoint 1 of those leads
      const ol = testSs.getSheetByName('Overnight_Log');
      check(ol && ol.getLastRow() >= 2 && String(ol.getRange(2, 3).getValue()), '10:00 wrote an Overnight_Log row with a thread id');
      Utilities.sleep(5000);
      sendOvernightFollowupEmails_();                                             // 13:00: reply INTO the 10:00 thread
      check(ol && String(ol.getRange(2, 9).getValue()), '13:00 stamped followup_sent_at');
    } finally {
      SpreadsheetApp = realSsApp; TEST_MODE_OVERRIDE_EMAIL_ = realOverride; notifyOpsAlertGs_ = realNotify; notifyLeadSendFailuresGs_ = realLeadFail; writeUnlessTestModeGs_ = realWrite;
    }

    // ---- assert ----
    let threads = [];
    for (let i = 0; i < 8 && threads.length < 2; i++) {
      if (i) Utilities.sleep(5000);
      threads = GmailApp.search('in:sent to:' + E2E_TEST_EMAIL_ + ' "' + runId + '"', 0, 10);
    }
    threads.forEach(function (t) { add('gmailThread', t.getId(), t.getFirstMessageSubject(), 'GmailApp.moveThreadToTrash'); });
    check(threads.length >= 2, '17:00 and 10:00 emails delivered to ' + E2E_TEST_EMAIL_, threads.length + ' sent thread(s)');
    const olSheet = testSs.getSheetByName('Overnight_Log');
    const morningThreadId = olSheet && olSheet.getLastRow() >= 2 ? String(olSheet.getRange(2, 3).getValue()) : '';
    const morning = threads.filter(function (t) { return t.getId() === morningThreadId; })[0];
    const replies = morning ? morning.getMessages().length : 0;
    check(replies >= 2, '13:00 follow-up replied IN the 10:00 thread', 'thread ' + morningThreadId + ' has ' + replies + ' message(s)');
    const msgs = [].concat.apply([], threads.map(function (t) { return t.getMessages(); })).filter(function (m) { return m.getDate() >= new Date(sentAt.getTime() - 60000); });
    const body = msgs.map(function (m) { return m.getBody(); }).join('\n');
    check(leadIds.every(function (id) { return body.indexOf(id) !== -1; }), 'email lists both synthetic leads');
    check(msgs.every(function (m) { return (m.getTo() + ',' + m.getCc()).split(/[,;]/).map(function (a) { return a.replace(/.*</, '').replace(/>.*/, '').trim(); }).filter(String).every(function (a) { return a.toLowerCase() === E2E_TEST_EMAIL_; }); }), 'no recipient other than the test address');
    check(liveRows('AllIssues_Log') === liveBefore.AllIssues_Log && liveRows(EMAIL_LEDGER_SHEET_) === liveBefore.Email_Ledger, 'live workbook logs unchanged',
      JSON.stringify(liveBefore) + ' -> ' + JSON.stringify({ AllIssues_Log: liveRows('AllIssues_Log'), Email_Ledger: liveRows(EMAIL_LEDGER_SHEET_) }));
    check(alerts.length === 0, 'no ops alert raised', alerts.join(' | '));
  } catch (e) {
    check(false, 'run threw', String(e && e.stack || e));
  } finally {
    SpreadsheetApp = realSsApp; TEST_MODE_OVERRIDE_EMAIL_ = realOverride; notifyOpsAlertGs_ = realNotify; notifyLeadSendFailuresGs_ = realLeadFail; writeUnlessTestModeGs_ = realWrite;
    const after = props.getProperties();
    const diff = Object.keys(Object.assign({}, propsBefore, after)).filter(function (k) { return k.indexOf(E2E_MANIFEST_PREFIX_) !== 0 && propsBefore[k] !== after[k]; });
    check(diff.length === 0, 'no production Script Property changed', diff.join(', ') + (diff.length ? ' (reported only - may be a concurrent trigger)' : ''));
    results.forEach(function (r) { Logger.log(r); });
    Logger.log('E2E RESULT: ' + (results.every(function (r) { return r.indexOf('PASS') === 0; }) ? 'ALL PASS' : 'FAILURES') + ' (' + results.length + ' checks)');
    cleanupLiveE2E(runId);
  }
}

// Idempotent: trashes only what the manifest lists, skips what is already gone, verifies each, keeps the manifest if anything remains.
// With no runId it processes every E2E manifest left in Script Properties.
function cleanupLiveE2E(runId) {
  const props = PropertiesService.getScriptProperties();
  const keys = runId ? [E2E_MANIFEST_PREFIX_ + runId] : Object.keys(props.getProperties()).filter(function (k) { return k.indexOf(E2E_MANIFEST_PREFIX_) === 0; });
  if (!keys.length) { Logger.log('E2E cleanup: no manifest found - nothing to do.'); return; }
  keys.forEach(function (key) {
    const raw = props.getProperty(key);
    if (!raw) { Logger.log('E2E cleanup: ' + key + ' already removed.'); return; }
    const m = JSON.parse(raw);
    m.resources.slice().reverse().forEach(function (r) {
      if (r.type === 'scriptProperty') return; // last, below
      try {
        withRetry_(function () {
          if (r.type === 'gmailThread') { const t = GmailApp.getThreadById(r.id); if (t && !t.isInTrash()) t.moveToTrash(); }
          if (r.type === 'spreadsheet') { const f = DriveApp.getFileById(r.id); if (!f.isTrashed()) f.setTrashed(true); }
        }, 'E2E delete ' + r.type + ' ' + r.id);
        r.deleted = true;
      } catch (e) { r.deleted = false; r.error = String(e); }
    });
    const report = verifyManifestGs_(m);
    m.resources.forEach(function (r, i) { r.verified = report[i].gone; });
    const remaining = report.filter(function (x) { return !x.gone && x.type !== 'scriptProperty'; });
    Logger.log('E2E MANIFEST ' + m.runId + ':\n' + report.map(function (x) { return '  ' + x.type + ' ' + x.id + ' [' + x.label + '] deletion=' + x.deletion + ' -> ' + (x.gone ? 'VERIFIED GONE' : 'STILL PRESENT ' + (x.detail || '')); }).join('\n'));
    if (remaining.length) {
      props.setProperty(key, JSON.stringify(m));
      Logger.log('E2E cleanup INCOMPLETE: ' + remaining.length + ' resource(s) remain - manifest kept; re-run cleanupLiveE2E("' + m.runId + '").');
    } else {
      props.deleteProperty(key);
      Logger.log('E2E cleanup COMPLETE for ' + m.runId + ': every resource verified trashed; manifest property deleted (' + (props.getProperty(key) === null ? 'verified' : 'NOT verified') + ').');
    }
  });
}

// Independent verification: re-queries Drive/Gmail for every entry of every manifest still stored (or of a manifest JSON passed in).
function verifyLiveE2ECleanup(manifestJson) {
  const props = PropertiesService.getScriptProperties();
  const manifests = manifestJson ? [JSON.parse(manifestJson)] : Object.keys(props.getProperties()).filter(function (k) { return k.indexOf(E2E_MANIFEST_PREFIX_) === 0; }).map(function (k) { return JSON.parse(props.getProperty(k)); });
  if (!manifests.length) { Logger.log('E2E verify: no manifest left in Script Properties - nothing outstanding.'); return; }
  manifests.forEach(function (m) {
    verifyManifestGs_(m).forEach(function (x) { Logger.log(m.runId + ' ' + x.type + ' ' + x.id + ': ' + (x.gone ? 'gone' : 'PRESENT ' + (x.detail || ''))); });
  });
}

function verifyManifestGs_(m) {
  return m.resources.map(function (r) {
    const out = { type: r.type, id: r.id, label: r.label, deletion: r.deletion, gone: false, detail: r.error || '' };
    try {
      withRetry_(function () {
        if (r.type === 'gmailThread') { const t = GmailApp.getThreadById(r.id); out.gone = !t || t.isInTrash(); out.detail = out.gone ? '' : 'thread not in Trash'; }
        else if (r.type === 'spreadsheet') { let f = null; try { f = DriveApp.getFileById(r.id); } catch (e) { f = null; } out.gone = !f || f.isTrashed(); out.detail = out.gone ? '' : 'file not trashed'; }
        else if (r.type === 'scriptProperty') { out.gone = PropertiesService.getScriptProperties().getProperty(r.id) === null; out.detail = out.gone ? '' : 'manifest still stored (expected until verified)'; }
      }, 'E2E verify ' + r.type + ' ' + r.id);
    } catch (e) { out.detail = 'verify failed: ' + e; }
    return out;
  });
}
