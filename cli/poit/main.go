package main

import (
	"fmt"
	"os"

	"github.com/rowicy/ageage/cli/poit/cmd"
)

func main() {
	if err := cmd.Root().Execute(); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}
