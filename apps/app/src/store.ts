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
  /** First heading/<title> found in the content, if any. */
  title?: string;
  /** Leading body text (tags/headings stripped), truncated. */
  excerpt?: string;
}

// Keep in sync with infra/main.tf's R2 lifecycle rule max_age.
export const DEFAULT_TTL_SECONDS = 90 * 24 * 60 * 60;
const KV_MIN_TTL_SECONDS = 60;

function contentKeyFor(id: string, persist: boolean): string {
  return persist ? `artifacts/${id}` : `ephemeral/${id}`;
}

export async function putArtifact(
  bucket: R2Bucket,
  kv: KVNamespace,
  meta: ArtifactMeta,
  content: string,
  previousPersist?: boolean
): Promise<void> {
  // If persistence changed on an edit, the R2 body moves between the
  // "artifacts/" (kept forever) and "ephemeral/" (R2 lifecycle-managed)
  // prefixes, so drop the old copy once the new one is written.
  if (previousPersist !== undefined && previousPersist !== meta.persist) {
    await bucket.delete(contentKeyFor(meta.id, previousPersist));
  }

  await bucket.put(contentKeyFor(meta.id, meta.persist), content);
  await kv.put(meta.id, JSON.stringify(meta), {
    metadata: meta,
    // Non-persisted artifacts are evicted natively by KV; no cron scan needed.
    ...(meta.persist ? {} : { expirationTtl: ttlSecondsFor(meta.expiresAt) }),
  });
}

function ttlSecondsFor(expiresAt: string | undefined): number {
  const remaining = expiresAt ? Math.round((new Date(expiresAt).getTime() - Date.now()) / 1000) : 0;
  return Math.max(KV_MIN_TTL_SECONDS, remaining);
}

export async function getArtifactMeta(kv: KVNamespace, id: string): Promise<ArtifactMeta | null> {
  const raw = await kv.get(id);
  return raw ? (JSON.parse(raw) as ArtifactMeta) : null;
}

export async function getArtifact(
  bucket: R2Bucket,
  kv: KVNamespace,
  id: string
): Promise<{ meta: ArtifactMeta; content: string } | null> {
  const rawMeta = await kv.get(id);
  if (!rawMeta) return null;
  const meta = JSON.parse(rawMeta) as ArtifactMeta;
  const obj = await bucket.get(contentKeyFor(id, meta.persist));
  if (!obj) return null;
  return { meta, content: await obj.text() };
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

export async function deleteArtifact(
  bucket: R2Bucket,
  kv: KVNamespace,
  id: string,
  persist: boolean
): Promise<void> {
  // KV first: if this throws, the R2 object is merely orphaned (invisible,
  // harmless). Deleting R2 first and having the KV delete fail would instead
  // leave a "ghost" entry that stays in listArtifacts() forever while every
  // read 404s, since getArtifact() requires both records to exist.
  await kv.delete(id);
  await bucket.delete(contentKeyFor(id, persist));
}

export function expiresAtFor(persist: boolean): string | undefined {
  return persist ? undefined : new Date(Date.now() + DEFAULT_TTL_SECONDS * 1000).toISOString();
}
