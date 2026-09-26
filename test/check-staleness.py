#!/usr/bin/env python3
"""
check-staleness.py -- one command that reports what in this repo is ALREADY
stale and what is ABOUT TO turn stale, and (optionally) fixes the mechanical
part. Advisory: always exits 0 unless --strict.

    python3 test/check-staleness.py                report only
    python3 test/check-staleness.py --fix-anchors  rewrite drifted #Lnn anchors in docs/ records
    python3 test/check-staleness.py --write        regenerate the AUTO block in docs/STALENESS_TRACKER.md
    python3 test/check-staleness.py --strict       exit 1 if anything is STALE (not AT-RISK)

Run by the recurring "[Stale Sweep]" To-Do Dashboard tasks (1st / 11th / 21st
of the month -- the Opp Monitor cadence). The curated inputs (watch register,
Apps Script deploy register) live in docs/STALENESS_TRACKER.md; this script
reads them and computes everything else from git + the source files.

Detectors (each one exists because a real incident of that class happened):
  A  line-anchor drift        a record's `#Lnn` no longer points at that function
  B  record drift / age       source moved since Last Verified (DRIFTED), or the
                              record is older than its TTL (OVERDUE / DUE-SOON);
                              hot files (>=3 commits/14d) get a shorter TTL
  C  stated-fact claims       a number/order stated in CLAUDE.md/HANDOVER.md no
                              longer matches reality (FACT_CLAIMS below -- add a
                              claim here every time a new stale fact is found)
  D  Apps Script deploy       a .gs commit newer than the last CONFIRMED paste
                              into the live editor (git does not deploy)
  E  watch register           time-based items nothing else would notice
  F  uncommitted code         a code file modified with no matching record edit
  G  HANDOVER.md lag          code commits / days since HANDOVER.md last changed
  H  raw control characters   a .gs source holding a raw NUL etc. -- pasting it into
                              the Apps Script editor silently changes it (real
                              incident: MovementTracker.gs, hash-separator NUL -> space)

Companion: test/match-live-gs.py reads what is REALLY live (hashes taken from the
editor in Chrome) and refreshes the deploy register that detector D compares against.
"""
import os, re, sys, subprocess, datetime, importlib.util

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
TRACKER = os.path.join(ROOT, "docs", "STALENESS_TRACKER.md")
AUTO_BEGIN, AUTO_END = "<!-- AUTO:BEGIN -->", "<!-- AUTO:END -->"

TTL_DAYS = 30          # a record not re-verified for this long is OVERDUE
TTL_HOT_DAYS = 14      # ...for a file with HOT_COMMITS+ commits in HOT_WINDOW days
HOT_COMMITS, HOT_WINDOW = 3, 14
HORIZON_DAYS = 10      # "about to turn stale" = within one sweep interval
HANDOVER_SOON = (8, 14)     # code commits / days since HANDOVER.md changed -> DUE-SOON
HANDOVER_OVERDUE = (15, 30)  # -> OVERDUE


def _load_catalog():
    spec = importlib.util.spec_from_file_location("check_catalog", os.path.join(HERE, "check-catalog.py"))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


CC = _load_catalog()
git = CC.git


def today_ist():
    # CLAUDE.md: never trust the machine's local timezone -- pin to IST explicitly.
    return (datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(hours=5, minutes=30)).date()


def read(path):
    with open(path, encoding="utf-8") as f:
        return f.read()


def parse_date(s):
    m = re.search(r'(\d{4})-(\d{2})-(\d{2})', s or "")
    return datetime.date(int(m.group(1)), int(m.group(2)), int(m.group(3))) if m else None


def md_table(text, heading):
    """Rows (list of dict) of the first pipe table under `## heading`."""
    m = re.search(r'^## ' + re.escape(heading) + r'.*?$(.*?)(?=^## |\Z)', text, re.S | re.M)
    if not m:
        return []
    rows, header = [], None
    for line in m.group(1).splitlines():
        if not line.lstrip().startswith("|"):
            continue
        cells = [c.strip() for c in line.strip().strip("|").split("|")]
        if header is None:
            header = cells
        elif not all(re.fullmatch(r':?-{2,}:?', c) for c in cells):
            rows.append(dict(zip(header, cells)))
    return rows


# ------------------------------------------------------------------ A: anchors
NAME_TOKEN = re.compile(r'`([A-Za-z_$][\w$]*)(?:\([^`]*\))?`')
ANCHOR_TOKEN = re.compile(r'#L(\d+)')
SUBROW = re.compile(r'^\| ((?:FN|CFG)-\d{3}) \|([^|]*)\|')


def decl_lines(name, lines, kind):
    n = re.escape(name)
    if kind == "FN":
        pats = [r'^\s*(?:export\s+)?(?:async\s+)?function\s+' + n + r'\s*\(',
                r'^\s*(?:const|let|var)\s+' + n + r'\s*=\s*(?:async\s*)?(?:function\b|\([^)]*\)\s*=>|[A-Za-z_]\w*\s*=>)',
                r'^\s*' + n + r'\s*=\s*function\s*\(']
    else:
        pats = [r'^\s*(?:export\s+)?(?:const|let|var)\s+' + n + r'\b']
    rx = [re.compile(p) for p in pats]
    return [i + 1 for i, l in enumerate(lines) if any(r.search(l) for r in rx)]


def scan_anchors(rows):
    """-> (findings, stats). finding = dict(path,lineno,cid,sub,name,old,new|None,note)"""
    findings, stats = [], dict(checked=0, ok=0, unpairable=0, missing=0)
    for cid, d in rows.items():
        real = [f for f in d["files"] if "*" not in f]
        rp = CC.record_path(cid)
        if len(real) != 1 or not rp:
            continue
        src_path = os.path.join(ROOT, real[0])
        if not os.path.exists(src_path):
            continue
        src = read(src_path).splitlines()
        for i, line in enumerate(read(rp).splitlines(), 1):
            m = SUBROW.match(line)
            if not m or "#L" not in m.group(2):
                continue
            sub, cell = m.group(1).split("-")[0], m.group(2)
            names = [n for n in NAME_TOKEN.findall(cell) if n != "_"]
            anchors = [int(a) for a in ANCHOR_TOKEN.findall(cell)]
            if not names or len(names) != len(anchors):
                stats["unpairable"] += len(anchors)
                continue
            for name, anchor in zip(names, anchors):
                stats["checked"] += 1
                found = decl_lines(name, src, sub)
                if not found:
                    stats["missing"] += 1
                elif anchor in found:
                    stats["ok"] += 1
                elif len(found) == 1:
                    findings.append(dict(path=rp, lineno=i, cid=cid, sub=m.group(1), name=name,
                                         old=anchor, new=found[0], note="", file=real[0]))
                else:
                    findings.append(dict(path=rp, lineno=i, cid=cid, sub=m.group(1), name=name,
                                         old=anchor, new=None, file=real[0],
                                         note="defined %d times (lines %s) - fix by hand" % (len(found), found)))
    return findings, stats


def apply_anchor_fixes(findings):
    by_file = {}
    for f in findings:
        if f["new"] is not None:
            by_file.setdefault(f["path"], []).append(f)
    changed = 0
    for path, fs in by_file.items():
        raw = open(path, encoding="utf-8", newline="").read()
        eol = "\r\n" if "\r\n" in raw else "\n"
        lines = raw.split(eol)
        for f in fs:
            line = lines[f["lineno"] - 1]
            m = SUBROW.match(line)
            cell_start, cell_end = m.start(2), m.end(2)
            cell = line[cell_start:cell_end]
            names = [n for n in NAME_TOKEN.findall(cell) if n != "_"]
            idx = names.index(f["name"])
            spans = [(a.start(1), a.end(1)) for a in ANCHOR_TOKEN.finditer(cell)]
            s, e = spans[idx]
            if cell[s:e] == str(f["old"]):
                cell = cell[:s] + str(f["new"]) + cell[e:]
                lines[f["lineno"] - 1] = line[:cell_start] + cell + line[cell_end:]
                changed += 1
        with open(path, "w", encoding="utf-8", newline="") as out:
            out.write(eol.join(lines))
    return changed


# ------------------------------------------------------------------ B: record drift / age
def scan_records(rows, today):
    drift_notes = [w for w in CC.check_last_verified_drift(rows)]
    out = []
    for cid, d in sorted(rows.items()):
        real = [f for f in d["files"] if "*" not in f]
        dt = parse_date(d["last_verified"])
        if not real or not dt:
            continue
        hot_n = len(git("log", "--since=%d days ago" % HOT_WINDOW, "--format=%h", "--", *real).split())
        hot = hot_n >= HOT_COMMITS
        ttl = TTL_HOT_DAYS if hot else TTL_DAYS
        age = (today - dt).days
        out.append(dict(cid=cid, file=real[0], verified=dt, age=age, ttl=ttl, hot=hot, hot_n=hot_n,
                        left=ttl - age))
    return drift_notes, out


# ------------------------------------------------------------------ C: stated facts
SCRIPT_TAG = re.compile(r'<script src="js/([a-z][a-z0-9_-]*\.js)"')


def _script_order():
    return SCRIPT_TAG.findall(read(os.path.join(ROOT, "dashboard.html")))


def _rm_perf_position():
    order = _script_order()
    return (order.index("core-rm-performance.js") + 1, len(order))


def _core_split():
    order = _script_order()
    first_run = 0
    for f in order:
        if f.startswith("core-") and f != "core-rm-performance.js":
            first_run += 1
        else:
            break
    total = len([f for f in os.listdir(os.path.join(ROOT, "js")) if f.startswith("core-") and f.endswith(".js")])
    return (first_run, total)


# (file, regex with 2 int groups, truth_fn, human label). ADD A ROW every time a new
# stale stated-fact is found by hand -- that is how this list earns its keep.
FACT_CLAIMS = [
    ("CLAUDE.md", r'position (\d+) of (\d+)', _rm_perf_position, "core-rm-performance.js load position / total script tags"),
    ("HANDOVER.md", r'position (\d+) of (\d+)', _rm_perf_position, "core-rm-performance.js load position / total script tags"),
    ("CLAUDE.md", r'(\d+) of the (\d+) `js/core-\*\.js`', _core_split, "js/core-*.js files loading first / total core-*.js files"),
    ("HANDOVER.md", r'\((\d+) load first; (\d+) exist\)', _core_split, "js/core-*.js files loading first / total core-*.js files"),
]


def scan_facts():
    out = []
    for fname, rx, truth, label in FACT_CLAIMS:
        text = read(os.path.join(ROOT, fname))
        want = tuple(str(x) for x in truth())
        for m in re.finditer(rx, text):
            got = (m.group(1), m.group(2))
            if got != want:
                ln = text.count("\n", 0, m.start()) + 1
                out.append(dict(file=fname, line=ln, stated="%s of %s" % got, actual="%s of %s" % want, label=label))
    return out


# ------------------------------------------------------------------ D: Apps Script deploy register
def prod_gs_files():
    return sorted(f for f in os.listdir(ROOT)
                  if f.endswith(".gs") and not f.startswith("Tests_") and ".private." not in f)


def scan_deploys(tracker_text):
    reg = {r.get("File", "").strip("` "): r for r in md_table(tracker_text, "Apps Script deploy register")}
    out = []
    for f in prod_gs_files():
        r = reg.get(f)
        if not r:
            out.append(dict(file=f, state="NO-ROW", detail="production .gs file has no row in the deploy register"))
            continue
        sha = r.get("Confirmed-live sha", "").strip("` ")
        if not sha or sha == "-":
            last = git("log", "-1", "--format=%cs %h", "--", f)
            out.append(dict(file=f, state="UNCONFIRMED", detail="no confirmed-live baseline; last changed " + last))
            continue
        if git("cat-file", "-t", sha) != "commit":
            out.append(dict(file=f, state="BAD-SHA", detail="register sha %s is not in history" % sha))
            continue
        later = git("log", "--format=%h %cs %s", "%s..HEAD" % sha, "--", f).splitlines()
        if later:
            out.append(dict(file=f, state="PENDING", n=len(later), since=sha, confirmed=r.get("Confirmed on", ""),
                            detail="%d commit(s) since confirmed-live %s; newest: %s" % (len(later), sha, later[0][:90])))
        else:
            out.append(dict(file=f, state="OK", detail="matches confirmed-live %s (%s)" % (sha, r.get("Confirmed on", ""))))
    return out


# ------------------------------------------------------------------ E: watch register
def _last_done(spec, tracker_text=""):
    spec = spec.strip("` ")
    if spec == "auto:deploy-register":
        ds = [parse_date(r.get("Confirmed on", "")) for r in md_table(tracker_text, "Apps Script deploy register")]
        ds = [d for d in ds if d]
        return max(ds) if ds else None
    if spec.startswith("auto:git:"):
        return parse_date(git("log", "-1", "--format=%cs", "--", spec[len("auto:git:"):]))
    if spec == "auto:log:weekly-spot-check":
        p = os.path.join(ROOT, "docs", "_planning", "weekly-spot-check-log.md")
        ds = re.findall(r'^## Cycle \d+ \S+ (\d{4}-\d{2}-\d{2})', read(p), re.M) if os.path.exists(p) else []
        return parse_date(ds[-1]) if ds else None
    return parse_date(spec)


def scan_watch(tracker_text, today):
    out = []
    for r in md_table(tracker_text, "Watch register"):
        item = r.get("Item", "")
        try:
            ttl = int(re.sub(r'\D', '', r.get("TTL (days)", "")) or 0)
        except ValueError:
            ttl = 0
        last = _last_done(r.get("Last done", ""), tracker_text)
        if not item or not ttl:
            continue
        if last is None:
            out.append(dict(item=item, how=r.get("How to check", ""), state="OVERDUE", due=None, last=None, ttl=ttl))
            continue
        due = last + datetime.timedelta(days=ttl)
        left = (due - today).days
        state = "OVERDUE" if left < 0 else ("DUE-SOON" if left <= HORIZON_DAYS else "OK")
        out.append(dict(item=item, how=r.get("How to check", ""), state=state, due=due, last=last, ttl=ttl, left=left))
    return out


# ------------------------------------------------------------------ F, G
CODE_RX = re.compile(r'^(?:js/[^/]+\.js|[A-Za-z0-9_]+\.gs|dashboard\.html)$')


def scan_uncommitted(rows):
    mod = set()
    for line in git("status", "--porcelain").splitlines():
        if line[:2].strip() and not line.startswith("??"):
            mod.add(line[3:].strip().strip('"').replace("\\", "/"))
    out = []
    for path in sorted(mod):
        if not CODE_RX.match(path) or path.startswith("Tests_"):
            continue
        for cid, d in rows.items():
            if path in d["files"]:
                rp = CC.record_path(cid)
                rel = os.path.relpath(rp, ROOT).replace("\\", "/") if rp else None
                if rel and rel not in mod:
                    out.append(dict(file=path, cid=cid, record=rel))
    return out


def scan_control_chars():
    out = []
    for f in sorted(x for x in os.listdir(ROOT) if x.endswith(".gs") and ".private." not in x):
        data = open(os.path.join(ROOT, f), "rb").read()
        for m in re.finditer(rb'[\x00-\x08\x0b\x0c\x0e-\x1f]', data):
            out.append(dict(file=f, line=data.count(b"\n", 0, m.start()) + 1, code="U+%04X" % m.group(0)[0]))
    # A raw NUL in a markdown file (usually an escape sequence interpreted by whatever wrote the
    # file) makes grep and other tools treat the WHOLE file as binary and skip it.
    for base, _dirs, files in os.walk(ROOT):
        if any(s in base for s in (os.sep + ".git", "node_modules", "working files")):
            continue
        for f in files:
            if f.endswith(".md"):
                path = os.path.join(base, f)
                data = open(path, "rb").read()
                if b"\x00" in data:
                    out.append(dict(file=os.path.relpath(path, ROOT).replace("\\", "/"),
                                    line=data.count(b"\n", 0, data.index(b"\x00")) + 1, code="U+0000"))
    return out


def scan_handover_lag(today):
    sha = git("log", "-1", "--format=%h", "--", "HANDOVER.md")
    if not sha:
        return None
    dt = parse_date(git("log", "-1", "--format=%cs", "--", "HANDOVER.md"))
    n = len(git("log", "--format=%h", "%s..HEAD" % sha, "--", "js", "dashboard.html", "*.gs").split())
    days = (today - dt).days
    state = "OK"
    if n >= HANDOVER_OVERDUE[0] or days >= HANDOVER_OVERDUE[1]:
        state = "OVERDUE"
    elif n >= HANDOVER_SOON[0] or days >= HANDOVER_SOON[1]:
        state = "DUE-SOON"
    return dict(sha=sha, date=dt, commits=n, days=days, state=state)


# ------------------------------------------------------------------ report
def build(today):
    rows = CC.parse_index()
    tracker = read(TRACKER) if os.path.exists(TRACKER) else ""
    anchors, astats = scan_anchors(rows)
    drift_notes, recs = scan_records(rows, today)
    drifted_ids = set(re.findall(r'^((?:[A-Z]{2,6})-\d{3}):', "\n".join(drift_notes), re.M))
    return dict(rows=rows, anchors=anchors, astats=astats, drift_notes=drift_notes, recs=recs,
                drifted_ids=drifted_ids, facts=scan_facts(), deploys=scan_deploys(tracker),
                watch=scan_watch(tracker, today), uncommitted=scan_uncommitted(rows),
                handover=scan_handover_lag(today), ctrl=scan_control_chars())


def summarize(R):
    stale = (len([a for a in R["anchors"]]) + len([n for n in R["drift_notes"] if re.match(r'[A-Z]{2,6}-\d{3}:', n)])
             + len(R["facts"]) + len(R["ctrl"])
             + len([d for d in R["deploys"] if d["state"] in ("PENDING", "BAD-SHA", "NO-ROW")])
             + len([w for w in R["watch"] if w["state"] == "OVERDUE"])
             + (1 if R["handover"] and R["handover"]["state"] == "OVERDUE" else 0))
    overdue = [r for r in R["recs"] if r["left"] < 0 and r["cid"] not in R["drifted_ids"]]
    soon = [r for r in R["recs"] if 0 <= r["left"] <= HORIZON_DAYS and r["cid"] not in R["drifted_ids"]]
    risk = (len(soon) + len(R["uncommitted"]) + len([w for w in R["watch"] if w["state"] == "DUE-SOON"])
            + len([d for d in R["deploys"] if d["state"] == "UNCONFIRMED"])
            + (1 if R["handover"] and R["handover"]["state"] == "DUE-SOON" else 0))
    return stale, len(overdue), risk, overdue, soon


def lines_report(R, today, cap=12):
    L = []
    stale, n_over, risk, overdue, soon = summarize(R)
    sha = git("rev-parse", "--short", "HEAD")
    L.append("Staleness report for HEAD %s, %s IST" % (sha, today.isoformat()))
    L.append("")
    a = R["astats"]
    L.append("A. Line anchors: %d checked, %d ok, %d DRIFTED (%d anchors not machine-checkable: prose / multi-name cells)"
             % (a["checked"], a["ok"], len(R["anchors"]), a["unpairable"]))
    for f in R["anchors"][:cap]:
        L.append("   STALE  %s %s: `%s` cites #L%d, real line %s%s" % (
            f["cid"], f["sub"], f["name"], f["old"], f["new"] if f["new"] else "?", ("  " + f["note"]) if f["note"] else ""))
    if len(R["anchors"]) > cap:
        L.append("   ... +%d more (run --fix-anchors)" % (len(R["anchors"]) - cap))
    L.append("")
    real_drift = [n for n in R["drift_notes"] if re.match(r'[A-Z]{2,6}-\d{3}:', n)]
    L.append("B. Records: %d DRIFTED (source moved since Last Verified), %d OVERDUE (> TTL), %d DUE-SOON (<= %dd)"
             % (len(real_drift), n_over, len(soon), HORIZON_DAYS))
    for n in real_drift[:cap]:
        L.append("   STALE  " + n[:170])
    for r in sorted(overdue, key=lambda r: r["left"])[:cap]:
        L.append("   OVERDUE  %s (%s) verified %s, %dd old, TTL %dd%s" % (
            r["cid"], r["file"], r["verified"], r["age"], r["ttl"], " [hot: %d commits/%dd]" % (r["hot_n"], HOT_WINDOW) if r["hot"] else ""))
    for r in sorted(soon, key=lambda r: r["left"])[:cap]:
        L.append("   AT-RISK  %s (%s) goes overdue in %dd (verified %s, TTL %dd)%s" % (
            r["cid"], r["file"], r["left"], r["verified"], r["ttl"], " [hot]" if r["hot"] else ""))
    L.append("")
    L.append("C. Stated facts: %d STALE (of %d registered claims)" % (len(R["facts"]), len(FACT_CLAIMS)))
    for f in R["facts"]:
        L.append("   STALE  %s:%d says \"%s\" but %s is \"%s\"" % (f["file"], f["line"], f["stated"], f["label"], f["actual"]))
    L.append("")
    L.append("D. Apps Script deploy register (git does NOT deploy -- see CLAUDE.md):")
    for d in R["deploys"]:
        tag = {"PENDING": "STALE", "BAD-SHA": "STALE", "NO-ROW": "STALE", "UNCONFIRMED": "AT-RISK", "OK": "ok"}[d["state"]]
        L.append("   %-8s %-32s %s %s" % (tag, d["file"], d["state"], d["detail"]))
    L.append("")
    L.append("E. Watch register:")
    for w in R["watch"]:
        when = "never done" if w["last"] is None else "last %s, due %s (%+dd)" % (w["last"], w["due"], w["left"])
        L.append("   %-8s %s -- %s" % ({"OVERDUE": "STALE", "DUE-SOON": "AT-RISK", "OK": "ok"}[w["state"]], w["item"], when))
    L.append("")
    L.append("F. Uncommitted code changes with no matching record edit: %d" % len(R["uncommitted"]))
    for u in R["uncommitted"]:
        L.append("   AT-RISK  %s modified, %s (%s) not touched -- will drift on commit" % (u["file"], u["cid"], u["record"]))
    L.append("")
    h = R["handover"]
    if h:
        L.append("G. HANDOVER.md: last changed %s (%s); %d code commit(s) and %dd since -> %s" % (
            h["sha"], h["date"], h["commits"], h["days"], h["state"]))
    L.append("")
    L.append("H. Raw control characters in .gs sources and .md docs: %d" % len(R["ctrl"]))
    for c in R["ctrl"]:
        L.append("   STALE  %s line %d holds a raw %s -- write it as an escape sequence (the Apps Script editor changes it on paste; grep treats a file holding one as binary)" % (
            c["file"], c["line"], c["code"]))
    L.append("")
    L.append("SUMMARY: STALE %d | OVERDUE-records %d | AT-RISK %d" % (stale, n_over, risk))
    return L, stale


def auto_block(R, today):
    L, stale = lines_report(R, today, cap=25)
    stale_n, n_over, risk, overdue, soon = summarize(R)
    md = [AUTO_BEGIN, "", "_Generated by `python3 test/check-staleness.py --write` -- do not edit by hand._", "",
          "**HEAD `%s`, %s IST -- STALE %d | OVERDUE records %d | AT-RISK %d**" % (
              git("rev-parse", "--short", "HEAD"), today.isoformat(), stale_n, n_over, risk), "",
          "```text"] + L[2:-2] + ["```", "", AUTO_END]
    return "\n".join(md)


def write_tracker(R, today):
    text = read(TRACKER)
    block = auto_block(R, today)
    if AUTO_BEGIN in text and AUTO_END in text:
        text = re.sub(re.escape(AUTO_BEGIN) + r'.*?' + re.escape(AUTO_END), lambda m: block, text, flags=re.S)
    else:
        text = text.rstrip("\n") + "\n\n" + block + "\n"
    with open(TRACKER, "w", encoding="utf-8", newline="") as f:
        f.write(text)


def main():
    args = set(sys.argv[1:])
    today = today_ist()
    R = build(today)
    if "--fix-anchors" in args:
        n = apply_anchor_fixes(R["anchors"])
        print("Rewrote %d drifted #Lnn anchor(s) in docs/ records (%d not auto-fixable)." % (
            n, len([a for a in R["anchors"] if a["new"] is None])))
        R = build(today)
    lines, stale = lines_report(R, today)
    print("\n".join(lines))
    if "--write" in args:
        write_tracker(R, today)
        print("\nTracker AUTO block rewritten: docs/STALENESS_TRACKER.md")
    sys.exit(1 if ("--strict" in args and stale) else 0)


if __name__ == "__main__":
    main()
