# Samsung Frame TV — Rijksmuseum Art Rotator

Pulls top artwork from the [Rijksmuseum API](https://data.rijksmuseum.nl/object-metadata/api/),
crops it to 3840×2160, and rotates it onto a Samsung Frame TV in Art Mode.

Originally based on [ow/samsung-frame-art](https://github.com/ow/samsung-frame-art); rewritten
as a single Python CLI with token-persisted TV pairing and skip-if-exists fetch.

## Setup (one time)

```bash
cp .env.example .env
# Edit .env — at minimum set RIJKS_API_KEY and TV_IP
uv sync
```

Get a Rijksmuseum API key at <https://data.rijksmuseum.nl/object-metadata/api/>.
Find your TV's IP in its network settings (use a static lease).

## Usage

```bash
uv run art.py fetch                        # download default query into images/
uv run art.py fetch -q "stilleven" -n 30   # custom query, 30 results
uv run art.py rotate                       # push next un-shown image to the TV
uv run art.py rotate --file foo.jpg        # show a specific file
uv run art.py rotate --allow-repeat        # recycle once you've cycled through
uv run art.py status -v                    # what's local, what's on the TV
```

First `rotate` will pop a permission dialog on the TV — approve it once and the
token is saved to `state/tv_token.txt` so it never asks again.

## Daily auto-rotation (macOS)

```bash
sed "s|{{REPO}}|$(pwd)|g" scripts/com.pete.frametv-rotate.plist \
    > ~/Library/LaunchAgents/com.pete.frametv-rotate.plist
launchctl load ~/Library/LaunchAgents/com.pete.frametv-rotate.plist
```

Rotates at 09:00 daily. Logs to `state/rotate.log`.

## Layout

```
art.py              # the entire CLI
pyproject.toml      # uv-managed deps
.env                # config (gitignored)
images/             # downloaded artwork (curate freely)
state/uploaded.json # local→TV mapping + metadata
state/tv_token.txt  # TV pairing token (gitignored)
scripts/            # LaunchAgent template
```
