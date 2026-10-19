const MAX_URL_LENGTH = 2048;
const MAX_BODY_BYTES = 1_000_000;
const MAX_TEXT_LENGTH = 100_000;
const FETCH_TIMEOUT_MS = 8_000;
const DNS_TIMEOUT_MS = 3_000;
const DNS_ENDPOINT = "https://cloudflare-dns.com/dns-query";

export class KnowledgeFetchError extends Error {
  readonly status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.name = "KnowledgeFetchError";
    this.status = status;
  }
}

export type FetchedKnowledge = {
  title: string;
  url: string;
  text: string;
  sha256: string;
  retrievedAt: string;
  contentType: string;
  truncated: boolean;
  byteLength: number;
};

export type KnowledgeFetchOptions = {
  fetcher?: typeof fetch;
  resolveHost?: (hostname: string) => Promise<string[]>;
  now?: () => Date;
};

function ipv4Parts(value: string): number[] | undefined {
  const parts = value.split(".");
  if (parts.length !== 4 || parts.some(part => !/^\d{1,3}$/.test(part))) return undefined;
  const octets = parts.map(Number);
  return octets.every(value => value >= 0 && value <= 255) ? octets : undefined;
}

function ipv4In(value: number[], network: number[], prefix: number) {
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  const addressNumber = value.reduce((result, octet) => (result << 8) | octet, 0) >>> 0;
  const networkNumber = network.reduce((result, octet) => (result << 8) | octet, 0) >>> 0;
  return (addressNumber & mask) === (networkNumber & mask);
}

const nonPublicIPv4: Array<[number[], number]> = [
  [[0, 0, 0, 0], 8], [[10, 0, 0, 0], 8], [[100, 64, 0, 0], 10],
  [[127, 0, 0, 0], 8], [[169, 254, 0, 0], 16], [[172, 16, 0, 0], 12],
  [[192, 0, 0, 0], 24], [[192, 0, 2, 0], 24], [[192, 88, 99, 0], 24],
  [[192, 168, 0, 0], 16], [[198, 18, 0, 0], 15], [[198, 51, 100, 0], 24],
  [[203, 0, 113, 0], 24], [[224, 0, 0, 0], 4], [[240, 0, 0, 0], 4],
];

function ipv6Words(value: string): number[] | undefined {
  if (!value.includes(":") || value.includes("%")) return undefined;
  let address = value.toLowerCase();
  if (address.includes(".")) {
    const lastColon = address.lastIndexOf(":");
    const embedded = ipv4Parts(address.slice(lastColon + 1));
    if (!embedded) return undefined;
    const high = ((embedded[0]! << 8) | embedded[1]!).toString(16);
    const low = ((embedded[2]! << 8) | embedded[3]!).toString(16);
    address = `${address.slice(0, lastColon + 1)}${high}:${low}`;
  }
  if ((address.match(/::/g) ?? []).length > 1) return undefined;
  const compressed = address.includes("::");
  const [leftRaw = "", rightRaw = ""] = compressed ? address.split("::") : [address, ""];
  const left = leftRaw ? leftRaw.split(":") : [];
  const right = rightRaw ? rightRaw.split(":") : [];
  const groups = [...left, ...right];
  if (groups.some(group => !/^[0-9a-f]{1,4}$/.test(group))) return undefined;
  if ((!compressed && groups.length !== 8) || (compressed && groups.length >= 8)) return undefined;
  const zeroes = compressed ? 8 - groups.length : 0;
  const expanded = compressed ? [...left, ...Array(zeroes).fill("0"), ...right] : groups;
  return expanded.length === 8 ? expanded.map(group => Number.parseInt(group, 16)) : undefined;
}

function ipv6Prefix(words: number[], expected: number[], bits: number) {
  const fullWords = Math.floor(bits / 16);
  for (let index = 0; index < fullWords; index++) if (words[index] !== expected[index]) return false;
  const remaining = bits % 16;
  if (remaining) {
    const mask = (0xffff << (16 - remaining)) & 0xffff;
    if (((words[fullWords] ?? 0) & mask) !== ((expected[fullWords] ?? 0) & mask)) return false;
  }
  return true;
}

export function isPublicAddress(address: string): boolean {
  const ipv4 = ipv4Parts(address);
  if (ipv4) return !nonPublicIPv4.some(([network, prefix]) => ipv4In(ipv4, network, prefix));
  const ipv6 = ipv6Words(address);
  if (!ipv6 || (ipv6[0]! & 0xe000) !== 0x2000) return false; // Only global-unicast 2000::/3.
  if (ipv6Prefix(ipv6, [0x2001, 0, 0, 0, 0, 0, 0, 0], 23)) return false; // IETF special-purpose assignments.
  if (ipv6Prefix(ipv6, [0x2002, 0, 0, 0, 0, 0, 0, 0], 16)) return false; // Deprecated 6to4.
  if (ipv6Prefix(ipv6, [0x3fff, 0, 0, 0, 0, 0, 0, 0], 20)) return false; // Documentation.
  if (ipv6Prefix(ipv6, [0x2001, 0x0db8, 0, 0, 0, 0, 0, 0], 32)) return false; // Documentation.
  return true;
}

function isIpLiteral(hostname: string) {
  if (ipv4Parts(hostname)) return true;
  return hostname.includes(":");
}

export function normalizeKnowledgeDomain(input: string): string {
  const trimmed = input.trim().toLowerCase();
  if (!trimmed || trimmed.length > 253 || /[\s/@?#:*\\]/.test(trimmed) || trimmed.includes("*")) {
    throw new KnowledgeFetchError("Enter a hostname such as docs.example.com. Schemes, paths, ports, and wildcards are not allowed.");
  }
  let hostname: string;
  try { hostname = new URL(`https://${trimmed}`).hostname.toLowerCase().replace(/\.$/, ""); }
  catch { throw new KnowledgeFetchError("That approved source hostname is not valid."); }
  if (hostname !== trimmed.replace(/\.$/, "") || hostname.length > 253 || hostname.split(".").length < 2 || isIpLiteral(hostname) || !/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(hostname) || hostname.split(".").some(part => part.startsWith("xn--") && part.length < 5)) {
    throw new KnowledgeFetchError("Approved sources must use a public DNS hostname, not an IP address or local network name.");
  }
  if (["localhost", "local", "internal", "test", "invalid", "example"].some(suffix => hostname === suffix || hostname.endsWith(`.${suffix}`))) {
    throw new KnowledgeFetchError("Local, reserved, and example domains cannot be approved as public sources.");
  }
  return hostname;
}

export function validateKnowledgeSourceUrl(rawUrl: string, allowedDomains: string[]): URL {
  if (rawUrl.length > MAX_URL_LENGTH) throw new KnowledgeFetchError("The source URL is too long.");
  let url: URL;
  try { url = new URL(rawUrl); } catch { throw new KnowledgeFetchError("Enter a valid HTTPS source URL."); }
  if (url.protocol !== "https:" || url.username || url.password || (url.port && url.port !== "443")) {
    throw new KnowledgeFetchError("Knowledge sources must be HTTPS URLs without credentials or custom ports.");
  }
  const hostname = normalizeKnowledgeDomain(url.hostname);
  const allowed = new Set(allowedDomains.map(normalizeKnowledgeDomain));
  if (!allowed.has(hostname)) throw new KnowledgeFetchError(`The source host ${hostname} is not in this company's approved-domain list.`, 403);
  url.hostname = hostname;
  url.hash = "";
  return url;
}

async function queryDns(hostname: string, type: "A" | "AAAA", fetcher: typeof fetch) {
  const url = new URL(DNS_ENDPOINT);
  url.searchParams.set("name", hostname);
  url.searchParams.set("type", type);
  let response: Response;
  try { response = await fetcher(url, { headers: { Accept: "application/dns-json" }, redirect: "error", cache: "no-store", signal: AbortSignal.timeout(DNS_TIMEOUT_MS) }); }
  catch { throw new KnowledgeFetchError("The source host could not be safely resolved.", 422); }
  if (!response.ok) throw new KnowledgeFetchError("The source host could not be safely resolved.", 422);
  const contentType = response.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase();
  if (contentType !== "application/dns-json" && contentType !== "application/json") throw new KnowledgeFetchError("The source host could not be safely resolved.", 422);
  let body: { Status?: number; Answer?: Array<{ type?: number; data?: string }> };
  try { body = JSON.parse(new TextDecoder().decode(await readBounded(response, 8192, "DNS response"))) as typeof body; }
  catch (error) {
    if (error instanceof KnowledgeFetchError) throw error;
    throw new KnowledgeFetchError("The source host returned an invalid DNS response.", 422);
  }
  if (body.Status === 3) return [];
  if (body.Status !== 0) throw new KnowledgeFetchError("The source host could not be safely resolved.", 422);
  const wantedType = type === "A" ? 1 : 28;
  return (body.Answer ?? []).filter(answer => answer.type === wantedType && typeof answer.data === "string").map(answer => answer.data!.replace(/\.$/, ""));
}

export async function resolvePublicKnowledgeHost(hostname: string, fetcher: typeof fetch = fetch): Promise<string[]> {
  const [a, aaaa] = await Promise.all([queryDns(hostname, "A", fetcher), queryDns(hostname, "AAAA", fetcher)]);
  const addresses = [...new Set([...a, ...aaaa])];
  if (!addresses.length || addresses.some(address => !isPublicAddress(address))) {
    throw new KnowledgeFetchError("The source host has no public address or resolves to a private or reserved network.", 403);
  }
  return addresses;
}

function decodeEntities(value: string) {
  return value.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, (match, entity: string) => {
    const named: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
    if (entity[0] !== "#") return named[entity.toLowerCase()] ?? match;
    const number = entity[1]?.toLowerCase() === "x" ? Number.parseInt(entity.slice(2), 16) : Number.parseInt(entity.slice(1), 10);
    try { return Number.isFinite(number) ? String.fromCodePoint(number) : ""; } catch { return ""; }
  });
}

function extractHtmlText(html: string) {
  return decodeEntities(html
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(script|style|noscript|svg|template|iframe|object|form|head)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, " ")
    .replace(/<(br|\/p|\/div|\/li|\/h[1-6]|\/tr|\/section|\/article)\b[^>]*>/gi, "\n")
    .replace(/<[^>]*>/g, " ")
    .replace(/\r/g, "")
    .replace(/[\t\f\v ]+/g, " ")
    .replace(/ *\n+ */g, "\n")
    .trim());
}

function titleFromHtml(html: string, fallback: string) {
  const title = /<title\b[^>]*>([\s\S]*?)<\/title\s*>/i.exec(html)?.[1];
  return (title ? decodeEntities(title.replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim() : "").slice(0, 200) || fallback;
}

async function readBounded(response: Response, maxBytes = MAX_BODY_BYTES, label = "source page") {
  const limitMessage = label === "source page" ? "The source page exceeds the 1 MB download limit." : `The ${label} exceeds its ${Math.round(maxBytes / 1024)} KB download limit.`;
  const declaredLength = Number(response.headers.get("content-length") ?? 0);
  if (declaredLength > maxBytes) throw new KnowledgeFetchError(limitMessage, 413);
  if (!response.body) return new Uint8Array();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > maxBytes) {
        await reader.cancel();
        throw new KnowledgeFetchError(limitMessage, 413);
      }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const output = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { output.set(chunk, offset); offset += chunk.byteLength; }
  return output;
}

async function digest(text: string) {
  const bytes = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)));
  return [...bytes].map(byte => byte.toString(16).padStart(2, "0")).join("");
}

export async function fetchApprovedKnowledgeSource(rawUrl: string, allowedDomains: string[], options: KnowledgeFetchOptions = {}): Promise<FetchedKnowledge> {
  const url = validateKnowledgeSourceUrl(rawUrl, allowedDomains);
  const fetcher = options.fetcher ?? fetch;
  const resolver = options.resolveHost ?? (host => resolvePublicKnowledgeHost(host, fetcher));
  const resolvedAddresses = await resolver(url.hostname);
  if (!resolvedAddresses.length || resolvedAddresses.some(address => !isPublicAddress(address))) {
    throw new KnowledgeFetchError("The source host has no public address or resolves to a private or reserved network.", 403);
  }
  let response: Response;
  try {
    response = await fetcher(url, { method: "GET", redirect: "manual", cache: "no-store", headers: { Accept: "text/html,application/xhtml+xml,text/plain,text/markdown,application/json;q=0.9" }, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  } catch (error) {
    if (error instanceof KnowledgeFetchError) throw error;
    throw new KnowledgeFetchError("The approved source could not be fetched. Check its public availability and try again.", 502);
  }
  if (response.status >= 300 && response.status < 400) throw new KnowledgeFetchError("The source returned a redirect. Add the final HTTPS host to this company's approved-domain list and fetch that URL directly.", 422);
  if (!response.ok) throw new KnowledgeFetchError(`The source returned HTTP ${response.status}.`, 502);
  if (response.url && new URL(response.url).origin !== url.origin) throw new KnowledgeFetchError("The source response changed origin. Redirects are not followed.", 422);
  const contentType = (response.headers.get("content-type") ?? "").split(";")[0]!.trim().toLowerCase();
  if (!new Set(["text/html", "application/xhtml+xml", "text/plain", "text/markdown", "application/json"]).has(contentType)) {
    throw new KnowledgeFetchError("Only HTML, plain text, Markdown, and JSON pages can be imported. Convert other documents to text first.", 415);
  }
  const bytes = await readBounded(response);
  const raw = new TextDecoder("utf-8", { fatal: false }).decode(bytes).replace(/\u0000/g, "");
  const isHtml = contentType === "text/html" || contentType === "application/xhtml+xml";
  const title = isHtml ? titleFromHtml(raw, `${url.hostname}${url.pathname}`) : `${url.hostname}${url.pathname}`.slice(0, 200);
  let text = isHtml ? extractHtmlText(raw) : raw.replace(/\r/g, "").trim();
  if (contentType === "application/json") {
    try { text = JSON.stringify(JSON.parse(raw), null, 2); } catch { throw new KnowledgeFetchError("The source declared JSON but returned invalid JSON.", 422); }
  }
  if (text.length < 30) throw new KnowledgeFetchError("The source page did not contain enough readable text to review.", 422);
  const truncated = text.length > MAX_TEXT_LENGTH;
  if (truncated) text = text.slice(0, MAX_TEXT_LENGTH);
  const retrievedAt = (options.now?.() ?? new Date()).toISOString();
  return { title, url: url.toString(), text, sha256: await digest(text), retrievedAt, contentType, truncated, byteLength: bytes.byteLength };
}
