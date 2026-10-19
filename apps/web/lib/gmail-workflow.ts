import { randomUUID } from "node:crypto";
import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import { companyAction, extractAttachments, workflowData, workflowSecret, WorkflowError } from "./workflow-service";
import type { Attachment } from "./workflow-types";
import type { Company } from "./workflow-types";

type Connector = { connected: boolean; linkedBy: string; lastSyncedAt?: string; query: string; secrets: Record<string, string> };
export type InternalCompanyContext = { gmail: Connector; webhookSecret: string; webhookActor: string; knowledgeTokenHash: string; knowledgeTokenActor: string };
const systemActor = "00000000-0000-4000-8000-000000000001";
export function companyContext(companyId: string) {
  return workflowData<InternalCompanyContext>("context/" + companyId, "GET", undefined, systemActor, "workflow:worker");
}
async function adminConnector(companyId: string, actor: string) {
  return workflowData<{ gmail: Connector; webhookSecret: string }>(`companies/${companyId}/connector-secret`, "GET", undefined, actor, "workflow:connector");
}
function callbackURL(request: Request) {
  const root = process.env.WORKFLOW_PUBLIC_URL || new URL(request.url).origin;
  return new URL("/api/workflow/gmail/callback", root).toString();
}
export async function beginGmail(companyId: string, actor: string, request: Request) {
  const { gmail } = await adminConnector(companyId, actor);
  if (!gmail.secrets?.clientId || !gmail.secrets.clientSecret) throw new WorkflowError("Save a Google OAuth client in Connectors before connecting Gmail.");
  const nonce = randomUUID();
  const state = await new SignJWT({ companyId, callback: callbackURL(request) }).setProtectedHeader({ alg: "HS256" })
    .setIssuer("estimator-gmail-oauth").setAudience("estimator-gmail-callback").setSubject(actor)
    .setJti(nonce).setIssuedAt().setExpirationTime("10m").sign(new TextEncoder().encode(workflowSecret()));
  (await cookies()).set("workflow_oauth", nonce, { httpOnly: true, sameSite: "lax", secure: new URL(request.url).protocol === "https:", path: "/api/workflow/gmail", maxAge: 600 });
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  for (const [key, value] of Object.entries({ client_id: gmail.secrets.clientId, redirect_uri: callbackURL(request), response_type: "code", scope: "https://www.googleapis.com/auth/gmail.readonly", access_type: "offline", prompt: "consent", state })) url.searchParams.set(key, value);
  return Response.redirect(url);
}
async function googleToken(data: Record<string, string>) {
  const response = await fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(data), signal: AbortSignal.timeout(15000), cache: "no-store" });
  if (!response.ok) throw new WorkflowError("Google authorization failed. Reconnect Gmail and verify the OAuth client settings.", 502);
  return response.json() as Promise<{ access_token: string; refresh_token?: string; expires_in: number; scope?: string }>;
}
export async function finishGmail(actor: string, request: Request) {
  const params = new URL(request.url).searchParams;
  if (params.get("error")) throw new WorkflowError("Gmail authorization was declined.");
  const { payload } = await jwtVerify(params.get("state") ?? "", new TextEncoder().encode(workflowSecret()), {
    algorithms: ["HS256"], issuer: "estimator-gmail-oauth", audience: "estimator-gmail-callback",
  });
  const cookieStore = await cookies();
  if (payload.sub !== actor || payload.jti !== cookieStore.get("workflow_oauth")?.value || typeof payload.companyId !== "string" || payload.callback !== callbackURL(request)) throw new WorkflowError("The Gmail authorization state expired or did not match this account.", 403);
  cookieStore.delete("workflow_oauth");
  const { gmail } = await adminConnector(payload.companyId, actor);
  const token = await googleToken({ client_id: gmail.secrets.clientId, client_secret: gmail.secrets.clientSecret, code: params.get("code") ?? "", grant_type: "authorization_code", redirect_uri: callbackURL(request) });
  if (!token.access_token || !token.refresh_token || !token.scope?.split(" ").includes("https://www.googleapis.com/auth/gmail.readonly")) throw new WorkflowError("Google did not grant offline read-only Gmail access.");
  await companyAction(payload.companyId, { action: "gmail.tokens", secrets: { accessToken: token.access_token, refreshToken: token.refresh_token, expiresAt: new Date(Date.now() + token.expires_in * 1000).toISOString() } }, actor);
  return Response.redirect(new URL("/workspace?company=" + payload.companyId + "&tab=connectors", request.url));
}
type GmailPart = { mimeType?: string; filename?: string; headers?: { name: string; value: string }[]; body?: { data?: string; attachmentId?: string; size?: number }; parts?: GmailPart[] };
function partsOf(part?: GmailPart): GmailPart[] { return part ? [part, ...(part.parts ?? []).flatMap(partsOf)] : []; }
const decode = (value: string) => Buffer.from(value, "base64url");
function header(part: GmailPart | undefined, name: string) { return part?.headers?.find(item => item.name.toLowerCase() === name)?.value ?? ""; }
function htmlText(value: string) {
  return value.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, "").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ");
}
export async function syncGmail(companyId: string, actor: string) {
  await companyAction(companyId, { action: "gmail.claim" }, actor);
  let imported = 0;
  try {
    const { gmail } = await adminConnector(companyId, actor);
    const known=await workflowData<Company>("companies/"+companyId,"GET",undefined,actor);
    const secrets = { ...gmail.secrets };
    const expiresAt = Date.parse(secrets.expiresAt || "");
    if (!secrets.accessToken || !Number.isFinite(expiresAt) || expiresAt < Date.now() + 60000) {
      const token = await googleToken({ client_id: secrets.clientId, client_secret: secrets.clientSecret, refresh_token: secrets.refreshToken, grant_type: "refresh_token" });
      secrets.accessToken = token.access_token; secrets.expiresAt = new Date(Date.now() + token.expires_in * 1000).toISOString();
    }
    const started = secrets.syncStartedAt || new Date().toISOString();
    async function google<T>(path: string): Promise<T> {
      const response = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/" + path, { headers: { authorization: "Bearer " + secrets.accessToken }, cache: "no-store", signal: AbortSignal.timeout(12000) });
      if (!response.ok) throw new WorkflowError(`Gmail sync failed (HTTP ${response.status}). Retry or reconnect the mailbox.`, 502);
      return response.json() as Promise<T>;
    }
    const after = gmail.lastSyncedAt ? " after:" + Math.floor((Date.parse(gmail.lastSyncedAt) - 300000) / 1000) : "";
    const query = new URLSearchParams({ q: (gmail.query || "in:inbox") + after, maxResults: "15" });
    if (secrets.pageToken) query.set("pageToken", secrets.pageToken);
    const page = await google<{ messages?: { id: string; threadId: string }[]; nextPageToken?: string }>("messages?" + query);
    const threadIds = [...new Set((page.messages ?? []).map(message => message.threadId))];
    for (const id of threadIds) {
      const thread = await google<{ messages?: { id: string; payload?: GmailPart }[] }>("threads/" + encodeURIComponent(id) + "?format=full");
      const messages = thread.messages ?? [];
      const incomingIds=messages.map(message=>message.id);
      if(known.requests.some(request=>request.channel==="gmail"&&request.externalId===id&&request.sourceIds.length===incomingIds.length&&incomingIds.every(source=>request.sourceIds.includes(source)))) continue;
      const texts: string[] = [], files: File[] = [], failures: Attachment[] = [];
      let attachmentBytes = 0;
      for (const message of messages) {
        const parts = partsOf(message.payload);
        const plain = parts.filter(part => part.mimeType === "text/plain" && !part.filename).map(part => decode(part.body?.data ?? "").toString("utf8")).join("\n");
        const body = plain || parts.filter(part => part.mimeType === "text/html" && !part.filename).map(part => htmlText(decode(part.body?.data ?? "").toString("utf8"))).join("\n");
        texts.push(`From: ${header(message.payload, "from")}\nDate: ${header(message.payload, "date")}\nSubject: ${header(message.payload, "subject")}\n${body}`);
        for (const part of parts.filter(item => item.filename)) {
          if (files.length >= 10 || (part.body?.size ?? 0) > 10 * 1024 * 1024) {
            failures.push({ id: randomUUID(), name: part.filename!.slice(0, 200), type: part.mimeType ?? "", text: "", sha256: "", status: "needs_attention", error: "Attachment count or size limit exceeded.", truncated: false, locators: [] }); continue;
          }
          let data = part.body?.data;
          if (!data && part.body?.attachmentId) data = (await google<{ data: string }>(`messages/${encodeURIComponent(message.id)}/attachments/${encodeURIComponent(part.body.attachmentId)}`)).data;
          if (data) {
            const bytes = decode(data);
            if (attachmentBytes + bytes.length > 20 * 1024 * 1024) {
              failures.push({ id: randomUUID(), name: part.filename!.slice(0, 200), type: part.mimeType ?? "", text: "", sha256: "", status: "needs_attention", error: "The thread exceeds the 20 MB attachment limit. Upload this file separately.", truncated: false, locators: [] });
              continue;
            }
            attachmentBytes += bytes.length;
            files.push(new File([bytes], part.filename!, { type: part.mimeType }));
          }
        }
      }
      const attachments = [...await extractAttachments(files), ...failures];
      if (texts.join("\n\n--- Reply ---\n\n").length > 100000) attachments.push({ id: randomUUID(), name: "Gmail thread text", type: "text/plain", text: "", sha256: "", status: "needs_attention", error: "The thread exceeded 100,000 characters. Review the original mailbox before approving scope.", truncated: true, locators: [] });
      await companyAction(companyId, { action: "intake", channel: "gmail", externalId: id, sourceIds: messages.map(message => message.id), title: (header(messages[0]?.payload, "subject") || "Gmail request").slice(0, 200), text: texts.join("\n\n--- Reply ---\n\n").slice(0, 100000), attachments }, actor);
      imported++;
    }
    await companyAction(companyId, { action: "gmail.tokens", secrets: { accessToken: secrets.accessToken, expiresAt: secrets.expiresAt, pageToken: page.nextPageToken ?? "", syncStartedAt: page.nextPageToken ? started : "" } }, actor);
    await companyAction(companyId, { action: "gmail.synced", decision: page.nextPageToken ? "partial" : "complete", completedAt: started }, actor);
    return { imported, continuing: !!page.nextPageToken };
  } catch (error) {
    // A Gmail pagination cursor can expire. Restart from the last completed
    // checkpoint; immutable message IDs make the replay idempotent.
    await companyAction(companyId, { action: "gmail.tokens", secrets: { pageToken: "", syncStartedAt: "" } }, actor).catch(() => undefined);
    await companyAction(companyId, { action: "gmail.synced", error: error instanceof Error ? error.message : "Mailbox sync failed." }, actor).catch(() => undefined);
    throw error;
  }
}
export async function disconnectGmail(companyId: string, actor: string) {
  const { gmail } = await adminConnector(companyId, actor);
  const token = gmail.secrets?.refreshToken;
  if (token) await fetch("https://oauth2.googleapis.com/revoke", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ token }), signal: AbortSignal.timeout(8000) }).catch(() => undefined);
  return companyAction(companyId, { action: "gmail.disconnect" }, actor);
}
