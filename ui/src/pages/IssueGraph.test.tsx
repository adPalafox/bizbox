// @vitest-environment jsdom

import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { IssueGraph } from "./IssueGraph";

const getGraphMock = vi.hoisted(() => vi.fn());
const setBreadcrumbsMock = vi.hoisted(() => vi.fn());
const navigateMock = vi.hoisted(() => vi.fn());
let currentIssueId = "PAP-2";

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
  useParams: () => ({ issueId: currentIssueId }),
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
      {
        kind: "agent",
        id: "agent-2",
        companyId: "company-1",
        name: "Beacon",
        urlKey: "beacon",
        role: "reviewer",
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
        originatingIssueId: "issue-root",
        originatingIssueIdentifier: "PAP-1",
        originatingIssueTitle: "Root issue",
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
      {
        kind: "deliverable",
        id: "deliverable-root",
        companyId: "company-1",
        issueId: "issue-root",
        originatingIssueId: "issue-root",
        originatingIssueIdentifier: "PAP-1",
        originatingIssueTitle: "Root issue",
        deliverableKind: "document",
        title: "CEO Strategic Brief",
        audience: "human",
        createdAt: "2026-05-18T00:00:00.000Z",
        updatedAt: "2026-05-18T00:00:00.000Z",
        artifactContentPath: null,
        artifactContentType: null,
        artifactByteSize: null,
        artifactOriginalFilename: null,
        documentKey: "brief",
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
        id: "participant:child-agent",
        kind: "participant-agent",
        fromId: "issue:issue-child",
        toId: "agent:agent-2",
        issueId: "issue-child",
        agentId: "agent-2",
        deliverableId: null,
        participationRole: "participant",
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
      {
        id: "deliverable:root-doc",
        kind: "issue-deliverable",
        fromId: "issue:issue-root",
        toId: "deliverable:deliverable-root",
        issueId: "issue-root",
        agentId: null,
        deliverableId: "deliverable-root",
      },
    ],
  };
}

describe("IssueGraph page", () => {
  let container: HTMLDivElement;
  let root: Root | null;

  beforeEach(() => {
    vi.useFakeTimers();
    currentIssueId = "PAP-2";
    root = null;
    container = document.createElement("div");
    document.body.appendChild(container);
  });

  afterEach(() => {
    vi.runOnlyPendingTimers();
    act(() => {
      root?.unmount();
    });
    vi.useRealTimers();
    container.remove();
    document.body.innerHTML = "";
    vi.clearAllMocks();
  });

  it("renders a rooted pipeline while preserving the selected issue as the operator entry point", async () => {
    getGraphMock.mockResolvedValue(sampleGraph());

    root = createRoot(container);
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
    expect(container.textContent).toContain("Viewing PAP-2");
    expect(container.textContent).toContain("within PAP-1");
    expect(container.textContent).toContain("in progress");
    expect(container.textContent).toContain("Astro");
    expect(container.textContent).toContain("Beacon");
    expect(container.textContent).toContain("Assigned");
    expect(container.textContent).toContain("Worked");
    expect(container.textContent).toContain("Execution plan");
    expect(container.textContent).toContain("CEO Strategic Brief");
    expect(container.textContent).toContain("Part of PAP-1 pipeline");
    expect(container.querySelectorAll('[data-node-kind="issue"]').length).toBe(2);
    expect(container.querySelectorAll('[data-node-kind="agent"]').length).toBe(2);
    expect(container.querySelectorAll('[data-node-kind="deliverable"]').length).toBe(2);
    expect(container.querySelectorAll('[data-edge-kind="blocker"]').length).toBe(1);
    expect(container.querySelector('[data-node-kind="issue"][data-selected="true"]')?.textContent).toContain("Child issue");
    expect(container.textContent?.match(/Part of PAP-1 pipeline/g)?.length).toBe(1);
    const edgePaths = Array.from(container.querySelectorAll("path[data-edge-kind]"));
    expect(edgePaths.every((path) => !(path.getAttribute("d") ?? "").includes("M 0 0"))).toBe(true);
    expect(setBreadcrumbsMock).toHaveBeenCalled();
    expect(setBreadcrumbsMock).toHaveBeenCalledWith([
      { label: "Issues", href: "/issues" },
      { label: "PAP-2", href: "/issues/PAP-2" },
      { label: "Pipeline" },
    ]);

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

    await act(async () => {
      const participantButton = Array.from(container.querySelectorAll('button')).find((button) =>
        button.textContent?.includes("Beacon"),
      );
      participantButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(navigateMock).toHaveBeenCalledWith("/agents/beacon");

    const deliverableLink = Array.from(container.querySelectorAll('a')).find((anchor) =>
      anchor.textContent?.includes("Execution plan"),
    );
    expect(deliverableLink?.getAttribute("href")).toBe("/issues/PAP-2#document-plan");
  });

  it("omits redundant root context copy when the selected issue is the root", async () => {
    currentIssueId = "PAP-1";
    getGraphMock.mockResolvedValue(sampleGraph());

    root = createRoot(container);
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

    expect(container.textContent).toContain("Viewing PAP-1");
    expect(container.textContent).not.toContain("within PAP-1");
  });
});
