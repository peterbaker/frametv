const form = document.getElementById('search-form');
const grid = document.getElementById('grid');
const statusEl = document.getElementById('status');
const downloadBtn = document.getElementById('download');
const selectAllBtn = document.getElementById('select-all');
const clearSelBtn = document.getElementById('clear-sel');
const loadMoreBtn = document.getElementById('load-more');

const selected = new Map(); // id -> { title, imageUrl }
let existing = new Set();   // sanitized "<title>" already downloaded
let currentQuery = '';
let nextToken = null;

const setStatus = (msg) => { statusEl.textContent = msg; };

// Mirror server-side sanitize-filename closely enough to flag duplicates.
const baseName = (title) => title.replace(/[\/\?<>\\:\*\|":]/g, '').trim();

const loadExisting = async () => {
  try {
    const res = await fetch('/api/existing');
    const { files } = await res.json();
    existing = new Set(files.map((f) => f.replace(/\.(jpe?g|png)$/i, '')));
  } catch { /* non-fatal */ }
};

const updateDownloadBtn = () => {
  downloadBtn.disabled = selected.size === 0;
  downloadBtn.textContent = selected.size
    ? `Download ${selected.size} selected → images/`
    : 'Download selected → images/';
};

const toggle = (card, item) => {
  if (selected.has(item.id)) {
    selected.delete(item.id);
    card.classList.remove('selected');
  } else {
    selected.set(item.id, { title: item.title, imageUrl: item.imageUrl });
    card.classList.add('selected');
  }
  updateDownloadBtn();
};

const renderCard = (item) => {
  const isExisting = existing.has(baseName(item.title));
  const card = document.createElement('div');
  card.className = 'card' + (isExisting ? ' existing' : '');
  card.innerHTML = `
    <div class="check">✓</div>
    ${isExisting ? '<div class="badge">in images/</div>' : ''}
    <img loading="lazy" src="${item.thumbUrl}" alt="${item.title}" />
    <div class="meta">
      <div class="title">${item.title}</div>
      ${item.creator ? `<div class="creator">${item.creator}</div>` : ''}
    </div>
  `;
  card.addEventListener('click', () => toggle(card, item));
  if (selected.has(item.id)) card.classList.add('selected');
  grid.appendChild(card);
};

const runSearch = async (append = false) => {
  const params = new URLSearchParams(new FormData(form));
  for (const [k, v] of [...params]) if (!v.trim()) params.delete(k);
  currentQuery = params.toString();

  const url = `/api/search?${currentQuery}` + (append && nextToken ? `&pageToken=${encodeURIComponent(nextToken)}` : '');
  setStatus('Searching…');
  loadMoreBtn.disabled = true;

  try {
    const res = await fetch(url);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Search failed');

    if (!append) { grid.innerHTML = ''; }
    data.items.forEach(renderCard);
    nextToken = data.nextToken;

    const shown = grid.children.length;
    const total = data.totalItems != null ? ` of ${data.totalItems}` : '';
    setStatus(shown ? `Showing ${shown}${total} with images.` : 'No results with images.');

    [selectAllBtn, clearSelBtn].forEach((b) => (b.hidden = shown === 0));
    loadMoreBtn.hidden = !nextToken;
    loadMoreBtn.disabled = !nextToken;
  } catch (err) {
    setStatus(`Error: ${err.message}`);
  }
};

form.addEventListener('submit', (e) => { e.preventDefault(); nextToken = null; runSearch(false); });
loadMoreBtn.addEventListener('click', () => runSearch(true));

selectAllBtn.addEventListener('click', () => {
  grid.querySelectorAll('.card').forEach((card) => {
    if (!card.classList.contains('selected')) card.click();
  });
});
clearSelBtn.addEventListener('click', () => {
  grid.querySelectorAll('.card.selected').forEach((card) => card.click());
});

downloadBtn.addEventListener('click', async () => {
  const items = [...selected.values()];
  downloadBtn.disabled = true;
  setStatus(`Downloading ${items.length}…`);
  try {
    const res = await fetch('/api/download', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Download failed');
    const ok = data.results.filter((r) => r.ok).length;
    const failed = data.results.filter((r) => !r.ok);
    setStatus(`Downloaded ${ok}/${data.results.length}.` + (failed.length ? ` Failed: ${failed.map((f) => f.title).join(', ')}` : ''));
    selected.clear();
    await loadExisting();
    runSearch(false); // refresh badges
  } catch (err) {
    setStatus(`Error: ${err.message}`);
  } finally {
    updateDownloadBtn();
  }
});

loadExisting();
updateDownloadBtn();
