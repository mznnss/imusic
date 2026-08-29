/* ============================================================
   NATIVE AUDIO STREAM
   ============================================================ */

app.get('/api/stream', async (req, res) => {

  const videoId = String(
    req.query.videoId || ''
  ).trim();

  if (!videoId) {
    return res.status(400).json({
      error: 'videoId is required'
    });
  }

  if (!/^[A-Za-z0-9_-]{11}$/.test(videoId)) {
    return res.status(400).json({
      error: 'Invalid YouTube video ID'
    });
  }

  try {

    const youtubeUrl =
      `https://www.youtube.com/watch?v=${videoId}`;

    console.log(
      `[STREAM] Request: ${videoId}`
    );

    /*
     * Ambil informasi video.
     */
    const info = await ytdl.getInfo(
      youtubeUrl
    );

    /*
     * Pilih audio-only.
     */
    let format;

    try {

      format = ytdl.chooseFormat(
        info.formats,
        {
          quality: 'highestaudio',
          filter: 'audioonly'
        }
      );

    } catch (error) {

      console.warn(
        '[STREAM] chooseFormat failed:',
        error.message
      );

      const audioFormats =
        ytdl.filterFormats(
          info.formats,
          'audioonly'
        );

      audioFormats.sort(
        (a, b) =>
          Number(
            b.audioBitrate || 0
          ) -
          Number(
            a.audioBitrate || 0
          )
      );

      format =
        audioFormats[0];
    }

    if (
      !format ||
      !format.url
    ) {

      throw new Error(
        'Audio format tidak ditemukan'
      );

    }

    /*
     * URL audio YouTube.
     */
    const audioUrl =
      format.url;

    /*
     * Ambil Range dari browser.
     */
    const range =
      req.headers.range;

    /*
     * Header request ke YouTube.
     */
    const headers = {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/151.0 Safari/537.36',

      'Accept':
        '*/*'
    };

    if (range) {

      headers.Range =
        range;

    }

    /*
     * Request audio ke YouTube.
     */
    const upstream =
      await fetch(
        audioUrl,
        {
          method: 'GET',
          headers
        }
      );

    if (
      !upstream.ok &&
      upstream.status !== 206
    ) {

      throw new Error(
        `YouTube returned ${upstream.status}`
      );

    }

    /*
     * Content type.
     */
    const contentType =
      upstream.headers.get(
        'content-type'
      ) ||
      format.mimeType?.split(';')[0] ||
      'audio/webm';

    /*
     * Content length.
     */
    const contentLength =
      upstream.headers.get(
        'content-length'
      );

    /*
     * Content range.
     */
    const contentRange =
      upstream.headers.get(
        'content-range'
      );

    /*
     * Browser boleh melakukan seek.
     */
    res.setHeader(
      'Accept-Ranges',
      'bytes'
    );

    res.setHeader(
      'Content-Type',
      contentType
    );

    res.setHeader(
      'Cache-Control',
      'no-cache, no-store, must-revalidate'
    );

    res.setHeader(
      'Pragma',
      'no-cache'
    );

    res.setHeader(
      'Expires',
      '0'
    );

    /*
     * CORS.
     */
    res.setHeader(
      'Access-Control-Allow-Origin',
      '*'
    );

    res.setHeader(
      'Access-Control-Expose-Headers',
      'Content-Length, Content-Range, Accept-Ranges'
    );

    /*
     * Forward Content-Length.
     */
    if (contentLength) {

      res.setHeader(
        'Content-Length',
        contentLength
      );

    }

    /*
     * Forward Content-Range.
     */
    if (contentRange) {

      res.setHeader(
        'Content-Range',
        contentRange
      );

    }

    /*
     * Status.
     */
    res.status(
      upstream.status === 206
        ? 206
        : 200
    );

    /*
     * Stream body.
     */
    if (
      upstream.body
    ) {

      const reader =
        upstream.body.getReader();

      /*
       * Kalau browser menutup
       * koneksi, hentikan stream.
       */
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

        if (done) {
          break;
        }

        if (value) {

          res.write(
            Buffer.from(
              value
            )
          );

        }

      }

    }

    res.end();

  } catch (error) {

    console.error(
      '[STREAM ERROR]',
      error
    );

    if (
      !res.headersSent
    ) {

      res.status(500).json({
        error:
          'Gagal mengambil audio YouTube',

        message:
          error.message
      });

    } else {

      try {
        res.end();
      } catch {}

    }

  }

});
