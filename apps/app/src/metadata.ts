import type { ArtifactMime } from "./mime";

export interface ExtractedInfo {
  title?: string;
  excerpt?: string;
}

// Cloudflare KV caps a key's `metadata` option at 1024 bytes total, measured
// as UTF-8 bytes (ArtifactMeta is stored there - see store.ts's putArtifact).
// These budgets are BYTES, not JS string length: a naive `.slice(0, N)`
// character cap still lets a CJK title/excerpt (this app's users are
// Japanese-speaking) blow past 1024 bytes, since one JS string unit can be
// up to 3 UTF-8 bytes. See truncateUtf8 below.
const EXCERPT_MAX_BYTES = 240;
const TITLE_MAX_BYTES = 160;

/**
 * Truncates `str` to at most `maxBytes` when UTF-8 encoded, without
 * splitting a multi-byte character. Backs off from the byte cut point while
 * it lands on a UTF-8 continuation byte (10xxxxxx).
 */
export function truncateUtf8(str: string, maxBytes: number): string {
  const bytes = new TextEncoder().encode(str);
  if (bytes.length <= maxBytes) return str;
  let end = maxBytes;
  while (end > 0 && (bytes[end] & 0xc0) === 0x80) end--;
  return new TextDecoder().decode(bytes.slice(0, end));
}

/**
 * Markdown: title is the first heading line found (any level); excerpt is
 * all other non-empty lines joined with spaces (heading lines excluded).
 */
function extractMarkdownInfo(content: string): ExtractedInfo {
  let title: string | undefined;
  const bodyParts: string[] = [];
  let bodyLength = 0;

  for (const line of content.split(/\r?\n/)) {
    const heading = line.match(/^ {0,3}#{1,6}\s+(.*)$/);
    if (heading) {
      if (!title) title = truncateUtf8(heading[1].trim(), TITLE_MAX_BYTES);
      continue;
    }
    if (bodyLength >= EXCERPT_MAX_BYTES) continue;
    const trimmed = line.trim();
    if (trimmed) {
      bodyParts.push(trimmed);
      bodyLength += trimmed.length + 1;
    }
  }

  return {
    title,
    excerpt: truncateUtf8(bodyParts.join(" "), EXCERPT_MAX_BYTES) || undefined,
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
  let bodyLength = 0;

  const rewriter = new HTMLRewriter()
    .on("title", {
      element() {
        titleCapturing = !titleSeen;
        titleSeen = true;
      },
      text(chunk) {
        // Bounded even while accumulating, not just at the end - an
        // unclosed <title> would otherwise make this grow with the entire
        // rest of the document as it streams through.
        if (titleCapturing && title.length < TITLE_MAX_BYTES) title += chunk.text;
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
        // Stop collecting once there's already enough for the excerpt -
        // for a large document this avoids materializing a huge bodyParts
        // array (and a huge intermediate joined string) just to slice off
        // the first 280 characters at the end.
        if (bodyDepth > 0 && skipDepth === 0 && bodyLength < EXCERPT_MAX_BYTES) {
          const t = chunk.text.trim();
          if (t) {
            bodyParts.push(t);
            bodyLength += t.length + 1;
          }
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
        const current = firstHeadingText[level] ?? "";
        if (headingCapturing[level] && current.length < TITLE_MAX_BYTES) {
          firstHeadingText[level] = current + chunk.text;
        }
      },
    });
  }

  await rewriter.transform(new Response(html)).text();

  const firstHeading = [1, 2, 3, 4, 5, 6].map((l) => firstHeadingText[l]?.trim()).find((t) => !!t);

  return {
    title: truncateUtf8(title.trim() || firstHeading || "", TITLE_MAX_BYTES) || undefined,
    excerpt: truncateUtf8(bodyParts.join(" "), EXCERPT_MAX_BYTES) || undefined,
  };
}

export async function extractInfo(mime: ArtifactMime, content: string): Promise<ExtractedInfo> {
  if (mime === "md") return extractMarkdownInfo(content);
  if (mime === "html") return extractHtmlInfo(content);
  return {};
}
