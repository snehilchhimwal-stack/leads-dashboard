#!/usr/bin/env node
/**
 * check-docs-coverage.js — CI-002 (To-Do Dashboard). Documentation
 * coverage check for docs/ (DOCUMENTATION_PROJECT_PLAN.md) — WARN-ONLY,
 * per CI-001's own design note: prints every production js/*.js and
 * production .gs file (Tests_*.gs excluded, matching DOC-007's own
 * exclusion decision) that has no matching docs/js-modules/ or
 * docs/gs-modules/ record yet, but ALWAYS exits 0. It never fails a
 * build at this phase, because docs/ does not exist yet at all (confirmed
 * live, 2026-09-09: only an unrelated Lead_Lifecycle_Tracking.pptx
 * currently sits under docs/). Graduates to a real hard-fail gate only
 * once CI-005 defines and confirms graduation criteria against
 * DOCUMENTATION_PROJECT_PLAN.md's own Phase 5 (DOC-039) verification —
 * not decided or implemented here.
 *
 * WHY THE FILE LISTS ARE READ LIVE, NOT HARDCODED: DOCUMENTATION_PROJECT_PLAN.md
 * itself already lists 11 production .gs files and 23 js/*.js files
 * (JS-001..023) — both counts are ALREADY stale as of the day this check
 * was written (13 .gs files, 24 js/*.js files really exist; OpsChecklistRunner.gs,
 * LeadFollowupsStaleness.gs, and rm-performance-worker.js were all added
 * after that plan was last touched). A hardcoded list here would silently
 * repeat that exact drift. Reading fs.readdirSync() directly is the only
 * source of truth that can't go stale on its own.
 *
 * .gs production files are found by SCANNING THE REPO ROOT directly
 * (every *.gs file, minus Tests_*.gs and RmHierarchy.private.gs) rather
 * than importing test/run-gs-tests.js's own PRODUCTION_FILES array —
 * deliberate: that array is itself a manually-maintained list (the exact
 * thing CHECKLIST-006, 2026-09-09, showed can drift when a new file is
 * forgotten there) and importing it would also mean requiring that
 * script's module-level side effects be tamed first. A live directory
 * scan can't drift from reality by construction — it always matches what
 * files genuinely exist as of THIS run, no separate list to keep in sync.
 *
 * MATCHING CONVENTION (CI-001): by filename SLUG, not a fixed ID number —
 * docs/js-modules/JS-001-core-foundation.md matches core-foundation.js
 * because its own filename ends in "-core-foundation.md", regardless of
 * whether Phase 2/3 ever actually assigns it the number 001. This is
 * deliberate: those ID numbers don't exist anywhere in code today (they
 * get assigned when DOCUMENTATION_PROJECT_PLAN.md's Phase 2/3 tasks
 * actually run, which hasn't happened yet), so a check keyed to a fixed
 * ID range would need updating the moment that numbering is ever revised
 * — a slug suffix match never does.
 */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

// ---- 1. Enumerate real production files, live from the filesystem ----
const jsDir = path.join(ROOT, 'js');
const jsFiles = fs.existsSync(jsDir)
  ? fs.readdirSync(jsDir).filter(f => f.endsWith('.js')).sort()
  : [];

// RmHierarchy.private.gs is gitignored (real employee data, never
// committed) — DOC-007 already documents its status explicitly as
// out of scope for the catalog. It won't exist at all in a real CI
// checkout (git never has it to check out), but excluded by exact name
// here too, defensively, for a local run on a machine that does have it.
const GS_EXCLUDE_EXACT_ = new Set(['RmHierarchy.private.gs']);
const gsFiles = fs.readdirSync(ROOT)
  .filter(f => f.endsWith('.gs'))
  .filter(f => !f.startsWith('Tests_'))
  .filter(f => !GS_EXCLUDE_EXACT_.has(f))
  .sort();

// ---- 2. Each production file's expected docs/ slug ----
function jsSlug(filename) { return filename.replace(/\.js$/, '').toLowerCase(); }
function gsSlug(filename) { return filename.replace(/\.gs$/, '').toLowerCase(); }

// ---- 3. Does a matching record exist under docs/<sub>/? ----
function listDocsDir(sub) {
  const dir = path.join(ROOT, 'docs', sub);
  if (!fs.existsSync(dir)) return null; // sub-folder doesn't exist yet at all
  return fs.readdirSync(dir).filter(f => f.endsWith('.md'));
}

function hasMatchingRecord(docFiles, slug) {
  if (!docFiles) return false;
  const suffix = '-' + slug + '.md';
  return docFiles.some(f => f.toLowerCase().endsWith(suffix));
}

const jsDocsFiles = listDocsDir('js-modules');
const gsDocsFiles = listDocsDir('gs-modules');

const jsResults = jsFiles.map(f => ({ file: f, covered: hasMatchingRecord(jsDocsFiles, jsSlug(f)) }));
const gsResults = gsFiles.map(f => ({ file: f, covered: hasMatchingRecord(gsDocsFiles, gsSlug(f)) }));

// ---- 4. Print a clear summary ----
function printSection(label, results) {
  const covered = results.filter(r => r.covered);
  const uncovered = results.filter(r => !r.covered);
  console.log(label + ': ' + covered.length + '/' + results.length + ' covered');
  if (uncovered.length) {
    console.log('  Missing a docs/ record for:');
    uncovered.forEach(r => console.log('    - ' + r.file));
  }
  return uncovered.length;
}

function main() {
  console.log('=========================================');
  console.log('Documentation coverage check (WARN-ONLY — see CI-001/CI-005, To-Do Dashboard)');
  console.log('=========================================');
  const jsMissing = printSection('js/*.js (' + jsFiles.length + ' files found)', jsResults);
  const gsMissing = printSection('.gs production, excluding Tests_*.gs (' + gsFiles.length + ' files found)', gsResults);
  console.log('=========================================');
  const totalMissing = jsMissing + gsMissing;
  if (totalMissing > 0) {
    console.log('RESULT: ' + totalMissing + ' file(s) have no matching docs/ record yet.');
    console.log('This is EXPECTED right now — docs/js-modules/ and docs/gs-modules/ do not exist yet');
    console.log('(DOCUMENTATION_PROJECT_PLAN.md Phase 3 has not run). WARN-ONLY: this does NOT fail the build.');
  } else {
    console.log('RESULT: full coverage — every production file has a matching docs/ record.');
  }
  console.log('=========================================');
  // ALWAYS exits 0 at this phase — see this file's own header comment
  // and CI-001's design note (To-Do Dashboard) for the graduation
  // criteria that would ever change this.
  process.exit(0);
}

main();
