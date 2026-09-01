import { describe, expect, it } from "vitest";
import { verifyAccess } from "../src/access";
import { generateTestKeypair, signTestJwt } from "./helpers/jwt";

const TEAM = "test-team";
const AUD = "test-aud";
const JWKS_URL = `https://${TEAM}.cloudflareaccess.com/cdn-cgi/access/certs`;

function fetchServing(jwk: { kid: string; kty: string; n: string; e: string }): typeof fetch {
  return (async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    if (url === JWKS_URL) {
      return new Response(JSON.stringify({ keys: [jwk] }), { status: 200 });
    }
    return new Response("not found", { status: 404 });
  }) as typeof fetch;
}

function reqWithToken(token: string): Request {
  return new Request("https://poit.example.com/api/v1/artifacts", {
    headers: { "Cf-Access-Jwt-Assertion": token },
  });
}

describe("verifyAccess", () => {
  it("accepts a valid token", async () => {
    const { privateKey, jwk } = await generateTestKeypair();
    const token = await signTestJwt(privateKey, jwk.kid, {
      email: "a@example.com",
      sub: "sub-1",
      aud: [AUD],
      exp: Math.floor(Date.now() / 1000) + 3600,
    });
    const identity = await verifyAccess(reqWithToken(token), TEAM, AUD, fetchServing(jwk));
    expect(identity?.email).toBe("a@example.com");
  });

  it("accepts token via CF_Authorization cookie", async () => {
    const { privateKey, jwk } = await generateTestKeypair("cookie-kid");
    const token = await signTestJwt(privateKey, jwk.kid, {
      email: "a@example.com",
      sub: "sub-1",
      aud: AUD,
      exp: Math.floor(Date.now() / 1000) + 3600,
    });
    const req = new Request("https://poit.example.com/", { headers: { Cookie: `CF_Authorization=${token}` } });
    const identity = await verifyAccess(req, TEAM, AUD, fetchServing(jwk));
    expect(identity?.email).toBe("a@example.com");
  });

  it("rejects expired token", async () => {
    const { privateKey, jwk } = await generateTestKeypair("expired-kid");
    const token = await signTestJwt(privateKey, jwk.kid, {
      email: "a@example.com",
      sub: "sub-1",
      aud: [AUD],
      exp: Math.floor(Date.now() / 1000) - 60,
    });
    expect(await verifyAccess(reqWithToken(token), TEAM, AUD, fetchServing(jwk))).toBeNull();
  });

  it("rejects wrong aud", async () => {
    const { privateKey, jwk } = await generateTestKeypair("wrongaud-kid");
    const token = await signTestJwt(privateKey, jwk.kid, {
      email: "a@example.com",
      sub: "sub-1",
      aud: ["other-aud"],
      exp: Math.floor(Date.now() / 1000) + 3600,
    });
    expect(await verifyAccess(reqWithToken(token), TEAM, AUD, fetchServing(jwk))).toBeNull();
  });

  it("rejects tampered signature", async () => {
    const { privateKey, jwk } = await generateTestKeypair("tampered-kid");
    const token = await signTestJwt(privateKey, jwk.kid, {
      email: "a@example.com",
      sub: "sub-1",
      aud: [AUD],
      exp: Math.floor(Date.now() / 1000) + 3600,
    });
    const tampered = token.slice(0, -4) + "abcd";
    expect(await verifyAccess(reqWithToken(tampered), TEAM, AUD, fetchServing(jwk))).toBeNull();
  });

  it("rejects alg:none", async () => {
    const { jwk } = await generateTestKeypair("algnone-kid");
    const header = btoa(JSON.stringify({ alg: "none", kid: jwk.kid, typ: "JWT" }))
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
    const payload = btoa(
      JSON.stringify({ email: "a@example.com", sub: "s", aud: [AUD], exp: Math.floor(Date.now() / 1000) + 3600 })
    )
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
    const token = `${header}.${payload}.`;
    expect(await verifyAccess(reqWithToken(token), TEAM, AUD, fetchServing(jwk))).toBeNull();
  });

  it("rejects missing token", async () => {
    const req = new Request("https://poit.example.com/");
    expect(await verifyAccess(req, TEAM, AUD)).toBeNull();
  });

  it("rejects a malformed token (not three dot-separated parts)", async () => {
    expect(await verifyAccess(reqWithToken("not-a-valid-jwt"), TEAM, AUD)).toBeNull();
  });

  it("rejects a token with no kid in the header", async () => {
    const b64url = (s: string) => btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
    const payload = b64url(
      JSON.stringify({ email: "a@example.com", sub: "s", aud: [AUD], exp: Math.floor(Date.now() / 1000) + 3600 })
    );
    expect(await verifyAccess(reqWithToken(`${header}.${payload}.sig`), TEAM, AUD)).toBeNull();
  });

  it("rejects a token with no exp claim", async () => {
    const { privateKey, jwk } = await generateTestKeypair("noexp-kid");
    const token = await signTestJwt(privateKey, jwk.kid, { email: "a@example.com", sub: "sub-1", aud: [AUD] });
    expect(await verifyAccess(reqWithToken(token), TEAM, AUD, fetchServing(jwk))).toBeNull();
  });

  it("rejects a kid that isn't in the JWKS, even after the forced refetch", async () => {
    const { privateKey, jwk } = await generateTestKeypair("orphan-kid");
    const token = await signTestJwt(privateKey, jwk.kid, {
      email: "a@example.com",
      sub: "sub-1",
      aud: [AUD],
      exp: Math.floor(Date.now() / 1000) + 3600,
    });
    // JWKS never serves the signing key's kid, on the initial fetch or the
    // forced retry - simulates a token signed with a key that was rotated
    // out (or never belonged to this team) rather than merely stale-cached.
    const unrelated = (await generateTestKeypair("unrelated-kid")).jwk;
    expect(await verifyAccess(reqWithToken(token), TEAM, AUD, fetchServing(unrelated))).toBeNull();
  });

  it("fails closed when the JWKS endpoint is unreachable/erroring", async () => {
    const { privateKey, jwk } = await generateTestKeypair("jwks-down-kid");
    const token = await signTestJwt(privateKey, jwk.kid, {
      email: "a@example.com",
      sub: "sub-1",
      aud: [AUD],
      exp: Math.floor(Date.now() / 1000) + 3600,
    });
    const brokenFetch = (async () => new Response("service unavailable", { status: 503 })) as typeof fetch;
    expect(await verifyAccess(reqWithToken(token), TEAM, AUD, brokenFetch)).toBeNull();
  });
});
