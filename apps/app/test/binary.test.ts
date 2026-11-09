import { describe, expect, it } from "vitest";
import { decodeTextFile, isBinaryContent } from "../src/binary";

// What the browser (File.text()) and the CLI (string(os.ReadFile(...))) hand
// the API for a binary file: every byte that isn't valid UTF-8 becomes
// U+FFFD, NULs come through as-is.
const asUploadedText = (bytes: number[]) => new TextDecoder().decode(new Uint8Array(bytes));

const png = () => {
  const bytes = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  for (let i = 8; i < 4096; i++) bytes.push((i * 2654435761) % 256);
  return asUploadedText(bytes);
};

describe("isBinaryContent", () => {
  it("rejects a PNG read as text", () => {
    expect(isBinaryContent(png())).toBe(true);
  });

  it("rejects NUL-padded content even when the rest is plain ASCII (doc/bmp/UTF-16)", () => {
    expect(isBinaryContent("hello\u0000world")).toBe(true);
  });

  it("accepts the three kinds poit stores", () => {
    expect(isBinaryContent("# 見出し\n\n本文です\n")).toBe(false);
    expect(isBinaryContent("<html><body><p>hi</p></body></html>")).toBe(false);
    expect(isBinaryContent("plain text\twith a tab\r\nand CRLF\n")).toBe(false);
  });

  it("accepts text that merely mentions a replacement character", () => {
    expect(isBinaryContent(`decoding failures show up as � in the output.\n`.repeat(3))).toBe(false);
  });
});

// 日本語 in Shift_JIS (CP932) - what a Japanese text file saved on Windows
// still looks like today.
const SHIFT_JIS_NIHONGO = [0x93, 0xfa, 0x96, 0x7b, 0x8c, 0xea];
const bytesOf = (b: number[]) => new Uint8Array(b).buffer;

describe("decodeTextFile", () => {
  it("converts Shift_JIS to UTF-8 rather than rejecting it", () => {
    expect(decodeTextFile(bytesOf(SHIFT_JIS_NIHONGO))).toBe("日本語");
  });

  it("passes UTF-8 through and strips a BOM", () => {
    expect(decodeTextFile(new TextEncoder().encode("# 見出し\n").buffer as ArrayBuffer)).toBe("# 見出し\n");
    expect(decodeTextFile(bytesOf([0xef, 0xbb, 0xbf, 0x68, 0x69]))).toBe("hi");
  });

  it("rejects every other encoding as binary (UTF-16LE here)", () => {
    // "hi" little-endian with a BOM: 0xff is not valid in either decoder.
    expect(decodeTextFile(bytesOf([0xff, 0xfe, 0x68, 0x00, 0x69, 0x00]))).toBeNull();
  });

  it("rejects a PNG", () => {
    const bytes = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
    for (let i = 8; i < 4096; i++) bytes.push((i * 2654435761) % 256);
    // Either no encoding fits, or it "decodes" into something isBinaryContent
    // still catches - a binary file must never get through both.
    const decoded = decodeTextFile(bytesOf(bytes));
    expect(decoded === null || isBinaryContent(decoded)).toBe(true);
  });
});
