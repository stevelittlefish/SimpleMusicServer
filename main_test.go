package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestLibraryAndStreaming(t *testing.T) {
	data := t.TempDir()
	if err := os.Mkdir(filepath.Join(data, "album"), 0755); err != nil {
		t.Fatal(err)
	}
	for _, name := range []string{"album/a # café.WAV", "b.mp3", "c.flac", "d.ogg", "e.opus", "ignore.txt"} {
		if err := os.WriteFile(filepath.Join(data, name), []byte("0123456789"), 0644); err != nil {
			t.Fatal(err)
		}
	}
	if err := os.Mkdir(filepath.Join(data, ".cache"), 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(data, ".cache", "hidden.mp3"), []byte("cache"), 0644); err != nil {
		t.Fatal(err)
	}
	h := handler(data)
	request := func(path string) *httptest.ResponseRecorder {
		w := httptest.NewRecorder()
		h.ServeHTTP(w, httptest.NewRequest("GET", path, nil))
		return w
	}
	w := request("/api/tracks")
	var tracks []track
	if err := json.Unmarshal(w.Body.Bytes(), &tracks); err != nil {
		t.Fatal(err)
	}
	if len(tracks) != 5 || tracks[0].Name != "album/a # café.WAV" {
		t.Fatalf("unexpected tracks: %+v", tracks)
	}
	for _, track := range tracks {
		prefix := "/audio/"
		if compressed(track.Name) {
			prefix = "/stream/"
		}
		if !strings.HasPrefix(track.URL, prefix) || !strings.Contains(track.URL, "?v=") {
			t.Fatalf("incorrect playback URL: %s", track.URL)
		}
		r := httptest.NewRequest("GET", (&url.URL{Path: "/audio/" + track.Name}).String(), nil)
		r.Header.Set("Range", "bytes=2-5")
		w := httptest.NewRecorder()
		h.ServeHTTP(w, r)
		if w.Code != http.StatusPartialContent || w.Body.String() != "2345" || w.Header().Get("Content-Range") != "bytes 2-5/10" {
			t.Fatalf("range response for %s: %d %q %v", track.Name, w.Code, w.Body.String(), w.Header())
		}
	}
	if w := request("/audio/ignore.txt"); w.Code != 404 {
		t.Fatalf("non-audio: %d", w.Code)
	}
	if w := request("/audio/missing.mp3"); w.Code != 404 {
		t.Fatalf("missing: %d", w.Code)
	}
	if w := request("/"); w.Code != 200 {
		t.Fatalf("UI: %d", w.Code)
	}
	if err := os.WriteFile(filepath.Join(data, "new.mp3"), []byte("new"), 0644); err != nil {
		t.Fatal(err)
	}
	w = request("/api/tracks")
	if err := json.Unmarshal(w.Body.Bytes(), &tracks); err != nil || len(tracks) != 6 {
		t.Fatalf("refresh: %v %+v", err, tracks)
	}
}

func TestEmptyLibrary(t *testing.T) {
	w := httptest.NewRecorder()
	handler(t.TempDir()).ServeHTTP(w, httptest.NewRequest("GET", "/api/tracks", nil))
	if w.Code != 200 || w.Body.String() != "[]\n" {
		t.Fatalf("empty library: %d %s", w.Code, w.Body.String())
	}
}
