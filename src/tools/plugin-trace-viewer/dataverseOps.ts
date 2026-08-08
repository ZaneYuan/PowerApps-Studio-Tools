import { callNative } from "../../native/bridge";
import type { PluginTraceLog, TraceFilters } from "./types";

async function fetchDataverse<T>(connectionId: string, path: string): Promise<T> {
  return callNative<T>("dataverse.request", { connectionId, method: "GET", path });
}

function escapeODataString(v: string): string {
  return v.replace(/'/g, "''");
}

function buildFilterClauses(filters: TraceFilters): string[] {
  const clauses: string[] = [];
  if (filters.typeName.trim()) {
    clauses.push(`contains(typename,'${escapeODataString(filters.typeName.trim())}')`);
  }
  if (filters.messageName.trim()) {
    clauses.push(`contains(messagename,'${escapeODataString(filters.messageName.trim())}')`);
  }
  if (filters.primaryEntity.trim()) {
    clauses.push(`contains(primaryentity,'${escapeODataString(filters.primaryEntity.trim())}')`);
  }
  if (filters.onlyErrors) {
    clauses.push("exceptiondetails ne null");
  }
  if (filters.from) {
    clauses.push(`createdon ge ${new Date(filters.from).toISOString()}`);
  }
  if (filters.to) {
    clauses.push(`createdon le ${new Date(filters.to).toISOString()}`);
  }
  return clauses;
}

const LIST_SELECT =
  "plugintracelogid,createdon,typename,messagename,primaryentity,mode,operationtype,correlationid,depth,performanceexecutionduration,exceptiondetails";

/** Simple "most recent N matching filter" list — no true paging (Dataverse Web API paging is
 *  skiptoken-based, which adds real complexity for a v1). If exactly `top` rows come back there
 *  may be more; the UI hints at narrowing the filter instead of a "next page" control. */
export async function fetchTraceLogs(connectionId: string, filters: TraceFilters): Promise<PluginTraceLog[]> {
  const clauses = buildFilterClauses(filters);
  const params = [`$select=${LIST_SELECT}`, "$orderby=createdon desc", `$top=${filters.top}`];
  if (clauses.length) params.push(`$filter=${clauses.join(" and ")}`);

  const res = await fetchDataverse<{ value: PluginTraceLog[] }>(connectionId, `plugintracelogs?${params.join("&")}`);
  return res.value;
}

export async function fetchTraceLogDetail(connectionId: string, id: string): Promise<unknown> {
  return fetchDataverse<unknown>(connectionId, `plugintracelogs(${id})`);
}

export async function deleteTraceLog(connectionId: string, id: string): Promise<void> {
  await callNative("dataverse.request", { connectionId, method: "DELETE", path: `plugintracelogs(${id})` });
}

export interface OrgTraceSetting {
  organizationid: string;
  plugintracelogsetting: number;
}

export async function fetchTraceSetting(connectionId: string): Promise<OrgTraceSetting> {
  const res = await fetchDataverse<{ value: OrgTraceSetting[] }>(
    connectionId,
    "organizations?$select=organizationid,plugintracelogsetting&$top=1",
  );
  const org = res.value[0];
  if (!org) throw new Error("找不到 organization 记录");
  return org;
}

export async function updateTraceSetting(connectionId: string, organizationId: string, value: number): Promise<void> {
  await callNative("dataverse.request", {
    connectionId,
    method: "PATCH",
    path: `organizations(${organizationId})`,
    body: { plugintracelogsetting: value },
  });
}
