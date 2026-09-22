'use strict';
const $ = id => document.getElementById(id);
const audio = $('audio');
const canvas = $('wave');
const ctx = canvas.getContext('2d');
let tracks = [], current = -1, peaks = null, advanceTimer = null;
let generation = 0, loading = false, wantsPlay = false;
// Retain only the current and next compressed files, not the entire library.
const downloads = new Map();
const duration = () => Number.isFinite(audio.duration) ? audio.duration : 0;
const formatTime = n => `${Math.floor(n / 60)}:${String(Math.floor(n % 60)).padStart(2, '0')}`;
function cancelAdvance() { clearTimeout(advanceTimer); advanceTimer = null; }
function draw() {
  const w = canvas.width, h = canvas.height, progress = duration() ? audio.currentTime / duration() : 0;
  ctx.clearRect(0, 0, w, h);
  const columns = Math.max(1, Math.floor(w / (3 * devicePixelRatio)));
  for (let i = 0; i < columns; i++) {
    let peak = 0, rms = 0, count = 0;
    if (peaks) {
      const start = Math.floor(i * peaks.length / columns);
      const end = Math.max(start + 1, Math.floor((i + 1) * peaks.length / columns));
      for (let j = start; j < end && j < peaks.length; j++) {
        peak = Math.max(peak, peaks[j][0]); rms += peaks[j][1]; count++;
      }
    }
    rms /= count || 1;
    const x = i * w / columns, width = Math.max(1, w / columns - devicePixelRatio);
    ctx.fillStyle = i / columns < progress ? '#22e0ff' : '#245968';
    const ph = Math.max(1, peak * h * .45);
    ctx.fillRect(x, h / 2 - ph, width, ph * 2);
    ctx.fillStyle = i / columns < progress ? '#9cefff' : '#388799';
    const rh = Math.max(1, rms * h * .45);
    ctx.fillRect(x, h / 2 - rh, width, rh * 2);
  }
  ctx.fillStyle = '#e6eef5';
  ctx.fillRect(progress * (w - 2), 0, 2, h);
}
function updateTime() {
  $('elapsed').textContent = formatTime(audio.currentTime || 0);
  $('duration').textContent = formatTime(duration());
  $('seek').value = duration() ? audio.currentTime / duration() * 1000 : 0;
  $('seek').disabled = !duration();
  $('seek').setAttribute('aria-valuetext', `${formatTime(audio.currentTime || 0)} of ${formatTime(duration())}`);
  draw();
}
function renderPlaylist() {
  $('tracks').replaceChildren();
  tracks.forEach((track, index) => {
    const li = document.createElement('li'), button = document.createElement('button');
    button.setAttribute('aria-current', String(index === current));
    for (const [className, text] of [['track-number', String(index + 1).padStart(2, '0')], ['track-name', track.name], ['format', track.name.split('.').pop().toUpperCase()]]) {
      const span = document.createElement('span'); span.className = className; span.textContent = text; button.append(span);
    }
    button.onclick = () => selectTrack(index, true);
    li.append(button); $('tracks').append(li);
  });
  $('count').textContent = `${tracks.length} track${tracks.length === 1 ? '' : 's'}`;
  $('empty').hidden = tracks.length > 0;
  $('play').disabled = current < 0;
  $('previous').disabled = current <= 0;
  $('next').disabled = current < 0 || current >= tracks.length - 1;
}
function pruneDownloads() {
  const keep = new Set([tracks[current]?.url, tracks[current + 1]?.url]);
  for (const [url, entry] of downloads) {
    if (keep.has(url)) continue;
    entry.controller.abort();
    if (entry.objectURL) URL.revokeObjectURL(entry.objectURL);
    downloads.delete(url);
  }
}
function getDownload(track) {
  if (downloads.has(track.url)) return downloads.get(track.url);
  const entry = {controller: new AbortController(), blob: null, objectURL: null, waveform: null};
  downloads.set(track.url, entry);
  entry.ready = (async () => {
    const response = await fetch(track.url, {signal: entry.controller.signal});
    if (!response.ok) throw new Error('Could not download audio');
    const total = Number(response.headers.get('Content-Length'));
    const reader = response.body.getReader();
    const chunks = [];
    let received = 0;
    while (true) {
      const {done, value} = await reader.read();
      if (done) break;
      chunks.push(value); received += value.byteLength;
      if (tracks[current]?.url === track.url && loading) {
        const progress = total ? `${Math.floor(received / total * 100)}%` : `${(received / 1048576).toFixed(1)} MB`;
        $('status').textContent = `Downloading audio… ${progress}`;
      }
    }
    if (!received) throw new Error('Empty audio file');
    entry.blob = new Blob(chunks, {type: response.headers.get('Content-Type') || 'application/octet-stream'});
    return entry;
  })().catch(error => {
    if (downloads.get(track.url) === entry) downloads.delete(track.url);
    throw error;
  });
  return entry;
}
function prefetchNext() {
  const track = tracks[current + 1];
  if (track) getDownload(track).ready.catch(() => {}); // Retry on selection if a prefetch failed.
}
async function loadWaveform(entry, token) {
  try {
    if (!entry.waveform) {
      // Decode the SAME downloaded Blob used for playback. An offline context
      // needs no audio output/device permission or running AudioContext.
      const OfflineContext = window.OfflineAudioContext || window.webkitOfflineAudioContext;
      const decoder = new OfflineContext(1, 1, 22050);
      const buffer = await decoder.decodeAudioData(await entry.blob.arrayBuffer());
      if (token !== generation) return;
      const channels = Array.from({length: buffer.numberOfChannels}, (_, i) => buffer.getChannelData(i));
      const bucketSize = Math.max(1, Math.ceil(buffer.length / 2400));
      const result = [];
      for (let start = 0; start < buffer.length; start += bucketSize) {
        let peak = 0, sum = 0, n = 0;
        for (const channel of channels) {
          for (let i = start; i < Math.min(start + bucketSize, buffer.length); i++) {
            peak = Math.max(peak, Math.abs(channel[i])); sum += channel[i] * channel[i]; n++;
          }
        }
        result.push([peak, Math.sqrt(sum / n)]);
        // Let touch controls and painting run while reducing a long track.
        if (result.length % 200 === 0) {
          await new Promise(resolve => setTimeout(resolve, 0));
          if (token !== generation) return;
        }
      }
      entry.waveform = result;
      // The full decoded PCM buffer can now be garbage-collected.
    }
    if (token !== generation) return;
    peaks = entry.waveform;
    $('wave-status').textContent = 'Click or drag the waveform to seek.';
    draw();
  } catch (error) {
    if (token === generation) {
      console.warn('Waveform decoding failed:', error);
      $('wave-status').textContent = 'Waveform unavailable in this browser. The timeline still works.';
    }
  }
}
async function play() {
  cancelAdvance();
  wantsPlay = true;
  if (loading) { $('play').textContent = 'Pause'; return; }
  const token = generation;
  try { await audio.play(); }
  catch (error) {
    if (token === generation && error.name !== 'AbortError') {
      wantsPlay = false; $('play').textContent = 'Play';
      $('status').textContent = 'Playback could not start. Press Play to retry, or choose another track.';
    }
  }
}
async function selectTrack(index, autoplay) {
  if (index < 0 || index >= tracks.length) return;
  cancelAdvance();
  // Reselecting a loaded song reuses its Blob and waveform without downloading.
  if (index === current && audio.getAttribute('src')) {
    audio.currentTime = 0;
    if (autoplay) play();
    return;
  }
  const token = ++generation;
  audio.pause(); audio.removeAttribute('src'); audio.load();
  current = index; peaks = null; loading = true; wantsPlay = autoplay;
  pruneDownloads();
  $('title').textContent = tracks[index].name;
  $('position').textContent = `TRACK ${index + 1} OF ${tracks.length}`;
  $('status').textContent = 'Preparing audio for download…';
  $('wave-status').textContent = 'Waveform will appear after the download.';
  $('play').textContent = wantsPlay ? 'Pause' : 'Play';
  renderPlaylist(); updateTime();
  try {
    const entry = await getDownload(tracks[index]).ready;
    if (token !== generation) return;
    entry.objectURL ||= URL.createObjectURL(entry.blob);
    audio.src = entry.objectURL;
    loading = false;
    $('status').textContent = 'Loaded into memory. Ready to play.';
    $('wave-status').textContent = 'Drawing waveform…';
    loadWaveform(entry, token);
    if (wantsPlay) play();
    prefetchNext();
  } catch (error) {
    if (token !== generation || error.name === 'AbortError') return;
    loading = false; wantsPlay = false; $('play').textContent = 'Retry';
    $('status').textContent = 'Download failed. Press Retry; check the connection and server log.';
    $('wave-status').textContent = '';
  }
}
$('play').onclick = () => {
  if (advanceTimer !== null) {
    cancelAdvance(); wantsPlay = false; $('play').textContent = 'Play'; $('status').textContent = 'Paused between tracks.';
  } else if (loading) {
    wantsPlay = !wantsPlay; $('play').textContent = wantsPlay ? 'Pause' : 'Play';
  } else if (!audio.getAttribute('src')) selectTrack(current, true);
  else if (audio.paused) play();
  else { wantsPlay = false; audio.pause(); }
};
$('previous').onclick = () => selectTrack(current - 1, true);
$('next').onclick = () => selectTrack(current + 1, true);
$('volume').oninput = e => { audio.volume = Number(e.target.value); };
$('seek').oninput = e => { cancelAdvance(); if (duration()) audio.currentTime = Number(e.target.value) / 1000 * duration(); updateTime(); };
document.addEventListener('keydown', event => {
  if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return;
  if (event.target.isContentEditable || event.target.closest('input:not([type="range"]), textarea, select')) return;
  if (current < 0 || (event.key !== ' ' && event.key !== '0')) return;
  // Prevent scrolling or a focused button's native Space activation.
  event.preventDefault();
  if (event.repeat) return;
  if (event.key === ' ') $('play').click();
  else if (duration()) {
    cancelAdvance();
    audio.currentTime = 0;
    $('play').textContent = audio.paused ? 'Play' : 'Pause';
    if (audio.paused) $('status').textContent = 'Ready to play.';
    updateTime();
  }
});
audio.addEventListener('play', () => { $('play').textContent = 'Pause'; });
audio.addEventListener('pause', () => { if (!loading) $('play').textContent = 'Play'; });
audio.addEventListener('waiting', () => { if (!audio.paused) $('status').textContent = 'Buffering audio…'; });
audio.addEventListener('playing', () => { $('status').textContent = 'Playing from memory.'; });
for (const event of ['timeupdate', 'loadedmetadata', 'durationchange', 'emptied']) audio.addEventListener(event, updateTime);
audio.addEventListener('error', () => { cancelAdvance(); $('status').textContent = 'Cannot play this file. Check the server log or select another track.'; });
audio.addEventListener('ended', () => {
  if (current < tracks.length - 1) {
    $('status').textContent = 'Next track in 1 second…'; $('play').textContent = 'Pause';
    advanceTimer = setTimeout(() => selectTrack(current + 1, true), 1000);
  } else { $('status').textContent = 'End of playlist.'; }
});
new ResizeObserver(() => {
  canvas.width = Math.round(canvas.clientWidth * devicePixelRatio);
  canvas.height = Math.round(canvas.clientHeight * devicePixelRatio); draw();
}).observe(canvas);
async function refresh() {
  $('refresh').disabled = true;
  try {
    const response = await fetch('/api/tracks');
    if (!response.ok) throw new Error('Library unavailable');
    const nextTracks = await response.json();
    const selectedURL = tracks[current]?.url;
    cancelAdvance();
    tracks = nextTracks;
    current = tracks.findIndex(track => track.url === selectedURL);
    if (current < 0 && tracks.length) selectTrack(0, false);
    else if (current < 0) {
      generation++; loading = false; wantsPlay = false; audio.pause(); audio.removeAttribute('src'); audio.load(); peaks = null; pruneDownloads();
      $('title').textContent = 'Your music, right here.'; $('position').textContent = 'NOW PLAYING';
      $('status').textContent = 'Your library is empty.'; $('wave-status').textContent = ''; updateTime();
    } else {
      $('position').textContent = `TRACK ${current + 1} OF ${tracks.length}`;
      $('play').textContent = (loading ? wantsPlay : !audio.paused) ? 'Pause' : 'Play';
      pruneDownloads();
      if (!loading) prefetchNext();
    }
    renderPlaylist();
  } catch { $('status').textContent = 'Could not load the library. Try refreshing.'; }
  finally { $('refresh').disabled = false; }
}
$('refresh').onclick = refresh;
refresh();
