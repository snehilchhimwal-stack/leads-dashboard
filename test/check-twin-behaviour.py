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
        gs = gs_page.evaluate("(c) => c.map(s => inferOutcomeGs_(s))", corpus)
        js = js_page.evaluate("(c) => c.map(s => inferOutcome(s))", corpus)
        browser.close()

    diffs = [(c, g, j) for c, g, j in zip(corpus, gs, js) if g != j]
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
