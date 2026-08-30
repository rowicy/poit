package cmd

import (
	"fmt"
	"os"
	"path/filepath"

	"github.com/spf13/cobra"
)

func shareCmd() *cobra.Command {
	var public bool
	var persist bool

	cmd := &cobra.Command{
		Use:   "share <file_path>",
		Short: "Upload a file and get back a shareable ageage URL",
		Args:  cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			path := args[0]
			content, err := os.ReadFile(path)
			if err != nil {
				return fmt.Errorf("reading %s: %w", path, err)
			}

			visibility := "private"
			if public {
				visibility = "public"
			}

			url, err := createArtifact(artifactRequest{
				Content:    string(content),
				Filename:   filepath.Base(path),
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
	cmd.Flags().BoolVar(&persist, "persist", false, "keep the artifact indefinitely (default: expires after 24h)")

	return cmd
}
