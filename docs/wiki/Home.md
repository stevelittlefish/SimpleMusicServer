# SimpleMusicServer build notes

SimpleMusicServer was built to play the results of AI slop music generation experiments on a kitchen tablet while dinner is being made: drop files into a folder on the computer, open the player on the tablet, and listen.

## Model and usage

Built with **GPT 6 Astra**, using approximately **50% of a 5-hour usage limit**, as reported during the build.

## Wall-clock time

The initial build took **53 minutes 29 seconds** on **21 September 2026**. This is elapsed wall-clock time, including discussion, implementation, testing and documentation.

| Milestone | Time (BST, UTC+01:00) | Commit |
| --- | --- | --- |
| Start: initial repository commit | 21:45:09 | [bea1b21](https://github.com/stevelittlefish/SimpleMusicServer/commit/bea1b21) |
| First working streamer and waveform player | 21:59:53 | [e0c568e](https://github.com/stevelittlefish/SimpleMusicServer/commit/e0c568e) |
| Root launch script | 22:01:32 | [c9bbac8](https://github.com/stevelittlefish/SimpleMusicServer/commit/c9bbac8) |
| Compressed audio and shared in-memory playback/waveform data | 22:21:12 | [6d3a2cf](https://github.com/stevelittlefish/SimpleMusicServer/commit/6d3a2cf) |
| App documentation and licence complete | 22:38:38 | [b26c6e0](https://github.com/stevelittlefish/SimpleMusicServer/commit/b26c6e0) |

Calculated from the Git commit timestamps: **22:38:38 − 21:45:09 = 00:53:29**. The endpoint is the completed README/licence commit, before this retrospective timing note was requested. Author and committer timestamps agree for these commits.

The usage percentage describes consumption of the 5-hour allowance; it is separate from the elapsed build time.

See the [README](https://github.com/stevelittlefish/SimpleMusicServer#readme) for installation and usage, and the [LICENCE](https://github.com/stevelittlefish/SimpleMusicServer/blob/main/LICENCE) for the project's highly serious corporate legal framework.
