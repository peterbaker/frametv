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
