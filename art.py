#!/usr/bin/env python3
"""Rotate Rijksmuseum artwork on a Samsung Frame TV's Art Mode.

Subcommands:
    fetch   Download & resize artwork from the Rijksmuseum API into images/
    rotate  Pick an un-displayed image and push it to the TV
    status  Show local & TV state summary

Run `art.py <cmd> --help` for options.
"""
from __future__ import annotations

import argparse
import json
import logging
import os
import random
import re
import socket
import sys
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import requests
from dotenv import load_dotenv
from PIL import Image

ROOT = Path(__file__).resolve().parent
STATE_DIR = ROOT / "state"
STATE_FILE = STATE_DIR / "uploaded.json"
TOKEN_FILE = STATE_DIR / "tv_token.txt"
LEGACY_STATE = ROOT / "uploaded_files.json"

log = logging.getLogger("frame-art")


# ---------- config ----------

@dataclass
class Config:
    tv_ip: str
    tv_name: str
    rijks_api_key: str
    rijks_type: str
    rijks_query: str
    rijks_count: int
    image_dir: Path
    target_width: int
    target_height: int

    @classmethod
    def load(cls) -> "Config":
        load_dotenv(ROOT / ".env")
        image_dir = Path(os.getenv("IMAGE_DIR", "images"))
        if not image_dir.is_absolute():
            image_dir = ROOT / image_dir
        return cls(
            tv_ip=os.getenv("TV_IP", ""),
            tv_name=os.getenv("TV_NAME", "FrameArtRotator"),
            rijks_api_key=os.getenv("RIJKS_API_KEY", ""),
            rijks_type=os.getenv("RIJKS_TYPE", "schilderij"),
            rijks_query=os.getenv("RIJKS_QUERY", "landschap"),
            rijks_count=int(os.getenv("RIJKS_COUNT", "50")),
            image_dir=image_dir,
            target_width=int(os.getenv("TARGET_WIDTH", "3840")),
            target_height=int(os.getenv("TARGET_HEIGHT", "2160")),
        )


# ---------- state ----------

@dataclass
class StateEntry:
    file: str
    remote_filename: str | None = None
    title: str | None = None
    artist: str | None = None
    source_url: str | None = None
    object_number: str | None = None
    uploaded_at: str | None = None

    def to_dict(self) -> dict[str, Any]:
        return {k: v for k, v in self.__dict__.items() if v is not None}


@dataclass
class State:
    entries: list[StateEntry] = field(default_factory=list)

    @classmethod
    def load(cls) -> "State":
        STATE_DIR.mkdir(exist_ok=True)
        # Migrate legacy flat file on first run
        if not STATE_FILE.exists() and LEGACY_STATE.exists():
            log.info("Migrating legacy uploaded_files.json → state/uploaded.json")
            legacy = json.loads(LEGACY_STATE.read_text())
            entries = [StateEntry(**e) for e in legacy]
            state = cls(entries=entries)
            state.save()
            return state
        if not STATE_FILE.exists():
            return cls()
        raw = json.loads(STATE_FILE.read_text())
        return cls(entries=[StateEntry(**e) for e in raw])

    def save(self) -> None:
        STATE_DIR.mkdir(exist_ok=True)
        STATE_FILE.write_text(
            json.dumps([e.to_dict() for e in self.entries], indent=2)
        )

    def has_file(self, filename: str) -> bool:
        return any(e.file == filename for e in self.entries)

    def find(self, filename: str) -> StateEntry | None:
        return next((e for e in self.entries if e.file == filename), None)

    def add_or_update(self, entry: StateEntry) -> None:
        existing = self.find(entry.file)
        if existing:
            for k, v in entry.to_dict().items():
                setattr(existing, k, v)
        else:
            self.entries.append(entry)


# ---------- image helpers ----------

def _safe_filename(name: str) -> str:
    name = re.sub(r"[^\w\s\-.]", "", name, flags=re.UNICODE).strip()
    name = re.sub(r"\s+", " ", name)
    return name or "untitled"


def resize_cover(src: Path, width: int, height: int) -> None:
    """Resize-and-crop to exactly width×height (cover behavior). Overwrites src."""
    with Image.open(src) as img:
        img = img.convert("RGB") if img.mode != "RGB" else img
        src_ratio = img.width / img.height
        dst_ratio = width / height
        if src_ratio > dst_ratio:
            new_w = int(img.height * dst_ratio)
            offset = (img.width - new_w) // 2
            img = img.crop((offset, 0, offset + new_w, img.height))
        else:
            new_h = int(img.width / dst_ratio)
            offset = (img.height - new_h) // 2
            img = img.crop((0, offset, img.width, offset + new_h))
        img = img.resize((width, height), Image.Resampling.LANCZOS)
        img.save(src, format="JPEG", quality=92)


# ---------- fetch ----------

RIJKS_BASE = "https://www.rijksmuseum.nl/api/nl/collection"


def cmd_fetch(cfg: Config, args: argparse.Namespace) -> int:
    if not cfg.rijks_api_key:
        log.error("RIJKS_API_KEY missing — set it in .env")
        return 1
    cfg.image_dir.mkdir(exist_ok=True)
    query = args.query or cfg.rijks_query
    type_ = args.type or cfg.rijks_type
    count = args.count or cfg.rijks_count

    log.info("Searching Rijksmuseum: type=%s q=%s count=%d", type_, query, count)
    resp = requests.get(
        RIJKS_BASE,
        params={
            "key": cfg.rijks_api_key,
            "imgonly": "True",
            "toppieces": "True",
            "type": type_,
            "ps": count,
            "q": query,
        },
        timeout=30,
    )
    resp.raise_for_status()
    objects = resp.json().get("artObjects", [])
    log.info("API returned %d objects", len(objects))

    state = State.load()
    downloaded = 0
    skipped = 0
    for obj in objects:
        title = obj.get("title") or obj.get("objectNumber", "untitled")
        artist = obj.get("principalOrFirstMaker")
        web_image = obj.get("webImage") or {}
        url = web_image.get("url")
        if not url:
            continue
        filename = f"{_safe_filename(title)}.jpg"
        dest = cfg.image_dir / filename

        if dest.exists() and not args.force:
            skipped += 1
            continue

        log.info("Downloading %s", filename)
        try:
            r = requests.get(url, timeout=60, stream=True)
            r.raise_for_status()
            with dest.open("wb") as f:
                for chunk in r.iter_content(chunk_size=64 * 1024):
                    f.write(chunk)
            resize_cover(dest, cfg.target_width, cfg.target_height)
        except Exception as exc:
            log.warning("Failed to download %s: %s", filename, exc)
            dest.unlink(missing_ok=True)
            continue

        # Stash metadata pre-emptively (no remote_filename until uploaded)
        entry = state.find(filename) or StateEntry(file=filename)
        entry.title = title
        entry.artist = artist
        entry.source_url = url
        entry.object_number = obj.get("objectNumber")
        state.add_or_update(entry)
        downloaded += 1

    state.save()
    log.info("Fetch complete: %d downloaded, %d skipped (already on disk)", downloaded, skipped)
    return 0


# ---------- TV connection ----------

def _connect_tv(cfg: Config):
    """Return a connected SamsungTVWS instance, or None if unreachable."""
    from samsungtvws import SamsungTVWS

    # Quick socket probe so we fail fast on a sleeping TV
    try:
        with socket.create_connection((cfg.tv_ip, 8002), timeout=3):
            pass
    except OSError as exc:
        log.error("TV at %s is not reachable on port 8002: %s", cfg.tv_ip, exc)
        log.error("(Is the TV powered on and on the network? Art Mode counts as 'on'.)")
        return None

    STATE_DIR.mkdir(exist_ok=True)
    return SamsungTVWS(
        host=cfg.tv_ip,
        name=cfg.tv_name,
        token_file=str(TOKEN_FILE),
    )


# ---------- rotate ----------

def cmd_rotate(cfg: Config, args: argparse.Namespace) -> int:
    if not cfg.tv_ip:
        log.error("TV_IP missing — set it in .env")
        return 1

    state = State.load()
    cfg.image_dir.mkdir(exist_ok=True)
    on_disk = sorted(
        p.name for p in cfg.image_dir.iterdir()
        if p.suffix.lower() in {".jpg", ".jpeg", ".png"}
    )
    if not on_disk:
        log.error("No images in %s — run `art.py fetch` first", cfg.image_dir)
        return 1

    uploaded = {e.file for e in state.entries if e.remote_filename}
    candidates = [f for f in on_disk if f not in uploaded] if not args.allow_repeat else on_disk
    if not candidates:
        log.warning("All %d images already shown. Pass --allow-repeat to recycle, or fetch more.", len(on_disk))
        return 0

    pick = args.file or random.choice(candidates)
    if pick not in on_disk:
        log.error("File not found in image dir: %s", pick)
        return 1
    path = cfg.image_dir / pick
    log.info("Selected: %s", pick)

    tv = _connect_tv(cfg)
    if tv is None:
        return 2

    try:
        if not tv.art().supported():
            log.error("This TV does not support Art Mode.")
            return 1

        entry = state.find(pick) or StateEntry(file=pick)

        if entry.remote_filename:
            log.info("Already uploaded as %s — selecting", entry.remote_filename)
            tv.art().select_image(entry.remote_filename, show=True)
        else:
            data = path.read_bytes()
            file_type = "PNG" if path.suffix.lower() == ".png" else "JPEG"
            log.info("Uploading %s (%s, %.1f MB)", pick, file_type, len(data) / 1e6)
            remote = tv.art().upload(data, file_type=file_type, matte="none")
            log.info("Uploaded as %s — selecting", remote)
            tv.art().select_image(remote, show=True)
            entry.remote_filename = remote

        entry.uploaded_at = datetime.now(timezone.utc).isoformat(timespec="seconds")
        state.add_or_update(entry)
        state.save()
        return 0
    except Exception as exc:
        log.error("TV operation failed: %s", exc)
        return 2


# ---------- status ----------

def cmd_status(cfg: Config, args: argparse.Namespace) -> int:
    state = State.load()
    on_disk = []
    if cfg.image_dir.exists():
        on_disk = [p.name for p in cfg.image_dir.iterdir()
                   if p.suffix.lower() in {".jpg", ".jpeg", ".png"}]
    uploaded = [e for e in state.entries if e.remote_filename]
    print(f"TV:               {cfg.tv_ip} ({cfg.tv_name})")
    print(f"Image dir:        {cfg.image_dir} ({len(on_disk)} files)")
    print(f"State file:       {STATE_FILE}")
    print(f"Uploaded to TV:   {len(uploaded)}")
    print(f"Token persisted:  {'yes' if TOKEN_FILE.exists() else 'no'}")
    unseen = [f for f in on_disk if f not in {e.file for e in uploaded}]
    print(f"Unseen on disk:   {len(unseen)}")
    if args.verbose:
        print()
        for e in sorted(uploaded, key=lambda x: x.uploaded_at or ""):
            print(f"  {e.uploaded_at or '?':<25} {e.remote_filename:<10} {e.file}")
    return 0


# ---------- entrypoint ----------

def main(argv: list[str] | None = None) -> int:
    logging.basicConfig(
        level=logging.INFO,
        format="%(levelname)s %(message)s",
    )
    # Quiet noisy libs
    logging.getLogger("samsungtvws").setLevel(logging.WARNING)
    logging.getLogger("websocket").setLevel(logging.WARNING)
    logging.getLogger("urllib3").setLevel(logging.WARNING)

    parser = argparse.ArgumentParser(prog="art.py", description=__doc__.splitlines()[0])
    sub = parser.add_subparsers(dest="cmd", required=True)

    p_fetch = sub.add_parser("fetch", help="Download artwork from Rijksmuseum")
    p_fetch.add_argument("-q", "--query", help="Override RIJKS_QUERY")
    p_fetch.add_argument("-t", "--type", help="Override RIJKS_TYPE (e.g. schilderij)")
    p_fetch.add_argument("-n", "--count", type=int, help="Override RIJKS_COUNT")
    p_fetch.add_argument("--force", action="store_true", help="Re-download even if file exists")

    p_rotate = sub.add_parser("rotate", help="Push next image to the TV")
    p_rotate.add_argument("--file", help="Specific filename in images/ to display")
    p_rotate.add_argument("--allow-repeat", action="store_true",
                          help="Recycle already-shown images instead of erroring")

    p_status = sub.add_parser("status", help="Show state summary")
    p_status.add_argument("-v", "--verbose", action="store_true")

    args = parser.parse_args(argv)
    cfg = Config.load()
    handlers = {"fetch": cmd_fetch, "rotate": cmd_rotate, "status": cmd_status}
    return handlers[args.cmd](cfg, args)


if __name__ == "__main__":
    sys.exit(main())
