#!/usr/bin/env python3
"""check-rm-hierarchy-drift.py -- catches the exact bug class that let
Zeya Shaikh/Karan Shinde/Mayuresh Chavan's `tl` keep pointing at Mukesh
Yadav for ~3 months after they were reassigned to Kumar Babu (confirmed
2026-09-21): a name that still RESOLVES fine (so auditUnresolvedRmsNow()
in RmHierarchy.gs never flags it -- that only catches names that don't
resolve at all), but is simply the WRONG, stale manager once the person's
real chain has moved on. RM_HIERARCHY_RAW_ has no expiry on its own values
and nothing in this codebase re-derives it automatically (regenerating it
from a fresh export is a manual, occasional process -- see RmHierarchy.gs's
own header docblock) -- this script is the missing "did anything drift
since the source export changed" check for that manual process.

USAGE
    python3 test/check-rm-hierarchy-drift.py <path-to-fresh-HR-export.csv>

Run this by hand whenever you get a fresh "HR Live" export (same shape
this project already regenerates RM_HIERARCHY_RAW_ from), BEFORE making
any manual hierarchy edits -- it tells you exactly which existing rows
have drifted, so a fix is a lookup instead of a line-by-line audit.

Not run in CI: the HR export is an out-of-band file supplied by the user
(it contains real employee data and is never committed to this repo, same
reasoning as RmHierarchy.private.gs itself -- see .gitignore), so there is
nothing for a CI job to check against.

WHAT IT CHECKS AND WHY THE APPROACH IS DELIBERATELY LOOSE
RmHierarchy.gs's own header docblock explains that the HR export's raw
columns are POSITIONAL, not per-role -- the same "A1 - 1/S2" column holds
an S1's direct A1 for one person and effectively an RH-tier name for
another, depending on how many hops THAT PERSON's own chain has. Building
RM_HIERARCHY_RAW_ from a fresh export means resolving each filled slot
against the person's own role, which this script does not attempt to
replicate (that is real judgment, done by a human/Claude session, not a
mechanical column-to-field mapping). Instead, for each person this script
collects every "current manager" name appearing ANYWHERE among their own
row's 4 current chain-slot columns (A1-1/S2, A1-2, RH, CH/CL) into one set,
and flags a RM_HIERARCHY_RAW_ value (tl/tm/rh/ch) as drifted only when it
is non-blank AND absent from that whole set -- not tied to one column
position. That is intentionally loose: it will not tell you WHICH tier a
new manager belongs in, only THAT something in RM_HIERARCHY_RAW_ no longer
matches anything in the person's current chain. Treat a flagged row as a
lead to investigate (cross-check the person's row in the export by eye),
not as a ready-to-apply diff.

Two other things it reports, same "flag for a human" spirit:
  - a RM_HIERARCHY_RAW_ name not found anywhere in the export at all --
    likely departed (like Mukesh Yadav), possibly a deliberate leads-sheet
    alias row (check the inline comment above it in RmHierarchy.gs first),
    or an export-side spelling drift.
  - an export row whose own Exit column is filled in (not "-") but whose
    name still has a RM_HIERARCHY_RAW_ row -- a confirmed departure this
    file hasn't caught up to yet.
"""

import csv
import re
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
RMHIER_GS = REPO_ROOT / "RmHierarchy.gs"

# Current-chain-name column indices in the HR Live export, 0-indexed --
# verified directly against a real row (Zeya Shaikh, 2026-09-21 export):
# idx1=Name, idx6=A1-1/S2 (current), idx8=A1-2 (current),
# idx10=RH (current), idx12=CH/CL (current), idx17=Exit.
# The export also repeats RH/Team/P&L/A1-2/Role as OLD columns later in
# the row (idx26-31ish) -- those are deliberately NOT read here, only the
# current-tier columns feed the drift check.
COL_NAME = 1
COL_EXIT = 17
CURRENT_CHAIN_COLS = (6, 8, 10, 12)


def normalize(name):
    return re.sub(r"\s+", " ", (name or "").strip().lower())


def parse_rm_hierarchy_raw(gs_text):
    m = re.search(r"RM_HIERARCHY_RAW_\s*=\s*\[", gs_text)
    if not m:
        sys.exit("Could not find RM_HIERARCHY_RAW_ = [ in RmHierarchy.gs -- has it been renamed?")
    start = m.end()
    depth = 1
    i = start
    while depth > 0:
        if gs_text[i] == "[":
            depth += 1
        elif gs_text[i] == "]":
            depth -= 1
        i += 1
    body = gs_text[start:i]

    row_re = re.compile(
        r"\[\s*'([^']*)'\s*,\s*'([^']*)'\s*,\s*'([^']*)'\s*,"
        r"\s*'([^']*)'\s*,\s*'([^']*)'\s*,\s*'([^']*)'\s*,\s*'([^']*)'\s*\]"
    )
    rows = []
    for line_no, line in enumerate(body.splitlines(), start=1):
        for row_m in row_re.finditer(line):
            team, role, name, tl, tm, rh, ch = row_m.groups()
            rows.append({
                "team": team, "role": role, "name": name,
                "tl": tl, "tm": tm, "rh": rh, "ch": ch,
                "line_in_array": line_no,
            })
    return rows


def parse_hr_export(csv_path):
    by_name = {}
    with open(csv_path, newline="", encoding="utf-8-sig") as f:
        reader = csv.reader(f)
        next(reader, None)  # header
        for row in reader:
            if len(row) <= max(COL_EXIT, *CURRENT_CHAIN_COLS):
                continue
            raw_name = row[COL_NAME].strip()
            if not raw_name:
                continue
            key = normalize(raw_name)
            current_managers = {
                normalize(row[c]) for c in CURRENT_CHAIN_COLS
                if row[c].strip() and row[c].strip() != "-"
            }
            exited = row[COL_EXIT].strip() not in ("", "-")
            # A person can legitimately have more than one row across a
            # promotion/team-change history export; union the chain sets
            # and OR the exit flags rather than overwrite silently.
            existing = by_name.get(key)
            if existing:
                existing["current_managers"] |= current_managers
                existing["exited"] = existing["exited"] or exited
            else:
                by_name[key] = {
                    "raw_name": raw_name,
                    "current_managers": current_managers,
                    "exited": exited,
                }
    return by_name


def main():
    if len(sys.argv) != 2:
        sys.exit(f"Usage: python3 {sys.argv[0]} <path-to-HR-export.csv>")
    csv_path = Path(sys.argv[1])
    if not csv_path.is_file():
        sys.exit(f"Not a file: {csv_path}")

    gs_text = RMHIER_GS.read_text(encoding="utf-8")
    hierarchy_rows = parse_rm_hierarchy_raw(gs_text)
    hr_by_name = parse_hr_export(csv_path)

    print("=" * 60)
    print("check-rm-hierarchy-drift.py -- RM_HIERARCHY_RAW_ vs fresh HR export")
    print("=" * 60)
    print(f"RM_HIERARCHY_RAW_ rows: {len(hierarchy_rows)}")
    print(f"HR export people (deduped by name): {len(hr_by_name)}")
    print()

    stale_field = []
    stale_ch = []
    not_in_export = []
    exited_but_present = []

    for row in hierarchy_rows:
        key = normalize(row["name"])
        hr = hr_by_name.get(key)
        if hr is None:
            not_in_export.append(row)
            continue
        if hr["exited"]:
            exited_but_present.append((row, hr))
        for field in ("tl", "tm", "rh", "ch"):
            val = row[field].strip()
            if not val:
                continue
            if normalize(val) not in hr["current_managers"]:
                (stale_ch if field == "ch" else stale_field).append((row, field, val))

    if stale_field:
        print(f"STALE tl/tm/rh -- {len(stale_field)} field(s) not found anywhere in that")
        print("person's current chain columns in the fresh export. This is the exact bug")
        print("class the Zeya Shaikh/Karan Shinde/Mayuresh Chavan fix (2026-09-21) caught")
        print("-- these are worth checking first:")
        for row, field, val in stale_field:
            print(f"  {row['name']!r}: {field}={val!r} -- not in current chain "
                  f"(export shows: {sorted(hr_by_name[normalize(row['name'])]['current_managers'])})")
        print()
    else:
        print("No stale tl/tm/rh values found against this export -- the exact bug")
        print("class this script exists for is clean.")
        print()

    if stale_ch:
        print(f"CH MISMATCHES -- {len(stale_ch)} (lower confidence, check before acting):")
        print("RmHierarchy.gs's own header docblock documents several deliberate")
        print("named overrides on `ch` specifically (a person filling a Cluster-Head-")
        print("equivalent role the export's own columns don't literally tag as one --")
        print("e.g. Mukesh Mishra for Bangalore/Hyderabad, Shitij Kaushal for Vidya")
        print("Jadhav/Bipin More) -- most hits here will be exactly that, not a real")
        print("staleness bug. Cross-check the row's own inline comment first.")
        for row, field, val in stale_ch:
            print(f"  {row['name']!r}: ch={val!r} -- not in current chain "
                  f"(export shows: {sorted(hr_by_name[normalize(row['name'])]['current_managers'])})")
        print()

    if exited_but_present:
        print(f"CONFIRMED DEPARTURES STILL IN RM_HIERARCHY_RAW_ -- {len(exited_but_present)}:")
        print("(export's own Exit column is filled in for these)")
        for row, hr in exited_but_present:
            print(f"  {row['name']!r} (team={row['team']!r}, role={row['role']!r})")
        print()

    if not_in_export:
        print(f"NOT FOUND IN THIS EXPORT AT ALL -- {len(not_in_export)}:")
        print("(likely departed, or a deliberate leads-sheet alias row -- check the")
        print("inline comment above the row in RmHierarchy.gs before assuming either)")
        for row in not_in_export:
            print(f"  {row['name']!r} (team={row['team']!r}, role={row['role']!r})")
        print()

    if not (stale_field or stale_ch or exited_but_present or not_in_export):
        print("Clean -- nothing to review.")

    print("=" * 60)


if __name__ == "__main__":
    main()
