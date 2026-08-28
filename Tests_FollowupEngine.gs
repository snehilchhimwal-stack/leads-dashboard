/**
 * Tests: FollowupEngine.gs — comment classification, Suggested Follow-up
 * text, and the modifier layer. Run runFollowupEngineTestsNow() from the
 * function dropdown, or via runAllTests() (Tests_RunAll.gs).
 */
function runFollowupEngineTests_() {
  TestEnv_setUp_('Tests_FollowupEngine', null);
  try {
    const now = new Date('2026-08-17T14:00:00+05:30');

    // ---- inferOutcomeGs_: representative outcomes + typo tolerance ----
    TestAssertEqual_(inferOutcomeGs_('Switch off'), 'Switched Off', 'inferOutcomeGs_: "Switch off" -> Switched Off');
    TestAssertEqual_(inferOutcomeGs_('swtch off'), 'Switched Off', 'inferOutcomeGs_: typo "swtch off" still resolves to Switched Off (edit-distance tolerance)');
    TestAssertEqual_(inferOutcomeGs_('Ringing'), 'Ringing / RNR', 'inferOutcomeGs_: bare "Ringing" resolves via its own test() rule');
    TestAssertEqual_(inferOutcomeGs_('Not interested in the project'), 'Not Interested', 'inferOutcomeGs_: "not interested" signal match');
    TestAssertEqual_(inferOutcomeGs_('Budget is too high for them'), 'Budget Concern', 'inferOutcomeGs_: "too high" budget signal match');
    TestAssertEqual_(inferOutcomeGs_('Client wants callback tomorrow'), 'DNP', 'inferOutcomeGs_: "callback" signal match');
    TestAssertEqual_(inferOutcomeGs_('Do not call this number again'), 'Do Not Disturb', 'inferOutcomeGs_: DND takes priority over other signals in the same comment');
    TestAssertEqual_(inferOutcomeGs_('---'), 'No Real Update', 'inferOutcomeGs_: punctuation-only comment resolves to No Real Update');
    TestAssertEqual_(inferOutcomeGs_('Client seemed happy with the pricing overall'), 'Update', 'inferOutcomeGs_: real text matching no known signal falls through to generic "Update"');
    TestAssertEqual_(inferOutcomeGs_('site visit scheduled for tomorrow'), 'Visit Arranged', 'inferOutcomeGs_: "site visit" + future framing resolves to Visit Arranged');
    TestAssertEqual_(inferOutcomeGs_('looking for a place on rent'), 'Resale / Rental (Out of Scope)', 'inferOutcomeGs_: explicit rental request resolves out-of-scope');
    TestAssertEqual_(inferOutcomeGs_('currently on rent, wants to buy'), 'Update', 'inferOutcomeGs_: "currently on rent" (their present situation, not what they want) does NOT trip the rental exclusion');

    // ---- FOLLOWUP_SUGGESTIONS_GS_ completeness ----
    // Every outcome inferOutcomeGs_ can possibly return must have a
    // suggestion — a missing one would silently print "undefined" in a
    // real email.
    // "Update" is deliberately EXCLUDED here — it's inferOutcomeGs_'s own
    // generic fallback for "matched no rule at all", and
    // overnightFollowupHintGs_'s `||` already routes it to
    // unmatchedFollowUpGs_ instead (checked directly below) — every named
    // rule outcome plus "No Real Update" is the real complete set that
    // needs its own suggestion text.
    const allPossibleOutcomes = OUTCOME_RULES_GS_.map(function (r) { return r.outcome; }).concat(['No Real Update']);
    allPossibleOutcomes.forEach(function (outcome) {
      TestAssert_(!!FOLLOWUP_SUGGESTIONS_GS_[outcome], 'FOLLOWUP_SUGGESTIONS_GS_: has a real entry for outcome "' + outcome + '"');
    });
    TestAssertEqual_(FOLLOWUP_SUGGESTIONS_GS_['Update'], undefined, 'FOLLOWUP_SUGGESTIONS_GS_: "Update" has NO entry by design — confirms the fallback below is really being exercised');
    TestAssertContains_(FOLLOWUP_SUGGESTIONS_GS_['Interested'], 'next step', 'FOLLOWUP_SUGGESTIONS_GS_: spot-check "Interested" text content');

    // ---- unmatchedFollowUpGs_ ----
    TestAssertContains_(unmatchedFollowUpGs_('', ''), 'Manual review required', 'unmatchedFollowUpGs_: blank comment gets the generic manual-review line');
    TestAssertContains_(unmatchedFollowUpGs_('client mentioned a birthday party', 'Test RM One'), 'Test RM One', 'unmatchedFollowUpGs_: quotes back the logger name when given');
    TestAssertContains_(unmatchedFollowUpGs_('client mentioned a birthday party', 'Test RM One'), 'birthday party', 'unmatchedFollowUpGs_: quotes back the actual comment text');

    // ---- FOLLOWUP_MODIFIERS_GS_ / detectFollowupModifiersGs_ ----
    let clauses = detectFollowupModifiersGs_('Not interested, budget is too high for them', 'Not Interested');
    TestAssert_(clauses.length === 1, 'detectFollowupModifiersGs_: budgetConcern fires alongside a different primary outcome');
    TestAssertContains_(clauses[0], 'budget concern', 'detectFollowupModifiersGs_: budgetConcern clause text is the expected one');

    clauses = detectFollowupModifiersGs_('Too expensive for us right now', 'Budget Concern');
    TestAssertEqual_(clauses.length, 0, 'detectFollowupModifiersGs_: budgetConcern is suppressed (skipIf) when the PRIMARY outcome is already Budget Concern');

    clauses = detectFollowupModifiersGs_('Call after 7pm please', 'DNP');
    TestAssertContains_(clauses.join(' '), 'after 7pm', 'detectFollowupModifiersGs_: preferredTime quotes back the exact time phrase found');

    clauses = detectFollowupModifiersGs_('Prefer evening calls only', 'DNP');
    TestAssertContains_(clauses.join(' '), 'evening', 'detectFollowupModifiersGs_: preferredTime falls back to a part-of-day match with no exact hour');

    clauses = detectFollowupModifiersGs_('Only reach me on whatsapp, dont call', 'DNP');
    TestAssertContains_(clauses.join(' '), 'WhatsApp', 'detectFollowupModifiersGs_: preferredChannel fires for an explicit WhatsApp-only preference');

    clauses = detectFollowupModifiersGs_('whatsapp message sent, no reply yet', 'WhatsApp Sent');
    TestAssertEqual_(clauses.length, 0, 'detectFollowupModifiersGs_: preferredChannel does NOT fire on a bare "whatsapp" mention with no explicit preference word');

    clauses = detectFollowupModifiersGs_('need to discuss with husband before deciding', 'Considering');
    TestAssertContains_(clauses.join(' '), "wasn't part of this call", 'detectFollowupModifiersGs_: decisionMakerElsewhere fires when both a family word and a consult word are present');

    clauses = detectFollowupModifiersGs_('husband called earlier today', 'Update');
    TestAssertEqual_(clauses.length, 0, 'detectFollowupModifiersGs_: decisionMakerElsewhere does NOT fire on a bare family-word mention with no consult word');

    // Multiple modifiers can stack on ONE comment.
    clauses = detectFollowupModifiersGs_('Budget too high, call after 6pm, need to discuss with wife', 'Update');
    TestAssertEqual_(clauses.length, 3, 'detectFollowupModifiersGs_: all 3 applicable modifiers fire together on one comment (budget + time + decision-maker)');

    TestAssertEqual_(detectFollowupModifiersGs_('', 'Update').length, 0, 'detectFollowupModifiersGs_: blank comment produces no clauses');

    // ---- overnightStatusLabelGs_ ----
    TestAssertEqual_(overnightStatusLabelGs_('opportunity'), 'Opportunity', 'overnightStatusLabelGs_: canonical stage is Title Cased');
    TestAssertEqual_(overnightStatusLabelGs_('gross eoi application'), 'Gross Eoi Application', 'overnightStatusLabelGs_: multi-word canonical stage is Title Cased');
    TestAssertEqual_(overnightStatusLabelGs_('Some Weird Custom Stage'), 'Some Weird Custom Stage', 'overnightStatusLabelGs_: unrecognized stage passes through verbatim rather than disappearing');
    TestAssertEqual_(overnightStatusLabelGs_(''), 'Unrecognized Stage', 'overnightStatusLabelGs_: blank stage gets an explicit placeholder, not an empty string');

    // ---- latestOutcomeGs_: owner filter, unattributed default-include ----
    const header = TestFixture_leadsHeader_();
    function buildRow(overrides) {
      const defaults = { lead_id: 'L-1', client_id: 'C-1', RM: 'Test RM One' };
      const merged = Object.assign({}, defaults, overrides || {});
      return { row: header.map(function (k) { return merged[k] !== undefined ? merged[k] : ''; }), colIndex: buildColIndex_(header) };
    }

    // Entry logged by a DIFFERENT named RM is excluded.
    let f = buildRow({ internal_status_comments: 'Some Other RM: Not interested - 2026-08-15 10:00' });
    TestAssertEqual_(latestOutcomeGs_(f.row, f.colIndex), null, 'latestOutcomeGs_: an entry logged by a different named RM is excluded entirely, leaving nothing');

    // Entry logged by the row's own RM is included.
    f = buildRow({ internal_status_comments: 'Test RM One: Not interested - 2026-08-15 10:00' });
    let outcome = latestOutcomeGs_(f.row, f.colIndex);
    TestAssert_(!!outcome && outcome.outcome === 'Not Interested', 'latestOutcomeGs_: an entry logged by the row\'s own RM is included and classified');

    // Unattributed entry (no "Name:" prefix at all) defaults to included,
    // per the documented heuristic — not compulsory-excluded just for
    // lacking a name. Checked via comment/loggedBy, not a specific
    // inferred outcome label — outcome CLASSIFICATION is already covered
    // by the inferOutcomeGs_ tests above; this test is only about the
    // owner-filter's inclusion behavior.
    f = buildRow({ internal_status_comments: 'No real update from client this time' });
    outcome = latestOutcomeGs_(f.row, f.colIndex);
    TestAssert_(!!outcome && outcome.comment === 'No real update from client this time', 'latestOutcomeGs_: an unattributed (no "Name:" prefix) entry defaults to included');
    TestAssertEqual_(outcome.loggedBy, '', 'latestOutcomeGs_: correctly reports no logger name for an unattributed entry');

    // Blank owner-logged entry is skipped in favor of an earlier one WITH
    // text, even though the blank one has a newer timestamp.
    f = buildRow({ internal_status_comments: 'Test RM One: Not enquired - 2026-08-15 16:44 | Test RM One: - 2026-08-16 09:03' });
    outcome = latestOutcomeGs_(f.row, f.colIndex);
    TestAssertEqual_(outcome.comment, 'Not enquired', 'latestOutcomeGs_: a later BLANK entry is skipped in favor of an earlier entry that actually says something');

    // Falls back to last_comment only when there are no structured entries at all.
    f = buildRow({ internal_status_comments: '', stage_comments: '', last_comment: 'Client asked about pricing' });
    outcome = latestOutcomeGs_(f.row, f.colIndex);
    TestAssert_(!!outcome && outcome.comment === 'Client asked about pricing', 'latestOutcomeGs_: falls back to last_comment when there is no structured comment-log entry at all');

    // No comments anywhere at all -> null (caller falls back to noCommentFollowUpGs_).
    f = buildRow({ internal_status_comments: '', stage_comments: '', last_comment: '' });
    TestAssertEqual_(latestOutcomeGs_(f.row, f.colIndex), null, 'latestOutcomeGs_: returns null when there is truly no comment anywhere');

    // ---- overnightFollowupHintGs_ / latestOutcomeGs_: generic "Update"
    // outcome (matches no rule at all) falls through to unmatchedFollowUpGs_'s
    // quoted-comment text, since FOLLOWUP_SUGGESTIONS_GS_ has no entry for
    // "Update" by design (confirmed above).
    f = buildRow({ internal_status_comments: 'Test RM One: Client seemed happy with the pricing overall - 2026-08-15 10:00' });
    TestAssertEqual_(latestOutcomeGs_(f.row, f.colIndex).outcome, 'Update', 'sanity: this comment really does classify as the generic "Update" outcome');
    TestAssertContains_(overnightFollowupHintGs_(f.row, f.colIndex, now, null), 'Client seemed happy with the pricing overall', 'overnightFollowupHintGs_: "Update" outcome falls through to quoting the real comment text, not a missing/undefined suggestion');

    // ---- noCommentFollowUpGs_: 3 tiers ----
    f = buildRow({ call_attempts: 3 });
    TestAssertContains_(noCommentFollowUpGs_(f.row, f.colIndex, now, null), 'connect and log', 'noCommentFollowUpGs_: no baseline at all -> generic "connect and log the outcome"');

    const staleBaseline = { atMs: TestFixture_hoursAgo_(now, 6).getTime(), call_attempts: 3 };
    f = buildRow({ call_attempts: 3 }); // unchanged since the baseline
    TestAssertContains_(noCommentFollowUpGs_(f.row, f.colIndex, now, staleBaseline), 'no new call attempts', 'noCommentFollowUpGs_: baseline is 6h+ old AND attempts unchanged -> "no new attempts, connect ASAP"');

    f = buildRow({ call_attempts: 6 }); // 3 more attempts since the baseline
    const followupText = noCommentFollowUpGs_(f.row, f.colIndex, now, staleBaseline);
    TestAssertContains_(followupText, '3 more call attempt', 'noCommentFollowUpGs_: baseline is stale AND attempts increased -> reports the real delta');

    const freshBaseline = { atMs: TestFixture_hoursAgo_(now, 1).getTime(), call_attempts: 3 };
    f = buildRow({ call_attempts: 3 });
    TestAssertContains_(noCommentFollowUpGs_(f.row, f.colIndex, now, freshBaseline), 'connect and log', 'noCommentFollowUpGs_: baseline is under 4h old -> generic line regardless of attempts (too soon to compare)');

    // ---- overnightFollowupHintGs_ end-to-end (primary + modifier stacking) ----
    f = buildRow({ internal_status_comments: 'Test RM One: Budget too high, call after 6pm - 2026-08-15 10:00' });
    const hint = overnightFollowupHintGs_(f.row, f.colIndex, now, null);
    TestAssertContains_(hint, 'Budget was raised', 'overnightFollowupHintGs_: primary Budget Concern suggestion text is present');
    TestAssertContains_(hint, 'after 6pm', 'overnightFollowupHintGs_: preferredTime modifier clause is appended after the primary suggestion');

    f = buildRow({ internal_status_comments: '', stage_comments: '', last_comment: '' });
    TestAssertContains_(overnightFollowupHintGs_(f.row, f.colIndex, now, null), 'connect and log', 'overnightFollowupHintGs_: falls through to noCommentFollowUpGs_ when there is no comment at all');
  } finally {
    TestEnv_tearDown_();
  }
  return TestResults_;
}

function runFollowupEngineTestsNow() { runFollowupEngineTests_(); }
