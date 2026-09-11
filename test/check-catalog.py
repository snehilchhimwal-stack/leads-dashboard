#!/usr/bin/env python3
"""
check-catalog.py — the docs/ catalog change-control tripwires.

Built for the forensic audit's P0/P1 (t-tf-5ad22d8e4c2e; see
docs/_planning/FORENSIC_COMPLETENESS_AUDIT_2026-09-10.md §L / §M). Runs in
CI right after test/check-docs-coverage.js. Python, not Node, deliberately:
the reciprocity logic was already prototyped in Python (DOC-040), the CI
runner has python3, and it means the checks can be run and verified
locally on a machine with no Node (this repo's, as of 2026-09-04).

What it does — seven checks against docs/INDEX.md + the record files + git:

  A. INDEX.md internal reciprocity    (BLOCKING — green as of 2026-09-10)
     every A->B in a Depends On column has B->A in B's Used By, and back;
     no id referenced without its own row.
  B. INDEX <-> record-file coverage    (BLOCKING)
     every own-file id (DASH/TAB/JS/GS/SHEET/EXT/DATA) in INDEX has a
     docs/<type>/<ID>-*.md file, and every such file has an INDEX row.
     docs/_archive/ is scanned too, so a component retired per
     HOW_TO_RETIRE_A_COMPONENT.md (moved there, INDEX row kept) still
     counts as covered.
  C. INDEX Location -> real file        (BLOCKING)
     a row whose Location names js/foo.js or Foo.gs or dashboard.html
     that no longer exists on disk = a retired/renamed/moved component
     with a stale record.
  D. Last-Verified drift               (ADVISORY — never fails the build)
     a record verified at commit <sha> whose ## Location path has since
     advanced past <sha> on HEAD. Needs full git history (fetch-depth: 0).
  E. change -> component-ID impact     (ADVISORY)
     given BEFORE/AFTER shas (env DIFF_BASE / DIFF_HEAD, or argv, or
     github.event.before/after), resolve every changed repo path against
     INDEX's Location column -> affected ids + their deps/consumers out
     to 2 hops (Required Fix #4, E2E acceptance test report -- was 1 hop
     only; TEST 23 proved a real cascade needs the 2nd link, e.g.
     JS-016 -> SHEET-004 -> GS-010) -- PLUS any FLOW-/TRIGGER-
     architecture overlay whose own Depends On names something in that
     impact set (Required Fix #5 -- these overlays are exempt from
     check A's reciprocity requirement, so the normal edge-walk could
     never reach them; TEST 12 proved a GS-010 change needs to surface
     FLOW-002 too). A changed js/*.js or *.gs path with NO INDEX row =
     "undocumented component". Prints the set that should go Stale and
     a ready-to-run update-tasks.ps1 ops JSON (CI cannot reach
     tasks.json itself).
  G. Sub-table ID uniqueness           (ADVISORY)
     (Required Fix #7, E2E acceptance test report, F10/TESTS 8+10):
     FN-/BTN-/UI-/RULE-/EXC-/CFG-/API- sub-components (~460 rows at
     baseline) live inside each owning record's own markdown sub-tables,
     never as INDEX.md master-table rows -- A-C/F never see them at all.
     This does NOT close that whole gap (catching "the code added a new
     button/exception with no matching row" needs real JS/.gs static
     analysis, out of scope here) -- it catches the smaller, unambiguous
     piece: every sub-id must be unique across the WHOLE catalog. A
     duplicate has no legitimate justification, same class of defect as
     A/B/C/F already catch for own-file ids, just one tier down.
  H. Owner / Evidence field content    (ADVISORY)
     (Required Fix #8, E2E acceptance test report, F17/TESTS 15+16):
     component-record-template.md's own header says a blank field
     "blocks Record Status: Closed + Monitored" -- nothing ever parsed
     `**Owner**` or `## Validation`'s `**Evidence:**` line to enforce
     that; confirmed for real with a fully structural-correct record
     (blank Owner + blank Evidence + Closed + Monitored, passed A/B/C/F
     clean). Flags exactly that self-contradiction: a blank Owner cell,
     or a Closed + Monitored / Validated status with a blank or absent
     Evidence line. Not general content correctness (Required Fix #1's
     much bigger, deliberately-not-built territory) -- just the one
     specific rule the template already states and nothing checked.

Exit code: non-zero iff A, B or C fail. D, E, G, and H only print.
Flip D/E/G/H to blocking later by setting CATALOG_STRICT=1.
"""
import os, re, sys, subprocess, json

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
INDEX = os.path.join(ROOT, "docs", "INDEX.md")
STRICT = os.environ.get("CATALOG_STRICT") == "1"

OWN = ("DASH", "TAB", "JS", "GS", "SHEET", "EXT", "DATA")
# architecture overlays (FLOW-/TRIGGER-) reference components but are NOT
# reciprocated -- a component does not list every overlay that spans it,
# the same way HANDOVER.md references everything without the reverse.
ARCH = ("FLOW", "TRIGGER")
ANYID = re.compile(r'\b((?:DASH|TAB|JS|GS|SHEET|EXT|DATA|FLOW|TRIGGER)-\d{3})\b')
OWNID = re.compile(r'\b((?:DASH|TAB|JS|GS|SHEET|EXT|DATA)-\d{3})\b')
FILE_IN_LOC = re.compile(r'(js/[A-Za-z0-9_.-]+\.js|[A-Za-z0-9_]+\.gs|dashboard\.html)')
TYPE_DIR = {"DASH": "dashboards", "TAB": "tabs", "JS": "js-modules", "GS": "gs-modules",
            "SHEET": "sheets", "EXT": "integrations", "DATA": "data-flows",
            "FLOW": "architecture", "TRIGGER": "architecture"}
# cross-runtime pair markers: a changed line touching one of these should
# make someone check the OTHER runtime's twin (HANDOVER.md §6).
PAIR_MARKERS = ("_GS_", "HEADER_ALIASES", "OUTCOME_RULES", "REGION_GROUP_MAP",
                "RM_PERF_", "TEST_MODE_OVERRIDE_EMAIL", "FOLLOWUP_SUGGESTIONS",
                "istDayKey", "istDateKey", "computeSlaFlags", "enrichLead")

def git(*args):
    try:
        return subprocess.run(["git", "-C", ROOT, *args], capture_output=True,
                              text=True, check=False).stdout.strip()
    except Exception as e:
        return ""

def parse_index():
    """id -> dict(dep=set, ub=set, loc=str, files=list, row_line=int)"""
    rows = {}
    for i, line in enumerate(open(INDEX, encoding="utf-8"), 1):
        if not line.lstrip().startswith("|"):
            continue
        cells = [c.strip() for c in line.strip().strip("|").split("|")]
        if len(cells) != 8 or not re.fullmatch(r'[A-Z]{2,6}-\d{3}', cells[0]):
            continue
        cid = cells[0]
        loc = cells[3]
        pre = cid.split("-")[0]
        rows[cid] = dict(
            kind="arch" if pre in ARCH else ("own" if pre in OWN else "other"),
            dep=set(x for x in OWNID.findall(cells[5]) if x != cid),
            ub=set(x for x in OWNID.findall(cells[6]) if x != cid),
            loc=loc,
            files=FILE_IN_LOC.findall(loc),
            last_verified=cells[7],
            row_line=i,
        )
    return rows

# ---------------------------------------------------------------- A
def check_reciprocity(rows):
    """Full reciprocity among the own-file component rows; arch overlays
    (FLOW-/TRIGGER-) only have to resolve to a real row, not be echoed
    back."""
    problems = []
    for a, d in rows.items():
        for b in d["dep"]:
            if b not in rows:
                problems.append(f"{a} Depends On {b} — but {b} has no INDEX row")
            elif d["kind"] == "own" and rows[b]["kind"] == "own" and a not in rows[b]["ub"]:
                problems.append(f"{a} Depends On {b} — but {b}'s Used By is missing {a}")
        for b in d["ub"]:
            if b not in rows:
                problems.append(f"{a} Used By {b} — but {b} has no INDEX row")
            elif d["kind"] == "own" and rows[b]["kind"] == "own" and a not in rows[b]["dep"]:
                problems.append(f"{b} in {a}'s Used By — but {b}'s Depends On is missing {a}")
    return sorted(set(problems))

# ---------------------------------------------------------------- B
def check_coverage(rows):
    # BUGFIX (E2E acceptance test Part 8, 2026-09-11 — found by actually
    # performing a retirement): HOW_TO_RETIRE_A_COMPONENT.md's own
    # documented process moves a retired record to docs/_archive/ and
    # explicitly keeps its INDEX.md row in place — but this check only
    # ever scanned the live TYPE_DIR folders, so following that process
    # to the letter used to make check B fail (a retired ID looked
    # exactly like a missing record). docs/_archive/ is now scanned too,
    # for every prefix, so a properly retired component still counts as
    # covered.
    problems = []
    disk = {}
    for pre, sub in TYPE_DIR.items():
        d = os.path.join(ROOT, "docs", sub)
        disk[pre] = set()
        if os.path.isdir(d):
            for f in os.listdir(d):
                m = re.match(r'((?:DASH|TAB|JS|GS|SHEET|EXT|DATA|FLOW|TRIGGER)-\d{3})-.*\.md$', f)
                if m:
                    disk[pre].add(m.group(1))
    archive_dir = os.path.join(ROOT, "docs", "_archive")
    if os.path.isdir(archive_dir):
        for f in os.listdir(archive_dir):
            m = re.match(r'((?:DASH|TAB|JS|GS|SHEET|EXT|DATA|FLOW|TRIGGER)-\d{3})-.*\.md$', f)
            if m:
                cid = m.group(1)
                disk.setdefault(cid.split("-")[0], set()).add(cid)
    index_ids = set(rows)
    file_ids = set().union(*disk.values()) if disk else set()
    for cid in sorted(index_ids - file_ids):
        problems.append(f"INDEX row {cid} has no record file under docs/{TYPE_DIR[cid.split('-')[0]]}/ or docs/_archive/")
    for cid in sorted(file_ids - index_ids):
        problems.append(f"record file {cid}-*.md exists but has no INDEX master-table row")
    return problems

# ---------------------------------------------------------------- C
def check_locations(rows):
    problems = []
    for cid, d in rows.items():
        for f in d["files"]:
            if f.endswith(".js") and "*" in f:
                continue
            if not os.path.exists(os.path.join(ROOT, f)):
                problems.append(f"{cid} Location names `{f}` — not found on disk (retired/renamed/moved?)")
    return problems

# ---------------------------------------------------------------- D
def record_path(cid):
    sub = TYPE_DIR[cid.split("-")[0]]
    d = os.path.join(ROOT, "docs", sub)
    if not os.path.isdir(d):
        return None
    for f in os.listdir(d):
        if f.startswith(cid + "-") and f.endswith(".md"):
            return os.path.join(d, f)
    return None

def check_last_verified_drift(rows):
    warns = []
    have_history = git("rev-list", "--count", "HEAD") not in ("", "1")
    if not have_history:
        return ["(skipped — shallow clone; set fetch-depth: 0 on actions/checkout)"]
    for cid, d in rows.items():
        real = [f for f in d["files"] if not ("*" in f)]
        if not real:
            continue
        rp = record_path(cid)
        if not rp:
            continue
        txt = open(rp, encoding="utf-8").read()
        m = re.search(r'(?:Verified at|Last Verified\**[^`]*?)`([0-9a-f]{7,40})`', txt)
        if not m:
            warns.append(f"{cid}: no verifying commit sha found in the record")
            continue
        sha = m.group(1)
        if git("cat-file", "-t", sha) != "commit":
            warns.append(f"{cid}: verifying sha {sha} not in history")
            continue
        moved = git("log", "--oneline", f"{sha}..HEAD", "--", *real)
        if moved:
            n = len(moved.splitlines())
            warns.append(f"{cid}: verified at {sha} but {', '.join(real)} advanced {n} commit(s) since — revalidate")
    return warns

# ---------------------------------------------------------------- E
def resolve_shas():
    base = os.environ.get("DIFF_BASE") or os.environ.get("GITHUB_EVENT_BEFORE")
    head = os.environ.get("DIFF_HEAD") or os.environ.get("GITHUB_SHA") or "HEAD"
    if len(sys.argv) >= 3:
        base, head = sys.argv[1], sys.argv[2]
    if base and set(base) == {"0"}:          # all-zero = branch creation / no before
        base = None
    head = git("rev-parse", head) or head    # resolve HEAD / a ref to a real sha
    return base, head

def check_impact(rows):
    base, head = resolve_shas()
    out = []
    if not base:
        return ["(skipped — no BEFORE sha; pass DIFF_BASE/DIFF_HEAD or two argv, "
                "or run in GitHub Actions on a push with history)"]
    if git("cat-file", "-t", base) != "commit":
        return [f"(skipped — BEFORE sha {base} not in history; need fetch-depth: 0)"]
    changed = [p for p in git("diff", "--name-only", f"{base}..{head}").splitlines() if p]
    if not changed:
        return ["no files changed between the two commits"]
    path_to_ids = {}
    for cid, d in rows.items():
        for f in d["files"]:
            if "*" in f:
                continue
            path_to_ids.setdefault(f, set()).add(cid)
    affected, undocumented = set(), []
    for p in changed:
        ids = path_to_ids.get(p)
        if ids:
            affected |= ids
        elif re.match(r'js/[^/]+\.js$', p) or re.match(r'[^/]+\.gs$', p):
            if not p.startswith("Tests_") and p != "RmHierarchy.private.gs":
                undocumented.append(p)
    # 2-hop impact walk (Required Fix #4, E2E acceptance test report --
    # this used to stop at exactly 1 hop, confirmed for real in TEST 23:
    # a real production cascade (a UI write -> a Sheet -> the SEPARATE,
    # unattended Apps Script system that reads that Sheet) lost coverage
    # past the first link, e.g. a change to JS-016 never surfaced GS-010
    # even though JS-016 -> SHEET-004 -> GS-010 is a real, reciprocal
    # dependency chain. The graph is small (~72 rows) so a 2nd hop costs
    # nothing measurable. A plain set (impact, monotonically growing,
    # only ever expanded by NEW ids not already in it) is its own cycle
    # guard -- the walk always terminates in at most `rows` iterations,
    # and here it's capped at 2 explicitly by design, not by need.
    impact = set(affected)
    frontier = set(affected)
    for _hop in range(2):
        nxt = set()
        for cid in frontier:
            if cid not in rows:
                continue
            nxt |= rows[cid]["dep"] | rows[cid]["ub"]
        nxt -= impact
        if not nxt:
            break
        impact |= nxt
        frontier = nxt
    # Architecture-overlay surfacing (Required Fix #5, E2E acceptance
    # test report): check A deliberately does NOT require a FLOW-/
    # TRIGGER- row's own Depends On to be echoed back in a member's
    # Used By (the "kind: arch" exemption in check_reciprocity -- an
    # overlay describing many components isn't itself something every
    # one of them should have to list). But that same exemption meant
    # this impact walk, which only ever follows real reciprocal edges,
    # could never walk BACK to the overlay describing a changed
    # component -- confirmed for real in TEST 12: a GS-010 change never
    # surfaced FLOW-002 ("The 3-phase 'Generate region emails' cycle"),
    # even though FLOW-002's own Depends On names GS-010 directly.
    # Scanned independently of the reciprocity graph, against the full
    # impact set found so far (not just the directly-changed ids): any
    # arch overlay naming a touched component in its own Depends On is
    # relevant context for whoever reviews this change.
    arch_hits = sorted(cid for cid, d in rows.items()
                        if d["kind"] == "arch" and (d["dep"] & impact))
    impact |= set(arch_hits)
    for u in undocumented:
        out.append(f"UNDOCUMENTED COMPONENT: {u} changed but has no docs/INDEX.md row")
    if affected:
        stale = sorted(impact)
        hdate = git("show", "-s", "--format=%cs", head) or "undated"
        out.append(f"changed paths touch {len(affected)} documented component(s): {sorted(affected)}")
        out.append(f"impact set, up to 2 hops (mark these INDEX rows Stale): {stale}")
        if arch_hits:
            out.append(f"ARCHITECTURE OVERLAY affected — re-check {', '.join(arch_hits)} against this change too")
        ops = {"closes": [], "opens": [{
            "title": f"[Leads Dashboard] Revalidate {', '.join(sorted(affected))} after {head[:12]}",
            "why": (f"Change-control (check-catalog.py E): commit range {base[:12]}..{head[:12]} "
                    f"touched {sorted(affected)}. Impact (up to 2 hops): {stale}. For each: re-read the "
                    f"record against the code at {head[:12]}, refresh ## Validation + Last Verified + "
                    f"the INDEX.md row, update HANDOVER.md if ## Handover relationship flagged it, "
                    f"write docs/changes/{hdate}-{head[:12]}.md, then set the rows back to "
                    f"Closed + Monitored."),
            "priority": "High", "tags": ["leads-dashboard", "documentation", "revalidation"],
            "goalId": None, "deadlineDate": None}]}
        out.append("run this to open the revalidation task (CI cannot reach tasks.json):")
        out.append("  powershell -NoProfile -ExecutionPolicy Bypass -File "
                   '"C:/Users/User/Desktop/Strategy/To-do Dashboard/update-tasks.ps1" -OpsFile <path>')
        out.append("  ops JSON:")
        out.append("  " + json.dumps(ops))
    # comment-change flag: a changed line touching a cross-runtime pair
    # marker -> check the OTHER runtime's twin (HANDOVER.md §6).
    diff = git("diff", "-U0", f"{base}..{head}", "--",
               *[p for p in changed if p.endswith((".js", ".gs"))])
    hit = {}
    for ln in diff.splitlines():
        if ln.startswith(("+++", "---")) or not ln.startswith(("+", "-")):
            continue
        for mk in PAIR_MARKERS:
            if mk in ln:
                hit.setdefault(mk, 0)
                hit[mk] += 1
    if hit:
        out.append("PAIR MARKER touched — verify the cross-runtime twin (HANDOVER.md §6): "
                   + ", ".join(f"{k} x{v}" for k, v in sorted(hit.items())))
    if not out:
        out.append("no changed path maps to a documented component")
    return out

# ---------------------------------------------------------------- F
def check_snapshot(rows):
    """The 'Coverage snapshot' bullets (`<PREFIX>- records: N / M`) must
    equal the real master-table row count for that prefix."""
    problems = []
    actual = {}
    for cid in rows:
        actual[cid.split("-")[0]] = actual.get(cid.split("-")[0], 0) + 1
    txt = open(INDEX, encoding="utf-8").read()
    seen = set()
    for m in re.finditer(r'`([A-Z]+)-`\s*records:\s*(\d+)\s*/\s*(\d+)', txt):
        pre, n, mm = m.group(1), int(m.group(2)), int(m.group(3))
        seen.add(pre)
        a = actual.get(pre, 0)
        if not (n == mm == a):
            problems.append(f"snapshot says `{pre}-` {n} / {mm} but the master table has {a} `{pre}-` row(s)")
    for pre in ("DASH", "TAB", "JS", "GS", "SHEET", "EXT", "DATA"):
        if actual.get(pre, 0) and pre not in seen:
            problems.append(f"master table has {actual[pre]} `{pre}-` row(s) but the Coverage snapshot has no `{pre}-` line")
    return problems

# ---------------------------------------------------------------- G
# Sub-table ID uniqueness (Required Fix #7, E2E acceptance test report,
# F10/TESTS 8+10): FN-/BTN-/UI-/RULE-/EXC-/CFG-/API- sub-components
# (~460 rows at baseline) live INSIDE each owning record's own markdown
# sub-tables, not as INDEX.md master-table rows -- parse_index()'s
# len(cells) != 8 filter never sees them at all, so nothing in A-F ever
# looks at them. This does NOT close that whole gap -- catching "the
# code added a new button/exception with no matching row" needs real
# JS/.gs static analysis (a much bigger, separate undertaking, out of
# scope here) -- but a smaller, real, zero-false-positive-risk piece of
# it is buildable today: every sub-ID must be used exactly once across
# the WHOLE catalog. A duplicate (the same FN-121 appearing in two
# different records, e.g. from a bad copy-paste of a template row) is
# unambiguously wrong with no legitimate justification, exactly the
# same class of defect check A/B/C/F already catch for own-file ids.
SUBTABLE_HEADER = re.compile(
    r'^## .+ — `([A-Z]+)-XXX` sub-table\s*$', re.M)
SUBTABLE_ROW_ID = re.compile(
    r'^\|\s*(?:~~)?([A-Z]+-\d{3,4})(?:~~)?\b')

def scan_subtable_ids():
    """path -> list of (id, 1-based line number) for every sub-table row
    found in every record file under the live type-dirs + docs/_archive/
    (never docs/_templates/ -- a template's own placeholder rows aren't
    real ids)."""
    found = []
    dirs = list(TYPE_DIR.values()) + ["_archive"]
    for sub in sorted(set(dirs)):
        d = os.path.join(ROOT, "docs", sub)
        if not os.path.isdir(d):
            continue
        for fname in sorted(os.listdir(d)):
            if not fname.endswith(".md"):
                continue
            fpath = os.path.join(d, fname)
            lines = open(fpath, encoding="utf-8").read().splitlines()
            in_subtable = False
            for i, line in enumerate(lines, 1):
                if SUBTABLE_HEADER.match(line):
                    in_subtable = True
                    continue
                if in_subtable and line.startswith("## "):
                    in_subtable = False
                if not in_subtable or not line.lstrip().startswith("|"):
                    continue
                if re.match(r'^\|\s*-{2,}', line) or line.lower().startswith("| id "):
                    continue  # the table's own header/separator row
                m = SUBTABLE_ROW_ID.match(line)
                if m:
                    found.append((m.group(1), f"{sub}/{fname}:{i}"))
    return found

def check_subtable_ids(rows=None):
    hits = scan_subtable_ids()
    by_id = {}
    for cid, loc in hits:
        by_id.setdefault(cid, []).append(loc)
    out = []
    for cid in sorted(by_id):
        locs = by_id[cid]
        if len(locs) > 1:
            out.append(f"DUPLICATE {cid} in {len(locs)} sub-table rows (must be unique across the whole catalog): {', '.join(locs)}")
    # Wrapped in "(...)" like check E's own skip/no-op lines -- this is a
    # status line, not a problem, and main()'s note-count filter already
    # excludes anything starting with "(" for exactly that reason.
    by_prefix = {}
    for cid in by_id:
        by_prefix[cid.split("-")[0]] = by_prefix.get(cid.split("-")[0], 0) + 1
    if by_prefix:
        counts = ", ".join(f"{p}-: {n}" for p, n in sorted(by_prefix.items()))
        out.append(f"(scanned {len(by_id)} unique sub-table id(s) across {counts})")
    else:
        out.append("(no sub-table rows found)")
    return out

# ---------------------------------------------------------------- H
# Owner / Evidence field content (Required Fix #8, E2E acceptance test
# report, F17/TESTS 15+16): component-record-template.md's own header
# says "a BLANK field means 'not checked yet' and blocks Record Status:
# Closed + Monitored" -- but nothing anywhere ever parsed `**Owner**` or
# `## Validation`'s `**Evidence:**` line, so that rule was pure prose.
# Confirmed for real: a fully structural-correct record (JS-025) with a
# blank Owner AND a blank Evidence line AND Closed + Monitored status
# passed A/B/C/F clean. This greps for exactly the self-contradiction
# the template already names -- not general content correctness (that's
# Required Fix #1's much bigger, deliberately-not-built territory).
HTML_COMMENT = re.compile(r'<!--.*?-->', re.S)

def strip_comment(s):
    return HTML_COMMENT.sub('', s).strip()

def check_owner_evidence():
    out = []
    dirs = list(TYPE_DIR.values()) + ["_archive"]
    for sub in sorted(set(dirs)):
        d = os.path.join(ROOT, "docs", sub)
        if not os.path.isdir(d):
            continue
        for fname in sorted(os.listdir(d)):
            m = re.match(r'((?:DASH|TAB|JS|GS|SHEET|EXT|DATA|FLOW|TRIGGER)-\d{3})-.*\.md$', fname)
            if not m:
                continue
            cid = m.group(1)
            text = open(os.path.join(d, fname), encoding="utf-8").read()

            om = re.search(r'\*\*Owner\*\*\s*\|(.*?)\|', text)
            if om and not strip_comment(om.group(1)):
                out.append(f"{cid} ({sub}/{fname}): blank Owner field")

            # Record Status lives in its own row on most templates; the 4
            # EXT- records fold it into "Component / Record" instead
            # (e.g. "Active / Closed + Monitored") -- try both, in order.
            status = None
            rs = re.search(r'\*\*Record Status\*\*\s*\|(.*?)\|', text)
            if rs:
                status = strip_comment(rs.group(1))
            else:
                cr = re.search(r'\*\*Component / Record\*\*\s*\|(.*?)\|', text)
                if cr and "/" in cr.group(1):
                    status = strip_comment(cr.group(1).split("/", 1)[1])
            status_closed = bool(status) and (
                status.startswith("Closed + Monitored") or status.startswith("Validated"))

            vm = re.search(r'##\s*Validation\b.*?(?=\n##\s|\Z)', text, re.S)
            validated_status = False
            evidence_blank = True
            if vm:
                block = vm.group(0)
                sm = re.search(r'\*\*Status:\*\*\s*(.*)', block)
                if sm and strip_comment(sm.group(1)).lower().startswith("validated"):
                    validated_status = True
                em = re.search(r'\*\*Evidence:\*\*\s*(.*)', block)
                if em and strip_comment(em.group(1)):
                    evidence_blank = False

            if (status_closed or validated_status) and evidence_blank:
                out.append(f"{cid} ({sub}/{fname}): status '{status or 'Validated (## Validation)'}' but ## Validation's Evidence line is blank or absent")
    if not out:
        out.append("(no blank Owner / unevidenced Closed+Monitored or Validated status found)")
    return out

# ---------------------------------------------------------------- main
def main():
    print("=" * 60)
    print("check-catalog.py — docs/ change-control tripwires (t-tf-5ad22d8e4c2e)")
    print("=" * 60)
    rows = parse_index()
    print(f"INDEX.md master rows: {len(rows)}\n")

    fail = 0
    for label, fn in [("A. INDEX reciprocity", check_reciprocity),
                      ("B. INDEX <-> record-file coverage", check_coverage),
                      ("C. INDEX Location -> real file", check_locations),
                      ("F. Coverage snapshot self-consistency", check_snapshot)]:
        probs = fn(rows)
        if probs:
            fail += len(probs)
            print(f"{label}: {len(probs)} PROBLEM(S)")
            for p in probs:
                print(f"    - {p}")
        else:
            print(f"{label}: OK")
    print()

    for label, fn in [("D. Last-Verified drift", check_last_verified_drift),
                      ("E. change -> component-ID impact", check_impact),
                      ("G. Sub-table ID uniqueness", check_subtable_ids),
                      ("H. Owner / Evidence content", lambda r: check_owner_evidence())]:
        lines = fn(rows)
        real = [l for l in lines if not l.startswith("(") and not l.startswith("no ")]
        print(f"{label}: {len(real)} note(s)" if real else f"{label}: clean")
        for l in lines:
            print(f"    {l}")
        if STRICT and real:
            fail += len(real)
    print()

    print("=" * 60)
    if fail:
        print(f"RESULT: {fail} blocking problem(s).")
        sys.exit(1)
    print("RESULT: catalog tripwires clean.")
    sys.exit(0)

if __name__ == "__main__":
    main()
