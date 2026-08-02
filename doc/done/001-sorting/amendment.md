# Amendment — 001 Sorting

Records the questions raised during refinement of `README.md`, the answers
accepted by the user, the assumptions taken, and the references consulted.
The original `README.md` is not modified.

## Answers to clarifying questions

1. **Definition of "last used" for a spool.**
   Answer: the most recent enabled event of any kind on the spool
   (`Created`, `Opened`, `Print`, `Adjustment`, `Finished`), evaluated by
   `occurredAt` using the existing chronological tie-break rules from
   `doc/spec/domain-rules.md` (kind order, then event id).

2. **Spools with no events beyond the immutable `Created` event.**
   Answer: use the spool's `CreatedAt` (i.e. the `Created` event's
   `occurredAt`) as the "last used" timestamp, since `Created` is itself an
   enabled event. This is consistent with #1 and removes the need for a
   separate fallback.

3. **API parameter shape.**
   Answer: a single `sort` query parameter on `GET /api/spools` with values
   `lastUsed`, `leastRemaining`, `mostRemaining`. Direction is implied by the
   key, so no separate `dir`/`order` parameter is added.

4. **Unknown or missing `sort` value.**
   Answer: default to `lastUsed`. Missing and unknown values are both treated
   as the default; the API does not return 400 for an unknown sort value.

5. **Finished spools under sorting.**
   Answer: when `includeFinished=true`, finished spools are sorted using the
   same rules as active spools (last used from most recent enabled event,
   remaining from the cached `remaining_grams`). They are not forced to the
   bottom.

6. **Expose the computed timestamp in the DTO.**
   Answer: add a nullable `LastUsedAt` field to `SpoolDto` and surface it on
   the spool list/detail UI. This makes the sort column observable and
   auditable.

7. **Persisting the chosen sort in the browser.**
   Answer: reflect the active sort in the URL query string
   (`/spools?sort=<key>`). On page load, missing/invalid values fall back to
   the default (`lastUsed`); the URL is normalized to the resolved value when
   needed. Sort is not persisted in localStorage.

## Assumptions accepted

- The default sort direction for `lastUsed` is most-recent-first, matching the
  request wording "last time used first".
- "Least remaining" and "most remaining" are ordered ascending and descending
  by `remaining_grams` respectively.
- Sorting applies only to `GET /api/spools`. Filament-type listing is out of
  scope; the existing `GET /api/filament-types` ordering is unchanged.
- Sort is applied after facet filtering and is independent of the
  `includeFinished` flag and facet counts.
- Secondary tie-breakers (after the chosen sort key) follow a fixed, stable
  order so that rows do not jump between page-equivalent re-renders:
  `lastUsedAt` (or `CreatedAt`) desc, then `id` asc. This is implementation
  detail surfaced here only because the user raised tie-breaking indirectly
  through "last used" semantics; it is recorded for testability.

## Open decisions

None outstanding. All user-visible behavior decisions are resolved above.

## References consulted

- `doc/todo/001-sorting/README.md` — the immutable original request.
- `doc/spec/application-overview.md` — what the application manages.
- `doc/spec/interfaces.md` — `GET /api/spools` parameters and DTO shape.
- `doc/spec/domain-rules.md` — event kinds, chronological evaluation and
  tie-break rules, derived-cache description of `remaining_grams`,
  `openedAt`, `finishedAt`, and `includeFinished` semantics.
- `doc/spec/architecture.md` — three-layer backend, MariaDB ownership, and the
  denormalized cache columns used by listing queries.
- `src/Filament.Infrastructure/Entities/Entities.cs` — `SpoolEntity` cached
  columns and `SpoolEventEntity.OccurredAt`.
- `src/Filament.Api/Dtos/Dtos.cs` — current `SpoolDto` shape.
- `src/Filament.Core/Services/SpoolLifecycle.cs` — how `OpenedAt`/`FinishedAt`
  are derived from events, confirming that "last used" needs an event-based
  computation rather than a single cached column.
