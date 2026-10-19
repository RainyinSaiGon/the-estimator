import type { WorkspaceQuery } from "../../lib/workflow-query-types";
import type { WorkspaceResponse } from "../../lib/client-workflow-types";

export async function api(
  body?: Record<string, unknown> | FormData,
  companyId?: string,
  signal?: AbortSignal,
  query?: WorkspaceQuery,
): Promise<WorkspaceResponse> {
  const params = new URLSearchParams();
  if (companyId) params.set("company", companyId);
  if (query?.inbox) params.set("inbox", "1");
  if (query?.offset !== undefined) params.set("offset", String(query.offset));
  if (query?.limit !== undefined) params.set("limit", String(query.limit));
  if (query?.query) params.set("q", query.query);
  if (query?.requestId) params.set("request", query.requestId);
  const url = "/api/company-workspace" + (params.size ? `?${params}` : "");
  const isForm = typeof FormData !== "undefined" && body instanceof FormData;
  const response = await fetch(
    url,
    body
      ? {
          method: "POST",
          headers: isForm ? undefined : { "content-type": "application/json" },
          body: isForm ? body : JSON.stringify(body),
          cache: "no-store",
          signal,
        }
      : { cache: "no-store", signal },
  );
  const data = (await response.json()) as WorkspaceResponse & { error?: string };
  if (!response.ok) throw new Error(data.error || "The workspace request failed.");
  return data;
}
