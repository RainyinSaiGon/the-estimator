"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type SetStateAction } from "react";
import type { ClientRequest, CompanyConfig, ScopeReview } from "../../lib/client-workflow-types";
import { reviewForEditor } from "./request-presentation";

type Draft = { review: ScopeReview; original: string; sourceVersion: number; question: string };
type ReviewSubmission = { review: ScopeReview; revision: number };
const emptyProducts: CompanyConfig["products"] = [];
const isDirty = (item: Draft) => JSON.stringify(item.review) !== item.original || !!item.question;

/** Drafts belong to a company and request, rather than a response object.
 * Navigation keeps them in this tab; only save or explicit discard removes them. */
export function useScopeReviewDrafts(companyId: string, request: ClientRequest | null, products: CompanyConfig["products"] = emptyProducts) {
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const revisions = useRef<Record<string, number>>({});
  const key = request ? `${companyId}:${request.id}` : "";
  const serverReview = useMemo(() => request ? reviewForEditor(request, products) : null, [request, products]);
  const draft = drafts[key];
  const dirty = !!draft && isDirty(draft);
  const review = dirty ? draft.review : serverReview;
  const draftCount = Object.values(drafts).filter(isDirty).length;
  const serverChanged = dirty && !!draft && !!request && draft.sourceVersion !== request.version && draft.original !== JSON.stringify(serverReview);

  const setReview = useCallback((value: SetStateAction<ScopeReview | null>) => {
    if (!key || !request || !serverReview) return;
    revisions.current[key] = (revisions.current[key] ?? 0) + 1;
    setDrafts((current) => {
      const previous = current[key] && isDirty(current[key]) ? current[key] : undefined;
      const next = typeof value === "function" ? value(previous?.review ?? serverReview) : value;
      if (!next) return current;
      return { ...current, [key]: { review: next, original: previous?.original ?? JSON.stringify(serverReview), sourceVersion: previous?.sourceVersion ?? request.version, question: previous?.question ?? "" } };
    });
  }, [key, request, serverReview]);

  const setReviewerQuestion = useCallback((question: string) => {
    if (!key || !request || !serverReview) return;
    revisions.current[key] = (revisions.current[key] ?? 0) + 1;
    setDrafts((current) => {
      const previous = current[key] && isDirty(current[key]) ? current[key] : undefined;
      return { ...current, [key]: { review: previous?.review ?? serverReview, original: previous?.original ?? JSON.stringify(serverReview), sourceVersion: previous?.sourceVersion ?? request.version, question } };
    });
  }, [key, request, serverReview]);

  const discard = useCallback(() => {
    if (!key) return;
    revisions.current[key] = (revisions.current[key] ?? 0) + 1;
    setDrafts((current) => {
      const next = { ...current };
      delete next[key];
      return next;
    });
  }, [key]);

  const captureSave = useCallback((submitted: ScopeReview): ReviewSubmission => ({
    review: structuredClone(submitted), revision: revisions.current[key] ?? 0,
  }), [key]);

  const acknowledgeSave = useCallback((submission: ReviewSubmission, savedRequest?: ClientRequest) => {
    if (!key) return false;
    const hasNewEdits = (revisions.current[key] ?? 0) !== submission.revision;
    setDrafts((current) => {
      const existing = current[key];
      if (!existing) return current;
      // Keep edits typed while saving. The accepted response becomes their new base.
      const savedReview = savedRequest ? reviewForEditor(savedRequest, products) : submission.review;
      const changedDuringSave = JSON.stringify(existing.review) !== JSON.stringify(submission.review);
      if (changedDuringSave || existing.question)
        return { ...current, [key]: { ...existing, review: changedDuringSave ? existing.review : savedReview, original: JSON.stringify(savedReview), sourceVersion: savedRequest?.version ?? existing.sourceVersion } };
      const next = { ...current };
      delete next[key];
      return next;
    });
    return hasNewEdits || !!draft?.question;
  }, [draft?.question, key, products]);

  useEffect(() => {
    if (!draftCount) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [draftCount]);

  return { review, setReview, dirty, draftCount, serverChanged, discard, captureSave, acknowledgeSave, reviewerQuestion: draft?.question ?? "", setReviewerQuestion };
}
