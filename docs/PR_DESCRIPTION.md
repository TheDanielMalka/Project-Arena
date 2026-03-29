# Pull request: Forge / avatars / DB alignment / Valorant matcher

Copy the sections below into the GitHub PR description when you open the PR from branch `feat/forge-ui-avatar-db-sync`.

## Summary

- **Forge shop & cosmetics:** Live previews, `frame` category, icon scheme (`preset:`, `bg:`, `badge:`, etc.), USDT confirm styling, catalog updates (incl. Vermilion Edge / legacy `seraph_blade` mapping).
- **Avatars:** Centralized `avatarPresets.ts` (DiceBear pixel-art default, optional micah), `preset:{id}` and `upload:` handling across Profile, PlayerProfile, Players, Hub, Dashboard, Leaderboard, MatchLobby, ArenaSidebar.
- **Wallet / types:** Transaction types aligned with non-custodial flows (`at_purchase`, `at_spend`); wallet store tests avoid `any`.
- **Database (`infra/sql/init.sql`):** `users.avatar` documents `preset:{id}`; `forge_items.category` includes `frame`; `tx_type` adds `at_purchase`, `at_spend`; `tx_status` adds `cancelled`; forge `icon` column comment matches UI tokens.
- **Engine:** Valorant end-screen detection retuned (teal VICTORY crop/HSV, red DEFEAT HSV); `engine/tests/test_matcher.py` updated for new crop and red defeat.
- **CI stability:** `npm test` runs `vitest run --maxWorkers=2` to reduce parallel timeouts on GitHub runners.

## Checklist for reviewers

- [ ] Frontend: `npx tsc -p tsconfig.app.json`, `npm run build`, `npm test`
- [ ] Engine (if this PR includes `engine/`): `pytest engine/tests -v` (CI runs targeted `test_matcher.py` when matcher changes)
- [ ] SQL: fresh `init.sql` applies on empty DB; **existing** DBs need a migration (enum values + CHECK) — not auto-run by CI `sql-check` unless `.sql` files change in the PR

## Scope note (monorepo)

This branch combines **UI (`src/`)** and **engine (`engine/`)** changes. If you prefer strict ownership splits per `CLAUDE.md`, merge UI and engine as two PRs from separate branches; functionally they are independent.

## Related

- Types: `src/types/index.ts` — `ForgeCategory`, `UserProfile.avatar`, `TransactionType`
- Naming contract: root `CLAUDE.md` (API field names unchanged in this PR)
