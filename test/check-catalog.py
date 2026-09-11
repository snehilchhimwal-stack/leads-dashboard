#!/usr/bin/env python3
"""
check-catalog.py — the docs/ catalog change-control tripwires.

Built for the forensic audit's P0/P1 (t-tf-5ad22d8e4c2e; see
docs/_planning/FORENSIC_COMPLETENESS_AUDIT_2026-09-10.md §L / §M). Runs in
CI right after test/check-docs-coverage.js. Python, not Node, deliberately:
the reciprocity logic was already prototyped in Python (DOC-040), the CI
runner has python3, and it means the checks can be run and verified
locally on a machine with no Node (this repo's, as of 2026-09-04).

What it does — eight checks against docs/INDEX.md + the record files + git:

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
     with a stale record. If git's own rename detection (-M) recognizes
     the missing path as renamed to a path that still exists, the
     problem message now names that target (Required Fix #9 -- was
     silent on this, confirmed in TEST 4; still reads as delete+add,
     check A still needs the reciprocity fixed by hand either way).
  D. Last-Verified drift               (ADVISORY — never fails the build)
     a record verified at commit <sha> whose ## Location path has since
     advanced past <sha> on HEAD. Needs full git history (fetch-depth: 0).
     PLUS: any component reachable from a directly-drifted one within the
     SAME 2-hop dependency walk check E uses (E2E acceptance test report
     round 2, TEST 18 -- a component only reachable this way, never
     itself directly drifted, was invisible to update-tasks.ps1's
     -VerifyCatalogRepo guard, which only ever scanned this section's own
     text for component ids; printing the downstream set HERE closes that
     gap with no change needed to that script at all).
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
  I. Cited-literal check               (ADVISORY)
     The "lighter mitigation" for Required Fix #1 (F11/F13, P0) --
     alongside the recurring weekly doc-content spot-check task, this is
     the second, narrower, code-only answer chosen instead of the two
     heavier options (a general LLM-diffing CI step, or nothing).
     Neither one closes the P0 finding in general -- no check anywhere
     compares a record's prose to the code's actual behavior wholesale,
     and this doesn't either. What it catches is the exact, narrow shape
     TEST 11 proved: a record citing a specific ALL-CAPS code literal
     (e.g. `RAW`/`USER_ENTERED`) on the same line as a `#Lnn` anchor --
     if that literal doesn't appear anywhere in the real function body
     the anchor points into, something drifted. Misses the same test's
     OTHER false claim (restated in a Data Lineage row with no line
     anchor of its own -- nothing for a line-anchored check to resolve
     against). Heuristic brace-counting to find a function's real
     extent, so findings are worded as "verify," not "wrong."
  J. LOGIC_AUDIT.md immutability       (ADVISORY)
     (E2E acceptance test report round 2, TEST 14 -- "held by convention
     only," zero code enforcement, no fix originally proposed for it).
     LOGIC_AUDIT.md's own header says it is a dated, point-in-time record
     "not maintained forward" once closed, citing the commit its audit
     body (Parts 1-7) was finalized at. Compares the file's CURRENT
     body -- everything from the first "## Part N of M" heading onward,
     deliberately excluding the header above it -- against its content
     at that cited commit. The header-only exclusion is not a
     convenience: real, already-accepted history has two legitimate
     post-final edits (a stale-header fix, a cross-link pointer add),
     both confined to the header; a naive whole-file comparison would
     flag real, correct history as a violation. A body difference means
     the historical record itself was edited forward -- the exact thing
     the header's own words rule out.
  K. TBD retention consistency         (ADVISORY)
     (E2E acceptance test report round 2, TEST 19 -- "the 7 real TBD
     cases are genuinely honest (audited); a fabricated non-TBD value
     gets zero signal," no fix originally proposed). Scoped to retention
     specifically, not "any unknown required property" in general --
     retention is the one property with real tracking infrastructure
     already built (`docs/_planning/retention-decisions-needed.md`,
     DOC-037; `OPEN_ITEMS.md` §B is a pointer to the same file, not an
     independent source). For every `SHEET-XXX` id that file lists as
     "needing a decision," checks that id's own `docs/sheets/` record
     still says `TBD` in its `**Retention Period:**` line. A CONSISTENCY
     check, not a truth check (same limit as every other check here) --
     it can't verify a definite value is correct, only that the two
     already-real documents haven't silently drifted apart, which is
     exactly the shape "a fabricated value" or "a resolved decision that
     never got folded back per DOC-037's own documented process" takes.
  L. Sheet tab coverage                (ADVISORY)
     (E2E acceptance test report round 2, TEST 9 -- an untracked Sheet
     tab previously got zero signal). First of three slices of the same
     big item (TEST 8/9/10) -- deliberately narrower than "detect any new
     UI element or exception path": a Sheet tab name is a structural
     fact, unlike "does this button/exception deserve a sub-table row"
     (a judgment call the original forensic audit already flagged as
     needing real static analysis this project declined to build; TEST
     10, exceptions, is still NOT attempted for exactly that reason).
     Every real Sheet tab name in this codebase is declared as a
     top-level `const ..._SHEET_ = '<Name>'` / `const ..._TAB_NAME =
     '<Name>'` constant (.gs and js/*.js both, confirmed zero exceptions
     by inspection); every documented one is named in its record's own
     `**Location** | Google Sheet, tab `<Name>`` line. Flags a tab-name
     constant with no matching docs/sheets/ record.
  M. Button coverage                   (ADVISORY)
     (E2E acceptance test report round 2, TEST 8 -- second of the three
     slices). Scoped to `<button id="...">` specifically -- never a
     `.tab-btn`/checkbox/other control, same "avoid the judgment call"
     reasoning as check L. Confirmed by hand before building: 5 of 26
     real button ids are NOT cited literally in their own owning
     DASH-001/TAB-XXX record (described by a sibling element or a plain
     description instead, a real and correct choice, not a gap) -- all
     26 ARE cited in `docs/_planning/button-inventory.md`, the project's
     own declared "reconciliation record." So the search scope is that
     file plus every docs/tabs/ + docs/dashboards/ record together, not
     the owning record alone (which would have false-positived on those
     same 5 real buttons). Flags a button id with no citation anywhere in
     that combined scope.
  N. EXC- thrown-literal staleness     (ADVISORY)
     (E2E acceptance test report round 2, TEST 10 -- third and last
     slice of the same big item -- deliberately PARTIAL). Investigated
     first: unlike a button id or a Sheet tab constant, most real
     `EXC-XXX` rows describe a CONDITION ("GIS library not loaded",
     "consent denied / popup closed") with no corresponding literal
     anywhere in the code -- no structural fact to check a brand-new
     undocumented exception against, confirming the original forensic
     audit's own "needs real static analysis" call for THAT half. What
     IS checkable: the small subset of EXC- rows (2 of the whole catalog
     as of this check's own build) that cite a literal thrown string in
     a code span -- `` `throw new Error('ACCESS_DENIED')` `` -- verified
     against the owning component's real source, the same shape check I
     already proved for FN- citations. Catches STALENESS in an
     ALREADY-documented exception; does nothing for a brand-new
     exception path with no EXC- row at all -- that half of TEST 10
     stays open by design, not oversight.
  O. HANDOVER load-order staleness     (ADVISORY)
     (E2E acceptance test report round 2, TEST 13 -- the freshness signal
     was a pure calendar-date proxy; Fix #6 fixed the WORDING so it no
     longer overclaims, the mechanism itself still never cross-referenced
     content). HANDOVER.md §2's "Load order matters" paragraph makes one
     precise, checkable claim: the exact order of 14 of the 23 real
     `<script src>` tags in `dashboard.html` (the 9 `core-*.js` files are
     referenced by pointer there, not spelled out again, so they're out
     of this check's scope). Extraction is self-correcting against
     textual noise in that same paragraph (the pre-split `core.js`/
     `reports.js`, no longer real files; a parenthetical re-mention of
     `tab-repeat-offenders.js`/`main.js`) by filtering extracted names
     down to real js/ files and deduping to first occurrence. Flags a
     mismatch between the stated order and dashboard.html's real one.

Exit code: non-zero iff A, B or C fail. D, E, G, H, I, J, K, L, M, N, and O only print.
Flip D/E/G/H/I/J/K/L/M/N/O to blocking later by setting CATALOG_STRICT=1.
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
        # encoding="utf-8" explicitly -- without it, `text=True` decodes
        # with the OS's default locale encoding, which on this repo's own
        # Windows dev machine is cp1252, not UTF-8. A `git show <sha>:<path>`
        # of a file containing a real UTF-8 multi-byte character (found
        # for real building check J: LOGIC_AUDIT.md has a warning-sign
        # emoji, whose UTF-8 bytes include 0x8f, invalid under cp1252)
        # then raises UnicodeDecodeError, silently caught below and
        # returned as "" -- which looked like "no output" to every
        # caller, not a decode failure. errors="replace" as a second
        # layer of safety: a genuinely malformed byte substitutes one
        # replacement character instead of losing the whole command's
        # output.
        return subprocess.run(["git", "-C", ROOT, *args], capture_output=True,
                              text=True, encoding="utf-8", errors="replace",
                              check=False).stdout.strip()
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
_RENAME_MAP_CACHE = None

def _rename_map():
    """old_path -> newest known rename target, across all of history.
    Required Fix #9 (E2E acceptance test report, F6/TEST 4): git already
    knows when a path was renamed -- its own rename detection (-M) just
    never got read here before. Deliberately NOT `git log -- <old_path>`:
    a pathspec filter is applied by git BEFORE rename detection runs, so
    it silently degrades every rename to a plain delete (confirmed for
    real building this fix -- `git log -M -- <path>` reported plain "D",
    `git show -M` on the same commit with no pathspec correctly showed
    "R100"). Scanning the whole history's rename records once and
    caching them is both correct and cheap (~0.1s on this repo)."""
    global _RENAME_MAP_CACHE
    if _RENAME_MAP_CACHE is not None:
        return _RENAME_MAP_CACHE
    out = git("log", "--diff-filter=R", "-M", "--name-status", "--format=")
    m = {}
    # git log lists newest-first, so the FIRST time a given old_path is
    # seen is already its most recent rename -- setdefault keeps that
    # and ignores any older, unrelated rename that happened to reuse the
    # same path string further back in history.
    for line in out.splitlines():
        parts = line.split("\t")
        if len(parts) == 3 and parts[0].startswith("R"):
            m.setdefault(parts[1], parts[2])
    _RENAME_MAP_CACHE = m
    return m

def find_rename_target(old_path):
    """The most recent rename target for old_path IF that target still
    exists on disk today (a target that's ALSO since gone isn't a useful
    hint, so this stays silent rather than pointing at another dead
    end). Follows one hop only -- deliberately not chained further, to
    keep this a hint, not a full lineage reconstruction. This does not
    give a component a rename EVENT or preserve its stable ID
    automatically (check A still reads it as delete+add, exactly as
    before) -- it only makes check C's own message name the likely
    target instead of leaving "renamed?" as an open question for a
    human to re-derive by hand."""
    target = _rename_map().get(old_path)
    if target and os.path.exists(os.path.join(ROOT, target)):
        return target
    return None

def check_locations(rows):
    problems = []
    for cid, d in rows.items():
        for f in d["files"]:
            if f.endswith(".js") and "*" in f:
                continue
            if not os.path.exists(os.path.join(ROOT, f)):
                hint = ""
                target = find_rename_target(f)
                if target:
                    hint = (f" — possible rename to `{target}`; consider "
                            f"HOW_TO_RETIRE_A_COMPONENT.md's ID-preservation gap")
                problems.append(f"{cid} Location names `{f}` — not found on disk (retired/renamed/moved?){hint}")
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
    drifted = set()
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
            drifted.add(cid)
    # Downstream-of-drifted (TEST 18, E2E acceptance test report round 2):
    # a component only reachable from a genuinely drifted one via the
    # SAME 2-hop dependency walk check E uses (_impact_walk) is just as
    # unsafe to treat as settled -- its own Last-Verified sha may be
    # perfectly current, but the thing it depends on (or is depended on
    # by) has moved out from under it. Printed in THIS section (not a
    # separate one) specifically so update-tasks.ps1's -VerifyCatalogRepo
    # guard, which regex-scans this whole "D. Last-Verified drift" block
    # for component ids, picks these up automatically with no change to
    # that script needed -- confirmed for real: a task-close citing only
    # GS-010 (downstream of a directly-drifted JS-016) went through
    # unblocked before this; blocked after.
    if drifted:
        impact, _arch_hits = _impact_walk(rows, drifted)
        downstream = sorted(impact - drifted)
        if downstream:
            warns.append(f"downstream of drifted (revalidate the drifted id(s) above before treating "
                         f"any of these as settled — {', '.join(sorted(drifted))} reach them within "
                         f"2 hops): {downstream}")
    return warns

# 2-hop impact walk + architecture-overlay surfacing, factored out of
# check_impact (Required Fix #4/#5, E2E acceptance test report) so
# check_last_verified_drift can seed it directly from a set of DRIFTED
# component ids (no git diff range needed) as well as check_impact
# seeding it from a diff's changed-paths (Required Fix, TEST 18, E2E
# acceptance test report round 2 -- a component only reachable via this
# walk, never itself directly drifted, was invisible to
# update-tasks.ps1's -VerifyCatalogRepo guard; confirmed for real that a
# task-close citing GS-010, downstream of a genuinely-drifted JS-016,
# went through unblocked).
def _impact_walk(rows, seed):
    # This used to stop at exactly 1 hop, confirmed broken for real in
    # TEST 23: a real production cascade (a UI write -> a Sheet -> the
    # SEPARATE, unattended Apps Script system that reads that Sheet) lost
    # coverage past the first link, e.g. a change to JS-016 never
    # surfaced GS-010 even though JS-016 -> SHEET-004 -> GS-010 is a
    # real, reciprocal dependency chain. The graph is small (~72 rows) so
    # a 2nd hop costs nothing measurable. A plain set (impact,
    # monotonically growing, only ever expanded by NEW ids not already in
    # it) is its own cycle guard -- the walk always terminates in at most
    # `rows` iterations, and here it's capped at 2 explicitly by design,
    # not by need.
    impact = set(seed)
    frontier = set(seed)
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
    # Architecture-overlay surfacing: check A deliberately does NOT
    # require a FLOW-/TRIGGER- row's own Depends On to be echoed back in
    # a member's Used By (the "kind: arch" exemption in
    # check_reciprocity -- an overlay describing many components isn't
    # itself something every one of them should have to list). But that
    # same exemption meant this impact walk, which only ever follows real
    # reciprocal edges, could never walk BACK to the overlay describing a
    # changed component -- confirmed for real in TEST 12: a GS-010 change
    # never surfaced FLOW-002 ("The 3-phase 'Generate region emails'
    # cycle"), even though FLOW-002's own Depends On names GS-010
    # directly. Scanned independently of the reciprocity graph, against
    # the full impact set found so far (not just the seed ids): any arch
    # overlay naming a touched component in its own Depends On is
    # relevant context for whoever reviews this change.
    arch_hits = sorted(cid for cid, d in rows.items()
                        if d["kind"] == "arch" and (d["dep"] & impact))
    impact |= set(arch_hits)
    return impact, arch_hits

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
    impact, arch_hits = _impact_walk(rows, affected)
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
                # [ \t]*, NOT \s* -- \s matches a newline too, so on a
                # genuinely BLANK field (nothing after the colon but the
                # line break) \s* silently skips past it and the leading
                # "- " of the NEXT bullet, and (.*) then captures THAT
                # line's text instead of recognizing this field as blank.
                # Real bug, found retesting Fix #8 (E2E acceptance test,
                # round 2): a record whose real field order is
                # Evidence-then-Status (the actual template order) with a
                # truly empty Evidence line read as "evidenced" here,
                # because the match slid onto the Status line beneath it.
                sm = re.search(r'\*\*Status:\*\*[ \t]*(.*)', block)
                if sm and strip_comment(sm.group(1)).lower().startswith("validated"):
                    validated_status = True
                em = re.search(r'\*\*Evidence:\*\*[ \t]*(.*)', block)
                if em and strip_comment(em.group(1)):
                    evidence_blank = False

            if (status_closed or validated_status) and evidence_blank:
                out.append(f"{cid} ({sub}/{fname}): status '{status or 'Validated (## Validation)'}' but ## Validation's Evidence line is blank or absent")
    if not out:
        out.append("(no blank Owner / unevidenced Closed+Monitored or Validated status found)")
    return out

# ---------------------------------------------------------------- I
# Cited-literal check (the "lighter mitigation," alongside the recurring
# weekly doc-content spot-check task -- both are partial answers to
# Required Fix #1 / F11+F13, the P0 finding this project chose NOT to
# build the heavy fix for: no general content-comparison mechanism
# exists, and still doesn't after this. What this DOES catch: the exact,
# narrow, proven shape of TEST 11's failure -- a record citing a
# specific code LITERAL (an ALL-CAPS constant like `RAW`/`USER_ENTERED`)
# next to a `#Lnn` line anchor on the same line. If that literal doesn't
# appear anywhere in the real function body the anchor points into,
# something has drifted -- either the citation or the code. It does NOT
# catch TEST 11's OTHER false claim (the same lie, restated in the
# "Data lineage" table row, which cites the FN- id instead of its own
# line number -- no anchor on that row, nothing for this check to
# resolve against). Advisory only, and deliberately worded as "verify"
# rather than "wrong" -- a heuristic text/line match can have a
# legitimate miss (the literal genuinely lives just outside the found
# function boundary, or the citation covers a family of near-identical
# functions and only some use that literal).
#
# NARROWED AFTER REAL TESTING (2026-09-11): the first version flagged 27
# "mismatches" on a catalog independently verified clean, every one a
# false positive from the same root cause -- an FN- sub-table row's
# other columns ("Inputs", "Calls") routinely name a constant BY
# REFERENCE (what it depends on, or the range of values a parameter
# accepts), not as literal text expected inside the function body
# itself; e.g. `RAW`/`USER_ENTERED` in an "Inputs" cell describes what
# a `valueInputOption` PARAMETER may be called with, and genuinely never
# appears as bare text in a generic helper that just forwards it.
# Confirmed for real: FN-122's `appendSheetRows` cites `RAW` in its
# Inputs cell but never contains that string -- the CALLERS (like
# FN-128) do. A "Calls" cell naming a cross-runtime twin compounds it
# (e.g. "**twin `HEADER_ALIASES_` on the backend**" -- real, correct,
# and never appears in the file being checked at all, since it lives in
# a DIFFERENT file by definition). Narrowed to the one pattern that
# reliably distinguishes "this literal is the code's actual behavior at
# this line" from those: **bold** emphasis (the style this catalog uses
# for "this is the real side effect," confirmed against FN-128's own
# "Sheets write, **`RAW` value-input**") AND not on a line naming
# another file in backticks nearby (a `twin`/cross-runtime mention) AND
# not preceded by "twin" specifically, since that one phrase alone
# accounted for the one bold false positive found.
CITED_LITERAL = re.compile(r'\*\*([^*`]{0,20})?`([A-Z][A-Z0-9_]{1,30})`(\()?')
OTHER_FILE_MENTION = re.compile(r'`[A-Za-z0-9_.-]+\.(?:gs|js)`')
CROSS_REF_WORDS = ("twin", "mirror")  # "twin"/"mirrors"/"mirrored" -- this
# catalog's two words for "the cross-runtime sibling of this constant,
# named here for context, defined in that OTHER file/component"
LINE_COMMENT = re.compile(r'(?<!:)//.*$')  # a real `// comment`, not the
# `//` inside a URL's `https://` (the one lookbehind this codebase's own
# comment style actually needs -- confirmed against real source)

def strip_line_comment(line):
    """Real, live false-negative found testing this check (2026-09-11):
    js/sheets-writeback.js:360-361 has an explanatory comment reading
    "RAW, not the default USER_ENTERED -- ... USER_ENTERED is exactly
    what silently [caused a real past bug]" a few lines above the
    function's own real, correct 'RAW' usage. A bare-word match without
    this strip finds "USER_ENTERED" mentioned in that comment and
    reports the function as containing it -- true, but for exactly the
    wrong reason (explaining what NOT to use), so a record that had been
    changed to falsely claim USER_ENTERED went uncaught on the first
    real test of this fixture. Stripping `//` comments before matching
    fixes it without weakening the real match: the true positive ('RAW'
    on an actual `sheetsApiValuesBatchUpdate(..., 'RAW')` call) is
    real code, never inside a comment, so it's untouched."""
    return LINE_COMMENT.sub('', line)
LINE_ANCHOR = re.compile(r'#L(\d+)')
COMPONENT_ID_FULL = re.compile(r'^(?:DASH|TAB|JS|GS|SHEET|EXT|DATA|FLOW|TRIGGER)-\d{3,4}$')

def function_body_lines(src_lines, start_line_1indexed, cap=200):
    """The real extent of the function/block starting at or after
    start_line (1-indexed), found by brace-depth from the first '{' at
    or after that line to the matching '}' -- a naive count (doesn't
    understand strings/comments/regex literals, so a stray brace inside
    one of those can throw it off in principle); good enough for an
    advisory heuristic on this codebase's consistent style, capped at
    `cap` lines so a pathological miscount can't scan the whole file."""
    n = len(src_lines)
    i = start_line_1indexed - 1
    if i < 0 or i >= n:
        return []
    depth = 0
    started = False
    end = min(n, i + cap)
    for j in range(i, end):
        depth += src_lines[j].count("{") - src_lines[j].count("}")
        if src_lines[j].count("{"):
            started = True
        if started and depth <= 0:
            return src_lines[i:j + 1]
    return src_lines[i:end]

def check_cited_literals(rows):
    out = []
    checked = 0
    dirs = list(TYPE_DIR.values())  # not _archive/ -- a retired record's
    # cited lines describe code that's gone by definition; nothing to
    # check a retired citation against.
    for sub in sorted(set(dirs)):
        d = os.path.join(ROOT, "docs", sub)
        if not os.path.isdir(d):
            continue
        for fname in sorted(os.listdir(d)):
            m = re.match(r'((?:DASH|TAB|JS|GS|SHEET|EXT|DATA|FLOW|TRIGGER)-\d{3})-.*\.md$', fname)
            if not m:
                continue
            cid = m.group(1)
            if cid not in rows:
                continue
            real_files = [f for f in rows[cid]["files"] if "*" not in f]
            if len(real_files) != 1:
                continue  # only handle the common, unambiguous one-file case
            src_path = os.path.join(ROOT, real_files[0])
            if not os.path.exists(src_path):
                continue  # check C already reports this; don't double up
            src_lines = None  # lazy-load, only if this record has a hit
            record_lines = open(os.path.join(d, fname), encoding="utf-8").read().splitlines()
            for line in record_lines:
                anchors = LINE_ANCHOR.findall(line)
                if not anchors:
                    continue
                literals = []
                for lm in CITED_LITERAL.finditer(line):
                    prefix, tok, call_paren = lm.group(1) or "", lm.group(2), lm.group(3)
                    if call_paren or COMPONENT_ID_FULL.match(tok) or tok.startswith("L"):
                        continue
                    before = line[:lm.start()]
                    after = line[lm.end():lm.end() + 25]
                    # A cross-reference word ("twin"/"mirror...") can sit
                    # inside the bold span itself ("**twin `X` on the
                    # backend**") or just before it ("the twin **`X`**");
                    # a component ID named right after the token
                    # ("`X` (`GS-003`)") is the same signal without
                    # needing the word -- either way, X names a
                    # DIFFERENT file/component's constant by definition.
                    ctx = (prefix + " " + before[-15:]).lower()
                    if any(w in ctx for w in CROSS_REF_WORDS):
                        continue
                    after_id = re.match(r'\s*\(?`?([A-Z]+-\d{3,4})', after)
                    if after_id and COMPONENT_ID_FULL.match(after_id.group(1)):
                        continue  # e.g. "...`RM_PERF_NON_RM_ROLES`'s top-3 (`JS-008` CFG-020)" -- names a different component right after
                    if OTHER_FILE_MENTION.search(line):
                        continue  # a filename is named on this same line -- too likely describing that file's own content, not this one's
                    literals.append(tok)
                if not literals:
                    continue
                if src_lines is None:
                    src_lines = open(src_path, encoding="utf-8").read().splitlines()
                for tok in literals:
                    checked += 1
                    found = False
                    for ln in anchors:
                        body = function_body_lines(src_lines, int(ln))
                        code_only = [strip_line_comment(bl) for bl in body]
                        if any(re.search(rf'\b{re.escape(tok)}\b', bl) for bl in code_only):
                            found = True
                            break
                    if not found:
                        out.append(f"{cid} ({sub}/{fname}): cites `{tok}` near {'/'.join('#L'+a for a in anchors)} "
                                    f"but `{tok}` doesn't appear in that function body in {real_files[0]} — verify")
    if not out:
        out.append(f"(checked {checked} cited literal(s) against their line-anchored function bodies, no mismatch found)")
    return out

# ---------------------------------------------------------------- J
LOGIC_AUDIT_PATH = os.path.join(ROOT, "LOGIC_AUDIT.md")
# The real, already-accepted commit history has TWO legitimate post-final
# edits to this file (99170a8, 14ef03f) -- both confined to the header
# block (cross-link pointers, a stale-header fix), never the Part 1-7
# body itself. A naive "any commit touched this file since <final sha>"
# check would false-positive on that real history. This compares ONLY
# the body (from the first "## Part N of M" heading onward) against its
# content at the cited final commit -- the header stays editable (as it
# already legitimately has been), the actual audit findings do not.
LOGIC_AUDIT_BODY_START = re.compile(r'^## Part \d+ of \d+', re.M)

def check_logic_audit_immutability():
    if not os.path.exists(LOGIC_AUDIT_PATH):
        return ["(LOGIC_AUDIT.md not found — nothing to check)"]
    have_history = git("rev-list", "--count", "HEAD") not in ("", "1")
    if not have_history:
        return ["(skipped — shallow clone; set fetch-depth: 0 on actions/checkout)"]
    text = open(LOGIC_AUDIT_PATH, encoding="utf-8").read()
    m = re.search(r'final assembled report `([0-9a-f]{7,40})`', text)
    if not m:
        return ["(no \"final assembled report `<sha>`\" citation found in LOGIC_AUDIT.md's "
                "own header — cannot verify immutability; update the citation or this check)"]
    sha = m.group(1)
    if git("cat-file", "-t", sha) != "commit":
        return [f"(the cited final commit {sha} is not in history — cannot verify immutability)"]
    bm = LOGIC_AUDIT_BODY_START.search(text)
    if not bm:
        return ["(could not locate the audit body's start marker (\"## Part N of M\") — verify manually)"]
    # .rstrip() both sides -- git()'s own .strip() on the historical
    # side (shared by every caller, not worth special-casing here)
    # already drops a trailing newline the on-disk file still has;
    # rstripping BOTH avoids reporting that as a body difference
    # (confirmed for real: a fresh diff of the two bodies via difflib
    # showed zero real line differences, only a 1-character length gap
    # from exactly this).
    current_body = text[bm.start():].rstrip()
    historical_text = git("show", f"{sha}:LOGIC_AUDIT.md")
    hbm = LOGIC_AUDIT_BODY_START.search(historical_text)
    if not hbm:
        return [f"(could not locate the audit body's start marker in the {sha} version — verify manually)"]
    historical_body = historical_text[hbm.start():].rstrip()
    if current_body != historical_body:
        moved = git("log", "--oneline", f"{sha}..HEAD", "--", "LOGIC_AUDIT.md")
        commits = moved.splitlines() if moved else []
        return [f"LOGIC_AUDIT.md's audit body (from \"## Part N of M\" onward) differs from its "
                f"content at the cited final commit {sha} — this file's own header says it is "
                f"'not maintained forward'; a header/cross-link edit is fine (confirmed legitimate "
                f"precedent: {', '.join(c.split()[0] for c in commits) if commits else 'see git log'}), "
                f"but a BODY change means the historical record was edited forward — verify this was "
                f"intentional and update the header's cited commit if the audit was deliberately reopened"]
    return ["(audit body unchanged since the cited final commit — header/cross-link edits only, as expected)"]

# ---------------------------------------------------------------- K
RETENTION_DECISIONS_PATH = os.path.join(ROOT, "docs", "_planning", "retention-decisions-needed.md")
RETENTION_NEEDED_HEADER = re.compile(r'^### \d+\.\s*`[^`]+`\s*—\s*`(SHEET-\d{3})`', re.M)

# TEST 19, E2E acceptance test report round 2: "the 7 real TBD cases are
# genuinely honest (audited); a fabricated non-TBD value gets zero
# signal." Scoped to retention specifically (not "any unknown required
# property" in general) -- retention is the one property with real,
# already-built tracking infrastructure (DOC-037's
# retention-decisions-needed.md; OPEN_ITEMS.md §B is a pointer to the
# same file, not an independent source). Checks CONSISTENCY between the
# two already-real documents, not "is this retention value actually
# true" (unknowable by code, same reasoning as every other check here
# that stops at structural correctness) -- if a tab retention-decisions-
# needed.md still lists as needing a decision no longer says TBD in its
# own record, either the decision was resolved but DOC-037's own
# documented process (fold it back into retention-decisions-needed.md)
# wasn't followed, or a value was invented without going through a real
# decision at all -- either way, worth a human look.
def check_tbd_retention_consistency():
    if not os.path.exists(RETENTION_DECISIONS_PATH):
        return ["(docs/_planning/retention-decisions-needed.md not found — nothing to check)"]
    needed_text = open(RETENTION_DECISIONS_PATH, encoding="utf-8").read()
    needed_ids = RETENTION_NEEDED_HEADER.findall(needed_text)
    if not needed_ids:
        return ["(no \"### N. `<name>` — `SHEET-XXX`\" entries found in "
                "retention-decisions-needed.md — nothing to check)"]
    out = []
    for sid in needed_ids:
        rp = record_path(sid)
        if not rp:
            out.append(f"{sid}: listed in retention-decisions-needed.md but has no docs/sheets/ record file")
            continue
        text = open(rp, encoding="utf-8").read()
        # [ \t]*, NOT \s* -- same cross-line-capture bug check H's
        # Evidence/Status regex had (fixed in check-catalog.py commit
        # 74107f7); same-line whitespace only.
        rm = re.search(r'\*\*Retention Period:\*\*[ \t]*(.*)', text)
        if not rm:
            out.append(f"{sid}: no '**Retention Period:**' line found in its record — cannot verify")
            continue
        if "TBD" not in rm.group(1):
            out.append(f"{sid}: retention-decisions-needed.md still lists this as needing a decision, but "
                       f"its record's Retention Period no longer says TBD (\"{rm.group(1).strip()[:80]}\") "
                       f"— either fold the resolved decision back into retention-decisions-needed.md's "
                       f"'Decisions already made' table (DOC-037's own documented process), or verify this "
                       f"wasn't invented without a real decision")
    if not out:
        out.append(f"(all {len(needed_ids)} tab(s) retention-decisions-needed.md lists as needing a decision "
                   f"still honestly say TBD in their own record)")
    return out

# ---------------------------------------------------------------- L
# TEST 9, E2E acceptance test report round 2: an untracked Sheet tab (new
# tab added, renamed, or removed) previously got zero signal -- BTN-/UI-/
# EXC- sub-components were already known to be outside check B's file-
# level scope (F10), but a whole new SHEET tab is arguably worse, since
# check B's own coverage never claimed to reach sub-table content in the
# first place. Deliberately narrower than "detect any new UI element or
# exception path" (round-2 retest scoping discussion, TEST 8/10 are NOT
# attempted here -- unlike a Sheet tab name, "does this button/exception
# deserve its own sub-table row" is a judgment call, not a structural
# fact, and the original forensic audit already flagged that class of
# detection as needing real static analysis this project declined to
# build). A Sheet tab name IS a structural fact: every real one in this
# codebase is declared as a top-level `const ..._SHEET_ = '<Name>'` /
# `const ..._TAB_NAME = '<Name>'` constant (confirmed by inspection —
# zero exceptions across 19 real call sites, .gs and js/*.js both), and
# every documented one is declared in its record's own
# `**Location** | Google Sheet, tab `<Name>`` line -- both narrow,
# reliable, grep-able patterns, unlike "which buttons matter."
SHEET_TAB_CONST = re.compile(r"const [A-Za-z_]*(?:SHEET|TAB_NAME)[A-Za-z_]* = '([A-Za-z_]+)'")
SHEET_RECORD_TAB = re.compile(r"\*\*Location\*\*\s*\|\s*Google Sheet, tab `([A-Za-z_]+)`")

def _gs_and_js_files():
    for fname in sorted(os.listdir(ROOT)):
        if fname.endswith(".gs"):
            yield fname
    js_dir = os.path.join(ROOT, "js")
    if os.path.isdir(js_dir):
        for fname in sorted(os.listdir(js_dir)):
            if fname.endswith(".js"):
                yield os.path.join("js", fname)

def check_sheet_tab_coverage():
    referenced = {}  # tab name -> (path, line number) of its first const declaration
    for rel in _gs_and_js_files():
        path = os.path.join(ROOT, rel)
        for i, line in enumerate(open(path, encoding="utf-8"), 1):
            m = SHEET_TAB_CONST.search(line)
            if m:
                referenced.setdefault(m.group(1), (rel, i))
    declared = set()
    sheets_dir = os.path.join(ROOT, "docs", "sheets")
    if os.path.isdir(sheets_dir):
        for fname in sorted(os.listdir(sheets_dir)):
            if not fname.endswith(".md"):
                continue
            text = open(os.path.join(sheets_dir, fname), encoding="utf-8").read()
            declared |= set(SHEET_RECORD_TAB.findall(text))
    out = []
    for tab, (rel, ln) in sorted(referenced.items()):
        if tab not in declared:
            out.append(f"untracked Sheet tab: '{tab}' referenced in {rel}:{ln} "
                       f"but no docs/sheets/ record declares it")
    if not out:
        out.append(f"({len(referenced)} Sheet tab name(s) referenced in code, "
                   f"all declared in a docs/sheets/ record)")
    return out

# ---------------------------------------------------------------- M
# TEST 8, E2E acceptance test report round 2, second slice of the same
# big item check L started. Scoped to `<button id="...">` specifically
# (never a `.tab-btn`/checkbox/other control -- those need a judgment
# call about what counts as a documentable UI action, the exact overreach
# this whole slice deliberately avoids, same reasoning as check L's own
# Sheet-tab-only scope). A button id is a structural fact: it either
# appears literally in `dashboard.html` or it doesn't.
#
# Where to check for it is NOT as clean as check L's single Location
# line, though -- confirmed by hand before writing this: 5 of the 26 real
# ids (gateSignInBtn, refreshBtn, changeSourceBtn, clearFiltersBtn,
# downloadLeadIdsBtn) are NOT cited literally in DASH-001's own "Top-level
# buttons / actions" table, which describes some of them by a sibling
# element or a description instead ("`#authGate` button", "`#sheetIdInput`
# + fetch button") -- a real, human-readable choice, not a gap. All 26 ARE
# cited literally in `docs/_planning/button-inventory.md`, which its own
# header calls "the reconciliation record" -- built specifically to be
# the canonical, complete map (`DOC-009`/`DOC-031`). So the search scope
# is that file PLUS every `docs/tabs/`/`docs/dashboards/` record, not
# just the owning TAB-XXX/DASH-001 record alone -- requiring the id to
# appear in ITS OWN specific record would have false-positived on those
# same 5 real, already-correct buttons.
BUTTON_ID = re.compile(r'<button[^>]*\bid="([A-Za-z0-9_]+)"')

def check_button_coverage():
    html_path = os.path.join(ROOT, "dashboard.html")
    if not os.path.exists(html_path):
        return ["(dashboard.html not found — nothing to check)"]
    referenced = {}  # button id -> (path, line number) of its first occurrence
    html_lines = open(html_path, encoding="utf-8").read().splitlines()
    for i, line in enumerate(html_lines, 1):
        for m in BUTTON_ID.finditer(line):
            referenced.setdefault(m.group(1), ("dashboard.html", i))
    for rel in _gs_and_js_files():
        if not rel.endswith(".js"):
            continue
        path = os.path.join(ROOT, rel)
        for i, line in enumerate(open(path, encoding="utf-8"), 1):
            for m in BUTTON_ID.finditer(line):
                referenced.setdefault(m.group(1), (rel, i))
    doc_paths = [os.path.join(ROOT, "docs", "_planning", "button-inventory.md")]
    for sub in ("tabs", "dashboards"):
        d = os.path.join(ROOT, "docs", sub)
        if os.path.isdir(d):
            doc_paths += [os.path.join(d, f) for f in sorted(os.listdir(d)) if f.endswith(".md")]
    docs_text = ""
    for p in doc_paths:
        if os.path.exists(p):
            docs_text += open(p, encoding="utf-8").read()
    out = []
    for bid, (rel, ln) in sorted(referenced.items()):
        if bid not in docs_text:
            out.append(f"untracked button: id \"{bid}\" ({rel}:{ln}) doesn't appear in "
                       f"docs/_planning/button-inventory.md or any docs/tabs/ or docs/dashboards/ record")
    if not out:
        out.append(f"({len(referenced)} button id(s) found, all cited somewhere in "
                   f"button-inventory.md or a tabs/dashboards record)")
    return out

# ---------------------------------------------------------------- N
# TEST 10, E2E acceptance test report round 2, third and last slice of
# the big item -- deliberately PARTIAL, not full coverage. Investigated
# first, same discipline as the other two slices: unlike a button id or a
# Sheet tab constant, most real `EXC-XXX` rows describe a CONDITION
# ("GIS library not loaded", "consent denied / popup closed") with no
# corresponding literal anywhere in the code at all -- there is no
# structural fact to check a brand-new undocumented exception against,
# which is exactly why the original forensic audit called this "real
# static analysis, out of scope." What IS real and checkable: a SMALL
# subset of EXC- rows (2 of the whole catalog, confirmed by grep before
# writing this) cite a literal thrown string inside a code span --
# `` `throw new Error('ACCESS_DENIED')` `` -- and that string can be
# checked against the owning component's real source, the same shape
# check I already proved out for FN- citations. This catches STALENESS
# in an ALREADY-documented exception (the literal changed or the throw
# was removed, but the row wasn't updated) -- it does nothing for a
# brand-new exception path with no EXC- row at all; that half of TEST 10
# remains open by design, not by oversight.
EXC_THROWN_LITERAL = re.compile(r"`throw new Error\('([A-Z_][A-Z0-9_]*)'\)`")

def check_exc_thrown_literal_staleness(rows):
    out = []
    checked = 0
    for sub in sorted(set(TYPE_DIR.values())):
        d = os.path.join(ROOT, "docs", sub)
        if not os.path.isdir(d):
            continue
        for fname in sorted(os.listdir(d)):
            m = re.match(r'((?:DASH|TAB|JS|GS|SHEET|EXT|DATA|FLOW|TRIGGER)-\d{3})-.*\.md$', fname)
            if not m:
                continue
            cid = m.group(1)
            if cid not in rows:
                continue
            real_files = [f for f in rows[cid]["files"] if "*" not in f]
            record_text = open(os.path.join(d, fname), encoding="utf-8").read()
            literals = set(EXC_THROWN_LITERAL.findall(record_text))
            if not literals:
                continue
            src_text = ""
            for rf in real_files:
                src_path = os.path.join(ROOT, rf)
                if os.path.exists(src_path):
                    src_text += open(src_path, encoding="utf-8").read()
            for lit in sorted(literals):
                checked += 1
                if f"'{lit}'" not in src_text and f'"{lit}"' not in src_text:
                    out.append(f"{cid} ({sub}/{fname}): cites `throw new Error('{lit}')` "
                               f"but '{lit}' doesn't appear anywhere in {', '.join(real_files) or '(no real Location file)'} — verify")
    if not out:
        out.append(f"(checked {checked} EXC- thrown-literal citation(s) against their owning "
                   f"component's source, no staleness found)")
    return out

# ---------------------------------------------------------------- O
# TEST 13, E2E acceptance test report round 2: HANDOVER.md's staleness
# signal was a pure calendar-date proxy (Fix #6 fixed the WORDING so it
# no longer overclaims correctness, but the mechanism itself never
# cross-referenced content). Investigated for a real structural angle
# before building anything, same discipline as the other slices:
# HANDOVER.md §2's "Load order matters" paragraph makes one precise,
# checkable claim -- the exact order of 14 of the 23 real `<script src>`
# tags in dashboard.html (the 9 `core-*.js` files are referenced by
# pointer, "in the order listed above," not spelled out again in THIS
# paragraph, so they're out of THIS check's scope). Confirmed by hand:
# the stated order currently matches dashboard.html's real tag order
# exactly, 14/14. Extraction is self-correcting against textual noise --
# the paragraph also mentions the pre-split `core.js`/`reports.js` (no
# longer real files) and re-mentions `tab-repeat-offenders.js`/`main.js`
# in a parenthetical aside -- filtering the extracted names down to only
# ones that exist as real js/ files, then deduping to first occurrence,
# reconstructs the intended 14-file sequence cleanly regardless.
HANDOVER_LOAD_ORDER_PARA = re.compile(r'\*\*Load order matters\*\*.*?(?=\n\n|\Z)', re.S)
HANDOVER_JS_CITE = re.compile(r'`([a-z][a-z0-9_-]*\.js)`')
SCRIPT_TAG = re.compile(r'<script src="js/([a-z][a-z0-9_-]*\.js)"')

def check_handover_load_order():
    handover_path = os.path.join(ROOT, "HANDOVER.md")
    html_path = os.path.join(ROOT, "dashboard.html")
    if not os.path.exists(handover_path) or not os.path.exists(html_path):
        return ["(HANDOVER.md or dashboard.html not found — nothing to check)"]
    text = open(handover_path, encoding="utf-8").read()
    pm = HANDOVER_LOAD_ORDER_PARA.search(text)
    if not pm:
        return ["(no \"**Load order matters**\" paragraph found in HANDOVER.md — verify manually)"]
    stated = []
    seen = set()
    for name in HANDOVER_JS_CITE.findall(pm.group(0)):
        if name in seen or not os.path.exists(os.path.join(ROOT, "js", name)):
            continue
        seen.add(name)
        stated.append(name)
    if not stated:
        return ["(no real js/*.js filenames found in HANDOVER.md's load-order paragraph — verify manually)"]
    real_tags = SCRIPT_TAG.findall(open(html_path, encoding="utf-8").read())
    real_subset = [t for t in real_tags if t in seen]
    if stated != real_subset:
        return [f"HANDOVER.md §2's stated script load order doesn't match dashboard.html's real "
                f"<script src> order — stated: {stated}; real (same subset): {real_subset}"]
    return [f"(HANDOVER.md §2's stated load order for {len(stated)} of dashboard.html's real "
            f"<script src> files matches reality)"]

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
                      ("H. Owner / Evidence content", lambda r: check_owner_evidence()),
                      ("I. Cited-literal check", check_cited_literals),
                      ("J. LOGIC_AUDIT.md immutability", lambda r: check_logic_audit_immutability()),
                      ("K. TBD retention consistency", lambda r: check_tbd_retention_consistency()),
                      ("L. Sheet tab coverage", lambda r: check_sheet_tab_coverage()),
                      ("M. Button coverage", lambda r: check_button_coverage()),
                      ("N. EXC- thrown-literal staleness", check_exc_thrown_literal_staleness),
                      ("O. HANDOVER load-order staleness", lambda r: check_handover_load_order())]:
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
