/**
 * Lead_Followups Staleness Formatting — LEADFOLLOWUPS-002 (2026-09-09):
 * makes the tab's own `updated_at` column (G) impossible to miss when a
 * row has gone stale, for the consumer that actually caused the
 * confirmed lead 2229674 incident — a person directly opening the
 * `Lead_Followups` tab in Google Sheets (see LEAD_FOLLOWUPS_STALENESS.md,
 * "consumer 1"). LEADFOLLOWUPS-001's mapping found the originally-planned
 * fix (add a new per-row timestamp) was already wrong: column G already
 * exists, written by both real writers (`pushLeadsToFollowups`,
 * `js/sheets-writeback.js`; `pushUnresolvedToLeadFollowups_`,
 * `OvernightEmailer.gs`). What was actually missing is making it
 * VISUALLY unmissable.
 *
 * WHY CONDITIONAL FORMATTING, NOT A FORMULA COLUMN: a per-row formula
 * would need every writer touched, AND would silently break
 * `clearLeadFollowupsTab()`'s row-count-based `deleteDimension` (js/
 * sheets-writeback.js) — pre-filling formulas past the real data would
 * make leftover formula-only rows look like data to `pushLeadsToFollowups`'s
 * own append logic. A conditional format RULE is sheet-level metadata,
 * not per-cell content — it survives row deletions/insertions inside its
 * range untouched, so this needs ZERO changes to any writer.
 *
 * WHY THE DATE ARITHMETIC WORKS: both writers send column G as a
 * "yyyy-MM-dd HH:mm:ss" STRING via `valueInputOption=USER_ENTERED`
 * (Sheets API) or `Range.setValues()` (Apps Script) — Sheets auto-parses
 * that shape into a real Date-typed cell on write (the exact same
 * string-becomes-Date behavior already documented and confirmed for this
 * spreadsheet in HANDOVER.md §8's Unmatched_Comments_Log dedup incident),
 * so `NOW()-$G2` is real date arithmetic once the value lands, not string
 * comparison.
 *
 * THRESHOLDS, chosen from the real incident: that row was ~19 hours old
 * when read as current (written ~18:34 IST the evening before, read the
 * next morning). Amber at 12h gives a meaningful head start before a row
 * reaches that kind of age; red past 24h names it as actively suspect.
 *
 * ============================== SETUP (one-time) ==============================
 *   1. Same Apps Script project as every other file this project needs —
 *      see Core.gs's own header for the full list.
 *   2. In the function dropdown, select setupLeadFollowupsStalenessFormatting,
 *      click Run, approve permissions. Applies immediately — no trigger,
 *      no daily/weekly schedule, just a one-time sheet-formatting call.
 *   3. Re-run any time the thresholds/colors below change — replaces the
 *      whole rule set, so it's always safe to re-run.
 * ================================================================================
 */

const LEAD_FOLLOWUPS_STALE_ROWS_ = 999; // A2:H1000 — generous headroom past any realistic row count
const LEAD_FOLLOWUPS_AMBER_HOURS_ = 12;
const LEAD_FOLLOWUPS_RED_HOURS_ = 24;

// Pure — the exact formula/colors each tier uses, built as plain data so
// it's fully testable without touching SpreadsheetApp at all. $G is the
// anchor column (updated_at, absolute via $); the anchor ROW is always 2
// (the range's own first row) — Sheets reinterprets a formula rule
// relative to each row in the applied range automatically, the same way
// a formula written in row 2 and dragged down the column would.
function buildLeadFollowupsStalenessRuleSpecs_() {
  return [
    {
      tier: 'red',
      formula: '=AND($G2<>"",(NOW()-$G2)*24>' + LEAD_FOLLOWUPS_RED_HOURS_ + ')',
      background: '#f4c7c3', fontColor: '#a50e0e',
    },
    {
      tier: 'amber',
      formula: '=AND($G2<>"",(NOW()-$G2)*24>' + LEAD_FOLLOWUPS_AMBER_HOURS_ + ')',
      background: '#fce8b2', fontColor: '#7f6000',
    },
  ];
}

// One-time setup — run once from the function dropdown. Safe to re-run:
// REPLACES the sheet's entire conditional-format rule set with exactly
// these two every time, rather than trying to surgically merge with
// whatever's already there. Lead_Followups has no other formatting need
// (it's a fully code-generated tab, same as every other automated sheet
// in this project) — a wholesale replace is a deliberate simplification
// here, not a risk of clobbering an unrelated hand-added rule.
function setupLeadFollowupsStalenessFormatting() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(LEAD_FOLLOWUPS_SHEET_);
  if (!sheet) {
    Logger.log('Lead_Followups sheet not found — run a Generate cycle from the dashboard first (it creates the tab), then re-run this.');
    return;
  }

  const range = sheet.getRange(2, 1, LEAD_FOLLOWUPS_STALE_ROWS_, 8);
  const rules = buildLeadFollowupsStalenessRuleSpecs_().map(function (spec) {
    return SpreadsheetApp.newConditionalFormatRule()
      .whenFormulaSatisfied(spec.formula)
      .setBackground(spec.background)
      .setFontColor(spec.fontColor)
      .setRanges([range])
      .build();
  });
  sheet.setConditionalFormatRules(rules);
  Logger.log('Lead_Followups staleness formatting installed: amber past ' + LEAD_FOLLOWUPS_AMBER_HOURS_ + 'h, red past ' + LEAD_FOLLOWUPS_RED_HOURS_ + 'h since column G (updated_at).');
}
