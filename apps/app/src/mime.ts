export type ArtifactMime = "md" | "html" | "txt";

export function detectMime(content: string): ArtifactMime {
  const lines = content.split(/\r?\n/);
  if (lines.some((line) => /^#*\s/.test(line))) return "md";
  if (/<[a-z][^>]*>/i.test(content)) return "html";
  return "txt";
}
