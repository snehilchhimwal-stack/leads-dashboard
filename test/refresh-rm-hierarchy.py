#!/usr/bin/env python3
"""refresh-rm-hierarchy.py -- the actual "do the full refresh" tool, not
just a detector.

WHY THIS EXISTS: check-rm-hierarchy-drift.py only walks RM_HIERARCHY_RAW_'s
EXISTING rows and asks "does this row still match the export" -- it has no
code path that ever asks "is every export person represented here at all".
That's a structural blind spot, not a tuning gap: a brand-new hire can never
be flagged by that script no matter how many times it's run, because it
never iterates the export looking for names missing from the table.

That blind spot is exactly what let Zoya Fathima (H6556, Cluster Head,
Hyderabad, joined 2026-09-16) go completely missing from RM_Hierarchy for
the ~13 days between the last full refresh (commit 312bcf8, off the
2026-09-09 export) and 2026-09-22, when she was found by hand. She first
appears in the 2026-09-21 export. Nothing caught it because nothing ever
looked. Six of her existing direct/indirect reports (Parusharothu Vinay
Varma, Vemula Ajay, Maagathoti Adilakshmi, Vadlapudi Divya, Peddapally Veera
Shivaji, G Anand Kumar) kept routing to the OLD override manager (Mukesh
Mishra) instead of her -- a second-order, harder-to-spot symptom of the
same root gap.

This script closes that gap AND turns "run a check, then hand-edit for an
hour" into "run one command, review a short report, optionally apply the
safe subset automatically". It reuses check-rm-hierarchy-drift.py's own
parsing (imported directly, not copy-pasted, so the two can't drift apart)
for the checks that script already does well, and adds:

  1. NEW JOINERS -- export people with ZERO row in RM_HIERARCHY_RAW_ at
     all, scoped to the table's own documented sales-track roles (S1/S2/S3/
     A1/TL/TM/RH/RM/BDM/Cluster Head/City Lead/Commercial Head -- see
     RmHierarchy.gs's own header). This is the literal Zoya Fathima bug
     class, made impossible to silently miss again.
  2. AUTO-RESOLUTION for the unambiguous subset of both new joiners and
     existing STALE tl/tm/rh/ch fields (see "WHAT GETS AUTO-APPLIED" below)
     -- written directly into RmHierarchy.gs / RmHierarchy.private.gs with
     `--apply`, each new/changed line tagged with an inline comment so it's
     obviously auditable and matches this file's existing convention of
     every hand-added row explaining itself.
  3. EMPLOYEE_EMAIL_BY_NAME_RAW_ refresh (RmHierarchy.private.gs) -- pure
     name/email data, always mechanically safe to add (never overwrites an
     existing email; a changed email is reported, not silently applied).

WHAT GETS AUTO-APPLIED VS FLAGGED FOR A HUMAN
RmHierarchy.gs's own header docblock is explicit that the export's chain
columns are POSITIONAL, not per-role -- the same column can hold a person's
A1, or their TM if they have no A1, depending on how many hops THEIR chain
has (its own documented example: an S1 reporting straight to a TM with no
A1 has that TM land in the "A1" column). Blindly copying column position
into a fixed field would reproduce exactly the kind of error this script
exists to prevent. Instead, every filled chain-slot name is resolved by
looking up THAT NAME's own already-resolved role in RM_HIERARCHY_RAW_ (or
in this same run's newly-added rows) and placing it into the field that
role maps to (A1->tl, TM->tm, RH->rh, Cluster Head/City Lead/Commercial
Head/Leadership->ch). A candidate is HIGH confidence, and only then
eligible for --apply, when every filled slot resolves this way with no
field collision. Anything else -- a slot that doesn't resolve to any known
row, two different names mapping to the same field, or (Zoya Fathima's own
case) a top-tier person with every chain-slot column blank, where the only
signal is the P&L column -- is LOW confidence and only ever printed, never
written. The P&L column deliberately gets no automatic weight: a direct
side-by-side of real rows shows it is NOT a reliable signal on its own --
Vidya Jadhav/Bipin More's P&L value (Shitij Kaushal) IS their real ch (a
confirmed 2026-09-17 reassignment), but Sanjyota Bhosale's and Mukesh
Mishra's own P&L values are NOT used as their ch (both resolve blank) --
the difference is real organizational knowledge the export alone can't
distinguish, so a human decides every time, same as before this script
existed.

USAGE
    python3 test/refresh-rm-hierarchy.py <export.csv>            # report only (default, safe)
    python3 test/refresh-rm-hierarchy.py <export.csv> --apply    # also writes the safe subset

Run this whenever a fresh "HR Live" export lands -- it supersedes running
check-rm-hierarchy-drift.py by hand first; this script runs those same
checks internally plus the new-joiner pass. Always re-run WITHOUT --apply
first and read the report before applying anything. After --apply: run
`node test/run-gs-tests.js` (or `python3 test/run-gs-tests-headless.py`),
paste both changed files into the live Apps Script editor (Apps Script does
not auto-deploy from git), run rebuildRmHierarchy() there, and resolve
every item left in the "NEEDS A HUMAN DECISION" section by hand before
considering the refresh complete.
"""

import csv
import importlib.util
import re
import sys
from datetime import date
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
RMHIER_GS = REPO_ROOT / "RmHierarchy.gs"
RMHIER_PRIVATE_GS = REPO_ROOT / "RmHierarchy.private.gs"

# Import check-rm-hierarchy-drift.py's own parsing so the two scripts can
# never silently disagree about what a "row" or an "export person" is.
_drift_spec = importlib.util.spec_from_file_location(
    "check_rm_hierarchy_drift", REPO_ROOT / "test" / "check-rm-hierarchy-drift.py"
)
_drift = importlib.util.module_from_spec(_drift_spec)
_drift_spec.loader.exec_module(_drift)
normalize = _drift.normalize
parse_rm_hierarchy_raw = _drift.parse_rm_hierarchy_raw
parse_hr_export = _drift.parse_hr_export
COL_NAME = _drift.COL_NAME
COL_EXIT = _drift.COL_EXIT
CURRENT_CHAIN_COLS = _drift.CURRENT_CHAIN_COLS

COL_ROLE = 2
COL_TEAM = 15
COL_EMAIL = 35

# The table's own documented scope (RmHierarchy.gs header, "Scoped to
# sales-track people only"). Anything outside this set (Finance/HR/
# Marketing/Technology/Magnet/Post Sales/Customer Experience, etc.) is
# deliberately never a candidate row here.
SALES_TRACK_ROLES = {
    "s1", "s2", "s3", "a1", "tl", "tm", "rh", "rm", "bdm",
    "cluster head", "city lead", "commercial head",
}

# An already-resolved row's own `role` -> which RM_HIERARCHY_RAW_ field a
# name with that role belongs in when it shows up as someone ELSE's
# manager. Roles not listed here (S1/S2/S3/BDM/Manager/Executive/...) never
# legitimately appear as a manager value; a chain-slot resolving to one of
# those is treated as unexpected (LOW confidence), not silently placed.
ROLE_TO_FIELD = {
    "a1": "tl",
    "tl": "tl",  # RmHierarchy.gs's own header calls this field "A1/Team Lead" --
                 # the export tags some managers 'A1', others literally 'TL'; same tier.
    "tm": "tm",
    "rh": "rh",
    "cluster head": "ch",
    "city lead": "ch",
    "commercial head": "ch",
    "leadership": "ch",
}

FIELD_ORDER = ("tl", "tm", "rh", "ch")


_FULL_ROW_MIN_LEN = max(COL_EMAIL, COL_EXIT, COL_ROLE, COL_TEAM, *CURRENT_CHAIN_COLS)


def parse_hr_export_full(csv_path):
    """Like parse_hr_export, but keeps per-person role/team/email/ordered
    chain-slot values instead of collapsing to a single current_managers
    set -- new-joiner resolution needs role/team/email that the shared
    parser discards (it only cares about WHICH names appear, not who they
    are)."""
    by_name = {}
    with open(csv_path, newline="", encoding="utf-8-sig") as f:
        reader = csv.reader(f)
        next(reader, None)
        for row in reader:
            if len(row) <= _FULL_ROW_MIN_LEN:
                continue
            raw_name = row[COL_NAME].strip()
            if not raw_name:
                continue
            key = normalize(raw_name)
            chain_names = [row[c].strip() for c in CURRENT_CHAIN_COLS
                            if row[c].strip() and row[c].strip() != "-"]
            entry = {
                "raw_name": raw_name,
                "role": row[COL_ROLE].strip() if len(row) > COL_ROLE else "",
                "team": row[COL_TEAM].strip() if len(row) > COL_TEAM else "",
                "email": row[COL_EMAIL].strip() if len(row) > COL_EMAIL else "",
                "chain_names": chain_names,
                "exited": row[COL_EXIT].strip() not in ("", "-"),
            }
            # Same multi-row-per-person handling as parse_hr_export: union
            # rather than overwrite.
            existing = by_name.get(key)
            if existing:
                existing["chain_names"] = list(dict.fromkeys(existing["chain_names"] + entry["chain_names"]))
                existing["exited"] = existing["exited"] or entry["exited"]
                if not existing["email"]:
                    existing["email"] = entry["email"]
            else:
                by_name[key] = entry
    return by_name


def parse_email_raw(gs_text):
    m = re.search(r"EMPLOYEE_EMAIL_BY_NAME_RAW_\s*=\s*\[", gs_text)
    if not m:
        sys.exit("Could not find EMPLOYEE_EMAIL_BY_NAME_RAW_ = [ in RmHierarchy.private.gs")
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
    row_re = re.compile(r"\[\s*'([^']*)'\s*,\s*'([^']*)'\s*\]")
    by_name = {}
    for row_m in row_re.finditer(body):
        name, email = row_m.groups()
        by_name[normalize(name)] = {"name": name, "email": email}
    return by_name, start, i


def resolve_role_lookup(hierarchy_rows):
    """name (normalized) -> role, from the CURRENT table state (existing
    rows plus, as the caller mutates this dict, any rows added this run --
    lets a later new-joiner resolve against an earlier one in the same
    pass, e.g. someone reporting to Zoya Fathima resolves against her row
    once she's been classified, without needing a second pass)."""
    return {normalize(r["name"]): r["role"] for r in hierarchy_rows}


def classify_new_joiner(hr_entry, role_lookup):
    """Returns (confidence, field_values, notes) where field_values is a
    dict of tl/tm/rh/ch -> name for whichever fields resolved, and notes
    explains any slot that didn't resolve."""
    role_key = hr_entry["role"].strip().lower()
    if role_key not in SALES_TRACK_ROLES:
        return None  # out of this table's documented scope entirely

    if not hr_entry["chain_names"]:
        return ("LOW", {}, "every current-chain column is blank; only "
                "resolvable signal would be the P&L column, which is not "
                "a reliable automatic signal (see script docstring) -- "
                "needs a human to confirm the real manager.")

    field_values = {}
    notes = []
    for name in hr_entry["chain_names"]:
        mgr_role = role_lookup.get(normalize(name), "").strip().lower()
        field = ROLE_TO_FIELD.get(mgr_role)
        if field is None:
            notes.append(f"{name!r} does not resolve to a known manager-tier "
                          f"role (role={mgr_role or 'NOT FOUND'!r})")
            continue
        if field in field_values and field_values[field] != name:
            notes.append(f"both {field_values[field]!r} and {name!r} map to "
                          f"the same field {field!r} -- collision")
            continue
        field_values[field] = name

    if notes:
        return ("LOW", field_values, "; ".join(notes))
    return ("HIGH", field_values, "")


def format_row(team, role, name, field_values, comment):
    tl = field_values.get("tl", "")
    tm = field_values.get("tm", "")
    rh = field_values.get("rh", "")
    ch = field_values.get("ch", "")
    line = f"  ['{team}','{role}','{name}','{tl}','{tm}','{rh}','{ch}'],"
    if comment:
        line += f" // {comment}"
    return line


def main():
    args = sys.argv[1:]
    apply_changes = "--apply" in args
    args = [a for a in args if a != "--apply"]
    if len(args) != 1:
        sys.exit(f"Usage: python3 {sys.argv[0]} <path-to-HR-export.csv> [--apply]")
    csv_path = Path(args[0])
    if not csv_path.is_file():
        sys.exit(f"Not a file: {csv_path}")

    today = date.today().isoformat()
    gs_text = RMHIER_GS.read_text(encoding="utf-8")
    hierarchy_rows = parse_rm_hierarchy_raw(gs_text)
    hr_by_name = parse_hr_export(csv_path)          # reused: stale/CH/departure checks
    hr_full_by_name = parse_hr_export_full(csv_path)  # this script's own: new-joiner checks

    existing_names = {normalize(r["name"]) for r in hierarchy_rows}
    role_lookup = resolve_role_lookup(hierarchy_rows)

    print("=" * 70)
    print("refresh-rm-hierarchy.py -- full refresh against a fresh HR export")
    print("=" * 70)
    print(f"Export: {csv_path.name}")
    print(f"RM_HIERARCHY_RAW_ rows: {len(hierarchy_rows)}")
    print(f"HR export people (deduped by name): {len(hr_full_by_name)}")
    print()

    # ---- Section 1: everything check-rm-hierarchy-drift.py already does ----
    stale_field, stale_ch, not_in_export, exited_but_present = [], [], [], []
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

    # ---- Section 2 (NEW): export people with no row at all ----
    new_joiners = []
    for key, entry in hr_full_by_name.items():
        if key in existing_names:
            continue
        if entry["exited"]:
            continue  # joined and left before ever needing a row
        classified = classify_new_joiner(entry, role_lookup)
        if classified is None:
            continue  # out of documented scope (non-sales-track role)
        confidence, field_values, notes = classified
        new_joiners.append((entry, confidence, field_values, notes))
        if confidence == "HIGH":
            # Make this row resolvable as a manager for a later new joiner
            # in the same pass (e.g. someone hired under Zoya Fathima in
            # the same export).
            role_lookup[key] = entry["role"]

    new_joiners.sort(key=lambda t: (t[1] != "HIGH", t[0]["raw_name"]))

    print(f"NEW JOINERS -- {len(new_joiners)} export people (sales-track scope) with NO row")
    print("in RM_HIERARCHY_RAW_ at all. This is the check that would have caught Zoya")
    print("Fathima on the day this export was pulled instead of ~13 days later.")
    if not new_joiners:
        print("  None. Every sales-track person in this export already has a row.")
    for entry, confidence, field_values, notes in new_joiners:
        tag = "AUTO-APPLIABLE" if confidence == "HIGH" else "NEEDS A HUMAN DECISION"
        print(f"  [{tag}] {entry['raw_name']!r} (role={entry['role']!r}, team={entry['team']!r})")
        if field_values:
            print(f"      resolved: {field_values}")
        if notes:
            print(f"      {notes}")
    print()

    if stale_field:
        print(f"STALE tl/tm/rh -- {len(stale_field)} field(s) not in that person's current chain:")
        for row, field, val in stale_field:
            candidates = sorted(hr_by_name[normalize(row["name"])]["current_managers"])
            print(f"  {row['name']!r}: {field}={val!r} (export shows: {candidates})")
        print()

    if stale_ch:
        print(f"CH MISMATCHES -- {len(stale_ch)} (lower confidence, most are deliberate overrides):")
        for row, field, val in stale_ch:
            candidates = sorted(hr_by_name[normalize(row["name"])]["current_managers"])
            print(f"  {row['name']!r}: ch={val!r} (export shows: {candidates})")
        print()

    if exited_but_present:
        print(f"CONFIRMED DEPARTURES STILL IN RM_HIERARCHY_RAW_ -- {len(exited_but_present)}:")
        for row, hr in exited_but_present:
            print(f"  {row['name']!r} (team={row['team']!r}, role={row['role']!r})")
        print()

    if not_in_export:
        print(f"NOT FOUND IN THIS EXPORT AT ALL -- {len(not_in_export)}:")
        for row in not_in_export:
            print(f"  {row['name']!r} (team={row['team']!r}, role={row['role']!r})")
        print()

    # ---- Section 3: safe auto-fix for STALE tl/tm/rh/ch (same confidence rule) ----
    auto_fixes = []  # (row, field, old_val, new_val)
    for row, field, old_val in stale_field + stale_ch:
        candidates = hr_by_name[normalize(row["name"])]["current_managers"]
        if len(candidates) != 1:
            continue
        (only_candidate,) = candidates
        mgr_role = role_lookup.get(only_candidate, "").strip().lower()
        if ROLE_TO_FIELD.get(mgr_role) != field:
            continue
        # Recover the real-cased name from hr_full_by_name for a clean write.
        real_name = hr_full_by_name.get(only_candidate, {}).get("raw_name", only_candidate)
        auto_fixes.append((row, field, old_val, real_name))

    new_email_rows = []
    if RMHIER_PRIVATE_GS.is_file():
        priv_text = RMHIER_PRIVATE_GS.read_text(encoding="utf-8")
        email_by_name, email_start, email_end = parse_email_raw(priv_text)
        changed_emails = []
        for key, entry in hr_full_by_name.items():
            # The export uses 'NA'/'-' (and blank) for a genuinely missing
            # email, same placeholder convention as every other blank cell
            # in this export ("-") -- only a real address (has an '@') is
            # ever worth writing here.
            if "@" not in entry["email"]:
                continue
            existing = email_by_name.get(key)
            if existing is None:
                new_email_rows.append((entry["raw_name"], entry["email"]))
            elif existing["email"].strip().lower() != entry["email"].strip().lower():
                changed_emails.append((existing["name"], existing["email"], entry["email"]))
        print(f"NEW EMAILS -- {len(new_email_rows)} export people with an email not yet in "
              "RmHierarchy.private.gs (always safe to add):")
        for name, email in new_email_rows[:20]:
            print(f"  {name!r} -> {email}")
        if len(new_email_rows) > 20:
            print(f"  ... and {len(new_email_rows) - 20} more")
        print()
        if changed_emails:
            print(f"EMAIL CHANGED -- {len(changed_emails)} (not auto-applied, could be a same-name collision):")
            for name, old, new in changed_emails:
                print(f"  {name!r}: {old!r} -> {new!r}")
            print()
    else:
        print("RmHierarchy.private.gs not found locally (gitignored) -- skipping email refresh.")
        print()

    high_joiners = [(e, f) for e, c, f, n in new_joiners if c == "HIGH"]
    print("-" * 70)
    print(f"SUMMARY: {len(high_joiners)} new joiner(s) auto-appliable, "
          f"{len(new_joiners) - len(high_joiners)} need a human decision, "
          f"{len(auto_fixes)} stale field(s) auto-fixable, "
          f"{len(new_email_rows)} new email(s) auto-appliable.")
    print("-" * 70)

    if not apply_changes:
        print()
        print("Dry run only -- re-run with --apply to write the auto-appliable subset above.")
        return

    # ---- Apply: RM_HIERARCHY_RAW_ inserts + stale-field fixes ----
    if high_joiners or auto_fixes:
        # Matched by each row's own exact, unique ['team','role','name',...]
        # text rather than a parsed line number, which is relative to the
        # array body and would drift the moment an earlier insert shifts
        # later offsets.
        new_text = gs_text
        for row, field, old_val, new_val in auto_fixes:
            row_prefix = f"['{row['team']}','{row['role']}','{row['name']}','{row['tl']}','{row['tm']}','{row['rh']}','{row['ch']}']"
            if row_prefix not in new_text:
                print(f"  SKIPPED (row text changed since parse, re-run): {row['name']!r} {field}")
                continue
            field_pos = FIELD_ORDER.index(field)
            new_fields = [row["tl"], row["tm"], row["rh"], row["ch"]]
            new_fields[field_pos] = new_val
            new_row = f"['{row['team']}','{row['role']}','{row['name']}','{new_fields[0]}','{new_fields[1]}','{new_fields[2]}','{new_fields[3]}']"
            new_text = new_text.replace(
                row_prefix,
                new_row + f" // AUTO-REFRESH {today} from {csv_path.name}: {field} corrected from {old_val!r} (export no longer shows that chain)",
                1,
            )

        if high_joiners:
            insert_lines = [f"  // AUTO-REFRESH {today} from {csv_path.name}: new joiners, "
                             f"single-manager resolution (see test/refresh-rm-hierarchy.py)\n"]
            for entry, field_values in high_joiners:
                insert_lines.append(format_row(entry["team"], entry["role"], entry["raw_name"],
                                                field_values, "") + "\n")
            m = re.search(r"(const RM_HIERARCHY_RAW_\s*=\s*\[.*?)(\n\];)", new_text, re.DOTALL)
            if not m:
                sys.exit("Could not find RM_HIERARCHY_RAW_'s closing '];' to insert new rows before.")
            new_text = new_text[:m.end(1)] + "\n" + "".join(insert_lines).rstrip("\n") + m.group(2) + new_text[m.end():]

        RMHIER_GS.write_text(new_text, encoding="utf-8")
        print(f"Wrote {len(high_joiners)} new row(s) and {len(auto_fixes)} field fix(es) to {RMHIER_GS.name}")

    if new_email_rows and RMHIER_PRIVATE_GS.is_file():
        priv_text = RMHIER_PRIVATE_GS.read_text(encoding="utf-8")
        insert_lines = [f"  // AUTO-REFRESH {today} from {csv_path.name}\n"]
        for name, email in new_email_rows:
            insert_lines.append(f"  ['{name}','{email}'],\n")
        m = re.search(r"(const EMPLOYEE_EMAIL_BY_NAME_RAW_\s*=\s*\[.*?)(\n\];)", priv_text, re.DOTALL)
        if not m:
            sys.exit("Could not find EMPLOYEE_EMAIL_BY_NAME_RAW_'s closing '];' to insert new rows before.")
        priv_text = priv_text[:m.end(1)] + "\n" + "".join(insert_lines).rstrip("\n") + m.group(2) + priv_text[m.end():]
        RMHIER_PRIVATE_GS.write_text(priv_text, encoding="utf-8")
        print(f"Wrote {len(new_email_rows)} new email row(s) to {RMHIER_PRIVATE_GS.name}")

    print()
    print("Next steps: run the .gs test suite, paste BOTH changed files into the live")
    print("Apps Script editor, run rebuildRmHierarchy(), and resolve everything still")
    print("listed above as NEEDS A HUMAN DECISION by hand -- this script never guesses.")


if __name__ == "__main__":
    main()
