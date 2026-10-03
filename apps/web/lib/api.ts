const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";
export class ApiError extends Error { constructor(public status: number, message: string, public body: any) { super(message); } }
export async function api<T = any>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  const r = await fetch(API + path, { ...init, credentials: "include", headers: { ...(init.json ? { "content-type": "application/json" } : {}), ...(init.headers ?? {}) }, body: init.json ? JSON.stringify(init.json) : init.body });
  const body = r.status === 204 ? null : await r.json().catch(() => null);
  if (!r.ok) throw new ApiError(r.status, body?.error ?? "Something went wrong", body);
  return body as T;
}
export const wsUrl = (path: string) => API.replace(/^http/, "ws") + path;
