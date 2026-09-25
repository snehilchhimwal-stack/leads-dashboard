#!/usr/bin/env python3
"""
match-live-gs.py -- work out which repo commit each file in the LIVE Apps Script
project corresponds to, from hashes read out of the editor in Chrome. Git does
not deploy .gs files, so this is the only way to know what is really running.

  1. Open the live project's editor in Chrome (docs/STALENESS_TRACKER.md has its
     URL) and run the snippet in that file's "Reading what is live" section in
     the page; it leaves a string like "1:15347:9450f54e1f8ca6f3 2:..." in
     window.__h (one `index:length:sha256-first-16` per file; no source leaves
     the browser).
  2. python3 test/match-live-gs.py "<that string>"            # report only
     python3 test/match-live-gs.py "<that string>" --apply    # also rewrite the
                                                              # deploy register rows

Every historical version of every local .gs file is hashed the same way
(CRLF->LF, trailing newlines stripped) and matched. A second variant with each
raw NUL byte replaced by a space is also tried, because pasting a file into the
editor turns a raw NUL into a space (real finding, 2026-09-25: MovementTracker.gs).
"""
import os, re, sys, subprocess, hashlib, datetime, collections

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
TRACKER = os.path.join(ROOT, "docs", "STALENESS_TRACKER.md")


def git(*a):
    return subprocess.run(["git", "-C", ROOT, *a], capture_output=True).stdout


def h16(text):
    return hashlib.sha256(text.replace("\r\n", "\n").rstrip("\n").encode("utf-8")).hexdigest()[:16]


def variants(raw_bytes):
    text = raw_bytes.decode("utf-8")
    out = [("exact", h16(text))]
    if "\x00" in text:
        out.append(("NUL-became-space", h16(text.replace("\x00", " "))))
    return out


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    if not args:
        print(__doc__)
        return 2
    live = {}
    for tok in args[0].split():
        n, ln, hh = tok.split(":")
        live[int(n)] = (int(ln), hh)
    files = sorted(f for f in os.listdir(ROOT) if f.endswith(".gs") and ".private." not in f)
    idx = collections.defaultdict(list)  # hash -> [(file, sha, variant)]
    newest = {}
    for f in files:
        shas = git("log", "--format=%h", "--", f).decode().split()
        newest[f] = shas[0] if shas else None
        for s in shas:
            blob = git("show", "%s:%s" % (s, f))
            if blob:
                for var, hh in variants(blob):
                    idx[hh].append((f, s, var))
    best = {}  # file -> (sha, variant, live#)
    print("Live editor file -> repo match")
    for n, (ln, hh) in sorted(live.items()):
        hits = idx.get(hh)
        if not hits:
            print("  #%-2d len=%-6d NO MATCH in any local version (private data file, or edited in place)" % (n, ln))
            continue
        fname = hits[0][0]
        sha, var = hits[0][1], hits[0][2]  # newest first
        cur = "at HEAD-of-file" if sha == newest[fname] else "BEHIND (newest is %s)" % newest[fname]
        note = "" if var == "exact" else "  [%s]" % var
        print("  #%-2d len=%-6d = %-32s %s %s%s" % (n, ln, fname, sha, cur, note))
        if not fname.startswith("Tests_"):
            best[fname] = (sha, var, n)
    missing = [f for f in files if not f.startswith("Tests_") and f not in best]
    if missing:
        print("\nProduction .gs with NO live match (not pasted, or edited in place):", ", ".join(missing))
    if "--apply" in sys.argv:
        today = (datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(hours=5, minutes=30)).date().isoformat()
        text = open(TRACKER, encoding="utf-8", newline="").read()
        n_rows = 0
        for f, (sha, var, n) in best.items():
            basis = "read directly from the live editor by hash-match (%s)" % today
            if var != "exact":
                basis += "; the file's raw NUL byte became a space when pasted - live differs from repo by that one character"
            row = "| `%s` | `%s` | %s | %s |" % (f, sha, today, basis)
            new, k = re.subn(r'^\| `' + re.escape(f) + r'` \|.*\|$', lambda m: row, text, flags=re.M)
            if k:
                text, n_rows = new, n_rows + 1
        open(TRACKER, "w", encoding="utf-8", newline="").write(text)
        print("\nDeploy register: %d row(s) rewritten in docs/STALENESS_TRACKER.md" % n_rows)
    return 0


if __name__ == "__main__":
    sys.exit(main())
