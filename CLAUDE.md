# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A two-stage personal pipeline that fills a Samsung Frame TV's Art Mode with paintings from the Rijksmuseum collection. Stage 1 (Node) fetches and resizes images; stage 2 (Python) pushes a random one to the TV over the LAN. Based on [Samsung Frame Art Mode++](https://github.com/ow/samsung-frame-art).

Uses the current keyless [Rijksmuseum Data Services](https://data.rijksmuseum.nl/docs) (Search API + Linked Art + IIIF). The legacy REST collection API (with `API_KEY`) has been retired and is no longer used.

## Commands

```bash
# Stage 1a — web picker: search, preview, select, download (run from rijksmuseum/)
cd rijksmuseum && npm run serve      # http://localhost:3000 (PORT to override)

# Stage 1b — CLI alternative: bulk-download every match for the default query
cd rijksmuseum && node index.js

# Stage 2 — upload a random unsent image to the TV (run from repo root)
python3 art.py
```

Re-running `art.py` is the intended UX: each run picks a new random image and changes what's on the TV.

## Architecture

The two stages are decoupled and communicate only through the `images/` folder on disk:

- **`rijksmuseum/index.js`** — Node 18+, native `fetch`, no API key. Walks a 4-step chain: Search API → resolve each object as Linked Art JSON-LD (`Accept: application/ld+json`) for its title + `shows` VisualItem → VisualItem's `digitally_shown_by` DigitalObject → DigitalObject's `access_point` IIIF Image URL (`https://iiif.micr.io/<id>/full/max/0/default.jpg`). `downloadImage` resizes to **3840×2160** with `sharp` (cover-crop) and writes `images/<sanitized-title>.jpg`. The core functions (`searchPage`, `searchObjectIds`, `resolveArtwork`, `downloadImage`, `mapWithConcurrency`) are **exported** for reuse by `server.js`; running it directly (`require.main` guard) bulk-downloads the default `CLI_QUERY`. `resolveArtwork` also derives a `thumbUrl` by swapping `/full/max/` → `/full/400,/` in the IIIF URL. Deps: `sharp` + `sanitize-filename`.

- **`rijksmuseum/server.js`** — small Express app (the web picker backend). Serves the static `public/` page and three endpoints, all reusing `index.js`: `GET /api/search` (search + concurrent resolve → `{items, nextToken, totalItems}`, thumbnails only), `POST /api/download` (`{items:[{title, imageUrl}]}` → `downloadImage` each), `GET /api/existing` (filenames already in `images/`, for dedup badges). Listens on `PORT` (default 3000). `public/` is dependency-free vanilla HTML/CSS/JS; thumbnails load directly from `iiif.micr.io` (CORS `*`), and only the curated download round-trips to the server (browsers can't run `sharp` or write to `images/`).

- **`art.py`** — connects to the TV via `samsungtvws.SamsungTVWS(<ip>)`. The TV IP is **hardcoded** (`192.168.0.230` currently) and the script appends `../` to `sys.path` to import `samsungtvws`, which is **not** a declared dependency here — it must be installed/available on the machine. Checks `tv.art().supported()`, then picks a random `.jpg`/`.png` from `images/` that isn't already recorded as uploaded, uploads it (`file_type` JPEG/PNG, `matte="none"`), and selects it.

- **`uploaded_files.json`** — the dedup ledger. Maps each local `file` to the `remote_filename` the TV assigned (e.g. `MY_F0008`). On each run, already-uploaded files are subtracted from the candidate set; if a chosen file is already in the ledger it's re-selected by remote name instead of re-uploaded. This file is committed and grows over time.

## Notes for changes

- Day-to-day querying is done via the web picker (no code edits). The CLI default lives in `CLI_QUERY` / `CLI_AMOUNT` in `rijksmuseum/index.js`. The exposed search fields are the `SEARCH_PARAMS` array; `type` uses English Linked Art values (`painting`), while free-text fields like `title` can be Dutch (`landschap` = landscape) since titles are in Dutch. See [Search API docs](https://data.rijksmuseum.nl/docs/search) for all params.
- Changing the target TV means editing the hardcoded IP in `art.py`. A static IP for the TV is recommended.
- `images/` holds the active set; `old_images/` is an archive of previously-used art. Image filenames double as identity keys in `uploaded_files.json`, so renaming a file in `images/` makes it look new to `art.py`.
