#!/usr/bin/env python3
"""check-followup-single-path.py -- fails if follow-up advice can be built from ONE comment instead of the whole history.

Why (2026-11-20): the user asked twice for the follow-up to "read all the comments and then decide". The first pass added
historyFollowUpGs_/historyFollowUp, but a fallback still sent leads with no worded comment to the old newest-comment reader,
which quoted the stage name "Suspect" as the RM's note in the 17:00 email (lead 2276862). This check makes that class of
regression a build failure instead of something a reader spots in an email:

  1. Follow-up TEXT may only be assembled (FOLLOWUP_SUGGESTIONS lookups, unmatchedFollowUp calls) inside the history
     decider or the legacy undated-data function - nowhere else, in either runtime.
  2. The two entry points (overnightFollowupHintGs_ for emails, suggestedFollowUp for the dashboard) must call the history
     reader FIRST, before any other tier.
  3. The newest-comment readers (latestOutcomeGs_ / latestFamilyOutcome) may only be called by an allow-listed set of
     functions - none of which produce follow-up advice. A new caller fails here until it is reviewed and added.

USAGE
    python3 test/check-followup-single-path.py              # exit 1 on any violation
    python3 test/check-followup-single-path.py --self-test  # plants a violation; exit 0 only if it is caught
"""
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

# Functions allowed to turn an outcome into follow-up text.
TEXT_BUILDERS = {
    "FollowupEngine.gs": {"historyDecideGs_", "legacySingleCommentFollowUpGs_", "historyNoReachAdviceGs_"},
    "js/core-outcome-engine.js": {"historyDecide", "legacySingleCommentFollowUp", "historyNoReachAdvice"},
}
# Helpers in TEXT_BUILDERS that are only parts of the history decider: each may be called ONLY from there.
DECIDER_ONLY_HELPERS = {
    "FollowupEngine.gs": ("historyNoReachAdviceGs_", "historyDecideGs_"),
    "js/core-outcome-engine.js": ("historyNoReachAdvice", "historyDecide"),
}
TEXT_PATTERNS = [r"FOLLOWUP_SUGGESTIONS(?:_GS_)?\[", r"\bunmatchedFollowUp(?:Gs_)?\("]

# Entry points and the history call that must come first in each.
ENTRY_POINTS = {
    "FollowupEngine.gs": ("overnightFollowupHintGs_", "historyFollowUpGs_("),
    "js/core-outcome-engine.js": ("suggestedFollowUp", "historyFollowUp("),
}

# Who may call the single newest-comment readers, and why.
NEWEST_READER_CALLERS = {
    "latestOutcomeGs_": {
        ("FollowupEngine.gs", "legacySingleCommentFollowUpGs_"),   # undated old-format data only
        ("InteractionHistoryLogger.gs", None),                     # logs the latest outcome; no advice
        ("UnmatchedCommentLogger.gs", None),                       # logs unmatched comments; no advice
    },
    "latestFamilyOutcome": {
        ("js/core-outcome-engine.js", "legacySingleCommentFollowUp"),
        ("js/reports-build.js", None),                             # Possible Premature Closes check; no advice
    },
}

FUNC_RE = re.compile(r"^(?:async\s+)?function\s+([A-Za-z0-9_$]+)\s*\(", re.M)


def strip_comments(src):
    src = re.sub(r"/\*.*?\*/", lambda m: "\n" * m.group(0).count("\n"), src, flags=re.S)
    return re.sub(r"//[^\n]*", "", src)


def enclosing_function(src, pos):
    name = None
    for m in FUNC_RE.finditer(src):
        if m.start() > pos:
            break
        name = m.group(1)
    return name


def function_body(src, name):
    m = re.search(r"^function\s+%s\s*\([^)]*\)\s*\{" % re.escape(name), src, re.M)
    if not m:
        return None
    depth, i = 1, m.end()
    while i < len(src) and depth:
        depth += {"{": 1, "}": -1}.get(src[i], 0)
        i += 1
    return src[m.end():i - 1]


def check(files):
    problems = []
    for rel, allowed in TEXT_BUILDERS.items():
        src = strip_comments(files[rel])
        for pat in TEXT_PATTERNS:
            for m in re.finditer(pat, src):
                if re.match(r"function\s", src[max(0, m.start() - 9):m.start()]):
                    continue  # the function's own definition line
                fn = enclosing_function(src, m.start())
                if fn not in allowed:
                    problems.append("%s: follow-up text built in %s() from a single outcome (%s) - only %s may do this"
                                    % (rel, fn, m.group(0), ", ".join(sorted(allowed))))
    for rel, (helper, owner) in DECIDER_ONLY_HELPERS.items():
        for frel, raw in files.items():
            src = strip_comments(raw)
            for m in re.finditer(r"\b%s\(" % re.escape(helper), src):
                if re.match(r"function\s", src[max(0, m.start() - 9):m.start()]):
                    continue
                fn = enclosing_function(src, m.start())
                if (frel, fn) != (rel, owner):
                    problems.append("%s: %s() calls %s, which may only be used inside %s()" % (frel, fn, helper, owner))
    for rel, (entry, first) in ENTRY_POINTS.items():
        body = function_body(strip_comments(files[rel]), entry)
        if body is None:
            problems.append("%s: entry point %s() not found" % (rel, entry))
            continue
        calls = re.findall(r"\b([A-Za-z0-9_$]+)\(", body)
        if not calls or calls[0] + "(" != first:
            problems.append("%s: %s() must call %s first; first call is %s" % (rel, entry, first, calls[0] if calls else "none"))
    for reader, allowed in NEWEST_READER_CALLERS.items():
        for rel, raw in files.items():
            src = strip_comments(raw)
            for m in re.finditer(r"\b%s\(" % re.escape(reader), src):
                fn = enclosing_function(src, m.start())
                if fn == reader:
                    continue  # its own definition
                if (rel, fn) in allowed or (rel, None) in allowed:
                    continue
                problems.append("%s: %s() calls the single newest-comment reader %s - follow-up advice must come from "
                                "the full history (historyFollowUp*). Review, then allow-list it here if it gives no advice."
                                % (rel, fn, reader))
    return problems


def load():
    out = {}
    for p in list(ROOT.glob("*.gs")) + list((ROOT / "js").glob("*.js")):
        rel = p.relative_to(ROOT).as_posix()
        if p.name.startswith("Tests_"):
            continue
        out[rel] = p.read_text(encoding="utf-8")
    return out


def main():
    files = load()
    if "--self-test" in sys.argv:
        files["js/core-outcome-engine.js"] += "\nfunction sneakyFollowUp(l){ const x = latestFamilyOutcome(l); return FOLLOWUP_SUGGESTIONS[x.outcome]; }\n"
        got = check(files)
        print("SELF-TEST: %d violation(s) caught -> %s" % (len(got), "the check works" if len(got) >= 2 else "THE CHECK IS BLIND"))
        return 0 if len(got) >= 2 else 1
    problems = check(files)
    if problems:
        print("FOLLOW-UP SINGLE-PATH VIOLATIONS -- %d:" % len(problems))
        for p in problems:
            print("  " + p)
        return 1
    print("OK: follow-up advice is built only from the full comment history (emails and dashboard).")
    return 0


if __name__ == "__main__":
    sys.exit(main())
