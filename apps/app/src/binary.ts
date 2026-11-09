// poit only ever stores text (md/html/txt), so a binary upload has no
// representation here: File.text()/os.ReadFile turns it into a string of
// U+FFFD replacement characters, which used to be accepted and then threw
// inside kv.put() ("Metadata length of 1659 exceeds limit of 1024", since
// JSON escapes every control character to a 6-byte \u00XX), surfacing to the
// caller as a bare 500. Rejecting it up front turns that into a 400 the user
// can act on.
//
// Imported by BOTH the Worker (src/index.ts) and the SPA
// (frontend/src/pages/Home.tsx) - one implementation, nothing to hand-sync.
// That means it is type-checked under both tsconfigs (workers-types and
// vite/client), so keep it to plain string/RegExp: no Worker-only and no
// DOM-only API.
// Deliberately NOT in mime.ts: that file is a hand-synced port of the Go
// detection library and must not grow logic the library doesn't have (see
// ARCHITECTURE.md). cli/poit keeps its own Go copy in cmd/share.go.

const SNIFF_LIMIT = 8 * 1024;
// Control characters no text file contains, plus U+FFFD - what TextDecoder
// (File.text()) leaves behind for every byte that was not valid UTF-8.
// Tab/LF/CR are text. NUL is handled separately below.
const RE_NON_TEXT = /[\u0001-\u0008\u000b\u000c\u000e-\u001f\u007f�]/g;
// Real text can legitimately hold a few U+FFFD (a document *about* decoding
// failures) or a form feed, so a trace of them is not enough. Binary is far
// over this: decoding random bytes as UTF-8 turns most of them into U+FFFD.
const NON_TEXT_RATIO = 0.05;

export function isBinaryContent(content: string): boolean {
  const sample = content.length > SNIFF_LIMIT ? content.slice(0, SNIFF_LIMIT) : content;
  // git's and file(1)'s rule: a single NUL means binary, full stop.
  if (sample.includes("\u0000")) return true;
  const nonText = sample.match(RE_NON_TEXT)?.length ?? 0;
  return nonText > sample.length * NON_TEXT_RATIO;
}
