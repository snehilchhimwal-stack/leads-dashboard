// ============================================================
// core-auth.js — the Google sign-in gate (access control). Split out
// of core.js (Phase 2 — see HANDOVER.md). Pure code motion — no logic
// changed. Distinct from js/reports-gmail.js's separate Gmail OAuth
// consent grant (connectGmail) — two independent consent flows sharing
// one Client ID, by design (see that file's own header).
// ============================================================


/* ============ SIGN-IN GATE (access control) ============
 * Nothing loads until this succeeds. "spreadsheets" is a broad scope (read
 * AND write, needed anyway for the Movement snapshot feature below) but,
 * unlike gmail.send, it isn't Google's "restricted/sensitive" tier — it
 * doesn't need the extra verification review that's been blocking Gmail
 * sign-in. userinfo.email just lets the header show whose account is
 * signed in. The token this produces is reused directly as the Bearer
 * token for every Sheets API read/write in this file (sheetsApiValuesGet,
 * appendToMovementLog) — there's deliberately no separate "Connect Sheets"
 * step anymore.
 *
 * The actual access control isn't anything in this file — it's Google's:
 * a signed-in account that isn't shared on the sheet gets a 403 from the
 * Sheets API itself (see the ACCESS_DENIED handling in fetchAndRender's
 * catch block). Whoever owns the sheet controls who's let in via its own
 * Share dialog, same as any other Google Sheet.
 */
const GATE_SCOPE = 'https://www.googleapis.com/auth/spreadsheets https://www.googleapis.com/auth/userinfo.email';

let gateTokenClient = null;
let gateAccessToken = '';
let gateTokenExpiresAt = 0;
let gateUserEmail = '';
let _gateSignInResolvers = [];

function gateTokenValid(){
  return !!gateAccessToken && Date.now() < gateTokenExpiresAt - 5000;
}

function initGateTokenClient(clientId){
  if (typeof google === 'undefined' || !google.accounts || !google.accounts.oauth2) return null;
  return google.accounts.oauth2.initTokenClient({
    client_id: clientId,
    scope: GATE_SCOPE,
    callback: (resp) => {
      const statusEl = document.getElementById('authGateStatus');
      if (resp.error) {
        if (statusEl) { statusEl.textContent = 'Sign-in failed: ' + resp.error; statusEl.style.color = 'var(--red)'; }
        gateAccessToken = '';
      } else {
        gateAccessToken = resp.access_token;
        gateTokenExpiresAt = Date.now() + (Number(resp.expires_in) || 3600) * 1000;
      }
      const resolvers = _gateSignInResolvers;
      _gateSignInResolvers = [];
      resolvers.forEach(r => r());
    },
  });
}

async function fetchGateUserEmail(){
  try {
    const resp = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
      headers: { Authorization: `Bearer ${gateAccessToken}` },
    });
    if (resp.ok) {
      const data = await resp.json();
      gateUserEmail = data.email || '';
    }
  } catch (e) { /* non-fatal — badge just stays blank */ }
}

// Resolves once a sign-in attempt settles (success OR failure/cancel) —
// callers check gateTokenValid() afterward rather than trusting the
// resolution itself, so a closed popup just leaves the gate as it was.
// Only ever call this from a real click handler the first time; later
// silent re-calls (expired token mid-session) reuse prompt:'' so they
// don't need a fresh gesture.
function gateSignIn(){
  return new Promise((resolve) => {
    const clientIdRow = document.getElementById('authGateClientIdRow');
    const clientIdInput = document.getElementById('gateClientIdInput');
    const statusEl = document.getElementById('authGateStatus');

    let clientId = getGmailClientId(); // same Client ID field Gmail setup uses — one Cloud project
    if (clientIdRow && clientIdRow.style.display !== 'none' && clientIdInput && clientIdInput.value.trim()) {
      clientId = clientIdInput.value.trim();
      setGmailClientId(clientId);
    }
    if (!clientId) {
      if (clientIdRow) clientIdRow.style.display = 'block';
      if (statusEl) { statusEl.textContent = 'Paste your Google OAuth Client ID first (one-time setup), then sign in.'; statusEl.style.color = 'var(--amber)'; }
      resolve();
      return;
    }
    if (clientIdRow) clientIdRow.style.display = 'none';

    if (!gateTokenClient) gateTokenClient = initGateTokenClient(clientId);
    if (!gateTokenClient) {
      if (statusEl) { statusEl.textContent = 'Google Sign-In library still loading — try again in a moment.'; statusEl.style.color = 'var(--amber)'; }
      resolve();
      return;
    }
    if (statusEl) { statusEl.textContent = 'Opening Google sign-in…'; statusEl.style.color = 'var(--text-faint)'; }
    _gateSignInResolvers.push(resolve);
    gateTokenClient.requestAccessToken({ prompt: gateAccessToken ? '' : 'consent' });
  });
}

async function handleGateSignInClick(){
  await gateSignIn();
  if (!gateTokenValid()) return;
  await fetchGateUserEmail();
  document.getElementById('authGate').style.display = 'none';
  document.getElementById('appShell').style.display = '';
  const badge = document.getElementById('gateUserBadge');
  if (badge) badge.textContent = gateUserEmail ? `Signed in as ${gateUserEmail}` : '';
  const statusEl = document.getElementById('authGateStatus');
  if (statusEl) statusEl.textContent = '';
  fetchAndRender();
}

function initAuthGate(){
  const clientId = getGmailClientId();
  const row = document.getElementById('authGateClientIdRow');
  const input = document.getElementById('gateClientIdInput');
  if (row) row.style.display = clientId ? 'none' : 'block';
  if (input && clientId) input.value = clientId;
  const btn = document.getElementById('gateSignInBtn');
  if (btn) btn.addEventListener('click', handleGateSignInClick);
}

