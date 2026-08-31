import { describe, expect, it } from "vitest";
import { extractInfo, truncateUtf8 } from "../src/metadata";

const byteLength = (s: string) => new TextEncoder().encode(s).length;

describe("extractInfo html", () => {
  it("extracts a normal title and excerpt", async () => {
    const info = await extractInfo("html", "<html><head><title>Hi</title></head><body><p>Hello world</p></body></html>");
    expect(info.title).toBe("Hi");
    expect(info.excerpt).toBe("Hello world");
  });

  it("bounds title even for a malformed unclosed <title> in a huge document", async () => {
    // No closing </title> - per the HTML spec <title> is RAWTEXT, so
    // without a bound this would capture the rest of the document as
    // HTMLRewriter streams through it (everything after is just more of
    // the same unclosed text run, not real markup).
    const huge = "x".repeat(2_000_000);
    const html = `<html><head><title>${huge}</html>`;
    const info = await extractInfo("html", html);
    expect(byteLength(info.title!)).toBeLessThanOrEqual(160);
  });

  it("bounds excerpt for a huge well-formed body", async () => {
    const huge = Array(50_000).fill("<p>Hello world</p>").join("");
    const info = await extractInfo("html", `<html><head><title>Hi</title></head><body>${huge}</body></html>`);
    expect(byteLength(info.excerpt!)).toBeLessThanOrEqual(240);
    // Both fields combined must comfortably fit Cloudflare KV's 1024-byte
    // per-key metadata limit alongside the rest of ArtifactMeta.
    expect(byteLength(info.title!) + byteLength(info.excerpt!)).toBeLessThan(1024);
  });

  it("bounds title/excerpt in UTF-8 bytes (not JS string length) for CJK content", async () => {
    // A naive character-count `.slice(0, N)` cap lets a CJK title/excerpt
    // through at up to 3 UTF-8 bytes per JS string unit, which alone can
    // blow past the 1024-byte KV metadata limit even though `.length` looks
    // small. This app's users are Japanese-speaking, so this is a realistic
    // input, not just an adversarial one.
    const hugeTitle = "あ".repeat(1000);
    const hugeBody = "い".repeat(1000);
    const html = `<html><head><title>${hugeTitle}</title></head><body><p>${hugeBody}</p></body></html>`;
    const info = await extractInfo("html", html);
    expect(byteLength(info.title!)).toBeLessThanOrEqual(160);
    expect(byteLength(info.excerpt!)).toBeLessThanOrEqual(240);
  });
});

describe("extractInfo markdown", () => {
  it("bounds title/excerpt for a huge document", () => {
    const line = "word ".repeat(100);
    const md = `# ${"t".repeat(2000)}\n\n${Array(5000).fill(line).join("\n")}`;
    // extractMarkdownInfo is synchronous; extractInfo's md branch resolves
    // its promise immediately either way.
    return extractInfo("md", md).then((info) => {
      expect(byteLength(info.title!)).toBeLessThanOrEqual(160);
      expect(byteLength(info.excerpt!)).toBeLessThanOrEqual(240);
    });
  });

  it("bounds title/excerpt in UTF-8 bytes for CJK content", async () => {
    const md = `# ${"あ".repeat(1000)}\n\n${"い".repeat(1000)}`;
    const info = await extractInfo("md", md);
    expect(byteLength(info.title!)).toBeLessThanOrEqual(160);
    expect(byteLength(info.excerpt!)).toBeLessThanOrEqual(240);
  });
});

describe("truncateUtf8", () => {
  it("never splits a multi-byte character", () => {
    const s = "あ".repeat(100);
    const truncated = truncateUtf8(s, 10);
    // 10 bytes / 3 bytes-per-char = 3 whole characters, no partial/mangled one
    expect(truncated).toBe("あああ");
    expect(byteLength(truncated)).toBeLessThanOrEqual(10);
  });

  it("is a no-op when already within budget", () => {
    expect(truncateUtf8("hello", 100)).toBe("hello");
  });
});
