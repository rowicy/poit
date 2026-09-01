export type ArtifactMime = "md" | "html" | "txt";
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
  title?: string;
  excerpt?: string;
}

export interface ShareOptions {
  visibility: Visibility;
  persist: boolean;
  slug?: string;
}

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

async function apiFetch<T>(path: string, opts?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      ...opts,
      headers: { "content-type": "application/json", ...(opts?.headers ?? {}) },
    });
  } catch {
    throw new Error("通信に失敗しました。ネットワーク接続を確認してください。");
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new ApiError(body.error ?? `request failed: ${res.status}`, res.status);
  }
  if (res.status === 204) return undefined as T;
  return res.json();
}

export function listArtifacts(): Promise<{ artifacts: ArtifactMeta[] }> {
  return apiFetch("/api/v1/artifacts");
}

export function createArtifact(
  content: string,
  filename: string | undefined,
  options: ShareOptions
): Promise<{ artifact: ArtifactMeta; url: string }> {
  return apiFetch("/api/v1/artifact", {
    method: "POST",
    body: JSON.stringify({ content, filename, ...options }),
  });
}

export function updateArtifact(
  id: string,
  body: { content?: string; visibility?: Visibility; persist?: boolean; mime?: ArtifactMime }
): Promise<{ artifact: ArtifactMeta }> {
  return apiFetch(`/api/v1/artifact/${id}`, { method: "PUT", body: JSON.stringify(body) });
}

export function deleteArtifact(id: string): Promise<void> {
  return apiFetch(`/api/v1/artifact/${id}`, { method: "DELETE" });
}

export function getArtifactJson(id: string): Promise<{ artifact: ArtifactMeta; content: string }> {
  return apiFetch(`/artifact/${id}/json`);
}
