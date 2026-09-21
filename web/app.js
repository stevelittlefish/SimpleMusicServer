'use strict';
const $ = id => document.getElementById(id);
const audio = $('audio');
const canvas = $('wave');
const ctx = canvas.getContext('2d');
let tracks = [], current = -1, peaks = null, advanceTimer = null;
let generation = 0, waveRequest = null, audioContext = null;
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
async function loadWaveform(track, token) {
  waveRequest = new AbortController();
  try {
    const response = await fetch(track.url, {signal: waveRequest.signal});
    if (!response.ok) throw new Error('Could not load audio');
    const bytes = await response.arrayBuffer();
    if (token !== generation) return;
    audioContext ||= new (window.AudioContext || window.webkitAudioContext)();
    const buffer = await audioContext.decodeAudioData(bytes);
    if (token !== generation) return;
    const channels = Array.from({length: buffer.numberOfChannels}, (_, i) => buffer.getChannelData(i));
    const bucketSize = Math.max(1, Math.ceil(buffer.length / 2400));
    peaks = [];
    for (let start = 0; start < buffer.length; start += bucketSize) {
      let peak = 0, sum = 0, n = 0;
      for (const channel of channels) {
        for (let i = start; i < Math.min(start + bucketSize, buffer.length); i++) {
          peak = Math.max(peak, Math.abs(channel[i])); sum += channel[i] * channel[i]; n++;
        }
      }
      peaks.push([peak, Math.sqrt(sum / n)]);
    }
    $('status').textContent = 'Click or drag the waveform to seek.';
    draw();
  } catch (error) {
    if (token === generation && error.name !== 'AbortError') $('status').textContent = 'Waveform unavailable in this browser. You can still seek using the timeline.';
  }
}
async function play() {
  cancelAdvance();
  const token = generation;
  try { await audio.play(); }
  catch (error) {
    if (token === generation && error.name !== 'AbortError') $('status').textContent = 'Playback could not start. Press Play to retry, or choose another track.';
  }
}
function selectTrack(index, autoplay) {
  if (index < 0 || index >= tracks.length) return;
  cancelAdvance(); waveRequest?.abort(); generation++;
  audio.pause(); current = index; peaks = null;
  audio.src = tracks[index].url;
  $('title').textContent = tracks[index].name;
  $('position').textContent = `TRACK ${index + 1} OF ${tracks.length}`;
  $('status').textContent = 'Loading waveform…';
  renderPlaylist(); updateTime();
  loadWaveform(tracks[index], generation);
  if (autoplay) play();
}
$('play').onclick = () => {
  if (advanceTimer !== null) { cancelAdvance(); $('play').textContent = 'Play'; $('status').textContent = 'Paused between tracks.'; }
  else if (audio.paused) play(); else audio.pause();
};
$('previous').onclick = () => selectTrack(current - 1, true);
$('next').onclick = () => selectTrack(current + 1, true);
$('volume').oninput = e => { audio.volume = Number(e.target.value); };
$('seek').oninput = e => { cancelAdvance(); if (duration()) audio.currentTime = Number(e.target.value) / 1000 * duration(); updateTime(); };
audio.addEventListener('play', () => { $('play').textContent = 'Pause'; });
audio.addEventListener('pause', () => { $('play').textContent = 'Play'; });
for (const event of ['timeupdate', 'loadedmetadata', 'durationchange', 'emptied']) audio.addEventListener(event, updateTime);
audio.addEventListener('error', () => { cancelAdvance(); $('status').textContent = 'Cannot play this file. Check browser codec support or select another track.'; });
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
      generation++; waveRequest?.abort(); audio.pause(); audio.removeAttribute('src'); audio.load(); peaks = null;
      $('title').textContent = 'Your music, right here.'; $('position').textContent = 'NOW PLAYING';
      $('status').textContent = 'Your library is empty.'; updateTime();
    } else {
      $('position').textContent = `TRACK ${current + 1} OF ${tracks.length}`;
      $('play').textContent = audio.paused ? 'Play' : 'Pause';
    }
    renderPlaylist();
  } catch { $('status').textContent = 'Could not load the library. Try refreshing.'; }
  finally { $('refresh').disabled = false; }
}
$('refresh').onclick = refresh;
refresh();
