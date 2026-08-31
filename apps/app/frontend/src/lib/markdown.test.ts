import { describe, expect, it } from "vitest";
import { parseMarkdownStructure, renderMarkdown, stripFrontmatter } from "./markdown";

describe("stripFrontmatter", () => {
  it("removes a leading YAML frontmatter block", () => {
    // Only the block's own trailing newline is consumed, same as
    // md-looks-good's original FRONTMATTER_RE - a following blank line
    // before the body is left in place (harmless; markdown collapses it).
    expect(stripFrontmatter("---\ntitle: x\n---\n\nbody")).toBe("\nbody");
    expect(stripFrontmatter("---\ntitle: x\n---\nbody")).toBe("body");
  });

  it("leaves content without frontmatter untouched", () => {
    expect(stripFrontmatter("# hi")).toBe("# hi");
  });
});

describe("parseMarkdownStructure", () => {
  it("splits slides on a real thematic break (---)", () => {
    const raw = "# One\n\ntext\n\n---\n\n# Two\n\nmore";
    const { slideTexts, headings } = parseMarkdownStructure(raw);
    expect(slideTexts).toHaveLength(2);
    expect(headings.map((h) => h.text)).toEqual(["One", "Two"]);
    expect(headings.map((h) => h.slideIndex)).toEqual([0, 1]);
  });

  it("does not split on --- inside a fenced code block, and ignores headings there", () => {
    const raw = ["# Real Heading", "", "```txt", "---", "# not a heading", "```", "", "still one slide"].join("\n");
    const { slideTexts, headings } = parseMarkdownStructure(raw);
    expect(slideTexts).toHaveLength(1);
    expect(headings.map((h) => h.text)).toEqual(["Real Heading"]);
  });

  it("does not count a leading frontmatter block's --- delimiters as a slide break", () => {
    const raw = "---\ntitle: x\n---\n\n# Heading\n\nbody";
    const { slideTexts, headings } = parseMarkdownStructure(raw);
    expect(slideTexts).toHaveLength(1);
    expect(headings.map((h) => h.text)).toEqual(["Heading"]);
  });

  it("does not split on a table's header separator row", () => {
    const raw = "| a | b |\n|---|---|\n| 1 | 2 |";
    const { slideTexts } = parseMarkdownStructure(raw);
    expect(slideTexts).toHaveLength(1);
  });
});

describe("renderMarkdown", () => {
  it("renders a mermaid fence as a placeholder div, not a highlighted code block", () => {
    const html = renderMarkdown("```mermaid\ngraph TD; A-->B;\n```");
    expect(html).toContain('class="md-mermaid"');
  });

  it("wraps tables for horizontal scroll", () => {
    const html = renderMarkdown("| a |\n|---|\n| 1 |");
    expect(html).toContain('class="md-table-wrap"');
  });
});
