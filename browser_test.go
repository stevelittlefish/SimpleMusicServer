package main

import (
	"io"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"testing"
)

// Opt in with SMS_BROWSER_TEST=1 and a Chrome-family browser running with
// --remote-debugging-port=9227. The script uses Node 22+ and no npm packages.
func TestBrowserPlayback(t *testing.T) {
	if os.Getenv("SMS_BROWSER_TEST") != "1" {
		t.Skip("set SMS_BROWSER_TEST=1 for browser checks")
	}
	requireFFmpeg(t)
	data := t.TempDir()
	for _, name := range []string{"01-first.wav", "02-next.wav", "03-last.wav"} {
		writeTestWAV(t, filepath.Join(data, name), 8)
	}
	if sample := os.Getenv("SMS_BROWSER_SAMPLE"); sample != "" {
		src, err := os.Open(sample)
		if err != nil {
			t.Fatal(err)
		}
		defer src.Close()
		dst, err := os.Create(filepath.Join(data, "01-first.wav"))
		if err != nil {
			t.Fatal(err)
		}
		if _, err := io.Copy(dst, src); err != nil {
			dst.Close()
			t.Fatal(err)
		}
		if err := dst.Close(); err != nil {
			t.Fatal(err)
		}
	}
	server := httptest.NewServer(handler(data))
	defer server.Close()
	cmd := exec.Command("node", "scripts/browser-smoke.mjs", server.URL)
	output, err := cmd.CombinedOutput()
	if err != nil {
		t.Fatalf("browser checks: %v\n%s", err, output)
	}
	t.Log(string(output))
}
