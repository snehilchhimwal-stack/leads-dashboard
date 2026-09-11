#!/usr/bin/env python3
"""
Runs the SAME Apps Script test suite (Tests_*.gs) test/run-gs-tests.js runs
in CI, but locally on a machine with no Node.js — using a real, already-
installed Chrome/Edge browser in HEADLESS mode (via Playwright's Python
driver: `pip install playwright`, no `playwright install` browser download
needed, since --channel points at the system browser directly) as the
JS engine instead of Node's `vm` module.

WHY THIS EXISTS: this machine has no local Node (CLAUDE.md), so
`node test/run-gs-tests.js` can't run here — every prior local verification
of a Tests_*.gs change had to either push blind and poll CI, or drive the
full interactive Browser pane (a visible GUI tab) as an ad hoc JS sandbox.
Both work, but neither is a real local test runner: pushing blind means a
red CI run is the first signal of a bug (real incident: commit 8eb4b85,
2026-09-11 — a self-referential test-fixture peer pool bug only surfaced
after a live CI failure with no accessible logs, since this session had no
admin rights to download them via the Actions API). This script closes
that gap — a real, fast, local "does the suite still pass" check, run
BEFORE pushing.

HOW: identical model to test/run-gs-tests.js's own docstring — Apps Script
shares one global scope across every .gs file pasted into a project, so
every production .gs file + every Tests_*.gs file is concatenated into ONE
script and evaluated together in one shot inside a headless page (NOT one
eval() call per file — a real browser's separate top-level `eval()` calls
do NOT share `const`/`let` bindings the way Node's `vm.Script.runInContext`
does across repeated calls; confirmed by hand this session). The file
lists themselves are read directly out of test/run-gs-tests.js's own
PRODUCTION_FILES/TEST_FILES arrays (regex-extracted, not retyped) so this
script can never drift out of sync with the real CI file list — the exact
"forgot to register file X in one of three places" class of bug CLAUDE.md
already documents for Tests_RunAll.gs/run-gs-tests.js.

The host-global shims (SpreadsheetApp/GmailApp/Utilities/ScriptApp/Logger)
are a straight port of run-gs-tests.js's own buildSandbox()/formatDateIST
-- kept in sync BY HAND, same discipline as every other "mirror this on
both sides" pair in this codebase (see DailyRmIssueLog.gs's own
RM_PERF_NAME_ALIASES_GS_ comment for the established pattern). If
run-gs-tests.js's shims change, port the change here too.

USAGE:
    python3 test/run-gs-tests-headless.py

Exit code 0 = every assertion passed. Exit code 1 = at least one failure,
a load/syntax error, or no browser channel could be launched (falls back
through chrome -> msedge -> chromium, printing which one worked).

This is a LOCAL DEV CONVENIENCE, not a CI replacement — the real gate is
still GitHub Actions (`.github/workflows/test.yml`'s `test` job, which
runs the Node version of this same suite). Use this to catch a broken
fixture or a real regression before pushing, not as a substitute for a
green CI run.
"""
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
RUN_GS_TESTS_JS = ROOT / "test" / "run-gs-tests.js"

# ---- Host-global shims, ported from test/run-gs-tests.js's buildSandbox()
# and formatDateIST. Keep in sync by hand if that file's shims change. ----
SANDBOX_SHIM_JS = r"""
(function () {
  const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
  const MONTH_ABBR = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  function pad2(n) { return String(n).padStart(2, '0'); }
  function formatDateIST(date, timeZone, format) {
    const d = date instanceof Date ? date : new Date(date);
    const ist = new Date(d.getTime() + IST_OFFSET_MS);
    const h24 = ist.getUTCHours();
    let h12 = h24 % 12; if (h12 === 0) h12 = 12;
    const tokenMap = {
      yyyy: String(ist.getUTCFullYear()), MMM: MONTH_ABBR[ist.getUTCMonth()],
      MM: pad2(ist.getUTCMonth() + 1), dd: pad2(ist.getUTCDate()),
      HH: pad2(h24), mm: pad2(ist.getUTCMinutes()), ss: pad2(ist.getUTCSeconds()),
      d: String(ist.getUTCDate()), h: String(h12), a: h24 < 12 ? 'AM' : 'PM',
    };
    return String(format).replace(/yyyy|MMM|MM|dd|HH|mm|ss|d|h|a/g, function (tok) { return tokenMap[tok]; });
  }

  window.SpreadsheetApp = {};
  window.GmailApp = {};
  window.Utilities = {
    formatDate: formatDateIST,
    newBlob: function (data) {
      const bytes = Array.from(new TextEncoder().encode(String(data)));
      return {
        getBytes: function () { return bytes; },
        getDataAsString: function () { return String(data); },
        getContentType: function () { return 'application/octet-stream'; },
      };
    },
    base64EncodeWebSafe: function (bytes) {
      let bin = '';
      for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
      return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_');
    },
    // crypto.randomUUID() requires a "secure context" (HTTPS/localhost) --
    // a page with no navigation (default about:blank) or a data: URL is
    // NEITHER, so it's undefined there (confirmed by hand; real incident:
    // this exact gap silently broke 3 Tests_OvernightEmailer assertions
    // the first time this script ran, surfacing as "TypeError: crypto.
    // randomUUID is not a function" deep inside sendThreadedGmailReply_,
    // caught by its own try/catch and mis-reported as "Gmail API not
    // enabled"). crypto.getRandomValues() has no such restriction, so
    // build a real v4 UUID from it by hand instead of depending on
    // randomUUID or on navigating this script to a specific origin.
    getUuid: function () {
      const b = crypto.getRandomValues(new Uint8Array(16));
      b[6] = (b[6] & 0x0f) | 0x40; // version 4
      b[8] = (b[8] & 0x3f) | 0x80; // variant 10xx
      const hex = Array.from(b, function (x) { return x.toString(16).padStart(2, '0'); });
      return hex.slice(0, 4).join('') + '-' + hex.slice(4, 6).join('') + '-' + hex.slice(6, 8).join('') + '-' + hex.slice(8, 10).join('') + '-' + hex.slice(10, 16).join('');
    },
    sleep: function () {},
    // computeDigest/DigestAlgorithm: added for the Lead History &
    // Versioning Review's Phase 6/7 (content-hash dedup,
    // MovementTracker.gs's _leadContentHashGs_). Real Apps Script's
    // Utilities.computeDigest is SYNCHRONOUS — the browser's own
    // crypto.subtle.digest is Promise-based and can't stand in for it
    // without making every caller async, a much bigger change than this
    // shim warrants. A small, standard, synchronous SHA-256 (FIPS 180-4)
    // implementation instead — deterministic, no external dependency,
    // matches real Utilities.computeDigest's byte-array return shape
    // (signed bytes, -128..127, same as real Apps Script).
    DigestAlgorithm: { SHA_256: 'SHA_256' },
    computeDigest: function (algorithm, value) {
      if (algorithm !== 'SHA_256') throw new Error('TestMockUtilities_ computeDigest: only SHA_256 is implemented (got ' + algorithm + ')');
      const bytes = new TextEncoder().encode(String(value));
      const K = [
        0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
        0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
        0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
        0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
        0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
        0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
        0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
        0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
      ];
      let h0 = 0x6a09e667, h1 = 0xbb67ae85, h2 = 0x3c6ef372, h3 = 0xa54ff53a;
      let h4 = 0x510e527f, h5 = 0x9b05688c, h6 = 0x1f83d9ab, h7 = 0x5be0cd19;
      const bitLen = bytes.length * 8;
      const padLen = ((bytes.length + 9 <= (Math.ceil((bytes.length + 9) / 64) * 64)) ? Math.ceil((bytes.length + 9) / 64) * 64 : 0);
      const msg = new Uint8Array(padLen);
      msg.set(bytes);
      msg[bytes.length] = 0x80;
      const dv = new DataView(msg.buffer);
      dv.setUint32(padLen - 4, bitLen >>> 0, false);
      dv.setUint32(padLen - 8, Math.floor(bitLen / 4294967296), false);
      const w = new Uint32Array(64);
      for (let chunk = 0; chunk < padLen; chunk += 64) {
        for (let i = 0; i < 16; i++) w[i] = dv.getUint32(chunk + i * 4, false);
        for (let i = 16; i < 64; i++) {
          const s0 = ((w[i - 15] >>> 7) | (w[i - 15] << 25)) ^ ((w[i - 15] >>> 18) | (w[i - 15] << 14)) ^ (w[i - 15] >>> 3);
          const s1 = ((w[i - 2] >>> 17) | (w[i - 2] << 15)) ^ ((w[i - 2] >>> 19) | (w[i - 2] << 13)) ^ (w[i - 2] >>> 10);
          w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
        }
        let a = h0, b = h1, c = h2, d = h3, e = h4, f = h5, g = h6, h = h7;
        for (let i = 0; i < 64; i++) {
          const S1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7));
          const ch = (e & f) ^ (~e & g);
          const temp1 = (h + S1 + ch + K[i] + w[i]) >>> 0;
          const S0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10));
          const maj = (a & b) ^ (a & c) ^ (b & c);
          const temp2 = (S0 + maj) >>> 0;
          h = g; g = f; f = e; e = (d + temp1) >>> 0;
          d = c; c = b; b = a; a = (temp1 + temp2) >>> 0;
        }
        h0 = (h0 + a) >>> 0; h1 = (h1 + b) >>> 0; h2 = (h2 + c) >>> 0; h3 = (h3 + d) >>> 0;
        h4 = (h4 + e) >>> 0; h5 = (h5 + f) >>> 0; h6 = (h6 + g) >>> 0; h7 = (h7 + h) >>> 0;
      }
      const out = [];
      [h0, h1, h2, h3, h4, h5, h6, h7].forEach(function (h) {
        for (let shift = 24; shift >= 0; shift -= 8) {
          const byte = (h >>> shift) & 0xff;
          out.push(byte > 127 ? byte - 256 : byte); // signed, matches real Apps Script's byte[] return
        }
      });
      return out;
    },
  };
  window.ScriptApp = {};
  window.__ghtLogLines__ = [];
  window.Logger = { log: function () { window.__ghtLogLines__.push(Array.prototype.map.call(arguments, String).join(' ')); } };
})();
"""


def extract_file_list(js_source: str, const_name: str) -> list[str]:
    """Pulls e.g. PRODUCTION_FILES's array literal out of run-gs-tests.js
    by regex (not retyped by hand) so this script can't silently drift out
    of sync with the real CI file list."""
    m = re.search(const_name + r"\s*=\s*\[(.*?)\]", js_source, re.S)
    if not m:
        print(f"ERROR: could not find `{const_name}` in {RUN_GS_TESTS_JS}", file=sys.stderr)
        sys.exit(1)
    return re.findall(r"'([^']+)'", m.group(1))


def main() -> int:
    if not RUN_GS_TESTS_JS.exists():
        print(f"ERROR: {RUN_GS_TESTS_JS} not found — run this from the repo root.", file=sys.stderr)
        return 1
    js_source = RUN_GS_TESTS_JS.read_text(encoding="utf-8")
    production_files = extract_file_list(js_source, "PRODUCTION_FILES")
    test_files = extract_file_list(js_source, "TEST_FILES")
    all_files = production_files + test_files

    combined = [SANDBOX_SHIM_JS]
    for name in all_files:
        path = ROOT / name
        if not path.exists():
            print(f"ERROR: missing expected file: {name}", file=sys.stderr)
            return 1
        combined.append(f"\n//===FILE:{name}===\n" + path.read_text(encoding="utf-8") + "\n")
    combined.append("\nwindow.__ghtResult__ = runAllTests();\n")
    combined_js = "".join(combined)

    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        print("ERROR: the `playwright` package isn't installed. Run: python3 -m pip install playwright", file=sys.stderr)
        print("(No `playwright install` browser download needed — this script drives the system Chrome/Edge directly via --channel.)", file=sys.stderr)
        return 1

    launch_errors = []
    with sync_playwright() as p:
        browser = None
        for channel in ("chrome", "msedge", "chromium"):
            try:
                browser = p.chromium.launch(channel=channel, headless=True)
                print(f"(using headless '{channel}')")
                break
            except Exception as e:  # noqa: BLE001 — trying multiple channels deliberately
                launch_errors.append(f"{channel}: {e}")
        if browser is None:
            print("ERROR: could not launch a headless browser via any channel (chrome/msedge/chromium).", file=sys.stderr)
            for line in launch_errors:
                print("  " + line, file=sys.stderr)
            return 1

        page = browser.new_page()
        try:
            # Deliberately NOT page.evaluate(combined_js) directly --
            # Playwright's string-evaluate tries to parse its argument as a
            # single EXPRESSION and can throw a SyntaxError on some
            # multi-statement payloads (confirmed by hand). Passing the
            # source as an `arg` to a tiny arrow function that calls
            # window.eval() on it sidesteps that parsing entirely and
            # guarantees real top-level `var`/function-declaration
            # semantics (needed for e.g. Tests_Mocks.gs's bare
            # `Gmail = ...` global assignment to actually stick).
            page.evaluate("(src) => window.eval(src)", combined_js)
        except Exception as e:  # noqa: BLE001 — surfaced to the user below either way
            log_lines = page.evaluate("window.__ghtLogLines__ || []")
            print("LOAD/RUNTIME ERROR while evaluating the combined test suite:", file=sys.stderr)
            print(str(e), file=sys.stderr)
            if log_lines:
                print("\nLast log lines before the error:", file=sys.stderr)
                for line in log_lines[-30:]:
                    print("  " + line, file=sys.stderr)
            browser.close()
            return 1

        result = page.evaluate("window.__ghtResult__")
        log_lines = page.evaluate("window.__ghtLogLines__ || []")
        browser.close()

    fail_lines = [line for line in log_lines if "FAIL" in line]

    print("")
    print("======================================================")
    print(f"TOTAL (local headless-browser run): {result['pass']} passed, {result['fail']} failed")
    if result.get("failedFiles"):
        print("Failed: " + "; ".join(result["failedFiles"]))
    if fail_lines:
        print("")
        print("Failures:")
        for line in fail_lines:
            print("  " + line)
    print("======================================================")

    if result["fail"] > 0 or result["pass"] == 0:
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
