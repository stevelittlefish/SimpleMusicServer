package main

import (
	"embed"
	"encoding/json"
	"io/fs"
	"log"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strings"
)

//go:embed web/*
var assets embed.FS

var audioTypes = map[string]string{
	".wav": "audio/wav", ".ogg": "audio/ogg", ".mp3": "audio/mpeg",
	".flac": "audio/flac", ".opus": "audio/ogg",
}

type track struct {
	Name string `json:"name"`
	URL  string `json:"url"`
}

func handler(data string) http.Handler {
	mux := http.NewServeMux()
	cache := newMediaCache(data)
	mux.HandleFunc("GET /stream/{name...}", func(w http.ResponseWriter, r *http.Request) { cache.serve(w, r) })
	mux.HandleFunc("GET /api/tracks", func(w http.ResponseWriter, r *http.Request) {
		tracks := []track{}
		err := filepath.WalkDir(data, func(path string, entry fs.DirEntry, err error) error {
			if err != nil {
				return err
			}
			if entry.IsDir() && entry.Name() == ".cache" {
				return filepath.SkipDir
			}
			if entry.IsDir() || !entry.Type().IsRegular() {
				return nil
			}
			if audioTypes[strings.ToLower(filepath.Ext(path))] == "" {
				return nil
			}
			name, err := filepath.Rel(data, path)
			if err != nil {
				return err
			}
			name = filepath.ToSlash(name)
			info, err := entry.Info()
			if err != nil {
				return err
			}
			version := "v=" + mediaKey(path, info)
			prefix := "/audio/"
			if compressed(name) {
				prefix = "/stream/"
			}
			tracks = append(tracks, track{
				Name: name,
				URL:  (&url.URL{Path: prefix + name, RawQuery: version}).String(),
			})
			return nil
		})
		if err != nil {
			http.Error(w, "Could not read data folder", 500)
			return
		}
		sort.Slice(tracks, func(i, j int) bool { return tracks[i].Name < tracks[j].Name })
		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("Cache-Control", "no-store")
		json.NewEncoder(w).Encode(tracks)
	})
	files := http.StripPrefix("/audio/", http.FileServer(http.Dir(data)))
	mux.HandleFunc("GET /audio/", func(w http.ResponseWriter, r *http.Request) {
		contentType := audioTypes[strings.ToLower(filepath.Ext(r.URL.Path))]
		if contentType == "" {
			http.NotFound(w, r)
			return
		}
		w.Header().Set("Content-Type", contentType)
		files.ServeHTTP(w, r)
	})
	web, err := fs.Sub(assets, "web")
	if err != nil {
		panic(err)
	}
	static := http.FileServer(http.FS(web))
	mux.HandleFunc("GET /", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "no-cache")
		static.ServeHTTP(w, r)
	})
	return mux
}

func main() {
	if _, err := exec.LookPath("ffmpeg"); err != nil {
		log.Fatal("FFmpeg is required to compress WAV/FLAC files. Install ffmpeg and run again.")
	}
	if err := os.MkdirAll("data", 0755); err != nil {
		log.Fatal(err)
	}
	log.Print("Music server: http://localhost:6069 — network: http://<this-machine-ip>:6069")
	log.Fatal(http.ListenAndServe("0.0.0.0:6069", handler("data")))
}
