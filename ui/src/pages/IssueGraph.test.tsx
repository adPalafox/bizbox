// @vitest-environment jsdom

import { act, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { IssueGraph } from "./IssueGraph";

const getGraphMock = vi.hoisted(() => vi.fn());
const setBreadcrumbsMock = vi.hoisted(() => vi.fn());
const navigateMock = vi.hoisted(() => vi.fn());

vi.mock("../api/issues", () => ({
  issuesApi: {
    getGraph: (issueId: string) => getGraphMock(issueId),
  },
}));

vi.mock("@/context/BreadcrumbContext", () => ({
  useBreadcrumbs: () => ({ setBreadcrumbs: setBreadcrumbsMock }),
}));

vi.mock("@/lib/router", () => ({
  Link: ({ to, children, ...props }: { to: string; children: ReactNode }) => <a href={to} {...props}>{children}</a>,
  useNavigate: () => navigateMock,
  useParams: () => ({ issueId: "PAP-2" }),
}));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

async function flushReact() {
  await act(async () => {
    await Promise.resolve();
    vi.runOnlyPendingTimers();
    await Promise.resolve();
  });
}

function sampleGraph() {
  return {
    rootIssueId: "issue-root",
    issues: [
      {
        kind: "issue",
        id: "issue-root",
        companyId: "company-1",
        identifier: "PAP-1",
        title: "Root issue",
        status: "todo",
        priority: "high",
        parentId: null,
        assigneeAgentId: null,
        assigneeUserId: null,
        projectId: null,
        goalId: null,
        startedAt: null,
        completedAt: null,
        cancelledAt: null,
        updatedAt: "2026-05-18T00:00:00.000Z",
      },
      {
        kind: "issue",
        id: "issue-child",
        companyId: "company-1",
        identifier: "PAP-2",
        title: "Child issue",
        status: "in_progress",
        priority: "medium",
        parentId: "issue-root",
        assigneeAgentId: "agent-1",
        assigneeUserId: null,
        projectId: null,
        goalId: null,
        startedAt: null,
        completedAt: null,
        cancelledAt: null,
        updatedAt: "2026-05-18T00:00:00.000Z",
      },
    ],
    agents: [
      {
        kind: "agent",
        id: "agent-1",
        companyId: "company-1",
        name: "Astro",
        urlKey: "astro",
        role: "engineer",
        icon: null,
        status: "active",
      },
    ],
    deliverables: [
      {
        kind: "deliverable",
        id: "deliverable-1",
        companyId: "company-1",
        issueId: "issue-child",
        deliverableKind: "document",
        title: "Execution plan",
        audience: "human",
        createdAt: "2026-05-18T00:00:00.000Z",
        updatedAt: "2026-05-18T00:00:00.000Z",
        artifactContentPath: null,
        artifactContentType: null,
        artifactByteSize: null,
        artifactOriginalFilename: null,
        documentKey: "plan",
        documentFormat: "markdown",
      },
    ],
    edges: [
      {
        id: "hierarchy:root-child",
        kind: "hierarchy",
        fromId: "issue:issue-root",
        toId: "issue:issue-child",
        issueId: "issue-child",
        agentId: null,
        deliverableId: null,
      },
      {
        id: "blocker:root-child",
        kind: "blocker",
        fromId: "issue:issue-root",
        toId: "issue:issue-child",
        issueId: "issue-child",
        agentId: null,
        deliverableId: null,
      },
      {
        id: "assigned:child-agent",
        kind: "assigned-agent",
        fromId: "issue:issue-child",
        toId: "agent:agent-1",
        issueId: "issue-child",
        agentId: "agent-1",
        deliverableId: null,
        participationRole: "assigned",
      },
      {
        id: "deliverable:child-doc",
        kind: "issue-deliverable",
        fromId: "issue:issue-child",
        toId: "deliverable:deliverable-1",
        issueId: "issue-child",
        agentId: null,
        deliverableId: "deliverable-1",
      },
    ],
  };
}

describe("IssueGraph page", () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    vi.useFakeTimers();
    container = document.createElement("div");
    document.body.appendChild(container);
  });

  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
    container.remove();
    document.body.innerHTML = "";
    vi.clearAllMocks();
  });

  it("renders issue, agent, and deliverable nodes with blocker edges", async () => {
    getGraphMock.mockResolvedValue(sampleGraph());

    const root = createRoot(container);
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });

    await act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <IssueGraph />
        </QueryClientProvider>,
      );
    });

    await flushReact();
    await flushReact();

    expect(container.textContent).toContain("Issue Pipeline");
    expect(container.textContent).toContain("Root issue");
    expect(container.textContent).toContain("Child issue");
    expect(container.textContent).toContain("Astro");
    expect(container.textContent).toContain("Execution plan");
    expect(container.querySelectorAll('[data-node-kind="issue"]').length).toBe(2);
    expect(container.querySelectorAll('[data-node-kind="agent"]').length).toBe(1);
    expect(container.querySelectorAll('[data-node-kind="deliverable"]').length).toBe(1);
    expect(container.querySelectorAll('[data-edge-kind="blocker"]').length).toBe(1);
    const edgePaths = Array.from(container.querySelectorAll("path[data-edge-kind]"));
    expect(edgePaths.every((path) => !(path.getAttribute("d") ?? "").includes("M 0 0"))).toBe(true);
    expect(setBreadcrumbsMock).toHaveBeenCalled();

    await act(async () => {
      const childButton = Array.from(container.querySelectorAll('button')).find((button) =>
        button.textContent?.includes("Child issue"),
      );
      childButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(navigateMock).toHaveBeenCalledWith("/issues/PAP-2");

    await act(async () => {
      const agentButton = Array.from(container.querySelectorAll('button')).find((button) =>
        button.textContent?.includes("Astro"),
      );
      agentButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(navigateMock).toHaveBeenCalledWith("/agents/astro");

    const deliverableLink = Array.from(container.querySelectorAll('a')).find((anchor) =>
      anchor.textContent?.includes("Execution plan"),
    );
    expect(deliverableLink?.getAttribute("href")).toBe("/issues/PAP-2#document-plan");
  });
});
