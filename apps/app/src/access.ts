export interface AccessIdentity {
  email?: string;
  subject: string;
}

interface Jwk {
  kid: string;
  kty: string;
  n: string;
  e: string;
}

const jwksCache = new Map<string, { keys: Jwk[]; fetchedAt: number }>();
const JWKS_TTL_MS = 60 * 60 * 1000;

function base64UrlDecode(input: string): Uint8Array {
  const padded = input + "=".repeat((4 - (input.length % 4)) % 4);
  const base64 = padded.replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

function base64UrlDecodeToString(input: string): string {
  return new TextDecoder().decode(base64UrlDecode(input));
}

async function getJwks(teamDomain: string, forceRefresh = false): Promise<Jwk[]> {
  const cached = jwksCache.get(teamDomain);
  if (!forceRefresh && cached && Date.now() - cached.fetchedAt < JWKS_TTL_MS) return cached.keys;
  const res = await fetch(`https://${teamDomain}.cloudflareaccess.com/cdn-cgi/access/certs`);
  if (!res.ok) throw new Error("failed to fetch cloudflare access certs");
  const body = (await res.json()) as { keys?: Jwk[] };
  const keys = body.keys ?? [];
  jwksCache.set(teamDomain, { keys, fetchedAt: Date.now() });
  return keys;
}

function extractToken(request: Request): string | null {
  const header = request.headers.get("Cf-Access-Jwt-Assertion");
  if (header) return header;
  const cookie = request.headers.get("Cookie");
  if (!cookie) return null;
  const match = cookie.match(/(?:^|;\s*)CF_Authorization=([^;]+)/);
  return match ? match[1] : null;
}

/**
 * Verifies a Cloudflare Access JWT (header or CF_Authorization cookie) against
 * the team's JWKS. Returns the authenticated identity, or null if missing/invalid.
 */
export async function verifyAccess(
  request: Request,
  teamDomain: string,
  /** Comma-separated list of accepted `aud` values (one per Access Application). */
  allowedAuds: string
): Promise<AccessIdentity | null> {
  const token = extractToken(request);
  if (!token) return null;

  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [headerB64, payloadB64, signatureB64] = parts;

  let header: { kid?: string; alg?: string };
  let payload: { email?: string; sub?: string; aud?: string[] | string; exp?: number };
  try {
    header = JSON.parse(base64UrlDecodeToString(headerB64));
    payload = JSON.parse(base64UrlDecodeToString(payloadB64));
  } catch {
    return null;
  }

  if (!header.kid || header.alg !== "RS256") return null;
  if (!payload.exp || payload.exp * 1000 < Date.now()) return null;

  const accepted = allowedAuds.split(",").map((a) => a.trim()).filter(Boolean);
  const audList = Array.isArray(payload.aud) ? payload.aud : payload.aud ? [payload.aud] : [];
  if (accepted.length === 0 || !audList.some((a) => accepted.includes(a))) return null;

  let keys = await getJwks(teamDomain);
  let jwk = keys.find((k) => k.kid === header.kid);
  if (!jwk) {
    // Unknown kid: could be a just-rotated-in signing key, not necessarily
    // an invalid token. Force one bypass-cache refetch before rejecting.
    keys = await getJwks(teamDomain, true);
    jwk = keys.find((k) => k.kid === header.kid);
    if (!jwk) return null;
  }

  const cryptoKey = await crypto.subtle.importKey(
    "jwk",
    { kty: jwk.kty, n: jwk.n, e: jwk.e, alg: "RS256", ext: true },
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["verify"]
  );

  const signingInput = new TextEncoder().encode(`${headerB64}.${payloadB64}`);
  let valid: boolean;
  try {
    const signature = base64UrlDecode(signatureB64);
    valid = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", cryptoKey, signature, signingInput);
  } catch {
    return null;
  }
  if (!valid) return null;

  return { email: payload.email, subject: payload.sub ?? payload.email ?? "unknown" };
}
