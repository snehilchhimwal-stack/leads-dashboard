# RM hierarchy nightly sync - plan

Status: plan written and approved 2026-10-08; built the same day as `RmHierarchySync.gs` + `Tests_RmHierarchySync.gs` (`GS-014`),
report-only by default, not live until pasted. Decisions taken with Snehil: leavers kept until told (the sheet drops a leaver within ~48h);
report to Snehil, Sushil Kannojiya, Ashish Ivlekar; first tab only; HR sheet link opened to "Anyone in Homesfy"; `rebuildRmHierarchy()`
refuses to run once the sync is applying (`rebuildRmHierarchyForce()` overrides). One refinement over the plan below: a flagged stale
field also shows a suggested value when the whole HR chain resolves cleanly (never written).

## Goal
Every night after 23:00 IST, with no computer involved, compare the company HR roster sheet with the live
`RM_Hierarchy` / `Manager_Directory` tabs, apply the changes that are unambiguous, and email a short report of
everything else. This replaces the manual `test/refresh-rm-hierarchy.py <export.csv>` + paste + `rebuildRmHierarchy()` routine.

## Source
- HR roster sheet `16l-0STI31eL4oly0u1jVVHujzqNASmH5K8l83ahstJQ`, **first tab only**. Link access set by Snehil to
  "Anyone in Homesfy with the link" on 2026-10-08 so the script owner's account can open it (not yet proven from that account -
  the first dry run proves it; a failure raises an ops alert).
- Same layout as the "HR Live" export the Python scripts read (0-indexed): name 1, role 2, team 15, exit 17, current chain
  names 6 / 8 / 10 / 12 (`A1 - 1/S2`, `A1 - 2`, `RH`, `CH/CL`), official mail id 35. `P&L` (14) is never used as a signal.
- 322 people on 2026-10-08, every Exit cell `-`, status Confirmed / Probation: the sheet lists current staff, so a leaver
  most likely just disappears (an Exit date is handled too).

## Runs where
A new Apps Script file `RmHierarchySync.gs` in the live project (owner Sakshi Sonawane's account), time trigger
`atHour(23).nearMinute(15)` installed by `setupRmHierarchySync()`. Registered with the email-job run record and
`emailJobScheduleGs_` so the existing hourly watchdog alerts if it never runs or dies.

## Each night
1. Read the HR sheet (`SpreadsheetApp.openById`), check the header cells at the fixed positions above. Mismatch: stop, alert.
2. Parse people (a person with several rows: chain names unioned, exit flags OR-ed - same as the Python scripts).
3. Read the live `RM_Hierarchy` tab (team, role, name, tl, tm, rh, ch, excluded, note) and `Manager_Directory`.
4. Build a plan (pure function, unit-tested):
   - **New joiner** (sales-track role: S1 S2 S3 A1 TL TM RH RM BDM Cluster Head City Lead Commercial Head; Magnet teams out of
     scope; no row in the tab). HIGH confidence when every filled chain slot resolves, by THAT NAME's own role in the tab, to a
     distinct field (A1/TL->tl, TM->tm, RH->rh, Cluster Head/City Lead/Commercial Head/Leadership->ch). Applied: new row.
     LOW (a slot that does not resolve, two names for one field, every chain column blank): report only.
   - **Stale field** (tl/tm/rh/ch value not in the person's current chain set). Auto-fixed only when the current chain has
     exactly ONE name and that name's role maps to the field. Everything else (all `ch` overrides, aliases): report only.
   - **Possible leaver**: a person in the tab but absent from the HR sheet, or with an Exit date. NEVER removed; reported,
     and kept until Snehil says remove. Reported on first detection, then again every Monday while unresolved
     (state in a script property). Alias rows (leads-sheet spellings) are expected to be absent: they are listed once and
     then ignored via a stored "known absent" set.
   - **Manager emails**: fill a BLANK `Manager_Directory` email from the HR "Official Mail Id" (needs an `@`); a different
     existing email is reported, never overwritten.
5. Apply gate: writes happen only when script property `RM_HIERARCHY_SYNC_APPLY` = `true`. **Default is report-only**: for
   the first nights the email says "would apply" so the plan can be judged on real data. Snehil/Claude flips it.
6. Before any write: save the current `RM_Hierarchy` and `Manager_Directory` rows to a Drive CSV (the existing archive helper).
   Writes keep the human-edited `Excluded` and `Note` cells and existing emails (matched by name).

## Safety gates (no write, alert instead)
- HR sheet unreadable / no access, header mismatch, fewer than 250 people (322 today), or more than 25 field changes in one
  night. The report then says "held for review" with the full list.
- A failed run alerts through `notifyOpsAlertGs_` (existing path, retried, second send path).

## Report
To `snehil.chhimwal@homesfy.in`, `sushil.kannojiya@homesfy.in`, `Ashish.ivlekar@homesfy.in` (read from the HR sheet's mail
column; Sushil's surname is spelled "Kannojiya" there). Sent only on nights with something in it: applied / would-apply
changes, items needing a person, possible leavers, email changes, or a held run. Sections in that order, each line naming the
person, team, role, old -> new value and why.

## Known risk to design around
`rebuildRmHierarchy()` (manual) rebuilds the tab from the embedded `RM_HIERARCHY_RAW_`. Once the sync writes the live tab,
running that rebuild would silently undo the synced changes. Plan: the sync keeps a "last synced" property and
`rebuildRmHierarchy()` refuses to run (clear message) unless called with an explicit force; HANDOVER says the live tab is
now the source of truth and `RM_HIERARCHY_RAW_` is only a seed.

## Files and checks (this project's rules)
- New: `RmHierarchySync.gs`, `Tests_RmHierarchySync.gs`. Registered in all three places (`Tests_RunAll.gs` suites,
  `test/run-gs-tests.js` PRODUCTION_FILES and TEST_FILES); `python3 test/check-gs-registration.py`.
- Tests with in-memory fakes only (HR sheet, tab, Gmail, Drive, Properties, triggers): each plan category, HIGH/LOW, the
  one-candidate stale rule, leaver kept + weekly re-report, header mismatch, size gates, report-only vs apply, idempotent
  second run, email fill-blank, recipients. Mutation-proof the main rules; run at awkward clock times and zones
  (`--at`, `--tz`); `check-gs-runtime-globals.py`, `check-runtime-parity.py`, `check-catalog.py`, `check-staleness.py`.
- Docs in the same commit: new `GS-0xx` record + `docs/INDEX.md`, `HANDOVER.md` (architecture + the rebuild warning),
  `OPS_CHECKLIST.md` item (confirm the nightly report arrives), `docs/STALENESS_TRACKER.md` deploy register.
- Deploy: paste the two files, press Ctrl+S, run `setupRmHierarchySync()` once, run `rmHierarchySyncNow()` for a first
  report-only report, review 2-3 nights, then set `RM_HIERARCHY_SYNC_APPLY=true`.

## Decisions already made by Snehil
Leavers kept until told; report to Snehil, Sushil Kannojiya, Ashish Ivlekar; first tab only; HR sheet link opened to
Homesfy.

## Still open
- Confirm Sakshi's account is a homesfy.in address (proved by the first dry run).
- Confirm that a person who leaves is actually removed from the HR sheet (name one past leaver and it can be checked).
- OK with `rebuildRmHierarchy()` refusing to run without force once the sync is on?
