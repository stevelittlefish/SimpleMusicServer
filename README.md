# SimpleMusicServer

A tiny music player: Go standard library backend, HTML/CSS and plain JavaScript frontend. No Go or JavaScript dependencies, build tools, accounts or configuration. **FFmpeg** is the only external runtime dependency.

Requires Go 1.22+ and `ffmpeg` (with the usual MP3 encoder) on your PATH. For example, on Debian/Ubuntu: `sudo apt install ffmpeg`.

```sh
./run.sh
```

Put music in `data/` (created automatically). Open **http://localhost:6069**, or **http://<server-ip>:6069** from another device. The server binds to `0.0.0.0:6069`.

- WAV, OGG, MP3, FLAC and Opus files, including subfolders and uppercase extensions.
- Click **Refresh library** after adding or removing files. Tracks sort by filename.
- Select a track, play/pause, adjust volume, or click/drag the waveform to seek. The waveform also supports keyboard seeking with arrow keys, Home and End.
- Playback advances after a one-second gap and stops after the last track. Previous/next buttons switch immediately; a track that hasn't downloaded yet waits until it is ready.
- All audio files and the entire `data/` folder are gitignored.

## Playback and caching

The server converts WAV and FLAC files to **192 kbps stereo MP3** on first request and caches the result in `data/.cache/`. Originals are never modified. MP3, OGG and Opus files are served as-is. Updated source files get new cache URLs automatically; old cache files can be deleted whenever you want to reclaim disk space. The `.cache` directory never appears in the playlist.

The client downloads each selected track **once in full**, keeps it as a Blob, and uses that same Blob for both audio playback and waveform decoding. The player shows download progress before starting. Once loaded, playback and seeking don't need the network. The next track downloads in the background after the current file is loaded, ready for the one-second transition. Only the current and next files are retained; revisiting an older track may require another download (or use the browser's HTTP cache).

Waveforms use a lower sample rate in an offline audio context to reduce memory use and avoid needing a running audio context. Decoded PCM is released after the small peak/RMS envelope is built. Very long files can still take time and memory to decode; playback remains available if waveform decoding fails. The cyan peak/RMS design is inspired by the edit-page widgets in [the_sing_thing](https://git.seaslug.io/steve/the_sing_thing).

First playback can take longer while the server compresses a file and the client downloads it. Later playback reuses the server's cached MP3. For the 48 kHz, 32-bit stereo WAV format, the download is roughly 16 times smaller.

Run `go test ./...` for HTTP and transcoding/cache checks (transcoding tests use FFmpeg). `go test -race ./...` checks concurrent requests. Static assets are embedded: `go build -o simplemusicserver .` produces an executable that still needs FFmpeg available at runtime. The data folder is relative to the working directory; `run.sh` switches to the project root automatically.

Optional browser regression checks use Node 22+ and a Chrome-family browser started with `--remote-debugging-port=9227`:

```sh
SMS_BROWSER_TEST=1 go test -run TestBrowserPlayback -v
```

These checks use a temporary library and cover a throttled connection, single downloads, waveform decoding, offline playback/seeking, playlist transitions, failed-download retries, and track-switch cancellation. Set `SMS_BROWSER_SAMPLE=/absolute/path/to/file.wav` to additionally test a copy of a real WAV at normal network speed.
