import { describe, expect, it } from "vitest";
import { isBinaryContent } from "../src/binary";

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
