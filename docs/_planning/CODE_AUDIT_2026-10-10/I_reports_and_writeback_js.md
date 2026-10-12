# Code audit I: region reports, Gmail send, and Sheets write-back (browser side)

Auditor I of 9. Audited at commit `19038e7` (2026-10-10). Every line of the four files below was read. This is a reading
audit: nothing was run against the live Sheet, no mail was sent, and no code was changed.

---

## 1. Scope and summary

**Files (2,419 lines in total):**

| File | Lines | Role |
|---|---|---|
| `js/reports-build.js` | 1,283 | Builds report content only (no DOM writes, no network): region mapping, the single-issue builder, the combined "all issues" builder, the "all issues x all regions" batch, and the HTML email template. |
| `js/reports-gmail.js` | 499 | Gmail sending: OAuth token lifecycle, the 1-hour local "Sent" log, MIME encoding, the send-safety gate (`prepareGmailSend`), and single and bulk send flows. |
| `js/reports-ui.js` | 609 | The UI: the per-region recipients editor (localStorage), the mailto flow, the render/copy/download functions, and the `renderReports` Generate cycle that goes through Lead_Followups. |
| `js/sheets-writeback.js` | 1,028 | Every browser write to the Sheet: Movement_Log snapshot, Send_Log, Lead_Followups (clear, push, wait), SLA_History, Daily_Cohort_History, and Feature_Usage. |

**Summary.** The report layer is a pure-function builder (`reports-build.js`) that reads the globals `issueLeads`, `leads`,
`filterState` and `CONFIG`, and returns `{subject, body, html, count, regionNames, ...}` objects. `reports-ui.js` renders
those objects and sends them in one of two ways: a `mailto:` link, or the Gmail REST API (`reports-gmail.js`) using a
**second** OAuth grant (`gmail.send`). Every Gmail send goes through `performGmailSend`, which runs `prepareGmailSend`
before anything leaves the browser. That gate blocks a malformed address, a header line break, or an empty body. The
combined "All Issues" Generate runs in three phases:

1. Build a preliminary version of the reports.
2. Clear Lead_Followups, push the listed leads, and poll every 20 s until a person has typed a suggestion for each one.
3. Rebuild the reports using those suggestions.

`sheets-writeback.js` owns all browser writes. They use the Sheets token from the sign-in gate and follow a common
read-then-upsert-by-key pattern, mostly `RAW`. Each write path is lazy-create-once.

The code is careful overall: everything that goes into HTML is escaped, header injection is closed, and IST is handled
explicitly almost everywhere. The real defects found are:

- The browser Movement_Log snapshot writes **collated** (merged-customer) records, not per-sheet-row records (I-1).
- The unbounded follow-up wait dies silently when the 1-hour gate token expires (I-2).
- A Gmail send stashed while waiting for a token can fire later without the user asking again (I-3).
- The stalled-leads section is cached against a key that does not track Movement_Log refreshes (I-4).
- The two SLA_History writers produce cells of different types, which breaks the upsert key and the sort (I-5).

The rest are lower-severity issues, documentation drift, and stale comments.

---

## 2. Per file

### 2.1 `js/reports-build.js`

**Purpose.** All report content construction. The header (L1-16) says it is "pure computation" with no top-level side
effects other than declarations. That is accurate apart from the parse-time reads of `CONFIG.MIN_CALLS_PER_DAY` (L256)
and `ISSUE_PRIORITY` (L265), both of which are defined earlier in `core-foundation.js`.

**Module state and constants.**

| Name | Line | What it is |
|---|---|---|
| `REGION_GROUP_MAP` | L37 | Raw region text mapped to one of 11 reporting groups (Bangalore, Central, Commercial, Harbour, Hyderabad, Loan, Navi Mumbai, Pune, SoBo, Thane, Western). "HNI"/"HNI - SoBo" fold into SoBo. Unlisted sub-regions (Goa, Gurugram, KDMC, Kolkata, ...) are deliberately excluded. |
| `_REGION_LOOKUP` | L68 | The same map keyed by `normRegionKey(k)`. |
| `_lastReportOutOfScope`, `_lastReportOutOfScopeNames`, `_lastReportUndatable` | L164-173 | Diagnostics from the last build, read by `reportScopeNotice()`. Builders write them; `renderRegionReports` and `buildAllRegionReports` reset the names dictionary. |
| `ISSUE_REPORT_META` | L219 | Six single-issue report kinds (inactiveRm, notConnected, followupOverdue, dueToday, stuck, notUpdated), each `{flag, label, intro}`. `{SOURCE}` in the intro is a placeholder. |
| `ISSUE_ACTION_MAP` | L252 | Flag mapped to a recommended-action sentence. |
| `_FLAG_BY_ISSUE_PRIORITY_LABEL` | L264 | `ISSUE_PRIORITY` label mapped back to its flag. |
| `IST_MONTHS`, `IST_WEEKDAYS` | L276, L284 | Labels for the IST date helpers. |
| `EMAIL_SIGNATURE` | L313 | A hardcoded sign-off naming one person. All three report formats (single-issue, combined, and the HTML template) share it. |
| `_EMAILABLE_FLAG_KEYS` | L651 | Set of the `ISSUE_REPORT_META` flags. Today it covers all five `ISSUE_PRIORITY` keys, because `firstContactBreach` is not in `ISSUE_PRIORITY`. |
| `_rwrRowsCacheKey` / `_rwrRowsCache` | L724-725 | Row-collection cache for `buildRegionWiseReports`, keyed on the identity of the `issueLeads` array. |
| `_allReports` | L1262 | The currently rendered combined or batch report list. `reports-ui.js` and `reports-gmail.js` read it. |

**Functions, in file order.**

- **`normRegionKey(s)` L65.** Returns `String(s)` trimmed, lowercased, with runs of whitespace, `-` and `_` collapsed to
  one space. Note `String(null)` gives `"null"`; every caller passes a string. The `.gs` twin uses `String(s||'')`.
- **`effectiveRegion(l)` L80.** Returns `'Loan'` if the normalised `project_region` is `loan`, otherwise `'Loan'` if the
  normalised `group_source` is `loan`, otherwise the trimmed raw `region`. This is the single source of truth for the
  Region filter and for report grouping.
- **`mainRegionFor(rawRegion)` L91.** Looks the normalised key up directly. If that misses, it strips a trailing
  ` <digits>` and looks up the base, so an unconfigured "Western 7" still maps to Western. Returns `null` when the
  region is out of scope.
- **`regionsAreSimilar(a,b)` L121.** Two blank values are never similar. If both resolve to a main region, it compares
  those. Otherwise it is true when the normalised keys are equal, or when their first words are equal. Used by
  collation in `core-fetch-and-render.js`.
- **`expandCopySplits(item)` L140.** Returns `item.copySplits` when there is more than one split, otherwise `[item]`.
- **`groupItemsByReportRegion(items)` L150.** Expands each item's copy splits, resolves
  `mainRegionFor(effectiveRegion(unit))`, and drops items that do not resolve. Returns `{main: [units]}`. Movement-tab
  reports use it, and so does `currentStalledRowsByRegion` (`tab-movement.js` L698).
- **`reportScopeNotice()` L178.** Returns an HTML string with:
  - the list of in-scope regions;
  - the out-of-scope count and names (from `_lastReportOutOfScope*`);
  - a "held back, undatable" note;
  - a collapsible chip map of every raw region value in `leads` (the filtered, per-customer view), showing its total,
    how many are flagged on any `ISSUE_PRIORITY` key, and where it reports (or "NOT IN REPORTS").

  Every interpolated value goes through `esc()`. The chip counts come from `leads` (one per customer) while the reports
  come from `issueLeads` (one per copy), so the two sets of numbers are not directly comparable (INFO).
- **`attemptsTodayCell(n)` L270.** Returns `"made/MIN (k more needed)"`.
- **`istDayLabel(date)` L279.** Returns `DD-Mon-YYYY` from `istParts` (IST-correct). `istDayLabelWithDow` (L289)
  prefixes the weekday. `todayDateLabel()` (L294) is `istDayLabel(new Date())`.
- **`groupBy(items, keyFn)` L302.** A generic bucketer.
- **`subjectScopeSuffix()` L325.** Returns `" - A, B & C only"` built from `filterState.bucket` (the Sub-source
  filter), or `''` when that filter is empty.
- **`renderReportEmailHTML(opts)` L344.** Takes `{eyebrow, title, region, subtitle, kpis[], action, highlights[],
  sections[], footerNote}` and returns a table-based HTML email with every style inline. Each section is
  `{heading, subheading, columns[], rows[][], action, accent:{fg,headerBg,bg}}`.
  - Every text value is passed through `esc(String(...))`.
  - Colour values (`k.bg`, `k.fg`, `accent.*`) are interpolated without escaping, but every caller passes constants.
  - The signature is rendered with `white-space:pre-line`.
  - `bodyRows` are joined with `''`, so a large section becomes one very long physical line (see I-11).
- **`buildRegionReports(issueKey)` L410.** The single-issue report builder.
  1. Looks up `meta`; returns `[]` for an unknown key.
  2. Sets `now = new Date()`.
  3. `matching`: filters `issueLeads` (per copy) on `l[meta.flag]`. A lead with no parseable `lead_assigned_at` is
     counted as undatable and skipped. The result goes to `_lastReportUndatable`. There is deliberately no grace
     re-check here (see the comments at L416-425).
  4. `inScope`: filters on `mainRegionFor(effectiveRegion(l))`. Misses increment the out-of-scope count, and the raw
     `l.region` text is **added** to `_lastReportOutOfScopeNames`. This function never resets that dictionary; its
     callers do.
  5. Groups by main region, then by RM within a region (key `RM||TL`).
  6. Plain text: a block per RM. Leads are grouped by calendar day via `groupLeadsByCalendarDay(group, now)`, except
     for inactiveRm. A lead line reads `id | Assigned: <istStamp> | <hrs>h ago [0-48h|PAST 48h] | also held by...`; for
     notConnected the line shows `fmtWorkingWait(businessMinsToConnect,'late')` instead.
  7. Grace explainer text varies by issue: none for inactiveRm or notConnected, a special wording for notUpdated, and
     the generic wording otherwise.
  8. Counts are de-duplicated per customer with `countUniqueAndCloned` (`core-collation.js`). For dueToday, the counts
     are split into under-48h and over-48h.
  9. Subject: notConnected gets `"<region> — 10-Minute Response SLA Reminder (<date>)<scope>"`. Every other issue gets
     `"<region> Daily Report (<date>) - <source> Leads with <label><scope>"`.
  10. HTML: three KPIs (four for dueToday), and one section per RM whose columns depend on the issue. The last column
      is always `suggestedFollowUp(l)` (`core-outcome-engine.js`). This builder never uses `Lead_Followups`.

  Returns `[{region, subject, body, html, count, regionNames:[region], issueKey, issueLabel}]`, sorted by region.
- **`joinAnd(names)` L610.** Joins as "A", "A & B", or "A, B & C".
- **`selectedSourceLabel()` L619.** The Source filter as a joined label, or `'All-source'`.
- **`selectedRegionLabel(fallback)` L627.** The Region filter mapped to main regions and de-duplicated. Falls back to
  the regions actually present, then to `'All Regions'`.
- **`reportableIssueFor(l)` L653.** Returns `null` for an undatable lead. Otherwise returns the label of the first
  `ISSUE_PRIORITY` rule whose flag is set and is emailable, or `null`. The comment above it (L640-644, "a lead still
  inside its grace window can only report Not Connected") describes the old behaviour and is stale; the comment inside
  the body (L657-667) is the current one.
- **`reportDateRange(includedLeads)` L678.** If either `#dateFromInput` or `#dateToInput` is set, it formats those
  through `parseDate`, using `'…'` for a missing or unparseable side. Otherwise it uses the minimum to maximum
  `lead_assigned_at` of the included leads, or today when there are none. The output is IST.
- **`buildRegionWiseReports(combineAll, followupLookup)` L726.** The combined "All Issues" email.
  - `followupTextFor(r)` returns `followupLookup[lead_id]`, falling back to `suggestedFollowUp(r)`.
  - **Row collection** runs only on a cache miss (when `issueLeads` is a different array from last time). It makes six
    passes:
    1. `rows`: one entry per copy carrying its primary issue (`reportableIssueFor`). A miss that still carries an
       `ISSUE_PRIORITY` flag counts as undatable.
    2. `notConnectedRows`: copies with `firstContactBreach`.
    3. `stuckRows`: `stageStuck48h` copies whose primary issue is something else.
    4. `warmCloseRows`: closed copies, excluding a "broking advisor" close. A "duplicate lead" close counts here only
       when the comments contain no run of six or more digits (no original lead id cited). Any other close counts
       when the latest family outcome is in `WARM_CLOSE_OUTCOMES`.
    5. `closedNoCommentRows`: copies with `closedWithNoComment`.
    6. `stalledByRegion = currentStalledRowsByRegion()`.

    Every pass resolves `mainRegionFor(effectiveRegion(l))`. Only pass 1 records out-of-scope names. The cache stores
    every collection plus the names dictionary.
  - Returns `[]` if all six collections are empty.
  - **Grouping.** With `combineAll`, everything goes into one `__ALL__` key. Without it, rows are grouped by main
    region, and any region that has only side-section rows still gets an empty main group so it is not dropped.
  - **Per group:**
    - `regionNames` is the union of the main regions of every row, plus the key.
    - `regionLabel` is `selectedRegionLabel(...)` when combined, otherwise the key.
    - `dateRange` comes from the main, notConnected and stuck rows only.
    - The plain-text table pads columns to fixed widths (`w.id` uses `idsFor(r).length`; see I-10).
    - `tally` counts by issue.
    - The plain-text body is assembled in this order: Highlights, Stalled block (first), main section, NotConnected
      block, Stuck block, Closed-no-comment block, Warm-close block, then the signature.
    - Highlights are rule-based: the stalled count, the worst RM by share (only when that RM has more than 1 lead),
      the worst region (only when more than one region), the top issue, and the warm-close count.
    - Subject: `"<regionLabel> Report (<dateRange>) - <source> Leads with Issue"`. This subject deliberately has no
      scope suffix. The HTML subtitle does include it.
    - HTML sections, in order: Stalled (unshifted to the front, red), one section per issue in alphabetical order
      (with its action), NotConnected, Stuck ("Also Listed Above"), Closed with No Comment (red), and Possible
      Premature Closes (amber).
    - KPIs: Leads Flagged, Stalled, Closed-No-Comment, Premature.

    Returns `{region, subject, body, html, count, issueKey:'combined', issueLabel:'All issues', regionNames, sorted}`.
    `count` is the sum of all six unique counts, so Stalled can overlap with the main count (the footer says so).
    `sorted` is the population pushed to Lead_Followups.
- **`buildAllRegionReports()` L1264.** Resets the names dictionary, then calls `buildRegionReports` for each of the six
  issue keys and sums the out-of-scope and undatable counters across issues. A lead flagged for three issues therefore
  counts three times in "flagged leads fell outside" (INFO). L1254-1256 repeat the comment block from L1258-1261
  (a stale duplicate).

### 2.2 `js/reports-gmail.js`

**State.**

| Name | Line | What it is |
|---|---|---|
| `GMAIL_CLIENT_ID_KEY` | L33 | `'gsl_gmail_client_id'`, in localStorage. Shared with the sign-in gate (`core-auth.js` `gateSignIn` calls `getGmailClientId`). |
| `GMAIL_SCOPE` | L34 | `gmail.send` plus `userinfo.email`. |
| `DEFAULT_CLIENT_ID` | L42 | The public OAuth client id. |
| `gmailTokenClient`, `gmailAccessToken`, `gmailTokenExpiresAt`, `gmailUserEmail` | L44-47 | Held in memory only. |
| `_pendingGmailSend` | L48 | A single slot holding either `{kind:'single', report, to, cc, btnId}` or `{kind:'bulk', reports, btnIdFn, statusElId, confirmText}`. |
| `GMAIL_SENT_LOG_KEY` | L56 | `'gsl_gmail_sent_log'`, in localStorage: `{subject: ms}`. |
| `GMAIL_SENT_WINDOW_MS` | L57 | One hour. |
| `GMAIL_ADDRESS_RE` | L286 | The address-shape regex. Its literal is identical to `EMAIL_ADDRESS_RE_` in `EmailInfra.gs` L622. |

**Functions, in file order.**

- **`loadGmailSentLog` L59.** Parses localStorage defensively; returns `{}` on any failure.
- **`markReportSent(subject)` L65.** Stamps `Date.now()` and prunes entries older than one hour.
- **`gmailSentAt(subject)` L74.** Returns the timestamp, or `null` once the hour has passed.
- **`applyGmailButtonState(btn, subject)` L87.** Shows either the "Sent ✓ — click to resend" face (class `copied`) or
  the normal face. When sent, it arms `btn._gmailRevertTimer` to flip the button back at the end of the hour. The
  button is never disabled.
- **`applyGmailButtonStatesFor(reports, btnIdFn)` L107.** Applies the above to each rendered row.
- **`getGmailClientId` / `setGmailClientId` L114/L117.** Read and write localStorage, falling back to the default id.
- **`gmailTokenValid()` L121.** True when a token exists and the current time is before expiry minus 5 s.
- **`updateGmailStatusUI()` L125.** Updates `#gmailAuthStatus` and `#gmailConnectBtn` (via textContent only).
- **`fetchGmailUserEmail()` L142.** Calls `GET oauth2/v3/userinfo` with the Gmail token. Cosmetic; failures are
  swallowed.
- **`initGmailTokenClient(clientId)` L155.** Calls `google.accounts.oauth2.initTokenClient({client_id, scope,
  callback})`. There is **no `error_callback`** (see I-3). The callback works as follows:
  - On `resp.error`: show the error, clear the token, clear the pending slot.
  - On success: store the token and expiry (from `expires_in`, default 3600), fetch the user email, then replay
    `_pendingGmailSend`. A bulk entry goes to `_runBulkGmailSend`. A single entry goes to
    `performGmailSend(...).then(_alertIfGmailSendBlocked)`.
- **`_alertIfGmailSendBlocked(p)` L190.** Shows an `alert()` with `p.blockedReason`.
- **`connectGmail()` L194.** If there is no client id, it opens the setup panel. Otherwise it lazily initialises the
  token client and calls `requestAccessToken({prompt: gmailAccessToken ? '' : 'consent'})`.
- **`saveGmailClientId()` L210.** Saves the id, resets the token client, and reconnects.
- **`utf8ToBase64(str)` L222.** `TextEncoder`, then `fromCharCode` in 8,192-byte chunks, then `btoa`.
- **`encodeHeaderUtf8` L239.** Plain ASCII passes through unchanged. Anything else becomes one
  `=?UTF-8?B?...?=` encoded word, with no folding (RFC 2047 caps an encoded word at 75 characters; Gmail tolerates
  longer ones; INFO).
- **`toBase64Url` L242.** Base64url without padding.
- **`buildRawEmail(to, cc, subject, body, htmlBody)` L250.** Headers are To, an optional Cc, the encoded Subject, and
  MIME-Version.
  - Without HTML: a single `text/plain` part, 8bit.
  - With HTML: `multipart/alternative` with a random boundary `gsl_boundary_<rand>`, a text part, an HTML part, both
    8bit.

  `to` and `cc` are pasted into the headers verbatim, so the gate below is what makes that safe.
- **`gmailAddressListProblems(list, field, required)` L290.** Splits on `[,;]+`, trims, drops blanks, and tests each
  part against the regex. The `.gs` twin splits on `,` only.
- **`gmailVisibleText(html)` L303.** Strips `style`, `script` and `head` blocks, then all tags, decodes five entities,
  and collapses whitespace. Identical to `visibleTextOfHtmlGs_`.
- **`prepareGmailSend(report, to, cc)` L315.** Normalises `to`/`cc` (an array is joined with `,`), replaces runs of
  CR/LF in the subject with a space, and treats an empty `html` as absent. Problems it reports:
  - no report;
  - no address in To and Cc combined;
  - any malformed To or Cc address;
  - an empty subject;
  - a blank plain-text body;
  - HTML that is present but has no visible text.

  Returns `{msg:{to, cc, subject, body, html}, problems}`. Unlike the backend gate it does not check lead ids
  (documented).
- **`performGmailSend(pending)` L339.** The single place every Gmail send goes through.
  1. Run the gate. If it reports problems: set `pending.blockedReason`, log to the console, show "Blocked ✗" on the
     button for 6 s, and return `false`.
  2. Otherwise: disable the button and show "Sending…".
  3. `POST gmail/v1/users/me/messages/send` with `{raw}` built from the **normalised** message.
  4. On a non-OK response, throw with the API error message.
  5. On success: `markReportSent(report.subject)` (the original subject), then `logEmailSend(report, to, cc)` without
     awaiting it, then restore the button state. Return `true`.
  6. On failure: show "Failed ✗" for 3 s, then restore the button from the sent log. Return `false`.
- **`sendReportViaGmail(report, btnId)` L399.** Checks for a client id, then calls `recipientsForReport` (synchronous
  but awaited). If there is neither To nor Cc, it highlights the missing regions. If the token is valid it sends now;
  otherwise it stashes `_pendingGmailSend` and calls `connectGmail()`.
- **`sendRegionReportGmail(idx)` L420.** Sends from `window._regionReports`. **`sendAllReportGmail(i)` L424** sends from
  `_allReports`.
- **`_runBulkGmailSend(reports, btnIdFn, statusElId, confirmText)` L435.** Asks `confirm()` first. Then, one report at
  a time: resolve recipients, skip a report with none (collecting the missing regions), update the status, await
  `performGmailSend`, and count it as sent, blocked or failed. Ends with one summary status line. The token is not
  re-checked during a batch; a token that expires mid-batch shows up as failures.
- **`sendAllReportsGmail(...)` L466.** Checks for a client id. If the token is invalid it stashes a bulk pending entry
  and connects; otherwise it runs the bulk send directly.
- **`initGmailUI()` L482.** Wires up the setup panel, the connect button and the save button. Called at parse time from
  `reports-ui.js`.

### 2.3 `js/reports-ui.js`

**State.**

| Name | Line | What it is |
|---|---|---|
| `REGION_RECIPIENTS_KEY` | L40 | `'gsl_region_recipients_v1'`, in localStorage: `{region: {to, cc}}` with comma-joined strings. This is per browser only; nothing in `js/` reads or writes the `Region_Recipients` Sheet tab (see I-12). |
| `regionRowId`, `recipientCellId` | L70-71 | DOM id builders. |
| `TEST_MODE_OVERRIDE_EMAIL` | L212 | `let`, must be `''` in production. When set, it replaces To with itself and empties Cc for every send path. Twin of `TEST_MODE_OVERRIDE_EMAIL_` in `EmailInfra.gs` L43. |

**Functions, in file order.**

- **`reportRegionNames()` L45.** The sorted distinct values of `REGION_GROUP_MAP`. There are 11; the comment says "10"
  (stale).
- **`loadRegionRecipients` / `saveRegionRecipients` / `setRegionRecipientField` L49-64.** localStorage CRUD; values are
  trimmed.
- **`splitEmails(s)` L66.** Split on `[,;]+`, trim, drop blanks.
- **`emailChipBoxHTML(region, field)` L78.** Chips plus an input and a "Clear all" button. Every value, including the
  `data-*` attributes, goes through `esc()`, which escapes `& < > " '` (`core-ui.js` L15).
- **`refreshRecipientCell`, `addRegionRecipientEmails` (case-insensitive de-dupe), `removeRegionRecipientEmail`
  (case-sensitive exact match), `clearRegionRecipientField`** L91-128. Addresses are **not validated when entered**;
  they are validated only when sending, and only by the Gmail gate (mailto never validates).
- **`initEmailChipHandlers(container)` L133.** Delegated listeners:
  - click on × removes a chip; click on "Clear all" clears the field;
  - Enter or `,` commits the typed text; Backspace on an empty input removes the last chip;
  - focusout commits any pending text.
- **`renderRegionRecipientsTable()` L171** and **`initRegionRecipientsPanel()` L191.** Build the table and wire the
  toggle.
- **`recipientsForReport(report)` L228.** Uses `report.regionNames`, falling back to `[report.region]`. Takes the union
  of the configured To and Cc addresses (de-duplicated by exact string) and lists the regions that have neither. Then
  applies the test override. Returns `{to, cc, missing}`. RM_Hierarchy routing is deliberately not used here.
- **`openMailto(subject, body, to, cc)` L250.** Builds `mailto:<enc(to)>?subject=&cc=&body=` with
  `encodeURIComponent` and clicks a temporary `<a>`. A long body may be truncated by the mail client (documented). No
  gate runs here, which is safe because everything is URI-encoded.
- **`flagMissingRegionRecipients(regions)` L263.** Opens the panel, scrolls to it, and outlines each region's To cell
  in red for 2 s.
- **`sendReport(report)` L285.** The mailto flow. It flags missing regions but still opens with whatever addresses are
  configured.
- **`sendRegionReport(idx)` L294** and **`sendAllReport(i)` L298.**
- **`renderRegionReports()` L302.** Single-issue mode: resets `_lastReportOutOfScopeNames`, calls
  `buildRegionReports(select value)`, hides the bulk download, renders cards (escaped subject and body; Copy, Mail and
  Gmail buttons), sets `window._regionReports`, and applies the Sent states.
- **`copyRegionReport(idx)` L337** and **`copyGenericReport(arr, idx, btnId)` L355** (the latter is used by
  `tab-movement.js`). Both use the Clipboard API.
- **`syncReportControls()` L371.** Toggles the issue select, the combine checkbox and the "Generate all" button by
  mode.
- **`renderReports()` L387.** The `#generateBtn` handler.
  1. Calls `renderMorningBrief()`.
  2. In issue mode, delegates to `renderRegionReports()`.
  3. Otherwise builds `preliminary = buildRegionWiseReports(combine)`. If that is empty, renders the empty notice.
  4. `leadsToPush` is the union of `r.sorted` across reports, de-duplicated by `lead_id` (the first copy wins).
  5. Calls `tryClaimGenerateCycle('operations')`. If the claim fails it shows an amber status and returns.
  6. Disables the button, then: `clearLeadFollowupsTab()` (on error, show it and return), `pushLeadsToFollowups()`
     (on `false`, show "Nothing sent" and return), and `waitForAllFollowups(ids)`.
  7. `finally` re-enables the button and releases the claim. There is **no `catch`** (see I-2).
  8. A cancelled wait (`null`) falls back to the `preliminary` reports, with an amber banner and an "unreviewed" bulk
     Gmail button. Otherwise it rebuilds with the lookup.
  9. Renders the cards and applies the Sent states.

  Parse-time wiring at L496-500: the mode change handler, the generate click handler, `syncReportControls()`,
  `initRegionRecipientsPanel()` and `initGmailUI()`. This is why `reports-gmail.js` must load first; it does
  (`dashboard.html` L1449-1452).
- **`renderAllRegionReports()` L511.** Calls `renderMorningBrief()`, disables the button, and after a `setTimeout(10)`
  builds `_allReports = buildAllRegionReports()`. It renders the reports grouped by issue label, with rows that lazily
  build a preview (via `textContent`). A throw inside the timeout would leave the button disabled (INFO). The comment
  above it at L510 ("Joins names naturally") is stray: it belongs to `joinAnd`.
- **`toggleReportPreview(i)` L567**, **`copyAllReport(i)` L578**.
- **`downloadAllReports()` L589.** Writes a `.txt` blob of every report. The filename stamp comes from
  `toISOString()`, which is UTC, not IST (I-13).

### 2.4 `js/sheets-writeback.js`

**State.**

| Name | Line | What it is |
|---|---|---|
| `AUTO_SNAPSHOT_KEY` | L13 | `'gsl_auto_snapshot_on_refresh'`, in localStorage. |
| `SEND_LOG_TAB_NAME`, `SEND_LOG_COLUMNS` | L135-136 | `Send_Log`; 9 columns: `sent_at, issue_key, issue_label, region, subject, to, cc, lead_count, sent_by`. |
| `_sendLogSheetEnsured`, `_dailyCohortHistorySheetEnsured`, `_featureUsageSheetEnsured` | — | Per-page-load flags meaning "this tab has been confirmed to exist". |
| `_generateCycleOwner` | L296 | `null`, `'operations'` or `'overnight'`. An in-memory lock, scoped to one page. |
| `DAILY_COHORT_HISTORY_*` | L492-496 | 12 columns, keyed on `date_region` = `"date|region"`. |
| `_followupWaitCancelled` | L753 | `Map` from cancel button id to a boolean. |
| `FEATURE_USAGE_*` | L940-941 | `component_id, last_used_at, use_count, first_seen_at`. |
| `TRACKED_COMPONENT_IDS` | L951 | 9 tab ids. Twin of `TRACKED_COMPONENT_IDS_GS_`. |
| `_componentUsageRecordedThisSession` | L981 | `Set`. |

The tab-name constants `LEAD_FOLLOWUPS_TAB_NAME`, `SLA_HISTORY_TAB_NAME`, `MOVEMENT_LOG_TAB_NAME`,
`MOVEMENT_LOG_RUNS_TAB_NAME` and `SNAPSHOT_FIELD_KEYS` live in `tab-movement.js` L46-100. The globals `_currentSheetId`,
`gateAccessToken`, `gateUserEmail` and `allParsedLeads` come from other files.

All reads go through `sheetsApiValuesGet` (`core-sheets-fetch.js` L107), which uses **`UNFORMATTED_VALUE` with
`SERIAL_NUMBER` dates**. A cell Sheets has parsed as a date therefore reads back as a number, not as the string that
was written. This matters for I-5.

**Functions, in file order.**

- **`initAutoSnapshotCheckbox()` L15** (called from `tab-movement.js` L1398) and **`autoSnapshotEnabled()` L26.**
- **`istDateTimeValue(date)` L37.** Formats an IST `YYYY-MM-DD HH:mm:ss` using `istParts`. Correct in any browser
  timezone.
- **`movementCellValue(l, key)` L47.** `lead_assigned_at`, `last_connect_time` and `opp_at` are converted with
  `parseDate`, then `istDateTimeValue`, or `''`. Every other field passes through unchanged, with `null` becoming `''`.
- **`leadContentHash(l)` L67.** Takes `SNAPSHOT_FIELD_KEYS` values through `movementCellValue`, then `String`, joins
  them with NUL, and returns the lowercase-hex SHA-256 (`crypto.subtle`). Mirrors `_leadContentHashGs_`
  (`MovementTracker.gs` L165), including the same three date fields.
- **`appendSheetRows(tab, rows, opt)` L86.** `POST values/<tab>:append`, with `USER_ENTERED` by default (or `RAW`) and
  `INSERT_ROWS`. Throws the API message on failure.
- **`sheetsApiValuesBatchUpdate(data, opt)` L106.** `POST values:batchUpdate`.
- **`setFollowupsPushStatus(text, color, elId)` L120.**
- **`ensureSendLogSheet_()` L145.** Looks up the tab id. If the tab is missing it calls `addSheet` and appends the
  header (`RAW`), then sets the flag. Two calls running at once can race on the very first creation (I-9).
- **`logEmailSend(report, to, cc)` L168.** Best effort. Appends a `RAW` row: the IST time, `issueKey`, `issueLabel`,
  `regionNames` joined (or `region`), subject, `to`, `cc`, count, and the gate user's email. Errors go to the console
  only.
- **`pushLeadsToFollowups(rows, statusElId)` L208.**
  1. Returns `true` for an empty list and `false` without a sheet id.
  2. If the token is invalid, it awaits `gateSignIn()` once.
  3. Reads `Lead_Followups!A2:A` and builds a map from lead id to row number. Duplicate ids in the sheet resolve to
     the last one.
  4. For each row it builds `collated` (from `collateFamilyComments(r)`) and `own` (from `ownComments(r)`), each line
     formatted as `"RM: comment (ts) [outcome]"`.
  5. An existing id gets three range updates: A:E, G and H. Column F (the suggestion) is never touched. A new id is
     appended as `[id, region, RM, issue, collated, '', updatedAt, own]`.
  6. All writes use **`USER_ENTERED`**: `updated_at` becomes a real datetime, which the conditional formatting in
     `LeadFollowupsStaleness.gs` needs, and `lead_id` becomes a number.
  7. Within one call there is no de-duplication of `rows`; the Operations caller de-duplicates, the Overnight caller
     does not (I-8).
  8. Sets a status line and returns `true`, or `false` on error.
- **`getSheetIdByTabName(tab)` L274.** `GET spreadsheets/<id>?fields=sheets.properties(sheetId,title)`. Returns the
  numeric id or `null`.
- **`tryClaimGenerateCycle(owner)` L298.** Succeeds when the lock is free or already held by the same owner (so it is
  re-entrant). `releaseGenerateCycle` (L303) clears it only for that owner. `generateCycleOwnerLabel` (L306) returns
  the display text.
- **`clearLeadFollowupsTab()` L319.** Looks up the tab id (returns if the tab does not exist), reads `A2:A`, and calls
  `deleteDimension` on rows from index 1 to `1 + count`. There is no lock against the 13:00 Apps Script upsert
  (I-7).
- **`upsertSlaHistoryRows(entries)` L356.** Reads `SLA_History!I2:I` and builds a map from `snapshot_at` to row
  number. Each row value is `[date, openTotal, breachedTotal, ...ISSUE_PRIORITY counts, snapshot_at, source]`. An
  existing key gets an A:J update; a new key is appended. Both are `RAW`. If anything was written, it then calls
  `sortSlaHistorySheet_()` (errors swallowed).
- **`sortSlaHistorySheet_()` L401.** `sortRange` from row index 1, ascending on column I.
- **`backfillSlaHistoryFromMovementLog()` L444.** Groups `movementSnapshots` by the exact `snapshot_at` millisecond.
  For each instant it calls `enrichSnapshotCached(rec)` on every record and counts open and breached leads per check.
  Each entry gets `source:'Backfill'`. Entries are sorted, then upserted. Wired to a button on the Tracking tab.
- **`ensureDailyCohortHistorySheet_()` L500.** The same lazy-create pattern.
- **`upsertDailyCohortHistoryRows(entries)` L527.** Ensures the tab, reads `A2:A` keys, writes A:L rows (`RAW`), then
  sorts on columns B and C.
- **`sortDailyCohortHistorySheet_()` L567.**
- **`fetchDailyCohortHistoryForDate(dateKey)` L604.** Reads `A2:L`; any error returns `null`. Filters on
  `r[1] === dateKey` and returns `{dateKey, totalCreated, byRegion: Map}`.
- **`fetchAllDailyCohortHistoryRows()` L645.** Returns every row as `{date, region, stats}`.
- **`backfillDailyCohortHistoryFromMovementLog()` L687.** Takes `eligibleDailyCohortDates()`, runs
  `computeDailyCohortByRegion(d, {ignoreFilters: true})` for each, and upserts.
- **`clearDailyCohortHistory()` L711.** Deletes all data rows. Errors propagate to the caller.
- **`sleepCancelable(ms, key)` L735.** A 500 ms tick that wakes early when the wait is cancelled.
- **`showFollowupWaitControls` L755.** Shows or hides a cancel button. Two cancel-button listeners are attached at parse
  time (L760-765).
- **`waitForAllFollowups(leadIds, statusElId, cancelBtnId)` L780.** An unbounded loop:
  1. Check for cancellation (return `null`).
  2. Read `Lead_Followups!A2:G`.
  3. Build a lookup from id to non-empty F.
  4. If nothing is missing, return the lookup. Otherwise show progress and sleep 20 s.

  `finally` hides the cancel button. A read error (an expired token or a network blip) **throws out of the loop**
  (I-2).
- **`setSnapshotStatus` L825.**
- **`browserSnapshotOpenLeads()` L830.**
  1. Requires a sheet id and data; re-signs in once if the token is invalid.
  2. Sets `now`, label `'Browser — <IST>'`, and `snapshot_at` (IST).
  3. **Re-fetches Movement_Log** to get each key's latest hash.
  4. For every lead in **`allParsedLeads`**: compute the hash and skip the lead if the hash equals the latest for key
     `lead_id|RM`. Otherwise build the row `[snapshot_at, label, ...SNAPSHOT_FIELD_KEYS values, hash]`.
  5. Append to Movement_Log (`USER_ENTERED`).
  6. Always append a Movement_Log_Runs row `[at, label, seen, changed]`.
  7. Call `snapshotSlaHistory(now)` (`core-filters.js` L161).
  8. Re-fetch Movement_Log and re-render the Tracking, Movement, Stalled and RM Timeline views.

  `allParsedLeads` holds **collated** records (I-1).
- **`ensureFeatureUsageSheet_()` L957.** Lazy create.
- **`computeFeatureUsageUpsert_(existing, id, now)` L990.** A pure function. The last matching row wins. Returns
  `{rowNum, rowValues: [id, now, prevCount+1, firstSeen || now]}`.
- **`recordComponentUsage(componentId)` L1008.** Only for ids on the roster, and at most once per page load. The id is
  marked as recorded **before** checking for a sheet or token, and before the write, so a failure is never retried
  that session (I-14). It ensures the tab, reads A2:D, then updates or appends (`RAW`). Fire-and-forget. Called from
  the tab-switch click handler and from `fetchAndRender`.

---

## 3. End-to-end narratives

### 3.1 Generating region reports

- **Issue mode** (`#reportModeSelect = issue`). `renderReports` delegates to `renderRegionReports`, which calls
  `buildRegionReports(issueKey)` over `issueLeads`.
  - `issueLeads` is the per-copy view, rebuilt from scratch by `applyFiltersAndRender` (`core-filters.js` L116) on
    every filter change or refresh.
  - Each copy's region resolves via `effectiveRegion` (`project_region` = loan, then `group_source` = loan, then
    `region`) and then `mainRegionFor` (normalised exact match, then the numbered-suffix fallback, otherwise `null`,
    which means excluded).
  - Within a region, copies group by `RM||TL`, then by calendar day.
  - One email per region. Suggested follow-ups are always algorithmic here (`suggestedFollowUp`); Lead_Followups is not
    involved.
- **All issues x regions.** `#generateAllReportsBtn` runs `buildAllRegionReports()`: six single-issue builds,
  rendered grouped by issue. No Lead_Followups cycle.
- **Combined All-Issues** (`mode = region`). `buildRegionWiseReports(combine)` assigns each copy exactly one primary
  issue (in `ISSUE_PRIORITY` order) and appends side sections: Stalled (first), Not Connected, additional Stuck,
  Closed-no-comment, and Premature-close.
  - With `combine` checked there is one email whose label comes from the Region filter.
  - Unchecked, there is one email per main region.
  - The Lead_Followups cycle (3.4) supplies human-typed suggestions.
- **Templates.** Every builder produces a plain-text `body` (used by mailto and Copy) and an `html` (Gmail only) from
  `renderReportEmailHTML`. Both use `EMAIL_SIGNATURE`. Dates are IST throughout (`istDayLabel`, `istStamp`,
  `istDateKey`).

### 3.2 Gmail send

1. **Grant.** A second token client is created with `gmail.send` scope, separate from the sign-in gate's spreadsheets
   scope. The token lives in memory with an expiry; `prompt:'consent'` is used only when there was no previous token.
2. **Click to send.** `sendReportViaGmail` resolves recipients from the localStorage panel (union over `regionNames`,
   then the test override).
   - With no recipients it highlights the missing regions and stops.
   - With a valid token it calls `performGmailSend` immediately.
   - Otherwise it stashes `_pendingGmailSend` and calls `connectGmail`. The success callback replays the stash.
3. **Gate.** `prepareGmailSend` collapses CR/LF in the subject, rejects any address with whitespace or one of
   `<>,;"()[]\`, and rejects an empty body or HTML with no visible text. Header injection through To, Cc or Subject is
   therefore closed.
4. **MIME.** `buildRawEmail` produces `multipart/alternative` (text plus HTML, 8bit) with an RFC 2047 subject, encoded
   as base64url and sent to `messages/send`.
5. **After success.** `markReportSent(subject)` updates the localStorage "Sent ✓" state for one hour; it does not block
   a resend. `logEmailSend` appends to Send_Log without being awaited.
6. **Bulk.** `sendAllReportsGmail` / `_runBulkGmailSend` sends one report at a time after a single `confirm()`, and
   counts sent, failed, blocked and skipped. Bulk entry points:
   - the "Send all via Gmail (unreviewed)" banner on a cancelled wait (`reports-ui.js` L477);
   - callers elsewhere (Movement tab buttons).

### 3.3 mailto flow

`sendReport` resolves recipients the same way (including the test override), flags missing regions but still opens,
and calls `openMailto(subject, body, to, cc)` with every component URI-encoded. The user's mail client takes over, and
the user still has to press Send. Nothing is logged: no Send_Log row and no Sent state.

### 3.4 Write-back paths

- **Movement_Log snapshot.** The `#snapshot` button, or automatically after `fetchAndRender` when
  `gsl_auto_snapshot_on_refresh` is on (`core-fetch-and-render.js` L611). It runs `browserSnapshotOpenLeads`:
  1. Fresh Movement_Log read.
  2. Per-key hash de-duplication (writes are shared with the `.gs` writer).
  3. Append the changed rows (`USER_ENTERED`).
  4. Movement_Log_Runs row.
  5. SLA_History row at the same instant.
  6. Re-render.

  See I-1: the leads it writes are merged customers.
- **Lead_Followups** (Operations Generate, and Movement's Overnight Generate in `tab-movement.js` L1274):
  1. Take the in-page lock (`tryClaimGenerateCycle`).
  2. `clearLeadFollowupsTab` deletes every data row.
  3. `pushLeadsToFollowups` upserts by lead id. It writes A:E, G and H and never F.
  4. `waitForAllFollowups` polls F every 20 s until every id has a value, or the user cancels.
  5. Rebuild the reports with the lookup, then release the lock.

  The Apps Script writer (`pushUnresolvedToLeadFollowups_`, 13:00 IST) upserts and never clears, and it cannot see
  this lock.
- **SLA_History.**
  - `snapshotSlaHistory()` runs on every `fetchAndRender` (`core-fetch-and-render.js` L589), with source `Dashboard`
    and `asOf = _renderNow`.
  - It also runs at the snapshot instant (see above).
  - `upsertSlaHistoryRows` keys on the `snapshot_at` string, writes `RAW`, then sorts the tab on column I.
  - The backfill reconstructs one row per Movement_Log instant (source `Backfill`).
  - `MovementTracker.gs` appends its own rows with `setValues` (source `AppsScript`) 4 times a day (I-5).
- **Daily_Cohort_History.** `upsertDailyCohortHistoryRows` is called once per refresh by `persistDailyCohortHistory`
  (`tab-tracking.js`), plus a backfill and a clear. Rows are keyed on `date|region`, written `RAW`, and sorted on B and
  C. Readers: `fetchDailyCohortHistoryForDate` and `fetchAllDailyCohortHistoryRows`, which return `null` or `[]` on any
  error.
- **Feature_Usage.** `recordComponentUsage`: once per tab per page load, a read-modify-write upsert by
  `component_id` (`RAW`). `OpsChecklistRunner.gs` reads it weekly.
- **Send_Log.** Fire-and-forget after each successful Gmail send (`RAW`).

---

## 4. Cross-runtime parity notes

| Pair | Status |
|---|---|
| `REGION_GROUP_MAP` / `normRegionKey` / `mainRegionFor` vs `EmailInfra.gs` L459-486 | **Identical** keys and values, and the same numbered-suffix fallback. The only difference: `normRegionKeyGs_` uses `String(s \|\| '')` where the browser uses `String(s)`. |
| `effectiveRegion` | The browser checks `project_region`, then `group_source`, then `region`. `MovementTracker.gs` L1063 has `_effectiveRegionGs_`, which checks **group_source only** and is used for one Movement-side consumer. The emailers have no twin, as HANDOVER §6 says. The phrase "NO working twin" in HANDOVER §6 is slightly stale: a partial port exists. |
| `GMAIL_ADDRESS_RE` vs `EMAIL_ADDRESS_RE_` | Identical literals. |
| `gmailAddressListProblems` vs `emailAddressListProblemsGs_` | The browser splits on `[,;]+`; the `.gs` side splits on `,`. The browser treats To as optional (it only needs some address in To or Cc); the `.gs` side requires To. Both differences are intentional and documented (the panel can be Cc-only). |
| `gmailVisibleText` vs `visibleTextOfHtmlGs_` | Identical. |
| `prepareGmailSend` vs `prepareOutgoingEmailGs_` | Same subject CR/LF collapse and body checks. The browser has no lead-id check (documented). |
| `TEST_MODE_OVERRIDE_EMAIL` vs `_` | Both `''`. |
| `TRACKED_COMPONENT_IDS` vs `_GS_` | Not re-verified here (owned by the OpsChecklistRunner auditor). |
| `leadContentHash` vs `_leadContentHashGs_` | Same field order (`SNAPSHOT_FIELD_KEYS` equals `SNAPSHOT_COLUMNS_`), the same three date fields formatted as IST `yyyy-MM-dd HH:mm:ss`, NUL join, SHA-256, hex. Parity holds per row. **The record being hashed differs** for collated customers (I-1). |
| Lead_Followups writer | The browser writes `USER_ENTERED`, never writes F, does not de-duplicate within a push, and clears the tab at the start of each cycle. `pushUnresolvedToLeadFollowups_` upserts, never clears, and collapses duplicate ids (P7). The de-duplication difference is I-8. |
| SLA_History writer | The browser writes `RAW` text in columns A and I. `writeSlaHistorySnapshot_` (`MovementTracker.gs` L553-569) writes the same strings with `setValues`, which Sheets parses into date and datetime values. See I-5. |

---

## 5. Findings

**I-1. MED. `js/sheets-writeback.js` L854-877. The browser snapshot writes merged-customer records, not per-row
records. CONFIRMED (that it happens); the downstream impact is SUSPECTED.**

`leadsToSnapshot = allParsedLeads`. `allParsedLeads` is `dedupedLeads` (`core-fetch-and-render.js` L584): **one merged
record per customer group**. A group of two or more rows becomes a primary row's `lead_id` and `RM` combined with:

- `call_attempts`, `call_count` and `duration` = the maximum over **all** the customer's leads (L433-436);
- comments merged across every copy (L392-393);
- `lead_assigned_at` = the earliest across copies, as an ISO string.

The comment at L848-853 says this "matches MovementTracker.gs's own trigger exactly". It does not: the `.gs` trigger
writes one row per sheet row. Consequences, for every collated customer (one with copy splits):

- (a) Every browser snapshot writes a new row under the primary's `lead_id|RM`, because the merged hash never equals
  the `.gs` per-row hash. The next `.gs` run then sees a changed hash and writes again: permanent churn.
- (b) That primary lead id's Movement_Log history carries another lead's higher `call_attempts`. The per-lead "calls
  today" baseline (HANDOVER §6, email audit F18) can then use an inflated baseline after a browser snapshot, which
  under-counts calls today and can produce spurious "Behind on Today's Calls" flags.
- (c) `lead_assigned_at` and comments come from sibling leads.

The secondary copies are simply never captured by the browser.

Scenario: auto-snapshot is on and a refresh happens at 23:00. A customer has lead A (40 attempts) and lead B (5
attempts), and B is the primary. The row written for B has 40 attempts. Next day, B's baseline is 40, so B's calls
today stay at 0 no matter how many calls are made.

Fix direction: snapshot from the per-row units (`expandCopySplits`), not from the merged parent.

**I-2. MED. `js/sheets-writeback.js` L780-815 with `js/reports-ui.js` L432-458. The unbounded follow-up wait dies
silently on the first failed poll. CONFIRMED.**

`waitForAllFollowups` has no timeout by design, and a person may spend more than an hour typing suggestions. The gate
token from GIS lasts about one hour (`gateTokenValid`). Once it expires, `sheetsApiValuesGet` throws a 401, and so does
any single network blip. The throw escapes the `while` loop. `renderReports` has `try/finally` with no `catch`, so the
promise rejects unhandled.

What the user sees: the status freezes at "Waiting for follow-ups: x of y (check #N)…"; the cancel button disappears;
no reports render, not even the `preliminary` fallback; and the suggestions the person typed are never used. The same
applies to the Overnight flow in `tab-movement.js`.

Fix direction: catch errors inside the loop, re-sign in or retry, and keep polling.

**I-3. MED. `js/reports-gmail.js` L155-186 and L411-417. A stashed Gmail send can fire later without the user asking
again. SUSPECTED (depends on GIS behaviour as documented).**

`initTokenClient` is configured without an `error_callback`. GIS reports a popup that was closed or blocked through
`error_callback`, not through `callback`. When that happens, `_pendingGmailSend` is never cleared.

Scenario: the user clicks "Send via Gmail" on report X, the consent popup opens, and they close it because they
changed their mind. Later they click "Connect Gmail" (or a different report's Send button, which would overwrite the
stash and is harmless). The success callback replays X and sends a real email with no further click.

- A stashed single send has no confirm step.
- A stashed bulk send does show its `confirm()`.

Fix direction: add an `error_callback` that clears `_pendingGmailSend`, or expire the stash after a short time.

**I-4. LOW. `js/reports-build.js` L724-738 and L878. Stalled leads are cached on a key that does not track their
inputs. CONFIRMED.**

The row cache is keyed only on the identity of the `issueLeads` array. `stalledByRegion = currentStalledRowsByRegion()`
also depends on `movementSnapshots` (via `computeStalledLeads`) and on the current time (a 6-hour quiet window). It is
cached with the rest. A Movement_Log refresh does not create a new `issueLeads` array: that includes a browser snapshot,
which calls `fetchMovementLog` and then re-renders only the Movement, Tracking and Stalled views. After that, the next
Generate reuses the stale Stalled section, which is described as the email's "MOST IMPORTANT" section. The same happens
across the unbounded wait between the two `buildRegionWiseReports` calls.

The comment at L870-875 ("read fresh every time this builds") contradicts the cache.

**I-5. LOW. `js/sheets-writeback.js` L356-426 against `MovementTracker.gs` L566-569. The two SLA_History writers
produce different cell types. SUSPECTED.**

The dashboard writes `date` (column A) and `snapshot_at` (column I) as `RAW` text. `writeSlaHistorySnapshot_` writes the
same-looking strings through `Range.setValues`, which parses date-like strings into real date and datetime values. This
is also the remaining source of the "date text vs serial in some rows but not others" mix that the comment at L381-384
blames on `USER_ENTERED`. `sheetsApiValuesGet` reads with `UNFORMATTED_VALUE`/`SERIAL_NUMBER`, so the AppsScript rows'
column I comes back as a serial number. Effects:

- (a) `backfillSlaHistoryFromMovementLog` never matches an AppsScript instant. It appends a second, `Backfill` row for
  the same capture instead of upserting.
- (b) `sortRange` on column I orders numbers before text, so AppsScript rows and Dashboard/Backfill rows sort as two
  separate blocks, not chronologically.

Severity depends on whether the Tracking reader de-duplicates or sorts itself (not checked).

**I-6. INFO. `js/reports-build.js` L968 and L1235. Grace-period text in the combined email overstates exclusion.
CONFIRMED.**

The combined email states, unconditionally, "Leads assigned less than N hours ago are excluded". Its main section can
contain Inactive-RM and never-connected Not Updated leads, which are deliberately exempt from the grace period (the
single-issue builder words this correctly at L512-516). A recipient may wrongly read a fresh lead in the list as a
bug.

**I-7. LOW. `js/sheets-writeback.js` L319-342. Clearing the tab is not coordinated with the Apps Script 13:00 upsert.
SUSPECTED.**

`clearLeadFollowupsTab` reads the row count and then deletes rows by index. `pushUnresolvedToLeadFollowups_` (13:00 IST)
reads a map from lead id to row number and then writes by row number, and its `waitForFollowupSuggestions_` polls for
about 2 minutes. A dashboard Generate that starts inside that window causes problems in both directions:

- the Apps Script writes can land on shifted rows (overwriting a different lead), and
- its suggestion wait reads an emptied tab, so it sends with only algorithmic follow-ups.

`LEAD_FOLLOWUPS_STALENESS.md` discusses only the opposite direction (why Apps Script must not clear). The window is
narrow, but nothing prevents it.

**I-8. LOW. `js/sheets-writeback.js` L239-253. `pushLeadsToFollowups` does not collapse duplicate lead ids. SUSPECTED.**

If `rows` contains the same new `lead_id` twice, both are appended as separate rows. Operations de-duplicates first
(`reports-ui.js` L412-419). The Overnight caller passes `overnightEmailableLeads(cohortLeads)`, which is per copy, without
de-duplicating. Copy splits are de-duplicated per lead id within a group, but literal duplicate rows across groups are
not ruled out.

The Apps Script twin collapses to one row (email audit P7), so the two writers behave differently. The result would be
two rows for one lead, which the person filling in column F would have to resolve.

**I-9. LOW. `js/sheets-writeback.js` L145-162, L500-517, L957-974. Lazy tab creation races when two calls run at once.
CONFIRMED (by reading the code).**

The `ensure*Sheet_` functions run "get id, then add sheet if missing, then append header" without an in-flight promise.
`logEmailSend` is not awaited by `performGmailSend`, so during a bulk send several `ensureSendLogSheet_` calls can
overlap. `recordComponentUsage` can also run twice at once (the `fetchAndRender` call plus a tab click).

The first time the tab is ever created:

- a second `addSheet` fails ("already exists"), and that Send_Log or usage row is silently lost; or
- a call whose `getSheetIdByTabName` lands between the first call's `addSheet` and its header append writes its data
  row **above** the header.

This applies only to first creation. Send_Log and Feature_Usage probably already exist live, so the impact is small.

**I-10. LOW. `js/reports-build.js` L941-947. Plain-text column widths break when `lead_id` is a number. SUSPECTED.**

`w.id = Math.max(7, ...items.map(r => idsFor(r).length))`. `lead_id` comes from `gvizCellRaw` over an
`UNFORMATTED_VALUE` read, so a digits-only lead id cell that is not formatted as text arrives as a number, and
`(2145357).length` is `undefined`. The maximum becomes `NaN`, `padEnd(NaN)` adds no padding, and the plain-text
`lead_id | region | RM | issue` table loses its alignment. Elsewhere in the same function the code defensively writes
`String(a.lead_id)`, which suggests numeric ids do occur. Cosmetic, and plain text only.

**I-11. INFO. `js/reports-gmail.js` L250-269 and `js/reports-build.js` L381-388. The 8bit HTML part can exceed the
RFC 5322 line length.** The HTML table rows are joined without newlines and sent with
`Content-Transfer-Encoding: 8bit`, so a large section produces lines well over the 998-octet limit. Gmail itself
accepts this. A relay to an external domain may re-wrap the lines and break tags. Recipients are most likely internal.
Fix direction: quoted-printable or base64 for the HTML part.

**I-12. LOW (documentation). `HANDOVER.md` §5, row `Region_Recipients`. CONFIRMED.**

The row says the tab is written by "the dashboard's 'Edit region recipients' UI (`js/reports-ui.js`, `localStorage` +
this tab)". Nothing in `js/` reads or writes `Region_Recipients`: the dashboard panel is per-browser localStorage only
(`REGION_RECIPIENTS_KEY`). The backend reads the Sheet tab independently.

A maintainer who edits recipients in the dashboard and expects the automatic emails to follow will be wrong. Two
browsers also see different recipient sets.

**I-13. LOW. `js/reports-ui.js` L599. The download filename is stamped in UTC.**
`new Date().toISOString()` names the bulk download file in UTC, which breaks the project's IST rule (CLAUDE.md). A file
downloaded at 03:00 IST is named for the previous day. Cosmetic.

**I-14. LOW. `js/sheets-writeback.js` L1009-1027. A failed usage write is never retried.** The component is added to
`_componentUsageRecordedThisSession` before the checks for a sheet id and token, and before the write. A call made
before sign-in, or one whose write fails (for example the I-9 race, or a transient error), suppresses every later
attempt for that tab in the same page load. The result is under-reporting into the 30-day stale-tab check, which could
falsely flag a tab as unused if this repeats.

**I-15. INFO. `docs/sheets/SHEET-005-sla-history.md`, "source" column. The documented source values are wrong.** It
lists the values `movement` / `browser` / `backfill`. The code writes `AppsScript` (`MovementTracker.gs` L566),
`Dashboard` (`core-filters.js` L195) and `Backfill` (`sheets-writeback.js` L469).

**I-16. INFO. Stale comments (no behaviour impact):**

- `reports-build.js` L640-644: describes the removed grace rule.
- `reports-build.js` L709-711: "line ~1351 / ~1421" refers to the old `reports.js`.
- `reports-build.js` L1254-1256: a duplicated comment block.
- `reports-build.js` L1230: a ternary whose two branches are identical ('Closed, No Comment').
- `reports-ui.js` L42: says "10 canonical groups"; there are 11.
- `reports-ui.js` L273: says "line ~5027".
- `reports-ui.js` L510: a `joinAnd` comment stranded above `renderAllRegionReports`.
- `sheets-writeback.js` L129: says "markReportSent in reports.js".
- `sheets-writeback.js` L311-312 and L848-853: see I-1.
- `reports-build.js` L870-875: see I-4.

**I-17. INFO. `js/reports-ui.js` L66-128, L244-246. Recipient handling has gaps.**

- Recipient addresses are not validated when entered. A typo is caught only by the Gmail gate at send time, and never
  on the mailto path.
- Chip de-duplication is case-insensitive, but removal and the union in `recipientsForReport` are case-sensitive, so
  `A@x.com` and `a@x.com` from two regions both stay in a combined email.
- `TEST_MODE_OVERRIDE_EMAIL` is used verbatim. If someone sets it to a `;`-separated list, the gate accepts it but the
  `To:` header keeps the `;`.

None of these is dangerous.

**Checked and not a defect:**

- XSS: every dynamic value interpolated into HTML across the four files goes through `esc()`, or into `textContent`.
- Header injection: To and Cc are regex-gated (no whitespace allowed), and CR/LF in the subject are collapsed.
- `_lastReportOutOfScopeNames` aliasing between the cache and later builders: every builder entry point reassigns a
  fresh object before mutating it.
- The undatable count in `buildRegionWiseReports` L761: every `ISSUE_PRIORITY` key is currently emailable, so only
  genuinely undatable leads are counted.
- Double-clicking Generate: the button is disabled synchronously before the first `await`.
- IST handling in `istDateTimeValue`, `istDayLabel` and `reportDateRange`: correct.
- Region map parity with `EmailInfra.gs`: identical.

---

## 6. Open questions

1. **I-1.** How often is "auto-snapshot on refresh" actually enabled (it is a per-browser localStorage flag)? Is there
   live evidence in Movement_Log of browser-label rows on collated customers with inflated `call_attempts`? A
   read-only query on Movement_Log rows labelled `Browser —%` would answer it.
2. **I-5.** Does `js/tab-tracking.js`'s SLA_History reader de-duplicate or sort rows by time itself? (Owned by another
   auditor.) Also confirm against the live tab that the AppsScript rows' column I is a datetime and not text.
3. **I-3.** Confirm the GIS version in use routes a closed popup to `error_callback` only, so that `callback` is never
   called for it.
4. Should Send_Log record the normalised `to`/`cc` (`prepared.msg`) rather than the raw inputs? Today they are the same
   because `recipientsForReport` already joins with `,`.
5. **I-12.** Is the `Region_Recipients` Sheet tab still read by the backend at all, now that routing is RM_Hierarchy
   based? The `.gs` comments mention it as a "legacy catch-all".
6. **I-2.** Is the "no timeout" design for `waitForAllFollowups` still wanted, given the token lifetime? A token refresh
   inside the loop would keep the design and fix the failure mode.
