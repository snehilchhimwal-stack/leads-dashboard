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

    // ---- New rules added 2026-08-28 from a real Unmatched_Comments_Log
    // batch review — see OUTCOME_RULES_GS_'s own top-of-array comment. ----
    TestAssertEqual_(inferOutcomeGs_('SHE SAID CALL ME 3.30 PM'), 'DNP', 'inferOutcomeGs_: "call me <time>" (the "me" breaks the plain "call"+time phrase match) resolves via DNP\'s own test()');
    TestAssertEqual_(inferOutcomeGs_('asked me to connect tomorrow at 11 Am'), 'DNP', 'inferOutcomeGs_: "asked me to connect <time>" resolves to DNP');
    TestAssertEqual_(inferOutcomeGs_('Client told to connect on evening'), 'DNP', 'inferOutcomeGs_: "told to connect <time>" resolves to DNP');
    TestAssertEqual_(inferOutcomeGs_('Said mujhe 4 baje call karo'), 'DNP', 'inferOutcomeGs_: Hindi/Hinglish "call karo" resolves to DNP');
    TestAssertEqual_(inferOutcomeGs_('Fake enquiry'), 'Junk / Duplicate Lead', 'inferOutcomeGs_: "fake enquiry" resolves to the new Junk / Duplicate Lead outcome');
    TestAssertEqual_(inferOutcomeGs_('Duplicate lead of embassy'), 'Junk / Duplicate Lead', 'inferOutcomeGs_: "duplicate lead" resolves to Junk / Duplicate Lead');
    TestAssertEqual_(inferOutcomeGs_('Already booked in kohinoor Riverdale'), 'Booked Elsewhere', 'inferOutcomeGs_: "already booked <project>" (no "elsewhere" qualifier) still resolves to Booked Elsewhere');
    TestAssertEqual_(inferOutcomeGs_('need a cross for siddha sky today'), 'Needs Cross-Team Routing', 'inferOutcomeGs_: "need a cross" resolves to the new Needs Cross-Team Routing outcome');
    TestAssertEqual_(inferOutcomeGs_('Does not exist number'), 'Wrong Number', 'inferOutcomeGs_: "does not exist" resolves to Wrong Number');
    TestAssertEqual_(inferOutcomeGs_('no incoming calls'), 'Switched Off', 'inferOutcomeGs_: "no incoming calls" resolves to Switched Off');
    TestAssertEqual_(inferOutcomeGs_('call rejected'), 'Call Declined', 'inferOutcomeGs_: "call rejected" resolves to Call Declined');
    TestAssertEqual_(inferOutcomeGs_('tried multiple times but no respond to call and txt'), 'RNR', 'inferOutcomeGs_: "no respond" (vs "no response") still resolves to RNR');
    TestAssertEqual_(inferOutcomeGs_('Not attending calls, even web calls'), 'RNR', 'inferOutcomeGs_: "not attending" resolves to RNR');
    TestAssertEqual_(inferOutcomeGs_('Will update next week for visit'), 'Considering', 'inferOutcomeGs_: "will update" resolves to Considering');
    TestAssertEqual_(inferOutcomeGs_('Looking 2 bhk under 50 lac'), 'Requirement Noted (No Status)', 'inferOutcomeGs_: bare "Looking <BHK>" (no "for") resolves to the new Requirement Noted outcome');
    TestAssertEqual_(inferOutcomeGs_('He want 2bhk in sheth montana'), 'Requirement Noted (No Status)', 'inferOutcomeGs_: "want" + a BHK mention resolves to Requirement Noted');
    TestAssertEqual_(inferOutcomeGs_('1bhk in 50L'), 'Update', 'inferOutcomeGs_: a bare requirement fragment with no seeking VERB at all stays "Update" — Requirement Noted needs a seeking word, not just a property mention');
    TestAssertEqual_(inferOutcomeGs_('client is not reveling the proper requirement'), 'Update', 'inferOutcomeGs_: the word "requirement" alone (no seeking verb) does not trip Requirement Noted');
    TestAssertEqual_(inferOutcomeGs_('Not giving BPCL'), 'BPCL Not Shared', 'inferOutcomeGs_: "not giving BPCL" resolves to the new BPCL Not Shared outcome (BPCL confirmed by the user as Budget/Possession timeline/Configuration/Location)');
    TestAssertEqual_(inferOutcomeGs_('bpcl not given'), 'BPCL Not Shared', 'inferOutcomeGs_: "bpcl not given" resolves to BPCL Not Shared');
    TestAssertEqual_(inferOutcomeGs_('he not cleared BPCL'), 'BPCL Not Shared', 'inferOutcomeGs_: "not cleared BPCL" resolves to BPCL Not Shared');
    TestAssertEqual_(inferOutcomeGs_('customer confirmed BPCL yesterday'), 'Update', 'inferOutcomeGs_: "BPCL" WITHOUT a nearby negation word does not trip BPCL Not Shared');
    TestAssertEqual_(inferOutcomeGs_('Already visited Springshire on 15th august and other options.'), 'Already Visited (Other Project)', 'inferOutcomeGs_: "already visited <project>" resolves to the new Already Visited outcome (deliberately without diagnosing ours vs a competitor\'s)');
    TestAssertEqual_(inferOutcomeGs_('He has already visited Aranya, monte south, lodha park.'), 'Already Visited (Other Project)', 'inferOutcomeGs_: "has already visited" resolves to Already Visited (Other Project)');
    TestAssertContains_(FOLLOWUP_SUGGESTIONS_GS_['Already Visited (Other Project)'], 'DIFFERENT project options', 'FOLLOWUP_SUGGESTIONS_GS_: "Already Visited" suggests sharing different options rather than diagnosing which case it is');
    TestAssertEqual_(inferOutcomeGs_('site visit scheduled for tomorrow'), 'Visit Arranged', 'inferOutcomeGs_: "site visit" still resolves to Visit Arranged, not Already Visited — no collision from the new rule');

    // ---- FE-1..3 (2026-10-13): short signal words that fuzzy-matched unrelated words. The same phrases are asserted against
    // the JS twin in tests/frontend-harness.html. ----
    TestAssert_(inferOutcomeGs_('Client still deciding') !== 'Call Declined', 'inferOutcomeGs_ (FE-1): "still deciding" is NOT Call Declined (got ' + inferOutcomeGs_('Client still deciding') + ')');
    TestAssertEqual_(inferOutcomeGs_('declining'), 'Call Declined', 'inferOutcomeGs_ (FE-1): exact "declining" is still Call Declined');
    TestAssertEqual_(inferOutcomeGs_('declined'), 'Call Declined', 'inferOutcomeGs_ (FE-1): "declined" is still Call Declined');
    TestAssertEqual_(inferOutcomeGs_('call declined'), 'Call Declined', 'inferOutcomeGs_ (FE-1): "call declined" is still Call Declined');
    TestAssert_(inferOutcomeGs_('Voice broken') !== 'Channel Partner / Broker Lead', 'inferOutcomeGs_ (FE-2): "voice broken" is NOT CP/Broker (got ' + inferOutcomeGs_('Voice broken') + ')');
    TestAssertEqual_(inferOutcomeGs_('He is a broker'), 'Channel Partner / Broker Lead', 'inferOutcomeGs_ (FE-2): "broker" is still CP/Broker');
    TestAssertEqual_(inferOutcomeGs_('works with brokers'), 'Channel Partner / Broker Lead', 'inferOutcomeGs_ (FE-2): plural "brokers" is still CP/Broker (literal entry)');
    TestAssert_(inferOutcomeGs_('bringing wife next week') !== 'Ringing / RNR', 'inferOutcomeGs_ (FE-3): "bringing wife" is NOT Ringing (got ' + inferOutcomeGs_('bringing wife next week') + ')');
    TestAssertEqual_(inferOutcomeGs_('ringing no answer later'), 'RNR', 'inferOutcomeGs_ (FE-3): RNR rule still wins over Ringing when both are present');
    TestAssertEqual_(inferOutcomeGs_('Ringing'), 'Ringing / RNR', 'inferOutcomeGs_ (FE-3): exact "Ringing" still resolves');
    TestAssertEqual_(inferOutcomeGs_('rining'), 'Ringing / RNR', 'inferOutcomeGs_ (FE-3): the common typo "rining" still resolves (literal entry)');
    TestAssertEqual_(inferOutcomeGs_('RNR'), 'RNR', 'inferOutcomeGs_ (FE-3): "RNR" still resolves');
    TestAssert_(inferOutcomeGs_('asked to let him know the price') !== 'Resale / Rental (Out of Scope)', 'inferOutcomeGs_ (FE-3): "asked to let him know" is NOT Resale/Rental (got ' + inferOutcomeGs_('asked to let him know the price') + ')');
    TestAssert_(inferOutcomeGs_('will try to let you know') !== 'Resale / Rental (Out of Scope)', 'inferOutcomeGs_ (FE-3): "to let you know" is NOT Resale/Rental');
    TestAssertEqual_(inferOutcomeGs_('flat is to let'), 'Resale / Rental (Out of Scope)', 'inferOutcomeGs_ (FE-3): "flat is to let" is still Resale/Rental');
    TestAssertEqual_(inferOutcomeGs_('wants a to-let flat'), 'Resale / Rental (Out of Scope)', 'inferOutcomeGs_ (FE-3): "to-let flat" is still Resale/Rental');
    TestAssertEqual_(inferOutcomeGs_('resale only'), 'Resale / Rental (Out of Scope)', 'inferOutcomeGs_ (FE-3): "resale" is unchanged');

    // ---- SE-3 (2026-10-13): dated entries need the "Name:" prefix, like the dashboard's parseActionLog ----
    TestAssertEqual_(countTodayCommentEntries_('Test RM One: Ringing - 2026-08-17 10:00 | Ringing - 2026-08-17 11:00', '', now), 1, 'countTodayCommentEntries_ (SE-3): an entry without a "Name:" prefix is not counted');
    TestAssertEqual_(latestCommentTimestamp_('Test RM One: Busy - 2026-08-17 09:00 | no name - 2026-08-17 12:00', '').getTime(), new Date('2026-08-17T09:00:00+05:30').getTime(), 'latestCommentTimestamp_ (SE-3): an unprefixed later entry does not count as the latest comment');

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

    // FE-4 (2026-10-13): an hour needs am/pm or minutes; a number of days/weeks or a budget is not a time.
    TestAssert_(detectFollowupModifiersGs_('call after 2 days', 'DNP').join(' ').indexOf('specific time') === -1, 'detectFollowupModifiersGs_ (FE-4): "after 2 days" is NOT read as a specific time');
    TestAssert_(detectFollowupModifiersGs_('budget around 1.25 cr', 'Update').join(' ').indexOf('specific time') === -1, 'detectFollowupModifiersGs_ (FE-4): "around 1.25 cr" is NOT read as a specific time');
    TestAssertContains_(detectFollowupModifiersGs_('call around 5:30', 'DNP').join(' '), '"around 5:30"', 'detectFollowupModifiersGs_ (FE-4): minutes alone still count ("around 5:30")');
    TestAssertContains_(detectFollowupModifiersGs_('call before 10 a.m. tomorrow', 'DNP').join(' '), '"before 10 a.m."', 'detectFollowupModifiersGs_ (FE-4): "before 10 a.m." still counts');
    TestAssertContains_(detectFollowupModifiersGs_('call by 5.30pm', 'DNP').join(' '), '"by 5.30pm"', 'detectFollowupModifiersGs_ (FE-4): "by 5.30pm" still counts');

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

    // ---- P-5 (2026-11-05): only the returned comment is classified, and each text once per execution ----
    {
      const realUncached = inferOutcomeUncachedGs_;
      let calls = 0;
      inferOutcomeUncachedGs_ = function (c) { calls++; return realUncached(c); };
      INFER_OUTCOME_CACHE_GS_.clear();
      try {
        const r = buildRow({ RM: 'Test RM One', stage_comments: '', last_comment: '', internal_status_comments:
          'Test RM One: P5 first note - 2026-11-01 10:00 | Test RM One: P5 second note - 2026-11-02 10:00 | Test RM One: P5 busy call later - 2026-11-03 10:00' });
        const latest = latestOutcomeGs_(r.row, r.colIndex);
        TestAssertEqual_(latest.comment + ' -> ' + calls, 'P5 busy call later -> 1', 'P-5: of three history entries only the returned (newest) one is classified');
        TestAssertEqual_(latest.outcome, realUncached('P5 busy call later'), 'P-5: …with the same outcome as before');
        latestOutcomeGs_(r.row, r.colIndex);
        TestAssertEqual_(calls, 1, 'P-5: the same comment text is classified once per execution (cache)');
      } finally { inferOutcomeUncachedGs_ = realUncached; INFER_OUTCOME_CACHE_GS_.clear(); }
    }

    // ---- 2026-11-20: full-history follow-up (historyFollowUpGs_) - every comment is read, not just the newest ----
    // Rule 2: talked before, now only unanswered tries -> recap the conversation + the streak + best milestone.
    f = buildRow({ internal_status_comments:
      'Test RM One: Site visit done, liked 2bhk, budget 1.2 cr - 2026-11-10 12:00 | Test RM One: discussing with wife, call back - 2026-11-12 11:00 | ' +
      'Test RM One: rnr - 2026-11-14 10:00 | Test RM One: switched off - 2026-11-15 10:00 | Test RM One: rnr - 2026-11-16 18:00' });
    let h = overnightFollowupHintGs_(f.row, f.colIndex, now, null);
    TestAssertContains_(h, 'Last real conversation 12 Nov', 'history rule 2: names the date of the last real conversation');
    TestAssertContains_(h, '3 unanswered attempts over 3 days', 'history rule 2: counts the unanswered streak since that conversation');
    TestAssertContains_(h, 'site visit done', 'history rule 2: reminds of the best milestone reached earlier');
    TestAssertContains_(h, 'History: 5 calls/comments, 10 Nov to 16 Nov', 'history: always ends with the History line');

    // Rule 1: a STOP with nothing real after it wins, even if no-reach tries follow.
    f = buildRow({ internal_status_comments: 'Test RM One: interested in 3bhk - 2026-11-10 12:00 | Test RM One: not interested anymore - 2026-11-12 11:00 | Test RM One: rnr - 2026-11-13 10:00' });
    h = overnightFollowupHintGs_(f.row, f.colIndex, now, null);
    TestAssertContains_(h, 'no interest', 'history rule 1: STOP advice is used');
    TestAssertContains_(h, 'Said 12 Nov: "not interested anymore"', 'history rule 1: quotes what was said and when');

    // A later conversation overrides an old STOP (rule 4 + note).
    f = buildRow({ internal_status_comments: 'Test RM One: not interested - 2026-11-10 12:00 | Test RM One: site visit scheduled sunday - 2026-11-12 11:00' });
    h = overnightFollowupHintGs_(f.row, f.colIndex, now, null);
    TestAssertContains_(h, 'site visit is arranged', 'history rule 4: a later conversation overrides an old STOP');
    TestAssertContains_(h, 'but the conversation continued', 'history rule 4: the old STOP is still mentioned as a note');

    // Rule 3: never reached, 6 tries over 3 days -> switch slot + WhatsApp + close as Not Contactable.
    f = buildRow({ internal_status_comments: ['2026-11-10 10:00', '2026-11-10 17:00', '2026-11-11 10:00', '2026-11-11 17:00', '2026-11-12 10:00', '2026-11-12 17:00']
      .map(function (t) { return 'Test RM One: rnr - ' + t; }).join(' | ') });
    h = overnightFollowupHintGs_(f.row, f.colIndex, now, null);
    TestAssertContains_(h, '6 unanswered attempts over 3 days and the customer has never been reached', 'history rule 3: counts tries and days');
    TestAssertContains_(h, 'Not Contactable', 'history rule 3: advises closing as Not Contactable after 2 more days');
    TestAssertContains_(h, 'customer never reached yet', 'history rule 3: History line says there was never a conversation');

    // Rule 4: requirement from an EARLIER comment is carried; preference clause from an earlier comment too.
    f = buildRow({ internal_status_comments: 'Test RM One: looking for 2bhk under 90 lakh, call after 6pm - 2026-11-10 12:00 | Test RM One: client interested, wants pricing - 2026-11-12 11:00' });
    h = overnightFollowupHintGs_(f.row, f.colIndex, now, null);
    TestAssertContains_(h, 'Client showed interest', 'history rule 4: advice for the latest conversation');
    TestAssertContains_(h, '2bhk under 90 lakh', 'history rule 4: requirement from an earlier comment is carried');
    TestAssertContains_(h, 'after 6pm', 'history rule 4: preference clause from an earlier comment is carried');

    // Someone other than the RM: shown with attribution, not dropped.
    f = buildRow({ internal_status_comments: 'Other Caller: Interested, wants visit next week - 2026-11-10 12:00 | Test RM One: busy - 2026-11-12 11:00' });
    h = overnightFollowupHintGs_(f.row, f.colIndex, now, null);
    TestAssertContains_(h, '(by Other Caller)', 'history: a comment by someone other than the RM is read and attributed');

    // Stage changes: a bare stage change is an event (ignored); a note typed with it is read.
    TestAssertEqual_(historyEntriesGs_('', 'Test RM One: Suspect - 2026-11-10 12:00').length, 0, 'history: a bare stage change is not a comment');
    const stageOnly = historyEntriesGs_('', 'Test RM One: Opportunity / visit fixed for saturday - 2026-11-10 12:00');
    TestAssertEqual_(stageOnly.length + ':' + stageOnly[0].comment, '1:visit fixed for saturday', 'history: the note typed with a stage change is read');
    TestAssertEqual_(historyFollowUpGs_(buildRow({ stage_comments: 'Test RM One: Suspect - 2026-11-10 12:00' }).row, f.colIndex), null, 'history: no worded comment -> null, so the old fallback path runs');

    // ---- 2026-11-20 2nd pass: no single-comment reading of dated data (real case: lead 2276862 in the 17:00 email) ----
    f = buildRow({ internal_status_comments: 'Test RM One:  - 2026-11-18 12:59 | Test RM One:  - 2026-11-19 10:43',
      stage_comments: 'admin homesfy: Not Updated - 2026-11-15 10:35 | Test RM One: Suspect - 2026-11-18 12:59', last_comment: '' });
    h = overnightFollowupHintGs_(f.row, f.colIndex, now, null);
    TestAssert_(h.indexOf('"Suspect"') === -1 && h.indexOf('"Not Updated"') === -1, 'single-path: a stage name is never quoted as a comment (got: ' + h + ')');
    TestAssertContains_(h, 'No comment added', 'single-path: blank check-ins + stage changes only -> the no-comment advice');
    f = buildRow({ internal_status_comments: '', stage_comments: '', last_comment: 'Client asked about pricing' });
    TestAssertContains_(overnightFollowupHintGs_(f.row, f.colIndex, now, null), 'only the last one could be read', 'single-path: undated old-format data says it could only read one comment');

    // Real case: lead 2279579 - "Not available on wtsapp" is a no-reach, not a conversation.
    f = buildRow({ RM: 'Mamtaben S 1 Account', internal_status_comments: 'Mamtaben Sosa:  - 2026-11-19 10:11 | Mamtaben Sosa: Not available on wtsapp - 2026-11-19 17:31' });
    h = overnightFollowupHintGs_(f.row, f.colIndex, now, null);
    TestAssertContains_(h, 'customer never reached yet', 'spelling: "wtsapp" is read as WhatsApp, so the note is a no-reach, not a conversation');
    TestAssertEqual_(inferOutcomeGs_('Not available on wtsapp'), inferOutcomeGs_('Not available on whatsapp'), 'spelling: "wtsapp" classifies exactly like "whatsapp"');

    // Every spelling fix: the misspelt comment must classify exactly like the correctly spelt one.
    Object.keys(SPELLING_FIXES_GS_).forEach(function (bad) {
      const good = SPELLING_FIXES_GS_[bad];
      ['client ' + bad + ' today', 'not ' + bad, bad + ' call later'].forEach(function (t) {
        TestAssertEqual_(inferOutcomeGs_(t), inferOutcomeGs_(t.replace(bad, good)), 'spelling fix "' + bad + '" -> "' + good + '" in "' + t + '"');
      });
    });
    TestAssertEqual_(fixSpellingGs_('ringning, wtsapp sent tommorow'), 'ringing, whatsapp sent tomorrow', 'spelling: several fixes in one comment, punctuation kept');
    TestAssertEqual_(fixSpellingGs_('awtsapps constructor'), 'awtsapps constructor', 'spelling: whole words only, and object keys like "constructor" are not touched');

    // ---- 2026-11-20: CRM call status (query v3 "[Status] note") - the three leads checked against Metabase ----
    // 2278821: "Talking to someone else" was logged under Busy - the customer was on another call, never reached.
    f = buildRow({ RM: 'Vijay Katheriya', internal_status_comments: 'Vijay Katheriya: [Busy] Talking to someone else - 2026-11-18 11:16 | ' +
      'Vijay Katheriya: [Ringing] Not answering -- have texted on WhatsApp - 2026-11-19 12:40 | Vijay Katheriya: [Ringing] Not answering - 2026-11-20 12:56' });
    h = overnightFollowupHintGs_(f.row, f.colIndex, now, null);
    TestAssert_(h.indexOf('Last real conversation') === -1, 'call status: a note under [Busy] is not a conversation (got: ' + h + ')');
    TestAssertContains_(h, '3 unanswered attempts over 3 days (Busy, Ringing x2)', 'call status: every call counted and listed by status');
    TestAssertContains_(h, 'customer never reached yet', 'call status: History line says never reached');
    // 2276862: three calls with no notes - Busy, Call Declined, Ringing.
    f = buildRow({ RM: 'Anagha Sangole', internal_status_comments: 'Anagha Sangole: [Busy] - 2026-11-18 12:59 | Anagha Sangole: [Call Declined] - 2026-11-18 19:07 | Anagha Sangole: [Ringing] - 2026-11-19 10:43',
      stage_comments: 'admin homesfy: Not Updated - 2026-11-15 10:35 | Anagha Sangole: Suspect - 2026-11-18 12:59' });
    h = overnightFollowupHintGs_(f.row, f.colIndex, now, null);
    TestAssertContains_(h, '3 unanswered attempts over 2 days (Busy, Call Declined, Ringing)', 'call status: calls with no note are still counted');
    TestAssertContains_(h, 'declined the call once', 'call status: a declined call is called out');
    TestAssert_(h.indexOf('No comment added') === -1 && h.indexOf('"Suspect"') === -1, 'call status: not treated as a lead with no activity (got: ' + h + ')');
    // 2279579: two Ringing calls, the second noting no WhatsApp.
    f = buildRow({ RM: 'Mamtaben S 1 Account', internal_status_comments: 'Mamtaben Sosa: [Ringing] - 2026-11-19 10:11 | Mamtaben Sosa: [Ringing] Not available on wtsapp - 2026-11-19 17:31' });
    h = overnightFollowupHintGs_(f.row, f.colIndex, now, null);
    TestAssertContains_(h, '2 unanswered attempts', 'call status: both Ringing calls counted');
    TestAssertContains_(h, "isn't reachable on WhatsApp", 'call status: the more specific note (no WhatsApp) still drives the advice');
    // A connected call is a conversation, and a STOP said on it wins; Invalid No is a stop.
    f = buildRow({ internal_status_comments: 'Test RM One: [Ringing] - 2026-11-10 10:00 | Test RM One: [Call Connected] wants 2bhk, call after 6pm - 2026-11-11 10:00' });
    h = overnightFollowupHintGs_(f.row, f.colIndex, now, null);
    TestAssertContains_(h, 'last real conversation 11 Nov', 'call status: Call Connected is a real conversation');
    f = buildRow({ internal_status_comments: 'Test RM One: [Call Connected] not interested - 2026-11-11 10:00' });
    TestAssertContains_(overnightFollowupHintGs_(f.row, f.colIndex, now, null), 'no interest', 'call status: a STOP said on a connected call is a STOP');
    f = buildRow({ internal_status_comments: 'Test RM One: [Invalid No] - 2026-11-11 10:00' });
    TestAssertContains_(overnightFollowupHintGs_(f.row, f.colIndex, now, null), 'Number appears incorrect', 'call status: Invalid No is a stop');
    // The classifier: a status with no note maps to the status; the note is classified without the bracket.
    TestAssertEqual_(inferOutcomeGs_('[Ringing]'), 'Ringing / RNR', 'call status: "[Ringing]" alone classifies as Ringing');
    TestAssertEqual_(inferOutcomeGs_('[Call Connected] not interested'), inferOutcomeGs_('not interested'), 'call status: the bracket does not change how the note is read');
    TestAssertEqual_(splitCallStatusGs_('[Some Other] text').status, '', 'call status: an unknown bracket stays part of the note');

    // ---- 2026-11-20: a WhatsApp already sent in the unanswered streak - don't advise sending another (lead 2278821) ----
    f = buildRow({ RM: 'Vijay Katheriya', internal_status_comments: 'Vijay Katheriya: [Busy] Talking to someone else - 2026-11-18 11:16 | ' +
      'Vijay Katheriya: [Ringing] Not answering -- have texted on WhatsApp - 2026-11-19 12:40 | Vijay Katheriya: [Ringing] Not answering - 2026-11-20 12:56' });
    h = overnightFollowupHintGs_(f.row, f.colIndex, now, null);
    TestAssert_(!/consider a WhatsApp|send a WhatsApp/i.test(h), 'whatsapp sent: no advice to send another WhatsApp (got: ' + h + ')');
    TestAssertContains_(h, 'already went out on 19 Nov', 'whatsapp sent: says when the WhatsApp went out');
    // Declined call + WhatsApp already sent: the declined note drops its WhatsApp step too.
    f = buildRow({ internal_status_comments: 'Test RM One: [Ringing] wtsapp msg dropped - 2026-11-10 10:00 | Test RM One: [Call Declined] - 2026-11-11 10:00' });
    h = overnightFollowupHintGs_(f.row, f.colIndex, now, null);
    TestAssertContains_(h, 'declined the call once - call at a different time', 'whatsapp sent: declined note without the WhatsApp step');
    TestAssert_(h.indexOf('send a WhatsApp') === -1, 'whatsapp sent: misspelt "wtsapp msg dropped" also counts as sent (got: ' + h + ')');
    // Rule 3 (6+ tries over 3+ days) with a WhatsApp already sent.
    f = buildRow({ internal_status_comments: ['2026-11-10 10:00', '2026-11-10 17:00', '2026-11-11 10:00', '2026-11-11 17:00', '2026-11-12 10:00']
      .map(function (t) { return 'Test RM One: [Ringing] - ' + t; }).join(' | ') + ' | Test RM One: [Ringing] whatsapp sent - 2026-11-12 17:00' });
    h = overnightFollowupHintGs_(f.row, f.colIndex, now, null);
    TestAssertContains_(h, 'a WhatsApp message already went out on 12 Nov with no reply', 'whatsapp sent: rule 3 wording');
    TestAssertContains_(h, 'Not Contactable', 'whatsapp sent: rule 3 still advises closing after 2 more days');
    // A WhatsApp sent BEFORE the last real conversation does not count, and "not on WhatsApp" is not a sent message.
    f = buildRow({ internal_status_comments: 'Test RM One: [Ringing] texted on whatsapp - 2026-11-10 10:00 | Test RM One: [Call Connected] interested, call tomorrow - 2026-11-11 10:00 | Test RM One: [Ringing] - 2026-11-12 10:00' });
    TestAssert_(overnightFollowupHintGs_(f.row, f.colIndex, now, null).indexOf('already went out') === -1, 'whatsapp sent: one sent before the last conversation is not counted');
    f = buildRow({ internal_status_comments: 'Test RM One: [Ringing] Not available on wtsapp - 2026-11-12 10:00' });
    TestAssert_(overnightFollowupHintGs_(f.row, f.colIndex, now, null).indexOf('already went out') === -1, 'whatsapp sent: "not available on WhatsApp" is not a sent message');
    // Without a WhatsApp in the streak the advice is unchanged.
    f = buildRow({ internal_status_comments: 'Test RM One: [Ringing] - 2026-11-12 10:00' });
    TestAssertContains_(overnightFollowupHintGs_(f.row, f.colIndex, now, null), 'retry at a different time of day', 'whatsapp sent: no WhatsApp in the streak -> normal advice');

    // ---- 2026-11-20: count every dial (call_attempts), not only the calls logged with a status (lead 2278821: 4 logged, 11 dialled) ----
    const lead2278821 = 'Vijay Katheriya: [Busy] Talking to someone else - 2026-11-18 11:16 | Vijay Katheriya: [Ringing] Not answering -- have texted on WhatsApp - 2026-11-19 12:40 | ' +
      'Vijay Katheriya: [Ringing] Not answering - 2026-11-20 12:56 | Vijay Katheriya: [Ringing] Not answering - 2026-11-20 17:59';
    f = buildRow({ RM: 'Vijay Katheriya', internal_status_comments: lead2278821, call_attempts: 11, call_count: 0 });
    h = overnightFollowupHintGs_(f.row, f.colIndex, now, null);
    TestAssertContains_(h, '11 dials over 3 days and the customer has never been reached (4 logged: Busy, Ringing x3)', 'dials: the dial total is used, with the logged statuses alongside');
    TestAssertContains_(h, 'Not Contactable', 'dials: 11 dials over 3 days reaches the 6+ tries rule');
    TestAssertContains_(h, 'already went out on 19 Nov', 'dials: the WhatsApp-already-sent note still applies');
    // Fewer dials than logged tries (or no column): the logged count stands.
    f = buildRow({ RM: 'Vijay Katheriya', internal_status_comments: lead2278821, call_attempts: 2 });
    TestAssertContains_(overnightFollowupHintGs_(f.row, f.colIndex, now, null), '4 unanswered attempts over 3 days', 'dials: never fewer than the logged tries');
    // A connected call in the logs while no status says connected -> flag a possibly unlogged conversation.
    f = buildRow({ internal_status_comments: 'Test RM One: [Ringing] - 2026-11-12 10:00', call_attempts: 3, call_count: 1 });
    TestAssertContains_(overnightFollowupHintGs_(f.row, f.colIndex, now, null), 'call logs show 1 connected call', 'dials: connected call with no conversation logged is flagged');
    // After a real conversation the lifetime dial count is not used (it can't be split before/after the conversation).
    f = buildRow({ internal_status_comments: 'Test RM One: [Call Connected] interested - 2026-11-10 10:00 | Test RM One: [Ringing] - 2026-11-12 10:00', call_attempts: 9, call_count: 1 });
    h = overnightFollowupHintGs_(f.row, f.colIndex, now, null);
    TestAssert_(h.indexOf('dials') === -1 && h.indexOf('connected call') === -1, 'dials: not used once the customer was reached (got: ' + h + ')');
  } finally {
    TestEnv_tearDown_();
  }
  return TestResults_;
}

function runFollowupEngineTestsNow() { runFollowupEngineTests_(); }
