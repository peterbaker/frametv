const fs = require('fs');
const path = require('path');
const sanitize = require('sanitize-filename');
const sharp = require('sharp');

// Rijksmuseum Data Services (https://data.rijksmuseum.nl/docs).
// The current APIs are keyless: a Search API returns Linked Open Data
// identifiers, which are resolved as Linked Art JSON-LD to reach the
// IIIF image. The old REST collection API (with API_KEY) is retired.
const SEARCH_URL = 'https://data.rijksmuseum.nl/search/collection';
const folderPath = path.join(__dirname, '..', 'images');

const LD_HEADERS = { Accept: 'application/ld+json' };

// Search parameters accepted by the Search API that we expose.
// See https://data.rijksmuseum.nl/docs/search for the full list.
const SEARCH_PARAMS = [
  'type',
  'title',
  'creator',
  'material',
  'technique',
  'creationDate',
  'description',
  'objectNumber',
];

// CLI defaults (used when running `node index.js` directly).
const CLI_QUERY = { type: 'painting', title: 'landschap' }; // landschap = "landscape"
const CLI_AMOUNT = 50;

const getJson = async (url) => {
  const res = await fetch(url, { headers: LD_HEADERS, redirect: 'follow' });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.json();
};

// Run `fn` over `items` with at most `concurrency` in flight, preserving order.
const mapWithConcurrency = async (items, concurrency, fn) => {
  const results = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return results;
};

const buildSearchUrl = (query, pageToken) => {
  const params = new URLSearchParams();
  for (const key of SEARCH_PARAMS) {
    if (query[key]) params.set(key, query[key]);
  }
  params.set('imageAvailable', 'true');
  if (pageToken) params.set('pageToken', pageToken);
  return `${SEARCH_URL}?${params}`;
};

// Pull the opaque pageToken out of a search page's `next` link, if present.
const tokenFromNext = (page) => {
  const nextUrl = page.next?.id;
  if (!nextUrl) return null;
  return new URL(nextUrl).searchParams.get('pageToken');
};

// One page of search results: object identifiers plus a token for the next page.
const searchPage = async (query, pageToken) => {
  const page = await getJson(buildSearchUrl(query, pageToken));
  const ids = (page.orderedItems || []).map((item) => item.id);
  return { ids, nextToken: tokenFromNext(page), totalItems: page.partOf?.totalItems };
};

// Collect up to `amount` object identifiers, following pagination (CLI path).
const searchObjectIds = async (query, amount) => {
  const ids = [];
  let pageToken = null;
  do {
    const page = await searchPage(query, pageToken);
    ids.push(...page.ids);
    pageToken = page.nextToken;
  } while (pageToken && ids.length < amount);
  return ids.slice(0, amount);
};

// Prefer an English label, else the first available, from a notation array.
const pickNotation = (notation = []) =>
  (notation.find((n) => n['@language'] === 'en') || notation[0])?.['@value'] || null;

// Best-effort artist/maker name from a Linked Art production record.
const extractCreator = (object) => {
  const prod = object.produced_by || {};
  // Clean name on the production part(s), e.g. "Rembrandt van Rijn".
  for (const part of prod.part || []) {
    for (const maker of part.carried_out_by || []) {
      const name = pickNotation(maker.notation);
      if (name) return name;
    }
  }
  for (const maker of prod.carried_out_by || []) {
    const name = pickNotation(maker.notation);
    if (name) return name;
  }
  // Fallback: attribution text (prefer English), e.g. "Frans Jansz Post".
  const refs = prod.referred_to_by || [];
  const en = refs.find((r) => (r.language || []).some((l) => l.id?.includes('300388277')));
  return (en || refs[0])?.content || null;
};

// Walk object -> VisualItem -> DigitalObject to find the IIIF image URL.
// Returns { id, title, creator, imageUrl, thumbUrl }; imageUrl null when none.
const resolveArtwork = async (objectId) => {
  const object = await getJson(objectId);

  const nameEntry = (object.identified_by || []).find((n) => n.type === 'Name');
  const title = nameEntry?.content || objectId.split('/').pop();
  const creator = extractCreator(object);

  const visualItemId = object.shows?.[0]?.id;
  if (!visualItemId) return { id: objectId, title, creator, imageUrl: null, thumbUrl: null };

  const visualItem = await getJson(visualItemId);
  const digitalObjectId = visualItem.digitally_shown_by?.[0]?.id;
  if (!digitalObjectId) return { id: objectId, title, creator, imageUrl: null, thumbUrl: null };

  const digitalObject = await getJson(digitalObjectId);
  const imageUrl = digitalObject.access_point?.[0]?.id || null;
  // IIIF: swap the full-size region size for a 400px-wide thumbnail.
  const thumbUrl = imageUrl ? imageUrl.replace('/full/max/', '/full/400,/') : null;
  return { id: objectId, title, creator, imageUrl, thumbUrl };
};

const downloadImage = async (imageUrl, title) => {
  fs.mkdirSync(folderPath, { recursive: true });
  const sanitizedTitle = sanitize(title);
  const filePath = path.join(folderPath, `${sanitizedTitle}.jpg`);

  console.log(`Downloading ${sanitizedTitle}...`);

  const res = await fetch(imageUrl);
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${imageUrl}`);

  const input = Buffer.from(await res.arrayBuffer());
  await sharp(input).resize(3840, 2160).toFile(filePath); // W, H, cover-crop

  console.log(`Image ${sanitizedTitle} downloaded and resized successfully!`);
  return filePath;
};

// CLI: bulk-download every match for the default query.
const main = async () => {
  const ids = await searchObjectIds(CLI_QUERY, CLI_AMOUNT);
  console.log(`Found ${ids.length} matching objects.`);

  const artworks = await mapWithConcurrency(ids, 6, resolveArtwork);

  for (const art of artworks) {
    if (!art.imageUrl) {
      console.warn(`No image for "${art.title}" (${art.id}), skipping.`);
      continue;
    }
    try {
      await downloadImage(art.imageUrl, art.title);
    } catch (err) {
      console.error(`Failed on ${art.id}: ${err.message}`);
    }
  }
};

module.exports = {
  folderPath,
  SEARCH_PARAMS,
  searchPage,
  searchObjectIds,
  resolveArtwork,
  downloadImage,
  mapWithConcurrency,
};

if (require.main === module) {
  main();
}
