import { env } from "cloudflare:workers";

export const PUBLIC_DEMO_ACTOR_ID = "public-demo:shared";

export function publicDemoAccessEnabled() {
  const vars = env as unknown as Record<string, string | undefined>;
  return vars.PUBLIC_DEMO_ACCESS === "true";
}
