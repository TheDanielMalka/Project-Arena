# Client Agent — visual alignment with web (Arena HUD refresh)

**Branch (web):** `feat/frontend-arena-visual-overhaul`  
**Scope:** Frontend `src/` only — **no** `engine/`, `contracts/`, `infra/sql/` changes for this pass.

## What changed on the website (for you to mirror in `client/`)

1. **Global atmosphere**
   - Dark base `~hsl(0 0% 3%)` with **radial red wash** from top + subtle **grid** (see `ArenaAmbientBackground.tsx` + `src/index.css` body background).
   - **Glass** utility classes: `.arena-glass`, `.arena-glass-subtle` (blur + semi-transparent surfaces).

2. **Palette**
   - **`--arena-cyan`** is now a **real electric cyan** (`188 94% 42%`) — use the same hue for “sync / live / HUD” accents (was effectively gray before).
   - Primary red unchanged in spirit; sidebar / borders pick up **cyan + red** glow hints.

3. **App shell**
   - **Sidebar:** `variant="floating"` + inner `[data-sidebar="sidebar"]` glass gradient (CSS in `index.css`).
   - **Header:** glass bar; **two pills** — `Play for Stakes` → `/lobby`, `Custom Matches` → `/lobby?tab=custom` (must match web deep-linking).

4. **Match Lobby**
   - **Hero panel:** glass card, conic “orb” glow, **orbiting ring** decorations (pure CSS, `animate-arena-orbit`).
   - **Tabs:** controlled by URL — `?tab=custom` vs default public. Changing tab updates `searchParams` with `replace: true`.

## What you must NOT break (client)

- Same **HTTP paths**, JSON shapes, and session/token behavior as today.
- Do **not** rename engine methods or change heartbeat / bind / capture payloads for “prettier UI”.

## Recommended client implementation order

1. **Theme:** dark window background + cyan/red accents matching hex from web (sample: cyan ≈ `#0ea5e9`–`#22d3ee` range; tune by eye against web).
2. **Panels:** Qt/PySide: semi-transparent frames + 1px borders; optional `backdrop` via layered widgets if feasible.
3. **Typography:** Prefer a condensed / tech font for titles (web uses **Rajdhani** for display).
4. **Lobby card:** echo the **hero** idea — central status + orbiting decoration (pure paint, no new network calls).
5. **Deep link parity:** if the client ever opens the web lobby, support `https://…/lobby?tab=custom` the same way the header does.

## Verification

- Web: `npx tsc -p tsconfig.app.json --noEmit`, Vitest match-related suites pass.
- Client: your existing pytest + manual smoke (bind user, heartbeat, capture) unchanged.

## Files touched (web reference)

- `src/index.css` — theme, glass, sidebar glass, body bg  
- `tailwind.config.ts` — `animate-arena-orbit`  
- `src/components/layout/ArenaAmbientBackground.tsx` (new)  
- `src/components/layout/AppLayout.tsx`  
- `src/components/layout/ArenaSidebar.tsx`  
- `src/components/layout/ArenaHeader.tsx`  
- `src/pages/MatchLobby.tsx` — hero + URL-synced tabs  

---

*Handoff doc for Client Agent — keep logic frozen; match the vibe.*
