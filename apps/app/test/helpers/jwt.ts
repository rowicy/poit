// WebCrypto-only (works identically in workerd and Node) helpers for
// signing test JWTs and serving a fake Cloudflare Access JWKS endpoint.

export interface TestKeypair {
  privateKey: CryptoKey;
  jwk: { kid: string; kty: string; n: string; e: string };
}

export async function generateTestKeypair(kid = "test-kid"): Promise<TestKeypair> {
  const { publicKey, privateKey } = (await crypto.subtle.generateKey(
    { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
    true,
    ["sign", "verify"]
  )) as CryptoKeyPair;
  const jwk = (await crypto.subtle.exportKey("jwk", publicKey)) as JsonWebKey;
  return { privateKey, jwk: { kid, kty: jwk.kty!, n: jwk.n!, e: jwk.e! } };
}

function b64url(buf: ArrayBuffer | string): string {
  const bytes = typeof buf === "string" ? new TextEncoder().encode(buf) : new Uint8Array(buf);
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export async function signTestJwt(
  privateKey: CryptoKey,
  kid: string,
  payload: Record<string, unknown>,
  opts: { alg?: string } = {}
): Promise<string> {
  const header = { alg: opts.alg ?? "RS256", kid, typ: "JWT" };
  const signingInput = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(payload))}`;
  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    privateKey,
    new TextEncoder().encode(signingInput)
  );
  return `${signingInput}.${b64url(signature)}`;
}

/** Monkey-patches globalThis.fetch to serve a fake JWKS response for teamDomain. Returns a restore fn. */
export function mockJwksFetch(teamDomain: string, jwk: TestKeypair["jwk"]): () => void {
  const original = globalThis.fetch;
  const jwksUrl = `https://${teamDomain}.cloudflareaccess.com/cdn-cgi/access/certs`;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    if (url === jwksUrl) {
      return new Response(JSON.stringify({ keys: [jwk] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    return original(input, init);
  }) as typeof fetch;
  return () => {
    globalThis.fetch = original;
  };
}
