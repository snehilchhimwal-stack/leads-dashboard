#!/usr/bin/env python3
"""check-gs-registration.py -- automates CLAUDE.md's "adding a new .gs
file needs THREE registrations, not one" rule. Real incident this rule
exists for (CHECKLIST-006, 2026-09-09): a new Tests_*.gs suite was added
to Tests_RunAll.gs's `suites` array but never added to
test/run-gs-tests.js's own PRODUCTION_FILES/TEST_FILES lists (Node has no
way to discover "every file pasted into the Apps Script project" the way
the real editor does) -- CI threw a ReferenceError because the suite
function was never loaded into the sandbox. Until now, catching that
required a human re-reading three separate places by eye; this script
does it in one run.

USAGE
    python3 test/check-gs-registration.py [--strict]

Exits 0 by default (advisory) and prints a report. --strict exits 1 on
any finding, for wiring into CI alongside check-catalog.py once this has
run clean for a while.

WHAT IT CHECKS (three registrations, cross-referenced both ways):
  1. Every .gs / Tests_*.gs file that actually exists on disk (repo root)
     is registered in test/run-gs-tests.js's PRODUCTION_FILES / TEST_FILES.
  2. Every entry in PRODUCTION_FILES / TEST_FILES corresponds to a real
     file on disk (catches a stale registration for a renamed/removed file).
  3. Every Tests_<X>.gs in TEST_FILES (other than the two infra files,
     Tests_Mocks.gs and Tests_RunAll.gs itself) has a matching X.gs in
     PRODUCTION_FILES, AND a matching run<X>Tests_ entry in
     Tests_RunAll.gs's own `suites` array -- the exact CHECKLIST-006 gap.

WHAT IT DOESN'T CHECK: whether the file has actually been pasted into the
live Apps Script editor (CLAUDE.md's other standing "no auto-deploy"
gotcha) -- nothing in this repo's checkout can see that; this script only
covers the two on-disk/in-repo registrations.

RmHierarchy.private.gs is deliberately excluded -- it's gitignored (real
employee data, CLAUDE.md's own documented exception), never in
test/run-gs-tests.js's lists, and CI never has it.
"""

import re
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
RUN_GS_TESTS_JS = REPO_ROOT / "test" / "run-gs-tests.js"
TESTS_RUNALL_GS = REPO_ROOT / "Tests_RunAll.gs"
STRICT = "--strict" in sys.argv

EXCLUDED_FROM_DISK_SCAN = {"RmHierarchy.private.gs"}
INFRA_TEST_FILES = {"Tests_Mocks.gs", "Tests_RunAll.gs"}


def extract_file_list(js_source, const_name):
    """Same technique run-gs-tests-headless.py already uses: regex-extract
    a `const NAME = [ '...', '...' ];` array literal, never retype it, so
    this script can't itself drift from the real CI list."""
    m = re.search(r"\bconst\s+" + re.escape(const_name) + r"\s*=\s*\[", js_source)
    if not m:
        sys.exit("Could not find `const %s = [` in %s -- has it been renamed?" % (const_name, RUN_GS_TESTS_JS))
    start = m.end()
    end = js_source.index("]", start)
    body = js_source[start:end]
    return [s for s in re.findall(r"'([^']+)'", body)]


def extract_suite_functions(gs_source):
    m = re.search(r"\bconst\s+suites\s*=\s*\[", gs_source)
    if not m:
        sys.exit("Could not find `const suites = [` in %s -- has it been renamed?" % TESTS_RUNALL_GS)
    start = m.end()
    end = gs_source.index("]", start)
    body = gs_source[start:end]
    return [s.strip() for s in body.split(",") if s.strip()]


def suite_fn_to_test_file(fn_name):
    m = re.match(r"^run(.+)Tests_$", fn_name)
    if not m:
        return None
    return "Tests_%s.gs" % m.group(1)


def test_file_to_production_file(test_file):
    m = re.match(r"^Tests_(.+)\.gs$", test_file)
    if not m:
        return None
    return "%s.gs" % m.group(1)


def test_file_to_suite_fn(test_file):
    m = re.match(r"^Tests_(.+)\.gs$", test_file)
    if not m:
        return None
    return "run%sTests_" % m.group(1)


def main():
    if not RUN_GS_TESTS_JS.is_file():
        sys.exit("Not found: %s" % RUN_GS_TESTS_JS)
    if not TESTS_RUNALL_GS.is_file():
        sys.exit("Not found: %s" % TESTS_RUNALL_GS)

    js_source = RUN_GS_TESTS_JS.read_text(encoding="utf-8")
    gs_source = TESTS_RUNALL_GS.read_text(encoding="utf-8")

    production_files = set(extract_file_list(js_source, "PRODUCTION_FILES"))
    test_files = set(extract_file_list(js_source, "TEST_FILES"))
    suite_fns = extract_suite_functions(gs_source)

    disk_gs_files = {
        p.name for p in REPO_ROOT.glob("*.gs")
        if p.name not in EXCLUDED_FROM_DISK_SCAN
    }
    disk_production = {f for f in disk_gs_files if not f.startswith("Tests_")}
    disk_test = {f for f in disk_gs_files if f.startswith("Tests_")}

    findings = []

    # 1. Disk -> registered
    for f in sorted(disk_production - production_files):
        findings.append("MISSING from PRODUCTION_FILES: %s exists on disk but isn't registered in %s" % (f, RUN_GS_TESTS_JS.name))
    for f in sorted(disk_test - test_files):
        findings.append("MISSING from TEST_FILES: %s exists on disk but isn't registered in %s" % (f, RUN_GS_TESTS_JS.name))

    # 2. Registered -> disk (stale entries)
    for f in sorted(production_files - disk_production):
        findings.append("STALE in PRODUCTION_FILES: %s is registered but no longer exists on disk" % f)
    for f in sorted(test_files - disk_test):
        findings.append("STALE in TEST_FILES: %s is registered but no longer exists on disk" % f)

    # 3. Tests_<X>.gs <-> X.gs <-> run<X>Tests_ (the CHECKLIST-006 gap,
    # checked in both directions)
    suite_fn_set = set(suite_fns)
    for tf in sorted(test_files - INFRA_TEST_FILES):
        prod = test_file_to_production_file(tf)
        if prod and prod not in production_files:
            findings.append("REGISTRATION GAP: %s is in TEST_FILES but its production file %s is not in PRODUCTION_FILES" % (tf, prod))
        expected_fn = test_file_to_suite_fn(tf)
        if expected_fn and expected_fn not in suite_fn_set:
            findings.append("REGISTRATION GAP: %s is in TEST_FILES but %s is not in Tests_RunAll.gs's suites array (the exact CHECKLIST-006 gap)" % (tf, expected_fn))

    for fn in suite_fns:
        tf = suite_fn_to_test_file(fn)
        if tf is None:
            findings.append("UNEXPECTED suite function name: %r doesn't match the run<X>Tests_ convention -- can't cross-check it" % fn)
            continue
        if tf not in test_files:
            findings.append("REGISTRATION GAP: %s is in Tests_RunAll.gs's suites array but %s is not in TEST_FILES" % (fn, tf))

    print("=" * 60)
    print("check-gs-registration.py -- the '3 registrations for a new .gs file' rule")
    print("=" * 60)
    print("Disk: %d production .gs, %d Tests_*.gs" % (len(disk_production), len(disk_test)))
    print("test/run-gs-tests.js: %d PRODUCTION_FILES, %d TEST_FILES" % (len(production_files), len(test_files)))
    print("Tests_RunAll.gs: %d suite functions" % len(suite_fns))
    print()

    if findings:
        print("FINDINGS -- %d:" % len(findings))
        for f in findings:
            print("  " + f)
    else:
        print("Clean -- every .gs/Tests_*.gs file on disk is registered in both places, and every")
        print("Tests_RunAll.gs suite has a matching production file and TEST_FILES entry.")
        print("(Remember: this only covers the two in-repo registrations -- pasting into the live")
        print("Apps Script editor is still a separate, manual step. See CLAUDE.md.)")

    print("=" * 60)

    if STRICT and findings:
        sys.exit(1)


if __name__ == "__main__":
    main()
