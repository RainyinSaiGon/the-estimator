import type { NextAuthOptions } from "next-auth";
import type { OAuthConfig } from "next-auth/providers/oauth";
import NextAuth from "next-auth";

type OIDCProfile = { sub?: unknown; name?: unknown };

export type OIDCConfiguration = {
  issuer: string;
  discoveryUrl: string;
  clientId: string;
  clientSecret: string;
  appUrl: string;
  nextAuthSecret: string;
};

function readOIDCConfiguration(): { value: OIDCConfiguration | null; error: string | null } {
  const keys = ["OIDC_ISSUER", "OIDC_CLIENT_ID", "OIDC_CLIENT_SECRET", "NEXTAUTH_URL", "NEXTAUTH_SECRET"] as const;
  const values = Object.fromEntries(keys.map((key) => [key, process.env[key]?.trim() ?? ""])) as Record<(typeof keys)[number], string>;
  const discoveryValue = process.env.OIDC_DISCOVERY_URL?.trim() ?? "";
  if (keys.every((key) => !values[key]) && !discoveryValue) return { value: null, error: null };
  if (keys.some((key) => !values[key])) return { value: null, error: "OIDC sign-in is not fully configured." };

  try {
    const issuerUrl = new URL(values.OIDC_ISSUER);
    const appUrl = new URL(values.NEXTAUTH_URL);
    const discoveryUrl = discoveryValue ? new URL(discoveryValue) : new URL(".well-known/openid-configuration", `${issuerUrl.toString().replace(/\/?$/, "/")}`);
    for (const url of [issuerUrl, discoveryUrl, appUrl]) {
      if ((url.protocol !== "https:" && url.hostname !== "localhost" && url.hostname !== "127.0.0.1") || url.username || url.password || url.hash) {
        return { value: null, error: "OIDC sign-in requires secure, valid issuer and application URLs." };
      }
    }
    if (issuerUrl.search || discoveryUrl.search || appUrl.search || appUrl.hash || !values.OIDC_CLIENT_ID || !values.OIDC_CLIENT_SECRET || new TextEncoder().encode(values.NEXTAUTH_SECRET).byteLength < 32) {
      return { value: null, error: "OIDC sign-in configuration is invalid." };
    }
    return {
      value: {
        issuer: issuerUrl.toString(),
        discoveryUrl: discoveryUrl.toString(),
        clientId: values.OIDC_CLIENT_ID,
        clientSecret: values.OIDC_CLIENT_SECRET,
        appUrl: appUrl.toString().replace(/\/$/, ""),
        nextAuthSecret: values.NEXTAUTH_SECRET,
      },
      error: null,
    };
  } catch {
    return { value: null, error: "OIDC sign-in configuration is invalid." };
  }
}

const oidcResult = readOIDCConfiguration();
export const oidcConfiguration = oidcResult.value;
export const oidcConfigurationError = oidcResult.error;
export const oidcConfigured = oidcConfiguration !== null;

const oidcProvider: OAuthConfig<OIDCProfile> | null = oidcConfiguration ? {
  id: "oidc",
  name: "Organization login",
  type: "oauth",
  wellKnown: oidcConfiguration.discoveryUrl,
  issuer: oidcConfiguration.issuer,
  clientId: oidcConfiguration.clientId,
  clientSecret: oidcConfiguration.clientSecret,
  authorization: { params: { scope: "openid profile" } },
  idToken: true,
  checks: ["pkce", "state"],
  profile(profile) {
    if (typeof profile.sub !== "string" || !profile.sub.trim()) throw new Error("The OIDC provider did not return a subject.");
    return { id: profile.sub, name: typeof profile.name === "string" ? profile.name : undefined };
  },
} : null;

export const authOptions: NextAuthOptions = {
  providers: oidcProvider ? [oidcProvider] : [],
  session: { strategy: "jwt", maxAge: 60 * 60 * 8, updateAge: 60 * 15 },
  secret: oidcConfiguration?.nextAuthSecret,
  callbacks: {
    async jwt({ token, account, profile }) {
      if (account && profile && oidcConfiguration) {
        const subject = (profile as OIDCProfile).sub;
        if (typeof subject !== "string" || subject !== account.providerAccountId) {
          throw new Error("The OIDC subject did not match the authenticated account.");
        }
        token.estimatorIssuer = oidcConfiguration.issuer;
        token.estimatorSubject = subject;
      }
      return token;
    },
  },
};

export const authHandler = NextAuth(authOptions);

export function privateRecordRetentionDays() {
  const configured = Number.parseInt(process.env.RECORD_RETENTION_DAYS ?? "90", 10);
  return Number.isInteger(configured) && configured >= 1 && configured <= 3650 ? configured : 90;
}
