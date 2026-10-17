import { randomUUID } from "node:crypto";
import { SignJWT } from "jose";
import { getToken } from "next-auth/jwt";
import type { NextRequest } from "next/server";
import { oidcConfiguration, oidcConfigured, privateRecordRetentionDays } from "../auth";
import { configuredServiceUrl, logHttpResponse, resolveRequestId } from "./operations.ts";

const maxRecordBytes = 15_000_000;

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

async function serviceAuthorization(request: Request): Promise<string | Response> {
  if (!oidcConfigured || !oidcConfiguration) return noStore({ error: "Organization sign-in has not been configured." }, 503);
  const secret = process.env.SERVICE_TOKEN_SECRET?.trim();
  if (!secret || new TextEncoder().encode(secret).byteLength < 32) return noStore({ error: "Private records are not configured." }, 503);

  let session;
  try {
    session = await getToken({ req: request as NextRequest, secret: oidcConfiguration.nextAuthSecret });
  } catch {
    return noStore({ error: "Sign in again to access private records." }, 401);
  }
  const issuer = session?.estimatorIssuer;
  const subject = session?.estimatorSubject;
  if (typeof issuer !== "string" || issuer !== oidcConfiguration.issuer || typeof subject !== "string" || !subject.trim() || subject.length > 512) {
    return noStore({ error: "Sign in to access your private workspace." }, 401);
  }

  const key = new TextEncoder().encode(secret);
  const token = await new SignJWT({ oidc_issuer: issuer })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setIssuer("the-estimator-web")
    .setAudience("the-estimator-go")
    .setSubject(subject)
    .setIssuedAt()
    .setExpirationTime("60s")
    .setJti(randomUUID())
    .sign(key);
  return `Bearer ${token}`;
}

export async function proxyPrivateRecordRequest(request: Request, servicePath: string) {
  const requestId = resolveRequestId(request);
  const startedAt = performance.now();
  let response: Response;
  try {
    if (request.method === "POST" || request.method === "DELETE") {
      const origin = request.headers.get("origin");
      const expectedOrigin = oidcConfiguration ? new URL(oidcConfiguration.appUrl).origin : "";
      if (!origin || origin !== expectedOrigin || request.headers.get("sec-fetch-site") === "cross-site") {
        response = noStore({ error: "This workspace request could not be verified." }, 403);
        return logHttpResponse(request, response, requestId, startedAt);
      }
    }
    const authorization = await serviceAuthorization(request);
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
  if (!oidcConfigured || !oidcConfiguration) {
    return noStore({ oidcConfigured: false, recordsEnabled: false, retentionDays, message: "Private saving is unavailable until an OIDC provider and storage services are configured." });
  }
  if (!process.env.SERVICE_TOKEN_SECRET || new TextEncoder().encode(process.env.SERVICE_TOKEN_SECRET).byteLength < 32) {
    return noStore({ oidcConfigured: true, recordsEnabled: false, retentionDays, message: "Private storage is not fully configured." });
  }
  try {
    const serviceUrl = configuredServiceUrl("ESTIMATOR_SERVICE_URL", "http://127.0.0.1:8002");
    const response = await fetch(new URL("/v1/records/status", serviceUrl), { cache: "no-store", signal: AbortSignal.timeout(2500) });
    if (!response.ok) throw new Error("Storage is unavailable.");
    const status = await response.json() as { recordsEnabled?: boolean; retentionDays?: number };
    return noStore({
      oidcConfigured: true,
      recordsEnabled: status.recordsEnabled === true,
      retentionDays: Number.isInteger(status.retentionDays) ? status.retentionDays : retentionDays,
      message: status.recordsEnabled === true ? "Private storage is ready." : "Private storage is not fully configured.",
    });
  } catch {
    return noStore({ oidcConfigured: true, recordsEnabled: false, retentionDays, message: "Private storage is not reachable." });
  }
}
