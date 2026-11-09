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

// Guards the hand-synced Go copy of apps/app/src/binary.ts's decodeTextFile;
// the TypeScript side has the same cases in apps/app/test/binary.test.ts.
func TestDecodeTextFile(t *testing.T) {
	cases := []struct {
		name    string
		content []byte
		want    string
		wantOK  bool
	}{
		// 日本語 in Shift_JIS (CP932) - a Japanese text file saved on Windows.
		{"shift_jis", []byte{0x93, 0xfa, 0x96, 0x7b, 0x8c, 0xea}, "日本語", true},
		{"utf-8", []byte("# 見出し\n"), "# 見出し\n", true},
		{"utf-8 with BOM", []byte("\ufeffhi"), "hi", true},
		// "hi" UTF-16LE with a BOM: 0xff is valid in neither encoding.
		{"utf-16le", []byte{0xff, 0xfe, 0x68, 0x00, 0x69, 0x00}, "", false},
	}
	for _, tc := range cases {
		got, ok := decodeTextFile(tc.content)
		if ok != tc.wantOK {
			t.Errorf("%s: ok = %v, want %v", tc.name, ok, tc.wantOK)
			continue
		}
		if ok && string(got) != tc.want {
			t.Errorf("%s: decodeTextFile = %q, want %q", tc.name, got, tc.want)
		}
	}
}

func TestDecodeTextFileRejectsPNG(t *testing.T) {
	png := append([]byte{0x89, 'P', 'N', 'G', '\r', '\n', 0x1a, '\n'}, make([]byte, 4088)...)
	for i := 8; i < len(png); i++ {
		png[i] = byte(i * 31 % 256)
	}
	// Either no encoding fits, or it "decodes" into something isBinaryContent
	// still catches - a binary file must never get through both.
	if decoded, ok := decodeTextFile(png); ok && !isBinaryContent(decoded) {
		t.Error("a PNG passed both decodeTextFile and isBinaryContent")
	}
}
