export type ExtractedUpload = {
  name: string;
  type: string;
  size: number;
  sha256: string;
  text: string;
  status: "extracted" | "needs_attention" | "ocr_required";
  message?: string;
  locators: string[];
  truncated: boolean;
};

const MAX_FILE_SIZE = 10 * 1024 * 1024;
const MAX_TEXT_PER_FILE = 40000;
const ALLOWED_EXTENSIONS = new Set(["pdf", "docx", "xlsx", "csv", "txt", "md", "json", "eml"]);

async function sha256(value: ArrayBuffer) {
  const digest = await crypto.subtle.digest("SHA-256", value);
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
}

function extension(name: string) { return name.split(".").at(-1)?.toLowerCase() ?? ""; }

async function pdfText(data: ArrayBuffer) {
  const [pdfjs, worker] = await Promise.all([
    import("pdfjs-dist/legacy/build/pdf.mjs"),
    import("pdfjs-dist/legacy/build/pdf.worker.mjs?url"),
  ]);
  pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
  const loadingTask = pdfjs.getDocument({ data: new Uint8Array(data), useWorkerFetch: false });
  const document = await loadingTask.promise;
  const pages: { pageNumber: number; text: string }[] = [];
  const pageCount = Math.min(document.numPages, 100);
  try {
  for (let pageNumber = 1; pageNumber <= pageCount; pageNumber++) {
    const page = await document.getPage(pageNumber);
    const content = await page.getTextContent();
    const text = content.items.map(item => "str" in item ? item.str : "").join(" ").replace(/\s+/g, " ").trim();
    if (text) pages.push({ pageNumber, text });
  }
  return { text: pages.map(page => `[Page ${page.pageNumber}] ${page.text}`).join("\n\n"), locators: pages.map(page => `Page ${page.pageNumber}`), truncated: document.numPages > pageCount };
  } finally {
    await loadingTask.destroy();
  }
}

async function spreadsheetText(data: ArrayBuffer) {
  const XLSX = await import("xlsx");
  const workbook = XLSX.read(data, { type: "array", cellFormula: false, cellHTML: false, cellText: true, bookVBA: false, WTF: false });
  const sections: string[] = [];
  for (const name of workbook.SheetNames.slice(0, 30)) {
    const sheet = workbook.Sheets[name];
    if (!sheet) continue;
    const csv = XLSX.utils.sheet_to_csv(sheet, { blankrows: false, strip: false });
    if (csv.trim()) sections.push(`[Sheet: ${name}]\n${csv}`);
  }
  return { text: sections.join("\n\n"), locators: workbook.SheetNames.slice(0, 30).map(name => `Sheet ${name}`), truncated: workbook.SheetNames.length > 30 };
}

export async function extractClientFile(file: File): Promise<ExtractedUpload> {
  const ext = extension(file.name);
  if (!ALLOWED_EXTENSIONS.has(ext)) throw new Error(`${file.name}: choose PDF, DOCX, XLSX, CSV, TXT, Markdown, JSON, or EML.`);
  if (file.size <= 0 || file.size > MAX_FILE_SIZE) throw new Error(`${file.name}: each file must be between 1 byte and 10 MB.`);
  const data = await file.arrayBuffer();
  // PDF.js can transfer this buffer to its worker. Hash the original bytes first.
  const fileDigest = await sha256(data);
  let extracted: { text: string; locators: string[]; truncated: boolean };
  if (ext === "pdf") extracted = await pdfText(data);
  else if (ext === "docx") {
    const mammoth = await import("mammoth/mammoth.browser");
    const result = await mammoth.extractRawText({ arrayBuffer: data });
    const paragraphs = result.value.split(/\n\s*\n/).filter(Boolean);
    extracted = { text: paragraphs.map((paragraph, index) => `[Paragraph ${index + 1}] ${paragraph}`).join("\n\n"), locators: paragraphs.map((_, index) => `Paragraph ${index + 1}`).slice(0, 200), truncated: false };
  } else if (ext === "xlsx") extracted = await spreadsheetText(data);
  else {
    const decoded = new TextDecoder("utf-8", { fatal: false }).decode(data);
    const normalized = ext === "csv" ? decoded.split(/\r?\n/).map((line, index) => `[Row ${index + 1}] ${line}`).join("\n") : decoded;
    extracted = { text: normalized, locators: ext === "csv" ? decoded.split(/\r?\n/).slice(0, 200).map((_, index) => `Row ${index + 1}`) : ["Document text"], truncated: false };
  }
  const truncated = extracted.truncated || extracted.text.length > MAX_TEXT_PER_FILE;
  const text = extracted.text.slice(0, MAX_TEXT_PER_FILE);
  const noText = text.trim().length === 0;
  return {
    name: file.name.slice(0, 200), type: ext, size: file.size, sha256: fileDigest, text,
    status: noText && ext === "pdf" ? "ocr_required" : noText ? "needs_attention" : "extracted",
    ...(noText ? { message: ext === "pdf" ? "No selectable text was found. OCR is required for scanned or image-only PDFs." : "No readable text was extracted from this file." } : {}),
    locators: extracted.locators.slice(0, 200), truncated,
  };
}

export function allowedDocumentExtension(name: string) { return ALLOWED_EXTENSIONS.has(extension(name)); }
