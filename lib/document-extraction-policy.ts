// Client-safe policy only. Parsers, binary hashes, signatures and storage stay
// in their browser or Worker adapters.
export const DOCUMENT_FORMATS = ["pdf", "docx", "xlsx", "csv", "txt", "md", "json", "eml"] as const;
export type DocumentFormat = typeof DOCUMENT_FORMATS[number];
export const DOCUMENT_EXTRACTION_STATUSES = ["extracted", "needs_attention", "ocr_required"] as const;

export const DOCUMENT_EXTRACTION_LIMITS = {
  textCharacters: 40000,
  locators: 200,
  locatorCharacters: 100,
  pdfPages: 100,
  xlsxSheets: 30,
  fileNameCharacters: 200,
} as const;

export const BROWSER_DOCUMENT_UPLOAD_POLICY = {
  maxFileBytes: 10 * 1024 * 1024,
  maxTotalBytes: 20 * 1024 * 1024,
  maxFiles: 10,
  maxBodyBytes: 25 * 1024 * 1024,
} as const;

export const WEBHOOK_DOCUMENT_UPLOAD_POLICY = {
  maxFileBytes: 2 * 1024 * 1024,
  maxTotalBytes: 4 * 1024 * 1024,
  maxFiles: 10,
  maxBodyBytes: 5 * 1024 * 1024,
  maxBase64Characters: 2800000,
} as const;

export type DocumentExtraction = { text: string; locators: string[]; truncated: boolean };
export type DocumentExtractionResult = DocumentExtraction & {
  status: typeof DOCUMENT_EXTRACTION_STATUSES[number];
  message?: string;
};
export type ExtractedDocumentUpload = DocumentExtractionResult & {
  name: string;
  type: string;
  size: number;
  sha256: string;
};

export function documentExtension(name: string) { return name.split(".").at(-1)?.toLowerCase() ?? ""; }

export function isSupportedDocumentFormat(extension: string): extension is DocumentFormat {
  return (DOCUMENT_FORMATS as readonly string[]).includes(extension);
}

export function allowedDocumentExtension(name: string) { return isSupportedDocumentFormat(documentExtension(name)); }

export function paragraphDocumentText(value: string): DocumentExtraction {
  const paragraphs = value.split(/\n\s*\n/).filter(Boolean);
  const locators = paragraphs.slice(0, DOCUMENT_EXTRACTION_LIMITS.locators).map((_, index) => `Paragraph ${index + 1}`);
  return {
    text: paragraphs.map((paragraph, index) => `[Paragraph ${index + 1}] ${paragraph}`).join("\n\n"),
    locators,
    truncated: paragraphs.length > locators.length,
  };
}

export function spreadsheetDocumentText(sheetNames: string[], sheetCsv: (name: string) => string | undefined): DocumentExtraction {
  const selected = sheetNames.slice(0, DOCUMENT_EXTRACTION_LIMITS.xlsxSheets);
  const sections: string[] = [];
  for (const name of selected) {
    const csv = sheetCsv(name);
    if (csv?.trim()) sections.push(`[Sheet: ${name}]\n${csv}`);
  }
  return {
    text: sections.join("\n\n"),
    locators: selected.map(name => `Sheet ${name}`),
    truncated: sheetNames.length > selected.length,
  };
}

export function plainDocumentText(value: string, format: DocumentFormat): DocumentExtraction {
  if (format !== "csv") return { text: value, locators: ["Document text"], truncated: false };
  const rows = value.split(/\r?\n/);
  const locators = rows.slice(0, DOCUMENT_EXTRACTION_LIMITS.locators).map((_, index) => `Row ${index + 1}`);
  return {
    text: rows.map((line, index) => `[Row ${index + 1}] ${line}`).join("\n"),
    locators,
    truncated: rows.length > locators.length,
  };
}

export function completeDocumentExtraction(format: DocumentFormat, extracted: DocumentExtraction): DocumentExtractionResult {
  const text = extracted.text.slice(0, DOCUMENT_EXTRACTION_LIMITS.textCharacters);
  const noText = text.trim().length === 0;
  return {
    text,
    locators: extracted.locators.slice(0, DOCUMENT_EXTRACTION_LIMITS.locators),
    // Missing references also require source limitation review, even if the
    // text itself fits within the character limit.
    truncated: extracted.truncated || extracted.text.length > text.length || extracted.locators.length > DOCUMENT_EXTRACTION_LIMITS.locators,
    status: noText ? format === "pdf" ? "ocr_required" : "needs_attention" : "extracted",
    ...(noText ? { message: format === "pdf" ? "No selectable text was found. OCR is required for scanned or image-only PDFs." : "No readable text was extracted from this file." } : {}),
  };
}

export function failedDocumentExtraction(): DocumentExtractionResult {
  return { text: "", locators: [], truncated: false, status: "needs_attention", message: "This attachment could not be extracted. Review the original and reconcile missing content before confirming scope." };
}
