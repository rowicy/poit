package cmd

import (
	"bytes"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"unicode/utf8"

	filekind "github.com/riiimparm/is-md-or-html-or-text"
	"github.com/spf13/cobra"
	"golang.org/x/text/encoding/japanese"
	"golang.org/x/text/transform"
)

var slugPattern = regexp.MustCompile(`^[a-z0-9_-]{1,64}$`)

const (
	binarySniffLimit = 8 * 1024
	nonTextRatio     = 0.05
)

// Go copy of apps/app/src/binary.ts's decodeTextFile - keep the two in sync.
// Japanese text files from Windows are still commonly Shift_JIS (CP932), so
// convert those to UTF-8 instead of rejecting them; every other encoding
// stays a rejection (UTF-16 included - its NUL bytes are not valid in
// either). The Worker cannot do this for us: the API carries `content` as an
// already-decoded JSON string, so the lossy decode would already have
// happened by the time it sees the request.
//
// ponytail: whatever is *valid* Shift_JIS is taken as Shift_JIS, so a (now
// rare) EUC-JP file can come through as mojibake instead of being rejected.
// Reach for a real encoding detector only if that actually shows up.
func decodeTextFile(content []byte) ([]byte, bool) {
	if utf8.Valid(content) {
		// TextDecoder strips a leading BOM, so strip it here too - otherwise
		// the SPA and the CLI would store different bytes for the same file,
		// and a stray U+FEFF breaks e.g. markdown heading detection.
		return bytes.TrimPrefix(content, []byte("\uFEFF")), true
	}
	decoded, _, err := transform.Bytes(japanese.ShiftJIS.NewDecoder(), content)
	// Unlike TextDecoder's fatal mode the decoder substitutes U+FFFD rather
	// than failing, so an unmappable byte shows up in the output, not in err.
	// Shift_JIS has no mapping *to* U+FFFD, so finding one means bad input.
	if err != nil || bytes.ContainsRune(decoded, utf8.RuneError) {
		return nil, false
	}
	return decoded, true
}

// Go copy of apps/app/src/binary.ts's isBinaryContent - keep the two in sync.
// poit only stores text (md/html/txt); posting a binary body used to come
// back as a bare 500 from the Worker's KV write, so reject it locally and
// never spend the round trip. The API re-checks and answers 400.
func isBinaryContent(content []byte) bool {
	sample := content
	if len(sample) > binarySniffLimit {
		sample = sample[:binarySniffLimit]
	}
	// git's and file(1)'s rule: a single NUL means binary, full stop.
	if bytes.IndexByte(sample, 0) >= 0 {
		return true
	}
	nonText := 0
	// Ranging a string yields utf8.RuneError once per invalid byte, which is
	// exactly what TextDecoder leaves as U+FFFD on the TypeScript side.
	for _, r := range string(sample) {
		if r == utf8.RuneError || r == 0x7f || (r < 0x20 && r != '\t' && r != '\n' && r != '\r') {
			nonText++
		}
	}
	return float64(nonText) > float64(len(sample))*nonTextRatio
}

func shareCmd() *cobra.Command {
	var public bool
	var persist bool
	var slug string

	cmd := &cobra.Command{
		Use:   "share <file_path>",
		Short: "Upload a file and get back a shareable poit URL",
		Args:  cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			path := args[0]
			content, err := os.ReadFile(path)
			if err != nil {
				return fmt.Errorf("reading %s: %w", path, err)
			}

			content, ok := decodeTextFile(content)
			if !ok || isBinaryContent(content) {
				return fmt.Errorf("%s looks like a binary file; poit only shares text (txt/md/html, UTF-8 or Shift_JIS)", path)
			}

			if slug != "" && !slugPattern.MatchString(slug) {
				return fmt.Errorf("--name must match [a-z0-9_-], got %q", slug)
			}

			visibility := "private"
			if public {
				visibility = "public"
			}

			fmt.Fprintf(cmd.ErrOrStderr(), "detected: %s\n", filekind.Detect(content))

			url, err := createArtifact(artifactRequest{
				Content:    string(content),
				Filename:   filepath.Base(path),
				Slug:       slug,
				Visibility: visibility,
				Persist:    persist,
			})
			if err != nil {
				return err
			}

			fmt.Println(url)
			return nil
		},
	}

	cmd.Flags().BoolVar(&public, "public", false, "make the artifact publicly viewable (default: private, shared within rowicy)")
	cmd.Flags().BoolVar(&persist, "persist", false, "keep the artifact indefinitely (default: expires after 90 days)")
	cmd.Flags().StringVar(&slug, "name", "", "custom share URL id, must match [a-z0-9_-] (default: a random id)")

	return cmd
}
