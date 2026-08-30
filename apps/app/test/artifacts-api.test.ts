import { createExecutionContext, env, waitOnExecutionContext } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import worker from "../src/index";
import { generateTestKeypair, signTestJwt } from "./helpers/jwt";

const ORIGIN = "https://poit.example.com";
const TEAM = env.CF_ACCESS_TEAM_DOMAIN;
const AUD = env.CF_ACCESS_AUD;

let restoreFetch: () => void;
let keypairs: Record<string, Awaited<ReturnType<typeof generateTestKeypair>>>;

// One shared JWKS containing every test user's key, so a single mocked fetch
// serves all identities used across a test file.
async function setupUsers(emails: string[]) {
  keypairs = {};
  for (const email of emails) {
    keypairs[email] = await generateTestKeypair(`kid-${email}-${Math.random()}`);
  }
  const original = globalThis.fetch;
  const jwksUrl = `https://${TEAM}.cloudflareaccess.com/cdn-cgi/access/certs`;
  const keys = Object.values(keypairs).map((k) => k.jwk);
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    if (url === jwksUrl) {
      return new Response(JSON.stringify({ keys }), { status: 200, headers: { "content-type": "application/json" } });
    }
    return original(input, init);
  }) as typeof fetch;
  restoreFetch = () => {
    globalThis.fetch = original;
  };
}

async function tokenFor(email: string): Promise<string> {
  const { privateKey, jwk } = keypairs[email];
  return signTestJwt(privateKey, jwk.kid, {
    email,
    sub: email,
    aud: [AUD],
    exp: Math.floor(Date.now() / 1000) + 3600,
  });
}

async function authed(email: string, path: string, init: RequestInit = {}): Promise<Response> {
  const token = await tokenFor(email);
  const request = new Request(`${ORIGIN}${path}`, {
    ...init,
    headers: { ...(init.headers ?? {}), "Cf-Access-Jwt-Assertion": token },
  });
  const ctx = createExecutionContext();
  const response = await worker.fetch(request, env, ctx);
  await waitOnExecutionContext(ctx);
  return response;
}

async function anon(path: string, init: RequestInit = {}): Promise<Response> {
  const request = new Request(`${ORIGIN}${path}`, init);
  const ctx = createExecutionContext();
  const response = await worker.fetch(request, env, ctx);
  await waitOnExecutionContext(ctx);
  return response;
}

async function createArtifact(
  email: string,
  body: Record<string, unknown>
): Promise<{ status: number; json: any }> {
  const res = await authed(email, "/api/v1/artifact", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
  return { status: res.status, json: await res.json() };
}

describe("poit API security", () => {
  beforeEach(async () => {
    await setupUsers(["alice@example.com", "bob@example.com"]);
  });

  afterEach(() => {
    restoreFetch();
  });

  describe("API1: BOLA on private artifacts", () => {
    it("owner can read their own private artifact via /artifact/:id/raw", async () => {
      const created = await createArtifact("alice@example.com", {
        content: "# secret",
        visibility: "private",
        slug: "alice-private-1",
      });
      expect(created.status).toBe(201);

      const res = await authed("alice@example.com", "/artifact/alice-private-1/raw");
      expect(res.status).toBe(200);
    });

    it("a different authenticated user cannot read another user's private artifact", async () => {
      const created = await createArtifact("alice@example.com", {
        content: "# secret",
        visibility: "private",
        slug: "alice-private-2",
      });
      expect(created.status).toBe(201);

      const res = await authed("bob@example.com", "/artifact/alice-private-2/raw");
      expect(res.status).toBe(403);
      const body = await res.json();
      expect(body).not.toHaveProperty("content");
    });

    it("an unauthenticated caller cannot read a private artifact", async () => {
      const created = await createArtifact("alice@example.com", {
        content: "# secret",
        visibility: "private",
        slug: "alice-private-3",
      });
      expect(created.status).toBe(201);

      const res = await anon("/artifact/alice-private-3/raw");
      expect(res.status).toBe(403);
    });

    it("a different user cannot PUT another user's artifact", async () => {
      await createArtifact("alice@example.com", {
        content: "# original",
        visibility: "private",
        slug: "alice-put-1",
      });
      const res = await authed("bob@example.com", "/api/v1/artifact/alice-put-1", {
        method: "PUT",
        body: JSON.stringify({ content: "# hijacked" }),
        headers: { "content-type": "application/json" },
      });
      expect(res.status).toBe(403);

      // content must be unchanged
      const raw = await authed("alice@example.com", "/artifact/alice-put-1/raw");
      const rawBody = await raw.json<{ content: string }>();
      expect(rawBody.content).toBe("# original");
    });

    it("a different user cannot DELETE another user's artifact", async () => {
      await createArtifact("alice@example.com", {
        content: "# original",
        visibility: "private",
        slug: "alice-delete-1",
      });
      const res = await authed("bob@example.com", "/api/v1/artifact/alice-delete-1", { method: "DELETE" });
      expect(res.status).toBe(403);

      const raw = await authed("alice@example.com", "/artifact/alice-delete-1/raw");
      expect(raw.status).toBe(200);
    });
  });

  describe("API2/API5: list scoping (BFLA)", () => {
    it("GET /api/v1/artifacts only returns the caller's own artifacts", async () => {
      await createArtifact("alice@example.com", { content: "alice one", slug: "list-alice-1" });
      await createArtifact("bob@example.com", { content: "bob one", slug: "list-bob-1" });

      const res = await authed("alice@example.com", "/api/v1/artifacts");
      expect(res.status).toBe(200);
      const body = await res.json<{ artifacts: { owner: string }[] }>();
      expect(body.artifacts.length).toBeGreaterThan(0);
      expect(body.artifacts.every((a) => a.owner === "alice@example.com")).toBe(true);
    });

    it("rejects requests with no valid Access identity", async () => {
      const res = await anon("/api/v1/artifacts");
      expect(res.status).toBe(403);
    });
  });

  describe("API3: broken object property level authorization (owner spoofing)", () => {
    it("client-supplied owner field is ignored; server sets owner from the JWT identity", async () => {
      const created = await createArtifact("alice@example.com", {
        content: "spoof attempt",
        slug: "spoof-owner-1",
        owner: "bob@example.com",
      });
      expect(created.status).toBe(201);
      expect(created.json.artifact.owner).toBe("alice@example.com");
    });
  });

  describe("API4: unrestricted resource consumption", () => {
    it("rejects content over the size limit", async () => {
      const huge = "a".repeat(10 * 1024 * 1024 + 1);
      const created = await createArtifact("alice@example.com", { content: huge, slug: "too-big-1" });
      expect(created.status).toBe(413);
    });

    it("accepts content at/under the size limit", async () => {
      const big = "a".repeat(1024 * 1024); // 1MB, comfortably under the cap
      const created = await createArtifact("alice@example.com", { content: big, slug: "big-ok-1" });
      expect(created.status).toBe(201);
    });

    it("rejects an oversized PUT body too", async () => {
      await createArtifact("alice@example.com", { content: "small", slug: "put-too-big-1" });
      const huge = "a".repeat(10 * 1024 * 1024 + 1);
      const res = await authed("alice@example.com", "/api/v1/artifact/put-too-big-1", {
        method: "PUT",
        body: JSON.stringify({ content: huge }),
        headers: { "content-type": "application/json" },
      });
      expect(res.status).toBe(413);
    });

    it("throttles a burst of write requests from the same identity", async () => {
      const statuses: number[] = [];
      for (let i = 0; i < 40; i++) {
        const res = await authed("alice@example.com", "/api/v1/artifact", {
          method: "POST",
          body: JSON.stringify({ content: `burst ${i}`, slug: `burst-${i}` }),
          headers: { "content-type": "application/json" },
        });
        statuses.push(res.status);
      }
      expect(statuses.some((s) => s === 429)).toBe(true);
    });
  });
});
