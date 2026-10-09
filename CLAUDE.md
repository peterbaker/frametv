# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Purpose

Single-file Python CLI (`art.py`) that fetches artwork from the Rijksmuseum API and rotates it onto a Samsung Frame TV's Art Mode. Replaces an earlier two-language pipeline (Node fetch + Python upload).

## Commands

```bash
uv sync                          # install deps (samsungtvws, pillow, requests, dotenv)
uv run art.py fetch              # download artwork → images/
uv run art.py rotate             # pick & display next image
uv run art.py status -v          # local + TV state
```

All config comes from `.env` at repo root (see `.env.example`). No tests, no lint, no CI — personal home automation.

## Architecture

- **`art.py`** — flat module, three subcommands wired through argparse: `fetch`, `rotate`, `status`. Shared `Config` (env-loaded dataclass) + `State` (JSON-backed list of `StateEntry`).
- **`state/uploaded.json`** — source of truth for what's been pushed to the TV. Each entry: `file`, `remote_filename` (TV's `MY_F00xx` handle), plus optional metadata (`title`, `artist`, `source_url`, `object_number`, `uploaded_at`). Legacy flat `uploaded_files.json` at repo root is auto-migrated on first run.
- **`state/tv_token.txt`** — Samsung TV pairing token; persisted so the TV doesn't prompt for approval every connection. Gitignored.
- **`images/`** — curate freely. `fetch` skips files that already exist (use `--force` to re-download); `rotate` only picks files with no `remote_filename` in state (use `--allow-repeat` to recycle).

## Key invariants & gotchas

- **TV IP is in `.env`**, not source. `_connect_tv` does a 3-second TCP probe to port 8002 before instantiating `SamsungTVWS`, so a sleeping TV produces a clean error instead of hanging.
- **Resize is in-place** in `resize_cover` — `fetch` overwrites the downloaded JPEG with a 3840×2160 cover-cropped version. Don't drop originals you want preserved into `images/` without backup.
- **`StateEntry.add_or_update`** merges by `file` key — duplicates of the same filename can't accumulate. But two different filenames pointing at the same image will both upload (a known limitation; metadata lets you spot it manually via `status -v`).
- **Pillow 11 compatibility**: `Image.Resampling.LANCZOS` is required. The old `python-resize-image` dep was dropped because it referenced removed `Image.ANTIALIAS`.

## Upstream

`samsungtvws` (xchwarze/samsung-tv-ws-api) — `tv.art()` API for Frame TVs. v3.x token-file param is what enables persistent pairing.

## Open issues (as of 2026-10-09)

### `fetch` uses the retired Rijksmuseum API — likely broken
`art.py` (`RIJKS_BASE`, `cmd_fetch`) still calls `https://www.rijksmuseum.nl/api/nl/collection` with `RIJKS_API_KEY`. Upstream reports that REST API is retired. `rotate` and `status` don't touch it and still work. Not yet confirmed by running `fetch`.

**Fix plan:** port upstream's keyless flow to Python in `cmd_fetch`: Search API → Linked Art JSON-LD → IIIF image URL. Reference implementation: upstream commit `1d12ed6`, file `rijksmuseum/index.js` (`git show 1d12ed6:rijksmuseum/index.js`; `upstream` remote = mmargauxx/frametv). Then drop `RIJKS_API_KEY` from `Config` and `.env.example`. Optional: upstream's web picker (`rijksmuseum/server.js` + `public/`) as a later `art.py serve` subcommand.

### Upstream divergence
`origin` = peterbaker/frametv (fork), `upstream` = mmargauxx/frametv. Upstream `main` was merged with `-s ours` on 2026-10-09: its history is in, its file changes are not. Its 2022+/2024 Frame TV fix (`3668727`) was skipped deliberately — this TV is a 2021 QN65LS03AAFXZA. Revisit if the TV is replaced.
