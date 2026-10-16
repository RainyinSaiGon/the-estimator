export function groundEvidence(source: string, quote: string): string | null {
  if (!quote.trim()) return null;
  if (source.includes(quote)) return quote;
  const escaped = quote.trim().replace(/[’‘]/g, "'").replace(/[“”]/g, '"')
    .split(/\s+/).map(part => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/'/g, "['’‘]").replace(/"/g, '["“”]')).join("\\s+");
  return new RegExp(escaped, "u").exec(source)?.[0] ?? null;
}
