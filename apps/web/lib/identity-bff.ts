import { cookies } from "next/headers";
import { createHmac } from "node:crypto";
import { accountForSession, identityCookieName, identityRequest, sameOriginRequest, secureCookieForRequest, sessionCookie } from "./identity";

const maxBodyBytes = 8 * 1024;
const sessionTokenPattern = /^[A-Za-z0-9_-]{43}$/;

function requestRateHeaders(request: Request) {
  const secret = process.env.IDENTITY_BFF_SHARED_SECRET?.trim() ?? "";
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const realIP = request.headers.get("x-real-ip")?.trim();
  const candidate = forwarded || realIP || "unknown";
  const address = /^[0-9a-fA-F:.]{1,64}$/.test(candidate) ? candidate.toLowerCase() : "unknown";
  const key = createHmac("sha256", secret).update("the-estimator:identity-request-rate:v1\0" + address).digest("base64url");
  return { "x-identity-rate-key": key };
}

function json(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return Response.json(body, {
    status,
    headers: { "cache-control": "no-store", ...headers },
  });
}

async function boundedJSON(request: Request): Promise<Record<string, unknown> | null> {
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) return null;
  const contentLength = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(contentLength) && contentLength > maxBodyBytes) return null;
  const body = await request.text();
  if (new TextEncoder().encode(body).byteLength > maxBodyBytes) return null;
  try {
    const value = JSON.parse(body) as unknown;
    return value !== null && typeof value === "object" && !Array.isArray(value)
      ? value as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

function requestFailure(status: number) {
  if (status === 400) return json({ error: "Check the account details and password requirements." }, 400);
  if (status === 401) return json({ error: "The email or password is incorrect." }, 401);
  if (status === 409) return json({ error: "An account could not be created with those details." }, 409);
  if (status === 429) return json({ error: "Too many sign-in attempts. Try again later." }, 429);
  return json({ error: "The identity service is temporarily unavailable." }, 503);
}

export async function createIdentitySession(request: Request, endpoint: "/v1/accounts" | "/v1/sessions") {
  if (!sameOriginRequest(request)) return json({ error: "This request must come from The Estimator." }, 403);
  const body = await boundedJSON(request);
  if (!body) return json({ error: "Provide a valid JSON request under 8 KB." }, 400);
  const registering = endpoint === "/v1/accounts";
  if (
    typeof body.email !== "string" ||
    registering && typeof body.displayName !== "string" ||
    !registering && typeof body.password !== "string"
  ) return json({ error: "Check the account details and password requirements." }, 400);

  const response = await identityRequest(endpoint, {
    method: "POST",
    headers: { "content-type": "application/json", ...requestRateHeaders(request) },
    body: JSON.stringify(registering
      ? { email: body.email, displayName: body.displayName }
      : { email: body.email, password: body.password }),
  });
  if (!response) return json({ error: "The identity service is not configured or is unavailable." }, 503);
  if (!response.ok) return requestFailure(response.status);

  try {
    const payload = await response.json() as {
      account?: { accountId?: unknown; email?: unknown; displayName?: unknown; emailVerified?: unknown };
      verificationRequired?: unknown;
      sessionToken?: unknown;
      expiresAt?: unknown;
    };
    if (registering) {
      if (payload.verificationRequired !== true || payload.sessionToken !== undefined || payload.account !== undefined) {
        return json({ error: "The identity service returned an invalid response." }, 502);
      }
      return json({ verificationRequired: true }, 202);
    }

    const account = payload.account;
    if (
      !account ||
      typeof account.accountId !== "string" ||
      typeof account.email !== "string" ||
      typeof account.displayName !== "string" ||
      typeof account.emailVerified !== "boolean"
    ) return json({ error: "The identity service returned an invalid response." }, 502);

    if (
      typeof payload.sessionToken !== "string" ||
      !sessionTokenPattern.test(payload.sessionToken) ||
      typeof payload.expiresAt !== "string" ||
      !Number.isFinite(Date.parse(payload.expiresAt))
    ) return json({ error: "The identity service returned an invalid response." }, 502);

    const cookie = sessionCookie(payload.sessionToken, payload.expiresAt, request);
    if (!cookie) return json({ error: "The sign-in session could not be created." }, 502);
    return json({ account }, 200, { "set-cookie": cookie });
  } catch {
    return json({ error: "The identity service returned an invalid response." }, 502);
  }
}

export async function readIdentitySession() {
  const token = (await cookies()).get(identityCookieName)?.value;
  const session = token ? await accountForSession(token) : null;
  if (!session) return json({ error: "Sign in to continue." }, 401);
  return json(session);
}

export async function renewIdentitySession(request: Request) {
  if (!sameOriginRequest(request)) return json({ error: "This request must come from The Estimator." }, 403);
  const token = (await cookies()).get(identityCookieName)?.value;
  if (!token || !sessionTokenPattern.test(token)) {
    return new Response(null, { status: 303, headers: { "cache-control": "no-store", location: "/sign-in?returnTo=%2Faccount" } });
  }

  const response = await identityRequest("/v1/session/renew", {
    method: "POST",
    headers: { authorization: "Bearer " + token },
  });
  if (!response) return json({ error: "The identity service is temporarily unavailable." }, 503);
  if (response.status === 401) {
    const secure = secureCookieForRequest(request);
    const clearCookie = identityCookieName + "=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0" + (secure ? "; Secure" : "");
    return new Response(null, {
      status: 303,
      headers: {
        "cache-control": "no-store",
        location: "/sign-in?returnTo=%2Faccount",
        "set-cookie": clearCookie,
      },
    });
  }
  if (!response.ok) return requestFailure(response.status);

  try {
    const payload = await response.json() as {
      account?: { accountId?: unknown; email?: unknown; displayName?: unknown; emailVerified?: unknown };
      sessionToken?: unknown;
      expiresAt?: unknown;
    };
    const account = payload.account;
    if (
      !account ||
      typeof account.accountId !== "string" ||
      typeof account.email !== "string" ||
      typeof account.displayName !== "string" ||
      typeof account.emailVerified !== "boolean" ||
      typeof payload.sessionToken !== "string" ||
      !sessionTokenPattern.test(payload.sessionToken) ||
      typeof payload.expiresAt !== "string" ||
      !Number.isFinite(Date.parse(payload.expiresAt))
    ) return json({ error: "The identity service returned an invalid response." }, 502);

    const cookie = sessionCookie(payload.sessionToken, payload.expiresAt, request);
    if (!cookie) return json({ error: "The renewed session could not be saved." }, 502);
    return new Response(null, {
      status: 303,
      headers: { "cache-control": "no-store", location: "/account", "set-cookie": cookie },
    });
  } catch {
    return json({ error: "The identity service returned an invalid response." }, 502);
  }
}

export async function revokeIdentitySession(request: Request) {
  if (!sameOriginRequest(request)) return json({ error: "This request must come from The Estimator." }, 403);
  const token = (await cookies()).get(identityCookieName)?.value;
  let status = 303;
  if (token && sessionTokenPattern.test(token)) {
    const response = await identityRequest("/v1/session", {
      method: "DELETE",
      headers: { authorization: "Bearer " + token },
    });
    if (!response || !response.ok && response.status !== 204) status = 503;
  }
  const secure = secureCookieForRequest(request);
  const clearCookie = identityCookieName + "=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0" + (secure ? "; Secure" : "");
  return new Response(null, {
    status,
    headers: {
      "cache-control": "no-store",
      location: "/",
      "set-cookie": clearCookie,
    },
  });
}

export async function requestIdentityVerification(request: Request) {
  if (!sameOriginRequest(request)) return json({ error: "This request must come from The Estimator." }, 403);
  const token = (await cookies()).get(identityCookieName)?.value;
  if (!token || !sessionTokenPattern.test(token)) return json({ error: "Sign in to continue." }, 401);
  const response = await identityRequest("/v1/email-verifications", {
    method: "POST",
    headers: { authorization: "Bearer " + token, ...requestRateHeaders(request) },
  });
  if (!response) return json({ error: "The identity service is temporarily unavailable." }, 503);
  if (response.status === 202) return json({ message: "If your email still needs verification, a link will be sent." }, 202);
  if (response.status === 429) return json({ error: "Verification requests are temporarily limited." }, 429);
  if (response.status === 401) return json({ error: "Sign in to continue." }, 401);
  return json({ error: response.status === 503 ? "Email delivery is unavailable." : "The verification request could not be completed." }, response.status === 503 ? 503 : 502);
}

export async function completeIdentityVerification(request: Request) {
  if (!sameOriginRequest(request)) return json({ error: "This request must come from The Estimator." }, 403);
  const body = await boundedJSON(request);
  if (!body || typeof body.token !== "string" || typeof body.newPassword !== "string") {
    return json({ error: "Provide a valid verification link and password." }, 400);
  }
  const response = await identityRequest("/v1/email-verifications/complete", {
    method: "POST",
    headers: { "content-type": "application/json", ...requestRateHeaders(request) },
    body: JSON.stringify({ token: body.token, newPassword: body.newPassword }),
  });
  if (!response) return json({ error: "The identity service is temporarily unavailable." }, 503);
  if (response.status === 200) {
    try {
      const payload = await response.json() as {
        account?: { accountId?: unknown; email?: unknown; displayName?: unknown; emailVerified?: unknown };
        sessionToken?: unknown;
        expiresAt?: unknown;
      };
      const account = payload.account;
      if (
        !account || typeof account.accountId !== "string" || typeof account.email !== "string" ||
        typeof account.displayName !== "string" || account.emailVerified !== true ||
        typeof payload.sessionToken !== "string" || !sessionTokenPattern.test(payload.sessionToken) ||
        typeof payload.expiresAt !== "string" || !Number.isFinite(Date.parse(payload.expiresAt))
      ) return json({ error: "The identity service returned an invalid response." }, 502);
      const cookie = sessionCookie(payload.sessionToken, payload.expiresAt, request);
      if (!cookie) return json({ error: "The sign-in session could not be created." }, 502);
      return json({ account }, 200, { "set-cookie": cookie });
    } catch {
      return json({ error: "The identity service returned an invalid response." }, 502);
    }
  }
  if (response.status === 429) return json({ error: "Verification attempts are temporarily limited." }, 429);
  if (response.status === 400) return json({ error: "This verification link is invalid or expired." }, 400);
  return json({ error: "The identity service is temporarily unavailable." }, 503);
}

export async function requestIdentityPasswordRecovery(request: Request) {
  if (!sameOriginRequest(request)) return json({ error: "This request must come from The Estimator." }, 403);
  const body = await boundedJSON(request);
  if (!body || typeof body.email !== "string") return json({ error: "Provide a valid email address." }, 400);
  const response = await identityRequest("/v1/password-recovery-requests", {
    method: "POST",
    headers: { "content-type": "application/json", ...requestRateHeaders(request) },
    body: JSON.stringify({ email: body.email }),
  });
  if (!response) return json({ error: "The identity service is temporarily unavailable." }, 503);
  if (response.status === 202) return json({ message: "If an eligible account exists, recovery instructions will be sent." }, 202);
  if (response.status === 400) return json({ error: "Provide a valid email address." }, 400);
  if (response.status === 429) return json({ error: "Recovery requests are temporarily limited." }, 429);
  return json({ error: response.status === 503 ? "Email delivery is unavailable." : "The recovery request could not be completed." }, response.status === 503 ? 503 : 502);
}

export async function completeIdentityPasswordRecovery(request: Request) {
  if (!sameOriginRequest(request)) return json({ error: "This request must come from The Estimator." }, 403);
  const body = await boundedJSON(request);
  if (!body || typeof body.token !== "string" || typeof body.newPassword !== "string") {
    return json({ error: "Provide a valid recovery link and new password." }, 400);
  }
  const response = await identityRequest("/v1/password-recoveries", {
    method: "POST",
    headers: { "content-type": "application/json", ...requestRateHeaders(request) },
    body: JSON.stringify({ token: body.token, newPassword: body.newPassword }),
  });
  if (!response) return json({ error: "The identity service is temporarily unavailable." }, 503);
  if (response.status === 204) return json({ ok: true });
  if (response.status === 400) return json({ error: "The recovery link or new password is invalid." }, 400);
  if (response.status === 429) return json({ error: "Recovery attempts are temporarily limited." }, 429);
  return json({ error: "The identity service is temporarily unavailable." }, 503);
}
