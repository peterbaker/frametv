# Rijksmuseum Data Services
## Download Art

Uses the current keyless [Rijksmuseum Data Services](https://data.rijksmuseum.nl/docs).
There is no API key anymore — the old REST collection API has been retired.

The download is a chain of requests:

1. **Search API** — `GET https://data.rijksmuseum.nl/search/collection?type=painting&title=landschap&imageAvailable=true`
   returns a paginated list of Linked Open Data object identifiers.
2. Each object id (e.g. `https://id.rijksmuseum.nl/200106038`) is resolved as
   Linked Art JSON-LD (`Accept: application/ld+json`) for its title and the
   `shows` VisualItem.
3. The VisualItem's `digitally_shown_by` points to a DigitalObject whose
   `access_point` is the **IIIF Image API** URL
   (e.g. `https://iiif.micr.io/hodeb/full/max/0/default.jpg`).
4. The image is downloaded and resized to `3840 x 2160` with `sharp`.

## Web picker (recommended)

```bash
npm install
npm run serve        # http://localhost:3000  (set PORT to change)
```

Enter query parameters, browse the thumbnail grid, tick the works you want, and
click **Download selected** to save them into `../images/`. Works already in
`images/` are badged so you don't grab duplicates.

The page (`public/`) is plain HTML/JS; `server.js` is a small Express app that
serves it and exposes:
- `GET /api/search` — search + resolve to thumbnails (`{ items, nextToken }`)
- `POST /api/download` — `{ items: [{title, imageUrl}] }` → resize + save
- `GET /api/existing` — filenames already in `images/`

It reuses the resolve/download logic exported from `index.js`.

## CLI (bulk / scripted)

`node index.js` (or `npm start`) bulk-downloads every match for the default
query. Edit the defaults at the top of `index.js`:

```js
const CLI_QUERY = { type: 'painting', title: 'landschap' };
const CLI_AMOUNT = 50;
```

See the [Search API docs](https://data.rijksmuseum.nl/docs/search) for all
available parameters (`creator`, `material`, `technique`, `creationDate`,
`description`, `objectNumber`, etc.).
