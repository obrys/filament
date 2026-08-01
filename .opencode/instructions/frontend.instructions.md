---
applyTo: "web/**"
---

# Front-end coding instructions

## Stack

- **React 18+** with **TypeScript** (strict mode enabled).
- **Vite** as the build tool.
- Minimalistic UI — prefer native HTML elements and CSS over heavy component libraries.
- Responsive design: mobile-first, works on phone, tablet and desktop without separate layouts.

## File & folder conventions

```
web/src/
  api/          # Typed API client functions (one file per resource or a single client.ts)
  pages/        # Top-level page components (one file per route)
  components/   # Shared, reusable UI components
  realtime/     # WebSocket / SignalR client logic
  hooks/        # Custom React hooks
  styles.css    # Global styles
  main.tsx      # App entry point
```

- Page components are named `<PageName>.tsx` (e.g. `SpoolDetail.tsx`).
- Shared components are named in PascalCase (e.g. `SpoolCard.tsx`).
- Custom hooks are prefixed `use` (e.g. `useSpools.ts`).

## API client

- All HTTP calls go through `web/src/api/client.ts`.
- Use `fetch` with typed wrappers — no axios unless already added.
- Every API function is async and returns a typed result or throws on HTTP error.

## Real-time (WebSocket / SignalR)

- The SignalR client lives in `web/src/realtime/`.
- Implement a **keep-alive** mechanism: the server pings every N seconds; if the client misses
  M consecutive pings it shows a "disconnected" indicator and attempts reconnection with
  exponential back-off.
- Clean up hub connections (`connection.stop()`) in `useEffect` cleanup functions to prevent
  memory leaks — every `useEffect` that opens a connection **must** return a cleanup function.
- On reconnect, re-fetch the relevant data once before re-subscribing to events.

## State management

- Use React built-ins (`useState`, `useReducer`, `useContext`) for local and shared state.
- Avoid global state libraries unless the complexity clearly justifies it.

## TypeScript style

- Enable `strict: true` — no `any` unless absolutely unavoidable (comment why).
- Define API response shapes as `interface` or `type` in `api/` and reuse them in components.
- Use `React.FC<Props>` or explicit return types on components.
