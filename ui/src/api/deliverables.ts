import type { DeliverableDetail, DeliverableListItem } from "@paperclipai/shared";
import { api } from "./client";

export interface DeliverableListResponse {
  items: DeliverableListItem[];
  limit: number;
  offset: number;
}

export interface DeliverableListFilters {
  limit?: number;
  offset?: number;
  projectId?: string;
  agentId?: string;
  q?: string;
}

const DELIVERABLE_PAGE_LIMIT = 200;
const MAX_DELIVERABLE_PAGES = 100;

function buildDeliverablesQuery(filters?: DeliverableListFilters) {
  const params = new URLSearchParams();
  if (filters?.limit) params.set("limit", String(filters.limit));
  if (filters?.offset) params.set("offset", String(filters.offset));
  if (filters?.projectId) params.set("projectId", filters.projectId);
  if (filters?.agentId) params.set("agentId", filters.agentId);
  if (filters?.q) params.set("q", filters.q);
  return params.toString();
}

async function listAllDeliverables(companyId: string, filters?: DeliverableListFilters) {
  const startOffset = Math.max(0, Math.floor(filters?.offset ?? 0));
  const pageLimit = Math.max(1, Math.min(DELIVERABLE_PAGE_LIMIT, Math.floor(filters?.limit ?? DELIVERABLE_PAGE_LIMIT)));

  const items: DeliverableListItem[] = [];
  let offset = startOffset;

  for (let page = 0; page < MAX_DELIVERABLE_PAGES; page += 1) {
    const response = await deliverablesApi.list(companyId, {
      ...filters,
      limit: pageLimit,
      offset,
    });
    items.push(...response.items);
    if (response.items.length < pageLimit) break;
    offset += pageLimit;
  }

  return {
    items,
    limit: pageLimit,
    offset: startOffset,
  } satisfies DeliverableListResponse;
}

export const deliverablesApi = {
  list: (companyId: string, filters?: DeliverableListFilters) => {
    const qs = buildDeliverablesQuery(filters);
    return api.get<DeliverableListResponse>(
      `/companies/${companyId}/deliverables${qs ? `?${qs}` : ""}`,
    );
  },
  listAll: listAllDeliverables,
  get: (id: string) => api.get<DeliverableDetail>(`/deliverables/${id}`),
};
