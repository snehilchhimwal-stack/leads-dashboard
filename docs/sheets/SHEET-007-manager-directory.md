# SHEET-007 — Manager_Directory

| | |
|---|---|
| **Type** | `SHEET-` (see `../NAMING_CONVENTIONS.md`) |
| **Location** | Google Sheet, tab `Manager_Directory` |
| **Owner** | Snehil |
| **Component Status** | Active |
| **Record Status** | Closed + Monitored |
| **Last Verified** | 2026-09-10 against commit `c82ec67` |

## Purpose / reason to exist

The hand-fillable address book for the manager buckets that `RM_Hierarchy`
produces. `RmHierarchy.gs` derives *who* a flagged RM's manager is;
`Manager_Directory` is where that manager's **email** lives when
`RmHierarchy.private.gs` (the real-email file) is absent from the repo —
which it always is. It exists so routing can still reach a real inbox
without the private file, by a human filling this tab in once.

## Reason to exist

To let the routing degrade *gracefully* (to a real, hand-entered
address) rather than to a generic fallback, when the private-email file
is not deployed.

## Data stored

One row per manager: name, roles, regions covered, email,
who-reports-up-to-them, and where the email value came from.

## Source of the data

`GS-011` `ensureManagerDirectorySheet_` writes the header + a derived row
per manager (from `RM_HIERARCHY_RAW_`); **the `email` column is
hand-filled** by a person when the private file is absent.

## Destination / consumers

`GS-004` `resolveRecipientEmailsForRegion_` (routing addresses);
`GS-009` `auditManagerDirectoryEmailGaps_` → the weekly Ops Checklist
email flags any blank `email`.

## Columns / fields

| Column | Type | Meaning |
|---|---|---|
| `manager_name` | text | the manager |
| `roles` | text | their role(s) |
| `regions` | text | region(s) they cover |
| `email` | text | **hand-filled** when `RmHierarchy.private.gs` is absent; blank = a routing gap |
| `people_reporting_up_to_them` | text | the RMs in their bucket |
| `email_source` | text | `private_file` / `manual` / `` |

Exact header: `RmHierarchy.gs` `#L826`
(`['manager_name','roles','regions','email','people_reporting_up_to_them','email_source']`).

## Writers

| Writer | `FN-XXX` | Mode |
|---|---|---|
| `GS-011` | `ensureManagerDirectorySheetInternal_` / `ensureManagerDirectorySheet_` (FN-245) | header + derived rows on rebuild |
| *(a human)* | — | fills the `email` column |

## Readers

| Reader | `FN-XXX` | For |
|---|---|---|
| `GS-004` | `resolveRecipientEmailsForRegion_` (FN-198) | routing addresses |
| `GS-011` | `loadRmHierarchyAndEmails_` (FN-240) | merge into the chain data |
| `GS-009` | `auditManagerDirectoryEmailGaps_` (via `GS-011` FN-246) | the weekly checklist |

## Automation / triggers touching it

Rebuilt by `setupRmHierarchy()` (no time trigger); read by every
scheduled emailer. Audited weekly by `OpsChecklistRunner.gs`.

## Apps Script functions touching it

Write: `ensureManagerDirectorySheetInternal_` (`GS-011`). Read:
`loadRmHierarchyAndEmails_`, `resolveRecipientEmailsForRegion_`
(`GS-004`), `auditManagerDirectoryEmailGaps_` (`GS-011`).

## Data Lifecycle (DOC-019 — `TBD`, filled by `DOC-036`)

- **Data Type:** **configuration**
- **Retention Period:** N/A — current-state table; `DOC-036` to confirm
- **Enforced By:** N/A — rebuilt/overwritten
- **Archive / Delete Behavior:** overwritten on rebuild (hand-filled
  `email` values preserved where the rebuild keys match — `DOC-036` to
  confirm the merge behaviour)
- **Sensitivity:** contains real manager emails — `DOC-036` to classify

## Risks of changing this tab's structure

A column rename breaks `resolveRecipientEmailsForRegion_`. A rebuild
that doesn't preserve hand-filled `email` values would silently wipe the
manual routing config — `DOC-036` must confirm the rebuild's merge
semantics.

## Relationships to other tabs

The address layer for the buckets `SHEET-006` (`RM_Hierarchy`) produces.
`SHEET-012` (`Region_Recipients`) is the next fallback after this.

## Important logic / business rules

Blank `email` = a routing gap that degrades to `Region_Recipients` /
`CH_LEVEL_EMAIL_` and is flagged by the weekly checklist (`GS-009` /
`OPS_CHECKLIST.md`).

## Exceptions & error handling

Missing tab → `ensureManagerDirectorySheet_` creates it. Blank emails →
soft-degrade + weekly flag.

## Related documentation

`HANDOVER.md` §2, §4.3; `OPS_CHECKLIST.md`; `LOGIC_AUDIT.md` Part 1 §4d,
Part 3 §3.7.

## Relationships

- **Depends On:** `SHEET-006` (`RM_Hierarchy` — the chain it addresses),
  `GS-011`, `EXT-001`
- **Used By:** `GS-004`, `GS-011`, `GS-001`, `GS-010`, `GS-009`
- **Related:** `SHEET-012` (`Region_Recipients` — the next fallback),
  `RmHierarchy.private.gs` (the file this tab substitutes for)

## Source of truth

The live `Manager_Directory` tab; header authored by `RmHierarchy.gs`.

## Validation

- **Method:** header read from `RmHierarchy.gs` `#L826` at `c82ec67`;
  the "hand-filled email, absent private file" behaviour cross-checked
  against `LOGIC_AUDIT.md` Part 3 §3.7. `Tests_RmHierarchy.gs` in CI.
- **Evidence:** `.github/workflows/test.yml` (`Tests_RmHierarchy.gs`,
  last green run); `LOGIC_AUDIT.md` Part 3 §3.7.
- **Status:** Validated 2026-09-10 (non-lifecycle); lifecycle `TBD`.

## Version / change reference

Verified at `c82ec67`; record created by `DOC-032`.

## Revalidation trigger

The column set changes; the rebuild's email-preservation behaviour
changes; a new reader is added; `RmHierarchy.private.gs` is added
(changes `email_source`).

## Handover relationship

`HANDOVER.md` §2/§4.3 cover it. Current as of 2026-09-09. A column or
merge-behaviour change must update `HANDOVER.md` §4.3 and run
`OPS_CHECKLIST.md`'s Manager_Directory items.

## Lifecycle / retention

`TBD` — deferred to `DOC-036`. Framing: **configuration table**; the key
open question is the rebuild's merge behaviour for hand-filled emails.

## Next action

`DOC-036` — record the configuration framing, the merge semantics, and
the manager-email sensitivity classification.

## Closure evidence

Record committed for `DOC-032`; `docs/INDEX.md` `SHEET-007` → `Closed +
Monitored` (non-lifecycle scope), `Last Verified` 2026-09-10; header
sourced from `RmHierarchy.gs`, not approximated; Data Lifecycle `TBD`
per `DOC-032` boundary.
