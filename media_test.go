package main

import (
	"bytes"
	"context"
	"encoding/binary"
	"encoding/json"
	"math"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"
)

// Match the large 48 kHz stereo float32 WAVs that exposed the tablet problem.
func writeTestWAV(t *testing.T, path string, seconds int) []byte {
	t.Helper()
	const rate = 48000
	samples := rate * seconds
	raw := make([]byte, 44+samples*8)
	copy(raw, "RIFF")
	binary.LittleEndian.PutUint32(raw[4:], uint32(len(raw)-8))
	copy(raw[8:], "WAVEfmt ")
	binary.LittleEndian.PutUint32(raw[16:], 16)
	binary.LittleEndian.PutUint16(raw[20:], 3)
	binary.LittleEndian.PutUint16(raw[22:], 2)
	binary.LittleEndian.PutUint32(raw[24:], rate)
	binary.LittleEndian.PutUint32(raw[28:], rate*8)
	binary.LittleEndian.PutUint16(raw[32:], 8)
	binary.LittleEndian.PutUint16(raw[34:], 32)
	copy(raw[36:], "data")
	binary.LittleEndian.PutUint32(raw[40:], uint32(samples*8))
	for i := 0; i < samples; i++ {
		sample := math.Float32bits(float32(.4 * math.Sin(float64(i)*440*2*math.Pi/rate)))
		binary.LittleEndian.PutUint32(raw[44+i*8:], sample)
		binary.LittleEndian.PutUint32(raw[48+i*8:], sample)
	}
	if err := os.WriteFile(path, raw, 0644); err != nil {
		t.Fatal(err)
	}
	return raw
}

func requireFFmpeg(t *testing.T) {
	t.Helper()
	if _, err := exec.LookPath("ffmpeg"); err != nil {
		t.Skip("FFmpeg not installed")
	}
}

func TestCompressedPlaybackAndCache(t *testing.T) {
	requireFFmpeg(t)
	data := t.TempDir()
	source := filepath.Join(data, "test # café.WAV")
	original := writeTestWAV(t, source, 3)
	h := handler(data)
	list := func() []track {
		t.Helper()
		w := httptest.NewRecorder()
		h.ServeHTTP(w, httptest.NewRequest("GET", "/api/tracks", nil))
		var tracks []track
		if err := json.Unmarshal(w.Body.Bytes(), &tracks); err != nil {
			t.Fatal(err)
		}
		return tracks
	}
	url := list()[0].URL
	responses := make([]*httptest.ResponseRecorder, 4)
	var wg sync.WaitGroup
	for i := range responses {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			w := httptest.NewRecorder()
			h.ServeHTTP(w, httptest.NewRequest("GET", url, nil))
			responses[i] = w
		}(i)
	}
	wg.Wait()
	for _, w := range responses {
		if w.Code != 200 || w.Header().Get("Content-Type") != "audio/mpeg" {
			t.Fatalf("compressed response: %d %s", w.Code, w.Body.String())
		}
		if w.Body.Len() >= len(original)/10 || w.Body.Len() < 1000 {
			t.Fatalf("unexpected compressed size %d, original %d", w.Body.Len(), len(original))
		}
		if !bytes.Equal(w.Body.Bytes(), responses[0].Body.Bytes()) {
			t.Fatal("concurrent requests received different files")
		}
		if !strings.Contains(w.Header().Get("Cache-Control"), "immutable") {
			t.Fatal("missing versioned cache policy")
		}
	}
	cached, err := filepath.Glob(filepath.Join(data, ".cache", "*.mp3"))
	if err != nil || len(cached) != 1 {
		t.Fatalf("expected one cached MP3: %v %v", cached, err)
	}
	info, _ := os.Stat(cached[0])
	// New handler simulates a server restart; it must reuse the on-disk result.
	h = handler(data)
	r := httptest.NewRequest("GET", url, nil)
	r.Header.Set("Range", "bytes=20-39")
	w := httptest.NewRecorder()
	h.ServeHTTP(w, r)
	if w.Code != 206 || !bytes.Equal(w.Body.Bytes(), responses[0].Body.Bytes()[20:40]) {
		t.Fatalf("compressed range: %d %q", w.Code, w.Body.Bytes())
	}
	after, _ := os.Stat(cached[0])
	if !info.ModTime().Equal(after.ModTime()) {
		t.Fatal("cached MP3 was regenerated")
	}
	w = httptest.NewRecorder()
	h.ServeHTTP(w, httptest.NewRequest("HEAD", url, nil))
	if w.Code != 200 || w.Body.Len() != 0 || w.Header().Get("Content-Length") == "" {
		t.Fatal("HEAD response must advertise complete length")
	}
	if tracks := list(); len(tracks) != 1 {
		t.Fatalf("cache leaked into library: %+v", tracks)
	}
	unchanged, _ := os.ReadFile(source)
	if !bytes.Equal(unchanged, original) {
		t.Fatal("source audio was changed")
	}
	future := time.Now().Add(time.Second)
	if err := os.Chtimes(source, future, future); err != nil {
		t.Fatal(err)
	}
	newURL := list()[0].URL
	if newURL == url {
		t.Fatal("source change did not invalidate client URL")
	}
	w = httptest.NewRecorder()
	h.ServeHTTP(w, httptest.NewRequest("GET", newURL, nil))
	if w.Code != 200 {
		t.Fatalf("regenerate changed source: %d", w.Code)
	}
	cached, _ = filepath.Glob(filepath.Join(data, ".cache", "*.mp3"))
	if len(cached) != 2 {
		t.Fatal("source change did not regenerate cached MP3")
	}
}

func TestFailedConversionCanRetry(t *testing.T) {
	requireFFmpeg(t)
	data := t.TempDir()
	source := filepath.Join(data, "broken.wav")
	if err := os.WriteFile(source, []byte("bad audio"), 0644); err != nil {
		t.Fatal(err)
	}
	cache := newMediaCache(data)
	if _, err := cache.get(context.Background(), source); err == nil {
		t.Fatal("invalid source accepted")
	}
	entries, err := os.ReadDir(filepath.Join(data, ".cache"))
	if err != nil || len(entries) != 0 {
		t.Fatalf("partial cache left behind: %v %v", entries, err)
	}
	writeTestWAV(t, source, 1)
	if _, err := cache.get(context.Background(), source); err != nil {
		t.Fatal(err)
	}
}
