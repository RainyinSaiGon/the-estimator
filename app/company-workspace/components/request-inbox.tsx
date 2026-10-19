"use client";

import { ArrowLeft, Search } from "lucide-react";
import type { RequestInboxPage, RequestSummary } from "../../../lib/workflow-query-types";
import type { ClientRequest } from "../../../lib/client-workflow-types";
import { requestStatusLabel, requestStatusTone, typeLabel } from "../request-presentation";
import { input, secondary } from "../ui";

type RequestInboxProps = {
  requests: (ClientRequest | RequestSummary)[];
  page?: RequestInboxPage;
  busy?: boolean;
  onPageChange?: (offset: number) => void;
  query: string;
  publicDemo: boolean;
  onQueryChange: (value: string) => void;
  onOpenRequest: (id: string) => void;
};

export function RequestInbox({
  requests,
  page,
  busy = false,
  onPageChange,
  query,
  publicDemo,
  onQueryChange,
  onOpenRequest,
}: RequestInboxProps) {
  const visibleRequests = page ? requests : requests.filter((item) => {
    const normalizedQuery = query.trim().toLocaleLowerCase();
    return (
      !normalizedQuery ||
      [
        item.title,
        "text" in item ? item.text : "",
        item.status,
        typeLabel["requestType" in item ? item.requestType : item.review.requestType],
      ].some((value) => value.toLocaleLowerCase().includes(normalizedQuery))
    );
  });
  return (
    <section aria-label="Client brief inbox" className="min-w-0">
      <div className="flex flex-wrap items-center justify-between gap-3 pb-4">
        <label className="relative block w-full sm:max-w-sm">
          <span className="sr-only">Search client briefs</span>
          <Search
            size={16}
            aria-hidden="true"
            className="absolute left-3 top-1/2 -translate-y-1/2 text-estimator-muted"
          />
          <input
            className={input + " mt-0 pl-9"}
            type="search"
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
            placeholder="Search client briefs"
          />
        </label>
        <p className="text-xs text-estimator-muted">
          {page ? `${page.offset + (visibleRequests.length ? 1 : 0)}–${page.offset + visibleRequests.length} of ${page.total}` : `${visibleRequests.length} of ${requests.length}`} shown
        </p>
      </div>
      <div className="max-h-[65vh] divide-y divide-estimator-line overflow-y-auto border-y border-estimator-line">
        {visibleRequests.map((item) => {
          return (
            <button
              key={item.id}
              aria-label={`Open brief: ${item.title}`}
              className="group flex w-full items-center gap-4 px-2 py-5 text-left transition hover:bg-estimator-paper focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-estimator-accent sm:px-4"
              onClick={() => onOpenRequest(item.id)}
            >
              <span className="min-w-0 flex-1">
                <strong className="block break-words text-sm font-semibold leading-6">
                  {item.title}
                </strong>
                <span className="mt-1 block text-xs leading-5 text-estimator-muted">
                  {typeLabel["requestType" in item ? item.requestType : item.analysis?.requestType ?? item.review.requestType] ??
                    "Client brief"}{" "}
                  ·{" "}
                  <time dateTime={item.createdAt}>
                    {new Date(item.createdAt).toLocaleDateString(undefined, {
                      month: "short",
                      day: "numeric",
                    })}
                  </time>{" "}
                  · {item.channel === "webhook" ? "Form submission" : "Added manually"}
                </span>
                <span
                  className={`mt-2 inline-flex rounded-md px-2 py-1 text-[11px] font-medium sm:hidden ${requestStatusTone(item.status)}`}
                >
                  {requestStatusLabel(item.status)}
                </span>
              </span>
              <span
                className={`hidden shrink-0 rounded-md px-2.5 py-1 text-xs font-medium sm:inline-flex ${requestStatusTone(item.status)}`}
              >
                {requestStatusLabel(item.status)}
              </span>
              <ArrowLeft size={16} aria-hidden="true" className="rotate-180 text-estimator-muted" />
            </button>
          );
        })}
      </div>
      {page && page.total > page.limit && <nav aria-label="Client brief pages" className="mt-4 flex items-center justify-between gap-3">
        <button type="button" className={secondary} disabled={busy || page.offset === 0} onClick={() => onPageChange?.(Math.max(0, page.offset - page.limit))}>Previous</button>
        <span className="text-xs text-estimator-muted">Page {Math.floor(page.offset / page.limit) + 1} of {Math.max(1, Math.ceil(page.total / page.limit))}</span>
        <button type="button" className={secondary} disabled={busy || page.offset + page.limit >= page.total} onClick={() => onPageChange?.(page.offset + page.limit)}>Next</button>
      </nav>}
      {!requests.length && !query.trim() && (!page || page.total === 0) && (
        <div className="py-12 text-center">
          <h3 className="text-lg font-semibold">No client briefs yet</h3>
          <p className="mt-2 text-sm leading-6 text-estimator-muted">
            {publicDemo
              ? "Add a fictional brief to try the full workflow."
              : "Add your first client brief to create an AI-drafted scope for review."}
          </p>
        </div>
      )}
      {(query.trim() || (page && page.total > 0)) && visibleRequests.length === 0 && (
        <p className="rounded-xl bg-estimator-paper p-4 text-sm text-estimator-muted">
          No requests match “{query}”.
        </p>
      )}
    </section>
  );
}
