import type { ArtifactMime } from "./mime";

export type Visibility = "public" | "private";

export interface ArtifactMeta {
  id: string;
  filename: string;
  mime: ArtifactMime;
  visibility: Visibility;
  persist: boolean;
  owner: string;
  createdAt: string;
  expiresAt?: string;
}

const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;
const PREFIX = "artifacts/";

function keyFor(id: string): string {
  return `${PREFIX}${id}`;
}

function metaToCustomMetadata(meta: ArtifactMeta): Record<string, string> {
  return {
    filename: meta.filename,
    mime: meta.mime,
    visibility: meta.visibility,
    persist: String(meta.persist),
    owner: meta.owner,
    createdAt: meta.createdAt,
    ...(meta.expiresAt ? { expiresAt: meta.expiresAt } : {}),
  };
}

function customMetadataToMeta(id: string, custom: Record<string, string>): ArtifactMeta {
  return {
    id,
    filename: custom.filename ?? "untitled",
    mime: (custom.mime as ArtifactMime) ?? "txt",
    visibility: (custom.visibility as Visibility) ?? "private",
    persist: custom.persist === "true",
    owner: custom.owner ?? "",
    createdAt: custom.createdAt ?? new Date(0).toISOString(),
    expiresAt: custom.expiresAt,
  };
}

export async function putArtifact(bucket: R2Bucket, meta: ArtifactMeta, content: string): Promise<void> {
  await bucket.put(keyFor(meta.id), content, { customMetadata: metaToCustomMetadata(meta) });
}

export async function getArtifact(
  bucket: R2Bucket,
  id: string
): Promise<{ meta: ArtifactMeta; content: string } | null> {
  const obj = await bucket.get(keyFor(id));
  if (!obj) return null;
  const meta = customMetadataToMeta(id, (obj.customMetadata ?? {}) as Record<string, string>);
  return { meta, content: await obj.text() };
}

export async function listArtifacts(bucket: R2Bucket): Promise<ArtifactMeta[]> {
  const result: ArtifactMeta[] = [];
  let cursor: string | undefined;
  do {
    const page: R2Objects = await bucket.list({ prefix: PREFIX, cursor, include: ["customMetadata"] });
    for (const obj of page.objects) {
      const id = obj.key.slice(PREFIX.length);
      result.push(customMetadataToMeta(id, (obj.customMetadata ?? {}) as Record<string, string>));
    }
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
  return result.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function deleteArtifact(bucket: R2Bucket, id: string): Promise<void> {
  await bucket.delete(keyFor(id));
}

export function expiresAtFor(persist: boolean): string | undefined {
  return persist ? undefined : new Date(Date.now() + DEFAULT_TTL_MS).toISOString();
}
