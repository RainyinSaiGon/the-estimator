import { BROWSER_DOCUMENT_UPLOAD_POLICY, completeDocumentExtraction, DOCUMENT_EXTRACTION_LIMITS, documentExtension, isSupportedDocumentFormat, paragraphDocumentText, plainDocumentText, spreadsheetDocumentText } from "./document-extraction-policy";
import type { DocumentExtraction, ExtractedDocumentUpload } from "./document-extraction-policy";

export type ExtractedUpload = ExtractedDocumentUpload;
export { allowedDocumentExtension } from "./document-extraction-policy";

async function sha256(value: ArrayBuffer) {
  const digest = await crypto.subtle.digest("SHA-256", value);
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
}

async function pdfText(data: ArrayBuffer) {
  const [pdfjs, worker] = await Promise.all([
    import("pdfjs-dist/legacy/build/pdf.mjs"),
    import("pdfjs-dist/legacy/build/pdf.worker.mjs?url"),
  ]);
  pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
  const loadingTask = pdfjs.getDocument({ data: new Uint8Array(data), useWorkerFetch: false });
  const document = await loadingTask.promise;
  const pages: string[] = [], locators: string[] = [];
  const pageCount = Math.min(document.numPages, DOCUMENT_EXTRACTION_LIMITS.pdfPages);
  let truncated = document.numPages > pageCount;
  try {
    for (let pageNumber = 1; pageNumber <= pageCount; pageNumber++) {
      const page = await document.getPage(pageNumber);
      const content = await page.getTextContent();
      const text = content.items.map(item => "str" in item ? item.str : "").join(" ").replace(/\s+/g, " ").trim();
      if (text) { pages.push(`[Page ${pageNumber}] ${text}`); locators.push(`Page ${pageNumber}`); }
      if (pages.join("\n\n").length >= DOCUMENT_EXTRACTION_LIMITS.textCharacters) { truncated ||= pageNumber < document.numPages; break; }
    }
    return { text: pages.join("\n\n"), locators, truncated };
  } finally {
    await loadingTask.destroy();
  }
}

async function spreadsheetText(data: ArrayBuffer) {
  const XLSX = await import("xlsx");
  const workbook = XLSX.read(data, { type: "array", cellFormula: false, cellHTML: false, cellText: true, bookVBA: false, WTF: false });
  return spreadsheetDocumentText(workbook.SheetNames, name => {
    const sheet = workbook.Sheets[name];
    return sheet ? XLSX.utils.sheet_to_csv(sheet, { blankrows: false, strip: false }) : undefined;
  });
}

export async function extractClientFile(file: File): Promise<ExtractedUpload> {
  const ext = documentExtension(file.name);
  if (!isSupportedDocumentFormat(ext)) throw new Error(`${file.name}: choose PDF, DOCX, XLSX, CSV, TXT, Markdown, JSON, or EML.`);
  if (file.size <= 0 || file.size > BROWSER_DOCUMENT_UPLOAD_POLICY.maxFileBytes) throw new Error(`${file.name}: each file must be between 1 byte and 10 MB.`);
  const data = await file.arrayBuffer();
  // PDF.js can transfer this buffer to its worker. Hash the original bytes first.
  const fileDigest = await sha256(data);
  let extracted: DocumentExtraction;
  if (ext === "pdf") extracted = await pdfText(data);
  else if (ext === "docx") {
    const mammoth = await import("mammoth/mammoth.browser");
    const result = await mammoth.extractRawText({ arrayBuffer: data });
    extracted = paragraphDocumentText(result.value);
  } else if (ext === "xlsx") extracted = await spreadsheetText(data);
  else {
    const decoded = new TextDecoder("utf-8", { fatal: false }).decode(data);
    extracted = plainDocumentText(decoded, ext);
  }
  return {
    name: file.name.slice(0, DOCUMENT_EXTRACTION_LIMITS.fileNameCharacters), type: ext, size: file.size, sha256: fileDigest,
    ...completeDocumentExtraction(ext, extracted),
  };
}
