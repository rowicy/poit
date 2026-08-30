package cmd

import "github.com/spf13/cobra"

const defaultAPIURL = "https://poit.rowicy.com/api/v1"

// Root returns the poit CLI's root command.
func Root() *cobra.Command {
	root := &cobra.Command{
		Use:   "poit",
		Short: "poit - md/html/txt artifact sharing CLI",
	}
	root.AddCommand(shareCmd())
	return root
}
