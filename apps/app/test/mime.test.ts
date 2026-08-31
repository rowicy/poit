import { describe, expect, it } from "vitest";
import { detectMime } from "../src/mime";

describe("detectMime", () => {
  it("still detects html/markdown/text correctly", () => {
    expect(detectMime("<html><body><p>hi</p></body></html>")).toBe("html");
    expect(detectMime("# Title\n\nSome **bold** text with a [link](https://x).")).toBe("md");
    expect(detectMime("| a | b |\n| --- | --- |\n| 1 | 2 |")).toBe("md");
    expect(detectMime("just plain text, nothing special here")).toBe("txt");
  });

  it("does not catastrophically backtrack on whitespace-heavy input", () => {
    // Regression test: RE_HTML_TAG and RE_MD_TABLE both used to have two
    // adjacent unbounded `\s*` groups separated only by an optional token,
    // which is a classic ReDoS pattern - a stray "<" or table-like prefix
    // followed by a long run of whitespace could take seconds of Worker CPU
    // time per call. Bounding those to a small fixed range fixed it; this
    // asserts detectMime stays fast at the sniff limit (64KB).
    const adversarial = "<" + " ".repeat(64 * 1024);
    const start = Date.now();
    detectMime(adversarial);
    expect(Date.now() - start).toBeLessThan(200);
  });

  it("does not catastrophically backtrack on many table-separator-like groups", () => {
    // RE_MD_TABLE's repeated (\|...\s*)+ group still had one unbounded `\s*`
    // left after an earlier pass only bounded the pattern's very first `\s*`
    // - with many repetitions of the group, that one leftover `\s*` could
    // still be re-partitioned against the trailing `\|?\s*$` in ~exponentially
    // many ways on non-matching input. Verified: "|---".repeat(4000) + 48KB
    // of trailing whitespace + a non-matching final char took ~4.9s against
    // the previous, only-partially-bounded pattern.
    const adversarial = "|---".repeat(4000) + " ".repeat(48 * 1024) + "X";
    const start = Date.now();
    detectMime(adversarial);
    expect(Date.now() - start).toBeLessThan(200);
  });
});
