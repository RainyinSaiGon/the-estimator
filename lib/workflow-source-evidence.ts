export function sourceLabelForQuote(material: string, quote: string) {
  const offset = material.indexOf(quote);
  if (offset < 0 || !quote.trim()) return "Unverified inference";
  const prefix = material.slice(0, offset);
  const sourceMarkers = [...prefix.matchAll(/\[Source: ([^\]]+)\]|\[Source file: ([^;]+); type: ([^;]+); references: [^\]]*\]/g)];
  const source = sourceMarkers.at(-1);
  if (!source) return "Client request";
  const locationMarkers = [...prefix.slice(source.index ?? 0).matchAll(/\[(Page \d+|Sheet: [^\]]+|Row \d+|Paragraph \d+)\]/g)];
  const leadingLocation = quote.match(/^\s*\[(Page \d+|Sheet: [^\]]+|Row \d+|Paragraph \d+)\]/)?.[1];
  const location = leadingLocation ?? locationMarkers.at(-1)?.[1];
  const name = source[2] ? `${source[2]} (${source[3]})` : source[1] ?? "Client request";
  return location ? `${name} · ${location}` : name;
}
