import assert from 'node:assert/strict';

const base = process.argv[2];
assert(base, 'Pass the test server URL');
const debugURL = process.env.CHROME_DEBUG_URL || 'http://127.0.0.1:9227';
const version = await (await fetch(`${debugURL}/json/version`)).json();
const ws = new WebSocket(version.webSocketDebuggerUrl);
await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
let nextID = 0;
const pending = new Map(), requests = [], errors = [];
ws.onmessage = event => {
  const message = JSON.parse(event.data);
  if (message.id) {
    const item = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) item.reject(new Error(JSON.stringify(message.error)));
    else item.resolve(message.result);
  } else if (message.method === 'Network.requestWillBeSent' && /^https?:/.test(message.params.request.url)) {
    requests.push(message.params.request.url);
  } else if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails);
};
function send(method, params = {}, sessionId) {
  return new Promise((resolve, reject) => {
    const id = ++nextID; pending.set(id, {resolve, reject});
    ws.send(JSON.stringify({id, method, params, sessionId}));
  });
}
const {targetId} = await send('Target.createTarget', {url: 'about:blank'});
const {sessionId} = await send('Target.attachToTarget', {targetId, flatten: true});
const page = (method, params) => send(method, params, sessionId);
async function run(expression) {
  const result = await page('Runtime.evaluate', {expression, awaitPromise: true, returnByValue: true, userGesture: true});
  if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
  return result.result.value;
}
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(expression, timeout = 20000) {
  const start = Date.now();
  while (!await run(expression)) {
    if (Date.now() - start > timeout) throw new Error(`Timed out: ${expression}; ${await run("$('status').textContent + ' / ' + $('wave-status').textContent")}`);
    await sleep(100);
  }
}
const audioRequests = () => requests.filter(url => /\/(stream|audio)\//.test(url));
try {
  await page('Runtime.enable');
  await page('Network.enable');
  await page('Network.setCacheDisabled', {cacheDisabled: true});
  await page('Emulation.setDeviceMetricsOverride', {width: 800, height: 1280, deviceScaleFactor: 2, mobile: true});
  await page('Page.addScriptToEvaluateOnNewDocument', {source: `window.AudioContext = class { constructor() { throw new Error('Realtime AudioContext must not be used'); } };`});
  await page('Network.emulateNetworkConditions', {offline: false, latency: 60, downloadThroughput: process.env.SMS_BROWSER_SAMPLE ? -1 : 64000, uploadThroughput: 64000});
  await page('Page.navigate', {url: base});
  await until('typeof tracks !== "undefined" && tracks.length === 3 && loading');
  // Clicking play then pause during download must not cause surprise playback.
  await run("$('play').click(); $('play').click()");
  await until('!loading && peaks?.length > 0');
  assert(await run('audio.paused && audio.src.startsWith("blob:")'));
  assert(await run('peaks.some(([peak]) => peak > .1)'), 'Waveform should contain real samples');
  await until('downloads.get(tracks[1].url)?.blob');
  assert.equal(audioRequests().length, 2, 'Exactly one download each for current and next');
  const firstURLs = await run('tracks.slice(0,2).map(t => t.url)');
  for (const url of firstURLs) assert.equal(audioRequests().filter(request => request === base + url).length, 1);

  // Playback, seeking, peaks, and advancing into the prefetched track work offline.
  await page('Network.emulateNetworkConditions', {offline: true, latency: 0, downloadThroughput: 0, uploadThroughput: 0});
  await run("$('play').click()");
  await until('!audio.paused && audio.currentTime > .2');
  await run("$('seek').value = 500; $('seek').dispatchEvent(new Event('input'))");
  assert(await run('Math.abs(audio.currentTime - audio.duration / 2) < 1'));
  await run('audio.currentTime = audio.duration - .1');
  await until('advanceTimer !== null', 3000);
  assert.equal(await run('current'), 0);
  await sleep(450);
  assert.equal(await run('current'), 0, 'Must retain the one-second gap');
  await until('current === 1 && !loading && !audio.paused && peaks?.length > 0', 5000);
  assert.equal(audioRequests().filter(url => url === base + firstURLs[1]).length, 1, 'Prefetched track must not download again');
  await run('audio.pause()');

  // Resume networking, fetch the final track, and verify final playlist stop.
  await page('Network.emulateNetworkConditions', {offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1});
  await run('selectTrack(2, true)');
  await until('current === 2 && !loading && !audio.paused && peaks?.length > 0');
  await run('audio.currentTime = audio.duration - .1');
  await until("audio.paused && $('status').textContent === 'End of playlist.'");
  assert.equal(await run('advanceTimer'), null);
  assert(await run('downloads.size <= 2'), 'Client must release old files');

  // Rapid switching must neither revive an old load nor keep stale downloads.
  await page('Network.emulateNetworkConditions', {offline: false, latency: 100, downloadThroughput: 32000, uploadThroughput: 32000});
  await run('selectTrack(0, true); selectTrack(2, false)');
  await until('current === 2 && !loading && peaks?.length > 0');
  assert(await run('audio.paused && downloads.size <= 2'));
  await page('Network.emulateNetworkConditions', {offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1});
  // A failed foreground download exposes Retry and recovers without reloading the page.
  await page('Network.setBlockedURLs', {urls: ['*01-first.wav*']});
  await run('selectTrack(0, true)');
  await until("!loading && $('play').textContent === 'Retry'");
  await page('Network.setBlockedURLs', {urls: []});
  await run("$('play').click()");
  await until('current === 0 && !loading && !audio.paused && peaks?.length > 0');
  await run('audio.pause()');
  assert.deepEqual(errors, [], 'No uncaught browser errors');
  console.log('PASS: one download per track, shared Blob waveform/playback, mobile layout, no realtime AudioContext, offline seeking/playback/advance, one-second gap, prefetch reuse, final stop, cancelled loads, bounded client cache.');
} finally {
  await send('Target.closeTarget', {targetId});
  ws.close();
}
