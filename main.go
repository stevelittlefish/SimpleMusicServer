package main

import (
	"embed"
	"encoding/json"
	"io/fs"
	"log"
	"net/http"
	"net/url"
	"os"
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
	mux.HandleFunc("GET /api/tracks", func(w http.ResponseWriter, r *http.Request) {
		tracks := []track{}
		err := filepath.WalkDir(data, func(path string, entry fs.DirEntry, err error) error {
			if err != nil {
				return err
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
			tracks = append(tracks, track{name, (&url.URL{Path: "/audio/" + name}).String()})
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
	mux.Handle("GET /", http.FileServer(http.FS(web)))
	return mux
}

func main() {
	if err := os.MkdirAll("data", 0755); err != nil {
		log.Fatal(err)
	}
	log.Print("Music server: http://localhost:6069 — network: http://<this-machine-ip>:6069")
	log.Fatal(http.ListenAndServe("0.0.0.0:6069", handler("data")))
}
