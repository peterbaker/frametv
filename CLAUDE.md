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
