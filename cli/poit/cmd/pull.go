package cmd

import (
	"bufio"
	"bytes"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"

	"github.com/charmbracelet/huh"
	"github.com/spf13/cobra"
	"golang.org/x/term"
)

func pullCmd() *cobra.Command {
	var output string

	cmd := &cobra.Command{
		Use:   "pull [id]",
		Short: "Download an artifact (pick interactively when no id is given)",
		Args:  cobra.MaximumNArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			in := bufio.NewReader(cmd.InOrStdin())
			out := cmd.ErrOrStderr()

			artifacts, err := listArtifacts()
			if err != nil {
				return err
			}

			var target artifactMeta
			if len(args) == 1 {
				target = artifactMeta{ID: args[0], Filename: args[0]}
				for _, a := range artifacts {
					if a.ID == args[0] {
						target = a
					}
				}
			} else {
				if len(artifacts) == 0 {
					return errors.New("no artifacts to pull")
				}
				target, err = pickArtifact(artifacts)
				if err != nil {
					return err
				}
			}

			content, err := fetchArtifactContent(target.ID)
			if err != nil {
				return err
			}

			path := output
			if path == "" {
				// Base() strips any directory parts from the server-supplied
				// filename so a crafted name can't write outside cwd.
				path = filepath.Base(target.Filename)
				if path == "." || path == "/" || path == ".." {
					path = target.ID
				}
			}
			if path == "-" {
				_, err := cmd.OutOrStdout().Write(content)
				return err
			}

			if _, err := os.Stat(path); err == nil {
				ok, err := confirm(in, out, fmt.Sprintf("%s already exists. Overwrite? [y/N]: ", path))
				if err != nil {
					return err
				}
				if !ok {
					return errors.New("aborted")
				}
			}
			if err := os.WriteFile(path, content, 0644); err != nil {
				return err
			}
			fmt.Fprintf(out, "saved: %s\n", path)
			return nil
		},
	}

	cmd.Flags().StringVarP(&output, "output", "o", "", "output path, or - for stdout (default: the artifact's filename)")
	return cmd
}

// pickArtifact shows an arrow-key selector (↑/↓, / to filter, Enter to
// pick, Ctrl-C to cancel) on the terminal.
func pickArtifact(artifacts []artifactMeta) (artifactMeta, error) {
	if !term.IsTerminal(int(os.Stdin.Fd())) {
		return artifactMeta{}, errors.New("stdin is not a terminal; pass an id: poit pull <id>")
	}

	var table bytes.Buffer
	printArtifacts(&table, artifacts, false)
	lines := strings.Split(strings.TrimRight(table.String(), "\n"), "\n")

	options := make([]huh.Option[int], len(artifacts))
	for i := range artifacts {
		options[i] = huh.NewOption(lines[i+1], i)
	}

	var selected int
	err := huh.NewSelect[int]().
		Title("  " + lines[0]).
		Options(options...).
		Value(&selected).
		Run()
	if errors.Is(err, huh.ErrUserAborted) {
		return artifactMeta{}, errors.New("aborted")
	}
	if err != nil {
		return artifactMeta{}, err
	}
	return artifacts[selected], nil
}

func confirm(in *bufio.Reader, out io.Writer, prompt string) (bool, error) {
	fmt.Fprint(out, prompt)
	line, err := in.ReadString('\n')
	if err != nil && line == "" {
		return false, nil
	}
	answer := strings.ToLower(strings.TrimSpace(line))
	return answer == "y" || answer == "yes", nil
}
