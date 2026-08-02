# Sorting feature

## Approval

Status: approved
Approved by: obrys
Approved on: 2026-08-02

## Purpose

Add server-side sorting of spools so operators can find the spool they need
without scanning insertion order. Three sort keys are supported, with
`lastUsed` as the default. Sorting is performed by the backend in the SQL
query that lists spools; the frontend only selects the active sort.

## Scope

- Adds a `sort` query parameter to `GET /api/spools`.
- Adds a nullable `lastUsedAt` field to `SpoolDto`.
- Adds a sort selector to the `/spools` page in the SPA that drives the
  `sort` query parameter.
- Reflects the active sort in the browser URL on `/spools`.

## Out Of Scope

- Sorting of filament types (`GET /api/filament-types`).
- Sorting on the dashboard endpoints.
- Pagination (no change to current result set size).
- New sort keys beyond `lastUsed`, `leastRemaining`, `mostRemaining`.
- Persisting the sort choice in localStorage or any other client-side store.
- Changing the `SpoolDto` shape beyond adding `lastUsedAt`.

## Behavior

### "Last used" timestamp

For each spool, `lastUsedAt` is the `occurredAt` of the most recent enabled
`SpoolEvent` of any kind on that spool, evaluated with the existing
chronological order from `doc/spec/domain-rules.md` (kind order, then event
id). Because every spool has exactly one immutable enabled `Created` event,
`lastUsedAt` is never null: a spool with no other events reports its
`CreatedAt` as `lastUsedAt`.

`lastUsedAt` is computed for listing from the spool's event history. It is
returned in `SpoolDto` so the UI can display it; it is not required to be a
new persisted column, but it may be implemented as a denormalized cache kept
consistent with the event history by the same mechanisms already used for
`remaining_grams`, `openedAt`, and `finishedAt`.

### Sort keys

The `sort` query parameter on `GET /api/spools` accepts exactly these values:

| Value | Meaning |
|---|---|
| `lastUsed` | Most recent `lastUsedAt` first (descending). |
| `leastRemaining` | Smallest `remaining_grams` first (ascending). |
| `mostRemaining` | Largest `remaining_grams` first (descending). |

The default sort is `lastUsed`. The default applies when `sort` is missing
and when it carries an unknown value; an unknown value does not produce a
400.

### Interaction with existing list semantics

- Sorting applies after facet filtering. Facet counts and the `FacetsDto`
  payload are unchanged by sorting.
- Sorting applies whether or not `includeFinished=true` is set. Finished
  spools, when included, sort by the same rules as active spools; they are
  not forced to the bottom.
- Sorting is independent of the existing `filamentTypeId`, `includeFinished`,
  and facet query parameters and may be combined with any of them.

### Stable ordering

After the chosen sort key, a fixed secondary order is applied so identical
primary keys produce stable results:

1. `lastUsedAt` descending (most recent first), then
2. spool `id` ascending.

For `leastRemaining` and `mostRemaining` this means spools with equal
`remaining_grams` are ordered by `lastUsedAt` desc, then `id` asc. For
`lastUsed` the secondary order only resolves ties between spools whose
`lastUsedAt` is identical (for example, spools created in the same
operation), and then by `id` asc.

### Frontend behavior

- The `/spools` page shows a sort selector with the three keys above, plus
  the default labeled clearly (e.g. "Last used").
- Selecting a sort updates the URL to `/spools?sort=<key>` and re-queries the
  API.
- On initial load, the URL is parsed for `sort`; a missing or unknown value
  resolves to `lastUsed`. The URL is normalized to the resolved value so the
  address bar reflects what is displayed.
- The selector reflects the active sort at all times, including after a
  WebSocket `change` notification that reloads spool data; the sort itself is
  not changed by a reload.
- The selector does not perform sorting client-side. The displayed order is
  the order returned by the API.

## Rules And Edge Cases

- A spool with only the immutable `Created` event reports `lastUsedAt` equal
  to its `CreatedAt` and sorts under `lastUsed` as if used at creation time.
- A disabled (`isDisabled = true`) event is ignored when computing
  `lastUsedAt`, consistent with the existing rule that disabled events
  contribute neither weight nor state.
- When two spools share the same `lastUsedAt` (for example, the same creation
  batch), they are ordered by `id` ascending as the final tie-breaker.
- Unknown `sort` query values are treated as `lastUsed`, not as an error.
- An empty `sort` value (`?sort=`) is treated the same as a missing value:
  the default (`lastUsed`) applies.
- The `sort` parameter is case-sensitive: only the exact lowercase values
  listed above are recognized; any other casing is treated as unknown and
  resolves to `lastUsed`.

## Acceptance Criteria

1. `GET /api/spools` with no `sort` parameter returns spools ordered by
   `lastUsedAt` descending, then `id` ascending.
2. `GET /api/spools?sort=lastUsed` returns the same order as criterion 1.
3. `GET /api/spools?sort=leastRemaining` returns spools ordered by
   `remaining_grams` ascending, then `lastUsedAt` descending, then `id`
   ascending.
4. `GET /api/spools?sort=mostRemaining` returns spools ordered by
   `remaining_grams` descending, then `lastUsedAt` descending, then `id`
   ascending.
5. `GET /api/spools?sort=unknownValue` returns the same order as criterion 1
   and responds with HTTP 200.
6. `GET /api/spools?sort=` returns the same order as criterion 1 and responds
   with HTTP 200.
7. `GET /api/spools?sort=lastUsed&includeFinished=true` returns a list in
   which finished spools are interleaved with active spools according to
   `lastUsedAt`, not appended after them.
8. `GET /api/spools` with an active facet filter (any combination of
   `brand`, `material`, `type`, `color`, `filamentTypeId`) and a `sort` value
   returns only the facet-filtered spools, in the order specified for that
   `sort` value, and the `FacetsDto` payload is identical to what that facet
   combination would return without `sort`.
9. Each `SpoolDto` returned by `GET /api/spools` and `GET /api/spools/{id}`
   contains a `lastUsedAt` field. For a spool that has at least one enabled
   event, `lastUsedAt` equals the `occurredAt` of the most recent enabled
   event on that spool; for a spool with only the `Created` event,
   `lastUsedAt` equals the spool's `CreatedAt`.
10. After disabling (undoing) the most recent enabled event on a spool, the
    next `GET /api/spools` returns that spool with `lastUsedAt` equal to the
    `occurredAt` of the now-most-recent enabled event on the spool.
11. After re-enabling (redoing) a disabled event that becomes the most recent
    enabled event on a spool, the next `GET /api/spools` returns that spool
    with `lastUsedAt` equal to that event's `occurredAt`.
12. Navigating to `/spools?sort=leastRemaining` in the browser loads the
    spool list ordered by least remaining first, the URL bar shows
    `/spools?sort=leastRemaining`, and the sort selector shows "Least
    remaining" as active.
13. Navigating to `/spools` (no `sort`) in the browser loads the list ordered
    by last used first and the URL bar reflects the resolved default
    (`/spools` or `/spools?sort=lastUsed`).
14. Navigating to `/spools?sort=garbage` in the browser loads the list ordered
    by last used first and the sort selector shows "Last used" as active;
    no error is shown to the user.
15. Changing the sort selector on `/spools` updates the URL query string
    before re-querying the API, and the displayed order matches the API
    response order.
16. After a WebSocket `change` notification that triggers a spool-list
    reload on `/spools`, the active sort is preserved and the displayed
    order matches the API response order for that sort.
17. The frontend does not reorder spool rows client-side: the displayed
    order equals the order returned by `GET /api/spools` for the active
    sort.

## Constraints And Dependencies

- Implementation is in the existing three-layer .NET backend
  (`Filament.Api`, `Filament.Core`, `Filament.Infrastructure`) and the React
  SPA in `web/`, following the architecture in `doc/spec/architecture.md`.
- Sorting must be performed by MariaDB in the SQL query that loads the spool
  list, not in application memory. Application-code re-sorting of the result
  set is not acceptable for the list endpoint.
- `lastUsedAt` may be served from a denormalized cache column maintained
  alongside the existing `remaining_grams`, `openedAt`, and `finishedAt`
  caches, or computed in the listing query against `spool_events`; either is
  acceptable as long as the cache is kept consistent on every event write and
  is recomputed by `POST /api/spools/reevaluate` together with the other
  caches. The choice is an implementation detail not constrained by this
  specification beyond consistency.
- The existing `POST /api/spools/reevaluate` semantics from
  `doc/spec/domain-rules.md` are preserved; if a `lastUsedAt` cache is added,
  reevaluate must repair it together with the other cached values.
- No database migration is mandated by this specification. A migration is
  permitted only if the chosen implementation requires a new column; any
  such migration must be additive and safe to run automatically at API
  startup as described in `doc/spec/architecture.md`.
- The OpenAPI document at `/openapi/v1.json` must document the new `sort`
  parameter and the new `lastUsedAt` field.

## Decisions

- `lastUsed` is defined as the most recent enabled event of any kind on the
  spool, falling back to `CreatedAt` via the immutable `Created` event. See
  `amendment.md` Q1–Q2.
- API uses a single `sort=<key>` query parameter with direction implied by
  the key. See `amendment.md` Q3.
- Unknown or missing `sort` defaults to `lastUsed`; no 400. See
  `amendment.md` Q4.
- Finished spools, when included, sort by the same rules as active spools.
  See `amendment.md` Q5.
- `SpoolDto` gains a nullable `LastUsedAt` field. See `amendment.md` Q6.
- The active sort is reflected in the URL query string on `/spools`, not in
  localStorage. See `amendment.md` Q7.
- Default direction for `lastUsed` is most-recent-first, per the request
  wording "last time used first".
- Fixed secondary order (`lastUsedAt` desc, then `id` asc) is mandated for
  testability and stable rendering.

## Open Questions

None. All decisions are resolved in `amendment.md`.
