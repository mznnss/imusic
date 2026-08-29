/* ============================================================
   IMusic - Backend
   YouTube Music API + Native Audio Streaming
   ============================================================ */

const express = require('express');
const path = require('path');
const ytdl = require('@distube/ytdl-core');

const app = express();

const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: '2mb' }));

app.use(
  express.static(
    path.join(__dirname, 'public')
  )
);


/* ============================================================
   YOUTUBE MUSIC
   ============================================================ */

const YTM =
  'https://music.youtube.com/youtubei/v1';

const CONTEXT = {
  client: {
    clientName: 'WEB_REMIX',
    clientVersion: '1.20240101.00.00',
    hl: 'id',
    gl: 'ID'
  }
};

const HEADERS = {
  'Content-Type':
    'application/json',

  Origin:
    'https://music.youtube.com',

  Referer:
    'https://music.youtube.com/',

  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0 Safari/537.36'
};


/* ============================================================
   YOUTUBE REQUEST
   ============================================================ */

async function yt(
  endpoint,
  body = {},
  query = ''
) {

  const response =
    await fetch(
      `${YTM}/${endpoint}?prettyPrint=false${query}`,
      {
        method: 'POST',

        headers: HEADERS,

        body: JSON.stringify({
          context: CONTEXT,
          ...body
        })
      }
    );

  if (!response.ok) {

    throw new Error(
      `YTM ${endpoint} -> ${response.status}`
    );

  }

  return response.json();
}


/* ============================================================
   DEEP HELPERS
   ============================================================ */

function findAll(
  obj,
  key,
  out = []
) {

  if (
    !obj ||
    typeof obj !== 'object'
  ) {
    return out;
  }

  if (
    Array.isArray(obj)
  ) {

    for (
      const value of obj
    ) {

      findAll(
        value,
        key,
        out
      );

    }

    return out;
  }

  for (
    const currentKey of Object.keys(obj)
  ) {

    if (
      currentKey === key
    ) {

      out.push(
        obj[currentKey]
      );

    }

    findAll(
      obj[currentKey],
      key,
      out
    );
  }

  return out;
}


const findFirst =
  (
    obj,
    key
  ) =>
    findAll(
      obj,
      key
    )[0];


function text(o) {

  if (
    o &&
    o.runs
  ) {

    return o.runs
      .map(
        r => r.text
      )
      .join('');

  }

  return (
    o &&
    o.simpleText
  ) || '';
}


function normalizeDuration(
  value
) {

  const valueString =
    String(
      value || ''
    ).trim();

  if (
    /^\d{1,2}(\.\d{2}){1,2}$/.test(
      valueString
    )
  ) {

    return valueString
      .replace(
        /\./g,
        ':'
      );

  }

  return valueString;
}


function runsInfo(o) {

  const output = [];

  if (
    !o ||
    !o.runs
  ) {

    return output;

  }

  for (
    const run of o.runs
  ) {

    const browseEndpoint =
      run.navigationEndpoint &&
      run.navigationEndpoint
        .browseEndpoint;

    if (
      browseEndpoint
    ) {

      output.push({
        name:
          run.text,

        browseId:
          browseEndpoint.browseId
      });

    }
  }

  return output;
}


/* ============================================================
   THUMBNAILS
   ============================================================ */

function upscale(
  url
) {

  if (!url) {
    return url;
  }

  if (
    url.includes(
      'googleusercontent.com'
    )
  ) {

    return url.replace(
      /=w\d+-h\d+.*$/,
      '=w544-h544-l90-rj'
    );

  }

  return url;
}


function thumbs(o) {

  const thumbnails =
    findAll(
      o,
      'thumbnails'
    )
      .flat()
      .filter(
        x =>
          x &&
          x.url
      );

  if (
    !thumbnails.length
  ) {

    return null;

  }

  const best =
    thumbnails.reduce(
      (
        a,
        b
      ) =>
        (
          b.width || 0
        ) >=
        (
          a.width || 0
        )
          ? b
          : a
    );

  return upscale(
    best.url
  );
}


/* ============================================================
   ENDPOINT INFO
   ============================================================ */

function endpointInfo(
  nav
) {

  if (!nav) {
    return {};
  }

  const watchEndpoint =
    nav.watchEndpoint;

  const browseEndpoint =
    nav.browseEndpoint;

  const watchPlaylistEndpoint =
    nav.watchPlaylistEndpoint;


  if (
    watchEndpoint
  ) {

    return {
      videoId:
        watchEndpoint.videoId,

      playlistId:
        watchEndpoint.playlistId
    };

  }


  if (
    watchPlaylistEndpoint
  ) {

    return {
      playlistId:
        watchPlaylistEndpoint.playlistId,

      watchPlaylist:
        true
    };

  }


  if (
    browseEndpoint
  ) {

    const id =
      browseEndpoint.browseId;

    let type =
      'browse';


    if (
      id.startsWith(
        'MPRE'
      )
    ) {

      type =
        'album';

    } else if (
      id.startsWith(
        'UC'
      ) ||
      id.startsWith(
        'MPLA'
      )
    ) {

      type =
        'artist';

    } else if (
      id.startsWith(
        'VL'
      ) ||
      id.startsWith(
        'PL'
      ) ||
      id.startsWith(
        'RDCLAK'
      )
    ) {

      type =
        'playlist';

    }


    return {
      browseId:
        id,

      browseType:
        type
    };

  }


  return {};
}


/* ============================================================
   TWO ROW PARSER
   ============================================================ */

function parseTwoRow(
  renderer
) {

  const nav =
    renderer.navigationEndpoint ||
    {};

  let info =
    endpointInfo(
      nav
    );


  if (
    !info.browseId &&
    renderer.title &&
    renderer.title.runs
  ) {

    const titleNav =
      renderer
        .title
        .runs[0]
        ?.navigationEndpoint;

    const extra =
      endpointInfo(
        titleNav || {}
      );

    if (
      extra.browseId
    ) {

      info = {
        ...info,
        ...extra
      };

    }

  }


  let type =
    'song';


  if (
    info.browseType ===
      'album' ||

    info.browseType ===
      'playlist' ||

    info.browseType ===
      'artist'
  ) {

    type =
      info.browseType;

  } else if (
    info.videoId
  ) {

    type =
      'song';

  } else if (
    info.playlistId ||
    info.watchPlaylist
  ) {

    type =
      'playlist';

  }


  const item = {

    type,

    title:
      text(
        renderer.title
      ),

    subtitle:
      text(
        renderer.subtitle
      ),

    thumbnail:
      thumbs(
        renderer.thumbnailRenderer
      ),

    artists:
      runsInfo(
        renderer.subtitle
      ),

    ...info

  };


  if (
    renderer.thumbnailRenderer &&
    findFirst(
      renderer,
      'musicThumbnailRenderer'
    )
  ) {

    const style =
      findFirst(
        renderer,
        'musicThumbnailRenderer'
      ).thumbnailCrop;


    if (
      style ===
      'MUSIC_THUMBNAIL_CROP_CIRCLE'
    ) {

      item.type =
        'artist';

    }

  }


  return item;
}


/* ============================================================
   LIST ITEM PARSER
   ============================================================ */

function parseListItem(
  renderer
) {

  const columns =
    (
      renderer.flexColumns ||
      []
    ).map(
      column =>
        column
          .musicResponsiveListItemFlexColumnRenderer
          ? column
              .musicResponsiveListItemFlexColumnRenderer
              .text
          : null
    );


  const title =
    columns[0]
      ? text(
          columns[0]
        )
      : '';


  const subtitle =
    columns
      .slice(1)
      .map(
        column =>
          text(column)
      )
      .filter(Boolean)
      .join(' • ');


  let videoId =
    null;


  if (
    renderer.playlistItemData
  ) {

    videoId =
      renderer
        .playlistItemData
        .videoId;

  }


  if (
    !videoId &&
    columns[0] &&
    columns[0].runs
  ) {

    const watchEndpoint =
      columns[0]
        .runs[0]
        ?.navigationEndpoint
        ?.watchEndpoint;


    if (
      watchEndpoint
    ) {

      videoId =
        watchEndpoint.videoId;

    }

  }


  if (
    !videoId
  ) {

    const watchEndpoint =
      findFirst(
        renderer.overlay || {},
        'watchEndpoint'
      );

    if (
      watchEndpoint
    ) {

      videoId =
        watchEndpoint.videoId;

    }

  }


  const navInfo =
    endpointInfo(
      renderer.navigationEndpoint
    );


  const artists =
    [];

  const albums =
    [];


  for (
    const column of
      columns.slice(1)
  ) {

    for (
      const entry of
        runsInfo(column)
    ) {

      if (
        entry.browseId &&
        entry.browseId.startsWith(
          'MPRE'
        )
      ) {

        albums.push(
          entry
        );

      } else {

        artists.push(
          entry
        );

      }

    }

  }


  let type =
    videoId
      ? 'song'
      : (
          navInfo.browseType ||
          'song'
        );


  const item = {

    type,

    title,

    subtitle,

    videoId,

    thumbnail:
      thumbs(
        renderer.thumbnail
      ),

    artists,

    album:
      albums[0] ||
      null,

    ...navInfo

  };


  const fixed =
    findFirst(
      renderer,
      'musicResponsiveListItemFixedColumnRenderer'
    );


  if (
    fixed
  ) {

    item.duration =
      normalizeDuration(
        text(
          fixed.text
        )
      );

  }


  return item;
}


/* ============================================================
   SECTIONS
   ============================================================ */

function parseSections(
  contents
) {

  const sections =
    [];


  for (
    const section of
      contents || []
  ) {

    const carousel =
      section
        .musicCarouselShelfRenderer;

    const shelf =
      section
        .musicShelfRenderer;


    if (
      carousel
    ) {

      const header =
        findFirst(
          carousel.header || {},
          'title'
        );


      const items =
        (
          carousel.contents ||
          []
        )
          .map(
            content => {

              if (
                content
                  .musicTwoRowItemRenderer
              ) {

                return parseTwoRow(
                  content
                    .musicTwoRowItemRenderer
                );

              }


              if (
                content
                  .musicResponsiveListItemRenderer
              ) {

                return parseListItem(
                  content
                    .musicResponsiveListItemRenderer
                );

              }


              return null;

            }
          )
          .filter(
            item =>
              item &&
              item.title
          );


      if (
        items.length
      ) {

        sections.push({

          title:
            text(
              header
            ),

          items

        });

      }


    } else if (
      shelf
    ) {

      const items =
        (
          shelf.contents ||
          []
        )
          .map(
            content =>
              content
                .musicResponsiveListItemRenderer
                ? parseListItem(
                    content
                      .musicResponsiveListItemRenderer
                  )
                : null
          )
          .filter(
            item =>
              item &&
              item.title
          );


      if (
        items.length
      ) {

        sections.push({

          title:
            text(
              shelf.title
            ),

          items,

          list:
            true

        });

      }

    }

  }


  return sections;
}


/* ============================================================
   CACHE
   ============================================================ */

const cache =
  new Map();


function cached(
  key,
  ttlMs,
  fn
) {

  const hit =
    cache.get(
      key
    );


  if (
    hit &&
    Date.now() -
      hit.t <
      ttlMs
  ) {

    return Promise.resolve(
      hit.v
    );

  }


  return fn()
    .then(
      value => {

        cache.set(
          key,
          {
            v:
              value,

            t:
              Date.now()
          }
        );

        return value;

      }
    );

}


/* ============================================================
   NATIVE AUDIO STREAM
   ============================================================ */

/*
 * Browser tidak diarahkan langsung ke URL YouTube.
 *
 * Browser:
 *
 *     <audio>
 *         ↓
 *     /api/stream
 *         ↓
 *     server
 *         ↓
 *     YouTube
 *
 * Keuntungannya:
 *
 * - HTML5 Audio
 * - Range request
 * - seek
 * - Media Session
 * - background playback
 * - lock-screen controls
 */

app.get(
  '/api/stream',
  async (
    req,
    res
  ) => {

    const videoId =
      String(
        req.query.videoId ||
        ''
      ).trim();


    if (
      !videoId ||
      !/^[A-Za-z0-9_-]{11}$/.test(
        videoId
      )
    ) {

      return res
        .status(400)
        .send(
          'Invalid videoId'
        );

    }


    const hq =
      req.query.hq === '1';


    const rangeHeader =
      String(
        req.headers.range ||
        ''
      ).trim();


    const rangeMatch =
      rangeHeader.match(
        /^bytes=(\d*)-(\d*)$/i
      );


    try {

      const youtubeUrl =
        `https://www.youtube.com/watch?v=${videoId}`;


      /*
       * Get information about the video.
       */

      const info =
        await ytdl.getInfo(
          youtubeUrl,
          {
            playerClients: [
              'WEB_EMBEDDED',
              'IOS',
              'ANDROID',
              'TV'
            ]
          }
        );


      /*
       * Select audio-only format.
       */

      let format;


      try {

        format =
          ytdl.chooseFormat(
            info.formats,
            {
              filter:
                'audioonly',

              quality:
                hq
                  ? 'highestaudio'
                  : 'lowestaudio'
            }
          );

      } catch {

        const audioFormats =
          ytdl
            .filterFormats(
              info.formats,
              'audioonly'
            )
            .filter(
              format =>
                format &&
                format.url
            );


        audioFormats.sort(
          (
            a,
            b
          ) =>
            Number(
              b.audioBitrate ||
              0
            ) -
            Number(
              a.audioBitrate ||
              0
            )
        );


        format =
          audioFormats[
            hq
              ? 0
              : Math.max(
                  0,
                  audioFormats.length -
                    1
                )
          ];

      }


      if (
        !format ||
        !format.url
      ) {

        throw new Error(
          'No playable audio format found'
        );

      }


      const total =
        Number(
          format.contentLength ||
          0
        );


      let start;
      let end;


      /*
       * Handle HTTP Range.
       */

      if (
        rangeMatch &&
        total > 0
      ) {

        const rawStart =
          rangeMatch[1];

        const rawEnd =
          rangeMatch[2];


        if (
          rawStart === ''
        ) {

          const suffix =
            Number(
              rawEnd
            );


          if (
            Number.isFinite(
              suffix
            ) &&
            suffix > 0
          ) {

            start =
              Math.max(
                0,
                total -
                  suffix
              );

            end =
              total - 1;

          }

        } else {

          start =
            Number(
              rawStart
            );

          end =
            rawEnd === ''
              ? total - 1
              : Number(
                  rawEnd
                );

        }


        if (
          !Number.isFinite(
            start
          ) ||
          start < 0
        ) {

          start =
            0;

        }


        if (
          !Number.isFinite(
            end
          ) ||
          end >= total
        ) {

          end =
            total - 1;

        }


        if (
          start >
            end ||
          start >= total
        ) {

          res.status(
            416
          );

          res.setHeader(
            'Content-Range',
            `bytes */${total}`
          );

          return res.end();

        }

      }


      const upstreamHeaders = {

        'User-Agent':
          HEADERS[
            'User-Agent'
          ],

        Accept:
          '*/*'

      };


      if (
        start !==
          undefined &&
        end !==
          undefined
      ) {

        upstreamHeaders.Range =
          `bytes=${start}-${end}`;

      }


      /*
       * Fetch audio from YouTube.
       */

      const upstream =
        await fetch(
          format.url,
          {
            headers:
              upstreamHeaders
          }
        );


      if (
        !upstream.ok &&
        upstream.status !==
          206
      ) {

        throw new Error(
          `YouTube audio -> ${upstream.status}`
        );

      }


      const contentType =
        upstream.headers.get(
          'content-type'
        ) ||
        (
          format.mimeType
            ? format
                .mimeType
                .split(';')[0]
            : 'audio/webm'
        );


      const upstreamLength =
        Number(
          upstream.headers.get(
            'content-length'
          ) || 0
        );


      /*
       * Response headers.
       */

      res.status(
        start !== undefined
          ? 206
          : 200
      );


      res.setHeader(
        'Content-Type',
        contentType
      );


      res.setHeader(
        'Accept-Ranges',
        'bytes'
      );


      res.setHeader(
        'Cache-Control',
        'private, no-store, max-age=0'
      );


      res.setHeader(
        'Cross-Origin-Resource-Policy',
        'cross-origin'
      );


      res.setHeader(
        'Access-Control-Allow-Origin',
        '*'
      );


      if (
        start !==
          undefined &&
        end !==
          undefined &&
        total > 0
      ) {

        res.setHeader(
          'Content-Range',
          `bytes ${start}-${end}/${total}`
        );


        res.setHeader(
          'Content-Length',
          String(
            upstreamLength ||
            (
              end -
              start +
              1
            )
          )
        );

      } else if (
        upstreamLength > 0
      ) {

        res.setHeader(
          'Content-Length',
          String(
            upstreamLength
          )
        );

      } else if (
        total > 0
      ) {

        res.setHeader(
          'Content-Length',
          String(
            total
          )
        );

      }


      /*
       * Stream body to browser.
       */

      if (
        upstream.body
      ) {

        const reader =
          upstream.body.getReader();


        req.on(
          'close',
          () => {

            try {

              reader.cancel();

            } catch {}

          }
        );


        while (true) {

          const {
            done,
            value
          } =
            await reader.read();


          if (
            done
          ) {

            break;

          }


          if (
            value
          ) {

            res.write(
              Buffer.from(
                value
              )
            );

          }

        }

      }


      res.end();


    } catch (
      error
    ) {

      console.error(
        'Audio proxy stream error:',
        error.message
      );


      if (
        !res.headersSent
      ) {

        res
          .status(502)
          .json({
            error:
              error.message
          });

      } else {

        try {
          res.end();
        } catch {}

      }

    }

  }
);


/* ============================================================
   CORS / PREFLIGHT
   ============================================================ */

app.options(
  '/api/stream',
  (
    req,
    res
  ) => {

    res.setHeader(
      'Access-Control-Allow-Origin',
      '*'
    );

    res.setHeader(
      'Access-Control-Allow-Headers',
      'Range, Content-Type'
    );

    res.setHeader(
      'Access-Control-Allow-Methods',
      'GET, OPTIONS'
    );

    res.setHeader(
      'Access-Control-Expose-Headers',
      'Content-Length, Content-Range, Accept-Ranges'
    );

    res.status(204).end();

  }
);
/* ============================================================
   SEARCH
   ============================================================ */

app.get(
  '/api/search',
  async (
    req,
    res
  ) => {

    const query =
      String(
        req.query.q ||
        ''
      ).trim();


    if (!query) {

      return res.json({
        results: []
      });

    }


    try {

      const data =
        await cached(
          `search:${query}`,
          60 * 1000,
          async () => {

            const result =
              await yt(
                'search',
                {
                  query
                }
              );


            const sections =
              parseSections(
                result.contents ||
                []
              );


            const results =
              [];


            for (
              const section of
                sections
            ) {

              for (
                const item of
                  section.items
              ) {

                results.push({
                  ...item,

                  thumbnail:
                    item.thumbnail ||
                    null
                });

              }

            }


            /*
             * Remove duplicates
             */

            const unique =
              [];


            const seen =
              new Set();


            for (
              const item of
                results
            ) {

              const key =
                item.videoId ||
                `${item.type}:${item.title}`;


              if (
                seen.has(key)
              ) {

                continue;

              }


              seen.add(key);

              unique.push(
                item
              );

            }


            return unique;

          }
        );


      res.json({
        results:
          data
      });


    } catch (
      error
    ) {

      console.error(
        'Search error:',
        error
      );


      res
        .status(500)
        .json({
          error:
            error.message,

          results: []
        });

    }

  }
);


/* ============================================================
   HOME
   ============================================================ */

app.get(
  '/api/home',
  async (
    req,
    res
  ) => {

    try {

      const data =
        await cached(
          'home',
          2 * 60 * 1000,
          async () => {

            const result =
              await yt(
                'browse',
                {
                  browseId:
                    'FEmusic_home'
                }
              );


            const contents =
              findFirst(
                result,
                'contents'
              );


            return {
              sections:
                parseSections(
                  contents || []
                )
            };

          }
        );


      res.json(
        data
      );


    } catch (
      error
    ) {

      console.error(
        'Home error:',
        error
      );


      res
        .status(500)
        .json({
          error:
            error.message
        });

    }

  }
);


/* ============================================================
   BROWSE
   ============================================================ */

app.get(
  '/api/browse',
  async (
    req,
    res
  ) => {

    const browseId =
      String(
        req.query.id ||
        req.query.browseId ||
        ''
      ).trim();


    if (!browseId) {

      return res
        .status(400)
        .json({
          error:
            'browseId is required'
        });

    }


    try {

      const result =
        await yt(
          'browse',
          {
            browseId
          }
        );


      const contents =
        findFirst(
          result,
          'contents'
        );


      const sections =
        parseSections(
          contents || []
        );


      res.json({

        browseId,

        sections

      });


    } catch (
      error
    ) {

      console.error(
        'Browse error:',
        error
      );


      res
        .status(500)
        .json({
          error:
            error.message
        });

    }

  }
);


/* ============================================================
   PLAYLIST
   ============================================================ */

app.get(
  '/api/playlist',
  async (
    req,
    res
  ) => {

    const playlistId =
      String(
        req.query.id ||
        req.query.playlistId ||
        ''
      ).trim();


    if (!playlistId) {

      return res
        .status(400)
        .json({
          error:
            'playlistId is required'
        });

    }


    try {

      const result =
        await yt(
          'browse',
          {
            browseId:
              playlistId
          }
        );


      const contents =
        findFirst(
          result,
          'contents'
        );


      const sections =
        parseSections(
          contents || []
        );


      const tracks =
        [];


      for (
        const section of
          sections
      ) {

        for (
          const item of
            section.items
        ) {

          if (
            item.videoId
          ) {

            tracks.push(
              item
            );

          }

        }

      }


      res.json({

        playlistId,

        sections,

        tracks

      });


    } catch (
      error
    ) {

      console.error(
        'Playlist error:',
        error
      );


      res
        .status(500)
        .json({
          error:
            error.message
        });

    }

  }
);


/* ============================================================
   RELATED / NEXT
   ============================================================ */

app.get(
  '/api/related',
  async (
    req,
    res
  ) => {

    const videoId =
      String(
        req.query.videoId ||
        ''
      ).trim();


    if (!videoId) {

      return res
        .status(400)
        .json({
          error:
            'videoId is required'
        });

    }


    try {

      const result =
        await yt(
          'next',
          {
            videoId
          }
        );


      const contents =
        findFirst(
          result,
          'contents'
        );


      const sections =
        parseSections(
          contents || []
        );


      const tracks =
        [];


      for (
        const section of
          sections
      ) {

        for (
          const item of
            section.items
        ) {

          if (
            item.videoId
          ) {

            tracks.push(
              item
            );

          }

        }

      }


      res.json({

        videoId,

        sections,

        tracks

      });


    } catch (
      error
    ) {

      console.error(
        'Related error:',
        error
      );


      res
        .status(500)
        .json({
          error:
            error.message,

          tracks: []
        });

    }

  }
);


/* ============================================================
   NEXT TRACK
   ============================================================ */

app.get(
  '/api/next',
  async (
    req,
    res
  ) => {

    const videoId =
      String(
        req.query.videoId ||
        ''
      ).trim();


    if (!videoId) {

      return res
        .status(400)
        .json({
          error:
            'videoId is required'
        });

    }


    try {

      const result =
        await yt(
          'next',
          {
            videoId
          }
        );


      const contents =
        findFirst(
          result,
          'contents'
        );


      const sections =
        parseSections(
          contents || []
        );


      const tracks =
        [];


      for (
        const section of
          sections
      ) {

        for (
          const item of
            section.items
        ) {

          if (
            item.videoId
          ) {

            tracks.push(
              item
            );

          }

        }

      }


      res.json({
        tracks
      });


    } catch (
      error
    ) {

      console.error(
        'Next error:',
        error
      );


      res
        .status(500)
        .json({
          error:
            error.message,

          tracks: []
        });

    }

  }
);


/* ============================================================
   LYRICS
   ============================================================ */

app.get(
  '/api/lyrics',
  async (
    req,
    res
  ) => {

    const videoId =
      String(
        req.query.videoId ||
        ''
      ).trim();


    if (!videoId) {

      return res
        .status(400)
        .json({
          error:
            'videoId is required'
        });

    }


    try {

      const result =
        await yt(
          'next',
          {
            videoId
          }
        );


      const tabs =
        findAll(
          result,
          'tabs'
        )
          .flat();


      let lyricsBrowseId =
        null;


      for (
        const tab of
          tabs
      ) {

        const endpoint =
          findFirst(
            tab,
            'browseEndpoint'
          );


        if (
          endpoint &&
          endpoint.browseId
        ) {

          const id =
            endpoint.browseId;


          if (
            String(id)
              .toLowerCase()
              .includes(
                'lyrics'
              )
          ) {

            lyricsBrowseId =
              id;

            break;

          }

        }

      }


      if (
        !lyricsBrowseId
      ) {

        return res.json({
          lyrics: null
        });

      }


      const lyricsResult =
        await yt(
          'browse',
          {
            browseId:
              lyricsBrowseId
          }
        );


      const lyricText =
        findFirst(
          lyricsResult,
          'description'
        );


      res.json({

        lyrics:
          text(
            lyricText
          ) || null

      });


    } catch (
      error
    ) {

      console.error(
        'Lyrics error:',
        error
      );


      res.json({
        lyrics: null
      });

    }

  }
);


/* ============================================================
   RESOLVE VIDEO
   ============================================================ */

app.get(
  '/api/resolve',
  async (
    req,
    res
  ) => {

    const videoId =
      String(
        req.query.videoId ||
        ''
      ).trim();


    if (!videoId) {

      return res
        .status(400)
        .json({
          error:
            'videoId is required'
        });

    }


    try {

      const info =
        await ytdl.getInfo(
          `https://www.youtube.com/watch?v=${videoId}`
        );


      const details =
        info.videoDetails;


      res.json({

        videoId,

        title:
          details.title,

        author:
          details.author?.name ||
          '',

        duration:
          Number(
            details.lengthSeconds ||
            0
          ),

        thumbnail:
          details.thumbnails?.length
            ? details.thumbnails[
                details.thumbnails.length -
                1
              ].url
            : null

      });


    } catch (
      error
    ) {

      console.error(
        'Resolve error:',
        error
      );


      res
        .status(500)
        .json({
          error:
            error.message
        });

    }

  }
);


/* ============================================================
   HEALTH CHECK
   ============================================================ */

app.get(
  '/api/health',
  (
    req,
    res
  ) => {

    res.json({

      ok: true,

      service:
        'imusic',

      player:
        'native-audio',

      streaming:
        true,

      mediaSession:
        true,

      time:
        new Date()
          .toISOString()

    });

  }
);


/* ============================================================
   SPA FALLBACK
   ============================================================ */

app.get(
  '*',
  (
    req,
    res
  ) => {

    /*
     * Jangan intercept API
     */

    if (
      req.path.startsWith(
        '/api/'
      )
    ) {

      return res
        .status(404)
        .json({
          error:
            'API endpoint not found'
        });

    }


    res.sendFile(
      path.join(
        __dirname,
        'public',
        'index.html'
      )
    );

  }
);


/* ============================================================
   ERROR HANDLER
   ============================================================ */

app.use(
  (
    error,
    req,
    res,
    next
  ) => {

    console.error(
      'Unhandled server error:',
      error
    );


    if (
      res.headersSent
    ) {

      return next(
        error
      );

    }


    res
      .status(
        error.status || 500
      )
      .json({

        error:
          error.message ||
          'Internal server error'

      });

  }
);


/* ============================================================
   START SERVER
   ============================================================ */

app.listen(
  PORT,
  () => {

    console.log(
      '======================================'
    );

    console.log(
      ' IMusic server running'
    );

    console.log(
      ` Port: ${PORT}`
    );

    console.log(
      ` URL: http://localhost:${PORT}`
    );

    console.log(
      ' Player: Native HTML5 Audio'
    );

    console.log(
      ' Media Session: Enabled'
    );

    console.log(
      ' Background playback: Enabled'
    );

    console.log(
      '======================================'
    );

  }
);
/* ============================================================
   IMUSIC - NATIVE AUDIO PLAYER
   PART 3
   ============================================================ */

'use strict';


/* ============================================================
   PLAYER STATE
   ============================================================ */

const Player = {

  /*
   Native HTML5 Audio
   */
  audio: null,

  /*
   Lagu yang sedang diputar
   */
  current: null,

  /*
   Queue
   */
  queue: [],

  queueIndex: -1,

  /*
   State
   */
  playing: false,

  loading: false,

  currentTime: 0,

  duration: 0,

  volume: 1,

  muted: false,

  /*
   Playback mode
   */
  shuffle: false,

  repeat: 'off',

  /*
   Stream
   */
  streamUrl: '',

  streamRetryCount: 0,

  streamRetryTimer: null,

  /*
   Prevent duplicate events
   */
  changingTrack: false,

  /*
   Prevent automatic next when
   user manually changes track
   */
  manualStop: false

};


/* ============================================================
   CREATE NATIVE AUDIO
   ============================================================ */

function initNativeAudio() {

  /*
   Jangan membuat audio element lebih dari sekali.
   */

  if (
    Player.audio
  ) {

    return Player.audio;

  }


  const audio =
    new Audio();


  audio.preload =
    'auto';


  /*
   Sangat penting untuk background playback.
   */

  audio.controls =
    false;


  /*
   Jangan menggunakan autoplay.
   Playback harus dimulai
   dari interaksi user.
   */

  audio.autoplay =
    false;


  /*
   Cross origin jika server
   berbeda domain.
   */

  audio.crossOrigin =
    'anonymous';


  /*
   Simpan ke Player.
   */

  Player.audio =
    audio;


  /*
   Event listeners
   */

  bindNativeAudioEvents(
    audio
  );


  /*
   Restore volume.
   */

  try {

    const savedVolume =
      localStorage.getItem(
        'imusic_volume'
      );


    if (
      savedVolume !== null
    ) {

      const volume =
        Number(
          savedVolume
        );


      if (
        Number.isFinite(volume)
      ) {

        Player.volume =
          Math.max(
            0,
            Math.min(
              1,
              volume
            )
          );

      }

    }

  } catch {}


  audio.volume =
    Player.volume;


  /*
   Media Session
   */

  initMediaSession();


  console.log(
    '[IMusic] Native Audio initialized'
  );


  return audio;
}


/* ============================================================
   AUDIO EVENTS
   ============================================================ */

function bindNativeAudioEvents(
  audio
) {

  audio.addEventListener(
    'loadstart',
    () => {

      Player.loading =
        true;

      updateLoadingUI(
        true
      );

    }
  );


  audio.addEventListener(
    'loadedmetadata',
    () => {

      Player.loading =
        false;

      Player.duration =
        Number(
          audio.duration
        ) || 0;


      updateDurationUI();


      updateLoadingUI(
        false
      );

    }
  );


  audio.addEventListener(
    'canplay',
    () => {

      Player.loading =
        false;

      updateLoadingUI(
        false
      );

    }
  );


  audio.addEventListener(
    'play',
    () => {

      Player.playing =
        true;

      Player.loading =
        false;


      updatePlayButtons(
        true
      );


      updateLoadingUI(
        false
      );


      updateMediaSessionPlaybackState(
        'playing'
      );


      persistPlayerState();

    }
  );


  audio.addEventListener(
    'playing',
    () => {

      Player.playing =
        true;

      Player.loading =
        false;


      updatePlayButtons(
        true
      );


      updateMediaSessionPlaybackState(
        'playing'
      );

    }
  );


  audio.addEventListener(
    'pause',
    () => {

      Player.playing =
        false;


      updatePlayButtons(
        false
      );


      updateMediaSessionPlaybackState(
        'paused'
      );


      persistPlayerState();

    }
  );


  audio.addEventListener(
    'timeupdate',
    () => {

      Player.currentTime =
        Number(
          audio.currentTime
        ) || 0;


      if (
        Number.isFinite(
          audio.duration
        )
      ) {

        Player.duration =
          audio.duration;

      }


      updateProgressUI();

    }
  );


  audio.addEventListener(
    'durationchange',
    () => {

      if (
        Number.isFinite(
          audio.duration
        )
      ) {

        Player.duration =
          audio.duration;

      }


      updateDurationUI();

    }
  );


  audio.addEventListener(
    'volumechange',
    () => {

      Player.volume =
        audio.volume;

      Player.muted =
        audio.muted;


      updateVolumeUI();


      try {

        localStorage.setItem(
          'imusic_volume',
          String(
            audio.volume
          )
        );

      } catch {}

    }
  );


  audio.addEventListener(
    'waiting',
    () => {

      Player.loading =
        true;


      updateLoadingUI(
        true
      );

    }
  );


  audio.addEventListener(
    'stalled',
    () => {

      console.warn(
        '[IMusic] Audio stalled'
      );

    }
  );


  audio.addEventListener(
    'ended',
    () => {

      Player.playing =
        false;


      updatePlayButtons(
        false
      );


      updateMediaSessionPlaybackState(
        'none'
      );


      handleTrackEnded();

    }
  );


  audio.addEventListener(
    'error',
    event => {

      console.error(
        '[IMusic] Audio error:',
        event
      );


      Player.loading =
        false;


      updateLoadingUI(
        false
      );


      handleAudioError();

    }
  );

}


/* ============================================================
   PLAY TRACK
   ============================================================ */

async function playTrack(
  track,
  options = {}
) {

  /*
   Normalize track.
   */

  if (
    typeof normalizeTrack ===
    'function'
  ) {

    track =
      normalizeTrack(
        track
      );

  }


  if (
    !track ||
    !track.videoId
  ) {

    toast(
      'Lagu tidak valid.',
      'error'
    );

    return false;

  }


  const audio =
    initNativeAudio();


  /*
   Queue index.
   */

  if (
    Number.isInteger(
      options.queueIndex
    )
  ) {

    Player.queueIndex =
      options.queueIndex;

  } else {

    const index =
      Player.queue.findIndex(
        item =>
          item &&
          item.videoId ===
          track.videoId
      );


    if (
      index >= 0
    ) {

      Player.queueIndex =
        index;

    }

  }


  /*
   Set current track.
   */

  Player.current =
    track;


  Player.currentTime =
    0;

  Player.duration =
    0;

  Player.loading =
    true;

  Player.changingTrack =
    true;

  Player.manualStop =
    true;


  updatePlayerUI();

  updateLoadingUI(
    true
  );


  /*
   Stop current audio.
   */

  try {

    audio.pause();

  } catch {}


  /*
   Clear old source.
   */

  try {

    audio.removeAttribute(
      'src'
    );

    audio.load();

  } catch {}


  /*
   Build native stream URL.
   */

  const baseUrl =
    getStreamUrl(
      track.videoId
    );


  Player.streamUrl =
    baseUrl;


  /*
   Media Session metadata
   harus di-update SEBELUM playback.
   */

  updateMediaSessionMetadata(
    track
  );


  /*
   Set source.
   */

  audio.src =
    baseUrl;


  audio.preload =
    'auto';


  /*
   Load audio.
   */

  audio.load();


  Player.changingTrack =
    false;


  /*
   PENTING:
   play() dipanggil melalui
   user interaction.
   */

  try {

    const playPromise =
      audio.play();


    if (
      playPromise &&
      typeof playPromise.then ===
      'function'
    ) {

      await playPromise;

    }


    Player.playing =
      true;

    Player.loading =
      false;


    updatePlayButtons(
      true
    );


    updateMediaSessionPlaybackState(
      'playing'
    );


    persistPlayerState();


    /*
     * Save queue.
     */

    if (
      typeof saveQueue ===
      'function'
    ) {

      saveQueue();

    }


    if (
      typeof renderQueue ===
      'function'
    ) {

      renderQueue();

    }


    return true;

  } catch (
    error
  ) {

    console.error(
      '[IMusic] play() failed:',
      error
    );


    Player.playing =
      false;

    Player.loading =
      false;


    updatePlayButtons(
      false
    );


    updateLoadingUI(
      false
    );


    /*
     * Autoplay/user gesture
     * biasanya menghasilkan
     * NotAllowedError.
     */

    if (
      error.name ===
      'NotAllowedError'
    ) {

      toast(
        'Browser memblokir playback. Tekan Play sekali lagi.',
        'error'
      );

    } else {

      toast(
        'Gagal memutar lagu.',
        'error'
      );

    }


    return false;

  }

}


/* ============================================================
   GET STREAM URL
   ============================================================ */

function getStreamUrl(
  videoId
) {

  const params =
    new URLSearchParams();


  params.set(
    'videoId',
    videoId
  );


  /*
   Cache busting tidak digunakan
   setiap saat karena dapat
   mengganggu browser cache.
   */

  return `/api/stream?${params.toString()}`;

}


/* ============================================================
   PAUSE
   ============================================================ */

function pauseTrack() {

  const audio =
    Player.audio;


  if (
    !audio
  ) {

    return;

  }


  try {

    audio.pause();

    Player.playing =
      false;


    updatePlayButtons(
      false
    );


    updateMediaSessionPlaybackState(
      'paused'
    );


    persistPlayerState();

  } catch (
    error
  ) {

    console.error(
      '[IMusic] pause error:',
      error
    );

  }

}


/* ============================================================
   TOGGLE PLAY
   ============================================================ */

async function togglePlay() {

  const audio =
    initNativeAudio();


  /*
   Sedang bermain
   */

  if (
    !audio.paused
  ) {

    pauseTrack();

    return;

  }


  /*
   Belum ada current track.
   */

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


      await playTrack(
        Player.queue[index],
        {
          queueIndex:
            index
        }
      );

    }


    return;

  }


  /*
   Track yang sama masih
   berada di audio element.
   Resume langsung.
   */

  if (
    audio.src &&
    Player.streamUrl &&
    audio.src.includes(
      Player.current.videoId
    )
  ) {

    try {

      await audio.play();

      Player.playing =
        true;


      updatePlayButtons(
        true
      );


      updateMediaSessionPlaybackState(
        'playing'
      );


      return;

    } catch (
      error
    ) {

      console.warn(
        '[IMusic] Resume failed:',
        error
      );

    }

  }


  /*
   Jika source sudah hilang,
   load ulang track.
   */

  await playTrack(
    Player.current
  );

}


/* ============================================================
   SEEK
   ============================================================ */

function seekTo(
  seconds
) {

  const audio =
    Player.audio;


  if (
    !audio
  ) {

    return;

  }


  if (
    !Number.isFinite(
      seconds
    )
  ) {

    return;

  }


  if (
    !Number.isFinite(
      audio.duration
    )
  ) {

    return;

  }


  const target =
    Math.max(
      0,
      Math.min(
        audio.duration,
        seconds
      )
    );


  try {

    audio.currentTime =
      target;


    Player.currentTime =
      target;


    updateProgressUI();

  } catch (
    error
  ) {

    console.warn(
      '[IMusic] Seek failed:',
      error
    );

  }

}


/* ============================================================
   SEEK BY PERCENT
   ============================================================ */

function seekPercent(
  percent
) {

  const audio =
    Player.audio;


  if (
    !audio ||
    !Number.isFinite(
      audio.duration
    )
  ) {

    return;

  }


  const value =
    Math.max(
      0,
      Math.min(
        100,
        Number(percent)
      )
    );


  seekTo(
    audio.duration *
    (
      value /
      100
    )
  );

}


/* ============================================================
   SET VOLUME
   ============================================================ */

function setVolume(
  value
) {

  const audio =
    initNativeAudio();


  let volume =
    Number(value);


  if (
    !Number.isFinite(
      volume
    )
  ) {

    return;

  }


  /*
   Support slider 0-100.
   */

  if (
    volume > 1
  ) {

    volume /=
      100;

  }


  volume =
    Math.max(
      0,
      Math.min(
        1,
        volume
      )
    );


  audio.volume =
    volume;


  if (
    volume > 0
  ) {

    audio.muted =
      false;

    Player.muted =
      false;

  }


  Player.volume =
    volume;


  try {

    localStorage.setItem(
      'imusic_volume',
      String(volume)
    );

  } catch {}


  updateVolumeUI();

}


/* ============================================================
   MUTE
   ============================================================ */

function toggleMute() {

  const audio =
    initNativeAudio();


  audio.muted =
    !audio.muted;


  Player.muted =
    audio.muted;


  updateVolumeUI();

}


/* ============================================================
   HANDLE TRACK END
   ============================================================ */

function handleTrackEnded() {

  Player.playing =
    false;


  /*
   Repeat one.
   */

  if (
    Player.repeat ===
    'one'
  ) {

    const audio =
      Player.audio;


    if (
      audio
    ) {

      audio.currentTime =
        0;


      audio.play()
        .catch(
          error =>
            console.warn(
              '[IMusic] Repeat failed:',
              error
            )
        );

    }


    return;

  }


  /*
   Repeat all / normal next.
   */

  nextTrack(
    {
      autoplay: true
    }
  );

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


  /*
   Shuffle.
   */

  if (
    Player.shuffle &&
    Player.queue.length > 1
  ) {

    const candidates =
      Player.queue
        .map(
          (
            _,
            index
          ) => index
        )
        .filter(
          index =>
            index !==
            Player.queueIndex
        );


    nextIndex =
      candidates[
        Math.floor(
          Math.random() *
          candidates.length
        )
      ];

  } else {

    nextIndex =
      Player.queueIndex +
      1;


    /*
     End of queue.
     */

    if (
      nextIndex >=
      Player.queue.length
    ) {

      if (
        Player.repeat ===
        'all'
      ) {

        nextIndex =
          0;

      } else {

        Player.playing =
          false;


        updatePlayButtons(
          false
        );


        return false;

      }

    }

  }


  const track =
    Player.queue[
      nextIndex
    ];


  if (
    !track
  ) {

    return false;

  }


  Player.queueIndex =
    nextIndex;


  return playTrack(
    track,
    {
      queueIndex:
        nextIndex
    }
  );

}


/* ============================================================
   PREVIOUS TRACK
   ============================================================ */

async function previousTrack() {

  const audio =
    Player.audio;


  /*
   Jika sudah lebih dari 3 detik,
   kembali ke awal lagu.
   */

  if (
    audio &&
    audio.currentTime >
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

    if (
      Player.repeat ===
      'all'
    ) {

      previousIndex =
        Player.queue.length -
        1;

    } else {

      previousIndex =
        0;

    }

  }


  const track =
    Player.queue[
      previousIndex
    ];


  if (
    !track
  ) {

    return false;

  }


  Player.queueIndex =
    previousIndex;


  return playTrack(
    track,
    {
      queueIndex:
        previousIndex
    }
  );

}


/* ============================================================
   REPEAT
   ============================================================ */

function setRepeatMode(
  mode
) {

  if (
    ![
      'off',
      'one',
      'all'
    ].includes(
      mode
    )
  ) {

    mode =
      'off';

  }


  Player.repeat =
    mode;


  try {

    localStorage.setItem(
      'imusic_repeat',
      mode
    );

  } catch {}


  updateRepeatUI();

}


/* ============================================================
   SHUFFLE
   ============================================================ */

function setShuffle(
  enabled
) {

  Player.shuffle =
    Boolean(
      enabled
    );


  try {

    localStorage.setItem(
      'imusic_shuffle',
      Player.shuffle
        ? '1'
        : '0'
    );

  } catch {}


  updateShuffleUI();

}
