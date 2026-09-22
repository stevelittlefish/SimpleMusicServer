# SimpleMusicServer

Drop music into a folder and listen to it on another device over your local network.

I made this so I can put the results of my AI slop music generation experiments in a folder on my computer, then listen to them on a tablet in the kitchen while I make dinner. The computer handles the files; the tablet supplies the soundtrack to whatever is happening to the onions.

The backend is Go using only the standard library. The frontend is HTML, CSS and plain JavaScript, with a custom waveform player. FFmpeg compresses large audio files for easier listening over Wi-Fi.

## Built with AI

Built with **GPT 6 Astra**, using about **50% of a 5-hour usage limit**. From the initial commit to the completed application, README and licence, this took **53 minutes 29 seconds of wall-clock time** on 21 September 2026.

## Get it running

You need **Go 1.22 or later** and **FFmpeg** on the computer serving the music. FFmpeg must be on your PATH and include its usual MP3 encoder. On Debian/Ubuntu, install it with `sudo apt install ffmpeg`.

```sh
git clone https://github.com/stevelittlefish/SimpleMusicServer.git
cd SimpleMusicServer
mkdir -p data
```

Copy your music into `data/`, then start the server:

```sh
./run.sh
```

The server also creates `data/` automatically if it doesn't exist. Leave it running while you listen; press **Ctrl+C** in that terminal to stop it.

## Listen in the kitchen

1. Connect the tablet to the same local network as the computer.
2. Open `http://<computer-ip>:6069` in the tablet's browser. For example, if the computer's local IP address is `192.168.1.42`, open `http://192.168.1.42:6069`.
3. Tap a track in the playlist. The first load may take a moment while it is compressed and downloaded.
4. Make dinner. The next track starts automatically after a one-second pause.

On the computer itself, open [http://localhost:6069](http://localhost:6069). On the tablet, use the **computer's IP address**, since `localhost` would mean the tablet itself. On Linux, `hostname -I` can help you find the computer's local IP address.

The server listens on **0.0.0.0:6069**, making it accessible over your network. If the tablet cannot reach it, check that the computer is still running the server and that its firewall allows TCP port 6069.

## Add music and use the player

Supported files: **WAV, OGG, MP3, FLAC and Opus**. Subfolders and uppercase extensions work too.

```text
data/
  suspiciously-catchy.wav
  another-experiment.flac
  dinner-mix/
    definitely-a-song.mp3
```

- Add or remove files, then tap **Refresh library**. There's no need to restart the server.
- The playlist runs in filename order. Use prefixes such as `01-`, `02-`, etc. if you want a particular order.
- Tap any track to select it. Use **Play/Pause**, **Previous**, **Next**, and the volume slider to control playback.
- Press **Space** to play/pause or **0** to seek to the start of the current track.
- Tap or drag the waveform to skip around. With a keyboard, focus the timeline and use the arrow keys, Home or End.
- Playback stops after the final track.

The whole `data/` folder and all supported audio file extensions are gitignored, so your experimental back catalogue stays out of the repository.

## How playback works

Large WAV and FLAC files are converted to **192 kbps stereo MP3** on the server. The originals stay untouched. MP3, OGG and Opus files are served as they are.

Converted files are saved in `data/.cache/` and reused, including after a server restart. Changing a source file causes a fresh conversion on its next request. You can delete the cache to reclaim space; it will be rebuilt as needed.

The tablet downloads the **entire selected file once** and uses that same in-memory copy for both playback and waveform generation. Once the download finishes, playback and seeking no longer depend on the connection keeping up. Download progress is shown in the player.

The next track downloads in the background, ready for the one-second transition. If it isn't ready in time, playback waits for its download to finish. Only the current and next files are retained in the player's memory; returning to an older track may require another download.

The first listen takes longer because of conversion and downloading. A 48 kHz, 32-bit stereo WAV becomes roughly 16 times smaller at 192 kbps. Waveforms are decoded at a lower sample rate to reduce memory use, and the decoded samples are released once the peaks are calculated. Very long files can still take time and memory to process; the timeline remains usable if waveform decoding fails.

The waveform's cyan peak-and-RMS design was inspired by the edit-page players in [the_sing_thing](https://git.seaslug.io/steve/the_sing_thing).

## Development

```sh
go test ./...
go test -race ./...
go build -o simplemusicserver .
```

The HTML, CSS and JavaScript are embedded in the executable. FFmpeg is still needed at runtime. The data folder is relative to the working directory; `run.sh` switches to the project root automatically. Restart the server after changing the code or frontend assets.

Optional browser checks need Node 22+ and a Chrome-family browser started with `--remote-debugging-port=9227`:

```sh
SMS_BROWSER_TEST=1 go test -run TestBrowserPlayback -v
```

They use a temporary library to check throttled downloads, waveform generation, offline playback and seeking, playlist transitions, retries, and track switching. Set `SMS_BROWSER_SAMPLE=/absolute/path/to/file.wav` to test a copy of a real WAV at normal network speed.

## Licence

Released under the **DO WHAT THE FUCK YOU WANT TO PUBLIC LICENSE, Version 2**. See [LICENCE](LICENCE) for the complete, highly serious corporate legal framework, obviously carefully designed by a crack team of lawyers.
