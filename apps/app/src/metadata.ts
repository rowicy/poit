import type { ArtifactMime } from "./mime";

export interface ExtractedInfo {
  title?: string;
  excerpt?: string;
}

const EXCERPT_MAX_LENGTH = 280;

/**
 * Markdown: title is the first heading line found (any level); excerpt is
 * all other non-empty lines joined with spaces (heading lines excluded).
 */
function extractMarkdownInfo(content: string): ExtractedInfo {
  let title: string | undefined;
  const bodyParts: string[] = [];

  for (const line of content.split(/\r?\n/)) {
    const heading = line.match(/^ {0,3}#{1,6}\s+(.*)$/);
    if (heading) {
      if (!title) title = heading[1].trim();
      continue;
    }
    const trimmed = line.trim();
    if (trimmed) bodyParts.push(trimmed);
  }

  return {
    title,
    excerpt: bodyParts.join(" ").slice(0, EXCERPT_MAX_LENGTH) || undefined,
  };
}

/**
 * HTML: title prefers <title>, falling back to the first h1..h6 found
 * (in that priority order, regardless of document position). Excerpt is
 * all text inside <body> (excluding <script>/<style>), tags stripped and
 * joined with spaces.
 */
async function extractHtmlInfo(html: string): Promise<ExtractedInfo> {
  let title = "";
  let titleSeen = false;
  let titleCapturing = false;

  const firstHeadingText: Partial<Record<number, string>> = {};
  const headingSeen: Partial<Record<number, boolean>> = {};
  const headingCapturing: Partial<Record<number, boolean>> = {};

  let bodyDepth = 0;
  let skipDepth = 0;
  const bodyParts: string[] = [];

  const rewriter = new HTMLRewriter()
    .on("title", {
      element() {
        titleCapturing = !titleSeen;
        titleSeen = true;
      },
      text(chunk) {
        if (titleCapturing) title += chunk.text;
      },
    })
    .on("body", {
      element(el) {
        bodyDepth++;
        el.onEndTag(() => {
          bodyDepth--;
        });
      },
    })
    .on("script, style", {
      element(el) {
        skipDepth++;
        el.onEndTag(() => {
          skipDepth--;
        });
      },
    })
    .on("*", {
      text(chunk) {
        if (bodyDepth > 0 && skipDepth === 0) {
          const t = chunk.text.trim();
          if (t) bodyParts.push(t);
        }
      },
    });

  for (let level = 1; level <= 6; level++) {
    rewriter.on(`h${level}`, {
      element() {
        headingCapturing[level] = !headingSeen[level];
        headingSeen[level] = true;
      },
      text(chunk) {
        if (headingCapturing[level]) {
          firstHeadingText[level] = (firstHeadingText[level] ?? "") + chunk.text;
        }
      },
    });
  }

  await rewriter.transform(new Response(html)).text();

  const firstHeading = [1, 2, 3, 4, 5, 6].map((l) => firstHeadingText[l]?.trim()).find((t) => !!t);

  return {
    title: title.trim() || firstHeading || undefined,
    excerpt: bodyParts.join(" ").slice(0, EXCERPT_MAX_LENGTH) || undefined,
  };
}

export async function extractInfo(mime: ArtifactMime, content: string): Promise<ExtractedInfo> {
  if (mime === "md") return extractMarkdownInfo(content);
  if (mime === "html") return extractHtmlInfo(content);
  return {};
}
