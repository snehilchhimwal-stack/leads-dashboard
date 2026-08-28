/**
 * Tests: Run All — the single master entry point. Run runAllTests() from
 * the function dropdown to run every Tests_*.gs file in sequence and get
 * one final pass/fail summary in the log. Each file is still fully
 * independently runnable too (runCoreTestsNow, runSlaEngineTestsNow,
 * runFollowupEngineTestsNow, runEmailInfraTestsNow, runRmHierarchyTestsNow,
 * runMovementTrackerTestsNow, runUnmatchedCommentLoggerTestsNow,
 * runOvernightEmailerTestsNow, runAllIssuesEmailerTestsNow) when you only
 * want to check one concern after a change to just that file.
 *
 * NOTHING here sends a real email or touches your real spreadsheet — see
 * Tests_Mocks.gs's own header for exactly why that's true. Every test
 * file also runs the earlier ones' setup fresh (its own TestEnv_setUp_
 * call), so file order below doesn't matter and one file's fixtures can
 * never leak into another's.
 */
function runAllTests() {
  const suites = [
    runCoreTests_,
    runSlaEngineTests_,
    runFollowupEngineTests_,
    runEmailInfraTests_,
    runRmHierarchyTests_,
    runMovementTrackerTests_,
    runUnmatchedCommentLoggerTests_,
    runOvernightEmailerTests_,
    runAllIssuesEmailerTests_,
  ];

  Logger.log('=========================================');
  Logger.log('Running the full test suite (' + suites.length + ' files)...');
  Logger.log('Every email in this run is confined to ' + TEST_EMAIL_PRIMARY_ + ' / ' + TEST_EMAIL_CH_ + ', and nothing is ever actually sent (see Tests_Mocks.gs).');
  Logger.log('=========================================');

  let totalPass = 0, totalFail = 0;
  const failedFiles = [];

  suites.forEach(function (suiteFn) {
    let result;
    try {
      result = suiteFn();
    } catch (e) {
      // A test FILE throwing outright (not an assertion failure — an
      // actual uncaught exception) must never silently abort the rest of
      // the suite. Recorded as one hard failure for that file and moved on.
      Logger.log('  !! ' + suiteFn.name + ' THREW: ' + e + ' — this is a bug in the test file itself (or an uncaught real bug), not a normal assertion failure.');
      totalFail++;
      failedFiles.push(suiteFn.name + ' (threw: ' + e + ')');
      return;
    }
    totalPass += result.pass;
    totalFail += result.fail;
    if (result.fail > 0) failedFiles.push(result.file + ' (' + result.fail + ' failed)');
  });

  Logger.log('=========================================');
  Logger.log('TOTAL: ' + totalPass + ' passed, ' + totalFail + ' failed across ' + suites.length + ' files.');
  if (failedFiles.length) {
    Logger.log('Files with failures: ' + failedFiles.join('; '));
    Logger.log('RESULT: FAIL — see the individual FAIL lines above for exactly which assertion and why.');
  } else {
    Logger.log('RESULT: ALL PASS.');
  }
  Logger.log('=========================================');

  return { pass: totalPass, fail: totalFail, failedFiles: failedFiles };
}
