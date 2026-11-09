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
// up to 3 UTF-8 bytes. See truncateForKvMetadata below (the real cap is the
// JSON-encoded length, which is what KV measures).
const EXCERPT_MAX_BYTES = 240;
const TITLE_MAX_BYTES = 160;

/**
 * How many bytes `str` costs *inside a JSON string* - which is what KV
 * actually measures the `metadata` option against, since store.ts serializes
 * ArtifactMeta into it. JSON.stringify leaves non-ASCII alone, so for
 * ordinary text (CJK included) this equals the UTF-8 length, but it escapes
 * `"`/`\` to 2 bytes and every control character to 6 (`\u0000`).
 */
function jsonByteLength(str: string): number {
  return new TextEncoder().encode(JSON.stringify(str)).length - 2; // minus the surrounding quotes
}

/**
 * Truncates `str` so that its JSON-encoded form fits in `maxBytes`, without
 * splitting a character.
 *
 * The budget is JSON bytes rather than raw UTF-8 bytes because that is the
 * budget KV enforces: a 240-byte run of control characters serializes to
 * 1440 bytes of metadata, and the oversized kv.put() throws ("Metadata
 * length of N exceeds limit of 1024") with no handler above it, so the API
 * answers a bare 500. Binary uploads - the usual source of such runs - are
 * rejected up front now (see binary.ts), but a text file can still carry a
 * dense control-character or quote-heavy run into a title/excerpt, so the
 * real cap is enforced here instead of being trusted upstream.
 */
export function truncateForKvMetadata(str: string, maxBytes: number): string {
  if (jsonByteLength(str) <= maxBytes) return str;
  let out = "";
  let used = 0;
  // Iterating a string yields whole code points, so a surrogate pair is
  // never split. Bounded by maxBytes, not by input length - it stops as
  // soon as the budget is full.
  for (const ch of str) {
    const cost = jsonByteLength(ch);
    if (used + cost > maxBytes) break;
    out += ch;
    used += cost;
  }
  return out;
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
      if (!title) title = truncateForKvMetadata(heading[1].trim(), TITLE_MAX_BYTES);
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
    excerpt: truncateForKvMetadata(bodyParts.join(" "), EXCERPT_MAX_BYTES) || undefined,
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
    title: truncateForKvMetadata(title.trim() || firstHeading || "", TITLE_MAX_BYTES) || undefined,
    excerpt: truncateForKvMetadata(bodyParts.join(" "), EXCERPT_MAX_BYTES) || undefined,
  };
}

/**
 * Anything else (txt): no title - the row falls back to the filename -
 * and the excerpt is the leading non-empty lines joined with spaces.
 */
function extractTextInfo(content: string): ExtractedInfo {
  const bodyParts: string[] = [];
  let bodyLength = 0;

  for (const line of content.split(/\r?\n/)) {
    if (bodyLength >= EXCERPT_MAX_BYTES) break;
    const trimmed = line.trim();
    if (trimmed) {
      bodyParts.push(trimmed);
      bodyLength += trimmed.length + 1;
    }
  }

  return { excerpt: truncateForKvMetadata(bodyParts.join(" "), EXCERPT_MAX_BYTES) || undefined };
}

export async function extractInfo(mime: ArtifactMime, content: string): Promise<ExtractedInfo> {
  if (mime === "md") return extractMarkdownInfo(content);
  if (mime === "html") return extractHtmlInfo(content);
  return extractTextInfo(content);
}
