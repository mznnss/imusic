/* ============================================================
   IMusic - Frontend Player
   YouTube IFrame Player + Media Session
   ============================================================ */

'use strict';

/* ============================================================
   GLOBAL STATE
   ============================================================ */

const Player = {
  audio: null,

  ytPlayer: null,
  ytReady: false,
  ytLoading: false,

  current: null,
  queue: [],
  queueIndex: -1,

  playing: false,
  loading: false,

  volume: 1,
  muted: false,

  repeat: false,
  shuffle: false,

  duration: 0,
  currentTime: 0,

  progressTimer: null,
  retryTimer: null,

  retryCount: 0,
  maxRetries: 3,

  sponsorSegments: [],
  sponsorTimer: null,

  mediaSessionReady: false,

  initialized: false,
};


/* ============================================================
   DOM HELPERS
   ============================================================ */

const $ = (selector, root = document) =>
  root.querySelector(selector);

const $$ = (selector, root = document) =>
  Array.from(
    root.querySelectorAll(selector)
  );

function byId(id) {
  return document.getElementById(id);
}


/* ============================================================
   STORAGE
   ============================================================ */

const STORAGE_KEYS = {
  queue: 'imusic_queue',
  queueIndex: 'imusic_queue_index',
  current: 'imusic_current',
  volume: 'imusic_volume',
  repeat: 'imusic_repeat',
  shuffle: 'imusic_shuffle',
  currentTime: 'imusic_current_time',
};

function storageGet(key, fallback = null) {
  try {
    const raw =
      localStorage.getItem(key);

    if (raw === null) {
      return fallback;
    }

    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function storageSet(key, value) {
  try {
    localStorage.setItem(
      key,
      JSON.stringify(value)
    );
  } catch {}
}

function storageRemove(key) {
  try {
    localStorage.removeItem(key);
  } catch {}
}


/* ============================================================
   GENERAL HELPERS
   ============================================================ */

function escapeHtml(value) {
  return String(value ?? '')
    .replace(
      /&/g,
      '&amp;'
    )
    .replace(
      /</g,
      '&lt;'
    )
    .replace(
      />/g,
      '&gt;'
    )
    .replace(
      /"/g,
      '&quot;'
    )
    .replace(
      /'/g,
      '&#039;'
    );
}

function clamp(
  value,
  min,
  max
) {
  return Math.min(
    max,
    Math.max(
      min,
      value
    )
  );
}

function formatTime(seconds) {
  seconds =
    Number(seconds) || 0;

  if (
    !Number.isFinite(
      seconds
    )
  ) {
    seconds = 0;
  }

  seconds =
    Math.max(
      0,
      Math.floor(seconds)
    );

  const h =
    Math.floor(
      seconds / 3600
    );

  const m =
    Math.floor(
      (seconds % 3600) / 60
    );

  const s =
    seconds % 60;

  if (h > 0) {
    return `${h}:${String(
      m
    ).padStart(
      2,
      '0'
    )}:${String(
      s
    ).padStart(
      2,
      '0'
    )}`;
  }

  return `${m}:${String(
    s
  ).padStart(
    2,
    '0'
  )}`;
}

function getArtistName(track) {
  if (!track) {
    return '';
  }

  if (track.artist) {
    return track.artist;
  }

  if (
    Array.isArray(
      track.artists
    ) &&
    track.artists.length
  ) {
    return track.artists
      .map(
        (a) =>
          typeof a ===
          'string'
            ? a
            : a.name
      )
      .filter(Boolean)
      .join(', ');
  }

  if (track.subtitle) {
    return track.subtitle
      .split('•')[0]
      .trim();
  }

  return '';
}

function getThumbnail(track) {
  if (!track) {
    return '';
  }

  if (track.thumbnail) {
    return track.thumbnail;
  }

  if (track.videoId) {
    return `https://i.ytimg.com/vi/${encodeURIComponent(
      track.videoId
    )}/hqdefault.jpg`;
  }

  return '';
}

function normalizeTrack(track) {
  if (!track) {
    return null;
  }

  return {
    ...track,

    title:
      track.title ||
      'Unknown',

    artist:
      getArtistName(
        track
      ),

    thumbnail:
      getThumbnail(
        track
      ),

    videoId:
      track.videoId ||
      null,
  };
}

function sameTrack(
  a,
  b
) {
  if (!a || !b) {
    return false;
  }

  if (
    a.videoId &&
    b.videoId
  ) {
    return (
      a.videoId ===
      b.videoId
    );
  }

  return (
    a.title ===
      b.title &&
    getArtistName(a) ===
      getArtistName(b)
  );
}


/* ============================================================
   API
   ============================================================ */

async function api(
  url,
  options = {}
) {
  const response =
    await fetch(
      url,
      {
        ...options,

        headers: {
          Accept:
            'application/json',

          ...(options.headers ||
            {}),
        },
      }
    );

  let data = null;

  try {
    data =
      await response.json();
  } catch {
    data = null;
  }

  if (!response.ok) {
    throw new Error(
      data?.error ||
        `HTTP ${response.status}`
    );
  }

  return data;
}


/* ============================================================
   UI NOTIFICATION
   ============================================================ */

function toast(
  message,
  type = 'info'
) {
  let container =
    byId(
      'toast-container'
    );

  if (!container) {
    container =
      document.createElement(
        'div'
      );

    container.id =
      'toast-container';

    container.style.position =
      'fixed';

    container.style.left =
      '50%';

    container.style.bottom =
      '24px';

    container.style.transform =
      'translateX(-50%)';

    container.style.zIndex =
      '999999';

    container.style.display =
      'flex';

    container.style.flexDirection =
      'column';

    container.style.gap =
      '8px';

    container.style.pointerEvents =
      'none';

    document.body.appendChild(
      container
    );
  }

  const item =
    document.createElement(
      'div'
    );

  item.textContent =
    message;

  item.dataset.type =
    type;

  item.style.padding =
    '10px 16px';

  item.style.borderRadius =
    '10px';

  item.style.background =
    'rgba(20,20,25,.95)';

  item.style.color =
    '#fff';

  item.style.fontSize =
    '14px';

  item.style.boxShadow =
    '0 8px 30px rgba(0,0,0,.25)';

  item.style.maxWidth =
    'min(90vw,420px)';

  container.appendChild(
    item
  );

  setTimeout(() => {
    item.remove();
  }, 3000);
}


/* ============================================================
   PLAYER ELEMENT
   ============================================================ */

function createPlayerContainer() {
  let container =
    byId(
      'youtube-player-container'
    );

  if (container) {
    return container;
  }

  container =
    document.createElement(
      'div'
    );

  container.id =
    'youtube-player-container';

  /*
   * Keep the YouTube iframe present in the DOM.
   * Do NOT recreate it every time the track changes.
   *
   * This is important for:
   * - background playback
   * - Media Session
   * - lock screen controls
   * - avoiding repeated player initialization
   */

  container.style.position =
    'fixed';

  container.style.width =
    '1px';

  container.style.height =
    '1px';

  container.style.left =
    '-9999px';

  container.style.top =
    '-9999px';

  container.style.opacity =
    '0.01';

  container.style.pointerEvents =
    'none';

  document.body.appendChild(
    container
  );

  return container;
}


/* ============================================================
   LOAD YOUTUBE IFRAME API
   ============================================================ */

let youtubeApiPromise = null;

function loadYouTubeAPI() {
  if (
    window.YT &&
    window.YT.Player
  ) {
    return Promise.resolve(
      window.YT
    );
  }

  if (
    youtubeApiPromise
  ) {
    return youtubeApiPromise;
  }

  youtubeApiPromise =
    new Promise(
      (resolve, reject) => {
        const timeout =
          setTimeout(
            () => {
              reject(
                new Error(
                  'YouTube Player API timeout'
                )
              );
            },
            15000
          );

        const previous =
          window.onYouTubeIframeAPIReady;

        window.onYouTubeIframeAPIReady =
          () => {
            clearTimeout(
              timeout
            );

            if (
              typeof previous ===
              'function'
            ) {
              try {
                previous();
              } catch {}
            }

            if (
              window.YT &&
              window.YT.Player
            ) {
              resolve(
                window.YT
              );
            } else {
              reject(
                new Error(
                  'YouTube API unavailable'
                )
              );
            }
          };

        const existing =
          document.querySelector(
            'script[src*="youtube.com/iframe_api"]'
          );

        if (
          existing
        ) {
          return;
        }

        const script =
          document.createElement(
            'script'
          );

        script.src =
          'https://www.youtube.com/iframe_api';

        script.async =
          true;

        script.onerror =
          () => {
            clearTimeout(
              timeout
            );

            reject(
              new Error(
                'Failed to load YouTube Player API'
              )
            );
          };

        document.head.appendChild(
          script
        );
      }
    );

  return youtubeApiPromise;
}


/* ============================================================
   INITIALIZE YOUTUBE PLAYER
   ============================================================ */

async function initYouTubePlayer() {
  if (
    Player.ytPlayer
  ) {
    return Player.ytPlayer;
  }

  if (
    Player.ytLoading
  ) {
    return new Promise(
      (resolve) => {
        const wait =
          setInterval(
            () => {
              if (
                Player.ytPlayer
              ) {
                clearInterval(
                  wait
                );

                resolve(
                  Player.ytPlayer
                );
              }
            },
            50
          );
      }
    );
  }

  Player.ytLoading =
    true;

  try {
    await loadYouTubeAPI();

    const container =
      createPlayerContainer();

    const playerHost =
      document.createElement(
        'div'
      );

    playerHost.id =
      'youtube-player';

    container.appendChild(
      playerHost
    );

    Player.ytPlayer =
      await new Promise(
        (
          resolve,
          reject
        ) => {
          let settled =
            false;

          const timeout =
            setTimeout(
              () => {
                if (
                  !settled
                ) {
                  settled =
                    true;

                  reject(
                    new Error(
                      'YouTube player initialization timeout'
                    )
                  );
                }
              },
              15000
            );

          const player =
            new YT.Player(
              playerHost,
              {
                width:
                  '1',

                height:
                  '1',

                videoId:
                  '',

                playerVars: {
                  autoplay:
                    0,

                  controls:
                    0,

                  disablekb:
                    1,

                  fs:
                    0,

                  playsinline:
                    1,

                  rel:
                    0,

                  modestbranding:
                    1,

                  iv_load_policy:
                    3,
                },

                events: {
                  onReady:
                    (event) => {
                      if (
                        settled
                      ) {
                        return;
                      }

                      settled =
                        true;

                      clearTimeout(
                        timeout
                      );

                      Player.ytReady =
                        true;

                      try {
                        event.target.setVolume(
                          Math.round(
                            Player.volume *
                              100
                          )
                        );
                      } catch {}

                      resolve(
                        event.target
                      );
                    },

                  onStateChange:
                    handleYTStateChange,

                  onError:
                    handleYTError,

                  onPlaybackQualityChange:
                    () => {},

                  onPlaybackRateChange:
                    () => {},
                },
              }
            );
          }
        }
      );

    return Player.ytPlayer;
  } finally {
    Player.ytLoading =
      false;
  }
}


/* ============================================================
   YOUTUBE STATE HANDLER
   ============================================================ */

function handleYTStateChange(
  event
) {
  const state =
    event.data;

  /*
   * YT.PlayerState:
   *
   * -1 unstarted
   *  0 ended
   *  1 playing
   *  2 paused
   *  3 buffering
   *  5 cued
   */

  if (
    state ===
    YT.PlayerState.PLAYING
  ) {
    Player.playing =
      true;

    Player.loading =
      false;

    Player.retryCount =
      0;

    startProgressTimer();

    updatePlayButtons(
      true
    );

    updatePlayerUI();

    updateMediaSessionPlaybackState(
      'playing'
    );

    return;
  }

  if (
    state ===
    YT.PlayerState.PAUSED
  ) {
    Player.playing =
      false;

    Player.loading =
      false;

    stopProgressTimer();

    updatePlayButtons(
      false
    );

    updateMediaSessionPlaybackState(
      'paused'
    );

    persistPlayerState();

    return;
  }

  if (
    state ===
    YT.PlayerState.BUFFERING
  ) {
    Player.loading =
      true;

    updateLoadingUI(
      true
    );

    return;
  }

  if (
    state ===
    YT.PlayerState.ENDED
  ) {
    Player.playing =
      false;

    Player.loading =
      false;

    stopProgressTimer();

    updatePlayButtons(
      false
    );

    handleTrackEnded();

    return;
  }

  if (
    state ===
    YT.PlayerState.CUED
  ) {
    Player.loading =
      false;

    updateLoadingUI(
      false
    );

    updatePlayerUI();

    return;
  }
}


/* ============================================================
   YOUTUBE ERROR HANDLER
   ============================================================ */

function handleYTError(
  event
) {
  const code =
    event &&
    event.data;

  Player.loading =
    false;

  updateLoadingUI(
    false
  );

  /*
   * YouTube errors:
   *
   * 2   invalid parameter
   * 5   HTML5 player error
   * 100 video not found/private
   * 101 embedding not allowed
   * 150 embedding not allowed
   */

  let message =
    'Track loading failed';

  if (
    code === 100
  ) {
    message =
      'Video tidak ditemukan atau sudah dihapus.';
  } else if (
    code === 101 ||
    code === 150
  ) {
    message =
      'Video ini tidak mengizinkan pemutaran melalui embedded player.';
  } else if (
    code === 2
  ) {
    message =
      'Video ID YouTube tidak valid.';
  } else if (
    code === 5
  ) {
    message =
      'YouTube HTML5 player mengalami error.';
  }

  console.warn(
    '[YouTube Player Error]',
    code,
    message,
    Player.current
  );

  /*
   * Jangan langsung skip ke lagu berikutnya.
   *
   * Versi lama melakukan:
   *
   * error -> next()
   *
   * sehingga ketika API/stream bermasalah,
   * semua lagu terlihat gagal satu per satu.
   */

  if (
    Player.retryCount <
    Player.maxRetries
  ) {
    Player.retryCount++;

    toast(
      `${message} Mencoba lagi (${Player.retryCount}/${Player.maxRetries})...`,
      'warning'
    );

    clearTimeout(
      Player.retryTimer
    );

    Player.retryTimer =
      setTimeout(
        () => {
          retryCurrentTrack();
        },
        1200 *
          Player.retryCount
      );

    return;
  }

  Player.retryCount =
    0;

  toast(
    `${message} Silakan coba lagu lain.`,
    'error'
  );

  updateLoadingUI(
    false
  );

  updatePlayButtons(
    false
  );

  /*
   * Hanya tandai track gagal.
   * Tidak otomatis melompat agar user bisa
   * mencoba ulang secara manual.
   */
  if (
    Player.current
  ) {
    Player.current._failed =
      true;
  }
}


/* ============================================================
   RETRY CURRENT TRACK
   ============================================================ */

async function retryCurrentTrack() {
  if (
    !Player.current ||
    !Player.current.videoId
  ) {
    return;
  }

  const track =
    Player.current;

  try {
    Player.loading =
      true;

    updateLoadingUI(
      true
    );

    const player =
      await initYouTubePlayer();

    if (
      !player
    ) {
      throw new Error(
        'Player unavailable'
      );
    }

    /*
     * Re-cue first.
     * This forces YouTube to recreate the media state.
     */

    player.cueVideoById(
      track.videoId
    );

    await wait(
      500
    );

    player.playVideo();

    Player.current._failed =
      false;
  } catch (error) {
    console.error(
      '[Player Retry]',
      error
    );

    Player.loading =
      false;

    updateLoadingUI(
      false
    );

    toast(
      'Gagal memuat ulang lagu.',
      'error'
    );
  }
}


/* ============================================================
   WAIT
   ============================================================ */

function wait(ms) {
  return new Promise(
    (resolve) =>
      setTimeout(
        resolve,
        ms
      )
  );
}


/* ============================================================
   PLAY TRACK
   ============================================================ */

async function playTrack(
  track,
  options = {}
) {
  track =
    normalizeTrack(
      track
    );

  if (
    !track ||
    !track.videoId
  ) {
    toast(
      'Lagu ini tidak mempunyai YouTube video ID.',
      'error'
    );

    return false;
  }

  clearTimeout(
    Player.retryTimer
  );

  Player.retryCount =
    0;

  Player.loading =
    true;

  Player.current =
    track;

  if (
    typeof options.queueIndex ===
    'number'
  ) {
    Player.queueIndex =
      options.queueIndex;
  } else {
    const index =
      Player.queue.findIndex(
        (item) =>
          sameTrack(
            item,
            track
          )
      );

    if (
      index >= 0
    ) {
      Player.queueIndex =
        index;
    }
  }

  persistPlayerState();

  updatePlayerUI();

  updateLoadingUI(
    true
  );

  updateMediaSessionMetadata(
    track
  );

  try {
    const player =
      await initYouTubePlayer();

    if (
      !player
    ) {
      throw new Error(
        'YouTube player is unavailable'
      );
    }

    /*
     * If another video was playing,
     * stop it before loading the new one.
     */

    try {
      player.stopVideo();
    } catch {}

    /*
     * loadVideoById is used only for playback
     * through YouTube's own embedded player.
     */

    player.loadVideoById(
      track.videoId
    );

    /*
     * Give the player a short moment to
     * create the video state before calling play.
     */

    await wait(
      250
    );

    try {
      player.setVolume(
        Math.round(
          Player.volume *
            100
        )
      );
    } catch {}

    /*
     * playVideo() may be rejected/blocked
     * by browser autoplay policy.
     */

    player.playVideo();

    Player.current._failed =
      false;

    Player.loading =
      false;

    updateLoadingUI(
      false
    );

    startProgressTimer();

    updatePlayButtons(
      true
    );

    updateMediaSessionMetadata(
      track
    );

    persistPlayerState();

    loadSponsorSegments(
      track.videoId
    );

    return true;
  } catch (error) {
    console.error(
      '[playTrack]',
      error
    );

    Player.loading =
      false;

    updateLoadingUI(
      false
    );

    updatePlayButtons(
      false
    );

    toast(
      `Tidak dapat memutar "${track.title}".`,
      'error'
    );

    return false;
  }
}


/* ============================================================
   PLAY CURRENT
   ============================================================ */

async function playCurrent() {
  if (
    !Player.current
  ) {
    if (
      Player.queue.length
    ) {
      const index =
        clamp(
          Player.queueIndex >=
            0
            ? Player.queueIndex
            : 0,
          0,
          Player.queue.length -
            1
        );

      return playTrack(
        Player.queue[index],
        {
          queueIndex:
            index,
        }
      );
    }

    return false;
  }

  try {
    const player =
      await initYouTubePlayer();

    if (
      !player
    ) {
      return false;
    }

    /*
     * If the current video is already loaded,
     * resume it instead of loading again.
     */

    const currentId =
      typeof player.getVideoData ===
      'function'
        ? player.getVideoData()
            ?.video_id
        : null;

    if (
      currentId ===
      Player.current.videoId
    ) {
      player.playVideo();

      Player.playing =
        true;

      updatePlayButtons(
        true
      );

      updateMediaSessionPlaybackState(
        'playing'
      );

      startProgressTimer();

      return true;
    }

    return playTrack(
      Player.current
    );
  } catch (error) {
    console.error(
      '[playCurrent]',
      error
    );

    return false;
  }
}


/* ============================================================
   PAUSE
   ============================================================ */

function pauseTrack() {
  if (
    !Player.ytPlayer
  ) {
    return;
  }

  try {
    Player.ytPlayer.pauseVideo();
  } catch (
    error
  ) {
    console.warn(
      '[pauseTrack]',
      error
    );
  }

  Player.playing =
    false;

  stopProgressTimer();

  updatePlayButtons(
    false
  );

  updateMediaSessionPlaybackState(
    'paused'
  );

  persistPlayerState();
}


/* ============================================================
   TOGGLE PLAY
   ============================================================ */

async function togglePlay() {
  if (
    Player.loading
  ) {
    return;
  }

  if (
    Player.playing
  ) {
    pauseTrack();

    return;
  }

  await playCurrent();
}


/* ============================================================
   NEXT TRACK
   ============================================================ */

async function nextTrack(
  options = {}
) {
  if (
    !Player.queue.length
  ) {
    return false;
  }

  let nextIndex;

  if (
    Player.shuffle &&
    !options.forceIndex
  ) {
    const candidates =
      Player.queue
        .map(
          (_, i) =>
            i
        )
        .filter(
          (i) =>
            i !==
            Player.queueIndex
        );

    if (
      candidates.length
    ) {
      nextIndex =
        candidates[
          Math.floor(
            Math.random() *
              candidates.length
          )
        ];
    } else {
      nextIndex =
        Player.queueIndex;
    }
  } else {
    nextIndex =
      Player.queueIndex +
      1;

    if (
      nextIndex >=
      Player.queue.length
    ) {
      if (
        Player.repeat
      ) {
        nextIndex =
          0;
      } else {
        /*
         * Queue ended.
         */
        Player.playing =
          false;

        updatePlayButtons(
          false
        );

        stopProgressTimer();

        return false;
      }
    }
  }

  Player.queueIndex =
    nextIndex;

  const track =
    Player.queue[
      nextIndex
    ];

  return playTrack(
    track,
    {
      queueIndex:
        nextIndex,
    }
  );
}


/* ============================================================
   PREVIOUS TRACK
   ============================================================ */

async function previousTrack() {
  /*
   * If the current position is > 3 seconds,
   * previous means restart current track.
   */

  if (
    Player.currentTime >
    3
  ) {
    seekTo(
      0
    );

    return true;
  }

  if (
    !Player.queue.length
  ) {
    return false;
  }

  let previousIndex =
    Player.queueIndex -
    1;

  if (
    previousIndex <
    0
  ) {
    if (
      Player.repeat
    ) {
      previousIndex =
        Player.queue.length -
        1;
    } else {
      previousIndex =
        0;
    }
  }

  Player.queueIndex =
    previousIndex;

  return playTrack(
    Player.queue[
      previousIndex
    ],
    {
      queueIndex:
        previousIndex,
    }
  );
}


/* ============================================================
   SEEK
   ============================================================ */

function seekTo(
  seconds
) {
  if (
    !Player.ytPlayer
  ) {
    return;
  }

  seconds =
    Number(seconds);

  if (
    !Number.isFinite(
      seconds
    )
  ) {
    return;
  }

  seconds =
    clamp(
      seconds,
      0,
      Player.duration ||
        Number.MAX_SAFE_INTEGER
    );

  try {
    Player.ytPlayer.seekTo(
      seconds,
      true
    );
  } catch (
    error
  ) {
    console.warn(
      '[seekTo]',
      error
    );
  }

  Player.currentTime =
    seconds;

  updateProgressUI();

  persistPlayerState();
}


/* ============================================================
   SET VOLUME
   ============================================================ */

function setVolume(
  value
) {
  value =
    Number(value);

  if (
    !Number.isFinite(
      value
    )
  ) {
    return;
  }

  value =
    clamp(
      value,
      0,
      1
    );

  Player.volume =
    value;

  Player.muted =
    value <= 0;

  if (
    Player.ytPlayer
  ) {
    try {
      Player.ytPlayer.setVolume(
        Math.round(
          value * 100
        )
      );

      if (
        value > 0
      ) {
        Player.ytPlayer.unMute();
      }
    } catch {}
  }

  storageSet(
    STORAGE_KEYS.volume,
    value
  );

  updateVolumeUI();
}


/* ============================================================
   TOGGLE MUTE
   ============================================================ */

function toggleMute() {
  if (
    !Player.ytPlayer
  ) {
    return;
  }

  try {
    if (
      Player.muted
    ) {
      Player.ytPlayer.unMute();

      Player.ytPlayer.setVolume(
        Math.round(
          Player.volume *
            100
        )
      );

      Player.muted =
        false;
    } else {
      Player.ytPlayer.mute();

      Player.muted =
        true;
    }
  } catch {}

  updateVolumeUI();
}


/* ============================================================
   PROGRESS TIMER
   ============================================================ */

function startProgressTimer() {
  stopProgressTimer();

  Player.progressTimer =
    setInterval(
      updateProgressFromPlayer,
      250
    );

  updateProgressFromPlayer();
}

function stopProgressTimer() {
  if (
    Player.progressTimer
  ) {
    clearInterval(
      Player.progressTimer
    );

    Player.progressTimer =
      null;
  }
}

function updateProgressFromPlayer() {
  if (
    !Player.ytPlayer
  ) {
    return;
  }

  try {
    const current =
      Number(
        Player.ytPlayer.getCurrentTime()
      ) || 0;

    const duration =
      Number(
        Player.ytPlayer.getDuration()
      ) || 0;

    Player.currentTime =
      current;

    if (
      duration > 0
    ) {
      Player.duration =
        duration;
    }

    updateProgressUI();

    handleSponsorBlock(
      current
    );

    updateLyricsPosition(
      current
    );

    /*
     * Save occasionally, not every millisecond.
     */
    if (
      Math.floor(current) %
        5 ===
      0
    ) {
      persistPlayerState();
    }
  } catch {}
}
/* ============================================================
   MEDIA SESSION API
   ============================================================ */

/*
 * Media Session membuat browser/Android mengenali website
 * sebagai media player.
 *
 * Ini yang menangani:
 * - tombol play/pause di lock screen
 * - next
 * - previous
 * - seek
 * - metadata lagu
 *
 * Catatan:
 * YouTube tetap menjadi sumber playback.
 * Media Session hanya mengontrol player tersebut.
 */

function initMediaSession() {
  if (
    !('mediaSession' in navigator)
  ) {
    console.warn(
      '[MediaSession] Not supported'
    );

    return;
  }

  if (
    Player.mediaSessionReady
  ) {
    return;
  }

  try {
    navigator.mediaSession.setActionHandler(
      'play',
      async () => {
        await playCurrent();
      }
    );
  } catch {}

  try {
    navigator.mediaSession.setActionHandler(
      'pause',
      () => {
        pauseTrack();
      }
    );
  } catch {}

  try {
    navigator.mediaSession.setActionHandler(
      'previoustrack',
      async () => {
        await previousTrack();
      }
    );
  } catch {}

  try {
    navigator.mediaSession.setActionHandler(
      'nexttrack',
      async () => {
        await nextTrack();
      }
    );
  } catch {}

  try {
    navigator.mediaSession.setActionHandler(
      'seekbackward',
      (details) => {
        const offset =
          details.seekOffset ||
          10;

        seekTo(
          Player.currentTime -
            offset
        );
      }
    );
  } catch {}

  try {
    navigator.mediaSession.setActionHandler(
      'seekforward',
      (details) => {
        const offset =
          details.seekOffset ||
          10;

        seekTo(
          Player.currentTime +
            offset
        );
      }
    );
  } catch {}

  try {
    navigator.mediaSession.setActionHandler(
      'seekto',
      (details) => {
        if (
          typeof details.seekTime !==
          'number'
        ) {
          return;
        }

        seekTo(
          details.seekTime
        );
      }
    );
  } catch {}

  Player.mediaSessionReady =
    true;
}


/* ============================================================
   MEDIA SESSION METADATA
   ============================================================ */

function updateMediaSessionMetadata(
  track
) {
  if (
    !('mediaSession' in navigator) ||
    !track
  ) {
    return;
  }

  const title =
    track.title ||
    'Unknown';

  const artist =
    getArtistName(track) ||
    'Unknown Artist';

  const album =
    track.album ||
    'YouTube Music';

  const artwork =
    getThumbnail(track);

  try {
    navigator.mediaSession.metadata =
      new MediaMetadata({
        title,
        artist,
        album,

        artwork:
          artwork
            ? [
                {
                  src: artwork,
                  sizes:
                    '480x360',
                  type:
                    'image/jpeg',
                },
              ]
            : [],
      });
  } catch (
    error
  ) {
    console.warn(
      '[MediaSession metadata]',
      error
    );
  }
}


/* ============================================================
   MEDIA SESSION PLAYBACK STATE
   ============================================================ */

function updateMediaSessionPlaybackState(
  state
) {
  if (
    !('mediaSession' in navigator)
  ) {
    return;
  }

  try {
    navigator.mediaSession.playbackState =
      state;
  } catch {}
}


/* ============================================================
   MEDIA SESSION POSITION STATE
   ============================================================ */

function updateMediaSessionPositionState() {
  if (
    !('mediaSession' in navigator)
  ) {
    return;
  }

  if (
    !Player.duration ||
    !Number.isFinite(
      Player.duration
    )
  ) {
    return;
  }

  if (
    !Number.isFinite(
      Player.currentTime
    )
  ) {
    return;
  }

  try {
    navigator.mediaSession.setPositionState(
      {
        duration:
          Math.max(
            0.01,
            Player.duration
          ),

        playbackRate:
          getPlaybackRate(),

        position:
          clamp(
            Player.currentTime,
            0,
            Player.duration
          ),
      }
    );
  } catch {}
}


/* ============================================================
   PLAYBACK RATE
   ============================================================ */

function getPlaybackRate() {
  if (
    !Player.ytPlayer
  ) {
    return 1;
  }

  try {
    const rate =
      Number(
        Player.ytPlayer.getPlaybackRate()
      );

    if (
      Number.isFinite(rate) &&
      rate > 0
    ) {
      return rate;
    }
  } catch {}

  return 1;
}


/* ============================================================
   QUEUE
   ============================================================ */

function saveQueue() {
  storageSet(
    STORAGE_KEYS.queue,
    Player.queue
  );

  storageSet(
    STORAGE_KEYS.queueIndex,
    Player.queueIndex
  );
}

function loadQueue() {
  const savedQueue =
    storageGet(
      STORAGE_KEYS.queue,
      []
    );

  const savedIndex =
    storageGet(
      STORAGE_KEYS.queueIndex,
      -1
    );

  if (
    Array.isArray(
      savedQueue
    )
  ) {
    Player.queue =
      savedQueue
        .map(
          normalizeTrack
        )
        .filter(
          Boolean
        );
  } else {
    Player.queue =
      [];
  }

  Player.queueIndex =
    Number.isInteger(
      savedIndex
    )
      ? savedIndex
      : -1;

  if (
    Player.queueIndex >=
    Player.queue.length
  ) {
    Player.queueIndex =
      Player.queue.length -
      1;
  }
}


/* ============================================================
   ADD TO QUEUE
   ============================================================ */

function addToQueue(
  track,
  playNow = false
) {
  track =
    normalizeTrack(
      track
    );

  if (
    !track ||
    !track.videoId
  ) {
    return false;
  }

  const existing =
    Player.queue.findIndex(
      (item) =>
        sameTrack(
          item,
          track
        )
    );

  if (
    existing >= 0
  ) {
    if (
      playNow
    ) {
      Player.queueIndex =
        existing;

      saveQueue();

      playTrack(
        Player.queue[
          existing
        ],
        {
          queueIndex:
            existing,
        }
      );
    }

    return false;
  }

  Player.queue.push(
    track
  );

  if (
    Player.queueIndex <
    0
  ) {
    Player.queueIndex =
      0;
  }

  saveQueue();

  renderQueue();

  if (
    playNow
  ) {
    const index =
      Player.queue.length -
      1;

    Player.queueIndex =
      index;

    playTrack(
      track,
      {
        queueIndex:
          index,
      }
    );
  }

  return true;
}


/* ============================================================
   ADD MULTIPLE TRACKS
   ============================================================ */

function addTracksToQueue(
  tracks,
  playFirst = false
) {
  if (
    !Array.isArray(
      tracks
    )
  ) {
    return;
  }

  const normalized =
    tracks
      .map(
        normalizeTrack
      )
      .filter(
        (track) =>
          track &&
          track.videoId
      );

  if (
    !normalized.length
  ) {
    return;
  }

  let firstIndex =
    -1;

  for (
    const track of normalized
  ) {
    const exists =
      Player.queue.some(
        (item) =>
          sameTrack(
            item,
            track
          )
      );

    if (
      exists
    ) {
      continue;
    }

    if (
      firstIndex === -1
    ) {
      firstIndex =
        Player.queue.length;
    }

    Player.queue.push(
      track
    );
  }

  if (
    Player.queueIndex <
    0 &&
    Player.queue.length
  ) {
    Player.queueIndex =
      0;
  }

  saveQueue();
  renderQueue();

  if (
    playFirst &&
    firstIndex >= 0
  ) {
    Player.queueIndex =
      firstIndex;

    playTrack(
      Player.queue[
        firstIndex
      ],
      {
        queueIndex:
          firstIndex,
      }
    );
  }
}


/* ============================================================
   REMOVE FROM QUEUE
   ============================================================ */

function removeFromQueue(
  index
) {
  index =
    Number(index);

  if (
    !Number.isInteger(index) ||
    index < 0 ||
    index >=
      Player.queue.length
  ) {
    return;
  }

  const removingCurrent =
    index ===
    Player.queueIndex;

  Player.queue.splice(
    index,
    1
  );

  if (
    index <
    Player.queueIndex
  ) {
    Player.queueIndex--;
  }

  if (
    Player.queueIndex >=
    Player.queue.length
  ) {
    Player.queueIndex =
      Player.queue.length -
      1;
  }

  if (
    removingCurrent
  ) {
    /*
     * Current video can continue playing.
     * Queue position is simply adjusted.
     */
  }

  saveQueue();
  renderQueue();
}


/* ============================================================
   CLEAR QUEUE
   ============================================================ */

function clearQueue(
  keepCurrent = true
) {
  if (
    keepCurrent &&
    Player.current
  ) {
    Player.queue =
      [
        normalizeTrack(
          Player.current
        ),
      ];

    Player.queueIndex =
      0;
  } else {
    Player.queue =
      [];

    Player.queueIndex =
      -1;
  }

  saveQueue();
  renderQueue();
}


/* ============================================================
   MOVE QUEUE ITEM
   ============================================================ */

function moveQueueItem(
  from,
  to
) {
  from =
    Number(from);

  to =
    Number(to);

  if (
    !Number.isInteger(from) ||
    !Number.isInteger(to)
  ) {
    return;
  }

  if (
    from < 0 ||
    from >=
      Player.queue.length ||
    to < 0 ||
    to >=
      Player.queue.length
  ) {
    return;
  }

  if (
    from ===
    to
  ) {
    return;
  }

  const item =
    Player.queue.splice(
      from,
      1
    )[0];

  Player.queue.splice(
    to,
    0,
    item
  );

  if (
    Player.queueIndex ===
    from
  ) {
    Player.queueIndex =
      to;
  } else if (
    from <
      Player.queueIndex &&
    to >=
      Player.queueIndex
  ) {
    Player.queueIndex--;
  } else if (
    from >
      Player.queueIndex &&
    to <=
      Player.queueIndex
  ) {
    Player.queueIndex++;
  }

  saveQueue();
  renderQueue();
}


/* ============================================================
   SHUFFLE
   ============================================================ */

function toggleShuffle() {
  Player.shuffle =
    !Player.shuffle;

  storageSet(
    STORAGE_KEYS.shuffle,
    Player.shuffle
  );

  updateShuffleUI();

  toast(
    Player.shuffle
      ? 'Shuffle aktif'
      : 'Shuffle nonaktif'
  );
}


/* ============================================================
   REPEAT
   ============================================================ */

function toggleRepeat() {
  Player.repeat =
    !Player.repeat;

  storageSet(
    STORAGE_KEYS.repeat,
    Player.repeat
  );

  updateRepeatUI();

  toast(
    Player.repeat
      ? 'Repeat aktif'
      : 'Repeat nonaktif'
  );
}


/* ============================================================
   TRACK ENDED
   ============================================================ */

async function handleTrackEnded() {
  if (
    !Player.current
  ) {
    return;
  }

  /*
   * Repeat current track.
   *
   * Repeat is handled here rather than by queue navigation.
   */

  if (
    Player.repeat
  ) {
    try {
      if (
        Player.ytPlayer
      ) {
        Player.ytPlayer.seekTo(
          0,
          true
        );

        Player.ytPlayer.playVideo();

        Player.currentTime =
          0;

        Player.playing =
          true;

        updatePlayButtons(
          true
        );

        updateMediaSessionPlaybackState(
          'playing'
        );

        startProgressTimer();

        return;
      }
    } catch {}
  }

  const result =
    await nextTrack();

  if (
    !result
  ) {
    Player.playing =
      false;

    stopProgressTimer();

    updatePlayButtons(
      false
    );

    updateMediaSessionPlaybackState(
      'none'
    );

    persistPlayerState();
  }
}


/* ============================================================
   UPDATE PLAY BUTTONS
   ============================================================ */

function updatePlayButtons(
  playing
) {
  const buttons =
    $$(
      '[data-player-action="play"], [data-action="play"]'
    );

  buttons.forEach(
    (button) => {
      const icon =
        button.querySelector(
          '[data-play-icon]'
        );

      const pauseIcon =
        button.querySelector(
          '[data-pause-icon]'
        );

      if (
        icon
      ) {
        icon.style.display =
          playing
            ? 'none'
            : '';
      }

      if (
        pauseIcon
      ) {
        pauseIcon.style.display =
          playing
            ? ''
            : 'none';
      }

      if (
        !icon &&
        !pauseIcon
      ) {
        button.setAttribute(
          'aria-label',
          playing
            ? 'Pause'
            : 'Play'
        );

        /*
         * Only change text when button does not
         * contain an icon element.
         */
        if (
          button.children.length ===
          0
        ) {
          button.textContent =
            playing
              ? '❚❚'
              : '▶';
        }
      }

      button.classList.toggle(
        'is-playing',
        playing
      );
    }
  );
}


/* ============================================================
   LOADING UI
   ============================================================ */

function updateLoadingUI(
  loading
) {
  $$(
    '[data-player-loading]'
  ).forEach(
    (element) => {
      element.hidden =
        !loading;
    }
  );

  $$(
    '.player-loading'
  ).forEach(
    (element) => {
      element.classList.toggle(
        'active',
        loading
      );
    }
  );

  if (
    Player.current
  ) {
    $$(
      '[data-current-title]'
    ).forEach(
      (element) => {
        element.classList.toggle(
          'loading',
          loading
        );
      }
    );
  }
}


/* ============================================================
   PLAYER UI
   ============================================================ */

function updatePlayerUI() {
  const track =
    Player.current;

  if (
    !track
  ) {
    return;
  }

  $$(
    '[data-current-title]'
  ).forEach(
    (element) => {
      element.textContent =
        track.title ||
        'Unknown';
    }
  );

  $$(
    '[data-current-artist]'
  ).forEach(
    (element) => {
      element.textContent =
        getArtistName(
          track
        ) ||
        'Unknown Artist';
    }
  );

  $$(
    '[data-current-thumbnail]'
  ).forEach(
    (element) => {
      const thumbnail =
        getThumbnail(
          track
        );

      if (
        element.tagName ===
        'IMG'
      ) {
        element.src =
          thumbnail;

        element.alt =
          track.title ||
          'Album artwork';
      } else if (
        thumbnail
      ) {
        element.style.backgroundImage =
          `url("${thumbnail}")`;
      }
    }
  );

  updateProgressUI();

  updateVolumeUI();

  updateShuffleUI();

  updateRepeatUI();

  updatePlayButtons(
    Player.playing
  );
}


/* ============================================================
   PROGRESS UI
   ============================================================ */

function updateProgressUI() {
  const current =
    Player.currentTime || 0;

  const duration =
    Player.duration || 0;

  const percentage =
    duration > 0
      ? clamp(
          (current /
            duration) *
            100,
          0,
          100
        )
      : 0;

  $$(
    '[data-player-progress]'
  ).forEach(
    (element) => {
      if (
        element.tagName ===
        'INPUT'
      ) {
        element.value =
          percentage;

        element.max =
          100;
      } else {
        element.style.width =
          `${percentage}%`;
      }
    }
  );

  $$(
    '[data-current-time]'
  ).forEach(
    (element) => {
      element.textContent =
        formatTime(
          current
        );
    }
  );

  $$(
    '[data-duration]'
  ).forEach(
    (element) => {
      element.textContent =
        formatTime(
          duration
        );
    }
  );

  updateMediaSessionPositionState();
}


/* ============================================================
   VOLUME UI
   ============================================================ */

function updateVolumeUI() {
  $$(
    '[data-player-volume]'
  ).forEach(
    (element) => {
      if (
        element.tagName ===
        'INPUT'
      ) {
        element.value =
          Player.muted
            ? 0
            : Player.volume;

        element.min =
          0;

        element.max =
          1;

        element.step =
          0.01;
      }
    }
  );

  $$(
    '[data-volume-icon]'
  ).forEach(
    (element) => {
      if (
        Player.muted ||
        Player.volume ===
          0
      ) {
        element.textContent =
          '🔇';
      } else if (
        Player.volume <
        0.5
      ) {
        element.textContent =
          '🔉';
      } else {
        element.textContent =
          '🔊';
      }
    }
  );
}


/* ============================================================
   SHUFFLE UI
   ============================================================ */

function updateShuffleUI() {
  $$(
    '[data-player-action="shuffle"], [data-action="shuffle"]'
  ).forEach(
    (button) => {
      button.classList.toggle(
        'active',
        Player.shuffle
      );

      button.setAttribute(
        'aria-pressed',
        String(
          Player.shuffle
        )
      );
    }
  );
}


/* ============================================================
   REPEAT UI
   ============================================================ */

function updateRepeatUI() {
  $$(
    '[data-player-action="repeat"], [data-action="repeat"]'
  ).forEach(
    (button) => {
      button.classList.toggle(
        'active',
        Player.repeat
      );

      button.setAttribute(
        'aria-pressed',
        String(
          Player.repeat
        )
      );
    }
  );
}


/* ============================================================
   RENDER QUEUE
   ============================================================ */

function renderQueue() {
  const containers =
    $$(
      '[data-player-queue]'
    );

  if (
    !containers.length
  ) {
    return;
  }

  containers.forEach(
    (container) => {
      if (
        !Player.queue.length
      ) {
        container.innerHTML =
          `
            <div class="queue-empty">
              Queue kosong
            </div>
          `;

        return;
      }

      container.innerHTML =
        Player.queue
          .map(
            (
              track,
              index
            ) => {
              const active =
                index ===
                Player.queueIndex;

              return `
                <div
                  class="queue-item ${
                    active
                      ? 'active'
                      : ''
                  }"
                  data-queue-index="${index}"
                >
                  <button
                    type="button"
                    class="queue-play"
                    data-queue-play="${index}"
                    aria-label="Play ${escapeHtml(
                      track.title
                    )}"
                  >
                    ${
                      active &&
                      Player.playing
                        ? '❚❚'
                        : '▶'
                    }
                  </button>

                  <img
                    class="queue-thumbnail"
                    src="${escapeHtml(
                      getThumbnail(
                        track
                      )
                    )}"
                    alt=""
                    loading="lazy"
                  >

                  <div class="queue-info">
                    <div class="queue-title">
                      ${escapeHtml(
                        track.title
                      )}
                    </div>

                    <div class="queue-artist">
                      ${escapeHtml(
                        getArtistName(
                          track
                        )
                      )}
                    </div>
                  </div>

                  <button
                    type="button"
                    class="queue-remove"
                    data-queue-remove="${index}"
                    aria-label="Remove"
                  >
                    ×
                  </button>
                </div>
              `;
            }
          )
          .join('');
    }
  );
}


/* ============================================================
   QUEUE CLICK EVENTS
   ============================================================ */

function handleQueueClick(
  event
) {
  const playButton =
    event.target.closest(
      '[data-queue-play]'
    );

  if (
    playButton
  ) {
    const index =
      Number(
        playButton.dataset
          .queuePlay
      );

    if (
      Number.isInteger(
        index
      ) &&
      Player.queue[index]
    ) {
      Player.queueIndex =
        index;

      playTrack(
        Player.queue[
          index
        ],
        {
          queueIndex:
            index,
        }
      );
    }

    return;
  }

  const removeButton =
    event.target.closest(
      '[data-queue-remove]'
    );

  if (
    removeButton
  ) {
    const index =
      Number(
        removeButton.dataset
          .queueRemove
      );

    removeFromQueue(
      index
    );
  }
}


/* ============================================================
   PERSIST PLAYER STATE
   ============================================================ */

function persistPlayerState() {
  saveQueue();

  storageSet(
    STORAGE_KEYS.current,
    Player.current
  );

  storageSet(
    STORAGE_KEYS.currentTime,
    Player.currentTime
  );
}


/* ============================================================
   RESTORE PLAYER STATE
   ============================================================ */

function restorePlayerState() {
  const savedCurrent =
    storageGet(
      STORAGE_KEYS.current,
      null
    );

  const savedTime =
    storageGet(
      STORAGE_KEYS.currentTime,
      0
    );

  if (
    savedCurrent
  ) {
    Player.current =
      normalizeTrack(
        savedCurrent
      );
  }

  if (
    Number.isFinite(
      Number(savedTime)
    )
  ) {
    Player.currentTime =
      Number(savedTime);
  }

  Player.volume =
    clamp(
      Number(
        storageGet(
          STORAGE_KEYS.volume,
          1
        )
      ) || 1,
      0,
      1
    );

  Player.repeat =
    Boolean(
      storageGet(
        STORAGE_KEYS.repeat,
        false
      )
    );

  Player.shuffle =
    Boolean(
      storageGet(
        STORAGE_KEYS.shuffle,
        false
      )
    );

  updatePlayerUI();
}


/* ============================================================
   RESTORE YOUTUBE VIDEO
   ============================================================ */

async function restoreYouTubeState() {
  if (
    !Player.current ||
    !Player.current.videoId
  ) {
    return;
  }

  /*
   * IMPORTANT:
   *
   * Do NOT automatically call playVideo()
   * when page reloads.
   *
   * Browser autoplay restrictions can block it.
   *
   * We only cue the video and restore position.
   * User can press Play.
   */

  try {
    const player =
      await initYouTubePlayer();

    if (
      !player
    ) {
      return;
    }

    player.cueVideoById(
      Player.current.videoId
    );

    await wait(
      500
    );

    if (
      Player.currentTime >
      0
    ) {
      try {
        player.seekTo(
          Player.currentTime,
          true
        );
      } catch {}
    }

    updatePlayerUI();

    updateLoadingUI(
      false
    );
  } catch (
    error
  ) {
    console.warn(
      '[restoreYouTubeState]',
      error
    );
  }
}


/* ============================================================
   PROGRESS BAR INPUT
   ============================================================ */

function handleProgressInput(
  event
) {
  const value =
    Number(
      event.target.value
    );

  if (
    !Number.isFinite(
      value
    )
  ) {
    return;
  }

  const duration =
    Player.duration;

  if (
    !duration
  ) {
    return;
  }

  const time =
    duration *
    clamp(
      value,
      0,
      100
    ) /
    100;

  seekTo(
    time
  );
}


/* ============================================================
   VOLUME INPUT
   ============================================================ */

function handleVolumeInput(
  event
) {
  const value =
    Number(
      event.target.value
    );

  if (
    !Number.isFinite(
      value
    )
  ) {
    return;
  }

  setVolume(
    value
  );
}


/* ============================================================
   KEYBOARD SHORTCUTS
   ============================================================ */

function handleKeyboard(
  event
) {
  /*
   * Do not steal keyboard input from:
   * - input
   * - textarea
   * - select
   */

  const target =
    event.target;

  if (
    target &&
    (
      target.tagName ===
        'INPUT' ||
      target.tagName ===
        'TEXTAREA' ||
      target.tagName ===
        'SELECT' ||
      target.isContentEditable
    )
  ) {
    return;
  }

  switch (
    event.code
  ) {
    case 'Space':
      event.preventDefault();

      togglePlay();

      break;

    case 'ArrowRight':
      event.preventDefault();

      seekTo(
        Player.currentTime +
          5
      );

      break;

    case 'ArrowLeft':
      event.preventDefault();

      seekTo(
        Player.currentTime -
          5
      );

      break;

    case 'ArrowUp':
      event.preventDefault();

      setVolume(
        Player.volume +
          0.05
      );

      break;

    case 'ArrowDown':
      event.preventDefault();

      setVolume(
        Player.volume -
          0.05
      );

      break;

    case 'KeyM':
      event.preventDefault();

      toggleMute();

      break;

    case 'KeyN':
      event.preventDefault();

      nextTrack();

      break;

    case 'KeyP':
      event.preventDefault();

      previousTrack();

      break;
  }
}


/* ============================================================
   PLAYER BUTTON EVENTS
   ============================================================ */

function handlePlayerAction(
  event
) {
  const button =
    event.target.closest(
      '[data-player-action], [data-action]'
    );

  if (
    !button
  ) {
    return;
  }

  const action =
    button.dataset
      .playerAction ||
    button.dataset
      .action;

  if (
    !action
  ) {
    return;
  }

  switch (
    action
  ) {
    case 'play':
      togglePlay();
      break;

    case 'pause':
      pauseTrack();
      break;

    case 'next':
      nextTrack();
      break;

    case 'previous':
      previousTrack();
      break;

    case 'shuffle':
      toggleShuffle();
      break;

    case 'repeat':
      toggleRepeat();
      break;

    case 'mute':
      toggleMute();
      break;

    case 'queue-clear':
      clearQueue();
      break;

    case 'queue-toggle':
      toggleQueue();
      break;
  }
}


/* ============================================================
   QUEUE PANEL
   ============================================================ */

function toggleQueue() {
  $$(
    '[data-player-queue-panel]'
  ).forEach(
    (panel) => {
      panel.classList.toggle(
        'open'
      );

      panel.hidden =
        !panel.classList.contains(
          'open'
        );
    }
  );
}


/* ============================================================
   DOUBLE CLICK / MEDIA PLAYER SAFETY
   ============================================================ */

document.addEventListener(
  'visibilitychange',
  () => {
    /*
     * DO NOT pause music here.
     *
     * This is a very important fix.
     *
     * A common mistake is:
     *
     * document.hidden -> pause()
     *
     * That makes the music stop when:
     * - screen is locked
     * - browser goes background
     * - user switches application
     *
     * We intentionally do nothing.
     */

    if (
      document.visibilityState ===
      'visible'
    ) {
      updatePlayerUI();

      updateProgressFromPlayer();
    }
  }
);


/* ============================================================
   PAGE SHOW / BFCACHE
   ============================================================ */

window.addEventListener(
  'pageshow',
  () => {
    updatePlayerUI();

    updateProgressFromPlayer();
  }
);


/* ============================================================
   PAGE HIDE
   ============================================================ */

window.addEventListener(
  'pagehide',
  () => {
    /*
     * Save state only.
     *
     * DO NOT pause YouTube here.
     */
    persistPlayerState();
  }
);


/* ============================================================
   BEFORE UNLOAD
   ============================================================ */

window.addEventListener(
  'beforeunload',
  () => {
    persistPlayerState();
  }
);


/* ============================================================
   MOBILE SCREEN LOCK SUPPORT
   ============================================================ */

/*
 * No Wake Lock is requested here.
 *
 * Wake Lock keeps the screen ON, which is the opposite
 * of what a music application needs.
 *
 * We WANT:
 *
 * screen ON
 *     ↓
 * user locks screen
 *     ↓
 * browser continues media session
 *     ↓
 * YouTube player continues playback
 *
 * The browser/OS decides whether background playback
 * is permitted.
 */


/* ============================================================
   VISUAL PLAYER STATUS
   ============================================================ */

function updatePlayerStatus() {
  const status =
    Player.playing
      ? 'playing'
      : Player.loading
        ? 'loading'
        : 'paused';

  $$(
    '[data-player-status]'
  ).forEach(
    (element) => {
      element.dataset.status =
        status;

      element.textContent =
        status;
    }
  );
}


/* ============================================================
   UPDATE LYRICS
   ============================================================ */

function updateLyricsPosition(
  currentTime
) {
  const lines =
    $$(
      '[data-lyric-time]'
    );

  if (
    !lines.length
  ) {
    return;
  }

  let active =
    null;

  let closest =
    -Infinity;

  lines.forEach(
    (line) => {
      const time =
        Number(
          line.dataset
            .lyricTime
        );

      if (
        !Number.isFinite(
          time
        )
      ) {
        return;
      }

      if (
        time <=
          currentTime &&
        time >
          closest
      ) {
        closest =
          time;

        active =
          line;
      }
    }
  );

  lines.forEach(
    (line) => {
      line.classList.toggle(
        'active',
        line ===
          active
      );
    }
  );

  if (
    active
  ) {
    try {
      active.scrollIntoView(
        {
          behavior:
            'smooth',
          block:
            'center',
        }
      );
    } catch {}
  }
}


/* ============================================================
   SPONSORBLOCK
   ============================================================ */

async function loadSponsorSegments(
  videoId
) {
  Player.sponsorSegments =
    [];

  if (
    !videoId
  ) {
    return;
  }

  /*
   * SponsorBlock API is optional.
   *
   * Failure here must NEVER prevent
   * the actual music player from working.
   */

  try {
    const url =
      `https://sponsor.ajay.app/api/skipSegments?videoID=${encodeURIComponent(
        videoId
      )}`;

    const response =
      await fetch(
        url,
        {
          method:
            'GET',

          headers: {
            Accept:
              'application/json',
          },

          signal:
            AbortSignal.timeout
              ? AbortSignal.timeout(
                  5000
                )
              : undefined,
        }
      );

    if (
      !response.ok
    ) {
      return;
    }

    const data =
      await response.json();

    if (
      !Array.isArray(
        data
      )
    ) {
      return;
    }

    Player.sponsorSegments =
      data
        .map(
          (item) => {
            const segment =
              item.segment;

            if (
              !Array.isArray(
                segment
              ) ||
              segment.length <
                2
            ) {
              return null;
            }

            return {
              start:
                Number(
                  segment[0]
                ),
              end:
                Number(
                  segment[1]
                ),
              category:
                item.category ||
                '',
            };
          }
        )
        .filter(
          (item) =>
            item &&
            Number.isFinite(
              item.start
            ) &&
            Number.isFinite(
              item.end
            ) &&
            item.end >
              item.start
        );
  } catch (
    error
  ) {
    /*
     * SponsorBlock is non-essential.
     * Silently ignore errors.
     */
    console.debug(
      '[SponsorBlock]',
      error
    );
  }
}


/* ============================================================
   HANDLE SPONSOR SEGMENTS
   ============================================================ */

function handleSponsorBlock(
  currentTime
) {
  if (
    !Player.sponsorSegments
      .length
  ) {
    return;
  }

  const segment =
    Player.sponsorSegments.find(
      (item) =>
        currentTime >=
          item.start &&
        currentTime <
          item.end
    );

  if (
    !segment
  ) {
    return;
  }

  /*
   * Only skip segments categorized as sponsor.
   *
   * Do not blindly skip every SponsorBlock category,
   * because music videos can contain:
   * - intro
   * - outro
   * - music_offtopic
   * - selfpromo
   * etc.
   */

  if (
    segment.category !==
    'sponsor'
  ) {
    return;
  }

  const target =
    segment.end +
    0.25;

  /*
   * Prevent repeated seek calls.
   */
  if (
    Player._lastSponsorSeek ===
    segment.end
  ) {
    return;
  }

  Player._lastSponsorSeek =
    segment.end;

  seekTo(
    target
  );
}


/* ============================================================
   SEARCH
   ============================================================ */

async function searchMusic(
  query
) {
  query =
    String(
      query || ''
    ).trim();

  if (
    !query
  ) {
    return [];
  }

  try {
    /*
     * Compatible with common Express backend:
     *
     * GET /api/search?q=...
     */

    const result =
      await api(
        `/api/search?q=${encodeURIComponent(
          query
        )}`
      );

    /*
     * Support several possible backend formats.
     */

    if (
      Array.isArray(
        result
      )
    ) {
      return result
        .map(
          normalizeTrack
        )
        .filter(
          Boolean
        );
    }

    if (
      Array.isArray(
        result.results
      )
    ) {
      return result.results
        .map(
          normalizeTrack
        )
        .filter(
          Boolean
        );
    }

    if (
      Array.isArray(
        result.items
      )
    ) {
      return result.items
        .map(
          normalizeTrack
        )
        .filter(
          Boolean
        );
    }

    return [];
  } catch (
    error
  ) {
    console.error(
      '[searchMusic]',
      error
    );

    toast(
      'Gagal mencari lagu.',
      'error'
    );

    return [];
  }
}


/* ============================================================
   SEARCH FORM
   ============================================================ */

async function handleSearchSubmit(
  event
) {
  event.preventDefault();

  const form =
    event.currentTarget;

  const input =
    form.querySelector(
      'input[name="q"], input[type="search"], input[type="text"]'
    );

  if (
    !input
  ) {
    return;
  }

  const query =
    input.value.trim();

  if (
    !query
  ) {
    return;
  }

  const results =
    await searchMusic(
      query
    );

  renderSearchResults(
    results
  );
}


/* ============================================================
   RENDER SEARCH RESULTS
   ============================================================ */

function renderSearchResults(
  results
) {
  const containers =
    $$(
      '[data-search-results]'
    );

  if (
    !containers.length
  ) {
    return;
  }

  containers.forEach(
    (container) => {
      if (
        !results.length
      ) {
        container.innerHTML =
          `
            <div class="search-empty">
              Tidak ada hasil.
            </div>
          `;

        return;
      }

      container.innerHTML =
        results
          .map(
            (
              track,
              index
            ) => `
              <article
                class="search-result"
                data-result-index="${index}"
              >
                <img
                  src="${escapeHtml(
                    getThumbnail(
                      track
                    )
                  )}"
                  alt=""
                  loading="lazy"
                >

                <div class="search-result-info">
                  <div class="search-result-title">
                    ${escapeHtml(
                      track.title
                    )}
                  </div>

                  <div class="search-result-artist">
                    ${escapeHtml(
                      getArtistName(
                        track
                      )
                    )}
                  </div>
                </div>

                <button
                  type="button"
                  data-result-play="${index}"
                >
                  ▶
                </button>

                <button
                  type="button"
                  data-result-add="${index}"
                >
                  +
                </button>
              </article>
            `
          )
          .join('');

      container._results =
        results;
    }
  );
}


/* ============================================================
   SEARCH RESULT EVENTS
   ============================================================ */

function handleSearchResultClick(
  event
) {
  const playButton =
    event.target.closest(
      '[data-result-play]'
    );

  const addButton =
    event.target.closest(
      '[data-result-add]'
    );

  const container =
    event.currentTarget;

  const results =
    container._results ||
    [];

  if (
    playButton
  ) {
    const index =
      Number(
        playButton.dataset
          .resultPlay
      );

    const track =
      results[index];

    if (
      track
    ) {
      addToQueue(
        track,
        true
      );
    }

    return;
  }

  if (
    addButton
  ) {
    const index =
      Number(
        addButton.dataset
          .resultAdd
      );

    const track =
      results[index];

    if (
      track
    ) {
      const added =
        addToQueue(
          track,
          false
        );

      toast(
        added
          ? 'Ditambahkan ke queue.'
          : 'Lagu sudah ada di queue.'
      );
    }
  }
}


/* ============================================================
   RESULT CLICK SUPPORT FOR EXISTING CARDS
   ============================================================ */

document.addEventListener(
  'click',
  (event) => {
    const card =
      event.target.closest(
        '[data-track]'
      );

    if (
      !card
    ) {
      return;
    }

    /*
     * If the card has JSON in data-track,
     * it can directly be used by the player.
     */

    const raw =
      card.dataset.track;

    if (
      !raw
    ) {
      return;
    }

    let track;

    try {
      track =
        JSON.parse(
          raw
        );
    } catch {
      return;
    }

    const play =
      event.target.closest(
        '[data-track-play], [data-play-track]'
      );

    const add =
      event.target.closest(
        '[data-track-add], [data-add-track]'
      );

    if (
      play
    ) {
      event.preventDefault();

      addToQueue(
        track,
        true
      );
    } else if (
      add
    ) {
      event.preventDefault();

      const added =
        addToQueue(
          track,
          false
        );

      toast(
        added
          ? 'Ditambahkan ke queue.'
          : 'Lagu sudah ada di queue.'
      );
    }
  }
);


/* ============================================================
   GLOBAL EVENT BINDINGS
   ============================================================ */

function bindEvents() {
  /*
   * Player actions
   */

  document.addEventListener(
    'click',
    handlePlayerAction
  );

  /*
   * Queue
   */

  document.addEventListener(
    'click',
    (event) => {
      const queue =
        event.target.closest(
          '[data-player-queue]'
        );

      if (
        queue
      ) {
        handleQueueClick(
          event
        );
      }
    }
  );

  /*
   * Search
   */

  document.addEventListener(
    'submit',
    (event) => {
      const form =
        event.target.closest(
          '[data-search-form]'
        );

      if (
        form
      ) {
        handleSearchSubmit(
          event
        );
      }
    }
  );

  /*
   * Search result click
   */

  document.addEventListener(
    'click',
    (event) => {
      const results =
        event.target.closest(
          '[data-search-results]'
        );

      if (
        results
      ) {
        handleSearchResultClick(
          event
        );
      }
    }
  );

  /*
   * Progress
   */

  document.addEventListener(
    'input',
    (event) => {
      if (
        event.target.matches(
          '[data-player-progress]'
        )
      ) {
        handleProgressInput(
          event
        );
      }

      if (
        event.target.matches(
          '[data-player-volume]'
        )
      ) {
        handleVolumeInput(
          event
        );
      }
    }
  );

  /*
   * Keyboard
   */

  document.addEventListener(
    'keydown',
    handleKeyboard
  );

  /*
   * Track play buttons generated by
   * other parts of the application.
   */

  document.addEventListener(
    'click',
    (event) => {
      const button =
        event.target.closest(
          '[data-play-video-id]'
        );

      if (
        !button
      ) {
        return;
      }

      const videoId =
        button.dataset
          .playVideoId;

      if (
        !videoId
      ) {
        return;
      }

      const track =
        {
          videoId,
          title:
            button.dataset
              .title ||
            'Unknown',
          artist:
            button.dataset
              .artist ||
            '',
          thumbnail:
            button.dataset
              .thumbnail ||
            '',
        };

      addToQueue(
        track,
        true
      );
    }
  );
}


/* ============================================================
   INIT PLAYER
   ============================================================ */

async function initPlayer() {
  if (
    Player.initialized
  ) {
    return;
  }

  Player.initialized =
    true;

  loadQueue();

  restorePlayerState();

  initMediaSession();

  bindEvents();

  updatePlayerStatus();

  updateVolumeUI();

  updateShuffleUI();

  updateRepeatUI();

  renderQueue();

  /*
   * Initialize YouTube lazily.
   *
   * The page can load even if YouTube API is slow.
   */

  try {
    await initYouTubePlayer();

    /*
     * Cue previous track but do not autoplay.
     */
    await restoreYouTubeState();
  } catch (
    error
  ) {
    console.warn(
      '[initPlayer]',
      error
    );
  }
}


/* ============================================================
   PLAYER STATUS LOOP
   ============================================================ */

setInterval(
  () => {
    updatePlayerStatus();
  },
  500
);


/* ============================================================
   DOM READY
   ============================================================ */

if (
  document.readyState ===
  'loading'
) {
  document.addEventListener(
    'DOMContentLoaded',
    () => {
      initPlayer();
    },
    {
      once: true,
    }
  );
} else {
  initPlayer();
}


/* ============================================================
   PUBLIC API
   ============================================================ */

window.IMusicPlayer =
  {
    player:
      Player,

    play:
      playCurrent,

    pause:
      pauseTrack,

    toggle:
      togglePlay,

    next:
      nextTrack,

    previous:
      previousTrack,

    seek:
      seekTo,

    volume:
      setVolume,

    mute:
      toggleMute,

    add:
      addToQueue,

    addMany:
      addTracksToQueue,

    remove:
      removeFromQueue,

    clearQueue:
      clearQueue,

    shuffle:
      toggleShuffle,

    repeat:
      toggleRepeat,

    search:
      searchMusic,
  };
/* ============================================================
   PART 3 - APP.JS
   HELPER + YOUTUBE PLAYER + PLAYBACK
   ============================================================ */


/* ============================================================
   HELPER: DOM
   ============================================================ */

function $(selector, parent = document) {
  return parent.querySelector(selector);
}

function $$(selector, parent = document) {
  return Array.from(
    parent.querySelectorAll(selector)
  );
}


/* ============================================================
   HELPER: WAIT
   ============================================================ */

function wait(ms) {
  return new Promise(resolve => {
    setTimeout(resolve, ms);
  });
}


/* ============================================================
   HELPER: CLAMP
   ============================================================ */

function clamp(value, min, max) {
  return Math.min(
    Math.max(value, min),
    max
  );
}


/* ============================================================
   HELPER: FORMAT TIME
   ============================================================ */

function formatTime(seconds) {
  seconds = Number(seconds);

  if (
    !Number.isFinite(seconds) ||
    seconds < 0
  ) {
    seconds = 0;
  }

  const hours =
    Math.floor(seconds / 3600);

  const minutes =
    Math.floor(
      (seconds % 3600) / 60
    );

  const secs =
    Math.floor(
      seconds % 60
    );

  if (hours > 0) {
    return (
      String(hours) +
      ':' +
      String(minutes).padStart(2, '0') +
      ':' +
      String(secs).padStart(2, '0')
    );
  }

  return (
    String(minutes).padStart(2, '0') +
    ':' +
    String(secs).padStart(2, '0')
  );
}


/* ============================================================
   HELPER: ESCAPE HTML
   ============================================================ */

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}


/* ============================================================
   STORAGE
   ============================================================ */

function storageGet(key, fallback = null) {
  try {
    const value =
      localStorage.getItem(key);

    if (value === null) {
      return fallback;
    }

    return JSON.parse(value);
  } catch {
    return fallback;
  }
}


function storageSet(key, value) {
  try {
    localStorage.setItem(
      key,
      JSON.stringify(value)
    );
  } catch (error) {
    console.warn(
      '[Storage]',
      error
    );
  }
}


function storageRemove(key) {
  try {
    localStorage.removeItem(key);
  } catch {}
}


/* ============================================================
   NORMALIZE TRACK
   ============================================================ */

function normalizeTrack(track) {
  if (!track) {
    return null;
  }

  if (typeof track === 'string') {
    return {
      videoId: track,
      title: 'Unknown',
      artist: 'Unknown Artist',
      thumbnail:
        `https://i.ytimg.com/vi/${encodeURIComponent(track)}/hqdefault.jpg`
    };
  }

  const videoId =
    track.videoId ||
    track.id ||
    track.video_id ||
    extractYouTubeId(
      track.url ||
      track.link ||
      ''
    );

  if (!videoId) {
    return null;
  }

  return {
    ...track,

    videoId,

    title:
      track.title ||
      track.name ||
      'Unknown',

    artist:
      track.artist ||
      track.author ||
      track.channelTitle ||
      track.channel ||
      'Unknown Artist',

    album:
      track.album ||
      'YouTube Music',

    thumbnail:
      track.thumbnail ||
      track.thumbnailUrl ||
      track.image ||
      `https://i.ytimg.com/vi/${encodeURIComponent(videoId)}/hqdefault.jpg`
  };
}


/* ============================================================
   EXTRACT YOUTUBE ID
   ============================================================ */

function extractYouTubeId(url) {
  if (!url) {
    return null;
  }

  const value =
    String(url).trim();

  /*
   * Direct video ID
   */

  if (
    /^[a-zA-Z0-9_-]{11}$/.test(value)
  ) {
    return value;
  }

  try {
    const parsed =
      new URL(value);

    /*
     * youtube.com/watch?v=...
     */

    if (
      parsed.searchParams.has('v')
    ) {
      const id =
        parsed.searchParams.get('v');

      if (
        id &&
        /^[a-zA-Z0-9_-]{11}$/.test(id)
      ) {
        return id;
      }
    }

    /*
     * youtu.be/...
     */

    if (
      parsed.hostname.includes(
        'youtu.be'
      )
    ) {
      const id =
        parsed.pathname
          .split('/')
          .filter(Boolean)[0];

      if (
        id &&
        /^[a-zA-Z0-9_-]{11}$/.test(id)
      ) {
        return id;
      }
    }

    /*
     * youtube.com/embed/...
     */

    const parts =
      parsed.pathname
        .split('/')
        .filter(Boolean);

    const embedIndex =
      parts.indexOf('embed');

    if (
      embedIndex >= 0 &&
      parts[embedIndex + 1]
    ) {
      const id =
        parts[embedIndex + 1];

      if (
        /^[a-zA-Z0-9_-]{11}$/.test(id)
      ) {
        return id;
      }
    }
  } catch {}

  return null;
}


/* ============================================================
   THUMBNAIL
   ============================================================ */

function getThumbnail(track) {
  if (!track) {
    return '';
  }

  if (
    track.thumbnail
  ) {
    return track.thumbnail;
  }

  if (
    track.videoId
  ) {
    return (
      `https://i.ytimg.com/vi/` +
      encodeURIComponent(
        track.videoId
      ) +
      `/hqdefault.jpg`
    );
  }

  return '';
}


/* ============================================================
   ARTIST
   ============================================================ */

function getArtistName(track) {
  if (!track) {
    return 'Unknown Artist';
  }

  return (
    track.artist ||
    track.author ||
    track.channelTitle ||
    track.channel ||
    'Unknown Artist'
  );
}


/* ============================================================
   SAME TRACK
   ============================================================ */

function sameTrack(a, b) {
  if (!a || !b) {
    return false;
  }

  return (
    a.videoId &&
    b.videoId &&
    String(a.videoId) ===
      String(b.videoId)
  );
}


/* ============================================================
   TOAST
   ============================================================ */

function toast(
  message,
  type = 'info'
) {
  let container =
    document.querySelector(
      '#toast-container'
    );

  if (!container) {
    container =
      document.createElement(
        'div'
      );

    container.id =
      'toast-container';

    container.className =
      'toast-container';

    document.body.appendChild(
      container
    );
  }

  const item =
    document.createElement(
      'div'
    );

  item.className =
    `toast toast-${type}`;

  item.textContent =
    message;

  container.appendChild(
    item
  );

  requestAnimationFrame(() => {
    item.classList.add(
      'show'
    );
  });

  setTimeout(() => {
    item.classList.remove(
      'show'
    );

    setTimeout(() => {
      item.remove();
    }, 300);

  }, 2500);
}


/* ============================================================
   API HELPER
   ============================================================ */

async function api(
  endpoint,
  options = {}
) {
  const response =
    await fetch(
      endpoint,
      {
        credentials: 'same-origin',

        ...options,

        headers: {
          Accept:
            'application/json',

          ...(options.body
            ? {
                'Content-Type':
                  'application/json'
              }
            : {}),

          ...(options.headers || {})
        }
      }
    );

  let data;

  try {
    data =
      await response.json();
  } catch {
    data = null;
  }

  if (!response.ok) {
    const message =
      data?.message ||
      data?.error ||
      `HTTP ${response.status}`;

    throw new Error(
      message
    );
  }

  return data;
}


/* ============================================================
   YOUTUBE API LOADER
   ============================================================ */

function loadYouTubeAPI() {
  return new Promise(
    (resolve, reject) => {

      if (
        window.YT &&
        window.YT.Player
      ) {
        resolve(
          window.YT
        );

        return;
      }

      const oldCallback =
        window.onYouTubeIframeAPIReady;

      window.onYouTubeIframeAPIReady =
        () => {
          if (
            typeof oldCallback ===
            'function'
          ) {
            try {
              oldCallback();
            } catch {}
          }

          resolve(
            window.YT
          );
        };

      const existing =
        document.querySelector(
          'script[src*="youtube.com/iframe_api"]'
        );

      if (
        existing
      ) {
        return;
      }

      const script =
        document.createElement(
          'script'
        );

      script.src =
        'https://www.youtube.com/iframe_api';

      script.async =
        true;

      script.onerror =
        () => {
          reject(
            new Error(
              'YouTube API gagal dimuat'
            )
          );
        };

      document.head.appendChild(
        script
      );
    }
  );
}


/* ============================================================
   INIT YOUTUBE PLAYER
   ============================================================ */

async function initYouTubePlayer() {
  if (
    Player.ytPlayer
  ) {
    return Player.ytPlayer;
  }

  if (
    Player.youtubeInitPromise
  ) {
    return Player.youtubeInitPromise;
  }

  Player.youtubeInitPromise =
    (async () => {

      await loadYouTubeAPI();

      let iframe =
        document.getElementById(
          'youtube-player'
        );

      /*
       * If HTML does not have the player container,
       * create an invisible one.
       */

      if (!iframe) {
        iframe =
          document.createElement(
            'div'
          );

        iframe.id =
          'youtube-player';

        iframe.setAttribute(
          'aria-hidden',
          'true'
        );

        /*
         * Do not use display:none.
         *
         * Some browsers may stop media
         * when iframe becomes fully hidden.
         */

        Object.assign(
          iframe.style,
          {
            position:
              'fixed',

            width:
              '1px',

            height:
              '1px',

            left:
              '-10px',

            bottom:
              '-10px',

            opacity:
              '0.01',

            pointerEvents:
              'none',

            zIndex:
              '-1'
          }
        );

        document.body.appendChild(
          iframe
        );
      }

      return new Promise(
        (resolve, reject) => {

          let finished =
            false;

          const finish =
            (
              fn,
              value
            ) => {
              if (
                finished
              ) {
                return;
              }

              finished =
                true;

              fn(value);
            };

          try {

            const player =
              new YT.Player(
                iframe,
                {
                  width:
                    '1',

                  height:
                    '1',

                  videoId:
                    '',

                  playerVars:
                    {
                      autoplay:
                        0,

                      controls:
                        0,

                      disablekb:
                        1,

                      fs:
                        0,

                      playsinline:
                        1,

                      rel:
                        0,

                      modestbranding:
                        1
                    },

                  events:
                    {
                      onReady:
                        (event) => {

                          Player.ytPlayer =
                            event.target;

                          Player.youtubeReady =
                            true;

                          updateVolumeUI();

                          finish(
                            resolve,
                            event.target
                          );
                        },

                      onStateChange:
                        handleYouTubeState,

                      onError:
                        handleYouTubeError
                    }
                }
              );

            Player.ytPlayer =
              player;

          } catch (
            error
          ) {
            finish(
              reject,
              error
            );
          }

          setTimeout(
            () => {
              if (
                !Player.youtubeReady
              ) {
                finish(
                  reject,
                  new Error(
                    'YouTube player timeout'
                  )
                );
              }
            },
            15000
          );
        }
      );
    })();

  try {
    return await Player.youtubeInitPromise;
  } catch (
    error
  ) {
    Player.youtubeInitPromise =
      null;

    throw error;
  }
}


/* ============================================================
   YOUTUBE STATE
   ============================================================ */

function handleYouTubeState(
  event
) {
  const state =
    event.data;

  /*
   * YT.PlayerState:
   *
   * -1 unstarted
   *  0 ended
   *  1 playing
   *  2 paused
   *  3 buffering
   *  5 cued
   */

  switch (
    state
  ) {

    case YT.PlayerState.PLAYING:

      Player.playing =
        true;

      Player.loading =
        false;

      updateLoadingUI(
        false
      );

      updatePlayButtons(
        true
      );

      updateMediaSessionPlaybackState(
        'playing'
      );

      startProgressTimer();

      break;


    case YT.PlayerState.PAUSED:

      Player.playing =
        false;

      Player.loading =
        false;

      updateLoadingUI(
        false
      );

      updatePlayButtons(
        false
      );

      updateMediaSessionPlaybackState(
        'paused'
      );

      stopProgressTimer();

      persistPlayerState();

      break;


    case YT.PlayerState.BUFFERING:

      Player.loading =
        true;

      updateLoadingUI(
        true
      );

      break;


    case YT.PlayerState.ENDED:

      Player.playing =
        false;

      Player.loading =
        false;

      stopProgressTimer();

      handleTrackEnded();

      break;


    case YT.PlayerState.CUED:

      Player.loading =
        false;

      updateLoadingUI(
        false
      );

      break;
  }

  updatePlayerStatus();
}


/* ============================================================
   YOUTUBE ERROR
   ============================================================ */

function handleYouTubeError(
  event
) {
  console.warn(
    '[YouTube Error]',
    event.data
  );

  Player.playing =
    false;

  Player.loading =
    false;

  stopProgressTimer();

  updateLoadingUI(
    false
  );

  updatePlayButtons(
    false
  );

  /*
   * Common YouTube errors:
   *
   * 2  invalid parameter
   * 5  HTML5 player error
   * 100 video removed/private
   * 101 embedding disabled
   * 150 embedding disabled
   */

  let message =
    'Video tidak dapat diputar.';

  if (
    event.data === 100
  ) {
    message =
      'Video tidak tersedia.';
  }

  if (
    event.data === 101 ||
    event.data === 150
  ) {
    message =
      'Video ini tidak mengizinkan embedding.';
  }

  if (
    event.data === 2
  ) {
    message =
      'ID video YouTube tidak valid.';
  }

  toast(
    message,
    'error'
  );
}


/* ============================================================
   PLAY TRACK
   ============================================================ */

async function playTrack(
  track,
  options = {}
) {
  track =
    normalizeTrack(
      track
    );

  if (
    !track ||
    !track.videoId
  ) {
    toast(
      'Video tidak valid.',
      'error'
    );

    return false;
  }

  Player.loading =
    true;

  updateLoadingUI(
    true
  );

  try {

    const player =
      await initYouTubePlayer();

    if (
      options.queueIndex !==
      undefined
    ) {
      Player.queueIndex =
        Number(
          options.queueIndex
        );
    }

    Player.current =
      track;

    Player.currentTime =
      0;

    Player.duration =
      0;

    updatePlayerUI();

    updateMediaSessionMetadata(
      track
    );

    updateMediaSessionPlaybackState(
      'none'
    );

    await loadSponsorSegments(
      track.videoId
    );

    /*
     * Load video into YouTube.
     */

    player.loadVideoById(
      track.videoId
    );

    /*
     * Important:
     *
     * playVideo() happens as a direct consequence
     * of the user's click/action.
     */

    try {
      player.playVideo();
    } catch {}

    Player.playing =
      true;

    Player.loading =
      false;

    persistPlayerState();

    saveQueue();

    renderQueue();

    updatePlayerUI();

    return true;

  } catch (
    error
  ) {

    console.error(
      '[playTrack]',
      error
    );

    Player.loading =
      false;

    Player.playing =
      false;

    updateLoadingUI(
      false
    );

    updatePlayButtons(
      false
    );

    toast(
      'Player gagal dimuat.',
      'error'
    );

    return false;
  }
}


/* ============================================================
   PLAY CURRENT
   ============================================================ */

async function playCurrent() {

  if (
    !Player.current
  ) {
    if (
      Player.queue.length
    ) {
      const index =
        Player.queueIndex >= 0
          ? Player.queueIndex
          : 0;

      Player.queueIndex =
        index;

      return playTrack(
        Player.queue[index],
        {
          queueIndex:
            index
        }
      );
    }

    return false;
  }

  try {

    const player =
      await initYouTubePlayer();

    /*
     * If the player is currently on another video,
     * load current video first.
     */

    let currentId = '';

    try {
      currentId =
        player.getVideoData()
          ?.video_id || '';
    } catch {}

    if (
      currentId !==
      Player.current.videoId
    ) {

      player.loadVideoById(
        Player.current.videoId
      );

    } else {

      player.playVideo();

    }

    Player.playing =
      true;

    updatePlayButtons(
      true
    );

    updateMediaSessionMetadata(
      Player.current
    );

    updateMediaSessionPlaybackState(
      'playing'
    );

    startProgressTimer();

    return true;

  } catch (
    error
  ) {

    console.error(
      '[playCurrent]',
      error
    );

    return false;
  }
}


/* ============================================================
   TOGGLE PLAY
   ============================================================ */

async function togglePlay() {

  if (
    Player.playing
  ) {
    pauseTrack();

    return;
  }

  await playCurrent();
}


/* ============================================================
   PAUSE
   ============================================================ */

function pauseTrack() {

  if (
    !Player.ytPlayer
  ) {
    return;
  }

  try {
    Player.ytPlayer.pauseVideo();
  } catch {}

  Player.playing =
    false;

  stopProgressTimer();

  updatePlayButtons(
    false
  );

  updateMediaSessionPlaybackState(
    'paused'
  );

  persistPlayerState();
}


/* ============================================================
   NEXT
   ============================================================ */

async function nextTrack() {

  if (
    !Player.queue.length
  ) {
    return false;
  }

  let nextIndex;

  if (
    Player.shuffle
  ) {

    const candidates =
      Player.queue
        .map(
          (_, index) =>
            index
        )
        .filter(
          index =>
            index !==
            Player.queueIndex
        );

    if (
      !candidates.length
    ) {
      nextIndex =
        Player.queueIndex;
    } else {
      nextIndex =
        candidates[
          Math.floor(
            Math.random() *
              candidates.length
          )
        ];
    }

  } else {

    nextIndex =
      Player.queueIndex +
      1;

    if (
      nextIndex >=
      Player.queue.length
    ) {
      nextIndex = 0;
    }
  }

  Player.queueIndex =
    nextIndex;

  saveQueue();

  return playTrack(
    Player.queue[
      nextIndex
    ],
    {
      queueIndex:
        nextIndex
    }
  );
}


/* ============================================================
   PREVIOUS
   ============================================================ */

async function previousTrack() {

  /*
   * If current track is already more than
   * 3 seconds in, previous means restart.
   */

  if (
    Player.currentTime >
    3
  ) {

    seekTo(
      0
    );

    return true;
  }

  if (
    !Player.queue.length
  ) {
    return false;
  }

  let previousIndex =
    Player.queueIndex -
    1;

  if (
    previousIndex < 0
  ) {
    previousIndex =
      Player.queue.length -
      1;
  }

  Player.queueIndex =
    previousIndex;

  saveQueue();

  return playTrack(
    Player.queue[
      previousIndex
    ],
    {
      queueIndex:
        previousIndex
    }
  );
}


/* ============================================================
   SEEK
   ============================================================ */

function seekTo(
  seconds
) {
  if (
    !Player.ytPlayer
  ) {
    return;
  }

  seconds =
    Number(seconds);

  if (
    !Number.isFinite(seconds)
  ) {
    return;
  }

  const duration =
    Player.duration ||
    getPlayerDuration();

  if (
    duration <= 0
  ) {
    return;
  }

  seconds =
    clamp(
      seconds,
      0,
      duration
    );

  try {
    Player.ytPlayer.seekTo(
      seconds,
      true
    );

    Player.currentTime =
      seconds;

    updateProgressUI();

  } catch {}
}


/* ============================================================
   GET DURATION
   ============================================================ */

function getPlayerDuration() {
  try {

    const duration =
      Number(
        Player.ytPlayer
          ?.getDuration()
      );

    if (
      Number.isFinite(duration)
    ) {
      return duration;
    }

  } catch {}

  return 0;
}


/* ============================================================
   PROGRESS TIMER
   ============================================================ */

function startProgressTimer() {

  if (
    Player.progressTimer
  ) {
    return;
  }

  Player.progressTimer =
    setInterval(
      updateProgressFromPlayer,
      500
    );
}


function stopProgressTimer() {

  if (
    Player.progressTimer
  ) {
    clearInterval(
      Player.progressTimer
    );

    Player.progressTimer =
      null;
  }
}


/* ============================================================
   UPDATE PROGRESS FROM YOUTUBE
   ============================================================ */

function updateProgressFromPlayer() {

  if (
    !Player.ytPlayer
  ) {
    return;
  }

  try {

    const current =
      Number(
        Player.ytPlayer
          .getCurrentTime()
      );

    const duration =
      Number(
        Player.ytPlayer
          .getDuration()
      );

    if (
      Number.isFinite(current)
    ) {
      Player.currentTime =
        current;
    }

    if (
      Number.isFinite(duration) &&
      duration > 0
    ) {
      Player.duration =
        duration;
    }

    updateProgressUI();

    updateLyricsPosition(
      Player.currentTime
    );

    handleSponsorBlock(
      Player.currentTime
    );

    if (
      Player.current
    ) {
      storageSet(
        STORAGE_KEYS.currentTime,
        Player.currentTime
      );
    }

  } catch {}
}


/* ============================================================
   VOLUME
   ============================================================ */

function setVolume(
  value
) {

  value =
    Number(value);

  if (
    !Number.isFinite(value)
  ) {
    return;
  }

  /*
   * Support both:
   *
   * 0 - 1
   * 0 - 100
   */

  if (
    value > 1
  ) {
    value =
      value / 100;
  }

  value =
    clamp(
      value,
      0,
      1
    );

  Player.volume =
    value;

  Player.muted =
    value === 0;

  if (
    Player.ytPlayer
  ) {
    try {

      Player.ytPlayer.setVolume(
        Math.round(
          value * 100
        )
      );

      Player.ytPlayer.unMute();

      if (
        value === 0
      ) {
        Player.ytPlayer.mute();
      }

    } catch {}
  }

  storageSet(
    STORAGE_KEYS.volume,
    value
  );

  updateVolumeUI();
}


/* ============================================================
   MUTE
   ============================================================ */

function toggleMute() {

  Player.muted =
    !Player.muted;

  if (
    Player.ytPlayer
  ) {

    try {

      if (
        Player.muted
      ) {
        Player.ytPlayer.mute();
      } else {

        Player.ytPlayer.unMute();

        Player.ytPlayer.setVolume(
          Math.round(
            Player.volume *
              100
          )
        );
      }

    } catch {}
  }

  updateVolumeUI();
}


/* ============================================================
   QUEUE INITIAL STATE
   ============================================================ */

if (
  !Array.isArray(
    Player.queue
  )
) {
  Player.queue =
    [];
}

if (
  typeof Player.queueIndex !==
  'number'
) {
  Player.queueIndex =
    -1;
}


/* ============================================================
   EXPOSE FUNCTIONS
   ============================================================ */

window.musicPlayer = {

  play:
    playCurrent,

  pause:
    pauseTrack,

  toggle:
    togglePlay,

  next:
    nextTrack,

  previous:
    previousTrack,

  seek:
    seekTo,

  setVolume:
    setVolume,

  mute:
    toggleMute,

  addToQueue:
    addToQueue,

  removeFromQueue:
    removeFromQueue,

  clearQueue:
    clearQueue,

  shuffle:
    toggleShuffle,

  repeat:
    toggleRepeat,

  search:
    searchMusic,

  getState:
    () => ({
      ...Player
    })
};


/* ============================================================
   FINAL INITIALIZATION
   ============================================================ */

(async function () {

  try {

    /*
     * Restore local player data immediately.
     */

    loadQueue();

    restorePlayerState();

    /*
     * Media Session can be initialized
     * before YouTube is ready.
     */

    initMediaSession();

    /*
     * Bind UI.
     */

    bindEvents();

    renderQueue();

    updatePlayerUI();

    /*
     * YouTube loads after the page is ready.
     */

    await initYouTubePlayer();

    /*
     * Restore last selected video.
     */

    if (
      Player.current &&
      Player.current.videoId
    ) {

      try {

        Player.ytPlayer.cueVideoById(
          Player.current.videoId
        );

        await wait(
          500
        );

        if (
          Player.currentTime >
          0
        ) {

          Player.ytPlayer.seekTo(
            Player.currentTime,
            true
          );

        }

      } catch {}
    }

  } catch (
    error
  ) {

    console.error(
      '[Music App Init]',
      error
    );

  }

})();


/* ============================================================
   IMPORTANT BACKGROUND PLAYBACK RULE
   ============================================================ */

/*
 *
 * JANGAN tambahkan kode seperti ini:
 *
 * document.addEventListener(
 *   'visibilitychange',
 *   () => {
 *     if (document.hidden) {
 *       pauseTrack();
 *     }
 *   }
 * );
 *
 *
 * JANGAN:
 *
 * window.onblur = pauseTrack;
 *
 *
 * JANGAN:
 *
 * document.addEventListener(
 *   'pagehide',
 *   pauseTrack
 * );
 *
 *
 * Karena itu akan membuat:
 *
 * Lock screen
 *     ↓
 * document.hidden
 *     ↓
 * pauseTrack()
 *     ↓
 * MUSIK MATI
 *
 *
 * Yang benar:
 *
 * Lock screen
 *     ↓
 * website masuk background
 *     ↓
 * player TIDAK dipause oleh JS
 *     ↓
 * Media Session tetap aktif
 *     ↓
 * browser/OS menangani playback
 *
 */


/* ============================================================
   END APP.JS
   ============================================================ */
