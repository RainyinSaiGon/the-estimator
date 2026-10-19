"use client";

import { useState, type FormEvent } from "react";
import type { Company, WorkspaceResponse } from "../../../lib/client-workflow-types";
import { button, Field, input, secondary, Section } from "../ui";

export function KnowledgePanel({
  company,
  busy,
  action,
}: {
  company: Company;
  busy: boolean;
  action: (body: Record<string, unknown>) => Promise<WorkspaceResponse | undefined>;
}) {
  const [title, setTitle] = useState("");
  const [url, setUrl] = useState("");
  const [text, setText] = useState("");
  async function submit(event: FormEvent) {
    event.preventDefault();
    const result = await action({
      action: "addKnowledge",
      expectedVersion: company.version,
      title,
      url,
      text,
    });
    if (result) {
      setTitle("");
      setUrl("");
      setText("");
    }
  }
  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <Section
        title="Add approved company knowledge"
        description="Paste an official or administrator-authorized source excerpt. New entries remain drafts until an administrator approves them."
      >
        <form className="space-y-3" onSubmit={submit}>
          <fieldset className="space-y-4" disabled={busy || company.role !== "admin"}>
            <Field name="Source title">
              <input
                className={input}
                minLength={2}
                maxLength={200}
                required
                value={title}
                onChange={(event) => setTitle(event.target.value)}
              />
            </Field>
            <Field name="Source URL (optional for internal material)">
              <input
                className={input}
                type="url"
                maxLength={2000}
                value={url}
                onChange={(event) => setUrl(event.target.value)}
                placeholder="https://docs.example.com/..."
              />
            </Field>
            <Field name="Source text">
              <textarea
                className={input}
                rows={8}
                minLength={30}
                maxLength={100000}
                required
                value={text}
                onChange={(event) => setText(event.target.value)}
                placeholder="Paste the passage or content to make available to AI analysis…"
              />
            </Field>
            <p className="rounded-xl bg-[var(--paper)] p-3 text-xs leading-5 text-[var(--muted)]">
              Only approved knowledge is supplied to analysis. Each version retains its source
              title, URL, approval time and SHA-256 digest.
            </p>
            <button className={button} disabled={busy}>
              Add draft source
            </button>
          </fieldset>
        </form>
      </Section>
      <Section
        title="Approved knowledge library"
        description="Only active approved versions can support product-fit findings."
      >
        {company.knowledge.length ? (
          <div className="space-y-3">
            {company.knowledge.map((source) => (
              <article key={source.id} className="rounded-xl border border-[var(--line)] p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <strong className="text-sm">{source.title}</strong>
                  <span
                    className={`rounded-full px-2 py-1 text-[10px] uppercase ${source.status === "approved" ? "bg-green-50 text-green-800" : source.status === "draft" ? "bg-amber-50 text-amber-900" : "bg-neutral-100 text-neutral-600"}`}
                  >
                    {source.status}
                  </span>
                </div>
                {source.url && (
                  <a
                    className="mt-1 block break-all text-xs underline"
                    href={source.url}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {source.url}
                  </a>
                )}
                <p className="mt-2 line-clamp-3 text-xs leading-5 text-[var(--muted)]">
                  {source.text}
                </p>
                <p className="mt-2 break-all font-mono text-[10px] text-[var(--muted)]">
                  SHA-256 {source.sha256}
                </p>
                {source.approvedAt && (
                  <p className="mt-1 text-[10px] text-[var(--muted)]">
                    Approved {new Date(source.approvedAt).toLocaleString()} by {source.approvedBy}
                  </p>
                )}
                <div className="mt-3 flex gap-2">
                  {company.role === "admin" && source.status === "draft" && (
                    <button
                      className={secondary}
                      disabled={busy}
                      onClick={() =>
                        void action({
                          action: "approveKnowledge",
                          expectedVersion: company.version,
                          knowledgeId: source.id,
                        })
                      }
                    >
                      Approve source
                    </button>
                  )}
                  {company.role === "admin" && source.status === "approved" && (
                    <button
                      className={secondary}
                      disabled={busy}
                      onClick={() =>
                        void action({
                          action: "retireKnowledge",
                          expectedVersion: company.version,
                          knowledgeId: source.id,
                        })
                      }
                    >
                      Retire version
                    </button>
                  )}
                </div>
              </article>
            ))}
          </div>
        ) : (
          <p className="text-sm text-[var(--muted)]">
            No knowledge sources yet. Add a draft and approve it before use.
          </p>
        )}
      </Section>
    </div>
  );
}
