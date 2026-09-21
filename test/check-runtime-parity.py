#!/usr/bin/env python3
"""check-runtime-parity.py -- diffs the duplicated-logic pairs HANDOVER.md
section 6 documents between js/*.js (browser) and the matching .gs file
(Apps Script). The two runtimes can't share code (browser can't `import`
Apps Script and vice versa), so every pair below is edited by hand, on
both sides, whenever one changes -- and nothing else in this codebase
catches the two sides silently disagreeing. HANDOVER.md section 6 states
the risk in prose ("A new comment pattern... needs a keyword added to
BOTH OUTCOME_RULES (dashboard) and OUTCOME_RULES_GS_ (automatic
emails)"); this script is that same rule turned into something that
fails on its own instead of relying on a session remembering it.

USAGE
    python3 test/check-runtime-parity.py [--strict]

Exits 0 by default regardless of findings (advisory, like
check-docs-coverage.js) -- prints a report. --strict exits 1 on any
mismatch, for wiring into CI once these pairs have proven stable in
day-to-day use without false positives.

WHAT IT DOES AND DOESN'T CATCH
Each pair below is a plain-data JS/GS constant (an object, array, Set, or
scalar literal) parsed with a small tolerant JS-literal parser (below) --
not a real JS engine. Where a pair's shape includes a function/arrow value
(e.g. OUTCOME_RULES' `test:`, RM_PERF_RULES' `eligible:`), that field is
recorded as opaque "<code>" and EXCLUDED from the diff -- this script
compares the DATA these rules carry (keyword lists, weights, labels), not
the matching algorithm itself. A behavioral difference hidden entirely
inside a test/eligible function body (not in the signals/weights around
it) is NOT something this script can see; that class of bug needs the
existing dual test suites (Tests_*.gs / frontend-harness.html) to keep
asserting the same scenarios on both sides.
"""

import re
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
STRICT = "--strict" in sys.argv


class JsLiteralError(Exception):
    pass


# ---------------------------------------------------------------------
# A small, tolerant JS-literal parser: object/array/string/number/bool/
# null/`new Set([...])`. Anything else encountered as an object VALUE
# (a function, arrow, ternary, etc.) is captured as the opaque string
# "<code: ...>" rather than raising -- so a rule array mixing real data
# fields with function fields (OUTCOME_RULES, RM_PERF_RULES) still
# parses in full; callers decide which fields to compare.
# ---------------------------------------------------------------------

def skip_ws_and_comments(text, pos):
    n = len(text)
    while pos < n:
        ch = text[pos]
        if ch in " \t\r\n":
            pos += 1
        elif text.startswith("//", pos):
            nl = text.find("\n", pos)
            pos = n if nl < 0 else nl + 1
        elif text.startswith("/*", pos):
            end = text.find("*/", pos + 2)
            pos = n if end < 0 else end + 2
        else:
            break
    return pos


def parse_js_string(text, pos):
    quote = text[pos]
    i = pos + 1
    out = []
    n = len(text)
    while i < n and text[i] != quote:
        ch = text[i]
        if ch == "\\" and i + 1 < n:
            esc = text[i + 1]
            out.append({"n": "\n", "t": "\t", "r": "\r", "'": "'", '"': '"', "\\": "\\"}.get(esc, esc))
            i += 2
        else:
            out.append(ch)
            i += 1
    if i >= n:
        raise JsLiteralError("unterminated string at %d" % pos)
    return "".join(out), i + 1


def scan_opaque_value(text, pos):
    # Used for a value this parser doesn't otherwise recognize (a
    # function/arrow/expression) -- scans to the top-level ',' or the
    # enclosing container's own close, respecting nesting, strings AND
    # comments, so a comma/brace/apostrophe INSIDE the function body (or
    # inside a `//` comment within it -- an English "doesn't"/"can't" is
    # exactly as real a hazard here as a real string, and without this
    # check gets misread as opening a string that only closes at the next
    # apostrophe anywhere later in the file) is never mistaken for this
    # field's own end.
    n = len(text)
    depth = 0
    i = pos
    start = pos
    while i < n:
        if text.startswith("//", i):
            nl = text.find("\n", i)
            i = n if nl < 0 else nl + 1
            continue
        if text.startswith("/*", i):
            end = text.find("*/", i + 2)
            i = n if end < 0 else end + 2
            continue
        ch = text[i]
        if ch in ("'", '"'):
            _, i = parse_js_string(text, i)
            continue
        if ch in "([{":
            depth += 1
        elif ch in ")]}":
            if depth == 0:
                break
            depth -= 1
        elif ch == "," and depth == 0:
            break
        i += 1
    raw = text[start:i].strip()
    label = re.sub(r"\s+", " ", raw)
    if len(label) > 60:
        label = label[:57] + "..."
    return "<code: %s>" % label, i


def parse_js_value(text, pos):
    pos = skip_ws_and_comments(text, pos)
    if pos >= len(text):
        raise JsLiteralError("unexpected end of input")
    ch = text[pos]
    if ch == "{":
        return parse_js_object(text, pos)
    if ch == "[":
        return parse_js_array(text, pos)
    if ch in ("'", '"'):
        return parse_js_string(text, pos)
    if text.startswith("new Set(", pos):
        inner_pos = skip_ws_and_comments(text, text.index("(", pos) + 1)
        arr, after = parse_js_array(text, inner_pos)
        after = skip_ws_and_comments(text, after)
        if after >= len(text) or text[after] != ")":
            raise JsLiteralError("expected ')' closing new Set( at %d" % pos)
        return arr, after + 1
    m = re.match(r"-?\d+(\.\d+)?", text[pos:])
    if m and not text.startswith(("true", "false", "null"), pos):
        s = m.group(0)
        val = float(s) if "." in s else int(s)
        return val, pos + len(s)
    if text.startswith("true", pos) and not text[pos + 4:pos + 5].isalnum():
        return True, pos + 4
    if text.startswith("false", pos) and not text[pos + 5:pos + 6].isalnum():
        return False, pos + 5
    if text.startswith("null", pos) and not text[pos + 4:pos + 5].isalnum():
        return None, pos + 4
    # Not a recognized plain-data value -- opaque fallback (function,
    # arrow, Object.keys(...), ternary, etc.)
    return scan_opaque_value(text, pos)


def parse_js_object(text, pos):
    assert text[pos] == "{"
    i = skip_ws_and_comments(text, pos + 1)
    obj = {}
    if i < len(text) and text[i] == "}":
        return obj, i + 1
    while True:
        i = skip_ws_and_comments(text, i)
        if text[i] in ("'", '"'):
            key, i = parse_js_string(text, i)
        else:
            m = re.match(r"[A-Za-z_$][\w$]*", text[i:])
            if not m:
                raise JsLiteralError("expected object key at %d: ...%r" % (i, text[i:i + 40]))
            key = m.group(0)
            i += len(key)
        i = skip_ws_and_comments(text, i)
        if text[i] != ":":
            raise JsLiteralError("expected ':' after key %r at %d" % (key, i))
        i = skip_ws_and_comments(text, i + 1)
        val, i = parse_js_value(text, i)
        obj[key] = val
        i = skip_ws_and_comments(text, i)
        if i < len(text) and text[i] == ",":
            i = skip_ws_and_comments(text, i + 1)
            if i < len(text) and text[i] == "}":
                return obj, i + 1
            continue
        if i < len(text) and text[i] == "}":
            return obj, i + 1
        raise JsLiteralError("expected ',' or '}' at %d: ...%r" % (i, text[i:i + 40]))


def parse_js_array(text, pos):
    assert text[pos] == "["
    i = skip_ws_and_comments(text, pos + 1)
    arr = []
    if i < len(text) and text[i] == "]":
        return arr, i + 1
    while True:
        i = skip_ws_and_comments(text, i)
        val, i = parse_js_value(text, i)
        arr.append(val)
        i = skip_ws_and_comments(text, i)
        if i < len(text) and text[i] == ",":
            i = skip_ws_and_comments(text, i + 1)
            if i < len(text) and text[i] == "]":
                return arr, i + 1
            continue
        if i < len(text) and text[i] == "]":
            return arr, i + 1
        raise JsLiteralError("expected ',' or ']' at %d: ...%r" % (i, text[i:i + 40]))


def extract_named_value(file_text, name):
    """Finds `const NAME = <value>` / `let NAME = <value>` / `NAME: <value>`
    (whichever occurs) and parses <value> with the tolerant parser above."""
    decl_re = re.compile(r"\b(?:const|let|var)\s+" + re.escape(name) + r"\s*=\s*")
    m = decl_re.search(file_text)
    if not m:
        prop_re = re.compile(r"(?<![\w$])" + re.escape(name) + r"\s*:\s*")
        m = prop_re.search(file_text)
    if not m:
        return None
    value, _end = parse_js_value(file_text, m.end())
    return value


def load(rel_path):
    p = REPO_ROOT / rel_path
    if not p.is_file():
        return None
    return p.read_text(encoding="utf-8")


# ---------------------------------------------------------------------
# The pairs -- names and file locations transcribed from HANDOVER.md
# section 6's own table. Keep this list in sync with that table: if a
# pair is renamed/moved there, update it here in the same commit (same
# discipline CLAUDE.md already asks for everywhere else in this repo).
# ---------------------------------------------------------------------

PLAIN_PAIRS = [
    # (label, js_file, js_name, gs_file, gs_name)
    ("HEADER_ALIASES", "js/core-sheets-fetch.js", "HEADER_ALIASES", "Core.gs", "HEADER_ALIASES_"),
    ("FOLLOWUP_SUGGESTIONS", "js/core-outcome-engine.js", "FOLLOWUP_SUGGESTIONS", "FollowupEngine.gs", "FOLLOWUP_SUGGESTIONS_GS_"),
    ("REGION_GROUP_MAP", "js/reports-build.js", "REGION_GROUP_MAP", "EmailInfra.gs", "REGION_GROUP_MAP_"),
    ("FUNNEL_ORDER", "js/core-foundation.js", "FUNNEL_ORDER", "Core.gs", "FUNNEL_ORDER_"),
    ("RM_PERF_RULE_WEIGHTS", "js/core-rm-performance.js", "RM_PERF_RULE_WEIGHTS", "DailyRmIssueLog.gs", "RM_PERF_RULE_WEIGHTS_GS_"),
    ("RM_PERF_SHRINKAGE_K", "js/core-rm-performance.js", "RM_PERF_SHRINKAGE_K", "DailyRmIssueLog.gs", "RM_PERF_SHRINKAGE_K_GS_"),
    ("RM_PERF_MIN_VOLUME_LEADS", "js/core-rm-performance.js", "RM_PERF_MIN_VOLUME_LEADS", "DailyRmIssueLog.gs", "RM_PERF_MIN_VOLUME_LEADS_GS_"),
    ("RM_PERF_CHRONIC_STREAK_DAYS", "js/core-rm-performance.js", "RM_PERF_CHRONIC_STREAK_DAYS", "DailyRmIssueLog.gs", "RM_PERF_CHRONIC_STREAK_DAYS_GS_"),
    ("RM_PERF_FLAG_RATIO", "js/core-rm-performance.js", "RM_PERF_FLAG_RATIO", "DailyRmIssueLog.gs", "RM_PERF_FLAG_RATIO_GS_"),
    ("RM_PERF_CONCENTRATION_BREADTH_CEILING", "js/core-rm-performance.js", "RM_PERF_CONCENTRATION_BREADTH_CEILING", "DailyRmIssueLog.gs", "RM_PERF_CONCENTRATION_BREADTH_CEILING_GS_"),
    ("RM_PERF_NAME_ALIASES", "js/core-rm-performance.js", "RM_PERF_NAME_ALIASES", "DailyRmIssueLog.gs", "RM_PERF_NAME_ALIASES_GS_"),
    ("RM_PERF_LEADERSHIP_NAME_EXCLUSIONS", "js/core-rm-performance.js", "RM_PERF_LEADERSHIP_NAME_EXCLUSIONS", "DailyRmIssueLog.gs", "RM_PERF_LEADERSHIP_NAME_EXCLUSIONS_GS_"),
    ("RM_PERF_NON_RM_ROLES", "js/core-rm-performance.js", "RM_PERF_NON_RM_ROLES", "DailyRmIssueLog.gs", "RM_PERF_NON_RM_ROLES_GS_"),
]

# TEST_MODE_OVERRIDE_EMAIL: compared like a plain pair AND separately
# checked to be '' (the safe/prod value) on both sides -- a non-empty
# value left on either side silently redirects real production email.
TEST_MODE_PAIR = ("TEST_MODE_OVERRIDE_EMAIL", "js/reports-ui.js", "TEST_MODE_OVERRIDE_EMAIL", "EmailInfra.gs", "TEST_MODE_OVERRIDE_EMAIL_")

# Rule arrays: compare only the named DATA fields per rule, keyed by
# key_field; every other field (typically a test/eligible function) is
# left opaque and excluded from the diff -- see module docstring.
RULESET_PAIRS = [
    {
        "label": "OUTCOME_RULES (keyword coverage)",
        "js": ("js/core-outcome-engine.js", "OUTCOME_RULES"),
        "gs": ("FollowupEngine.gs", "OUTCOME_RULES_GS_"),
        "key_field": "outcome",
        "compare_fields": ["signals"],
    },
    {
        "label": "RM_PERF_RULES (key/label)",
        "js": ("js/core-rm-performance.js", "RM_PERF_RULES"),
        "gs": ("DailyRmIssueLog.gs", "RM_PERF_RULES_GS_"),
        "key_field": "key",
        "compare_fields": ["label"],
    },
]


def normalize_for_diff(v):
    if isinstance(v, list):
        # Order doesn't matter for keyword/role lists in this codebase --
        # every pair here is a lookup set, never a positionally-meaningful
        # sequence except FUNNEL_ORDER, which is compared separately.
        return tuple(sorted(v, key=lambda x: str(x)))
    return v


def report_plain_pair(label, js_file, js_name, gs_file, gs_name, findings):
    js_text = load(js_file)
    gs_text = load(gs_file)
    if js_text is None:
        findings.append("SKIP %s -- %s not found" % (label, js_file))
        return
    if gs_text is None:
        findings.append("SKIP %s -- %s not found" % (label, gs_file))
        return
    try:
        js_val = extract_named_value(js_text, js_name)
    except JsLiteralError as e:
        findings.append("SKIP %s -- could not parse %s in %s (%s)" % (label, js_name, js_file, e))
        return
    try:
        gs_val = extract_named_value(gs_text, gs_name)
    except JsLiteralError as e:
        findings.append("SKIP %s -- could not parse %s in %s (%s)" % (label, gs_name, gs_file, e))
        return
    if js_val is None:
        findings.append("SKIP %s -- %s not found in %s" % (label, js_name, js_file))
        return
    if gs_val is None:
        findings.append("SKIP %s -- %s not found in %s" % (label, gs_name, gs_file))
        return

    if label == "FUNNEL_ORDER":
        # Order IS meaningful here (funnel stage sequence) -- exact
        # positional comparison, not the sorted-tuple normalization below.
        if js_val != gs_val:
            findings.append("MISMATCH %s: order/contents differ\n    js (%s): %r\n    gs (%s): %r" % (label, js_file, js_val, gs_file, gs_val))
        return

    if normalize_for_diff(js_val) == normalize_for_diff(js_val) and js_val == gs_val:
        return
    if isinstance(js_val, dict) and isinstance(gs_val, dict):
        js_keys, gs_keys = set(js_val), set(gs_val)
        only_js = js_keys - gs_keys
        only_gs = gs_keys - js_keys
        diff_vals = {k for k in (js_keys & gs_keys) if normalize_for_diff(js_val[k]) != normalize_for_diff(gs_val[k])}
        if only_js or only_gs or diff_vals:
            msg = ["MISMATCH %s (%s vs %s):" % (label, js_file, gs_file)]
            if only_js:
                msg.append("    only in js: %s" % sorted(only_js))
            if only_gs:
                msg.append("    only in gs: %s" % sorted(only_gs))
            for k in sorted(diff_vals):
                msg.append("    %r differs: js=%r gs=%r" % (k, js_val[k], gs_val[k]))
            findings.append("\n".join(msg))
        return
    if isinstance(js_val, list) and isinstance(gs_val, list):
        if normalize_for_diff(js_val) != normalize_for_diff(gs_val):
            only_js = set(js_val) - set(gs_val)
            only_gs = set(gs_val) - set(js_val)
            msg = ["MISMATCH %s (%s vs %s):" % (label, js_file, gs_file)]
            if only_js:
                msg.append("    only in js: %s" % sorted(only_js, key=str))
            if only_gs:
                msg.append("    only in gs: %s" % sorted(only_gs, key=str))
            findings.append("\n".join(msg))
        return
    if js_val != gs_val:
        findings.append("MISMATCH %s: js (%s) = %r, gs (%s) = %r" % (label, js_file, js_val, gs_file, gs_val))


def report_ruleset_pair(spec, findings):
    label = spec["label"]
    key_field = spec["key_field"]
    compare_fields = spec["compare_fields"]
    js_file, js_name = spec["js"]
    gs_file, gs_name = spec["gs"]
    js_text = load(js_file)
    gs_text = load(gs_file)
    if js_text is None or gs_text is None:
        findings.append("SKIP %s -- source file missing" % label)
        return
    try:
        js_arr = extract_named_value(js_text, js_name)
        gs_arr = extract_named_value(gs_text, gs_name)
    except JsLiteralError as e:
        findings.append("SKIP %s -- parse error (%s)" % (label, e))
        return
    if js_arr is None or gs_arr is None:
        findings.append("SKIP %s -- array not found on one side" % label)
        return

    js_by_key = {item.get(key_field): item for item in js_arr if isinstance(item, dict) and key_field in item}
    gs_by_key = {item.get(key_field): item for item in gs_arr if isinstance(item, dict) and key_field in item}

    only_js = set(js_by_key) - set(gs_by_key)
    only_gs = set(gs_by_key) - set(js_by_key)
    msg = []
    if only_js:
        msg.append("    %s only in js (%s): %s" % (key_field, js_file, sorted(only_js, key=str)))
    if only_gs:
        msg.append("    %s only in gs (%s): %s" % (key_field, gs_file, sorted(only_gs, key=str)))
    for k in sorted(set(js_by_key) & set(gs_by_key), key=str):
        for field in compare_fields:
            jv = normalize_for_diff(js_by_key[k].get(field))
            gv = normalize_for_diff(gs_by_key[k].get(field))
            if jv != gv:
                only_j = set(js_by_key[k].get(field) or []) - set(gs_by_key[k].get(field) or []) if isinstance(js_by_key[k].get(field), list) else None
                only_g = set(gs_by_key[k].get(field) or []) - set(js_by_key[k].get(field) or []) if isinstance(gs_by_key[k].get(field), list) else None
                if only_j is not None:
                    detail = []
                    if only_j:
                        detail.append("only in js: %s" % sorted(only_j))
                    if only_g:
                        detail.append("only in gs: %s" % sorted(only_g))
                    msg.append("    %r=%r: %s.%s differs -- %s" % (key_field, k, k, field, "; ".join(detail)))
                else:
                    msg.append("    %r=%r: %s.%s differs -- js=%r gs=%r" % (key_field, k, k, field, jv, gv))
    if msg:
        findings.append("MISMATCH %s:\n%s" % (label, "\n".join(msg)))


def main():
    findings = []

    for label, js_file, js_name, gs_file, gs_name in PLAIN_PAIRS:
        report_plain_pair(label, js_file, js_name, gs_file, gs_name, findings)

    label, js_file, js_name, gs_file, gs_name = TEST_MODE_PAIR
    js_text, gs_text = load(js_file), load(gs_file)
    if js_text is not None and gs_text is not None:
        try:
            js_val = extract_named_value(js_text, js_name)
            gs_val = extract_named_value(gs_text, gs_name)
            if js_val != "":
                findings.append("PROD SAFETY %s: %s currently = %r in %s (not empty -- would silently redirect real email if left this way)" % (label, js_name, js_val, js_file))
            if gs_val != "":
                findings.append("PROD SAFETY %s: %s currently = %r in %s (not empty -- would silently redirect real email if left this way)" % (label, gs_name, gs_val, gs_file))
            if js_val != gs_val:
                findings.append("MISMATCH %s: js=%r gs=%r" % (label, js_val, gs_val))
        except JsLiteralError as e:
            findings.append("SKIP %s -- parse error (%s)" % (label, e))

    for spec in RULESET_PAIRS:
        report_ruleset_pair(spec, findings)

    print("=" * 60)
    print("check-runtime-parity.py -- browser vs Apps Script duplicated-logic pairs")
    print("(HANDOVER.md section 6)")
    print("=" * 60)
    print("Checked %d plain pairs, 1 prod-safety pair, %d ruleset pairs." % (len(PLAIN_PAIRS), len(RULESET_PAIRS)))
    print()

    mismatches = [f for f in findings if f.startswith("MISMATCH") or f.startswith("PROD SAFETY")]
    skips = [f for f in findings if f.startswith("SKIP")]

    if mismatches:
        print("MISMATCHES -- %d:" % len(mismatches))
        for f in mismatches:
            print(f)
        print()
    else:
        print("No mismatches -- every checked pair agrees between the two runtimes.")
        print()

    if skips:
        print("SKIPPED (parser limitation or file moved -- not a pass, needs a look):")
        for f in skips:
            print("  " + f)
        print()

    print("=" * 60)

    if STRICT and mismatches:
        sys.exit(1)


if __name__ == "__main__":
    main()
