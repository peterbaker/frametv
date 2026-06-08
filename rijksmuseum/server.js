const path = require('path');
const fs = require('fs');
const express = require('express');

const {
  folderPath,
  SEARCH_PARAMS,
  searchPage,
  resolveArtwork,
  downloadImage,
  mapWithConcurrency,
} = require('./index');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Search + resolve: returns curated thumbnails ready for the gallery.
app.get('/api/search', async (req, res) => {
  try {
    const query = {};
    for (const key of SEARCH_PARAMS) {
      if (req.query[key]) query[key] = String(req.query[key]);
    }
    const limit = Math.min(parseInt(req.query.limit, 10) || 24, 50);
    const pageToken = req.query.pageToken || null;

    const page = await searchPage(query, pageToken);
    const ids = page.ids.slice(0, limit);
    const resolved = await mapWithConcurrency(ids, 6, resolveArtwork);
    const items = resolved.filter((a) => a.imageUrl);

    res.json({ items, nextToken: page.nextToken, totalItems: page.totalItems });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

// Download the selected artworks into images/ (sharp resize happens here).
app.post('/api/download', async (req, res) => {
  const items = Array.isArray(req.body?.items) ? req.body.items : [];
  if (!items.length) return res.status(400).json({ error: 'No items provided.' });

  const results = await mapWithConcurrency(items, 4, async (item) => {
    try {
      if (!item.imageUrl || !item.title) throw new Error('Missing title or imageUrl');
      await downloadImage(item.imageUrl, item.title);
      return { title: item.title, ok: true };
    } catch (err) {
      return { title: item.title, ok: false, error: err.message };
    }
  });

  res.json({ results });
});

// Filenames already present in images/, so the UI can flag them.
app.get('/api/existing', (req, res) => {
  try {
    const files = fs.existsSync(folderPath)
      ? fs.readdirSync(folderPath).filter((f) => /\.(jpe?g|png)$/i.test(f))
      : [];
    res.json({ files });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`Rijksmuseum art picker running at http://localhost:${PORT}`);
});
