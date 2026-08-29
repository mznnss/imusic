/* ============================================================
   IMusic - Backend
   YouTube Music API + Native Audio Streaming (Android InnerTube Proxy)
   ============================================================ */

const express = require('express');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: '2mb' }));
app.use(express.static(path.join(__dirname, 'public')));

/* ============================================================
   YOUTUBE MUSIC CONFIG & HEADERS
   ============================================================ */
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
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0 Safari/537.36',
};

async function yt(endpoint, body = {}, query = '') {
  const response = await fetch(`${YTM}/${endpoint}?prettyPrint=false${query}`, {
    method: 'POST',
    headers: HEADERS,
    body: JSON.stringify({ context: CONTEXT, ...body }),
  });
  if (!response.ok) throw new Error(`YTM ${endpoint} -> ${response.status}`);
  return response.json();
}

/* ============================================================
   DEEP HELPERS
   ============================================================ */
function findAll(obj, key, out = []) {
  if (!obj || typeof obj !== 'object') return out;
  if (Array.isArray(obj)) {
    for (const value of obj) findAll(value, key, out);
    return out;
  }
  for (const currentKey of Object.keys(obj)) {
    if (currentKey === key) out.push(obj[currentKey]);
    findAll(obj[currentKey], key, out);
  }
  return out;
}

const findFirst = (obj, key) => findAll(obj, key)[0];

function text(o) {
  if (o && o.runs) return o.runs.map((r) => r.text).join('');
  return (o && o.simpleText) || '';
}

function normalizeDuration(value) {
  const valueString = String(value || '').trim();
  if (/^\d{1,2}(\.\d{2}){1,2}$/.test(valueString)) return valueString.replace(/\./g, ':');
  return valueString;
}

function runsInfo(o) {
  const output = [];
  if (!o || !o.runs) return output;
  for (const run of o.runs) {
    const browseEndpoint = run.navigationEndpoint && run.navigationEndpoint.browseEndpoint;
    if (browseEndpoint) {
      output.push({
        name: run.text,
        browseId: browseEndpoint.browseId,
      });
    }
  }
  return output;
}

function upscale(url) {
  if (!url) return url;
  if (url.includes('googleusercontent.com')) return url.replace(/=w\d+-h\d+.*$/, '=w544-h544-l90-rj');
  return url;
}

function thumbs(o) {
  const thumbnails = findAll(o, 'thumbnails').flat().filter((x) => x && x.url);
  if (!thumbnails.length) return null;
  const best = thumbnails.reduce((a, b) => ((b.width || 0) >= (a.width || 0) ? b : a));
  return upscale(best.url);
}

function endpointInfo(nav) {
  if (!nav) return {};
  const watchEndpoint = nav.watchEndpoint;
  const browseEndpoint = nav.browseEndpoint;
  const watchPlaylistEndpoint = nav.watchPlaylistEndpoint;

  if (watchEndpoint) {
    return {
      videoId: watchEndpoint.videoId,
      playlistId: watchEndpoint.playlistId,
    };
  }

  if (watchPlaylistEndpoint) {
    return {
      playlistId: watchPlaylistEndpoint.playlistId,
      watchPlaylist: true,
    };
  }

  if (browseEndpoint) {
    const id = browseEndpoint.browseId;
    let type = 'browse';
    if (id.startsWith('MPRE')) type = 'album';
    else if (id.startsWith('UC') || id.startsWith('MPLA')) type = 'artist';
    else if (id.startsWith('VL') || id.startsWith('PL') || id.startsWith('RDCLAK')) type = 'playlist';
    return { browseId: id, browseType: type };
  }
  return {};
}

function parseTwoRow(renderer) {
  const nav = renderer.navigationEndpoint || {};
  let info = endpointInfo(nav);
  if (!info.browseId && renderer.title && renderer.title.runs) {
    const titleNav = renderer.title.runs[0]?.navigationEndpoint;
    const extra = endpointInfo(titleNav || {});
    if (extra.browseId) info = { ...info, ...extra };
  }
  let type = 'song';
  if (info.browseType === 'album' || info.browseType === 'playlist' || info.browseType === 'artist') {
    type = info.browseType;
  } else if (info.videoId) {
    type = 'song';
  } else if (info.playlistId || info.watchPlaylist) {
    type = 'playlist';
  }

  const item = {
    type,
    title: text(renderer.title),
    subtitle: text(renderer.subtitle),
    thumbnail: thumbs(renderer.thumbnailRenderer),
    artists: runsInfo(renderer.subtitle),
    ...info,
  };

  if (renderer.thumbnailRenderer && findFirst(renderer, 'musicThumbnailRenderer')) {
    const style = findFirst(renderer, 'musicThumbnailRenderer').thumbnailCrop;
    if (style === 'MUSIC_THUMBNAIL_CROP_CIRCLE') item.type = 'artist';
  }
  return item;
}

function parseListItem(renderer) {
  const columns = (renderer.flexColumns || []).map((col) =>
    col.musicResponsiveListItemFlexColumnRenderer ? col.musicResponsiveListItemFlexColumnRenderer.text : null
  );
  const title = columns[0] ? text(columns[0]) : '';
  const subtitle = columns.slice(1).map((col) => text(col)).filter(Boolean).join(' • ');

  let videoId = null;
  if (renderer.playlistItemData) videoId = renderer.playlistItemData.videoId;
  if (!videoId && columns[0]?.runs) {
    const watchEndpoint = columns[0].runs[0]?.navigationEndpoint?.watchEndpoint;
    if (watchEndpoint) videoId = watchEndpoint.videoId;
  }
  if (!videoId) {
    const watchEndpoint = findFirst(renderer.overlay || {}, 'watchEndpoint');
    if (watchEndpoint) videoId = watchEndpoint.videoId;
  }

  const navInfo = endpointInfo(renderer.navigationEndpoint);
  const artists = [];
  const albums = [];

  for (const column of columns.slice(1)) {
    for (const entry of runsInfo(column)) {
      if (entry.browseId && entry.browseId.startsWith('MPRE')) albums.push(entry);
      else artists.push(entry);
    }
  }

  const item = {
    type: videoId ? 'song' : navInfo.browseType || 'song',
    title,
    subtitle,
    videoId,
    thumbnail: thumbs(renderer.thumbnail),
    artists,
    album: albums[0] || null,
    ...navInfo,
  };

  const fixed = findFirst(renderer, 'musicResponsiveListItemFixedColumnRenderer');
  if (fixed) item.duration = normalizeDuration(text(fixed.text));
  return item;
}

function parseSections(contents) {
  const sections = [];
  for (const section of contents || []) {
    const carousel = section.musicCarouselShelfRenderer;
    const shelf = section.musicShelfRenderer;
    if (carousel) {
      const header = findFirst(carousel.header || {}, 'title');
      const items = (carousel.contents || [])
        .map((c) => (c.musicTwoRowItemRenderer ? parseTwoRow(c.musicTwoRowItemRenderer) : c.musicResponsiveListItemRenderer ? parseListItem(c.musicResponsiveListItemRenderer) : null))
        .filter((i) => i && i.title);
      if (items.length) sections.push({ title: text(header), items });
    } else if (shelf) {
      const items = (shelf.contents || [])
        .map((c) => (c.musicResponsiveListItemRenderer ? parseListItem(c.musicResponsiveListItemRenderer) : null))
        .filter((i) => i && i.title);
      if (items.length) sections.push({ title: text(shelf.title), items, list: true });
    }
  }
  return sections;
}

/* ============================================================
   CACHE
   ============================================================ */
const cache = new Map();
function cached(key, ttlMs, fn) {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.t < ttlMs) return Promise.resolve(hit.v);
  return fn().then((value) => {
    cache.set(key, { v: value, t: Date.now() });
    return value;
  });
}

/* ============================================================
   NATIVE AUDIO STREAM (Android InnerTube Direct Resolver)
   ============================================================ */
app.get('/api/stream', async (req, res) => {
  const videoId = String(req.query.videoId || '').trim();
  if (!videoId || !/^[A-Za-z0-9_-]{11}$/.test(videoId)) {
    return res.status(400).send('Invalid videoId');
  }

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');

  try {
    const resp = await fetch('https://www.youtube.com/youtubei/v1/player?prettyPrint=false', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'com.google.android.youtube/19.09.37 (Linux; U; Android 11; Pixel 5)',
      },
      body: JSON.stringify({
        context: {
          client: {
            clientName: 'ANDROID',
            clientVersion: '19.09.37',
            androidSdkVersion: 30,
            hl: 'id',
            gl: 'ID',
          },
        },
        videoId: videoId,
      }),
    });

    if (resp.ok) {
      const data = await resp.json();
      const formats = (data.streamingData?.adaptiveFormats || []).concat(data.streamingData?.formats || []);
      const audioFormat = formats
        .filter((f) => f.mimeType && f.mimeType.startsWith('audio/') && f.url)
        .sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0))[0];

      if (audioFormat && audioFormat.url) {
        return res.redirect(302, audioFormat.url);
      }
    }

    // Fallback Invidious Stream (Proxy Langsung)
    const backupUrl = `https://invidious.privacydev.net/latest_version?id=${encodeURIComponent(videoId)}&itag=140&local=true`;
    return res.redirect(302, backupUrl);
  } catch (error) {
    console.error('Audio stream error:', error.message);
    res.status(502).send('Stream Unavailable');
  }
});

/* ============================================================
   SEARCH
   ============================================================ */
app.get('/api/search', async (req, res) => {
  const query = String(req.query.q || '').trim();
  if (!query) return res.json({ results: [] });

  try {
    const data = await cached(`search:${query}`, 60 * 1000, async () => {
      const result = await yt('search', { query });
      const sections = parseSections(result.contents || []);
      const results = [];
      for (const section of sections) {
        for (const item of section.items) results.push(item);
      }
      const unique = [];
      const seen = new Set();
      for (const item of results) {
        const key = item.videoId || `${item.type}:${item.title}`;
        if (!seen.has(key)) {
          seen.add(key);
          unique.push(item);
        }
      }
      return unique;
    });
    res.json({ results: data });
  } catch (error) {
    res.status(500).json({ error: error.message, results: [] });
  }
});

/* ============================================================
   HOME
   ============================================================ */
app.get('/api/home', async (req, res) => {
  try {
    const data = await cached('home', 5 * 60 * 1000, async () => {
      const result = await yt('browse', { browseId: 'FEmusic_home' });
      const contents = findFirst(result, 'contents');
      return { sections: parseSections(contents || []) };
    });
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/* ============================================================
   BROWSE & PLAYLIST
   ============================================================ */
app.get('/api/browse', async (req, res) => {
  const browseId = String(req.query.id || req.query.browseId || '').trim();
  if (!browseId) return res.status(400).json({ error: 'browseId is required' });

  try {
    const result = await yt('browse', { browseId });
    const contents = findFirst(result, 'contents');
    res.json({ browseId, sections: parseSections(contents || []) });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/* ============================================================
   NEXT / RADIO
   ============================================================ */
app.get('/api/next', async (req, res) => {
  const videoId = String(req.query.videoId || '').trim();
  if (!videoId) return res.status(400).json({ error: 'videoId is required' });

  try {
    const result = await yt('next', { videoId });
    const contents = findFirst(result, 'contents');
    const sections = parseSections(contents || []);
    const tracks = [];
    for (const section of sections) {
      for (const item of section.items) {
        if (item.videoId) tracks.push(item);
      }
    }
    res.json({ tracks });
  } catch (error) {
    res.status(500).json({ error: error.message, tracks: [] });
  }
});

/* ============================================================
   SPA FALLBACK
   ============================================================ */
app.get('*', (req, res) => {
  if (req.path.startsWith('/api/')) return res.status(404).json({ error: 'API endpoint not found' });
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`IMusic server running on http://localhost:${PORT}`);
});
