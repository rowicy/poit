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

function contentKeyFor(id: string): string {
  return `artifacts/${id}`;
}

export async function putArtifact(
  bucket: R2Bucket,
  kv: KVNamespace,
  meta: ArtifactMeta,
  content: string
): Promise<void> {
  await bucket.put(contentKeyFor(meta.id), content);
  await kv.put(meta.id, JSON.stringify(meta), { metadata: meta });
}

export async function getArtifact(
  bucket: R2Bucket,
  kv: KVNamespace,
  id: string
): Promise<{ meta: ArtifactMeta; content: string } | null> {
  const rawMeta = await kv.get(id);
  if (!rawMeta) return null;
  const obj = await bucket.get(contentKeyFor(id));
  if (!obj) return null;
  return { meta: JSON.parse(rawMeta) as ArtifactMeta, content: await obj.text() };
}

export async function listArtifacts(kv: KVNamespace): Promise<ArtifactMeta[]> {
  const result: ArtifactMeta[] = [];
  let cursor: string | undefined;
  for (;;) {
    const page = await kv.list<ArtifactMeta>({ cursor });
    for (const key of page.keys) {
      if (key.metadata) result.push(key.metadata);
    }
    if (page.list_complete) break;
    cursor = page.cursor;
  }
  return result.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function deleteArtifact(bucket: R2Bucket, kv: KVNamespace, id: string): Promise<void> {
  await bucket.delete(contentKeyFor(id));
  await kv.delete(id);
}

export function expiresAtFor(persist: boolean): string | undefined {
  return persist ? undefined : new Date(Date.now() + DEFAULT_TTL_MS).toISOString();
}
