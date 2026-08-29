/* ============================================================
   IMusic - Frontend Native HTML5 Audio Player
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

/* ================= PLAYER STATE ================= */
const Player = {
  audio: new Audio(),
  current: null,
  queue: [],
  queueIndex: -1,
  playing: false,
  loading: false,
  currentTime: 0,
  duration: 0,
  volume: 1,
  muted: false,
  shuffle: false,
  repeat: 'off', // 'off', 'all', 'one'
};

Player.audio.preload = 'auto';

/* ================= EVENT BINDINGS ================= */
Player.audio.addEventListener('play', () => {
  Player.playing = true;
  updatePlayButtons(true);
  updateMediaSessionPlaybackState('playing');
});

Player.audio.addEventListener('pause', () => {
  Player.playing = false;
  updatePlayButtons(false);
  updateMediaSessionPlaybackState('paused');
});

Player.audio.addEventListener('timeupdate', () => {
  Player.currentTime = Player.audio.currentTime || 0;
  Player.duration = Player.audio.duration || 0;
  updateProgressUI();
});

Player.audio.addEventListener('ended', () => {
  if (Player.repeat === 'one') {
    Player.audio.currentTime = 0;
    Player.audio.play().catch(() => {});
  } else {
    nextTrack();
  }
});

Player.audio.addEventListener('error', () => {
  toast('Gagal memuat lagu, mencoba lagu berikutnya…');
  setTimeout(() => nextTrack(), 1000);
});

/* ================= UI UPDATE HELPERS ================= */
function updatePlayButtons(isPlaying) {
  const playBtn = $('#mini-play');
  const npPlay = $('#np-play');
  const ic = icon(isPlaying ? 'i-pause' : 'i-play');
  if (playBtn) playBtn.innerHTML = ic;
  if (npPlay) npPlay.innerHTML = ic;
  document.body.classList.toggle('paused', !isPlaying);
}

function updateProgressUI() {
  const dur = Player.duration || 0;
  const cur = Player.currentTime || 0;
  const pct = dur ? (cur / dur) * 100 : 0;
  const fill = $('#mini-progress-fill');
  if (fill) fill.style.width = pct + '%';
  const curEl = $('#mini-cur'); if (curEl) curEl.textContent = fmtTime(cur);
  const durEl = $('#mini-dur'); if (durEl) durEl.textContent = fmtTime(dur);
}

function updatePlayerUI() {
  const s = Player.current;
  if (!s) return;
  const art = $('#mini-art'); if (art) art.src = s.thumbnail || '';
  const title = $('#mini-title'); if (title) title.textContent = s.title || '';
  const artist = $('#mini-artist'); if (artist) artist.textContent = s.artist || s.subtitle || '';
  const npArt = $('#np-art'); if (npArt) npArt.src = s.thumbnail || '';
  const npTitle = $('#np-title'); if (npTitle) npTitle.textContent = s.title || '';
  const npArtist = $('#np-artist'); if (npArtist) npArtist.textContent = s.artist || s.subtitle || '';
  $('#miniplayer')?.classList.remove('hidden');
  document.title = `${s.title} • iMusic`;
}

function updateMediaSession(track) {
  if (!('mediaSession' in navigator) || !track) return;
  navigator.mediaSession.metadata = new MediaMetadata({
    title: track.title,
    artist: track.artist || track.subtitle || 'iMusic',
    artwork: track.thumbnail ? [{ src: track.thumbnail, sizes: '512x512', type: 'image/jpeg' }] : [],
  });
  navigator.mediaSession.setActionHandler('play', () => Player.audio.play());
  navigator.mediaSession.setActionHandler('pause', () => Player.audio.pause());
  navigator.mediaSession.setActionHandler('previoustrack', previousTrack);
  navigator.mediaSession.setActionHandler('nexttrack', nextTrack);
  navigator.mediaSession.setActionHandler('seekto', (details) => {
    if (details.seekTime) Player.audio.currentTime = details.seekTime;
  });
}

function updateMediaSessionPlaybackState(state) {
  if ('mediaSession' in navigator) navigator.mediaSession.playbackState = state;
}

/* ================= PLAYBACK CONTROLS ================= */
async function playTrack(track, options = {}) {
  if (!track || !track.videoId) return;

  Player.current = track;
  Player.queueIndex = options.queueIndex !== undefined ? options.queueIndex : Player.queue.findIndex(q => q.videoId === track.videoId);
  if (Player.queueIndex < 0) {
    Player.queue = [track];
    Player.queueIndex = 0;
  }

  updatePlayerUI();
  updateMediaSession(track);

  Player.audio.src = `/api/stream?videoId=${encodeURIComponent(track.videoId)}`;
  try {
    await Player.audio.play();
  } catch (err) {
    console.warn('Playback gesture error:', err);
  }
}

function togglePlay() {
  if (!Player.current && Player.queue.length) {
    playTrack(Player.queue[0], { queueIndex: 0 });
    return;
  }
  if (Player.audio.paused) Player.audio.play().catch(() => {});
  else Player.audio.pause();
}

function nextTrack() {
  if (!Player.queue.length) return;
  let nextIndex = Player.queueIndex + 1;
  if (nextIndex >= Player.queue.length) {
    if (Player.repeat === 'all') nextIndex = 0;
    else return;
  }
  playTrack(Player.queue[nextIndex], { queueIndex: nextIndex });
}

function previousTrack() {
  if (Player.audio.currentTime > 3) {
    Player.audio.currentTime = 0;
    return;
  }
  if (!Player.queue.length) return;
  let prevIndex = Player.queueIndex - 1;
  if (prevIndex < 0) prevIndex = 0;
  playTrack(Player.queue[prevIndex], { queueIndex: prevIndex });
}

/* ================= ROUTING & VIEWS ================= */
function trackRowHTML(it, index) {
  return `<div class="track" data-item='${esc(JSON.stringify(it))}' data-index="${index}">
    <img src="${esc(it.thumbnail || '')}" alt="">
    <div class="tmeta">
      <div class="tt">${esc(it.title)}</div>
      <div class="ts">${esc(it.artist || it.subtitle || '')}</div>
    </div>
    ${it.duration ? `<span class="tdur">${esc(it.duration)}</span>` : ''}
  </div>`;
}

function bindTracks(root, tracks) {
  $$('.track', root).forEach(el => {
    el.addEventListener('click', () => {
      const idx = Number(el.dataset.index);
      Player.queue = tracks;
      playTrack(tracks[idx], { queueIndex: idx });
    });
  });
}

async function viewHome(view) {
  view.innerHTML = '<div class="loading-note">Memuat lagu…</div>';
  const d = await api('/api/home');
  let html = `<h1 class="page-title">Selamat Datang</h1>`;
  const allTracks = [];
  (d.sections || []).forEach(sec => {
    if (sec.items && sec.items.length) {
      html += `<div class="shelf"><div class="shelf-title">${esc(sec.title)}</div><div class="track-list">`;
      sec.items.forEach(it => {
        if (it.videoId) {
          const index = allTracks.length;
          allTracks.push(it);
          html += trackRowHTML(it, index);
        }
      });
      html += `</div></div>`;
    }
  });
  view.innerHTML = html;
  bindTracks(view, allTracks);
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
      const results = d.results || [];
      $('#search-results').innerHTML = `<div class="track-list">${results.map((it, i) => trackRowHTML(it, i)).join('')}</div>`;
      bindTracks($('#search-results'), results);
    }, 400);
  });
  if (q) {
    const d = await api(`/api/search?q=${encodeURIComponent(q)}`);
    const results = d.results || [];
    $('#search-results').innerHTML = `<div class="track-list">${results.map((it, i) => trackRowHTML(it, i)).join('')}</div>`;
    bindTracks($('#search-results'), results);
  }
}

async function route() {
  const hash = location.hash || '#/home';
  const parts = hash.slice(2).split('/');
  const view = $('#view');
  if (parts[0] === 'home' || parts[0] === '') await viewHome(view);
  else if (parts[0] === 'search') await viewSearch(view, decodeURIComponent(parts[1] || ''));
}

window.addEventListener('hashchange', route);

/* ================= EVENT LISTENERS ================= */
$('#mini-play')?.addEventListener('click', togglePlay);
$('#mini-next')?.addEventListener('click', nextTrack);
$('#mini-prev')?.addEventListener('click', previousTrack);
$('#mini-bar')?.addEventListener('click', (e) => {
  if (!Player.duration) return;
  const r = e.currentTarget.getBoundingClientRect();
  const frac = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
  Player.audio.currentTime = frac * Player.duration;
});

$$('#nav-desktop .nav-item').forEach(b => {
  b.addEventListener('click', () => { location.hash = b.dataset.id === 'search' ? '#/search' : '#/home'; });
});
$('#tb-search')?.addEventListener('click', () => { location.hash = '#/search'; });

const splash = $('#splash');
if (splash) setTimeout(() => splash.remove(), 600);

route();
