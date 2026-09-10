# SHEET-012 — Region_Recipients

| | |
|---|---|
| **Type** | `SHEET-` (see `../NAMING_CONVENTIONS.md`) |
| **Location** | Google Sheet, tab `Region_Recipients` |
| **Owner** | Snehil |
| **Component Status** | Active |
| **Record Status** | Closed + Monitored |
| **Last Verified** | 2026-09-10 against commit `c82ec67` |

## Purpose / reason to exist

The backend's per-region recipient list — a `region → to / cc` table
that the **scheduled** emails (`GS-001`, `GS-010`) fall back to when
`RmHierarchy.gs` can't resolve a specific manager bucket (which is the
normal case, since `RmHierarchy.private.gs` is absent). It exists so a
scheduled digest always has *somewhere* to go, hand-configured per
region.

## Reason to exist

To guarantee every region's scheduled email has a real recipient even
when manager-level routing yields nothing.

## Data stored

One row per region: the To and Cc address list for that region's
scheduled emails.

## Source of the data

`GS-004` `ensureRegionRecipientsSheet_` writes the header
(`['region', 'to', 'cc']`); the address values are **hand-filled** by a
person.

## Destination / consumers

`GS-004` `resolveRecipientEmailsForRegion_` / `loadRegionRecipients_` —
the recipient fallback for `GS-001` / `GS-010`. Also consulted by
`GS-011` `resolveRecipientBucketsForRms_` as the last-resort primary.

**Note:** the *dashboard's* per-region recipient editor
(`reports-ui.js`, `JS-016`) is a **separate** `localStorage`-backed
store — it does **not** read or write this tab. `Region_Recipients` is
backend-only.

## Columns / fields

| Column | Type | Meaning |
|---|---|---|
| `region` | text | the (normalised) region name |
| `to` | text | To address list (comma/newline separated) |
| `cc` | text | Cc address list |

Exact header: `EmailInfra.gs` `#L280` (`['region', 'to', 'cc']`).

## Writers

| Writer | `FN-XXX` | Mode |
|---|---|---|
| `GS-004` | `ensureRegionRecipientsSheet_` (FN-199) | header only, on first use |
| *(a human)* | — | fills `to` / `cc` per region |

## Readers

| Reader | `FN-XXX` | For |
|---|---|---|
| `GS-004` | `loadRegionRecipients_` / `resolveRecipientEmailsForRegion_` (FN-199/198) | the scheduled-email recipient fallback |
| `GS-011` | `resolveRecipientBucketsForRms_` (FN-241) | last-resort bucket primary |

## Automation / triggers touching it

Read by the 10:00 / 13:00 / 17:00 scheduled emails. No trigger of its
own; created lazily by `GS-004`.

## Apps Script functions touching it

`ensureRegionRecipientsSheet_`, `loadRegionRecipients_`,
`resolveRecipientEmailsForRegion_` (`GS-004`);
`resolveRecipientBucketsForRms_` (`GS-011`).

## Data Lifecycle (DOC-019 — completed by `DOC-036`, 2026-09-10)

- **Data Type:** **configuration** (a hand-maintained fallback address
  table).
- **Retention Period:** **N/A — configuration.** No history, no
  `prune*_` function (none needed).
- **Enforced By:** N/A — `ensureRegionRecipientsSheet_` (`GS-004`) writes
  only the header; `to`/`cc` are hand-filled per region.
- **Archive / Delete Behavior:** rows edited / removed by hand; no
  history. `clearRegionRecipientField` is the *browser* recipient UI
  (`JS-016`), a different store — it does **not** touch this tab.
- **Sensitivity:** contains real recipient email addresses. A backend
  job depends on it directly (the scheduled-email recipient fallback —
  `LOGIC_AUDIT.md` Part 3 §3.7). `DOC-038` completes the classification.

## Sensitivity & operational importance (DOC-038)

- **Operational importance:** **IMPORTANT** — a live flow (dashboard feature or a degradable backend path) depends on it; no hard unattended-job failure.
- **Data sensitivity:** real recipient email lists.
- **Reason:** `GS-004` uses it as the recipient **fallback** for every scheduled email when manager-bucket routing yields nothing (the normal case — `RmHierarchy.private.gs` absent). A missing region row degrades that region's digest to the `CH_LEVEL_EMAIL_` backstop — routing quality, not a hard stop.

## Risks of changing this tab's structure

The 3-column `region / to / cc` shape is assumed by
`loadRegionRecipients_`. The `region` values must match what
`mainRegionForGs_` produces or a region's row is never found → the
digest falls through to `CH_LEVEL_EMAIL_`.

## Relationships to other tabs

The fallback layer below `SHEET-006` (`RM_Hierarchy`) + `SHEET-007`
(`Manager_Directory`) in the routing chain. Independent of `leads`.

## Important logic / business rules

Backend-only — the dashboard's recipient UI is a separate `localStorage`
store (`JS-016`). Region-name matching goes through `mainRegionForGs_`
(`GS-004` FN-200).

## Exceptions & error handling

Missing tab → `ensureRegionRecipientsSheet_` creates it (empty). A
region with no row → routing degrades to `CH_LEVEL_EMAIL_`.

## Related documentation

`HANDOVER.md` §2, §4.3; `OPS_CHECKLIST.md`; `LOGIC_AUDIT.md` Part 1 §1,
Part 3 §3.7.

## Relationships

- **Depends On:** `GS-004` (writer/reader), `EXT-001`
- **Used By:** `GS-004`, `GS-011`, `GS-001`, `GS-010`
- **Related:** `SHEET-006`, `SHEET-007` (the routing chain above it);
  `JS-016`'s `localStorage` store (the dashboard's separate equivalent)

## Source of truth

The live `Region_Recipients` tab; header authored by `EmailInfra.gs`.

## Validation

- **Method:** header read from `EmailInfra.gs` `#L280` at `c82ec67`; the
  backend-only / separate-from-dashboard status cross-checked against
  `LOGIC_AUDIT.md` Part 3 §3.7. `Tests_EmailInfra.gs` in CI.
- **Evidence:** `.github/workflows/test.yml` (`Tests_EmailInfra.gs`,
  last green run); `LOGIC_AUDIT.md` Part 3 §3.7.
- **Status:** Validated 2026-09-10 (non-lifecycle); lifecycle framing
  `TBD` (`DOC-036`).

## Version / change reference

Verified at `c82ec67`; record created by `DOC-032`.

## Revalidation trigger

The 3-column shape changes; region-name normalisation
(`mainRegionForGs_`) changes; a new reader is added; the dashboard's
recipient store is ever unified with this tab.

## Handover relationship

`HANDOVER.md` §2/§4.3 cover it. Current as of 2026-09-09. A schema change
must update `HANDOVER.md` §4.3 and run `OPS_CHECKLIST.md`'s recipient
items.

## Lifecycle / retention

`TBD` — deferred to `DOC-036`. Framing: **configuration table**, no
retention.

## Next action

`DOC-036` — record the configuration framing + the recipient-email
sensitivity classification.

## Closure evidence

Record committed for `DOC-032`; `docs/INDEX.md` `SHEET-012` → `Closed +
Monitored` (non-lifecycle scope), `Last Verified` 2026-09-10; header
sourced from `EmailInfra.gs`, not approximated; Data Lifecycle `TBD` per
`DOC-032` boundary.
