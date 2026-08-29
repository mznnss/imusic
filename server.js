/* ============================================================
   IMusic - Backend Proxy for YouTube Music InnerTube API
   ============================================================ */

const express = require('express');
const path = require('path');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const YTM = 'https://music.youtube.com/youtubei/v1';
const CONTEXT = {
  client: {
    clientName: 'WEB_REMIX',
    clientVersion: '1.20240101.00.00',
    hl: 'id',
    gl: 'ID',
  },
};
const HEADERS = {
  'Content-Type': 'application/json',
  Origin: 'https://music.youtube.com',
  Referer: 'https://music.youtube.com/',
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
};

async function yt(endpoint, body = {}, query = '') {
  const res = await fetch(`${YTM}/${endpoint}?prettyPrint=false${query}`, {
    method: 'POST',
    headers: HEADERS,
    body: JSON.stringify({ context: CONTEXT, ...body }),
  });
  if (!res.ok) throw new Error(`YTM ${endpoint} -> ${res.status}`);
  return res.json();
}

function findAll(obj, key, out = []) {
  if (!obj || typeof obj !== 'object') return out;
  if (Array.isArray(obj)) {
    for (const v of obj) findAll(v, key, out);
    return out;
  }
  for (const k of Object.keys(obj)) {
    if (k === key) out.push(obj[k]);
    findAll(obj[k], key, out);
  }
  return out;
}
const findFirst = (obj, key) => findAll(obj, key)[0];
const text = (o) => (o && o.runs ? o.runs.map((r) => r.text).join('') : (o && o.simpleText) || '');

function normalizeDuration(s) {
  const t = String(s || '').trim();
  if (/^\d{1,2}(\.\d{2}){1,2}$/.test(t)) return t.replace(/\./g, ':');
  return t;
}

function runsInfo(o) {
  const out = [];
  if (!o || !o.runs) return out;
  for (const r of o.runs) {
    const be = r.navigationEndpoint && r.navigationEndpoint.browseEndpoint;
    if (be) out.push({ name: r.text, browseId: be.browseId });
  }
  return out;
}

function thumbs(o) {
  const t = findAll(o, 'thumbnails').flat().filter((x) => x && x.url);
  if (!t.length) return null;
  const best = t.reduce((a, b) => ((b.width || 0) >= (a.width || 0) ? b : a));
  return best.url.replace(/=w\d+-h\d+.*$/, '=w544-h544-l90-rj');
}

function endpointInfo(nav) {
  if (!nav) return {};
  const we = nav.watchEndpoint;
  const be = nav.browseEndpoint;
  const wpe = nav.watchPlaylistEndpoint;
  if (we) return { videoId: we.videoId, playlistId: we.playlistId };
  if (wpe) return { playlistId: wpe.playlistId, watchPlaylist: true };
  if (be) {
    const id = be.browseId;
    let type = 'browse';
    if (id.startsWith('MPRE')) type = 'album';
    else if (id.startsWith('UC') || id.startsWith('MPLA')) type = 'artist';
    else if (id.startsWith('VL') || id.startsWith('PL') || id.startsWith('RDCLAK')) type = 'playlist';
    return { browseId: id, browseType: type };
  }
  return {};
}

function parseTwoRow(r) {
  const nav = r.navigationEndpoint || {};
  let info = endpointInfo(nav);
  if (!info.browseId && r.title && r.title.runs) {
    const tNav = r.title.runs[0] && r.title.runs[0].navigationEndpoint;
    const extra = endpointInfo(tNav || {});
    if (extra.browseId) info = { ...info, ...extra };
  }
  let type = 'song';
  if (info.browseType === 'album' || info.browseType === 'playlist' || info.browseType === 'artist') type = info.browseType;
  else if (info.videoId) type = 'song';
  else if (info.playlistId || info.watchPlaylist) type = 'playlist';
  const item = {
    type,
    title: text(r.title),
    subtitle: text(r.subtitle),
    thumbnail: thumbs(r.thumbnailRenderer),
    artists: runsInfo(r.subtitle),
    ...info,
  };
  if (r.thumbnailRenderer && findFirst(r, 'musicThumbnailRenderer')) {
    const style = findFirst(r, 'musicThumbnailRenderer').thumbnailCrop;
    if (style === 'MUSIC_THUMBNAIL_CROP_CIRCLE') item.type = 'artist';
  }
  return item;
}

function parseListItem(r) {
  const cols = (r.flexColumns || []).map((c) => (c.musicResponsiveListItemFlexColumnRenderer ? c.musicResponsiveListItemFlexColumnRenderer.text : null));
  const title = cols[0] ? text(cols[0]) : '';
  const subtitle = cols.slice(1).map((c) => text(c)).filter(Boolean).join(' • ');
  let videoId = null;
  if (r.playlistItemData) videoId = r.playlistItemData.videoId;
  if (!videoId && cols[0] && cols[0].runs) {
    const we = cols[0].runs[0] && cols[0].runs[0].navigationEndpoint && cols[0].runs[0].navigationEndpoint.watchEndpoint;
    if (we) videoId = we.videoId;
  }
  if (!videoId) {
    const we = findFirst(r.overlay || {}, 'watchEndpoint');
    if (we) videoId = we.videoId;
  }
  const navInfo = endpointInfo(r.navigationEndpoint);
  const artists = [];
  const albums = [];
  for (const c of cols.slice(1)) {
    for (const e of runsInfo(c)) {
      if (e.browseId.startsWith('MPRE')) albums.push(e);
      else artists.push(e);
    }
  }
  let type = videoId ? 'song' : navInfo.browseType || 'song';
  const item = {
    type,
    title,
    subtitle,
    videoId,
    thumbnail: thumbs(r.thumbnail),
    artists,
    album: albums[0] || null,
    ...navInfo,
  };
  const fixed = findFirst(r, 'musicResponsiveListItemFixedColumnRenderer');
  if (fixed) item.duration = normalizeDuration(text(fixed.text));
  return item;
}

function parseSections(contents) {
  const sections = [];
  for (const s of contents || []) {
    const car = s.musicCarouselShelfRenderer;
    const shelf = s.musicShelfRenderer;
    if (car) {
      const header = findFirst(car.header || {}, 'title');
      const items = (car.contents || [])
        .map((c) => (c.musicTwoRowItemRenderer ? parseTwoRow(c.musicTwoRowItemRenderer) : c.musicResponsiveListItemRenderer ? parseListItem(c.musicResponsiveListItemRenderer) : null))
        .filter((x) => x && x.title);
      if (items.length) sections.push({ title: text(header), items });
    } else if (shelf) {
      const items = (shelf.contents || [])
        .map((c) => (c.musicResponsiveListItemRenderer ? parseListItem(c.musicResponsiveListItemRenderer) : null))
        .filter((x) => x && x.title);
      if (items.length) sections.push({ title: text(shelf.title), items, list: true });
    }
  }
  return sections;
}

const cache = new Map();
function cached(key, ttlMs, fn) {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.t < ttlMs) return Promise.resolve(hit.v);
  return fn().then((v) => {
    cache.set(key, { v, t: Date.now() });
    return v;
  });
}

app.get('/api/home', async (req, res) => {
  try {
    const data = await cached('home_ID', 10 * 60 * 1000, async () => {
      let d = await yt('browse', { browseId: 'FEmusic_home' });
      let sections = [];
      let sl = findFirst(d, 'sectionListRenderer');
      if (sl) sections = parseSections(sl.contents);
      let cont = sl && sl.continuations && sl.continuations[0] && sl.continuations[0].nextContinuationData;
      let n = 0;
      while (cont && n < 3) {
        const d2 = await yt('browse', {}, `&ctoken=${cont.continuation}&continuation=${cont.continuation}&type=next`);
        const slc = findFirst(d2, 'sectionListContinuation');
        if (!slc) break;
        sections = sections.concat(parseSections(slc.contents));
        cont = slc.continuations && slc.continuations[0] && slc.continuations[0].nextContinuationData;
        n++;
      }
      return { sections };
    });
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/charts', async (req, res) => {
  try {
    const data = await cached('charts', 30 * 60 * 1000, async () => {
      const d = await yt('browse', { browseId: 'FEmusic_charts' });
      const sl = findFirst(d, 'sectionListRenderer');
      return { sections: sl ? parseSections(sl.contents) : [] };
    });
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/moods', async (req, res) => {
  try {
    const data = await cached('moods', 60 * 60 * 1000, async () => {
      const d = await yt('browse', { browseId: 'FEmusic_moods_and_genres' });
      const cats = findAll(d, 'musicNavigationButtonRenderer').map((b) => ({
        title: text(b.buttonText),
        color: b.solid ? '#' + (b.solid.leftStripeColor >>> 0).toString(16).padStart(8, '0').slice(2) : null,
        browseId: b.clickCommand && b.clickCommand.browseEndpoint && b.clickCommand.browseEndpoint.browseId,
        params: b.clickCommand && b.clickCommand.browseEndpoint && b.clickCommand.browseEndpoint.params,
      }));
      return { categories: cats.filter((c) => c.browseId) };
    });
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

const SEARCH_PARAMS = {
  songs: 'EgWKAQIIAWoMEA4QChADEAQQCRAF',
  videos: 'EgWKAQIQAWoMEA4QChADEAQQCRAF',
  albums: 'EgWKAQIYAWoMEA4QChADEAQQCRAF',
  artists: 'EgWKAQIgAWoMEA4QChADEAQQCRAF',
  playlists: 'EgeKAQQoAEABagwQDhAKEAMQBBAJEAU=',
};

app.get('/api/search', async (req, res) => {
  try {
    const q = String(req.query.q || '').trim();
    if (!q) return res.json({ sections: [] });
    const filter = req.query.filter;
    const body = { query: q };
    if (filter && SEARCH_PARAMS[filter]) body.params = SEARCH_PARAMS[filter];
    const d = await yt('search', body);
    const sections = [];
    const shelves = findAll(d, 'musicShelfRenderer');
    for (const shelf of shelves) {
      const items = (shelf.contents || []).map((c) => (c.musicResponsiveListItemRenderer ? parseListItem(c.musicResponsiveListItemRenderer) : null)).filter((x) => x && x.title);
      if (items.length) sections.push({ title: text(shelf.title), items });
    }
    if (!sections.length) {
      const flat = [];
      const seen = new Set();
      for (const sec of findAll(d, 'itemSectionRenderer')) {
        for (const c of sec.contents || []) {
          if (!c.musicResponsiveListItemRenderer) continue;
          const it = parseListItem(c.musicResponsiveListItemRenderer);
          const key = it.videoId || it.browseId || it.title;
          if (it.title && !seen.has(key)) { seen.add(key); flat.push(it); }
        }
      }
      if (flat.length) sections.push({ title: 'Results', items: flat });
    }
    const top = findFirst(d, 'musicCardShelfRenderer');
    if (top) {
      const info = endpointInfo(findFirst(top.title || {}, 'navigationEndpoint') || (top.title.runs && top.title.runs[0].navigationEndpoint));
      sections.unshift({
        title: 'Top result',
        items: [{ type: info.videoId ? 'song' : info.browseType || 'song', title: text(top.title), subtitle: text(top.subtitle), thumbnail: thumbs(top.thumbnail), ...info }],
      });
    }
    res.json({ sections });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/suggest', async (req, res) => {
  try {
    const d = await yt('music/get_search_suggestions', { input: req.query.q || '' });
    res.json({ suggestions: findAll(d, 'searchSuggestionRenderer').map((s) => text(s.suggestion)) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/next', async (req, res) => {
  try {
    const body = { isAudioOnly: true, tunerSettingValue: 'AUTOMIX_SETTING_NORMAL' };
    if (req.query.videoId) {
      body.videoId = req.query.videoId;
      body.playlistId = req.query.playlistId || `RDAMVM${req.query.videoId}`;
      body.watchEndpointMusicSupportedConfigs = { watchEndpointMusicConfig: { musicVideoType: 'MUSIC_VIDEO_TYPE_ATV' } };
    } else if (req.query.playlistId) {
      body.playlistId = req.query.playlistId;
    }
    if (req.query.params) body.params = req.query.params;
    const d = await yt('next', body);
    const panels = findAll(d, 'playlistPanelVideoRenderer');
    const queue = panels.map((p) => ({
      videoId: p.videoId,
      title: text(p.title),
      artist: text(p.shortBylineText || p.longBylineText),
      artists: runsInfo(p.longBylineText),
      duration: text(p.lengthText),
      thumbnail: thumbs(p.thumbnail),
      selected: !!p.selected,
    }));
    let lyricsBrowseId = null;
    let relatedBrowseId = null;
    for (const tab of findAll(d, 'tabRenderer')) {
      const id = tab.endpoint && tab.endpoint.browseEndpoint && tab.endpoint.browseEndpoint.browseId;
      if (!id) continue;
      if (id.startsWith('MPLYt')) lyricsBrowseId = id;
      if (id.startsWith('MPTRt')) relatedBrowseId = id;
    }
    res.json({ queue, lyricsBrowseId, relatedBrowseId });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

async function browsePage(rawId, params) {
  let id = rawId || '';
  if (/^(PL|RDCLAK|VLPL|OLAK)/.test(id) && !id.startsWith('VL')) id = 'VL' + id;
  const body = { browseId: id };
  if (params) body.params = params;
  const d = await yt('browse', body);

  let header = null;
  const hResp = findFirst(d, 'musicResponsiveHeaderRenderer') || findFirst(d, 'musicDetailHeaderRenderer') || findFirst(d, 'musicImmersiveHeaderRenderer') || findFirst(d, 'musicVisualHeaderRenderer');
  if (hResp) {
    header = {
      title: text(hResp.title),
      subtitle: [text(hResp.subtitle), text(hResp.secondSubtitle)].filter(Boolean).join(' • '),
      description: text(hResp.description) || text(findFirst(hResp, 'description') || {}),
      thumbnail: thumbs(hResp.thumbnail || hResp.foregroundThumbnail || {}),
      artists: runsInfo(hResp.subtitle).concat(runsInfo(hResp.straplineTextOne)),
      strapline: text(hResp.straplineTextOne),
    };
    if (!header.thumbnail) header.thumbnail = thumbs(hResp);
  }

  let playlistId = null;
  const wpe = findFirst(d, 'watchPlaylistEndpoint');
  if (wpe) playlistId = wpe.playlistId;

  let tracks = [];
  const shelves = findAll(d, 'musicShelfRenderer').concat(findAll(d, 'musicPlaylistShelfRenderer'));
  for (const shelf of shelves) {
    const items = (shelf.contents || []).map((c) => (c.musicResponsiveListItemRenderer ? parseListItem(c.musicResponsiveListItemRenderer) : null)).filter((x) => x && x.title);
    if (items.length && items.filter((i) => i.videoId).length >= items.length / 2 && !tracks.length) {
      tracks = items;
    }
  }

  let sections = [];
  const sl = findFirst(d, 'sectionListRenderer');
  if (sl) sections = parseSections(sl.contents).filter((s) => !s.list || !tracks.length);
  if (tracks.length) sections = sections.filter((s) => !(s.list && s.items[0] && s.items[0].videoId === tracks[0].videoId));

  if (header && !header.thumbnail && tracks[0]) header.thumbnail = tracks[0].thumbnail;
  return { header, tracks, sections, playlistId };
}

app.get('/api/browse', async (req, res) => {
  try {
    res.json(await browsePage(req.query.id, req.query.params));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.use((req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

const PORT = process.env.PORT || 3000;
if (require.main === module) {
  app.listen(PORT, '0.0.0.0', () => console.log(`IMusic running on http://localhost:${PORT}`));
}
module.exports = app;
