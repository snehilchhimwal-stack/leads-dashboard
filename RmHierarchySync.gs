/**
 * RM Hierarchy Nightly Sync (2026-10-08) — compares the company HR roster sheet with the live RM_Hierarchy and
 * Manager_Directory tabs every night, applies the changes that are unambiguous, and emails a short report of everything else.
 * It replaces the manual routine of exporting "HR Live", running test/refresh-rm-hierarchy.py, pasting RmHierarchy.gs and running
 * rebuildRmHierarchy(). Plan and rules: docs/_planning/RM_HIERARCHY_NIGHTLY_SYNC.md.
 *
 * WHAT IT NEVER DOES: remove a person. Someone who disappears from the HR sheet (or gets an Exit date) is only REPORTED — the row
 * stays in RM_Hierarchy until a human says remove. It never touches the Excluded / Note cells' existing text (a note is only
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
  const plan = computeRmHierarchySyncPlanGs_(hr, readRmHierarchyRowsGs_(sheet), directorySheet ? readManagerDirectoryRowsGs_(directorySheet) : null);
  const lines = rmSyncChangeLinesGs_(plan);
  Logger.log('Mode: ' + (rmHierarchySyncApplyEnabledGs_() ? 'APPLY' : 'report-only') + '. HR people: ' + hr.count + '.');
  [['New people', lines.joiners], ['Manager changes', lines.fixes], ['Manager_Directory', lines.directory]].forEach(function (s) {
    Logger.log(s[0] + ' (' + s[1].length + '):'); s[1].forEach(function (l) { Logger.log(l); });
  });
  const attention = rmSyncAttentionItemsGs_(plan);
  Logger.log('For a person (' + attention.length + '):');
  attention.forEach(function (i) { Logger.log(i.line); });
}

function showRmHierarchySyncStatusNow() {
  const state = readRmSyncStateGs_();
  Logger.log('RM hierarchy sync: apply ' + (rmHierarchySyncApplyEnabledGs_() ? 'ON' : 'OFF') + '; has ever applied: ' + state.appliedEver + '; open items remembered: ' + Object.keys(state.items).length + '; last Monday reminder: ' + (state.lastReminderDay || 'never') + '.');
  Logger.log('Last run record: ' + JSON.stringify(readEmailJobRunGs_(RMSYNC_JOB_NAME_)));
}

function rmSyncStr_(v) { return (v === undefined || v === null) ? '' : String(v).trim(); }
function rmSyncUnique_(list) { return list.filter(function (v, i) { return list.indexOf(v) === i; }); }

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
function computeRmHierarchySyncPlanGs_(hr, rows, directory) {
  const plan = { newJoiners: [], newJoinersLow: [], fixes: [], needsHuman: [], leavers: [], emailFills: [], emailChanges: [], directoryAdds: [] };
  const people = hr.people;
  const roleByKey = {};
  const nameByKey = {};
  rows.forEach(function (r) { const k = normPersonName_(r.name); roleByKey[k] = r.role.toLowerCase(); nameByKey[k] = r.name; });
  const canon = function (name) { return nameByKey[normPersonName_(name)] || name; };

  // Existing rows: possible leavers and stale manager fields.
  rows.forEach(function (row) {
    if (row.excluded) return; // a person hand-flagged Excluded is left entirely alone
    const person = people[normPersonName_(row.name)];
    if (!person) { plan.leavers.push({ name: row.name, role: row.role, team: row.team, reason: 'not in the HR sheet' }); return; }
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
        plan.fixes.push({ rowNumber: row.rowNumber, name: row.name, team: row.team, role: row.role, field: field, oldValue: value, newValue: newValue });
      } else {
        // Not safe to write on its own, but when the WHOLE chain resolves cleanly (every name has a known tier) the report suggests the value.
        const whole = classifyRmSyncJoinerGs_(person, roleByKey);
        const suggestion = whole.confidence === 'HIGH' && whole.fields[field] && normPersonName_(whole.fields[field]) !== normPersonName_(value) ? canon(whole.fields[field]) : '';
        plan.needsHuman.push({ name: row.name, team: row.team, role: row.role, field: field, oldValue: value, currentChain: person.chainNames.slice(), reason: why, suggestion: suggestion });
      }
    });
  });

  // New joiners: people in the HR sheet, in scope, with no row yet. Passes repeat so a joiner who reports to another joiner resolves.
  const rowKeys = {};
  rows.forEach(function (r) { rowKeys[normPersonName_(r.name)] = true; });
  let pending = Object.keys(people).sort().map(function (k) { return { key: k, person: people[k] }; }).filter(function (p) {
    const role = p.person.role.toLowerCase();
    return !rowKeys[p.key] && !p.person.exited && RMSYNC_SALES_ROLES_.indexOf(role) !== -1 && RMSYNC_OUT_OF_SCOPE_TEAMS_.indexOf(p.person.team.toLowerCase()) === -1;
  });
  for (let pass = 0; pass < 4 && pending.length; pass++) {
    let progressed = false;
    pending = pending.filter(function (p) {
      const c = classifyRmSyncJoinerGs_(p.person, roleByKey);
      if (c.confidence !== 'HIGH') return true;
      plan.newJoiners.push({
        team: p.person.team, role: p.person.role, name: p.person.rawName,
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
    plan.newJoinersLow.push({ name: p.person.rawName, team: p.person.team, role: p.person.role, notes: classifyRmSyncJoinerGs_(p.person, roleByKey).notes });
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
  const blank = { items: {}, lastReminderDay: '', appliedEver: false };
  try {
    const raw = PropertiesService.getScriptProperties().getProperty(RMSYNC_STATE_PROPERTY_);
    if (!raw) return blank;
    const parsed = JSON.parse(raw);
    return { items: parsed.items || {}, lastReminderDay: parsed.lastReminderDay || '', appliedEver: !!parsed.appliedEver };
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
function rmSyncWhoGs_(p) { return p.name + ' (' + [p.team, p.role].filter(Boolean).join(', ') + ')'; }

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
    items.push({ kind: 'leaver', id: 'L|' + normPersonName_(l.name), line: '  * ' + rmSyncWhoGs_(l) + ': ' + l.reason + ' - kept in RM_Hierarchy until you say remove' });
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
  section('MANAGER EMAIL DIFFERENCES', 'email');
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
  const attention = info.newAttention.length;
  const subject = 'RM hierarchy sync ' + info.day + ' - ' + info.mode + ': ' + changeCount + ' change(s)' + (attention ? ', ' + attention + ' for a person to look at' : '');
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

  const plan = computeRmHierarchySyncPlanGs_(hr, rows, directory);
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
  const state = readRmSyncStateGs_();
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
  if (applyResult.problems.length || held || changeCount || plan.emailFills.length || plan.directoryAdds.length || newAttention.length || reminders.length || warnings.length) {
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
    const nextState = { items: nextItems, lastReminderDay: dueReminder ? day : state.lastReminderDay, appliedEver: state.appliedEver || (mode === 'APPLIED' && changeCount + plan.emailFills.length + plan.directoryAdds.length > 0) };
    writeRmSyncStateGs_(nextState);
  }
  Logger.log('RM hierarchy sync ' + day + ' [' + mode + ']: ' + plan.newJoiners.length + ' new, ' + plan.fixes.length + ' manager change(s), ' + plan.emailFills.length + ' email fill(s), ' + plan.directoryAdds.length + ' directory add(s); ' + newAttention.length + ' new item(s) for a person, ' + outstanding.length + ' still open.');
  return { mode: mode, plan: plan, held: held, newAttention: newAttention, outstanding: outstanding, reminders: reminders, applyProblems: applyResult.problems, recipients: recipients.to };
}

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
