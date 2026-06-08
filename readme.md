# Samsung Frame Art Mode Enhanced with Rijksmuseum API

Based on the repository by Ow: [Samsung Frame Art Mode++](https://github.com/ow/samsung-frame-art/blob/main/readme.md)

Uses the current keyless [Rijksmuseum Data Services](https://data.rijksmuseum.nl/docs)
(Search API + Linked Art + IIIF) — no API key required.

## Using the web picker (recommended)
- `cd rijksmuseum && npm install && npm run serve`, then open
  `http://localhost:3000`.
- Enter a query, preview the thumbnail grid, tick the works you want, and click
  **Download selected** to save them (resized to `3840 x 2160`) into `images/`.
- Run `python3 art.py` to push a random image to the TV. Run it again anytime
  you want the image to change.

## Or use the CLI
- Edit the default query at the top of `rijksmuseum/index.js`, then run
  `cd rijksmuseum && npm install && node index.js` to bulk-download every match
  into `images/`.

## Pushing to the TV (`art.py`)
- Install the (maintained) Python library: `python3 -m pip install -r requirements.txt`.
  This pulls `samsungtvws >= 3.0`, which is what adds support for newer Frames.
  > Note: `art.py` still has `sys.path.append('../')` near the top. If you have an
  > **old vendored** copy of `samsungtvws` at `../samsungtvws`, it will shadow the
  > installed one — remove it so the modern library is used.
- Set your TV's IP in `art.py` (`tv_ip`), then run `python3 art.py`.
- **First run on 2022+ Frames:** the TV shows a one-time *Allow / Deny* prompt —
  accept it. The pairing token is saved to `tv-token.txt` (gitignored) so later
  runs connect silently.

### TV compatibility
- ✅ **2020 / 2021 Frame TVs** — known working (the original, tested route).
- ⚠️ **2022 / 2023 / 2024 Frame TVs** — Samsung changed the art-mode API. `art.py`
  now tries the authenticated secure connection (port 8002 + token) these models
  require, and falls back to the legacy port-8001 path for older sets. Newer-model
  support is **community-reported and inconsistent** and has not been verified
  here — if you try it on a 2022+ Frame, please report whether it works.
