package cmd

import "testing"

// Guards the hand-synced Go copy of apps/app/src/binary.ts's isBinaryContent
// against drift; the TypeScript side has the same cases in
// apps/app/test/binary.test.ts.
func TestIsBinaryContent(t *testing.T) {
	png := append([]byte{0x89, 'P', 'N', 'G', '\r', '\n', 0x1a, '\n'}, make([]byte, 4088)...)
	for i := 8; i < len(png); i++ {
		png[i] = byte(i * 31 % 256)
	}

	cases := []struct {
		name    string
		content []byte
		want    bool
	}{
		{"png", png, true},
		{"nul-padded ascii", []byte("hello\x00world"), true},
		{"markdown", []byte("# 見出し\n\n本文です\n"), false},
		{"html", []byte("<html><body><p>hi</p></body></html>"), false},
		{"text with tabs and crlf", []byte("plain text\twith a tab\r\nand CRLF\n"), false},
		{"text mentioning U+FFFD", []byte("decoding failures show up as � in the output.\n"), false},
		{"empty", []byte(""), false},
	}
	for _, tc := range cases {
		if got := isBinaryContent(tc.content); got != tc.want {
			t.Errorf("%s: isBinaryContent = %v, want %v", tc.name, got, tc.want)
		}
	}
}
