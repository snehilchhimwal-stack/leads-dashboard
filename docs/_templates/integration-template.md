<!-- EXTERNAL INTEGRATION TEMPLATE (EXT-XXX). Sheets API, Gmail, jsPDF, OAuth, etc. -->

# <EXT-ID> — <name>

<Table header block, Purpose, Responsibilities — as `component-record-template.md`.>

## What it's used for
<The concrete thing this project does with it.>

## Called from — `JS-XXX` / `GS-XXX` list
| ID | Which `FN-XXX` | Operation (read / write / send / render) |
|---|---|---|

## API surfaces — `API-XXX` sub-table (optional)
| ID | Call pattern | Quota / rate limit | Retry behaviour |
|---|---|---|---|

## Auth mechanism
<OAuth scope(s), the Client ID sharing (dashboard sign-in vs. the separate
Gmail grant), where credentials live, what the user has to do once.>

## Known failure modes
<401 on an expired token, 403 access-denied vs. 404 sheet-not-found
(`NOT_SHARED` naming caveat), quota exhaustion, a blocked download in a
sandboxed viewer.>

## Rate-limit / retry behaviour
<`withRetry_` / `withSendRetry_` on the `.gs` side; whatever the JS side
does; backoff.>

## Permissions / security-sensitive notes
<Anything that touches real employee data, real sends, or a credential.>

<Then: Data lineage (what data crosses this boundary, in/out),
Exceptions, Architecture relationship, Related documentation,
Relationships, Source of truth, Validation, Version/change reference,
Revalidation trigger, Handover relationship (§4 permissions),
Lifecycle/retention (N/A), Next action, Closure evidence — as generic.>
