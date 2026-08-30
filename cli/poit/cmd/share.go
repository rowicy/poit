package cmd

import (
	"fmt"
	"os"
	"path/filepath"
	"regexp"

	filekind "github.com/riiimparm/is-md-or-html-or-text"
	"github.com/spf13/cobra"
)

var slugPattern = regexp.MustCompile(`^[a-z0-9_-]{1,64}$`)

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
