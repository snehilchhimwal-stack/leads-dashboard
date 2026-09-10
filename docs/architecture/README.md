# architecture

Cross-file **workflow overlays** and the trigger index — the living
architecture view that `HANDOVER.md` §1–§3 hands over to at graduation
(Governance Model / `CONSOLIDATED`).

| File | What |
|---|---|
| `FLOW-001-movement-hub.md` | The 4×/day Movement snapshot hub + the `Comment_History` / `Unmatched_Comments_Log` piggyback loggers |
| `FLOW-002-generate-cycle.md` | The 3-phase "Generate region emails" cycle (claim mutex → clear/push `Lead_Followups` → wait for backend text → build/send) |
| `apps-script-triggers.md` | Index of every time-based Apps Script trigger (schedule, handler, `setupXxx()`, timezone pin). Not an ID'd record. |

A `FLOW-` lists its participants in `Depends On` but is **not**
reciprocated (`Used By: none`) — see `../NAMING_CONVENTIONS.md` →
"Exception — architecture overlays" and `../_templates/architecture-template.md`.

Standalone `TRIGGER-<NNN>` records were not created — the trigger set is
small enough to be one index doc. Add a `TRIGGER-001` only if a single
trigger grows enough of its own detail (config constants, a complex
`setupXxx()`, its own failure modes) to need a navigable record.
