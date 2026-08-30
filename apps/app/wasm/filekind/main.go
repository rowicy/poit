//go:build js && wasm

package main

import (
	"syscall/js"

	filekind "github.com/riiimparm/is-md-or-html-or-text"
)

// detect(content: string) -> "html" | "markdown" | "text"
func detect(this js.Value, args []js.Value) any {
	if len(args) < 1 {
		return filekind.Text.String()
	}
	content := args[0].String()
	return filekind.Detect([]byte(content)).String()
}

func main() {
	js.Global().Set("filekindDetect", js.FuncOf(detect))
	select {}
}
