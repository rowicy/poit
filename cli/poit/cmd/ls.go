package cmd

import (
	"fmt"
	"io"
	"text/tabwriter"

	"github.com/spf13/cobra"
)

func lsCmd() *cobra.Command {
	return &cobra.Command{
		Use:   "ls",
		Short: "List your shared artifacts",
		Args:  cobra.NoArgs,
		RunE: func(cmd *cobra.Command, args []string) error {
			artifacts, err := listArtifacts()
			if err != nil {
				return err
			}
			printArtifacts(cmd.OutOrStdout(), artifacts, false)
			return nil
		},
	}
}

// printArtifacts renders artifacts as a table, optionally with a 1-based
// index column for interactive selection.
func printArtifacts(out io.Writer, artifacts []artifactMeta, numbered bool) {
	w := tabwriter.NewWriter(out, 0, 0, 2, ' ', 0)
	if numbered {
		fmt.Fprint(w, "#\t")
	}
	fmt.Fprintln(w, "ID\tFILENAME\tMIME\tVISIBILITY\tEXPIRES\tTITLE")
	for i, a := range artifacts {
		if numbered {
			fmt.Fprintf(w, "%d\t", i+1)
		}
		expires := "never"
		if !a.Persist && len(a.ExpiresAt) >= 10 {
			expires = a.ExpiresAt[:10]
		}
		fmt.Fprintf(w, "%s\t%s\t%s\t%s\t%s\t%s\n", a.ID, a.Filename, a.Mime, a.Visibility, expires, a.Title)
	}
	w.Flush()
}
