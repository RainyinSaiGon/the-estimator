import { randomUUID } from "node:crypto";
import { SignJWT } from "jose";
import { accountForSession, identityAuthConfigured, identityRequest, sameOriginRequest } from "./identity";
import { configuredServiceUrl, logHttpResponse, resolveRequestId } from "./operations.ts";

const maxRecordBytes = 15_000_000;
const maxRecordUpdateBytes = 8 * 1024;
const defaultServiceTokenKeyID = "legacy";

function noStore(body: unknown, status = 200) {
  return Response.json(body, { status, headers: { "cache-control": "no-store" } });
}

async function readBoundedBody(request: Request, maximumBytes = maxRecordBytes): Promise<ArrayBuffer | Response> {
  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (contentLength > maximumBytes) return noStore({ error: "The private-record request is too large." }, 413);
  const reader = request.body?.getReader();
  if (!reader) return new ArrayBuffer(0);
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maximumBytes) {
      await reader.cancel();
      return noStore({ error: "The private-record request is too large." }, 413);
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
  if (method === "GET" && (path === "/v1/records" || path.startsWith("/v1/records/"))) return "private-records:read";
  if (method === "PATCH" && path.startsWith("/v1/records/") && (path.endsWith("/delivery/review") || /^\/v1\/records\/[^/]+$/.test(path))) return "private-records:update";
  if (method === "POST" && path === "/v1/records") return "private-records:create";
  if (method === "POST" && path.startsWith("/v1/records/") && path.endsWith("/delivery")) return "private-records:update";
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
  if (!session.account.emailVerified) {
    return noStore({ error: "Verify your email before accessing private records." }, 403);
  }

  return serviceToken(key, { identity_authority: "first-party-v1", email_verified: true }, session.account.accountId, scope);
}

async function serviceToken(key: { keyID: string; secret: string }, claims: Record<string, string | boolean>, subject: string, scope: string) {
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

export async function proxyPrivateRecordRequest(request: Request, servicePath: string) {
  const requestId = resolveRequestId(request);
  const startedAt = performance.now();
  let response: Response;
  try {
    if (request.method === "POST" || request.method === "PATCH" || request.method === "DELETE") {
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
      if (request.method === "POST" || request.method === "PATCH") {
        if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
          response = noStore({ error: "Use a JSON private-record request." }, 415);
          return logHttpResponse(request, response, requestId, startedAt);
        }
        const deliveryRequest = servicePath.endsWith("/delivery") || servicePath.endsWith("/delivery/review");
        const boundedBody = await readBoundedBody(request, deliveryRequest ? 64 * 1024 : request.method === "PATCH" ? maxRecordUpdateBytes : maxRecordBytes);
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
    return noStore({ identityConfigured: false, recordsEnabled: false, retentionDays, message: "Private saving is unavailable until the first-party identity and storage services are configured." });
  }
  const identityHealth = await identityRequest("/health/ready");
  if (!identityHealth?.ok) {
    return noStore({ identityConfigured: true, recordsEnabled: false, retentionDays, message: "The identity service is not reachable." });
  }
  if (!activeServiceTokenKey()) {
    return noStore({ identityConfigured: true, recordsEnabled: false, retentionDays, message: "Private storage is not fully configured." });
  }
  try {
    const serviceUrl = configuredServiceUrl("ESTIMATOR_SERVICE_URL", "http://127.0.0.1:8002");
    const response = await fetch(new URL("/v1/records/status", serviceUrl), { cache: "no-store", signal: AbortSignal.timeout(2500) });
    if (!response.ok) throw new Error("Storage is unavailable.");
    const status = await response.json() as { recordsEnabled?: boolean; retentionDays?: number };
    return noStore({
      identityConfigured: true,
      recordsEnabled: status.recordsEnabled === true,
      retentionDays: Number.isInteger(status.retentionDays) ? status.retentionDays : retentionDays,
      message: status.recordsEnabled === true ? "Private storage is ready." : "Private storage is not fully configured.",
    });
  } catch {
    return noStore({ identityConfigured: true, recordsEnabled: false, retentionDays, message: "Private storage is not reachable." });
  }
}

function privateRecordRetentionDays() {
  const configured = Number.parseInt(process.env.RECORD_RETENTION_DAYS ?? "90", 10);
  return Number.isInteger(configured) && configured >= 1 && configured <= 3650 ? configured : 90;
}
