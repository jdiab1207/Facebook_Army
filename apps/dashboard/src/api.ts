import type {
  AccountDto,
  ApiKeyDto,
  JobDto,
  StationHealth,
} from "@facebook-army/shared";

const TOKEN_KEY = "fa_admin_token";

export function getAdminToken(): string {
  return localStorage.getItem(TOKEN_KEY) || "";
}

export function setAdminToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token);
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  const token = getAdminToken();
  if (token) headers.set("x-admin-token", token);

  // Fastify rejects empty bodies when Content-Type is application/json
  const method = (init.method || "GET").toUpperCase();
  const hasBody = init.body !== undefined && init.body !== null;
  let body = init.body;
  if (hasBody) {
    headers.set("content-type", "application/json");
  } else if (method === "POST" || method === "PATCH" || method === "PUT") {
    headers.set("content-type", "application/json");
    body = "{}";
  }

  const res = await fetch(path, { ...init, headers, body });
  if (!res.ok) {
    const errBody = await res.json().catch(() => ({} as Record<string, unknown>));
    const err = errBody.error ?? errBody.message;
    const message =
      typeof err === "string"
        ? err
        : err && typeof err === "object"
          ? JSON.stringify(err)
          : res.statusText;
    throw new Error(message);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

export const api = {
  health: () => request<StationHealth & { liveBrowsers?: number }>("/api/health"),
  bootstrap: () =>
    request<{ adminToken: string; port: number; tip: string }>("/api/admin/bootstrap"),
  accounts: () => request<AccountDto[]>("/api/accounts"),
  createAccount: (body: Record<string, unknown>) =>
    request<AccountDto>("/api/accounts", { method: "POST", body: JSON.stringify(body) }),
  updateAccount: (id: string, body: Record<string, unknown>) =>
    request<AccountDto>(`/api/accounts/${id}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),
  deleteAccount: (id: string) =>
    request<void>(`/api/accounts/${id}`, { method: "DELETE" }),
  openLogin: (id: string) =>
    request<JobDto>(`/api/accounts/${id}/login`, { method: "POST" }),
  control: (id: string) =>
    request<JobDto>(`/api/accounts/${id}/control`, { method: "POST" }),
  markReady: (id: string) =>
    request<AccountDto>(`/api/accounts/${id}/mark-ready`, { method: "POST" }),
  screenshot: (id: string) =>
    request<JobDto>(`/api/accounts/${id}/screenshot`, { method: "POST" }),
  pause: (id: string) =>
    request<{ account: AccountDto; cancelledJobs: number; note: string }>(
      `/api/accounts/${id}/pause`,
      { method: "POST" }
    ),
  resume: (id: string) =>
    request<AccountDto>(`/api/accounts/${id}/resume`, { method: "POST" }),
  closeBrowser: (id: string) =>
    request<{ ok: boolean }>(`/api/accounts/${id}/close-browser`, { method: "POST" }),
  jobs: (accountId?: string) =>
    request<JobDto[]>(
      accountId ? `/api/jobs?accountId=${encodeURIComponent(accountId)}` : "/api/jobs"
    ),
  keys: () => request<ApiKeyDto[]>("/api/keys"),
  createKey: (body: { name: string; clientName: string; accountIds: string[] }) =>
    request<{ key: ApiKeyDto; rawKey: string }>("/api/keys", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  deleteKey: (id: string) =>
    request<void>(`/api/keys/${id}`, { method: "DELETE" }),
};
