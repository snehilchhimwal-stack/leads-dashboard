/**
 * run-frontend-harness.mjs — runs tests/frontend-harness.html headless.
 * Forensic audit P2 item 13 (t-tf-5ad22d8e4c2e).
 *
 * The harness must be SERVED over http (it fetch()es ../dashboard.html),
 * so the caller starts `python3 -m http.server` first, then runs this.
 * This navigates to the harness page, waits for it to set
 * window.__harnessResults (it also logs a `HARNESS_RESULT {...}` console
 * line at the same moment), prints the summary + every failing assertion,
 * and exits non-zero if any assertion failed or the harness never
 * produced a result.
 *
 * In CI it runs as its own job (`frontend-harness`) on the official
 * Playwright container (`mcr.microsoft.com/playwright:vX-jammy`) so the
 * browser + all system libs are already present — the ~28s
 * missing-system-libs launch failure on the bare runner (fd59944) is
 * gone. BLOCKING there.
 *
 * Usage: node test/run-frontend-harness.mjs [http://127.0.0.1:8000]
 */
import { chromium } from 'playwright';

const base = (process.argv[2] || 'http://127.0.0.1:8000').replace(/\/$/, '');
const url = `${base}/tests/frontend-harness.html`;
const GOTO_MS = 30000;
const FINISH_MS = 90000;

const consoleLines = [];

let browser;
try {
  browser = await chromium.launch();
} catch (e) {
  console.error('[harness] chromium.launch() failed — the browser or its system libraries are missing.');
  console.error('[harness] ' + (e && e.message));
  console.error('[harness] In CI this job must run on mcr.microsoft.com/playwright:<version>-jammy.');
  process.exit(1);
}

const page = await browser.newPage();
let result = null;

page.on('console', (msg) => {
  const text = msg.text();
  consoleLines.push(`[${msg.type()}] ${text}`);
  if (text.startsWith('HARNESS_RESULT')) {
    try { result = JSON.parse(text.slice('HARNESS_RESULT'.length).trim()); } catch {}
  }
});
page.on('pageerror', (err) => consoleLines.push(`[pageerror] ${err && err.message}`));
page.on('requestfailed', (req) => consoleLines.push(`[requestfailed] ${req.url()} — ${req.failure()?.errorText}`));

async function dumpPage(reason) {
  console.error(`[harness] ${reason}`);
  const ui = await page.locator('#__harnessUi').first().textContent().catch(() => null);
  if (ui) console.error('[harness] on-page harness UI text:\n' + ui.trim().slice(0, 1200));
  const body = await page.evaluate(() => document.body.innerText).catch(() => null);
  if (body) console.error('[harness] page body (first 1500 chars):\n' + body.trim().slice(0, 1500));
  if (consoleLines.length) {
    console.error('[harness] browser console (all lines):');
    for (const l of consoleLines) console.error('  ' + l);
  }
}

console.log(`[harness] loading ${url}`);
try {
  await page.goto(url, { waitUntil: 'load', timeout: GOTO_MS });
} catch (e) {
  await dumpPage(`page.goto failed: ${e && e.message}`);
  await browser.close();
  process.exit(1);
}

try {
  await page.waitForFunction('window.__harnessResults !== undefined', { timeout: FINISH_MS });
} catch {
  await dumpPage(`TIMED OUT after ${FINISH_MS}ms — window.__harnessResults never set`);
}

if (!result) {
  result = await page.evaluate('window.__harnessResults || null').catch(() => null);
}
await browser.close();

if (!result) {
  console.error('[harness] no result produced — FAIL');
  process.exit(1);
}

console.log(`[harness] ${result.pass} passed, ${result.fail} failed`);
if (result.failures && result.failures.length) {
  console.log('[harness] failing assertions:');
  for (const f of result.failures) console.log('  - ' + f);
}
const realErrors = consoleLines.filter(
  (l) => /^\[(error|pageerror)\]/.test(l) && !/401|Failed to load resource/.test(l),
);
if (realErrors.length) {
  console.log('[harness] console errors:');
  for (const e of realErrors) console.log('  ! ' + e);
}
process.exit(result.fail > 0 ? 1 : 0);
