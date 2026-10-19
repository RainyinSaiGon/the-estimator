"use client";

import { ArrowLeft, Search } from "lucide-react";
import type { ClientRequest } from "../../../lib/client-workflow-types";
import { requestStatusLabel, requestStatusTone, typeLabel } from "../request-presentation";
import { input } from "../ui";

type RequestInboxProps = {
  requests: ClientRequest[];
  query: string;
  publicDemo: boolean;
  onQueryChange: (value: string) => void;
  onOpenRequest: (id: string) => void;
};

export function RequestInbox({
  requests,
  query,
  publicDemo,
  onQueryChange,
  onOpenRequest,
}: RequestInboxProps) {
  const visibleRequests = requests.filter((item) => {
    const normalizedQuery = query.trim().toLocaleLowerCase();
    return (
      !normalizedQuery ||
      [
        item.title,
        item.text,
        item.status,
        typeLabel[item.review.requestType] ?? item.review.requestType,
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
          {visibleRequests.length} of {requests.length} shown
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
                  {typeLabel[item.analysis?.requestType ?? item.review.requestType] ??
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
      {!requests.length && (
        <div className="py-12 text-center">
          <h3 className="text-lg font-semibold">No client briefs yet</h3>
          <p className="mt-2 text-sm leading-6 text-estimator-muted">
            {publicDemo
              ? "Add a fictional brief to try the full workflow."
              : "Add your first client brief to create an AI-drafted scope for review."}
          </p>
        </div>
      )}
      {requests.length > 0 && visibleRequests.length === 0 && (
        <p className="rounded-xl bg-estimator-paper p-4 text-sm text-estimator-muted">
          No requests match “{query}”.
        </p>
      )}
    </section>
  );
}
