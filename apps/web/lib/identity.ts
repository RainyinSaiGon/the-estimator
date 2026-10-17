import { cookies } from "next/headers";

export const identityCookieName = "estimator_session";

export type IdentityAccount = {
  accountId: string;
  email: string;
  displayName: string;
};

type IdentityConfiguration = {
  url: string;
  serviceSecret: string;
};

function readIdentityConfiguration(): IdentityConfiguration | null {
  const url = process.env.IDENTITY_SERVICE_URL?.trim().replace(/\/+$/, "") ?? "";
  const serviceSecret = process.env.IDENTITY_BFF_SHARED_SECRET?.trim() ?? "";
  if (!url && !serviceSecret) return null;
  if (!url || new TextEncoder().encode(serviceSecret).byteLength < 32) return null;

  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" && parsed.hostname !== "localhost" && parsed.hostname !== "127.0.0.1" && parsed.hostname !== "identity") return null;
    if (parsed.username || parsed.password || parsed.search || parsed.hash) return null;
  } catch {
    return null;
  }

  return { url, serviceSecret };
}

export function identityAuthConfigured() {
  return readIdentityConfiguration() !== null;
}

export async function identityRequest(
  path: string,
  init: Omit<RequestInit, "headers"> & { headers?: Record<string, string> } = {},
) {
  const configuration = readIdentityConfiguration();
  if (!configuration) return null;

  try {
    return await fetch(configuration.url + path, {
      ...init,
      headers: {
        ...init.headers,
        "x-identity-bff-secret": configuration.serviceSecret,
      },
      cache: "no-store",
      signal: AbortSignal.timeout(4_000),
    });
  } catch {
    return null;
  }
}

function parseAccount(value: unknown): IdentityAccount | null {
  if (!value || typeof value !== "object") return null;
  const item = value as Record<string, unknown>;
  if (
    typeof item.accountId !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(item.accountId) ||
    typeof item.email !== "string" ||
    typeof item.displayName !== "string"
  ) return null;
  return { accountId: item.accountId, email: item.email, displayName: item.displayName };
}

export async function accountForSession(token?: string): Promise<{ account: IdentityAccount; expiresAt: string } | null> {
  const sessionToken = token ?? (await cookies()).get(identityCookieName)?.value;
  if (!sessionToken || !/^[A-Za-z0-9_-]{43}$/.test(sessionToken)) return null;

  const response = await identityRequest("/v1/session", {
    headers: { authorization: "Bearer " + sessionToken },
  });
  if (!response || !response.ok) return null;

  try {
    const result = await response.json() as { account?: unknown; expiresAt?: unknown };
    const account = parseAccount(result.account);
    if (!account || typeof result.expiresAt !== "string" || !Number.isFinite(Date.parse(result.expiresAt))) return null;
    return { account, expiresAt: result.expiresAt };
  } catch {
    return null;
  }
}

export function sameOriginRequest(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin) return false;
  try {
    const requestUrl = new URL(request.url);
    const forwardedHost = request.headers.get("x-forwarded-host")?.split(",")[0]?.trim();
    const requestHost = forwardedHost || request.headers.get("host") || requestUrl.host;
    const forwardedProtocol = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim();
    const requestProtocol = forwardedProtocol || requestUrl.protocol.slice(0, -1);
    const expectedOrigin = new URL(requestProtocol + "://" + requestHost);
    return new URL(origin).origin === expectedOrigin.origin;
  } catch {
    return false;
  }
}

export function sessionCookie(token: string, expiresAt: string, request: Request) {
  const maxAge = Math.floor((Date.parse(expiresAt) - Date.now()) / 1000);
  if (maxAge <= 0) return null;
  const url = new URL(request.url);
  const forwardedHost = request.headers.get("x-forwarded-host")?.split(",")[0]?.trim();
  const hostHeader = forwardedHost || request.headers.get("host") || url.host;
  const forwardedProtocol = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim();
  let hostName = url.hostname;
  try {
    hostName = new URL(url.protocol + "//" + hostHeader).hostname;
  } catch {
    return null;
  }
  const localHost = hostName === "localhost" || hostName === "127.0.0.1" || hostName === "::1" || hostName.endsWith(".localhost");
  const secure = url.protocol === "https:" || forwardedProtocol === "https:" || process.env.NODE_ENV === "production" && !localHost;
  return identityCookieName + "=" + token + "; Path=/; HttpOnly; SameSite=Lax; Max-Age=" + maxAge + (secure ? "; Secure" : "");
}

export function secureCookieForRequest(request: Request) {
  const url = new URL(request.url);
  const forwardedHost = request.headers.get("x-forwarded-host")?.split(",")[0]?.trim();
  const hostHeader = forwardedHost || request.headers.get("host") || url.host;
  const forwardedProtocol = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim();
  let hostName = url.hostname;
  try {
    hostName = new URL(url.protocol + "//" + hostHeader).hostname;
  } catch {
    return true;
  }
  const localHost = hostName === "localhost" || hostName === "127.0.0.1" || hostName === "::1" || hostName.endsWith(".localhost");
  return url.protocol === "https:" || forwardedProtocol === "https:" || process.env.NODE_ENV === "production" && !localHost;
}
