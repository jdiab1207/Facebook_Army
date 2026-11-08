export interface ParsedProxy {
  host: string;
  port: number;
  username?: string;
  password?: string;
  server: string;
}

/** Accepts host:port, user:pass@host:port, or full http(s):// URL */
export function parseProxyUrl(input: string): ParsedProxy {
  const raw = input.trim();
  if (!raw) {
    throw new Error("Proxy URL is empty");
  }

  let url: URL;
  try {
    url = new URL(raw.includes("://") ? raw : `http://${raw}`);
  } catch {
    throw new Error(`Invalid proxy URL: ${raw}`);
  }

  if (!url.hostname || !url.port) {
    throw new Error("Proxy must include host and port (e.g. user:pass@1.2.3.4:10000)");
  }

  const username = url.username ? decodeURIComponent(url.username) : undefined;
  const password = url.password ? decodeURIComponent(url.password) : undefined;

  return {
    host: url.hostname,
    port: Number(url.port),
    username,
    password,
    server: `http://${url.hostname}:${url.port}`,
  };
}

export function formatProxyDisplay(host: string | null, port: number | null): string | null {
  if (!host || !port) return null;
  return `${host}:${port}`;
}
