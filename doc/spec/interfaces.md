# Interfaces

## Web application

The SPA has these browser routes:

| Route | Purpose |
|---|---|
| `/` | Dashboard counts and the last 30 days of consumption. |
| `/types` | Filament-type list, facets, creation, and deletion. |
| `/spools` | Spool list, facets, finished toggle, sort selector, creation, label selection with a print-copies dialog, and link to repair. |
| `/spools/:id` | Spool details, current weights/status, lifecycle actions, and event history. |
| `/spools/maintenance` | Re-evaluate all cached spool states. |

The web container serves the SPA and reverse-proxies `/api/` and `/ws/` to the API. Browser history routes resolve to `index.html`. Hashed assets are cached for one year; the HTML shell is deliberately not cached, so a deploy can load a matching client bundle.

## HTTP API

The API uses JSON and serializes enum values as strings. Successful mutations notify connected WebSocket clients. Standard error behavior is `404` for an unknown resource, `400` for invalid lifecycle input, and `409` when a type with spools is deleted. The development environment exposes an OpenAPI document at `/openapi/v1.json`.

| Method and path | Behavior |
|---|---|
| `GET /api/filament-types` | List types and facets. Repeat `brand`, `material`, `type`, and `color` query keys to filter. |
| `GET/PUT/DELETE /api/filament-types/{id}` | Read, replace, or delete a type. Deletion fails if any spool references it. |
| `POST /api/filament-types` | Create a type; the server assigns its ID. |
| `GET /api/spools` | List spools and facets. Supports `filamentTypeId`, `includeFinished`, `sort`, and the shared facet keys. |
| `GET /api/spools/{id}` | Read a spool, including effective empty-spool and total weights. |
| `POST /api/spools` | Create a sealed spool and its immutable creation event. |
| `DELETE /api/spools/{id}` | Delete a spool and its event history. |
| `GET /api/spools/{id}/events` | List history with running balances; disabled events have `remainingAfterGrams: null`. |
| `POST /api/spools/{id}/open` | Open a sealed spool. |
| `POST /api/spools/{id}/consume` | Record `{ grams, projectName?, projectUrl?, notes? }`. |
| `POST /api/spools/{id}/adjust` | Set `{ newRemainingGrams, notes? }`. |
| `POST /api/spools/{id}/finish` | Add or redo a finish marker. |
| `POST /api/spools/{id}/events/{eventId}/disable` | Undo an event subject to lifecycle guards. |
| `POST /api/spools/{id}/events/{eventId}/enable` | Redo an event subject to lifecycle guards. |
| `POST /api/spools/reevaluate` | Repair cached state for all spools from their histories. |
| `GET /api/dashboard/summary` | Return type, active-spool, finished-spool, and active-remaining totals. |
| `GET /api/dashboard/usage?days=30` | Return daily consumed grams; `days` is clamped to 1-365. |
| `GET /api/labels?id=ABCD&id=EFGH&copies=K` | Download labels for one or more existing spool IDs; optional `copies` (whole number 1–10, default 1) prints K identical copies per spool. |
| `GET /healthz` | Liveness response: `{"status":"ok"}`. |
| `GET /api/version` | Running backend build version; returns `503` while graceful shutdown is in progress. |

Creation and update payload fields correspond to the domain model. The server currently relies on domain workflow checks rather than a broad request-validation layer; callers should provide valid strings and sensible, non-negative weight values.

### Spool list sorting

`GET /api/spools` accepts a `sort` query parameter that selects the server-side ordering of the spool list (sorting is performed by MariaDB in the listing query, not in the client). Recognized values are case-sensitive:

| Value | Meaning |
|---|---|
| `lastUsed` | Most recent `lastUsedAt` first (descending). The default when `sort` is missing, empty, or unrecognized. |
| `leastRemaining` | Smallest `remaining_grams` first (ascending). |
| `mostRemaining` | Largest `remaining_grams` first (descending). |

An unknown `sort` value resolves to `lastUsed` and does not produce a `400`. After the chosen sort key, a fixed secondary order keeps results stable: `lastUsedAt` descending, then spool `id` ascending. Sorting applies after facet filtering and is independent of `includeFinished` and the facet counts. See the completed [001-sorting](../done/001-sorting/) change request for the full rationale.

Each `SpoolDto` returned by `GET /api/spools` and `GET /api/spools/{id}` includes a `lastUsedAt` timestamp: the `occurredAt` of the most recent enabled event on the spool, which for a spool with only the immutable `Created` event equals that event's `occurredAt` (the spool's `CreatedAt`). The SPA `/spools` page exposes the active sort through a selector bound to the URL (`/spools?sort=<key>`); a missing or unknown URL value resolves to `lastUsed` and the address bar is normalized to the resolved value. The selector does not reorder rows client-side.

## Printable labels

`GET /api/labels` returns `application/pdf` with download name `spool-labels.pdf`. Unknown IDs are skipped; if none resolve, the request returns `404`. At least one `id` query value is required.

An optional `copies` query parameter sets the number of identical labels per spool: `copies` missing or empty means 1 (one label per resolved spool, the prior behavior); a whole number from 1 to 10 produces that many contiguous copies of each spool; any other value (`0`, a negative number, a fraction such as `1.5`, a non-numeric `abc`, or `11`) returns `400` with no PDF. Copies of a spool stay adjacent and spools appear in the order their `id` values occur in the request, so `?id=A&id=B&copies=2` yields A, A, B, B; a repeated `id` occurrence each produces its own `copies` labels.

```mermaid
flowchart LR
    Select[Select spools] --> Dialog[Choose copies K: 1-10]
    Dialog --> Request[GET /api/labels?id=...&copies=K]
    Request --> Resolve[Resolve spool and filament type]
    Resolve --> Expand[K contiguous copies per spool]
    Expand --> QR[Build QR URL: public host /spools/spool-id]
    QR --> PDF[Tiled A4 PDF, ceil(n/14) pages]
    PDF --> Print[Print and attach labels]
```

Each label is a bordered 70 x 35 mm panel. The generator tiles two labels per row on an A4 page with a 10 mm page margin (14 labels per page); when the total exceeds 14, the PDF continues on additional A4 pages using the same tiling, rows are never split across pages, so the document has exactly `ceil(label count / 14)` pages. A label includes brand, material, type, colour name, a colour swatch only when its supplied hex value is a valid six- or eight-digit hex value, the spool ID, and a 28 mm QR code. The QR payload is an absolute spool page URL assembled from the request scheme and host seen by the API. Generate labels through the web endpoint, not direct API port 8080: the API host does not serve the SPA route embedded in the QR code. The supplied proxy preserves the public host, but the API does not enable forwarded-header processing; its current QR URLs behind TLS termination therefore use `http` and rely on the proxy's HTTP-to-HTTPS redirect. This remains functional with the supplied proxy but is relevant when deploying behind another proxy.

On the `/spools` page, "Print labels (N)" opens an in-page dialog instead of directly opening a new tab. The dialog shows the selected spool count, a copies field (a whole number from 1 to 10, initialised from the last used value kept in browser storage or `1` when none is stored), the resulting label count (selected spools × copies), and Print / Cancel buttons. Print opens the label PDF in a new tab for the selected spools in their request order with `copies=K` and stores K as the last used value; an empty or out-of-range field falls back to `copies=1`. Cancel closes the dialog with no request and leaves the selection unchanged. See the completed [003 multiple copies of labels](../done/003-multiple-copies-of-labels/) change request for the full specification and rationale.

## Real-time and deployment behavior

Clients connect to `GET /ws/changes` as a WebSocket. Any text frame containing `ping` is answered with `{"type":"pong"}`; the SPA sends a ping every 20 seconds and reconnects after failures using exponential backoff from approximately 2 seconds up to 30 seconds.

After an inventory mutation, the server broadcasts `{"type":"change","resource":"spool|filament-type","id":"..."}`. Views reload their relevant data on receipt. During graceful API shutdown, the server sends `{"type":"server-shutdown"}`, closes sockets, and the client polls `/api/version` every five seconds. A changed version triggers a page reload; an unchanged version resumes the UI.

Every HTTP response includes `X-App-Version`. Deploy builds stamp both frontend and backend from the current Git description; dirty builds include a deterministic hash of the uncommitted diff.
