import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  workflowTriggerContractDefinition,
  validateWorkflowTrigger,
  type WorkflowTriggerContractDefinition,
  type WorkflowTriggerContractRegistry,
} from "./workflow-trigger.js";

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
  workflowTriggerContractDefinition,
  projectStatusWorkflowTriggerContractDefinition,
];

function buildTrigger(overrides: Partial<{
  companyId: string;
  sourceHeartbeatRunId: string;
  contractKey: string;
  contractVersion: string;
  payload: Record<string, unknown>;
}> = {}) {
  return {
    companyId: overrides.companyId ?? "11111111-1111-4111-8111-111111111111",
    sourceHeartbeatRunId: overrides.sourceHeartbeatRunId ?? "22222222-2222-4222-8222-222222222222",
    contractKey: overrides.contractKey ?? workflowTriggerContractDefinition.contractKey,
    contractVersion: overrides.contractVersion ?? workflowTriggerContractDefinition.contractVersion,
    generatedAt: "2026-06-24T00:00:00.000Z",
    payload: overrides.payload ?? {
      generatedAt: "2026-06-24T00:00:00.000Z",
      evidenceWindow: {
        startAt: "2026-06-17T00:00:00.000Z",
        endAt: "2026-06-24T00:00:00.000Z",
      },
      summaryMarkdown: "Generic summary",
      sections: [
        {
          key: "wins",
          title: "Wins",
          summaryMarkdown: "What went well.",
          evidenceRefs: ["doc-1"],
        },
      ],
      evidence: [
        {
          key: "doc-1",
          title: "Evidence one",
          url: "https://example.com/evidence",
          note: "Curated from source material.",
        },
      ],
    },
  };
}

describe("workflow trigger validation", () => {
  it("accepts a valid contract payload", () => {
    const result = validateWorkflowTrigger({
      workflowTrigger: buildTrigger(),
      companyId: "11111111-1111-4111-8111-111111111111",
      sourceHeartbeatRunId: "22222222-2222-4222-8222-222222222222",
      contractRegistry,
    });

    expect(result.success).toBe(true);
    if (!result.success) return;

    expect(result.workflowTrigger.contractKey).toBe(workflowTriggerContractDefinition.contractKey);
    expect(result.workflowTrigger.contractVersion).toBe(workflowTriggerContractDefinition.contractVersion);
    expect(result.workflowTrigger.payload).toMatchObject({
      summaryMarkdown: "Generic summary",
    });
  });

  it("accepts a second contract payload", () => {
    const result = validateWorkflowTrigger({
      workflowTrigger: buildTrigger({
        contractKey: projectStatusWorkflowTriggerContractDefinition.contractKey,
        contractVersion: projectStatusWorkflowTriggerContractDefinition.contractVersion,
        payload: {
          generatedAt: "2026-06-24T00:00:00.000Z",
          projectKey: "project-alpha",
          statusMarkdown: "Project is green.",
          notes: [
            {
              key: "note-1",
              title: "Reconciled inputs",
            },
          ],
        },
      }),
      companyId: "11111111-1111-4111-8111-111111111111",
      sourceHeartbeatRunId: "22222222-2222-4222-8222-222222222222",
      contractRegistry,
    });

    expect(result.success).toBe(true);
    if (!result.success) return;

    expect(result.workflowTrigger.contractKey).toBe("project-status-context");
    expect(result.workflowTrigger.payload).toMatchObject({
      projectKey: "project-alpha",
      statusMarkdown: "Project is green.",
    });
  });

  it("rejects an invalid contract payload", () => {
    const result = validateWorkflowTrigger({
      workflowTrigger: buildTrigger({
        payload: {
          generatedAt: "2026-06-24T00:00:00.000Z",
          evidenceWindow: {
            startAt: "2026-06-17T00:00:00.000Z",
            endAt: "2026-06-24T00:00:00.000Z",
          },
        },
      }),
      companyId: "11111111-1111-4111-8111-111111111111",
      sourceHeartbeatRunId: "22222222-2222-4222-8222-222222222222",
      contractRegistry,
    });

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.code).toBe("invalid_payload");
  });

  it("rejects a contract-version mismatch", () => {
    const result = validateWorkflowTrigger({
      workflowTrigger: buildTrigger({ contractVersion: "2" }),
      companyId: "11111111-1111-4111-8111-111111111111",
      sourceHeartbeatRunId: "22222222-2222-4222-8222-222222222222",
      contractRegistry,
    });

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.code).toBe("contract_version_mismatch");
  });

  it("rejects an unknown contract key", () => {
    const result = validateWorkflowTrigger({
      workflowTrigger: buildTrigger({ contractKey: "unknown-context", contractVersion: "1" }),
      companyId: "11111111-1111-4111-8111-111111111111",
      sourceHeartbeatRunId: "22222222-2222-4222-8222-222222222222",
      contractRegistry,
    });

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.code).toBe("unknown_contract");
  });

  it("rejects a company mismatch", () => {
    const result = validateWorkflowTrigger({
      workflowTrigger: buildTrigger({ companyId: "33333333-3333-4333-8333-333333333333" }),
      companyId: "11111111-1111-4111-8111-111111111111",
      sourceHeartbeatRunId: "22222222-2222-4222-8222-222222222222",
      contractRegistry,
    });

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.code).toBe("company_mismatch");
  });

  it("rejects payloads that exceed the size limit", () => {
    const result = validateWorkflowTrigger({
      workflowTrigger: buildTrigger(),
      companyId: "11111111-1111-4111-8111-111111111111",
      sourceHeartbeatRunId: "22222222-2222-4222-8222-222222222222",
      contractRegistry,
      maxBytes: 10,
    });

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.code).toBe("size_limit");
  });
});
