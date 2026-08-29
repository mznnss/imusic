/* ============================================================
   IMusic — Frontend dengan YouTube Player Resmi & Anti-Skip
   ============================================================ */

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const icon = (id, cls = 'ic') => `<svg class="${cls}"><use href="#${id}"/></svg>`;

const api = async (path) => {
  const r = await fetch(path);
  if (!r.ok) throw new Error(`${path} -> ${r.status}`);
  return r.json();
};

const fmtTime = (s) => {
  s = Math.max(0, Math.floor(s || 0));
  const m = Math.floor(s / 60), sec = s % 60;
  return `${m}:${String(sec).padStart(2, '0')}`;
};

function toast(msg) {
  const t = $('#toast');
  if (!t) return;
  t.textContent = msg;
  t.classList.remove('hidden');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.classList.add('hidden'), 2200);
}

function applyTint(key) {
  let h = 0;
  const s = String(key || 'home');
  for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  document.documentElement.style.setProperty('--tint', Math.abs(h) % 360);
}

function openNowPlaying() {
  $('#nowplaying').classList.remove('hidden');
  document.body.classList.add('np-open');
}
function closeNowPlaying() {
  $('#nowplaying').classList.add('hidden');
  document.body.classList.remove('np-open');
}

const store = {
  get(k, d) { try { return JSON.parse(localStorage.getItem('smw_' + k)) ?? d; } catch { return d; } },
  set(k, v) { localStorage.setItem('smw_' + k, JSON.stringify(v)); },
};

const Library = {
  get favorites() { return store.get('fav', []); },
  isFav(id) { return this.favorites.some((s) => s.videoId === id); },
  toggleFav(song) {
    let f = this.favorites;
    if (this.isFav(song.videoId)) { f = f.filter((s) => s.videoId !== song.videoId); toast('Dihapus dari favorit'); }
    else { f.unshift(song); toast('Ditambahkan ke favorit'); }
    store.set('fav', f);
    updateLikeButtons();
  },
  get playlists() { return store.get('pls', []); },
  get history() { return store.get('hist', []); },
  pushHistory(song) {
    let h = this.history.filter((s) => s.videoId !== song.videoId);
    h.unshift({ ...song, playedAt: Date.now() });
    store.set('hist', h.slice(0, 100));
  },
};

const Player = {
  yt: null,
  ready: false,
  queue: [],
  index: -1,
  shuffle: false,
  repeat: 0,
  loadId: 0,
  get current() { return this.queue[this.index] || null; },
};

// Inisialisasi YouTube Player IFrame Resmi
window.onYouTubeIframeAPIReady = () => {
  Player.yt = new YT.Player('yt-player', {
    height: '1',
    width: '1',
    host: 'https://www.youtube.com',
    playerVars: {
      playsinline: 1,
      controls: 0,
      disablekb: 1,
      origin: window.location.origin,
      rel: 0,
      iv_load_policy: 3,
    },
    events: {
      onReady: () => {
        Player.ready = true;
        Player.yt.setVolume(Number(store.get('vol', 100)));
      },
      onStateChange: (e) => {
        if (e.data === YT.PlayerState.ENDED) nextTrack(true);
        document.body.classList.toggle('paused', e.data !== YT.PlayerState.PLAYING);
        renderPlayButtons();
        if ('mediaSession' in navigator) {
          navigator.mediaSession.playbackState = e.data === YT.PlayerState.PLAYING ? 'playing' : 'paused';
        }
      },
      onError: (err) => {
        console.warn('YouTube playback error:', err);
      },
    },
  });
};

(() => {
  const s = document.createElement('script');
  s.src = 'https://www.youtube.com/iframe_api';
  document.head.appendChild(s);
})();

function playSong(song, queue = null, index = null) {
  if (!song || !song.videoId) return;
  if (queue) {
    Player.queue = queue;
    Player.index = index ?? queue.findIndex((q) => q.videoId === song.videoId);
    if (Player.index < 0) Player.index = 0;
  } else {
    Player.queue = [song];
    Player.index = 0;
  }
  startCurrent();
  if (!queue || queue.length <= 1) fetchQueue(song);
}

function startCurrent() {
  const s = Player.current;
  if (!s) return;
  const loadId = ++Player.loadId;

  const tryPlay = () => {
    if (loadId !== Player.loadId) return;
    if (!Player.ready || !Player.yt) return setTimeout(tryPlay, 200);
    try {
      Player.yt.loadVideoById({ videoId: s.videoId });
      Player.yt.playVideo();
    } catch {}
  };
  tryPlay();

  Library.pushHistory(s);
  renderNowPlaying();
  renderQueue();
  updateLikeButtons();
  $('#miniplayer').classList.remove('hidden');
  document.body.classList.add('has-player');
  document.title = `${s.title} • IMusic`;
  applyTint(s.videoId || s.title);

  if ('mediaSession' in navigator) {
    navigator.mediaSession.metadata = new MediaMetadata({
      title: s.title,
      artist: s.artist || s.subtitle || 'IMusic',
      artwork: s.thumbnail ? [{ src: s.thumbnail, sizes: '512x512', type: 'image/jpeg' }] : [],
    });
    navigator.mediaSession.setActionHandler('previoustrack', prevTrack);
    navigator.mediaSession.setActionHandler('nexttrack', () => nextTrack(false));
    navigator.mediaSession.setActionHandler('play', () => Player.yt && Player.yt.playVideo());
    navigator.mediaSession.setActionHandler('pause', () => Player.yt && Player.yt.pauseVideo());
  }
}

async function fetchQueue(song) {
  try {
    const d = await api(`/api/next?videoId=${encodeURIComponent(song.videoId)}`);
    if (d.queue && d.queue.length > 1) {
      const current = Player.current;
      const radio = d.queue.filter((q) => q.videoId !== (current && current.videoId));
      Player.queue = [current, ...radio].filter(Boolean);
      Player.index = 0;
      renderQueue();
    }
  } catch {}
}

function nextTrack(auto) {
  if (!Player.queue.length) return;
  let ni = Player.index + 1;
  if (ni >= Player.queue.length) ni = 0;
  Player.index = ni;
  startCurrent();
}

function prevTrack() {
  if (Player.yt && Player.yt.getCurrentTime && Player.yt.getCurrentTime() > 4) {
    Player.yt.seekTo(0);
    return;
  }
  if (Player.index > 0) {
    Player.index--;
    startCurrent();
  } else if (Player.yt) Player.yt.seekTo(0);
}

function togglePlay() {
  if (!Player.current || !Player.yt || !Player.ready) return;
  const st = Player.yt.getPlayerState();
  if (st === YT.PlayerState.PLAYING) Player.yt.pauseVideo();
  else Player.yt.playVideo();
}

// Update UI Progress Loop
setInterval(() => {
  if (!Player.yt || !Player.ready || !Player.current || !Player.yt.getDuration) return;
  const cur = Player.yt.getCurrentTime() || 0;
  const dur = Player.yt.getDuration() || 0;
  const pct = dur ? (cur / dur) * 100 : 0;
  const fill = $('#mini-progress-fill');
  if (fill) fill.style.width = pct + '%';
  $('#mini-cur').textContent = fmtTime(cur);
  $('#mini-dur').textContent = fmtTime(dur);
  const range = $('#np-range');
  if (range && !seekDragging) {
    range.value = dur ? Math.round((cur / dur) * 1000) : 0;
    $('#np-cur').textContent = fmtTime(cur);
    $('#np-dur').textContent = fmtTime(dur);
  }
}, 400);

function renderPlayButtons() {
  const isPlaying = Player.yt && Player.ready && Player.yt.getPlayerState && Player.yt.getPlayerState() === YT.PlayerState.PLAYING;
  $('#mini-play').innerHTML = icon(isPlaying ? 'i-pause' : 'i-play');
  $('#np-play').innerHTML = icon(isPlaying ? 'i-pause' : 'i-play');
}

function renderNowPlaying() {
  const s = Player.current;
  if (!s) return;
  $('#mini-art').src = s.thumbnail || '';
  $('#mini-title').textContent = s.title || '';
  $('#mini-artist').textContent = s.artist || s.subtitle || '';
  $('#np-art').src = s.thumbnail || '';
  $('#np-title').textContent = s.title || '';
  $('#np-artist').textContent = s.artist || s.subtitle || '';
  $('#np-bg').style.backgroundImage = s.thumbnail ? `url("${s.thumbnail}")` : 'none';
}

function updateLikeButtons() {
  const s = Player.current;
  const isFav = s && Library.isFav(s.videoId);
  $('#mini-like').innerHTML = icon(isFav ? 'i-heart-f' : 'i-heart-o');
  $('#mini-like').classList.toggle('liked', !!isFav);
  $('#np-like').innerHTML = icon(isFav ? 'i-heart-f' : 'i-heart-o') + `<span>${isFav ? 'Favorited' : 'Favorite'}</span>`;
  $('#np-like').classList.toggle('liked', !!isFav);
}

function renderQueue() {
  const el = $('#queue-list');
  if (!el) return;
  if (!Player.queue.length) {
    el.innerHTML = '<div class="q-empty">Antrean kosong</div>';
    return;
  }
  el.innerHTML = Player.queue.map((q, i) => trackRowHTML({ ...q, qi: i }, i === Player.index)).join('');
  $$('.track', el).forEach((row) => {
    row.addEventListener('click', () => {
      Player.index = Number(row.dataset.qi);
      startCurrent();
    });
  });
}

function trackRowHTML(it, playing = false) {
  const qi = it.qi != null ? ` data-qi="${it.qi}"` : '';
  return `<div class="track${playing ? ' playing' : ''}"${qi} data-item='${esc(JSON.stringify(it))}'>
    <img src="${esc(it.thumbnail || '')}" alt="">
    <div class="tmeta"><div class="tt">${esc(it.title)}</div><div class="ts">${esc(it.artist || it.subtitle || '')}</div></div>
    ${it.duration ? `<span class="tdur">${esc(it.duration)}</span>` : ''}
  </div>`;
}

function cardHTML(it) {
  return `<div class="card" data-item='${esc(JSON.stringify(it))}'>
    <div class="art"><img src="${esc(it.thumbnail || '')}" alt=""><div class="play-ov">${icon('i-play')}</div></div>
    <div class="t">${esc(it.title)}</div><div class="s">${esc(it.subtitle || '')}</div>
  </div>`;
}

function carouselHTML(inner) {
  return `<div class="carousel-wrap"><div class="carousel">${inner}</div></div>`;
}

function shelfHTML(sec) {
  return `<div class="shelf"><div class="shelf-title">${esc(sec.title)}</div>
    ${carouselHTML((sec.items || []).map(cardHTML).join(''))}</div>`;
}

function bindItems(root) {
  $$('.card', root).forEach((el) => {
    el.addEventListener('click', () => {
      try {
        const it = JSON.parse(el.dataset.item);
        if (it.videoId) playSong(it);
        else if (it.browseId) location.hash = `#/browse/${it.browseId}`;
      } catch {}
    });
  });
  $$('.track', root).forEach((el) => {
    el.addEventListener('click', () => {
      try {
        const it = JSON.parse(el.dataset.item);
        if (it.videoId) playSong(it);
      } catch {}
    });
  });
}

async function viewHome(view) {
  view.innerHTML = '<div class="loading-note">Memuat lagu…</div>';
  const d = await api('/api/home');
  view.innerHTML = `<h1 class="page-title">Selamat Datang</h1>` + (d.sections || []).map(shelfHTML).join('');
  bindItems(view);
}

async function viewSearch(view, q = '') {
  view.innerHTML = `
    <div class="search-bar">${icon('i-search', 'ic search-ic')}<input id="search-input" placeholder="Cari lagu atau artis..." value="${esc(q)}"></div>
    <div id="search-results">${q ? '<div class="loading-note">Mencari…</div>' : ''}</div>`;
  const input = $('#search-input');
  let t;
  input.addEventListener('input', () => {
    clearTimeout(t);
    const v = input.value.trim();
    if (!v) return;
    t = setTimeout(async () => {
      const d = await api(`/api/search?q=${encodeURIComponent(v)}`);
      const allItems = (d.sections || []).flatMap((s) => s.items || []);
      $('#search-results').innerHTML = `<div class="track-list">${allItems.map((i) => trackRowHTML(i)).join('')}</div>`;
      bindItems($('#search-results'));
    }, 400);
  });
  if (q) {
    const d = await api(`/api/search?q=${encodeURIComponent(q)}`);
    const allItems = (d.sections || []).flatMap((s) => s.items || []);
    $('#search-results').innerHTML = `<div class="track-list">${allItems.map((i) => trackRowHTML(i)).join('')}</div>`;
    bindItems($('#search-results'));
  }
}

async function viewBrowse(view, id) {
  view.innerHTML = '<div class="loading-note">Memuat…</div>';
  const d = await api(`/api/browse?id=${encodeURIComponent(id)}`);
  view.innerHTML = `<h1 class="page-title">${esc(d.header?.title || 'Playlist')}</h1><div class="track-list">${(d.tracks || []).map(trackRowHTML).join('')}</div>`;
  bindItems(view);
}

async function route() {
  const hash = location.hash || '#/home';
  const parts = hash.slice(2).split('/');
  const view = $('#view');
  if (parts[0] === 'home' || parts[0] === '') await viewHome(view);
  else if (parts[0] === 'search') await viewSearch(view, decodeURIComponent(parts[1] || ''));
  else if (parts[0] === 'browse' || parts[0] === 'playlist') await viewBrowse(view, parts[1]);
}
window.addEventListener('hashchange', route);

// Event Listeners Miniplayer & Navigasi
$('#mini-play').addEventListener('click', togglePlay);
$('#mini-next').addEventListener('click', () => nextTrack(false));
$('#mini-prev').addEventListener('click', prevTrack);
$('#mini-art').addEventListener('click', openNowPlaying);
$('.mini-meta').addEventListener('click', openNowPlaying);
$('#mini-like').addEventListener('click', () => Player.current && Library.toggleFav(Player.current));
$('#np-close').addEventListener('click', closeNowPlaying);
$('#np-play').addEventListener('click', togglePlay);
$('#np-next').addEventListener('click', () => nextTrack(false));
$('#np-prev').addEventListener('click', prevTrack);
$('#np-like').addEventListener('click', () => Player.current && Library.toggleFav(Player.current));

let seekDragging = false;
const range = $('#np-range');
if (range) {
  range.addEventListener('input', () => { seekDragging = true; });
  range.addEventListener('change', () => {
    seekDragging = false;
    if (Player.yt && Player.ready) {
      const dur = Player.yt.getDuration() || 0;
      Player.yt.seekTo((range.value / 1000) * dur, true);
    }
  });
}

// Navigasi Samping
$$('#nav-desktop .nav-item').forEach((b) => b.addEventListener('click', () => { location.hash = b.dataset.id === 'search' ? '#/search' : '#/home'; }));
$('#tb-search')?.addEventListener('click', () => { location.hash = '#/search'; });

const splash = $('#splash');
if (splash) setTimeout(() => splash.remove(), 1200);

route();
