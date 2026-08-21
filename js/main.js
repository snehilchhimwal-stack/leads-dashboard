// ============================================================
// main.js — bootstrap. Loaded LAST, after every other js/*.js file.
// Just the top-level calls that run immediately at parse time and
// directly call into another file's function — the one ordering
// hazard classic <script src> files have (see the file-split plan's
// ordering rule). Everything else (event handlers, renderAll(), etc.)
// only ever fires after the whole page has loaded, so it doesn't care
// what order the other files loaded in.
// ============================================================

initCollapsibleSectionInfo();
initRMTimelineUI();
initMovementUI();
initAuthGate();

// Sheet ID/tab are hardcoded above (config panel inputs), but the actual
// fetch only ever runs after the sign-in gate succeeds — see gateSignIn()
// and its call to fetchAndRender() on success. The button and config panel
// stay fully functional afterward — "Change source" still works normally
// if this ever needs to point at a different sheet.
