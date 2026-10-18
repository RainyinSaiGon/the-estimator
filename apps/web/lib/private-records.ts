import { randomUUID } from "node:crypto";
import { SignJWT } from "jose";
import { getToken } from "next-auth/jwt";
import type { NextRequest } from "next/server";
import { oidcConfiguration, oidcConfigured, privateRecordRetentionDays } from "../auth";
import { accountForSession, identityAuthConfigured, identityRequest, sameOriginRequest } from "./identity";
import { configuredServiceUrl, logHttpResponse, resolveRequestId } from "./operations.ts";

const maxRecordBytes = 15_000_000;
const defaultServiceTokenKeyID = "legacy";

function noStore(body: unknown, status = 200) {
  return Response.json(body, { status, headers: { "cache-control": "no-store" } });
}

async function readBoundedBody(request: Request): Promise<ArrayBuffer | Response> {
  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (contentLength > maxRecordBytes) return noStore({ error: "The saved estimate is too large." }, 413);
  const reader = request.body?.getReader();
  if (!reader) return new ArrayBuffer(0);
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxRecordBytes) {
      await reader.cancel();
      return noStore({ error: "The saved estimate is too large." }, 413);
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes.buffer;
}

function activeServiceTokenKey() {
  const secret = process.env.SERVICE_TOKEN_SECRET?.trim() ?? "";
  const keyID = process.env.SERVICE_TOKEN_KEY_ID?.trim() || defaultServiceTokenKeyID;
  if (!secret || new TextEncoder().encode(secret).byteLength < 32 || !/^[A-Za-z0-9._-]{1,64}$/.test(keyID)) return null;
  return { keyID, secret };
}

function requiredServiceScope(method: string, path: string) {
  if (path === "/v1/records/migrate-owner") return method === "POST" ? "private-records:migrate" : null;
  if (method === "GET" && (path === "/v1/records" || path.startsWith("/v1/records/"))) return "private-records:read";
  if (method === "POST" && path === "/v1/records") return "private-records:create";
  if (method === "DELETE" && (path === "/v1/records" || path.startsWith("/v1/records/"))) return "private-records:delete";
  return null;
}

async function serviceAuthorization(scope: string): Promise<string | Response> {
  if (!identityAuthConfigured()) return noStore({ error: "First-party sign-in has not been configured." }, 503);
  const key = activeServiceTokenKey();
  if (!key) return noStore({ error: "Private records are not configured." }, 503);

  const session = await accountForSession();
  if (!session) {
    return noStore({ error: "Sign in to access your private workspace." }, 401);
  }

  return serviceToken(key, { identity_authority: "first-party-v1" }, session.account.accountId, scope);
}

async function serviceToken(key: { keyID: string; secret: string }, claims: Record<string, string>, subject: string, scope: string) {
  const token = await new SignJWT({ ...claims, scope })
    .setProtectedHeader({ alg: "HS256", typ: "JWT", kid: key.keyID })
    .setIssuer("the-estimator-web")
    .setAudience("the-estimator-go")
    .setSubject(subject)
    .setIssuedAt()
    .setExpirationTime("60s")
    .setJti(randomUUID())
    .sign(new TextEncoder().encode(key.secret));
  return `Bearer ${token}`;
}

async function migrationAuthorization(request: Request): Promise<string | Response> {
  if (!identityAuthConfigured()) return noStore({ error: "First-party sign-in has not been configured." }, 503);
  if (!oidcConfigured || !oidcConfiguration) return noStore({ error: "The previous sign-in provider is not configured for workspace migration." }, 503);
  const firstParty = await accountForSession();
  if (!firstParty) return noStore({ error: "Sign in to your new account before moving the old workspace." }, 401);
  const key = activeServiceTokenKey();
  if (!key) return noStore({ error: "Private records are not configured." }, 503);

  let legacySession;
  try {
    legacySession = await getToken({ req: request as NextRequest, secret: oidcConfiguration.nextAuthSecret });
  } catch {
    return noStore({ error: "Sign in with the previous provider to migrate its workspace." }, 401);
  }
  const issuer = legacySession?.estimatorIssuer;
  const subject = legacySession?.estimatorSubject;
  if (issuer !== oidcConfiguration.issuer || typeof subject !== "string" || !subject.trim() || subject.length > 512) {
    return noStore({ error: "Sign in with the previous provider to migrate its workspace." }, 401);
  }

  return serviceToken(key, {
    identity_authority: "first-party-v1",
    legacy_oidc_issuer: issuer,
    legacy_oidc_subject: subject,
  }, firstParty.account.accountId, "private-records:migrate");
}

export async function proxyPrivateRecordRequest(request: Request, servicePath: string) {
  const requestId = resolveRequestId(request);
  const startedAt = performance.now();
  let response: Response;
  try {
    if (request.method === "POST" || request.method === "DELETE") {
      if (!sameOriginRequest(request) || request.headers.get("sec-fetch-site") === "cross-site") {
        response = noStore({ error: "This workspace request could not be verified." }, 403);
        return logHttpResponse(request, response, requestId, startedAt);
      }
    }
    const scope = requiredServiceScope(request.method, servicePath);
    if (!scope) {
      response = noStore({ error: "This private-record operation is not supported." }, 405);
      return logHttpResponse(request, response, requestId, startedAt);
    }
    const authorization = await serviceAuthorization(scope);
    if (authorization instanceof Response) response = authorization;
    else {
      const serviceUrl = configuredServiceUrl("ESTIMATOR_SERVICE_URL", "http://127.0.0.1:8002");
      if (request.method === "POST") {
        if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
          response = noStore({ error: "Use a JSON estimate snapshot." }, 415);
          return logHttpResponse(request, response, requestId, startedAt);
        }
        const boundedBody = await readBoundedBody(request);
        response = boundedBody instanceof Response
          ? boundedBody
          : await forwardPrivateRecordRequest(request, serviceUrl, servicePath, authorization, requestId, boundedBody);
      } else {
        response = await forwardPrivateRecordRequest(request, serviceUrl, servicePath, authorization, requestId);
      }
    }
  } catch {
    response = noStore({ error: "Private records are temporarily unavailable." }, 503);
  }
  return logHttpResponse(request, response, requestId, startedAt);
}

export async function proxyLegacyOwnerMigration(request: Request) {
  const requestId = resolveRequestId(request);
  const startedAt = performance.now();
  let response: Response;
  try {
    if (request.method !== "POST" || !sameOriginRequest(request) || request.headers.get("sec-fetch-site") === "cross-site") {
      response = noStore({ error: "This workspace migration request could not be verified." }, 403);
    } else {
      const authorization = await migrationAuthorization(request);
      if (authorization instanceof Response) response = authorization;
      else {
        const serviceUrl = configuredServiceUrl("ESTIMATOR_SERVICE_URL", "http://127.0.0.1:8002");
        response = await forwardPrivateRecordRequest(request, serviceUrl, "/v1/records/migrate-owner", authorization, requestId);
      }
    }
  } catch {
    response = noStore({ error: "Workspace migration is temporarily unavailable." }, 503);
  }
  return logHttpResponse(request, response, requestId, startedAt);
}

async function forwardPrivateRecordRequest(
  request: Request,
  serviceUrl: URL,
  servicePath: string,
  authorization: string,
  requestId: string,
  body?: ArrayBuffer,
) {
  const headers = new Headers({ authorization, "x-request-id": requestId });
  if (body) headers.set("content-type", "application/json");
  const url = new URL(servicePath, serviceUrl);
  const upstream = await fetch(url, {
    method: request.method,
    headers,
    body,
    cache: "no-store",
    signal: AbortSignal.timeout(5000),
  });
  const responseHeaders = new Headers({
    "cache-control": "no-store",
    "content-type": upstream.headers.get("content-type") ?? "application/json",
  });
  return new Response(upstream.body, { status: upstream.status, headers: responseHeaders });
}

export async function privateRecordStatus() {
  const retentionDays = privateRecordRetentionDays();
  if (!identityAuthConfigured()) {
    return noStore({ identityConfigured: false, legacyMigrationAvailable: false, recordsEnabled: false, retentionDays, message: "Private saving is unavailable until the first-party identity and storage services are configured." });
  }
  const identityHealth = await identityRequest("/health/ready");
  if (!identityHealth?.ok) {
    return noStore({ identityConfigured: true, legacyMigrationAvailable: oidcConfigured && oidcConfiguration !== null, recordsEnabled: false, retentionDays, message: "The identity service is not reachable." });
  }
  if (!activeServiceTokenKey()) {
    return noStore({ identityConfigured: true, legacyMigrationAvailable: oidcConfigured, recordsEnabled: false, retentionDays, message: "Private storage is not fully configured." });
  }
  try {
    const serviceUrl = configuredServiceUrl("ESTIMATOR_SERVICE_URL", "http://127.0.0.1:8002");
    const response = await fetch(new URL("/v1/records/status", serviceUrl), { cache: "no-store", signal: AbortSignal.timeout(2500) });
    if (!response.ok) throw new Error("Storage is unavailable.");
    const status = await response.json() as { recordsEnabled?: boolean; retentionDays?: number };
    return noStore({
      identityConfigured: true,
      legacyMigrationAvailable: oidcConfigured && oidcConfiguration !== null,
      recordsEnabled: status.recordsEnabled === true,
      retentionDays: Number.isInteger(status.retentionDays) ? status.retentionDays : retentionDays,
      message: status.recordsEnabled === true ? "Private storage is ready." : "Private storage is not fully configured.",
    });
  } catch {
    return noStore({ identityConfigured: true, legacyMigrationAvailable: oidcConfigured && oidcConfiguration !== null, recordsEnabled: false, retentionDays, message: "Private storage is not reachable." });
  }
}
