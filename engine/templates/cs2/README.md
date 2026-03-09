# CS2 Dataset (M2 - Issue #11)

This folder stores CS2 end-screen images for matcher and OCR validation.

## Naming Convention

Use this exact format:

`cs2_<resolution>_<result>_<map>.png`

Examples:

- `cs2_1920x1080_victory_nuke.png`
- `cs2_1280x720_defeat_dust2.png`
- `cs2_800x600_victory_mirage.png`

## Rules

- `resolution`: `<width>x<height>` (for example `1920x1080`)
- `result`: `victory` or `defeat`
- `map`: lowercase map name (for example `nuke`, `anubis`, `dust2`)
- file extension: `.png` only

## Minimum Dataset Target

- 20+ victory images
- 20+ defeat images
- multiple maps
- multiple resolutions

## Notes

- Keep raw screenshots visually clean (scoreboard/end-screen visible).
- Do not rename files with custom/random patterns.
- New images must follow the naming convention before commit.
