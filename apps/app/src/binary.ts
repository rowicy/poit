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

// In priority order. Japanese text files from Windows are still commonly
// Shift_JIS (CP932), so those are converted rather than rejected; every other
// encoding stays a rejection, which is also what UTF-16 gets (its NUL bytes
// fail both decoders below).
//
// ponytail: whatever is *valid* Shift_JIS is taken as Shift_JIS, so a (now
// rare) EUC-JP file can come through as mojibake instead of being rejected.
// Reach for a real encoding detector only if that actually shows up.
const TEXT_ENCODINGS = ["utf-8", "shift_jis"] as const;

/**
 * Decodes an uploaded file's bytes to text, or null when no supported
 * encoding fits - which is what a binary file looks like.
 *
 * SPA-only, despite living next to isBinaryContent: the Worker never sees
 * the bytes. The API carries `content` as an already-decoded JSON string
 * (ARCHITECTURE.md's API contract), so by the time a request reaches it the
 * lossy decode has happened and cannot be undone. The conversion therefore
 * has to sit at each upload point - here and cli/poit/cmd/share.go - with
 * isBinaryContent as the Worker's backstop.
 */
export function decodeTextFile(bytes: ArrayBuffer): string | null {
  for (const encoding of TEXT_ENCODINGS) {
    try {
      // fatal: true throws on an unmappable byte instead of quietly
      // substituting U+FFFD, which is the whole point: it is what separates
      // "wrong encoding, try the next one" from "valid text".
      // ignoreBOM: false (the default, confusingly named) strips a leading
      // BOM rather than keeping it as a U+FEFF character; workers-types
      // requires it to be spelled out.
      return new TextDecoder(encoding, { fatal: true, ignoreBOM: false }).decode(bytes);
    } catch {
      // not this encoding - fall through to the next
    }
  }
  return null;
}

export function isBinaryContent(content: string): boolean {
  const sample = content.length > SNIFF_LIMIT ? content.slice(0, SNIFF_LIMIT) : content;
  // git's and file(1)'s rule: a single NUL means binary, full stop.
  if (sample.includes("\u0000")) return true;
  const nonText = sample.match(RE_NON_TEXT)?.length ?? 0;
  return nonText > sample.length * NON_TEXT_RATIO;
}
