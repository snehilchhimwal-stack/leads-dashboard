<!-- SUB-TABLE SNIPPETS. Copy the relevant block into the owning record.
These component types get an ID + an INDEX.md row but NOT their own file
(see ../NAMING_CONVENTIONS.md threshold). -->

## `FN-XXX` — significant function (inside its `JS-XXX` / `GS-XXX` record)

| ID | Function | Inputs | Outputs | Side effects | Calls | Called by | Reusable or specific |
|---|---|---|---|---|---|---|---|
| FN-0NN | `name(args)` | ... | ... | reads/writes `<state>` / DOM `<id>` / `<SHEET-XXX>` | `FN-...` | `FN-...` / `BTN-...` / trigger | reusable / specific |

## `BTN-XXX` — button / user action (inside its `TAB-XXX` record)

| ID | Label | Element id | What it does | Invokes (`FN-XXX`) | Irreversible / needs confirm? | Failure behaviour |
|---|---|---|---|---|---|---|
| BTN-0NN | ... | `#...` | ... | `FN-0NN` | yes/no | ... |

## `UI-XXX` — non-button UI element (inside its `TAB-XXX` record)

| ID | Element | Behaviour | Invokes (`FN-XXX`) | State it reads/writes |
|---|---|---|---|---|
| UI-0NN | filter multi-select / modal / chart | ... | `FN-0NN` | `filterState.<x>` |

## `RULE-XXX` — named business rule (inside the record that owns the logic)

| ID | Rule (plain English) | Implemented in (`FN-XXX`) | Constants (`CFG-XXX`) | Duplicated in | Source-of-truth note |
|---|---|---|---|---|---|
| RULE-0NN | ... | `FN-0NN` | `CFG-0NN` | `GS-0NN` `<const>` | keep pair in sync — `HOW_TO_UPDATE_A_COMPONENT.md` |

## `EXC-XXX` — named exception / failure mode (inside the record where it occurs)

| ID | Condition that triggers it | Handling | User-visible result | Recovery / fallback |
|---|---|---|---|---|
| EXC-0NN | e.g. RM_Hierarchy fetch still in flight at PDF-gen time | guard: refuse + status message | "Still loading RM_Hierarchy — try again" | user retries once loaded |

## `CFG-XXX` — configuration constant (inside its `JS-XXX` / `GS-XXX` / `TRIGGER-XXX` record)

| ID | Constant | Value | Meaning | Changing it affects (`IDs`) | Cross-runtime twin |
|---|---|---|---|---|---|
| CFG-0NN | `RM_PERF_MIN_VOLUME_LEADS` | `5` | below this many distinct eligible leads → "Insufficient Data" | `RULE-0NN`, `TAB-004` | `RM_PERF_MIN_VOLUME_LEADS_GS_` (`DailyRmIssueLog.gs`) |

## `RANGE-XXX` — critical cell range (inside its `SHEET-XXX` record)

| ID | Range (A1 or named) | Why it's special | Touched by (`FN-XXX`) |
|---|---|---|---|
| RANGE-0NN | row 1 banner / `A2:A` lookup / conditional-format anchor | ... | `FN-0NN` |

## `HTML-XXX` / `CSS-XXX` — structural region / style system (inside `DASH-001` or a `TAB-XXX`)

| ID | Region / concern | Location | Purpose |
|---|---|---|---|
| HTML-00N | `#authGate` / `#appShell` / `#tabBar` | `dashboard.html` `#Lnn` | ... |
| CSS-00N | the dark-theme token system / `.repeat-offenders-grid` layout | `dashboard.html` `<style>` | ... |

## `CLASS-XXX` / `API-XXX` — (inside the owning `JS-XXX` / `EXT-XXX` record)

| ID | Name | Purpose | Notes |
|---|---|---|---|
| CLASS-00N | ... | ... | rare — this codebase is function-based |
| API-00N | one Sheets API call pattern | ... | quota / retry specifics |
