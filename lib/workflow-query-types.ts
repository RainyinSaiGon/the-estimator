import type { ClientRequest, RequestType } from "./client-workflow-types";

/** Opt-in bounded inbox contract. Legacy callers still receive a request collection. */
export type WorkspaceQuery = {
  inbox?: boolean;
  offset?: number;
  limit?: number;
  query?: string;
  requestId?: string;
};
export type RequestSummary = Pick<ClientRequest, "id" | "title" | "status" | "version" | "createdAt" | "updatedAt" | "channel" | "cohort"> & {
  requestType: RequestType;
  hasAnalysis: boolean;
};
export type RequestInboxPage = {
  items: RequestSummary[];
  total: number;
  offset: number;
  limit: number;
  query: string;
};
export function normalizeWorkspaceQuery(query: WorkspaceQuery = {}): Required<Pick<WorkspaceQuery, "inbox" | "offset" | "limit" | "query">> & Pick<WorkspaceQuery, "requestId"> {
  const integer = (value: number | undefined, fallback: number) => Number.isSafeInteger(value) ? value! : fallback;
  return {
    inbox: query.inbox === true,
    offset: Math.max(0, integer(query.offset, 0)),
    limit: Math.max(1, Math.min(50, integer(query.limit, 25))),
    query: (query.query ?? "").trim().slice(0, 200),
    requestId: query.requestId,
  };
}
