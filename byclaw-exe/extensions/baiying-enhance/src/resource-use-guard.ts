/** Recheck at execution time: filtered employee snapshots cannot substitute for current use authorization. */
export async function validateRemoteResourceUse(params: {
  baseUrl: string;
  resourceId: string;
  headers: Record<string, string>;
  fetchImpl?: typeof fetch;
}): Promise<void> {
  if (!params.baseUrl) throw new Error("Resource authorization service unavailable");
  const response = await (params.fetchImpl ?? fetch)(`${params.baseUrl.replace(/\/+$/g, "")}/tool/checkResourceUse`, {
    method: "POST",
    headers: { ...params.headers, "Content-Type": "application/json", "System-Code": "BYAI" },
    body: JSON.stringify({ resourceId: params.resourceId }),
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) throw new Error("Resource authorization could not be verified");
  const result = await response.json() as { code?: unknown; data?: { allowed?: boolean } };
  if (String(result.code) !== "0" || result.data?.allowed !== true) {
    throw new Error("Resource use permission denied");
  }
}
