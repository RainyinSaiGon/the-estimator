import { randomUUID } from "node:crypto";
import { SignJWT } from "jose";

export type BriefServiceScope = "briefs:analyze" | "briefs:analyze-document";

type ActiveKey = { keyID: string; secret: Uint8Array };

function activeBriefServiceKey(): ActiveKey | null {
  const secret = process.env.BRIEF_SERVICE_TOKEN_SECRET?.trim() ?? "";
  const keyID = process.env.BRIEF_SERVICE_TOKEN_KEY_ID?.trim() ?? "";
  const recordServiceSecret = process.env.SERVICE_TOKEN_SECRET?.trim() ?? "";
  if (
    !secret || new TextEncoder().encode(secret).byteLength < 32 ||
    !/^[A-Za-z0-9._-]{1,64}$/.test(keyID) ||
    secret === recordServiceSecret
  ) return null;
  return { keyID, secret: new TextEncoder().encode(secret) };
}

export async function briefServiceAuthorization(scope: BriefServiceScope): Promise<string | null> {
  const key = activeBriefServiceKey();
  if (!key) return null;
  const token = await new SignJWT({ scope })
    .setProtectedHeader({ alg: "HS256", typ: "JWT", kid: key.keyID })
    .setIssuer("the-estimator-web")
    .setAudience("the-estimator-brief-intelligence")
    .setSubject("the-estimator-web")
    .setIssuedAt()
    .setExpirationTime("60s")
    .setJti(randomUUID())
    .sign(key.secret);
  return `Bearer ${token}`;
}
