import { detectMime } from "./mime";
import { extractInfo, truncateUtf8 } from "./metadata";
import { verifyAccess } from "./access";
import {
  type ArtifactMeta,
  deleteArtifact,
  expiresAtFor,
  getArtifact,
  getArtifactMeta,
  listArtifacts,
  putArtifact,
} from "./store";

export interface Env {
  ARTIFACTS: R2Bucket;
  METADATA: KVNamespace;
  ASSETS: Fetcher;
  CF_ACCESS_TEAM_DOMAIN: string;
  CF_ACCESS_AUD: string;
}

interface ArtifactWriteBody {
  content?: string;
  filename?: string;
  slug?: string;
  visibility?: "public" | "private";
  persist?: boolean;
  mime?: "md" | "html" | "txt";
}

const NO_STORE = { "cache-control": "private, no-store" };
// Keep in sync with apps/app/frontend/src/pages/Home.tsx's SLUG_PATTERN and
// cli/poit/cmd/share.go's slugPattern.
const SLUG_PATTERN = /^[a-z0-9_-]{1,64}$/;
const VALID_MIMES = new Set(["md", "html", "txt"]);
const MAX_CONTENT_LENGTH = 10 * 1024 * 1024; // 10MB, chars ~= bytes for typical md/html/txt uploads
// Cloudflare KV caps a key's `metadata` option (ArtifactMeta, see
// store.ts's putArtifact) at 1024 bytes total, measured in UTF-8 bytes;
// filename is client-supplied and otherwise unbounded, so cap it
// defensively too (title/excerpt are bounded the same way in metadata.ts).
// Byte-safe (not a plain character slice) since a CJK filename can be up
// to 3 UTF-8 bytes per JS string unit.
const MAX_FILENAME_BYTES = 160;

function clampFilename(filename: string | undefined, fallback: string): string {
  return truncateUtf8(filename || fallback, MAX_FILENAME_BYTES);
}

// ponytail: per-isolate in-memory fixed-window counter, not shared across
// isolates/colos, so it only blunts a single client hammering a single
// isolate. Upgrade to a KV- or Durable-Object-backed counter if a
// distributed attacker needs to be stopped for real.
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX_REQUESTS = 30;
const rateLimitCounters = new Map<string, { count: number; windowStart: number }>();

function isRateLimited(key: string): boolean {
  const now = Date.now();
  const entry = rateLimitCounters.get(key);
  if (!entry || now - entry.windowStart >= RATE_LIMIT_WINDOW_MS) {
    rateLimitCounters.set(key, { count: 1, windowStart: now });
    return false;
  }
  entry.count++;
  return entry.count > RATE_LIMIT_MAX_REQUESTS;
}

function json(data: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: { "content-type": "application/json", ...NO_STORE, ...(init.headers ?? {}) },
  });
}

function requireAuth(request: Request, env: Env) {
  return verifyAccess(request, env.CF_ACCESS_TEAM_DOMAIN, env.CF_ACCESS_AUD);
}

function rawCacheKey(origin: string, id: string): Request {
  return new Request(`${origin}/artifact/${id}/raw`);
}

async function parseJsonBody<T>(request: Request): Promise<T | null> {
  try {
    return await request.json<T>();
  } catch {
    return null;
  }
}

async function handleApi(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
  pathname: string
): Promise<Response> {
  const url = new URL(request.url);

  if (pathname === "/api/v1/artifacts" && request.method === "GET") {
    const identity = await requireAuth(request, env);
    if (!identity?.email) return json({ error: "unauthorized" }, { status: 403 });
    const artifacts = await listArtifacts(env.METADATA);
    return json({ artifacts: artifacts.filter((a) => a.owner === identity.email) });
  }

  if (pathname === "/api/v1/artifact" && request.method === "POST") {
    const identity = await requireAuth(request, env);
    if (!identity?.email) return json({ error: "unauthorized" }, { status: 403 });
    if (isRateLimited(identity.email)) return json({ error: "too many requests" }, { status: 429 });

    const body = await parseJsonBody<ArtifactWriteBody>(request);
    if (!body) return json({ error: "invalid JSON body" }, { status: 400 });
    if (typeof body.content !== "string" || !body.content) {
      return json({ error: "content is required" }, { status: 400 });
    }
    if (body.content.length > MAX_CONTENT_LENGTH) {
      return json({ error: "content too large" }, { status: 413 });
    }

    let id: string;
    if (body.slug !== undefined) {
      if (!SLUG_PATTERN.test(body.slug)) {
        return json({ error: "slug must match [a-z0-9_-] (1-64 chars)" }, { status: 400 });
      }
      if (await getArtifactMeta(env.METADATA, body.slug)) {
        return json({ error: "slug already in use" }, { status: 409 });
      }
      id = body.slug;
    } else {
      id = crypto.randomUUID();
    }
    const persist = body.persist ?? false;
    const mime = detectMime(body.content);
    const info = await extractInfo(mime, body.content);
    const meta: ArtifactMeta = {
      id,
      filename: clampFilename(body.filename, id),
      mime,
      visibility: body.visibility === "public" ? "public" : "private",
      persist,
      owner: identity.email,
      createdAt: new Date().toISOString(),
      expiresAt: expiresAtFor(persist),
      title: info.title,
      excerpt: info.excerpt,
    };
    await putArtifact(env.ARTIFACTS, env.METADATA, meta, body.content);
    return json({ artifact: meta, url: `${url.origin}/artifact/${id}` }, { status: 201 });
  }

  const artifactMatch = pathname.match(/^\/api\/v1\/artifact\/([\w-]+)$/);
  if (artifactMatch) {
    const id = artifactMatch[1];

    const identity = await requireAuth(request, env);
    if (!identity?.email) return json({ error: "unauthorized" }, { status: 403 });
    if ((request.method === "DELETE" || request.method === "PUT") && isRateLimited(identity.email)) {
      return json({ error: "too many requests" }, { status: 429 });
    }

    if (request.method === "DELETE") {
      const meta = await getArtifactMeta(env.METADATA, id);
      if (!meta) return json({ error: "not found" }, { status: 404 });
      if (meta.owner !== identity.email) return json({ error: "forbidden" }, { status: 403 });
      await deleteArtifact(env.ARTIFACTS, env.METADATA, id, meta.persist);
      ctx.waitUntil(caches.default.delete(rawCacheKey(url.origin, id)));
      return new Response(null, { status: 204 });
    }

    if (request.method === "PUT") {
      const existing = await getArtifact(env.ARTIFACTS, env.METADATA, id);
      if (!existing) return json({ error: "not found" }, { status: 404 });
      if (existing.meta.owner !== identity.email) return json({ error: "forbidden" }, { status: 403 });

      const body = await parseJsonBody<ArtifactWriteBody>(request);
      if (!body) return json({ error: "invalid JSON body" }, { status: 400 });
      if (typeof body.content === "string" && body.content.length > MAX_CONTENT_LENGTH) {
        return json({ error: "content too large" }, { status: 413 });
      }

      const content = typeof body.content === "string" && body.content ? body.content : existing.content;
      const contentChanged = content !== existing.content;
      const persist = body.persist ?? existing.meta.persist;
      const visibility =
        body.visibility === "public" || body.visibility === "private"
          ? body.visibility
          : existing.meta.visibility;
      // An explicit mime in the request body is a manual override (e.g. the
      // auto-detector guessed wrong); otherwise re-detect only if the
      // content actually changed, else keep what's already stored.
      const mimeOverride = body.mime && VALID_MIMES.has(body.mime) ? body.mime : undefined;
      const mime = mimeOverride ?? (contentChanged ? detectMime(content) : existing.meta.mime);
      const info = contentChanged ? await extractInfo(mime, content) : null;
      const meta: ArtifactMeta = {
        ...existing.meta,
        filename: clampFilename(body.filename, existing.meta.filename),
        mime,
        visibility,
        persist,
        expiresAt: expiresAtFor(persist),
        ...(info ? { title: info.title, excerpt: info.excerpt } : {}),
      };
      await putArtifact(env.ARTIFACTS, env.METADATA, meta, content, existing.meta.persist);
      ctx.waitUntil(caches.default.delete(rawCacheKey(url.origin, id)));
      return json({ artifact: meta });
    }
  }

  return json({ error: "not found" }, { status: 404 });
}

// Served under /artifact/*, which Access leaves open at the edge (see
// infra/main.tf's "artifact_public" application) so external users can view
// a public artifact with no login. Private artifacts still require a valid
// identity, checked here by the Worker itself. Public reads are cached at
// the edge (Cache API) since the same shared link is often opened by many
// viewers; PUT/DELETE above explicitly purge this cache entry so an edit or
// delete can never keep serving stale content.
async function handleArtifactRaw(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
  id: string
): Promise<Response> {
  const cache = caches.default;
  const cacheKey = rawCacheKey(new URL(request.url).origin, id);
  const cached = await cache.match(cacheKey);
  if (cached) return cached;

  const existing = await getArtifact(env.ARTIFACTS, env.METADATA, id);
  if (!existing) return json({ error: "not found" }, { status: 404 });

  if (existing.meta.visibility === "private") {
    const identity = await requireAuth(request, env);
    if (!identity) return json({ error: "unauthorized" }, { status: 403 });
    // BOLA guard: being logged in isn't enough, this artifact must be yours.
    if (identity.email !== existing.meta.owner) return json({ error: "forbidden" }, { status: 403 });
    return json({ artifact: existing.meta, content: existing.content });
  }

  const response = json(
    { artifact: existing.meta, content: existing.content },
    { headers: { "cache-control": "public, max-age=60, s-maxage=31536000" } }
  );
  ctx.waitUntil(cache.put(cacheKey, response.clone()));
  return response;
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    const rawMatch = url.pathname.match(/^\/artifact\/([\w-]+)\/raw$/);
    if (rawMatch) {
      return handleArtifactRaw(request, env, ctx, rawMatch[1]);
    }

    if (url.pathname.startsWith("/api/v1/")) {
      return handleApi(request, env, ctx, url.pathname);
    }

    if (url.pathname === "/" || url.pathname === "/index.html") {
      const identity = await requireAuth(request, env);
      if (!identity) return json({ error: "unauthorized" }, { status: 403 });
    }

    return env.ASSETS.fetch(request);
  },

  // Non-persisted artifacts are cleaned up natively (KV expirationTtl + an
  // R2 lifecycle rule on the "ephemeral/" prefix, see infra/main.tf), so
  // this only needs to be a bounded safety-net sweep, not an exhaustive
  // full-namespace scan.
  async scheduled(_event: ScheduledController, env: Env): Promise<void> {
    const artifacts = await listArtifacts(env.METADATA);
    const now = Date.now();
    for (const artifact of artifacts) {
      if (!artifact.persist && artifact.expiresAt && new Date(artifact.expiresAt).getTime() < now) {
        await deleteArtifact(env.ARTIFACTS, env.METADATA, artifact.id, false);
      }
    }
  },
} satisfies ExportedHandler<Env>;
