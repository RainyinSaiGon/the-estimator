import type { WorkspaceResponse } from "../../lib/client-workflow-types";

export async function api(
  body?: Record<string, unknown> | FormData,
  companyId?: string,
): Promise<WorkspaceResponse> {
  const url = companyId
    ? `/api/company-workspace?company=${encodeURIComponent(companyId)}`
    : "/api/company-workspace";
  const isForm = typeof FormData !== "undefined" && body instanceof FormData;
  const response = await fetch(
    url,
    body
      ? {
          method: "POST",
          headers: isForm ? undefined : { "content-type": "application/json" },
          body: isForm ? body : JSON.stringify(body),
          cache: "no-store",
        }
      : { cache: "no-store" },
  );
  const data = (await response.json()) as WorkspaceResponse & { error?: string };
  if (!response.ok) throw new Error(data.error || "The workspace request failed.");
  return data;
}
