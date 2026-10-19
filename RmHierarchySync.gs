/**
 * RM Hierarchy Nightly Sync (2026-10-08) — compares the company HR roster sheet with the live RM_Hierarchy and
 * Manager_Directory tabs every night, applies the changes that are unambiguous, and emails a short report of everything else.
 * It replaces the manual routine of exporting "HR Live", running test/refresh-rm-hierarchy.py, pasting RmHierarchy.gs and running
 * rebuildRmHierarchy(). Plan and rules: docs/_planning/RM_HIERARCHY_NIGHTLY_SYNC.md.
 *
 * WHAT IT NEVER DOES: remove a person. Someone who disappears from the HR sheet (or gets an Exit date) is only REPORTED — the row
 * stays in RM_Hierarchy until a human says remove (then: removeRmHierarchyLeaversNow, below - a one-off, console-run removal). Nor does it
 * revert a PINNED user-confirmed change (RMSYNC_PINNED_OVERRIDES_, 2026-10-19) while HR Live still disagrees - it lists it nightly instead. It never touches the Excluded / Note cells' existing text (a note is only
 * appended to), never overwrites an existing Manager_Directory email, and never guesses: a chain slot it cannot resolve to
 * exactly one tier is reported for a person to decide (the HR sheet's chain columns are positional, not per-role — see
 * RmHierarchy.gs's header — so blind copying is the bug class this project has already paid for twice).
 *
 * SOURCE: the first tab of the HR roster sheet (RMSYNC_HR_SHEET_ID_). The script's owner account must be able to open it (link
 * access "Anyone in Homesfy"). Same layout as the "HR Live" export test/refresh-rm-hierarchy.py reads (0-indexed columns: name 1,
 * role 2, team 15, exit 17, current chain names 6 / 8 / 10 / 12, official mail id 35); the header cells at those positions are
 * checked every night and a mismatch stops the run.
 *
 * MODES: report-only by default (the report says "would apply"); it writes only once Script Property RM_HIERARCHY_SYNC_APPLY is
 * "true" (enableRmHierarchySyncApplyNow / disableRmHierarchySyncApplyNow). Even then it holds (writes nothing, says so in the
 * report) when more than RMSYNC_MAX_CHANGES_ changes would be made in one night, and it backs the two tabs up to Drive first.
 *
 * ============================== SETUP (one-time) ==============================
 *   1. Paste this file (and Tests_RmHierarchySync.gs) into the Apps Script project, beside RmHierarchy.gs and EmailInfra.gs.
 *   2. Run setupRmHierarchySync once — installs the daily ~23:15 IST trigger (safe to re-run).
 *   3. Run syncRmHierarchyNightlyNow once by hand: it is report-only until apply is enabled, so it only emails a report.
 *   4. After 2–3 reports look right, run enableRmHierarchySyncApplyNow. disableRmHierarchySyncApplyNow turns it back off.
 * ================================================================================
 */

const RMSYNC_HR_SHEET_ID_ = '16l-0STI31eL4oly0u1jVVHujzqNASmH5K8l83ahstJQ';
const RMSYNC_JOB_NAME_ = 'syncRmHierarchyNightly';
const RMSYNC_RUN_HOUR_ = 23;
const RMSYNC_RUN_MINUTE_ = 15;
const RMSYNC_APPLY_PROPERTY_ = 'RM_HIERARCHY_SYNC_APPLY';
const RMSYNC_STATE_PROPERTY_ = 'RM_HIERARCHY_SYNC_STATE';
// Who gets the nightly report: looked up by NAME in the private employee table (the repository is public — no addresses here).
// A name the table does not have falls back to the address on that person's own HR-sheet row.
const RMSYNC_REPORT_NAMES_ = ['Snehil Chhimwal', 'Sushil Kannojiya', 'Ashish Ivlekar'];
const RMSYNC_MIN_PEOPLE_ = 250;     // the HR sheet listed 322 on 2026-10-08; far fewer means a broken read, not 70 resignations
const RMSYNC_MAX_CHANGES_ = 25;     // more writes than this in one night are held for a person to review
const RMSYNC_LIST_LIMIT_ = 60;      // lines per report section; the rest is "and N more"
const RMSYNC_STATE_MAX_CHARS_ = 8000; // a Script Property value is limited to ~9 KB

const RMSYNC_HR_COL_CODE_ = 0; // "New E Code"
const RMSYNC_HR_COL_NAME_ = 1;
const RMSYNC_HR_COL_ROLE_ = 2;
const RMSYNC_HR_COL_TEAM_ = 15;
const RMSYNC_HR_COL_EXIT_ = 17;
const RMSYNC_HR_COL_EMAIL_ = 35;
const RMSYNC_HR_CHAIN_COLS_ = [6, 8, 10, 12]; // A1 - 1/S2, A1 - 2, RH, CH/CL (current set; the older 2025-26 columns further right are never read)
const RMSYNC_HR_HEADER_EXPECT_ = { 1: 'name', 2: 'role', 6: 'a1 - 1/s2', 8: 'a1 - 2', 10: 'rh', 12: 'ch/cl', 15: 'team', 17: 'exit', 35: 'official mail id' };
const RMSYNC_TAB_HEADER_ = ['team', 'role', 'name', 'tl', 'tm', 'rh', 'ch', 'excluded', 'note', 'email'];
const RMSYNC_FIELDS_ = ['tl', 'tm', 'rh', 'ch'];
const RMSYNC_FIELD_COL_ = { tl: 4, tm: 5, rh: 6, ch: 7 }; // 1-based columns in RM_Hierarchy
// The same scope and tier mapping test/refresh-rm-hierarchy.py uses (SALES_TRACK_ROLES / OUT_OF_SCOPE_TEAMS / ROLE_TO_FIELD).
const RMSYNC_SALES_ROLES_ = ['s1', 's2', 's3', 'a1', 'tl', 'tm', 'rh', 'rm', 'bdm', 'cluster head', 'city lead', 'commercial head'];
const RMSYNC_OUT_OF_SCOPE_TEAMS_ = ['magnet (mumbai)', 'magnet pune'];
const RMSYNC_ROLE_TO_FIELD_ = { 'a1': 'tl', 'tl': 'tl', 'tm': 'tm', 'rh': 'rh', 'cluster head': 'ch', 'city lead': 'ch', 'commercial head': 'ch', 'leadership': 'ch' };
const RMSYNC_FIELD_LABEL_ = { tl: 'TL', tm: 'TM', rh: 'RH', ch: 'CH' };

// The read-only helpers come FIRST in this file on purpose: the editor's function dropdown lists functions in source order, and a Run
// that does not pick up the selected function runs the first one (seen on 2026-10-08 with DailyRmIssueLog.gs) - here that is harmless.
// Read-only: logs the full plan (no email, no writes) so a person can see everything the report truncates.
function showRmHierarchySyncPlanNow() {
  const hr = parseHrRosterGs_(readHrRosterValuesGs_());
  if (hr.problems.length) { Logger.log('The HR sheet is not laid out as expected: ' + hr.problems.join('; ')); return; }
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(RM_HIERARCHY_SHEET_);
  const directorySheet = ss.getSheetByName(MANAGER_DIRECTORY_SHEET_);
  const plan = computeRmHierarchySyncPlanGs_(hr, readRmHierarchyRowsGs_(sheet), directorySheet ? readManagerDirectoryRowsGs_(directorySheet) : null,
    { pins: rmSyncPinnedOverridesGs_(), pinsDone: readRmSyncStateGs_().pinsDone });
  const lines = rmSyncChangeLinesGs_(plan);
  Logger.log('Mode: ' + (rmHierarchySyncApplyEnabledGs_() ? 'APPLY' : 'report-only') + '. HR people: ' + hr.count + '.');
  [['New people', lines.joiners], ['Manager changes', lines.fixes], ['Manager_Directory', lines.directory]].forEach(function (s) {
    Logger.log(s[0] + ' (' + s[1].length + '):'); s[1].forEach(function (l) { Logger.log(l); });
  });
  const attention = rmSyncAttentionItemsGs_(plan);
  Logger.log('For a person (' + attention.length + '):');
  attention.forEach(function (i) { Logger.log(i.line); });
  Logger.log('Pending in HR Live (' + plan.pinPending.length + '):'); plan.pinPending.forEach(function (p) { Logger.log(p.line); });
  Logger.log('Now matching HR (' + plan.pinResolved.length + '):'); plan.pinResolved.forEach(function (p) { Logger.log(p.line); });
}

function showRmHierarchySyncStatusNow() {
  const state = readRmSyncStateGs_();
  Logger.log('RM hierarchy sync: apply ' + (rmHierarchySyncApplyEnabledGs_() ? 'ON' : 'OFF') + '; has ever applied: ' + state.appliedEver + '; open items remembered: ' + Object.keys(state.items).length + '; last Monday reminder: ' + (state.lastReminderDay || 'never') + '.');
  Logger.log('Last run record: ' + JSON.stringify(readEmailJobRunGs_(RMSYNC_JOB_NAME_)));
}

function rmSyncStr_(v) { return (v === undefined || v === null) ? '' : String(v).trim(); }
function rmSyncUnique_(list) { return list.filter(function (v, i) { return list.indexOf(v) === i; }); }

// ==================== Near-name matching (old spellings of current staff) ====================
// The leads sheet and RM_Hierarchy still carry old spellings and labels of people who ARE in the HR sheet ("Atharva P Belose" for
// "Atharva Belose", "Sourabh Sareen Pnl", "Mamtaben S 1 Account"). Listed as "possible leavers" they drowned the real ones (9 of the first 19).
// A row that is not in the HR sheet by exact name is recognised as an old spelling when EXACTLY ONE current (not exited) HR person is a near match.
const RMSYNC_NOISE_TOKENS_ = ['pnl', 'account', 'acct'];

// Comparable tokens of a name: lower case, letters and digits only, no one-letter initials, no numbers, no label words.
function rmSyncNameTokensGs_(name) {
  return String(name || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().split(' ').filter(function (t) {
    return t.length > 1 && !/^\d+$/.test(t) && RMSYNC_NOISE_TOKENS_.indexOf(t) === -1;
  });
}

// Optimal-string-alignment distance: an insertion, deletion, substitution or swap of two neighbouring letters is one edit.
function rmSyncEditDistanceGs_(a, b) {
  const d = [];
  for (let i = 0; i <= a.length; i++) {
    d.push([]);
    for (let j = 0; j <= b.length; j++) d[i].push(i === 0 ? j : (j === 0 ? i : 0));
  }
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
    }
  }
  return d[a.length][b.length];
}

// Two name tokens are the same word spelled differently: short words must match exactly, longer ones may differ by 1 (5-6 letters) or 2 (7+).
function rmSyncTokenCloseGs_(a, b) {
  if (a === b) return true;
  const longest = Math.max(a.length, b.length);
  const allowed = longest < 5 ? 0 : (longest < 7 ? 1 : 2);
  return allowed > 0 && rmSyncEditDistanceGs_(a, b) <= allowed;
}

// Is `rowName` (a name in RM_Hierarchy that the HR sheet does not have) an old spelling of HR person `person`?
function rmSyncNearNameGs_(rowName, person) {
  const a = rmSyncNameTokensGs_(rowName);
  const b = rmSyncNameTokensGs_(person.rawName);
  if (!a.length || !b.length) return false;
  if (a.join(' ') === b.join(' ')) return true; // same name apart from initials, numbers and label words
  const small = a.length <= b.length ? a : b;
  const big = a.length <= b.length ? b : a;
  if (small.length >= 2 && big.length <= small.length + 2 && small.every(function (t) { return big.indexOf(t) !== -1; })) return true; // a dropped middle name
  if (a.length === b.length && a.length >= 2) return a.every(function (t, i) { return rmSyncTokenCloseGs_(t, b[i]); }); // spelling slips
  // "<First name> S 1 Account": a first name alone, accepted only for a label ending "account" (the caller requires it to be the one match).
  return /\baccount\s*$/i.test(String(rowName)) && a.length === 1 && b.length >= 2 && b[0] === a[0];
}

// ==================== Parsing ====================

// values: the HR sheet's rows (row 0 = header). Returns { problems, people, count }. `people` is keyed by normalised name; a person
// with several rows has their chain names unioned and their exit flags OR-ed (same as the Python scripts). Any `problems` means the
// layout is not what this file expects and nothing else should be trusted.
function parseHrRosterGs_(values) {
  const out = { problems: [], people: {}, count: 0 };
  if (!values || !values.length) { out.problems.push('the HR sheet is empty'); return out; }
  const header = values[0];
  Object.keys(RMSYNC_HR_HEADER_EXPECT_).forEach(function (idx) {
    const got = rmSyncStr_(header[Number(idx)]).replace(/\s+/g, ' ').toLowerCase();
    if (got !== RMSYNC_HR_HEADER_EXPECT_[idx]) out.problems.push('column ' + (Number(idx) + 1) + ' is headed "' + got + '" (expected "' + RMSYNC_HR_HEADER_EXPECT_[idx] + '")');
  });
  if (out.problems.length) return out;
  for (let r = 1; r < values.length; r++) {
    const row = values[r];
    const rawName = rmSyncStr_(row[RMSYNC_HR_COL_NAME_]);
    if (!rawName) continue;
    const exitCell = rmSyncStr_(row[RMSYNC_HR_COL_EXIT_]);
    const emailCell = rmSyncStr_(row[RMSYNC_HR_COL_EMAIL_]);
    const entry = {
      rawName: rawName,
      code: rmSyncStr_(row[RMSYNC_HR_COL_CODE_]),
      role: rmSyncStr_(row[RMSYNC_HR_COL_ROLE_]),
      team: rmSyncStr_(row[RMSYNC_HR_COL_TEAM_]),
      email: emailCell.indexOf('@') !== -1 ? emailCell : '', // the sheet writes "-" or "NA" for no address
      chainNames: RMSYNC_HR_CHAIN_COLS_.map(function (c) { return rmSyncStr_(row[c]); }).filter(function (v) { return v && v !== '-'; }),
      exited: exitCell !== '' && exitCell !== '-',
    };
    const key = normPersonName_(rawName);
    const prior = out.people[key];
    if (prior) {
      prior.chainNames = rmSyncUnique_(prior.chainNames.concat(entry.chainNames));
      prior.exited = prior.exited || entry.exited;
      if (!prior.email) prior.email = entry.email;
      if (!prior.code) prior.code = entry.code;
    } else {
      out.people[key] = entry;
    }
  }
  out.count = Object.keys(out.people).length;
  return out;
}

// The live RM_Hierarchy tab as row objects. `rowNumber` is the sheet row, kept so a write can re-check it is still the same person.
function readRmHierarchyRowsGs_(sheet) {
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];
  const out = [];
  sheet.getRange(2, 1, lastRow - 1, RMSYNC_TAB_HEADER_.length).getValues().forEach(function (r, i) {
    const name = rmSyncStr_(r[2]);
    if (!name) return;
    out.push({
      rowNumber: i + 2, team: rmSyncStr_(r[0]), role: rmSyncStr_(r[1]), name: name,
      tl: rmSyncStr_(r[3]), tm: rmSyncStr_(r[4]), rh: rmSyncStr_(r[5]), ch: rmSyncStr_(r[6]),
      excluded: r[7] === true || String(r[7]).toLowerCase() === 'true', note: rmSyncStr_(r[8]), email: rmSyncStr_(r[9]),
    });
  });
  return out;
}

function readManagerDirectoryRowsGs_(sheet) {
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];
  const out = [];
  sheet.getRange(2, 1, lastRow - 1, 6).getValues().forEach(function (r, i) {
    const name = rmSyncStr_(r[0]);
    if (!name) return;
    out.push({ rowNumber: i + 2, name: name, email: rmSyncStr_(r[3]) });
  });
  return out;
}

// ==================== The plan (pure) ====================

// A new person's manager chain, resolved the way test/refresh-rm-hierarchy.py does: each filled chain slot is looked up by THAT NAME's
// own role in the tab and placed in the field its role belongs to. HIGH only when every slot resolves, with no two names in one field.
function classifyRmSyncJoinerGs_(person, roleByKey) {
  if (!person.chainNames.length) {
    return { confidence: 'LOW', fields: {}, notes: 'every current-chain column is blank in the HR sheet (the P&L column is not a reliable signal), so the real manager needs a person to confirm' };
  }
  const fields = {};
  const notes = [];
  person.chainNames.forEach(function (name) {
    const mgrRole = roleByKey[normPersonName_(name)] || '';
    const field = RMSYNC_ROLE_TO_FIELD_[mgrRole];
    if (!field) { notes.push('"' + name + '" does not resolve to a known manager role (role=' + (mgrRole || 'not in RM_Hierarchy') + ')'); return; }
    if (fields[field] && normPersonName_(fields[field]) !== normPersonName_(name)) { notes.push('both "' + fields[field] + '" and "' + name + '" would be the ' + RMSYNC_FIELD_LABEL_[field]); return; }
    fields[field] = name;
  });
  return notes.length ? { confidence: 'LOW', fields: fields, notes: notes.join('; ') } : { confidence: 'HIGH', fields: fields, notes: '' };
}

// hr: parseHrRosterGs_'s result; rows: readRmHierarchyRowsGs_; directory: readManagerDirectoryRowsGs_ (or null when the tab is absent).
// Returns what the sync would do and what it only reports. Pure: reads and writes nothing.
// opts (2026-10-19): { pins: RMSYNC_PINNED_OVERRIDES_-shaped entries, pinsDone: { hash(pin id): day } }. Omitted = no pins.
function computeRmHierarchySyncPlanGs_(hr, rows, directory, opts) {
  const options = opts || {};
  const plan = { newJoiners: [], newJoinersLow: [], fixes: [], needsHuman: [], leavers: [], aliases: [], emailFills: [], emailChanges: [], directoryAdds: [], pinPending: [], pinResolved: [] };
  const people = hr.people;
  const hrList = Object.keys(people).map(function (k) { return people[k]; });
  const roleByKey = {};
  const nameByKey = {};
  rows.forEach(function (r) { const k = normPersonName_(r.name); roleByKey[k] = r.role.toLowerCase(); nameByKey[k] = r.name; });
  const canon = function (name) { return nameByKey[normPersonName_(name)] || name; };

  // Pinned, user-confirmed changes (2026-10-19, RULE-092): a pending manager pin protects its row from being "fixed" back to HR;
  // a confirmed leaver (pinned, or in RMSYNC_CONFIRMED_LEAVERS_) is never re-added, never written as anyone's manager, never a directory add.
  const pinInfo = rmSyncEvaluatePinsGs_(options.pins || [], options.pinsDone || {}, hr, rows);
  plan.pinPending = pinInfo.pending;
  plan.pinResolved = pinInfo.resolved;
  const leaverKeys = {};
  RMSYNC_CONFIRMED_LEAVERS_.concat(pinInfo.leaverNames).forEach(function (n) { leaverKeys[normPersonName_(n)] = true; });
  Object.keys(leaverKeys).forEach(function (k) { delete roleByKey[k]; });

  // Existing rows: possible leavers and stale manager fields.
  rows.forEach(function (row) {
    if (row.excluded) return; // a person hand-flagged Excluded is left entirely alone
    if (pinInfo.protectedKeys[normPersonName_(row.name)]) return; // a pending user-confirmed change: never reverted (reported in PENDING IN HR LIVE)
    const person = people[normPersonName_(row.name)];
    if (!person) {
      // Not in the HR sheet by exact name: an old spelling of ONE current person is not a leaver; zero, several or only-exited matches stay leavers.
      const near = hrList.filter(function (p) { return rmSyncNearNameGs_(row.name, p); });
      const current = near.filter(function (p) { return !p.exited; });
      if (current.length === 1) { plan.aliases.push({ name: row.name, role: row.role, team: row.team, matchedName: current[0].rawName, matchedCode: current[0].code }); return; }
      plan.leavers.push({ name: row.name, role: row.role, team: row.team, reason: 'not in the HR sheet', similar: near.slice(0, 3).map(function (p) { return p.rawName; }) });
      return;
    }
    if (person.exited) { plan.leavers.push({ name: row.name, role: row.role, team: row.team, reason: 'has an Exit date in the HR sheet' }); return; }
    const chainKeys = person.chainNames.map(normPersonName_);
    RMSYNC_FIELDS_.forEach(function (field) {
      const value = row[field];
      if (!value || chainKeys.indexOf(normPersonName_(value)) !== -1) return;
      const distinct = rmSyncUnique_(chainKeys);
      let newValue = '';
      let why = '';
      if (distinct.length !== 1) {
        why = distinct.length === 0 ? 'the HR sheet lists no current manager for them' : 'the HR sheet lists several current managers, so the tier cannot be told from the column';
      } else {
        const candidateRole = roleByKey[distinct[0]] || '';
        if (RMSYNC_ROLE_TO_FIELD_[candidateRole] === field) newValue = canon(person.chainNames[chainKeys.indexOf(distinct[0])]);
        else why = 'their one current manager is a ' + (candidateRole || 'person not in RM_Hierarchy') + ', which is not the ' + RMSYNC_FIELD_LABEL_[field] + ' tier';
      }
      if (newValue) {
        plan.fixes.push({ rowNumber: row.rowNumber, name: row.name, code: person.code, team: row.team, role: row.role, field: field, oldValue: value, newValue: newValue });
      } else {
        // Not safe to write on its own, but when the WHOLE chain resolves cleanly (every name has a known tier) the report suggests the value.
        const whole = classifyRmSyncJoinerGs_(person, roleByKey);
        const suggestion = whole.confidence === 'HIGH' && whole.fields[field] && normPersonName_(whole.fields[field]) !== normPersonName_(value) ? canon(whole.fields[field]) : '';
        plan.needsHuman.push({ name: row.name, code: person.code, team: row.team, role: row.role, field: field, oldValue: value, currentChain: person.chainNames.slice(), reason: why, suggestion: suggestion });
      }
    });
  });

  // New joiners: people in the HR sheet, in scope, with no row yet. Passes repeat so a joiner who reports to another joiner resolves.
  const rowKeys = {};
  rows.forEach(function (r) { rowKeys[normPersonName_(r.name)] = true; });
  let pending = Object.keys(people).sort().map(function (k) { return { key: k, person: people[k] }; }).filter(function (p) {
    const role = p.person.role.toLowerCase();
    return !rowKeys[p.key] && !leaverKeys[p.key] && !p.person.exited && RMSYNC_SALES_ROLES_.indexOf(role) !== -1 && RMSYNC_OUT_OF_SCOPE_TEAMS_.indexOf(p.person.team.toLowerCase()) === -1;
  });
  for (let pass = 0; pass < 4 && pending.length; pass++) {
    let progressed = false;
    pending = pending.filter(function (p) {
      const c = classifyRmSyncJoinerGs_(p.person, roleByKey);
      if (c.confidence !== 'HIGH') return true;
      plan.newJoiners.push({
        team: p.person.team, role: p.person.role, name: p.person.rawName, code: p.person.code,
        tl: c.fields.tl ? canon(c.fields.tl) : '', tm: c.fields.tm ? canon(c.fields.tm) : '',
        rh: c.fields.rh ? canon(c.fields.rh) : '', ch: c.fields.ch ? canon(c.fields.ch) : '',
        email: p.person.email.indexOf('@') !== -1 ? p.person.email : '',
      });
      roleByKey[p.key] = p.person.role.toLowerCase();
      nameByKey[p.key] = p.person.rawName;
      progressed = true;
      return false;
    });
    if (!progressed) break;
  }
  pending.forEach(function (p) {
    plan.newJoinersLow.push({ name: p.person.rawName, code: p.person.code, team: p.person.team, role: p.person.role, notes: classifyRmSyncJoinerGs_(p.person, roleByKey).notes });
  });

  // Manager_Directory: emails for managers, and a row for any manager the directory has never heard of.
  if (directory) {
    const fixesByRow = {};
    plan.fixes.forEach(function (f) { fixesByRow[f.rowNumber + '|' + f.field] = f.newValue; });
    const finalRows = rows.map(function (r) {
      const copy = Object.assign({}, r);
      RMSYNC_FIELDS_.forEach(function (f) { const v = fixesByRow[r.rowNumber + '|' + f]; if (v) copy[f] = v; });
      return copy;
    }).concat(plan.newJoiners.map(function (j) { return Object.assign({ excluded: false }, j); }));
    const managers = {};
    finalRows.forEach(function (r) {
      if (r.excluded) return;
      RMSYNC_FIELDS_.forEach(function (f) {
        const v = r[f];
        if (!v) return;
        const k = normPersonName_(v);
        if (leaverKeys[k]) return;
        const m = managers[k] || (managers[k] = { name: canon(v), roles: {}, regions: {}, count: 0 });
        m.roles[RMSYNC_FIELD_LABEL_[f]] = true;
        if (r.team) m.regions[r.team] = true;
        m.count++;
      });
    });
    const hrEmail = function (name) { const p = people[normPersonName_(name)]; return p && p.email.indexOf('@') !== -1 ? p.email : ''; };
    const dirKeys = {};
    directory.forEach(function (d) {
      dirKeys[normPersonName_(d.name)] = true;
      const email = hrEmail(d.name);
      if (!email) return;
      if (!d.email) plan.emailFills.push({ rowNumber: d.rowNumber, name: d.name, email: email });
      else if (d.email.toLowerCase() !== email.toLowerCase()) plan.emailChanges.push({ name: d.name, existing: d.email, hr: email });
    });
    Object.keys(managers).sort().forEach(function (k) {
      // Only managers who are in the HR sheet today: a name nobody has on file is most likely a departed manager (reported elsewhere).
      if (dirKeys[k] || !people[k]) return;
      const m = managers[k];
      plan.directoryAdds.push({ name: m.name, roles: Object.keys(m.roles).sort().join(', '), regions: Object.keys(m.regions).sort().join(', '), count: m.count, email: hrEmail(m.name) });
    });
  }
  return plan;
}

// ==================== State ("have I already told you about this?") ====================

function rmSyncHashGs_(s) {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0;
  return h.toString(16);
}
function readRmSyncStateGs_() {
  const blank = { items: {}, lastReminderDay: '', appliedEver: false, pinsDone: {} };
  try {
    const raw = PropertiesService.getScriptProperties().getProperty(RMSYNC_STATE_PROPERTY_);
    if (!raw) return blank;
    const parsed = JSON.parse(raw);
    return { items: parsed.items || {}, lastReminderDay: parsed.lastReminderDay || '', appliedEver: !!parsed.appliedEver, pinsDone: parsed.pinsDone || {} };
  } catch (e) {
    Logger.log('RM hierarchy sync: could not read its state (' + e + ') - treating every item as new.');
    return blank;
  }
}
function writeRmSyncStateGs_(state) {
  try {
    const json = JSON.stringify(state);
    if (json.length > RMSYNC_STATE_MAX_CHARS_) throw new Error('state is ' + json.length + ' characters, over the ' + RMSYNC_STATE_MAX_CHARS_ + ' limit');
    PropertiesService.getScriptProperties().setProperty(RMSYNC_STATE_PROPERTY_, json);
    return true;
  } catch (e) {
    Logger.log('RM hierarchy sync: could not save its state (' + e + ') - tomorrow every open item is reported again.');
    return false;
  }
}
function rmHierarchySyncApplyEnabledGs_() {
  try { return PropertiesService.getScriptProperties().getProperty(RMSYNC_APPLY_PROPERTY_) === 'true'; } catch (e) { return false; }
}
// True once the sync is allowed to write (or has ever written): from then on the LIVE tab, not RM_HIERARCHY_RAW_, is the source of
// truth, and rebuildRmHierarchy() refuses to run unless forced (it would silently undo the synced changes).
function rmHierarchySyncIsActiveGs_() {
  return rmHierarchySyncApplyEnabledGs_() || readRmSyncStateGs_().appliedEver;
}
function rmSyncIsMondayIstGs_(now) { return new Date(now.getTime() + 330 * 60000).getUTCDay() === 1; }

// ==================== Report ====================

function rmSyncLinesGs_(lines) {
  if (lines.length <= RMSYNC_LIST_LIMIT_) return lines;
  return lines.slice(0, RMSYNC_LIST_LIMIT_).concat(['  ... and ' + (lines.length - RMSYNC_LIST_LIMIT_) + ' more (run showRmHierarchySyncPlanNow in the editor for the full list)']);
}
function rmSyncWhoGs_(p) { return p.name + ' (' + [p.team, p.role, p.code].filter(Boolean).join(', ') + ')'; }

// The attention items — each has a stable id so a night only reports the NEW ones (the rest come back as a Monday reminder).
function rmSyncAttentionItemsGs_(plan) {
  const items = [];
  plan.needsHuman.forEach(function (n) {
    items.push({ kind: 'human', id: 'H|' + normPersonName_(n.name) + '|' + n.field + '|' + normPersonName_(n.oldValue), line: '  * ' + rmSyncWhoGs_(n) + ': ' + RMSYNC_FIELD_LABEL_[n.field] + ' is "' + n.oldValue + '", but the HR sheet now lists ' + (n.currentChain.length ? n.currentChain.map(function (c) { return '"' + c + '"'; }).join(', ') : 'nobody') + ' - not changed: ' + n.reason + (n.suggestion ? '. Suggested: "' + n.suggestion + '" (every name in their HR chain resolves to a known tier)' : '') });
  });
  plan.newJoinersLow.forEach(function (j) {
    items.push({ kind: 'joiner', id: 'J|' + normPersonName_(j.name), line: '  * ' + rmSyncWhoGs_(j) + ': new in the HR sheet, not added - ' + j.notes });
  });
  plan.leavers.forEach(function (l) {
    items.push({ kind: 'leaver', id: 'L|' + normPersonName_(l.name), line: '  * ' + rmSyncWhoGs_(l) + ': ' + l.reason + ' - kept in RM_Hierarchy until you say remove' + (l.similar && l.similar.length ? ' (similar name in the HR sheet: ' + l.similar.join(', ') + ')' : '') });
  });
  plan.aliases.forEach(function (a) {
    items.push({ kind: 'alias', id: 'A|' + normPersonName_(a.name) + '|' + normPersonName_(a.matchedName), line: '  * ' + rmSyncWhoGs_(a) + ': old spelling of ' + a.matchedName + (a.matchedCode ? ' (' + a.matchedCode + ')' : '') + ' - kept, not a leaver' });
  });
  plan.emailChanges.forEach(function (c) {
    items.push({ kind: 'email', id: 'E|' + normPersonName_(c.name) + '|' + c.hr.toLowerCase(), line: '  * ' + c.name + ': Manager_Directory has ' + c.existing + ', the HR sheet has ' + c.hr + ' - left as it is' });
  });
  return items;
}

function rmSyncChangeLinesGs_(plan) {
  const out = { joiners: [], fixes: [], directory: [] };
  plan.newJoiners.forEach(function (j) {
    const chain = RMSYNC_FIELDS_.filter(function (f) { return j[f]; }).map(function (f) { return RMSYNC_FIELD_LABEL_[f] + ' ' + j[f]; }).join(', ');
    out.joiners.push('  * ' + rmSyncWhoGs_(j) + ': ' + (chain || 'no manager above them'));
  });
  plan.fixes.forEach(function (f) {
    out.fixes.push('  * ' + rmSyncWhoGs_(f) + ': ' + RMSYNC_FIELD_LABEL_[f.field] + ' "' + f.oldValue + '" -> "' + f.newValue + '"');
  });
  plan.emailFills.forEach(function (e) { out.directory.push('  * Manager_Directory: email for ' + e.name + ' filled from the HR sheet'); });
  plan.directoryAdds.forEach(function (d) { out.directory.push('  * Manager_Directory: new row for ' + d.name + ' (' + d.roles + ', ' + d.regions + ')' + (d.email ? ', email from the HR sheet' : ', no email in the HR sheet')); });
  return out;
}

// info: { day, mode ('REPORT-ONLY' | 'APPLIED' | 'HELD'), peopleCount, rowCount, plan, newAttention, reminders, applyProblems, warnings, backupUrls }
function buildRmHierarchySyncReportGs_(info) {
  const plan = info.plan;
  const lines = info.changeLines;
  const changeCount = plan.newJoiners.length + plan.fixes.length;
  const dirCount = plan.emailFills.length + plan.directoryAdds.length;
  const body = [];
  body.push('RM hierarchy sync - ' + info.day + ' - ' + info.mode);
  body.push('HR sheet: ' + info.peopleCount + ' people read. RM_Hierarchy: ' + info.rowCount + ' rows.');
  if (info.mode === 'REPORT-ONLY') body.push('Nothing was changed: the sync is in report-only mode. Lines under "WOULD BE APPLIED" are what it would do once apply is switched on.');
  if (info.mode === 'HELD') body.push('HELD: ' + changeCount + ' change(s) are pending, more than the ' + RMSYNC_MAX_CHANGES_ + ' allowed in one night, so NOTHING was written. Check the lists below; if they are right, run syncRmHierarchyNightlyNow again after raising the limit with a person who maintains the script, or make the changes by hand.');
  body.push('');
  const verb = info.mode === 'APPLIED' ? 'APPLIED' : 'WOULD BE APPLIED';
  if (changeCount || dirCount) {
    body.push(verb + ':');
    if (lines.joiners.length) { body.push(' New people added to RM_Hierarchy (' + lines.joiners.length + '):'); body.push.apply(body, rmSyncLinesGs_(lines.joiners)); }
    if (lines.fixes.length) { body.push(' Manager changes (' + lines.fixes.length + '):'); body.push.apply(body, rmSyncLinesGs_(lines.fixes)); }
    if (lines.directory.length) { body.push(' Manager_Directory (' + lines.directory.length + '):'); body.push.apply(body, rmSyncLinesGs_(lines.directory)); }
    body.push('');
  }
  const section = function (title, kind) {
    const items = info.newAttention.filter(function (i) { return i.kind === kind; });
    if (!items.length) return;
    body.push(title + ' (' + items.length + ' new):');
    body.push.apply(body, rmSyncLinesGs_(items.map(function (i) { return i.line; })));
    body.push('');
  };
  section('NEEDS A PERSON - a manager field that no longer matches the HR sheet and could not be fixed safely', 'human');
  section('NEEDS A PERSON - new people the sync could not place safely', 'joiner');
  section('POSSIBLE LEAVERS - kept in RM_Hierarchy; tell Claude which to remove', 'leaver');
  section('OLD SPELLINGS OF CURRENT STAFF - recognised automatically, kept in RM_Hierarchy, nothing to do (check the match is right)', 'alias');
  section('MANAGER EMAIL DIFFERENCES', 'email');
  // Pinned user-confirmed changes (RULE-092): listed EVERY night while HR Live disagrees - never silenced by the "already reported" state.
  const pinPending = plan.pinPending || [];
  const pinResolved = plan.pinResolved || [];
  if (pinPending.length) {
    body.push('PENDING IN HR LIVE (user-confirmed changes not yet in the HR sheet - kept as ours, listed every night until HR Live matches) (' + pinPending.length + '):');
    body.push.apply(body, rmSyncLinesGs_(pinPending.map(function (p) { return p.line; })));
    body.push('');
  }
  if (pinResolved.length) {
    body.push('NOW MATCHES HR (user-confirmed changes HR Live has caught up with - listed this once; the entry can be deleted from RMSYNC_PINNED_OVERRIDES_) (' + pinResolved.length + '):');
    body.push.apply(body, rmSyncLinesGs_(pinResolved.map(function (p) { return p.line; })));
    body.push('');
  }
  if (info.reminders.length) {
    body.push('MONDAY REMINDER - still open from earlier nights (' + info.reminders.length + '):');
    body.push.apply(body, rmSyncLinesGs_(info.reminders.map(function (i) { return i.line; })));
    body.push('');
  }
  if (info.applyProblems.length) {
    body.push('PROBLEMS WHILE APPLYING (check RM_Hierarchy):');
    info.applyProblems.forEach(function (p) { body.push('  * ' + p); });
    body.push('');
  }
  if (info.warnings.length) {
    info.warnings.forEach(function (w) { body.push('Note: ' + w); });
    body.push('');
  }
  if (info.backupUrls.length) body.push('Backup of both tabs before this run: ' + info.backupUrls.join(' , '));
  const attention = info.newAttention.filter(function (i) { return i.kind !== 'alias'; }).length; // the old-spelling lines are information, not work
  const subject = 'RM hierarchy sync ' + info.day + ' - ' + info.mode + ': ' + changeCount + ' change(s)' + (attention ? ', ' + attention + ' for a person to look at' : '') +
    ((plan.pinPending || []).length ? ', ' + plan.pinPending.length + ' pending in HR Live' : '');
  return { subject: subject, body: body.join('\n') };
}

function rmSyncRecipientsGs_(hr) {
  if (TEST_MODE_OVERRIDE_EMAIL_) return { to: [TEST_MODE_OVERRIDE_EMAIL_], missing: [] };
  const to = [];
  const missing = [];
  RMSYNC_REPORT_NAMES_.forEach(function (name) {
    let email = resolvedEmailForNameGs_(name);
    if (!email && hr && hr.people[normPersonName_(name)]) {
      const hrEmail = hr.people[normPersonName_(name)].email;
      if (hrEmail.indexOf('@') !== -1) email = hrEmail.toLowerCase();
    }
    if (!email) { missing.push(name); return; }
    if (to.indexOf(email) === -1) to.push(email);
  });
  if (!to.length) { const ops = opsAlertEmailGs_(); if (ops) to.push(ops); }
  return { to: to, missing: missing };
}

// ==================== Applying ====================

function applyRmHierarchySyncPlanGs_(ss, sheet, rows, directorySheet, directory, plan, day) {
  const problems = [];
  const backupUrls = [];
  // No backup, no write.
  const backup = archiveRowsToDriveCsv_('RM_Hierarchy_sync_backup', RMSYNC_TAB_HEADER_, rows.map(function (r) {
    return [r.team, r.role, r.name, r.tl, r.tm, r.rh, r.ch, r.excluded, r.note, r.email];
  }), 'before_sync_' + day, { skipManifest: true });
  if (backup) backupUrls.push(backup.getUrl());
  if (directorySheet && directory && directory.length) {
    const dirBackup = archiveRowsToDriveCsv_('Manager_Directory_sync_backup', ['manager_name', 'roles', 'regions', 'email', 'people_reporting_up_to_them', 'email_source'],
      directorySheet.getRange(2, 1, directorySheet.getLastRow() - 1, 6).getValues(), 'before_sync_' + day, { skipManifest: true });
    if (dirBackup) backupUrls.push(dirBackup.getUrl());
  }

  // Manager changes — each cell is re-checked just before it is written (the tab may have been edited since it was read).
  plan.fixes.forEach(function (f) {
    const nameNow = rmSyncStr_(sheet.getRange(f.rowNumber, 3, 1, 1).getValue());
    const valueNow = rmSyncStr_(sheet.getRange(f.rowNumber, RMSYNC_FIELD_COL_[f.field], 1, 1).getValue());
    if (normPersonName_(nameNow) !== normPersonName_(f.name) || valueNow !== f.oldValue) {
      problems.push('skipped ' + f.name + ' ' + RMSYNC_FIELD_LABEL_[f.field] + ': row ' + f.rowNumber + ' changed since it was read');
      return;
    }
    withRetry_(function () { sheet.getRange(f.rowNumber, RMSYNC_FIELD_COL_[f.field], 1, 1).setValue(f.newValue); }, 'sync RM_Hierarchy ' + f.name + ' ' + f.field);
    const noteNow = rmSyncStr_(sheet.getRange(f.rowNumber, 9, 1, 1).getValue());
    const addition = 'sync ' + day + ': ' + f.field + ' ' + f.oldValue + ' -> ' + f.newValue;
    withRetry_(function () { sheet.getRange(f.rowNumber, 9, 1, 1).setValue(noteNow ? noteNow + ' | ' + addition : addition); }, 'sync RM_Hierarchy note for ' + f.name);
  });

  // New people go at the bottom, with the Excluded checkbox.
  if (plan.newJoiners.length) {
    const startRow = sheet.getLastRow() + 1;
    const data = plan.newJoiners.map(function (j) { return [j.team, j.role, j.name, j.tl, j.tm, j.rh, j.ch, false, 'added by the nightly sync ' + day, j.email]; });
    withRetry_(function () { sheet.getRange(startRow, 1, data.length, RMSYNC_TAB_HEADER_.length).setValues(data); }, 'sync RM_Hierarchy new people');
    withRetry_(function () { sheet.getRange(startRow, 8, data.length, 1).insertCheckboxes(); }, 'sync RM_Hierarchy checkboxes');
  }

  // Manager_Directory: fill blank emails, add missing managers.
  if (directorySheet) {
    plan.emailFills.forEach(function (e) {
      const nameNow = rmSyncStr_(directorySheet.getRange(e.rowNumber, 1, 1, 1).getValue());
      const emailNow = rmSyncStr_(directorySheet.getRange(e.rowNumber, 4, 1, 1).getValue());
      if (normPersonName_(nameNow) !== normPersonName_(e.name) || emailNow) { problems.push('skipped the email for ' + e.name + ': row ' + e.rowNumber + ' changed since it was read'); return; }
      withRetry_(function () { directorySheet.getRange(e.rowNumber, 4, 1, 1).setValue(e.email); directorySheet.getRange(e.rowNumber, 6, 1, 1).setValue('HR sheet sync'); }, 'sync Manager_Directory email for ' + e.name);
    });
    if (plan.directoryAdds.length) {
      const startRow = directorySheet.getLastRow() + 1;
      const data = plan.directoryAdds.map(function (d) { return [d.name, d.roles, d.regions, d.email, d.count, d.email ? 'HR sheet sync' : '']; });
      withRetry_(function () { directorySheet.getRange(startRow, 1, data.length, 6).setValues(data); }, 'sync Manager_Directory new managers');
    }
  }

  // Read back: every change must really be there.
  SpreadsheetApp.flush();
  const after = readRmHierarchyRowsGs_(sheet);
  const byKey = {};
  after.forEach(function (r) { byKey[normPersonName_(r.name)] = r; });
  plan.fixes.forEach(function (f) {
    const r = byKey[normPersonName_(f.name)];
    const skipped = problems.some(function (p) { return p.indexOf('skipped ' + f.name + ' ') === 0; });
    if (!skipped && (!r || r[f.field] !== f.newValue)) problems.push('read-back mismatch: ' + f.name + ' ' + RMSYNC_FIELD_LABEL_[f.field] + ' is not "' + f.newValue + '"');
  });
  plan.newJoiners.forEach(function (j) {
    if (!byKey[normPersonName_(j.name)]) problems.push('read-back mismatch: ' + j.name + ' is not in RM_Hierarchy');
  });
  return { problems: problems, backupUrls: backupUrls };
}

// ==================== The run ====================

function readHrRosterValuesGs_() {
  let hrSs;
  try {
    hrSs = SpreadsheetApp.openById(RMSYNC_HR_SHEET_ID_);
  } catch (e) {
    throw new Error('Cannot open the HR roster sheet (' + RMSYNC_HR_SHEET_ID_ + '): ' + e + '. The account that owns this Apps Script project needs access - set the sheet\'s link access to "Anyone in Homesfy" or share it with that account.');
  }
  const sheets = hrSs.getSheets();
  if (!sheets || !sheets.length) throw new Error('The HR roster sheet has no tabs.');
  const first = sheets[0];
  const lastRow = first.getLastRow();
  const lastCol = first.getLastColumn();
  return lastRow > 0 && lastCol > 0 ? first.getRange(1, 1, lastRow, lastCol).getValues() : [];
}

// opts.now (tests). Returns a summary; throws on anything that needs a human straight away (the job wrapper alerts ops).
function runRmHierarchySyncGs_(opts) {
  const options = opts || {};
  const now = options.now || new Date();
  const day = istDayKeyGs_(now);
  const testMode = !!TEST_MODE_OVERRIDE_EMAIL_;
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  const hr = parseHrRosterGs_(readHrRosterValuesGs_());
  if (hr.problems.length) throw new Error('The HR sheet is not laid out as expected, so nothing was changed: ' + hr.problems.join('; ') + '.');
  if (hr.count < RMSYNC_MIN_PEOPLE_) throw new Error('The HR sheet lists only ' + hr.count + ' people (at least ' + RMSYNC_MIN_PEOPLE_ + ' expected), so it looks like a broken read - nothing was changed.');

  const sheet = ss.getSheetByName(RM_HIERARCHY_SHEET_);
  if (!sheet) throw new Error('The RM_Hierarchy tab does not exist - run setupRmHierarchy first.');
  const tabHeader = sheet.getRange(1, 1, 1, RMSYNC_TAB_HEADER_.length).getValues()[0].map(function (v) { return rmSyncStr_(v).toLowerCase(); });
  if (tabHeader.join('|') !== RMSYNC_TAB_HEADER_.join('|')) throw new Error('RM_Hierarchy\'s header row is not "' + RMSYNC_TAB_HEADER_.join(', ') + '" (found "' + tabHeader.join(', ') + '"), so nothing was changed.');
  const rows = readRmHierarchyRowsGs_(sheet);
  const directorySheet = ss.getSheetByName(MANAGER_DIRECTORY_SHEET_);
  const directory = directorySheet ? readManagerDirectoryRowsGs_(directorySheet) : null;
  const warnings = [];
  if (!directorySheet) warnings.push('the Manager_Directory tab does not exist, so manager emails were not checked.');

  const state = readRmSyncStateGs_();
  const plan = computeRmHierarchySyncPlanGs_(hr, rows, directory, { pins: rmSyncPinnedOverridesGs_(), pinsDone: state.pinsDone });
  const changeCount = plan.newJoiners.length + plan.fixes.length;
  const held = changeCount > RMSYNC_MAX_CHANGES_;
  const applyOn = rmHierarchySyncApplyEnabledGs_() && !testMode;
  // Report-only already writes nothing, so HELD is only for a night that would really have written.
  const mode = !applyOn ? 'REPORT-ONLY' : (held ? 'HELD' : 'APPLIED');

  let applyResult = { problems: [], backupUrls: [] };
  if (applyOn && !held && (changeCount || plan.emailFills.length || plan.directoryAdds.length)) {
    applyResult = applyRmHierarchySyncPlanGs_(ss, sheet, rows, directorySheet, directory, plan, day);
  }

  // What is new tonight vs. still open from earlier nights.
  const attention = rmSyncAttentionItemsGs_(plan);
  const newAttention = [];
  const outstanding = [];
  attention.forEach(function (item) {
    if (state.items[rmSyncHashGs_(item.id)]) outstanding.push(item); else newAttention.push(item);
  });
  const nextItems = {};
  attention.forEach(function (item) { nextItems[rmSyncHashGs_(item.id)] = 1; }); // only "already told you" matters; anything no longer present is dropped
  const dueReminder = rmSyncIsMondayIstGs_(now) && state.lastReminderDay !== day && outstanding.length > 0;
  const reminders = dueReminder ? outstanding : [];

  const recipients = rmSyncRecipientsGs_(hr);
  if (recipients.missing.length) warnings.push('no email address found for ' + recipients.missing.join(', ') + ' - they did not get this report.');
  if (applyResult.problems.length || held || changeCount || plan.emailFills.length || plan.directoryAdds.length || newAttention.length || reminders.length || warnings.length || plan.pinPending.length || plan.pinResolved.length) {
    const report = buildRmHierarchySyncReportGs_({
      day: day, mode: mode, peopleCount: hr.count, rowCount: rows.length, plan: plan, changeLines: rmSyncChangeLinesGs_(plan),
      newAttention: newAttention, reminders: reminders, applyProblems: applyResult.problems, warnings: warnings, backupUrls: applyResult.backupUrls,
    });
    withRetry_(function () { GmailApp.sendEmail(recipients.to.join(','), report.subject, report.body); }, 'send the RM hierarchy sync report');
    if (applyResult.problems.length) {
      notifyOpsAlertGs_('RM hierarchy sync - problems while applying', ['The nightly sync applied changes but ' + applyResult.problems.length + ' problem(s) came up:'].concat(applyResult.problems));
    }
  }

  if (!testMode) {
    const pinsDone = Object.assign({}, state.pinsDone);
    plan.pinResolved.forEach(function (p) { pinsDone[rmSyncHashGs_(p.id)] = day; }); // reported once as matching; inert from now on
    const nextState = { items: nextItems, lastReminderDay: dueReminder ? day : state.lastReminderDay, appliedEver: state.appliedEver || (mode === 'APPLIED' && changeCount + plan.emailFills.length + plan.directoryAdds.length > 0), pinsDone: pinsDone };
    writeRmSyncStateGs_(nextState);
  }
  Logger.log('RM hierarchy sync ' + day + ' [' + mode + ']: ' + plan.newJoiners.length + ' new, ' + plan.fixes.length + ' manager change(s), ' + plan.emailFills.length + ' email fill(s), ' + plan.directoryAdds.length + ' directory add(s); ' + plan.aliases.length + ' old spelling(s) recognised; ' + plan.pinPending.length + ' pinned change(s) pending in HR Live, ' + plan.pinResolved.length + ' now matching; ' + newAttention.length + ' new item(s) listed, ' + outstanding.length + ' still open.');
  return { mode: mode, plan: plan, held: held, pinPending: plan.pinPending, pinResolved: plan.pinResolved, newAttention: newAttention, outstanding: outstanding, reminders: reminders, applyProblems: applyResult.problems, recipients: recipients.to };
}

// ==================== Removing confirmed leavers (2026-10-16) ====================
// The sync never removes anyone (see the header). When a person confirms that a listed "possible leaver" has left, the rows go in
// two places: RM_HIERARCHY_RAW_ (RmHierarchy.gs, by hand, so a rebuild cannot bring them back) and the LIVE tab, by running
// removeRmHierarchyLeaversNow() once. That function backs the tab up to Drive first (same folder as the sync's own backups), removes
// ONLY rows whose name matches one of the names below exactly (case and spaces ignored), and is safe to re-run (a second run finds
// nothing and writes nothing). Before removing anyone it checks the leads tab (read-only) for OPEN leads still assigned to that name:
// those leads would route to the region fallback once the row is gone, so that person is NOT removed and the lead ids are logged
// for reassignment - unless removeRmHierarchyLeaversForceNow() is run instead. Manager_Directory is only reported on, never changed.
// Edit this list (and RM_HIERARCHY_RAW_) the next time a person confirms leavers; the 2026-10-16 batch is below.
// 2026-10-19: Sanket Yadav (Thane TM; address bounced 2026-10-19) - run applyRmHierarchyReassignmentsNow first (his three S1s), then this.
// A confirmed leaver is also never re-added by the nightly sync as a "new joiner" while HR Live still lists them (RULE-092).
const RMSYNC_CONFIRMED_LEAVERS_ = ['Jitendra Phulwaria', 'Atharva Belose', 'Atharva P Belose', 'Sanket Yadav'];
const RMSYNC_LEAVER_LEAD_ID_LOG_LIMIT_ = 200;

// Open leads per normalised RM name, for the names given. All open leads count (not only Google ones): every open lead under a
// removed name loses its routing, and the person reassigning them needs the full list. Returns { found: bool, byName: { norm: [ids] } }.
function rmSyncOpenLeadsForNamesGs_(ss, names) {
  const wanted = {};
  names.forEach(function (n) { wanted[normPersonName_(n)] = []; });
  const src = ss.getSheetByName(resolveTabName_(ss));
  if (!src) return { found: false, byName: wanted };
  const lastRow = src.getLastRow();
  const lastCol = src.getLastColumn();
  if (lastRow < 3) return { found: true, byName: wanted };
  const colIndex = buildColIndex_(src.getRange(2, 1, 1, lastCol).getValues()[0]);
  src.getRange(3, 1, lastRow - 2, lastCol).getValues().forEach(function (row) {
    const key = normPersonName_(getVal_(row, colIndex, 'RM'));
    if (!key || !wanted.hasOwnProperty(key)) return;
    if (!isOpenLead_(String(getVal_(row, colIndex, 'current_stage') || '').trim(), getVal_(row, colIndex, 'closing_reason'), getVal_(row, colIndex, 'lead_closing_reason'))) return;
    const leadId = String(getVal_(row, colIndex, 'lead_id') || '').trim();
    wanted[key].push(leadId || '(no lead id)');
  });
  return { found: true, byName: wanted };
}

// opts: { force, now }. Returns { removed, blocked: [{ name, leadIds }], notFound, wouldRemove, backupUrl, directoryRows, managerRefs, testMode }.
// TEST MODE (TEST_MODE_OVERRIDE_EMAIL_ set) writes nothing: it only logs what it would remove.
function removeRmHierarchyLeaversGs_(names, opts) {
  const options = opts || {};
  const force = options.force === true;
  const testMode = !!TEST_MODE_OVERRIDE_EMAIL_;
  const day = istDayKeyGs_(options.now || new Date());
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const result = { removed: [], blocked: [], notFound: [], wouldRemove: [], backupUrl: '', directoryRows: [], managerRefs: [], testMode: testMode };
  const targets = {};
  names.forEach(function (n) { targets[normPersonName_(n)] = n; });

  const sheet = ss.getSheetByName(RM_HIERARCHY_SHEET_);
  if (!sheet) throw new Error('The RM_Hierarchy tab does not exist - nothing to remove.');
  const tabHeader = sheet.getRange(1, 1, 1, RMSYNC_TAB_HEADER_.length).getValues()[0].map(function (v) { return rmSyncStr_(v).toLowerCase(); });
  if (tabHeader.join('|') !== RMSYNC_TAB_HEADER_.join('|')) throw new Error('RM_Hierarchy\'s header row is not "' + RMSYNC_TAB_HEADER_.join(', ') + '", so nothing was removed.');
  const rows = readRmHierarchyRowsGs_(sheet);
  const matches = rows.filter(function (r) { return targets.hasOwnProperty(normPersonName_(r.name)); });
  const matchedKeys = rmSyncUnique_(matches.map(function (r) { return normPersonName_(r.name); }));
  Object.keys(targets).forEach(function (k) { if (matchedKeys.indexOf(k) === -1) result.notFound.push(targets[k]); });

  // Read-only reports: anyone still naming a leaver as a manager, and any Manager_Directory row for them.
  rows.forEach(function (r) {
    if (targets.hasOwnProperty(normPersonName_(r.name))) return;
    RMSYNC_FIELDS_.forEach(function (f) {
      if (r[f] && targets.hasOwnProperty(normPersonName_(r[f]))) result.managerRefs.push(r.name + ' has ' + RMSYNC_FIELD_LABEL_[f] + ' = ' + r[f]);
    });
  });
  const directorySheet = ss.getSheetByName(MANAGER_DIRECTORY_SHEET_);
  if (directorySheet) {
    readManagerDirectoryRowsGs_(directorySheet).forEach(function (d) {
      if (targets.hasOwnProperty(normPersonName_(d.name))) result.directoryRows.push(d.name + ' (row ' + d.rowNumber + ')');
    });
  }

  if (!matches.length) {
    Logger.log('Leaver removal: none of ' + names.join(', ') + ' is in RM_Hierarchy any more - nothing to do (already removed).');
    rmSyncLogLeaverSideNotesGs_(result);
    if (!testMode) rmSyncForgetLeaverItemsGs_(names);
    return result;
  }

  const leads = rmSyncOpenLeadsForNamesGs_(ss, matchedKeys);
  if (!leads.found && !force) throw new Error('The leads tab "' + resolveTabName_(ss) + '" was not found, so open leads could not be checked - nothing was removed. Run removeRmHierarchyLeaversForceNow() to remove anyway.');
  const removable = {};
  matchedKeys.forEach(function (k) {
    const ids = leads.byName[k] || [];
    const name = matches.filter(function (r) { return normPersonName_(r.name) === k; })[0].name;
    if (ids.length) {
      const shown = ids.slice(0, RMSYNC_LEAVER_LEAD_ID_LOG_LIMIT_);
      Logger.log('Leaver removal: ' + name + ' still has ' + ids.length + ' OPEN lead(s): ' + shown.join(', ') + (ids.length > shown.length ? ' (+' + (ids.length - shown.length) + ' more)' : '') +
        (force ? ' - removing anyway (forced); these leads route to the region fallback until reassigned.' : ' - NOT removed. Reassign these leads in the leads tab, then run removeRmHierarchyLeaversNow() again (or removeRmHierarchyLeaversForceNow() to remove anyway).'));
      if (!force) { result.blocked.push({ name: name, leadIds: ids }); return; }
    }
    removable[k] = true;
  });
  const toRemove = matches.filter(function (r) { return removable[normPersonName_(r.name)]; });
  result.wouldRemove = toRemove.map(function (r) { return r.name; });

  if (testMode) {
    Logger.log('Leaver removal [TEST MODE]: would remove ' + (result.wouldRemove.join(', ') || 'nobody') + ' - nothing was written.');
    rmSyncLogLeaverSideNotesGs_(result);
    return result;
  }
  if (toRemove.length) {
    // No backup, no write.
    const backup = archiveRowsToDriveCsv_('RM_Hierarchy_sync_backup', RMSYNC_TAB_HEADER_, rows.map(function (r) {
      return [r.team, r.role, r.name, r.tl, r.tm, r.rh, r.ch, r.excluded, r.note, r.email];
    }), 'before_leaver_removal_' + day, { skipManifest: true });
    if (!backup) throw new Error('The Drive backup of RM_Hierarchy could not be made, so nothing was removed.');
    result.backupUrl = backup.getUrl();
    // Bottom-up, so the row numbers still to delete stay valid; each row's name is re-checked just before it is deleted.
    toRemove.slice().sort(function (a, b) { return b.rowNumber - a.rowNumber; }).forEach(function (r) {
      const nameNow = rmSyncStr_(sheet.getRange(r.rowNumber, 3, 1, 1).getValue());
      if (normPersonName_(nameNow) !== normPersonName_(r.name)) {
        Logger.log('Leaver removal: skipped ' + r.name + ' - row ' + r.rowNumber + ' changed since it was read (now "' + nameNow + '"). Re-run to try again.');
        return;
      }
      withRetry_(function () { sheet.deleteRows(r.rowNumber, 1); }, 'remove leaver ' + r.name + ' from RM_Hierarchy');
      result.removed.push(r.name);
    });
    result.removed.reverse();
    Logger.log('Leaver removal: removed ' + result.removed.length + ' row(s) from RM_Hierarchy: ' + result.removed.join(', ') + '. Backup: ' + result.backupUrl);
  }
  rmSyncLogLeaverSideNotesGs_(result);
  rmSyncForgetLeaverItemsGs_(result.removed.concat(result.notFound));
  return result;
}

function rmSyncLogLeaverSideNotesGs_(result) {
  if (result.notFound.length) Logger.log('Leaver removal: not in RM_Hierarchy (already removed, or never there): ' + result.notFound.join(', ') + '.');
  if (result.managerRefs.length) Logger.log('Leaver removal: these rows still name a leaver as their manager (not changed - fix by hand): ' + result.managerRefs.join('; ') + '.');
  if (result.directoryRows.length) Logger.log('Leaver removal: Manager_Directory still has a row for ' + result.directoryRows.join(', ') + ' (not changed).');
}

// Drops the sync's remembered "already reported" entries for these people, so nothing about them lingers in its state.
function rmSyncForgetLeaverItemsGs_(names) {
  if (!names.length) return;
  const state = readRmSyncStateGs_();
  const keys = names.map(normPersonName_);
  let changed = false;
  keys.forEach(function (k) {
    const ids = ['L|' + k];
    keys.forEach(function (other) { if (other !== k) ids.push('A|' + k + '|' + other); });
    ids.forEach(function (id) {
      const h = rmSyncHashGs_(id);
      if (state.items[h]) { delete state.items[h]; changed = true; }
    });
  });
  if (changed) writeRmSyncStateGs_(state);
}

// Run once from the editor: removes RMSYNC_CONFIRMED_LEAVERS_ from the live RM_Hierarchy tab (backup first; refuses for anyone with open leads).
function removeRmHierarchyLeaversNow() { return removeRmHierarchyLeaversGs_(RMSYNC_CONFIRMED_LEAVERS_, {}); }
// Same, but removes a person even when open leads are still assigned to them (the lead ids are still logged).
function removeRmHierarchyLeaversForceNow() { return removeRmHierarchyLeaversGs_(RMSYNC_CONFIRMED_LEAVERS_, { force: true }); }

// ==================== Pinned, user-confirmed changes (2026-10-19) ====================
// A change a person has confirmed BEFORE the HR roster sheet shows it. The nightly sync compares RM_Hierarchy with HR Live, so
// without a pin it would "fix" such a row straight back to HR's old manager (apply mode) or nag about it as a mismatch. A pin:
//   * protects the row: while HR still disagrees, the sync makes no fix and raises no "needs a person" item for that person;
//   * is listed EVERY night under "PENDING IN HR LIVE" (HR's current value vs ours) - never silenced by the "already reported" state;
//   * once HR Live agrees, is reported ONCE as "now matches HR" (remembered in the sync state, pinsDone) and then goes inert
//     (no protection, no listing) - delete the entry at leisure.
// Manager pin: { name, set: { tl, tm, rh, ch } (exactly what the row should hold; '' = blank), was: [old manager names], since, why }.
//   HR "matches" when every non-blank value in `set` is in the person's current HR chain and none of `was` is.
//   applyRmHierarchyReassignmentsNow() writes `set` onto the live tab (backup first, idempotent).
// Leaver pin: { name, leaver: true, since, why } - also list the name in RMSYNC_CONFIRMED_LEAVERS_ (removal) and take it out of
//   RM_HIERARCHY_RAW_. Pending while HR Live still lists the person as current staff or as any current person's manager.
// Future cases: add an entry here (and, for a manager pin, the same values in RM_HIERARCHY_RAW_).
const RMSYNC_PINNED_OVERRIDES_ = [
  // 2026-10-19 (confirmed by the user): Thane TM Sanket Yadav left - his address bounced on 2026-10-19 (Email_Reroutes sends his mail to Bipin More).
  { name: 'Mohit Manwani', set: { tl: 'Ganesh Saroj', tm: '', rh: 'Swapnil Gowalkar', ch: 'Bipin More' }, was: ['Sanket Yadav'], since: '2026-10-19', why: 'TM Sanket Yadav left; reassigned to A1 Ganesh Saroj by the user' },
  { name: 'Riyan Jamadar', set: { tl: 'Mayuresh Jadhav', tm: '', rh: '', ch: 'Bipin More' }, was: ['Sanket Yadav'], since: '2026-10-19', why: 'TM Sanket Yadav left; reassigned to A1 Mayuresh Jadhav by the user' },
  { name: 'Tisha Valecha', set: { tl: 'Mayuresh Jadhav', tm: '', rh: '', ch: 'Bipin More' }, was: ['Sanket Yadav'], since: '2026-10-19', why: 'TM Sanket Yadav left; reassigned to A1 Mayuresh Jadhav by the user' },
  { name: 'Sanket Yadav', leaver: true, since: '2026-10-19', why: 'left - address bounced 2026-10-19' },
];
// Indirection so the tests can supply their own pins (the real ones name live people).
function rmSyncPinnedOverridesGs_() { return RMSYNC_PINNED_OVERRIDES_; }

function rmSyncPinIdGs_(pin) {
  if (pin.leaver) return 'P|' + normPersonName_(pin.name) + '|leaver';
  return 'P|' + normPersonName_(pin.name) + '|' + RMSYNC_FIELDS_.map(function (f) { return f + '=' + normPersonName_((pin.set || {})[f] || ''); }).join(',');
}
function rmSyncFieldsTextGs_(o) {
  const parts = RMSYNC_FIELDS_.filter(function (f) { return o && o[f]; }).map(function (f) { return RMSYNC_FIELD_LABEL_[f] + ' ' + o[f]; });
  return parts.length ? parts.join(', ') : 'no manager';
}

// Pure. Returns { pending: [{ id, name, line }], resolved: [{ id, name, line }], protectedKeys: { norm: true }, leaverNames: [] }.
// A pin whose id is in pinsDone was already reported as matching: it is inert (in neither list, protects nothing).
function rmSyncEvaluatePinsGs_(pins, pinsDone, hr, rows) {
  const out = { pending: [], resolved: [], protectedKeys: {}, leaverNames: [] };
  const people = hr.people;
  const rowsByKey = {};
  rows.forEach(function (r) { const k = normPersonName_(r.name); (rowsByKey[k] = rowsByKey[k] || []).push(r); });
  pins.forEach(function (pin) {
    const key = normPersonName_(pin.name);
    const id = rmSyncPinIdGs_(pin);
    if (pin.leaver) { out.leaverNames.push(pin.name); out.protectedKeys[key] = true; }
    if (pinsDone[rmSyncHashGs_(id)]) return;
    const person = people[key];
    const current = !!person && !person.exited;
    const tag = ' (user-confirmed ' + (pin.since || '?') + (pin.why ? ': ' + pin.why : '') + ')';
    if (pin.leaver) {
      const managerOf = Object.keys(people).filter(function (k) {
        const p = people[k];
        return !p.exited && k !== key && p.chainNames.map(normPersonName_).indexOf(key) !== -1;
      }).map(function (k) { return people[k].rawName; }).sort();
      const still = rowsByKey[key] ? ' - still in RM_Hierarchy: run removeRmHierarchyLeaversNow' : '';
      if (current || managerOf.length) {
        const hrSays = [];
        if (current) hrSays.push('current staff (' + [person.team, person.role, person.code].filter(Boolean).join(', ') + ')');
        if (managerOf.length) hrSays.push('the manager of ' + managerOf.length + ': ' + managerOf.join(', '));
        out.pending.push({ id: id, name: pin.name, line: '  * ' + pin.name + ': ours LEFT (removed, never re-added)' + tag + ' - HR Live still lists them as ' + hrSays.join(' and ') + still });
      } else {
        out.resolved.push({ id: id, name: pin.name, line: '  * ' + pin.name + ': HR Live no longer lists them as staff or as anyone\'s manager - now matches HR (left)' + still });
      }
      return;
    }
    const ours = rmSyncFieldsTextGs_(pin.set);
    const liveRows = rowsByKey[key] || [];
    let liveNote = '';
    if (!liveRows.length) liveNote = ' - NOTE: not in RM_Hierarchy';
    else if (liveRows.some(function (r) { return RMSYNC_FIELDS_.some(function (f) { return normPersonName_(r[f]) !== normPersonName_((pin.set || {})[f] || ''); }); })) {
      liveNote = ' - NOTE: the live RM_Hierarchy row still has ' + rmSyncFieldsTextGs_(liveRows[0]) + ': run applyRmHierarchyReassignmentsNow';
    }
    if (!current) {
      out.resolved.push({ id: id, name: pin.name, line: '  * ' + pin.name + ': ' + (person ? 'has an Exit date in' : 'is not in') + ' the HR sheet any more - pin no longer needed (ours: ' + ours + ')' });
      return;
    }
    const chainKeys = person.chainNames.map(normPersonName_);
    const wanted = RMSYNC_FIELDS_.map(function (f) { return (pin.set || {})[f] || ''; }).filter(Boolean);
    const matches = wanted.every(function (v) { return chainKeys.indexOf(normPersonName_(v)) !== -1; }) &&
      (pin.was || []).every(function (w) { return chainKeys.indexOf(normPersonName_(w)) === -1; });
    const hrText = person.chainNames.length ? person.chainNames.join(', ') : 'no manager';
    const who = pin.name + ' (' + [person.team, person.role].filter(Boolean).join(', ') + ')';
    if (matches) {
      out.resolved.push({ id: id, name: pin.name, line: '  * ' + who + ': HR Live now lists ' + hrText + ' - now matches HR (ours: ' + ours + ')' + liveNote });
      return;
    }
    out.protectedKeys[key] = true;
    out.pending.push({ id: id, name: pin.name, line: '  * ' + who + ': ours ' + ours + tag + ' - HR Live still lists ' + hrText + '. Kept as ours, not reverted' + liveNote });
  });
  return out;
}

// One-off, console-run (2026-10-19): writes each manager pin's tl/tm/rh/ch onto the live RM_Hierarchy tab. Backup to Drive first (no
// backup, no write); only rows whose name matches exactly (case/spaces ignored); a row already holding the values is left alone, so a
// re-run writes nothing. TEST MODE writes nothing. Manager_Directory is only reported on (a pinned manager with no row / no email).
// opts: { now }. Returns { changed, already, notFound, wouldChange, problems, backupUrl, directoryNotes, testMode }.
function applyRmHierarchyReassignmentsGs_(pins, opts) {
  const options = opts || {};
  const testMode = !!TEST_MODE_OVERRIDE_EMAIL_;
  const day = istDayKeyGs_(options.now || new Date());
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const result = { changed: [], already: [], notFound: [], wouldChange: [], problems: [], backupUrl: '', directoryNotes: [], testMode: testMode };
  const managerPins = pins.filter(function (p) { return !p.leaver && p.set; });
  const sheet = ss.getSheetByName(RM_HIERARCHY_SHEET_);
  if (!sheet) throw new Error('The RM_Hierarchy tab does not exist - nothing to change.');
  const tabHeader = sheet.getRange(1, 1, 1, RMSYNC_TAB_HEADER_.length).getValues()[0].map(function (v) { return rmSyncStr_(v).toLowerCase(); });
  if (tabHeader.join('|') !== RMSYNC_TAB_HEADER_.join('|')) throw new Error('RM_Hierarchy\'s header row is not "' + RMSYNC_TAB_HEADER_.join(', ') + '", so nothing was changed.');
  const rows = readRmHierarchyRowsGs_(sheet);
  const todo = [];
  managerPins.forEach(function (pin) {
    const key = normPersonName_(pin.name);
    const target = RMSYNC_FIELDS_.map(function (f) { return rmSyncStr_((pin.set || {})[f]); });
    const matches = rows.filter(function (r) { return normPersonName_(r.name) === key; });
    if (!matches.length) { result.notFound.push(pin.name); return; }
    matches.forEach(function (r) {
      const current = RMSYNC_FIELDS_.map(function (f) { return r[f]; });
      if (current.join('|') === target.join('|')) { result.already.push(r.name); return; }
      todo.push({ row: r, target: target, current: current });
    });
  });
  result.wouldChange = todo.map(function (t) { return t.row.name + ': ' + rmSyncFieldsTextGs_(t.row) + ' -> ' + rmSyncFieldsTextGs_({ tl: t.target[0], tm: t.target[1], rh: t.target[2], ch: t.target[3] }); });

  // Read-only: every pinned manager should have a Manager_Directory row with an email (only reported, never changed).
  const directorySheet = ss.getSheetByName(MANAGER_DIRECTORY_SHEET_);
  const dirByKey = {};
  if (directorySheet) readManagerDirectoryRowsGs_(directorySheet).forEach(function (d) { dirByKey[normPersonName_(d.name)] = d; });
  const seen = {};
  managerPins.forEach(function (pin) {
    RMSYNC_FIELDS_.forEach(function (f) {
      const v = rmSyncStr_((pin.set || {})[f]);
      const k = normPersonName_(v);
      if (!v || seen[k] || !directorySheet) return;
      seen[k] = true;
      if (!dirByKey[k]) result.directoryNotes.push(v + ' has no Manager_Directory row');
      else if (!dirByKey[k].email) result.directoryNotes.push(v + ' has a Manager_Directory row with no email');
    });
  });

  if (result.notFound.length) Logger.log('Reassignment: not in RM_Hierarchy (nothing changed for them): ' + result.notFound.join(', ') + '.');
  if (result.already.length) Logger.log('Reassignment: already as confirmed (nothing to do): ' + result.already.join(', ') + '.');
  if (result.directoryNotes.length) Logger.log('Reassignment: Manager_Directory (not changed): ' + result.directoryNotes.join('; ') + '.');
  if (!todo.length) { Logger.log('Reassignment: nothing to change.'); return result; }
  if (testMode) { Logger.log('Reassignment [TEST MODE]: would change ' + result.wouldChange.join('; ') + ' - nothing was written.'); return result; }

  // No backup, no write.
  const backup = archiveRowsToDriveCsv_('RM_Hierarchy_sync_backup', RMSYNC_TAB_HEADER_, rows.map(function (r) {
    return [r.team, r.role, r.name, r.tl, r.tm, r.rh, r.ch, r.excluded, r.note, r.email];
  }), 'before_reassignment_' + day, { skipManifest: true });
  if (!backup) throw new Error('The Drive backup of RM_Hierarchy could not be made, so nothing was changed.');
  result.backupUrl = backup.getUrl();
  todo.forEach(function (t) {
    const r = t.row;
    const nameNow = rmSyncStr_(sheet.getRange(r.rowNumber, 3, 1, 1).getValue());
    if (normPersonName_(nameNow) !== normPersonName_(r.name)) { result.problems.push('skipped ' + r.name + ': row ' + r.rowNumber + ' changed since it was read (now "' + nameNow + '") - re-run'); return; }
    withRetry_(function () { sheet.getRange(r.rowNumber, RMSYNC_FIELD_COL_.tl, 1, 4).setValues([t.target]); }, 'reassign ' + r.name + ' in RM_Hierarchy');
    const changes = RMSYNC_FIELDS_.map(function (f, i) {
      return t.current[i] === t.target[i] ? '' : f + ' ' + (t.current[i] || '(blank)') + ' -> ' + (t.target[i] || '(blank)');
    }).filter(Boolean).join(', ');
    const noteNow = rmSyncStr_(sheet.getRange(r.rowNumber, 9, 1, 1).getValue());
    const addition = 'reassigned ' + day + ' (user-confirmed): ' + changes;
    withRetry_(function () { sheet.getRange(r.rowNumber, 9, 1, 1).setValue(noteNow ? noteNow + ' | ' + addition : addition); }, 'reassignment note for ' + r.name);
    result.changed.push(r.name);
  });
  SpreadsheetApp.flush();
  const after = readRmHierarchyRowsGs_(sheet);
  todo.forEach(function (t) {
    if (result.changed.indexOf(t.row.name) === -1) return;
    const r = after.filter(function (a) { return a.rowNumber === t.row.rowNumber; })[0];
    if (!r || RMSYNC_FIELDS_.map(function (f) { return r[f]; }).join('|') !== t.target.join('|')) result.problems.push('read-back mismatch: ' + t.row.name + ' is not ' + t.target.join(' / '));
  });
  Logger.log('Reassignment: changed ' + result.changed.length + ' row(s): ' + result.wouldChange.join('; ') + '. Backup: ' + result.backupUrl + (result.problems.length ? '. PROBLEMS: ' + result.problems.join('; ') : ''));
  return result;
}

// Run once from the editor (2026-10-19): applies the manager pins above to the live tab. Run it BEFORE removeRmHierarchyLeaversNow.
function applyRmHierarchyReassignmentsNow() { return applyRmHierarchyReassignmentsGs_(rmSyncPinnedOverridesGs_(), {}); }

// ==================== Entry points ====================

// Trigger entry point (installed by setupRmHierarchySync). Same shape as the email jobs: the script-wide lock + run record
// (withEmailJobLockGs_, so the hourly watchdog sees it), a crash alerts ops and is re-thrown so Executions shows Failed.
function syncRmHierarchyNightly() {
  withEmailJobLockGs_(RMSYNC_JOB_NAME_, function () {
    try {
      runRmHierarchySyncGs_({});
    } catch (e) {
      notifyOpsAlertGs_('syncRmHierarchyNightly failed — RM_Hierarchy was NOT changed', [
        'The nightly RM hierarchy sync stopped before changing anything:',
        String(e && e.message ? e.message : e),
        '',
        'Nothing is wrong with tonight\'s emails: routing keeps using the RM_Hierarchy tab as it was. Fix the cause (access to the HR sheet, its column layout, the tab itself), then run syncRmHierarchyNightlyNow.',
      ]);
      throw e;
    }
  });
}
function syncRmHierarchyNightlyNow() { syncRmHierarchyNightly(); }

// One-time setup — ONE daily trigger near 23:15 IST (safe to re-run: removes its own earlier trigger first).
function setupRmHierarchySync() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'syncRmHierarchyNightly') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('syncRmHierarchyNightly')
    .timeBased()
    .atHour(RMSYNC_RUN_HOUR_)
    .nearMinute(RMSYNC_RUN_MINUTE_)
    .everyDays(1)
    .inTimezone('Asia/Kolkata')
    .create();
  Logger.log('RM hierarchy sync trigger installed - runs daily near ' + RMSYNC_RUN_HOUR_ + ':' + RMSYNC_RUN_MINUTE_ + ' IST. It is report-only until enableRmHierarchySyncApplyNow is run.');
}

function enableRmHierarchySyncApplyNow() {
  PropertiesService.getScriptProperties().setProperty(RMSYNC_APPLY_PROPERTY_, 'true');
  Logger.log('RM hierarchy sync: APPLY is ON - from the next run it writes the changes it is sure about (backing both tabs up to Drive first). rebuildRmHierarchy() now refuses to run unless forced.');
}
function disableRmHierarchySyncApplyNow() {
  PropertiesService.getScriptProperties().setProperty(RMSYNC_APPLY_PROPERTY_, 'false');
  Logger.log('RM hierarchy sync: APPLY is OFF - it only reports.');
}
