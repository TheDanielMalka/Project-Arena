# Client Agent — visual alignment with web (Arena HUD refresh)

**Branch (web):** `feat/frontend-arena-visual-overhaul`  
**Scope:** Frontend `src/` only — **no** `engine/`, `contracts/`, `infra/sql/` changes for this pass.

## What changed on the website (for you to mirror in `client/`)

1. **Global atmosphere**
   - Dark **blue-black** base (`body` in `src/index.css`) with **cyan core bloom**, **blue/magenta** vignette corners, and a fine **cyan grid**.
   - **`ArenaAmbientBackground`:** centered **radar rings** (SVG, slow spin) + soft “energy” orb — reference-style HUD field, not only a flat gradient.
   - **Glass** utilities: `.arena-glass`, `.arena-glass-subtle`; optional **right-rail glow:** `.arena-hud-panel`.

2. **Palette**
   - **`--arena-cyan`** — electric cyan (`188 94% 42%`) for HUD / inputs / borders.
   - **`--arena-hud-blue`** (`210 100% 58%`) and **`--arena-hud-magenta`** (`300 85% 55%`) — outer glows and ambient (match reference screenshot vibe).
   - Primary red unchanged in spirit; **CTA glow** (`.glow-green`) is now **red + magenta** bloom, not flat red only.

3. **Primitives (shadcn — all pages inherit)**
   - **Buttons:** dark gradient shell, **uppercase Orbitron**, strong **primary outer glow** on default; outline = **cyan** rim + inset shadow.
   - **Inputs / textarea / select trigger:** **recessed** wells (inset shadow), cyan border, focus cyan ring.
   - **Cards:** `rounded-xl`, gradient fill, **neon rim** via global `.bg-card` shadow stack.
   - **Tabs:** pill **rail** with inset shadow; active tab = **primary glow pill**.
   - **Display font:** **Orbitron** first, Rajdhani fallback (`tailwind.config.ts` `fontFamily.display`).

4. **App shell**
   - **Sidebar:** `variant="floating"` + inner `[data-sidebar="sidebar"]` glass gradient (CSS in `index.css`).
   - **Header:** glass bar; **two pills** — `Play for Stakes` → `/lobby`, `Custom Matches` → `/lobby?tab=custom` (must match web deep-linking).

5. **Match Lobby**
   - **Hero panel:** glass card, conic “orb” glow, **orbiting ring** decorations (pure CSS, `animate-arena-orbit`).
   - **Tabs:** controlled by URL — `?tab=custom` vs default public. Changing tab updates `searchParams` with `replace: true`.

6. **Per-route HUD shell (`ArenaPageShell` + `src/components/visual/`)**
   - Each main authenticated page wraps content in **`ArenaPageShell`** with a **`variant`** — adds a **tactical border** + **unique ambient decor** (pointer-events none): lobby scan line, leaderboard podium mesh, wallet circuit trace, profile ID shimmer + corner brackets, admin system stripes, etc.
   - **`TacticalFrame`:** optional chamfered clip-path wrapper (used on Profile identity card).
   - **CSS:** `.arena-hud-scan`, `.arena-tactical-frame`, **`prefers-reduced-motion`** disables decor animations (`.arena-decor-animate`, scan, shimmer).
   - **Profile:** the redundant **“Platform IDs”** verify block was **removed** from the web UI; Steam still shows on the connections strip from `user.steamId`.

## What you must NOT break (client)

- Same **HTTP paths**, JSON shapes, and session/token behavior as today.
- Do **not** rename engine methods or change heartbeat / bind / capture payloads for “prettier UI”.

## Recommended client implementation order

1. **Theme:** dark window background + cyan/red accents matching hex from web (sample: cyan ≈ `#0ea5e9`–`#22d3ee` range; tune by eye against web).
2. **Panels:** Qt/PySide: semi-transparent frames + 1px borders; optional `backdrop` via layered widgets if feasible.
3. **Typography:** Tech display for titles — web uses **Orbitron** (with **Rajdhani** fallback).
4. **Lobby card:** echo the **hero** idea — central status + orbiting decoration (pure paint, no new network calls).
5. **Deep link parity:** if the client ever opens the web lobby, support `https://…/lobby?tab=custom` the same way the header does.

## Verification

- Web: `npx tsc -p tsconfig.app.json --noEmit`, Vitest match-related suites pass.
- Client: your existing pytest + manual smoke (bind user, heartbeat, capture) unchanged.

## Files touched (web reference)

- `src/index.css` — theme, HUD vars, glass, sidebar, body bg, `.arena-hud-panel`, radar keyframes  
- `tailwind.config.ts` — `fontFamily.display` (Orbitron), `arena.hud-blue` / `arena.hud-magenta`, `animate-arena-orbit`  
- `src/components/layout/ArenaAmbientBackground.tsx` — grid, vignettes, **radar SVG**  
- `src/components/ui/{button,input,card,textarea,tabs,select,badge}.tsx` — global HUD styling  
- `src/components/layout/AppLayout.tsx`  
- `src/components/layout/ArenaSidebar.tsx`  
- `src/components/layout/ArenaHeader.tsx`  
- `src/pages/MatchLobby.tsx` — hero + URL-synced tabs + `ArenaPageShell variant="lobby"`  
- `src/components/visual/` — `ArenaPageShell`, `ArenaPageDecor`, `TacticalFrame`, `types`  
- Major pages using the shell: `Dashboard`, `MatchLobby`, `Leaderboard`, `Wallet`, `Profile`, `Admin`, `History`, `Hub`, `Forge`, `Settings`, `ArenaClient`, `Players`, `PlayerProfile`  

---

*Handoff doc for Client Agent — keep logic frozen; match the vibe.*
