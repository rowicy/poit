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
)

var slugPattern = regexp.MustCompile(`^[a-z0-9_-]{1,64}$`)

const (
	binarySniffLimit = 8 * 1024
	nonTextRatio     = 0.05
)

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

			if isBinaryContent(content) {
				return fmt.Errorf("%s looks like a binary file; poit only shares text (txt/md/html)", path)
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
