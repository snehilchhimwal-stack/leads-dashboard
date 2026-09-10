# Forensic Completeness Audit — Documentation Project (brief)

| | |
|---|---|
| **Status** | NOT YET EXECUTED — this file is the spec only |
| **Requested** | 2026-09-10 by Snehil |
| **Audit-against date** | 2026-09-10 (current state and requirements as of this date) |
| **Scope** | The whole Documentation Project + its documentation architecture: `DOCUMENTATION_PROJECT_PLAN.md`, `docs/` catalog (`INDEX.md` + all component records), `docs/_planning/*`, `HANDOVER.md`, `LOGIC_AUDIT.md`, CI checks CI-001..005 (`test/check-docs-coverage.js`, `.github/workflows/test.yml`), the Governance Model (Record Status / Component Status / 14-point DoD / Definition of Stale / Change-Control Mechanism), the To-Do tracking model (`tasks.json`, `update-tasks.ps1`, goal `g-docproject01`), and the TASKFLOW mechanism |
| **Tracked as** | To-Do task (To-Do Dashboard) — this brief is its actionable spec |
| **Related** | `OPEN_ITEMS.md` (living hand-off), `completeness-verification.md` (DOC-039), `reference-verification.md` (DOC-040), `consistency-check.md` (DOC-041), `documentation-conflicts.md` (DOC-012) |

> The Documentation Project (DOC-001..050 + Governance Model + CONSOLIDATED)
> was closed 2026-09-10 at commit `99170a8`. This audit is the follow-on
> adversarial check: does the system it produced actually hold a
> continuously synchronized, evidence-backed, closed-loop representation of
> the real system — or was it only complete *once*, on the day it was built?

---

## Core objective

Establish whether the Documentation Project can maintain a continuously
synchronized, evidence-backed, closed-loop representation of the actual
system. The desired property:

```
CHANGE ANYWHERE
 → CHANGE DETECTED
 → IMPACT IDENTIFIED
 → AFFECTED RECORDS FOUND
 → AFFECTED RECORDS MARKED STALE
 → REQUIRED TASK CREATED/UPDATED
 → OWNER ASSIGNED
 → IMPLEMENTATION/DOCUMENTATION UPDATED
 → VALIDATION EXECUTED
 → EVIDENCE RECORDED
 → DEPENDENCIES RECHECKED
 → ARCHITECTURE RECHECKED
 → DOWNSTREAM IMPACT RECHECKED
 → HANDOVER RECHECKED
 → CENTRAL INDEX/TRACKING UPDATED
 → REVALIDATED
 → CLOSED + MONITORED
```

This must continue **after** closure. A previously completed task must never
become permanently trusted merely because it once passed validation.

---

## How to run this audit

Do **not** perform a high-level review only. Audit the scope
line-by-line and concept-by-concept. Treat every stated requirement, every
category, every lifecycle step, every field, every relationship, and every
exception as something that must **either** be explicitly covered **or**
deliberately excluded with a documented reason.

Where repository access is available, **inspect the actual files and code** —
do not rely only on the written plan. Enumerate actual instances
("`js/core-foundation.js` line N …"), not just "JavaScript is covered."

### Evidence rule

Do not invent facts. Label every conclusion as one of:

- **Confirmed** — verified against a file/command output, quoted.
- **Inferred** — reasoned from available evidence, not directly verified.
- **Unknown / Evidence Required** — cannot be established from what is available.
- **Recommendation** — proposed change, not a statement about current state.

Do not claim "automatic" behaviour unless it is actually implemented or
demonstrably supported by the system. If something cannot be automatically
detected, say so and define the compensating control.

### Most important requirement — actively try to break it

Do not merely confirm the plan is comprehensive. Assume there is an
undocumented file, function, button, exception, dependency, comment,
configuration value, Sheet tab, workflow, or architectural relationship
somewhere. Find the mechanism by which it could escape the catalog. Then
determine whether the proposed architecture catches it.

The audit passes only when **every meaningful scope category** has: an
identification mechanism, a documentation mechanism, a traceability
mechanism, a validation mechanism, a change-detection mechanism, a
remediation mechanism, and a closure mechanism. The final system must be
designed so that completeness is **continuously tested rather than asserted
once**.

---

## Zero unaccounted scope

Explicitly test coverage not only for obvious source files but for every
meaningful artifact and every meaningful piece of information that can
affect system behaviour, understanding, operation, maintenance, or
handover. At minimum:

HTML · CSS · JavaScript · Google Apps Script · server-side code ·
client-side code · functions · classes · methods · modules ·
imports/exports · configuration · constants · environment variables ·
manifests · triggers · scheduled jobs · APIs · endpoints · integrations ·
authentication/authorization · permissions · UI components · buttons ·
menus · forms · links · dialogs · event handlers · Sheet files · Sheet
tabs · ranges · named ranges · formulas · validations · filters · views ·
formatting where behaviourally significant · data sources · data
destinations · data transformations · schemas · mappings · business rules ·
calculations · assumptions · workflows · state transitions · dependencies ·
data lineage · retention · lifecycle · archival · deletion · exceptions ·
error handling · retries · fallbacks · alerts · logging · monitoring ·
comments · TODOs · FIXMEs · NOTE comments · warnings · disabled code ·
commented-out code · dead code · deprecated code · feature flags ·
temporary workarounds · hard-coded values where relevant · magic
numbers/strings where relevant · documentation · READMEs · specifications ·
architecture records · decision records · audit records · handover
material · task records · CI/CD checks · tests · validation evidence ·
generated artifacts · external dependencies · third-party services ·
operational procedures · ownership · change history · version/commit
references.

For each item determine the **correct treatment**, not a blanket "needs a
file": dedicated component record / linked subcomponent / indexed
reference / source-code annotation / architecture record / validation
record / change record / task / external reference / **or explicit
exclusion with rationale**.

---

## Comments requirement

Comments must NOT be automatically dismissed as non-functional. Inspect
and classify them. A comment may carry: business-logic explanation,
implementation rationale, architectural intent, assumptions, dependency
info, warnings, known limitations, TODOs, FIXMEs, temporary workarounds,
operational instructions, retention info, security info, undocumented
requirements, historical context, decisions, exceptions, or behaviour not
obvious from the code.

Determine which comments are informational only and which contain
information that must be captured in the central documentation system. No
meaningful knowledge in comments should disappear just because the
catalog primarily lists executable components.

### Comments change control

Determine how comments themselves are monitored. If a meaningful comment
changes, determine whether: its component doc must be reviewed; a
validation check must run; an architecture relationship must be
reconsidered; a task must be created; a stale flag must be raised.

Likewise, if implementation changes while an explanatory comment stays
unchanged but becomes inaccurate — determine how the system can detect or
expose that inconsistency.

---

## Automatic-updates requirement

Desired future state: documentation maintenance is automated wherever
technically feasible — but "automatically updated" does **not** mean
blindly rewriting docs with generated text. Distinguish:

1. Automatically detected changes
2. Automatically identified impact
3. Automatically marked-stale records
4. Automatically generated/updated tracking entries
5. Automatically generated validation tasks
6. Automatically executed validation
7. Automatically updated machine-derived metadata
8. Human-required semantic review
9. Human approval/closure

Define which portions can be safely automated and which require human
confirmation. The system must **fail visibly** when automation cannot
establish correctness. Never silently assume unchanged documentation
remains correct.

### Automatic coverage check

Determine whether CI (or equivalent) can compare the actual repo against
the catalog and detect: new files without docs; deleted files with
obsolete docs; renamed files; moved files; new/deleted/renamed functions;
changed function signatures; new classes/modules; changed dependencies;
changed imports/exports; changed APIs; changed/deleted/renamed Sheet tabs;
changed formulas where relevant; changed triggers; changed UI elements;
changed configuration; changed comments containing actionable knowledge;
changed business rules; changed documentation; changed architecture;
changed handover-relevant behaviour; changes that invalidate existing
validation evidence.

If a change cannot be reliably detected automatically, **document the
limitation and define a compensating control**.

---

## Matrices and registers the audit must produce

### Completeness matrix (master coverage matrix)

| Scope Item | Exists in Project? | Documented? | Stable ID? | Source Linked? | Architecture Linked? | Dependency Linked? | Validation Defined? | Validation Evidence? | Change Detection? | Auto-Revalidation? | Handover Impact? | Owner? | Lifecycle? | Gap | Required Control |

Enumerate actual repository instances wherever possible; do not summarize
categories prematurely.

### Traceability

Every meaningful record must have bidirectional traceability where
appropriate:

```
Goal ↔ Requirement ↔ Task ↔ Component ↔ Source File ↔ Function/UI/Sheet
     ↔ Dependency ↔ Data Lineage ↔ Architecture ↔ Validation ↔ Change ↔ Handover
```

Verify **both** directions where technically meaningful. A component →
why it exists. A goal → what implements it. A change → what it affected. A
validation result → the exact version/state tested. A handover statement →
the underlying current component records.

### Source-of-truth audit

| Information | Authoritative Source | Mirror/Index | Validation | Drift Detection |

For every information type, name the authoritative source. Audit whether
two documents can contradict each other. For overlapping information:
which is authoritative, which is derived, how synchronization occurs, how
drift is detected.

### Existing documents — distinct responsibilities

Explicitly audit the relationship among: `DOCUMENTATION_PROJECT_PLAN.md` ·
`docs/INDEX.md` · component records · `HANDOVER.md` · `LOGIC_AUDIT.md` ·
CI-001 · CI-002 · CI-003 · CI-004 · CI-005 · CONSOLIDATED · TASKFLOW-003 ·
architecture documentation · validation evidence · change records.

Determine whether each has a distinct responsibility. Do not duplicate the
same source-of-truth responsibility across documents.

### Documentation Project Plan audit

Audit every goal and phase in `DOCUMENTATION_PROJECT_PLAN.md`. For every
goal: still valid? fully implemented? which tasks implement it? which
artifacts prove completion? which automated controls maintain it? what can
make it stale? what detects that staleness? what reopens the work? who owns
the resulting action?

Audit every phase (inventory; repository/folder structure; templates;
component records; Sheets/data pass; completeness verification;
maintenance process). Determine whether the **maintenance process itself**
is sufficiently implemented to keep the earlier phases continuously
correct.

### Critical distinction — one-time vs continuous completeness

The project must demonstrate **both**. A complete inventory today is
insufficient if tomorrow's new function can appear without triggering
documentation review. A valid component record today is insufficient if a
dependency can change tomorrow without causing revalidation.

### Central repository audit

It must be possible to start from **any** of these and navigate to the
relevant context: file; function; class; HTML element; CSS component; JS
behaviour; Apps Script function; button; menu; Sheet; tab; range; data
source; data destination; workflow; exception; business rule; architecture
component; requirement; task; documentation; handover item. If any entry
point becomes a dead end, identify it.

### Component record audit

For each component record, verify coverage of: ID · Name · Type · Location
· Purpose · Reason to exist · Responsibility · Inputs · Outputs ·
Dependencies · Consumers · Data lineage · Logic · Assumptions · Exceptions
· Error handling · UI relationships · Architecture relationships · Related
components · Source of truth · Validation · Evidence · Version/change ·
Owner · Lifecycle · Retention where applicable · Handover relationship ·
Revalidation trigger · Last verified · Current status. Identify any
missing field that would prevent someone from understanding or safely
changing the component.

### Sheets audit

For every Sheet and tab, verify: identity; purpose; reason to exist;
owner; source; consumers; inputs; outputs; formulas; logic; dependencies;
Apps Script interactions; external integrations; retention; lifecycle;
archival; deletion; validation; exceptions; automation; current status.
**Unknown retention must remain explicitly unknown and generate a tracked
action.**

### Definition of Done audit

Determine whether "Done" currently means only "work performed" or genuinely
means: Output Exists → Correctness Verified → Source Linked → Architecture
Verified → Dependencies Verified → Downstream Impact Checked → Central
Tracking Updated → Handover Updated if Applicable → Revalidation Trigger
Defined → Evidence Stored → Owner Assigned → Monitoring Active. If not,
recommend the precise change.

### Stale-state audit

Define objective stale conditions. A previously closed item should become
stale when any relevant assumption or dependency changes, across: code;
configuration; architecture; requirements; data; Sheet structure; UI;
dependencies; comments containing meaningful operational knowledge;
validation assumptions; ownership; lifecycle; retention; handover.

### Dead-end audit

Test at minimum: component → no documentation; documentation → no
implementation; task → no output; output → no consumer; consumer → no
documented source; function → no purpose; button → no action
documentation; action → no initiating UI/API/event; exception → no
handling; handling → no validation; Sheet tab → no lifecycle; dependency →
no owner; validation → no evidence; evidence → no version; change → no
affected-record mapping; stale record → no task; task → no owner; failed
task → no remediation; handover → stale source; comment → undocumented
critical knowledge; deleted component → stale record; new component →
missing record.

### Automation gap analysis

For every control, classify: Fully automatic · Partially automatic ·
Human-controlled · Not implemented · Cannot be automated reliably. For
each non-automatic control, explain why and define the safest compensating
control. Automation must reduce the probability of silent drift, not be
added for appearance.

### CI audit (CI-001 … CI-005)

| Check | What It Detects | What It Does Not Detect | Evidence | Failure Behavior | Owner | Required Improvement |

Determine whether the checks together provide meaningful protection
against documentation drift. Identify coverage that should become a new CI
check.

### Change-to-handover audit

Determine whether a change can currently move through Code/Architecture
Change → Documentation Impact → Validation Impact → Handover Impact →
Tracking Update → Closure **without a human having to remember an
undocumented manual step**. Any memory-dependent step is a control
weakness.

### Final architecture (recommended target)

1. Source repository
2. Central component catalog
3. Stable IDs
4. Dependency graph
5. Architecture map
6. Validation/evidence layer
7. Change detection
8. CI coverage checks
9. Stale-state mechanism
10. Task/remediation workflow
11. Handover synchronization
12. Historical audit preservation
13. Human approval points
14. Monitoring after closure

Do **not** merge historical audit records (`LOGIC_AUDIT.md`) into the
living source of truth.

### Final control principle

Target state must satisfy: *"Nothing meaningful is undocumented,
untraceable, unverifiable, or silently stale."* And: *"Every change has a
discoverable impact path, every affected item has a remediation path, and
every closure has evidence."*

---

## Required output format

**A. Executive assessment** — completeness % only if evidence-supported;
current health; is it truly closed-loop; can it remain current
automatically; biggest risks; most significant omissions.

**B. Line-by-line / requirement-by-requirement audit** — one row per
requirement from the current Documentation Project specification:

| Requirement | Covered? | Where? | Evidence | Gap | Required Change |

Do not combine unrelated requirements into one row.

**C. Complete scope matrix** — the master coverage matrix, with actual
repository instances enumerated wherever possible.

**D. Traceability audit** — missing links across Goal ↔ Requirement ↔ Task
↔ Component ↔ Source ↔ Dependency ↔ Architecture ↔ Validation ↔ Change ↔
Handover.

**E. Comment audit** — meaningful comments / TODOs / FIXMEs / warnings and
how each should be incorporated into the living system.

**F. Automation audit** — what is automatically detected / tracked /
revalidated / human-reviewed / currently unprotected.

**G. CI-001–CI-005 audit** — current coverage and missing controls.

**H. Document relationship audit** — precise role and source-of-truth
relationship among all major documentation artifacts.

**I. Dead-end register**

| Item | Dead End | Cause | Impact | Fix | Automation Opportunity | Owner |

**J. Stale-risk register**

| Item | What Can Make It Stale | Detection | Revalidation | Owner |

**K. Missing-control register**

| Missing Control | Risk | Priority | Recommended Implementation | Verification |

**L. P0/P1/P2/P3 action plan** — prioritize all changes.

**M. Target operating model** — the complete ongoing lifecycle from change
detection through revalidated closure.

**N. Final verdict** — answer explicitly:

1. Does the Documentation Project currently cover everything it claims to cover?
2. What is still outside scope?
3. Can a new/changed/deleted component escape documentation detection?
4. Can a meaningful comment containing system knowledge escape detection?
5. Can architecture changes escape documentation revalidation?
6. Can dependency changes escape impact analysis?
7. Can handover become stale without detection?
8. Can a task be marked Done without evidence?
9. Can validation become invalid without reopening the task?
10. Can a documentation record become stale without generating action?
11. Is there one authoritative central tracking mechanism?
12. Are historical audits preserved without being confused with the living catalog?
13. What must be changed before the system can honestly be called continuously synchronized?
