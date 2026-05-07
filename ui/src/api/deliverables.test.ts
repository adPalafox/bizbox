import { beforeEach, describe, expect, it, vi } from "vitest";

const mockApi = vi.hoisted(() => ({
  get: vi.fn(),
}));

vi.mock("./client", () => ({
  api: mockApi,
}));

import { deliverablesApi } from "./deliverables";

describe("deliverablesApi", () => {
  beforeEach(() => {
    mockApi.get.mockReset();
  });

  it("list builds company deliverables query", async () => {
    mockApi.get.mockResolvedValue({ items: [], limit: 50, offset: 0 });

    await deliverablesApi.list("company-1", {
      projectId: "project-1",
      agentId: "agent-1",
      q: "report",
      limit: 20,
      offset: 40,
    });

    expect(mockApi.get).toHaveBeenCalledWith(
      "/companies/company-1/deliverables?limit=20&offset=40&projectId=project-1&agentId=agent-1&q=report",
    );
  });

  it("listAll loads every page", async () => {
    mockApi.get
      .mockResolvedValueOnce({ items: [{ id: "d1" }], limit: 1, offset: 0 })
      .mockResolvedValueOnce({ items: [{ id: "d2" }], limit: 1, offset: 1 })
      .mockResolvedValueOnce({ items: [], limit: 1, offset: 2 });

    const res = await deliverablesApi.listAll("company-1", { limit: 1 });

    expect(mockApi.get).toHaveBeenNthCalledWith(
      1,
      "/companies/company-1/deliverables?limit=1",
    );
    expect(mockApi.get).toHaveBeenNthCalledWith(
      2,
      "/companies/company-1/deliverables?limit=1&offset=1",
    );
    expect(mockApi.get).toHaveBeenNthCalledWith(
      3,
      "/companies/company-1/deliverables?limit=1&offset=2",
    );
    expect(res.items).toEqual([{ id: "d1" }, { id: "d2" }]);
  });
});
