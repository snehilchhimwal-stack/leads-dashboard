#!/usr/bin/env python3
"""check-twin-behaviour.py -- runs the comment classifier's two copies on the SAME comments and diffs the answers.

D-2 (audit 2026-11-04). The automatic emails classify an RM comment with FollowupEngine.gs `inferOutcomeGs_`; the dashboard
uses its twin, js/core-outcome-engine.js `inferOutcome`. test/check-runtime-parity.py compares the DATA the two copies carry
(keyword lists, labels) but, as its own header says, not the matching code (fuzzy typo matching, exact-only words, the rule
`test:` functions). FE-1..FE-3 (audit 2026-10-13: "deciding" read as "declining", "broken" as "broker", "bringing" as
"ringing") were exactly that kind of bug. This script loads each runtime's REAL file in its own headless page, feeds both the
same corpus, and reports every comment the two copies classify differently.

The corpus is built at run time, so it grows with the rules: every signal phrase of both rule tables, each with one letter
dropped and two letters swapped (the typo budget is where the copies can drift), plus fixed tricky phrases. No sheet data is
read and nothing is written.

USAGE
    python3 test/check-twin-behaviour.py              # report; exit 1 on any mismatch or load error
    python3 test/check-twin-behaviour.py --self-test  # breaks the dashboard copy on purpose; exit 0 only if that is caught
Needs `playwright` (python) and a system Chrome/Edge, like test/run-gs-tests-headless.py.
"""

import importlib.util
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

# Reuse the GS runner's host shims (Utilities etc.) so the .gs file loads exactly as in the GS suite.
_spec = importlib.util.spec_from_file_location("gs_runner", ROOT / "test" / "run-gs-tests-headless.py")
_gs_runner = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_gs_runner)

GS_FILES = ["Core.gs", "FollowupEngine.gs"]  # inferOutcomeGs_ and the helpers it calls
JS_FILES = ["js/core-outcome-engine.js"]  # inferOutcome and its helpers

FIXED = [
    "client still deciding", "client is declining calls", "voice broken", "he is a broker", "bringing wife for visit",
    "phone ringing no answer", "asked to let him know", "looking for flat to let", "switched off", "not interested",
    "busy call later", "site visit done", "visit scheduled sunday", "budget issue", "wrong number", "dnd", "-", ".", "",
    "whatsapp sent", "details shared on whatsapp", "out of station till monday", "already booked elsewhere", "loan in process",
    "call back after 2 days", "rnr", "cut the call", "not reachable", "voice not clear", "resale property", "cp lead",
]

PAGE_JS_RULES = r"""
() => {
  const out = [];
  const add = s => { if (typeof s === 'string' && s.trim()) out.push(s); };
  (window.__twinRules || []).forEach(r => (r.signals || []).forEach(add));
  return out;
}
"""


def corpus_from(signals):
    seen, out = set(), []

    def add(s):
        if s not in seen:
            seen.add(s)
            out.append(s)

    for s in FIXED:
        add(s)
    for s in signals:
        add(s)
        add("client said " + s + " today")
        w = s.replace(" ", "")
        if len(w) > 3:
            mid = len(s) // 2
            add(s[:mid] + s[mid + 1:])  # one letter dropped
            if s[mid].isalpha() and mid + 1 < len(s) and s[mid + 1].isalpha():
                add(s[:mid] + s[mid + 1] + s[mid] + s[mid + 2:])  # two letters swapped
    return out


HIST_POOL = [
    "rnr", "switched off", "busy", "call declined", "whatsapp sent", "not interested", "wrong number",
    "site visit done", "visit scheduled sunday", "interested in 2bhk", "budget 1.2 cr, needs 3bhk", "call back after 2 days",
    "client still deciding", "details shared", "loan in process", "client happy with pricing", "-",
]


CALL_STATUSES = ["Ringing", "Busy", "Call Declined", "Not Reachable", "Followup Missed", "Invalid No", "Call Connected",
                 "Connected On Whatsapp"]


def history_corpus():
    """Deterministic comment histories: 1-7 entries, mixed loggers and days, a few stage-change notes. From n=200 on,
    entries carry a query-v3 call status ("[Busy] note", or "[Ringing]" with no note) so both formats are compared."""
    out, seed = [], 7
    for n in range(600):
        seed = (seed * 1103515245 + 12345) % (2 ** 31)
        length, parts, stage = 1 + seed % 7, [], []
        for i in range(length):
            seed = (seed * 1103515245 + 12345) % (2 ** 31)
            who = "Test RM" if seed % 4 else "Other Caller"
            ts = "2026-11-%02d %02d:%02d" % (10 + (seed >> 3) % 6, 9 + i, (seed >> 7) % 60)
            note = HIST_POOL[(seed >> 11) % len(HIST_POOL)]
            if n >= 200:
                status = CALL_STATUSES[(seed >> 17) % len(CALL_STATUSES)]
                note = "[%s]" % status if (seed >> 21) % 3 == 0 else "[%s] %s" % (status, note)
            parts.append("%s: %s - %s" % (who, note, ts))
        if n % 5 == 0:
            stage.append("Test RM: Suspect - 2026-11-10 08:00")
            stage.append("Test RM: Opportunity / %s - 2026-11-12 08:00" % HIST_POOL[n % len(HIST_POOL)])
        out.append([" | ".join(parts), " | ".join(stage)])
    return out


def main() -> int:
    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        print("ERROR: the `playwright` package isn't installed (python3 -m pip install playwright).", file=sys.stderr)
        return 1
    gs_src = _gs_runner.SANDBOX_SHIM_JS + "".join(
        "\n//===FILE:%s===\n" % n + (ROOT / n).read_text(encoding="utf-8") + "\n" for n in GS_FILES)
    js_src = "".join((ROOT / n).read_text(encoding="utf-8") + "\n" for n in JS_FILES)
    # `const` tables declared inside an indirect eval stay scoped to it, so each source exposes its rule table itself.
    gs_src += "\nwindow.__twinRules = OUTCOME_RULES_GS_;\n"
    js_src += "\nwindow.__twinRules = OUTCOME_RULES;\n"
    gs_src += "\nwindow.__twinSpelling = SPELLING_FIXES_GS_;\n"
    js_src += "\nwindow.__twinSpelling = SPELLING_FIXES;\n"
    self_test = "--self-test" in sys.argv
    if self_test:  # break the dashboard copy's typo matching on purpose: the check must then report mismatches
        js_src += "\n_wordsMatch = function (word, target) { return word === target; };\n"

    with sync_playwright() as p:
        browser = None
        for channel in ("chrome", "msedge", "chromium"):
            try:
                browser = p.chromium.launch(channel=channel, headless=True)
                break
            except Exception:  # noqa: BLE001
                continue
        if browser is None:
            print("ERROR: could not launch a headless Chrome/Edge.", file=sys.stderr)
            return 1
        gs_page, js_page = browser.new_page(), browser.new_page()
        try:
            gs_page.evaluate("(src) => window.eval(src)", gs_src)
            js_page.evaluate("(src) => window.eval(src)", js_src)
        except Exception as e:  # noqa: BLE001
            print("LOAD ERROR: %s" % e, file=sys.stderr)
            browser.close()
            return 1
        signals = js_page.evaluate(PAGE_JS_RULES)
        gs_signals = gs_page.evaluate("() => { const o = []; (window.__twinRules || []).forEach(r => (r.signals || []).forEach(s => o.push(s))); return o; }")
        corpus = corpus_from(signals + gs_signals)
        # every spelling fix (both copies' lists) goes through both classifiers too, alone and inside sentences
        js_spell_map = js_page.evaluate("() => window.__twinSpelling || {}")
        gs_spell_map = gs_page.evaluate("() => window.__twinSpelling || {}")
        spelling_diffs = sorted(k for k in set(js_spell_map) | set(gs_spell_map) if js_spell_map.get(k) != gs_spell_map.get(k))
        for w in sorted(set(js_spell_map) | set(gs_spell_map)):
            for t in (w, "client said " + w + " today", "not " + w):
                if t not in corpus:
                    corpus.append(t)
        gs = gs_page.evaluate("(c) => c.map(s => inferOutcomeGs_(s))", corpus)
        js = js_page.evaluate("(c) => c.map(s => inferOutcome(s))", corpus)
        # 2026-11-20: the full-history follow-up twins (historyFollowUpGs_ / historyFollowUp) on the same generated
        # comment histories. Intended differences are stubbed out on both sides first: the emails' preference clauses
        # (detectFollowupModifiersGs_) and the two unmatched-comment wordings.
        hist = history_corpus()
        gs_page.evaluate("() => { detectFollowupModifiersGs_ = () => []; unmatchedFollowUpGs_ = (c) => 'UNMATCHED:' + c; }")
        js_page.evaluate("() => { unmatchedFollowUp = (c) => 'UNMATCHED:' + c; }")
        gs_h = gs_page.evaluate("(h) => h.map(x => historyDecideGs_(historyEntriesGs_(x[0], x[1]), 'Test RM'))", hist)
        js_h = js_page.evaluate("(h) => h.map(x => historyDecide(historyEntries(x[0], x[1]), 'Test RM'))", hist)
        # Invariant: whenever a history has worded comments, the advice must say how many it read - i.e. it read them ALL.
        counts = js_page.evaluate("(h) => h.map(x => historyEntries(x[0], x[1]).length)", hist)
        # Invariant: a lead with only blank check-ins / bare stage changes must never get a stage name quoted as a note.
        stage_only = js_page.evaluate("""() => { lastSnapshotForLead = () => null; _renderNow = new Date();
            return suggestedFollowUp({ RM: 'Test RM', last_comment: '',
              internal_status_comments: 'Test RM:  - 2026-11-18 12:59 | Test RM:  - 2026-11-19 10:43',
              stage_comments: 'admin homesfy: Not Updated - 2026-11-15 10:35 | Test RM: Suspect - 2026-11-18 12:59' }); }""")
        browser.close()
    hist_diffs = [(h, g, j) for h, g, j in zip(hist, gs_h, js_h) if g != j]

    diffs = [(c, g, j) for c, g, j in zip(corpus, gs, js) if g != j]
    print("Full-history follow-up: compared %d generated comment histories." % len(hist))
    invariant = []
    for out, n in zip(js_h, counts):
        if n and ("History: %d call" % n) not in (out or ""):
            invariant.append("read %d worded comments but the advice does not say so: %s" % (n, out))
        if not n and out is not None:
            invariant.append("no worded comment, yet history advice was produced: %s" % out)
    if '"Suspect"' in str(stage_only) or '"Not Updated"' in str(stage_only):
        invariant.append("stage-only lead got a stage name quoted as a note: %s" % stage_only)
    if spelling_diffs:
        invariant.append("SPELLING_FIXES differ between the copies for: " + ", ".join(spelling_diffs))
    for line in invariant[:10]:
        print("  INVARIANT BROKEN: " + line)
    if invariant and not self_test:
        return 1
    print("Invariants hold: every worded comment counted; no stage name quoted; spelling lists identical (%d entries)."
          % len(js_spell_map))
    for h, g, j in hist_diffs[:10]:
        print("  HISTORY MISMATCH %s | emails=%s | dashboard=%s" % (json.dumps(h), g, j))
    if hist_diffs and not self_test:
        return 1
    if self_test:
        print("SELF-TEST: %d mismatch(es) found with the dashboard copy deliberately broken -> %s"
              % (len(diffs), "the check works" if diffs else "THE CHECK IS BLIND"))
        return 0 if diffs else 1
    print("Classified %d comments with both copies (%d signal phrases)." % (len(corpus), len(set(signals + gs_signals))))
    if diffs:
        print("MISMATCHES -- %d:" % len(diffs))
        for c, g, j in diffs:
            print("  %s  emails=%s  dashboard=%s" % (json.dumps(c), g, j))
        return 1
    print("No mismatches: the emails and the dashboard classify every comment the same way.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
