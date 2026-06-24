import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import {
  activityLog,
  agents,
  companies,
  createDb,
  heartbeatRuns,
  workflowRunPhases,
  workflowRuns,
  workflowTriggerArtifacts,
  workflows,
} from "@paperclipai/db";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";

const mockPutFile = vi.hoisted(() => vi.fn(async () => ({
  provider: "local_disk",
  objectKey: "workflow-deliverables/object.md",
  contentType: "text/markdown; charset=utf-8",
  byteSize: 12,
  sha256: "hash",
  originalFilename: "object.md",
})));
const mockGetStorageService = vi.hoisted(() => vi.fn(() => ({
  provider: "local_disk",
  putFile: mockPutFile,
  getObject: vi.fn(),
  headObject: vi.fn(),
  deleteObject: vi.fn(),
})));
const mockInvokeGoogleAdk = vi.hoisted(() => vi.fn(async () => ({
  summary: "done",
  resultJson: { ok: true },
  errorMessage: null,
  provider: "google",
  model: "gemini",
  usage: null,
})));
const mockAnalyzeWorkflowProject = vi.hoisted(() => vi.fn(async () => ({
  pipelineDefinition: {
    entrypoint: "agent.py",
    generatedAt: "2026-06-02T12:00:00.000Z",
    phases: [{
      key: "phase-1",
      label: "Phase 1",
      kind: "phase",
      ordinal: 0,
      filePath: "agent.py",
      functionName: "run",
      parentKey: null,
      depth: 0,
      agentName: null,
      description: null,
    }],
  },
  sourceHash: "hash-1",
})));
const mockPrepareInstrumentedWorkflowRuntime = vi.hoisted(() => vi.fn(async (input: Record<string, unknown>) => ({
  runtimeRoot: "/tmp/workflow-runtime",
  tempRoot: "/tmp/workflow-runtime/tmp",
  copiedAgentPath: "/tmp/workflow-runtime/agent.py",
  patchedRunnerConfig: input.runnerConfig ?? {},
})));
const mockCollectWorkflowRuntimeArtifacts = vi.hoisted(() => vi.fn(async () => []));
const mockCloseResolvedHandoff = vi.hoisted(() => vi.fn(async () => null));
const mockCloseTerminalRunHandoffs = vi.hoisted(() => vi.fn(async () => []));
const mockWorkflowHandoffBridgeService = vi.hoisted(() => vi.fn(() => ({
  closeResolvedHandoff: mockCloseResolvedHandoff,
  closeTerminalRunHandoffs: mockCloseTerminalRunHandoffs,
})));

vi.mock("../storage/index.js", () => ({
  getStorageService: mockGetStorageService,
}));

vi.mock("@paperclipai/adapter-google-adk/server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@paperclipai/adapter-google-adk/server")>();
  return {
    ...actual,
    invokeGoogleAdk: mockInvokeGoogleAdk,
  };
});

vi.mock("../services/workflows-runtime.js", () => ({
  analyzeWorkflowProject: mockAnalyzeWorkflowProject,
  prepareInstrumentedWorkflowRuntime: mockPrepareInstrumentedWorkflowRuntime,
  collectWorkflowRuntimeArtifacts: mockCollectWorkflowRuntimeArtifacts,
}));

vi.mock("../services/workflow-handoff-bridge.js", () => ({
  workflowHandoffBridgeService: mockWorkflowHandoffBridgeService,
}));

vi.mock("../workflow-run-jwt.js", () => ({
  createWorkflowRunJwt: vi.fn(() => "workflow-token"),
  verifyWorkflowRunJwt: vi.fn(),
}));

import {
  workflowTriggerBridgeService,
} from "../services/workflow-trigger-bridge.ts";
import {
  type WorkflowTriggerContractDefinition,
  type WorkflowTriggerContractRegistry,
} from "@paperclipai/shared";

const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported ? describe : describe.skip;

if (!embeddedPostgresSupport.supported) {
  console.warn(
    `Skipping embedded Postgres workflow trigger bridge tests on this host: ${embeddedPostgresSupport.reason ?? "unsupported environment"}`,
  );
}

const projectStatusWorkflowTriggerContractDefinition = {
  contractKey: "project-status-context",
  contractVersion: "1",
  payloadSchema: z.object({
    generatedAt: z.string().trim().min(1).datetime(),
    projectKey: z.string().trim().min(1).max(200),
    statusMarkdown: z.string().min(1).max(100_000),
    notes: z.array(z.object({
      key: z.string().trim().min(1).max(255),
      title: z.string().trim().min(1).max(500),
    }).passthrough()).default([]),
  }).passthrough(),
} satisfies WorkflowTriggerContractDefinition;

const contractRegistry: WorkflowTriggerContractRegistry = [
  projectStatusWorkflowTriggerContractDefinition,
];

function buildWorkflowTriggerPayload() {
  return {
    generatedAt: "2026-06-24T00:00:00.000Z",
    projectKey: "project-alpha",
    statusMarkdown: "Project is green.",
    notes: [
      {
        key: "note-1",
        title: "Reconciled inputs",
      },
    ],
  };
}

async function insertHeartbeatRun(db: ReturnType<typeof createDb>, input: {
  companyId: string;
  agentId: string;
  workflowTrigger: Record<string, unknown>;
}) {
  const runId = randomUUID();
  await db.insert(heartbeatRuns).values({
    id: runId,
    companyId: input.companyId,
    agentId: input.agentId,
    invocationSource: "automation",
    triggerDetail: "system",
    status: "succeeded",
    resultJson: {
      summary: "workflow trigger ready",
      workflowTrigger: input.workflowTrigger,
    },
    createdAt: new Date(),
    updatedAt: new Date(),
    finishedAt: new Date(),
  });

  return db.select().from(heartbeatRuns).where(eq(heartbeatRuns.id, runId)).then((rows) => rows[0] ?? null);
}

describeEmbeddedPostgres("workflowTriggerBridgeService", () => {
  let db!: ReturnType<typeof createDb>;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("paperclip-workflow-trigger-bridge-");
    db = createDb(tempDb.connectionString);
  }, 20_000);

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(async () => {
    await db.delete(workflowTriggerArtifacts);
    await db.delete(workflowRunPhases);
    await db.delete(workflowRuns);
    await db.delete(activityLog);
    await db.delete(heartbeatRuns);
    await db.delete(workflows);
    await db.delete(agents);
    await db.delete(companies);
  });

  afterAll(async () => {
    await db.$client.end();
    await tempDb?.cleanup();
  });

  it("persists the artifact, triggers one workflow run, and carries trigger context through the run", async () => {
    const companyId = randomUUID();
    const agentId = randomUUID();
    const workflowId = randomUUID();
    const heartbeatRun = randomUUID();

    await db.insert(companies).values({
      id: companyId,
      name: "Status Co",
      issuePrefix: `STS${companyId.slice(0, 3)}`,
      requireBoardApprovalForNewAgents: false,
    });
    await db.insert(agents).values({
      id: agentId,
      companyId,
      name: "Status Gatherer",
      role: "writer",
      status: "idle",
      adapterType: "openclaw_gateway",
      adapterConfig: { url: "wss://gateway.example/ws" },
    });
    await db.insert(workflows).values({
      id: workflowId,
      companyId,
      title: "Project status digest",
      status: "active",
      runnerType: "google_adk",
      runnerConfig: {
        agentPath: "/tmp/agent.py",
        inputContractKey: "project-status-context",
        inputContractVersion: "1",
      },
      pipelineDefinition: { entrypoint: "agent.py", generatedAt: new Date(0).toISOString(), phases: [] },
      pipelineSourceHash: null,
    });
    await db.insert(heartbeatRuns).values({
      id: heartbeatRun,
      companyId,
      agentId,
      invocationSource: "automation",
      triggerDetail: "system",
      status: "succeeded",
      resultJson: {
        summary: "workflow trigger ready",
        workflowTrigger: {
          companyId,
          sourceHeartbeatRunId: heartbeatRun,
          contractKey: projectStatusWorkflowTriggerContractDefinition.contractKey,
          contractVersion: projectStatusWorkflowTriggerContractDefinition.contractVersion,
          generatedAt: "2026-06-24T00:00:00.000Z",
          payload: buildWorkflowTriggerPayload(),
        },
      },
      createdAt: new Date(),
      updatedAt: new Date(),
      finishedAt: new Date(),
    });

    const run = await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.id, heartbeatRun)).then((rows) => rows[0] ?? null);
    expect(run).not.toBeNull();

    await workflowTriggerBridgeService(db, { contractRegistry }).processCompletedHeartbeatRun(run!);

    await vi.waitFor(async () => {
      const persisted = await db.select().from(workflowRuns).where(eq(workflowRuns.workflowId, workflowId)).then((rows) => rows[0] ?? null);
      expect(persisted?.status).toBe("succeeded");
    }, { timeout: 10_000 });

    const artifact = await db
      .select()
      .from(workflowTriggerArtifacts)
      .where(eq(workflowTriggerArtifacts.sourceHeartbeatRunId, heartbeatRun))
      .then((rows) => rows[0] ?? null);
    expect(artifact).not.toBeNull();
    expect(artifact?.validationStatus).toBe("passed");
    expect(artifact?.triggerStatus).toBe("triggered");
    expect(artifact?.payloadJson).toMatchObject({
      projectKey: "project-alpha",
    });

    const workflowRun = await db
      .select()
      .from(workflowRuns)
      .where(eq(workflowRuns.workflowId, workflowId))
      .then((rows) => rows[0] ?? null);
    expect(workflowRun).not.toBeNull();
    expect(workflowRun?.contextSnapshot).toMatchObject({
      workflowTrigger: expect.objectContaining({
        sourceHeartbeatRunId: heartbeatRun,
        sourceAgentId: agentId,
        targetWorkflowId: workflowId,
        triggeredWorkflowRunId: workflowRun?.id,
      }),
    });
    expect(mockPrepareInstrumentedWorkflowRuntime).toHaveBeenCalledWith(expect.objectContaining({
      workflowTriggerJson: expect.objectContaining({
        sourceHeartbeatRunId: heartbeatRun,
        sourceAgentId: agentId,
        triggeredWorkflowRunId: workflowRun?.id,
      }),
    }));

    const heartbeatRunAfter = await db
      .select()
      .from(heartbeatRuns)
      .where(eq(heartbeatRuns.id, heartbeatRun))
      .then((rows) => rows[0] ?? null);
    expect(heartbeatRunAfter?.contextSnapshot).toMatchObject({
      workflowTrigger: expect.objectContaining({
        sourceHeartbeatRunId: heartbeatRun,
        sourceAgentId: agentId,
        triggeredWorkflowRunId: workflowRun?.id,
      }),
    });
  });

  it("records invalid payloads without triggering a workflow run", async () => {
    const companyId = randomUUID();
    const agentId = randomUUID();
    const workflowId = randomUUID();
    const heartbeatRun = randomUUID();

    await db.insert(companies).values({
      id: companyId,
      name: "Status Co",
      issuePrefix: `STS${companyId.slice(0, 3)}`,
      requireBoardApprovalForNewAgents: false,
    });
    await db.insert(agents).values({
      id: agentId,
      companyId,
      name: "Status Gatherer",
      role: "writer",
      status: "idle",
      adapterType: "openclaw_gateway",
      adapterConfig: { url: "wss://gateway.example/ws" },
    });
    await db.insert(workflows).values({
      id: workflowId,
      companyId,
      title: "Project status digest",
      status: "active",
      runnerType: "google_adk",
      runnerConfig: {
        agentPath: "/tmp/agent.py",
        inputContractKey: "project-status-context",
        inputContractVersion: "1",
      },
      pipelineDefinition: { entrypoint: "agent.py", generatedAt: new Date(0).toISOString(), phases: [] },
      pipelineSourceHash: null,
    });
    await db.insert(heartbeatRuns).values({
      id: heartbeatRun,
      companyId,
      agentId,
      invocationSource: "automation",
      triggerDetail: "system",
      status: "succeeded",
      resultJson: {
        summary: "workflow trigger ready",
        workflowTrigger: {
          companyId,
          sourceHeartbeatRunId: heartbeatRun,
          contractKey: projectStatusWorkflowTriggerContractDefinition.contractKey,
          contractVersion: projectStatusWorkflowTriggerContractDefinition.contractVersion,
          generatedAt: "2026-06-24T00:00:00.000Z",
          payload: {
            generatedAt: "2026-06-24T00:00:00.000Z",
            projectKey: "project-alpha",
          },
        },
      },
      createdAt: new Date(),
      updatedAt: new Date(),
      finishedAt: new Date(),
    });

    const run = await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.id, heartbeatRun)).then((rows) => rows[0] ?? null);
    expect(run).not.toBeNull();

    await workflowTriggerBridgeService(db, { contractRegistry }).processCompletedHeartbeatRun(run!);

    const artifacts = await db
      .select()
      .from(workflowTriggerArtifacts)
      .where(eq(workflowTriggerArtifacts.sourceHeartbeatRunId, heartbeatRun));
    expect(artifacts).toHaveLength(1);
    expect(artifacts[0]?.validationStatus).toBe("failed");
    expect(artifacts[0]?.triggerStatus).toBe("not_triggered");

    const workflowRunCount = await db
      .select()
      .from(workflowRuns)
      .where(eq(workflowRuns.workflowId, workflowId));
    expect(workflowRunCount).toHaveLength(0);
  });

  it("dedupes repeated processing of the same heartbeat run", async () => {
    const companyId = randomUUID();
    const agentId = randomUUID();
    const workflowId = randomUUID();
    const heartbeatRun = randomUUID();

    await db.insert(companies).values({
      id: companyId,
      name: "Status Co",
      issuePrefix: `STS${companyId.slice(0, 3)}`,
      requireBoardApprovalForNewAgents: false,
    });
    await db.insert(agents).values({
      id: agentId,
      companyId,
      name: "Status Gatherer",
      role: "writer",
      status: "idle",
      adapterType: "openclaw_gateway",
      adapterConfig: { url: "wss://gateway.example/ws" },
    });
    await db.insert(workflows).values({
      id: workflowId,
      companyId,
      title: "Project status digest",
      status: "active",
      runnerType: "google_adk",
      runnerConfig: {
        agentPath: "/tmp/agent.py",
        inputContractKey: "project-status-context",
        inputContractVersion: "1",
      },
      pipelineDefinition: { entrypoint: "agent.py", generatedAt: new Date(0).toISOString(), phases: [] },
      pipelineSourceHash: null,
    });
    await db.insert(heartbeatRuns).values({
      id: heartbeatRun,
      companyId,
      agentId,
      invocationSource: "automation",
      triggerDetail: "system",
      status: "succeeded",
      resultJson: {
        summary: "workflow trigger ready",
        workflowTrigger: {
          companyId,
          sourceHeartbeatRunId: heartbeatRun,
          contractKey: projectStatusWorkflowTriggerContractDefinition.contractKey,
          contractVersion: projectStatusWorkflowTriggerContractDefinition.contractVersion,
          generatedAt: "2026-06-24T00:00:00.000Z",
          payload: buildWorkflowTriggerPayload(),
        },
      },
      createdAt: new Date(),
      updatedAt: new Date(),
      finishedAt: new Date(),
    });

    const run = await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.id, heartbeatRun)).then((rows) => rows[0] ?? null);
    expect(run).not.toBeNull();

    await workflowTriggerBridgeService(db, { contractRegistry }).processCompletedHeartbeatRun(run!);
    await workflowTriggerBridgeService(db, { contractRegistry }).processCompletedHeartbeatRun(run!);

    const workflowsTriggered = await db
      .select()
      .from(workflowRuns)
      .where(eq(workflowRuns.workflowId, workflowId));
    expect(workflowsTriggered).toHaveLength(1);
  });
});
