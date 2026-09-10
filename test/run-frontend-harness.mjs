/**
 * run-frontend-harness.mjs — runs tests/frontend-harness.html headless in
 * CI. Forensic audit P2 item 13 (t-tf-5ad22d8e4c2e).
 *
 * The harness must be SERVED over http (it fetch()es ../dashboard.html),
 * so the CI step starts `python3 -m http.server` first, then runs this.
 * It navigates to the harness, waits for the `HARNESS_RESULT` console
 * line (emitted right after window.__harnessResults is set), prints the
 * summary, and exits non-zero if any assertion failed.
 *
 * NON-BLOCKING in the workflow for now (continue-on-error: true) — the
 * harness has real timing assumptions and this is its first CI wiring.
 * Flip to blocking once it's proven stable over a few runs.
 *
 * Usage: node test/run-frontend-harness.mjs [http://localhost:8000]
 */
import { chromium } from 'playwright';

const base = process.argv[2] || 'http://localhost:8000';
const url = `${base}/tests/frontend-harness.html`;
const TIMEOUT_MS = 60000;

const browser = await chromium.launch();
const page = await browser.newPage();

let result = null;
const consoleErrors = [];
page.on('console', (msg) => {
  const text = msg.text();
  if (text.startsWith('HARNESS_RESULT')) {
    try { result = JSON.parse(text.slice('HARNESS_RESULT'.length).trim()); } catch {}
  }
  if (msg.type() === 'error') consoleErrors.push(text);
});
page.on('pageerror', (err) => consoleErrors.push('pageerror: ' + err.message));

console.log(`[harness] loading ${url}`);
await page.goto(url, { waitUntil: 'load', timeout: 15000 });

// wait for the harness to finish (it sets window.__harnessResults)
try {
  await page.waitForFunction('window.__harnessResults !== undefined', { timeout: TIMEOUT_MS });
} catch {
  console.error(`[harness] TIMED OUT after ${TIMEOUT_MS}ms — window.__harnessResults never set`);
  const status = await page.locator('#__harnessUi span, #__harnessUi').first().textContent().catch(() => null);
  if (status) console.error('[harness] on-page status: ' + status.trim().slice(0, 400));
}

if (!result) {
  result = await page.evaluate('window.__harnessResults || null').catch(() => null);
}
await browser.close();

if (!result) {
  console.error('[harness] no result — treating as failure');
  process.exit(1);
}
console.log(`[harness] ${result.pass} passed, ${result.fail} failed`);
if (result.failures && result.failures.length) {
  console.log('[harness] failures:');
  for (const f of result.failures) console.log('  - ' + f);
}
// console errors beyond the known-harmless background 401s
const realErrors = consoleErrors.filter((e) => !/401|Failed to load resource/.test(e));
if (realErrors.length) {
  console.log('[harness] console errors:');
  for (const e of realErrors) console.log('  ! ' + e);
}
process.exit(result.fail > 0 ? 1 : 0);
