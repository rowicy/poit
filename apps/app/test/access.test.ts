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
});
