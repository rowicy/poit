import MarkdownItFactory, { type MarkdownIt, type Token } from "markdown-it";
import footnote from "markdown-it-footnote";
import taskLists from "markdown-it-task-lists";
import { highlightCode } from "./highlight";
import { applyMarkdownExtensions } from "./mdExtensions";

let md: MarkdownIt | null = null;

function createMarkdownIt(): MarkdownIt {
  const instance = new MarkdownItFactory({ html: false, linkify: true, breaks: false })
    .use(footnote)
    .use(taskLists, { enabled: true, label: true });

  applyMarkdownExtensions(instance);

  // Reject javascript:/data:/vbscript: schemes explicitly (markdown-it's
  // default validateLink already blocks most, this closes the rest).
  const defaultValidateLink = instance.validateLink.bind(instance);
  const dangerousSchemeRe = /^(javascript|data|vbscript):/i;
  instance.validateLink = (url: string) => {
    if (dangerousSchemeRe.test(url.trim())) return false;
    return defaultValidateLink(url);
  };

  // ```mermaid becomes a placeholder div for renderMermaidDiagrams() to
  // replace with an SVG after mount; everything else goes through
  // highlight.js, falling back to a plain <pre> for unknown languages.
  instance.renderer.rules.fence = (tokens, idx) => {
    const token = tokens[idx];
    const info = token.info ? instance.utils.unescapeAll(token.info).trim() : "";
    const lang = info.split(/\s+/)[0] ?? "";

    if (lang === "mermaid") {
      return `<div class="md-mermaid">${instance.utils.escapeHtml(token.content)}</div>\n`;
    }

    const highlighted = highlightCode(token.content, lang);
    if (highlighted !== null) {
      const langClass = lang ? ` language-${instance.utils.escapeHtml(lang)}` : "";
      return `<pre><code class="hljs${langClass}">${highlighted}</code></pre>\n`;
    }

    return `<pre><code>${instance.utils.escapeHtml(token.content)}</code></pre>\n`;
  };

  // Wrap tables so wide ones scroll horizontally instead of overflowing.
  const defaultTableOpen =
    instance.renderer.rules.table_open ??
    ((tokens, idx, options, _env, self) => self.renderToken(tokens, idx, options));
  const defaultTableClose =
    instance.renderer.rules.table_close ??
    ((tokens, idx, options, _env, self) => self.renderToken(tokens, idx, options));
  instance.renderer.rules.table_open = (tokens, idx, options, env, self) =>
    `<div class="md-table-wrap">${defaultTableOpen(tokens, idx, options, env, self)}`;
  instance.renderer.rules.table_close = (tokens, idx, options, env, self) =>
    `${defaultTableClose(tokens, idx, options, env, self)}</div>`;

  return instance;
}

function getMarkdownIt(): MarkdownIt {
  md ??= createMarkdownIt();
  return md;
}

const FRONTMATTER_RE = /^---\r?\n[\s\S]*?\r?\n---\r?\n?/;

/**
 * Strips a leading YAML frontmatter block. Needed before both rendering and
 * hr-based slide splitting - markdown-it has no notion of frontmatter, so
 * without this its own delimiters parse as two spurious `hr` tokens.
 */
export function stripFrontmatter(raw: string): string {
  return raw.replace(FRONTMATTER_RE, "");
}

export function renderMarkdown(raw: string): string {
  return getMarkdownIt().render(stripFrontmatter(raw));
}

export interface HeadingInfo {
  level: number;
  text: string;
  slideIndex: number;
}

export interface MarkdownStructure {
  slideTexts: string[];
  headings: HeadingInfo[];
}

function plainText(token: Token): string {
  if (!token.children) return token.content;
  return token.children
    .filter((c) => c.type === "text" || c.type === "code_inline")
    .map((c) => c.content)
    .join("");
}

/**
 * Slides are separated by a markdown thematic break (`---` / `***` / `___`
 * alone on a line). Splitting on the real parser's `hr` tokens - rather than
 * a raw-text regex - means a `---` inside a fenced code block, or a table's
 * `|---|` header separator, is never mistaken for a slide boundary, and a
 * leading YAML frontmatter block (also `---`-delimited) doesn't produce a
 * spurious extra slide.
 */
export function parseMarkdownStructure(raw: string): MarkdownStructure {
  const body = stripFrontmatter(raw);
  const tokens = getMarkdownIt().parse(body, {});
  const lines = body.split(/\r?\n/);

  const hrLines = tokens.filter((t) => t.type === "hr" && t.map).map((t) => t.map![0]);

  const slideTexts: string[] = [];
  {
    let start = 0;
    for (const line of hrLines) {
      slideTexts.push(lines.slice(start, line).join("\n"));
      start = line + 1;
    }
    slideTexts.push(lines.slice(start).join("\n"));
  }

  function slideIndexForLine(line: number): number {
    let idx = 0;
    for (const hrLine of hrLines) {
      if (line < hrLine) return idx;
      idx += 1;
    }
    return idx;
  }

  const headings: HeadingInfo[] = [];
  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i];
    if (token.type !== "heading_open" || !token.map) continue;
    const inline = tokens[i + 1];
    headings.push({
      level: Number(token.tag.slice(1)),
      text: inline ? plainText(inline) : "",
      slideIndex: slideIndexForLine(token.map[0]),
    });
  }

  return { slideTexts, headings };
}

export function containsMermaid(raw: string): boolean {
  return /^ {0,3}`{3,}\s*mermaid\b/m.test(raw);
}

let mermaidInitialized = false;

/** Replaces .md-mermaid placeholders (produced by the fence rule above) with rendered SVG. */
export async function renderMermaidDiagrams(root: HTMLElement): Promise<void> {
  const blocks = Array.from(root.querySelectorAll<HTMLElement>(".md-mermaid:not(.md-mermaid-rendered)"));
  if (blocks.length === 0) return;

  const { default: mermaid } = await import("mermaid");
  if (!mermaidInitialized) {
    // Mermaid has no built-in "nord" theme; approximate it via themeVariables
    // to match the nord viewer chrome (.md-viewer's --nord* palette).
    mermaid.initialize({
      startOnLoad: false,
      theme: "base",
      themeVariables: {
        background: "#eceff4",
        primaryColor: "#88c0d0",
        primaryTextColor: "#2e3440",
        primaryBorderColor: "#4c566a",
        lineColor: "#4c566a",
        secondaryColor: "#d8dee9",
        tertiaryColor: "#eceff4",
      },
      securityLevel: "strict",
    });
    mermaidInitialized = true;
  }

  let index = 0;
  for (const block of blocks) {
    const source = block.textContent ?? "";
    const id = `md-mermaid-${Date.now()}-${index}`;
    index += 1;
    try {
      const { svg } = await mermaid.render(id, source);
      block.innerHTML = svg;
      block.classList.add("md-mermaid-rendered");
    } catch (err) {
      block.textContent = `Mermaid の描画に失敗しました: ${(err as Error).message}`;
      block.classList.add("md-mermaid-error");
    }
  }
}
