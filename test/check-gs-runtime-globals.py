#!/usr/bin/env python3
"""
check-gs-runtime-globals.py - flags JavaScript features/globals used in the .gs files that exist in a browser or in Node (where
this project's test runners run) but NOT in the Apps Script runtime, where the code and `runAllTests()` really run.

WHY (real incident, 2026-10-07): `Tests_OvernightEmailer.gs`'s `TestOE_decodeRawMime_` called atob() and `new TextDecoder()`.
Both exist in the headless-browser runner and (after a 2026-09-24 shim) in the Node CI sandbox, so every local run and every CI
run was green - but `runAllTests()` in the real editor threw "ReferenceError: atob is not defined" in three suites
(EmailInfra, OvernightEmailer, EmailLifecycleFullCycle), because Apps Script has neither. Nobody noticed for weeks because the
live suite could not run at all (a missing test file). Only comments and string literals are ignored; a hit is a lead to verify.

USAGE:   python3 test/check-gs-runtime-globals.py          (exit 0 = clean, 1 = at least one hit; run before pasting .gs files)
"""
import glob
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PATTERN = re.compile(
    r"\b(setTimeout|setInterval|performance\.now|Intl\.|Buffer\.|crypto\.|URLSearchParams|new URL\(|findLast|replaceAll|"
    r"structuredClone|Object\.fromEntries|matchAll|globalThis|window\.|document\.|require\(|process\.|atob|btoa|TextDecoder|"
    r"TextEncoder|fetch\(|localStorage|queueMicrotask|Promise|async |await )"
)
STRINGS = re.compile(r"'(?:\\.|[^'\\\n])*'|\"(?:\\.|[^\"\\\n])*\"|`(?:\\.|[^`\\])*`")


def main() -> int:
    hits = 0
    for path in sorted(glob.glob(os.path.join(ROOT, "*.gs"))):
        src = open(path, encoding="utf-8").read()
        src = re.sub(r"/\*.*?\*/", lambda m: "\n" * m.group(0).count("\n"), src, flags=re.S)
        for n, line in enumerate(src.split("\n"), 1):
            code = re.sub(r"//.*$", "", STRINGS.sub("''", line))
            m = PATTERN.search(code)
            if m:
                hits += 1
                print(f"{os.path.basename(path)}:{n}: {m.group(0)!r}  | {line.strip()[:110]}")
    if hits:
        print(f"\n{hits} line(s) use something the Apps Script runtime may not have - verify each (CLAUDE.md, 'live runAllTests').")
        return 1
    print("Clean - no browser/Node-only globals in any .gs file (comments and string literals ignored).")
    return 0


if __name__ == "__main__":
    sys.exit(main())
