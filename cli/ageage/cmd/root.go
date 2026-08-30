package cmd

import "github.com/spf13/cobra"

const defaultAPIURL = "https://ageage.rowicy.com/api/v1"

// Root returns the ageage CLI's root command.
func Root() *cobra.Command {
	root := &cobra.Command{
		Use:   "ageage",
		Short: "ageage - md/html/txt artifact sharing CLI",
	}
	root.AddCommand(shareCmd())
	return root
}
