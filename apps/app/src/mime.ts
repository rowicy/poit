// Faithful TypeScript port of github.com/riiimparm/is-md-or-html-or-text's
// Detect() algorithm, kept in sync by hand. Runs in the Worker, where
// Cloudflare disallows compiling WebAssembly from bytes at request time
// ("Wasm code generation disallowed by embedder") - the real Go-WASM build
// of this same library is used client-side instead (apps/app/frontend),
// where no such restriction exists. The CLI (cli/poit) imports the Go
// package natively. All three are expected to agree on every input.

export type ArtifactMime = "md" | "html" | "txt";

const SNIFF_LIMIT = 64 * 1024;
const HTML_TAG_MIN_COUNT = 3;
const HTML_TAG_DENSITY = 0.3;
const MARKDOWN_THRESHOLD = 2;

const STRONG_HTML_MARKERS = ["<!doctype html", "<html", "<head", "<body", "<script", "<style"];

// Bounded to {0,3} rather than `\s*` on both sides of the optional `/` -
// two adjacent unbounded `\s*` separated only by a zero-width-capable token
// makes the backtracking engine try O(n) splits at O(n) positions (O(n^2)
// total) on non-matching whitespace-heavy input (e.g. a stray "<" followed
// by a long run of spaces); real HTML tags never have this whitespace
// anyway. (The original Go port uses RE2, which is immune to this; JS's
// backtracking RegExp engine is not.)
const RE_HTML_TAG = /<\s{0,3}\/?\s{0,3}[a-z][a-z0-9]*(\s[^<>]*)?>/gi;
const RE_MD_HEADER = /^ {0,3}#{1,6}\s/m;
const RE_MD_FENCE = /```/;
// Every `\s*` bounded to `\s{0,3}` for the same catastrophic-backtracking
// reason as RE_HTML_TAG above. This one is repeated inside a `(...)+` group,
// so leaving even one `\s*` unbounded still let many repetitions' worth of
// whitespace be re-partitioned between the group's last iteration and the
// trailing `\|?\s*$` in ~exponentially many ways on non-matching input -
// verified: "|---".repeat(4000) + whitespace + a non-matching tail took
// ~4.9s against the once-partially-bounded version of this pattern.
const RE_MD_TABLE = /^ {0,3}\|?\s{0,3}:?-{2,}:?\s{0,3}(\|\s{0,3}:?-{2,}:?\s{0,3})+\|?\s{0,3}$/m;
const RE_MD_LINK = /\[[^\]\n]+\]\([^)\n]+\)/;
const RE_MD_QUOTE = /^ {0,3}>\s?/m;
const RE_MD_BOLD = /(\*\*[^*\n]+\*\*|__[^_\n]+__)/;
const RE_MD_LIST = /^ {0,3}([-*+]|\d+\.)\s+\S/m;

export function detectMime(content: string): ArtifactMime {
  const sample = content.length > SNIFF_LIMIT ? content.slice(0, SNIFF_LIMIT) : content;
  if (!sample) return "txt";

  const lower = sample.toLowerCase();
  if (STRONG_HTML_MARKERS.some((marker) => lower.includes(marker))) return "html";

  const tagMatches = sample.match(RE_HTML_TAG) ?? [];
  const tagBytes = tagMatches.reduce((sum, m) => sum + m.length, 0);
  if (tagMatches.length >= HTML_TAG_MIN_COUNT && tagBytes >= sample.length * HTML_TAG_DENSITY) {
    return "html";
  }

  let score = 0;
  if (RE_MD_HEADER.test(sample)) score += 2;
  if (RE_MD_FENCE.test(sample)) score += 2;
  if (RE_MD_TABLE.test(sample)) score += 2;
  if (RE_MD_LINK.test(sample)) score += 2;
  if (RE_MD_QUOTE.test(sample)) score += 1;
  if (RE_MD_BOLD.test(sample)) score += 1;
  if (RE_MD_LIST.test(sample)) score += 1;
  if (tagMatches.length > 0) score += 1;

  return score >= MARKDOWN_THRESHOLD ? "md" : "txt";
}
