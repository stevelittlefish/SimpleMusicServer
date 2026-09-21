# SimpleMusicServer

A tiny music streamer: Go standard library backend, HTML/CSS and plain JavaScript frontend. No dependencies, build tools, accounts or configuration.

```sh
go run .
```

Put music in `data/` (created automatically). Open **http://localhost:6069**, or **http://<server-ip>:6069** from another device. The server binds to `0.0.0.0:6069`.

- WAV, OGG, MP3, FLAC and Opus files, including subfolders and uppercase extensions.
- Click **Refresh library** after adding or removing files. Tracks sort by filename.
- Select a track, play/pause, adjust volume, or click/drag the waveform to seek. The waveform also supports keyboard seeking with arrow keys, Home and End.
- Playback advances after a one-second gap and stops after the last track. Previous/next buttons switch immediately.
- Audio streams with HTTP range support. All audio files and the entire `data/` folder are gitignored.

The custom cyan peak/RMS player is inspired by the edit-page widgets in [the_sing_thing](https://git.seaslug.io/steve/the_sing_thing). The browser downloads and decodes the selected file separately to draw its waveform; playback can start before the waveform is ready. Large tracks need more browser memory. Codec playback and waveform decoding depend on browser support; there is no transcoding or FFmpeg dependency.

Requires Go 1.22 or later. Run `go test ./...` to check the HTTP endpoints and range serving. Static assets are embedded, so `go build -o simplemusicserver .` produces a standalone executable. The data folder is relative to the working directory.
