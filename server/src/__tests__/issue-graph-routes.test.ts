import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { errorHandler } from "../middleware/index.js";

const mockIssueService = vi.hoisted(() => ({
  getById: vi.fn(),
  getGraph: vi.fn(),
}));

vi.mock("@paperclipai/shared/telemetry", () => ({
  trackAgentTaskCompleted: vi.fn(),
}));

vi.mock("../telemetry.js", () => ({
  getTelemetryClient: vi.fn(() => ({ track: vi.fn() })),
}));

vi.mock("../otel.js", () => ({
  recordComment: vi.fn(),
  recordHumanIntervened: vi.fn(),
  recordIssueCreated: vi.fn(),
  recordIssueStatusChanged: vi.fn(),
  recordIssueStatusCounts: vi.fn(),
  clearIssueStatusCountsForCompany: vi.fn(),
  traceHumanCommentPosted: vi.fn(),
}));

vi.mock("../services/index.js", () => ({
  accessService: () => ({ canUser: vi.fn(), hasPermission: vi.fn() }),
  agentService: () => ({ getById: vi.fn(), list: vi.fn(), resolveByReference: vi.fn() }),
  documentService: () => ({
    getIssueDocumentPayload: vi.fn(),
    listIssueDocuments: vi.fn(),
    getIssueDocumentByKey: vi.fn(),
    listIssueDocumentRevisions: vi.fn(),
  }),
  executionWorkspaceService: () => ({ getById: vi.fn() }),
  feedbackService: () => ({
    listIssueVotesForUser: vi.fn(async () => []),
    saveIssueVote: vi.fn(async () => ({ vote: null, consentEnabledNow: false, sharingEnabled: false })),
  }),
  goalService: () => ({}),
  heartbeatService: () => ({
    wakeup: vi.fn(async () => undefined),
    reportRunActivity: vi.fn(async () => undefined),
    getRun: vi.fn(async () => null),
    getActiveRunForAgent: vi.fn(async () => null),
    cancelRun: vi.fn(async () => null),
  }),
  instanceSettingsService: () => ({
    get: vi.fn(async () => ({
      id: "instance-settings-1",
      general: {
        censorUsernameInLogs: false,
        feedbackDataSharingPreference: "prompt",
      },
    })),
    listCompanyIds: vi.fn(async () => ["company-1"]),
  }),
  issueApprovalService: () => ({}),
  issueThreadInteractionService: () => ({
    listForIssue: vi.fn(async () => []),
    expireRequestConfirmationsSupersededByComment: vi.fn(async () => []),
    expireStaleRequestConfirmationsForIssueDocument: vi.fn(async () => []),
  }),
  issueReferenceService: () => ({
    deleteDocumentSource: vi.fn(async () => undefined),
    diffIssueReferenceSummary: vi.fn(() => ({
      addedReferencedIssues: [],
      removedReferencedIssues: [],
      currentReferencedIssues: [],
    })),
    emptySummary: vi.fn(() => ({ outbound: [], inbound: [] })),
    listIssueReferenceSummary: vi.fn(async () => ({ outbound: [], inbound: [] })),
    syncComment: vi.fn(async () => undefined),
    syncDocument: vi.fn(async () => undefined),
    syncIssue: vi.fn(async () => undefined),
  }),
  issueService: () => mockIssueService,
  logActivity: vi.fn(async () => undefined),
  projectService: () => ({
    getById: vi.fn(async () => null),
    listByIds: vi.fn(async () => []),
  }),
  routineService: () => ({
    syncRunStatusForIssue: vi.fn(async () => undefined),
  }),
  workProductService: () => ({
    listForIssue: vi.fn(async () => []),
  }),
  ISSUE_LIST_DEFAULT_LIMIT: 20,
  ISSUE_LIST_MAX_LIMIT: 100,
  clampIssueListLimit: (value: number) => value,
}));

import { issueRoutes } from "../routes/issues.js";

function createApp(companyIds: string[] = ["company-1"]) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).actor = {
      type: "board",
      userId: "board-user",
      companyIds,
      source: "session",
      isInstanceAdmin: false,
    };
    next();
  });
  app.use("/api", issueRoutes({} as any, {} as any));
  app.use(errorHandler);
  return app;
}

describe("issue graph routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIssueService.getGraph.mockResolvedValue({
      rootIssueId: "issue-root",
      issues: [],
      agents: [],
      deliverables: [],
      edges: [],
    });
  });

  it("resolves graph requests by identifier and uuid", async () => {
    mockIssueService.getById.mockResolvedValue({
      id: "issue-root",
      companyId: "company-1",
      title: "Root issue",
      status: "todo",
      priority: "medium",
    });

    const app = createApp();
    const identifierRes = await request(app).get("/api/issues/PAP-2/graph");
    const uuidRes = await request(app).get("/api/issues/11111111-1111-4111-8111-111111111111/graph");

    expect(identifierRes.status).toBe(200);
    expect(uuidRes.status).toBe(200);
    expect(mockIssueService.getById).toHaveBeenCalledWith("PAP-2");
    expect(mockIssueService.getById).toHaveBeenCalledWith("11111111-1111-4111-8111-111111111111");
    expect(mockIssueService.getGraph).toHaveBeenCalledWith("PAP-2");
    expect(mockIssueService.getGraph).toHaveBeenCalledWith("11111111-1111-4111-8111-111111111111");
  });

  it("rejects graph access outside the actor's company scope", async () => {
    mockIssueService.getById.mockResolvedValue({
      id: "issue-root",
      companyId: "company-2",
      title: "Root issue",
      status: "todo",
      priority: "medium",
    });

    const res = await request(createApp(["company-1"])).get("/api/issues/PAP-2/graph");

    expect(res.status).toBe(403);
    expect(mockIssueService.getGraph).not.toHaveBeenCalled();
  });
});
