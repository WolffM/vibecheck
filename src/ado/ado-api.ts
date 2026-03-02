/**
 * Azure DevOps REST API Helpers
 *
 * Provides ADO work item CRUD operations via REST API.
 * Mirrors src/github/github.ts but targets ADO instead of GitHub.
 *
 * Environment variables:
 *   ADO_ORG      - ADO organization (e.g., "microsoft")
 *   ADO_PROJECT  - ADO project (e.g., "EngSys")
 *   ADO_PAT      - Personal Access Token
 *   ADO_AREA_PATH - (optional) Area path for work items
 */

// ============================================================================
// Types
// ============================================================================

export interface AdoWorkItem {
  id: number;
  title: string;
  description: string;
  state: string;
  tags: string[];
  url: string;
  metadata?: {
    fingerprint: string;
    lastSeenRun: number;
  };
}

export interface AdoWorkItemCreateParams {
  title: string;
  description: string;
  tags: string[];
  severity?: string;
  areaPath?: string;
  assignedTo?: string;
}

export interface AdoWorkItemUpdateParams {
  id: number;
  title?: string;
  description?: string;
  tags?: string[];
  state?: string;
}

interface JsonPatchOp {
  op: "add" | "replace" | "remove" | "test";
  path: string;
  value?: unknown;
}

// ============================================================================
// Configuration
// ============================================================================

export interface AdoConfig {
  org: string;
  project: string;
  pat: string;
  areaPath?: string;
  workItemType?: string;
}

export function getAdoConfig(): AdoConfig | null {
  const org = process.env.ADO_ORG;
  const project = process.env.ADO_PROJECT;
  const pat = process.env.ADO_PAT || process.env.ADO_TOKEN;

  if (!org || !project || !pat) {
    return null;
  }

  return {
    org,
    project,
    pat,
    areaPath: process.env.ADO_AREA_PATH,
    workItemType: process.env.ADO_WORKITEM_TYPE || "Task Item",
  };
}

function buildBaseUrl(config: AdoConfig): string {
  return `https://dev.azure.com/${config.org}/${encodeURIComponent(config.project)}`;
}

function buildHeaders(config: AdoConfig): Record<string, string> {
  // Support both PATs (short) and Bearer tokens (JWT, starts with "eyJ")
  const isBearer = config.pat.startsWith("eyJ");
  const auth = isBearer
    ? `Bearer ${config.pat}`
    : `Basic ${Buffer.from(`:${config.pat}`).toString("base64")}`;

  return {
    Authorization: auth,
    "Content-Type": "application/json-patch+json",
  };
}

// ============================================================================
// Work Item CRUD
// ============================================================================

/**
 * Create a new ADO work item (Bug type).
 */
export async function createWorkItem(
  config: AdoConfig,
  params: AdoWorkItemCreateParams,
): Promise<number> {
  const workItemType = encodeURIComponent(config.workItemType || "Task Item");
  const url = `${buildBaseUrl(config)}/_apis/wit/workitems/$${workItemType}?api-version=7.0`;

  const ops: JsonPatchOp[] = [
    { op: "add", path: "/fields/System.Title", value: params.title },
    { op: "add", path: "/fields/System.Description", value: params.description },
  ];

  if (params.tags.length > 0) {
    ops.push({ op: "add", path: "/fields/System.Tags", value: params.tags.join("; ") });
  }

  if (params.areaPath || config.areaPath) {
    ops.push({ op: "add", path: "/fields/System.AreaPath", value: params.areaPath || config.areaPath });
  }

  if (params.severity && config.workItemType?.toLowerCase() === "bug") {
    // ADO severity: 1 - Critical, 2 - High, 3 - Medium, 4 - Low
    const severityMap: Record<string, string> = {
      critical: "1 - Critical",
      high: "2 - High",
      medium: "3 - Medium",
      low: "4 - Low",
      info: "4 - Low",
    };
    const adoSeverity = severityMap[params.severity] || "3 - Medium";
    ops.push({ op: "add", path: "/fields/Microsoft.VSTS.Common.Severity", value: adoSeverity });
  }

  if (params.assignedTo) {
    ops.push({ op: "add", path: "/fields/System.AssignedTo", value: params.assignedTo });
  }

  // Some work item types require Activity field
  if (config.workItemType === "Task Item") {
    ops.push({ op: "add", path: "/fields/Microsoft.VSTS.Common.Activity", value: "None" });
  }

  const response = await fetch(url, {
    method: "POST",
    headers: buildHeaders(config),
    body: JSON.stringify(ops),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`Failed to create work item: ${response.status} ${errorBody}`);
  }

  const data = await response.json() as { id: number };
  return data.id;
}

/**
 * Update an existing ADO work item.
 */
export async function updateWorkItem(
  config: AdoConfig,
  params: AdoWorkItemUpdateParams,
): Promise<void> {
  const url = `${buildBaseUrl(config)}/_apis/wit/workitems/${params.id}?api-version=7.0`;

  const ops: JsonPatchOp[] = [];

  if (params.title) {
    ops.push({ op: "replace", path: "/fields/System.Title", value: params.title });
  }
  if (params.description) {
    ops.push({ op: "replace", path: "/fields/System.Description", value: params.description });
  }
  if (params.tags) {
    ops.push({ op: "replace", path: "/fields/System.Tags", value: params.tags.join("; ") });
  }
  if (params.state) {
    ops.push({ op: "replace", path: "/fields/System.State", value: params.state });
  }

  if (ops.length === 0) return;

  const response = await fetch(url, {
    method: "PATCH",
    headers: buildHeaders(config),
    body: JSON.stringify(ops),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`Failed to update work item ${params.id}: ${response.status} ${errorBody}`);
  }
}

/**
 * Close (resolve) an ADO work item with a comment.
 */
export async function closeWorkItem(
  config: AdoConfig,
  workItemId: number,
  reason?: string,
): Promise<void> {
  // Add comment first if provided
  if (reason) {
    await addWorkItemComment(config, workItemId, reason);
  }

  await updateWorkItem(config, {
    id: workItemId,
    state: "Resolved",
  });
}

/**
 * Add a comment to a work item.
 */
export async function addWorkItemComment(
  config: AdoConfig,
  workItemId: number,
  text: string,
): Promise<void> {
  const url = `${buildBaseUrl(config)}/_apis/wit/workitems/${workItemId}/comments?api-version=7.0-preview.3`;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      ...buildHeaders(config),
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ text }),
  });

  if (!response.ok) {
    console.warn(`Failed to add comment to work item ${workItemId}: ${response.status}`);
  }
}

// ============================================================================
// Work Item Query
// ============================================================================

/**
 * Query work items by tag (WIQL).
 */
export async function queryWorkItemsByTag(
  config: AdoConfig,
  tag: string,
  state?: "Active" | "Resolved" | "Closed" | "New",
): Promise<AdoWorkItem[]> {
  const url = `${buildBaseUrl(config)}/_apis/wit/wiql?api-version=7.0`;

  let whereClause = `[System.Tags] CONTAINS '${tag}' AND [System.WorkItemType] = 'Bug'`;
  if (state) {
    whereClause += ` AND [System.State] = '${state}'`;
  } else {
    // Default: active items (not resolved/closed)
    whereClause += ` AND [System.State] <> 'Closed' AND [System.State] <> 'Removed'`;
  }

  const wiql = {
    query: `SELECT [System.Id] FROM WorkItems WHERE ${whereClause} ORDER BY [System.CreatedDate] DESC`,
  };

  const response = await fetch(url, {
    method: "POST",
    headers: {
      ...buildHeaders(config),
      "Content-Type": "application/json",
    },
    body: JSON.stringify(wiql),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`WIQL query failed: ${response.status} ${errorBody}`);
  }

  const data = await response.json() as { workItems: { id: number; url: string }[] };
  if (!data.workItems || data.workItems.length === 0) {
    return [];
  }

  // Batch-fetch work item details (max 200 at a time)
  const ids = data.workItems.map((wi) => wi.id);
  return fetchWorkItemDetails(config, ids);
}

/**
 * Batch-fetch work item details by IDs.
 */
async function fetchWorkItemDetails(
  config: AdoConfig,
  ids: number[],
): Promise<AdoWorkItem[]> {
  const results: AdoWorkItem[] = [];
  const batchSize = 200;

  for (let i = 0; i < ids.length; i += batchSize) {
    const batch = ids.slice(i, i + batchSize);
    const idsParam = batch.join(",");
    const fields = "System.Id,System.Title,System.Description,System.State,System.Tags";
    const url = `${buildBaseUrl(config)}/_apis/wit/workitems?ids=${idsParam}&fields=${fields}&api-version=7.0`;

    const response = await fetch(url, {
      method: "GET",
      headers: {
        Authorization: buildHeaders(config).Authorization,
        "Content-Type": "application/json",
      },
    });

    if (!response.ok) {
      console.warn(`Failed to fetch work items batch: ${response.status}`);
      continue;
    }

    const data = await response.json() as {
      value: Array<{
        id: number;
        url: string;
        fields: Record<string, string>;
      }>;
    };

    for (const wi of data.value) {
      const tags = (wi.fields["System.Tags"] || "")
        .split(";")
        .map((t: string) => t.trim())
        .filter((t: string) => t.length > 0);

      // Extract vibecheck fingerprint from description
      const fpMatch = (wi.fields["System.Description"] || "").match(
        /vibecheck:fingerprint:([a-f0-9:]+)/,
      );

      const runMatch = (wi.fields["System.Description"] || "").match(
        /vibecheck:run:(\d+)/,
      );

      results.push({
        id: wi.id,
        title: wi.fields["System.Title"] || "",
        description: wi.fields["System.Description"] || "",
        state: wi.fields["System.State"] || "",
        tags,
        url: wi.url,
        metadata: fpMatch
          ? {
              fingerprint: fpMatch[1],
              lastSeenRun: runMatch ? parseInt(runMatch[1], 10) : 0,
            }
          : undefined,
      });
    }
  }

  return results;
}

// ============================================================================
// Fingerprint Map
// ============================================================================

/**
 * Build a fingerprint -> work item map for deduplication.
 */
export function buildFingerprintMap(
  workItems: AdoWorkItem[],
): Map<string, AdoWorkItem> {
  const map = new Map<string, AdoWorkItem>();
  for (const wi of workItems) {
    if (wi.metadata?.fingerprint) {
      map.set(wi.metadata.fingerprint, wi);
    }
  }
  return map;
}

// ============================================================================
// Rate Limiting
// ============================================================================

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function withRateLimit<T>(
  fn: () => Promise<T>,
  delayMs: number = 300,
): Promise<T> {
  const result = await fn();
  await delay(delayMs);
  return result;
}
