#!/usr/bin/env python3
"""
match-live-gs.py -- work out which repo commit each file in the LIVE Apps Script
project corresponds to, from hashes read out of the editor in Chrome, and (with
--push) generate ONE ready-to-paste browser snippet that brings every file that
is BEHIND -- production .gs AND its Tests_*.gs sibling alike -- up to HEAD in a
single pass. Git does not deploy .gs files, so this is the only way to know
what is really running, and the only way a push doesn't miss a connected file
that was quietly left behind (real incident, 2026-10-01: RmHierarchy.gs was
pushed to HEAD and verified; its own Tests_RmHierarchy.gs sat 2 commits behind,
live, unnoticed, until the NEXT deploy went looking for it by hand).

  1. Open the live project's editor in Chrome (docs/STALENESS_TRACKER.md has its
     URL) and run the snippet in that file's "Reading what is live" section in
     the page; it leaves a string like "1:15347:9450f54e1f8ca6f3 2:..." in
     window.__h (one `index:length:sha256-first-16` per file; no source leaves
     the browser). This reads EVERY open file in one pass -- it is not scoped
     to whichever one file you're about to edit, which is the whole point.
  2. python3 test/match-live-gs.py "<that string>"            # report only
     python3 test/match-live-gs.py "<that string>" --push     # + a combined
                                                                # push payload
     python3 test/match-live-gs.py "<that string>" --apply    # + rewrite the
                                                                # deploy register
  3. --push writes ONE file (printed path) holding a single, generic
     javascript_tool snippet: paste it as-is into the live editor tab and it
     decodes, range-edits, and SHA-verifies every stale file's model in one
     call -- then Ctrl+S each changed file tab and re-run step 1+2 (no --push)
     to confirm, and --apply to update the register. The snippet text itself
     never changes between runs, only the embedded payload -- so pasting it
     costs the same regardless of how many files are stale, and a session
     doesn't need to hand-write a fresh diff/gzip/base64 script per file the
     way this tool itself used to require.

Every historical version of every local .gs file (production AND Tests_*.gs)
is hashed the same way (CRLF->LF, trailing newlines stripped) and matched. A
second variant with each raw NUL byte replaced by a space is also tried,
because pasting a file into the editor turns a raw NUL into a space (real
finding, 2026-09-25: MovementTracker.gs) -- a file only matched that way is
reported but excluded from --push (the live byte content doesn't equal any
real git blob, so there's no clean "old" text to diff from).
"""
import os, re, sys, gzip, json, base64, tempfile, subprocess, hashlib, datetime, collections

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
TRACKER = os.path.join(ROOT, "docs", "STALENESS_TRACKER.md")
# Outside the repo on purpose -- this is a one-time-use generated payload,
# never a project asset, and must never show up as an untracked file in
# `git status`. CLAUDE_SCRATCHPAD_DIR, when a session sets it, wins.
SCRATCH_DIR = os.environ.get("CLAUDE_SCRATCHPAD_DIR", tempfile.gettempdir())
PUSH_OUT = os.path.join(SCRATCH_DIR, "match-live-gs-push.txt")


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


def common_prefix_len(a, b):
    n = min(len(a), len(b))
    lo, hi = 0, n
    # binary search the longest common prefix -- a[:k] == b[:k] is monotonic
    while lo < hi:
        mid = (lo + hi + 1) // 2
        if a[:mid] == b[:mid]:
            lo = mid
        else:
            hi = mid - 1
    return lo


def build_edit(old_text, new_text):
    """Smallest single contiguous replace that turns old_text into new_text --
    a plain common-prefix/common-suffix trim. Correct for any diff shape (one
    hunk or scattered many, like a file that's drifted across several
    unpasted commits); only the SIZE of the middle region grows with how
    spread-out the real changes are, never correctness. Returns
    (prefix_len, old_mid_len, new_mid) -- enough to build a Monaco Range
    (prefix_len .. prefix_len+old_mid_len) and the replacement text, with NO
    need to re-send old_mid itself (the caller verifies the whole-file SHA
    before and after instead of a snippet-level check)."""
    p = common_prefix_len(old_text, new_text)
    max_suffix = min(len(old_text), len(new_text)) - p
    s = common_prefix_len(old_text[::-1], new_text[::-1])
    s = min(s, max_suffix)
    old_mid_len = len(old_text) - p - s
    new_mid = new_text[p:len(new_text) - s]
    return p, old_mid_len, new_mid


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

    register_rows = {}   # production file -> (sha, var, live#)  -- unchanged scope: --apply only
    push_candidates = {}  # EVERY matched file (prod + Tests_*) that is behind HEAD, var == exact only
    print("Live editor file -> repo match")
    for n, (ln, hh) in sorted(live.items()):
        hits = idx.get(hh)
        if not hits:
            print("  #%-2d len=%-6d NO MATCH in any local version (private data file, or edited in place)" % (n, ln))
            continue
        fname, sha, var = hits[0]
        behind = sha != newest[fname]
        cur = "at HEAD-of-file" if not behind else "BEHIND (newest is %s)" % newest[fname]
        note = "" if var == "exact" else "  [%s]" % var
        print("  #%-2d len=%-6d = %-32s %s %s%s" % (n, ln, fname, sha, cur, note))
        if not fname.startswith("Tests_"):
            register_rows[fname] = (sha, var, n)
        if behind and var == "exact" and newest[fname]:
            push_candidates[fname] = (sha, newest[fname], n)
    missing = [f for f in files if not f.startswith("Tests_") and f not in register_rows]
    if missing:
        print("\nProduction .gs with NO live match (not pasted, or edited in place):", ", ".join(missing))

    if "--push" in sys.argv:
        if not push_candidates:
            if os.path.exists(PUSH_OUT):
                os.remove(PUSH_OUT)  # don't leave a stale payload from an earlier run sitting around
            print("\n--push: nothing behind HEAD (with a clean exact match) -- no payload to generate.")
        else:
            entries = []
            print("\n--push: building a combined payload for %d file(s):" % len(push_candidates))
            for fname, (old_sha, new_sha, live_idx) in sorted(push_candidates.items()):
                old_text = git("show", "%s:%s" % (old_sha, fname)).decode("utf-8")
                new_text = git("show", "%s:%s" % (new_sha, fname)).decode("utf-8")
                prefix_len, old_mid_len, new_mid = build_edit(old_text, new_text)
                entries.append({
                    "name": fname, "liveIndex": live_idx,
                    "prefixLen": prefix_len, "oldMidLen": old_mid_len, "newMid": new_mid,
                    "oldsha": h16(old_text), "newsha": h16(new_text),
                    "oldlen": len(old_text), "newlen": len(new_text),
                })
                changed = old_mid_len + len(new_mid)
                print("  %-32s %s -> %s  (%d of %d chars touched, %.0f%% of file)"
                      % (fname, old_sha, new_sha, changed, len(old_text), 100.0 * changed / max(1, len(old_text))))
            payload = json.dumps({"entries": entries})
            b64 = base64.b64encode(gzip.compress(payload.encode("utf-8"), 9)).decode("ascii")
            snippet = PUSH_SNIPPET_TEMPLATE.replace("__PAYLOAD__", b64)
            with open(PUSH_OUT, "w", encoding="utf-8", newline="\n") as fh:
                fh.write(snippet)
            print("\nPayload written: %s (%d bytes, paste its full contents into javascript_tool)" % (PUSH_OUT, len(snippet)))
            print("After it reports match:true for every file: Ctrl+S each changed tab, then re-run step 1")
            print("(no --push) to confirm, then --apply to update the deploy register.")

    if "--apply" in sys.argv:
        today = (datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(hours=5, minutes=30)).date().isoformat()
        text = open(TRACKER, encoding="utf-8", newline="").read()
        n_rows = 0
        for f, (sha, var, n) in register_rows.items():
            basis = "read directly from the live editor by hash-match (%s)" % today
            if var != "exact":
                basis += "; the file's raw NUL byte became a space when pasted - live differs from repo by that one character"
            row = "| `%s` | `%s` | %s | %s |" % (f, sha, today, basis)
            # \r?$ -- TRACKER is opened with newline="" (raw bytes preserved),
            # and this repo's checkout has shown up with real CRLF line
            # endings (git's own core.autocrlf, confirmed 2026-10-01: a run
            # against a CRLF-checked-out copy silently matched and rewrote
            # ZERO rows with a bare \|$, since $ in MULTILINE mode sits right
            # before \n, and \r was still sitting between the literal `|`
            # and that point). Tolerate either line ending so this doesn't
            # silently no-op again depending on how the file was last saved.
            new, k = re.subn(r'^\| `' + re.escape(f) + r'` \|.*\|\r?$', lambda m: row, text, flags=re.M)
            if k:
                text, n_rows = new, n_rows + 1
        open(TRACKER, "w", encoding="utf-8", newline="").write(text)
        print("\nDeploy register: %d row(s) rewritten in docs/STALENESS_TRACKER.md" % n_rows)
    return 0


# Generic, reusable browser-side applier -- identical every run, only
# __PAYLOAD__ changes. Decodes the gzipped JSON, finds each file's live
# Monaco model BY INDEX (the same #N the hash-collection snippet numbered,
# so there's no name-matching ambiguity), verifies the whole-file pre-edit
# SHA, applies one range edit (prefixLen .. prefixLen+oldMidLen -> newMid),
# verifies the whole-file post-edit SHA, and returns one JSON summary line
# per file. Does NOT save -- Ctrl+S each changed tab by hand afterward (this
# tool has no way to know which tabs are actually open/visible to save).
#   NOTE: deliberately NOT wrapped in `(async () => { ... })()`. The
#   javascript_tool environment this is meant for returns `{}` for a
#   top-level IIFE call expression -- its result-capture only works with a
#   bare top-level-await script whose LAST EXPRESSION is the value wanted
#   (REPL semantics), confirmed by hand 2026-10-01 after an IIFE silently
#   produced `{}` with the edit never actually applied. Keep it this way.
PUSH_SNIPPET_TEMPLATE = """const b64 = "__PAYLOAD__";
const bin = atob(b64);
const bytes = new Uint8Array(bin.length);
for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
const ds = new DecompressionStream('gzip');
const buf = await new Response(new Blob([bytes]).stream().pipeThrough(ds)).arrayBuffer();
const payload = JSON.parse(new TextDecoder('utf-8').decode(buf));

async function sha16(norm) {
  const enc = new TextEncoder().encode(norm);
  const digest = await crypto.subtle.digest('SHA-256', enc);
  return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 16);
}

const models = monaco.editor.getModels();
const results = [];
for (const e of payload.entries) {
  const target = models[e.liveIndex - 1];
  if (!target) { results.push({ name: e.name, error: 'no model at live index ' + e.liveIndex }); continue; }
  const beforeNorm = target.getValue().replace(/\\r\\n/g, '\\n').replace(/\\n+$/, '');
  const beforeSha = await sha16(beforeNorm);
  if (beforeSha !== e.oldsha) { results.push({ name: e.name, error: 'PRE-EDIT SHA MISMATCH: ' + beforeSha + ' vs expected ' + e.oldsha }); continue; }
  const startPos = target.getPositionAt(e.prefixLen);
  const endPos = target.getPositionAt(e.prefixLen + e.oldMidLen);
  const range = new monaco.Range(startPos.lineNumber, startPos.column, endPos.lineNumber, endPos.column);
  target.pushEditOperations([], [{ range: range, text: e.newMid }], () => null);
  const afterNorm = target.getValue().replace(/\\r\\n/g, '\\n').replace(/\\n+$/, '');
  const afterSha = await sha16(afterNorm);
  results.push({
    name: e.name, beforeSha, afterSha, expectedNewSha: e.newsha,
    afterLen: target.getValueLength(), expectedNewLen: e.newlen,
    match: afterSha === e.newsha && target.getValueLength() === e.newlen,
  });
}
JSON.stringify(results, null, 1);
"""


if __name__ == "__main__":
    sys.exit(main())
