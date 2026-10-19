"use client";

import type { ClientAnalysis, Company, ScopeReview } from "../../../lib/client-workflow-types";
import { FindingReviewEditor } from "./review-editors";

type FindingReview = NonNullable<ScopeReview["findingReviews"]>[string];
type AnalysisFindingsProps = {
  analysis: ClientAnalysis;
  company: Company;
  findingReviews: NonNullable<ScopeReview["findingReviews"]>;
  canEstimate: boolean;
  editing: boolean;
  frozen: boolean;
  onFindingChange: (key: string, value: FindingReview) => void;
};

export function AnalysisFindings({
  analysis,
  company,
  findingReviews,
  canEstimate,
  editing,
  frozen,
  onFindingChange,
}: AnalysisFindingsProps) {
  return (
    <>
      <div className="rounded-xl border border-[var(--line)] p-4">
        <h3 className="text-sm font-semibold">Source-backed facts</h3>
        {analysis.facts.length ? (
          <ul className="mt-3 space-y-3">
            {analysis.facts.map((fact, index) => (
              <li key={index} className="border-t border-[var(--line)] pt-3">
                <p className="text-sm">
                  <strong>{fact.key.replaceAll("_", " ")}:</strong> {fact.value}{" "}
                  <span className="text-[10px] uppercase text-[var(--muted)]">
                    {fact.status} · {fact.source}
                  </span>
                </p>
                {fact.evidence && (
                  <blockquote className="mt-1 border-l-2 border-neutral-400 pl-2 text-xs leading-5 text-[var(--muted)]">
                    “{fact.evidence}”
                  </blockquote>
                )}
                <FindingReviewEditor
                  value={findingReviews[`fact:${index}`]}
                  disabled={!canEstimate || !editing || frozen}
                  onChange={(value) => onFindingChange(`fact:${index}`, value)}
                />
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-2 text-sm text-[var(--muted)]">
            No directly attributable facts were extracted.
          </p>
        )}
      </div>
      <div className="rounded-xl border border-[var(--line)] p-4">
        <h3 className="text-sm font-semibold">Product and capability fit</h3>
        {!company.knowledge.some((item) => item.status === "approved") && (
          <p className="mt-2 rounded-lg bg-amber-50 p-2 text-xs text-amber-900">
            No approved product knowledge is configured. Fit remains unknown.
          </p>
        )}
        {analysis.productFindings.map((finding, index) => {
          const source = company.knowledge.find((item) => item.id === finding.sourceId);
          return (
            <article key={index} className="mt-3 border-t border-[var(--line)] pt-3">
              <p className="text-sm">
                <strong>{finding.status}:</strong> {finding.explanation}
                {source && (
                  <span className="mt-1 block text-xs text-[var(--muted)]">
                    Source:{" "}
                    {source.url ? (
                      <a className="underline" href={source.url} target="_blank" rel="noreferrer">
                        {source.title}
                      </a>
                    ) : (
                      source.title
                    )}
                    {source.retrievedAt && (
                      <span className="ml-1">
                        (retrieved {new Date(source.retrievedAt).toLocaleString()})
                      </span>
                    )}
                  </span>
                )}
                {finding.evidence && (
                  <span className="mt-1 block text-xs text-[var(--muted)]">
                    “{finding.evidence}”
                  </span>
                )}
              </p>
              <FindingReviewEditor
                value={findingReviews[`product:${index}`]}
                disabled={!canEstimate || !editing || frozen}
                onChange={(value) => onFindingChange(`product:${index}`, value)}
              />
            </article>
          );
        })}
        {analysis.capabilityFindings.map((finding, index) => (
          <article key={`cap-${index}`} className="mt-3 border-t border-[var(--line)] pt-3">
            <p className="text-sm">
              <strong>
                {finding.capability} · {finding.status}:
              </strong>{" "}
              {finding.explanation}
              {finding.evidence && (
                <span className="mt-1 block text-xs text-[var(--muted)]">“{finding.evidence}”</span>
              )}
            </p>
            <FindingReviewEditor
              value={findingReviews[`capability:${index}`]}
              disabled={!canEstimate || !editing || frozen}
              onChange={(value) => onFindingChange(`capability:${index}`, value)}
            />
          </article>
        ))}
        {!company.config.capabilities.length && (
          <p className="mt-2 text-xs text-[var(--muted)]">
            Team capabilities have not been configured.
          </p>
        )}
      </div>
      <div className="rounded-xl border border-[var(--line)] p-4">
        <h3 className="text-sm font-semibold">AI assumptions and conflicts</h3>
        <p className="mt-1 text-xs leading-5 text-[var(--muted)]">
          Review each item and correct or reject it with a note when needed.
        </p>
        {analysis.conflicts.map((item, index) => (
          <article key={`conflict-${index}`} className="mt-3 border-t border-[var(--line)] pt-3">
            <p className="text-sm">
              <strong>Conflict:</strong> {item}
            </p>
            <FindingReviewEditor
              value={findingReviews[`conflict:${index}`]}
              disabled={!canEstimate || !editing || frozen}
              onChange={(value) => onFindingChange(`conflict:${index}`, value)}
            />
          </article>
        ))}
        {analysis.assumptions.map((item, index) => (
          <article key={`assumption-${index}`} className="mt-3 border-t border-[var(--line)] pt-3">
            <p className="text-sm">
              <strong>Assumption:</strong> {item}
            </p>
            <FindingReviewEditor
              value={findingReviews[`assumption:${index}`]}
              disabled={!canEstimate || !editing || frozen}
              onChange={(value) => onFindingChange(`assumption:${index}`, value)}
            />
          </article>
        ))}
        {!analysis.conflicts.length && !analysis.assumptions.length && (
          <p className="mt-2 text-sm text-[var(--muted)]">
            No assumptions or conflicts were reported.
          </p>
        )}
      </div>
    </>
  );
}
