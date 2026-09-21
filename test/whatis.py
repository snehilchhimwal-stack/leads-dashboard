#!/usr/bin/env python3
"""whatis.py -- one-command version of docs/HOW_TO_FIND_DOCS_FOR_A_FEATURE.md's
step 1 ("if you only know the filename, grep it in docs/INDEX.md") plus
step 2 (follow Depends On one hop). That guide already documents the right
manual process; this just means a session doesn't have to remember to run
it by hand -- grep INDEX.md, open the record, read the relevant sections,
open each Depends-On record's own INDEX.md row -- before touching a file.

USAGE
    python3 test/whatis.py <filename-or-partial-name-or-component-id>

Examples:
    python3 test/whatis.py tab-oppmonitor.js
    python3 test/whatis.py RmHierarchy.gs
    python3 test/whatis.py JS-025
    python3 test/whatis.py opp monitor

Prints, for every docs/INDEX.md row whose Location or Name matches: the
component's header info, its record's Purpose, Important logic/business
rules, Cross-runtime duplication, and Handover relationship sections (the
two things docs/HOW_TO_FIND_DOCS_FOR_A_FEATURE.md itself says to check
before changing code), then a one-line summary of each Depends-On
component pulled straight from its own INDEX.md row (not a full second
record -- that's the next hop, open it yourself if you need it).

If nothing matches: says so plainly. A component genuinely might not have
a doc record yet (check-catalog.py's check B would already be failing CI
if a real file were missing one, so an unmatched query is usually either
a typo or a file that isn't a first-class catalog component, e.g. a test
harness or a tooling script under test/ itself).
"""

import re
import sys
from pathlib import Path

# Doc records carry real em-dashes/arrows (-- see this project's own prose
# style); Windows' default console codepage (cp1252) can't encode them.
# Force UTF-8 on stdout with a safe fallback rather than crashing mid-report.
try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except AttributeError:
    pass

REPO_ROOT = Path(__file__).resolve().parent.parent
INDEX_MD = REPO_ROOT / "docs" / "INDEX.md"
COMPONENT_DIRS = ["dashboards", "data-flows", "gs-modules", "integrations", "js-modules", "sheets", "tabs"]

SECTIONS_TO_SHOW = [
    "Purpose / reason to exist",
    "Important logic / business rules",
    "Cross-runtime duplication",
    "Handover relationship",
]


def build_id_to_path():
    mapping = {}
    for d in COMPONENT_DIRS:
        dir_path = REPO_ROOT / "docs" / d
        if not dir_path.is_dir():
            continue
        for f in dir_path.glob("*.md"):
            m = re.match(r"^([A-Z]+-\d+)-", f.name)
            if m:
                mapping[m.group(1)] = f
    return mapping


def parse_index_rows(index_text):
    """Every `| ID | Type | Name | Location | Status | Depends On | Used By |
    Last Verified |` row across every per-type table in INDEX.md."""
    rows = []
    for line in index_text.splitlines():
        m = re.match(r"^\|\s*([A-Z]+-\d+)\s*\|(.*)\|\s*$", line)
        if not m:
            continue
        cid = m.group(1)
        cells = [c.strip() for c in m.group(2).split("|")]
        if len(cells) < 6:
            continue
        rows.append({
            "id": cid,
            "type": cells[0],
            "name": cells[1],
            "location": cells[2],
            "status": cells[3],
            "depends_on": cells[4],
            "used_by": cells[5],
        })
    return rows


def extract_section(record_text, heading):
    m = re.search(r"^## " + re.escape(heading) + r"\s*$", record_text, re.MULTILINE)
    if not m:
        return None
    start = m.end()
    nxt = re.search(r"^## ", record_text[start:], re.MULTILINE)
    end = start + nxt.start() if nxt else len(record_text)
    return record_text[start:end].strip()


def find_matches(rows, query):
    q = query.strip()
    q_id = q.upper()
    id_matches = [r for r in rows if r["id"] == q_id]
    if id_matches:
        return id_matches
    q_lower = q.lower()
    return [r for r in rows if q_lower in r["location"].lower() or q_lower in r["name"].lower()]


def print_record(row, id_to_path, rows_by_id):
    print("=" * 60)
    print("%s -- %s (%s)" % (row["id"], row["name"], row["type"]))
    print("=" * 60)
    print("Location: %s" % row["location"])
    print("Status:   %s" % row["status"])
    print()

    record_path = id_to_path.get(row["id"])
    if not record_path:
        print("(No record file found under docs/ for this ID -- INDEX.md row exists but the file is missing. This is exactly what check-catalog.py check B should already be catching in CI.)")
        return
    print("Record: %s" % record_path.relative_to(REPO_ROOT))
    print()

    record_text = record_path.read_text(encoding="utf-8")
    for heading in SECTIONS_TO_SHOW:
        content = extract_section(record_text, heading)
        if content:
            print("--- %s ---" % heading)
            print(content)
            print()

    depends_on_ids = [m.group(0) for m in re.finditer(r"\b[A-Z]+-\d+\b", row["depends_on"])]
    if depends_on_ids:
        print("--- Depends On (one hop, from INDEX.md -- open the record for more) ---")
        for did in depends_on_ids:
            dep_row = rows_by_id.get(did)
            if dep_row:
                print("  %s -- %s (%s)" % (did, dep_row["name"], dep_row["location"]))
            else:
                print("  %s -- (not found in INDEX.md)" % did)
        print()


def main():
    if len(sys.argv) < 2:
        sys.exit("Usage: python3 %s <filename-or-partial-name-or-component-id>" % sys.argv[0])
    query = " ".join(sys.argv[1:])

    if not INDEX_MD.is_file():
        sys.exit("Not found: %s" % INDEX_MD)
    index_text = INDEX_MD.read_text(encoding="utf-8")
    rows = parse_index_rows(index_text)
    rows_by_id = {r["id"]: r for r in rows}
    id_to_path = build_id_to_path()

    matches = find_matches(rows, query)
    if not matches:
        print("No docs/INDEX.md row matches %r (checked Location and Name columns)." % query)
        print("If this is a real production file, check-catalog.py's check B should be")
        print("failing CI already -- otherwise it may not be a first-class catalog")
        print("component (a test harness, a tooling script, a config file).")
        return

    for row in matches:
        print_record(row, id_to_path, rows_by_id)


if __name__ == "__main__":
    main()
