# Application Overview

Filament is a privately hosted inventory application for individuals and small teams operating 3D-print farms. It records filament products and the physical spools that contain them, so operators can see stock, record material use, retain a print history, and identify a spool from a physical label.

The intended scale is approximately 50-150 filament types, 50-300 spools, and up to five concurrent LAN users. The interface is responsive and supports desktop and phone use.

## What it manages

- A **filament type** is a reusable catalogue entry: brand, material, product type/finish, colour, optional hex colour, default net weight, and empty-spool weight.
- A **spool** is one physical instance of a filament type. It has its own short ID, initial net weight, optional empty-spool-weight override, status, notes, and append-only operational history.
- **Events** record creation, opening, individual prints, weighed adjustments, and finishing. The live status and remaining material are derived from enabled events, so history remains auditable and an event can be undone or redone safely.

## User capabilities

- Create, list, filter, and delete filament types. A type cannot be deleted while any spool still references it.
- Create physical spools from a type, optionally overriding its default net and empty-spool weights. New spools start sealed.
- Open a spool; record each print with grams consumed and optional project name and URL; set the remaining amount from a measured value; and explicitly finish or reopen it.
- Delete a spool and its event history from its detail page; the action becomes enabled only once every non-creation event of the spool has been undone.
- Review per-spool history, including running material balance and undone entries.
- Filter types and spools by brand, material, product type, and colour; select multiple spools; and download a printable label PDF with a chosen number of identical copies per spool.
- Sort the spool list by last used (default), least remaining, or most remaining. Sorting is performed by the backend and the active sort is reflected in the `/spools` URL.
- See dashboard counts, active remaining stock, and a two-line consumption graph over the last 30 UTC days: per-day total stock (remaining grams on non-finished spools) and per-day consumed filament (enabled prints only), zero-filled for days without events, with a hover/tap readout of the exact per-day values. The "Used (30 d)" and "Busiest day" figures are derived from the consumed (prints-only) line.
- Receive live notifications of changes made from another browser and recover automatically after a deployment restart.
- Recompute spool caches from their event histories after a manual database intervention.

## Scope and security boundary

Authentication and authorization are not implemented. The application must therefore be treated as a trusted-LAN service: anyone who can reach the web or API port can change inventory and download labels. It must not be exposed directly to an untrusted network without an access-control layer in front of it.

The current behavior is specified in the linked documents in this directory. Project intent and coding context are also maintained in [`.opencode/opencode-instructions.md`](../../.opencode/opencode-instructions.md).
