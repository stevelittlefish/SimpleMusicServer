package main

import (
	"bytes"
	"context"
	"crypto/sha256"
	"fmt"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

const mediaVersion = "mp3-192-stereo-v1"

type mediaJob struct {
	done chan struct{}
	path string
	err  error
}

type mediaCache struct {
	data  string
	mu    sync.Mutex
	jobs  map[string]*mediaJob
	slots chan struct{}
}

func newMediaCache(data string) *mediaCache {
	return &mediaCache{data: data, jobs: make(map[string]*mediaJob), slots: make(chan struct{}, 2)}
}

func compressed(name string) bool {
	ext := strings.ToLower(filepath.Ext(name))
	return ext == ".wav" || ext == ".flac"
}

func mediaKey(path string, info os.FileInfo) string {
	absolute, _ := filepath.Abs(path)
	return fmt.Sprintf("%x", sha256.Sum256([]byte(fmt.Sprintf("%s\x00%s\x00%d\x00%d", mediaVersion, absolute, info.Size(), info.ModTime().UnixNano()))))
}

func (c *mediaCache) get(ctx context.Context, source string) (string, error) {
	info, err := os.Stat(source)
	if err != nil {
		return "", err
	}
	key := mediaKey(source, info)
	path := filepath.Join(c.data, ".cache", key+".mp3")
	if _, err := os.Stat(path); err == nil {
		return path, nil
	}
	c.mu.Lock()
	// A previous job may have finished between the first stat and this lock.
	if _, err := os.Stat(path); err == nil {
		c.mu.Unlock()
		return path, nil
	}
	job := c.jobs[key]
	if job == nil {
		job = &mediaJob{done: make(chan struct{}), path: path}
		c.jobs[key] = job
		go func() {
			// Finish the cache even if a browser switches tracks or disconnects.
			workCtx, cancel := context.WithTimeout(context.Background(), 10*time.Minute)
			defer cancel()
			select {
			case c.slots <- struct{}{}:
				job.err = transcode(workCtx, source, path)
				<-c.slots
			case <-workCtx.Done():
				job.err = workCtx.Err()
			}
			c.mu.Lock()
			delete(c.jobs, key)
			close(job.done)
			c.mu.Unlock()
		}()
	}
	c.mu.Unlock()
	select {
	case <-ctx.Done():
		return "", ctx.Err()
	case <-job.done:
		return job.path, job.err
	}
}

func transcode(ctx context.Context, source, destination string) error {
	if err := os.MkdirAll(filepath.Dir(destination), 0755); err != nil {
		return err
	}
	tmp, err := os.CreateTemp(filepath.Dir(destination), ".prepare-*.mp3")
	if err != nil {
		return err
	}
	path := tmp.Name()
	if err := tmp.Close(); err != nil {
		os.Remove(path)
		return err
	}
	defer os.Remove(path)
	cmd := exec.CommandContext(ctx, "ffmpeg", "-hide_banner", "-loglevel", "error", "-nostdin", "-y",
		"-i", source, "-map", "0:a:0", "-vn", "-map_metadata", "-1",
		"-ac", "2", "-ar", "44100", "-c:a", "libmp3lame", "-b:a", "192k", path)
	var stderr bytes.Buffer
	cmd.Stderr = &stderr
	if err := cmd.Run(); err != nil {
		return fmt.Errorf("ffmpeg: %w: %s", err, stderr.String())
	}
	// Publish only the complete file, with a seek table and known Content-Length.
	return os.Rename(path, destination)
}

func (c *mediaCache) serve(w http.ResponseWriter, r *http.Request) {
	name := r.PathValue("name")
	if !filepath.IsLocal(name) || !compressed(name) {
		http.NotFound(w, r)
		return
	}
	source := filepath.Join(c.data, filepath.FromSlash(name))
	info, err := os.Stat(source)
	if err != nil || !info.Mode().IsRegular() {
		http.NotFound(w, r)
		return
	}
	path, err := c.get(r.Context(), source)
	if err != nil {
		if r.Context().Err() != nil {
			return
		}
		fmt.Printf("Prepare %s: %v\n", name, err)
		http.Error(w, "Could not compress audio; check FFmpeg on the server", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "audio/mpeg")
	if r.URL.Query().Get("v") == mediaKey(source, info) {
		w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
	} else {
		w.Header().Set("Cache-Control", "no-cache")
	}
	http.ServeFile(w, r, path)
}
