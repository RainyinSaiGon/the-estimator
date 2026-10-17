import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const maxBriefLength = 20_000;
const maxRequestBytes = 100_000;

export async function POST(request: NextRequest) {
  let body: unknown;
  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (contentLength > maxRequestBytes) return NextResponse.json({ error: "Request body is too large." }, { status: 413 });
  try {
    const reader = request.body?.getReader();
    if (!reader) throw new Error("Empty body");
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxRequestBytes) {
        await reader.cancel();
        return NextResponse.json({ error: "Request body is too large." }, { status: 413 });
      }
      chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    body = JSON.parse(new TextDecoder().decode(bytes));
  }
  catch { return NextResponse.json({ error: "Request body must be valid JSON." }, { status: 400 }); }
  if (!body || typeof body !== "object") return NextResponse.json({ error: "Request body must be an object." }, { status: 400 });
  const { brief, parser = "sample" } = body as { brief?: unknown; parser?: unknown };
  if (typeof brief !== "string" || brief.trim().length < 30 || brief.length > maxBriefLength) return NextResponse.json({ error: "Use a brief between 30 and 20,000 characters." }, { status: 400 });
  if (parser !== "sample" && parser !== "ai") return NextResponse.json({ error: "Choose the sample parser." }, { status: 400 });
  if (parser === "ai") return NextResponse.json({ error: "AI parsing is not configured. Choose the sample parser." }, { status: 503 });

  const briefUrl = process.env.BRIEF_SERVICE_URL ?? "http://127.0.0.1:8001";
  const estimatorUrl = process.env.ESTIMATOR_SERVICE_URL ?? "http://127.0.0.1:8002";
  try {
    const scopeResponse = await fetch(`${briefUrl}/v1/briefs/analyze`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ brief, parser: "sample" }), signal: AbortSignal.timeout(10_000), cache: "no-store" });
    const scopeBody = await scopeResponse.json().catch(() => ({}));
    if (!scopeResponse.ok) return NextResponse.json({ error: scopeBody.detail ?? "Brief service could not analyze this request." }, { status: scopeResponse.status });

    const estimateResponse = await fetch(`${estimatorUrl}/v1/estimates`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ scope: scopeBody, answers: scopeBody.initialAnswers, excluded: [], historyPolicy: "demo" }), signal: AbortSignal.timeout(10_000), cache: "no-store" });
    const estimateBody = await estimateResponse.json().catch(() => ({}));
    if (!estimateResponse.ok) return NextResponse.json({ error: estimateBody.error ?? "Estimator service could not create the preview." }, { status: estimateResponse.status });
    return NextResponse.json({ scope: scopeBody, estimate: estimateBody }, { headers: { "cache-control": "no-store" } });
  } catch (cause) {
    const message = cause instanceof Error && cause.name === "TimeoutError" ? "A service took too long to respond. Try again." : "A preview service is unavailable. Start the local services and try again.";
    return NextResponse.json({ error: message }, { status: 503 });
  }
}
