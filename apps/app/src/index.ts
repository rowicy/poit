import { detectMime } from "./mime";
import { verifyAccess } from "./access";
import {
  type ArtifactMeta,
  deleteArtifact,
  expiresAtFor,
  getArtifact,
  listArtifacts,
  putArtifact,
} from "./store";

export interface Env {
  ARTIFACTS: R2Bucket;
  ASSETS: Fetcher;
  CF_ACCESS_TEAM_DOMAIN: string;
  CF_ACCESS_AUD: string;
}

interface ArtifactWriteBody {
  content?: string;
  filename?: string;
  visibility?: "public" | "private";
  persist?: boolean;
}

function json(data: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: { "content-type": "application/json", ...(init.headers ?? {}) },
  });
}

function requireAuth(request: Request, env: Env) {
  return verifyAccess(request, env.CF_ACCESS_TEAM_DOMAIN, env.CF_ACCESS_AUD);
}

async function handleApi(request: Request, env: Env, pathname: string): Promise<Response> {
  const url = new URL(request.url);

  if (pathname === "/api/v1/artifacts" && request.method === "GET") {
    const identity = await requireAuth(request, env);
    if (!identity) return json({ error: "unauthorized" }, { status: 403 });
    return json({ artifacts: await listArtifacts(env.ARTIFACTS) });
  }

  if (pathname === "/api/v1/artifact" && request.method === "POST") {
    const identity = await requireAuth(request, env);
    if (!identity?.email) return json({ error: "unauthorized" }, { status: 403 });

    const body = await request.json<ArtifactWriteBody>();
    if (!body.content) return json({ error: "content is required" }, { status: 400 });

    const id = crypto.randomUUID();
    const persist = body.persist ?? false;
    const meta: ArtifactMeta = {
      id,
      filename: body.filename ?? id,
      mime: detectMime(body.content),
      visibility: body.visibility === "public" ? "public" : "private",
      persist,
      owner: identity.email,
      createdAt: new Date().toISOString(),
      expiresAt: expiresAtFor(persist),
    };
    await putArtifact(env.ARTIFACTS, meta, body.content);
    return json({ artifact: meta, url: `${url.origin}/artifact/${id}` }, { status: 201 });
  }

  const artifactMatch = pathname.match(/^\/api\/v1\/artifact\/([\w-]+)$/);
  if (artifactMatch) {
    const id = artifactMatch[1];

    const identity = await requireAuth(request, env);
    if (!identity?.email) return json({ error: "unauthorized" }, { status: 403 });
    const existing = await getArtifact(env.ARTIFACTS, id);
    if (!existing) return json({ error: "not found" }, { status: 404 });
    if (existing.meta.owner !== identity.email) return json({ error: "forbidden" }, { status: 403 });

    if (request.method === "PUT") {
      const body = await request.json<ArtifactWriteBody>();
      const content = body.content ?? existing.content;
      const persist = body.persist ?? existing.meta.persist;
      const meta: ArtifactMeta = {
        ...existing.meta,
        filename: body.filename ?? existing.meta.filename,
        mime: body.content ? detectMime(content) : existing.meta.mime,
        visibility: body.visibility ?? existing.meta.visibility,
        persist,
        expiresAt: expiresAtFor(persist),
      };
      await putArtifact(env.ARTIFACTS, meta, content);
      return json({ artifact: meta });
    }

    if (request.method === "DELETE") {
      await deleteArtifact(env.ARTIFACTS, id);
      return new Response(null, { status: 204 });
    }
  }

  return json({ error: "not found" }, { status: 404 });
}

// Served under /artifact/*, which Access leaves open at the edge (see
// infra/main.tf's "artifact_public" application) so external users can view
// a public artifact with no login. Private artifacts still require a valid
// identity, checked here by the Worker itself.
async function handleArtifactRaw(request: Request, env: Env, id: string): Promise<Response> {
  const existing = await getArtifact(env.ARTIFACTS, id);
  if (!existing) return json({ error: "not found" }, { status: 404 });
  if (existing.meta.visibility === "private") {
    const identity = await requireAuth(request, env);
    if (!identity) return json({ error: "unauthorized" }, { status: 403 });
  }
  return json({ artifact: existing.meta, content: existing.content });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    const rawMatch = url.pathname.match(/^\/artifact\/([\w-]+)\/raw$/);
    if (rawMatch) {
      return handleArtifactRaw(request, env, rawMatch[1]);
    }

    if (url.pathname.startsWith("/api/v1/")) {
      return handleApi(request, env, url.pathname);
    }

    if (url.pathname === "/" || url.pathname === "/index.html") {
      const identity = await requireAuth(request, env);
      if (!identity) return json({ error: "unauthorized" }, { status: 403 });
    }

    return env.ASSETS.fetch(request);
  },

  async scheduled(_event: ScheduledController, env: Env): Promise<void> {
    const artifacts = await listArtifacts(env.ARTIFACTS);
    const now = Date.now();
    for (const artifact of artifacts) {
      if (!artifact.persist && artifact.expiresAt && new Date(artifact.expiresAt).getTime() < now) {
        await deleteArtifact(env.ARTIFACTS, artifact.id);
      }
    }
  },
} satisfies ExportedHandler<Env>;
