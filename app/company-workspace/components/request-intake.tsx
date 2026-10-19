"use client";

import { Loader2, WandSparkles, X } from "lucide-react";
import type { FormEvent } from "react";
import type { ExtractedUpload } from "../../../lib/browser-document-extraction";
import { DOCUMENT_FORMATS } from "../../../lib/document-extraction-policy";
import { button, Field, input, Section } from "../ui";

export type UploadItem = { file: File; result?: ExtractedUpload; error?: string };

type RequestIntakeProps = {
  publicDemo: boolean;
  title: string;
  text: string;
  cohort: "synthetic" | "recorded";
  uploads: UploadItem[];
  processingUploads: boolean;
  busy: boolean;
  aiReady: boolean;
  onSubmit: (event: FormEvent) => void | Promise<void>;
  onTitleChange: (value: string) => void;
  onTextChange: (value: string) => void;
  onCohortChange: (value: "synthetic" | "recorded") => void;
  onChooseFiles: (files: FileList | null) => void | Promise<void>;
  onRemoveUpload: (index: number) => void;
};

export function RequestIntakeForm({
  publicDemo,
  title,
  text,
  cohort,
  uploads,
  processingUploads,
  busy,
  aiReady,
  onSubmit,
  onTitleChange,
  onTextChange,
  onCohortChange,
  onChooseFiles,
  onRemoveUpload,
}: RequestIntakeProps) {
  return (
    <Section
      title="Add a client brief"
      description={
        publicDemo
          ? "Paste a fictional brief or attach sample documents. Live AI extracts evidence and drafts a scope for you to review before calculating effort."
          : "Paste the brief or attach source files. AI extracts evidence and drafts a scope; your team reviews it before the estimator calculates effort."
      }
    >
      <form className="space-y-4" onSubmit={onSubmit}>
        <Field name="Brief title">
          <input
            className={input}
            value={title}
            required
            minLength={3}
            maxLength={200}
            onChange={(event) => onTitleChange(event.target.value)}
            placeholder="e.g. Investor onboarding and data migration"
          />
        </Field>
        {!publicDemo ? (
          <Field name="Evidence cohort">
            <select
              className={input}
              value={cohort}
              onChange={(event) => onCohortChange(event.target.value as "synthetic" | "recorded")}
            >
              <option value="synthetic">Synthetic / test request</option>
              <option value="recorded">Recorded client request</option>
            </select>
            <span className="mt-1 block">
              This classification is frozen before actuals and cannot be changed afterward.
            </span>
          </Field>
        ) : (
          <div className="rounded-xl border border-estimator-line bg-estimator-paper p-3">
            <p className="text-sm font-medium">Synthetic demo request</p>
            <p className="mt-1 text-xs leading-5 text-estimator-muted">
              Requests from this shared workspace are always marked synthetic and excluded from real
              delivery training.
            </p>
          </div>
        )}
        <Field name="Client brief">
          <textarea
            className={input}
            rows={8}
            value={text}
            maxLength={20000}
            onChange={(event) => onTextChange(event.target.value)}
            placeholder="Paste the request email, form submission, or project brief…"
          />
        </Field>
        <Field name="Add documents · PDF, Word, Excel, CSV, text, JSON, or email">
          <input
            className={input}
            type="file"
            multiple
            accept={DOCUMENT_FORMATS.map(format => `.${format}`).join(",")}
            disabled={processingUploads || !!busy}
            onChange={(event) => {
              void onChooseFiles(event.currentTarget.files);
              event.currentTarget.value = "";
            }}
          />
        </Field>
        {processingUploads && (
          <p role="status" className="flex items-center gap-2 text-sm text-[var(--muted)]">
            <Loader2 size={15} className="animate-spin" />
            Reading file text and sheet or page references…
          </p>
        )}
        {uploads.length > 0 && (
          <ul className="space-y-2">
            {uploads.map((item, index) => (
              <li
                key={`${item.file.name}-${index}`}
                className="flex flex-wrap items-start justify-between gap-3 rounded-xl border border-[var(--line)] p-3"
              >
                <div className="min-w-0">
                  <p className="break-all text-sm font-medium">
                    {item.file.name}{" "}
                    <span className="font-normal text-[var(--muted)]">
                      ({(item.file.size / 1024).toFixed(0)} KB)
                    </span>
                  </p>
                  {item.error ? (
                    <p className="mt-1 text-xs text-red-800">{item.error}</p>
                  ) : (
                    item.result && (
                      <p className="mt-1 text-xs leading-5 text-[var(--muted)]">
                        {item.result.status.replaceAll("_", " ")} ·{" "}
                        {item.result.text.length.toLocaleString()} characters ·{" "}
                        {item.result.locators.length} references
                        {item.result.truncated ? " · extraction limited; review the original" : ""}
                        {item.result.message ? ` · ${item.result.message}` : ""}
                      </p>
                    )
                  )}
                </div>
                <button
                  type="button"
                  className="rounded-full p-1 text-[var(--muted)] hover:bg-[var(--paper)]"
                  aria-label={`Remove ${item.file.name}`}
                  onClick={() => onRemoveUpload(index)}
                >
                  <X size={15} />
                </button>
              </li>
            ))}
          </ul>
        )}
        <p className="rounded-xl bg-[var(--paper)] p-3 text-xs leading-5 text-[var(--muted)]">
          PDF, DOCX, XLSX, CSV, TXT, Markdown, JSON, and EML · 10 MB each, 20 MB total, 10 files.
          Extracted page or sheet references are shown with findings. Image-only PDFs need OCR,
          which this version does not provide.{" "}
          {publicDemo
            ? "Files are visible to every visitor to this shared demo workspace; use fictional documents only."
            : "Original files are stored in private company storage and deleted when you delete the request."}{" "}
          Request content and extracted text go to the configured AI provider; no numeric effort is
          generated by AI.
        </p>
        <button
          className={button}
          disabled={
            !!busy ||
            processingUploads ||
            uploads.some((item) => !!item.error || !item.result) ||
            !aiReady ||
            (text.trim().length < 30 && uploads.length === 0)
          }
        >
          <WandSparkles size={16} />
          Analyze brief
        </button>
        {!aiReady && (
          <p className="text-sm text-amber-800">
            Configure the server-side OpenAI key to analyze requests. Your text and files are not
            saved until analysis can start.
          </p>
        )}
      </form>
    </Section>
  );
}
